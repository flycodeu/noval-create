import { describe, expect, it } from 'vitest'
import type {
  ChapterOptimizationFactGuard,
  ChapterOptimizationQualityGate,
  ChapterStructuralRepairGate,
  LanguageDriftMetrics,
} from '../../../types'
import { fromFactGuard, fromOptimizationQualityGate, fromStructuralGate } from './gate-adapters'

const DRIFT: LanguageDriftMetrics = {
  abstractTokenDensity: 0,
  sentencePatternRepeatRate: 0,
  endingSummaryRate: 0,
  ornamentOverloadRate: 0,
  nonHumanCollocationRate: 0,
  dashDensity: 0,
  parentheticalExplanationDensity: 0,
  metaphorStackRate: 0,
  parallelismRate: 0,
  bodyDetailClicheRate: 0,
  isolatedTemplateParagraphRate: 0,
}

describe('fromStructuralGate', () => {
  const baseGate: ChapterStructuralRepairGate = {
    required: true,
    safeToApply: true,
    warnings: [],
    stateChangeSignals: ['主角丢失信物'],
    payoffSignals: [],
    costSignals: ['左手受伤'],
    choiceSignals: [],
    supportingAgencySignals: [],
    misjudgmentSignals: [],
    changedSentenceRate: 0.18,
    scopeExpansionRatio: 0.05,
  }

  it('maps a passing gate with signal and stat items', () => {
    const report = fromStructuralGate(baseGate)
    expect(report.gateName).toBe('结构修复门')
    expect(report.passed).toBe(true)
    expect(report.items.some((item) => item.message.includes('状态变化信号：主角丢失信物'))).toBe(true)
    expect(report.items.some((item) => item.message.includes('代价信号：左手受伤'))).toBe(true)
    expect(report.items.some((item) => item.message.includes('句级改动率 18%'))).toBe(true)
    expect(report.items.every((item) => item.severity === 'info')).toBe(true)
  })

  it('promotes warnings to blockers when the gate fails', () => {
    const report = fromStructuralGate({ ...baseGate, safeToApply: false, warnings: ['改动范围超出结构问题本身'] })
    expect(report.passed).toBe(false)
    const blocker = report.items.find((item) => item.severity === 'blocker')
    expect(blocker?.message).toBe('改动范围超出结构问题本身')
    expect(blocker?.suggestion).toContain('人工比对')
  })

  it('notes when structural repair was not required', () => {
    const report = fromStructuralGate({ ...baseGate, required: false })
    expect(report.items[0].message).toContain('未触发结构修复')
    expect(report.items[0].severity).toBe('info')
  })
})

describe('fromOptimizationQualityGate', () => {
  const baseGate: ChapterOptimizationQualityGate = {
    safeToApply: true,
    warnings: [],
    originalGuardrailHits: ['排比过密'],
    optimizedGuardrailHits: [],
    originalStrongAiFlavorCount: 5,
    optimizedStrongAiFlavorCount: 1,
    originalHighSeverityCount: 2,
    optimizedHighSeverityCount: 0,
    originalDriftScore: 40,
    optimizedDriftScore: 22,
    languageDriftBefore: DRIFT,
    languageDriftAfter: DRIFT,
  }

  it('shows before/after comparisons as info when the numbers improved', () => {
    const report = fromOptimizationQualityGate(baseGate)
    expect(report.gateName).toBe('后验质量门')
    expect(report.passed).toBe(true)
    expect(report.items.some((item) => item.message === '强 AI 味句式：5 → 1' && item.severity === 'info')).toBe(true)
    expect(report.items.some((item) => item.message === '语言漂移分：40 → 22')).toBe(true)
  })

  it('flags regressions as warnings and failed gates as blockers', () => {
    const report = fromOptimizationQualityGate({
      ...baseGate,
      safeToApply: false,
      warnings: ['优化稿强 AI 味不降反升'],
      optimizedStrongAiFlavorCount: 8,
      optimizedDriftScore: 55,
      optimizedGuardrailHits: ['新增护栏命中', '另一个命中'],
    })
    expect(report.passed).toBe(false)
    expect(report.items.find((item) => item.severity === 'blocker')?.message).toBe('优化稿强 AI 味不降反升')
    expect(report.items.find((item) => item.message.startsWith('强 AI 味句式'))?.severity).toBe('warning')
    expect(report.items.find((item) => item.message.startsWith('语言漂移分'))?.severity).toBe('warning')
    expect(report.items.find((item) => item.message.startsWith('优化稿护栏命中'))?.severity).toBe('warning')
  })
})

describe('fromFactGuard', () => {
  const baseGuard: ChapterOptimizationFactGuard = {
    safeToApply: true,
    warnings: [],
    introducedTrackedEntities: [],
    removedTrackedEntities: [],
    changedNumbers: [],
    endingHookChanged: false,
    aiProcessLeakCount: 0,
  }

  it('produces a single info item when nothing is risky', () => {
    const report = fromFactGuard(baseGuard)
    expect(report.gateName).toBe('事实保护门')
    expect(report.passed).toBe(true)
    expect(report.items).toEqual([{ severity: 'info', message: '未发现事实层改动风险。' }])
  })

  it('surfaces every risk channel with suggestions', () => {
    const report = fromFactGuard({
      safeToApply: false,
      warnings: ['疑似改写了关键事实'],
      introducedTrackedEntities: ['神秘老者'],
      removedTrackedEntities: ['信物玉佩'],
      changedNumbers: ['三天 → 七天'],
      unsupportedNarrativeFacts: ['突然会用剑'],
      endingHookChanged: true,
      aiProcessLeakCount: 2,
    })
    expect(report.passed).toBe(false)
    expect(report.items.find((item) => item.severity === 'blocker')?.message).toBe('疑似改写了关键事实')
    const messages = report.items.map((item) => item.message)
    expect(messages.some((m) => m.includes('神秘老者'))).toBe(true)
    expect(messages.some((m) => m.includes('信物玉佩'))).toBe(true)
    expect(messages.some((m) => m.includes('三天 → 七天'))).toBe(true)
    expect(messages.some((m) => m.includes('突然会用剑'))).toBe(true)
    expect(messages.some((m) => m.includes('结尾钩子被改动'))).toBe(true)
    expect(messages.some((m) => m.includes('2 处 AI 过程语言泄漏'))).toBe(true)
    report.items
      .filter((item) => item.severity === 'warning')
      .forEach((item) => expect(item.suggestion).toBeTruthy())
  })
})
