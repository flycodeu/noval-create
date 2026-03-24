import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, revisionTasks } from '../database/schema'
import type { RevisionTask } from '../../src/types'
import { buildNovelConsistencyReport } from './consistency.service'
import { getNovelContextStatus } from './context-impact.service'

interface RevisionTaskQueryFilters {
  novelId: number
  taskSource?: 'manual' | 'system'
  status?: 'open' | 'in_progress' | 'resolved' | 'ignored'
  severity?: 'high' | 'medium' | 'low'
  keyword?: string
  page?: number
  pageSize?: number
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTaskSource(value: unknown): 'manual' | 'system' {
  return asText(value) === 'system' ? 'system' : 'manual'
}

function normalizeStatus(value: unknown): 'open' | 'in_progress' | 'resolved' | 'ignored' {
  const text = asText(value)
  if (text === 'in_progress' || text === 'resolved' || text === 'ignored') return text
  return 'open'
}

function normalizeSeverity(value: unknown): 'high' | 'medium' | 'low' {
  const text = asText(value)
  if (text === 'high' || text === 'low') return text
  return 'medium'
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 24) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
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

function sanitizeRevisionTaskPayload(
  data: Partial<typeof revisionTasks.$inferInsert>,
): Partial<typeof revisionTasks.$inferInsert> {
  const next: Partial<typeof revisionTasks.$inferInsert> = {}

  if ('taskSource' in data) next.taskSource = normalizeTaskSource(data.taskSource)
  if (typeof data.taskType === 'string') next.taskType = asText(data.taskType)
  if ('status' in data) next.status = normalizeStatus(data.status)
  if ('severity' in data) next.severity = normalizeSeverity(data.severity)
  if (typeof data.title === 'string') next.title = asText(data.title)
  if (typeof data.description === 'string') next.description = asText(data.description)
  if (typeof data.fixBrief === 'string') next.fixBrief = asText(data.fixBrief)
  if (typeof data.relatedPage === 'string') next.relatedPage = asText(data.relatedPage)
  if (typeof data.entityType === 'string') next.entityType = asText(data.entityType)
  if ('entityId' in data) next.entityId = typeof data.entityId === 'number' ? Math.round(data.entityId) : null
  if ('chapterId' in data) next.chapterId = typeof data.chapterId === 'number' ? Math.round(data.chapterId) : null

  return next
}

function getRelatedPage(taskType: string) {
  if (taskType === 'timeline') return 'timeline'
  if (taskType === 'item') return 'items'
  if (taskType === 'character') return 'characters'
  if (taskType === 'map') return 'map'
  if (taskType === 'outline') return 'outline'
  if (taskType === 'continuity' || taskType === 'chapter') return 'writing'
  return 'revision'
}

function mapManualTask(row: typeof revisionTasks.$inferSelect): RevisionTask {
  return {
    id: row.id,
    novelId: row.novelId,
    taskSource: normalizeTaskSource(row.taskSource),
    taskType: row.taskType || 'continuity',
    status: normalizeStatus(row.status),
    severity: normalizeSeverity(row.severity),
    title: row.title,
    description: row.description || undefined,
    fixBrief: row.fixBrief || undefined,
    relatedPage: row.relatedPage || undefined,
    entityType: row.entityType || undefined,
    entityId: row.entityId || undefined,
    chapterId: row.chapterId || undefined,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function buildSystemTasks(novelId: number): RevisionTask[] {
  const report = buildNovelConsistencyReport(novelId)
  const contextStatus = getNovelContextStatus(novelId)
  const db = getDb()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const chapterNumById = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const tasks: RevisionTask[] = []
  let sequence = 1

  report.issues.forEach((issue) => {
    const chapterId = issue.entityType === 'chapter' && typeof issue.entityId === 'number'
      ? issue.entityId
      : undefined

    tasks.push({
      id: -sequence,
      novelId,
      taskSource: 'system',
      taskType: issue.category,
      status: 'open',
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      fixBrief: issue.suggestion,
      relatedPage: getRelatedPage(issue.category),
      entityType: issue.entityType,
      entityId: issue.entityId,
      chapterId,
      createdAt: report.generatedAt,
      updatedAt: report.generatedAt,
    })
    sequence += 1
  })

  contextStatus.staleChapterIds.forEach((chapterId) => {
    const chapterNum = chapterNumById.get(chapterId)
    tasks.push({
      id: -sequence,
      novelId,
      taskSource: 'system',
      taskType: 'continuity',
      status: 'open',
      severity: 'medium',
      title: chapterNum ? `第 ${chapterNum} 章需要同步上下文` : '章节需要同步上下文',
      description: '设定、结构或资产已经变化，当前章节仍引用旧上下文。',
      fixBrief: '先刷新摘要与连续性记忆，必要时重生成章节或回查场景承接。',
      relatedPage: 'writing',
      entityType: 'chapter',
      entityId: chapterId,
      chapterId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    sequence += 1
  })

  return tasks
}

export function listRevisionTasks(novelId: number) {
  const db = getDb()
  const manual = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .orderBy(asc(revisionTasks.createdAt), asc(revisionTasks.id))
    .all()
    .map(mapManualTask)

  return [...buildSystemTasks(novelId), ...manual]
}

export function getRevisionTask(id: number) {
  if (id < 0) {
    return null
  }

  const db = getDb()
  const row = db.select().from(revisionTasks).where(eq(revisionTasks.id, id)).all()[0]
  return row ? mapManualTask(row) : null
}

export function queryRevisionTasks(filters: RevisionTaskQueryFilters) {
  const paging = normalizePaging(filters.page, filters.pageSize, 24)
  const keyword = asText(filters.keyword).toLowerCase()
  const items = listRevisionTasks(filters.novelId)
    .filter((task) => !filters.taskSource || task.taskSource === filters.taskSource)
    .filter((task) => !filters.status || task.status === filters.status)
    .filter((task) => !filters.severity || task.severity === filters.severity)
    .filter((task) => {
      if (!keyword) return true
      const haystack = [task.title, task.description, task.fixBrief].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
    .sort((left, right) => {
      const severityRank = { high: 0, medium: 1, low: 2 }
      const severityDiff = severityRank[left.severity] - severityRank[right.severity]
      if (severityDiff !== 0) return severityDiff
      return left.updatedAt < right.updatedAt ? 1 : -1
    })

  return buildPagedResult(
    items.slice(paging.offset, paging.offset + paging.pageSize),
    paging.page,
    paging.pageSize,
    items.length,
  )
}

export function getRevisionTaskStats(filters: RevisionTaskQueryFilters) {
  const items = queryRevisionTasks({
    ...filters,
    page: 1,
    pageSize: 1000,
  }).items

  return items.reduce((result, task) => {
    result.total += 1
    if (task.status === 'open') result.openCount += 1
    if (task.status === 'in_progress') result.inProgressCount += 1
    if (task.status === 'resolved') result.resolvedCount += 1
    if (task.severity === 'high' && task.status !== 'resolved' && task.status !== 'ignored') {
      result.blockerCount += 1
    }
    return result
  }, {
    total: 0,
    openCount: 0,
    inProgressCount: 0,
    resolvedCount: 0,
    blockerCount: 0,
  })
}

export function getRevisionCenterSnapshot(novelId: number) {
  return {
    tasks: listRevisionTasks(novelId),
    stats: getRevisionTaskStats({ novelId }),
  }
}

export function createRevisionTask(novelId: number, data: Partial<typeof revisionTasks.$inferInsert>) {
  const db = getDb()
  const result = db.insert(revisionTasks).values({
    novelId,
    taskSource: 'manual',
    taskType: 'continuity',
    status: 'open',
    severity: 'medium',
    title: data.title || '未命名修订任务',
    ...sanitizeRevisionTaskPayload(data),
  }).run()
  return Number(result.lastInsertRowid)
}

export function updateRevisionTask(id: number, data: Partial<typeof revisionTasks.$inferInsert>) {
  const db = getDb()
  db.update(revisionTasks).set({
    ...sanitizeRevisionTaskPayload(data),
    updatedAt: new Date().toISOString(),
  }).where(eq(revisionTasks.id, id)).run()
}

export function deleteRevisionTask(id: number) {
  const db = getDb()
  db.delete(revisionTasks).where(eq(revisionTasks.id, id)).run()
}
