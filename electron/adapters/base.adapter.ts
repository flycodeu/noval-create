import type { CallCompletion, ModelRequestObserver } from '../../src/shared/model-call-telemetry'
import { estimateTokens } from '../../src/shared/token-budget'

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
  onCompletion?: (result: CallCompletion) => void
  requestObserver?: ModelRequestObserver
  signal?: AbortSignal
  timeoutMs?: number
  requestRetryCount?: number
  /** Runtime-only budget metadata consumed by task.service; adapters ignore it. */
  requestBudget?: {
    stageBudget?: number | null
    tokenSafetyMarginPct?: number | null
  }
  providerOptions?: {
    kimiThinking?: 'enabled' | 'disabled'
  }
}

export interface EmbeddingOptions {
  model?: string
  signal?: AbortSignal
  timeoutMs?: number
  requestRetryCount?: number
  requestObserver?: ModelRequestObserver
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
  private defaultRequestObserver?: ModelRequestObserver

  setDefaultRequestObserver(observer: ModelRequestObserver): this {
    this.defaultRequestObserver = observer
    return this
  }

  protected resolveRequestObserver(observer?: ModelRequestObserver): ModelRequestObserver | undefined {
    return observer ?? this.defaultRequestObserver
  }

  abstract chat(messages: Message[], opts?: ChatOptions): Promise<string>
  abstract stream(messages: Message[], opts?: ChatOptions): Promise<void>

  async embed?(texts: string[], opts?: EmbeddingOptions): Promise<number[][]>

  countTokens(text: string): number {
    return estimateTokens(text)
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
