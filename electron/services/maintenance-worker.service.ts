import { asc, gt } from 'drizzle-orm'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import {
  getSemanticMemoryOutboxStatus,
  processSemanticMemoryOutbox,
  type SemanticMemoryOutboxProcessResult,
  type SemanticMemoryOutboxStatus,
} from './semantic-memory.service'
import {
  refreshStoryMemoryCheckpointsIfNeeded,
  waitForScheduledStoryMemoryRefreshes,
} from './story-memory.service'

const DEFAULT_INITIAL_DELAY_MS = 15_000
const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_OUTBOX_BATCH_SIZE = 24
const DEFAULT_NOVEL_SCAN_SIZE = 1

export interface MaintenanceWorkerStatus {
  state: 'stopped' | 'idle' | 'running' | 'failed'
  allowRemoteEmbeddings: boolean
  startedAt?: string
  lastRunStartedAt?: string
  lastRunFinishedAt?: string
  lastError?: string
  lastOutboxResult?: SemanticMemoryOutboxProcessResult
  outbox: SemanticMemoryOutboxStatus
  checkpointNovelCursor: number
  checkpointRefreshScheduled: number
}

interface MaintenanceWorkerDependencies {
  processOutbox: typeof processSemanticMemoryOutbox
  getOutboxStatus: typeof getSemanticMemoryOutboxStatus
  listNovelIdsAfter: (cursor: number, limit: number) => number[]
  scheduleCheckpointRefresh: typeof refreshStoryMemoryCheckpointsIfNeeded
  waitForCheckpointRefreshes: typeof waitForScheduledStoryMemoryRefreshes
}

export interface MaintenanceWorkerOptions {
  enabled?: boolean
  allowRemoteEmbeddings?: boolean
  initialDelayMs?: number
  intervalMs?: number
  outboxBatchSize?: number
  novelScanSize?: number
  dependencies?: Partial<MaintenanceWorkerDependencies>
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value as number)))
}

function emptyOutboxStatus(): SemanticMemoryOutboxStatus {
  return { pendingCount: 0, retryingCount: 0, processingCount: 0, deadLetterCount: 0 }
}

function listNovelIdsAfter(cursor: number, limit: number): number[] {
  return getDb().select({ id: novels.id }).from(novels)
    .where(gt(novels.id, cursor))
    .orderBy(asc(novels.id))
    .limit(limit)
    .all()
    .map((row) => row.id)
}

function resolveDependencies(overrides: Partial<MaintenanceWorkerDependencies> = {}): MaintenanceWorkerDependencies {
  return {
    processOutbox: overrides.processOutbox || processSemanticMemoryOutbox,
    getOutboxStatus: overrides.getOutboxStatus || getSemanticMemoryOutboxStatus,
    listNovelIdsAfter: overrides.listNovelIdsAfter || listNovelIdsAfter,
    scheduleCheckpointRefresh: overrides.scheduleCheckpointRefresh || refreshStoryMemoryCheckpointsIfNeeded,
    waitForCheckpointRefreshes: overrides.waitForCheckpointRefreshes || waitForScheduledStoryMemoryRefreshes,
  }
}

export function createMaintenanceWorker(options: MaintenanceWorkerOptions = {}) {
  const dependencies = resolveDependencies(options.dependencies)
  const enabled = options.enabled !== false
  const allowRemoteEmbeddings = options.allowRemoteEmbeddings === true
  const initialDelayMs = clampInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, 0, 300_000)
  const intervalMs = clampInteger(options.intervalMs, DEFAULT_INTERVAL_MS, 1_000, 3_600_000)
  const outboxBatchSize = clampInteger(options.outboxBatchSize, DEFAULT_OUTBOX_BATCH_SIZE, 1, 200)
  const novelScanSize = clampInteger(options.novelScanSize, DEFAULT_NOVEL_SCAN_SIZE, 1, 20)
  let timer: ReturnType<typeof setTimeout> | null = null
  let activeCycle: Promise<void> | null = null
  let running = false
  const status: MaintenanceWorkerStatus = {
    state: 'stopped',
    allowRemoteEmbeddings,
    outbox: emptyOutboxStatus(),
    checkpointNovelCursor: 0,
    checkpointRefreshScheduled: 0,
  }

  const scheduleNext = (delayMs: number) => {
    if (!running || timer) return
    timer = setTimeout(() => {
      timer = null
      void runCycle()
    }, delayMs)
    timer.unref?.()
  }

  const executeCycle = async () => {
    status.state = 'running'
    status.lastRunStartedAt = new Date().toISOString()
    status.lastError = undefined
    try {
      const before = dependencies.getOutboxStatus()
      if (before.pendingCount + before.retryingCount > 0) {
        status.lastOutboxResult = await dependencies.processOutbox({
          limit: outboxBatchSize,
          allowRemoteEmbeddings,
        })
      }
      const novelIds = dependencies.listNovelIdsAfter(status.checkpointNovelCursor, novelScanSize)
      if (novelIds.length === 0) {
        status.checkpointNovelCursor = 0
      } else {
        for (const novelId of novelIds) {
          if (dependencies.scheduleCheckpointRefresh(novelId, {
            refreshMode: 'schedule_only',
            reason: 'resident maintenance worker detected stale checkpoints',
            trigger: 'maintenance_worker',
          })) {
            status.checkpointRefreshScheduled += 1
          }
        }
        status.checkpointNovelCursor = novelIds.at(-1) || status.checkpointNovelCursor
      }
      status.outbox = dependencies.getOutboxStatus()
      if (status.outbox.deadLetterCount > 0) {
        console.warn(`[maintenance-worker] semantic memory has ${status.outbox.deadLetterCount} dead-letter item(s)`)
      }
      status.state = running ? 'idle' : 'stopped'
    } catch (error) {
      status.state = 'failed'
      status.lastError = error instanceof Error ? error.message : String(error || 'maintenance cycle failed')
      console.warn('[maintenance-worker] cycle failed:', error)
    } finally {
      status.lastRunFinishedAt = new Date().toISOString()
    }
  }

  const runCycle = async () => {
    if (!running || activeCycle) return activeCycle || Promise.resolve()
    activeCycle = executeCycle()
    try {
      await activeCycle
    } finally {
      activeCycle = null
      scheduleNext(intervalMs)
    }
  }

  return {
    start() {
      if (!enabled || running) return
      running = true
      status.state = 'idle'
      status.startedAt = new Date().toISOString()
      scheduleNext(initialDelayMs)
    },
    async stop() {
      running = false
      if (timer) clearTimeout(timer)
      timer = null
      await activeCycle
      await dependencies.waitForCheckpointRefreshes()
      status.state = 'stopped'
    },
    runNow: runCycle,
    getStatus(): MaintenanceWorkerStatus {
      return {
        ...status,
        outbox: { ...status.outbox },
        lastOutboxResult: status.lastOutboxResult ? { ...status.lastOutboxResult } : undefined,
      }
    },
  }
}

function envInteger(name: string): number | undefined {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : undefined
}

export const maintenanceWorker = createMaintenanceWorker({
  enabled: process.env.NOVELFORGE_BACKGROUND_MAINTENANCE !== '0',
  allowRemoteEmbeddings: process.env.NOVELFORGE_BACKGROUND_REMOTE_EMBEDDINGS === '1',
  initialDelayMs: envInteger('NOVELFORGE_MAINTENANCE_INITIAL_DELAY_MS'),
  intervalMs: envInteger('NOVELFORGE_MAINTENANCE_INTERVAL_MS'),
  outboxBatchSize: envInteger('NOVELFORGE_MAINTENANCE_OUTBOX_BATCH_SIZE'),
  novelScanSize: envInteger('NOVELFORGE_MAINTENANCE_NOVEL_SCAN_SIZE'),
})
