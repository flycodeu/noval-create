import { desc, eq, inArray } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import {
  chapterSegments,
  chapters,
  novels,
  operationLogs,
  storyThreads,
  timelineEvents,
  type Chapter,
  type ChapterSegment,
  type OperationLog,
  type StoryThread,
  type TimelineEvent,
} from '../database/schema'
import { removeTimelineEventFromItems, syncChapterTimelineStatuses, syncTimelineEventItemLinks } from './link-sync.service'
import { markNovelContextChanged, markSubsequentChaptersStale } from './context-impact.service'
import { throwUserFacingError } from '../utils/user-facing-error'

type OperationEntityType = 'chapter' | 'thread' | 'timeline'
type OperationType = 'batch_update' | 'batch_delete' | 'batch_reindex'

interface TimelineAnchorSnapshot {
  id: number
  chapterStartId: number | null
  chapterEndId: number | null
  segmentId: number | null
}

type OperationUndoPayload =
  | {
    kind: 'chapter.batch_update'
    novelId: number
    chapters: Chapter[]
    reason: string
  }
  | {
    kind: 'chapter.batch_delete'
    novelId: number
    chapters: Chapter[]
    segments: ChapterSegment[]
    timelineAnchors: TimelineAnchorSnapshot[]
    reason: string
  }
  | {
    kind: 'chapter.batch_reindex'
    novelId: number
    chapters: Chapter[]
    reason: string
  }
  | {
    kind: 'thread.batch_update'
    novelId: number
    threads: StoryThread[]
  }
  | {
    kind: 'thread.batch_delete'
    novelId: number
    threads: StoryThread[]
  }
  | {
    kind: 'timeline.batch_update'
    novelId: number
    events: TimelineEvent[]
  }
  | {
    kind: 'timeline.batch_delete'
    novelId: number
    events: TimelineEvent[]
  }

function nowIso() {
  return new Date().toISOString()
}

function parseJsonValue<T>(raw?: string | null): T | null {
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
}

function stringifyPayload(value: unknown): string {
  return JSON.stringify(value)
}

function toChapterMutation(snapshot: Chapter) {
  return {
    novelId: snapshot.novelId,
    volumeId: snapshot.volumeId ?? null,
    partId: snapshot.partId ?? null,
    chapterNum: snapshot.chapterNum,
    title: snapshot.title ?? null,
    outline: snapshot.outline ?? null,
    scenePlanJson: snapshot.scenePlanJson ?? null,
    content: snapshot.content ?? null,
    wordCount: snapshot.wordCount ?? 0,
    summary: snapshot.summary ?? null,
    nextChapterSeed: snapshot.nextChapterSeed ?? null,
    continuityStateJson: snapshot.continuityStateJson ?? null,
    reviewNotesJson: snapshot.reviewNotesJson ?? null,
    status: snapshot.status,
    aiScoreJson: snapshot.aiScoreJson ?? null,
    arcId: snapshot.arcId ?? null,
    targetWords: snapshot.targetWords ?? 3000,
    emotionTone: snapshot.emotionTone ?? null,
    compiledFromSegments: snapshot.compiledFromSegments ?? 0,
    segmentCount: snapshot.segmentCount ?? 0,
    contextVersion: snapshot.contextVersion ?? 1,
    staleReasonJson: snapshot.staleReasonJson ?? '[]',
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  }
}

function toChapterSegmentInsert(snapshot: ChapterSegment) {
  return {
    id: snapshot.id,
    novelId: snapshot.novelId,
    chapterId: snapshot.chapterId,
    volumeId: snapshot.volumeId ?? null,
    partId: snapshot.partId ?? null,
    segmentOrder: snapshot.segmentOrder,
    title: snapshot.title ?? null,
    segmentType: snapshot.segmentType ?? 'scene',
    purpose: snapshot.purpose ?? null,
    timeAnchor: snapshot.timeAnchor ?? null,
    locationName: snapshot.locationName ?? null,
    presentCharacterIdsJson: snapshot.presentCharacterIdsJson ?? '[]',
    linkedItemIdsJson: snapshot.linkedItemIdsJson ?? '[]',
    inputState: snapshot.inputState ?? null,
    outputState: snapshot.outputState ?? null,
    summary: snapshot.summary ?? null,
    content: snapshot.content ?? null,
    riskTagsJson: snapshot.riskTagsJson ?? '[]',
    status: snapshot.status ?? 'planned',
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  }
}

function toStoryThreadMutation(snapshot: StoryThread) {
  return {
    novelId: snapshot.novelId,
    threadType: snapshot.threadType,
    title: snapshot.title,
    summary: snapshot.summary ?? null,
    premise: snapshot.premise ?? null,
    status: snapshot.status,
    priority: snapshot.priority,
    startChapter: snapshot.startChapter ?? null,
    targetPayoffChapter: snapshot.targetPayoffChapter ?? null,
    payoffCondition: snapshot.payoffCondition ?? null,
    currentState: snapshot.currentState ?? null,
    plantedChapter: snapshot.plantedChapter ?? null,
    lastReferencedChapter: snapshot.lastReferencedChapter ?? null,
    reminderInterval: snapshot.reminderInterval ?? 20,
    relatedCharacterIdsJson: snapshot.relatedCharacterIdsJson ?? '[]',
    relatedItemIdsJson: snapshot.relatedItemIdsJson ?? '[]',
    relatedTimelineEventIdsJson: snapshot.relatedTimelineEventIdsJson ?? '[]',
    notes: snapshot.notes ?? null,
    sortOrder: snapshot.sortOrder ?? 0,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  }
}

function toTimelineEventMutation(snapshot: TimelineEvent) {
  return {
    novelId: snapshot.novelId,
    sortOrder: snapshot.sortOrder ?? 0,
    eventTitle: snapshot.eventTitle,
    eventSummary: snapshot.eventSummary ?? null,
    timeMode: snapshot.timeMode,
    timeLabel: snapshot.timeLabel,
    timeSortValue: snapshot.timeSortValue ?? 0,
    timePrecision: snapshot.timePrecision ?? null,
    isMajorEvent: snapshot.isMajorEvent ? 1 : 0,
    eventType: snapshot.eventType ?? null,
    arcId: snapshot.arcId ?? null,
    volumeId: snapshot.volumeId ?? null,
    partId: snapshot.partId ?? null,
    chapterStartId: snapshot.chapterStartId ?? null,
    chapterEndId: snapshot.chapterEndId ?? null,
    segmentId: snapshot.segmentId ?? null,
    locationMapId: snapshot.locationMapId ?? null,
    presentCharacterIdsJson: snapshot.presentCharacterIdsJson ?? '[]',
    affectedCharacterIdsJson: snapshot.affectedCharacterIdsJson ?? '[]',
    protagonistPresent: snapshot.protagonistPresent ? 1 : 0,
    protagonistAction: snapshot.protagonistAction ?? null,
    eventCause: snapshot.eventCause ?? null,
    eventProcess: snapshot.eventProcess ?? null,
    eventResult: snapshot.eventResult ?? null,
    linkedItemIdsJson: snapshot.linkedItemIdsJson ?? '[]',
    directConsequencesJson: snapshot.directConsequencesJson ?? '[]',
    openThreadsJson: snapshot.openThreadsJson ?? '[]',
    notes: snapshot.notes ?? null,
    anchorInvalid: snapshot.anchorInvalid ? 1 : 0,
    status: snapshot.status,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  }
}

function recalculateNovelWordCount(novelId: number) {
  const db = getDb()
  const rows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const totalWords = rows.reduce((sum, row) => sum + (row.wordCount || 0), 0)
  db.update(novels).set({
    totalWords,
    updatedAt: nowIso(),
  }).where(eq(novels.id, novelId)).run()
}

function upsertChapterSnapshot(snapshot: Chapter) {
  const db = getDb()
  const current = db.select().from(chapters).where(eq(chapters.id, snapshot.id)).all()[0] || null
  if (current) {
    db.update(chapters).set(toChapterMutation(snapshot)).where(eq(chapters.id, snapshot.id)).run()
    return
  }

  db.insert(chapters).values({
    id: snapshot.id,
    ...toChapterMutation(snapshot),
  }).run()
}

function upsertStoryThreadSnapshot(snapshot: StoryThread) {
  const db = getDb()
  const current = db.select().from(storyThreads).where(eq(storyThreads.id, snapshot.id)).all()[0] || null
  if (current) {
    db.update(storyThreads).set(toStoryThreadMutation(snapshot)).where(eq(storyThreads.id, snapshot.id)).run()
    return
  }

  db.insert(storyThreads).values({
    id: snapshot.id,
    ...toStoryThreadMutation(snapshot),
  }).run()
}

function upsertTimelineEventSnapshot(snapshot: TimelineEvent) {
  const db = getDb()
  const current = db.select().from(timelineEvents).where(eq(timelineEvents.id, snapshot.id)).all()[0] || null
  if (current) {
    removeTimelineEventFromItems(snapshot.id)
    db.update(timelineEvents).set(toTimelineEventMutation(snapshot)).where(eq(timelineEvents.id, snapshot.id)).run()
  } else {
    db.insert(timelineEvents).values({
      id: snapshot.id,
      ...toTimelineEventMutation(snapshot),
    }).run()
  }
  syncTimelineEventItemLinks(snapshot.id)
}

function restoreChapterDeletePayload(payload: Extract<OperationUndoPayload, { kind: 'chapter.batch_delete' }>) {
  const db = getDb()
  const sortedChapters = payload.chapters.slice().sort((left, right) => left.chapterNum - right.chapterNum)
  const sortedSegments = payload.segments.slice().sort((left, right) => left.segmentOrder - right.segmentOrder)

  sortedChapters.forEach((snapshot) => {
    upsertChapterSnapshot(snapshot)
  })
  sortedSegments.forEach((snapshot) => {
    const existing = db.select().from(chapterSegments).where(eq(chapterSegments.id, snapshot.id)).all()[0] || null
    if (existing) return
    db.insert(chapterSegments).values(toChapterSegmentInsert(snapshot)).run()
  })
  payload.timelineAnchors.forEach((snapshot) => {
    db.update(timelineEvents).set({
      chapterStartId: snapshot.chapterStartId,
      chapterEndId: snapshot.chapterEndId,
      segmentId: snapshot.segmentId,
      updatedAt: nowIso(),
    }).where(eq(timelineEvents.id, snapshot.id)).run()
  })

  recalculateNovelWordCount(payload.novelId)
  const minChapterNum = sortedChapters[0]?.chapterNum
  if (typeof minChapterNum === 'number' && minChapterNum > 0) {
    syncChapterTimelineStatuses(payload.novelId, minChapterNum)
    markSubsequentChaptersStale(payload.novelId, Math.max(0, minChapterNum - 1), payload.reason)
  }
  markNovelContextChanged(payload.novelId, payload.reason)
}

function restoreChapterUpdatePayload(
  payload: Extract<OperationUndoPayload, { kind: 'chapter.batch_update' | 'chapter.batch_reindex' }>,
) {
  const sortedChapters = payload.chapters.slice().sort((left, right) => left.chapterNum - right.chapterNum)
  sortedChapters.forEach((snapshot) => {
    upsertChapterSnapshot(snapshot)
  })
  recalculateNovelWordCount(payload.novelId)
  const minChapterNum = sortedChapters[0]?.chapterNum
  if (typeof minChapterNum === 'number' && minChapterNum > 0) {
    syncChapterTimelineStatuses(payload.novelId, minChapterNum)
    markSubsequentChaptersStale(payload.novelId, Math.max(0, minChapterNum - 1), payload.reason)
  }
  markNovelContextChanged(payload.novelId, payload.reason)
}

function restoreStoryThreadPayload(payload: Extract<OperationUndoPayload, { kind: 'thread.batch_update' | 'thread.batch_delete' }>) {
  payload.threads.forEach((snapshot) => {
    upsertStoryThreadSnapshot(snapshot)
  })
  markNovelContextChanged(payload.novelId, 'Story threads restored')
}

function restoreTimelinePayload(payload: Extract<OperationUndoPayload, { kind: 'timeline.batch_update' | 'timeline.batch_delete' }>) {
  payload.events.forEach((snapshot) => {
    upsertTimelineEventSnapshot(snapshot)
  })
  markNovelContextChanged(payload.novelId, 'Timeline events restored')
}

export function buildBatchKey(prefix: string) {
  return `${prefix}:${Date.now()}`
}

export function createOperationLog(input: {
  novelId: number
  entityType: OperationEntityType
  entityIds: number[]
  operationType: OperationType
  summary: string
  batchKey?: string
  before?: unknown
  after?: unknown
  undoPayload: OperationUndoPayload
}) {
  const db = getDb()
  const result = db.insert(operationLogs).values({
    novelId: input.novelId,
    entityType: input.entityType,
    entityIdsJson: stringifyPayload(uniqueIds(input.entityIds)),
    operationType: input.operationType,
    summary: input.summary,
    batchKey: input.batchKey ?? null,
    beforeJson: input.before === undefined ? null : stringifyPayload(input.before),
    afterJson: input.after === undefined ? null : stringifyPayload(input.after),
    undoPayloadJson: stringifyPayload(input.undoPayload),
    undone: 0,
    undoneAt: null,
    createdAt: nowIso(),
  }).run()
  return Number(result.lastInsertRowid)
}

export function listRecentOperationLogs(novelId: number, limit = 10): OperationLog[] {
  const db = getDb()
  return db.select().from(operationLogs)
    .where(eq(operationLogs.novelId, novelId))
    .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id))
    .limit(Math.max(1, Math.min(limit, 50)))
    .all()
}

export function getLatestUndoableOperation(novelId: number): OperationLog | null {
  const db = getDb()
  return db.select().from(operationLogs)
    .where(eq(operationLogs.novelId, novelId))
    .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id))
    .all()
    .find((log) => !log.undone) || null
}

export function undoOperation(logId: number): OperationLog | null {
  const db = getDb()
  const sqlite = getSqlite()
  const log = db.select().from(operationLogs).where(eq(operationLogs.id, logId)).all()[0] || null
  if (!log || log.undone) return null

  const payload = parseJsonValue<OperationUndoPayload>(log.undoPayloadJson)
  if (!payload) {
    throwUserFacingError('history.undoCheckpointCorrupt')
  }

  const run = sqlite.transaction(() => {
    switch (payload.kind) {
      case 'chapter.batch_delete':
        restoreChapterDeletePayload(payload)
        break
      case 'chapter.batch_reindex':
      case 'chapter.batch_update':
        restoreChapterUpdatePayload(payload)
        break
      case 'thread.batch_delete':
      case 'thread.batch_update':
        restoreStoryThreadPayload(payload)
        break
      case 'timeline.batch_delete':
      case 'timeline.batch_update':
        restoreTimelinePayload(payload)
        break
      default:
        throwUserFacingError('history.undoUnsupported')
    }

    db.update(operationLogs).set({
      undone: 1,
      undoneAt: nowIso(),
    }).where(eq(operationLogs.id, logId)).run()
  })
  run()

  return db.select().from(operationLogs).where(eq(operationLogs.id, logId)).all()[0] || null
}

export function captureTimelineAnchorsForChapterIds(chapterIds: number[]): TimelineAnchorSnapshot[] {
  const ids = uniqueIds(chapterIds)
  if (ids.length === 0) return []
  const db = getDb()
  const segments = db.select().from(chapterSegments).where(inArray(chapterSegments.chapterId, ids)).all()
  const segmentIds = segments.map((segment) => segment.id)
  const rows = db.select().from(timelineEvents).all().filter((event) => (
    (typeof event.chapterStartId === 'number' && ids.includes(event.chapterStartId))
    || (typeof event.chapterEndId === 'number' && ids.includes(event.chapterEndId))
    || (typeof event.segmentId === 'number' && segmentIds.includes(event.segmentId))
  ))

  return rows.map((row) => ({
    id: row.id,
    chapterStartId: row.chapterStartId ?? null,
    chapterEndId: row.chapterEndId ?? null,
    segmentId: row.segmentId ?? null,
  }))
}
