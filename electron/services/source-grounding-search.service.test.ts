import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import {
  buildSourceGroundingQueries,
  enrichSourceGroundingFromWeb,
  mergeSourceGroundingEnrichmentIntoCurrent,
} from './source-grounding-search.service'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('source-grounding-search service', () => {
  it('keeps time, region and exclusions in explicit research despite old project sources', () => {
    const queries = buildSourceGroundingQueries({ novelId: 1, chapterId: 1, chapterNum: 1,
      researchRequest: '查宋代江南普通行旅者衣料，排除道袍', researchTopics: ['服饰器物'],
      sourceLedgerJson: '[{"sourceKey":"old","factTitle":"道教"}]' })
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query).toContain('宋代江南普通行旅者衣料')
      expect(query).toContain('排除道袍')
    }
  })

  it('preserves an explicit rejection when refreshing the same source', () => {
    const rejected = { sourceKey: 'web:rejected', sourceType: 'web_search', factTitle: '已否决资料', sourceText: '作者认为不适用', verificationStatus: 'web_found', canonDecision: 'rejected' }
    const merged = mergeSourceGroundingEnrichmentIntoCurrent({ sourceLedgerJson: JSON.stringify([rejected]) }, {
      discoveredSourceLedgerEntries: [{ ...rejected, sourceText: '新网页摘要', canonDecision: 'reference_only' }], discoveredCanonFactCards: [],
    })
    expect(JSON.parse(merged.sourceLedgerJson)).toEqual([rejected])
  })

  it('preserves a long explicit research request including its trailing exclusions instead of silently truncating', () => {
    const exclusion = '排除明清服饰、道袍与影视剧二创设定，只采用宋代江南材料。'
    const request = `查询宋代江南普通行旅者衣料；${'希望说明实物、文献与年代依据。'.repeat(30)}\n  ${exclusion}`
    const queries = buildSourceGroundingQueries({ novelId: 1, chapterId: 1, chapterNum: 1, researchRequest: request, researchTopics: ['服饰器物'] })

    expect(request.length).toBeGreaterThan(240)
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query).toContain(request.replace(/\s+/gu, ' ').trim())
      expect(query).toContain(exclusion)
    }
  })
  it('builds real-world grounding queries for source-poor historical or domain contexts', () => {
    const historicalQueries = buildSourceGroundingQueries({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '古言宫斗权谋',
      novelTitle: '长安旧令',
      chapterTitle: '宫门夜议',
      chapterGoal: '围绕礼制、官制和宗族压力推进朝堂冲突',
      worldRules: '王朝礼制、官制、宗族与州府管辖都必须影响人物行动。',
      backgroundText: '女主卷入宫廷旧案，需要处理门第、官制和宗族牵连。',
      glossaryTerms: ['礼制', '官制', '州府'],
    })
    const industryQueries = buildSourceGroundingQueries({
      novelId: 2,
      chapterId: 20,
      chapterNum: 5,
      genre: '现实行业职场',
      novelTitle: '风控名单',
      chapterTitle: '会议纪要',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
    })

    expect(historicalQueries.length).toBeGreaterThan(0)
    expect(historicalQueries.join('\n')).toMatch(/礼制|官制|州府/u)
    expect(industryQueries.length).toBeGreaterThan(0)
    expect(industryQueries.join('\n')).toMatch(/风控|银行|监管|公司/u)
  })

  it('does not repeat web grounding when the project already has source entries', () => {
    const queries = buildSourceGroundingQueries({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '现实行业职场',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
      sourceLedgerJson: JSON.stringify([{
        sourceKey: 'web:existing',
        factTitle: '贷款风险分类',
        sourceText: '商业银行贷款风险分类需要持续监测。',
      }]),
    })

    expect(queries).toEqual([])
  })

  it('does not let an unapproved chapter extract suppress required web grounding', () => {
    const queries = buildSourceGroundingQueries({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '现实行业职场',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
      sourceLedgerJson: JSON.stringify([{
        sourceKey: 'chapter:10:thread:pending',
        chapterId: 10,
        runId: 21,
        assetType: 'thread',
        sourceText: '模型抽取但尚未审批的行业猜测。',
        supportingDiffIds: [],
      }]),
    })

    expect(queries.length).toBeGreaterThan(0)
  })

  it('does not let an approved story fact masquerade as an external grounding reference', () => {
    const queries = buildSourceGroundingQueries({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '现实行业职场',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
      sourceLedgerJson: JSON.stringify([{
        sourceKey: 'chapter:9:thread:approved',
        chapterId: 9,
        runId: 20,
        assetType: 'thread',
        sourceText: '已审批的故事内线程事实。',
        supportingDiffIds: [31],
      }]),
    })

    expect(queries.length).toBeGreaterThan(0)
  })

  it('merges discovered sources into the latest ledgers without losing concurrent entries', () => {
    const merged = mergeSourceGroundingEnrichmentIntoCurrent({
      sourceLedgerJson: JSON.stringify([{ sourceKey: 'concurrent-source', sourceText: '并发写回来源' }]),
      canonSourceLedgerJson: JSON.stringify([{ sourceKey: 'concurrent-canon', sourceText: '并发 Canon 来源' }]),
      canonFactCardsJson: JSON.stringify([{ cardKey: 'concurrent-card', title: '并发事实卡' }]),
    }, {
      discoveredSourceLedgerEntries: [{ sourceKey: 'web:new', sourceText: '新检索来源' }],
      discoveredCanonFactCards: [{ cardKey: 'web:new', title: '新检索事实卡' }],
    })

    expect(JSON.parse(merged.sourceLedgerJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'concurrent-source' }),
      expect.objectContaining({ sourceKey: 'web:new' }),
    ]))
    expect(JSON.parse(merged.canonSourceLedgerJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'concurrent-canon' }),
      expect.objectContaining({ sourceKey: 'web:new' }),
    ]))
    expect(JSON.parse(merged.canonFactCardsJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardKey: 'concurrent-card' }),
      expect.objectContaining({ cardKey: 'web:new' }),
    ]))
  })

  it('preserves keyless legacy records and duplicate existing provenance during search merges', () => {
    const legacy = { factTitle: '旧版手工史料', sourceText: '没有编号也必须保留。' }
    const duplicateFirst = { sourceKey: 'web:duplicate', sourceText: '重复编号的第一条旧证据。' }
    const duplicateSecond = { sourceKey: 'web:duplicate', sourceText: '重复编号的第二条旧证据。' }
    const legacyCard = { title: '旧版事实卡', summary: '没有 cardKey。' }
    const discovered = { sourceKey: 'web:new', sourceType: 'web_search', canonDecision: 'reference_only', sourceText: '新参考。' }
    const merged = mergeSourceGroundingEnrichmentIntoCurrent({
      sourceLedgerJson: JSON.stringify([legacy, duplicateFirst, duplicateSecond]),
      canonSourceLedgerJson: JSON.stringify([legacy]),
      canonFactCardsJson: JSON.stringify([legacyCard]),
    }, {
      discoveredSourceLedgerEntries: [discovered, { ...discovered, sourceKey: 'web:duplicate' }],
      discoveredCanonFactCards: [],
    })

    expect(JSON.parse(merged.sourceLedgerJson)).toEqual([legacy, duplicateFirst, duplicateSecond, discovered])
    expect(JSON.parse(merged.canonSourceLedgerJson)).toEqual([legacy, discovered, { ...discovered, sourceKey: 'web:duplicate' }])
    expect(JSON.parse(merged.canonFactCardsJson)).toEqual([legacyCard])
  })

  it('does not replace adopted sources or fact cards with unapproved refreshed results', () => {
    const accepted = { sourceKey: 'web:accepted', sourceType: 'web_search', canonDecision: 'accepted', sourceText: '已采纳的内容。' }
    const supported = { sourceKey: 'web:supported', sourceType: 'web_search', canonDecision: 'reference_only', supportingDiffIds: [3], sourceText: '正文引用过的内容。' }
    const editedCard = { cardKey: 'web:accepted', assetType: 'external_web', entityType: 'source_grounding', canonDecision: 'edited', summary: '人工编辑后的内容。' }
    const merged = mergeSourceGroundingEnrichmentIntoCurrent({
      sourceLedgerJson: JSON.stringify([accepted, supported]),
      canonFactCardsJson: JSON.stringify([editedCard]),
    }, {
      discoveredSourceLedgerEntries: [accepted, supported].map(entry => ({ ...entry, supportingDiffIds: [], canonDecision: 'reference_only', sourceText: '新的未核验搜索摘要。' })),
      discoveredCanonFactCards: [{ ...editedCard, canonDecision: 'reference_only', summary: '新的未核验搜索摘要。' }],
    })

    expect(JSON.parse(merged.sourceLedgerJson)).toEqual([accepted, supported])
    expect(JSON.parse(merged.canonFactCardsJson)).toEqual([editedCard])
  })

  it('caps only replaceable web caches and retains chapter evidence above the normal ledger limit', () => {
    const chapterEntries = Array.from({ length: 401 }, (_, index) => ({
      sourceKey: `chapter:${index}`, runId: index + 1, supportingDiffIds: [index + 1], sourceText: `正文证据${index}`,
    }))
    const cache = { sourceKey: 'web:old', sourceType: 'web_search', canonDecision: 'reference_only' }
    const discovered = { ...cache, sourceKey: 'web:new' }
    const merged = mergeSourceGroundingEnrichmentIntoCurrent({
      sourceLedgerJson: JSON.stringify([...chapterEntries, cache]),
    }, { discoveredSourceLedgerEntries: [discovered], discoveredCanonFactCards: [] })
    expect(JSON.parse(merged.sourceLedgerJson)).toEqual([...chapterEntries, cache, discovered])

    const caches = Array.from({ length: 400 }, (_, index) => ({ ...cache, sourceKey: `web:cache:${index}` }))
    const withinLimit = mergeSourceGroundingEnrichmentIntoCurrent({
      sourceLedgerJson: JSON.stringify([...chapterEntries, ...caches]),
    }, { discoveredSourceLedgerEntries: [discovered], discoveredCanonFactCards: [] })
    expect(JSON.parse(withinLimit.sourceLedgerJson)).toEqual([...chapterEntries, ...caches.slice(1), discovered])
  })

  it('refuses to replace nonempty malformed or non-array ledgers during a write merge', () => {
    const enrichment = {
      discoveredSourceLedgerEntries: [{ sourceKey: 'web:new', sourceType: 'web_search', canonDecision: 'reference_only' }],
      discoveredCanonFactCards: [],
    }
    for (const field of ['sourceLedgerJson', 'canonSourceLedgerJson', 'canonFactCardsJson']) {
      for (const invalid of ['{broken', '{}', 'null', '"legacy text"']) {
        expect(() => mergeSourceGroundingEnrichmentIntoCurrent({ [field]: invalid }, enrichment))
          .toThrow(formatUserFacingMessage('services.creativeResearch.ledgerSaveInvalid'))
      }
    }
    expect(() => mergeSourceGroundingEnrichmentIntoCurrent({ sourceLedgerJson: '' }, enrichment)).not.toThrow()
  })

  it('writes provider results into source ledger and canon fact cards', async () => {
    const provider = vi.fn(async () => [
      {
        title: '商业银行贷款风险分类办法',
        url: 'https://example.test/risk-classification',
        snippet: '商业银行应当按照借款人履约能力、风险程度等因素进行贷款风险分类。',
        score: 0.82,
        publishedAt: '2023-01-01',
      },
    ])

    const result = await enrichSourceGroundingFromWeb({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '现实行业职场',
      novelTitle: '风控名单',
      chapterTitle: '会议纪要',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
    }, {
      provider,
      providerName: 'mock-search',
      now: () => '2026-06-07T00:00:00.000Z',
    })

    expect(provider).toHaveBeenCalled()
    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(true)
    const sourceLedger = JSON.parse(result.sourceLedgerJson) as Array<Record<string, unknown>>
    const canonCards = JSON.parse(result.canonFactCardsJson) as Array<Record<string, unknown>>
    expect(sourceLedger).toHaveLength(1)
    expect(sourceLedger[0]).toMatchObject({
      assetType: 'external_web',
      sourceType: 'web_search',
      provider: 'mock-search',
      sourceUrl: 'https://example.test/risk-classification',
      factTitle: '商业银行贷款风险分类办法',
      verificationStatus: 'web_found',
    })
    expect(canonCards[0]).toMatchObject({
      assetType: 'external_web',
      entityType: 'source_grounding',
      verificationStatus: 'web_found',
      canonDecision: 'reference_only',
    })
    expect(canonCards[0].sourceKeys).toEqual([sourceLedger[0].sourceKey])
  })

  it('does not treat author inspiration cards as verified grounding and keeps them during web refresh', async () => {
    const authorCard = {
      sourceKey: 'author:inspiration', sourceType: 'author_created', assetType: 'creative_reference',
      category: 'daoism', title: '不争与权力边界', factTitle: '不争与权力边界', sourceText: '拒绝垄断救命药。',
      content: '主角放弃垄断渡口救命药。', interpretation: '克制不是无欲，而是不把他人困境换成权力。',
      novelConnection: '映照饥荒中的粮药分配。', verificationStatus: 'pending', canonDecision: 'reference_only',
      recordedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    }
    const provider = vi.fn(async () => [{ title: '驿站递送制度', url: 'https://example.test/post-road', snippet: '驿站与官道用于递送公文。' }])
    const result = await enrichSourceGroundingFromWeb({
      novelId: 1, chapterId: 10, chapterNum: 3, genre: '历史正剧',
      chapterTitle: '渡口药材争夺', chapterGoal: '按宋代背景核对驿递制度与军中升迁。',
      backgroundText: '故事发生在架空宋代，主角在渡口处理粮药分配。',
      sourceLedgerJson: JSON.stringify([authorCard]),
    }, { provider, providerName: 'mock-search', now: () => '2026-06-07T00:00:00.000Z' })

    expect(provider).toHaveBeenCalled()
    expect(result.updated).toBe(true)
    const ledger = JSON.parse(result.sourceLedgerJson) as Array<Record<string, unknown>>
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: authorCard.sourceKey, canonDecision: 'reference_only' }),
      expect.objectContaining({ sourceType: 'web_search', verificationStatus: 'web_found' }),
    ]))
  })

  it('falls back without pretending to search when no provider is configured', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '')

    const result = await enrichSourceGroundingFromWeb({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '现实行业职场',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
    })

    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(false)
    expect(result.diagnostics.join('\n')).toContain('未配置真实网页检索服务')
    expect(result.diagnostics.join('\n')).toContain('联网搜索配置')
  })

  it('does not call providers directly from env fallback when runtime settings are unavailable', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'env-tavily-key')
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '')

    const result = await enrichSourceGroundingFromWeb({
      novelId: 1,
      chapterId: 10,
      chapterNum: 3,
      genre: '现实行业职场',
      chapterGoal: '写出银行风控、公司流程与监管压力',
      backgroundText: '主角在银行风控部门处理贷款审核与合规问题。',
    })

    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(false)
    expect(result.diagnostics.join('\n')).toContain('未配置真实网页检索服务')
    expect(result.diagnostics.join('\n')).toContain('联网搜索配置')
  })

  it('does not include unknown provider errors or credentials in grounding diagnostics', async () => {
    const sourceLedgerJson = JSON.stringify([{ sourceKey: 'existing-evidence', sourceText: '保留原有证据' }])
    const provider = vi.fn(async () => { throw new Error('Authorization: Bearer fixture-secret-do-not-echo') })

    const result = await enrichSourceGroundingFromWeb({
      novelId: 1, chapterId: 10, chapterNum: 3,
      researchRequest: '查询宋代行旅衣料资料', sourceLedgerJson,
    }, { provider, providerName: 'fixture' })

    expect(provider).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ attempted: true, updated: false, sourceLedgerJson, discoveredSourceLedgerEntries: [], discoveredCanonFactCards: [] })
    expect(result.diagnostics.join('\n')).toContain('检索失败，请检查搜索配置或网络后重试。')
    expect(JSON.stringify(result)).not.toContain('fixture-secret-do-not-echo')
    expect(JSON.stringify(result)).not.toContain('Authorization')
  })
})
