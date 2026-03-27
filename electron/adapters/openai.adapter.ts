import { BaseAdapter, ChatOptions, Message } from './base.adapter'
import { logError, logWarn } from '../utils/runtime-log'

type ErrorLike = Error & {
  code?: string
  cause?: unknown
}

interface ManagedRequestSignal {
  signal: AbortSignal
  cleanup: () => void
  didTimeout: () => boolean
  didExternalAbort: () => boolean
}

const DEFAULT_REQUEST_TIMEOUT_MS = 90_000
const DEFAULT_REQUEST_RETRY_COUNT = 2
const MAX_REQUEST_RETRY_COUNT = 5
const RETRY_BASE_DELAY_MS = 1_000
const RETRY_MAX_DELAY_MS = 4_000
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'REQUEST_TIMEOUT',
])

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

  private async requestChatCompletions(body: Record<string, unknown>, opts?: ChatOptions): Promise<Response> {
    const retryLimit = this.clampRetryCount(opts?.requestRetryCount)
    let lastError: unknown

    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      try {
        return await this.performChatCompletionRequest(body, opts)
      } catch (error) {
        if (!this.isRetryableNetworkError(error)) throw error
        lastError = error

        if (attempt >= retryLimit) break

        logWarn('model', '模型请求网络异常，准备重试。', {
          consoleSummary: `[model:warn] provider=${this.provider} retry=${attempt + 1}/${retryLimit + 1}`,
          context: {
            provider: this.provider,
            modelId: this.modelId,
            attempt: attempt + 1,
            maxAttempts: retryLimit + 1,
            detail: this.describeNetworkError(error),
          },
          error,
        })
        await this.delay(this.getRetryDelayMs(attempt))
      }
    }

    logError('model', '模型请求在自动重试后仍失败。', {
      consoleSummary: `[model:error] provider=${this.provider} retries-exhausted attempts=${retryLimit + 1}`,
      context: {
        provider: this.provider,
        modelId: this.modelId,
        attempts: retryLimit + 1,
        detail: this.describeNetworkError(lastError),
      },
      error: lastError,
    })
    throw this.buildRetryExhaustedError(lastError, retryLimit + 1)
  }

  private async performChatCompletionRequest(body: Record<string, unknown>, opts?: ChatOptions): Promise<Response> {
    const timeoutMs = this.resolveTimeoutMs(opts?.timeoutMs)
    const managedSignal = this.createManagedSignal(opts?.signal, timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: managedSignal.signal,
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`OpenAI API Error ${response.status}: ${err}`)
      }

      return response
    } catch (error) {
      if (managedSignal.didExternalAbort()) throw this.buildAbortError()
      if (managedSignal.didTimeout()) throw this.buildError(`模型请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`, 'REQUEST_TIMEOUT', error)
      throw error
    } finally {
      managedSignal.cleanup()
    }
  }

  private createManagedSignal(externalSignal: AbortSignal | undefined, timeoutMs: number): ManagedRequestSignal {
    const controller = new AbortController()
    let timedOut = false
    let externalAbort = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const onExternalAbort = () => {
      externalAbort = true
      if (!controller.signal.aborted) controller.abort()
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        externalAbort = true
        controller.abort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        if (!controller.signal.aborted) controller.abort()
      }, timeoutMs)
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        if (timer) clearTimeout(timer)
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
      },
      didTimeout: () => timedOut,
      didExternalAbort: () => externalAbort,
    }
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (this.isAbortError(error)) return false

    const details = this.collectErrorDetails(error)
    if (details.codes.some((code) => RETRYABLE_NETWORK_ERROR_CODES.has(code))) return true

    const combinedText = [...details.messages, ...details.names].join(' ').toLowerCase()
    return [
      'fetch failed',
      'terminated',
      'other side closed',
      'socket',
      'connection reset',
      'network error',
      'network connection',
      'read econnreset',
    ].some((pattern) => combinedText.includes(pattern))
  }

  private describeNetworkError(error: unknown): string {
    const details = this.collectErrorDetails(error)
    const code = details.codes[0] || ''
    const combinedText = [...details.messages, ...details.names].join(' ').toLowerCase()

    if (code === 'ECONNRESET' || combinedText.includes('econnreset')) return '连接被远端重置（ECONNRESET）'
    if (code === 'UND_ERR_SOCKET' || combinedText.includes('other side closed')) return '连接被对端中断（UND_ERR_SOCKET）'
    if (code === 'REQUEST_TIMEOUT' || code === 'ETIMEDOUT' || combinedText.includes('timed out')) return '请求超时'
    if (combinedText.includes('terminated')) return '连接在响应过程中被中断'
    if (combinedText.includes('fetch failed')) return code ? `网络请求失败（${code}）` : '网络请求失败'

    const firstMessage = details.messages.find(Boolean)
    if (firstMessage) return code && !firstMessage.includes(code) ? `${firstMessage}（${code}）` : firstMessage
    return code ? `网络异常（${code}）` : '网络异常'
  }

  private buildRetryExhaustedError(error: unknown, attempts: number): Error {
    return this.buildError(
      `模型服务连接不稳定，已自动重试 ${attempts} 次仍失败：${this.describeNetworkError(error)}。请稍后重试。`,
      undefined,
      error,
    )
  }

  private collectErrorDetails(error: unknown, seen = new Set<unknown>()): { codes: string[]; messages: string[]; names: string[] } {
    if (!error || seen.has(error)) return { codes: [], messages: [], names: [] }
    seen.add(error)

    if (!(error instanceof Error)) return { codes: [], messages: [], names: [] }

    const typed = error as ErrorLike
    const nested = typed.cause ? this.collectErrorDetails(typed.cause, seen) : { codes: [], messages: [], names: [] }

    return {
      codes: [typed.code || '', ...nested.codes].filter(Boolean),
      messages: [typed.message || '', ...nested.messages].filter(Boolean),
      names: [typed.name || '', ...nested.names].filter(Boolean),
    }
  }

  private buildAbortError(): Error {
    const error = new Error('User cancelled')
    error.name = 'AbortError'
    return error
  }

  private buildError(message: string, code?: string, cause?: unknown): Error {
    const error = new Error(message) as ErrorLike
    if (code) error.code = code
    if (cause !== undefined) error.cause = cause
    return error
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error
      && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
  }

  private resolveTimeoutMs(timeoutMs?: number): number {
    const value = typeof timeoutMs === 'number' ? Math.round(timeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS
    return Math.max(5_000, Math.min(300_000, value))
  }

  private clampRetryCount(retryCount?: number): number {
    const value = typeof retryCount === 'number' ? Math.round(retryCount) : DEFAULT_REQUEST_RETRY_COUNT
    return Math.max(0, Math.min(MAX_REQUEST_RETRY_COUNT, value))
  }

  private getRetryDelayMs(attempt: number): number {
    return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** attempt))
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
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
