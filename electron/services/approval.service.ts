import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentToolActor,
  AgentToolApprovalResult,
  AgentToolCallRequest,
} from '../../src/shared/tool-contracts'
import { getSqlite } from '../database/db'

interface ApprovalRow {
  id: string
  novel_id: number | null
  tool_id: string
  input_hash: string
  actor_type: AgentToolActor['type']
  actor_id: string
  client_id: string
  session_id: string | null
  status: 'approved' | 'consumed' | 'rejected' | 'expired'
  expires_at: string
  consumed_at: string | null
  created_at: string | null
}

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

export function hashApprovalRequest(request: AgentToolCallRequest): string {
  const binding = {
    toolId: request.toolId,
    input: request.input || {},
    idempotencyKey: request.idempotencyKey || null,
    expectedVersion: request.expectedVersion ?? null,
  }
  return `sha256:${createHash('sha256').update(canonical(binding)).digest('hex')}`
}

export function createApprovalGrant(input: {
  request: AgentToolCallRequest
  actor: AgentToolActor
  ttlMs?: number
}): AgentToolApprovalResult {
  const now = Date.now()
  const expiresAt = new Date(now + Math.max(30_000, Math.min(input.ttlMs || 120_000, 10 * 60_000))).toISOString()
  const approvalId = `approval_${randomUUID()}`
  const novelId = typeof input.request.input?.novelId === 'number' && Number.isInteger(input.request.input.novelId)
    ? input.request.input.novelId
    : null
  getSqlite().prepare(`
    INSERT INTO approval_grants (
      id, novel_id, tool_id, input_hash, actor_type, actor_id,
      client_id, session_id, status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)
  `).run(
    approvalId,
    novelId,
    input.request.toolId,
    hashApprovalRequest(input.request),
    input.actor.type,
    input.actor.actorId,
    input.actor.clientId,
    input.actor.sessionId || null,
    expiresAt,
  )
  return { approved: true, approvalId, expiresAt }
}

export function consumeApprovalGrant(input: {
  approvalId: string
  request: AgentToolCallRequest
  actor: AgentToolActor
}): boolean {
  const sqlite = getSqlite()
  return sqlite.transaction(() => {
    const row = sqlite.prepare('SELECT * FROM approval_grants WHERE id = ?').get(input.approvalId) as ApprovalRow | undefined
    if (!row || row.status !== 'approved') return false
    if (Date.parse(row.expires_at) <= Date.now()) {
      sqlite.prepare(`UPDATE approval_grants SET status = 'expired' WHERE id = ? AND status = 'approved'`).run(row.id)
      return false
    }
    const actorMatches = row.actor_type === input.actor.type
      && row.actor_id === input.actor.actorId
      && row.client_id === input.actor.clientId
      && (row.session_id || null) === (input.actor.sessionId || null)
    const requestMatches = row.tool_id === input.request.toolId
      && row.input_hash === hashApprovalRequest(input.request)
    if (!actorMatches || !requestMatches) return false
    const result = sqlite.prepare(`
      UPDATE approval_grants
      SET status = 'consumed', consumed_at = ?
      WHERE id = ? AND status = 'approved'
    `).run(new Date().toISOString(), row.id)
    return result.changes === 1
  })()
}
