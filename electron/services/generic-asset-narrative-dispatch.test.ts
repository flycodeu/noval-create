import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateGenericAssetDraft } from './generic-asset-workflow.service'
import type { AssetReviewTarget } from '../../src/types'

const mock = vi.hoisted(() => ({
  generate: vi.fn(),
  review: vi.fn(),
  settingsJson: '{}',
  stop: new Error('stop before candidate persistence'),
}))
vi.mock('./novel.service', () => ({ getNovel: () => ({ id: 1, contextVersion: 3, modelConfigId: 7, settingsJson: mock.settingsJson }) }))
vi.mock('./artifact.service', () => ({
  findArtifactByIdempotency: () => null,
  hashArtifactContent: (value: unknown) => JSON.stringify(value),
}))
vi.mock('./task.service', () => ({ createTask: async () => 19, executeChatTask: mock.generate, updateTask: vi.fn() }))
vi.mock('./asset-quality.service', () => ({ runAssetQualityLoop: mock.review }))
vi.mock('./ai-engine.service', () => ({
  resolveAiExecutionMode: () => ({ mode: 'balanced', source: 'novel' }),
  buildAiModelRouteReport: (input: { modelConfigId: number }) => ({ modelConfigId: input.modelConfigId, maxTokens: 8000 }),
  buildChatOptionsFromRoute: () => ({ maxTokens: 8000 }),
}))

describe('creative narrative model dispatch', () => {
  beforeEach(() => {
    mock.generate.mockReset().mockResolvedValue('{"content":"她把账册收回，继续等晚归的女儿。"}')
    mock.review.mockReset().mockRejectedValue(mock.stop)
    mock.settingsJson = '{}'
  })

  async function dispatch(assetType: AssetReviewTarget) {
    await expect(generateGenericAssetDraft({
      novelId: 1, assetType, title: '本次候选', outputFormat: 'json',
      schemaHint: '{"content":"正文"}', idempotencyKey: `case:${assetType}`,
      requirements: ['仅改第二段，保留其他正文。'],
    }, { contextSummary: '已确认：掌柜正在等女儿回来。', reviewModelConfigId: 8 })).rejects.toBe(mock.stop)
    return mock.generate.mock.calls[0][1].messages[0].content as string
  }

  it.each(['chapter', 'outline'] as AssetReviewTarget[])('sends decision and cultural boundaries to the real %s generation request', async assetType => {
    const prompt = await dispatch(assetType)
    expect(prompt).toContain('重大选择要符合当事人已知信息')
    expect(prompt).toContain('回看已有线索及其原先解释')
    expect(prompt).toContain('不要求每章都有损失、反转或新危险')
    expect(prompt).toContain('人物信念和作品原创规则')
    expect(prompt).toContain('他人私心不能写成当前视角已知')
    expect(prompt).toContain('仅改第二段，保留其他正文。')
    expect(prompt).toContain('只输出一个合法 JSON 值')
    expect(mock.review.mock.calls[0][0]).toMatchObject({
      targetType: assetType, modelConfigId: 8, rewriteModelConfigId: 7,
      generatedOutput: '{"content":"她把账册收回，继续等晚归的女儿。"}',
    })
  })

  it('keeps narrative scene criteria out of a map asset request', async () => {
    const prompt = await dispatch('map')
    expect(prompt).not.toContain('【故事质量取舍】')
    expect(prompt).not.toContain('转折须能回看')
    expect(prompt).toContain('必须遵循此结构提示')
  })
})
