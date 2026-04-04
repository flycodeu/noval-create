import type { PlanningDraftPageKey, RevisionTask, Task } from '../../../types'

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed)
  }
  return null
}

function parseTaskProgress(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function getFallbackPage(taskType?: string): string {
  switch (taskType) {
    case 'timeline':
      return 'timeline'
    case 'item':
      return 'items'
    case 'character':
    case 'relation':
      return 'characters'
    case 'thread':
      return 'threads'
    case 'map':
      return 'map'
    case 'outline':
      return 'outline'
    case 'chapter':
    case 'continuity':
      return 'writing'
    default:
      return 'revision'
  }
}

function buildWorkspacePath(novelId: number, page: string, params?: URLSearchParams): string {
  const query = params && [...params.keys()].length > 0 ? `?${params.toString()}` : ''
  return `/novels/${novelId}/${page}${query}`
}

export function buildRevisionTaskTargetPath(novelId: number, task: RevisionTask): string {
  const page = task.relatedPage || getFallbackPage(task.taskType)
  const params = new URLSearchParams()

  params.set('revisionTaskId', String(task.id))

  if (page === 'characters') {
    const characterId = task.entityType === 'character' ? parsePositiveInt(task.entityId) : null
    if (characterId) params.set('characterId', String(characterId))
  }

  if (page === 'items') {
    const itemId = task.entityType === 'item' ? parsePositiveInt(task.entityId) : null
    if (itemId) params.set('itemId', String(itemId))
  }

  if (page === 'threads') {
    const threadId = task.entityType === 'thread' ? parsePositiveInt(task.entityId) : null
    if (threadId) params.set('threadId', String(threadId))
    params.set('action', 'edit')
  }

  if (page === 'writing') {
    const chapterId = parsePositiveInt(task.chapterId) || (task.entityType === 'chapter' ? parsePositiveInt(task.entityId) : null)
    if (chapterId) params.set('chapterId', String(chapterId))
    if (task.taskType === 'continuity' || task.title.includes('同步上下文')) {
      params.set('insight', 'health')
    }
  }

  if (page === 'timeline') {
    const eventId = task.entityType === 'timeline' ? parsePositiveInt(task.entityId) : null
    if (eventId) params.set('eventId', String(eventId))
    const chapterId = parsePositiveInt(task.chapterId)
    if (chapterId) params.set('chapterId', String(chapterId))
  }

  if (page === 'structure') {
    const chapterId = parsePositiveInt(task.chapterId) || (task.entityType === 'chapter' ? parsePositiveInt(task.entityId) : null)
    if (chapterId) params.set('chapterId', String(chapterId))
    const segmentId = task.entityType === 'segment' ? parsePositiveInt(task.entityId) : null
    if (segmentId) params.set('segmentId', String(segmentId))
  }

  if (page === 'map') {
    const nodeId = task.entityType === 'map' ? parsePositiveInt(task.entityId) : null
    if (nodeId) params.set('nodeId', String(nodeId))
  }

  return buildWorkspacePath(novelId, page, params)
}

export interface TaskRecoveryAction {
  kind: 'resume' | 'recover_draft'
  label: string
  description: string
  path?: string
}

export function buildTaskRecoveryAction(task: Task): TaskRecoveryAction | null {
  if (!task.novelId) return null

  if (task.runnerType === 'workflow' && task.status === 'paused' && (task.type === 'map_auto_generate' || task.type === 'world_rules_auto_generate')) {
    return {
      kind: 'resume',
      label: '继续后台流程',
      description: '从当前暂停节点继续执行，不会重做已完成批次。',
    }
  }

  const progress = parseTaskProgress(task.progressJson)

  if (task.type === 'planning_draft' && progress.kind === 'planning_draft' && !progress.cleared) {
    const draft = progress.draft as Record<string, unknown> | undefined
    const pageKey = typeof draft?.pageKey === 'string' ? draft.pageKey as PlanningDraftPageKey : null
    if (!pageKey) return null

    return {
      kind: 'recover_draft',
      label: '恢复规划草稿',
      description: `打开 ${pageKey} 页面并恢复最近一次未保存的 AI 规划草稿。`,
      path: buildWorkspacePath(task.novelId, pageKey, new URLSearchParams({ recoverDraft: '1' })),
    }
  }

  if (task.type === 'premise_generate' && progress.kind === 'premise_draft' && !progress.cleared) {
    return {
      kind: 'recover_draft',
      label: '恢复基础设定草稿',
      description: '打开基础设定页，并恢复最近一次未保存的 AI 草稿。',
      path: buildWorkspacePath(task.novelId, 'core-settings', new URLSearchParams({ recoverDraft: '1' })),
    }
  }

  return null
}
