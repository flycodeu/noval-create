import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORKFLOW_STATS,
  GUIDED_STEP_ORDER,
  getAssetBloatSignal,
  getNextChapterReadiness,
  getRecommendedGuidedWorkflowStep,
  getRecommendedWorkflowStep,
  getWorkflowBlockers,
} from './workflow'

describe('workflow asset bloat signal', () => {
  it('stays quiet when assets are still within the starter range', () => {
    const signal = getAssetBloatSignal({
      ...EMPTY_WORKFLOW_STATS,
      mapCount: 2,
      characterCount: 3,
      itemCount: 2,
      threadCount: 1,
      volumeCount: 1,
    })

    expect(signal.risk).toBe('none')
  })

  it('warns when pre-writing assets pile up without enough structure coverage', () => {
    const signal = getAssetBloatSignal({
      ...EMPTY_WORKFLOW_STATS,
      mapCount: 6,
      factionCount: 4,
      characterCount: 8,
      characterArcCount: 3,
      relationshipArcCount: 2,
      itemCount: 5,
      glossaryCount: 2,
      sceneTemplateCount: 1,
    })

    expect(signal.risk).toBe('high')
    expect(signal.reason).toContain('首章前已经堆积')
  })
})

describe('workflow next chapter readiness', () => {
  it('blocks writing when high priority revision blockers still exist', () => {
    const readiness = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
      revisionBlockerCount: 2,
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.label).toBe('先清阻塞项')
  })

  it('marks the project as ready for the first chapter once structure anchors exist', () => {
    const readiness = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 3,
      hasProtagonist: true,
      characterArcCount: 1,
      relationshipArcCount: 1,
      resistanceTrackCount: 2,
      volumeCount: 1,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.label).toBe('可写第一章')
  })

  it('blocks writing before the character network and resistance line are usable', () => {
    const missingCharacterNetwork = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 2,
      hasProtagonist: true,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
      volumeCount: 1,
      resistanceTrackCount: 1,
    })

    expect(missingCharacterNetwork.ready).toBe(false)
    expect(missingCharacterNetwork.label).toBe('缺人物网')

    const missingResistance = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 2,
      hasProtagonist: true,
      characterArcCount: 1,
      relationshipArcCount: 1,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
      volumeCount: 1,
    })

    expect(missingResistance.ready).toBe(false)
    expect(missingResistance.label).toBe('缺阻力线')
  })
})

describe('workflow ordering', () => {
  const baseNovel = {
    title: '测试项目',
    synopsis: '测试简介',
    userBackground: '测试背景',
    expandedBackground: '测试扩展背景',
    projectBriefJson: JSON.stringify({
      platform_mode: 'serial',
      target_audience: '长篇读者',
      target_reader: '喜欢悬疑推进的读者',
      reader_promise: '每卷都有可验证的线索回收',
      selling_points: '具体线索与人物选择',
      comp_titles: '测试参照',
    }),
    settingsJson: JSON.stringify({
      premise: {
        positioning: '悬疑长篇',
        core_hook: '一份错档案指向主角本人',
        protagonist_start: '谨慎而克制',
        constraints: '线索必须可验证',
      },
      storyGoal: '查清旧案',
      coreConflict: '真相与秩序冲突',
      mainPlot: '从错档案追到旧案核心',
      ending: '公开真相并承担代价',
      endgame_design: {},
    }),
    themeVoiceJson: JSON.stringify({
      theme: '真实与选择',
      emotionalCore: '克制的信任',
      pov: '第三人称有限',
      tense: '现在时',
      styleRules: '具体克制',
      dialogueRules: '保留信息差',
      writingContractTags: ['具象线索'],
    }),
    worldRulesJson: '{}',
  }

  it('recommends the endgame before map assets', () => {
    expect(GUIDED_STEP_ORDER.indexOf('endgame-design')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('map-structure'))
    expect(getRecommendedGuidedWorkflowStep(baseNovel, EMPTY_WORKFLOW_STATS)).toBe('endgame-design')
    expect(getRecommendedWorkflowStep(baseNovel, EMPTY_WORKFLOW_STATS)).toBe('endgame')
  })

  it('moves to the map only after the endgame is ready', () => {
    const readyNovel = {
      ...baseNovel,
      settingsJson: JSON.stringify({
        ...JSON.parse(baseNovel.settingsJson),
        endgame_design: {
          ending_mode: 'costly_victory',
          final_conflict: '主角必须承担公开真相的代价',
          theme_answer: '真实需要承担后果',
          must_deliver_promises: '旧案与主角缺口全部回收',
          last_scene: '主角把档案放回公开目录',
        },
      }),
    }

    expect(getRecommendedGuidedWorkflowStep(readyNovel, EMPTY_WORKFLOW_STATS)).toBe('map-structure')
    expect(getRecommendedWorkflowStep(readyNovel, EMPTY_WORKFLOW_STATS)).toBe('map')
  })

  it('guards direct asset buttons against skipping the endgame gate', () => {
    const blockers = getWorkflowBlockers('map', baseNovel, {
      ...EMPTY_WORKFLOW_STATS,
      mapCount: 0,
    })

    expect(blockers).toContain('请先锁定终局承诺，再生成地图。')
  })
})
