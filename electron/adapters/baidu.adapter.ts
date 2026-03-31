import { BaseAdapter, ChatOptions, Message } from './base.adapter'

export class BaiduAdapter extends BaseAdapter {
  id = 'baidu'
  name = '百度文心'
  provider = 'baidu'
  maxContextTokens = 8192

  private apiKey: string
  private secretKey: string
  private modelId: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(apiKey: string, secretKey: string, modelId: string = 'ernie-4.0-8k') {
    super()
    this.apiKey = apiKey
    this.secretKey = secretKey
    this.modelId = modelId
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    const response = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`,
      { method: 'POST' }
    )

    if (!response.ok) {
      throw new Error('百度 Token 获取失败')
    }

    const data = await response.json() as Record<string, any>
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken!
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const token = await this.getAccessToken()
    const endpoint = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.modelId}?access_token=${token}`

    const body: Record<string, unknown> = {
      messages: messages.filter(m => m.role !== 'system'),
      temperature: opts?.temperature ?? 0.85,
    }

    if (opts?.systemPrompt) {
      body.system = opts.systemPrompt
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`百度文心 API 请求失败（${response.status}）：${err}`)
    }

    const data = await response.json() as Record<string, any>
    if (data.error_code) {
      throw new Error(`百度文心错误: ${data.error_msg}`)
    }

    return data.result || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const token = await this.getAccessToken()
    const endpoint = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.modelId}?access_token=${token}`

    const body: Record<string, unknown> = {
      messages: messages.filter(m => m.role !== 'system'),
      temperature: opts?.temperature ?? 0.85,
      stream: true,
    }

    if (opts?.systemPrompt) {
      body.system = opts.systemPrompt
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    })

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
          if (data.result) {
            opts?.onStream?.(data.result)
          }
        } catch {
          // 跳过
        }
      }
    }
  }
}
