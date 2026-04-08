import { asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapters,
  characterRelations,
  characters,
  characterStateVersions,
} from '../database/schema'

type CharacterRow = typeof characters.$inferSelect
type CharacterRelationRow = typeof characterRelations.$inferSelect
type ChapterRow = typeof chapters.$inferSelect
type CharacterStateVersionRow = typeof characterStateVersions.$inferSelect
type CharacterStateVersionInsert = typeof characterStateVersions.$inferInsert

interface ContinuityStateLike {
  plotProgress: string[]
  characterStateChanges: string[]
  worldStateChanges: string[]
  openLoops: string[]
  continuityNotes: string[]
  arcProgress: string
}

interface CharacterStateVersionLike {
  characterId: number
  chapterId: number
  chapterNum: number
  injuryState?: string | null
  resourceState?: string | null
  stanceState?: string | null
  mentalState?: string | null
  relationshipHeatSummary?: string | null
  goalState?: string | null
  eventCause?: string | null
  changeReason?: string | null
  summaryText?: string | null
}

interface CharacterSignalBundle {
  mentioned: boolean
  sourceEntries: string[]
  relatedCharacterNames: string[]
}

export interface CharacterStateSummary {
  characterId: number
  characterName: string
  roleType: string
  chapterId: number
  chapterNum: number
  injuryState?: string
  resourceState?: string
  stanceState?: string
  mentalState?: string
  relationshipHeatSummary?: string
  goalState?: string
  eventCause?: string
  changeReason?: string
  summaryText: string
  driftAlert?: string
}

export interface CharacterStateDriftAlert {
  characterId: number
  characterName: string
  chapterId: number
  chapterNum: number
  driftScore: number
  reasons: string[]
  summary: string
}

export interface CharacterStateContextHint {
  currentState: string
  currentGoal: string
  hardConstraint: string
}

const INJURY_KEYWORDS = ['伤', '伤势', '流血', '骨折', '中毒', '昏迷', '虚弱', '咳血', '发烧', '残', '恢复', '痊愈', '疗伤']
const RESOURCE_KEYWORDS = ['钱', '银', '铜板', '灵石', '补给', '弹药', '物资', '药', '库存', '粮', '资源', '欠债', '装备', '法器', '丹药', '口粮']
const STANCE_KEYWORDS = ['立场', '倒向', '支持', '敌对', '合作', '结盟', '背叛', '决裂', '站队', '怀疑', '不信', '臣服']
const MENTAL_KEYWORDS = ['恐惧', '愤怒', '冷静', '动摇', '崩溃', '警惕', '绝望', '执念', '愧疚', '迟疑', '坚定', '麻木', '焦躁', '慌']
const RELATIONSHIP_KEYWORDS = ['关系', '信任', '亲近', '疏远', '和解', '决裂', '依赖', '试探', '敌意', '默契', '隔阂']
const GOAL_KEYWORDS = ['目标', '决定', '打算', '计划', '准备', '想要', '必须', '誓要', '追查', '寻找', '营救', '复仇', '保护', '放弃']
const RESOURCE_PRESSURE_KEYWORDS = ['不足', '短缺', '见底', '耗尽', '匮乏', '紧张', '欠债', '损坏']
const STATE_CAUSE_KEYWORDS = ['因为', '因此', '所以', '受', '经历', '之后', '决定', '被迫', '转而', '改为', '恢复', '和解', '决裂', '得知', '目睹']

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeInlineText(value: unknown, maxLength = 72): string {
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

function joinCompact(
  values: unknown[],
  options: { separator?: string; maxLength?: number; perValueMaxLength?: number; limit?: number } = {},
): string {
  const separator = options.separator || '；'
  const maxLength = options.maxLength ?? 84
  const perValueMaxLength = options.perValueMaxLength ?? 40
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

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = asText(text)
  return normalized ? keywords.some((keyword) => normalized.includes(keyword)) : false
}

function parseContinuityState(raw?: string | null): ContinuityStateLike {
  if (!raw) {
    return {
      plotProgress: [],
      characterStateChanges: [],
      worldStateChanges: [],
      openLoops: [],
      continuityNotes: [],
      arcProgress: '',
    }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      plotProgress: Array.isArray(parsed.plot_progress) ? parsed.plot_progress.map((item) => asText(item)).filter(Boolean) : [],
      characterStateChanges: Array.isArray(parsed.character_state_changes) ? parsed.character_state_changes.map((item) => asText(item)).filter(Boolean) : [],
      worldStateChanges: Array.isArray(parsed.world_state_changes) ? parsed.world_state_changes.map((item) => asText(item)).filter(Boolean) : [],
      openLoops: Array.isArray(parsed.open_loops) ? parsed.open_loops.map((item) => asText(item)).filter(Boolean) : [],
      continuityNotes: Array.isArray(parsed.continuity_notes) ? parsed.continuity_notes.map((item) => asText(item)).filter(Boolean) : [],
      arcProgress: asText(parsed.arc_progress),
    }
  } catch {
    return {
      plotProgress: [],
      characterStateChanges: [],
      worldStateChanges: [],
      openLoops: [],
      continuityNotes: [],
      arcProgress: '',
    }
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

function sortCharacters(left: CharacterRow, right: CharacterRow): number {
  const leftRole = roleRank(left.roleType)
  const rightRole = roleRank(right.roleType)
  if (leftRole !== rightRole) return leftRole - rightRole

  const leftOrder = typeof left.sortOrder === 'number' ? left.sortOrder : Number.MAX_SAFE_INTEGER
  const rightOrder = typeof right.sortOrder === 'number' ? right.sortOrder : Number.MAX_SAFE_INTEGER
  if (leftOrder !== rightOrder) return leftOrder - rightOrder

  return left.id - right.id
}

function selectTrackedCharacters(allCharacters: CharacterRow[]): CharacterRow[] {
  const tracked = allCharacters.filter((character) => roleRank(character.roleType) <= 3)
  return [...(tracked.length > 0 ? tracked : allCharacters)]
    .sort(sortCharacters)
    .slice(0, 18)
}

function extractRelatedCharacterNames(
  entries: string[],
  selfName: string,
  candidateNames: string[],
): string[] {
  const found = new Set<string>()
  entries.forEach((entry) => {
    candidateNames.forEach((name) => {
      if (!name || name === selfName || found.has(name)) return
      if (entry.includes(name)) {
        found.add(name)
      }
    })
  })
  return [...found].slice(0, 3)
}

function collectCharacterSignals(
  character: CharacterRow,
  chapter: ChapterRow,
  continuity: ContinuityStateLike,
  allCharacterNames: string[],
): CharacterSignalBundle {
  const sourceEntries = dedupeStrings([
    ...continuity.characterStateChanges.filter((entry) => entry.includes(character.fullName)),
    ...continuity.plotProgress.filter((entry) => entry.includes(character.fullName)),
    ...continuity.openLoops.filter((entry) => entry.includes(character.fullName)),
    ...continuity.continuityNotes.filter((entry) => entry.includes(character.fullName)),
    chapter.summary && chapter.summary.includes(character.fullName) ? chapter.summary : '',
    chapter.content && chapter.content.includes(character.fullName) ? chapter.content.slice(0, 180) : '',
  ], 6)

  return {
    mentioned: sourceEntries.length > 0,
    sourceEntries,
    relatedCharacterNames: extractRelatedCharacterNames(sourceEntries, character.fullName, allCharacterNames),
  }
}

function pickLatestFieldEntry(entries: string[], keywords: string[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!containsAny(entry, keywords)) continue
    return normalizeInlineText(entry, 64)
  }
  return ''
}

function buildInitialGoal(character: CharacterRow): string {
  return joinCompact([character.goals, character.surfaceDesire, character.deepNeed], {
    maxLength: 68,
    perValueMaxLength: 32,
    limit: 2,
  })
}

function buildStaticRelationshipSummary(
  character: CharacterRow,
  relationRows: CharacterRelationRow[],
  nameMap: Map<number, string>,
): string {
  const related = relationRows.filter((row) => row.charAId === character.id || row.charBId === character.id)
  if (related.length === 0) return ''

  const picked = [...related].sort((left, right) => {
    const leftScore = Number(left.tensionLevel || 0) + Number(left.intimacyLevel || 0)
    const rightScore = Number(right.tensionLevel || 0) + Number(right.intimacyLevel || 0)
    return rightScore - leftScore || right.id - left.id
  })[0]

  if (!picked) return ''
  const otherId = picked.charAId === character.id ? picked.charBId : picked.charAId
  const otherName = nameMap.get(otherId) || `角色#${otherId}`
  return joinCompact([
    `与${otherName}`,
    picked.relationLabel || picked.relationType || '',
    typeof picked.tensionLevel === 'number' ? `张力${picked.tensionLevel}` : '',
    typeof picked.intimacyLevel === 'number' ? `亲密${picked.intimacyLevel}` : '',
  ], {
    maxLength: 64,
    perValueMaxLength: 24,
    limit: 3,
  })
}

function composeSummaryText(state: CharacterStateVersionLike): string {
  return joinCompact([
    state.injuryState ? `伤势=${state.injuryState}` : '',
    state.resourceState ? `资源=${state.resourceState}` : '',
    state.stanceState ? `立场=${state.stanceState}` : '',
    state.mentalState ? `心态=${state.mentalState}` : '',
    state.relationshipHeatSummary ? `关系=${state.relationshipHeatSummary}` : '',
    state.goalState ? `目标=${state.goalState}` : '',
  ], {
    separator: ' | ',
    maxLength: 120,
    perValueMaxLength: 42,
    limit: 4,
  }) || '状态延续，无新增显式变化'
}

function buildStateConstraintSummary(
  state: CharacterStateVersionLike,
  driftAlert?: CharacterStateDriftAlert | null,
): string {
  return joinCompact([
    state.injuryState ? `伤势未清=${state.injuryState}` : '',
    state.resourceState && containsAny(state.resourceState, RESOURCE_PRESSURE_KEYWORDS) ? `资源约束=${state.resourceState}` : '',
    state.stanceState ? `立场边界=${state.stanceState}` : '',
    driftAlert ? `漂移警戒=${driftAlert.summary}` : '',
  ], {
    maxLength: 84,
    perValueMaxLength: 36,
    limit: 3,
  })
}

function toComparableText(value?: string | null): string {
  return asText(value).replace(/[，。！？；：、\s]/g, '')
}

function isFieldChanged(previous?: string | null, current?: string | null): boolean {
  const left = toComparableText(previous)
  const right = toComparableText(current)
  if (!left && !right) return false
  if (left === right) return false
  if (left && right && (left.includes(right) || right.includes(left))) return false
  return true
}

function hasExplicitCause(latest: CharacterStateVersionLike): boolean {
  return containsAny(joinCompact([latest.changeReason, latest.eventCause], { maxLength: 120 }), STATE_CAUSE_KEYWORDS)
}

export function detectCharacterStateDrift(
  history: CharacterStateVersionLike[],
  characterName = '该角色',
): CharacterStateDriftAlert | null {
  if (history.length < 2) return null
  const latest = history[0]
  const previous = history.find((entry) => entry.chapterNum < latest.chapterNum)
  if (!previous) return null

  const reasons: string[] = []
  const hasCause = hasExplicitCause(latest)

  if (isFieldChanged(previous.injuryState, latest.injuryState) && !hasCause) {
    reasons.push('伤势状态变化缺少明确事件原因')
  }
  if (isFieldChanged(previous.stanceState, latest.stanceState) && !hasCause) {
    reasons.push('立场变化过快，缺少转向过程')
  }
  if (isFieldChanged(previous.relationshipHeatSummary, latest.relationshipHeatSummary) && !hasCause) {
    reasons.push('关系温度跳变缺少承接')
  }
  if (isFieldChanged(previous.goalState, latest.goalState) && !hasCause) {
    reasons.push('目标切换缺少触发链')
  }
  if (isFieldChanged(previous.mentalState, latest.mentalState) && !hasCause) {
    reasons.push('心理状态大幅变化缺少原因')
  }

  if (reasons.length === 0) return null

  return {
    characterId: latest.characterId,
    characterName,
    chapterId: latest.chapterId,
    chapterNum: latest.chapterNum,
    driftScore: Math.min(100, reasons.length * 25),
    reasons,
    summary: `${characterName} 第${latest.chapterNum}章状态跳变：${reasons.join('；')}`,
  }
}

function resolveRebuildStartChapterNum(
  novelId: number,
  targetChapterNum: number,
  trackedCharacterIds: number[],
): number {
  const db = getDb()
  const trackedSet = new Set(trackedCharacterIds)
  const existingRows = db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .orderBy(desc(characterStateVersions.chapterNum), desc(characterStateVersions.id))
    .all()
    .filter((row) => trackedSet.has(row.characterId))

  if (existingRows.length === 0) return 1

  const trackedWithHistory = new Set(existingRows.map((row) => row.characterId))
  if (trackedWithHistory.size < trackedCharacterIds.length) return 1

  const maxBuiltChapterNum = existingRows.reduce((maxValue, row) => Math.max(maxValue, Number(row.chapterNum || 0)), 0)
  return Math.min(targetChapterNum, maxBuiltChapterNum + 1)
}

function loadLatestStateMapBeforeChapter(
  novelId: number,
  trackedCharacterIds: number[],
  chapterNum: number,
): Map<number, CharacterStateVersionLike> {
  const db = getDb()
  const trackedSet = new Set(trackedCharacterIds)
  const rows = db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .orderBy(desc(characterStateVersions.chapterNum), desc(characterStateVersions.id))
    .all()

  const map = new Map<number, CharacterStateVersionLike>()
  for (const row of rows) {
    if (row.chapterNum >= chapterNum) continue
    if (!trackedSet.has(row.characterId) || map.has(row.characterId)) continue
    map.set(row.characterId, row)
    if (map.size >= trackedCharacterIds.length) break
  }
  return map
}

function toStateLike(row: CharacterStateVersionInsert): CharacterStateVersionLike {
  return {
    characterId: Number(row.characterId),
    chapterId: Number(row.chapterId),
    chapterNum: Number(row.chapterNum),
    injuryState: asText(row.injuryState),
    resourceState: asText(row.resourceState),
    stanceState: asText(row.stanceState),
    mentalState: asText(row.mentalState),
    relationshipHeatSummary: asText(row.relationshipHeatSummary),
    goalState: asText(row.goalState),
    eventCause: asText(row.eventCause),
    changeReason: asText(row.changeReason),
    summaryText: asText(row.summaryText),
  }
}

export function buildCharacterStateSnapshotForChapter(input: {
  chapter: ChapterRow
  trackedCharacters: CharacterRow[]
  previousStateMap: Map<number, CharacterStateVersionLike>
  relationRows: CharacterRelationRow[]
  allCharacterNames: string[]
}): CharacterStateVersionInsert[] {
  const continuity = parseContinuityState(input.chapter.continuityStateJson)
  const nameMap = new Map(input.trackedCharacters.map((character) => [character.id, character.fullName]))
  const now = new Date().toISOString()

  return input.trackedCharacters.reduce<CharacterStateVersionInsert[]>((result, character) => {
    const previous = input.previousStateMap.get(character.id)
    const signals = collectCharacterSignals(character, input.chapter, continuity, input.allCharacterNames)
    const shouldTrack = Boolean(previous)
      || signals.mentioned
      || character.appearChapter === undefined
      || character.appearChapter === null
      || character.appearChapter <= input.chapter.chapterNum

    if (!shouldTrack) return result

    const injuryState = pickLatestFieldEntry(signals.sourceEntries, INJURY_KEYWORDS) || asText(previous?.injuryState)
    const resourceState = pickLatestFieldEntry(signals.sourceEntries, RESOURCE_KEYWORDS) || asText(previous?.resourceState)
    const stanceState = pickLatestFieldEntry(signals.sourceEntries, STANCE_KEYWORDS) || asText(previous?.stanceState)
    const mentalState = pickLatestFieldEntry(signals.sourceEntries, MENTAL_KEYWORDS) || asText(previous?.mentalState)
    const relationshipHeatSummary = pickLatestFieldEntry(signals.sourceEntries, RELATIONSHIP_KEYWORDS)
      || (signals.relatedCharacterNames.length > 0
        ? joinCompact([
            signals.relatedCharacterNames.map((name) => `与${name}`).join('、'),
            signals.sourceEntries[signals.sourceEntries.length - 1] || '',
          ], { maxLength: 72, perValueMaxLength: 40, limit: 2 })
        : '')
      || asText(previous?.relationshipHeatSummary)
      || buildStaticRelationshipSummary(character, input.relationRows, nameMap)
    const goalState = pickLatestFieldEntry(signals.sourceEntries, GOAL_KEYWORDS)
      || asText(previous?.goalState)
      || buildInitialGoal(character)
    const eventCause = signals.sourceEntries.length > 0
      ? normalizeInlineText(input.chapter.summary || signals.sourceEntries[0], 84)
      : asText(previous?.eventCause)
    const changeReason = signals.sourceEntries.length > 0
      ? joinCompact(signals.sourceEntries, { maxLength: 96, perValueMaxLength: 42, limit: 3 })
      : previous
        ? '延续前章状态，无新增显式变化'
        : '沿用角色基础设定'

    const stateLike: CharacterStateVersionLike = {
      characterId: character.id,
      chapterId: input.chapter.id,
      chapterNum: input.chapter.chapterNum,
      injuryState,
      resourceState,
      stanceState,
      mentalState,
      relationshipHeatSummary,
      goalState,
      eventCause,
      changeReason,
    }

    result.push({
      novelId: input.chapter.novelId,
      characterId: character.id,
      chapterId: input.chapter.id,
      chapterNum: input.chapter.chapterNum,
      injuryState: injuryState || null,
      resourceState: resourceState || null,
      stanceState: stanceState || null,
      mentalState: mentalState || null,
      relationshipHeatSummary: relationshipHeatSummary || null,
      goalState: goalState || null,
      eventCause: eventCause || null,
      changeReason: changeReason || null,
      summaryText: composeSummaryText(stateLike),
      createdAt: now,
      updatedAt: now,
    })
    return result
  }, [])
}

export function refreshCharacterStateVersionsForChapter(chapterId: number): void {
  const db = getDb()
  const targetChapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!targetChapter) return

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, targetChapter.novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
  const allCharacters = db.select().from(characters)
    .where(eq(characters.novelId, targetChapter.novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
  const trackedCharacters = selectTrackedCharacters(allCharacters)
  if (trackedCharacters.length === 0) return

  const relationRows = db.select().from(characterRelations)
    .where(eq(characterRelations.novelId, targetChapter.novelId))
    .all()
  const trackedCharacterIds = trackedCharacters.map((character) => character.id)
  const trackedCharacterIdSet = new Set(trackedCharacterIds)
  const startChapterNum = resolveRebuildStartChapterNum(
    targetChapter.novelId,
    targetChapter.chapterNum,
    trackedCharacterIds,
  )
  const previousStateMap = loadLatestStateMapBeforeChapter(
    targetChapter.novelId,
    trackedCharacterIds,
    startChapterNum,
  )

  const staleRows = db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, targetChapter.novelId))
    .all()
    .filter((row) => trackedCharacterIdSet.has(row.characterId) && row.chapterNum >= startChapterNum)
  if (staleRows.length > 0) {
    db.delete(characterStateVersions).where(inArray(characterStateVersions.id, staleRows.map((row) => row.id))).run()
  }

  const allCharacterNames = allCharacters
    .map((character) => character.fullName || '')
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)

  chapterRows
    .filter((chapter) => chapter.chapterNum >= startChapterNum)
    .forEach((chapter) => {
      const snapshots = buildCharacterStateSnapshotForChapter({
        chapter,
        trackedCharacters,
        previousStateMap,
        relationRows,
        allCharacterNames,
      })
      if (snapshots.length === 0) return
      db.insert(characterStateVersions).values(snapshots).run()
      snapshots.forEach((snapshot) => {
        previousStateMap.set(Number(snapshot.characterId), toStateLike(snapshot))
      })
    })
}

function buildCharacterStateSummary(
  row: CharacterStateVersionRow,
  character: CharacterRow,
  history: CharacterStateVersionRow[],
): CharacterStateSummary {
  const driftAlert = detectCharacterStateDrift(history, character.fullName)
  return {
    characterId: character.id,
    characterName: character.fullName,
    roleType: character.roleType || 'minor',
    chapterId: row.chapterId,
    chapterNum: row.chapterNum,
    injuryState: asText(row.injuryState),
    resourceState: asText(row.resourceState),
    stanceState: asText(row.stanceState),
    mentalState: asText(row.mentalState),
    relationshipHeatSummary: asText(row.relationshipHeatSummary),
    goalState: asText(row.goalState),
    eventCause: asText(row.eventCause),
    changeReason: asText(row.changeReason),
    summaryText: asText(row.summaryText) || composeSummaryText(row),
    driftAlert: driftAlert?.summary,
  }
}

export function listLatestCharacterStates(
  novelId: number,
  options: {
    upToChapterNum?: number
    mentionedNames?: Set<string>
    limit?: number
  } = {},
): CharacterStateSummary[] {
  const db = getDb()
  const characterRows = db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
  const characterMap = new Map(characterRows.map((row) => [row.id, row]))
  const rows = db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .orderBy(desc(characterStateVersions.chapterNum), desc(characterStateVersions.id))
    .all()
    .filter((row) => options.upToChapterNum === undefined || row.chapterNum <= options.upToChapterNum)

  const latestByCharacter = new Map<number, CharacterStateVersionRow>()
  const historyByCharacter = new Map<number, CharacterStateVersionRow[]>()
  rows.forEach((row) => {
    if (!historyByCharacter.has(row.characterId)) {
      historyByCharacter.set(row.characterId, [])
    }
    historyByCharacter.get(row.characterId)?.push(row)
    if (!latestByCharacter.has(row.characterId)) {
      latestByCharacter.set(row.characterId, row)
    }
  })

  return [...latestByCharacter.values()]
    .map((row) => {
      const character = characterMap.get(row.characterId)
      if (!character) return null
      return buildCharacterStateSummary(
        row,
        character,
        historyByCharacter.get(row.characterId) || [row],
      )
    })
    .filter((item): item is CharacterStateSummary => Boolean(item))
    .sort((left, right) => {
      const leftMentioned = options.mentionedNames?.has(left.characterName) ? 0 : 1
      const rightMentioned = options.mentionedNames?.has(right.characterName) ? 0 : 1
      if (leftMentioned !== rightMentioned) return leftMentioned - rightMentioned

      const leftCharacter = characterMap.get(left.characterId)
      const rightCharacter = characterMap.get(right.characterId)
      if (leftCharacter && rightCharacter) {
        return sortCharacters(leftCharacter, rightCharacter)
      }
      return left.characterId - right.characterId
    })
    .slice(0, options.limit || 12)
}

export function listCharacterStateHistory(characterId: number, limit = 8): CharacterStateVersionRow[] {
  const db = getDb()
  return db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.characterId, characterId))
    .orderBy(desc(characterStateVersions.chapterNum), desc(characterStateVersions.id))
    .all()
    .slice(0, limit)
}

export function listNovelCharacterStateAlerts(novelId: number, limit = 6): CharacterStateDriftAlert[] {
  const db = getDb()
  const characterRows = db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .all()
  const characterMap = new Map(characterRows.map((row) => [row.id, row]))
  const grouped = new Map<number, CharacterStateVersionRow[]>()

  db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .orderBy(desc(characterStateVersions.chapterNum), desc(characterStateVersions.id))
    .all()
    .forEach((row) => {
      if (!grouped.has(row.characterId)) {
        grouped.set(row.characterId, [])
      }
      grouped.get(row.characterId)?.push(row)
    })

  return [...grouped.entries()]
    .map(([characterId, history]) => {
      const character = characterMap.get(characterId)
      if (!character) return null
      return detectCharacterStateDrift(history, character.fullName)
    })
    .filter((item): item is CharacterStateDriftAlert => Boolean(item))
    .sort((left, right) => right.driftScore - left.driftScore || right.chapterNum - left.chapterNum)
    .slice(0, limit)
}

export function getCharacterStateContextHintMap(
  novelId: number,
  options: {
    upToChapterNum?: number
    mentionedNames?: Set<string>
    limit?: number
  } = {},
): Map<number, CharacterStateContextHint> {
  const latestStates = listLatestCharacterStates(novelId, options)
  const driftAlertMap = new Map(
    listNovelCharacterStateAlerts(novelId, latestStates.length || 6).map((alert) => [alert.characterId, alert]),
  )

  return new Map(latestStates.map((state) => {
    const driftAlert = driftAlertMap.get(state.characterId)
    return [
      state.characterId,
      {
        currentState: joinCompact([
          `第${state.chapterNum}章`,
          state.summaryText,
          state.changeReason && state.changeReason !== '延续前章状态，无新增显式变化'
            ? `变更=${state.changeReason}`
            : '',
        ], {
          maxLength: 104,
          perValueMaxLength: 44,
          limit: 3,
        }),
        currentGoal: asText(state.goalState),
        hardConstraint: buildStateConstraintSummary(state, driftAlert),
      },
    ] as const
  }))
}
