import { describe, expect, it } from 'vitest'
import {
  buildFeedbackRecurrenceHardConstraintContext,
  summarizeFeedbackRecurrenceHits,
} from './feedback-recurrence.service'

describe('feedback-recurrence.service', () => {
  it('summarizes recurrence, promotion, and batch-pause suggestions across issue types', () => {
    const summary = summarizeFeedbackRecurrenceHits([
      {
        chapterId: 5,
        chapterNum: 5,
        issueType: 'forced_reversal',
        title: '强行反转',
        severity: 'high',
        source: 'review',
        detail: '第5章反转缺少足够铺垫。',
      },
      {
        chapterId: 7,
        chapterNum: 7,
        issueType: 'forced_reversal',
        title: '强行反转',
        severity: 'high',
        source: 'chapter_gate',
        detail: '第7章仍然先给结果再补理由。',
      },
      {
        chapterId: 9,
        chapterNum: 9,
        issueType: 'forced_reversal',
        title: '强行反转',
        severity: 'high',
        source: 'review',
        detail: '第9章继续依赖硬转折。',
      },
      {
        chapterId: 10,
        chapterNum: 10,
        issueType: 'dialogue_homogenized',
        title: '对白同质化',
        severity: 'medium',
        source: 'review',
        detail: '两个角色的口气已经越来越接近。',
      },
      {
        chapterId: 11,
        chapterNum: 11,
        issueType: 'dialogue_homogenized',
        title: '对白同质化',
        severity: 'medium',
        source: 'chapter_gate',
        detail: '对白辨识度仍未拉开。',
      },
    ])

    expect(summary.overview.hitChapterCount).toBe(5)
    expect(summary.overview.recurringIssueCount).toBe(2)
    expect(summary.overview.highRiskIssueCount).toBe(1)
    expect(summary.overview.pauseSuggestedIssueCount).toBe(1)
    expect(summary.topRepeatedIssues[0]?.issueType).toBe('forced_reversal')
    expect(summary.recentAlerts.some((item) => item.issueType === 'forced_reversal' && item.pauseSuggested)).toBe(true)
    expect(summary.chapterSignals.find((item) => item.chapterNum === 11)?.issues[0]?.issueType).toBe('dialogue_homogenized')
  })

  it('builds prompt-ready hard constraints from promoted feedback issues', () => {
    const text = buildFeedbackRecurrenceHardConstraintContext({
      promotedIssues: [{
        issueType: 'cost_evaporation',
        title: '代价蒸发',
        chapterNums: [8, 9],
        avoid: '不要把伤势、资源损耗或关系裂痕写成无后果收束。',
        prefer: '让代价继续挤压角色选择，并在行动里兑现余波。',
        pauseSuggested: true,
      }],
    })

    expect(text).toContain('【近章必须避免】')
    expect(text).toContain('高频阻断代价蒸发')
    expect(text).toContain('【近章纠偏重点】')
    expect(text).toContain('让代价继续挤压角色选择')
  })
})
