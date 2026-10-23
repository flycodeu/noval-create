import { describe, expect, it } from 'vitest'
import { DEFAULT_EMBEDDING_SETTINGS, LOCAL_EMBEDDING_MODEL_ID } from './embedding-settings'

describe('local embedding runtime identity', () => {
  it('versions new vectors separately from historical q8 vectors with the same weights', () => {
    const historicalModelId = 'local:Xenova/bge-small-zh-v1.5:q8'
    expect(LOCAL_EMBEDDING_MODEL_ID).toBe('local:Xenova/bge-small-zh-v1.5:q8:tjs4.3.1')
    expect(LOCAL_EMBEDDING_MODEL_ID).not.toBe(historicalModelId)
    expect(LOCAL_EMBEDDING_MODEL_ID.startsWith(historicalModelId + ':')).toBe(true)
  })

  it('keeps the default local setup independent of remote credentials', () => {
    expect(DEFAULT_EMBEDDING_SETTINGS).toEqual({ mode: 'local', modelConfigId: null, modelId: '' })
  })
})
