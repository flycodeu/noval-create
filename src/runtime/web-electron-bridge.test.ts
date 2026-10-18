import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceSearchSettingsUpdate, SourceSearchSettingsView } from '../types'

const SOURCE_SETTINGS: SourceSearchSettingsView = {
  provider: 'custom', tavilyApiKeySet: false, braveApiKeySet: false,
  tavilyEnvSet: false, braveEnvSet: false, activeProvider: 'custom',
  platforms: { custom: { protocol: 'responses', baseUrl: 'https://search.example/v1', model: 'search-model', apiKeySet: true, envSet: false } },
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}

async function installBridge(demo = false) {
  const storage = new Map<string, string>()
  const setItem = vi.fn((key: string, value: string) => { storage.set(key, value) })
  vi.stubGlobal('window', {
    location: { search: demo ? '?demo=1' : '' },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem },
    setTimeout, clearTimeout,
  })
  const { installWebElectronBridge } = await import('./web-electron-bridge')
  installWebElectronBridge()
  return { sourceSearch: window.electron.sourceSearch, setItem, storage }
}

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Web search settings bridge', () => {
  it('forwards all platform fields unchanged to the real local RPC and never persists a browser copy', async () => {
    const calls: { service: string; method: string; args: unknown[] }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/health') return jsonResponse({ ok: true })
      const call = JSON.parse(String(init?.body))
      calls.push(call)
      return jsonResponse({ ok: true, data: call.method === 'test' ? { success: true, providerName: 'custom' } : SOURCE_SETTINGS })
    }))
    const { sourceSearch, setItem } = await installBridge()
    const input: SourceSearchSettingsUpdate = { provider: 'custom', platforms: { custom: {
      protocol: 'responses', baseUrl: 'https://search.example/v1', model: 'search-model', apiKey: 'test-only-draft-key',
    } } }
    expect(await sourceSearch.updateSettings(input)).toEqual(SOURCE_SETTINGS)
    await sourceSearch.test(input)
    await sourceSearch.test()
    expect(calls).toEqual([
      { service: 'sourceSearch', method: 'updateSettings', args: [input] },
      { service: 'sourceSearch', method: 'test', args: [input] },
      { service: 'sourceSearch', method: 'test', args: [] },
    ])
    expect(setItem).not.toHaveBeenCalled()
  })

  it('requires a local connection before saving credentials, even in explicit demo mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/health') return jsonResponse({ ok: true })
      throw new Error('Controlled offline RPC')
    }))
    const { sourceSearch, storage, setItem } = await installBridge(true)
    storage.set('novelforge.webPreview.sourceSearchSettings', JSON.stringify({ provider: 'brave', braveApiKeySet: true }))
    const input: SourceSearchSettingsUpdate = { provider: 'openai', platforms: { openai: {
      protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: 'fixture-model', apiKey: 'test-only-never-store-key',
    } } }
    await expect(sourceSearch.updateSettings(input)).rejects.toThrow('密钥不会保存在浏览器')
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify([...storage])).not.toContain('test-only-never-store-key')
    const settings = await sourceSearch.getSettings()
    expect(settings).toMatchObject({ provider: 'auto', activeProvider: null, tavilyApiKeySet: false, braveApiKeySet: false })
    expect(Object.keys(settings.platforms || {})).toEqual(['deepseek', 'openai', 'custom'])
    for (const platform of Object.values(settings.platforms || {})) expect(platform).toMatchObject({ apiKeySet: false, envSet: false })
    expect((await sourceSearch.test(input)).success).toBe(false)
  })

  it.each([
    ['test', 55_000], ['research', 100_000],
  ] as const)('gives sourceSearch.%s a bounded deadline long enough for model-backed searches', async (method, timeoutMs) => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/health') return jsonResponse({ ok: true })
      signal = init?.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('Controlled timeout', 'AbortError')), { once: true })
      })
    }))
    const { sourceSearch } = await installBridge()
    const pending = method === 'test' ? sourceSearch.test() : sourceSearch.research(1, '受控资料检索')
    const outcome = pending.then(() => null, error => error as Error)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(timeoutMs - 15_000)
    expect(signal?.aborted).toBe(true)
    expect((await outcome)?.message).toContain('请求超时')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the RPC deadline active while reading the response body', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/health') return jsonResponse({ ok: true })
      signal = init?.signal as AbortSignal
      return {
        status: 200,
        json: () => new Promise<unknown>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new DOMException('Controlled stalled body', 'AbortError')), { once: true })
        }),
      } as Response
    }))
    const { sourceSearch } = await installBridge()
    const outcome = sourceSearch.test().then(() => null, error => error as Error)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(signal?.aborted).toBe(true)
    expect((await outcome)?.message).toContain('请求超时')
    expect(vi.getTimerCount()).toBe(0)
  })
})
