import { describe, expect, it } from 'vitest'
import { collectQualityGuardrailFindings, hasBlockingGuardrailFindings, shouldForceRepair } from './content-guardrails'

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

  it('does not treat a natural comparative dialogue phrase as formal parallelism', () => {
    const findings = collectQualityGuardrailFindings('“越还手他越有话说。”')

    expect(findings.some((finding) => finding.code === 'parallelism_overuse')).toBe(false)
  })

  it('keeps one soft-voice cliché as a warning instead of a hard AI-flavor blocker', () => {
    const findings = collectQualityGuardrailFindings('方大炉低声说：“先把扳手放下。”', '历史正剧')
    const softVoiceFinding = findings.find((finding) => finding.code === 'soft_voice_cliche')

    expect(softVoiceFinding).toBeDefined()
    expect(hasBlockingGuardrailFindings(findings)).toBe(false)
  })

  it('allows a quoted character correction while keeping narrative definitions flagged', () => {
    const dialogueFindings = collectQualityGuardrailFindings('方大炉说：“不是你一个人扣，是全班。”', '历史正剧')
    const narrativeFindings = collectQualityGuardrailFindings('这不是一次失败，而是命运给他的另一种证明。', '历史正剧')

    expect(dialogueFindings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
    expect(narrativeFindings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(true)
  })

  it('does not mistake a concrete movement correction for a definition sentence', () => {
    const findings = collectQualityGuardrailFindings('他不是往锅炉房方向走的，是一步一顿往车间外头去的。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
  })

  it('does not treat two negative facts as a not-but definition', () => {
    const findings = collectQualityGuardrailFindings('笔迹不是她母亲的，不是护士刚才当面写字的那种力度。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
  })

  it('does not cross a sentence boundary when detecting not-but definitions', () => {
    const findings = collectQualityGuardrailFindings('我不是第一次被联系过。但今天是第一次有人提前到了。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
  })

  it('flags the split “并非……实际是……” definition pattern', () => {
    const findings = collectQualityGuardrailFindings('她并非来取原件。实际是来确认谁动过档案。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(true)
  })

  it('does not treat tracked character names as descriptive repetition', () => {
    const content = Array.from({ length: 20 }, (_, index) => `第${index + 1}次点名时，郭大桩都站在炉门旁，手里还攥着当班记录。`).join('\n')

    const findings = collectQualityGuardrailFindings(content, undefined, {
      knownTerms: ['郭大桩'],
    })

    const repetitionFinding = findings.find((finding) => finding.code === 'high_frequency_repetition')
    expect(repetitionFinding?.excerpt || '').not.toContain('郭大')
    expect(repetitionFinding?.excerpt || '').not.toContain('大桩')
  })

  it('keeps flagging repeated descriptive phrases when they are not tracked terms', () => {
    const content = Array.from({ length: 20 }, () => '阴冷的墙面贴着他的后背，阴冷气息没有散去，他把记录纸压在膝上继续核对。').join('\n')

    const findings = collectQualityGuardrailFindings(content, undefined, {
      knownTerms: ['郭大桩'],
    })

    expect(findings.some((finding) => finding.code === 'high_frequency_repetition')).toBe(true)
  })
})
