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
})
