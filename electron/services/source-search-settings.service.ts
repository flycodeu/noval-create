import { getSqlite } from '../database/db'
import { decryptApiKey, encryptApiKey } from './model.service'

export type SourceSearchProviderMode = 'auto' | 'tavily' | 'brave' | 'disabled'
export type SourceSearchProviderName = 'tavily' | 'brave'

export interface SourceSearchSettingsView {
  provider: SourceSearchProviderMode
  tavilyApiKeySet: boolean
  braveApiKeySet: boolean
  tavilyEnvSet: boolean
  braveEnvSet: boolean
  activeProvider: SourceSearchProviderName | null
  updatedAt?: string | null
}

export interface SourceSearchRuntimeConfig {
  mode: SourceSearchProviderMode
  providerName: SourceSearchProviderName | null
  apiKey: string | null
}

export interface SourceSearchTestResult {
  success: boolean
  providerName: SourceSearchProviderName | null
  latency: number
  info: string
}

interface SourceSearchSettingsRow {
  id: number
  provider: string
  tavily_api_key: string | null
  brave_api_key: string | null
  updated_at: string | null
}

const SETTINGS_ID = 1
const MASKED_KEY = '已设置'

function ensureSettingsTable() {
  const sqlite = getSqlite()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS source_search_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'auto',
      tavily_api_key TEXT,
      brave_api_key TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO source_search_settings (id, provider)
    VALUES (1, 'auto');
  `)
}

function normalizeProvider(value: unknown): SourceSearchProviderMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'tavily' || normalized === 'brave' || normalized === 'disabled') return normalized
  return 'auto'
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readSettingsRow(): SourceSearchSettingsRow {
  ensureSettingsTable()
  const row = getSqlite().prepare(`
    SELECT id, provider, tavily_api_key, brave_api_key, updated_at
    FROM source_search_settings
    WHERE id = ?
  `).get(SETTINGS_ID) as SourceSearchSettingsRow | undefined

  if (row) return row

  getSqlite().prepare(`
    INSERT OR IGNORE INTO source_search_settings (id, provider)
    VALUES (?, 'auto')
  `).run(SETTINGS_ID)

  return {
    id: SETTINGS_ID,
    provider: 'auto',
    tavily_api_key: null,
    brave_api_key: null,
    updated_at: null,
  }
}

function decryptStoredKey(value?: string | null): string {
  if (!value) return ''
  try {
    return decryptApiKey(value).trim()
  } catch (error) {
    console.warn('[sourceSearch] API Key 解密失败:', error)
    return ''
  }
}

function normalizeKeyPatch(current: string | null, value: unknown): string | null {
  if (value === undefined) return current
  const text = asText(value)
  if (text === MASKED_KEY) return current
  if (!text) return null
  return encryptApiKey(text)
}

function selectRuntimeProvider(row: SourceSearchSettingsRow): SourceSearchRuntimeConfig {
  const mode = normalizeProvider(row.provider)
  if (mode === 'disabled') {
    return { mode, providerName: null, apiKey: null }
  }

  const savedTavilyKey = decryptStoredKey(row.tavily_api_key)
  const savedBraveKey = decryptStoredKey(row.brave_api_key)
  const envTavilyKey = process.env.TAVILY_API_KEY?.trim() || ''
  const envBraveKey = process.env.BRAVE_SEARCH_API_KEY?.trim() || ''

  if (mode === 'tavily') {
    const apiKey = savedTavilyKey || envTavilyKey
    return { mode, providerName: apiKey ? 'tavily' : null, apiKey: apiKey || null }
  }

  if (mode === 'brave') {
    const apiKey = savedBraveKey || envBraveKey
    return { mode, providerName: apiKey ? 'brave' : null, apiKey: apiKey || null }
  }

  if (envTavilyKey) return { mode, providerName: 'tavily', apiKey: envTavilyKey }
  if (envBraveKey) return { mode, providerName: 'brave', apiKey: envBraveKey }
  if (savedTavilyKey) return { mode, providerName: 'tavily', apiKey: savedTavilyKey }
  if (savedBraveKey) return { mode, providerName: 'brave', apiKey: savedBraveKey }
  return { mode, providerName: null, apiKey: null }
}

function toSettingsView(row: SourceSearchSettingsRow): SourceSearchSettingsView {
  const runtime = selectRuntimeProvider(row)
  return {
    provider: normalizeProvider(row.provider),
    tavilyApiKeySet: Boolean(row.tavily_api_key),
    braveApiKeySet: Boolean(row.brave_api_key),
    tavilyEnvSet: Boolean(process.env.TAVILY_API_KEY?.trim()),
    braveEnvSet: Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
    activeProvider: runtime.providerName,
    updatedAt: row.updated_at,
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as unknown
  } finally {
    clearTimeout(timeout)
  }
}

async function runProviderProbe(runtime: SourceSearchRuntimeConfig) {
  if (!runtime.providerName || !runtime.apiKey) {
    return 0
  }

  if (runtime.providerName === 'tavily') {
    const payload = await fetchJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        query: '小说创作 真实资料 检索',
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
        max_results: 1,
      }),
    }, 8000)
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    return Array.isArray(record.results) ? record.results.length : 0
  }

  const url = 'https://api.search.brave.com/res/v1/web/search?q=%E5%B0%8F%E8%AF%B4%E5%88%9B%E4%BD%9C%20%E7%9C%9F%E5%AE%9E%E8%B5%84%E6%96%99%20%E6%A3%80%E7%B4%A2&count=1'
  const payload = await fetchJson(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': runtime.apiKey,
    },
  }, 8000)
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
  const web = record.web && typeof record.web === 'object' && !Array.isArray(record.web)
    ? record.web as Record<string, unknown>
    : {}
  return Array.isArray(web.results) ? web.results.length : 0
}

export function getSourceSearchSettings(): SourceSearchSettingsView {
  return toSettingsView(readSettingsRow())
}

export function updateSourceSearchSettings(input: Record<string, unknown>): SourceSearchSettingsView {
  const current = readSettingsRow()
  const provider = normalizeProvider(input.provider ?? current.provider)
  const tavilyApiKey = normalizeKeyPatch(current.tavily_api_key, input.tavilyApiKey)
  const braveApiKey = normalizeKeyPatch(current.brave_api_key, input.braveApiKey)
  const updatedAt = new Date().toISOString()

  getSqlite().prepare(`
    UPDATE source_search_settings
    SET provider = ?,
        tavily_api_key = ?,
        brave_api_key = ?,
        updated_at = ?
    WHERE id = ?
  `).run(provider, tavilyApiKey, braveApiKey, updatedAt, SETTINGS_ID)

  return getSourceSearchSettings()
}

export function getSourceSearchRuntimeConfig(): SourceSearchRuntimeConfig {
  return selectRuntimeProvider(readSettingsRow())
}

export async function testSourceSearchSettings(): Promise<SourceSearchTestResult> {
  const runtime = getSourceSearchRuntimeConfig()
  if (!runtime.providerName || !runtime.apiKey) {
    return {
      success: false,
      providerName: runtime.providerName,
      latency: 0,
      info: runtime.mode === 'disabled'
        ? '来源检索已关闭。'
        : '未配置可用的 Tavily 或 Brave Search API Key。',
    }
  }

  const startedAt = Date.now()
  try {
    const resultCount = await runProviderProbe(runtime)
    const latency = Date.now() - startedAt
    return {
      success: true,
      providerName: runtime.providerName,
      latency,
      info: `连接成功，返回 ${resultCount} 条测试结果。`,
    }
  } catch (error) {
    return {
      success: false,
      providerName: runtime.providerName,
      latency: Date.now() - startedAt,
      info: error instanceof Error ? error.message : String(error),
    }
  }
}
