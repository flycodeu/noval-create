import { createHash } from 'node:crypto'
import type {
  AiContextAssemblyReport,
  AiExecutionMode,
  AiExplainabilityReport,
  AuthorStyleLockSummary,
  ChapterRewriteScope,
  RecallDiagnostics,
  RecallSnapshot,
  TaskPipelineStage,
  TaskRecoveryHint,
  WriterContextOrchestratorResolution,
} from '../../src/types'

export const CHAPTER_PIPELINE_ROLES = [
  'planner',
  'writer',
  'critic',
  'enforcer',
  'rewriter',
  'canonizer',
  'finalize',
] as const

export type ChapterPipelineRole = typeof CHAPTER_PIPELINE_ROLES[number]
export type ChapterPipelineRoleStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked'
export type ChapterGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'canonizing' | 'completed' | 'failed'
export type ChapterPipelineFailureCode =
  | 'contract_blocked'
  | 'context_overflow'
  | 'empty_output'
  | 'invalid_output'
  | 'anti_ai_failed'
  | 'gate_rewrite_required'
  | 'canon_pending'
  | 'canon_failed'
  | 'human_review_required'

export interface ChapterPipelineRoleState {
  role: ChapterPipelineRole
  label: string
  summary: string
  status: ChapterPipelineRoleStatus
  detail?: string
  taskId?: number
  upstreamTaskId?: number
  contractVersion?: string
  canonRunId?: number
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  tokensUsed?: number
  recoveryHint?: TaskRecoveryHint
  failureCode?: ChapterPipelineFailureCode
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  nodeRunId?: number
  nodeSnapshotId?: string
}

export interface StepMemoryRuntimeState {
  summary: string
  runtimeAssertions: string[]
}

export interface ChapterPipelineSnapshot {
  kind: 'chapter_pipeline'
  chapterId: number
  workflowTaskId: number
  currentRole: ChapterPipelineRole | null
  currentStage: ChapterGenerationStage | null
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  message?: string
  streamTaskId?: number
  executionMode?: AiExecutionMode
  contractVersion?: string
  canonRunId?: number
  totalTokensUsed: number
  totalDurationMs: number
  recallSnapshot?: RecallSnapshot
  recallDiagnostics?: RecallDiagnostics
  contextAssemblyReport?: AiContextAssemblyReport
  authorStyleLock?: AuthorStyleLockSummary
  generationExplainability?: AiExplainabilityReport
  writerContextResolution?: WriterContextOrchestratorResolution
  stepMemory?: StepMemoryRuntimeState
  recoveryHint?: TaskRecoveryHint
  failureCode?: ChapterPipelineFailureCode
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  lastFailureRole?: ChapterPipelineRole
  partialContent?: string
  baseContentHash?: string
  baseContextVersion?: number
  resumeReason?: 'failed' | 'cancelled' | 'timeout' | 'network' | 'unknown'
  resumeSourceTaskId?: number
  roles: Record<ChapterPipelineRole, ChapterPipelineRoleState>
}

export interface ChapterPipelineRetryPlan {
  retryRole: ChapterPipelineRole
  skippedRoles: ChapterPipelineRole[]
  shouldRun: Record<ChapterPipelineRole, boolean>
}

export type ChapterPipelineResumeBaseStatus =
  | 'ready'
  | 'unsupported'
  | 'content_conflict'
  | 'context_conflict'

export function isChapterPipelineRole(value: unknown): value is ChapterPipelineRole {
  return typeof value === 'string' && CHAPTER_PIPELINE_ROLES.some((role) => role === value)
}

export function parseChapterPipelineSnapshot(
  value: string | null | undefined,
): Partial<ChapterPipelineSnapshot> | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<ChapterPipelineSnapshot>
      : null
  } catch {
    return null
  }
}

export function inferChapterPipelineResumeReason(
  error: unknown,
): ChapterPipelineSnapshot['resumeReason'] {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('cancel')) return 'cancelled'
  if (message.includes('timeout') || message.includes('time out')) return 'timeout'
  if (
    message.includes('network')
    || message.includes('socket')
    || message.includes('econn')
    || message.includes('fetch failed')
  ) {
    return 'network'
  }
  return 'failed'
}

export function getChapterPipelineRoleLabel(role: ChapterPipelineRole): string {
  switch (role) {
    case 'planner':
      return 'Planner'
    case 'writer':
      return 'Writer'
    case 'critic':
      return 'Critic'
    case 'enforcer':
      return 'Enforcer'
    case 'rewriter':
      return 'Rewriter'
    case 'canonizer':
      return 'Canonizer'
    case 'finalize':
      return 'Finalize'
  }
}

export function getChapterPipelineRoleSummary(role: ChapterPipelineRole): string {
  switch (role) {
    case 'planner':
      return '固化章节合同与场景执行链。'
    case 'writer':
      return '只按合同与场景计划写正文。'
    case 'critic':
      return '检查连续性、节奏、口吻与 AI 味。'
    case 'enforcer':
      return '强制执行对话指纹和反 AI 味拦截，不达标自动要求重写。'
    case 'rewriter':
      return '按审校结论修正文稿。'
    case 'canonizer':
      return '把正文变成可确认的 Canon 差异草案。'
    case 'finalize':
      return '刷新摘要、连续性与记忆写回。'
  }
}

export function getChapterPipelineRoleStage(role: ChapterPipelineRole): ChapterGenerationStage {
  switch (role) {
    case 'planner':
      return 'planning'
    case 'writer':
      return 'drafting'
    case 'critic':
    case 'enforcer':
      return 'reviewing'
    case 'rewriter':
      return 'rewriting'
    case 'canonizer':
    case 'finalize':
      return 'canonizing'
  }
}

export function buildChapterContentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content || '', 'utf8').digest('hex')}`
}

export function checkpointChapterPipelineContent(
  snapshot: ChapterPipelineSnapshot,
  input: {
    persistedContent: string
    resumableContent?: string
    resumeSourceTaskId?: number
  },
): ChapterPipelineSnapshot {
  return {
    ...snapshot,
    baseContentHash: buildChapterContentHash(input.persistedContent),
    partialContent: input.resumableContent ?? input.persistedContent,
    resumeSourceTaskId: input.resumeSourceTaskId ?? snapshot.resumeSourceTaskId,
  }
}

export function checkpointChapterPipelineContext(
  snapshot: ChapterPipelineSnapshot,
  contextVersion: number,
): ChapterPipelineSnapshot {
  if (!Number.isInteger(contextVersion) || contextVersion <= 0) return snapshot
  return {
    ...snapshot,
    baseContextVersion: contextVersion,
  }
}

export function validateChapterPipelineResumeBase(
  snapshot: Partial<ChapterPipelineSnapshot> | null,
  current: {
    content: string
    contextVersion: number
  },
): ChapterPipelineResumeBaseStatus {
  if (!snapshot?.baseContentHash || !Number.isInteger(snapshot.baseContextVersion)) {
    return 'unsupported'
  }
  if (buildChapterContentHash(current.content) !== snapshot.baseContentHash) {
    return 'content_conflict'
  }
  if (current.contextVersion !== snapshot.baseContextVersion) {
    return 'context_conflict'
  }
  return 'ready'
}

function createChapterPipelineRoleState(role: ChapterPipelineRole): ChapterPipelineRoleState {
  return {
    role,
    label: getChapterPipelineRoleLabel(role),
    summary: getChapterPipelineRoleSummary(role),
    status: 'pending',
  }
}

export function createInitialChapterPipelineSnapshot(
  chapterId: number,
  workflowTaskId: number,
  contractVersion?: string,
  base?: { content: string; contextVersion: number },
): ChapterPipelineSnapshot {
  return {
    kind: 'chapter_pipeline',
    chapterId,
    workflowTaskId,
    currentRole: null,
    currentStage: 'planning',
    status: 'pending',
    contractVersion,
    ...(base
      ? {
          baseContentHash: buildChapterContentHash(base.content),
          baseContextVersion: base.contextVersion,
        }
      : {}),
    totalTokensUsed: 0,
    totalDurationMs: 0,
    stepMemory: {
      summary: '',
      runtimeAssertions: [],
    },
    roles: {
      planner: createChapterPipelineRoleState('planner'),
      writer: createChapterPipelineRoleState('writer'),
      critic: createChapterPipelineRoleState('critic'),
      enforcer: createChapterPipelineRoleState('enforcer'),
      rewriter: createChapterPipelineRoleState('rewriter'),
      canonizer: createChapterPipelineRoleState('canonizer'),
      finalize: createChapterPipelineRoleState('finalize'),
    },
  }
}

export function getCompletedChapterPipelineRoleCount(snapshot: ChapterPipelineSnapshot): number {
  return Object.values(snapshot.roles).filter((role) => role.status === 'success').length
}

export function getChapterPipelineTaskStage(snapshot: ChapterPipelineSnapshot): TaskPipelineStage {
  if (snapshot.currentRole) {
    const currentRoleState = snapshot.roles[snapshot.currentRole]
    if (currentRoleState.status === 'blocked') return 'blocked'
    if (currentRoleState.status === 'failed') return 'failed'
    if (currentRoleState.status === 'success') return 'success'
    return currentRoleState.status === 'pending' ? 'pending' : 'running'
  }
  if (snapshot.status === 'success') return 'success'
  if (snapshot.status === 'failed' || snapshot.status === 'cancelled') return 'failed'
  return snapshot.status === 'pending' ? 'pending' : 'running'
}

export function buildChapterPipelineRetryPlan(retryRole: ChapterPipelineRole): ChapterPipelineRetryPlan {
  const retryIndex = CHAPTER_PIPELINE_ROLES.indexOf(retryRole)
  const skippedRoles = CHAPTER_PIPELINE_ROLES.slice(0, retryIndex)
  return {
    retryRole,
    skippedRoles,
    shouldRun: Object.fromEntries(
      CHAPTER_PIPELINE_ROLES.map((role, index) => [role, index >= retryIndex]),
    ) as Record<ChapterPipelineRole, boolean>,
  }
}

export function startChapterPipelineRole(
  snapshot: ChapterPipelineSnapshot,
  input: {
    role: ChapterPipelineRole
    taskId: number
    detail: string
    upstreamTaskId?: number
    contractVersion?: string
    canonRunId?: number
    nodeRunId?: number
    startedAt: string
  },
): ChapterPipelineSnapshot {
  const { role } = input
  return {
    ...snapshot,
    currentRole: role,
    currentStage: getChapterPipelineRoleStage(role),
    status: 'running',
    message: input.detail,
    streamTaskId: role === 'rewriter' ? input.taskId : undefined,
    recoveryHint: undefined,
    roles: {
      ...snapshot.roles,
      [role]: {
        ...snapshot.roles[role],
        status: 'running',
        detail: input.detail,
        taskId: input.taskId,
        nodeRunId: input.nodeRunId,
        upstreamTaskId: input.upstreamTaskId,
        contractVersion: input.contractVersion,
        canonRunId: input.canonRunId,
        startedAt: input.startedAt,
        finishedAt: undefined,
        durationMs: undefined,
        tokensUsed: undefined,
        recoveryHint: undefined,
      },
    },
  }
}

export function applyChapterPipelineRoleMetrics(
  snapshot: ChapterPipelineSnapshot,
  role: ChapterPipelineRole,
  input: {
    taskId: number
    durationMs?: number | null
    tokensUsed?: number | null
  },
): ChapterPipelineSnapshot {
  const roleState = snapshot.roles[role]
  const nextDuration = typeof input.durationMs === 'number' && input.durationMs > 0
    ? input.durationMs
    : roleState.durationMs
  const nextTokens = typeof input.tokensUsed === 'number' && input.tokensUsed > 0
    ? input.tokensUsed
    : roleState.tokensUsed
  const nextRoles = {
    ...snapshot.roles,
    [role]: {
      ...roleState,
      taskId: input.taskId,
      durationMs: nextDuration,
      tokensUsed: nextTokens,
    },
  }
  return {
    ...snapshot,
    roles: nextRoles,
    totalDurationMs: Object.values(nextRoles).reduce((sum, item) => sum + (item.durationMs || 0), 0),
    totalTokensUsed: Object.values(nextRoles).reduce((sum, item) => sum + (item.tokensUsed || 0), 0),
  }
}

export function completeChapterPipelineRole(
  snapshot: ChapterPipelineSnapshot,
  input: {
    role: ChapterPipelineRole
    taskId: number
    detail: string
    finishedAt: string
    nodeRunId?: number
    nodeSnapshotId?: string
    extra?: Partial<ChapterPipelineRoleState>
  },
): ChapterPipelineSnapshot {
  const { role } = input
  return {
    ...snapshot,
    message: input.detail,
    streamTaskId: role === 'rewriter' ? undefined : snapshot.streamTaskId,
    canonRunId: input.extra?.canonRunId ?? snapshot.canonRunId,
    recoveryHint: undefined,
    roles: {
      ...snapshot.roles,
      [role]: {
        ...snapshot.roles[role],
        status: 'success',
        detail: input.detail,
        taskId: input.taskId,
        finishedAt: input.finishedAt,
        nodeRunId: input.nodeRunId,
        nodeSnapshotId: input.nodeSnapshotId,
        recoveryHint: undefined,
        failureCode: undefined,
        rewriteScope: undefined,
        targetSegmentId: undefined,
        ...input.extra,
      },
    },
    failureCode: undefined,
    rewriteScope: undefined,
    targetSegmentId: undefined,
    lastFailureRole: undefined,
  }
}

export function failChapterPipelineRole(
  snapshot: ChapterPipelineSnapshot,
  input: {
    role: ChapterPipelineRole
    taskId?: number
    detail: string
    blocked: boolean
    aborted: boolean
    finishedAt: string
    recoveryHint?: TaskRecoveryHint
    failureCode?: ChapterPipelineFailureCode
    rewriteScope?: ChapterRewriteScope
    targetSegmentId?: number | null
    nodeRunId?: number
    resumeReason: ChapterPipelineSnapshot['resumeReason']
    resumeSourceTaskId?: number
  },
): ChapterPipelineSnapshot {
  const { role } = input
  return {
    ...snapshot,
    currentRole: role,
    currentStage: getChapterPipelineRoleStage(role),
    status: input.aborted ? 'cancelled' : 'failed',
    message: input.detail,
    streamTaskId: undefined,
    recoveryHint: input.recoveryHint,
    failureCode: input.failureCode,
    rewriteScope: input.rewriteScope,
    targetSegmentId: input.targetSegmentId,
    lastFailureRole: role,
    resumeReason: input.resumeReason,
    resumeSourceTaskId: input.resumeSourceTaskId ?? input.taskId ?? snapshot.resumeSourceTaskId,
    roles: {
      ...snapshot.roles,
      [role]: {
        ...snapshot.roles[role],
        status: input.blocked ? 'blocked' : 'failed',
        detail: input.detail,
        taskId: input.taskId ?? snapshot.roles[role].taskId,
        finishedAt: input.finishedAt,
        recoveryHint: input.recoveryHint,
        failureCode: input.failureCode,
        rewriteScope: input.rewriteScope,
        targetSegmentId: input.targetSegmentId,
        nodeRunId: input.nodeRunId,
      },
    },
  }
}
