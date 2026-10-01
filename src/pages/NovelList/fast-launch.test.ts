import { describe, expect, it } from 'vitest'
import { parseProjectBriefSnapshot } from '../../shared/project-brief'
import { parseStorySettingsSnapshot } from '../../shared/story-settings'
import { parseThemeVoiceSnapshot } from '../../shared/theme-voice'
import { buildFastLaunchBootstrapPlan } from './fast-launch'

describe('fast-launch bootstrap plan', () => {
  it('builds a source-backed draft without inventing people or plot events', () => {
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
    expect(plan.chapters[0].targetWords).toBeLessThan(plan.chapters[1].targetWords)
    expect(plan.chapters[1].targetWords).toBeLessThan(plan.chapters[2].targetWords)
    expect(plan.chapterContracts).toHaveLength(3)
    expect(plan.chapterContracts.every((contract) => contract.chapterGoal.length > 0)).toBe(true)
    expect(plan).not.toHaveProperty('protagonist')
    expect(plan.novel.userBackground).toContain('主角起点：被逐出避难所的维修员')
    expect(settings.premise.protagonistStart).toBe('被逐出避难所的维修员')
    expect(plan.novel.synopsis).toBe('他修好的旧终端突然出现主城求救信号')
    expect(plan.chapters[1].outline).toContain('承接第1章实际正文')
    expect(plan.chapters[2].outline).toContain('承接第2章实际正文')
    expect(JSON.stringify(plan)).not.toMatch(/再次被抛下|信息封锁|异常现场|关系裂缝/)
    expect(projectBrief.readerPromise).toBe('他修好的旧终端突然出现主城求救信号')
    expect(settings.premise.coreHook).toContain('主城求救信号')
    expect(settings.storyDesign.coreConflict).toContain('背叛过他的主城')
    expect(settings.storyDesign.endingType).toBeUndefined()
    expect(settings.endgameDesign.endingMode).toBeUndefined()
    expect(themeVoice.writingContractTags).toContain('强剧情')
    expect(themeVoice.forbiddenPhrases).toContain('禁止全知旁白')
    expect(themeVoice.pov).toBe('')
    expect(themeVoice.tense).toBe('')
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
