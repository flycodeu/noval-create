import { describe, expect, it } from 'vitest'
import type { CreativeRun } from '../../../shared/creative-workflow'
import { manuscriptGenerationFields } from './manuscript-generation'

const run = (patch: Partial<CreativeRun>): CreativeRun => ({
  runId: 1, novelId: 1, stage: 'chapter', request: '', atChapter: 4, status: 'paused', step: 'needs_attention',
  message: '', modelConfigId: null, events: [], createdAt: null, updatedAt: null, artifactId: 'draft-4', ...patch,
})

const fields = (patch: Partial<Parameters<typeof manuscriptGenerationFields>[0]> = {}) => manuscriptGenerationFields({
  chapterNum: 4, title: '夜试', hasSavedProse: true, revisionTarget: 'chapter', userRequest: '', run: null, ...patch,
})

describe('manuscript revision target', () => {
  it('binds freshly created review issues and carries candidate repair issues without reviving resolved review inputs', () => {
    expect(fields({ run: run({ operation: 'review', status: 'completed', result: { issueIds: [21, 'bad'] } }) }).revisionIssueIds).toEqual([21])
    expect(fields({ run: run({ revisionIssueIds: [9], result: { issueIds: [10] } }) }).revisionIssueIds).toEqual([9, 10])
    expect(fields({ run: run({ operation: 'review', revisionIssueIds: [9], result: { issueIds: [] } }) })).not.toHaveProperty('revisionIssueIds')
  })
  it.each(['summary', 'paragraphs'] as const)('keeps %s anchored to the saved prose even when a candidate or review exists', revisionTarget => {
    expect(fields({ revisionTarget, run: run({}) })).not.toHaveProperty('sourceArtifactId')
    expect(fields({ revisionTarget, run: run({ operation: 'review', revisionIssueIds: [9] }) })).not.toHaveProperty('revisionIssueIds')
  })
  it('does not attach a source artifact when an empty chapter is generated for the first time', () => {
    expect(fields({ hasSavedProse: false })).toEqual({ request: expect.stringContaining('生成第 4 章《夜试》') })
    expect(fields({ hasSavedProse: false })).not.toHaveProperty('sourceArtifactId')
    expect(fields({ hasSavedProse: true, run: run({ artifactId: undefined, status: 'completed', step: 'completed' }) })).not.toHaveProperty('sourceArtifactId')
  })
  it('attaches an unapplied candidate for this chapter and ignores another chapter', () => {
    expect(fields({ run: run({ status: 'paused', step: 'reviewing' }) }).sourceArtifactId).toBe('draft-4')
    expect(fields({ hasSavedProse: false, run: run({ step: 'needs_attention', status: 'blocked' }) }).sourceArtifactId).toBe('draft-4')
    expect(fields({ run: run({ atChapter: 3 }) })).not.toHaveProperty('sourceArtifactId')
    expect(fields({ userRequest: '只改对话', run: run({}) })).toMatchObject({ request: '只改对话', sourceArtifactId: 'draft-4' })
  })
  it('keeps a same-chapter review free of sourceArtifactId and labels its advice as not a new fact', () => {
    const message = `${'甲'.repeat(500)}乙尾`
    const review = fields({ run: run({ operation: 'review', artifactId: 'report-4', revisionIssueIds: [9, 10], message, status: 'completed', step: 'completed' }) })
    expect(review).not.toHaveProperty('sourceArtifactId')
    expect(review.revisionIssueIds).toEqual([9, 10])
    expect(review.request.startsWith('结合本章安排、现有设定与前文，审阅并修订第 4 章《夜试》')).toBe(true)
    expect(review.request).toContain('评审意见（不是新事实）：')
    expect(review.request).toContain(message.slice(0, 500))
    expect(review.request).not.toContain(message.slice(500))
    expect(fields({ userRequest: '按我的意见改', run: run({ operation: 'review', revisionIssueIds: [3], message }) })).toEqual({ request: '按我的意见改', revisionIssueIds: [3] })
    expect(fields({ run: run({ operation: 'review', atChapter: 2, revisionIssueIds: [3], message }) })).not.toHaveProperty('revisionIssueIds')
  })
})
