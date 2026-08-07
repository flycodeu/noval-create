import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import {
  type Chapter as ChapterRow,
  type ChapterSegment as ChapterSegmentRow,
  type StoryPart as StoryPartRow,
  type StoryVolume as StoryVolumeRow,
  chapterContracts,
  chapterSegments,
  chapters,
  chapterWritebackRuns,
  sceneContracts,
  storyMemoryCheckpoints,
  storyParts,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'
import { syncTimelineStructureAnchors } from './timeline.service'
import { syncTimelineEventItemLinks } from './link-sync.service'
import { resolveCreativeStageContextForChapter } from './creative-stage.service'
import {
  applyStructureBatchEdit as applyStructureBatchEditTransactional,
  applyStructureBatchPlan as applyStructureBatchPlanTransactional,
  assignChapterToPartTransactional,
  deleteChapterSegmentTransactional,
  deleteStoryPartTransactional,
  deleteStoryVolumeTransactional,
  previewStructureBatchEdit as previewStructureBatchEditTransactional,
  reorderChapterSegmentsTransactional,
  reorderStoryPartsInVolumeTransactional,
  reorderStoryPartsTransactional,
  reorderStoryVolumesTransactional,
} from './story-structure-batch.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import type {
  StructureLinkageSummary,
  StructureLinkageSyncResult,
  StructureBatchEditOperation,
  StructureBatchPlan,
} from '../../src/types'

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

function appendChapterStaleReason(raw: string | null | undefined, reason: string): string {
  return mergeStoredReasons(raw, [reason])
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

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRatio(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.max(0, Math.min(1, value))
    return Number(normalized.toFixed(4))
  }
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
    const normalized = Math.max(0, Math.min(1, Number(value)))
    return Number(normalized.toFixed(4))
  }
  return undefined
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

function clipText(value: string, maxLength = 80): string {
  const normalized = asText(value)
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function getChapterLabel(row: { chapterNum: number; title?: string | null }) {
  return row.title?.trim() ? `第${row.chapterNum}章 · ${row.title.trim()}` : `第${row.chapterNum}章`
}

function getSegmentLabelWithChapter(
  chapter: { chapterNum: number; title?: string | null },
  segment: { segmentOrder: number; title?: string | null },
) {
  const base = `第${chapter.chapterNum}章 · 场景${String(segment.segmentOrder).padStart(2, '0')}`
  return segment.title?.trim() ? `${base} · ${segment.title.trim()}` : base
}

function summarizeStructureGapLabels(labels: string[]): string[] {
  return labels.slice(0, 5)
}

function buildHookType(chapter: typeof chapters.$inferSelect): string {
  const text = `${chapter.title || ''}\n${chapter.outline || ''}`
  if (/真相|揭晓|揭露|暴露/.test(text)) return 'reveal'
  if (/反转|转折|背叛|危机/.test(text)) return 'twist'
  if (/追|逃|战|袭击|对决/.test(text)) return 'action'
  if (/悬念|线索|疑点|伏笔/.test(text)) return 'suspense'
  return 'progress'
}

function buildSceneLinkageMode(segmentType?: string | null): string {
  switch (asText(segmentType)) {
    case 'bridge':
      return 'bridge'
    case 'reveal':
      return 'reveal'
    case 'turn':
      return 'turn'
    case 'climax':
      return 'climax'
    default:
      return 'scene'
  }
}

function buildEventTypeFromSegment(segmentType?: string | null): string {
  switch (asText(segmentType)) {
    case 'bridge':
      return '过渡'
    case 'reveal':
      return '揭示'
    case 'turn':
      return '转折'
    case 'climax':
      return '高潮'
    default:
      return '场景推进'
  }
}

function buildEventSummaryFromSegment(segment: typeof chapterSegments.$inferSelect): string {
  return clipText(segment.summary || segment.purpose || segment.outputState || segment.inputState || segment.content || '结构锚点待补充。', 90)
}

function buildEventSummaryFromChapter(chapter: typeof chapters.$inferSelect): string {
  return clipText(chapter.outline || chapter.summary || chapter.title || '章节结构锚点待补充。', 90)
}

function eventCoversChapter(
  event: typeof timelineEvents.$inferSelect,
  chapter: typeof chapters.$inferSelect,
  segmentIdSet: Set<number>,
  chapterNumById: Map<number, number>,
): boolean {
  if (event.chapterStartId === chapter.id || event.chapterEndId === chapter.id) return true
  if (typeof event.segmentId === 'number' && segmentIdSet.has(event.segmentId)) return true

  const startNum = event.chapterStartId ? chapterNumById.get(event.chapterStartId) : undefined
  const endNum = event.chapterEndId ? chapterNumById.get(event.chapterEndId) : undefined
  if (typeof startNum === 'number' && typeof endNum === 'number') {
    return chapter.chapterNum >= Math.min(startNum, endNum) && chapter.chapterNum <= Math.max(startNum, endNum)
  }
  if (typeof startNum === 'number') return chapter.chapterNum === startNum
  if (typeof endNum === 'number') return chapter.chapterNum === endNum
  return false
}

function reserveSortValue(usedValues: Set<number>, preferred: number): number {
  let next = preferred
  while (usedValues.has(next)) {
    next += 1
  }
  usedValues.add(next)
  return next
}

function getTimelineRows(novelId: number) {
  const db = getDb()
  return db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .all()
}

export function normalizeChapterNumbers(novelId: number) {
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

  const knownPartIds = new Set(partRows.map((part) => part.id))
  const orphanChapters = chapterRows
    .filter((chapter) => !chapter.partId || !knownPartIds.has(chapter.partId))
    .sort((left, right) => left.chapterNum - right.chapterNum || left.id - right.id)

  for (const chapter of orphanChapters) {
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

function markNovelContextChangedInline(novelId: number, reasons: string | string[]) {
  return markNovelContextChanged(novelId, reasons)
}

function runStructureTransaction(
  novelId: number,
  reason: string,
  mutate: () => void,
) {
  const sqlite = getSqlite()
  sqlite.transaction(() => {
    mutate()
    syncChapterSegmentMetadata(novelId)
    syncPartRanges(novelId)
    syncTimelineStructureAnchors(novelId)
    markNovelContextChangedInline(novelId, reason)
  })()
}

export function getStructureLinkageSummary(novelId: number): StructureLinkageSummary {
  ensureStoryStructure(novelId)
  const db = getDb()
  const chapterRows = getChapterRows(novelId)
  const segmentRows = getSegmentRowsByNovel(novelId)
  const eventRows = getTimelineRows(novelId)
  const chapterContractRows = db.select().from(chapterContracts)
    .where(eq(chapterContracts.novelId, novelId))
    .all()
  const sceneContractRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.novelId, novelId))
    .all()

  const chapterNumById = new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
  const chapterById = new Map(chapterRows.map((row) => [row.id, row]))
  const segmentIdsByChapter = new Map<number, number[]>()
  segmentRows.forEach((segment) => {
    const current = segmentIdsByChapter.get(segment.chapterId) || []
    current.push(segment.id)
    segmentIdsByChapter.set(segment.chapterId, current)
  })

  const chapterContractIds = new Set(chapterContractRows.map((row) => row.chapterId))
  const sceneContractIds = new Set(
    sceneContractRows
      .map((row) => row.segmentId ?? null)
      .filter((segmentId): segmentId is number => typeof segmentId === 'number'),
  )

  const missingChapterContractLabels = chapterRows
    .filter((chapter) => !chapterContractIds.has(chapter.id))
    .map((chapter) => getChapterLabel(chapter))

  const missingSceneContractLabels = segmentRows
    .filter((segment) => !sceneContractIds.has(segment.id))
    .map((segment) => getSegmentLabelWithChapter(chapterById.get(segment.chapterId) || { chapterNum: 0 }, segment))

  const uncoveredChapterLabels = chapterRows
    .filter((chapter) => {
      const segmentIdSet = new Set(segmentIdsByChapter.get(chapter.id) || [])
      return !eventRows.some((event) => eventCoversChapter(event, chapter, segmentIdSet, chapterNumById))
    })
    .map((chapter) => getChapterLabel(chapter))

  const uncoveredSegmentLabels = segmentRows
    .filter((segment) => !eventRows.some((event) => event.segmentId === segment.id))
    .map((segment) => getSegmentLabelWithChapter(chapterById.get(segment.chapterId) || { chapterNum: 0 }, segment))

  const anchorInvalidEvents = eventRows.filter((event) => event.anchorInvalid === 1)
  const totalGapCount = (
    missingChapterContractLabels.length
    + missingSceneContractLabels.length
    + uncoveredChapterLabels.length
    + uncoveredSegmentLabels.length
    + anchorInvalidEvents.length
  )

  return {
    chapterCount: chapterRows.length,
    segmentCount: segmentRows.length,
    timelineEventCount: eventRows.length,
    missingChapterContractCount: missingChapterContractLabels.length,
    missingSceneContractCount: missingSceneContractLabels.length,
    uncoveredChapterCount: uncoveredChapterLabels.length,
    uncoveredSegmentCount: uncoveredSegmentLabels.length,
    anchorInvalidEventCount: anchorInvalidEvents.length,
    totalGapCount,
    missingChapterContractLabels: summarizeStructureGapLabels(missingChapterContractLabels),
    missingSceneContractLabels: summarizeStructureGapLabels(missingSceneContractLabels),
    uncoveredChapterLabels: summarizeStructureGapLabels(uncoveredChapterLabels),
    uncoveredSegmentLabels: summarizeStructureGapLabels(uncoveredSegmentLabels),
    anchorInvalidEventTitles: summarizeStructureGapLabels(anchorInvalidEvents.map((event) => event.eventTitle || '未命名事件')),
    summary: totalGapCount > 0
      ? `缺章节合同 ${missingChapterContractLabels.length}，缺场景合同 ${missingSceneContractLabels.length}，缺章节时间锚点 ${uncoveredChapterLabels.length}，缺场景时间锚点 ${uncoveredSegmentLabels.length}，锚点失效事件 ${anchorInvalidEvents.length}。`
      : '卷、章、场景与时间轴/合同的联动已经补齐。',
  }
}

export function syncStructureLinkage(novelId: number): StructureLinkageSyncResult {
  ensureStoryStructure(novelId)
  const db = getDb()
  let createdChapterContractCount = 0
  let createdSceneContractCount = 0
  let createdTimelineEventCount = 0

  runStructureTransaction(novelId, 'Structure linkage synced', () => {
    const chapterRows = getChapterRows(novelId)
    const segmentRows = getSegmentRowsByNovel(novelId)
    const eventRows = getTimelineRows(novelId)
    const chapterContractRows = db.select().from(chapterContracts)
      .where(eq(chapterContracts.novelId, novelId))
      .all()
    const sceneContractRows = db.select().from(sceneContracts)
      .where(eq(sceneContracts.novelId, novelId))
      .all()

    const chapterContractIds = new Set(chapterContractRows.map((row) => row.chapterId))
    const sceneContractIds = new Set(
      sceneContractRows
        .map((row) => row.segmentId ?? null)
        .filter((segmentId): segmentId is number => typeof segmentId === 'number'),
    )
    const chapterNumById = new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
    const chapterById = new Map(chapterRows.map((row) => [row.id, row]))
    const segmentIdsByChapter = new Map<number, number[]>()
    segmentRows.forEach((segment) => {
      const current = segmentIdsByChapter.get(segment.chapterId) || []
      current.push(segment.id)
      segmentIdsByChapter.set(segment.chapterId, current)
    })

    chapterRows.forEach((chapter) => {
      const creativeStageContext = resolveCreativeStageContextForChapter(novelId, chapter.chapterNum)
      const stageAcceptance = creativeStageContext
        ? [
            creativeStageContext.stage.objective ? `阶段目标：${creativeStageContext.stage.objective}` : '',
            creativeStageContext.stage.handoffSummary ? `阶段交接：${creativeStageContext.stage.handoffSummary}` : '',
          ].filter(Boolean)
        : []
      const stageRefs = creativeStageContext
        ? [`creative-stage:${creativeStageContext.stage.id}`, `stage-name:${creativeStageContext.stage.name}`]
        : []
      if (chapterContractIds.has(chapter.id)) {
        const currentContract = chapterContractRows.find((row) => row.chapterId === chapter.id)
        if (currentContract && (stageAcceptance.length > 0 || stageRefs.length > 0)) {
          db.update(chapterContracts).set({
            requiredAssetRefsJson: stringifyStringArray([
              ...parseStoredStringArray(currentContract.requiredAssetRefsJson),
              ...stageRefs,
            ]),
            acceptanceNotesJson: stringifyStringArray([
              ...parseStoredStringArray(currentContract.acceptanceNotesJson),
              ...stageAcceptance,
            ]),
          }).where(eq(chapterContracts.id, currentContract.id)).run()
        }
        return
      }
      db.insert(chapterContracts).values({
        novelId,
        chapterId: chapter.id,
        chapterGoal: asText(chapter.outline) || asText(chapter.title) || `补齐 ${getChapterLabel(chapter)} 的推进目标`,
        servedThreadIdsJson: JSON.stringify([]),
        requiredArcProgressJson: stringifyStringArray([]),
        requiredCharacterArcIdsJson: JSON.stringify([]),
        requiredRelationshipArcIdsJson: JSON.stringify([]),
        requiredResistanceTrackIdsJson: JSON.stringify([]),
        requiredResistanceActionsJson: stringifyStringArray([]),
        requiredAssetRefsJson: stringifyStringArray(stageRefs),
        requiredEndgameCommitmentIdsJson: JSON.stringify([]),
        requiredForeshadowIdsJson: JSON.stringify([]),
        hookType: buildHookType(chapter),
        forbiddenActionsJson: stringifyStringArray([]),
        acceptanceNotesJson: stringifyStringArray([
          asText(chapter.outline) || '先把本章推进目标、章尾承接和兑现标准补全。',
          ...stageAcceptance,
        ]),
        status: 'draft',
      }).run()
      chapterContractIds.add(chapter.id)
      createdChapterContractCount += 1
    })

    segmentRows.forEach((segment) => {
      if (sceneContractIds.has(segment.id)) return
      db.insert(sceneContracts).values({
        novelId,
        chapterId: segment.chapterId,
        segmentId: segment.id,
        pov: '',
        timeLocation: [asText(segment.timeAnchor), asText(segment.locationName)].filter(Boolean).join(' / '),
        sceneGoal: asText(segment.purpose) || asText(segment.summary) || asText(segment.title) || `补齐场景 ${segment.segmentOrder} 的作用`,
        obstacle: '',
        conflictType: '',
        emotionShift: '',
        revealPayloadJson: stringifyStringArray([]),
        resultState: asText(segment.outputState),
        linkageMode: buildSceneLinkageMode(segment.segmentType),
        requiredEndgameCommitmentIdsJson: JSON.stringify([]),
        requiredForeshadowIdsJson: JSON.stringify([]),
        status: 'draft',
      }).run()
      sceneContractIds.add(segment.id)
      createdSceneContractCount += 1
    })

    const usedTimeSortValues = new Set(eventRows.map((row) => Number(row.timeSortValue || 0)))
    let nextSortOrder = eventRows.length > 0 ? Math.max(...eventRows.map((row) => row.sortOrder || 0)) + 1 : 1

    segmentRows.forEach((segment) => {
      if (eventRows.some((event) => event.segmentId === segment.id)) return
      const chapter = chapterById.get(segment.chapterId)
      if (!chapter) return

      const preferredSortValue = chapter.chapterNum * 100 + segment.segmentOrder
      const timeSortValue = reserveSortValue(usedTimeSortValues, preferredSortValue)
      const eventTitle = asText(segment.title) || getSegmentLabelWithChapter(chapter, segment)
      const eventSummary = buildEventSummaryFromSegment(segment)
      const eventTimeLabel = asText(segment.timeAnchor) || getSegmentLabelWithChapter(chapter, segment)
      const eventId = Number(db.insert(timelineEvents).values({
        novelId,
        sortOrder: nextSortOrder,
        eventTitle,
        eventSummary,
        timeMode: 'custom-era',
        timeLabel: eventTimeLabel,
        timeSortValue,
        timePrecision: '章节场景',
        isMajorEvent: segment.segmentType === 'climax' || segment.segmentType === 'turn' || segment.segmentType === 'reveal' ? 1 : 0,
        eventType: buildEventTypeFromSegment(segment.segmentType),
        volumeId: chapter.volumeId ?? null,
        partId: chapter.partId ?? null,
        chapterStartId: chapter.id,
        chapterEndId: chapter.id,
        segmentId: segment.id,
        locationMapId: null,
        presentCharacterIdsJson: segment.presentCharacterIdsJson || JSON.stringify([]),
        affectedCharacterIdsJson: segment.presentCharacterIdsJson || JSON.stringify([]),
        protagonistPresent: 0,
        protagonistAction: '',
        eventCause: asText(segment.inputState),
        eventProcess: asText(segment.purpose) || asText(segment.summary),
        eventResult: asText(segment.outputState),
        linkedItemIdsJson: segment.linkedItemIdsJson || JSON.stringify([]),
        directConsequencesJson: stringifyStringArray([]),
        openThreadsJson: stringifyStringArray([]),
        notes: '由结构联动自动补齐，请在时间轴页补充因果链与后果。',
        anchorInvalid: 0,
        status: 'planned',
      }).run().lastInsertRowid)

      eventRows.push({
        id: eventId,
        novelId,
        sortOrder: nextSortOrder,
        eventTitle,
        eventSummary,
        timeMode: 'custom-era',
        timeLabel: eventTimeLabel,
        timeSortValue,
        timePrecision: '章节场景',
        isMajorEvent: segment.segmentType === 'climax' || segment.segmentType === 'turn' || segment.segmentType === 'reveal' ? 1 : 0,
        eventType: buildEventTypeFromSegment(segment.segmentType),
        arcId: null,
        volumeId: chapter.volumeId ?? null,
        partId: chapter.partId ?? null,
        chapterStartId: chapter.id,
        chapterEndId: chapter.id,
        segmentId: segment.id,
        locationMapId: null,
        presentCharacterIdsJson: segment.presentCharacterIdsJson || JSON.stringify([]),
        affectedCharacterIdsJson: segment.presentCharacterIdsJson || JSON.stringify([]),
        protagonistPresent: 0,
        protagonistAction: '',
        eventCause: asText(segment.inputState),
        eventProcess: asText(segment.purpose) || asText(segment.summary),
        eventResult: asText(segment.outputState),
        linkedItemIdsJson: segment.linkedItemIdsJson || JSON.stringify([]),
        directConsequencesJson: stringifyStringArray([]),
        openThreadsJson: stringifyStringArray([]),
        notes: '由结构联动自动补齐，请在时间轴页补充因果链与后果。',
        anchorInvalid: 0,
        status: 'planned',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as typeof timelineEvents.$inferSelect)
      createdTimelineEventCount += 1
      nextSortOrder += 1
      syncTimelineEventItemLinks(eventId)
    })

    chapterRows.forEach((chapter) => {
      const segmentIdSet = new Set(segmentIdsByChapter.get(chapter.id) || [])
      if (eventRows.some((event) => eventCoversChapter(event, chapter, segmentIdSet, chapterNumById))) return

      const timeSortValue = reserveSortValue(usedTimeSortValues, chapter.chapterNum * 100)
      db.insert(timelineEvents).values({
        novelId,
        sortOrder: nextSortOrder,
        eventTitle: asText(chapter.title) || getChapterLabel(chapter),
        eventSummary: buildEventSummaryFromChapter(chapter),
        timeMode: 'custom-era',
        timeLabel: getChapterLabel(chapter),
        timeSortValue,
        timePrecision: '章节',
        isMajorEvent: 0,
        eventType: '章节推进',
        volumeId: chapter.volumeId ?? null,
        partId: chapter.partId ?? null,
        chapterStartId: chapter.id,
        chapterEndId: chapter.id,
        segmentId: null,
        locationMapId: null,
        presentCharacterIdsJson: JSON.stringify([]),
        affectedCharacterIdsJson: JSON.stringify([]),
        protagonistPresent: 0,
        protagonistAction: '',
        eventCause: '',
        eventProcess: asText(chapter.outline),
        eventResult: asText(chapter.summary),
        linkedItemIdsJson: JSON.stringify([]),
        directConsequencesJson: stringifyStringArray([]),
        openThreadsJson: stringifyStringArray([]),
        notes: '由结构联动自动补齐，请在时间轴页补充章节级事件细节。',
        anchorInvalid: 0,
        status: 'planned',
      }).run()
      createdTimelineEventCount += 1
      nextSortOrder += 1
    })
  })

  const summary = getStructureLinkageSummary(novelId)
  return {
    createdChapterContractCount,
    createdSceneContractCount,
    createdTimelineEventCount,
    message: `已补齐 ${createdChapterContractCount} 章章节合同、${createdSceneContractCount} 条场景合同，并新增 ${createdTimelineEventCount} 条结构时间锚点。`,
    summary,
  }
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

  // 读取/补齐结构不应悄悄改写作者明确设置的章节编号；编号重排由结构批处理或
  // chapter.reorder 显式完成，并在那里同步所有按章节号保存的引用。
  syncChapterSegmentMetadata(novelId)
  syncPartRanges(novelId)
  return fallback
}

export function listStoryStructure(novelId: number): StoryStructureTree {
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
  return getCheckpointRows(novelId)
}

export function previewStructureBatchEdit(novelId: number, operations: StructureBatchEditOperation[]) {
  ensureStoryStructure(novelId)
  return previewStructureBatchEditTransactional(novelId, operations)
}

export function applyStructureBatchEdit(novelId: number, operations: StructureBatchEditOperation[]) {
  ensureStoryStructure(novelId)
  return applyStructureBatchEditTransactional(novelId, operations)
}

export function applyStructureBatchPlan(novelId: number, plan: StructureBatchPlan) {
  ensureStoryStructure(novelId)
  return applyStructureBatchPlanTransactional(novelId, plan)
}

export function createStoryVolume(
  novelId: number,
  data: Partial<{
    title: string
    summary: string
    targetWords: number
    maxTruthRevealRatio: number | null
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
    maxTruthRevealRatio: asRatio(data.maxTruthRevealRatio) ?? null,
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
    maxTruthRevealRatio: number | null
    status: StructureStatus
  }>,
) {
  const db = getDb()
  const current = db.select().from(storyVolumes).where(eq(storyVolumes.id, id)).all()[0]
  if (!current) throwUserFacingError('volume.notFound')
  db.update(storyVolumes).set({
    title: data.title !== undefined ? asText(data.title) : current.title,
    summary: data.summary !== undefined ? asText(data.summary) : current.summary,
    targetWords: typeof data.targetWords === 'number' ? data.targetWords : current.targetWords,
    maxTruthRevealRatio: data.maxTruthRevealRatio !== undefined
      ? (asRatio(data.maxTruthRevealRatio) ?? null)
      : current.maxTruthRevealRatio,
    status: data.status || current.status,
    updatedAt: new Date().toISOString(),
  }).where(eq(storyVolumes.id, id)).run()
  markNovelContextChanged(current.novelId, 'Story structure changed')
}

export function reorderStoryVolumes(novelId: number, orderedIds: number[]) {
  reorderStoryVolumesTransactional(novelId, orderedIds)
}

export function deleteStoryVolume(id: number) {
  deleteStoryVolumeTransactional(id)
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
  if (!volume) throwUserFacingError('volume.notFound')
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
  if (!current) throwUserFacingError('part.notFound')
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
  reorderStoryPartsTransactional(novelId, operations)
}

export function reorderStoryPartsInVolume(volumeId: number, orderedIds: number[]) {
  reorderStoryPartsInVolumeTransactional(volumeId, orderedIds)
}

export function deleteStoryPart(id: number) {
  deleteStoryPartTransactional(id)
}

export function assignChapterToPart(chapterId: number, partId: number) {
  assignChapterToPartTransactional(chapterId, partId)
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
  if (!chapter) throwUserFacingError('chapter.notFound')
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
  if (!current) throwUserFacingError('segment.notFound')
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
  deleteChapterSegmentTransactional(id)
}

export function reorderChapterSegments(chapterId: number, orderedIds: number[]) {
  reorderChapterSegmentsTransactional(chapterId, orderedIds)
}

export function compileChapterFromSegments(
  chapterId: number,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  ensureStoryStructure(chapter.novelId)
  const segments = listChapterSegments(chapterId)
  const compiledContent = segments
    .map((segment) => segment.content || '')
    .filter((content) => content.trim().length > 0)
    .join('\n\n')
  const contentChanged = compiledContent !== (chapter.content || '')
  const now = new Date().toISOString()
  const nextValues: Partial<typeof chapters.$inferInsert> = {
    content: compiledContent,
    wordCount: countWords(compiledContent),
    compiledFromSegments: 1,
    segmentCount: segments.length,
    updatedAt: now,
  }
  if (contentChanged) {
    const staleReason = '场景编译更新了正文，章节派生审校结果需要刷新'
    Object.assign(nextValues, {
      status: 'draft',
      summary: '',
      nextChapterSeed: '',
      continuityStateJson: '',
      summaryHealthJson: '',
      contractAuditJson: '',
      expressionDedupJson: '',
      hookContinuityJson: '',
      aiScoreJson: '',
      reviewNotesJson: '',
      staleReasonJson: appendChapterStaleReason(chapter.staleReasonJson, staleReason),
      writebackStatusJson: buildIdleWritebackStatusJson(chapter.contextVersion || 1),
    })
    db.update(chapterWritebackRuns).set({
      status: 'failed',
      failedAt: now,
      errorMessage: staleReason,
      updatedAt: now,
    }).where(and(
      eq(chapterWritebackRuns.chapterId, chapterId),
      inArray(chapterWritebackRuns.status, ['draft', 'ready', 'applying']),
    ))
      .run()
  }
  db.update(chapters).set(nextValues).where(eq(chapters.id, chapterId)).run()

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
  if (!chapter) throwUserFacingError('chapter.notFound')
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
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT
      v.id AS id,
      v.novel_id AS novelId,
      v.volume_number AS volumeNumber,
      v.title AS title,
      v.summary AS summary,
      v.target_words AS targetWords,
      v.max_truth_reveal_ratio AS maxTruthRevealRatio,
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
    maxTruthRevealRatio: row.maxTruthRevealRatio == null ? undefined : Number(row.maxTruthRevealRatio),
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
  const volumes = getVolumeRows(filters.novelId)
  const parts = getPartRows(filters.novelId)
  const chaptersByNovel = getChapterRows(filters.novelId)
  const segments = getSegmentRowsByNovel(filters.novelId)

  const volumePageSize = 20
  const partPageSize = 30
  const chapterPageSize = 50
  const segmentPageSize = 80

  if (volumes.length === 0) {
    return {
      novelId: filters.novelId,
      volumeId: null,
      volumeIndex: -1,
      partId: null,
      partPage: 1,
      partPageSize,
      chapterId: null,
      chapterPage: 1,
      chapterPageSize,
      segmentId: null,
      segmentPage: 1,
      segmentPageSize,
      resolvedLevel: 'novel' as const,
    }
  }

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

export function clearStoryStructure(novelId: number) {
  const sqlite = getSqlite()
  const db = getDb()
  const existingVolumeCount = getVolumeRows(novelId).length
  const existingPartCount = getPartRows(novelId).length
  const existingChapterCount = getChapterRows(novelId).length
  const existingSegmentCount = getSegmentRowsByNovel(novelId).length
  const existingCheckpointCount = getCheckpointRows(novelId).length
  const hasStructureData = existingVolumeCount > 0
    || existingPartCount > 0
    || existingChapterCount > 0
    || existingSegmentCount > 0
    || existingCheckpointCount > 0

  if (!hasStructureData) {
    syncTimelineStructureAnchors(novelId)
    return {
      volumesCleared: 0,
      partsCleared: 0,
      chaptersCleared: 0,
      segmentsCleared: 0,
      checkpointsCleared: 0,
    }
  }

  sqlite.transaction(() => {
    db.delete(chapterSegments).where(eq(chapterSegments.novelId, novelId)).run()
    db.delete(chapters).where(eq(chapters.novelId, novelId)).run()
    db.delete(storyParts).where(eq(storyParts.novelId, novelId)).run()
    db.delete(storyVolumes).where(eq(storyVolumes.novelId, novelId)).run()
    db.delete(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).run()
  })()

  syncTimelineStructureAnchors(novelId)
  markNovelContextChanged(novelId, 'Story structure changed')

  return {
    volumesCleared: existingVolumeCount,
    partsCleared: existingPartCount,
    chaptersCleared: existingChapterCount,
    segmentsCleared: existingSegmentCount,
    checkpointsCleared: existingCheckpointCount,
  }
}
