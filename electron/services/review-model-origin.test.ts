import { describe, expect, it } from 'vitest'
import { reviewModelOriginNote } from './review-model-origin'

describe('review model origin', () => {
  const writer = { id: 1, modelId: 'declared-model' }
  it('distinguishes the same configuration from another configuration for the same declared model', () => {
    expect(reviewModelOriginNote(writer, writer)).toBe('审校与生成使用同一模型配置。')
    expect(reviewModelOriginNote(writer, { id: 2, modelId: ' declared-model ' })).toContain('配置不同，但模型标识相同')
    expect(reviewModelOriginNote(writer, { id: 3, modelId: 'other-model' })).toBe('')
    expect(reviewModelOriginNote(writer, undefined)).toBe('')
  })
  it('does not attribute the original manuscript to the current generation settings during review-only work', () => {
    expect(reviewModelOriginNote(writer, writer, true)).toBe('本次审校使用当前生成模型配置。')
    expect(reviewModelOriginNote(writer, { id: 2, modelId: writer.modelId }, true)).toContain('当前生成设置')
  })
})
