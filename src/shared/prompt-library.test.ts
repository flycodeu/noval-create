import { describe, expect, it } from 'vitest'
import { buildScenePlanPrompt, type ScenePlanPromptInput } from './prompt-library'

function buildInput(overrides: Partial<ScenePlanPromptInput> = {}): ScenePlanPromptInput {
  return {
    novelTitle: '锅炉上的年代',
    genre: '年代文',
    chapterNum: 12,
    chapterTitle: '工册缺页',
    chapterGoal: '把事故责任摊到桌面上',
    plotPoints: '- 查工册\n- 缺页曝光',
    emotionTone: '压抑',
    targetWords: 3000,
    storyCore: '工人视角的年代变迁',
    currentArc: '事故追责弧',
    worldRules: '',
    characterStates: '',
    itemSummary: '',
    previousSummaries: '',
    previousChapterContext: '',
    lastChapterEnding: '',
    continuitySummary: '',
    openLoops: '',
    continuityNotes: '',
    timelineSummary: '',
    timelineOpenThreads: '',
    longTermMemory: '',
    consistencyNotes: '',
    protagonistReference: '沈砚青',
    protagonistRule: '全文用“沈砚青”称呼主角',
    ...overrides,
  }
}

describe('buildScenePlanPrompt 设计层约束', () => {
  it('hidden_agendas / irony_gap 为必填并带空输出负面示例', () => {
    const prompt = buildScenePlanPrompt(buildInput())
    expect(prompt).toContain('hidden_agendas（必填）')
    expect(prompt).toContain('irony_gap（必填）')
    expect(prompt).toContain('空数组视为未完成设计')
  })

  it('被弧级设计校验标记时注入设计对齐矫正段', () => {
    const directive = '本弧原创设计词元：新旌、涡口、义军'
    const prompt = buildScenePlanPrompt(buildInput({ designGateDirective: directive }))
    expect(prompt).toContain('设计对齐矫正（本章被弧级设计校验标记，必须执行）')
    expect(prompt).toContain(directive)
  })

  it('未被标记时不渲染设计对齐矫正段', () => {
    const prompt = buildScenePlanPrompt(buildInput())
    expect(prompt).not.toContain('设计对齐矫正')
  })

  it('hard constraint 已覆盖字段时不再重复注入普通上下文段', () => {
    const prompt = buildScenePlanPrompt(buildInput({
      chapterGoal: '重复目标不应再次出现',
      writingContractSummary: '重复合同不应再次出现',
      relationSummary: '重复关系不应再次出现',
      hardConstraintContext: [
        '章节目标:',
        '- 硬约束目标',
        '写作合同/章节合同:',
        '- 硬约束合同',
        '关键人物关系:',
        '- 硬约束关系',
      ].join('\n'),
    }))

    expect(prompt).not.toContain('【本章目标】')
    expect(prompt).not.toContain('【写作类型】')
    expect(prompt).not.toContain('重复目标不应再次出现')
    expect(prompt).not.toContain('重复合同不应再次出现')
    expect(prompt).not.toContain('重复关系不应再次出现')
    expect(prompt).toContain('【硬约束】')
  })

  it('barrel 文件正常导出 PROMPT_CATALOG 与 PROMPT_CATEGORIES', async () => {
    const { PROMPT_CATALOG, PROMPT_CATEGORIES } = await import('./prompt-library')
    expect(Array.isArray(PROMPT_CATALOG)).toBe(true)
    expect(PROMPT_CATALOG.length).toBeGreaterThanOrEqual(10)
    expect(PROMPT_CATEGORIES).toContain('人物系统')
    expect(PROMPT_CATEGORIES).toContain('正文编写')
  })
})
