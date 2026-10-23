import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { foreshadowLedger } from '../database/schema'
import { getNovel } from './novel.service'
import { hashArtifactContent } from './artifact.service'
import { AuthorLibraryError } from './author-library-error'
import { markNovelContextChanged } from './context-impact.service'
import { refreshCommitmentDerivedState } from './endgame-asset.service'
import { remapForeshadowReferences, type ClueMergePreview, type ClueMergeReference } from '../../src/shared/foreshadow-merge'

interface MergeSelection { novelId: number; keepId: number; sourceIds: number[] }
interface MergeInput extends MergeSelection { expectedContextVersion: number; previewFingerprint: string; reason: string; idempotencyKey: string }
const linkFields = ['linkedThreadId', 'linkedEndgameCommitmentId', 'linkedVolumeId'] as const
const fieldLabels = { title: '标题', detail: '内容', status: '状态', sourceChapterId: '埋设章节', sourceSegmentId: '埋设场景', targetPayoffChapter: '计划回收章', actualPayoffChapterId: '实际回收章', requiredEvidence: '回收依据', plantMethod: '埋设方式', payoffMethod: '回收方式', payoffSceneAction: '回收动作', readerVisibleOutcome: '读者可见结果', allowedDelayReason: '延迟理由', salienceLevel: '显著程度', impactScope: '影响范围' } as const

function normalizeSelection<T extends MergeSelection>(input: T) {
  const sourceIds = [...new Set(input.sourceIds)].sort((a, b) => a - b)
  if (!Number.isSafeInteger(input.keepId) || input.keepId < 1 || !sourceIds.length || sourceIds.length > 20 || sourceIds.some(id => !Number.isSafeInteger(id) || id < 1 || id === input.keepId)) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.invalidSelection'))
  return { ...input, sourceIds }
}

function collectReferences(novelId: number, sources: Set<number>, keepId: number): ClueMergeReference[] {
  const sql = getSqlite(), result: ClueMergeReference[] = []
  for (const table of ['chapter_contracts', 'scene_contracts'] as const) {
    const fields = table === 'chapter_contracts' ? ['required_foreshadow_ids_json', 'required_asset_refs_json'] : ['required_foreshadow_ids_json']
    const rows = sql.prepare(`SELECT id,chapter_id,${fields.join(',')} FROM ${table} WHERE novel_id=? ORDER BY id`).all(novelId) as Array<Record<string, string | number | null>>
    for (const row of rows) for (const field of fields) {
      if (row[field] === null || row[field] === '') continue
      let values: unknown
      try { values = JSON.parse(String(row[field])) } catch { throw new AuthorLibraryError(formatUserFacingMessage('author.merge.invalidReferenceJson', { id: row.id })) }
      if (!Array.isArray(values)) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.invalidReferenceArray', { id: row.id }))
      const mapped = remapForeshadowReferences(values, sources, keepId, field === 'required_asset_refs_json')
      if (JSON.stringify(mapped) !== JSON.stringify(values)) result.push({ table, id: Number(row.id), chapterId: Number(row.chapter_id), field, before: String(row[field]), after: JSON.stringify(mapped) })
    }
  }
  for (const config of [
    { table: 'revision_tasks', field: 'entity_id', where: "entity_type='foreshadow' AND COALESCE(status,'open') NOT IN ('resolved','dismissed','cancelled','closed')" },
    { table: 'asset_change_impacts', field: 'target_id', where: "target_type='foreshadow' AND resolution_status='pending'" },
  ] as const) {
    const rows = sql.prepare(`SELECT id,chapter_id,${config.field} AS ref FROM ${config.table} WHERE novel_id=? AND ${config.where} ORDER BY id`).all(novelId) as Array<{ id: number; chapter_id: number | null; ref: number }>
    for (const row of rows) if (sources.has(row.ref)) result.push({ table: config.table, id: row.id, chapterId: row.chapter_id, field: config.field, before: row.ref, after: keepId })
  }
  return result
}

export function previewClueMerge(selection: MergeSelection): ClueMergePreview {
  const input = normalizeSelection(selection), novel = getNovel(input.novelId)
  if (!novel) throw new AuthorLibraryError(formatUserFacingMessage('author.project.notFound'))
  const rows = getDb().select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, input.novelId)).all()
  const keep = rows.find(row => row.id === input.keepId), sources = input.sourceIds.map(id => rows.find(row => row.id === id))
  if (!keep || sources.some(row => !row)) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.wrongProject'))
  if (keep.mergedIntoId || sources.some(row => row?.mergedIntoId)) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.historySelected'))
  const sourceRows = sources.filter((row): row is NonNullable<typeof row> => Boolean(row))
  const blockers: string[] = [], inheritedLinks: Record<string, number | null> = {}
  for (const field of linkFields) {
    const values = [...new Set([keep, ...sourceRows].map(row => row[field]).filter((value): value is number => value !== null))]
    if (values.length > 1) blockers.push(`关联冲突：${({ linkedThreadId: '故事线', linkedEndgameCommitmentId: '结局承诺', linkedVolumeId: '卷' })[field]}分别为 ${values.map(id => `#${id}`).join('、')}，请先核对关联。`)
    inheritedLinks[field] = values[0] ?? null
  }
  const aliases = rows.filter(row => row.mergedIntoId && input.sourceIds.includes(row.mergedIntoId))
  const ids = new Set([...input.sourceIds, ...aliases.map(row => row.id)])
  const references = collectReferences(input.novelId, ids, keep.id)
  const differences = sourceRows.map(row => ({ id: row.id, fields: (Object.keys(fieldLabels) as Array<keyof typeof fieldLabels>).filter(field => (row[field] ?? '') !== (keep[field] ?? '')).map(field => ({ field, label: fieldLabels[field], kept: keep[field], original: row[field] })) }))
  return { contextVersion: novel.contextVersion ?? 1, fingerprint: hashArtifactContent({ contextVersion: novel.contextVersion, keep, sources: sourceRows, aliases, references }), keep, sources: sourceRows, references, differences, blockers, inheritedLinks, aliasIds: aliases.map(row => row.id) }
}

export function mergeAuthorClues(raw: MergeInput) {
  const input = { ...normalizeSelection(raw), reason: raw.reason.trim() }
  if (!input.reason || input.reason.length > 1200) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.invalidReason'))
  const sql = getSqlite(), inputHash = hashArtifactContent(input)
  return sql.transaction(() => {
    const prior = sql.prepare("SELECT merge_info_json FROM foreshadow_ledger WHERE novel_id=? AND json_valid(merge_info_json) AND json_extract(merge_info_json,'$.idempotencyKey')=? LIMIT 1").get(input.novelId, input.idempotencyKey) as { merge_info_json: string } | undefined
    if (prior) {
      const record = JSON.parse(prior.merge_info_json)
      if (record.inputHash !== inputHash) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.idempotencyConflict'))
      return { keepId: record.keepId as number, idempotentReplay: true }
    }
    const preview = previewClueMerge(input)
    if (preview.contextVersion !== input.expectedContextVersion || preview.fingerprint !== input.previewFingerprint) throw new AuthorLibraryError(formatUserFacingMessage('author.merge.stalePreview'))
    if (preview.blockers.length) throw new AuthorLibraryError(preview.blockers.join('；'))
    const timestamp = new Date().toISOString()
    const record = { inputHash, idempotencyKey: input.idempotencyKey, keepId: input.keepId, sourceIds: input.sourceIds, reason: input.reason, mergedAt: timestamp, keepBefore: preview.keep, sourcesBefore: preview.sources, references: preview.references }
    for (const ref of preview.references) sql.prepare(`UPDATE ${ref.table} SET ${ref.field}=?,updated_at=? WHERE novel_id=? AND id=?`).run(ref.after, timestamp, input.novelId, ref.id)
    for (const id of input.sourceIds) sql.prepare("UPDATE foreshadow_ledger SET merged_into_id=?,merge_info_json=?,status='merged',author_corrected_at=?,updated_at=? WHERE novel_id=? AND id=?").run(input.keepId, JSON.stringify(record), timestamp, timestamp, input.novelId, id)
    for (const id of preview.aliasIds) sql.prepare('UPDATE foreshadow_ledger SET merged_into_id=?,updated_at=? WHERE novel_id=? AND id=?').run(input.keepId, timestamp, input.novelId, id)
    sql.prepare('UPDATE foreshadow_ledger SET linked_thread_id=?,linked_endgame_commitment_id=?,linked_volume_id=?,author_corrected_at=?,updated_at=? WHERE novel_id=? AND id=?').run(preview.inheritedLinks.linkedThreadId, preview.inheritedLinks.linkedEndgameCommitmentId, preview.inheritedLinks.linkedVolumeId, timestamp, timestamp, input.novelId, input.keepId)
    refreshCommitmentDerivedState(input.novelId)
    markNovelContextChanged(input.novelId, '作者合并重复线索，合同引用已迁移')
    return { keepId: input.keepId, idempotentReplay: false }
  }).immediate()
}
