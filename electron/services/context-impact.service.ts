import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import type { ChapterContractValidationResult } from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import {
  chapters,
  characters,
  factions,
  novels,
  storyItems,
  storyMemoryCheckpoints,
  storyThreads,
  timelineEvents,
} from '../database/schema'
import { translateContextChangeReasons } from '../../src/shared/context-change-reasons'
import { type SemanticGateMode } from '../../src/shared/semantic-gate-policy'
import { throwUserFacingError } from '../utils/user-facing-error'
import { getNovelAssetImpactSummary } from './asset-impact.service'
import type { ConsistencyIssue } from './consistency.service'
import {
  buildChapterGateSummary,
  buildChapterGateTopIssueKeys,
  buildPublishCheckScoreBreakdown,
} from './chapter-publish-score'
import {
  buildChapterRewritePlan,
  buildRewriteTarget,
} from './chapter-publish-rewrite-plan'
import {
  persistChapterGateRun,
  syncChapterGateRevisionTasks,
} from './chapter-publish-persistence'
import {
  buildPublishLanguageAndDynamicsChecklist,
  buildPublishNarrativeChecklist,
  buildPublishReadinessChecklist,
  buildPublishStructureChecklist,
  prepareChapterPublishChecklist,
} from './chapter-publish-quality-gates'
import {
  buildPublishStructuralRewriteReasons,
  createPublishGateDegrader,
  deriveChapterPublishNarrativeEvidence,
  derivePublishQualityGateStatuses,
  derivePublishStoryGateStatuses,
  loadChapterPublishCoreEvidence,
  loadChapterPublishSupportingEvidence,
} from './chapter-publish-evidence'
import {
  parseStringArray,
  type ChapterContractAudit,
  type ChapterGateLevel,
  type ChapterPublishCheck,
  type ChapterPublishCheckItem,
  type ReviewStateSnapshot,
} from './chapter-publish-types'

// 以下发布检查类型与函数已拆分到 chapter-publish-* 模块，这里保留 re-export，
// 供外部调用点（chapter.service、chapter-pipeline-rewriter 等）继续从本模块导入。
export type {
  ChapterContractAudit,
  ChapterGateDimensionDelta,
  ChapterGateDriftSummary,
  ChapterGateHistoryEntry,
  ChapterPublishCheck,
  ChapterPublishCheckItem,
  ChapterPublishCheckScoreBreakdown,
  ChapterRewriteTarget,
  ContractAuditItem,
} from './chapter-publish-types'
export {
  getChapterContractBlockers,
  validateChapterContractsForGeneration,
} from './chapter-publish-contract-gate'
export { listChapterGateHistory } from './chapter-publish-persistence'

type AssetFreshnessKey = 'faction' | 'character' | 'item' | 'thread' | 'timeline'

const ASSET_FRESHNESS_GRACE_MS = 60 * 1000
const ASSET_FRESHNESS_LABELS: Record<AssetFreshnessKey, string> = {
  faction: '势力',
  character: '人物',
  item: '物品',
  thread: '故事线程',
  timeline: '时间轴',
}

function markChapterRowsStale(
  sqlite: ReturnType<typeof getSqlite>,
  input: {
    novelId: number
    reasons: string[]
    updatedAt: string
    afterChapterNum?: number
  },
): void {
  const rangeClause = typeof input.afterChapterNum === 'number' ? ' AND chapter_num > ?' : ''
  sqlite.prepare(`
    UPDATE chapters AS target
    SET stale_reason_json = (
      SELECT COALESCE(json_group_array(reason), '[]')
      FROM (
        SELECT reason, MIN(sort_order) AS first_order
        FROM (
          SELECT TRIM(CAST(value AS TEXT)) AS reason, CAST(key AS INTEGER) AS sort_order
          FROM json_each(
            CASE
              WHEN json_valid(COALESCE(target.stale_reason_json, '')) THEN target.stale_reason_json
              ELSE '[]'
            END
          )
          WHERE type = 'text'
          UNION ALL
          SELECT TRIM(CAST(value AS TEXT)) AS reason, 1000000 + CAST(key AS INTEGER) AS sort_order
          FROM json_each(?)
          WHERE type = 'text'
        )
        WHERE reason <> ''
        GROUP BY reason
        ORDER BY first_order
      )
    ), updated_at = ?
    WHERE novel_id = ?${rangeClause}
  `).run(
    JSON.stringify(input.reasons),
    input.updatedAt,
    input.novelId,
    ...(typeof input.afterChapterNum === 'number' ? [input.afterChapterNum] : []),
  )
}

function getChecklistCount(items: ChapterPublishCheckItem[], status: ChapterGateLevel): number {
  return items.filter((item) => item.status === status).length
}

function finalizeChapterPublishCheck(input: {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  checklist: ChapterPublishCheckItem[]
  reviewState: ReviewStateSnapshot
  contractAudit: ChapterContractAudit
  contractValidation: ChapterContractValidationResult | null
  aiScore: number | null
  highIssues: ConsistencyIssue[]
  mediumIssues: ConsistencyIssue[]
  staleReasons: string[]
  recallStaleCount: number
  sceneHookCount: number
  weakFunction: boolean
}): ChapterPublishCheck {
  const { chapter, novel, reviewState, contractAudit, contractValidation } = input
  const rewritePlan = buildChapterRewritePlan({ checklist: input.checklist, reviewState, contractValidation })
  const { taskIdByItemKey, generatedTaskCount } = syncChapterGateRevisionTasks(
    chapter.novelId,
    chapter.id,
    chapter.chapterNum,
    input.checklist,
    contractAudit,
    reviewState,
    contractValidation,
  )
  const checklist = input.checklist.map((item) => {
    const taskId = taskIdByItemKey.get(item.key)
    return typeof taskId === 'number' ? { ...item, taskId } : item
  })
  const rewriteCount = getChecklistCount(checklist, 'rewrite')
  const checklistBlockerCount = getChecklistCount(checklist, 'blocker')
  const blockerCount = checklistBlockerCount + contractAudit.blockerCount
  const warningCount = getChecklistCount(checklist, 'warning') + contractAudit.warningCount
  const hasSpecificRewrite = checklist.some((item) => item.status === 'rewrite' && item.key !== 'rewrite_path')
  const blockersAreRewriteDependent = contractAudit.blockerCount === 0
    && checklist.every((item) => item.status !== 'blocker' || item.key === 'contract_delivery')
  const gateLevel: ChapterGateLevel = rewriteCount > 0 && (blockerCount === 0 || (hasSpecificRewrite && blockersAreRewriteDependent))
    ? 'rewrite'
    : blockerCount > 0 ? 'blocker' : rewriteCount > 0 ? 'rewrite' : warningCount > 0 ? 'warning' : 'pass'
  const scoreBreakdown = buildPublishCheckScoreBreakdown({
    contractAudit,
    contractValidation,
    checklist,
    reviewState,
    aiScore: input.aiScore,
    highIssues: input.highIssues,
    mediumIssues: input.mediumIssues,
    staleReasons: input.staleReasons,
    recallStaleCount: input.recallStaleCount,
    sceneHookCount: input.sceneHookCount,
    weakFunction: input.weakFunction,
    blockerCount,
    warningCount,
    rewriteCount,
  })
  const ready = gateLevel === 'pass' || gateLevel === 'warning'
  const summary = buildChapterGateSummary(gateLevel, rewriteCount, blockerCount, warningCount)
  const { history, drift } = persistChapterGateRun({
    novelId: chapter.novelId,
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    gateLevel,
    ready,
    summary,
    rewriteCount,
    blockerCount,
    warningCount,
    generatedTaskCount,
    scoreBreakdown,
    topIssueKeys: buildChapterGateTopIssueKeys(checklist, contractAudit, contractValidation),
  })
  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    gateLevel,
    ready,
    summary,
    blockerCount,
    warningCount,
    rewriteCount,
    staleReasons: input.staleReasons,
    chapterContextVersion: chapter.contextVersion || 1,
    novelContextVersion: novel.contextVersion || 1,
    rewriteRecommended: gateLevel === 'rewrite',
    rewriteTarget: buildRewriteTarget(chapter.id, checklist, rewritePlan),
    rewritePlan,
    scoreBreakdown,
    history,
    drift,
    generatedTaskCount,
    checklist,
    contractAudit,
    contractValidation: contractValidation || undefined,
  }
}

export interface NovelContextStatus {
  novelId: number
  contextVersion: number
  totalChapterCount: number
  staleChapterCount: number
  staleChapterIds: number[]
  staleCheckpointCount: number
  staleAssetCount: number
  staleAssetKeys: AssetFreshnessKey[]
  staleAssetLabels: string[]
  pendingImpactCount: number
  pendingManualConfirmationCount: number
  latestImpactEventAt?: string | null
}

function parseIsoTime(raw?: string | null): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function collectLatestUpdatedAt(rows: Array<{ updatedAt?: string | null }>): number | null {
  return rows.reduce<number | null>((latest, row) => {
    const next = parseIsoTime(row.updatedAt)
    if (next === null) return latest
    return latest === null ? next : Math.max(latest, next)
  }, null)
}

export function getNovelContextStatus(novelId: number): NovelContextStatus {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const staleChapterIds = chapterRows
    .filter((chapter) => parseStringArray(chapter.staleReasonJson).length > 0)
    .map((chapter) => chapter.id)
  const staleCheckpointCount = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
    .filter((checkpoint) => checkpoint.stale === 1 || (checkpoint.version || 1) < (novel.contextVersion || 1))
    .length
  const novelUpdatedAt = parseIsoTime(novel.updatedAt)
  const assetRows = {
    faction: db.select().from(factions).where(eq(factions.novelId, novelId)).all(),
    character: db.select().from(characters).where(eq(characters.novelId, novelId)).all(),
    item: db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all(),
    thread: db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
    timeline: db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
  }
  const staleAssetKeys = (Object.keys(assetRows) as AssetFreshnessKey[]).filter((key) => {
    if (assetRows[key].length === 0 || novelUpdatedAt === null) return false
    const latestUpdatedAt = collectLatestUpdatedAt(assetRows[key])
    if (latestUpdatedAt === null) return false
    return (novelUpdatedAt - latestUpdatedAt) > ASSET_FRESHNESS_GRACE_MS
  })
  const impactSummary = getNovelAssetImpactSummary(novelId)

  return {
    novelId,
    contextVersion: novel.contextVersion || 1,
    totalChapterCount: chapterRows.length,
    staleChapterCount: staleChapterIds.length,
    staleChapterIds,
    staleCheckpointCount,
    staleAssetCount: staleAssetKeys.length,
    staleAssetKeys,
    staleAssetLabels: staleAssetKeys.map((key) => ASSET_FRESHNESS_LABELS[key]),
    pendingImpactCount: impactSummary.pendingImpactCount,
    pendingManualConfirmationCount: impactSummary.pendingManualConfirmationCount,
    latestImpactEventAt: impactSummary.latestImpactEventAt,
  }
}

export function markNovelContextChanged(novelId: number, reasons: string | string[]): number {
  const db = getDb()
  const normalizedReasons = translateContextChangeReasons(Array.isArray(reasons) ? reasons : [reasons])
  if (normalizedReasons.length === 0) {
    const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
    if (!novel) throwUserFacingError('novel.notFound')
    return novel.contextVersion || 1
  }

  const now = new Date().toISOString()
  const sqlite = getSqlite()
  const transaction = sqlite.transaction(() => {
    const updateResult = db.update(novels).set({
      contextVersion: sql`COALESCE(${novels.contextVersion}, 1) + 1`,
      updatedAt: now,
    }).where(eq(novels.id, novelId)).run()
    if (!updateResult.changes) throwUserFacingError('novel.notFound')

    markChapterRowsStale(sqlite, { novelId, reasons: normalizedReasons, updatedAt: now })

    markStoryMemoryCheckpointsDirty(novelId, now)
    const updatedNovel = db.select({ contextVersion: novels.contextVersion })
      .from(novels)
      .where(eq(novels.id, novelId))
      .all()[0]
    if (!updatedNovel) throwUserFacingError('novel.notFound')
    return updatedNovel.contextVersion || 1
  })

  return sqlite.inTransaction || typeof transaction.immediate !== 'function'
    ? transaction()
    : transaction.immediate()
}

export function markStoryMemoryCheckpointsDirty(novelId: number, updatedAt = new Date().toISOString()): void {
  const db = getDb()
  db.update(storyMemoryCheckpoints).set({
    stale: 1,
    updatedAt,
  }).where(and(
    eq(storyMemoryCheckpoints.novelId, novelId),
    or(
      isNull(storyMemoryCheckpoints.locked),
      ne(storyMemoryCheckpoints.locked, 1),
    ),
  )).run()
}

export function markSubsequentChaptersStale(
  novelId: number,
  chapterNum: number,
  reasons: string | string[],
): void {
  const normalizedReasons = translateContextChangeReasons(Array.isArray(reasons) ? reasons : [reasons])
  if (normalizedReasons.length === 0) return

  const now = new Date().toISOString()
  const sqlite = getSqlite()
  const transaction = sqlite.transaction(() => {
    markChapterRowsStale(sqlite, {
      novelId,
      reasons: normalizedReasons,
      updatedAt: now,
      afterChapterNum: chapterNum,
    })
  })
  if (sqlite.inTransaction || typeof transaction.immediate !== 'function') transaction()
  else transaction.immediate()
}

export function markChapterContextCurrent(chapterId: number): number {
  const db = getDb()
  const sqlite = getSqlite()
  const transaction = sqlite.transaction(() => {
    const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
    if (!chapter) {
      throwUserFacingError('chapter.notFound')
    }

    const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
    if (!novel) {
      throwUserFacingError('novel.notFound')
    }

    const contextVersion = novel.contextVersion || 1
    db.update(chapters).set({
      contextVersion,
      staleReasonJson: JSON.stringify([]),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    return contextVersion
  })
  return sqlite.inTransaction || typeof transaction.immediate !== 'function'
    ? transaction()
    : transaction.immediate()
}

export function runChapterPublishCheck(
  chapterId: number,
  options: { phase?: 'pipeline' | 'final'; semanticGateMode?: SemanticGateMode } = {},
): ChapterPublishCheck {
  const phase = options.phase || 'final'
  const evidence = loadChapterPublishSupportingEvidence(
    loadChapterPublishCoreEvidence(chapterId, options.semanticGateMode),
  )
  const { chapter, novel, staleReasons, highIssues, mediumIssues, aiScore, reviewState } = evidence
  const { semanticGateMode, semanticGateStatus, semanticGateDetail } = evidence
  const { contractAudit } = evidence
  const { recallDiagnostics, recallFallbackStreak, recallSnapshot, recallFallbackIsHardFailure } = evidence
  const { publishContractValidation, openingHookIssues, titleAlignmentIssues } = evidence
  const { themeVoice, arcWarnings, currentVolume, storyAlerts } = evidence
  const { degradedGateKeys, degrade } = createPublishGateDegrader(semanticGateMode)

  const narrative = deriveChapterPublishNarrativeEvidence(evidence)
  const qualityStatuses = derivePublishQualityGateStatuses({ evidence, narrative, degrade })
  const storyStatuses = derivePublishStoryGateStatuses({ evidence, narrative })
  const structuralRewriteReasons = buildPublishStructuralRewriteReasons({
    evidence,
    narrative,
    qualityStatuses,
    storyStatuses,
    degradedGateKeys,
  })
  const { chapterContract, weakFunction, uniqueScenePovs, missingScenePovs } = narrative
  const { fixedNovelPov, conflictingPovScene, narrativeControlReport, sceneHookCount } = narrative
  const { missingRequiredThreads, untouchedRequiredThreads, overdueThreads, volumeSignals } = narrative
  const { contractDeliveryStatus, dialogueVoiceStatus, povPurityStatus, povBoundaryStatus } = qualityStatuses
  const { sensoryCoverageStatus, narrativeRatioStatus, transitionDensityStatus } = qualityStatuses
  const { emotionFocusStatus, expositionStatus } = qualityStatuses
  const { hookStrengthStatus, threadProgressStatus, volumeAlignmentStatus, lineProgressStatus } = storyStatuses
  const rewriteTargetSource = conflictingPovScene || missingScenePovs[0] || null

  const rawChecklist: ChapterPublishCheckItem[] = [
    ...buildPublishReadinessChecklist({
      chapter,
      novel,
      staleReasons,
      semanticGateStatus,
      semanticGateDetail,
      highIssues,
      aiScore,
      reviewState,
      openingHookIssues,
      titleAlignmentIssues,
    }),
    ...buildPublishLanguageAndDynamicsChecklist({ reviewState, storyAlerts }),
    ...buildPublishStructureChecklist({
      chapter,
      recallFallbackIsHardFailure,
      recallFallbackStreak,
      recallDiagnostics,
      recallSnapshot,
      mediumIssues,
      contractDeliveryStatus,
      publishContractValidation,
      contractAudit,
      dialogueVoiceStatus,
      reviewState,
    }),
    ...buildPublishNarrativeChecklist({
      themeVoice,
      uniqueScenePovs,
      missingScenePovs,
      fixedNovelPov,
      rewriteTargetSource,
      narrativeControlReport,
      povPurityStatus,
      povBoundaryStatus,
      sensoryCoverageStatus,
      narrativeRatioStatus,
      transitionDensityStatus,
      emotionFocusStatus,
      expositionStatus,
      hookStrengthStatus,
      chapterContract,
      sceneHookCount,
      reviewState,
      threadProgressStatus,
      missingRequiredThreads,
      untouchedRequiredThreads,
      overdueThreads,
      volumeAlignmentStatus,
      currentVolume,
      volumeSignals,
      lineProgressStatus,
      arcWarnings,
      structuralRewriteReasons,
    }),
  ]

  const checklist = prepareChapterPublishChecklist({
    checklist: rawChecklist,
    phase,
    reviewState,
    degradedGateKeys,
  })
  return finalizeChapterPublishCheck({
    chapter,
    novel,
    checklist,
    reviewState,
    contractAudit,
    contractValidation: publishContractValidation,
    aiScore,
    highIssues,
    mediumIssues,
    staleReasons,
    recallStaleCount: recallDiagnostics.staleRecallCount || 0,
    sceneHookCount,
    weakFunction,
  })
}
