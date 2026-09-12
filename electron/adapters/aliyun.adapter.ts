import { BaseAdapter, ChatOptions, Message, normalizeContextWindowTokens } from './base.adapter'
import { buildHttpError, buildIncompleteStreamError, executeManagedRequest, type ManagedRequestResult } from './request-support'
import { consumeSseStream, safeParseSseJson } from './sse'
import { normalizeAliyunCompletion } from '../../src/shared/model-call-telemetry'

export class AliyunAdapter extends BaseAdapter {
  id = 'aliyun'
  name = '阿里通义'
  provider = 'aliyun'
  maxContextTokens = 32000

  private apiKey: string
  private modelId: string

  constructor(
    apiKey: string,
    modelId: string = 'qwen-max',
    maxContextTokens?: number | null,
    defaultTemperature = 0.85,
    defaultMaxTokens = 8192,
  ) {
    super()
    this.apiKey = apiKey
    this.modelId = modelId
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 32000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }

  async chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    const request = await this.requestGeneration(this.buildBody(messages, opts), opts, false)

    try {
      const data = await request.value.json() as Record<string, any>
      if (data.code) throw new Error(`通义错误: ${data.message}`)
      const result = data.output?.text || data.output?.choices?.[0]?.message?.content || ''
      const completion = normalizeAliyunCompletion(data)
      request.succeed(completion)
      opts?.onCompletion?.(completion)
      return result
    } catch (error) {
      request.fail(error)
      throw error
    }
  }

  async stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    const request = await this.requestGeneration(this.buildBody(messages, opts, true), opts, true)
    let previousContent = ''
    let latestUsage: unknown
    let latestOutput: unknown

    try {
      await consumeSseStream(request.value, async ({ data, event }) => {
        const parsed = safeParseSseJson<Record<string, any>>(this.provider, data, event)
        if (parsed?.code) throw new Error(`通义错误: ${parsed.message}`)
        if (parsed?.usage) latestUsage = parsed.usage
        if (parsed?.output) latestOutput = parsed.output
        const fullContent = parsed?.output?.choices?.[0]?.message?.content || parsed?.output?.text || ''
        const delta = extractAccumulatedDelta(previousContent, fullContent)
        if (delta) {
          previousContent = fullContent
          opts?.onStream?.(delta)
        } else if (fullContent.length > previousContent.length) {
          previousContent = fullContent
        }
      }, { signal: opts?.signal, timeoutMs: opts?.timeoutMs })
      const completion = normalizeAliyunCompletion({ usage: latestUsage, output: latestOutput })
      if (!completion.rawFinishReason || completion.rawFinishReason === 'null') throw buildIncompleteStreamError(this.provider)
      request.succeed(completion)
      opts?.onCompletion?.(completion)
    } catch (error) {
      request.fail(error, normalizeAliyunCompletion({ usage: latestUsage, output: latestOutput }))
      throw error
    }
  }

  private async requestGeneration(
    body: Record<string, unknown>,
    opts: ChatOptions | undefined,
    stream: boolean,
  ): Promise<ManagedRequestResult<Response>> {
    return executeManagedRequest({
      provider: this.provider,
      modelId: this.modelId,
      kind: stream ? 'stream' : 'chat',
      requestObserver: this.resolveRequestObserver(opts?.requestObserver),
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      requestRetryCount: opts?.requestRetryCount,
      requestLabel: stream ? 'aliyun.generation.stream' : 'aliyun.generation.chat',
    }, async (signal) => {
      const response = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        {
          method: 'POST',
          headers: stream
            ? { ...this.buildHeaders(), 'X-DashScope-SSE': 'enable' }
            : this.buildHeaders(),
          body: JSON.stringify(body),
          signal,
        },
      )

      if (!response.ok) {
        const err = await response.text()
        throw buildHttpError(`通义千问 API 请求失败（${response.status}）：${err}`, response)
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
        temperature: this.resolveTemperature(opts),
        max_tokens: this.resolveMaxTokens(opts),
        result_format: 'message',
      },
      stream,
    }
  }
}

function extractAccumulatedDelta(previousContent: string, fullContent: string): string {
  if (!fullContent) return ''
  if (!previousContent) return fullContent
  if (fullContent === previousContent) return ''
  if (fullContent.startsWith(previousContent)) {
    return fullContent.slice(previousContent.length)
  }
  return fullContent
}
