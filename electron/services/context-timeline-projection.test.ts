import { describe, expect, it, vi } from 'vitest'
import { loadTimelineContextEventIds } from './context-timeline-projection'

describe('timeline context projection', () => {
  it('selects bounded past, current-arc, and near-future candidates in SQLite', () => {
    const queries: string[] = []
    const params: unknown[][] = []
    const responses = [
      [
        { id: 11, timeSortValue: 1, sortOrder: 1 },
        { id: 12, timeSortValue: 2, sortOrder: 2 },
        { id: 13, timeSortValue: 3, sortOrder: 3 },
      ],
      [
        { id: 14, timeSortValue: 4, sortOrder: 4 },
        { id: 15, timeSortValue: 5, sortOrder: 5 },
      ],
      [
        { id: 16, timeSortValue: 6, sortOrder: 6 },
        { id: 17, timeSortValue: 7, sortOrder: 7 },
      ],
    ]
    const sqlite = {
      prepare: vi.fn((query: string) => {
        const queryIndex = queries.length
        queries.push(query)
        return {
          all: (...values: unknown[]) => {
            params.push(values)
            return responses[queryIndex]
          },
        }
      }),
    }

    const ids = loadTimelineContextEventIds(sqlite as never, 7, 2400, 18)

    expect(ids).toEqual([12, 13, 14, 15, 16, 17])
    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain('LEFT JOIN chapters AS start_chapter')
    expect(queries[0]).toContain('LEFT JOIN chapters AS end_chapter')
    expect(queries[0]).toContain("event.status IN ('written', 'resolved')")
    expect(queries[0]).toContain('LIMIT 4')
    expect(queries[1]).toContain('event.arc_id = ?')
    expect(queries[1]).toContain('LIMIT 3')
    expect(queries[2]).toContain('LEFT JOIN chapters AS end_chapter')
    expect(queries[2]).toContain("event.status IN ('planned', 'seeded')")
    expect(queries[2]).toContain('LIMIT 3')
    expect(params).toEqual([
      [7, 2400, 2400],
      [7, 18],
      [7, 2400, 2403],
    ])
  })

  it('disables the current-arc branch when no arc is active', () => {
    const params: unknown[][] = []
    let queryIndex = 0
    const sqlite = {
      prepare: () => ({
        all: (...values: unknown[]) => {
          params.push(values)
          queryIndex += 1
          return queryIndex === 1
            ? [{ id: 9, timeSortValue: 1 }, { id: null }, { id: -1 }]
            : []
        },
      }),
    }

    expect(loadTimelineContextEventIds(sqlite as never, 3, 20)).toEqual([9])
    expect(params).toEqual([
      [3, 20, 20],
      [3, 20, 23],
    ])
  })
})
