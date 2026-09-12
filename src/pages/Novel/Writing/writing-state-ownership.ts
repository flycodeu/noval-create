import type { ChapterContextPreview, Task } from '../../../types'
import type { WritingPipelineSnapshot } from './parsers'

export interface WritingContextPreviewState {
  preview: ChapterContextPreview | null
  error: string | null
}

type PreviewAction =
  | { type: 'start' }
  | { type: 'clear' }
  | { type: 'success'; preview: ChapterContextPreview }
  | { type: 'failure'; error: string }

/** Query result and its error commit together; this state never owns editor text. */
export function reduceWritingContextPreview(
  state: WritingContextPreviewState,
  action: PreviewAction,
): WritingContextPreviewState {
  switch (action.type) {
    case 'start': return { ...state, error: null }
    case 'clear': return { preview: null, error: null }
    case 'success': return { preview: action.preview, error: null }
    case 'failure': return { preview: null, error: action.error }
  }
}

/** Resume the persisted task belonging to this chapter, without rebuilding its budget. */
export function canResumeWritingPipeline(
  chapterId: number | null,
  task: Pick<Task, 'id'> | null,
  snapshot: WritingPipelineSnapshot | null,
): boolean {
  return chapterId !== null
    && snapshot?.chapterId === chapterId
    && Boolean(task?.id && snapshot.workflowTaskId === task.id)
    && (snapshot.status === 'failed' || snapshot.status === 'cancelled')
}

/** Adopt the new workflow id only when its live snapshot names this exact resume source. */
export function isWritingPipelineResumeHandoff(input: {
  sourceChapterId: number | null
  sourceTaskId: number | null
  eventChapterId: number
  eventTaskId?: number
  snapshot?: WritingPipelineSnapshot
}): boolean {
  const { sourceChapterId, sourceTaskId, eventChapterId, eventTaskId, snapshot } = input
  return sourceChapterId === eventChapterId
    && typeof sourceTaskId === 'number'
    && sourceTaskId > 0
    && typeof eventTaskId === 'number'
    && eventTaskId > 0
    && eventTaskId !== sourceTaskId
    && snapshot?.chapterId === eventChapterId
    && snapshot.workflowTaskId === eventTaskId
    && snapshot.resumeSourceTaskId === sourceTaskId
    && snapshot.status === 'running'
}
