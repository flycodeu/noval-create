import { AuthorLibraryError } from './author-library-error'
import { getSqlite } from '../database/db'
import { getNovel, updateNovel } from './novel.service'
import { getCreativeResearch } from './creative-research.service'
import { hashArtifactContent } from './artifact.service'
import { CREATIVE_RESEARCH_CATEGORIES, parseCreativeResearchEntries, upsertCreativeResearchEntries } from '../../src/shared/creative-research'
import { personalResearchContent, type PersonalResearchCard } from '../../src/shared/personal-research'

interface Row { id: string; revision: number; content_json: string; archived: number; created_at: string; updated_at: string }
const card = (row: Row): PersonalResearchCard => ({ id: row.id, revision: row.revision, content: JSON.parse(row.content_json), archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at })
export function getPersonalResearch(id: string) {
  const row = getSqlite().prepare('SELECT * FROM personal_research WHERE id=?').get(id) as Row | undefined
  if (!row) throw new AuthorLibraryError('个人资料不存在。')
  return card(row)
}
export function listPersonalResearch(query = '', includeArchived = false, category = ''): PersonalResearchCard[] {
  if (query.length > 200) throw new AuthorLibraryError('搜索词最多 200 字。')
  if (category && !CREATIVE_RESEARCH_CATEGORIES.some(item => item.value === category)) throw new AuthorLibraryError('资料分类无效。')
  // instr treats percent and underscore as literal keywords, unlike LIKE wildcards.
  const rows = getSqlite().prepare('SELECT * FROM personal_research WHERE (?=1 OR archived=0) AND (?=\'\' OR instr(lower(content_json),lower(?))>0) AND (?=\'\' OR json_extract(content_json,\'$.category\')=?) ORDER BY updated_at DESC,id LIMIT 200').all(includeArchived ? 1 : 0, query.trim(), query.trim(), category, category) as Row[]
  return rows.map(card)
}
export function publishPersonalResearch(novelId: number, sourceKey: string) {
  return getSqlite().transaction(() => {
    const entry = getCreativeResearch(novelId, sourceKey)
    const id = hashArtifactContent({ novelId, sourceKey }).replace('sha256:', '')
    const existing = getSqlite().prepare('SELECT * FROM personal_research WHERE id=?').get(id) as Row | undefined
    if (existing) return card(existing) // Repeated publication must never overwrite later personal edits.
    const content = { ...personalResearchContent(entry), ...(entry.provenance ? { provenance: entry.provenance } : {}) }
    const now = new Date().toISOString()
    getSqlite().prepare('INSERT INTO personal_research(id,content_json,created_at,updated_at) VALUES(?,?,?,?)').run(id, JSON.stringify(content), now, now)
    return getPersonalResearch(id)
  })()
}
export function updatePersonalResearch(id: string, expectedRevision: number, value: unknown, archived: boolean) {
  return getSqlite().transaction(() => {
    const current = getPersonalResearch(id)
    if (current.revision !== expectedRevision) throw new AuthorLibraryError('个人资料已有新版，请重新打开后编辑。当前修改尚未保存。')
    // Provenance is an immutable source snapshot, independent of the originating novel/artifact.
    const content = { ...personalResearchContent(value), ...(current.content.provenance ? { provenance: current.content.provenance } : {}) }
    if (hashArtifactContent(content) === hashArtifactContent(current.content) && archived === current.archived) return current
    getSqlite().prepare('UPDATE personal_research SET revision=revision+1,content_json=?,archived=?,updated_at=? WHERE id=? AND revision=?')
      .run(JSON.stringify(content), archived ? 1 : 0, new Date().toISOString(), id, expectedRevision)
    return getPersonalResearch(id)
  })()
}
export function referencePersonalResearch(input: { novelId: number; cardId: string; expectedRevision: number; expectedContextVersion: number; novelConnection: string }) {
  return getSqlite().transaction(() => {
    const novel = getNovel(input.novelId)
    if (!novel) throw new AuthorLibraryError('作品不存在。')
    const shared = getPersonalResearch(input.cardId)
    if (shared.archived) throw new AuthorLibraryError('这条个人资料已归档，不能新增或更新引用。')
    if (shared.revision !== input.expectedRevision) throw new AuthorLibraryError('个人资料已有新版，请重新查看后采用。')
    const sourceKey = `author:shared:${shared.id}`
    const current = parseCreativeResearchEntries(novel.sourceLedgerJson).find(entry => entry.sourceKey === sourceKey)
    if (current?.sharedReference?.revision === shared.revision) return current
    if (novel.contextVersion !== input.expectedContextVersion) throw new AuthorLibraryError('作品资料已变化，请刷新后再采用。')
    const entries = upsertCreativeResearchEntries(novel.sourceLedgerJson, [{ ...shared.content, sourceKey, novelConnection: current?.novelConnection || input.novelConnection }])
    const entry = entries.find(item => item.sourceKey === sourceKey)!
    entry.sharedReference = { cardId: shared.id, revision: shared.revision }
    if (shared.content.provenance) entry.provenance = shared.content.provenance
    updateNovel(input.novelId, { sourceLedgerJson: JSON.stringify(entries) })
    return parseCreativeResearchEntries(JSON.stringify(entries)).find(item => item.sourceKey === sourceKey)!
  })()
}
