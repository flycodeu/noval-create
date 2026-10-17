import { describe, expect, it } from 'vitest'
import { objectTaskFromRoute } from './object-task'
import { revisionTarget } from './revision-target'

describe('object task revision target', () => {
  it('retains the original chapter, scope, candidate, issues and paragraph selection', () => {
    const input = { stage: 'chapter' as const, request: '只改选定段落', atChapter: 6, count: 1, sourceArtifactId: 'candidate:314', changeScope: { chapterIds: [687], newEntityCount: 0, allowNewRelations: false }, revisionIssueIds: [12], chapterRevision: { target: 'paragraphs' as const, paragraphIndexes: [3, 5] } }
    expect(objectTaskFromRoute(revisionTarget(input), '第六章')).toMatchObject({ ...input, title: '第六章', initialAutoApply: false })
  })
  it('rejects missing stages and malformed scope rather than opening a generic task', () => {
    expect(() => objectTaskFromRoute('guide?request=test', 'test')).toThrow()
    expect(() => objectTaskFromRoute('guide?stage=chapter&atChapter=-1', 'test')).toThrow()
    expect(() => objectTaskFromRoute('guide?stage=chapter&changeScope=bad', 'test')).toThrow()
  })
})
