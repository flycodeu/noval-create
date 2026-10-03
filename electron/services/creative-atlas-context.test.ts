import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasRelation } from '../../src/shared/story-atlas'
import { creativeAtlasCoverage, creativePublicAttributes, selectChapterAtlasIntroductions, selectCreativeAssetAtlas, selectCreativeAtlas } from './creative-atlas-context'

const entity = (id: string, kind: StoryAtlasEntity['kind'], name: string, parentId: string | null = null, attributes = {}): StoryAtlasEntity =>
  ({ id, kind, name, parentId, attributes, summary: '', status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
const edge = (id: string, kind: StoryAtlasRelation['kind'], fromId: string, toId: string, attributes = {}): StoryAtlasRelation =>
  ({ id, kind, fromId, toId, attributes, label: id, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
const fixture = () => ({ entities: [
  entity('character:1', 'character', '陈舟', null, { roleType: 'protagonist' }), entity('character:2', 'character', '周河'),
  entity('location:1', 'location', '南岭'), entity('location:2', 'location', '河村', 'location:1'),
  entity('location:3', 'location', '东岸'), entity('location:4', 'location', '远港', 'location:3'),
  entity('location:5', 'location', '域外'),
  entity('faction:1', 'faction', '水务会'), entity('faction:2', 'faction', '巡河部', 'faction:1'),
], relations: [
  edge('home', 'presence', 'character:1', 'location:2', { locationRole: 'residence' }),
  edge('job', 'membership', 'character:1', 'faction:2', { positionId: 'inspector' }),
  edge('other-worker', 'membership', 'character:2', 'faction:2'),
  edge('headquarters', 'presence', 'faction:1', 'location:2', { locationRole: 'headquarters' }),
  edge('cross-region', 'route', 'location:2', 'location:4', { travelHours: 6 }),
  edge('distant-route', 'route', 'location:4', 'location:5'),
] })

describe('saved atlas dependencies for creative context', () => {
  it('includes sibling borders as map constraints without expanding their residents or applying that rule to events', () => {
    const atlas = fixture()
    atlas.entities.push(entity('location:6', 'location', '北城', 'location:1', { geography: { boundary: [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] } }))
    atlas.relations.push(edge('north-resident', 'presence', 'character:2', 'location:6'))
    const selected = selectCreativeAssetAtlas(atlas, { stage: 'map', request: '重新设计河村的边界' })
    expect(selected.entityIds.has('location:6')).toBe(true)
    expect(selected.constraintEntityIds).toEqual(new Set(['location:6']))
    expect(selected.entityIds.has('character:2')).toBe(false)
    expect(selected.relationIds.has('north-resident')).toBe(false)
    expect(selectCreativeAssetAtlas(atlas, { stage: 'events', request: '梳理河村的事件' }).entityIds.has('location:6')).toBe(false)
  })
  it('keeps named map targets, immediate subdivisions and routes without importing resident relationships or chapter people', () => {
    const atlas = fixture()
    atlas.relations.push(edge('bond', 'relationship', 'character:1', 'character:2'))
    const selected = selectCreativeAssetAtlas(atlas, { stage: 'map', request: '划分南岭的地区', anchorText: '陈舟和周河在远港交谈' })
    for (const id of ['location:1', 'location:2', 'location:3', 'location:4']) expect(selected.entityIds.has(id)).toBe(true)
    for (const id of ['character:1', 'character:2', 'faction:1', 'faction:2', 'location:5']) expect(selected.entityIds.has(id)).toBe(false)
    expect(selected.relationIds).toEqual(new Set(['cross-region']))
  })
  it('keeps a named participant and their place for an asset task without following their whole organization', () => {
    const selected = selectCreativeAssetAtlas(fixture(), { stage: 'map', request: '完善陈舟常住地区的地图' })
    for (const id of ['character:1', 'location:1', 'location:2', 'location:3', 'location:4']) expect(selected.entityIds.has(id)).toBe(true)
    expect(selected.entityIds.has('faction:2')).toBe(false)
    expect(selected.relationIds).toEqual(new Set(['home', 'cross-region']))
  })
  it('keeps actual event participants and places but does not expand character bonds during timeline design', () => {
    const atlas = fixture()
    atlas.entities.push(entity('event:1', 'event', '渡口火情'))
    atlas.relations.push(edge('attend', 'participation', 'character:1', 'event:1'), edge('site', 'presence', 'event:1', 'location:2'), edge('bond', 'relationship', 'character:1', 'character:2'))
    const selected = selectCreativeAssetAtlas(atlas, { stage: 'events', request: '梳理渡口火情的时间' })
    for (const id of ['event:1', 'character:1', 'location:1', 'location:2', 'location:3', 'location:4']) expect(selected.entityIds.has(id)).toBe(true)
    expect(selected.entityIds.has('character:2')).toBe(false)
    expect(selected.relationIds.has('attend')).toBe(true)
    expect(selected.relationIds.has('job')).toBe(false)
    expect(selected.relationIds.has('bond')).toBe(false)
  })
  it('resolves a real protagonist, home, organization ancestors and one route hop without expanding the whole roster or world', () => {
    const selected = selectCreativeAtlas(fixture(), { request: '继续主角本章，遵守活动地域和职业。' })
    for (const id of ['character:1', 'location:1', 'location:2', 'location:3', 'location:4', 'faction:1', 'faction:2']) expect(selected.entityIds.has(id)).toBe(true)
    expect(selected.entityIds.has('character:2')).toBe(false)
    expect(selected.entityIds.has('location:5')).toBe(false)
    expect(selected.relationIds.has('cross-region')).toBe(true)
    expect(selected.relationIds.has('distant-route')).toBe(false)
  })
  it('anchors an ordinary unnamed request to the current scene and keeps a one-character POV name explicit', () => {
    const atlas = fixture()
    atlas.entities.push(entity('character:3', 'character', '何'))
    const selected = selectCreativeAtlas(atlas, { request: '继续本章。', anchorText: '河村检查缆绳', povNames: ['何'] })
    expect(selected.seedIds.has('location:2')).toBe(true)
    expect(selected.seedIds.has('character:3')).toBe(true)
  })
  it('uses existing previous context when no target anchor exists and never infers a new protagonist', () => {
    const atlas = fixture(); atlas.entities[0].attributes = {}
    expect(selectCreativeAtlas(atlas, { request: '继续', fallbackText: '周河离开东岸' }).seedIds).toEqual(new Set(['character:2', 'location:3']))
    expect(selectCreativeAtlas(atlas, { request: '优化主角' }).seedIds.size).toBe(0)
  })
  it('matches complete stable IDs instead of overlapping numeric prefixes', () => {
    const atlas = fixture(); atlas.entities.push(entity('character:10', 'character', '徐帆'))
    expect(selectCreativeAtlas(atlas, { request: '修改 character:10 的档案' }).seedIds).toEqual(new Set(['character:10']))
  })
  it('introduces only explicitly anchored new entities and the necessary parent locations', () => {
    const before = fixture()
    const newcomers = [
      entity('character:3', 'character', '赵砚'), entity('character:4', 'character', '未出场伙计'),
      entity('location:6', 'location', '石桥镇', 'location:1'), entity('location:7', 'location', '木料铺', 'location:6'),
    ].map(value => ({ ...value, effectiveFromChapter: 2 }))
    const current = { entities: [...before.entities.map(value => ({ ...value, summary: '本章末才改变的旧资料', effectiveFromChapter: 2 })), ...newcomers], relations: [] }
    const selected = selectChapterAtlasIntroductions(before, current, { chapterNum: 2, request: '赵砚初次登场', anchorText: '陈舟走到木料铺', povNames: ['陈舟'] })
    expect(selected.entities.map(value => value.id)).toEqual(['character:3', 'location:6', 'location:7'])
    expect(selected.previousParentIds).toEqual(new Set(['location:1']))
    expect(selected.entities.some(value => value.summary.includes('本章末'))).toBe(false)
  })
  it('does not infer introductions from protagonist defaults and rejects future, planned, hidden and event records', () => {
    const before = fixture()
    const additions: StoryAtlasEntity[] = [
      { ...entity('character:new', 'character', '新主角', null, { roleType: 'protagonist' }), effectiveFromChapter: 2 },
      { ...entity('character:future', 'character', '后续访客'), effectiveFromChapter: 3 },
      { ...entity('character:planned', 'character', '候选伙计'), effectiveFromChapter: 2, status: 'planned' },
      { ...entity('character:author', 'character', '幕后访客', null, { authorOnly: true }), effectiveFromChapter: 2 },
      { ...entity('character:hidden', 'character', '未来访客', null, { futureOnly: true }), effectiveFromChapter: 2 },
      { ...entity('event:new', 'event', '本章洪水'), effectiveFromChapter: 2 },
    ]
    const current = { entities: [...before.entities, ...additions], relations: [] }
    expect(selectChapterAtlasIntroductions(before, current, { chapterNum: 2, request: '继续主角本章' }).entities).toEqual([])
    const selected = selectChapterAtlasIntroductions(before, current, { chapterNum: 2, request: '后续访客、候选伙计、幕后访客、未来访客、本章洪水', anchorText: '新主角初次到场' })
    expect(selected.entities.map(value => value.id)).toEqual(['character:new'])
  })
  it('uses an explicit one-character POV or complete stable ID for a new introduction', () => {
    const current = { entities: [entity('character:1', 'character', '何'), entity('character:10', 'character', '赵砚')].map(value => ({ ...value, effectiveFromChapter: 1 })), relations: [] }
    expect(selectChapterAtlasIntroductions({ entities: [], relations: [] }, current, { chapterNum: 1, request: '人物 character:10 出场' }).entities.map(value => value.id)).toEqual(['character:10'])
    expect(selectChapterAtlasIntroductions({ entities: [], relations: [] }, current, { chapterNum: 1, request: '继续', povNames: ['何'] }).entities.map(value => value.id)).toEqual(['character:1'])
  })
  it('projects routine and ability costs but excludes private payloads and planned organization positions', () => {
    const attributes = creativePublicAttributes({ goals: '修船', habits: ['核查旧绳'], dailyRoutine: '清晨巡河', motivation: '履行承诺', abilityLimits: '不能跨岸听见', abilityCosts: '耗费体力', hiddenSecret: '幕后主使', futureOnly: false,
      abilities: [{ name: '识绳', cost: '手指磨损', hiddenSecret: '终局凶手' }, { name: '未来能力', futureOnly: true }],
      positions: [{ id: 'one', title: '巡河员', status: 'established', responsibilities: '维护渡口' }, { id: 'two', title: '秘密军司', status: 'planned', responsibilities: '未来夺权' }],
    }, { kind: 'character', isPov: true })
    const text = JSON.stringify(attributes)
    for (const value of ['修船', '核查旧绳', '清晨巡河', '履行承诺', '耗费体力', '手指磨损', '巡河员']) expect(text).toContain(value)
    for (const value of ['幕后主使', '终局凶手', '未来能力', '秘密军司', '未来夺权']) expect(text).not.toContain(value)
    expect(attributes.positions).toHaveLength(1)
  })
  it('makes unknown fields explicit without treating residence as current presence or a job slot as employment', () => {
    const atlas = fixture()
    const coverage = creativeAtlasCoverage(atlas, new Set(['character:1']))
    expect(coverage.missing[0].fields).toContain('location_current')
    expect(coverage.missing[0].fields).not.toContain('location_residence')
    expect(coverage.instruction).toContain('已设岗位不等于有人任职')
    expect(creativeAtlasCoverage({ entities: [], relations: [] }, new Set()).missing).toEqual([{ fields: ['map_locations'] }])
  })
  it('does not expose unregistered NPC intentions or abilities while retaining observable traits and public goals', () => {
    const original = { goals: '保住赃物与账面秘密，把失踪推给阿烛或杨嫂。', motivation: '灭口保身', surfaceDesire: '伪装账目清白', moralLine: '可出卖住客', abilities: ['暗中催眠'], abilityLimits: '只能催眠熟人', abilityCosts: '损失记忆', publicGoal: '尽快核对客账', habits: ['说话前扶眼镜'], personalityTraits: ['阴险残酷'], flaws: ['为求财继续杀人'], innerConflict: '知道受害者会死仍合作', roleType: 'antagonist', firstImpression: '讲话稳妥', publicSummary: '店中负责客账登记的人' }
    const npc = creativePublicAttributes(original, { kind: 'character', isPov: false })
    for (const field of ['goals', 'motivation', 'surfaceDesire', 'moralLine', 'abilities', 'abilityLimits', 'abilityCosts', 'personalityTraits', 'flaws', 'innerConflict', 'roleType']) expect(npc).not.toHaveProperty(field)
    expect(npc.publicGoal).toBe(original.publicGoal)
    expect(npc.publicSummary).toBe(original.publicSummary)
    expect(npc.firstImpression).toBe(original.firstImpression)
    expect(npc.habits).toEqual(original.habits)
    const self = creativePublicAttributes(original, { kind: 'character', isPov: true })
    expect(self.goals).toBe(original.goals)
    expect(self.abilities).toEqual(original.abilities)
  })
})
