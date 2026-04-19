import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_ZERO_STATE_ACTIONS,
  resolveOverviewDisplayState,
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
})
