import { describe, expect, it } from 'vitest'
import type { ContextPackSource } from '../../src/shared/context-pack'
import { estimateTokens, selectOriginalSources } from './context-token-budget'

function source(key: string, text: string, patch: Partial<ContextPackSource> = {}): ContextPackSource {
  return {
    key,
    sourceKind: 'chapter_original',
    sourceId: 'chapter:8',
    sourceVersion: 'v12',
    artifactHash: 'chapter-eight-hash',
    start: 0,
    end: text.length,
    visibility: 'canon',
    text,
    required: false,
    included: true,
    reason: 'visible_past_prose',
    estimatedTokens: estimateTokens(text),
    knowledgeLayer: 'pov_experience',
    ...patch,
  }
}

describe('original prose budget selection', () => {
  it('reports an unpublished required source separately when ample budget is available', () => {
    const hidden = source('chapter:8:original:1', '尚未公开的幕后身份。', {
      required: true,
      included: false,
      reason: 'forbidden_future_fact',
      knowledgeLayer: 'unclassified',
    })

    const selected = selectOriginalSources([hidden], 10000)

    expect(selected.missingRequiredSources).toEqual([hidden])
    expect(selected.requiredTokens).toBe(0)
    expect(selected.budgetOverflow).toBe(false)
    expect(selected.overflow).toBe(true)
    expect(selected.text).toBe('')
    expect(selected.sources[0]).toEqual(hidden)
  })

  it('reports real required-token overflow without misclassifying visible evidence', () => {
    const required = source('chapter:8:original:2', '必须承接的已发生行动。'.repeat(30), { required: true })
    const budget = estimateTokens(required.text) - 1

    const selected = selectOriginalSources([required], budget)

    expect(selected.budgetOverflow).toBe(true)
    expect(selected.overflow).toBe(true)
    expect(selected.requiredTokens).toBeGreaterThan(budget)
    expect(selected.missingRequiredSources).toEqual([])
    expect(selected.sources[0].included).toBe(true)
    expect(selected.text).toBe(required.text)
  })

  it('keeps ordinary required past prose when it fits without including an unrelated hidden source', () => {
    const past = source('chapter:8:original:3', '他压平受潮的第一页，收好没有翻动的画卷。', { required: true })
    const hidden = source('chapter:8:original:4', '尚未公开的幕后身份。', {
      included: false,
      reason: 'forbidden_future_fact',
      knowledgeLayer: 'unclassified',
    })

    const selected = selectOriginalSources([past, hidden], estimateTokens(past.text))

    expect(selected.budgetOverflow).toBe(false)
    expect(selected.overflow).toBe(false)
    expect(selected.missingRequiredSources).toEqual([])
    expect(selected.text).toBe(past.text)
    expect(selected.sources[1].included).toBe(false)
  })

  it('never restores previously excluded sources while refilling optional prose', () => {
    const required = source('chapter:8:original:5', '陆长生收好原册。', { required: true })
    const hiddenRequired = source('chapter:8:original:6', '隐秘', {
      required: true,
      included: false,
      reason: 'budget_insufficient',
      knowledgeLayer: 'unclassified',
    })
    const hiddenOptional = source('chapter:8:original:7', '密语', {
      included: false,
      reason: 'budget_insufficient',
      knowledgeLayer: 'unclassified',
    })
    const optional = source('chapter:8:original:8', '众人沿着长廊继续向前。'.repeat(30))
    const input = [required, hiddenRequired, hiddenOptional, optional]
    const original = structuredClone(input)

    const selected = selectOriginalSources(input, estimateTokens(required.text) + 10)

    expect(selected.budgetOverflow).toBe(false)
    expect(selected.overflow).toBe(true)
    expect(selected.missingRequiredSources).toEqual([hiddenRequired])
    expect(selected.sources.filter((item) => item.included).map((item) => item.key)).toEqual([required.key])
    expect(selected.text).toBe(required.text)
    expect(selected.sources[1]).toEqual(hiddenRequired)
    expect(selected.sources[2]).toEqual(hiddenOptional)
    expect(input).toEqual(original)
  })
})
