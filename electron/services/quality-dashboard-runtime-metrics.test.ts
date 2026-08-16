import { describe, expect, it } from 'vitest'
import { buildRuntimeObservability, computeRuntimePressureScore } from './quality-dashboard-runtime-metrics'

const runtimePolicy = {
  operatingMode: 'million_longform' as const,
  label: '百万字模式',
  strategySummary: '串行正文',
  chapterGenerationMode: 'serial_only' as const,
  serialOnly: true,
  backgroundPrecomputeEnabled: true,
  requireWritebackReady: true,
  recallPauseThreshold: 3,
  checkpointGapWarningThreshold: 4,
  mainThreadPressureStrategy: 'stability_first' as const,
}

describe('quality dashboard runtime metrics', () => {
  it('preserves the weighted and capped pressure score', () => {
    expect(computeRuntimePressureScore({
      writebackPendingCount: 1,
      writebackFailedCount: 1,
      staleCheckpointCount: 1,
      latestCheckpointChapterGap: 20,
      recallDegradedChapterCount: 1,
      consecutiveRecallFallbackChapters: 1,
      inspectionBlockedCount: 1,
      batchGateBlockedCount: 1,
    })).toBe(100)
  })

  it('keeps explicit guardrail reasons ahead of derived reasons', () => {
    const result = buildRuntimeObservability({
      writebackPendingCount: 1,
      writebackFailedCount: 0,
      staleCheckpointCount: 0,
      latestCheckpointChapterGap: 0,
      recallDegradedChapterCount: 0,
      consecutiveRecallFallbackChapters: 0,
      inspectionBlockedCount: 0,
      batchGateBlockedCount: 0,
      runtimePolicy,
      latestBatchGuardrailReason: '显式暂停原因',
      precomputeStatus: { status: 'queued', queuedAt: '2026-08-16T00:00:00.000Z' },
    })

    expect(result).toMatchObject({
      guardrailActive: true,
      activeGuardrailReason: '显式暂停原因',
      runtimePressureLevel: 'low',
      precomputeQueueStatus: 'queued',
      precomputeUpdatedAt: '2026-08-16T00:00:00.000Z',
    })
    expect(result.summary).toContain('百万字模式已按')
  })

  it('reports an idle low-pressure runtime without a guardrail', () => {
    const result = buildRuntimeObservability({
      writebackPendingCount: 0,
      writebackFailedCount: 0,
      staleCheckpointCount: 0,
      latestCheckpointChapterGap: 0,
      recallDegradedChapterCount: 0,
      consecutiveRecallFallbackChapters: 0,
      inspectionBlockedCount: 0,
      batchGateBlockedCount: 0,
      runtimePolicy,
      precomputeStatus: { status: 'idle' },
    })

    expect(result.guardrailActive).toBe(false)
    expect(result.activeGuardrailReason).toBeUndefined()
    expect(result.runtimePressureScore).toBe(0)
  })
})
