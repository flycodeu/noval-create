import { describe, expect, it } from 'vitest'

import {
  estimateRequestBudget,
  RequestBudgetExceededError,
  serializeRequestInput,
} from './request-budget'
import { estimateTokens } from '../../src/shared/token-budget'

describe('request budget', () => {
  it('uses one estimator for complete messages and system prompt', () => {
    const messages = [
      { role: 'user' as const, content: '中文 mixed 😀' },
      { role: 'assistant' as const, content: '' },
    ]
    const report = estimateRequestBudget({
      messages,
      systemPrompt: 'system',
      maxTokens: 64,
      modelContextTokens: 8000,
    })

    expect(report.source).toBe('estimated')
    expect(report.estimatedInputTokens).toBe(estimateTokens(serializeRequestInput(messages, 'system')))
    expect(report.outputReserveTokens).toBe(64)
  })

  it('rejects input plus output against the safe model window', () => {
    const report = estimateRequestBudget({
      messages: [{ role: 'user', content: 'a'.repeat(30_000) }],
      maxTokens: 2_000,
      modelContextTokens: 8_000,
      tokenSafetyMarginPct: 0,
    })

    expect(report.allowed).toBe(false)
    expect(report.reason).toBe('input_and_output_exceed_window')
    expect(report.outputReserveTokens).toBe(2_000)
    expect(() => { throw new RequestBudgetExceededError(report) }).toThrow('NF_REQUEST_BUDGET_EXCEEDED')
  })

  it('marks unknown custom windows unverified without assuming infinity', () => {
    const report = estimateRequestBudget({
      messages: [{ role: 'user', content: 'custom input' }],
      maxTokens: 100,
      modelContextTokens: null,
    })

    expect(report.allowed).toBe(true)
    expect(report.status).toBe('unverified')
    expect(report.effectiveBudget).toBeNull()
  })

  it('never clamps the actual output reserve to the effective budget', () => {
    const report = estimateRequestBudget({
      messages: [{ role: 'user', content: 'short' }],
      maxTokens: 2_000,
      modelContextTokens: 8_000,
      tokenSafetyMarginPct: 0,
      stageBudget: 1_000,
    })

    expect(report.outputReserveTokens).toBe(2_000)
    expect(report.estimatedTotalTokens).toBe(report.estimatedInputTokens + 2_000)
    expect(report.allowed).toBe(false)
  })
})
