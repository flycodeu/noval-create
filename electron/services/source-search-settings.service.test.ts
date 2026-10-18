import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({ getSqlite: vi.fn() }))
vi.mock('./model.service', () => ({
  decryptApiKey: vi.fn((value: string) => value.replace(/^enc:/, '')),
  encryptApiKey: vi.fn((value: string) => `enc:${value}`),
}))

import { getSqlite } from '../database/db'
import { decryptApiKey, encryptApiKey } from './model.service'
import {
  getSourceSearchRuntimeConfig,
  getSourceSearchSettings,
  testSourceSearchSettings,
  updateSourceSearchSettings,
} from './source-search-settings.service'
import { SOURCE_SEARCH_PLATFORM_DEFAULTS, type SourceSearchPlatformName, type SourceSearchProtocol } from '../../src/shared/source-search'

interface SettingsRow {
  id: number
  provider: string
  tavily_api_key: string | null
  brave_api_key: string | null
  platforms_json?: string | null
  updated_at: string | null
}

let row: SettingsRow | undefined
let tableExists: boolean
let hasPlatformColumn: boolean
const exec = vi.fn((sql: string) => {
  if (/CREATE TABLE/u.test(sql) && !tableExists) {
    tableExists = true
    hasPlatformColumn = true
    row = { id: 1, provider: 'auto', tavily_api_key: null, brave_api_key: null, platforms_json: null, updated_at: null }
  }
  if (/ALTER TABLE source_search_settings ADD COLUMN platforms_json/u.test(sql)) hasPlatformColumn = true
})
const run = vi.fn()
const prepare = vi.fn((sql: string) => {
  if (sql.includes('sqlite_master')) {
    return { get: () => tableExists ? { name: 'source_search_settings' } : undefined }
  }
  if (/PRAGMA table_info\(source_search_settings\)/u.test(sql)) {
    return { all: () => ['id', 'provider', 'tavily_api_key', 'brave_api_key', 'updated_at', ...(hasPlatformColumn ? ['platforms_json'] : [])].map(name => ({ name })) }
  }
  if (/SELECT\s+\*\s+FROM source_search_settings/u.test(sql)) return { get: () => row ? { ...row } : undefined }
  if (sql.includes('UPDATE source_search_settings')) {
    return { run: (...values: unknown[]) => {
      run(...values)
      row = {
        id: 1,
        provider: values[0] as string,
        tavily_api_key: values[1] as string | null,
        brave_api_key: values[2] as string | null,
        updated_at: values[3] as string,
        platforms_json: values[4] as string,
      }
    } }
  }
  return { run }
})

const SOURCE = { title: '测试资料', url: 'https://museum.example/reference', snippet: '可核对的资料摘要。' }

function mockSuccessfulFetch(protocol: SourceSearchProtocol = 'tavily') {
  const payload = protocol === 'brave' ? { web: { results: [{ ...SOURCE, description: SOURCE.snippet }] } }
    : protocol === 'responses' ? {
      status: 'completed', output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: SOURCE.url, title: SOURCE.title }] } },
      ],
    }
      : protocol === 'chat-completions' ? { choices: [{ finish_reason: 'stop', message: { annotations: [{ type: 'url_citation', url_citation: SOURCE }] } }] }
        : { results: [{ ...SOURCE, content: SOURCE.snippet }] }
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function storePlatforms(platforms: Partial<Record<SourceSearchPlatformName, Record<string, unknown>>>) {
  row!.platforms_json = JSON.stringify(platforms)
}

function storedPlatforms(): Record<SourceSearchPlatformName, Record<string, unknown>> {
  return JSON.parse(row!.platforms_json!)
}

function expectNoPersistence() {
  expect(exec).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
  expect(encryptApiKey).not.toHaveBeenCalled()
  expect(prepare.mock.calls.every(([sql]) => /^\s*SELECT\b/u.test(sql))).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  tableExists = true
  hasPlatformColumn = true
  row = {
    id: 1,
    provider: 'tavily',
    tavily_api_key: 'enc:saved-tavily-key',
    brave_api_key: 'enc:saved-brave-key',
    platforms_json: null,
    updated_at: '2026-10-17T10:00:00.000Z',
  }
  vi.mocked(getSqlite).mockReturnValue({ exec, prepare } as never)
  vi.mocked(decryptApiKey).mockImplementation(value => value.replace(/^enc:/, ''))
  vi.stubEnv('TAVILY_API_KEY', '')
  vi.stubEnv('BRAVE_SEARCH_API_KEY', '')
  vi.stubEnv('DEEPSEEK_SEARCH_API_KEY', '')
  vi.stubEnv('OPENAI_SEARCH_API_KEY', '')
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  mockSuccessfulFetch()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('source-search settings connection test', () => {
  it('keeps the no-argument API working with saved credentials without writing settings', async () => {
    const result = await testSourceSearchSettings()

    expect(result).toMatchObject({ success: true, providerName: 'tavily', info: '连接成功，返回 1 条测试结果。' })
    expect(fetch).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: 'Bearer saved-tavily-key' }),
    }))
    expectNoPersistence()
  })

  it('tests an unsaved provider and key without changing the stored row or timestamp', async () => {
    const original = { ...row! }
    const fetchMock = mockSuccessfulFetch('brave')

    const result = await testSourceSearchSettings({ provider: 'brave', braveApiKey: '  draft-brave-key  ' })

    expect(result).toMatchObject({ success: true, providerName: 'brave' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api.search.brave.com'), expect.objectContaining({
      headers: expect.objectContaining({ 'X-Subscription-Token': 'draft-brave-key' }),
    }))
    expect(row).toEqual(original)
    expectNoPersistence()
  })

  it('can test a draft before the settings table exists, without creating the table', async () => {
    tableExists = false
    row = undefined

    expect(await testSourceSearchSettings({ provider: 'tavily', tavilyApiKey: 'draft-first-key' }))
      .toMatchObject({ success: true, providerName: 'tavily' })
    expect(row).toBeUndefined()
    expect(prepare).toHaveBeenCalledTimes(1)
    expectNoPersistence()
  })

  it('does not insert a settings row when the table is empty', async () => {
    row = undefined

    expect(await testSourceSearchSettings()).toMatchObject({ success: false, providerName: null, latency: 0 })
    expect(fetch).not.toHaveBeenCalled()
    expect(row).toBeUndefined()
    expectNoPersistence()
  })

  it('does not search when the unsaved mode is disabled, even with configured keys', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'env-tavily-key')

    expect(await testSourceSearchSettings({ provider: 'disabled', tavilyApiKey: 'draft-tavily-key' }))
      .toEqual({ success: false, providerName: null, latency: 0, info: '来源检索已关闭。' })
    expect(fetch).not.toHaveBeenCalled()
    expectNoPersistence()
  })

  it('keeps saved keys when the submitted field is masked or omitted', async () => {
    await testSourceSearchSettings({ tavilyApiKey: ' 已设置 ' })
    await testSourceSearchSettings({})

    expect(fetch).toHaveBeenCalledTimes(2)
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer saved-tavily-key' })
    }
    expectNoPersistence()
  })

  it('uses an unsaved key with the saved provider when no provider override is supplied', async () => {
    await testSourceSearchSettings({ tavilyApiKey: 'draft-tavily-key' })

    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer draft-tavily-key' }),
    }))
    expect(row?.tavily_api_key).toBe('enc:saved-tavily-key')
    expectNoPersistence()
  })

  it('temporarily clears an explicitly blank key without deleting its saved value', async () => {
    const result = await testSourceSearchSettings({ tavilyApiKey: '  ' })

    expect(result).toMatchObject({ success: false, providerName: null, latency: 0 })
    expect(result.info).toContain('未配置可用')
    expect(fetch).not.toHaveBeenCalled()
    expect(row?.tavily_api_key).toBe('enc:saved-tavily-key')
    expectNoPersistence()
  })

  it('retains environment fallback when a saved key is temporarily cleared', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'env-tavily-key')

    expect(await testSourceSearchSettings({ tavilyApiKey: '' })).toMatchObject({ success: true, providerName: 'tavily' })
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer env-tavily-key' }),
    }))
    expectNoPersistence()
  })

  it.each([
    ['env-tavily-key', 'env-brave-key', 'tavily', 'env-tavily-key'],
    ['', 'env-brave-key', 'brave', 'env-brave-key'],
    ['', '', 'tavily', 'saved-tavily-key'],
  ] as const)('keeps auto-mode priority with Tavily env %s and Brave env %s', async (tavilyEnv, braveEnv, provider, key) => {
    vi.stubEnv('TAVILY_API_KEY', tavilyEnv)
    vi.stubEnv('BRAVE_SEARCH_API_KEY', braveEnv)
    mockSuccessfulFetch(provider)

    expect(await testSourceSearchSettings({ provider: 'auto' })).toMatchObject({ success: true, providerName: provider })
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining(provider === 'tavily' ? { Authorization: `Bearer ${key}` } : { 'X-Subscription-Token': key }),
    }))
    expectNoPersistence()
  })

  it('uses a draft Brave key in auto mode when the Tavily draft field is cleared', async () => {
    mockSuccessfulFetch('brave')

    expect(await testSourceSearchSettings({ provider: 'auto', tavilyApiKey: '', braveApiKey: 'draft-brave-key' }))
      .toMatchObject({ success: true, providerName: 'brave' })
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ 'X-Subscription-Token': 'draft-brave-key' }),
    }))
    expectNoPersistence()
  })

  it('prefers the draft key over environment fallback when a provider is explicitly selected', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'env-tavily-key')

    await testSourceSearchSettings({ provider: 'tavily', tavilyApiKey: 'draft-tavily-key' })

    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer draft-tavily-key' }),
    }))
    expectNoPersistence()
  })

  it('reports a failed HTTP status without reading or exposing the provider body', async () => {
    const body = vi.fn().mockResolvedValue('secret-error-body draft-tavily-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: body, json: body }))

    const result = await testSourceSearchSettings({ tavilyApiKey: 'draft-tavily-key' })

    expect(result).toMatchObject({ success: false, providerName: 'tavily' })
    expect(result.info).toContain('HTTP 401')
    expect(result.info).not.toContain('draft-tavily-key')
    expect(body).not.toHaveBeenCalled()
    expectNoPersistence()
  })

  it.each([
    new Error('Authorization: Bearer draft-tavily-key'),
    { message: 'draft-tavily-key', toString: () => 'draft-tavily-key' },
  ])('does not echo key-bearing network exceptions', async error => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))

    const result = await testSourceSearchSettings({ tavilyApiKey: 'draft-tavily-key' })

    expect(result).toMatchObject({ success: false, providerName: 'tavily' })
    expect(result.info).toBe('连接失败，请检查 API Key、网络和服务状态后重试。')
    expect(result.info).not.toContain('draft-tavily-key')
    expectNoPersistence()
  })

  it('does not expose key-bearing JSON parsing errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"secret":"draft-tavily-key" invalid-json')))

    const result = await testSourceSearchSettings({ tavilyApiKey: 'draft-tavily-key' })

    expect(result).toMatchObject({ success: false, providerName: 'tavily' })
    expect(result.info).not.toContain('draft-tavily-key')
    expectNoPersistence()
  })

  it('aborts a timed-out request and returns a safe error without saving the draft', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('draft-tavily-key'), { name: 'AbortError' })))
    })))

    const pending = testSourceSearchSettings({ tavilyApiKey: 'draft-tavily-key' })
    await vi.advanceTimersByTimeAsync(8000)

    expect(await pending).toMatchObject({ success: false, providerName: 'tavily', latency: 8000, info: '连接超时，请检查网络后重试。' })
    expectNoPersistence()
  })

  it('does not include key-bearing decryption errors in logs or results', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(decryptApiKey).mockImplementation(() => { throw new Error('saved-tavily-key') })

    const result = await testSourceSearchSettings()

    expect(result.success).toBe(false)
    expect(result.info).not.toContain('saved-tavily-key')
    expect(warning).toHaveBeenCalled()
    expect(JSON.stringify(warning.mock.calls)).not.toContain('saved-tavily-key')
    expectNoPersistence()
  })
})

describe('source-search settings save', () => {
  it('still encrypts new keys, preserves masked keys, and clears an explicitly blank key only on save', () => {
    updateSourceSearchSettings({ provider: 'brave', tavilyApiKey: '已设置', braveApiKey: ' new-brave-key ' })

    expect(row).toMatchObject({ provider: 'brave', tavily_api_key: 'enc:saved-tavily-key', brave_api_key: 'enc:new-brave-key' })
    expect(encryptApiKey).toHaveBeenCalledTimes(1)
    expect(encryptApiKey).toHaveBeenCalledWith('new-brave-key')

    updateSourceSearchSettings({ braveApiKey: '' })

    expect(row).toMatchObject({ provider: 'brave', tavily_api_key: 'enc:saved-tavily-key', brave_api_key: null })
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('independent platform credentials and saved configuration', () => {
  it('encrypts each platform key independently and returns only public configuration and flags', () => {
    const view = updateSourceSearchSettings({
      provider: 'deepseek',
      platforms: {
        deepseek: { apiKey: ' draft-deepseek-key ' },
        openai: { apiKey: 'draft-openai-key' },
        custom: { protocol: 'chat-completions', baseUrl: 'https://gateway.example/v1', model: 'gateway-search', apiKey: 'draft-custom-key' },
      },
    })

    expect(storedPlatforms()).toMatchObject({
      deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:draft-deepseek-key' },
      openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:draft-openai-key' },
      custom: { protocol: 'chat-completions', baseUrl: 'https://gateway.example/v1', model: 'gateway-search', apiKey: 'enc:draft-custom-key' },
    })
    expect(encryptApiKey).toHaveBeenCalledTimes(3)
    expect(view).toMatchObject({
      provider: 'deepseek', activeProvider: 'deepseek',
      platforms: {
        deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKeySet: true, envSet: false },
        openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKeySet: true, envSet: false },
        custom: { baseUrl: 'https://gateway.example/v1', apiKeySet: true, envSet: false },
      },
    })
    expect(JSON.stringify(view)).not.toContain('draft-')
    expect(JSON.stringify(view)).not.toContain('enc:')
    expect(run.mock.calls[0][5]).toBe(1)
  })

  it('merges nested platform changes without changing another slot, legacy key, or masked encryption', () => {
    storePlatforms({
      deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' },
      openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' },
      custom: { protocol: 'responses', baseUrl: 'https://gateway.example/v1', model: 'custom-before', apiKey: 'enc:saved-custom-key' },
    })
    const before = storedPlatforms()

    updateSourceSearchSettings({ platforms: { deepseek: { apiKey: ' 已设置 ' }, custom: { model: 'custom-after', apiKey: undefined } } })

    expect(storedPlatforms()).toEqual({ ...before, custom: { ...before.custom, model: 'custom-after' } })
    expect(row).toMatchObject({ tavily_api_key: 'enc:saved-tavily-key', brave_api_key: 'enc:saved-brave-key' })
    expect(encryptApiKey).not.toHaveBeenCalled()
  })

  it('preserves explicitly undefined public fields in a partial update instead of resetting them to defaults', () => {
    storePlatforms({ custom: { protocol: 'tavily', baseUrl: 'https://gateway.example/v1', model: 'user-retained-model', apiKey: 'enc:saved-custom-key' } })
    const before = storedPlatforms().custom

    updateSourceSearchSettings({ platforms: { custom: { protocol: undefined, baseUrl: undefined, model: undefined, apiKey: undefined } } })

    expect(storedPlatforms().custom).toEqual(before)
    expect(encryptApiKey).not.toHaveBeenCalled()
  })

  it('clears only the explicitly blank platform key while retaining its public endpoint configuration', () => {
    storePlatforms({
      deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' },
      openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' },
    })

    const view = updateSourceSearchSettings({ provider: 'deepseek', platforms: { deepseek: { apiKey: '  ' } } })

    expect(storedPlatforms().deepseek).toEqual({ ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: null })
    expect(storedPlatforms().openai.apiKey).toBe('enc:saved-openai-key')
    expect(view).toMatchObject({ activeProvider: null, platforms: { deepseek: { apiKeySet: false }, openai: { apiKeySet: true } } })
    expect(encryptApiKey).not.toHaveBeenCalled()
  })

  it.each([
    { baseUrl: 'https://different.example/v1' },
    { baseUrl: 'https://api.openai.com/v2' },
    { protocol: 'chat-completions' },
  ])('rejects saved-key reuse when endpoint or protocol identity changes (%j)', patch => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' } })
    const original = { ...row! }

    for (const apiKey of [undefined, '已设置']) {
      expect(() => updateSourceSearchSettings({ platforms: { openai: { ...patch, apiKey } } })).toThrow('重新填写')
    }

    expect(row).toEqual(original)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows a changed endpoint only with an explicit replacement or clear, without reusing the old ciphertext', () => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' } })

    updateSourceSearchSettings({ platforms: { openai: { baseUrl: 'https://gateway.example/v1', apiKey: 'replacement-key' } } })
    expect(storedPlatforms().openai).toMatchObject({ baseUrl: 'https://gateway.example/v1', apiKey: 'enc:replacement-key' })

    updateSourceSearchSettings({ platforms: { openai: { protocol: 'chat-completions', model: 'search-chat', apiKey: '' } } })
    expect(storedPlatforms().openai).toMatchObject({ protocol: 'chat-completions', model: 'search-chat', apiKey: null })
    expect(encryptApiKey).toHaveBeenCalledTimes(1)
  })

  it('treats the same normalized URL as the same credential scope', () => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' } })

    updateSourceSearchSettings({ platforms: { openai: { baseUrl: ' https://API.OPENAI.COM:443/v1/ ', apiKey: '已设置' } } })

    expect(storedPlatforms().openai).toMatchObject({ baseUrl: SOURCE_SEARCH_PLATFORM_DEFAULTS.openai.baseUrl, apiKey: 'enc:saved-openai-key' })
    expect(encryptApiKey).not.toHaveBeenCalled()
  })

  it('allows a model-only change to retain the same endpoint-scoped key', () => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' } })

    updateSourceSearchSettings({ provider: 'openai', platforms: { openai: { model: 'user-selected-search-model', apiKey: '已设置' } } })

    expect(getSourceSearchRuntimeConfig()).toMatchObject({ model: 'user-selected-search-model', apiKey: 'saved-openai-key' })
    expect(encryptApiKey).not.toHaveBeenCalled()
  })

  it('does not accept a masked key from another slot, even when both endpoints are identical', async () => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' } })
    const patch = { provider: 'custom', platforms: { custom: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: '已设置' } } }

    expect(await testSourceSearchSettings(patch)).toMatchObject({ success: false, providerName: null, info: expect.stringContaining('尚无已保存') })
    expectNoPersistence()
    expect(() => updateSourceSearchSettings(patch)).toThrow('尚无已保存')
    expect(run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { custom: { protocol: 'responses', apiKey: 'draft-custom-key', model: 'fixture-model', baseUrl: '' } },
    { custom: { protocol: 'responses', apiKey: 'draft-custom-key', model: '', baseUrl: 'https://gateway.example/v1' } },
    { openai: { apiKey: 'draft-openai-key', model: '' } },
  ])('does not save a key with incomplete endpoint/model configuration (%j)', platforms => {
    const original = { ...row! }
    expect(() => updateSourceSearchSettings({ platforms })).toThrow()
    expect(row).toEqual(original)
    expect(run).not.toHaveBeenCalled()
  })

  it('reads legacy rows with missing platforms_json during draft tests without migration', async () => {
    hasPlatformColumn = false
    delete row!.platforms_json
    mockSuccessfulFetch('deepseek')
    const original = { ...row! }

    expect(await testSourceSearchSettings({ provider: 'deepseek', platforms: { deepseek: { apiKey: 'draft-deepseek-key' } } }))
      .toMatchObject({ success: true, providerName: 'deepseek' })

    expect(row).toEqual(original)
    expect(hasPlatformColumn).toBe(false)
    expectNoPersistence()
  })

  it('migrates the legacy table only on an intentional settings read', () => {
    hasPlatformColumn = false
    delete row!.platforms_json

    const view = getSourceSearchSettings()

    expect(exec).toHaveBeenCalledWith('ALTER TABLE source_search_settings ADD COLUMN platforms_json TEXT')
    expect(hasPlatformColumn).toBe(true)
    expect(view.platforms).toMatchObject({
      deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKeySet: false },
      openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKeySet: false },
      custom: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.custom, apiKeySet: false },
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('platform draft requests and runtime consistency', () => {
  it.each([
    ['deepseek', 'deepseek'],
    ['openai', 'responses'],
    ['openai', 'chat-completions'],
  ] as const)('tests %s %s drafts using the same protocol contract as the saved runtime', async (slot, protocol) => {
    const fetchMock = mockSuccessfulFetch(protocol)
    const patch = { protocol, apiKey: ' draft-search-key ', model: protocol === 'deepseek' ? '' : 'configured-search-model' }
    const original = { ...row! }

    expect(await testSourceSearchSettings({ provider: slot, platforms: { [slot]: patch } })).toMatchObject({ success: true, providerName: slot })
    expectNoPersistence()
    expect(row).toEqual(original)
    const [draftUrl, draftInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(draftInit.headers).toMatchObject({ Authorization: 'Bearer draft-search-key' })
    expect(JSON.parse(String(draftInit.body))).toMatchObject(protocol === 'deepseek'
      ? { query: '小说创作 真实资料 检索', count: 1, need_content: false }
      : { model: 'configured-search-model' })

    updateSourceSearchSettings({ provider: slot, platforms: { [slot]: patch } })
    expect(getSourceSearchRuntimeConfig()).toEqual({
      mode: slot, providerName: slot, apiKey: 'draft-search-key', protocol,
      baseUrl: SOURCE_SEARCH_PLATFORM_DEFAULTS[slot].baseUrl,
      model: patch.model,
    })
    expect(await testSourceSearchSettings()).toMatchObject({ success: true, providerName: slot })
    const [savedUrl, savedInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(savedUrl).toBe(draftUrl)
    expect(savedInit.headers).toEqual(draftInit.headers)
    expect(savedInit.body).toEqual(draftInit.body)
  })

  it.each(['tavily', 'brave', 'deepseek', 'responses', 'chat-completions'] as const)('explicitly dispatches custom %s drafts without sending their key to an unrelated platform', async protocol => {
    const fetchMock = mockSuccessfulFetch(protocol)

    const result = await testSourceSearchSettings({ provider: 'custom', platforms: { custom: {
      protocol, baseUrl: 'http://127.0.0.1:18090/v1', model: 'fixture-search-model', apiKey: 'draft-custom-key',
    } } })

    expect(result).toMatchObject({ success: true, providerName: 'custom' })
    const [requestUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(requestUrl).toMatch(/^http:\/\/127\.0\.0\.1:18090\//u)
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject(protocol === 'brave'
      ? { 'X-Subscription-Token': 'draft-custom-key' } : { Authorization: 'Bearer draft-custom-key' })
    expectNoPersistence()
  })

  it('tests an explicitly edited new platform even while saved automatic selection would choose Tavily', async () => {
    row!.provider = 'auto'
    mockSuccessfulFetch('deepseek')

    expect(await testSourceSearchSettings({ provider: 'deepseek', platforms: { deepseek: { apiKey: 'draft-deepseek-key' } } }))
      .toMatchObject({ success: true, providerName: 'deepseek' })
    expect(fetch).toHaveBeenCalledWith('https://api.deepseek.com/v1/tools/search', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer draft-deepseek-key' }),
    }))
    expect(row!.provider).toBe('auto')
    expectNoPersistence()
  })

  it.each([undefined, '已设置'])('uses a same-slot saved key for a missing/masked draft (%s)', async apiKey => {
    row!.provider = 'deepseek'
    storePlatforms({ deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' } })
    mockSuccessfulFetch('deepseek')

    expect(await testSourceSearchSettings({ platforms: { deepseek: { apiKey } } })).toMatchObject({ success: true, providerName: 'deepseek' })
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer saved-deepseek-key' }),
    }))
    expectNoPersistence()
  })

  it('does not delete a platform key during an explicitly blank draft test', async () => {
    row!.provider = 'deepseek'
    storePlatforms({ deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' } })
    const original = { ...row! }

    expect(await testSourceSearchSettings({ platforms: { deepseek: { apiKey: '' } } })).toMatchObject({ success: false, providerName: null })
    expect(fetch).not.toHaveBeenCalled()
    expect(row).toEqual(original)
    expectNoPersistence()
  })

  it.each([
    [undefined, { baseUrl: 'https://untrusted.example/v1' }],
    ['已设置', { baseUrl: 'https://untrusted.example/v1' }],
    [undefined, { protocol: 'chat-completions' }],
    ['已设置', { protocol: 'chat-completions' }],
  ])('never sends an old slot key to a changed draft URL/protocol (%s, %j)', async (apiKey, patch) => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' } })

    expect(await testSourceSearchSettings({ provider: 'openai', platforms: { openai: { ...patch, apiKey } } }))
      .toMatchObject({ success: false, providerName: null, info: expect.stringContaining('重新填写') })
    expect(fetch).not.toHaveBeenCalled()
    expectNoPersistence()
  })

  it('reports corrupt platform JSON without returning raw stored credentials', async () => {
    row!.provider = 'deepseek'
    row!.platforms_json = '{"apiKey":"do-not-echo-corrupted-key" invalid-json'

    const result = await testSourceSearchSettings()

    expect(result).toMatchObject({ success: false, providerName: null, info: expect.stringContaining('无法读取') })
    expect(result.info).not.toContain('do-not-echo-corrupted-key')
    expect(fetch).not.toHaveBeenCalled()
    expectNoPersistence()
  })
})

describe('search-only environment keys and automatic priority', () => {
  it.each([
    ['deepseek', 'DEEPSEEK_SEARCH_API_KEY', 'deepseek'],
    ['openai', 'OPENAI_SEARCH_API_KEY', 'responses'],
  ] as const)('uses %s search-only environment keys only for the official default endpoint', async (slot, envName, protocol) => {
    vi.stubEnv(envName, 'environment-search-key')
    mockSuccessfulFetch(protocol)

    expect(await testSourceSearchSettings({ provider: slot })).toMatchObject({ success: true, providerName: slot })
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer environment-search-key' }),
    }))
    expectNoPersistence()
    vi.mocked(fetch).mockClear()

    expect(await testSourceSearchSettings({ provider: slot, platforms: { [slot]: { baseUrl: 'https://gateway.example/v1' } } }))
      .toMatchObject({ success: false, providerName: null })
    expect(fetch).not.toHaveBeenCalled()
    expectNoPersistence()
  })

  it('never inherits writing-model credentials or another slot environment key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'writing-openai-key')
    vi.stubEnv('DEEPSEEK_API_KEY', 'writing-deepseek-key')

    for (const provider of ['deepseek', 'openai', 'custom'] as const) {
      expect(await testSourceSearchSettings({ provider, platforms: { custom: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai } } }))
        .toMatchObject({ success: false, providerName: null })
    }
    vi.stubEnv('OPENAI_SEARCH_API_KEY', 'search-openai-key')
    expect(await testSourceSearchSettings({ provider: 'custom', platforms: { custom: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai } } }))
      .toMatchObject({ success: false, providerName: null })
    expect(fetch).not.toHaveBeenCalled()
    expectNoPersistence()
  })

  it('prefers a slot draft key over its search environment key and permits explicit clear to fall back', async () => {
    vi.stubEnv('DEEPSEEK_SEARCH_API_KEY', 'environment-search-key')
    storePlatforms({ deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' } })
    mockSuccessfulFetch('deepseek')

    await testSourceSearchSettings({ provider: 'deepseek', platforms: { deepseek: { apiKey: 'draft-deepseek-key' } } })
    await testSourceSearchSettings({ provider: 'deepseek', platforms: { deepseek: { apiKey: '' } } })

    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer draft-deepseek-key' })
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer environment-search-key' })
    expect(storedPlatforms().deepseek.apiKey).toBe('enc:saved-deepseek-key')
    expectNoPersistence()
  })

  it('reports environment availability only in its official platform slot', () => {
    vi.stubEnv('OPENAI_SEARCH_API_KEY', 'environment-search-key')
    vi.stubEnv('DEEPSEEK_SEARCH_API_KEY', 'environment-deepseek-key')
    storePlatforms({ custom: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai } })

    expect(getSourceSearchSettings().platforms).toMatchObject({ deepseek: { envSet: true }, openai: { envSet: true }, custom: { envSet: false } })
    updateSourceSearchSettings({ platforms: { openai: { baseUrl: 'https://gateway.example/v1' } } })
    expect(getSourceSearchSettings().platforms?.openai?.envSet).toBe(false)
  })

  it.each([
    ['env-tavily-key', 'env-brave-key', 'tavily', 'env-tavily-key'],
    ['', 'env-brave-key', 'brave', 'env-brave-key'],
    ['', '', 'tavily', 'saved-tavily-key'],
  ] as const)('retains the old automatic priority before new configured platforms (%s, %s)', (tavilyEnv, braveEnv, providerName, apiKey) => {
    vi.stubEnv('TAVILY_API_KEY', tavilyEnv)
    vi.stubEnv('BRAVE_SEARCH_API_KEY', braveEnv)
    vi.stubEnv('DEEPSEEK_SEARCH_API_KEY', 'environment-deepseek-key')
    vi.stubEnv('OPENAI_SEARCH_API_KEY', 'environment-openai-key')
    storePlatforms({ deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' } })
    row!.provider = 'auto'

    expect(getSourceSearchRuntimeConfig()).toEqual({ mode: 'auto', providerName, apiKey })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls through saved Brave, then DeepSeek, OpenAI and custom without cross-slot reuse', () => {
    row!.provider = 'auto'
    row!.tavily_api_key = null
    storePlatforms({
      deepseek: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.deepseek, apiKey: 'enc:saved-deepseek-key' },
      openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-openai-key' },
      custom: { protocol: 'responses', baseUrl: 'https://gateway.example/v1', model: 'custom-search', apiKey: 'enc:saved-custom-key' },
    })
    expect(getSourceSearchRuntimeConfig()).toMatchObject({ mode: 'auto', providerName: 'brave', apiKey: 'saved-brave-key' })
    row!.brave_api_key = null
    expect(getSourceSearchRuntimeConfig()).toMatchObject({ mode: 'auto', providerName: 'deepseek', protocol: 'deepseek', apiKey: 'saved-deepseek-key' })
    const platforms = storedPlatforms()
    platforms.deepseek.apiKey = null
    storePlatforms(platforms)
    expect(getSourceSearchRuntimeConfig()).toMatchObject({ mode: 'auto', providerName: 'openai', protocol: 'responses', apiKey: 'saved-openai-key' })
    platforms.openai.apiKey = null
    storePlatforms(platforms)
    expect(getSourceSearchRuntimeConfig()).toMatchObject({ mode: 'auto', providerName: 'custom', protocol: 'responses', apiKey: 'saved-custom-key' })
  })
})

describe('invalid configuration boundaries', () => {
  it.each(['openai', 'disabled'])('rejects an incomplete environment-only model before writing (%s)', provider => {
    vi.stubEnv('OPENAI_SEARCH_API_KEY', 'test-only-env-search-key')
    const original = { ...row! }
    expect(() => updateSourceSearchSettings({ provider, platforms: { openai: { model: '' } } })).toThrow('请补齐')
    expect(run).not.toHaveBeenCalled()
    expect(row).toEqual(original)
  })

  it.each([
    { baseUrl: 'https://gateway.example/v1/draft-sensitive-search-key' },
    { model: 'search-model-draft-sensitive-search-key' },
    { baseUrl: 'https://gateway.example/v1/%64raft-sensitive-search-key' },
  ])('does not save or return public configuration containing its own candidate credential (%j)', async patch => {
    const original = { ...row! }
    const payload = { provider: 'openai', platforms: { openai: { ...patch, apiKey: 'draft-sensitive-search-key' } } }

    const result = await testSourceSearchSettings(payload)
    expect(result).toMatchObject({ success: false, providerName: null })
    expect(result.info).not.toContain('draft-sensitive-search-key')
    expectNoPersistence()
    expect(() => updateSourceSearchSettings(payload)).toThrow()
    expect(row).toEqual(original)
    expect(run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not reuse a saved credential inside a public model field and expose it in a settings view', async () => {
    storePlatforms({ openai: { ...SOURCE_SEARCH_PLATFORM_DEFAULTS.openai, apiKey: 'enc:saved-sensitive-search-key' } })
    const original = { ...row! }
    const payload = { provider: 'openai', platforms: { openai: { model: 'search-saved-sensitive-search-key', apiKey: '已设置' } } }

    expect(await testSourceSearchSettings(payload)).toMatchObject({ success: false, providerName: null })
    expectNoPersistence()
    expect(() => updateSourceSearchSettings(payload)).toThrow()
    expect(row).toEqual(original)
    expect(run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    null, [], 'provider',
    { provider: null }, { provider: 1 }, { provider: 'unknown-provider' },
    { tavilyApiKey: null }, { braveApiKey: null },
    { platforms: null }, { platforms: [] },
    { platforms: { unknown: { apiKey: 'do-not-store' } } },
    { platforms: { openai: null } }, { platforms: { openai: [] } },
    { platforms: { openai: { unexpectedField: 'do-not-store' } } },
    { platforms: { openai: { protocol: null } } },
    { platforms: { openai: { baseUrl: null } } },
    { platforms: { openai: { model: null } } },
    { platforms: { openai: { apiKey: null } } },
    { platforms: { deepseek: { protocol: 'responses' } } },
    { platforms: { openai: { protocol: 'brave' } } },
    { platforms: { custom: { protocol: 'unknown-protocol' } } },
  ])('rejects invalid draft/save payloads without replacing settings (%j)', async input => {
    const original = { ...row! }
    const payload = input as unknown as Record<string, unknown>

    expect(await testSourceSearchSettings(payload)).toMatchObject({ success: false })
    expect(fetch).not.toHaveBeenCalled()
    expectNoPersistence()
    expect(() => updateSourceSearchSettings(payload)).toThrow()
    expect(run).not.toHaveBeenCalled()
    expect(row).toEqual(original)
  })

  it.each([
    'http://gateway.example/v1', 'file:///private', 'javascript:alert(1)',
    'https://user:password@gateway.example/v1', 'https://gateway.example/v1?api_key=do-not-echo',
    'https://gateway.example/v1#secret', 'https://gate way.example/v1',
  ])('rejects unsafe base URLs before network or configuration update (%s)', async baseUrl => {
    const input = { provider: 'custom', platforms: { custom: { protocol: 'responses', model: 'fixture-model', baseUrl, apiKey: 'draft-custom-key' } } }
    const original = { ...row! }

    const result = await testSourceSearchSettings(input)
    expect(result).toMatchObject({ success: false, providerName: null })
    expect(result.info).not.toContain('do-not-echo')
    expect(result.info).not.toContain('password')
    expectNoPersistence()
    expect(() => updateSourceSearchSettings(input)).toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(row).toEqual(original)
  })
})
