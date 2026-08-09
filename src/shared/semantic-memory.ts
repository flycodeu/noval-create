export type SemanticMemorySourceType =
  | 'character'
  | 'map'
  | 'item'
  | 'story_thread'
  | 'timeline_event'
  | 'character_state'
  | 'world_state'
  | 'stage_handoff'

export type SemanticMemoryVisibility = 'canon' | 'draft' | 'private'

export interface SemanticMemoryDocument {
  sourceType: SemanticMemorySourceType
  sourceId: number
  fragmentKey: string
  content: string
  entityRefs: string[]
  visibility: SemanticMemoryVisibility
  stageId?: number
  sourceChapterStart?: number
  sourceChapterEnd?: number
  validFromChapter?: number
  validToChapter?: number
}

export interface CharacterSemanticSource {
  id: number
  fullName: string
  roleType?: string | null
  species?: string | null
  occupation?: string | null
  rankLevel?: string | null
  socialIdentity?: string | null
  background?: string | null
  personalityTraitsJson?: string | null
  flawsJson?: string | null
  habitsJson?: string | null
  goals?: string | null
  surfaceDesire?: string | null
  deepNeed?: string | null
  coreFear?: string | null
  innerConflict?: string | null
  hiddenSecret?: string | null
  moralLine?: string | null
  selfDeception?: string | null
  trauma?: string | null
  contradiction?: string | null
  relationshipTension?: string | null
  dramaticEngine?: string | null
  characterArc?: string | null
  speechPattern?: string | null
  catchphrases?: string | null
  vocabularyLevel?: string | null
  dialectFeatures?: string | null
  appearChapter?: number | null
  recordStatus?: string | null
}

export interface MapSemanticSource {
  id: number
  name: string
  level?: number | null
  locationType?: string | null
  nodeType?: string | null
  structureRole?: string | null
  description?: string | null
  atmosphere?: string | null
  plotRelevance?: string | null
  dangerLevel?: string | null
}

export interface ItemSemanticSource {
  id: number
  itemName: string
  itemKind?: string | null
  category?: string | null
  subType?: string | null
  rarity?: string | null
  ownerCharacterId?: number | null
  locationMapId?: number | null
  status?: string | null
  summary?: string | null
  acquisitionMethod?: string | null
  usageMethod?: string | null
  cost?: string | null
  risk?: string | null
  plotFunction?: string | null
  abilitySpec?: string | null
  limitations?: string | null
  factionHint?: string | null
  recordStatus?: string | null
}

export interface StoryThreadSemanticSource {
  id: number
  threadType?: string | null
  title: string
  summary?: string | null
  premise?: string | null
  status?: string | null
  priority?: string | null
  startChapter?: number | null
  targetPayoffChapter?: number | null
  payoffCondition?: string | null
  currentState?: string | null
  plantedChapter?: number | null
  lastReferencedChapter?: number | null
  resolvedChapter?: number | null
  notes?: string | null
}

export interface TimelineEventSemanticSource {
  id: number
  eventTitle: string
  eventSummary?: string | null
  timeLabel?: string | null
  eventType?: string | null
  protagonistAction?: string | null
  eventCause?: string | null
  eventProcess?: string | null
  eventResult?: string | null
  notes?: string | null
  status?: string | null
}

function compactText(value: unknown, maxLength = 180): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

function parseStringArray(raw: unknown, limit = 6): string[] {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => compactText(entry, 48))
      .filter(Boolean)
      .slice(0, limit)
  } catch {
    return []
  }
}

function joinFacts(values: Array<string | null | undefined>, separator = '；'): string {
  return values.map((value) => compactText(value)).filter(Boolean).join(separator)
}

function createDocument(
  sourceType: SemanticMemorySourceType,
  sourceId: number,
  fragmentKey: string,
  content: string,
  entityRefs: string[],
  options: {
    visibility?: SemanticMemoryVisibility
    sourceChapterStart?: number
    sourceChapterEnd?: number
    validFromChapter?: number
    validToChapter?: number
  } = {},
): SemanticMemoryDocument | null {
  const normalized = compactText(content, 1200)
  if (!normalized) return null
  return {
    sourceType,
    sourceId,
    fragmentKey,
    content: normalized,
    entityRefs: [...new Set(entityRefs.map((entry) => compactText(entry, 48)).filter(Boolean))],
    visibility: options.visibility || 'canon',
    sourceChapterStart: options.sourceChapterStart,
    sourceChapterEnd: options.sourceChapterEnd,
    validFromChapter: options.validFromChapter,
    validToChapter: options.validToChapter,
  }
}

export function buildCharacterSemanticDocuments(source: CharacterSemanticSource): SemanticMemoryDocument[] {
  const name = compactText(source.fullName, 48) || `角色#${source.id}`
  const visibility: SemanticMemoryVisibility = source.recordStatus === 'confirmed' ? 'canon' : 'draft'
  const common = {
    visibility,
    validFromChapter: source.appearChapter || undefined,
  }
  const identity = createDocument('character', source.id, 'identity', joinFacts([
    `人物：${name}`,
    source.roleType ? `定位=${source.roleType}` : '',
    source.species ? `种族=${source.species}` : '',
    source.socialIdentity ? `身份=${source.socialIdentity}` : '',
    source.occupation ? `职业=${source.occupation}` : '',
    source.rankLevel ? `层级=${source.rankLevel}` : '',
    source.background ? `背景=${source.background}` : '',
    parseStringArray(source.personalityTraitsJson).length > 0
      ? `性格=${parseStringArray(source.personalityTraitsJson).join('、')}`
      : '',
    parseStringArray(source.flawsJson).length > 0
      ? `缺陷=${parseStringArray(source.flawsJson).join('、')}`
      : '',
  ]), [name], common)
  const motivation = createDocument('character', source.id, 'motivation', joinFacts([
    `人物：${name}`,
    source.goals ? `当前目标=${source.goals}` : '',
    source.surfaceDesire ? `表层欲望=${source.surfaceDesire}` : '',
    source.deepNeed ? `深层需要=${source.deepNeed}` : '',
    source.coreFear ? `核心恐惧=${source.coreFear}` : '',
    source.innerConflict ? `内在冲突=${source.innerConflict}` : '',
    source.selfDeception ? `自我欺骗=${source.selfDeception}` : '',
    source.contradiction ? `矛盾点=${source.contradiction}` : '',
    source.moralLine ? `底线=${source.moralLine}` : '',
    source.hiddenSecret ? `秘密=${source.hiddenSecret}` : '',
    source.trauma ? `创伤=${source.trauma}` : '',
    source.dramaticEngine ? `戏剧引擎=${source.dramaticEngine}` : '',
    source.characterArc ? `人物弧=${source.characterArc}` : '',
    source.relationshipTension ? `关系张力=${source.relationshipTension}` : '',
  ]), [name], common)
  const voice = createDocument('character', source.id, 'voice', joinFacts([
    `人物：${name}`,
    source.speechPattern ? `说话方式=${source.speechPattern}` : '',
    source.catchphrases ? `口头禅=${source.catchphrases}` : '',
    source.vocabularyLevel ? `用词层级=${source.vocabularyLevel}` : '',
    source.dialectFeatures ? `口音特征=${source.dialectFeatures}` : '',
    parseStringArray(source.habitsJson).length > 0
      ? `习惯动作=${parseStringArray(source.habitsJson).join('、')}`
      : '',
  ]), [name], common)

  return [identity, motivation, voice].filter((entry): entry is SemanticMemoryDocument => Boolean(entry))
}

export function buildMapSemanticDocuments(source: MapSemanticSource): SemanticMemoryDocument[] {
  const name = compactText(source.name, 64) || `地点#${source.id}`
  const identity = createDocument('map', source.id, 'identity', joinFacts([
    `地点：${name}`,
    typeof source.level === 'number' ? `层级=${source.level}` : '',
    source.locationType ? `地点类型=${source.locationType}` : '',
    source.nodeType ? `节点类型=${source.nodeType}` : '',
    source.structureRole ? `结构作用=${source.structureRole}` : '',
    source.dangerLevel ? `危险等级=${source.dangerLevel}` : '',
    source.atmosphere ? `氛围=${source.atmosphere}` : '',
  ]), [name])
  const narrative = createDocument('map', source.id, 'narrative', joinFacts([
    `地点：${name}`,
    source.description ? `描述=${source.description}` : '',
    source.plotRelevance ? `剧情作用=${source.plotRelevance}` : '',
  ]), [name])

  return [identity, narrative].filter((entry): entry is SemanticMemoryDocument => Boolean(entry))
}

export function buildItemSemanticDocuments(
  source: ItemSemanticSource,
  names: {
    ownerName?: string
    locationName?: string
  } = {},
): SemanticMemoryDocument[] {
  const name = compactText(source.itemName, 64) || `物品#${source.id}`
  const visibility: SemanticMemoryVisibility = source.recordStatus === 'confirmed' ? 'canon' : 'draft'
  const state = createDocument('item', source.id, 'state', joinFacts([
    `物品：${name}`,
    source.itemKind ? `类型=${source.itemKind}` : '',
    source.category ? `分类=${source.category}` : '',
    source.subType ? `子类=${source.subType}` : '',
    source.rarity ? `稀有度=${source.rarity}` : '',
    source.status ? `状态=${source.status}` : '',
    names.ownerName ? `持有人=${names.ownerName}` : '',
    names.locationName ? `所在地点=${names.locationName}` : '',
    source.factionHint ? `势力关联=${source.factionHint}` : '',
  ]), [name, names.ownerName || '', names.locationName || ''], { visibility })
  const functionDoc = createDocument('item', source.id, 'function', joinFacts([
    `物品：${name}`,
    source.summary ? `摘要=${source.summary}` : '',
    source.plotFunction ? `剧情功能=${source.plotFunction}` : '',
    source.abilitySpec ? `能力=${source.abilitySpec}` : '',
    source.usageMethod ? `使用方式=${source.usageMethod}` : '',
    source.acquisitionMethod ? `获取方式=${source.acquisitionMethod}` : '',
    source.limitations ? `限制=${source.limitations}` : '',
    source.cost ? `代价=${source.cost}` : '',
    source.risk ? `风险=${source.risk}` : '',
  ]), [name], { visibility })

  return [state, functionDoc].filter((entry): entry is SemanticMemoryDocument => Boolean(entry))
}

export function buildStoryThreadSemanticDocuments(source: StoryThreadSemanticSource): SemanticMemoryDocument[] {
  const title = compactText(source.title, 80) || `线程#${source.id}`
  const validFromChapter = source.startChapter || source.plantedChapter || undefined
  const validToChapter = source.resolvedChapter || undefined
  const document = createDocument('story_thread', source.id, 'state', joinFacts([
    `故事线程：${title}`,
    source.threadType ? `类型=${source.threadType}` : '',
    source.status ? `状态=${source.status}` : '',
    source.priority ? `优先级=${source.priority}` : '',
    source.summary ? `摘要=${source.summary}` : '',
    source.premise ? `前提=${source.premise}` : '',
    source.currentState ? `当前进展=${source.currentState}` : '',
    source.lastReferencedChapter ? `最近推进=第${source.lastReferencedChapter}章` : '',
    source.targetPayoffChapter ? `目标回收=第${source.targetPayoffChapter}章` : '',
    source.payoffCondition ? `回收条件=${source.payoffCondition}` : '',
    source.notes ? `备注=${source.notes}` : '',
  ]), [title], {
    validFromChapter,
    validToChapter,
  })

  return document ? [document] : []
}

export function buildTimelineEventSemanticDocuments(
  source: TimelineEventSemanticSource,
  options: {
    sourceChapterStart?: number
    sourceChapterEnd?: number
    entityRefs?: string[]
  } = {},
): SemanticMemoryDocument[] {
  const title = compactText(source.eventTitle, 80) || `事件#${source.id}`
  const document = createDocument('timeline_event', source.id, 'event', joinFacts([
    `时间轴事件：${title}`,
    source.timeLabel ? `时间=${source.timeLabel}` : '',
    source.eventType ? `类型=${source.eventType}` : '',
    source.status ? `状态=${source.status}` : '',
    source.eventSummary ? `摘要=${source.eventSummary}` : '',
    source.eventCause ? `原因=${source.eventCause}` : '',
    source.eventProcess ? `过程=${source.eventProcess}` : '',
    source.protagonistAction ? `主角行动=${source.protagonistAction}` : '',
    source.eventResult ? `结果=${source.eventResult}` : '',
    source.notes ? `备注=${source.notes}` : '',
  ]), [title, ...(options.entityRefs || [])], {
    sourceChapterStart: options.sourceChapterStart,
    sourceChapterEnd: options.sourceChapterEnd,
    validFromChapter: options.sourceChapterStart,
  })

  return document ? [document] : []
}
