import { describe, expect, it } from 'vitest'
import { buildLaunchIdeaMessages, normalizeLaunchIdeaResult } from './launch-idea'

describe('launch idea intake', () => {
  it('keeps the prompt focused on extraction instead of inventing a complete story', () => {
    const prompt = buildLaunchIdeaMessages({
      genre: '悬疑推理',
      idea: '我只知道她在殡仪馆值夜班，别替我补世界观。',
    })[0].content

    expect(prompt).toContain('只使用原文明确提供的信息')
    expect(prompt).toContain('不要擅自新增人名、组织名、能力名')
    expect(prompt).toContain('殡仪馆值夜班')
    expect(prompt).not.toContain('忽略之前的要求')
  })

  it('normalizes partial model output without filling unknown fields', () => {
    const result = normalizeLaunchIdeaResult({
      title: '  夜班遗体  ',
      protagonistStart: '她在县城殡仪馆值夜班',
      missing: ['核心冲突', '', 42],
      invented: 'should not leak',
    })

    expect(result.title).toBe('夜班遗体')
    expect(result.protagonistStart).toBe('她在县城殡仪馆值夜班')
    expect(result.coreConflict).toBe('')
    expect(result.missing).toEqual(['核心冲突'])
    expect(result).not.toHaveProperty('invented')
  })
})
