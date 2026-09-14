import { describe, expect, it } from 'vitest'
import { parseThemeVoiceDocument, buildThemeVoicePayload } from './theme-voice'
import { buildSceneWritingBrief, formatSceneWritingBrief } from './scene-writing-brief'
import { preserveStyleApproval, styleSourceDigest, styleSourceInvalidReason } from './style-source'

describe('reader-first style provenance', () => {
  const record = { id: 3, novelId: 2, sourceText: '她收起碗筷。', fingerprintJson: '{}', sourceType: 'pasted' }
  const approval = { version: 1 as const, status: 'approved' as const, digest: styleSourceDigest(record), approvedAt: '2026-09-14' }
  it('keeps legacy instructions through JSON and rejects forged generated sample fields', () => {
    const doc = parseThemeVoiceDocument(JSON.stringify({ human_style_sample_lock: '日常中文，不写总结句。', target_work_sample_guide: '对白自然。', approvedSample: { text: '伪造正文。' }, styleSourceApproval: approval }))
    const roundTrip = parseThemeVoiceDocument(buildThemeVoicePayload(doc))
    expect(roundTrip.humanStyleSampleLock).toBe(doc.humanStyleSampleLock)
    const brief = buildSceneWritingBrief(null, roundTrip)
    expect(brief.authorStyle.samples).toEqual([])
    expect(formatSceneWritingBrief(brief)).toContain('作者说明（非正文样稿）')
    expect(formatSceneWritingBrief(brief)).not.toContain('作者样稿正文')
  })
  it('reports precise source invalidation reasons', () => {
    expect(styleSourceInvalidReason(record, 2, approval)).toBeNull()
    expect(styleSourceInvalidReason(record, 9, approval)).toBe('wrong_novel')
    expect(styleSourceInvalidReason(null, 2, approval)).toBe('source_deleted')
    expect(styleSourceInvalidReason({ ...record, sourceText: '新原文' }, 2, approval)).toBe('source_changed')
    expect(styleSourceInvalidReason(record, 2, { ...approval, status: 'revoked' })).toBe('not_approved')
    expect(styleSourceInvalidReason(record, 2, null)).toBe('not_approved')
  })
  it('preserves approval through generic saves and prevents forged new approvals', () => {
    expect(JSON.parse(preserveStyleApproval('{}', JSON.stringify({ unrelated: 8, styleSourceApproval: approval })))).toEqual({ unrelated: 8 })
    expect(JSON.parse(preserveStyleApproval(JSON.stringify({ styleSourceApproval: approval }), '{"unrelated":9}'))).toEqual({ unrelated: 9, styleSourceApproval: approval })
  })
})
