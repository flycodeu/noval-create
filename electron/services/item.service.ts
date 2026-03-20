import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { characters, novels, storyArcs, storyItems, timelineEvents, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { runChatTask } from './task.service'
import { removeStoryItemFromEvents, syncStoryItemTimelineLinks } from './link-sync.service'
import {
  buildItemTemplateSummary,
  getItemGenerationProfile,
  resolveGenreFamily,
} from '../../src/shared/creation-tools'
import { getFactionNameOptions, parseWorldRulesJson } from '../../src/shared/genre-system'
import { buildHumanLanguageRules } from '../../src/shared/prompt-library'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'

type StoryItemStatus = 'available' | 'consumed' | 'hidden' | 'destroyed'

interface StoryItemGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
  templateOnly?: boolean
  refreshTemplates?: boolean
}

interface GeneratedStoryItem {
  template_name?: unknown
  item_name?: unknown
  category?: unknown
  sub_type?: unknown
  rarity?: unknown
  owner_name?: unknown
  location_name?: unknown
  event_title?: unknown
  summary?: unknown
  acquisition_method?: unknown
  usage_method?: unknown
  cost?: unknown
  risk?: unknown
  plot_function?: unknown
  appearance?: unknown
  faction_hint?: unknown
  linked_character_names?: unknown
  tags?: unknown
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanAiStringArray(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    )
  }

  const text = asText(value)
  if (!text) return []
  return cleanAiStringArray(text.split(/[\n,，、]/))
}

function stringifyNumberArray(value: number[]): string {
  return JSON.stringify(value.filter((item) => Number.isFinite(item)))
}

function stringifyStringArray(value: string[]): string {
  return JSON.stringify(cleanAiStringArray(value))
}

function normalizeLookup(input: string): string {
  return input.trim().replace(/\s+/g, '').toLowerCase()
}

function resolveIdByName<T extends { id: number }>(
  rows: T[],
  getName: (row: T) => string,
  value: unknown,
): number | undefined {
  const target = normalizeLookup(asText(value))
  if (!target) return undefined

  const exact = rows.find((row) => normalizeLookup(getName(row)) === target)
  if (exact) return exact.id

  const fuzzy = rows.find((row) => {
    const current = normalizeLookup(getName(row))
    return current.includes(target) || target.includes(current)
  })
  return fuzzy?.id
}

function resolveCharacterIds(
  rows: Array<typeof characters.$inferSelect>,
  names: string[],
): number[] {
  return [...new Set(names
    .map((name) => resolveIdByName(rows, (row) => row.fullName, name))
    .filter((value): value is number => typeof value === 'number'))]
}

function normalizeStatus(value: unknown): StoryItemStatus {
  const text = asText(value)
  if (text === 'consumed' || text === 'hidden' || text === 'destroyed') return text
  return 'available'
}

function getNextSortOrder(novelId: number): number {
  const rows = listStoryItems(novelId)
  return rows.length > 0 ? Math.max(...rows.map((row) => row.sortOrder || 0)) + 1 : 1
}

function sanitizeStoryItemPayload(
  data: Partial<typeof storyItems.$inferInsert>,
): Partial<typeof storyItems.$inferInsert> {
  const next: Partial<typeof storyItems.$inferInsert> = {}

  if (typeof data.itemKind === 'string') next.itemKind = data.itemKind
  if (typeof data.parentItemId === 'number') next.parentItemId = Math.round(data.parentItemId)
  if (typeof data.itemName === 'string') next.itemName = cleanAiFieldText(data.itemName)
  if (typeof data.genreFamily === 'string') next.genreFamily = cleanAiFieldText(data.genreFamily)
  if (typeof data.category === 'string') next.category = cleanAiFieldText(data.category)
  if (typeof data.subType === 'string') next.subType = cleanAiFieldText(data.subType)
  if (typeof data.rarity === 'string') next.rarity = cleanAiFieldText(data.rarity)
  if ('ownerCharacterId' in data) next.ownerCharacterId = data.ownerCharacterId ?? null
  if ('locationMapId' in data) next.locationMapId = data.locationMapId ?? null
  if (typeof data.status === 'string') next.status = normalizeStatus(data.status)
  if (typeof data.summary === 'string') next.summary = cleanAiFieldText(data.summary)
  if (typeof data.acquisitionMethod === 'string') next.acquisitionMethod = cleanAiFieldText(data.acquisitionMethod)
  if (typeof data.usageMethod === 'string') next.usageMethod = cleanAiFieldText(data.usageMethod)
  if (typeof data.cost === 'string') next.cost = cleanAiFieldText(data.cost)
  if (typeof data.risk === 'string') next.risk = cleanAiFieldText(data.risk)
  if (typeof data.plotFunction === 'string') next.plotFunction = cleanAiFieldText(data.plotFunction)
  if (typeof data.appearance === 'string') next.appearance = cleanAiFieldText(data.appearance)
  if (typeof data.factionHint === 'string') next.factionHint = cleanAiFieldText(data.factionHint)
  if (typeof data.linkedCharacterIdsJson === 'string') next.linkedCharacterIdsJson = data.linkedCharacterIdsJson
  if (typeof data.linkedTimelineEventIdsJson === 'string') next.linkedTimelineEventIdsJson = data.linkedTimelineEventIdsJson
  if (typeof data.tagsJson === 'string') next.tagsJson = data.tagsJson
  if (typeof data.sortOrder === 'number') next.sortOrder = Math.round(data.sortOrder)

  return next
}

function buildCharacterSummary(rows: Array<typeof characters.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((row) => {
      const pieces = [row.roleType, row.species, row.occupation, row.rankLevel].filter(Boolean)
      return `- ${row.fullName}${pieces.length > 0 ? `：${pieces.join(' / ')}` : ''}`
    })
    .join('\n')
}

function buildLocationSummary(rows: Array<typeof worldMap.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((row) => {
      const pieces = [row.nodeType, row.structureRole].filter(Boolean)
      return `- ${row.name}${pieces.length > 0 ? `：${pieces.join(' / ')}` : ''}`
    })
    .join('\n')
}

function buildArcSummary(rows: Array<typeof storyArcs.$inferSelect>): string {
  return rows
    .sort((left, right) => left.arcOrder - right.arcOrder)
    .slice(0, 8)
    .map((row) => `- ${row.arcName}：${row.arcGoal || row.arcSummary || '未补充'}`)
    .join('\n')
}

function buildEventSummary(rows: Array<typeof timelineEvents.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((row) => `- ${row.timeLabel}｜${row.eventTitle}`)
    .join('\n')
}

function buildExistingItemSummary(rows: Array<typeof storyItems.$inferSelect>): string {
  return rows
    .filter((row) => row.itemKind === 'instance')
    .slice(0, 12)
    .map((row) => {
      const parts = [row.category, row.locationMapId ? '已绑定地点' : '', row.ownerCharacterId ? '已绑定持有者' : '']
        .filter(Boolean)
        .join(' / ')
      return `- ${row.itemName}${parts ? `：${parts}` : ''}`
    })
    .join('\n')
}

function buildPrompt(input: {
  novelTitle: string
  genre: string
  background: string
  worldSummary: string
  storyCore: string
  templateSummary: string
  characterSummary: string
  locationSummary: string
  factionSummary: string
  arcSummary: string
  eventSummary: string
  existingItemSummary: string
  focus?: string
  count: number
}) {
  return [
    `你要为小说《${input.novelTitle}》生成一组可直接用于写作的剧情物品。`,
    '要求这些物品必须贴合题材、背景、势力结构、角色关系和时间轴，不能脱离上下文单独发明。',
    '',
    '【小说上下文】',
    `题材：${input.genre}`,
    `背景：${input.background || '未补充'}`,
    `世界规则：${input.worldSummary || '未补充'}`,
    `故事核心：${input.storyCore || '未补充'}`,
    input.focus ? `本次额外聚焦：${input.focus}` : '',
    '',
    '【物品模板】',
    input.templateSummary,
    '',
    '【人物】',
    input.characterSummary || '暂无人物',
    '',
    '【地点】',
    input.locationSummary || '暂无地点',
    '',
    '【势力】',
    input.factionSummary || '暂无势力',
    '',
    '【故事弧】',
    input.arcSummary || '暂无故事弧',
    '',
    '【时间轴】',
    input.eventSummary || '暂无时间轴事件',
    '',
    '【已有物品实例】',
    input.existingItemSummary || '暂无已有实例',
    '',
    '【生成要求】',
    `1. 生成 ${input.count} 个具体物品实例，不要只给分类。`,
    '2. 每个物品都要说清楚它属于哪类模板、为什么会出现在这个故事里、谁会持有或争夺它。',
    '3. 能关联人物就关联人物，能关联地点或事件就尽量关联，避免“通用道具”。',
    '4. 名称要像小说编辑写工作稿，不要故作玄虚，不要给普通词乱加引号。',
    '5. summary、plot_function、cost、risk 都要写具体，不要出现“承载命运”“真正成长”这种空话。',
    '',
    '【语言要求】',
    buildHumanLanguageRules([
      '物品说明只写和剧情、人物、地点、事件直接相关的信息，不要扩展到无关领域。',
      '不要把没有直接关系的概念硬拼在一句话里，例如卡路里、感染概率、金融指标之类。',
      'summary、plot_function、cost、risk 优先写成自然中文短句，不要写成广告口号或假深刻文案。',
    ]),
    '',
    '【输出格式】',
    '只输出 JSON 数组，不要解释，不要 Markdown：',
    '[{"template_name":"对应模板名称","item_name":"物品名","category":"类别","sub_type":"更细分类型","rarity":"常见/稀有/核心/禁用级","owner_name":"持有者姓名，没有就留空","location_name":"常见出现地点，没有就留空","event_title":"最相关的时间轴事件，没有就留空","summary":"40字内说明它是什么","acquisition_method":"如何获得","usage_method":"怎么用","cost":"使用或持有代价","risk":"风险","plot_function":"对剧情的作用","appearance":"可识别外观细节","faction_hint":"最相关的势力或组织","linked_character_names":["相关人物A"],"tags":["标签1","标签2"]}]',
  ].filter(Boolean).join('\n')
}

function buildGeneratedPayload(
  raw: GeneratedStoryItem,
  context: {
    genreFamily: string
    templateRows: Array<typeof storyItems.$inferSelect>
    characterRows: Array<typeof characters.$inferSelect>
    mapRows: Array<typeof worldMap.$inferSelect>
    eventRows: Array<typeof timelineEvents.$inferSelect>
    sortOrder: number
  },
): Partial<typeof storyItems.$inferInsert> | null {
  const item = cleanAiValue(raw)
  const itemName = asText(item.item_name)
  if (!itemName) return null

  const templateId = resolveIdByName(context.templateRows, (row) => row.itemName, item.template_name)
  const ownerCharacterId = resolveIdByName(context.characterRows, (row) => row.fullName, item.owner_name) ?? null
  const locationMapId = resolveIdByName(context.mapRows, (row) => row.name, item.location_name) ?? null
  const eventId = resolveIdByName(context.eventRows, (row) => row.eventTitle, item.event_title)
  const linkedCharacterIds = resolveCharacterIds(
    context.characterRows,
    toStringArray(item.linked_character_names).concat(ownerCharacterId ? [] : toStringArray(item.owner_name)),
  )

  return {
    itemKind: 'instance',
    parentItemId: templateId ?? null,
    itemName,
    genreFamily: context.genreFamily,
    category: asText(item.category),
    subType: asText(item.sub_type),
    rarity: asText(item.rarity),
    ownerCharacterId,
    locationMapId,
    status: normalizeStatus('available'),
    summary: asText(item.summary),
    acquisitionMethod: asText(item.acquisition_method),
    usageMethod: asText(item.usage_method),
    cost: asText(item.cost),
    risk: asText(item.risk),
    plotFunction: asText(item.plot_function),
    appearance: asText(item.appearance),
    factionHint: asText(item.faction_hint),
    linkedCharacterIdsJson: stringifyNumberArray(linkedCharacterIds),
    linkedTimelineEventIdsJson: stringifyNumberArray(typeof eventId === 'number' ? [eventId] : []),
    tagsJson: stringifyStringArray(toStringArray(item.tags)),
    sortOrder: context.sortOrder,
  }
}

function ensureTemplateRows(
  novelId: number,
  options: {
    genreName?: string | null
    refreshTemplates?: boolean
  } = {},
): Array<typeof storyItems.$inferSelect> {
  const db = getDb()
  const profile = getItemGenerationProfile(options.genreName)
  const existing = db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
    .filter((row) => row.itemKind === 'template')

  const existingByName = new Map(existing.map((row) => [row.itemName, row]))

  for (const [index, template] of profile.templates.entries()) {
    const current = existingByName.get(template.name)
    if (current && !options.refreshTemplates) continue

    if (current && options.refreshTemplates) {
      updateStoryItem(current.id, {
        genreFamily: profile.genreFamily,
        category: template.category,
        subType: template.key,
        status: 'available',
        summary: template.summary,
        acquisitionMethod: template.circulation,
        usageMethod: template.holders,
        cost: '',
        risk: '',
        plotFunction: template.storyValue,
        appearance: template.examples.join('、'),
        tagsJson: stringifyStringArray(template.examples),
      })
      continue
    }

    createStoryItem(novelId, {
      itemKind: 'template',
      itemName: template.name,
      genreFamily: profile.genreFamily,
      category: template.category,
      subType: template.key,
      status: 'available',
      summary: template.summary,
      acquisitionMethod: template.circulation,
      usageMethod: template.holders,
      cost: '',
      risk: '',
      plotFunction: template.storyValue,
      appearance: template.examples.join('、'),
      tagsJson: stringifyStringArray(template.examples),
      sortOrder: index + 1,
    })
  }

  return db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
    .filter((row) => row.itemKind === 'template')
}

export function listStoryItems(novelId: number) {
  const db = getDb()
  return db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.itemKind), asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
}

export function getStoryItem(id: number) {
  const db = getDb()
  return db.select().from(storyItems).where(eq(storyItems.id, id)).all()[0] || null
}

export function createStoryItem(novelId: number, data: Partial<typeof storyItems.$inferInsert>) {
  const db = getDb()
  const sortOrder = typeof data.sortOrder === 'number' ? data.sortOrder : getNextSortOrder(novelId)
  const payload = sanitizeStoryItemPayload(data)
  const result = db.insert(storyItems).values({
    novelId,
    itemKind: 'instance',
    itemName: data.itemName || '未命名物品',
    status: 'available',
    linkedCharacterIdsJson: '[]',
    linkedTimelineEventIdsJson: '[]',
    tagsJson: '[]',
    sortOrder,
    ...payload,
  }).run()
  const id = Number(result.lastInsertRowid)
  syncStoryItemTimelineLinks(id)
  return id
}

export function updateStoryItem(id: number, data: Partial<typeof storyItems.$inferInsert>) {
  const db = getDb()
  db.update(storyItems).set({
    ...sanitizeStoryItemPayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(storyItems.id, id)).run()
  syncStoryItemTimelineLinks(id)
}

export function deleteStoryItem(id: number) {
  const db = getDb()
  removeStoryItemFromEvents(id)
  db.delete(storyItems).where(eq(storyItems.id, id)).run()
}

export function clearStoryItemsByNovel(novelId: number) {
  const db = getDb()
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()

  eventRows.forEach((event) => {
    db.update(timelineEvents).set({
      linkedItemIdsJson: JSON.stringify([]),
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })

  db.delete(storyItems).where(eq(storyItems.novelId, novelId)).run()
}

export async function generateStoryItems(
  novelId: number,
  options: StoryItemGenerateOptions = {},
): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const itemProfile = getItemGenerationProfile(profile.genre)
  const templateRows = ensureTemplateRows(novelId, {
    genreName: profile.genre,
    refreshTemplates: options.refreshTemplates,
  })

  if (options.templateOnly) {
    return templateRows.map((row) => row.id)
  }

  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const totalCount = Math.min(Math.max(options.count || itemProfile.defaultBatch, 4), 24)
  const batchSize = Math.max(1, Math.min(totalCount, options.batchSize || Math.min(totalCount, 4)))

  const createdIds: number[] = []
  let nextSort = getNextSortOrder(novelId)

  for (let generatedCount = 0; generatedCount < totalCount; generatedCount += batchSize) {
    const currentBatchCount = Math.min(batchSize, totalCount - generatedCount)
    const currentItems = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()

    const prompt = buildPrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      background: profile.background,
      worldSummary: profile.worldRulesSummary,
      storyCore: [
        `Story goal: ${profile.storyGoal || 'not provided'}`,
        `Core conflict: ${profile.coreConflict || 'not provided'}`,
        `Main plot: ${profile.mainPlot || 'not provided'}`,
        `Ending direction: ${profile.ending || 'not provided'}`,
      ].join('\n'),
      templateSummary: buildItemTemplateSummary(itemProfile),
      characterSummary: buildCharacterSummary(characterRows),
      locationSummary: buildLocationSummary(mapRows),
      factionSummary: getFactionNameOptions(rules).join(', '),
      arcSummary: buildArcSummary(arcRows),
      eventSummary: buildEventSummary(eventRows),
      existingItemSummary: buildExistingItemSummary(currentItems),
      focus: [options.focus, `第${Math.floor(generatedCount / batchSize) + 1}批：只补 ${currentBatchCount} 个新的物品实例，避免重复已有物品。`].filter(Boolean).join('\n'),
      count: currentBatchCount,
    })

    const result = await runChatTask({
      type: 'generate_items',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const parsed = cleanAiValue(safeParseJson<GeneratedStoryItem[]>(result))
    if (!Array.isArray(parsed)) {
      throw new Error('Item generation result is not a valid array')
    }

    for (const rawItem of parsed) {
      const payload = buildGeneratedPayload(rawItem, {
        genreFamily: resolveGenreFamily(profile.genre),
        templateRows,
        characterRows,
        mapRows,
        eventRows,
        sortOrder: nextSort,
      })
      if (!payload) continue
      const id = createStoryItem(novelId, payload)
      createdIds.push(id)
      nextSort += 1
    }
  }

  return createdIds
}
