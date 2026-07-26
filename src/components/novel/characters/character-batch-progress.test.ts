import { describe, expect, it } from 'vitest'
import { formatCharacterBatchProgress, parseCharacterBatchProgress } from './character-batch-progress'

describe('parseCharacterBatchProgress', () => {
  it('parses a valid payload and counts cumulative produced ids', () => {
    expect(parseCharacterBatchProgress({ batch: 2, total: 3, newIds: [4, 7, 9] })).toEqual({
      batch: 2,
      total: 3,
      producedCount: 3,
    })
  })

  it('tolerates a missing or malformed newIds list', () => {
    expect(parseCharacterBatchProgress({ batch: 1, total: 2 })).toEqual({ batch: 1, total: 2, producedCount: 0 })
    expect(parseCharacterBatchProgress({ batch: 1, total: 2, newIds: 'oops' })).toEqual({
      batch: 1,
      total: 2,
      producedCount: 0,
    })
  })

  it('rejects payloads without positive batch/total', () => {
    expect(parseCharacterBatchProgress(null)).toBeNull()
    expect(parseCharacterBatchProgress('progress')).toBeNull()
    expect(parseCharacterBatchProgress([1, 2])).toBeNull()
    expect(parseCharacterBatchProgress({ batch: 0, total: 3 })).toBeNull()
    expect(parseCharacterBatchProgress({ batch: 1, total: 0 })).toBeNull()
    expect(parseCharacterBatchProgress({ batch: 'a', total: 3 })).toBeNull()
  })
})

describe('formatCharacterBatchProgress', () => {
  it('formats percent and progress text', () => {
    expect(formatCharacterBatchProgress({ batch: 2, total: 4, producedCount: 6 })).toEqual({
      percent: 50,
      text: '第 2/4 批，已产出 6 人',
    })
  })

  it('caps batch overflow at 100 percent (retry rounds can exceed total)', () => {
    expect(formatCharacterBatchProgress({ batch: 5, total: 3, producedCount: 10 })).toEqual({
      percent: 100,
      text: '第 3/3 批，已产出 10 人',
    })
  })
})
