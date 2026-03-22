import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { characters, characterRelations, novels, storyItems, timelineEvents } from '../database/schema'
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
import { runChatTask } from './task.service'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { markNovelContextChanged } from './context-impact.service'

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

function buildCharacterPayload(
  parsed: Record<string, unknown>,
  fallback: {
    roleType?: string
    fullName?: string
    existing?: typeof characters.$inferSelect | null
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

  return {
    roleType,
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
    appearChapter: asNumber(sanitized.appear_chapter) ?? fallback.existing?.appearChapter,
  }
}

interface CharacterQueryFilters {
  novelId: number
  roleType?: typeof characters.$inferSelect['roleType']
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
    relationType: typeof row.relation_type === 'string' ? row.relation_type : undefined,
    relationLabel: typeof row.relation_label === 'string' ? row.relation_label : undefined,
    bilateral: Number(row.bilateral || 0),
    description: typeof row.description === 'string' ? row.description : undefined,
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
      SUM(CASE WHEN c.role_type = 'protagonist' THEN 1 ELSE 0 END) AS protagonistCount,
      SUM(CASE WHEN c.role_type = 'major' THEN 1 ELSE 0 END) AS majorCount,
      SUM(CASE WHEN c.role_type = 'antagonist' THEN 1 ELSE 0 END) AS antagonistCount,
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

export function getCharacterGraph(filters: CharacterGraphFilters) {
  const sqlite = getSqlite()
  const relationWindowLimit = Math.max(12, Math.min(filters.limit || 24, 80))
  const seedIds = uniqueNumberArray([
    ...(filters.characterIds || []),
    ...(typeof filters.focusCharacterId === 'number' ? [filters.focusCharacterId] : []),
  ])

  if (seedIds.length === 0) {
    return { characters: [], relations: [] }
  }

  let visibleIds = [...seedIds]
  if (typeof filters.focusCharacterId === 'number') {
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
    }))
    visibleIds = uniqueNumberArray([...visibleIds, ...neighborIds])
  }

  if (visibleIds.length === 0) {
    return { characters: [], relations: [] }
  }

  const placeholders = visibleIds.map(() => '?').join(', ')
  const characterRows = sqlite.prepare(`
    SELECT *
    FROM characters
    WHERE novel_id = ?
      AND id IN (${placeholders})
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
  `).all(filters.novelId, ...visibleIds) as Array<Record<string, unknown>>

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

  return {
    characters: characterRows.map(mapCharacterRecord),
    relations: relationRows.map(mapRelationRecord),
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
  const result = db.insert(characters).values({ novelId, fullName: data.fullName || '未命名角色', ...data }).run()
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
  db.update(characters).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(characters.id, id)).run()
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
}, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const existing = getCharacterRelations(data.novelId).find((relation) => {
    const sameDirection = relation.charAId === data.charAId && relation.charBId === data.charBId
    const reverseDirection = relation.charAId === data.charBId && relation.charBId === data.charAId
    return sameDirection || reverseDirection
  })

  if (existing) {
    db.update(characterRelations).set({
      ...data,
      description: data.description || null,
      relationLabel: data.relationLabel || null,
    }).where(eq(characterRelations.id, existing.id)).run()
  } else {
    db.insert(characterRelations).values({
      ...data,
      description: data.description || null,
      relationLabel: data.relationLabel || null,
    }).run()
  }

  if (!options.skipContextTracking) {
    markNovelContextChanged(data.novelId, 'Character relations changed')
  }
}

export async function generateProtagonist(novelId: number, opts: {
  gender?: string
  surnameHint?: string
}): Promise<number> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
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
  })

  const result = await runChatTask({
    type: 'generate_relations',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(result))
  const charId = createCharacter(novelId, buildCharacterPayload(parsed, { roleType: 'protagonist' }), {
    skipContextTracking: true,
  })
  markNovelContextChanged(novelId, 'Character profiles changed')
  return charId
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
}, sender?: WebContents): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const reservedNames = existingChars.map((character) => character.fullName).filter(Boolean)
  const protagonist = existingChars.find(c => c.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : '主角未设定'

  const roleQueue = buildRoleQueue(opts)
  const specialRequirements = [
    opts.specialRequirements,
    `角色配额：主要人物 ${opts.majorCount}，反派 ${opts.antagonistCount || 0}，功能角色 ${opts.supportingCount || 0}，次要人物 ${opts.minorCount}。`,
    opts.preferredSpecies && opts.preferredSpecies.length > 0 ? `优先种族或实体：${opts.preferredSpecies.join('、')}。` : '',
    opts.factionBias && opts.factionBias.length > 0 ? `优先势力来源：${opts.factionBias.join('、')}。` : '',
    opts.helperRoles && opts.helperRoles.length > 0 ? `优先补齐这些角色功能位：${opts.helperRoles.join('、')}。` : '',
    '角色必须和题材、背景、地图结构、势力关系与主线冲突直接相关。',
  ].filter(Boolean).join('\n')

  const totalCount = roleQueue.length
  if (totalCount <= 0) return []
  const batches = Math.ceil(totalCount / opts.batchSize)
  const newIds: number[] = []

  for (let i = 0; i < batches; i++) {
    const batchCount = Math.min(opts.batchSize, totalCount - i * opts.batchSize)
    const prompt = batchCharacterPrompt({
      novelTitle: novel.title,
      novelSynopsis: profile.background,
      protagonistSummary,
      existingNames: reservedNames.join('、'),
      genre: profile.genre,
      worldSummary: profile.worldRulesSummary,
      storyCore: buildStoryCoreSummary(profile),
      speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
      factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
      ecologySummary: buildCharacterEcologySummary(rules),
      mapSummary: buildMapBlueprintSummary(rules),
      writingConstraints: rules.writingConstraints.extraRules.join('；'),
      count: batchCount,
      genderRatio: opts.genderRatio,
      specialRequirements,
    })

    const result = await runChatTask({
      type: 'character_gen',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    try {
      const parsed = cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(result))
      for (const char of parsed) {
        const fallbackRole = roleQueue[newIds.length] || 'minor'
        const payload = buildCharacterPayload(char, {
          roleType: normalizeRoleType(asText(char.role_type) || fallbackRole),
        })
        const id = createCharacter(novelId, payload, { skipContextTracking: true })
        reservedNames.push(typeof payload.fullName === 'string' ? payload.fullName : '')
        newIds.push(id)
      }
    } catch (error) {
      console.error('批量生成人物解析失败:', error)
    }

    if (sender && !sender.isDestroyed()) {
      sender.send('character:batch-progress', { batch: i + 1, total: batches, newIds })
    }
  }

  if (newIds.length > 0) {
    markNovelContextChanged(novelId, 'Character profiles changed')
  }

  return newIds
}

export async function regenerateCharacter(id: number): Promise<typeof characters.$inferSelect | null> {
  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  if (!current) throw new Error('人物不存在')

  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(current.novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, current.novelId)).all()
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
      if (!other) return ''
      const parts = [relation.relationLabel || relation.relationType, relation.description].filter(Boolean).join('；')
      return `- 与 ${other.fullName}：${parts || '已有关系'}`
    })
    .filter(Boolean)
    .join('\n')

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
  })

  const result = await runChatTask({
    type: 'character_gen',
    novelId: current.novelId,
    relatedEntityType: 'character',
    relatedEntityId: current.id,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(result))
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
  if (!novel) throw new Error('小说不存在')

  const charList = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  if (charList.length < 2) throw new Error('至少需要 2 个人物才能生成关系网络')

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
    db.delete(characterRelations).where(eq(characterRelations.novelId, novelId)).run()
    for (const relation of relations) {
      const charA = charList.find((character) => character.fullName === relation.char_a)
      const charB = charList.find((character) => character.fullName === relation.char_b)
      if (charA && charB) {
        upsertRelation({
          novelId,
          charAId: charA.id,
          charBId: charB.id,
          relationType: asText(relation.type),
          relationLabel: asText(relation.label),
          description: asText(relation.description),
          bilateral: relation.bilateral ? 1 : 0,
        }, { skipContextTracking: true })
      }
    }
    markNovelContextChanged(novelId, 'Character relations changed')
  } catch (error) {
    console.error('关系解析失败:', error)
  }
}

