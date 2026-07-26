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
})
