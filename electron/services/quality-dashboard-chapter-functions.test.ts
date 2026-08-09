import { describe, expect, it } from 'vitest'
import type { ChapterFunctionTag } from '../../src/types'
import {
  buildBookFunctionSkewAlert,
  buildChapterFunctionDiagnostics,
  buildRepeatedFunctionAlerts,
  buildVolumeFunctionSkewAlert,
  collectChapterFunctionRuns,
  parseChapterFunction,
  sortChapterFunctionAlerts,
  type ChapterFunctionChapterRecord,
} from './quality-dashboard-chapter-functions'

function createChapter(
  chapterNum: number,
  primaryTag?: ChapterFunctionTag,
  overrides: Partial<ChapterFunctionChapterRecord> = {},
): ChapterFunctionChapterRecord {
  return {
    chapterId: chapterNum,
    chapterNum,
    title: `第${chapterNum}章`,
    primaryTag,
    tags: primaryTag ? [primaryTag] : [],
    reversalMarker: false,
    ...overrides,
  }
}

describe('quality dashboard chapter functions', () => {
  it('normalizes primary and secondary tags without retaining unused parse metadata', () => {
    expect(parseChapterFunction(JSON.stringify({
      chapter_function_primary: 'climax',
      chapter_function_tags: ['setup', 'climax', 'setup', 'invalid'],
    }))).toEqual({
      primaryTag: 'climax',
      tags: ['setup', 'climax'],
    })
    expect(parseChapterFunction(JSON.stringify({
      chapter_function_primary: 'invalid',
      chapter_function_tags: ['payoff', 'closure'],
    }))).toEqual({
      primaryTag: 'payoff',
      tags: ['payoff', 'closure'],
    })
    expect(parseChapterFunction('{bad json')).toEqual({
      primaryTag: undefined,
      tags: [],
    })
  })

  it('collects only contiguous repeated runs in chapter order', () => {
    const runs = collectChapterFunctionRuns([
      createChapter(8, 'setup'),
      createChapter(3, 'progression'),
      createChapter(1, 'progression'),
      createChapter(7, 'setup'),
      createChapter(2, 'progression'),
      createChapter(5, 'progression'),
      createChapter(6),
      createChapter(9, 'setup'),
    ])

    expect(runs).toEqual([
      {
        primaryTag: 'progression',
        startChapterNum: 1,
        endChapterNum: 3,
        length: 3,
        chapterNums: [1, 2, 3],
      },
      {
        primaryTag: 'setup',
        startChapterNum: 7,
        endChapterNum: 9,
        length: 3,
        chapterNums: [7, 8, 9],
      },
    ])
  })

  it('computes counts, coverage, dominant share, weak key chapters, and rhythm score once', () => {
    const diagnostics = buildChapterFunctionDiagnostics([
      createChapter(5),
      createChapter(4, 'setup', { paceMarker: 'climax' }),
      createChapter(3, 'progression'),
      createChapter(2, 'progression'),
      createChapter(1, 'progression', { tags: ['progression', 'setup', 'setup'] }),
    ], 5)

    expect(diagnostics.summary).toEqual({
      trackedChapterCount: 4,
      chapterPurposeCoverage: 80,
      rhythmBalanceScore: 40,
      repeatedFunctionRunCount: 1,
      longestRepeatedFunctionRun: 3,
      dominantTag: 'progression',
      dominantTagShare: 75,
      tagCounts: {
        setup: 2,
        progression: 3,
        reversal: 0,
        payoff: 0,
        breather: 0,
        climax: 0,
        exposition: 0,
        closure: 0,
      },
    })
    expect(diagnostics.repeatedRuns[0]?.chapterNums).toEqual([1, 2, 3])
    expect(diagnostics.weakKeyAlerts).toEqual([expect.objectContaining({
      code: 'weak_key_chapter_function',
      chapterNums: [4],
      primaryTag: 'setup',
    })])
  })

  it('keeps the existing lexical tie-break for equal dominant counts', () => {
    const diagnostics = buildChapterFunctionDiagnostics([
      createChapter(1, 'setup'),
      createChapter(2, 'progression'),
    ], 2)

    expect(diagnostics.summary.dominantTag).toBe('progression')
    expect(diagnostics.summary.dominantTagShare).toBe(50)
  })

  it('raises repeated-run severity at five chapters', () => {
    const warning = buildRepeatedFunctionAlerts([
      {
        primaryTag: 'setup',
        startChapterNum: 1,
        endChapterNum: 3,
        length: 3,
        chapterNums: [1, 2, 3],
      },
    ])
    const blocker = buildRepeatedFunctionAlerts([
      {
        primaryTag: 'progression',
        startChapterNum: 4,
        endChapterNum: 8,
        length: 5,
        chapterNums: [4, 5, 6, 7, 8],
      },
    ])

    expect(warning[0]?.severity).toBe('warning')
    expect(blocker[0]?.severity).toBe('blocker')
  })

  it('applies warning and blocker thresholds to volume and whole-book skew', () => {
    expect(buildVolumeFunctionSkewAlert({
      volumeId: 2,
      volumeName: '北线卷',
      chapterStart: 10,
      chapterEnd: 20,
      dominantTag: 'setup',
      dominantTagShare: 60,
    })[0]).toMatchObject({
      severity: 'warning',
      chapterNums: [10, 20],
      volumeId: 2,
    })
    expect(buildBookFunctionSkewAlert({
      trackedChapterCount: 5,
      chapterPurposeCoverage: 100,
      rhythmBalanceScore: 30,
      repeatedFunctionRunCount: 1,
      longestRepeatedFunctionRun: 5,
      dominantTag: 'progression',
      dominantTagShare: 80,
      tagCounts: {
        setup: 0,
        progression: 5,
        reversal: 0,
        payoff: 0,
        breather: 0,
        climax: 0,
        exposition: 0,
        closure: 0,
      },
    }, [9, 3, 7])[0]).toMatchObject({
      severity: 'blocker',
      chapterNums: [3, 9],
      primaryTag: 'progression',
    })
  })

  it('sorts blocker alerts first, then newer chapter ranges', () => {
    const alerts = [
      buildRepeatedFunctionAlerts([{
        primaryTag: 'setup',
        startChapterNum: 20,
        endChapterNum: 22,
        length: 3,
        chapterNums: [20, 21, 22],
      }])[0],
      buildRepeatedFunctionAlerts([{
        primaryTag: 'progression',
        startChapterNum: 1,
        endChapterNum: 5,
        length: 5,
        chapterNums: [1, 2, 3, 4, 5],
      }])[0],
      buildRepeatedFunctionAlerts([{
        primaryTag: 'closure',
        startChapterNum: 10,
        endChapterNum: 12,
        length: 3,
        chapterNums: [10, 11, 12],
      }])[0],
    ].sort(sortChapterFunctionAlerts)

    expect(alerts.map((alert) => alert.chapterNums.at(-1))).toEqual([5, 22, 12])
  })
})
