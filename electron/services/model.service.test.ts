import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import {
  getKimiModelContextWindow,
  getModelProviderOptions,
  isSupportedModelProvider,
  normalizeModelBaseUrl,
  normalizeModelContextTokensForModel,
  normalizeModelExtraParamsJson,
  normalizeModelProvider,
} from './model.service'

describe('model service normalization', () => {
  it('normalizes provider aliases and rejects unsupported providers', () => {
    expect(normalizeModelProvider('moonshot')).toBe('kimi')
    expect(normalizeModelProvider('claude')).toBe('anthropic')
    expect(isSupportedModelProvider('kimi')).toBe(true)
    expect(isSupportedModelProvider('unknown')).toBe(false)
  })

  it('caps Kimi and Moonshot context windows by model id for display and persistence', () => {
    expect(getKimiModelContextWindow('kimi-k2.6')).toBe(256000)
    expect(getKimiModelContextWindow('moonshot-v1-8k')).toBe(8000)
    expect(normalizeModelContextTokensForModel(256000, 'kimi', 'moonshot-v1-8k')).toBe(8000)
    expect(normalizeModelContextTokensForModel(undefined, 'kimi', 'moonshot-v1-32k')).toBe(32000)
    expect(normalizeModelContextTokensForModel(512000, 'openai', 'gpt-4o')).toBe(512000)
  })

  it('keeps Kimi thinking disabled by default and clears provider-specific extra params otherwise', () => {
    expect(normalizeModelExtraParamsJson(undefined, 'kimi')).toBe(JSON.stringify({ kimiThinking: 'disabled' }))
    expect(normalizeModelExtraParamsJson(JSON.stringify({ kimiThinking: 'enabled' }), 'kimi'))
      .toBe(JSON.stringify({ kimiThinking: 'enabled' }))
    expect(normalizeModelExtraParamsJson(JSON.stringify({ kimiThinking: 'enabled' }), 'openai')).toBeNull()
    expect(getModelProviderOptions({ provider: 'kimi', extraParamsJson: null })).toEqual({ kimiThinking: 'disabled' })
    expect(getModelProviderOptions({ provider: 'openai', extraParamsJson: JSON.stringify({ kimiThinking: 'enabled' }) })).toBeUndefined()
  })

  it('normalizes empty baseUrl safely when switching providers', () => {
    expect(normalizeModelBaseUrl('', 'openai')).toBeNull()
    expect(normalizeModelBaseUrl('', 'kimi')).toBeNull()
    expect(normalizeModelBaseUrl('', 'custom')).toBe('http://localhost:11434/v1')
    expect(normalizeModelBaseUrl(' https://deepseek.example/v1 ', 'deepseek')).toBe('https://deepseek.example/v1')
  })
})
