import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import {
  chapterSegments,
  chapters,
  novels,
  storyParts,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { markTimelineEventsSegmentAnchorInvalid, syncTimelineStructureAnchors } from './timeline.service'
import type {
  Chapter,
  StoryPart,
  StoryPartReorderOperation,
  StoryVolume,
  StructureBatchApplyResult,
  StructureBatchEditOperation,
  StructureBatchFocus,
  StructureBatchPlan,
  StructureBatchPlanSegmentInput,
  StructureBatchPreview,
  StructureBatchPreviewItem,
} from '../../src/types'

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

function parseStoredStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    return toStringArray(JSON.parse(raw))
  } catch {
    return []
  }
}

function mergeStoredReasons(raw: string | null | undefined, reasons: string[]): string {
  return stringifyStringArray([...parseStoredStringArray(raw), ...reasons])
}

function normalizeIds(values: number[]): number[] {
  return [...new Set(values
    .map((value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0))
    .filter((value) => value > 0))]
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

function getTimelineRows(novelId: number) {
  const db = getDb()
  return db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .all()
}

function getVolumeLabel(volume: { volumeNumber: number; title?: string | null }) {
  return volume.title?.trim() || `第${volume.volumeNumber}卷`
}

function getPartLabel(part: { partNumber: number; title?: string | null }) {
  return part.title?.trim() || `第${part.partNumber}部`
}

function getChapterLabel(chapter: { chapterNum: number; title?: string | null }) {
  return chapter.title?.trim() || `第${chapter.chapterNum}章`
}

function getSegmentLabel(segment: { segmentOrder: number; title?: string | null }) {
  return segment.title?.trim() || `场景 ${String(segment.segmentOrder).padStart(2, '0')}`
}

function getDefaultVolumeTitle(volumeNumber: number): string {
  return `第${volumeNumber}卷`
}

function getDefaultPartTitle(partNumber: number): string {
  return `第${partNumber}部`
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
    const nextSegmentCount = (segmentsByChapter.get(chapter.id) || []).length
    if ((chapter.segmentCount || 0) === nextSegmentCount) continue
    db.update(chapters).set({
      segmentCount: nextSegmentCount,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapter.id)).run()
  }
}

function normalizeVolumeNumbers(novelId: number) {
  const db = getDb()
  const now = new Date().toISOString()
  getVolumeRows(novelId).forEach((volume, index) => {
    const nextNumber = index + 1
    if (volume.volumeNumber === nextNumber) return
    db.update(storyVolumes).set({
      volumeNumber: nextNumber,
      updatedAt: now,
    }).where(eq(storyVolumes.id, volume.id)).run()
  })
}

function normalizePartNumbers(novelId: number) {
  const db = getDb()
  const now = new Date().toISOString()
  const partRows = getPartRows(novelId)
  const volumes = getVolumeRows(novelId)

  for (const volume of volumes) {
    partRows
      .filter((part) => part.volumeId === volume.id)
      .sort((left, right) => left.partNumber - right.partNumber || left.id - right.id)
      .forEach((part, index) => {
        const nextNumber = index + 1
        if (part.partNumber === nextNumber) return
        db.update(storyParts).set({
          partNumber: nextNumber,
          updatedAt: now,
        }).where(eq(storyParts.id, part.id)).run()
      })
  }
}

function normalizeChapterNumbers(novelId: number) {
  const db = getDb()
  const now = new Date().toISOString()
  const volumeRows = getVolumeRows(novelId)
  const partRows = getPartRows(novelId)
  const chapterRows = getChapterRows(novelId)
  let nextChapterNum = 1

  for (const volume of volumeRows) {
    const volumeParts = partRows
      .filter((part) => part.volumeId === volume.id)
      .sort((left, right) => left.partNumber - right.partNumber || left.id - right.id)

    for (const part of volumeParts) {
      const partChapters = chapterRows
        .filter((chapter) => chapter.partId === part.id)
        .sort((left, right) => left.chapterNum - right.chapterNum || left.id - right.id)

      for (const chapter of partChapters) {
        if (chapter.chapterNum === nextChapterNum) {
          nextChapterNum += 1
          continue
        }

        db.update(chapters).set({
          chapterNum: nextChapterNum,
          updatedAt: now,
        }).where(eq(chapters.id, chapter.id)).run()
        nextChapterNum += 1
      }
    }
  }
}

function normalizeSegmentOrders(chapterId: number) {
  const db = getDb()
  const now = new Date().toISOString()
  db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
    .forEach((segment, index) => {
      const nextOrder = index + 1
      if (segment.segmentOrder === nextOrder) return
      db.update(chapterSegments).set({
        segmentOrder: nextOrder,
        updatedAt: now,
      }).where(eq(chapterSegments.id, segment.id)).run()
    })
}

function markNovelContextChangedInline(novelId: number, reason: string) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在。')

  const nextVersion = (novel.contextVersion || 1) + 1
  const now = new Date().toISOString()
  db.update(novels).set({
    contextVersion: nextVersion,
    updatedAt: now,
  }).where(eq(novels.id, novelId)).run()

  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  for (const chapter of chapterRows) {
    db.update(chapters).set({
      staleReasonJson: mergeStoredReasons(chapter.staleReasonJson, [reason]),
      updatedAt: now,
    }).where(eq(chapters.id, chapter.id)).run()
  }
}

function runStructureTransaction(novelId: number, mutate: () => void) {
  getSqlite().transaction(() => {
    mutate()
    syncChapterSegmentMetadata(novelId)
    syncPartRanges(novelId)
    syncTimelineStructureAnchors(novelId)
    markNovelContextChangedInline(novelId, 'Story structure changed')
  })()
}

function countLinkedTimelineEvents(
  novelId: number,
  volumeIds: number[],
  partIds: number[],
  chapterIds: number[],
  segmentIds: number[],
) {
  const volumeIdSet = new Set(volumeIds)
  const partIdSet = new Set(partIds)
  const chapterIdSet = new Set(chapterIds)
  const segmentIdSet = new Set(segmentIds)

  return getTimelineRows(novelId)
    .filter((row) => (
      (row.volumeId != null && volumeIdSet.has(row.volumeId))
      || (row.partId != null && partIdSet.has(row.partId))
      || (row.chapterStartId != null && chapterIdSet.has(row.chapterStartId))
      || (row.chapterEndId != null && chapterIdSet.has(row.chapterEndId))
      || (row.segmentId != null && segmentIdSet.has(row.segmentId))
    ))
    .length
}

function collectVolumeImpact(novelId: number, volumeIds: number[]) {
  const selectedVolumeIds = normalizeIds(volumeIds)
  const volumeIdSet = new Set(selectedVolumeIds)
  const partIds = getPartRows(novelId)
    .filter((part) => volumeIdSet.has(part.volumeId))
    .map((part) => part.id)
  const partIdSet = new Set(partIds)
  const chapterIds = getChapterRows(novelId)
    .filter((chapter) => (chapter.partId != null && partIdSet.has(chapter.partId)) || (chapter.volumeId != null && volumeIdSet.has(chapter.volumeId)))
    .map((chapter) => chapter.id)
  const chapterIdSet = new Set(chapterIds)
  const segmentIds = getSegmentRowsByNovel(novelId)
    .filter((segment) => chapterIdSet.has(segment.chapterId))
    .map((segment) => segment.id)

  return {
    selectedCount: selectedVolumeIds.length,
    volumeCount: selectedVolumeIds.length,
    partCount: partIds.length,
    chapterCount: chapterIds.length,
    segmentCount: segmentIds.length,
    timelineEventCount: countLinkedTimelineEvents(novelId, selectedVolumeIds, partIds, chapterIds, segmentIds),
  }
}

function collectPartImpact(novelId: number, partIds: number[]) {
  const selectedPartIds = normalizeIds(partIds)
  const partIdSet = new Set(selectedPartIds)
  const selectedVolumeIds = [...new Set(getPartRows(novelId)
    .filter((part) => partIdSet.has(part.id))
    .map((part) => part.volumeId))]
  const chapterIds = getChapterRows(novelId)
    .filter((chapter) => chapter.partId != null && partIdSet.has(chapter.partId))
    .map((chapter) => chapter.id)
  const chapterIdSet = new Set(chapterIds)
  const segmentIds = getSegmentRowsByNovel(novelId)
    .filter((segment) => chapterIdSet.has(segment.chapterId))
    .map((segment) => segment.id)

  return {
    selectedCount: selectedPartIds.length,
    volumeCount: selectedVolumeIds.length,
    partCount: selectedPartIds.length,
    chapterCount: chapterIds.length,
    segmentCount: segmentIds.length,
    timelineEventCount: countLinkedTimelineEvents(novelId, selectedVolumeIds, selectedPartIds, chapterIds, segmentIds),
  }
}

function collectChapterImpact(novelId: number, chapterIds: number[]) {
  const selectedChapterIds = normalizeIds(chapterIds)
  const chapterIdSet = new Set(selectedChapterIds)
  const chapterRows = getChapterRows(novelId)
    .filter((chapter) => chapterIdSet.has(chapter.id))
  const volumeIds = [...new Set(chapterRows.map((chapter) => chapter.volumeId).filter((value): value is number => typeof value === 'number'))]
  const partIds = [...new Set(chapterRows.map((chapter) => chapter.partId).filter((value): value is number => typeof value === 'number'))]
  const segmentIds = getSegmentRowsByNovel(novelId)
    .filter((segment) => chapterIdSet.has(segment.chapterId))
    .map((segment) => segment.id)

  return {
    selectedCount: selectedChapterIds.length,
    volumeCount: volumeIds.length,
    partCount: partIds.length,
    chapterCount: selectedChapterIds.length,
    segmentCount: segmentIds.length,
    timelineEventCount: countLinkedTimelineEvents(novelId, volumeIds, partIds, selectedChapterIds, segmentIds),
  }
}

function collectSegmentImpact(novelId: number, segmentIds: number[]) {
  const selectedSegmentIds = normalizeIds(segmentIds)
  const segmentIdSet = new Set(selectedSegmentIds)
  const segmentRows = getSegmentRowsByNovel(novelId)
    .filter((segment) => segmentIdSet.has(segment.id))
  const volumeIds = [...new Set(segmentRows.map((segment) => segment.volumeId).filter((value): value is number => typeof value === 'number'))]
  const partIds = [...new Set(segmentRows.map((segment) => segment.partId).filter((value): value is number => typeof value === 'number'))]
  const chapterIds = [...new Set(segmentRows.map((segment) => segment.chapterId))]

  return {
    selectedCount: selectedSegmentIds.length,
    volumeCount: volumeIds.length,
    partCount: partIds.length,
    chapterCount: chapterIds.length,
    segmentCount: selectedSegmentIds.length,
    timelineEventCount: countLinkedTimelineEvents(novelId, volumeIds, partIds, chapterIds, selectedSegmentIds),
  }
}

function buildPreviewItem(item: Omit<StructureBatchPreviewItem, 'warnings'> & { warnings?: string[] }): StructureBatchPreviewItem {
  return {
    ...item,
    warnings: item.warnings || [],
  }
}

function deleteChapterCascade(novelId: number, chapterIds: number[]) {
  const db = getDb()
  const selectedChapterIds = normalizeIds(chapterIds)
  if (selectedChapterIds.length === 0) return

  const chapterIdSet = new Set(selectedChapterIds)
  getSegmentRowsByNovel(novelId)
    .filter((segment) => chapterIdSet.has(segment.chapterId))
    .forEach((segment) => {
      markTimelineEventsSegmentAnchorInvalid(segment.id)
      db.delete(chapterSegments).where(eq(chapterSegments.id, segment.id)).run()
    })

  selectedChapterIds.forEach((chapterId) => {
    db.delete(chapters).where(eq(chapters.id, chapterId)).run()
  })
}

function deletePartCascade(novelId: number, partIds: number[]) {
  const db = getDb()
  const selectedPartIds = normalizeIds(partIds)
  if (selectedPartIds.length === 0) return

  const partIdSet = new Set(selectedPartIds)
  const chapterIds = getChapterRows(novelId)
    .filter((chapter) => chapter.partId != null && partIdSet.has(chapter.partId))
    .map((chapter) => chapter.id)
  deleteChapterCascade(novelId, chapterIds)

  selectedPartIds.forEach((partId) => {
    db.delete(storyParts).where(eq(storyParts.id, partId)).run()
  })
}

function deleteVolumeCascade(novelId: number, volumeIds: number[]) {
  const db = getDb()
  const selectedVolumeIds = normalizeIds(volumeIds)
  if (selectedVolumeIds.length === 0) return

  const volumeIdSet = new Set(selectedVolumeIds)
  const partIds = getPartRows(novelId)
    .filter((part) => volumeIdSet.has(part.volumeId))
    .map((part) => part.id)
  deletePartCascade(novelId, partIds)

  selectedVolumeIds.forEach((volumeId) => {
    db.delete(storyVolumes).where(eq(storyVolumes.id, volumeId)).run()
  })
}

function applyDeleteVolumes(novelId: number, volumeIds: number[]): StructureBatchApplyResult {
  const selectedVolumeIds = normalizeIds(volumeIds)
  if (selectedVolumeIds.length === 0) throw new Error('请至少选择一卷。')

  const existingIds = new Set(getVolumeRows(novelId).map((volume) => volume.id))
  if (selectedVolumeIds.some((volumeId) => !existingIds.has(volumeId))) {
    throw new Error('存在无效的卷 ID。')
  }

  deleteVolumeCascade(novelId, selectedVolumeIds)
  normalizeVolumeNumbers(novelId)
  normalizePartNumbers(novelId)
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已删除 ${selectedVolumeIds.length} 卷。`,
    firstChapterId: null,
  }
}

function applyDeleteParts(novelId: number, partIds: number[]): StructureBatchApplyResult {
  const selectedPartIds = normalizeIds(partIds)
  if (selectedPartIds.length === 0) throw new Error('请至少选择一部。')

  const existingIds = new Set(getPartRows(novelId).map((part) => part.id))
  if (selectedPartIds.some((partId) => !existingIds.has(partId))) {
    throw new Error('存在无效的部 ID。')
  }

  deletePartCascade(novelId, selectedPartIds)
  normalizePartNumbers(novelId)
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已删除 ${selectedPartIds.length} 部。`,
    firstChapterId: null,
  }
}

function applyDeleteChapters(novelId: number, chapterIds: number[]): StructureBatchApplyResult {
  const selectedChapterIds = normalizeIds(chapterIds)
  if (selectedChapterIds.length === 0) throw new Error('请至少选择一章。')

  const existingIds = new Set(getChapterRows(novelId).map((chapter) => chapter.id))
  if (selectedChapterIds.some((chapterId) => !existingIds.has(chapterId))) {
    throw new Error('存在无效的章节 ID。')
  }

  deleteChapterCascade(novelId, selectedChapterIds)
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已删除 ${selectedChapterIds.length} 章。`,
    firstChapterId: null,
  }
}

function applyDeleteSegments(novelId: number, segmentIds: number[]): StructureBatchApplyResult {
  const db = getDb()
  const selectedSegmentIds = normalizeIds(segmentIds)
  if (selectedSegmentIds.length === 0) throw new Error('请至少选择一个场景。')

  const selectedIdSet = new Set(selectedSegmentIds)
  const segmentRows = getSegmentRowsByNovel(novelId)
  const selectedSegments = segmentRows.filter((segment) => selectedIdSet.has(segment.id))
  if (selectedSegments.length !== selectedSegmentIds.length) {
    throw new Error('存在无效的场景 ID。')
  }

  const removalCountByChapter = new Map<number, number>()
  selectedSegments.forEach((segment) => {
    removalCountByChapter.set(segment.chapterId, (removalCountByChapter.get(segment.chapterId) || 0) + 1)
  })

  const chapterById = new Map(getChapterRows(novelId).map((chapter) => [chapter.id, chapter]))
  for (const [chapterId, removeCount] of removalCountByChapter) {
    const total = segmentRows.filter((segment) => segment.chapterId === chapterId).length
    if (total - removeCount <= 0) {
      const chapter = chapterById.get(chapterId)
      throw new Error(`${chapter ? getChapterLabel(chapter) : '当前章节'} 至少需要保留一个场景。`)
    }
  }

  selectedSegments.forEach((segment) => {
    markTimelineEventsSegmentAnchorInvalid(segment.id)
    db.delete(chapterSegments).where(eq(chapterSegments.id, segment.id)).run()
  })
  Array.from(removalCountByChapter.keys()).forEach((chapterId) => normalizeSegmentOrders(chapterId))

  return {
    novelId,
    message: `已删除 ${selectedSegmentIds.length} 个场景。`,
    firstChapterId: null,
  }
}

function applyMoveParts(novelId: number, partIds: number[], targetVolumeId: number): StructureBatchApplyResult {
  const db = getDb()
  const selectedPartIds = normalizeIds(partIds)
  if (selectedPartIds.length === 0) throw new Error('请至少选择一部。')

  const volume = getVolumeRows(novelId).find((item) => item.id === targetVolumeId)
  if (!volume) throw new Error('目标卷不存在。')

  const partRows = getPartRows(novelId)
  const partById = new Map(partRows.map((part) => [part.id, part]))
  if (selectedPartIds.some((partId) => !partById.has(partId))) {
    throw new Error('存在无效的部 ID。')
  }

  const selectedParts = selectedPartIds
    .map((partId) => partById.get(partId))
    .filter((part): part is NonNullable<typeof partRows[number]> => Boolean(part))
    .sort((left, right) => left.partNumber - right.partNumber || left.id - right.id)

  const selectedIdSet = new Set(selectedPartIds)
  let nextPartNumber = partRows
    .filter((part) => part.volumeId === targetVolumeId && !selectedIdSet.has(part.id))
    .reduce((max, part) => Math.max(max, part.partNumber), 0) + 1

  for (const part of selectedParts) {
    db.update(storyParts).set({
      volumeId: targetVolumeId,
      partNumber: nextPartNumber,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, part.id)).run()
    nextPartNumber += 1

    db.update(chapters).set({
      volumeId: targetVolumeId,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.partId, part.id)).run()
    db.update(chapterSegments).set({
      volumeId: targetVolumeId,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.partId, part.id)).run()
  }

  normalizePartNumbers(novelId)
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已把 ${selectedParts.length} 部移动到 ${getVolumeLabel(volume)}。`,
    firstChapterId: null,
    focus: { volumeId: targetVolumeId },
  }
}

function applyMoveChapters(novelId: number, chapterIds: number[], targetPartId: number): StructureBatchApplyResult {
  const db = getDb()
  const selectedChapterIds = normalizeIds(chapterIds)
  if (selectedChapterIds.length === 0) throw new Error('请至少选择一章。')

  const part = getPartRows(novelId).find((item) => item.id === targetPartId)
  if (!part) throw new Error('目标部不存在。')

  const chapterRows = getChapterRows(novelId)
  const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]))
  if (selectedChapterIds.some((chapterId) => !chapterById.has(chapterId))) {
    throw new Error('存在无效的章节 ID。')
  }

  let nextChapterNum = chapterRows.reduce((max, chapter) => Math.max(max, chapter.chapterNum), 0) + 1
  const selectedChapters = selectedChapterIds
    .map((chapterId) => chapterById.get(chapterId))
    .filter((chapter): chapter is NonNullable<typeof chapterRows[number]> => Boolean(chapter))
    .sort((left, right) => left.chapterNum - right.chapterNum || left.id - right.id)

  for (const chapter of selectedChapters) {
    db.update(chapters).set({
      volumeId: part.volumeId,
      partId: part.id,
      chapterNum: nextChapterNum,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapter.id)).run()
    nextChapterNum += 1

    db.update(chapterSegments).set({
      volumeId: part.volumeId,
      partId: part.id,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.chapterId, chapter.id)).run()
  }

  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已把 ${selectedChapters.length} 章移动到 ${getPartLabel(part)}。`,
    firstChapterId: null,
    focus: {
      volumeId: part.volumeId,
      partId: part.id,
      chapterId: selectedChapters[0]?.id,
    },
  }
}

function applyMoveSegments(novelId: number, segmentIds: number[], targetChapterId: number): StructureBatchApplyResult {
  const db = getDb()
  const selectedSegmentIds = normalizeIds(segmentIds)
  if (selectedSegmentIds.length === 0) throw new Error('请至少选择一个场景。')

  const chapterRows = getChapterRows(novelId)
  const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]))
  const targetChapter = chapterById.get(targetChapterId)
  if (!targetChapter) throw new Error('目标章节不存在。')

  const segmentRows = getSegmentRowsByNovel(novelId)
  const segmentById = new Map(segmentRows.map((segment) => [segment.id, segment]))
  if (selectedSegmentIds.some((segmentId) => !segmentById.has(segmentId))) {
    throw new Error('存在无效的场景 ID。')
  }

  const selectedIdSet = new Set(selectedSegmentIds)
  const selectedSegments = selectedSegmentIds
    .map((segmentId) => segmentById.get(segmentId))
    .filter((segment): segment is NonNullable<typeof segmentRows[number]> => Boolean(segment))
    .sort((left, right) => left.segmentOrder - right.segmentOrder || left.id - right.id)

  const removalCountByChapter = new Map<number, number>()
  selectedSegments.forEach((segment) => {
    if (segment.chapterId === targetChapterId) return
    removalCountByChapter.set(segment.chapterId, (removalCountByChapter.get(segment.chapterId) || 0) + 1)
  })

  for (const [chapterId, removeCount] of removalCountByChapter) {
    const total = segmentRows.filter((segment) => segment.chapterId === chapterId).length
    if (total - removeCount <= 0) {
      const chapter = chapterById.get(chapterId)
      throw new Error(`${chapter ? getChapterLabel(chapter) : '当前章节'} 至少需要保留一个场景。`)
    }
  }

  let nextOrder = segmentRows
    .filter((segment) => segment.chapterId === targetChapterId && !selectedIdSet.has(segment.id))
    .length + 1

  for (const segment of selectedSegments) {
    db.update(chapterSegments).set({
      chapterId: targetChapterId,
      volumeId: targetChapter.volumeId ?? null,
      partId: targetChapter.partId ?? null,
      segmentOrder: nextOrder,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.id, segment.id)).run()
    nextOrder += 1
  }

  const affectedChapterIds = new Set([...removalCountByChapter.keys(), targetChapterId])
  affectedChapterIds.forEach((chapterId) => normalizeSegmentOrders(chapterId))

  return {
    novelId,
    message: `已把 ${selectedSegments.length} 个场景移动到 ${getChapterLabel(targetChapter)}。`,
    firstChapterId: null,
    focus: {
      volumeId: targetChapter.volumeId ?? undefined,
      partId: targetChapter.partId ?? undefined,
      chapterId: targetChapter.id,
      segmentId: selectedSegments[0]?.id,
    },
  }
}

function applyReorderVolumes(novelId: number, orderedIds: number[]): StructureBatchApplyResult {
  const db = getDb()
  const normalizedIds = normalizeIds(orderedIds)
  const volumeRows = getVolumeRows(novelId)
  if (volumeRows.length !== normalizedIds.length) {
    throw new Error('卷数量不匹配。')
  }

  const existingIds = new Set(volumeRows.map((volume) => volume.id))
  if (normalizedIds.some((volumeId) => !existingIds.has(volumeId))) {
    throw new Error('存在无效的卷 ID。')
  }

  normalizedIds.forEach((volumeId, index) => {
    db.update(storyVolumes).set({
      volumeNumber: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyVolumes.id, volumeId)).run()
  })
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: '卷顺序已更新。',
    firstChapterId: null,
    focus: { volumeId: normalizedIds[0] },
  }
}

function applyReorderParts(novelId: number, volumeId: number, orderedIds: number[]): StructureBatchApplyResult {
  const db = getDb()
  const volume = getVolumeRows(novelId).find((item) => item.id === volumeId)
  if (!volume) throw new Error('卷不存在。')

  const normalizedIds = normalizeIds(orderedIds)
  const partRows = getPartRows(novelId).filter((part) => part.volumeId === volumeId)
  if (partRows.length !== normalizedIds.length) {
    throw new Error('部分数量不匹配。')
  }

  const existingIds = new Set(partRows.map((part) => part.id))
  if (normalizedIds.some((partId) => !existingIds.has(partId))) {
    throw new Error('存在无效的部 ID。')
  }

  normalizedIds.forEach((partId, index) => {
    db.update(storyParts).set({
      partNumber: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, partId)).run()
  })
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已重排 ${getVolumeLabel(volume)} 下的部顺序。`,
    firstChapterId: null,
    focus: { volumeId, partId: normalizedIds[0] },
  }
}

function applyReorderChapters(novelId: number, partId: number, orderedIds: number[]): StructureBatchApplyResult {
  const db = getDb()
  const part = getPartRows(novelId).find((item) => item.id === partId)
  if (!part) throw new Error('部不存在。')

  const normalizedIds = normalizeIds(orderedIds)
  const chapterRows = getChapterRows(novelId).filter((chapter) => chapter.partId === partId)
  if (chapterRows.length !== normalizedIds.length) {
    throw new Error('章节数量不匹配。')
  }

  const existingIds = new Set(chapterRows.map((chapter) => chapter.id))
  if (normalizedIds.some((chapterId) => !existingIds.has(chapterId))) {
    throw new Error('存在无效的章节 ID。')
  }

  normalizedIds.forEach((chapterId, index) => {
    db.update(chapters).set({
      chapterNum: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
  })
  normalizeChapterNumbers(novelId)

  return {
    novelId,
    message: `已重排 ${getPartLabel(part)} 下的章节顺序。`,
    firstChapterId: null,
    focus: { volumeId: part.volumeId, partId, chapterId: normalizedIds[0] },
  }
}

function applyReorderSegments(novelId: number, chapterId: number, orderedIds: number[]): StructureBatchApplyResult {
  const db = getDb()
  const chapter = getChapterRows(novelId).find((item) => item.id === chapterId)
  if (!chapter) throw new Error('章节不存在。')

  const normalizedIds = normalizeIds(orderedIds)
  const segmentRows = getSegmentRowsByNovel(novelId).filter((segment) => segment.chapterId === chapterId)
  if (segmentRows.length !== normalizedIds.length) {
    throw new Error('场景数量不匹配。')
  }

  const existingIds = new Set(segmentRows.map((segment) => segment.id))
  if (normalizedIds.some((segmentId) => !existingIds.has(segmentId))) {
    throw new Error('存在无效的场景 ID。')
  }

  normalizedIds.forEach((segmentId, index) => {
    db.update(chapterSegments).set({
      segmentOrder: index + 1,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapterSegments.id, segmentId)).run()
  })

  return {
    novelId,
    message: `已重排 ${getChapterLabel(chapter)} 下的场景顺序。`,
    firstChapterId: null,
    focus: {
      volumeId: chapter.volumeId ?? undefined,
      partId: chapter.partId ?? undefined,
      chapterId,
      segmentId: normalizedIds[0],
    },
  }
}

function previewBatchEditOperation(novelId: number, operation: StructureBatchEditOperation): StructureBatchPreviewItem {
  switch (operation.kind) {
    case 'delete_volumes': {
      const impact = collectVolumeImpact(novelId, operation.volumeIds)
      const deletingAll = impact.selectedCount === getVolumeRows(novelId).length
      return buildPreviewItem({
        kind: operation.kind,
        summary: `删除 ${impact.selectedCount} 卷，并一并移除 ${impact.partCount} 部 / ${impact.chapterCount} 章 / ${impact.segmentCount} 个场景。`,
        timelineEffect: 'invalidate',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
        warnings: deletingAll ? ['删除后，结构页下次加载时会自动补一卷空白默认结构。'] : [],
      })
    }
    case 'delete_parts': {
      const impact = collectPartImpact(novelId, operation.partIds)
      return buildPreviewItem({
        kind: operation.kind,
        summary: `删除 ${impact.selectedCount} 部，并一并移除 ${impact.chapterCount} 章 / ${impact.segmentCount} 个场景。`,
        timelineEffect: 'invalidate',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'delete_chapters': {
      const impact = collectChapterImpact(novelId, operation.chapterIds)
      return buildPreviewItem({
        kind: operation.kind,
        summary: `删除 ${impact.selectedCount} 章，并一并移除 ${impact.segmentCount} 个场景。`,
        timelineEffect: 'invalidate',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'delete_segments': {
      const impact = collectSegmentImpact(novelId, operation.segmentIds)
      return buildPreviewItem({
        kind: operation.kind,
        summary: `删除 ${impact.selectedCount} 个场景。`,
        timelineEffect: 'invalidate',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'move_parts': {
      const impact = collectPartImpact(novelId, operation.partIds)
      const volume = getVolumeRows(novelId).find((item) => item.id === operation.targetVolumeId)
      if (!volume) throw new Error('目标卷不存在。')
      const selectedPartSet = new Set(normalizeIds(operation.partIds))
      const warnings = getPartRows(novelId).some((part) => selectedPartSet.has(part.id) && part.volumeId === operation.targetVolumeId)
        ? ['所选部中包含已在目标卷下的记录，提交后会按目标卷尾部重新编号。']
        : []
      return buildPreviewItem({
        kind: operation.kind,
        summary: `把 ${impact.selectedCount} 部移动到 ${getVolumeLabel(volume)}，并带上 ${impact.chapterCount} 章 / ${impact.segmentCount} 个场景。`,
        targetLabel: getVolumeLabel(volume),
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
        warnings,
      })
    }
    case 'move_chapters': {
      const impact = collectChapterImpact(novelId, operation.chapterIds)
      const part = getPartRows(novelId).find((item) => item.id === operation.targetPartId)
      if (!part) throw new Error('目标部不存在。')
      return buildPreviewItem({
        kind: operation.kind,
        summary: `把 ${impact.selectedCount} 章移动到 ${getPartLabel(part)}，目标部会按追加方式重排章节顺序。`,
        targetLabel: getPartLabel(part),
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'move_segments': {
      const impact = collectSegmentImpact(novelId, operation.segmentIds)
      const chapter = getChapterRows(novelId).find((item) => item.id === operation.targetChapterId)
      if (!chapter) throw new Error('目标章节不存在。')
      return buildPreviewItem({
        kind: operation.kind,
        summary: `把 ${impact.selectedCount} 个场景移动到 ${getChapterLabel(chapter)}，并在目标章末尾重排。`,
        targetLabel: getChapterLabel(chapter),
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'reorder_volumes': {
      const impact = collectVolumeImpact(novelId, operation.orderedIds)
      return buildPreviewItem({
        kind: operation.kind,
        summary: `重排 ${impact.selectedCount} 卷的顺序，并同步重算后续章节编号。`,
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'reorder_parts': {
      const impact = collectPartImpact(novelId, operation.orderedIds)
      const volume = getVolumeRows(novelId).find((item) => item.id === operation.volumeId)
      if (!volume) throw new Error('卷不存在。')
      return buildPreviewItem({
        kind: operation.kind,
        summary: `重排 ${getVolumeLabel(volume)} 下的 ${impact.selectedCount} 部，并同步重算章节编号。`,
        targetLabel: getVolumeLabel(volume),
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'reorder_chapters': {
      const impact = collectChapterImpact(novelId, operation.orderedIds)
      const part = getPartRows(novelId).find((item) => item.id === operation.partId)
      if (!part) throw new Error('部不存在。')
      return buildPreviewItem({
        kind: operation.kind,
        summary: `重排 ${getPartLabel(part)} 下的 ${impact.selectedCount} 章。`,
        targetLabel: getPartLabel(part),
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
    case 'reorder_segments': {
      const impact = collectSegmentImpact(novelId, operation.orderedIds)
      const chapter = getChapterRows(novelId).find((item) => item.id === operation.chapterId)
      if (!chapter) throw new Error('章节不存在。')
      return buildPreviewItem({
        kind: operation.kind,
        summary: `重排 ${getChapterLabel(chapter)} 下的 ${impact.selectedCount} 个场景。`,
        targetLabel: getChapterLabel(chapter),
        timelineEffect: 'rebind',
        selectedCount: impact.selectedCount,
        volumeCount: impact.volumeCount,
        partCount: impact.partCount,
        chapterCount: impact.chapterCount,
        segmentCount: impact.segmentCount,
        timelineEventCount: impact.timelineEventCount,
        anchorRiskCount: impact.timelineEventCount,
      })
    }
  }
}

function applyBatchEditOperation(novelId: number, operation: StructureBatchEditOperation): StructureBatchApplyResult {
  switch (operation.kind) {
    case 'delete_volumes':
      return applyDeleteVolumes(novelId, operation.volumeIds)
    case 'delete_parts':
      return applyDeleteParts(novelId, operation.partIds)
    case 'delete_chapters':
      return applyDeleteChapters(novelId, operation.chapterIds)
    case 'delete_segments':
      return applyDeleteSegments(novelId, operation.segmentIds)
    case 'move_parts':
      return applyMoveParts(novelId, operation.partIds, operation.targetVolumeId)
    case 'move_chapters':
      return applyMoveChapters(novelId, operation.chapterIds, operation.targetPartId)
    case 'move_segments':
      return applyMoveSegments(novelId, operation.segmentIds, operation.targetChapterId)
    case 'reorder_volumes':
      return applyReorderVolumes(novelId, operation.orderedIds)
    case 'reorder_parts':
      return applyReorderParts(novelId, operation.volumeId, operation.orderedIds)
    case 'reorder_chapters':
      return applyReorderChapters(novelId, operation.partId, operation.orderedIds)
    case 'reorder_segments':
      return applyReorderSegments(novelId, operation.chapterId, operation.orderedIds)
  }
}

export function previewStructureBatchEdit(novelId: number, operations: StructureBatchEditOperation[]): StructureBatchPreview {
  const safeOperations = Array.isArray(operations) ? operations : []
  if (safeOperations.length === 0) {
    throw new Error('请至少提供一个结构批量操作。')
  }

  const items = safeOperations.map((operation) => previewBatchEditOperation(novelId, operation))
  return {
    novelId,
    summary: items.map((item) => item.summary).join('；'),
    items,
    warnings: [...new Set(items.flatMap((item) => item.warnings))],
  }
}

export function applyStructureBatchEdit(novelId: number, operations: StructureBatchEditOperation[]): StructureBatchApplyResult {
  const safeOperations = Array.isArray(operations) ? operations : []
  if (safeOperations.length === 0) {
    throw new Error('请至少提供一个结构批量操作。')
  }

  let latestResult: StructureBatchApplyResult = {
    novelId,
    message: '结构已更新。',
    firstChapterId: null,
  }

  runStructureTransaction(novelId, () => {
    safeOperations.forEach((operation) => {
      latestResult = applyBatchEditOperation(novelId, operation)
    })
  })

  return latestResult
}

function createStructureSegmentFromPlan(
  chapterRow: Chapter,
  segment: StructureBatchPlanSegmentInput,
  segmentOrder: number,
) {
  const db = getDb()
  const result = db.insert(chapterSegments).values({
    novelId: chapterRow.novelId,
    chapterId: chapterRow.id,
    volumeId: chapterRow.volumeId ?? null,
    partId: chapterRow.partId ?? null,
    segmentOrder,
    title: asText(segment.title) || getSegmentLabel({ segmentOrder }),
    segmentType: asText(segment.segmentType) || 'scene',
    purpose: asText(segment.purpose),
    timeAnchor: asText(segment.timeAnchor),
    locationName: asText(segment.locationName),
    presentCharacterIdsJson: JSON.stringify([]),
    linkedItemIdsJson: JSON.stringify([]),
    inputState: asText(segment.inputState),
    outputState: asText(segment.outputState),
    summary: asText(segment.summary),
    content: segment.content || '',
    riskTagsJson: stringifyStringArray([]),
    status: asText(segment.status) || 'planned',
  }).run()
  return Number(result.lastInsertRowid)
}

export function applyStructureBatchPlan(novelId: number, plan: StructureBatchPlan): StructureBatchApplyResult {
  const safePlan = plan && Array.isArray(plan.volumes) ? plan : { summary: '', volumes: [] }
  if (safePlan.volumes.length === 0) {
    throw new Error('当前没有可追加的卷规划。')
  }

  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在。')

  let firstChapterId: number | null = null
  let focus: StructureBatchFocus | undefined

  runStructureTransaction(novelId, () => {
    let nextVolumeNumber = (getVolumeRows(novelId).at(-1)?.volumeNumber || 0) + 1
    let nextChapterNum = (getChapterRows(novelId).at(-1)?.chapterNum || 0) + 1

    safePlan.volumes.forEach((volumeInput) => {
      const volumeInsert = db.insert(storyVolumes).values({
        novelId,
        volumeNumber: nextVolumeNumber,
        title: asText(volumeInput.title) || getDefaultVolumeTitle(nextVolumeNumber),
        summary: asText(volumeInput.summary),
        targetWords: typeof volumeInput.targetWords === 'number' ? volumeInput.targetWords : 0,
        status: volumeInput.status || 'planning',
      }).run()
      const volumeId = Number(volumeInsert.lastInsertRowid)
      nextVolumeNumber += 1

      const parts = Array.isArray(volumeInput.parts) ? volumeInput.parts : []
      parts.forEach((partInput, partIndex) => {
        const partNumber = partIndex + 1
        const partInsert = db.insert(storyParts).values({
          novelId,
          volumeId,
          partNumber,
          title: asText(partInput.title) || getDefaultPartTitle(partNumber),
          summary: asText(partInput.summary),
          targetWords: typeof partInput.targetWords === 'number' ? partInput.targetWords : 0,
          status: partInput.status || 'planning',
        }).run()
        const partId = Number(partInsert.lastInsertRowid)

        const chaptersFromPlan = Array.isArray(partInput.chapters) ? partInput.chapters : []
        chaptersFromPlan.forEach((chapterInput) => {
          const chapterInsert = db.insert(chapters).values({
            novelId,
            volumeId,
            partId,
            chapterNum: nextChapterNum,
            title: asText(chapterInput.title) || `第${nextChapterNum}章`,
            outline: asText(chapterInput.outline),
            scenePlanJson: '',
            content: '',
            wordCount: 0,
            summary: '',
            nextChapterSeed: '',
            continuityStateJson: '',
            reviewNotesJson: '',
            status: chapterInput.status || 'outline',
            aiScoreJson: '',
            arcId: null,
            targetWords: typeof chapterInput.targetWords === 'number' ? chapterInput.targetWords : 3000,
            emotionTone: '',
            compiledFromSegments: 0,
            segmentCount: 0,
            contextVersion: novel.contextVersion || 1,
            staleReasonJson: JSON.stringify([]),
          }).run()

          const chapterId = Number(chapterInsert.lastInsertRowid)
          const chapterRow = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
          if (!chapterRow) throw new Error('新章节写入后读取失败。')

          if (!firstChapterId) {
            firstChapterId = chapterId
            focus = { volumeId, partId, chapterId }
          }

          nextChapterNum += 1

          const segmentsFromPlan = Array.isArray(chapterInput.segments) ? chapterInput.segments : []
          if (segmentsFromPlan.length === 0) {
            createStructureSegmentFromPlan(chapterRow, {
              title: chapterRow.title || `第${chapterRow.chapterNum}章`,
              purpose: chapterRow.outline || '',
              status: 'planned',
            }, 1)
            return
          }

          segmentsFromPlan.forEach((segmentInput, segmentIndex) => {
            createStructureSegmentFromPlan(chapterRow, segmentInput, segmentIndex + 1)
          })
        })
      })
    })
  })

  return {
    novelId,
    message: '卷 / 部 / 章 / 场景批量规划已追加到结构页。',
    firstChapterId,
    focus,
  }
}

export function deleteStoryVolumeTransactional(id: number) {
  const volume = getDb().select().from(storyVolumes).where(eq(storyVolumes.id, id)).all()[0]
  if (!volume) return
  const result = applyStructureBatchEdit(volume.novelId, [{ kind: 'delete_volumes', volumeIds: [id] }])
  void result
}

export function deleteStoryPartTransactional(id: number) {
  const part = getDb().select().from(storyParts).where(eq(storyParts.id, id)).all()[0]
  if (!part) return
  const result = applyStructureBatchEdit(part.novelId, [{ kind: 'delete_parts', partIds: [id] }])
  void result
}

export function assignChapterToPartTransactional(chapterId: number, partId: number) {
  const chapter = getDb().select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throw new Error('章节不存在。')
  const result = applyStructureBatchEdit(chapter.novelId, [{ kind: 'move_chapters', chapterIds: [chapterId], targetPartId: partId }])
  void result
}

export function reorderStoryVolumesTransactional(novelId: number, orderedIds: number[]) {
  const result = applyStructureBatchEdit(novelId, [{ kind: 'reorder_volumes', orderedIds }])
  void result
}

export function reorderStoryPartsInVolumeTransactional(volumeId: number, orderedIds: number[]) {
  const volume = getDb().select().from(storyVolumes).where(eq(storyVolumes.id, volumeId)).all()[0]
  if (!volume) throw new Error('卷不存在。')
  const result = applyStructureBatchEdit(volume.novelId, [{ kind: 'reorder_parts', volumeId, orderedIds }])
  void result
}

export function reorderChapterSegmentsTransactional(chapterId: number, orderedIds: number[]) {
  const chapter = getDb().select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throw new Error('章节不存在。')
  const result = applyStructureBatchEdit(chapter.novelId, [{ kind: 'reorder_segments', chapterId, orderedIds }])
  void result
}

export function deleteChapterSegmentTransactional(id: number) {
  const segment = getDb().select().from(chapterSegments).where(eq(chapterSegments.id, id)).all()[0]
  if (!segment) return
  const result = applyStructureBatchEdit(segment.novelId, [{ kind: 'delete_segments', segmentIds: [id] }])
  void result
}

export function reorderStoryPartsTransactional(novelId: number, operations: StoryPartReorderOperation[]) {
  const db = getDb()
  const partRows = getPartRows(novelId)
  const volumeRows = getVolumeRows(novelId)

  if (partRows.length !== operations.length) {
    throw new Error('分册数量不匹配。')
  }

  const partById = new Map(partRows.map((part) => [part.id, part]))
  const volumeIds = new Set(volumeRows.map((volume) => volume.id))
  const operationIds = new Set(operations.map((item) => item.id))
  if (operationIds.size !== operations.length || operations.some((item) => !partById.has(item.id))) {
    throw new Error('存在无效的部 ID。')
  }
  if (partRows.some((part) => !operationIds.has(part.id))) {
    throw new Error('分册 ID 不完整。')
  }
  if (operations.some((item) => !volumeIds.has(item.volumeId))) {
    throw new Error('目标卷 ID 无效。')
  }

  runStructureTransaction(novelId, () => {
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

    normalizePartNumbers(novelId)
    normalizeChapterNumbers(novelId)
  })
}
