import { describe, expect, it } from 'vitest'
import {
  generateChapterContent,
  generateChapterSummary,
  refreshChapterDerivedState,
  resumeChapterPipeline,
  retryChapterPipelineNode,
} from './chapter-generation.usecase'

describe('chapter generation usecase owner', () => {
  it('exposes the existing pipeline entrypoints without a second implementation', () => {
    expect(typeof generateChapterContent).toBe('function')
    expect(typeof generateChapterSummary).toBe('function')
    expect(typeof refreshChapterDerivedState).toBe('function')
    expect(typeof resumeChapterPipeline).toBe('function')
    expect(typeof retryChapterPipelineNode).toBe('function')
  })
})
