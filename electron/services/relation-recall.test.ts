import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  loadRelationRecallSources,
  resolveRelationRecallInput,
} from './relation-recall'

type QueryResolver = (sql: string, params: unknown[], mode: 'all' | 'get') => unknown

function sqliteStub(resolve: QueryResolver): Database.Database {
  return {
    prepare(sql: string) {
      return {
        all: (...params: unknown[]) => resolve(sql, params, 'all'),
        get: (...params: unknown[]) => resolve(sql, params, 'get'),
      }
    },
  } as unknown as Database.Database
}

function emptyRows(sql: string): unknown[] {
  if (sql.includes('FROM story_threads')) return []
  if (sql.includes('FROM timeline_events')) return []
  return []
}

describe('deterministic relation recall', () => {
  it('13-01: recalls a chapter-3 foreshadow required by chapter 200 without lexical search', () => {
    const sqlite = sqliteStub((sql) => {
      if (sql.includes('FROM foreshadow_ledger')) return [{
        id: 91,
        title: '旧钥匙的齿痕',
        detail: '第三章埋下的钥匙必须开门',
        targetPayoffChapter: 200,
        payoffMethod: '打开密室',
        sourceChapterNum: 3,
        updatedAt: '2026-09-09 00:00:00',
      }]
      return emptyRows(sql)
    })
    const result = loadRelationRecallSources(sqlite, {
      novelId: 1,
      chapterNum: 200,
      seedEntityIds: [],
      explicitContractRefs: [{ type: 'foreshadow', id: 91 }],
    })

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      sourceKey: 'contract:foreshadow:91',
      required: true,
      reason: 'explicit_contract',
    })
    expect(result.sources[0].summary).toContain('来源=第3章')
    expect(result.sources[0].sourceVersion).toMatch(/^2026-09-09 00:00:00:/)
  })

  it('13-02/13-03: follows owner and character relations for one hop only', () => {
    const sqlite = sqliteStub((sql, params) => {
      if (sql.includes('SELECT id FROM characters')) return [{ id: Number(params[1]) }]
      if (sql.includes('FROM character_relations AS relation')) return [
        { id: 10, charAId: 1, charBId: 2, charAName: 'A', charBName: 'B', relationLabel: '盟友' },
        { id: 12, charAId: 3, charBId: 1, charAName: 'C', charBName: 'A', relationLabel: '对手' },
      ]
      if (sql.includes('owner_character_id IN')) return [{
        id: 20, itemName: 'I', ownerCharacterId: 1, status: 'available', summary: '旧怀表', updatedAt: 'v1',
      }]
      return emptyRows(sql)
    })
    const result = loadRelationRecallSources(sqlite, {
      novelId: 1,
      chapterNum: 50,
      seedEntityIds: [{ type: 'character', id: 1 }],
      explicitContractRefs: [],
    })

    expect(result.sources.map((source) => source.sourceKey)).toEqual([
      'asset:character_relation:10',
      'asset:character_relation:12',
      'asset:item:20',
    ])
    expect(result.sources.find((source) => source.sourceKey === 'asset:item:20')).toMatchObject({
      reason: 'owner_relation',
      required: false,
    })
  })

  it('13-04: keeps required sources while applying stable optional limits', () => {
    const sqlite = sqliteStub((sql, params) => {
      if (sql.includes('SELECT id FROM characters')) return [{ id: Number(params[1]) }]
      if (sql.includes('FROM foreshadow_ledger')) return [{
        id: 91, title: '必收伏笔', targetPayoffChapter: 200, sourceChapterNum: 3, updatedAt: 'v1',
      }]
      if (sql.includes('FROM character_relations AS relation')) {
        return Array.from({ length: 30 }, (_, index) => ({
          id: index + 1,
          charAId: 1,
          charBId: index + 2,
          charAName: 'A',
          charBName: `B${index + 1}`,
          relationLabel: '关联',
        }))
      }
      if (sql.includes('owner_character_id IN')) return []
      return emptyRows(sql)
    })
    const result = loadRelationRecallSources(sqlite, {
      novelId: 1,
      chapterNum: 200,
      seedEntityIds: [{ type: 'character', id: 1 }],
      explicitContractRefs: [{ type: 'foreshadow', id: 91 }],
      optionalPerKindLimit: 8,
      optionalTotalLimit: 24,
    })

    expect(result.sources.filter((source) => source.optionalKind === 'relation')).toHaveLength(8)
    expect(result.sources[0]).toMatchObject({ sourceKey: 'contract:foreshadow:91', required: true })
    expect(result.diagnostics.filter((item) => item.code === 'candidate_limit')).toHaveLength(22)
  })

  it('13-06: rejects ambiguous names, foreign IDs, and future events', () => {
    const resolvingDb = sqliteStub((sql, _params, mode) => {
      if (sql.includes('FROM chapters')) return mode === 'get' ? undefined : []
      if (sql.includes('FROM characters')) return [
        { id: 1, primaryName: '掌柜', alternateName: '' },
        { id: 2, primaryName: '掌柜', alternateName: '' },
      ]
      return []
    })
    const resolved = resolveRelationRecallInput(resolvingDb, {
      novelId: 1,
      chapterNum: 20,
      mentionedCharacters: ['掌柜'],
    })
    expect(resolved.seedEntityIds).toEqual([])
    expect(resolved.diagnostics).toContainEqual({ code: 'ambiguous_name', reference: 'character:掌柜' })

    const loadingDb = sqliteStub((sql) => {
      if (sql.includes('SELECT id FROM characters')) return []
      if (sql.includes('SELECT id FROM timeline_events')) return [{ id: 50 }]
      if (sql.includes('FROM timeline_events AS event')) return [{
        id: 50, eventTitle: '未来政变', status: 'confirmed', startChapterNum: 21, anchorInvalid: 0, updatedAt: 'v1',
      }]
      return emptyRows(sql)
    })
    const loaded = loadRelationRecallSources(loadingDb, {
      novelId: 1,
      chapterNum: 20,
      seedEntityIds: [{ type: 'character', id: 999 }],
      explicitContractRefs: [{ type: 'timeline_event', id: 50 }],
    })
    expect(loaded.sources).toEqual([])
    expect(loaded.diagnostics).toEqual(expect.arrayContaining([
      { code: 'foreign_entity', reference: 'character:999' },
      { code: 'future_source', reference: 'timeline_event:50:chapter:21' },
    ]))
  })
})

