import { OpenAIAdapter } from './openai.adapter'

import { normalizeContextWindowTokens } from './base.adapter'

export class DeepSeekAdapter extends OpenAIAdapter {
  constructor(
    apiKey: string,
    modelId: string = 'deepseek-chat',
    maxContextTokens?: number | null,
    defaultTemperature = 0.7,
    defaultMaxTokens = 8192,
  ) {
    super(apiKey, modelId, 'https://api.deepseek.com/v1', maxContextTokens, defaultTemperature, defaultMaxTokens)
    this.id = 'deepseek'
    this.name = 'DeepSeek'
    this.provider = 'deepseek'
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 64000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }
}
