export type TokenValueSource = 'reported' | 'estimated' | 'unknown'

export interface TokenValue {
  value: number | null
  source: TokenValueSource
}

export interface CallUsage {
  input: TokenValue
  output: TokenValue
  cacheRead: TokenValue
  cacheWrite: TokenValue
  reasoning: TokenValue
}

export type CallFinish = 'stop' | 'length' | 'filtered' | 'tool_call' | 'unknown'

export interface CallCompletion {
  finish: CallFinish
  rawFinishReason: string | null
  usage: CallUsage
}

export type ModelRequestKind = 'chat' | 'stream' | 'embedding' | 'auth' | 'cli'
export type ModelRequestStatus = 'started' | 'success' | 'failed' | 'cancelled' | 'interrupted'

export interface ModelRequestEvent {
  requestId: string
  kind: ModelRequestKind
  provider: string
  modelId: string
  status: ModelRequestStatus
  usage: CallUsage
  completion: CallCompletion | null
  errorCode?: string | null
}

export interface ModelRequestObserver {
  onRequestStart?: (event: ModelRequestEvent) => void
  onRequestEnd?: (event: ModelRequestEvent) => void
}

const UNKNOWN_TOKEN: TokenValue = { value: null, source: 'unknown' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function reportedToken(value: unknown): TokenValue {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { value, source: 'reported' }
    : { ...UNKNOWN_TOKEN }
}

function nestedRecord(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = record?.[key]
  return isRecord(value) ? value : null
}

export function createUnknownCallUsage(): CallUsage {
  return {
    input: { ...UNKNOWN_TOKEN },
    output: { ...UNKNOWN_TOKEN },
    cacheRead: { ...UNKNOWN_TOKEN },
    cacheWrite: { ...UNKNOWN_TOKEN },
    reasoning: { ...UNKNOWN_TOKEN },
  }
}

export function normalizeOpenAIUsage(value: unknown): CallUsage {
  if (!isRecord(value)) return createUnknownCallUsage()

  const promptDetails = nestedRecord(value, 'prompt_tokens_details')
  const completionDetails = nestedRecord(value, 'completion_tokens_details')
  return {
    input: reportedToken(value.prompt_tokens),
    output: reportedToken(value.completion_tokens),
    cacheRead: reportedToken(promptDetails?.cached_tokens),
    cacheWrite: { ...UNKNOWN_TOKEN },
    reasoning: reportedToken(completionDetails?.reasoning_tokens),
  }
}

export function normalizeAnthropicUsage(value: unknown): CallUsage {
  if (!isRecord(value)) return createUnknownCallUsage()

  const uncachedInput = reportedToken(value.input_tokens)
  const cacheRead = reportedToken(value.cache_read_input_tokens)
  const cacheWrite = reportedToken(value.cache_creation_input_tokens)
  let input = uncachedInput

  if (uncachedInput.value !== null) {
    let totalInput = uncachedInput.value
    for (const [key, token] of [
      ['cache_read_input_tokens', cacheRead],
      ['cache_creation_input_tokens', cacheWrite],
    ] as const) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      if (token.value === null) {
        totalInput = Number.NaN
        break
      }
      totalInput += token.value
    }
    input = Number.isFinite(totalInput)
      ? { value: totalInput, source: 'reported' }
      : { ...UNKNOWN_TOKEN }
  }

  return {
    input,
    output: reportedToken(value.output_tokens),
    cacheRead,
    cacheWrite,
    reasoning: { ...UNKNOWN_TOKEN },
  }
}

export function normalizeCallCompletion(usage: CallUsage, rawFinishReason: unknown): CallCompletion {
  const raw = typeof rawFinishReason === 'string' && rawFinishReason.length > 0
    ? rawFinishReason
    : null
  const normalized = raw?.trim().toLowerCase() || ''
  let finish: CallFinish = 'unknown'

  if (['stop', 'end_turn', 'stop_sequence'].includes(normalized)) finish = 'stop'
  else if (['length', 'max_tokens', 'model_context_window_exceeded'].includes(normalized)) finish = 'length'
  else if (['content_filter', 'filter', 'filtered', 'safety'].includes(normalized)) finish = 'filtered'
  else if (['tool_call', 'tool_calls', 'tool_use'].includes(normalized)) finish = 'tool_call'

  return { finish, rawFinishReason: raw, usage }
}
