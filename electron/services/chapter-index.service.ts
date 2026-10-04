import { getSqlite } from '../database/db'
import { getModelConfigRecord } from './model.service'
import { generateChapterEmbeddings, indexChapterForKeywordRecall } from './embedding.service'

export interface ChapterIndexQueueClaim { id: number; novelId: number; sourceId: number; revision: number; operation: string }

function requireNovel(novelId: number): { modelConfigId: number | null } {
  if (!Number.isSafeInteger(novelId) || novelId <= 0) throw new Error('novelId 必须是正整数。')
  const novel = getSqlite().prepare('SELECT model_config_id AS modelConfigId FROM novels WHERE id = ?').get(novelId) as { modelConfigId: number | null } | undefined
  if (!novel) throw new Error('项目不存在。')
  return novel
}

export function getChapterIndexStatus(novelId: number) {
  requireNovel(novelId)
  const sqlite = getSqlite()
  const counts = sqlite.prepare(`
    SELECT COUNT(*) AS savedChapterCount,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM chapter_embeddings e WHERE e.chapter_id = c.id AND e.novel_id = c.novel_id AND e.fragment_type LIKE 'content_excerpt%') THEN 1 ELSE 0 END) AS keywordIndexedChapterCount,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM chapter_embeddings e WHERE e.chapter_id = c.id AND e.novel_id = c.novel_id AND e.fragment_type LIKE 'content_excerpt%' AND e.embedding_json IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM chapter_embeddings e WHERE e.chapter_id = c.id AND e.novel_id = c.novel_id AND e.fragment_type LIKE 'content_excerpt%' AND e.embedding_json IS NULL) THEN 1 ELSE 0 END) AS vectorIndexedChapterCount
    FROM chapters c WHERE c.novel_id = ? AND length(trim(COALESCE(c.content, ''))) > 0
  `).get(novelId) as Record<string, number | null>
  const queue = sqlite.prepare(`
    SELECT status, COUNT(*) AS count FROM semantic_memory_outbox
    WHERE novel_id = ? AND source_type = 'chapter' GROUP BY status
  `).all(novelId) as Array<{ status: string; count: number }>
  const errors = sqlite.prepare(`
    SELECT source_id AS chapterId, status, last_error AS message FROM semantic_memory_outbox
    WHERE novel_id = ? AND source_type = 'chapter' AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 10
  `).all(novelId)
  return { novelId, savedChapterCount: Number(counts.savedChapterCount || 0),
    keywordIndexedChapterCount: Number(counts.keywordIndexedChapterCount || 0),
    vectorIndexedChapterCount: Number(counts.vectorIndexedChapterCount || 0),
    keywordFallbackAvailable: true,
    queue: Object.fromEntries(['pending', 'processing', 'failed', 'dead_letter'].map(status => [status, queue.find(row => row.status === status)?.count || 0])),
    errors }
}

/** Rebuild only the currently saved chapters; artifacts and empty future plans are never read. */
export function rebuildChapterIndex(input: { novelId: number; throughChapter?: number; vectors?: boolean }) {
  const novel = requireNovel(input.novelId)
  if (input.throughChapter !== undefined && (!Number.isSafeInteger(input.throughChapter) || input.throughChapter <= 0)) throw new Error('throughChapter 必须是正整数。')
  if (input.vectors && novel.modelConfigId) {
    try { getModelConfigRecord(novel.modelConfigId) } catch { throw new Error('项目模型配置已失效，请先在设置中选择可用模型；文字检索仍可使用。') }
  }
  const sqlite = getSqlite()
  let lastId = 0, rebuiltChapterCount = 0
  const enqueue = sqlite.prepare(`
    INSERT INTO semantic_memory_outbox (novel_id, source_type, source_id, operation, context_version)
    SELECT novel_id, 'chapter', id, 'upsert_remote', COALESCE(context_version, 1) FROM chapters WHERE id = ? AND novel_id = ?
    ON CONFLICT(novel_id, source_type, source_id) DO UPDATE SET
      operation = excluded.operation, revision = semantic_memory_outbox.revision + 1, status = 'pending', attempts = 0,
      available_at = CURRENT_TIMESTAMP, locked_at = NULL, last_error = NULL,
      context_version = excluded.context_version, updated_at = CURRENT_TIMESTAMP
  `)
  while (true) {
    const page = sqlite.prepare(`SELECT id FROM chapters WHERE novel_id = ? AND id > ?
      AND length(trim(COALESCE(content, ''))) > 0 ${input.throughChapter ? 'AND chapter_num <= ?' : ''} ORDER BY id LIMIT 100`)
      .all(input.novelId, lastId, ...(input.throughChapter ? [input.throughChapter] : [])) as Array<{ id: number }>
    if (!page.length) break
    sqlite.transaction(() => {
      for (const chapter of page) {
        indexChapterForKeywordRecall(input.novelId, chapter.id, novel.modelConfigId || undefined, { proseOnly: true })
        if (input.vectors) enqueue.run(chapter.id, input.novelId)
        rebuiltChapterCount += 1
      }
    })()
    lastId = page.at(-1)!.id
  }
  return { rebuiltChapterCount, remoteVectorsRequested: input.vectors === true, ...getChapterIndexStatus(input.novelId) }
}

/** The shared outbox owns retries and leases; source hashes guard commits after an edit. */
export async function processChapterIndexClaim(claim: ChapterIndexQueueClaim): Promise<boolean> {
  const sqlite = getSqlite()
  if (!sqlite.prepare("SELECT id FROM semantic_memory_outbox WHERE id = ? AND revision = ? AND status = 'processing'").get(claim.id, claim.revision)) return false
  const novel = sqlite.prepare('SELECT model_config_id AS modelConfigId FROM novels WHERE id = ?').get(claim.novelId) as { modelConfigId: number | null } | undefined
  if (!novel) return false
  const chapter = sqlite.prepare('SELECT content FROM chapters WHERE id = ? AND novel_id = ?').get(claim.sourceId, claim.novelId) as { content: string | null } | undefined
  if (!chapter?.content?.trim()) {
    sqlite.prepare('DELETE FROM chapter_embeddings WHERE chapter_id = ? AND novel_id = ?').run(claim.sourceId, claim.novelId)
    return sqlite.prepare("DELETE FROM semantic_memory_outbox WHERE id = ? AND revision = ? AND status = 'processing'").run(claim.id, claim.revision).changes > 0
  }
  if (claim.operation === 'upsert_remote' && novel.modelConfigId) {
    try { getModelConfigRecord(novel.modelConfigId) } catch { throw new Error('项目模型配置已失效，请重新选择模型；已保存的文字索引继续可用。') }
  }
  indexChapterForKeywordRecall(claim.novelId, claim.sourceId, novel.modelConfigId || undefined, { proseOnly: true })
  const result = await generateChapterEmbeddings(claim.novelId, claim.sourceId, novel.modelConfigId || undefined, { proseOnly: true, allowRemote: claim.operation === 'upsert_remote' })
  if (!result.applied) {
    // An edit trigger has already queued a newer revision. Never acknowledge that new work.
    return false
  }
  if (result.vectorizedCount < result.documentCount) throw new Error('向量模型不可用，章节文字检索已保存；后台会有限重试，可修复模型配置后重新请求索引。')
  const removed = sqlite.prepare("DELETE FROM semantic_memory_outbox WHERE id = ? AND revision = ? AND status = 'processing'").run(claim.id, claim.revision)
  return removed.changes > 0
}
