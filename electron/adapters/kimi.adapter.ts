import { ChatOptions, normalizeContextWindowTokens } from './base.adapter'
import { OpenAIAdapter } from './openai.adapter'

function resolveKimiContextWindow(modelId: string, value?: number | null): number {
  const normalizedModelId = modelId.trim().toLowerCase()
  const fixedWindow = normalizedModelId === 'kimi-k2.6' || normalizedModelId === 'kimi-k2.5'
    ? 256000
    : normalizedModelId === 'moonshot-v1-8k'
      ? 8000
      : normalizedModelId === 'moonshot-v1-32k'
        ? 32000
        : normalizedModelId === 'moonshot-v1-128k'
          ? 128000
          : null
  const fallback = fixedWindow || 128000
  const normalized = normalizeContextWindowTokens(value, fallback)
  return fixedWindow ? Math.min(normalized, fixedWindow) : normalized
}

function isFixedTemperatureKimiModel(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLowerCase()
  return normalizedModelId === 'kimi-k2.6' || normalizedModelId === 'kimi-k2.5'
}

export class KimiAdapter extends OpenAIAdapter {
  private readonly kimiModelId: string

  constructor(
    apiKey: string,
    modelId: string = 'kimi-k2.6',
    baseUrl: string = 'https://api.moonshot.ai/v1',
    maxContextTokens?: number | null,
    defaultTemperature = 0.75,
    defaultMaxTokens = 65536,
  ) {
    super(apiKey, modelId, baseUrl, resolveKimiContextWindow(modelId, maxContextTokens), defaultTemperature, defaultMaxTokens)
    this.kimiModelId = modelId
    this.id = 'kimi'
    this.name = 'Kimi / Moonshot'
    this.provider = 'kimi'
    this.maxContextTokens = resolveKimiContextWindow(modelId, maxContextTokens)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
    this.embed = undefined as unknown as OpenAIAdapter['embed']
  }

  protected getCompletionTokensFieldName(): 'max_completion_tokens' {
    return 'max_completion_tokens'
  }

  protected shouldIncludeTemperature(): boolean {
    return !isFixedTemperatureKimiModel(this.kimiModelId)
  }

  protected override buildBody(messages: Parameters<OpenAIAdapter['chat']>[0], opts?: ChatOptions, stream = false) {
    const body = super.buildBody(messages, opts, stream)
    const thinkingMode = opts?.providerOptions?.kimiThinking === 'enabled' ? 'enabled' : 'disabled'
    body.thinking = { type: thinkingMode }
    return body
  }
}
