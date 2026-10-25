import { describe, expect, it } from 'vitest'
import type { Chapter, StoryStructureTree } from '../../../types'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { buildOutlineVolumes, defaultTimelineView, outlineChapterHasProse, outlineChapterMatches, outlineMatches, outlineTimelineGroups } from './story-outline'
import { buildStoryTimelineEntries } from './story-timeline'

function chapter(num: number, prose = false): Chapter {
  return { id: num + 100, novelId: 1, chapterNum: num, title: `第 ${num} 章`, outline: num === 15 ? '纸姑拒绝为契纸作伪证' : '出发', wordCount: prose ? 1200 : 0, status: prose ? 'draft' : 'outline', targetWords: 3000, createdAt: '', updatedAt: '' }
}
function tree(): StoryStructureTree {
  return { novelId: 1, volumes: [1, 2, 3].map(n => ({ id: n + 200, novelId: 1, volumeNumber: n, title: `卷 ${n}`, summary: '', targetWords: 0, status: 'planning', createdAt: '', updatedAt: '', chapterCount: 10, wordCount: 0, segmentCount: 0,
    parts: [{ id: n + 300, novelId: 1, volumeId: n + 200, partNumber: 1, title: '', summary: '', targetWords: 0, status: 'planning', createdAt: '', updatedAt: '', wordCount: 0, segmentCount: 0, chapters: Array.from({ length: 10 }, (_, i) => ({ ...chapter((n - 1) * 10 + i + 1, n === 1 && i === 0), segments: [] })) }] })) }
}
function plan(number: number, attributes: Record<string, unknown> = {}): StoryAtlasEntity {
  return { id: `event:${number}`, kind: 'event', name: `卷${number}规划`, summary: '', parentId: null, status: 'planned', effectiveFromChapter: 7, source: { kind: 'test' }, attributes: { eventType: '卷级大纲规划', authorOnly: true, volumeId: 200 + number, plannedVolume: number, chapterStartId: 100 + (number - 1) * 10 + 1, narrativeLine: number === 1 ? 'A' : number === 2 ? 'B' : 'ABC', timeLabel: '承宁二十四年三月上旬', calendarEra: '承宁', calendarYear: 24, calendarMonth: number === 2 ? 3 : number === 1 ? 4 : 3, ...attributes } }
}
function atlas(entities: StoryAtlasEntity[]): StoryAtlasSnapshot {
  return { novelId: 1, contextVersion: 1, atChapter: null, entities, relations: [], locationChildren: [], diagnostics: [] }
}

describe('full outline and volume chronology', () => {
  it('defaults to the whole-book timeline only for an unqualified visit with explicit volume outline records', () => {
    expect(defaultTimelineView(new URLSearchParams(), atlas([plan(1)]))).toBe('volumes')
    expect(defaultTimelineView(new URLSearchParams(), atlas([]))).toBe('events')
    expect(defaultTimelineView(new URLSearchParams(), atlas([plan(1, { eventType: '作者卷级时间规划' })]))).toBe('events')
    for (const query of ['view=chapter', 'view=time', 'event=event%3A1', 'chapter=7', 'status=planned', 'q=旧灯']) {
      expect(defaultTimelineView(new URLSearchParams(query), atlas([plan(1)]))).toBe('events')
    }
    expect(defaultTimelineView(new URLSearchParams('view=volumes'), atlas([]))).toBe('volumes')
  })
  it('joins formal volume IDs and actual chapters without assigning plans to prose progress', () => {
    const rows = buildOutlineVolumes(tree(), atlas([plan(1), plan(2), plan(3)]))
    expect(rows.reduce((n, row) => n + row.chapters.length, 0)).toBe(30)
    expect(rows[0].written).toBe(1)
    expect(rows[1].written).toBe(0)
    expect(rows[1].start).toBe(11)
    expect(rows[2].lines).toEqual(['A', 'B', 'C'])
    expect(outlineChapterHasProse({ ...chapter(1), content: '正文', wordCount: 0 })).toBe(true)
    expect(buildStoryTimelineEntries(atlas([plan(1)]), [chapter(1, true)])[0]).toMatchObject({ planningKind: 'volume', chapterNum: null, state: 'planned' })
  })
  it('finds chapter details and clue meanings, not just volume titles', () => {
    const rows = buildOutlineVolumes(tree(), atlas([plan(2, { clues: [{ clueId: 'LAMP', action: '回收', meaning: '旧灯修补材料的来路' }] })]))
    expect(outlineMatches(rows[1], '作伪证')).toBe(true)
    expect(outlineMatches(rows[1], '修补材料')).toBe(true)
    expect(outlineChapterMatches(rows[1].chapters[4], '纸姑')).toBe(true)
    expect(outlineMatches(rows[0], '修补材料')).toBe(false)
  })
  it('groups by saved start months so later narrated flashbacks appear in the earlier month', () => {
    const rows = buildOutlineVolumes(tree(), atlas([plan(1), plan(2), plan(3)]))
    const groups = outlineTimelineGroups(rows)
    expect(groups.map(group => group.clock?.month)).toEqual([3, 4])
    expect(groups[0].rows.map(row => row.volume.volumeNumber)).toEqual([2, 3])
    expect(groups.flatMap(group => group.rows).length).toBe(3)
  })
  it('keeps unknown or invalid dates unplaced and does not infer chronology from visibility or volume numbers', () => {
    const rows = buildOutlineVolumes(tree(), atlas([plan(1, { calendarMonth: 13 }), plan(2, { calendarYear: null }), plan(3)]))
    const groups = outlineTimelineGroups(rows)
    expect(groups.at(-1)?.key).toBe('unplaced')
    expect(groups.at(-1)?.rows.map(row => row.volume.volumeNumber)).toEqual([1, 2])
  })
  it('does not take a unit plan or an event with a mismatched stable volume ID as the volume plan', () => {
    const rows = buildOutlineVolumes(tree(), atlas([plan(1, { eventType: '叙事单元规划' }), plan(2, { volumeId: 999, plannedVolume: 2 })]))
    expect(rows.every(row => row.plan === null)).toBe(true)
    expect(rows[1].chapters.length).toBe(10)
  })
})
