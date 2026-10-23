import { getSqlite } from '../database/db'
import { decryptApiKey, encryptApiKey } from './model.service'
import { UserFacingError } from '../utils/user-facing-error'
import {
  SOURCE_SEARCH_PLATFORM_DEFAULTS, SOURCE_SEARCH_PLATFORM_NAMES, SOURCE_SEARCH_PROVIDER_LABELS,
  type SourceSearchPlatformConfig, type SourceSearchPlatformName, type SourceSearchProtocol,
  type SourceSearchProviderMode, type SourceSearchRuntimeConfig,
  type SourceSearchSettingsView, type SourceSearchTestResult,
} from '../../src/shared/source-search'
import { executeSourceSearch, SourceSearchError } from './source-search-provider.service'

export type { SourceSearchProviderMode, SourceSearchProviderName, SourceSearchRuntimeConfig, SourceSearchSettingsView, SourceSearchTestResult } from '../../src/shared/source-search'

interface StoredPlatform extends SourceSearchPlatformConfig { apiKey: string | null }
interface SourceSearchSettingsRow {
  id: number
  provider: string
  tavily_api_key: string | null
  brave_api_key: string | null
  platforms_json?: string | null
  updated_at: string | null
}
const SETTINGS_ID = 1
const MASKED_KEY = '已设置'
const PROTOCOLS: SourceSearchProtocol[] = ['tavily', 'brave', 'deepseek', 'responses', 'chat-completions']
class SearchConfigurationError extends UserFacingError {}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function asText(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function hasControls(value: string): boolean { return Array.from(value).some(char => { const code = char.charCodeAt(0); return code < 32 || code >= 127 && code <= 159 }) }
function validateInput(input: unknown): asserts input is Record<string, unknown> {
  if (!record(input) || Object.keys(input).some(key => !['provider', 'tavilyApiKey', 'braveApiKey', 'platforms'].includes(key))) {
    throw new SearchConfigurationError('sourceSearch.invalidInput')
  }
  if (input.provider !== undefined) normalizeProvider(input.provider)
  for (const key of ['tavilyApiKey', 'braveApiKey']) {
    if (input[key] !== undefined) keyText(input[key])
  }
  if (input.platforms !== undefined) {
    if (!record(input.platforms)) throw new SearchConfigurationError('sourceSearch.invalidPlatform')
    for (const [slot, patch] of Object.entries(input.platforms)) {
      if (!SOURCE_SEARCH_PLATFORM_NAMES.includes(slot as SourceSearchPlatformName)) throw new SearchConfigurationError('sourceSearch.invalidPlatform')
      if (patch === undefined) continue
      if (!record(patch)
        || Object.keys(patch).some(key => !['protocol', 'baseUrl', 'model', 'apiKey'].includes(key))) {
        throw new SearchConfigurationError('sourceSearch.invalidPlatform')
      }
      // A partial patch preserves absent fields, but an explicit null is not a default.
      platformConfig(slot as SourceSearchPlatformName, patch)
      if (patch.apiKey !== undefined) keyText(patch.apiKey)
    }
  }
}

function ensureSettingsTable() {
  const sqlite = getSqlite()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS source_search_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), provider TEXT NOT NULL DEFAULT 'auto',
      tavily_api_key TEXT, brave_api_key TEXT, platforms_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO source_search_settings (id, provider) VALUES (1, 'auto');
  `)
  const columns = sqlite.prepare('PRAGMA table_info(source_search_settings)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'platforms_json')) {
    sqlite.exec('ALTER TABLE source_search_settings ADD COLUMN platforms_json TEXT')
  }
}
function emptySettingsRow(): SourceSearchSettingsRow {
  return { id: SETTINGS_ID, provider: 'auto', tavily_api_key: null, brave_api_key: null, platforms_json: null, updated_at: null }
}
function readSettingsRow(initialize = true): SourceSearchSettingsRow {
  const sqlite = getSqlite()
  if (initialize) ensureSettingsTable()
  else if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_search_settings'").get()) return emptySettingsRow()
  // SELECT * also works before an old table has acquired platforms_json.
  const row = sqlite.prepare('SELECT * FROM source_search_settings WHERE id = ?').get(SETTINGS_ID) as SourceSearchSettingsRow | undefined
  return row || emptySettingsRow()
}
function normalizeProvider(value: unknown): SourceSearchProviderMode {
  const text = asText(value).toLowerCase()
  if (Object.hasOwn(SOURCE_SEARCH_PROVIDER_LABELS, text)) return text as SourceSearchProviderMode
  throw new SearchConfigurationError('sourceSearch.invalidProvider')
}
function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw new SearchConfigurationError('sourceSearch.invalidUrl')
  if (hasControls(value)) throw new SearchConfigurationError('sourceSearch.invalidUrl')
  const text = value.trim()
  if (!text) return ''
  if (text.length > 2048 || /\s/u.test(text) || hasControls(text)) throw new SearchConfigurationError('sourceSearch.invalidUrl')
  try {
    const url = new URL(text)
    const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error()
    return url.href.replace(/\/+$/u, '')
  } catch { throw new SearchConfigurationError('sourceSearch.unsafeUrl') }
}
function platformConfig(slot: SourceSearchPlatformName, value: Record<string, unknown>): SourceSearchPlatformConfig {
  const defaults = SOURCE_SEARCH_PLATFORM_DEFAULTS[slot]
  const protocol = value.protocol === undefined ? defaults.protocol : value.protocol
  if (!PROTOCOLS.includes(protocol as SourceSearchProtocol)
    || slot === 'deepseek' && protocol !== 'deepseek'
    || slot === 'openai' && protocol !== 'responses' && protocol !== 'chat-completions') {
    throw new SearchConfigurationError('sourceSearch.unsupportedProtocol')
  }
  const baseUrl = normalizeBaseUrl(value.baseUrl === undefined ? defaults.baseUrl : value.baseUrl)
  const model = value.model === undefined ? defaults.model : value.model
  if (typeof model !== 'string' || model.length > 256 || hasControls(model)) throw new SearchConfigurationError('sourceSearch.invalidModel')
  return { protocol: protocol as SourceSearchProtocol, baseUrl, model: model.trim() }
}
function readPlatforms(row: SourceSearchSettingsRow): Record<SourceSearchPlatformName, StoredPlatform> {
  let parsed: Record<string, unknown> = {}
  if (row.platforms_json) {
    try { const value: unknown = JSON.parse(row.platforms_json); if (!record(value)) throw new Error(); parsed = value }
    catch { throw new SearchConfigurationError('sourceSearch.unreadableConfig') }
  }
  return Object.fromEntries(SOURCE_SEARCH_PLATFORM_NAMES.map(slot => {
    const value = record(parsed[slot]) ? parsed[slot] : {}
    return [slot, { ...platformConfig(slot, value), apiKey: typeof value.apiKey === 'string' && value.apiKey ? value.apiKey : null }]
  })) as Record<SourceSearchPlatformName, StoredPlatform>
}
function keyText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || hasControls(value)) throw new SearchConfigurationError('sourceSearch.invalidKey')
  return value.trim()
}
function decryptStoredKey(value?: string | null): string {
  if (!value) return ''
  try { return keyText(decryptApiKey(value)) }
  catch { console.warn('[sourceSearch] API Key 解密失败，请重新配置。'); return '' }
}
function normalizeKeyPatch(current: string | null, value: unknown): string | null {
  if (value === undefined) return current
  const text = keyText(value)
  if (text === MASKED_KEY) return current
  return text ? encryptApiKey(text) : null
}
function resolveRuntimeKey(current: string | null, value: unknown): string {
  return value === undefined || asText(value) === MASKED_KEY ? decryptStoredKey(current) : keyText(value)
}
function platformPatch(input: Record<string, unknown> | undefined, slot: SourceSearchPlatformName): Record<string, unknown> {
  if (input?.platforms === undefined) return {}
  if (!record(input.platforms)) throw new SearchConfigurationError('sourceSearch.invalidPlatform')
  const patch = input.platforms[slot]
  if (patch === undefined) return {}
  if (!record(patch)) throw new SearchConfigurationError('sourceSearch.invalidPlatform')
  return patch
}
function draftPlatform(slot: SourceSearchPlatformName, current: StoredPlatform, patch: Record<string, unknown>): StoredPlatform {
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  const config = platformConfig(slot, { ...current, ...definedPatch })
  const identityChanged = config.protocol !== current.protocol || config.baseUrl !== current.baseUrl
  if (identityChanged && current.apiKey && (patch.apiKey === undefined || asText(patch.apiKey) === MASKED_KEY)) {
    throw new SearchConfigurationError('sourceSearch.credentialsChanged')
  }
  if (asText(patch.apiKey) === MASKED_KEY && !current.apiKey) throw new SearchConfigurationError('sourceSearch.missingStoredKey')
  return { ...config, apiKey: current.apiKey }
}
function searchEnvKey(slot: SourceSearchPlatformName, config: SourceSearchPlatformConfig): string {
  if (slot === 'custom' || config.baseUrl !== SOURCE_SEARCH_PLATFORM_DEFAULTS[slot].baseUrl) return ''
  const value = slot === 'deepseek' ? process.env.DEEPSEEK_SEARCH_API_KEY : process.env.OPENAI_SEARCH_API_KEY
  return value ? keyText(value) : ''
}
function assertPublicConfigSafe(config: SourceSearchPlatformConfig, apiKey: string): void {
  if (!apiKey) return
  for (const value of [config.baseUrl, config.model]) {
    let decoded = value
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (decoded.includes(apiKey)) throw new SearchConfigurationError('sourceSearch.keyInPublicField')
      try {
        const next = decodeURIComponent(decoded)
        if (next === decoded) break
        decoded = next
      } catch { break }
    }
  }
}
function platformRuntime(slot: SourceSearchPlatformName, current: StoredPlatform, input?: Record<string, unknown>): SourceSearchRuntimeConfig | null {
  const patch = platformPatch(input, slot)
  const config = draftPlatform(slot, current, patch)
  const apiKey = resolveRuntimeKey(current.apiKey, patch.apiKey) || searchEnvKey(slot, config)
  if (!apiKey) return null
  assertPublicConfigSafe(config, apiKey)
  if (!config.baseUrl) throw new SearchConfigurationError('sourceSearch.urlRequired')
  if ((config.protocol === 'responses' || config.protocol === 'chat-completions') && !config.model) {
    throw new SearchConfigurationError('sourceSearch.modelRequired')
  }
  return { mode: slot, providerName: slot, apiKey, protocol: config.protocol, baseUrl: config.baseUrl, model: config.model }
}
function selectRuntimeProvider(row: SourceSearchSettingsRow, input?: Record<string, unknown>): SourceSearchRuntimeConfig {
  const mode = normalizeProvider(input?.provider === undefined ? row.provider : input.provider)
  const unavailable: SourceSearchRuntimeConfig = { mode, providerName: null, apiKey: null }
  if (mode === 'disabled') return unavailable
  const savedTavilyKey = resolveRuntimeKey(row.tavily_api_key, input?.tavilyApiKey)
  const savedBraveKey = resolveRuntimeKey(row.brave_api_key, input?.braveApiKey)
  const envTavilyKey = process.env.TAVILY_API_KEY?.trim() || ''
  const envBraveKey = process.env.BRAVE_SEARCH_API_KEY?.trim() || ''
  if (mode === 'tavily' || mode === 'brave') {
    const apiKey = mode === 'tavily' ? savedTavilyKey || envTavilyKey : savedBraveKey || envBraveKey
    return apiKey ? { mode, providerName: mode, apiKey } : unavailable
  }
  if (mode === 'auto') {
    // Preserve the existing priority; never start using a writing-model credential.
    if (envTavilyKey) return { mode, providerName: 'tavily', apiKey: envTavilyKey }
    if (envBraveKey) return { mode, providerName: 'brave', apiKey: envBraveKey }
    if (savedTavilyKey) return { mode, providerName: 'tavily', apiKey: savedTavilyKey }
    if (savedBraveKey) return { mode, providerName: 'brave', apiKey: savedBraveKey }
  }
  const platforms = readPlatforms(row)
  for (const slot of mode === 'auto' ? SOURCE_SEARCH_PLATFORM_NAMES : [mode as SourceSearchPlatformName]) {
    const runtime = platformRuntime(slot, platforms[slot], input)
    if (runtime) return { ...runtime, mode }
  }
  return unavailable
}
function toSettingsView(row: SourceSearchSettingsRow): SourceSearchSettingsView {
  const platforms = readPlatforms(row)
  for (const slot of SOURCE_SEARCH_PLATFORM_NAMES) {
    assertPublicConfigSafe(platforms[slot], decryptStoredKey(platforms[slot].apiKey) || searchEnvKey(slot, platforms[slot]))
  }
  return {
    provider: normalizeProvider(row.provider),
    tavilyApiKeySet: Boolean(row.tavily_api_key), braveApiKeySet: Boolean(row.brave_api_key),
    tavilyEnvSet: Boolean(process.env.TAVILY_API_KEY?.trim()), braveEnvSet: Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
    activeProvider: selectRuntimeProvider(row).providerName,
    platforms: Object.fromEntries(SOURCE_SEARCH_PLATFORM_NAMES.map(slot => [slot, {
      protocol: platforms[slot].protocol, baseUrl: platforms[slot].baseUrl, model: platforms[slot].model,
      apiKeySet: Boolean(platforms[slot].apiKey), envSet: Boolean(searchEnvKey(slot, platforms[slot])),
    }])),
    updatedAt: row.updated_at,
  }
}
export function getSourceSearchSettings(): SourceSearchSettingsView { return toSettingsView(readSettingsRow()) }

export function updateSourceSearchSettings(input: Record<string, unknown>): SourceSearchSettingsView {
  validateInput(input)
  const current = readSettingsRow()
  const provider = normalizeProvider(input.provider === undefined ? current.provider : input.provider)
  const platforms = readPlatforms(current)
  for (const slot of SOURCE_SEARCH_PLATFORM_NAMES) {
    const patch = platformPatch(input, slot)
    const config = draftPlatform(slot, platforms[slot], patch)
    const apiKey = normalizeKeyPatch(platforms[slot].apiKey, patch.apiKey)
    assertPublicConfigSafe(config, decryptStoredKey(apiKey) || searchEnvKey(slot, config))
    if ((apiKey || searchEnvKey(slot, config)) && (!config.baseUrl || (config.protocol === 'responses' || config.protocol === 'chat-completions') && !config.model)) {
      throw new SearchConfigurationError('sourceSearch.incompletePlatform')
    }
    platforms[slot] = { ...config, apiKey }
  }
  const next: SourceSearchSettingsRow = {
    ...current, provider,
    tavily_api_key: normalizeKeyPatch(current.tavily_api_key, input.tavilyApiKey),
    brave_api_key: normalizeKeyPatch(current.brave_api_key, input.braveApiKey),
    updated_at: new Date().toISOString(), platforms_json: JSON.stringify(platforms),
  }
  // Validate the complete candidate before the single write, including environment-only credentials.
  const view = toSettingsView(next)
  getSqlite().prepare('UPDATE source_search_settings SET provider = ?, tavily_api_key = ?, brave_api_key = ?, updated_at = ?, platforms_json = ? WHERE id = ?')
    .run(next.provider, next.tavily_api_key, next.brave_api_key, next.updated_at, next.platforms_json, SETTINGS_ID)
  return view
}
export function getSourceSearchRuntimeConfig(): SourceSearchRuntimeConfig { return selectRuntimeProvider(readSettingsRow()) }

export async function testSourceSearchSettings(input?: Record<string, unknown>): Promise<SourceSearchTestResult> {
  const startedAt = Date.now()
  let runtime: SourceSearchRuntimeConfig | undefined
  try {
    if (input !== undefined) validateInput(input)
    runtime = selectRuntimeProvider(readSettingsRow(false), input)
    if (!runtime.providerName || !runtime.apiKey) return {
      success: false, providerName: null, latency: 0,
      info: runtime.mode === 'disabled' ? '来源检索已关闭。' : '未配置可用的搜索 API Key，请先配置所选平台。',
    }
    const results = await executeSourceSearch(runtime, '小说创作 真实资料 检索', { maxResults: 1, timeoutMs: 8000 })
    return { success: true, providerName: runtime.providerName, latency: Date.now() - startedAt, info: `连接成功，返回 ${results.length} 条测试结果。` }
  } catch (error) {
    return {
      success: false, providerName: runtime?.providerName ?? null, latency: Date.now() - startedAt,
      info: error instanceof SearchConfigurationError || error instanceof SourceSearchError
        ? error.message : '连接失败，请检查 API Key、网络和服务状态后重试。',
    }
  }
}
