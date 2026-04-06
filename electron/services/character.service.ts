import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { characters, characterRelations, novels, storyItems, timelineEvents } from '../database/schema'
import type { CharacterBatchGenerationOptions } from '../../src/types'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import {
  buildCharacterEcologySummary,
  getFactionNameOptions,
  getSpeciesNameOptions,
  parseWorldRulesJson,
  buildMapBlueprintSummary,
} from '../../src/shared/genre-system'
import {
  batchCharacterPrompt,
  characterRelationsPrompt,
  protagonistPrompt,
  regenerateCharacterPrompt,
} from './prompts'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { buildCharacterRelationSummaryLine, normalizeCharacterRelationLevel } from '../../src/shared/character-relations'
import { markNovelContextChanged } from './context-impact.service'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import { throwUserFacingError } from '../utils/user-facing-error'

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))
      ? Number(value)
      : undefined
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanAiStringArray(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))
  }

  const text = asText(value)
  if (!text) return []
  return cleanAiStringArray(text.split(/[\n,，、]/))
}

function parseJsonArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return toStringArray(parsed)
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function stringifyNumberArray(values: number[]): string {
  return JSON.stringify([...new Set(values.filter((item) => Number.isFinite(item)))])
}

function normalizeLookup(input: string): string {
  return input.trim().replace(/\s+/g, '').toLowerCase()
}

function normalizeRecordStatus(value: unknown): 'draft' | 'confirmed' {
  return asText(value) === 'draft' ? 'draft' : 'confirmed'
}

function parseAppearanceDescription(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.description === 'string'
      ? parsed.description.trim()
      : ''
  } catch {
    return ''
  }
}

function inferEntityType(species: string): string {
  if (!species || species === '人类' || species === '幸存者' || species === '人族' || species === '人族修士') {
    return 'human'
  }
  if (/(丧尸|感染者|尸鬼|亡灵)/u.test(species)) return 'undead'
  if (/(兽|狼|虎|狐|熊|龙|灵兽|魔兽)/u.test(species)) return 'beast'
  if (/(精灵|异族|妖|魔|鬼)/u.test(species)) return 'nonhuman'
  if (/(仙|神)/u.test(species)) return 'immortal'
  return 'nonhuman'
}

function jsonStringifyArray(value: string[]): string {
  return JSON.stringify(cleanAiStringArray(value))
}

function roleOrder(roleType?: string | null): number {
  const priority = ['protagonist', 'major', 'antagonist', 'supporting', 'minor']
  const index = priority.indexOf(roleType || 'minor')
  return index === -1 ? priority.length : index
}

function normalizeRoleType(value: string): 'major' | 'minor' | 'antagonist' | 'supporting' {
  if (value === 'major' || value === 'antagonist' || value === 'supporting') return value
  return 'minor'
}

function buildRoleQueue(opts: {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
}): Array<'major' | 'minor' | 'antagonist' | 'supporting'> {
  return [
    ...Array.from({ length: Math.max(0, opts.majorCount) }, () => 'major' as const),
    ...Array.from({ length: Math.max(0, opts.antagonistCount || 0) }, () => 'antagonist' as const),
    ...Array.from({ length: Math.max(0, opts.supportingCount || 0) }, () => 'supporting' as const),
    ...Array.from({ length: Math.max(0, opts.minorCount) }, () => 'minor' as const),
  ]
}

export interface CharacterBatchChunkResult {
  ids: number[]
  majorGenerated: number
  minorGenerated: number
  antagonistGenerated: number
  supportingGenerated: number
  batchDigest?: string
  warning?: string
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return [
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.writingRulesSummary,
  ].filter(Boolean).join('\n\n')
}

function buildOptionSummary(label: string, values: string[]): string {
  return values.length > 0 ? `${label}：${values.join('、')}` : ''
}

function buildItemResourceSummary(rows: Array<typeof storyItems.$inferSelect>): string {
  return rows
    .filter((item) => item.itemKind === 'instance')
    .slice(0, 12)
    .map((item) => {
      const parts = [item.category, item.ownerCharacterId ? '已绑定人物' : '', item.summary || item.plotFunction || '']
        .filter(Boolean)
        .slice(0, 3)
      return `- ${item.itemName}${parts.length > 0 ? `：${parts.join('；')}` : ''}`
    })
    .join('\n')
}

function buildRoleBlueprintSummary(opts: {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
  helperRoles?: string[]
}): string {
  return [
    `主要人物 ${opts.majorCount} 位`,
    `对立角色 ${opts.antagonistCount || 0} 位`,
    `功能角色 ${opts.supportingCount || 0} 位`,
    `次要人物 ${opts.minorCount} 位`,
    opts.helperRoles && opts.helperRoles.length > 0 ? `优先功能位：${opts.helperRoles.join('、')}` : '',
  ].filter(Boolean).join('；')
}

function buildExistingCharacterDigest(rows: Array<typeof characters.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((character) => buildCharacterSummary(character))
    .join('\n')
}

function buildCharacterSummary(character: typeof characters.$inferSelect): string {
  const traits = parseJsonArray(character.personalityTraitsJson).slice(0, 3).join('、')
  const flaws = parseJsonArray(character.flawsJson).slice(0, 2).join('、')
  const parts = [
    character.entityType ? `实体：${character.entityType}` : '',
    character.species ? `种族：${character.species}` : '',
    character.occupation ? `身份：${character.occupation}` : '',
    character.rankLevel ? `等级：${character.rankLevel}` : '',
    character.socialIdentity ? `社会身份：${character.socialIdentity}` : '',
    character.background ? `经历：${character.background.slice(0, 60)}` : '',
    traits ? `特点：${traits}` : '',
    flaws ? `缺陷：${flaws}` : '',
    character.goals ? `追求：${character.goals}` : '',
    character.innerConflict ? `矛盾：${character.innerConflict}` : '',
    character.relationshipTension ? `关系张力：${character.relationshipTension}` : '',
    character.resonancePoint ? `共鸣点：${character.resonancePoint}` : '',
  ].filter(Boolean)

  return `- ${character.fullName}（${character.roleType || 'minor'}）：${parts.join('；') || '暂无补充'}`
}

function buildCurrentProfileSummary(character: typeof characters.$inferSelect): string {
  const traits = parseJsonArray(character.personalityTraitsJson).join('、')
  const flaws = parseJsonArray(character.flawsJson).join('、')
  const habits = parseJsonArray(character.habitsJson).join('、')
  const factions = parseJsonArray(character.campFactionIdsJson).join('、')
  const powerSystems = parseJsonArray(character.powerSystemRefsJson).join('、')
  const contextHooks = parseJsonArray(character.contextHooksJson).join('、')
  return [
    `姓名：${character.fullName}`,
    `角色类型：${character.roleType || 'minor'}`,
    character.entityType ? `实体类型：${character.entityType}` : '',
    character.species ? `种族：${character.species}` : '',
    character.gender ? `性别：${character.gender}` : '',
    character.age ? `年龄：${character.age}` : '',
    character.occupation ? `职业/身份：${character.occupation}` : '',
    character.rankLevel ? `等级/境界：${character.rankLevel}` : '',
    character.socialIdentity ? `社会身份：${character.socialIdentity}` : '',
    factions ? `所属势力：${factions}` : '',
    powerSystems ? `适用体系：${powerSystems}` : '',
    contextHooks ? `上下文钩子：${contextHooks}` : '',
    character.background ? `背景经历：${character.background}` : '',
    traits ? `性格特点：${traits}` : '',
    flaws ? `性格缺陷：${flaws}` : '',
    habits ? `习惯/口头禅：${habits}` : '',
    character.goals ? `核心追求：${character.goals}` : '',
    character.surfaceDesire ? `表层欲望：${character.surfaceDesire}` : '',
    character.deepNeed ? `深层需要：${character.deepNeed}` : '',
    character.coreFear ? `核心恐惧：${character.coreFear}` : '',
    character.innerConflict ? `内在矛盾：${character.innerConflict}` : '',
    character.hiddenSecret ? `隐藏秘密：${character.hiddenSecret}` : '',
    character.moralLine ? `道德底线：${character.moralLine}` : '',
    character.selfDeception ? `自我欺骗：${character.selfDeception}` : '',
    character.trauma ? `旧伤/创伤：${character.trauma}` : '',
    character.contradiction ? `反差点：${character.contradiction}` : '',
    character.relationshipTension ? `关系张力：${character.relationshipTension}` : '',
    character.resonancePoint ? `共鸣点：${character.resonancePoint}` : '',
    character.characterArc ? `人物弧光：${character.characterArc}` : '',
    character.firstImpression ? `初次印象：${character.firstImpression}` : '',
    parseAppearanceDescription(character.appearanceJson) ? `外貌描述：${parseAppearanceDescription(character.appearanceJson)}` : '',
  ].filter(Boolean).join('\n')
}

function buildCharacterReviewContext(params: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  worldSummary?: string
  protagonistSummary?: string
  existingCharacterSummaries?: string
  relationSummary?: string
  itemSummary?: string
  extraLines?: string[]
}): string {
  return [
    `题材：${params.profile.genre}`,
    params.profile.background ? `背景摘要：${params.profile.background}` : '',
    params.worldSummary ? `世界规则：${params.worldSummary}` : '',
    buildStoryCoreSummary(params.profile) ? `故事核心：\n${buildStoryCoreSummary(params.profile)}` : '',
    params.protagonistSummary ? `主角参考：\n${params.protagonistSummary}` : '',
    params.existingCharacterSummaries ? `现有人物：\n${params.existingCharacterSummaries}` : '',
    params.relationSummary ? `关系摘要：\n${params.relationSummary}` : '',
    params.itemSummary ? `相关资源：\n${params.itemSummary}` : '',
    ...(params.extraLines || []).filter(Boolean),
  ].filter(Boolean).join('\n\n')
}

function characterSchemaHint(expectedCount?: number): string {
  return [
    typeof expectedCount === 'number'
      ? `输出应保持为 ${expectedCount} 个角色对象组成的 JSON 数组。`
      : '输出应保持为单个角色 JSON 对象。',
    '不要改动字段语义，不要把人物卡重写成散文。',
    '姓名、角色定位、背景、目标、矛盾、关系张力等关键字段必须保留。',
  ].join('\n')
}

function buildCharacterPayload(
  parsed: Record<string, unknown>,
  fallback: {
    roleType?: string
    fullName?: string
    existing?: typeof characters.$inferSelect | null
    recordStatus?: 'draft' | 'confirmed'
    sourceContextJson?: string
  } = {},
): Partial<typeof characters.$inferInsert> {
  const sanitized = cleanAiValue(parsed)
  const appearance = asText(sanitized.appearance) || parseAppearanceDescription(fallback.existing?.appearanceJson)
  const fullName = asText(sanitized.full_name) || asText(sanitized.name) || fallback.fullName || fallback.existing?.fullName || '未命名角色'
  const roleType = asText(sanitized.role_type) || fallback.roleType || fallback.existing?.roleType || 'minor'
  const personalityTraits = toStringArray(sanitized.personality_traits).length > 0
    ? toStringArray(sanitized.personality_traits)
    : toStringArray(sanitized.personality_keywords).length > 0
      ? toStringArray(sanitized.personality_keywords)
      : toStringArray(sanitized.personality).length > 0
        ? toStringArray(sanitized.personality)
        : parseJsonArray(fallback.existing?.personalityTraitsJson)
  const flaws = toStringArray(sanitized.flaws).length > 0
    ? toStringArray(sanitized.flaws)
    : parseJsonArray(fallback.existing?.flawsJson)
  const habits = toStringArray(sanitized.habits).length > 0
    ? toStringArray(sanitized.habits)
    : parseJsonArray(fallback.existing?.habitsJson)
  const species = asText(sanitized.species) || fallback.existing?.species || ''
  const entityType = asText(sanitized.entity_type) || fallback.existing?.entityType || inferEntityType(species)
  const factionNames = toStringArray(sanitized.faction_names).length > 0
    ? toStringArray(sanitized.faction_names)
    : toStringArray(sanitized.factions).length > 0
      ? toStringArray(sanitized.factions)
      : parseJsonArray(fallback.existing?.campFactionIdsJson)
  const powerSystemNames = toStringArray(sanitized.power_system_names).length > 0
    ? toStringArray(sanitized.power_system_names)
    : toStringArray(sanitized.power_system_refs).length > 0
      ? toStringArray(sanitized.power_system_refs)
      : parseJsonArray(fallback.existing?.powerSystemRefsJson)
  const contextHooks = toStringArray(sanitized.context_hooks).length > 0
    ? toStringArray(sanitized.context_hooks)
    : parseJsonArray(fallback.existing?.contextHooksJson)
  const recordStatus = Object.prototype.hasOwnProperty.call(sanitized, 'record_status')
    ? normalizeRecordStatus(sanitized.record_status)
    : fallback.recordStatus || fallback.existing?.recordStatus || 'confirmed'
  const sourceContextJson = asText(sanitized.source_context_json) || fallback.sourceContextJson || fallback.existing?.sourceContextJson || ''

  return {
    roleType,
    recordStatus,
    entityType,
    species,
    surname: asText(sanitized.surname) || fallback.existing?.surname || '',
    givenName: asText(sanitized.given_name) || fallback.existing?.givenName || '',
    fullName,
    gender: asText(sanitized.gender) || fallback.existing?.gender || '',
    age: asNumber(sanitized.age) ?? fallback.existing?.age,
    birthplace: asText(sanitized.birthplace) || fallback.existing?.birthplace || '',
    occupation: asText(sanitized.occupation) || fallback.existing?.occupation || '',
    rankLevel: asText(sanitized.rank_level) || fallback.existing?.rankLevel || '',
    socialIdentity: asText(sanitized.social_identity) || fallback.existing?.socialIdentity || '',
    background: asText(sanitized.background) || fallback.existing?.background || '',
    personalityTraitsJson: jsonStringifyArray(personalityTraits),
    flawsJson: jsonStringifyArray(flaws),
    habitsJson: jsonStringifyArray(habits),
    campFactionIdsJson: jsonStringifyArray(factionNames),
    powerSystemRefsJson: jsonStringifyArray(powerSystemNames),
    contextHooksJson: jsonStringifyArray(contextHooks),
    goals: asText(sanitized.goals) || fallback.existing?.goals || '',
    firstImpression: asText(sanitized.first_impression) || fallback.existing?.firstImpression || '',
    surfaceDesire: asText(sanitized.surface_desire) || fallback.existing?.surfaceDesire || '',
    deepNeed: asText(sanitized.deep_need) || fallback.existing?.deepNeed || '',
    coreFear: asText(sanitized.core_fear) || fallback.existing?.coreFear || '',
    innerConflict: asText(sanitized.inner_conflict) || fallback.existing?.innerConflict || '',
    hiddenSecret: asText(sanitized.hidden_secret) || fallback.existing?.hiddenSecret || '',
    moralLine: asText(sanitized.moral_line) || fallback.existing?.moralLine || '',
    selfDeception: asText(sanitized.self_deception) || fallback.existing?.selfDeception || '',
    trauma: asText(sanitized.trauma) || fallback.existing?.trauma || '',
    contradiction: asText(sanitized.contradiction) || fallback.existing?.contradiction || '',
    relationshipTension: asText(sanitized.relationship_tension) || fallback.existing?.relationshipTension || asText(sanitized.relation_to_protagonist) || '',
    resonancePoint: asText(sanitized.resonance_point) || fallback.existing?.resonancePoint || '',
    characterArc: asText(sanitized.character_arc) || fallback.existing?.characterArc || '',
    appearanceJson: JSON.stringify({ description: appearance }),
    sourceContextJson,
    appearChapter: asNumber(sanitized.appear_chapter) ?? fallback.existing?.appearChapter,
  }
}

interface CharacterQueryFilters {
  novelId: number
  roleType?: typeof characters.$inferSelect['roleType']
  recordStatus?: 'draft' | 'confirmed' | 'all'
  entityType?: string
  species?: string
  keyword?: string
  page?: number
  pageSize?: number
}

interface CharacterGraphFilters {
  novelId: number
  characterIds?: number[]
  focusCharacterId?: number
  roleTypes?: Array<typeof characters.$inferSelect['roleType']>
  relationTypes?: string[]
  factionNames?: string[]
  recordStatus?: 'draft' | 'confirmed' | 'all'
  limit?: number
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 24) {
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

function mapCharacterRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    roleType: String(row.role_type || 'minor') as typeof characters.$inferSelect['roleType'],
    recordStatus: normalizeRecordStatus(row.record_status),
    entityType: typeof row.entity_type === 'string' ? row.entity_type : undefined,
    species: typeof row.species === 'string' ? row.species : undefined,
    surname: typeof row.surname === 'string' ? row.surname : undefined,
    givenName: typeof row.given_name === 'string' ? row.given_name : undefined,
    fullName: String(row.full_name || ''),
    gender: typeof row.gender === 'string' ? row.gender : undefined,
    age: row.age == null ? undefined : Number(row.age),
    birthplace: typeof row.birthplace === 'string' ? row.birthplace : undefined,
    occupation: typeof row.occupation === 'string' ? row.occupation : undefined,
    rankLevel: typeof row.rank_level === 'string' ? row.rank_level : undefined,
    socialIdentity: typeof row.social_identity === 'string' ? row.social_identity : undefined,
    background: typeof row.background === 'string' ? row.background : undefined,
    personalityTraitsJson: typeof row.personality_traits_json === 'string' ? row.personality_traits_json : undefined,
    flawsJson: typeof row.flaws_json === 'string' ? row.flaws_json : undefined,
    habitsJson: typeof row.habits_json === 'string' ? row.habits_json : undefined,
    campFactionIdsJson: typeof row.camp_faction_ids_json === 'string' ? row.camp_faction_ids_json : undefined,
    powerSystemRefsJson: typeof row.power_system_refs_json === 'string' ? row.power_system_refs_json : undefined,
    contextHooksJson: typeof row.context_hooks_json === 'string' ? row.context_hooks_json : undefined,
    goals: typeof row.goals === 'string' ? row.goals : undefined,
    firstImpression: typeof row.first_impression === 'string' ? row.first_impression : undefined,
    surfaceDesire: typeof row.surface_desire === 'string' ? row.surface_desire : undefined,
    deepNeed: typeof row.deep_need === 'string' ? row.deep_need : undefined,
    coreFear: typeof row.core_fear === 'string' ? row.core_fear : undefined,
    innerConflict: typeof row.inner_conflict === 'string' ? row.inner_conflict : undefined,
    hiddenSecret: typeof row.hidden_secret === 'string' ? row.hidden_secret : undefined,
    moralLine: typeof row.moral_line === 'string' ? row.moral_line : undefined,
    selfDeception: typeof row.self_deception === 'string' ? row.self_deception : undefined,
    trauma: typeof row.trauma === 'string' ? row.trauma : undefined,
    contradiction: typeof row.contradiction === 'string' ? row.contradiction : undefined,
    relationshipTension: typeof row.relationship_tension === 'string' ? row.relationship_tension : undefined,
    resonancePoint: typeof row.resonance_point === 'string' ? row.resonance_point : undefined,
    characterArc: typeof row.character_arc === 'string' ? row.character_arc : undefined,
    appearanceJson: typeof row.appearance_json === 'string' ? row.appearance_json : undefined,
    abilitiesJson: typeof row.abilities_json === 'string' ? row.abilities_json : undefined,
    sourceContextJson: typeof row.source_context_json === 'string' ? row.source_context_json : undefined,
    appearChapter: row.appear_chapter == null ? undefined : Number(row.appear_chapter),
    sortOrder: Number(row.sort_order || 0),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

function mapRelationRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    charAId: Number(row.char_a_id),
    charBId: Number(row.char_b_id),
    relationType: typeof row.relation_type === "string" ? row.relation_type : undefined,
    relationLabel: typeof row.relation_label === "string" ? row.relation_label : undefined,
    bilateral: Number(row.bilateral || 0),
    description: typeof row.description === "string" ? row.description : undefined,
    intimacyLevel: normalizeCharacterRelationLevel(row.intimacy_level),
    tensionLevel: normalizeCharacterRelationLevel(row.tension_level),
    interactionStyle: typeof row.interaction_style === "string" ? row.interaction_style : undefined,
    subtextRule: typeof row.subtext_rule === "string" ? row.subtext_rule : undefined,
  }
}

function mapStoryItemRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    itemKind: String(row.item_kind || 'instance') as 'template' | 'instance',
    parentItemId: row.parent_item_id == null ? undefined : Number(row.parent_item_id),
    itemName: String(row.item_name || ''),
    genreFamily: typeof row.genre_family === 'string' ? row.genre_family : undefined,
    category: typeof row.category === 'string' ? row.category : undefined,
    subType: typeof row.sub_type === 'string' ? row.sub_type : undefined,
    rarity: typeof row.rarity === 'string' ? row.rarity : undefined,
    recordStatus: normalizeRecordStatus(row.record_status),
    ownerCharacterId: row.owner_character_id == null ? undefined : Number(row.owner_character_id),
    locationMapId: row.location_map_id == null ? undefined : Number(row.location_map_id),
    status: String(row.status || 'available') as 'available' | 'consumed' | 'hidden' | 'destroyed',
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    acquisitionMethod: typeof row.acquisition_method === 'string' ? row.acquisition_method : undefined,
    usageMethod: typeof row.usage_method === 'string' ? row.usage_method : undefined,
    cost: typeof row.cost === 'string' ? row.cost : undefined,
    risk: typeof row.risk === 'string' ? row.risk : undefined,
    plotFunction: typeof row.plot_function === 'string' ? row.plot_function : undefined,
    appearance: typeof row.appearance === 'string' ? row.appearance : undefined,
    factionHint: typeof row.faction_hint === 'string' ? row.faction_hint : undefined,
    linkedCharacterIdsJson: typeof row.linked_character_ids_json === 'string' ? row.linked_character_ids_json : undefined,
    linkedTimelineEventIdsJson: typeof row.linked_timeline_event_ids_json === 'string' ? row.linked_timeline_event_ids_json : undefined,
    tagsJson: typeof row.tags_json === 'string' ? row.tags_json : undefined,
    sourceContextJson: typeof row.source_context_json === 'string' ? row.source_context_json : undefined,
    sortOrder: Number(row.sort_order || 0),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

function buildCharacterWhere(filters: CharacterQueryFilters) {
  const whereClauses = ['c.novel_id = ?']
  const params: Array<number | string> = [filters.novelId]

  if (filters.roleType) {
    whereClauses.push('c.role_type = ?')
    params.push(filters.roleType)
  }

  if (filters.recordStatus && filters.recordStatus !== 'all') {
    whereClauses.push("COALESCE(c.record_status, 'confirmed') = ?")
    params.push(filters.recordStatus)
  }

  if (filters.entityType) {
    whereClauses.push('c.entity_type = ?')
    params.push(filters.entityType)
  }

  if (filters.species) {
    whereClauses.push('c.species = ?')
    params.push(filters.species)
  }

  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
  if (keyword) {
    const like = `%${keyword}%`
    whereClauses.push(`
      (
        c.full_name LIKE ?
        OR COALESCE(c.species, '') LIKE ?
        OR COALESCE(c.occupation, '') LIKE ?
        OR COALESCE(c.rank_level, '') LIKE ?
        OR COALESCE(c.goals, '') LIKE ?
        OR COALESCE(c.inner_conflict, '') LIKE ?
        OR COALESCE(c.background, '') LIKE ?
      )
    `)
    params.push(like, like, like, like, like, like, like)
  }

  return {
    whereSql: whereClauses.join(' AND '),
    params,
  }
}

function uniqueNumberArray(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value)))]
}

export function queryCharacters(filters: CharacterQueryFilters) {
  const sqlite = getSqlite()
  const paging = normalizePaging(filters.page, filters.pageSize, 24)
  const query = buildCharacterWhere(filters)
  const countRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM characters c
    WHERE ${query.whereSql}
  `).get(...query.params) as { total?: number } | undefined

  const rows = sqlite.prepare(`
    SELECT c.*
    FROM characters c
    WHERE ${query.whereSql}
    ORDER BY
      CASE c.role_type
        WHEN 'protagonist' THEN 0
        WHEN 'major' THEN 1
        WHEN 'antagonist' THEN 2
        WHEN 'supporting' THEN 3
        ELSE 4
      END ASC,
      c.sort_order ASC,
      c.id ASC
    LIMIT ? OFFSET ?
  `).all(...query.params, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map(mapCharacterRecord)
  return buildPagedResult(items, paging.page, paging.pageSize, Number(countRow?.total || 0))
}

export function getCharacterStats(filters: CharacterQueryFilters) {
  const sqlite = getSqlite()
  const query = buildCharacterWhere(filters)
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS confirmedCount,
      SUM(CASE WHEN COALESCE(c.record_status, 'confirmed') = 'draft' THEN 1 ELSE 0 END) AS draftCount,
      SUM(CASE WHEN c.role_type = 'protagonist' AND COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS protagonistCount,
      SUM(CASE WHEN c.role_type = 'major' AND COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS majorCount,
      SUM(CASE WHEN c.role_type = 'antagonist' AND COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS antagonistCount,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(c.species, '')), '')) AS speciesCount
    FROM characters c
    WHERE ${query.whereSql}
  `).get(...query.params) as Record<string, unknown> | undefined

  const relationRow = sqlite.prepare(`
    SELECT COUNT(*) AS relationCount
    FROM character_relations r
    WHERE r.novel_id = ?
      AND (
        r.char_a_id IN (SELECT c.id FROM characters c WHERE ${query.whereSql})
        OR r.char_b_id IN (SELECT c.id FROM characters c WHERE ${query.whereSql})
      )
  `).get(filters.novelId, ...query.params, ...query.params) as Record<string, unknown> | undefined

  return {
    total: Number(row?.total || 0),
    confirmedCount: Number(row?.confirmedCount || 0),
    draftCount: Number(row?.draftCount || 0),
    protagonistCount: Number(row?.protagonistCount || 0),
    majorCount: Number(row?.majorCount || 0),
    antagonistCount: Number(row?.antagonistCount || 0),
    relationCount: Number(relationRow?.relationCount || 0),
    speciesCount: Number(row?.speciesCount || 0),
  }
}

export function getCharacterFilterOptions(novelId: number) {
  const sqlite = getSqlite()
  const speciesRows = sqlite.prepare(`
    SELECT DISTINCT species
    FROM characters
    WHERE novel_id = ?
      AND species IS NOT NULL
      AND TRIM(species) <> ''
    ORDER BY species ASC
  `).all(novelId) as Array<{ species?: string | null }>
  const entityRows = sqlite.prepare(`
    SELECT DISTINCT entity_type
    FROM characters
    WHERE novel_id = ?
      AND entity_type IS NOT NULL
      AND TRIM(entity_type) <> ''
    ORDER BY entity_type ASC
  `).all(novelId) as Array<{ entity_type?: string | null }>

  return {
    species: speciesRows
      .map((row) => (typeof row.species === 'string' ? row.species.trim() : ''))
      .filter(Boolean),
    entityTypes: entityRows
      .map((row) => (typeof row.entity_type === 'string' ? row.entity_type.trim() : ''))
      .filter(Boolean),
  }
}

export function searchCharacters(novelId: number, keyword = '', limit = 20) {
  return queryCharacters({
    novelId,
    keyword,
    page: 1,
    pageSize: Math.max(1, Math.min(limit, 50)),
  }).items
}

function characterMatchesGraphFilters(
  row: Record<string, unknown>,
  filters: CharacterGraphFilters,
): boolean {
  const roleType = String(row.role_type || 'minor')
  const recordStatus = normalizeRecordStatus(row.record_status)
  if (filters.recordStatus && filters.recordStatus !== 'all' && recordStatus !== filters.recordStatus) return false
  if (filters.roleTypes && filters.roleTypes.length > 0 && !filters.roleTypes.includes(roleType as typeof characters.$inferSelect['roleType'])) return false
  if (filters.factionNames && filters.factionNames.length > 0) {
    const factionNames = parseJsonArray(typeof row.camp_faction_ids_json === 'string' ? row.camp_faction_ids_json : '')
    if (!filters.factionNames.some((name) => factionNames.includes(name))) return false
  }
  return true
}

export function getCharacterGraph(filters: CharacterGraphFilters) {
  const sqlite = getSqlite()
  const relationWindowLimit = Math.max(12, Math.min(filters.limit || 24, 80))
  const requestedSeedIds = uniqueNumberArray([
    ...(filters.characterIds || []),
    ...(typeof filters.focusCharacterId === 'number' ? [filters.focusCharacterId] : []),
  ])

  const allRows = sqlite.prepare(`
    SELECT *
    FROM characters
    WHERE novel_id = ?
    ORDER BY
      CASE role_type
        WHEN 'protagonist' THEN 0
        WHEN 'major' THEN 1
        WHEN 'antagonist' THEN 2
        WHEN 'supporting' THEN 3
        ELSE 4
      END ASC,
      sort_order ASC,
      id ASC
  `).all(filters.novelId) as Array<Record<string, unknown>>

  const filteredRows = allRows.filter((row) => characterMatchesGraphFilters(row, filters))
  let visibleIds = requestedSeedIds.length > 0
    ? requestedSeedIds.filter((id) => filteredRows.some((row) => Number(row.id) === id))
    : filteredRows.slice(0, relationWindowLimit).map((row) => Number(row.id))

  if (typeof filters.focusCharacterId === 'number' && visibleIds.includes(filters.focusCharacterId)) {
    const focusRelations = sqlite.prepare(`
      SELECT *
      FROM character_relations
      WHERE novel_id = ?
        AND (char_a_id = ? OR char_b_id = ?)
      ORDER BY id ASC
      LIMIT ?
    `).all(filters.novelId, filters.focusCharacterId, filters.focusCharacterId, relationWindowLimit) as Array<Record<string, unknown>>

    const neighborIds = uniqueNumberArray(focusRelations.flatMap((row) => {
      const charAId = Number(row.char_a_id)
      const charBId = Number(row.char_b_id)
      return charAId === filters.focusCharacterId ? [charBId] : [charAId]
    })).filter((id) => filteredRows.some((item) => Number(item.id) === id))
    visibleIds = uniqueNumberArray([...visibleIds, ...neighborIds])
  }

  if (visibleIds.length === 0) {
    return { characters: [], relations: [] }
  }

  const characterRows = filteredRows.filter((row) => visibleIds.includes(Number(row.id)))

  const graphCharacterIds = characterRows.map((row) => Number(row.id))
  if (graphCharacterIds.length === 0) {
    return { characters: [], relations: [] }
  }

  const graphPlaceholders = graphCharacterIds.map(() => '?').join(', ')
  const relationRows = sqlite.prepare(`
    SELECT *
    FROM character_relations
    WHERE novel_id = ?
      AND char_a_id IN (${graphPlaceholders})
      AND char_b_id IN (${graphPlaceholders})
    ORDER BY id ASC
    LIMIT ?
  `).all(filters.novelId, ...graphCharacterIds, ...graphCharacterIds, relationWindowLimit * 4) as Array<Record<string, unknown>>

  const filteredRelations = relationRows.filter((row) => {
    if (!filters.relationTypes || filters.relationTypes.length === 0) return true
    const relationType = typeof row.relation_type === 'string' ? row.relation_type : ''
    return filters.relationTypes.includes(relationType)
  })

  return {
    characters: characterRows.map(mapCharacterRecord),
    relations: filteredRelations.map(mapRelationRecord),
  }
}

export function getCharacterDetailContext(characterId: number) {
  const current = getCharacter(characterId)
  if (!current) {
    return {
      relatedItems: [],
      relatedCharacters: [],
      relatedRelations: [],
    }
  }

  const sqlite = getSqlite()
  const relationRows = sqlite.prepare(`
    SELECT *
    FROM character_relations
    WHERE novel_id = ?
      AND (char_a_id = ? OR char_b_id = ?)
    ORDER BY id ASC
    LIMIT 32
  `).all(current.novelId, characterId, characterId) as Array<Record<string, unknown>>
  const relatedRelations = relationRows.map(mapRelationRecord)
  const relatedIds = uniqueNumberArray(relatedRelations.flatMap((relation) => (
    relation.charAId === characterId ? [relation.charBId] : [relation.charAId]
  )))

  const relatedCharacters = relatedIds.length > 0
    ? sqlite.prepare(`
      SELECT *
      FROM characters
      WHERE novel_id = ?
        AND id IN (${relatedIds.map(() => '?').join(', ')})
      ORDER BY
        CASE role_type
          WHEN 'protagonist' THEN 0
          WHEN 'major' THEN 1
          WHEN 'antagonist' THEN 2
          WHEN 'supporting' THEN 3
          ELSE 4
        END ASC,
        sort_order ASC,
        id ASC
    `).all(current.novelId, ...relatedIds).map((row) => mapCharacterRecord(row as Record<string, unknown>))
    : []

  const singlePattern = `[${characterId}]`
  const prefixPattern = `[${characterId},%`
  const middlePattern = `%,${characterId},%`
  const suffixPattern = `%,${characterId}]`
  const itemRows = sqlite.prepare(`
    SELECT *
    FROM story_items
    WHERE novel_id = ?
      AND item_kind = 'instance'
      AND (
        owner_character_id = ?
        OR linked_character_ids_json = ?
        OR linked_character_ids_json LIKE ?
        OR linked_character_ids_json LIKE ?
        OR linked_character_ids_json LIKE ?
      )
    ORDER BY sort_order ASC, id ASC
    LIMIT 24
  `).all(current.novelId, characterId, singlePattern, prefixPattern, middlePattern, suffixPattern) as Array<Record<string, unknown>>

  return {
    relatedItems: itemRows.map(mapStoryItemRecord),
    relatedCharacters,
    relatedRelations,
  }
}

export function listCharacters(novelId: number) {
  const db = getDb()
  return db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
}

export function getCharacter(id: number) {
  const db = getDb()
  return db.select().from(characters).where(eq(characters.id, id)).all()[0] || null
}

export function createCharacter(
  novelId: number,
  data: Partial<typeof characters.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const result = db.insert(characters).values({
    novelId,
    fullName: data.fullName || '未命名角色',
    recordStatus: normalizeRecordStatus(data.recordStatus),
    ...data,
  }).run()
  const id = Number(result.lastInsertRowid)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Character profiles changed')
  }
  return id
}

export function updateCharacter(
  id: number,
  data: Partial<typeof characters.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  db.update(characters).set({
    ...data,
    ...(data.recordStatus ? { recordStatus: normalizeRecordStatus(data.recordStatus) } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(characters.id, id)).run()
  if (!options.skipContextTracking) {
    const current = getCharacter(id)
    if (current) {
      markNovelContextChanged(current.novelId, 'Character profiles changed')
    }
  }
}

export function deleteCharacter(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = getCharacter(id)
  db.delete(characters).where(eq(characters.id, id)).run()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Character profiles changed')
  }
}

export function clearCharactersByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()

  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  itemRows.forEach((item) => {
    db.update(storyItems).set({
      ownerCharacterId: null,
      linkedCharacterIdsJson: stringifyNumberArray([]),
      updatedAt: new Date().toISOString(),
    }).where(eq(storyItems.id, item.id)).run()
  })

  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  eventRows.forEach((event) => {
    const presentIds = parseNumberArray(event.presentCharacterIdsJson)
    const affectedIds = parseNumberArray(event.affectedCharacterIdsJson)
    if (presentIds.length === 0 && affectedIds.length === 0 && !event.protagonistAction) return
    db.update(timelineEvents).set({
      presentCharacterIdsJson: stringifyNumberArray([]),
      affectedCharacterIdsJson: stringifyNumberArray([]),
      protagonistAction: event.protagonistAction || null,
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })

  db.delete(characterRelations).where(eq(characterRelations.novelId, novelId)).run()
  db.delete(characters).where(eq(characters.novelId, novelId)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Character profiles changed')
  }
}

export function getCharacterRelations(novelId: number) {
  const db = getDb()
  return db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
}

export function upsertRelation(data: {
  novelId: number
  charAId: number
  charBId: number
  relationType: string
  relationLabel?: string
  description?: string
  bilateral?: number
  intimacyLevel?: number
  tensionLevel?: number
  interactionStyle?: string
  subtextRule?: string
}, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const existing = getCharacterRelations(data.novelId).find((relation) => {
    const sameDirection = relation.charAId === data.charAId && relation.charBId === data.charBId
    const reverseDirection = relation.charAId === data.charBId && relation.charBId === data.charAId
    return sameDirection || reverseDirection
  })

  const payload = {
    ...data,
    relationLabel: data.relationLabel?.trim() || null,
    description: data.description?.trim() || null,
    bilateral: data.bilateral ? 1 : 0,
    intimacyLevel: normalizeCharacterRelationLevel(data.intimacyLevel) ?? null,
    tensionLevel: normalizeCharacterRelationLevel(data.tensionLevel) ?? null,
    interactionStyle: data.interactionStyle?.trim() || null,
    subtextRule: data.subtextRule?.trim() || null,
  }

  if (existing) {
    db.update(characterRelations).set(payload).where(eq(characterRelations.id, existing.id)).run()
  } else {
    db.insert(characterRelations).values(payload).run()
  }

  if (!options.skipContextTracking) {
    markNovelContextChanged(data.novelId, "Character relations changed")
  }
}

function hasReservedCharacterName(name: string, reservedNames: string[]) {
  const normalized = normalizeLookup(name)
  if (!normalized) return false
  return reservedNames.some((item) => normalizeLookup(item) === normalized)
}

export async function generateProtagonist(novelId: number, opts: {
  gender?: string
  surnameHint?: string
  ageRange?: string
  species?: string
  occupationHint?: string
  factionHint?: string
  itemPreferences?: string[]
  personalitySeed?: string
  forbiddenNames?: string[]
  forceDifferentFromExisting?: boolean
}): Promise<number> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const reservedNames = [...new Set([
    ...existingChars.map((character) => character.fullName).filter(Boolean),
    ...(opts.forbiddenNames || []).filter(Boolean),
  ])]
  const existingCharacterSummaries = buildExistingCharacterDigest(existingChars)
  const itemSummary = buildItemResourceSummary(itemRows)
  const historyEntityType = 'character'
  const historyTaskType = 'character_protagonist'

  let parsed: Record<string, unknown> | null = null
  const attempts = opts.forceDifferentFromExisting ? 3 : 2
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const prompt = protagonistPrompt({
      novelTitle: novel.title,
      novelSynopsis: profile.background,
      genre: profile.genre,
      worldSummary: profile.worldRulesSummary,
      storyCore: buildStoryCoreSummary(profile),
      speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
      factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
      ecologySummary: buildCharacterEcologySummary(rules),
      mapSummary: buildMapBlueprintSummary(rules),
      writingConstraints: rules.writingConstraints.extraRules.join('；'),
      gender: opts.gender || '不限',
      surnameHint: opts.surnameHint,
      ageRange: opts.ageRange,
      speciesPreference: opts.species,
      occupationHint: opts.occupationHint,
      factionHint: opts.factionHint,
      itemPreferences: opts.itemPreferences?.join('、'),
      personalitySeed: opts.personalitySeed,
      forbiddenNames: reservedNames.join('、'),
      forceDifferentFromExisting: opts.forceDifferentFromExisting,
      attemptNumber,
      rejectedDigests,
    })

    let acceptedCandidate: Record<string, unknown> | null = null
    let rejectedByQuality = false
    const result = await runChatTask({
      type: 'character_gen',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
      onSuccess: async (rawOutput, taskId) => {
        const quality = await runAssetQualityLoop({
          targetType: 'character',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          contextSummary: buildCharacterReviewContext({
            profile,
            worldSummary: profile.worldRulesSummary,
            protagonistSummary: '这是主角卡，请重点检查主角能否成立为全书最稳定的视角锚点。',
            existingCharacterSummaries,
            itemSummary,
            extraLines: [
              opts.itemPreferences && opts.itemPreferences.length > 0 ? `偏好线索：${opts.itemPreferences.join('、')}` : '',
            ],
          }),
          generatedOutput: rawOutput,
          schemaHint: characterSchemaHint(),
          reviewFocus: [
            '主角不能像万能模板人设，要有具体欲望、代价和内在矛盾。',
            '主角描述要能直接进入正文上下文，不要停留在空泛标签。',
          ],
          rewriteConstraints: [
            '保持单个角色 JSON 对象结构稳定。',
            '不要替换人物姓名，除非原输出根本没有可用姓名。',
          ],
        })
        if (quality.stage === 'rejected') {
          rejectedByQuality = true
          return quality
        }
        acceptedCandidate = cleanAiValue(safeParseJson<Record<string, unknown>>(quality.finalOutput))
        return quality
      },
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)

    if (rejectedByQuality) {
      markRejected(historyId)
      continue
    }

    const nextParsed = acceptedCandidate || cleanAiValue(safeParseJson<Record<string, unknown>>(result))
    const candidateName = asText(nextParsed.full_name) || asText(nextParsed.name)
    if (!hasReservedCharacterName(candidateName, reservedNames)) {
      parsed = nextParsed
      break
    }
    markRejected(historyId)
  }

  if (!parsed) {
    throwUserFacingError('character.protagonistNoUsableCandidate')
  }

  const payload = buildCharacterPayload(parsed, {
    roleType: 'protagonist',
    recordStatus: 'confirmed',
  })
  payload.contextHooksJson = jsonStringifyArray([
    ...parseJsonArray(payload.contextHooksJson as string | undefined),
    ...(opts.itemPreferences || []).map((item) => `${item}线索`),
  ])
  if (!payload.background && itemRows.length > 0) {
    payload.background = `与 ${itemRows.slice(0, 2).map((item) => item.itemName).join('、')} 等关键资源存在潜在关联。`
  }
  const charId = createCharacter(novelId, payload, {
    skipContextTracking: true,
  })
  markNovelContextChanged(novelId, 'Character profiles changed')
  return charId
}

export async function generateCharacterBatchChunk(
  novelId: number,
  opts: CharacterBatchGenerationOptions,
  runtime: {
    parentTaskId?: number
    sender?: WebContents
    batchIndex?: number
    totalBatches?: number
  } = {},
): Promise<CharacterBatchChunkResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const reservedNames = existingChars.map((character) => character.fullName).filter(Boolean)
  const protagonist = existingChars.find((character) => character.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : '主角未设定'
  const existingCharacterSummaries = buildExistingCharacterDigest(existingChars)
  const roleBlueprint = buildRoleBlueprintSummary(opts)
  const itemSummary = buildItemResourceSummary(itemRows)
  const roleQueue = buildRoleQueue(opts)
  const totalCount = roleQueue.length
  if (totalCount <= 0) {
    return {
      ids: [],
      majorGenerated: 0,
      minorGenerated: 0,
      antagonistGenerated: 0,
      supportingGenerated: 0,
    }
  }

  const specialRequirements = [
    opts.specialRequirements,
    `角色配额：主要人物 ${opts.majorCount}，反派 ${opts.antagonistCount || 0}，功能角色 ${opts.supportingCount || 0}，次要人物 ${opts.minorCount}。`,
    opts.preferredSpecies && opts.preferredSpecies.length > 0 ? `优先种族或实体：${opts.preferredSpecies.join('、')}。` : '',
    opts.factionBias && opts.factionBias.length > 0 ? `优先势力来源：${opts.factionBias.join('、')}。` : '',
    opts.helperRoles && opts.helperRoles.length > 0 ? `优先补齐这些角色功能位：${opts.helperRoles.join('、')}。` : '',
    itemSummary ? `优先与这些现有物品/资源发生绑定：\n${itemSummary}` : '',
    '角色必须和题材、背景、地图结构、势力关系与主线冲突直接相关。',
  ].filter(Boolean).join('\n')
  const reviewContext = buildCharacterReviewContext({
    profile,
    worldSummary: profile.worldRulesSummary,
    protagonistSummary,
    existingCharacterSummaries,
    itemSummary,
    extraLines: [
      roleBlueprint ? `角色蓝图：${roleBlueprint}` : '',
      specialRequirements ? `额外要求：${specialRequirements}` : '',
    ],
  })
  const historyEntityType = 'character'
  const historyTaskType = 'character_batch'
  const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
  const prompt = batchCharacterPrompt({
    novelTitle: novel.title,
    novelSynopsis: profile.background,
    protagonistSummary,
    existingNames: reservedNames.join('、'),
    existingCharacterSummaries,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
    storyCore: buildStoryCoreSummary(profile),
    speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
    factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
    ecologySummary: buildCharacterEcologySummary(rules),
    mapSummary: buildMapBlueprintSummary(rules),
    writingConstraints: rules.writingConstraints.extraRules.join('；'),
    count: totalCount,
    genderRatio: opts.genderRatio || '不限',
    specialRequirements,
    roleBlueprint,
    relationSeedMode: opts.relationSeedMode,
    requiredItemLinks: opts.requiredItemLinks?.join('、'),
    diversityConstraints: opts.diversityConstraints?.join('、'),
    attemptNumber,
    rejectedDigests,
  })
  const messages = [{ role: 'user' as const, content: prompt }]
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'character_gen',
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

  let resultPayload: CharacterBatchChunkResult | null = null

  try {
    await executeChatTask(taskId, {
      type: 'character_gen',
      novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: novelId,
      inputJson,
      messages,
      sender: runtime.sender,
      onSuccess: async (result) => {
        const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
        const quality = await runAssetQualityLoop({
          targetType: 'character',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender: runtime.sender,
          contextSummary: reviewContext,
          generatedOutput: result,
          schemaHint: characterSchemaHint(totalCount),
          reviewFocus: [
            '角色描述必须具体，避免只剩标签、履历和模板化设定句。',
            '每个角色都要和主线冲突、背景环境或关键资源形成可落笔的关系。',
          ],
          rewriteConstraints: [
            '保持角色数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把批量人物卡改写成说明文。',
          ],
        })
        if (quality.stage === 'rejected') {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            majorGenerated: 0,
            minorGenerated: 0,
            antagonistGenerated: 0,
            supportingGenerated: 0,
            warning: summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批人物被审校拒收。`,
          }
          return resultPayload
        }

        let parsed: Array<Record<string, unknown>>
        try {
          parsed = cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(quality.finalOutput))
        } catch (error) {
          markRejected(historyId)
          throw error
        }

        const createdIds: number[] = []
        const createdNames: string[] = []
        let majorGenerated = 0
        let minorGenerated = 0
        let antagonistGenerated = 0
        let supportingGenerated = 0

        for (const char of parsed) {
          const fallbackRole = roleQueue[createdIds.length] || 'minor'
          const payload = buildCharacterPayload(char, {
            roleType: normalizeRoleType(asText(char.role_type) || fallbackRole),
            recordStatus: 'confirmed',
          })
          const candidateName = typeof payload.fullName === 'string' ? payload.fullName : ''
          if (!candidateName || hasReservedCharacterName(candidateName, reservedNames)) {
            continue
          }
          if (itemRows.length > 0 && !payload.contextHooksJson) {
            payload.contextHooksJson = jsonStringifyArray(itemRows.slice(0, 2).map((item) => `${item.itemName}相关`))
          }
          const id = createCharacter(novelId, payload, { skipContextTracking: true })
          reservedNames.push(candidateName)
          createdIds.push(id)
          createdNames.push(candidateName)
          if (payload.roleType === 'major') majorGenerated += 1
          else if (payload.roleType === 'antagonist') antagonistGenerated += 1
          else if (payload.roleType === 'supporting') supportingGenerated += 1
          else minorGenerated += 1
          if (createdIds.length >= totalCount) break
        }

        if (createdIds.length === 0) {
          markRejected(historyId)
        }
        if (createdIds.length > 0) {
          markNovelContextChanged(novelId, 'Character profiles changed')
        }

        resultPayload = {
          ids: createdIds,
          majorGenerated,
          minorGenerated,
          antagonistGenerated,
          supportingGenerated,
          batchDigest: createdNames.slice(0, 4).join('、'),
          warning: createdIds.length > 0
            ? summarizeAssetQualityWarnings(quality)
            : (summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批没有生成可用人物。`),
        }
        return resultPayload
      },
    })
  } finally {
    if (typeof runtime.parentTaskId === 'number') {
      updateTask(runtime.parentTaskId, { currentChildTaskId: null })
    }
  }

  return resultPayload || {
    ids: [],
    majorGenerated: 0,
    minorGenerated: 0,
    antagonistGenerated: 0,
    supportingGenerated: 0,
  }
}

export async function batchGenerateCharacters(novelId: number, opts: {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
  genderRatio: string
  preferredSpecies?: string[]
  factionBias?: string[]
  helperRoles?: string[]
  specialRequirements: string
  batchSize: number
  relationSeedMode?: 'balanced' | 'conflict-heavy' | 'ally-heavy'
  requiredItemLinks?: string[]
  diversityConstraints?: string[]
}, sender?: WebContents): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const reservedNames = existingChars.map((character) => character.fullName).filter(Boolean)
  const protagonist = existingChars.find(c => c.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : '主角未设定'
  const existingCharacterSummaries = buildExistingCharacterDigest(existingChars)
  const roleBlueprint = buildRoleBlueprintSummary(opts)
  const itemSummary = buildItemResourceSummary(itemRows)
  const reviewContext = buildCharacterReviewContext({
    profile,
    worldSummary: profile.worldRulesSummary,
    protagonistSummary,
    existingCharacterSummaries,
    itemSummary,
    extraLines: [
      roleBlueprint ? `角色蓝图：${roleBlueprint}` : '',
      opts.specialRequirements ? `额外要求：${opts.specialRequirements}` : '',
    ],
  })

  const roleQueue = buildRoleQueue(opts)
  const specialRequirements = [
    opts.specialRequirements,
    `角色配额：主要人物 ${opts.majorCount}，反派 ${opts.antagonistCount || 0}，功能角色 ${opts.supportingCount || 0}，次要人物 ${opts.minorCount}。`,
    opts.preferredSpecies && opts.preferredSpecies.length > 0 ? `优先种族或实体：${opts.preferredSpecies.join('、')}。` : '',
    opts.factionBias && opts.factionBias.length > 0 ? `优先势力来源：${opts.factionBias.join('、')}。` : '',
    opts.helperRoles && opts.helperRoles.length > 0 ? `优先补齐这些角色功能位：${opts.helperRoles.join('、')}。` : '',
    itemSummary ? `优先与这些现有物品/资源发生绑定：\n${itemSummary}` : '',
    '角色必须和题材、背景、地图结构、势力关系与主线冲突直接相关。',
  ].filter(Boolean).join('\n')

  const totalCount = roleQueue.length
  if (totalCount <= 0) return []
  const newIds: number[] = []
  let generatedAttempts = 0
  const historyEntityType = 'character'
  const historyTaskType = 'character_batch'

  while (newIds.length < totalCount && generatedAttempts < Math.max(3, totalCount)) {
    const batchCount = Math.min(opts.batchSize, totalCount - newIds.length)
    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const prompt = batchCharacterPrompt({
      novelTitle: novel.title,
      novelSynopsis: profile.background,
      protagonistSummary,
      existingNames: reservedNames.join('、'),
      existingCharacterSummaries,
      genre: profile.genre,
      worldSummary: profile.worldRulesSummary,
      storyCore: buildStoryCoreSummary(profile),
      speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
      factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
      ecologySummary: buildCharacterEcologySummary(rules),
      mapSummary: buildMapBlueprintSummary(rules),
      writingConstraints: rules.writingConstraints.extraRules.join('；'),
      count: batchCount,
      genderRatio: opts.genderRatio || '不限',
      specialRequirements,
      roleBlueprint,
      relationSeedMode: opts.relationSeedMode,
      requiredItemLinks: opts.requiredItemLinks?.join('、'),
      diversityConstraints: opts.diversityConstraints?.join('、'),
      attemptNumber,
      rejectedDigests,
    })

    let acceptedBatch: Array<Record<string, unknown>> | null = null
    let rejectedByQuality = false
    const result = await runChatTask({
      type: 'character_gen',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
      sender,
      onSuccess: async (rawOutput, taskId) => {
        const quality = await runAssetQualityLoop({
          targetType: 'character',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender,
          contextSummary: reviewContext,
          generatedOutput: rawOutput,
          schemaHint: characterSchemaHint(batchCount),
          reviewFocus: [
            '人物卡必须具体，不能只剩模板标签、履历词和空泛人设。',
            '人物与主线、背景、关键资源之间要存在可直接写进正文的钩子。',
          ],
          rewriteConstraints: [
            '保持角色数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把人物卡改写成散文。',
          ],
        })
        if (quality.stage === 'rejected') {
          rejectedByQuality = true
          return quality
        }
        acceptedBatch = cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(quality.finalOutput))
        return quality
      },
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
    const beforeCreateCount = newIds.length

    if (rejectedByQuality) {
      markRejected(historyId)
      if (sender && !sender.isDestroyed()) {
        sender.send('character:batch-progress', {
          batch: generatedAttempts + 1,
          total: Math.max(1, Math.ceil(totalCount / Math.max(1, opts.batchSize))),
          newIds,
        })
      }
      generatedAttempts += 1
      continue
    }

    try {
      const parsed = acceptedBatch || cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(result))
      for (const char of parsed) {
        const fallbackRole = roleQueue[newIds.length] || 'minor'
        const payload = buildCharacterPayload(char, {
          roleType: normalizeRoleType(asText(char.role_type) || fallbackRole),
          recordStatus: 'confirmed',
        })
        const candidateName = typeof payload.fullName === 'string' ? payload.fullName : ''
        if (!candidateName || hasReservedCharacterName(candidateName, reservedNames)) {
          continue
        }
        if (itemRows.length > 0 && !payload.contextHooksJson) {
          payload.contextHooksJson = jsonStringifyArray(itemRows.slice(0, 2).map((item) => `${item.itemName}相关`))
        }
        const id = createCharacter(novelId, payload, { skipContextTracking: true })
        reservedNames.push(candidateName)
        newIds.push(id)
        if (newIds.length >= totalCount) break
      }
    } catch (error) {
      console.error('批量生成人物解析失败:', error)
      markRejected(historyId)
    }

    if (newIds.length === beforeCreateCount) {
      markRejected(historyId)
    }

    if (sender && !sender.isDestroyed()) {
      sender.send('character:batch-progress', {
        batch: generatedAttempts + 1,
        total: Math.max(1, Math.ceil(totalCount / Math.max(1, opts.batchSize))),
        newIds,
      })
    }
    generatedAttempts += 1
  }

  if (newIds.length > 0) {
    markNovelContextChanged(novelId, 'Character profiles changed')
  }

  return newIds
}

export async function regenerateCharacter(id: number): Promise<typeof characters.$inferSelect | null> {
  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  if (!current) throwUserFacingError('character.notFound')

  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(current.novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, current.novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, current.novelId)).all()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, current.novelId)).all()
    .filter((relation) => relation.charAId === current.id || relation.charBId === current.id)

  const relatedIds = new Set<number>()
  relationRows.forEach((relation) => {
    relatedIds.add(relation.charAId)
    relatedIds.add(relation.charBId)
  })
  relatedIds.delete(current.id)

  const relatedCharacters = allCharacters
    .filter((character) => character.id !== current.id)
    .sort((left, right) => {
      const relatedDiff = Number(relatedIds.has(right.id)) - Number(relatedIds.has(left.id))
      if (relatedDiff !== 0) return relatedDiff
      return roleOrder(left.roleType) - roleOrder(right.roleType)
    })
    .slice(0, 6)
    .map(buildCharacterSummary)
    .join('\n')

  const relationSummary = relationRows
    .map((relation) => {
      const otherId = relation.charAId === current.id ? relation.charBId : relation.charAId
      const other = allCharacters.find((character) => character.id === otherId)
      if (!other) return ""
      return buildCharacterRelationSummaryLine(current.fullName, other.fullName, relation)
    })
    .filter(Boolean)
    .join("\n")
  const protagonist = allCharacters.find((character) => character.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : ''
  const itemSummary = buildItemResourceSummary(itemRows)
  const reviewContext = buildCharacterReviewContext({
    profile,
    worldSummary: profile.worldRulesSummary,
    protagonistSummary,
    existingCharacterSummaries: buildExistingCharacterDigest(allCharacters.filter((character) => character.id !== current.id)),
    relationSummary,
    itemSummary,
    extraLines: [
      `当前人物卡：\n${buildCurrentProfileSummary(current)}`,
      relatedCharacters ? `关联人物：\n${relatedCharacters}` : '',
    ],
  })
  const historyEntityType = 'character'
  const historyTaskType = 'character_regenerate'
  const attemptNumber = getAttemptCount(current.novelId, historyEntityType, current.id, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(current.novelId, historyEntityType, current.id, historyTaskType)

  const prompt = regenerateCharacterPrompt({
    novelTitle: novel.title,
    novelSynopsis: profile.background,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
    storyCore: buildStoryCoreSummary(profile),
    speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
    factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
    ecologySummary: buildCharacterEcologySummary(rules),
    writingConstraints: rules.writingConstraints.extraRules.join('；'),
    protagonistRule: profile.protagonistRule,
    lockedName: current.fullName,
    lockedRoleType: current.roleType || 'minor',
    currentProfile: buildCurrentProfileSummary(current),
    relatedCharacters,
    relationSummary,
    attemptNumber,
    rejectedDigests,
  })

  let acceptedCandidate: Record<string, unknown> | null = null
  let rejectedByQuality = false
  const result = await runChatTask({
    type: 'character_gen',
    novelId: current.novelId,
    relatedEntityType: 'character',
    relatedEntityId: current.id,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
    onSuccess: async (rawOutput, taskId) => {
      const quality = await runAssetQualityLoop({
        targetType: 'character',
        novelId: current.novelId,
        modelConfigId: novel.modelConfigId || undefined,
        relatedEntityType: 'character',
        relatedEntityId: current.id,
        parentTaskId: taskId,
        contextSummary: reviewContext,
        generatedOutput: rawOutput,
        schemaHint: characterSchemaHint(),
        reviewFocus: [
          '修复后的人物卡必须继续占据原功能位，不能漂移成另一个无关角色。',
          '优先修复空泛、冲突、关系失真和语言模板感。',
        ],
        rewriteConstraints: [
          '保持单个角色 JSON 对象结构稳定。',
          '除非原输出缺名，否则不要替换锁定姓名。',
        ],
      })
      if (quality.stage === 'rejected') {
        rejectedByQuality = true
        return quality
      }
      acceptedCandidate = cleanAiValue(safeParseJson<Record<string, unknown>>(quality.finalOutput))
      return quality
    },
  })
  const historyId = recordGeneration(current.novelId, historyEntityType, current.id, historyTaskType, result, attemptNumber)

  if (rejectedByQuality) {
    markRejected(historyId)
    return current
  }

  const parsed = acceptedCandidate || cleanAiValue(safeParseJson<Record<string, unknown>>(result))
  const payload = buildCharacterPayload(parsed, {
    existing: current,
    fullName: current.fullName,
    roleType: current.roleType || 'minor',
  })
  payload.fullName = current.fullName
  payload.roleType = current.roleType || 'minor'

  updateCharacter(current.id, payload, { skipContextTracking: true })
  markNovelContextChanged(current.novelId, 'Character profiles changed')
  return getCharacter(current.id)
}

export async function generateCharacterRelations(novelId: number): Promise<void> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  const profile = await buildStoryProfile(novelId)
  if (!novel) throwUserFacingError('novel.notFound')

  const charList = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  if (charList.length < 2) throwUserFacingError('character.relationNeedAtLeastTwo')

  const characterListText = charList.map((character) => buildCharacterSummary(character)).join('\n')
  const prompt = characterRelationsPrompt({
    novelSynopsis: novel.synopsis || novel.expandedBackground || '',
    characterList: characterListText,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
  })

  const result = await runChatTask({
    type: 'character_gen',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  try {
    const relations = safeParseJson<Array<Record<string, unknown>>>(result)
    for (const relation of relations) {
      const charA = charList.find((character) => character.fullName === relation.char_a)
      const charB = charList.find((character) => character.fullName === relation.char_b)
      if (charA && charB) {
        upsertRelation({
          novelId,
          charAId: charA.id,
          charBId: charB.id,
          relationType: asText(relation.type || relation.relation_type),
          relationLabel: asText(relation.label || relation.relation_label),
          description: asText(relation.description),
          bilateral: relation.bilateral ? 1 : 0,
          intimacyLevel: normalizeCharacterRelationLevel(relation.intimacy_level ?? relation.intimacyLevel),
          tensionLevel: normalizeCharacterRelationLevel(relation.tension_level ?? relation.tensionLevel),
          interactionStyle: asText(relation.interaction_style || relation.interactionStyle),
          subtextRule: asText(relation.subtext_rule || relation.subtextRule),
        }, { skipContextTracking: true })
      }
    }
    markNovelContextChanged(novelId, 'Character relations changed')
  } catch (error) {
    console.error('关系解析失败:', error)
  }
}
