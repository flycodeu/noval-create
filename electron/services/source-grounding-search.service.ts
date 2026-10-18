import { createHash } from 'node:crypto'
import {
  assessHistoricalGrounding,
  getGroundingSourceLedgerEntries,
  isChapterWritebackSourceLedgerEntry,
} from '../../src/shared/genre-system'
import { getSourceSearchRuntimeConfig } from './source-search-settings.service'
import { executeSourceSearch, SourceSearchError, type WebSearchResult } from './source-search-provider.service'
export type { WebSearchResult } from './source-search-provider.service'

export type SourceGroundingSearchProvider = (query: string, options: {
  maxResults: number
  timeoutMs: number
}) => Promise<WebSearchResult[]>

export interface SourceGroundingEnrichmentInput {
  novelId: number
  chapterId: number
  chapterNum: number
  genre?: string
  novelTitle?: string
  chapterTitle?: string
  chapterOutline?: string
  chapterGoal?: string
  worldRules?: string
  backgroundText?: string
  glossaryTerms?: string[]
  historicalProfileJson?: string | null
  projectCanonProfileJson?: string | null
  canonConstraintSetJson?: string | null
  sourceLedgerJson?: string | null
  canonSourceLedgerJson?: string | null
  canonFactCardsJson?: string | null
  /** Explicit research bypasses the legacy one-time project grounding gate. */
  researchRequest?: string
  researchTopics?: string[]
}

export interface SourceGroundingEnrichmentResult {
  attempted: boolean
  updated: boolean
  providerName?: string
  queries: string[]
  diagnostics: string[]
  sourceLedgerJson: string
  canonSourceLedgerJson: string
  canonFactCardsJson: string
  discoveredSourceLedgerEntries: Record<string, unknown>[]
  discoveredCanonFactCards: Record<string, unknown>[]
  recordedAt?: string
}

export function mergeSourceGroundingEnrichmentIntoCurrent(
  current: Pick<SourceGroundingEnrichmentInput, 'sourceLedgerJson' | 'canonSourceLedgerJson' | 'canonFactCardsJson'>,
  enrichment: Pick<SourceGroundingEnrichmentResult, 'discoveredSourceLedgerEntries' | 'discoveredCanonFactCards'>,
): Pick<SourceGroundingEnrichmentResult, 'sourceLedgerJson' | 'canonSourceLedgerJson' | 'canonFactCardsJson'> {
  return {
    sourceLedgerJson: upsertJsonRecordArray(
      current.sourceLedgerJson,
      enrichment.discoveredSourceLedgerEntries,
      'sourceKey',
      400,
    ),
    canonSourceLedgerJson: upsertJsonRecordArray(
      current.canonSourceLedgerJson,
      enrichment.discoveredSourceLedgerEntries,
      'sourceKey',
      400,
    ),
    canonFactCardsJson: upsertJsonRecordArray(
      current.canonFactCardsJson,
      enrichment.discoveredCanonFactCards,
      'cardKey',
      400,
    ),
  }
}

interface ProviderBundle {
  name: string
  search: SourceGroundingSearchProvider
  queryCodePointLimit?: number
}

const WEB_GROUNDING_MAX_QUERIES = 2
const WEB_GROUNDING_RESULTS_PER_QUERY = 3
const WEB_GROUNDING_TIMEOUT_MS = 8000

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactText(value: string, maxChars = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 3).trim()}...`
}

function stableHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

function parseJsonRecordArray(raw?: string | null): Record<string, unknown>[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : []
  } catch {
    return []
  }
}

function hasSourceGroundingEntries(input: SourceGroundingEnrichmentInput): boolean {
  return getGroundingSourceLedgerEntries(input).some((entry) => !isChapterWritebackSourceLedgerEntry(entry))
    || parseJsonRecordArray(input.canonFactCardsJson).length > 0
}

function stringifyJsonRecordArray(entries: Record<string, unknown>[]): string {
  return JSON.stringify(entries)
}

function upsertJsonRecordArray(
  currentJson: string | null | undefined,
  nextEntries: Record<string, unknown>[],
  keyField: string,
  limit: number,
): string {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const entry of parseJsonRecordArray(currentJson)) {
    const key = asText(entry[keyField])
    if (key) byKey.set(key, entry)
  }
  for (const entry of nextEntries) {
    const key = asText(entry[keyField])
    if (key) byKey.set(key, entry)
  }

  return stringifyJsonRecordArray([...byKey.values()].slice(-limit))
}

function extractSearchTerms(values: Array<string | undefined>, limit = 10): string[] {
  const stopWords = new Set([
    '小说',
    '章节',
    '本章',
    '主角',
    '背景',
    '世界',
    '故事',
    '目标',
    '冲突',
    '任务',
    '剧情',
    '暂无',
  ])
  const seen = new Set<string>()
  const terms: string[] = []

  for (const value of values) {
    for (const raw of (value || '').split(/[\s,，、；;。！？!?："“”"'（）()[\]{}<>《》|/\\]+/u)) {
      const term = raw.trim()
      if (term.length < 2 || term.length > 24) continue
      if (stopWords.has(term)) continue
      if (/^\d+$/u.test(term)) continue
      if (seen.has(term)) continue
      seen.add(term)
      terms.push(term)
      if (terms.length >= limit) return terms
    }
  }

  return terms
}

function needsExternalGrounding(input: SourceGroundingEnrichmentInput): boolean {
  const historicalAssessment = assessHistoricalGrounding({
    genreName: input.genre,
    worldRulesJson: input.worldRules,
    backgroundText: input.backgroundText,
    glossaryTerms: input.glossaryTerms,
    historicalProfileJson: input.historicalProfileJson,
    projectCanonProfileJson: input.projectCanonProfileJson,
    canonConstraintSetJson: input.canonConstraintSetJson,
    sourceLedgerJson: input.sourceLedgerJson,
    canonSourceLedgerJson: input.canonSourceLedgerJson,
    canonFactCardsJson: input.canonFactCardsJson,
  })
  if (historicalAssessment.mode !== 'none' && historicalAssessment.coverage !== 'grounded') {
    return true
  }

  if (hasSourceGroundingEntries(input)) return false

  const combinedText = [
    input.genre,
    input.novelTitle,
    input.chapterTitle,
    input.chapterOutline,
    input.chapterGoal,
    input.worldRules,
    input.backgroundText,
    ...(input.glossaryTerms || []),
  ].map((item) => item || '').join('\n')

  return /真实|现实|行业|职业|职场|政治|政务|政策|法规|法律|法院|检察|公安|刑侦|法医|医疗|医院|药品|金融|证券|银行|商业|商战|公司|互联网|科研|高校|军警|军事|地理|城市|年代|历史|新闻|舆情|制度|流程/u.test(combinedText)
}

export function buildSourceGroundingQueries(input: SourceGroundingEnrichmentInput, queryCodePointLimit?: number): string[] {
  if (input.researchRequest?.trim()) {
    // Query operators and exclusions at the end of a request must not be silently dropped.
    // Protocol-specific limits are enforced explicitly by the selected search adapter.
    const focus = input.researchRequest.replace(/\s+/gu, ' ').trim()
    const topic = (input.researchTopics || []).join(' ')
    const query = [...new Set([focus, topic].filter(Boolean))].join(' ')
    const variants = [`${query} 原典 文献 博物馆 大学`, `${query} 历史 生活 实践 研究`]
    // Drop only our optional expansion when it would exceed the provider's limit.
    // The complete author request remains intact, and overlong requests fail explicitly.
    return [...new Set(variants.map(value => queryCodePointLimit && Array.from(value).length > queryCodePointLimit ? focus : value))]
  }
  if (!needsExternalGrounding(input)) return []

  const terms = extractSearchTerms([
    input.genre,
    input.novelTitle,
    input.chapterTitle,
    input.chapterGoal,
    input.chapterOutline,
    input.worldRules,
    input.backgroundText,
    ...(input.glossaryTerms || []),
  ], 9)
  if (terms.length === 0) return []

  const genre = asText(input.genre)
  const queryCore = terms.slice(0, 5).join(' ')
  const queries = [
    [genre, queryCore, '资料 常识 规则'].filter(Boolean).join(' '),
    [terms.slice(0, 7).join(' '), '制度 流程 依据'].filter(Boolean).join(' '),
  ]

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, WEB_GROUNDING_MAX_QUERIES)
}

function normalizeScore(score: unknown): number {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0.64
  if (value > 1) return Math.min(0.9, value / 10)
  return Math.max(0.2, Math.min(0.9, value))
}

function mapSearchResultsToSourceEntries(
  input: SourceGroundingEnrichmentInput,
  providerName: string,
  query: string,
  results: WebSearchResult[],
  recordedAt: string,
): {
  sourceLedgerEntries: Record<string, unknown>[]
  canonFactCards: Record<string, unknown>[]
} {
  const sourceLedgerEntries: Record<string, unknown>[] = []
  const canonFactCards: Record<string, unknown>[] = []

  for (const result of results) {
    const title = compactText(result.title || result.url, 80)
    const url = result.url.trim()
    const snippet = compactText(result.snippet || title, input.researchRequest ? 1000 : 260)
    if (!title || !url) continue
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue } catch { continue }

    const key = `web:${stableHash(`${providerName}|${url}`)}`
    const confidence = normalizeScore(result.score)
    sourceLedgerEntries.push({
      sourceKey: key,
      chapterId: input.chapterId,
      chapterNum: input.chapterNum,
      assetType: 'external_web',
      sourceType: 'web_search',
      provider: providerName,
      query,
      sourceUrl: url,
      factTitle: title,
      sourceText: snippet,
      ...(result.excerptKind ? { excerptKind: result.excerptKind } : {}),
      confidence,
      verificationStatus: 'web_found',
      publishedAt: result.publishedAt,
      recordedAt,
      researchTopics: input.researchTopics,
      canonDecision: 'reference_only',
    })
    canonFactCards.push({
      cardKey: key,
      assetType: 'external_web',
      entityType: 'source_grounding',
      entityId: null,
      title,
      summary: snippet,
      ...(result.excerptKind ? { excerptKind: result.excerptKind } : {}),
      sourceTexts: [url, snippet].filter(Boolean),
      sourceKeys: [key],
      confidence,
      verificationStatus: 'web_found',
      canonDecision: 'reference_only',
      updatedAt: recordedAt,
    })
  }

  return { sourceLedgerEntries, canonFactCards }
}

function createDefaultProvider(): ProviderBundle | null {
  try {
    const runtime = getSourceSearchRuntimeConfig()
    if (!runtime.apiKey || !runtime.providerName) return null
    return { name: runtime.providerName, search: (query, options) => executeSourceSearch(runtime, query, options),
      queryCodePointLimit: runtime.protocol === 'deepseek' || runtime.providerName === 'deepseek' ? 128 : undefined }
  } catch {
    return null
  }
}

export async function enrichSourceGroundingFromWeb(
  input: SourceGroundingEnrichmentInput,
  dependencies: {
    provider?: SourceGroundingSearchProvider
    providerName?: string
    now?: () => string
  } = {},
): Promise<SourceGroundingEnrichmentResult> {
  let queries = buildSourceGroundingQueries(input)
  const sourceLedgerJson = input.sourceLedgerJson || ''
  const canonSourceLedgerJson = input.canonSourceLedgerJson || ''
  const canonFactCardsJson = input.canonFactCardsJson || ''
  if (queries.length === 0) {
    return {
      attempted: false,
      updated: false,
      queries,
      diagnostics: ['当前题材和上下文未触发外部网页 grounding。'],
      sourceLedgerJson,
      canonSourceLedgerJson,
      canonFactCardsJson,
      discoveredSourceLedgerEntries: [],
      discoveredCanonFactCards: [],
    }
  }

  const defaultProvider = dependencies.provider ? null : createDefaultProvider()
  if (defaultProvider?.queryCodePointLimit) queries = buildSourceGroundingQueries(input, defaultProvider.queryCodePointLimit)
  const provider = dependencies.provider || defaultProvider?.search
  const providerName = dependencies.providerName || defaultProvider?.name
  if (!provider || !providerName) {
    return {
      attempted: true,
      updated: false,
      queries,
      diagnostics: ['未配置真实网页检索服务；请在“模型与搜索”的“联网搜索配置”中配置搜索平台与 API Key。'],
      sourceLedgerJson,
      canonSourceLedgerJson,
      canonFactCardsJson,
      discoveredSourceLedgerEntries: [],
      discoveredCanonFactCards: [],
    }
  }

  const recordedAt = dependencies.now ? dependencies.now() : new Date().toISOString()
  const sourceLedgerEntries: Record<string, unknown>[] = []
  const canonFactCards: Record<string, unknown>[] = []
  const diagnostics: string[] = []

  for (const query of queries) {
    try {
      const results = await provider(query, {
        maxResults: WEB_GROUNDING_RESULTS_PER_QUERY,
        timeoutMs: WEB_GROUNDING_TIMEOUT_MS,
      })
      const mapped = mapSearchResultsToSourceEntries(input, providerName, query, results, recordedAt)
      sourceLedgerEntries.push(...mapped.sourceLedgerEntries)
      canonFactCards.push(...mapped.canonFactCards)
      if (mapped.sourceLedgerEntries.length === 0) {
        diagnostics.push(`查询无有效结果：${query}`)
      }
    } catch (error) {
      diagnostics.push(`查询失败：${query}；${error instanceof SourceSearchError ? error.message : '检索失败，请检查搜索配置或网络后重试。'}`)
    }
  }

  if (sourceLedgerEntries.length === 0 && canonFactCards.length === 0) {
    return {
      attempted: true,
      updated: false,
      providerName,
      queries,
      diagnostics,
      sourceLedgerJson,
      canonSourceLedgerJson,
      canonFactCardsJson,
      discoveredSourceLedgerEntries: [],
      discoveredCanonFactCards: [],
      recordedAt,
    }
  }

  const nextSourceLedgerJson = upsertJsonRecordArray(sourceLedgerJson, sourceLedgerEntries, 'sourceKey', 400)
  return {
    attempted: true,
    updated: true,
    providerName,
    queries,
    diagnostics,
    sourceLedgerJson: nextSourceLedgerJson,
    canonSourceLedgerJson: upsertJsonRecordArray(canonSourceLedgerJson, sourceLedgerEntries, 'sourceKey', 400),
    canonFactCardsJson: upsertJsonRecordArray(canonFactCardsJson, canonFactCards, 'cardKey', 400),
    discoveredSourceLedgerEntries: sourceLedgerEntries,
    discoveredCanonFactCards: canonFactCards,
    recordedAt,
  }
}
