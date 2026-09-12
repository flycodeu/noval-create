import { BaseAdapter, ChatOptions, Message, normalizeContextWindowTokens } from './base.adapter'
import { buildHttpError, buildIncompleteStreamError, executeManagedRequest, type ManagedRequestResult } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'
import { normalizeAnthropicUsage, normalizeCallCompletion } from '../../src/shared/model-call-telemetry'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .join('')
}

export class AnthropicAdapter extends BaseAdapter {
  id = 'anthropic'
  name = 'Anthropic Claude'
  provider = 'anthropic'
  maxContextTokens = 200000

  private apiKey: string
  private modelId: string

  constructor(
    apiKey: string,
    modelId: string = 'claude-opus-4-6',
    maxContextTokens?: number | null,
    defaultTemperature = 0.75,
    defaultMaxTokens = 8192,
  ) {
    super()
    this.apiKey = apiKey
    this.modelId = modelId
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 200000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const body = this.buildBody(messages, opts, false)
    const request = await this.requestMessages(body, opts, 'chat')

    try {
      const data = await request.value.json() as Record<string, any>
      const content = collectTextBlocks(data.content)
      const completion = normalizeCallCompletion(normalizeAnthropicUsage(data.usage), data.stop_reason)
      request.succeed(completion)
      opts?.onCompletion?.(completion)
      return content
    } catch (error) {
      request.fail(error)
      throw error
    }
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const body = this.buildBody(messages, opts, true)
    const request = await this.requestMessages(body, opts, 'stream')
    const latestUsage: Record<string, unknown> = {}
    let hasUsage = false
    let rawFinishReason: unknown
    let sawMessageStop = false

    try {
      await consumeSseStream(request.value, async ({ data, event }) => {
        const parsed = safeParseSseJson<Record<string, any>>(this.provider, data, event)
        if (!parsed) return

        const eventUsage = parsed.type === 'message_start' ? parsed.message?.usage : parsed.usage
        if (isRecord(eventUsage)) {
          Object.assign(latestUsage, eventUsage)
          hasUsage = true
        }
        const stopReason = parsed.type === 'message_start'
          ? parsed.message?.stop_reason
          : parsed.type === 'message_delta'
            ? parsed.delta?.stop_reason
            : undefined
        if (typeof stopReason === 'string') rawFinishReason = stopReason

        if (parsed.type === 'content_block_start'
          && parsed.content_block?.type === 'text'
          && typeof parsed.content_block.text === 'string'
          && parsed.content_block.text) {
          opts?.onStream?.(parsed.content_block.text)
        } else if (parsed.type === 'content_block_delta'
          && parsed.delta?.type === 'text_delta'
          && typeof parsed.delta.text === 'string'
          && parsed.delta.text) {
          opts?.onStream?.(parsed.delta.text)
        } else if (parsed.type === 'message_stop') {
          sawMessageStop = true
        }
      }, { signal: opts?.signal, timeoutMs: opts?.timeoutMs })
      const completion = normalizeCallCompletion(
        normalizeAnthropicUsage(hasUsage ? latestUsage : undefined),
        rawFinishReason,
      )
      if (!sawMessageStop) throw buildIncompleteStreamError(this.provider)
      request.succeed(completion)
      opts?.onCompletion?.(completion)
    } catch (error) {
      const partialCompletion = hasUsage || typeof rawFinishReason === 'string'
        ? normalizeCallCompletion(normalizeAnthropicUsage(latestUsage), rawFinishReason)
        : null
      request.fail(error, partialCompletion)
      throw error
    }
  }

  private async requestMessages(
    body: Record<string, unknown>,
    opts: ChatOptions | undefined,
    kind: 'chat' | 'stream',
  ): Promise<ManagedRequestResult<Response>> {
    return executeManagedRequest({
      provider: this.provider,
      modelId: this.modelId,
      kind,
      requestObserver: this.resolveRequestObserver(opts?.requestObserver),
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      requestRetryCount: opts?.requestRetryCount,
      requestLabel: 'anthropic.messages',
    }, async (signal) => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const err = await response.text()
        throw buildHttpError(`Anthropic API 请求失败（${response.status}）：${err}`, response)
      }

      return response
    })
  }

  private buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    }
  }

  private buildBody(messages: Message[], opts?: ChatOptions, stream = false) {
    const userMessages = messages.filter(m => m.role !== 'system')

    return {
      model: this.modelId,
      max_tokens: this.resolveMaxTokens(opts),
      temperature: this.resolveTemperature(opts),
      system: opts?.systemPrompt || messages.find(m => m.role === 'system')?.content,
      messages: userMessages,
      stream,
    }
  }
}
