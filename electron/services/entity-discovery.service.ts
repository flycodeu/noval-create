import { and, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { characters, novels, revisionTasks, storyItems } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { runChatTask } from './task.service'
import { createCharacter } from './character.service'
import { createStoryItem } from './item.service'
import { markNovelContextChanged } from './context-impact.service'
import { buildHumanLanguageRules } from '../../src/shared/prompt-library'
import { cleanAiFieldText, cleanAiValue } from '../../src/utils/text'

type DiscoverySourcePage = 'outline' | 'writing'

interface DiscoverySource {
  novelId: number
  sourcePage: DiscoverySourcePage
  sourceLabel: string
  sourceEntityId?: number
  content: string
}

interface DiscoveryCharacterCandidate {
  name?: unknown
  summary?: unknown
  relation_hint?: unknown
  role_hint?: unknown
}

interface DiscoveryItemCandidate {
  name?: unknown
  summary?: unknown
  function_hint?: unknown
  owner_name?: unknown
  related_character_names?: unknown
}

interface DiscoveryPayload {
  characters?: DiscoveryCharacterCandidate[]
  items?: DiscoveryItemCandidate[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => cleanAiFieldText(item))
      .filter(Boolean)
  }

  const text = asText(value)
  if (!text) return []
  return text
    .split(/[\n,，、]/)
    .map((item) => cleanAiFieldText(item))
    .filter(Boolean)
}

function normalizeLookup(input: string): string {
  return input.trim().replace(/\s+/g, '').toLowerCase()
}

function parseSourceContexts(raw?: string | null): Array<Record<string, unknown>> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : []
  } catch {
    return []
  }
}

function buildSourceContextJson(existingRaw: string | null | undefined, source: DiscoverySource) {
  const nextEntry = {
    page: source.sourcePage,
    label: source.sourceLabel,
    entityId: source.sourceEntityId,
    detectedAt: new Date().toISOString(),
  }
  const merged = [
    nextEntry,
    ...parseSourceContexts(existingRaw),
  ].filter((item, index, list) => (
    list.findIndex((candidate) => (
      candidate.page === item.page
      && candidate.label === item.label
      && candidate.entityId === item.entityId
    )) === index
  ))
  return JSON.stringify(merged.slice(0, 8))
}

function buildDiscoveryPrompt(input: {
  title: string
  genre: string
  background: string
  worldSummary: string
  sourcePage: DiscoverySourcePage
  sourceLabel: string
  existingCharacterNames: string[]
  existingItemNames: string[]
  content: string
}) {
  const truncatedContent = input.content.trim().slice(0, 2600)
  return [
    `你在为小说《${input.title}》做实体发现补全。`,
    `来源页面：${input.sourcePage === 'outline' ? '故事大纲' : '正文写作'}，来源标识：${input.sourceLabel}`,
    `题材：${input.genre}`,
    input.background ? `背景：${input.background}` : '',
    input.worldSummary ? `世界规则：${input.worldSummary}` : '',
    `已有角色：${input.existingCharacterNames.join('、') || '无'}`,
    `已有物品：${input.existingItemNames.join('、') || '无'}`,
    '任务：识别这段内容里“值得入库但当前库里还没有”的新角色和新物品。',
    '只抽取对后续写作有持续价值的实体，不要抽普通名词、泛称、场景装饰物、一次性群体称呼。',
    '如果文本里只是提到一个已有角色或已有物品，不要重复输出。',
    '如果不确定是不是新实体，就不要输出。',
    '角色最多输出 3 个，物品最多输出 3 个。',
    '角色 summary 要写清这个人当前为什么值得建档；relation_hint 写它和现有主线或人物的关系拉扯。',
    '物品 summary 要写清它是什么；function_hint 写它的剧情作用或冲突价值。',
    '只输出自然中文，不要写提示词味，不要写百科定义。',
    '语言规则：',
    buildHumanLanguageRules([
      '如果内容里没有足够信息，就写短而准的概括，不要脑补长篇背景。',
      '不要造词，不要把普通概念包装成夸张名词。',
    ]),
    '待分析内容：',
    truncatedContent || '（空）',
    '只输出 JSON：{"characters":[{"name":"新角色名","summary":"一句话摘要","relation_hint":"与主线或现有人物的关系拉扯","role_hint":"大致角色位"}],"items":[{"name":"新物品名","summary":"一句话摘要","function_hint":"剧情作用","owner_name":"可能绑定的人物名，可留空","related_character_names":["相关人物名"]}]}',
  ].filter(Boolean).join('\n\n')
}

function findCharacterByName(
  rows: Array<typeof characters.$inferSelect>,
  name: string,
) {
  const normalized = normalizeLookup(name)
  if (!normalized) return null
  return rows.find((row) => normalizeLookup(row.fullName) === normalized) || null
}

function findItemByName(
  rows: Array<typeof storyItems.$inferSelect>,
  name: string,
) {
  const normalized = normalizeLookup(name)
  if (!normalized) return null
  return rows.find((row) => normalizeLookup(row.itemName) === normalized) || null
}

async function upsertDiscoveryRevisionTask(input: {
  novelId: number
  entityType: 'character' | 'item'
  entityId: number
  title: string
  description: string
  sourcePage: DiscoverySourcePage
  chapterId?: number
}) {
  const db = getDb()
  const existing = db.select().from(revisionTasks).where(and(
    eq(revisionTasks.novelId, input.novelId),
    eq(revisionTasks.entityType, input.entityType),
    eq(revisionTasks.entityId, input.entityId),
  )).all()[0]

  if (existing) {
    db.update(revisionTasks).set({
      taskSource: 'system',
      taskType: input.entityType,
      status: existing.status === 'resolved' ? 'open' : existing.status,
      severity: 'medium',
      title: input.title,
      description: input.description,
      fixBrief: input.entityType === 'character'
        ? '补充身份、关系与关联物品后再转为正式角色。'
        : '补充用途、归属与关联人物后再转为正式物品。',
      relatedPage: input.entityType === 'character' ? 'characters' : 'items',
      chapterId: input.chapterId ?? existing.chapterId ?? null,
      updatedAt: new Date().toISOString(),
    }).where(eq(revisionTasks.id, existing.id)).run()
    return
  }

  db.insert(revisionTasks).values({
    novelId: input.novelId,
    taskSource: 'system',
    taskType: input.entityType,
    status: 'open',
    severity: 'medium',
    title: input.title,
    description: input.description,
    fixBrief: input.entityType === 'character'
      ? '补充身份、关系与关联物品后再转为正式角色。'
      : '补充用途、归属与关联人物后再转为正式物品。',
    relatedPage: input.entityType === 'character' ? 'characters' : 'items',
    entityType: input.entityType,
    entityId: input.entityId,
    chapterId: input.chapterId ?? null,
  }).run()
}

export async function discoverEntitiesFromContent(source: DiscoverySource) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, source.novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const content = source.content.trim()
  if (!content || content.length < 24) {
    return { createdCharacters: 0, createdItems: 0 }
  }

  const profile = await buildStoryProfile(source.novelId)
  const characterRows = db.select().from(characters).where(eq(characters.novelId, source.novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, source.novelId)).all()

  const result = await runChatTask({
    type: 'entity_discovery',
    novelId: source.novelId,
    relatedEntityType: source.sourcePage,
    relatedEntityId: source.sourceEntityId,
    messages: [{
      role: 'user',
      content: buildDiscoveryPrompt({
        title: novel.title,
        genre: profile.genre,
        background: profile.background,
        worldSummary: profile.worldRulesSummary,
        sourcePage: source.sourcePage,
        sourceLabel: source.sourceLabel,
        existingCharacterNames: characterRows.map((row) => row.fullName).filter(Boolean),
        existingItemNames: itemRows.map((row) => row.itemName).filter(Boolean),
        content,
      }),
    }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = cleanAiValue(safeParseJson<DiscoveryPayload>(result))
  let createdCharacters = 0
  let createdItems = 0
  const draftCharacters = [...characterRows]

  for (const candidate of parsed.characters || []) {
    const name = asText(candidate.name)
    if (!name || findCharacterByName(draftCharacters, name)) continue

    const characterId = createCharacter(source.novelId, {
      roleType: 'minor',
      fullName: name,
      background: asText(candidate.summary),
      relationshipTension: asText(candidate.relation_hint),
      socialIdentity: asText(candidate.role_hint),
      recordStatus: 'draft',
      sourceContextJson: buildSourceContextJson('', source),
    }, { skipContextTracking: true })
    const nextCharacter = db.select().from(characters).where(eq(characters.id, characterId)).all()[0]
    if (nextCharacter) {
      draftCharacters.push(nextCharacter)
    }
    createdCharacters += 1
    await upsertDiscoveryRevisionTask({
      novelId: source.novelId,
      entityType: 'character',
      entityId: characterId,
      title: `待确认角色：${name}`,
      description: `来源：${source.sourceLabel}\n${asText(candidate.summary) || '需要补充这个新角色的身份、关系和作用。'}`,
      sourcePage: source.sourcePage,
      chapterId: source.sourcePage === 'writing' ? source.sourceEntityId : undefined,
    })
  }

  for (const candidate of parsed.items || []) {
    const name = asText(candidate.name)
    if (!name || findItemByName(itemRows, name)) continue

    const relatedNames = asStringArray(candidate.related_character_names)
    const owner = findCharacterByName(draftCharacters, asText(candidate.owner_name))
    const relatedCharacterIds = relatedNames
      .map((item) => findCharacterByName(draftCharacters, item))
      .filter((item): item is typeof characters.$inferSelect => Boolean(item))
      .map((item) => item.id)

    const itemId = createStoryItem(source.novelId, {
      itemKind: 'instance',
      itemName: name,
      summary: asText(candidate.summary),
      plotFunction: asText(candidate.function_hint),
      ownerCharacterId: owner?.id ?? null,
      linkedCharacterIdsJson: JSON.stringify(relatedCharacterIds),
      recordStatus: 'draft',
      sourceContextJson: buildSourceContextJson('', source),
    }, { skipContextTracking: true })
    createdItems += 1
    await upsertDiscoveryRevisionTask({
      novelId: source.novelId,
      entityType: 'item',
      entityId: itemId,
      title: `待确认物品：${name}`,
      description: `来源：${source.sourceLabel}\n${asText(candidate.summary) || '需要补充这个新物品的用途、归属和剧情作用。'}`,
      sourcePage: source.sourcePage,
      chapterId: source.sourcePage === 'writing' ? source.sourceEntityId : undefined,
    })
  }

  if (createdCharacters > 0 || createdItems > 0) {
    markNovelContextChanged(source.novelId, 'Draft entities discovered from new content')
  }

  return { createdCharacters, createdItems }
}
