import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeCandidateSimilarity } from './variation-control.service'
vi.mock('./variation-control.service', () => ({
  computeCandidateSimilarity: vi.fn(() => 0.5),
}))

import {
  analyzeChapterReadingExperience,
  analyzeRewriteNarrativeDelta,
  buildAdaptiveRewritePolicy,
  buildDialogueRepairDirective,
  buildReviewPriorityPrompt,
  buildReviewPrioritySummary,
  buildStructuralRepairDirective,
  buildRewriteMiniReviewVerdict,
} from './chapter-pipeline-policy.service'

function createReviewNotes(overrides: Partial<Parameters<typeof buildReviewPrioritySummary>[0]> = {}) {
  return {
    critical_fixes: [],
    continuity_risks: [],
    arc_progress_risks: [],
    context_drift_risks: [],
    realism_risks: [],
    coherence_risks: [],
    reader_hook_risks: [],
    step_memory_risks: [],
    opening_hook_risks: [],
    title_alignment_risks: [],
    hallucination_risks: [],
    typed_ref_risks: [],
    source_grounding_risks: [],
    operating_mode_risks: [],
    long_window_humanization_risks: [],
    dialogue_separability_risks: [],
    language_risks: [],
    human_language_repairs: [],
    genre_hollowing_risks: [],
    missing_payoffs: [],
    dialogue_homogenization_risks: [],
    dialogue_filler_risks: [],
    dialogue_info_density_risks: [],
    severity: 'medium' as const,
    rewrite_required: false,
    contract_validation: { status: 'pass' as const, rewriteHints: [] },
    ...overrides,
  }
}

describe('chapter pipeline policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.5)
  })

  it('prioritizes critical structural issues ahead of low-value language fixes', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['补上主角失败后的代价兑现。'],
      continuity_risks: ['上一章的伤势在本章开头消失了。'],
      language_risks: ['“某种无法言说的感觉”过于模板。'],
      human_language_repairs: ['“气氛变得凝重” -> “屋里一下安静下来”。'],
      dialogue_filler_risks: ['两轮对白都在重复确认同一件事。'],
    }))
    const continuityIndex = summary.topIssues.findIndex((issue) => issue.source === 'continuity_risks')
    const fillerIndex = summary.topIssues.findIndex((issue) => issue.source === 'dialogue_filler_risks')

    expect(summary.topIssues[0]?.source).toBe('critical_fixes')
    expect(summary.topIssues.some((issue) => issue.source === 'continuity_risks')).toBe(true)
    expect(fillerIndex).toBeGreaterThan(continuityIndex)
  })

  it('forces full rewrite and max coverage for dense high-risk review results', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      continuity_risks: ['连续性断裂'],
      arc_progress_risks: ['故事弧空转'],
      severity: 'high',
      rewrite_required: true,
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.requiresFullRewrite).toBe(true)
    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.temperatureCap).toBe(0.7)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(policy.reviewDepth).toBe('deep')
  })

  it('routes new provenance and long-window findings into rewrite priority and max coverage', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      typed_ref_risks: ['线程引用仍有 unresolved typed ref。'],
      source_grounding_risks: ['历史正剧当前来源覆盖不足。'],
      operating_mode_risks: ['百万字模式下 checkpoint 已落后 9 章。'],
      long_window_humanization_risks: ['长窗模板复现：近期命中 4 次。'],
      dialogue_separability_risks: ['高相似角色对 2 组。'],
      language_risks: ['个别句子仍偏模板。'],
      rewrite_required: true,
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.topIssues.map((issue) => issue.source)).toEqual(expect.arrayContaining([
      'typed_ref_risks',
      'source_grounding_risks',
      'operating_mode_risks',
      'long_window_humanization_risks',
      'dialogue_separability_risks',
    ]))
    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(summary.topIssues.findIndex((issue) => issue.source === 'typed_ref_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
  })

  it('emits concrete dialogue repair instructions with pair evidence', () => {
    const directive = buildDialogueRepairDirective({
      similarities: [{
        characterAId: 1,
        characterAName: '陆怀工',
        characterBId: 2,
        characterBName: '罗大桩',
        similarity: 82,
        reason: '句式偏好重合：短句密集',
      }],
      infoDensityRisks: ['安全员质问段落对白过简，缺少追问层次。'],
    })

    expect(directive).toContain('陆怀工 / 罗大桩')
    expect(directive).toContain('事实/现场')
    expect(directive).toContain('禁止安全员/旁观者直接替所有人把结论说完')
  })

  it('makes structural retry instructions measurable without weakening the gate', () => {
    const directive = buildStructuralRepairDirective({
      status: 'fail',
      structuralIssueCount: 3,
      similarityToOriginal: 0.84,
      changedSentenceRate: 8,
      narrativeAnchorChangeRate: -22,
      actionVerbDeltaRate: -12,
      findings: ['冲突链增量不足，更像改词句而不是修结构。'],
      recommendation: '需要重新组织事件链。',
      conflictChain: { status: 'fail', score: 20, originalHitRate: 0.2, rewrittenHitRate: 0.1, deltaRate: -10, findings: [] },
      costChain: { status: 'weak', score: 40, originalHitRate: 0.4, rewrittenHitRate: 0.38, deltaRate: -2, findings: [] },
      goalChain: { status: 'fail', score: 30, originalHitRate: 0.3, rewrittenHitRate: 0.25, deltaRate: -5, findings: [] },
    }, ['场景4的信息首次披露顺序必须调整。'])

    expect(directive).toContain('阻力/人物判断/行动选择/代价或结果')
    expect(directive).toContain('按场景顺序重新安排触发、回应和结果')
    expect(directive).toContain('场景4的信息首次披露顺序必须调整')
    expect(directive).toContain('章尾必须留下新的未完成动作')
    expect(directive).toContain('主动选择 -> 他人反应 -> 可见后果')
  })

  it('adds a compact dialogue repair panel when priority issues include dialogue risks', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      dialogue_homogenization_risks: ['多人对白同声化。'],
    }))
    const prompt = buildReviewPriorityPrompt(summary)

    expect(prompt).toContain('【对白定向修复】')
    expect(prompt).toContain('事实/现场')
  })

  it('routes weak theme, character, and relationship contract items into rewrite priority through arc risks', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      arc_progress_risks: [
        '每章冲突必须回应主题命题：正文只有提及，没有形成明确推进。',
        '林远必须完成一次选择、行动、代价或误信念裂缝：正文只有提及，没有形成明确推进。',
        '林远 × 赵临 的关系变化必须有触发事件、可见互动和后果：正文只有提及，没有形成明确推进。',
      ],
      contract_validation: {
        status: 'warning',
        rewriteHints: ['补强人物场景化兑现、主题回应和关系弧后果。'],
      },
    }))

    expect(summary.topIssues.some((issue) => issue.source === 'arc_progress_risks')).toBe(true)
    expect(summary.forceMaxCoverage).toBe(true)
  })

  it('prioritizes opening, title, step-memory, and hallucination risks ahead of polish', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      opening_hook_risks: ['前三百字仍在解释设定，没有现场压力。'],
      step_memory_risks: ['Writer 没有执行 Planner 的章首承接动作。'],
      title_alignment_risks: ['标题与本章核心事件不匹配。'],
      hallucination_risks: ['新增了未在上下文出现的特殊能力。'],
      language_risks: ['个别句子偏模板。'],
      rewrite_required: true,
    }))
    const policy = buildAdaptiveRewritePolicy(summary)
    const orderedSources = summary.topIssues.map((issue) => issue.source)

    expect(orderedSources).toEqual(expect.arrayContaining([
      'opening_hook_risks',
      'step_memory_risks',
      'title_alignment_risks',
      'hallucination_risks',
    ]))
    expect(orderedSources.indexOf('opening_hook_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
  })

  it('keeps batch 7 provenance and mode findings ahead of generic polish without rewrite_required', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      typed_ref_risks: ['线程引用仍有 unresolved typed ref。'],
      source_grounding_risks: ['历史正剧当前来源覆盖不足。'],
      operating_mode_risks: ['百万字模式下 checkpoint 已落后 9 章。'],
      language_risks: ['个别句子仍偏模板。'],
      human_language_repairs: ['把“心里一沉”换成更具体动作。'],
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(summary.topIssues.findIndex((issue) => issue.source === 'typed_ref_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
    expect(summary.topIssues.findIndex((issue) => issue.source === 'source_grounding_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'human_language_repairs'))
    expect(summary.topIssues.findIndex((issue) => issue.source === 'operating_mode_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
  })

  it('keeps long-window rewrite findings ahead of generic language polish without needing rewrite_required', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      long_window_humanization_risks: ['最近 60 章开场模板反复复现。'],
      dialogue_separability_risks: ['核心角色对白分离度跌到 0.64。'],
      language_risks: ['个别句子还是有些泛。'],
      human_language_repairs: ['把“气氛凝住”换成更具体动作。'],
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(summary.topIssues.findIndex((issue) => issue.source === 'long_window_humanization_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
    expect(summary.topIssues.findIndex((issue) => issue.source === 'dialogue_separability_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'human_language_repairs'))
  })

  it('keeps batch 7 and 8 findings ordered ahead of generic polish in crowded issue sets', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      continuity_risks: ['主角伤势延续断裂。'],
      reader_hook_risks: ['章尾悬念力度不足。'],
      missing_payoffs: ['旧仓伏笔尚未兑现。'],
      typed_ref_risks: ['人物引用仍有 unresolved typed ref。'],
      source_grounding_risks: ['史料来源覆盖仍不足。'],
      operating_mode_risks: ['百万字模式 checkpoint 落后。'],
      dialogue_separability_risks: ['角色对白分离度继续走低。'],
      long_window_humanization_risks: ['长窗模板复现累计过高。'],
      language_risks: ['仍有泛化句式。'],
      human_language_repairs: ['把“心里一沉”换成更具体动作。'],
    }))
    const orderedSources = [...summary.topIssues, ...summary.deferredIssues].map((issue) => issue.source)

    expect(summary.forceMaxCoverage).toBe(true)
    expect(summary.topIssues).toHaveLength(6)
    expect(orderedSources.indexOf('typed_ref_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(orderedSources.indexOf('source_grounding_risks')).toBeLessThan(orderedSources.indexOf('human_language_repairs'))
    expect(orderedSources.indexOf('operating_mode_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(orderedSources.indexOf('dialogue_separability_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(orderedSources.indexOf('long_window_humanization_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
  })

  it('marks highly similar full rewrites for human review', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(1)
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      severity: 'high',
      rewrite_required: true,
    }))
    const verdict = buildRewriteMiniReviewVerdict({
      originalContent: '林远推门进去，看到副手正压着伤口。他没有说话，只先看了一眼灯。',
      rewrittenContent: '林远推门进去，看到副手正压着伤口。他没有说话，只先看了一眼灯。',
      reviewPrioritySummary: summary,
      reviewNotes: createReviewNotes({
        critical_fixes: ['修 1', '修 2', '修 3'],
        severity: 'high',
        rewrite_required: true,
      }),
    })

    expect(verdict.needsHumanReview).toBe(true)
    expect(verdict.similarityToOriginal).toBe(1)
  })

  it('uses the 0.86 full rewrite similarity threshold as an inclusive boundary', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      rewrite_required: true,
    }))
    const reviewNotes = createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      rewrite_required: true,
      severity: 'medium',
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.859)
    const belowThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 A',
      rewrittenContent: '改写 A',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.86)
    const atThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 B',
      rewrittenContent: '改写 B',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(belowThreshold.needsHumanReview).toBe(false)
    expect(belowThreshold.improved).toBe(false)
    expect(atThreshold.needsHumanReview).toBe(true)
    expect(atThreshold.reason).toContain('整章重写后与初稿仍高度相似')
  })

  it('uses the 0.80 high severity threshold as an inclusive boundary', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      continuity_risks: ['连续性需要复核。'],
      severity: 'high',
      rewrite_required: false,
    }))
    const reviewNotes = createReviewNotes({
      continuity_risks: ['连续性需要复核。'],
      severity: 'high',
      rewrite_required: false,
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.799)
    const belowThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 C',
      rewrittenContent: '改写 C',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.8)
    const atThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 D',
      rewrittenContent: '改写 D',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(belowThreshold.needsHumanReview).toBe(false)
    expect(belowThreshold.improved).toBe(true)
    expect(atThreshold.needsHumanReview).toBe(true)
    expect(atThreshold.reason).toContain('高风险章节重写幅度不足')
  })

  it('scores weak serial reading experience when prose lacks action and result anchors', () => {
    const report = analyzeChapterReadingExperience(
      [
        '这一切在某种意义上都显得格外沉重，因为他们终于意识到命运正在以不可言说的方式逼近。',
        '然而与此同时，复杂的情绪在每个人心中不断蔓延，仿佛未来已经被某种看不见的力量笼罩。',
        '他们沉默着，思考着，理解着这一切背后的意义，却没有人真正做出选择。',
        '于是氛围变得更加凝重，故事似乎也在这一刻抵达了新的阶段。',
      ].join('\n\n'),
    )

    expect(report.status).toBe('rewrite')
    expect(report.risks.join('\n')).toMatch(/抽象解释句|模板承接句/u)
  })

  it('fails rewrite delta when structural issues only receive surface-level edits', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.83)
    const reviewNotes = createReviewNotes({
      continuity_risks: ['上一章的伤势在本章消失。'],
      reader_hook_risks: ['章尾没有留下下一步压力。'],
      rewrite_required: true,
    })
    const summary = buildReviewPrioritySummary(reviewNotes)
    const report = analyzeRewriteNarrativeDelta({
      originalContent: [
        '林远走进屋里。他看见灯还亮着。副手说没事。事情就这样过去了。',
        '桌上的伤药没有拆封，窗外的脚步声也没有引起任何人的注意。',
        '他只是点点头，把上一章留下的伤势和追兵都暂时放到一边。',
        '门外那道影子停了很久，最后也没有造成任何新的压力。',
        '这一段仍然没有交代伤势如何影响行动，也没有让追兵逼出新的选择。',
      ].join(''),
      rewrittenContent: [
        '林远走进屋里。他看见灯仍然亮着。副手低声说没事。事情就这样暂时过去了。',
        '桌上的伤药仍旧没有拆封，窗外的脚步声也没有让任何人停下来。',
        '他只是慢慢点头，把上一章留下的伤势和追兵都暂且放到一边。',
        '门外那道影子停留了很久，最后同样没有带来任何新的压力。',
        '这一段依然没有说明伤势如何影响行动，也没有让追兵逼出新的选择。',
      ].join(''),
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(report.status).toBe('fail')
    expect(report.conflictChain.status).not.toBe('pass')
    expect(report.costChain.status).toBe('fail')
    expect(report.goalChain.status).toBe('fail')
    expect(report.findings.join('\n')).toContain('更像语言润色而非剧情修复')
  })

  it('separates conflict, cost, and goal chain scores from generic language edits', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.62)
    const reviewNotes = createReviewNotes({
      critical_fixes: ['本章需要补真实冲突、代价和目标推进。'],
      rewrite_required: true,
    })
    const summary = buildReviewPrioritySummary(reviewNotes)
    const report = analyzeRewriteNarrativeDelta({
      originalContent: [
        '林远走进屋里。他看见灯还亮着。副手说没事。事情就这样过去了。',
        '桌上的伤药没有拆封，窗外的脚步声也没有引起任何人的注意。',
        '他只是点点头，把上一章留下的伤势和追兵都暂时放到一边。',
        '门外那道影子停了很久，最后也没有造成任何新的压力。',
        '这一段仍然没有交代伤势如何影响行动，也没有让追兵逼出新的选择。',
      ].join(''),
      rewrittenContent: [
        '林远推门时撞见追兵已经逼到窗下，副手压着伤口站不稳，只好把药箱先递给他。',
        '他为了确认旧仓线索，选择从后门逃出去，却因此暴露暗号，失去继续藏身的机会。',
        '追兵拦住巷口，林远拒绝交出钥匙，被迫打碎灯盏反制，手臂也被划伤。',
        '这次冲突让他拿到新脚印的位置，也让目标从单纯找药箱改成阻止内应转移证据。',
        '门外忽然传来急促脚步声，他知道下一步必须先救出副手，否则线索会彻底断掉。',
      ].join(''),
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(report.conflictChain.status).toBe('pass')
    expect(report.costChain.status).toBe('pass')
    expect(report.goalChain.status).toBe('pass')
    expect(report.findings.join('\n')).not.toContain('链证据密度仅')
  })

  it('does not require mechanical chain density growth when rewritten draft keeps an already solid plot chain', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.58)
    const reviewNotes = createReviewNotes({
      critical_fixes: ['修正连续性和场景承接，不要求额外加码冲突。'],
      rewrite_required: true,
    })
    const summary = buildReviewPrioritySummary(reviewNotes)
    const original = [
      '林远追到旧仓，被守卫拦住，只好交出假钥匙换来一息空隙。',
      '他为了确认药箱去向，选择暴露暗号，失去继续潜伏的机会。',
      '赵临质问他为何独自行动，两人因此开始重新信任，却也欠下新的代价。',
      '追兵逼近巷口，他决定先救副手，再阻止内应转移证据。',
    ].join('')
    const rewritten = [
      '林远赶到旧仓时，守卫已经拦在门前，他交出假钥匙，只换来短短一息。',
      '为了确认药箱去向，他选择暴露暗号，也失去继续潜伏的机会。',
      '赵临当面质问他为何又独自行动，两人因此开始重新信任，却欠下新的代价。',
      '追兵逼近巷口，他改向先救副手，再阻止内应转移证据。',
    ].join('')

    const report = analyzeRewriteNarrativeDelta({
      originalContent: original,
      rewrittenContent: rewritten,
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(report.conflictChain.status).toBe('pass')
    expect(report.costChain.status).toBe('pass')
    expect(report.goalChain.status).toBe('pass')
    expect(report.findings.join('\n')).not.toContain('更像改词句')
  })

  it('does not reject a materially rewritten low-density industrial scene for missing template tokens', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.62)
    const reviewNotes = createReviewNotes({
      critical_fixes: ['压缩开篇事故并补出章尾下一步压力。'],
      rewrite_required: true,
    })
    const summary = buildReviewPrioritySummary(reviewNotes)
    const original = [
      '周铁生站在平台边。',
      '方大炉检查阀门。',
      '压力表的指针停着。',
      '炉前的灯很亮。',
      '工具箱靠着铁梯。',
      '值班室有人说话。',
      '记录本摊在桌上。',
      '周铁生看了很久。',
      '方大炉拦住了他。',
      '事情随后进入交接。',
    ].join('')
    const rewritten = [
      '周铁生先看见油污遮住了刻度。',
      '他把钳子换到左手。',
      '炉膛的光在观察孔里缩了一下。',
      '铁皮传来细碎的震动。',
      '方大炉没有立刻回头。',
      '周铁生想起师傅教过的顺序。',
      '记录本上的墨迹已经晕开。',
      '值班长在通道尽头喊了一声。',
      '方大炉拦住他，接过了责任。',
      '周铁生把通知单折进了口袋。',
    ].join('')

    const report = analyzeRewriteNarrativeDelta({
      originalContent: original,
      rewrittenContent: rewritten,
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(report.similarityToOriginal).toBeLessThan(0.8)
    expect(report.changedSentenceRate).toBeGreaterThan(70)
    expect(report.status).toBe('pass')
    expect(report.conflictChain.status).not.toBe('fail')
    expect(report.findings.join('\n')).not.toContain('证据密度仅')
  })

  it('blocks mini review when rewrite delta proves plot repair did not land', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.83)
    const reviewNotes = createReviewNotes({
      continuity_risks: ['上一章的伤势在本章消失。'],
      reader_hook_risks: ['章尾没有留下下一步压力。'],
      rewrite_required: true,
    })
    const summary = buildReviewPrioritySummary(reviewNotes)
    const verdict = buildRewriteMiniReviewVerdict({
      originalContent: [
        '林远走进屋里。他看见灯还亮着。副手说没事。事情就这样过去了。',
        '桌上的伤药没有拆封，窗外的脚步声也没有引起任何人的注意。',
        '他只是点点头，把上一章留下的伤势和追兵都暂时放到一边。',
        '门外那道影子停了很久，最后也没有造成任何新的压力。',
        '这一段仍然没有交代伤势如何影响行动，也没有让追兵逼出新的选择。',
      ].join(''),
      rewrittenContent: [
        '林远走进屋里。他看见灯仍然亮着。副手低声说没事。事情就这样暂时过去了。',
        '桌上的伤药仍旧没有拆封，窗外的脚步声也没有让任何人停下来。',
        '他只是慢慢点头，把上一章留下的伤势和追兵都暂且放到一边。',
        '门外那道影子停留了很久，最后同样没有带来任何新的压力。',
        '这一段依然没有说明伤势如何影响行动，也没有让追兵逼出新的选择。',
      ].join(''),
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(verdict.needsHumanReview).toBe(true)
    expect(verdict.narrativeDelta.status).toBe('fail')
    expect(verdict.reason).toContain('重写差异验证失败')
  })
})
