import { describe, expect, it } from 'vitest'
import {
  buildQualityIssueId,
  createQualityIssue,
  dedupeQualityIssues,
  normalizeQualityIssue,
  qualityIssueArtifactHash,
} from './quality-issue'

describe('QualityIssueV1', () => {
  it('keeps a one-off style hit as advice even when an upstream detector says blocker', () => {
    const issue = createQualityIssue({
      ruleId: 'ai_opener',
      message: '万能开头：突然',
      detector: 'heuristic',
      level: 'blocker',
      content: '他突然转身，撞上了门。',
      excerpt: '突然',
      source: 'enforcer',
    })

    expect(issue?.level).toBe('advice')
    expect(issue?.evidence[0]).toMatchObject({ start: 1, end: 3, quote: '突然' })
  })

  it('defaults an unknown rule to advice and records a diagnostic', () => {
    const issue = normalizeQualityIssue({
      ruleId: 'AI-001',
      level: 'blocker',
      detector: 'heuristic',
      confidence: 0.8,
      evidence: [],
      scope: 'chapter',
      message: '旧检查器命中',
    })

    expect(issue).toMatchObject({ ruleId: 'AI-001', level: 'advice', category: 'style' })
    expect(issue?.diagnostics).toContain('unknown ruleId: defaulted to advice')
  })

  it('retains a deterministic fact blocker and exact UTF-16 evidence', () => {
    const content = '😀人物未获知这条事实。'
    const issue = createQualityIssue({
      ruleId: 'unknown_person_knowledge',
      message: '人物不应知道尚未获知的事实。',
      detector: 'deterministic',
      level: 'blocker',
      content,
      excerpt: '人物未获知',
      source: 'contract-validator',
    })

    expect(issue?.level).toBe('blocker')
    expect(issue?.evidence[0]).toMatchObject({ start: 2, end: 7, quote: '人物未获知' })
  })

  it('describes an evidence-free deterministic blocker without claiming a downgrade', () => {
    const issue = createQualityIssue({
      ruleId: 'unknown_person_knowledge',
      message: '确定性校验器未能附带正文范围。',
      detector: 'deterministic',
      level: 'blocker',
      source: 'contract-validator',
    })

    expect(issue?.level).toBe('blocker')
    expect(issue?.diagnostics).toContain('missing exact正文 evidence: deterministic blocker retained')
    expect(issue?.diagnostics).not.toContain('missing exact正文 evidence: downgraded to advice')
  })

  it('deduplicates by artifact hash, rule and range while merging sources', () => {
    const content = '他突然转身。'
    const first = createQualityIssue({
      ruleId: 'ai_opener', message: '命中突然', detector: 'heuristic', content, excerpt: '突然', source: 'enforcer',
    })!
    const second = createQualityIssue({
      ruleId: 'ai_opener', message: '同一命中', detector: 'heuristic', content, excerpt: '突然', source: 'mini-review',
    })!

    expect(first.id).toBe(buildQualityIssueId(qualityIssueArtifactHash(content), 'ai_opener', 1, 3))
    expect(dedupeQualityIssues([first, second])).toHaveLength(1)
    expect(dedupeQualityIssues([first, second])[0]?.sources).toEqual(['enforcer', 'mini-review'])
  })
})
