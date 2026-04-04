import { BaseAdapter, ChatOptions, Message } from './base.adapter'
import { executeManagedRequest } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'

export class AnthropicAdapter extends BaseAdapter {
  id = 'anthropic'
  name = 'Anthropic Claude'
  provider = 'anthropic'
  maxContextTokens = 200000

  private apiKey: string
  private modelId: string

  constructor(apiKey: string, modelId: string = 'claude-opus-4-6') {
    super()
    this.apiKey = apiKey
    this.modelId = modelId
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const body = this.buildBody(messages, opts, false)
    const response = await this.requestMessages(body, opts)

    const data = await response.json() as Record<string, any>
    return data.content[0]?.text || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const body = this.buildBody(messages, opts, true)
    const response = await this.requestMessages(body, opts)

    await consumeSseStream(response, async ({ data, event }) => {
      const parsed = safeParseSseJson<Record<string, any>>(this.provider, data, event)
      if (parsed?.type === 'content_block_delta' && parsed.delta?.text) {
        opts?.onStream?.(parsed.delta.text)
      }
    })
  }

  private async requestMessages(body: Record<string, unknown>, opts?: ChatOptions): Promise<Response> {
    return executeManagedRequest({
      provider: this.provider,
      modelId: this.modelId,
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
        throw new Error(`Anthropic API 请求失败（${response.status}）：${err}`)
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
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.85,
      system: opts?.systemPrompt || messages.find(m => m.role === 'system')?.content,
      messages: userMessages,
      stream,
    }
  }
}
