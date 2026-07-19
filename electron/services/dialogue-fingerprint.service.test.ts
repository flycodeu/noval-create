import { describe, expect, it, vi } from 'vitest'
import type {
  CharacterDialogueFingerprint,
  CharacterDialogueSignature,
} from '../../src/types'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

vi.mock('./model.service', () => ({
  getAdapterById: vi.fn(),
  getDefaultAdapter: vi.fn(),
}))

import {
  buildFingerprintFromTurns,
  buildSentencePatterns,
  computeSimilarity,
  hasStableChapterDialogueEvidence,
  type DialogueTurn,
} from './dialogue-fingerprint.service'

function createFingerprint(overrides: Partial<CharacterDialogueFingerprint> = {}): CharacterDialogueFingerprint {
  return {
    sampleCount: 12,
    totalDialogueChars: 320,
    avgSentenceLength: 9,
    sentenceLengthVariance: 4,
    shortSentenceRate: 60,
    longSentenceRate: 8,
    questionRate: 35,
    exclamationRate: 28,
    interruptionRate: 24,
    ellipsisRate: 22,
    dashRate: 15,
    modalParticles: [{ token: '啊', count: 4 }],
    catchphraseCandidates: [{ token: '闭嘴', count: 3 }],
    topTokens: [{ token: '闭嘴', count: 3 }],
    sentencePatterns: ['短句密集', '追问反问多'],
    recentSampleChapterNums: [4, 5, 6],
    ...overrides,
  }
}

function createSignature(
  name: string,
  overrides: Partial<CharacterDialogueSignature> = {},
): CharacterDialogueSignature {
  return {
    characterId: name === '甲' ? 1 : 2,
    characterName: name,
    roleType: 'major',
    voiceProfile: '',
    distinctiveHabits: [],
    antiPatterns: [],
    compareHints: [],
    ...createFingerprint(),
    ...overrides,
  }
}

describe('dialogue fingerprint helpers', () => {
  it('returns a zero fingerprint for empty dialogue samples', () => {
    expect(buildFingerprintFromTurns([])).toEqual({
      sampleCount: 0,
      totalDialogueChars: 0,
      avgSentenceLength: 0,
      sentenceLengthVariance: 0,
      shortSentenceRate: 0,
      longSentenceRate: 0,
      questionRate: 0,
      exclamationRate: 0,
      interruptionRate: 0,
      ellipsisRate: 0,
      dashRate: 0,
      modalParticles: [],
      catchphraseCandidates: [],
      topTokens: [],
      sentencePatterns: [],
      recentSampleChapterNums: [],
    })
  })

  it('derives sentence patterns and repeated phrases from turns', () => {
    const turns: DialogueTurn[] = [
      { chapterId: 1, chapterNum: 7, text: '闭嘴？' },
      { chapterId: 2, chapterNum: 7, text: '你到底走不走？' },
      { chapterId: 3, chapterNum: 8, text: '闭嘴！' },
      { chapterId: 4, chapterNum: 9, text: '闭嘴……' },
      { chapterId: 5, chapterNum: 9, text: '闭嘴——跟上。' },
      { chapterId: 6, chapterNum: 10, text: '快点啊……！' },
    ]

    const fingerprint = buildFingerprintFromTurns(turns)

    expect(fingerprint.sampleCount).toBe(6)
    expect(fingerprint.shortSentenceRate).toBeGreaterThanOrEqual(55)
    expect(fingerprint.questionRate).toBeGreaterThanOrEqual(30)
    expect(fingerprint.exclamationRate).toBeGreaterThanOrEqual(25)
    expect(fingerprint.ellipsisRate).toBeGreaterThanOrEqual(20)
    expect(fingerprint.sentencePatterns).toContain('短句密集')
    expect(fingerprint.sentencePatterns).toContain('追问反问多')
    expect(fingerprint.sentencePatterns).toContain('情绪外露')
    expect(fingerprint.catchphraseCandidates.some((item) => item.token === '闭嘴')).toBe(true)
    expect(fingerprint.modalParticles.some((item) => item.token === '啊')).toBe(true)
    expect(fingerprint.recentSampleChapterNums).toEqual([7, 8, 9, 10])
  })

  it('returns a stable fallback label when stats are neutral', () => {
    expect(buildSentencePatterns(createFingerprint({
      shortSentenceRate: 20,
      longSentenceRate: 10,
      questionRate: 5,
      exclamationRate: 0,
      interruptionRate: 0,
      ellipsisRate: 0,
      dashRate: 0,
    }))).toEqual(['陈述偏稳'])
  })

  it('requires enough chapter-local dialogue before raising a similarity blocker', () => {
    expect(hasStableChapterDialogueEvidence(createSignature('甲', {
      sampleCount: 3,
      totalDialogueChars: 119,
    }))).toBe(false)
    expect(hasStableChapterDialogueEvidence(createSignature('甲', {
      sampleCount: 4,
      totalDialogueChars: 120,
    }))).toBe(true)
  })

  it('computes high similarity with shared reasons', () => {
    const left = createSignature('甲')
    const right = createSignature('乙', {
      characterId: 2,
      avgSentenceLength: 10,
      shortSentenceRate: 58,
      questionRate: 34,
      exclamationRate: 30,
      modalParticles: [{ token: '啊', count: 5 }],
      catchphraseCandidates: [{ token: '闭嘴', count: 2 }],
      sentencePatterns: ['短句密集', '追问反问多'],
    })

    const similarity = computeSimilarity(left, right)

    expect(similarity.similarity).toBeGreaterThan(80)
    expect(similarity.reasons).toContain('句长节奏接近')
    expect(similarity.reasons.some((reason) => reason.includes('共享语气词：啊'))).toBe(true)
    expect(similarity.reasons.some((reason) => reason.includes('重复短语重合：闭嘴'))).toBe(true)
  })

  it('drops similarity when voice features diverge sharply', () => {
    const left = createSignature('甲')
    const right = createSignature('乙', {
      characterId: 2,
      avgSentenceLength: 28,
      shortSentenceRate: 5,
      longSentenceRate: 80,
      questionRate: 0,
      exclamationRate: 0,
      interruptionRate: 0,
      ellipsisRate: 0,
      dashRate: 0,
      modalParticles: [{ token: '呢', count: 3 }],
      catchphraseCandidates: [{ token: '沉住气', count: 2 }],
      sentencePatterns: ['长句偏多'],
    })

    const similarity = computeSimilarity(left, right)

    expect(similarity.similarity).toBeLessThan(45)
    expect(similarity.reasons).not.toContain('句长节奏接近')
  })
})
