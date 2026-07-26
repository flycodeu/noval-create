import { describe, expect, it } from 'vitest'
import { buildReviewNotesViewModel, reviewNoteValueToTexts } from './review-notes-presentation'

/**
 * Exhaustive fixture: every known ReviewNotes field with a non-empty value,
 * plus one unknown field, so the "no field silently dropped" invariant can be
 * asserted against the whole surface.
 */
const FULL_NOTES: Record<string, unknown> = {
  // critical tier
  critical_fixes: ['修复主角动机断裂'],
  continuity_risks: ['上一章受伤的左手本章消失'],
  context_drift_risks: ['地点从码头漂移到城门'],
  coherence_risks: ['第三场景因果链缺失'],
  realism_risks: ['三天走完两千里不合理'],
  arc_progress_risks: ['本卷弧线连续四章停滞'],
  // advisory tier
  language_risks: ['排比句密度偏高'],
  human_language_repairs: ['"内心深处" → 更具体的身体反应'],
  reader_hook_risks: ['章尾钩子弱'],
  genre_hollowing_risks: ['悬疑要素被日常对话稀释'],
  dialogue_filler_risks: ['寒暄对白超过三轮'],
  dialogue_info_density_risks: ['审讯戏信息密度不足'],
  dialogue_drift_alerts: [
    { characterId: 3, characterName: '沈青', driftRate: 0.42, reason: '语气突然文绉绉' },
  ],
  cross_character_similarity: [
    { characterAId: 1, characterAName: '林决', characterBId: 2, characterBName: '老周', similarity: 0.81, reason: '口头禅重合' },
  ],
  // reference tier (known but statistical / marker fields)
  summary: '本章整体可用，两处必须修复。',
  revision_brief: '优先修复连续性，再压语言。',
  protagonist_setback: 'minor',
  setback_summary: '追踪失败暴露行迹',
  cost_present: true,
  cost_summary: '损失了唯一的信物',
  cost_resolution_state: 'ongoing',
  reversal_marker: true,
  reversal_summary: '盟友倒戈',
  reversal_support_state: 'supported',
  pace_marker: 'conflict',
  reward_state: 'partial',
  protagonist_pressure: 72,
  dialogue_homogenization_risks: ['配角甲乙口吻趋同'],
  dialogue_fingerprint_summary: '主角指纹清晰，配角偏弱',
  dialogue_voice_lock_summary: '已锁定 2 名角色声线',
  required_voice_lock_character_ids: [3, 5],
  humanization_signals: [
    { issueType: 'template', title: '模板化开场', severity: 'medium', detail: '连续三章以天气开场', avoid: '天气开场', prefer: '动作切入' },
  ],
  contract_validation: { summary: '合同兑现 4/5', rewriteHints: ['补足第二场景的线索交接'] },
  // unknown field: must fall into reference with its raw name preserved
  brand_new_backend_field: ['后端新增的未知条目'],
}

describe('buildReviewNotesViewModel', () => {
  it('classifies critical fields into the critical tier', () => {
    const model = buildReviewNotesViewModel(FULL_NOTES)
    expect(model.critical.map((item) => item.key)).toEqual([
      'critical_fixes',
      'continuity_risks',
      'context_drift_risks',
      'coherence_risks',
      'realism_risks',
      'arc_progress_risks',
    ])
    model.critical.forEach((item) => expect(item.severity).toBe('critical'))
  })

  it('classifies advisory fields into the advisory tier', () => {
    const model = buildReviewNotesViewModel(FULL_NOTES)
    expect(model.advisory.map((item) => item.key)).toEqual([
      'language_risks',
      'human_language_repairs',
      'reader_hook_risks',
      'genre_hollowing_risks',
      'dialogue_filler_risks',
      'dialogue_info_density_risks',
      'dialogue_drift_alerts',
      'cross_character_similarity',
    ])
    model.advisory.forEach((item) => expect(item.severity).toBe('advisory'))
  })

  it('never silently drops any field: every notes key lands in exactly one tier', () => {
    const model = buildReviewNotesViewModel(FULL_NOTES)
    const surfacedKeys = [...model.critical, ...model.advisory, ...model.reference].map((item) => item.key)
    expect(new Set(surfacedKeys)).toEqual(new Set(Object.keys(FULL_NOTES)))
    expect(surfacedKeys).toHaveLength(Object.keys(FULL_NOTES).length)
  })

  it('routes unknown fields to reference and preserves the raw field name', () => {
    const model = buildReviewNotesViewModel(FULL_NOTES)
    const unknown = model.reference.find((item) => item.key === 'brand_new_backend_field')
    expect(unknown).toBeDefined()
    expect(unknown?.label).toBe('brand_new_backend_field')
    expect(unknown?.texts).toEqual(['后端新增的未知条目'])
    expect(unknown?.severity).toBe('reference')
  })

  it('formats structured entries into readable lines', () => {
    const model = buildReviewNotesViewModel(FULL_NOTES)
    const similarity = model.advisory.find((item) => item.key === 'cross_character_similarity')
    expect(similarity?.texts[0]).toContain('林决 × 老周')
    expect(similarity?.texts[0]).toContain('相似度 0.81')
    const drift = model.advisory.find((item) => item.key === 'dialogue_drift_alerts')
    expect(drift?.texts[0]).toContain('沈青')
    const contract = model.reference.find((item) => item.key === 'contract_validation')
    expect(contract?.texts).toEqual(['合同兑现 4/5', '修补建议：补足第二场景的线索交接'])
  })

  it('drops empty values but keeps meaningful falsy scalars', () => {
    const model = buildReviewNotesViewModel({
      critical_fixes: [],
      summary: '   ',
      cost_present: false,
      protagonist_pressure: 0,
      unknown_null: null,
    })
    expect(model.critical).toEqual([])
    const keys = model.reference.map((item) => item.key)
    expect(keys).toContain('cost_present')
    expect(keys).toContain('protagonist_pressure')
    expect(keys).not.toContain('summary')
    expect(keys).not.toContain('unknown_null')
  })

  it('returns an empty model for null / non-object input', () => {
    expect(buildReviewNotesViewModel(null)).toEqual({ critical: [], advisory: [], reference: [] })
    expect(buildReviewNotesViewModel(undefined)).toEqual({ critical: [], advisory: [], reference: [] })
  })
})

describe('reviewNoteValueToTexts', () => {
  it('serializes unknown object entries instead of dropping them', () => {
    const texts = reviewNoteValueToTexts('mystery_list', [{ foo: 1 }, 'plain', 2])
    expect(texts).toEqual(['{"foo":1}', 'plain', '2'])
  })

  it('serializes unknown plain objects', () => {
    expect(reviewNoteValueToTexts('mystery_obj', { a: 'b' })).toEqual(['{"a":"b"}'])
    expect(reviewNoteValueToTexts('mystery_obj', {})).toEqual([])
  })
})
