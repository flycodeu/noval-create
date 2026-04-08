import { WebContents } from 'electron'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapterSegments, chapterVersions, chapters, novels, storyArcs } from '../database/schema'
import { parseAiJsonResult } from '../utils/json'
import { generateChapterEmbeddings } from './embedding.service'
import { aiCheckPrompt, chapterSummaryPrompt } from './prompts'
import {
  allocateChapterContext,
  buildChapterContext,
  buildStoryProfile,
  collectChapterContextRawData,
  ContinuityState,
} from './context.service'
import {
  buildChapterDraftPrompt,
  buildChapterReviewPrompt,
  buildChapterRewritePrompt,
  buildContinuityStatePrompt,
  buildScenePlanPrompt,
} from './story-prompts'
import { getQualityDashboardData } from './quality-dashboard.service'
import { runChatTask, runStreamTask } from './task.service'
import { buildConsistencyPromptSummary, buildNovelConsistencyReport } from './consistency.service'
import { syncChapterTimelineStatuses } from './link-sync.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  collectQualityGuardrailFindings,
  formatQualityGuardrailSummary,
  shouldForceRepair,
} from '../../src/shared/content-guardrails'
import {
  markChapterContextCurrent,
  markSubsequentChaptersStale,
  runChapterPublishCheck,
} from './context-impact.service'
import { refreshStoryMemoryCheckpoints } from './story-memory.service'
import {
  ensureStoryStructure,
  resolveDefaultStructure,
  syncChapterToSegments,
} from './story-structure.service'
import { discoverEntitiesFromContent } from './entity-discovery.service'
import { buildBatchKey, captureTimelineAnchorsForChapterIds, createOperationLog } from './history.service'
import { enhanceAiScoreResult } from './ai-score.service'
import {
  analyzeChapterDialogueAgainstNovel,
  scheduleDialogueFingerprintRefresh,
} from './dialogue-fingerprint.service'
import { refreshCharacterStateVersionsForChapter } from './character-state.service'

interface ChapterSummaryData {
  summary: string
  nextChapterSeed: string
}

interface ScenePlanStep {
  scene_order: number
  scene_title: string
  purpose: string
  location: string
  time_anchor: string
  present_characters: string[]
  key_items: string[]
  conflict: string
  beat: string
  must_cover: string[]
  exit_hook: string
}

type ReviewSeverity = 'low' | 'medium' | 'high'
type ProtagonistSetbackLevel = 'none' | 'minor' | 'major'
type CostResolutionState = 'new' | 'ongoing' | 'resolved' | 'evaporated'
type ReversalSupportState = 'supported' | 'weak' | 'forced'
type ChapterPacingMarker = 'setup' | 'conflict' | 'reversal' | 'climax' | 'payoff' | 'breather'
type RewardState = 'none' | 'partial' | 'major'

interface ChapterReviewNotes {
  summary: string
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks: string[]
  context_drift_risks: string[]
  realism_risks: string[]
  coherence_risks: string[]
  reader_hook_risks: string[]
  language_risks: string[]
  human_language_repairs: string[]
  genre_hollowing_risks: string[]
  missing_payoffs: string[]
  strengths: string[]
  severity: ReviewSeverity
  rewrite_required: boolean
  revision_brief: string
  protagonist_setback: ProtagonistSetbackLevel
  setback_summary: string
  cost_present: boolean
  cost_summary: string
  cost_resolution_state?: CostResolutionState
  reversal_marker: boolean
  reversal_summary: string
  reversal_support_state?: ReversalSupportState
  pace_marker?: ChapterPacingMarker
  reward_state: RewardState
  protagonist_pressure: number
  dialogue_homogenization_risks: string[]
  dialogue_fingerprint_summary: string
  cross_character_similarity: Array<{
    characterAId: number
    characterAName: string
    characterBId: number
    characterBName: string
    similarity: number
    reason: string
  }>
  dialogue_drift_alerts: Array<{
    characterId: number
    characterName: string
    driftRate: number
    reason: string
  }>
}

type ChapterGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'completed' | 'failed'

interface ChapterGenerationProgressEvent {
  chapterId: number
  stage: ChapterGenerationStage
  label: string
  detail?: string
  completed: number
  total: number
  status: 'running' | 'success' | 'failed'
}

interface LockedParagraphContext {
  lockedParagraphs: string[]
  promptDraftContent: string
  initialFallbackContent: string
}

export type ChapterVersionSource =
  | 'manual-save'
  | 'ai-rewrite'
  | 'pipeline-generate'
  | 'version-restore'

const EMPTY_CONTINUITY_STATE: ContinuityState = {
  plotProgress: [],
  characterStateChanges: [],
  worldStateChanges: [],
  openLoops: [],
  continuityNotes: [],
  arcProgress: '',
}

const MAX_CHAPTER_VERSION_COUNT = 20

const ARC_PROGRESS_STALL_PATTERNS = [
  /未推进/,
  /没有推进/,
  /无实质推进/,
  /推进不足/,
  /尚未推进/,
  /尚未触及/,
  /仍在铺垫/,
  /空转/,
  /停滞/,
  /原地/,
  /受阻/,
  /搁置/,
  /偏离/,
  /反向/,
  /倒退/,
]

function countChineseWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
}

function getDefaultChapterTitle(chapterNum: number): string {
  return `第${chapterNum}章`
}

function normalizeChapterVersionSource(
  value?: ChapterVersionSource | false,
): ChapterVersionSource | null {
  if (value === false) return null
  if (value === 'ai-rewrite' || value === 'pipeline-generate' || value === 'version-restore') {
    return value
  }
  return 'manual-save'
}

function createChapterVersionSnapshot(chapterId: number, source: ChapterVersionSource) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null

  const content = typeof chapter.content === 'string' ? chapter.content : ''
  if (!content.trim()) return null

  const latest = db.select().from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt), desc(chapterVersions.id))
    .all()[0]
  if (latest?.content === content) {
    return latest
  }

  const result = db.insert(chapterVersions).values({
    novelId: chapter.novelId,
    chapterId,
    versionSource: source,
    content,
    wordCount: chapter.wordCount || countChineseWords(content),
  }).run()

  const versionIds = db.select({ id: chapterVersions.id }).from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt), desc(chapterVersions.id))
    .all()
    .map((row) => row.id)
  const staleIds = versionIds.slice(MAX_CHAPTER_VERSION_COUNT)
  if (staleIds.length > 0) {
    db.delete(chapterVersions).where(inArray(chapterVersions.id, staleIds)).run()
  }

  return Number(result.lastInsertRowid)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeTextList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizeReviewSeverity(value: unknown): ReviewSeverity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function normalizeBoundedNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeProtagonistSetback(value: unknown): ProtagonistSetbackLevel {
  return value === 'major' || value === 'minor' || value === 'none' ? value : 'none'
}

function normalizeCostResolutionState(value: unknown): CostResolutionState | undefined {
  return value === 'new' || value === 'ongoing' || value === 'resolved' || value === 'evaporated'
    ? value
    : undefined
}

function normalizeReversalSupportState(value: unknown): ReversalSupportState | undefined {
  return value === 'supported' || value === 'weak' || value === 'forced' ? value : undefined
}

function normalizePaceMarker(value: unknown): ChapterPacingMarker | undefined {
  return value === 'setup'
    || value === 'conflict'
    || value === 'reversal'
    || value === 'climax'
    || value === 'payoff'
    || value === 'breather'
    ? value
    : undefined
}

function normalizeRewardState(value: unknown): RewardState {
  return value === 'partial' || value === 'major' || value === 'none' ? value : 'none'
}

function mergeSeverity(current: ReviewSeverity, incoming: ReviewSeverity): ReviewSeverity {
  const rank: Record<ReviewSeverity, number> = { low: 1, medium: 2, high: 3 }
  return rank[incoming] > rank[current] ? incoming : current
}

function extractChapterGoal(outline?: string | null): string {
  if (!outline) return ''
  const match = outline.match(/(?:^|\n)(?:目标|本章目标)[:：]?\s*(.+)/)
  if (match?.[1]) return match[1].trim()

  const firstLine = outline.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || ''
}

function serializeContinuityState(state: ContinuityState): string {
  return JSON.stringify({
    plot_progress: state.plotProgress,
    character_state_changes: state.characterStateChanges,
    world_state_changes: state.worldStateChanges,
    open_loops: state.openLoops,
    continuity_notes: state.continuityNotes,
    arc_progress: state.arcProgress,
  })
}

function sendGenerationProgress(
  sender: WebContents | undefined,
  payload: ChapterGenerationProgressEvent,
) {
  if (sender && !sender.isDestroyed()) {
    sender.send('chapter:generation-progress', payload)
  }
}

function buildStoryCore(profile: Awaited<ReturnType<typeof buildStoryProfile>>, fallback?: string): string {
  if (fallback?.trim()) return fallback
  return [
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.writingRulesSummary,
  ].filter(Boolean).join('\n\n')
}

function buildFallbackContinuityState(
  chapter: typeof chapters.$inferSelect,
  summaryData: ChapterSummaryData,
): ContinuityState {
  const chapterGoal = extractChapterGoal(chapter.outline)
  const summary = summaryData.summary || chapter.title || `${getDefaultChapterTitle(chapter.chapterNum)}完成当前章节推进`
  const nextSeed = summaryData.nextChapterSeed

  return {
    plotProgress: [summary].filter(Boolean),
    characterStateChanges: [],
    worldStateChanges: [],
    // openLoops 只记录真正未回收的悬挂情节，nextChapterSeed 是衔接提示而非伏笔
    openLoops: [],
    continuityNotes: [nextSeed || chapterGoal].filter(Boolean),
    arcProgress: chapterGoal || '',
  }
}

function normalizeContinuityState(parsed: Record<string, unknown>, fallback: ContinuityState): ContinuityState {
  const state: ContinuityState = {
    plotProgress: toStringArray(parsed.plot_progress),
    characterStateChanges: toStringArray(parsed.character_state_changes),
    worldStateChanges: toStringArray(parsed.world_state_changes),
    openLoops: toStringArray(parsed.open_loops),
    continuityNotes: toStringArray(parsed.continuity_notes),
    arcProgress: typeof parsed.arc_progress === 'string' ? parsed.arc_progress.trim() : '',
  }

  const hasContent = Boolean(
    state.plotProgress.length > 0 ||
    state.characterStateChanges.length > 0 ||
    state.worldStateChanges.length > 0 ||
    state.openLoops.length > 0 ||
    state.continuityNotes.length > 0 ||
    state.arcProgress,
  )

  return hasContent ? state : fallback
}

function normalizeScenePlan(raw: unknown, fallback: ScenePlanStep[]): ScenePlanStep[] {
  if (!Array.isArray(raw)) return fallback

  const normalized = raw
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const purpose = asText(record.purpose)
      const beat = asText(record.beat)
      const title = asText(record.scene_title)
      if (!purpose && !beat && !title) return null

      return {
        scene_order: typeof record.scene_order === 'number' ? Math.round(record.scene_order) : index + 1,
        scene_title: title || `场景 ${index + 1}`,
        purpose,
        location: asText(record.location),
        time_anchor: asText(record.time_anchor),
        present_characters: toStringArray(record.present_characters),
        key_items: toStringArray(record.key_items),
        conflict: asText(record.conflict),
        beat,
        must_cover: toStringArray(record.must_cover),
        exit_hook: asText(record.exit_hook),
      }
    })
    .filter((item): item is ScenePlanStep => Boolean(item))

  return normalized.length > 0 ? normalized : fallback
}

function buildFallbackScenePlan(chapter: typeof chapters.$inferSelect): ScenePlanStep[] {
  const outlineLines = (chapter.outline || '')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)

  const seeds = outlineLines.length > 0
    ? outlineLines
    : [extractChapterGoal(chapter.outline) || `完成${getDefaultChapterTitle(chapter.chapterNum)}的核心推进`]

  return seeds.map((line, index) => ({
    scene_order: index + 1,
    scene_title: `场景 ${index + 1}`,
    purpose: line,
    location: '',
    time_anchor: '',
    present_characters: [],
    key_items: [],
    conflict: '',
    beat: line,
    must_cover: [line],
    exit_hook: index === seeds.length - 1 ? '把本章推进到自然收束点。' : '把当前冲突继续推向下一段。',
  }))
}

function parseLockedParagraphsJson(raw?: string | null): string[] {
  if (!raw?.trim()) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return dedupeTextList(parsed
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
        const record = item as Record<string, unknown>
        return typeof record.content === 'string'
          ? record.content
          : typeof record.paragraph === 'string'
            ? record.paragraph
            : typeof record.text === 'string'
              ? record.text
              : ''
      }))
  } catch {
    return []
  }
}

function normalizeParagraphFingerprint(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
}

function contentContainsLockedParagraph(content: string, lockedParagraph: string): boolean {
  const normalizedContent = normalizeParagraphFingerprint(content)
  const normalizedParagraph = normalizeParagraphFingerprint(lockedParagraph)
  if (!normalizedParagraph) return false
  return normalizedContent.includes(normalizedParagraph)
}

function contentPreservesLockedParagraphs(content: string, lockedParagraphs: string[]): boolean {
  if (lockedParagraphs.length === 0) return true
  if (!content.trim()) return false
  return lockedParagraphs.every((paragraph) => contentContainsLockedParagraph(content, paragraph))
}

function markLockedParagraphsInContent(content: string, lockedParagraphs: string[]): string {
  if (!content.trim() || lockedParagraphs.length === 0) return content

  let next = content
  lockedParagraphs
    .slice()
    .sort((left, right) => right.length - left.length)
    .forEach((paragraph) => {
      if (!paragraph || !next.includes(paragraph)) return
      next = next.split(paragraph).join(`【锁定】\n${paragraph}\n【/锁定】`)
    })

  return next
}

function buildLockedParagraphContext(
  chapter: typeof chapters.$inferSelect,
  draftContent: string,
): LockedParagraphContext {
  const lockedParagraphs = parseLockedParagraphsJson(chapter.lockedParagraphsJson)
  const previousContent = typeof chapter.content === 'string' ? chapter.content.trim() : ''
  const initialFallbackContent = contentPreservesLockedParagraphs(previousContent, lockedParagraphs)
    ? previousContent
    : draftContent.trim()

  return {
    lockedParagraphs,
    promptDraftContent: markLockedParagraphsInContent(draftContent, lockedParagraphs),
    initialFallbackContent,
  }
}

function enforceLockedParagraphProtection(
  content: string,
  lockedParagraphs: string[],
  fallbackContent: string,
  reviewNotes: ChapterReviewNotes,
): { content: string; reviewNotes: ChapterReviewNotes; violated: boolean } {
  const trimmed = content.trim()
  if (lockedParagraphs.length === 0 || contentPreservesLockedParagraphs(trimmed, lockedParagraphs)) {
    return {
      content: trimmed,
      reviewNotes,
      violated: false,
    }
  }

  return {
    content: fallbackContent.trim() || trimmed,
    reviewNotes: {
      ...reviewNotes,
      critical_fixes: dedupeTextList([
        '严格保留作者锁定段落，任何改动只能发生在未锁定内容。',
        ...reviewNotes.critical_fixes,
      ]),
      language_risks: dedupeTextList([
        '本次重写改动了作者锁定段落，已触发保护回退。',
        ...reviewNotes.language_risks,
      ]),
      severity: mergeSeverity(reviewNotes.severity, 'high'),
      rewrite_required: true,
      summary: reviewNotes.summary || '检测到锁定段落被改写，当前结果已回退到安全版本。',
      revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
        '锁定段落必须逐字保留，只能调整周边衔接。',
      ]),
    },
    violated: true,
  }
}

function extractArcProgressPercentHint(text: string): number {
  const match = text.match(/(\d{1,3})\s*%/)
  if (!match) return 0
  return Math.max(0, Math.min(100, Math.round(Number(match[1]))))
}

function indicatesArcProgress(text: string): boolean {
  const normalized = text.trim()
  return Boolean(normalized) && !ARC_PROGRESS_STALL_PATTERNS.some((pattern) => pattern.test(normalized))
}

function getArcChapterRangeMetrics(
  arc: typeof storyArcs.$inferSelect,
  chapterNum: number,
): { total: number; index: number; percent: number } | null {
  if (typeof arc.chapterStart !== 'number' || typeof arc.chapterEnd !== 'number' || arc.chapterEnd < arc.chapterStart) {
    return null
  }

  const total = Math.max(arc.chapterEnd - arc.chapterStart + 1, 1)
  const index = Math.max(1, Math.min(total, chapterNum - arc.chapterStart + 1))
  return {
    total,
    index,
    percent: Math.max(0, Math.min(100, Math.round((index / total) * 100))),
  }
}

function buildArcProgressStatus(
  arc: typeof storyArcs.$inferSelect | null,
  chapterNum: number,
): string {
  if (!arc) return ''

  const metrics = getArcChapterRangeMetrics(arc, chapterNum)
  return [
    `已记录推进度：${arc.progressPercent || 0}%`,
    metrics ? `当前章节位于本弧第 ${metrics.index} / ${metrics.total} 章` : '',
    `连续未推进章节：${arc.stalledChapterCount || 0}`,
    typeof arc.lastProgressChapterNum === 'number' ? `最近明确推进章节：第${arc.lastProgressChapterNum}章` : '最近明确推进章节：暂无记录',
  ].filter(Boolean).join('\n')
}

function buildArcProgressCheckpoint(
  arc: typeof storyArcs.$inferSelect | null,
  chapterNum: number,
): string {
  if (!arc) return ''

  const metrics = getArcChapterRangeMetrics(arc, chapterNum)
  if (!metrics || metrics.total < 4 || typeof arc.chapterStart !== 'number') return ''

  const checkpoints = [
    { label: '25%', chapterNum: arc.chapterStart + Math.round((metrics.total - 1) * 0.25) },
    { label: '50%', chapterNum: arc.chapterStart + Math.round((metrics.total - 1) * 0.5) },
    { label: '75%', chapterNum: arc.chapterStart + Math.round((metrics.total - 1) * 0.75) },
  ]
  const current = checkpoints.find((checkpoint) => checkpoint.chapterNum === chapterNum)
  if (!current) return ''

  return `当前位于本弧 ${current.label} 检查点（第${metrics.index} / ${metrics.total}章），本章必须明确兑现本弧目标，不能只重复铺垫或转移注意力。`
}

function formatScenePlan(scenePlan: ScenePlanStep[]): string {
  return scenePlan
    .map((step) => {
      const parts = [
        `目标=${step.purpose}`,
        step.location ? `地点=${step.location}` : '',
        step.time_anchor ? `时间=${step.time_anchor}` : '',
        step.present_characters.length > 0 ? `人物=${step.present_characters.join('、')}` : '',
        step.key_items.length > 0 ? `物品=${step.key_items.join('、')}` : '',
        step.conflict ? `冲突=${step.conflict}` : '',
        step.beat ? `动作=${step.beat}` : '',
        step.must_cover.length > 0 ? `必须交代=${step.must_cover.join('；')}` : '',
        step.exit_hook ? `收尾=${step.exit_hook}` : '',
      ].filter(Boolean)
      return `${step.scene_order}. ${step.scene_title}\n${parts.join('\n')}`
    })
    .join('\n\n')
}

function normalizeReviewNotes(raw: unknown): ChapterReviewNotes {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  const costPresent = normalizeBoolean(record.cost_present)
  const reversalMarker = normalizeBoolean(record.reversal_marker)

  return {
    summary: asText(record.summary),
    critical_fixes: toStringArray(record.critical_fixes),
    continuity_risks: toStringArray(record.continuity_risks),
    arc_progress_risks: toStringArray(record.arc_progress_risks),
    context_drift_risks: toStringArray(record.context_drift_risks),
    realism_risks: toStringArray(record.realism_risks),
    coherence_risks: toStringArray(record.coherence_risks),
    reader_hook_risks: toStringArray(record.reader_hook_risks),
    language_risks: toStringArray(record.language_risks),
    human_language_repairs: toStringArray(record.human_language_repairs),
    genre_hollowing_risks: toStringArray(record.genre_hollowing_risks),
    missing_payoffs: toStringArray(record.missing_payoffs),
    strengths: toStringArray(record.strengths),
    severity: normalizeReviewSeverity(record.severity),
    rewrite_required: record.rewrite_required === true,
    revision_brief: asText(record.revision_brief),
    protagonist_setback: normalizeProtagonistSetback(record.protagonist_setback),
    setback_summary: asText(record.setback_summary),
    cost_present: costPresent,
    cost_summary: asText(record.cost_summary),
    cost_resolution_state: costPresent ? normalizeCostResolutionState(record.cost_resolution_state) : undefined,
    reversal_marker: reversalMarker,
    reversal_summary: asText(record.reversal_summary),
    reversal_support_state: reversalMarker ? normalizeReversalSupportState(record.reversal_support_state) : undefined,
    pace_marker: normalizePaceMarker(record.pace_marker),
    reward_state: normalizeRewardState(record.reward_state),
    protagonist_pressure: normalizeBoundedNumber(record.protagonist_pressure, 0, 100, 0),
    dialogue_homogenization_risks: toStringArray(record.dialogue_homogenization_risks),
    dialogue_fingerprint_summary: asText(record.dialogue_fingerprint_summary),
    cross_character_similarity: Array.isArray(record.cross_character_similarity)
      ? record.cross_character_similarity
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const current = item as Record<string, unknown>
          return {
            characterAId: normalizeBoundedNumber(current.characterAId, 0, Number.MAX_SAFE_INTEGER, 0),
            characterAName: asText(current.characterAName),
            characterBId: normalizeBoundedNumber(current.characterBId, 0, Number.MAX_SAFE_INTEGER, 0),
            characterBName: asText(current.characterBName),
            similarity: normalizeBoundedNumber(current.similarity, 0, 100, 0),
            reason: asText(current.reason),
          }
        })
        .filter((item) => item.characterAId > 0 && item.characterBId > 0 && item.characterAName && item.characterBName)
      : [],
    dialogue_drift_alerts: Array.isArray(record.dialogue_drift_alerts)
      ? record.dialogue_drift_alerts
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const current = item as Record<string, unknown>
          return {
            characterId: normalizeBoundedNumber(current.characterId, 0, Number.MAX_SAFE_INTEGER, 0),
            characterName: asText(current.characterName),
            driftRate: normalizeBoundedNumber(current.driftRate, 0, 100, 0),
            reason: asText(current.reason),
          }
        })
        .filter((item) => item.characterId > 0 && item.characterName)
      : [],
  }
}

function hasReviewNotes(notes: ChapterReviewNotes): boolean {
  return Boolean(
    notes.summary ||
    notes.critical_fixes.length > 0 ||
    notes.continuity_risks.length > 0 ||
    notes.arc_progress_risks.length > 0 ||
    notes.context_drift_risks.length > 0 ||
    notes.realism_risks.length > 0 ||
    notes.coherence_risks.length > 0 ||
    notes.reader_hook_risks.length > 0 ||
    notes.language_risks.length > 0 ||
    notes.human_language_repairs.length > 0 ||
    notes.genre_hollowing_risks.length > 0 ||
    notes.missing_payoffs.length > 0 ||
    notes.strengths.length > 0 ||
    notes.rewrite_required ||
    notes.revision_brief ||
    notes.protagonist_setback !== 'none' ||
    notes.setback_summary ||
    notes.cost_present ||
    notes.cost_summary ||
    Boolean(notes.cost_resolution_state) ||
    notes.reversal_marker ||
    notes.reversal_summary ||
    Boolean(notes.reversal_support_state) ||
    Boolean(notes.pace_marker) ||
    notes.reward_state !== 'none' ||
    notes.protagonist_pressure > 0 ||
    notes.dialogue_homogenization_risks.length > 0 ||
    Boolean(notes.dialogue_fingerprint_summary) ||
    notes.cross_character_similarity.length > 0 ||
    notes.dialogue_drift_alerts.length > 0,
  )
}

function buildFallbackReviewNotes(consistencyNotes: string): ChapterReviewNotes {
  const consistencyLines = consistencyNotes
    .split('\n')
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  return {
    summary: '先按场景计划把事件链写顺，再统一修正承接、常识和语言问题。',
    critical_fixes: ['逐段核对场景计划里的 must_cover 是否全部落地。'],
    continuity_risks: consistencyLines,
    arc_progress_risks: [],
    context_drift_risks: [],
    realism_risks: [],
    coherence_risks: [],
    reader_hook_risks: [],
    language_risks: ['删除抽象口号、概念化抒情和不自然搭配。'],
    human_language_repairs: [],
    genre_hollowing_risks: [],
    missing_payoffs: [],
    strengths: [],
    severity: 'medium',
    rewrite_required: true,
    revision_brief: '保持当前剧情方向，重点修承接、人物状态、物品去向、代价落点和语言自然度。',
    protagonist_setback: 'none',
    setback_summary: '',
    cost_present: false,
    cost_summary: '',
    cost_resolution_state: undefined,
    reversal_marker: false,
    reversal_summary: '',
    reversal_support_state: undefined,
    pace_marker: undefined,
    reward_state: 'none',
    protagonist_pressure: 0,
    dialogue_homogenization_risks: [],
    dialogue_fingerprint_summary: '',
    cross_character_similarity: [],
    dialogue_drift_alerts: [],
  }
}

function formatReviewNotes(notes: ChapterReviewNotes): string {
  return [
    notes.summary ? `整体判断：${notes.summary}` : '',
    notes.critical_fixes.length > 0 ? `必须修改：\n- ${notes.critical_fixes.join('\n- ')}` : '',
    notes.continuity_risks.length > 0 ? `连续性风险：\n- ${notes.continuity_risks.join('\n- ')}` : '',
    notes.arc_progress_risks.length > 0 ? `故事弧推进风险：\n- ${notes.arc_progress_risks.join('\n- ')}` : '',
    notes.context_drift_risks.length > 0 ? `上下文漂移风险：\n- ${notes.context_drift_risks.join('\n- ')}` : '',
    notes.realism_risks.length > 0 ? `常识/规则风险：\n- ${notes.realism_risks.join('\n- ')}` : '',
    notes.coherence_risks.length > 0 ? `连贯性风险：\n- ${notes.coherence_risks.join('\n- ')}` : '',
    notes.reader_hook_risks.length > 0 ? `追读风险：\n- ${notes.reader_hook_risks.join('\n- ')}` : '',
    notes.language_risks.length > 0 ? `语言风险：\n- ${notes.language_risks.join('\n- ')}` : '',
    notes.human_language_repairs.length > 0 ? `语言替换建议：\n- ${notes.human_language_repairs.join('\n- ')}` : '',
    notes.genre_hollowing_risks.length > 0 ? `体裁空心化：\n- ${notes.genre_hollowing_risks.join('\n- ')}` : '',
    notes.missing_payoffs.length > 0 ? `缺失回收：\n- ${notes.missing_payoffs.join('\n- ')}` : '',
    notes.strengths.length > 0 ? `可保留优点：\n- ${notes.strengths.join('\n- ')}` : '',
    notes.protagonist_setback !== 'none' || notes.setback_summary
      ? `主角受挫：${notes.protagonist_setback}${notes.setback_summary ? ` · ${notes.setback_summary}` : ''}`
      : '',
    notes.cost_present
      ? `代价状态：${notes.cost_resolution_state || 'new'}${notes.cost_summary ? ` · ${notes.cost_summary}` : ''}`
      : '',
    notes.reversal_marker
      ? `反转判断：${notes.reversal_support_state || 'weak'}${notes.reversal_summary ? ` · ${notes.reversal_summary}` : ''}`
      : '',
    notes.pace_marker ? `章节节奏标签：${notes.pace_marker}` : '',
    notes.reward_state !== 'none' ? `阶段回报：${notes.reward_state}` : '',
    notes.protagonist_pressure > 0 ? `主角压力值：${notes.protagonist_pressure}` : '',
    notes.dialogue_fingerprint_summary ? `角色对白辨识度：${notes.dialogue_fingerprint_summary}` : '',
    notes.dialogue_homogenization_risks.length > 0 ? `对白同质化风险：\n- ${notes.dialogue_homogenization_risks.join('\n- ')}` : '',
    notes.cross_character_similarity.length > 0
      ? `高相似角色组合：\n- ${notes.cross_character_similarity.map((item) => `${item.characterAName}/${item.characterBName} (${item.similarity})：${item.reason}`).join('\n- ')}`
      : '',
    notes.dialogue_drift_alerts.length > 0
      ? `角色语音漂移：\n- ${notes.dialogue_drift_alerts.map((item) => `${item.characterName} (${item.driftRate})：${item.reason}`).join('\n- ')}`
      : '',
    `严重等级：${notes.severity}`,
    `是否需要重写：${notes.rewrite_required ? '是' : '否'}`,
    notes.revision_brief ? `修订摘要：${notes.revision_brief}` : '',
  ].filter(Boolean).join('\n\n')
}

function findingSeverityToReviewSeverity(severity: 'low' | 'medium' | 'high'): ReviewSeverity {
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

function buildGuardrailCriticalFixes(findings: ReturnType<typeof collectQualityGuardrailFindings>): string[] {
  const fixes: string[] = []

  if (findings.some((finding) => finding.code === 'object_category_mismatch')) {
    fixes.push('把物体、系统或设施写成人的句子全部改成准确说法，例如把“电网死亡”改成“电网瘫痪”或“电网中断”。')
  }

  if (findings.some((finding) => finding.code === 'zero_cost_resolution')) {
    fixes.push('把伤亡、物资、秩序或战斗结果的代价写进场景里，不能一句话零成本解决。')
  }

  if (findings.some((finding) => finding.code === 'ai_slogan' || finding.code === 'template_emotion')) {
    fixes.push('删掉口号句、模板情绪和假深刻抒情，改回动作、反应、对话与细节。')
  }

  if (findings.some((finding) => finding.code === 'genre_hollowing')) {
    fixes.push('把体裁生态写回场景，补齐修行秩序、生存链或江湖规矩，不要只剩抽象口号和单一动作。')
  }

  if (findings.some((finding) => finding.code === 'ai_opener' || finding.code === 'ai_action_cliche' || finding.code === 'ai_emotional_cliche')) {
    fixes.push('替换所有AI高频开头（"突然""这一刻"）、套路动作（"深吸一口气""瞳孔骤然收缩"）和模板情绪（"心中涌起""百感交集"），改用角色特有的反应方式。')
  }

  if (findings.some((finding) => finding.code === 'ai_pseudo_philosophy' || finding.code === 'ai_ending_summary')) {
    fixes.push('删掉段落结尾的伪哲学总结句（"或许这就是""这一刻他终于明白"），让事件和动作自己说话。')
  }

  if (findings.some((finding) => finding.code === 'high_frequency_repetition')) {
    const repetitionFinding = findings.find((f) => f.code === 'high_frequency_repetition')
    if (repetitionFinding) {
      fixes.push(`高频重复词组需替换：${repetitionFinding.excerpt}——用同义表达或删减来避免阅读疲劳。`)
    }
  }

  return fixes
}

function appendRevisionBrief(base: string, additions: string[]): string {
  const merged = dedupeTextList([base, ...additions])
  if (merged.length === 0) return ''
  return merged.join('；').slice(0, 140)
}

function applyDialogueAnalysisToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  novelId: number,
  chapterNum: number,
  content: string,
): ChapterReviewNotes {
  const analysis = analyzeChapterDialogueAgainstNovel(novelId, chapterNum, content)
  if (
    !analysis.fingerprintSummary
    && analysis.risks.length === 0
    && analysis.similarities.length === 0
    && analysis.drifts.length === 0
  ) {
    return reviewNotes
  }

  return {
    ...reviewNotes,
    dialogue_homogenization_risks: dedupeTextList([
      ...reviewNotes.dialogue_homogenization_risks,
      ...analysis.risks,
    ]),
    dialogue_fingerprint_summary: analysis.fingerprintSummary || reviewNotes.dialogue_fingerprint_summary,
    cross_character_similarity: analysis.similarities,
    dialogue_drift_alerts: analysis.drifts,
    language_risks: dedupeTextList([
      ...reviewNotes.language_risks,
      ...analysis.risks.filter((item) => item.includes('对白') || item.includes('语音画像')),
    ]),
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      analysis.similarities.length > 0 ? '拉开同场角色的句长、停顿和语气差异，避免多人同腔。' : '',
      analysis.drifts.length > 0 ? '把漂移角色拉回既有称呼、停顿和重复短语习惯。' : '',
    ]),
  }
}

function buildStructuralAlertsSummary(
  novelId: number,
  chapterNum: number,
  volumeId?: number | null,
): string {
  try {
    const dashboard = getQualityDashboardData(novelId, { includeDialogueInsights: false })
    const relevantAlerts = dashboard.storyPacingAlerts
      .filter((alert) => alert.chapterNums.length === 0
        || alert.chapterNums.includes(chapterNum)
        || alert.chapterNums.some((num) => num >= chapterNum - 3 && num <= chapterNum))
      .slice(0, 3)
    const fallbackAlerts = relevantAlerts.length > 0
      ? relevantAlerts
      : dashboard.storyPacingAlerts.slice(0, 3)
    const currentVolume = typeof volumeId === 'number'
      ? dashboard.volumeStoryDynamics.find((entry) => entry.volumeId === volumeId) || null
      : null

    const lines = [
      ...fallbackAlerts.map((alert) => `- ${alert.title}：${alert.detail}`),
      dashboard.protagonistSetbackSummary.chapterCount > 0
        ? `- 全书主角受挫率 ${dashboard.protagonistSetbackSummary.protagonistSetbackRate}% ，重大受挫 ${dashboard.protagonistSetbackSummary.majorSetbackRate}% ，最长顺推跨度 ${dashboard.protagonistSetbackSummary.longestSmoothRun} 章。`
        : '',
      dashboard.costPersistenceSummary.evaporatedCostCount > 0
        ? `- 全书已检测到 ${dashboard.costPersistenceSummary.evaporatedCostCount} 次代价蒸发，重写时不要自动抹平重大损失。`
        : '',
      dashboard.reversalDistributionSummary.forcedReversalCount > 0
        ? `- 已检测到 ${dashboard.reversalDistributionSummary.forcedReversalCount} 次强行反转，新增反转前先补齐铺垫与触发链。`
        : '',
      currentVolume
        ? `- 当前卷 ${currentVolume.volumeName}：受挫率 ${currentVolume.protagonistSetbackRate}% ，高潮章节 ${currentVolume.climaxChapterNums.length > 0 ? currentVolume.climaxChapterNums.join('、') : '暂无'} ，代价蒸发 ${currentVolume.evaporatedCostCount} 次。`
        : '',
    ].filter(Boolean)

    return lines.join('\n')
  } catch {
    return ''
  }
}

function enhanceReviewNotesWithGuardrails(
  reviewNotes: ChapterReviewNotes,
  content: string,
  genre?: string,
  existingFindings?: ReturnType<typeof collectQualityGuardrailFindings>,
): ChapterReviewNotes {
  const findings = existingFindings ?? collectQualityGuardrailFindings(content, genre)
  if (findings.length === 0) return reviewNotes

  const realismFindings = formatQualityGuardrailSummary(
    findings.filter((finding) => finding.code === 'object_category_mismatch' || finding.code === 'zero_cost_resolution'),
  )
  const languageFindings = formatQualityGuardrailSummary(
    findings.filter((finding) => finding.code === 'ai_slogan' || finding.code === 'template_emotion'),
  )
  const genreHollowFindings = formatQualityGuardrailSummary(
    findings.filter((finding) => finding.code === 'genre_hollowing'),
  )

  const next: ChapterReviewNotes = {
    ...reviewNotes,
    critical_fixes: dedupeTextList([...buildGuardrailCriticalFixes(findings), ...reviewNotes.critical_fixes]),
    continuity_risks: dedupeTextList(reviewNotes.continuity_risks),
    arc_progress_risks: dedupeTextList(reviewNotes.arc_progress_risks),
    context_drift_risks: dedupeTextList(reviewNotes.context_drift_risks),
    realism_risks: dedupeTextList([...reviewNotes.realism_risks, ...realismFindings]),
    coherence_risks: dedupeTextList(reviewNotes.coherence_risks),
    reader_hook_risks: dedupeTextList([
      ...reviewNotes.reader_hook_risks,
      ...(findings.some((finding) => finding.code === 'zero_cost_resolution')
        ? ['本章关键冲突的结果代价不足，读者会感觉主角几乎无成本顺推。']
        : []),
    ]),
    language_risks: dedupeTextList([...reviewNotes.language_risks, ...languageFindings]),
    human_language_repairs: dedupeTextList(reviewNotes.human_language_repairs),
    genre_hollowing_risks: dedupeTextList([...reviewNotes.genre_hollowing_risks, ...genreHollowFindings]),
    missing_payoffs: dedupeTextList(reviewNotes.missing_payoffs),
    strengths: dedupeTextList(reviewNotes.strengths),
    severity: findings.reduce(
      (current, finding) => mergeSeverity(current, findingSeverityToReviewSeverity(finding.severity)),
      reviewNotes.severity,
    ),
    rewrite_required: reviewNotes.rewrite_required || shouldForceRepair(findings),
    summary: reviewNotes.summary || '当前稿件仍有需要落地修正的体裁、常识或语言问题。',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      realismFindings.length > 0 ? '把伤害、资源、秩序、移动成本和世界规则的代价写实写满。' : '',
      languageFindings.length > 0 ? '删掉口号句、模板情绪和对象类别错配，改回自然中文。' : '',
      genreHollowFindings.length > 0 ? '把题材生态写回具体场景，补齐生存链、修行秩序或江湖规矩。' : '',
    ]),
    cost_present: reviewNotes.cost_present || findings.some((finding) => finding.code === 'zero_cost_resolution'),
    cost_summary: reviewNotes.cost_summary || (findings.some((finding) => finding.code === 'zero_cost_resolution')
      ? '当前重大问题被写成了近乎无代价解决，需要补齐损失、伤势、资源消耗或秩序后果。'
      : ''),
    cost_resolution_state: findings.some((finding) => finding.code === 'zero_cost_resolution')
      ? 'evaporated'
      : reviewNotes.cost_resolution_state,
  }

  return next
}

function parseStoredReviewNotes(raw?: string | null): ChapterReviewNotes {
  if (!raw?.trim()) return normalizeReviewNotes({})

  try {
    return normalizeReviewNotes(JSON.parse(raw) as unknown)
  } catch {
    return normalizeReviewNotes({})
  }
}

function parseStoredContinuityState(raw?: string | null): ContinuityState | null {
  if (!raw?.trim()) return null

  try {
    return normalizeContinuityState(JSON.parse(raw) as Record<string, unknown>, EMPTY_CONTINUITY_STATE)
  } catch {
    return null
  }
}

function getLatestArcProgressNote(
  novelId: number,
  arc: typeof storyArcs.$inferSelect | null,
  beforeChapterNum: number,
): string {
  if (!arc) return ''

  const db = getDb()
  const arcChapters = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    .filter((chapter) => {
      if (chapter.chapterNum >= beforeChapterNum) return false
      if (chapter.arcId === arc.id) return true
      if (typeof arc.chapterStart !== 'number' || typeof arc.chapterEnd !== 'number') return false
      return chapter.chapterNum >= arc.chapterStart && chapter.chapterNum <= arc.chapterEnd
    })
    .sort((left, right) => right.chapterNum - left.chapterNum)

  for (const chapter of arcChapters) {
    const continuity = parseStoredContinuityState(chapter.continuityStateJson)
    if (continuity?.arcProgress?.trim()) return continuity.arcProgress.trim()
  }

  return ''
}

function computeStoryArcProgressState(
  arc: typeof storyArcs.$inferSelect,
  currentChapter: typeof chapters.$inferSelect,
  currentContinuity: ContinuityState,
): { progressPercent: number; stalledChapterCount: number; lastProgressChapterNum: number | null; warnings: string[] } {
  const db = getDb()
  const arcChapters = db.select().from(chapters).where(eq(chapters.novelId, currentChapter.novelId)).all()
    .filter((chapter) => {
      if (chapter.arcId === arc.id) return true
      if (typeof arc.chapterStart !== 'number' || typeof arc.chapterEnd !== 'number') return false
      return chapter.chapterNum >= arc.chapterStart && chapter.chapterNum <= arc.chapterEnd
    })
    .sort((left, right) => left.chapterNum - right.chapterNum)

  const relevantChapters = arcChapters.filter((chapter) => chapter.chapterNum <= currentChapter.chapterNum)
  const continuityByChapterId = new Map<number, ContinuityState>()
  continuityByChapterId.set(currentChapter.id, currentContinuity)

  let lastProgressChapterNum: number | null = null
  let hintedPercent = 0

  for (const chapter of relevantChapters) {
    const reviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
    const continuity = continuityByChapterId.get(chapter.id) || parseStoredContinuityState(chapter.continuityStateJson)
    if (!continuity) continue

    hintedPercent = Math.max(hintedPercent, extractArcProgressPercentHint(continuity.arcProgress))
    if (reviewNotes.arc_progress_risks.length > 0) continue
    if (indicatesArcProgress(continuity.arcProgress)) {
      lastProgressChapterNum = chapter.chapterNum
    }
  }

  let stalledChapterCount = 0
  for (let index = relevantChapters.length - 1; index >= 0; index -= 1) {
    const chapter = relevantChapters[index]
    const reviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
    const continuity = continuityByChapterId.get(chapter.id) || parseStoredContinuityState(chapter.continuityStateJson)
    if (continuity && reviewNotes.arc_progress_risks.length === 0 && indicatesArcProgress(continuity.arcProgress)) {
      break
    }
    stalledChapterCount += 1
  }

  const metrics = typeof lastProgressChapterNum === 'number'
    ? getArcChapterRangeMetrics(arc, lastProgressChapterNum)
    : null
  const progressPercent = Math.max(hintedPercent, metrics?.percent || 0)

  const warnings = stalledChapterCount >= 5
    ? [`故事弧“${arc.arcName}”已连续 ${stalledChapterCount} 章未见实质推进，需要让当前章节明确服务本弧目标，或立即调整弧设计与章节安排。`]
    : []
  const checkpointWarning = buildArcProgressCheckpoint(arc, currentChapter.chapterNum)
  const currentReviewNotes = parseStoredReviewNotes(currentChapter.reviewNotesJson)
  if (checkpointWarning && currentReviewNotes.arc_progress_risks.length > 0) {
    warnings.push(`${checkpointWarning} 当前稿件仍未给出足够的弧推进。`)
  }

  return {
    progressPercent,
    stalledChapterCount,
    lastProgressChapterNum,
    warnings: dedupeTextList(warnings),
  }
}

function persistArcProgressWarnings(chapterId: number, warnings: string[]): void {
  if (warnings.length === 0) return

  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return

  const reviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
  const nextNotes: ChapterReviewNotes = {
    ...reviewNotes,
    arc_progress_risks: dedupeTextList([...reviewNotes.arc_progress_risks, ...warnings]),
    critical_fixes: dedupeTextList([
      '让本章明确推进当前故事弧目标，避免继续空转。',
      ...reviewNotes.critical_fixes,
    ]),
    severity: mergeSeverity(reviewNotes.severity, 'medium'),
    rewrite_required: true,
    summary: reviewNotes.summary || '当前章节存在需要修正的故事弧推进问题。',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      '让本章明确服务当前故事弧目标，并补上阶段性推进。',
    ]),
  }

  db.update(chapters).set({
    reviewNotesJson: JSON.stringify(nextNotes),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
}

interface ChapterRepairInput {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  context: Awaited<ReturnType<typeof buildChapterContext>>
  storyCore: string
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  scenePlanText: string
  consistencyNotes: string
  structuralAlertsSummary: string
  reviewNotes: ChapterReviewNotes
  content: string
  lockedParagraphs: string[]
  promptTier: ChapterComplexity
}

async function repairChapterOutputIfNeeded(input: ChapterRepairInput): Promise<{
  content: string
  reviewNotes: ChapterReviewNotes
}> {
  const originalContent = input.content.trim()
  const findings = collectQualityGuardrailFindings(originalContent, input.profile.genre)
  if (findings.length === 0 || !shouldForceRepair(findings)) {
    return {
      content: originalContent,
      reviewNotes: input.reviewNotes,
    }
  }

  const repairNotes = enhanceReviewNotesWithGuardrails(input.reviewNotes, originalContent, input.profile.genre, findings)

  try {
    const repairPromptDraftContent = markLockedParagraphsInContent(originalContent, input.lockedParagraphs)
    const repairedContent = (await runChatTask({
      type: 'chapter_write',
      novelId: input.chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapter.id,
      messages: [{
        role: 'user',
        content: buildChapterRewritePrompt({
          novelTitle: input.novel.title,
          genre: input.profile.genre,
          chapterNum: input.chapter.chapterNum,
          chapterTitle: input.chapter.title || getDefaultChapterTitle(input.chapter.chapterNum),
          chapterGoal: input.context.chapterGoal,
          emotionTone: input.chapter.emotionTone || '平稳',
          targetWords: input.chapter.targetWords || 3000,
          storyCore: input.storyCore,
          writingContractSummary: input.context.writingContractSummary,
          relationSummary: input.context.relationSummary,
          currentArc: input.context.currentArc,
          worldRules: input.context.worldRules,
          characterStates: input.context.characterStates,
          itemSummary: input.context.itemSummary,
          previousSummaries: input.context.previousSummaries,
          lastChapterEnding: input.context.lastChapterEnding,
          continuitySummary: input.context.continuitySummary,
          openLoops: input.context.openLoops,
          continuityNotes: input.context.continuityNotes,
          timelineSummary: input.context.timelineSummary,
          timelineOpenThreads: input.context.timelineOpenThreads,
          longTermMemory: input.context.longTermMemory,
          recalledMemory: input.context.recalledMemory,
          consistencyNotes: input.consistencyNotes,
          structuralAlertsSummary: input.structuralAlertsSummary,
          scenePlan: input.scenePlanText,
          draftContent: repairPromptDraftContent,
          reviewNotes: formatReviewNotes(repairNotes),
          lockedParagraphs: input.lockedParagraphs,
          activeThreads: input.context.activeThreads,
          protagonistReference: input.profile.protagonistReference,
          protagonistRule: input.profile.protagonistRule,
          promptTier: input.promptTier,
        }),
      }],
      modelConfigId: input.novel.modelConfigId || undefined,
    })).trim()

    if (!repairedContent) {
      return {
        content: originalContent,
        reviewNotes: repairNotes,
      }
    }

    const protectedRepaired = enforceLockedParagraphProtection(
      repairedContent,
      input.lockedParagraphs,
      originalContent,
      repairNotes,
    )
    if (protectedRepaired.violated) {
      return {
        content: protectedRepaired.content,
        reviewNotes: protectedRepaired.reviewNotes,
      }
    }

    const finalFindings = collectQualityGuardrailFindings(protectedRepaired.content, input.profile.genre)
    if (finalFindings.length > 0 && shouldForceRepair(finalFindings)) {
      // 第二轮修复：首轮修复后仍有强制修复触发，再做一次
      const secondRepairNotes = enhanceReviewNotesWithGuardrails(
        protectedRepaired.reviewNotes,
        protectedRepaired.content,
        input.profile.genre,
        finalFindings,
      )
      try {
        const secondPromptDraftContent = markLockedParagraphsInContent(protectedRepaired.content, input.lockedParagraphs)
        const secondContent = (await runChatTask({
          type: 'chapter_write',
          novelId: input.chapter.novelId,
          relatedEntityType: 'chapter',
          relatedEntityId: input.chapter.id,
          messages: [{
            role: 'user',
            content: buildChapterRewritePrompt({
              novelTitle: input.novel.title,
              genre: input.profile.genre,
              chapterNum: input.chapter.chapterNum,
              chapterTitle: input.chapter.title || getDefaultChapterTitle(input.chapter.chapterNum),
              chapterGoal: input.context.chapterGoal,
              emotionTone: input.chapter.emotionTone || '平稳',
              targetWords: input.chapter.targetWords || 3000,
              storyCore: input.storyCore,
              writingContractSummary: input.context.writingContractSummary,
              relationSummary: input.context.relationSummary,
              currentArc: input.context.currentArc,
              worldRules: input.context.worldRules,
              characterStates: input.context.characterStates,
              itemSummary: input.context.itemSummary,
              previousSummaries: input.context.previousSummaries,
              lastChapterEnding: input.context.lastChapterEnding,
              continuitySummary: input.context.continuitySummary,
              openLoops: input.context.openLoops,
              continuityNotes: input.context.continuityNotes,
              timelineSummary: input.context.timelineSummary,
              timelineOpenThreads: input.context.timelineOpenThreads,
              longTermMemory: input.context.longTermMemory,
              recalledMemory: input.context.recalledMemory,
              consistencyNotes: input.consistencyNotes,
              structuralAlertsSummary: input.structuralAlertsSummary,
              scenePlan: input.scenePlanText,
              draftContent: secondPromptDraftContent,
              reviewNotes: formatReviewNotes(secondRepairNotes),
              lockedParagraphs: input.lockedParagraphs,
              activeThreads: input.context.activeThreads,
              protagonistReference: input.profile.protagonistReference,
              protagonistRule: input.profile.protagonistRule,
              promptTier: input.promptTier,
            }),
          }],
          modelConfigId: input.novel.modelConfigId || undefined,
        })).trim()
        if (secondContent) {
          const protectedSecond = enforceLockedParagraphProtection(
            secondContent,
            input.lockedParagraphs,
            protectedRepaired.content,
            secondRepairNotes,
          )
          return { content: protectedSecond.content, reviewNotes: protectedSecond.reviewNotes }
        }
      } catch {
        // 第二轮失败时返回第一轮结果
      }
      return { content: protectedRepaired.content, reviewNotes: secondRepairNotes }
    }

    return {
      content: protectedRepaired.content,
      reviewNotes: finalFindings.length > 0
        ? enhanceReviewNotesWithGuardrails(protectedRepaired.reviewNotes, protectedRepaired.content, input.profile.genre, finalFindings)
        : protectedRepaired.reviewNotes,
    }
  } catch {
    return {
      content: originalContent,
      reviewNotes: repairNotes,
    }
  }
}

async function updateChapterContinuityState(
  chapterId: number,
  summaryData: ChapterSummaryData,
): Promise<ContinuityState> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) {
    throwUserFacingError('chapter.contentEmptyForContinuity')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const arc = chapter.arcId
    ? db.select().from(storyArcs).where(eq(storyArcs.id, chapter.arcId)).all()[0]
    : null

  const fallback = buildFallbackContinuityState(chapter, summaryData)
  let nextState = fallback

  try {
    const result = await runChatTask({
      type: 'continuity',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{
        role: 'user',
        content: buildContinuityStatePrompt({
          novelTitle: novel.title,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
          arcName: arc?.arcName || '',
          chapterGoal: extractChapterGoal(chapter.outline),
          summary: summaryData.summary,
          chapterContent: chapter.content,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const parsedResult = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'chapter',
      message: '章节连续性状态 JSON 解析失败，已回退到保底连续性摘要。',
      consoleSummary: `[chapter:warn] continuity-json chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'continuity',
      },
    })
    if (parsedResult.success && parsedResult.data) {
      nextState = normalizeContinuityState(parsedResult.data, fallback)
    }
  } catch {
    nextState = fallback
  }

  db.update(chapters).set({
    continuityStateJson: serializeContinuityState(nextState),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()

  if (arc) {
    const progressState = computeStoryArcProgressState(arc, chapter, nextState)
    db.update(storyArcs).set({
      progressPercent: progressState.progressPercent,
      stalledChapterCount: progressState.stalledChapterCount,
      lastProgressChapterNum: progressState.lastProgressChapterNum,
    }).where(eq(storyArcs.id, arc.id)).run()
    persistArcProgressWarnings(chapterId, progressState.warnings)
  }

  return nextState
}

async function updateChapterSummaryData(chapterId: number): Promise<ChapterSummaryData> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throwUserFacingError('chapter.contentEmptyForSummary')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  let summaryData: ChapterSummaryData
  try {
    const result = await runChatTask({
      type: 'summary',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{ role: 'user', content: chapterSummaryPrompt(chapter.content) }],
      modelConfigId: novel?.modelConfigId || undefined,
    })

    const parsedResult = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'chapter',
      message: '章节摘要 JSON 解析失败，已降级使用原始摘要文本。',
      consoleSummary: `[chapter:warn] summary-json chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'summary',
      },
    })
    if (parsedResult.success && parsedResult.data) {
      summaryData = {
        summary: typeof parsedResult.data.summary === 'string' ? parsedResult.data.summary.trim() : '',
        nextChapterSeed: typeof parsedResult.data.next_chapter_seed === 'string' ? parsedResult.data.next_chapter_seed.trim() : '',
      }
    } else {
      summaryData = {
        summary: result.trim(),
        nextChapterSeed: '',
      }
    }
  } catch {
    summaryData = {
      summary: chapter.content.slice(0, 180),
      nextChapterSeed: extractChapterGoal(chapter.outline),
    }
  }

  if (!summaryData.summary) {
    summaryData.summary = chapter.content.slice(0, 180)
  }

  db.update(chapters).set({
    summary: summaryData.summary,
    nextChapterSeed: summaryData.nextChapterSeed,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()

  return summaryData
}

async function refreshChapterMemory(chapterId: number): Promise<{
  summary: ChapterSummaryData
  continuity: ContinuityState
}> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const summary = await updateChapterSummaryData(chapterId)
  const continuity = await updateChapterContinuityState(chapterId, summary)
  refreshCharacterStateVersionsForChapter(chapterId)
  refreshStoryMemoryCheckpoints(chapter.novelId)
  markChapterContextCurrent(chapterId)
  return { summary, continuity }
}

async function finalizeGeneratedChapterContent(chapterId: number, content: string) {
  updateChapter(chapterId, {
    content,
    status: 'draft',
  }, {
    skipStaleTracking: true,
    versionSource: 'pipeline-generate',
  })

  const { summary } = await refreshChapterMemory(chapterId)
  const chapter = getChapter(chapterId)
  if (chapter && content.trim()) {
    await discoverEntitiesFromContent({
      novelId: chapter.novelId,
      sourcePage: 'writing',
      sourceLabel: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
      sourceEntityId: chapter.id,
      content,
    })
  }
  if (chapter) {
    markSubsequentChaptersStale(
      chapter.novelId,
      chapter.chapterNum,
      `第${chapter.chapterNum}章内容已更新`,
    )
    syncChapterTimelineStatuses(chapter.novelId, chapter.chapterNum)
  }

  return {
    chapterId,
    summary: summary.summary,
    nextChapterSeed: summary.nextChapterSeed,
    wordCount: chapter?.wordCount || 0,
    status: chapter?.status || 'draft',
  }
}

export function listChapters(novelId: number) {
  const db = getDb()
  ensureStoryStructure(novelId)
  return db.select().from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
}

export function getChapter(id: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0] || null
  if (!chapter) return null
  ensureStoryStructure(chapter.novelId)
  return chapter
}

export function createChapter(novelId: number, data: Partial<{
  chapterNum: number
  title: string
  outline: string
  targetWords: number
  emotionTone: string
  arcId: number
  volumeId: number
  partId: number
}>) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  const defaults = resolveDefaultStructure(novelId)
  const chapterNum = data.chapterNum ?? (db.select().from(chapters).where(eq(chapters.novelId, novelId)).all().length + 1)
  const result = db.insert(chapters).values({
    novelId,
    ...data,
    volumeId: data.volumeId ?? defaults.volumeId,
    partId: data.partId ?? defaults.partId,
    chapterNum,
    compiledFromSegments: 0,
    segmentCount: 0,
    contextVersion: novel?.contextVersion || 1,
    staleReasonJson: JSON.stringify([]),
  }).run()
  ensureStoryStructure(novelId)
  return Number(result.lastInsertRowid)
}

export function updateChapter(id: number, data: Partial<{
  title: string
  outline: string
  scenePlanJson: string
  content: string
  wordCount: number
  summary: string
  nextChapterSeed: string
  continuityStateJson: string
  reviewNotesJson: string
  status: string
  aiScoreJson: string
  targetWords: number
  emotionTone: string
  chapterNum: number
  arcId: number | null
  volumeId: number | null
  partId: number | null
  compiledFromSegments: number
  segmentCount: number
  contextVersion: number
  staleReasonJson: string
}>, options: { skipStaleTracking?: boolean; versionSource?: ChapterVersionSource | false } = {}) {
  const db = getDb()
  const previous = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  const versionSource = data.content !== undefined
    ? normalizeChapterVersionSource(options.versionSource)
    : null

  if (data.content !== undefined) {
    data.wordCount = countChineseWords(data.content)
  }

  db.update(chapters).set({
    ...data,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, id)).run()

  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  if (chapter) {
    const allChapters = db.select().from(chapters).where(eq(chapters.novelId, chapter.novelId)).all()
    const totalWords = allChapters.reduce((sum, item) => sum + (item.wordCount || 0), 0)
    db.update(novels).set({
      totalWords,
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, chapter.novelId)).run()
  }

  if (data.content !== undefined && chapter) {
    syncChapterToSegments(id, data.content, { createIfMissing: true })
  }

  if (chapter && versionSource) {
    createChapterVersionSnapshot(id, versionSource)
  }

  if (!options.skipStaleTracking && previous && data.content !== undefined) {
    markSubsequentChaptersStale(
      previous.novelId,
      previous.chapterNum,
      `第${previous.chapterNum}章内容已更新`,
    )
  }
}

export function deleteChapter(id: number) {
  const db = getDb()
  const current = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  db.delete(chapters).where(eq(chapters.id, id)).run()
  if (current) {
    markSubsequentChaptersStale(
      current.novelId,
      current.chapterNum - 1,
      `第${current.chapterNum}章已删除，后续章节顺序已变更`,
    )
  }
}

export function listChapterVersions(chapterId: number) {
  const db = getDb()
  return db.select().from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt), desc(chapterVersions.id))
    .all()
}

export async function restoreChapterVersion(versionId: number) {
  const db = getDb()
  const version = db.select().from(chapterVersions).where(eq(chapterVersions.id, versionId)).all()[0]
  if (!version) throwUserFacingError('chapter.versionNotFound')

  const chapter = getChapter(version.chapterId)
  if (!chapter) throwUserFacingError('chapter.correspondingNotFound')
  if ((chapter.content || '') === version.content) {
    return chapter
  }

  updateChapter(chapter.id, {
    content: version.content,
  }, {
    versionSource: 'version-restore',
  })

  await refreshChapterMemory(chapter.id)
  syncChapterTimelineStatuses(chapter.novelId, chapter.chapterNum)

  return getChapter(chapter.id)
}

export function batchUpdateChapters(
  ids: number[],
  data: {
    status?: typeof chapters.$inferSelect['status']
    arcId?: number | null
  },
) {
  const chapterIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (chapterIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    const nextStatus = typeof data.status === 'string' ? data.status : undefined
    updateChapter(row.id, {
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      ...(data.arcId !== undefined ? { arcId: data.arcId ?? null } : {}),
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_update',
    summary: `批量更新 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-update'),
    before: rows,
    after: data,
    undoPayload: {
      kind: 'chapter.batch_update',
      novelId: rows[0].novelId,
      chapters: rows,
      reason: '已撤销章节批量更新',
    },
  })

  return rows.length
}

export function batchDeleteChapters(ids: number[]) {
  const chapterIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (chapterIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum))
    .all()
  if (rows.length === 0) return 0

  const segments = db.select().from(chapterSegments)
    .where(inArray(chapterSegments.chapterId, rows.map((row) => row.id)))
    .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder))
    .all()
  const timelineAnchors = captureTimelineAnchorsForChapterIds(rows.map((row) => row.id))

  rows.forEach((row) => {
    deleteChapter(row.id)
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_delete',
    summary: `批量删除 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-delete'),
    before: rows,
    after: [],
    undoPayload: {
      kind: 'chapter.batch_delete',
      novelId: rows[0].novelId,
      chapters: rows,
      segments,
      timelineAnchors,
      reason: '已撤销章节批量删除',
    },
  })

  return rows.length
}

export function batchRenumberChapters(ids: number[], startChapterNum: number) {
  const normalizedStart = Math.max(1, Math.round(startChapterNum || 1))
  const chapterIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (chapterIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row, index) => {
    updateChapter(row.id, {
      chapterNum: normalizedStart + index,
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
  })

  markSubsequentChaptersStale(
    rows[0].novelId,
    Math.max(0, normalizedStart - 1),
    '章节顺序已批量调整',
  )

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_reindex',
    summary: `批量顺延重排 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-reindex'),
    before: rows,
    after: { startChapterNum: normalizedStart },
    undoPayload: {
      kind: 'chapter.batch_reindex',
      novelId: rows[0].novelId,
      chapters: rows,
      reason: '已撤销章节顺序调整',
    },
  })

  return rows.length
}

type ChapterComplexity = 'simple' | 'standard' | 'key'
type ChapterContextStage = 'scenePlan' | 'draft' | 'review' | 'rewrite'

interface ChapterComplexityInput {
  chapter: typeof chapters.$inferSelect
  currentArc: typeof storyArcs.$inferSelect | null
  chapterRows: Array<typeof chapters.$inferSelect>
  outlineMentionedCharacterCount: number
  activeThreadPressureCount: number
}

function classifyChapterComplexity(input: ChapterComplexityInput): ChapterComplexity {
  const { chapter, currentArc, chapterRows, outlineMentionedCharacterCount, activeThreadPressureCount } = input
  const outline = chapter.outline || ''
  const emotionTone = (chapter.emotionTone || '').toLowerCase()
  const maxChapterNum = chapterRows.reduce((max, row) => Math.max(max, row.chapterNum), 0)
  const isArcCheckpoint = Boolean(buildArcProgressCheckpoint(currentArc, chapter.chapterNum))
  const isArcEnding = Boolean(currentArc && typeof currentArc.chapterEnd === 'number' && currentArc.chapterEnd === chapter.chapterNum)
  const isFirstChapter = chapter.chapterNum === 1
  const isLastChapter = maxChapterNum > 0 && chapter.chapterNum === maxChapterNum

  if (
    emotionTone.includes('高潮') ||
    emotionTone.includes('climax') ||
    emotionTone.includes('爆发') ||
    emotionTone.includes('转折') ||
    emotionTone.includes('结局') ||
    emotionTone.includes('决战') ||
    isFirstChapter ||
    isLastChapter ||
    isArcCheckpoint ||
    isArcEnding ||
    outlineMentionedCharacterCount > 3 ||
    activeThreadPressureCount >= 4
  ) {
    return 'key'
  }

  if (
    (emotionTone.includes('过渡') || emotionTone.includes('日常') || emotionTone.includes('平缓') || emotionTone.includes('铺垫')) &&
    outline.length > 0 &&
    outline.length < 200 &&
    outlineMentionedCharacterCount <= 2 &&
    activeThreadPressureCount <= 2 &&
    !isFirstChapter &&
    !isLastChapter &&
    !isArcCheckpoint &&
    !isArcEnding
  ) {
    return 'simple'
  }

  return 'standard'
}

function resolveContextBudgetForStage(
  stage: ChapterContextStage,
  complexity: ChapterComplexity,
  targetWords: number,
  novelTargetWords?: number,
): number {
  const baseByStage: Record<ChapterContextStage, number> = {
    scenePlan: 10000,
    draft: 12000,
    review: 10000,
    rewrite: 13500,
  }
  const complexityOffset: Record<ChapterComplexity, number> = {
    simple: -1200,
    standard: 0,
    key: 1800,
  }
  const largeChapterOffset = targetWords >= 5000
    ? 1200
    : targetWords >= 3500
      ? 400
      : 0

  // 长篇小说需要更多上下文预算来维持连贯性
  const novelScaleOffset = !novelTargetWords ? 0
    : novelTargetWords >= 1500000 ? 4000
    : novelTargetWords >= 800000 ? 2800
    : novelTargetWords >= 500000 ? 1600
    : novelTargetWords >= 300000 ? 800
    : 0

  return Math.max(7000, baseByStage[stage] + complexityOffset[complexity] + largeChapterOffset + novelScaleOffset)
}

export async function generateChapterContent(chapterId: number, sender?: WebContents): Promise<number> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const novel = rawContext.novel
  const profile = rawContext.profile
  const consistencyNotes = buildConsistencyPromptSummary(buildNovelConsistencyReport(chapter.novelId))
  const complexity = classifyChapterComplexity({
    chapter,
    currentArc: rawContext.currentArc,
    chapterRows: rawContext.chapterRows,
    outlineMentionedCharacterCount: rawContext.outlineMentionedCharacterCount,
    activeThreadPressureCount: rawContext.activeThreadPressureCount,
  })
  const novelTargetWords = novel.targetWords || 0
  const stageContext = (promptProfile: ChapterContextStage) => allocateChapterContext(rawContext, {
    promptProfile,
    chapterComplexity: complexity,
    totalBudget: resolveContextBudgetForStage(promptProfile, complexity, chapter.targetWords || 3000, novelTargetWords),
  })
  const scenePlanContext = stageContext('scenePlan')
  const draftContext = stageContext('draft')
  const reviewContext = stageContext('review')
  const rewriteContext = stageContext('rewrite')
  const buildWritingGuidance = (styleTemplate: string) => [
    styleTemplate ? `Writing style guide:\n${styleTemplate}` : '',
    consistencyNotes,
  ].filter(Boolean).join('\n\n')
  const draftWritingGuidance = buildWritingGuidance(draftContext.styleTemplate)
  const rewriteWritingGuidance = buildWritingGuidance(rewriteContext.styleTemplate)
  const previousStatus = chapter.status || 'outline'
  const fallbackScenePlan = buildFallbackScenePlan(chapter)
  const storyCore = buildStoryCore(profile, rewriteContext.storyCore || draftContext.storyCore || scenePlanContext.storyCore)
  const currentArcRow = rawContext.currentArc
  const latestArcProgressNote = getLatestArcProgressNote(chapter.novelId, currentArcRow, chapter.chapterNum)
  const structuralAlertsSummary = buildStructuralAlertsSummary(chapter.novelId, chapter.chapterNum, chapter.volumeId)

  updateChapter(chapterId, {
    status: 'writing',
    scenePlanJson: '',
    reviewNotesJson: '',
  })

  try {
    sendGenerationProgress(sender, {
      chapterId,
      stage: 'planning',
      label: '场景规划',
      detail: '先把本章拆成可执行的场景链。',
      completed: 1,
      total: 4,
      status: 'running',
    })

    const scenePlanResult = await runChatTask({
      type: 'chapter_scene_plan',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{
        role: 'user',
        content: buildScenePlanPrompt({
          novelTitle: novel.title,
          genre: profile.genre,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
          chapterGoal: scenePlanContext.chapterGoal,
          plotPoints: chapter.outline || '',
          emotionTone: chapter.emotionTone || '平稳',
          targetWords: chapter.targetWords || 3000,
          storyCore,
          writingContractSummary: scenePlanContext.writingContractSummary,
          relationSummary: scenePlanContext.relationSummary,
          currentArc: scenePlanContext.currentArc,
          worldRules: scenePlanContext.worldRules,
          characterStates: scenePlanContext.characterStates,
          itemSummary: scenePlanContext.itemSummary,
          previousSummaries: scenePlanContext.previousSummaries,
          lastChapterEnding: scenePlanContext.lastChapterEnding,
          continuitySummary: scenePlanContext.continuitySummary,
          openLoops: scenePlanContext.openLoops,
          continuityNotes: scenePlanContext.continuityNotes,
          timelineSummary: scenePlanContext.timelineSummary,
          timelineOpenThreads: scenePlanContext.timelineOpenThreads,
          longTermMemory: scenePlanContext.longTermMemory,
          recalledMemory: scenePlanContext.recalledMemory,
          consistencyNotes,
          activeThreads: scenePlanContext.activeThreads,
          protagonistReference: profile.protagonistReference,
          protagonistRule: profile.protagonistRule,
          promptTier: complexity,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })
    const scenePlanParse = parseAiJsonResult<unknown>(scenePlanResult, 'array', {
      channel: 'chapter',
      message: '章节场景规划 JSON 解析失败，已回退到后备场景计划继续生成。',
      consoleSummary: `[chapter:warn] scene-plan-json-fallback chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'scene-plan',
      },
    })
    const scenePlan = scenePlanParse.success
      ? normalizeScenePlan(scenePlanParse.data, fallbackScenePlan)
      : fallbackScenePlan

    updateChapter(chapterId, { scenePlanJson: JSON.stringify(scenePlan) })
    const scenePlanText = formatScenePlan(scenePlan)

    sendGenerationProgress(sender, {
      chapterId,
      stage: 'drafting',
      label: '正文初稿',
      detail: '按场景计划生成第一版正文。',
      completed: 2,
      total: 4,
      status: 'running',
    })

    const draftContent = await runChatTask({
      type: 'chapter_draft',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{
        role: 'user',
        content: buildChapterDraftPrompt({
          novelTitle: novel.title,
          genre: profile.genre,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
          chapterGoal: draftContext.chapterGoal,
          emotionTone: chapter.emotionTone || '平稳',
          targetWords: chapter.targetWords || 3000,
          storyCore,
          writingContractSummary: draftContext.writingContractSummary,
          relationSummary: draftContext.relationSummary,
          currentArc: draftContext.currentArc,
          worldRules: draftContext.worldRules,
          characterStates: draftContext.characterStates,
          itemSummary: draftContext.itemSummary,
          previousSummaries: draftContext.previousSummaries,
          lastChapterEnding: draftContext.lastChapterEnding,
          continuitySummary: draftContext.continuitySummary,
          openLoops: draftContext.openLoops,
          continuityNotes: draftContext.continuityNotes,
          timelineSummary: draftContext.timelineSummary,
          timelineOpenThreads: draftContext.timelineOpenThreads,
          longTermMemory: draftContext.longTermMemory,
          recalledMemory: draftContext.recalledMemory,
          consistencyNotes: draftWritingGuidance,
          structuralAlertsSummary,
          scenePlan: scenePlanText,
          draftContent: '',
          reviewNotes: '',
          activeThreads: draftContext.activeThreads,
          protagonistReference: profile.protagonistReference,
          protagonistRule: profile.protagonistRule,
          promptTier: complexity,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })
    const lockedParagraphContext = buildLockedParagraphContext(chapter, draftContent)

    sendGenerationProgress(sender, {
      chapterId,
      stage: 'reviewing',
      label: '自动审校',
      detail: '检查承接、事件顺序和语言问题。',
      completed: 3,
      total: 4,
      status: 'running',
    })

    let reviewNotes = buildFallbackReviewNotes(consistencyNotes)

    {
      // 所有章节都启用AI审校，确保百万字规模下质量一致
      const reviewResult = await runChatTask({
        type: 'chapter_review',
        novelId: chapter.novelId,
        relatedEntityType: 'chapter',
        relatedEntityId: chapterId,
        messages: [{
          role: 'user',
          content: buildChapterReviewPrompt({
            novelTitle: novel.title,
            genre: profile.genre,
            chapterNum: chapter.chapterNum,
            chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
            chapterGoal: reviewContext.chapterGoal,
            storyCore,
            writingContractSummary: reviewContext.writingContractSummary,
            relationSummary: reviewContext.relationSummary,
            currentArc: reviewContext.currentArc,
            worldRules: reviewContext.worldRules,
            characterStates: reviewContext.characterStates,
            itemSummary: reviewContext.itemSummary,
            continuitySummary: reviewContext.continuitySummary,
            openLoops: reviewContext.openLoops,
            timelineSummary: reviewContext.timelineSummary,
            longTermMemory: reviewContext.longTermMemory,
            recalledMemory: reviewContext.recalledMemory,
            consistencyNotes,
            structuralAlertsSummary,
            arcProgress: latestArcProgressNote,
            arcProgressStatus: buildArcProgressStatus(currentArcRow, chapter.chapterNum),
            arcProgressCheckpoint: buildArcProgressCheckpoint(currentArcRow, chapter.chapterNum),
            scenePlan: scenePlanText,
            draftContent,
            protagonistReference: profile.protagonistReference,
            protagonistRule: profile.protagonistRule,
            promptTier: complexity,
          }),
        }],
        modelConfigId: novel.modelConfigId || undefined,
      })

      const reviewParse = parseAiJsonResult<unknown>(reviewResult, 'object', {
        channel: 'chapter',
        message: '章节审校 JSON 解析失败，已回退到后备审校意见继续生成。',
        consoleSummary: `[chapter:warn] review-json-fallback chapter=${chapterId}`,
        context: {
          chapterId,
          novelId: chapter.novelId,
          stage: 'review',
        },
      })
      if (reviewParse.success) {
        const normalizedNotes = normalizeReviewNotes(reviewParse.data)
        reviewNotes = hasReviewNotes(normalizedNotes) ? normalizedNotes : reviewNotes
      }
    }

    reviewNotes = enhanceReviewNotesWithGuardrails(reviewNotes, draftContent, profile.genre)
    reviewNotes = applyDialogueAnalysisToReviewNotes(reviewNotes, chapter.novelId, chapter.chapterNum, draftContent)
    updateChapter(chapterId, { reviewNotesJson: JSON.stringify(reviewNotes) })

    sendGenerationProgress(sender, {
      chapterId,
      stage: 'rewriting',
      label: '定稿润色',
      detail: '根据审校意见重写成可直接入稿的版本。',
      completed: 4,
      total: 4,
      status: 'running',
    })

    const prompt = buildChapterRewritePrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
      chapterGoal: rewriteContext.chapterGoal,
      emotionTone: chapter.emotionTone || '平稳',
      targetWords: chapter.targetWords || 3000,
      storyCore,
      writingContractSummary: rewriteContext.writingContractSummary,
      relationSummary: rewriteContext.relationSummary,
      currentArc: rewriteContext.currentArc,
      worldRules: rewriteContext.worldRules,
      characterStates: rewriteContext.characterStates,
      itemSummary: rewriteContext.itemSummary,
      previousSummaries: rewriteContext.previousSummaries,
      lastChapterEnding: rewriteContext.lastChapterEnding,
      continuitySummary: rewriteContext.continuitySummary,
      openLoops: rewriteContext.openLoops,
      continuityNotes: rewriteContext.continuityNotes,
      timelineSummary: rewriteContext.timelineSummary,
      timelineOpenThreads: rewriteContext.timelineOpenThreads,
      longTermMemory: rewriteContext.longTermMemory,
      recalledMemory: rewriteContext.recalledMemory,
      consistencyNotes: rewriteWritingGuidance,
      structuralAlertsSummary,
      scenePlan: scenePlanText,
      draftContent: lockedParagraphContext.promptDraftContent,
      reviewNotes: formatReviewNotes(reviewNotes),
      lockedParagraphs: lockedParagraphContext.lockedParagraphs,
      activeThreads: rewriteContext.activeThreads,
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
      promptTier: complexity,
    })

    const messages = [{ role: 'user' as const, content: prompt }]

    return runStreamTask({
      type: 'chapter_write',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(messages),
      messages,
      modelConfigId: novel.modelConfigId || undefined,
      sender,
      onSuccess: async (output) => {
        const protectedOutput = enforceLockedParagraphProtection(
          output,
          lockedParagraphContext.lockedParagraphs,
          lockedParagraphContext.initialFallbackContent,
          reviewNotes,
        )
        const repaired = await repairChapterOutputIfNeeded({
          chapter,
          novel,
          context: rewriteContext,
          storyCore,
          profile,
          scenePlanText,
          consistencyNotes: rewriteWritingGuidance,
          structuralAlertsSummary,
          reviewNotes: protectedOutput.reviewNotes,
          content: protectedOutput.content,
          lockedParagraphs: lockedParagraphContext.lockedParagraphs,
          promptTier: complexity,
        })
        const repairedReviewNotes = applyDialogueAnalysisToReviewNotes(
          repaired.reviewNotes,
          chapter.novelId,
          chapter.chapterNum,
          repaired.content,
        )

        if (repairedReviewNotes !== reviewNotes) {
          updateChapter(chapterId, { reviewNotesJson: JSON.stringify(repairedReviewNotes) })
        }

        const result = await finalizeGeneratedChapterContent(chapterId, repaired.content)
        scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)

        // Async: generate embeddings for vector memory retrieval (non-blocking)
        const chapterRecord = getChapter(chapterId)
        if (chapterRecord) {
          generateChapterEmbeddings(chapterRecord.novelId, chapterId, novel?.modelConfigId || undefined)
            .catch((err) => console.warn('[embedding] 向量生成失败（不影响主流程）:', err))
        }

        sendGenerationProgress(sender, {
          chapterId,
          stage: 'completed',
          label: '完成入稿',
          detail: '章节已完成自动修订，并写入摘要与连续性记忆。',
          completed: 4,
          total: 4,
          status: 'success',
        })
        return result
      },
    })
  } catch (error) {
    updateChapter(chapterId, { status: previousStatus })
    sendGenerationProgress(sender, {
      chapterId,
      stage: 'failed',
      label: '生成失败',
      detail: error instanceof Error ? error.message : '章节生成中断',
      completed: 0,
      total: 4,
      status: 'failed',
    })
    throw error
  }
}

export async function generateChapterSummary(chapterId: number): Promise<void> {
  await refreshChapterMemory(chapterId)
}

export async function aiCheckChapter(chapterId: number): Promise<unknown> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throwUserFacingError('chapter.contentEmpty')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  const content = chapter.content
  const isTruncated = content.length > 6000
  const textToCheck = isTruncated
    ? `${content.slice(0, 3200)}\n\n……\n\n${content.slice(-2400)}`
    : content

  const result = await runChatTask({
    type: 'ai_check',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    messages: [{ role: 'user', content: aiCheckPrompt(textToCheck, isTruncated) }],
    modelConfigId: novel?.modelConfigId || undefined,
  })

  try {
    const parsedResult = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'chapter',
      message: '章节 AI 体检 JSON 解析失败，已降级返回原始文本。',
      consoleSummary: `[chapter:warn] ai-check-json chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'ai-check',
      },
    })
    const enhancedScore = enhanceAiScoreResult(parsedResult.success ? parsedResult.data : {}, content)
    db.update(chapters).set({
      aiScoreJson: JSON.stringify(enhancedScore),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    return enhancedScore
  } catch {
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    return enhanceAiScoreResult({}, content)
  }
}

export { runChapterPublishCheck }
