import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { createHash } from 'node:crypto'
import {
  creativeResearchTopics,
  getCreativeResearchSourceKey,
  isCreativeResearchEntry,
  parseCreativeResearchEntries,
  readCreativeResearchSources,
  removeCreativeResearchEntry,
  selectCreativeResearchSources,
  upsertCreativeResearchEntries,
  type CreativeResearchDraft,
  type CreativeResearchEntry,
  type CreativeResearchResult,
} from '../../src/shared/creative-research'
import { getSqlite } from '../database/db'
import { getNovel, updateNovel } from './novel.service'
import { listChapters } from './chapter.service'
import { enrichSourceGroundingFromWeb, mergeSourceGroundingEnrichmentIntoCurrent, type SourceGroundingSearchProvider } from './source-grounding-search.service'

function ledger(raw?: string | null): Record<string, unknown>[] {
  try { const value: unknown = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [] } catch { return [] }
}
export function listCreativeResearch(novelId: number, query = '') {
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('services.projectNotFound'))
  return query.trim() ? selectCreativeResearchSources(novel.sourceLedgerJson, query, 12) : readCreativeResearchSources(novel.sourceLedgerJson).reverse()
}

export interface AuthorCreativeResearchQuery {
  query?: string
  category?: string
  limit?: number
}

export function listAuthorCreativeResearch(novelId: number, query: AuthorCreativeResearchQuery = {}): CreativeResearchEntry[] {
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('services.projectNotFound'))
  const keyword = query.query?.trim().toLocaleLowerCase() || ''
  const category = query.category?.trim() || ''
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(200, query.limit!)) : 100
  return parseCreativeResearchEntries(novel.sourceLedgerJson)
    .filter(entry => !category || entry.category === category)
    .filter(entry => !keyword || [entry.title, entry.sourceTitle, entry.content, entry.interpretation, entry.novelConnection, ...(entry.tags || [])]
      .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(keyword)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}

export function getAuthorCreativeResearch(novelId: number, sourceKey: string): CreativeResearchEntry {
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('services.projectNotFound'))
  const entry = parseCreativeResearchEntries(novel.sourceLedgerJson).find(item => item.sourceKey === sourceKey)
  if (!entry) throw new Error(formatUserFacingMessage('services.creativeResearch.notFound'))
  return entry
}

export function upsertAuthorCreativeResearch(novelId: number, drafts: CreativeResearchDraft[], expectedContextVersion?: number): CreativeResearchEntry[] {
  if (!Number.isSafeInteger(novelId) || novelId < 1) throw new Error(formatUserFacingMessage('services.research.projectIdInvalid'))
  if (!Array.isArray(drafts) || drafts.length < 1 || drafts.length > 100) throw new Error(formatUserFacingMessage('services.creativeResearch.batchInvalid'))
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('services.projectNotFound'))
  const ledger = upsertCreativeResearchEntries(novel.sourceLedgerJson, drafts)
  updateNovel(novelId, { sourceLedgerJson: JSON.stringify(ledger) }, { expectedContextVersion: expectedContextVersion ?? Math.max(1, novel.contextVersion || 1) })
  const savedKeys = new Set(drafts.map(getCreativeResearchSourceKey))
  const updated = getNovel(novelId)
  return parseCreativeResearchEntries(updated?.sourceLedgerJson).filter(entry => savedKeys.has(entry.sourceKey))
}

export function deleteAuthorCreativeResearch(novelId: number, sourceKey: string, expectedContextVersion?: number): void {
  if (!Number.isSafeInteger(novelId) || novelId < 1) throw new Error(formatUserFacingMessage('services.research.projectIdInvalid'))
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('services.projectNotFound'))
  const existing = parseCreativeResearchEntries(novel.sourceLedgerJson).find(entry => entry.sourceKey === sourceKey)
  if (!existing || !isCreativeResearchEntry(existing)) throw new Error(formatUserFacingMessage('services.creativeResearch.notFound'))
  const ledger = removeCreativeResearchEntry(novel.sourceLedgerJson, sourceKey)
  updateNovel(novelId, { sourceLedgerJson: JSON.stringify(ledger) }, { expectedContextVersion: expectedContextVersion ?? Math.max(1, novel.contextVersion || 1) })
}

/** The only persisted field is the source ledger; no Canon, prose or atlas records are changed. */
export async function searchCreativeResearch(
  novelId: number, request: string, atChapter?: number,
  dependencies: { provider?: SourceGroundingSearchProvider; providerName?: string; now?: () => string; expectedContextVersion?: number; beforeSave?: () => void } = {},
): Promise<CreativeResearchResult> {
  if (!Number.isInteger(novelId) || novelId < 1) throw new Error(formatUserFacingMessage('services.research.projectIdInvalid'))
  if (typeof request !== 'string' || !request.trim() || request.length > 12000) throw new Error(formatUserFacingMessage('services.research.requestLengthInvalid'))
  if (atChapter !== undefined && (!Number.isInteger(atChapter) || atChapter < 0)) throw new Error(formatUserFacingMessage('services.chapterPositionInvalid'))
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('services.projectNotFound'))
  const version = novel.contextVersion || 1
  if (dependencies.expectedContextVersion !== undefined && dependencies.expectedContextVersion !== version) throw new Error(formatUserFacingMessage('services.research.contextChangedBeforeSearch'))
  const requestKey = createHash('sha256').update(request.trim().replace(/\s+/gu, ' ')).digest('hex').slice(0, 24)
  const now = dependencies.now?.() || new Date().toISOString()
  const cachedRows = ledger(novel.sourceLedgerJson).filter(row => Array.isArray(row.researchRequestKeys) && row.researchRequestKeys.includes(requestKey)
    && typeof row.recordedAt === 'string' && new Date(now).getTime() - new Date(row.recordedAt).getTime() >= 0
    && new Date(now).getTime() - new Date(row.recordedAt).getTime() < 7 * 24 * 60 * 60 * 1000)
  const cached = readCreativeResearchSources(JSON.stringify(cachedRows))
  if (cached.length) return { attempted: false, updated: false, cached: true, queries: [...new Set(cached.map(source => source.query))], diagnostics: ['已复用本周同一资料需求的检索摘要。'], sources: cached, contextVersion: version }
  const chapter = atChapter ? listChapters(novelId).find(row => row.chapterNum === atChapter) : undefined
  const topics = creativeResearchTopics(request)
  const result = await enrichSourceGroundingFromWeb({ novelId, chapterId: chapter?.id || 0, chapterNum: atChapter || 0,
    researchRequest: request.trim(), researchTopics: topics, sourceLedgerJson: novel.sourceLedgerJson,
  }, dependencies)
  if (!result.updated) return { attempted: result.attempted, updated: false, cached: false, queries: result.queries, diagnostics: result.diagnostics, sources: [], contextVersion: version }
  dependencies.beforeSave?.()
  return getSqlite().transaction(() => {
    const current = getNovel(novelId)
    if (!current || (current.contextVersion || 1) !== version) throw new Error(formatUserFacingMessage('services.research.contextChangedDuringSearch'))
    const existing = ledger(current.sourceLedgerJson)
    const discoveredSourceLedgerEntries = result.discoveredSourceLedgerEntries.map(row => {
      const previous = existing.find(entry => entry.sourceKey === row.sourceKey)
      const previousTopics = Array.isArray(previous?.researchTopics) ? previous.researchTopics : []
      const previousKeys = Array.isArray(previous?.researchRequestKeys) ? previous.researchRequestKeys : []
      return { ...row, researchTopics: [...new Set([...previousTopics, ...topics])],
        researchRequestKeys: [...new Set([...previousKeys, requestKey])].slice(-20), canonDecision: 'reference_only' }
    })
    // Preserve all existing story provenance; research must never evict chapter writeback evidence.
    const merged = mergeSourceGroundingEnrichmentIntoCurrent({ sourceLedgerJson: current.sourceLedgerJson }, { discoveredSourceLedgerEntries, discoveredCanonFactCards: [] })
    updateNovel(novelId, { sourceLedgerJson: merged.sourceLedgerJson })
    const saved = getNovel(novelId)!
    const resultKeys = new Set(result.discoveredSourceLedgerEntries.map(row => row.sourceKey))
    return { attempted: true, updated: true, cached: false, queries: result.queries, diagnostics: result.diagnostics,
      sources: readCreativeResearchSources(saved.sourceLedgerJson).filter(source => resultKeys.has(source.sourceKey)), contextVersion: saved.contextVersion || 1 }
  }).immediate()
}
