import { createHash } from 'node:crypto'

export interface MemorySourceManifestSource {
  sourceKind: string
  sourceId: number | string
  sourceVersion: number | string
  artifactHash?: string
}

export interface MemorySourceManifestV1 {
  schemaVersion: 1
  contextVersion: number
  sources: MemorySourceManifestSource[]
  range: {
    startChapterNum: number
    endChapterNum: number
  }
  unresolvedRefs: string[]
}

export type MemorySourceManifestState = 'verified' | 'stale' | 'legacy' | 'invalid' | 'unresolved'

export interface ParsedMemorySourceManifest {
  state: MemorySourceManifestState
  manifest: MemorySourceManifestV1 | null
  requiredGaps: string[]
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, stableValue(child)]))
}

export function hashMemorySourceArtifact(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function normalizeIdentifier(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function normalizeSource(value: unknown): MemorySourceManifestSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const sourceKind = typeof record.sourceKind === 'string' ? record.sourceKind.trim() : ''
  const sourceId = normalizeIdentifier(record.sourceId)
  const sourceVersion = normalizeIdentifier(record.sourceVersion)
  const artifactHash = typeof record.artifactHash === 'string' && record.artifactHash.trim()
    ? record.artifactHash.trim()
    : undefined
  if (!sourceKind || sourceId === null || sourceVersion === null) return null
  return { sourceKind, sourceId, sourceVersion, ...(artifactHash ? { artifactHash } : {}) }
}

function sourceKey(source: MemorySourceManifestSource): string {
  return `${source.sourceKind}\u0000${String(source.sourceId)}\u0000${String(source.sourceVersion)}\u0000${source.artifactHash || ''}`
}

function normalizeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

export function createMemorySourceManifest(input: {
  contextVersion: number
  sources: MemorySourceManifestSource[]
  range: { startChapterNum: number; endChapterNum: number }
  unresolvedRefs?: string[]
}): MemorySourceManifestV1 {
  const contextVersion = Math.max(1, Math.floor(input.contextVersion || 1))
  const sources = [...new Map(input.sources
    .map(normalizeSource)
    .filter((source): source is MemorySourceManifestSource => Boolean(source))
    .map((source) => [sourceKey(source), source])).values()]
    .sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)))
  return {
    schemaVersion: 1,
    contextVersion,
    sources,
    range: {
      startChapterNum: Math.max(0, Math.floor(input.range.startChapterNum || 0)),
      endChapterNum: Math.max(0, Math.floor(input.range.endChapterNum || 0)),
    },
    unresolvedRefs: normalizeRefs(input.unresolvedRefs),
  }
}

export function createMemorySourceRef(
  sourceKind: string,
  sourceId: number | string,
  record: unknown,
  sourceVersion?: number | string | null,
): MemorySourceManifestSource {
  const artifactHash = hashMemorySourceArtifact(record)
  const normalizedVersion = normalizeIdentifier(sourceVersion)
  return {
    sourceKind,
    sourceId,
    sourceVersion: normalizedVersion ?? artifactHash.slice(0, 24),
    artifactHash,
  }
}

export function parseMemorySourceManifest(
  raw: string | null | undefined,
  expectedContextVersion?: number,
): ParsedMemorySourceManifest {
  if (!raw?.trim()) {
    return { state: 'legacy', manifest: null, requiredGaps: ['checkpoint_source_manifest_missing'] }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.schemaVersion !== 1
      || !Number.isSafeInteger(parsed.contextVersion)
      || Number(parsed.contextVersion) < 1
      || !Array.isArray(parsed.sources)
      || !parsed.range
      || typeof parsed.range !== 'object'
      || Array.isArray(parsed.range)) {
      return { state: 'invalid', manifest: null, requiredGaps: ['checkpoint_source_manifest_invalid'] }
    }
    const sources = parsed.sources.map(normalizeSource)
    if (sources.some((source) => source === null)) {
      return { state: 'invalid', manifest: null, requiredGaps: ['checkpoint_source_manifest_invalid'] }
    }
    const range = parsed.range as Record<string, unknown>
    if (!Number.isSafeInteger(range.startChapterNum) || !Number.isSafeInteger(range.endChapterNum)) {
      return { state: 'invalid', manifest: null, requiredGaps: ['checkpoint_source_manifest_invalid'] }
    }
    const manifest = createMemorySourceManifest({
      contextVersion: Number(parsed.contextVersion),
      sources: sources as MemorySourceManifestSource[],
      range: {
        startChapterNum: Number(range.startChapterNum),
        endChapterNum: Number(range.endChapterNum),
      },
      unresolvedRefs: normalizeRefs(parsed.unresolvedRefs),
    })
    if (typeof expectedContextVersion === 'number' && manifest.contextVersion !== expectedContextVersion) {
      return { state: 'stale', manifest, requiredGaps: ['checkpoint_source_context_version_stale'] }
    }
    if (manifest.unresolvedRefs.length > 0) {
      return { state: 'unresolved', manifest, requiredGaps: [...manifest.unresolvedRefs] }
    }
    return { state: 'verified', manifest, requiredGaps: [] }
  } catch {
    return { state: 'invalid', manifest: null, requiredGaps: ['checkpoint_source_manifest_invalid'] }
  }
}
