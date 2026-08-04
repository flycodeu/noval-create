import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runChatTask: vi.fn(),
  createCreativeStageHandoff: vi.fn(),
  listCreativeStageHandoffs: vi.fn(),
  findArtifactByIdempotency: vi.fn(),
}))

vi.mock('./task.service', () => ({ runChatTask: mocks.runChatTask }))
vi.mock('./creative-stage.service', () => ({
  createCreativeStageHandoff: mocks.createCreativeStageHandoff,
  listCreativeStageHandoffs: mocks.listCreativeStageHandoffs,
}))
vi.mock('./artifact.service', () => ({
  findArtifactByIdempotency: mocks.findArtifactByIdempotency,
}))

import { createChapterEndCreativeStageHandoffDraft } from './creative-stage-handoff.service'

const input = {
  novelId: 3,
  stageId: 11,
  chapterId: 101,
  chapterNum: 100,
  chapterTitle: '封门',
  chapterContent: '陆沉拿到账本，姜照夜为掩护他失去城门通行令。城隍封门的倒计时开始。',
  summary: '陆沉拿到账本，姜照夜失去通行令。',
  nextChapterSeed: '城隍封门倒计时',
  modelConfigId: 8,
}

describe('chapter-end creative stage handoff extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listCreativeStageHandoffs.mockReturnValue([])
    mocks.findArtifactByIdempotency.mockReturnValue(null)
    mocks.createCreativeStageHandoff.mockImplementation((value) => ({
      id: 'handoff-1',
      novelId: 3,
      kind: 'creative_stage_handoff',
      status: 'draft',
      producerType: value.producerType,
      idempotencyKey: value.idempotencyKey,
      ...value,
      content: {
        schemaVersion: 'creative-stage-handoff-v1',
        stageId: value.stageId,
        stageName: '第一卷起局',
        chapterRange: '第 1–100 章',
        changes: value.changes,
        costs: value.costs,
        openQuestions: value.openQuestions,
        nextPressure: value.nextPressure,
        assetContinuity: value.assetContinuity || [],
      },
    }))
  })

  it('normalizes a model candidate into a reviewable draft', async () => {
    mocks.runChatTask.mockResolvedValue(JSON.stringify({
      changes: ['主角拿到账本', '', '主角拿到账本'],
      costs: ['姜照夜失去通行令'],
      open_questions: ['谁在操纵城隍封门'],
      next_pressure: '城隍封门倒计时',
      asset_continuity: [{ asset_type: 'character', name: '姜照夜', change: 'changed', note: '行动受限' }],
    }))

    const result = await createChapterEndCreativeStageHandoffDraft(input)

    expect(result.extractionMode).toBe('model')
    expect(mocks.createCreativeStageHandoff).toHaveBeenCalledWith(expect.objectContaining({
      stageId: 11,
      idempotencyKey: expect.stringMatching(/^chapter-handoff-seed:101:[a-f0-9]{24}$/u),
      producerType: 'novelforge_model',
      modelConfigId: 8,
      changes: ['主角拿到账本'],
      costs: ['姜照夜失去通行令'],
      openQuestions: ['谁在操纵城隍封门'],
      assetContinuity: [{ assetType: 'character', name: '姜照夜', change: 'changed', note: '行动受限' }],
    }))
  })

  it('falls back to the deterministic seed when model JSON is unusable', async () => {
    mocks.runChatTask.mockResolvedValue('不是 JSON')

    const result = await createChapterEndCreativeStageHandoffDraft(input)

    expect(result.extractionMode).toBe('deterministic')
    expect(mocks.createCreativeStageHandoff).toHaveBeenCalledWith(expect.objectContaining({
      producerType: 'system',
      changes: ['陆沉拿到账本，姜照夜失去通行令。'],
      costs: [],
      openQuestions: [],
      nextPressure: '城隍封门倒计时',
    }))
  })

  it('creates a new handoff revision key after the chapter content changes', async () => {
    mocks.runChatTask.mockResolvedValue(JSON.stringify({
      changes: ['主角拿到账本'],
      next_pressure: '城隍封门倒计时',
    }))

    await createChapterEndCreativeStageHandoffDraft(input)
    await createChapterEndCreativeStageHandoffDraft({
      ...input,
      chapterContent: `${input.chapterContent}陆沉随后烧掉了伪造副本。`,
      summary: '陆沉拿到账本并烧掉伪造副本，姜照夜失去通行令。',
    })

    const artifactKeys = mocks.createCreativeStageHandoff.mock.calls.map(([value]) => value.idempotencyKey)
    const taskKeys = mocks.runChatTask.mock.calls.map(([value]) => value.idempotencyKey)
    expect(new Set(artifactKeys).size).toBe(2)
    expect(new Set(taskKeys).size).toBe(2)
  })

  it('reuses the immutable handoff for the same chapter revision without another model call', async () => {
    mocks.runChatTask.mockResolvedValue(JSON.stringify({
      changes: ['主角拿到账本'],
      next_pressure: '城隍封门倒计时',
    }))
    const first = await createChapterEndCreativeStageHandoffDraft(input)
    mocks.findArtifactByIdempotency.mockReturnValue(first.artifact)
    mocks.runChatTask.mockClear()
    mocks.createCreativeStageHandoff.mockClear()

    const replay = await createChapterEndCreativeStageHandoffDraft(input)

    expect(replay.artifact).toBe(first.artifact)
    expect(mocks.runChatTask).not.toHaveBeenCalled()
    expect(mocks.createCreativeStageHandoff).not.toHaveBeenCalled()
  })
})
