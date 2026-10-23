export interface EmbeddingSettings {
  mode: 'local' | 'remote'
  modelConfigId: number | null
  modelId: string
}
export const LOCAL_EMBEDDING_MODEL_ID = 'local:Xenova/bge-small-zh-v1.5:q8'
export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = { mode: 'local', modelConfigId: null, modelId: '' }
