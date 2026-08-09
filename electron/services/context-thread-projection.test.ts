import { describe, expect, it, vi } from 'vitest'
import { loadChapterThreadContextProjection } from './context-thread-projection'

describe('chapter thread context projection', () => {
  it('issues bounded category queries and keeps scalar pressure counting separate', () => {
    const queries: string[] = []
    const allParams: unknown[][] = []
    const getParams: unknown[][] = []
    const allResponses = [
      [{ id: 11 }, { id: 12 }, { id: 13 }],
      [{ id: 19 }],
      [{ id: 31, linkedThreadId: 21 }, { id: 32, linkedThreadId: null }],
      [{ id: 41 }, { id: 42 }],
      [{ id: 51 }],
    ]
    let allIndex = 0
    const sqlite = {
      prepare: vi.fn((query: string) => {
        queries.push(query)
        return {
          all: (...params: unknown[]) => {
            allParams.push(params)
            const response = allResponses[allIndex] || []
            allIndex += 1
            return response
          },
          get: (...params: unknown[]) => {
            getParams.push(params)
            return { pressureCount: 7 }
          },
        }
      }),
    }

    const projection = loadChapterThreadContextProjection(sqlite as never, {
      novelId: 5,
      chapterNum: 120,
      dueLimit: 4,
      currentArc: {
        chapterStart: 101,
        chapterEnd: 140,
      },
    })

    expect(projection).toEqual({
      activeThreadIds: [11, 12, 13, 19],
      dueThreadIds: [41, 42],
      foreshadowLinkedThreadIds: [21],
      dueForeshadowIds: [31, 32],
      staleForeshadowIds: [51],
      pressureCount: 7,
    })
    expect(queries).toHaveLength(6)
    expect(queries[0]).toContain('LIMIT 3')
    expect(queries[1]).toContain("thread.thread_type = 'main'")
    expect(queries[1]).toContain('LIMIT 1')
    expect(queries[2]).toContain("ledger.status NOT IN ('resolved', 'archived')")
    expect(queries[2]).toContain('LIMIT ?')
    expect(queries[3]).toContain('NOT EXISTS')
    expect(queries[3]).toContain('LIMIT ?')
    expect(queries[4]).toContain('INNER JOIN chapters AS source_chapter')
    expect(queries[4]).toContain('LIMIT 2')
    expect(queries[5]).toContain('SELECT COUNT(*) AS pressureCount')
    expect(allParams).toEqual([
      [5, 140, 101, 120],
      [5, 140, 101, 120],
      [5, 123, 120, 140, 101, 120, 4],
      [5, 123, 120, 140, 101, 120, 4],
      [5, 80],
    ])
    expect(getParams).toEqual([
      [120, 5, 120, 120, 120, 120],
    ])
  })

  it('drops invalid IDs and omits arc placeholders without a bounded arc', () => {
    const allParams: unknown[][] = []
    const responses = [
      [{ id: 7 }, { id: 7 }, { id: 0 }],
      [{ id: null }],
      [{ id: 8, linkedThreadId: -1 }],
      [],
      [],
    ]
    let index = 0
    const sqlite = {
      prepare: () => ({
        all: (...params: unknown[]) => {
          allParams.push(params)
          const response = responses[index] || []
          index += 1
          return response
        },
        get: () => ({ pressureCount: null }),
      }),
    }

    const projection = loadChapterThreadContextProjection(sqlite as never, {
      novelId: 2,
      chapterNum: 10,
      dueLimit: 2,
    })

    expect(projection.activeThreadIds).toEqual([7])
    expect(projection.dueForeshadowIds).toEqual([8])
    expect(projection.foreshadowLinkedThreadIds).toEqual([])
    expect(projection.pressureCount).toBe(0)
    expect(allParams[0]).toEqual([2, 10])
    expect(allParams[2]).toEqual([2, 13, 10, 10, 2])
  })
})
