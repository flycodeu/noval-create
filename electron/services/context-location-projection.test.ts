import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSqlite } from '../database/db'
import {
  loadBoundLocationNamesForCharacters,
  selectBoundLocationNames,
  type CharacterLocationSignalRow,
} from './context-location-projection'

vi.mock('../database/db', () => ({ getSqlite: vi.fn() }))

describe('selectBoundLocationNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers active canonical bindings and falls back to recent history', () => {
    const rows: CharacterLocationSignalRow[] = [
      { characterId: 1, locationName: '旧港', startChapterNum: 2, endChapterNum: 4, isCanonical: 1, confidence: 1 },
      { characterId: 1, locationName: '北城门', startChapterNum: 5, isCanonical: 1, confidence: 0.9 },
      { characterId: 2, locationName: '王都', startChapterNum: 1, isCanonical: 0, confidence: 0.8 },
      { characterId: 2, locationName: '王都', startChapterNum: 3, isCanonical: 1, confidence: 0.95 },
    ]

    expect(selectBoundLocationNames(rows, 6, 3)).toEqual(['北城门', '王都', '旧港'])
  })

  it('ignores future bindings, removes duplicates, and keeps the result bounded', () => {
    const rows: CharacterLocationSignalRow[] = [
      { characterId: 1, locationName: '  云州  ', startChapterNum: 1, isCanonical: 1 },
      { characterId: 2, locationName: '云州', startChapterNum: 2, isCanonical: 1 },
      { characterId: 3, locationName: '南驿', startChapterNum: 8, isCanonical: 1 },
      { characterId: 4, locationName: '河谷', startChapterNum: 1, isCanonical: 1 },
    ]

    expect(selectBoundLocationNames(rows, 5, 1)).toEqual(['云州'])
  })

  it('queries only the requested characters and returns a bounded location capsule', () => {
    const all = vi.fn(() => [
      { characterId: 7, locationName: '东境', startChapterNum: 1, isCanonical: 1 },
      { characterId: 9, locationName: '边城', startChapterNum: 8, isCanonical: 1 },
    ])
    const prepare = vi.fn((_sql: string) => ({ all }))
    vi.mocked(getSqlite).mockReturnValue({ prepare } as never)

    expect(loadBoundLocationNamesForCharacters({
      novelId: 12,
      characterIds: [7, 9, 7, -1],
      chapterNum: 10,
      limit: 1,
    })).toEqual(['边城'])
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare.mock.calls[0]?.[0]).toContain('ORDER BY')
    expect(all).toHaveBeenCalledWith(12, 7, 9, 10, 10, 8)
  })
})
