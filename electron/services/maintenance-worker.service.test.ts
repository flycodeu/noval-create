import { describe, expect, it, vi } from 'vitest'
import { createMaintenanceWorker } from './maintenance-worker.service'

function buildDependencies(overrides: Record<string, unknown> = {}) {
  return {
    processOutbox: vi.fn(async () => ({
      claimedCount: 1,
      processedCount: 1,
      supersededCount: 0,
      failedCount: 0,
    })),
    getOutboxStatus: vi.fn(() => ({
      pendingCount: 1,
      retryingCount: 0,
      processingCount: 0,
      deadLetterCount: 0,
    })),
    listNovelIdsAfter: vi.fn(() => [7]),
    scheduleCheckpointRefresh: vi.fn(() => true),
    waitForCheckpointRefreshes: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('maintenance worker', () => {
  it('drains a bounded local-only batch and schedules bounded checkpoint refresh', async () => {
    const dependencies = buildDependencies()
    const worker = createMaintenanceWorker({
      initialDelayMs: 300_000,
      intervalMs: 300_000,
      outboxBatchSize: 12,
      novelScanSize: 1,
      dependencies,
    })

    worker.start()
    await worker.runNow()
    await worker.stop()

    expect(dependencies.processOutbox).toHaveBeenCalledWith({
      limit: 12,
      allowRemoteEmbeddings: false,
    })
    expect(dependencies.listNovelIdsAfter).toHaveBeenCalledWith(0, 1)
    expect(dependencies.scheduleCheckpointRefresh).toHaveBeenCalledWith(7, expect.objectContaining({
      refreshMode: 'schedule_only',
      trigger: 'maintenance_worker',
    }))
    expect(dependencies.waitForCheckpointRefreshes).toHaveBeenCalledOnce()
    expect(worker.getStatus()).toMatchObject({
      state: 'stopped',
      allowRemoteEmbeddings: false,
      checkpointNovelCursor: 7,
      checkpointRefreshScheduled: 1,
    })
  })

  it('does not overlap cycles and only enables remote embeddings explicitly', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const dependencies = buildDependencies({
      processOutbox: vi.fn(async () => {
        await pending
        return { claimedCount: 1, processedCount: 1, supersededCount: 0, failedCount: 0 }
      }),
    })
    const worker = createMaintenanceWorker({
      allowRemoteEmbeddings: true,
      initialDelayMs: 300_000,
      intervalMs: 300_000,
      dependencies,
    })

    worker.start()
    const first = worker.runNow()
    const second = worker.runNow()
    expect(dependencies.processOutbox).toHaveBeenCalledOnce()
    release()
    await Promise.all([first, second])
    await worker.stop()

    expect(dependencies.processOutbox).toHaveBeenCalledWith(expect.objectContaining({
      allowRemoteEmbeddings: true,
    }))
  })

  it('skips outbox work when no pending or retryable rows exist', async () => {
    const dependencies = buildDependencies({
      getOutboxStatus: vi.fn(() => ({
        pendingCount: 0,
        retryingCount: 0,
        processingCount: 0,
        deadLetterCount: 2,
      })),
      listNovelIdsAfter: vi.fn(() => []),
    })
    const worker = createMaintenanceWorker({
      initialDelayMs: 300_000,
      intervalMs: 300_000,
      dependencies,
    })

    worker.start()
    await worker.runNow()
    await worker.stop()

    expect(dependencies.processOutbox).not.toHaveBeenCalled()
    expect(worker.getStatus().outbox.deadLetterCount).toBe(2)
    expect(worker.getStatus().checkpointNovelCursor).toBe(0)
  })
})
