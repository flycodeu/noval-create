import React, { useCallback, useEffect, useState } from 'react'
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
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ key: string; title: string; value: unknown; contextVersion: number | undefined } | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const dirty = Boolean(editing) && JSON.stringify(draft) !== JSON.stringify(editing?.value)
  useRegisterWorkspaceLeaveGuard(dirty || saving)
  useEffect(() => { onEditStateChange?.({ dirty, saving }) }, [dirty, saving, onEditStateChange])
  useEffect(() => () => onEditStateChange?.({ dirty: false, saving: false }), [onEditStateChange])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      let referenceError = ''
      const [latest, references] = await Promise.all([window.electron.novel.get(novelId), loadDocumentNames(novelId, value => { referenceError = value })])
      if (latest && useNovelStore.getState().currentNovel?.id === novelId) setNovel(latest)
      setNames(references); setError(referenceError)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取世界规则失败') }
    finally { setLoading(false) }
  }, [novelId, setNovel])
  useEffect(() => { void load() }, [load])
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
    if (!editing) return
    setSaving(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!latest || latest.contextVersion !== editing.contextVersion) throw new Error(getUserFacingMessage('novel.contextVersionConflict'))
      await window.electron.novel.update(novelId, buildStoryDesignPatch(latest, editing.key, draft), { expectedContextVersion: editing.contextVersion })
      const updated = await window.electron.novel.get(novelId)
      if (updated && useNovelStore.getState().currentNovel?.id === novelId) setNovel(updated)
      setEditing(null); message.success(getUserFacingMessage('workspace.sectionSaved'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存世界规则失败') }
    finally { setSaving(false) }
  }
  return <section className="world-rules-workspace" aria-label="世界规则">
    <nav className="world-rules-topics" aria-label="世界规则主题">{TOPICS.map(item => <button type="button" key={item.key} aria-pressed={topic.key === item.key} disabled={saving} onClick={() => { if (topic.key !== item.key) leave(() => { const next = new URLSearchParams(params); next.set('topic', item.key); setParams(next) }) }}>{item.label}</button>)}</nav>
    <div className="world-rules-content">{error && <LoadFailure message={error} retry={() => void load()} />}{loading ? <Spin /> : <section className="author-paper"><div className="author-section-heading"><h2>{topic.label}</h2><div className="author-heading-actions"><Button disabled={saving} onClick={() => { const initial = value ?? {}; setEditing({ key: topic.key, title: topic.label, value: structuredClone(initial), contextVersion: novel?.contextVersion }); setDraft(structuredClone(initial)) }}>编辑</Button><Button disabled={saving} onClick={() => onDiscuss(topic.label)}>AI 完善</Button></div></div><ContentDocument value={value} names={names} /></section>}</div>
    <Modal width={850} title={`编辑 · ${editing?.title || ''}`} open={Boolean(editing)} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => leave(() => setEditing(null))} okText="保存这一部分" cancelText="取消" confirmLoading={saving} onOk={() => void save()}><DocumentEditor value={draft} names={names} onChange={setDraft} /></Modal>
  </section>
}
