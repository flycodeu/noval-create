import { describe, expect, it } from 'vitest'
import { buildWorkspaceRoute } from './novel-workspace'

describe('buildWorkspaceRoute', () => {
  it('keeps the editor alias consistent with the canonical writing route', () => {
    expect(buildWorkspaceRoute(42, 'writing')).toBe('/novels/42/writing/editor')
  })

  it('normalizes legacy workflow page keys before navigating', () => {
    expect(buildWorkspaceRoute(42, 'story-core')).toBe('/novels/42/core-settings')
    expect(buildWorkspaceRoute(42, 'volume-planning')).toBe('/novels/42/volume-design')
  })

  it('keeps chapter query and hash suffixes while normalizing routes', () => {
    expect(buildWorkspaceRoute(42, 'writing?chapterId=7')).toBe('/novels/42/writing/editor?chapterId=7')
    expect(buildWorkspaceRoute(42, 'write-start#focus')).toBe('/novels/42/writing/editor#focus')
  })
})
