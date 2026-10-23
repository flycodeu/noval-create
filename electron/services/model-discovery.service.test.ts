import { createServer, type Server, type RequestListener } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./model.service', () => ({
  decryptApiKey: vi.fn(() => { throw new Error('must not decrypt credentials without a matching config') }),
  getModelConfigRecord: vi.fn(() => { throw new Error('must not read a normal database in tests') }),
  normalizeModelProvider: (value: string) => {
    const provider = value.trim().toLowerCase()
    return provider === 'moonshot' ? 'kimi' : provider === 'claude' ? 'anthropic' : provider
  },
}))

import { discoverModels } from './model-discovery.service'

const API_KEY = 'test-only-api-key-not-a-real-secret'
const jsonResponse = (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'content-type': 'application/json' },
  ...init,
})
const jsonModels = (...models: string[]) => jsonResponse({ data: models.map((id) => ({ id })) })
const servers: Server[] = []

async function localServer(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('model discovery', () => {
  it.each([
    ['openai', 'https://api.openai.com/v1/models'],
    ['deepseek', 'https://api.deepseek.com/models'],
    ['kimi', 'https://api.moonshot.ai/v1/models'],
    ['moonshot', 'https://api.moonshot.ai/v1/models'],
  ])('fetches real %s model IDs without saving a config', async (provider, endpoint) => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(jsonModels('z-model', 'a-model', 'a-model'))
    const result = await discoverModels({ provider, apiKey: API_KEY }, { fetch: fetchModels })
    expect(result).toEqual({ models: ['a-model', 'z-model'] })
    expect(fetchModels).toHaveBeenCalledOnce()
    expect(fetchModels).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${API_KEY}` },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }))
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })

  it('uses Anthropic authentication and fetches subsequent pages', async () => {
    const fetchModels = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }))
      .mockResolvedValueOnce(jsonModels('claude-b'))
    expect(await discoverModels({ provider: 'anthropic', apiKey: API_KEY }, { fetch: fetchModels }))
      .toEqual({ models: ['claude-a', 'claude-b'] })
    expect(fetchModels).toHaveBeenNthCalledWith(1, 'https://api.anthropic.com/v1/models?limit=1000', expect.objectContaining({
      headers: { Accept: 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    }))
    expect(fetchModels).toHaveBeenNthCalledWith(2, 'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a', expect.any(Object))
  })

  it('uses the documented native Aliyun catalogue, model field and numbered pagination', async () => {
    const fetchModels = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ output: { total: 3, page_no: 1, models: [{ model: 'qwen-a' }, { model: 'qwen-b' }] } }))
      .mockResolvedValueOnce(jsonResponse({ output: { total: 3, page_no: 2, models: [{ model: 'qwen-c' }] } }))
    expect(await discoverModels({ provider: 'aliyun', apiKey: API_KEY }, { fetch: fetchModels }))
      .toEqual({ models: ['qwen-a', 'qwen-b', 'qwen-c'] })
    expect(fetchModels).toHaveBeenNthCalledWith(1, 'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=100', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: `Bearer ${API_KEY}` }, redirect: 'error',
    }))
    expect(fetchModels).toHaveBeenNthCalledWith(2, 'https://dashscope.aliyuncs.com/api/v1/models?page_no=2&page_size=100', expect.any(Object))
  })

  it('preserves explicitly configured Aliyun OpenAI-compatible endpoints and their real response', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(jsonModels('qwen-compatible'))
    expect(await discoverModels({ provider: 'aliyun', apiKey: API_KEY, baseUrl: 'https://coding.dashscope.aliyuncs.com/v1' }, { fetch: fetchModels }))
      .toEqual({ models: ['qwen-compatible'] })
    expect(fetchModels).toHaveBeenCalledWith('https://coding.dashscope.aliyuncs.com/v1/models', expect.any(Object))
  })

  it('reports an empty native Aliyun catalogue and rejects malformed or excessive native pagination', async () => {
    expect(await discoverModels({ provider: 'aliyun', apiKey: API_KEY }, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ output: { total: 0, models: [] } })),
    })).toEqual({ models: [] })
    const invalidPayloads = [
      { data: [{ id: 'wrong-shape' }] },
      { output: { total: -1, models: [] } },
      { output: { total: 1, models: [] } },
      { output: { total: 1, page_no: 2, models: [{ model: 'wrong-page' }] } },
      { success: false, output: { total: 0, models: [] }, message: API_KEY },
    ]
    for (const payload of invalidPayloads) {
      await expect(discoverModels({ provider: 'aliyun', apiKey: API_KEY }, {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload)),
      })).rejects.toMatchObject({ code: 'modelDiscovery.invalidResponse' })
    }
    await expect(discoverModels({ provider: 'aliyun', apiKey: API_KEY }, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ output: { total: 10_001, models: [] } })),
    })).rejects.toMatchObject({ code: 'modelDiscovery.tooLarge' })
  })

  it('normalizes trailing slashes and permits keyless local OpenAI-compatible models', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(jsonModels('local-model'))
    await discoverModels({ provider: 'custom', baseUrl: 'http://localhost:11434/v1///' }, { fetch: fetchModels })
    expect(fetchModels).toHaveBeenCalledWith('http://localhost:11434/v1/models', expect.objectContaining({
      headers: { Accept: 'application/json' },
    }))
  })

  it('uses a new unsaved key and URL without accessing saved credentials', async () => {
    const getConfig = vi.fn()
    const decryptKey = vi.fn()
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(jsonModels('new-model'))
    await discoverModels({
      provider: 'openai', apiKey: API_KEY, baseUrl: 'https://new.example/custom/v1', configId: 12,
    }, { fetch: fetchModels, getConfig, decryptKey })
    expect(getConfig).not.toHaveBeenCalled()
    expect(decryptKey).not.toHaveBeenCalled()
    expect(fetchModels).toHaveBeenCalledWith('https://new.example/custom/v1/models', expect.any(Object))
  })

  it.each([undefined, '已设置'])('reuses a masked saved key only for exactly matching provider and normalized URL (%s)', async (apiKey) => {
    const getConfig = vi.fn(() => ({ provider: 'openai', baseUrl: 'https://proxy.example:443/v1/', apiKey: 'encrypted-key' }))
    const decryptKey = vi.fn(() => API_KEY)
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(jsonModels('saved-model'))
    expect(await discoverModels({
      provider: 'openai', apiKey, configId: 12, baseUrl: 'https://proxy.example/v1',
    }, { fetch: fetchModels, getConfig, decryptKey })).toEqual({ models: ['saved-model'] })
    expect(getConfig).toHaveBeenCalledWith(12)
    expect(decryptKey).toHaveBeenCalledWith('encrypted-key')
    expect(fetchModels.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${API_KEY}` })
  })

  it.each([
    ['openai', 'https://new.example/v1'],
    ['openai', 'https://proxy.example/other/v1'],
    ['openai', 'http://proxy.example/v1'],
    ['openai', 'https://proxy.example:444/v1'],
    ['deepseek', 'https://proxy.example/v1'],
    ['openai', undefined],
  ])('does not decrypt or forward a saved key after changing provider or URL (%s, %s)', async (provider, baseUrl) => {
    const getConfig = vi.fn(() => ({ provider: 'openai', baseUrl: 'https://proxy.example/v1', apiKey: 'encrypted-key' }))
    const decryptKey = vi.fn(() => API_KEY)
    const fetchModels = vi.fn<typeof fetch>()
    await expect(discoverModels({ provider, apiKey: '已设置', configId: 12, baseUrl }, {
      fetch: fetchModels, getConfig, decryptKey,
    })).rejects.toMatchObject({ code: 'modelDiscovery.credentialsChanged' })
    expect(decryptKey).not.toHaveBeenCalled()
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('does not reuse a saved key after the user explicitly clears it', async () => {
    const getConfig = vi.fn()
    const fetchModels = vi.fn<typeof fetch>()
    await expect(discoverModels({ provider: 'openai', apiKey: '', configId: 12 }, { fetch: fetchModels, getConfig }))
      .rejects.toMatchObject({ code: 'model.apiKeyRequired' })
    expect(getConfig).not.toHaveBeenCalled()
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('supports a saved keyless custom config without trying to decrypt a key', async () => {
    const getConfig = vi.fn(() => ({ provider: 'custom', baseUrl: null, apiKey: null }))
    const decryptKey = vi.fn()
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(jsonModels('local-model'))
    expect(await discoverModels({ provider: 'custom', configId: 12 }, { fetch: fetchModels, getConfig, decryptKey }))
      .toEqual({ models: ['local-model'] })
    expect(decryptKey).not.toHaveBeenCalled()
  })

  it('reports missing configs and corrupt saved keys without exposing decrypt failures', async () => {
    await expect(discoverModels({ provider: 'openai', configId: 12 }, {
      getConfig: () => { throw new Error(API_KEY) },
    })).rejects.toMatchObject({ code: 'modelDiscovery.configNotFound' })
    await expect(discoverModels({ provider: 'openai', configId: 12 }, {
      getConfig: () => ({ provider: 'openai', apiKey: 'ciphertext' }),
      decryptKey: () => { throw new Error(API_KEY) },
    })).rejects.toMatchObject({ code: 'modelDiscovery.invalidStoredKey' })
  })

  it.each(['baidu', 'codex', 'claude_code', 'unknown', '__proto__'])('rejects %s rather than returning a fabricated list', async (provider) => {
    const fetchModels = vi.fn<typeof fetch>()
    await expect(discoverModels({ provider, apiKey: API_KEY }, { fetch: fetchModels }))
      .rejects.toMatchObject({ code: 'modelDiscovery.unsupportedProvider' })
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it.each([
    'ftp://example.test/v1', 'file:///local/model', 'javascript:alert(1)', 'not-a-url',
    'https://user:password@example.test/v1', 'https://user@example.test/v1',
    'https://example.test/v1?key=private', 'https://example.test/v1#private',
    'https://example.test/\nsecret',
  ])('rejects invalid URLs or URL credentials (%s)', async (baseUrl) => {
    const fetchModels = vi.fn<typeof fetch>()
    await expect(discoverModels({ provider: 'custom', baseUrl }, { fetch: fetchModels }))
      .rejects.toMatchObject({ code: 'modelDiscovery.invalidUrl' })
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('requires a remote API key and rejects malformed requests', async () => {
    const fetchModels = vi.fn<typeof fetch>()
    await expect(discoverModels({ provider: 'openai' }, { fetch: fetchModels })).rejects.toMatchObject({ code: 'model.apiKeyRequired' })
    await expect(discoverModels({ provider: 'openai', apiKey: '已设置' }, { fetch: fetchModels })).rejects.toMatchObject({ code: 'model.apiKeyRequired' })
    await expect(discoverModels({ provider: '' }, { fetch: fetchModels })).rejects.toMatchObject({ code: 'modelDiscovery.invalidInput' })
    await expect(discoverModels(null as never, { fetch: fetchModels })).rejects.toMatchObject({ code: 'modelDiscovery.invalidInput' })
    await expect(discoverModels({ provider: 'openai', configId: -1 }, { fetch: fetchModels })).rejects.toMatchObject({ code: 'modelDiscovery.invalidInput' })
    await expect(discoverModels({ provider: 'openai', apiKey: `${API_KEY}\ninvalid` }, { fetch: fetchModels })).rejects.toMatchObject({ code: 'modelDiscovery.invalidKey' })
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'modelDiscovery.unauthorized'], [403, 'modelDiscovery.unauthorized'],
    [404, 'modelDiscovery.noEndpoint'], [405, 'modelDiscovery.noEndpoint'], [429, 'modelDiscovery.httpError'],
  ])('reports HTTP %s without displaying provider bodies or credentials', async (status, code) => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(new Response(`Key ${API_KEY} from https://secret.example/`, { status }))
    const error = await discoverModels({ provider: 'openai', apiKey: API_KEY }, { fetch: fetchModels }).catch((cause) => cause)
    expect(error).toMatchObject({ code })
    expect(error.message).toContain(String(status))
    expect(error.message).not.toContain(API_KEY)
    expect(error.message).not.toContain('secret.example')
  })

  it('returns empty catalogues truthfully and rejects malformed responses', async () => {
    expect(await discoverModels({ provider: 'openai', apiKey: API_KEY }, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonModels()),
    })).toEqual({ models: [] })
    for (const payload of [{ error: API_KEY }, { data: null }, { data: [{ name: 'not-an-id' }] }, { data: [], error: { message: API_KEY } }]) {
      await expect(discoverModels({ provider: 'openai', apiKey: API_KEY }, {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload)),
      })).rejects.toMatchObject({ code: 'modelDiscovery.invalidResponse' })
    }
    await expect(discoverModels({ provider: 'openai', apiKey: API_KEY }, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(API_KEY)),
    })).rejects.toMatchObject({ code: 'modelDiscovery.invalidResponse' })
  })

  it('does not send a saved key back to the renderer when an endpoint reflects it as a model ID', async () => {
    await expect(discoverModels({ provider: 'openai', configId: 12 }, {
      getConfig: () => ({ provider: 'openai', apiKey: 'ciphertext' }),
      decryptKey: () => API_KEY,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonModels(`echo-${API_KEY}`)),
    })).rejects.toMatchObject({ code: 'modelDiscovery.invalidResponse' })
  })

  it('bounds oversized model catalogues and response bodies', async () => {
    const cases = [
      jsonResponse({ data: Array.from({ length: 10_001 }, (_, index) => ({ id: `model-${index}` })) }),
      new Response('small', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
      new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    ]
    for (const response of cases) {
      await expect(discoverModels({ provider: 'openai', apiKey: API_KEY }, {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      })).rejects.toMatchObject({ code: 'modelDiscovery.tooLarge' })
    }
  })

  it('rejects cyclic pagination and bounds excessive page counts', async () => {
    const cycle = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({
      data: [{ id: 'same-id' }], has_more: true, last_id: 'same-id',
    }))
    await expect(discoverModels({ provider: 'openai', apiKey: API_KEY }, { fetch: cycle }))
      .rejects.toMatchObject({ code: 'modelDiscovery.invalidResponse' })
    expect(cycle).toHaveBeenCalledTimes(2)
    let counter = 0
    const excessive = vi.fn<typeof fetch>().mockImplementation(async () => {
      const id = `model-${++counter}`
      return jsonResponse({ data: [{ id }], has_more: true, last_id: id })
    })
    await expect(discoverModels({ provider: 'openai', apiKey: API_KEY }, { fetch: excessive }))
      .rejects.toMatchObject({ code: 'modelDiscovery.tooLarge' })
    expect(excessive).toHaveBeenCalledTimes(20)
  })

  it('removes fetch errors that might echo credentials or URLs', async () => {
    const error = await discoverModels({ provider: 'openai', apiKey: API_KEY }, {
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error(`Bearer ${API_KEY} at https://secret.example/`)),
    }).catch((cause) => cause)
    expect(error).toMatchObject({ code: 'modelDiscovery.networkError' })
    expect(error.message).not.toContain(API_KEY)
    expect(error.message).not.toContain('secret.example')
  })

  it('times out hung requests even when a fetch implementation ignores abort', async () => {
    vi.useFakeTimers()
    const fetchModels = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined))
    const result = discoverModels({ provider: 'openai', apiKey: API_KEY }, { fetch: fetchModels, timeoutMs: 40 })
    const assertion = expect(result).rejects.toMatchObject({ code: 'modelDiscovery.timeout' })
    await vi.advanceTimersByTimeAsync(40)
    await assertion
    expect(fetchModels.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('bounds a body stream that stalls after response headers', async () => {
    vi.useFakeTimers()
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start() {} })))
    const result = discoverModels({ provider: 'openai', apiKey: API_KEY }, { fetch: fetchModels, timeoutMs: 40 })
    const assertion = expect(result).rejects.toMatchObject({ code: 'modelDiscovery.timeout' })
    await vi.advanceTimersByTimeAsync(40)
    await assertion
  })

  it('exercises a real local HTTP model endpoint without touching any model database', async () => {
    const requests: Array<{ path?: string; authorization?: string }> = []
    const endpoint = await localServer((request, response) => {
      requests.push({ path: request.url, authorization: request.headers.authorization })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'loopback-a' }, { id: 'loopback-b' }] }))
    })
    expect(await discoverModels({ provider: 'custom', baseUrl: `${endpoint}/v1`, apiKey: API_KEY }))
      .toEqual({ models: ['loopback-a', 'loopback-b'] })
    expect(requests).toEqual([{ path: '/v1/models', authorization: `Bearer ${API_KEY}` }])
  })

  it('does not forward credentials to a cross-origin redirect target', async () => {
    let redirectedRequests = 0
    const target = await localServer((_request, response) => {
      redirectedRequests += 1
      response.end(JSON.stringify({ data: [{ id: 'must-not-reach' }] }))
    })
    const source = await localServer((_request, response) => {
      response.writeHead(302, { location: `${target}/v1/models` })
      response.end()
    })
    await expect(discoverModels({ provider: 'custom', baseUrl: `${source}/v1`, apiKey: API_KEY }))
      .rejects.toMatchObject({ code: 'modelDiscovery.networkError' })
    expect(redirectedRequests).toBe(0)
  })
})
