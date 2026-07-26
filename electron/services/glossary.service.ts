import { asc, eq } from 'drizzle-orm'
import type { GlossaryEntry as AppGlossaryEntry, GlossaryStats } from '../../src/types'
import { getDb } from '../database/db'
import { glossary } from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'

interface GlossaryQueryFilters {
  novelId: number
  category?: AppGlossaryEntry['category']
  canonical?: 'all' | 'active' | 'deprecated'
  keyword?: string
  page?: number
  pageSize?: number
}

function normalizePage(page?: number, pageSize?: number) {
  const nextPage = Math.max(1, page || 1)
  const nextPageSize = Math.max(1, Math.min(pageSize || 24, 200))
  return {
    page: nextPage,
    pageSize: nextPageSize,
    offset: (nextPage - 1) * nextPageSize,
  }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function sanitizeGlossaryPayload(data: Partial<typeof glossary.$inferInsert>): Partial<typeof glossary.$inferInsert> {
  const next: Partial<typeof glossary.$inferInsert> = {}

  if (typeof data.term === 'string') next.term = asText(data.term)
  if (typeof data.category === 'string') next.category = asText(data.category)
  if (typeof data.definition === 'string') next.definition = asText(data.definition)
  if (typeof data.bodyMd === 'string') next.bodyMd = data.bodyMd.trim()
  if (typeof data.tagsJson === 'string') next.tagsJson = data.tagsJson
  if (typeof data.aliasesJson === 'string') next.aliasesJson = data.aliasesJson
  if ('firstAppearChapter' in data) next.firstAppearChapter = asNumber(data.firstAppearChapter)
  if (typeof data.relatedEntityIdsJson === 'string') next.relatedEntityIdsJson = data.relatedEntityIdsJson
  if ('isCanonical' in data) next.isCanonical = data.isCanonical ? 1 : 0
  if ('sortOrder' in data) next.sortOrder = asNumber(data.sortOrder) ?? 0

  return next
}

function mapGlossaryEntry(row: typeof glossary.$inferSelect): AppGlossaryEntry {
  return {
    id: row.id,
    novelId: row.novelId,
    term: row.term,
    category: (row.category as AppGlossaryEntry['category']) || 'custom',
    definition: row.definition ?? undefined,
    bodyMd: row.bodyMd ?? undefined,
    tagsJson: row.tagsJson ?? undefined,
    aliasesJson: row.aliasesJson ?? undefined,
    firstAppearChapter: row.firstAppearChapter ?? undefined,
    relatedEntityIdsJson: row.relatedEntityIdsJson ?? undefined,
    isCanonical: (row.isCanonical ?? 0) > 0 ? 1 : 0,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

export function listGlossary(novelId: number) {
  const db = getDb()
  return db.select().from(glossary)
    .where(eq(glossary.novelId, novelId))
    .orderBy(asc(glossary.sortOrder), asc(glossary.id))
    .all()
    .map(mapGlossaryEntry)
}

export function queryGlossary(filters: GlossaryQueryFilters) {
  const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize)
  const keyword = filters.keyword?.trim().toLowerCase()
  const rows = listGlossary(filters.novelId).filter((row) => {
    if (filters.category && row.category !== filters.category) return false
    if (filters.canonical === 'active' && row.isCanonical <= 0) return false
    if (filters.canonical === 'deprecated' && row.isCanonical > 0) return false
    if (keyword) {
      const haystack = [row.term, row.definition, row.aliasesJson].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })

  return buildPagedResult(rows.slice(offset, offset + pageSize), page, pageSize, rows.length)
}

export function getGlossaryStats(filters: { novelId: number }): GlossaryStats {
  const rows = listGlossary(filters.novelId)
  return {
    total: rows.length,
    canonicalCount: rows.filter((row) => row.isCanonical > 0).length,
    deprecatedCount: rows.filter((row) => row.isCanonical <= 0).length,
    categoryCount: new Set(rows.map((row) => row.category)).size,
  }
}

export function getGlossaryEntry(id: number) {
  const db = getDb()
  const row = db.select().from(glossary).where(eq(glossary.id, id)).all()[0]
  return row ? mapGlossaryEntry(row) : null
}

export function searchGlossary(novelId: number, keyword = '', limit = 12) {
  return listGlossary(novelId)
    .filter((row) => {
      if (!keyword.trim()) return true
      const haystack = [row.term, row.definition, row.aliasesJson].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword.trim().toLowerCase())
    })
    .slice(0, Math.max(1, Math.min(limit, 50)))
}

export function createGlossaryEntry(novelId: number, data: Partial<typeof glossary.$inferInsert>) {
  const db = getDb()
  const rows = db.select().from(glossary).where(eq(glossary.novelId, novelId)).all()
  const payload = sanitizeGlossaryPayload(data)
  const result = db.insert(glossary).values({
    novelId,
    term: payload.term || '未命名术语',
    category: payload.category || 'custom',
    definition: payload.definition || '',
    bodyMd: payload.bodyMd || '',
    tagsJson: payload.tagsJson || '[]',
    aliasesJson: payload.aliasesJson || '[]',
    firstAppearChapter: payload.firstAppearChapter ?? null,
    relatedEntityIdsJson: payload.relatedEntityIdsJson || '[]',
    isCanonical: payload.isCanonical ?? 1,
    sortOrder: rows.length > 0 ? Math.max(...rows.map((row) => row.sortOrder || 0)) + 1 : 1,
  }).run()

  markNovelContextChanged(novelId, 'Glossary changed')
  return Number(result.lastInsertRowid)
}

export function updateGlossaryEntry(id: number, data: Partial<typeof glossary.$inferInsert>) {
  const current = getGlossaryEntry(id)
  if (!current) return
  const db = getDb()
  db.update(glossary).set({
    ...sanitizeGlossaryPayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(glossary.id, id)).run()
  markNovelContextChanged(current.novelId, 'Glossary changed')
}

export function deleteGlossaryEntry(id: number) {
  const current = getGlossaryEntry(id)
  if (!current) return
  const db = getDb()
  db.delete(glossary).where(eq(glossary.id, id)).run()
  markNovelContextChanged(current.novelId, 'Glossary changed')
}
