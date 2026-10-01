import { describe, expect, it } from 'vitest'
import { pickChangedDraftFields } from './step-ai-assistant-patch'

describe('step assistant draft fields', () => {
  it('keeps only meaningful changed fields from a full model JSON template', () => {
    expect(pickChangedDraftFields({
      title: '',
      synopsis: '一个更具体的简介',
      userBackground: null,
      expandedBackground: [],
      targetWords: 200000,
    }, {
      title: '旧书名',
      synopsis: '旧简介',
      userBackground: '作者原话',
      expandedBackground: '已有背景',
      targetWords: 200000,
    })).toEqual({ synopsis: '一个更具体的简介' })
  })

  it('retains changed arrays and numbers but never treats empty arrays as deletion', () => {
    expect(pickChangedDraftFields({ tags: ['悬疑'], emptyTags: [], targetWords: 50000 }, {
      tags: ['都市'], emptyTags: ['已有标签'], targetWords: 200000,
    })).toEqual({ tags: ['悬疑'], targetWords: 50000 })
  })
})
