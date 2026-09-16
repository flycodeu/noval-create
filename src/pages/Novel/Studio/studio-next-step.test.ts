import { describe, expect, it } from 'vitest'
import type { Chapter, Task } from '../../../types'
import { getStudioNextStep, getStudioSceneLabel } from './studio-next-step'
import { organizeAuthorNavigation } from '../shared/workspace-navigation'

describe('RF-15 author launch navigation', () => {
  it('offers trial without map, cultivation, outline or approved sample', () => {
    expect(getStudioNextStep([], [], false).targetPage).toBe('style-lab?view=ab')
    expect(getStudioNextStep([], [], true).targetPage).toBe('writing/editor')
  })
  it('opens failed task before prose and never puts batch recovery on empty projects', () => {
    const task = { id: 9, novelId: 1, status: 'failed', type: 'style_ab_test', updatedAt: '2026-09-16' } as Task
    expect(getStudioNextStep([], [task], false).targetPage).toBe('/tasks')
    expect(getStudioNextStep([], [{ ...task, status: 'success' }], false).targetPage).toContain('style-lab')
    expect(getStudioNextStep([], [task, { ...task, id: 10, status: 'success' }], false).targetPage).toContain('style-lab')
  })
  it('continues the last edited prose, not a later empty outline', () => {
    const chapters = [{ id: 2, chapterNum: 2, content: '正文', updatedAt: '2026-09-15' },
      { id: 3, chapterNum: 3, content: '', updatedAt: '2026-09-16' },
      { id: 1, chapterNum: 1, content: '修订稿', updatedAt: '2026-09-16', scenePlanJson: 'invalid' }] as Chapter[]
    expect(getStudioNextStep(chapters, [], false).targetPage).toBe('writing/editor?chapterId=1')
    expect(getStudioSceneLabel(chapters[2])).toContain('第 1 章')
  })
  it('collects professional tools without changing original routes or data', () => {
    const items = ['theme-voice', 'style-lab', 'map', 'growth-system', 'timeline', 'batch-workbench', 'writing'].map((key) => ({ key, label: key, route: `/novels/1/${key}`, status: 'ready' as const }))
    const input = [{ key: 'original', title: '原组', items }]
    const result = organizeAuthorNavigation(input)
    expect(result[0].items.map((item) => item.label)).toEqual(['作品声音', 'writing'])
    expect(result[1].items.map((item) => item.route)).toEqual(items.slice(2, 6).map((item) => item.route))
    expect(input[0].items).toHaveLength(7)
  })
})
