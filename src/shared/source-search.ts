export type SourceSearchPlatformName = 'deepseek' | 'openai' | 'custom'
export type SourceSearchProviderName = 'tavily' | 'brave' | SourceSearchPlatformName
export type SourceSearchProviderMode = 'auto' | SourceSearchProviderName | 'disabled'
export type SourceSearchProtocol = 'tavily' | 'brave' | 'deepseek' | 'responses' | 'chat-completions'

export interface SourceSearchPlatformConfig {
  protocol: SourceSearchProtocol
  baseUrl: string
  model: string
}

export interface SourceSearchPlatformView extends SourceSearchPlatformConfig {
  apiKeySet: boolean
  envSet: boolean
}

export interface SourceSearchSettingsView {
  provider: SourceSearchProviderMode
  tavilyApiKeySet: boolean
  braveApiKeySet: boolean
  tavilyEnvSet: boolean
  braveEnvSet: boolean
  activeProvider: SourceSearchProviderName | null
  /** Optional only for compatibility with older Web preview fixtures. */
  platforms?: Partial<Record<SourceSearchPlatformName, SourceSearchPlatformView>>
  updatedAt?: string | null
}

export interface SourceSearchSettingsUpdate {
  provider?: SourceSearchProviderMode
  tavilyApiKey?: string
  braveApiKey?: string
  platforms?: Partial<Record<SourceSearchPlatformName, Partial<SourceSearchPlatformConfig> & { apiKey?: string }>>
}

export interface SourceSearchRuntimeConfig {
  mode: SourceSearchProviderMode
  providerName: SourceSearchProviderName | null
  apiKey: string | null
  protocol?: SourceSearchProtocol
  baseUrl?: string
  model?: string
}

export interface SourceSearchTestResult {
  success: boolean
  providerName: SourceSearchProviderName | null
  latency: number
  info: string
}

export const SOURCE_SEARCH_PLATFORM_NAMES: SourceSearchPlatformName[] = ['deepseek', 'openai', 'custom']

export const SOURCE_SEARCH_PLATFORM_DEFAULTS: Record<SourceSearchPlatformName, SourceSearchPlatformConfig> = {
  deepseek: { protocol: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: '' },
  openai: { protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' },
  custom: { protocol: 'responses', baseUrl: '', model: '' },
}

export const SOURCE_SEARCH_PROVIDER_LABELS: Record<SourceSearchProviderMode, string> = {
  auto: '自动选择', tavily: 'Tavily', brave: 'Brave Search', deepseek: 'DeepSeek Search',
  openai: 'OpenAI / GPT', custom: '自定义兼容接口', disabled: '关闭来源检索',
}

export const SOURCE_SEARCH_PROTOCOL_LABELS: Record<SourceSearchProtocol, string> = {
  deepseek: 'DeepSeek Search', responses: 'Responses · web_search',
  'chat-completions': 'Chat Completions · 搜索模型', tavily: 'Tavily Search', brave: 'Brave Search',
}
