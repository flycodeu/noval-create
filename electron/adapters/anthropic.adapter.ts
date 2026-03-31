import { BaseAdapter, ChatOptions, Message } from './base.adapter'

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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API 请求失败（${response.status}）：${err}`)
    }

    const data = await response.json() as Record<string, any>
    return data.content[0]?.text || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const body = this.buildBody(messages, opts, true)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API 请求失败（${response.status}）：${err}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      const lines = text.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'content_block_delta' && data.delta?.text) {
              opts?.onStream?.(data.delta.text)
            }
          } catch {
            // 跳过
          }
        }
      }
    }
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
