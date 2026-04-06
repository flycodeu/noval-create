import { safeStorage } from 'electron'
import CryptoJS from 'crypto-js'
import { getDb } from '../database/db'
import { modelConfigs } from '../database/schema'
import { eq } from 'drizzle-orm'
import { BaseAdapter } from '../adapters/base.adapter'
import { OpenAIAdapter } from '../adapters/openai.adapter'
import { AnthropicAdapter } from '../adapters/anthropic.adapter'
import { BaiduAdapter } from '../adapters/baidu.adapter'
import { AliyunAdapter } from '../adapters/aliyun.adapter'
import { DeepSeekAdapter } from '../adapters/deepseek.adapter'
import { CustomAdapter } from '../adapters/custom.adapter'
import { throwUserFacingError } from '../utils/user-facing-error'
import os from 'os'

const MACHINE_SALT = `novelforge-${os.hostname()}-${os.platform()}`
const PROVIDER_RUNTIME_DEFAULTS: Record<string, { temperature: number; maxTokens: number }> = {
  openai: { temperature: 0.8, maxTokens: 8192 },
  anthropic: { temperature: 0.75, maxTokens: 8192 },
  aliyun: { temperature: 0.85, maxTokens: 8192 },
  baidu: { temperature: 0.8, maxTokens: 8192 },
  deepseek: { temperature: 0.7, maxTokens: 8192 },
  custom: { temperature: 0.8, maxTokens: 8192 },
}

export function normalizeModelConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? Math.round(value) : Number(value)
  if (!Number.isFinite(numeric)) return 2
  return Math.max(1, Math.min(8, numeric))
}

export function getProviderRuntimeDefaults(provider: string): { temperature: number; maxTokens: number } {
  return PROVIDER_RUNTIME_DEFAULTS[provider] || PROVIDER_RUNTIME_DEFAULTS.openai
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
  return Math.max(512, Math.min(32000, numeric))
}

export function normalizeModelContextTokens(value: unknown): number | null {
  const numeric = typeof value === 'number' ? Math.round(value) : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.max(2048, Math.min(2_000_000, numeric))
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
  const { provider, modelId, baseUrl } = config
  const maxContextTokens = normalizeModelContextTokens(config.maxContextTokens)
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
      return new DeepSeekAdapter(key, modelId, maxContextTokens, temperature, maxTokens)
    case 'custom':
      return new CustomAdapter(key, modelId, baseUrl || 'http://localhost:11434/v1', maxContextTokens, temperature, maxTokens)
    default:
      throwUserFacingError('model.unknownProvider', { provider })
  }
}

export function getModelConfigRecord(id: number) {
  const db = getDb()
  const config = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).all()[0]
  if (!config) throwUserFacingError('model.configNotFound', { id })
  return {
    ...config,
    temperature: normalizeModelTemperature(config.temperature, config.provider),
    maxTokens: normalizeModelMaxTokens(config.maxTokens, config.provider),
    maxConcurrency: normalizeModelConcurrency(config.maxConcurrency),
    maxContextTokens: normalizeModelContextTokens(config.maxContextTokens),
  }
}

export function getDefaultModelConfigRecord() {
  const db = getDb()
  const defaults = db.select().from(modelConfigs).where(eq(modelConfigs.isDefault, 1)).all()
  const config = defaults[0] || db.select().from(modelConfigs).all()[0]
  if (!config) throwUserFacingError('model.noneConfigured')
  return {
    ...config,
    temperature: normalizeModelTemperature(config.temperature, config.provider),
    maxTokens: normalizeModelMaxTokens(config.maxTokens, config.provider),
    maxConcurrency: normalizeModelConcurrency(config.maxConcurrency),
    maxContextTokens: normalizeModelContextTokens(config.maxContextTokens),
  }
}

export function resolveModelRuntimeBudget(modelConfigId?: number | null): {
  maxContextTokens: number | null
  maxTokens: number | null
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
    const adapter = await getAdapterById(configId)
    const result = await adapter.chat(
      [{ role: 'user', content: '回复"ok"两个字即可' }],
      { maxTokens: 10, temperature: 0 }
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
