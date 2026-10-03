import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekAdapter } from './deepseek.adapter'
import { OpenAIAdapter } from './openai.adapter'

const messages = [{ role: 'user' as const, content: '写出本章正文' }]

describe('DeepSeek reasoning request contract', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sets low reasoning by default and honors the model configuration without expanding its output cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new DeepSeekAdapter('test-only').chat(messages, { maxTokens: 12000 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 12000 })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200 }))
    await new DeepSeekAdapter('test-only').chat(messages, { maxTokens: 12000, providerOptions: { deepseekReasoningEffort: 'high' } })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reasoning_effort: 'high', max_tokens: 12000 })
  })

  it('sends the disabled switch in streaming mode when thinking is turned off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new DeepSeekAdapter('test-only').stream(messages, { providerOptions: { deepseekReasoningEffort: 'none' } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body).not.toHaveProperty('reasoning_effort')
  })
})

describe('DeepSeek generation timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS', '')
    delete process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function delayedChatResponse() {
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '完整正文' }, finish_reason: 'stop' }],
      }), { status: 200 })), 120000)
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    })))
  }

  it('allows a DeepSeek response taking more than ninety seconds without changing OpenAI', async () => {
    delayedChatResponse()
    const deepSeek = new DeepSeekAdapter('test-only').chat(messages, { requestRetryCount: 0 })
    await vi.advanceTimersByTimeAsync(120000)
    await expect(deepSeek).resolves.toBe('完整正文')

    const openAI = new OpenAIAdapter('test-only').chat(messages, { requestRetryCount: 0 }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(90000)
    expect(await openAI).toMatchObject({ cause: { code: 'REQUEST_TIMEOUT' } })
  })

  it('uses the longer timeout throughout DeepSeek SSE consumption', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"完整正文"}}]}\n\ndata: [DONE]\n\n'))
          controller.close()
        }, 120000)
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))
    const onStream = vi.fn()
    const stream = new DeepSeekAdapter('test-only').stream(messages, { requestRetryCount: 0, onStream })
    await vi.advanceTimersByTimeAsync(120000)
    await expect(stream).resolves.toBeUndefined()
    expect(onStream).toHaveBeenCalledWith('完整正文')
  })

  it('honors a shorter explicit environment timeout for DeepSeek', async () => {
    vi.stubEnv('NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS', '12000')
    delayedChatResponse()
    const result = new DeepSeekAdapter('test-only').chat(messages, { requestRetryCount: 0 }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(12000)
    expect(await result).toMatchObject({ cause: { code: 'REQUEST_TIMEOUT' } })
  })
})
