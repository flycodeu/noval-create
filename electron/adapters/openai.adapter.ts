import { BaseAdapter, ChatOptions, type EmbeddingOptions, Message, normalizeContextWindowTokens } from './base.adapter'
import { buildHttpError, buildIncompleteStreamError, executeManagedRequest, type ManagedRequestResult } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'
import { normalizeCallCompletion, normalizeOpenAIUsage } from '../../src/shared/model-call-telemetry'

export class OpenAIAdapter extends BaseAdapter {
  id = 'openai'
  name = 'OpenAI'
  provider = 'openai'
  maxContextTokens = 128000

  private apiKey: string
  private baseUrl: string
  private modelId: string

  constructor(
    apiKey: string,
    modelId: string = 'gpt-4o',
    baseUrl?: string,
    maxContextTokens?: number | null,
    defaultTemperature = 0.8,
    defaultMaxTokens = 8192,
  ) {
    super()
    this.apiKey = apiKey
    this.modelId = modelId
    this.baseUrl = baseUrl || 'https://api.openai.com/v1'
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 128000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const body = this.buildBody(messages, opts, false)
    const request = await this.requestChatCompletions(body, opts, 'chat')

    try {
      const data = await request.value.json() as Record<string, any>
      const choice = data.choices?.[0]
      const content = choice?.message?.content ?? choice?.delta?.content
      const completion = normalizeCallCompletion(normalizeOpenAIUsage(data.usage), choice?.finish_reason)
      request.succeed(completion)
      opts?.onCompletion?.(completion)
      return typeof content === 'string' ? content : ''
    } catch (error) {
      request.fail(error)
      throw error
    }
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const body = this.buildBody(messages, opts, true)
    const request = await this.requestChatCompletions(body, opts, 'stream')
    let latestUsage: unknown
    let hasUsage = false
    let rawFinishReason: unknown
    let sawDone = false
    try {
      await consumeSseStream(request.value, async ({ data, event }) => {
        if (data === '[DONE]') {
          sawDone = true
          return
        }

        const parsed = safeParseSseJson<Record<string, any>>(this.provider, data, event)
        if (!parsed) return
        if (parsed.usage && typeof parsed.usage === 'object') {
          latestUsage = parsed.usage
          hasUsage = true
        }
        const choice = parsed.choices?.[0]
        if (typeof choice?.finish_reason === 'string') rawFinishReason = choice.finish_reason
        const chunk = choice?.delta?.content
        if (typeof chunk === 'string' && chunk && opts?.onStream) {
          opts.onStream(chunk)
        }
      }, { signal: opts?.signal, timeoutMs: opts?.timeoutMs })
      const completion = normalizeCallCompletion(normalizeOpenAIUsage(latestUsage), rawFinishReason)
      if (!sawDone) throw buildIncompleteStreamError(this.provider)
      request.succeed(completion)
      opts?.onCompletion?.(completion)
    } catch (error) {
      const partialCompletion = hasUsage || typeof rawFinishReason === 'string'
        ? normalizeCallCompletion(normalizeOpenAIUsage(latestUsage), rawFinishReason)
        : null
      request.fail(error, partialCompletion)
      throw error
    }
  }

  private async requestChatCompletions(
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
      requestLabel: 'openai.chat.completions',
    }, async (signal) => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const err = await response.text()
        throw buildHttpError(`OpenAI API 请求失败（${response.status}）：${err}`, response)
      }

      return response
    })
  }

  private buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    }
  }

  protected getCompletionTokensFieldName(): 'max_tokens' | 'max_completion_tokens' {
    return 'max_tokens'
  }

  protected shouldIncludeTemperature(_opts?: ChatOptions): boolean {
    return true
  }

  protected buildBody(messages: Message[], opts?: ChatOptions, stream = false) {
    const msgs = opts?.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
      : messages

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: msgs,
      stream,
      stop: opts?.stopSequences,
    }
    if (this.shouldIncludeTemperature(opts)) {
      body.temperature = this.resolveTemperature(opts)
    }
    body[this.getCompletionTokensFieldName()] = this.resolveMaxTokens(opts)
    return body
  }

  async embed(texts: string[], opts?: EmbeddingOptions): Promise<number[][]> {
    const embeddingModel = opts?.model || 'text-embedding-3-small'
    const request = await executeManagedRequest({
      provider: this.provider,
      modelId: embeddingModel,
      kind: 'embedding',
      requestObserver: this.resolveRequestObserver(opts?.requestObserver),
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      requestRetryCount: opts?.requestRetryCount,
      requestLabel: 'openai.embeddings',
    }, async (signal) => {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ model: embeddingModel, input: texts }),
        signal,
      })
      if (!response.ok) {
        const err = await response.text()
        throw buildHttpError(`OpenAI Embedding API 请求失败（${response.status}）：${err}`, response)
      }
      return response
    })

    try {
      const data = await request.value.json() as { data: Array<{ embedding: number[] }>; usage?: unknown }
      const embeddings = data.data.map((item) => item.embedding)
      request.succeed(normalizeCallCompletion(normalizeOpenAIUsage(data.usage), null))
      return embeddings
    } catch (error) {
      request.fail(error)
      throw error
    }
  }
}
