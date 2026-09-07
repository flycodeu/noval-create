import { describe, expect, it } from 'vitest'

import { estimateTokens, truncateToTokens } from './token-budget'

describe('shared token budget', () => {
  it('keeps mixed text estimates deterministic and handles empty input', () => {
    const mixed = '中文 mixed 123，emoji 😀'
    expect(estimateTokens(mixed)).toBe(estimateTokens(mixed))
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('😀')).toBeGreaterThan(0)
  })

  it('truncates with the same estimator without exceeding the target', () => {
    const value = '中文内容 '.repeat(40)
    const truncated = truncateToTokens(value, 12)
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(12)
    expect(truncated.length).toBeLessThan(value.length)
  })
})
