import { describe, it, expect } from 'vitest'
import { characterCastRole } from './cast-role'

describe('author cast roles', () => {
  it('does not confuse importance or proximity with the protagonist party', () => {
    expect(characterCastRole({ roleType: 'major', occupation: '主角的邻居' })).toBe('supporting')
    expect(characterCastRole({ roleType: 'minor' })).toBe('walk_on')
    expect(characterCastRole({})).toBe('unassigned')
  })
  it('uses explicit author design without converting potential enemies into established opponents', () => {
    expect(characterCastRole({ roleType: 'major', authorPlanning: { castRole: 'companion' } })).toBe('companion')
    expect(characterCastRole({ roleType: 'supporting', authorPlanning: { castRole: 'potential_enemy' } })).toBe('potential_enemy')
    expect(characterCastRole({ roleType: 'major', authorPlanning: '原有完整规划' })).toBe('supporting')
    expect(characterCastRole({ roleType: 'minor', authorPlanning: { castRole: 'invalid' } })).toBe('walk_on')
  })
})
