import { describe, expect, it } from 'vitest'
import { compileNarrativeTechniques, NARRATIVE_TECHNIQUES, selectNarrativeTechniques } from './narrative-techniques'

describe('RF-06 optional scene techniques', () => {
  it('selects different grounded methods for action, everyday relationships and investigation', () => {
    const action = selectNarrativeTechniques({ purpose: '躲过追击，沿山路逃走', location: '雪山', present_characters: ['主角'] })
    const relationship = selectNarrativeTechniques({ purpose: '商量接母亲出院', present_characters: ['姐姐', '弟弟'], conflict: '弟弟担心迟到' })
    const investigation = selectNarrativeTechniques({ purpose: '检查窗框，辨认线索', location: '仓库' })
    expect(action.map((m) => m.id)).toContain('environment_action')
    expect(relationship.map((m) => m.id)).toContain('relationship_dialogue')
    expect(investigation.map((m) => m.id)).toContain('information_reveal')
    expect(selectNarrativeTechniques({ purpose: '把碗洗好' })).toEqual([])
    expect(compileNarrativeTechniques([{ purpose: '把碗洗好' }]).text).toBe('')
  })
  it('keeps sources, applicability and counterexamples in the catalog; does not inject book titles', () => {
    expect(NARRATIVE_TECHNIQUES).toHaveLength(6)
    for (const method of NARRATIVE_TECHNIQUES) {
      expect(method.sources.length).toBeGreaterThan(0)
      expect(method.requires && method.applicable && method.counterexample).toBeTruthy()
    }
    const result = compileNarrativeTechniques([{ scene_order: 2, purpose: '商量借钱', present_characters: ['甲', '乙'] }])
    expect(result.text).toContain('第 2 场')
    expect(result.text).not.toMatch(/傲慢与偏见|gutenberg|必须使用|方法评分/)
  })
})
