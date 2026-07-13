import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../database/db'
import { characters, factions, genres, novels, worldMap } from '../database/schema'

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
  writebackStatusJson?: string | null
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
  generatedTaskCount?: number
}

const taskRows = new Map<number, MockTask>()
const chapterRows = new Map<number, ChapterRow>()
const chapterScenarios = new Map<number, ChapterScenario[]>()
const publishChecks = new Map<number, PublishCheck[]>()
const aiCheckFailures = new Map<number, string>()
const inspectionRows: Array<Record<string, unknown>> = []
const feedbackPauseSignals = new Map<number, {
  issueType: string
  title: string
  detail: string
  chapterNums: number[]
}>()
let nextTaskId = 1000

function createDbMock() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const query: {
          where: () => typeof query
          orderBy: () => typeof query
          all: () => Array<Record<string, unknown>>
          get: () => Record<string, unknown>
        } = {
          where: () => query,
          orderBy: () => query,
          all: () => [],
          get: () => ({
            id: 1,
            launchMode: 'professional_longform',
            targetWords: 200000,
            settingsJson: null,
          }),
        }
        return query
      }),
    })),
  }
}

function createTableAwareDbMock(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const query = {
          where: () => query,
          orderBy: () => query,
          all: () => rowsByTable.get(table) || [],
          get: () => (rowsByTable.get(table) || [])[0] || null,
        }
        return query
      }),
    })),
  }
}

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
      generatedTaskCount: 0,
    }
  }),
}))

vi.mock('./feedback-recurrence.service', () => ({
  getFeedbackRecurrenceBatchPauseSignal: vi.fn((_novelId: number, chapterNum: number) => feedbackPauseSignals.get(chapterNum) || null),
}))

vi.mock('./chapter.service', () => ({
  getChapter: vi.fn((chapterId: number) => chapterRows.get(chapterId) || null),
  aiCheckChapter: vi.fn(async (chapterId: number) => {
    const failure = aiCheckFailures.get(chapterId)
    if (failure) throw new Error(failure)
    return { ok: true }
  }),
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

vi.mock('./batch-workbench.service', () => ({
  createChapterBatchSnapshot: vi.fn((_novelId: number, workflowTaskId: number, chapterIds: number[]) => ({
    id: 7000 + workflowTaskId,
    novelId: 1,
    workflowTaskId,
    title: '测试批次',
    status: 'active',
    chapterIds,
    chapterNums: chapterIds.map((id) => chapterRows.get(id)?.chapterNum || id),
    summary: '测试批次',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  })),
  markChapterBatchSnapshotCompleted: vi.fn(),
  createBatchInspection: vi.fn((snapshotId: number, data: Record<string, unknown>) => {
    const row = {
      id: inspectionRows.length + 1,
      snapshotId,
      ...data,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }
    inspectionRows.push(row)
    return row
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

import { __testing, startFactionAutoGenerateWorkflow } from './batch-workflow.service'
import { generateCharacterBatchChunk } from './character.service'
import {
  loadSubplotAutoGenerateContext,
  polishGeneratedSubplots,
  tryGenerateSubplotBatch,
} from './core-settings.service'
import { generateStoryItemsBatchChunk } from './item.service'

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

function createQualityAnalysisTask(taskId: number, chapterIds: number[], progressPatch: Record<string, unknown> = {}) {
  const initial = __testing.createInitialChapterQualityAnalysisStatus(taskId, 1, { chapterIds })
  const progress = {
    ...initial,
    taskId,
    snapshotId: 7000 + taskId,
    ...progressPatch,
  }
  taskRows.set(taskId, {
    id: taskId,
    novelId: 1,
    type: 'chapter_quality_analysis',
    runnerType: 'workflow',
    status: 'pending',
    inputJson: JSON.stringify({ chapterIds, includeAiCheck: true, includePublishCheck: true }),
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: 2, retryCount: 0 }),
    progressJson: JSON.stringify(progress),
    errorMessage: null,
    outputText: null,
  })
}

describe('chapter batch workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskRows.clear()
    chapterRows.clear()
    chapterScenarios.clear()
    publishChecks.clear()
    aiCheckFailures.clear()
    inspectionRows.length = 0
    feedbackPauseSignals.clear()
    nextTaskId = 1000
    vi.mocked(getDb).mockReturnValue(createDbMock() as never)
  })

  it('pauses a pending task instead of waiting forever when the child timeout expires', async () => {
    taskRows.set(88, {
      id: 88,
      novelId: 1,
      type: 'chapter_generate',
      runnerType: 'workflow',
      status: 'running',
      progressJson: JSON.stringify({ status: 'running', currentBatch: 1 }),
      controlJson: JSON.stringify({ cancelRequested: false }),
    })

    const task = await __testing.waitForWorkflowTask(88, 20)

    expect(task.status).toBe('paused')
    expect(task.errorMessage).toContain('超时')
    expect(getProgress(88)).toMatchObject({
      status: 'paused',
      lastError: expect.stringContaining('超时'),
    })
  })

  it('coalesces concurrent starts for the same novel and workflow type', async () => {
    const [firstTaskId, secondTaskId] = await Promise.all([
      startFactionAutoGenerateWorkflow(1, { count: 1, batchSize: 1 } as never),
      startFactionAutoGenerateWorkflow(1, { count: 1, batchSize: 1 } as never),
    ])

    expect(firstTaskId).toBe(secondTaskId)
    expect([...taskRows.values()].filter((task) => task.type === 'faction_auto_generate')).toHaveLength(1)
  })

  it('keeps large entity workflow limits aligned with parsed options', () => {
    const faction = __testing.resolveFactionWorkflowOptions(1, JSON.stringify({ count: 180, batchSize: 8 }))
    const factionInitial = __testing.createInitialFactionStatus(96, 1, faction)
    const item = __testing.parseItemOptions(JSON.stringify({ count: 200, batchSize: 12 }))
    const itemInitial = __testing.createInitialEntityStatus(97, 1, item.count || 0, item.batchSize || 0)
    const timeline = __testing.parseTimelineOptions(JSON.stringify({ count: 240, batchSize: 12 }))
    const timelineInitial = __testing.createInitialEntityStatus(98, 1, timeline.count || 0, timeline.batchSize || 0)
    const parsed = __testing.parseThreadOptions(JSON.stringify({ count: 160, batchSize: 12 }))
    const initial = __testing.createInitialThreadStatus(99, 1, parsed)
    const subplot = __testing.parseSubplotRequest(JSON.stringify({ novelId: 1, subplotCount: 40 }))
    const subplotInitial = __testing.createInitialSubplotStatus(100, subplot)

    expect(faction).toMatchObject({ count: 180, batchSize: 8 })
    expect(factionInitial).toMatchObject({
      requestedCount: 180,
      batchSize: 8,
      totalBatches: 23,
      completed: false,
    })
    expect(item).toMatchObject({ count: 200, batchSize: 12 })
    expect(itemInitial).toMatchObject({
      requestedCount: 200,
      batchSize: 12,
      totalBatches: 17,
      completed: false,
    })
    expect(timeline).toMatchObject({ count: 200, batchSize: 12 })
    expect(timelineInitial).toMatchObject({
      requestedCount: 200,
      batchSize: 12,
      totalBatches: 17,
      completed: false,
    })
    expect(parsed).toMatchObject({ count: 160, batchSize: 12 })
    expect(initial).toMatchObject({
      requestedCount: 160,
      batchSize: 12,
      totalBatches: 14,
      completed: false,
    })
    expect(subplot).toMatchObject({ novelId: 1, subplotCount: 40 })
    expect(subplotInitial).toMatchObject({
      requestedCount: 40,
      batchSize: 3,
      totalBatches: 14,
      completed: false,
    })
  })

  it('uses novel complexity to resolve backend workflow defaults when count is omitted', () => {
    vi.mocked(getDb).mockReturnValue(createTableAwareDbMock(new Map<unknown, unknown[]>([
      [novels, [{
        id: 1,
        title: '复杂百万字工程',
        genreId: 11,
        launchMode: 'professional_longform',
        targetWords: 1600000,
        settingsJson: null,
        worldRulesJson: JSON.stringify({
          mapBlueprint: {
            levels: Array.from({ length: 6 }, (_, index) => ({
              depth: index + 1,
              label: `层级${index + 1}`,
              suggestedCount: 8,
              nodeTypes: ['地点'],
            })),
          },
          factionSystem: Array.from({ length: 12 }, (_, index) => ({ name: `势力${index + 1}` })),
          speciesSystem: Array.from({ length: 8 }, (_, index) => ({ name: `种族${index + 1}`, entityType: 'human' })),
          powerSystems: Array.from({ length: 5 }, (_, index) => ({ name: `体系${index + 1}` })),
        }),
      }]],
      [genres, [{ id: 11, name: '科幻' }]],
      [worldMap, Array.from({ length: 6 }, (_, index) => ({ id: index + 1, novelId: 1, level: index + 1 }))],
      [characters, Array.from({ length: 8 }, (_, index) => ({ id: index + 1, novelId: 1, species: `种族${index + 1}` }))],
      [factions, Array.from({ length: 12 }, (_, index) => ({ id: index + 1, novelId: 1, name: `势力${index + 1}` }))],
    ])) as never)

    const faction = __testing.resolveFactionWorkflowOptions(1, JSON.stringify({}))
    const item = __testing.resolveItemWorkflowOptions(1, JSON.stringify({}))
    const timeline = __testing.resolveTimelineWorkflowOptions(1, JSON.stringify({}))
    const thread = __testing.resolveThreadWorkflowOptions(1, JSON.stringify({}))

    expect(faction.count).toBeGreaterThan(48)
    expect(faction.batchSize).toBeGreaterThanOrEqual(4)
    expect(item.count).toBeGreaterThan(48)
    expect(timeline.count).toBeGreaterThan(10)
    expect(thread.count).toBeGreaterThan(8)
    expect(__testing.resolveItemWorkflowOptions(1, JSON.stringify({ count: 7 })).count).toBe(7)
  })

  it('pauses entity generation instead of succeeding when batches cannot reach the requested count', async () => {
    vi.mocked(generateStoryItemsBatchChunk).mockResolvedValue({
      ids: [],
      warning: '没有生成可用物品',
      batchDigest: '',
    })
    const inputJson = JSON.stringify({ count: 3, batchSize: 2 })
    const options = __testing.parseItemOptions(inputJson)
    taskRows.set(77, {
      id: 77,
      novelId: 1,
      type: 'item_auto_generate',
      runnerType: 'workflow',
      status: 'pending',
      inputJson,
      controlJson: JSON.stringify({ cancelRequested: false, maxRetries: 2, retryCount: 0 }),
      progressJson: JSON.stringify(__testing.createInitialEntityStatus(77, 1, options.count || 3, options.batchSize || 2)),
      errorMessage: null,
      outputText: null,
    })

    await __testing.runSimpleEntityWorkflow(77, undefined, 'item')

    expect(taskRows.get(77)?.status).toBe('paused')
    expect(getProgress(77)).toMatchObject({
      requestedCount: 3,
      generatedCount: 0,
      completed: false,
    })
    expect(String(getProgress(77).lastError)).toContain('0/3')
    expect(generateStoryItemsBatchChunk).toHaveBeenCalledTimes(6)
  })

  it('chunks character generation by batch size and only completes after requested characters exist', async () => {
    vi.mocked(generateCharacterBatchChunk)
      .mockResolvedValueOnce({
        ids: [11, 12],
        majorGenerated: 0,
        minorGenerated: 2,
        antagonistGenerated: 0,
        supportingGenerated: 0,
        batchDigest: '角色11、角色12',
      })
      .mockResolvedValueOnce({
        ids: [13],
        majorGenerated: 0,
        minorGenerated: 1,
        antagonistGenerated: 0,
        supportingGenerated: 0,
        batchDigest: '角色13',
      })
    const inputJson = JSON.stringify({
      majorCount: 0,
      minorCount: 3,
      antagonistCount: 0,
      supportingCount: 0,
      batchSize: 2,
    })
    const options = {
      majorCount: 0,
      minorCount: 3,
      antagonistCount: 0,
      supportingCount: 0,
      batchSize: 2,
    }
    taskRows.set(78, {
      id: 78,
      novelId: 1,
      type: 'character_auto_generate',
      runnerType: 'workflow',
      status: 'pending',
      inputJson,
      controlJson: JSON.stringify({ cancelRequested: false, maxRetries: 2, retryCount: 0 }),
      progressJson: JSON.stringify(__testing.createInitialCharacterStatus(78, 1, options)),
      errorMessage: null,
      outputText: null,
    })

    await __testing.runCharacterAutoGenerateWorkflow(78)

    expect(taskRows.get(78)?.status).toBe('success')
    expect(getProgress(78)).toMatchObject({
      requestedCount: 3,
      batchSize: 2,
      totalBatches: 2,
      generatedCount: 3,
      completed: true,
    })
    expect(generateCharacterBatchChunk).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generateCharacterBatchChunk).mock.calls[0][1]).toMatchObject({ minorCount: 2, batchSize: 2 })
    expect(vi.mocked(generateCharacterBatchChunk).mock.calls[1][1]).toMatchObject({ minorCount: 1, batchSize: 1 })
  })

  it('pauses subplot generation when max attempts still do not satisfy the requested count', async () => {
    const accepted = {
      name: '支线A',
      characters: '角色A',
      conflict: '资源争夺',
      mainlineLink: '推动主线',
      endChapter: '第20章',
    }
    vi.mocked(loadSubplotAutoGenerateContext).mockResolvedValue({ novelId: 1 } as never)
    vi.mocked(polishGeneratedSubplots).mockImplementation((async (
      _context: unknown,
      _storyGoal: string,
      _coreConflict: string,
      _mainPlot: string,
      subplots: Array<typeof accepted>,
    ) => ({
      subplots,
      status: 'success',
    })) as never)
    let callCount = 0
    vi.mocked(tryGenerateSubplotBatch).mockImplementation((async () => {
      callCount += 1
      return {
        batchResult: {
          accepted: callCount === 1 ? [accepted] : [],
          warningMessage: callCount === 1 ? '' : '无新增支线',
        },
        warning: callCount === 1 ? '' : '无新增支线',
      }
    }) as never)
    const request = __testing.parseSubplotRequest(JSON.stringify({
      novelId: 1,
      subplotCount: 4,
      storyGoal: '建立多线压力',
      coreConflict: '资源冲突',
      mainPlot: '主线推进',
    }))
    taskRows.set(79, {
      id: 79,
      novelId: 1,
      type: 'subplot_auto_generate',
      runnerType: 'workflow',
      status: 'pending',
      inputJson: JSON.stringify(request),
      controlJson: JSON.stringify({ cancelRequested: false, maxRetries: 2, retryCount: 0 }),
      progressJson: JSON.stringify(__testing.createInitialSubplotStatus(79, request)),
      errorMessage: null,
      outputText: null,
    })

    await __testing.runSubplotAutoGenerateWorkflow(79)

    expect(taskRows.get(79)?.status).toBe('paused')
    expect(getProgress(79)).toMatchObject({
      requestedCount: 4,
      generatedCount: 1,
      completed: false,
    })
    expect(String(getProgress(79).lastError)).toContain('1/4')
    expect(tryGenerateSubplotBatch).toHaveBeenCalledTimes(8)
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

  it('pauses when the chapter is waiting for writeback confirmation', async () => {
    chapterRows.set(101, {
      id: 101,
      novelId: 1,
      chapterNum: 8,
      title: '第八章',
      writebackStatusJson: JSON.stringify({
        phase: 'ready',
        readyForNextChapter: false,
        blockedGeneration: true,
        lastError: 'Canon 草案尚未确认。',
      }),
    })
    setScenario(101, { status: 'success' })
    setPublishChecks(101, { gateLevel: 'pass', ready: true, summary: '通过' })
    createBatchTask(7, [101])

    await __testing.runChapterBatchGenerateWorkflow(7)

    expect(taskRows.get(7)?.status).toBe('paused')
    expect(taskRows.get(7)?.errorMessage).toBe('Canon 草案尚未确认。')
    expect(getProgress(7)).toMatchObject({
      blockedChapterId: 101,
      currentWritebackStatus: {
        phase: 'ready',
        readyForNextChapter: false,
      },
    })
    expect((getProgress(7).pauseReason as string)).toContain('等待章后回写完成')
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

  it('pauses when generic feedback recurrence reaches a blocking threshold', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 9, title: '第九章' })
    setScenario(101, { status: 'success' })
    setPublishChecks(101, { gateLevel: 'pass', ready: true, summary: '通过' })
    feedbackPauseSignals.set(9, {
      issueType: 'forced_reversal',
      title: '强行反转',
      detail: '强行反转在 5 章窗口内已至少出现 3 次，建议暂停批量生成并回查第5章、第7章、第9章。',
      chapterNums: [5, 7, 9],
    })
    createBatchTask(6, [101])

    await __testing.runChapterBatchGenerateWorkflow(6)

    expect(taskRows.get(6)?.status).toBe('paused')
    expect(getProgress(6)).toMatchObject({
      blockedChapterId: 101,
      failedChapterIds: [101],
    })
    expect(taskRows.get(6)?.errorMessage).toContain('强行反转')
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

  it('runs chapter quality analysis as a resumable queue without mutating chapter content', async () => {
    chapterRows.set(101, { id: 101, novelId: 1, chapterNum: 1, title: '第一章' })
    chapterRows.set(102, { id: 102, novelId: 1, chapterNum: 2, title: '第二章' })
    chapterRows.set(103, { id: 103, novelId: 1, chapterNum: 3, title: '第三章' })
    aiCheckFailures.set(102, '模型超时')
    setPublishChecks(101, { gateLevel: 'pass', ready: true, summary: '通过' })
    setPublishChecks(102, { gateLevel: 'pass', ready: true, summary: '通过' })
    setPublishChecks(103, { gateLevel: 'rewrite', ready: false, summary: '需要重写章尾钩子', generatedTaskCount: 2 })
    createQualityAnalysisTask(8, [101, 102, 103])

    await __testing.runChapterQualityAnalysisWorkflow(8)

    expect(taskRows.get(8)?.status).toBe('success')
    expect(getProgress(8)).toMatchObject({
      resumeCursor: 3,
      generatedCount: 3,
      completedChapterIds: [101, 103],
      failedChapterIds: [102],
      aiCheckFailureCount: 1,
      publishRewriteChapterIds: [103],
      generatedRevisionTaskCount: 2,
      completed: true,
    })
    expect(inspectionRows.some((row) => row.chapterId === 102 && row.status === 'blocked')).toBe(true)
    expect(inspectionRows.some((row) => row.chapterId === 103 && row.status === 'blocked')).toBe(true)
  })

  it('finishes chapter quality analysis cleanly when there are no chapters to inspect', async () => {
    createQualityAnalysisTask(9, [])

    await __testing.runChapterQualityAnalysisWorkflow(9)

    expect(taskRows.get(9)?.status).toBe('success')
    expect(getProgress(9)).toMatchObject({
      requestedCount: 0,
      resumeCursor: 0,
      generatedCount: 0,
      completedChapterIds: [],
      failedChapterIds: [],
      completed: true,
    })
  })
})
