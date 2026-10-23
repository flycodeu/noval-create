import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceSearchProtocol, SourceSearchRuntimeConfig } from '../../src/shared/source-search'
import { executeSourceSearch, SourceSearchError } from './source-search-provider.service'

const API_KEY = 'test-only-source-search-key-not-a-real-secret'
const QUERY = '宋代江南行旅衣料 -道袍 site:edu.cn'
const OPTIONS = { maxResults: 3, timeoutMs: 8000 }
const SOURCE = { title: '博物馆服饰资料', url: 'https://museum.example/clothing', snippet: '有据可查的服饰摘要。' }
const MODEL_TEXT = '这是检索模型的总结，不是每个来源的逐字原文。'
const MAX_BYTES = 2 * 1024 * 1024

function runtime(protocol: SourceSearchProtocol, patch: Partial<SourceSearchRuntimeConfig> = {}): SourceSearchRuntimeConfig {
  const providerName = protocol === 'tavily' || protocol === 'brave' || protocol === 'deepseek' ? protocol : 'openai'
  return {
    mode: providerName, providerName, protocol, apiKey: API_KEY,
    baseUrl: protocol === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://search.example/v1',
    model: protocol === 'responses' || protocol === 'chat-completions' ? 'fixture-search-model' : '',
    ...patch,
  }
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers } })
}

function mockPayload(value: unknown) {
  const mock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(value))
  vi.stubGlobal('fetch', mock)
  return mock
}

function citation(url = SOURCE.url, title = SOURCE.title) {
  return { type: 'url_citation', url, title, start_index: 0, end_index: MODEL_TEXT.length }
}

function responsesPayload(annotations: unknown[] = [citation()], sources: unknown[] = []) {
  return {
    status: 'completed',
    output: [
      { type: 'web_search_call', id: 'ws-fixture', status: 'completed', action: { type: 'search', queries: [QUERY], sources } },
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: MODEL_TEXT, annotations }] },
    ],
  }
}

function chatPayload(annotations: unknown[] = [{ type: 'url_citation', url_citation: citation() }]) {
  return { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: MODEL_TEXT, annotations } }] }
}

function readRequest(mock: ReturnType<typeof mockPayload>) {
  const [url, init] = mock.mock.calls[0]
  return { url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} }
}

async function expectSafeFailure(pending: Promise<unknown>, code: string, status?: number) {
  const error = await pending.then(() => { throw new Error('Expected the isolated search request to fail') }, value => value)
  expect(error).toBeInstanceOf(SourceSearchError)
  expect(error).toMatchObject({ code, ...(status === undefined ? {} : { status }) })
  expect(`${String(error)}\n${JSON.stringify(error)}\n${error.stack || ''}`).not.toContain(API_KEY)
  return error
}

beforeEach(() => {
  // Every request is explicitly mocked; this suite cannot call providers or load an author profile.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected provider request in isolated unit test')))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('source search protocol requests and legacy compatibility', () => {
  it('keeps legacy Tavily runtime objects working without protocol or baseUrl', async () => {
    const mock = mockPayload({ results: [{ ...SOURCE, content: SOURCE.snippet, score: 0.8, published_date: '2026-10-01' }] })
    const result = await executeSourceSearch({ mode: 'auto', providerName: 'tavily', apiKey: API_KEY }, QUERY, OPTIONS)
    const request = readRequest(mock)

    expect(request.url).toBe('https://api.tavily.com/search')
    expect(request.init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${API_KEY}` }, signal: expect.any(AbortSignal) })
    expect(request.body).toMatchObject({ query: QUERY, max_results: 3, include_answer: false, include_raw_content: false })
    expect(result).toEqual([expect.objectContaining({ ...SOURCE, score: 0.8, publishedAt: '2026-10-01' })])
  })

  it('keeps legacy Brave runtime objects working without accidentally using Bearer authentication', async () => {
    const mock = mockPayload({ web: { results: [{ ...SOURCE, description: SOURCE.snippet, age: '2026-10-01' }] } })
    const result = await executeSourceSearch({ mode: 'auto', providerName: 'brave', apiKey: API_KEY }, QUERY, OPTIONS)
    const request = readRequest(mock)
    const url = new URL(request.url)

    expect(`${url.origin}${url.pathname}`).toBe('https://api.search.brave.com/res/v1/web/search')
    expect(url.searchParams.get('q')).toBe(QUERY)
    expect(url.searchParams.get('count')).toBe('3')
    expect(request.init).toMatchObject({ method: 'GET', redirect: 'error', headers: { 'X-Subscription-Token': API_KEY } })
    expect(new Headers(request.init.headers).has('Authorization')).toBe(false)
    expect(result).toEqual([expect.objectContaining(SOURCE)])
  })

  it.each(['unknown-provider', 'custom'])('rejects %s without a known protocol instead of sending its key to Brave', async providerName => {
    const input = { mode: providerName, providerName, apiKey: API_KEY } as SourceSearchRuntimeConfig
    await expectSafeFailure(executeSourceSearch(input, QUERY, OPTIONS), 'INVALID_CONFIG')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an unknown explicit protocol before any network request', async () => {
    await expectSafeFailure(executeSourceSearch(runtime('responses', { protocol: 'unknown' as SourceSearchProtocol }), QUERY, OPTIONS), 'INVALID_CONFIG')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['responses', 'https://search.example/v1/chat/completions'],
    ['chat-completions', 'https://search.example/v1/responses'],
  ] as const)('rejects a known endpoint that belongs to a different model protocol (%s)', async (protocol, baseUrl) => {
    await expectSafeFailure(executeSourceSearch(runtime(protocol, { baseUrl }), QUERY, OPTIONS), 'INVALID_CONFIG')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['', ' \t\n '])('rejects an empty query without calling a provider (%j)', async query => {
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), query, OPTIONS), 'INVALID_QUERY')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    'file:///secret', 'javascript:alert(1)', 'https://user:password@search.example/v1',
    'https://search.example/v1?api_key=secret', 'https://search.example/v1#secret',
  ])('rejects unsafe custom base URLs (%s)', async baseUrl => {
    await expectSafeFailure(executeSourceSearch(runtime('responses', { providerName: 'custom', mode: 'custom', baseUrl }), QUERY, OPTIONS), 'INVALID_CONFIG')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['tavily', 'https://gateway.example/v1/tavily/search'],
    ['brave', 'https://gateway.example/v1/brave/search'],
    ['deepseek', 'https://gateway.example/v1/tools/search'],
    ['responses', 'https://gateway.example/v1/responses'],
    ['chat-completions', 'https://gateway.example/v1/chat/completions'],
  ] as const)('does not append a duplicate %s suffix to an explicitly configured endpoint', async (protocol, baseUrl) => {
    const payload = protocol === 'responses' ? responsesPayload() : protocol === 'chat-completions' ? chatPayload()
      : protocol === 'brave' ? { web: { results: [{ ...SOURCE, description: SOURCE.snippet }] } } : { results: [SOURCE] }
    const mock = mockPayload(payload)

    await executeSourceSearch(runtime(protocol, { providerName: 'custom', mode: 'custom', baseUrl }), QUERY, OPTIONS)

    const requestUrl = new URL(readRequest(mock).url)
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(baseUrl)
  })

  it('allows HTTP only for an explicitly configured loopback service', async () => {
    const mock = mockPayload({ results: [SOURCE] })
    await executeSourceSearch(runtime('deepseek', { providerName: 'custom', mode: 'custom', baseUrl: 'http://127.0.0.1:18090/v1' }), QUERY, OPTIONS)
    expect(readRequest(mock).url).toBe('http://127.0.0.1:18090/v1/tools/search')
    mock.mockClear()

    await expectSafeFailure(executeSourceSearch(runtime('deepseek', { providerName: 'custom', mode: 'custom', baseUrl: 'http://gateway.example/v1' }), QUERY, OPTIONS), 'INVALID_CONFIG')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('independent DeepSeek Search API', () => {
  it('requests tools/search directly, preserving operators and omitting a writing-model call', async () => {
    const mock = mockPayload({ results: [{ ...SOURCE, summary: '长摘要', date: '2026-06-01T00:00:00Z', rerank_score: 2.4 }] })
    const result = await executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS)
    const request = readRequest(mock)

    expect(request.url).toBe('https://api.deepseek.com/v1/tools/search')
    expect(request.init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${API_KEY}` } })
    expect(request.body).toEqual({ query: QUERY, count: 3, need_content: false })
    expect(result[0]).toMatchObject({ ...SOURCE, publishedAt: '2026-06-01T00:00:00Z' })
    expect(result[0].score).toBeCloseTo(0.8)
    expect(mock).toHaveBeenCalledOnce()
  })

  it('accepts the official DeepSeek root URL by adding the documented versioned search path once', async () => {
    const mock = mockPayload({ results: [SOURCE] })
    await executeSourceSearch(runtime('deepseek', { baseUrl: 'https://api.deepseek.com' }), QUERY, OPTIONS)
    expect(readRequest(mock).url).toBe('https://api.deepseek.com/v1/tools/search')
  })

  it('uses the documented summary when the short snippet is absent, without substituting full page content', async () => {
    mockPayload({ results: [{ title: SOURCE.title, url: SOURCE.url, snippet: '', summary: '检索接口提供的长摘要', content: '不应读取的整页正文', date: null, rerank_score: 1.5 }] })
    const result = await executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS)
    expect(result[0]).toMatchObject({ title: SOURCE.title, url: SOURCE.url, snippet: '检索接口提供的长摘要', score: 0.5 })
    expect(JSON.stringify(result)).not.toContain('不应读取的整页正文')
    expect(result[0].publishedAt).toBeFalsy()
  })

  it('counts Unicode code points, allowing exactly 128 supplementary characters', async () => {
    const mock = mockPayload({ results: [] })
    const query = '𠮷'.repeat(128)
    expect(query.length).toBe(256)
    expect(await executeSourceSearch(runtime('deepseek'), query, OPTIONS)).toEqual([])
    expect(readRequest(mock).body.query).toBe(query)
  })

  it('refuses 129 Unicode characters instead of silently truncating a search request', async () => {
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), '𠮷'.repeat(129), OPTIONS), 'QUERY_TOO_LONG')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('limits the requested result count to the documented maximum', async () => {
    const mock = mockPayload({ results: [] })
    await executeSourceSearch(runtime('deepseek'), QUERY, { ...OPTIONS, maxResults: 100 })
    expect(readRequest(mock).body.count).toBe(50)
  })

  it.each([0, 1.5, 3])('normalizes rerank score %s from the documented zero-to-three range', async score => {
    mockPayload({ results: [{ ...SOURCE, rerank_score: score }] })
    const result = await executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS)
    expect(result[0].score).toBeCloseTo(score / 3)
  })

  it('distinguishes an empty successful result list from an invalid response envelope', async () => {
    const mock = mockPayload({ results: [] })
    expect(await executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS)).toEqual([])
    mock.mockResolvedValue(jsonResponse({ message: 'not a search response' }))
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'INVALID_RESPONSE')
  })
})

describe('Responses structured search evidence', () => {
  it('requests the configured model, required web search and raw search sources', async () => {
    const mock = mockPayload(responsesPayload())
    const result = await executeSourceSearch(runtime('responses'), QUERY, OPTIONS)
    const request = readRequest(mock)

    expect(request.url).toBe('https://search.example/v1/responses')
    expect(request.init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${API_KEY}` } })
    expect(request.body).toMatchObject({ model: 'fixture-search-model', tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] })
    const toolChoice = request.body.tool_choice
    expect(toolChoice === 'required' || Boolean(toolChoice && typeof toolChoice === 'object' && (toolChoice as Record<string, unknown>).type === 'web_search')).toBe(true)
    expect(JSON.stringify(request.body.input)).toContain(QUERY)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: SOURCE.title, url: SOURCE.url })
    expect(result[0].snippet).not.toBe(MODEL_TEXT)
  })

  it('omits OpenAI-only fields for DeepSeek Responses while retaining strict structured search evidence', async () => {
    const mock = mockPayload(responsesPayload())

    await executeSourceSearch(runtime('responses', { providerName: 'custom', mode: 'custom', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' }), QUERY, OPTIONS)

    const request = readRequest(mock)
    expect(request.url).toBe('https://api.deepseek.com/v1/responses')
    expect(request.body).toMatchObject({ model: 'deepseek-v4-pro', tools: [{ type: 'web_search' }], tool_choice: 'required' })
    for (const unsupported of ['include', 'store', 'background', 'previous_response_id', 'conversation']) {
      expect(request.body).not.toHaveProperty(unsupported)
    }
  })

  it('reads raw output annotations rather than relying on the SDK-only output_text convenience field', async () => {
    mockPayload(responsesPayload([citation(), citation('https://university.example/archive', '大学档案')]))
    const result = await executeSourceSearch(runtime('responses'), QUERY, OPTIONS)
    expect(result.map(source => source.url)).toEqual([SOURCE.url, 'https://university.example/archive'])
  })

  it('accepts completed action.sources without inventing excerpts from a model answer', async () => {
    mockPayload(responsesPayload([], [{ type: 'url', url: SOURCE.url, title: SOURCE.title }]))
    const result = await executeSourceSearch(runtime('responses'), QUERY, OPTIONS)
    expect(result).toEqual([expect.objectContaining({ title: SOURCE.title, url: SOURCE.url, snippet: SOURCE.title })])
    expect(JSON.stringify(result)).not.toContain(MODEL_TEXT)
  })

  it.each(['in_progress', 'incomplete', 'failed', 'cancelled'])('rejects an unfinished top-level response (%s)', async status => {
    mockPayload({ ...responsesPayload(), status })
    await expectSafeFailure(executeSourceSearch(runtime('responses'), QUERY, OPTIONS), 'INVALID_RESPONSE')
  })

  it.each(['in_progress', 'failed'])('rejects citations when the search call is not completed (%s)', async status => {
    const payload = responsesPayload()
    payload.output[0].status = status
    mockPayload(payload)
    await expectSafeFailure(executeSourceSearch(runtime('responses'), QUERY, OPTIONS), 'SEARCH_NOT_EXECUTED')
  })

  it('requires an actual search call even if a chat-only output contains structured-looking citations', async () => {
    const payload = responsesPayload()
    mockPayload({ ...payload, output: payload.output.slice(1), output_text: `[假的来源](${SOURCE.url})` })
    await expectSafeFailure(executeSourceSearch(runtime('responses'), QUERY, OPTIONS), 'SEARCH_NOT_EXECUTED')
  })

  it('does not parse Markdown links or hallucinated JSON in model text into search results', async () => {
    const payload = responsesPayload([])
    payload.output[1].content![0].text = `[看似来源](${SOURCE.url}) ${JSON.stringify({ sources: [SOURCE] })}`
    mockPayload(payload)
    await expectSafeFailure(executeSourceSearch(runtime('responses'), QUERY, OPTIONS), 'MISSING_SOURCES')
  })
})

describe('Chat Completions search citations', () => {
  it('uses the configured search model and nested url_citation annotations', async () => {
    const mock = mockPayload(chatPayload())
    const result = await executeSourceSearch(runtime('chat-completions'), QUERY, OPTIONS)
    const request = readRequest(mock)

    expect(request.url).toBe('https://search.example/v1/chat/completions')
    expect(request.body).toMatchObject({ model: 'fixture-search-model', web_search_options: {}, messages: expect.any(Array) })
    expect(JSON.stringify(request.body.messages)).toContain(QUERY)
    expect(result).toEqual([expect.objectContaining({ title: SOURCE.title, url: SOURCE.url })])
    expect(result[0].snippet).not.toBe(MODEL_TEXT)
  })

  it('rejects ordinary chat text containing URLs but no structured citations', async () => {
    const payload = chatPayload([])
    payload.choices[0].message.content = `[模型编造来源](${SOURCE.url})`
    mockPayload(payload)
    await expectSafeFailure(executeSourceSearch(runtime('chat-completions'), QUERY, OPTIONS), 'MISSING_SOURCES')
  })

  it.each(['length', 'content_filter', 'tool_calls'])('rejects unfinished or filtered chat choices (%s)', async finish_reason => {
    const payload = chatPayload()
    payload.choices[0].finish_reason = finish_reason
    mockPayload(payload)
    await expectSafeFailure(executeSourceSearch(runtime('chat-completions'), QUERY, OPTIONS), 'INVALID_RESPONSE')
  })
})

describe('source filtering and bounded safe transport', () => {
  it('filters unsafe URLs, normalizes and deduplicates before enforcing the result limit', async () => {
    mockPayload({ results: [
      ...['javascript:alert(1)', 'file:///secret', 'data:text/plain,secret', 'https://user:password@museum.example/secret'].map(url => ({ ...SOURCE, url })),
      SOURCE, { ...SOURCE, url: 'https://museum.example:443/clothing' },
      { ...SOURCE, url: 'https://university.example/archive', title: '大学档案' },
      { ...SOURCE, url: 'https://library.example/third', title: '第三条来源' },
    ] })
    const result = await executeSourceSearch(runtime('deepseek'), QUERY, { ...OPTIONS, maxResults: 2 })
    expect(result.map(source => source.url)).toEqual([SOURCE.url, 'https://university.example/archive'])
  })

  it('never lets echoed credentials become source titles, URLs or excerpts', async () => {
    mockPayload({ results: [
      { ...SOURCE, title: API_KEY }, { ...SOURCE, url: `https://museum.example/?token=${API_KEY}` },
      { ...SOURCE, snippet: `Authorization: Bearer ${API_KEY}` }, SOURCE,
    ] })
    const result = await executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject(SOURCE)
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })

  it.each(['tavily', 'brave', 'deepseek', 'responses', 'chat-completions'] as const)('refuses redirects for %s, including authenticated custom compatible endpoints', async protocol => {
    const payload = protocol === 'responses' ? responsesPayload() : protocol === 'chat-completions' ? chatPayload()
      : protocol === 'brave' ? { web: { results: [{ ...SOURCE, description: SOURCE.snippet }] } } : { results: [SOURCE] }
    const mock = mockPayload(payload)
    await executeSourceSearch(runtime(protocol, { providerName: 'custom', mode: 'custom' }), QUERY, OPTIONS)
    expect(readRequest(mock).init.redirect).toBe('error')
  })

  it.each([401, 402, 429, 503])('reports HTTP %s safely without reading the upstream error body', async status => {
    const body = vi.fn().mockRejectedValue(new Error(API_KEY))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text: body, json: body }))
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'HTTP_ERROR', status)
    expect(body).not.toHaveBeenCalled()
  })

  it('does not include key-bearing network errors in the returned error or logs', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`Authorization: Bearer ${API_KEY}`)))
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'NETWORK_ERROR')
    expect(JSON.stringify([warning.mock.calls, errorLog.mock.calls])).not.toContain(API_KEY)
  })

  it('rejects malformed JSON without echoing the response text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`{"secret":"${API_KEY}" invalid-json`)))
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'INVALID_RESPONSE')
  })

  it('rejects an application-level error even when HTTP status is 200', async () => {
    mockPayload({ error: { message: API_KEY }, results: [SOURCE] })
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'INVALID_RESPONSE')
  })

  it('rejects an excessive declared Content-Length before consuming the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: [] }, { 'Content-Length': String(MAX_BYTES + 1) })))
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'RESPONSE_TOO_LARGE')
  })

  it('enforces the response-byte limit on a streamed body without Content-Length', async () => {
    const cancel = vi.fn()
    const chunk = new Uint8Array(700 * 1024).fill(32)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { for (let index = 0; index < 4; index += 1) controller.enqueue(chunk) }, cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)))
    await expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, OPTIONS), 'RESPONSE_TOO_LARGE')
    expect(cancel).toHaveBeenCalled()
  })

  it('ends an unresponsive request on its deadline even if fetch ignores AbortSignal', async () => {
    vi.useFakeTimers()
    const mock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined))
    vi.stubGlobal('fetch', mock)
    const rejected = expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, { ...OPTIONS, timeoutMs: 25 }), 'TIMEOUT')
    await vi.advanceTimersByTimeAsync(25)
    await rejected
    expect(mock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('bounds a stalled response body as well as the initial HTTP request', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"results":[')) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)))
    const rejected = expectSafeFailure(executeSourceSearch(runtime('deepseek'), QUERY, { ...OPTIONS, timeoutMs: 25 }), 'TIMEOUT')
    await vi.advanceTimersByTimeAsync(25)
    await rejected
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['responses', 'chat-completions'] as const)('gives model-backed %s searches at least 30 seconds without an unbounded deadline', async protocol => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined)))
    const rejected = expectSafeFailure(executeSourceSearch(runtime(protocol), QUERY, OPTIONS), 'TIMEOUT')
    await vi.advanceTimersByTimeAsync(8000)
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(37000)
    await rejected
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
})
