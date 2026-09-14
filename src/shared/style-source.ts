import { qualityIssueArtifactHash } from './quality-issue'

export interface StyleSourceRecord {
  id: number
  novelId: number | null
  sourceText: string | null
  fingerprintJson: string | null
  sourceType?: string | null
  sourceChapterIdsJson?: string | null
}

export interface StyleSourceApproval {
  version: 1
  status: 'approved' | 'revoked'
  digest: string
  approvedAt: string
  chapterDigests?: Array<{ chapterId: number; digest: string }>
}

/** Runtime-only material, resolved from the active record; never trusted from ThemeVoice JSON. */
export interface ApprovedStyleSample {
  text: string
  source: string
  digest: string
}

export function styleSourceDigest(record: StyleSourceRecord): string {
  return qualityIssueArtifactHash(JSON.stringify([record.id, record.novelId, record.sourceText,
    record.fingerprintJson, record.sourceType, record.sourceChapterIdsJson]))
}

export function parseStyleSettings(raw?: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* Old invalid settings have no approval. */ }
  return {}
}

export function readStyleApproval(raw?: string | null): StyleSourceApproval | null {
  const value = parseStyleSettings(raw).styleSourceApproval as Partial<StyleSourceApproval> | undefined
  return value?.version === 1 && (value.status === 'approved' || value.status === 'revoked')
    && typeof value.digest === 'string' && typeof value.approvedAt === 'string' ? value as StyleSourceApproval : null
}

export function styleSourceInvalidReason(record: StyleSourceRecord | null, novelId: number, approval: StyleSourceApproval | null): string | null {
  if (!record) return 'source_deleted'
  if (record.novelId !== novelId && !(record.novelId === null && record.sourceType === 'genre-default')) return 'wrong_novel'
  if (!approval || approval.status !== 'approved') return 'not_approved'
  if (approval.digest !== styleSourceDigest(record)) return 'source_changed'
  if (!record.sourceText?.trim()) return 'empty_source'
  return null
}

/** Generic settings updates cannot manufacture or erase a human approval. */
export function preserveStyleApproval(current: string | null | undefined, incoming: string): string {
  const next = parseStyleSettings(incoming)
  delete next.styleSourceApproval
  const existing = parseStyleSettings(current).styleSourceApproval
  if (existing !== undefined) next.styleSourceApproval = existing
  return JSON.stringify(next)
}
