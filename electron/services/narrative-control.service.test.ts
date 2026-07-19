import { describe, expect, it } from 'vitest'

import { analyzeNarrativeControls } from './narrative-control.service'

describe('analyzeNarrativeControls', () => {
  it('flags fixed-POV mind reading as a rewrite-level boundary failure', () => {
    const result = analyzeNarrativeControls({
      themeVoice: {
        writingContractTags: [],
        theme: '',
        themeChapterTest: '',
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
        targetWorkSampleGuide: '',
        humanStyleSampleLock: '',
      },
      sceneSnapshots: [{ segmentId: 1, segmentOrder: 1, segmentTitle: '场景一', pov: '林远' }],
      characterNames: ['林远', '赵临', '守卫'],
      content: '林远贴着墙根往前挪。赵临心里已经认定他在撒谎。守卫心中甚至开始盘算要不要先下手。',
      chapterGoal: '继续追查',
      emotionTone: '紧张',
    })

    expect(result.pov.status).toBe('rewrite')
    expect(result.pov.directMindReadingHits.length).toBeGreaterThan(0)
    expect(result.pov.fixHint).toContain('动作')
  })

  it('allows fixed-POV protagonist interior knowledge while checking named others', () => {
    const result = analyzeNarrativeControls({
      themeVoice: {
        writingContractTags: [],
        theme: '',
        themeChapterTest: '',
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
        targetWorkSampleGuide: '',
        humanStyleSampleLock: '',
      },
      sceneSnapshots: [{ segmentId: 1, segmentOrder: 1, segmentTitle: '场景一', pov: '周铁生' }],
      characterNames: ['周铁生', '秦满仓'],
      content: '周铁生把号牌翻过去。他不知道自己为什么惦记那块黑印，只觉得明天的工册股报到躲不过去。秦满仓心里已经认定他在装傻。',
      chapterGoal: '承担事故后果',
      emotionTone: '压抑',
    })

    expect(result.pov.directMindReadingHits).toHaveLength(1)
    expect(result.pov.directMindReadingHits[0]).toContain('秦满仓心里')
    expect(result.pov.status).toBe('warning')
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

  it('does not treat concrete labor and diagnosis beats as exposition dumps', () => {
    const result = analyzeNarrativeControls({
      themeVoice: {
        writingContractTags: ['历史正剧', '单元志怪治妖'],
        theme: '',
        themeChapterTest: '',
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
        targetWorkSampleGuide: '',
        humanStyleSampleLock: '',
      },
      content: [
        '风压表指针越过红线，铁水旺攥住进风闸门手轮，肩胛骨一沉，把铸铁轮缘猛地扳过半圈。',
        '炉膛里焦炭呼噜噜塌下去，火焰从亮白闷成暗红，翟广禄冲回操作台，一把把他搡开。',
        '值长把调令通知单压在木桌上，铅笔尖在事故记录本里戳出一个小坑。',
        '他解下学徒铜牌递过去，铜牌边角还沾着炉前的汗。',
        '水下哭声贴着船底往上顶，女妖医取出银封妖骨针，沉到鳃裂边上，把针尖刺进闭合肌。',
        '鳃裂一合一张，水压撞在她胸口，萤石只照出五尺外的浑水。',
        '老周扶着船桨要跪，她侧身让开，只把剩下的酒倒进水里，让船继续往前走。',
      ].join('\n'),
      chapterGoal: '以具体劳动和诊疗动作推进代价',
      chapterFunction: 'payoff',
    })

    expect(result.narrativeRatio.status).not.toBe('rewrite')
    expect(result.narrativeRatio.ratios.exposition).toBeLessThan(35)
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

  it('flags transition chapters whose paragraph density never releases', () => {
    const result = analyzeNarrativeControls({
      chapterFunction: 'breather',
      emotionTone: '过渡',
      content: [
        '林远沿着空走廊一间一间确认门锁、窗缝、脚印、拖痕和潮气变化，把每个细节都压进脑子里，连墙角掉漆的形状、灯罩积灰的方向和门轴发涩的声响都不肯放过。',
        '他又把账本、钥匙、守卫轮值、昨夜动线、仓库清点顺序和每个人说谎时的停顿重新串了一遍，试图从每一个不对劲的细节里抠出下一个危险会从哪里冒头。',
        '他接着把仓库周围的照明盲区、岗哨轮换、备用通道和楼梯回音重新记了一轮，连哪块地板会先发响、哪扇窗会漏风都逐项压回原位，没有给自己留下半点喘息。',
        '最后他仍旧站在原地继续推演每一种最坏结果，反复核对名单、钥匙、脚印和撤离路线，整段过渡只剩下信息堆叠，没有任何短动作或情绪释压。',
      ].join('\n'),
    })

    expect(result.transitionDensity.status).not.toBe('pass')
    expect(result.transitionDensity.fixHint).toContain('释压')
  })

  it('detects emotion-focus drift and monochrome chapters', () => {
    const result = analyzeNarrativeControls({
      emotionFocus: '克制悲伤',
      content: '他咬牙顶了回去，火气直冲喉咙。她拍开门板，怒意压不住。两个人一句比一句硬，谁都不肯退。桌角被他一掌拍得发响，憋火越烧越狠。那股恼意一路顶到眼底，谁开口都像在点火。',
    })

    expect(result.emotionFocus.status).toBe('warning')
    expect(result.emotionFocus.summary).toContain('克制悲伤')
  })

  it('flags consecutive worldbuilding exposition dumps', () => {
    const result = analyzeNarrativeControls({
      expositionMode: '动作带出',
      content: [
        '学院的位阶制度分为外院、内院和真传。',
        '帝国法令规定所有术式都必须登记来源与许可。',
        '灵脉体系由九段构成，每一段对应不同的资源配额。',
        '教会与军府分别负责审查和执行这套规则。',
      ].join(''),
    })

    expect(result.exposition.status).toBe('rewrite')
    expect(result.exposition.summary).toContain('说明')
  })
})
