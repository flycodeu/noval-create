import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runAssetQualityLoop } from './asset-quality.service'

const mock = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('./task.service', () => ({ runChatTask: mock.chat }))
vi.mock('./prompts', () => ({ assetReviewPrompt: () => 'review', assetRewritePrompt: () => 'rewrite' }))
const base = { targetType: 'chapter' as const, novelId: 1, contextSummary: '已有事实', generatedOutput: '待审原文' }
const review = (rewrite = false) => JSON.stringify({ summary: rewrite ? '需要修订' : '通过', rewrite_required: rewrite, reject_required: false })

describe('asset quality loop completion gate', () => {
  beforeEach(() => { mock.chat.mockReset() })
  it('retains but rejects a candidate when review fails', async () => {
    mock.chat.mockRejectedValueOnce(new Error('network unavailable'))
    expect(await runAssetQualityLoop(base)).toMatchObject({ stage: 'rejected', failureStage: 'review', finalOutput: base.generatedOutput, review: { rejectRequired: true } })
  })
  it('cannot approve unresolved repairs when rewrite is skipped or fails', async () => {
    mock.chat.mockResolvedValueOnce(review(true))
    expect((await runAssetQualityLoop({ ...base, maxRewritePasses: 0 })).stage).toBe('rejected')
    mock.chat.mockResolvedValueOnce(review(true)).mockRejectedValueOnce(new Error('rewrite failed'))
    expect(await runAssetQualityLoop(base)).toMatchObject({ stage: 'rejected', failureStage: 'rewrite' })
  })
  it('retains rewritten candidate but rejects an unavailable or still failing recheck', async () => {
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('修订稿').mockRejectedValueOnce(new Error('recheck failed'))
    expect(await runAssetQualityLoop(base)).toMatchObject({ stage: 'rejected', failureStage: 'recheck', finalOutput: '修订稿' })
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('修订稿').mockResolvedValueOnce(review(true))
    expect((await runAssetQualityLoop(base)).stage).toBe('rejected')
  })
  it('approves only a completed clean recheck', async () => {
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('修订稿').mockResolvedValueOnce(review())
    expect(await runAssetQualityLoop(base)).toMatchObject({ stage: 'rewritten', finalOutput: '修订稿', warnings: [] })
  })
  it('keeps structural conflicts blocked and clean map descriptions unchanged', async () => {
    mock.chat.mockResolvedValueOnce(JSON.stringify({ summary: '父级引用错误', rewrite_required: false, reject_required: true, conflict_risks: ['父级不存在'] }))
    const rejected = await runAssetQualityLoop({ ...base, targetType: 'map' })
    expect(rejected).toMatchObject({ stage: 'rejected', review: { rejectRequired: true } })
    expect(rejected.failureStage).toBeUndefined()
    mock.chat.mockResolvedValueOnce(JSON.stringify({ summary: '两地点结构一致；条目表达可用，气候保留待确认', rewrite_required: false, reject_required: false, language_risks: ['可选：减少局部重复'] }))
    expect(await runAssetQualityLoop({ ...base, targetType: 'map' })).toMatchObject({ stage: 'accepted', finalOutput: base.generatedOutput, warnings: [] })
    expect(mock.chat).toHaveBeenCalledTimes(2)
  })
})
