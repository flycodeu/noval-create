import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
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
  if (/丧尸|感染者|尸/u.test(species)) return 'undead'
  if (/兽|猫|狗|灵兽|魔兽/u.test(species)) return 'beast'
  if (/精灵|异族/u.test(species)) return 'nonhuman'
  if (/仙|神/u.test(species)) return 'immortal'
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
    `故事核心目标：${profile.storyGoal || '（未填写）'}`,
    `核心冲突：${profile.coreConflict || '（未填写）'}`,
    `主线剧情：${profile.mainPlot || '（未填写）'}`,
    `支线剧情：${profile.subPlots || '（暂无支线）'}`,
    `结局方向：${profile.ending || '（未填写）'}`,
  ].join('\n')
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
  const fullName = asText(sanitized.full_name) || asText(sanitized.name) || fallback.fullName || fallback.existing?.fullName || '未命名'
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

export function createCharacter(novelId: number, data: Partial<typeof characters.$inferInsert>) {
  const db = getDb()
  const result = db.insert(characters).values({ novelId, fullName: data.fullName || '未命名', ...data }).run()
  return Number(result.lastInsertRowid)
}

export function updateCharacter(id: number, data: Partial<typeof characters.$inferInsert>) {
  const db = getDb()
  db.update(characters).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(characters.id, id)).run()
}

export function deleteCharacter(id: number) {
  const db = getDb()
  db.delete(characters).where(eq(characters.id, id)).run()
}

export function clearCharactersByNovel(novelId: number) {
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
}) {
  const db = getDb()
  db.insert(characterRelations).values(data).run()
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
    type: 'character_gen',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(result))
  const charId = createCharacter(novelId, buildCharacterPayload(parsed, { roleType: 'protagonist' }))
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
        const id = createCharacter(novelId, payload)
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
      const parts = [relation.relationLabel || relation.relationType, relation.description].filter(Boolean).join('，')
      return `- 与${other.fullName}：${parts || '已有关系'}`
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

  updateCharacter(current.id, payload)
  return getCharacter(current.id)
}

export async function generateCharacterRelations(novelId: number): Promise<void> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const charList = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  if (charList.length < 2) throw new Error('至少需要2个人物才能生成关系网络')

  const characterListText = charList.map((character) => buildCharacterSummary(character)).join('\n')
  const prompt = characterRelationsPrompt({
    novelSynopsis: novel.synopsis || novel.expandedBackground || '',
    characterList: characterListText,
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
          relationType: asText(relation.type),
          relationLabel: asText(relation.label),
          description: asText(relation.description),
          bilateral: relation.bilateral ? 1 : 0,
        })
      }
    }
  } catch (error) {
    console.error('关系解析失败:', error)
  }
}
