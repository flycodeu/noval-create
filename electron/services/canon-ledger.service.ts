import { createHash } from 'node:crypto'
import { getSqlite } from '../database/db'

export type CanonCommitStatus = 'candidate' | 'committed' | 'rejected'
export type CanonLedgerEntryType = 'event' | 'state_delta' | 'knowledge'

export interface CanonLedgerEntryInput {
  entryType: CanonLedgerEntryType
  entityType: string
  entityId?: number | null
  stateKey?: string | null
  eventType?: string | null
  summary?: string | null
  beforeState?: unknown
  afterState?: unknown
  evidence?: unknown
  confidence?: number
  idempotencyKey?: string
}

export interface RecordCommittedCanonLedgerInput {
  novelId: number
  chapterId?: number | null
  segmentId?: number | null
  sourceRunId?: number | null
  sourceArtifactId?: string | null
  inputHash: string
  idempotencyKey: string
  contextVersionBefore: number
  contextVersionAfter: number
  payload?: unknown
  entries: CanonLedgerEntryInput[]
}

export interface CanonCommitRecord {
  id: number
  novelId: number
  chapterId: number | null
  segmentId: number | null
  sourceRunId: number | null
  sourceArtifactId: string | null
  inputHash: string
  idempotencyKey: string
  contextVersionBefore: number
  contextVersionAfter: number | null
  status: CanonCommitStatus
  entryCount: number
  payload: unknown
  createdAt: string
  committedAt: string | null
}

export interface CanonLedgerEntryRecord {
  id: number
  commitId: number
  novelId: number
  chapterId: number | null
  segmentId: number | null
  entryType: CanonLedgerEntryType
  entityType: string
  entityId: number | null
  stateKey: string | null
  eventType: string | null
  summary: string | null
  beforeState: unknown
  afterState: unknown
  evidence: unknown
  confidence: number
  idempotencyKey: string
  createdAt: string
}

export class CanonLedgerError extends Error {
  readonly code: 'INVALID_INPUT' | 'IDEMPOTENCY_CONFLICT' | 'CONTEXT_VERSION_CONFLICT' | 'COMMIT_NOT_FOUND'

  constructor(code: CanonLedgerError['code'], message: string) {
    super(message)
    this.name = 'CanonLedgerError'
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

function jsonText(value: unknown, fallback: unknown = {}): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(sortJson(JSON.parse(value)))
    } catch {
      return JSON.stringify(value)
    }
  }
  return JSON.stringify(sortJson(value === undefined ? fallback : value))
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function textValue(value: unknown, maxLength = 4000): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function positiveId(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function boundedConfidence(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0
}

function normalizeEntryType(value: string): CanonLedgerEntryType {
  if (value === 'event' || value === 'state_delta' || value === 'knowledge') return value
  throw new CanonLedgerError('INVALID_INPUT', `不支持的正典账本类型：${value}`)
}

function normalizeEntry(input: CanonLedgerEntryInput, index: number): Required<Pick<CanonLedgerEntryInput, 'entryType' | 'entityType'>> & {
  entityId: number | null
  stateKey: string | null
  eventType: string | null
  summary: string | null
  beforeJson: string | null
  afterJson: string | null
  evidenceJson: string
  confidence: number
  idempotencyKey: string
} {
  const entityType = textValue(input.entityType, 120)
  if (!entityType) throw new CanonLedgerError('INVALID_INPUT', `第 ${index + 1} 条账本记录缺少实体类型。`)
  const entryType = normalizeEntryType(input.entryType)
  const entityId = positiveId(input.entityId)
  const stateKey = textValue(input.stateKey, 160)
  const eventType = textValue(input.eventType, 160)
  const summary = textValue(input.summary)
  const beforeJson = input.beforeState === undefined ? null : jsonText(input.beforeState)
  const afterJson = input.afterState === undefined ? null : jsonText(input.afterState)
  const evidenceJson = jsonText(input.evidence, {})
  const suppliedKey = textValue(input.idempotencyKey, 240)
  const generatedKey = [entryType, entityType, entityId || 'none', stateKey || eventType || `entry-${index}`].join(':')
  return {
    entryType,
    entityType,
    entityId,
    stateKey,
    eventType,
    summary,
    beforeJson,
    afterJson,
    evidenceJson,
    confidence: boundedConfidence(input.confidence),
    idempotencyKey: suppliedKey || generatedKey,
  }
}

function requirePositive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CanonLedgerError('INVALID_INPUT', `${label}必须是正整数。`)
  }
  return value
}

function requireText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new CanonLedgerError('INVALID_INPUT', `${label}不能为空。`)
  return normalized
}

function mapCommit(row: Record<string, unknown>): CanonCommitRecord {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    chapterId: row.chapter_id == null ? null : Number(row.chapter_id),
    segmentId: row.segment_id == null ? null : Number(row.segment_id),
    sourceRunId: row.source_run_id == null ? null : Number(row.source_run_id),
    sourceArtifactId: typeof row.source_artifact_id === 'string' ? row.source_artifact_id : null,
    inputHash: String(row.input_hash || ''),
    idempotencyKey: String(row.idempotency_key || ''),
    contextVersionBefore: Number(row.context_version_before || 1),
    contextVersionAfter: row.context_version_after == null ? null : Number(row.context_version_after),
    status: String(row.status || 'candidate') as CanonCommitStatus,
    entryCount: Number(row.entry_count || 0),
    payload: parseJson(row.payload_json as string | null | undefined),
    createdAt: String(row.created_at || ''),
    committedAt: typeof row.committed_at === 'string' ? row.committed_at : null,
  }
}

function mapEntry(row: Record<string, unknown>): CanonLedgerEntryRecord {
  return {
    id: Number(row.id),
    commitId: Number(row.commit_id),
    novelId: Number(row.novel_id),
    chapterId: row.chapter_id == null ? null : Number(row.chapter_id),
    segmentId: row.segment_id == null ? null : Number(row.segment_id),
    entryType: String(row.entry_type || 'state_delta') as CanonLedgerEntryType,
    entityType: String(row.entity_type || ''),
    entityId: row.entity_id == null ? null : Number(row.entity_id),
    stateKey: typeof row.state_key === 'string' ? row.state_key : null,
    eventType: typeof row.event_type === 'string' ? row.event_type : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    beforeState: parseJson(row.before_json as string | null | undefined),
    afterState: parseJson(row.after_json as string | null | undefined),
    evidence: parseJson(row.evidence_json as string | null | undefined),
    confidence: Number(row.confidence || 0),
    idempotencyKey: String(row.idempotency_key || ''),
    createdAt: String(row.created_at || ''),
  }
}

function getCommitByKey(novelId: number, idempotencyKey: string): Record<string, unknown> | undefined {
  return getSqlite().prepare(`
    SELECT * FROM canon_commits
    WHERE novel_id = ? AND idempotency_key = ?
  `).get(novelId, idempotencyKey) as Record<string, unknown> | undefined
}

function getCommitById(commitId: number): Record<string, unknown> | undefined {
  return getSqlite().prepare('SELECT * FROM canon_commits WHERE id = ?').get(commitId) as Record<string, unknown> | undefined
}

function runTransaction<T>(work: () => T): T {
  const sqlite = getSqlite()
  const transaction = sqlite.transaction(work)
  return sqlite.inTransaction || typeof transaction.immediate !== 'function'
    ? transaction()
    : transaction.immediate()
}

export function hashCanonInput(value: unknown): string {
  return `sha256:${createHash('sha256').update(jsonText(value)).digest('hex')}`
}

export function buildWritebackCanonIdempotencyKey(runId: number): string {
  return `chapter-writeback:${requirePositive(runId, 'runId')}`
}

export function recordCommittedCanonLedger(input: RecordCommittedCanonLedgerInput): CanonCommitRecord | null {
  const novelId = requirePositive(input.novelId, 'novelId')
  const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey')
  const inputHash = requireText(input.inputHash, 'inputHash')
  const contextVersionBefore = requirePositive(input.contextVersionBefore, 'contextVersionBefore')
  const contextVersionAfter = requirePositive(input.contextVersionAfter, 'contextVersionAfter')
  if (contextVersionAfter < contextVersionBefore) {
    throw new CanonLedgerError('INVALID_INPUT', 'contextVersionAfter 不能小于 contextVersionBefore。')
  }
  const entries = input.entries.map(normalizeEntry)
  if (entries.length === 0) return null

  return runTransaction(() => {
    const existing = getCommitByKey(novelId, idempotencyKey)
    if (existing) {
      if (String(existing.input_hash || '') !== inputHash) {
        throw new CanonLedgerError('IDEMPOTENCY_CONFLICT', '正典提交幂等键已对应不同输入。')
      }
      return mapCommit(existing)
    }

    const currentNovel = getSqlite().prepare(`
      SELECT context_version FROM novels WHERE id = ?
    `).get(novelId) as { context_version?: number | null } | undefined
    if (!currentNovel) throw new CanonLedgerError('INVALID_INPUT', `找不到小说 ${novelId}。`)
    if (Number(currentNovel.context_version || 1) !== contextVersionAfter) {
      throw new CanonLedgerError('CONTEXT_VERSION_CONFLICT', '正典提交的上下文版本与当前小说版本不一致。')
    }

    const now = new Date().toISOString()
    const commitResult = getSqlite().prepare(`
      INSERT INTO canon_commits (
        novel_id, chapter_id, segment_id, source_run_id, source_artifact_id,
        input_hash, idempotency_key, context_version_before, context_version_after,
        status, entry_count, payload_json, created_at, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?, ?, ?, ?)
    `).run(
      novelId,
      positiveId(input.chapterId),
      positiveId(input.segmentId),
      positiveId(input.sourceRunId),
      textValue(input.sourceArtifactId, 240),
      inputHash,
      idempotencyKey,
      contextVersionBefore,
      contextVersionAfter,
      entries.length,
      jsonText(input.payload, {}),
      now,
      now,
    )
    const commitId = Number(commitResult.lastInsertRowid)
    const insertEntry = getSqlite().prepare(`
      INSERT INTO canon_ledger_entries (
        commit_id, novel_id, chapter_id, segment_id, entry_type,
        entity_type, entity_id, state_key, event_type, summary,
        before_json, after_json, evidence_json, confidence, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    entries.forEach((entry) => {
      insertEntry.run(
        commitId,
        novelId,
        positiveId(input.chapterId),
        positiveId(input.segmentId),
        entry.entryType,
        entry.entityType,
        entry.entityId,
        entry.stateKey,
        entry.eventType,
        entry.summary,
        entry.beforeJson,
        entry.afterJson,
        entry.evidenceJson,
        entry.confidence,
        entry.idempotencyKey,
        now,
      )
    })
    return mapCommit(getCommitById(commitId) as Record<string, unknown>)
  })
}

export function getCanonCommit(commitId: number): CanonCommitRecord | null {
  const row = getCommitById(requirePositive(commitId, 'commitId'))
  return row ? mapCommit(row) : null
}

export function listCanonLedgerEntries(input: {
  novelId: number
  chapterId?: number
  entityType?: string
  limit?: number
}): CanonLedgerEntryRecord[] {
  const novelId = requirePositive(input.novelId, 'novelId')
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit || 100)))
  const clauses = ['novel_id = ?']
  const params: Array<number | string> = [novelId]
  if (input.chapterId !== undefined) {
    clauses.push('chapter_id = ?')
    params.push(requirePositive(input.chapterId, 'chapterId'))
  }
  if (input.entityType?.trim()) {
    clauses.push('entity_type = ?')
    params.push(input.entityType.trim())
  }
  const rows = getSqlite().prepare(`
    SELECT * FROM canon_ledger_entries
    WHERE ${clauses.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>
  return rows.map(mapEntry)
}

export function listCanonCommitEntries(commitId: number): CanonLedgerEntryRecord[] {
  const id = requirePositive(commitId, 'commitId')
  const rows = getSqlite().prepare(`
    SELECT * FROM canon_ledger_entries
    WHERE commit_id = ?
    ORDER BY id ASC
  `).all(id) as Array<Record<string, unknown>>
  return rows.map(mapEntry)
}

