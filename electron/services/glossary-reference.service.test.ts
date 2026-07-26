import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))
vi.mock('./glossary.service', () => ({
  listGlossary: vi.fn(),
}))

import { getDb } from '../database/db'
import { listGlossary } from './glossary.service'
import { chapters, characters, glossaryTermReferences, storyItems } from '../database/schema'
import {
  computeGlossaryUsageReport,
  extractCandidateProperNouns,
  matchGlossaryTermsInContent,
  scanChapterForGlossaryTerms,
  suggestMissingTerms,
} from './glossary-reference.service'

interface MockState {
  chapters?: Array<Record<string, unknown>>
  references: Array<Record<string, unknown>>
  characters?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
}

function buildDb(state: MockState) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          all: () => {
            if (table === chapters) return state.chapters || []
            if (table === glossaryTermReferences) return state.references
            if (table === characters) return state.characters || []
            if (table === storyItems) return state.items || []
            return []
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        run: () => {
          state.references.length = 0
        },
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        run: () => {
          state.references.push(row)
        },
      }),
    }),
  }
}

beforeEach(() => {
  vi.mocked(getDb).mockReset()
  vi.mocked(listGlossary).mockReset()
})

describe('matchGlossaryTermsInContent', () => {
  it('term + 别名多词 indexOf 计数，零命中不返回', () => {
    const entries = [
      { id: 1, term: '灰潮', aliasesJson: '["潮汐兽"]' },
      { id: 2, term: '引火石', aliasesJson: '[]' },
      { id: 3, term: '空词条', aliasesJson: null },
    ]
    const content = '灰潮再度逼近，潮汐兽在灰潮前锋嘶吼。他攥紧了引火石。'
    const matches = matchGlossaryTermsInContent(entries, content)
    expect(matches).toEqual([
      { glossaryId: 1, hitCount: 3 },
      { glossaryId: 2, hitCount: 1 },
    ])
  })

  it('单字词与空正文都不产生命中', () => {
    expect(matchGlossaryTermsInContent([{ id: 1, term: '潮', aliasesJson: null }], '潮起潮落')).toEqual([])
    expect(matchGlossaryTermsInContent([{ id: 1, term: '灰潮', aliasesJson: null }], '   ')).toEqual([])
  })
})

describe('scanChapterForGlossaryTerms（按章删插幂等）', () => {
  it('重复扫描同一章不会累积引用行', () => {
    const state: MockState = {
      chapters: [{ id: 10, novelId: 1, chapterNum: 3, content: '灰潮吞没了旧码头，灰潮之后再无归途。' }],
      references: [],
    }
    vi.mocked(getDb).mockReturnValue(buildDb(state) as never)
    vi.mocked(listGlossary).mockReturnValue([
      { id: 1, term: '灰潮', aliasesJson: '[]' },
    ] as never)

    const first = scanChapterForGlossaryTerms(1, 10)
    expect(first).toEqual({ scannedChapters: 1, termCount: 1, matchedTermCount: 1, totalHits: 2 })
    expect(state.references).toEqual([
      { novelId: 1, glossaryId: 1, chapterId: 10, chapterNum: 3, hitCount: 2 },
    ])

    const second = scanChapterForGlossaryTerms(1, 10)
    expect(second).toEqual(first)
    expect(state.references).toHaveLength(1)
  })

  it('章节不存在或不属于该小说时不扫描', () => {
    const state: MockState = { chapters: [{ id: 10, novelId: 2, chapterNum: 1, content: '灰潮' }], references: [] }
    vi.mocked(getDb).mockReturnValue(buildDb(state) as never)
    vi.mocked(listGlossary).mockReturnValue([] as never)
    expect(scanChapterForGlossaryTerms(1, 10).scannedChapters).toBe(0)
    expect(scanChapterForGlossaryTerms(1, 999).scannedChapters).toBe(0)
  })
})

describe('computeGlossaryUsageReport（断代计算）', () => {
  it('计算 totalHits / lastChapterNum / chaptersSinceLastHit / unused', () => {
    const entries = [
      { id: 1, term: '灰潮', category: 'lore' },
      { id: 2, term: '引火石', category: 'material' },
      { id: 3, term: '玄冥殿', category: 'organization' },
    ]
    const references = [
      { glossaryId: 1, chapterNum: 2, hitCount: 3 },
      { glossaryId: 1, chapterNum: 5, hitCount: 1 },
      { glossaryId: 2, chapterNum: 30, hitCount: 2 },
    ]
    const items = computeGlossaryUsageReport(entries, references, 30)

    expect(items[0]).toEqual({
      glossaryId: 1,
      term: '灰潮',
      category: 'lore',
      totalHits: 4,
      chapterCount: 2,
      lastChapterNum: 5,
      chaptersSinceLastHit: 25,
      unused: false,
    })
    expect(items[1].chaptersSinceLastHit).toBe(0)
    expect(items[2]).toMatchObject({
      totalHits: 0,
      lastChapterNum: null,
      chaptersSinceLastHit: null,
      unused: true,
    })
  })
})

describe('extractCandidateProperNouns / suggestMissingTerms', () => {
  const content = [
    '玄冥殿的执事又一次登门，玄冥殿从不空手而来。',
    '他说玄冥殿要的是名册，而不是钱。',
    '赤鳞卫在巷口列队，赤鳞卫的甲片被雨水打湿，赤鳞卫没有人说话。',
    '灰潮的传闻沿着码头蔓延，灰潮，还是灰潮。',
  ].join('\n')

  it('提取高频专名并过滤已知名单', () => {
    const suggestions = extractCandidateProperNouns(content, { knownNames: ['灰潮'] })
    const terms = suggestions.map((item) => item.term)
    expect(terms).toContain('玄冥殿')
    expect(terms).toContain('赤鳞卫')
    expect(terms).not.toContain('灰潮')
  })

  it('限制 top N 且低频词不入选', () => {
    const suggestions = extractCandidateProperNouns(content, { limit: 1 })
    expect(suggestions).toHaveLength(1)
    expect(['玄冥殿', '赤鳞卫', '灰潮']).toContain(suggestions[0].term)
    expect(suggestions[0].count).toBe(3)
    // 只出现一次的组合不应入选
    expect(extractCandidateProperNouns('孤例词组只出现一次。', {})).toEqual([])
  })

  it('suggestMissingTerms 过滤已入词典词条与已建档实体', () => {
    const state: MockState = {
      chapters: [{ id: 7, novelId: 1, chapterNum: 9, content }],
      references: [],
      characters: [{ fullName: '赤鳞卫' }],
      items: [],
    }
    vi.mocked(getDb).mockReturnValue(buildDb(state) as never)
    vi.mocked(listGlossary).mockReturnValue([
      { id: 1, term: '灰潮', aliasesJson: '[]' },
    ] as never)

    const terms = suggestMissingTerms(1, 7).map((item) => item.term)
    expect(terms).toContain('玄冥殿')
    expect(terms).not.toContain('灰潮')
    expect(terms).not.toContain('赤鳞卫')
    expect(terms.length).toBeLessThanOrEqual(8)
  })
})
