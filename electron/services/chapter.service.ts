import type { ProgressSink } from '../utils/progress-sink'
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapterContracts, chapterSegments, chapterVersions, chapters, chapterWritebackRuns, characters, glossary, genres, novels, revisionTasks, sceneContracts, storyArcs, storyParts, storyVolumes, tasks } from '../database/schema'
import { parseAiJsonResult } from '../utils/json'
import { aiCheckPrompt, chapterSummaryPrompt } from './prompts'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { normalizeAiExecutionMode } from '../../src/shared/ai-execution'
import { resolveChapterPipelineResumeMode } from '../../src/shared/chapter-resume-policy'
import {
  ChapterContext,
  buildStoryProfile,
  collectChapterContextRawData,
  ContinuityState,
  type StoryProfile,
  type HardConstraintSourceLabel,
} from './context.service'
import {
  buildChapterWritingPrompt,
  buildContinuityStatePrompt,
} from './story-prompts'
import { syncNovelLifecycleStatus } from './novel-lifecycle.service'
import { buildChapterGenerationRequestKey, isRetryableChapterGenerationStatus } from './chapter-generation-idempotency'
import {
  cancelTask,
  createTask,
  executeStreamTask,
  getTaskRecord,
  parseTaskControl,
  runChatTask,
  TaskRecoveryHint,
  updateTask,
  updateTaskProgress,
  updateTaskStatus,
} from './task.service'
import {
  hashWorkflowNodeInput,
  prepareWorkflowNodeRetry,
} from './workflow-node.service'
import { buildConsistencyPromptSummary, buildNovelConsistencyReport } from './consistency.service'
import { syncChapterTimelineStatuses } from './link-sync.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  collectQualityGuardrailFindings,
  formatQualityGuardrailSummary,
} from '../../src/shared/content-guardrails'
import {
  buildChapterOptimizationQualityGate,
  buildChapterStructuralRepairGate,
} from '../../src/shared/chapter-optimization-quality'
import {
  markChapterContextCurrent,
  markSubsequentChaptersStale,
  getChapterContractBlockers,
  runChapterPublishCheck,
  validateChapterContractsForGeneration,
} from './context-impact.service'
import {
  refreshStoryMemoryCheckpoints,
  refreshStoryMemoryCheckpointsIfNeeded,
} from './story-memory.service'
import {
  ensureStoryStructure,
  normalizeChapterNumbers,
  resolveDefaultStructure,
  syncChapterToSegments,
} from './story-structure.service'
import { syncTimelineStructureAnchors } from './timeline.service'
import { discoverEntitiesFromContent } from './entity-discovery.service'
import { prepareChapterWritebackRun } from './chapter-writeback.service'
import { buildBatchKey, captureTimelineAnchorsForChapterIds, createOperationLog } from './history.service'
import { assertCreativeStageContextReadyForGeneration } from './creative-stage.service'
import { captureChapterNumberReferenceSnapshot } from './chapter-number-remap.service'
import { enhanceAiScoreResult, toChapterAiCheckResult } from './ai-score.service'
import { scheduleDialogueFingerprintRefresh } from './dialogue-fingerprint.service'
import {
  buildHookContinuitySnapshot,
  buildStoryPacingCurve,
} from './generation-integrity.service'
import {
  analyzeExpressionDedupForChapter,
} from './expression-dedup.service'
import { refreshSummaryHealthSemantic } from './summary-decay.service'
import { maybeRefreshNovelStyleFingerprint } from './style-analysis.service'
import {
  buildAiModelRouteReport,
  buildChatOptionsFromRoute,
  resolveAiExecutionMode,
} from './ai-engine.service'
import { refreshCharacterStateVersionsForChapter } from './character-state.service'
import { syncCharacterArcsFromChapterState } from './character-arc.service'
import {
  refreshWorldStateVersionsForChapter,
  refreshWorldStateVersionsForNovel,
  refreshWorldStateVersionsFromChapter,
} from './world-state.service'
import {
  remapChapterNumberReferences,
  deleteChapterSegmentsCascade,
} from './data-cascade.service'
import {
  formatStoryArcProgressStatus,
  getStoryArcProgressSnapshot,
  getStoryArcStatusContext,
  getStoryArcWarningsForChapter,
} from './story-arc-progress.service'
import { persistChapterRecallRuntimeSnapshot } from './chapter-recall-runtime.service'
import { persistAntiAiRuleHits } from './anti-ai-rule.service'
import { syncFeedbackRecurrenceState } from './feedback-recurrence.service'
import {
  buildAdaptiveRewritePolicy,
  buildDialogueRepairDirective,
  buildReviewPriorityPrompt,
  buildReviewPrioritySummary,
} from './chapter-pipeline-policy.service'
import {
  buildChapterContentHash,
  buildChapterPipelineRetryPlan,
  buildChapterPipelineResumeRetryMetadata,
  checkpointChapterPipelineContent,
  createInitialChapterPipelineSnapshot,
  getCompletedChapterPipelineRoleCount,
  inferChapterPipelineResumeReason,
  isChapterPipelineRole,
  parseChapterPipelineSnapshot,
  validateChapterPipelineResumeBase,
  type ChapterGenerationStage,
  type ChapterPipelineFailureCode,
  type ChapterPipelineRole,
  type ChapterPipelineSnapshot,
} from './chapter-pipeline-state'
import {
  checkpointChapterPipelineContextVersion,
  commitChapterPipelineSuccess,
  commitPlannerStageOutput,
  commitRewriterStageOutput,
  createChapterPipelineSession,
  type ChapterPipelineSession,
} from './chapter-pipeline-session'
import {
  buildPipelineFailureOutput,
  ChapterPipelineStageError,
} from './chapter-pipeline-errors'
import {
  allocateStageContextForPipeline,
  allocateDraftContextWithWriterFallback,
  applyUpstreamArtifactsToRawContext,
  buildArcProgressCheckpoint,
  buildContractVersionArtifactSummary,
  buildReviewProofArtifactSummary,
  buildReviewRiskArtifactSummary,
  buildRewriteDeltaArtifactSummary,
  buildStageContextMap,
  buildStepMemorySummary,
  classifyChapterComplexity,
  createChapterPipelinePromptGuidance,
  getActiveChapterPromptOverrideKeys,
  logConstraintInjectionStatus,
  prepareChapterPipelineStageContexts,
  resolveChapterReferenceWords,
  resolveContextBudgetForStage,
  resolveStageContextForPipeline,
  resolveWriterContextForStage,
  summarizeStageArtifactLines,
  summarizeStageArtifactText,
  type ChapterContextStage,
  type ChapterComplexity,
  type ChapterPipelinePromptGuidanceBundle,
  type StageContextResolverPayload,
} from './chapter-pipeline-context'
import {
  executeChapterCriticRuntimePhase,
  executeChapterEnforcerRuntimePhase,
  executeChapterPlannerRuntimePhase,
  executeChapterWriterRuntimePhase,
} from './chapter-pipeline-orchestrator'
import {
  buildChapterAiStageReports,
  buildChapterPipelineObservability,
  buildChapterPipelineStageObservability,
} from './chapter-pipeline-observability'
import {
  assertContractDrivenStageInputs,
  buildLockedParagraphContext,
} from './chapter-pipeline-writer'
import {
  createChapterRewriterMessageBuilder,
  createRewriterStreamAttemptRunner,
  processChapterRewriteOutcome,
  RepairSemanticEvaluator,
  runRewriterQualityPipeline,
  runRewriteRiskRecheck,
} from './chapter-pipeline-rewriter'
import {
  executeChapterFinalizePhase,
  finalizeChapterPipelineOutput,
} from './chapter-pipeline-finalize'
import type {
  AiExecutionMode,
  AiContextAssemblyReport,
  AuthorStyleLockSummary,
  ChapterOptimizeResult,
  SummaryHealthReport,
  UpstreamRuntimeArtifacts,
  WritingContextUsageSnapshot,
} from '../../src/types'
import {
  appendRevisionBrief,
  applyDialogueAnalysisToReviewNotes,
  asText,
  buildFallbackReviewNotes,
  buildStructuralAlertsSummary,
  dedupeTextList,
  formatReviewNotes,
  hasReviewNotes,
  loadNarrativeContractSignals,
  loadNarrativeControlSceneSnapshots,
  mergeSeverity,
  parseStoredReviewNotes,
  toStringArray,
  type ChapterReviewNotes,
} from './chapter-review-notes'
import type { SemanticGateReview } from '../../src/shared/semantic-gate'
import {
  resolveSemanticGatePolicy,
  type SemanticGateMode,
} from '../../src/shared/semantic-gate-policy'
import { getUnresolvedDesignGateFlags } from './outline-design-gate.service'
import { getChapterRhythmSection } from './rhythm-template.service'
import { scanChapterForGlossaryTerms } from './glossary-reference.service'
import {
  buildFallbackScenePlan,
  extractChapterGoal,
  formatScenePlan,
  getDefaultChapterTitle,
  normalizeScenePlan,
  type ScenePlanStep,
} from './chapter-scene-plan'
import {
  buildChapterOptimizationFactGuard,
  buildChapterOptimizationPrompt,
  collectNarrativeStateWarnings,
  collectSupportingCastNames,
  collectTrackedEntityNames,
  collectUnsupportedNarrativeFactWarnings,
  extractNarrativeNumbers,
  normalizeOptimizedChapterContent,
} from './chapter-optimization-guards'
import type { ChapterPublishCheck } from './chapter-publish-types'

interface ChapterSummaryData {
  summary: string
  nextChapterSeed: string
}

interface ChapterGenerationProgressEvent {
  chapterId: number
  taskId?: number
  streamTaskId?: number
  role?: ChapterPipelineRole
  stage: ChapterGenerationStage
  label: string
  detail?: string
  completed: number
  total: number
  status: 'running' | 'success' | 'failed' | 'cancelled'
  pipeline?: ChapterPipelineSnapshot
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

function countChineseWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
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
  sender: ProgressSink | undefined,
  payload: ChapterGenerationProgressEvent,
) {
  sender?.send('chapter:generation-progress', payload)
}

function buildChapterWorkspacePath(novelId: number, page: string, chapterId: number, extra?: Record<string, string | number | undefined>) {
  const params = new URLSearchParams({ chapterId: String(chapterId) })
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  return `/novels/${novelId}/${page}?${params.toString()}`
}

function buildChapterPipelineRecoveryHint(
  novelId: number,
  chapterId: number,
  role: ChapterPipelineRole,
  failureCode?: ChapterPipelineFailureCode,
): TaskRecoveryHint {
  if (
    failureCode === 'context_overflow'
    || failureCode === 'empty_output'
    || failureCode === 'invalid_output'
    || failureCode === 'anti_ai_failed'
    || failureCode === 'gate_rewrite_required'
    || failureCode === 'human_review_required'
  ) {
    return {
      kind: 'resume',
      label: '继续章节流水线',
      description: '从当前失败阶段重新拉起整条章节流水线，并重新读取最新合同、上下文版本和锁定段落。',
    }
  }

  if (failureCode === 'contract_blocked') {
    return {
      kind: 'open_page',
      label: '重跑章节合同',
      description: '打开章节合同页，先修正合同或场景约束，再重新启动正文流水线。',
      path: buildChapterWorkspacePath(novelId, 'contracts', chapterId),
    }
  }

  if (failureCode === 'canon_failed' || failureCode === 'canon_pending') {
    return {
      kind: 'open_page',
      label: '重做 Canon 回写',
      description: '打开章后状态回写中心，检查 Canon 候选并重新生成或处理失败项。',
      path: buildChapterWorkspacePath(novelId, 'writeback', chapterId),
    }
  }

  switch (role) {
    case 'planner':
      return {
        kind: 'open_page',
        label: '重跑章节合同',
        description: '打开章节合同页，先修正合同或场景约束，再重新启动正文流水线。',
        path: buildChapterWorkspacePath(novelId, 'contracts', chapterId),
      }
    case 'canonizer':
      return {
        kind: 'open_page',
        label: '重做 Canon 回写',
        description: '打开章后状态回写中心，检查 Canon 候选并重新生成或处理失败项。',
        path: buildChapterWorkspacePath(novelId, 'writeback', chapterId),
      }
    case 'critic':
      return {
        kind: 'open_page',
        label: '回到审校视图',
        description: '返回正文写作页，重点检查审校建议、验收门和当前章节风险。',
        path: buildChapterWorkspacePath(novelId, 'writing', chapterId, { insight: 'review' }),
      }
    case 'finalize':
      return {
        kind: 'open_page',
        label: '回到写作页复核',
        description: '返回正文写作页，重新检查章节内容、摘要与连续性状态，再重新运行流水线。',
        path: buildChapterWorkspacePath(novelId, 'writing', chapterId),
      }
    case 'writer':
    case 'rewriter':
    default:
      return {
        kind: 'open_page',
        label: '重写正文',
        description: '返回正文写作页，调整当前章节内容或提示后重新启动流水线。',
        path: buildChapterWorkspacePath(novelId, 'writing', chapterId),
      }
  }
}

function serializeTaskRecoveryHint(hint?: TaskRecoveryHint): string | undefined {
  return hint ? JSON.stringify(hint) : undefined
}

function buildContinuationPrompt(basePrompt: string, partialContent: string): string {
  const normalized = partialContent.trim()
  if (!normalized) return basePrompt
  return [
    basePrompt,
    '【续写要求】',
    '下面这段正文是当前章节已经生成并保留的部分。你必须把它视为已确认内容，只能从末尾继续向后写，不要重写、改写、总结或重复前文。',
    '如果前文已经完成了某个场景，就直接承接最后一个有效动作、情绪或冲突点继续推进。',
    '继续写到本章自然收束，仍然要满足本章目标、合同约束、人物状态、世界规则和时间线要求。',
    '【已保留正文】',
    normalized,
  ].join('\n\n')
}

function sendPipelineProgress(
  sender: ProgressSink | undefined,
  snapshot: ChapterPipelineSnapshot,
  payload: Pick<ChapterGenerationProgressEvent, 'stage' | 'label' | 'detail' | 'status'> & { role?: ChapterPipelineRole },
) {
  const totalRoles = Object.keys(snapshot.roles).length
  sendGenerationProgress(sender, {
    chapterId: snapshot.chapterId,
    taskId: snapshot.workflowTaskId,
    streamTaskId: snapshot.streamTaskId,
    role: payload.role ?? snapshot.currentRole ?? undefined,
    stage: payload.stage,
    label: payload.label,
    detail: payload.detail,
    completed: Math.min(getCompletedChapterPipelineRoleCount(snapshot), totalRoles),
    total: totalRoles,
    status: payload.status,
    pipeline: snapshot,
  })
}

function isChapterPipelineAbortError(taskId: number, error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const task = getTaskRecord(taskId)
  return Boolean(task && parseTaskControl(task).cancelRequested)
}

function getChapterContractPreviewGate(chapterId: number): {
  ready: boolean
  blockers: string[]
} {
  const blockers = getChapterContractBlockers(chapterId)
  return { ready: blockers.length === 0, blockers }
}

function buildChapterContractVersion(chapterId: number, options: { allowMissing?: boolean } = {}): string {
  const db = getDb()
  const chapterContract = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.id))
    .all()

  if (!chapterContract) {
    if (options.allowMissing) return `missing:chapter:${chapterId}`
    throwUserFacingError('chapter.contractRequiredForPipeline')
  }

  const sceneVersion = sceneRows
    .map((row) => `${row.id}:${row.status || 'draft'}:${row.updatedAt || row.createdAt || ''}`)
    .join('|')

  return [
    `chapter:${chapterContract.id}`,
    chapterContract.status || 'draft',
    chapterContract.updatedAt || chapterContract.createdAt || '',
    `scenes:${sceneRows.length}`,
    sceneVersion,
  ].join('#')
}

function buildStoryCore(profile: Awaited<ReturnType<typeof buildStoryProfile>>, fallback?: string): string {
  if (fallback?.trim()) {
    return [profile.projectBriefSummary, fallback].filter(Boolean).join('\n\n')
  }
  return [
    profile.projectBriefSummary,
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.endgameDesignSummary,
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

function buildArcProgressStatus(
  arc: typeof storyArcs.$inferSelect | null,
  chapterNum: number,
): string {
  if (!arc) return ''
  const snapshot = getStoryArcProgressSnapshot(arc.novelId)
  const { summary, point } = getStoryArcStatusContext(snapshot, arc.id, chapterNum)
  return formatStoryArcProgressStatus(summary, point)
}

function syncDialogueDriftRevisionTasks(novelId: number): number {
  const db = getDb()
  const now = new Date().toISOString()
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    reviewNotesJson: chapters.reviewNotesJson,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const characterNameById = new Map(
    db.select({
      id: characters.id,
      fullName: characters.fullName,
    }).from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.fullName || `角色#${row.id}`] as const),
  )
  const activeDriftMap = new Map<number, { chapterNums: number[]; severity: 'medium' | 'high'; detail: string }>()

  for (let index = 1; index < chapterRows.length; index += 1) {
    const previous = chapterRows[index - 1]
    const current = chapterRows[index]
    if (current.chapterNum - previous.chapterNum !== 1) continue
    const previousNotes = parseStoredReviewNotes(previous.reviewNotesJson)
    const currentNotes = parseStoredReviewNotes(current.reviewNotesJson)
    const previousByCharacter = new Map(previousNotes.dialogue_drift_alerts.map((item) => [item.characterId, item] as const))
    currentNotes.dialogue_drift_alerts.forEach((item) => {
      const prior = previousByCharacter.get(item.characterId)
      if (!prior) return
      activeDriftMap.set(item.characterId, {
        chapterNums: [previous.chapterNum, current.chapterNum],
        severity: item.driftRate >= 60 || prior.driftRate >= 60 ? 'high' : 'medium',
        detail: `第${previous.chapterNum}章与第${current.chapterNum}章连续检测到${item.characterName}口吻漂移：${item.reason || prior.reason || '需要回看称呼、句长、停顿和口头禅。'}`,
      })
    })
  }

  const existingRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => asText(row.taskSource) === 'system')
    .filter((row) => asText(row.issueKey).startsWith('dialogue_drift:'))
  const existingByKey = new Map(existingRows.map((row) => [asText(row.issueKey), row] as const))
  const activeKeys = new Set<string>()

  activeDriftMap.forEach((entry, characterId) => {
    const characterName = characterNameById.get(characterId) || `角色#${characterId}`
    const issueKey = `dialogue_drift:${characterId}`
    const title = `[对白漂移] ${characterName} 连续两章口吻偏移`
    const fixBrief = `回查 ${entry.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}，补人物卡 speechPattern / catchphrases / dialectFeatures，并把 ${characterName} 的 voice lock 升级到下一章硬约束。`
    const originMetaJson = JSON.stringify({
      issueCategory: 'dialogue_drift',
      characterId,
      characterName,
      chapterNums: entry.chapterNums,
      suggestion: fixBrief,
    })
    const existing = existingByKey.get(issueKey)
    activeKeys.add(issueKey)

    if (!existing) {
      db.insert(revisionTasks).values({
        novelId,
        taskSource: 'system',
        issueKey,
        taskType: 'continuity',
        status: 'open',
        severity: entry.severity,
        title,
        description: entry.detail,
        fixBrief,
        relatedPage: 'writing',
        entityType: 'character',
        entityId: characterId,
        chapterId: null,
        originMetaJson,
        lastDetectedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      return
    }

    const nextStatus = asText(existing.status) === 'ignored'
      ? 'ignored'
      : asText(existing.status) === 'resolved'
        ? 'open'
        : asText(existing.status) || 'open'
    db.update(revisionTasks).set({
      status: nextStatus,
      severity: entry.severity,
      title,
      description: entry.detail,
      fixBrief,
      relatedPage: 'writing',
      entityType: 'character',
      entityId: characterId,
      chapterId: null,
      originMetaJson,
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
  })

  existingRows
    .filter((row) => {
      const issueKey = asText(row.issueKey)
      return issueKey && !activeKeys.has(issueKey)
    })
    .forEach((row) => {
      const currentStatus = asText(row.status)
      if (currentStatus === 'ignored' || currentStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })

  return activeKeys.size
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
  _currentContinuity: ContinuityState,
): { progressPercent: number; stalledChapterCount: number; lastProgressChapterNum: number | null; warnings: string[] } {
  const snapshot = getStoryArcProgressSnapshot(currentChapter.novelId)
  const { summary } = getStoryArcStatusContext(snapshot, arc.id, currentChapter.chapterNum)
  return {
    progressPercent: summary?.progressPercent || 0,
    stalledChapterCount: summary?.stalledChapterCount || 0,
    lastProgressChapterNum: summary?.lastProgressChapterNum ?? null,
    warnings: getStoryArcWarningsForChapter(snapshot, arc.id, currentChapter.chapterNum),
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
  let inboundContext: Awaited<ReturnType<typeof collectChapterContextRawData>> | null = null
  try {
    inboundContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  } catch {
    inboundContext = null
  }

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
          inboundOpenLoops: inboundContext?.contextParts.openLoops,
          inboundDueForeshadows: inboundContext?.contextParts.dueForeshadows,
          inboundContinuityNotes: inboundContext?.contextParts.continuityNotes,
          chapterBridgePlan: inboundContext?.contextParts.chapterBridgePlan,
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
  summaryHealth: SummaryHealthReport | null
  contextVersion: number
}> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const summary = await updateChapterSummaryData(chapterId)
  const continuity = await updateChapterContinuityState(chapterId, summary)
  const summaryHealth = await refreshSummaryHealthSemantic(chapterId)
  refreshCharacterStateVersionsForChapter(chapterId)
  syncCharacterArcsFromChapterState(chapterId)
  refreshWorldStateVersionsForChapter(chapterId)
  refreshStoryMemoryCheckpointsIfNeeded(chapter.novelId, {
    refreshMode: 'schedule_only',
    reason: `chapter ${chapter.chapterNum} derived state refreshed`,
    trigger: 'chapter_memory_refresh',
  })
  const contextVersion = markChapterContextCurrent(chapterId)
  return { summary, continuity, summaryHealth, contextVersion }
}

function updatePipelineChapterContent(
  chapterId: number,
  expectedContent: string,
  expectedNovelContextVersion: number,
  data: {
    content: string
    status: string
    reviewNotesJson?: string
  },
  versionSource: ChapterVersionSource | false = false,
): string {
  const sqlite = getSqlite()
  const transaction = sqlite.transaction(() => {
    const current = getDb().select({ content: chapters.content, novelId: chapters.novelId })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .all()[0]
    if (!current) throwUserFacingError('chapter.notFound')
    if ((current.content || '') !== expectedContent) {
      throwUserFacingError('chapter.pipelineContentConflict')
    }
    const currentNovel = getDb().select({ contextVersion: novels.contextVersion })
      .from(novels)
      .where(eq(novels.id, current.novelId))
      .all()[0]
    if (!currentNovel) throwUserFacingError('novel.notFound')
    if ((currentNovel.contextVersion || 1) !== expectedNovelContextVersion) {
      throwUserFacingError('chapter.pipelineContextConflict')
    }
    updateChapter(chapterId, data, {
      skipStaleTracking: true,
      versionSource,
      allowDuringGeneration: true,
    })
    return data.content
  })
  return sqlite.inTransaction || typeof transaction.immediate !== 'function'
    ? transaction()
    : transaction.immediate()
}

async function finalizeGeneratedChapterContent(
  chapterId: number,
  content: string,
  expectedContent: string,
  expectedNovelContextVersion: number,
  options: {
    onContextCheckpoint?: (contextVersion: number) => void
  } = {},
) {
  updatePipelineChapterContent(chapterId, expectedContent, expectedNovelContextVersion, {
    content,
    status: 'draft',
  }, 'pipeline-generate')

  const { summary, contextVersion } = await refreshChapterMemory(chapterId)
  options.onContextCheckpoint?.(contextVersion)
  const chapter = getChapter(chapterId)
  if (chapter && content.trim()) {
    await discoverEntitiesFromContent({
      novelId: chapter.novelId,
      sourcePage: 'writing',
      sourceLabel: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
      sourceEntityId: chapter.id,
      content,
    })
    // Entity discovery increments the novel context version after the first
    // memory refresh. The chapter was generated from the current context, so
    // mark this committed chapter current again before the final gate; later
    // chapters remain stale through markSubsequentChaptersStale below.
    options.onContextCheckpoint?.(markChapterContextCurrent(chapter.id))
  }
  if (chapter) {
    markSubsequentChaptersStale(
      chapter.novelId,
      chapter.chapterNum,
      `第${chapter.chapterNum}章内容已更新`,
    )
    syncChapterTimelineStatuses(chapter.novelId, chapter.chapterNum)
    // 定稿章节积累到阈值后自动采样新的风格指纹（不自动激活）。
    // 异步 fire-and-forget：采样失败绝不阻塞章节定稿。
    try {
      void maybeRefreshNovelStyleFingerprint(chapter.novelId).catch(() => {})
    } catch { /* ignore */ }
    // 词条引用扫描（幂等：按章删插）。同样 fire-and-forget，失败不阻塞定稿。
    try {
      void Promise.resolve()
        .then(() => scanChapterForGlossaryTerms(chapter.novelId, chapter.id))
        .catch(() => {})
    } catch { /* ignore */ }
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

const CHAPTER_STATUS_VALUES = ['outline', 'writing', 'draft', 'reviewing', 'final'] as const
type ChapterStatusValue = typeof CHAPTER_STATUS_VALUES[number]

const CHAPTER_CREATE_FIELDS = [
  'chapterNum', 'title', 'outline', 'targetWords', 'emotionTone', 'arcId', 'volumeId', 'partId',
  'allowedFactIdsJson', 'revealedFactIdsJson', 'status',
] as const

const CHAPTER_UPDATE_FIELDS = [
  'title', 'outline', 'scenePlanJson', 'content', 'wordCount', 'summary', 'nextChapterSeed',
  'bridgePlanJson', 'continuityStateJson', 'reviewNotesJson', 'status', 'aiScoreJson', 'targetWords',
  'emotionTone', 'chapterNum', 'arcId', 'volumeId', 'partId', 'compiledFromSegments', 'segmentCount',
  'contextVersion', 'staleReasonJson', 'allowedFactIdsJson', 'revealedFactIdsJson', 'contractAuditJson',
  'summaryHealthJson', 'expressionDedupJson', 'hookContinuityJson', 'writebackStatusJson',
] as const

const CHAPTER_EXTERNAL_UPDATE_FIELDS = [
  // 正文、标题和结构归属是编辑器输入；字数、连续性、评分、审校和上下文等
  // 派生字段必须由对应 service 重新计算，不能从 IPC/Web 直接覆盖。摘要保留为
  // 可恢复的工作区字段，但正文发生变化时 updateChapter 会先将其清空。
  'title', 'outline', 'content', 'summary', 'status', 'targetWords', 'emotionTone',
  'arcId', 'volumeId', 'partId', 'allowedFactIdsJson', 'revealedFactIdsJson',
] as const

const CHAPTER_GENERATION_INPUT_FIELDS = [
  'title', 'outline', 'content', 'targetWords', 'emotionTone', 'chapterNum',
  'arcId', 'volumeId', 'partId', 'allowedFactIdsJson', 'revealedFactIdsJson',
] as const

function buildChapterGenerationInputFingerprint(chapter: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(CHAPTER_GENERATION_INPUT_FIELDS.map((field) => (
    Object.prototype.hasOwnProperty.call(chapter, field) ? chapter[field] ?? null : null
  )))).digest('hex')
}

function pickChapterFields(data: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throwUserFacingError('ipc.invalidObject', { name: 'data' })
  }
  const source = data as Record<string, unknown>
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field]
    return result
  }, {})
}

/** IPC/Web 只允许修改编辑器字段；上下文版本、写回状态和审计快照由 service 内部维护。 */
export function sanitizeChapterUpdatePayload(data: unknown): Record<string, unknown> {
  return pickChapterFields(data, CHAPTER_EXTERNAL_UPDATE_FIELDS)
}

/** IPC/Web 只允许选择编辑器版本来源，不能传入内部事务和失效跟踪开关。 */
export function sanitizeChapterUpdateOptions(value: unknown): { versionSource?: 'manual-save' | 'ai-rewrite' } {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwUserFacingError('ipc.invalidObject', { name: 'options' })
  }
  const source = (value as Record<string, unknown>).versionSource
  if (source === undefined) return {}
  if (source !== 'manual-save' && source !== 'ai-rewrite') {
    throwUserFacingError('ipc.invalidObject', { name: 'options.versionSource' })
  }
  return { versionSource: source }
}

const CHAPTER_GENERATION_CONSTRAINT_LABELS = [
  'chapterGoal',
  'characterStates',
  'worldStates',
  'writingContractSummary',
  'relationSummary',
  'itemSummary',
  'openLoops',
  'continuityNotes',
  'feedbackRecurrence',
  'antiAiRules',
  'styleHardGuard',
  'genrePacing',
] as const satisfies readonly HardConstraintSourceLabel[]

/** IPC/Web 只允许章节生成选择已知路由和硬约束来源，避免 malformed options 进入流水线。 */
export function sanitizeChapterGenerationOptions(value: unknown): {
  executionMode?: AiExecutionMode
  preserveConstraintLabels?: HardConstraintSourceLabel[]
  stageId?: number
} {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwUserFacingError('ipc.invalidObject', { name: 'options' })
  }
  const source = value as Record<string, unknown>
  const stageId = source.stageId
  if (stageId !== undefined && !(typeof stageId === 'number' && Number.isSafeInteger(stageId) && stageId > 0)) {
    throwUserFacingError('ipc.invalidObject', { name: 'options.stageId' })
  }
  const executionMode = source.executionMode
  const normalizedMode = normalizeAiExecutionMode(executionMode)
  if (executionMode !== undefined && !normalizedMode) {
    throwUserFacingError('ipc.invalidObject', { name: 'options.executionMode' })
  }

  const labels = source.preserveConstraintLabels
  if (labels === undefined) {
    return {
      ...(normalizedMode ? { executionMode: normalizedMode } : {}),
      ...(stageId !== undefined ? { stageId } : {}),
    }
  }
  if (!Array.isArray(labels)) {
    throwUserFacingError('ipc.invalidObject', { name: 'options.preserveConstraintLabels' })
  }
  const invalidLabel = labels.find((label) => !(CHAPTER_GENERATION_CONSTRAINT_LABELS as readonly unknown[]).includes(label))
  if (invalidLabel !== undefined) {
    throwUserFacingError('ipc.invalidObject', { name: 'options.preserveConstraintLabels' })
  }
  return {
    ...(normalizedMode ? { executionMode: normalizedMode } : {}),
    ...(stageId !== undefined ? { stageId } : {}),
    preserveConstraintLabels: Array.from(new Set(labels)) as HardConstraintSourceLabel[],
  }
}

function normalizeChapterStatus(value: unknown): ChapterStatusValue | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && (CHAPTER_STATUS_VALUES as readonly string[]).includes(value)) return value as ChapterStatusValue
  throwUserFacingError('ipc.invalidObject', { name: 'data' })
}

function normalizeChapterRelationId(value: unknown, name: string): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const normalized = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throwUserFacingError('ipc.invalidPositiveInteger', { name, value: String(value) })
  }
  return normalized
}

function normalizePositiveChapterNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const normalized = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throwUserFacingError('ipc.invalidPositiveInteger', { name: 'chapterNum', value: String(value) })
  }
  return normalized
}

function normalizeChapterIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throwUserFacingError('ipc.invalidNonEmptyArray', { name: 'ids' })
  }
  const ids = value.map((item, index) => {
    const normalized = typeof item === 'number' ? item : Number(item)
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
      throwUserFacingError('ipc.invalidPositiveInteger', { name: `ids[${index}]`, value: String(item) })
    }
    return normalized
  })
  return [...new Set(ids)]
}

function assertChapterNumberAvailable(novelId: number, chapterNum: number, excludeChapterId?: number) {
  const db = getDb()
  const matches = db.select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.chapterNum, chapterNum)))
    .all()
  if (matches.some((row) => row.id !== excludeChapterId)) {
    throwUserFacingError('chapter.renumberConflict')
  }
}

function loadChapterBatch(ids: unknown): { ids: number[]; rows: Array<typeof chapters.$inferSelect>; novelId: number } {
  const chapterIds = normalizeChapterIds(ids)
  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
  if (rows.length !== chapterIds.length || new Set(rows.map((row) => row.novelId)).size !== 1) {
    throwUserFacingError('structure.invalidChapterIds')
  }
  return { ids: chapterIds, rows, novelId: rows[0].novelId }
}

function syncChapterPartRanges(novelId: number) {
  const db = getDb()
  db.select().from(storyParts).where(eq(storyParts.novelId, novelId)).all().forEach((part) => {
    const nums = db.select({ chapterNum: chapters.chapterNum })
      .from(chapters)
      .where(eq(chapters.partId, part.id))
      .all()
      .map((row) => row.chapterNum)
      .sort((left, right) => left - right)
    db.update(storyParts).set({
      startChapterNum: nums[0] ?? null,
      endChapterNum: nums.at(-1) ?? null,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, part.id)).run()
  })
}

function appendChapterStaleReason(raw: unknown, reason: string): string {
  const current = typeof raw === 'string' ? raw : ''
  let values: string[] = []
  try {
    const parsed = JSON.parse(current)
    if (Array.isArray(parsed)) values = parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    // Corrupt stale metadata is replaced by a valid, actionable reason.
  }
  return JSON.stringify([...new Set([...values, reason].map((item) => item.trim()).filter(Boolean))])
}

function buildIdleWritebackStatusJson(contextVersion: number): string {
  return JSON.stringify({
    phase: 'idle',
    retryCount: 0,
    candidateReady: false,
    canonApplied: true,
    blockedGeneration: false,
    readyForNextChapter: true,
    contextVersion,
    updatedAt: new Date().toISOString(),
  })
}

function assertChapterRelationsBelongToNovel(
  novelId: number,
  relationIds: { volumeId?: number | null; partId?: number | null; arcId?: number | null },
) {
  const db = getDb()
  let volume: typeof storyVolumes.$inferSelect | undefined
  if (relationIds.volumeId != null) {
    volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, relationIds.volumeId)).all()[0]
    if (!volume || volume.novelId !== novelId) throwUserFacingError('volume.notFound')
  }

  let part: typeof storyParts.$inferSelect | undefined
  if (relationIds.partId != null) {
    part = db.select().from(storyParts).where(eq(storyParts.id, relationIds.partId)).all()[0]
    if (!part || part.novelId !== novelId) throwUserFacingError('part.notFound')
    if (volume && part.volumeId !== volume.id) throwUserFacingError('chapter.structureConflict')
  }

  if (relationIds.arcId != null) {
    const arc = db.select().from(storyArcs).where(eq(storyArcs.id, relationIds.arcId)).all()[0]
    if (!arc || arc.novelId !== novelId) throwUserFacingError('storyArc.notFound')
  }

  if (part && relationIds.volumeId !== undefined && relationIds.volumeId !== part.volumeId) {
    throwUserFacingError('chapter.structureConflict')
  }
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
  allowedFactIdsJson: string
  revealedFactIdsJson: string
  status: ChapterStatusValue
}>) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  const safeData = pickChapterFields(data, CHAPTER_CREATE_FIELDS) as typeof data & { status?: unknown }
  const volumeId = normalizeChapterRelationId(safeData.volumeId, 'volumeId')
  const partId = normalizeChapterRelationId(safeData.partId, 'partId')
  const arcId = normalizeChapterRelationId(safeData.arcId, 'arcId')
  const defaults = resolveDefaultStructure(novelId)
  const explicitPart = partId != null
    ? db.select().from(storyParts).where(eq(storyParts.id, partId)).all()[0]
    : undefined
  const volumePart = partId == null && volumeId != null
    ? db.select().from(storyParts)
      .where(eq(storyParts.volumeId, volumeId))
      .orderBy(asc(storyParts.partNumber), asc(storyParts.id))
      .all()[0]
    : undefined
  let resolvedPartId = partId ?? volumePart?.id ?? (volumeId == null ? defaults.partId : null)
  const resolvedVolumeId = volumeId ?? explicitPart?.volumeId ?? defaults.volumeId
  // 先验证显式结构 ID，再决定是否需要为目标卷补建分册，避免无效卷 ID
  // 触发底层外键异常而不是返回可理解的用户错误。
  assertChapterRelationsBelongToNovel(novelId, { volumeId, partId, arcId })
  const chapterNum = normalizePositiveChapterNumber(safeData.chapterNum)
    ?? ((db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
      .reduce((max, chapter) => Math.max(max, chapter.chapterNum || 0), 0)) + 1)
  assertChapterNumberAvailable(novelId, chapterNum)
  const status = normalizeChapterStatus(safeData.status) || 'outline'
  if (status === 'final') {
    throwUserFacingError('chapter.publishBlocked', { summary: '新章节必须先完成正文和发布前检查。' })
  }
  const result = getSqlite().transaction(() => {
    if (resolvedPartId == null && volumeId != null) {
      const nextPartNumber = db.select().from(storyParts)
        .where(eq(storyParts.volumeId, volumeId))
        .all()
        .reduce((max, item) => Math.max(max, item.partNumber || 0), 0) + 1
      const insertedPart = db.insert(storyParts).values({
        novelId,
        volumeId,
        partNumber: nextPartNumber,
        title: `第${nextPartNumber}部`,
        status: 'planning',
      }).run()
      resolvedPartId = Number(insertedPart.lastInsertRowid)
    }
    assertChapterRelationsBelongToNovel(novelId, {
      volumeId: resolvedVolumeId,
      partId: resolvedPartId,
      arcId,
    })
    return db.insert(chapters).values({
    novelId,
    title: typeof safeData.title === 'string' ? safeData.title : undefined,
    outline: typeof safeData.outline === 'string' ? safeData.outline : undefined,
    targetWords: resolveChapterReferenceWords(safeData.targetWords, novel),
    emotionTone: typeof safeData.emotionTone === 'string' ? safeData.emotionTone : undefined,
    arcId: arcId ?? null,
    volumeId: resolvedVolumeId,
    partId: resolvedPartId,
    chapterNum,
    status,
    compiledFromSegments: 0,
    segmentCount: 0,
    allowedFactIdsJson: typeof safeData.allowedFactIdsJson === 'string' && safeData.allowedFactIdsJson ? safeData.allowedFactIdsJson : '[]',
    revealedFactIdsJson: typeof safeData.revealedFactIdsJson === 'string' && safeData.revealedFactIdsJson ? safeData.revealedFactIdsJson : '[]',
    contextVersion: novel?.contextVersion || 1,
    staleReasonJson: JSON.stringify([]),
    writebackStatusJson: JSON.stringify({
      phase: 'idle',
      retryCount: 0,
      candidateReady: false,
      canonApplied: true,
      blockedGeneration: false,
      readyForNextChapter: true,
      contextVersion: novel?.contextVersion || 1,
      updatedAt: new Date().toISOString(),
    }),
    }).run()
  })()
  ensureStoryStructure(novelId)
  syncNovelLifecycleStatus(novelId)
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
  bridgePlanJson: string
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
  allowedFactIdsJson: string
  revealedFactIdsJson: string
  contractAuditJson: string
  summaryHealthJson: string
  expressionDedupJson: string
  hookContinuityJson: string
  writebackStatusJson: string
}>, options: {
  skipStaleTracking?: boolean
  versionSource?: ChapterVersionSource | false
  allowChapterNumberChange?: boolean
  /** Internal pipeline writes must still use content CAS before setting this. */
  allowDuringGeneration?: boolean
} = {}) {
  const db = getDb()
  const previous = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  if (!previous) throwUserFacingError('chapter.notFound')
  const safeData = pickChapterFields(data, CHAPTER_UPDATE_FIELDS) as typeof data
  const normalizedStatus = normalizeChapterStatus(safeData.status)
  if (normalizedStatus !== undefined) safeData.status = normalizedStatus
  const volumeId = normalizeChapterRelationId(safeData.volumeId, 'volumeId')
  const partId = normalizeChapterRelationId(safeData.partId, 'partId')
  const arcId = normalizeChapterRelationId(safeData.arcId, 'arcId')
  const nextVolumeId = volumeId !== undefined ? volumeId : previous.volumeId
  const nextPartId = partId !== undefined ? partId : previous.partId
  assertChapterRelationsBelongToNovel(previous.novelId, {
    volumeId: nextVolumeId,
    partId: nextPartId,
    arcId,
  })

  if (safeData.chapterNum !== undefined) {
    const nextChapterNum = normalizePositiveChapterNumber(safeData.chapterNum)
    if (nextChapterNum !== undefined && nextChapterNum !== previous.chapterNum) {
      assertChapterNumberAvailable(previous.novelId, nextChapterNum, id)
      if (!options.allowChapterNumberChange) throwUserFacingError('chapter.renumberConflict')
    }
    safeData.chapterNum = nextChapterNum
  }

  const hasContentChange = safeData.content !== undefined
  if (hasContentChange && typeof safeData.content !== 'string') {
    throwUserFacingError('ipc.invalidObject', { name: 'data' })
  }
  const contentChanged = hasContentChange && safeData.content !== previous.content
  const generationInputChanged = CHAPTER_GENERATION_INPUT_FIELDS.some((field) => (
    Object.prototype.hasOwnProperty.call(safeData, field)
    && safeData[field] !== previous[field]
  ))
  if (generationInputChanged && !options.allowDuringGeneration) {
    const activeGeneration = db.select({ id: tasks.id }).from(tasks).where(and(
      eq(tasks.type, 'chapter_write'),
      eq(tasks.runnerType, 'workflow'),
      eq(tasks.relatedEntityType, 'chapter'),
      eq(tasks.relatedEntityId, id),
      inArray(tasks.status, ['pending', 'running', 'cancel_requested']),
    )).all()[0]
    if (activeGeneration) {
      throwUserFacingError(contentChanged
        ? 'chapter.generationActiveContentLocked'
        : 'chapter.generationActiveInputLocked')
    }
  }
  if (contentChanged) {
    // 正文变化后，所有依赖正文的结果必须重新生成；即使调用方携带 final，也不能
    // 把未经重新验收的新正文继续标记为已完成。
    safeData.wordCount = countChineseWords(safeData.content as string)
    safeData.status = 'draft'
    safeData.summary = ''
    safeData.nextChapterSeed = ''
    safeData.continuityStateJson = ''
    safeData.summaryHealthJson = ''
    safeData.contractAuditJson = ''
    safeData.expressionDedupJson = ''
    safeData.hookContinuityJson = ''
    safeData.aiScoreJson = ''
    // 内部流水线可能在提交新正文的同一调用中携带“新一轮”审校结果；
    // 外部 IPC/Web 已将 reviewNotesJson 排除在白名单之外，因此不会复用旧备注。
    if (safeData.reviewNotesJson === undefined) safeData.reviewNotesJson = ''
    safeData.writebackStatusJson = buildIdleWritebackStatusJson(previous.contextVersion || 1)
    const staleReason = '正文已更新，章节派生审校结果需要刷新'
    safeData.staleReasonJson = appendChapterStaleReason(safeData.staleReasonJson ?? previous.staleReasonJson, staleReason)
    const invalidatedAt = new Date().toISOString()
    db.update(chapterWritebackRuns).set({
      status: 'failed',
      failedAt: invalidatedAt,
      errorMessage: staleReason,
      updatedAt: invalidatedAt,
    }).where(and(
      eq(chapterWritebackRuns.chapterId, id),
      inArray(chapterWritebackRuns.status, ['draft', 'ready', 'applying']),
    )).run()
  }

  if (safeData.status === 'final' && previous.status !== 'final') {
    const publishCheck = runChapterPublishCheck(id, { phase: 'final' })
    if (!publishCheck.ready) {
      throwUserFacingError('chapter.publishBlocked', { summary: publishCheck.summary })
    }
  }
  const versionSource = data.content !== undefined
    ? normalizeChapterVersionSource(options.versionSource)
    : null

  db.update(chapters).set({
    ...safeData,
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
    syncNovelLifecycleStatus(chapter.novelId)
  }

  if (hasContentChange && chapter) {
    syncChapterToSegments(id, safeData.content as string, { createIfMissing: true })
  }

  if (chapter && versionSource) {
    createChapterVersionSnapshot(id, versionSource)
  }

  if (!options.skipStaleTracking && previous && contentChanged) {
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
  if (current) {
    let affectedStartChapterId: number | null = null
    let affectedStartChapterNum: number | null = null
    let remainingChapterCount = 0

    getSqlite().transaction(() => {
      const beforeRows = db.select().from(chapters)
        .where(eq(chapters.novelId, current.novelId))
        .orderBy(asc(chapters.chapterNum), asc(chapters.id))
        .all()
      deleteChapterSegmentsCascade(id)
      db.delete(chapters).where(eq(chapters.id, id)).run()
      ensureStoryStructure(current.novelId)
      // 删除后显式压缩章节编号；ensureStoryStructure 只补齐结构，不再在读取时
      // 静默改号，因此这里必须在同一事务中完成编号与引用同步。
      normalizeChapterNumbers(current.novelId)
      ensureStoryStructure(current.novelId)
      const afterRows = db.select().from(chapters)
        .where(eq(chapters.novelId, current.novelId))
        .orderBy(asc(chapters.chapterNum), asc(chapters.id))
        .all()
      remainingChapterCount = afterRows.length

      const nextChapterNumById = new Map(afterRows.map((row) => [row.id, row.chapterNum] as const))
      const chapterNumberRemap = new Map<number, number | null>()
      beforeRows.forEach((row) => {
        chapterNumberRemap.set(row.chapterNum, row.id === id ? null : (nextChapterNumById.get(row.id) ?? null))
      })
      remapChapterNumberReferences(current.novelId, chapterNumberRemap)

      const changedChapterNums = beforeRows
        .filter((row) => row.id !== id)
        .flatMap((row) => {
          const nextChapterNum = nextChapterNumById.get(row.id)
          return typeof nextChapterNum === 'number' && nextChapterNum !== row.chapterNum
            ? [nextChapterNum]
            : []
        })

      if (changedChapterNums.length > 0) {
        affectedStartChapterNum = Math.min(...changedChapterNums)
        affectedStartChapterId = afterRows.find((row) => row.chapterNum === affectedStartChapterNum)?.id ?? null
      }
      syncTimelineStructureAnchors(current.novelId)
    })()
    markSubsequentChaptersStale(
      current.novelId,
      Math.max(0, (affectedStartChapterNum ?? current.chapterNum) - 1),
      `第${current.chapterNum}章已删除，后续章节顺序已变更`,
    )
    if (remainingChapterCount === 0) {
      refreshWorldStateVersionsForNovel(current.novelId)
    } else if (typeof affectedStartChapterId === 'number' && typeof affectedStartChapterNum === 'number') {
      refreshCharacterStateVersionsForChapter(affectedStartChapterId)
      syncCharacterArcsFromChapterState(affectedStartChapterId)
      refreshWorldStateVersionsFromChapter(current.novelId, affectedStartChapterNum)
    } else {
      refreshWorldStateVersionsForNovel(current.novelId)
    }
    refreshStoryMemoryCheckpoints(current.novelId)
    scheduleDialogueFingerprintRefresh(current.novelId)
    syncNovelLifecycleStatus(current.novelId)
    return
  }
  db.delete(chapters).where(eq(chapters.id, id)).run()
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
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const { rows, novelId } = loadChapterBatch(ids)
  const safeData = pickChapterFields(data, ['status', 'arcId']) as typeof data
  const nextStatus = normalizeChapterStatus(safeData.status)
  const nextArcId = normalizeChapterRelationId(safeData.arcId, 'arcId')
  assertChapterRelationsBelongToNovel(novelId, { arcId: nextArcId })

  // 批量定稿必须先对全部章节预检，避免前几章已经写入 final、后面的章节才失败，
  // 形成半批次状态。
  if (nextStatus === 'final') {
    const blocked = rows
      .map((row) => ({ row, publishCheck: runChapterPublishCheck(row.id, { phase: 'final' }) }))
      .filter(({ publishCheck }) => !publishCheck.ready)
    if (blocked.length > 0) {
      const summary = blocked
        .slice(0, 3)
        .map(({ row, publishCheck }) => `第${row.chapterNum}章：${publishCheck.summary}`)
        .join('；')
      throwUserFacingError('chapter.publishBlocked', { summary })
    }
  }

  getSqlite().transaction(() => {
    rows.forEach((row) => {
      updateChapter(row.id, {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...(nextArcId !== undefined ? { arcId: nextArcId } : {}),
      }, {
        skipStaleTracking: true,
        versionSource: false,
      })
    })
  })()

  createOperationLog({
    novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_update',
    summary: `批量更新 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-update'),
    before: rows,
    after: safeData,
    undoPayload: {
      kind: 'chapter.batch_update',
      novelId,
      chapters: rows,
      reason: '已撤销章节批量更新',
    },
  })

  return rows.length
}

export function batchDeleteChapters(ids: number[]) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const { rows, novelId } = loadChapterBatch(ids)

  const db = getDb()

  const segments = db.select().from(chapterSegments)
    .where(inArray(chapterSegments.chapterId, rows.map((row) => row.id)))
    .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder))
    .all()
  const timelineAnchors = captureTimelineAnchorsForChapterIds(rows.map((row) => row.id))
  const chapterNumberReferences = captureChapterNumberReferenceSnapshot(novelId)
  const chapterNumbers = db.select({ id: chapters.id, chapterNum: chapters.chapterNum })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()

  // A batch is one author action. Keep every chapter deletion and its undo
  // checkpoint in the same outer transaction so a failure on a later chapter
  // cannot leave an unlogged half-deleted batch.
  getSqlite().transaction(() => {
    rows.forEach((row) => {
      deleteChapter(row.id)
    })

    createOperationLog({
      novelId,
      entityType: 'chapter',
      entityIds: rows.map((row) => row.id),
      operationType: 'batch_delete',
      summary: `批量删除 ${rows.length} 章`,
      batchKey: buildBatchKey('chapter-batch-delete'),
      before: rows,
      after: [],
      undoPayload: {
        kind: 'chapter.batch_delete',
        novelId,
        chapters: rows,
        segments,
        timelineAnchors,
        chapterNumbers,
        chapterNumberReferences,
        reason: '已撤销章节批量删除',
      },
    })
  })()

  return rows.length
}

export function batchRenumberChapters(ids: number[], startChapterNum: number) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const normalizedStart = normalizePositiveChapterNumber(startChapterNum) ?? 1
  const { rows, novelId } = loadChapterBatch(ids)
  const db = getDb()

  const allNovelChapters = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
  const targetChapterNums = rows.map((_row, index) => normalizedStart + index)
  const selectedIds = new Set(rows.map((row) => row.id))
  const targetConflict = allNovelChapters.some((row) => !selectedIds.has(row.id) && targetChapterNums.includes(row.chapterNum))
  const duplicateSourceNums = new Set(rows.map((row) => row.chapterNum)).size !== rows.length
  if (targetConflict || duplicateSourceNums || new Set(targetChapterNums).size !== targetChapterNums.length) {
    throwUserFacingError('chapter.renumberConflict')
  }

  const chapterNumberRemap = new Map<number, number>(rows.map((row, index) => [row.chapterNum, targetChapterNums[index]]))
  const temporaryOffset = Math.max(
    1000000,
    ...allNovelChapters.map((row) => Math.abs(row.chapterNum || 0) + rows.length + 1),
  )

  getSqlite().transaction(() => {
    // 先移到临时编号，避免数据库未来增加 chapter_num 唯一约束时发生中间冲突。
    rows.forEach((row, index) => {
      updateChapter(row.id, {
        chapterNum: temporaryOffset + index,
      }, {
        skipStaleTracking: true,
        versionSource: false,
        allowChapterNumberChange: true,
      })
    })
    rows.forEach((row, index) => {
      updateChapter(row.id, {
        chapterNum: targetChapterNums[index],
      }, {
        skipStaleTracking: true,
        versionSource: false,
        allowChapterNumberChange: true,
      })
    })
    remapChapterNumberReferences(novelId, chapterNumberRemap)
    syncChapterPartRanges(novelId)
    syncTimelineStructureAnchors(novelId)
  })()

  markSubsequentChaptersStale(
    novelId,
    Math.max(0, normalizedStart - 1),
    '章节顺序已批量调整',
  )

  createOperationLog({
    novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_reindex',
    summary: `批量顺延重排 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-reindex'),
    before: rows,
    after: { startChapterNum: normalizedStart },
    undoPayload: {
      kind: 'chapter.batch_reindex',
      novelId,
      chapters: rows,
      reason: '已撤销章节顺序调整',
    },
  })

  return rows.length
}

/** 按调用方提供的顺序重排章节，供大纲拖拽使用；不会逐章暴露中间编号状态。 */
export function reorderChapters(ids: number[], startChapterNum: number) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const normalizedStart = normalizePositiveChapterNumber(startChapterNum) ?? 1
  const batch = loadChapterBatch(ids)
  const db = getDb()
  const rowsById = new Map(batch.rows.map((row) => [row.id, row]))
  const orderedRows = batch.ids
    .map((id) => rowsById.get(id))
    .filter((row): row is NonNullable<typeof batch.rows[number]> => Boolean(row))
  const allNovelChapters = db.select().from(chapters)
    .where(eq(chapters.novelId, batch.novelId))
    .all()
  const targetChapterNums = orderedRows.map((_row, index) => normalizedStart + index)
  const selectedIds = new Set(orderedRows.map((row) => row.id))
  if (allNovelChapters.some((row) => !selectedIds.has(row.id) && targetChapterNums.includes(row.chapterNum))) {
    throwUserFacingError('chapter.renumberConflict')
  }

  const chapterNumberRemap = new Map<number, number>(orderedRows.map((row, index) => [row.chapterNum, targetChapterNums[index]]))
  const temporaryOffset = Math.max(
    1000000,
    ...allNovelChapters.map((row) => Math.abs(row.chapterNum || 0) + orderedRows.length + 1),
  )

  getSqlite().transaction(() => {
    orderedRows.forEach((row, index) => {
      updateChapter(row.id, { chapterNum: temporaryOffset + index }, {
        skipStaleTracking: true,
        versionSource: false,
        allowChapterNumberChange: true,
      })
    })
    orderedRows.forEach((row, index) => {
      updateChapter(row.id, { chapterNum: targetChapterNums[index] }, {
        skipStaleTracking: true,
        versionSource: false,
        allowChapterNumberChange: true,
      })
    })
    remapChapterNumberReferences(batch.novelId, chapterNumberRemap)
    syncChapterPartRanges(batch.novelId)
    syncTimelineStructureAnchors(batch.novelId)
  })()

  markSubsequentChaptersStale(
    batch.novelId,
    Math.max(0, normalizedStart - 1),
    '章节顺序已调整',
  )

  createOperationLog({
    novelId: batch.novelId,
    entityType: 'chapter',
    entityIds: orderedRows.map((row) => row.id),
    operationType: 'batch_reindex',
    summary: `拖拽重排 ${orderedRows.length} 章`,
    batchKey: buildBatchKey('chapter-reorder'),
    before: batch.rows,
    after: { startChapterNum: normalizedStart, orderedIds: orderedRows.map((row) => row.id) },
    undoPayload: {
      kind: 'chapter.batch_reindex',
      novelId: batch.novelId,
      chapters: batch.rows,
      reason: '已撤销章节拖拽重排',
    },
  })

  return orderedRows.length
}

function buildPersistedScenePlanText(scenePlanJson?: string | null): string {
  if (!scenePlanJson?.trim()) return ''
  try {
    return formatScenePlan(normalizeScenePlan(JSON.parse(scenePlanJson) as unknown, []))
  } catch {
    return ''
  }
}

interface ChapterContinuationPreparation {
  chapter: typeof chapters.$inferSelect
  novel: Awaited<ReturnType<typeof collectChapterContextRawData>>['novel']
  profile: Awaited<ReturnType<typeof collectChapterContextRawData>>['profile']
  draftContext: ChapterContext
  executionModeResolution: ReturnType<typeof resolveAiExecutionMode>
  writerChatOpts: ReturnType<typeof buildChatOptionsFromRoute>
  workflowTaskId: number
  snapshot: ChapterPipelineSnapshot
  continuationStepMemory: ReturnType<typeof buildStepMemorySummary>
  normalizedPartial: string
  continuationPrompt: string
  messages: Array<{ role: 'user'; content: string }>
}

async function prepareChapterContinuation(
  chapterId: number,
  partialContent: string,
  sender: ProgressSink | undefined,
  options: { executionMode?: AiExecutionMode; sourceTaskId?: number; stageId?: number },
): Promise<ChapterContinuationPreparation> {
  const chapter = getRequiredChapterGenerationInput(chapterId)
  validateChapterContractsForGeneration(chapterId)
  const normalizedPartial = partialContent.trim()
  if (!normalizedPartial) throwUserFacingError('workflow.resumeUnsupported')

  const rawContext = await loadChapterGenerationRawContext(chapter, options.stageId)
  const novel = rawContext.novel
  const profile = rawContext.profile
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const activePromptOverrideKeys = getActiveChapterPromptOverrideKeys()
  const writerContextResolutionPayload = await resolveWriterContextForStage(
    chapter,
    rawContext,
    options.executionMode,
    undefined,
    buildChapterContractVersion(chapterId),
    activePromptOverrideKeys,
  )
  const { complexity } = buildStageContextMap(rawContext, chapter)
  const draftResolution = allocateDraftContextWithWriterFallback(
    chapter,
    rawContext,
    writerContextResolutionPayload.effectiveRawContext,
    complexity,
    writerContextResolutionPayload.writerContextResolution,
  )
  let draftContext = draftResolution.draftContext
  const storyCore = buildStoryCore(profile, draftContext.storyCore)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: novel.settingsJson,
  })
  const stageReports = buildChapterAiStageReports(
    executionModeResolution.mode,
    executionModeResolution.source,
    novel.modelConfigId || undefined,
  )
  const writerChatOpts = buildChatOptionsFromRoute(stageReports[1].route)
  const continuationStepMemory = buildStepMemorySummary({
    chapterBridgePlan: draftContext.chapterBridgePlan,
    draftText: normalizedPartial,
    previousSummary: '这是断点续写任务：必须承接已保留正文，不得重启章节或改写已完成事实。',
  })
  draftContext = allocateStageContextForPipeline(
    applyUpstreamArtifactsToRawContext(draftResolution.effectiveRawContext, {
      stepMemorySummary: continuationStepMemory.summary,
    }),
    chapter,
    complexity,
    'draft',
  )
  const workflowTaskId = await createTask({
    type: 'chapter_write',
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    runnerType: 'workflow',
    pipelineRole: 'writer',
    pipelineStage: 'pending',
    progressJson: '{}',
    retryable: false,
    status: 'pending',
  })
  let snapshot = createInitialChapterPipelineSnapshot(
    chapterId,
    workflowTaskId,
    buildChapterContractVersion(chapterId),
    { content: chapter.content || '', contextVersion: novel.contextVersion || 1 },
  )
  snapshot = {
    ...snapshot,
    executionMode: executionModeResolution.mode,
    writerContextResolution: draftResolution.writerContextResolution,
    stepMemory: continuationStepMemory,
    partialContent: normalizedPartial,
    resumeReason: undefined,
    resumeSourceTaskId: options.sourceTaskId,
  }

  const continuationPrompt = buildContinuationPrompt(buildChapterWritingPrompt({
    novelTitle: novel.title,
    genre: profile.genre,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
    chapterGoal: draftContext.chapterGoal,
    hardConstraintContext: draftContext.hardConstraintContext,
    dialogueVoiceLocks: draftContext.dialogueVoiceLocks,
    plotPoints: chapter.outline || '',
    emotionTone: chapter.emotionTone || '平稳',
    targetWords: resolveChapterReferenceWords(chapter.targetWords, novel),
    storyCore,
    writingContractSummary: draftContext.writingContractSummary,
    themeChapterTest: themeVoice.themeChapterTest,
    relationSummary: draftContext.relationSummary,
    currentArc: draftContext.currentArc,
    worldRules: draftContext.worldRules,
    characterStates: draftContext.characterStates,
    worldStates: draftContext.worldStates,
    mapSummary: draftContext.mapSummary,
    itemSummary: draftContext.itemSummary,
    previousSummaries: draftContext.previousSummaries,
    previousChapterContext: draftContext.previousChapterContext,
    lastChapterEnding: draftContext.lastChapterEnding,
    styleTemplate: draftContext.styleTemplate,
    continuitySummary: draftContext.continuitySummary,
    openLoops: draftContext.openLoops,
    dueForeshadows: draftContext.dueForeshadows,
    continuityNotes: draftContext.continuityNotes,
    timelineSummary: draftContext.timelineSummary,
    timelineOpenThreads: draftContext.timelineOpenThreads,
    activeThreads: draftContext.activeThreads,
    recalledMemory: draftContext.recalledMemory,
    chapterBridgePlan: draftContext.chapterBridgePlan,
    stepMemorySummary: draftContext.stepMemorySummary,
    runtimeAssertions: continuationStepMemory.runtimeAssertions,
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
    promptTier: complexity,
  }), normalizedPartial)

  return {
    chapter,
    novel,
    profile,
    draftContext,
    executionModeResolution,
    writerChatOpts,
    workflowTaskId,
    snapshot,
    continuationStepMemory,
    normalizedPartial,
    continuationPrompt,
    messages: [{ role: 'user', content: continuationPrompt }],
  }
}

interface ChapterContinuationRuntimeState {
  workflowTaskId: number
  writerTaskId: number
  getSnapshot: () => ChapterPipelineSnapshot
  setSnapshot: (snapshot: ChapterPipelineSnapshot) => void
  syncWorkflowTask: (extra?: Partial<typeof tasks.$inferInsert>) => void
  setWorkflowTaskStatus: (
    status: 'running' | 'success' | 'failed' | 'cancelled',
    extra?: Partial<typeof tasks.$inferInsert>,
  ) => void
}

async function runChapterContinuationSuccess(input: {
  prepared: ChapterContinuationPreparation
  runtime: ChapterContinuationRuntimeState
  sender?: ProgressSink
  options: { executionMode?: AiExecutionMode; sourceTaskId?: number; stageId?: number }
  onDownstreamTask: (taskId: number) => void
  onWriterHandoff: () => void
}): Promise<number> {
  const { prepared, runtime, sender, options, onDownstreamTask, onWriterHandoff } = input
  const { chapter, novel, writerChatOpts, normalizedPartial, messages } = prepared
  const continuationResult = await executeStreamTask(runtime.writerTaskId, {
    type: 'chapter_writer',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapter.id,
    inputJson: JSON.stringify(messages),
    messages,
    modelConfigId: novel.modelConfigId || undefined,
    chatOpts: writerChatOpts,
    sender,
    onChunk: async (_chunk, fullOutput) => {
      runtime.setSnapshot({
        ...runtime.getSnapshot(),
        partialContent: `${normalizedPartial}\n\n${fullOutput}`.trim(),
        resumeSourceTaskId: runtime.writerTaskId,
      })
      runtime.syncWorkflowTask()
    },
  })
  const combinedContent = `${normalizedPartial}\n\n${continuationResult.output}`.trim()
  updatePipelineChapterContent(chapter.id, chapter.content || '', novel.contextVersion || 1, {
    content: combinedContent,
    status: 'reviewing',
  })
  runtime.setSnapshot(checkpointChapterPipelineContent(runtime.getSnapshot(), {
    persistedContent: combinedContent,
    resumableContent: combinedContent,
    resumeSourceTaskId: runtime.writerTaskId,
  }))
  runtime.setSnapshot({
    ...runtime.getSnapshot(),
    currentRole: 'writer',
    currentStage: 'reviewing',
    status: 'running',
    message: '断点续写已补齐，正在交回完整章节流水线复审。',
    partialContent: combinedContent,
    streamTaskId: undefined,
    lastFailureRole: undefined,
    roles: {
      ...runtime.getSnapshot().roles,
      writer: {
        ...runtime.getSnapshot().roles.writer,
        status: 'success',
        detail: '断点续写完成，合并稿已交回完整审校链。',
        finishedAt: new Date().toISOString(),
        recoveryHint: undefined,
      },
    },
  })
  runtime.syncWorkflowTask({
    currentChildTaskId: null,
    outputText: 'Writer 断点续写已完成，正在启动完整审校、门禁与 Canon 流水线。',
    errorMessage: null,
  })
  onWriterHandoff()
  const resumedWorkflowTaskId = await generateChapterContent(chapter.id, sender, {
    executionMode: options.executionMode,
    stageId: options.stageId,
    resumeDraft: combinedContent,
    resumeSourceTaskId: runtime.workflowTaskId,
    onWorkflowTaskCreated: (taskId) => {
      onDownstreamTask(taskId)
      runtime.syncWorkflowTask({ currentChildTaskId: taskId })
      const resumeTask = getTaskRecord(runtime.workflowTaskId)
      if (resumeTask && parseTaskControl(resumeTask).cancelRequested) cancelTask(taskId, sender)
    },
  })
  runtime.setSnapshot({
    ...runtime.getSnapshot(),
    status: 'success',
    currentRole: 'writer',
    currentStage: 'completed',
    message: '断点续写稿已交回完整章节流水线并通过后续门禁。',
    partialContent: combinedContent,
    streamTaskId: undefined,
    roles: {
      ...runtime.getSnapshot().roles,
      writer: {
        ...runtime.getSnapshot().roles.writer,
        status: 'success',
        detail: '断点续写完成，合并稿已交回完整审校链。',
        finishedAt: new Date().toISOString(),
      },
    },
  })
  runtime.setWorkflowTaskStatus('success', {
    currentChildTaskId: null,
    outputText: `断点续写已完成，并已由完整流水线任务 #${resumedWorkflowTaskId} 继续审校、门禁与 Canon 草案生成。`,
    errorMessage: null,
  })
  sendPipelineProgress(sender, runtime.getSnapshot(), {
    stage: 'completed',
    label: '断点续写与完整复审完成',
    detail: '系统已补齐保留正文，并由完整流水线重新执行 Critic、Rewriter、发布门、Canonizer 与 Finalize。',
    status: 'success',
    role: 'writer',
  })
  return resumedWorkflowTaskId
}

function buildChapterContinuationFailureSnapshot(input: {
  chapter: typeof chapters.$inferSelect
  chapterId: number
  workflowTaskId: number
  writerTaskId: number
  downstreamWorkflowTaskId?: number
  writerContinuationCompleted: boolean
  currentSnapshot: ChapterPipelineSnapshot
  normalizedPartial: string
  error: unknown
}): { snapshot: ChapterPipelineSnapshot; downstreamRole?: ChapterPipelineRole } {
  const downstreamTask = input.downstreamWorkflowTaskId
    ? getTaskRecord(input.downstreamWorkflowTaskId)
    : null
  const downstreamSnapshot = parseChapterPipelineSnapshot(downstreamTask?.progressJson)
  const downstreamRole = downstreamSnapshot?.lastFailureRole || downstreamSnapshot?.currentRole || undefined
  const aborted = isChapterPipelineAbortError(input.workflowTaskId, input.error)
    || (input.downstreamWorkflowTaskId ? isChapterPipelineAbortError(input.downstreamWorkflowTaskId, input.error) : false)
  const fallbackRecoveryRole = downstreamRole || 'writer'
  const detail = input.error instanceof Error ? input.error.message : '断点续写失败'
  const roles = downstreamSnapshot?.roles
    ? { ...input.currentSnapshot.roles, ...downstreamSnapshot.roles }
    : input.writerContinuationCompleted
      ? input.currentSnapshot.roles
      : {
          ...input.currentSnapshot.roles,
          writer: {
            ...input.currentSnapshot.roles.writer,
            status: 'failed' as const,
            detail,
            finishedAt: new Date().toISOString(),
            recoveryHint: buildChapterPipelineRecoveryHint(input.chapter.novelId, input.chapterId, 'writer'),
          },
        }
  return {
    downstreamRole,
    snapshot: {
      ...input.currentSnapshot,
      status: aborted ? 'cancelled' : 'failed',
      currentRole: downstreamRole || 'writer',
      currentStage: downstreamSnapshot?.currentStage || (input.writerContinuationCompleted ? 'reviewing' : 'drafting'),
      message: detail,
      resumeReason: inferChapterPipelineResumeReason(input.error),
      resumeSourceTaskId: input.downstreamWorkflowTaskId || input.writerTaskId,
      recoveryHint: downstreamSnapshot?.recoveryHint
        || buildChapterPipelineRecoveryHint(input.chapter.novelId, input.chapterId, fallbackRecoveryRole),
      lastFailureRole: downstreamSnapshot?.lastFailureRole || (input.writerContinuationCompleted ? undefined : 'writer'),
      partialContent: downstreamSnapshot?.partialContent?.trim()
        || input.currentSnapshot.partialContent
        || input.normalizedPartial,
      roles,
    },
  }
}

async function continueChapterContent(
  chapterId: number,
  partialContent: string,
  sender?: ProgressSink,
  options: { executionMode?: AiExecutionMode; sourceTaskId?: number; stageId?: number } = {},
): Promise<number> {
  const prepared = await prepareChapterContinuation(chapterId, partialContent, sender, options)
  const { chapter, novel, workflowTaskId, normalizedPartial, messages } = prepared
  let { snapshot } = prepared

  const syncWorkflowTask = (extra: Partial<typeof tasks.$inferInsert> = {}) => {
    updateTaskProgress(workflowTaskId, snapshot, sender)
    updateTask(workflowTaskId, {
      pipelineRole: snapshot.currentRole || undefined,
      pipelineStage: snapshot.status === 'success' ? 'success' : snapshot.status === 'cancelled' ? 'failed' : 'running',
      contractVersion: snapshot.contractVersion,
      recoveryHintJson: serializeTaskRecoveryHint(snapshot.recoveryHint),
      progressJson: JSON.stringify(snapshot),
      ...extra,
    })
  }

  const setWorkflowTaskStatus = (
    status: 'running' | 'success' | 'failed' | 'cancelled',
    extra: Partial<typeof tasks.$inferInsert> = {},
  ) => {
    updateTaskStatus(workflowTaskId, status, sender, {
      pipelineRole: snapshot.currentRole || undefined,
      pipelineStage: status === 'success' ? 'success' : status === 'cancelled' ? 'failed' : 'running',
      contractVersion: snapshot.contractVersion,
      recoveryHintJson: serializeTaskRecoveryHint(snapshot.recoveryHint),
      progressJson: JSON.stringify(snapshot),
      ...extra,
    })
  }

  const writerTaskId = await createTask({
    type: 'chapter_writer',
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    inputJson: JSON.stringify(messages),
    runnerType: 'stream',
    retryable: false,
    parentTaskId: workflowTaskId,
    pipelineRole: 'writer',
    pipelineStage: 'pending',
    upstreamTaskId: options.sourceTaskId,
    contractVersion: snapshot.contractVersion,
    recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'writer')),
    status: 'pending',
  })

  snapshot = {
    ...snapshot,
    currentRole: 'writer',
    currentStage: 'drafting',
    status: 'running',
    message: '正在基于已保留正文继续续写当前章节。',
    streamTaskId: writerTaskId,
    roles: {
      ...snapshot.roles,
      writer: {
        ...snapshot.roles.writer,
        status: 'running',
        detail: '正在基于已保留正文继续续写当前章节。',
        taskId: writerTaskId,
        upstreamTaskId: options.sourceTaskId,
        contractVersion: snapshot.contractVersion,
        startedAt: new Date().toISOString(),
      },
    },
  }
  syncWorkflowTask({ currentChildTaskId: writerTaskId, errorMessage: null })
  updateTask(writerTaskId, { pipelineStage: 'running' })
  sendPipelineProgress(sender, snapshot, {
    stage: 'drafting',
    label: '继续正文',
    detail: '系统正在基于已保留正文继续生成后续内容。',
    status: 'running',
    role: 'writer',
  })

  let downstreamWorkflowTaskId: number | undefined
  let writerContinuationCompleted = false
  try {
    const resumedWorkflowTaskId = await runChapterContinuationSuccess({
      prepared,
      runtime: {
        workflowTaskId,
        writerTaskId,
        getSnapshot: () => snapshot,
        setSnapshot: (nextSnapshot) => { snapshot = nextSnapshot },
        syncWorkflowTask,
        setWorkflowTaskStatus,
      },
      sender,
      options,
      onDownstreamTask: (taskId) => { downstreamWorkflowTaskId = taskId },
      onWriterHandoff: () => { writerContinuationCompleted = true },
    })
    return resumedWorkflowTaskId
  } catch (error) {
    const failure = buildChapterContinuationFailureSnapshot({
      chapter,
      chapterId,
      workflowTaskId,
      writerTaskId,
      downstreamWorkflowTaskId,
      writerContinuationCompleted,
      currentSnapshot: snapshot,
      normalizedPartial,
      error,
    })
    snapshot = failure.snapshot
    setWorkflowTaskStatus(snapshot.status === 'cancelled' ? 'cancelled' : 'failed', {
      currentChildTaskId: null,
      outputText: snapshot.partialContent || normalizedPartial,
      errorMessage: error instanceof Error ? error.message : '断点续写失败',
    })
    sendPipelineProgress(sender, snapshot, {
      stage: 'drafting',
      label: snapshot.status === 'cancelled'
        ? '章节恢复流水线已取消'
        : writerContinuationCompleted
          ? '断点续写已完成，但后续完整流水线失败'
          : '断点续写失败',
      detail: error instanceof Error ? error.message : '断点续写失败',
      status: snapshot.status === 'cancelled' ? 'cancelled' : 'failed',
      role: failure.downstreamRole || 'writer',
    })
    throw error
  }
}

const chapterGenerationLocks = new Map<number, Promise<number>>()
const chapterGenerationTaskIds = new Map<number, number>()
const chapterGenerationTaskObservers = new Map<number, Set<(taskId: number) => void>>()

function observeChapterGenerationTask(chapterId: number, observer: (taskId: number) => void) {
  const taskId = chapterGenerationTaskIds.get(chapterId)
  if (taskId) {
    observer(taskId)
    return
  }
  const observers = chapterGenerationTaskObservers.get(chapterId) || new Set<(taskId: number) => void>()
  observers.add(observer)
  chapterGenerationTaskObservers.set(chapterId, observers)
}

function publishChapterGenerationTaskId(chapterId: number, taskId: number) {
  chapterGenerationTaskIds.set(chapterId, taskId)
  for (const observer of chapterGenerationTaskObservers.get(chapterId) || []) {
    try {
      observer(taskId)
    } catch (error) {
      console.warn(`[chapter:warn] 章节流水线任务关联回调失败 chapter=${chapterId} task=${taskId}`, error)
    }
  }
  chapterGenerationTaskObservers.delete(chapterId)
}

interface ChapterGenerationOptions {
  executionMode?: AiExecutionMode
  preserveConstraintLabels?: HardConstraintSourceLabel[]
  stageId?: number
  /** Internal-only recovery input. IPC/Web sanitizers never expose this field. */
  resumeDraft?: string
  /** Failed workflow that supplied resumeDraft, retained for audit lineage. */
  resumeSourceTaskId?: number
  /** Internal-only hook used to link a resumed Writer task to its downstream workflow. */
  onWorkflowTaskCreated?: (taskId: number) => void
  retryNodeRole?: ChapterPipelineRole
  retrySourceNodeRunId?: number
  retryUpstreamSnapshotId?: string | null
  retryReason?: string
}

interface GeneratedChapterReviewPhaseInput {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  profile: StoryProfile
  session: ChapterPipelineSession
  sender?: ProgressSink
  options: ChapterGenerationOptions
  plannerWriter: Awaited<ReturnType<typeof executeGeneratedChapterPlannerWriterPhase>>
  storyCore: string
  consistencyNotes: string
  structuralAlertsSummary: string
  latestArcProgressNote: string
  currentArcRow: typeof storyArcs.$inferSelect | null
  complexity: ChapterComplexity
  criticChatOpts: ReturnType<typeof buildChatOptionsFromRoute>
  themeVoice: ReturnType<typeof parseThemeVoiceDocument>
  db: ReturnType<typeof getDb>
}

async function executeGeneratedChapterReviewPhase(input: GeneratedChapterReviewPhaseInput) {
  const { chapter, novel, profile, session, sender, plannerWriter, storyCore, consistencyNotes,
    structuralAlertsSummary, latestArcProgressNote, currentArcRow, complexity, criticChatOpts, themeVoice, db } = input
  const { state, retrySnapshot: retrySourceWorkflowSnapshot } = session
  const { shouldRun: shouldRunPipelineRole } = session.bindings
  const {
    scenePlan, scenePlanText, sceneDesignFieldGaps, chapterTitleForCheck, chapterWordTarget,
    draftContent, draftTitleMismatchRisk, reviewUpstreamArtifacts,
    reviewContext, reviewNarrativeFields, unresolvedDesignGateFlag,
    sharedPromptGuidance,
  } = plannerWriter
  const chapterId = chapter.id

  let reviewNotes = shouldRunPipelineRole('critic')
    ? buildFallbackReviewNotes(consistencyNotes)
    : parseStoredReviewNotes(chapter.reviewNotesJson)

  // 语义评审门策略：off 保持关键词门原始行为；shadow 只落库观察；enforce 由语义
  // verdict 接管阻断，关键词门降级为提示。critic 阶段的语义门调用不计入
  // maxSemanticCallsPerChapter 预算（预算只约束修复复评与 golden_final 加验）。
  const semanticGatePolicy = resolveSemanticGatePolicy(novel.settingsJson)
  let effectiveSemanticGateMode = semanticGatePolicy.mode
  let criticSemanticReview: SemanticGateReview | null = null
  const glossaryTerms = db.select({ term: glossary.term }).from(glossary)
    .where(eq(glossary.novelId, chapter.novelId))
    .all()
    .map((row) => row.term || '')
    .filter(Boolean)
  const guardrailKnownTerms = collectTrackedEntityNames(chapter.novelId)

  const criticOutput = await executeChapterCriticRuntimePhase({
    shouldRun: shouldRunPipelineRole('critic'),
    chapterId,
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    sender,
    promptInput: {
      novelTitle: novel.title,
      genre: profile.genre,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapterTitleForCheck,
      storyCore,
      context: reviewContext,
      themeChapterTest: themeVoice.themeChapterTest,
      consistencyNotes,
      structuralAlertsSummary,
      arcProgress: latestArcProgressNote,
      arcProgressStatus: buildArcProgressStatus(currentArcRow, chapter.chapterNum),
      arcProgressCheckpoint: buildArcProgressCheckpoint(currentArcRow, chapter.chapterNum),
      scenePlanText,
      draftContent,
      runtimeAssertions: reviewUpstreamArtifacts.runtimeAssertions || [],
      narrativeFields: reviewNarrativeFields,
      guidance: sharedPromptGuidance,
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
      promptTier: complexity,
    },
    chatOptions: criticChatOpts,
    contractVersion: state.contractVersion,
    initialReviewNotes: reviewNotes,
    priorTaskId: retrySourceWorkflowSnapshot?.roles?.critic?.taskId,
    recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'critic')),
    enrichInput: {
    content: draftContent,
    chapterId,
    novelId: chapter.novelId,
    chapterNum: chapter.chapterNum,
    emotionTone: chapter.emotionTone || '',
    chapterWordTarget,
    genre: profile.genre,
    titleMismatchRisk: draftTitleMismatchRisk,
    semanticGateMode: effectiveSemanticGateMode,
    glossaryTerms,
    scenePlanJson: chapter.scenePlanJson,
    sceneDesignFieldGaps,
    novel,
    },
    semanticInput: {
      policy: semanticGatePolicy,
      novelId: chapter.novelId,
      chapterId,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapterTitleForCheck,
      chapterContent: draftContent,
      modelConfigId: novel.modelConfigId || undefined,
      contractSummary: reviewContext.writingContractSummary,
      scenePlanSummary: reviewContext.scenePlanSummary || summarizeStageArtifactText(scenePlanText, 520),
      protagonistReference: profile.protagonistReference,
      scenePlan,
      designTerms: unresolvedDesignGateFlag?.designTerms.slice(0, 12),
    },
    state,
    bindings: session.bindings,
    persistReviewNotes: (nextChapterId, reviewNotesJson) => updateChapter(nextChapterId, { reviewNotesJson }),
  })
  reviewNotes = criticOutput.reviewNotes
  criticSemanticReview = criticOutput.semanticReview
  effectiveSemanticGateMode = criticOutput.effectiveMode

  const enforcerOutput = await executeChapterEnforcerRuntimePhase({
    shouldRun: shouldRunPipelineRole('enforcer'),
    reviewNotes,
    novelId: chapter.novelId,
    chapterId,
    chapterNum: chapter.chapterNum,
    content: draftContent,
    genre: profile.genre,
    knownTerms: guardrailKnownTerms,
    priorTaskId: retrySourceWorkflowSnapshot?.roles?.enforcer?.taskId,
    state,
    bindings: session.bindings,
    persistReviewNotesJson: (reviewNotesJson) => updateChapter(chapterId, { reviewNotesJson }),
  })
  reviewNotes = enforcerOutput.reviewNotes
  return { reviewNotes, criticSemanticReview, effectiveSemanticGateMode, semanticGatePolicy, glossaryTerms, guardrailKnownTerms }
}
interface GeneratedChapterPlannerWriterPhaseInput {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  profile: StoryProfile
  session: ChapterPipelineSession
  options: ChapterGenerationOptions
  sender?: ProgressSink
  fallbackScenePlan: ScenePlanStep[]
  storyCore: string
  scenePlanContext: ChapterContext
  consistencyNotes: string
  complexity: ChapterComplexity
  plannerChatOpts: ReturnType<typeof buildChatOptionsFromRoute>
  writerChatOpts: ReturnType<typeof buildChatOptionsFromRoute>
  draftResolution: StageContextResolverPayload
  promptGuidance: ChapterPipelinePromptGuidanceBundle
  activePromptOverrideKeys: string[]
  executionModeResolution: ReturnType<typeof resolveAiExecutionMode>
  themeVoice: ReturnType<typeof parseThemeVoiceDocument>
  structuralAlertsSummary: string
}

async function executeGeneratedChapterPlannerWriterPhase(input: GeneratedChapterPlannerWriterPhaseInput) {
  const {
    chapter, novel, profile, session, options, sender, fallbackScenePlan, storyCore, scenePlanContext,
    consistencyNotes, complexity, plannerChatOpts, writerChatOpts, draftResolution, promptGuidance,
    activePromptOverrideKeys, executionModeResolution, themeVoice, structuralAlertsSummary,
  } = input
  const { state, runtime, retrySnapshot: retrySourceWorkflowSnapshot } = session
  const { shouldRun: shouldRunPipelineRole } = session.bindings
  const {
    chapterBridgePlanText, plannerNarrativeFields, draftNarrativeFields, sharedPromptGuidance,
    initialStepMemory, draftWritingGuidance,
  } = promptGuidance
  const chapterId = chapter.id

  const unresolvedDesignGateFlag = getUnresolvedDesignGateFlags(chapter.novelId, chapter.chapterNum)
  const designGateDirective = unresolvedDesignGateFlag
    ? [
        '本章在弧级设计校验中被标记为“史实复述/零弧推进”。场景计划必须显式推进以下原创设计元素，不要按历史事件时间线铺陈：',
        `本弧原创设计词元：${unresolvedDesignGateFlag.designTerms.slice(0, 12).join('、')}`,
        unresolvedDesignGateFlag.correctiveDirective,
      ].filter(Boolean).join('\n')
    : ''
  if (unresolvedDesignGateFlag) {
    console.warn(`[chapter:plan] 本章处于未消解的设计校验 flagged 记录中 chapter=${chapterId}，已注入设计对齐矫正指令。`)
  }
  // 弧级节奏模板传导：本章所属弧挂了节奏模板时，把单章节拍段注入 planner prompt（失败静默降级）。
  const chapterRhythmSection = getChapterRhythmSection(chapter.novelId, chapter.chapterNum, chapter.arcId)
  let scenePlan: ScenePlanStep[] = fallbackScenePlan
  let scenePlanText = formatScenePlan(scenePlan)
  let sceneDesignFieldGaps: string[] = []
  const plannerOutput = await executeChapterPlannerRuntimePhase({
    prompt: {
      novelTitle: novel.title,
      genre: profile.genre,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
      plotPoints: chapter.outline || '',
      emotionTone: chapter.emotionTone || '平稳',
      targetWords: resolveChapterReferenceWords(chapter.targetWords, novel),
      storyCore,
      context: scenePlanContext,
      consistencyNotes,
      runtimeAssertions: initialStepMemory.runtimeAssertions,
      narrativeFields: plannerNarrativeFields,
      guidance: sharedPromptGuidance,
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
      promptTier: complexity,
      designGateDirective: designGateDirective || undefined,
      rhythmSection: chapterRhythmSection || undefined,
    },
    shouldRun: shouldRunPipelineRole('planner'),
    chapterId,
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    sender,
    chatOptions: plannerChatOpts,
    fallbackScenePlan,
    storedScenePlanJson: chapter.scenePlanJson,
    priorTaskId: retrySourceWorkflowSnapshot?.roles?.planner?.taskId,
    state,
    runtime,
    bindings: session.bindings,
    validateContracts: () => {
      validateChapterContractsForGeneration(chapterId)
      return buildChapterContractVersion(chapterId)
    },
    persistScenePlan: (nextScenePlan) => {
      updateChapter(chapterId, { scenePlanJson: JSON.stringify(nextScenePlan) })
    },
    persistTaskContractVersion: (taskId, nextContractVersion) => {
      updateTask(taskId, { contractVersion: nextContractVersion })
    },
  })
  scenePlan = plannerOutput.scenePlan
  scenePlanText = plannerOutput.scenePlanText
  sceneDesignFieldGaps = plannerOutput.sceneDesignFieldGaps
  state.contractVersion = plannerOutput.contractVersion
  const writerStepMemory = buildStepMemorySummary({
    chapterBridgePlan: chapterBridgePlanText,
    scenePlanText,
    previousSummary: plannerOutput.reused
      ? '复用已持久化 Planner 快照，直接从指定节点继续。'
      : 'Planner 已固化场景计划，下一步 Writer 必须逐场落正文。',
  })
  const draftContext = allocateStageContextForPipeline(
    applyUpstreamArtifactsToRawContext(draftResolution.effectiveRawContext, {
      scenePlanSummary: summarizeStageArtifactText(scenePlanText, 520),
      contractVersionSummary: buildContractVersionArtifactSummary(state.contractVersion),
      stepMemorySummary: writerStepMemory.summary,
    }),
    chapter,
    complexity,
    'draft',
    undefined,
    options.preserveConstraintLabels,
  )
  commitPlannerStageOutput({
    state,
    bindings: session.bindings,
    output: plannerOutput,
    stepMemory: writerStepMemory,
  })

  const chapterTitleForCheck = chapter.title || getDefaultChapterTitle(chapter.chapterNum)
  const chapterWordTarget = resolveChapterReferenceWords(chapter.targetWords, novel)
  const { draftContent, draftTitleMismatchRisk } = await executeChapterWriterRuntimePhase({
    shouldRun: shouldRunPipelineRole('writer'),
    chapterId,
    novelId: chapter.novelId,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapterTitleForCheck,
    modelConfigId: novel.modelConfigId || undefined,
    sender,
    promptInput: {
      novelTitle: novel.title,
      genre: profile.genre,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapterTitleForCheck,
      emotionTone: chapter.emotionTone || '平稳',
      targetWords: chapterWordTarget,
      storyCore,
      context: draftContext,
      themeChapterTest: themeVoice.themeChapterTest,
      consistencyNotes: draftWritingGuidance,
      structuralAlertsSummary,
      scenePlanText,
      runtimeAssertions: writerStepMemory.runtimeAssertions,
      narrativeFields: draftNarrativeFields,
      guidance: sharedPromptGuidance,
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
      promptTier: complexity,
    },
    chatOptions: writerChatOpts,
    contractVersion: state.contractVersion,
    scenePlanText,
    initialContent: chapter.content || '',
    resumeDraft: options.resumeDraft,
    priorTaskId: retrySourceWorkflowSnapshot?.roles?.writer?.taskId,
    recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'writer')),
    state,
    runtime,
    bindings: session.bindings,
    chapterContent: chapter.content || '',
    resumeSourceTaskId: options.resumeSourceTaskId,
    persistContent: ({ expectedContent, expectedContextVersion, content }) => (
      updatePipelineChapterContent(chapterId, expectedContent, expectedContextVersion, {
        content,
        status: 'reviewing',
      })
    ),
  })
  const lockedParagraphContext = buildLockedParagraphContext(chapter, draftContent)
  const criticStepMemory = buildStepMemorySummary({
    chapterBridgePlan: chapterBridgePlanText,
    scenePlanText,
    draftText: lockedParagraphContext.promptDraftContent,
    previousSummary: 'Writer 已交付初稿，Critic 必须核对场景计划、接力断言、开篇追读和无来源新增。',
  })
  state.snapshot = {
    ...state.snapshot,
    stepMemory: criticStepMemory,
  }
  const reviewUpstreamArtifacts: UpstreamRuntimeArtifacts = {
    scenePlanSummary: summarizeStageArtifactText(scenePlanText, 520),
    draftTextSummary: summarizeStageArtifactText(lockedParagraphContext.promptDraftContent, 680),
    contractVersionSummary: buildContractVersionArtifactSummary(state.contractVersion),
    stepMemorySummary: criticStepMemory.summary,
    runtimeAssertions: criticStepMemory.runtimeAssertions,
    publishGateRiskSummary: summarizeStageArtifactLines([
      structuralAlertsSummary,
      consistencyNotes,
    ], 4, 520),
  }
  const reviewContext = (await resolveStageContextForPipeline(
    'review',
    chapter,
    draftResolution.effectiveRawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion: state.contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: reviewUpstreamArtifacts,
    },
  )).context
  logConstraintInjectionStatus('review', reviewContext)
  const reviewNarrativeFields = promptGuidance.buildNarrativeFields(reviewContext.chapterGoal, draftContent)
  return {
    unresolvedDesignGateFlag, scenePlan, scenePlanText, sceneDesignFieldGaps,
    chapterTitleForCheck, chapterWordTarget, draftContent, draftTitleMismatchRisk,
    lockedParagraphContext, reviewUpstreamArtifacts, reviewContext, reviewNarrativeFields,
    sharedPromptGuidance,
  }
}
interface GeneratedChapterRewritePhaseInput {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  profile: StoryProfile
  session: ChapterPipelineSession
  options: ChapterGenerationOptions
  sender?: ProgressSink
  promptGuidance: ChapterPipelinePromptGuidanceBundle
  themeVoice: ReturnType<typeof parseThemeVoiceDocument>
  draftResolution: StageContextResolverPayload
  complexity: ChapterComplexity
  executionModeResolution: ReturnType<typeof resolveAiExecutionMode>
  usageSnapshot: WritingContextUsageSnapshot
  contextAssemblyReport: AiContextAssemblyReport
  authorStyleLock: AuthorStyleLockSummary
  activePromptOverrideKeys: string[]
  chapterBridgePlanText: string
  scenePlanText: string
  draftContent: string
  lockedParagraphContext: ReturnType<typeof buildLockedParagraphContext>
  reviewNotes: ChapterReviewNotes
  criticSemanticReview: SemanticGateReview | null
  semanticGatePolicy: ReturnType<typeof resolveSemanticGatePolicy>
  effectiveSemanticGateMode: SemanticGateMode
  glossaryTerms: string[]
  guardrailKnownTerms: string[]
  chapterTitleForCheck: string
  chapterWordTarget: number
  storyCore: string
  structuralAlertsSummary: string
}

async function prepareGeneratedChapterRewriteRuntime(input: GeneratedChapterRewritePhaseInput) {
  const {
    chapter, novel, profile, session, options, sender, promptGuidance, themeVoice, draftResolution,
    complexity, executionModeResolution, usageSnapshot, contextAssemblyReport, authorStyleLock,
    activePromptOverrideKeys, chapterBridgePlanText, scenePlanText, draftContent,
    lockedParagraphContext, reviewNotes, criticSemanticReview, semanticGatePolicy, effectiveSemanticGateMode,
    glossaryTerms, guardrailKnownTerms, chapterTitleForCheck, chapterWordTarget, storyCore,
    structuralAlertsSummary,
  } = input
  const { sharedPromptGuidance } = promptGuidance
  const { state } = session
  const {
    sync: syncWorkflowTask,
    startRole: startRoleTask,
    failRole: failRoleTask,
  } = session.bindings
  const chapterId = chapter.id

  const reviewPrioritySummary = buildReviewPrioritySummary(reviewNotes)
  const rewritePolicy = buildAdaptiveRewritePolicy(reviewPrioritySummary)
  const reviewPriorityPrompt = buildReviewPriorityPrompt(reviewPrioritySummary)
  const rewriterStepMemory = buildStepMemorySummary({
    chapterBridgePlan: chapterBridgePlanText,
    scenePlanText,
    draftText: lockedParagraphContext.promptDraftContent,
    reviewNotes,
    previousSummary: 'Critic 已完成审校，Rewriter 必须按优先级修复，不得绕开上游计划。',
  })
  state.snapshot = {
    ...state.snapshot,
    stepMemory: rewriterStepMemory,
  }
  const rewriteUpstreamArtifacts: UpstreamRuntimeArtifacts = {
    scenePlanSummary: summarizeStageArtifactText(scenePlanText, 520),
    draftTextSummary: summarizeStageArtifactText(lockedParagraphContext.promptDraftContent, 680),
    contractVersionSummary: buildContractVersionArtifactSummary(state.contractVersion),
    stepMemorySummary: rewriterStepMemory.summary,
    runtimeAssertions: rewriterStepMemory.runtimeAssertions,
    reviewRiskSummary: buildReviewRiskArtifactSummary(reviewNotes),
    reviewProofSummary: buildReviewProofArtifactSummary(reviewNotes),
    rewriteDeltaSummary: buildRewriteDeltaArtifactSummary(
      reviewNotes,
      rewritePolicy.rewriteScope,
      reviewPriorityPrompt,
    ),
    publishGateRiskSummary: summarizeStageArtifactLines([
      structuralAlertsSummary,
      ...reviewPrioritySummary.reasons,
    ], 5, 640),
  }
  const rewriteContext = (await resolveStageContextForPipeline(
    'rewrite',
    chapter,
    draftResolution.effectiveRawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion: state.contractVersion,
      activePromptOverrideKeys,
      totalBudget: rewritePolicy.contextBudgetMultiplier > 1
        ? Math.round(resolveContextBudgetForStage(
          'rewrite',
          complexity,
          resolveChapterReferenceWords(chapter.targetWords, novel),
          novel.targetWords || 0,
        ) * rewritePolicy.contextBudgetMultiplier)
        : undefined,
      upstreamArtifacts: rewriteUpstreamArtifacts,
    },
  )).context
  const rewriteWritingGuidance = promptGuidance.buildWritingGuidance(rewriteContext.styleTemplate)
  logConstraintInjectionStatus('rewrite', rewriteContext)
  const { stageReports, generationExplainability } = buildChapterPipelineStageObservability({
    executionMode: executionModeResolution.mode,
    resolutionSource: executionModeResolution.source,
    modelConfigId: novel.modelConfigId || undefined,
    usageSnapshot,
    contextAssemblyReport,
    authorStyleLock,
    activePromptOverrideKeys,
    stageReportOptions: {
      rewriteTemperatureCap: rewritePolicy.temperatureCap,
      rewriteContextStrategy: rewritePolicy.contextStrategy,
      rewriteReviewDepth: rewritePolicy.reviewDepth,
      rewriteReasons: rewritePolicy.reasons,
    },
  })
  state.snapshot = {
    ...state.snapshot,
    generationExplainability,
  }
  syncWorkflowTask()
  const rewritePacingCurve = buildStoryPacingCurve(
    chapter.novelId,
    chapter.chapterNum,
    chapter.emotionTone || '平稳',
    reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
  )
  const rewriteNarrativeFields = promptGuidance.buildNarrativeFields(
    rewriteContext.chapterGoal,
    lockedParagraphContext.promptDraftContent,
    reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
  )
  const rewriterChatOpts = buildChatOptionsFromRoute(stageReports[3].route)
  const initialDialogueRepairDirective = buildDialogueRepairDirective({
    similarities: reviewNotes.cross_character_similarity,
    drifts: reviewNotes.dialogue_drift_alerts,
    fillerRisks: reviewNotes.dialogue_filler_risks,
    infoDensityRisks: reviewNotes.dialogue_info_density_risks,
  })
  const prioritizedReviewNotesText = [
    reviewPriorityPrompt,
    initialDialogueRepairDirective,
    formatReviewNotes(reviewNotes),
  ].filter(Boolean).join('\n\n')
  // 差异门失败后回灌的结构性修复指令；非空时随下一轮重写提示词下发
  let structuralRepairDirective = ''
  const rewriterMessageBuilder = createChapterRewriterMessageBuilder({
    novelTitle: novel.title,
    genre: profile.genre,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapterTitleForCheck,
    emotionTone: chapter.emotionTone || '平稳',
    targetWords: chapterWordTarget,
    storyCore,
    context: rewriteContext,
    themeChapterTest: themeVoice.themeChapterTest,
    consistencyNotes: rewriteWritingGuidance,
    structuralAlertsSummary,
    scenePlanText,
    prioritizedReviewNotesText,
    lockedParagraphs: lockedParagraphContext.lockedParagraphs,
    runtimeAssertions: rewriteUpstreamArtifacts.runtimeAssertions || [],
    narrativeFields: rewriteNarrativeFields,
    guidance: {
      ...sharedPromptGuidance,
      storyPacingGuidance: promptGuidance.formatPacingGuidance(rewritePacingCurve),
    },
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
    promptTier: complexity,
  })
  const runRewriterStreamAttempt = createRewriterStreamAttemptRunner({
    novelId: chapter.novelId,
    chapterId,
    modelConfigId: novel.modelConfigId || undefined,
    sender,
    defaultChatOptions: rewriterChatOpts,
    buildMessages: (attemptNumber, rejectedDigests, draftContentOverride) => rewriterMessageBuilder(
      attemptNumber,
      rejectedDigests,
      draftContentOverride || lockedParagraphContext.promptDraftContent,
      structuralRepairDirective,
    ),
    startRole: (messages, detail) => startRoleTask('rewriter', 'chapter_rewriter', detail, {
      inputJson: JSON.stringify(messages),
      runnerType: 'stream',
    }),
    validateInputs: () => assertContractDrivenStageInputs(
      'rewriter',
      state.contractVersion,
      rewriteContext.writingContractSummary,
      scenePlanText,
    ),
    recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'rewriter')),
    failRole: (taskId, error) => failRoleTask('rewriter', taskId, error, { blocked: true }),
    onChunk: (fullOutput, taskId) => {
      state.snapshot = {
        ...state.snapshot,
        partialContent: fullOutput,
        resumeReason: undefined,
        resumeSourceTaskId: taskId,
      }
      syncWorkflowTask()
    },
  })

  const processRewriteOutcome = (
    rewriteOutput: string,
    attemptNumber: number,
    rejectedDigests: string[],
  ) => processChapterRewriteOutcome({
    rewriteOutput,
    originalDraft: draftContent,
    lockedFallbackContent: lockedParagraphContext.initialFallbackContent,
    chapterTitle: chapterTitleForCheck,
    chapterWordTarget,
    semanticGateMode: effectiveSemanticGateMode,
    glossaryTerms,
    repairInput: {
      chapter,
      novel,
      context: rewriteContext,
      storyCore,
      profile,
      scenePlanText,
      consistencyNotes: rewriteWritingGuidance,
      structuralAlertsSummary,
      lockedParagraphs: lockedParagraphContext.lockedParagraphs,
      promptTier: complexity,
      knownTerms: guardrailKnownTerms,
      targetWords: chapterWordTarget,
      attemptNumber,
      rejectedDigests,
    },
    reviewNotes,
  })

  const semanticEvaluator = new RepairSemanticEvaluator({
    mode: effectiveSemanticGateMode,
    criticReview: criticSemanticReview,
    maxCalls: semanticGatePolicy.maxSemanticCallsPerChapter,
    novelId: chapter.novelId,
    chapterId,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapterTitleForCheck,
    modelConfigId: novel.modelConfigId || undefined,
    contractSummary: rewriteContext.writingContractSummary,
    scenePlanSummary: rewriteContext.scenePlanSummary || summarizeStageArtifactText(scenePlanText, 520),
    protagonistReference: profile.protagonistReference,
  })
  const evaluateRepairCandidateSemantics = (candidateContent: string) => (
    semanticEvaluator.evaluate(candidateContent)
  )
  const recheckRewriteRisks = async (
    reviewNotes: ChapterReviewNotes,
    content: string,
  ): Promise<ChapterReviewNotes> => runRewriteRiskRecheck({
    reviewNotes,
    content,
    novelId: chapter.novelId,
    chapterId,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapterTitleForCheck,
    scenePlanText,
    modelConfigId: novel.modelConfigId || undefined,
  })
  return {
    reviewPrioritySummary,
    rewritePolicy,
    rewriteContext,
    runRewriterStreamAttempt,
    processRewriteOutcome,
    semanticEvaluator,
    evaluateRepairCandidateSemantics,
    recheckRewriteRisks,
    setStructuralRepairDirective: (directive: string) => { structuralRepairDirective = directive },
  }
}
async function executeGeneratedChapterRewriteQualityPhase(input: {
  base: GeneratedChapterRewritePhaseInput
  prepared: Awaited<ReturnType<typeof prepareGeneratedChapterRewriteRuntime>>
  rewriterTaskId: number
}): Promise<Awaited<ReturnType<typeof runRewriterQualityPipeline>>> {
  const { base, prepared, rewriterTaskId } = input
  const {
    chapter, novel, profile, session, sender, draftContent, criticSemanticReview, executionModeResolution,
    semanticGatePolicy, effectiveSemanticGateMode, guardrailKnownTerms, chapterTitleForCheck,
    scenePlanText,
  } = base
  const { state, runtime } = session
  const { failRole: failRoleTask } = session.bindings
  const chapterId = chapter.id

  const qualityOutput = await runRewriterQualityPipeline({
    candidateLoop: {
      draftContent,
      reviewPrioritySummary: prepared.reviewPrioritySummary,
      requiresFullRewrite: prepared.rewritePolicy.requiresFullRewrite,
      genre: profile.genre,
      knownTerms: guardrailKnownTerms,
      criticSemanticReview,
      runAttempt: async (attemptNumber, rejectedDigests, detail, chatOptions, directive) => {
        prepared.setStructuralRepairDirective(directive || '')
        return prepared.runRewriterStreamAttempt(attemptNumber, rejectedDigests, detail, chatOptions)
      },
      processOutcome: prepared.processRewriteOutcome,
      evaluateSemantics: prepared.evaluateRepairCandidateSemantics,
      markAttemptComplete: (taskId, message, includeStatusUpdate) => {
        updateTask(taskId, { pipelineStage: 'success', outputText: message, contractVersion: state.contractVersion })
        if (includeStatusUpdate) {
          updateTaskStatus(taskId, 'success', sender, {
            pipelineStage: 'success',
            outputText: message,
            errorMessage: null,
          })
        }
        runtime.setUpstreamTaskId(taskId)
      },
      resolvePremiumChatOptions: () => {
        if (executionModeResolution.mode !== 'cost_saver' && executionModeResolution.mode !== 'fast') return undefined
        try {
          const escalated = buildChapterAiStageReports('premium', executionModeResolution.source, novel.modelConfigId || undefined, {
            rewriteTemperatureCap: Math.max(prepared.rewritePolicy.temperatureCap, 0.7),
            rewriteContextStrategy: prepared.rewritePolicy.contextStrategy,
            rewriteReviewDepth: 'deep',
            rewriteReasons: [...prepared.rewritePolicy.reasons, '差异门重试：升级 premium 路由执行结构性重写。'],
          })
          console.warn(`[chapter:pipeline] 差异门重试升级 premium 路由 chapter=${chapterId}（原模式 ${executionModeResolution.mode}）`)
          return buildChatOptionsFromRoute(escalated[3].route)
        } catch (error) {
          console.warn(`[chapter:pipeline] premium 路由升级失败，沿用原路由重试 chapter=${chapterId}:`, error instanceof Error ? error.message : error)
          return undefined
        }
      },
    },
    postProcess: {
      genre: profile.genre,
      knownTerms: guardrailKnownTerms,
      novelId: chapter.novelId,
      chapterId,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapterTitleForCheck,
      emotionTone: chapter.emotionTone || '',
      scenePlanText,
      modelConfigId: novel.modelConfigId || undefined,
      criticSemanticReview,
      evaluateSemantics: prepared.evaluateRepairCandidateSemantics,
      onRiskRechecked: (riskReviewNotes, content) => {
        state.latestUsableDraft = content.trim()
        state.latestReviewNotesJson = JSON.stringify(riskReviewNotes)
        if (state.latestUsableDraft) state.snapshot = { ...state.snapshot, partialContent: state.latestUsableDraft, resumeSourceTaskId: rewriterTaskId }
      },
    },
    gateRepair: {
      chapterId,
      genre: profile.genre,
      knownTerms: guardrailKnownTerms,
      markCurrentAttempt: (taskId, message) => {
        updateTask(taskId, { pipelineStage: 'success', outputText: message, contractVersion: state.contractVersion })
        runtime.setUpstreamTaskId(taskId)
      },
      runAttempt: (attemptNumber, rejectedDigests, detail, directive, content) => {
        prepared.setStructuralRepairDirective(directive)
        return prepared.runRewriterStreamAttempt(attemptNumber, rejectedDigests, detail, undefined, content)
      },
      processOutcome: prepared.processRewriteOutcome,
      recheckRisks: prepared.recheckRewriteRisks,
      persistAccepted: async (outcome, taskId) => {
        state.latestUsableDraft = outcome.content.trim()
        state.latestReviewNotesJson = JSON.stringify(outcome.reviewNotes)
        persistAntiAiRuleHits({
          novelId: chapter.novelId,
          chapterId,
          chapterNum: chapter.chapterNum,
          content: outcome.content,
          genre: profile.genre,
          knownTerms: guardrailKnownTerms,
        })
        state.expectedContent = updatePipelineChapterContent(chapterId, state.expectedContent, state.expectedContextVersion, {
          content: outcome.content,
          reviewNotesJson: state.latestReviewNotesJson,
          status: 'draft',
        })
        runtime.adoptSnapshot(state.snapshot)
        state.snapshot = runtime.checkpointContent({ persistedContent: outcome.content, resumableContent: outcome.content, resumeSourceTaskId: taskId })
        return runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: effectiveSemanticGateMode })
      },
    },
    goldenReview: {
      policy: { ...semanticGatePolicy, mode: effectiveSemanticGateMode },
      evaluator: prepared.semanticEvaluator,
      novelId: chapter.novelId,
      chapterId,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapterTitleForCheck,
      modelConfigId: novel.modelConfigId || undefined,
      contractSummary: prepared.rewriteContext.writingContractSummary,
      scenePlanSummary: prepared.rewriteContext.scenePlanSummary || summarizeStageArtifactText(scenePlanText, 520),
      protagonistReference: profile.protagonistReference,
    },
    persistCandidate: async (candidate) => {
      state.latestUsableDraft = candidate.content.trim()
      state.latestReviewNotesJson = candidate.reviewNotesJson
      state.expectedContent = updatePipelineChapterContent(chapterId, state.expectedContent, state.expectedContextVersion, {
        content: candidate.content,
        reviewNotesJson: state.latestReviewNotesJson,
        status: 'draft',
      })
      runtime.adoptSnapshot(state.snapshot)
      state.snapshot = runtime.checkpointContent({
        persistedContent: candidate.content,
        resumableContent: candidate.content,
        resumeSourceTaskId: candidate.taskId,
      })
      state.hasCommittedContent = true
      return runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: effectiveSemanticGateMode })
    },
    persistGoldenReview: (notes) => {
      state.latestReviewNotesJson = JSON.stringify(notes)
      updateChapter(chapterId, { reviewNotesJson: state.latestReviewNotesJson }, { skipStaleTracking: true, versionSource: false })
    },
    rerunHeuristicPublishCheck: () => runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: 'off' }),
    finalizePublishArtifacts: (check) => {
      const expressionDedup = analyzeExpressionDedupForChapter(chapterId)
      const hookContinuity = buildHookContinuitySnapshot(chapterId, check.scoreBreakdown.hookStrengthScore)
      updateChapter(chapterId, {
        expressionDedupJson: expressionDedup ? JSON.stringify(expressionDedup) : '',
        hookContinuityJson: JSON.stringify(hookContinuity),
      }, { skipStaleTracking: true, versionSource: false })
    },
    syncRevisionState: () => {
      syncFeedbackRecurrenceState(chapter.novelId)
      syncDialogueDriftRevisionTasks(chapter.novelId)
    },
    failRole: (taskId, error, blocked) => failRoleTask('rewriter', taskId, error, { blocked }),
    rewriteScope: prepared.rewritePolicy.rewriteScope,
  })
  prepared.setStructuralRepairDirective('')
  return qualityOutput
}
async function executeGeneratedChapterRewritePhase(
  input: GeneratedChapterRewritePhaseInput,
): Promise<{ repairedContent: string; publishCheck: ChapterPublishCheck }> {
  const { chapter, session, options, draftContent, reviewNotes, effectiveSemanticGateMode } = input
  const { state, retrySnapshot: retrySourceWorkflowSnapshot } = session
  const { shouldRun: shouldRunPipelineRole } = session.bindings
  const chapterId = chapter.id
  const priorTaskId = retrySourceWorkflowSnapshot?.roles?.rewriter?.taskId || 0

  if (shouldRunPipelineRole('rewriter')) {
    const prepared = await prepareGeneratedChapterRewriteRuntime(input)
    const qualityOutput = await executeGeneratedChapterRewriteQualityPhase({
      base: input,
      prepared,
      rewriterTaskId: priorTaskId,
    })
    const committed = commitRewriterStageOutput({
      state,
      bindings: session.bindings,
      output: { ...qualityOutput, reused: false },
      resumeSourceTaskId: options.resumeSourceTaskId,
    })
    return { repairedContent: committed.content, publishCheck: committed.publishCheck }
  }

  if (!draftContent.trim() || !hasReviewNotes(reviewNotes)) {
    throw new ChapterPipelineStageError('invalid_output', '没有可复用的 Rewriter 前置快照，无法从当前节点重试。', {
      blocked: true,
      outputText: buildPipelineFailureOutput('invalid_output', '缺少可复用的正文或审校快照。'),
    })
  }
  const publishCheck = runChapterPublishCheck(chapterId, {
    phase: 'pipeline',
    semanticGateMode: effectiveSemanticGateMode,
  })
  const committed = commitRewriterStageOutput({
    state,
    bindings: session.bindings,
    output: {
      content: draftContent,
      reviewNotes,
      publishCheck,
      taskId: priorTaskId,
      reused: true,
    },
    resumeSourceTaskId: options.resumeSourceTaskId,
  })
  return { repairedContent: committed.content, publishCheck: committed.publishCheck }
}

interface GeneratedChapterFinalizePhaseInput {
  chapter: typeof chapters.$inferSelect
  session: ChapterPipelineSession
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>
  repairedContent: string
  publishCheck: ChapterPublishCheck
  sender?: ProgressSink
}

async function finalizeGeneratedChapterPipeline(input: GeneratedChapterFinalizePhaseInput): Promise<void> {
  const { chapter, session, rawContext, repairedContent, publishCheck, sender } = input
  const { state, runtime, retrySnapshot } = session
  const chapterId = chapter.id
  const { result } = await executeChapterFinalizePhase({
    chapterId,
    sender,
    contractVersion: state.contractVersion,
    priorCanonizerTaskId: retrySnapshot?.roles?.canonizer?.taskId,
    canonizerRecoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'canonizer')),
    bindings: session.bindings,
    finalizeContent: () => finalizeChapterPipelineOutput({
      chapter,
      novelModelConfigId: rawContext.novel.modelConfigId || undefined,
      creativeStageContext: rawContext.creativeStageContext,
      content: repairedContent,
      getCommittedChapter: () => getChapter(chapterId),
      commitContent: () => finalizeGeneratedChapterContent(
        chapterId,
        repairedContent,
        state.expectedContent,
        state.expectedContextVersion,
        {
          onContextCheckpoint: (contextVersion) => checkpointChapterPipelineContextVersion({
            state,
            runtime,
            bindings: session.bindings,
            contextVersion,
          }),
        },
      ),
    }),
    publishSummary: publishCheck.summary,
  })
  commitChapterPipelineSuccess({
    state,
    runtime,
    bindings: session.bindings,
    chapterNum: chapter.chapterNum,
    result,
  })
}

function buildChapterGenerationIdempotencyKey(chapter: typeof chapters.$inferSelect, stageId?: number): string {
  const source = [
    chapter.id,
    chapter.contextVersion || 1,
    chapter.updatedAt || '',
    chapter.status || 'outline',
    stageId || 'auto-stage',
  ].join('|')
  return `chapter-write:${chapter.id}:${createHash('sha256').update(source).digest('hex').slice(0, 24)}`
}

function getRequiredChapterGenerationInput(chapterId: number): typeof chapters.$inferSelect {
  const chapter = getDb().select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })
  return chapter
}

async function loadChapterGenerationRawContext(
  chapter: typeof chapters.$inferSelect,
  stageId?: number,
) {
  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum, stageId)
  if (stageId && rawContext.creativeStageContext) {
    assertCreativeStageContextReadyForGeneration(rawContext.creativeStageContext)
  }
  return rawContext
}

function assertChapterGenerationInputCurrent(chapterId: number, expectedFingerprint: string): void {
  const current = getRequiredChapterGenerationInput(chapterId)
  const currentFingerprint = buildChapterGenerationInputFingerprint(current as unknown as Record<string, unknown>)
  if (currentFingerprint !== expectedFingerprint) throwUserFacingError('chapter.pipelineInputConflict')
}

function findExistingChapterGenerationTask(chapterId: number, idempotencyKey: string) {
  const db = getDb()
  return db.select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(
      eq(tasks.type, 'chapter_write'),
      eq(tasks.runnerType, 'workflow'),
      eq(tasks.relatedEntityType, 'chapter'),
      eq(tasks.relatedEntityId, chapterId),
      eq(tasks.idempotencyKey, idempotencyKey),
    ))
    .all()[0] || null
}

/**
 * Single-flight plus a durable idempotency key for one chapter generation
 * request. The in-memory promise handles same-process double clicks; the task
 * unique index and key make the request replay-safe across backend calls.
 */
export async function generateChapterContent(
  chapterId: number,
  sender?: ProgressSink,
  options: ChapterGenerationOptions = {},
): Promise<number> {
  const inFlight = chapterGenerationLocks.get(chapterId)
  if (inFlight) {
    if (options.onWorkflowTaskCreated) {
      observeChapterGenerationTask(chapterId, options.onWorkflowTaskCreated)
    }
    return inFlight
  }

  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })
  const idempotencyKey = buildChapterGenerationIdempotencyKey(chapter, options.stageId)
  const existing = findExistingChapterGenerationTask(chapterId, idempotencyKey)
  if (existing && !isRetryableChapterGenerationStatus(existing.status)) {
    options.onWorkflowTaskCreated?.(Number(existing.id))
    return Number(existing.id)
  }

  // A failed/cancelled run must not permanently consume the deterministic key.
  // Keep active/successful calls idempotent, while allowing the visible retry
  // action to create a fresh durable workflow task.
  const nextIdempotencyKey = buildChapterGenerationRequestKey(idempotencyKey, {
    existingStatus: existing?.status,
    retryToken: randomUUID(),
  })

  if (options.onWorkflowTaskCreated) {
    observeChapterGenerationTask(chapterId, options.onWorkflowTaskCreated)
  }
  const run = generateChapterContentInternal(chapterId, sender, {
    ...options,
    onWorkflowTaskCreated: (taskId) => publishChapterGenerationTaskId(chapterId, taskId),
  }, nextIdempotencyKey)
  chapterGenerationLocks.set(chapterId, run)
  try {
    return await run
  } finally {
    if (chapterGenerationLocks.get(chapterId) === run) {
      chapterGenerationLocks.delete(chapterId)
      chapterGenerationTaskIds.delete(chapterId)
      chapterGenerationTaskObservers.delete(chapterId)
    }
  }
}

async function generateChapterContentInternal(
  chapterId: number,
  sender?: ProgressSink,
  options: ChapterGenerationOptions = {},
  idempotencyKey?: string,
): Promise<number> {
  const db = getDb()
  const chapter = getRequiredChapterGenerationInput(chapterId)
  const initialGenerationInputFingerprint = buildChapterGenerationInputFingerprint(chapter as unknown as Record<string, unknown>)

  const rawContext = await loadChapterGenerationRawContext(chapter, options.stageId)
  const novel = rawContext.novel
  const profile = rawContext.profile
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const narrativeSceneSnapshots = loadNarrativeControlSceneSnapshots(chapterId)
  const narrativeControlCharacterNames = db.select({ name: characters.fullName })
    .from(characters)
    .where(eq(characters.novelId, chapter.novelId))
    .all()
    .map((row) => row.name || '')
    .filter(Boolean)
  const narrativeContractSignals = loadNarrativeContractSignals(chapterId)
  const consistencyNotes = buildConsistencyPromptSummary(buildNovelConsistencyReport(chapter.novelId))
  const previousStatus = chapter.status || 'outline'
  const fallbackScenePlan = buildFallbackScenePlan(chapter)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: novel.settingsJson,
  })
  const session = await createChapterPipelineSession({
    chapter,
    modelConfigId: novel.modelConfigId || undefined,
    sender,
    idempotencyKey,
    stageId: options.stageId,
    resumeDraft: options.resumeDraft,
    resumeSourceTaskId: options.resumeSourceTaskId,
    executionMode: executionModeResolution.mode,
    initialContextVersion: rawContext.novel.contextVersion || 1,
    previousStatus,
    retryNodeRole: options.retryNodeRole,
    retrySourceNodeRunId: options.retrySourceNodeRunId,
    retryReason: options.retryReason,
    retryUpstreamSnapshotId: options.retryUpstreamSnapshotId,
    onWorkflowTaskCreated: options.onWorkflowTaskCreated,
    buildRecoveryHint: (role, failureCode) => buildChapterPipelineRecoveryHint(
      chapter.novelId,
      chapterId,
      role,
      failureCode,
    ),
    getOutputRefs: (state) => ({
      chapterId,
      contentHash: buildChapterContentHash(state.latestUsableDraft || chapter.content || ''),
      scenePlanHash: hashWorkflowNodeInput(chapter.scenePlanJson || ''),
      reviewNotesHash: hashWorkflowNodeInput(state.latestReviewNotesJson || chapter.reviewNotesJson || ''),
    }),
    onProgress: (currentSnapshot, progress) => sendPipelineProgress(sender, currentSnapshot, progress),
    loadRetrySnapshot: (taskId) => getTaskRecord(taskId)?.progressJson,
    persistUsableDraft: ({ expectedContent, expectedContextVersion, content, reviewNotesJson }) => (
      updatePipelineChapterContent(chapterId, expectedContent, expectedContextVersion, {
        content,
        reviewNotesJson,
        status: 'reviewing',
      })
    ),
    updateFailureStatus: (status, restorePrevious) => updateChapter(
      chapterId,
      { status },
      restorePrevious ? { versionSource: false } : { skipStaleTracking: true, versionSource: false },
    ),
  })
  const { runtime, state } = session
  const workflowTaskId = runtime.workflowTaskId
  const {
    shouldRun: shouldRunPipelineRole,
    setStatus: setWorkflowTaskStatus,
    failRole: failRoleTask,
  } = session.bindings

  try {
    assertChapterGenerationInputCurrent(chapterId, initialGenerationInputFingerprint)
    const preparedContexts = await prepareChapterPipelineStageContexts(chapter, rawContext, {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion: state.contractVersion,
    })
    const {
      activePromptOverrideKeys,
      complexity,
      scenePlanResolution,
      draftResolution,
    } = preparedContexts
    let { scenePlanContext } = preparedContexts
    const { draftContext } = preparedContexts
    const { reviewContext: initialReviewContext, rewriteContext } = preparedContexts
    state.expectedContextVersion = preparedContexts.contextVersion
    runtime.adoptSnapshot(state.snapshot)
    state.snapshot = runtime.checkpointContext(state.expectedContextVersion)
    const observability = buildChapterPipelineObservability({
      chapterId,
      novelId: chapter.novelId,
      themeVoiceJson: novel.themeVoiceJson,
      rawContext: draftResolution.effectiveRawContext,
      draftContext,
      executionMode: executionModeResolution.mode,
      resolutionSource: executionModeResolution.source,
      modelConfigId: novel.modelConfigId || undefined,
      activePromptOverrideKeys,
    })
    const { usageSnapshot, contextAssemblyReport, authorStyleLock } = observability
    const { stageReports, generationExplainability } = observability
    const plannerChatOpts = buildChatOptionsFromRoute(stageReports[0].route)
    const writerChatOpts = buildChatOptionsFromRoute(stageReports[1].route)
    const criticChatOpts = buildChatOptionsFromRoute(stageReports[2].route)
    logConstraintInjectionStatus('scenePlan', scenePlanContext)
    logConstraintInjectionStatus('draft', draftContext)
    logConstraintInjectionStatus('review', initialReviewContext)
    logConstraintInjectionStatus('rewrite', rewriteContext)
    const storyCore = buildStoryCore(profile, rewriteContext.storyCore || draftContext.storyCore || scenePlanContext.storyCore)
    const currentArcRow = rawContext.currentArc
    const latestArcProgressNote = getLatestArcProgressNote(chapter.novelId, currentArcRow, chapter.chapterNum)
    const structuralAlertsSummary = buildStructuralAlertsSummary(chapter.novelId, chapter.chapterNum, chapter.volumeId)
    const promptGuidance = createChapterPipelinePromptGuidance({
      chapter,
      themeVoice,
      narrativeSceneSnapshots,
      narrativeControlCharacterNames,
      narrativeContractSignals,
      genre: profile.genre,
      consistencyNotes,
      storyCore,
      scenePlanContext,
      draftContext,
      contractVersion: state.contractVersion,
    })
    const { chapterBridgePlan, chapterBridgePlanText, initialStepMemory } = promptGuidance
    scenePlanContext = allocateStageContextForPipeline(
      applyUpstreamArtifactsToRawContext(scenePlanResolution.effectiveRawContext, {
        stepMemorySummary: initialStepMemory.summary,
      }),
      chapter,
      complexity,
      'scenePlan',
      undefined,
      options.preserveConstraintLabels,
    )
    state.snapshot = {
      ...state.snapshot,
      recallSnapshot: draftContext.recallSnapshot,
      recallDiagnostics: draftContext.recallDiagnostics,
      contextAssemblyReport,
      authorStyleLock,
      generationExplainability,
      writerContextResolution: draftResolution.writerContextResolution,
      stepMemory: initialStepMemory,
    }
    try {
      persistChapterRecallRuntimeSnapshot({
        novelId: chapter.novelId,
        chapterId,
        recallSnapshot: draftContext.recallSnapshot,
        recallDiagnostics: draftContext.recallDiagnostics,
        source: 'runtime',
        sourceTaskId: workflowTaskId,
        contextVersion: chapter.contextVersion || novel.contextVersion || 1,
      })
    } catch (error) {
      console.warn(`[chapter] failed to persist recall runtime snapshot for chapter ${chapterId}:`, error)
    }

    updateChapter(chapterId, {
      status: 'writing',
      ...(shouldRunPipelineRole('planner') ? { scenePlanJson: '' } : {}),
      ...(shouldRunPipelineRole('writer') ? { reviewNotesJson: '' } : {}),
      bridgePlanJson: chapterBridgePlan ? JSON.stringify(chapterBridgePlan) : '',
    }, { versionSource: false })
    updateTaskProgress(workflowTaskId, state.snapshot, sender)
    setWorkflowTaskStatus('running', {
      currentChildTaskId: null,
      errorMessage: null,
    })

    // 弧级设计校验传导：本章仍在未消解的 flagged 记录中时，把设计词元 top12 与
    // 矫正指令注入 planner prompt，并在 critic 语义门追加 design_alignment 维度。
    const plannerWriter = await executeGeneratedChapterPlannerWriterPhase({
      chapter, novel, profile, session, options, sender, fallbackScenePlan, storyCore, scenePlanContext,
      consistencyNotes, complexity, plannerChatOpts, writerChatOpts, draftResolution, promptGuidance,
      activePromptOverrideKeys, executionModeResolution, themeVoice, structuralAlertsSummary,
    })
    const { scenePlanText, draftContent, lockedParagraphContext, chapterTitleForCheck, chapterWordTarget } = plannerWriter
    const reviewResult = await executeGeneratedChapterReviewPhase({
      chapter, novel, profile, session, sender, options, plannerWriter, storyCore, consistencyNotes,
      structuralAlertsSummary, latestArcProgressNote, currentArcRow: currentArcRow || null, complexity, criticChatOpts,
      themeVoice, db,
    })
    const { reviewNotes, criticSemanticReview, effectiveSemanticGateMode, glossaryTerms, guardrailKnownTerms } = reviewResult
    const { repairedContent, publishCheck } = await executeGeneratedChapterRewritePhase({
      chapter,
      novel,
      profile,
      session,
      options,
      sender,
      promptGuidance,
      themeVoice,
      draftResolution,
      complexity,
      executionModeResolution,
      usageSnapshot,
      contextAssemblyReport,
      authorStyleLock,
      activePromptOverrideKeys,
      chapterBridgePlanText,
      scenePlanText,
      draftContent,
      lockedParagraphContext,
      reviewNotes,
      criticSemanticReview,
      semanticGatePolicy: reviewResult.semanticGatePolicy,
      effectiveSemanticGateMode,
      glossaryTerms,
      guardrailKnownTerms,
      chapterTitleForCheck,
      chapterWordTarget,
      storyCore,
      structuralAlertsSummary,
    })
    await finalizeGeneratedChapterPipeline({
      chapter,
      session,
      rawContext,
      repairedContent,
      publishCheck,
      sender,
    })
    return workflowTaskId
  } catch (error) {
    const workflowTask = getTaskRecord(workflowTaskId)
    if (workflowTask?.status === 'failed' || workflowTask?.status === 'cancelled') {
      throw error
    }
    failRoleTask(state.snapshot.currentRole || 'planner', state.snapshot.currentRole ? state.snapshot.roles[state.snapshot.currentRole].taskId : undefined, error)
    throw error instanceof Error ? error : new Error('章节生成中断')
  }
}

export async function generateChapterSummary(chapterId: number): Promise<void> {
  await refreshChapterMemory(chapterId)
  void prepareChapterWritebackRun(chapterId, 'summary-refresh').catch((error) => {
    console.warn(`[chapter:warn] writeback-draft chapter=${chapterId}`, error)
  })
}

// 供评测/恢复流程只补齐正文派生状态使用。与用户主动点击“生成摘要”不同，
// 该入口不额外创建异步写回审校任务，避免批量回填时让模型队列与评测互相等待。
export async function refreshChapterDerivedState(chapterId: number): Promise<void> {
  await refreshChapterMemory(chapterId)
}

const chapterResumeLocks = new Map<number, Promise<number>>()

function assertChapterResumeBaseCurrent(
  chapterId: number,
  snapshot: Partial<ChapterPipelineSnapshot> | null,
): void {
  const currentChapter = getDb().select({ content: chapters.content, novelId: chapters.novelId })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .all()[0]
  if (!currentChapter) throwUserFacingError('chapter.notFound')
  const currentNovel = getDb().select({ contextVersion: novels.contextVersion })
    .from(novels)
    .where(eq(novels.id, currentChapter.novelId))
    .all()[0]
  if (!currentNovel) throwUserFacingError('novel.notFound')
  const status = validateChapterPipelineResumeBase(snapshot, {
    content: currentChapter.content || '',
    contextVersion: currentNovel.contextVersion || 1,
  })
  if (status === 'unsupported') {
    // Precise recovery requires both the latest persisted content checkpoint
    // and the context version used by the workflow. Older or damaged tasks
    // fail closed instead of skipping upstream nodes against unknown state.
    throwUserFacingError('workflow.resumeUnsupported')
  }
  if (status === 'content_conflict') throwUserFacingError('chapter.pipelineContentConflict')
  if (status === 'context_conflict') throwUserFacingError('chapter.pipelineContextConflict')
}

export async function resumeChapterPipeline(taskId: number, sender?: ProgressSink): Promise<number> {
  const inFlight = chapterResumeLocks.get(taskId)
  if (inFlight) return inFlight

  const run = resumeChapterPipelineInternal(taskId, sender)
  chapterResumeLocks.set(taskId, run)
  try {
    return await run
  } finally {
    if (chapterResumeLocks.get(taskId) === run) chapterResumeLocks.delete(taskId)
  }
}

export async function retryChapterPipelineNode(nodeRunId: number, sender?: ProgressSink): Promise<number> {
  const retryPlan = prepareWorkflowNodeRetry(nodeRunId)
  if (!isChapterPipelineRole(retryPlan.source.nodeKey)) {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  const role = retryPlan.source.nodeKey
  const sourceTask = getTaskRecord(retryPlan.source.workflowTaskId)
  if (!sourceTask || sourceTask.type !== 'chapter_write' || sourceTask.relatedEntityType !== 'chapter' || !sourceTask.relatedEntityId) {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  const sourceSnapshot = parseChapterPipelineSnapshot(sourceTask.progressJson)
  if (sourceTask.status === 'success') throwUserFacingError('workflow.resumeUnsupported')
  if (['pending', 'running', 'cancel_requested'].includes(sourceTask.status || '')) {
    throwUserFacingError('workflow.taskRunningCannotResume', { taskId: sourceTask.id })
  }
  const chapterId = Number(sourceTask.relatedEntityId)
  const currentChapter = getDb().select({ content: chapters.content, novelId: chapters.novelId }).from(chapters)
    .where(eq(chapters.id, chapterId)).all()[0]
  if (!currentChapter) throwUserFacingError('chapter.notFound')
  assertChapterResumeBaseCurrent(chapterId, sourceSnapshot)

  const retryExecutionPlan = buildChapterPipelineRetryPlan(role)
  const preservedDraft = typeof sourceSnapshot?.partialContent === 'string'
    ? sourceSnapshot.partialContent.trim()
    : (currentChapter.content || '').trim()
  return generateChapterContent(chapterId, sender, {
    executionMode: sourceSnapshot?.executionMode,
    stageId: typeof parseTaskControl(sourceTask).stageId === 'number'
      ? parseTaskControl(sourceTask).stageId
      : undefined,
    resumeDraft: !retryExecutionPlan.shouldRun.writer
      ? preservedDraft || undefined
      : undefined,
    resumeSourceTaskId: sourceTask.id,
    retryNodeRole: role,
    retrySourceNodeRunId: retryPlan.source.id,
    retryUpstreamSnapshotId: retryPlan.source.upstreamSnapshotId,
    retryReason: `manual_retry:${role}`,
  })
}

async function resumeChapterPipelineInternal(taskId: number, sender?: ProgressSink): Promise<number> {
  const task = getTaskRecord(taskId)
  if (!task) throwUserFacingError('task.notFound', { id: taskId })

  const rootTask = task.type === 'chapter_write'
    ? task
    : task.parentTaskId
      ? getTaskRecord(task.parentTaskId)
      : null

  if (!rootTask || rootTask.type !== 'chapter_write' || rootTask.relatedEntityType !== 'chapter' || !rootTask.relatedEntityId) {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  if (rootTask.status === 'success') {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  if (['pending', 'running', 'cancel_requested'].includes(rootTask.status || '')) {
    throwUserFacingError('workflow.taskRunningCannotResume', { taskId: rootTask.id })
  }
  const snapshot = parseChapterPipelineSnapshot(rootTask.progressJson)
  const control = parseTaskControl(rootTask)
  const stageId = typeof control.stageId === 'number' ? control.stageId : undefined
  const partialContent = typeof snapshot?.partialContent === 'string' ? snapshot.partialContent.trim() : ''
  const resumeMode = resolveChapterPipelineResumeMode({
    hasPartialContent: Boolean(partialContent),
    lastFailureRole: snapshot?.lastFailureRole,
  })
  if (partialContent) {
    assertChapterResumeBaseCurrent(rootTask.relatedEntityId, snapshot)
    if (resumeMode === 'continue_writer') {
      return continueChapterContent(rootTask.relatedEntityId, partialContent, sender, {
        executionMode: snapshot?.executionMode,
        sourceTaskId: rootTask.id,
        stageId,
      })
    }
    // Later-stage failures retain a complete persisted candidate. Retry the
    // failed node and reuse immutable upstream outputs instead of appending to
    // the chapter or regenerating Planner/Writer artifacts.
    const retry = buildChapterPipelineResumeRetryMetadata(snapshot)
    return generateChapterContent(rootTask.relatedEntityId, sender, {
      executionMode: snapshot?.executionMode,
      stageId,
      resumeDraft: partialContent,
      resumeSourceTaskId: rootTask.id,
      retryNodeRole: retry?.retryNodeRole,
      retrySourceNodeRunId: retry?.retrySourceNodeRunId,
      retryUpstreamSnapshotId: retry?.retryUpstreamSnapshotId,
      retryReason: retry ? `automatic_resume:${retry.retryNodeRole}` : undefined,
    })
  }
  return generateChapterContent(rootTask.relatedEntityId, sender, { stageId })
}

export async function getChapterContextPreview(
  chapterId: number,
  options: { executionMode?: AiExecutionMode; preserveConstraintLabels?: HardConstraintSourceLabel[]; stageId?: number } = {},
): Promise<import('../../src/types').ChapterContextPreview> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum, options.stageId)
  const contractVersion = buildChapterContractVersion(chapterId, { allowMissing: true })
  const contractGate = getChapterContractPreviewGate(chapterId)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: rawContext.novel.settingsJson,
  })
  const complexity = classifyChapterComplexity({
    chapter,
    currentArc: rawContext.currentArc,
    chapterRows: rawContext.chapterRows,
    outlineMentionedCharacterCount: rawContext.outlineMentionedCharacterCount,
    activeThreadPressureCount: rawContext.activeThreadPressureCount,
  })
  const activePromptOverrideKeys = getActiveChapterPromptOverrideKeys()
  const persistedScenePlanText = buildPersistedScenePlanText(chapter.scenePlanJson)
  const persistedReviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
  const persistedReviewPrioritySummary = buildReviewPrioritySummary(persistedReviewNotes)
  const previewStepMemory = buildStepMemorySummary({
    chapterBridgePlan: rawContext.contextParts.chapterBridgePlan,
    scenePlanText: persistedScenePlanText,
    draftText: chapter.content || '',
    reviewNotes: persistedReviewNotes,
    previousSummary: buildContractVersionArtifactSummary(contractVersion),
  })
  const previewStepMemoryArtifacts = {
    stepMemorySummary: previewStepMemory.summary,
    runtimeAssertions: previewStepMemory.runtimeAssertions,
  }

  const scenePlanResolution = await resolveStageContextForPipeline(
    'scenePlan',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: {
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        ...previewStepMemoryArtifacts,
      },
    },
  )
  const draftResolution = await resolveStageContextForPipeline(
    'draft',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: previewStepMemoryArtifacts,
    },
  )
  const reviewResolution = await resolveStageContextForPipeline(
    'review',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: {
        scenePlanSummary: summarizeStageArtifactText(persistedScenePlanText, 520),
        draftTextSummary: summarizeStageArtifactText(chapter.content || '', 680),
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        reviewRiskSummary: buildReviewRiskArtifactSummary(persistedReviewNotes),
        reviewProofSummary: buildReviewProofArtifactSummary(persistedReviewNotes),
        publishGateRiskSummary: summarizeStageArtifactLines(persistedReviewPrioritySummary.reasons, 4, 520),
        ...previewStepMemoryArtifacts,
      },
    },
  )
  const rewriteResolution = await resolveStageContextForPipeline(
    'rewrite',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: {
        scenePlanSummary: summarizeStageArtifactText(persistedScenePlanText, 520),
        draftTextSummary: summarizeStageArtifactText(chapter.content || '', 680),
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        reviewRiskSummary: buildReviewRiskArtifactSummary(persistedReviewNotes),
        reviewProofSummary: buildReviewProofArtifactSummary(persistedReviewNotes),
        rewriteDeltaSummary: buildRewriteDeltaArtifactSummary(
          persistedReviewNotes,
          persistedReviewPrioritySummary.rewriteScope,
          buildReviewPriorityPrompt(persistedReviewPrioritySummary),
        ),
        publishGateRiskSummary: summarizeStageArtifactLines(persistedReviewPrioritySummary.reasons, 4, 520),
        ...previewStepMemoryArtifacts,
      },
    },
  )
  const contexts: Record<ChapterContextStage, ChapterContext> = {
    scenePlan: scenePlanResolution.context,
    draft: draftResolution.context,
    review: reviewResolution.context,
    rewrite: rewriteResolution.context,
  }
  const orderedStages: ChapterContextStage[] = ['scenePlan', 'draft', 'review', 'rewrite']
  const {
    usageSnapshot,
    contextAssemblyReport,
    authorStyleLock,
    generationExplainability,
  } = buildChapterPipelineObservability({
    chapterId: chapter.id,
    novelId: chapter.novelId,
    themeVoiceJson: rawContext.novel.themeVoiceJson,
    rawContext: draftResolution.effectiveRawContext,
    draftContext: contexts.draft,
    executionMode: executionModeResolution.mode,
    resolutionSource: executionModeResolution.source,
    modelConfigId: rawContext.novel.modelConfigId || undefined,
    activePromptOverrideKeys,
  })

  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    creativeStage: rawContext.creativeStageContext?.stage,
    contractVersion,
    contractReady: contractGate.ready,
    contractBlockers: contractGate.blockers,
    complexity,
    assemblyVersion: 'v2-unified',
    assemblyNotes: [
      '统一上下文组装器：图谱召回、时间召回与合同召回已合并调度。',
      '解释报告会同步展示执行模式、结构化输出与低置信度事实。',
    ],
    contextAssemblyReport,
    authorStyleLock,
    generationExplainability,
    previousChapterContext: rawContext.contextParts.previousChapterContext,
    chapterBridgePlan: contexts.draft.chapterBridgePlan,
    stepMemorySummary: contexts.draft.stepMemorySummary,
    previousChapterSampleReport: rawContext.previousChapterSampleReport,
    recalledMemory: contexts.draft.recalledMemory,
    recallSnapshot: contexts.draft.recallSnapshot,
    recallDiagnostics: contexts.draft.recallDiagnostics,
    recalledMemorySources: contexts.draft.recalledMemorySources,
    usageSnapshot,
    writerContextResolution: draftResolution.writerContextResolution,
    stages: orderedStages.map((stage) => {
      const context = contexts[stage]
      const resolution = stage === 'scenePlan'
        ? scenePlanResolution
        : stage === 'draft'
          ? draftResolution
          : stage === 'review'
            ? reviewResolution
            : rewriteResolution
      return {
        stage,
        hardConstraintContext: context.hardConstraintContext,
        hardConstraintSummary: context.hardConstraintSummary,
        hardConstraintEntries: context.hardConstraintEntries,
        constraintInjectionStatus: context.constraintInjectionStatus,
        softContextBudgetUsage: context.softContextBudgetUsage,
        contextBudgetReport: context.contextBudgetReport,
        softContextDecisions: context.softContextDecisions,
        droppedConstraintCount: context.droppedConstraintCount,
        upstreamArtifacts: resolution.upstreamArtifacts,
        renderSchema: resolution.renderSchema,
      }
    }),
  }
}

// 整章优化属于高风险候选生成：只要后验事实/质量门未通过，就允许严格保真重试，
// 但把总调用数封顶，避免线上请求在模型不稳定时失控。
const MAX_CHAPTER_OPTIMIZATION_PASSES = 4

export async function optimizeChapterContent(
  chapterId: number,
  options: { executionMode?: AiExecutionMode; extraRequirements?: string; repairMode?: 'language' | 'structural' } = {},
): Promise<ChapterOptimizeResult> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content?.trim()) throwUserFacingError('chapter.contentEmpty')
  const originalContent = chapter.content

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  const genreName = novel?.genreId
    ? db.select({ name: genres.name }).from(genres).where(eq(genres.id, novel.genreId)).all()[0]?.name
    : undefined
  const trackedEntityNames = collectTrackedEntityNames(chapter.novelId)
  const guardrailFindings = collectQualityGuardrailFindings(originalContent, genreName, { knownTerms: trackedEntityNames })
  const reviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
  const issueSummary = dedupeTextList([
    ...formatQualityGuardrailSummary(guardrailFindings),
    ...reviewNotes.critical_fixes,
    ...reviewNotes.language_risks,
    ...reviewNotes.human_language_repairs,
    ...reviewNotes.coherence_risks,
    ...reviewNotes.context_drift_risks,
  ]).slice(0, 12)
  const executionMode = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: novel?.settingsJson,
  })
  const repairMode = options.repairMode || 'language'
  const route = buildAiModelRouteReport({
    taskKind: 'chapter_rewrite',
    stageLabel: 'Chapter Optimize',
    executionMode: executionMode.mode,
    resolutionSource: executionMode.source,
    modelConfigId: novel?.modelConfigId || undefined,
    // 优化是审校型任务，降低采样波动，避免候选稿重新引入已拦截的 AI 句式。
    temperatureCap: 0.35,
    maxTokensFactor: 1.12,
    extraReasons: [
      repairMode === 'structural' ? '结构性质量修订允许重写事件链，但必须通过事实、合同和结构门。' : '整章优化只生成候选稿，不直接覆盖正文。',
    ],
  })

  const supportingCastNames = collectSupportingCastNames(chapter.novelId)
  const structuralGateOptions = { supportingRoleNames: supportingCastNames }

  let optimizationTaskId: number | undefined
  let optimizationPasses = 1
  const runOptimization = (extraRequirements?: string) => runChatTask({
    type: 'review',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    retryable: true,
    messages: [{
      role: 'user',
      content: buildChapterOptimizationPrompt({
        chapter,
        novelTitle: novel?.title || '未命名小说',
        genreName,
        content: originalContent,
        issueSummary,
        extraRequirements: extraRequirements?.trim(),
        repairMode,
        supportingCastNames,
      }),
    }],
    modelConfigId: route.modelConfigId,
    chatOpts: buildChatOptionsFromRoute(route),
    onSuccess: (_output, taskId) => { optimizationTaskId = taskId },
  })

  const raw = await runOptimization(options.extraRequirements)
  let optimizedContent = normalizeOptimizedChapterContent(raw)
  if (!optimizedContent) throwUserFacingError('writing.rewriteNoResult')
  let factGuard = buildChapterOptimizationFactGuard(chapter.novelId, originalContent, optimizedContent, {
    allowEndingHookChange: repairMode === 'structural',
    structuralRepair: repairMode === 'structural',
  })
  let qualityGate = buildChapterOptimizationQualityGate(originalContent, optimizedContent, genreName, trackedEntityNames)
  let structuralGate = buildChapterStructuralRepairGate(originalContent, optimizedContent, chapter.chapterNum, structuralGateOptions)

  // A rejected candidate is still useful feedback, but bounded constrained passes
  // let the online flow repair the exact fact/quality failure before surfacing a
  // result. The UI still blocks applying every unsafe result.
  const originalNumbers = extractNarrativeNumbers(originalContent).slice(0, 80)
  while ((!factGuard.safeToApply || !qualityGate.safeToApply || !structuralGate.safeToApply) && optimizationPasses < MAX_CHAPTER_OPTIMIZATION_PASSES) {
    const gateFeedback = dedupeTextList([...factGuard.warnings, ...qualityGate.warnings, ...structuralGate.warnings])
    const targetedQualityFixes = [
      qualityGate.optimizedGuardrailHits.includes('not_but_definition_pattern')
        ? '禁止使用“不是……而是……”或“并非……实际是……”句式；需要转折时拆成两个完整的直接陈述句。'
        : '',
      qualityGate.optimizedGuardrailHits.includes('dash_abuse')
        ? '删除解释型破折号，把解释改成动作、事实或独立短句。'
        : '',
      qualityGate.optimizedGuardrailHits.includes('low_value_body_detail')
        ? '删除低价值身体部位和模板化感官描写，换成能推动事件的具体动作。'
        : '',
      qualityGate.optimizedGuardrailHits.includes('paragraph_simile_stacking')
        ? '拆开段内密集比喻：每个段落最多保留一处必要比喻，其余改成具体动作、物件变化或可验证后果。'
        : '',
      structuralGate.warnings.some((warning) => warning.includes('扩写比例过高'))
        ? '上一版扩写超过结构修订上限；删除新增背景、支线、道具和解释，只用原章已有的人物、地点、物件和动作完成冲突结果。'
        : '',
      factGuard.warnings.some((warning) => warning.includes('叙事事实'))
        ? '上一版凭空新增了物证、记录、证据可读性或交易事实；本轮必须全部删除这些新增事实，恢复原文物件状态，只用原文已有动作、对白和人物选择完成结构修复。'
        : '',
    ].filter(Boolean)
    const retryRequirements = [
      options.extraRequirements?.trim(),
      `上一版候选未通过事实或质量门；本轮必须优先保真。具体失败项：${gateFeedback.join('；') || '未通过后验检查'}`,
      targetedQualityFixes.length > 0 ? `针对性语言修复：${targetedQualityFixes.join('；')}` : '',
      originalNumbers.length > 0
        ? `原文数字/日期/数量/编号清单（必须逐字保留）：${originalNumbers.join('、')}`
        : '',
      '不要为了改写句子而增删或换算任何数字；无法确认时直接保留原句。输出前逐项核对事实和质量门失败项。',
      repairMode === 'structural'
        ? '本轮是结构性修订：必须实际改变冲突链、人物判断或场景结果，不能仅替换同义词。'
        : '',
    ].filter(Boolean).join('\n')
    try {
      optimizationPasses += 1
      const retryRaw = await runOptimization(retryRequirements)
      const retryContent = normalizeOptimizedChapterContent(retryRaw)
      if (!retryContent) continue

      const retryFactGuard = buildChapterOptimizationFactGuard(chapter.novelId, originalContent, retryContent, {
        allowEndingHookChange: repairMode === 'structural',
        structuralRepair: repairMode === 'structural',
      })
      const retryQualityGate = buildChapterOptimizationQualityGate(originalContent, retryContent, genreName, trackedEntityNames)
      const retryStructuralGate = buildChapterStructuralRepairGate(originalContent, retryContent, chapter.chapterNum, structuralGateOptions)
      const currentWarningCount = factGuard.warnings.length + qualityGate.warnings.length + structuralGate.warnings.length
      const retryWarningCount = retryFactGuard.warnings.length + retryQualityGate.warnings.length + retryStructuralGate.warnings.length
      if (
        (retryFactGuard.safeToApply && retryQualityGate.safeToApply && retryStructuralGate.safeToApply)
        // A retry may improve language or structure, but it must never replace
        // a candidate with another fact-unsafe rewrite merely because it has
        // fewer total warnings. Facts are the fail-closed boundary.
        || (retryFactGuard.safeToApply && retryWarningCount < currentWarningCount)
      ) {
        optimizedContent = retryContent
        factGuard = retryFactGuard
        qualityGate = retryQualityGate
        structuralGate = retryStructuralGate
      }
    } catch (retryError) {
      console.warn(`[chapter:optimize] 严格保真重试失败，沿用最近候选 chapter=${chapterId}`, retryError)
    }
  }

  return {
    originalContent,
    optimizedContent,
    issueSummary,
    guardrailHits: qualityGate.originalGuardrailHits,
    changed: optimizedContent.trim() !== originalContent.trim(),
    warnings: dedupeTextList([...factGuard.warnings, ...qualityGate.warnings, ...structuralGate.warnings]),
    factGuard,
    qualityGate,
    structuralGate,
    optimizationPasses,
    ...(optimizationTaskId ? { taskId: optimizationTaskId } : {}),
  }
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

  const persistAiCheckResult = (
    enhancedScore: ReturnType<typeof enhanceAiScoreResult>,
    chapterResult: ReturnType<typeof toChapterAiCheckResult>,
  ) => {
    db.update(chapters).set({
      // 即使模型 JSON 解析失败，也要持久化本轮确定性降级结果；否则页面
      // 当次显示新结果，刷新后却重新出现旧评分或空评分。
      aiScoreJson: JSON.stringify({
        ...enhancedScore,
        score: chapterResult.score,
        issues: chapterResult.issues,
      }),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
  }

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
    const chapterResult = toChapterAiCheckResult(parsedResult.success ? parsedResult.data : {}, enhancedScore)
    persistAiCheckResult(enhancedScore, chapterResult)
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    return chapterResult
  } catch {
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    const enhancedScore = enhanceAiScoreResult({}, content)
    const chapterResult = toChapterAiCheckResult({}, enhancedScore)
    persistAiCheckResult(enhancedScore, chapterResult)
    return chapterResult
  }
}

export const __testing = {
  buildChapterOptimizationFactGuard,
  collectNarrativeStateWarnings,
  collectUnsupportedNarrativeFactWarnings,
  extractNarrativeNumbers,
  applyDialogueAnalysisToReviewNotes,
  parseStoredReviewNotes,
  assertChapterResumeBaseCurrent,
  buildChapterContentHash,
  updatePipelineChapterContent,
}

export { runChapterPublishCheck }
