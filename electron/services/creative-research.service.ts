import type { CreativeResearchDraft, CreativeResearchEntry } from '../../src/shared/creative-research'
import {
  getCreativeResearchSourceKey,
  isCreativeResearchEntry,
  parseCreativeResearchEntries,
  removeCreativeResearchEntry,
  upsertCreativeResearchEntries,
} from '../../src/shared/creative-research'
import { getNovel, updateNovel } from './novel.service'

export interface CreativeResearchQuery {
  query?: string
  category?: string
  limit?: number
}

function requireNovel(novelId: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new Error('作品不存在。')
  return novel
}

export function listCreativeResearch(novelId: number, query: CreativeResearchQuery = {}): CreativeResearchEntry[] {
  const novel = requireNovel(novelId)
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

export function getCreativeResearch(novelId: number, sourceKey: string): CreativeResearchEntry {
  const novel = requireNovel(novelId)
  const entry = parseCreativeResearchEntries(novel.sourceLedgerJson).find(item => item.sourceKey === sourceKey)
  if (!entry) throw new Error('没有找到这条作者创作资料。')
  return entry
}

export function upsertCreativeResearch(novelId: number, drafts: CreativeResearchDraft[]): CreativeResearchEntry[] {
  if (!Array.isArray(drafts) || drafts.length < 1 || drafts.length > 100) {
    throw new Error('一次需要提交 1 到 100 条创作资料。')
  }
  const novel = requireNovel(novelId)
  const ledger = upsertCreativeResearchEntries(novel.sourceLedgerJson, drafts)
  updateNovel(novelId, { sourceLedgerJson: JSON.stringify(ledger) })
  const savedKeys = new Set(drafts.map(getCreativeResearchSourceKey))
  const saved = parseCreativeResearchEntries(JSON.stringify(ledger))
  return saved.filter(entry => savedKeys.has(entry.sourceKey))
}

export function deleteCreativeResearch(novelId: number, sourceKey: string): void {
  const novel = requireNovel(novelId)
  const entry = parseCreativeResearchEntries(novel.sourceLedgerJson).find(item => item.sourceKey === sourceKey)
  if (!entry || !isCreativeResearchEntry(entry)) throw new Error('没有找到这条作者创作资料。')
  const ledger = removeCreativeResearchEntry(novel.sourceLedgerJson, sourceKey)
  updateNovel(novelId, { sourceLedgerJson: JSON.stringify(ledger) })
}
