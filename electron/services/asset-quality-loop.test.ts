import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewGeneratedAsset, runAssetQualityLoop } from './asset-quality.service'
import type { AssetReviewPromptInput, AssetRewritePromptInput } from './prompts'

const mock = vi.hoisted(() => ({ chat: vi.fn(), reviewPrompt: vi.fn((input: AssetReviewPromptInput) => { void input; return 'review' }), rewritePrompt: vi.fn((input: AssetRewritePromptInput) => { void input; return 'rewrite' }) }))
vi.mock('./task.service', () => ({ runChatTask: mock.chat }))
vi.mock('./prompts', () => ({ assetReviewPrompt: mock.reviewPrompt, assetRewritePrompt: mock.rewritePrompt }))
const base = { targetType: 'chapter' as const, novelId: 1, contextSummary: '已有事实', generatedOutput: '待审原文' }
const review = (rewrite = false) => JSON.stringify({ summary: rewrite ? '需要修订' : '通过', rewrite_required: rewrite, reject_required: false })

describe('asset quality loop completion gate', () => {
  beforeEach(() => { mock.chat.mockReset(); mock.reviewPrompt.mockClear(); mock.rewritePrompt.mockClear() })
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
  it('applies the same evidence and applicability criteria to direct chapter review and repaired prose', async () => {
    mock.chat.mockResolvedValueOnce(review())
    await reviewGeneratedAsset({ ...base, narrativePolicyVersion: 'legacy', reviewFocus: ['仅核对第二段及衔接。'] })
    const direct = mock.reviewPrompt.mock.calls[0][0].reviewFocus || []
    expect(direct).toEqual(expect.arrayContaining([
      '仅核对第二段及衔接。',
      expect.stringContaining('重大选择要符合当事人已知信息'),
      expect.stringContaining('不要求每章都有损失、反转或新危险'),
      expect.stringContaining('未核实不冒充通行事实'),
      expect.stringContaining('引用候选连续原句'),
      expect.stringContaining('不适用或依据不足明说'),
    ]))
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('修订稿').mockResolvedValueOnce(review())
    await runAssetQualityLoop({ ...base, rewriteConstraints: ['只改第二段。'] })
    expect(mock.reviewPrompt.mock.calls[2][0].reviewFocus).toEqual(expect.arrayContaining(direct.slice(1)))
    expect(mock.rewritePrompt.mock.calls[0][0].rewriteConstraints).toEqual(expect.arrayContaining([
      '只改第二段。', expect.stringContaining('不临时补造旧伤、动机或解围规则'),
      expect.stringContaining('局部修订只处理选中范围'),
    ]))
  })
  it.each(['outline', 'map'] as const)('limits story review criteria to the applicable %s target', async targetType => {
    mock.chat.mockResolvedValueOnce(review())
    await reviewGeneratedAsset({ ...base, targetType })
    const focus = (mock.reviewPrompt.mock.calls[0][0].reviewFocus || []).join('\n')
    expect(focus.includes('重大选择要符合当事人已知信息')).toBe(targetType === 'outline')
    expect(focus.includes('配角按自己的生计')).toBe(targetType === 'outline')
  })
  it('uses the selected reviewer for review and recheck, and the writer for repair', async () => {
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('修订稿').mockResolvedValueOnce(review())
    await runAssetQualityLoop({ ...base, modelConfigId: 2, rewriteModelConfigId: 1, chatOpts: { temperature: 0.2 }, rewriteChatOpts: { temperature: 0.7 } })
    expect(mock.chat.mock.calls.map(([options]) => options.modelConfigId)).toEqual([2, 1, 2])
    expect(mock.chat.mock.calls.map(([options]) => options.chatOpts.temperature)).toEqual([0.2, 0.7, 0.2])
  })
  it('reviews each merged patch but keeps rewrite input restricted to the local patch context', async () => {
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('新局部补丁').mockResolvedValueOnce(review())
    const merged = vi.fn((output: string) => `合并后的完整章：${output}`)
    await runAssetQualityLoop({ ...base, reviewContextSummary: merged })
    expect(merged.mock.calls.map(([output]) => output)).toEqual(['待审原文', '新局部补丁'])
    expect(mock.reviewPrompt.mock.calls.map(([input]) => input.contextSummary)).toEqual(['合并后的完整章：待审原文', '合并后的完整章：新局部补丁'])
    expect(mock.rewritePrompt.mock.calls[0][0].contextSummary).toBe(base.contextSummary)
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

  it('sends machine field errors to repair before spending a model review, then reviews the repaired candidate', async () => {
    const validateOutput = (output: string) => output === 'invalid outline' ? ['chapters[0].chapterContract.targetWords：不支持的字段', 'chapters[0].scenes[0].action：不支持的字段'] : []
    mock.chat.mockResolvedValueOnce('valid outline').mockResolvedValueOnce(review())
    const result = await runAssetQualityLoop({ ...base, targetType: 'outline', generatedOutput: 'invalid outline', schemaHint: 'strict outline schema', validateOutput })
    expect(result).toMatchObject({ stage: 'rewritten', finalOutput: 'valid outline', initialModelReviewSkipped: true, contractValidation: { initialIssues: validateOutput('invalid outline'), finalIssues: [] } })
    expect(mock.chat.mock.calls.map(([options]) => options.messages[0].content)).toEqual(['rewrite', 'review'])
    expect(mock.rewritePrompt).toHaveBeenCalledWith(expect.objectContaining({ schemaHint: 'strict outline schema', topFixes: validateOutput('invalid outline'), rewriteConstraints: expect.arrayContaining([expect.stringContaining('不支持字段必须删除')]) }))
    expect(mock.reviewPrompt).toHaveBeenCalledWith(expect.objectContaining({ generatedOutput: 'valid outline', schemaHint: 'strict outline schema' }))
  })

  it('blocks unsupported fields introduced by a rewrite before asking a model to approve them', async () => {
    mock.chat.mockResolvedValueOnce(review(true)).mockResolvedValueOnce('invalid repaired outline')
    const result = await runAssetQualityLoop({ ...base, validateOutput: output => output.startsWith('invalid') ? ['scenes[0].limitedResult：不支持的字段'] : [] })
    expect(result).toMatchObject({ stage: 'rejected', failureStage: 'contract', finalOutput: 'invalid repaired outline', initialModelReviewSkipped: false, contractValidation: { initialIssues: [], finalIssues: ['scenes[0].limitedResult：不支持的字段'] } })
    expect(mock.chat).toHaveBeenCalledTimes(2)
    expect(mock.reviewPrompt).toHaveBeenCalledTimes(1)
  })

  it('preserves a structurally invalid candidate without a model call when repair is disabled', async () => {
    const result = await runAssetQualityLoop({ ...base, maxRewritePasses: 0, validateOutput: () => ['chapterContract.targetWords：不支持的字段'] })
    expect(result).toMatchObject({ stage: 'rejected', failureStage: 'contract', finalOutput: base.generatedOutput, initialModelReviewSkipped: true })
    expect(mock.chat).not.toHaveBeenCalled()
    expect(result.review.summary).toContain('未运行模型审校')
  })

  it('preserves the precise repair transport failure after machine validation, without labeling it a contract failure', async () => {
    mock.chat.mockRejectedValueOnce(new Error('provider timeout'))
    const result = await runAssetQualityLoop({ ...base, validateOutput: () => ['chapterContract.targetWords：不支持的字段'] })
    expect(result).toMatchObject({ stage: 'rejected', failureStage: 'rewrite', finalOutput: base.generatedOutput, warnings: ['provider timeout'] })
    expect(mock.chat).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the machine checker itself cannot finish', async () => {
    const result = await runAssetQualityLoop({ ...base, maxRewritePasses: 0, validateOutput: () => { throw new Error('contract unavailable') } })
    expect(result).toMatchObject({ stage: 'rejected', failureStage: 'contract', contractValidation: { finalIssues: ['结构校验未完成：contract unavailable'] } })
    expect(mock.chat).not.toHaveBeenCalled()
  })

  it('cannot let model approval override the final machine check when references change during review', async () => {
    const validateOutput = vi.fn().mockReturnValueOnce([]).mockReturnValue(['引用地点已失效'])
    mock.chat.mockResolvedValueOnce(review())
    const result = await runAssetQualityLoop({ ...base, validateOutput })
    expect(result).toMatchObject({ stage: 'rejected', failureStage: 'contract', review: { rejectRequired: false }, contractValidation: { initialIssues: [], finalIssues: ['引用地点已失效'] } })
    expect(mock.chat).toHaveBeenCalledTimes(1)
  })
})
