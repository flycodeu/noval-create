import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import {
  type Chapter as ChapterRow,
  type ChapterSegment as ChapterSegmentRow,
  type StoryPart as StoryPartRow,
  type StoryVolume as StoryVolumeRow,
  chapterSegments,
  chapters,
  novels,
  storyMemoryCheckpoints,
  storyParts,
  storyVolumes,
} from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'
import { markTimelineEventsSegmentAnchorInvalid, syncTimelineStructureAnchors } from './timeline.service'

type StructureStatus = 'planning' | 'draft' | 'locked'
type CheckpointScope = 'novel' | 'volume' | 'part'

export interface StoryStructureSegmentView extends ChapterSegmentRow {}

export interface StoryStructureChapterView extends ChapterRow {
  segments: StoryStructureSegmentView[]
}

export interface StoryStructurePartView extends StoryPartRow {
  chapters: StoryStructureChapterView[]
  wordCount: number
  segmentCount: number
}

export interface StoryStructureVolumeView extends StoryVolumeRow {
  parts: StoryStructurePartView[]
  wordCount: number
  chapterCount: number
  segmentCount: number
}

export interface StoryStructureTree {
  novelId: number
  volumes: StoryStructureVolumeView[]
}

interface StoryPartReorderOperation {
  id: number
  volumeId: number
  partNumber: number
}

function countWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function stringifyStringArray(values: string[]): string {
  return JSON.stringify([...new Set(values.map((value) => value.trim()).filter(Boolean))])
}

function getVolumeLabel(volume: { volumeNumber: number; title?: string | null }) {
  return volume.title?.trim() || `第${volume.volumeNumber}卷`
}

function getPartLabel(part: { partNumber: number; title?: string | null }) {
  return part.title?.trim() || `第${part.partNumber}部`
}

function getDefaultVolumeTitle(volumeNumber: number): string {
  return `第${volumeNumber}卷`
}

function getDefaultPartTitle(partNumber: number): string {
  return `第${partNumber}部`
}

function getVolumeRows(novelId: number) {
  const db = getDb()
  return db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
}

function getPartRows(novelId: number) {
  const db = getDb()
  return db.select().from(storyParts)
    .where(eq(storyParts.novelId, novelId))
    .orderBy(asc(storyParts.volumeId), asc(storyParts.partNumber), asc(storyParts.id))
    .all()
}

function getChapterRows(novelId: number) {
  const db = getDb()
  return db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
}

function getSegmentRowsByNovel(novelId: number) {
  const db = getDb()
  return db.select().from(chapterSegments)
    .where(eq(chapterSegments.novelId, novelId))
    .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
}

function getCheckpointRows(novelId: number) {
  const db = getDb()
  return db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .orderBy(asc(storyMemoryCheckpoints.scopeType), asc(storyMemoryCheckpoints.scopeId), asc(storyMemoryCheckpoints.id))
    .all()
}

export function resolveDefaultStructure(novelId: number): { volumeId: number; partId: number } {
  const db = getDb()
  let volumes = getVolumeRows(novelId)
  if (volumes.length === 0) {
    const result = db.insert(storyVolumes).values({
      novelId,
      volumeNumber: 1,
      title: getDefaultVolumeTitle(1),
      status: 'planning',
    }).run()
    volumes = getVolumeRows(novelId)
    if (volumes.length === 0) {
      return { volumeId: Number(result.lastInsertRowid), partId: 0 }
    }
  }

  const primaryVolume = volumes[0]
  let parts = getPartRows(novelId).filter((part) => part.volumeId === primaryVolume.id)
  if (parts.length === 0) {
    const result = db.insert(storyParts).values({
      novelId,
      volumeId: primaryVolume.id,
      partNumber: 1,
      title: getDefaultPartTitle(1),
      status: 'planning',
    }).run()
    parts = getPartRows(novelId).filter((part) => part.volumeId === primaryVolume.id)
    if (parts.length === 0) {
      return { volumeId: primaryVolume.id, partId: Number(result.lastInsertRowid) }
    }
  }

  return { volumeId: primaryVolume.id, partId: parts[0].id }
}

function syncPartRanges(novelId: number) {
  const db = getDb()
  const partRows = getPartRows(novelId)
  const chapterRows = getChapterRows(novelId)

  for (const part of partRows) {
    const chapterNums = chapterRows
      .filter((chapter) => chapter.partId === part.id)
      .map((chapter) => chapter.chapterNum)
      .sort((left, right) => left - right)

    db.update(storyParts).set({
      startChapterNum: chapterNums[0] ?? null,
      endChapterNum: chapterNums.length > 0 ? chapterNums[chapterNums.length - 1] : null,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, part.id)).run()
  }
}

function syncChapterSegmentMetadata(novelId: number) {
  const db = getDb()
  const chapterRows = getChapterRows(novelId)
  const segmentRows = getSegmentRowsByNovel(novelId)
  const segmentsByChapter = new Map<number, Array<typeof chapterSegments.$inferSelect>>()

  for (const segment of segmentRows) {
    const current = segmentsByChapter.get(segment.chapterId) || []
    current.push(segment)
    segmentsByChapter.set(segment.chapterId, current)
  }

  for (const chapter of chapterRows) {
    const items = (segmentsByChapter.get(chapter.id) || []).sort((left, right) => left.segmentOrder - right.segmentOrder)
    const nextSegmentCount = items.length
    if ((chapter.segmentCount || 0) !== nextSegmentCount) {
      db.update(chapters).set({
        segmentCount: nextSegmentCount,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, chapter.id)).run()
    }
  }
}

function createDefaultSegment(
  chapter: typeof chapters.$inferSelect,
  options: { content?: string; summary?: string } = {},
): number {
  const db = getDb()
  const result = db.insert(chapterSegments).values({
    novelId: chapter.novelId,
    chapterId: chapter.id,
    volumeId: chapter.volumeId ?? null,
    partId: chapter.partId ?? null,
    segmentOrder: 1,
    title: chapter.title || `第${chapter.chapterNum}章`,
    segmentType: 'scene',
    purpose: chapter.outline || chapter.summary || '',
    summary: options.summary ?? chapter.summary ?? '',
    content: options.content ?? chapter.content ?? '',
    riskTagsJson: stringifyStringArray([]),
    presentCharacterIdsJson: JSON.stringify([]),
    linkedItemIdsJson: JSON.stringify([]),
    status: 'draft',
  }).run()

  return Number(result.lastInsertRowid)
}

export function ensureStoryStructure(novelId: number): { volumeId: number; partId: number } {
  const db = getDb()
  const fallback = resolveDefaultStructure(novelId)
  const volumeRows = getVolumeRows(novelId)
  const partRows = getPartRows(novelId)
  const partById = new Map(partRows.map((part) => [part.id, part]))
  const volumeById = new Map(volumeRows.map((volume) => [volume.id, volume]))
  const chapterRows = getChapterRows(novelId)
  const segmentRows = getSegmentRowsByNovel(novelId)
  const segmentCountByChapter = new Map<number, number>()

  for (const segment of segmentRows) {
    segmentCountByChapter.set(segment.chapterId, (segmentCountByChapter.get(segment.chapterId) || 0) + 1)
  }

  for (const chapter of chapterRows) {
    const linkedPart = chapter.partId ? partById.get(chapter.partId) : undefined
    const linkedVolume = chapter.volumeId ? volumeById.get(chapter.volumeId) : undefined
    const nextPartId = linkedPart?.id ?? fallback.partId
    const nextVolumeId = linkedPart?.volumeId ?? linkedVolume?.id ?? fallback.volumeId
    const shouldUpdate = chapter.partId !== nextPartId || chapter.volumeId !== nextVolumeId

    if (shouldUpdate) {
      db.update(chapters).set({
        volumeId: nextVolumeId,
        partId: nextPartId,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, chapter.id)).run()
    }

    if ((segmentCountByChapter.get(chapter.id) || 0) === 0) {
      createDefaultSegment({
        ...chapter,
        volumeId: nextVolumeId,
        partId: nextPartId,
      })
    } else {
      db.update(chapterSegments).set({
        volumeId: nextVolumeId,
        partId: nextPartId,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapterSegments.chapterId, chapter.id)).run()
    }
  }

  syncChapterSegmentMetadata(novelId)
  syncPartRanges(novelId)
  return fallback
}

export function listStoryStructure(novelId: number): StoryStructureTree {
  ensureStoryStructure(novelId)
  const volumeRows = getVolumeRows(novelId)
  const partRows = getPartRows(novelId)
  const chapterRows = getChapterRows(novelId)
  const segmentRows = getSegmentRowsByNovel(novelId)

  const segmentsByChapter = new Map<number, StoryStructureSegmentView[]>()
  for (const segment of segmentRows) {
    const current = segmentsByChapter.get(segment.chapterId) || []
    current.push(segment)
    segmentsByChapter.set(segment.chapterId, current)
  }

  const chaptersByPart = new Map<number, StoryStructureChapterView[]>()
  for (const chapter of chapterRows) {
    const next: StoryStructureChapterView = {
      ...chapter,
      segments: (segmentsByChapter.get(chapter.id) || []).sort((left, right) => left.segmentOrder - right.segmentOrder),
    }
    const partId = chapter.partId || 0
    const current = chaptersByPart.get(partId) || []
    current.push(next)
    chaptersByPart.set(partId, current)
  }

  const partsByVolume = new Map<number, StoryStructurePartView[]>()
  for (const part of partRows) {
    const chaptersForPart = (chaptersByPart.get(part.id) || []).sort((left, right) => left.chapterNum - right.chapterNum)
    const partView: StoryStructurePartView = {
      ...part,
      chapters: chaptersForPart,
      wordCount: chaptersForPart.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0),
      segmentCount: chaptersForPart.reduce((sum, chapter) => sum + chapter.segments.length, 0),
    }
    const current = partsByVolume.get(part.volumeId) || []
    current.push(partView)
    partsByVolume.set(part.volumeId, current)
  }

  const volumes: StoryStructureVolumeView[] = volumeRows.map((volume) => {
    const parts = (partsByVolume.get(volume.id) || []).sort((left, right) => left.partNumber - right.partNumber)
    return {
      ...volume,
      parts,
      wordCount: parts.reduce((sum, part) => sum + part.wordCount, 0),
      chapterCount: parts.reduce((sum, part) => sum + part.chapters.length, 0),
      segmentCount: parts.reduce((sum, part) => sum + part.segmentCount, 0),
    }
  })

  return {
    novelId,
    volumes,
  }
}

export function listChapterSegments(chapterId: number): StoryStructureSegmentView[] {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return []
  ensureStoryStructure(chapter.novelId)
  return db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
}

export function getChapterSegment(id: number): StoryStructureSegmentView | null {
  const db = getDb()
  const segment = db.select().from(chapterSegments).where(eq(chapterSegments.id, id)).all()[0] || null
  if (!segment) return null
  ensureStoryStructure(segment.novelId)
  return db.select().from(chapterSegments).where(eq(chapterSegments.id, id)).all()[0] || null
}

export function listStoryCheckpoints(novelId: number) {
  ensureStoryStructure(novelId)
  return getCheckpointRows(novelId)
}

export function createStoryVolume(
  novelId: number,
  data: Partial<{
    title: string
    summary: string
    targetWords: number
    status: StructureStatus
  }>,
) {
  const db = getDb()
  const nextNumber = (getVolumeRows(novelId).at(-1)?.volumeNumber || 0) + 1
  const result = db.insert(storyVolumes).values({
    novelId,
    volumeNumber: nextNumber,
    title: asText(data.title) || getDefaultVolumeTitle(nextNumber),
    summary: asText(data.summary),
    targetWords: typeof data.targetWords === 'number' ? data.targetWords : 0,
    status: data.status || 'planning',
  }).run()
  markNovelContextChanged(novelId, 'Story structure changed')
  return Number(result.lastInsertRowid)
}

export function updateStoryVolume(
  id: number,
  data: Partial<{
    title: string
    summary: string
    targetWords: number
    status: StructureStatus
  }>,
) {
  const db = getDb()
  const current = db.select().from(storyVolumes).where(eq(storyVolumes.id, id)).all()[0]
  if (!current) throw new Error('Volume not found')
  db.update(storyVolumes).set({
    title: data.title !== undefined ? asText(data.title) : current.title,
    summary: data.summary !== undefined ? asText(data.summary) : current.summary,
    targetWords: typeof data.targetWords === 'number' ? data.targetWords : current.targetWords,
    status: data.status || current.status,
    updatedAt: new Date().toISOString(),
  }).where(eq(storyVolumes.id, id)).run()
  markNovelContextChanged(current.novelId, 'Story structure changed')
}

export function reorderStoryVolumes(novelId: number, orderedIds: number[]) {
  const db = getDb()
  const rows = getVolumeRows(novelId)
  if (rows.length !== orderedIds.length) {
    throw new Error('Volume count mismatch')
  }

  const existingIds = new Set(rows.map((row) => row.id))
  if (orderedIds.some((id) => !existingIds.has(id))) {
    throw new Error('Volume ids are invalid')
  }

  orderedIds.forEach((id, index) => {
    db.update(storyVolumes).set({
      volumeNumber: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyVolumes.id, id)).run()
  })

  markNovelContextChanged(novelId, 'Story structure changed')
}

function ensureFallbackPartForVolume(novelId: number, volumeId: number) {
  const db = getDb()
  const partRows = getPartRows(novelId).filter((part) => part.volumeId === volumeId)
  if (partRows.length > 0) return partRows[0]
  const nextPartNumber = 1
  const result = db.insert(storyParts).values({
    novelId,
    volumeId,
    partNumber: nextPartNumber,
    title: getDefaultPartTitle(nextPartNumber),
    status: 'planning',
  }).run()
  return db.select().from(storyParts).where(eq(storyParts.id, Number(result.lastInsertRowid))).all()[0]
}

export function deleteStoryVolume(id: number) {
  const db = getDb()
  const current = db.select().from(storyVolumes).where(eq(storyVolumes.id, id)).all()[0]
  if (!current) return

  const sibling = getVolumeRows(current.novelId).find((volume) => volume.id !== id)
  const fallbackVolumeId = sibling?.id || createStoryVolume(current.novelId, {
    title: getDefaultVolumeTitle((getVolumeRows(current.novelId).at(-1)?.volumeNumber || 0) + 1),
  })
  const fallbackPart = ensureFallbackPartForVolume(current.novelId, fallbackVolumeId)

  db.update(storyParts).set({
    volumeId: fallbackVolumeId,
    updatedAt: new Date().toISOString(),
  }).where(eq(storyParts.volumeId, id)).run()
  db.update(chapters).set({
    volumeId: fallbackVolumeId,
    partId: fallbackPart.id,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.volumeId, id)).run()
  db.update(chapterSegments).set({
    volumeId: fallbackVolumeId,
    partId: fallbackPart.id,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterSegments.volumeId, id)).run()
  db.delete(storyVolumes).where(eq(storyVolumes.id, id)).run()
  syncPartRanges(current.novelId)
  syncTimelineStructureAnchors(current.novelId)
  markNovelContextChanged(current.novelId, 'Story structure changed')
}

export function createStoryPart(
  volumeId: number,
  data: Partial<{
    title: string
    summary: string
    targetWords: number
    status: StructureStatus
  }>,
) {
  const db = getDb()
  const volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, volumeId)).all()[0]
  if (!volume) throw new Error('Volume not found')
  const nextNumber = (getPartRows(volume.novelId).filter((part) => part.volumeId === volumeId).at(-1)?.partNumber || 0) + 1
  const result = db.insert(storyParts).values({
    novelId: volume.novelId,
    volumeId,
    partNumber: nextNumber,
    title: asText(data.title) || getDefaultPartTitle(nextNumber),
    summary: asText(data.summary),
    targetWords: typeof data.targetWords === 'number' ? data.targetWords : 0,
    status: data.status || 'planning',
  }).run()
  markNovelContextChanged(volume.novelId, 'Story structure changed')
  return Number(result.lastInsertRowid)
}

export function updateStoryPart(
  id: number,
  data: Partial<{
    title: string
    summary: string
    targetWords: number
    status: StructureStatus
  }>,
) {
  const db = getDb()
  const current = db.select().from(storyParts).where(eq(storyParts.id, id)).all()[0]
  if (!current) throw new Error('Part not found')
  db.update(storyParts).set({
    title: data.title !== undefined ? asText(data.title) : current.title,
    summary: data.summary !== undefined ? asText(data.summary) : current.summary,
    targetWords: typeof data.targetWords === 'number' ? data.targetWords : current.targetWords,
    status: data.status || current.status,
    updatedAt: new Date().toISOString(),
  }).where(eq(storyParts.id, id)).run()
  syncPartRanges(current.novelId)
  markNovelContextChanged(current.novelId, 'Story structure changed')
}

export function reorderStoryParts(novelId: number, operations: StoryPartReorderOperation[]) {
  const db = getDb()
  const partRows = getPartRows(novelId)
  const volumeRows = getVolumeRows(novelId)

  if (partRows.length !== operations.length) {
    throw new Error('Part count mismatch')
  }

  const partById = new Map(partRows.map((part) => [part.id, part]))
  const volumeIds = new Set(volumeRows.map((volume) => volume.id))
  const operationIds = new Set(operations.map((item) => item.id))
  if (operationIds.size !== operations.length || operations.some((item) => !partById.has(item.id))) {
    throw new Error('Part ids are invalid')
  }
  if (partRows.some((part) => !operationIds.has(part.id))) {
    throw new Error('Part ids are incomplete')
  }
  if (operations.some((item) => !volumeIds.has(item.volumeId))) {
    throw new Error('Target volume ids are invalid')
  }

  operations.forEach((item) => {
    db.update(storyParts).set({
      volumeId: item.volumeId,
      partNumber: item.partNumber,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, item.id)).run()
  })

  operations.forEach((item) => {
    const current = partById.get(item.id)
    if (!current || current.volumeId === item.volumeId) return
    db.update(chapters).set({
      volumeId: item.volumeId,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.partId, item.id)).run()
    db.update(chapterSegments).set({
      volumeId: item.volumeId,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.partId, item.id)).run()
  })

  syncPartRanges(novelId)
  syncTimelineStructureAnchors(novelId)
  markNovelContextChanged(novelId, 'Story structure changed')
}

export function reorderStoryPartsInVolume(volumeId: number, orderedIds: number[]) {
  const db = getDb()
  const volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, volumeId)).all()[0]
  if (!volume) throw new Error('Volume not found')

  const partRows = getPartRows(volume.novelId).filter((part) => part.volumeId === volumeId)
  if (partRows.length !== orderedIds.length) {
    throw new Error('Part count mismatch')
  }

  const partIds = new Set(partRows.map((part) => part.id))
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !partIds.has(id))) {
    throw new Error('Part ids are invalid')
  }

  orderedIds.forEach((id, index) => {
    db.update(storyParts).set({
      partNumber: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, id)).run()
  })

  syncPartRanges(volume.novelId)
  syncTimelineStructureAnchors(volume.novelId)
  markNovelContextChanged(volume.novelId, 'Story structure changed')
}

export function deleteStoryPart(id: number) {
  const db = getDb()
  const current = db.select().from(storyParts).where(eq(storyParts.id, id)).all()[0]
  if (!current) return
  const sibling = getPartRows(current.novelId).find((part) => part.id !== id && part.volumeId === current.volumeId)
  const fallbackPartId = sibling?.id || createStoryPart(current.volumeId, {
    title: getDefaultPartTitle((getPartRows(current.novelId).filter((part) => part.volumeId === current.volumeId).at(-1)?.partNumber || 0) + 1),
  })
  const fallbackPart = db.select().from(storyParts).where(eq(storyParts.id, fallbackPartId)).all()[0]
  db.update(chapters).set({
    volumeId: fallbackPart.volumeId,
    partId: fallbackPart.id,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.partId, id)).run()
  db.update(chapterSegments).set({
    volumeId: fallbackPart.volumeId,
    partId: fallbackPart.id,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterSegments.partId, id)).run()
  db.delete(storyParts).where(eq(storyParts.id, id)).run()
  syncPartRanges(current.novelId)
  syncTimelineStructureAnchors(current.novelId)
  markNovelContextChanged(current.novelId, 'Story structure changed')
}

export function assignChapterToPart(chapterId: number, partId: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  const part = db.select().from(storyParts).where(eq(storyParts.id, partId)).all()[0]
  if (!chapter || !part) throw new Error('Chapter or part not found')
  db.update(chapters).set({
    volumeId: part.volumeId,
    partId: part.id,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
  db.update(chapterSegments).set({
    volumeId: part.volumeId,
    partId: part.id,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterSegments.chapterId, chapterId)).run()
  syncPartRanges(chapter.novelId)
  syncTimelineStructureAnchors(chapter.novelId)
  markNovelContextChanged(chapter.novelId, 'Story structure changed')
}

export function createChapterSegment(
  chapterId: number,
  data: Partial<{
    title: string
    segmentType: string
    purpose: string
    timeAnchor: string
    locationName: string
    presentCharacterIdsJson: string
    linkedItemIdsJson: string
    inputState: string
    outputState: string
    summary: string
    content: string
    riskTagsJson: string
    status: string
  }>,
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throw new Error('Chapter not found')
  ensureStoryStructure(chapter.novelId)
  const nextOrder = (listChapterSegments(chapterId).at(-1)?.segmentOrder || 0) + 1
  const result = db.insert(chapterSegments).values({
    novelId: chapter.novelId,
    chapterId,
    volumeId: chapter.volumeId ?? null,
    partId: chapter.partId ?? null,
    segmentOrder: nextOrder,
    title: asText(data.title) || `场景 ${nextOrder}`,
    segmentType: asText(data.segmentType) || 'scene',
    purpose: asText(data.purpose),
    timeAnchor: asText(data.timeAnchor),
    locationName: asText(data.locationName),
    presentCharacterIdsJson: data.presentCharacterIdsJson || JSON.stringify([]),
    linkedItemIdsJson: data.linkedItemIdsJson || JSON.stringify([]),
    inputState: asText(data.inputState),
    outputState: asText(data.outputState),
    summary: asText(data.summary),
    content: data.content || '',
    riskTagsJson: data.riskTagsJson || stringifyStringArray([]),
    status: asText(data.status) || 'planned',
  }).run()
  syncChapterSegmentMetadata(chapter.novelId)
  markNovelContextChanged(chapter.novelId, 'Chapter segments changed')
  return Number(result.lastInsertRowid)
}

export function updateChapterSegment(
  id: number,
  data: Partial<{
    title: string
    segmentType: string
    purpose: string
    timeAnchor: string
    locationName: string
    presentCharacterIdsJson: string
    linkedItemIdsJson: string
    inputState: string
    outputState: string
    summary: string
    content: string
    riskTagsJson: string
    status: string
  }>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const current = db.select().from(chapterSegments).where(eq(chapterSegments.id, id)).all()[0]
  if (!current) throw new Error('Segment not found')
  db.update(chapterSegments).set({
    title: data.title !== undefined ? asText(data.title) : current.title,
    segmentType: data.segmentType !== undefined ? asText(data.segmentType) : current.segmentType,
    purpose: data.purpose !== undefined ? asText(data.purpose) : current.purpose,
    timeAnchor: data.timeAnchor !== undefined ? asText(data.timeAnchor) : current.timeAnchor,
    locationName: data.locationName !== undefined ? asText(data.locationName) : current.locationName,
    presentCharacterIdsJson: data.presentCharacterIdsJson ?? current.presentCharacterIdsJson,
    linkedItemIdsJson: data.linkedItemIdsJson ?? current.linkedItemIdsJson,
    inputState: data.inputState !== undefined ? asText(data.inputState) : current.inputState,
    outputState: data.outputState !== undefined ? asText(data.outputState) : current.outputState,
    summary: data.summary !== undefined ? asText(data.summary) : current.summary,
    content: data.content !== undefined ? data.content : current.content,
    riskTagsJson: data.riskTagsJson ?? current.riskTagsJson,
    status: data.status !== undefined ? asText(data.status) : current.status,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapterSegments.id, id)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(current.novelId, 'Chapter segments changed')
  }
}

export function deleteChapterSegment(id: number) {
  const db = getDb()
  const current = db.select().from(chapterSegments).where(eq(chapterSegments.id, id)).all()[0]
  if (!current) return
  const siblings = listChapterSegments(current.chapterId)
  if (siblings.length <= 1) {
    throw new Error('A chapter must keep at least one segment')
  }
  markTimelineEventsSegmentAnchorInvalid(id)
  db.delete(chapterSegments).where(eq(chapterSegments.id, id)).run()
  const remaining = listChapterSegments(current.chapterId)
  remaining.forEach((segment, index) => {
    db.update(chapterSegments).set({
      segmentOrder: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.id, segment.id)).run()
  })
  syncChapterSegmentMetadata(current.novelId)
  syncTimelineStructureAnchors(current.novelId)
  markNovelContextChanged(current.novelId, 'Chapter segments changed')
}

export function reorderChapterSegments(chapterId: number, orderedIds: number[]) {
  const db = getDb()
  const segments = listChapterSegments(chapterId)
  if (segments.length !== orderedIds.length) {
    throw new Error('Segment count mismatch')
  }
  const existingIds = new Set(segments.map((segment) => segment.id))
  if (orderedIds.some((id) => !existingIds.has(id))) {
    throw new Error('Segment ids are invalid')
  }
  orderedIds.forEach((id, index) => {
    db.update(chapterSegments).set({
      segmentOrder: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.id, id)).run()
  })
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (chapter) {
    markNovelContextChanged(chapter.novelId, 'Chapter segments changed')
  }
}

export function compileChapterFromSegments(
  chapterId: number,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throw new Error('Chapter not found')
  ensureStoryStructure(chapter.novelId)
  const segments = listChapterSegments(chapterId)
  const compiledContent = segments
    .map((segment) => segment.content || '')
    .filter((content) => content.trim().length > 0)
    .join('\n\n')

  db.update(chapters).set({
    content: compiledContent,
    wordCount: countWords(compiledContent),
    compiledFromSegments: 1,
    segmentCount: segments.length,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()

  if (!options.skipContextTracking) {
    markNovelContextChanged(chapter.novelId, 'Chapter segments compiled')
  }

  return db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0] || null
}

export function syncChapterToSegments(
  chapterId: number,
  content: string,
  options: { createIfMissing?: boolean } = {},
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throw new Error('Chapter not found')
  ensureStoryStructure(chapter.novelId)
  const segments = listChapterSegments(chapterId)
  if (segments.length === 0 && options.createIfMissing) {
    createDefaultSegment(chapter, { content })
    syncChapterSegmentMetadata(chapter.novelId)
    return
  }

  if (segments.length === 1) {
    updateChapterSegment(segments[0].id, {
      title: segments[0].title || chapter.title || `Chapter ${chapter.chapterNum}`,
      content,
      summary: chapter.summary || segments[0].summary || '',
      purpose: segments[0].purpose || chapter.outline || chapter.summary || '',
      status: 'draft',
    }, { skipContextTracking: true })
    db.update(chapters).set({
      compiledFromSegments: 1,
      segmentCount: 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    return
  }

  db.update(chapters).set({
    compiledFromSegments: 0,
    segmentCount: segments.length,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
}

export function buildStructureLabel(novelId: number, chapterId: number): string {
  ensureStoryStructure(novelId)
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return ''
  const volume = chapter.volumeId
    ? db.select().from(storyVolumes).where(eq(storyVolumes.id, chapter.volumeId)).all()[0]
    : null
  const part = chapter.partId
    ? db.select().from(storyParts).where(eq(storyParts.id, chapter.partId)).all()[0]
    : null
  const pieces = [
    volume ? getVolumeLabel(volume) : '',
    part ? getPartLabel(part) : '',
    `第${chapter.chapterNum}章`,
  ].filter(Boolean)
  return pieces.join(' / ')
}

export function getScopeCheckpoint(
  novelId: number,
  scopeType: CheckpointScope,
  scopeId?: number | null,
) {
  return getCheckpointRows(novelId).find((checkpoint) =>
    checkpoint.scopeType === scopeType
    && (scopeType === 'novel' ? true : checkpoint.scopeId === (scopeId ?? null))) || null
}

interface StructurePathInput {
  novelId: number
  volumeId?: number
  partId?: number
  chapterId?: number
  segmentId?: number
}

function normalizePage(page?: number, pageSize?: number, fallbackPageSize = 20) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function findPageByIndex(index: number, pageSize: number) {
  return index >= 0 ? Math.floor(index / pageSize) + 1 : 1
}

export function listStructureVolumes(novelId: number) {
  ensureStoryStructure(novelId)
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT
      v.id AS id,
      v.novel_id AS novelId,
      v.volume_number AS volumeNumber,
      v.title AS title,
      v.summary AS summary,
      v.target_words AS targetWords,
      v.status AS status,
      v.created_at AS createdAt,
      v.updated_at AS updatedAt,
      COALESCE((SELECT SUM(c.word_count) FROM chapters c WHERE c.volume_id = v.id), 0) AS wordCount,
      (SELECT COUNT(*) FROM story_parts p WHERE p.volume_id = v.id) AS partCount,
      (SELECT COUNT(*) FROM chapters c WHERE c.volume_id = v.id) AS chapterCount,
      (SELECT COUNT(*) FROM chapter_segments s WHERE s.volume_id = v.id) AS segmentCount,
      (SELECT COUNT(*) FROM timeline_events e WHERE e.novel_id = v.novel_id AND e.volume_id = v.id) AS linkedTimelineEventCount
    FROM story_volumes v
    WHERE v.novel_id = ?
    ORDER BY v.volume_number ASC, v.id ASC
  `).all(novelId) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    ...row,
    novelId: Number(row.novelId),
    volumeNumber: Number(row.volumeNumber),
    targetWords: Number(row.targetWords || 0),
    wordCount: Number(row.wordCount || 0),
    partCount: Number(row.partCount || 0),
    chapterCount: Number(row.chapterCount || 0),
    segmentCount: Number(row.segmentCount || 0),
    linkedTimelineEventCount: Number(row.linkedTimelineEventCount || 0),
  }))
}

export function listStructurePartsPage(volumeId: number, page?: number, pageSize?: number) {
  const db = getDb()
  const volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, volumeId)).all()[0]
  if (!volume) return buildPagedResult([], 1, pageSize || 30, 0)
  ensureStoryStructure(volume.novelId)

  const sqlite = getSqlite()
  const paging = normalizePage(page, pageSize, 30)
  const totalRow = sqlite.prepare('SELECT COUNT(*) AS total FROM story_parts WHERE volume_id = ?').get(volumeId) as { total?: number } | undefined
  const rows = sqlite.prepare(`
    SELECT
      p.id AS id,
      p.novel_id AS novelId,
      p.volume_id AS volumeId,
      p.part_number AS partNumber,
      p.title AS title,
      p.summary AS summary,
      p.target_words AS targetWords,
      p.status AS status,
      p.start_chapter_num AS startChapterNum,
      p.end_chapter_num AS endChapterNum,
      p.created_at AS createdAt,
      p.updated_at AS updatedAt,
      COALESCE((SELECT SUM(c.word_count) FROM chapters c WHERE c.part_id = p.id), 0) AS wordCount,
      (SELECT COUNT(*) FROM chapters c WHERE c.part_id = p.id) AS chapterCount,
      (SELECT COUNT(*) FROM chapter_segments s WHERE s.part_id = p.id) AS segmentCount,
      (SELECT COUNT(*) FROM timeline_events e WHERE e.novel_id = p.novel_id AND e.part_id = p.id) AS linkedTimelineEventCount
    FROM story_parts p
    WHERE p.volume_id = ?
    ORDER BY p.part_number ASC, p.id ASC
    LIMIT ? OFFSET ?
  `).all(volumeId, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map((row) => ({
    ...row,
    novelId: Number(row.novelId),
    volumeId: Number(row.volumeId),
    partNumber: Number(row.partNumber),
    targetWords: Number(row.targetWords || 0),
    startChapterNum: row.startChapterNum == null ? undefined : Number(row.startChapterNum),
    endChapterNum: row.endChapterNum == null ? undefined : Number(row.endChapterNum),
    wordCount: Number(row.wordCount || 0),
    chapterCount: Number(row.chapterCount || 0),
    segmentCount: Number(row.segmentCount || 0),
    linkedTimelineEventCount: Number(row.linkedTimelineEventCount || 0),
  }))

  return buildPagedResult(items, paging.page, paging.pageSize, Number(totalRow?.total || 0))
}

export function listStructureChaptersPage(partId: number, page?: number, pageSize?: number) {
  const db = getDb()
  const part = db.select().from(storyParts).where(eq(storyParts.id, partId)).all()[0]
  if (!part) return buildPagedResult([], 1, pageSize || 50, 0)
  ensureStoryStructure(part.novelId)

  const sqlite = getSqlite()
  const paging = normalizePage(page, pageSize, 50)
  const totalRow = sqlite.prepare('SELECT COUNT(*) AS total FROM chapters WHERE part_id = ?').get(partId) as { total?: number } | undefined
  const rows = sqlite.prepare(`
    SELECT
      c.id AS id,
      c.novel_id AS novelId,
      c.volume_id AS volumeId,
      c.part_id AS partId,
      c.chapter_num AS chapterNum,
      c.title AS title,
      c.outline AS outline,
      c.word_count AS wordCount,
      c.summary AS summary,
      c.status AS status,
      c.target_words AS targetWords,
      c.compiled_from_segments AS compiledFromSegments,
      c.segment_count AS segmentCount,
      c.context_version AS contextVersion,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt,
      (
        SELECT COUNT(*)
        FROM timeline_events e
        LEFT JOIN chapters cs ON cs.id = e.chapter_start_id
        LEFT JOIN chapters ce ON ce.id = e.chapter_end_id
        WHERE e.novel_id = c.novel_id
          AND (
            e.chapter_start_id = c.id
            OR e.chapter_end_id = c.id
            OR e.segment_id IN (SELECT s2.id FROM chapter_segments s2 WHERE s2.chapter_id = c.id)
            OR (cs.chapter_num IS NOT NULL AND ce.chapter_num IS NOT NULL AND c.chapter_num BETWEEN cs.chapter_num AND ce.chapter_num)
            OR (cs.chapter_num IS NOT NULL AND ce.chapter_num IS NULL AND c.chapter_num = cs.chapter_num)
            OR (ce.chapter_num IS NOT NULL AND cs.chapter_num IS NULL AND c.chapter_num = ce.chapter_num)
          )
      ) AS linkedTimelineEventCount
    FROM chapters c
    WHERE c.part_id = ?
    ORDER BY c.chapter_num ASC, c.id ASC
    LIMIT ? OFFSET ?
  `).all(partId, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map((row) => ({
    ...row,
    novelId: Number(row.novelId),
    volumeId: row.volumeId == null ? undefined : Number(row.volumeId),
    partId: row.partId == null ? undefined : Number(row.partId),
    chapterNum: Number(row.chapterNum),
    wordCount: Number(row.wordCount || 0),
    targetWords: Number(row.targetWords || 0),
    compiledFromSegments: Number(row.compiledFromSegments || 0),
    segmentCount: Number(row.segmentCount || 0),
    contextVersion: Number(row.contextVersion || 0),
    linkedTimelineEventCount: Number(row.linkedTimelineEventCount || 0),
  }))

  return buildPagedResult(items, paging.page, paging.pageSize, Number(totalRow?.total || 0))
}

export function listChapterSegmentsPage(chapterId: number, page?: number, pageSize?: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return buildPagedResult([], 1, pageSize || 80, 0)
  ensureStoryStructure(chapter.novelId)

  const sqlite = getSqlite()
  const paging = normalizePage(page, pageSize, 80)
  const totalRow = sqlite.prepare('SELECT COUNT(*) AS total FROM chapter_segments WHERE chapter_id = ?').get(chapterId) as { total?: number } | undefined
  const rows = sqlite.prepare(`
    SELECT
      s.id AS id,
      s.novel_id AS novelId,
      s.chapter_id AS chapterId,
      s.volume_id AS volumeId,
      s.part_id AS partId,
      s.segment_order AS segmentOrder,
      s.title AS title,
      s.segment_type AS segmentType,
      s.purpose AS purpose,
      s.time_anchor AS timeAnchor,
      s.location_name AS locationName,
      s.summary AS summary,
      s.status AS status,
      s.created_at AS createdAt,
      s.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM timeline_events e WHERE e.novel_id = s.novel_id AND e.segment_id = s.id) AS linkedTimelineEventCount
    FROM chapter_segments s
    WHERE s.chapter_id = ?
    ORDER BY s.segment_order ASC, s.id ASC
    LIMIT ? OFFSET ?
  `).all(chapterId, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map((row) => ({
    ...row,
    novelId: Number(row.novelId),
    chapterId: Number(row.chapterId),
    volumeId: row.volumeId == null ? undefined : Number(row.volumeId),
    partId: row.partId == null ? undefined : Number(row.partId),
    segmentOrder: Number(row.segmentOrder),
    linkedTimelineEventCount: Number(row.linkedTimelineEventCount || 0),
  }))

  return buildPagedResult(items, paging.page, paging.pageSize, Number(totalRow?.total || 0))
}

export function listStoryCheckpointsPage(
  filters: { novelId: number; scopeType?: CheckpointScope; scopeId?: number },
  page?: number,
  pageSize?: number,
) {
  const paging = normalizePage(page, pageSize, 12)
  const rows = getCheckpointRows(filters.novelId)
    .filter((checkpoint) => {
      if (filters.scopeType && checkpoint.scopeType !== filters.scopeType) return false
      if (typeof filters.scopeId === 'number' && checkpoint.scopeId !== filters.scopeId) return false
      return true
    })
  const items = rows.slice(paging.offset, paging.offset + paging.pageSize)
  return buildPagedResult(items, paging.page, paging.pageSize, rows.length)
}

export function resolveStructurePath(filters: StructurePathInput) {
  ensureStoryStructure(filters.novelId)
  const volumes = getVolumeRows(filters.novelId)
  const parts = getPartRows(filters.novelId)
  const chaptersByNovel = getChapterRows(filters.novelId)
  const segments = getSegmentRowsByNovel(filters.novelId)

  const volumePageSize = 20
  const partPageSize = 30
  const chapterPageSize = 50
  const segmentPageSize = 80

  let volumeId = filters.volumeId ?? null
  let partId = filters.partId ?? null
  let chapterId = filters.chapterId ?? null
  let segmentId = filters.segmentId ?? null
  let resolvedLevel: 'novel' | 'volume' | 'part' | 'chapter' | 'segment' = 'novel'

  if (segmentId) {
    const segment = segments.find((item) => item.id === segmentId) || null
    if (segment) {
      segmentId = segment.id
      chapterId = segment.chapterId
      partId = segment.partId ?? partId
      volumeId = segment.volumeId ?? volumeId
      resolvedLevel = 'segment'
    } else {
      segmentId = null
    }
  }

  if (resolvedLevel !== 'segment' && chapterId) {
    const chapter = chaptersByNovel.find((item) => item.id === chapterId) || null
    if (chapter) {
      chapterId = chapter.id
      partId = chapter.partId ?? partId
      volumeId = chapter.volumeId ?? volumeId
      resolvedLevel = 'chapter'
    } else {
      chapterId = null
    }
  }

  if (resolvedLevel !== 'segment' && resolvedLevel !== 'chapter' && partId) {
    const part = parts.find((item) => item.id === partId) || null
    if (part) {
      partId = part.id
      volumeId = part.volumeId
      resolvedLevel = 'part'
    } else {
      partId = null
    }
  }

  if (resolvedLevel === 'novel' && volumeId) {
    const volume = volumes.find((item) => item.id === volumeId) || null
    if (volume) {
      volumeId = volume.id
      resolvedLevel = 'volume'
    } else {
      volumeId = null
    }
  }

  if (!volumeId) {
    volumeId = volumes[0]?.id ?? null
    resolvedLevel = volumeId ? 'volume' : 'novel'
  }

  if (volumeId && !partId) {
    partId = parts.find((item) => item.volumeId === volumeId)?.id ?? null
  }

  if (partId && !chapterId) {
    chapterId = chaptersByNovel.find((item) => item.partId === partId)?.id ?? null
  }

  if (chapterId && !segmentId) {
    segmentId = segments.find((item) => item.chapterId === chapterId)?.id ?? null
  }

  const volumeIndex = Math.max(0, volumes.findIndex((item) => item.id === volumeId))
  const partRows = volumeId ? parts.filter((item) => item.volumeId === volumeId) : []
  const chapterRows = partId ? chaptersByNovel.filter((item) => item.partId === partId) : []
  const segmentRows = chapterId ? segments.filter((item) => item.chapterId === chapterId) : []

  return {
    novelId: filters.novelId,
    volumeId,
    volumeIndex: findPageByIndex(volumeIndex, volumePageSize) - 1,
    partId,
    partPage: findPageByIndex(partRows.findIndex((item) => item.id === partId), partPageSize),
    partPageSize,
    chapterId,
    chapterPage: findPageByIndex(chapterRows.findIndex((item) => item.id === chapterId), chapterPageSize),
    chapterPageSize,
    segmentId,
    segmentPage: findPageByIndex(segmentRows.findIndex((item) => item.id === segmentId), segmentPageSize),
    segmentPageSize,
    resolvedLevel,
  }
}
