import { describe, expect, it } from 'vitest'
import type { ChapterStoryDynamics } from '../../src/types'
import {
  buildStoryPacingAlerts,
  buildTimelineStoryHints,
  computeCostPersistence,
  computeProtagonistSetbackSummary,
  computeReversalDistribution,
  enhanceStoryDynamics,
  hasTimelineHint,
  parseStoryDynamics,
  toRewardLevel,
  toSetbackLevel,
  type StoryDynamicsChapterRecord,
} from './quality-dashboard-story-dynamics'

function createDynamics(overrides: Partial<ChapterStoryDynamics> = {}): ChapterStoryDynamics {
  return {
    protagonistSetback: 'none',
    setbackSummary: '',
    costPresent: false,
    costSummary: '',
    reversalMarker: false,
    reversalSummary: '',
    rewardState: 'none',
    protagonistPressure: 0,
    ...overrides,
  }
}

function createChapter(
  chapterNum: number,
  overrides: Partial<ChapterStoryDynamics> = {},
): StoryDynamicsChapterRecord {
  return {
    chapterId: chapterNum,
    chapterNum,
    title: `第${chapterNum}章`,
    dynamics: createDynamics(overrides),
  }
}

describe('quality dashboard story dynamics', () => {
  it('parses explicit review fields while containing invalid values', () => {
    const parsed = parseStoryDynamics(JSON.stringify({
      protagonist_setback: 'major',
      setback_summary: '  丢失补给线  ',
      cost_present: 'yes',
      cost_summary: '  伤势加重  ',
      cost_resolution_state: 'ongoing',
      reversal_marker: 1,
      reversal_summary: '  内应暴露  ',
      reversal_support_state: 'forced',
      pace_marker: 'climax',
      reward_state: 'partial',
      protagonist_pressure: 77.6,
    }))

    expect(parsed).toEqual({
      explicit: true,
      dynamics: {
        protagonistSetback: 'major',
        setbackSummary: '丢失补给线',
        costPresent: true,
        costSummary: '伤势加重',
        costResolutionState: 'ongoing',
        reversalMarker: true,
        reversalSummary: '内应暴露',
        reversalSupportState: 'forced',
        paceMarker: 'climax',
        rewardState: 'partial',
        protagonistPressure: 78,
      },
    })
    expect(parseStoryDynamics('{bad json')).toEqual({
      explicit: false,
      dynamics: createDynamics(),
    })
    expect(parseStoryDynamics('{"cost_present":false,"cost_resolution_state":"resolved","reversal_marker":false,"reversal_support_state":"forced"}').dynamics)
      .toMatchObject({
        costResolutionState: undefined,
        reversalSupportState: undefined,
      })
  })

  it('merges timeline signals across real chapter ranges without expanding sparse chapter numbers', () => {
    const hints = buildTimelineStoryHints([
      {
        eventType: '冲突',
        eventTitle: '围攻升级',
        eventSummary: '进入决战高潮',
        eventResult: null,
        chapterStartId: 10,
        chapterEndId: 30,
        protagonistPresent: 1,
        protagonistAction: null,
      },
      {
        eventType: null,
        eventTitle: '伏笔回收',
        eventSummary: null,
        eventResult: '主角获得回报',
        chapterStartId: 20,
        chapterEndId: 20,
        protagonistPresent: 0,
        protagonistAction: null,
      },
    ], new Map([
      [10, 1],
      [20, 500_000],
      [30, 1_000_000],
    ]))

    expect([...hints.keys()]).toEqual([1, 500_000, 1_000_000])
    expect(hints.get(500_000)).toMatchObject({
      hasConflict: true,
      hasClimax: true,
      hasPayoff: true,
      protagonistPresent: true,
    })
    expect(hasTimelineHint(hints.get(1))).toBe(true)
    expect(hasTimelineHint()).toBe(false)
  })

  it('enhances missing dynamics while preserving explicit review choices', () => {
    const hint = {
      hasConflict: true,
      hasReversal: true,
      hasClimax: true,
      hasPayoff: true,
      hasBreather: true,
      protagonistPresent: true,
    }
    expect(enhanceStoryDynamics(createDynamics(), hint)).toMatchObject({
      protagonistSetback: 'major',
      setbackSummary: '时间轴显示主角在本章承受了明显冲突压力。',
      reversalMarker: true,
      reversalSummary: '时间轴标记存在反转事件。',
      paceMarker: 'climax',
      rewardState: 'partial',
      protagonistPressure: 85,
    })
    expect(enhanceStoryDynamics(createDynamics({
      protagonistSetback: 'minor',
      setbackSummary: '已有受挫',
      reversalMarker: true,
      reversalSummary: '已有反转',
      paceMarker: 'setup',
      rewardState: 'major',
      protagonistPressure: 42,
    }), hint)).toMatchObject({
      protagonistSetback: 'minor',
      setbackSummary: '已有受挫',
      reversalSummary: '已有反转',
      paceMarker: 'setup',
      rewardState: 'major',
      protagonistPressure: 42,
    })
  })

  it('computes contiguous setback runs in chapter order even when input is unsorted', () => {
    const chapters = [
      createChapter(8, { protagonistSetback: 'major', protagonistPressure: 90 }),
      createChapter(2, { rewardState: 'partial' }),
      createChapter(7, { protagonistSetback: 'minor', protagonistPressure: 60 }),
      createChapter(1, { rewardState: 'major' }),
      createChapter(4, { rewardState: 'partial' }),
      createChapter(6, { protagonistSetback: 'minor', protagonistPressure: 70 }),
      createChapter(3, { rewardState: 'partial' }),
      createChapter(5, { protagonistSetback: 'minor', protagonistPressure: 65 }),
    ]

    expect(computeProtagonistSetbackSummary(chapters)).toEqual({
      chapterCount: 8,
      protagonistSetbackRate: 50,
      majorSetbackRate: 12.5,
      averagePressure: 35.6,
      longestSmoothRun: 4,
      longestPressureRun: 4,
    })
    expect(toSetbackLevel('major')).toBe(2)
    expect(toSetbackLevel('minor')).toBe(1)
    expect(toRewardLevel('major')).toBe(2)
    expect(toRewardLevel('partial')).toBe(1)
  })

  it('tracks resolved, evaporated, and ongoing costs across the full chapter span', () => {
    const summary = computeCostPersistence([
      createChapter(10),
      createChapter(5, {
        costPresent: true,
        costResolutionState: 'new',
        costSummary: '失去盟友',
      }),
      createChapter(2, {
        costPresent: true,
        costResolutionState: 'ongoing',
        costSummary: '伤势延续',
      }),
      createChapter(6, {
        costPresent: true,
        costResolutionState: 'resolved',
        costSummary: '关系修复',
      }),
      createChapter(1, {
        costPresent: true,
        costResolutionState: 'new',
        costSummary: '腿伤',
      }),
      createChapter(4, {
        costPresent: true,
        costResolutionState: 'resolved',
        costSummary: '伤势稳定',
      }),
      createChapter(8, {
        costPresent: true,
        costResolutionState: 'new',
        costSummary: '补给中断',
      }),
    ])

    expect(summary.averageCostDuration).toBe(3)
    expect(summary.evaporatedCostCount).toBe(1)
    expect(summary.unresolvedCostCount).toBe(1)
    expect(summary.activeCosts).toEqual([{
      startChapterNum: 8,
      duration: 3,
      status: 'ongoing',
      summary: '补给中断',
    }])
    expect(summary.allEntries).toEqual([
      {
        startChapterNum: 1,
        endChapterNum: 4,
        duration: 4,
        status: 'resolved',
        summary: '腿伤',
      },
      {
        startChapterNum: 5,
        endChapterNum: 6,
        duration: 2,
        status: 'evaporated',
        summary: '失去盟友',
      },
      {
        startChapterNum: 8,
        duration: 3,
        status: 'ongoing',
        summary: '补给中断',
      },
    ])
  })

  it('summarizes reversal distribution and emits bounded recent pacing alerts', () => {
    const chapters = Array.from({ length: 25 }, (_, index) => createChapter(index + 1, {
      rewardState: 'partial',
    }))
    chapters[9] = createChapter(10, {
      reversalMarker: true,
      reversalSupportState: 'forced',
      paceMarker: 'climax',
      rewardState: 'none',
    })
    chapters[11] = createChapter(12, {
      paceMarker: 'climax',
      rewardState: 'none',
    })
    chapters[12] = createChapter(13, {
      paceMarker: 'breather',
      rewardState: 'partial',
    })
    chapters[13] = createChapter(14, {
      paceMarker: 'payoff',
      rewardState: 'major',
    })

    expect(computeReversalDistribution([...chapters].reverse())).toMatchObject({
      reversalChapterNums: [10],
      climaxChapterNums: [10, 12],
      breatherChapterNums: [13],
      payoffChapterNums: [14],
      forcedReversalCount: 1,
      weakReversalCount: 0,
      climaxSpacing: [2],
      paceMarkerCounts: {
        setup: 0,
        conflict: 0,
        reversal: 0,
        climax: 2,
        payoff: 1,
        breather: 1,
      },
    })

    const alerts = buildStoryPacingAlerts([...chapters].reverse())
    expect(alerts.map((alert) => alert.code)).toEqual([
      'climax_gap_too_long',
      'too_smooth',
      'climax_overcrowded',
      'forced_reversal',
      'too_smooth',
    ])
    expect(alerts.filter((alert) => alert.code === 'too_smooth').map((alert) => alert.chapterNums)).toEqual([
      Array.from({ length: 13 }, (_, index) => index + 13),
      [6, 7, 8, 9],
    ])
    expect(alerts.flatMap((alert) => alert.chapterNums).every((chapterNum) => chapterNum >= 6)).toBe(true)
    expect(alerts.find((alert) => alert.code === 'climax_gap_too_long')?.chapterNums).toEqual([12, 25])
  })

  it('sorts blocker alerts before warnings and reports recent cost evaporation', () => {
    const chapters = [
      createChapter(1, { costPresent: true, costResolutionState: 'new', costSummary: '断粮' }),
      createChapter(2, { costPresent: true, costResolutionState: 'resolved', costSummary: '补给恢复' }),
      createChapter(3, { protagonistSetback: 'minor', protagonistPressure: 70 }),
      createChapter(4, { protagonistSetback: 'minor', protagonistPressure: 70 }),
      createChapter(5, { protagonistSetback: 'minor', protagonistPressure: 70 }),
      createChapter(6, { protagonistSetback: 'major', protagonistPressure: 90 }),
    ]

    const alerts = buildStoryPacingAlerts(chapters)
    expect(alerts[0]).toMatchObject({
      code: 'long_oppression_without_reward',
      severity: 'blocker',
      chapterNums: [3, 4, 5, 6],
    })
    expect(alerts.find((alert) => alert.code === 'cost_evaporation')?.chapterNums).toEqual([1, 2])
  })
})
