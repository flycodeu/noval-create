import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getTaskRecord: vi.fn(),
  parseTaskControl: vi.fn(),
  updateTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
  beginWorkflowNode: vi.fn(),
  failWorkflowNode: vi.fn(),
  hashWorkflowNodeInput: vi.fn(),
  recordWorkflowNodeSnapshot: vi.fn(),
  renewWorkflowNodeLease: vi.fn(),
}))

vi.mock('./task.service', () => ({
  createTask: mocks.createTask,
  getTaskRecord: mocks.getTaskRecord,
  parseTaskControl: mocks.parseTaskControl,
  updateTask: mocks.updateTask,
  updateTaskProgress: mocks.updateTaskProgress,
  updateTaskStatus: mocks.updateTaskStatus,
}))

vi.mock('./workflow-node.service', () => ({
  beginWorkflowNode: mocks.beginWorkflowNode,
  failWorkflowNode: mocks.failWorkflowNode,
  hashWorkflowNodeInput: mocks.hashWorkflowNodeInput,
  recordWorkflowNodeSnapshot: mocks.recordWorkflowNodeSnapshot,
  renewWorkflowNodeLease: mocks.renewWorkflowNodeLease,
}))

import {
  ChapterPipelineRuntime,
  createChapterPipelineRuntimeBindings,
  type CreateChapterPipelineRuntimeInput,
} from './chapter-pipeline-runtime'
import { ChapterPipelineStageError } from './chapter-pipeline-errors'

function createRuntimeInput(
  chapterId: number,
  overrides: Partial<CreateChapterPipelineRuntimeInput> = {},
): CreateChapterPipelineRuntimeInput {
  return {
    chapterId,
    novelId: 7,
    modelConfigId: 9,
    executionMode: 'balanced',
    initialContent: `第${chapterId}章正文`,
    initialContextVersion: 3,
    initialContractVersion: '',
    buildRecoveryHint: (role) => ({
      kind: 'open_page',
      label: `恢复 ${role}`,
      description: '返回写作页处理失败节点。',
      path: `/writing/${chapterId}`,
    }),
    getOutputRefs: () => ({
      chapterId,
      contentHash: `content-${chapterId}`,
      scenePlanHash: `scene-${chapterId}`,
      reviewNotesHash: `review-${chapterId}`,
    }),
    onProgress: vi.fn(),
    ...overrides,
  }
}

function resetRuntimeMocks(): void {
  vi.clearAllMocks()
  let nextTaskId = 100
  let nextNodeId = 500
  mocks.createTask.mockImplementation(async () => nextTaskId++)
  mocks.getTaskRecord.mockImplementation((id: number) => ({
    id,
    controlJson: '{"cancelRequested":false}',
    durationMs: id === 101 ? 120 : 0,
    tokensUsed: id === 101 ? 45 : 0,
  }))
  mocks.parseTaskControl.mockImplementation((task: { controlJson?: string }) => (
    JSON.parse(task.controlJson || '{}')
  ))
  mocks.hashWorkflowNodeInput.mockImplementation((value: unknown) => `hash:${JSON.stringify(value)}`)
  mocks.beginWorkflowNode.mockImplementation(() => ({
    nodeRunId: nextNodeId++,
    leaseToken: 'lease-token',
  }))
  mocks.recordWorkflowNodeSnapshot.mockReturnValue({ id: 'snapshot-500' })
}

describe('chapter pipeline runtime', () => {
  beforeEach(resetRuntimeMocks)

  it('keeps chapter 1 root task, role task, lease, snapshot, and metrics in one runtime', async () => {
    const onWorkflowTaskCreated = vi.fn()
    const onProgress = vi.fn()
    const runtime = await ChapterPipelineRuntime.create(createRuntimeInput(1, {
      stageId: 12,
      resumeDraft: '  已保留正文  ',
      resumeSourceTaskId: 88,
      onWorkflowTaskCreated,
      onProgress,
    }))

    expect(runtime.workflowTaskId).toBe(100)
    expect(onWorkflowTaskCreated).toHaveBeenCalledWith(100)
    expect(mocks.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'chapter_write',
      relatedEntityId: 1,
      pipelineRole: 'planner',
      pipelineStage: 'pending',
      controlJson: JSON.stringify({ cancelRequested: false, stageId: 12, resumeSourceTaskId: 88 }),
    }))
    expect(runtime.snapshot).toMatchObject({
      chapterId: 1,
      workflowTaskId: 100,
      executionMode: 'balanced',
      partialContent: '已保留正文',
      resumeSourceTaskId: 88,
      baseContextVersion: 3,
    })

    const plannerTaskId = await runtime.startRole({
      role: 'planner',
      type: 'chapter_planner',
      detail: '规划第一章',
      inputJson: '[{"role":"user","content":"plan"}]',
    })
    runtime.finishRole('planner', plannerTaskId, '第一章规划完成')

    expect(plannerTaskId).toBe(101)
    expect(mocks.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'chapter_planner',
      parentTaskId: 100,
      upstreamTaskId: undefined,
      retryable: false,
    }))
    expect(mocks.beginWorkflowNode).toHaveBeenCalledWith(expect.objectContaining({
      workflowTaskId: 100,
      chapterId: 1,
      nodeKey: 'planner',
    }))
    expect(mocks.recordWorkflowNodeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      nodeRunId: 500,
      leaseToken: 'lease-token',
      payload: expect.objectContaining({
        workflowTaskId: 100,
        chapterId: 1,
        outputRefs: {
          chapterId: 1,
          contentHash: 'content-1',
          scenePlanHash: 'scene-1',
          reviewNotesHash: 'review-1',
        },
      }),
    }))
    expect(runtime.snapshot.roles.planner).toMatchObject({
      status: 'success',
      taskId: 101,
      nodeRunId: 500,
      nodeSnapshotId: 'snapshot-500',
      durationMs: 120,
      tokensUsed: 45,
    })
    expect(runtime.snapshot).toMatchObject({ totalDurationMs: 120, totalTokensUsed: 45 })
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      chapterId: 1,
      currentRole: 'planner',
      status: 'running',
    }), expect.objectContaining({
      role: 'planner',
      status: 'running',
    }))
  })

  it('keeps chapter 2 retry lineage and blocked failure recoverable without advancing downstream', async () => {
    const runtime = await ChapterPipelineRuntime.create(createRuntimeInput(2, {
      retry: {
        retryNodeRole: 'writer',
        retrySourceNodeRunId: 41,
        retryReason: 'provider timeout',
        retryUpstreamSnapshotId: 'planner-snapshot',
      },
    }))
    runtime.setUpstreamTaskId(77)

    expect(runtime.shouldRun('planner')).toBe(false)
    expect(runtime.shouldRun('writer')).toBe(true)
    const writerTaskId = await runtime.startRole({
      role: 'writer',
      type: 'chapter_writer',
      detail: '续跑第二章 Writer',
      runnerType: 'stream',
    })
    const retriedWriterTaskId = await runtime.startRole({
      role: 'writer',
      type: 'chapter_writer',
      detail: '第二章 Writer 有界重试',
      runnerType: 'stream',
    })
    runtime.failRole({
      role: 'writer',
      taskId: retriedWriterTaskId,
      detail: '合同校验未通过',
      blocked: true,
      aborted: false,
      recoveryHint: {
        kind: 'open_page',
        label: '检查合同',
        description: '修复第二章合同后重试。',
      },
      failureCode: 'contract_blocked',
      rewriteScope: 'contract_replan',
      outputText: 'exit_code: contract_blocked',
      resumeReason: 'failed',
    })

    expect(writerTaskId).toBe(101)
    expect(retriedWriterTaskId).toBe(102)
    expect(mocks.createTask).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'chapter_writer',
      upstreamTaskId: 77,
      runnerType: 'stream',
    }))
    expect(mocks.beginWorkflowNode).toHaveBeenCalledWith(expect.objectContaining({
      retryOfNodeRunId: 41,
      retryReason: 'provider timeout',
      upstreamSnapshotId: 'planner-snapshot',
    }))
    expect(mocks.failWorkflowNode).toHaveBeenNthCalledWith(1, expect.objectContaining({
      nodeRunId: 500,
      status: 'failed',
      errorClass: 'superseded_attempt',
    }))
    expect(mocks.failWorkflowNode).toHaveBeenNthCalledWith(2, expect.objectContaining({
      nodeRunId: 501,
      status: 'blocked',
      errorClass: 'contract_blocked',
    }))
    expect(runtime.snapshot).toMatchObject({
      chapterId: 2,
      currentRole: 'writer',
      status: 'failed',
      lastFailureRole: 'writer',
      failureCode: 'contract_blocked',
      rewriteScope: 'contract_replan',
      resumeReason: 'failed',
    })
    expect(runtime.snapshot.roles.writer).toMatchObject({
      status: 'blocked',
      taskId: 102,
      nodeRunId: 501,
    })
    expect(mocks.updateTask).toHaveBeenCalledWith(102, expect.objectContaining({
      pipelineStage: 'blocked',
      outputText: 'exit_code: contract_blocked',
    }))
  })

  it('preserves a usable chapter 2 draft when a bound downstream role fails', async () => {
    const runtime = await ChapterPipelineRuntime.create(createRuntimeInput(2))
    let snapshot = runtime.snapshot
    let expectedContent = '旧稿'
    let committed = false
    const persistUsableDraft = vi.fn((content: string) => content)
    const updateFailureStatus = vi.fn()
    const bindings = createChapterPipelineRuntimeBindings({
      runtime,
      chapter: { novelId: 7, reviewNotesJson: '' },
      chapterId: 2,
      previousStatus: 'outline',
      getSnapshot: () => snapshot,
      setSnapshot: (next) => { snapshot = next },
      getLatestUsableDraft: () => '第二章可用稿',
      getLatestReviewNotesJson: () => '',
      getHasCommittedContent: () => committed,
      setHasCommittedContent: (value) => { committed = value },
      persistUsableDraft,
      setExpectedContent: (content) => { expectedContent = content },
      updateFailureStatus,
      buildRecoveryHint: () => ({
        kind: 'open_page',
        label: '复核正文',
        description: '处理失败节点。',
      }),
    })
    const taskId = await bindings.startRole('critic', 'chapter_critic', '检查第二章')

    expect(() => bindings.failRole(
      'critic',
      taskId,
      new ChapterPipelineStageError('invalid_output', '审校结构无效'),
    )).toThrow('审校结构无效')
    expect(persistUsableDraft).toHaveBeenCalledWith(
      '第二章可用稿',
      expect.stringContaining('Critic 未完成：审校结构无效'),
    )
    expect(expectedContent).toBe('第二章可用稿')
    expect(committed).toBe(true)
    expect(updateFailureStatus).not.toHaveBeenCalled()
    expect(snapshot.partialContent).toBe('第二章可用稿')
  })
})

describe('chapter pipeline reused roles', () => {
  beforeEach(resetRuntimeMocks)

  it('records a reused chapter 2 role through the runtime binding without opening a new task', async () => {
    const runtime = await ChapterPipelineRuntime.create(createRuntimeInput(2))
    let snapshot = runtime.snapshot
    const bindings = createChapterPipelineRuntimeBindings({
      runtime,
      chapter: { novelId: 7, reviewNotesJson: '' },
      chapterId: 2,
      previousStatus: 'outline',
      getSnapshot: () => snapshot,
      setSnapshot: (next) => { snapshot = next },
      getLatestUsableDraft: () => '',
      getLatestReviewNotesJson: () => '',
      getHasCommittedContent: () => false,
      setHasCommittedContent: vi.fn(),
      persistUsableDraft: vi.fn((content: string) => content),
      setExpectedContent: vi.fn(),
      updateFailureStatus: vi.fn(),
      buildRecoveryHint: () => ({
        kind: 'open_page',
        label: '复核正文',
        description: '处理失败节点。',
      }),
    })

    bindings.reuseRole('critic', {
      taskId: 88,
      detail: '复用不可变 Critic 快照，未重复调用模型。',
      outputText: '已复用 Critic 不可变快照，直接进入指定节点。',
      snapshot: { contractVersion: 'contract-v2' },
      extra: { contractVersion: 'contract-v2' },
    })

    expect(mocks.createTask).toHaveBeenCalledTimes(1)
    expect(snapshot.roles.critic).toMatchObject({
      status: 'success',
      taskId: 88,
      detail: '复用不可变 Critic 快照，未重复调用模型。',
      contractVersion: 'contract-v2',
    })
    expect(snapshot.contractVersion).toBe('contract-v2')
    expect(snapshot.roles.critic.finishedAt).toBeTruthy()
    expect(mocks.updateTask).toHaveBeenCalledWith(runtime.workflowTaskId, expect.objectContaining({
      outputText: '已复用 Critic 不可变快照，直接进入指定节点。',
    }))

    const nextTaskId = await bindings.startRole('enforcer', 'chapter_critic', '继续 Enforcer')
    expect(mocks.createTask).toHaveBeenLastCalledWith(expect.objectContaining({
      upstreamTaskId: 88,
    }))
    expect(nextTaskId).toBe(101)
  })
})
