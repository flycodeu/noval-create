import { asc, eq } from 'drizzle-orm'
import type { ChapterStoryDynamics, StoryDynamicsAlert } from '../../src/types'
import { getDb } from '../database/db'
import { chapters, timelineEvents } from '../database/schema'
import {
  buildStoryPacingAlerts,
  buildTimelineStoryHints,
  computeCostPersistence,
  enhanceStoryDynamics,
  hasTimelineHint,
  parseStoryDynamics,
  type StoryDynamicsChapterRecord,
  type TimelineStoryEventRow,
} from './quality-dashboard-story-dynamics'

export interface StoryDynamicsSourceChapter {
  id: number
  chapterNum: number
  title: string | null
  volumeId: number | null
  reviewNotesJson: string | null
}

export interface StoryDynamicsReadModel {
  chapters: StoryDynamicsChapterRecord[]
  chapterById: ReadonlyMap<number, StoryDynamicsChapterRecord>
  dynamicsByChapterId: ReadonlyMap<number, ChapterStoryDynamics>
}

export function buildStoryDynamicsReadModel(
  chapterRows: readonly StoryDynamicsSourceChapter[],
  timelineRows: readonly TimelineStoryEventRow[] = [],
): StoryDynamicsReadModel {
  const chapterNumById = new Map(chapterRows.map((row) => [row.id, row.chapterNum] as const))
  const timelineHints = buildTimelineStoryHints([...timelineRows], chapterNumById)
  const dynamicsByChapterId = new Map<number, ChapterStoryDynamics>()
  const trackedChapters = chapterRows.flatMap((row) => {
    const parsed = parseStoryDynamics(row.reviewNotesJson)
    const timelineHint = timelineHints.get(row.chapterNum)
    const dynamics = enhanceStoryDynamics(parsed.dynamics, timelineHint)
    dynamicsByChapterId.set(row.id, dynamics)
    if (!parsed.explicit && !hasTimelineHint(timelineHint)) return []
    return [{
      chapterId: row.id,
      chapterNum: row.chapterNum,
      title: row.title || `第 ${row.chapterNum} 章`,
      volumeId: typeof row.volumeId === 'number' ? row.volumeId : undefined,
      dynamics,
    } satisfies StoryDynamicsChapterRecord]
  }).sort((left, right) => left.chapterNum - right.chapterNum || left.chapterId - right.chapterId)

  return {
    chapters: trackedChapters,
    chapterById: new Map(trackedChapters.map((chapter) => [chapter.chapterId, chapter] as const)),
    dynamicsByChapterId,
  }
}

export function selectStoryPacingAlertsForChapter(
  readModel: Readonly<StoryDynamicsReadModel>,
  chapterNum: number,
  limit = 3,
): StoryDynamicsAlert[] {
  if (!Number.isFinite(chapterNum) || limit <= 0) return []
  const costPersistence = computeCostPersistence(readModel.chapters)
  return buildStoryPacingAlerts(readModel.chapters, costPersistence)
    .filter((alert) => alert.chapterNums.includes(chapterNum))
    .slice(0, limit)
}

export function loadStoryDynamicsReadModel(novelId: number): StoryDynamicsReadModel {
  const db = getDb()
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    title: chapters.title,
    volumeId: chapters.volumeId,
    reviewNotesJson: chapters.reviewNotesJson,
  }).from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
  const timelineRows = db.select({
    eventType: timelineEvents.eventType,
    eventTitle: timelineEvents.eventTitle,
    eventSummary: timelineEvents.eventSummary,
    eventResult: timelineEvents.eventResult,
    chapterStartId: timelineEvents.chapterStartId,
    chapterEndId: timelineEvents.chapterEndId,
    protagonistPresent: timelineEvents.protagonistPresent,
    protagonistAction: timelineEvents.protagonistAction,
  }).from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  return buildStoryDynamicsReadModel(chapterRows, timelineRows)
}

export function getChapterStoryPacingAlerts(
  novelId: number,
  chapterNum: number,
  limit = 3,
): StoryDynamicsAlert[] {
  return selectStoryPacingAlertsForChapter(loadStoryDynamicsReadModel(novelId), chapterNum, limit)
}
