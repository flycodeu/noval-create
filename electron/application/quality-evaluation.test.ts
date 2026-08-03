import { describe, expect, it } from 'vitest'
import type { QualityDashboardRiskItem } from '../../src/types'
import { buildAgentQualityReport, type AgentQualityDashboardSource } from './quality-evaluation'

function risk(overrides: Partial<QualityDashboardRiskItem> = {}): QualityDashboardRiskItem {
  return {
    kind: 'story_arc',
    severity: 'warning',
    title: '故事弧停滞',
    detail: '连续三章没有推进。',
    chapterNums: [2, 3, 4],
    metricKey: 'story_arc',
    whyItHappened: '章节只重复局面。',
    howToFix: '让角色选择产生不可逆后果。',
    suggestedActions: [],
    ...overrides,
  }
}

function dashboard(options: {
  risks?: QualityDashboardRiskItem[]
  total?: number
  analyzed?: number
  health?: number
  average?: number
  aiLike?: number
  readiness?: 'ready' | 'warning' | 'blocked'
  highRiskAi?: number
  feedbackPause?: number
} = {}): AgentQualityDashboardSource {
  const total = options.total ?? 2
  const analyzed = options.analyzed ?? total
  const risks = options.risks || []
  const chapters = Array.from({ length: analyzed }, (_, index) => ({
    chapterId: index + 10,
    chapterNum: index + 1,
    title: `第${index + 1}章`,
    volumeId: 7,
    overallScore: options.average ?? 88,
    aiLikeRate: options.aiLike ?? 12,
    weakDimensions: [],
    dimensions: [{ name: 'continuity', score: options.average ?? 88 }],
  }))
  return {
    totalChaptersScored: analyzed,
    averageOverallScore: options.average ?? 88,
    averageAiLikeRate: options.aiLike ?? 12,
    novelQualityMetrics: {
      healthScore: options.health ?? 88,
      totalChapterCount: total,
      analyzedChapterCount: analyzed,
      criticalRiskCount: risks.filter((item) => item.severity === 'critical').length,
      warningRiskCount: risks.filter((item) => item.severity === 'warning').length,
      topRisks: risks,
    },
    volumeQualityMetrics: [{
      volumeId: 7,
      volumeNumber: 1,
      volumeName: '第一卷',
      chapterCount: total,
      analyzedChapterCount: analyzed,
      healthScore: options.health ?? 88,
      topRisks: risks,
    }],
    productionReadiness: {
      status: options.readiness || 'ready',
      blockers: options.readiness === 'blocked' ? ['仍有发布门禁'] : [],
      warnings: [],
      suggestedActions: ['关闭发布门禁'],
    },
    chapterGateSummary: { riskyCount: 0, unstableCount: 0 },
    antiAiRecurrence: { highRiskRuleCount: options.highRiskAi || 0 },
    feedbackRecurrence: { pauseSuggestedIssueCount: options.feedbackPause || 0 },
    repairMetrics: [],
    chapterDetails: chapters,
  } as unknown as AgentQualityDashboardSource
}

describe('agent quality evaluation', () => {
  it('fails closed for recommendation readiness when coverage and recurrence evidence are unsafe', () => {
    const report = buildAgentQualityReport({
      requestFingerprint: `sha256:${'a'.repeat(64)}`,
      profile: 'recommendation_ready_v1',
      scope: { type: 'novel', label: '整书', chapterNums: [1] },
      dashboard: dashboard({
        total: 2,
        analyzed: 1,
        health: 79,
        average: 80,
        aiLike: 51,
        highRiskAi: 2,
        feedbackPause: 1,
        risks: [risk({ severity: 'critical' })],
      }),
      contextVersion: 4,
      maxFindings: 30,
      createdAt: '2026-07-11T00:00:00.000Z',
    })

    expect(report.status).toBe('blocked')
    expect(report.coverageRate).toBe(50)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'quality_coverage', blocking: true }),
      expect.objectContaining({ code: 'high_risk_ai_recurrence', blocking: true }),
      expect.objectContaining({ code: 'feedback_pause_signals', blocking: true }),
    ]))
    expect(report.summary).toContain('硬阻塞')
  })

  it('passes a fully covered clean longform snapshot without inventing findings', () => {
    const report = buildAgentQualityReport({
      requestFingerprint: `sha256:${'b'.repeat(64)}`,
      profile: 'longform_health_v1',
      scope: { type: 'novel', label: '整书', chapterNums: [1, 2] },
      dashboard: dashboard(),
      contextVersion: 2,
      maxFindings: 20,
      createdAt: '2026-07-11T00:00:00.000Z',
    })

    expect(report).toMatchObject({ status: 'passed', coverageRate: 100, blockers: [], findings: [] })
  })

  it('keeps only evidence belonging to the selected volume and deduplicates dashboard mirrors', () => {
    const selected = risk({ volumeId: 7, chapterNums: [1], title: '本卷风险' })
    const outside = risk({ volumeId: 8, chapterNums: [9], title: '外卷风险' })
    const source = dashboard({ risks: [selected, outside] })
    source.volumeQualityMetrics.push({
      ...source.volumeQualityMetrics[0],
      volumeId: 8,
      volumeNumber: 2,
      volumeName: '第二卷',
      topRisks: [outside],
    })
    const report = buildAgentQualityReport({
      requestFingerprint: `sha256:${'c'.repeat(64)}`,
      profile: 'longform_health_v1',
      scope: { type: 'volume', label: '第一卷', volumeId: 7, chapterNums: [1, 2] },
      dashboard: source,
      contextVersion: 2,
      maxFindings: 20,
      createdAt: '2026-07-11T00:00:00.000Z',
    })

    expect(report.findings.filter((finding) => finding.title === '本卷风险')).toHaveLength(1)
    expect(report.findings.some((finding) => finding.title === '外卷风险')).toBe(false)
  })

  it('evaluates a stage by its chapter window and does not import unrelated risks', () => {
    const selected = risk({ chapterNums: [2], title: '阶段内风险' })
    const outside = risk({ chapterNums: [9], title: '阶段外风险' })
    const source = dashboard({ total: 2, analyzed: 2, risks: [selected, outside] })
    const report = buildAgentQualityReport({
      requestFingerprint: `sha256:${'e'.repeat(64)}`,
      profile: 'longform_health_v1',
      scope: { type: 'stage', label: '阶段一', stageId: 17, chapterNums: [1, 2, 3] },
      dashboard: source,
      contextVersion: 3,
      maxFindings: 20,
      createdAt: '2026-07-11T00:00:00.000Z',
    })

    expect(report.metrics).toMatchObject({
      totalChapterCount: 3,
      analyzedChapterCount: 2,
      coverageRate: 67,
    })
    expect(report.findings.some((finding) => finding.title === '阶段内风险')).toBe(true)
    expect(report.findings.some((finding) => finding.title === '阶段外风险')).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'quality_coverage', blocking: true }),
    ]))
  })

  it('does not count chapter-gate fallback scores as AI quality coverage', () => {
    const source = dashboard({ total: 2, analyzed: 0, average: 0 })
    source.chapterDetails = source.chapterDetails.map((chapter) => ({
      ...chapter,
      overallScore: 4,
      dimensions: [],
    }))

    const report = buildAgentQualityReport({
      requestFingerprint: `sha256:${'d'.repeat(64)}`,
      profile: 'longform_health_v1',
      scope: { type: 'novel', label: '整书', chapterNums: [1, 2] },
      dashboard: source,
      contextVersion: 2,
      maxFindings: 20,
    })

    expect(report.metrics.averageOverallScore).toBe(0)
    expect(report.metrics.coverageRate).toBe(0)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'quality_coverage', blocking: true }),
    ]))
  })
})
