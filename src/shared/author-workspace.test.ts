import { describe, expect, it } from 'vitest'
import { AUTHOR_WORKSPACE_PAGES, getAuthorWorkspaceKey, resolveAuthorWorkspaceRoute } from './author-workspace'

describe('author workspace legacy destinations', () => {
  it('keeps the chapter target when opening contracts and writeback', () => {
    expect(resolveAuthorWorkspaceRoute('contracts', '?chapterId=37')).toBe('writing/editor?chapterId=37&panel=arrangement')
    expect(resolveAuthorWorkspaceRoute('writeback', '?chapterId=37')).toBe('writing/editor?chapterId=37&panel=changes')
  })
  it('opens the actual rules and style sections', () => {
    expect(resolveAuthorWorkspaceRoute('world-rules')).toBe('narrative-board?tab=rules')
    expect(resolveAuthorWorkspaceRoute('style-lab')).toBe('story-design?section=style')
    expect(resolveAuthorWorkspaceRoute('guide')).toBeNull()
  })
  it('preserves the selected topic, chapter and object when consolidating old design links', () => {
    expect(resolveAuthorWorkspaceRoute('story-design', '?section=world&topic=world%3AspeciesSystem&atChapter=6&entity=character%3A314')).toBe('narrative-board?topic=world%3AspeciesSystem&atChapter=6&entity=character%3A314&tab=rules')
    expect(resolveAuthorWorkspaceRoute('story-design', '?section=structure&chapterId=688')).toBe('writing/editor?chapterId=688&panel=arrangement')
    expect(resolveAuthorWorkspaceRoute('story-design', '?section=story&topic=facts')).toBeNull()
  })
  it('keeps the timeline as a directly reachable workspace instead of redirecting to the event library', () => {
    expect(AUTHOR_WORKSPACE_PAGES.find(page => page.key === 'timeline')?.route).toBe('timeline')
    expect(getAuthorWorkspaceKey('/novels/292/timeline?view=time')).toBe('timeline')
    expect(resolveAuthorWorkspaceRoute('timeline', '?event=event%3A12')).toBeNull()
    expect(getAuthorWorkspaceKey('narrative-board')).toBe('narrative-board')
  })
})
