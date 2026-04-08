import {
  characterRelations,
  characters,
  factions,
  storyArcs,
  storyItems,
  storyThreads,
  timelineEvents,
} from '../database/schema'
import {
  getFactionRelationLabel,
  getFactionTypeLabel,
  parseFactionExternalRelations,
} from '../../src/shared/factions'

type CharacterRow = typeof characters.$inferSelect
type CharacterRelationRow = typeof characterRelations.$inferSelect
type FactionRow = typeof factions.$inferSelect
type StoryItemRow = typeof storyItems.$inferSelect
type StoryThreadRow = typeof storyThreads.$inferSelect
type TimelineEventRow = typeof timelineEvents.$inferSelect
type StoryArcRow = typeof storyArcs.$inferSelect

export interface CharacterContextCard {
  name: string
  phaseOrAge: string
  identityOrCamp: string
  relationToProtagonist: string
  currentState: string
  currentGoal: string
  speechStyle: string
  hardConstraint: string
}

export interface RelationContextCard {
  pair: string
  relationType: string
  currentTension: string
  interactionRule: string
}

export interface ItemContextCard {
  name: string
  holderOrLocation: string
  status: string
  plotFunction: string
  constraint: string
}

export interface TimelineContextCard {
  timeAnchor: string
  event: string
  affectedPeople: string
  mustStayTrue: string
}

export interface ThreadContextCard {
  name: string
  currentState: string
  stakes: string
  nextTrigger: string
}

export interface FactionContextCard {
  name: string
  typeOrStructure: string
  coreGoal: string
  linkedPeople: string
  territoryOrBase: string
  externalPressure: string
}

export interface CharacterStateEntry {
  chapterNum: number
  entry: string
}

export interface CharacterStateCardHint {
  currentState?: string
  currentGoal?: string
  hardConstraint?: string
}

interface TimelineCardMaps {
  chapterNumMap?: Map<number, number>
  arcNameMap?: Map<number, string>
  characterNameMap?: Map<number, string>
  locationNameMap?: Map<number, string>
}

interface CharacterCardOptions {
  allCharacters: CharacterRow[]
  relationRows: CharacterRelationRow[]
  recentStateEntries?: CharacterStateEntry[]
  dialogueHintMap?: Map<number, string>
  stateHintMap?: Map<number, CharacterStateCardHint>
  mentionedNames?: Set<string>
  limit?: number
}

interface RelationCardOptions {
  allCharacters: CharacterRow[]
  relationRows: CharacterRelationRow[]
  focusText?: string
  limit?: number
}

interface ItemCardOptions {
  items: StoryItemRow[]
  characterNameMap: Map<number, string>
  locationNameMap: Map<number, string>
  preferredEventIds?: Set<number>
  limit?: number
}

interface FactionCardOptions {
  factions: FactionRow[]
  characterNameMap: Map<number, string>
  locationNameMap: Map<number, string>
  limit?: number
}

interface ChapterThreadCardOptions {
  threads: StoryThreadRow[]
  chapterNum: number
  currentArc?: StoryArcRow | null
  limit?: number
}

interface ScopeThreadCardOptions {
  threads: StoryThreadRow[]
  startChapter?: number
  endChapter?: number
  extraThreadNames?: string[]
  limit?: number
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeInlineText(value: unknown, maxLength = 56): string {
  const text = asText(value)
    .replace(/\r\n/g, '\n')
    .replace(/\s*\n+\s*/g, '；')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(maxLength - 1, 1)).trim()}…`
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function joinCardValues(
  values: unknown[],
  options: { separator?: string; maxLength?: number; perValueMaxLength?: number; limit?: number } = {},
): string {
  const separator = options.separator || '；'
  const maxLength = options.maxLength ?? 72
  const perValueMaxLength = options.perValueMaxLength ?? 36
  const normalized = dedupeStrings(
    values
      .map((value) => normalizeInlineText(value, perValueMaxLength))
      .filter(Boolean),
    options.limit,
  )
  if (normalized.length === 0) return ''
  const joined = normalized.join(separator)
  if (joined.length <= maxLength) return joined
  return `${joined.slice(0, Math.max(maxLength - 1, 1)).trim()}…`
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? dedupeStrings(parsed.map((item) => asText(item)).filter(Boolean))
      : []
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

function parseJsonRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function stringifyCardList<T>(cards: T[]): string {
  return JSON.stringify(cards.filter((card) => card && typeof card === 'object'))
}

function parseCardList<T>(raw?: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is T => Boolean(item) && typeof item === 'object')
      : []
  } catch {
    return []
  }
}

function roleRank(roleType?: string | null): number {
  switch (roleType) {
    case 'protagonist':
      return 0
    case 'major':
      return 1
    case 'antagonist':
      return 2
    case 'supporting':
      return 3
    case 'minor':
      return 4
    default:
      return 5
  }
}

function selectImportantCharacters(allCharacters: CharacterRow[], mentionedNames?: Set<string>, limit = 15): CharacterRow[] {
  return [...allCharacters]
    .sort((left, right) => {
      const leftMentioned = mentionedNames?.has(left.fullName || '') ? 0 : 1
      const rightMentioned = mentionedNames?.has(right.fullName || '') ? 0 : 1
      if (leftMentioned !== rightMentioned) return leftMentioned - rightMentioned

      const leftRole = roleRank(left.roleType)
      const rightRole = roleRank(right.roleType)
      if (leftRole !== rightRole) return leftRole - rightRole

      const leftOrder = typeof left.sortOrder === 'number' ? left.sortOrder : Number.MAX_SAFE_INTEGER
      const rightOrder = typeof right.sortOrder === 'number' ? right.sortOrder : Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder

      return left.id - right.id
    })
    .slice(0, limit)
}

function getCanonicalProtagonist(allCharacters: CharacterRow[]): CharacterRow | null {
  return allCharacters.find((character) => character.roleType === 'protagonist')
    || allCharacters.find((character) => roleRank(character.roleType) <= 1)
    || allCharacters[0]
    || null
}

function buildRelationToProtagonist(protagonistId: number | undefined, character: CharacterRow, relationRows: CharacterRelationRow[]): string {
  if (!protagonistId) return ''
  if (character.id === protagonistId) return '主角本人'
  const relation = relationRows.find((row) =>
    (row.charAId === protagonistId && row.charBId === character.id)
    || (row.charBId === protagonistId && row.charAId === character.id))
  if (!relation) return ''
  return joinCardValues([
    relation.relationLabel || relation.relationType || '',
    relation.interactionStyle ? `互动=${relation.interactionStyle}` : '',
  ], { maxLength: 48, perValueMaxLength: 28, limit: 2 })
}

function extractAppearancePhase(character: CharacterRow): string {
  if (typeof character.age === 'number' && Number.isFinite(character.age) && character.age > 0) {
    return `${character.age}岁`
  }
  const appearance = parseJsonRecord(character.appearanceJson)
  return joinCardValues([appearance.ageStage, appearance.lifeStage, appearance.stage, appearance.phase], {
    maxLength: 24,
    perValueMaxLength: 16,
    limit: 1,
  })
}

function extractRecentCharacterState(characterName: string, recentStateEntries: CharacterStateEntry[]): string {
  const matched: string[] = []
  for (let index = recentStateEntries.length - 1; index >= 0; index -= 1) {
    const entry = recentStateEntries[index]
    if (!entry.entry.includes(characterName)) continue
    matched.push(`第${entry.chapterNum}章：${entry.entry}`)
    if (matched.length >= 2) break
  }
  return joinCardValues(matched.reverse(), { maxLength: 72, perValueMaxLength: 40, limit: 2 })
}

export function buildCharacterContextCards(options: CharacterCardOptions): CharacterContextCard[] {
  const protagonist = getCanonicalProtagonist(options.allCharacters)
  const recentStateEntries = options.recentStateEntries || []

  return selectImportantCharacters(options.allCharacters, options.mentionedNames, options.limit || 15).map((character) => {
    const stateHint = options.stateHintMap?.get(character.id)
    return {
      name: normalizeInlineText(character.fullName, 24) || `角色#${character.id}`,
      phaseOrAge: extractAppearancePhase(character),
      identityOrCamp: joinCardValues([
        character.socialIdentity,
        character.occupation,
        character.rankLevel,
        character.species && character.species !== '人类' ? character.species : '',
        !character.occupation && !character.socialIdentity ? character.roleType : '',
      ], { maxLength: 56, perValueMaxLength: 24, limit: 3 }),
      relationToProtagonist: buildRelationToProtagonist(protagonist?.id, character, options.relationRows),
      currentState: stateHint?.currentState || extractRecentCharacterState(character.fullName, recentStateEntries),
      currentGoal: joinCardValues([stateHint?.currentGoal, character.goals, character.surfaceDesire, character.deepNeed], {
        maxLength: 64,
        perValueMaxLength: 30,
        limit: 2,
      }),
      speechStyle: joinCardValues([
        character.speechPattern,
        character.catchphrases ? `口头禅=${character.catchphrases}` : '',
        character.vocabularyLevel ? `用词=${character.vocabularyLevel}` : '',
        character.dialectFeatures ? `口音=${character.dialectFeatures}` : '',
        options.dialogueHintMap?.get(character.id) ? `画像=${options.dialogueHintMap.get(character.id)}` : '',
      ], { maxLength: 72, perValueMaxLength: 28, limit: 3 }),
      hardConstraint: joinCardValues([
        stateHint?.hardConstraint,
        character.moralLine ? `底线=${character.moralLine}` : '',
        character.coreFear ? `恐惧=${character.coreFear}` : '',
        character.hiddenSecret ? `秘密=${character.hiddenSecret}` : '',
        character.trauma ? `创伤=${character.trauma}` : '',
      ], { maxLength: 72, perValueMaxLength: 28, limit: 2 }),
    }
  })
}

export function buildRelationContextCards(options: RelationCardOptions): RelationContextCard[] {
  const nameMap = new Map(options.allCharacters.map((character) => [character.id, character.fullName]))
  const focusIds = new Set<number>()
  const normalizedFocusText = asText(options.focusText)

  options.allCharacters.forEach((character) => {
    if (!character.fullName) return
    if (roleRank(character.roleType) <= 2 || normalizedFocusText.includes(character.fullName)) {
      focusIds.add(character.id)
    }
  })

  return options.relationRows
    .filter((relation) => Boolean(nameMap.get(relation.charAId)) && Boolean(nameMap.get(relation.charBId)))
    .map((relation) => ({
      relation,
      score:
        (focusIds.has(relation.charAId) ? 3 : 0) +
        (focusIds.has(relation.charBId) ? 3 : 0) +
        Number(relation.intimacyLevel || 0) +
        Number(relation.tensionLevel || 0) +
        (relation.relationType === 'lover' || relation.relationType === 'enemy' || relation.relationType === 'family' ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || right.relation.id - left.relation.id)
    .slice(0, options.limit || 8)
    .map(({ relation }) => ({
      pair: `${normalizeInlineText(nameMap.get(relation.charAId) || `角色#${relation.charAId}`, 20)} / ${normalizeInlineText(nameMap.get(relation.charBId) || `角色#${relation.charBId}`, 20)}`,
      relationType: joinCardValues([relation.relationLabel, relation.relationType], {
        maxLength: 40,
        perValueMaxLength: 20,
        limit: 1,
      }),
      currentTension: joinCardValues([
        typeof relation.tensionLevel === 'number' ? `张力=${relation.tensionLevel}` : '',
        typeof relation.intimacyLevel === 'number' ? `亲密=${relation.intimacyLevel}` : '',
        relation.description,
      ], { maxLength: 72, perValueMaxLength: 28, limit: 3 }),
      interactionRule: joinCardValues([relation.interactionStyle, relation.subtextRule], {
        maxLength: 72,
        perValueMaxLength: 28,
        limit: 2,
      }),
    }))
}

export function buildItemContextCards(options: ItemCardOptions): ItemContextCard[] {
  const preferredItems = options.preferredEventIds && options.preferredEventIds.size > 0
    ? options.items.filter((item) =>
      parseNumberArray(item.linkedTimelineEventIdsJson).some((eventId) => options.preferredEventIds?.has(eventId)))
    : []
  const selected = (preferredItems.length > 0
    ? preferredItems
    : options.items.filter((item) => item.itemKind === 'instance')).slice(0, options.limit || 12)

  return selected.map((item) => {
    const ownerName = item.ownerCharacterId
      ? options.characterNameMap.get(item.ownerCharacterId) || `角色#${item.ownerCharacterId}`
      : ''
    const locationName = item.locationMapId
      ? options.locationNameMap.get(item.locationMapId) || `地点#${item.locationMapId}`
      : ''
    return {
      name: normalizeInlineText(item.itemName, 28) || `物品#${item.id}`,
      holderOrLocation: joinCardValues([
        ownerName ? `持有=${ownerName}` : '',
        locationName ? `地点=${locationName}` : '',
      ], { maxLength: 56, perValueMaxLength: 28, limit: 2 }),
      status: joinCardValues([item.status, item.category], { maxLength: 32, perValueMaxLength: 16, limit: 2 }),
      plotFunction: joinCardValues([
        item.plotFunction,
        item.summary,
        item.abilitySpec ? `能力=${item.abilitySpec}` : '',
      ], { maxLength: 80, perValueMaxLength: 36, limit: 2 }),
      constraint: joinCardValues([
        item.limitations ? `限制=${item.limitations}` : '',
        item.cost ? `代价=${item.cost}` : '',
      ], { maxLength: 72, perValueMaxLength: 30, limit: 2 }),
    }
  })
}

export function buildFactionContextCards(options: FactionCardOptions): FactionContextCard[] {
  return options.factions.slice(0, options.limit || 8).map((faction) => {
    const leaderName = typeof faction.leaderCharacterId === 'number'
      ? options.characterNameMap.get(faction.leaderCharacterId) || `角色#${faction.leaderCharacterId}`
      : ''
    const territoryNames = parseNumberArray(faction.territoryMapNodeIdsJson)
      .map((id) => options.locationNameMap.get(id) || `地点#${id}`)
    const pressureLines = parseFactionExternalRelations(faction.externalRelationsJson)
      .slice(0, 3)
      .map((relation) => {
        const targetName = relation.targetFactionName
          || (typeof relation.targetFactionId === 'number' ? `势力#${relation.targetFactionId}` : '')
        if (!targetName) return ''
        return `${getFactionRelationLabel(relation.relation)}=${targetName}`
      })
      .filter(Boolean)

    return {
      name: normalizeInlineText(faction.name, 28) || `势力#${faction.id}`,
      typeOrStructure: joinCardValues([
        getFactionTypeLabel(faction.type),
        faction.memberPolicy,
      ], { maxLength: 72, perValueMaxLength: 30, limit: 2 }),
      coreGoal: joinCardValues([
        faction.goal,
        faction.currentPhase ? `阶段=${faction.currentPhase}` : '',
        faction.resources ? `资源=${faction.resources}` : '',
      ], { maxLength: 84, perValueMaxLength: 34, limit: 3 }),
      linkedPeople: joinCardValues([
        leaderName ? `领袖=${leaderName}` : '',
      ], { maxLength: 56, perValueMaxLength: 28, limit: 2 }),
      territoryOrBase: joinCardValues(territoryNames, {
        separator: '、',
        maxLength: 56,
        perValueMaxLength: 18,
        limit: 3,
      }),
      externalPressure: joinCardValues(pressureLines, {
        separator: '；',
        maxLength: 84,
        perValueMaxLength: 30,
        limit: 3,
      }),
    }
  })
}

function resolveTimelineChapterLabel(event: TimelineEventRow, chapterNumMap?: Map<number, number>): string {
  if (!chapterNumMap) return ''
  const start = event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined
  const end = event.chapterEndId ? chapterNumMap.get(event.chapterEndId) : undefined
  if (typeof start === 'number' && typeof end === 'number') return start === end ? `第${start}章` : `第${start}-${end}章`
  if (typeof start === 'number') return `第${start}章`
  if (typeof end === 'number') return `第${end}章`
  return ''
}

export function buildTimelineContextCards(events: TimelineEventRow[], maps: TimelineCardMaps = {}, limit = 10): TimelineContextCard[] {
  return events.slice(0, limit).map((event) => {
    const presentCharacters = parseNumberArray(event.presentCharacterIdsJson)
      .map((id) => maps.characterNameMap?.get(id))
      .filter((item): item is string => Boolean(item))
    const affectedCharacters = parseNumberArray(event.affectedCharacterIdsJson)
      .map((id) => maps.characterNameMap?.get(id))
      .filter((item): item is string => Boolean(item))
    return {
      timeAnchor: joinCardValues([event.timeLabel, resolveTimelineChapterLabel(event, maps.chapterNumMap), event.status], {
        maxLength: 40,
        perValueMaxLength: 18,
        limit: 2,
      }),
      event: joinCardValues([event.eventTitle, event.eventType ? `类型=${event.eventType}` : ''], {
        maxLength: 72,
        perValueMaxLength: 30,
        limit: 2,
      }),
      affectedPeople: joinCardValues(dedupeStrings([
        ...presentCharacters,
        ...affectedCharacters,
        event.protagonistPresent ? '主角在场' : '',
      ], 4), {
        separator: '、',
        maxLength: 40,
        perValueMaxLength: 12,
        limit: 4,
      }),
      mustStayTrue: joinCardValues([
        event.locationMapId ? `地点=${maps.locationNameMap?.get(event.locationMapId) || `地点#${event.locationMapId}`}` : '',
        event.arcId ? `故事弧=${maps.arcNameMap?.get(event.arcId) || `弧#${event.arcId}`}` : '',
        event.eventResult ? `结果=${event.eventResult}` : '',
        !event.eventResult && event.eventSummary ? `摘要=${event.eventSummary}` : '',
      ], { maxLength: 84, perValueMaxLength: 32, limit: 3 }),
    }
  })
}

function isArcPriority(thread: StoryThreadRow, currentArc?: StoryArcRow | null): boolean {
  if (!currentArc || typeof currentArc.chapterStart !== 'number' || typeof currentArc.chapterEnd !== 'number') return false
  const spanStart = thread.startChapter || thread.plantedChapter || thread.lastReferencedChapter || 0
  const spanEnd = thread.targetPayoffChapter || thread.lastReferencedChapter || thread.plantedChapter || thread.startChapter || 0
  if (!spanStart && !spanEnd) return false
  const rangeStart = spanStart || spanEnd
  const rangeEnd = spanEnd || spanStart
  return rangeStart <= currentArc.chapterEnd && rangeEnd >= currentArc.chapterStart
}

function getThreadSpan(thread: StoryThreadRow, chapterNum: number): number {
  const baseChapter = thread.lastReferencedChapter || thread.plantedChapter || thread.startChapter || chapterNum
  if (typeof thread.targetPayoffChapter === 'number' && thread.targetPayoffChapter > 0) {
    return Math.max(1, thread.targetPayoffChapter - baseChapter)
  }
  return Math.max(1, chapterNum - baseChapter + 6)
}

function getEffectiveReminderInterval(thread: StoryThreadRow, chapterNum: number): number {
  const baseInterval = Math.max(3, thread.reminderInterval || 20)
  return Math.max(3, Math.min(baseInterval, Math.ceil(getThreadSpan(thread, chapterNum) / 3)))
}

function buildThreadCard(
  thread: StoryThreadRow,
  extras: { isArcPriority?: boolean; isUrgent?: boolean; needsReminder?: boolean; chapterNum?: number } = {},
): ThreadContextCard {
  const reminderGap = extras.chapterNum
    ? extras.chapterNum - (thread.lastReferencedChapter || thread.plantedChapter || thread.startChapter || extras.chapterNum)
    : 0
  return {
    name: normalizeInlineText(thread.title, 28) || `线程#${thread.id}`,
    currentState: joinCardValues([
      thread.currentState,
      !thread.currentState ? thread.summary : '',
      !thread.currentState && !thread.summary ? thread.premise : '',
    ], { maxLength: 84, perValueMaxLength: 36, limit: 2 }),
    stakes: joinCardValues([
      extras.isArcPriority ? '本弧优先' : '',
      extras.isUrgent && typeof thread.targetPayoffChapter === 'number' ? `临近第${thread.targetPayoffChapter}章回收` : '',
      thread.priority ? `优先级=${thread.priority}` : '',
      thread.summary && thread.currentState ? thread.summary : '',
    ], { maxLength: 84, perValueMaxLength: 32, limit: 3 }),
    nextTrigger: joinCardValues([
      thread.payoffCondition,
      typeof thread.targetPayoffChapter === 'number' ? `目标章=${thread.targetPayoffChapter}` : '',
      extras.needsReminder && reminderGap > 0 ? `已${reminderGap}章未提及` : '',
    ], { maxLength: 72, perValueMaxLength: 32, limit: 3 }),
  }
}

export function buildChapterThreadContextCards(options: ChapterThreadCardOptions): { cards: ThreadContextCard[]; pressureCount: number } {
  const rows = options.threads.filter((thread) => thread.status === 'active')
  if (rows.length === 0) return { cards: [], pressureCount: 0 }

  const urgent = rows.filter((thread) => (
    typeof thread.targetPayoffChapter === 'number'
    && thread.targetPayoffChapter >= options.chapterNum
    && (thread.targetPayoffChapter - options.chapterNum) <= 5
  ))
  const needsReminder = rows.filter((thread) => {
    if (urgent.includes(thread)) return false
    const lastRef = thread.lastReferencedChapter || thread.plantedChapter || thread.startChapter || 0
    return lastRef > 0 && (options.chapterNum - lastRef) >= getEffectiveReminderInterval(thread, options.chapterNum)
  })
  const rest = rows.filter((thread) => !urgent.includes(thread) && !needsReminder.includes(thread))
  const ordered = [...urgent, ...needsReminder, ...rest]
    .sort((left, right) => {
      const leftArc = isArcPriority(left, options.currentArc) ? 0 : 1
      const rightArc = isArcPriority(right, options.currentArc) ? 0 : 1
      if (leftArc !== rightArc) return leftArc - rightArc

      const leftDistance = typeof left.targetPayoffChapter === 'number'
        ? Math.abs(left.targetPayoffChapter - options.chapterNum)
        : Number.MAX_SAFE_INTEGER
      const rightDistance = typeof right.targetPayoffChapter === 'number'
        ? Math.abs(right.targetPayoffChapter - options.chapterNum)
        : Number.MAX_SAFE_INTEGER
      if (leftDistance !== rightDistance) return leftDistance - rightDistance

      return (left.sortOrder || 0) - (right.sortOrder || 0)
    })
    .slice(0, options.limit || 10)

  return {
    cards: ordered.map((thread) => buildThreadCard(thread, {
      chapterNum: options.chapterNum,
      isArcPriority: isArcPriority(thread, options.currentArc),
      isUrgent: urgent.includes(thread),
      needsReminder: needsReminder.includes(thread),
    })),
    pressureCount: urgent.length + needsReminder.length,
  }
}

export function buildScopeThreadContextCards(options: ScopeThreadCardOptions): ThreadContextCard[] {
  const overlapping = options.threads.filter((thread) => {
    if (thread.status === 'resolved' || thread.status === 'abandoned') return false
    const spanStart = thread.startChapter || thread.plantedChapter || thread.lastReferencedChapter || 0
    const spanEnd = thread.targetPayoffChapter || thread.lastReferencedChapter || thread.plantedChapter || thread.startChapter || 0
    if (!options.startChapter || !options.endChapter || (!spanStart && !spanEnd)) return thread.status === 'active'
    const rangeStart = spanStart || spanEnd
    const rangeEnd = spanEnd || spanStart
    return rangeStart <= options.endChapter && rangeEnd >= options.startChapter
  })

  const structured = overlapping
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.id - right.id)
    .slice(0, options.limit || 8)
    .map((thread) => buildThreadCard(thread))
  const existingNames = new Set(structured.map((card) => card.name))
  const extras = dedupeStrings(options.extraThreadNames || [], options.limit || 8)
    .filter((name) => !existingNames.has(normalizeInlineText(name, 28)))
    .map((name) => ({
      name: normalizeInlineText(name, 28),
      currentState: '待持续追踪',
      stakes: '',
      nextTrigger: '',
    }))
  return [...structured, ...extras].slice(0, options.limit || 8)
}

export function buildGenericThreadCardsFromTexts(texts: string[], currentState = '待回收', limit = 8): ThreadContextCard[] {
  return dedupeStrings(texts, limit).map((text) => ({
    name: normalizeInlineText(text, 28),
    currentState,
    stakes: '',
    nextTrigger: '',
  }))
}

function renderCardLine(title: string, fields: Array<[string, string]>): string {
  const normalizedTitle = normalizeInlineText(title, 28)
  const fieldText = fields
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}=${value}`)
    .join(' | ')
  return fieldText ? `${normalizedTitle} | ${fieldText}` : normalizedTitle
}

export function renderCharacterCards(cards: CharacterContextCard[]): string {
  return cards.map((card) => renderCardLine(card.name, [
    ['阶段', card.phaseOrAge],
    ['身份/阵营', card.identityOrCamp],
    ['与主角关系', card.relationToProtagonist],
    ['当前状态', card.currentState],
    ['当前目标', card.currentGoal],
    ['说话特征', card.speechStyle],
    ['硬约束', card.hardConstraint],
  ])).join('\n')
}

export function renderRelationCards(cards: RelationContextCard[]): string {
  return cards.map((card) => renderCardLine(card.pair, [
    ['关系', card.relationType],
    ['张力', card.currentTension],
    ['互动规则', card.interactionRule],
  ])).join('\n')
}

export function renderItemCards(cards: ItemContextCard[]): string {
  return cards.map((card) => renderCardLine(card.name, [
    ['持有/地点', card.holderOrLocation],
    ['状态', card.status],
    ['作用', card.plotFunction],
    ['约束', card.constraint],
  ])).join('\n')
}

export function renderTimelineCards(cards: TimelineContextCard[]): string {
  return cards.map((card) => renderCardLine(card.timeAnchor || '时间待定', [
    ['事件', card.event],
    ['相关人', card.affectedPeople],
    ['必须保持', card.mustStayTrue],
  ])).join('\n')
}

export function renderThreadCards(cards: ThreadContextCard[]): string {
  return cards.map((card) => renderCardLine(card.name, [
    ['状态', card.currentState],
    ['风险/价值', card.stakes],
    ['下一触发', card.nextTrigger],
  ])).join('\n')
}

export function renderFactionCards(cards: FactionContextCard[]): string {
  return cards.map((card) => renderCardLine(card.name, [
    ['类型/结构', card.typeOrStructure],
    ['目标/阶段', card.coreGoal],
    ['关联人物', card.linkedPeople],
    ['地盘', card.territoryOrBase],
    ['外部压力', card.externalPressure],
  ])).join('\n')
}

export function stringifyCharacterCards(cards: CharacterContextCard[]): string {
  return stringifyCardList(cards)
}

export function parseCharacterCards(raw?: string | null): CharacterContextCard[] {
  return parseCardList<CharacterContextCard>(raw)
}

export function stringifyRelationCards(cards: RelationContextCard[]): string {
  return stringifyCardList(cards)
}

export function parseRelationCards(raw?: string | null): RelationContextCard[] {
  return parseCardList<RelationContextCard>(raw)
}

export function stringifyItemCards(cards: ItemContextCard[]): string {
  return stringifyCardList(cards)
}

export function parseItemCards(raw?: string | null): ItemContextCard[] {
  return parseCardList<ItemContextCard>(raw)
}

export function stringifyTimelineCards(cards: TimelineContextCard[]): string {
  return stringifyCardList(cards)
}

export function parseTimelineCards(raw?: string | null): TimelineContextCard[] {
  return parseCardList<TimelineContextCard>(raw)
}

export function stringifyThreadCards(cards: ThreadContextCard[]): string {
  return stringifyCardList(cards)
}

export function parseThreadCards(raw?: string | null): ThreadContextCard[] {
  return parseCardList<ThreadContextCard>(raw)
}

export function parseCardStringArray(raw?: string | null): string[] {
  return parseStringArray(raw)
}
