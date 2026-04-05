import type { WebContents } from 'electron'
import { asc, eq, inArray } from 'drizzle-orm'
import type {
  StoryThreadBatchGenerateOptions,
  StoryThreadBatchGenerationResult,
} from '../../src/shared/story-thread-generation'
import {
  buildContextAlignmentRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import type { EntityRegenerateOptions } from '../../src/types'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { getDb } from '../database/db'
import { chapters, novels, storyThreads } from '../database/schema'
import { safeParseAiJson } from '../utils/json'
import { markNovelContextChanged } from './context-impact.service'
import { buildStoryProfile } from './context.service'
import { buildBatchKey, createOperationLog } from './history.service'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import { appendVariationMessage } from './variation-control.service'

type StoryThreadType = 'main' | 'subplot' | 'mystery' | 'payoff' | 'relationship'
type StoryThreadStatus = 'planned' | 'active' | 'resolved' | 'stalled' | 'abandoned'
type StoryThreadPriority = 'high' | 'medium' | 'low'

interface StoryThreadQueryFilters {
  novelId: number
  threadType?: StoryThreadType
  status?: StoryThreadStatus
  keyword?: string
  page?: number
  pageSize?: number
}

export interface StoryThreadBatchChunkResult {
  ids: number[]
  warnings: string[]
  batchDigest?: string
}

interface GeneratedStoryThread {
  thread_type?: unknown
  title?: unknown
  summary?: unknown
  premise?: unknown
  status?: unknown
  priority?: unknown
  start_chapter?: unknown
  target_payoff_chapter?: unknown
  payoff_condition?: unknown
  current_state?: unknown
  notes?: unknown
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function normalizeThreadType(value: unknown): StoryThreadType {
  const text = asText(value)
  if (text === 'main' || text === 'mystery' || text === 'payoff' || text === 'relationship') return text
  return 'subplot'
}

function normalizeStatus(value: unknown): StoryThreadStatus {
  const text = asText(value)
  if (text === 'active' || text === 'resolved' || text === 'stalled' || text === 'abandoned') return text
  return 'planned'
}

function normalizePriority(value: unknown): StoryThreadPriority {
  const text = asText(value)
  if (text === 'high' || text === 'low') return text
  return 'medium'
}

function stringifyNumberArray(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!Array.isArray(raw)) return '[]'
  return JSON.stringify(raw
    .map((item) => asNumber(item))
    .filter((item): item is number => typeof item === 'number'))
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 24) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function priorityWeight(priority: StoryThreadPriority) {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  return 2
}

function sanitizeStoryThreadPayload(
  data: Partial<typeof storyThreads.$inferInsert>,
): Partial<typeof storyThreads.$inferInsert> {
  const next: Partial<typeof storyThreads.$inferInsert> = {}

  if ('threadType' in data) next.threadType = normalizeThreadType(data.threadType)
  if (typeof data.title === 'string') next.title = asText(data.title)
  if (typeof data.summary === 'string') next.summary = asText(data.summary)
  if (typeof data.premise === 'string') next.premise = asText(data.premise)
  if ('status' in data) next.status = normalizeStatus(data.status)
  if ('priority' in data) next.priority = normalizePriority(data.priority)
  if ('startChapter' in data) next.startChapter = asNumber(data.startChapter)
  if ('targetPayoffChapter' in data) next.targetPayoffChapter = asNumber(data.targetPayoffChapter)
  if (typeof data.payoffCondition === 'string') next.payoffCondition = asText(data.payoffCondition)
  if (typeof data.currentState === 'string') next.currentState = asText(data.currentState)
  if ('relatedCharacterIdsJson' in data) next.relatedCharacterIdsJson = stringifyNumberArray(data.relatedCharacterIdsJson)
  if ('relatedItemIdsJson' in data) next.relatedItemIdsJson = stringifyNumberArray(data.relatedItemIdsJson)
  if ('relatedTimelineEventIdsJson' in data) next.relatedTimelineEventIdsJson = stringifyNumberArray(data.relatedTimelineEventIdsJson)
  if (typeof data.notes === 'string') next.notes = asText(data.notes)
  if ('sortOrder' in data) next.sortOrder = asNumber(data.sortOrder) ?? 0

  return next
}

function getLatestChapterNum(novelId: number): number {
  const db = getDb()
  const rows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  return rows.reduce((maxValue, chapter) => Math.max(maxValue, chapter.chapterNum || 0), 0)
}

function clampGenerateCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 8
  return Math.max(1, Math.min(20, Math.round(numeric)))
}

function clampBatchSize(value: unknown, totalCount: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return Math.min(totalCount, 4)
  return Math.max(1, Math.min(totalCount, Math.round(numeric), 6))
}

function sanitizeErrorMessage(error: unknown, fallback = '生成失败'): string {
  const raw = error instanceof Error ? error.message : fallback
  return cleanAiFieldText(raw).replace(/^\[[^\]]+\]\s*/g, '').trim() || fallback
}

function normalizeThreadTitleKey(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase()
}

function normalizeBlockText(value: unknown): string {
  if (Array.isArray(value)) {
    return cleanAiStringArray(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ).join('\n')
  }

  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function clampChapter(value: unknown, chapterCeiling: number): number | null {
  const numeric = asNumber(value)
  if (typeof numeric !== 'number' || numeric <= 0) return null
  return Math.max(1, Math.min(chapterCeiling, numeric))
}

function buildThreadSummary(
  existingRows: Array<typeof storyThreads.$inferSelect>,
  createdDrafts: Array<Partial<typeof storyThreads.$inferInsert>> = [],
): string {
  const existingLines = existingRows.map((thread, index) => {
    const parts = [
      thread.threadType || 'subplot',
      thread.status || 'planned',
      thread.priority || 'medium',
      typeof thread.targetPayoffChapter === 'number' ? `回收=第${thread.targetPayoffChapter}章` : '',
      thread.summary || thread.currentState || thread.premise || '',
    ].filter(Boolean)
    return `${index + 1}. ${thread.title}${parts.length > 0 ? ` | ${parts.join(' | ')}` : ''}`
  })

  const createdLines = createdDrafts.map((thread, index) => {
    const parts = [
      typeof thread.threadType === 'string' ? thread.threadType : 'subplot',
      typeof thread.status === 'string' ? thread.status : 'planned',
      typeof thread.priority === 'string' ? thread.priority : 'medium',
      typeof thread.targetPayoffChapter === 'number' ? `回收=第${thread.targetPayoffChapter}章` : '',
      typeof thread.summary === 'string' ? thread.summary : '',
    ].filter(Boolean)
    return `${existingLines.length + index + 1}. ${thread.title || '未命名线程'}${parts.length > 0 ? ` | ${parts.join(' | ')}` : ''}`
  })

  const lines = [...existingLines, ...createdLines]
  return lines.length > 0 ? lines.join('\n') : '当前还没有任何故事线程。'
}

function normalizeSignaturePart(value?: string | null): string {
  return (value || '').replace(/\s+/g, '').trim().toLowerCase()
}

function buildThreadSignature(payload: Partial<typeof storyThreads.$inferInsert>): string {
  return [
    normalizeSignaturePart(typeof payload.title === 'string' ? payload.title : ''),
    normalizeSignaturePart(typeof payload.summary === 'string' ? payload.summary : ''),
    normalizeSignaturePart(typeof payload.premise === 'string' ? payload.premise : ''),
    normalizeSignaturePart(typeof payload.payoffCondition === 'string' ? payload.payoffCondition : ''),
    typeof payload.startChapter === 'number' ? String(payload.startChapter) : '',
    typeof payload.targetPayoffChapter === 'number' ? String(payload.targetPayoffChapter) : '',
  ].filter(Boolean).join('|')
}

function buildThreadCurrentSummary(thread: typeof storyThreads.$inferSelect): string {
  return [
    `标题：${thread.title}`,
    `类型：${thread.threadType || 'subplot'}`,
    `状态：${thread.status || 'planned'}`,
    `优先级：${thread.priority || 'medium'}`,
    typeof thread.startChapter === 'number' ? `起始章：第${thread.startChapter}章` : '',
    typeof thread.targetPayoffChapter === 'number' ? `目标回收章：第${thread.targetPayoffChapter}章` : '',
    thread.summary ? `摘要：${thread.summary}` : '',
    thread.premise ? `触发前提：${thread.premise}` : '',
    thread.payoffCondition ? `回收条件：${thread.payoffCondition}` : '',
    thread.currentState ? `当前状态：${thread.currentState}` : '',
    thread.notes ? `备注：${thread.notes}` : '',
  ].filter(Boolean).join('\n')
}

function buildStoryThreadRepairPrompt(params: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  current: typeof storyThreads.$inferSelect
  latestChapterNum: number
  estimatedChapterTotal: number
  mode: 'repair' | 'replace'
}): string {
  const storyCore = [
    params.profile.projectBriefSummary,
    params.profile.premiseSummary,
    params.profile.storyDesignSummary,
    params.profile.themeVoiceSummary,
    params.profile.worldRulesSummary,
  ].filter(Boolean).join('\n\n')

  return [
    `你是中文长篇小说的结构策划。请${params.mode === 'replace' ? '用明显不同的新方案替换' : '修复'}下面这条故事线程。`,
    '',
    '【小说基础】',
    `小说：${params.profile.novelTitle}`,
    `题材：${params.profile.genre}`,
    params.profile.background ? `背景：${params.profile.background}` : '',
    storyCore ? `故事底盘：${storyCore}` : '',
    `主角称呼：${params.profile.protagonistReference}`,
    `主角命名规则：${params.profile.protagonistRule}`,
    '',
    '【当前线程】',
    buildThreadCurrentSummary(params.current),
    '',
    '【修复目标】',
    params.mode === 'replace'
      ? '- 保留这条线程在结构中的功能位，但换成明显不同的标题、冲突抓手、回收条件和推进方式。'
      : '- 保留这条线程在结构中的功能位，优先修复空泛、重复、AI 味重和回收条件不清的问题。',
    `- 当前已写到约第 ${Math.max(params.latestChapterNum, 1)} 章，章位必须和正文进度相容。`,
    `- 回收章位请尽量落在 1 到 ${params.estimatedChapterTotal} 章之间。`,
    '- 不要把线程写成大段剧情摘要，必须保持成可追踪的线程卡片。',
    '',
    '只输出单个 JSON object，不要解释，不要 Markdown。',
    '{"thread_type":"subplot","title":"","summary":"","premise":"","status":"planned","priority":"medium","start_chapter":1,"target_payoff_chapter":12,"payoff_condition":"","current_state":"","notes":""}',
  ].filter(Boolean).join('\n')
}

function buildStoryThreadPrompt(params: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  existingSummary: string
  count: number
  latestChapterNum: number
  estimatedChapterTotal: number
  focus?: string
}): string {
  const storyCore = [
    params.profile.projectBriefSummary,
    params.profile.premiseSummary,
    params.profile.storyDesignSummary,
    params.profile.themeVoiceSummary,
    params.profile.worldRulesSummary,
  ].filter(Boolean).join('\n\n')

  return [
    `你是中文长篇小说的结构策划。请为这部小说补出 ${params.count} 条新的故事线程。`,
    '',
    '【小说基础】',
    `小说：${params.profile.novelTitle}`,
    `题材：${params.profile.genre}`,
    params.profile.background ? `背景：${params.profile.background}` : '',
    storyCore ? `故事底盘：${storyCore}` : '',
    `主角称呼：${params.profile.protagonistReference}`,
    `主角命名规则：${params.profile.protagonistRule}`,
    '',
    '【当前故事核心】',
    `故事目标：${params.profile.storyGoal || '暂未明确'}`,
    `核心冲突：${params.profile.coreConflict || '暂未明确'}`,
    `主推进链：${params.profile.mainPlot || '暂未明确'}`,
    `支线基础：${params.profile.subPlots || '暂未明确'}`,
    `结局方向：${params.profile.ending || '暂未明确'}`,
    `节奏比例：${params.profile.rhythmSummary || '暂未明确'}`,
    '',
    '【现有线程】',
    params.existingSummary,
    '',
    '【本轮目标】',
    '- 只生成新的故事线程，不要和已有线程重名、重功能或重回收点。',
    '- 线程类型只能使用：main / subplot / mystery / payoff / relationship。',
    '- status 优先使用 planned；只有在当前章节已经推进到相关阶段时才允许 active。',
    '- priority 只能使用：high / medium / low。',
    `- 回收章位请尽量落在 1 到 ${params.estimatedChapterTotal} 章之间。`,
    `- 当前已写到大约第 ${Math.max(params.latestChapterNum, 1)} 章；若线程尚未进入正文，请保持 planned。`,
    params.focus ? `- 本轮额外聚焦：${params.focus}` : '',
    '',
    '【字段要求】',
    '- title：线程标题，要能一眼看出它在推进什么。',
    '- summary：用 1 句话说明这条线程在持续推动什么。',
    '- premise：写它从哪里被触发、为什么成立。',
    '- payoff_condition：写这条线程什么情况下才算真正回收。',
    '- current_state：写当前阶段的状态，不要写成大段剧情。',
    '- notes：写回收注意点、禁忌或与其他线的耦合风险。',
    '',
    '【上下文护栏】',
    buildContextAlignmentRules({
      background: params.profile.background,
      storyCore,
      worldSummary: params.profile.worldRulesSummary,
      taskFocus: '补出可追踪、可回收、能服务主线推进的线程卡片。',
      extraLines: [
        '线程必须能被结构页、时间轴页和正文页反复引用，而不是一次性灵感。',
        '每条线程都要和主线推进、人物关系、悬念回收或主题压力至少绑定一个。',
      ],
    }),
    '',
    '【输出质量底线】',
    buildOutputQualityRules([
      '不要把线程写成整段剧情摘要，卡片必须短、硬、能追踪。',
      '避免“命运”“羁绊”“信念觉醒”这种空概念，优先写清具体矛盾和回收条件。',
      '如果是 mystery 线程，要写清谜面是什么；如果是 payoff 线程，要写清回收触发条件。',
    ]),
    '',
    '【语言要求】',
    buildHumanLanguageRules([
      '标题、摘要和状态描述都要像编辑在管理线索卡，而不是像宣传文案。',
      '不要生造词，不要口号化，不要空泛抒情。',
    ]),
    '',
    '只输出 JSON array，不要解释，不要 Markdown，不要代码块。数组长度必须等于本轮数量。',
    '[{"thread_type":"subplot","title":"","summary":"","premise":"","status":"planned","priority":"medium","start_chapter":1,"target_payoff_chapter":12,"payoff_condition":"","current_state":"","notes":""}]',
  ].filter(Boolean).join('\n')
}

function buildThreadReviewContext(params: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  existingSummary: string
  latestChapterNum: number
  estimatedChapterTotal: number
  currentSummary?: string
  focus?: string
  mode?: 'repair' | 'replace'
}): string {
  const storyCore = [
    params.profile.projectBriefSummary,
    params.profile.premiseSummary,
    params.profile.storyDesignSummary,
    params.profile.themeVoiceSummary,
    params.profile.worldRulesSummary,
  ].filter(Boolean).join('\n\n')

  return [
    `题材：${params.profile.genre}`,
    params.profile.background ? `背景：${params.profile.background}` : '',
    storyCore ? `故事底盘：\n${storyCore}` : '',
    `当前正文进度：约第 ${Math.max(params.latestChapterNum, 1)} 章`,
    `预计回收上限：约第 ${params.estimatedChapterTotal} 章`,
    `主角称呼：${params.profile.protagonistReference}`,
    `主角命名规则：${params.profile.protagonistRule}`,
    params.currentSummary ? `当前线程：\n${params.currentSummary}` : '',
    params.existingSummary ? `现有线程：\n${params.existingSummary}` : '',
    params.focus ? `本轮聚焦：${params.focus}` : '',
    params.mode ? `当前模式：${params.mode}` : '',
  ].filter(Boolean).join('\n\n')
}

function threadSchemaHint(expectedCount?: number): string {
  return [
    typeof expectedCount === 'number'
      ? `输出必须保持为 ${expectedCount} 个线程对象组成的 JSON 数组。`
      : '输出必须保持为单个线程 JSON 对象。',
    '不要把线程卡写成剧情长文或设定说明。',
    'title、summary、premise、payoff_condition、current_state 等结构字段必须保留。',
  ].join('\n')
}

function parseGeneratedThread(
  raw: GeneratedStoryThread,
  chapterCeiling: number,
): Partial<typeof storyThreads.$inferInsert> | null {
  const item = cleanAiValue(raw)
  const title = normalizeBlockText(item.title)
  if (!title) return null

  const startChapter = clampChapter(item.start_chapter, chapterCeiling)
  const targetPayoffChapterRaw = clampChapter(item.target_payoff_chapter, chapterCeiling)
  const targetPayoffChapter = typeof startChapter === 'number' && typeof targetPayoffChapterRaw === 'number'
    ? Math.max(startChapter, targetPayoffChapterRaw)
    : targetPayoffChapterRaw

  return {
    threadType: normalizeThreadType(item.thread_type),
    title,
    summary: normalizeBlockText(item.summary),
    premise: normalizeBlockText(item.premise),
    status: normalizeStatus(item.status),
    priority: normalizePriority(item.priority),
    startChapter: startChapter ?? null,
    targetPayoffChapter: targetPayoffChapter ?? null,
    payoffCondition: normalizeBlockText(item.payoff_condition),
    currentState: normalizeBlockText(item.current_state),
    relatedCharacterIdsJson: '[]',
    relatedItemIdsJson: '[]',
    relatedTimelineEventIdsJson: '[]',
    notes: normalizeBlockText(item.notes),
  }
}

export function listStoryThreads(novelId: number) {
  const db = getDb()
  return db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
}

export function getStoryThread(id: number) {
  const db = getDb()
  return db.select().from(storyThreads).where(eq(storyThreads.id, id)).all()[0] || null
}

export function queryStoryThreads(filters: StoryThreadQueryFilters) {
  const paging = normalizePaging(filters.page, filters.pageSize, 24)
  const keyword = asText(filters.keyword).toLowerCase()
  const items = listStoryThreads(filters.novelId)
    .filter((thread) => !filters.threadType || thread.threadType === filters.threadType)
    .filter((thread) => !filters.status || thread.status === filters.status)
    .filter((thread) => {
      if (!keyword) return true
      const haystack = [thread.title, thread.summary, thread.premise, thread.currentState, thread.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
    .sort((left, right) => {
      const priorityDiff = priorityWeight(normalizePriority(left.priority)) - priorityWeight(normalizePriority(right.priority))
      if (priorityDiff !== 0) return priorityDiff
      return (left.sortOrder || 0) - (right.sortOrder || 0)
    })

  return buildPagedResult(
    items.slice(paging.offset, paging.offset + paging.pageSize),
    paging.page,
    paging.pageSize,
    items.length,
  )
}

export function getStoryThreadStats(filters: StoryThreadQueryFilters) {
  const items = queryStoryThreads({
    ...filters,
    page: 1,
    pageSize: 1000,
  }).items
  const latestChapterNum = getLatestChapterNum(filters.novelId)

  return items.reduce((result, thread) => {
    result.total += 1
    if (thread.status === 'active') result.activeCount += 1
    if (thread.status === 'resolved') result.resolvedCount += 1
    if (thread.status === 'stalled') result.stalledCount += 1
    if (
      thread.status !== 'resolved'
      && thread.status !== 'abandoned'
      && typeof thread.targetPayoffChapter === 'number'
      && thread.targetPayoffChapter > 0
      && thread.targetPayoffChapter < latestChapterNum
    ) {
      result.overdueCount += 1
    }
    return result
  }, {
    total: 0,
    activeCount: 0,
    resolvedCount: 0,
    stalledCount: 0,
    overdueCount: 0,
  })
}

export function createStoryThread(
  novelId: number,
  data: Partial<typeof storyThreads.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const rows = listStoryThreads(novelId)
  const result = db.insert(storyThreads).values({
    novelId,
    threadType: 'subplot',
    title: data.title || '未命名线程',
    status: 'planned',
    priority: 'medium',
    relatedCharacterIdsJson: '[]',
    relatedItemIdsJson: '[]',
    relatedTimelineEventIdsJson: '[]',
    sortOrder: rows.length > 0 ? Math.max(...rows.map((thread) => thread.sortOrder || 0)) + 1 : 1,
    ...sanitizeStoryThreadPayload(data),
  }).run()

  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Story threads changed')
  }

  return Number(result.lastInsertRowid)
}

export function updateStoryThread(
  id: number,
  data: Partial<typeof storyThreads.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const current = getStoryThread(id)
  if (!current) return
  const db = getDb()
  db.update(storyThreads).set({
    ...sanitizeStoryThreadPayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(storyThreads.id, id)).run()

  if (!options.skipContextTracking) {
    markNovelContextChanged(current.novelId, 'Story threads changed')
  }
}

export function deleteStoryThread(id: number, options: { skipContextTracking?: boolean } = {}) {
  const current = getStoryThread(id)
  if (!current) return
  const db = getDb()
  db.delete(storyThreads).where(eq(storyThreads.id, id)).run()

  if (!options.skipContextTracking) {
    markNovelContextChanged(current.novelId, 'Story threads changed')
  }
}

export function batchUpdateStoryThreads(
  ids: number[],
  data: Partial<Pick<typeof storyThreads.$inferInsert, 'status' | 'priority'>>,
) {
  const threadIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (threadIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(storyThreads)
    .where(inArray(storyThreads.id, threadIds))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    updateStoryThread(row.id, {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
    }, { skipContextTracking: true })
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'thread',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_update',
    summary: `批量更新 ${rows.length} 条故事线程`,
    batchKey: buildBatchKey('thread-batch-update'),
    before: rows,
    after: data,
    undoPayload: {
      kind: 'thread.batch_update',
      novelId: rows[0].novelId,
      threads: rows,
    },
  })

  markNovelContextChanged(rows[0].novelId, 'Story threads changed')
  return rows.length
}

export function batchDeleteStoryThreads(ids: number[]) {
  const threadIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (threadIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(storyThreads)
    .where(inArray(storyThreads.id, threadIds))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    deleteStoryThread(row.id, { skipContextTracking: true })
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'thread',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_delete',
    summary: `批量删除 ${rows.length} 条故事线程`,
    batchKey: buildBatchKey('thread-batch-delete'),
    before: rows,
    after: [],
    undoPayload: {
      kind: 'thread.batch_delete',
      novelId: rows[0].novelId,
      threads: rows,
    },
  })

  markNovelContextChanged(rows[0].novelId, 'Story threads changed')
  return rows.length
}

export async function generateStoryThreadBatchChunk(
  novelId: number,
  options: StoryThreadBatchGenerateOptions = {},
  runtime: {
    parentTaskId?: number
    sender?: WebContents
    batchIndex?: number
    totalBatches?: number
  } = {},
): Promise<StoryThreadBatchChunkResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const existingRows = listStoryThreads(novelId)
  const latestChapterNum = getLatestChapterNum(novelId)
  const estimatedChapterTotal = Math.max(
    12,
    latestChapterNum,
    Math.ceil((novel.targetWords || 200000) / 3000),
  )
  const requestedCount = clampGenerateCount(options.count)
  const historyEntityType = 'thread'
  const historyTaskType = 'story_thread_generate_batch'
  const usedTitleKeys = new Set(
    existingRows
      .map((thread) => normalizeThreadTitleKey(thread.title || ''))
      .filter(Boolean),
  )
  const usedSignatures = new Set(
    existingRows
      .map((thread) => buildThreadSignature(thread))
      .filter(Boolean),
  )
  let resultPayload: StoryThreadBatchChunkResult | null = null
  const existingSummary = buildThreadSummary(existingRows, [])
  const focusSummary = [
    options.focus,
    `当前执行第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批，只补新的可追踪线程。`,
  ].filter(Boolean).join('\n')
  const reviewContext = buildThreadReviewContext({
    profile,
    existingSummary,
    latestChapterNum,
    estimatedChapterTotal,
    focus: focusSummary,
  })

  const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
  const messages = appendVariationMessage([{
    role: 'user',
    content: buildStoryThreadPrompt({
      profile,
      existingSummary,
      count: requestedCount,
      latestChapterNum,
      estimatedChapterTotal,
      focus: focusSummary,
    }),
  }], {
    attemptNumber,
    rejectedDigests,
  })
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'story_thread_generate',
    novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson,
    runnerType: 'chat',
    parentTaskId: runtime.parentTaskId,
  })

  if (typeof runtime.parentTaskId === 'number') {
    updateTask(runtime.parentTaskId, { currentChildTaskId: taskId })
  }

  try {
    await executeChatTask(taskId, {
      type: 'story_thread_generate',
      novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: novelId,
      inputJson,
      messages,
      sender: runtime.sender,
      onSuccess: async (result) => {
        const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
        const quality = await runAssetQualityLoop({
          targetType: 'thread',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender: runtime.sender,
          contextSummary: reviewContext,
          generatedOutput: result,
          schemaHint: threadSchemaHint(requestedCount),
          reviewFocus: [
            '线程标题要像可追踪的故事资产，不能写成设定说明或抽象主题词。',
            'summary、premise、payoff_condition 要具体，且与主线、人物关系或回收位挂钩。',
          ],
          rewriteConstraints: [
            '保持线程数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把 JSON 数组改成说明文。',
          ],
        })
        if (quality.stage === 'rejected') {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warnings: [summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批线程被审校拒收。`],
          }
          return resultPayload
        }
        let parsed: GeneratedStoryThread[]
        try {
          parsed = cleanAiValue(safeParseAiJson<GeneratedStoryThread[]>(quality.finalOutput, 'array'))
        } catch (error) {
          markRejected(historyId)
          throw error
        }

        let acceptedInBatch = 0
        const createdIds: number[] = []
        const warnings = summarizeAssetQualityWarnings(quality)
          ? [summarizeAssetQualityWarnings(quality) as string]
          : []
        const createdTitles: string[] = []

        for (const item of parsed) {
          const payload = parseGeneratedThread(item, estimatedChapterTotal)
          if (!payload?.title) continue

          const titleKey = normalizeThreadTitleKey(payload.title)
          if (!titleKey || usedTitleKeys.has(titleKey)) {
            warnings.push(`线程「${payload.title}」与现有线程重名或过于相近，已跳过。`)
            continue
          }

          const signature = buildThreadSignature(payload)
          if (!signature || usedSignatures.has(signature)) {
            warnings.push(`线程「${payload.title}」与现有线程功能或回收位过近，已跳过。`)
            continue
          }

          const id = createStoryThread(novelId, payload, { skipContextTracking: true })
          createdIds.push(id)
          usedTitleKeys.add(titleKey)
          usedSignatures.add(signature)
          acceptedInBatch += 1
          createdTitles.push(payload.title)
        }

        if (acceptedInBatch === 0) {
          markRejected(historyId)
          warnings.push(`第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批没有生成可用线程。`)
        }
        if (createdIds.length > 0) {
          markNovelContextChanged(novelId, 'Story threads changed')
        }

        resultPayload = {
          ids: createdIds,
          warnings,
          batchDigest: createdTitles.slice(0, 4).join('、'),
        }
        return resultPayload
      },
    })
  } finally {
    if (typeof runtime.parentTaskId === 'number') {
      updateTask(runtime.parentTaskId, { currentChildTaskId: null })
    }
  }

  return resultPayload || { ids: [], warnings: [] }
}

export async function generateStoryThreads(
  novelId: number,
  options: StoryThreadBatchGenerateOptions = {},
): Promise<StoryThreadBatchGenerationResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const existingRows = listStoryThreads(novelId)
  const latestChapterNum = getLatestChapterNum(novelId)
  const estimatedChapterTotal = Math.max(
    12,
    latestChapterNum,
    Math.ceil((novel.targetWords || 200000) / 3000),
  )
  const requestedCount = clampGenerateCount(options.count)
  const batchSize = clampBatchSize(options.batchSize, requestedCount)
  const createdDrafts: Array<Partial<typeof storyThreads.$inferInsert>> = []
  const createdIds: number[] = []
  const warnings: string[] = []
  const historyEntityType = 'thread'
  const historyTaskType = 'story_thread_generate_batch'
  const usedTitleKeys = new Set(
    existingRows
      .map((thread) => normalizeThreadTitleKey(thread.title || ''))
      .filter(Boolean),
  )
  const usedSignatures = new Set(
    existingRows
      .map((thread) => buildThreadSignature(thread))
      .filter(Boolean),
  )

  for (let offset = 0; offset < requestedCount; offset += batchSize) {
    const currentBatchCount = Math.min(batchSize, requestedCount - offset)

    try {
      const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
      const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
      const existingSummary = buildThreadSummary(existingRows, createdDrafts)
      const reviewContext = buildThreadReviewContext({
        profile,
        existingSummary,
        latestChapterNum,
        estimatedChapterTotal,
        focus: options.focus,
      })
      const messages = appendVariationMessage([{
        role: 'user',
        content: buildStoryThreadPrompt({
          profile,
          existingSummary,
          count: currentBatchCount,
          latestChapterNum,
          estimatedChapterTotal,
          focus: options.focus,
        }),
      }], {
        attemptNumber,
        rejectedDigests,
      })
      let acceptedBatch: GeneratedStoryThread[] | null = null
      let rejectedByQuality = false
      const result = await runChatTask({
        type: 'story_thread_generate',
        novelId,
        modelConfigId: novel.modelConfigId || undefined,
        relatedEntityType: 'novel',
        relatedEntityId: novelId,
        messages,
        onSuccess: async (rawOutput, taskId) => {
          const quality = await runAssetQualityLoop({
            targetType: 'thread',
            novelId,
            modelConfigId: novel.modelConfigId || undefined,
            relatedEntityType: 'novel',
            relatedEntityId: novelId,
            parentTaskId: taskId,
            contextSummary: reviewContext,
            generatedOutput: rawOutput,
            schemaHint: threadSchemaHint(currentBatchCount),
            reviewFocus: [
              '线程标题和结构字段必须具体，不要退化成主题口号或设定说明。',
              '线程要与当前正文进度、主线推进或回收位形成明确关联。',
            ],
            rewriteConstraints: [
              '保持线程数组长度不变。',
              '保持对象顺序和字段语义稳定。',
            ],
          })
          if (quality.stage === 'rejected') {
            rejectedByQuality = true
            warnings.push(summarizeAssetQualityWarnings(quality) || `第 ${Math.floor(offset / batchSize) + 1} 批线程被审校拒收。`)
            return quality
          }
          const qualityWarning = summarizeAssetQualityWarnings(quality)
          if (qualityWarning) warnings.push(qualityWarning)
          acceptedBatch = cleanAiValue(safeParseAiJson<GeneratedStoryThread[]>(quality.finalOutput, 'array'))
          return quality
        },
      })
      const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
      if (rejectedByQuality) {
        markRejected(historyId)
        continue
      }
      let parsed: GeneratedStoryThread[]
      try {
        parsed = acceptedBatch || cleanAiValue(safeParseAiJson<GeneratedStoryThread[]>(result, 'array'))
      } catch (error) {
        markRejected(historyId)
        throw error
      }
      let acceptedInBatch = 0

      for (const item of parsed) {
        const payload = parseGeneratedThread(item, estimatedChapterTotal)
        if (!payload?.title) continue

        const titleKey = normalizeThreadTitleKey(payload.title)
        if (!titleKey || usedTitleKeys.has(titleKey)) {
          warnings.push(`线程「${payload.title}」与现有线程重名或过于相近，已跳过。`)
          continue
        }

        const signature = buildThreadSignature(payload)
        if (!signature || usedSignatures.has(signature)) {
          warnings.push(`线程「${payload.title}」与现有线程功能或回收位过近，已跳过。`)
          continue
        }

        const id = createStoryThread(novelId, payload, { skipContextTracking: true })
        createdIds.push(id)
        createdDrafts.push(payload)
        usedTitleKeys.add(titleKey)
        usedSignatures.add(signature)
        acceptedInBatch += 1
      }

      if (acceptedInBatch === 0) {
        markRejected(historyId)
        warnings.push(`第 ${Math.floor(offset / batchSize) + 1} 批没有生成可用线程。`)
      }
    } catch (error) {
      warnings.push(`第 ${Math.floor(offset / batchSize) + 1} 批生成失败：${sanitizeErrorMessage(error)}`)
    }
  }

  if (createdIds.length > 0) {
    markNovelContextChanged(novelId, 'Story threads changed')
  }

  return {
    ids: createdIds,
    requestedCount,
    createdCount: createdIds.length,
    warnings,
  }
}

export async function regenerateStoryThread(
  id: number,
  options: EntityRegenerateOptions = {},
): Promise<typeof storyThreads.$inferSelect | null> {
  const current = getStoryThread(id)
  if (!current) return null

  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) return null

  const mode = options.mode === 'replace' ? 'replace' : 'repair'
  const profile = await buildStoryProfile(current.novelId)
  const latestChapterNum = getLatestChapterNum(current.novelId)
  const estimatedChapterTotal = Math.max(
    12,
    latestChapterNum,
    Math.ceil((novel.targetWords || 200000) / 3000),
  )
  const historyEntityType = 'thread'
  const historyTaskType = 'story_thread_regenerate'
  const attemptNumber = getAttemptCount(current.novelId, historyEntityType, current.id, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(current.novelId, historyEntityType, current.id, historyTaskType)
  const currentSignature = buildThreadSignature(current)
  const reviewContext = buildThreadReviewContext({
    profile,
    existingSummary: buildThreadSummary(listStoryThreads(current.novelId).filter((thread) => thread.id !== current.id), []),
    latestChapterNum,
    estimatedChapterTotal,
    currentSummary: buildThreadCurrentSummary(current),
    mode,
  })
  const messages = appendVariationMessage([{
    role: 'user',
    content: buildStoryThreadRepairPrompt({
      profile,
      current,
      latestChapterNum,
      estimatedChapterTotal,
      mode,
    }),
  }], {
    attemptNumber,
    rejectedDigests,
  })

  let acceptedCandidate: GeneratedStoryThread | null = null
  let rejectedByQuality = false
  const result = await runChatTask({
    type: 'story_thread_generate',
    novelId: current.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'thread',
    relatedEntityId: current.id,
    messages,
    onSuccess: async (rawOutput, taskId) => {
      const quality = await runAssetQualityLoop({
        targetType: 'thread',
        novelId: current.novelId,
        modelConfigId: novel.modelConfigId || undefined,
        relatedEntityType: 'thread',
        relatedEntityId: current.id,
        parentTaskId: taskId,
        contextSummary: reviewContext,
        generatedOutput: rawOutput,
        schemaHint: threadSchemaHint(),
        reviewFocus: [
          '修复后的线程必须继续承担原结构功能位，不能漂移成另一条无关线程。',
          '标题、回收条件、当前状态和推进抓手都要具体。',
        ],
        rewriteConstraints: [
          '保持单个线程 JSON 对象结构稳定。',
          '不要把线程卡改写成剧情长文。',
        ],
      })
      if (quality.stage === 'rejected') {
        rejectedByQuality = true
        return quality
      }
      acceptedCandidate = cleanAiValue(safeParseAiJson<GeneratedStoryThread>(quality.finalOutput, 'object'))
      return quality
    },
  })
  const historyId = recordGeneration(current.novelId, historyEntityType, current.id, historyTaskType, result, attemptNumber)
  if (rejectedByQuality) {
    markRejected(historyId)
    return current
  }
  let parsed: GeneratedStoryThread
  try {
    parsed = acceptedCandidate || cleanAiValue(safeParseAiJson<GeneratedStoryThread>(result, 'object'))
  } catch {
    markRejected(historyId)
    return current
  }
  const payload = parseGeneratedThread(parsed, estimatedChapterTotal)
  const nextSignature = payload ? buildThreadSignature(payload) : ''

  if (!payload || !payload.title || !nextSignature || nextSignature === currentSignature) {
    markRejected(historyId)
    return current
  }

  updateStoryThread(id, payload, { skipContextTracking: true })
  markNovelContextChanged(current.novelId, 'Story threads changed')
  return getStoryThread(id)
}
