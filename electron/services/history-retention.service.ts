import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getSqlite } from '../database/db'
import { getRuntimeLogDir } from '../utils/runtime-log'
import { DEFAULT_HISTORY_RETENTION, type HistoryRetentionSettings, type HistoryCleanupPreview } from '../../src/shared/history-retention'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'

export interface HistoryTaskFilters {
  novelId?: number
  status?: string
  type?: string
  keepDays?: number
  taskIds?: number[]
}

function settingsPath() { return path.join(app.getPath('userData'), 'history-retention.json') }

export function validateRetentionSettings(input: unknown): HistoryRetentionSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(formatUserFacingMessage('historyRetention.settingsInvalid'))
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !Object.hasOwn(DEFAULT_HISTORY_RETENTION, key))
    || !['enabled', 'cleanTasks', 'cleanLogs'].every(key => typeof value[key] === 'boolean')
    || !Number.isSafeInteger(value.keepDays) || Number(value.keepDays) < 1 || Number(value.keepDays) > 3650) {
    throw new Error(formatUserFacingMessage('historyRetention.policyInvalid'))
  }
  return value as unknown as HistoryRetentionSettings
}

export function getHistoryRetentionSettings(): HistoryRetentionSettings {
  if (!fs.existsSync(settingsPath())) return { ...DEFAULT_HISTORY_RETENTION }
  try { return validateRetentionSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))) }
  catch { throw new Error(formatUserFacingMessage('historyRetention.settingsUnreadable')) }
}

export function updateHistoryRetentionSettings(input: unknown): HistoryRetentionSettings {
  const next = validateRetentionSettings(input)
  const file = settingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 })
  fs.renameSync(`${file}.tmp`, file)
  return next
}

function taskPlan(filters: HistoryTaskFilters, now: number) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error(formatUserFacingMessage('historyRetention.filtersInvalid'))
  if (filters.keepDays !== undefined && (!Number.isSafeInteger(filters.keepDays) || filters.keepDays < 1 || filters.keepDays > 3650)) throw new Error(formatUserFacingMessage('historyRetention.keepDaysInvalid'))
  if (filters.novelId !== undefined && (!Number.isSafeInteger(filters.novelId) || filters.novelId < 1)) throw new Error(formatUserFacingMessage('historyRetention.novelIdInvalid'))
  if (filters.taskIds !== undefined && (!Array.isArray(filters.taskIds) || filters.taskIds.length > 200 || filters.taskIds.some(id => !Number.isSafeInteger(id) || id < 1))) throw new Error(formatUserFacingMessage('historyRetention.taskIdsInvalid'))
  const db = getSqlite()
  const rows = db.prepare(`SELECT id, novel_id, status, type, parent_task_id, current_child_task_id, upstream_task_id,
    progress_json, created_at, updated_at FROM tasks`).all() as Array<{
      id: number; novel_id: number | null; status: string; type: string; parent_task_id: number | null;
      current_child_task_id: number | null; upstream_task_id: number | null; progress_json: string | null;
      created_at: string | null; updated_at: string | null
    }>
  const cutoff = filters.keepDays === undefined ? Infinity : now - filters.keepDays * 86_400_000
  const timestamp = (value: string | null) => value ? Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`) : NaN
  const eligible = new Set(rows.filter(row => ['success', 'failed', 'cancelled'].includes(row.status)
    && (filters.novelId === undefined || row.novel_id === filters.novelId)
    && (!filters.status || row.status === filters.status) && (!filters.type || row.type === filters.type)
    && (!filters.taskIds || filters.taskIds.includes(row.id))
    && Math.max(timestamp(row.created_at), timestamp(row.updated_at)) < cutoff).map(row => row.id))
  const initialCount = eligible.size
  // Keep provenance and rollback/checkpoint chains intact, even for SET NULL foreign keys.
  const referenced = db.prepare(`SELECT task_id AS id FROM artifacts WHERE task_id IS NOT NULL
    UNION SELECT workflow_task_id FROM chapter_batch_snapshots WHERE workflow_task_id IS NOT NULL
    UNION SELECT task_id FROM recommendation_preflight_runs WHERE task_id IS NOT NULL
    UNION SELECT source_task_id FROM chapter_recall_runtime_snapshots WHERE source_task_id IS NOT NULL
    UNION SELECT related_task_id FROM asset_change_impacts WHERE related_task_id IS NOT NULL
    UNION SELECT workflow_task_id FROM workflow_node_snapshots
    UNION SELECT workflow_task_id FROM workflow_node_runs WHERE status IN ('pending','running','paused')
    UNION SELECT CASE WHEN json_valid(origin_meta_json) THEN json_extract(origin_meta_json, '$.runId') END
      FROM revision_tasks WHERE CASE WHEN json_valid(origin_meta_json) THEN json_extract(origin_meta_json, '$.issueCategory') END = 'creative_review'
    UNION SELECT task_id FROM model_request_attempts WHERE status = 'started' AND task_id IS NOT NULL`).all() as { id: number }[]
  for (const row of referenced) eligible.delete(row.id)
  for (const row of rows) {
    if (row.type === 'planning_draft') eligible.delete(row.id)
    if (row.progress_json?.trim()) {
      try {
        const progress: unknown = JSON.parse(row.progress_json)
        if (!progress || typeof progress !== 'object' || Array.isArray(progress) || Object.hasOwn(progress, 'draft')) eligible.delete(row.id)
      } catch { eligible.delete(row.id) } // Unknown legacy progress is retained, not guessed away.
    }
  }
  // A kept parent, child or upstream task protects its entire connected chain.
  const neighbours = new Map<number, number[]>()
  const link = (from: number, to: number) => {
    const list = neighbours.get(from)
    if (list) list.push(to)
    else neighbours.set(from, [to])
  }
  for (const row of rows) for (const linked of [row.parent_task_id, row.current_child_task_id, row.upstream_task_id]) {
    if (!linked) continue
    link(row.id, linked)
    link(linked, row.id)
  }
  const queue = rows.filter(row => !eligible.has(row.id)).map(row => row.id)
  for (let i = 0; i < queue.length; i++) for (const id of neighbours.get(queue[i]) || []) {
    if (eligible.delete(id)) queue.push(id)
  }
  const ids = [...eligible]
  const attempts = db.prepare('SELECT task_id FROM model_request_attempts WHERE task_id IS NOT NULL').all() as { task_id: number }[]
  return { ids, protectedTaskCount: initialCount - ids.length, attemptCount: attempts.filter(row => eligible.has(row.task_id)).length }
}

export function clearRetainedTaskHistory(filters: HistoryTaskFilters = {}) {
  return getSqlite().transaction(() => {
    const plan = taskPlan(filters, Date.now())
    for (let index = 0; index < plan.ids.length; index += 200) {
      const ids = plan.ids.slice(index, index + 200)
      getSqlite().prepare(`DELETE FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
    }
    return { deletedCount: plan.ids.length, deletedTaskIds: plan.ids, protectedCount: plan.protectedTaskCount }
  })()
}

function expiredLogs(keepDays: number, now: number) {
  const dir = getRuntimeLogDir()
  if (!fs.existsSync(dir)) return []
  if (fs.lstatSync(dir).isSymbolicLink()) return []
  const cutoff = now - keepDays * 86_400_000
  const activeLog = `main-runtime-${new Date(now).toISOString().slice(0, 10)}.log`
  return fs.readdirSync(dir).filter(name => name !== activeLog && (/^main-runtime-\d{4}-\d{2}-\d{2}\.log$/.test(name) || name === 'main-runtime.log'))
    .flatMap(name => {
      const file = path.join(dir, name)
      const stat = fs.lstatSync(file)
      return stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff ? [{ file, bytes: stat.size }] : []
    })
}

export function previewHistoryCleanup(input: unknown): HistoryCleanupPreview {
  const settings = validateRetentionSettings(input)
  const plan = settings.cleanTasks ? taskPlan({ keepDays: settings.keepDays }, Date.now()) : { ids: [], protectedTaskCount: 0, attemptCount: 0 }
  const logs = settings.cleanLogs ? expiredLogs(settings.keepDays, Date.now()) : []
  return { taskCount: plan.ids.length, protectedTaskCount: plan.protectedTaskCount, attemptCount: plan.attemptCount, logCount: logs.length, logBytes: logs.reduce((sum, log) => sum + log.bytes, 0) }
}

export function runHistoryCleanup(input: unknown) {
  const settings = validateRetentionSettings(input)
  const result = settings.cleanTasks ? clearRetainedTaskHistory({ keepDays: settings.keepDays }) : { deletedCount: 0, deletedTaskIds: [], protectedCount: 0 }
  let deletedLogs = 0
  if (settings.cleanLogs) for (const log of expiredLogs(settings.keepDays, Date.now())) {
    fs.unlinkSync(log.file)
    deletedLogs += 1
  }
  return { ...result, deletedLogs }
}

let lastCheck = 0
export function runDueHistoryCleanup() {
  if (Date.now() - lastCheck < 3_600_000) return
  lastCheck = Date.now()
  const settings = getHistoryRetentionSettings()
  if (settings.enabled) runHistoryCleanup(settings)
}
