import { desc, eq } from 'drizzle-orm'
import type {
  Chapter as AppChapter,
  ChapterFactExtract as AppChapterFactExtract,
  ChapterWritebackAssetType,
  ChapterWritebackCenterData,
  ChapterWritebackCoverageItem,
  ChapterWritebackDecision,
  ChapterWritebackDiff as AppChapterWritebackDiff,
  ChapterWritebackRun as AppChapterWritebackRun,
  WritebackVerificationStatus,
} from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import {
  chapterFactExtracts,
  chapterWritebackDiffs,
  chapterWritebackRuns,
  chapters,
  characters,
  novels,
  revisionTasks,
} from '../database/schema'
import { listLatestCharacterStates } from './character-state.service'
import { listLatestWorldStates } from './world-state.service'
import { listStoryThreads } from './story-thread.service'
import { listStoryFacts } from './story-fact.service'
import { listForeshadowLedger } from './endgame-asset.service'
import { listTimelineEvents } from './timeline.service'
import { listStoryItems } from './item.service'
import { listRelationshipArcs } from './character-arc.service'
import { runChatTask } from './task.service'
import { parseAiJsonResult } from '../utils/json'
import { throwUserFacingError } from '../utils/user-facing-error'
import * as storyThreadService from './story-thread.service'
import * as storyFactService from './story-fact.service'
import * as endgameAssetService from './endgame-asset.service'
import * as timelineService from './timeline.service'
import * as itemService from './item.service'
import * as characterArcService from './character-arc.service'
import * as revisionTaskService from './revision-task.service'
import { resolveChapterAssetImpacts } from './asset-impact.service'

type ChapterRow = typeof chapters.$inferSelect
type NovelRow = typeof novels.$inferSelect
type CharacterRow = typeof characters.$inferSelect
type ChapterWritebackRunRow = typeof chapterWritebackRuns.$inferSelect
type ChapterFactExtractRow = typeof chapterFactExtracts.$inferSelect
type ChapterWritebackDiffRow = typeof chapterWritebackDiffs.$inferSelect

type StoryThreadRow = ReturnType<typeof listStoryThreads>[number]
type StoryFactRow = ReturnType<typeof listStoryFacts>[number]
type ForeshadowRow = ReturnType<typeof listForeshadowLedger>[number]
type TimelineRow = ReturnType<typeof listTimelineEvents>[number]
type StoryItemRow = ReturnType<typeof listStoryItems>[number]
type RelationshipArcRow = ReturnType<typeof listRelationshipArcs>[number]

type StoryThreadPatch = Parameters<typeof storyThreadService.updateStoryThread>[1]
type StoryFactPatch = Parameters<typeof storyFactService.updateStoryFact>[1]
type ForeshadowPatch = Parameters<typeof endgameAssetService.upsertForeshadowLedger>[1]
type TimelinePatch = Parameters<typeof timelineService.updateTimelineEvent>[1]
type StoryItemPatch = Parameters<typeof itemService.updateStoryItem>[1]
type RelationshipArcPatch = Parameters<typeof characterArcService.upsertRelationshipArc>[0]
type CharacterStateLike = ReturnType<typeof listLatestCharacterStates>[number]
type WorldStateLike = ReturnType<typeof listLatestWorldStates>[number]

interface DraftExtract {
  assetType: ChapterWritebackAssetType
  sourceText: string
  fact: Record<string, unknown>
  confidence: number
}

interface DraftDiff {
  assetType: ChapterWritebackAssetType
  entityType: string
  entityId: number | null
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown>
  diffReason: string
  confidence: number
}

interface ExistingAssetContext {
  chapter: ChapterRow
  novel: NovelRow | null
  characters: CharacterRow[]
  characterById: Map<number, CharacterRow>
  characterByNameKey: Map<string, CharacterRow>
  threads: StoryThreadRow[]
  threadById: Map<number, StoryThreadRow>
  threadByTitleKey: Map<string, StoryThreadRow>
  facts: StoryFactRow[]
  factById: Map<number, StoryFactRow>
  factByTitleKey: Map<string, StoryFactRow>
  foreshadows: ForeshadowRow[]
  foreshadowById: Map<number, ForeshadowRow>
  foreshadowByTitleKey: Map<string, ForeshadowRow>
  timelineEvents: TimelineRow[]
  timelineById: Map<number, TimelineRow>
  timelineByTitleKey: Map<string, TimelineRow>
  items: StoryItemRow[]
  itemById: Map<number, StoryItemRow>
  itemByTitleKey: Map<string, StoryItemRow>
  relationshipArcs: RelationshipArcRow[]
  relationshipArcById: Map<number, RelationshipArcRow>
  relationshipArcByPairKey: Map<string, RelationshipArcRow>
}

const ALL_ASSET_TYPES: ChapterWritebackAssetType[] = [
  'character',
  'world',
  'item',
  'relation',
  'thread',
  'foreshadow',
  'puzzle',
  'timeline',
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return null
}

function asPositiveNumber(value: unknown): number | null {
  const numeric = asNumber(value)
  return typeof numeric === 'number' && numeric > 0 ? numeric : null
}

function asBooleanNumber(value: unknown, fallback = 0): 0 | 1 {
  if (typeof value === 'boolean') return value ? 1 : 0
  const numeric = asNumber(value)
  if (numeric === 0 || numeric === 1) return numeric
  return fallback === 1 ? 1 : 0
}

function asConfidence(value: unknown, fallback = 0.72): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.max(0, Math.min(1, Number(value)))
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseJsonNumberArray(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => asPositiveNumber(entry)).filter((entry): entry is number => typeof entry === 'number')
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseJsonNumberArray(JSON.parse(raw) as unknown)
    } catch {
      return []
    }
  }
  return []
}

function parseJsonStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => asText(entry)).filter(Boolean)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseJsonStringArray(JSON.parse(raw) as unknown)
    } catch {
      return []
    }
  }
  return []
}

function parseStoryFactKnowledge(raw: unknown): Array<{ characterId: number; knownChapterId: number | null }> {
  const parsed = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' && raw.trim()
      ? (() => {
        try {
          return JSON.parse(raw) as unknown
        } catch {
          return []
        }
      })()
      : [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((entry) => {
      if (!isRecord(entry)) return null
      const characterId = asPositiveNumber(entry.characterId)
      if (!characterId) return null
      return {
        characterId,
        knownChapterId: asPositiveNumber(entry.knownChapterId),
      }
    })
    .filter((entry): entry is { characterId: number; knownChapterId: number | null } => Boolean(entry))
}

function toNumberJson(values: number[]): string {
  return JSON.stringify([...new Set(values.filter((value) => Number.isFinite(value) && value > 0))])
}

function toStringJson(values: string[]): string {
  return JSON.stringify(values.filter(Boolean))
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value)
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trim()}…`
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function pairKey(charAId: number, charBId: number): string {
  return charAId <= charBId ? `${charAId}:${charBId}` : `${charBId}:${charAId}`
}

function normalizeAssetType(value: unknown): ChapterWritebackAssetType | null {
  const text = asText(value)
  return ALL_ASSET_TYPES.includes(text as ChapterWritebackAssetType) ? text as ChapterWritebackAssetType : null
}

function normalizeDecision(value: unknown): ChapterWritebackDecision {
  const text = asText(value)
  if (text === 'accepted' || text === 'rejected' || text === 'edited') return text
  return 'pending'
}

function deriveVerificationStatus(confidence: unknown, hint?: string | null): WritebackVerificationStatus {
  const normalized = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0
  const reason = asText(hint).toLowerCase()
  if (/(冲突|矛盾|不一致|conflict|contradict)/.test(reason)) return 'conflicted'
  if (normalized >= 0.82) return 'auto_ready'
  if (normalized >= 0.58) return 'needs_review'
  return 'conflicted'
}

function verificationTaskIssueKey(runId: number, diffId: number): string {
  return `chapter-writeback-review:${runId}:${diffId}`
}

function resolveVerificationTask(runId: number, diffId: number): void {
  const db = getDb()
  const task = db.select().from(revisionTasks).where(eq(revisionTasks.issueKey, verificationTaskIssueKey(runId, diffId))).all()[0]
  if (!task || task.status === 'resolved') return
  db.update(revisionTasks).set({
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(revisionTasks.id, task.id)).run()
}

function mapRunRow(row: ChapterWritebackRunRow): AppChapterWritebackRun {
  return {
    id: row.id,
    novelId: row.novelId,
    chapterId: row.chapterId,
    status: row.status as AppChapterWritebackRun['status'],
    triggerSource: row.triggerSource,
    summaryText: row.summaryText,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function mapExtractRow(row: ChapterFactExtractRow): AppChapterFactExtract {
  return {
    id: row.id,
    runId: row.runId,
    assetType: row.assetType as ChapterWritebackAssetType,
    sourceText: row.sourceText,
    factJson: row.factJson,
    confidence: row.confidence,
    verificationStatus: (asText(row.verificationStatus) || deriveVerificationStatus(row.confidence, row.sourceText)) as WritebackVerificationStatus,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function mapDiffRow(row: ChapterWritebackDiffRow): AppChapterWritebackDiff {
  return {
    id: row.id,
    runId: row.runId,
    assetType: row.assetType as ChapterWritebackAssetType,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeStateJson: row.beforeStateJson,
    afterStateJson: row.afterStateJson,
    diffReason: row.diffReason,
    confidence: row.confidence,
    verificationStatus: (asText(row.verificationStatus) || deriveVerificationStatus(row.confidence, row.diffReason)) as WritebackVerificationStatus,
    canonDecision: normalizeDecision(row.canonDecision),
    writebackStatus: (asText(row.writebackStatus) || 'pending') as AppChapterWritebackDiff['writebackStatus'],
    writebackError: row.writebackError,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function buildCoverage(
  extracts: AppChapterFactExtract[],
  diffs: AppChapterWritebackDiff[],
): ChapterWritebackCoverageItem[] {
  return ALL_ASSET_TYPES.map((assetType) => {
    const assetExtracts = extracts.filter((item) => item.assetType === assetType)
    const assetDiffs = diffs.filter((item) => item.assetType === assetType)
    return {
      assetType,
      extractCount: assetExtracts.length,
      diffCount: assetDiffs.length,
      acceptedCount: assetDiffs.filter((item) => item.canonDecision === 'accepted').length,
      rejectedCount: assetDiffs.filter((item) => item.canonDecision === 'rejected').length,
      editedCount: assetDiffs.filter((item) => item.canonDecision === 'edited').length,
      appliedCount: assetDiffs.filter((item) => item.writebackStatus === 'applied').length,
      failedCount: assetDiffs.filter((item) => item.writebackStatus === 'failed').length,
      pendingCount: assetDiffs.filter((item) => item.canonDecision === 'pending').length,
    }
  })
}

function getChapterRow(chapterId: number): ChapterRow {
  const row = getDb().select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!row) throwUserFacingError('chapter.notFound')
  return row
}

function getRunRow(runId: number): ChapterWritebackRunRow {
  const row = getDb().select().from(chapterWritebackRuns).where(eq(chapterWritebackRuns.id, runId)).all()[0]
  if (!row) throwUserFacingError('common.notFound')
  return row
}

function buildExistingAssetContext(chapter: ChapterRow): ExistingAssetContext {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0] || null
  const characterRows = db.select().from(characters).where(eq(characters.novelId, chapter.novelId)).all()
  const characterByNameKey = new Map<string, CharacterRow>()
  characterRows.forEach((row) => {
    const key = normalizeKey(row.fullName)
    if (key && !characterByNameKey.has(key)) characterByNameKey.set(key, row)
  })

  const threads = listStoryThreads(chapter.novelId)
  const facts = listStoryFacts(chapter.novelId)
  const foreshadows = listForeshadowLedger(chapter.novelId)
  const timelineEvents = listTimelineEvents(chapter.novelId)
  const items = listStoryItems(chapter.novelId)
  const relationshipArcs = listRelationshipArcs(chapter.novelId)

  return {
    chapter,
    novel,
    characters: characterRows,
    characterById: new Map(characterRows.map((row) => [row.id, row] as const)),
    characterByNameKey,
    threads,
    threadById: new Map(threads.map((row) => [row.id, row] as const)),
    threadByTitleKey: new Map(threads.map((row) => [normalizeKey(row.title), row] as const)),
    facts,
    factById: new Map(facts.map((row) => [row.id, row] as const)),
    factByTitleKey: new Map(facts.map((row) => [normalizeKey(row.title), row] as const)),
    foreshadows,
    foreshadowById: new Map(foreshadows.map((row) => [row.id, row] as const)),
    foreshadowByTitleKey: new Map(foreshadows.map((row) => [normalizeKey(row.title), row] as const)),
    timelineEvents,
    timelineById: new Map(timelineEvents.map((row) => [row.id, row] as const)),
    timelineByTitleKey: new Map(timelineEvents.map((row) => [normalizeKey(row.eventTitle), row] as const)),
    items,
    itemById: new Map(items.map((row) => [row.id, row] as const)),
    itemByTitleKey: new Map(items.map((row) => [normalizeKey(row.itemName), row] as const)),
    relationshipArcs,
    relationshipArcById: new Map(relationshipArcs.filter((row) => typeof row.id === 'number').map((row) => [row.id as number, row] as const)),
    relationshipArcByPairKey: new Map(relationshipArcs.map((row) => [pairKey(row.charAId, row.charBId), row] as const)),
  }
}

function buildCharacterStateRecord(state: CharacterStateLike): Record<string, unknown> {
  return {
    characterId: state.characterId,
    characterName: state.characterName,
    chapterId: state.chapterId,
    chapterNum: state.chapterNum,
    injuryState: state.injuryState || '',
    resourceState: state.resourceState || '',
    stanceState: state.stanceState || '',
    mentalState: state.mentalState || '',
    relationshipHeatSummary: state.relationshipHeatSummary || '',
    goalState: state.goalState || '',
    eventCause: state.eventCause || '',
    changeReason: state.changeReason || '',
    summaryText: state.summaryText || '',
    triggerEventId: state.triggerEventId || null,
    sourceSegmentId: state.sourceSegmentId || null,
    stateDeltaJson: state.stateDeltaJson || null,
  }
}

function buildWorldStateRecord(state: WorldStateLike): Record<string, unknown> {
  return {
    entityType: state.entityType,
    entityId: state.entityId,
    entityName: state.entityName,
    chapterId: state.chapterId,
    chapterNum: state.chapterNum,
    summaryText: state.summaryText,
    stateItems: state.stateItems,
    eventCause: state.eventCause || '',
    changeReason: state.changeReason || '',
    severity: state.severity,
    triggerEventId: state.triggerEventId || null,
    sourceSegmentId: state.sourceSegmentId || null,
    stateDeltaJson: state.stateDeltaJson || null,
  }
}

function buildDeterministicStateDraft(chapter: ChapterRow): { extracts: DraftExtract[]; diffs: DraftDiff[] } {
  const extracts: DraftExtract[] = []
  const diffs: DraftDiff[] = []

  const currentCharacterStates = listLatestCharacterStates(chapter.novelId, {
    upToChapterNum: chapter.chapterNum,
    limit: 1000,
  }).filter((item) => item.chapterId === chapter.id)
  const previousCharacterStates = new Map(
    listLatestCharacterStates(chapter.novelId, {
      upToChapterNum: Math.max((chapter.chapterNum || 0) - 1, 0),
      limit: 1000,
    }).map((item) => [item.characterId, item] as const),
  )

  currentCharacterStates.forEach((state) => {
    const afterState = buildCharacterStateRecord(state)
    const previous = previousCharacterStates.get(state.characterId)
    const beforeState = previous ? buildCharacterStateRecord(previous) : null
    if (beforeState && safeStringify(beforeState) === safeStringify(afterState)) return

    extracts.push({
      assetType: 'character',
      sourceText: clipText([state.summaryText, state.changeReason, state.eventCause].filter(Boolean).join(' | '), 160),
      fact: {
        title: state.characterName,
        summary: state.summaryText,
        changeReason: state.changeReason,
        eventCause: state.eventCause,
      },
      confidence: 0.9,
    })
    diffs.push({
      assetType: 'character',
      entityType: 'character-state',
      entityId: state.characterId,
      beforeState,
      afterState,
      diffReason: [state.changeReason, state.eventCause, state.summaryText].filter(Boolean).join('；') || `${state.characterName} 在本章发生状态变化`,
      confidence: 0.9,
    })
  })

  const currentWorldStates = listLatestWorldStates(chapter.novelId, {
    upToChapterNum: chapter.chapterNum,
    limit: 1000,
  }).filter((item) => item.chapterId === chapter.id)
    .filter((item) => item.entityType === 'faction' || item.entityType === 'location')
  const previousWorldStates = new Map(
    listLatestWorldStates(chapter.novelId, {
      upToChapterNum: Math.max((chapter.chapterNum || 0) - 1, 0),
      limit: 1000,
    })
      .filter((item) => item.entityType === 'faction' || item.entityType === 'location')
      .map((item) => [`${item.entityType}:${item.entityId}`, item] as const),
  )

  currentWorldStates.forEach((state) => {
    const afterState = buildWorldStateRecord(state)
    const previous = previousWorldStates.get(`${state.entityType}:${state.entityId}`)
    const beforeState = previous ? buildWorldStateRecord(previous) : null
    if (beforeState && safeStringify(beforeState) === safeStringify(afterState)) return

    extracts.push({
      assetType: 'world',
      sourceText: clipText([state.summaryText, state.changeReason, state.eventCause].filter(Boolean).join(' | '), 160),
      fact: {
        title: state.entityName,
        summary: state.summaryText,
        entityType: state.entityType,
      },
      confidence: 0.86,
    })
    diffs.push({
      assetType: 'world',
      entityType: 'world-state',
      entityId: state.entityId,
      beforeState,
      afterState,
      diffReason: [state.changeReason, state.eventCause, state.summaryText].filter(Boolean).join('；') || `${state.entityName} 在本章发生世界状态变化`,
      confidence: 0.86,
    })
  })

  return { extracts, diffs }
}

function buildWritebackPrompt(context: ExistingAssetContext): string {
  const chapter = context.chapter
  const chapterLabel = `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim()
  const currentCharacterStates = listLatestCharacterStates(chapter.novelId, {
    upToChapterNum: chapter.chapterNum,
    limit: 24,
  }).filter((item) => item.chapterId === chapter.id)
  const currentWorldStates = listLatestWorldStates(chapter.novelId, {
    upToChapterNum: chapter.chapterNum,
    limit: 24,
  }).filter((item) => item.chapterId === chapter.id)

  return [
    '你是小说 Canonizer。',
    '只抽取本章正文里已经明确发生、明确揭示、或明确埋下的事实；不要凭空补设定。',
    '输出必须是 JSON object，禁止解释文字。',
    'JSON 结构：{"extracts":[],"diffs":[]}',
    'extracts 项字段：assetType, sourceText, confidence, fact。',
    'diffs 项字段：assetType, entityType, entityId, diffReason, confidence, afterState。',
    'assetType 只能用：character, world, item, relation, thread, foreshadow, puzzle, timeline。',
    'entityType 只能用：character-state, world-state, story-item, relationship-arc, story-thread, foreshadow-ledger, story-fact, timeline-event。',
    '最多输出 24 条 diffs，没有明确候选就不输出。',
    `小说：${context.novel?.title || '未命名小说'}`,
    `章节：${chapterLabel}`,
    `章节摘要：${chapter.summary || ''}`,
    `下一章种子：${chapter.nextChapterSeed || ''}`,
    `本章人物状态：${JSON.stringify(currentCharacterStates.map((item) => ({ characterId: item.characterId, characterName: item.characterName, summaryText: item.summaryText })))}`,
    `本章世界状态：${JSON.stringify(currentWorldStates.map((item) => ({ entityType: item.entityType, entityId: item.entityId, entityName: item.entityName, summaryText: item.summaryText })))}`,
    `现有角色：${JSON.stringify(context.characters.map((item) => ({ id: item.id, name: item.fullName })))}`,
    `现有线程：${JSON.stringify(context.threads.slice(0, 40).map((item) => ({ id: item.id, title: item.title, status: item.status, currentState: item.currentState })))}`,
    `现有伏笔：${JSON.stringify(context.foreshadows.slice(0, 40).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      targetPayoffChapter: item.targetPayoffChapter,
      payoffSceneAction: item.payoffSceneAction,
      requiredEvidence: item.requiredEvidence,
      readerVisibleOutcome: item.readerVisibleOutcome,
      allowedDelayReason: item.allowedDelayReason,
    })))}`,
    `现有谜题/信息点：${JSON.stringify(context.facts.slice(0, 40).map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status })))}`,
    `现有时间轴：${JSON.stringify(context.timelineEvents.slice(0, 40).map((item) => ({ id: item.id, eventTitle: item.eventTitle, timeLabel: item.timeLabel, status: item.status })))}`,
    `现有物品：${JSON.stringify(context.items.slice(0, 40).map((item) => ({ id: item.id, itemName: item.itemName, status: item.status, ownerCharacterId: item.ownerCharacterId })))}`,
    `现有关系统弧：${JSON.stringify(context.relationshipArcs.slice(0, 40).map((item) => ({ id: item.id, charAId: item.charAId, charBId: item.charBId, charAName: item.charAName, charBName: item.charBName, currentStatus: item.currentStatus })))}`,
    '章节正文：',
    clipText(chapter.content || '', 12000),
  ].join('\n')
}

function sanitizeAiExtracts(raw: unknown): DraftExtract[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const assetType = normalizeAssetType(entry.assetType)
    const fact = isRecord(entry.fact) ? entry.fact : null
    if (!assetType || !fact) return []
    return [{
      assetType,
      sourceText: clipText(asText(entry.sourceText), 180),
      fact,
      confidence: asConfidence(entry.confidence, 0.72),
    }]
  })
}

function resolveCharacterId(raw: unknown, context: ExistingAssetContext): number | null {
  const numeric = asPositiveNumber(raw)
  if (numeric && context.characterById.has(numeric)) return numeric
  const text = asText(raw)
  if (!text) return null
  return context.characterByNameKey.get(normalizeKey(text))?.id || null
}

function sanitizeAiThreadState(afterState: Record<string, unknown>, chapter: ChapterRow): StoryThreadPatch | null {
  const title = asText(afterState.title)
  if (!title) return null
  return {
    title,
    threadType: asText(afterState.threadType) || 'subplot',
    summary: asText(afterState.summary),
    premise: asText(afterState.premise),
    status: asText(afterState.status) || 'active',
    priority: asText(afterState.priority) || 'medium',
    startChapter: asPositiveNumber(afterState.startChapter) ?? chapter.chapterNum,
    targetPayoffChapter: asPositiveNumber(afterState.targetPayoffChapter),
    payoffCondition: asText(afterState.payoffCondition),
    currentState: asText(afterState.currentState),
    plantedChapter: asPositiveNumber(afterState.plantedChapter) ?? chapter.chapterNum,
    lastReferencedChapter: asPositiveNumber(afterState.lastReferencedChapter) ?? chapter.chapterNum,
    resolvedChapter: asPositiveNumber(afterState.resolvedChapter),
    relatedCharacterIdsJson: toNumberJson(parseJsonNumberArray(afterState.relatedCharacterIds ?? afterState.relatedCharacterIdsJson)),
    relatedItemIdsJson: toNumberJson(parseJsonNumberArray(afterState.relatedItemIds ?? afterState.relatedItemIdsJson)),
    relatedTimelineEventIdsJson: toNumberJson(parseJsonNumberArray(afterState.relatedTimelineEventIds ?? afterState.relatedTimelineEventIdsJson)),
    notes: asText(afterState.notes),
  }
}

function sanitizeAiForeshadowState(afterState: Record<string, unknown>, chapter: ChapterRow, context: ExistingAssetContext): ForeshadowPatch | null {
  const title = asText(afterState.title)
  if (!title) return null
  const linkedThreadId = asPositiveNumber(afterState.linkedThreadId)
    || context.threadByTitleKey.get(normalizeKey(asText(afterState.linkedThreadTitle)))?.id
    || null
  return {
    title,
    detail: asText(afterState.detail),
    sourceChapterId: asPositiveNumber(afterState.sourceChapterId) ?? chapter.id,
    sourceSegmentId: asPositiveNumber(afterState.sourceSegmentId),
    plantMethod: asText(afterState.plantMethod),
    salienceLevel: asText(afterState.salienceLevel) || 'medium',
    targetPayoffChapter: asPositiveNumber(afterState.targetPayoffChapter),
    payoffMethod: asText(afterState.payoffMethod),
    payoffSceneAction: asText(afterState.payoffSceneAction),
    requiredEvidence: asText(afterState.requiredEvidence),
    readerVisibleOutcome: asText(afterState.readerVisibleOutcome),
    allowedDelayReason: asText(afterState.allowedDelayReason),
    impactScope: asText(afterState.impactScope) || 'global',
    status: asText(afterState.status) || 'draft',
    linkedThreadId,
    linkedVolumeId: asPositiveNumber(afterState.linkedVolumeId) ?? chapter.volumeId ?? null,
  }
}

function sanitizeAiFactState(afterState: Record<string, unknown>, chapter: ChapterRow): StoryFactPatch | null {
  const title = asText(afterState.title)
  if (!title) return null
  return {
    kind: (asText(afterState.kind) || 'clue') as StoryFactPatch['kind'],
    title,
    summary: asText(afterState.summary),
    status: (asText(afterState.status) || 'introduced') as StoryFactPatch['status'],
    volumeId: asPositiveNumber(afterState.volumeId) ?? chapter.volumeId ?? null,
    relatedPuzzleId: asPositiveNumber(afterState.relatedPuzzleId),
    readerKnownChapterId: asPositiveNumber(afterState.readerKnownChapterId) ?? chapter.id,
    protagonistKnownChapterId: asPositiveNumber(afterState.protagonistKnownChapterId),
    characterKnowledgeJson: parseStoryFactKnowledge(afterState.characterKnowledge ?? afterState.characterKnowledgeJson),
    plannedRevealVolume: asPositiveNumber(afterState.plannedRevealVolume),
    targetRevealChapterId: asPositiveNumber(afterState.targetRevealChapterId),
    isKeyTruth: asBooleanNumber(afterState.isKeyTruth, 1),
    notes: asText(afterState.notes),
  }
}

function sanitizeAiTimelineState(afterState: Record<string, unknown>, chapter: ChapterRow): TimelinePatch | null {
  const eventTitle = asText(afterState.eventTitle || afterState.title)
  if (!eventTitle) return null
  return {
    eventTitle,
    eventSummary: asText(afterState.eventSummary || afterState.summary),
    timeMode: asText(afterState.timeMode) || 'custom-era',
    timeLabel: asText(afterState.timeLabel) || `第${chapter.chapterNum}章`,
    timeSortValue: asPositiveNumber(afterState.timeSortValue) ?? chapter.chapterNum,
    eventType: asText(afterState.eventType),
    chapterStartId: asPositiveNumber(afterState.chapterStartId) ?? chapter.id,
    chapterEndId: asPositiveNumber(afterState.chapterEndId) ?? chapter.id,
    segmentId: asPositiveNumber(afterState.segmentId),
    presentCharacterIdsJson: toNumberJson(parseJsonNumberArray(afterState.presentCharacterIds ?? afterState.presentCharacterIdsJson)),
    affectedCharacterIdsJson: toNumberJson(parseJsonNumberArray(afterState.affectedCharacterIds ?? afterState.affectedCharacterIdsJson)),
    protagonistPresent: asBooleanNumber(afterState.protagonistPresent, 1),
    protagonistAction: asText(afterState.protagonistAction),
    eventCause: asText(afterState.eventCause),
    eventProcess: asText(afterState.eventProcess),
    eventResult: asText(afterState.eventResult),
    linkedItemIdsJson: toNumberJson(parseJsonNumberArray(afterState.linkedItemIds ?? afterState.linkedItemIdsJson)),
    directConsequencesJson: toStringJson(parseJsonStringArray(afterState.directConsequences ?? afterState.directConsequencesJson)),
    openThreadsJson: toStringJson(parseJsonStringArray(afterState.openThreads ?? afterState.openThreadsJson)),
    status: asText(afterState.status) || 'written',
    notes: asText(afterState.notes),
  }
}

function sanitizeAiItemState(afterState: Record<string, unknown>, chapter: ChapterRow, context: ExistingAssetContext): StoryItemPatch | null {
  const itemName = asText(afterState.itemName || afterState.title)
  if (!itemName) return null
  return {
    itemName,
    itemKind: asText(afterState.itemKind) || 'instance',
    parentItemId: asPositiveNumber(afterState.parentItemId),
    category: asText(afterState.category),
    subType: asText(afterState.subType),
    rarity: asText(afterState.rarity),
    recordStatus: asText(afterState.recordStatus) || 'confirmed',
    ownerCharacterId: resolveCharacterId(afterState.ownerCharacterId ?? afterState.ownerCharacterName, context),
    locationMapId: asPositiveNumber(afterState.locationMapId),
    status: asText(afterState.status) || 'available',
    summary: asText(afterState.summary),
    acquisitionMethod: asText(afterState.acquisitionMethod),
    usageMethod: asText(afterState.usageMethod),
    cost: asText(afterState.cost),
    risk: asText(afterState.risk),
    plotFunction: asText(afterState.plotFunction),
    appearance: asText(afterState.appearance),
    factionHint: asText(afterState.factionHint),
    linkedCharacterIdsJson: toNumberJson(parseJsonNumberArray(afterState.linkedCharacterIds ?? afterState.linkedCharacterIdsJson)),
    linkedTimelineEventIdsJson: toNumberJson(parseJsonNumberArray(afterState.linkedTimelineEventIds ?? afterState.linkedTimelineEventIdsJson)),
    tagsJson: toStringJson(parseJsonStringArray(afterState.tags ?? afterState.tagsJson)),
    sourceContextJson: safeStringify([{ page: 'writeback-center', label: `第${chapter.chapterNum}章`, detectedAt: new Date().toISOString() }]),
  }
}

function sanitizeAiRelationshipState(afterState: Record<string, unknown>, chapter: ChapterRow, context: ExistingAssetContext): RelationshipArcPatch | null {
  const charAId = resolveCharacterId(afterState.charAId ?? afterState.charAName, context)
  const charBId = resolveCharacterId(afterState.charBId ?? afterState.charBName, context)
  if (!charAId || !charBId || charAId === charBId) return null
  return {
    id: asPositiveNumber(afterState.id) ?? undefined,
    novelId: chapter.novelId,
    charAId,
    charBId,
    relationLabelSnapshot: asText(afterState.relationLabelSnapshot),
    relationTypeSnapshot: asText(afterState.relationTypeSnapshot),
    startState: asText(afterState.startState),
    crackPoint: asText(afterState.crackPoint),
    changeEvent: asText(afterState.changeEvent),
    changeTimelineEventId: asPositiveNumber(afterState.changeTimelineEventId) ?? undefined,
    endState: asText(afterState.endState),
    currentStatus: (asText(afterState.currentStatus) || 'active') as RelationshipArcPatch['currentStatus'],
    lastProgressChapterId: asPositiveNumber(afterState.lastProgressChapterId) ?? chapter.id,
    stalledReason: asText(afterState.stalledReason),
    notes: asText(afterState.notes),
  }
}

function readExistingEntityState(assetType: ChapterWritebackAssetType, entityId: number, context: ExistingAssetContext): Record<string, unknown> | null {
  switch (assetType) {
    case 'thread':
      return context.threadById.get(entityId) || null
    case 'foreshadow':
      return context.foreshadowById.get(entityId) || null
    case 'puzzle':
      return context.factById.get(entityId) || null
    case 'timeline':
      return context.timelineById.get(entityId) || null
    case 'item':
      return context.itemById.get(entityId) || null
    case 'relation':
      return (context.relationshipArcById.get(entityId) || null) as unknown as Record<string, unknown> | null
    default:
      return null
  }
}

function resolveExistingEntityId(assetType: ChapterWritebackAssetType, afterState: Record<string, unknown>, context: ExistingAssetContext): number | null {
  const directId = asPositiveNumber(afterState.id) || asPositiveNumber(afterState.entityId)
  if (directId) return directId
  switch (assetType) {
    case 'thread':
      return context.threadByTitleKey.get(normalizeKey(asText(afterState.title)))?.id || null
    case 'foreshadow':
      return context.foreshadowByTitleKey.get(normalizeKey(asText(afterState.title)))?.id || null
    case 'puzzle':
      return context.factByTitleKey.get(normalizeKey(asText(afterState.title)))?.id || null
    case 'timeline':
      return context.timelineByTitleKey.get(normalizeKey(asText(afterState.eventTitle || afterState.title)))?.id || null
    case 'item':
      return context.itemByTitleKey.get(normalizeKey(asText(afterState.itemName || afterState.title)))?.id || null
    case 'relation': {
      const charAId = resolveCharacterId(afterState.charAId ?? afterState.charAName, context)
      const charBId = resolveCharacterId(afterState.charBId ?? afterState.charBName, context)
      if (!charAId || !charBId) return null
      return context.relationshipArcByPairKey.get(pairKey(charAId, charBId))?.id || null
    }
    default:
      return null
  }
}

function sanitizeAiDiffs(raw: unknown, context: ExistingAssetContext): DraftDiff[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const assetType = normalizeAssetType(entry.assetType)
    const rawAfterState = isRecord(entry.afterState) ? entry.afterState : null
    if (!assetType || !rawAfterState) return []

    let afterState: Record<string, unknown> | null = rawAfterState
    if (assetType === 'thread') afterState = sanitizeAiThreadState(rawAfterState, context.chapter) as unknown as Record<string, unknown> | null
    if (assetType === 'foreshadow') afterState = sanitizeAiForeshadowState(rawAfterState, context.chapter, context) as unknown as Record<string, unknown> | null
    if (assetType === 'puzzle') afterState = sanitizeAiFactState(rawAfterState, context.chapter) as unknown as Record<string, unknown> | null
    if (assetType === 'timeline') afterState = sanitizeAiTimelineState(rawAfterState, context.chapter) as unknown as Record<string, unknown> | null
    if (assetType === 'item') afterState = sanitizeAiItemState(rawAfterState, context.chapter, context) as unknown as Record<string, unknown> | null
    if (assetType === 'relation') afterState = sanitizeAiRelationshipState(rawAfterState, context.chapter, context) as unknown as Record<string, unknown> | null
    if (!afterState) return []

    const entityId = asPositiveNumber(entry.entityId) || resolveExistingEntityId(assetType, afterState, context)
    const beforeState = entityId ? readExistingEntityState(assetType, entityId, context) : null
    return [{
      assetType,
      entityType: asText(entry.entityType) || ({
        thread: 'story-thread',
        foreshadow: 'foreshadow-ledger',
        puzzle: 'story-fact',
        timeline: 'timeline-event',
        item: 'story-item',
        relation: 'relationship-arc',
        character: 'character-state',
        world: 'world-state',
      }[assetType]),
      entityId,
      beforeState,
      afterState,
      diffReason: asText(entry.diffReason) || `${assetType} 候选需要回写`,
      confidence: asConfidence(entry.confidence, 0.72),
    }]
  })
}

async function buildAiDraft(context: ExistingAssetContext): Promise<{ extracts: DraftExtract[]; diffs: DraftDiff[] }> {
  if (!context.chapter.content?.trim()) return { extracts: [], diffs: [] }
  try {
    const result = await runChatTask({
      type: 'review',
      novelId: context.chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: context.chapter.id,
      messages: [{ role: 'user', content: buildWritebackPrompt(context) }],
      modelConfigId: context.novel?.modelConfigId || undefined,
    })
    const parsed = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'writeback',
      message: '章节回写候选 JSON 解析失败，已回退到结构化保底草案。',
      consoleSummary: `[writeback:warn] chapter-writeback-json chapter=${context.chapter.id}`,
      context: { chapterId: context.chapter.id, novelId: context.chapter.novelId },
    })
    if (!parsed.success || !parsed.data) return { extracts: [], diffs: [] }
    return {
      extracts: sanitizeAiExtracts(parsed.data.extracts),
      diffs: sanitizeAiDiffs(parsed.data.diffs, context),
    }
  } catch {
    return { extracts: [], diffs: [] }
  }
}

function diffKey(diff: DraftDiff): string {
  if (typeof diff.entityId === 'number' && diff.entityId > 0) return `${diff.assetType}:${diff.entityType}:${diff.entityId}`
  return `${diff.assetType}:${diff.entityType}:${normalizeKey(safeStringify(diff.afterState))}`
}

function extractKey(extract: DraftExtract): string {
  const factKey = asText(extract.fact.title || extract.fact.itemName || extract.fact.eventTitle || extract.fact.summary)
  return `${extract.assetType}:${normalizeKey(factKey)}:${normalizeKey(extract.sourceText)}`
}

function dedupeExtracts(items: DraftExtract[]): DraftExtract[] {
  const map = new Map<string, DraftExtract>()
  items.forEach((item) => {
    const key = extractKey(item)
    const current = map.get(key)
    if (!current || current.confidence < item.confidence) map.set(key, item)
  })
  return [...map.values()]
}

function dedupeDiffs(items: DraftDiff[]): DraftDiff[] {
  const map = new Map<string, DraftDiff>()
  items.forEach((item) => {
    const key = diffKey(item)
    const current = map.get(key)
    if (!current || current.confidence < item.confidence) map.set(key, item)
  })
  return [...map.values()]
}

function loadRunRowsByChapter(chapterId: number): ChapterWritebackRunRow[] {
  return getDb().select().from(chapterWritebackRuns).where(eq(chapterWritebackRuns.chapterId, chapterId)).orderBy(desc(chapterWritebackRuns.id)).all()
}

function loadExtractRows(runId: number): ChapterFactExtractRow[] {
  return getDb().select().from(chapterFactExtracts).where(eq(chapterFactExtracts.runId, runId)).orderBy(chapterFactExtracts.sortOrder, chapterFactExtracts.id).all()
}

function loadDiffRows(runId: number): ChapterWritebackDiffRow[] {
  return getDb().select().from(chapterWritebackDiffs).where(eq(chapterWritebackDiffs.runId, runId)).orderBy(chapterWritebackDiffs.sortOrder, chapterWritebackDiffs.id).all()
}

function buildRunSummaryText(extracts: ChapterFactExtractRow[], diffs: ChapterWritebackDiffRow[]): string {
  const acceptedCount = diffs.filter((item) => item.canonDecision === 'accepted' || item.canonDecision === 'edited').length
  const appliedCount = diffs.filter((item) => item.writebackStatus === 'applied').length
  const failedCount = diffs.filter((item) => item.writebackStatus === 'failed').length
  return `${extracts.length} 条事实抽取 · ${diffs.length} 条候选 · 已确认 ${acceptedCount} 条 · 已写回 ${appliedCount} 条${failedCount > 0 ? ` · 失败 ${failedCount} 条` : ''}`
}

function refreshRunSummary(runId: number): void {
  getDb().update(chapterWritebackRuns).set({
    summaryText: buildRunSummaryText(loadExtractRows(runId), loadDiffRows(runId)),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterWritebackRuns.id, runId)).run()
}

function parseAfterState(row: ChapterWritebackDiffRow): Record<string, unknown> {
  const parsed = parseJsonObject(row.afterStateJson)
  if (!parsed) throwUserFacingError('chapterWriteback.afterStateJsonParseFailed')
  return parsed
}

function resolveDiffTitle(diff: DraftDiff | AppChapterWritebackDiff): string {
  const afterState = 'afterState' in diff ? diff.afterState : parseJsonObject(diff.afterStateJson)
  if (!afterState) return `${diff.assetType} 候选`
  return (
    asText(afterState.title)
    || asText(afterState.itemName)
    || asText(afterState.eventTitle)
    || asText(afterState.entityName)
    || `${diff.assetType} 候选`
  )
}

function applyThreadDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  const context = buildExistingAssetContext(chapter)
  const afterState = sanitizeAiThreadState(parseAfterState(row), chapter)
  if (!afterState) throwUserFacingError('chapterWriteback.threadCandidateTitleMissing')
  const targetId = row.entityId || resolveExistingEntityId('thread', afterState as unknown as Record<string, unknown>, context)
  if (targetId) {
    storyThreadService.updateStoryThread(targetId, afterState)
    return targetId
  }
  return storyThreadService.createStoryThread(chapter.novelId, afterState)
}

function applyForeshadowDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  const context = buildExistingAssetContext(chapter)
  const afterState = sanitizeAiForeshadowState(parseAfterState(row), chapter, context)
  if (!afterState) throwUserFacingError('chapterWriteback.foreshadowCandidateTitleMissing')
  const payload: ForeshadowPatch = {
    id: row.entityId || asPositiveNumber(parseAfterState(row).id) || undefined,
    ...afterState,
  }
  const rows = endgameAssetService.upsertForeshadowLedger(chapter.novelId, payload)
  return payload.id || rows.find((item) => normalizeKey(item.title) === normalizeKey(payload.title || ''))?.id || null
}

function applyFactDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  const afterState = sanitizeAiFactState(parseAfterState(row), chapter)
  if (!afterState) throwUserFacingError('chapterWriteback.infoGapCandidateTitleMissing')
  if (row.entityId) {
    storyFactService.updateStoryFact(row.entityId, afterState)
    return row.entityId
  }
  return storyFactService.createStoryFact(chapter.novelId, afterState)
}

function applyTimelineDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  const afterState = sanitizeAiTimelineState(parseAfterState(row), chapter)
  if (!afterState) throwUserFacingError('chapterWriteback.timelineCandidateEventTitleMissing')
  if (row.entityId) {
    timelineService.updateTimelineEvent(row.entityId, afterState)
    return row.entityId
  }
  return timelineService.createTimelineEvent(chapter.novelId, afterState)
}

function applyItemDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  const context = buildExistingAssetContext(chapter)
  const afterState = sanitizeAiItemState(parseAfterState(row), chapter, context)
  if (!afterState) throwUserFacingError('chapterWriteback.itemCandidateNameMissing')
  if (row.entityId) {
    itemService.updateStoryItem(row.entityId, afterState)
    return row.entityId
  }
  return itemService.createStoryItem(chapter.novelId, afterState)
}

function applyRelationshipDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  const context = buildExistingAssetContext(chapter)
  const afterState = sanitizeAiRelationshipState(parseAfterState(row), chapter, context)
  if (!afterState) throwUserFacingError('chapterWriteback.relationCandidatePairMissing')
  const result = characterArcService.upsertRelationshipArc({
    ...afterState,
    id: row.entityId || afterState.id,
  })
  return result.id || row.entityId || null
}

function createWritebackFailureTask(run: ChapterWritebackRunRow, diff: ChapterWritebackDiffRow, chapter: ChapterRow, error: Error): void {
  revisionTaskService.createRevisionTask(chapter.novelId, {
    taskSource: 'system',
    taskType: 'continuity',
    status: 'open',
    severity: 'medium',
    title: `章后回写失败：${resolveDiffTitle(mapDiffRow(diff))}`,
    description: [`第${chapter.chapterNum}章的 ${diff.assetType} 回写失败。`, diff.diffReason || '', error.message].filter(Boolean).join('\n'),
    relatedPage: 'writeback',
    entityType: diff.assetType,
    entityId: diff.entityId,
    chapterId: chapter.id,
    issueKey: `chapter-writeback:${run.id}:${diff.id}`,
    originMetaJson: safeStringify({ runId: run.id, diffId: diff.id, assetType: diff.assetType, entityType: diff.entityType }),
  })
}

function createWritebackVerificationTask(run: ChapterWritebackRunRow, diff: ChapterWritebackDiffRow, chapter: ChapterRow): void {
  const verificationStatus = deriveVerificationStatus(diff.confidence, diff.diffReason)
  if (verificationStatus !== 'conflicted') return
  revisionTaskService.createRevisionTask(chapter.novelId, {
    taskSource: 'system',
    taskType: 'continuity',
    status: 'open',
    severity: 'high',
    title: `章后事实冲突待确认：${resolveDiffTitle(mapDiffRow(diff))}`,
    description: [
      `第${chapter.chapterNum}章的 ${diff.assetType} 回写候选存在冲突或低置信度推断。`,
      diff.diffReason || '',
      '请先人工确认，再决定接受、编辑或拒绝。',
    ].filter(Boolean).join('\n'),
    relatedPage: 'writeback',
    entityType: diff.assetType,
    entityId: diff.entityId,
    chapterId: chapter.id,
    issueKey: verificationTaskIssueKey(run.id, diff.id),
    originMetaJson: safeStringify({
      runId: run.id,
      diffId: diff.id,
      assetType: diff.assetType,
      entityType: diff.entityType,
      verificationStatus,
    }),
  })
}

function applySingleDiff(row: ChapterWritebackDiffRow, chapter: ChapterRow): number | null {
  if (row.assetType === 'character' || row.assetType === 'world') return row.entityId || null
  if (row.assetType === 'thread') return applyThreadDiff(row, chapter)
  if (row.assetType === 'foreshadow') return applyForeshadowDiff(row, chapter)
  if (row.assetType === 'puzzle') return applyFactDiff(row, chapter)
  if (row.assetType === 'timeline') return applyTimelineDiff(row, chapter)
  if (row.assetType === 'item') return applyItemDiff(row, chapter)
  if (row.assetType === 'relation') return applyRelationshipDiff(row, chapter)
  return row.entityId || null
}

export async function prepareChapterWritebackRun(chapterId: number, triggerSource = 'manual'): Promise<AppChapterWritebackRun> {
  const db = getDb()
  const chapter = getChapterRow(chapterId)
  const now = new Date().toISOString()
  const insert = db.insert(chapterWritebackRuns).values({
    novelId: chapter.novelId,
    chapterId: chapter.id,
    status: 'draft',
    triggerSource: asText(triggerSource) || 'manual',
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run()
  const runId = Number(insert.lastInsertRowid)

  try {
    const deterministic = buildDeterministicStateDraft(chapter)
    const aiDraft = await buildAiDraft(buildExistingAssetContext(chapter))
    const extracts = dedupeExtracts([...deterministic.extracts, ...aiDraft.extracts])
    const diffs = dedupeDiffs([...deterministic.diffs, ...aiDraft.diffs]).sort((left, right) => {
      if (left.assetType !== right.assetType) return ALL_ASSET_TYPES.indexOf(left.assetType) - ALL_ASSET_TYPES.indexOf(right.assetType)
      return right.confidence - left.confidence
    })

    getSqlite().transaction(() => {
      if (extracts.length > 0) {
        db.insert(chapterFactExtracts).values(extracts.map((item, index) => ({
          runId,
          assetType: item.assetType,
          sourceText: item.sourceText,
          factJson: safeStringify(item.fact),
          confidence: item.confidence,
          verificationStatus: deriveVerificationStatus(item.confidence, item.sourceText),
          sortOrder: index + 1,
          createdAt: now,
          updatedAt: now,
        }))).run()
      }
      if (diffs.length > 0) {
        db.insert(chapterWritebackDiffs).values(diffs.map((item, index) => ({
          runId,
          assetType: item.assetType,
          entityType: item.entityType,
          entityId: item.entityId,
          beforeStateJson: item.beforeState ? safeStringify(item.beforeState) : null,
          afterStateJson: safeStringify(item.afterState),
          diffReason: item.diffReason,
          confidence: item.confidence,
          verificationStatus: deriveVerificationStatus(item.confidence, item.diffReason),
          canonDecision: 'pending',
          writebackStatus: 'pending',
          sortOrder: index + 1,
          createdAt: now,
          updatedAt: now,
        }))).run()
      }
      db.update(chapterWritebackRuns).set({
        status: 'ready',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(chapterWritebackRuns.id, runId)).run()
    })()
    refreshRunSummary(runId)
    const persistedRun = getRunRow(runId)
    loadDiffRows(runId).forEach((diff) => {
      createWritebackVerificationTask(persistedRun, diff, chapter)
    })
  } catch (error) {
    db.update(chapterWritebackRuns).set({
      status: 'failed',
      failedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : '章后回写草案生成失败',
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterWritebackRuns.id, runId)).run()
  }

  return mapRunRow(getRunRow(runId))
}

export async function listChapterWritebackRuns(chapterId: number): Promise<AppChapterWritebackRun[]> {
  getChapterRow(chapterId)
  return loadRunRowsByChapter(chapterId).map(mapRunRow)
}

export async function getChapterWritebackCenterData(chapterId: number, runId?: number): Promise<ChapterWritebackCenterData> {
  const chapter = getDb().select().from(chapters).where(eq(chapters.id, chapterId)).all()[0] || null
  const runs = loadRunRowsByChapter(chapterId)
  const activeRun = typeof runId === 'number' ? runs.find((item) => item.id === runId) || null : runs[0] || null
  const extracts = activeRun ? loadExtractRows(activeRun.id).map(mapExtractRow) : []
  const diffs = activeRun ? loadDiffRows(activeRun.id).map(mapDiffRow) : []
  return {
    chapter: chapter as unknown as AppChapter | null,
    runs: runs.map(mapRunRow),
    activeRun: activeRun ? mapRunRow(activeRun) : null,
    extracts,
    diffs,
    coverage: buildCoverage(extracts, diffs),
  }
}

export async function updateChapterWritebackDecision(
  diffId: number,
  patch: { canonDecision?: ChapterWritebackDecision; afterStateJson?: string; diffReason?: string },
): Promise<AppChapterWritebackDiff> {
  const db = getDb()
  const current = db.select().from(chapterWritebackDiffs).where(eq(chapterWritebackDiffs.id, diffId)).all()[0]
  if (!current) throwUserFacingError('common.notFound')
  let nextAfterStateJson = current.afterStateJson
  if (patch.afterStateJson !== undefined) {
    if (!parseJsonObject(patch.afterStateJson)) throwUserFacingError('chapterWriteback.afterStateJsonObjectRequired')
    nextAfterStateJson = patch.afterStateJson
  }
  db.update(chapterWritebackDiffs).set({
    canonDecision: patch.canonDecision !== undefined ? normalizeDecision(patch.canonDecision) : (patch.afterStateJson !== undefined ? 'edited' : current.canonDecision),
    afterStateJson: nextAfterStateJson,
    diffReason: patch.diffReason !== undefined ? asText(patch.diffReason) : current.diffReason,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterWritebackDiffs.id, diffId)).run()
  if (patch.canonDecision && patch.canonDecision !== 'pending') {
    resolveVerificationTask(current.runId, current.id)
  }
  refreshRunSummary(current.runId)
  const updated = getDb().select().from(chapterWritebackDiffs).where(eq(chapterWritebackDiffs.id, diffId)).all()[0]
  if (!updated) throwUserFacingError('common.notFound')
  return mapDiffRow(updated)
}

export async function bulkUpdateChapterWritebackDecisions(
  runId: number,
  patch: { canonDecision: Exclude<ChapterWritebackDecision, 'pending'>; assetType?: ChapterWritebackAssetType },
): Promise<AppChapterWritebackDiff[]> {
  const rows = loadDiffRows(getRunRow(runId).id)
    .filter((item) => !patch.assetType || item.assetType === patch.assetType)
    .filter((item) => item.writebackStatus !== 'applied')
  rows.forEach((row) => {
    getDb().update(chapterWritebackDiffs).set({
      canonDecision: patch.canonDecision,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterWritebackDiffs.id, row.id)).run()
    resolveVerificationTask(row.runId, row.id)
  })
  refreshRunSummary(runId)
  return loadDiffRows(runId).map(mapDiffRow)
}

async function executeRunApply(runId: number, retryFailedOnly = false): Promise<ChapterWritebackCenterData> {
  const db = getDb()
  const run = getRunRow(runId)
  const chapter = getChapterRow(run.chapterId)
  db.update(chapterWritebackRuns).set({
    status: 'applying',
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterWritebackRuns.id, run.id)).run()

  const targetRows = loadDiffRows(run.id).filter((row) => {
    const confirmed = row.canonDecision === 'accepted' || row.canonDecision === 'edited'
    if (!confirmed) return false
    return retryFailedOnly ? row.writebackStatus === 'failed' : row.writebackStatus !== 'applied'
  })

  if (!retryFailedOnly) {
    loadDiffRows(run.id)
      .filter((row) => row.canonDecision === 'pending' || row.canonDecision === 'rejected')
      .forEach((row) => {
        db.update(chapterWritebackDiffs).set({
          writebackStatus: 'skipped',
          writebackError: null,
          updatedAt: new Date().toISOString(),
        }).where(eq(chapterWritebackDiffs.id, row.id)).run()
      })
  }

  let appliedCount = 0
  let failedCount = 0
  targetRows.forEach((row) => {
    try {
      const entityId = applySingleDiff(row, chapter)
      db.update(chapterWritebackDiffs).set({
        entityId: entityId ?? row.entityId,
        writebackStatus: 'applied',
        writebackError: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapterWritebackDiffs.id, row.id)).run()
      appliedCount += 1
    } catch (error) {
      const rendererError = error instanceof Error ? error : new Error('写回失败')
      db.update(chapterWritebackDiffs).set({
        writebackStatus: 'failed',
        writebackError: rendererError.message,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapterWritebackDiffs.id, row.id)).run()
      createWritebackFailureTask(run, row, chapter, rendererError)
      failedCount += 1
    }
  })

  db.update(chapterWritebackRuns).set({
    status: failedCount === 0 ? 'applied' : appliedCount > 0 ? 'partially_failed' : 'failed',
    completedAt: new Date().toISOString(),
    failedAt: failedCount > 0 ? new Date().toISOString() : null,
    errorMessage: failedCount > 0 ? `共有 ${failedCount} 条回写失败` : null,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterWritebackRuns.id, run.id)).run()
  if (appliedCount > 0) {
    resolveChapterAssetImpacts(chapter.novelId, chapter.id, 'resolved')
  }
  refreshRunSummary(run.id)
  return getChapterWritebackCenterData(run.chapterId, run.id)
}

export async function applyChapterWritebackRun(runId: number): Promise<ChapterWritebackCenterData> {
  return executeRunApply(runId, false)
}

export async function retryFailedWritebackItems(runId: number): Promise<ChapterWritebackCenterData> {
  return executeRunApply(runId, true)
}
