import { logWarn } from '../utils/runtime-log'
import { buildRequestTimeoutError, resolveManagedRequestTimeoutMs } from './request-support'

export interface SseEvent {
  event?: string
  data: string
  id?: string
}

export interface ConsumeSseStreamOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

function buildSseAbortError(): Error {
  const error = new Error('用户已取消')
  error.name = 'AbortError'
  return error
}

export async function consumeSseStream(
  response: Response,
  onEvent: (event: SseEvent) => void | Promise<void>,
  options: ConsumeSseStreamOptions = {},
): Promise<void> {
  if (!response.body) {
    throw new Error('流式响应缺少可读取的消息体。')
  }

  const reader = response.body.getReader()
  const timeoutMs = resolveManagedRequestTimeoutMs(options.timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  let timeoutError: Error | undefined
  let rejectAbort: ((error: Error) => void) | undefined
  const abortPromise = options.signal
    ? new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    : null
  const onAbort = () => {
    if (timeoutError) return
    void reader.cancel().catch(() => undefined)
    rejectAbort?.(buildSseAbortError())
  }

  if (options.signal?.aborted) throw buildSseAbortError()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutError = buildRequestTimeoutError(timeoutMs)
      void reader.cancel().catch(() => undefined)
      reject(timeoutError)
    }, timeoutMs)
  })
  try {
    const decoder = new TextDecoder()
    let buffer = ''
    let eventLines: string[] = []

    const dispatchEvent = async () => {
      if (eventLines.length === 0) return

      const dataLines: string[] = []
      let event: string | undefined
      let id: string | undefined

      for (const rawLine of eventLines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (!line || line.startsWith(':')) continue

        const separatorIndex = line.indexOf(':')
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
        let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : ''
        if (value.startsWith(' ')) value = value.slice(1)

        if (field === 'data') dataLines.push(value)
        else if (field === 'event') event = value
        else if (field === 'id') id = value
      }

      eventLines = []
      if (dataLines.length === 0) return

      await onEvent({
        event,
        data: dataLines.join('\n'),
        id,
      })
    }

    while (true) {
      const readPromise = reader.read()
      const readResult = await Promise.race([
        readPromise,
        timeoutPromise,
        ...(abortPromise ? [abortPromise] : []),
      ]) as Awaited<typeof readPromise>
      if (timeoutError) throw timeoutError
      if (options.signal?.aborted) throw buildSseAbortError()
      const { done, value } = readResult
      buffer += decoder.decode(value, { stream: !done })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)

        if (line === '' || line === '\r') {
          await dispatchEvent()
        } else {
          eventLines.push(line)
        }

        newlineIndex = buffer.indexOf('\n')
      }

      if (done) break
    }

    if (buffer.length > 0) {
      eventLines.push(buffer)
    }
    await dispatchEvent()
  } finally {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export function safeParseSseJson<T>(
  provider: string,
  payload: string,
  eventType?: string,
): T | null {
  try {
    return JSON.parse(payload) as T
  } catch (error) {
    logWarn('model', '流式 SSE 负载解析失败，已跳过无效事件。', {
      consoleSummary: `[model:warn] provider=${provider} invalid-sse-payload`,
      context: {
        provider,
        eventType: eventType || 'message',
        payloadPreview: payload.slice(0, 240),
        payloadLength: payload.length,
      },
      error,
    })
    return null
  }
}
