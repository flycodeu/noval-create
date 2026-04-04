import { OpenAIAdapter } from './openai.adapter'

import { normalizeContextWindowTokens } from './base.adapter'

export class CustomAdapter extends OpenAIAdapter {
  constructor(
    apiKey: string,
    modelId: string,
    baseUrl: string,
    maxContextTokens?: number | null,
    defaultTemperature = 0.8,
    defaultMaxTokens = 8192,
  ) {
    super(apiKey, modelId, baseUrl, maxContextTokens, defaultTemperature, defaultMaxTokens)
    this.id = 'custom'
    this.name = '自定义模型'
    this.provider = 'custom'
    this.maxContextTokens = normalizeContextWindowTokens(maxContextTokens, 32000)
    this.defaultTemperature = defaultTemperature
    this.defaultMaxTokens = defaultMaxTokens
  }
}
