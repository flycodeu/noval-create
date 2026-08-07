import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_ZERO_STATE_ACTIONS,
  resolveOverviewDisplayState,
  resolveOverviewProductionReadiness,
} from './overview-presentation'

describe('overview-presentation', () => {
  it('treats 0 chapters and 0 words as zero state and suppresses noisy panels', () => {
    const state = resolveOverviewDisplayState(
      { chapterCount: 0, totalWords: 0 },
      { blockers: [], impactNotices: [] },
    )

    expect(state.isZeroState).toBe(true)
    expect(state.showProgressPanel).toBe(false)
    expect(state.showHealthPanel).toBe(false)
    expect(state.showBlockersPanel).toBe(false)
    expect(state.showRevisionMetric).toBe(false)
  })

  it('still shows blockers in zero state when a high severity blocker exists', () => {
    const state = resolveOverviewDisplayState(
      { chapterCount: 0, totalWords: 0 },
      {
        blockers: [
          {
            id: 'blocked',
            severity: 'high',
            title: '高优先问题',
            reason: '仍有关键阻塞未处理。',
            entryPage: 'revision',
            actionLabel: '打开修订中心',
          },
        ],
        impactNotices: [],
      },
    )

    expect(state.isZeroState).toBe(true)
    expect(state.showBlockersPanel).toBe(true)
  })

  it('shows progress, health, blockers, and impacts after writing has started', () => {
    const state = resolveOverviewDisplayState(
      { chapterCount: 4, totalWords: 12000 },
      {
        blockers: [
          {
            id: 'warn',
            severity: 'medium',
            title: '待处理问题',
            reason: '存在中优先问题。',
            entryPage: 'quality',
            actionLabel: '打开质量监控',
          },
        ],
        impactNotices: [
          {
            id: 'impact',
            title: '设定变更影响章节',
            reason: '已有章节需要同步。',
            affectedKinds: ['章节'],
            entryPage: 'revision',
          },
        ],
      },
    )

    expect(state.isZeroState).toBe(false)
    expect(state.showProgressPanel).toBe(true)
    expect(state.showHealthPanel).toBe(true)
    expect(state.showBlockersPanel).toBe(true)
    expect(state.showImpactPanel).toBe(true)
    expect(state.showRevisionMetric).toBe(true)
  })

  it('keeps the zero-state quick-start path fixed at five actions', () => {
    expect(OVERVIEW_ZERO_STATE_ACTIONS.map((item) => item.entryPage)).toEqual([
      'volume-design',
      'outline',
      'characters',
      'contracts',
      'writing',
    ])
  })

  it('does not claim production is ready while chapters or assets still use stale context', () => {
    const state = resolveOverviewProductionReadiness(
      { readyRate: 100, summary: '当前产线可继续推进，综合就绪度 100%。' },
      { staleChapterCount: 3, staleAssetCount: 3, staleCheckpointCount: 0 },
    )

    expect(state).toEqual({
      readyRate: 34,
      summary: '上下文尚未同步：3 章引用旧上下文，3 类资产待校准；处理完成前不宜继续扩批。',
      blockedByContext: true,
    })
  })

  it('keeps the quality readiness summary when context is current', () => {
    const state = resolveOverviewProductionReadiness(
      { readyRate: 88, summary: '当前产线可谨慎继续。' },
      { staleChapterCount: 0, staleAssetCount: 0, staleCheckpointCount: 0 },
    )

    expect(state).toEqual({
      readyRate: 88,
      summary: '当前产线可谨慎继续。',
      blockedByContext: false,
    })
  })
})
