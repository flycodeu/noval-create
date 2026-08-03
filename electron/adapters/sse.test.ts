import { describe, expect, it } from 'vitest'
import { consumeSseStream } from './sse'

describe('consumeSseStream', () => {
  it('parses complete SSE events from a response body', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"好"}\n\n'))
        controller.close()
      },
    }))
    const events: Array<{ event?: string; data: string }> = []

    await consumeSseStream(response, (event) => {
      events.push({ event: event.event, data: event.data })
    }, { timeoutMs: 5_000 })

    expect(events).toEqual([{ event: 'delta', data: '{"text":"好"}' }])
  })

  it('aborts a body that has already returned headers', async () => {
    const controller = new AbortController()
    const response = new Response(new ReadableStream<Uint8Array>({
      start() {
        // Keep the body pending to exercise the post-header cancellation path.
      },
    }))
    const pending = consumeSseStream(response, () => undefined, {
      signal: controller.signal,
      timeoutMs: 5_000,
    })

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
