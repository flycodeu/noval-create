import React, { useCallback, useEffect, useState } from 'react'
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
  const [contract, setContract] = useState<ChapterContractAsset | null>(null)
  const [scenes, setScenes] = useState<SceneContractAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<'outline' | 'contract' | 'scene' | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [initialDraft, setInitialDraft] = useState<unknown>(null)
  const dirty = editing !== null && JSON.stringify(initialDraft) !== JSON.stringify(draft)
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const edit = (kind: 'outline' | 'contract' | 'scene', value: unknown) => { setInitialDraft(value); setDraft(value); setEditing(kind) }
  const load = useCallback(async () => {
    setLoading(true)
    let referenceError = ''
    try {
      const [nextContract, nextScenes, nextNames] = await Promise.all([window.electron.contract.getChapter(chapter.id), window.electron.contract.listScenes(chapter.id), loadDocumentNames(chapter.novelId, value => { referenceError = value })])
      setContract(nextContract); setScenes(nextScenes); setNames(nextNames); setError(referenceError)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取章节安排失败') }
    finally { setLoading(false) }
  }, [chapter.id, chapter.novelId])
  useEffect(() => { void load() }, [load])
  const save = async () => {
    setSaving(true)
    try {
      if (editing === 'outline') await window.electron.chapter.update(chapter.id, { outline: String(draft) })
      else if (editing === 'contract') await window.electron.contract.upsertChapter(chapter.id, draft as Partial<ChapterContractAsset>)
      else if (editing === 'scene') {
        const scene = draft as SceneContractAsset
        await window.electron.contract.upsertScene(chapter.id, scene.segmentId ?? null, scene)
      }
      setEditing(null); await load(); onSaved?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存安排失败') }
    finally { setSaving(false) }
  }
  return <div className="author-arrangement">
    <div className="author-section-heading"><h2>第 {chapter.chapterNum} 章 · 写作安排</h2><Button disabled={dirty || saving} onClick={() => navigate(buildWorkspaceRoute(chapter.novelId, chapterArrangementTarget(chapter)))}>让 AI 完善本章安排</Button></div>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    <section><div className="author-section-heading"><h3>完整大纲</h3><Button size="small" onClick={() => edit('outline', chapter.outline || '')}>编辑</Button></div><ContentDocument value={chapter.outline} /></section>
    {loading ? <Spin /> : <>
      <section><div className="author-section-heading"><h3>章节目标与边界</h3><Button size="small" onClick={() => edit('contract', contract)}>编辑</Button></div><ContentDocument value={contract} names={names} /></section>
      <section><h3>场景安排 · {scenes.length}</h3>{scenes.length ? scenes.map((scene, index) => <details open key={scene.id ?? index} className="author-disclosure"><summary>{scene.segmentTitle || `场景 ${scene.segmentOrder || index + 1}`}</summary><ContentDocument value={scene} names={names} /><Button onClick={() => edit('scene', scene)}>编辑本场</Button></details>) : <p className="author-missing">尚未安排场景</p>}</section>
    </>}
    <Modal width={780} title="编辑章节安排" open={editing !== null} confirmLoading={saving} onCancel={() => { if (!dirty) setEditing(null); else Modal.confirm({ title: '放弃安排修改？', okText: '放弃', cancelText: '继续编辑', onOk: () => setEditing(null) }) }} onOk={() => void save()} okText="保存" cancelText="取消">{editing === 'outline' ? <Input.TextArea value={String(draft || '')} onChange={event => setDraft(event.target.value)} autoSize={{ minRows: 10, maxRows: 24 }} /> : <DocumentEditor value={draft} onChange={setDraft} names={names} />}</Modal>
  </div>
}
