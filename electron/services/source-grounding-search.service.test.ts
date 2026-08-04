import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSourceGroundingQueries,
  enrichSourceGroundingFromWeb,
  mergeSourceGroundingEnrichmentIntoCurrent,
} from './source-grounding-search.service'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('source-grounding-search service', () => {
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
    expect(result.diagnostics.join('\n')).toMatch(/未配置真实网页检索 provider/u)
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
    expect(result.diagnostics.join('\n')).toMatch(/未配置真实网页检索 provider/u)
  })
})
