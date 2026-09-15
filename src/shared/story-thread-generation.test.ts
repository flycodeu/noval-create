import { describe, expect, it } from 'vitest'
import { formatSceneStoryDesign, isSceneStoryDesign, reviewRecentStoryDesign,
  type RecentStoryDesignProjection, type StoryDesignScene } from './story-thread-generation'

const scene = (overrides: Partial<StoryDesignScene> = {}): StoryDesignScene => ({
  scene_order: 1, purpose: '接着过日子', conflict: '', beat: '一起吃晚饭', location: '家中', present_characters: ['林夏'], ...overrides,
})
const projection = (): RecentStoryDesignProjection => ({ novelId: 1, chapterNum: 4, sources: [], recentPlans: [], diagnostics: [],
  threads: [
    { id: 1, title: '参赛资格', payoff: '取得参赛资格', state: '报名已提交', status: 'active', dueChapter: 4, provenance: 'registered-unconfirmed' },
    { id: 2, title: '夺冠', payoff: '赢得决赛冠军', state: '尚未比赛', status: 'active', dueChapter: 12, provenance: 'registered-unconfirmed' },
  ] })

describe('RF-09 recent story editing', () => {
  it('01 keeps qualification and championship separate; a response proposal cannot resolve stored promises', () => {
    const context = projection()
    const before = structuredClone(context)
    const qualified = scene({ story_design: { expectations: [{ thread_id: 1, action: 'respond', expected_payoff: '取得参赛资格', outcome: '资格确认书寄到，比赛下月开始' }] } })
    expect(reviewRecentStoryDesign([qualified], context)).toEqual([])
    expect(context).toEqual(before)
    expect(formatSceneStoryDesign(qualified.story_design)).toContain('拟回应故事线 1（不是已兑现）')
    const wrong = scene({ story_design: { expectations: [{ thread_id: 2, action: 'respond', expected_payoff: '取得参赛资格', outcome: '收到确认书' }] } })
    expect(reviewRecentStoryDesign([wrong], context)).toMatchObject([{ code: 'expectation_reference', evidence: expect.stringContaining('赢得决赛冠军') }])
  })

  it('02 allows quiet satisfaction with an independent supporting character concern and no new crisis', () => {
    const quiet = scene({ story_design: { choices: [{ character: '周宁', wants: '陪母亲吃饭，也按时回店交班',
      options: ['吃过饭回店', '请同事晚交半小时'], stake: '不能总让同事代班' }], result: '照护安排照常执行，两人安心吃饭', aftermath: '周宁收好工作服，准备交班' } })
    expect(isSceneStoryDesign(quiet.story_design)).toBe(true)
    expect(reviewRecentStoryDesign([quiet], projection())).toEqual([])
    const text = formatSceneStoryDesign(quiet.story_design)
    expect(text).toContain('不能总让同事代班')
    expect(text).toContain('两人安心吃饭')
    expect(isSceneStoryDesign({ result: '安静收束' })).toBe(true)
  })

  it('03 returns new-clue replacement and renamed event structures to planning with prior evidence', () => {
    const context = projection()
    const raise = { thread_id: null, action: 'raise' as const, expected_payoff: '新线索的来历', outcome: '收到另一封信' }
    const old = scene({ location: '河镇', conflict: '河镇执事扣住信件要求交费', beat: '林夏替河镇找药后取回信件', story_design: { expectations: [raise] } })
    context.recentPlans = [2, 3].map((chapterNum) => ({ chapterNum, hash: `plan-${chapterNum}`, scenes: [old] }))
    const next = scene({ location: '山城', present_characters: ['沈桥'], conflict: '山城执事扣住信件要求交费',
      beat: '沈桥替山城找药后取回信件', story_design: { expectations: [raise] } })
    const findings = reviewRecentStoryDesign([next], context)
    expect(findings.map((item) => item.code)).toEqual(['repeated_structure', 'unanswered_expectation'])
    expect(findings[0]).toMatchObject({ route: 'contract_replan', evidence: expect.stringContaining('第2章场景1（plan-2）') })
    next.story_design!.expectations!.push({ thread_id: 1, action: 'defer', expected_payoff: '取得参赛资格', outcome: '审核缺页，先补交页码并约好次日领取' })
    expect(reviewRecentStoryDesign([next], context).some((item) => item.code === 'unanswered_expectation')).toBe(false)
    next.beat = '沈桥放弃取信，公开自己的署名与执事协商延期'
    expect(reviewRecentStoryDesign([next], context)).toEqual([])
  })

  it('04 preserves belief, confirmed ability and relationship state and rejects invented authority', () => {
    const context = projection()
    context.sources = [
      { id: 'belief:1', hash: 'belief-hash', kind: 'belief', authority: 'belief', state: '林夏误以为邻居偷了信' },
      { id: 'ability:1', hash: 'ability-hash', kind: 'ability', authority: 'confirmed', state: '林夏已能辨认旧印章' },
      { id: 'relation:1', hash: 'relation-hash', kind: 'relationship', authority: 'confirmed', state: '两人已经达成照护安排' },
    ]
    const uses = context.sources.map((source) => ({ source_id: source.id, source_hash: source.hash, expected_state: source.state,
      resulting_state: source.state, interpretation: source.kind === 'belief' ? 'belief' as const : 'fact' as const }))
    expect(reviewRecentStoryDesign([scene({ story_design: { state_uses: uses } })], context)).toEqual([])
    uses[0].interpretation = 'fact'
    uses[1].resulting_state = '林夏从未学过辨认印章'
    uses[2].resulting_state = '两人互不信任，照护无人承担'
    uses.push({ source_id: 'new-universal-permission', source_hash: 'invented', expected_state: '万能权限能开任何门', resulting_state: '万能权限能开任何门', interpretation: 'fact' })
    expect(reviewRecentStoryDesign([scene({ story_design: { state_uses: uses } })], context).map((item) => item.code))
      .toEqual(['belief_promoted', 'state_reset', 'state_reset', 'state_source'])
    const stale = [{ ...uses[1], source_hash: 'old' }]
    expect(reviewRecentStoryDesign([scene({ story_design: { state_uses: stale } })], context)[0].code).toBe('state_source')
  })

  it('rejects malformed nested fields and model-declared author approval', () => {
    expect(isSceneStoryDesign({ expectations: [{ thread_id: null, action: 'respond', expected_payoff: '赢了', outcome: '赢了' }] })).toBe(false)
    expect(isSceneStoryDesign({ authorConfirmed: true })).toBe(false)
    expect(isSceneStoryDesign({ choices: [{ character: '甲', wants: '休息', stake: '', options: '睡觉' }] })).toBe(false)
    expect(isSceneStoryDesign({ state_uses: [{ source_id: 'a', source_hash: 'b', expected_state: 'c', resulting_state: 'c', interpretation: 'fact', author: true }] })).toBe(false)
  })

  it('flags an explicit universal rescue even when the plan omits state_uses, but permits refusing it', () => {
    expect(reviewRecentStoryDesign([scene({ beat: '林夏临时获得万能权限并打开大门脱困' })], projection())[0].code).toBe('state_source')
    expect(reviewRecentStoryDesign([scene({ beat: '林夏拒绝使用万能权限打开大门，决定等同伴回来' })], projection())).toEqual([])
  })

  it('03 detects the same declared causal pattern behind renamed cultivation stages while allowing changed consequences', () => {
    const context = projection()
    context.recentPlans = [{ chapterNum: 3, hash: 'earlier-stage', scenes: [scene({ conflict: '初阶弟子遇到守关人', beat: '初阶弟子赢了对决',
      story_design: { causal_pattern: '守门人索取资源，主角靠隐藏实力击败守门人，再换一处考验', result: '得到通行资格' } })] }]
    const later = scene({ conflict: '高阶修士遇到守关人', beat: '高阶修士赢了对决',
      story_design: { causal_pattern: '守门人索取资源，主角靠隐藏实力击败守门人，再换一处考验', result: '得到通行资格' } })
    expect(reviewRecentStoryDesign([later], context)[0].code).toBe('repeated_structure')
    later.story_design!.result = '同伴拒绝再陪他闯关，两人约定从此分别行动'
    expect(reviewRecentStoryDesign([later], context)).toEqual([])
  })
})
