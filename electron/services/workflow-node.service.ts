import { createHash, randomUUID } from 'node:crypto'
import { getSqlite } from '../database/db'

export type WorkflowNodeStatus =
  | 'pending'
  | 'leased'
  | 'running'
  | 'produced'
  | 'validated'
  | 'approved'
  | 'committed'
  | 'failed'
  | 'blocked'
  | 'cancelled'

export interface BeginWorkflowNodeInput {
  workflowTaskId: number
  novelId: number
  chapterId?: number | null
  nodeKey: string
  inputHash: string
  contextVersion: number
  upstreamSnapshotId?: string | null
  leaseOwner?: string
  leaseMs?: number
  retryOfNodeRunId?: number | null
  retryReason?: string | null
}

export interface WorkflowNodeLease {
  nodeRunId: number
  workflowTaskId: number
  nodeKey: string
  attempt: number
  inputHash: string
  contextVersion: number
  leaseOwner: string
  leaseToken: string
  leaseExpiresAt: string
}

export interface WorkflowNodeSnapshot {
  id: string
  nodeRunId: number
  workflowTaskId: number
  novelId: number
  chapterId: number | null
  nodeKey: string
  attempt: number
  inputHash: string
  outputHash: string
  contextVersion: number
  payload: unknown
  createdAt: string
}

export interface WorkflowNodeRun {
  id: number
  workflowTaskId: number
  novelId: number
  chapterId: number | null
  nodeKey: string
  attempt: number
  status: WorkflowNodeStatus
  inputHash: string
  upstreamSnapshotId: string | null
  contextVersion: number
  snapshotId: string | null
  retryOfNodeRunId: number | null
  retryReason: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  errorClass: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export class WorkflowNodeError extends Error {
  readonly code: 'INVALID_INPUT' | 'LEASE_CONFLICT' | 'LEASE_EXPIRED' | 'NODE_NOT_FOUND' | 'SNAPSHOT_CONFLICT'

  constructor(code: WorkflowNodeError['code'], message: string) {
    super(message)
    this.name = 'WorkflowNodeError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  )
}

function jsonText(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function requirePositive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new WorkflowNodeError('INVALID_INPUT', `${label}必须是正整数。`)
  }
  return value
}

function requireText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new WorkflowNodeError('INVALID_INPUT', `${label}不能为空。`)
  return normalized
}

function nowIso(): string {
  return new Date().toISOString()
}

function isExpired(value: unknown, now = Date.now()): boolean {
  if (typeof value !== 'string' || !value) return true
  const timestamp = Date.parse(value)
  return !Number.isFinite(timestamp) || timestamp <= now
}

function getNodeRow(nodeRunId: number): Record<string, unknown> | undefined {
  return getSqlite().prepare('SELECT * FROM workflow_node_runs WHERE id = ?').get(nodeRunId) as Record<string, unknown> | undefined
}

function getSnapshotRow(snapshotId: string): Record<string, unknown> | undefined {
  return getSqlite().prepare('SELECT * FROM workflow_node_snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown> | undefined
}

function runTransaction<T>(work: () => T): T {
  const sqlite = getSqlite()
  const transaction = sqlite.transaction(work)
  return sqlite.inTransaction || typeof transaction.immediate !== 'function'
    ? transaction()
    : transaction.immediate()
}

function mapSnapshot(row: Record<string, unknown>): WorkflowNodeSnapshot {
  return {
    id: String(row.id),
    nodeRunId: Number(row.node_run_id),
    workflowTaskId: Number(row.workflow_task_id),
    novelId: Number(row.novel_id),
    chapterId: row.chapter_id == null ? null : Number(row.chapter_id),
    nodeKey: String(row.node_key || ''),
    attempt: Number(row.attempt || 1),
    inputHash: String(row.input_hash || ''),
    outputHash: String(row.output_hash || ''),
    contextVersion: Number(row.context_version || 1),
    payload: parseJson(row.payload_json as string | null | undefined),
    createdAt: String(row.created_at || ''),
  }
}

function mapRun(row: Record<string, unknown>): WorkflowNodeRun {
  return {
    id: Number(row.id),
    workflowTaskId: Number(row.workflow_task_id),
    novelId: Number(row.novel_id),
    chapterId: row.chapter_id == null ? null : Number(row.chapter_id),
    nodeKey: String(row.node_key || ''),
    attempt: Number(row.attempt || 1),
    status: String(row.status || 'pending') as WorkflowNodeStatus,
    inputHash: String(row.input_hash || ''),
    upstreamSnapshotId: row.upstream_snapshot_id == null ? null : String(row.upstream_snapshot_id),
    contextVersion: Number(row.context_version || 1),
    snapshotId: row.snapshot_id == null ? null : String(row.snapshot_id),
    retryOfNodeRunId: row.retry_of_node_run_id == null ? null : Number(row.retry_of_node_run_id),
    retryReason: row.retry_reason == null ? null : String(row.retry_reason),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseExpiresAt: row.lease_expires_at == null ? null : String(row.lease_expires_at),
    errorClass: row.error_class == null ? null : String(row.error_class),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    startedAt: row.started_at == null ? null : String(row.started_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export function hashWorkflowNodeInput(value: unknown): string {
  return `sha256:${createHash('sha256').update(jsonText(value)).digest('hex')}`
}

export function beginWorkflowNode(input: BeginWorkflowNodeInput): WorkflowNodeLease {
  const workflowTaskId = requirePositive(input.workflowTaskId, 'workflowTaskId')
  const novelId = requirePositive(input.novelId, 'novelId')
  const nodeKey = requireText(input.nodeKey, 'nodeKey')
  const inputHash = requireText(input.inputHash, 'inputHash')
  const contextVersion = requirePositive(input.contextVersion, 'contextVersion')
  const leaseMs = Math.max(30_000, Math.min(30 * 60_000, Math.floor(input.leaseMs || 10 * 60_000)))
  const leaseOwner = requireText(input.leaseOwner || `electron:${process.pid}`, 'leaseOwner')
  const retryOfNodeRunId = input.retryOfNodeRunId == null
    ? null
    : requirePositive(input.retryOfNodeRunId, 'retryOfNodeRunId')
  const retryReason = input.retryReason?.trim() || null

  return runTransaction(() => {
    const sqlite = getSqlite()
    const active = sqlite.prepare(`
      SELECT * FROM workflow_node_runs
      WHERE workflow_task_id = ? AND node_key = ?
        AND status IN ('leased', 'running')
      ORDER BY attempt DESC, id DESC
      LIMIT 1
    `).get(workflowTaskId, nodeKey) as Record<string, unknown> | undefined
    if (active && !isExpired(active.lease_expires_at)) {
      throw new WorkflowNodeError('LEASE_CONFLICT', `节点 ${nodeKey} 当前由其他 Worker 执行。`)
    }
    if (active && isExpired(active.lease_expires_at)) {
      sqlite.prepare(`
        UPDATE workflow_node_runs
        SET status = 'failed', error_class = 'lease_expired',
            error_message = '节点租约过期，已由后续尝试接管。',
            lease_token = NULL, lease_expires_at = NULL,
            finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('leased', 'running')
      `).run(nowIso(), nowIso(), Number(active.id))
    }

    const latest = sqlite.prepare(`
      SELECT MAX(attempt) AS max_attempt FROM workflow_node_runs
      WHERE workflow_task_id = ? AND node_key = ?
    `).get(workflowTaskId, nodeKey) as { max_attempt?: number | null }
    const attempt = Number(latest?.max_attempt || 0) + 1
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()
    const now = nowIso()
    const result = sqlite.prepare(`
      INSERT INTO workflow_node_runs (
        workflow_task_id, novel_id, chapter_id, node_key, attempt, status,
        input_hash, upstream_snapshot_id, context_version,
        retry_of_node_run_id, retry_reason,
        lease_owner, lease_token, lease_expires_at, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowTaskId,
      novelId,
      input.chapterId == null ? null : requirePositive(input.chapterId, 'chapterId'),
      nodeKey,
      attempt,
      inputHash,
      input.upstreamSnapshotId || null,
      contextVersion,
      retryOfNodeRunId,
      retryReason,
      leaseOwner,
      leaseToken,
      leaseExpiresAt,
      now,
      now,
      now,
    )
    return {
      nodeRunId: Number(result.lastInsertRowid),
      workflowTaskId,
      nodeKey,
      attempt,
      inputHash,
      contextVersion,
      leaseOwner,
      leaseToken,
      leaseExpiresAt,
    }
  })
}

export function renewWorkflowNodeLease(nodeRunId: number, leaseToken: string, leaseMs = 10 * 60_000): string {
  const id = requirePositive(nodeRunId, 'nodeRunId')
  const token = requireText(leaseToken, 'leaseToken')
  const expiresAt = new Date(Date.now() + Math.max(30_000, Math.min(30 * 60_000, Math.floor(leaseMs)))).toISOString()
  const result = getSqlite().prepare(`
    UPDATE workflow_node_runs
    SET lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND lease_token = ? AND status IN ('leased', 'running')
  `).run(expiresAt, nowIso(), id, token)
  if (!result.changes) throw new WorkflowNodeError('LEASE_EXPIRED', '节点租约已失效，不能续租。')
  return expiresAt
}

export function recordWorkflowNodeSnapshot(input: {
  nodeRunId: number
  leaseToken: string
  payload: unknown
  outputHash?: string
}): WorkflowNodeSnapshot {
  const nodeRunId = requirePositive(input.nodeRunId, 'nodeRunId')
  const leaseToken = requireText(input.leaseToken, 'leaseToken')
  return runTransaction(() => {
    const sqlite = getSqlite()
    const node = getNodeRow(nodeRunId)
    if (!node) throw new WorkflowNodeError('NODE_NOT_FOUND', `找不到节点运行 ${nodeRunId}。`)
    if (node.snapshot_id) {
      const existing = getSnapshotRow(String(node.snapshot_id))
      if (existing) return mapSnapshot(existing)
    }
    if (String(node.lease_token || '') !== leaseToken || isExpired(node.lease_expires_at)) {
      throw new WorkflowNodeError('LEASE_EXPIRED', '节点租约已失效，不能写入快照。')
    }
    const snapshotId = `ws_${randomUUID()}`
    const payloadJson = jsonText(input.payload)
    const outputHash = input.outputHash?.trim() || hashWorkflowNodeInput(input.payload)
    const createdAt = nowIso()
    sqlite.prepare(`
      INSERT INTO workflow_node_snapshots (
        id, node_run_id, workflow_task_id, novel_id, chapter_id,
        node_key, attempt, input_hash, output_hash, context_version,
        payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      nodeRunId,
      Number(node.workflow_task_id),
      Number(node.novel_id),
      node.chapter_id == null ? null : Number(node.chapter_id),
      String(node.node_key),
      Number(node.attempt),
      String(node.input_hash),
      outputHash,
      Number(node.context_version || 1),
      payloadJson,
      createdAt,
    )
    sqlite.prepare(`
      UPDATE workflow_node_runs
      SET status = 'produced', snapshot_id = ?, lease_token = NULL,
          lease_expires_at = NULL, finished_at = ?, updated_at = ?
      WHERE id = ? AND lease_token = ? AND status IN ('leased', 'running')
    `).run(snapshotId, createdAt, createdAt, nodeRunId, leaseToken)
    const updated = sqlite.prepare('SELECT status, snapshot_id FROM workflow_node_runs WHERE id = ?').get(nodeRunId) as Record<string, unknown> | undefined
    if (!updated || String(updated.status || '') !== 'produced' || String(updated.snapshot_id || '') !== snapshotId) {
      throw new WorkflowNodeError('SNAPSHOT_CONFLICT', '节点租约已被其他尝试抢占，快照未提交。')
    }
    const snapshot = getSnapshotRow(snapshotId)
    if (!snapshot) throw new WorkflowNodeError('SNAPSHOT_CONFLICT', '节点快照写入后无法读取。')
    return mapSnapshot(snapshot)
  })
}

export function failWorkflowNode(input: {
  nodeRunId: number
  leaseToken: string
  status?: Extract<WorkflowNodeStatus, 'failed' | 'blocked' | 'cancelled'>
  errorClass?: string
  errorMessage?: string
}): void {
  const nodeRunId = requirePositive(input.nodeRunId, 'nodeRunId')
  const leaseToken = requireText(input.leaseToken, 'leaseToken')
  const status = input.status || 'failed'
  const now = nowIso()
  const result = getSqlite().prepare(`
    UPDATE workflow_node_runs
    SET status = ?, error_class = ?, error_message = ?,
        lease_token = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
    WHERE id = ? AND lease_token = ? AND status IN ('leased', 'running')
  `).run(
    status,
    input.errorClass?.trim() || null,
    input.errorMessage?.trim() || null,
    now,
    now,
    nodeRunId,
    leaseToken,
  )
  if (!result.changes) throw new WorkflowNodeError('LEASE_EXPIRED', '节点租约已失效，不能记录失败。')
}

export function markWorkflowNodeCommitted(nodeRunId: number): void {
  const id = requirePositive(nodeRunId, 'nodeRunId')
  const result = getSqlite().prepare(`
    UPDATE workflow_node_runs
    SET status = 'committed', updated_at = ?
    WHERE id = ? AND status IN ('produced', 'validated', 'approved')
  `).run(nowIso(), id)
  if (!result.changes) throw new WorkflowNodeError('NODE_NOT_FOUND', '节点尚未产生可提交的快照。')
}

export function getLatestWorkflowNodeSnapshot(workflowTaskId: number, nodeKey: string): WorkflowNodeSnapshot | null {
  const taskId = requirePositive(workflowTaskId, 'workflowTaskId')
  const key = requireText(nodeKey, 'nodeKey')
  const row = getSqlite().prepare(`
    SELECT snapshot.*
    FROM workflow_node_snapshots snapshot
    WHERE snapshot.workflow_task_id = ? AND snapshot.node_key = ?
    ORDER BY snapshot.attempt DESC, snapshot.created_at DESC
    LIMIT 1
  `).get(taskId, key) as Record<string, unknown> | undefined
  return row ? mapSnapshot(row) : null
}

export function getWorkflowNodeRun(nodeRunId: number): WorkflowNodeRun | null {
  const id = requirePositive(nodeRunId, 'nodeRunId')
  const row = getNodeRow(id)
  return row ? mapRun(row) : null
}

export function listWorkflowNodeRuns(filters: {
  workflowTaskId?: number
  novelId?: number
  chapterId?: number
  nodeKey?: string
  limit?: number
} = {}): WorkflowNodeRun[] {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filters.workflowTaskId != null) {
    clauses.push('workflow_task_id = ?')
    params.push(requirePositive(filters.workflowTaskId, 'workflowTaskId'))
  }
  if (filters.novelId != null) {
    clauses.push('novel_id = ?')
    params.push(requirePositive(filters.novelId, 'novelId'))
  }
  if (filters.chapterId != null) {
    clauses.push('chapter_id = ?')
    params.push(requirePositive(filters.chapterId, 'chapterId'))
  }
  if (filters.nodeKey?.trim()) {
    clauses.push('node_key = ?')
    params.push(filters.nodeKey.trim())
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filters.limit || 100)))
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = getSqlite().prepare(`
    SELECT * FROM workflow_node_runs
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `).all(...params) as Array<Record<string, unknown>>
  return rows.map(mapRun)
}

export function getWorkflowNodeSnapshot(snapshotId: string): WorkflowNodeSnapshot | null {
  const id = requireText(snapshotId, 'snapshotId')
  const row = getSnapshotRow(id)
  return row ? mapSnapshot(row) : null
}

export interface WorkflowNodeRetryPlan {
  source: WorkflowNodeRun
  latestSnapshot: WorkflowNodeSnapshot | null
  upstreamSnapshot: WorkflowNodeSnapshot | null
}

export function prepareWorkflowNodeRetry(nodeRunId: number): WorkflowNodeRetryPlan {
  const source = getWorkflowNodeRun(nodeRunId)
  if (!source) throw new WorkflowNodeError('NODE_NOT_FOUND', `找不到节点运行 ${nodeRunId}。`)
  if (!['failed', 'blocked', 'cancelled'].includes(source.status)) {
    throw new WorkflowNodeError('SNAPSHOT_CONFLICT', `节点 ${source.nodeKey} 当前状态不可重试。`)
  }
  const active = listWorkflowNodeRuns({
    workflowTaskId: source.workflowTaskId,
    nodeKey: source.nodeKey,
    limit: 20,
  }).find((item) => ['leased', 'running'].includes(item.status) && !isExpired(item.leaseExpiresAt))
  if (active) throw new WorkflowNodeError('LEASE_CONFLICT', `节点 ${source.nodeKey} 已有运行中的重试。`)
  return {
    source,
    latestSnapshot: source.snapshotId ? getWorkflowNodeSnapshot(source.snapshotId) : null,
    upstreamSnapshot: source.upstreamSnapshotId ? getWorkflowNodeSnapshot(source.upstreamSnapshotId) : null,
  }
}
