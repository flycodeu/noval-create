import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd'
import type { Chapter } from '../../../types'
import type { StoryAtlasEntity } from '../../../shared/story-atlas'
import { AUTHOR_PROTECTED_FIELDS, CLUE_STATUSES, type AuthorClue, type AuthorProtectedField } from '../../../shared/author-ledger'
import { callAuthorTool } from './workflow-client'
import { useNovelStore } from '../../../stores/novel.store'
import './author-library.css'
import ClueMergeDialog from './ClueMergeDialog'

interface Ledger { contextVersion: number; clues: AuthorClue[]; mergedClues: AuthorClue[]; duplicateGroups: number[][]; characters: Array<{ entity: StoryAtlasEntity; protectedFields: AuthorProtectedField[] }> }
interface Correction { name: string; origin: string; abilityLimits: string; effectiveFromChapter: number; protectedFields: string[]; note: string }
const resolved = new Set(['resolved', 'fulfilled', 'paid_off', 'payoff', 'abandoned'])

export default function AuthorStoryLedger({ novelId, chapters, onDirtyChange }: { novelId: number; chapters: Chapter[]; onDirtyChange?: (dirty: boolean) => void }) {
  const [messageApi, messageContext] = message.useMessage()
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(false)
  const [merging, setMerging] = useState<number[] | null>(null)
  const [editing, setEditing] = useState<{ clue: AuthorClue; version: number } | null>(null)
  const [character, setCharacter] = useState<{ entity: StoryAtlasEntity; version: number; key: string } | null>(null)
  const [clueForm] = Form.useForm<AuthorClue>()
  const [characterForm] = Form.useForm<Correction>()
  const dirty = busy || Boolean(editing) || Boolean(character) || Boolean(merging)
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const load = useCallback(() => callAuthorTool<{ ledger: Ledger }>('novelforge.ledger.get', { novelId }), [novelId])
  useEffect(() => { let alive = true; void load().then(result => { if (alive) setLedger(result.ledger) }).catch(cause => { if (alive) setError(String(cause)) }); return () => { alive = false } }, [load])
  const refresh = async () => {
    const result = await load(); setLedger(result.ledger); setError('')
    const novel = await window.electron.novel.get(novelId); if (novel && useNovelStore.getState().currentNovel?.id === novelId) setNovel(novel)
  }
  const save = async (kind: 'clue' | 'character') => {
    const values = await (kind === 'clue' ? clueForm.validateFields() : characterForm.validateFields()).catch(() => null)
    if (!values) return
    setBusy(true)
    try {
      if (kind === 'clue' && editing) await callAuthorTool('novelforge.ledger.correct_clue', { ...values, novelId, id: editing.clue.id, expectedContextVersion: editing.version })
      if (kind === 'character' && character) await callAuthorTool('novelforge.ledger.correct_character', { ...values, novelId, entityId: character.entity.id, expectedContextVersion: character.version, idempotencyKey: character.key })
      await refresh(); setEditing(null); setCharacter(null); messageApi.success('作者更正已记录')
    } catch (cause) { messageApi.error(String(cause)) } finally { setBusy(false) }
  }
  const chapterOptions = chapters.map(item => ({ value: item.id, label: `第 ${item.chapterNum} 章 · ${item.title}` }))
  const chapterLabel = (id: number | null) => chapterOptions.find(item => item.value === id)?.label || '尚未记录'
  const editClue = (clue: AuthorClue) => {
    clueForm.setFieldsValue({ title: clue.title, detail: clue.detail || '', status: resolved.has(clue.status) && clue.status !== 'abandoned' ? 'resolved' : clue.status, sourceChapterId: clue.sourceChapterId, targetPayoffChapter: clue.targetPayoffChapter, actualPayoffChapterId: clue.actualPayoffChapterId, requiredEvidence: clue.requiredEvidence || '' })
    setEditing({ clue, version: ledger!.contextVersion })
  }
  const editCharacter = (entity: StoryAtlasEntity, protectedFields: string[]) => {
    characterForm.setFieldsValue({ name: entity.name, origin: String(entity.attributes.origin || ''), abilityLimits: String(entity.attributes.abilityLimits || ''), effectiveFromChapter: entity.effectiveFromChapter, protectedFields, note: '' })
    setCharacter({ entity, version: ledger!.contextVersion, key: crypto.randomUUID() })
  }
  return <section className="author-paper author-design-section">{messageContext}
    <div className="author-section-heading"><div><h2>故事账本</h2><p>整理已埋线索、回收进度与人物常设属性。</p></div><Button onClick={() => { void refresh().catch(cause => setError(String(cause))) }}>刷新账本</Button></div>
    {error && <Alert type="error" message={error} />}
    {ledger?.duplicateGroups.length ? <Alert type="warning" message="发现同名线索，可分别更正或预览后合并" description={<Space wrap>{ledger.duplicateGroups.map(ids => <Button key={ids.join(':')} onClick={() => setMerging(ids)}>核对 {ids.map(id => `#${id}`).join('、')}</Button>)}</Space>} /> : null}
    <Space wrap><h3>伏笔与线索</h3><Checkbox checked={all} onChange={event => setAll(event.target.checked)}>包含已回收与放弃</Checkbox>{ledger && ledger.clues.length > 1 && <Button onClick={() => setMerging(ledger.clues.slice(0, 2).map(clue => clue.id))}>合并线索</Button>}</Space>
    {ledger && !ledger.clues.length && <Empty description="尚无伏笔记录，可在故事方向中规划结局与兑现" />}
    {ledger?.clues.filter(item => all || !resolved.has(item.status)).map(clue => <article className="author-change-card" key={clue.id}>
      <div className="author-section-heading"><h3>{clue.title}</h3><Button onClick={() => editClue(clue)}>更正线索</Button></div>
      <Space wrap><Tag>{CLUE_STATUSES.find(item => item.value === clue.status)?.label || clue.status}</Tag>{clue.authorCorrectedAt && <Tag color="blue">作者已更正</Tag>}<small>#{clue.id}{clue.linkedThreadId ? ` · 关联故事线 #${clue.linkedThreadId}` : ''}</small></Space>
      <p className="author-prose">{clue.detail}</p><p>埋设：{chapterLabel(clue.sourceChapterId)} · 计划回收：{clue.targetPayoffChapter ? `第 ${clue.targetPayoffChapter} 章` : '尚未安排'} · 实际回收：{chapterLabel(clue.actualPayoffChapterId)}</p><p className="author-prose">依据：{clue.requiredEvidence || '尚未补充'}</p>
      {clue.relatedCharacters?.length ? <p>关联人物：{clue.relatedCharacters.join('、')}</p> : null}
    </article>)}
    {ledger?.mergedClues.length ? <details><summary>已合并的线索历史（{ledger.mergedClues.length}）</summary>{ledger.mergedClues.map(clue => {
      let reason = '', original = clue
      try { const record = JSON.parse(clue.mergeInfoJson || '{}'); reason = String(record.reason || ''); original = record.sourcesBefore?.find((item: AuthorClue) => item.id === clue.id) || clue } catch { /* Keep the preserved source readable even if old metadata is damaged. */ }
      return <article className="author-change-card" key={clue.id}><h3>#{clue.id} · {clue.title} → 保留项 #{clue.mergedIntoId}</h3><p className="author-prose">{clue.detail}</p><p>合并前状态：{CLUE_STATUSES.find(status => status.value === original.status)?.label || original.status} · 埋设：{chapterLabel(original.sourceChapterId)} · 计划回收：{original.targetPayoffChapter || '未安排'} · 实际回收：{chapterLabel(original.actualPayoffChapterId)}</p><p className="author-prose">原依据：{original.requiredEvidence || '未填写'}</p><p className="author-prose">合并依据：{reason || '未记录'}</p></article>
    })}</details> : null}
    {merging && ledger && <ClueMergeDialog novelId={novelId} clues={ledger.clues} initialIds={merging} chapters={chapters} onClose={() => setMerging(null)} onMerged={refresh} />}
    <h3>人物更正与字段保护</h3><p>对姓名、出身或能力边界开启保护后，后续生成不会自动覆盖。</p>
    <div className="author-library-grid">{ledger?.characters.map(({ entity, protectedFields }) => <article className="author-change-card" key={entity.id}>
      <h3>{entity.name}</h3><Space wrap>{protectedFields.map(field => <Tag key={field} color="blue">{AUTHOR_PROTECTED_FIELDS.find(item => item.value === field)?.label}已保护</Tag>)}</Space><p>{String(entity.attributes.origin || '出身尚未记录')}</p><p>{String(entity.attributes.abilityLimits || '能力边界尚未记录')}</p><Button onClick={() => editCharacter(entity, protectedFields)}>明确更正 / 调整保护</Button>
    </article>)}</div>
    <Modal title="更正伏笔与回收记录" open={Boolean(editing)} onCancel={() => { if (!busy) setEditing(null) }} onOk={() => void save('clue')} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} width={720} forceRender>
      <Form form={clueForm} layout="vertical">
        <Form.Item name="title" label="线索标题" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="detail" label="线索内容"><Input.TextArea maxLength={4000} autoSize={{ minRows: 3 }} /></Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={editing && !CLUE_STATUSES.some(item => item.value === editing.clue.status) && !resolved.has(editing.clue.status) ? [...CLUE_STATUSES, { value: editing.clue.status, label: `保留已有状态：${editing.clue.status}` }] : CLUE_STATUSES} /></Form.Item>
        <Form.Item name="sourceChapterId" label="埋设章节" normalize={value => value ?? null}><Select allowClear options={chapterOptions} /></Form.Item>
        <Form.Item name="targetPayoffChapter" label="计划回收章" normalize={value => value ?? null}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="actualPayoffChapterId" label="实际回收章节" normalize={value => value ?? null}><Select allowClear options={chapterOptions} /></Form.Item>
        <Form.Item name="requiredEvidence" label="回收或更正依据"><Input.TextArea maxLength={2000} autoSize={{ minRows: 3 }} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="人物常设属性更正" open={Boolean(character)} onCancel={() => { if (!busy) setCharacter(null) }} onOk={() => void save('character')} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} width={700} forceRender>
      <Form form={characterForm} layout="vertical">
        <Form.Item name="name" label="姓名" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="origin" label="出身"><Input.TextArea maxLength={2000} autoSize={{ minRows: 2 }} /></Form.Item>
        <Form.Item name="abilityLimits" label="能力边界"><Input.TextArea maxLength={2000} autoSize={{ minRows: 2 }} /></Form.Item>
        <Form.Item name="effectiveFromChapter" label="生效章位（背景用 0）" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item>
        <Form.Item name="protectedFields" label="阻止模型覆盖的字段"><Checkbox.Group options={[...AUTHOR_PROTECTED_FIELDS]} /></Form.Item>
        <Form.Item name="note" label="更正依据" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={1200} autoSize={{ minRows: 2 }} /></Form.Item>
      </Form>
    </Modal>
  </section>
}
