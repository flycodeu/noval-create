import type { Chapter } from '../../../types'
import type { PipelineBarItem } from '../../../components/novel/writing/PipelineBar'
import type {
  ReviewNotes,
  WritingPipelineRole,
  WritingPipelineRoleState,
  WritingPipelineSnapshot,
} from './parsers'

const PIPELINE_ROLE_ORDER: WritingPipelineRole[] = [
  'planner',
  'writer',
  'critic',
  'enforcer',
  'rewriter',
  'canonizer',
  'finalize',
]

const PIPELINE_ROLE_LABELS: Record<WritingPipelineRole, string> = {
  planner: '规划',
  writer: '写作',
  critic: '审校',
  enforcer: '一致性守卫',
  rewriter: '重写',
  canonizer: '回写',
  finalize: '定稿',
}

export interface WritingPipelineItemInput {
  chapter: Pick<Chapter, 'content' | 'status'> | null
  snapshot: WritingPipelineSnapshot | null
  reviewNotes: ReviewNotes | null
  sceneCount: number
}

export type WritingPipelineItemViewModel = Omit<PipelineBarItem, 'onRetry'>

function resolveFallbackStatus(
  role: WritingPipelineRole,
  input: WritingPipelineItemInput,
): PipelineBarItem['status'] {
  if (role === 'planner' && input.sceneCount > 0) return 'success'
  if (role === 'writer' && Boolean(input.chapter?.content)) return 'success'
  if (role === 'critic' && Boolean(input.reviewNotes)) return 'success'
  if (role === 'rewriter' && Boolean(input.chapter?.content && input.reviewNotes)) return 'success'
  if (role === 'canonizer' && Boolean(input.snapshot?.canonRunId)) return 'success'
  if (role === 'finalize' && input.chapter?.status === 'final') return 'success'
  return 'pending'
}

function buildPipelineItem(
  role: WritingPipelineRole,
  input: WritingPipelineItemInput,
): WritingPipelineItemViewModel {
  const roleState: WritingPipelineRoleState | undefined = input.snapshot?.roles[role]
  const status = roleState?.status || resolveFallbackStatus(role, input)

  return {
    key: role,
    label: PIPELINE_ROLE_LABELS[role],
    status,
    detail: roleState?.detail || roleState?.summary || (role === 'finalize' ? '确认终稿并进入章后回写。' : '等待进入该阶段。'),
    taskId: roleState?.taskId || input.snapshot?.workflowTaskId,
    contractVersion: roleState?.contractVersion || input.snapshot?.contractVersion,
    durationMs: roleState?.durationMs,
    tokensUsed: roleState?.tokensUsed,
    error: roleState?.failureCode,
    canRetry: status === 'failed' || status === 'blocked',
  }
}

export function buildWritingPipelineItemViewModels(
  input: WritingPipelineItemInput,
): WritingPipelineItemViewModel[] {
  return PIPELINE_ROLE_ORDER.map((role) => buildPipelineItem(role, input))
}

export function attachWritingPipelineRetry(
  items: WritingPipelineItemViewModel[],
  onRetry: () => void,
): PipelineBarItem[] {
  return items.map((item) => ({
    ...item,
    onRetry: item.canRetry ? onRetry : undefined,
  }))
}
