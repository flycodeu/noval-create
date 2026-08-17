import { describe, expect, it } from 'vitest'
import {
  isFactKnownByCharacter,
  filterFactsForCharacter,
  findUnexposedFactsForCharacter,
  type StoryFactKnowledgeRow,
} from './knowledge-boundary.service'

function fact(overrides: Partial<StoryFactKnowledgeRow> & { id: number; title: string }): StoryFactKnowledgeRow {
  return {
    novelId: 1,
    summary: null,
    kind: 'clue',
    readerKnownChapterId: null,
    protagonistKnownChapterId: null,
    characterKnowledgeJson: null,
    forbiddenBeforeVolume: null,
    targetRevealChapterId: null,
    ...overrides,
  }
}

describe('isFactKnownByCharacter', () => {
  it('treats a fact without any knowledge fields as unknown', () => {
    const result = isFactKnownByCharacter(fact({ id: 1, title: '未揭示' }), 7, 5)
    expect(result.known).toBe(false)
    expect(result.source).toBe('not_known')
  })

  it('reveals to the protagonist once the protagonist chapter is reached', () => {
    const item = fact({ id: 1, title: '真相', protagonistKnownChapterId: 4 })
    expect(isFactKnownByCharacter(item, 7, 4, true).known).toBe(true)
    expect(isFactKnownByCharacter(item, 7, 4, true).source).toBe('protagonist')
    expect(isFactKnownByCharacter(item, 7, 3, true).known).toBe(false)
  })

  it('does not reveal to a non-protagonist via the protagonist field', () => {
    const item = fact({ id: 1, title: '主角秘密', protagonistKnownChapterId: 2 })
    expect(isFactKnownByCharacter(item, 8, 10, false).known).toBe(false)
  })

  it('honors per-character knowledge entries', () => {
    const item = fact({
      id: 1,
      title: '双线秘密',
      characterKnowledgeJson: JSON.stringify([{ characterId: 8, knownChapterId: 3 }]),
    })
    expect(isFactKnownByCharacter(item, 8, 3).known).toBe(true)
    expect(isFactKnownByCharacter(item, 8, 3).source).toBe('character_knowledge')
    expect(isFactKnownByCharacter(item, 8, 2).known).toBe(false)
    // 其他角色不因该条目而知晓
    expect(isFactKnownByCharacter(item, 9, 10).known).toBe(false)
  })

  it('treats a knowledge entry without chapter as immediately known', () => {
    const item = fact({
      id: 1,
      title: '零章即知',
      characterKnowledgeJson: JSON.stringify([{ characterId: 8, knownChapterId: null }]),
    })
    expect(isFactKnownByCharacter(item, 8, 1).known).toBe(true)
  })

  it('falls back to reader knowledge once revealed to readers', () => {
    const item = fact({ id: 1, title: '读者已知', readerKnownChapterId: 6 })
    expect(isFactKnownByCharacter(item, 7, 6).known).toBe(true)
    expect(isFactKnownByCharacter(item, 7, 6).source).toBe('reader')
    expect(isFactKnownByCharacter(item, 7, 5).known).toBe(false)
  })

  it('tolerates malformed knowledge json', () => {
    const item = fact({ id: 1, title: '坏数据', characterKnowledgeJson: 'not-json' })
    expect(isFactKnownByCharacter(item, 8, 10).known).toBe(false)
  })
})

describe('filterFactsForCharacter', () => {
  const facts = [
    fact({ id: 1, title: '已揭示', readerKnownChapterId: 2 }),
    fact({ id: 2, title: '主角专属', protagonistKnownChapterId: 5 }),
    fact({ id: 3, title: '未揭示' }),
  ]

  it('filters to only known facts for the protagonist', () => {
    const known = filterFactsForCharacter(facts, 7, 6, { isProtagonist: true })
    expect(known.map((item) => item.id).sort()).toEqual([1, 2])
  })

  it('filters to only known facts for a regular character', () => {
    const known = filterFactsForCharacter(facts, 7, 6, { isProtagonist: false })
    expect(known.map((item) => item.id)).toEqual([1])
  })

  it('returns nothing before any reveal', () => {
    const known = filterFactsForCharacter(facts, 7, 1, { isProtagonist: true })
    expect(known).toEqual([])
  })
})

describe('findUnexposedFactsForCharacter', () => {
  const facts = [
    fact({ id: 1, title: '已揭示', readerKnownChapterId: 2 }),
    fact({ id: 2, title: '未揭示' }),
  ]

  it('lists facts that should not be in the character knowledge window', () => {
    const exposed = findUnexposedFactsForCharacter(facts, 7, 5)
    expect(exposed).toHaveLength(1)
    expect(exposed[0].fact.id).toBe(2)
    expect(exposed[0].reason).toContain('尚未在 5 章前揭示')
  })
})
