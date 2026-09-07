import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CallCompletion, ModelRequestEvent } from '../../src/shared/model-call-telemetry'
import { AnthropicAdapter } from './anthropic.adapter'
import { CustomAdapter } from './custom.adapter'
import { DeepSeekAdapter } from './deepseek.adapter'
import { KimiAdapter } from './kimi.adapter'
import { OpenAIAdapter } from './openai.adapter'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sseResponse(events: string[], close = true): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      if (close) controller.close()
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('adapter model call telemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps OpenAI JSON text output and publishes one reported completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '正文' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 300,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 50 },
      },
    })))
    const completions: CallCompletion[] = []

    const text = await new OpenAIAdapter('key', 'model', 'http://127.0.0.1:1/v1').chat(
      [{ role: 'user', content: 'ping' }],
      { onCompletion: (completion) => completions.push(completion), requestRetryCount: 0 },
    )

    expect(text).toBe('正文')
    expect(completions).toHaveLength(1)
    expect(completions[0]).toEqual({
      finish: 'stop',
      rawFinishReason: 'stop',
      usage: {
        input: { value: 1000, source: 'reported' },
        output: { value: 300, source: 'reported' },
        cacheRead: { value: 200, source: 'reported' },
        cacheWrite: { value: null, source: 'unknown' },
        reasoning: { value: 50, source: 'reported' },
      },
    })
  })

  it('collects usage-only OpenAI tail frames and overwrites duplicate cumulative usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"流"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"式"},"finish_reason":"length"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":3}}}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":3}}}\n\n',
      'data: [DONE]\n\n',
    ])))
    const chunks: string[] = []
    const completions: CallCompletion[] = []

    await new OpenAIAdapter('key', 'model', 'http://127.0.0.1:1/v1').stream(
      [{ role: 'user', content: 'ping' }],
      {
        onStream: (chunk) => chunks.push(chunk),
        onCompletion: (completion) => completions.push(completion),
        requestRetryCount: 0,
      },
    )

    expect(chunks).toEqual(['流', '式'])
    expect(completions).toHaveLength(1)
    expect(completions[0]).toMatchObject({
      finish: 'length',
      rawFinishReason: 'length',
      usage: {
        input: { value: 10, source: 'reported' },
        output: { value: 4, source: 'reported' },
        cacheRead: { value: 3, source: 'reported' },
      },
    })
  })

  it('joins only Anthropic text blocks and normalizes JSON cache usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'thinking', thinking: '不应输出' },
        { type: 'tool_use', text: '也不应输出' },
        { type: 'text', text: '第二段' },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
        output_tokens: 30,
      },
    })))
    const completions: CallCompletion[] = []

    const text = await new AnthropicAdapter('key').chat(
      [{ role: 'user', content: 'ping' }],
      { onCompletion: (completion) => completions.push(completion), requestRetryCount: 0 },
    )

    expect(text).toBe('第一段第二段')
    expect(completions).toEqual([{
      finish: 'tool_call',
      rawFinishReason: 'tool_use',
      usage: {
        input: { value: 125, source: 'reported' },
        output: { value: 30, source: 'reported' },
        cacheRead: { value: 20, source: 'reported' },
        cacheWrite: { value: 5, source: 'reported' },
        reasoning: { value: null, source: 'unknown' },
      },
    }])
  })

  it('collects cumulative Anthropic stream usage and emits text blocks in event order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"stop_reason":null,"usage":{"input_tokens":80,"cache_read_input_tokens":20,"cache_creation_input_tokens":0,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"甲"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"乙"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","text":"隐藏"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"丙"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])))
    const chunks: string[] = []
    const completions: CallCompletion[] = []

    await new AnthropicAdapter('key').stream(
      [{ role: 'user', content: 'ping' }],
      {
        onStream: (chunk) => chunks.push(chunk),
        onCompletion: (completion) => completions.push(completion),
        requestRetryCount: 0,
      },
    )

    expect(chunks).toEqual(['甲', '乙', '丙'])
    expect(completions).toHaveLength(1)
    expect(completions[0]).toMatchObject({
      finish: 'stop',
      usage: {
        input: { value: 100, source: 'reported' },
        output: { value: 12, source: 'reported' },
      },
    })
  })

  it.each([
    ['OpenAI', () => new OpenAIAdapter('key', 'model', 'http://127.0.0.1:1/v1'), [
      'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
    ]],
    ['Anthropic', () => new AnthropicAdapter('key'), [
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    ]],
  ] as const)('does not publish a false completion when a %s stream closes before its protocol terminator', async (_name, createAdapter, events) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([...events])))
    const onCompletion = vi.fn()

    await expect(createAdapter().stream(
      [{ role: 'user', content: 'ping' }],
      { onCompletion, requestRetryCount: 0 },
    )).rejects.toMatchObject({ code: 'MODEL_STREAM_INTERRUPTED' })

    expect(onCompletion).not.toHaveBeenCalled()
  })

  it('propagates cancellation without publishing completion telemetry', async () => {
    const signalController = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([], false)))
    const onCompletion = vi.fn()
    const ends: ModelRequestEvent[] = []
    const pending = new OpenAIAdapter('key', 'model', 'http://127.0.0.1:1/v1').stream(
      [{ role: 'user', content: 'ping' }],
      {
        signal: signalController.signal,
        onCompletion,
        requestRetryCount: 0,
        timeoutMs: 5_000,
        requestObserver: { onRequestEnd: (event) => ends.push(event) },
      },
    )

    signalController.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(onCompletion).not.toHaveBeenCalled()
    expect(ends).toMatchObject([{ status: 'cancelled', usage: { input: { value: null, source: 'unknown' } } }])
  })

  it.each([
    ['custom', () => new CustomAdapter('key', 'custom-model', 'http://127.0.0.1:1/v1')],
    ['deepseek', () => new DeepSeekAdapter('key', 'deepseek-model', 'http://127.0.0.1:1/v1')],
    ['kimi', () => new KimiAdapter('key', 'kimi-k2.6', 'http://127.0.0.1:1/v1')],
  ] as const)('keeps the %s compatible subclass string result and request body free of telemetry fields', async (_name, createAdapter) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '兼容正文' }, finish_reason: 'stop' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const text = await createAdapter().chat(
      [{ role: 'user', content: 'ping' }],
      { requestRetryCount: 0 },
    )

    expect(text).toBe('兼容正文')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('stream_options')
    expect(body).not.toHaveProperty('onCompletion')
    expect(body).not.toHaveProperty('telemetry')
  })

  it('does not guess non-OpenAI custom usage fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '正文' }, finish_reason: 'vendor_done' }],
      usage: { input_tokens: 99, output_tokens: 12, cache_tokens: 8 },
    })))
    const completions: CallCompletion[] = []

    await new CustomAdapter('key', 'custom-model', 'http://127.0.0.1:1/v1').chat(
      [{ role: 'user', content: 'ping' }],
      { onCompletion: (completion) => completions.push(completion), requestRetryCount: 0 },
    )

    expect(completions).toEqual([{
      finish: 'unknown',
      rawFinishReason: 'vendor_done',
      usage: {
        input: { value: null, source: 'unknown' },
        output: { value: null, source: 'unknown' },
        cacheRead: { value: null, source: 'unknown' },
        cacheWrite: { value: null, source: 'unknown' },
        reasoning: { value: null, source: 'unknown' },
      },
    }])
  })

  it('records each physical transport retry with a distinct request id', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '重试成功' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const starts: ModelRequestEvent[] = []
    const ends: ModelRequestEvent[] = []

    const text = await new OpenAIAdapter('key', 'model', 'http://127.0.0.1:1/v1').chat(
      [{ role: 'user', content: 'ping' }],
      {
        requestRetryCount: 1,
        requestObserver: {
          onRequestStart: (event) => starts.push(event),
          onRequestEnd: (event) => ends.push(event),
        },
      },
    )

    expect(text).toBe('重试成功')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(starts).toHaveLength(2)
    expect(new Set(starts.map((event) => event.requestId)).size).toBe(2)
    expect(ends.map((event) => event.status)).toEqual(['failed', 'success'])
    expect(ends[1].completion?.usage.output).toEqual({ value: 2, source: 'reported' })
  })

  it('does not repeat the model call when the telemetry sink throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '正文' }, finish_reason: 'stop' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const text = await new OpenAIAdapter('key', 'model', 'http://127.0.0.1:1/v1').chat(
      [{ role: 'user', content: 'ping' }],
      {
        requestRetryCount: 2,
        requestObserver: { onRequestStart: () => { throw new Error('ledger unavailable') } },
      },
    )

    expect(text).toBe('正文')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
