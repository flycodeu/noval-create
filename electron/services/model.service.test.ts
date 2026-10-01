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
  getSqlite: vi.fn(),
}))

import { getSqlite } from '../database/db'
import {
  createAdapter,
  getKimiModelContextWindow,
  getModelProviderOptions,
  isNativeAgentProvider,
  providerRequiresApiKey,
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
    expect(normalizeModelProvider('codex-cli')).toBe('codex')
    expect(normalizeModelProvider('claude-code')).toBe('claude_code')
    expect(isSupportedModelProvider('kimi')).toBe(true)
    expect(isSupportedModelProvider('codex')).toBe(true)
    expect(isSupportedModelProvider('claude_code')).toBe(true)
    expect(isSupportedModelProvider('legacy-cli')).toBe(false)
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
    expect(normalizeModelBaseUrl('https://ignored.example/v1', 'codex')).toBeNull()
    expect(normalizeModelBaseUrl(' https://deepseek.example/v1 ', 'deepseek')).toBe('https://deepseek.example/v1')
  })

  it('requires API keys for every remote provider and keeps custom local models keyless', () => {
    expect(providerRequiresApiKey('custom')).toBe(false)
    expect(providerRequiresApiKey('openai')).toBe(true)
    expect(providerRequiresApiKey('anthropic')).toBe(true)
    expect(isNativeAgentProvider('codex')).toBe(true)
    expect(isNativeAgentProvider('claude_code')).toBe(true)
    expect(providerRequiresApiKey('codex')).toBe(false)
    expect(providerRequiresApiKey('claude_code')).toBe(false)
  })

  it('records output from direct adapter chat calls outside task.service', async () => {
    const inserts: unknown[][] = []
    const outputWrites: unknown[][] = []
    vi.mocked(getSqlite).mockReturnValue({
      transaction: (operation: () => void) => ({ immediate: operation }),
      prepare: (sql: string) => {
        if (sql.includes('COALESCE(MAX(attempt_index)')) return { get: () => ({ next_index: 1 }) }
        if (sql.includes('INSERT INTO model_request_attempts')) return { run: (...values: unknown[]) => { inserts.push(values) } }
        if (sql.includes('SET output_text = ?')) return { run: (...values: unknown[]) => { outputWrites.push(values) } }
        return { run: () => ({ changes: 1 }) }
      },
    } as never)
    const oldFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '对白摘要' }, finish_reason: 'stop' }],
    }), { status: 200 }))
    try {
      const adapter = createAdapter({ provider: 'custom', modelId: 'local-test', baseUrl: 'http://127.0.0.1:1/v1' })
      await expect(adapter.chat([{ role: 'user', content: '分析对白' }])).resolves.toBe('对白摘要')
      expect(inserts).toHaveLength(1)
      expect(String(inserts[0][11])).toContain('分析对白')
      expect(outputWrites).toHaveLength(1)
      expect(outputWrites[0][0]).toBe('对白摘要')
    } finally {
      globalThis.fetch = oldFetch
    }
  })
})
