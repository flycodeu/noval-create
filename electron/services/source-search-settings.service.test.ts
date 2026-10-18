import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({ getSqlite: vi.fn() }))
vi.mock('./model.service', () => ({
  decryptApiKey: vi.fn((value: string) => value.replace(/^enc:/, '')),
  encryptApiKey: vi.fn((value: string) => `enc:${value}`),
}))

import { getSqlite } from '../database/db'
import { decryptApiKey, encryptApiKey } from './model.service'
import {
  testSourceSearchSettings,
  updateSourceSearchSettings,
} from './source-search-settings.service'

interface SettingsRow {
  id: number
  provider: string
  tavily_api_key: string | null
  brave_api_key: string | null
  updated_at: string | null
}

let row: SettingsRow | undefined
let tableExists: boolean
const exec = vi.fn()
const run = vi.fn()
const prepare = vi.fn((sql: string) => {
  if (sql.includes('sqlite_master')) {
    return { get: () => tableExists ? { name: 'source_search_settings' } : undefined }
  }
  if (/SELECT\s+id, provider/u.test(sql)) return { get: () => row ? { ...row } : undefined }
  if (sql.includes('UPDATE source_search_settings')) {
    return { run: (...values: unknown[]) => {
      run(...values)
      row = {
        id: 1,
        provider: values[0] as string,
        tavily_api_key: values[1] as string | null,
        brave_api_key: values[2] as string | null,
        updated_at: values[3] as string,
      }
    } }
  }
  return { run }
})

function mockSuccessfulFetch(provider: 'tavily' | 'brave' = 'tavily') {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(
    provider === 'tavily' ? { results: [{ title: '测试资料' }] } : { web: { results: [{ title: '测试资料' }] } },
  ), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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
  row = {
    id: 1,
    provider: 'tavily',
    tavily_api_key: 'enc:saved-tavily-key',
    brave_api_key: 'enc:saved-brave-key',
    updated_at: '2026-10-17T10:00:00.000Z',
  }
  vi.mocked(getSqlite).mockReturnValue({ exec, prepare } as never)
  vi.mocked(decryptApiKey).mockImplementation(value => value.replace(/^enc:/, ''))
  vi.stubEnv('TAVILY_API_KEY', '')
  vi.stubEnv('BRAVE_SEARCH_API_KEY', '')
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => { throw new Error('Cannot parse draft-tavily-key') },
    }))

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
