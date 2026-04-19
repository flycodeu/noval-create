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
    expect(plan.protagonist.roleType).toBe('protagonist')
    expect(plan.antagonist.roleType).toBe('antagonist')
    expect(projectBrief.readerPromise).toContain('前三章')
    expect(settings.premise.coreHook).toContain('主城求救信号')
    expect(settings.storyDesign.coreConflict).toContain('背叛过他的主城')
    expect(themeVoice.writingContractTags).toContain('强剧情')
    expect(themeVoice.forbiddenPhrases).toContain('禁止全知旁白')
  })
})
