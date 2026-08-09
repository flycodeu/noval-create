import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
}))

vi.mock('./story-structure.service', () => ({
  ensureStoryStructure: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  endgameCommitments,
  foreshadowLedger,
  sceneContracts,
} from '../database/schema'
import {
  getChapterContractContext,
  listEndgameCommitmentsByIds,
  listForeshadowLedger,
  listForeshadowLedgerByIds,
} from './endgame-asset.service'
import { ensureStoryStructure } from './story-structure.service'

interface QueryLog {
  table: unknown
  selection: unknown
  limits: number[]
}

function createQueryDb(
  rowsByTable: Map<unknown, unknown[]>,
  queryLogs: QueryLog[],
) {
  return {
    select: (selection?: unknown) => ({
      from: (table: unknown) => {
        const log = { table, selection, limits: [] as number[] }
        queryLogs.push(log)
        const query = {
          where: () => query,
          orderBy: () => query,
          limit: (value: number) => {
            log.limits.push(value)
            return query
          },
          all: () => rowsByTable.get(table) || [],
        }
        return query
      },
    }),
  }
}

describe('foreshadow ledger query scope', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
    vi.mocked(ensureStoryStructure).mockReset()
  })

  it('loads only referenced chapter and commitment labels', () => {
    const queryLogs: QueryLog[] = []
    vi.mocked(getDb).mockReturnValue(createQueryDb(new Map<unknown, unknown[]>([
      [foreshadowLedger, [{
        id: 8,
        novelId: 1,
        title: '旧钥匙',
        sourceChapterId: 21,
        linkedEndgameCommitmentId: 31,
        targetPayoffChapter: 80,
        status: 'active',
      }]],
      [chapters, [{ id: 21, novelId: 1, chapterNum: 12 }]],
      [endgameCommitments, [{ id: 31, novelId: 1, title: '打开终局密室' }]],
    ]), queryLogs) as never)

    const rows = listForeshadowLedger(1)

    expect(rows).toMatchObject([{
      id: 8,
      sourceChapterNum: 12,
      linkedEndgameCommitmentTitle: '打开终局密室',
    }])
    expect(queryLogs.find((entry) => entry.table === chapters)?.limits).toEqual([1])
    expect(queryLogs.find((entry) => entry.table === endgameCommitments)?.limits).toEqual([1])
    expect(ensureStoryStructure).toHaveBeenCalledWith(1)
  })

  it('does not query label tables when ledger rows have no references', () => {
    const queryLogs: QueryLog[] = []
    vi.mocked(getDb).mockReturnValue(createQueryDb(new Map<unknown, unknown[]>([
      [foreshadowLedger, [{
        id: 9,
        novelId: 1,
        title: '无锚点伏笔',
        sourceChapterId: null,
        linkedEndgameCommitmentId: null,
        targetPayoffChapter: null,
        status: 'active',
      }]],
    ]), queryLogs) as never)

    listForeshadowLedger(1)

    expect(queryLogs.some((entry) => entry.table === chapters)).toBe(false)
    expect(queryLogs.some((entry) => entry.table === endgameCommitments)).toBe(false)
  })

  it('bounds ID-scoped ledger reads and skips empty requests', () => {
    const queryLogs: QueryLog[] = []
    vi.mocked(getDb).mockReturnValue(createQueryDb(new Map<unknown, unknown[]>([
      [foreshadowLedger, []],
    ]), queryLogs) as never)

    expect(listForeshadowLedgerByIds(1, [])).toEqual([])
    expect(queryLogs).toEqual([])
    expect(ensureStoryStructure).not.toHaveBeenCalled()

    listForeshadowLedgerByIds(1, [8, 8, -1, 9])

    expect(queryLogs.find((entry) => entry.table === foreshadowLedger)?.limits).toEqual([2])
    expect(ensureStoryStructure).toHaveBeenCalledWith(1)
  })

  it('loads required commitments by ID without derived-state refresh queries', () => {
    const queryLogs: QueryLog[] = []
    vi.mocked(getDb).mockReturnValue(createQueryDb(new Map<unknown, unknown[]>([
      [endgameCommitments, [{
        id: 7,
        novelId: 1,
        commitmentKind: 'promise',
        title: '守住北线',
        sourceOrder: 0,
      }, {
        id: 8,
        novelId: 1,
        commitmentKind: 'payoff',
        title: '打开旧仓库',
        sourceOrder: 1,
      }]],
    ]), queryLogs) as never)

    expect(listEndgameCommitmentsByIds(1, [])).toEqual([])
    expect(queryLogs).toEqual([])
    expect(ensureStoryStructure).not.toHaveBeenCalled()

    const rows = listEndgameCommitmentsByIds(1, [7, 7, -1, 8])

    expect(rows.map((row) => row.id)).toEqual([7, 8])
    expect(queryLogs).toHaveLength(1)
    expect(queryLogs[0].table).toBe(endgameCommitments)
    expect(queryLogs[0].limits).toEqual([2])
    expect(ensureStoryStructure).toHaveBeenCalledWith(1)
  })

  it('skips commitment and foreshadow tables for contracts without required IDs', () => {
    const queryLogs: QueryLog[] = []
    vi.mocked(getDb).mockReturnValue(createQueryDb(new Map<unknown, unknown[]>([
      [chapters, [{
        id: 40,
        novelId: 1,
        chapterNum: 4,
        title: '无终局绑定',
      }]],
      [chapterContracts, [{
        id: 50,
        novelId: 1,
        chapterId: 40,
        requiredEndgameCommitmentIdsJson: '[]',
        requiredForeshadowIdsJson: '[]',
      }]],
      [chapterSegments, []],
      [sceneContracts, []],
    ]), queryLogs) as never)

    const context = getChapterContractContext(40)

    expect(context.requiredCommitments).toEqual([])
    expect(context.requiredForeshadows).toEqual([])
    expect(queryLogs.some((entry) => entry.table === endgameCommitments)).toBe(false)
    expect(queryLogs.some((entry) => entry.table === foreshadowLedger)).toBe(false)
  })

  it('loads only contract-linked commitment and foreshadow rows', () => {
    const queryLogs: QueryLog[] = []
    vi.mocked(getDb).mockReturnValue(createQueryDb(new Map<unknown, unknown[]>([
      [chapters, [{
        id: 40,
        novelId: 1,
        chapterNum: 4,
        title: '终局绑定',
      }]],
      [chapterContracts, [{
        id: 50,
        novelId: 1,
        chapterId: 40,
        requiredEndgameCommitmentIdsJson: '[7]',
        requiredForeshadowIdsJson: '[8]',
      }]],
      [chapterSegments, []],
      [sceneContracts, []],
      [endgameCommitments, [{
        id: 7,
        novelId: 1,
        commitmentKind: 'promise',
        title: '守住北线',
        sourceOrder: 0,
      }]],
      [foreshadowLedger, [{
        id: 8,
        novelId: 1,
        title: '旧钥匙',
        sourceChapterId: null,
        linkedEndgameCommitmentId: null,
      }]],
    ]), queryLogs) as never)

    const context = getChapterContractContext(40)
    const commitmentQuery = queryLogs.find((entry) => entry.table === endgameCommitments)
    const foreshadowQuery = queryLogs.find((entry) => entry.table === foreshadowLedger)

    expect(context.requiredCommitments.map((row) => row.id)).toEqual([7])
    expect(context.requiredForeshadows.map((row) => row.id)).toEqual([8])
    expect(commitmentQuery?.limits).toEqual([1])
    expect(foreshadowQuery?.limits).toEqual([1])
    expect(queryLogs.filter((entry) => entry.table === endgameCommitments)).toHaveLength(1)
  })
})
