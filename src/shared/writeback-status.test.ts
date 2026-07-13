import { describe, expect, it } from 'vitest'
import { mergeWritebackSyncStatus, normalizeWritebackSyncStatus } from './writeback-status'

describe('writeback status semantics', () => {
  it('migrates legacy ready records into candidate-generated but not canon-applied', () => {
    const status = normalizeWritebackSyncStatus({
      phase: 'ready',
      blockedGeneration: false,
      readyForNextChapter: true,
    })

    expect(status.candidateReady).toBe(true)
    expect(status.canonApplied).toBe(false)
    expect(status.blockedGeneration).toBe(true)
    expect(status.readyForNextChapter).toBe(false)
  })

  it('keeps the candidate visible when applying fails', () => {
    const ready = normalizeWritebackSyncStatus({ phase: 'ready' })
    const applying = mergeWritebackSyncStatus(ready, { phase: 'applying' })
    const failed = mergeWritebackSyncStatus(applying, { phase: 'failed', lastError: '冲突' })

    expect(failed.candidateReady).toBe(true)
    expect(failed.canonApplied).toBe(false)
    expect(failed.blockedGeneration).toBe(true)
    expect(failed.readyForNextChapter).toBe(false)
    expect(failed.lastError).toBe('冲突')
  })

  it('only exposes next-chapter readiness after canon application', () => {
    const status = normalizeWritebackSyncStatus({
      phase: 'applied',
      candidateReady: true,
      canonApplied: true,
      blockedGeneration: false,
    })

    expect(status.readyForNextChapter).toBe(true)
  })
})
