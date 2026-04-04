import { BaseAdapter, ChatOptions, Message } from './base.adapter'
import { executeManagedRequest } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'

export class OpenAIAdapter extends BaseAdapter {
  id = 'openai'
  name = 'OpenAI'
  provider = 'openai'
  maxContextTokens = 128000

  private apiKey: string
  private baseUrl: string
  private modelId: string

  constructor(apiKey: string, modelId: string = 'gpt-4o', baseUrl?: string) {
    super()
    this.apiKey = apiKey
    this.modelId = modelId
    this.baseUrl = baseUrl || 'https://api.openai.com/v1'
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
        throw new Error(`OpenAI API 请求失败（${response.status}）：${err}`)
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
      temperature: opts?.temperature ?? 0.85,
      max_tokens: opts?.maxTokens ?? 4096,
      stream,
      stop: opts?.stopSequences,
    }
  }
}
