export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  stopSequences?: string[]
  onStream?: (chunk: string) => void
  signal?: AbortSignal
}

export abstract class BaseAdapter {
  abstract id: string
  abstract name: string
  abstract provider: string
  abstract maxContextTokens: number

  abstract chat(messages: Message[], opts?: ChatOptions): Promise<string>
  abstract stream(messages: Message[], opts?: ChatOptions): Promise<void>

  countTokens(text: string): number {
    return Math.ceil(text.length / 1.5)
  }

  protected buildSystemMessage(systemPrompt: string): Message {
    return { role: 'system', content: systemPrompt }
  }
}
