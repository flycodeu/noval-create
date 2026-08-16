import { describe, expect, it } from 'vitest'
import type { QualityDashboardRiskItem, QualityDashboardRiskKind, QualityDashboardRiskSeverity } from '../../src/types'
import { buildVolumeTopRisks } from './quality-dashboard-volume-metrics'

function createRisk(
  kind: QualityDashboardRiskKind,
  severity: QualityDashboardRiskSeverity,
  title: string,
  detail: string,
  chapterNums: number[],
  volumeId?: number,
): QualityDashboardRiskItem {
  return { kind, severity, title, detail, chapterNums, volumeId, whyItHappened: '', howToFix: '', suggestedActions: [] }
}

describe('quality dashboard volume metrics', () => {
  it('keeps overdue debt ahead of due-soon and unbound fallbacks', () => {
    const risks = buildVolumeTopRisks({
      volumeRange: { volumeId: 1, volumeName: '第一卷', chapterStart: 1, chapterEnd: 20 },
      arcAlerts: [],
      foreshadowCounts: { overdue: 2, dueSoon: 3 },
      endgameCounts: { overdue: 1, unbound: 4 },
      styleComplianceAlerts: [],
      createRisk,
    })

    expect(risks.map((risk) => risk.kind)).toEqual(['foreshadow_debt', 'endgame_debt'])
    expect(risks.every((risk) => risk.severity === 'critical')).toBe(true)
    expect(risks[1].detail).toContain('另有 4 条')
  })

  it('sorts by severity and retains the six-risk display cap', () => {
    const risks = buildVolumeTopRisks({
      volumeRange: { volumeId: 2, volumeName: '第二卷', chapterStart: 21, chapterEnd: 40 },
      arcAlerts: Array.from({ length: 8 }, (_, index) => ({
        code: 'stalled_run' as const,
        severity: index === 7 ? 'critical' as const : 'warning' as const,
        arcId: index + 1,
        arcName: `故事弧 ${index + 1}`,
        title: `风险 ${index + 1}`,
        detail: '停滞',
        chapterNum: 21 + index,
      })),
      foreshadowCounts: { overdue: 0, dueSoon: 0 },
      endgameCounts: { overdue: 0, unbound: 0 },
      styleComplianceAlerts: [],
      createRisk,
    })

    expect(risks).toHaveLength(6)
    expect(risks[0]).toMatchObject({ severity: 'critical', title: '风险 8' })
  })
})
