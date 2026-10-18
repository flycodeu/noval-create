export interface EmbeddingSettings {
  mode: 'local' | 'remote'
  modelConfigId: number | null
  modelId: string
}
// Runtime upgrades can change quantized inference even with identical weights.
// Version the vector identity, not the model cache path; old rows stay intact
// and keyword recall remains available until chapters are re-indexed.
export const LOCAL_EMBEDDING_MODEL_ID = 'local:Xenova/bge-small-zh-v1.5:q8:tjs4.3.1'
export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = { mode: 'local', modelConfigId: null, modelId: '' }
