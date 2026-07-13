import { describe, expect, it } from 'vitest'
import { collectQualityGuardrailFindings, shouldForceRepair } from './content-guardrails'

describe('content guardrail repair threshold', () => {
  it('repairs a single high-confidence AI cliche instead of letting it pass silently', () => {
    const findings = collectQualityGuardrailFindings('他相信命运的齿轮已经开始转动。')

    expect(findings.some((finding) => finding.code === 'ai_slogan')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(true)
  })

  it('does not turn a single low-severity stylistic hint into a rewrite', () => {
    const findings = collectQualityGuardrailFindings('她静静地看着窗外的雨。')

    expect(findings.some((finding) => finding.severity === 'low')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(false)
  })

  it('does not mistake ordinary progressive wording for AI parallelism', () => {
    const findings = collectQualityGuardrailFindings('走廊里的脚步声越来越近，他把登记表压在桌角。')

    expect(findings.some((finding) => finding.code === 'parallelism_overuse')).toBe(false)
  })
})
