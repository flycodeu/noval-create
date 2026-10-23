import type { AuthorClue } from './author-ledger'

export interface ClueMergeReference {
  table: 'chapter_contracts' | 'scene_contracts' | 'revision_tasks' | 'asset_change_impacts'
  id: number
  chapterId: number | null
  field: string
  before: string | number
  after: string | number
}
export interface ClueMergePreview {
  contextVersion: number
  fingerprint: string
  keep: AuthorClue
  sources: AuthorClue[]
  references: ClueMergeReference[]
  differences: Array<{ id: number; fields: Array<{ field: string; label: string; kept: string | number | null; original: string | number | null }> }>
  blockers: string[]
  inheritedLinks: Record<string, number | null>
  aliasIds: number[]
}

export function selectClueMergeKeep(selection: { keepId: number; sourceIds: number[] }, keepId: number) {
  // Swapping roles within the selected group must retain the previous keep item.
  return { keepId, sourceIds: selection.sourceIds.map(id => id === keepId ? selection.keepId : id) }
}

function referenceId(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Only explicit IDs are rewritten. Natural-language mentions and unrelated asset IDs stay intact. */
export function remapForeshadowReferences(values: unknown[], ids: ReadonlySet<number>, keepId: number, assetRefs = false): unknown[] {
  let changed = false
  const mapped = values.map(value => {
    if (!assetRefs) {
      const id = referenceId(value)
      if (id === null || !ids.has(id)) return value
      changed = true
      return keepId
    }
    if (typeof value === 'string') {
      const match = /^foreshadow\s*[:#]\s*(\d+)$/iu.exec(value.trim())
      if (!match || !ids.has(Number(match[1]))) return value
      changed = true
      return `foreshadow:${keepId}`
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ref = value as Record<string, unknown>
      if (!['foreshadow', 'foreshadow_ledger'].includes(String(ref.type ?? ref.assetType ?? ref.entityType).toLowerCase())) return value
      const key = ['id', 'assetId', 'entityId', 'refId'].find(field => ref[field] !== undefined)
      if (key && ids.has(Number(ref[key]))) {
        changed = true
        return { ...ref, [key]: typeof ref[key] === 'string' ? String(keepId) : keepId }
      }
    }
    return value
  })
  if (!changed) return values
  const seen = new Set<string>()
  return mapped.filter(value => {
    let key: string | undefined
    if (!assetRefs && referenceId(value) === keepId) key = `foreshadow:${keepId}`
    else if (assetRefs && typeof value === 'string' && Number(/^foreshadow\s*[:#]\s*(\d+)$/iu.exec(value.trim())?.[1]) === keepId) key = `foreshadow:${keepId}`
    else if (assetRefs && value && typeof value === 'object') {
      const ref = value as Record<string, unknown>
      if (['foreshadow', 'foreshadow_ledger'].includes(String(ref.type ?? ref.assetType ?? ref.entityType).toLowerCase()) && Number(ref.id ?? ref.assetId ?? ref.entityId ?? ref.refId) === keepId) key = JSON.stringify(ref)
    }
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}
