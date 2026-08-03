import { and, eq, inArray } from 'drizzle-orm'
import {
  characters,
  chapters,
  factions,
  novels,
  storyItems,
  storyThreads,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { getDb } from '../database/db'
import { creativeStageAssetKey, type CreativeStageAssetBinding, type CreativeStageAssetBrief } from '../../src/shared/creative-stages'

const DEFAULT_MAX_DETAIL = 220
const WORKING_MAX_DETAIL = 320
const CANONICAL_MAX_DETAIL = 440

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clip(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function joinParts(parts: unknown[], separator = '；'): string {
  return parts.map(text).filter(Boolean).join(separator)
}

function maxDetailFor(asset: CreativeStageAssetBinding): number {
  if (asset.detailLevel === 'canonical') return CANONICAL_MAX_DETAIL
  if (asset.detailLevel === 'working') return WORKING_MAX_DETAIL
  return DEFAULT_MAX_DETAIL
}

function hasAssetDetail(asset: CreativeStageAssetBinding, minimum: CreativeStageAssetBinding['detailLevel']): boolean {
  const order: Record<CreativeStageAssetBinding['detailLevel'], number> = {
    placeholder: 0,
    outline: 1,
    working: 2,
    canonical: 3,
  }
  return order[asset.detailLevel] >= order[minimum]
}

function assetIds(assets: CreativeStageAssetBinding[], assetType: CreativeStageAssetBinding['assetType']): number[] {
  return [...new Set(assets
    .filter((asset) => asset.assetType === assetType && typeof asset.assetId === 'number')
    .map((asset) => asset.assetId as number))]
}

function rowsById<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

function queryByIds<T extends { id: number }>(
  table: unknown,
  idColumn: unknown,
  novelColumn: unknown,
  novelId: number,
  ids: number[],
): T[] {
  if (ids.length === 0) return []
  const db = getDb()
  return db.select().from(table as never)
    .where(and(eq(novelColumn as never, novelId), inArray(idColumn as never, ids)))
    .all() as T[]
}

function briefDetail(asset: CreativeStageAssetBinding, canonicalDetail: string): string {
  const stageNote = joinParts([asset.notes, asset.requestedFieldsJson ? `需要关注：${asset.requestedFieldsJson}` : ''])
  return clip(joinParts([canonicalDetail, stageNote]), maxDetailFor(asset))
}

export function selectCreativeStageAssetBindings(
  assets: CreativeStageAssetBinding[],
  briefs: CreativeStageAssetBrief[],
  signalText?: string,
  maxAssets = 18,
): CreativeStageAssetBinding[] {
  const normalizedSignal = text(signalText).toLocaleLowerCase()
  if (!normalizedSignal) return assets
  const briefByKey = new Map(briefs.map((brief) => [creativeStageAssetKey(brief), brief]))
  const ranked = assets
    .filter((asset) => !['retired', 'deferred'].includes(asset.status))
    .map((asset, index) => {
      const brief = briefByKey.get(creativeStageAssetKey(asset))
      const names = [asset.placeholderName, brief?.name].map(text).filter(Boolean)
      const matched = names.some((name) => normalizedSignal.includes(name.toLocaleLowerCase()))
      const score = (asset.role === 'core' ? 1000 : asset.role === 'handoff' ? 800 : 0)
        + (matched ? 400 : 0)
        + (asset.detailLevel === 'canonical' ? 20 : asset.detailLevel === 'working' ? 10 : 0)
        - index / 100
      return { asset, score, index }
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const selected = ranked.slice(0, Math.max(1, maxAssets)).sort((left, right) => left.index - right.index)
  return selected.map((entry) => entry.asset)
}

/**
 * Resolve only the stage-bound asset IDs in bounded, writer-safe projections.
 * This is deliberately separate from the full context builder so retrieval
 * cost grows with the current window, not with the whole novel bible.
 */
export function resolveCreativeStageAssetBriefs(novelId: number, assets: CreativeStageAssetBinding[]): CreativeStageAssetBrief[] {
  const db = getDb()
  const characterRows = queryByIds<typeof characters.$inferSelect>(characters, characters.id, characters.novelId, novelId, assetIds(assets, 'character'))
  const mapRows = queryByIds<typeof worldMap.$inferSelect>(worldMap, worldMap.id, worldMap.novelId, novelId, assetIds(assets, 'map'))
  const factionRows = queryByIds<typeof factions.$inferSelect>(factions, factions.id, factions.novelId, novelId, assetIds(assets, 'faction'))
  const itemRows = queryByIds<typeof storyItems.$inferSelect>(storyItems, storyItems.id, storyItems.novelId, novelId, assetIds(assets, 'item'))
  const threadRows = queryByIds<typeof storyThreads.$inferSelect>(storyThreads, storyThreads.id, storyThreads.novelId, novelId, assetIds(assets, 'thread'))
  const timelineRows = queryByIds<typeof timelineEvents.$inferSelect>(timelineEvents, timelineEvents.id, timelineEvents.novelId, novelId, assetIds(assets, 'timeline'))
  const outlineRows = queryByIds<typeof chapters.$inferSelect>(chapters, chapters.id, chapters.novelId, novelId, assetIds(assets, 'outline'))
  const characterById = rowsById(characterRows)
  const mapById = rowsById(mapRows)
  const factionById = rowsById(factionRows)
  const itemById = rowsById(itemRows)
  const threadById = rowsById(threadRows)
  const timelineById = rowsById(timelineRows)
  const outlineById = rowsById(outlineRows)
  const worldAssetRequested = assets.some((asset) => asset.assetType === 'world')
  const novel = worldAssetRequested
    ? db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
    : undefined

  return assets.slice(0, 50).map((asset) => {
    const name = asset.placeholderName?.trim() || `${asset.assetType}#${asset.assetId ?? '待建'}`
    let canonicalName = name
    let detail = ''
    if (asset.assetType === 'character' && asset.assetId) {
      const row = characterById.get(asset.assetId)
      canonicalName = text(row?.fullName) || name
      detail = joinParts([
        row?.roleType ? `身份：${row.roleType}` : '',
        row?.occupation ? `职业：${row.occupation}` : '',
        hasAssetDetail(asset, 'outline') && row?.background ? `背景：${row.background}` : '',
        hasAssetDetail(asset, 'working') && row?.goals ? `当前目标：${row.goals}` : '',
        hasAssetDetail(asset, 'canonical') && row?.characterArc ? `人物弧：${row.characterArc}` : '',
        hasAssetDetail(asset, 'canonical') && row?.speechPattern ? `说话方式：${row.speechPattern}` : '',
      ])
    } else if (asset.assetType === 'map' && asset.assetId) {
      const row = mapById.get(asset.assetId)
      canonicalName = text(row?.name) || name
      detail = joinParts([
        row?.nodeType || row?.locationType ? `地点类型：${row.nodeType || row.locationType}` : '',
        hasAssetDetail(asset, 'outline') ? row?.description : '',
        hasAssetDetail(asset, 'working') && row?.plotRelevance ? `剧情作用：${row.plotRelevance}` : '',
        hasAssetDetail(asset, 'canonical') && row?.atmosphere ? `氛围：${row.atmosphere}` : '',
        hasAssetDetail(asset, 'canonical') && row?.dangerLevel ? `风险：${row.dangerLevel}` : '',
      ])
    } else if (asset.assetType === 'faction' && asset.assetId) {
      const row = factionById.get(asset.assetId)
      canonicalName = text(row?.name) || name
      detail = joinParts([
        row?.type ? `类型：${row.type}` : '',
        hasAssetDetail(asset, 'outline') && row?.goal ? `目标：${row.goal}` : '',
        hasAssetDetail(asset, 'working') && row?.resources ? `资源：${row.resources}` : '',
        hasAssetDetail(asset, 'canonical') && row?.currentPhase ? `当前阶段：${row.currentPhase}` : '',
      ])
    } else if (asset.assetType === 'item' && asset.assetId) {
      const row = itemById.get(asset.assetId)
      canonicalName = text(row?.itemName) || name
      detail = joinParts([
        row?.summary,
        hasAssetDetail(asset, 'working') && row?.plotFunction ? `剧情作用：${row.plotFunction}` : '',
        row?.ownerCharacterId ? `持有者：人物#${row.ownerCharacterId}` : '',
        hasAssetDetail(asset, 'working') && row?.cost ? `代价：${row.cost}` : '',
        hasAssetDetail(asset, 'canonical') && row?.limitations ? `限制：${row.limitations}` : '',
      ])
    } else if (asset.assetType === 'thread' && asset.assetId) {
      const row = threadById.get(asset.assetId)
      canonicalName = text(row?.title) || name
      detail = joinParts([
        row?.summary || row?.premise,
        hasAssetDetail(asset, 'working') && row?.currentState ? `当前状态：${row.currentState}` : '',
        row?.status ? `状态：${row.status}` : '',
        hasAssetDetail(asset, 'canonical') && row?.targetPayoffChapter ? `目标回收章：第${row.targetPayoffChapter}章` : '',
      ])
    } else if (asset.assetType === 'timeline' && asset.assetId) {
      const row = timelineById.get(asset.assetId)
      canonicalName = text(row?.eventTitle) || name
      detail = joinParts([
        row?.timeLabel ? `时间：${row.timeLabel}` : '',
        row?.eventSummary,
        hasAssetDetail(asset, 'working') && row?.eventResult ? `结果：${row.eventResult}` : '',
        hasAssetDetail(asset, 'working') && row?.openThreadsJson ? `未决线程：${row.openThreadsJson}` : '',
      ])
    } else if (asset.assetType === 'outline' && asset.assetId) {
      const row = outlineById.get(asset.assetId)
      canonicalName = text(row?.title) || name
      detail = joinParts([
        row?.summary,
        row?.nextChapterSeed ? `下一步：${row.nextChapterSeed}` : '',
      ])
    } else if (asset.assetType === 'world') {
      detail = text(novel?.worldRulesJson) ? `世界规则摘要：${clip(text(novel?.worldRulesJson), maxDetailFor(asset))}` : ''
    }
    return {
      assetType: asset.assetType,
      ...(asset.assetId ? { assetId: asset.assetId } : {}),
      name: canonicalName,
      detail: briefDetail(asset, detail) || '当前阶段仅登记资产名称，正文不得自行扩写未确认事实。',
    }
  })
}

export function getCreativeStageAssetBriefKey(asset: Pick<CreativeStageAssetBrief, 'assetType' | 'assetId' | 'name'>): string {
  return creativeStageAssetKey({ assetType: asset.assetType, assetId: asset.assetId, placeholderName: asset.name })
}
