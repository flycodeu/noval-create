import { asc, eq } from 'drizzle-orm'
import type {
  ChapterContractValidationResult,
  ContractValidationItem,
  ContractValidationVerdict,
  ThreadProgressSemanticState,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  foreshadowLedger,
  sceneContracts,
  storyThreads,
} from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { analyzeForeshadowProgress, analyzeStoryThreadProgress } from './thread-progress.service'

interface ChapterContractValidationSceneSnapshot {
  segmentId?: number
  segmentTitle: string
  sceneGoal: string
  obstacle: string
  resultState: string
}

interface ContractValidationContext {
  currentChapterNum: number
  chapterGoal: string
  hookType: string
  sceneSnapshots: ChapterContractValidationSceneSnapshot[]
  threadRows: typeof storyThreads.$inferSelect[]
  foreshadowRows: typeof foreshadowLedger.$inferSelect[]
  scenePlanHooks: string[]
}

interface ParagraphEvidence {
  excerpt: string
  score: number
  hitCount: number
}

interface ReviewSignalSnapshot {
  readerHookRisks: string[]
}

const PROGRESS_MARKERS = [
  '发现',
  '找到',
  '确认',
  '逼近',
  '推进',
  '暴露',
  '揭开',
  '得知',
  '拿到',
  '夺回',
  '追到',
  '拦下',
  '谈妥',
  '和解',
  '破裂',
  '救出',
  '抓住',
  '承认',
  '决定',
  '交换',
  '交出',
  '失去',
  '升级',
]

const CONFLICT_MARKERS = [
  '拦',
  '追',
  '逼',
  '压',
  '争',
  '抢',
  '拒',
  '阻',
  '威胁',
  '怀疑',
  '质问',
  '审问',
  '埋伏',
  '袭',
  '打',
  '伤',
  '逃',
  '躲',
  '骗',
  '失手',
  '冲突',
]

const HOOK_MARKERS = [
  '却',
  '但',
  '然而',
  '忽然',
  '突然',
  '脚步',
  '敲门',
  '消息',
  '未完',
  '还没',
  '尚未',
  '下一刻',
  '门外',
  '背后',
  '?',
  '？',
]

function normalizeText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCompactText(value?: string | null): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, '')
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function parseUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

function parseScenePlanHooks(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => normalizeText(typeof item.exit_hook === 'string' ? item.exit_hook : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function splitIntoParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function chunkParagraphs(paragraphs: string[], chunkCount: number): string[][] {
  if (chunkCount <= 0) return [paragraphs]
  if (paragraphs.length === 0) return Array.from({ length: chunkCount }, () => [])
  const size = Math.max(1, Math.ceil(paragraphs.length / chunkCount))
  return Array.from({ length: chunkCount }, (_, index) =>
    paragraphs.slice(index * size, (index + 1) * size))
}

function clipExcerpt(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function buildKeywordCandidates(...values: Array<string | null | undefined>): string[] {
  const pool = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
  const fragments = pool.flatMap((value) => value
    .split(/[，。；、,\s/：:（）()\-]+/)
    .map((item) => item.trim())
    .filter(Boolean))
  const cjkFragments = [...pool, ...fragments].flatMap((value) => {
    if (!/^[\u4e00-\u9fff]{4,18}$/.test(value)) return []
    const windows = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1) {
      windows.add(value.slice(index, index + 2))
    }
    if (value.length >= 4) {
      windows.add(value.slice(0, 4))
      windows.add(value.slice(-4))
    }
    return [...windows]
  })
  return [...new Set([
    ...pool.filter((value) => value.length >= 2 && value.length <= 18),
    ...fragments.filter((value) => value.length >= 2 && value.length <= 12),
    ...cjkFragments.filter((value) => value.length >= 2 && value.length <= 4),
  ])]
}

function countMatchedKeywords(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0
  const haystack = normalizeCompactText(text)
  return keywords.reduce((count, keyword) =>
    haystack.includes(normalizeCompactText(keyword)) ? count + 1 : count, 0)
}

function countMarkers(text: string, markers: string[]): number {
  if (!text) return 0
  const haystack = normalizeCompactText(text)
  return markers.reduce((count, marker) =>
    haystack.includes(normalizeCompactText(marker)) ? count + 1 : count, 0)
}

function findBestEvidence(
  paragraphs: string[],
  keywords: string[],
  markers: string[] = [],
): ParagraphEvidence {
  return paragraphs.reduce<ParagraphEvidence>((best, paragraph) => {
    const hitCount = countMatchedKeywords(paragraph, keywords)
    const markerCount = countMarkers(paragraph, markers)
    const score = hitCount * 10 + markerCount * 3 + Math.min(paragraph.length, 160) / 160
    if (score <= best.score) return best
    return {
      excerpt: clipExcerpt(paragraph),
      score,
      hitCount,
    }
  }, {
    excerpt: '',
    score: 0,
    hitCount: 0,
  })
}

function buildSummary(items: ContractValidationItem[]): string {
  const blockerCount = items.filter((item) => item.verdict === 'missing' || item.verdict === 'contradicted').length
  const warningCount = items.filter((item) => item.verdict === 'weak' || item.verdict === 'overdelivered').length
  if (blockerCount > 0) return `正文合同验证命中 ${blockerCount} 项阻塞，${warningCount} 项预警。`
  if (warningCount > 0) return `正文合同验证通过，但仍有 ${warningCount} 项预警。`
  return `正文合同验证已通过，共核对 ${items.length} 项。`
}

function buildStatus(items: ContractValidationItem[]): ChapterContractValidationResult['status'] {
  if (items.some((item) => item.verdict === 'missing' || item.verdict === 'contradicted')) return 'blocker'
  if (items.some((item) => item.verdict === 'weak' || item.verdict === 'overdelivered')) return 'warning'
  return 'pass'
}

function buildRewriteHints(items: ContractValidationItem[]): string[] {
  return [...new Set(items
    .filter((item) => item.verdict !== 'pass')
    .map((item) => item.rewriteHint.trim())
    .filter(Boolean))]
}

function verdictScore(verdict: ContractValidationVerdict): number {
  switch (verdict) {
    case 'pass':
      return 100
    case 'weak':
      return 65
    case 'overdelivered':
      return 55
    case 'contradicted':
      return 20
    case 'missing':
    default:
      return 15
  }
}

function makeItem(input: ContractValidationItem): ContractValidationItem {
  return {
    ...input,
    evidenceExcerpt: input.evidenceExcerpt || '',
    rewriteHint: input.rewriteHint || '',
  }
}

function normalizeContractValidationItem(raw: unknown): ContractValidationItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const verdict = normalizeText(typeof record.verdict === 'string' ? record.verdict : '') as ContractValidationVerdict
  if (!['pass', 'weak', 'missing', 'contradicted', 'overdelivered'].includes(verdict)) return null
  return {
    contractItemType: normalizeText(typeof record.contractItemType === 'string' ? record.contractItemType : ''),
    contractItemId: typeof record.contractItemId === 'number' ? record.contractItemId : undefined,
    expected: normalizeText(typeof record.expected === 'string' ? record.expected : ''),
    verdict,
    semanticState: normalizeText(typeof record.semanticState === 'string' ? record.semanticState : '') as ThreadProgressSemanticState || undefined,
    semanticReason: normalizeText(typeof record.semanticReason === 'string' ? record.semanticReason : ''),
    evidenceExcerpt: normalizeText(typeof record.evidenceExcerpt === 'string' ? record.evidenceExcerpt : ''),
    segmentId: typeof record.segmentId === 'number' ? record.segmentId : undefined,
    segmentTitle: normalizeText(typeof record.segmentTitle === 'string' ? record.segmentTitle : '') || undefined,
    rewriteHint: normalizeText(typeof record.rewriteHint === 'string' ? record.rewriteHint : ''),
  }
}

export function normalizeChapterContractValidationResult(raw: unknown): ChapterContractValidationResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const status = normalizeText(typeof record.status === 'string' ? record.status : '')
  if (!['pass', 'warning', 'blocker'].includes(status)) return null
  const itemResults = Array.isArray(record.itemResults)
    ? record.itemResults
      .map((item) => normalizeContractValidationItem(item))
      .filter((item): item is ContractValidationItem => Boolean(item))
    : []
  return {
    status: status as ChapterContractValidationResult['status'],
    summary: normalizeText(typeof record.summary === 'string' ? record.summary : ''),
    itemResults,
    rewriteHints: parseUnknownStringArray(record.rewriteHints),
  }
}

export function parseChapterContractValidationFromReviewNotes(raw?: string | null): ChapterContractValidationResult | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return normalizeChapterContractValidationResult(parsed.contract_validation)
  } catch {
    return null
  }
}

function parseReviewSignals(raw?: unknown): ReviewSignalSnapshot {
  const fallback: ReviewSignalSnapshot = {
    readerHookRisks: [],
  }
  if (!raw) return fallback
  const parsed = typeof raw === 'string'
    ? (() => {
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return null
      }
    })()
    : raw
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
  return {
    readerHookRisks: parseUnknownStringArray((parsed as Record<string, unknown>).reader_hook_risks),
  }
}

function loadValidationContext(chapterId: number): ContractValidationContext {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const chapterContractRow = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const segmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const sceneContractBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  sceneRows.forEach((row) => {
    if (typeof row.segmentId === 'number' && !sceneContractBySegmentId.has(row.segmentId)) {
      sceneContractBySegmentId.set(row.segmentId, row)
    }
  })

  const sceneSnapshots: ChapterContractValidationSceneSnapshot[] = [
    ...segmentRows.map((segment) => {
      const contract = sceneContractBySegmentId.get(segment.id) || null
      return {
        segmentId: segment.id,
        segmentTitle: normalizeText(segment.title) || `场景 ${segment.segmentOrder}`,
        sceneGoal: normalizeText(contract?.sceneGoal) || normalizeText(segment.purpose),
        obstacle: normalizeText(contract?.obstacle),
        resultState: normalizeText(contract?.resultState) || normalizeText(segment.outputState),
      }
    }),
    ...sceneRows
      .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
      .map((row) => ({
        segmentId: row.segmentId ?? undefined,
        segmentTitle: `场景合同 ${row.id}`,
        sceneGoal: normalizeText(row.sceneGoal),
        obstacle: normalizeText(row.obstacle),
        resultState: normalizeText(row.resultState),
      })),
  ]

  const servedThreadIds = parseNumberArray(chapterContractRow?.servedThreadIdsJson)
  const requiredForeshadowIds = parseNumberArray(chapterContractRow?.requiredForeshadowIdsJson)

  const threadRows = servedThreadIds.length > 0
    ? db.select().from(storyThreads).where(eq(storyThreads.novelId, chapter.novelId)).all()
      .filter((row) => servedThreadIds.includes(row.id))
    : []
  const foreshadowRows = requiredForeshadowIds.length > 0
    ? db.select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, chapter.novelId)).all()
      .filter((row) => requiredForeshadowIds.includes(row.id))
    : []

  return {
    currentChapterNum: chapter.chapterNum,
    chapterGoal: normalizeText(chapterContractRow?.chapterGoal),
    hookType: normalizeText(chapterContractRow?.hookType),
    sceneSnapshots,
    threadRows,
    foreshadowRows,
    scenePlanHooks: parseScenePlanHooks(chapter.scenePlanJson),
  }
}

function validateChapterGoal(paragraphs: string[], context: ContractValidationContext): ContractValidationItem | null {
  if (!context.chapterGoal) return null
  const keywords = buildKeywordCandidates(context.chapterGoal)
  const evidence = findBestEvidence(paragraphs, keywords, PROGRESS_MARKERS)
  const progressHits = paragraphs.reduce((count, paragraph) => count + countMarkers(paragraph, PROGRESS_MARKERS), 0)
  const verdict: ContractValidationVerdict = evidence.hitCount >= Math.max(1, Math.min(2, keywords.length))
    && progressHits > 0
    ? 'pass'
    : evidence.hitCount > 0 || progressHits > 1
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'chapter_goal',
    expected: context.chapterGoal,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : '补一段能直接兑现本章目标的关键动作、结果或关系变化，不要只保留铺垫。',
  })
}

function validateSceneConflict(
  scene: ChapterContractValidationSceneSnapshot,
  sceneParagraphs: string[],
  fallbackParagraphs: string[],
): ContractValidationItem {
  const targetParagraphs = sceneParagraphs.length > 0 ? sceneParagraphs : fallbackParagraphs
  const keywords = buildKeywordCandidates(scene.obstacle, scene.sceneGoal)
  const evidence = findBestEvidence(targetParagraphs, keywords, CONFLICT_MARKERS)
  const conflictHits = targetParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, CONFLICT_MARKERS), 0)
  const verdict: ContractValidationVerdict = evidence.hitCount >= Math.max(1, Math.min(2, keywords.length))
    && conflictHits > 0
    ? 'pass'
    : evidence.hitCount > 0 || conflictHits > 0
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'scene_conflict',
    contractItemId: scene.segmentId,
    expected: scene.obstacle || scene.sceneGoal || `${scene.segmentTitle} 需要可见冲突`,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    segmentId: scene.segmentId,
    segmentTitle: scene.segmentTitle,
    rewriteHint: verdict === 'pass'
      ? ''
      : `在“${scene.segmentTitle}”补出可见阻力，至少让角色遭遇一次明确拦截、质问、失手或代价。`,
  })
}

function validateSceneResult(
  scene: ChapterContractValidationSceneSnapshot,
  sceneParagraphs: string[],
  fallbackParagraphs: string[],
): ContractValidationItem {
  const targetParagraphs = sceneParagraphs.length > 0 ? sceneParagraphs : fallbackParagraphs
  const keywords = buildKeywordCandidates(scene.resultState)
  const evidence = findBestEvidence(targetParagraphs, keywords, PROGRESS_MARKERS)
  const verdict: ContractValidationVerdict = evidence.hitCount >= Math.max(1, Math.min(2, keywords.length))
    ? 'pass'
    : evidence.hitCount > 0
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'scene_result_state',
    contractItemId: scene.segmentId,
    expected: scene.resultState || `${scene.segmentTitle} 需要明确结果状态`,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    segmentId: scene.segmentId,
    segmentTitle: scene.segmentTitle,
    rewriteHint: verdict === 'pass'
      ? ''
      : `在“${scene.segmentTitle}”结尾补出清晰结果状态，让读者知道这场戏之后到底改变了什么。`,
  })
}

function validateThreadProgress(
  row: typeof storyThreads.$inferSelect,
  paragraphs: string[],
  currentChapterNum: number,
): ContractValidationItem {
  const semantic = analyzeStoryThreadProgress({
    title: row.title,
    currentState: row.currentState,
    payoffCondition: row.payoffCondition,
    summary: row.summary,
    targetPayoffChapter: row.targetPayoffChapter,
    currentChapterNum,
    paragraphs,
  })
  const verdict: ContractValidationVerdict = semantic.state === 'advanced' || semantic.state === 'paid_off'
    ? 'pass'
    : semantic.state === 'mentioned' || semantic.state === 'blocked'
      ? 'weak'
      : 'missing'
  const label = normalizeText(row.title) || `支线 #${row.id}`
  return makeItem({
    contractItemType: 'story_thread_progress',
    contractItemId: row.id,
    expected: label,
    verdict,
    semanticState: semantic.state,
    semanticReason: semantic.reason,
    evidenceExcerpt: semantic.evidenceExcerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : semantic.state === 'blocked'
        ? `“${label}”本章只写了受阻或延期，仍未形成真实推进。补出新的行动、发现或关系后果，或者把它移出本章必须推进项。`
        : semantic.state === 'mentioned'
          ? `“${label}”本章只提及未推进。补一个会改变局面的动作、发现或关系后果，不要只点名。`
          : semantic.state === 'stale'
            ? `“${label}”已经超期且没有有效推进。下一版必须回收、实质推进，或重设目标章位。`
            : `补上“${label}”的真实推进动作，不要让它停留在背景提及。`,
  })
}

function validateForeshadowDelivery(
  row: typeof foreshadowLedger.$inferSelect,
  paragraphs: string[],
  currentChapterNum: number,
): ContractValidationItem {
  const semantic = analyzeForeshadowProgress({
    title: row.title,
    detail: row.detail,
    plantMethod: row.plantMethod,
    payoffMethod: row.payoffMethod,
    payoffSceneAction: row.payoffSceneAction,
    requiredEvidence: row.requiredEvidence,
    readerVisibleOutcome: row.readerVisibleOutcome,
    allowedDelayReason: row.allowedDelayReason,
    targetPayoffChapter: row.targetPayoffChapter,
    currentChapterNum,
    paragraphs,
  })
  const verdict: ContractValidationVerdict = semantic.state === 'advanced' || semantic.state === 'paid_off' || semantic.state === 'blocked'
    ? 'pass'
    : semantic.state === 'mentioned'
      ? semantic.overdue ? 'missing' : 'weak'
      : 'missing'
  const label = normalizeText(row.title) || `伏笔 #${row.id}`
  const expected = [
    label,
    row.payoffSceneAction ? `动作=${normalizeText(row.payoffSceneAction)}` : '',
    row.requiredEvidence ? `证据=${normalizeText(row.requiredEvidence)}` : '',
    row.readerVisibleOutcome ? `结果=${normalizeText(row.readerVisibleOutcome)}` : '',
  ].filter(Boolean).join(' · ')
  return makeItem({
    contractItemType: 'foreshadow_delivery',
    contractItemId: row.id,
    expected: expected || label,
    verdict,
    semanticState: semantic.state,
    semanticReason: semantic.reason,
    evidenceExcerpt: semantic.evidenceExcerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : semantic.state === 'mentioned'
        ? semantic.overdue
          ? `“${label}”已经超期，但本章只提及未回收。必须兑现动作/证据/结果，或明确写出允许的延期原因。`
          : `“${label}”本章只提及未推进。补出具体回收动作、可见证据或读者可确认的结果。`
        : semantic.state === 'stale'
          ? `“${label}”已经超期且没有有效延期理由。下一版必须回收，或在账本里重设目标章位并补延期原因。`
          : `对“${label}”补一次可见处理：回收动作、证据结果，或明确延期原因。`,
  })
}

function validateChapterHook(
  paragraphs: string[],
  context: ContractValidationContext,
  reviewSignals: ReviewSignalSnapshot,
): ContractValidationItem {
  const tailParagraphs = paragraphs.slice(-Math.min(paragraphs.length, 3))
  const exitHook = context.scenePlanHooks[context.scenePlanHooks.length - 1] || ''
  const expected = exitHook || context.hookType || '章节结尾需要留下明确钩子'
  const hookKeywords = buildKeywordCandidates(exitHook, context.hookType)
  const evidence = findBestEvidence(tailParagraphs, hookKeywords, HOOK_MARKERS)
  const hookMarkerHits = tailParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, HOOK_MARKERS), 0)
  let verdict: ContractValidationVerdict = evidence.hitCount > 0 || hookMarkerHits >= 2
    ? 'pass'
    : hookMarkerHits > 0
      ? 'weak'
      : 'missing'
  if (verdict === 'pass' && reviewSignals.readerHookRisks.length > 0 && evidence.hitCount === 0) {
    verdict = 'weak'
  }
  return makeItem({
    contractItemType: 'chapter_hook',
    expected,
    verdict,
    evidenceExcerpt: evidence.excerpt || clipExcerpt(tailParagraphs.join(' ')),
    rewriteHint: verdict === 'pass'
      ? ''
      : '把章尾改成未完结的动作、悬念、威胁或新信息，不要平着收束。',
  })
}

export function validateChapterContractDelivery(input: {
  chapterId: number
  content: string
  reviewNotes?: unknown
}): ChapterContractValidationResult {
  const context = loadValidationContext(input.chapterId)
  const reviewSignals = parseReviewSignals(input.reviewNotes)
  const content = normalizeText(input.content)
  const paragraphs = splitIntoParagraphs(content)
  const sceneBuckets = chunkParagraphs(paragraphs, Math.max(context.sceneSnapshots.length, 1))
  const items: ContractValidationItem[] = []

  const goalItem = validateChapterGoal(paragraphs, context)
  if (goalItem) items.push(goalItem)

  context.sceneSnapshots.forEach((scene, index) => {
    const sceneParagraphs = sceneBuckets[index] || []
    items.push(validateSceneConflict(scene, sceneParagraphs, paragraphs))
    items.push(validateSceneResult(scene, sceneParagraphs, paragraphs))
  })

  context.threadRows.forEach((row) => {
    items.push(validateThreadProgress(row, paragraphs, context.currentChapterNum))
  })

  context.foreshadowRows.forEach((row) => {
    items.push(validateForeshadowDelivery(row, paragraphs, context.currentChapterNum))
  })

  items.push(validateChapterHook(paragraphs, context, reviewSignals))

  const summary = buildSummary(items)
  const status = buildStatus(items)
  const rewriteHints = buildRewriteHints(items)
  return {
    status,
    summary,
    itemResults: items,
    rewriteHints,
  }
}

export function getContractValidationScore(result: ChapterContractValidationResult | null | undefined): number | null {
  if (!result || result.itemResults.length === 0) return null
  const base = Math.round(result.itemResults.reduce((sum, item) => sum + verdictScore(item.verdict), 0) / result.itemResults.length)
  if (result.status === 'blocker') return Math.min(base, 49)
  if (result.status === 'warning') return Math.min(base, 79)
  return base
}
