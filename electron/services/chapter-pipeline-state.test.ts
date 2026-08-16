import { describe, expect, it } from 'vitest'
import {
  applyChapterPipelineRoleMetrics,
  buildChapterPipelineRetryPlan,
  buildChapterPipelineResumeRetryMetadata,
  checkpointChapterPipelineContent,
  checkpointChapterPipelineContext,
  completeChapterPipelineRole,
  createInitialChapterPipelineSnapshot,
  failChapterPipelineRole,
  getChapterPipelineTaskStage,
  inferChapterPipelineResumeReason,
  isChapterPipelineRole,
  parseChapterPipelineSnapshot,
  startChapterPipelineRole,
  validateChapterPipelineResumeBase,
} from './chapter-pipeline-state'

describe('chapter pipeline state', () => {
  it('creates a stable initial snapshot with independent pending role states', () => {
    const snapshot = createInitialChapterPipelineSnapshot(
      12,
      34,
      'contract-v2',
      { content: '正文', contextVersion: 7 },
    )

    expect(snapshot).toMatchObject({
      kind: 'chapter_pipeline',
      chapterId: 12,
      workflowTaskId: 34,
      currentRole: null,
      currentStage: 'planning',
      status: 'pending',
      contractVersion: 'contract-v2',
      baseContextVersion: 7,
      totalTokensUsed: 0,
      totalDurationMs: 0,
    })
    expect(snapshot.baseContentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Object.values(snapshot.roles).map((role) => role.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(snapshot.roles.planner).not.toBe(snapshot.roles.writer)
  })

  it('parses only JSON objects and rejects empty, scalar, array, and malformed snapshots', () => {
    expect(parseChapterPipelineSnapshot('{"kind":"chapter_pipeline","chapterId":1}')).toMatchObject({
      kind: 'chapter_pipeline',
      chapterId: 1,
    })
    expect(parseChapterPipelineSnapshot('')).toBeNull()
    expect(parseChapterPipelineSnapshot('null')).toBeNull()
    expect(parseChapterPipelineSnapshot('1')).toBeNull()
    expect(parseChapterPipelineSnapshot('[]')).toBeNull()
    expect(parseChapterPipelineSnapshot('{')).toBeNull()
  })

  it.each([
    ['planner', []],
    ['writer', ['planner']],
    ['critic', ['planner', 'writer']],
    ['enforcer', ['planner', 'writer', 'critic']],
    ['rewriter', ['planner', 'writer', 'critic', 'enforcer']],
    ['canonizer', ['planner', 'writer', 'critic', 'enforcer', 'rewriter']],
    ['finalize', ['planner', 'writer', 'critic', 'enforcer', 'rewriter', 'canonizer']],
  ] as const)('retries %s while reusing only completed upstream roles', (role, skippedRoles) => {
    const plan = buildChapterPipelineRetryPlan(role)
    const skippedRoleSet = new Set<string>(skippedRoles)

    expect(plan.retryRole).toBe(role)
    expect(plan.skippedRoles).toEqual(skippedRoles)
    expect(plan.shouldRun).toEqual({
      planner: !skippedRoleSet.has('planner'),
      writer: !skippedRoleSet.has('writer'),
      critic: !skippedRoleSet.has('critic'),
      enforcer: !skippedRoleSet.has('enforcer'),
      rewriter: !skippedRoleSet.has('rewriter'),
      canonizer: !skippedRoleSet.has('canonizer'),
      finalize: true,
    })
  })

  it('builds automatic retry metadata from the failed node and its upstream snapshot', () => {
    const snapshot = createInitialChapterPipelineSnapshot(12, 34)
    snapshot.lastFailureRole = 'rewriter'
    snapshot.roles.enforcer.nodeSnapshotId = 'enforcer-snapshot'
    snapshot.roles.rewriter.nodeRunId = 91

    expect(buildChapterPipelineResumeRetryMetadata(snapshot)).toEqual({
      retryNodeRole: 'rewriter',
      retrySourceNodeRunId: 91,
      retryUpstreamSnapshotId: 'enforcer-snapshot',
    })
    expect(buildChapterPipelineResumeRetryMetadata({ ...snapshot, lastFailureRole: undefined })).toBeNull()
  })

  it('recognizes only supported chapter pipeline roles', () => {
    expect(isChapterPipelineRole('planner')).toBe(true)
    expect(isChapterPipelineRole('finalize')).toBe(true)
    expect(isChapterPipelineRole('publisher')).toBe(false)
    expect(isChapterPipelineRole(null)).toBe(false)
  })

  it('derives persisted task stage from the active role before workflow status', () => {
    let snapshot = createInitialChapterPipelineSnapshot(1, 2)
    expect(getChapterPipelineTaskStage(snapshot)).toBe('pending')

    snapshot = startChapterPipelineRole(snapshot, {
      role: 'writer',
      taskId: 3,
      detail: 'writing',
      startedAt: '2026-08-09T00:00:00.000Z',
    })
    expect(getChapterPipelineTaskStage(snapshot)).toBe('running')

    snapshot = failChapterPipelineRole(snapshot, {
      role: 'writer',
      taskId: 3,
      detail: 'blocked',
      blocked: true,
      aborted: false,
      finishedAt: '2026-08-09T00:00:01.000Z',
      resumeReason: 'failed',
    })
    expect(getChapterPipelineTaskStage(snapshot)).toBe('blocked')
  })

  it('transitions a role through running and success without mutating the prior snapshot', () => {
    const initial = createInitialChapterPipelineSnapshot(1, 2, 'v1')
    const running = startChapterPipelineRole(initial, {
      role: 'rewriter',
      taskId: 9,
      upstreamTaskId: 8,
      contractVersion: 'v1',
      nodeRunId: 10,
      detail: 'rewriting',
      startedAt: '2026-08-09T00:00:00.000Z',
    })
    const completed = completeChapterPipelineRole(running, {
      role: 'rewriter',
      taskId: 9,
      detail: 'done',
      nodeRunId: 10,
      nodeSnapshotId: 'snapshot-10',
      finishedAt: '2026-08-09T00:00:02.000Z',
    })

    expect(initial.roles.rewriter.status).toBe('pending')
    expect(running).toMatchObject({
      currentRole: 'rewriter',
      currentStage: 'rewriting',
      status: 'running',
      streamTaskId: 9,
    })
    expect(completed).toMatchObject({
      currentRole: 'rewriter',
      status: 'running',
      streamTaskId: undefined,
      message: 'done',
    })
    expect(completed.roles.rewriter).toMatchObject({
      status: 'success',
      detail: 'done',
      taskId: 9,
      nodeRunId: 10,
      nodeSnapshotId: 'snapshot-10',
    })
  })

  it('advances the recovery hash only when complete content is persisted', () => {
    const initial = createInitialChapterPipelineSnapshot(
      1,
      2,
      undefined,
      { content: 'author baseline', contextVersion: 1 },
    )
    const checkpoint = checkpointChapterPipelineContent(initial, {
      persistedContent: 'complete draft',
      resumableContent: 'complete draft',
      resumeSourceTaskId: 9,
    })

    expect(checkpoint.baseContentHash).not.toBe(initial.baseContentHash)
    expect(checkpoint.baseContentHash).toBe(
      createInitialChapterPipelineSnapshot(
        1,
        2,
        undefined,
        { content: 'complete draft', contextVersion: 1 },
      ).baseContentHash,
    )
    expect(checkpoint.partialContent).toBe('complete draft')
    expect(checkpoint.resumeSourceTaskId).toBe(9)
    expect(initial.partialContent).toBeUndefined()
  })

  it('distinguishes a valid rolling checkpoint from author and context conflicts', () => {
    const initial = createInitialChapterPipelineSnapshot(
      1,
      2,
      undefined,
      { content: 'author baseline', contextVersion: 3 },
    )
    const checkpoint = checkpointChapterPipelineContent(initial, {
      persistedContent: 'pipeline draft',
    })

    expect(validateChapterPipelineResumeBase(checkpoint, {
      content: 'pipeline draft',
      contextVersion: 3,
    })).toBe('ready')
    expect(validateChapterPipelineResumeBase(checkpoint, {
      content: 'author edited draft',
      contextVersion: 3,
    })).toBe('content_conflict')
    expect(validateChapterPipelineResumeBase(checkpoint, {
      content: 'pipeline draft',
      contextVersion: 4,
    })).toBe('context_conflict')
    expect(validateChapterPipelineResumeBase(null, {
      content: 'pipeline draft',
      contextVersion: 3,
    })).toBe('unsupported')
  })

  it('advances the context checkpoint only with a valid committed version', () => {
    const initial = createInitialChapterPipelineSnapshot(
      1,
      2,
      undefined,
      { content: 'draft', contextVersion: 3 },
    )
    const advanced = checkpointChapterPipelineContext(initial, 4)

    expect(advanced.baseContextVersion).toBe(4)
    expect(validateChapterPipelineResumeBase(advanced, {
      content: 'draft',
      contextVersion: 4,
    })).toBe('ready')
    expect(checkpointChapterPipelineContext(advanced, 0)).toBe(advanced)
    expect(initial.baseContextVersion).toBe(3)
  })

  it('records blocked and cancelled failures without losing the reusable task lineage', () => {
    const running = startChapterPipelineRole(createInitialChapterPipelineSnapshot(1, 2), {
      role: 'canonizer',
      taskId: 7,
      detail: 'canonizing',
      startedAt: '2026-08-09T00:00:00.000Z',
    })
    const failed = failChapterPipelineRole(running, {
      role: 'canonizer',
      taskId: 7,
      detail: 'cancelled',
      blocked: true,
      aborted: true,
      finishedAt: '2026-08-09T00:00:01.000Z',
      failureCode: 'canon_pending',
      resumeReason: 'cancelled',
      resumeSourceTaskId: 7,
    })

    expect(failed).toMatchObject({
      currentRole: 'canonizer',
      currentStage: 'canonizing',
      status: 'cancelled',
      lastFailureRole: 'canonizer',
      failureCode: 'canon_pending',
      resumeReason: 'cancelled',
      resumeSourceTaskId: 7,
    })
    expect(failed.roles.canonizer).toMatchObject({
      status: 'blocked',
      taskId: 7,
      failureCode: 'canon_pending',
    })
  })

  it('recomputes aggregate metrics and ignores missing or non-positive task metrics', () => {
    const initial = createInitialChapterPipelineSnapshot(1, 2)
    const writer = applyChapterPipelineRoleMetrics(initial, 'writer', {
      taskId: 3,
      durationMs: 120,
      tokensUsed: 45,
    })
    const critic = applyChapterPipelineRoleMetrics(writer, 'critic', {
      taskId: 4,
      durationMs: 80,
      tokensUsed: 0,
    })

    expect(critic.roles.writer).toMatchObject({ taskId: 3, durationMs: 120, tokensUsed: 45 })
    expect(critic.roles.critic).toMatchObject({ taskId: 4, durationMs: 80 })
    expect(critic.totalDurationMs).toBe(200)
    expect(critic.totalTokensUsed).toBe(45)
  })

  it.each([
    [new Error('request cancelled'), 'cancelled'],
    [new Error('request timeout'), 'timeout'],
    [new Error('socket ECONNRESET'), 'network'],
    [new Error('provider rejected output'), 'failed'],
    ['unknown', 'failed'],
  ] as const)('classifies resume reason for %s', (error, expected) => {
    expect(inferChapterPipelineResumeReason(error)).toBe(expected)
  })
})
