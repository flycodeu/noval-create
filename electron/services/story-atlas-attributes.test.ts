import { describe, expect, it } from 'vitest'
import { mergeAtlasAttributes, normalizeAtlasAttributePatch, validateAtlasPositions } from './story-atlas-attributes'

describe('story atlas attributes', () => {
  it('does not turn empty drafts into character facts or overwrite saved traits', () => {
    const patch = normalizeAtlasAttributePatch('character', { personalityTraits: [], motivation: ' ', campFactionIds: [], dailyRoutine: '清点渡船和绳索' })
    expect(patch).toEqual({ dailyRoutine: '清点渡船和绳索' })
    expect(mergeAtlasAttributes({ personalityTraits: ['谨慎'], privateCanon: '保留' }, { ...patch, personalityTraits: ['克制'] })).toEqual({ personalityTraits: ['谨慎', '克制'], privateCanon: '保留', dailyRoutine: '清点渡船和绳索' })
  })
  it('validates known field types and routes geographic references through graph edges', () => {
    expect(() => normalizeAtlasAttributePatch('character', { personalityTraits: '沉稳' })).toThrow('属性结构')
    expect(() => normalizeAtlasAttributePatch('character', { homeLocationId: 'location:other-project' })).toThrow('presence')
    expect(() => normalizeAtlasAttributePatch('presence', { locationRole: 'headquarter-misspelled' })).toThrow('属性结构')
  })
  it('allows unchanged migrated references but rejects adding, changing or clearing them', () => {
    const current = { campFactionIds: [4], homeLocationId: 'location:old' }
    expect(normalizeAtlasAttributePatch('character', { ...current, occupation: '船工' }, current, 'replace')).toEqual({ occupation: '船工' })
    for (const mode of ['merge', 'replace'] as const) {
      for (const campFactionIds of [[5], [], null]) expect(() => normalizeAtlasAttributePatch('character', { campFactionIds }, current, mode)).toThrow('membership')
      expect(() => normalizeAtlasAttributePatch('character', { homeLocationId: 'location:new' }, current, mode)).toThrow('presence')
    }
  })
  it('replaces supplied fields and clears empty values without losing omitted facts or zero and false', () => {
    const current = { personalityTraits: ['谨慎', '克制'], occupation: '船工', goals: '守住渡口', age: 22, appearance: { hair: '黑', clothing: '旧衫' }, privateCanon: '保留' }
    const patch = normalizeAtlasAttributePatch('character', { personalityTraits: ['直言'], goals: ' ', age: null, appearance: { hair: '', clothing: '短衫', scars: [], count: 0, visible: false } }, current, 'replace')
    expect(mergeAtlasAttributes(current, patch, 'replace')).toEqual({ personalityTraits: ['直言'], occupation: '船工', appearance: { clothing: '短衫', count: 0, visible: false }, privateCanon: '保留' })
    expect(mergeAtlasAttributes(current, normalizeAtlasAttributePatch('character', { personalityTraits: [], appearance: {} }, current, 'replace'), 'replace')).toEqual({ occupation: '船工', goals: '守住渡口', age: 22, privateCanon: '保留' })
    expect(normalizeAtlasAttributePatch('character', { age: 0, alive: false }, {}, 'replace')).toEqual({ age: 0, alive: false })
    expect(() => normalizeAtlasAttributePatch('character', { personalityTraits: '直言' }, current, 'replace')).toThrow('属性结构')
  })
  it('updates one stable organization slot without dropping other slots or its responsibilities', () => {
    const current = { positions: [{ id: 'head', title: '掌事', status: 'established', responsibilities: '安排船期' }, { id: 'clerk', title: '账房', status: 'planned' }] }
    const patch = normalizeAtlasAttributePatch('faction', { positions: [{ id: 'head', requirements: '熟悉航道' }] })
    const next = mergeAtlasAttributes(current, patch)
    expect(validateAtlasPositions(next.positions)).toEqual([{ ...current.positions[0], requirements: '熟悉航道' }, current.positions[1]])
    expect(() => normalizeAtlasAttributePatch('faction', { positions: [{ id: 'head' }, { id: 'head' }] })).toThrow('重复')
  })
  it('rejects invented, cyclic, and not-yet-established reporting lines', () => {
    expect(() => validateAtlasPositions([{ id: 'unknown' }])).toThrow('名称和计划')
    expect(() => validateAtlasPositions([{ id: 'a', title: '甲', status: 'established', reportsToPositionId: 'b' }])).toThrow('同一组织')
    expect(() => validateAtlasPositions([{ id: 'a', title: '甲', status: 'established', reportsToPositionId: 'b' }, { id: 'b', title: '乙', status: 'established', reportsToPositionId: 'a' }])).toThrow('循环')
    expect(() => validateAtlasPositions([{ id: 'a', title: '甲', status: 'established', reportsToPositionId: 'b' }, { id: 'b', title: '乙', status: 'planned' }])).toThrow('尚未设立')
  })
})
