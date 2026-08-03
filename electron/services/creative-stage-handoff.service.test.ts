import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runChatTask: vi.fn(),
  createCreativeStageHandoff: vi.fn(),
}))

vi.mock('./task.service', () => ({ runChatTask: mocks.runChatTask }))
vi.mock('./creative-stage.service', () => ({ createCreativeStageHandoff: mocks.createCreativeStageHandoff }))

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
    mocks.createCreativeStageHandoff.mockImplementation((value) => ({
      id: 'handoff-1',
      status: 'draft',
      ...value,
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
      idempotencyKey: 'chapter-handoff-seed:101',
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
})
