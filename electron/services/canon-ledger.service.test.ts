import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getSqlite: vi.fn(),
}))
import {
  buildWritebackCanonIdempotencyKey,
  CanonLedgerError,
  hashCanonInput,
} from './canon-ledger.service'

describe('canon ledger value contracts', () => {
  it('builds stable writeback idempotency keys', () => {
    expect(buildWritebackCanonIdempotencyKey(42)).toBe('chapter-writeback:42')
    expect(buildWritebackCanonIdempotencyKey(42)).toBe(buildWritebackCanonIdempotencyKey(42))
  })

  it('hashes equivalent object key order identically', () => {
    expect(hashCanonInput({ after: { b: 2, a: 1 }, id: 7 }))
      .toBe(hashCanonInput({ id: 7, after: { a: 1, b: 2 } }))
  })

  it('rejects invalid writeback run identifiers', () => {
    expect(() => buildWritebackCanonIdempotencyKey(0)).toThrow(CanonLedgerError)
  })
})
