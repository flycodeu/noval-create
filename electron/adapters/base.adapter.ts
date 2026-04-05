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
  timeoutMs?: number
  requestRetryCount?: number
}

export function normalizeContextWindowTokens(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? Math.round(value) : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(2048, Math.min(2_000_000, numeric))
}

export abstract class BaseAdapter {
  abstract id: string
  abstract name: string
  abstract provider: string
  abstract maxContextTokens: number
  defaultTemperature = 0.85
  defaultMaxTokens = 4096

  abstract chat(messages: Message[], opts?: ChatOptions): Promise<string>
  abstract stream(messages: Message[], opts?: ChatOptions): Promise<void>

  async embed?(texts: string[], opts?: { model?: string }): Promise<number[][]>

  countTokens(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
    const punctuation = (text.match(/[\u3000-\u303f\uff00-\uffef，。！？；：、""''（）【】《》…—\s]/g) || []).length
    const asciiChars = text.length - chineseChars - punctuation
    const rawEstimate = chineseChars * 1.0 + asciiChars * 0.25 + punctuation * 0.5
    return Math.ceil(rawEstimate * 1.1)
  }

  protected buildSystemMessage(systemPrompt: string): Message {
    return { role: 'system', content: systemPrompt }
  }

  protected resolveTemperature(opts?: ChatOptions): number {
    return typeof opts?.temperature === 'number' ? opts.temperature : this.defaultTemperature
  }

  protected resolveMaxTokens(opts?: ChatOptions): number {
    return typeof opts?.maxTokens === 'number' ? opts.maxTokens : this.defaultMaxTokens
  }
}
