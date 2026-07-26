export type TaskEventStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'cancel_requested'

const TASK_EVENT_STATUSES = new Set<TaskEventStatus>([
  'pending',
  'running',
  'success',
  'failed',
  'cancelled',
  'paused',
  'cancel_requested',
])

function readTaskId(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const taskId = (data as { taskId?: unknown }).taskId
  return typeof taskId === 'number' && Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null
}

export function parseTaskEventId(data: unknown): number | null {
  return readTaskId(data)
}

export function parseTaskChunkEvent(data: unknown): { taskId: number; chunk: string } | null {
  const taskId = readTaskId(data)
  if (taskId === null) return null
  const chunk = (data as { chunk?: unknown }).chunk
  return typeof chunk === 'string' ? { taskId, chunk } : null
}

export function parseTaskStatusEvent(data: unknown): { taskId: number; status: TaskEventStatus } | null {
  const taskId = readTaskId(data)
  if (taskId === null) return null
  const status = (data as { status?: unknown }).status
  return typeof status === 'string' && TASK_EVENT_STATUSES.has(status as TaskEventStatus)
    ? { taskId, status: status as TaskEventStatus }
    : null
}

export interface TaskCompleteEvent {
  taskId: number
  status: TaskEventStatus
  error: string | null
}

export function parseTaskCompleteEvent(data: unknown): TaskCompleteEvent | null {
  const statusEvent = parseTaskStatusEvent(data)
  if (!statusEvent) return null
  const error = (data as { error?: unknown }).error
  return {
    ...statusEvent,
    error: typeof error === 'string' && error.trim() ? error : null,
  }
}

export interface TaskProgressEvent {
  taskId: number
  current: number | null
  total: number | null
  percent: number | null
  stage: string | null
  label: string | null
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * `task:progress` carries an opaque progress object; extract the commonly
 * used fields defensively so unknown emitters cannot break the bridge.
 */
export function parseTaskProgressEvent(data: unknown): TaskProgressEvent | null {
  const taskId = readTaskId(data)
  if (taskId === null) return null
  const progress = (data as { progress?: unknown }).progress
  const source = progress && typeof progress === 'object' ? progress as Record<string, unknown> : {}
  return {
    taskId,
    current: readFiniteNumber(source.current) ?? readFiniteNumber(source.completed),
    total: readFiniteNumber(source.total),
    percent: readFiniteNumber(source.percent),
    stage: readNonEmptyString(source.stage),
    label: readNonEmptyString(source.label),
  }
}

export interface ChapterGenerationProgressBridgeEvent {
  chapterId: number
  taskId: number | null
  streamTaskId: number | null
  stage: string
  label: string
  detail: string | null
  completed: number
  total: number
  status: 'running' | 'success' | 'failed' | 'cancelled'
}

export function parseChapterGenerationProgressEvent(data: unknown): ChapterGenerationProgressBridgeEvent | null {
  if (!data || typeof data !== 'object') return null
  const source = data as Record<string, unknown>
  const chapterId = readFiniteNumber(source.chapterId)
  const stage = readNonEmptyString(source.stage)
  const status = readNonEmptyString(source.status)
  if (chapterId === null || !stage) return null
  if (status !== 'running' && status !== 'success' && status !== 'failed' && status !== 'cancelled') return null
  return {
    chapterId,
    taskId: readFiniteNumber(source.taskId),
    streamTaskId: readFiniteNumber(source.streamTaskId),
    stage,
    label: readNonEmptyString(source.label) || stage,
    detail: readNonEmptyString(source.detail),
    completed: readFiniteNumber(source.completed) ?? 0,
    total: readFiniteNumber(source.total) ?? 0,
    status,
  }
}
