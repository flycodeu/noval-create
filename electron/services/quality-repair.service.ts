import { eq } from 'drizzle-orm'
import type { QualityRepairAction, QualityRepairActionResult } from '../../src/types'
import { getDb } from '../database/db'
import { revisionTasks } from '../database/schema'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeNavigationQuery(query?: Record<string, string>): Record<string, string> | undefined {
  if (!query) return undefined
  const entries = Object.entries(query)
    .map(([key, value]) => [key, asText(value)] as const)
    .filter((entry) => entry[0] && entry[1])
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function buildOriginMeta(action: QualityRepairAction): string {
  return JSON.stringify({
    source: 'quality-dashboard',
    sourceMetric: action.metricKey,
    repairActionType: action.actionType,
    safeToExecute: action.safeToExecute,
    chapterNum: action.chapterNum,
    navigationQuery: sanitizeNavigationQuery(action.navigationQuery),
    ...(action.taskDraft?.originMeta || {}),
  })
}

function upsertRevisionTaskFromAction(novelId: number, action: QualityRepairAction): number {
  const db = getDb()
  const taskDraft = action.taskDraft
  if (!taskDraft) {
    throw new Error('quality repair action missing taskDraft')
  }

  const issueKey = asText(taskDraft.issueKey) || null
  const now = new Date().toISOString()
  const existing = issueKey
    ? db.select().from(revisionTasks).where(eq(revisionTasks.issueKey, issueKey)).all()[0]
    : null

  if (existing) {
    db.update(revisionTasks).set({
      taskSource: 'system',
      taskType: taskDraft.taskType,
      status: existing.status === 'resolved' ? 'open' : existing.status,
      severity: taskDraft.severity,
      title: taskDraft.title,
      description: taskDraft.description,
      fixBrief: taskDraft.fixBrief || null,
      relatedPage: taskDraft.relatedPage,
      entityType: taskDraft.entityType || null,
      entityId: typeof taskDraft.entityId === 'number' ? taskDraft.entityId : null,
      chapterId: typeof taskDraft.chapterId === 'number' ? taskDraft.chapterId : null,
      originMetaJson: buildOriginMeta(action),
      lastDetectedAt: now,
      resolvedAt: existing.status === 'resolved' ? null : existing.resolvedAt,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
    return existing.id
  }

  const result = db.insert(revisionTasks).values({
    novelId,
    taskSource: 'system',
    issueKey,
    taskType: taskDraft.taskType,
    status: 'open',
    severity: taskDraft.severity,
    title: taskDraft.title,
    description: taskDraft.description,
    fixBrief: taskDraft.fixBrief || null,
    relatedPage: taskDraft.relatedPage,
    entityType: taskDraft.entityType || null,
    entityId: typeof taskDraft.entityId === 'number' ? taskDraft.entityId : null,
    chapterId: typeof taskDraft.chapterId === 'number' ? taskDraft.chapterId : null,
    originMetaJson: buildOriginMeta(action),
    lastDetectedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run()
  return Number(result.lastInsertRowid)
}

export function createQualityRepairTask(novelId: number, action: QualityRepairAction): QualityRepairActionResult {
  if (!action.taskDraft) {
    return {
      actionId: action.id,
      status: 'unsupported',
      message: '当前动作没有可落地的修订任务模板。',
      relatedPage: action.targetPage,
      chapterId: action.chapterId,
      entityType: action.entityType,
      entityId: action.entityId,
      navigationQuery: sanitizeNavigationQuery(action.navigationQuery),
    }
  }

  const taskId = upsertRevisionTaskFromAction(novelId, action)
  return {
    actionId: action.id,
    status: 'task_created',
    message: '已生成修复任务。',
    taskId,
    relatedPage: action.targetPage || action.taskDraft.relatedPage,
    chapterId: action.chapterId || action.taskDraft.chapterId,
    entityType: action.entityType || action.taskDraft.entityType,
    entityId: action.entityId || action.taskDraft.entityId,
    navigationQuery: sanitizeNavigationQuery(action.navigationQuery),
  }
}

export async function executeQualityRepairAction(novelId: number, action: QualityRepairAction): Promise<QualityRepairActionResult> {
  if (action.safeToExecute && action.actionType === 'create_revision_task' && action.taskDraft) {
    const created = createQualityRepairTask(novelId, action)
    return {
      ...created,
      status: 'executed',
      message: '已执行修复动作，并生成任务。',
    }
  }

  return createQualityRepairTask(novelId, action)
}
