import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space } from 'antd'
import type { AuthorClue } from '../../../shared/author-ledger'
import { CLUE_STATUSES } from '../../../shared/author-ledger'
import { selectClueMergeKeep, type ClueMergePreview } from '../../../shared/foreshadow-merge'
import type { Chapter } from '../../../types'
import { callAuthorTool } from './workflow-client'
import './author-assist.css'

export default function ClueMergeDialog({ novelId, clues, initialIds, chapters, onClose, onMerged }: {
  novelId: number; clues: AuthorClue[]; initialIds: number[]; chapters: Chapter[]; onClose: () => void; onMerged: () => Promise<void>
}) {
  const [selection, setSelection] = useState({ keepId: initialIds[0], sourceIds: initialIds.slice(1) })
  const { keepId, sourceIds } = selection
  const [preview, setPreview] = useState<ClueMergePreview | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmationKey, setConfirmationKey] = useState(() => crypto.randomUUID())
  const mounted = useRef(true), submitting = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const options = clues.map(clue => ({ value: clue.id, label: `#${clue.id} · ${clue.title}` }))
  const invalidate = () => { setPreview(null); setError(''); setConfirmationKey(crypto.randomUUID()) }
  const inspect = async () => {
    setBusy(true); setError('')
    try {
      const result = await callAuthorTool<{ preview: ClueMergePreview }>('novelforge.ledger.merge_preview', { novelId, keepId, sourceIds })
      if (mounted.current) setPreview(result.preview)
    } catch (cause) { if (mounted.current) setError(String(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const merge = async () => {
    if (submitting.current || !preview || !reason.trim() || preview.blockers.length) return
    submitting.current = true
    setBusy(true); setError('')
    try {
      await callAuthorTool('novelforge.ledger.merge_clues', { novelId, keepId, sourceIds, expectedContextVersion: preview.contextVersion, previewFingerprint: preview.fingerprint, reason, idempotencyKey: confirmationKey })
      await onMerged(); onClose()
    } catch (cause) { if (mounted.current) setError(String(cause)) }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  const displayValue = (field: string, value: string | number | null) => {
    if (value === null || value === '') return '未填写'
    if (field === 'status') return CLUE_STATUSES.find(status => status.value === value)?.label || String(value)
    if (field.endsWith('ChapterId')) { const chapter = chapters.find(item => item.id === value); return chapter ? `第 ${chapter.chapterNum} 章 · ${chapter.title}` : `章节 #${value}` }
    return String(value)
  }
  return <Modal title="合并重复线索" open width={850} footer={null} onCancel={busy ? undefined : onClose} closable={!busy} maskClosable={false}>
    <div className="author-assist-stack">
      <p>选择保留项后先预览。保留项的标题、内容和回收状态继续生效，其他原项与合并依据保存在历史中；合同和待处理任务的明确引用迁移到保留项。</p>
      <label>保留线索<Select aria-label="合并保留项" value={keepId} disabled={busy} options={options} onChange={id => { setSelection(current => selectClueMergeKeep(current, id)); invalidate() }} /></label>
      <label>合并到保留项的线索<Select aria-label="待合并线索" mode="multiple" value={sourceIds} maxCount={20} disabled={busy} options={options.filter(option => option.value !== keepId)} onChange={ids => { setSelection(current => ({ ...current, sourceIds: ids })); invalidate() }} /></label>
      <Button loading={busy} disabled={!sourceIds.length} onClick={() => void inspect()}>预览差异与引用影响</Button>
      {error && <Alert type="error" message={error} />}
      {preview && <>
        <Alert type={preview.blockers.length ? 'warning' : 'info'} message={`保留 #${preview.keep.id}；合并 ${preview.sources.length} 项；迁移 ${preview.references.length} 处明确引用${preview.aliasIds.length ? `，更新 ${preview.aliasIds.length} 个旧编号指向` : ''}`} />
        {preview.blockers.map(blocker => <Alert key={blocker} type="error" message={blocker} />)}
        {preview.differences.map(item => <article className="author-change-card" key={item.id}>
          <h3>原项 #{item.id} 与保留项的差异</h3>
          {!item.fields.length && <p>字段内容一致。</p>}
          {item.fields.map(field => <div key={field.field}><strong>{field.label}</strong><p className="author-prose">保留：{displayValue(field.field, field.kept)}</p><p className="author-prose">原项：{displayValue(field.field, field.original)}</p></div>)}
        </article>)}
        {preview.references.length > 0 && <details><summary>查看引用迁移列表</summary>{preview.references.map(ref => <p key={`${ref.table}:${ref.id}:${ref.field}`}>{({ chapter_contracts: '章合同', scene_contracts: '场景合同', revision_tasks: '待处理修订', asset_change_impacts: '待处理影响' })[ref.table]} #{ref.id}{ref.chapterId ? ` · ${chapters.find(chapter => chapter.id === ref.chapterId)?.title || `章节 #${ref.chapterId}`}` : ''}：{String(ref.before)} → {String(ref.after)}</p>)}</details>}
        <label>合并依据<Input.TextArea aria-label="线索合并依据" value={reason} maxLength={1200} autoSize={{ minRows: 2 }} disabled={busy} onChange={event => { setReason(event.target.value); setConfirmationKey(crypto.randomUUID()) }} /></label>
        <Space><Button type="primary" loading={busy} disabled={Boolean(preview.blockers.length) || !reason.trim()} onClick={() => void merge()}>确认合并并保留历史</Button><Button disabled={busy} onClick={onClose}>取消</Button></Space>
      </>}
    </div>
  </Modal>
}
