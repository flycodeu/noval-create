import { asc, desc, eq } from 'drizzle-orm'
import type {
  RecallDiagnostics,
  RecallFallbackReason,
  RecallSnapshot,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  chapters,
  characters,
  novels,
  semanticGateReviews,
  storyThreads,
  storyVolumes,
  volumeDesigns,
} from '../database/schema'
import { translateContextChangeReasons } from '../../src/shared/context-change-reasons'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import {
  resolveSemanticGatePolicy,
  type SemanticGateMode,
} from '../../src/shared/semantic-gate-policy'
import { throwUserFacingError } from '../utils/user-facing-error'
import { listChapterRecallRuntimeMap } from './chapter-recall-runtime.service'
import { buildHeuristicRecallDiagnostics } from './quality-dashboard-recall-diagnostics'
import { getChapterStoryPacingAlerts } from './story-dynamics-read-model'
import { getStoryArcProgressSnapshot, getStoryArcWarningsForChapter } from './story-arc-progress.service'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'
import { analyzeNarrativeControls } from './narrative-control.service'
import { analyzeChapterDialogueAgainstNovel } from './dialogue-fingerprint.service'
import {
  buildChapterContractAudit,
  buildHardContractValidationResult,
  getContractValidationIssuesByType,
  getVerifiedSemanticPassDimensions,
  loadChapterContractAuditContext,
} from './chapter-publish-contract-gate'
import { collectChapterRelatedIssues } from './chapter-publish-quality-gates'
import {
  dedupeTextList,
  normalizeText,
  parseReviewState,
  parseStringArray,
  type ChapterGateLevel,
  type ReviewStateSnapshot,
  type ScenePlanSnapshot,
} from './chapter-publish-types'

function parseAiScore(raw?: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const preferred = typeof parsed.overall_score === 'number'
      ? parsed.overall_score
      : typeof parsed.score === 'number'
        ? parsed.score
        : null
    return typeof preferred === 'number' && Number.isFinite(preferred) ? preferred : null
  } catch {
    return null
  }
}

function parseScenePlanSnapshots(raw?: string | null): ScenePlanSnapshot[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        sceneTitle: normalizeText((item.scene_title ?? item.sceneTitle) as string | undefined),
        exitHook: normalizeText((item.exit_hook ?? item.exitHook) as string | undefined),
      }))
      .filter((item) => item.sceneTitle || item.exitHook)
  } catch {
    return []
  }
}

function buildLatestRecallRuntimeMap(novelId: number): Map<number, {
  recallSnapshot?: RecallSnapshot
  recallDiagnostics?: RecallDiagnostics
}> {
  return Array.from(listChapterRecallRuntimeMap(novelId).entries()).reduce<Map<number, {
    recallSnapshot?: RecallSnapshot
    recallDiagnostics?: RecallDiagnostics
  }>>((result, [chapterId, runtime]) => {
    result.set(chapterId, {
      recallSnapshot: runtime.recallSnapshot,
      recallDiagnostics: runtime.recallDiagnostics,
    })
    return result
  }, new Map())
}

function getRecallFallbackStreak(
  novelId: number,
  currentChapterNum: number,
  runtimeByChapterId: Map<number, { recallSnapshot?: RecallSnapshot }>,
): number {
  const db = getDb()
  const orderedChapters = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(desc(chapters.chapterNum))
    .all()
    .filter((row) => row.chapterNum <= currentChapterNum)

  let streak = 0
  for (const row of orderedChapters) {
    if (!runtimeByChapterId.get(row.id)?.recallSnapshot?.degraded) break
    streak += 1
  }
  return streak
}

function isHardRecallFallbackReason(reason?: RecallFallbackReason): boolean {
  // Keyword/no-hit fallback is an observable warning, not proof that the
  // chapter is inconsistent: hard constraints and structured state remain the
  // source of truth. Block only repeated infrastructure/budget/staleness
  // failures that can actively prevent continuity evidence from being used.
  return reason === 'embedding_service_failed'
    || reason === 'query_embedding_failed'
    || reason === 'embedding_profile_mismatch'
    || reason === 'budget_trimmed'
    || reason === 'only_stale_hits'
}

function refreshPublishReviewDialogueState(
  chapter: typeof chapters.$inferSelect,
  reviewState: ReviewStateSnapshot,
): ReviewStateSnapshot {
  if (!chapter.content?.trim()) return reviewState
  const currentDialogueAnalysis = analyzeChapterDialogueAgainstNovel(
    chapter.novelId,
    chapter.chapterNum,
    chapter.content,
  )
  return {
    ...reviewState,
    dialogueHomogenizationRisks: currentDialogueAnalysis.risks || [],
    dialogueDriftAlerts: (currentDialogueAnalysis.drifts || [])
      .map((item) => normalizeText(item.reason) || normalizeText(item.characterName))
      .filter(Boolean),
    crossCharacterSimilarity: (currentDialogueAnalysis.similarities || [])
      .map((item) => normalizeText(item.reason))
      .filter(Boolean),
    dialogueFillerRisks: currentDialogueAnalysis.fillerRisks || [],
    dialogueInfoDensityRisks: currentDialogueAnalysis.infoDensityRisks || [],
    dialogueVoiceLockSummary: currentDialogueAnalysis.voiceLockSummary || '',
  }
}

function resolvePublishSemanticGateEvidence(input: {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  reviewState: ReviewStateSnapshot
  requestedMode?: SemanticGateMode
}): {
  semanticGateMode: SemanticGateMode
  semanticGateStatus: ChapterGateLevel | null
  semanticGateDetail: string
  latestSemanticGateReview: typeof semanticGateReviews.$inferSelect | null
} {
  const semanticGatePolicy = resolveSemanticGatePolicy(input.novel.settingsJson)
  let semanticGateMode = input.requestedMode || semanticGatePolicy.mode
  const latestSemanticGateReview = semanticGateMode === 'enforce'
    ? getDb().select().from(semanticGateReviews)
      .where(eq(semanticGateReviews.chapterId, input.chapter.id))
      .orderBy(desc(semanticGateReviews.id))
      .all()[0] || null
    : null
  if (latestSemanticGateReview?.failed === 1 && semanticGatePolicy.fallbackMode === 'heuristic') {
    semanticGateMode = 'off'
  }
  const semanticGateStatus: ChapterGateLevel | null = semanticGateMode === 'enforce'
    ? latestSemanticGateReview?.failed === 1
      ? 'warning'
      : latestSemanticGateReview?.mode !== 'enforce' || input.reviewState.semanticVerdicts.length === 0
        ? 'blocker'
        : input.reviewState.semanticVerdicts.some((item) => item.status === 'blocker')
          ? 'blocker'
          : input.reviewState.semanticVerdicts.some((item) => item.status === 'warning') ? 'warning' : 'pass'
    : null
  const semanticGateDetail = semanticGateStatus === 'pass'
    ? '当前正文已有 enforce 语义评审结果。'
    : latestSemanticGateReview?.failed === 1
      ? '语义评审调用失败，当前按 warn-pass 策略记录预警。'
      : latestSemanticGateReview?.mode !== 'enforce' || input.reviewState.semanticVerdicts.length === 0
        ? '当前正文尚未完成 enforce 语义评审，不能直接定稿。'
        : `语义评审仍有 ${input.reviewState.semanticVerdicts.filter((item) => item.status === 'blocker').length} 项阻断。`
  return { semanticGateMode, semanticGateStatus, semanticGateDetail, latestSemanticGateReview }
}

export function loadChapterPublishCoreEvidence(
  chapterId: number,
  requestedSemanticGateMode?: SemanticGateMode,
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const staleReasons = translateContextChangeReasons(parseStringArray(chapter.staleReasonJson))
  const consistencyIssues = collectChapterRelatedIssues(chapter.novelId, chapter.id, chapter.chapterNum)
  const highIssues = consistencyIssues.filter((issue) => issue.severity === 'high')
  const mediumIssues = consistencyIssues.filter((issue) => issue.severity === 'medium')
  const aiScore = parseAiScore(chapter.aiScoreJson)
  const reviewState = refreshPublishReviewDialogueState(chapter, parseReviewState(chapter.reviewNotesJson))
  const semanticEvidence = resolvePublishSemanticGateEvidence({
    chapter,
    novel,
    reviewState,
    requestedMode: requestedSemanticGateMode,
  })
  return {
    chapter,
    novel,
    staleReasons,
    highIssues,
    mediumIssues,
    aiScore,
    reviewState,
    ...semanticEvidence,
  }
}

export function loadChapterPublishSupportingEvidence(
  core: ReturnType<typeof loadChapterPublishCoreEvidence>,
) {
  const { chapter, reviewState, semanticGateMode, latestSemanticGateReview } = core
  const db = getDb()
  const contractContext = loadChapterContractAuditContext(chapter.id)
  const narrativeControlCharacterNames = db.select({ name: characters.fullName })
    .from(characters)
    .where(eq(characters.novelId, chapter.novelId))
    .all()
    .map((row) => row.name || '')
    .filter(Boolean)
  const recallRuntimeByChapterId = buildLatestRecallRuntimeMap(chapter.novelId)
  const recallRuntime = recallRuntimeByChapterId.get(chapter.id)
  const recallDiagnostics = recallRuntime?.recallDiagnostics || buildHeuristicRecallDiagnostics(chapter.novelId, {
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    summary: chapter.summary,
    outline: chapter.outline,
  })
  const recallFallbackStreak = getRecallFallbackStreak(chapter.novelId, chapter.chapterNum, recallRuntimeByChapterId)
  const recallSnapshot = recallRuntime?.recallSnapshot
  const recallFallbackIsHardFailure = recallFallbackStreak >= 3
    && isHardRecallFallbackReason(recallSnapshot?.fallbackReason)
  const contractAudit = buildChapterContractAudit(chapter.id)
  const contractValidation = chapter.content?.trim()
    ? validateChapterContractDelivery({
      chapterId: chapter.id,
      content: chapter.content,
      reviewNotes: chapter.reviewNotesJson,
    }, { advisoryOnly: semanticGateMode === 'enforce' })
    : null
  const verifiedSemanticPassDimensions = getVerifiedSemanticPassDimensions(
    semanticGateMode === 'enforce' ? latestSemanticGateReview : null,
    chapter.content || '',
  )
  const publishContractValidation = buildHardContractValidationResult(contractValidation, {
    verifiedSemanticPassDimensions,
  })
  const openingHookIssues = dedupeTextList([
    ...reviewState.openingHookRisks,
    ...getContractValidationIssuesByType(contractValidation, 'golden_three_opening'),
  ])
  const titleAlignmentIssues = dedupeTextList([
    ...reviewState.titleAlignmentRisks,
    ...getContractValidationIssuesByType(contractValidation, 'chapter_title_alignment'),
  ])
  const contractAuditJson = JSON.stringify(contractAudit)
  if (chapter.contractAuditJson !== contractAuditJson) {
    db.update(chapters).set({ contractAuditJson }).where(eq(chapters.id, chapter.id)).run()
  }
  const storyArcSnapshot = typeof chapter.arcId === 'number'
    ? getStoryArcProgressSnapshot(chapter.novelId)
    : null
  const arcWarnings = storyArcSnapshot && typeof chapter.arcId === 'number'
    ? getStoryArcWarningsForChapter(storyArcSnapshot, chapter.arcId, chapter.chapterNum)
    : []
  const threadRows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, chapter.novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  const currentVolume = typeof chapter.volumeId === 'number'
    ? db.select().from(storyVolumes).where(eq(storyVolumes.id, chapter.volumeId)).all()[0] || null
    : null
  const currentVolumeDesign = typeof chapter.volumeId === 'number'
    ? db.select().from(volumeDesigns).where(eq(volumeDesigns.volumeId, chapter.volumeId)).all()[0] || null
    : null
  const storyAlerts = getChapterStoryPacingAlerts(chapter.novelId, chapter.chapterNum, 3)
  return {
    ...core,
    contractContext,
    narrativeControlCharacterNames,
    recallDiagnostics,
    recallFallbackStreak,
    recallSnapshot,
    recallFallbackIsHardFailure,
    contractAudit,
    publishContractValidation,
    openingHookIssues,
    titleAlignmentIssues,
    themeVoice: parseThemeVoiceDocument(core.novel.themeVoiceJson),
    arcWarnings,
    scenePlanSnapshots: parseScenePlanSnapshots(chapter.scenePlanJson),
    threadRows,
    currentVolume,
    currentVolumeDesign,
    storyAlerts,
  }
}

export function deriveChapterPublishNarrativeEvidence(
  evidence: ReturnType<typeof loadChapterPublishSupportingEvidence>,
) {
  const { chapter, reviewState, contractContext, themeVoice } = evidence
  const chapterContract = contractContext.chapterContract
  const contractBindingCount = chapterContract.servedThreadIds.length
    + chapterContract.requiredArcProgress.length
    + chapterContract.requiredCharacterArcIds.length
    + chapterContract.requiredRelationshipArcIds.length
    + chapterContract.requiredResistanceTrackIds.length
    + chapterContract.requiredEndgameCommitmentIds.length
    + chapterContract.requiredForeshadowIds.length
  const weakFunction = ['setup', 'exposition', 'breather'].includes(reviewState.chapterFunctionPrimary)
    || reviewState.chapterFunctionTags.some((tag) => tag === 'setup' || tag === 'exposition' || tag === 'breather')
  const scenePovRows = contractContext.sceneSnapshots.filter((scene) => scene.pov)
  const uniqueScenePovs = [...new Set(scenePovRows.map((scene) => scene.pov))]
  const missingScenePovs = contractContext.sceneSnapshots.filter((scene) => !scene.pov)
  const fixedNovelPov = Boolean(themeVoice.pov && themeVoice.pov !== 'multi_pov')
  const conflictingPovScene = fixedNovelPov && uniqueScenePovs.length > 1
    ? contractContext.sceneSnapshots.find((scene) => scene.pov && scene.pov !== uniqueScenePovs[0]) || null
    : null
  const narrativeControlReport = analyzeNarrativeControls({
    themeVoice,
    sceneSnapshots: contractContext.sceneSnapshots,
    characterNames: evidence.narrativeControlCharacterNames,
    content: chapter.content,
    chapterFunction: reviewState.chapterFunctionPrimary || reviewState.paceMarker,
    chapterGoal: chapterContract.chapterGoal || chapter.outline || '',
    emotionTone: chapter.emotionTone || '',
    emotionFocus: chapterContract.emotionFocus,
    expositionMode: chapterContract.expositionMode,
  })
  const sceneHookCount = evidence.scenePlanSnapshots.filter((item) => item.exitHook).length
  const requiredThreads = chapterContract.servedThreadIds
    .map((threadId) => evidence.threadRows.find((row) => row.id === threadId) || null)
  const missingRequiredThreads = chapterContract.servedThreadIds
    .filter((threadId) => !requiredThreads.some((row) => row?.id === threadId))
  const untouchedRequiredThreads = requiredThreads
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => row.lastReferencedChapter !== chapter.chapterNum
      && row.plantedChapter !== chapter.chapterNum
      && row.resolvedChapter !== chapter.chapterNum)
  const overdueThreads = evidence.threadRows.filter((row) => normalizeText(row.status) !== 'resolved'
    && normalizeText(row.status) !== 'archived'
    && typeof row.targetPayoffChapter === 'number'
    && row.targetPayoffChapter <= chapter.chapterNum
    && row.resolvedChapter !== chapter.chapterNum
    && row.lastReferencedChapter !== chapter.chapterNum
    && row.plantedChapter !== chapter.chapterNum)
  const volumeSignals = evidence.currentVolumeDesign
    ? [
        normalizeText(evidence.currentVolumeDesign.volumeTheme),
        normalizeText(evidence.currentVolumeDesign.volumePromise),
        normalizeText(evidence.currentVolumeDesign.mainConflict),
        normalizeText(evidence.currentVolumeDesign.climaxPlan),
        normalizeText(evidence.currentVolumeDesign.endStateShift),
        normalizeText(evidence.currentVolumeDesign.readerExpectation),
        ...parseStringArray(evidence.currentVolumeDesign.mustAddCluesJson),
        ...parseStringArray(evidence.currentVolumeDesign.mustResolveCluesJson),
      ].filter(Boolean)
    : []
  const strictVolumeDesign = normalizeText(evidence.currentVolumeDesign?.auditStatus) === 'locked'
    || normalizeText(evidence.currentVolumeDesign?.auditStatus) === 'ready'
  return {
    chapterContract,
    contractBindingCount,
    weakFunction,
    uniqueScenePovs,
    missingScenePovs,
    fixedNovelPov,
    conflictingPovScene,
    narrativeControlReport,
    sceneHookCount,
    missingRequiredThreads,
    untouchedRequiredThreads,
    overdueThreads,
    volumeSignals,
    strictVolumeDesign,
  }
}

export type PublishGateDegrader = (gateKey: string, status: ChapterGateLevel) => ChapterGateLevel

export function createPublishGateDegrader(semanticGateMode: SemanticGateMode) {
  const degradedGateKeys = new Set<string>()
  const degrade: PublishGateDegrader = (gateKey, status) => {
    if (semanticGateMode !== 'enforce') return status
    if (status !== 'blocker' && status !== 'rewrite') return status
    degradedGateKeys.add(gateKey)
    return 'warning'
  }
  return { degradedGateKeys, degrade }
}

export function derivePublishQualityGateStatuses(input: {
  evidence: ReturnType<typeof loadChapterPublishSupportingEvidence>
  narrative: ReturnType<typeof deriveChapterPublishNarrativeEvidence>
  degrade: PublishGateDegrader
}) {
  const { evidence, narrative, degrade } = input
  const { reviewState, publishContractValidation, contractAudit } = evidence
  const { fixedNovelPov, uniqueScenePovs, missingScenePovs, narrativeControlReport } = narrative
  const contractDeliveryStatus = degrade('contract_delivery', publishContractValidation
    ? publishContractValidation.status
    : contractAudit.blockerCount > 0 ? 'blocker' : contractAudit.warningCount > 0 ? 'warning' : 'pass')
  const dialogueSignalCount = reviewState.dialogueHomogenizationRisks.length
    + reviewState.dialogueDriftAlerts.length
    + reviewState.crossCharacterSimilarity.length
    + reviewState.dialogueFillerRisks.length
    + reviewState.dialogueInfoDensityRisks.length
    + (reviewState.dialogueVoiceLockSummary ? 1 : 0)
  const dialogueVoiceStatus = degrade('dialogue_voice', dialogueSignalCount >= 3
    || (reviewState.dialogueDriftAlerts.length > 0
      && reviewState.crossCharacterSimilarity.length > 0
      && reviewState.severity === 'high')
    ? 'blocker'
    : dialogueSignalCount > 0 ? 'warning' : 'pass')
  const povPurityStatus: ChapterGateLevel = fixedNovelPov && uniqueScenePovs.length > 1
    ? 'rewrite'
    : missingScenePovs.length > 0
      ? fixedNovelPov ? 'blocker' : 'warning'
      : uniqueScenePovs.length > 1 ? 'warning' : 'pass'
  const povBoundaryStatus = narrativeControlReport.pov.directMindReadingHits.length > 0
    ? narrativeControlReport.pov.status
    : degrade('pov_boundary', narrativeControlReport.pov.status)
  return {
    contractDeliveryStatus,
    dialogueVoiceStatus,
    povPurityStatus,
    povBoundaryStatus,
    sensoryCoverageStatus: degrade('sensory_coverage', narrativeControlReport.sensory.status),
    narrativeRatioStatus: degrade('narrative_ratio', narrativeControlReport.narrativeRatio.status),
    transitionDensityStatus: degrade('transition_density', narrativeControlReport.transitionDensity.status),
    emotionFocusStatus: degrade('emotion_focus', narrativeControlReport.emotionFocus.status),
    expositionStatus: degrade('world_exposition', narrativeControlReport.exposition.status),
  }
}

export function derivePublishStoryGateStatuses(input: {
  evidence: ReturnType<typeof loadChapterPublishSupportingEvidence>
  narrative: ReturnType<typeof deriveChapterPublishNarrativeEvidence>
}) {
  const { evidence, narrative } = input
  const { reviewState, currentVolume, arcWarnings } = evidence
  const { chapterContract, sceneHookCount, weakFunction, contractBindingCount } = narrative
  const { missingRequiredThreads, untouchedRequiredThreads, overdueThreads } = narrative
  const hookStrengthStatus: ChapterGateLevel = !chapterContract.hookType
    && sceneHookCount === 0
    && reviewState.readerHookRisks.length > 0
    && weakFunction
    ? 'blocker'
    : !chapterContract.hookType || sceneHookCount === 0 || reviewState.readerHookRisks.length > 0
      ? 'warning'
      : 'pass'
  const threadProgressStatus: ChapterGateLevel = missingRequiredThreads.length > 0 || untouchedRequiredThreads.length > 0
    ? 'blocker'
    : overdueThreads.length > 0 ? 'warning' : 'pass'
  const volumeAlignmentStatus: ChapterGateLevel = !currentVolume || narrative.volumeSignals.length === 0
    ? 'pass'
    : contractBindingCount === 0 && (weakFunction || reviewState.arcProgressRisks.length > 0)
      ? narrative.strictVolumeDesign ? 'blocker' : 'warning'
      : 'pass'
  const lineProgressStatus: ChapterGateLevel = contractBindingCount > 0
    && (arcWarnings.length > 0 || reviewState.arcProgressRisks.length > 0)
    ? 'blocker'
    : arcWarnings.length > 0
      || reviewState.arcProgressRisks.length > 0
      || (contractBindingCount === 0 && weakFunction && reviewState.chapterFunctionPrimary)
      ? 'warning'
      : 'pass'
  return { hookStrengthStatus, threadProgressStatus, volumeAlignmentStatus, lineProgressStatus }
}

export function buildPublishStructuralRewriteReasons(input: {
  evidence: ReturnType<typeof loadChapterPublishSupportingEvidence>
  narrative: ReturnType<typeof deriveChapterPublishNarrativeEvidence>
  qualityStatuses: ReturnType<typeof derivePublishQualityGateStatuses>
  storyStatuses: ReturnType<typeof derivePublishStoryGateStatuses>
  degradedGateKeys: Set<string>
}): string[] {
  const { evidence, narrative, qualityStatuses, storyStatuses, degradedGateKeys } = input
  const { reviewState, contractAudit, highIssues, publishContractValidation } = evidence
  const { narrativeControlReport } = narrative
  const { lineProgressStatus, threadProgressStatus, volumeAlignmentStatus } = storyStatuses
  return [
    qualityStatuses.povPurityStatus === 'rewrite' ? '当前章节存在多场景 POV 混杂，已经超出固定视角作品可接受范围。' : '',
    qualityStatuses.povBoundaryStatus === 'rewrite' ? narrativeControlReport.pov.summary : '',
    qualityStatuses.sensoryCoverageStatus === 'rewrite' ? narrativeControlReport.sensory.summary : '',
    qualityStatuses.narrativeRatioStatus === 'rewrite' ? narrativeControlReport.narrativeRatio.summary : '',
    qualityStatuses.transitionDensityStatus === 'rewrite' ? narrativeControlReport.transitionDensity.summary : '',
    qualityStatuses.emotionFocusStatus === 'rewrite' ? narrativeControlReport.emotionFocus.summary : '',
    qualityStatuses.expositionStatus === 'rewrite' ? narrativeControlReport.exposition.summary : '',
    reviewState.rewriteRequired
      && (contractAudit.blockerCount > 0
        || highIssues.length > 0
        || lineProgressStatus === 'blocker'
        || threadProgressStatus === 'blocker'
        || volumeAlignmentStatus === 'blocker')
      ? '审校已经建议重写，且命中了合同/推进/结构类硬问题，单纯润色不足以解决。'
      : '',
    reviewState.rewriteDeltaStatus === 'fail'
      ? `重写差异验证失败：${reviewState.rewriteDeltaFindings.slice(0, 2).join('；') || '当前稿件没有证明已修复剧情、冲突或代价链。'}`
      : reviewState.rewriteDeltaStatus === 'weak' && reviewState.rewriteRequired
        ? `重写差异验证偏弱：${reviewState.rewriteDeltaFindings.slice(0, 2).join('；') || '当前稿件仍缺少足够的结构变化证据。'}`
        : '',
    publishContractValidation?.status === 'blocker' && !degradedGateKeys.has('contract_delivery')
      ? '正文合同验证仍有关键缺口，当前稿件没有兑现章节目标、场景结果或必要支线/伏笔。'
      : '',
  ].filter(Boolean)
}
