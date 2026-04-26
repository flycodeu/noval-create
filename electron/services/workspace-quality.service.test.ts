import { describe, expect, it } from 'vitest'
import { analyzeWorkspaceAiFlavor } from './workspace-quality.service'

describe('workspace-quality.service', () => {
  it('extracts reusable humanization signals from AI-like prose', () => {
    const report = analyzeWorkspaceAiFlavor(
      [
        '然而，他忽然意识到，这意味着一切都走向了某种无法言说的命运。',
        '与此同时，她只是静静站着，仿佛这一刻已经说明了全部。',
        '某种情绪在空气里缓慢扩散，这也许代表着某种更深的东西。',
      ].join(''),
    )

    expect(report.humanizationSignals.some((item) => item.issueType === 'template_connector')).toBe(true)
    expect(report.humanizationSignals.some((item) => item.issueType === 'explanatory_narration')).toBe(true)
    expect(report.humanizationDirections.length).toBeGreaterThan(0)
  })

  it('surfaces transition, emotion, and exposition-specific signals when chapter context is provided', () => {
    const report = analyzeWorkspaceAiFlavor(
      [
        '学院的位阶制度分为外院、内院和真传。',
        '帝国法令规定所有术式都必须登记来源与许可。',
        '灵脉体系由九段构成，每一段对应不同的资源配额。',
        '教会与军府分别负责审查和执行这套规则。',
      ].join(''),
      undefined,
      {
        chapterFunction: 'breather',
        emotionFocus: '克制悲伤',
        expositionMode: '动作带出',
      },
    )

    expect(report.humanizationSignals.some((item) => item.issueType === 'world_exposition_dump')).toBe(true)
    expect(report.breakdown.some((item) => item.key === 'worldExpositionRiskRate')).toBe(true)
  })
})
