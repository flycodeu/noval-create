import { describe, expect, it } from 'vitest'
import type { QualityDashboardRiskItem } from '../../src/types'
import { buildRepairActionSummary, buildRepairMetricSummary } from './quality-dashboard-repair-metrics'

const risks: QualityDashboardRiskItem[] = [
  {
    kind: 'recall',
    severity: 'critical',
    title: '召回阻断',
    detail: '召回连续降级',
    chapterNums: [10],
    metricKey: 'recall',
    whyItHappened: '',
    howToFix: '',
    suggestedActions: [
      {
        id: 'repair-recall',
        label: '修复召回',
        description: '恢复召回链路',
        actionType: 'create_revision_task',
        metricKey: 'recall',
        targetPage: 'revision',
        safeToExecute: true,
        taskDraft: {
          taskType: 'continuity',
          severity: 'high',
          title: '修复召回',
          description: '恢复召回链路',
          relatedPage: 'revision',
        },
      },
    ],
  },
  {
    kind: 'recall',
    severity: 'warning',
    title: '允许偏差',
    detail: '作者确认偏差',
    chapterNums: [11],
    metricKey: 'recall',
    whyItHappened: '',
    howToFix: '',
    suggestedActions: [{
      id: 'allow-recall',
      label: '允许偏差',
      description: '记录作者决策',
      actionType: 'allow_deviation',
      metricKey: 'recall',
      targetPage: 'revision',
      safeToExecute: false,
    }],
  },
]

describe('quality dashboard repair metrics', () => {
  it('clamps metric scores and keeps the first three risk labels', () => {
    expect(buildRepairMetricSummary({
      metricKey: 'recall',
      label: '召回可靠性',
      score: -8.4,
      summary: '召回有风险',
      repairRiskItems: risks,
    })).toEqual({
      key: 'recall',
      label: '召回可靠性',
      score: 0,
      summary: '召回有风险',
      riskCount: 2,
      focusLabels: ['召回阻断', '允许偏差'],
    })
  })

  it('counts action capabilities once and preserves risk priority order', () => {
    expect(buildRepairActionSummary(risks)).toEqual({
      actionableRiskCount: 2,
      taskActionCount: 1,
      directExecutableActionCount: 1,
      allowDeviationCount: 1,
      topPriorityActions: ['修复召回', '允许偏差'],
    })
  })
})
