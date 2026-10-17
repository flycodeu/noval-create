import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchCreativeResearch, listCreativeResearch } from './creative-research.service'
import { CREATIVE_RESEARCH_USAGE, needsCreativeResearch, selectCreativeResearchSources } from '../../src/shared/creative-research'

const state = vi.hoisted(() => ({ novel: {} as Record<string, unknown>, writes: [] as Record<string, unknown>[], runtime: { mode: 'auto', providerName: null, apiKey: null } as { mode: string; providerName: string | null; apiKey: string | null } }))
vi.mock('../database/db', () => ({ getSqlite: () => ({ transaction: (callback: () => unknown) => ({ immediate: callback }) }) }))
vi.mock('./novel.service', () => ({ getNovel: () => state.novel, updateNovel: (_: number, data: Record<string, unknown>) => { state.writes.push(data); Object.assign(state.novel, data, { contextVersion: Number(state.novel.contextVersion) + 1 }) } }))
vi.mock('./chapter.service', () => ({ listChapters: () => [{ id: 5, chapterNum: 2, title: '夜入道观' }] }))
vi.mock('./source-search-settings.service', () => ({ getSourceSearchRuntimeConfig: () => state.runtime }))

const source = { title: '道德經', url: 'https://ctext.org/dao-de-jing/zh', snippet: '道家原典中的知止与克制，可用于人物在利益和承诺间作出选择。' }
const provider = () => vi.fn(async () => [source])
describe('creative research persistence and subsequent writing material', () => {
  beforeEach(() => { state.novel = { id: 1, contextVersion: 7, sourceLedgerJson: JSON.stringify([{ sourceKey: 'chapter:old', supportingDiffIds: [3], sourceText: '既有正文证据' }]), canonFactCardsJson: '[{"cardKey":"keep"}]' }; state.writes = []; state.runtime = { mode: 'auto', providerName: null, apiKey: null } })
  afterEach(() => { vi.unstubAllGlobals() })
  it('uses the configured provider HTTP contract with mocked transport and saves reference-only sources for later chapter selection', async () => {
    state.runtime = { mode: 'auto', providerName: 'tavily', apiKey: 'test-only-placeholder' }
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: [{ ...source, content: source.snippet }] }) }))
    vi.stubGlobal('fetch', fetch)
    const result = await searchCreativeResearch(1, '补充道教知识，运用在夜入道观的章节', 2)
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tavily.com/search')
    expect(JSON.parse(String(init.body))).toMatchObject({ query: expect.stringContaining('道教'), max_results: 3, include_answer: false })
    expect(result).toMatchObject({ updated: true, contextVersion: 8, sources: [expect.objectContaining({ url: source.url, canonDecision: 'reference_only' })] })
    expect(state.writes[0]).toEqual({ sourceLedgerJson: expect.any(String) })
    expect(state.novel.canonFactCardsJson).toBe('[{"cardKey":"keep"}]')
    expect(state.novel.sourceLedgerJson).toContain('既有正文证据')
    expect(selectCreativeResearchSources(String(state.novel.sourceLedgerJson), '道士在道观里借灯')).toEqual(result.sources)
    expect(CREATIVE_RESEARCH_USAGE).toContain('不是小说正史或人物已知信息')
  })
  it('reuses exactly the same recent request, but a new topic still searches even with old sources', async () => {
    const search = provider(), options = { provider: search, providerName: 'fixture', now: () => '2026-10-17T00:00:00Z' }
    await searchCreativeResearch(1, '搜索道教知识', 2, options)
    expect((await searchCreativeResearch(1, '搜索道教知识', 2, options)).cached).toBe(true)
    expect(search).toHaveBeenCalledTimes(2)
    await searchCreativeResearch(1, '搜索道教服饰资料', 2, options)
    expect(search).toHaveBeenCalledTimes(4)
    expect(listCreativeResearch(1)).toHaveLength(1)
  })
  it('does not save failed searches or unsafe source URLs and does not invent results', async () => {
    const result = await searchCreativeResearch(1, '搜索道教知识', 2, { provider: vi.fn(async () => [{ ...source, url: 'javascript:alert(1)' }]), providerName: 'fixture' })
    expect(result.updated).toBe(false); expect(result.sources).toEqual([]); expect(result.diagnostics.join(' ')).toContain('无有效结果')
    expect(state.writes).toHaveLength(0)
    const unavailable = await searchCreativeResearch(1, '搜索道教知识')
    expect(unavailable.updated).toBe(false); expect(unavailable.diagnostics.join(' ')).toContain('未配置真实网页检索')
  })
  it('does not overwrite concurrent project edits or save after cancellation', async () => {
    const search = vi.fn(async () => { state.novel.contextVersion = 9; return [source] })
    await expect(searchCreativeResearch(1, '搜索道教知识', 2, { provider: search, providerName: 'fixture' })).rejects.toThrow('检索期间项目资料已变化')
    expect(state.writes).toHaveLength(0)
    state.novel.contextVersion = 7
    await expect(searchCreativeResearch(1, '搜索道教知识', 2, { provider: provider(), providerName: 'fixture', beforeSave: () => { throw new Error('已取消') } })).rejects.toThrow('已取消')
    expect(state.writes).toHaveLength(0)
  })
  it('recognizes explicit needs and respects the request not to search', () => {
    expect(needsCreativeResearch('给我搜索下道教的内容')).toBe(true)
    expect(needsCreativeResearch('要一些道教的知识')).toBe(true)
    expect(needsCreativeResearch('帮我查找适合本书的道教资料')).toBe(true)
    expect(needsCreativeResearch('查找宋代服饰资料')).toBe(true)
    expect(needsCreativeResearch('续写下一章')).toBe(false)
    expect(needsCreativeResearch('继续第七章：陆闻查找钱三留下的物品，杨嫂安排住客休息。')).toBe(false)
    expect(needsCreativeResearch('写一段陆闻收集证据后去查找失踪者的剧情。')).toBe(false)
    expect(needsCreativeResearch('不要联网搜索，只用已有道教知识')).toBe(false)
  })
})
