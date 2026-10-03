import { describe, expect, it } from 'vitest'
import type { Chapter } from '../../../types'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { buildStoryTimelineEntries, chapterHasProse, storyTimeLabel, storyTimelineClock, storyTimelineGroups, timelineEntityRoute } from './story-timeline'

function chapter(number: number, words = 0): Chapter {
  return { id: number + 100, novelId: 1, chapterNum: number, title: `章 ${number}`, wordCount: words, targetWords: 3000, status: words ? 'draft' : 'outline', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
}
function event(id: string, chapterNum: number, attributes: Record<string, unknown> = {}, status: 'confirmed' | 'planned' = 'confirmed'): StoryAtlasEntity {
  return { id, kind: 'event', name: id, summary: '', parentId: null, attributes, status, effectiveFromChapter: chapterNum, source: { kind: 'test' } }
}
function atlas(entities: StoryAtlasEntity[], relations: StoryAtlasSnapshot['relations'] = []): StoryAtlasSnapshot {
  return { novelId: 1, contextVersion: 1, atChapter: null, entities, relations, locationChildren: [], diagnostics: [] }
}

describe('story timeline evidence boundaries', () => {
  it('only shows current time when the explicit anchor matches the latest written chapter', () => {
    const chapters = [chapter(1, 2100), chapter(2, 2400), chapter(3)]
    const raw = JSON.stringify({ timelineConfig: { dynastyName: '景朝', currentTimeLabel: '开篇第二日午后', currentTimeChapterNum: 2, currentTimeEvidence: '日影已偏西。' } })
    expect(storyTimelineClock(raw, chapters).current).toBe('开篇第二日午后')
    const outdated = storyTimelineClock(raw, [...chapters.slice(0, 2), chapter(3, 2000)])
    expect(outdated.current).toBe('')
    expect(outdated.needsAlignment).toBe(true)
    expect(outdated.recorded).toBe('开篇第二日午后')
    expect(outdated.latest?.chapterNum).toBe(3)
  })
  it('keeps an old epoch distinct from dynasty and does not synthesize current time', () => {
    const clock = storyTimelineClock(JSON.stringify({ timelineConfig: { epochLabel: '景朝', eraName: '年号未定', relativeZeroLabel: '到白茅镇之日' }, createdAt: '2026-10-03' }), [chapter(1, 1000)])
    expect(clock.dynasty).toBe('')
    expect(clock.epoch).toBe('景朝')
    expect(clock.start).toBe('到白茅镇之日')
    expect(clock.current).toBe('')
    expect(clock.recorded).toBe('')
  })
  it('keeps an aligned label as a last record until its time evidence is supplied', () => {
    const clock = storyTimelineClock(JSON.stringify({ timelineConfig: { currentTimeLabel: '次日黄昏', currentTimeChapterNum: 3 } }), [chapter(3, 2000)])
    expect(clock.current).toBe('')
    expect(clock.needsAlignment).toBe(true)
    expect(clock.recorded).toBe('次日黄昏')
  })
  it('does not present chapter labels or storage placeholders as fictional dates', () => {
    for (const label of ['第 3 章', '第三章', '背景事件', '待定时间', '时间待定']) expect(storyTimeLabel(label)).toBe('')
    expect(storyTimeLabel('十八年前洪灾之夜')).toBe('十八年前洪灾之夜')
    expect(chapterHasProse({ ...chapter(2), content: '已有正文' })).toBe(true)
  })
  it('distinguishes recorded events, future plans and facts that still need an occurrence anchor', () => {
    const snapshot = atlas([
      event('event:written', 1), event('event:future', 2), event('event:planned', 1, {}, 'planned'),
      event('event:seeded', 1, { status: 'seeded' }), event('event:historic', 0, { timeLabel: '十八年前' }),
      event('event:missing-chapter', 1, { chapterStartId: 999 }),
    ])
    const entries = buildStoryTimelineEntries(snapshot, [chapter(1, 1000), chapter(2)])
    expect(entries.map(item => item.state)).toEqual(['occurred', 'planned', 'planned', 'planned', 'unplaced', 'unplaced'])
    expect(entries.at(-1)?.chapterNum).toBeNull()
  })
  it('reads explicit event links and deduplicates migrated character references', () => {
    const character = { ...event('character:7', 0), name: '陆闻', kind: 'character' as const }
    const location = { ...event('location:4', 0), name: '借灯客栈', kind: 'location' as const }
    const item = event('event:1', 1, { locationMapId: 4, presentCharacterIds: [7, 7] })
    const snapshot = atlas([item, character, location], [{ id: 'participation:1', kind: 'participation', fromId: character.id, toId: item.id, label: '参与', attributes: {}, status: 'confirmed', effectiveFromChapter: 1, source: { kind: 'test' } }])
    const entries = buildStoryTimelineEntries(snapshot, [chapter(1, 1000)])
    expect(entries[0].links.map(link => link.entity.name)).toEqual(['陆闻', '借灯客栈'])
    expect(timelineEntityRoute({ ...location, parentId: 'location:1' })).toContain('location=location%3A1')
    expect(timelineEntityRoute(character)).toContain('includePlanned=true')
  })
  it('keeps an already-qualified location UUID intact when the event has no presence edge', () => {
    const location = { ...event('location:bf42e574-1317-4477-a257-3cabcfa93c2e', 0), name: '客栈前堂', kind: 'location' as const }
    const entries = buildStoryTimelineEntries(atlas([event('event:1', 1, { locationMapId: location.id }), location]), [chapter(1, 1000)])
    expect(entries[0].links.map(link => link.entity.id)).toEqual([location.id])
  })
  it('maps native references to UUIDs only with unique explicit migration provenance', () => {
    const location = { ...event('location:imported-room', 0), name: '前堂', kind: 'location' as const, source: { kind: 'world_map', id: '44' } }
    const character = { ...event('character:imported-person', 0), name: '陆闻', kind: 'character' as const, source: { kind: 'characters', id: '7' } }
    const item = event('event:1', 1, { locationMapId: 44, presentCharacterIds: [7] })
    expect(buildStoryTimelineEntries(atlas([item, location, character]), [chapter(1, 1000)])[0].links.map(link => link.entity.id)).toEqual([location.id, character.id])
    const noProvenance = { ...location, source: { kind: 'creative_run', id: '44' } }
    expect(buildStoryTimelineEntries(atlas([item, noProvenance]), [chapter(1, 1000)])[0].links).toEqual([])
    expect(buildStoryTimelineEntries(atlas([item, location, { ...location, id: 'location:ambiguous' }]), [chapter(1, 1000)])[0].links).toEqual([])
  })
  it('uses relative days and explicit within-day order while isolating uncertain entries', () => {
    const entries = buildStoryTimelineEntries(atlas([
      event('event:b', 1, { timeMode: 'relative', timeLabel: '次日夜', relativeDay: 1, sequenceInDay: 2, timeSortValue: 0 }),
      event('event:a', 1, { timeMode: 'relative', timeLabel: '次日午后', relativeDay: 1, sequenceInDay: 1, timeSortValue: 100 }),
      event('event:uncertain', 1, { timeLabel: '次日某时', relativeDay: 1 }),
      event('event:earlier', 1, { timeLabel: '开篇前夜', relativeDay: -1, sequenceInDay: 0 }),
      event('event:undated', 1, { timeLabel: '第1章', timeSortValue: 1 }),
      event('event:ambiguous', 1, { timeLabel: '许多年前' }),
    ]), [chapter(1, 1000)])
    const groups = storyTimelineGroups(entries, [], 'time')
    expect(groups[0].entries[0].entity.id).toBe('event:earlier')
    expect(groups.find(group => group.key === 'relative:1:ordered')?.entries.map(entry => entry.entity.id)).toEqual(['event:a', 'event:b'])
    expect(groups.find(group => group.key === 'relative:1:unordered')?.title).toContain('日内顺序待定')
    expect(groups.find(group => group.key === 'undated')?.entries[0].entity.id).toBe('event:undated')
    expect(groups.find(group => group.key === 'unordered')?.entries[0].entity.id).toBe('event:ambiguous')
  })
  it('does not mistake the shared chapter number on legacy events 80 and 81 for a temporal sequence', () => {
    const entries = buildStoryTimelineEntries(atlas([
      event('event:80', 3, { timeMode: 'custom-era', timeLabel: '对账时', timeSortValue: 3, sortOrder: 4 }),
      event('event:81', 3, { timeMode: 'custom-era', timeLabel: '走查时', timeSortValue: 3, sortOrder: 5 }),
    ]), [chapter(3, 1000)])
    expect(entries.every(entry => entry.timeSort === null)).toBe(true)
    const groups = storyTimelineGroups(entries, [], 'time')
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('时间已描述 · 顺序待定')
    expect(storyTimelineGroups(entries, [chapter(3, 1000)], 'chapter')[0].entries.map(entry => entry.entity.id)).toEqual(['event:80', 'event:81'])
  })
  it('sorts complete valid dates but refuses year-only, impossible dates and arbitrary date guessing', () => {
    const entries = buildStoryTimelineEntries(atlas([
      event('event:late', 1, { timeMode: 'gregorian', timeLabel: '2024-02-29 18:00', timeSortValue: 1 }),
      event('event:early', 1, { timeMode: 'gregorian', timeLabel: '2024年2月29日 09:00', timeSortValue: 999 }),
      event('event:day-only', 1, { timeMode: 'gregorian', timeLabel: '2024-02-29' }),
      event('event:year', 1, { timeMode: 'gregorian', timeLabel: '2024年', timeSortValue: 1 }),
      event('event:impossible', 1, { timeMode: 'gregorian', timeLabel: '2023-02-29', timeSortValue: 1 }),
      event('event:regnal', 1, { timeMode: 'regnal', timeLabel: '景平元年二月初一', timeSortValue: 1 }),
    ]), [chapter(1, 1000)])
    const groups = storyTimelineGroups(entries, [], 'time')
    expect(groups.find(group => group.key.endsWith(':ordered'))?.entries.map(entry => entry.entity.id)).toEqual(['event:early', 'event:late'])
    expect(groups.find(group => group.key.startsWith('date:') && group.key.endsWith(':unordered'))?.title).toContain('日内顺序待定')
    expect(groups.find(group => group.key === 'unordered')?.entries.map(entry => entry.entity.id)).toEqual(['event:year', 'event:impossible', 'event:regnal'])
  })
  it('keeps unwritten chapters visible without inventing events for them', () => {
    const chapters = [chapter(1, 1000), chapter(2)]
    const groups = storyTimelineGroups([], chapters, 'chapter', true)
    expect(groups.map(group => group.chapter?.chapterNum)).toEqual([1, 2])
    expect(groups.every(group => group.entries.length === 0)).toBe(true)
  })
})
