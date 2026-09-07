import { describe, expect, it } from 'vitest'
import {
  applyRevisionPatch,
  buildRevisionPatchArtifactHash,
  RevisionPatchValidationError,
  validateRevisionPatch,
  type RevisionPatch,
} from './revision-patch'

function patchFor(content: string, patches: RevisionPatch['patches']): RevisionPatch {
  return { baseArtifactHash: buildRevisionPatchArtifactHash(content), patches }
}

describe('revision patch C-07', () => {
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
