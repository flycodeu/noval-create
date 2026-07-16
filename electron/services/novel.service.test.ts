import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', async () => {
  const actual = await vi.importActual<typeof import('../database/db')>('../database/db')
  return {
    ...actual,
    getDb: vi.fn(),
    getSqlite: vi.fn(),
  }
})

vi.mock('./asset-impact.service', () => ({
  recordAssetChangeEvent: vi.fn(),
}))

vi.mock('./context-impact.service', () => ({
  getNovelContextStatus: vi.fn(),
  markNovelContextChanged: vi.fn(),
}))

import { getDb, getSqlite } from '../database/db'
import { chapters, genres, novels } from '../database/schema'
import { recordAssetChangeEvent } from './asset-impact.service'
import { markNovelContextChanged } from './context-impact.service'
import { createNovel, deleteNovel, getNovel, updateNovel } from './novel.service'

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

function createSqliteDeleteMock(tables: Record<string, Array<Record<string, unknown>>>) {
  const tableInfoCalls: string[] = []
  const deleteCalls: string[] = []

  const sqlite = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return {
          all: vi.fn(() => Object.keys(tables).map((name) => ({ name }))),
        }
      }

      if (sql.startsWith('PRAGMA table_info')) {
        const tableName = sql.match(/"([^"]+)"/)?.[1] || ''
        tableInfoCalls.push(tableName)
        return {
          all: vi.fn(() => Object.keys(tables[tableName]?.[0] || {}).map((name) => ({ name }))),
        }
      }

      if (sql.startsWith('DELETE FROM')) {
        deleteCalls.push(sql)
        return {
          run: vi.fn((novelId: number) => {
            const tableName = sql.match(/DELETE FROM "([^"]+)"/)?.[1] || sql.match(/DELETE FROM ([^ ]+)/)?.[1] || ''
            const rows = tables[tableName] || []
            const before = rows.length

            if (sql.includes('run_id IN') && tables.chapter_writeback_runs) {
              const runIds = new Set(tables.chapter_writeback_runs
                .filter((row) => row.novel_id === novelId)
                .map((row) => row.id))
              tables[tableName] = rows.filter((row) => !runIds.has(row.run_id))
            } else if (sql.includes('snapshot_id IN') && tables.chapter_batch_snapshots) {
              const snapshotIds = new Set(tables.chapter_batch_snapshots
                .filter((row) => row.novel_id === novelId)
                .map((row) => row.id))
              tables[tableName] = rows.filter((row) => !snapshotIds.has(row.snapshot_id))
            } else if (sql.includes('WHERE novel_id = ?')) {
              tables[tableName] = rows.filter((row) => row.novel_id !== novelId)
            } else if (sql.includes('WHERE id = ?')) {
              tables[tableName] = rows.filter((row) => row.id !== novelId)
            }

            return { changes: before - (tables[tableName] || []).length }
          }),
        }
      }

      throw new Error(`Unexpected SQL in sqlite mock: ${sql}`)
    }),
    transaction: vi.fn((callback: () => void) => {
      return () => callback()
    }),
    __tableInfoCalls: tableInfoCalls,
    __deleteCalls: deleteCalls,
  }

  return sqlite
}

describe('novel source/canon fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.mocked(getDb).mockReset()
    vi.mocked(getSqlite).mockReset()
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

  it('keeps a manually selected project status when the project is reloaded', () => {
    const rows = createRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const novelId = createNovel({ title: '手动生命周期测试' })
    updateNovel(novelId, { status: 'completed' })

    const loaded = getNovel(novelId)
    const stored = (rows.get(novels) || []).find((row) => Number(row.id) === novelId)

    expect(loaded?.status).toBe('completed')
    expect(loaded?.lifecycle).toMatchObject({
      status: 'completed',
      automatic: false,
    })
    expect(stored?.lifecycleMode).toBe('manual')
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

  it('deletes a novel together with novel-scoped rows that are not guaranteed by foreign keys', () => {
    const rows = {
      novels: [{ id: 7, title: '待删除' }, { id: 8, title: '保留' }],
      tasks: [{ id: 1, novel_id: 7 }, { id: 2, novel_id: 8 }],
      character_relations: [{ id: 3, novel_id: 7 }, { id: 4, novel_id: 8 }],
      chapter_writeback_runs: [{ id: 5, novel_id: 7 }, { id: 6, novel_id: 8 }],
      chapter_fact_extracts: [{ id: 7, run_id: 5 }, { id: 8, run_id: 6 }],
      chapter_writeback_diffs: [{ id: 9, run_id: 5 }, { id: 10, run_id: 6 }],
      chapter_batch_snapshots: [{ id: 11, novel_id: 7 }, { id: 12, novel_id: 8 }],
      chapter_batch_inspections: [{ id: 13, snapshot_id: 11 }, { id: 14, snapshot_id: 12 }],
      chapter_batch_rollbacks: [{ id: 15, snapshot_id: 11 }, { id: 16, snapshot_id: 12 }],
    }
    const sqlite = createSqliteDeleteMock(rows)
    vi.mocked(getSqlite).mockReturnValue(sqlite as never)

    deleteNovel(7)

    expect(sqlite.transaction).toHaveBeenCalledTimes(1)
    expect(rows.novels).toEqual([{ id: 8, title: '保留' }])
    expect(rows.tasks).toEqual([{ id: 2, novel_id: 8 }])
    expect(rows.character_relations).toEqual([{ id: 4, novel_id: 8 }])
    expect(rows.chapter_fact_extracts).toEqual([{ id: 8, run_id: 6 }])
    expect(rows.chapter_writeback_diffs).toEqual([{ id: 10, run_id: 6 }])
    expect(rows.chapter_batch_inspections).toEqual([{ id: 14, snapshot_id: 12 }])
    expect(rows.chapter_batch_rollbacks).toEqual([{ id: 16, snapshot_id: 12 }])
    expect(sqlite.__deleteCalls.at(-1)).toBe('DELETE FROM novels WHERE id = ?')
  })
})
