import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORKFLOW_STATS,
  GUIDED_STEP_ORDER,
  getAssetBloatSignal,
  getNextChapterReadiness,
  getRecommendedGuidedWorkflowStep,
  getRecommendedWorkflowStep,
  getWorkflowBlockers,
  isWritingStepReady,
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

  it('allows writing without character arcs, relationship arcs, resistance, volumes, threads, or a timeline', () => {
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

    expect(missingCharacterNetwork.ready).toBe(true)
    expect(missingCharacterNetwork.label).toBe('可写第一章')

    const missingResistance = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 2,
      hasProtagonist: true,
      characterArcCount: 1,
      relationshipArcCount: 0,
      outlineCount: 0,
      timelineCount: 0,
      threadCount: 0,
      volumeCount: 0,
      resistanceTrackCount: 0,
    })

    expect(missingResistance.ready).toBe(true)
    expect(isWritingStepReady({
      ...EMPTY_WORKFLOW_STATS,
      chapterCount: 1,
      characterCount: 2,
      hasProtagonist: true,
    })).toBe(true)
  })

  it('stays unready while context, assets, or long-term memory are stale', () => {
    expect(getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      staleChapterCount: 1,
    })).toMatchObject({ ready: false, label: '待同步' })
    expect(getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      staleAssetCount: 1,
    }).ready).toBe(false)
    expect(getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      staleCheckpointCount: 1,
    }).ready).toBe(false)
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

  it('recommends characters before the endgame and the map', () => {
    expect(GUIDED_STEP_ORDER.indexOf('character-roster')).toBe(GUIDED_STEP_ORDER.indexOf('theme-voice') + 1)
    expect(GUIDED_STEP_ORDER.indexOf('character-roster')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('world-foundation'))
    expect(GUIDED_STEP_ORDER.indexOf('character-roster')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('endgame-design'))
    expect(GUIDED_STEP_ORDER.indexOf('character-roster')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('map-structure'))
    expect(GUIDED_STEP_ORDER.indexOf('story-plot')).toBeGreaterThan(GUIDED_STEP_ORDER.indexOf('character-roster'))
    expect(GUIDED_STEP_ORDER.indexOf('story-plot')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('map-structure'))
    expect(GUIDED_STEP_ORDER.indexOf('story-plot')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('items-equipment'))
    expect(GUIDED_STEP_ORDER.indexOf('outline-structure')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('map-structure'))
    expect(GUIDED_STEP_ORDER.indexOf('outline-structure')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('items-equipment'))
    expect(GUIDED_STEP_ORDER.indexOf('outline-structure')).toBeLessThan(GUIDED_STEP_ORDER.indexOf('resistance-system'))
    expect(getRecommendedGuidedWorkflowStep(baseNovel, EMPTY_WORKFLOW_STATS)).toBe('character-roster')
    expect(getRecommendedWorkflowStep(baseNovel, EMPTY_WORKFLOW_STATS)).toBe('characters')
  })

  it('does not let an unfinished endgame block characters, plot, or outline', () => {
    const castStats = {
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 2,
      hasProtagonist: true,
      characterArcCount: 1,
      relationshipArcCount: 1,
    }

    expect(getRecommendedGuidedWorkflowStep(baseNovel, castStats)).toBe('story-plot')
    expect(getRecommendedWorkflowStep(baseNovel, castStats)).toBe('story-design')

    const plotReadyNovel = {
      ...baseNovel,
      settingsJson: JSON.stringify({
        ...JSON.parse(baseNovel.settingsJson),
        story_goal: '查清旧案',
        core_conflict: '真相与秩序冲突',
        main_plot: '从错档案追到旧案核心',
        ending: '公开真相并承担代价',
      }),
    }

    expect(getRecommendedGuidedWorkflowStep(plotReadyNovel, castStats)).toBe('outline-structure')
    expect(getRecommendedWorkflowStep(plotReadyNovel, castStats)).toBe('outline')
  })

  it('does not gate characters on the endgame, map, or items', () => {
    const blockers = getWorkflowBlockers('characters', baseNovel, EMPTY_WORKFLOW_STATS)

    expect(blockers.some((item) => item.includes('终局'))).toBe(false)
    expect(blockers.some((item) => item.includes('地图'))).toBe(false)
    expect(blockers.some((item) => item.includes('物品'))).toBe(false)
  })

  it('does not gate map, outline, or timeline on an unfinished endgame', () => {
    const mapBlockers = getWorkflowBlockers('map', baseNovel, EMPTY_WORKFLOW_STATS)
    const outlineBlockers = getWorkflowBlockers('outline', baseNovel, EMPTY_WORKFLOW_STATS)
    const timelineBlockers = getWorkflowBlockers('timeline', baseNovel, EMPTY_WORKFLOW_STATS)

    expect(mapBlockers.some((item) => item.includes('终局'))).toBe(false)
    expect(outlineBlockers.some((item) => item.includes('终局'))).toBe(false)
    expect(timelineBlockers.some((item) => item.includes('终局'))).toBe(false)
  })

  it('does not gate writing on a missing timeline', () => {
    const blockers = getWorkflowBlockers('writing', baseNovel, {
      ...EMPTY_WORKFLOW_STATS,
      outlineCount: 0,
      timelineCount: 0,
      revisionBlockerCount: 2,
      staleChapterCount: 1,
      staleAssetCount: 1,
      staleAssetLabels: ['旧地图'],
      staleCheckpointCount: 1,
    })

    expect(blockers.some((item) => item.includes('时间轴'))).toBe(false)
    expect(blockers.some((item) => item.includes('终局'))).toBe(false)
    expect(blockers.some((item) => item.includes('修订'))).toBe(true)
    expect(blockers.some((item) => item.includes('旧上下文'))).toBe(true)
    expect(blockers.some((item) => item.includes('旧设定'))).toBe(true)
    expect(blockers.some((item) => item.includes('长期记忆'))).toBe(true)
  })
})
