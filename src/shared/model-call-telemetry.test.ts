import { describe, expect, it } from 'vitest'
import {
  createUnknownCallUsage,
  normalizeAnthropicUsage,
  normalizeCallCompletion,
  normalizeOpenAIUsage,
} from './model-call-telemetry'

describe('model call telemetry normalization', () => {
  it('keeps OpenAI cache and reasoning counts as subsets of reported totals', () => {
    expect(normalizeOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 200 },
      completion_tokens_details: { reasoning_tokens: 50 },
    })).toEqual({
      input: { value: 1000, source: 'reported' },
      output: { value: 300, source: 'reported' },
      cacheRead: { value: 200, source: 'reported' },
      cacheWrite: { value: null, source: 'unknown' },
      reasoning: { value: 50, source: 'reported' },
    })
  })

  it('adds Anthropic cache categories to uncached input exactly once', () => {
    expect(normalizeAnthropicUsage({
      input_tokens: 1000,
      output_tokens: 300,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 40,
    })).toEqual({
      input: { value: 1240, source: 'reported' },
      output: { value: 300, source: 'reported' },
      cacheRead: { value: 200, source: 'reported' },
      cacheWrite: { value: 40, source: 'reported' },
      reasoning: { value: null, source: 'unknown' },
    })
  })

  it('preserves reported zero while rejecting missing, negative, non-finite, and coerced values', () => {
    const usage = normalizeOpenAIUsage({
      prompt_tokens: 0,
      completion_tokens: -1,
      prompt_tokens_details: { cached_tokens: Number.NaN },
      completion_tokens_details: { reasoning_tokens: '12' },
    })

    expect(usage.input).toEqual({ value: 0, source: 'reported' })
    expect(usage.output).toEqual({ value: null, source: 'unknown' })
    expect(usage.cacheRead).toEqual({ value: null, source: 'unknown' })
    expect(usage.reasoning).toEqual({ value: null, source: 'unknown' })
    expect(createUnknownCallUsage()).toEqual({
      input: { value: null, source: 'unknown' },
      output: { value: null, source: 'unknown' },
      cacheRead: { value: null, source: 'unknown' },
      cacheWrite: { value: null, source: 'unknown' },
      reasoning: { value: null, source: 'unknown' },
    })
  })

  it('marks normalized Anthropic input unknown when a reported additive field is invalid', () => {
    const usage = normalizeAnthropicUsage({
      input_tokens: 10,
      cache_read_input_tokens: Number.POSITIVE_INFINITY,
    })

    expect(usage.input).toEqual({ value: null, source: 'unknown' })
    expect(usage.cacheRead).toEqual({ value: null, source: 'unknown' })
  })

  it.each([
    ['stop', 'stop'],
    ['end_turn', 'stop'],
    ['length', 'length'],
    ['max_tokens', 'length'],
    ['content_filter', 'filtered'],
    ['filter', 'filtered'],
    ['tool_calls', 'tool_call'],
    ['tool_use', 'tool_call'],
    ['new_provider_reason', 'unknown'],
  ] as const)('maps raw finish reason %s to %s without discarding the raw value', (raw, finish) => {
    expect(normalizeCallCompletion(createUnknownCallUsage(), raw)).toMatchObject({
      finish,
      rawFinishReason: raw,
    })
  })
})
