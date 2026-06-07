import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./model.service', () => ({
  getDefaultModelConfigRecord: vi.fn(() => ({
    id: 9,
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    temperature: 0.8,
    maxTokens: 8000,
    extraParamsJson: null,
  })),
  getModelConfigRecord: vi.fn(() => ({
    id: 9,
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    temperature: 0.8,
    maxTokens: 8000,
    extraParamsJson: null,
  })),
  getModelProviderOptions: vi.fn((config: { provider?: string; extraParamsJson?: string | null }) => {
    if (config.provider !== 'kimi') return undefined
    return { kimiThinking: 'enabled' }
  }),
  getProviderTokenSafetyMarginPct: vi.fn((provider?: string | null) => {
    if (provider === 'openai') return 10
    if (provider === 'anthropic') return 12
    return 15
  }),
}))

vi.mock('./style-analysis.service', () => ({
  getLatestStyleFingerprintForNovel: vi.fn(() => null),
}))

import { getModelConfigRecord } from './model.service'
import { buildAiExplainabilityReport, buildAiModelRouteReport, buildChatOptionsFromRoute } from './ai-engine.service'

describe('ai-engine route policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies provider token safety margin and rewrite overrides to route reports', () => {
    const route = buildAiModelRouteReport({
      taskKind: 'chapter_rewrite',
      stageLabel: 'Rewriter',
      executionMode: 'balanced',
      resolutionSource: 'fallback_default',
      temperatureCap: 0.7,
      contextStrategy: 'max_coverage',
      reviewDepth: 'deep',
      extraReasons: ['高风险章节重写。'],
    })

    expect(route.provider).toBe('deepseek')
    expect(route.tokenSafetyMarginPct).toBe(15)
    expect(route.temperature).toBeLessThanOrEqual(0.7)
    expect(route.contextStrategy).toBe('max_coverage')
    expect(route.reviewDepth).toBe('deep')
    expect(route.maxTokens).toBeLessThan(8640)
    expect(route.reasons).toContain('高风险章节重写。')
  })

  it('surfaces active prompt overrides in explainability reports', () => {
    const route = buildAiModelRouteReport({
      taskKind: 'chapter_generation',
      stageLabel: 'Writer',
      executionMode: 'balanced',
      resolutionSource: 'fallback_default',
    })
    const report = buildAiExplainabilityReport({
      taskKind: 'chapter_generation',
      executionMode: 'balanced',
      usageSnapshot: {
        usedAssets: [],
        usedContracts: [],
        ignoredConstraints: [],
        recentStateChanges: [],
        linkedImpacts: [],
      },
      stageReports: [{
        stageKey: 'writer',
        stageLabel: 'Writer',
        taskKind: 'chapter_generation',
        executionMode: 'balanced',
        outputShape: 'text',
        summary: '正文初稿',
        route,
      }],
      structuredOutputs: ['场景计划 JSON'],
      activePromptOverrideKeys: ['chapterRewrite', 'chapterReview'],
    })

    expect(report.activePromptOverrideKeys).toEqual(['chapterRewrite', 'chapterReview'])
    expect(report.routeSummary).toContain('Prompt Override 2 项')
  })

  it('passes Kimi provider options from model config into chat options', () => {
    vi.mocked(getModelConfigRecord).mockReturnValueOnce({
      id: 11,
      provider: 'kimi',
      modelId: 'kimi-k2.6',
      temperature: 0.75,
      maxTokens: 65536,
      extraParamsJson: JSON.stringify({ kimiThinking: 'enabled' }),
    } as never)

    const route = buildAiModelRouteReport({
      taskKind: 'chapter_generation',
      stageLabel: 'Writer',
      executionMode: 'balanced',
      resolutionSource: 'fallback_default',
      modelConfigId: 11,
    })

    expect(route.providerOptions).toEqual({ kimiThinking: 'enabled' })
    expect(buildChatOptionsFromRoute(route).providerOptions).toEqual({ kimiThinking: 'enabled' })
  })
})
