import { BaseAdapter, ChatOptions, Message } from './base.adapter'

export class AliyunAdapter extends BaseAdapter {
  id = 'aliyun'
  name = '阿里通义'
  provider = 'aliyun'
  maxContextTokens = 32000

  private apiKey: string
  private modelId: string

  constructor(apiKey: string, modelId: string = 'qwen-max') {
    super()
    this.apiKey = apiKey
    this.modelId = modelId
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const response = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, opts)),
        signal: opts?.signal,
      }
    )

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`通义千问 API 请求失败（${response.status}）：${err}`)
    }

    const data = await response.json() as Record<string, any>
    if (data.code) {
      throw new Error(`通义错误: ${data.message}`)
    }

    return data.output?.text || data.output?.choices?.[0]?.message?.content || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const response = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        method: 'POST',
        headers: { ...this.buildHeaders(), 'X-DashScope-SSE': 'enable' },
        body: JSON.stringify({ ...this.buildBody(messages, opts), stream: true }),
        signal: opts?.signal,
      }
    )

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      const lines = text.split('\n').filter(l => l.startsWith('data:'))

      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(5))
          const content = data.output?.choices?.[0]?.message?.content || data.output?.text
          if (content) {
            opts?.onStream?.(content)
          }
        } catch {
          // 跳过
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

  private buildBody(messages: Message[], opts?: ChatOptions) {
    const systemMsg = opts?.systemPrompt || messages.find(m => m.role === 'system')?.content
    const userMessages = messages.filter(m => m.role !== 'system')

    return {
      model: this.modelId,
      input: {
        messages: systemMsg
          ? [{ role: 'system', content: systemMsg }, ...userMessages]
          : userMessages,
      },
      parameters: {
        temperature: opts?.temperature ?? 0.85,
        max_tokens: opts?.maxTokens ?? 4096,
        result_format: 'message',
      },
    }
  }
}
