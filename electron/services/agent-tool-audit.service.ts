import { createHash, randomUUID } from 'node:crypto'
import type { AgentToolAuditEvent } from '../application/tool-registry'
import { getSqlite } from '../database/db'

export interface AgentToolInvocationQuery {
  novelId: number
  toolId?: string
  actorType?: string
  status?: 'success' | 'error' | 'denied'
  limit?: number
}

export interface AgentToolInvocationView {
  id: string
  novelId: number | null
  runId: string
  toolId: string
  toolVersion: string
  inputHash: string
  redactedInput: Record<string, unknown>
  effect: string
  approvalId: string | null
  actorType: string
  actorId: string
  clientId: string
  status: 'success' | 'error' | 'denied'
  durationMs: number
  errorCode: string | null
  outputHash: string | null
  createdAt: string
  completedAt: string
}

interface InvocationRow {
  id: string
  novel_id: number | null
  run_id: string
  tool_id: string
  tool_version: string
  input_hash: string
  redacted_input_json: string
  effect: string
  approval_id: string | null
  actor_type: string
  actor_id: string
  client_id: string
  status: 'success' | 'error' | 'denied'
  duration_ms: number
  error_code: string | null
  output_hash: string | null
  created_at: string
  completed_at: string
}

const SENSITIVE_KEY_PATTERN = /(?:api.?key|token|secret|password|authorization|cookie|approval.?id)/iu
const LARGE_TEXT_KEY_PATTERN = /(?:content|prompt|messages|raw.?output|source.?text|chapter.?text)/iu

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function redact(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    if (LARGE_TEXT_KEY_PATTERN.test(key) || value.length > 1000) {
      return { redacted: true, chars: value.length, hash: hash(value) }
    }
    return value
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 6) return { redacted: true, reason: 'depth_limit', hash: hash(value) }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, child]) => [childKey, redact(child, childKey, depth + 1)]),
    )
  }
  return String(value)
}

function inferNovelId(input: Record<string, unknown> | undefined): number | null {
  const candidate = typeof input?.novelId === 'number' && Number.isInteger(input.novelId) && input.novelId > 0
    ? input.novelId
    : null
  if (!candidate) return null
  const exists = getSqlite().prepare('SELECT 1 FROM novels WHERE id = ?').get(candidate)
  return exists ? candidate : null
}

export function recordAgentToolInvocation(event: AgentToolAuditEvent): void {
  const descriptor = event.descriptor
  const errorCode = event.result.ok ? null : event.result.error.code
  const denied = errorCode === 'AUTH_SCOPE_REQUIRED'
    || errorCode === 'APPROVAL_REQUIRED'
    || errorCode === 'TOOL_NOT_FOUND'
  const status: InvocationRow['status'] = event.result.ok ? 'success' : denied ? 'denied' : 'error'
  const input = event.request.input || {}
  getSqlite().prepare(`
    INSERT INTO tool_invocations (
      id, novel_id, run_id, tool_id, tool_version, input_hash,
      redacted_input_json, effect, approval_id,
      actor_type, actor_id, client_id, status, duration_ms,
      error_code, output_hash, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `inv_${randomUUID()}`,
    inferNovelId(input),
    event.result.meta.runId,
    event.request.toolId || '(empty)',
    descriptor?.version || '0.0.0',
    hash(input),
    JSON.stringify(redact(input) || {}),
    descriptor?.effect || 'read',
    event.context.approvalId || null,
    event.context.actor.type,
    event.context.actor.actorId,
    event.context.actor.clientId,
    status,
    event.result.meta.durationMs,
    errorCode,
    event.result.ok ? hash(event.result.data) : hash(event.result.error),
    event.result.meta.requestedAt,
    event.result.meta.completedAt,
  )
}

function mapRow(row: InvocationRow): AgentToolInvocationView {
  let redactedInput: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.redacted_input_json) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) redactedInput = parsed as Record<string, unknown>
  } catch {
    // Historical malformed audit JSON remains queryable through hashes.
  }
  return {
    id: row.id,
    novelId: row.novel_id,
    runId: row.run_id,
    toolId: row.tool_id,
    toolVersion: row.tool_version,
    inputHash: row.input_hash,
    redactedInput,
    effect: row.effect,
    approvalId: row.approval_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    clientId: row.client_id,
    status: row.status,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    outputHash: row.output_hash,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export function queryAgentToolInvocations(query: AgentToolInvocationQuery): AgentToolInvocationView[] {
  const clauses = ['novel_id = ?']
  const params: Array<string | number> = [query.novelId]
  if (query.toolId?.trim()) {
    clauses.push('tool_id = ?')
    params.push(query.toolId.trim())
  }
  if (query.actorType?.trim()) {
    clauses.push('actor_type = ?')
    params.push(query.actorType.trim())
  }
  if (query.status) {
    clauses.push('status = ?')
    params.push(query.status)
  }
  const limit = Math.max(1, Math.min(query.limit || 100, 500))
  const rows = getSqlite().prepare(`
    SELECT * FROM tool_invocations
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params, limit) as InvocationRow[]
  return rows.map(mapRow)
}
