import type { SourceSearchProtocol, SourceSearchRuntimeConfig } from '../../src/shared/source-search'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  score?: number
  publishedAt?: string
  excerptKind?: 'source_metadata'
}

type SourceSearchErrorCode =
  | 'INVALID_CONFIG' | 'INVALID_QUERY' | 'QUERY_TOO_LONG' | 'HTTP_ERROR'
  | 'NETWORK_ERROR' | 'TIMEOUT' | 'RESPONSE_TOO_LARGE' | 'INVALID_RESPONSE'
  | 'SEARCH_NOT_EXECUTED' | 'MISSING_SOURCES'

const ERROR_MESSAGES: Record<SourceSearchErrorCode, string> = {
  INVALID_CONFIG: '搜索接口配置无效，请检查平台、协议、地址和搜索模型。',
  INVALID_QUERY: '请输入有效的检索词。',
  QUERY_TOO_LONG: 'DeepSeek Search 检索词最多支持 128 个 Unicode 字符，请缩短后重试。',
  HTTP_ERROR: '搜索服务请求失败，请检查 API Key、额度和服务状态后重试。',
  NETWORK_ERROR: '连接失败，请检查 API Key、网络和服务状态后重试。',
  TIMEOUT: '连接超时，请检查网络后重试。',
  RESPONSE_TOO_LARGE: '搜索服务返回的数据过大，请缩小检索范围后重试。',
  INVALID_RESPONSE: '搜索服务返回的数据无效或尚未完成，请检查搜索协议后重试。',
  SEARCH_NOT_EXECUTED: '接口未执行联网搜索，请确认模型支持搜索，或选择独立搜索接口。',
  MISSING_SOURCES: '接口未返回可用的结构化来源，请检查搜索协议或改用独立搜索接口。',
}

/** Only fixed, locally defined messages cross the provider boundary. */
export class SourceSearchError extends Error {
  readonly code: SourceSearchErrorCode
  readonly status?: number

  constructor(code: SourceSearchErrorCode, status?: number) {
    const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
    super(code === 'HTTP_ERROR' && safeStatus !== undefined
      ? `搜索服务请求失败（HTTP ${safeStatus}），请检查 API Key、额度和服务状态后重试。`
      : ERROR_MESSAGES[code])
    this.name = 'SourceSearchError'
    this.code = code
    if (safeStatus !== undefined) this.status = safeStatus
  }
}

interface SearchOptions { maxResults: number; timeoutMs: number }
interface SearchRequest { url: string; init: RequestInit; protocol: SourceSearchProtocol; limit: number }
interface BodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(): Promise<void>
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const PROTOCOLS: SourceSearchProtocol[] = ['tavily', 'brave', 'deepseek', 'responses', 'chat-completions']
const PROVIDERS = ['tavily', 'brave', 'deepseek', 'openai', 'custom']

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasControls(value: string): boolean {
  return Array.from(value).some(char => {
    const code = char.charCodeAt(0)
    return code < 32 || code >= 127 && code <= 159
  })
}

function containsCredential(value: string, apiKey: string): boolean {
  let decoded = value
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (decoded.includes(apiKey)) return true
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch { break }
  }
  return false
}

function endpoint(baseUrl: string, protocol: SourceSearchProtocol, apiKey: string): string {
  if (typeof baseUrl !== 'string' || !baseUrl || baseUrl.length > 2048 || /\s/u.test(baseUrl) || hasControls(baseUrl) || containsCredential(baseUrl, apiKey)) {
    throw new SourceSearchError('INVALID_CONFIG')
  }
  let url: URL
  try { url = new URL(baseUrl) }
  catch { throw new SourceSearchError('INVALID_CONFIG') }
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new SourceSearchError('INVALID_CONFIG')
  }

  let path = url.pathname.replace(/\/+$/u, '')
  if (protocol === 'responses' && /\/chat\/completions$/u.test(path)
    || protocol === 'chat-completions' && /\/responses$/u.test(path)) {
    throw new SourceSearchError('INVALID_CONFIG')
  }
  if (!path && (url.hostname === 'api.openai.com' || url.hostname === 'api.deepseek.com')
    && (protocol === 'deepseek' || protocol === 'responses' || protocol === 'chat-completions')) path = '/v1'
  switch (protocol) {
    case 'tavily':
      if (!path.endsWith('/search')) path += '/search'
      break
    case 'brave':
      if (path.endsWith('/search')) break
      if (path.endsWith('/web')) path += '/search'
      else if (!path) path = '/res/v1/web/search'
      else if (path.endsWith('/res')) path += '/v1/web/search'
      else path += '/web/search'
      break
    case 'deepseek':
      if (path.endsWith('/tools/search')) break
      if (path.endsWith('/tools')) path += '/search'
      else path += '/tools/search'
      break
    case 'responses':
      if (!path.endsWith('/responses')) path += '/responses'
      break
    case 'chat-completions':
      if (path.endsWith('/chat/completions')) break
      path += path.endsWith('/chat') ? '/completions' : '/chat/completions'
      break
  }
  url.pathname = path
  return url.href
}

function buildRequest(runtime: SourceSearchRuntimeConfig, query: string, options: SearchOptions): SearchRequest {
  if (!runtime || runtime.mode === 'disabled' || !runtime.providerName || !PROVIDERS.includes(runtime.providerName)
    || typeof runtime.apiKey !== 'string' || !runtime.apiKey.trim() || runtime.apiKey.length > 8192
    || runtime.apiKey !== runtime.apiKey.trim() || runtime.apiKey === '已设置' || hasControls(runtime.apiKey)) {
    throw new SourceSearchError('INVALID_CONFIG')
  }
  const protocol = runtime.protocol ?? (runtime.providerName === 'tavily' || runtime.providerName === 'brave' ? runtime.providerName : undefined)
  if (!protocol || !PROTOCOLS.includes(protocol)) throw new SourceSearchError('INVALID_CONFIG')
  if (typeof query !== 'string' || !query.trim()) throw new SourceSearchError('INVALID_QUERY')
  if (protocol === 'deepseek' && Array.from(query).length > 128) throw new SourceSearchError('QUERY_TOO_LONG')

  const defaults = {
    tavily: 'https://api.tavily.com', brave: 'https://api.search.brave.com/res/v1',
    deepseek: 'https://api.deepseek.com/v1', openai: 'https://api.openai.com/v1', custom: '',
  }
  const url = endpoint(runtime.baseUrl ?? defaults[runtime.providerName], protocol, runtime.apiKey)
  const maxResults = Number.isFinite(options.maxResults) ? Math.floor(options.maxResults) : 3
  const limit = Math.max(1, Math.min(protocol === 'deepseek' ? 50 : 20, maxResults))
  const init: RequestInit = { method: 'POST', redirect: 'error' }
  if (protocol === 'brave') {
    const searchUrl = new URL(url)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('count', String(limit))
    init.method = 'GET'
    init.headers = { Accept: 'application/json', 'X-Subscription-Token': runtime.apiKey }
    return { url: searchUrl.href, init, protocol, limit }
  }

  init.headers = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${runtime.apiKey}` }
  let body: Record<string, unknown>
  switch (protocol) {
    case 'tavily':
      body = { query, max_results: limit, search_depth: 'basic', include_answer: false, include_raw_content: false }
      break
    case 'deepseek':
      body = { query, count: limit, need_content: false }
      break
    case 'responses':
    case 'chat-completions': {
      if (typeof runtime.model !== 'string' || !runtime.model.trim() || runtime.model.length > 256 || hasControls(runtime.model)) {
        throw new SourceSearchError('INVALID_CONFIG')
      }
      const model = runtime.model.trim()
      if (protocol === 'chat-completions') {
        body = { model, messages: [{ role: 'user', content: query }], web_search_options: {}, stream: false }
      } else {
        body = { model, input: query, tools: [{ type: 'web_search' }], tool_choice: 'required', stream: false }
        // DeepSeek documents these fields as unsupported; search evidence is still required below.
        if (new URL(url).hostname !== 'api.deepseek.com') {
          body.include = ['web_search_call.action.sources']
          body.store = false
        }
      }
      break
    }
  }
  init.body = JSON.stringify(body)
  return { url, init, protocol, limit }
}

function cancelBody(body: { cancel(): Promise<void> } | null | undefined): void {
  try { void body?.cancel().catch(() => undefined) }
  catch { /* Cancellation must never expose an upstream error or extend the deadline. */ }
}

async function fetchJson(request: SearchRequest, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  let reader: BodyReader | undefined
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new SourceSearchError('TIMEOUT'))
      controller.abort()
      cancelBody(reader)
    }, timeoutMs)
  })
  const receive = async (): Promise<unknown> => {
    const response = await fetch(request.url, { ...request.init, signal: controller.signal })
    if (timedOut) {
      cancelBody(response.body)
      throw new SourceSearchError('TIMEOUT')
    }
    if (!response.ok) {
      cancelBody(response.body)
      throw new SourceSearchError('HTTP_ERROR', response.status)
    }
    const length = Number(response.headers?.get('Content-Length'))
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
      cancelBody(response.body)
      throw new SourceSearchError('RESPONSE_TOO_LARGE')
    }
    if (!response.body || typeof response.body.getReader !== 'function') throw new SourceSearchError('INVALID_RESPONSE')
    reader = response.body.getReader()
    const bytes = new Uint8Array(MAX_RESPONSE_BYTES)
    let total = 0
    for (;;) {
      const chunk = await reader.read()
      if (timedOut) throw new SourceSearchError('TIMEOUT')
      if (chunk.done) break
      if (!(chunk.value instanceof Uint8Array)) throw new SourceSearchError('INVALID_RESPONSE')
      total += chunk.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        cancelBody(reader)
        throw new SourceSearchError('RESPONSE_TOO_LARGE')
      }
      bytes.set(chunk.value, total - chunk.value.byteLength)
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))) }
    catch { throw new SourceSearchError('INVALID_RESPONSE') }
  }
  try { return await Promise.race([receive(), deadline]) }
  catch (error) {
    cancelBody(reader)
    if (timedOut) throw new SourceSearchError('TIMEOUT')
    if (error instanceof SourceSearchError) throw error
    throw new SourceSearchError('NETWORK_ERROR')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function sourceUrl(value: unknown, apiKey: string): string | null {
  if (typeof value !== 'string' || value.length > 8192 || hasControls(value) || containsCredential(value, apiKey)) return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    url.hash = ''
    return containsCredential(url.href, apiKey) ? null : url.href
  } catch { return null }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }

function normalizeSources(items: unknown[], protocol: SourceSearchProtocol, limit: number, apiKey: string): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const seen = new Set<string>()
  const metadataOnly = protocol === 'responses' || protocol === 'chat-completions'
  for (const item of items) {
    if (!record(item)) continue
    const url = sourceUrl(item.url, apiKey)
    if (!url || seen.has(url)) continue
    const title = text(item.title) || new URL(url).hostname
    const snippet = metadataOnly ? title : protocol === 'tavily' ? text(item.content) || text(item.snippet)
      : protocol === 'brave' ? text(item.description) || text(item.snippet) : text(item.snippet) || text(item.summary)
    const publishedAt = text(protocol === 'deepseek' ? item.date : protocol === 'tavily' ? item.published_date : item.age)
    if ([title, snippet, publishedAt].some(value => containsCredential(value, apiKey))) continue
    const result: WebSearchResult = { title: title.slice(0, 500), url, snippet: (snippet || title).slice(0, 1200) }
    if (metadataOnly) result.excerptKind = 'source_metadata'
    const score = protocol === 'deepseek' ? item.rerank_score : item.score
    if (typeof score === 'number' && Number.isFinite(score)) result.score = Math.max(0, Math.min(1, protocol === 'deepseek' ? score / 3 : score))
    if (publishedAt) result.publishedAt = publishedAt.slice(0, 100)
    results.push(result)
    seen.add(url)
    if (results.length >= limit) break
  }
  return results
}

function responseSources(payload: Record<string, unknown>): unknown[] {
  if (payload.status !== 'completed' || !Array.isArray(payload.output)) throw new SourceSearchError('INVALID_RESPONSE')
  const completedSearches = payload.output.filter(item => record(item) && item.type === 'web_search_call' && item.status === 'completed')
  if (!completedSearches.length) throw new SourceSearchError('SEARCH_NOT_EXECUTED')
  const sources: unknown[] = []
  for (const item of completedSearches) {
    if (record(item) && record(item.action) && Array.isArray(item.action.sources)) {
      for (const source of item.action.sources) {
        if (record(source) && source.type === 'url') sources.push(source)
      }
    }
  }
  for (const item of payload.output) {
    if (!record(item) || item.type !== 'message' || item.status !== 'completed' || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!record(content) || content.type !== 'output_text' || !Array.isArray(content.annotations)) continue
      for (const annotation of content.annotations) {
        if (record(annotation) && annotation.type === 'url_citation') sources.push(annotation)
      }
    }
  }
  return sources
}

function chatSources(payload: Record<string, unknown>): unknown[] {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  if (!record(choice) || choice.finish_reason !== 'stop' || !record(choice.message)) throw new SourceSearchError('INVALID_RESPONSE')
  if (!Array.isArray(choice.message.annotations)) return []
  return choice.message.annotations.flatMap(annotation => record(annotation) && annotation.type === 'url_citation' && record(annotation.url_citation)
    ? [annotation.url_citation] : [])
}

export async function executeSourceSearch(runtime: SourceSearchRuntimeConfig, query: string, options: SearchOptions): Promise<WebSearchResult[]> {
  const request = buildRequest(runtime, query, options)
  const modelBacked = request.protocol === 'responses' || request.protocol === 'chat-completions'
  const configuredTimeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.floor(options.timeoutMs) : 8000
  const timeoutMs = Math.min(45_000, Math.max(modelBacked ? 30_000 : 1, configuredTimeout))
  const payload = await fetchJson(request, timeoutMs)
  if (!record(payload) || payload.error) throw new SourceSearchError('INVALID_RESPONSE')
  let sources: unknown[]
  switch (request.protocol) {
    case 'responses': sources = responseSources(payload); break
    case 'chat-completions': sources = chatSources(payload); break
    case 'brave':
      if (!record(payload.web) || !Array.isArray(payload.web.results)) throw new SourceSearchError('INVALID_RESPONSE')
      sources = payload.web.results
      break
    case 'tavily':
    case 'deepseek':
      if (!Array.isArray(payload.results)) throw new SourceSearchError('INVALID_RESPONSE')
      sources = payload.results
      break
  }
  const results = normalizeSources(sources, request.protocol, request.limit, runtime.apiKey!)
  if (modelBacked && !results.length) throw new SourceSearchError('MISSING_SOURCES')
  return results
}
