import { BaseAdapter, ChatOptions, Message, normalizeContextWindowTokens } from './base.adapter'
import { buildHttpError, executeManagedRequest } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'

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
    const response = await this.requestChatCompletions(body, opts)

    const data = await response.json() as Record<string, any>
    return data.choices[0]?.message?.content || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const body = this.buildBody(messages, opts, true)
    const response = await this.requestChatCompletions(body, opts)
    await consumeSseStream(response, async ({ data, event }) => {
      if (data === '[DONE]') return

      const parsed = safeParseSseJson<Record<string, any>>(this.provider, data, event)
      const chunk = parsed?.choices?.[0]?.delta?.content
      if (chunk && opts?.onStream) {
        opts.onStream(chunk)
      }
    })
  }

  private async requestChatCompletions(body: Record<string, unknown>, opts?: ChatOptions): Promise<Response> {
    return executeManagedRequest({
      provider: this.provider,
      modelId: this.modelId,
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

  private buildBody(messages: Message[], opts?: ChatOptions, stream = false) {
    const msgs = opts?.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
      : messages

    return {
      model: this.modelId,
      messages: msgs,
      temperature: this.resolveTemperature(opts),
      max_tokens: this.resolveMaxTokens(opts),
      stream,
      stop: opts?.stopSequences,
    }
  }

  async embed(texts: string[], opts?: { model?: string }): Promise<number[][]> {
    const embeddingModel = opts?.model || 'text-embedding-3-small'
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: embeddingModel,
        input: texts,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw buildHttpError(`OpenAI Embedding API 请求失败（${response.status}）：${err}`, response)
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    return data.data.map((d) => d.embedding)
  }
}
