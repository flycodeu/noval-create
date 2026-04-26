import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { analyzeExpressionDedupForGeneration } from './expression-dedup.service'
import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'

function createTableAwareDbMock(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            all: () => rowsByTable.get(table) || [],
          }),
          all: () => rowsByTable.get(table) || [],
        }),
        orderBy: () => ({
          all: () => rowsByTable.get(table) || [],
        }),
        all: () => rowsByTable.get(table) || [],
      }),
    }),
  }
}

function createClimaxLikeContent(opening: string, repeatedPhrase: string, closing: string) {
  return [
    `${opening}，风从墙缝里挤进来，把每个人的呼吸都压得发涩，像下一秒就会有人先失手。`,
    `${repeatedPhrase}。`,
    '他没有解释，只把刀背往掌心压了一寸。',
    `${closing}。`,
    '快。',
    '更快。',
  ].join('')
}

describe('expression-dedup.service', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
  })

  it('switches to longform windows and surfaces opening/closing/climax recurrence', () => {
    const chapterRows = Array.from({ length: 60 }, (_, index) => {
      const chapterNum = index + 1
      const volumeId = chapterNum <= 30 ? 1 : 2
      const repeated = chapterNum % 10 === 8 || chapterNum % 10 === 0
      return {
        id: chapterNum,
        novelId: 1,
        volumeId,
        chapterNum,
        outline: repeated ? '高潮对撞' : '常规推进',
        emotionTone: repeated ? '高潮' : '平稳',
        content: repeated
          ? createClimaxLikeContent('夜色沉沉压在城墙上', '空气似乎凝固了', '门外忽然传来脚步声')
          : `第${chapterNum}章的推进以动作和对白为主，没有重复短句。`,
      }
    })

    vi.mocked(getDb).mockReturnValue(createTableAwareDbMock(new Map<unknown, unknown[]>([
      [novels, [{ id: 1, targetWords: 1000000 }]],
      [chapters, chapterRows],
    ])) as never)

    const report = analyzeExpressionDedupForGeneration(1, 61, { currentVolumeId: 2 })

    expect(report.mode).toBe('longform')
    expect(report.recentWindowSize).toBeGreaterThan(10)
    expect(report.volumeWindowSize).toBeGreaterThan(report.recentWindowSize)
    expect(report.globalSampleWindowSize).toBeGreaterThan(report.volumeWindowSize)
    expect(report.bannedExpressions).toContain('空气似乎凝固了')
    expect(report.repeatedOpenings.length).toBeGreaterThan(0)
    expect(report.repeatedClosings.length).toBeGreaterThan(0)
    expect(report.repeatedClimaxPatterns).toContain('长句蓄力后短句爆发')
    expect(report.guidance.some((item) => item.includes('章首起手偏同质'))).toBe(true)
    expect(report.guidance.some((item) => item.includes('高潮结构近章/卷内复用偏高'))).toBe(true)
  })

  it('keeps short-mode behavior for smaller novels and includes the current chapter when requested', () => {
    const chapterRows = [
      {
        id: 1,
        novelId: 2,
        volumeId: 1,
        chapterNum: 1,
        outline: '起步',
        emotionTone: '平稳',
        content: '街口有风，他把旧信塞进口袋。',
      },
      {
        id: 2,
        novelId: 2,
        volumeId: 1,
        chapterNum: 2,
        outline: '推进',
        emotionTone: '平稳',
        content: '他抬手按住门框。空气似乎凝固了。屋里没有人说话。',
      },
      {
        id: 3,
        novelId: 2,
        volumeId: 1,
        chapterNum: 3,
        outline: '推进',
        emotionTone: '平稳',
        content: '他抬手按住门框。空气似乎凝固了。桌上的茶已经冷了。',
      },
    ]

    vi.mocked(getDb).mockReturnValue(createTableAwareDbMock(new Map<unknown, unknown[]>([
      [novels, [{ id: 2, targetWords: 120000 }]],
      [chapters, chapterRows],
    ])) as never)

    const report = analyzeExpressionDedupForGeneration(2, 3, {
      currentVolumeId: 1,
      includeCurrent: true,
    })

    expect(report.mode).toBe('short')
    expect(report.recentWindowSize).toBe(10)
    expect(report.bannedExpressions).toContain('空气似乎凝固了')
    expect(report.summary).toContain('最近')
  })
})
