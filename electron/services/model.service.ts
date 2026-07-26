import { safeStorage } from 'electron'
import CryptoJS from 'crypto-js'
import { getDb } from '../database/db'
import { modelConfigs } from '../database/schema'
import { eq } from 'drizzle-orm'
import { BaseAdapter, type ChatOptions } from '../adapters/base.adapter'
import { OpenAIAdapter } from '../adapters/openai.adapter'
import { AnthropicAdapter } from '../adapters/anthropic.adapter'
import { BaiduAdapter } from '../adapters/baidu.adapter'
import { AliyunAdapter } from '../adapters/aliyun.adapter'
import { DeepSeekAdapter } from '../adapters/deepseek.adapter'
import { CustomAdapter } from '../adapters/custom.adapter'
import { KimiAdapter } from '../adapters/kimi.adapter'
import { AgentCliAdapter, type NativeAgentProvider } from '../adapters/agent-cli.adapter'
import { throwUserFacingError } from '../utils/user-facing-error'
import os from 'os'

const MACHINE_SALT = `novelforge-${os.hostname()}-${os.platform()}`
const DEFAULT_MODEL_MAX_TOKENS = 65_536
const MAX_MODEL_MAX_TOKENS = 1_000_000
const PROVIDER_RUNTIME_DEFAULTS: Record<string, { temperature: number; maxTokens: number }> = {
  openai: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  anthropic: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  aliyun: { temperature: 0.85, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  baidu: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  deepseek: { temperature: 0.7, maxTokens: 384000 },
  kimi: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  custom: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  codex: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
  claude_code: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS },
}
const SUPPORTED_MODEL_PROVIDERS = new Set(Object.keys(PROVIDER_RUNTIME_DEFAULTS))
type KimiThinkingMode = 'enabled' | 'disabled'

interface ModelExtraParams {
  kimiThinking?: KimiThinkingMode
}

export function normalizeModelProvider(provider: unknown): string {
  const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
  if (normalized === 'moonshot') return 'kimi'
  if (normalized === 'claude') return 'anthropic'
  if (normalized === 'codex-cli' || normalized === 'codexcli') return 'codex'
  if (normalized === 'claude-code' || normalized === 'claudecli' || normalized === 'claude_cli') return 'claude_code'
  return normalized || 'openai'
}

export function isSupportedModelProvider(provider: unknown): boolean {
  return SUPPORTED_MODEL_PROVIDERS.has(normalizeModelProvider(provider))
}

export function providerRequiresApiKey(provider: unknown): boolean {
  const normalized = normalizeModelProvider(provider)
  return normalized !== 'custom' && !isNativeAgentProvider(normalized)
}

export function isNativeAgentProvider(provider: unknown): provider is NativeAgentProvider {
  const normalized = normalizeModelProvider(provider)
  return normalized === 'codex' || normalized === 'claude_code'
}

export function normalizeModelConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? Math.round(value) : Number(value)
  if (!Number.isFinite(numeric)) return 2
  return Math.max(1, Math.min(8, numeric))
}

export function getProviderRuntimeDefaults(provider: string): { temperature: number; maxTokens: number } {
  return PROVIDER_RUNTIME_DEFAULTS[normalizeModelProvider(provider)] || PROVIDER_RUNTIME_DEFAULTS.openai
}

export function getProviderTokenSafetyMarginPct(provider?: string | null): number {
  const normalized = normalizeModelProvider(provider)
  if (normalized === 'openai') return 10
  if (normalized === 'anthropic') return 12
  if (normalized === 'kimi') return 12
  if (isNativeAgentProvider(normalized)) return 15
  return 15
}

export function normalizeModelTemperature(value: unknown, provider: string): number {
  const fallback = getProviderRuntimeDefaults(provider).temperature
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(1, numeric))
}

export function normalizeModelMaxTokens(value: unknown, provider: string): number {
  const fallback = getProviderRuntimeDefaults(provider).maxTokens
  const numeric = typeof value === 'number' ? Math.round(value) : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(512, Math.min(MAX_MODEL_MAX_TOKENS, numeric))
}

export function normalizeModelContextTokens(value: unknown): number | null {
  const numeric = typeof value === 'number' ? Math.round(value) : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.max(2048, Math.min(2_000_000, numeric))
}

export function getKimiModelContextWindow(modelId?: string | null): number | null {
  const normalizedModelId = (modelId || '').trim().toLowerCase()
  if (normalizedModelId === 'kimi-k2.6' || normalizedModelId === 'kimi-k2.5') return 256000
  if (normalizedModelId === 'moonshot-v1-8k') return 8000
  if (normalizedModelId === 'moonshot-v1-32k') return 32000
  if (normalizedModelId === 'moonshot-v1-128k') return 128000
  return null
}

export function normalizeModelContextTokensForModel(
  value: unknown,
  provider: string,
  modelId?: string | null,
): number | null {
  const normalized = normalizeModelContextTokens(value)
  const fixedWindow = normalizeModelProvider(provider) === 'kimi'
    ? getKimiModelContextWindow(modelId)
    : null
  if (!fixedWindow) return normalized
  return normalized ? Math.min(normalized, fixedWindow) : fixedWindow
}

export function normalizeModelBaseUrl(value: unknown, provider: string): string | null {
  const normalizedProvider = normalizeModelProvider(provider)
  const text = typeof value === 'string' ? value.trim() : ''
  if (isNativeAgentProvider(normalizedProvider)) return null
  if (text) return text
  return normalizedProvider === 'custom' ? 'http://localhost:11434/v1' : null
}

function parseModelExtraParams(raw: unknown): ModelExtraParams {
  if (!raw) return {}
  let record: unknown = raw
  if (typeof raw === 'string') {
    try {
      record = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {}
  const source = record as Record<string, unknown>
  const kimiThinking = source.kimiThinking === 'enabled' || source.kimiThinking === 'disabled'
    ? source.kimiThinking
    : undefined
  return { kimiThinking }
}

export function normalizeModelExtraParamsJson(raw: unknown, provider: string): string | null {
  const normalizedProvider = normalizeModelProvider(provider)
  const parsed = parseModelExtraParams(raw)
  if (normalizedProvider !== 'kimi') return null
  const kimiThinking: KimiThinkingMode = parsed.kimiThinking || 'disabled'
  return JSON.stringify({ kimiThinking })
}

export function getModelProviderOptions(config: {
  provider?: string | null
  extraParamsJson?: string | null
}): ChatOptions['providerOptions'] | undefined {
  const provider = normalizeModelProvider(config.provider)
  if (provider !== 'kimi') return undefined
  const extraParams = parseModelExtraParams(config.extraParamsJson)
  return {
    kimiThinking: extraParams.kimiThinking || 'disabled',
  }
}

export function encryptApiKey(key: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(key).toString('base64')
  }
  return CryptoJS.AES.encrypt(key, MACHINE_SALT).toString()
}

export function decryptApiKey(encrypted: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch (err) {
      console.warn('[decryptApiKey] safeStorage 解密失败，尝试 CryptoJS 降级:', err)
    }
  }
  const bytes = CryptoJS.AES.decrypt(encrypted, MACHINE_SALT)
  const result = bytes.toString(CryptoJS.enc.Utf8)
  if (!result) {
    console.error('[decryptApiKey] CryptoJS 解密结果为空，API Key 可能已损坏')
  }
  return result
}

export function createAdapter(config: {
  provider: string
  modelId: string
  apiKey?: string | null
  baseUrl?: string | null
  maxContextTokens?: number | null
  temperature?: number | null
  maxTokens?: number | null
}): BaseAdapter {
  const key = config.apiKey ? decryptApiKey(config.apiKey) : ''
  const provider = normalizeModelProvider(config.provider)
  const { modelId, baseUrl } = config
  const maxContextTokens = normalizeModelContextTokensForModel(config.maxContextTokens, provider, modelId)
  const temperature = normalizeModelTemperature(config.temperature, provider)
  const maxTokens = normalizeModelMaxTokens(config.maxTokens, provider)

  switch (provider) {
    case 'openai':
      return new OpenAIAdapter(key, modelId, baseUrl || undefined, maxContextTokens, temperature, maxTokens)
    case 'anthropic':
      return new AnthropicAdapter(key, modelId, maxContextTokens, temperature, maxTokens)
    case 'baidu': {
      const [apiKey, secretKey] = key.split('|')
      return new BaiduAdapter(apiKey, secretKey, modelId, maxContextTokens, temperature, maxTokens)
    }
    case 'aliyun':
      return new AliyunAdapter(key, modelId, maxContextTokens, temperature, maxTokens)
    case 'deepseek':
      return new DeepSeekAdapter(key, modelId, baseUrl || undefined, maxContextTokens, temperature, maxTokens)
    case 'kimi':
      return new KimiAdapter(key, modelId || 'kimi-k2.6', baseUrl || undefined, maxContextTokens, temperature, maxTokens)
    case 'custom':
      return new CustomAdapter(key, modelId, baseUrl || 'http://localhost:11434/v1', maxContextTokens, temperature, maxTokens)
    case 'codex':
    case 'claude_code':
      return new AgentCliAdapter(provider, modelId, maxContextTokens, temperature, maxTokens)
    default:
      throwUserFacingError('model.unknownProvider', { provider })
  }
}

export function getModelConfigRecord(id: number) {
  const db = getDb()
  const config = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).all()[0]
  if (!config) throwUserFacingError('model.configNotFound', { id })
  const provider = normalizeModelProvider(config.provider)
  if (!isSupportedModelProvider(provider)) {
    throwUserFacingError('model.unknownProvider', { provider })
  }
  return {
    ...config,
    provider,
    temperature: normalizeModelTemperature(config.temperature, provider),
    maxTokens: normalizeModelMaxTokens(config.maxTokens, provider),
    maxConcurrency: normalizeModelConcurrency(config.maxConcurrency),
    maxContextTokens: normalizeModelContextTokensForModel(config.maxContextTokens, provider, config.modelId),
    extraParamsJson: normalizeModelExtraParamsJson(config.extraParamsJson, provider),
  }
}

export function getDefaultModelConfigRecord() {
  const db = getDb()
  const defaults = db.select().from(modelConfigs).where(eq(modelConfigs.isDefault, 1)).all()
  const configs = db.select().from(modelConfigs).all()
  const config = defaults.find((candidate) => isSupportedModelProvider(candidate.provider))
    || configs.find((candidate) => isSupportedModelProvider(candidate.provider))
  if (!config) throwUserFacingError('model.noneConfigured')
  const provider = normalizeModelProvider(config.provider)
  return {
    ...config,
    provider,
    temperature: normalizeModelTemperature(config.temperature, provider),
    maxTokens: normalizeModelMaxTokens(config.maxTokens, provider),
    maxConcurrency: normalizeModelConcurrency(config.maxConcurrency),
    maxContextTokens: normalizeModelContextTokensForModel(config.maxContextTokens, provider, config.modelId),
    extraParamsJson: normalizeModelExtraParamsJson(config.extraParamsJson, provider),
  }
}

export function resolveModelRuntimeBudget(modelConfigId?: number | null): {
  maxContextTokens: number | null
  maxTokens: number | null
  provider?: string
  tokenSafetyMarginPct?: number
} {
  try {
    const config = typeof modelConfigId === 'number'
      ? getModelConfigRecord(modelConfigId)
      : getDefaultModelConfigRecord()
    const adapter = createAdapter(config)
    const maxTokens = typeof config.maxTokens === 'number' && config.maxTokens > 0
      ? Math.round(config.maxTokens)
      : null
    return {
      maxContextTokens: adapter.maxContextTokens,
      maxTokens,
      provider: config.provider,
      tokenSafetyMarginPct: getProviderTokenSafetyMarginPct(config.provider),
    }
  } catch {
    return {
      maxContextTokens: null,
      maxTokens: null,
    }
  }
}

export async function getDefaultAdapter(): Promise<BaseAdapter> {
  return createAdapter(getDefaultModelConfigRecord())
}

export async function getAdapterById(id: number): Promise<BaseAdapter> {
  return createAdapter(getModelConfigRecord(id))
}

export async function testAdapter(configId: number): Promise<{ success: boolean; latency: number; info: string }> {
  const start = Date.now()
  try {
    const config = getModelConfigRecord(configId)
    const adapter = createAdapter(config)
    const result = await adapter.chat(
      [{ role: 'user', content: '回复"ok"两个字即可' }],
      {
        maxTokens: 10,
        temperature: 0,
        providerOptions: {
          ...getModelProviderOptions(config),
          ...(config.provider === 'kimi' ? { kimiThinking: 'disabled' as const } : {}),
        },
      }
    )
    return {
      success: true,
      latency: Date.now() - start,
      info: result.trim() || '连接成功',
    }
  } catch (e: unknown) {
    return {
      success: false,
      latency: Date.now() - start,
      info: e instanceof Error ? e.message : '未知错误',
    }
  }
}
