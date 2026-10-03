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
