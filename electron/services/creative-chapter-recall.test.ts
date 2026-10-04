import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./embedding.service', () => ({
  extractEmbeddingKeywords: (text: string, limit = 24) => text.split(/\s+/).filter(Boolean).slice(0, limit),
  searchSimilarFragments: vi.fn(), fallbackKeywordSearch: vi.fn(),
  isProseEmbeddingFragment: (type: string) => type === 'content_excerpt' || /^content_excerpt:\d+$/u.test(type),
}))
import { fallbackKeywordSearch, searchSimilarFragments } from './embedding.service'
import { recallCreativeChapterSources } from './creative-chapter-recall'
import type { ContextVisibilityPolicy } from './context-visibility'

const chapters = [{ id: 1, chapterNum: 1, content: '陆闻将旧铜灯放在石台。\n阿烛的秘密来历仍无人知道。' },
  { id: 2, chapterNum: 2, content: '陆闻在旧铜灯边看账。' }, { id: 4, chapterNum: 4, content: '未来旧铜灯被毁。' }]
const policy: ContextVisibilityPolicy = { novelId: 1, chapterNum: 3, purpose: 'writer', povCharacterIds: [1], unresolvedPovLabels: [], allowedFacts: [], deniedFacts: [], revealDirectives: [] }
const args = { novelId: 1, chapterNum: 3, previousChapterId: 2, queryText: '旧铜灯', chapters, policy, maxInputTokens: 24000 }
const hit = (id: number, num: number, text: string, type = 'content_excerpt') => ({ chapterId: id, chapterNum: num, fragmentText: text, fragmentType: type, similarity: 0.9, searchMode: 'keyword' as const })

describe('bounded old chapter recall', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('recalls current saved early prose, excluding the prior chapter, future text and planning fragments', async () => {
    vi.mocked(searchSimilarFragments).mockResolvedValue({ hits: [hit(1, 1, chapters[0].content), hit(2, 2, chapters[1].content), hit(4, 4, chapters[2].content), hit(1, 1, '计划旧铜灯会毁', 'outline')] })
    const result = await recallCreativeChapterSources(args)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({ sourceId: '1', text: '陆闻将旧铜灯放在石台。', required: false })
    expect(result.sources[0].sourceVersion).toBeTruthy()
    expect(searchSimilarFragments).toHaveBeenCalledWith(1, '旧铜灯', 24, undefined, { beforeChapterNum: 2 })
  })
  it('filters forbidden facts and uses prose keyword fallback when the vector index is empty', async () => {
    vi.mocked(searchSimilarFragments).mockResolvedValue({ hits: [], fallbackReason: 'disabled_by_config' })
    vi.mocked(fallbackKeywordSearch).mockReturnValue([hit(1, 1, chapters[0].content)])
    const result = await recallCreativeChapterSources({ ...args, queryText: '阿烛 旧铜灯', policy: { ...policy, deniedFacts: [{ fact: { id: 7, title: '阿烛的秘密来历', summary: '' }, projection: {} } as never] } })
    expect(result.sources.map(source => source.text).join('')).toContain('旧铜灯')
    expect(result.sources.map(source => source.text).join('')).not.toContain('秘密来历')
    expect(result.omitted.some(key => key.includes('pov_forbidden_fact'))).toBe(true)
  })
  it('omits over-budget whole paragraphs and does not copy stale index text', async () => {
    vi.mocked(searchSimilarFragments).mockResolvedValue({ hits: [hit(1, 1, '旧铜灯已经变成金灯。')] })
    const result = await recallCreativeChapterSources({ ...args, maxInputTokens: 10 })
    expect(result.sources).toHaveLength(0)
    expect(result.omitted.some(key => key.includes('recall_budget'))).toBe(true)
  })
  it('accepts a later saved prose chunk as a vector locator', async () => {
    vi.mocked(searchSimilarFragments).mockResolvedValue({ hits: [{ ...hit(1, 1, '陆闻将旧铜灯放在石台。', 'content_excerpt:2'), searchMode: 'vector' }] })
    const result = await recallCreativeChapterSources(args)
    expect(result.sources[0]?.text).toBe('陆闻将旧铜灯放在石台。')
    expect(fallbackKeywordSearch).not.toHaveBeenCalled()
  })
})
