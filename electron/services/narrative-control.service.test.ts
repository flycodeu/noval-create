import { describe, expect, it } from 'vitest'

import { analyzeNarrativeControls } from './narrative-control.service'

describe('analyzeNarrativeControls', () => {
  it('flags fixed-POV mind reading as a rewrite-level boundary failure', () => {
    const result = analyzeNarrativeControls({
      themeVoice: {
        writingContractTags: [],
        theme: '',
        motifs: '',
        emotionalCore: '',
        pov: 'third_limited',
        tense: 'past',
        protagonistCount: 'single',
        viewpointMode: 'fixed',
        parallelTimelines: 'none',
        openingStyle: 'hook',
        flashbackPolicy: 'limited',
        narratorDistance: '',
        voiceKeywords: '',
        styleRules: '',
        dialogueRules: '',
        descriptionRules: '',
        forbiddenPhrases: '',
      },
      sceneSnapshots: [{ segmentId: 1, segmentOrder: 1, segmentTitle: '场景一', pov: '林远' }],
      content: '林远贴着墙根往前挪。赵临心里已经认定他在撒谎。守卫心中甚至开始盘算要不要先下手。',
      chapterGoal: '继续追查',
      emotionTone: '紧张',
    })

    expect(result.pov.status).toBe('rewrite')
    expect(result.pov.directMindReadingHits.length).toBeGreaterThan(0)
    expect(result.pov.fixHint).toContain('动作')
  })

  it('flags all-dialogue chapters as a rewrite-level narrative ratio failure', () => {
    const result = analyzeNarrativeControls({
      content: '“你来了？”“我来了。”“现在怎么办？”“先等。”\n“别说话。”“那你倒是给个主意。”“没有主意。”“那就继续等。”',
      chapterGoal: '众人对峙并拖延时间',
      emotionTone: '高潮',
      chapterFunction: 'climax',
    })

    expect(result.narrativeRatio.status).toBe('rewrite')
    expect(result.narrativeRatio.ratios.dialogue).toBeGreaterThanOrEqual(75)
    expect(result.narrativeRatio.deviationReasons.some((item) => item.includes('对白占比'))).toBe(true)
  })

  it('tracks sensory coverage gaps and missing senses', () => {
    const result = analyzeNarrativeControls({
      content: '他看见仓库门半掩着，手掌贴上去时一阵发凉。脚步声从走廊尽头逼近，空气里却没有半点药味。',
      chapterGoal: '潜入仓库',
      emotionTone: '悬念',
    })

    expect(result.sensory.coverageCount).toBeGreaterThanOrEqual(3)
    expect(result.sensory.missingSenses).toContain('gustatory')
    expect(result.sensory.summary).toContain('覆盖')
  })
})
