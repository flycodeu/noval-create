import { describe, expect, it } from 'vitest'
import {
  buildQualityIssueFromFinding,
  buildQualityIssuesFromAntiAiHits,
  buildQualityIssuesFromFindings,
  buildQualityIssuesFromSemanticVerdicts,
  qualityIssuesToLegacyCriticalFixes,
  readQualityIssuesFromReviewNotesJson,
} from './quality-issue-policy'
import { dedupeQualityIssues } from '../../src/shared/quality-issue'

describe('quality issue policy', () => {
  it('08-01: a single “突然” style hit is advice and creates no new critical fix', () => {
    const issues = buildQualityIssuesFromAntiAiHits('他突然转身，撞上了门。', [{
      code: 'ai_opener',
      detail: '不要用突然做万能开头。',
      excerpt: '突然',
      severity: 'high',
    }])

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ ruleId: 'ai_opener', level: 'advice' })
    expect(qualityIssuesToLegacyCriticalFixes(issues)).toEqual([])
  })

  it('08-02: dialogue similarity without concrete span evidence is advice', () => {
    const issues = buildQualityIssuesFromFindings('甲说。乙答。', [{
      ruleId: 'dialogue_similarity',
      message: '两位角色对白统计相似度 82%。',
      detector: 'heuristic',
      level: 'blocker',
    }], 'mini-review')

    expect(issues[0]?.level).toBe('advice')
    expect(qualityIssuesToLegacyCriticalFixes(issues)).toEqual([])
  })

  it('08-03: deterministic contract/fact failure remains a blocker', () => {
    const issues = buildQualityIssuesFromFindings('林远不知道账本已被调包。', [{
      ruleId: 'unknown_person_knowledge',
      message: '林远使用了尚未获知的账本事实。',
      detector: 'deterministic',
      level: 'blocker',
      excerpt: '账本已被调包',
    }], 'contract-validator')

    expect(issues[0]).toMatchObject({ category: 'fact', level: 'blocker', detector: 'deterministic' })
    expect(qualityIssuesToLegacyCriticalFixes(issues)[0]).toContain('blocker')
  })

  it('08-04: model motivation without an original quote cannot become blocker', () => {
    const withoutEvidence = buildQualityIssueFromFinding('', {
      ruleId: 'motivation_irrational',
      message: '模型认为动机不合理。',
      detector: 'model',
      level: 'blocker',
      source: 'semantic-gate',
    }, 'semantic-gate')
    const withEvidence = buildQualityIssueFromFinding('他咬牙把门推开。', {
      ruleId: 'motivation_irrational',
      message: '动机与原文选择冲突。',
      detector: 'model',
      level: 'blocker',
      excerpt: '咬牙把门推开',
      source: 'semantic-gate',
    }, 'semantic-gate')

    expect(withoutEvidence?.level).toBe('advice')
    expect(withEvidence?.level).toBe('repair')
  })

  it('08-05: three checkers share one issue id and expose all sources', () => {
    const content = '他突然转身。'
    const fromThreeCheckers = ['enforcer', 'mini-review', 'publish-gate'].map((source) => buildQualityIssueFromFinding(content, {
      ruleId: 'ai_opener',
      message: `${source} 命中同一表达`,
      detector: 'heuristic',
      excerpt: '突然',
      source,
    }, source)!)

    const merged = dedupeQualityIssues(fromThreeCheckers)
    expect(new Set(fromThreeCheckers.map((issue) => issue.id)).size).toBe(1)
    expect(merged[0]?.sources).toEqual(['enforcer', 'mini-review', 'publish-gate'])
  })

  it('semantic accepted evidence becomes repair, while empty evidence remains advice', () => {
    const issues = buildQualityIssuesFromSemanticVerdicts('他咬牙把门推开。', [{
      dimension: 'dramatic_drive',
      status: 'blocker',
      summary: '动机缺少现场触发。',
      evidence: [{ excerpt: '咬牙把门推开' }],
    }])
    const empty = buildQualityIssuesFromSemanticVerdicts('', [{
      dimension: 'dramatic_drive',
      status: 'blocker',
      summary: '模型判断动机不合理。',
      evidence: [],
    }])

    expect(issues[0]?.level).toBe('repair')
    expect(empty[0]?.level).toBe('advice')
  })

  it('does not manufacture semantic evidence from an excerpt absent from the artifact', () => {
    const issues = buildQualityIssuesFromSemanticVerdicts('真实正文没有该句。', [{
      dimension: 'dramatic_drive',
      status: 'blocker',
      summary: '模型返回了漂移证据。',
      evidence: [{ excerpt: '并不存在的模型摘录' }],
    }])

    expect(issues[0]?.level).toBe('advice')
    expect(issues[0]?.evidence).toEqual([])
    expect(issues[0]?.diagnostics).toContain('semantic evidence does not exist in current artifact')
  })

  it('08-06: legacy review JSON without issues remains readable', () => {
    expect(readQualityIssuesFromReviewNotesJson(JSON.stringify({
      critical_fixes: ['旧审校意见'],
      language_risks: ['旧语言风险'],
    }))).toEqual([])
  })
})
