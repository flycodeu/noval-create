import { createHash } from 'node:crypto'
import { creativeResearchTopics, readCreativeResearchSources, selectCreativeResearchSources, type CreativeResearchResult } from '../../src/shared/creative-research'
import { getSqlite } from '../database/db'
import { getNovel, updateNovel } from './novel.service'
import { listChapters } from './chapter.service'
import { enrichSourceGroundingFromWeb, type SourceGroundingSearchProvider } from './source-grounding-search.service'

function ledger(raw?: string | null): Record<string, unknown>[] {
  try { const value: unknown = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [] } catch { return [] }
}
export function listCreativeResearch(novelId: number, query = '') {
  const novel = getNovel(novelId)
  if (!novel) throw new Error('项目不存在。')
  return query.trim() ? selectCreativeResearchSources(novel.sourceLedgerJson, query, 12) : readCreativeResearchSources(novel.sourceLedgerJson).reverse()
}

/** The only persisted field is the source ledger; no Canon, prose or atlas records are changed. */
export async function searchCreativeResearch(
  novelId: number, request: string, atChapter?: number,
  dependencies: { provider?: SourceGroundingSearchProvider; providerName?: string; now?: () => string; expectedContextVersion?: number; beforeSave?: () => void } = {},
): Promise<CreativeResearchResult> {
  if (!Number.isInteger(novelId) || novelId < 1) throw new Error('项目编号无效。')
  if (typeof request !== 'string' || !request.trim() || request.length > 12000) throw new Error('资料需求为 1–12000 个字符。')
  if (atChapter !== undefined && (!Number.isInteger(atChapter) || atChapter < 0)) throw new Error('章位必须为非负整数。')
  const novel = getNovel(novelId)
  if (!novel) throw new Error('项目不存在。')
  const version = novel.contextVersion || 1
  if (dependencies.expectedContextVersion !== undefined && dependencies.expectedContextVersion !== version) throw new Error('检索前项目资料已变化，请重新启动任务。')
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
    if (!current || (current.contextVersion || 1) !== version) throw new Error('检索期间项目资料已变化，未保存本次结果，请重新检索。')
    const byKey = new Map<string, Record<string, unknown>>()
    const other: Record<string, unknown>[] = []
    for (const row of ledger(current.sourceLedgerJson)) {
      if (typeof row.sourceKey === 'string') byKey.set(row.sourceKey, row)
      else other.push(row)
    }
    for (const row of result.discoveredSourceLedgerEntries) {
      const key = String(row.sourceKey), previous = byKey.get(key)
      const previousTopics = Array.isArray(previous?.researchTopics) ? previous.researchTopics : []
      const previousKeys = Array.isArray(previous?.researchRequestKeys) ? previous.researchRequestKeys : []
      byKey.set(key, { ...previous, ...row, researchTopics: [...new Set([...previousTopics, ...topics])],
        researchRequestKeys: [...new Set([...previousKeys, requestKey])].slice(-20), canonDecision: 'reference_only' })
    }
    // Preserve all existing story provenance; research must never evict chapter writeback evidence.
    updateNovel(novelId, { sourceLedgerJson: JSON.stringify([...other, ...byKey.values()]) })
    const saved = getNovel(novelId)!
    const resultKeys = new Set(result.discoveredSourceLedgerEntries.map(row => row.sourceKey))
    return { attempted: true, updated: true, cached: false, queries: result.queries, diagnostics: result.diagnostics,
      sources: readCreativeResearchSources(saved.sourceLedgerJson).filter(source => resultKeys.has(source.sourceKey)), contextVersion: saved.contextVersion || 1 }
  }).immediate()
}
