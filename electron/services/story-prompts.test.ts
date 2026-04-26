import { describe, expect, it, vi } from 'vitest'

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, prompt: string) => prompt,
}))

import { buildScenePlanPrompt } from './story-prompts'
import { buildChapterRewritePrompt } from './story-prompts'

describe('story-prompts narrative control guidance', () => {
  it('renders POV, sensory, and narrative ratio sections when guidance is provided', () => {
    const prompt = buildScenePlanPrompt({
      novelTitle: '测试小说',
      genre: '悬疑',
      chapterNum: 12,
      chapterTitle: '第十二章',
      chapterGoal: '继续追查',
      hardConstraintContext: '',
      dialogueVoiceLocks: '林远\n- 必保留：短句逼问\n- 必避免：长段解释',
      plotPoints: '林远潜入仓库',
      emotionTone: '紧张',
      targetWords: 3000,
      storyCore: '药箱失踪',
      writingContractSummary: '第三人称限知',
      relationSummary: '林远与赵临互相试探',
      currentArc: '主线推进',
      worldRules: '没有超能力',
      characterStates: '林远受伤但能行动',
      worldStates: '城防收紧',
      itemSummary: '药箱去向不明',
      previousSummaries: '上一章确认线索在北门',
      previousChapterContext: '守卫开始怀疑林远',
      lastChapterEnding: '门外传来脚步声',
      continuitySummary: '必须接上北门线索',
      openLoops: '药箱去哪了',
      dueForeshadows: '仓库里的血迹',
      continuityNotes: '继续追查但不要暴露身份',
      timelineSummary: '深夜',
      timelineOpenThreads: '搜仓风险',
      longTermMemory: '旧仓曾经发生过火灾',
      consistencyNotes: '不要跳场景',
      activeThreads: '药箱 / 内鬼',
      recalledMemory: '上一章提到仓库钥匙',
      povGuidance: '只能写林远当前能感知和推测到的信息。',
      sensoryGuidance: '至少覆盖视觉、听觉、触觉三类感官。',
      narrativeRatioGuidance: '动作 35-55%，对白 15-35%，内心 <=15%。',
      protagonistReference: '林远',
      protagonistRule: '保持主角称呼一致',
      attemptNumber: 2,
      rejectedDigests: ['方案 1：依旧从环境描写慢起。'],
    })

    expect(prompt).toContain('【POV 约束】')
    expect(prompt).toContain('只能写林远当前能感知和推测到的信息。')
    expect(prompt).toContain('【感官雷达】')
    expect(prompt).toContain('【叙事比例】')
    expect(prompt).toContain('【角色 Voice Lock】')
    expect(prompt).toContain('【避免方向】')
    expect(prompt).toContain('【创意方向提示】')
  })

  it('injects retry avoidance guidance into chapter rewrite prompts', () => {
    const prompt = buildChapterRewritePrompt({
      novelTitle: '测试小说',
      genre: '悬疑',
      chapterNum: 12,
      chapterTitle: '第十二章',
      chapterGoal: '继续追查',
      hardConstraintContext: '',
      dialogueVoiceLocks: '',
      emotionTone: '紧张',
      targetWords: 3000,
      storyCore: '药箱失踪',
      writingContractSummary: '第三人称限知',
      relationSummary: '林远与赵临互相试探',
      currentArc: '主线推进',
      worldRules: '没有超能力',
      characterStates: '林远受伤但能行动',
      worldStates: '城防收紧',
      itemSummary: '药箱去向不明',
      previousSummaries: '上一章确认线索在北门',
      previousChapterContext: '守卫开始怀疑林远',
      lastChapterEnding: '门外传来脚步声',
      continuitySummary: '必须接上北门线索',
      openLoops: '药箱去哪了',
      dueForeshadows: '仓库里的血迹',
      continuityNotes: '继续追查但不要暴露身份',
      timelineSummary: '深夜',
      timelineOpenThreads: '搜仓风险',
      longTermMemory: '旧仓曾经发生过火灾',
      consistencyNotes: '先修连续性，再修语言。',
      scenePlan: '场景 1：潜入仓库。',
      draftContent: '林远推门进去。',
      reviewNotes: '关键修订：补上上章伤势的延续。',
      structuralAlertsSummary: '主角太顺。',
      lockedParagraphs: [],
      activeThreads: '药箱 / 内鬼',
      recalledMemory: '上一章提到仓库钥匙',
      protagonistReference: '林远',
      protagonistRule: '保持主角称呼一致',
      attemptNumber: 2,
      rejectedDigests: ['方案 1：只是替换近义词，整体结构没有变化。'],
    })

    expect(prompt).toContain('【避免方向】')
    expect(prompt).toContain('方案 1：只是替换近义词')
    expect(prompt).toContain('【创意方向提示】')
  })
})
