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
