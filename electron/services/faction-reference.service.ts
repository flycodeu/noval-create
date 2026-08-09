import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { factions } from '../database/schema'

export type FactionReferenceValue = number | string
export interface FactionCatalog {
  rows: Array<typeof factions.$inferSelect>
  byId: Map<number, typeof factions.$inferSelect>
  byName: Map<string, typeof factions.$inferSelect>
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function parseValues(input: unknown): FactionReferenceValue[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (typeof item === 'number' && Number.isFinite(item)) return Math.round(item)
        if (typeof item === 'string' && item.trim()) {
          const numeric = Number(item)
          if (!Number.isNaN(numeric) && item.trim() === String(numeric)) return Math.round(numeric)
          return item.trim()
        }
        return null
      })
      .filter((item): item is FactionReferenceValue => item !== null)
  }

  if (typeof input === 'string' && input.trim()) {
    try {
      return parseValues(JSON.parse(input))
    } catch {
      return input
        .split(/[,\n，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
    }
  }

  return []
}

export function parseFactionReferenceArray(raw?: string | null): FactionReferenceValue[] {
  return parseValues(raw || [])
}

export function createFactionCatalog(
  rows: Array<typeof factions.$inferSelect>,
): FactionCatalog {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const byName = new Map(rows.map((row) => [normalizeName(row.name), row]))
  return { rows, byId, byName }
}

export function buildFactionCatalog(novelId: number): FactionCatalog {
  const db = getDb()
  const rows = db.select().from(factions).where(eq(factions.novelId, novelId)).all()
  return createFactionCatalog(rows)
}

export function resolveFactionRowsFromCatalog(
  catalog: FactionCatalog,
  raw?: string | null,
): Array<typeof factions.$inferSelect> {
  const values = parseFactionReferenceArray(raw)
  const seen = new Set<number>()

  return values.reduce<typeof catalog.rows>((result, value) => {
    const matched = typeof value === 'number'
      ? catalog.byId.get(value)
      : catalog.byName.get(normalizeName(value))
    if (!matched || seen.has(matched.id)) return result
    seen.add(matched.id)
    result.push(matched)
    return result
  }, [])
}

export function resolveFactionRowsByReferences(novelId: number, raw?: string | null) {
  return resolveFactionRowsFromCatalog(buildFactionCatalog(novelId), raw)
}

export function resolveFactionNamesFromReferences(novelId: number, raw?: string | null): string[] {
  const values = parseFactionReferenceArray(raw)
  const catalog = buildFactionCatalog(novelId)
  const names: string[] = []
  const seen = new Set<string>()

  values.forEach((value) => {
    const name = typeof value === 'number'
      ? catalog.byId.get(value)?.name
      : catalog.byName.get(normalizeName(value))?.name || value.trim()
    if (!name) return
    const key = normalizeName(name)
    if (!key || seen.has(key)) return
    seen.add(key)
    names.push(name)
  })

  return names
}

export function stringifyFactionReferences(novelId: number, input: unknown): string {
  const values = parseValues(input)
  const catalog = buildFactionCatalog(novelId)
  const result: FactionReferenceValue[] = []
  const seen = new Set<string>()

  values.forEach((value) => {
    if (typeof value === 'number') {
      const matched = catalog.byId.get(value)
      const normalized = matched ? `id:${matched.id}` : `id:${value}`
      if (seen.has(normalized)) return
      seen.add(normalized)
      result.push(matched ? matched.id : value)
      return
    }

    const trimmed = value.trim()
    if (!trimmed) return
    const matched = catalog.byName.get(normalizeName(trimmed))
    const normalized = matched ? `id:${matched.id}` : `name:${normalizeName(trimmed)}`
    if (seen.has(normalized)) return
    seen.add(normalized)
    result.push(matched ? matched.id : trimmed)
  })

  return JSON.stringify(result)
}
