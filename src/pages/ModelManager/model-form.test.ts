import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../../types'
import { hasModelFormChanges, parseModelExtraParams } from './model-form'

const config = {
  id: 1, name: '主力', provider: 'openai', modelId: 'model-a', apiKey: '已设置', baseUrl: '',
  temperature: 0.8, maxTokens: 65536, maxConcurrency: 2, maxContextTokens: null,
} as ModelConfig

describe('saved-model connection test boundaries', () => {
  it('treats masked keys and absent optional context as unchanged', () => {
    expect(hasModelFormChanges(config, { ...config, maxContextTokens: undefined })).toBe(false)
  })
  it.each(['name', 'provider', 'modelId', 'baseUrl', 'apiKey', 'temperature', 'maxTokens', 'maxConcurrency', 'maxContextTokens'])('requires saving an edited %s', field => {
    expect(hasModelFormChanges(config, { ...config, [field]: 'changed' })).toBe(true)
  })
  it('allows a keyless local API, but not silently adding a draft key', () => {
    const local = { ...config, provider: 'custom', apiKey: '' }
    expect(hasModelFormChanges(local, { ...local })).toBe(false)
    expect(hasModelFormChanges(local, { ...local, apiKey: 'new-key' })).toBe(true)
  })
  it('includes provider-specific options and tolerates invalid old JSON', () => {
    const deepseek = { ...config, provider: 'deepseek', extraParamsJson: '{"deepseekReasoningEffort":"max"}' }
    expect(hasModelFormChanges(deepseek, { ...deepseek, deepseekReasoningEffort: 'max' })).toBe(false)
    expect(hasModelFormChanges(deepseek, { ...deepseek, deepseekReasoningEffort: 'low' })).toBe(true)
    const kimi = { ...config, provider: 'kimi', extraParamsJson: 'broken' }
    expect(parseModelExtraParams(kimi.extraParamsJson)).toEqual({})
    expect(hasModelFormChanges(kimi, { ...kimi, kimiThinking: 'disabled' })).toBe(false)
    expect(hasModelFormChanges(kimi, { ...kimi, kimiThinking: 'enabled' })).toBe(true)
  })
})
