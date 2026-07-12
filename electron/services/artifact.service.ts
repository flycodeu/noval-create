import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentArtifact,
  AgentArtifactListQuery,
  AgentArtifactStatus,
  CreateAgentArtifactInput,
} from '../../src/shared/agent-artifacts'
import { getSqlite } from '../database/db'
import { ArtifactServiceError } from '../application/artifact-error'

interface ArtifactDbRow {
  id: string
  novel_id: number
  kind: string
  status: AgentArtifactStatus
  version: number
  parent_artifact_id: string | null
  content_json: string
  content_hash: string
  context_version: number
  producer_type: AgentArtifact['producerType']
  producer_id: string
  producer_client: string
  model_config_id: number | null
  task_id: number | null
  review_artifact_id: string | null
  committed_entity_ids_json: string
  idempotency_key: string | null
  created_at: string | null
  updated_at: string | null
}

export { ArtifactServiceError }

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForCanonicalJson(child)]),
  )
}

export function canonicalArtifactJson(content: unknown): string {
  return JSON.stringify(sortForCanonicalJson(content))
}

export function hashArtifactContent(content: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalArtifactJson(content)).digest('hex')}`
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0)
      : []
  } catch {
    return []
  }
}

function parseContent<T>(raw: string): T {
  return JSON.parse(raw) as T
}

function mapArtifact<T>(row: ArtifactDbRow): AgentArtifact<T> {
  return {
    id: row.id,
    novelId: row.novel_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    parentArtifactId: row.parent_artifact_id,
    content: parseContent<T>(row.content_json),
    contentHash: row.content_hash,
    contextVersion: row.context_version,
    producerType: row.producer_type,
    producerId: row.producer_id,
    producerClient: row.producer_client,
    modelConfigId: row.model_config_id,
    taskId: row.task_id,
    reviewArtifactId: row.review_artifact_id,
    committedEntityIds: parseNumberArray(row.committed_entity_ids_json),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at || new Date(0).toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date(0).toISOString(),
  }
}

function getRow(id: string): ArtifactDbRow | undefined {
  return getSqlite().prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactDbRow | undefined
}

export function getArtifact<T = unknown>(id: string): AgentArtifact<T> | null {
  const row = getRow(id)
  return row ? mapArtifact<T>(row) : null
}

export function requireArtifact<T = unknown>(id: string): AgentArtifact<T> {
  const artifact = getArtifact<T>(id)
  if (!artifact) throw new ArtifactServiceError('ARTIFACT_NOT_FOUND', `找不到工件 ${id}。`)
  return artifact
}

export function findArtifactByIdempotency<T = unknown>(
  novelId: number,
  kind: string,
  idempotencyKey: string,
): AgentArtifact<T> | null {
  const row = getSqlite().prepare(`
    SELECT * FROM artifacts
    WHERE novel_id = ? AND kind = ? AND idempotency_key = ?
  `).get(novelId, kind, idempotencyKey.trim()) as ArtifactDbRow | undefined
  return row ? mapArtifact<T>(row) : null
}

export function createArtifact<T>(input: CreateAgentArtifactInput<T>): AgentArtifact<T> {
  const sqlite = getSqlite()
  const contentJson = canonicalArtifactJson(input.content)
  const contentHash = hashArtifactContent(input.content)
  const idempotencyKey = input.idempotencyKey?.trim() || null
  if (idempotencyKey) {
    const existing = sqlite.prepare(`
      SELECT * FROM artifacts WHERE novel_id = ? AND kind = ? AND idempotency_key = ?
    `).get(input.novelId, input.kind, idempotencyKey) as ArtifactDbRow | undefined
    if (existing) {
      if (existing.content_hash !== contentHash) {
        throw new ArtifactServiceError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于不同的工件内容。')
      }
      return mapArtifact<T>(existing)
    }
  }

  let version = 1
  if (input.parentArtifactId) {
    const parent = getRow(input.parentArtifactId)
    if (!parent || parent.novel_id !== input.novelId) {
      throw new ArtifactServiceError('ARTIFACT_PARENT_INVALID', '父工件不存在或属于其他项目。')
    }
    const versionRow = sqlite.prepare(`
      SELECT MAX(version) AS max_version FROM artifacts
      WHERE id = ? OR parent_artifact_id = ?
    `).get(input.parentArtifactId, input.parentArtifactId) as { max_version?: number | null }
    version = Math.max(parent.version + 1, Number(versionRow.max_version || 0) + 1)
  }

  const id = input.id?.trim() || `art_${randomUUID()}`
  const existingId = getRow(id)
  if (existingId) {
    if (existingId.content_hash === contentHash && existingId.novel_id === input.novelId && existingId.kind === input.kind) {
      return mapArtifact<T>(existingId)
    }
    throw new ArtifactServiceError('ARTIFACT_ID_CONFLICT', `工件 ID ${id} 已存在且内容不同。`)
  }

  sqlite.prepare(`
    INSERT INTO artifacts (
      id, novel_id, kind, status, version, parent_artifact_id,
      content_json, content_hash, context_version,
      producer_type, producer_id, producer_client,
      model_config_id, task_id, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.novelId,
    input.kind,
    input.status || 'draft',
    version,
    input.parentArtifactId || null,
    contentJson,
    contentHash,
    input.contextVersion,
    input.producerType,
    input.producerId,
    input.producerClient,
    input.modelConfigId || null,
    input.taskId || null,
    idempotencyKey,
  )
  return mapArtifact<T>(getRow(id) as ArtifactDbRow)
}

export function updateArtifactLifecycle(
  id: string,
  patch: {
    status?: AgentArtifactStatus
    reviewArtifactId?: string | null
    committedEntityIds?: number[]
  },
): AgentArtifact {
  const current = requireArtifact(id)
  if (patch.reviewArtifactId) {
    const review = requireArtifact(patch.reviewArtifactId)
    if (review.novelId !== current.novelId) {
      throw new ArtifactServiceError('ARTIFACT_PARENT_INVALID', '审校工件属于其他项目。')
    }
  }
  getSqlite().prepare(`
    UPDATE artifacts
    SET status = ?, review_artifact_id = ?, committed_entity_ids_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.status || current.status,
    patch.reviewArtifactId === undefined ? current.reviewArtifactId : patch.reviewArtifactId,
    JSON.stringify(patch.committedEntityIds === undefined ? current.committedEntityIds : patch.committedEntityIds),
    new Date().toISOString(),
    id,
  )
  return requireArtifact(id)
}

export function listArtifacts(query: AgentArtifactListQuery): AgentArtifact[] {
  const limit = Math.max(1, Math.min(query.limit || 50, 200))
  const clauses = ['novel_id = ?']
  const params: Array<string | number> = [query.novelId]
  if (query.kind) {
    clauses.push('kind = ?')
    params.push(query.kind)
  }
  if (query.status) {
    clauses.push('status = ?')
    params.push(query.status)
  }
  const rows = getSqlite().prepare(`
    SELECT * FROM artifacts
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params, limit) as ArtifactDbRow[]
  return rows.map((row) => mapArtifact(row))
}
