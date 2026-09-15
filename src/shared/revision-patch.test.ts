import { describe, expect, it } from 'vitest'
import {
  applyRevisionPatch,
  buildRevisionPatchArtifactHash,
  RevisionPatchValidationError,
  validateRevisionPatch,
  validateRevisionPatchEvidence,
  revisionPatchNeedsAuthorReview,
  type RevisionPatch,
} from './revision-patch'

function patchFor(content: string, patches: RevisionPatch['patches']): RevisionPatch {
  return { baseArtifactHash: buildRevisionPatchArtifactHash(content), patches }
}

describe('revision patch C-07', () => {
  it('RF-08 rejects offsets splitting an emoji and binds edits to current issue evidence', () => {
    const content = '😀她收好钥匙。必要线索保留。'
    const patch = patchFor(content, [{ start: 2, end: 3, expectedText: '她', replacement: '他', issueIds: ['pronoun'] }])
    const evidence = [{ issueId: 'pronoun', artifactHash: patch.baseArtifactHash, start: 2, end: 3, quote: '她' }]
    expect(() => validateRevisionPatchEvidence(content, patch, evidence)).not.toThrow()
    expect(applyRevisionPatch(content, patch)).toBe('😀他收好钥匙。必要线索保留。')
    expect(() => applyRevisionPatch(content, patchFor(content, [{ start: 1, end: 2, expectedText: content[1], replacement: '', issueIds: ['emoji'] }]))).toThrow(/NF_PATCH_RANGE/)
    expect(() => validateRevisionPatchEvidence(content, patch, [])).toThrow(/NF_PATCH_EVIDENCE/)
    expect(() => validateRevisionPatchEvidence(content, patch, [{ ...evidence[0], issueId: 'invented' }])).toThrow(/NF_PATCH_EVIDENCE/)
    expect(() => validateRevisionPatchEvidence(content, patch, [{ ...evidence[0], artifactHash: 'old' }])).toThrow(/NF_PATCH_EVIDENCE/)
    const outside = patchFor(content, [{ start: 3, end: 5, expectedText: '收好', replacement: '丢掉', issueIds: ['pronoun'] }])
    expect(() => validateRevisionPatchEvidence(content, outside, evidence)).toThrow(/NF_PATCH_EVIDENCE/)
    expect(() => validateRevisionPatchEvidence(content, { ...patch, patches: [{ ...patch.patches[0], replacement: '她' }] }, evidence)).toThrow(/NF_PATCH_EVIDENCE/)
  })

  it('RF-08 materializes evidenced deletion beyond 25 percent without padding, routing it to the author', () => {
    const redundant = '这句话把刚刚发生的事又解释了一遍。'.repeat(4)
    const content = `钥匙藏在盒底。${redundant}她仍舍不得走。`
    const start = content.indexOf(redundant)
    const patch = patchFor(content, [{ start, end: start + redundant.length, expectedText: redundant, replacement: '', issueIds: ['redundant'] }])
    validateRevisionPatchEvidence(content, patch, [{ issueId: 'redundant', artifactHash: patch.baseArtifactHash, start, end: start + redundant.length, quote: redundant }])
    expect(applyRevisionPatch(content, patch)).toBe('钥匙藏在盒底。她仍舍不得走。')
    expect(revisionPatchNeedsAuthorReview(content, patch)).toBe(true)
  })
  it('changes only the second duplicate sentence', () => {
    const content = '他回头。\n他回头。\n门外落雨。'
    const start = content.indexOf('他回头。', content.indexOf('他回头。') + 1)
    const result = applyRevisionPatch(content, patchFor(content, [{
      start,
      end: start + '他回头。'.length,
      expectedText: '他回头。',
      replacement: '他猛地回头。',
      issueIds: ['issue:duplicate-2'],
    }]))

    expect(result).toBe('他回头。\n他猛地回头。\n门外落雨。')
  })

  it.each([
    ['hash mismatch', (_content: string) => ({ baseArtifactHash: 'wrong', patches: [] }), 'NF_PATCH_BASE_MISMATCH'],
    ['overlap', (content: string) => patchFor(content, [
      { start: 0, end: 2, expectedText: 'ab', replacement: 'x', issueIds: ['a'] },
      { start: 1, end: 3, expectedText: 'bc', replacement: 'y', issueIds: ['b'] },
    ]), 'NF_PATCH_OVERLAP'],
    ['wrong expected text', (content: string) => patchFor(content, [
      { start: 0, end: 2, expectedText: 'zz', replacement: 'x', issueIds: ['a'] },
    ]), 'NF_PATCH_EXPECTED'],
    ['out of bounds', (content: string) => patchFor(content, [
      { start: 0, end: 99, expectedText: content, replacement: 'x', issueIds: ['a'] },
    ]), 'NF_PATCH_RANGE'],
  ])('rejects the entire batch on %s', (_name, build, code) => {
    const content = 'abcdef'
    expect(() => applyRevisionPatch(content, build(content))).toThrowError(
      expect.objectContaining({ code }),
    )
    expect(content).toBe('abcdef')
  })

  it('rejects a patch touching a locked span before producing a candidate', () => {
    const content = '保留段。可修段。'
    const start = content.indexOf('保留段。')
    let thrown: unknown
    try {
      applyRevisionPatch(content, patchFor(content, [{
        start,
        end: start + '保留段。'.length,
        expectedText: '保留段。',
        replacement: '改写段。',
        issueIds: ['locked'],
      }]), [{ start, end: start + '保留段。'.length }])
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RevisionPatchValidationError)
    expect(thrown).toMatchObject({ code: 'NF_PATCH_LOCKED' })
    expect(content).toBe('保留段。可修段。')
  })

  it('uses UTF-16 offsets without splitting emoji and preserves CRLF', () => {
    const content = '😀 CRLF\r\n第二句。'
    const start = content.indexOf('第二句。')
    const patched = applyRevisionPatch(content, patchFor(content, [{
      start,
      end: start + '第二句。'.length,
      expectedText: '第二句。',
      replacement: '第二句已改。',
      issueIds: ['emoji-crlf'],
    }]))
    expect(patched).toBe('😀 CRLF\r\n第二句已改。')
    expect(validateRevisionPatch(content, patchFor(content, [{
      start: 0,
      end: 2,
      expectedText: '😀',
      replacement: '🙂',
      issueIds: ['emoji'],
    }]))).toHaveLength(1)
  })
})
