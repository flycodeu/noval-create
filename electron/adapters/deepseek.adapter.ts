import { OpenAIAdapter } from './openai.adapter'

import { normalizeContextWindowTokens, type ChatOptions, type Message } from './base.adapter'
import { DEEPSEEK_V4_MAX_OUTPUT_TOKENS } from '../../src/shared/model-token-limits'
import { resolveManagedRequestTimeoutMs } from './request-support'

export class DeepSeekAdapter extends OpenAIAdapter {
  constructor(
    apiKey: string,
    modelId: string = 'deepseek-v4-flash',
    baseUrl: string = 'https://api.deepseek.com',
    maxContextTokens?: number | null,
    defaultTemperature = 0.7,
    defaultMaxTokens = DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  ) {
    super(apiKey, modelId, baseUrl, maxContextTokens, defaultTemperature, defaultMaxTokens)
    this.id = 'deepseek'
    this.name = 'DeepSeek'
    this.provider = 'deepseek'
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 1_000_000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }

  override chat(messages: Message[], opts?: ChatOptions): Promise<string> {
    return super.chat(messages, this.withGenerationTimeout(opts))
  }

  override stream(messages: Message[], opts?: ChatOptions): Promise<void> {
    return super.stream(messages, this.withGenerationTimeout(opts))
  }

  protected override buildBody(messages: Message[], opts?: ChatOptions, stream = false) {
    const body = super.buildBody(messages, opts, stream)
    const effort = opts?.providerOptions?.deepseekReasoningEffort || 'low'
    body.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' }
    if (effort !== 'none') body.reasoning_effort = effort
    return body
  }

  private withGenerationTimeout(opts?: ChatOptions): ChatOptions {
    return { ...opts, timeoutMs: resolveManagedRequestTimeoutMs(opts?.timeoutMs, 300_000) }
  }
}
