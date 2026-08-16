import { asc, desc, eq } from 'drizzle-orm'
import type { ChapterBatchAutoGenerateStatus } from '../../src/types'
import { getDb } from '../database/db'
import {
  chapterBatchInspections,
  chapterBatchSnapshots,
  chapterGateRuns,
  chapterWritebackRuns,
  chapters,
  genres,
  glossary,
  novels,
  revisionTasks,
  storyMemoryCheckpoints,
  storyFacts,
  storyItems,
  storyThreads,
  storyVolumes,
  tasks,
  timelineEvents,
} from '../database/schema'
import { parseTaskProgress } from './task.service'

type DashboardChapterIdentity = { id: number; chapterNum: number }

export function loadQualityDashboardCatalogSnapshot(novelId: number) {
  const db = getDb()
  const novelMeta = db.select({
    launchMode: novels.launchMode,
    targetWords: novels.targetWords,
    settingsJson: novels.settingsJson,
    worldRulesJson: novels.worldRulesJson,
    historicalProfileJson: novels.historicalProfileJson,
    projectCanonProfileJson: novels.projectCanonProfileJson,
    canonConstraintSetJson: novels.canonConstraintSetJson,
    sourceLedgerJson: novels.sourceLedgerJson,
    canonSourceLedgerJson: novels.canonSourceLedgerJson,
    canonFactCardsJson: novels.canonFactCardsJson,
    userBackground: novels.userBackground,
    expandedBackground: novels.expandedBackground,
    synopsis: novels.synopsis,
    genreName: genres.name,
  })
    .from(novels)
    .leftJoin(genres, eq(novels.genreId, genres.id))
    .where(eq(novels.id, novelId))
    .all()[0] || null
  const volumeRows = db.select({
    id: storyVolumes.id,
    volumeNumber: storyVolumes.volumeNumber,
    title: storyVolumes.title,
  }).from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
  const rows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    title: chapters.title,
    summary: chapters.summary,
    outline: chapters.outline,
    volumeId: chapters.volumeId,
    aiScoreJson: chapters.aiScoreJson,
    reviewNotesJson: chapters.reviewNotesJson,
    summaryHealthJson: chapters.summaryHealthJson,
    expressionDedupJson: chapters.expressionDedupJson,
    hookContinuityJson: chapters.hookContinuityJson,
    content: chapters.content,
    continuityStateJson: chapters.continuityStateJson,
    scenePlanJson: chapters.scenePlanJson,
    nextChapterSeed: chapters.nextChapterSeed,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  return { novelMeta, rows, volumeRows }
}

export function loadQualityDashboardDerivedDatabaseSnapshot(novelId: number) {
  const db = getDb()
  return {
    glossaryTerms: db.select({ term: glossary.term })
      .from(glossary)
      .where(eq(glossary.novelId, novelId))
      .all()
      .map((row) => row.term || '')
      .filter(Boolean),
    gateRuns: db.select().from(chapterGateRuns)
      .where(eq(chapterGateRuns.novelId, novelId))
      .orderBy(asc(chapterGateRuns.chapterNum), asc(chapterGateRuns.createdAt), asc(chapterGateRuns.id))
      .all(),
    timelineRows: db.select({
      eventType: timelineEvents.eventType,
      eventTitle: timelineEvents.eventTitle,
      eventSummary: timelineEvents.eventSummary,
      eventResult: timelineEvents.eventResult,
      chapterStartId: timelineEvents.chapterStartId,
      chapterEndId: timelineEvents.chapterEndId,
      protagonistPresent: timelineEvents.protagonistPresent,
      protagonistAction: timelineEvents.protagonistAction,
    }).from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
    storyFactRows: db.select({
      id: storyFacts.id,
      title: storyFacts.title,
      volumeId: storyFacts.volumeId,
      readerKnownChapterId: storyFacts.readerKnownChapterId,
      protagonistKnownChapterId: storyFacts.protagonistKnownChapterId,
      targetRevealChapterId: storyFacts.targetRevealChapterId,
      forbiddenBeforeVolume: storyFacts.forbiddenBeforeVolume,
      plannedRevealVolume: storyFacts.plannedRevealVolume,
    }).from(storyFacts).where(eq(storyFacts.novelId, novelId)).all(),
    typedRefRows: {
      thread: db.select({ typedRefsJson: storyThreads.typedRefsJson })
        .from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
      timeline: db.select({ typedRefsJson: timelineEvents.typedRefsJson })
        .from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
      item: db.select({ typedRefsJson: storyItems.typedRefsJson })
        .from(storyItems).where(eq(storyItems.novelId, novelId)).all(),
    },
  }
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)).map((value) => Math.trunc(value)))]
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? uniqueNumbers(parsed.map((item) => typeof item === 'number' ? item : Number(item)))
      : []
  } catch {
    return []
  }
}

/**
 * Database-only batch snapshot for the quality dashboard. Derived dashboard
 * stages consume this immutable result instead of issuing their own queries.
 */
export function loadQualityDashboardBatchSnapshot(
  novelId: number,
  chapters: readonly DashboardChapterIdentity[],
) {
  const db = getDb()
  const latestWritebackRunMap = db.select()
    .from(chapterWritebackRuns)
    .where(eq(chapterWritebackRuns.novelId, novelId))
    .orderBy(desc(chapterWritebackRuns.updatedAt), desc(chapterWritebackRuns.id))
    .all()
    .reduce<Map<number, typeof chapterWritebackRuns.$inferSelect>>((result, row) => {
      if (!result.has(row.chapterId)) result.set(row.chapterId, row)
      return result
    }, new Map())
  const latestBatchTask = db.select()
    .from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .find((task) => task.type === 'chapter_batch_generate' && task.runnerType === 'workflow') || null
  const latestBatchProgress = latestBatchTask
    ? parseTaskProgress<Partial<ChapterBatchAutoGenerateStatus>>(latestBatchTask)
    : {}
  const latestBatchSnapshot = db.select().from(chapterBatchSnapshots)
    .where(eq(chapterBatchSnapshots.novelId, novelId))
    .orderBy(desc(chapterBatchSnapshots.createdAt), desc(chapterBatchSnapshots.id))
    .all()[0] || null
  const chapterNumById = new Map(chapters.map((chapter) => [chapter.id, chapter.chapterNum] as const))
  const batchChapterIds = uniqueNumbers(
    Array.isArray(latestBatchProgress.chapterIds)
      ? latestBatchProgress.chapterIds.map((item) => Number(item))
      : parseNumberArray(latestBatchSnapshot?.chapterIdsJson),
  )
  const batchChapterNums = uniqueNumbers(batchChapterIds.length > 0
    ? batchChapterIds.map((chapterId) => chapterNumById.get(chapterId) || 0).filter(Boolean)
    : parseNumberArray(latestBatchSnapshot?.chapterNumsJson))
  const batchChapterIdSet = new Set(batchChapterIds)
  const revisionRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => batchChapterIdSet.size === 0 || (typeof row.chapterId === 'number' && batchChapterIdSet.has(row.chapterId)))
  const checkpointRows = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
  const latestBatchInspections = latestBatchSnapshot
    ? db.select().from(chapterBatchInspections)
      .where(eq(chapterBatchInspections.snapshotId, latestBatchSnapshot.id))
      .all()
    : []

  return {
    batchChapterIdSet,
    batchChapterIds,
    batchChapterNums,
    checkpointRows,
    latestBatchInspections,
    latestBatchProgress,
    latestBatchSnapshot,
    latestBatchTask,
    latestWritebackRunMap,
    revisionRows,
  }
}
