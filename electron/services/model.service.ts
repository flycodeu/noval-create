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
import os from 'os'

const MACHINE_SALT = `novelforge-${os.hostname()}-${os.platform()}`

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
    } catch {
      // 降级解密
    }
  }
  const bytes = CryptoJS.AES.decrypt(encrypted, MACHINE_SALT)
  return bytes.toString(CryptoJS.enc.Utf8)
}

export function createAdapter(config: {
  provider: string
  modelId: string
  apiKey?: string | null
  baseUrl?: string | null
}): BaseAdapter {
  const key = config.apiKey ? decryptApiKey(config.apiKey) : ''
  const { provider, modelId, baseUrl } = config

  switch (provider) {
    case 'openai':
      return new OpenAIAdapter(key, modelId, baseUrl || undefined)
    case 'anthropic':
      return new AnthropicAdapter(key, modelId)
    case 'baidu': {
      const [apiKey, secretKey] = key.split('|')
      return new BaiduAdapter(apiKey, secretKey, modelId)
    }
    case 'aliyun':
      return new AliyunAdapter(key, modelId)
    case 'deepseek':
      return new DeepSeekAdapter(key, modelId)
    case 'custom':
      return new CustomAdapter(key, modelId, baseUrl || 'http://localhost:11434/v1')
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

export async function getDefaultAdapter(): Promise<BaseAdapter> {
  const db = getDb()
  const configs = db.select().from(modelConfigs).where(eq(modelConfigs.isDefault, 1)).all()
  if (configs.length === 0) {
    const all = db.select().from(modelConfigs).all()
    if (all.length === 0) throw new Error('未配置任何模型，请先在模型管理页添加配置')
    return createAdapter(all[0])
  }
  return createAdapter(configs[0])
}

export async function getAdapterById(id: number): Promise<BaseAdapter> {
  const db = getDb()
  const configs = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).all()
  if (configs.length === 0) throw new Error(`模型配置 #${id} 不存在`)
  return createAdapter(configs[0])
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
