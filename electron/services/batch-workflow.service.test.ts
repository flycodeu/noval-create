import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockTask = {
  id: number
  novelId?: number | null
  type?: string | null
  runnerType?: string | null
  status?: string | null
  inputJson?: string | null
  controlJson?: string | null
  progressJson?: string | null
  errorMessage?: string | null
  outputText?: string | null
  relatedEntityId?: number | null
  currentChildTaskId?: number | null
}

type ChapterRow = {
  id: number
  novelId: number
  chapterNum: number
  title?: string | null
}

type ChapterScenario = {
  status: 'success' | 'failed' | 'cancelled' | 'paused'
  recallDegraded?: boolean
  errorMessage?: string
  outputText?: string
  failureCode?: string
  lastFailureRole?: string
}

type PublishCheck = {
  gateLevel: 'pass' | 'warning' | 'blocker' | 'rewrite'
  ready: boolean
  summary: string
}

const taskRows = new Map<number, MockTask>()
const chapterRows = new Map<number, ChapterRow>()
const chapterScenarios = new Map<number, ChapterScenario[]>()
const publishChecks = new Map<number, PublishCheck[]>()
let nextTaskId = 1000

function getProgress(taskId: number) {
  const task = taskRows.get(taskId)
  return task?.progressJson ? JSON.parse(task.progressJson) as Record<string, unknown> : {}
}

function setScenario(chapterId: number, ...scenarios: ChapterScenario[]) {
  chapterScenarios.set(chapterId, scenarios.map((item) => ({ ...item })))
}

function setPublishChecks(chapterId: number, ...checks: PublishCheck[]) {
  publishChecks.set(chapterId, checks.map((item) => ({ ...item })))
}

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

vi.mock('./character.service', () => ({
  generateCharacterBatchChunk: vi.fn(),
}))

vi.mock('./faction.service', () => ({
  generateFactionBatchChunk: vi.fn(),
}))

vi.mock('./core-settings.service', () => ({
  loadSubplotAutoGenerateContext: vi.fn(),
  polishGeneratedSubplots: vi.fn(),
  tryGenerateSubplotBatch: vi.fn(),
}))

vi.mock('./item.service', () => ({
  generateStoryItemsBatchChunk: vi.fn(),
}))

vi.mock('./story-thread.service', () => ({
  generateStoryThreadBatchChunk: vi.fn(),
}))

vi.mock('./timeline.service', () => ({
  generateTimelineBatchChunk: vi.fn(),
}))

vi.mock('./context-impact.service', () => ({
  runChapterPublishCheck: vi.fn((chapterId: number) => {
    const queue = publishChecks.get(chapterId) || []
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return next || {
      gateLevel: 'pass',
      ready: true,
      summary: '通过',
    }
  }),
}))

vi.mock('./chapter.service', () => ({
  getChapter: vi.fn((chapterId: number) => chapterRows.get(chapterId) || null),
  generateChapterContent: vi.fn(async (chapterId: number) => {
    const scenarioQueue = chapterScenarios.get(chapterId) || []
    const scenario = scenarioQueue.length > 1 ? scenarioQueue.shift() : scenarioQueue[0]
    if (!scenario) {
      throw new Error(`missing scenario for chapter ${chapterId}`)
    }
    const childTaskId = nextTaskId++
    taskRows.set(childTaskId, {
      id: childTaskId,
      novelId: chapterRows.get(chapterId)?.novelId || 1,
      type: 'chapter_write',
      runnerType: 'workflow',
      status: scenario.status,
      relatedEntityId: chapterId,
      errorMessage: scenario.errorMessage || null,
      outputText: scenario.outputText || null,
      progressJson: JSON.stringify({
        kind: 'chapter_pipeline',
        recallSnapshot: {
          degraded: scenario.recallDegraded === true,
        },
        failureCode: scenario.failureCode,
        lastFailureRole: scenario.lastFailureRole,
      }),
    })
    return childTaskId
  }),
}))

vi.mock('./task.service', () => ({
  createTask: vi.fn(async (opts: Record<string, unknown>) => {
    const taskId = nextTaskId++
    taskRows.set(taskId, {
      id: taskId,
      ...opts,
      status: (opts.status as string | undefined) || 'pending',
      controlJson: typeof opts.controlJson === 'string' ? opts.controlJson : JSON.stringify({}),
      progressJson: typeof opts.progressJson === 'string' ? opts.progressJson : JSON.stringify({}),
    })
    return taskId
  }),
  getTaskRecord: vi.fn((taskId: number) => taskRows.get(taskId) || null),
  parseTaskControl: vi.fn((task?: MockTask | null) => {
    if (!task?.controlJson) return {}
    return JSON.parse(task.controlJson) as Record<string, unknown>
  }),
  parseTaskProgress: vi.fn((task?: MockTask | null) => {
    if (!task?.progressJson) return {}
    return JSON.parse(task.progressJson) as Record<string, unknown>
  }),
  updateTask: vi.fn((taskId: number, patch: Record<string, unknown>) => {
    const task = taskRows.get(taskId)
    if (!task) return
    Object.assign(task, patch)
  }),
  updateTaskControl: vi.fn((taskId: number, control: Record<string, unknown>) => {
    const task = taskRows.get(taskId)
    if (!task) return
    task.controlJson = JSON.stringify(control)
  }),
  updateTaskProgress: vi.fn((taskId: number, progress: Record<string, unknown>) => {
    const task = taskRows.get(taskId)
    if (!task) return
    task.progressJson = JSON.stringify(progress)
  }),
  updateTaskStatus: vi.fn((taskId: number, status: string, _sender?: unknown, extra: Record<string, unknown> = {}) => {
    const task = taskRows.get(taskId)
    if (!task) return
    task.status = status
    Object.assign(task, extra)
  }),
}))

import { __testing } from './batch-workflow.service'

function createBatchTask(taskId: number, chapterIds: number[], progressPatch: Record<string, unknown> = {}) {
  const initial = __testing.createInitialChapterBatchStatus(taskId, 1, { chapterIds })
  const progress = {
    ...initial,
    taskId,
    ...progressPatch,
  }
  taskRows.set(taskId, {
    id: taskId,
    novelId: 1,
    type: 'chapter_batch_generate',
    runnerType: 'workflow',
    status: 'pending',
    inputJson: JSON.stringify({ chapterIds }),
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: 2, retryCount: 0 }),
    progressJson: JSON.stringify(progress),
    errorMessage: null,
    outputText: null,
  })
}

describe('chapter batch workflow', () => {
  beforeEach(() => {
    taskRows.clear()
    chapterRows.clear()
    chapterScenarios.clear()
    publishChecks.clear()
    nextTaskId = 1000
  })

  it('completes chapters sequentially', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 1, title: '第一章' })
    chapterRows.set(102, { id: 102, novelId: 1, chapterNum: 2, title: '第二章' })
    setScenario(101, { status: 'success' })
    setScenario(102, { status: 'success' })
    setPublishChecks(101, { gateLevel: 'pass', ready: true, summary: '通过' })
    setPublishChecks(102, { gateLevel: 'pass', ready: true, summary: '通过' })
    createBatchTask(1, [101, 102])

    await __testing.runChapterBatchGenerateWorkflow(1)

    expect(taskRows.get(1)?.status).toBe('success')
    expect(getProgress(1)).toMatchObject({
      resumeCursor: 2,
      generatedCount: 2,
      completedChapterIds: [101, 102],
      completed: true,
    })
  })

  it('pauses when a chapter workflow fails', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 1, title: '第一章' })
    setScenario(101, {
      status: 'failed',
      errorMessage: '合同缺失',
      failureCode: 'contract_blocked',
      lastFailureRole: 'planner',
    })
    createBatchTask(2, [101])

    await __testing.runChapterBatchGenerateWorkflow(2)

    expect(taskRows.get(2)?.status).toBe('paused')
    expect(getProgress(2)).toMatchObject({
      blockedChapterId: 101,
      failedChapterIds: [101],
    })
    expect(taskRows.get(2)?.errorMessage).toBe('合同缺失')
  })

  it('pauses when publish check returns blocker after a successful chapter', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 7, title: '第七章' })
    setScenario(101, { status: 'success' })
    setPublishChecks(101, {
      gateLevel: 'blocker',
      ready: false,
      summary: '上下文已过期，需先修复',
    })
    createBatchTask(3, [101])

    await __testing.runChapterBatchGenerateWorkflow(3)

    expect(taskRows.get(3)?.status).toBe('paused')
    expect(getProgress(3)).toMatchObject({
      blockedChapterId: 101,
      failedChapterIds: [101],
    })
    expect(taskRows.get(3)?.errorMessage).toBe('上下文已过期，需先修复')
  })

  it('pauses after three consecutive degraded recall chapters', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 1 })
    chapterRows.set(102, { id: 102, novelId: 1, chapterNum: 2 })
    chapterRows.set(103, { id: 103, novelId: 1, chapterNum: 3 })
    setScenario(101, { status: 'success', recallDegraded: true })
    setScenario(102, { status: 'success', recallDegraded: true })
    setScenario(103, { status: 'success', recallDegraded: true })
    setPublishChecks(101, { gateLevel: 'pass', ready: true, summary: '通过' })
    setPublishChecks(102, { gateLevel: 'pass', ready: true, summary: '通过' })
    setPublishChecks(103, { gateLevel: 'pass', ready: true, summary: '通过' })
    createBatchTask(4, [101, 102, 103])

    await __testing.runChapterBatchGenerateWorkflow(4)

    expect(taskRows.get(4)?.status).toBe('paused')
    expect(getProgress(4)).toMatchObject({
      blockedChapterId: 103,
      completedChapterIds: [101, 102],
      consecutiveRecallFallbackChapters: 3,
    })
  })

  it('continues from resumeCursor without rerunning completed chapters', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 1 })
    chapterRows.set(102, { id: 102, novelId: 1, chapterNum: 2 })
    chapterRows.set(103, { id: 103, novelId: 1, chapterNum: 3 })
    setScenario(102, { status: 'success' })
    setScenario(103, { status: 'success' })
    setPublishChecks(102, { gateLevel: 'pass', ready: true, summary: '通过' })
    setPublishChecks(103, { gateLevel: 'pass', ready: true, summary: '通过' })
    createBatchTask(5, [101, 102, 103], {
      status: 'paused',
      resumeCursor: 1,
      generatedCount: 1,
      completedChapterIds: [101],
      message: '准备继续执行。',
    })
    const task = taskRows.get(5)
    if (task) task.status = 'paused'

    await __testing.runChapterBatchGenerateWorkflow(5)

    expect(taskRows.get(5)?.status).toBe('success')
    expect(getProgress(5)).toMatchObject({
      resumeCursor: 3,
      generatedCount: 3,
      completedChapterIds: [101, 102, 103],
    })
  })
})
