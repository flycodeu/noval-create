import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { AtlasFields } from './AtlasFields'
import { atlasEntityMatchesSearch, atlasEntitySummary, atlasFieldLabel, atlasLinks, atlasLocationScope, atlasRegionLinks, atlasScalarText, profileFieldGroups, resolveAtlasTab } from './atlas-profile'

const entity = (id: string, kind: StoryAtlasEntity['kind'], name: string, attributes: Record<string, unknown> = {}): StoryAtlasEntity => ({ id, kind, name, attributes, summary: '', parentId: null, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
describe('atlas dossiers', () => {
  it('shows the character description while retaining private author instructions separately', () => {
    const character = { ...entity('character:1', 'character', '阿烛', { publicSummary: '寄居旧灯的灯蛾。', authorOnly: true }), summary: '首案不得提前揭露旧案。' }
    expect(atlasEntitySummary(character)).toBe('寄居旧灯的灯蛾。')
    expect(character.summary).toBe('首案不得提前揭露旧案。')
    expect(profileFieldGroups(character).some(group => 'publicSummary' in group.values || 'authorOnly' in group.values)).toBe(false)
  })
  it('finds the description shown on character cards while keeping names and author notes searchable', () => {
    const character = { ...entity('character:1', 'character', '阿烛', { publicSummary: '寄居旧灯的灯蛾，别称 Azhu。' }), summary: '首案不得提前揭露旧案。' }
    expect(atlasEntityMatchesSearch(character, '  灯蛾  ')).toBe(true)
    expect(atlasEntityMatchesSearch(character, 'AZHU')).toBe(true)
    expect(atlasEntityMatchesSearch(character, '阿烛')).toBe(true)
    expect(atlasEntityMatchesSearch(character, '旧案')).toBe(true)
    expect(atlasEntityMatchesSearch(character, '魏铎')).toBe(false)
    expect(atlasEntityMatchesSearch({ ...entity('location:1', 'location', '客栈'), summary: '临水建成' }, '临水')).toBe(true)
  })
  it('does not keep a region filter that is absent at the selected chapter', () => {
    const region = entity('location:1', 'location', '白茅镇')
    const character = entity('character:1', 'character', '陆闻')
    const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: 3, locationChildren: [], diagnostics: [], entities: [region, character], relations: [] }
    expect(atlasLocationScope(snapshot, region.id)).toBe(region.id)
    expect(atlasLocationScope({ ...snapshot, atChapter: 1, entities: [character] }, region.id)).toBeNull()
    expect(atlasLocationScope(snapshot, character.id)).toBeNull()
    expect(atlasLocationScope(snapshot, null)).toBeNull()
  })
  it('keeps distinct area roles and descendant locations without duplicate region links', () => {
    const region = entity('location:1', 'location', '白茅镇')
    const inn = { ...entity('location:2', 'location', '借灯客栈'), parentId: region.id }
    const unrelated = entity('location:3', 'location', '芦渡')
    const character = entity('character:1', 'character', '陆闻')
    const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: 3, locationChildren: [], diagnostics: [], entities: [region, inn, unrelated, character], relations: [
      { id: 'presence:1', kind: 'presence', fromId: character.id, toId: region.id, label: '活动', attributes: { locationRole: 'activity' }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
      { id: 'presence:2', kind: 'presence', fromId: character.id, toId: inn.id, label: '活动', attributes: { locationRole: 'activity' }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
      { id: 'presence:3', kind: 'presence', fromId: character.id, toId: inn.id, label: '活动区域', attributes: { locationRole: 'activity' }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
      { id: 'presence:4', kind: 'presence', fromId: character.id, toId: inn.id, label: '住宿', attributes: { locationRole: 'residence' }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
      { id: 'presence:5', kind: 'presence', fromId: character.id, toId: unrelated.id, label: '活动', attributes: { locationRole: 'activity' }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
    ] }
    const links = atlasRegionLinks(snapshot, region)
    expect(links.map(link => link.label)).toEqual(['活动区域', '活动区域 · 借灯客栈', '居住地 · 借灯客栈'])
    expect(links.map(link => link.relation?.id)).toEqual(['presence:1', 'presence:2', 'presence:4'])
    expect(atlasRegionLinks({ ...snapshot, entities: [inn, region, unrelated, character] }, region).map(link => link.label).sort()).toEqual(links.map(link => link.label).sort())
  })
  it('keeps old links in the relevant new section', () => {
    expect(resolveAtlasTab(new URLSearchParams('view=characters&kind=character'))).toBe('characters')
    expect(resolveAtlasTab(new URLSearchParams('view=characters'))).toBe('relationships')
    expect(resolveAtlasTab(new URLSearchParams('kind=faction'))).toBe('factions')
    expect(resolveAtlasTab(new URLSearchParams('kind=item'))).toBe('items')
    expect(resolveAtlasTab(new URLSearchParams('kind=event'))).toBe('events')
  })
  it('renders saved references by their typed names and omits empty fields and migration metadata', () => {
    const entities = [entity('faction:7', 'faction', '渡务会'), entity('character:7', 'character', '同号人物')]
    const html = renderToStaticMarkup(React.createElement(AtlasFields, { values: { campFactionIds: [7], personalityTraits: [], flaws: '', sortOrder: 0, sourceType: 'legacy_json', notes: '这是一段很长的作者说明。'.repeat(80) }, entities, chapters: [] }))
    expect(html).toContain('所属组织')
    expect(html).toContain('渡务会')
    expect(html).not.toContain('同号人物')
    expect(html).not.toContain('campFactionIds')
    expect(html).not.toContain('性格特点')
    expect(html).not.toContain('legacy_json')
    expect(html).toContain('这是一段很长的作者说明。'.repeat(80))
    expect(atlasScalarText('campFactionIds', 88, entities, [])).toBe('关联资料在当前章位不可用')
  })
  it('consolidates missing profile data into groups without deleting meaningful zero or false values', () => {
    const groups = profileFieldGroups(entity('character:1', 'character', '陆闻', { personalityTraits: [], flaws: '', campFactionIds: [], sourceContext: { imported: true }, sortOrder: 0 }))
    expect(groups).toHaveLength(4)
    expect(groups.every(group => Object.keys(group.values).length === 0)).toBe(true)
    expect(atlasFieldLabel('dailyRoutine')).toBe('职业日常')
    expect(atlasScalarText('routeOpen', false, [], [])).toBe('否')
  })
  it('reads current and planned membership only from recorded relations, not vacant positions or legacy IDs', () => {
    const faction = entity('faction:1', 'faction', '渡务会', { positions: [{ id: 'chair', title: '会首', status: 'planned' }] })
    const current = entity('character:1', 'character', '陈舟')
    const planned = { ...entity('character:2', 'character', '林禾'), status: 'planned' as const }
    const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: null, locationChildren: [], diagnostics: [], entities: [faction, current, planned], relations: [
      { id: 'membership:1', kind: 'membership', fromId: current.id, toId: faction.id, label: '成员', attributes: {}, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
      { id: 'membership:2', kind: 'membership', fromId: planned.id, toId: faction.id, label: '拟任', attributes: { positionId: 'chair' }, status: 'planned', effectiveFromChapter: 0, source: { kind: 'test' } },
    ] }
    expect(atlasLinks(snapshot, faction, 'character').map(link => [link.entity.name, link.planned])).toEqual([['陈舟', false], ['林禾', true]])
    expect(atlasLinks({ ...snapshot, relations: [] }, { ...current, attributes: { campFactionIds: [1] } })).toEqual([])
    expect(atlasScalarText('positionId', 'chair', [], [], [{ id: 'chair', title: '会首' }])).toBe('会首')
  })
  it('keeps native item and event references readable without exposing technical pointer records', () => {
    const entities = [entity('character:313', 'character', '陆闻')]
    const html = renderToStaticMarkup(React.createElement(AtlasFields, { values: { linkedCharacterIds: [313], chapterStartId: 684, status: 'written', typedRefs: { pointers: [{ assetType: 'character', id: 313, confidence: 1 }], version: 1 }, timeMode: 'custom-era', partId: 162 }, entities, chapters: [{ id: 684, chapterNum: 3 }] }))
    expect(html).toContain('陆闻')
    expect(html).toContain('第 3 章')
    expect(html).toContain('已写定')
    expect(html).not.toContain('313')
    expect(html).not.toContain('custom-era')
    expect(html).not.toContain('character')
  })
})
