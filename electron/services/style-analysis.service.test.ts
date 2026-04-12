import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./model.service', () => ({
  getAdapterById: vi.fn(),
  getDefaultAdapter: vi.fn(),
}))

import type { StyleFingerprint } from './style-analysis.service'
import {
  getDefaultFingerprint,
  mergeStyleResults,
  parseStyleResult,
} from './style-analysis.service'

describe('style-analysis helpers', () => {
  it('parses plain JSON responses', () => {
    const fingerprint = parseStyleResult(`{
      "avgSentenceLength": 18,
      "sentencePatterns": ["短长交替"],
      "wordFrequencyProfile": { "高频动词": ["撞", "停"] },
      "narrativeTechniques": "动作驱动",
      "dialogueStyle": "压短句",
      "descriptionDensity": "偏少",
      "paceProfile": "快",
      "toneKeywords": ["冷硬"],
      "forbiddenPatterns": ["不要空喊"],
      "exampleExcerpts": ["他抬手就砸了过去。"]
    }`)

    expect(fingerprint.avgSentenceLength).toBe(18)
    expect(fingerprint.sentencePatterns).toEqual(['短长交替'])
    expect(fingerprint.wordFrequencyProfile).toEqual({ 高频动词: ['撞', '停'] })
    expect(fingerprint.exampleExcerpts).toEqual(['他抬手就砸了过去。'])
  })

  it('extracts JSON from wrapped model output', () => {
    const fingerprint = parseStyleResult(`以下是风格分析：
{
  "avgSentenceLength": 24,
  "toneKeywords": ["克制", "留白"],
  "exampleExcerpts": ["她没回头，只把门带上。"]
}
请查收。`)

    expect(fingerprint.avgSentenceLength).toBe(24)
    expect(fingerprint.toneKeywords).toEqual(['克制', '留白'])
    expect(fingerprint.exampleExcerpts).toEqual(['她没回头，只把门带上。'])
  })

  it('falls back to the default fingerprint on broken JSON', () => {
    expect(parseStyleResult('这不是 JSON {oops')).toEqual(getDefaultFingerprint())
  })

  it('merges chunks with de-duped tokens, rounded length, and trimmed excerpts', () => {
    const longExcerpt = '风'.repeat(180)
    const first: StyleFingerprint = {
      avgSentenceLength: 17,
      sentencePatterns: ['短句密集', '短句密集'],
      wordFrequencyProfile: {
        高频动词: ['撞', '停', '停'],
        偏好形容词: ['冷', '硬'],
      },
      narrativeTechniques: '动作驱动',
      dialogueStyle: '',
      descriptionDensity: '偏少',
      paceProfile: '',
      toneKeywords: ['冷硬', '克制'],
      forbiddenPatterns: ['不要空喊', '不要空喊'],
      exampleExcerpts: [longExcerpt, '片段二'],
    }
    const second: StyleFingerprint = {
      avgSentenceLength: 20,
      sentencePatterns: ['短长交替', '短句密集'],
      wordFrequencyProfile: {
        高频动词: ['撞', '压'],
        特色词汇: ['断口', '火星'],
      },
      narrativeTechniques: '',
      dialogueStyle: '口语利落',
      descriptionDensity: '',
      paceProfile: '快推进',
      toneKeywords: ['克制', '留白'],
      forbiddenPatterns: ['不要解释情绪'],
      exampleExcerpts: ['片段二', '片段三'],
    }

    const merged = mergeStyleResults([first, second])

    expect(merged.avgSentenceLength).toBe(19)
    expect(merged.sentencePatterns).toEqual(['短句密集', '短长交替'])
    expect(merged.toneKeywords).toEqual(['冷硬', '克制', '留白'])
    expect(merged.forbiddenPatterns).toEqual(['不要空喊', '不要解释情绪'])
    expect(merged.narrativeTechniques).toBe('动作驱动')
    expect(merged.dialogueStyle).toBe('口语利落')
    expect(merged.descriptionDensity).toBe('偏少')
    expect(merged.paceProfile).toBe('快推进')
    expect(merged.wordFrequencyProfile).toEqual({
      高频动词: ['撞', '停', '压'],
      偏好形容词: ['冷', '硬'],
      特色词汇: ['断口', '火星'],
    })
    expect(merged.exampleExcerpts).toHaveLength(3)
    expect(merged.exampleExcerpts[0].endsWith('...')).toBe(true)
    expect(merged.exampleExcerpts[0].length).toBeLessThanOrEqual(140)
  })
})
