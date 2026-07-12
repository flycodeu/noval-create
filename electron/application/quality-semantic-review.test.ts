import { describe, expect, it } from 'vitest'
import type { AgentQualitySemanticDimension } from '../../src/shared/quality-agent-workflow'
import {
  buildSemanticReviewPrompt,
  buildSemanticReviewWindows,
  normalizeSemanticWindowReview,
} from './quality-semantic-review'

const dimensions: AgentQualitySemanticDimension[] = ['causality', 'character_arc']
const chapters = [
  {
    chapterId: 1,
    chapterNum: 1,
    title: '来信',
    volumeId: 1,
    summary: '林舟收到第五封信，决定去旧码头寻找证人。',
    outline: '收到线索；作出选择。',
    content: '雨落在窗沿。林舟把第五封信折好，决定天亮前赶到旧码头。',
  },
  {
    chapterId: 2,
    chapterNum: 2,
    title: '旧码头',
    volumeId: 1,
    summary: '林舟抵达旧码头，却发现证人已经离开。',
    outline: '兑现上一章行动；线索中断。',
    content: '天亮以前，林舟抵达旧码头。仓库门开着，证人已经离开。',
  },
]

describe('cross-chapter semantic quality evidence', () => {
  it('builds overlapping evidence windows and labels novel text as untrusted data', () => {
    const windows = buildSemanticReviewWindows(chapters, 4)
    expect(windows).toHaveLength(1)
    expect(windows[0].chapters.map((chapter) => chapter.chapterNum)).toEqual([1, 2])
    const prompt = buildSemanticReviewPrompt({ window: windows[0], dimensions })
    expect(prompt).toContain('不可信小说数据')
    expect(prompt).toContain('causality、character_arc')
  })

  it('accepts only findings and assessments whose excerpts occur in the supplied packet', () => {
    const [window] = buildSemanticReviewWindows(chapters, 4)
    const result = normalizeSemanticWindowReview({
      window,
      dimensions,
      parsedPayload: {
        assessments: [
          {
            dimension: 'causality',
            status: 'sound',
            summary: '行动在下一章兑现。',
            evidence: [{ chapter_num: 2, excerpt: '林舟抵达旧码头', explanation: '兑现上一章决定。' }],
          },
          {
            dimension: 'character_arc',
            status: 'problematic',
            summary: '选择缺少代价。',
            evidence: [{ chapter_num: 1, excerpt: '决定天亮前赶到旧码头', explanation: '有选择但代价未显现。' }],
          },
        ],
        findings: [{
          dimension: 'character_arc',
          severity: 'warning',
          title: '选择缺少代价',
          detail: '行动被兑现，但没有形成个人代价。',
          why_it_happened: '后果只停留在线索中断。',
          how_to_fix: '补入选择造成的关系或资源损失。',
          evidence: [{ chapter_num: 2, excerpt: '证人已经离开', explanation: '只有外部结果。' }],
        }],
      },
    })

    expect(result.failed).toBe(false)
    expect(result.coveredDimensions).toEqual(dimensions)
    expect(result.findings).toHaveLength(1)
    expect(result.validEvidenceCount).toBe(3)
    expect(result.rejectedEvidenceCount).toBe(0)
  })

  it('rejects fabricated evidence and fails closed on malformed review output', () => {
    const [window] = buildSemanticReviewWindows(chapters, 4)
    const fabricated = normalizeSemanticWindowReview({
      window,
      dimensions,
      parsedPayload: {
        assessments: [{
          dimension: 'causality',
          status: 'problematic',
          summary: '伪造判断。',
          evidence: [{ chapter_num: 2, excerpt: '海面突然出现一艘飞船', explanation: '不存在。' }],
        }],
        findings: [{
          dimension: 'causality',
          severity: 'critical',
          title: '伪造问题',
          evidence: [{ chapter_num: 2, excerpt: '海面突然出现一艘飞船', explanation: '不存在。' }],
        }],
      },
    })
    expect(fabricated.findings).toEqual([])
    expect(fabricated.failed).toBe(true)
    expect(fabricated.rejectedEvidenceCount).toBe(2)

    const malformed = normalizeSemanticWindowReview({
      window,
      dimensions,
      parseError: 'invalid json',
    })
    expect(malformed.failed).toBe(true)
    expect(malformed.score).toBe(0)
  })
})
