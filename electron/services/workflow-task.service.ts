import { WebContents } from 'electron'
import { desc, eq } from 'drizzle-orm'
import type { GenreWorldRules } from '../../src/shared/genre-system'
import {
  createEmptyWorldRules,
  normalizeWorldRulesDraft,
} from '../../src/shared/world-rules-draft'
import {
  WORLD_RULE_SECTION_DEFINITIONS,
  WORLD_RULE_SECTION_ORDER,
  type WorldRuleSectionKey,
  type WorldRulesAutoGenerateOptions,
} from '../../src/shared/world-rules-generation'
import type {
  MapAutoGenerateStatus,
  MapBatchGenerateOptions,
  WorldRulesAutoGenerateFailure,
  WorldRulesAutoGenerateStatus,
} from '../../src/types'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { batchGenerateMap } from './map.service'
import {
  generateWorldRulesSection,
  loadWorldRulesGenerationContext,
} from './world-rules.service'
import {
  createTask,
  getTaskRecord,
  parseTaskControl,
  parseTaskProgress,
  updateTask,
  updateTaskControl,
  updateTaskProgress,
  updateTaskStatus,
} from './task.service'
import { isBatchWorkflowType, resumeBatchAutoGenerateWorkflow } from './batch-workflow.service'

const DEFAULT_MAX_RETRIES = 2
const activeWorkflows = new Set<number>()
const RESUMABLE_WORKFLOW_TYPES = new Set([
  'map_auto_generate',
  'world_rules_auto_generate',
  'character_auto_generate',
  'item_auto_generate',
  'timeline_auto_generate',
  'story_thread_auto_generate',
  'subplot_auto_generate',
])
const WORLD_RULE_SECTION_LABELS = new Map(WORLD_RULE_SECTION_DEFINITIONS.map((item) => [item.key, item.label]))

type TaskRow = typeof tasks.$inferSelect

function parseMapOptions(raw?: string | null): MapBatchGenerateOptions {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MapBatchGenerateOptions
      : {}
  } catch {
    return {}
  }
}

function sanitizeWorldRuleSectionOrder(sectionOrder?: WorldRuleSectionKey[]): WorldRuleSectionKey[] {
  if (!Array.isArray(sectionOrder) || sectionOrder.length === 0) {
    return [...WORLD_RULE_SECTION_ORDER]
  }

  const unique = new Set<WorldRuleSectionKey>()
  for (const key of sectionOrder) {
    if (WORLD_RULE_SECTION_ORDER.includes(key) && !unique.has(key)) {
      unique.add(key)
    }
  }

  return unique.size > 0 ? [...unique] : [...WORLD_RULE_SECTION_ORDER]
}

function parseWorldRulesOptions(raw?: string | null): WorldRulesAutoGenerateOptions {
  if (!raw) {
    return {
      currentRules: createEmptyWorldRules(),
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        currentRules: createEmptyWorldRules(),
      }
    }

    const record = parsed as Record<string, unknown>
    const currentRules = normalizeWorldRulesDraft(record.currentRules, undefined)
    return {
      currentRules,
      requirements: typeof record.requirements === 'string' ? record.requirements : undefined,
      sectionOrder: sanitizeWorldRuleSectionOrder(record.sectionOrder as WorldRuleSectionKey[] | undefined),
      maxRetries: typeof record.maxRetries === 'number' ? record.maxRetries : undefined,
    }
  } catch {
    return {
      currentRules: createEmptyWorldRules(),
    }
  }
}

function reconcileStaleWorkflowTask(task: TaskRow | null): TaskRow | null {
  if (!task || task.runnerType !== 'workflow') return task
  if (activeWorkflows.has(task.id)) return task
  if (!['running', 'cancel_requested'].includes(task.status || '')) return task

  const progress = parseTaskProgress<Record<string, unknown>>(task)
  const message = task.type === 'world_rules_auto_generate'
    ? '应用重启后世界规则自动生成已暂停，可继续。'
    : '应用重启后后台流程已暂停，可继续。'

  updateTaskProgress(task.id, {
    ...progress,
    message,
  })
  updateTaskStatus(task.id, 'paused', undefined, {
    errorMessage: task.errorMessage || '应用重启后后台流程已暂停',
    currentChildTaskId: null,
  })

  return getTaskRecord(task.id)
}

function getLatestWorkflowByType(novelId: number, type: TaskRow['type']) {
  const db = getDb()
  return db.select().from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .find((task) => task.type === type && task.runnerType === 'workflow') || null
}

function getLatestMapWorkflow(novelId: number) {
  return reconcileStaleWorkflowTask(getLatestWorkflowByType(novelId, 'map_auto_generate'))
}

function getLatestWorldRulesWorkflow(novelId: number) {
  return reconcileStaleWorkflowTask(getLatestWorkflowByType(novelId, 'world_rules_auto_generate'))
}

function isCancelled(taskId: number): boolean {
  return Boolean(parseTaskControl(getTaskRecord(taskId))?.cancelRequested)
}

function toMapStatus(taskId: number, task: TaskRow): MapAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<MapAutoGenerateStatus>>(task)
  return {
    taskId,
    novelId: task.novelId || 0,
    status: task.status as MapAutoGenerateStatus['status'],
    currentStage: progress.currentStage || 'idle',
    targetDepth: typeof progress.targetDepth === 'number' ? progress.targetDepth : null,
    currentParentName: typeof progress.currentParentName === 'string' ? progress.currentParentName : '',
    generatedNodeCount: typeof progress.generatedNodeCount === 'number' ? progress.generatedNodeCount : 0,
    processedParentCount: typeof progress.processedParentCount === 'number' ? progress.processedParentCount : 0,
    pendingParentCount: typeof progress.pendingParentCount === 'number' ? progress.pendingParentCount : 0,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : 0,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : '',
    completed: Boolean(progress.completed),
    message: typeof progress.message === 'string' ? progress.message : '',
    currentBatchKey: typeof progress.currentBatchKey === 'string' ? progress.currentBatchKey : '',
  }
}

function createInitialMapStatus(taskId: number, novelId: number): MapAutoGenerateStatus {
  return {
    taskId,
    novelId,
    status: 'pending',
    currentStage: 'idle',
    targetDepth: null,
    currentParentName: '',
    generatedNodeCount: 0,
    processedParentCount: 0,
    pendingParentCount: 0,
    retryCount: 0,
    lastError: '',
    completed: false,
    message: '等待开始自动生成。',
    currentBatchKey: '',
  }
}

function normalizeWorldRulesFailureList(value: unknown): WorldRulesAutoGenerateFailure[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const key = typeof record.key === 'string' && WORLD_RULE_SECTION_ORDER.includes(record.key as WorldRuleSectionKey)
        ? record.key as WorldRuleSectionKey
        : null
      const label = typeof record.label === 'string' ? record.label : ''
      const error = typeof record.error === 'string' ? record.error : ''
      if (!key || !error) return null
      return { key, label: label || (WORLD_RULE_SECTION_LABELS.get(key) || key), error }
    })
    .filter((item): item is WorldRulesAutoGenerateFailure => Boolean(item))
}

function toWorldRulesStatus(taskId: number, task: TaskRow): WorldRulesAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<WorldRulesAutoGenerateStatus>>(task)
  const options = parseWorldRulesOptions(task.inputJson)
  const completedSections = sanitizeWorldRuleSectionOrder(progress.completedSections)
  const pendingSections = sanitizeWorldRuleSectionOrder(progress.pendingSections).filter((key) => !completedSections.includes(key))
  const fallbackPendingSections = pendingSections.length > 0
    ? pendingSections
    : sanitizeWorldRuleSectionOrder(options.sectionOrder).filter((key) => !completedSections.includes(key))
  const currentSection = typeof progress.currentSection === 'string' && WORLD_RULE_SECTION_ORDER.includes(progress.currentSection as WorldRuleSectionKey)
    ? progress.currentSection as WorldRuleSectionKey
    : ''
  const workingRulesSource = progress.workingRules ?? options.currentRules ?? createEmptyWorldRules()
  const totalSections = typeof progress.totalSections === 'number'
    ? progress.totalSections
    : completedSections.length + fallbackPendingSections.length

  return {
    taskId,
    novelId: task.novelId || 0,
    status: task.status as WorldRulesAutoGenerateStatus['status'],
    currentSection,
    currentSectionLabel: typeof progress.currentSectionLabel === 'string'
      ? progress.currentSectionLabel
      : currentSection
        ? (WORLD_RULE_SECTION_LABELS.get(currentSection) || currentSection)
        : '',
    completedSectionCount: typeof progress.completedSectionCount === 'number'
      ? progress.completedSectionCount
      : completedSections.length,
    pendingSectionCount: typeof progress.pendingSectionCount === 'number'
      ? progress.pendingSectionCount
      : fallbackPendingSections.length,
    totalSections,
    completedSections,
    pendingSections: fallbackPendingSections,
    failedSections: normalizeWorldRulesFailureList(progress.failedSections),
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : 0,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : '',
    completed: Boolean(progress.completed),
    message: typeof progress.message === 'string' ? progress.message : '',
    workingRules: normalizeWorldRulesDraft(workingRulesSource, undefined),
  }
}

function createInitialWorldRulesStatus(
  taskId: number,
  novelId: number,
  options: WorldRulesAutoGenerateOptions,
): WorldRulesAutoGenerateStatus {
  const sectionOrder = sanitizeWorldRuleSectionOrder(options.sectionOrder)
  const workingRules = normalizeWorldRulesDraft(options.currentRules, options.currentRules?.genreProfile?.name)

  return {
    taskId,
    novelId,
    status: 'pending',
    currentSection: '',
    currentSectionLabel: '',
    completedSectionCount: 0,
    pendingSectionCount: sectionOrder.length,
    totalSections: sectionOrder.length,
    completedSections: [],
    pendingSections: sectionOrder,
    failedSections: [],
    retryCount: 0,
    lastError: '',
    completed: sectionOrder.length === 0,
    message: sectionOrder.length === 0 ? '当前没有可生成的分区。' : '等待开始自动生成世界规则。',
    workingRules,
  }
}

function upsertFailedWorldRuleSection(
  items: WorldRulesAutoGenerateFailure[],
  nextItem: WorldRulesAutoGenerateFailure,
): WorldRulesAutoGenerateFailure[] {
  const rest = items.filter((item) => item.key !== nextItem.key)
  return [...rest, nextItem]
}

async function runMapAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (activeWorkflows.has(taskId)) return
  activeWorkflows.add(taskId)

  try {
    const task = getTaskRecord(taskId)
    if (!task || !task.novelId) {
      throwUserFacingError('workflow.taskNotFound', { taskId })
    }

    const options = parseMapOptions(task.inputJson)
    const maxRetries = Math.max(0, Math.min(5, Math.round(options.maxRetries ?? DEFAULT_MAX_RETRIES)))

    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialMapStatus(taskId, task.novelId), sender)
    }

    updateTaskControl(taskId, {
      ...parseTaskControl(task),
      cancelRequested: false,
      maxRetries,
    })
    updateTaskStatus(taskId, 'running', sender)

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break

      const control = parseTaskControl(latestTask)
      let progress = toMapStatus(taskId, latestTask)

      if (control.cancelRequested) {
        updateTaskControl(taskId, {
          ...control,
          cancelRequested: false,
        })
        progress = {
          ...progress,
          status: 'paused',
          lastError: '',
          message: '地图自动生成已暂停，可随时继续。',
        }
        updateTaskProgress(taskId, progress, sender)
        updateTaskStatus(taskId, 'paused', sender, {
          errorMessage: null,
          currentChildTaskId: null,
        })
        break
      }

      try {
        let batchKey = progress.currentBatchKey || ''
        const result = await batchGenerateMap(latestTask.novelId, options, {
          parentTaskId: taskId,
          sender,
          shouldStop: () => isCancelled(taskId),
          onBatchPlan: (preview) => {
            const latest = getTaskRecord(taskId)
            const latestControl = parseTaskControl(latest)
            const retryCount = latestControl.batchKey === preview.batchKey
              ? latestControl.retryCount || 0
              : 0

            batchKey = preview.batchKey
            updateTaskControl(taskId, {
              ...latestControl,
              maxRetries,
              batchKey: preview.batchKey,
              retryCount,
            })

            const runningProgress: MapAutoGenerateStatus = {
              ...toMapStatus(taskId, latest || latestTask),
              status: 'running',
              currentStage: preview.stage === 'completed' ? 'completed' : preview.stage,
              targetDepth: preview.targetDepth,
              pendingParentCount: preview.pendingParentCount,
              currentParentName: preview.plannedParentNames[0] || '',
              retryCount,
              currentBatchKey: preview.batchKey,
              message: preview.stage === 'root'
                ? '正在生成根层节点。'
                : preview.stage === 'children'
                  ? `正在补齐 ${preview.plannedParentNames[0] || '当前父节点'} 的直属子节点。`
                  : '地图蓝图已补齐。',
            }
            updateTaskProgress(taskId, runningProgress, sender)
          },
        })

        const latestAfterBatch = getTaskRecord(taskId) || latestTask
        progress = toMapStatus(taskId, latestAfterBatch)
        progress = {
          ...progress,
          status: result.completed ? 'success' : 'running',
          currentStage: result.completed ? 'completed' : result.stage,
          targetDepth: result.targetDepth,
          currentParentName: result.processedParentNames[0] || progress.currentParentName,
          generatedNodeCount: progress.generatedNodeCount + result.generatedNodeCount,
          processedParentCount: progress.processedParentCount + result.processedParentCount,
          pendingParentCount: result.pendingParentCount,
          retryCount: 0,
          lastError: '',
          completed: result.completed,
          message: result.message,
          currentBatchKey: batchKey,
        }

        updateTaskControl(taskId, {
          ...parseTaskControl(latestAfterBatch),
          maxRetries,
          retryCount: 0,
          batchKey,
        })
        updateTaskProgress(taskId, progress, sender)

        if (result.completed) {
          updateTaskStatus(taskId, 'success', sender, {
            outputText: result.message,
            errorMessage: null,
            currentChildTaskId: null,
          })
          break
        }
      } catch (error) {
        const currentTask = getTaskRecord(taskId) || latestTask
        const currentControl = parseTaskControl(currentTask)
        const currentProgress = toMapStatus(taskId, currentTask)
        const isAbort = error instanceof Error && error.name === 'AbortError'

        if (isAbort || currentControl.cancelRequested) {
          updateTaskControl(taskId, {
            ...currentControl,
            cancelRequested: false,
          })
          const pausedProgress: MapAutoGenerateStatus = {
            ...currentProgress,
            status: 'paused',
            lastError: '',
            message: '地图自动生成已暂停，可随时继续。',
          }
          updateTaskProgress(taskId, pausedProgress, sender)
          updateTaskStatus(taskId, 'paused', sender, {
            errorMessage: null,
            currentChildTaskId: null,
          })
          break
        }

        const nextRetryCount = (currentControl.retryCount || 0) + 1
        const errorMessage = error instanceof Error ? error.message : '地图自动生成失败'

        updateTaskControl(taskId, {
          ...currentControl,
          maxRetries,
          retryCount: nextRetryCount,
        })

        if (nextRetryCount > maxRetries) {
          const pausedProgress: MapAutoGenerateStatus = {
            ...currentProgress,
            status: 'paused',
            retryCount: nextRetryCount,
            lastError: errorMessage,
            message: `当前批次连续失败 ${nextRetryCount} 次，任务已暂停。`,
          }
          updateTaskProgress(taskId, pausedProgress, sender)
          updateTaskStatus(taskId, 'paused', sender, {
            errorMessage,
            currentChildTaskId: null,
          })
          break
        }

        const retryProgress: MapAutoGenerateStatus = {
          ...currentProgress,
          status: 'running',
          retryCount: nextRetryCount,
          lastError: errorMessage,
          message: `当前批次失败，正在进行第 ${nextRetryCount} 次重试。`,
        }
        updateTaskProgress(taskId, retryProgress, sender)
      }
    }
  } finally {
    activeWorkflows.delete(taskId)
  }
}

async function runWorldRulesAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (activeWorkflows.has(taskId)) return
  activeWorkflows.add(taskId)

  try {
    const task = getTaskRecord(taskId)
    if (!task || !task.novelId) {
      throwUserFacingError('workflow.taskNotFound', { taskId })
    }

    const options = parseWorldRulesOptions(task.inputJson)
    const maxRetries = Math.max(0, Math.min(5, Math.round(options.maxRetries ?? DEFAULT_MAX_RETRIES)))

    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialWorldRulesStatus(taskId, task.novelId, options), sender)
    }

    updateTaskControl(taskId, {
      ...parseTaskControl(task),
      cancelRequested: false,
      maxRetries,
    })
    updateTaskStatus(taskId, 'running', sender)

    const context = await loadWorldRulesGenerationContext(task.novelId)

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break

      const control = parseTaskControl(latestTask)
      let progress = toWorldRulesStatus(taskId, latestTask)

      if (control.cancelRequested) {
        progress = {
          ...progress,
          status: 'cancelled',
          currentSection: '',
          currentSectionLabel: '',
          message: '世界规则自动生成已停止。',
        }
        updateTaskProgress(taskId, progress, sender)
        updateTaskStatus(taskId, 'cancelled', sender, {
          errorMessage: '用户已取消',
          currentChildTaskId: null,
        })
        break
      }

      if (progress.pendingSections.length === 0) {
        const doneProgress: WorldRulesAutoGenerateStatus = {
          ...progress,
          status: 'success',
          currentSection: '',
          currentSectionLabel: '',
          completed: true,
          message: '世界规则自动生成完成，草稿已更新。',
        }
        updateTaskProgress(taskId, doneProgress, sender)
        updateTaskStatus(taskId, 'success', sender, {
          outputText: doneProgress.message,
          errorMessage: null,
          currentChildTaskId: null,
        })
        break
      }

      const sectionKey = progress.pendingSections[0]
      const label = WORLD_RULE_SECTION_LABELS.get(sectionKey) || sectionKey
      const runningProgress: WorldRulesAutoGenerateStatus = {
        ...progress,
        status: 'running',
        currentSection: sectionKey,
        currentSectionLabel: label,
        pendingSectionCount: progress.pendingSections.length,
        message: `正在生成 ${label}...`,
      }
      updateTaskProgress(taskId, runningProgress, sender)

      try {
        const result = await generateWorldRulesSection({
          context,
          sectionKey,
          action: 'generate',
          workingRules: progress.workingRules || normalizeWorldRulesDraft(options.currentRules, context.profile.genre),
          requirements: options.requirements,
          sender,
          parentTaskId: taskId,
          completedBefore: progress.completedSectionCount,
          totalSections: progress.totalSections,
        })

        const completedSections = [...progress.completedSections.filter((key) => key !== sectionKey), sectionKey]
        const pendingSections = progress.pendingSections.filter((key) => key !== sectionKey)
        const failedSections = progress.failedSections.filter((item) => item.key !== sectionKey)
        const nextSection = pendingSections[0] || ''
        const nextProgress: WorldRulesAutoGenerateStatus = {
          ...progress,
          status: pendingSections.length === 0 ? 'success' : 'running',
          currentSection: nextSection,
          currentSectionLabel: nextSection ? (WORLD_RULE_SECTION_LABELS.get(nextSection) || nextSection) : '',
          completedSectionCount: completedSections.length,
          pendingSectionCount: pendingSections.length,
          totalSections: progress.totalSections,
          completedSections,
          pendingSections,
          failedSections,
          retryCount: 0,
          lastError: '',
          completed: pendingSections.length === 0,
          message: pendingSections.length === 0
            ? '世界规则自动生成完成，草稿已更新。'
            : `${label} 已完成，继续生成下一区。`,
          workingRules: result.nextRules,
        }

        updateTaskControl(taskId, {
          ...parseTaskControl(latestTask),
          maxRetries,
          retryCount: 0,
        })
        updateTaskProgress(taskId, nextProgress, sender)

        if (pendingSections.length === 0) {
          updateTaskStatus(taskId, 'success', sender, {
            outputText: nextProgress.message,
            errorMessage: null,
            currentChildTaskId: null,
          })
          break
        }
      } catch (error) {
        const currentTask = getTaskRecord(taskId) || latestTask
        const currentControl = parseTaskControl(currentTask)
        const currentProgress = toWorldRulesStatus(taskId, currentTask)
        const isAbort = error instanceof Error && error.name === 'AbortError'

        if (isAbort || currentControl.cancelRequested) {
          const cancelledProgress: WorldRulesAutoGenerateStatus = {
            ...currentProgress,
            status: 'cancelled',
            currentSection: '',
            currentSectionLabel: '',
            message: '世界规则自动生成已停止。',
          }
          updateTaskProgress(taskId, cancelledProgress, sender)
          updateTaskStatus(taskId, 'cancelled', sender, {
            errorMessage: '用户已取消',
            currentChildTaskId: null,
          })
          break
        }

        const nextRetryCount = (currentControl.retryCount || 0) + 1
        const errorMessage = error instanceof Error ? error.message : '世界规则自动生成失败'

        updateTaskControl(taskId, {
          ...currentControl,
          maxRetries,
          retryCount: nextRetryCount,
        })

        if (nextRetryCount > maxRetries) {
          const failedKey = currentProgress.currentSection || currentProgress.pendingSections[0]
          const failedLabel = currentProgress.currentSectionLabel || (failedKey ? (WORLD_RULE_SECTION_LABELS.get(failedKey) || failedKey) : '当前分区')
          const pausedProgress: WorldRulesAutoGenerateStatus = {
            ...currentProgress,
            status: 'paused',
            retryCount: nextRetryCount,
            lastError: errorMessage,
            failedSections: failedKey
              ? upsertFailedWorldRuleSection(currentProgress.failedSections, {
                  key: failedKey,
                  label: failedLabel,
                  error: errorMessage,
                })
              : currentProgress.failedSections,
            message: `${failedLabel} 连续失败 ${nextRetryCount} 次，任务已暂停。`,
          }
          updateTaskProgress(taskId, pausedProgress, sender)
          updateTaskStatus(taskId, 'paused', sender, {
            errorMessage,
            currentChildTaskId: null,
          })
          break
        }

        const retryProgress: WorldRulesAutoGenerateStatus = {
          ...currentProgress,
          status: 'running',
          retryCount: nextRetryCount,
          lastError: errorMessage,
          message: `${currentProgress.currentSectionLabel || '当前分区'} 生成失败，正在进行第 ${nextRetryCount} 次重试。`,
        }
        updateTaskProgress(taskId, retryProgress, sender)
      }
    }
  } finally {
    activeWorkflows.delete(taskId)
  }
}

export async function startMapAutoGenerateWorkflow(
  novelId: number,
  options: MapBatchGenerateOptions,
  sender?: WebContents,
) {
  const existing = getLatestMapWorkflow(novelId)
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) {
    return existing.id
  }
  if (existing?.status === 'paused') {
    throwUserFacingError('workflow.mapPausedExists')
  }

  const taskId = await createTask({
    type: 'map_auto_generate',
    novelId,
    inputJson: JSON.stringify(options),
    runnerType: 'workflow',
    controlJson: JSON.stringify({
      cancelRequested: false,
      maxRetries: Math.max(0, Math.min(5, Math.round(options.maxRetries ?? DEFAULT_MAX_RETRIES))),
      retryCount: 0,
      batchKey: '',
    }),
    progressJson: JSON.stringify(createInitialMapStatus(0, novelId)),
  })

  updateTaskProgress(taskId, createInitialMapStatus(taskId, novelId), sender)
  void runMapAutoGenerateWorkflow(taskId, sender)
  return taskId
}

export async function startWorldRulesAutoGenerateWorkflow(
  novelId: number,
  options: WorldRulesAutoGenerateOptions,
  sender?: WebContents,
) {
  const existing = getLatestWorldRulesWorkflow(novelId)
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) {
    return existing.id
  }
  if (existing?.status === 'paused') {
    throwUserFacingError('workflow.worldRulesPausedExists')
  }

  const safeOptions: WorldRulesAutoGenerateOptions = {
    currentRules: normalizeWorldRulesDraft(options.currentRules, options.currentRules?.genreProfile?.name),
    requirements: options.requirements,
    sectionOrder: sanitizeWorldRuleSectionOrder(options.sectionOrder),
    maxRetries: typeof options.maxRetries === 'number' ? options.maxRetries : undefined,
  }

  const taskId = await createTask({
    type: 'world_rules_auto_generate',
    novelId,
    inputJson: JSON.stringify(safeOptions),
    runnerType: 'workflow',
    controlJson: JSON.stringify({
      cancelRequested: false,
      maxRetries: Math.max(0, Math.min(5, Math.round(safeOptions.maxRetries ?? DEFAULT_MAX_RETRIES))),
      retryCount: 0,
    }),
    progressJson: JSON.stringify(createInitialWorldRulesStatus(0, novelId, safeOptions)),
  })

  updateTaskProgress(taskId, createInitialWorldRulesStatus(taskId, novelId, safeOptions), sender)
  void runWorldRulesAutoGenerateWorkflow(taskId, sender)
  return taskId
}

export function getMapAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleWorkflowTask(getTaskRecord(taskId))
  if (!task || task.type !== 'map_auto_generate') return null
  return toMapStatus(taskId, task)
}

export function getWorldRulesAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleWorkflowTask(getTaskRecord(taskId))
  if (!task || task.type !== 'world_rules_auto_generate') return null
  return toWorldRulesStatus(taskId, task)
}

export function getLatestMapAutoGenerateTask(novelId: number) {
  const task = getLatestMapWorkflow(novelId)
  if (!task) return null

  if (['pending', 'running', 'cancel_requested', 'paused'].includes(task.status || '')) {
    return task
  }

  return null
}

export function getLatestWorldRulesAutoGenerateTask(novelId: number) {
  const task = getLatestWorldRulesWorkflow(novelId)
  if (!task) return null

  const status = toWorldRulesStatus(task.id, task)
  const hasDraft = Boolean(status.workingRules)
    && (
      status.completedSectionCount > 0
      || status.pendingSections.length > 0
      || status.failedSections.length > 0
      || ['pending', 'running', 'cancel_requested', 'paused'].includes(task.status || '')
    )

  if (['pending', 'running', 'cancel_requested', 'paused'].includes(task.status || '') || hasDraft) {
    return task
  }

  return null
}

export async function clearWorldRulesAutoGenerateDraft(novelId: number) {
  const db = getDb()
  const rows = db.select().from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .filter((task) => task.type === 'world_rules_auto_generate' && task.runnerType === 'workflow')

  for (const task of rows) {
    const progress = toWorldRulesStatus(task.id, task)
    const { workingRules: _workingRules, ...rest } = {
      ...progress,
      currentSection: '',
      currentSectionLabel: '',
      completedSectionCount: 0,
      pendingSectionCount: 0,
      completedSections: [],
      pendingSections: [],
      failedSections: [],
      retryCount: 0,
      lastError: '',
      completed: true,
      message: '世界规则草稿已清除。',
    }

    updateTask(task.id, {
      status: ['pending', 'running', 'cancel_requested', 'paused'].includes(task.status || '') ? 'cancelled' : task.status,
      errorMessage: ['pending', 'running', 'cancel_requested', 'paused'].includes(task.status || '')
        ? '世界规则草稿已清除'
        : task.errorMessage || null,
      currentChildTaskId: null,
      controlJson: JSON.stringify({
        ...parseTaskControl(task),
        cancelRequested: true,
        retryCount: 0,
      }),
      progressJson: JSON.stringify(rest),
    })
  }
}

export function listWorkflowTasks(novelId?: number) {
  const db = getDb()
  const rows = novelId == null
    ? db.select().from(tasks).orderBy(desc(tasks.updatedAt), desc(tasks.id)).all()
    : db.select().from(tasks).where(eq(tasks.novelId, novelId)).orderBy(desc(tasks.updatedAt), desc(tasks.id)).all()
  return rows
    .filter((task) => task.runnerType === 'workflow')
    .map((task) => reconcileStaleWorkflowTask(task))
    .filter((task): task is TaskRow => Boolean(task))
}

export function getWorkflowTask(taskId: number) {
  const task = reconcileStaleWorkflowTask(getTaskRecord(taskId))
  return task?.runnerType === 'workflow' ? task : null
}

export async function resumeWorldRulesAutoGenerateWorkflow(
  taskId: number,
  currentRules?: GenreWorldRules,
  sender?: WebContents,
) {
  const task = getTaskRecord(taskId)
  if (!task || task.runnerType !== 'workflow' || task.type !== 'world_rules_auto_generate') {
    throwUserFacingError('workflow.taskNotFound', { taskId })
  }

  updateTask(taskId, {
    status: 'pending',
    errorMessage: null,
    currentChildTaskId: null,
  })
  updateTaskControl(taskId, {
    ...parseTaskControl(task),
    cancelRequested: false,
    retryCount: 0,
  })

  if (currentRules) {
    const progress = toWorldRulesStatus(taskId, task)
    updateTaskProgress(taskId, {
      ...progress,
      retryCount: 0,
      lastError: '',
      message: progress.pendingSections.length > 0
        ? `准备继续生成 ${WORLD_RULE_SECTION_LABELS.get(progress.pendingSections[0]) || progress.pendingSections[0]}。`
        : '准备继续执行。',
      workingRules: normalizeWorldRulesDraft(currentRules, currentRules.genreProfile.name),
    }, sender)
  }

  void runWorldRulesAutoGenerateWorkflow(taskId, sender)
  return taskId
}

export async function resumeWorkflowTask(taskId: number, sender?: WebContents) {
  const task = getTaskRecord(taskId)
  if (!task || task.runnerType !== 'workflow') {
    throwUserFacingError('workflow.taskNotFound', { taskId })
  }

  if (!RESUMABLE_WORKFLOW_TYPES.has(task.type)) {
    throwUserFacingError('workflow.resumeUnsupported')
  }

  if (task.type === 'map_auto_generate') {
    updateTask(taskId, {
      status: 'pending',
      errorMessage: null,
      currentChildTaskId: null,
    })
    updateTaskControl(taskId, {
      ...parseTaskControl(task),
      cancelRequested: false,
    })

    void runMapAutoGenerateWorkflow(taskId, sender)
    return taskId
  }

  if (task.type === 'world_rules_auto_generate') {
    return resumeWorldRulesAutoGenerateWorkflow(taskId, undefined, sender)
  }

  if (isBatchWorkflowType(task.type)) {
    return resumeBatchAutoGenerateWorkflow(taskId, sender)
  }

  throwUserFacingError('workflow.resumeUnsupported')
}

