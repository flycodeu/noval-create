import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCharacterKnowledgeSnapshot } from './knowledge-boundary.service'
import { buildContextVisibilityPolicy, loadContextVisibilityPolicyInput } from './context-visibility'

const mock = vi.hoisted(() => ({ rows: vi.fn() }))
vi.mock('../database/db', () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ all: mock.rows }) }) }) }) }))
const fact = (id: number, knownFromStart?: unknown) => ({ id, novelId: 1, title: `事实${id}`, summary: '原有资料', kind: 'clue',
  readerKnownChapterId: null, protagonistKnownChapterId: null, forbiddenBeforeVolume: null, targetRevealChapterId: null,
  characterKnowledgeJson: JSON.stringify([{ characterId: 7, knownChapterId: null, ...(knownFromStart === undefined ? {} : { knownFromStart }) }]),
})

describe('stored explicit initial knowledge projection', () => {
  beforeEach(() => mock.rows.mockReset())
  it('loads the boolean through the knowledge service without treating old null or string true as knowledge', () => {
    mock.rows.mockReturnValueOnce([{ id: 100, chapterNum: 1 }]).mockReturnValueOnce([fact(1, true), fact(2), fact(3, 'true')])
    const snapshot = getCharacterKnowledgeSnapshot(1, 7, 1, false, { boundary: 'start' })
    expect(snapshot.knownFacts.map(row => row.id)).toEqual([1])
    expect(snapshot.unknownFacts.map(row => row.fact.id)).toEqual([2, 3])
    expect(snapshot.diagnostics?.map(diagnostic => diagnostic.factId)).toEqual([2, 3])
  })
  it('preserves the boolean in chapter visibility while retaining legacy null as unknown', () => {
    mock.rows.mockReturnValueOnce([fact(1, true), fact(2), fact(3, false)])
    const input = loadContextVisibilityPolicyInput(1, 100, 1, 'writer', { chapterRows: [{ id: 100, chapterNum: 1 }],
      characters: [{ id: 7, fullName: '陈舟', roleType: 'protagonist' }],
      scenes: [{ id: 10, segmentOrder: 1, pov: '陈舟', status: 'ready', revealPayload: [] }],
    })
    expect(input.facts[0].projection.characterKnowledge[0]).toMatchObject({ characterId: 7, knownChapterNum: null, knownFromStart: true })
    const policy = buildContextVisibilityPolicy(input)
    expect(policy.allowedFacts.map(row => row.fact.id)).toEqual([1])
    expect(policy.deniedFacts.map(row => row.fact.id)).toEqual([2, 3])
  })
})
