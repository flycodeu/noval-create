import { asc, eq } from 'drizzle-orm'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  endgameCommitments,
  foreshadowLedger,
  novels,
  sceneContracts,
  storyVolumes,
  volumeDesigns,
} from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { markNovelContextChanged } from './context-impact.service'
import { ensureStoryStructure } from './story-structure.service'

const ENDGAME_STALE_WINDOW = 12

type CommitmentStatus = 'active' | 'served' | 'fulfilled' | 'waived'
type CommitmentKind = 'promise' | 'payoff'

interface CommitmentReferenceSummary {
  referenceCount: number
  lastServedChapter?: number
  volumeIds: number[]
  chapterIds: number[]
  segmentIds: number[]
  foreshadowIds: number[]
}

interface VolumeRange {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function parseJsonNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map((item) => asNumber(item)).filter((item): item is number => typeof item === 'number'))]
  } catch {
    return []
  }
}

function parseJsonStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map((item) => asText(item)).filter(Boolean))]
  } catch {
    return []
  }
}

function stringifyNumberArray(values?: number[]): string {
  return JSON.stringify([...(values || [])]
    .map((value) => asNumber(value))
    .filter((value): value is number => typeof value === 'number'))
}

function stringifyStringArray(values?: string[]): string {
  return JSON.stringify([...(values || [])]
    .map((value) => asText(value))
    .filter(Boolean))
}

function splitMultilineEntries(value?: string | null): string[] {
  return (value || '')
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function truncateAssetTitle(value: string, maxLength = 48): string {
  const trimmed = value.trim()
  if (!trimmed) return '未命名资产'
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength).trim()}...`
}

function findNovelById(novelId: number) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  return novel
}

function getCurrentChapterNum(novelId: number): number {
  const db = getDb()
  const rows = db.select({
    chapterNum: chapters.chapterNum,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  return rows.at(-1)?.chapterNum || 0
}

function getVolumeRanges(novelId: number): VolumeRange[] {
  const db = getDb()
  const volumeRows = db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
  const chapterRows = db.select({
    volumeId: chapters.volumeId,
    chapterNum: chapters.chapterNum,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()

  return volumeRows
    .map((volume) => {
      const chapterNums = chapterRows
        .filter((chapter) => chapter.volumeId === volume.id)
        .map((chapter) => chapter.chapterNum)
      if (chapterNums.length <= 0) return null
      return {
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: volume.title?.trim() || `第${volume.volumeNumber || volume.id}卷`,
        chapterStart: Math.min(...chapterNums),
        chapterEnd: Math.max(...chapterNums),
      }
    })
    .filter((item): item is VolumeRange => Boolean(item))
}

function resolveVolumeIdByChapter(chapterNum: number | undefined, ranges: VolumeRange[]): number | undefined {
  if (typeof chapterNum !== 'number') return undefined
  return ranges.find((range) => chapterNum >= range.chapterStart && chapterNum <= range.chapterEnd)?.volumeId
}

function buildCommitmentReferenceSummary(novelId: number): Map<number, CommitmentReferenceSummary> {
  const db = getDb()
  ensureStoryStructure(novelId)

  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    volumeId: chapters.volumeId,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
  const chapterNumById = new Map(chapterRows.map((row) => [row.id, row.chapterNum] as const))
  const volumeIdByChapterId = new Map(chapterRows.map((row) => [row.id, row.volumeId ?? undefined] as const))
  const segmentRows = db.select({
    id: chapterSegments.id,
    chapterId: chapterSegments.chapterId,
  }).from(chapterSegments)
    .where(eq(chapterSegments.novelId, novelId))
    .all()
  const chapterIdBySegmentId = new Map(segmentRows.map((row) => [row.id, row.chapterId] as const))
  const volumeRanges = getVolumeRanges(novelId)
  const summary = new Map<number, CommitmentReferenceSummary>()

  const addReference = (
    commitmentId: number,
    options: {
      chapterNum?: number
      volumeId?: number
      chapterId?: number
      segmentId?: number
      foreshadowId?: number
    },
  ) => {
    const current = summary.get(commitmentId) || {
      referenceCount: 0,
      lastServedChapter: undefined,
      volumeIds: [],
      chapterIds: [],
      segmentIds: [],
      foreshadowIds: [],
    }
    current.referenceCount += 1
    if (typeof options.chapterNum === 'number') {
      current.lastServedChapter = Math.max(current.lastServedChapter || 0, options.chapterNum)
    }
    if (typeof options.volumeId === 'number' && !current.volumeIds.includes(options.volumeId)) {
      current.volumeIds.push(options.volumeId)
    }
    if (typeof options.chapterId === 'number' && !current.chapterIds.includes(options.chapterId)) {
      current.chapterIds.push(options.chapterId)
    }
    if (typeof options.segmentId === 'number' && !current.segmentIds.includes(options.segmentId)) {
      current.segmentIds.push(options.segmentId)
    }
    if (typeof options.foreshadowId === 'number' && !current.foreshadowIds.includes(options.foreshadowId)) {
      current.foreshadowIds.push(options.foreshadowId)
    }
    summary.set(commitmentId, current)
  }

  const volumeChapterEndById = new Map(getVolumeRanges(novelId).map((range) => [range.volumeId, range.chapterEnd] as const))
  db.select().from(volumeDesigns)
    .where(eq(volumeDesigns.novelId, novelId))
    .all()
    .forEach((row) => {
      const chapterNum = volumeChapterEndById.get(row.volumeId)
      parseJsonNumberArray(row.linkedEndgameCommitmentIdsJson).forEach((commitmentId) => addReference(commitmentId, {
        volumeId: row.volumeId,
        chapterNum,
      }))
    })

  db.select().from(chapterContracts)
    .where(eq(chapterContracts.novelId, novelId))
    .all()
    .forEach((row) => {
      const chapterNum = chapterNumById.get(row.chapterId)
      const volumeId = volumeIdByChapterId.get(row.chapterId)
      parseJsonNumberArray(row.requiredEndgameCommitmentIdsJson).forEach((commitmentId) => addReference(commitmentId, {
        volumeId,
        chapterId: row.chapterId,
        chapterNum,
      }))
    })

  db.select().from(sceneContracts)
    .where(eq(sceneContracts.novelId, novelId))
    .all()
    .forEach((row) => {
      const chapterId = row.segmentId ? chapterIdBySegmentId.get(row.segmentId) || row.chapterId : row.chapterId
      const chapterNum = chapterNumById.get(chapterId)
      const volumeId = volumeIdByChapterId.get(chapterId)
      parseJsonNumberArray(row.requiredEndgameCommitmentIdsJson).forEach((commitmentId) => addReference(commitmentId, {
        volumeId,
        chapterId,
        chapterNum,
        segmentId: row.segmentId ?? undefined,
      }))
    })

  db.select().from(foreshadowLedger)
    .where(eq(foreshadowLedger.novelId, novelId))
    .all()
    .forEach((row) => {
      if (!row.linkedEndgameCommitmentId) return
      const sourceChapterNum = row.sourceChapterId ? chapterNumById.get(row.sourceChapterId) : undefined
      const chapterNum = sourceChapterNum ?? asNumber(row.targetPayoffChapter)
      const volumeId = row.linkedVolumeId ?? resolveVolumeIdByChapter(chapterNum, volumeRanges)
      addReference(row.linkedEndgameCommitmentId, {
        chapterNum,
        volumeId,
        chapterId: row.sourceChapterId ?? undefined,
        segmentId: row.sourceSegmentId ?? undefined,
        foreshadowId: row.id,
      })
    })

  return summary
}

function resolveDerivedCommitmentStatus(
  row: typeof endgameCommitments.$inferSelect,
  reference: CommitmentReferenceSummary | undefined,
): CommitmentStatus {
  if (row.status === 'waived') return 'waived'
  if (row.status === 'fulfilled' || typeof row.fulfilledChapter === 'number') return 'fulfilled'
  if ((reference?.referenceCount || 0) > 0) return 'served'
  return 'active'
}

function buildEndgameCommitmentView(
  row: typeof endgameCommitments.$inferSelect,
  reference: CommitmentReferenceSummary | undefined,
  currentChapterNum: number,
  progressPercent: number,
) {
  const derivedStatus = resolveDerivedCommitmentStatus(row, reference)
  const overdue = derivedStatus !== 'fulfilled'
    && derivedStatus !== 'waived'
    && (
      (typeof row.targetResolutionChapter === 'number' && currentChapterNum > row.targetResolutionChapter)
      || ((reference?.referenceCount || 0) <= 0 && progressPercent >= 70)
    )

  return {
    ...row,
    status: row.status as CommitmentStatus,
    derivedStatus,
    referenceCount: reference?.referenceCount || 0,
    referencedVolumeIds: reference?.volumeIds || [],
    referencedChapterIds: reference?.chapterIds || [],
    referencedSegmentIds: reference?.segmentIds || [],
    linkedForeshadowIds: reference?.foreshadowIds || [],
    lastServedChapter: reference?.lastServedChapter ?? row.lastServedChapter ?? undefined,
    overdue,
  }
}

function refreshCommitmentDerivedState(novelId: number) {
  const db = getDb()
  const rows = db.select().from(endgameCommitments)
    .where(eq(endgameCommitments.novelId, novelId))
    .orderBy(asc(endgameCommitments.sourceOrder), asc(endgameCommitments.id))
    .all()
  const referenceSummary = buildCommitmentReferenceSummary(novelId)
  const timestamp = new Date().toISOString()

  rows.forEach((row) => {
    const reference = referenceSummary.get(row.id)
    const nextStatus = resolveDerivedCommitmentStatus(row, reference)
    const nextLastServedChapter = reference?.lastServedChapter ?? null
    const currentLastServedChapter = row.lastServedChapter ?? null
    if (row.status === nextStatus && currentLastServedChapter === nextLastServedChapter) return
    db.update(endgameCommitments).set({
      status: nextStatus,
      lastServedChapter: nextLastServedChapter,
      updatedAt: timestamp,
    }).where(eq(endgameCommitments.id, row.id)).run()
  })
}

export function listEndgameCommitments(novelId: number) {
  ensureStoryStructure(novelId)
  refreshCommitmentDerivedState(novelId)
  const db = getDb()
  const novel = findNovelById(novelId)
  const rows = db.select().from(endgameCommitments)
    .where(eq(endgameCommitments.novelId, novelId))
    .orderBy(asc(endgameCommitments.commitmentKind), asc(endgameCommitments.sourceOrder), asc(endgameCommitments.id))
    .all()
  const currentChapterNum = getCurrentChapterNum(novelId)
  const progressPercent = novel.targetWords && novel.targetWords > 0
    ? Math.round(((novel.totalWords || 0) / novel.targetWords) * 100)
    : 0
  const referenceSummary = buildCommitmentReferenceSummary(novelId)
  return rows.map((row) => buildEndgameCommitmentView(row, referenceSummary.get(row.id), currentChapterNum, progressPercent))
}

export function getEndgameAssetSummary(novelId: number) {
  const commitments = listEndgameCommitments(novelId)
  const foreshadows = listForeshadowLedger(novelId)
  return {
    totalCount: commitments.length,
    promiseCount: commitments.filter((item) => item.commitmentKind === 'promise').length,
    payoffCount: commitments.filter((item) => item.commitmentKind === 'payoff').length,
    activeCount: commitments.filter((item) => item.derivedStatus === 'active').length,
    servedCount: commitments.filter((item) => item.derivedStatus === 'served').length,
    fulfilledCount: commitments.filter((item) => item.derivedStatus === 'fulfilled').length,
    waivedCount: commitments.filter((item) => item.derivedStatus === 'waived').length,
    overdueCount: commitments.filter((item) => item.overdue).length,
    unboundCount: commitments.filter((item) => item.derivedStatus !== 'waived' && item.derivedStatus !== 'fulfilled' && item.referenceCount <= 0).length,
    linkedForeshadowCount: foreshadows.filter((item) => typeof item.linkedEndgameCommitmentId === 'number').length,
  }
}

export function syncEndgameCommitmentsFromSettings(novelId: number, settingsJson?: string | null) {
  const db = getDb()
  const novel = findNovelById(novelId)
  const settings = parseStorySettingsDocument(settingsJson ?? novel.settingsJson)
  const timestamp = new Date().toISOString()
  const syncByKind = (entries: string[], kind: CommitmentKind) => {
    const existingRows = db.select().from(endgameCommitments)
      .where(eq(endgameCommitments.novelId, novelId))
      .all()
      .filter((row) => row.commitmentKind === kind)
    const existingBySource = new Map(existingRows.map((row) => [row.sourceText, row] as const))
    const incomingSources = new Set(entries)

    existingRows
      .filter((row) => !incomingSources.has(row.sourceText))
      .forEach((row) => {
        db.update(endgameCommitments).set({
          status: 'waived',
          updatedAt: timestamp,
        }).where(eq(endgameCommitments.id, row.id)).run()
      })

    entries.forEach((entry, index) => {
      const current = existingBySource.get(entry)
      const title = truncateAssetTitle(entry)
      if (current) {
        db.update(endgameCommitments).set({
          title,
          description: entry,
          sourceOrder: index,
          sourceText: entry,
          status: current.status === 'fulfilled' ? 'fulfilled' : 'active',
          updatedAt: timestamp,
        }).where(eq(endgameCommitments.id, current.id)).run()
        return
      }
      db.insert(endgameCommitments).values({
        novelId,
        commitmentKind: kind,
        title,
        description: entry,
        sourceOrder: index,
        sourceText: entry,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run()
    })
  }

  syncByKind(splitMultilineEntries(settings.endgameDesign.mustDeliverPromises), 'promise')
  syncByKind(splitMultilineEntries(settings.endgameDesign.payoffChecklist), 'payoff')
  refreshCommitmentDerivedState(novelId)

  const commitmentRows = db.select().from(endgameCommitments)
    .where(eq(endgameCommitments.novelId, novelId))
    .all()
  const payoffRows = commitmentRows.filter((row) => row.commitmentKind === 'payoff' && row.status !== 'waived')
  const existingForeshadows = db.select().from(foreshadowLedger)
    .where(eq(foreshadowLedger.novelId, novelId))
    .all()

  payoffRows.forEach((commitment) => {
    const linked = existingForeshadows.find((row) => row.linkedEndgameCommitmentId === commitment.id) || null
    if (linked) {
      db.update(foreshadowLedger).set({
        title: commitment.title,
        detail: commitment.description,
        updatedAt: timestamp,
      }).where(eq(foreshadowLedger.id, linked.id)).run()
      return
    }
    db.insert(foreshadowLedger).values({
      novelId,
      title: commitment.title,
      detail: commitment.description,
      salienceLevel: 'medium',
      impactScope: 'ending',
      status: 'draft',
      linkedEndgameCommitmentId: commitment.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  })

  markNovelContextChanged(novelId, [
    'Endgame commitments synced',
    'Foreshadow ledger synced',
  ])

  refreshCommitmentDerivedState(novelId)
  return {
    commitments: listEndgameCommitments(novelId),
    summary: getEndgameAssetSummary(novelId),
  }
}

export function updateEndgameCommitment(
  id: number,
  patch: Partial<{
    title: string
    description: string
    status: CommitmentStatus
    targetResolutionChapter: number | null
    fulfilledChapter: number | null
    notes: string
  }>,
) {
  const db = getDb()
  const current = db.select().from(endgameCommitments).where(eq(endgameCommitments.id, id)).all()[0]
  if (!current) throwUserFacingError('novel.notFound')
  db.update(endgameCommitments).set({
    title: patch.title !== undefined ? asText(patch.title) || current.title : current.title,
    description: patch.description !== undefined ? asText(patch.description) : current.description,
    status: patch.status ?? current.status,
    targetResolutionChapter: patch.targetResolutionChapter !== undefined
      ? patch.targetResolutionChapter == null ? null : asNumber(patch.targetResolutionChapter) ?? null
      : current.targetResolutionChapter,
    fulfilledChapter: patch.fulfilledChapter !== undefined
      ? patch.fulfilledChapter == null ? null : asNumber(patch.fulfilledChapter) ?? null
      : current.fulfilledChapter,
    notes: patch.notes !== undefined ? asText(patch.notes) : current.notes,
    updatedAt: new Date().toISOString(),
  }).where(eq(endgameCommitments.id, id)).run()
  refreshCommitmentDerivedState(current.novelId)
  markNovelContextChanged(current.novelId, 'Endgame commitment updated')
  return listEndgameCommitments(current.novelId).find((row) => row.id === id) || null
}

export function listForeshadowLedger(novelId: number) {
  ensureStoryStructure(novelId)
  const db = getDb()
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
  const chapterNumById = new Map(chapterRows.map((row) => [row.id, row.chapterNum] as const))
  const commitmentTitleById = new Map(listEndgameCommitments(novelId).map((row) => [row.id, row.title] as const))

  return db.select().from(foreshadowLedger)
    .where(eq(foreshadowLedger.novelId, novelId))
    .orderBy(asc(foreshadowLedger.targetPayoffChapter), asc(foreshadowLedger.id))
    .all()
    .map((row) => ({
      ...row,
      sourceChapterNum: row.sourceChapterId ? chapterNumById.get(row.sourceChapterId) : undefined,
      linkedEndgameCommitmentTitle: row.linkedEndgameCommitmentId
        ? commitmentTitleById.get(row.linkedEndgameCommitmentId)
        : undefined,
    }))
}

export function upsertForeshadowLedger(
  novelId: number,
  data: Partial<{
    id: number
    title: string
    detail: string
    sourceChapterId: number | null
    sourceSegmentId: number | null
    plantMethod: string
    salienceLevel: string
    targetPayoffChapter: number | null
    payoffMethod: string
    impactScope: string
    status: string
    linkedThreadId: number | null
    linkedEndgameCommitmentId: number | null
    linkedVolumeId: number | null
  }>,
) {
  const db = getDb()
  findNovelById(novelId)
  const timestamp = new Date().toISOString()
  if (data.id) {
    const current = db.select().from(foreshadowLedger).where(eq(foreshadowLedger.id, data.id)).all()[0]
    if (!current) throwUserFacingError('novel.notFound')
    db.update(foreshadowLedger).set({
      title: data.title !== undefined ? asText(data.title) || current.title : current.title,
      detail: data.detail !== undefined ? asText(data.detail) : current.detail,
      sourceChapterId: data.sourceChapterId !== undefined ? data.sourceChapterId : current.sourceChapterId,
      sourceSegmentId: data.sourceSegmentId !== undefined ? data.sourceSegmentId : current.sourceSegmentId,
      plantMethod: data.plantMethod !== undefined ? asText(data.plantMethod) : current.plantMethod,
      salienceLevel: data.salienceLevel !== undefined ? asText(data.salienceLevel) || current.salienceLevel : current.salienceLevel,
      targetPayoffChapter: data.targetPayoffChapter !== undefined ? data.targetPayoffChapter : current.targetPayoffChapter,
      payoffMethod: data.payoffMethod !== undefined ? asText(data.payoffMethod) : current.payoffMethod,
      impactScope: data.impactScope !== undefined ? asText(data.impactScope) || current.impactScope : current.impactScope,
      status: data.status !== undefined ? asText(data.status) || current.status : current.status,
      linkedThreadId: data.linkedThreadId !== undefined ? data.linkedThreadId : current.linkedThreadId,
      linkedEndgameCommitmentId: data.linkedEndgameCommitmentId !== undefined ? data.linkedEndgameCommitmentId : current.linkedEndgameCommitmentId,
      linkedVolumeId: data.linkedVolumeId !== undefined ? data.linkedVolumeId : current.linkedVolumeId,
      updatedAt: timestamp,
    }).where(eq(foreshadowLedger.id, data.id)).run()
  } else {
    db.insert(foreshadowLedger).values({
      novelId,
      title: asText(data.title) || '未命名伏笔',
      detail: asText(data.detail),
      sourceChapterId: data.sourceChapterId ?? null,
      sourceSegmentId: data.sourceSegmentId ?? null,
      plantMethod: asText(data.plantMethod),
      salienceLevel: asText(data.salienceLevel) || 'medium',
      targetPayoffChapter: data.targetPayoffChapter ?? null,
      payoffMethod: asText(data.payoffMethod),
      impactScope: asText(data.impactScope) || 'global',
      status: asText(data.status) || 'draft',
      linkedThreadId: data.linkedThreadId ?? null,
      linkedEndgameCommitmentId: data.linkedEndgameCommitmentId ?? null,
      linkedVolumeId: data.linkedVolumeId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }
  refreshCommitmentDerivedState(novelId)
  markNovelContextChanged(novelId, 'Foreshadow ledger updated')
  return listForeshadowLedger(novelId)
}

function buildVolumeDesignView(
  volume: typeof storyVolumes.$inferSelect,
  design?: typeof volumeDesigns.$inferSelect | null,
) {
  return {
    id: design?.id,
    novelId: volume.novelId,
    volumeId: volume.id,
    volumeNumber: volume.volumeNumber,
    volumeName: volume.title?.trim() || `第${volume.volumeNumber}卷`,
    volumeTheme: design?.volumeTheme || '',
    volumePromise: design?.volumePromise || '',
    mainConflict: design?.mainConflict || '',
    climaxPlan: design?.climaxPlan || '',
    endStateShift: design?.endStateShift || '',
    mustAddClues: parseJsonStringArray(design?.mustAddCluesJson),
    mustResolveClues: parseJsonStringArray(design?.mustResolveCluesJson),
    readerExpectation: design?.readerExpectation || '',
    linkedEndgameCommitmentIds: parseJsonNumberArray(design?.linkedEndgameCommitmentIdsJson),
    auditStatus: design?.auditStatus || 'draft',
    createdAt: design?.createdAt || volume.createdAt,
    updatedAt: design?.updatedAt || volume.updatedAt,
  }
}

export function listVolumeDesigns(novelId: number) {
  ensureStoryStructure(novelId)
  const db = getDb()
  const volumeRows = db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
  const designRows = db.select().from(volumeDesigns)
    .where(eq(volumeDesigns.novelId, novelId))
    .all()
  const designByVolumeId = new Map(designRows.map((row) => [row.volumeId, row] as const))
  return volumeRows.map((volume) => buildVolumeDesignView(volume, designByVolumeId.get(volume.id)))
}

export function getVolumeDesignByVolumeId(volumeId: number) {
  const db = getDb()
  const volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, volumeId)).all()[0]
  if (!volume) throwUserFacingError('volume.notFound')
  const design = db.select().from(volumeDesigns).where(eq(volumeDesigns.volumeId, volumeId)).all()[0] || null
  return buildVolumeDesignView(volume, design)
}

export function upsertVolumeDesign(
  volumeId: number,
  data: Partial<{
    volumeTheme: string
    volumePromise: string
    mainConflict: string
    climaxPlan: string
    endStateShift: string
    mustAddClues: string[]
    mustResolveClues: string[]
    readerExpectation: string
    linkedEndgameCommitmentIds: number[]
    auditStatus: string
  }>,
) {
  const db = getDb()
  const volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, volumeId)).all()[0]
  if (!volume) throwUserFacingError('volume.notFound')
  const current = db.select().from(volumeDesigns).where(eq(volumeDesigns.volumeId, volumeId)).all()[0] || null
  const timestamp = new Date().toISOString()

  if (current) {
    db.update(volumeDesigns).set({
      volumeTheme: data.volumeTheme !== undefined ? asText(data.volumeTheme) : current.volumeTheme,
      volumePromise: data.volumePromise !== undefined ? asText(data.volumePromise) : current.volumePromise,
      mainConflict: data.mainConflict !== undefined ? asText(data.mainConflict) : current.mainConflict,
      climaxPlan: data.climaxPlan !== undefined ? asText(data.climaxPlan) : current.climaxPlan,
      endStateShift: data.endStateShift !== undefined ? asText(data.endStateShift) : current.endStateShift,
      mustAddCluesJson: data.mustAddClues !== undefined ? stringifyStringArray(data.mustAddClues) : current.mustAddCluesJson,
      mustResolveCluesJson: data.mustResolveClues !== undefined ? stringifyStringArray(data.mustResolveClues) : current.mustResolveCluesJson,
      readerExpectation: data.readerExpectation !== undefined ? asText(data.readerExpectation) : current.readerExpectation,
      linkedEndgameCommitmentIdsJson: data.linkedEndgameCommitmentIds !== undefined ? stringifyNumberArray(data.linkedEndgameCommitmentIds) : current.linkedEndgameCommitmentIdsJson,
      auditStatus: data.auditStatus !== undefined ? asText(data.auditStatus) || current.auditStatus : current.auditStatus,
      updatedAt: timestamp,
    }).where(eq(volumeDesigns.id, current.id)).run()
  } else {
    db.insert(volumeDesigns).values({
      novelId: volume.novelId,
      volumeId,
      volumeTheme: asText(data.volumeTheme),
      volumePromise: asText(data.volumePromise),
      mainConflict: asText(data.mainConflict),
      climaxPlan: asText(data.climaxPlan),
      endStateShift: asText(data.endStateShift),
      mustAddCluesJson: stringifyStringArray(data.mustAddClues),
      mustResolveCluesJson: stringifyStringArray(data.mustResolveClues),
      readerExpectation: asText(data.readerExpectation),
      linkedEndgameCommitmentIdsJson: stringifyNumberArray(data.linkedEndgameCommitmentIds),
      auditStatus: asText(data.auditStatus) || 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  refreshCommitmentDerivedState(volume.novelId)
  markNovelContextChanged(volume.novelId, 'Volume design updated')
  return getVolumeDesignByVolumeId(volumeId)
}

function buildChapterContractView(
  chapter: typeof chapters.$inferSelect,
  contract?: typeof chapterContracts.$inferSelect | null,
) {
  return {
    id: contract?.id,
    novelId: chapter.novelId,
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title?.trim() || `第${chapter.chapterNum}章`,
    chapterGoal: contract?.chapterGoal || '',
    servedThreadIds: parseJsonNumberArray(contract?.servedThreadIdsJson),
    requiredArcProgress: parseJsonStringArray(contract?.requiredArcProgressJson),
    requiredAssetRefs: parseJsonStringArray(contract?.requiredAssetRefsJson),
    requiredEndgameCommitmentIds: parseJsonNumberArray(contract?.requiredEndgameCommitmentIdsJson),
    requiredForeshadowIds: parseJsonNumberArray(contract?.requiredForeshadowIdsJson),
    hookType: contract?.hookType || '',
    forbiddenActions: parseJsonStringArray(contract?.forbiddenActionsJson),
    acceptanceNotes: parseJsonStringArray(contract?.acceptanceNotesJson),
    status: contract?.status || 'draft',
    createdAt: contract?.createdAt || chapter.createdAt,
    updatedAt: contract?.updatedAt || chapter.updatedAt,
  }
}

export function getChapterContract(chapterId: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const contract = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  return buildChapterContractView(chapter, contract)
}

export function upsertChapterContract(
  chapterId: number,
  data: Partial<{
    chapterGoal: string
    servedThreadIds: number[]
    requiredArcProgress: string[]
    requiredAssetRefs: string[]
    requiredEndgameCommitmentIds: number[]
    requiredForeshadowIds: number[]
    hookType: string
    forbiddenActions: string[]
    acceptanceNotes: string[]
    status: string
  }>,
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const current = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const timestamp = new Date().toISOString()

  if (current) {
    db.update(chapterContracts).set({
      chapterGoal: data.chapterGoal !== undefined ? asText(data.chapterGoal) : current.chapterGoal,
      servedThreadIdsJson: data.servedThreadIds !== undefined ? stringifyNumberArray(data.servedThreadIds) : current.servedThreadIdsJson,
      requiredArcProgressJson: data.requiredArcProgress !== undefined ? stringifyStringArray(data.requiredArcProgress) : current.requiredArcProgressJson,
      requiredAssetRefsJson: data.requiredAssetRefs !== undefined ? stringifyStringArray(data.requiredAssetRefs) : current.requiredAssetRefsJson,
      requiredEndgameCommitmentIdsJson: data.requiredEndgameCommitmentIds !== undefined ? stringifyNumberArray(data.requiredEndgameCommitmentIds) : current.requiredEndgameCommitmentIdsJson,
      requiredForeshadowIdsJson: data.requiredForeshadowIds !== undefined ? stringifyNumberArray(data.requiredForeshadowIds) : current.requiredForeshadowIdsJson,
      hookType: data.hookType !== undefined ? asText(data.hookType) : current.hookType,
      forbiddenActionsJson: data.forbiddenActions !== undefined ? stringifyStringArray(data.forbiddenActions) : current.forbiddenActionsJson,
      acceptanceNotesJson: data.acceptanceNotes !== undefined ? stringifyStringArray(data.acceptanceNotes) : current.acceptanceNotesJson,
      status: data.status !== undefined ? asText(data.status) || current.status : current.status,
      updatedAt: timestamp,
    }).where(eq(chapterContracts.id, current.id)).run()
  } else {
    db.insert(chapterContracts).values({
      novelId: chapter.novelId,
      chapterId,
      chapterGoal: asText(data.chapterGoal),
      servedThreadIdsJson: stringifyNumberArray(data.servedThreadIds),
      requiredArcProgressJson: stringifyStringArray(data.requiredArcProgress),
      requiredAssetRefsJson: stringifyStringArray(data.requiredAssetRefs),
      requiredEndgameCommitmentIdsJson: stringifyNumberArray(data.requiredEndgameCommitmentIds),
      requiredForeshadowIdsJson: stringifyNumberArray(data.requiredForeshadowIds),
      hookType: asText(data.hookType),
      forbiddenActionsJson: stringifyStringArray(data.forbiddenActions),
      acceptanceNotesJson: stringifyStringArray(data.acceptanceNotes),
      status: asText(data.status) || 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  refreshCommitmentDerivedState(chapter.novelId)
  markNovelContextChanged(chapter.novelId, 'Chapter contract updated')
  return getChapterContract(chapterId)
}

function buildSceneContractView(
  chapter: typeof chapters.$inferSelect,
  segment: typeof chapterSegments.$inferSelect | null,
  contract?: typeof sceneContracts.$inferSelect | null,
) {
  const segmentTitle = segment?.title?.trim()
    || (typeof segment?.segmentOrder === 'number' ? `场景 ${segment.segmentOrder}` : '场景合同')
  return {
    id: contract?.id,
    novelId: chapter.novelId,
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title?.trim() || `第${chapter.chapterNum}章`,
    segmentId: segment?.id ?? contract?.segmentId ?? undefined,
    segmentOrder: segment?.segmentOrder,
    segmentTitle,
    pov: contract?.pov || '',
    timeLocation: contract?.timeLocation || '',
    sceneGoal: contract?.sceneGoal || segment?.purpose || '',
    obstacle: contract?.obstacle || '',
    conflictType: contract?.conflictType || '',
    emotionShift: contract?.emotionShift || '',
    revealPayload: parseJsonStringArray(contract?.revealPayloadJson),
    resultState: contract?.resultState || segment?.outputState || '',
    linkageMode: contract?.linkageMode || '',
    requiredEndgameCommitmentIds: parseJsonNumberArray(contract?.requiredEndgameCommitmentIdsJson),
    requiredForeshadowIds: parseJsonNumberArray(contract?.requiredForeshadowIdsJson),
    status: contract?.status || 'draft',
    createdAt: contract?.createdAt || segment?.createdAt || chapter.createdAt,
    updatedAt: contract?.updatedAt || segment?.updatedAt || chapter.updatedAt,
  }
}

export function listSceneContracts(chapterId: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const segmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const contractRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const contractBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  contractRows.forEach((row) => {
    if (typeof row.segmentId === 'number' && !contractBySegmentId.has(row.segmentId)) {
      contractBySegmentId.set(row.segmentId, row)
    }
  })

  const merged = segmentRows.map((segment) => buildSceneContractView(chapter, segment, contractBySegmentId.get(segment.id) || null))
  const orphanContracts = contractRows
    .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
    .map((row) => buildSceneContractView(chapter, null, row))
  return [...merged, ...orphanContracts]
}

export function upsertSceneContract(
  chapterId: number,
  segmentId: number | null,
  data: Partial<{
    pov: string
    timeLocation: string
    sceneGoal: string
    obstacle: string
    conflictType: string
    emotionShift: string
    revealPayload: string[]
    resultState: string
    linkageMode: string
    requiredEndgameCommitmentIds: number[]
    requiredForeshadowIds: number[]
    status: string
  }>,
) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  if (segmentId != null) {
    const segment = db.select().from(chapterSegments).where(eq(chapterSegments.id, segmentId)).all()[0]
    if (!segment) throwUserFacingError('segment.notFound')
  }

  const current = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .all()
    .find((row) => (row.segmentId ?? null) === (segmentId ?? null)) || null
  const timestamp = new Date().toISOString()

  if (current) {
    db.update(sceneContracts).set({
      pov: data.pov !== undefined ? asText(data.pov) : current.pov,
      timeLocation: data.timeLocation !== undefined ? asText(data.timeLocation) : current.timeLocation,
      sceneGoal: data.sceneGoal !== undefined ? asText(data.sceneGoal) : current.sceneGoal,
      obstacle: data.obstacle !== undefined ? asText(data.obstacle) : current.obstacle,
      conflictType: data.conflictType !== undefined ? asText(data.conflictType) : current.conflictType,
      emotionShift: data.emotionShift !== undefined ? asText(data.emotionShift) : current.emotionShift,
      revealPayloadJson: data.revealPayload !== undefined ? stringifyStringArray(data.revealPayload) : current.revealPayloadJson,
      resultState: data.resultState !== undefined ? asText(data.resultState) : current.resultState,
      linkageMode: data.linkageMode !== undefined ? asText(data.linkageMode) : current.linkageMode,
      requiredEndgameCommitmentIdsJson: data.requiredEndgameCommitmentIds !== undefined ? stringifyNumberArray(data.requiredEndgameCommitmentIds) : current.requiredEndgameCommitmentIdsJson,
      requiredForeshadowIdsJson: data.requiredForeshadowIds !== undefined ? stringifyNumberArray(data.requiredForeshadowIds) : current.requiredForeshadowIdsJson,
      status: data.status !== undefined ? asText(data.status) || current.status : current.status,
      updatedAt: timestamp,
    }).where(eq(sceneContracts.id, current.id)).run()
  } else {
    db.insert(sceneContracts).values({
      novelId: chapter.novelId,
      chapterId,
      segmentId,
      pov: asText(data.pov),
      timeLocation: asText(data.timeLocation),
      sceneGoal: asText(data.sceneGoal),
      obstacle: asText(data.obstacle),
      conflictType: asText(data.conflictType),
      emotionShift: asText(data.emotionShift),
      revealPayloadJson: stringifyStringArray(data.revealPayload),
      resultState: asText(data.resultState),
      linkageMode: asText(data.linkageMode),
      requiredEndgameCommitmentIdsJson: stringifyNumberArray(data.requiredEndgameCommitmentIds),
      requiredForeshadowIdsJson: stringifyNumberArray(data.requiredForeshadowIds),
      status: asText(data.status) || 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  refreshCommitmentDerivedState(chapter.novelId)
  markNovelContextChanged(chapter.novelId, 'Scene contract updated')
  return listSceneContracts(chapterId)
}

export function getChapterContractContext(chapterId: number) {
  const chapter = getChapterContract(chapterId)
  const sceneRows = listSceneContracts(chapterId)
  const commitmentIds = [...new Set([
    ...chapter.requiredEndgameCommitmentIds,
    ...sceneRows.flatMap((item) => item.requiredEndgameCommitmentIds),
  ])]
  const foreshadowIds = [...new Set([
    ...chapter.requiredForeshadowIds,
    ...sceneRows.flatMap((item) => item.requiredForeshadowIds),
  ])]
  return {
    chapterContract: chapter,
    sceneContracts: sceneRows,
    requiredCommitments: listEndgameCommitments(chapter.novelId).filter((item) => commitmentIds.includes(item.id)),
    requiredForeshadows: listForeshadowLedger(chapter.novelId).filter((item) => foreshadowIds.includes(item.id)),
  }
}

export function getEndgameDebtSnapshot(novelId: number) {
  const novel = findNovelById(novelId)
  const currentChapterNum = getCurrentChapterNum(novelId)
  const progressPercent = novel.targetWords && novel.targetWords > 0
    ? Math.round(((novel.totalWords || 0) / novel.targetWords) * 100)
    : 0
  const commitments = listEndgameCommitments(novelId)
  const volumeRanges = getVolumeRanges(novelId)
  const countsByVolume = new Map<number, {
    pending: number
    served: number
    overdue: number
    fulfilled: number
    unbound: number
  }>()

  const addVolumeCount = (volumeId: number | undefined, key: 'pending' | 'served' | 'overdue' | 'fulfilled' | 'unbound') => {
    if (typeof volumeId !== 'number') return
    const current = countsByVolume.get(volumeId) || {
      pending: 0,
      served: 0,
      overdue: 0,
      fulfilled: 0,
      unbound: 0,
    }
    current[key] += 1
    countsByVolume.set(volumeId, current)
  }

  const items = commitments
    .filter((item) => item.derivedStatus !== 'waived')
    .map((item) => {
      const lastServedGap = typeof item.lastServedChapter === 'number'
        ? currentChapterNum - item.lastServedChapter
        : currentChapterNum
      const unbound = item.derivedStatus !== 'fulfilled' && item.referenceCount <= 0
      const stale = item.derivedStatus !== 'fulfilled' && item.derivedStatus !== 'waived' && lastServedGap >= ENDGAME_STALE_WINDOW
      const severity = (
        item.overdue
          ? 'critical'
          : unbound && progressPercent >= 70
            ? 'critical'
            : 'warning'
      ) as 'warning' | 'critical'
      const volumeId = item.referencedVolumeIds[0]
        || resolveVolumeIdByChapter(item.targetResolutionChapter ?? item.lastServedChapter, volumeRanges)
        || resolveVolumeIdByChapter(currentChapterNum, volumeRanges)
      addVolumeCount(volumeId, item.derivedStatus === 'fulfilled' ? 'fulfilled' : item.overdue ? 'overdue' : item.derivedStatus === 'served' ? 'served' : 'pending')
      if (unbound) addVolumeCount(volumeId, 'unbound')
      return {
        commitmentId: item.id,
        title: item.title,
        description: item.description || undefined,
        kind: item.commitmentKind as CommitmentKind,
        status: item.derivedStatus,
        referenceCount: item.referenceCount,
        lastServedChapter: item.lastServedChapter,
        targetResolutionChapter: item.targetResolutionChapter ?? undefined,
        volumeId,
        volumeName: volumeRanges.find((range) => range.volumeId === volumeId)?.volumeName,
        overdue: item.overdue,
        unbound,
        stale,
        severity,
        detail: item.overdue
          ? `目标章位 ${item.targetResolutionChapter || '未设置'} 已经过期，仍未被卷级设计、章节合同、场景合同或伏笔账本服务。`
          : unbound
            ? '当前还没有任何卷级设计、章节合同、场景合同或伏笔账本引用该终局承诺。'
            : stale
              ? `该终局承诺距离上次被服务已过去 ${lastServedGap} 章。`
              : '该终局承诺已进入执行链，但仍需继续跟进。',
      }
    })

  return {
    currentChapterNum,
    progressPercent,
    overview: {
      activeCount: items.filter((item) => item.status === 'active').length,
      servedCount: items.filter((item) => item.status === 'served').length,
      fulfilledCount: items.filter((item) => item.status === 'fulfilled').length,
      overdueCount: items.filter((item) => item.overdue).length,
      unboundCount: items.filter((item) => item.unbound).length,
    },
    countsByVolume,
    items,
    recentAlerts: items
      .sort((left, right) => {
        const rank = (value: string) => (value === 'critical' ? 2 : value === 'warning' ? 1 : 0)
        return rank(right.severity) - rank(left.severity)
          || (right.targetResolutionChapter || 0) - (left.targetResolutionChapter || 0)
      })
      .slice(0, 8),
  }
}
