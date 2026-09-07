import { describe, expect, it } from 'vitest'
import {
  filterFactsForCharacter,
  findUnexposedFactsForCharacter,
  isFactKnownByCharacter,
  isFactVisibleToReader,
  type ProjectedStoryFactKnowledge,
  type StoryFactKnowledgeProjection,
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

function projection(overrides: Partial<StoryFactKnowledgeProjection> = {}): StoryFactKnowledgeProjection {
  return {
    readerKnownChapterNum: null,
    protagonistKnownChapterNum: null,
    characterKnowledge: [],
    ...overrides,
  }
}

function projected(
  row: StoryFactKnowledgeRow,
  knowledge: StoryFactKnowledgeProjection,
  diagnostics?: ProjectedStoryFactKnowledge['diagnostics'],
): ProjectedStoryFactKnowledge {
  return { fact: row, projection: knowledge, ...(diagnostics ? { diagnostics } : {}) }
}

describe('isFactKnownByCharacter', () => {
  it('uses projected chapter numbers rather than database chapter ids', () => {
    const result = isFactKnownByCharacter(
      projection({ characterKnowledge: [{ characterId: 7, knownChapterNum: 3 }] }),
      7,
      4,
    )
    expect(result).toEqual({ known: true, source: 'character_knowledge' })
  })

  it('does not mistake a large chapter id for an early chapter', () => {
    const result = isFactKnownByCharacter(
      projection({ characterKnowledge: [{ characterId: 7, knownChapterNum: 80 }] }),
      7,
      20,
    )
    expect(result).toEqual({ known: false, source: 'not_known' })
  })

  it('does not reveal a reader-only fact to a character', () => {
    const item = projection({ readerKnownChapterNum: 3 })
    expect(isFactKnownByCharacter(item, 7, 10)).toEqual({ known: false, source: 'not_known' })
    expect(isFactVisibleToReader(item, 3)).toEqual({ known: true, source: 'reader' })
  })

  it('treats an explicit null character knowledge time as unknown', () => {
    const item = projection({ characterKnowledge: [{ characterId: 8, knownChapterNum: null }] })
    expect(isFactKnownByCharacter(item, 8, 1)).toEqual({ known: false, source: 'not_known' })
  })

  it('gives an explicit character record priority over the protagonist record', () => {
    const item = projection({
      protagonistKnownChapterNum: 2,
      characterKnowledge: [{ characterId: 8, knownChapterNum: 5 }],
    })
    expect(isFactKnownByCharacter(item, 8, 3, true)).toEqual({ known: false, source: 'not_known' })
    expect(isFactKnownByCharacter(item, 8, 5, true)).toEqual({ known: true, source: 'character_knowledge' })
  })

  it('uses the protagonist-only record only when no character record exists', () => {
    const item = projection({ protagonistKnownChapterNum: 4 })
    expect(isFactKnownByCharacter(item, 8, 4, true)).toEqual({ known: true, source: 'protagonist' })
    expect(isFactKnownByCharacter(item, 8, 4, false)).toEqual({ known: false, source: 'not_known' })
  })

  it('uses strict chapter-start and inclusive chapter-end boundaries', () => {
    const item = projection({ characterKnowledge: [{ characterId: 8, knownChapterNum: 20 }] })
    expect(isFactKnownByCharacter(item, 8, 20, false, { boundary: 'start' })).toEqual({
      known: false,
      source: 'not_known',
    })
    expect(isFactKnownByCharacter(item, 8, 20, false, { boundary: 'end' })).toEqual({
      known: true,
      source: 'character_knowledge',
    })
  })

  it('tolerates an empty projection without granting knowledge', () => {
    expect(isFactKnownByCharacter(projection(), 7, 5)).toEqual({ known: false, source: 'not_known' })
  })
})

describe('filterFactsForCharacter', () => {
  const facts = [
    projected(
      fact({ id: 1, title: '角色已知' }),
      projection({ characterKnowledge: [{ characterId: 7, knownChapterNum: 2 }] }),
    ),
    projected(
      fact({ id: 2, title: '主角专属' }),
      projection({ protagonistKnownChapterNum: 5 }),
    ),
    projected(fact({ id: 3, title: 'reader-only' }), projection({ readerKnownChapterNum: 1 })),
  ]

  it('returns original fact rows for a regular character', () => {
    const known = filterFactsForCharacter(facts, 7, 6)
    expect(known.map((item) => item.id)).toEqual([1])
    expect(known[0]).toBe(facts[0].fact)
  })

  it('uses the protagonist projection only for a protagonist', () => {
    const known = filterFactsForCharacter(facts, 7, 6, { isProtagonist: true })
    expect(known.map((item) => item.id)).toEqual([1, 2])
  })

  it('supports chapter-start filtering without advancing same-chapter knowledge', () => {
    const sameChapter = [projected(
      fact({ id: 4, title: '第20章获知' }),
      projection({ characterKnowledge: [{ characterId: 7, knownChapterNum: 20 }] }),
    )]
    expect(filterFactsForCharacter(sameChapter, 7, 20, { boundary: 'start' })).toEqual([])
    expect(filterFactsForCharacter(sameChapter, 7, 20, { boundary: 'end' }).map((item) => item.id)).toEqual([4])
  })
})

describe('findUnexposedFactsForCharacter', () => {
  it('retains diagnostics while returning the original fact row', () => {
    const row = fact({ id: 1, title: '时间未知' })
    const diagnostics = [{
      code: 'knowledge_time_unknown' as const,
      factId: 1,
      field: 'characterKnowledgeJson' as const,
      characterId: 7,
      message: 'unknown',
    }]
    const exposed = findUnexposedFactsForCharacter([
      projected(row, projection({ characterKnowledge: [{ characterId: 7, knownChapterNum: null }] }), diagnostics),
    ], 7, 5)
    expect(exposed).toHaveLength(1)
    expect(exposed[0].fact).toBe(row)
    expect(exposed[0].reason).toContain('尚未在 5 章前揭示')
    expect(exposed[0].diagnostics).toEqual(diagnostics)
  })
})
