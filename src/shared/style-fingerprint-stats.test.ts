import { describe, expect, it } from 'vitest'
import { computeStyleStats, formatStyleStatsForPrompt, isDialogueParagraph, splitProseSentences } from './style-fingerprint-stats'

const SAMPLE = [
  '他推开门。仓库里只剩一盏灯，光打在积灰的桌面上，照出一道被人反复摩挲过的浅痕，像一条没走完的路。',
  '',
  '“你来晚了。”她说。',
  '',
  '他没接话，先把门闩压回去。',
].join('\n')

describe('style-fingerprint-stats', () => {
  it('splits sentences and detects dialogue paragraphs consistently', () => {
    expect(splitProseSentences('他走了。她留下！风停了吗？')).toHaveLength(3)
    expect(isDialogueParagraph('“你来晚了。”她说。')).toBe(true)
    expect(isDialogueParagraph('他没接话。')).toBe(false)
  })

  it('computes deterministic stats with histogram summing to ~100', () => {
    const stats = computeStyleStats(SAMPLE)

    expect(stats.sentenceCount).toBeGreaterThan(0)
    expect(stats.paragraphCount).toBe(3)
    expect(stats.dialogueLineRate).toBeCloseTo(33.3, 0)
    expect(stats.avgSentenceLength).toBeGreaterThan(0)
    const histogram = stats.sentenceLengthHistogram
    const sum = histogram.short + histogram.medium + histogram.long + histogram.xlong
    expect(sum).toBeGreaterThan(99)
    expect(sum).toBeLessThan(101)
    expect(stats.drift).toBeDefined()
  })

  it('handles empty input without NaN', () => {
    const stats = computeStyleStats('')
    expect(stats.totalChars).toBe(0)
    expect(stats.avgSentenceLength).toBe(0)
    expect(stats.sentenceLengthStdev).toBe(0)
  })

  it('formats a prompt section with target ranges', () => {
    const section = formatStyleStatsForPrompt(computeStyleStats(SAMPLE))
    expect(section).toContain('平均句长')
    expect(section).toContain('对白段占比')
  })
})
