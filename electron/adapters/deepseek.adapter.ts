import { OpenAIAdapter } from './openai.adapter'

export class DeepSeekAdapter extends OpenAIAdapter {
  constructor(apiKey: string, modelId: string = 'deepseek-chat') {
    super(apiKey, modelId, 'https://api.deepseek.com/v1')
    this.id = 'deepseek'
    this.name = 'DeepSeek'
    this.provider = 'deepseek'
    this.maxContextTokens = 64000
  }
}
