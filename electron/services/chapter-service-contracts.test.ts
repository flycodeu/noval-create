import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sanitizeChapterGenerationOptions } from './chapter-service-contracts'

describe('chapter service compatibility contracts', () => {
  it('keeps generation option sanitization on the shared implementation', () => {
    expect(sanitizeChapterGenerationOptions({ stageId: 3, totalBudget: 12000 })).toEqual({
      stageId: 3,
      totalBudget: 12000,
    })
  })

  it('does not let the new owner module import the compatibility facade', () => {
    const source = fs.readFileSync(new URL('./chapter-generation.usecase.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("from './chapter.service'")
    const facade = fs.readFileSync(new URL('./chapter.service.ts', import.meta.url), 'utf8')
    expect(facade).toContain('generateChapterContent')
    expect(facade).toContain('getChapterContextPreview')
    expect(facade).toContain('optimizeChapterContent')
  })
})
