import { describe, expect, it } from 'vitest'
import type { CreativeRun } from '../../../shared/creative-workflow'
import type { Chapter, RevisionTask } from '../../../types'
import { artifactTarget, issueTarget, formalIssueReviewTarget } from './revision-target'

describe('targeted revisions', () => {
  it('keeps an older issue attached to its chapter rather than the next chapter', () => {
    const params = new URLSearchParams(issueTarget({ id: 7, taskType: 'continuity', chapterId: 12, title: '旧章问题' } as RevisionTask, [{ id: 12, chapterNum: 2 }] as Chapter[]).split('?')[1])
    expect(params.get('atChapter')).toBe('2')
    expect(params.get('autoApply')).toBe('false')
    expect(() => issueTarget({ chapterId: 12 } as RevisionTask, [])).toThrow('目标')
  })
  it('preserves the exact stage, candidate and hard scope of a model issue', () => {
    const scope = { existingEntityIds: [], newEntityCount: 2, allowNewRelations: false }
    const params = new URLSearchParams(issueTarget({ id: 9, title: '物品异常原因无据', originMetaJson: JSON.stringify({ issueCategory: 'creative_review', stage: 'items', atChapter: 1, candidateArtifactId: 'draft-item', changeScope: scope, count: 2 }) } as RevisionTask, []).split('?')[1])
    expect(params.get('stage')).toBe('items')
    expect(params.get('atChapter')).toBe('1')
    expect(params.get('sourceArtifactId')).toBe('draft-item')
    expect(JSON.parse(params.get('changeScope')!)).toEqual(scope)
    expect(JSON.parse(params.get('revisionIssueIds')!)).toEqual([9])
    const saved = new URLSearchParams(issueTarget({ id: 9, title: '继续修订', originMetaJson: JSON.stringify({ issueCategory: 'creative_review', stage: 'items', atChapter: 1, candidateArtifactId: 'old-draft', repairArtifactId: 'latest-saved', changeScope: { existingEntityIds: ['item:1'], newEntityCount: 0 } }) } as RevisionTask, []).split('?')[1])
    expect(saved.get('sourceArtifactId')).toBe('latest-saved')
    expect(JSON.parse(saved.get('changeScope')!).newEntityCount).toBe(0)
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
  it('reviews formal item IDs without passing a draft, and carries their latest repair lineage into generation', () => {
    const scope = { existingEntityIds: ['item:9'], existingRelationIds: [], newEntityCount: 0, allowNewRelations: false }
    const target = formalIssueReviewTarget({ id: 14, originMetaJson: JSON.stringify({ issueCategory: 'creative_review', stage: 'items', atChapter: 1, changeScope: scope, repairArtifactId: 'latest-item-draft' }) } as RevisionTask)
    expect(target).toEqual({ operation: 'review', stage: 'items', atChapter: 1, changeScope: scope, revisionIssueIds: [14] })
    expect(target).not.toHaveProperty('sourceArtifactId')
    const params = new URLSearchParams(artifactTarget({ ...target, sourceArtifactId: 'latest-item-draft' } as CreativeRun, 'formal-report', '只改用途', { summary: '物品用途与原句不符' }).split('?')[1])
    expect(params.get('stage')).toBe('items')
    expect(params.get('sourceArtifactId')).toBe('latest-item-draft')
    expect(JSON.parse(params.get('changeScope')!)).toEqual(scope)
    expect(JSON.parse(params.get('revisionIssueIds')!)).toEqual([14])
    expect(params.get('request')).toContain('指定的物品档案')
    expect(params.get('request')).not.toContain('不生成下一章')
  })
})
