import { OpenAIAdapter } from './openai.adapter'

import { normalizeContextWindowTokens } from './base.adapter'

export class DeepSeekAdapter extends OpenAIAdapter {
  constructor(
    apiKey: string,
    modelId: string = 'deepseek-v4-flash',
    maxContextTokens?: number | null,
    defaultTemperature = 0.7,
    defaultMaxTokens = 384000,
  ) {
    super(apiKey, modelId, 'https://api.deepseek.com', maxContextTokens, defaultTemperature, defaultMaxTokens)
    this.id = 'deepseek'
    this.name = 'DeepSeek'
    this.provider = 'deepseek'
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 1_000_000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }
}
