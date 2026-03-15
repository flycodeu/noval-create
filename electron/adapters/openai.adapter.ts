import { BaseAdapter, ChatOptions, Message } from './base.adapter'

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
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API Error ${response.status}: ${err}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const body = this.buildBody(messages, opts, true)
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API Error ${response.status}: ${err}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      const lines = text.split('\n').filter(l => l.startsWith('data: '))

      for (const line of lines) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          const chunk = parsed.choices[0]?.delta?.content
          if (chunk && opts?.onStream) {
            opts.onStream(chunk)
          }
        } catch {
          // 跳过解析错误
        }
      }
    }
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
