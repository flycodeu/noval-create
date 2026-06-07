import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekAdapter } from './deepseek.adapter'
import { KimiAdapter } from './kimi.adapter'

function mockChatResponse(content = 'ok') {
  return new Response(JSON.stringify({
    choices: [
      { message: { content } },
    ],
  }), { status: 200 })
}

function getLastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined
  return JSON.parse(String(request?.body || '{}')) as Record<string, unknown>
}

describe('Kimi adapter', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockResolvedValue(mockChatResponse())
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses max_completion_tokens, omits temperature for K2.x, and can disable thinking', async () => {
    const adapter = new KimiAdapter('moonshot-key', 'kimi-k2.6')

    const result = await adapter.chat(
      [{ role: 'user', content: 'ping' }],
      {
        temperature: 0.2,
        maxTokens: 123,
        providerOptions: { kimiThinking: 'disabled' },
      },
    )

    expect(result).toBe('ok')
    const body = getLastRequestBody(fetchMock)
    expect(body.model).toBe('kimi-k2.6')
    expect(body.max_completion_tokens).toBe(123)
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('disables thinking by default for direct adapter calls', async () => {
    const adapter = new KimiAdapter('moonshot-key', 'kimi-k2.6')

    await adapter.chat([{ role: 'user', content: 'ping' }], { maxTokens: 123 })

    const body = getLastRequestBody(fetchMock)
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('can explicitly enable thinking for Kimi requests', async () => {
    const adapter = new KimiAdapter('moonshot-key', 'kimi-k2.6')

    await adapter.chat(
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 123, providerOptions: { kimiThinking: 'enabled' } },
    )

    const body = getLastRequestBody(fetchMock)
    expect(body.thinking).toEqual({ type: 'enabled' })
  })

  it('does not expose OpenAI embeddings and caps Moonshot v1 context windows by model id', () => {
    const adapter = new KimiAdapter('moonshot-key', 'moonshot-v1-8k', undefined, 256000)

    expect(adapter.embed).toBeUndefined()
    expect(adapter.maxContextTokens).toBe(8000)
  })
})

describe('DeepSeek adapter', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockResolvedValue(mockChatResponse())
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses custom baseUrl for chat completions', async () => {
    const adapter = new DeepSeekAdapter('deepseek-key', 'deepseek-v4-flash', 'https://deepseek.example/v1')

    await adapter.chat([{ role: 'user', content: 'ping' }], { maxTokens: 10 })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://deepseek.example/v1/chat/completions')
  })
})
