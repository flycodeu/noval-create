import { describe, expect, it } from 'vitest'
import { __testing } from './chapter.service'

const baseReviewNotes = {
  language_risks: [],
  revision_brief: '',
  dialogue_homogenization_risks: ['旧 Critic 风险'],
  dialogue_fingerprint_summary: '旧画像',
  dialogue_voice_lock_summary: '旧 Voice Lock',
  dialogue_filler_risks: ['旧空转'],
  dialogue_info_density_risks: ['旧信息密度'],
  required_voice_lock_character_ids: [7],
} as any

const cleanAnalysis = {
  fingerprintSummary: '当前对白画像',
  voiceLockSummary: '',
  risks: [],
  similarities: [],
  drifts: [],
  fillerRisks: [],
  infoDensityRisks: [],
  requiredVoiceLockCharacterIds: [],
}

describe('chapter dialogue review refresh', () => {
  it('keeps upstream findings during the initial merge', () => {
    const result = __testing.applyDialogueAnalysisToReviewNotes(
      baseReviewNotes,
      1,
      1,
      '',
      cleanAnalysis,
    )

    expect(result.dialogue_homogenization_risks).toEqual(['旧 Critic 风险'])
    expect(result.dialogue_filler_risks).toEqual(['旧空转'])
    expect(result.required_voice_lock_character_ids).toEqual([7])
  })

  it('clears stale upstream findings when the rewritten content is revalidated', () => {
    const result = __testing.applyDialogueAnalysisToReviewNotes(
      baseReviewNotes,
      1,
      1,
      '',
      cleanAnalysis,
      { replaceExistingSignals: true },
    )

    expect(result.dialogue_homogenization_risks).toEqual([])
    expect(result.dialogue_fingerprint_summary).toBe('当前对白画像')
    expect(result.dialogue_voice_lock_summary).toBe('')
    expect(result.dialogue_filler_risks).toEqual([])
    expect(result.dialogue_info_density_risks).toEqual([])
    expect(result.required_voice_lock_character_ids).toEqual([])
  })

  it('preserves rewrite recheck evidence when a failed role saves the usable draft', () => {
    const result = __testing.parseStoredReviewNotes(JSON.stringify({
      rewrite_recheck: {
        performed: true,
        checkedAt: '2026-07-18T06:36:00.000Z',
        resolved: ['旧开篇风险'],
      },
    }))

    expect(result.rewrite_recheck).toEqual({
      performed: true,
      checkedAt: '2026-07-18T06:36:00.000Z',
      resolved: ['旧开篇风险'],
    })
  })
})
