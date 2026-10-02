import { describe, expect, it } from 'vitest'
import type { CreativeRun } from '../../../shared/creative-workflow'
import type { Chapter, RevisionTask } from '../../../types'
import { artifactTarget, issueTarget } from './revision-target'

describe('targeted revisions', () => {
  it('keeps an older issue attached to its chapter rather than the next chapter', () => {
    const params = new URLSearchParams(issueTarget({ id: 7, taskType: 'continuity', chapterId: 12, title: '旧章问题' } as RevisionTask, [{ id: 12, chapterNum: 2 }] as Chapter[]).split('?')[1])
    expect(params.get('atChapter')).toBe('2')
    expect(params.get('autoApply')).toBe('false')
    expect(() => issueTarget({ chapterId: 12 } as RevisionTask, [])).toThrow('目标')
  })
  it('carries the candidate lineage, chapter and count without replaying a review report as a draft', () => {
    const run = { stage: 'chapter', atChapter: 3, count: 1 } as CreativeRun
    expect(new URLSearchParams(artifactTarget(run, 'draft-1', '保留事件').split('?')[1]).get('sourceArtifactId')).toBe('draft-1')
    expect(new URLSearchParams(artifactTarget({ ...run, operation: 'review' }, 'report-1', '修正视角', { summary: '视角越界' }).split('?')[1]).get('sourceArtifactId')).toBeNull()
  })
  it('hands real review evidence to the same chapter with a bounded request and refuses an unread report', () => {
    const run = { stage: 'chapter', atChapter: 3, count: 1, operation: 'review' } as CreativeRun
    const report = { summary: '杨嫂的信息获取越过了已知边界', deterministicBlockers: ['第三章不允许提前揭示账本来源'], review: { issues: [{ level: 'blocker', message: '杨嫂此时尚不知道灯油被替换', evidence: [{ quote: '杨嫂早已知道灯油有假。' }] }], topFixes: ['只改这一句为基于现场迹象的怀疑', '建议'.repeat(4000)] } }
    const params = new URLSearchParams(artifactTarget(run, 'report-1', '保留其余对话', report).split('?')[1])
    expect(params.get('atChapter')).toBe('3')
    expect(params.get('count')).toBe('1')
    expect(params.get('sourceArtifactId')).toBeNull()
    expect(params.get('request')).toContain('第三章不允许提前揭示账本来源')
    expect(params.get('request')).toContain('杨嫂早已知道灯油有假。')
    expect(params.get('request')).toContain('只改这一句为基于现场迹象的怀疑')
    expect(params.get('request')).toContain('保留其他正文')
    expect(params.get('request')!.length).toBeLessThanOrEqual(6000)
    expect(() => artifactTarget(run, 'report-1', '修正')).toThrow('具体内容')
  })
})
