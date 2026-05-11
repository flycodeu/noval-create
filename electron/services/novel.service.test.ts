import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', async () => {
  const actual = await vi.importActual<typeof import('../database/db')>('../database/db')
  return {
    ...actual,
    getDb: vi.fn(),
  }
})

vi.mock('./asset-impact.service', () => ({
  recordAssetChangeEvent: vi.fn(),
}))

vi.mock('./context-impact.service', () => ({
  getNovelContextStatus: vi.fn(),
  markNovelContextChanged: vi.fn(),
}))

import { getDb } from '../database/db'
import { chapters, genres, novels } from '../database/schema'
import { recordAssetChangeEvent } from './asset-impact.service'
import { markNovelContextChanged } from './context-impact.service'
import { createNovel, getNovel, updateNovel } from './novel.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())
}

function matchesWhereClause(row: Record<string, unknown>, condition: any): boolean {
  const chunks = Array.isArray(condition?.queryChunks) ? condition.queryChunks : []
  const columnName = typeof chunks[1]?.name === 'string' ? chunks[1].name : ''
  const value = chunks[3]?.value
  if (!columnName) return true

  const rowKey = columnName in row ? columnName : toCamelCase(columnName)
  return row[rowKey] === value
}

function createQuery(
  rowsByTable: TableRows,
  table: unknown,
  conditions: any[] = [],
  joinedTable?: unknown,
) {
  const query: {
    where: (condition: any) => typeof query
    orderBy: () => typeof query
    leftJoin: (table: unknown) => typeof query
    all: () => Array<Record<string, unknown>>
  } = {
    where: (condition: any) => createQuery(rowsByTable, table, [...conditions, condition], joinedTable),
    orderBy: () => query,
    leftJoin: (nextJoinedTable: unknown) => createQuery(rowsByTable, table, conditions, nextJoinedTable),
    all: () => {
      const baseRows = (rowsByTable.get(table) || []).filter((row) => conditions.every((condition) => matchesWhereClause(row, condition)))
      if (table !== novels || joinedTable !== genres) return baseRows

      const genreRows = rowsByTable.get(genres) || []
      return baseRows.map((row) => {
        const genreRow = genreRows.find((genre) => Number(genre.id) === Number(row.genreId))
        return {
          ...row,
          genreName: typeof genreRow?.name === 'string' ? genreRow.name : undefined,
          genreColorTag: typeof genreRow?.colorTag === 'string' ? genreRow.colorTag : undefined,
        }
      })
    },
  }
  return query
}

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => createQuery(rowsByTable, table)),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((payload: Record<string, unknown>) => ({
        run: vi.fn(() => {
          const rows = rowsByTable.get(table) || []
          const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
          rows.push({ id: nextId, ...payload })
          rowsByTable.set(table, rows)
          return { lastInsertRowid: nextId }
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn((condition: any) => ({
          run: vi.fn(() => {
            const rows = rowsByTable.get(table) || []
            rows
              .filter((row) => matchesWhereClause(row, condition))
              .forEach((row) => Object.assign(row, patch))
            return { changes: rows.filter((row) => matchesWhereClause(row, condition)).length }
          }),
        })),
      })),
    })),
  }
}

function createRows(): TableRows {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [novels, []],
    [genres, [{
      id: 2,
      name: '历史正剧',
      colorTag: 'gold',
    }]],
    [chapters, []],
  ])
}

describe('novel source/canon fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.mocked(getDb).mockReset()
  })

  it('declares the new source/canon columns in schema and migration sources', () => {
    const schemaSource = readFileSync(new URL('../database/schema.ts', import.meta.url), 'utf8')
    const dbSource = readFileSync(new URL('../database/db.ts', import.meta.url), 'utf8')

    for (const field of [
      'historical_profile_json',
      'source_ledger_json',
      'chapter_source_usage_json',
      'fact_provenance_json',
      'project_canon_profile_json',
      'canon_constraint_set_json',
      'canon_source_ledger_json',
      'canon_fact_cards_json',
    ]) {
      expect(schemaSource).toContain(field)
      expect(dbSource).toContain(field)
    }

    expect(dbSource).toContain("runMigrationStep(sqlite, '0038_novel_source_canon_fields'")
  })

  it('persists and reads the new source/canon fields through create, update and get', () => {
    const rows = createRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const novelId = createNovel({
      title: '史料归档测试',
      genreId: 2,
      historicalProfileJson: '{"mode":"historical_realist"}',
      sourceLedgerJson: '[{"sourceKey":"user-doc-1"}]',
      chapterSourceUsageJson: '[{"usageKey":"chapter:1"}]',
      factProvenanceJson: '[{"provenanceKey":"run:1:diff:1"}]',
      projectCanonProfileJson: '{"genre":"historical"}',
      canonConstraintSetJson: '{"forbidden":["穿越梗"]}',
      canonSourceLedgerJson: '[{"sourceKey":"canon-doc-1"}]',
      canonFactCardsJson: '[{"cardKey":"fact-1"}]',
    })

    const created = getNovel(novelId)
    expect(created?.historicalProfileJson).toBe('{"mode":"historical_realist"}')
    expect(created?.sourceLedgerJson).toBe('[{"sourceKey":"user-doc-1"}]')
    expect(created?.chapterSourceUsageJson).toBe('[{"usageKey":"chapter:1"}]')
    expect(created?.factProvenanceJson).toBe('[{"provenanceKey":"run:1:diff:1"}]')
    expect(created?.projectCanonProfileJson).toBe('{"genre":"historical"}')
    expect(created?.canonConstraintSetJson).toBe('{"forbidden":["穿越梗"]}')
    expect(created?.canonSourceLedgerJson).toBe('[{"sourceKey":"canon-doc-1"}]')
    expect(created?.canonFactCardsJson).toBe('[{"cardKey":"fact-1"}]')

    updateNovel(novelId, {
      chapterSourceUsageJson: '[{"usageKey":"chapter:5","runId":8}]',
      factProvenanceJson: '[{"provenanceKey":"run:8:diff:2"}]',
      canonFactCardsJson: '[{"cardKey":"fact-2"}]',
    })

    const updated = getNovel(novelId)
    const stored = (rows.get(novels) || []).find((row) => Number(row.id) === novelId)

    expect(updated?.chapterSourceUsageJson).toBe('[{"usageKey":"chapter:5","runId":8}]')
    expect(updated?.factProvenanceJson).toBe('[{"provenanceKey":"run:8:diff:2"}]')
    expect(updated?.canonFactCardsJson).toBe('[{"cardKey":"fact-2"}]')
    expect(stored?.chapterSourceUsageJson).toBe('[{"usageKey":"chapter:5","runId":8}]')
    expect(stored?.factProvenanceJson).toBe('[{"provenanceKey":"run:8:diff:2"}]')
    expect(stored?.canonFactCardsJson).toBe('[{"cardKey":"fact-2"}]')
    expect(vi.mocked(markNovelContextChanged)).toHaveBeenCalledWith(
      novelId,
      expect.arrayContaining(['Historical/source/canon data changed']),
    )
    expect(vi.mocked(recordAssetChangeEvent)).toHaveBeenCalledWith(expect.objectContaining({
      novelId,
      assetType: 'novel',
      operation: 'update',
    }))
  })
})
