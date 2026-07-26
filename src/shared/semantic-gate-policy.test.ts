import { describe, expect, it } from 'vitest'
import { DEFAULT_SEMANTIC_GATE_POLICY, resolveSemanticGatePolicy } from './semantic-gate-policy'

describe('semantic-gate-policy', () => {
  it('falls back to defaults for empty or corrupted settings', () => {
    expect(resolveSemanticGatePolicy(null)).toEqual(DEFAULT_SEMANTIC_GATE_POLICY)
    expect(resolveSemanticGatePolicy('')).toEqual(DEFAULT_SEMANTIC_GATE_POLICY)
    expect(resolveSemanticGatePolicy('not-json{{')).toEqual(DEFAULT_SEMANTIC_GATE_POLICY)
    expect(resolveSemanticGatePolicy('{"qualityGates": 42}')).toEqual(DEFAULT_SEMANTIC_GATE_POLICY)
  })

  it('parses explicit configuration', () => {
    const policy = resolveSemanticGatePolicy(JSON.stringify({
      qualityGates: {
        semanticGate: 'enforce',
        fallbackMode: 'warn-pass',
        goldenChapterNums: [1, 2, 3, 3],
        maxSemanticCallsPerChapter: 4,
      },
    }))

    expect(policy.mode).toBe('enforce')
    expect(policy.fallbackMode).toBe('warn-pass')
    expect(policy.goldenChapterNums).toEqual([1, 2, 3])
    expect(policy.maxSemanticCallsPerChapter).toBe(4)
  })

  it('rejects invalid field values individually', () => {
    const policy = resolveSemanticGatePolicy(JSON.stringify({
      qualityGates: {
        semanticGate: 'aggressive',
        fallbackMode: 'crash',
        goldenChapterNums: ['a', -1, 0],
        maxSemanticCallsPerChapter: 999,
      },
    }))

    expect(policy.mode).toBe(DEFAULT_SEMANTIC_GATE_POLICY.mode)
    expect(policy.fallbackMode).toBe(DEFAULT_SEMANTIC_GATE_POLICY.fallbackMode)
    expect(policy.goldenChapterNums).toEqual(DEFAULT_SEMANTIC_GATE_POLICY.goldenChapterNums)
    expect(policy.maxSemanticCallsPerChapter).toBe(6)
  })
})
