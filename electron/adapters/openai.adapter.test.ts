import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIAdapter } from './openai.adapter'

function mockChatResponse(content = 'ok') {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200 })
}

describe('OpenAI-compatible adapter transport', () => {
  const fetchMock = vi.fn()

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('retries a transient request failure before returning the model result', async () => {
    const socketError = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: socketError }))
      .mockResolvedValueOnce(mockChatResponse('重试成功'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new OpenAIAdapter('test-key', 'test-model', 'http://127.0.0.1:1/v1').chat(
      [{ role: 'user', content: 'ping' }],
      { requestRetryCount: 1, timeoutMs: 5_000 },
    )

    expect(result).toBe('重试成功')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
    })
  })

  it('delivers chunks from an OpenAI-compatible SSE response in order', async () => {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"流"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"式"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    fetchMock.mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    const chunks: string[] = []
    await new OpenAIAdapter('test-key', 'test-model', 'http://127.0.0.1:1/v1').stream(
      [{ role: 'user', content: 'ping' }],
      { onStream: (chunk) => chunks.push(chunk), timeoutMs: 5_000 },
    )

    expect(chunks).toEqual(['流', '式'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
