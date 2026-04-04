import { logWarn } from '../utils/runtime-log'

export interface SseEvent {
  event?: string
  data: string
  id?: string
}

export async function consumeSseStream(
  response: Response,
  onEvent: (event: SseEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.body) {
    throw new Error('流式响应缺少可读取的消息体。')
  }

  const reader = response.body.getReader()
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
    const { done, value } = await reader.read()
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
