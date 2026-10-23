import type { ModelDiscoveryRequest, ModelDiscoveryResult } from '../../src/types'
import { createUserFacingError, UserFacingError } from '../utils/user-facing-error'
import { decryptApiKey, getModelConfigRecord, normalizeModelProvider } from './model.service'

const MASKED_KEY = '已设置'
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com',
  kimi: 'https://api.moonshot.ai/v1',
  aliyun: 'https://dashscope.aliyuncs.com/api/v1',
  custom: 'http://localhost:11434/v1',
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MODEL_COUNT = 10_000
const MAX_PAGE_COUNT = 20
const TIMEOUT_MS = 15_000

interface DiscoveryDependencies {
  fetch?: typeof fetch
  getConfig?: (id: number) => { provider: string; baseUrl?: string | null; apiKey?: string | null }
  decryptKey?: (encrypted: string) => string
  timeoutMs?: number
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  })
}

function normalizeBaseUrl(value: unknown, provider: string): URL {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw createUserFacingError('modelDiscovery.invalidUrl')
  }
  const text = (typeof value === 'string' ? value.trim() : '') || DEFAULT_BASE_URLS[provider]
  if (!text || text.length > 2048 || !/^https?:\/\//i.test(text) || /\s/.test(text) || hasControlCharacters(text)) {
    throw createUserFacingError('modelDiscovery.invalidUrl')
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw createUserFacingError('modelDiscovery.invalidUrl')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw createUserFacingError('modelDiscovery.invalidUrl')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getModelId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const id = value.id.trim()
  return id && id.length <= 256 && !hasControlCharacters(id) ? id : null
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    throw createUserFacingError('modelDiscovery.tooLarge')
  }
  if (!response.body) throw createUserFacingError('modelDiscovery.invalidResponse')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder()
  let text = ''
  let receivedBytes = 0
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (signal.aborted) throw createUserFacingError('modelDiscovery.timeout')
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw createUserFacingError('modelDiscovery.tooLarge')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    if (signal.aborted) throw createUserFacingError('modelDiscovery.timeout')
    try {
      return JSON.parse(text + decoder.decode()) as unknown
    } catch {
      throw createUserFacingError('modelDiscovery.invalidResponse')
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/** Fetches the provider's real model catalogue without saving credentials or invoking inference. */
export async function discoverModels(
  input: ModelDiscoveryRequest,
  dependencies: DiscoveryDependencies = {},
): Promise<ModelDiscoveryResult> {
  if (!isRecord(input) || typeof input.provider !== 'string' || !input.provider.trim()) {
    throw createUserFacingError('modelDiscovery.invalidInput')
  }
  const provider = normalizeModelProvider(input.provider)
  if (!Object.hasOwn(DEFAULT_BASE_URLS, provider)) {
    throw createUserFacingError('modelDiscovery.unsupportedProvider')
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl, provider)
  if (input.configId !== undefined && (!Number.isSafeInteger(input.configId) || input.configId <= 0)) {
    throw createUserFacingError('modelDiscovery.invalidInput')
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
    throw createUserFacingError('modelDiscovery.invalidInput')
  }
  let apiKey = (input.apiKey || '').trim()
  if (input.apiKey === undefined || apiKey === MASKED_KEY) {
    apiKey = ''
    if (input.configId !== undefined) {
      let config: ReturnType<NonNullable<DiscoveryDependencies['getConfig']>>
      try {
        config = (dependencies.getConfig || getModelConfigRecord)(input.configId)
      } catch {
        throw createUserFacingError('modelDiscovery.configNotFound')
      }
      // Never send a stored key to a new provider, origin, path, or scheme.
      if (normalizeModelProvider(config.provider) !== provider
        || normalizeBaseUrl(config.baseUrl, provider).href !== baseUrl.href) {
        throw createUserFacingError('modelDiscovery.credentialsChanged')
      }
      if (config.apiKey) {
        try {
          apiKey = (dependencies.decryptKey || decryptApiKey)(config.apiKey).trim()
        } catch {
          throw createUserFacingError('modelDiscovery.invalidStoredKey')
        }
        if (!apiKey || apiKey === MASKED_KEY) throw createUserFacingError('modelDiscovery.invalidStoredKey')
      }
    }
  }
  if (!apiKey && provider !== 'custom') throw createUserFacingError('model.apiKeyRequired')
  if (apiKey.length > 8192 || hasControlCharacters(apiKey)) {
    throw createUserFacingError('modelDiscovery.invalidKey')
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    headers['x-api-key'] = apiKey
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const endpoint = new URL(baseUrl.href)
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/models`
  const nativeAliyun = provider === 'aliyun' && baseUrl.pathname.endsWith('/api/v1')
  if (provider === 'anthropic') endpoint.searchParams.set('limit', '1000')
  if (nativeAliyun) {
    endpoint.searchParams.set('page_no', '1')
    endpoint.searchParams.set('page_size', '100')
  }
  const controller = new AbortController()
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(createUserFacingError('modelDiscovery.timeout'))
    }, dependencies.timeoutMs ?? TIMEOUT_MS)
  })
  const requestModels = async (): Promise<ModelDiscoveryResult> => {
    const models = new Set<string>()
    const seenCursors = new Set<string>()
    let receivedModelCount = 0
    for (let page = 0; page < MAX_PAGE_COUNT; page += 1) {
      if (controller.signal.aborted) throw createUserFacingError('modelDiscovery.timeout')
      const response = await (dependencies.fetch || fetch)(endpoint.href, {
        method: 'GET',
        headers,
        signal: controller.signal,
        // Refuse all redirects: custom auth headers must never reach another origin.
        redirect: 'error',
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        if (response.status === 401 || response.status === 403) {
          throw createUserFacingError('modelDiscovery.unauthorized', { status: response.status })
        }
        if (response.status === 404 || response.status === 405) {
          throw createUserFacingError('modelDiscovery.noEndpoint', { status: response.status })
        }
        throw createUserFacingError('modelDiscovery.httpError', { status: response.status })
      }
      const data = await readJson(response, controller.signal)
      if (!isRecord(data)) throw createUserFacingError('modelDiscovery.invalidResponse')
      if (data.success === false || (data.error !== undefined && data.error !== null)) {
        throw createUserFacingError('modelDiscovery.invalidResponse')
      }
      const output = nativeAliyun && isRecord(data.output) ? data.output : null
      const entries = nativeAliyun ? output?.models : data.data
      if (!Array.isArray(entries)) {
        throw createUserFacingError('modelDiscovery.invalidResponse')
      }
      if (entries.length > MAX_MODEL_COUNT) throw createUserFacingError('modelDiscovery.tooLarge')
      const ids = entries.map((entry) => getModelId(nativeAliyun && isRecord(entry) ? { id: entry.model } : entry))
        .filter((id): id is string => id !== null)
      if (entries.length > 0 && ids.length === 0) throw createUserFacingError('modelDiscovery.invalidResponse')
      if (apiKey && ids.some((id) => id.includes(apiKey))) throw createUserFacingError('modelDiscovery.invalidResponse')
      ids.forEach((id) => models.add(id))
      if (models.size > MAX_MODEL_COUNT) throw createUserFacingError('modelDiscovery.tooLarge')
      if (nativeAliyun) {
        const total = output?.total
        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0
          || (output?.page_no !== undefined && output.page_no !== page + 1)) {
          throw createUserFacingError('modelDiscovery.invalidResponse')
        }
        if (total > MAX_MODEL_COUNT) throw createUserFacingError('modelDiscovery.tooLarge')
        receivedModelCount += entries.length
        if (receivedModelCount >= total) return { models: [...models].sort((a, b) => a.localeCompare(b)) }
        if (entries.length === 0) throw createUserFacingError('modelDiscovery.invalidResponse')
        endpoint.searchParams.set('page_no', String(page + 2))
        continue
      }
      if (data.has_more !== true) return { models: [...models].sort((a, b) => a.localeCompare(b)) }
      const cursor = typeof data.last_id === 'string' ? data.last_id.trim() : ids.at(-1)
      if (!cursor || cursor.length > 256 || seenCursors.has(cursor)) {
        throw createUserFacingError('modelDiscovery.invalidResponse')
      }
      seenCursors.add(cursor)
      endpoint.searchParams.set('after_id', cursor)
    }
    throw createUserFacingError('modelDiscovery.tooLarge')
  }

  try {
    return await Promise.race([requestModels(), deadline])
  } catch (error) {
    if (timedOut) throw createUserFacingError('modelDiscovery.timeout')
    if (error instanceof UserFacingError) throw error
    // Provider bodies, fetch errors and URLs may echo keys. Never expose them.
    throw createUserFacingError('modelDiscovery.networkError')
  } finally {
    if (timeout) clearTimeout(timeout)
    controller.abort()
  }
}
