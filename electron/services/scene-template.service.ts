import { asc, eq, isNull } from 'drizzle-orm'
import type { SceneTemplate as AppSceneTemplate, SceneTemplateStats } from '../../src/types'
import { getDb } from '../database/db'
import { sceneTemplates } from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'
import { throwUserFacingError } from '../utils/user-facing-error'

interface SceneTemplateQueryFilters {
  novelId?: number
  genreId?: number
  category?: AppSceneTemplate['category']
  scope?: 'all' | 'builtin' | 'custom'
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

function sanitizeSceneTemplatePayload(data: Partial<typeof sceneTemplates.$inferInsert>): Partial<typeof sceneTemplates.$inferInsert> {
  const next: Partial<typeof sceneTemplates.$inferInsert> = {}
  if ('novelId' in data) next.novelId = asNumber(data.novelId)
  if ('genreId' in data) next.genreId = asNumber(data.genreId)
  if (typeof data.name === 'string') next.name = asText(data.name)
  if (typeof data.category === 'string') next.category = asText(data.category)
  if (typeof data.description === 'string') next.description = asText(data.description)
  if (typeof data.typicalBeatsJson === 'string') next.typicalBeatsJson = data.typicalBeatsJson
  if (typeof data.suggestedCharacterRolesJson === 'string') next.suggestedCharacterRolesJson = data.suggestedCharacterRolesJson
  if (typeof data.emotionArc === 'string') next.emotionArc = asText(data.emotionArc)
  if ('isBuiltin' in data) next.isBuiltin = data.isBuiltin ? 1 : 0
  if ('sortOrder' in data) next.sortOrder = asNumber(data.sortOrder) ?? 0
  return next
}

function mapSceneTemplate(row: typeof sceneTemplates.$inferSelect): AppSceneTemplate {
  return {
    id: row.id,
    novelId: row.novelId ?? undefined,
    genreId: row.genreId ?? undefined,
    name: row.name,
    category: (row.category as AppSceneTemplate['category']) || 'conflict',
    description: row.description ?? undefined,
    typicalBeatsJson: row.typicalBeatsJson ?? undefined,
    suggestedCharacterRolesJson: row.suggestedCharacterRolesJson ?? undefined,
    emotionArc: row.emotionArc ?? undefined,
    isBuiltin: (row.isBuiltin ?? 0) > 0 ? 1 : 0,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

export function listSceneTemplates(filters: { novelId?: number; genreId?: number }) {
  const db = getDb()
  const rows = db.select().from(sceneTemplates)
    .orderBy(asc(sceneTemplates.isBuiltin), asc(sceneTemplates.sortOrder), asc(sceneTemplates.id))
    .all()
    .map(mapSceneTemplate)

  return rows.filter((row) => {
    if (typeof filters.novelId === 'number' && row.novelId === filters.novelId) return true
    if (typeof filters.genreId === 'number' && row.novelId === undefined && row.genreId === filters.genreId) return true
    return row.novelId === undefined && row.genreId === undefined
  })
}

export function querySceneTemplates(filters: SceneTemplateQueryFilters) {
  const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize)
  const keyword = filters.keyword?.trim().toLowerCase()

  const rows = listSceneTemplates({ novelId: filters.novelId, genreId: filters.genreId }).filter((row) => {
    if (filters.category && row.category !== filters.category) return false
    if (filters.scope === 'builtin' && row.isBuiltin <= 0) return false
    if (filters.scope === 'custom' && row.isBuiltin > 0) return false
    if (keyword) {
      const haystack = [row.name, row.description, row.emotionArc].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })

  const sorted = [...rows].sort((left, right) => {
    const leftWeight = left.novelId ? 0 : left.genreId ? 1 : 2
    const rightWeight = right.novelId ? 0 : right.genreId ? 1 : 2
    if (leftWeight !== rightWeight) return leftWeight - rightWeight
    if ((left.sortOrder || 0) !== (right.sortOrder || 0)) return (left.sortOrder || 0) - (right.sortOrder || 0)
    return left.id - right.id
  })

  return buildPagedResult(sorted.slice(offset, offset + pageSize), page, pageSize, sorted.length)
}

export function getSceneTemplateStats(filters: { novelId?: number; genreId?: number }): SceneTemplateStats {
  const rows = listSceneTemplates(filters)
  return {
    total: rows.length,
    builtinCount: rows.filter((row) => row.isBuiltin > 0).length,
    customCount: rows.filter((row) => row.isBuiltin <= 0).length,
    genreScopedCount: rows.filter((row) => typeof row.genreId === 'number').length,
  }
}

export function getSceneTemplate(id: number) {
  const db = getDb()
  const row = db.select().from(sceneTemplates).where(eq(sceneTemplates.id, id)).all()[0]
  return row ? mapSceneTemplate(row) : null
}

export function searchSceneTemplates(novelId: number, genreId: number | undefined, keyword = '', limit = 12) {
  return querySceneTemplates({
    novelId,
    genreId,
    keyword,
    page: 1,
    pageSize: Math.max(1, Math.min(limit, 50)),
  }).items
}

export function createSceneTemplate(data: Partial<typeof sceneTemplates.$inferInsert>) {
  const db = getDb()
  const payload = sanitizeSceneTemplatePayload(data)
  const scopeNovelId = payload.novelId ?? null
  const rows = db.select().from(sceneTemplates).where(
    scopeNovelId === null
      ? isNull(sceneTemplates.novelId)
      : eq(sceneTemplates.novelId, scopeNovelId),
  ).all()
  const result = db.insert(sceneTemplates).values({
    novelId: payload.novelId ?? null,
    genreId: payload.genreId ?? null,
    name: payload.name || '未命名场景模板',
    category: payload.category || 'conflict',
    description: payload.description || '',
    typicalBeatsJson: payload.typicalBeatsJson || '[]',
    suggestedCharacterRolesJson: payload.suggestedCharacterRolesJson || '[]',
    emotionArc: payload.emotionArc || '',
    isBuiltin: payload.isBuiltin ?? 0,
    sortOrder: rows.length > 0 ? Math.max(...rows.map((row) => row.sortOrder || 0)) + 1 : 1,
  }).run()

  if (typeof payload.novelId === 'number') {
    markNovelContextChanged(payload.novelId, 'Scene templates changed')
  }

  return Number(result.lastInsertRowid)
}

export function updateSceneTemplate(id: number, data: Partial<typeof sceneTemplates.$inferInsert>) {
  const current = getSceneTemplate(id)
  if (!current) return
  const db = getDb()
  db.update(sceneTemplates).set({
    ...sanitizeSceneTemplatePayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(sceneTemplates.id, id)).run()

  if (current.novelId) {
    markNovelContextChanged(current.novelId, 'Scene templates changed')
  }
}

export function deleteSceneTemplate(id: number) {
  const current = getSceneTemplate(id)
  if (!current) return
  if (current.isBuiltin > 0) {
    throwUserFacingError('template.builtinDeleteBlocked')
  }
  const db = getDb()
  db.delete(sceneTemplates).where(eq(sceneTemplates.id, id)).run()
  if (current.novelId) {
    markNovelContextChanged(current.novelId, 'Scene templates changed')
  }
}
