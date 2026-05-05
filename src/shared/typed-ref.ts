export type TypedRefAssetType = 'character' | 'item' | 'timeline_event' | 'story_thread'

export interface TypedRefPointer {
  assetType: TypedRefAssetType
  id?: number
  name?: string
  alias?: string[]
  confidence?: number
  unresolved?: boolean
}

export interface TypedRefOverlay {
  version: 1
  pointers: TypedRefPointer[]
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function normalizeAlias(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
  return values.length > 0 ? [...new Set(values)] : undefined
}

function normalizeId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 0 || value > 1) return undefined
  return value
}

function normalizePointer(value: unknown): TypedRefPointer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const assetType = normalizeText(record.assetType)
  if (
    assetType !== 'character'
    && assetType !== 'item'
    && assetType !== 'timeline_event'
    && assetType !== 'story_thread'
  ) {
    return null
  }

  const pointer: TypedRefPointer = {
    assetType,
  }

  const id = normalizeId(record.id)
  if (typeof id === 'number') pointer.id = id

  const name = normalizeText(record.name)
  if (name) pointer.name = name

  const alias = normalizeAlias(record.alias)
  if (alias) pointer.alias = alias

  const confidence = normalizeConfidence(record.confidence)
  if (typeof confidence === 'number') pointer.confidence = confidence

  if (record.unresolved === true) pointer.unresolved = true

  if (typeof pointer.id !== 'number' && !pointer.name && !pointer.alias?.length) return null
  return pointer
}

export function parseTypedRefOverlay(raw?: string | null): TypedRefOverlay | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const pointers = Array.isArray(record.pointers)
      ? record.pointers
          .map((item) => normalizePointer(item))
          .filter((item): item is TypedRefPointer => Boolean(item))
      : []
    if (pointers.length === 0) return null
    return {
      version: 1,
      pointers,
    }
  } catch {
    return null
  }
}

export function stringifyTypedRefOverlay(overlay?: TypedRefOverlay | null): string | undefined {
  if (!overlay || !Array.isArray(overlay.pointers) || overlay.pointers.length === 0) return undefined
  return JSON.stringify({
    version: 1,
    pointers: overlay.pointers.map((pointer) => ({
      assetType: pointer.assetType,
      ...(typeof pointer.id === 'number' ? { id: pointer.id } : {}),
      ...(pointer.name ? { name: pointer.name } : {}),
      ...(pointer.alias && pointer.alias.length > 0 ? { alias: pointer.alias } : {}),
      ...(typeof pointer.confidence === 'number' ? { confidence: pointer.confidence } : {}),
      ...(pointer.unresolved ? { unresolved: true } : {}),
    })),
  })
}

export function hasTypedRefOverlay(raw?: string | null): boolean {
  return Boolean(parseTypedRefOverlay(raw))
}

export function countUnresolvedTypedRefs(raw?: string | null): number {
  const overlay = parseTypedRefOverlay(raw)
  if (!overlay) return 0
  return overlay.pointers.filter((pointer) => pointer.unresolved || typeof pointer.id !== 'number').length
}

export function buildTypedRefOverlay(pointers: Array<TypedRefPointer | null | undefined>): TypedRefOverlay | null {
  const normalized = pointers.filter((pointer): pointer is TypedRefPointer => Boolean(pointer))
  return normalized.length > 0 ? { version: 1, pointers: normalized } : null
}

export function buildNameFallbackPointer(
  assetType: TypedRefAssetType,
  input: {
    id?: number | null
    name?: string | null
    alias?: string[]
    confidence?: number
  },
): TypedRefPointer | null {
  const pointer = normalizePointer({
    assetType,
    id: input.id,
    name: input.name,
    alias: input.alias,
    confidence: input.confidence,
    unresolved: typeof input.id === 'number' ? false : true,
  })
  return pointer
}
