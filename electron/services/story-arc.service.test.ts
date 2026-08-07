import { describe, expect, it } from 'vitest'
import { sanitizeStoryArcPatch } from './story-arc.service'

describe('story arc write boundary', () => {
  it('keeps editable fields and strips ownership or identity overrides', () => {
    expect(sanitizeStoryArcPatch({
      id: 99,
      novelId: 88,
      arcName: '第一故事弧',
      arcOrder: 1,
      arcGoal: '找到失踪者',
      unexpected: 'drop me',
    })).toEqual({
      arcName: '第一故事弧',
      arcOrder: 1,
      arcGoal: '找到失踪者',
    })
  })

  it('rejects arrays and primitive payloads', () => {
    expect(sanitizeStoryArcPatch(null)).toEqual({})
    expect(sanitizeStoryArcPatch([])).toEqual({})
    expect(sanitizeStoryArcPatch('invalid')).toEqual({})
  })
})
