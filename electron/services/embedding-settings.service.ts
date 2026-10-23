import { createHash } from 'node:crypto'
import { getSqlite } from '../database/db'
import { getModelConfigRecord, getAdapterById } from './model.service'
import { DEFAULT_EMBEDDING_SETTINGS, LOCAL_EMBEDDING_MODEL_ID, type EmbeddingSettings } from '../../src/shared/embedding-settings'

export function getEmbeddingSettings(): EmbeddingSettings {
  const db = getSqlite()
  const row = db.prepare('SELECT mode,model_config_id AS modelConfigId,model_id AS modelId FROM embedding_settings WHERE id=1').get() as EmbeddingSettings | undefined
  return row || { ...DEFAULT_EMBEDDING_SETTINGS }
}
export function setEmbeddingSettings(input: EmbeddingSettings): EmbeddingSettings {
  if (!['local', 'remote'].includes(input.mode)) throw new Error('向量模式无效。')
  const next = input.mode === 'local' ? { ...DEFAULT_EMBEDDING_SETTINGS } : { ...input, modelId: input.modelId.trim() }
  if (next.mode === 'remote') {
    if (!Number.isSafeInteger(next.modelConfigId) || !next.modelConfigId || !next.modelId || next.modelId.length > 200) throw new Error('请选择独立的向量接口，并填写向量模型名称。')
    const config = getModelConfigRecord(next.modelConfigId)
    if (!['openai', 'custom'].includes(config.provider)) throw new Error('远程向量接口需选择 OpenAI 或自定义兼容接口。')
  }
  getEmbeddingSettings()
  getSqlite().prepare('INSERT INTO embedding_settings(id,mode,model_config_id,model_id) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,model_config_id=excluded.model_config_id,model_id=excluded.model_id')
    .run(next.mode, next.modelConfigId, next.modelId)
  return getEmbeddingSettings()
}
export function embeddingRuntimeIdentity(): { settings: EmbeddingSettings; modelId: string; key: string } {
  const settings = getEmbeddingSettings()
  if (settings.mode === 'local') return { settings, modelId: LOCAL_EMBEDDING_MODEL_ID, key: LOCAL_EMBEDDING_MODEL_ID }
  const config = getModelConfigRecord(settings.modelConfigId!)
  if (!['openai', 'custom'].includes(config.provider) || !settings.modelId.trim()) throw new Error('向量接口配置已失效。')
  const fingerprint = createHash('sha256').update(JSON.stringify({ baseUrl: config.baseUrl || 'https://api.openai.com/v1', modelId: settings.modelId })).digest('hex').slice(0, 20)
  return { settings, modelId: `remote:${fingerprint}:${settings.modelId}`, key: `remote:${fingerprint}:${settings.modelId}` }
}
export async function embeddingRemoteAdapter() {
  const runtime = embeddingRuntimeIdentity()
  if (runtime.settings.mode !== 'remote') throw new Error('当前向量模型为本地模式。')
  return { ...runtime, adapter: await getAdapterById(runtime.settings.modelConfigId!) }
}
