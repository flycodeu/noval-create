import { describe, expect, it } from 'vitest'
import {
  GENRE_VOICE_FINGERPRINT_SEEDS,
  selectGenreVoiceSeedInserts,
} from './genre-voice-seeds'

const ALL_GENRES = [
  { id: 1, name: '现代都市' },
  { id: 2, name: '古代言情' },
  { id: 3, name: '玄幻修真' },
  { id: 4, name: '悬疑推理' },
  { id: 9, name: '历史正剧' },
]

describe('genre voice fingerprint seeds', () => {
  it('provides exactly the four head genre seeds with sane fingerprints', () => {
    expect(GENRE_VOICE_FINGERPRINT_SEEDS).toHaveLength(4)
    expect(GENRE_VOICE_FINGERPRINT_SEEDS.map((seed) => seed.genreName)).toEqual([
      '玄幻修真',
      '历史正剧',
      '现代都市',
      '悬疑推理',
    ])
    for (const seed of GENRE_VOICE_FINGERPRINT_SEEDS) {
      expect(seed.fingerprint.avgSentenceLength).toBeGreaterThan(0)
      expect(seed.fingerprint.avgParagraphLength).toBeGreaterThan(0)
      expect(seed.fingerprint.dialogueLineRate).toBeGreaterThanOrEqual(0)
      expect(seed.fingerprint.dialogueLineRate).toBeLessThanOrEqual(100)
      // No fabricated reference prose in genre defaults.
      expect(seed.fingerprint.exampleExcerpts).toEqual([])
      expect(seed.fingerprint.forbiddenPatterns.length).toBeGreaterThan(0)
    }
  })

  it('keeps genre voice expectations directionally distinct', () => {
    const byGenre = new Map(GENRE_VOICE_FINGERPRINT_SEEDS.map((seed) => [seed.genreName, seed.fingerprint]))
    const shuangwen = byGenre.get('玄幻修真')!
    const history = byGenre.get('历史正剧')!
    // 爽文：短句 + 高对白比；历史正剧：长句 + 低对白比。
    expect(shuangwen.avgSentenceLength).toBeLessThan(history.avgSentenceLength)
    expect(shuangwen.dialogueLineRate).toBeGreaterThan(history.dialogueLineRate)
  })

  it('matches seeds to genre ids by name and skips unmatched genres', () => {
    const inserts = selectGenreVoiceSeedInserts(ALL_GENRES, [])
    expect(inserts).toHaveLength(4)
    expect(inserts.find((item) => item.name.includes('玄幻爽文'))?.genreId).toBe(3)
    expect(inserts.find((item) => item.name.includes('历史正剧'))?.genreId).toBe(9)

    const partial = selectGenreVoiceSeedInserts([{ id: 4, name: '悬疑推理' }], [])
    expect(partial).toHaveLength(1)
    expect(partial[0].genreId).toBe(4)
  })

  it('is idempotent: a second seed run plans zero inserts', () => {
    const firstRun = selectGenreVoiceSeedInserts(ALL_GENRES, [])
    expect(firstRun).toHaveLength(4)

    const secondRun = selectGenreVoiceSeedInserts(ALL_GENRES, firstRun.map((item) => item.name))
    expect(secondRun).toEqual([])
  })

  it('only skips seeds that already exist, inserting the missing remainder', () => {
    const existing = ['题材默认 · 玄幻爽文声线']
    const inserts = selectGenreVoiceSeedInserts(ALL_GENRES, existing)
    expect(inserts).toHaveLength(3)
    expect(inserts.every((item) => item.name !== existing[0])).toBe(true)
  })
})
