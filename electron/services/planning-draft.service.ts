import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import type { PlanningDraftPageKey, PlanningDraftRecord } from '../../src/types'
import { buildPlanningDiffSummary } from '../../src/shared/planning-observability'
import { createTask, getTaskRecord, updateTask } from './task.service'

interface PersistedPlanningDraftProgress {
  kind: 'planning_draft'
  message: string
  cleared?: boolean
  draft: PlanningDraftRecord
}

interface SavePlanningDraftInput {
  novelId: number
  pageKey: PlanningDraftPageKey
  data: Record<string, unknown>
  warnings?: string[]
  sourcePage?: string
  inputSummary?: string
  lintWarnings?: string[]
  rawOutputs?: string[]
  rejectionReason?: string
}

function parseJsonObject<T extends object>(raw?: string | null): T {
  if (!raw) return {} as T
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : {} as T
  } catch {
    return {} as T
  }
}

function buildDraftMessage(draft: PlanningDraftRecord, cleared = false): string {
  if (cleared) return `${draft.pageKey} 页面 AI 草稿已清除。`
  if (draft.appliedAt) return `${draft.pageKey} 页面 AI 草稿已应用到表单，尚未保存。`
  return `${draft.pageKey} 页面 AI 草稿已生成，等待应用到表单。`
}

function serializePlanningDraftProgress(draft: PlanningDraftRecord, cleared = false): string {
  const payload: PersistedPlanningDraftProgress = {
    kind: 'planning_draft',
    message: buildDraftMessage(draft, cleared),
    cleared,
    draft,
  }
  return JSON.stringify(payload)
}

function parsePlanningDraftProgress(raw?: string | null): PersistedPlanningDraftProgress | null {
  const parsed = parseJsonObject<Record<string, unknown>>(raw)
  if (parsed.kind !== 'planning_draft') return null

  const draft = parsed.draft
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null

  const record = draft as Record<string, unknown>
  const data = record.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const pageKey = typeof record.pageKey === 'string' ? record.pageKey : ''
  if (!pageKey) return null

  return {
    kind: 'planning_draft',
    message: typeof parsed.message === 'string' ? parsed.message : '',
    cleared: Boolean(parsed.cleared),
    draft: {
      taskId: typeof record.taskId === 'number' ? record.taskId : 0,
      novelId: typeof record.novelId === 'number' ? record.novelId : 0,
      pageKey: pageKey as PlanningDraftPageKey,
      status: record.status === 'applied' ? 'applied' : 'pending',
      data: data as Record<string, unknown>,
      warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === 'string') : [],
      sourcePage: typeof record.sourcePage === 'string' ? record.sourcePage : undefined,
      inputSummary: typeof record.inputSummary === 'string' ? record.inputSummary : undefined,
      lintWarnings: Array.isArray(record.lintWarnings) ? record.lintWarnings.filter((item): item is string => typeof item === 'string') : [],
      rawOutputs: Array.isArray(record.rawOutputs) ? record.rawOutputs.filter((item): item is string => typeof item === 'string') : [],
      rejectionReason: typeof record.rejectionReason === 'string' ? record.rejectionReason : undefined,
      finalData: record.finalData && typeof record.finalData === 'object' && !Array.isArray(record.finalData)
        ? record.finalData as Record<string, unknown>
        : undefined,
      diffSummary: Array.isArray(record.diffSummary) ? record.diffSummary.filter((item): item is string => typeof item === 'string') : [],
      finalizedAt: typeof record.finalizedAt === 'string' ? record.finalizedAt : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      completedAt: typeof record.completedAt === 'string' ? record.completedAt : new Date().toISOString(),
      appliedAt: typeof record.appliedAt === 'string' ? record.appliedAt : undefined,
    },
  }
}

function listPlanningDraftTasks(novelId: number, pageKey?: PlanningDraftPageKey) {
  const db = getDb()
  return db.select().from(tasks).where(eq(tasks.novelId, novelId)).all()
    .filter((task) => task.type === 'planning_draft')
    .map((task) => ({
      task,
      progress: parsePlanningDraftProgress(task.progressJson),
    }))
    .filter((entry) => {
      if (!entry.progress || entry.progress.cleared) return false
      return pageKey ? entry.progress.draft.pageKey === pageKey : true
    })
}

export function getLatestPlanningDraft(novelId: number, pageKey: PlanningDraftPageKey): PlanningDraftRecord | null {
  const entries = listPlanningDraftTasks(novelId, pageKey)
    .sort((left, right) => {
      const leftTime = Date.parse(left.progress?.draft.completedAt || left.task.updatedAt || left.task.createdAt || '')
      const rightTime = Date.parse(right.progress?.draft.completedAt || right.task.updatedAt || right.task.createdAt || '')
      return rightTime - leftTime
    })

  const latest = entries[0]
  if (!latest?.progress) return null
  return {
    ...latest.progress.draft,
    taskId: latest.task.id,
  }
}

export async function savePlanningDraft(input: SavePlanningDraftInput): Promise<PlanningDraftRecord> {
  const completedAt = new Date().toISOString()
  const taskId = await createTask({
    type: 'planning_draft',
    novelId: input.novelId,
    runnerType: 'workflow',
    retryable: false,
    status: 'success',
    inputJson: JSON.stringify({
      pageKey: input.pageKey,
      sourcePage: input.sourcePage || input.pageKey,
    }),
  })

  const draft: PlanningDraftRecord = {
    taskId,
    novelId: input.novelId,
    pageKey: input.pageKey,
    status: 'pending',
    data: input.data,
    warnings: input.warnings || [],
    sourcePage: input.sourcePage || input.pageKey,
    inputSummary: input.inputSummary?.trim() || undefined,
    lintWarnings: input.lintWarnings?.filter(Boolean) || [],
    rawOutputs: input.rawOutputs?.filter(Boolean) || [],
    rejectionReason: input.rejectionReason?.trim() || undefined,
    createdAt: completedAt,
    completedAt,
  }

  updateTask(taskId, {
    progressJson: serializePlanningDraftProgress(draft),
    outputText: JSON.stringify(draft.data, null, 2),
    errorMessage: null,
  })

  clearPlanningDrafts(input.novelId, input.pageKey, taskId)
  return draft
}

export function markPlanningDraftApplied(taskId: number) {
  const task = getTaskRecord(taskId)
  if (!task) return

  const progress = parsePlanningDraftProgress(task.progressJson)
  if (!progress || progress.cleared) return

  const nextDraft: PlanningDraftRecord = {
    ...progress.draft,
    taskId,
    status: 'applied',
    appliedAt: progress.draft.appliedAt || new Date().toISOString(),
  }

  updateTask(taskId, {
    progressJson: serializePlanningDraftProgress(nextDraft),
    outputText: JSON.stringify(nextDraft.data, null, 2),
  })
}

export function finalizePlanningDraft(taskId: number, finalData: Record<string, unknown>): PlanningDraftRecord | null {
  const task = getTaskRecord(taskId)
  if (!task) return null

  const progress = parsePlanningDraftProgress(task.progressJson)
  if (!progress || progress.cleared) return null

  const nextDraft: PlanningDraftRecord = {
    ...progress.draft,
    taskId,
    finalData,
    diffSummary: buildPlanningDiffSummary(progress.draft.data, finalData),
    finalizedAt: new Date().toISOString(),
  }

  updateTask(taskId, {
    progressJson: serializePlanningDraftProgress(nextDraft),
    outputText: JSON.stringify(nextDraft.finalData || nextDraft.data, null, 2),
  })

  return nextDraft
}

export function clearPlanningDrafts(novelId: number, pageKey: PlanningDraftPageKey, keepTaskId?: number) {
  const db = getDb()
  db.select().from(tasks).where(eq(tasks.novelId, novelId)).all()
    .filter((task) => task.type === 'planning_draft' && task.id !== keepTaskId)
    .forEach((task) => {
      const progress = parsePlanningDraftProgress(task.progressJson)
      if (!progress || progress.cleared || progress.draft.pageKey !== pageKey) return

      updateTask(task.id, {
        progressJson: serializePlanningDraftProgress({
          ...progress.draft,
          taskId: task.id,
        }, true),
      })
    })
}
