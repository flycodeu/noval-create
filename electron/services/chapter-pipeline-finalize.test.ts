import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterContextRawData } from './context.service'

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  createHandoff: vi.fn(),
  upsertAsset: vi.fn(),
  scheduleDialogueRefresh: vi.fn(),
  generateEmbeddings: vi.fn(),
  prepareCanon: vi.fn(),
  updateTaskStatus: vi.fn(),
}))

vi.mock('./creative-stage-handoff.service', () => ({
  createChapterEndCreativeStageHandoffDraft: mocks.createHandoff,
}))

vi.mock('./creative-stage.service', () => ({
  upsertCreativeStageAsset: mocks.upsertAsset,
}))

vi.mock('./dialogue-fingerprint.service', () => ({
  scheduleDialogueFingerprintRefresh: mocks.scheduleDialogueRefresh,
}))

vi.mock('./embedding.service', () => ({
  generateChapterEmbeddings: mocks.generateEmbeddings,
}))

vi.mock('./chapter-writeback.service', () => ({
  prepareChapterWritebackRunWithRetry: mocks.prepareCanon,
}))

vi.mock('./task.service', () => ({
  updateTaskStatus: mocks.updateTaskStatus,
}))

import {
  buildChapterFinalizeDetail,
  executeChapterFinalizePhase,
  finalizeChapterPipelineOutput,
  runChapterCanonizerAndFinalize,
  type GeneratedChapterFinalizeResult,
} from './chapter-pipeline-finalize'

const finalizeResult: GeneratedChapterFinalizeResult = {
  chapterId: 101,
  summary: '他从雨巷脱身。',
  nextChapterSeed: '追兵找到遗落的铜牌。',
  wordCount: 3200,
  status: 'draft',
}

beforeEach(() => {
  mocks.events.length = 0
  mocks.createHandoff.mockReset().mockImplementation(async () => {
    mocks.events.push('handoff')
    return { extractionMode: 'model' }
  })
  mocks.upsertAsset.mockReset().mockImplementation(() => {
    mocks.events.push('asset')
  })
  mocks.scheduleDialogueRefresh.mockReset().mockImplementation(() => {
    mocks.events.push('dialogue')
  })
  mocks.generateEmbeddings.mockReset().mockImplementation(async () => {
    mocks.events.push('embedding')
  })
  mocks.prepareCanon.mockReset()
  mocks.updateTaskStatus.mockReset()
})

describe('chapter pipeline finalize', () => {
  it('commits chapter 1 before scheduling non-blocking derived refreshes', async () => {
    const result = await finalizeChapterPipelineOutput({
      chapter: { id: 101, novelId: 7, chapterNum: 1, title: '夜账' },
      novelModelConfigId: 3,
      content: '他从雨巷脱身。',
      commitContent: async () => {
        mocks.events.push('commit')
        return finalizeResult
      },
      getCommittedChapter: () => ({ id: 101, novelId: 7, chapterNum: 1, title: '夜账' }),
    })

    await vi.waitFor(() => expect(mocks.events).toEqual(['commit', 'dialogue', 'embedding']))
    expect(result).toBe(finalizeResult)
    expect(mocks.createHandoff).not.toHaveBeenCalled()
  })

  it('creates the chapter 2 stage handoff before downstream refreshes at a stage boundary', async () => {
    const creativeStageContext = {
      stage: { id: 9, chapterEnd: 2 },
    } as NonNullable<ChapterContextRawData['creativeStageContext']>

    await finalizeChapterPipelineOutput({
      chapter: { id: 102, novelId: 7, chapterNum: 2, title: '缺页' },
      creativeStageContext,
      content: '他把缺页压进衣袋。',
      commitContent: async () => {
        mocks.events.push('commit')
        return { ...finalizeResult, chapterId: 102 }
      },
      getCommittedChapter: () => ({ id: 102, novelId: 7, chapterNum: 2, title: '缺页' }),
    })

    await vi.waitFor(() => expect(mocks.events).toEqual(['commit', 'asset', 'handoff', 'dialogue', 'embedding']))
    expect(mocks.createHandoff).toHaveBeenCalledWith(expect.objectContaining({
      chapterId: 102,
      stageId: 9,
      summary: '他从雨巷脱身。',
    }))
  })

  it('formats the final task detail without empty optional sections', () => {
    expect(buildChapterFinalizeDetail({ publishSummary: '', nextChapterSeed: '' }))
      .toBe('章节已入稿，并刷新摘要、连续性与长期记忆。')
  })

  it('runs chapter 1 Canonizer before Finalize and closes both role tasks', async () => {
    mocks.prepareCanon.mockResolvedValue({ id: 81, status: 'ready', summaryText: 'Canon 草案就绪' })
    const finishCanonizer = vi.fn()
    const finishFinalize = vi.fn()

    const output = await runChapterCanonizerAndFinalize({
      chapterId: 101,
      contractVersion: 'contract-v1',
      prepareCanon: true,
      startCanonizer: vi.fn().mockResolvedValue(71),
      startFinalize: vi.fn().mockResolvedValue(72),
      finishCanonizer,
      finishFinalize,
      failCanonizer: vi.fn(() => { throw new Error('unexpected') }),
      onCanonReused: vi.fn(),
      finalizeContent: vi.fn().mockResolvedValue(finalizeResult),
      publishSummary: '验收通过',
    })

    expect(output.canonRun.id).toBe(81)
    expect(finishCanonizer).toHaveBeenCalledWith(71, 'Canon 草案就绪', 81)
    expect(finishFinalize).toHaveBeenCalledWith(72, expect.stringContaining('验收通过'), 81)
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(72, 'success', undefined, expect.objectContaining({
      canonRunId: 81,
    }))
  })

  it('adapts runtime bindings to the fixed Canonizer and Finalize task contract', async () => {
    mocks.prepareCanon.mockResolvedValue({ id: 91, status: 'ready', summaryText: 'Canon 已准备' })
    const bindings = {
      shouldRun: vi.fn(() => true),
      startRole: vi.fn(async (role: string) => role === 'canonizer' ? 73 : 74),
      finishRole: vi.fn(),
      reuseRole: vi.fn(),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
    }

    const output = await executeChapterFinalizePhase({
      chapterId: 101,
      contractVersion: 'contract-v2',
      bindings: bindings as never,
      finalizeContent: vi.fn().mockResolvedValue(finalizeResult),
      publishSummary: '门禁通过',
    })

    expect(output.canonRun.id).toBe(91)
    expect(bindings.startRole).toHaveBeenNthCalledWith(
      1,
      'canonizer',
      'chapter_canonizer',
      'Canonizer 正在为本章准备可确认的状态差异草案。',
      { runnerType: 'workflow' },
    )
    expect(bindings.startRole).toHaveBeenNthCalledWith(
      2,
      'finalize',
      'chapter_finalize',
      '正在刷新摘要、连续性与故事记忆。',
      { runnerType: 'workflow', canonRunId: 91 },
    )
    expect(bindings.finishRole).toHaveBeenCalledWith('canonizer', 73, 'Canon 已准备', { canonRunId: 91 })
    expect(bindings.finishRole).toHaveBeenCalledWith(
      'finalize',
      74,
      expect.stringContaining('门禁通过'),
      { canonRunId: 91 },
    )
  })
})
