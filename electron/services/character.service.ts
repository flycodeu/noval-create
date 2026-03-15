import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { characters, characterRelations, novels } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import {
  batchCharacterPrompt,
  characterRelationsPrompt,
  protagonistPrompt,
  regenerateCharacterPrompt,
} from './prompts'
import { runChatTask } from './task.service'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const text = asText(value)
  if (!text) return []
  return [text]
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

function roleOrder(roleType?: string | null): number {
  const priority = ['protagonist', 'major', 'antagonist', 'supporting', 'minor']
  const index = priority.indexOf(roleType || 'minor')
  return index === -1 ? priority.length : index
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

function buildCharacterSummary(character: typeof characters.$inferSelect): string {
  const traits = parseJsonArray(character.personalityTraitsJson).slice(0, 3).join('、')
  const flaws = parseJsonArray(character.flawsJson).slice(0, 2).join('、')
  const parts = [
    character.occupation ? `身份：${character.occupation}` : '',
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
  return [
    `姓名：${character.fullName}`,
    `角色类型：${character.roleType || 'minor'}`,
    character.gender ? `性别：${character.gender}` : '',
    character.age ? `年龄：${character.age}` : '',
    character.occupation ? `职业/身份：${character.occupation}` : '',
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
  const appearance = asText(parsed.appearance) || parseAppearanceDescription(fallback.existing?.appearanceJson)
  const fullName = asText(parsed.full_name) || asText(parsed.name) || fallback.fullName || fallback.existing?.fullName || '未命名'
  const roleType = asText(parsed.role_type) || fallback.roleType || fallback.existing?.roleType || 'minor'
  const personalityTraits = toStringArray(parsed.personality_traits).length > 0
    ? toStringArray(parsed.personality_traits)
    : toStringArray(parsed.personality_keywords).length > 0
      ? toStringArray(parsed.personality_keywords)
      : toStringArray(parsed.personality).length > 0
        ? toStringArray(parsed.personality)
        : parseJsonArray(fallback.existing?.personalityTraitsJson)
  const flaws = toStringArray(parsed.flaws).length > 0
    ? toStringArray(parsed.flaws)
    : parseJsonArray(fallback.existing?.flawsJson)
  const habits = toStringArray(parsed.habits).length > 0
    ? toStringArray(parsed.habits)
    : parseJsonArray(fallback.existing?.habitsJson)

  return {
    roleType,
    surname: asText(parsed.surname) || fallback.existing?.surname || '',
    givenName: asText(parsed.given_name) || fallback.existing?.givenName || '',
    fullName,
    gender: asText(parsed.gender) || fallback.existing?.gender || '',
    age: asNumber(parsed.age) ?? fallback.existing?.age,
    birthplace: asText(parsed.birthplace) || fallback.existing?.birthplace || '',
    occupation: asText(parsed.occupation) || fallback.existing?.occupation || '',
    background: asText(parsed.background) || fallback.existing?.background || '',
    personalityTraitsJson: JSON.stringify(personalityTraits),
    flawsJson: JSON.stringify(flaws),
    habitsJson: JSON.stringify(habits),
    goals: asText(parsed.goals) || fallback.existing?.goals || '',
    firstImpression: asText(parsed.first_impression) || fallback.existing?.firstImpression || '',
    surfaceDesire: asText(parsed.surface_desire) || fallback.existing?.surfaceDesire || '',
    deepNeed: asText(parsed.deep_need) || fallback.existing?.deepNeed || '',
    coreFear: asText(parsed.core_fear) || fallback.existing?.coreFear || '',
    innerConflict: asText(parsed.inner_conflict) || fallback.existing?.innerConflict || '',
    hiddenSecret: asText(parsed.hidden_secret) || fallback.existing?.hiddenSecret || '',
    moralLine: asText(parsed.moral_line) || fallback.existing?.moralLine || '',
    selfDeception: asText(parsed.self_deception) || fallback.existing?.selfDeception || '',
    trauma: asText(parsed.trauma) || fallback.existing?.trauma || '',
    contradiction: asText(parsed.contradiction) || fallback.existing?.contradiction || '',
    relationshipTension: asText(parsed.relationship_tension) || fallback.existing?.relationshipTension || asText(parsed.relation_to_protagonist) || '',
    resonancePoint: asText(parsed.resonance_point) || fallback.existing?.resonancePoint || '',
    characterArc: asText(parsed.character_arc) || fallback.existing?.characterArc || '',
    appearanceJson: JSON.stringify({ description: appearance }),
    appearChapter: asNumber(parsed.appear_chapter) ?? fallback.existing?.appearChapter,
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

export function createCharacter(novelId: number, data: Partial<{
  roleType: string
  surname: string
  givenName: string
  fullName: string
  gender: string
  age: number
  occupation: string
  birthplace: string
  background: string
  personalityTraitsJson: string
  flawsJson: string
  habitsJson: string
  goals: string
  firstImpression: string
  surfaceDesire: string
  deepNeed: string
  coreFear: string
  innerConflict: string
  hiddenSecret: string
  moralLine: string
  selfDeception: string
  trauma: string
  contradiction: string
  relationshipTension: string
  resonancePoint: string
  characterArc: string
  appearanceJson: string
  abilitiesJson: string
  appearChapter: number
}>) {
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
  const prompt = protagonistPrompt({
    novelTitle: novel.title,
    novelSynopsis: profile.background,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
    storyCore: buildStoryCoreSummary(profile),
    gender: opts.gender || '不限',
    surnameHint: opts.surnameHint,
  })

  const result = await runChatTask({
    type: 'character_gen',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = safeParseJson<Record<string, unknown>>(result)
  const charId = createCharacter(novelId, buildCharacterPayload(parsed, { roleType: 'protagonist' }))
  return charId
}

export async function batchGenerateCharacters(novelId: number, opts: {
  majorCount: number
  minorCount: number
  genderRatio: string
  specialRequirements: string
  batchSize: number
}, sender?: WebContents): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const reservedNames = existingChars.map((character) => character.fullName).filter(Boolean)
  const protagonist = existingChars.find(c => c.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : '主角未设定'

  const totalCount = opts.majorCount + opts.minorCount
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
      count: batchCount,
      genderRatio: opts.genderRatio,
      specialRequirements: opts.specialRequirements,
    })

    const result = await runChatTask({
      type: 'character_gen',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    try {
      const parsed = safeParseJson<Array<Record<string, unknown>>>(result)
      for (const char of parsed) {
        const payload = buildCharacterPayload(char, {
          roleType: asText(char.role_type) || 'minor',
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

  const parsed = safeParseJson<Record<string, unknown>>(result)
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
