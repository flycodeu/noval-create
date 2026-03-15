import { getDb } from '../database/db'
import { characters, characterRelations, novels, templates } from '../database/schema'
import { eq, asc } from 'drizzle-orm'
import { runChatTask } from './task.service'
import { protagonistPrompt, batchCharacterPrompt, characterRelationsPrompt } from './prompts'
import { WebContents } from 'electron'
import { safeParseJson } from '../utils/json'

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
  background: string
  personalityTraitsJson: string
  flawsJson: string
  habitsJson: string
  goals: string
  firstImpression: string
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

  let worldSummary = ''
  if (novel.worldTemplateId) {
    const tmpl = db.select().from(templates).where(eq(templates.id, novel.worldTemplateId)).all()[0]
    if (tmpl?.contentJson) {
      const content = JSON.parse(tmpl.contentJson)
      worldSummary = content.power_system?.name || tmpl.name || ''
    }
  }

  const prompt = protagonistPrompt({
    novelTitle: novel.title,
    novelSynopsis: novel.synopsis || novel.expandedBackground || '',
    genre: '未知题材',
    worldSummary,
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
  const charId = createCharacter(novelId, {
    roleType: 'protagonist',
    surname: parsed.surname,
    givenName: parsed.given_name,
    fullName: parsed.full_name,
    gender: parsed.gender,
    age: parsed.age,
    occupation: parsed.occupation,
    background: parsed.background,
    personalityTraitsJson: JSON.stringify(parsed.personality_traits || []),
    flawsJson: JSON.stringify(parsed.flaws || []),
    habitsJson: JSON.stringify(parsed.habits || []),
    goals: parsed.goals,
    firstImpression: parsed.first_impression,
    appearanceJson: JSON.stringify({ description: parsed.appearance }),
  })

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

  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const existingNames = existingChars.map(c => c.fullName).join('、')
  const protagonist = existingChars.find(c => c.roleType === 'protagonist')
  const protagonistSummary = protagonist
    ? `${protagonist.fullName}（主角，${protagonist.gender}）：${protagonist.background?.slice(0, 100)}`
    : '主角未设定'

  const totalCount = opts.majorCount + opts.minorCount
  const batches = Math.ceil(totalCount / opts.batchSize)
  const newIds: number[] = []

  for (let i = 0; i < batches; i++) {
    const batchCount = Math.min(opts.batchSize, totalCount - i * opts.batchSize)
    const prompt = batchCharacterPrompt({
      novelTitle: novel.title,
      novelSynopsis: novel.synopsis || novel.expandedBackground || '',
      protagonistSummary,
      existingNames,
      genre: '未知题材',
      worldSummary: '',
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
      const parsed = safeParseJson<Record<string, unknown>>(result)
      for (const char of parsed) {
        const id = createCharacter(novelId, {
          roleType: char.role_type || 'minor',
          fullName: char.full_name || char.name,
          gender: char.gender,
          age: char.age,
          occupation: char.occupation || '',
          background: char.background || '',
          personalityTraitsJson: JSON.stringify(char.personality_keywords || []),
          firstImpression: char.appearance || '',
        })
        newIds.push(id)
      }
    } catch (e) {
      console.error('批量生成人物解析失败:', e)
    }

    if (sender && !sender.isDestroyed()) {
      sender.send('character:batch-progress', { batch: i + 1, total: batches, newIds })
    }
  }

  return newIds
}

export async function generateCharacterRelations(novelId: number): Promise<void> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const charList = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  if (charList.length < 2) throw new Error('至少需要2个人物才能生成关系网络')

  const characterListText = charList.map(c =>
    `- ${c.fullName}（${c.roleType}，${c.gender}）：${c.background?.slice(0, 100) || '无背景'}`
  ).join('\n')

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
    const relations = safeParseJson<Record<string, unknown>[]>(result)
    for (const rel of relations) {
      const charA = charList.find(c => c.fullName === rel.char_a)
      const charB = charList.find(c => c.fullName === rel.char_b)
      if (charA && charB) {
        upsertRelation({
          novelId,
          charAId: charA.id,
          charBId: charB.id,
          relationType: rel.type,
          relationLabel: rel.label,
          description: rel.description,
          bilateral: rel.bilateral ? 1 : 0,
        })
      }
    }
  } catch (e) {
    console.error('关系解析失败:', e)
  }
}
