import type { Chapter } from '../../../types'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { parseDocument, recordOf } from './content-document'

export type StoryTimelineState = 'occurred' | 'planned' | 'unplaced'
export const STORY_TIMELINE_STATES: Record<StoryTimelineState, string> = { occurred: '已发生', planned: '计划', unplaced: '待定位' }
export const TIMELINE_CALENDARS: Record<string, string> = {
  gregorian: '公历', 'modern-date': '公历', regnal: '年号纪年', 'custom-era': '架空纪元',
  'relative-disaster': '相对时间', relative: '相对时间', 'future-date': '未来纪年',
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const nonnegativeInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
export function chapterHasProse(chapter: Chapter): boolean {
  return chapter.wordCount > 0 || Boolean(chapter.content?.trim())
}
export function chapterWritingLabel(chapter: Chapter): string {
  if (!chapterHasProse(chapter)) return '待写'
  return ({ final: '已定稿', reviewing: '审校中', writing: '写作中', draft: '已有初稿', outline: '已有正文' })[chapter.status]
}
/** Chapter numbers and database timestamps cannot stand in for fictional dates. */
export function storyTimeLabel(value: unknown): string {
  const label = text(value)
  return /^(?:第\s*[\d一二三四五六七八九十百零〇两]+\s*章|背景事件|待定时间|时间待定|尚未确定|待补充|未知|未定|待定)$/u.test(label) ? '' : label
}

export function storyTimelineClock(raw: string | undefined, chapters: Chapter[]) {
  const config = recordOf(recordOf(parseDocument(raw)).timelineConfig)
  const written = chapters.filter(chapterHasProse).sort((a, b) => a.chapterNum - b.chapterNum)
  const latest = written.at(-1)
  const recorded = storyTimeLabel(config.currentTimeLabel)
  const anchor = nonnegativeInt(config.currentTimeChapterNum)
  const evidence = text(config.currentTimeEvidence)
  return {
    written, latest, dynasty: text(config.dynastyName), epoch: text(config.epochLabel), era: text(config.eraName),
    calendar: TIMELINE_CALENDARS[text(config.calendarType)] || '',
    start: storyTimeLabel(config.storyStartLabel) || text(config.relativeZeroLabel), recorded, anchor,
    evidence,
    current: latest && anchor === latest.chapterNum && evidence ? recorded : '',
    needsAlignment: Boolean(recorded && (!latest || anchor !== latest.chapterNum || !evidence)),
  }
}

export interface StoryTimelineLink { entity: StoryAtlasEntity; planned: boolean; label: string }
export interface StoryTimelineEntry {
  entity: StoryAtlasEntity
  /** The saved atlas association can indicate when planning became available, not when it occurs. */
  recordedChapterNum: number | null
  planningKind: 'volume' | 'unit' | 'background' | 'other' | null
  plannedVolume: number | null
  chapterNum: number | null
  chapter: Chapter | null
  state: StoryTimelineState
  timeLabel: string
  timeSort: number | null
  timeBasis: 'relative' | 'date' | null
  sequenceInDay: number | null
  chronologyOrder: number | null
  listOrder: number | null
  calendarDay: string
  timeMode: string
  precision: string
  links: StoryTimelineLink[]
}

function authorPlanningKind(entity: StoryAtlasEntity): StoryTimelineEntry['planningKind'] {
  const type = text(entity.attributes.eventType)
  const explicitPlan = type === '叙事单元规划' || type === '短篇日常规划' || /^作者.*(?:规划|计划)$/u.test(type)
  const planned = entity.status === 'planned' || ['planned', 'seeded'].includes(text(entity.attributes.status))
  const authorOnly = entity.attributes.authorOnly === true || entity.attributes.doesNotRepresentReaderKnowledge === true
  // Visibility is not occurrence state: a hidden or unrevealed event can already have happened.
  if (!explicitPlan && !(authorOnly && planned)) return null
  if (type.includes('卷级')) return 'volume'
  if (type.includes('单元') || type === '短篇日常规划') return 'unit'
  if (/历史|年龄|纪年|出生/.test(type)) return 'background'
  return 'other'
}

function plannedVolume(entity: StoryAtlasEntity, kind: StoryTimelineEntry['planningKind']): number | null {
  const explicit = nonnegativeInt(entity.attributes.plannedVolume) ?? nonnegativeInt(entity.attributes.volumeNumber)
  if (explicit != null && explicit > 0) return explicit
  // This is the volume explicitly named by a volume planning record, not an inferred occurrence chapter/date.
  const named = kind === 'volume' ? /^第\s*(\d+)\s*卷/u.exec(entity.name) : null
  return named && Number(named[1]) > 0 ? Number(named[1]) : null
}

/** Only complete, validated Gregorian dates have a common sortable calendar basis. */
function calendarDate(label: string) {
  const normalized = label.replace(/年|月/g, '-').replace(/日/g, '').trim()
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(normalized)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const parsed = new Date(0)
  parsed.setUTCFullYear(year, month - 1, day)
  parsed.setUTCHours(0, 0, 0, 0)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null
  return { sort: parsed.getTime(), sequence: match[4] === undefined ? null : hour * 3600 + minute * 60 + (second || 0), label: `${year}年${month}月${day}日` }
}

function chapterAnchor(entity: StoryAtlasEntity, chapters: Chapter[]): number | null {
  const attributes = entity.attributes
  if (attributes.chapterStartId === null) return null
  if (attributes.chapterStartId != null) return chapters.find(chapter => chapter.id === Number(attributes.chapterStartId))?.chapterNum ?? null
  return nonnegativeInt(attributes.chapterNum)
}

function eventLinks(entity: StoryAtlasEntity, snapshot: StoryAtlasSnapshot): StoryTimelineLink[] {
  const links = new Map<string, StoryTimelineLink>()
  const add = (id: string, planned = false, label = '') => {
    const other = snapshot.entities.find(item => item.id === id)
    if (!other || !['character', 'location', 'faction'].includes(other.kind)) return
    const existing = links.get(id)
    if (!existing || existing.planned && !planned) links.set(id, { entity: other, planned: planned || other.status === 'planned', label })
  }
  const addReference = (kind: 'character' | 'location', value: unknown, label: string) => {
    if (typeof value !== 'number' && typeof value !== 'string') return
    const raw = String(value).trim()
    const id = raw.startsWith(`${kind}:`) ? raw : `${kind}:${raw}`
    const direct = snapshot.entities.find(item => item.kind === kind && item.id === id)
    if (direct) { add(direct.id, entity.status === 'planned', label); return }
    const nativeId = raw.replace(new RegExp(`^${kind}:`), '')
    if (!/^[1-9]\d*$/.test(nativeId)) return
    // The public snapshot has no native-ID map; only explicit migration provenance can resolve it.
    const table = kind === 'location' ? 'world_map' : 'characters'
    const matches = snapshot.entities.filter(item => item.kind === kind && item.source.kind === table && item.source.id === nativeId)
    if (matches.length === 1) add(matches[0].id, entity.status === 'planned', label)
  }
  for (const relation of snapshot.relations) {
    if (!['presence', 'participation'].includes(relation.kind)) continue
    const id = relation.fromId === entity.id ? relation.toId : relation.toId === entity.id ? relation.fromId : ''
    if (id) add(id, relation.status === 'planned', relation.kind === 'presence' ? '发生地点' : '参与')
  }
  // Imported data can have explicit references without graph edges.
  if (entity.attributes.locationMapId) addReference('location', entity.attributes.locationMapId, '发生地点')
  for (const field of ['presentCharacterIds', 'affectedCharacterIds']) {
    const raw = parseDocument(entity.attributes[field] ?? entity.attributes[`${field}Json`])
    if (Array.isArray(raw)) for (const id of raw) addReference('character', id, field === 'presentCharacterIds' ? '在场' : '受影响')
  }
  return [...links.values()]
}

export function buildStoryTimelineEntries(snapshot: StoryAtlasSnapshot, chapters: Chapter[]): StoryTimelineEntry[] {
  return snapshot.entities.filter(entity => entity.kind === 'event').map(entity => {
    const recordedChapterNum = chapterAnchor(entity, chapters)
    const planningKind = authorPlanningKind(entity)
    const chapterNum = planningKind ? null : recordedChapterNum
    const chapter = chapters.find(item => item.chapterNum === chapterNum) || null
    const status = text(entity.attributes.status)
    const isPlanned = Boolean(planningKind) || entity.status === 'planned' || ['planned', 'seeded'].includes(status)
    // Confirmed facts anchored to unwritten chapters are still future plans from the reader's position.
    const state: StoryTimelineState = isPlanned || chapterNum != null && chapterNum > 0 && (!chapter || !chapterHasProse(chapter)) ? 'planned'
      : chapter && chapterHasProse(chapter) || ['written', 'resolved'].includes(status) ? 'occurred' : 'unplaced'
    const timeLabel = storyTimeLabel(entity.attributes.timeLabel)
    const relativeDay = entity.attributes.relativeDay
    const hasRelativeDay = typeof relativeDay === 'number' && Number.isFinite(relativeDay)
    const timeMode = text(entity.attributes.timeMode)
    const date = !hasRelativeDay && ['gregorian', 'modern-date', 'future-date'].includes(timeMode) ? calendarDate(timeLabel) : null
    return { entity, chapterNum, recordedChapterNum, planningKind, plannedVolume: plannedVolume(entity, planningKind), chapter, state, timeLabel,
      timeSort: hasRelativeDay ? relativeDay : date?.sort ?? null,
      timeBasis: hasRelativeDay ? 'relative' : date ? 'date' : null,
      sequenceInDay: hasRelativeDay ? nonnegativeInt(entity.attributes.sequenceInDay) : date?.sequence ?? null,
      chronologyOrder: nonnegativeInt(entity.attributes.chronologyOrder) || null,
      listOrder: nonnegativeInt(entity.attributes.sortOrder),
      calendarDay: date?.label || '', timeMode, precision: text(entity.attributes.timePrecision), links: eventLinks(entity, snapshot) }
  })
}

export interface StoryTimelineGroup { key: string; title: string; chapter?: Chapter; planning?: boolean; entries: StoryTimelineEntry[] }
function compareChapterEvents(a: StoryTimelineEntry, b: StoryTimelineEntry): number {
  const keys = (entry: StoryTimelineEntry) => [
    entry.chronologyOrder ?? Infinity,
    entry.timeBasis === 'relative' ? 0 : entry.timeBasis === 'date' ? 1 : 2,
    entry.timeSort ?? Infinity, entry.sequenceInDay ?? Infinity, entry.listOrder ?? Infinity,
  ]
  const left = keys(a), right = keys(b)
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return a.entity.id.localeCompare(b.entity.id)
}
function authorPlanningGroups(entries: StoryTimelineEntry[]): StoryTimelineGroup[] {
  const kinds: Array<{ key: NonNullable<StoryTimelineEntry['planningKind']>; title: string }> = [
    { key: 'volume', title: '卷级时间规划' }, { key: 'unit', title: '单元规划' },
    { key: 'background', title: '背景与纪年规划' }, { key: 'other', title: '其他作者规划' },
  ]
  return kinds.flatMap(kind => {
    const rows = entries.filter(entry => entry.planningKind === kind.key)
    if (!rows.length) return []
    rows.sort((a, b) => {
      if (a.plannedVolume !== b.plannedVolume) return (a.plannedVolume ?? Infinity) - (b.plannedVolume ?? Infinity)
      // Custom calendar years are comparable only when the records explicitly use the same era.
      const leftEra = text(a.entity.attributes.calendarEra), rightEra = text(b.entity.attributes.calendarEra)
      const leftYear = nonnegativeInt(a.entity.attributes.calendarYear), rightYear = nonnegativeInt(b.entity.attributes.calendarYear)
      const leftHasCalendar = Boolean(leftEra && leftYear != null), rightHasCalendar = Boolean(rightEra && rightYear != null)
      if (leftHasCalendar !== rightHasCalendar) return leftHasCalendar ? -1 : 1
      if (leftHasCalendar && rightHasCalendar) {
        // Different era names are archive groups, never a claim about which calendar came first.
        if (leftEra !== rightEra) return leftEra.localeCompare(rightEra)
        if (leftYear !== rightYear) return leftYear! - rightYear!
      }
      return compareChapterEvents(a, b)
    })
    return [{ key: `planning:${kind.key}`, title: kind.title, planning: true, entries: rows }]
  })
}

export function storyTimelineMatchesSearch(entry: StoryTimelineEntry, keyword: string): boolean {
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
  return [entry.entity.id, entry.entity.name, entry.entity.summary, entry.timeLabel, ...entry.links.map(link => link.entity.name),
    ...strings(entry.entity.attributes)]
    .join(' ').toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())
}

export function storyTimelineGroups(allEntries: StoryTimelineEntry[], chapters: Chapter[], mode: 'chapter' | 'time', showEmptyChapters = false): StoryTimelineGroup[] {
  const entries = allEntries.filter(entry => !entry.planningKind)
  const planning = authorPlanningGroups(allEntries)
  if (mode === 'time') {
    // An evidenced sequence can include an uncertain night without assigning it a calendar day.
    const chronology = entries.filter(entry => entry.chronologyOrder != null).sort((a, b) => a.chronologyOrder! - b.chronologyOrder!)
    const groups = new Map<string, StoryTimelineGroup>()
    for (const entry of entries.filter(item => item.chronologyOrder == null)) {
      const key = entry.timeBasis ? `${entry.timeBasis}:${entry.timeSort}:${entry.sequenceInDay == null ? 'unordered' : 'ordered'}` : entry.timeLabel ? 'unordered' : 'undated'
      const relativeLabel = entry.timeSort === 0 ? '开篇当日' : `开篇${entry.timeSort! < 0 ? '前' : '后'} ${Math.abs(entry.timeSort!)} 天`
      const title = entry.timeBasis ? `${entry.timeBasis === 'relative' ? relativeLabel : entry.calendarDay}${entry.sequenceInDay == null ? ' · 日内顺序待定' : ''}` : key === 'unordered' ? '时间已描述 · 顺序待定' : '尚未确定故事时间'
      if (!groups.has(key)) groups.set(key, { key, title, entries: [] })
      groups.get(key)!.entries.push(entry)
    }
    const basisOrder = (entry: StoryTimelineEntry) => entry.timeBasis === 'relative' ? 0 : entry.timeBasis === 'date' ? 1 : 2
    const datedGroups = [...groups.values()].sort((a, b) => basisOrder(a.entries[0]) - basisOrder(b.entries[0]) || (a.entries[0].timeSort ?? Infinity) - (b.entries[0].timeSort ?? Infinity))
      .map(group => ({ ...group, entries: group.entries.sort((a, b) => (a.sequenceInDay ?? 0) - (b.sequenceInDay ?? 0)) }))
    return [...(chronology.length ? [{ key: 'chronology', title: '已知事件先后', entries: chronology }] : []), ...datedGroups, ...planning]
  }
  const byChapter = new Map<number | null, StoryTimelineEntry[]>()
  if (showEmptyChapters) for (const chapter of chapters) byChapter.set(chapter.chapterNum, [])
  for (const entry of entries) {
    if (!byChapter.has(entry.chapterNum)) byChapter.set(entry.chapterNum, [])
    byChapter.get(entry.chapterNum)!.push(entry)
  }
  return [...byChapter.entries()].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity)).map<StoryTimelineGroup>(([number, events]) => {
    const chapter = chapters.find(item => item.chapterNum === number)
    return { key: number == null ? 'unplaced' : `chapter:${number}`, title: number == null ? '章节待定位' : number === 0 ? '背景事件' : `第 ${number} 章${chapter?.title ? ` · ${chapter.title}` : ''}`, chapter, entries: events.sort(compareChapterEvents) }
  }).concat(planning)
}

export function timelineEntityRoute(entity: StoryAtlasEntity): string {
  const tab = { event: 'events', character: 'characters', location: 'map', faction: 'factions', item: 'items' }[entity.kind]
  const params = new URLSearchParams({ tab, entity: entity.id, includePlanned: 'true' })
  if (entity.kind === 'location' && entity.parentId) params.set('location', entity.parentId)
  return `narrative-board?${params}`
}

