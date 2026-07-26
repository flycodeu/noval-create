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
  it('does not treat descriptive references like “这两个数字” as changed narrative quantities', () => {
    expect(__testing.extractNarrativeNumbers('她确认“7”这两个数字。地下二层还有两个人。')).toEqual(['7', '二层', '两个人'])
  })

  it('blocks reversal of end-of-chapter object ownership and non-blocking state', () => {
    const original = '母亲把钥匙推到她面前。她把钥匙收进包里。母亲没有拦她。'
    const optimized = '母亲把钥匙推到她面前。她把钥匙留在桌上。母亲收走钥匙，她没有带走那把钥匙。'

    const warnings = __testing.collectNarrativeStateWarnings(original, optimized)

    expect(warnings.join('；')).toContain('物件持有状态')
    expect(warnings.join('；')).toContain('未阻拦主角离开')
  })

  it('keeps the ownership check active when a candidate appends a long tail', () => {
    const original = '她把钥匙收进包里。母亲没有拦她。'
    const optimized = [
      '她把钥匙留在桌上。',
      '她又检查了一遍复印件。',
      '她没有再说话。',
      '门外的灯灭了。',
      '她把文件袋放回桌边。',
      '母亲看向窗外。',
      '水声停了。',
      '她想起明天的安排。',
      '她仍然没有解释。',
      '她把手机收起。',
      '她重新整理衣袖。',
      '她看了一眼门锁。',
      '她把椅子推回原处。',
      '她确认灯已经关掉。',
      '她拎起文件袋。',
      '她没有回头。',
      '母亲没有拦她。',
    ].join('')

    const warnings = __testing.collectNarrativeStateWarnings(original, optimized)

    expect(warnings.join('；')).toContain('物件持有状态')
  })

  it('uses the last object and exit event instead of flagging transient states', () => {
    const original = '她把钥匙收进包里。母亲没有拦她。'
    const optimized = '她把钥匙留在桌上。母亲按住纸角。她后来把钥匙收进包里。母亲没有拦她。'

    expect(__testing.collectNarrativeStateWarnings(original, optimized)).toEqual([])
  })

  it('blocks unsupported evidence mutations during structural repair', () => {
    const original = '她把照片和钥匙收进包里，转身离开。'
    const optimized = '她把照片和钥匙收进包里，照片上却多了一道新折痕。她转身离开。'

    const warnings = __testing.collectUnsupportedNarrativeFactWarnings(original, optimized)

    expect(warnings.join('；')).toContain('物证形变或损伤')
    expect(warnings.join('；')).toContain('删除新增事实')
  })

  it('blocks newly invented records and exchange relationships', () => {
    const original = '母亲把钥匙推到她面前。她把钥匙收进包里。'
    const optimized = '母亲把钥匙推到她面前。她写下一行备忘录，用钥匙换照片。'

    const warnings = __testing.collectUnsupportedNarrativeFactWarnings(original, optimized)

    expect(warnings.join('；')).toContain('新增书写或记录物件')
    expect(warnings.join('；')).toContain('新增交换或交易关系')
  })

  it('blocks newly invented legal context and outside events', () => {
    const original = '明天买方要来核对资料。她把钥匙收进包里。'
    const optimized = '明天买方律师会追着产权异议材料往下查。她把钥匙收进包里。楼下的路灯坏了，脚步声响了两下就停。'

    const warnings = __testing.collectUnsupportedNarrativeFactWarnings(original, optimized)

    expect(warnings.join('；')).toContain('新增法律、证人或提交关系')
    expect(warnings.join('；')).toContain('新增外部事件或环境结果')
  })

  it('does not reclassify an already established narrative fact as new', () => {
    const original = '照片上有一道折痕，母亲提出交换钥匙。'
    const optimized = '照片上仍有那道折痕，母亲再次提出交换钥匙。'

    expect(__testing.collectUnsupportedNarrativeFactWarnings(original, optimized)).toEqual([])
  })

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
