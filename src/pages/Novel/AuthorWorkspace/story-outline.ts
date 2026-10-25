import type { Chapter, StoryStructureTree, StoryStructureVolumeView } from '../../../types'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
const isVolumeOutlinePlan = (entity: StoryAtlasEntity) => entity.kind === 'event' && entity.attributes.eventType === '卷级大纲规划' && entity.attributes.authorOnly === true
export const OUTLINE_LINES = ['A', 'B', 'C'] as const
export type OutlineLine = typeof OUTLINE_LINES[number]
export type OutlineVolume = {
  volume: StoryStructureVolumeView
  chapters: Chapter[]
  plan: StoryAtlasEntity | null
  lines: OutlineLine[]
  calendar: string
  region: string
  conflict: string
  emotion: string
  consequence: string
  pov: string
  truths: string[]
  clues: Array<{ id: string; action: string; meaning: string }>
  written: number
  start: number | null
  end: number | null
  clock: { era: string; year: number; month: number } | null
}

export function outlineChapterHasProse(chapter: Chapter) {
  return Boolean(chapter.content?.trim()) || (chapter.wordCount || 0) > 0
}

/** Join only explicit volume plans. A local event or a visibility chapter is not a volume outline. */
export function buildOutlineVolumes(tree: StoryStructureTree, snapshot: StoryAtlasSnapshot): OutlineVolume[] {
  const plans = snapshot.entities.filter(isVolumeOutlinePlan)
  return [...tree.volumes].sort((a, b) => a.volumeNumber - b.volumeNumber).map(volume => {
    const plan = plans.find(entity => Number(entity.attributes.volumeId) === volume.id)
      || plans.find(entity => entity.attributes.volumeId == null && Number(entity.attributes.plannedVolume) === volume.volumeNumber) || null
    const a = plan?.attributes || {}
    const chapters = volume.parts.flatMap(part => part.chapters).sort((left, right) => left.chapterNum - right.chapterNum)
    const year = positive(a.calendarYear), month = positive(a.calendarMonth), era = text(a.calendarEra)
    const truths = Array.isArray(a.truthAndMisread) ? a.truthAndMisread.map(text).filter(Boolean) : []
    const clues = Array.isArray(a.clues) ? a.clues.flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const clue = value as Record<string, unknown>
      return text(clue.meaning) ? [{ id: text(clue.clueId), action: text(clue.action), meaning: text(clue.meaning) }] : []
    }) : []
    return { volume, chapters, plan, lines: OUTLINE_LINES.filter(line => text(a.narrativeLine).includes(line)),
      calendar: text(a.timeLabel), region: text(a.region), conflict: text(a.coreConflict), emotion: text(a.emotionalArc),
      consequence: text(a.consequence), pov: text(a.povRule), truths, clues,
      written: chapters.filter(outlineChapterHasProse).length,
      start: chapters[0]?.chapterNum ?? null, end: chapters.at(-1)?.chapterNum ?? null,
      clock: era && year && month && month <= 12 ? { era, year, month } : null }
  })
}

/** Keep event deep links and their filters intact; only an unqualified visit selects the new overview. */
export function defaultTimelineView(params: URLSearchParams, snapshot: StoryAtlasSnapshot): 'volumes' | 'events' {
  if (params.get('view') === 'volumes') return 'volumes'
  if (params.size > 0) return 'events'
  return snapshot.entities.some(isVolumeOutlinePlan) ? 'volumes' : 'events'
}

export function outlineMatches(row: OutlineVolume, keyword: string) {
  const query = keyword.trim().toLocaleLowerCase()
  return !query || [row.volume.volumeNumber, row.volume.title, row.volume.summary, row.region, row.calendar,
    row.conflict, row.emotion, row.consequence, row.pov, ...row.truths, ...row.clues.map(clue => `${clue.id} ${clue.action} ${clue.meaning}`),
    ...row.chapters.map(chapter => `${chapter.chapterNum} ${chapter.title} ${chapter.outline}`)].join(' ').toLocaleLowerCase().includes(query)
}

export function outlineChapterMatches(chapter: Chapter, keyword: string) {
  const query = keyword.trim().toLocaleLowerCase()
  return !query || `${chapter.chapterNum} ${chapter.title} ${chapter.outline || ''}`.toLocaleLowerCase().includes(query)
}

export function outlineChapterRange(row: OutlineVolume) {
  return row.start == null ? '尚未分章' : row.start === row.end ? `第 ${row.start} 章` : `第 ${row.start}—${row.end} 章`
}

export function outlineLineLabel(rows: OutlineVolume[], line: OutlineLine) {
  for (const row of rows) {
    const labels = row.plan?.attributes.narrativeLineLabels
    if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
      const label = text((labels as Record<string, unknown>)[line])
      if (label) return `${line} · ${label}`
    }
  }
  return `${line} 线`
}

export function outlineTimelineGroups(rows: OutlineVolume[]) {
  const eras = [...new Set(rows.flatMap(row => row.clock ? [row.clock.era] : []))]
  const groups = new Map<string, { key: string; title: string; clock: OutlineVolume['clock']; rows: OutlineVolume[] }>()
  for (const row of rows) {
    const clock = row.clock
    const key = clock ? `${clock.era}:${clock.year}:${clock.month}` : 'unplaced'
    const group = groups.get(key) || { key, title: clock ? `${clock.era}${clock.year}年 · ${clock.month}月` : '起始年月待确定', clock, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  // Explicit starting months are comparable within the same era. Never turn volume order into elapsed time.
  return [...groups.values()].sort((a, b) => !a.clock ? 1 : !b.clock ? -1 : eras.indexOf(a.clock.era) - eras.indexOf(b.clock.era) || a.clock.year - b.clock.year || a.clock.month - b.clock.month)
}
