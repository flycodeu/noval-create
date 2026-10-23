import { AuthorLibraryError } from './author-library-error'
import { and, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapters, novels, styleFingerprints } from '../database/schema'
import { getNovel } from './novel.service'
import * as style from './style-analysis.service'
import { styleSourceDigest } from '../../src/shared/style-source'
import { computeStyleStats } from '../../src/shared/style-fingerprint-stats'

function requireNovel(novelId: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new AuthorLibraryError('作品不存在。')
  return novel
}
export function listAuthorStyles(novelId: number) {
  const novel = requireNovel(novelId)
  const samples = getSqlite().prepare("SELECT id,name,novel_id AS novelId,source_type AS sourceType,created_at AS createdAt FROM style_fingerprints WHERE novel_id IS NOT NULL AND length(trim(source_text))>0 ORDER BY (novel_id=?) DESC,created_at DESC,id DESC LIMIT 100").all(novelId)
  const activeId = getDb().select({ id: novels.activeStyleFingerprintId }).from(novels).where(eq(novels.id, novelId)).get()?.id ?? null
  return { samples, activeId, contextVersion: novel.contextVersion, diagnostics: style.resolveAuthorStyleMaterial(novelId).styleSourceDiagnostics }
}
export function getAuthorStyle(id: number) {
  const payload = style.getStyleFingerprintPayload(id)
  if (!payload?.record?.sourceText?.trim() || payload.record.novelId === null) throw new AuthorLibraryError('样稿不存在或没有原文。')
  return { ...payload, stats: computeStyleStats(payload.record.sourceText) }
}
export async function analyzeAuthorStyle(input: { novelId: number; name: string; text?: string; chapterIds?: number[] }) {
  const novel = requireNovel(input.novelId)
  if (!input.name.trim() || input.name.length > 120) throw new AuthorLibraryError('请填写不超过 120 字的样稿名。')
  if (input.chapterIds?.length && input.text?.trim()) throw new AuthorLibraryError('请只选择粘贴文本或本作章节其中一种来源。')
  let id: number
  if (input.chapterIds?.length) {
    if (input.chapterIds.length > 20 || new Set(input.chapterIds).size !== input.chapterIds.length) throw new AuthorLibraryError('一次选择 1–20 个不同章节。')
    const rows = getDb().select().from(chapters).where(eq(chapters.novelId, input.novelId)).all().filter(row => input.chapterIds!.includes(row.id))
    if (rows.length !== input.chapterIds.length || rows.some(row => !row.content?.trim())) throw new AuthorLibraryError('所选章节须属于本作且有已保存正文。')
    if (rows.map(row => row.content || '').join('\n\n').length > 48000) throw new AuthorLibraryError('所选章节超过 48000 字符，请缩小范围。')
    id = await style.createStyleFingerprintFromChapters(input.novelId, input.name, input.chapterIds, novel.modelConfigId || undefined)
  } else {
    if (!input.text?.trim() || input.text.length > 48000) throw new AuthorLibraryError('请提供 1–48000 字符的实际样稿正文。')
    id = await style.createStyleFingerprint(input.novelId, input.name, input.text, novel.modelConfigId || undefined)
  }
  return getAuthorStyle(id)
}
export function copyAuthorStyle(novelId: number, sourceId: number) {
  requireNovel(novelId)
  const source = getAuthorStyle(sourceId)
  const reference = JSON.stringify({ sourceId, sourceName: source.record.name, digest: styleSourceDigest(source.record) })
  const existing = getDb().select().from(styleFingerprints).where(and(eq(styleFingerprints.novelId, novelId), eq(styleFingerprints.sourceReferenceJson, reference))).get()
  if (existing) return getAuthorStyle(existing.id)
  const result = getDb().insert(styleFingerprints).values({ novelId, name: `复用：${source.record.name}`.slice(0, 120), sourceType: 'pasted', sourceText: source.record.sourceText,
    fingerprintJson: source.record.fingerprintJson, statsJson: JSON.stringify(source.stats), sourceReferenceJson: reference }).run()
  return getAuthorStyle(Number(result.lastInsertRowid))
}
export function approveAuthorStyle(novelId: number, id: number | null, expectedContextVersion: number) {
  return getSqlite().transaction(() => {
    const novel = requireNovel(novelId)
    if (novel.contextVersion !== expectedContextVersion) throw new AuthorLibraryError('作品已变化，请刷新样稿后重新认可。')
    if (id !== null && getAuthorStyle(id).record.novelId !== novelId) throw new AuthorLibraryError('请先将其他作品的样稿复制到本作，再决定是否认可。')
    style.setActiveStyleFingerprint(novelId, id)
    return listAuthorStyles(novelId)
  })()
}
export async function trialAuthorStyle(novelId: number, fingerprintId: number, sceneBrief: string) {
  const novel = requireNovel(novelId)
  if (!sceneBrief.trim() || sceneBrief.length > 4000) throw new AuthorLibraryError('请填写不超过 4000 字的场景梗概。')
  return style.runStyleAbTest(novelId, fingerprintId, sceneBrief, novel.modelConfigId || undefined, { descriptiveOnly: true })
}
export function approveAuthorTrial(novelId: number, text: string, expectedContextVersion: number) {
  if (!text.trim() || text.length > 50000) throw new AuthorLibraryError('请选择一份非空且不超过 50000 字符的试写。')
  return getSqlite().transaction(() => {
    const novel = requireNovel(novelId)
    if (novel.contextVersion !== expectedContextVersion) throw new AuthorLibraryError('作品已变化，请刷新后重新认可试写。试写原文仍保留。')
    const id = style.approveStyleTrial(novelId, text)
    return getAuthorStyle(id)
  })()
}
