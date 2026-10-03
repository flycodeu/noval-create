import { describe, expect, it } from 'vitest'
import { AUTHOR_WORKSPACE_PAGES, getAuthorWorkspaceKey, resolveAuthorWorkspaceRoute } from './author-workspace'

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
  it('keeps the timeline as a directly reachable workspace instead of redirecting to the event library', () => {
    expect(AUTHOR_WORKSPACE_PAGES.find(page => page.key === 'timeline')?.route).toBe('timeline')
    expect(getAuthorWorkspaceKey('/novels/292/timeline?view=time')).toBe('timeline')
    expect(resolveAuthorWorkspaceRoute('timeline', '?event=event%3A12')).toBeNull()
    expect(getAuthorWorkspaceKey('narrative-board')).toBe('narrative-board')
  })
})
