/**
 * Pure presentation helpers for the character batch-generation progress event
 * (`character:batch-progress`, payload { batch, total, newIds }).
 * `newIds` is the cumulative list of created character ids, so its length is
 * the total produced so far — not the per-batch increment.
 */

export interface CharacterBatchProgress {
  batch: number
  total: number
  producedCount: number
}

export function parseCharacterBatchProgress(payload: unknown): CharacterBatchProgress | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const batch = Number(record.batch)
  const total = Number(record.total)
  if (!Number.isFinite(batch) || batch <= 0 || !Number.isFinite(total) || total <= 0) return null
  const newIds = Array.isArray(record.newIds) ? record.newIds : []
  return {
    batch: Math.floor(batch),
    total: Math.floor(total),
    producedCount: newIds.length,
  }
}

export function formatCharacterBatchProgress(progress: CharacterBatchProgress): { percent: number; text: string } {
  const boundedBatch = Math.min(progress.batch, progress.total)
  return {
    percent: Math.min(100, Math.round((boundedBatch / progress.total) * 100)),
    text: `第 ${boundedBatch}/${progress.total} 批，已产出 ${progress.producedCount} 人`,
  }
}
