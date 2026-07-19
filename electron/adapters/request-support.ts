import { logError, logWarn } from '../utils/runtime-log'

type ErrorLike = Error & {
  code?: string
  cause?: unknown
  statusCode?: number
  retryAfterMs?: number
}

interface ManagedRequestSignal {
  signal: AbortSignal
  cleanup: () => void
  didTimeout: () => boolean
  didExternalAbort: () => boolean
}

export interface ManagedRequestOptions {
  provider: string
  modelId: string
  timeoutMs?: number
  requestRetryCount?: number
  signal?: AbortSignal
  requestLabel?: string
}

const DEFAULT_REQUEST_TIMEOUT_MS = 90_000
const DEFAULT_REQUEST_RETRY_COUNT = 2
const MAX_REQUEST_RETRY_COUNT = 5
const RETRY_BASE_DELAY_MS = 1_000
const RETRY_MAX_DELAY_MS = 4_000
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'REQUEST_TIMEOUT',
])

export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1_000, Math.min(30_000, Math.round(seconds * 1_000)))
  }

  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return undefined
  const delayMs = timestamp - Date.now()
  if (!Number.isFinite(delayMs) || delayMs <= 0) return 1_000
  return Math.max(1_000, Math.min(30_000, delayMs))
}

export function buildHttpError(
  message: string,
  response: Pick<Response, 'status' | 'headers'>,
  cause?: unknown,
): Error {
  const error = buildError(message, undefined, cause) as ErrorLike
  error.statusCode = typeof response.status === 'number' ? response.status : undefined
  const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'))
  if (typeof retryAfterMs === 'number') {
    error.retryAfterMs = retryAfterMs
  }
  return error
}

export async function executeManagedRequest<T>(
  options: ManagedRequestOptions,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const retryLimit = resolveManagedRequestRetryCount(options.requestRetryCount)
  let lastError: unknown

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const timeoutMs = resolveManagedRequestTimeoutMs(options.timeoutMs)
    const managedSignal = createManagedSignal(options.signal, timeoutMs)

    try {
      return await operation(managedSignal.signal)
    } catch (error) {
      if (managedSignal.didExternalAbort()) throw buildAbortError()
      const normalizedError = managedSignal.didTimeout()
        ? buildError(`模型请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`, 'REQUEST_TIMEOUT', error)
        : error

      if (!isRetryableNetworkError(normalizedError)) throw normalizedError
      lastError = normalizedError

      if (attempt >= retryLimit) break

      logWarn('model', '模型请求网络异常，准备重试。', {
        consoleSummary: `[model:warn] provider=${options.provider} retry=${attempt + 1}/${retryLimit + 1}`,
        context: {
          provider: options.provider,
          modelId: options.modelId,
          requestLabel: options.requestLabel || 'request',
          attempt: attempt + 1,
          maxAttempts: retryLimit + 1,
          detail: describeNetworkError(normalizedError),
        },
        error: normalizedError,
      })
      await delay(getRetryDelayMs(attempt))
    } finally {
      managedSignal.cleanup()
    }
  }

  logError('model', '模型请求在自动重试后仍失败。', {
    consoleSummary: `[model:error] provider=${options.provider} retries-exhausted attempts=${retryLimit + 1}`,
    context: {
      provider: options.provider,
      modelId: options.modelId,
      requestLabel: options.requestLabel || 'request',
      attempts: retryLimit + 1,
      detail: describeNetworkError(lastError),
    },
    error: lastError,
  })
  throw buildRetryExhaustedError(lastError, retryLimit + 1)
}

function createManagedSignal(externalSignal: AbortSignal | undefined, timeoutMs: number): ManagedRequestSignal {
  const controller = new AbortController()
  let timedOut = false
  let externalAbort = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const onExternalAbort = () => {
    externalAbort = true
    if (!controller.signal.aborted) controller.abort()
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      externalAbort = true
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      if (!controller.signal.aborted) controller.abort()
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    },
    didTimeout: () => timedOut,
    didExternalAbort: () => externalAbort,
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  if (isAbortError(error)) return false

  const details = collectErrorDetails(error)
  if (details.codes.some((code) => RETRYABLE_NETWORK_ERROR_CODES.has(code))) return true

  const combinedText = [...details.messages, ...details.names].join(' ').toLowerCase()
  return [
    'fetch failed',
    'terminated',
    'other side closed',
    'socket',
    'connection reset',
    'network error',
    'network connection',
    'read econnreset',
  ].some((pattern) => combinedText.includes(pattern))
}

function describeNetworkError(error: unknown): string {
  const details = collectErrorDetails(error)
  const code = details.codes[0] || ''
  const combinedText = [...details.messages, ...details.names].join(' ').toLowerCase()

  if (code === 'ECONNRESET' || combinedText.includes('econnreset')) return '连接被远端重置（ECONNRESET）'
  if (code === 'UND_ERR_SOCKET' || combinedText.includes('other side closed')) return '连接被对端中断（UND_ERR_SOCKET）'
  if (code === 'REQUEST_TIMEOUT' || code === 'ETIMEDOUT' || combinedText.includes('timed out')) return '请求超时'
  if (combinedText.includes('terminated')) return '连接在响应过程中被中断'
  if (combinedText.includes('fetch failed')) return code ? `网络请求失败（${code}）` : '网络请求失败'

  const firstMessage = details.messages.find(Boolean)
  if (firstMessage) return code && !firstMessage.includes(code) ? `${firstMessage}（${code}）` : firstMessage
  return code ? `网络异常（${code}）` : '网络异常'
}

function buildRetryExhaustedError(error: unknown, attempts: number): Error {
  return buildError(
    `模型服务连接不稳定，已自动重试 ${attempts} 次仍失败：${describeNetworkError(error)}。请稍后重试。`,
    undefined,
    error,
  )
}

function collectErrorDetails(error: unknown, seen = new Set<unknown>()): { codes: string[]; messages: string[]; names: string[] } {
  if (!error || seen.has(error)) return { codes: [], messages: [], names: [] }
  seen.add(error)

  if (!(error instanceof Error)) return { codes: [], messages: [], names: [] }

  const typed = error as ErrorLike
  const nested = typed.cause ? collectErrorDetails(typed.cause, seen) : { codes: [], messages: [], names: [] }

  return {
    codes: [typed.code || '', ...nested.codes].filter(Boolean),
    messages: [typed.message || '', ...nested.messages].filter(Boolean),
    names: [typed.name || '', ...nested.names].filter(Boolean),
  }
}

function buildAbortError(): Error {
  const error = new Error('用户已取消')
  error.name = 'AbortError'
  return error
}

function buildError(message: string, code?: string, cause?: unknown): Error {
  const error = new Error(message) as ErrorLike
  if (code) error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || /abort|cancel|取消/i.test(error.message))
}

export function resolveManagedRequestTimeoutMs(timeoutMs?: number): number {
  const configuredDefault = Number(process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS)
  const value = typeof timeoutMs === 'number'
    ? Math.round(timeoutMs)
    : Number.isFinite(configuredDefault)
      ? Math.round(configuredDefault)
      : DEFAULT_REQUEST_TIMEOUT_MS
  return Math.max(5_000, Math.min(300_000, value))
}

export function resolveManagedRequestRetryCount(retryCount?: number): number {
  const configuredDefault = Number(process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT)
  const value = typeof retryCount === 'number'
    ? Math.round(retryCount)
    : Number.isFinite(configuredDefault)
      ? Math.round(configuredDefault)
      : DEFAULT_REQUEST_RETRY_COUNT
  return Math.max(0, Math.min(MAX_REQUEST_RETRY_COUNT, value))
}

function getRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** attempt))
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
