import { BaseAdapter, ChatOptions, Message, normalizeContextWindowTokens } from './base.adapter'
import { buildHttpError, executeManagedRequest } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'

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
  private tokenRefreshPromise: Promise<string> | null = null

  constructor(
    apiKey: string,
    secretKey: string,
    modelId: string = 'ernie-4.0-8k',
    maxContextTokens?: number | null,
    defaultTemperature = 0.8,
    defaultMaxTokens = 8192,
  ) {
    super()
    this.apiKey = apiKey
    this.secretKey = secretKey
    this.modelId = modelId
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 8192)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }

  private async getAccessToken(opts?: Pick<ChatOptions, 'signal' | 'timeoutMs' | 'requestRetryCount'>): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise
    }

    this.tokenRefreshPromise = this.refreshAccessToken(opts)
    try {
      return await this.tokenRefreshPromise
    } finally {
      this.tokenRefreshPromise = null
    }
  }

  private async refreshAccessToken(opts?: Pick<ChatOptions, 'timeoutMs' | 'requestRetryCount'>): Promise<string> {
    const response = await executeManagedRequest({
      provider: this.provider,
      modelId: this.modelId,
      timeoutMs: opts?.timeoutMs,
      requestRetryCount: opts?.requestRetryCount,
      requestLabel: 'baidu.oauth.token',
    }, async (signal) => {
      const result = await fetch(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`,
        { method: 'POST', signal },
      )

      if (!result.ok) {
        const err = await result.text()
        throw buildHttpError(`百度 Token 获取失败（${result.status}）：${err}`, result)
      }

      return result
    })

    const data = await response.json() as Record<string, any>
    if (!data.access_token) {
      throw new Error(`百度 Token 获取失败：${data.error_description || data.error || '未返回 access_token'}`)
    }
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken!
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const token = await this.getAccessToken(opts)
    const endpoint = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.modelId}?access_token=${token}`

    const body: Record<string, unknown> = {
      messages: messages.filter(m => m.role !== 'system'),
      temperature: this.resolveTemperature(opts),
      max_output_tokens: this.resolveMaxTokens(opts),
    }

    if (opts?.systemPrompt) {
      body.system = opts.systemPrompt
    }

    const response = await this.requestChat(endpoint, body, opts, false)

    const data = await response.json() as Record<string, any>
    if (data.error_code) {
      throw new Error(`百度文心错误: ${data.error_msg}`)
    }

    return data.result || ''
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const token = await this.getAccessToken(opts)
    const endpoint = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.modelId}?access_token=${token}`

    const body: Record<string, unknown> = {
      messages: messages.filter(m => m.role !== 'system'),
      temperature: this.resolveTemperature(opts),
      max_output_tokens: this.resolveMaxTokens(opts),
      stream: true,
    }

    if (opts?.systemPrompt) {
      body.system = opts.systemPrompt
    }

    const response = await this.requestChat(endpoint, body, opts, true)

    await consumeSseStream(response, async ({ data, event }) => {
      const parsed = safeParseSseJson<Record<string, any>>(this.provider, data, event)
      if (parsed?.result) {
        opts?.onStream?.(parsed.result)
      }
    })
  }

  private async requestChat(
    endpoint: string,
    body: Record<string, unknown>,
    opts: ChatOptions | undefined,
    stream: boolean,
  ): Promise<Response> {
    return executeManagedRequest({
      provider: this.provider,
      modelId: this.modelId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      requestRetryCount: opts?.requestRetryCount,
      requestLabel: stream ? 'baidu.chat.stream' : 'baidu.chat',
    }, async (signal) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const err = await response.text()
        throw buildHttpError(`百度文心 API 请求失败（${response.status}）：${err}`, response)
      }

      return response
    })
  }
}
