import { describe, expect, it } from 'vitest'
import { resolveAuthorWorkspaceRoute } from './author-workspace'

describe('author workspace legacy destinations', () => {
  it('keeps the chapter target when opening contracts and writeback', () => {
    expect(resolveAuthorWorkspaceRoute('contracts', '?chapterId=37')).toBe('story-design?chapterId=37&section=structure')
    expect(resolveAuthorWorkspaceRoute('writeback', '?chapterId=37')).toBe('writing/editor?chapterId=37&panel=changes')
  })
  it('opens the actual rules and style sections', () => {
    expect(resolveAuthorWorkspaceRoute('world-rules')).toBe('story-design?section=world')
    expect(resolveAuthorWorkspaceRoute('style-lab')).toBe('story-design?section=style')
    expect(resolveAuthorWorkspaceRoute('guide')).toBeNull()
  })
})
