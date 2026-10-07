import { describe, expect, it, vi } from 'vitest'
import type { ChapterContext } from './context.service'
import type { ScenePlanStep } from './chapter-scene-plan'
import { buildNarrativeInputIdentity, resolveNarrativePolicy } from '../../src/shared/narrative-policy'
import { collectQualityGuardrailFindings, hasBlockingGuardrailFindings } from '../../src/shared/content-guardrails'

const state = vi.hoisted(() => ({ custom: '' }))
vi.mock('./prompt-override.service', async () => {
  const original = await vi.importActual<typeof import('./prompt-override.service')>('./prompt-override.service')
  return { ...original, listPromptOverrides: () => [], applyPromptOverride: (key: string, fallback: string, params: Record<string, unknown>, policy?: 'reader-first-v1') => state.custom
    ? `${original.renderPromptOverrideTemplate(state.custom, params)}\n\n${original.buildProtectedFooter(key, params, policy)}` : fallback }
})
import { buildChapterPlannerMessages } from './chapter-pipeline-planner'
import { buildChapterWriterMessages } from './chapter-pipeline-writer'
import { buildChapterCriticMessages } from './chapter-pipeline-review'
import { buildChapterRewriterMessages } from './chapter-pipeline-rewriter'

function fixture(readerFirst: boolean) {
  const scene: ScenePlanStep = { scene_order: 1, scene_title: '晚饭', purpose: '姐弟商量明天送饭', conflict: '', location: '厨房', time_anchor: '晚上', present_characters: ['姐姐', '弟弟'], key_items: [], beat: '把约定说定', must_cover: [], climax_variant: '', exit_hook: '', hidden_agendas: [], irony_gap: '', audience: '' }
  const context = { chapterGoal: '明天送饭的约定', hardConstraintContext: '作者硬合同标记：母亲尚未出院。', characterStates: '母亲在医院。', worldRules: '现实世界，无特殊能力。',
    authorStyleMaterials: { targetWorkSampleGuide: '允许平静停留。', humanStyleSampleLock: '对白保留亲疏。', approvedSample: { text: '她把空碗摞好，最小的留在外面。', source: 'style_fingerprints:8', digest: 'sample' } },
    ...(readerFirst ? { narrativeIdentity: buildNarrativeInputIdentity({ policy: resolveNarrativePolicy('{"readerFirst":{"schemaVersion":1,"policyVersion":"reader-first-v1","revision":1}}', true), styleSource: 'fixture', inputSource: 'fixture', models: 'mock', overrides: [], compilerMode: 'legacy' }) } : {}),
  } as ChapterContext
  return { novelTitle: '原创关系样例', genre: '家庭关系', chapterNum: 2, chapterTitle: '晚饭', emotionTone: '平静', targetWords: 1500,
    storyCore: '姐弟轮流照顾母亲', context, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '姐弟商量明天送饭', scenePlan: [scene],
    runtimeAssertions: [], narrativeFields: { povGuidance: '限知，跟随姐姐。', sensoryGuidance: '', narrativeRatioGuidance: '' },
    guidance: { povRotationGuidance: '', storyPacingGuidance: '', hookContinuityGuidance: '', expressionDedupGuidance: '', summaryHealthGuidance: '', voiceEvolutionGuidance: '' },
    protagonistReference: '姐姐', protagonistRule: '姐姐不知弟弟已经辞职。', promptTier: 'standard' as const }
}

function fourRoles(readerFirst: boolean, chapterNum = 2) {
  const input = { ...fixture(readerFirst), chapterNum }
  return {
    planner: buildChapterPlannerMessages({ ...input, plotPoints: '把明天送饭的约定说定。' })[0].content,
    writer: buildChapterWriterMessages(input)[0].content,
    critic: buildChapterCriticMessages({ ...input, draftContent: '弟弟应了一声，把最小的碗拿走。', arcProgress: '', arcProgressStatus: '', arcProgressCheckpoint: '' })[0].content,
    rewriter: buildChapterRewriterMessages({ ...input, draftContent: '弟弟应了一声，把最小的碗拿走。', prioritizedReviewNotesText: '仅修复已引用的错别字。', structuralRepairDirective: '', lockedParagraphs: ['作者锁定原句。'], attemptNumber: 1, rejectedDigests: [], revisionMode: 'patch', revisionPatchEvidence: [] })[0].content,
  }
}

describe('RF-06 final role messages', () => {
  it.each([true, false])('retains detail and evidence boundaries beyond the opening, reader-first=%s', readerFirst => {
    const messages = fourRoles(readerFirst, 10)
    for (const prompt of Object.values(messages)) {
      expect(prompt.split('【叙事细节与证据承接】')).toHaveLength(2)
      expect(prompt).toContain('不必每笔成为伏笔')
      expect(prompt).toContain('沿用已确立的物品性质、位置朝向、时间顺序和能力边界')
      expect(prompt).toContain('情绪动作不能替代位置确认、同意或事实验证')
      expect(prompt).toContain('保留人物当时能取得并再次核对的原始记录或实物依据')
      expect(prompt).toContain('提前出现相同反应、同时改变其他条件会限制结论')
      expect(prompt).toContain('移动、踩踏、取样等会改变状态时交代范围与后果')
      expect(prompt).not.toContain('陆闻')
    }
    expect(messages.critic).toContain('上下文未提供后文时说明无法核对')
    expect(messages.critic).toContain('不推测冲突或预测 AI 检测分数')
    expect(messages.rewriter).toContain('范围外的问题另报建议，不扩大补丁')
    expect(messages.rewriter).toContain('作者锁定原句')
  })
  it.each([true, false])('custom style cannot erase causal boundaries, reader-first=%s', readerFirst => {
    state.custom = '作者表达要求：保留长句与心理。\n{chapterTitle}'
    try {
      for (const prompt of Object.values(fourRoles(readerFirst, 10))) {
        expect(prompt).toContain('作者表达要求：保留长句与心理。')
        expect(prompt.split('【叙事细节与证据承接】')).toHaveLength(2)
        expect(prompt).toContain('外观深浅本身不能证明异常或书写时间')
        expect(prompt).toContain('不要求每次观察都抄一遍')
      }
    } finally { state.custom = '' }
  })
  it('checks opening delivery in all roles without reinstating universal drama quotas', () => {
    const messages = fourRoles(true)
    for (const prompt of Object.values(messages)) {
      expect(prompt).toContain('【开篇进度与阅读期待】')
      expect(prompt).toContain('同一问题换人再问')
      expect(prompt).toContain('不要求日常题材制造袭击')
      expect(prompt).toContain('作者明确安排与事实边界优先')
      expect(prompt).toContain('操作齐全、事件先后相接不等于故事推进')
    }
    expect(messages.critic).toContain('"opening_hook_risks":[]')
    expect(messages.critic).toContain('"reader_hook_risks":[]')
    expect(messages.critic).toContain('问题须引用当前正文连续原句')
    expect(messages.critic).toContain('不能用题材标签、大纲或世界规则中已知的信息替正文作答')
    expect(messages.rewriter).toContain('局部修订仍只改选定范围')
    const later = buildChapterPlannerMessages({ ...fixture(true), chapterNum: 4, plotPoints: '按原计划相处。' })[0].content
    expect(later).not.toContain('【开篇进度与阅读期待】')
    const first = buildChapterPlannerMessages({ ...fixture(true), chapterNum: 1, plotPoints: '主角入场。' })[0].content
    const third = buildChapterPlannerMessages({ ...fixture(true), chapterNum: 3, plotPoints: '完成阶段行动。' })[0].content
    expect(first).toContain('第一章让读者认识正在做事的主角')
    expect(first).toContain('正文应让读者辨认本书题材、基本生活环境和主角为何能介入眼前的事')
    expect(third).toContain('第三章对已建立的阅读期待给出阶段回报')
    expect(third).toContain('不得擅改揭示章位')
    expect(third).toContain('愿意点开下一章不等于愿意持续追这本书')
  })
  it('removes universal quotas and duplicate material while preserving fact, POV and schema contracts', () => {
    const messages = fourRoles(true)
    for (const prompt of Object.values(messages)) {
      expect(prompt).toContain('作者硬合同标记')
      expect(prompt).toContain('姐姐不知弟弟已经辞职')
      expect(prompt).not.toMatch(/阻塞坏习惯|每章至少|每个场景必须包含|黄金三章|前 300 字|【读者自然度校准】|风格材料估算|style_fingerprints/)
    }
    expect(messages.writer.split('姐弟商量明天送饭')).toHaveLength(2)
    expect(messages.writer.split('她把空碗摞好')).toHaveLength(2)
    expect(messages.writer).toContain('本章目标约 1500 字')
    expect(messages.planner).toContain('scene_order')
    expect(messages.critic).toContain('【证据】正文连续原句')
    expect(messages.rewriter).toContain('作者锁定原句')
    expect(messages.rewriter).not.toContain('只输出小说正文')
    expect(fourRoles(false).writer).toContain('【读者自然度校准】')
  })
  it('permits incidental detail but requires grounds for a decisive new key or power', () => {
    const prompt = fourRoles(true).writer
    expect(prompt).toContain('普通陈设、生活动作和感受可在既有世界与视角内合理创造')
    expect(prompt).toContain('决定脱困的新钥匙、新能力、关键证据')
    expect(prompt).toContain('需要已有依据或先确认计划')
    expect(prompt).not.toContain('缺失项留空，不补造人物动机、经历、物件或关系')
  })
  it('preserves custom literal style instructions and keeps output-process leakage blocking', () => {
    state.custom = 'LITERAL: 每章至少一个代价。\n{chapterTitle}\n$KEEP [原样]'
    try {
      for (const prompt of Object.values(fourRoles(true))) {
        expect(prompt).toContain('LITERAL: 每章至少一个代价。\n晚饭\n$KEEP [原样]')
        expect(prompt).toContain('【开篇进度与阅读期待】')
        expect(prompt).toContain('操作齐全、事件先后相接不等于故事推进')
        expect(prompt).not.toContain('【读者自然度校准】')
      }
    } finally { state.custom = '' }
    expect(hasBlockingGuardrailFindings(collectQualityGuardrailFindings('作为一个AI语言模型，我将为你生成小说正文。', '家庭关系'))).toBe(true)
  })
})
