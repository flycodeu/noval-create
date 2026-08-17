import type { ProgressSink } from '../utils/progress-sink'
import { tasks } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import type { AiExecutionMode, ChapterRewriteScope, TaskRecoveryHint } from '../../src/types'
import {
  createTask,
  getTaskRecord,
  parseTaskControl,
  updateTask,
  updateTaskProgress,
  updateTaskStatus,
} from './task.service'
import {
  beginWorkflowNode,
  failWorkflowNode,
  hashWorkflowNodeInput,
  recordWorkflowNodeSnapshot,
  renewWorkflowNodeLease,
} from './workflow-node.service'
import {
  applyChapterPipelineRoleMetrics,
  buildChapterPipelineRetryPlan,
  checkpointChapterPipelineContent,
  checkpointChapterPipelineContext,
  completeChapterPipelineRole,
  createInitialChapterPipelineSnapshot,
  failChapterPipelineRole,
  getChapterPipelineRoleLabel,
  getChapterPipelineRoleStage,
  getChapterPipelineTaskStage,
  inferChapterPipelineResumeReason,
  startChapterPipelineRole,
  type ChapterGenerationStage,
  type ChapterPipelineFailureCode,
  type ChapterPipelineRole,
  type ChapterPipelineRoleState,
  type ChapterPipelineSnapshot,
} from './chapter-pipeline-state'
import {
  appendRevisionBrief,
  dedupeTextList,
  mergeSeverity,
  parseStoredReviewNotes,
  type ChapterReviewNotes,
} from './chapter-review-notes'
import {
  buildPipelineFailureOutput,
  classifyChapterPipelineFailure,
} from './chapter-pipeline-errors'

type TaskPatch = Partial<typeof tasks.$inferInsert>
type RoleTaskType =
  | 'chapter_planner'
  | 'chapter_writer'
  | 'chapter_critic'
  | 'chapter_rewriter'
  | 'chapter_canonizer'
  | 'chapter_finalize'

export interface RuntimeProgress {
  stage: ChapterGenerationStage
  label: string
  detail?: string
  status: 'running' | 'success' | 'failed' | 'cancelled'
  role?: ChapterPipelineRole
}

interface RuntimeRetryInput {
  retryNodeRole?: ChapterPipelineRole
  retrySourceNodeRunId?: number
  retryReason?: string
  retryUpstreamSnapshotId?: string | null
}

interface WorkflowOutputRefs {
  chapterId: number
  contentHash: string
  scenePlanHash: string
  reviewNotesHash: string
}

export interface CreateChapterPipelineRuntimeInput {
  chapterId: number
  novelId: number
  modelConfigId?: number
  sender?: ProgressSink
  idempotencyKey?: string
  stageId?: number
  resumeDraft?: string
  resumeSourceTaskId?: number
  executionMode: AiExecutionMode
  initialContent: string
  initialContextVersion: number
  initialContractVersion?: string
  retry?: RuntimeRetryInput
  onWorkflowTaskCreated?(taskId: number): void
  buildRecoveryHint(role: ChapterPipelineRole, failureCode?: ChapterPipelineFailureCode): TaskRecoveryHint
  getOutputRefs(): WorkflowOutputRefs
  onProgress(snapshot: ChapterPipelineSnapshot, progress: RuntimeProgress): void
}

export interface StartPipelineRoleInput {
  role: ChapterPipelineRole
  type: RoleTaskType
  detail: string
  inputJson?: string
  runnerType?: 'chat' | 'stream' | 'workflow'
  canonRunId?: number
}

export interface FailPipelineRoleInput {
  role: ChapterPipelineRole
  taskId?: number
  detail: string
  blocked: boolean
  aborted: boolean
  recoveryHint: TaskRecoveryHint
  failureCode?: ChapterPipelineFailureCode
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  outputText?: string
  resumeReason: ChapterPipelineSnapshot['resumeReason']
}

export interface ReusePipelineRoleInput {
  taskId?: number
  detail: string
  outputText?: string
  snapshot?: Partial<Pick<
    ChapterPipelineSnapshot,
    'contractVersion' | 'stepMemory' | 'partialContent' | 'resumeSourceTaskId' | 'canonRunId'
  >>
  extra?: Partial<ChapterPipelineRoleState>
}

interface NodeLeaseState {
  taskId: number
  nodeRunId: number
  leaseToken: string
  inputJson?: string
  renewTimer?: ReturnType<typeof setInterval>
}

function serializeRecoveryHint(hint?: TaskRecoveryHint): string | undefined {
  return hint ? JSON.stringify(hint) : undefined
}

export class ChapterPipelineRuntime {
  readonly workflowTaskId: number
  readonly chapterId: number

  private readonly input: CreateChapterPipelineRuntimeInput
  private readonly nodeLeases = new Map<ChapterPipelineRole, NodeLeaseState>()
  private currentSnapshot: ChapterPipelineSnapshot
  private upstreamTaskId?: number

  private constructor(
    input: CreateChapterPipelineRuntimeInput,
    workflowTaskId: number,
    snapshot: ChapterPipelineSnapshot,
  ) {
    this.input = input
    this.workflowTaskId = workflowTaskId
    this.chapterId = input.chapterId
    this.currentSnapshot = snapshot
  }

  static async create(input: CreateChapterPipelineRuntimeInput): Promise<ChapterPipelineRuntime> {
    const workflowTaskId = await createTask({
      type: 'chapter_write',
      novelId: input.novelId,
      modelConfigId: input.modelConfigId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapterId,
      idempotencyKey: input.idempotencyKey,
      runnerType: 'workflow',
      pipelineRole: 'planner',
      pipelineStage: 'pending',
      contractVersion: input.initialContractVersion || undefined,
      controlJson: JSON.stringify({
        cancelRequested: false,
        ...(input.stageId ? { stageId: input.stageId } : {}),
        ...(input.resumeSourceTaskId ? { resumeSourceTaskId: input.resumeSourceTaskId } : {}),
      }),
      progressJson: '{}',
      retryable: false,
      status: 'pending',
    })
    input.onWorkflowTaskCreated?.(workflowTaskId)
    const initialSnapshot = createInitialChapterPipelineSnapshot(
      input.chapterId,
      workflowTaskId,
      input.initialContractVersion,
      { content: input.initialContent, contextVersion: input.initialContextVersion },
    )
    const snapshot: ChapterPipelineSnapshot = {
      ...initialSnapshot,
      executionMode: input.executionMode,
      ...(input.resumeDraft?.trim()
        ? {
            partialContent: input.resumeDraft.trim(),
            resumeSourceTaskId: input.resumeSourceTaskId,
          }
        : {}),
    }
    return new ChapterPipelineRuntime(input, workflowTaskId, snapshot)
  }

  get snapshot(): ChapterPipelineSnapshot {
    return this.currentSnapshot
  }

  adoptSnapshot(snapshot: ChapterPipelineSnapshot): void {
    this.currentSnapshot = snapshot
  }

  shouldRun(role: ChapterPipelineRole): boolean {
    const retryRole = this.input.retry?.retryNodeRole
    return retryRole ? buildChapterPipelineRetryPlan(retryRole).shouldRun[role] : true
  }

  setUpstreamTaskId(taskId?: number): void {
    if (taskId) this.upstreamTaskId = taskId
  }

  checkpointContent(input: {
    persistedContent: string
    resumableContent?: string
    resumeSourceTaskId?: number
  }): ChapterPipelineSnapshot {
    this.currentSnapshot = checkpointChapterPipelineContent(this.currentSnapshot, input)
    return this.currentSnapshot
  }

  checkpointContext(contextVersion: number): ChapterPipelineSnapshot {
    this.currentSnapshot = checkpointChapterPipelineContext(this.currentSnapshot, contextVersion)
    return this.currentSnapshot
  }

  sync(extra: TaskPatch = {}): void {
    updateTaskProgress(this.workflowTaskId, this.currentSnapshot, this.input.sender)
    updateTask(this.workflowTaskId, {
      pipelineRole: this.currentSnapshot.currentRole || undefined,
      pipelineStage: getChapterPipelineTaskStage(this.currentSnapshot),
      contractVersion: this.currentSnapshot.contractVersion,
      canonRunId: this.currentSnapshot.canonRunId,
      recoveryHintJson: serializeRecoveryHint(this.currentSnapshot.recoveryHint),
      progressJson: JSON.stringify(this.currentSnapshot),
      ...extra,
    })
  }

  setStatus(
    status: 'running' | 'success' | 'failed' | 'cancelled',
    extra: TaskPatch = {},
  ): void {
    updateTaskStatus(this.workflowTaskId, status, this.input.sender, {
      pipelineRole: this.currentSnapshot.currentRole || undefined,
      pipelineStage: getChapterPipelineTaskStage(this.currentSnapshot),
      contractVersion: this.currentSnapshot.contractVersion,
      canonRunId: this.currentSnapshot.canonRunId,
      recoveryHintJson: serializeRecoveryHint(this.currentSnapshot.recoveryHint),
      progressJson: JSON.stringify(this.currentSnapshot),
      ...extra,
    })
  }

  assertActive(): void {
    const task = getTaskRecord(this.workflowTaskId)
    if (!task) throwUserFacingError('task.notFound', { id: this.workflowTaskId })
    if (!parseTaskControl(task).cancelRequested) return
    const error = new Error('用户已取消')
    error.name = 'AbortError'
    throw error
  }

  isAbort(error: unknown, taskId?: number): boolean {
    if (error instanceof Error && error.name === 'AbortError') return true
    const taskIds = [this.workflowTaskId, taskId].filter((value): value is number => typeof value === 'number')
    return taskIds.some((id) => {
      const task = getTaskRecord(id)
      return Boolean(task && parseTaskControl(task).cancelRequested)
    })
  }

  async startRole(input: StartPipelineRoleInput): Promise<number> {
    this.assertActive()
    this.closeSupersededRoleNode(input.role)
    const childTaskId = await createTask({
      type: input.type,
      novelId: this.input.novelId,
      modelConfigId: this.input.modelConfigId,
      relatedEntityType: 'chapter',
      relatedEntityId: this.chapterId,
      inputJson: input.inputJson,
      runnerType: input.runnerType || 'chat',
      retryable: false,
      parentTaskId: this.workflowTaskId,
      pipelineRole: input.role,
      pipelineStage: 'pending',
      upstreamTaskId: this.upstreamTaskId,
      contractVersion: this.currentSnapshot.contractVersion,
      canonRunId: input.canonRunId,
      recoveryHintJson: serializeRecoveryHint(this.input.buildRecoveryHint(input.role)),
      status: 'pending',
    })
    const nodeLease = this.beginRoleNode(input, childTaskId)
    this.currentSnapshot = startChapterPipelineRole(this.currentSnapshot, {
      role: input.role,
      taskId: childTaskId,
      detail: input.detail,
      nodeRunId: nodeLease.nodeRunId,
      upstreamTaskId: this.upstreamTaskId,
      contractVersion: this.currentSnapshot.contractVersion,
      canonRunId: input.canonRunId,
      startedAt: new Date().toISOString(),
    })
    this.sync({ currentChildTaskId: childTaskId, errorMessage: null })
    updateTask(childTaskId, { pipelineStage: 'running' })
    this.emitProgress({
      stage: this.currentSnapshot.currentStage || 'planning',
      label: this.currentSnapshot.roles[input.role].label,
      detail: input.detail,
      status: 'running',
      role: input.role,
    })
    return childTaskId
  }

  finishRole(
    role: ChapterPipelineRole,
    taskId: number,
    detail: string,
    extra: Partial<ChapterPipelineRoleState> = {},
  ): void {
    const nodeLease = this.nodeLeases.get(role)
    const nodeSnapshotId = nodeLease ? this.finishRoleNode(role, taskId, detail, extra, nodeLease) : undefined
    if (nodeLease) this.nodeLeases.delete(role)
    this.currentSnapshot = this.applyRoleMetrics(role, taskId)
    this.currentSnapshot = completeChapterPipelineRole(this.currentSnapshot, {
      role,
      taskId,
      detail,
      finishedAt: new Date().toISOString(),
      nodeRunId: nodeLease?.nodeRunId,
      nodeSnapshotId,
      extra,
    })
    updateTask(taskId, {
      pipelineStage: 'success',
      canonRunId: this.currentSnapshot.canonRunId,
      recoveryHintJson: null,
      contractVersion: this.currentSnapshot.contractVersion,
    })
    this.sync({ currentChildTaskId: null, errorMessage: null, recoveryHintJson: null })
    this.upstreamTaskId = taskId
  }

  reuseRole(role: ChapterPipelineRole, input: ReusePipelineRoleInput): void {
    this.currentSnapshot = {
      ...this.currentSnapshot,
      ...input.snapshot,
      roles: {
        ...this.currentSnapshot.roles,
        [role]: {
          ...this.currentSnapshot.roles[role],
          status: 'success',
          detail: input.detail,
          taskId: input.taskId,
          finishedAt: new Date().toISOString(),
          ...input.extra,
        },
      },
    }
    this.setUpstreamTaskId(input.taskId)
    this.sync(input.outputText ? { outputText: input.outputText } : {})
  }

  failRole(input: FailPipelineRoleInput): void {
    const nodeLease = this.nodeLeases.get(input.role)
    if (nodeLease) {
      this.failRoleNode(input, nodeLease)
      this.nodeLeases.delete(input.role)
    }
    if (typeof input.taskId === 'number') {
      updateTask(input.taskId, {
        pipelineStage: input.blocked ? 'blocked' : 'failed',
        recoveryHintJson: serializeRecoveryHint(input.recoveryHint),
        contractVersion: this.currentSnapshot.contractVersion,
        canonRunId: this.currentSnapshot.canonRunId,
        outputText: input.outputText,
      })
      this.currentSnapshot = this.applyRoleMetrics(input.role, input.taskId)
    }
    this.currentSnapshot = failChapterPipelineRole(this.currentSnapshot, {
      role: input.role,
      taskId: input.taskId,
      detail: input.detail,
      blocked: input.blocked,
      aborted: input.aborted,
      finishedAt: new Date().toISOString(),
      recoveryHint: input.recoveryHint,
      failureCode: input.failureCode,
      rewriteScope: input.rewriteScope,
      targetSegmentId: input.targetSegmentId,
      nodeRunId: nodeLease?.nodeRunId,
      resumeReason: input.resumeReason,
    })
  }

  emitProgress(progress: RuntimeProgress): void {
    this.input.onProgress(this.currentSnapshot, progress)
  }

  private beginRoleNode(input: StartPipelineRoleInput, childTaskId: number): NodeLeaseState {
    const retry = this.input.retry
    const contextVersion = this.currentSnapshot.baseContextVersion || this.input.initialContextVersion
    const nodeLease = beginWorkflowNode({
      workflowTaskId: this.workflowTaskId,
      novelId: this.input.novelId,
      chapterId: this.chapterId,
      nodeKey: input.role,
      inputHash: hashWorkflowNodeInput({
        role: input.role,
        contractVersion: this.currentSnapshot.contractVersion,
        contextVersion,
        upstreamTaskId: this.upstreamTaskId || null,
        inputJson: input.inputJson || null,
        canonRunId: input.canonRunId || null,
      }),
      contextVersion,
      leaseOwner: `chapter:${this.chapterId}:task:${childTaskId}`,
      retryOfNodeRunId: retry?.retryNodeRole === input.role ? retry.retrySourceNodeRunId : undefined,
      retryReason: retry?.retryNodeRole === input.role ? retry.retryReason : undefined,
      upstreamSnapshotId: retry?.retryNodeRole === input.role ? retry.retryUpstreamSnapshotId : undefined,
    })
    const leaseState: NodeLeaseState = {
      taskId: childTaskId,
      nodeRunId: nodeLease.nodeRunId,
      leaseToken: nodeLease.leaseToken,
      inputJson: input.inputJson,
    }
    leaseState.renewTimer = setInterval(() => this.renewRoleNode(input.role), 120_000)
    leaseState.renewTimer.unref?.()
    this.nodeLeases.set(input.role, leaseState)
    return leaseState
  }

  private renewRoleNode(role: ChapterPipelineRole): void {
    const lease = this.nodeLeases.get(role)
    if (!lease) return
    try {
      renewWorkflowNodeLease(lease.nodeRunId, lease.leaseToken)
    } catch {
      if (lease.renewTimer) clearInterval(lease.renewTimer)
    }
  }

  private closeSupersededRoleNode(role: ChapterPipelineRole): void {
    const lease = this.nodeLeases.get(role)
    if (!lease) return
    if (lease.renewTimer) clearInterval(lease.renewTimer)
    const task = getTaskRecord(lease.taskId)
    const status = task?.status === 'cancelled'
      ? 'cancelled'
      : task?.pipelineStage === 'blocked'
        ? 'blocked'
        : 'failed'
    try {
      failWorkflowNode({
        nodeRunId: lease.nodeRunId,
        leaseToken: lease.leaseToken,
        status,
        errorClass: 'superseded_attempt',
        errorMessage: '同一角色已启动后续有界尝试，前一节点租约已关闭。',
      })
    } catch (error) {
      console.warn('[workflow-node] 被后续尝试取代的节点租约关闭失败', error)
    }
    this.nodeLeases.delete(role)
  }

  private finishRoleNode(
    role: ChapterPipelineRole,
    taskId: number,
    detail: string,
    extra: Partial<ChapterPipelineRoleState>,
    lease: NodeLeaseState,
  ): string {
    if (lease.renewTimer) clearInterval(lease.renewTimer)
    const nodeSnapshot = recordWorkflowNodeSnapshot({
      nodeRunId: lease.nodeRunId,
      leaseToken: lease.leaseToken,
      payload: {
        role,
        taskId,
        workflowTaskId: this.workflowTaskId,
        chapterId: this.chapterId,
        status: 'success',
        detail,
        contractVersion: this.currentSnapshot.contractVersion,
        contextVersion: this.currentSnapshot.baseContextVersion,
        inputJson: lease.inputJson,
        outputRefs: this.input.getOutputRefs(),
        roleState: this.currentSnapshot.roles[role],
      },
      outputHash: hashWorkflowNodeInput({ role, taskId, detail, extra }),
    })
    return nodeSnapshot.id
  }

  private failRoleNode(input: FailPipelineRoleInput, lease: NodeLeaseState): void {
    if (lease.renewTimer) clearInterval(lease.renewTimer)
    try {
      failWorkflowNode({
        nodeRunId: lease.nodeRunId,
        leaseToken: lease.leaseToken,
        status: input.aborted ? 'cancelled' : input.blocked ? 'blocked' : 'failed',
        errorClass: input.failureCode,
        errorMessage: input.detail,
      })
    } catch (error) {
      console.warn('[workflow-node] 节点失败状态持久化失败', error)
    }
  }

  private applyRoleMetrics(role: ChapterPipelineRole, taskId: number): ChapterPipelineSnapshot {
    const task = getTaskRecord(taskId)
    if (!task) return this.currentSnapshot
    return applyChapterPipelineRoleMetrics(this.currentSnapshot, role, {
      taskId,
      durationMs: task.durationMs,
      tokensUsed: task.tokensUsed,
    })
  }
}

export interface ChapterPipelineRuntimeBindings {
  shouldRun(role: ChapterPipelineRole): boolean
  sync(extra?: TaskPatch): void
  setStatus(status: 'running' | 'success' | 'failed' | 'cancelled', extra?: TaskPatch): void
  startRole(
    role: ChapterPipelineRole,
    type: RoleTaskType,
    detail: string,
    options?: Pick<StartPipelineRoleInput, 'inputJson' | 'runnerType' | 'canonRunId'>,
  ): Promise<number>
  finishRole(role: ChapterPipelineRole, taskId: number, detail: string, extra?: Partial<ChapterPipelineRoleState>): void
  reuseRole(role: ChapterPipelineRole, input: ReusePipelineRoleInput): void
  failRole(role: ChapterPipelineRole, taskId: number | undefined, error: unknown, options?: { blocked?: boolean }): never
}

export function createChapterPipelineRuntimeBindings(input: {
  runtime: ChapterPipelineRuntime
  chapter: { novelId: number; reviewNotesJson?: string | null }
  chapterId: number
  previousStatus: string
  getSnapshot: () => ChapterPipelineSnapshot
  setSnapshot: (snapshot: ChapterPipelineSnapshot) => void
  getLatestUsableDraft: () => string
  getLatestReviewNotesJson: () => string
  getHasCommittedContent: () => boolean
  setHasCommittedContent: (value: boolean) => void
  persistUsableDraft: (content: string, reviewNotesJson: string) => string
  setExpectedContent: (content: string) => void
  updateFailureStatus: (status: string, restorePrevious: boolean) => void
  buildRecoveryHint: (role: ChapterPipelineRole, failureCode?: ChapterPipelineFailureCode) => TaskRecoveryHint
}): ChapterPipelineRuntimeBindings {
  const sync = (extra: TaskPatch = {}) => {
    input.runtime.adoptSnapshot(input.getSnapshot())
    input.runtime.sync(extra)
    input.setSnapshot(input.runtime.snapshot)
  }
  const setStatus = (status: 'running' | 'success' | 'failed' | 'cancelled', extra: TaskPatch = {}) => {
    input.runtime.adoptSnapshot(input.getSnapshot())
    input.runtime.setStatus(status, extra)
    input.setSnapshot(input.runtime.snapshot)
  }
  const buildHoldReviewNotesJson = (
    role: ChapterPipelineRole,
    detail: string,
    failureCode?: ChapterPipelineFailureCode,
  ) => {
    const notes = parseStoredReviewNotes(input.getLatestReviewNotesJson() || input.chapter.reviewNotesJson)
    const holdLine = `${getChapterPipelineRoleLabel(role)} 未完成：${detail}。当前可用稿已保存为待人工审核/可重试状态。`
    const codeLine = failureCode ? `失败代码：${failureCode}` : ''
    const nextNotes: ChapterReviewNotes = {
      ...notes,
      summary: notes.summary || holdLine,
      critical_fixes: dedupeTextList([holdLine, codeLine, ...notes.critical_fixes]),
      revision_brief: appendRevisionBrief(notes.revision_brief, [
        '先人工确认当前保留稿，再按失败原因选择续跑或重新生成。',
      ]),
      rewrite_required: true,
      severity: mergeSeverity(notes.severity, 'medium'),
    }
    return JSON.stringify(nextNotes)
  }
  const preserveUsableDraft = (
    role: ChapterPipelineRole,
    detail: string,
    failureCode?: ChapterPipelineFailureCode,
  ): boolean => {
    const usableDraft = input.getLatestUsableDraft().trim()
    if (!usableDraft) return false
    const snapshot = input.getSnapshot()
    const resumableContent = role === 'writer' ? snapshot.partialContent?.trim() || usableDraft : usableDraft
    input.setExpectedContent(input.persistUsableDraft(
      usableDraft,
      buildHoldReviewNotesJson(role, detail, failureCode),
    ))
    input.setHasCommittedContent(true)
    input.runtime.adoptSnapshot(snapshot)
    input.setSnapshot(input.runtime.checkpointContent({ persistedContent: usableDraft, resumableContent }))
    return true
  }

  return {
    shouldRun: (role) => input.runtime.shouldRun(role),
    sync,
    setStatus,
    startRole: async (role, type, detail, options = {}) => {
      input.runtime.adoptSnapshot(input.getSnapshot())
      const taskId = await input.runtime.startRole({ role, type, detail, ...options })
      input.setSnapshot(input.runtime.snapshot)
      return taskId
    },
    finishRole: (role, taskId, detail, extra = {}) => {
      input.runtime.adoptSnapshot(input.getSnapshot())
      input.runtime.finishRole(role, taskId, detail, extra)
      input.setSnapshot(input.runtime.snapshot)
    },
    reuseRole: (role, reuseInput) => {
      input.runtime.adoptSnapshot(input.getSnapshot())
      input.runtime.reuseRole(role, reuseInput)
      input.setSnapshot(input.runtime.snapshot)
    },
    failRole: (role, taskId, error, options = {}): never => {
      input.runtime.adoptSnapshot(input.getSnapshot())
      const aborted = input.runtime.isAbort(error, taskId)
      const detail = error instanceof Error ? error.message : `${getChapterPipelineRoleLabel(role)} 执行失败`
      const failure = classifyChapterPipelineFailure(role, error)
      const blocked = options.blocked || failure.blocked
      const stateConflict = Boolean(error && typeof error === 'object' && 'code' in error && [
        'chapter.pipelineContentConflict',
        'chapter.pipelineInputConflict',
        'chapter.pipelineContextConflict',
      ].includes(String((error as { code?: unknown }).code || '')))
      const outputText = failure.outputText || (failure.code
        ? buildPipelineFailureOutput(failure.code, detail, {
            rewriteScope: failure.rewriteScope,
            targetSegmentId: failure.targetSegmentId,
          })
        : undefined)
      input.runtime.failRole({
        role,
        taskId,
        detail,
        blocked,
        aborted,
        recoveryHint: input.buildRecoveryHint(role, failure.code),
        failureCode: failure.code,
        rewriteScope: failure.rewriteScope,
        targetSegmentId: failure.targetSegmentId,
        outputText,
        resumeReason: aborted ? 'cancelled' : inferChapterPipelineResumeReason(error),
      })
      input.setSnapshot(input.runtime.snapshot)
      const preserved = !aborted && !stateConflict && preserveUsableDraft(role, detail, failure.code)
      if (!stateConflict && !preserved && !input.getHasCommittedContent()) {
        input.updateFailureStatus(input.previousStatus, true)
      } else if (!stateConflict && !preserved) {
        input.updateFailureStatus(blocked ? 'reviewing' : 'draft', false)
      }
      setStatus(aborted ? 'cancelled' : 'failed', {
        currentChildTaskId: null,
        errorMessage: aborted ? '用户已取消' : detail,
        pipelineStage: blocked ? 'blocked' : 'failed',
        outputText,
      })
      input.runtime.adoptSnapshot(input.getSnapshot())
      input.runtime.emitProgress({
        stage: getChapterPipelineRoleStage(role),
        label: aborted ? '章节流水线已取消' : `${input.getSnapshot().roles[role].label} 失败`,
        detail,
        status: aborted ? 'cancelled' : 'failed',
        role,
      })
      throw error instanceof Error ? error : new Error(detail)
    },
  }
}
