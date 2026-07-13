import { describe, expect, it } from 'vitest'
import { parseProjectBriefSnapshot } from '../../shared/project-brief'
import { parseStorySettingsSnapshot } from '../../shared/story-settings'
import { parseThemeVoiceSnapshot } from '../../shared/theme-voice'
import { buildFastLaunchBootstrapPlan } from './fast-launch'

describe('fast-launch bootstrap plan', () => {
  it('builds the minimal starter structure for a fast-launch project', () => {
    const plan = buildFastLaunchBootstrapPlan({
      genreLabel: '末世求生',
      protagonistStart: '被逐出避难所的维修员',
      coreHook: '他修好的旧终端突然出现主城求救信号',
      coreConflict: '想救人就必须回到曾经背叛过他的主城',
      tabooRules: '禁止全知旁白；禁止无代价逆转',
      endgameDirection: '主角救下主城，但失去回归旧秩序的资格',
      targetWords: 200000,
      writingContractTags: ['强剧情', '压迫感'],
    })

    const projectBrief = parseProjectBriefSnapshot(plan.novel.projectBriefJson)
    const settings = parseStorySettingsSnapshot(plan.novel.settingsJson)
    const themeVoice = parseThemeVoiceSnapshot(plan.novel.themeVoiceJson)

    expect(plan.chapters).toHaveLength(3)
    expect(plan.timelineEvents).toHaveLength(3)
    expect(plan.characterArcs).toHaveLength(2)
    expect(plan.characterArcs.map((arc) => arc.characterRole)).toEqual(['protagonist', 'antagonist'])
    expect(plan.relationshipArc.relationTypeSnapshot).toBe('对抗')
    expect(plan.resistanceTrack.title).toBe('主要阻力轨道')
    expect(plan.chapterContracts).toHaveLength(3)
    expect(plan.chapterContracts.every((contract) => contract.chapterGoal.length > 0)).toBe(true)
    expect(plan.sceneContracts).toHaveLength(3)
    expect(plan.sceneContracts.every((contract) => contract.obstacle.length > 0 && contract.resultState.length > 0)).toBe(true)
    expect(plan.protagonist.roleType).toBe('protagonist')
    expect(plan.antagonist.roleType).toBe('antagonist')
    expect(projectBrief.readerPromise).toContain('前三章')
    expect(settings.premise.coreHook).toContain('主城求救信号')
    expect(settings.storyDesign.coreConflict).toContain('背叛过他的主城')
    expect(themeVoice.writingContractTags).toContain('强剧情')
    expect(themeVoice.forbiddenPhrases).toContain('禁止全知旁白')
  })

  it('preserves a natural-language idea and editor-approved title/synopsis hints', () => {
    const plan = buildFastLaunchBootstrapPlan({
      genreLabel: '悬疑推理',
      protagonistStart: '县城殡仪馆值夜班的女孩',
      coreHook: '每天凌晨送来的遗体都少一根手指',
      coreConflict: '她必须查清弟弟的尸体为何提前送来',
      tabooRules: '不提前解释真相',
      endgameDirection: '她接受弟弟已经死去，但保住证据',
      sourceIdea: '我想写一个在县城殡仪馆值夜班的女孩，先从一根手指开始查。',
      titleHint: '一根手指',
      synopsisHint: '她在殡仪馆发现异常遗体，随后收到弟弟的死亡通知。',
      targetWords: 150000,
    })

    expect(plan.novel.title).toBe('一根手指')
    expect(plan.novel.synopsis).toContain('弟弟的死亡通知')
    expect(plan.novel.userBackground).toContain('作者原始描述')
    expect(plan.novel.userBackground).toContain('一根手指')
  })
})
