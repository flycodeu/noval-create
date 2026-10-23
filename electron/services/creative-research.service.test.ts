import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteAuthorCreativeResearch, getAuthorCreativeResearch, listAuthorCreativeResearch, searchCreativeResearch, listCreativeResearch, upsertAuthorCreativeResearch } from './creative-research.service'
import { CREATIVE_RESEARCH_USAGE, needsCreativeResearch, selectCreativeResearchSources } from '../../src/shared/creative-research'
import type { SourceSearchRuntimeConfig } from '../../src/shared/source-search'
import { notifyNovelResearchChanged } from '../utils/novel-research-events'

const state = vi.hoisted(() => ({ novel: {} as Record<string, unknown>, writes: [] as Record<string, unknown>[], runtime: { mode: 'auto', providerName: null, apiKey: null } as SourceSearchRuntimeConfig }))
vi.mock('../database/db', () => ({ getSqlite: () => ({ transaction: (callback: () => unknown) => ({ immediate: callback }) }) }))
vi.mock('../utils/novel-research-events', () => ({ notifyNovelResearchChanged: vi.fn() }))
vi.mock('./novel.service', () => ({ getNovel: () => state.novel, updateNovel: (_: number, data: Record<string, unknown>, options: { expectedContextVersion?: number } = {}) => {
  if (options.expectedContextVersion !== undefined && options.expectedContextVersion !== state.novel.contextVersion) throw new Error(formatUserFacingMessage('novel.contextVersionConflict'))
  if (data.sourceLedgerJson === state.novel.sourceLedgerJson && Object.keys(data).length === 1) return
  state.writes.push(data); Object.assign(state.novel, data, { contextVersion: Number(state.novel.contextVersion) + 1 })
} }))
vi.mock('./chapter.service', () => ({ listChapters: () => [{ id: 5, chapterNum: 2, title: '夜入道观' }] }))
vi.mock('./source-search-settings.service', () => ({ getSourceSearchRuntimeConfig: () => state.runtime }))

const source = { title: '道德經', url: 'https://ctext.org/dao-de-jing/zh', snippet: '道家原典中的知止与克制，可用于人物在利益和承诺间作出选择。' }
const provider = () => vi.fn(async () => [source])
describe('creative research persistence and subsequent writing material', () => {
  beforeEach(() => { state.novel = { id: 1, contextVersion: 7, sourceLedgerJson: JSON.stringify([{ sourceKey: 'chapter:old', supportingDiffIds: [3], sourceText: '既有正文证据' }]), canonFactCardsJson: '[{"cardKey":"keep"}]' }; state.writes = []; state.runtime = { mode: 'auto', providerName: null, apiKey: null } })
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(notifyNovelResearchChanged).mockClear() })
  it('replays normalized identical cards without a write or notification while still rejecting stale CAS', () => {
    const draft = { category: 'humanity' as const, title: '代价归谁承担', content: '核心机制', interpretation: '利益与责任', novelConnection: '连接本作的粮药争夺' }
    const [saved] = upsertAuthorCreativeResearch(1, [draft], 7)
    expect(notifyNovelResearchChanged).toHaveBeenCalledOnce()
    vi.mocked(notifyNovelResearchChanged).mockClear()
    const before = JSON.stringify(state.novel), writesBefore = state.writes.length
    const [again] = upsertAuthorCreativeResearch(1, [{ ...draft, sourceKey: saved.sourceKey, title: ` ${draft.title} ` }], 8)
    expect(again).toEqual(saved)
    expect(JSON.stringify(state.novel)).toBe(before)
    expect(state.writes).toHaveLength(writesBefore)
    expect(notifyNovelResearchChanged).not.toHaveBeenCalled()
    expect(() => upsertAuthorCreativeResearch(1, [{ ...draft, sourceKey: saved.sourceKey }], 7)).toThrow('作品已被其他任务修改')
    expect(JSON.stringify(state.novel)).toBe(before)
    expect(notifyNovelResearchChanged).not.toHaveBeenCalled()
  })
  it('uses the configured provider HTTP contract with mocked transport and saves reference-only sources for later chapter selection', async () => {
    state.runtime = { mode: 'auto', providerName: 'tavily', apiKey: 'test-only-placeholder' }
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [{ ...source, content: source.snippet }] }), { status: 200 }))
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

  it.each(['responses', 'chat-completions'] as const)('persists %s structured source titles only, never attributing model-written synthesis as a webpage excerpt or story fact', async protocol => {
    state.runtime = { mode: 'custom', providerName: 'custom', protocol, baseUrl: 'https://fixture.example/v1', model: 'fixture-search-model', apiKey: 'test-only-placeholder' }
    const modelText = '检索模型生成的综合观点，不是网页原文，也不能升级为小说中的正史。'
    const citation = { type: 'url_citation', url: source.url, title: source.title, start_index: 0, end_index: modelText.length }
    const payload = protocol === 'responses' ? {
      status: 'completed', output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: source.url, title: source.title }] } },
        { type: 'message', status: 'completed', content: [{ type: 'output_text', text: modelText, annotations: [citation] }] },
      ],
    } : { choices: [{ finish_reason: 'stop', message: { content: modelText, annotations: [{ type: 'url_citation', url_citation: citation }] } }] }
    const fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await searchCreativeResearch(1, '查询道教典籍，保留原有角色已知信息', 2)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ updated: true, contextVersion: 8, sources: [expect.objectContaining({
      title: source.title, url: source.url, excerpt: source.title, excerptKind: 'source_metadata', verificationStatus: 'web_found', canonDecision: 'reference_only',
    })] })
    expect(state.writes).toEqual([{ sourceLedgerJson: expect.any(String) }])
    expect(state.novel.canonFactCardsJson).toBe('[{"cardKey":"keep"}]')
    expect(state.novel.sourceLedgerJson).toContain('既有正文证据')
    expect(JSON.stringify(result)).not.toContain(modelText)
    expect(String(state.novel.sourceLedgerJson)).not.toContain(modelText)
    expect(String(state.novel.sourceLedgerJson)).not.toContain('test-only-placeholder')
  })

  it.each([115, 128])('sends a complete %s-code-point DeepSeek request without system expansions exceeding the limit', async size => {
    state.runtime = { mode: 'deepseek', providerName: 'deepseek', protocol: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: '', apiKey: 'test-only-placeholder' }
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [source] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const request = `服饰资料${'𠮷'.repeat(size - 4)}`
    const result = await searchCreativeResearch(1, request, 2)
    expect(result.updated).toBe(true)
    expect(result.queries).toEqual([request])
    expect(fetch).toHaveBeenCalledOnce()
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).query).toBe(request)
    expect(Array.from(request)).toHaveLength(size)
  })

  it('rejects overlong DeepSeek queries explicitly without network access, truncated exclusions or research writes', async () => {
    state.runtime = { mode: 'deepseek', providerName: 'deepseek', protocol: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: '', apiKey: 'test-only-placeholder' }
    const fetch = vi.fn(async () => { throw new Error('Unexpected provider request') })
    vi.stubGlobal('fetch', fetch)
    const original = { ...state.novel }
    const exclusion = '排除明清服饰与影视二创设定。'
    const request = `查询宋代江南行旅衣料；${'优先使用博物馆实物与年代依据。'.repeat(20)}${exclusion}`

    const result = await searchCreativeResearch(1, request, 2)

    expect(result).toMatchObject({ attempted: true, updated: false, sources: [], contextVersion: 7 })
    expect(result.queries.every(query => query.includes(exclusion))).toBe(true)
    expect(result.diagnostics.join('\n')).toContain('128')
    expect(fetch).not.toHaveBeenCalled()
    expect(state.writes).toEqual([])
    expect(state.novel).toEqual(original)
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
    await expect(searchCreativeResearch(1, '搜索道教知识', 2, { provider: provider(), providerName: 'fixture', beforeSave: () => { throw new Error(formatUserFacingMessage('services.cancelled')) } })).rejects.toThrow('已取消')
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

  it('stores concise author-created cards without changing Canon or external source records', () => {
    state.novel.sourceLedgerJson = JSON.stringify([
      { sourceKey: 'web:verified', sourceType: 'web_search', factTitle: '宋代驿站', sourceText: '既有网页资料。', verificationStatus: 'web_found' },
    ])
    state.novel.canonFactCardsJson = '[{"cardKey":"canon:existing"}]'
    const draft = { category: 'daoism' as const, title: '不争作为权力约束', sourceTitle: '道家思想', tags: ['道教', '抉择'],
      content: '人物拒绝垄断渡口的救命药，代价是失去军中晋升。', interpretation: '克制不是无欲，而是拒绝把他人困境换成自己的权力。',
      novelConnection: '让主角在饥荒中的粮药分配上放弃短期胜利，留下后续政治代价。' }
    const [saved] = upsertAuthorCreativeResearch(1, [draft])
    expect(saved).toMatchObject({ sourceType: 'author_created', assetType: 'creative_reference', canonDecision: 'reference_only' })
    expect(state.novel.canonFactCardsJson).toBe('[{"cardKey":"canon:existing"}]')
    expect(JSON.parse(String(state.novel.sourceLedgerJson))).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'web:verified', sourceText: '既有网页资料。' }),
      expect.objectContaining({ sourceKey: saved.sourceKey, sourceType: 'author_created', sourceText: expect.stringContaining('深层含义：') }),
    ]))
    expect(getAuthorCreativeResearch(1, saved.sourceKey)).toMatchObject({ title: draft.title, novelConnection: draft.novelConnection })
    expect(listAuthorCreativeResearch(1, { category: 'daoism', query: '渡口' })).toHaveLength(1)

    const [updated] = upsertAuthorCreativeResearch(1, [{ ...draft, sourceKey: saved.sourceKey, content: '更新后的机制说明。' }])
    expect(updated.sourceKey).toBe(saved.sourceKey)
    expect(updated.recordedAt).toBe(saved.recordedAt)
    expect(updated.content).toBe('更新后的机制说明。')
    deleteAuthorCreativeResearch(1, saved.sourceKey)
    expect(listAuthorCreativeResearch(1)).toEqual([])
    expect(JSON.parse(String(state.novel.sourceLedgerJson))).toEqual([expect.objectContaining({ sourceKey: 'web:verified' })])
  })

  it('accepts a 100-card batch and refuses to overwrite another source kind', () => {
    const drafts = Array.from({ length: 100 }, (_, index) => ({ category: 'humanity' as const, title: `伦理机制${index}`,
      content: `人物选择和代价${index}`, interpretation: '选择带来的伦理含义。', novelConnection: '连接本作的饥荒背景。' }))
    expect(upsertAuthorCreativeResearch(1, drafts)).toHaveLength(100)
    expect(listAuthorCreativeResearch(1, { limit: 200 })).toHaveLength(100)
    state.novel.sourceLedgerJson = JSON.stringify([{ sourceKey: 'author:collision', sourceType: 'web_search', factTitle: '外部来源', sourceText: '不可覆盖' }])
    expect(() => upsertAuthorCreativeResearch(1, [{ ...drafts[0], sourceKey: 'author:collision' }])).toThrow('不能覆盖')
  })

  it('rejects stale author edits and deletions while preserving the newer card', () => {
    const draft = { category: 'humanity' as const, title: '代价归谁承担', content: '旧核心机制', interpretation: '利益与责任的冲突', novelConnection: '连接本作的粮药争夺' }
    const [saved] = upsertAuthorCreativeResearch(1, [draft], 7)
    const [newer] = upsertAuthorCreativeResearch(1, [{ ...draft, sourceKey: saved.sourceKey, content: '另一任务刚保存的核心机制' }], 8)
    const ledgerBefore = state.novel.sourceLedgerJson
    const writesBefore = state.writes.length
    expect(() => upsertAuthorCreativeResearch(1, [{ ...draft, sourceKey: saved.sourceKey }], 8)).toThrow('作品已被其他任务修改')
    expect(() => deleteAuthorCreativeResearch(1, saved.sourceKey, 8)).toThrow('作品已被其他任务修改')
    expect(state.writes).toHaveLength(writesBefore)
    expect(state.novel.sourceLedgerJson).toBe(ledgerBefore)
    expect(getAuthorCreativeResearch(1, saved.sourceKey).content).toBe(newer.content)
    deleteAuthorCreativeResearch(1, saved.sourceKey, 9)
    expect(listAuthorCreativeResearch(1)).toEqual([])
  })

  it('preserves adopted source text, keyless records and duplicate provenance during explicit search', async () => {
    await searchCreativeResearch(1, '搜索道教知识', 2, { provider: provider(), providerName: 'fixture' })
    const rows = JSON.parse(String(state.novel.sourceLedgerJson))
    const adopted = { ...rows.find((row: Record<string, unknown>) => row.sourceType === 'web_search'), canonDecision: 'accepted', sourceText: '人工采纳并校正的原始资料', supportingDiffIds: [8] }
    const other = [{ factTitle: '无编号史料', sourceText: '旧证据' }, { sourceKey: 'chapter:duplicate', runId: 3, supportingDiffIds: [4], sourceText: '旧正文证据一' }, { sourceKey: 'chapter:duplicate', runId: 3, supportingDiffIds: [5], sourceText: '旧正文证据二' }]
    state.novel.sourceLedgerJson = JSON.stringify([adopted, ...other])
    await searchCreativeResearch(1, '搜索道教思想与仪式的知识', 2, { provider: provider(), providerName: 'fixture' })
    const saved = JSON.parse(String(state.novel.sourceLedgerJson))
    expect(saved).toEqual(expect.arrayContaining([adopted, ...other]))
    expect(saved.filter((row: Record<string, unknown>) => row.sourceKey === adopted.sourceKey)).toEqual([adopted])
  })
})
