import { OpenAIAdapter } from './openai.adapter'

export class CustomAdapter extends OpenAIAdapter {
  constructor(apiKey: string, modelId: string, baseUrl: string) {
    super(apiKey, modelId, baseUrl)
    this.id = 'custom'
    this.name = '自定义模型'
    this.provider = 'custom'
    this.maxContextTokens = 32000
  }
}
