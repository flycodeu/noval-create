import { asc, desc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapterContracts,
  chapters,
  growthTracks,
  novels,
  resourcePools,
  rewardCostEvents,
  storyVolumes,
  volumeDesigns,
} from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'
import { throwUserFacingError } from '../utils/user-facing-error'

type GrowthTrackType = 'character' | 'organization' | 'relationship'
type ResourcePoolType = 'material' | 'authority' | 'relationship' | 'knowledge' | 'time'
type ScarcityLevel = 'abundant' | 'balanced' | 'scarce' | 'critical'
type RewardCostEventType = 'reward' | 'cost' | 'bottleneck'
type CostResolutionState = 'new' | 'ongoing' | 'resolved' | 'evaporated'
type RewardLevel = 'none' | 'partial' | 'major'

interface GrowthTrackInput {
  id?: number
  trackType?: GrowthTrackType
  sourceEntityType?: string
  sourceEntityId?: number | null
  sourceEntityLabel?: string
  title?: string
  currentTier?: string
  stageGoal?: string
  nextGoal?: string
  bottleneck?: string
  scarceResource?: string
  acquirePath?: string
  consumptionRule?: string
  failureCost?: string
  rewardCadence?: string
  linkedVolumeId?: number | null
  linkedChapterId?: number | null
  status?: string
  sortOrder?: number
}

interface ResourcePoolInput {
  id?: number
  name?: string
  poolType?: ResourcePoolType
  scarcityLevel?: ScarcityLevel
  currentReserve?: string
  unit?: string
  replenishPath?: string
  consumptionRule?: string
  failureCost?: string
  pressureSource?: string
  linkedVolumeId?: number | null
  notes?: string
}

interface RewardCostEventInput {
  id?: number
  chapterId?: number | null
  eventType?: RewardCostEventType
  title?: string
  summary?: string
  trackId?: number | null
  resourcePoolId?: number | null
  deltaValue?: string
  costResolutionState?: CostResolutionState
  rewardLevel?: RewardLevel
  nextBottleneck?: string
  linkedVolumeId?: number | null
}

interface ChapterBindingInput {
  chapterId: number
  trackIds: number[]
  poolIds: number[]
  eventIds: number[]
}

interface VolumeBindingInput {
  volumeId: number
  trackIds: number[]
  poolIds: number[]
  rewardCadence?: string
}

const GROWTH_BIND_PREFIX = '[成长系统]'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function asJsonStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => asText(item))
      .filter(Boolean)
  } catch {
    return []
  }
}

function toJsonStringArray(values: string[]): string {
  return JSON.stringify([...new Set(values.map((item) => asText(item)).filter(Boolean))])
}

function normalizeTrackType(value: unknown): GrowthTrackType {
  const text = asText(value)
  if (text === 'organization' || text === 'relationship') return text
  return 'character'
}

function normalizePoolType(value: unknown): ResourcePoolType {
  const text = asText(value)
  if (text === 'authority' || text === 'relationship' || text === 'knowledge' || text === 'time') return text
  return 'material'
}

function normalizeScarcityLevel(value: unknown): ScarcityLevel {
  const text = asText(value)
  if (text === 'abundant' || text === 'scarce' || text === 'critical') return text
  return 'balanced'
}

function normalizeEventType(value: unknown): RewardCostEventType {
  const text = asText(value)
  if (text === 'cost' || text === 'bottleneck') return text
  return 'reward'
}

function normalizeCostState(value: unknown): CostResolutionState {
  const text = asText(value)
  if (text === 'ongoing' || text === 'resolved' || text === 'evaporated') return text
  return 'new'
}

function normalizeRewardLevel(value: unknown): RewardLevel {
  const text = asText(value)
  if (text === 'partial' || text === 'major') return text
  return 'none'
}

function ensureNovelExists(novelId: number) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  return novel
}

function getChapterNumById(chapterId: number | null | undefined): number | null {
  if (typeof chapterId !== 'number') return null
  const db = getDb()
  const row = db.select({
    chapterNum: chapters.chapterNum,
  }).from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  return row?.chapterNum ?? null
}

function mergeGrowthRefs(existing: string[], nextGrowthRefs: string[]): string[] {
  const cleaned = existing.filter((item) => !item.startsWith(GROWTH_BIND_PREFIX))
  return [...cleaned, ...nextGrowthRefs]
}

function mergeGrowthLines(existingText: string, nextGrowthLines: string[]): string {
  const lines = existingText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith(GROWTH_BIND_PREFIX))
  return [...lines, ...nextGrowthLines].filter(Boolean).join('\n')
}

export function listGrowthTracks(novelId: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  return db.select().from(growthTracks)
    .where(eq(growthTracks.novelId, novelId))
    .orderBy(asc(growthTracks.trackType), asc(growthTracks.sortOrder), asc(growthTracks.id))
    .all()
}

export function upsertGrowthTrack(novelId: number, input: GrowthTrackInput) {
  ensureNovelExists(novelId)
  const db = getDb()
  const timestamp = new Date().toISOString()
  if (input.id) {
    const current = db.select().from(growthTracks).where(eq(growthTracks.id, input.id)).all()[0]
    if (!current || current.novelId !== novelId) throwUserFacingError('common.loadFailed')
    db.update(growthTracks).set({
      trackType: 'trackType' in input ? normalizeTrackType(input.trackType) : current.trackType,
      sourceEntityType: 'sourceEntityType' in input ? asText(input.sourceEntityType) || null : current.sourceEntityType,
      sourceEntityId: 'sourceEntityId' in input ? asNumber(input.sourceEntityId) : current.sourceEntityId,
      sourceEntityLabel: 'sourceEntityLabel' in input ? asText(input.sourceEntityLabel) || null : current.sourceEntityLabel,
      title: 'title' in input ? asText(input.title) || current.title : current.title,
      currentTier: 'currentTier' in input ? asText(input.currentTier) || null : current.currentTier,
      stageGoal: 'stageGoal' in input ? asText(input.stageGoal) || null : current.stageGoal,
      nextGoal: 'nextGoal' in input ? asText(input.nextGoal) || null : current.nextGoal,
      bottleneck: 'bottleneck' in input ? asText(input.bottleneck) || null : current.bottleneck,
      scarceResource: 'scarceResource' in input ? asText(input.scarceResource) || null : current.scarceResource,
      acquirePath: 'acquirePath' in input ? asText(input.acquirePath) || null : current.acquirePath,
      consumptionRule: 'consumptionRule' in input ? asText(input.consumptionRule) || null : current.consumptionRule,
      failureCost: 'failureCost' in input ? asText(input.failureCost) || null : current.failureCost,
      rewardCadence: 'rewardCadence' in input ? asText(input.rewardCadence) || null : current.rewardCadence,
      linkedVolumeId: 'linkedVolumeId' in input ? asNumber(input.linkedVolumeId) : current.linkedVolumeId,
      linkedChapterId: 'linkedChapterId' in input ? asNumber(input.linkedChapterId) : current.linkedChapterId,
      status: 'status' in input ? asText(input.status) || current.status : current.status,
      sortOrder: 'sortOrder' in input ? asNumber(input.sortOrder) ?? current.sortOrder : current.sortOrder,
      updatedAt: timestamp,
    }).where(eq(growthTracks.id, input.id)).run()
  } else {
    db.insert(growthTracks).values({
      novelId,
      trackType: normalizeTrackType(input.trackType),
      sourceEntityType: asText(input.sourceEntityType) || null,
      sourceEntityId: asNumber(input.sourceEntityId) ?? null,
      sourceEntityLabel: asText(input.sourceEntityLabel) || null,
      title: asText(input.title) || '未命名成长轨道',
      currentTier: asText(input.currentTier) || null,
      stageGoal: asText(input.stageGoal) || null,
      nextGoal: asText(input.nextGoal) || null,
      bottleneck: asText(input.bottleneck) || null,
      scarceResource: asText(input.scarceResource) || null,
      acquirePath: asText(input.acquirePath) || null,
      consumptionRule: asText(input.consumptionRule) || null,
      failureCost: asText(input.failureCost) || null,
      rewardCadence: asText(input.rewardCadence) || null,
      linkedVolumeId: asNumber(input.linkedVolumeId) ?? null,
      linkedChapterId: asNumber(input.linkedChapterId) ?? null,
      status: asText(input.status) || 'active',
      sortOrder: asNumber(input.sortOrder) ?? 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }
  markNovelContextChanged(novelId, 'Growth tracks updated')
  return listGrowthTracks(novelId)
}

export function deleteGrowthTrack(novelId: number, id: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  const current = db.select().from(growthTracks).where(eq(growthTracks.id, id)).all()[0]
  if (!current || current.novelId !== novelId) return listGrowthTracks(novelId)
  db.delete(growthTracks).where(eq(growthTracks.id, id)).run()
  markNovelContextChanged(novelId, 'Growth track deleted')
  return listGrowthTracks(novelId)
}

export function listResourcePools(novelId: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  return db.select().from(resourcePools)
    .where(eq(resourcePools.novelId, novelId))
    .orderBy(desc(resourcePools.scarcityLevel), asc(resourcePools.id))
    .all()
}

export function upsertResourcePool(novelId: number, input: ResourcePoolInput) {
  ensureNovelExists(novelId)
  const db = getDb()
  const timestamp = new Date().toISOString()
  if (input.id) {
    const current = db.select().from(resourcePools).where(eq(resourcePools.id, input.id)).all()[0]
    if (!current || current.novelId !== novelId) throwUserFacingError('common.loadFailed')
    db.update(resourcePools).set({
      name: 'name' in input ? asText(input.name) || current.name : current.name,
      poolType: 'poolType' in input ? normalizePoolType(input.poolType) : current.poolType,
      scarcityLevel: 'scarcityLevel' in input ? normalizeScarcityLevel(input.scarcityLevel) : current.scarcityLevel,
      currentReserve: 'currentReserve' in input ? asText(input.currentReserve) || null : current.currentReserve,
      unit: 'unit' in input ? asText(input.unit) || null : current.unit,
      replenishPath: 'replenishPath' in input ? asText(input.replenishPath) || null : current.replenishPath,
      consumptionRule: 'consumptionRule' in input ? asText(input.consumptionRule) || null : current.consumptionRule,
      failureCost: 'failureCost' in input ? asText(input.failureCost) || null : current.failureCost,
      pressureSource: 'pressureSource' in input ? asText(input.pressureSource) || null : current.pressureSource,
      linkedVolumeId: 'linkedVolumeId' in input ? asNumber(input.linkedVolumeId) : current.linkedVolumeId,
      notes: 'notes' in input ? asText(input.notes) || null : current.notes,
      updatedAt: timestamp,
    }).where(eq(resourcePools.id, input.id)).run()
  } else {
    db.insert(resourcePools).values({
      novelId,
      name: asText(input.name) || '未命名资源池',
      poolType: normalizePoolType(input.poolType),
      scarcityLevel: normalizeScarcityLevel(input.scarcityLevel),
      currentReserve: asText(input.currentReserve) || null,
      unit: asText(input.unit) || null,
      replenishPath: asText(input.replenishPath) || null,
      consumptionRule: asText(input.consumptionRule) || null,
      failureCost: asText(input.failureCost) || null,
      pressureSource: asText(input.pressureSource) || null,
      linkedVolumeId: asNumber(input.linkedVolumeId) ?? null,
      notes: asText(input.notes) || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }
  markNovelContextChanged(novelId, 'Resource pools updated')
  return listResourcePools(novelId)
}

export function deleteResourcePool(novelId: number, id: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  const current = db.select().from(resourcePools).where(eq(resourcePools.id, id)).all()[0]
  if (!current || current.novelId !== novelId) return listResourcePools(novelId)
  db.delete(resourcePools).where(eq(resourcePools.id, id)).run()
  markNovelContextChanged(novelId, 'Resource pool deleted')
  return listResourcePools(novelId)
}

export function listRewardCostEvents(novelId: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  return db.select().from(rewardCostEvents)
    .where(eq(rewardCostEvents.novelId, novelId))
    .orderBy(desc(rewardCostEvents.chapterNumSnapshot), desc(rewardCostEvents.id))
    .all()
}

export function upsertRewardCostEvent(novelId: number, input: RewardCostEventInput) {
  ensureNovelExists(novelId)
  const db = getDb()
  const timestamp = new Date().toISOString()
  const chapterId = asNumber(input.chapterId)
  const chapterNumSnapshot = getChapterNumById(chapterId)
  if (input.id) {
    const current = db.select().from(rewardCostEvents).where(eq(rewardCostEvents.id, input.id)).all()[0]
    if (!current || current.novelId !== novelId) throwUserFacingError('common.loadFailed')
    db.update(rewardCostEvents).set({
      chapterId: 'chapterId' in input ? chapterId : current.chapterId,
      chapterNumSnapshot: 'chapterId' in input ? chapterNumSnapshot : current.chapterNumSnapshot,
      eventType: 'eventType' in input ? normalizeEventType(input.eventType) : current.eventType,
      title: 'title' in input ? asText(input.title) || current.title : current.title,
      summary: 'summary' in input ? asText(input.summary) || null : current.summary,
      trackId: 'trackId' in input ? asNumber(input.trackId) : current.trackId,
      resourcePoolId: 'resourcePoolId' in input ? asNumber(input.resourcePoolId) : current.resourcePoolId,
      deltaValue: 'deltaValue' in input ? asText(input.deltaValue) || null : current.deltaValue,
      costResolutionState: 'costResolutionState' in input ? normalizeCostState(input.costResolutionState) : current.costResolutionState,
      rewardLevel: 'rewardLevel' in input ? normalizeRewardLevel(input.rewardLevel) : current.rewardLevel,
      nextBottleneck: 'nextBottleneck' in input ? asText(input.nextBottleneck) || null : current.nextBottleneck,
      linkedVolumeId: 'linkedVolumeId' in input ? asNumber(input.linkedVolumeId) : current.linkedVolumeId,
      updatedAt: timestamp,
    }).where(eq(rewardCostEvents.id, input.id)).run()
  } else {
    db.insert(rewardCostEvents).values({
      novelId,
      chapterId: chapterId ?? null,
      chapterNumSnapshot: chapterNumSnapshot ?? null,
      eventType: normalizeEventType(input.eventType),
      title: asText(input.title) || '未命名收益/代价回写',
      summary: asText(input.summary) || null,
      trackId: asNumber(input.trackId) ?? null,
      resourcePoolId: asNumber(input.resourcePoolId) ?? null,
      deltaValue: asText(input.deltaValue) || null,
      costResolutionState: normalizeCostState(input.costResolutionState),
      rewardLevel: normalizeRewardLevel(input.rewardLevel),
      nextBottleneck: asText(input.nextBottleneck) || null,
      linkedVolumeId: asNumber(input.linkedVolumeId) ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }
  markNovelContextChanged(novelId, 'Reward/cost events updated')
  return listRewardCostEvents(novelId)
}

export function deleteRewardCostEvent(novelId: number, id: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  const current = db.select().from(rewardCostEvents).where(eq(rewardCostEvents.id, id)).all()[0]
  if (!current || current.novelId !== novelId) return listRewardCostEvents(novelId)
  db.delete(rewardCostEvents).where(eq(rewardCostEvents.id, id)).run()
  markNovelContextChanged(novelId, 'Reward/cost event deleted')
  return listRewardCostEvents(novelId)
}

export function bindGrowthAssetsToChapterContract(novelId: number, input: ChapterBindingInput) {
  ensureNovelExists(novelId)
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, input.chapterId)).all()[0]
  if (!chapter || chapter.novelId !== novelId) throwUserFacingError('common.loadFailed')

  const tracks = listGrowthTracks(novelId).filter((item) => input.trackIds.includes(item.id))
  const pools = listResourcePools(novelId).filter((item) => input.poolIds.includes(item.id))
  const events = listRewardCostEvents(novelId).filter((item) => input.eventIds.includes(item.id))

  const growthRefs = [
    ...tracks.map((item) => `${GROWTH_BIND_PREFIX} 成长轨道#${item.id} · ${item.title}`),
    ...pools.map((item) => `${GROWTH_BIND_PREFIX} 资源池#${item.id} · ${item.name} · 稀缺=${item.scarcityLevel}`),
    ...events.map((item) => `${GROWTH_BIND_PREFIX} 回写事件#${item.id} · ${item.eventType} · ${item.title}`),
  ]

  const existingContract = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, input.chapterId)).all()[0]
  const nextNotes = `${GROWTH_BIND_PREFIX} 本章收益/代价约束已绑定（轨道${tracks.length}、资源池${pools.length}、事件${events.length}）。`
  const timestamp = new Date().toISOString()

  if (existingContract) {
    const currentRefs = asJsonStringArray(existingContract.requiredAssetRefsJson)
    const currentNotes = asJsonStringArray(existingContract.acceptanceNotesJson)
    db.update(chapterContracts).set({
      requiredAssetRefsJson: toJsonStringArray(mergeGrowthRefs(currentRefs, growthRefs)),
      acceptanceNotesJson: toJsonStringArray(mergeGrowthRefs(currentNotes, [nextNotes])),
      updatedAt: timestamp,
    }).where(eq(chapterContracts.id, existingContract.id)).run()
  } else {
    db.insert(chapterContracts).values({
      novelId,
      chapterId: input.chapterId,
      requiredAssetRefsJson: toJsonStringArray(growthRefs),
      acceptanceNotesJson: toJsonStringArray([nextNotes]),
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }

  markNovelContextChanged(novelId, 'Growth assets bound to chapter contract')
  return {
    chapterId: input.chapterId,
    boundTrackCount: tracks.length,
    boundPoolCount: pools.length,
    boundEventCount: events.length,
  }
}

export function bindGrowthAssetsToVolumeDesign(novelId: number, input: VolumeBindingInput) {
  ensureNovelExists(novelId)
  const db = getDb()
  const volume = db.select().from(storyVolumes).where(eq(storyVolumes.id, input.volumeId)).all()[0]
  if (!volume || volume.novelId !== novelId) throwUserFacingError('common.loadFailed')

  const tracks = listGrowthTracks(novelId).filter((item) => input.trackIds.includes(item.id))
  const pools = listResourcePools(novelId).filter((item) => input.poolIds.includes(item.id))
  const cadence = asText(input.rewardCadence)
  const growthLines = [
    tracks.length > 0 ? `${GROWTH_BIND_PREFIX} 绑定成长轨道：${tracks.map((item) => `#${item.id}-${item.title}`).join('；')}` : '',
    pools.length > 0 ? `${GROWTH_BIND_PREFIX} 绑定资源池：${pools.map((item) => `#${item.id}-${item.name}[${item.scarcityLevel}]`).join('；')}` : '',
    cadence ? `${GROWTH_BIND_PREFIX} 卷级节奏约束：${cadence}` : '',
  ].filter(Boolean)

  const existing = db.select().from(volumeDesigns).where(eq(volumeDesigns.volumeId, input.volumeId)).all()[0]
  const timestamp = new Date().toISOString()
  if (existing) {
    db.update(volumeDesigns).set({
      readerExpectation: mergeGrowthLines(existing.readerExpectation || '', growthLines),
      updatedAt: timestamp,
    }).where(eq(volumeDesigns.id, existing.id)).run()
  } else {
    db.insert(volumeDesigns).values({
      novelId,
      volumeId: input.volumeId,
      readerExpectation: growthLines.join('\n'),
      auditStatus: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()
  }
  markNovelContextChanged(novelId, 'Growth assets bound to volume design')
  return {
    volumeId: input.volumeId,
    boundTrackCount: tracks.length,
    boundPoolCount: pools.length,
  }
}

export function getGrowthSystemDashboard(novelId: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  const tracks = listGrowthTracks(novelId)
  const pools = listResourcePools(novelId)
  const events = listRewardCostEvents(novelId)
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    title: chapters.title,
  }).from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
  const volumeRows = db.select({
    id: storyVolumes.id,
    volumeNumber: storyVolumes.volumeNumber,
    title: storyVolumes.title,
  }).from(storyVolumes).where(eq(storyVolumes.novelId, novelId)).orderBy(asc(storyVolumes.volumeNumber)).all()
  const criticalPools = pools.filter((item) => item.scarcityLevel === 'critical' || item.scarcityLevel === 'scarce')
  const unresolvedCosts = events.filter((item) => item.eventType === 'cost' && item.costResolutionState !== 'resolved')
  const chapterWritebackCoverage = chapterRows.length > 0
    ? events.filter((item) => typeof item.chapterId === 'number').length / chapterRows.length
    : 0
  return {
    tracks,
    pools,
    events,
    chapters: chapterRows,
    volumes: volumeRows,
    summary: {
      trackCount: tracks.length,
      characterTrackCount: tracks.filter((item) => item.trackType === 'character').length,
      organizationTrackCount: tracks.filter((item) => item.trackType === 'organization').length,
      relationshipTrackCount: tracks.filter((item) => item.trackType === 'relationship').length,
      criticalPoolCount: criticalPools.length,
      unresolvedCostCount: unresolvedCosts.length,
      chapterWritebackCoverage,
    },
  }
}

