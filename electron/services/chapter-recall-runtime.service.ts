import { asc, desc, eq } from 'drizzle-orm'
import type {
  ChapterRecallRuntimeBackfillResult,
  RecallDiagnostics,
  RecallRuntimeSnapshotSource,
  RecallSnapshot,
} from '../../src/types'
import { getDb } from '../database/db'
import { chapterRecallRuntimeSnapshots, chapters, tasks } from '../database/schema'
import { getRecommendedChapterWordsForOperatingMode } from '../../src/shared/operating-mode'
import {
  allocateChapterContext,
  collectChapterContextRawData,
  ContextOverflowError,
  HardConstraintOverflowError,
} from './context.service'

interface ChapterRecallRuntimeRecord {
  chapterId: number
  novelId: number
  recallSnapshot?: RecallSnapshot
  recallDiagnostics?: RecallDiagnostics
  recallSnapshotSource?: RecallRuntimeSnapshotSource
  sourceTaskId?: number
  contextVersion?: number
  computedAt?: string
}

function parseRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeSnapshotSource(value: unknown): RecallRuntimeSnapshotSource | undefined {
  return value === 'backfilled' || value === 'runtime' ? value : undefined
}

function parseTaskRecallProgress(task: { progressJson?: string | null } | null | undefined): {
  recallSnapshot?: RecallSnapshot
  recallDiagnostics?: RecallDiagnostics
} {
  const parsed = parseRecord(task?.progressJson)
  if (parsed.kind !== 'chapter_pipeline') return {}
  return {
    recallSnapshot: parsed.recallSnapshot as RecallSnapshot | undefined,
    recallDiagnostics: parsed.recallDiagnostics as RecallDiagnostics | undefined,
  }
}

function parsePersistedRecallRuntimeRow(
  row: typeof chapterRecallRuntimeSnapshots.$inferSelect,
): ChapterRecallRuntimeRecord {
  return {
    chapterId: row.chapterId,
    novelId: row.novelId,
    recallSnapshot: parseRecord(row.snapshotJson) as unknown as RecallSnapshot,
    recallDiagnostics: parseRecord(row.diagnosticsJson) as unknown as RecallDiagnostics,
    recallSnapshotSource: normalizeSnapshotSource(row.source) || 'runtime',
    sourceTaskId: typeof row.sourceTaskId === 'number' ? row.sourceTaskId : undefined,
    contextVersion: typeof row.contextVersion === 'number' ? row.contextVersion : undefined,
    computedAt: row.computedAt || row.updatedAt || row.createdAt || undefined,
  }
}

function buildTaskBackedRecallRuntimeMap(novelId: number): Map<number, ChapterRecallRuntimeRecord> {
  const db = getDb()
  const latestPipelineTasks = db.select().from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .filter((task) => (
      task.type === 'chapter_write'
      && task.runnerType === 'workflow'
      && task.relatedEntityType === 'chapter'
      && typeof task.relatedEntityId === 'number'
    ))

  return latestPipelineTasks.reduce<Map<number, ChapterRecallRuntimeRecord>>((result, task) => {
    const chapterId = Number(task.relatedEntityId)
    if (result.has(chapterId)) return result
    const { recallSnapshot, recallDiagnostics } = parseTaskRecallProgress(task)
    if (!recallSnapshot || !recallDiagnostics) return result
    result.set(chapterId, {
      chapterId,
      novelId,
      recallSnapshot,
      recallDiagnostics,
      recallSnapshotSource: 'runtime',
      sourceTaskId: task.id,
      computedAt: task.updatedAt || task.createdAt || undefined,
    })
    return result
  }, new Map())
}

function buildPersistedRecallRuntimeMap(
  novelId: number,
  options: { upToChapterNum?: number } = {},
): Map<number, ChapterRecallRuntimeRecord> {
  const db = getDb()
  const chapterById = new Map(
    db.select({
      id: chapters.id,
      chapterNum: chapters.chapterNum,
    }).from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.chapterNum] as const),
  )
  const rows = db.select().from(chapterRecallRuntimeSnapshots)
    .where(eq(chapterRecallRuntimeSnapshots.novelId, novelId))
    .orderBy(desc(chapterRecallRuntimeSnapshots.updatedAt), desc(chapterRecallRuntimeSnapshots.id))
    .all()

  return rows.reduce<Map<number, ChapterRecallRuntimeRecord>>((result, row) => {
    if (result.has(row.chapterId)) return result
    const chapterNum = chapterById.get(row.chapterId)
    if (typeof options.upToChapterNum === 'number' && typeof chapterNum === 'number' && chapterNum > options.upToChapterNum) {
      return result
    }
    result.set(row.chapterId, parsePersistedRecallRuntimeRow(row))
    return result
  }, new Map())
}

function classifyBackfillComplexity(rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>) {
  const chapter = rawContext.currentChapter
  if (!chapter) return 'standard' as const
  const outline = chapter.outline || ''
  const emotionTone = (chapter.emotionTone || '').toLowerCase()
  const maxChapterNum = rawContext.chapterRows.reduce((max, row) => Math.max(max, row.chapterNum), 0)
  const isArcEnding = Boolean(rawContext.currentArc && typeof rawContext.currentArc.chapterEnd === 'number' && rawContext.currentArc.chapterEnd === chapter.chapterNum)
  const isFirstChapter = chapter.chapterNum === 1
  const isLastChapter = maxChapterNum > 0 && chapter.chapterNum === maxChapterNum

  if (
    emotionTone.includes('高潮')
    || emotionTone.includes('climax')
    || emotionTone.includes('爆发')
    || emotionTone.includes('转折')
    || emotionTone.includes('结局')
    || emotionTone.includes('决战')
    || isFirstChapter
    || isLastChapter
    || isArcEnding
    || rawContext.outlineMentionedCharacterCount > 3
    || rawContext.activeThreadPressureCount >= 4
  ) {
    return 'key' as const
  }

  if (
    (emotionTone.includes('过渡') || emotionTone.includes('日常') || emotionTone.includes('平缓') || emotionTone.includes('铺垫'))
    && outline.length > 0
    && outline.length < 200
    && rawContext.outlineMentionedCharacterCount <= 2
    && rawContext.activeThreadPressureCount <= 2
    && !isFirstChapter
    && !isLastChapter
    && !isArcEnding
  ) {
    return 'simple' as const
  }

  return 'standard' as const
}

function resolveDraftBudget(
  complexity: 'simple' | 'standard' | 'key',
  targetWords: number,
  novelTargetWords?: number,
): number {
  const baseBudget = 12000
  const complexityOffset = complexity === 'key' ? 1800 : complexity === 'simple' ? -1200 : 0
  const largeChapterOffset = targetWords >= 5000
    ? 1200
    : targetWords >= 3500
      ? 400
      : 0
  const novelScaleOffset = !novelTargetWords ? 0
    : novelTargetWords >= 1500000 ? 4000
    : novelTargetWords >= 800000 ? 2800
    : novelTargetWords >= 500000 ? 1600
    : novelTargetWords >= 300000 ? 800
    : 0

  return Math.max(7000, baseBudget + complexityOffset + largeChapterOffset + novelScaleOffset)
}

async function buildBackfilledRecallRuntimeRecord(chapterId: number): Promise<ChapterRecallRuntimeRecord> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throw new Error(`chapter ${chapterId} not found`)
  }

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const complexity = classifyBackfillComplexity(rawContext)
  const chapterReferenceWords = chapter.targetWords > 0
    ? chapter.targetWords
    : getRecommendedChapterWordsForOperatingMode({ targetWords: rawContext.novel.targetWords })
  const budget = resolveDraftBudget(complexity, chapterReferenceWords, rawContext.novel.targetWords || 0)

  try {
    const context = allocateChapterContext(rawContext, {
      promptProfile: 'draft',
      chapterComplexity: complexity,
      totalBudget: budget,
    })
    return {
      chapterId: chapter.id,
      novelId: chapter.novelId,
      recallSnapshot: context.recallSnapshot,
      recallDiagnostics: context.recallDiagnostics,
      recallSnapshotSource: 'backfilled',
      contextVersion: chapter.contextVersion || rawContext.novel.contextVersion || 1,
      computedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (error instanceof ContextOverflowError || error instanceof HardConstraintOverflowError) {
      return {
        chapterId: chapter.id,
        novelId: chapter.novelId,
        recallSnapshot: error.context.recallSnapshot,
        recallDiagnostics: error.context.recallDiagnostics,
        recallSnapshotSource: 'backfilled',
        contextVersion: chapter.contextVersion || rawContext.novel.contextVersion || 1,
        computedAt: new Date().toISOString(),
      }
    }
    throw error
  }
}

export function listChapterRecallRuntimeMap(
  novelId: number,
  options: { upToChapterNum?: number } = {},
): Map<number, ChapterRecallRuntimeRecord> {
  const persisted = buildPersistedRecallRuntimeMap(novelId, options)
  const taskBacked = buildTaskBackedRecallRuntimeMap(novelId)

  for (const [chapterId, record] of taskBacked.entries()) {
    if (!persisted.has(chapterId)) {
      persisted.set(chapterId, record)
    }
  }

  return persisted
}

export function getChapterRecallRuntime(chapterId: number): ChapterRecallRuntimeRecord | null {
  const db = getDb()
  const chapter = db.select({
    id: chapters.id,
    novelId: chapters.novelId,
  }).from(chapters)
    .where(eq(chapters.id, chapterId))
    .all()[0]

  if (!chapter) return null

  return listChapterRecallRuntimeMap(chapter.novelId).get(chapterId) || null
}

export function persistChapterRecallRuntimeSnapshot(params: {
  novelId: number
  chapterId: number
  recallSnapshot: RecallSnapshot
  recallDiagnostics: RecallDiagnostics
  source: RecallRuntimeSnapshotSource
  sourceTaskId?: number
  contextVersion?: number
}): ChapterRecallRuntimeRecord {
  const db = getDb()
  const existing = db.select().from(chapterRecallRuntimeSnapshots)
    .where(eq(chapterRecallRuntimeSnapshots.chapterId, params.chapterId))
    .orderBy(desc(chapterRecallRuntimeSnapshots.updatedAt), desc(chapterRecallRuntimeSnapshots.id))
    .all()[0]
  const now = new Date().toISOString()
  const payload = {
    novelId: params.novelId,
    chapterId: params.chapterId,
    snapshotJson: JSON.stringify(params.recallSnapshot),
    diagnosticsJson: JSON.stringify(params.recallDiagnostics),
    source: params.source,
    sourceTaskId: params.sourceTaskId ?? null,
    contextVersion: params.contextVersion ?? 1,
    computedAt: now,
    updatedAt: now,
  }

  if (existing) {
    db.update(chapterRecallRuntimeSnapshots).set(payload)
      .where(eq(chapterRecallRuntimeSnapshots.id, existing.id))
      .run()
  } else {
    db.insert(chapterRecallRuntimeSnapshots).values({
      ...payload,
      createdAt: now,
    }).run()
  }

  return {
    chapterId: params.chapterId,
    novelId: params.novelId,
    recallSnapshot: params.recallSnapshot,
    recallDiagnostics: params.recallDiagnostics,
    recallSnapshotSource: params.source,
    sourceTaskId: params.sourceTaskId,
    contextVersion: params.contextVersion,
    computedAt: now,
  }
}

export function persistChapterRecallRuntimeFromTask(taskId: number): ChapterRecallRuntimeRecord | null {
  const task = getDb().select().from(tasks).where(eq(tasks.id, taskId)).all()[0]
  if (!task || task.type !== 'chapter_write' || task.runnerType !== 'workflow' || task.relatedEntityType !== 'chapter' || typeof task.relatedEntityId !== 'number') {
    return null
  }
  const { recallSnapshot, recallDiagnostics } = parseTaskRecallProgress(task)
  if (!recallSnapshot || !recallDiagnostics || !task.novelId) {
    return null
  }

  const chapter = getDb().select({
    id: chapters.id,
    contextVersion: chapters.contextVersion,
  }).from(chapters)
    .where(eq(chapters.id, task.relatedEntityId))
    .all()[0]

  return persistChapterRecallRuntimeSnapshot({
    novelId: task.novelId,
    chapterId: task.relatedEntityId,
    recallSnapshot,
    recallDiagnostics,
    source: 'runtime',
    sourceTaskId: task.id,
    contextVersion: chapter?.contextVersion || 1,
  })
}

export async function backfillMissingChapterRecallRuntimeSnapshots(
  novelId: number,
  options: { upToChapterNum?: number } = {},
): Promise<ChapterRecallRuntimeBackfillResult> {
  const db = getDb()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => typeof options.upToChapterNum !== 'number' || chapter.chapterNum <= options.upToChapterNum)

  const persisted = buildPersistedRecallRuntimeMap(novelId, options)
  const taskBacked = buildTaskBackedRecallRuntimeMap(novelId)
  const failedChapterIds: number[] = []
  let persistedTaskRuntimeCount = 0
  let backfilledCount = 0
  let skippedCount = 0

  for (const chapter of chapterRows) {
    if (persisted.has(chapter.id)) {
      skippedCount += 1
      continue
    }

    const taskRecord = taskBacked.get(chapter.id)
    if (taskRecord?.recallSnapshot && taskRecord.recallDiagnostics) {
      persistChapterRecallRuntimeSnapshot({
        novelId,
        chapterId: chapter.id,
        recallSnapshot: taskRecord.recallSnapshot,
        recallDiagnostics: taskRecord.recallDiagnostics,
        source: 'runtime',
        sourceTaskId: taskRecord.sourceTaskId,
        contextVersion: chapter.contextVersion || 1,
      })
      persistedTaskRuntimeCount += 1
      continue
    }

    try {
      const backfilled = await buildBackfilledRecallRuntimeRecord(chapter.id)
      if (!backfilled.recallSnapshot || !backfilled.recallDiagnostics) {
        skippedCount += 1
        continue
      }
      persistChapterRecallRuntimeSnapshot({
        novelId,
        chapterId: chapter.id,
        recallSnapshot: backfilled.recallSnapshot,
        recallDiagnostics: backfilled.recallDiagnostics,
        source: 'backfilled',
        contextVersion: backfilled.contextVersion || chapter.contextVersion || 1,
      })
      backfilledCount += 1
    } catch (error) {
      failedChapterIds.push(chapter.id)
      console.warn(`[recall-runtime] backfill failed for chapter ${chapter.id}:`, error)
    }
  }

  return {
    novelId,
    totalChapterCount: chapterRows.length,
    persistedTaskRuntimeCount,
    backfilledCount,
    skippedCount,
    failedChapterIds,
  }
}

export const __testing = {
  buildTaskBackedRecallRuntimeMap,
  classifyBackfillComplexity,
  parseTaskRecallProgress,
  resolveDraftBudget,
}
