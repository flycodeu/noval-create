import { describe, expect, it } from 'vitest'
import {
  createChapter,
  getChapter,
  listChapters,
  sanitizeChapterUpdatePayload,
  updateChapter,
} from './chapter-crud.service'

describe('chapter CRUD owner facade', () => {
  it('keeps the legacy export identity and sanitizes only editor fields', () => {
    expect(typeof listChapters).toBe('function')
    expect(typeof createChapter).toBe('function')
    expect(typeof getChapter).toBe('function')
    expect(typeof updateChapter).toBe('function')
    expect(sanitizeChapterUpdatePayload({
      title: '新标题',
      content: '正文',
      contextVersion: 999,
      writebackStatusJson: '{}',
    })).toEqual({ title: '新标题', content: '正文' })
  })
})
