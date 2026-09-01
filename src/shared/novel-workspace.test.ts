import { describe, expect, it } from 'vitest'
import { EMPTY_WORKFLOW_STATS } from './workflow-stats'
import { buildWorkspaceRoute, getWorkspaceSnapshot } from './novel-workspace'

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

describe('workspace map navigation', () => {
  it('exposes the linked novel map as a first-class world-building destination', () => {
    const snapshot = getWorkspaceSnapshot(null, EMPTY_WORKFLOW_STATS, { viewMode: 'quick' })
    const worldGroup = snapshot.navGroups.find((group) => group.key === 'world-building')

    expect(worldGroup?.items.find((item) => item.key === 'narrative-board')).toMatchObject({
      label: '小说地图',
      route: 'narrative-board',
    })
    expect(worldGroup?.items.find((item) => item.key === 'map')?.label).toBe('地点资料')
  })
})
