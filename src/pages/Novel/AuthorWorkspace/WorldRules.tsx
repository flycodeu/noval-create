import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import { useScopedState } from '@/hooks/useScopedState'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal, Spin, message } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { getUserFacingMessage } from '../../../utils/user-facing-message'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import { ContentDocument, DocumentEditor } from './ContentDocument'
import { parseDocument, recordOf } from './content-document'
import { loadDocumentNames } from './document-references'
import { buildStoryDesignPatch, STORY_DESIGN_TOPICS } from './story-design-navigation'
import { LoadFailure } from './shared'

const TOPICS = [...STORY_DESIGN_TOPICS.world, { key: 'world:writingConstraints', label: '世界与常识' }]
export type WorldRulesEditState = { dirty: boolean; saving: boolean }

/** One editor for the stored world document, used by its page and the object reference drawer. */
export default function WorldRules({ novelId, onDiscuss, onEditStateChange }: {
  novelId: number; onDiscuss: (title: string) => void; onEditStateChange?: (state: WorldRulesEditState) => void
}) {
  const novel = useNovelStore(state => state.currentNovel)
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [params, setParams] = useSearchParams()
  const topic = TOPICS.find(item => item.key === params.get('topic')) || TOPICS[0]
  const [saveError, setError] = useScopedState(novelId, '')
  const [editing, setEditing] = useState<{ key: string; title: string; value: unknown; contextVersion: number | undefined } | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const dirty = Boolean(editing) && JSON.stringify(draft) !== JSON.stringify(editing?.value)
  useRegisterWorkspaceLeaveGuard(dirty || saving)
  useEffect(() => { onEditStateChange?.({ dirty, saving }) }, [dirty, saving, onEditStateChange])
  useEffect(() => () => onEditStateChange?.({ dirty: false, saving: false }), [onEditStateChange])
  const read = useCallback(async () => {
    let referenceError = ''
    const [latest, names] = await Promise.all([window.electron.novel.get(novelId), loadDocumentNames(novelId, value => { referenceError = value })])
    const current = useNovelStore.getState().currentNovel
    if (latest?.id === novelId && current?.id === novelId && (latest.contextVersion || 0) >= (current.contextVersion || 0)) setNovel(latest)
    return { names, referenceError }
  }, [novelId, setNovel])
  const { data, loading, error: readError, reload: load } = useAsyncSnapshot(read)
  const names = data?.names ?? {}
  const error = saveError || (readError ? String(readError) : data?.referenceError || '')
  const saveLock = useRef(false)
  const draftRef = useRef<unknown>(null)
  const changeDraft = (value: unknown) => { draftRef.current = value; setDraft(value) }
  useEffect(() => { const refresh = () => { void load() }; window.addEventListener('novelforge:creative-completed', refresh); return () => window.removeEventListener('novelforge:creative-completed', refresh) }, [load])
  // Only stored rules are author facts; genre defaults are never shown as saved content.
  const world = recordOf(parseDocument(novel?.worldRulesJson))
  const value = topic.key === 'world:timelineConfig' ? { dynastyName: '', storyStartLabel: '', currentTimeLabel: '', currentTimeChapterNum: null, currentTimeEvidence: '', ...recordOf(world.timelineConfig) } : world[topic.key.slice(6)]
  const leave = (change: () => void) => {
    if (saving) return
    if (!dirty) { setEditing(null); change(); return }
    Modal.confirm({ title: '当前规则还有未保存的修改', okText: '放弃并切换', cancelText: '继续编辑', onOk: () => { setEditing(null); setDraft(null); change() } })
  }
  const save = async () => {
    if (!editing || saveLock.current) return
    saveLock.current = true
    const submitted = draftRef.current
    setSaving(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!latest || latest.contextVersion !== editing.contextVersion) throw new Error(getUserFacingMessage('novel.contextVersionConflict'))
      await window.electron.novel.update(novelId, buildStoryDesignPatch(latest, editing.key, submitted), { expectedContextVersion: editing.contextVersion })
      const updated = await window.electron.novel.get(novelId)
      if (updated && useNovelStore.getState().currentNovel?.id === novelId) setNovel(updated)
      if (JSON.stringify(draftRef.current) === JSON.stringify(submitted)) setEditing(null)
      else setEditing({ ...editing, value: submitted, contextVersion: updated?.contextVersion })
      message.success(getUserFacingMessage('workspace.sectionSaved'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存世界规则失败') }
    finally { saveLock.current = false; setSaving(false) }
  }
  return <section className="world-rules-workspace" aria-label="世界规则">
    <nav className="world-rules-topics" aria-label="世界规则主题">{TOPICS.map(item => <button type="button" key={item.key} aria-pressed={topic.key === item.key} disabled={saving} onClick={() => { if (topic.key !== item.key) leave(() => { const next = new URLSearchParams(params); next.set('topic', item.key); setParams(next) }) }}>{item.label}</button>)}</nav>
    <div className="world-rules-content">{error && <LoadFailure message={error} retry={() => void load()} />}{loading ? <Spin /> : <section className="author-paper"><div className="author-section-heading"><h2>{topic.label}</h2><div className="author-heading-actions"><Button disabled={saving} onClick={() => { const initial = value ?? {}; setEditing({ key: topic.key, title: topic.label, value: structuredClone(initial), contextVersion: novel?.contextVersion }); changeDraft(structuredClone(initial)) }}>编辑</Button><Button disabled={saving} onClick={() => onDiscuss(topic.label)}>AI 完善</Button></div></div><ContentDocument value={value} names={names} /></section>}</div>
    <Modal width={850} title={`编辑 · ${editing?.title || ''}`} open={Boolean(editing)} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => leave(() => setEditing(null))} okText="保存这一部分" cancelText="取消" confirmLoading={saving} onOk={() => void save()}><DocumentEditor value={draft} names={names} onChange={changeDraft} /></Modal>
  </section>
}
