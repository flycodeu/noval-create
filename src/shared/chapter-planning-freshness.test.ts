import { describe, expect, it } from 'vitest'
import { projectChapterPlanningArtifacts } from './chapter-planning-freshness'

describe('chapter planning freshness', () => {
  const chapter = { chapterNum: 8, scenePlanJson: '旧场景', bridgePlanJson: '旧桥接', outline: '作者章纲', content: '新正文' }

  it.each([
    ['正文已更新，章节派生审校结果需要刷新'],
    ['第8章正文版本已修改，派生材料和后章输入需重新核对'],
  ])('hides a legacy plan only when this body changed (%s)', (reason) => {
    const row = { ...chapter, staleReasonJson: JSON.stringify([reason]) }
    expect(projectChapterPlanningArtifacts(row)).toEqual({ ...row, scenePlanJson: '', bridgePlanJson: '' })
    expect(row.scenePlanJson).toBe('旧场景')
  })

  it.each([
    '[]', 'not json', '{}', '[null, 4]',
    JSON.stringify(['第7章正文版本已修改，派生材料和后章输入需重新核对']),
    JSON.stringify(['第7章内容已更新', '世界规则已变更']),
    JSON.stringify(['生成正文已更新，章节派生审校结果需要刷新']),
  ])('keeps plans for other changes without migrating future chapters (%s)', (reasons) => {
    const row = { ...chapter, staleReasonJson: reasons }
    expect(projectChapterPlanningArtifacts(row)).toBe(row)
  })
})
