import type { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import type {
  Character as AppCharacter,
  Faction as AppFaction,
  FactionBatchGenerationOptions,
  FactionGraphCharacterSummary,
  FactionGraphPayload,
  FactionGraphQueryInput,
  FactionStats,
} from '../../src/types'
import { getDb } from '../database/db'
import { characters, factions, novels, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { createTask, executeChatTask, updateTask } from './task.service'
import {
  FACTION_TYPE_OPTIONS,
  FACTION_RELATION_TYPE_OPTIONS,
  buildFactionExternalRelationsPayload,
  formatFactionTypeForPrompt,
  getFactionRelationColor,
  getFactionRelationLabel,
  getFactionTypeLabel,
  normalizeFactionTypeValue,
  parseFactionExternalRelations,
} from '../../src/shared/factions'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import { markNovelContextChanged } from './context-impact.service'
import {
  appendVariationMessage,
  buildVariationDigest,
  isRejectedDigestTooSimilar,
} from './variation-control.service'
import {
  parseFactionReferenceArray,
  stringifyFactionReferences,
} from './faction-reference.service'
import { refreshWorldStateVersionsForNovel } from './world-state.service'
import { throwUserFacingError } from '../utils/user-facing-error'

interface FactionQueryFilters {
  novelId: number
  type?: AppFaction['type']
  keyword?: string
  page?: number
  pageSize?: number
}

interface FactionGenerateRuntimeOptions {
  parentTaskId?: number
  sender?: WebContents
  batchIndex?: number
  totalBatches?: number
}

interface FactionBatchChunkResult {
  ids: number[]
  warning?: string
  batchDigest?: string
}

interface GeneratedFactionCandidate {
  name?: unknown
  type?: unknown
  goal?: unknown
  resources?: unknown
  memberPolicy?: unknown
  currentPhase?: unknown
  notes?: unknown
  leaderName?: unknown
  territoryNames?: unknown
  linkedCharacterNames?: unknown
  externalRelations?: unknown
}

const DEFAULT_BATCH_OPTIONS: FactionBatchGenerationOptions = {
  count: 8,
  batchSize: 4,
  preferredTypes: ['organization', 'sect', 'family'],
  relationshipDensity: 'balanced',
  allowCharacterlessFactions: true,
  preferExistingCharacters: true,
  specialRequirements: '',
}

const FACTION_ANIMAL_NAME_BLOCKLIST = new Set([
  '穿山甲',
  '老虎',
  '狮子',
  '狐狸',
  '野狼',
  '狼',
  '熊猫',
  '黑熊',
  '棕熊',
  '白鹭',
  '乌鸦',
  '猎豹',
  '蟒蛇',
  '海豚',
  '鲨鱼',
  '野猪',
  '山羊',
  '水牛',
  '兔子',
  '猫',
  '狗',
])

const FACTION_ORGANIZATION_HINT_RE = /(会|盟|门|宗|派|帮|团|军|府|阁|宫|殿|司|局|部|署|院|台|厅|社|寨|族|国|朝|教|商会|公司|行|坊)$/

function normalizePage(page?: number, pageSize?: number) {
  const nextPage = Math.max(1, page || 1)
  const nextPageSize = Math.max(1, Math.min(pageSize || 24, 500))
  return {
    page: nextPage,
    pageSize: nextPageSize,
    offset: (nextPage - 1) * nextPageSize,
  }
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

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function normalizeFactionType(value: unknown, fallback: AppFaction['type'] = 'faction'): AppFaction['type'] {
  return normalizeFactionTypeValue(asText(value), fallback)
}

function stringifyNumberArray(input: unknown): string {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed
          .map((item) => asNumber(item))
          .filter((item): item is number => typeof item === 'number'))
      }
    } catch {
      return '[]'
    }
  }

  if (!Array.isArray(input)) return '[]'
  return JSON.stringify(input
    .map((item) => asNumber(item))
    .filter((item): item is number => typeof item === 'number'))
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((item) => (typeof item === 'number' ? item : Number(item))).filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function looksLikeNonFactionName(name: string): boolean {
  const compact = name.trim().replace(/\s+/g, '')
  if (!compact) return true
  if (FACTION_ANIMAL_NAME_BLOCKLIST.has(compact)) return true
  if (compact.length <= 4 && /(兽|鸟|鱼|虫)$/.test(compact) && !FACTION_ORGANIZATION_HINT_RE.test(compact)) return true
  return false
}

function sanitizeFactionPayload(
  novelId: number,
  data: Partial<typeof factions.$inferInsert>,
): Partial<typeof factions.$inferInsert> {
  const next: Partial<typeof factions.$inferInsert> = {}

  if (typeof data.name === 'string') next.name = asText(data.name)
  if (typeof data.type === 'string') next.type = normalizeFactionType(data.type)
  if (typeof data.goal === 'string') next.goal = asText(data.goal)
  if (typeof data.resources === 'string') next.resources = asText(data.resources)
  if ('territoryMapNodeIdsJson' in data) next.territoryMapNodeIdsJson = stringifyNumberArray(data.territoryMapNodeIdsJson)
  if ('leaderCharacterId' in data) next.leaderCharacterId = asNumber(data.leaderCharacterId)
  if (typeof data.memberPolicy === 'string') next.memberPolicy = asText(data.memberPolicy)
  if (typeof data.currentPhase === 'string') next.currentPhase = asText(data.currentPhase)
  if (typeof data.externalRelationsJson === 'string') next.externalRelationsJson = data.externalRelationsJson
  if (typeof data.notes === 'string') next.notes = asText(data.notes)
  if ('sortOrder' in data) next.sortOrder = asNumber(data.sortOrder) ?? 0

  if ('leaderCharacterId' in next && typeof next.leaderCharacterId === 'number') {
    const db = getDb()
    const leader = db.select().from(characters).where(eq(characters.id, next.leaderCharacterId)).all()[0]
    if (!leader || leader.novelId !== novelId) next.leaderCharacterId = null
  }

  return next
}

function mapFactionEntity(row: typeof factions.$inferSelect): AppFaction {
  return {
    id: row.id,
    novelId: row.novelId,
    name: row.name,
    type: normalizeFactionType(row.type),
    goal: row.goal ?? undefined,
    resources: row.resources ?? undefined,
    territoryMapNodeIdsJson: row.territoryMapNodeIdsJson ?? undefined,
    leaderCharacterId: row.leaderCharacterId ?? undefined,
    memberPolicy: row.memberPolicy ?? undefined,
    currentPhase: row.currentPhase ?? undefined,
    externalRelationsJson: row.externalRelationsJson ?? undefined,
    notes: row.notes ?? undefined,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function mapCharacterSummary(row: typeof characters.$inferSelect): FactionGraphCharacterSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    roleType: (row.roleType as AppCharacter['roleType']) || 'minor',
    occupation: row.occupation || undefined,
    summary: row.innerConflict || row.goals || row.firstImpression || row.background || undefined,
  }
}

function cleanupFactionReferences(factionId: number, novelId: number, factionName: string) {
  const db = getDb()
  const targetName = normalizeName(factionName)

  db.select().from(characters).where(eq(characters.novelId, novelId)).all().forEach((character) => {
    const next = parseFactionReferenceArray(character.campFactionIdsJson).filter((value) => {
      if (typeof value === 'number') return value !== factionId
      return normalizeName(value) !== targetName
    })
    db.update(characters).set({
      campFactionIdsJson: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
    }).where(eq(characters.id, character.id)).run()
  })

  db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all().forEach((node) => {
    const next = parseFactionReferenceArray(node.affiliatedFactionIdsJson).filter((value) => {
      if (typeof value === 'number') return value !== factionId
      return normalizeName(value) !== targetName
    })
    db.update(worldMap).set({
      affiliatedFactionIdsJson: JSON.stringify(next),
    }).where(eq(worldMap.id, node.id)).run()
  })

  db.select().from(factions).where(eq(factions.novelId, novelId)).all().forEach((row) => {
    const nextRelations = parseFactionExternalRelations(row.externalRelationsJson).filter((relation) => {
      if (typeof relation.targetFactionId === 'number' && relation.targetFactionId === factionId) return false
      if (relation.targetFactionName && normalizeName(relation.targetFactionName) === targetName) return false
      return true
    })
    db.update(factions).set({
      externalRelationsJson: buildFactionExternalRelationsPayload(nextRelations),
      updatedAt: new Date().toISOString(),
    }).where(eq(factions.id, row.id)).run()
  })
}

function clampCount(value: unknown, fallback: number, min = 1, max = 24): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function normalizeBatchOptions(options: FactionBatchGenerationOptions = DEFAULT_BATCH_OPTIONS): FactionBatchGenerationOptions {
  return {
    count: clampCount(options.count, DEFAULT_BATCH_OPTIONS.count, 1, 200),
    batchSize: clampCount(options.batchSize, DEFAULT_BATCH_OPTIONS.batchSize, 1, 8),
    preferredTypes: Array.isArray(options.preferredTypes) && options.preferredTypes.length > 0
      ? options.preferredTypes.map((item) => normalizeFactionType(item)).slice(0, 6)
      : DEFAULT_BATCH_OPTIONS.preferredTypes,
    relationshipDensity: options.relationshipDensity === 'sparse' || options.relationshipDensity === 'dense'
      ? options.relationshipDensity
      : 'balanced',
    allowCharacterlessFactions: options.allowCharacterlessFactions !== false,
    preferExistingCharacters: options.preferExistingCharacters !== false,
    specialRequirements: asText(options.specialRequirements),
  }
}

function resolveCharacterByName(rows: typeof characters.$inferSelect[], name?: string): typeof characters.$inferSelect | null {
  const normalized = normalizeName(name || '')
  if (!normalized) return null
  return rows.find((row) => normalizeName(row.fullName) === normalized) || null
}

function resolveMapIdsByNames(rows: typeof worldMap.$inferSelect[], names: string[]): number[] {
  const normalized = names.map((item) => normalizeName(item)).filter(Boolean)
  const seen = new Set<number>()
  const ids: number[] = []
  normalized.forEach((value) => {
    const matched = rows.find((row) => normalizeName(row.name) === value)
    if (!matched || seen.has(matched.id)) return
    seen.add(matched.id)
    ids.push(matched.id)
  })
  return ids
}

function ensureCharacterFactionLink(characterId: number, novelId: number, factionId: number) {
  const db = getDb()
  const row = db.select().from(characters).where(eq(characters.id, characterId)).all()[0]
  if (!row || row.novelId !== novelId) return
  const next = stringifyFactionReferences(novelId, [...parseFactionReferenceArray(row.campFactionIdsJson), factionId])
  db.update(characters).set({
    campFactionIdsJson: next,
    updatedAt: new Date().toISOString(),
  }).where(eq(characters.id, characterId)).run()
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return cleanAiStringArray(value.filter((item): item is string => typeof item === 'string'))
}

function summarizeCurrentFactions(rows: AppFaction[]): string {
  if (rows.length === 0) return '暂无已保存势力。'
  const typeStats = [...rows.reduce((map, row) => {
    const label = getFactionTypeLabel(row.type)
    map.set(label, (map.get(label) || 0) + 1)
    return map
  }, new Map<string, number>()).entries()]
    .map(([label, count]) => `${label}${count}`)
    .join('、')
  const relationLightRows = rows.filter((row) => parseFactionExternalRelations(row.externalRelationsJson).length <= 1)
  const selectedMap = new Map<number, AppFaction>()
  ;[
    ...rows.slice(-12),
    ...relationLightRows.slice(0, 10),
    ...rows.slice(0, 10),
  ].forEach((row) => selectedMap.set(row.id, row))
  const selectedRows = [...selectedMap.values()].slice(0, 32)
  return [
    `全量统计：共 ${rows.length} 个势力；类型分布：${typeStats || '未分类'}；以下为覆盖最近、低关系度和早期基准的采样。`,
    ...selectedRows.map((row) => {
    const relations = parseFactionExternalRelations(row.externalRelationsJson)
      .slice(0, 3)
      .map((relation) => `${relation.targetFactionName || `#${relation.targetFactionId}`}:${getFactionRelationLabel(relation.relation)}`)
      .join('、')
    return `- ${row.name}（${getFactionTypeLabel(row.type)}）目标：${row.goal || '未写'}；资源：${row.resources || '未写'}；阶段：${row.currentPhase || '未写'}${relations ? `；关系：${relations}` : ''}`
    }),
  ].join('\n')
}

function summarizeCurrentCharacters(rows: typeof characters.$inferSelect[], limit = 36): string {
  if (rows.length === 0) return '当前还没有人物。'
  return rows.slice(0, limit).map((row) => {
    const factionRefs = parseFactionReferenceArray(row.campFactionIdsJson)
    const factionText = factionRefs.length > 0 ? factionRefs.join('、') : '无固定势力'
    return `- ${row.fullName}｜${row.roleType || 'minor'}｜${row.occupation || '无职业'}｜势力：${factionText}｜${row.innerConflict || row.goals || row.background || '暂无关键说明'}`
  }).join('\n')
}

function summarizeMapNodes(rows: typeof worldMap.$inferSelect[], limit = 32): string {
  if (rows.length === 0) return '当前还没有地图节点。'
  return rows
    .sort((left, right) => (left.level - right.level) || ((left.sortOrder || 0) - (right.sortOrder || 0)) || (left.id - right.id))
    .slice(0, limit)
    .map((row) => `- ${row.name}｜层级${row.level}｜${row.nodeType || row.locationType || '地点'}｜${row.description || row.atmosphere || '暂无说明'}`)
    .join('\n')
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return [
    profile.storyGoal ? `故事目标：${profile.storyGoal}` : '',
    profile.coreConflict ? `核心冲突：${profile.coreConflict}` : '',
    profile.mainPlot ? `主线推进：${profile.mainPlot}` : '',
    profile.themeVoiceSummary ? `主题与文风：${profile.themeVoiceSummary}` : '',
  ].filter(Boolean).join('\n')
}

function buildFactionGenerationPrompt(input: {
  novelTitle: string
  genre: string
  background: string
  worldSummary: string
  storyCore: string
  existingFactions: string
  characterSummary: string
  mapSummary: string
  totalCount: number
  batchCount: number
  batchIndex: number
  totalBatches: number
  options: FactionBatchGenerationOptions
}) {
  const relationOptions = FACTION_RELATION_TYPE_OPTIONS.map((item) => `${item.value}（${item.label}）`).join('、')
  const preferredTypes = (input.options.preferredTypes || []).map((item) => formatFactionTypeForPrompt(item)).filter(Boolean).join('、')

  return [
    `你是一名长篇小说世界观策划编辑，需要为《${input.novelTitle}》补齐可直接落库的势力系统。`,
    `题材：${input.genre}`,
    `背景：\n${input.background || '未填写'}`,
    `世界规则摘要：\n${input.worldSummary || '未填写'}`,
    `故事核心：\n${input.storyCore || '未填写'}`,
    `当前已存在势力：\n${input.existingFactions}`,
    `当前可引用人物：\n${input.characterSummary}`,
    `当前可引用地图节点：\n${input.mapSummary}`,
    `生成任务：当前总目标 ${input.totalCount} 个势力；本轮是第 ${input.batchIndex}/${input.totalBatches} 批，只生成 ${input.batchCount} 个。`,
    '硬约束：\n- 只输出 JSON 数组，不要解释，不要 Markdown。\n- 每个势力都必须是小说里的社会主体或组织主体，名称要像宗门、商会、军府、朝廷、帮派、家族、秘密网络、机构或统治集团。\n- 禁止把动物、种族、怪物、单个职业、单体人物、纯地名直接当成势力名，例如“穿山甲”这类生物名不能作为势力。\n- 每个势力都必须和题材、背景、世界规则、主题或主线冲突有关联，不能像随机资料库。\n- 不要用“好势力/坏势力”二元设计，要写利益、制度、历史、情感和秘密纠缠。\n- 势力之间必须形成关系网。如果当前已有势力，则新势力至少要和一个已有势力发生可叙事关系。\n- 有的人可以完全没有势力归属，不要为了凑数强行把所有人物塞进势力。\n- 如果绑定人物，只能从给定人物列表里选名字；如果不适合绑定人物，就返回空数组。\n- 如果绑定地图，只能从给定地图节点里选名字；如果不适合绑定地点，就返回空数组。\n- type 只能使用这些值：' + FACTION_TYPE_OPTIONS.map((item) => `${item.value}（${item.label}）`).join('、') + '\n- 外部关系 relation 只能使用这些值：' + relationOptions,
    preferredTypes ? `优先势力类型：${preferredTypes}` : '',
    input.options.allowCharacterlessFactions ? '允许没有领袖或没有明确成员的隐性势力。' : '尽量让每个势力都落到至少一个具体人物。',
    input.options.preferExistingCharacters === false ? '不必强行绑定现有人物，优先保证势力设计合理。' : '优先复用现有人物作为领袖、成员或外围合作者。',
    input.options.relationshipDensity === 'dense'
      ? '本轮关系网要更密，尽量让每个势力都带出多方牵扯。'
      : input.options.relationshipDensity === 'sparse'
        ? '本轮关系网可以克制，但仍需保留至少一条有叙事价值的对外关系。'
        : '关系密度保持均衡，不要过疏，也不要把所有势力写成全连通。',
    input.options.specialRequirements ? `额外要求：${input.options.specialRequirements}` : '',
    '输出结构：\n[\n  {\n    "name": "势力名",\n    "type": "faction",\n    "goal": "当前目标",\n    "resources": "核心资源",\n    "memberPolicy": "成员结构与规则",\n    "currentPhase": "当前阶段与变化",\n    "notes": "这个势力如何连接主题、背景、人物和主线",\n    "leaderName": "可为空",\n    "territoryNames": ["地图节点名"],\n    "linkedCharacterNames": ["现有人物名"],\n    "externalRelations": [\n      {\n        "targetFactionName": "目标势力名",\n        "relation": "ally",\n        "note": "关系的具体利益或历史说明"\n      }\n    ]\n  }\n]',
  ].filter(Boolean).join('\n\n')
}

function parseGeneratedFactions(raw: string): GeneratedFactionCandidate[] {
  const parsed = cleanAiValue(safeParseJson<GeneratedFactionCandidate[]>(raw))
  return Array.isArray(parsed) ? parsed : []
}

function factionSchemaHint(count: number): string {
  return `只输出 JSON 数组，数组长度不超过 ${count}。每个对象必须保留 name、type、goal、resources、memberPolicy、currentPhase、notes、leaderName、territoryNames、linkedCharacterNames、externalRelations 这些字段。type 只能使用英文枚举值，不要输出中文类型值。`
}

function buildFactionReviewContext(input: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  existingFactions: string
  characterSummary: string
  mapSummary: string
  options: FactionBatchGenerationOptions
}): string {
  return [
    `题材：${input.profile.genre}`,
    input.profile.background ? `背景：\n${input.profile.background}` : '',
    input.profile.worldRulesSummary ? `世界规则：\n${input.profile.worldRulesSummary}` : '',
    buildStoryCoreSummary(input.profile) ? `故事核心：\n${buildStoryCoreSummary(input.profile)}` : '',
    `现有势力网络：\n${input.existingFactions}`,
    `现有人物：\n${input.characterSummary}`,
    `地图节点：\n${input.mapSummary}`,
    input.options.preferredTypes && input.options.preferredTypes.length > 0
      ? `偏好类型：${input.options.preferredTypes.map((item) => formatFactionTypeForPrompt(item)).join('、')}`
      : '',
    input.options.specialRequirements ? `额外要求：${input.options.specialRequirements}` : '',
  ].filter(Boolean).join('\n\n')
}

function resolveRelationTarget(targetName: string, existingFactions: AppFaction[], createdNames: string[]): { id?: number; name?: string } {
  const normalized = normalizeName(targetName)
  if (!normalized) return {}
  const matched = existingFactions.find((row) => normalizeName(row.name) === normalized)
  if (matched) return { id: matched.id, name: matched.name }
  const created = createdNames.find((name) => normalizeName(name) === normalized)
  if (created) return { name: created }
  return { name: targetName.trim() }
}

function applyGeneratedFaction(
  novelId: number,
  generated: GeneratedFactionCandidate,
  existingFactions: AppFaction[],
  characterRows: typeof characters.$inferSelect[],
  mapRows: typeof worldMap.$inferSelect[],
  createdNames: string[],
): number | null {
  const name = asText(generated.name)
  if (!name) return null
  if (looksLikeNonFactionName(name)) return null
  if (existingFactions.some((row) => normalizeName(row.name) === normalizeName(name)) || createdNames.some((item) => normalizeName(item) === normalizeName(name))) {
    return null
  }

  const linkedCharacterNames = parseStringArray(generated.linkedCharacterNames)
  const linkedCharacters = linkedCharacterNames
    .map((item) => resolveCharacterByName(characterRows, item))
    .filter((item): item is typeof characters.$inferSelect => Boolean(item))
  const leader = resolveCharacterByName(characterRows, asText(generated.leaderName)) || linkedCharacters[0] || null
  const externalRelations = cleanAiValue(parseFactionExternalRelations(JSON.stringify(Array.isArray(generated.externalRelations)
    ? generated.externalRelations.map((relation) => {
        if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null
        const record = relation as Record<string, unknown>
        const target = resolveRelationTarget(asText(record.targetFactionName), existingFactions, createdNames)
        return {
          targetFactionId: target.id,
          targetFactionName: target.name,
          relation: FACTION_RELATION_TYPE_OPTIONS.some((item) => item.value === asText(record.relation))
            ? asText(record.relation)
            : 'neutral',
          note: asText(record.note),
        }
      }).filter(Boolean)
    : [])))

  const factionId = createFaction(novelId, {
    name,
    type: normalizeFactionType(generated.type),
    goal: asText(generated.goal),
    resources: asText(generated.resources),
    memberPolicy: asText(generated.memberPolicy),
    currentPhase: asText(generated.currentPhase),
    notes: asText(generated.notes),
    leaderCharacterId: leader?.id || null,
    territoryMapNodeIdsJson: JSON.stringify(resolveMapIdsByNames(mapRows, parseStringArray(generated.territoryNames))),
    externalRelationsJson: buildFactionExternalRelationsPayload(externalRelations),
  }, { skipContextTracking: true })

  const characterIds = new Set<number>(linkedCharacters.map((row) => row.id))
  if (leader?.id) characterIds.add(leader.id)
  characterIds.forEach((characterId) => ensureCharacterFactionLink(characterId, novelId, factionId))
  return factionId
}

export function listFactions(novelId: number) {
  const db = getDb()
  return db.select().from(factions)
    .where(eq(factions.novelId, novelId))
    .orderBy(asc(factions.sortOrder), asc(factions.id))
    .all()
    .map(mapFactionEntity)
}

export function queryFactions(filters: FactionQueryFilters) {
  const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize)
  const keyword = filters.keyword?.trim().toLowerCase()

  const rows = listFactions(filters.novelId).filter((row) => {
    if (filters.type && row.type !== filters.type) return false
    if (keyword) {
      const haystack = [row.name, row.goal, row.resources, row.memberPolicy, row.currentPhase, row.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })

  return buildPagedResult(rows.slice(offset, offset + pageSize), page, pageSize, rows.length)
}

export function getFactionStats(filters: { novelId: number }): FactionStats {
  const rows = listFactions(filters.novelId)
  return {
    total: rows.length,
    withLeaderCount: rows.filter((row) => typeof row.leaderCharacterId === 'number').length,
    territoryBoundCount: rows.filter((row) => parseNumberArray(row.territoryMapNodeIdsJson).length > 0).length,
    relationCount: rows.reduce((sum, row) => sum + parseFactionExternalRelations(row.externalRelationsJson).length, 0),
  }
}

export function getFaction(id: number) {
  const db = getDb()
  const row = db.select().from(factions).where(eq(factions.id, id)).all()[0]
  return row ? mapFactionEntity(row) : null
}

export function searchFactions(novelId: number, keyword = '', limit = 12) {
  return listFactions(novelId)
    .filter((row) => {
      if (!keyword.trim()) return true
      const haystack = [row.name, row.goal, row.resources, row.currentPhase, row.notes].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword.trim().toLowerCase())
    })
    .slice(0, Math.max(1, Math.min(limit, 50)))
}

export function getFactionGraph(filters: FactionGraphQueryInput): FactionGraphPayload {
  const db = getDb()
  const factionRows = listFactions(filters.novelId)
  const characterRows = db.select().from(characters).where(eq(characters.novelId, filters.novelId)).all()
  const factionById = new Map(factionRows.map((row) => [row.id, row]))
  const factionByName = new Map(factionRows.map((row) => [normalizeName(row.name), row]))
  const nodes = new Map<string, FactionGraphPayload['nodes'][number]>()
  const edges: FactionGraphPayload['edges'] = []
  const connectedCharacterIds = new Set<number>()

  factionRows.forEach((row) => {
        nodes.set(`faction-${row.id}`, {
          id: `faction-${row.id}`,
          entityType: 'faction',
          entityId: row.id,
          label: row.name,
          subLabel: getFactionTypeLabel(row.type),
          summary: row.currentPhase || row.goal || row.resources || row.notes || '等待补充势力说明。',
          color: getFactionRelationColor('neutral'),
        })
  })

  factionRows.forEach((row) => {
    parseFactionExternalRelations(row.externalRelationsJson).forEach((relation, index) => {
      const target = typeof relation.targetFactionId === 'number'
        ? factionById.get(relation.targetFactionId)
        : relation.targetFactionName
          ? factionByName.get(normalizeName(relation.targetFactionName))
          : null
      if (!target) return
      edges.push({
        id: `faction-edge-${row.id}-${target.id}-${index}`,
        source: `faction-${row.id}`,
        target: `faction-${target.id}`,
        relationType: relation.relation,
        relationLabel: getFactionRelationLabel(relation.relation),
        note: relation.note,
        bilateral: relation.relation === 'ally' || relation.relation === 'trade' || relation.relation === 'truce',
        color: getFactionRelationColor(relation.relation),
      })
    })
  })

  characterRows.forEach((row) => {
    const linkedFactions = parseFactionReferenceArray(row.campFactionIdsJson)
      .map((value) => typeof value === 'number' ? factionById.get(value) : factionByName.get(normalizeName(value)))
      .filter((item): item is AppFaction => Boolean(item))
    const summary = mapCharacterSummary(row)

    linkedFactions.forEach((faction) => {
      connectedCharacterIds.add(summary.id)
      const nodeId = `character-${summary.id}`
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          entityType: 'character',
          entityId: summary.id,
          label: summary.fullName,
          subLabel: summary.roleType,
          summary: summary.summary || summary.occupation || '等待补充人物立场。',
          factionId: faction.id,
          color: '#8b6f4d',
        })
      }
      edges.push({
        id: `character-member-${summary.id}-${faction.id}`,
        source: nodeId,
        target: `faction-${faction.id}`,
        relationType: faction.leaderCharacterId === summary.id ? 'leader' : 'member',
        relationLabel: faction.leaderCharacterId === summary.id ? '领袖' : '关联人物',
        note: summary.occupation,
        color: faction.leaderCharacterId === summary.id ? '#a26431' : '#5a7a8b',
      })
    })
  })

  const focusId = typeof filters.focusFactionId === 'number' ? filters.focusFactionId : null
  const unalignedCharacters = characterRows.filter((row) => !connectedCharacterIds.has(row.id)).map(mapCharacterSummary)

  if (!focusId) {
    return {
      nodes: [...nodes.values()],
      edges,
      unalignedCharacters,
    }
  }

  const allowedNodeIds = new Set<string>([`faction-${focusId}`])
  edges.forEach((edge) => {
    if (edge.source === `faction-${focusId}` || edge.target === `faction-${focusId}`) {
      allowedNodeIds.add(edge.source)
      allowedNodeIds.add(edge.target)
    }
  })

  return {
    nodes: [...nodes.values()].filter((node) => allowedNodeIds.has(node.id)),
    edges: edges.filter((edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target)),
    unalignedCharacters,
  }
}

export function createFaction(
  novelId: number,
  data: Partial<typeof factions.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const rows = db.select().from(factions).where(eq(factions.novelId, novelId)).all()
  const payload = sanitizeFactionPayload(novelId, data)
  const result = db.insert(factions).values({
    novelId,
    name: payload.name || '未命名势力',
    type: payload.type || 'faction',
    goal: payload.goal || '',
    resources: payload.resources || '',
    territoryMapNodeIdsJson: payload.territoryMapNodeIdsJson || '[]',
    leaderCharacterId: payload.leaderCharacterId ?? null,
    memberPolicy: payload.memberPolicy || '',
    currentPhase: payload.currentPhase || '',
    externalRelationsJson: payload.externalRelationsJson || '[]',
    notes: payload.notes || '',
    sortOrder: rows.length > 0 ? Math.max(...rows.map((row) => row.sortOrder || 0)) + 1 : 1,
  }).run()

  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Factions changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
  return Number(result.lastInsertRowid)
}

export function updateFaction(
  id: number,
  data: Partial<typeof factions.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const current = getFaction(id)
  if (!current) return
  const db = getDb()
  db.update(factions).set({
    ...sanitizeFactionPayload(current.novelId, data),
    updatedAt: new Date().toISOString(),
  }).where(eq(factions.id, id)).run()

  if (!options.skipContextTracking) {
    markNovelContextChanged(current.novelId, 'Factions changed')
    refreshWorldStateVersionsForNovel(current.novelId)
  }
}

export function deleteFaction(id: number, options: { skipContextTracking?: boolean } = {}) {
  const current = getFaction(id)
  if (!current) return
  const db = getDb()
  cleanupFactionReferences(current.id, current.novelId, current.name)
  db.delete(factions).where(eq(factions.id, id)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(current.novelId, 'Factions changed')
    refreshWorldStateVersionsForNovel(current.novelId)
  }
}

export function clearFactions(novelId: number) {
  const db = getDb()
  const rows = db.select().from(factions)
    .where(eq(factions.novelId, novelId))
    .orderBy(asc(factions.sortOrder), asc(factions.id))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    cleanupFactionReferences(row.id, row.novelId, row.name)
  })
  db.delete(factions).where(eq(factions.novelId, novelId)).run()
  markNovelContextChanged(novelId, 'Factions changed')
  refreshWorldStateVersionsForNovel(novelId)
  return rows.length
}

export async function generateFactionBatchChunk(
  novelId: number,
  options: FactionBatchGenerationOptions = DEFAULT_BATCH_OPTIONS,
  runtime: FactionGenerateRuntimeOptions = {},
): Promise<FactionBatchChunkResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const normalized = normalizeBatchOptions(options)
  const currentFactions = listFactions(novelId)
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const requestedCount = Math.max(1, Math.min(normalized.count || normalized.batchSize || 1, normalized.batchSize || 1))
  const profile = await buildStoryProfile(novelId)
  const existingFactionsSummary = summarizeCurrentFactions(currentFactions)
  const characterSummary = summarizeCurrentCharacters(characterRows)
  const mapSummary = summarizeMapNodes(mapRows)
  const reviewContext = buildFactionReviewContext({
    profile,
    existingFactions: existingFactionsSummary,
    characterSummary,
    mapSummary,
    options: normalized,
  })
  const historyEntityType = 'faction'
  const historyTaskType = 'faction_generate_batch'
  const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
  const totalBatches = runtime.totalBatches || Math.max(1, Math.ceil((normalized.count || requestedCount) / Math.max(1, normalized.batchSize)))
  const batchIndex = runtime.batchIndex || 1
  const prompt = buildFactionGenerationPrompt({
    novelTitle: novel.title,
    genre: profile.genre,
    background: profile.background,
    worldSummary: profile.worldRulesSummary,
    storyCore: buildStoryCoreSummary(profile),
    existingFactions: existingFactionsSummary,
    characterSummary,
    mapSummary,
    totalCount: normalized.count,
    batchCount: requestedCount,
    batchIndex,
    totalBatches,
    options: normalized,
  })
  const messages = appendVariationMessage([{ role: 'user', content: prompt }], {
    attemptNumber,
    rejectedDigests,
  })
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'faction_generate',
    novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson,
    runnerType: 'chat',
    parentTaskId: runtime.parentTaskId,
  })

  if (typeof runtime.parentTaskId === 'number') {
    updateTask(runtime.parentTaskId, { currentChildTaskId: taskId })
  }

  let resultPayload: FactionBatchChunkResult = { ids: [] }

  try {
    await executeChatTask(taskId, {
      type: 'faction_generate',
      novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: novelId,
      inputJson,
      messages,
      sender: runtime.sender,
      onSuccess: async (rawOutput) => {
        const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, rawOutput, attemptNumber)
        const quality = await runAssetQualityLoop({
          targetType: 'faction',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender: runtime.sender,
          contextSummary: reviewContext,
          generatedOutput: rawOutput,
          schemaHint: factionSchemaHint(requestedCount),
          reviewFocus: [
            '势力不能只剩资料库式设定词，要能直接进入剧情与冲突。',
            '重点检查模板腔、空泛目标、善恶二元、与人物和地图脱节的问题。',
          ],
          rewriteConstraints: [
            '保持 JSON 数组结构稳定，不要改成说明文。',
            '保持对象数量不超过当前批次目标，不要擅自扩写成整套百科。',
          ],
        })
        if (quality.stage === 'rejected') {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warning: summarizeAssetQualityWarnings(quality) || `第 ${batchIndex}/${totalBatches} 批势力被审校拒收。`,
          }
          return resultPayload
        }

        const parsed = parseGeneratedFactions(quality.finalOutput)
        const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
        if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warning: `第 ${batchIndex}/${totalBatches} 批势力与近期拒绝结果过于相近，已自动跳过。`,
          }
          return resultPayload
        }
        const createdIds: number[] = []
        const createdNames: string[] = []

        parsed.forEach((candidate) => {
          if (createdIds.length >= requestedCount) return
          const id = applyGeneratedFaction(novelId, candidate, currentFactions, characterRows, mapRows, createdNames)
          if (!id) return
          const nextFaction = getFaction(id)
          if (!nextFaction) return
          createdIds.push(id)
          createdNames.push(nextFaction.name)
        })

        if (createdIds.length === 0) {
          markRejected(historyId)
        }

        resultPayload = {
          ids: createdIds,
          batchDigest: createdNames.slice(0, 3).join('、'),
          warning: createdIds.length > 0
            ? (summarizeAssetQualityWarnings(quality) || '')
            : (summarizeAssetQualityWarnings(quality) || `第 ${batchIndex}/${totalBatches} 批没有生成可保存的势力。`),
        }
        return resultPayload
      },
    })
  } catch (error) {
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, error instanceof Error ? error.message : 'Faction generation failed', attemptNumber)
    markRejected(historyId)
    throw error
  } finally {
    if (typeof runtime.parentTaskId === 'number') {
      updateTask(runtime.parentTaskId, { currentChildTaskId: null })
    }
  }
  if (resultPayload.ids.length > 0) {
    markNovelContextChanged(novelId, 'Factions changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
  return resultPayload
}

export async function batchGenerateFactions(
  novelId: number,
  options: FactionBatchGenerationOptions = DEFAULT_BATCH_OPTIONS,
  sender?: WebContents,
): Promise<number[]> {
  const normalized = normalizeBatchOptions(options)
  const ids: number[] = []
  const totalBatches = Math.max(1, Math.ceil(normalized.count / Math.max(1, normalized.batchSize)))

  for (let index = 0; index < totalBatches; index += 1) {
    const remaining = normalized.count - ids.length
    if (remaining <= 0) break
    const result = await generateFactionBatchChunk(novelId, {
      ...normalized,
      count: Math.min(normalized.batchSize, remaining),
      batchSize: Math.min(normalized.batchSize, remaining),
    }, {
      sender,
      batchIndex: index + 1,
      totalBatches,
    })
    ids.push(...result.ids)
  }

  return ids
}

export function resolveFactionNameOptions(novelId: number): string[] {
  return listFactions(novelId).map((row) => row.name)
}

export function normalizeFactionReferenceJsonForNovel(novelId: number, input: unknown): string {
  return stringifyFactionReferences(novelId, input)
}
