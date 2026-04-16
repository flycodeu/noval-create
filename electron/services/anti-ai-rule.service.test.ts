import { describe, expect, it } from 'vitest'
import {
  buildAntiAiHardConstraintContext,
  collectAntiAiRuntimeHits,
  summarizeAntiAiRuleHits,
} from './anti-ai-rule.service'

describe('anti-ai-rule.service', () => {
  it('builds prompt-ready hard constraints from builtin, custom, and promoted rules', () => {
    const text = buildAntiAiHardConstraintContext({
      genre: '悬疑推理',
      settingsJson: JSON.stringify({
        writing_rules: {
          anti_ai_flavor: '不要在段尾替角色总结意义；不要用万能转场偷渡时间。',
          banned_terms: '命运的齿轮，某种无法言说',
        },
      }),
      promotedRules: [{
        ruleCode: 'ai_ending_summary',
        ruleTitle: '总结式章尾',
        scope: 'structure',
        chapterNums: [8, 9],
        avoid: '不要用“而这一切才刚刚开始”这类总结式句子收尾。',
        prefer: '让悬念停在未完成动作或线索余波上。',
      }],
    })

    expect(text).toContain('【必须避免-禁用表达】')
    expect(text).toContain('本书禁用：命运的齿轮')
    expect(text).toContain('本书自定义：不要在段尾替角色总结意义')
    expect(text).toContain('本书近章复现：不要用“而这一切才刚刚开始”这类总结式句子收尾。')
    expect(text).toContain('【正向替代表达】')
    expect(text).toContain('让悬念停在未完成动作或线索余波上。')
  })

  it('collects runtime hits from existing guardrails', () => {
    const hits = collectAntiAiRuntimeHits('命运的齿轮仿佛再次转动。就在这时，他突然明白这就是所谓的成长。')
    expect(hits.some((item) => item.ruleCode === 'ai_slogan')).toBe(true)
    expect(hits.some((item) => item.ruleCode === 'ai_opener')).toBe(true)
  })

  it('summarizes recurrence, promotion, and high-risk windows', () => {
    const summary = summarizeAntiAiRuleHits([
      {
        chapterId: 11,
        chapterNum: 11,
        ruleCode: 'ai_ending_summary',
        ruleTitle: '总结式章尾',
        scope: 'structure',
        severity: 'medium',
        excerpt: '而这一切才刚刚开始',
        source: 'guardrail',
        promotedToHardConstraint: 0,
      },
      {
        chapterId: 12,
        chapterNum: 12,
        ruleCode: 'ai_ending_summary',
        ruleTitle: '总结式章尾',
        scope: 'structure',
        severity: 'medium',
        excerpt: '故事远没有结束',
        source: 'guardrail',
        promotedToHardConstraint: 1,
      },
      {
        chapterId: 13,
        chapterNum: 13,
        ruleCode: 'ai_ending_summary',
        ruleTitle: '总结式章尾',
        scope: 'structure',
        severity: 'medium',
        excerpt: '新的篇章即将开始',
        source: 'guardrail',
        promotedToHardConstraint: 0,
      },
      {
        chapterId: 13,
        chapterNum: 13,
        ruleCode: 'sentence_pattern_repeat_high',
        ruleTitle: '句式重复率过高',
        scope: 'drift',
        severity: 'high',
        excerpt: '句式重复率过高 48',
        source: 'language_drift',
        promotedToHardConstraint: 0,
      },
    ])

    expect(summary.overview.hitChapterCount).toBe(3)
    expect(summary.overview.recurringRuleCount).toBeGreaterThanOrEqual(1)
    expect(summary.overview.promotedRuleCount).toBe(1)
    expect(summary.overview.highRiskRuleCount).toBe(1)
    expect(summary.topRepeatedRules[0]?.ruleCode).toBe('ai_ending_summary')
    expect(summary.recentAlerts.some((item) => item.ruleCode === 'ai_ending_summary' && item.severity === 'critical')).toBe(true)
    expect(summary.chapterSignals.find((item) => item.chapterNum === 13)?.rules.length).toBe(2)
  })
})
