import { describe, expect, it } from 'vitest'
import { workspaceSearchEntries } from './workspace-search'
import type { Chapter } from '../../../types'
import type { StoryAtlasEntity } from '../../../shared/story-atlas'

describe('workspace object search', () => {
  it('opens a planned character explicitly without losing the stable object ID', () => {
    const rows = workspaceSearchEntries([], [{ id: 'character:314', kind: 'character', name: '阿烛', status: 'planned', attributes: {} } as StoryAtlasEntity])
    const result = rows.find(row => row.key === 'character:314')!
    const params = new URLSearchParams(result.route.split('?')[1])
    expect(params.get('entity')).toBe('character:314')
    expect(params.get('includePlanned')).toBe('true')
    expect(result.category).toContain('作者规划')
  })
  it('opens the exact chapter and exposes shared rule and research destinations', () => {
    const rows = workspaceSearchEntries([{ id: 688, chapterNum: 7, title: '她自己带了灯芯' } as Chapter], [])
    expect(rows.find(row => row.key === 'chapter:688')?.route).toBe('writing/editor?chapterId=688')
    expect(rows.find(row => row.label === '世界规则')?.route).toBe('narrative-board?tab=rules')
    expect(rows.find(row => row.label === '联网参考')?.route).toBe('narrative-board?tab=research')
    expect(rows.find(row => row.label === '作者资料卡')?.route).toBe('story-design?section=sources')
  })
})
