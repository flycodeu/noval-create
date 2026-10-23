import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { Chapter, ChapterContractAsset, SceneContractAsset } from '../../../types'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { ContentDocument, DocumentEditor } from './ContentDocument'
import { LoadFailure } from './shared'
import { loadDocumentNames } from './document-references'
import { chapterArrangementTarget } from './revision-target'

export default function ChapterArrangement({ chapter, onSaved, onDirtyChange }: { chapter: Chapter; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const navigate = useNavigate()
  const [saveError, setError] = useState('')
  const [editing, setEditing] = useState<'outline' | 'contract' | 'scene' | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [initialDraft, setInitialDraft] = useState<unknown>(null)
  const draftRef = useRef<unknown>(null)
  const savingRef = useRef(false)
  const savedRef = useRef(false)
  const dirty = editing !== null && JSON.stringify(initialDraft) !== JSON.stringify(draft)
  useEffect(() => { onDirtyChange?.(dirty || saving); return () => onDirtyChange?.(false) }, [dirty, saving, onDirtyChange])
  const changeDraft = (value: unknown) => { draftRef.current = value; setDraft(value) }
  const closeEditor = () => {
    setEditing(null)
    if (savedRef.current) { savedRef.current = false; onSaved?.() }
  }
  const edit = (kind: 'outline' | 'contract' | 'scene', value: unknown) => {
    if (savingRef.current) return
    setInitialDraft(value); changeDraft(value); setEditing(kind)
  }
  const read = useCallback(async () => {
    let referenceError = ''
    const [contract, scenes, names] = await Promise.all([
      window.electron.contract.getChapter(chapter.id),
      window.electron.contract.listScenes(chapter.id),
      loadDocumentNames(chapter.novelId, value => { referenceError = value }),
    ])
    return { contract, scenes, names, referenceError }
  }, [chapter.id, chapter.novelId])
  const { data, loading, error: loadError, reload: load } = useAsyncSnapshot(read)
  const contract = data?.contract ?? null
  const scenes = data?.scenes ?? []
  const names = data?.names ?? {}
  const error = saveError || (loadError ? (loadError instanceof Error ? loadError.message : '读取章节安排失败') : data?.referenceError || '')
  const save = async () => {
    if (!editing || savingRef.current) return
    savingRef.current = true
    const submitted = draftRef.current
    setSaving(true)
    try {
      if (editing === 'outline') await window.electron.chapter.update(chapter.id, { outline: String(submitted) })
      else if (editing === 'contract') await window.electron.contract.upsertChapter(chapter.id, submitted as Partial<ChapterContractAsset>)
      else if (editing === 'scene') {
        const scene = submitted as SceneContractAsset
        await window.electron.contract.upsertScene(chapter.id, scene.segmentId ?? null, scene)
      }
      savedRef.current = true
      setInitialDraft(submitted)
      setError('')
      await load()
      // A parent refresh may unmount this editor, so notify only after its
      // latest input has also been saved.
      if (JSON.stringify(draftRef.current) === JSON.stringify(submitted)) {
        closeEditor()
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存安排失败') }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <div className="author-arrangement">
    <div className="author-section-heading"><h2>第 {chapter.chapterNum} 章 · 写作安排</h2><Button disabled={dirty || saving} onClick={() => navigate(buildWorkspaceRoute(chapter.novelId, chapterArrangementTarget(chapter)))}>让 AI 完善本章安排</Button></div>
    {error && <LoadFailure message={error} retry={() => { setError(''); void load() }} />}
    <section><div className="author-section-heading"><h3>完整大纲</h3><Button size="small" onClick={() => edit('outline', chapter.outline || '')}>编辑</Button></div><ContentDocument value={chapter.outline} /></section>
    {loading ? <Spin /> : <>
      <section><div className="author-section-heading"><h3>章节目标与边界</h3><Button size="small" onClick={() => edit('contract', contract)}>编辑</Button></div><ContentDocument value={contract} names={names} /></section>
      <section><h3>场景安排 · {scenes.length}</h3>{scenes.length ? scenes.map((scene, index) => <details open key={scene.id ?? index} className="author-disclosure"><summary>{scene.segmentTitle || `场景 ${scene.segmentOrder || index + 1}`}</summary><ContentDocument value={scene} names={names} /><Button onClick={() => edit('scene', scene)}>编辑本场</Button></details>) : <p className="author-missing">尚未安排场景。可由 AI 根据本章目标补齐。</p>}</section>
    </>}
    <Modal width={780} title="编辑章节安排" open={editing !== null} confirmLoading={saving} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => { if (savingRef.current) return; if (!dirty) closeEditor(); else Modal.confirm({ title: '放弃安排修改？', okText: '放弃', cancelText: '继续编辑', onOk: closeEditor }) }} onOk={() => void save()} okText="保存" cancelText="取消">{editing === 'outline' ? <Input.TextArea value={String(draft || '')} onChange={event => changeDraft(event.target.value)} autoSize={{ minRows: 10, maxRows: 24 }} /> : <DocumentEditor value={draft} onChange={changeDraft} names={names} />}</Modal>
  </div>
}
