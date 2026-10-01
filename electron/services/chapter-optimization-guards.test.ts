import { describe, expect, it } from 'vitest'
import { buildChapterOptimizationPrompt } from './chapter-optimization-guards'

describe('chapter optimization prompt', () => {
  it('follows the author request and does not impose a stock dramatic turn', () => {
    const prompt = buildChapterOptimizationPrompt({
      chapter: {
        chapterNum: 2,
        title: '茶后',
        outline: '母女谈完旧事，各自回家。',
      } as Parameters<typeof buildChapterOptimizationPrompt>[0]['chapter'],
      novelTitle: '归途',
      content: '她把茶杯放在桌上。母亲关窗，递回围巾。两人道别。',
      issueSummary: ['第二句有一次重复解释。'],
      extraRequirements: '只删去重复解释，保留安静的告别。',
      repairMode: 'structural',
    })

    expect(prompt.indexOf('用户追加要求')).toBeLessThan(prompt.indexOf('自动诊断'))
    expect(prompt).toContain('日常相处、安静收束和未解问题可以保持原貌')
    expect(prompt).not.toContain('主角的未经核实判断必须')
    expect(prompt).not.toContain('必须先用具体事实兑现本章大纲')
    expect(prompt).toContain('【当前完整正文】')
  })
})
