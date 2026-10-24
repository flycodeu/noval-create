import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Form, Input, Modal, Select, Space, Tag, message } from 'antd'
import type { PersonalResearchCard, PersonalResearchContent } from '../../../shared/personal-research'
import { CREATIVE_RESEARCH_CATEGORIES, getCreativeResearchCategoryLabel, parseCreativeResearchEntries } from '../../../shared/creative-research'
import { useNovelStore } from '../../../stores/novel.store'
import { callAuthorTool } from './workflow-client'
import './author-library.css'

export default function PersonalResearchLibrary({ novelId, onDirtyChange }: { novelId: number; onDirtyChange?: (dirty: boolean) => void }) {
  const novel = useNovelStore(state => state.currentNovel)
  const [messageApi, messageContext] = message.useMessage()
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [cards, setCards] = useState<PersonalResearchCard[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [archived, setArchived] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<PersonalResearchCard | null>(null)
  const [adopting, setAdopting] = useState<{ card: PersonalResearchCard; contextVersion: number } | null>(null)
  const [connection, setConnection] = useState('')
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<PersonalResearchContent>()
  const dirty = busy || Boolean(editing) || Boolean(adopting)
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const load = useCallback(() => callAuthorTool<{ cards: PersonalResearchCard[] }>('novelforge.research.personal_list', { query, category, includeArchived: archived }), [query, category, archived])
  useEffect(() => { let alive = true; void load().then(result => { if (alive) { setCards(result.cards); setError('') } }).catch(cause => { if (alive) setError(String(cause)) }); return () => { alive = false } }, [load, revision])
  const local = parseCreativeResearchEntries(novel?.sourceLedgerJson)
  const update = async (card: PersonalResearchCard, content: PersonalResearchContent, archive = card.archived) => {
    setBusy(true)
    try {
      await callAuthorTool('novelforge.research.personal_update', { cardId: card.id, expectedRevision: card.revision, content, archived: archive })
      setEditing(null); setRevision(value => value + 1); messageApi.success(archive ? '已归档，作品副本仍保留' : '个人资料已保存')
    } catch (cause) { messageApi.error(String(cause)) } finally { setBusy(false) }
  }
  const reference = async () => {
    if (!adopting) return
    setBusy(true)
    try {
      await callAuthorTool('novelforge.research.reference', { novelId, cardId: adopting.card.id, expectedRevision: adopting.card.revision, expectedContextVersion: adopting.contextVersion, novelConnection: connection })
      const updated = await window.electron.novel.get(novelId)
      if (updated && useNovelStore.getState().currentNovel?.id === novelId) setNovel(updated)
      setAdopting(null); messageApi.success('已保存本作副本')
    } catch (cause) { messageApi.error(String(cause)) } finally { setBusy(false) }
  }
  const current = local.find(item => item.sharedReference?.cardId === adopting?.card.id)
  return <section className="creative-research">{messageContext}
    <Space wrap><Input.Search aria-label="搜索个人资料" placeholder="标题、分类、标签或内容" maxLength={200} onSearch={setQuery} allowClear /><Select aria-label="个人资料分类" style={{ minWidth: 150 }} value={category} onChange={setCategory} options={[{ value: "", label: "全部分类" }, ...CREATIVE_RESEARCH_CATEGORIES]} /><Checkbox checked={archived} onChange={event => setArchived(event.target.checked)}>显示归档</Checkbox><Button onClick={() => setRevision(value => value + 1)}>刷新</Button></Space>
    {error && <Alert type="error" message={error} />}
    {!cards.length && <Empty description="暂无匹配的个人资料，可从本作资料发布一张通用卡" />}
    <div className="creative-research__list">{cards.map(card => {
      const snapshot = local.find(item => item.sharedReference?.cardId === card.id)
      return <details key={card.id} className="creative-research__entry"><summary><span className="creative-research__category">{getCreativeResearchCategoryLabel(card.content.category)}</span><span className="creative-research__entry-title"><strong>{card.content.title}</strong><span>{card.content.content}</span></span><span className="creative-research__entry-source">{card.archived ? '已归档' : snapshot ? snapshot.sharedReference!.revision < card.revision ? '有新版可用' : '本作已引用' : '未引用'}</span></summary><div className="creative-research__entry-detail">
        <Space wrap><Tag>第 {card.revision} 版</Tag>{card.archived && <Tag>已归档</Tag>}{snapshot && <Tag color={snapshot.sharedReference!.revision < card.revision ? 'orange' : 'green'}>{snapshot.sharedReference!.revision < card.revision ? '有新版可用' : '本作已引用'}</Tag>}</Space>
        <p className="author-prose">{card.content.content}</p><p>{card.content.interpretation}</p>
        {card.content.sourceTitle && <small>出处：{card.content.sourceTitle}</small>}
        {card.content.provenance && <details><summary>来源引文</summary><blockquote>{card.content.provenance.quote}</blockquote></details>}
        <Space wrap><Button disabled={card.archived || snapshot?.sharedReference?.revision === card.revision} onClick={() => { setConnection(snapshot?.novelConnection || ''); setAdopting({ card, contextVersion: novel?.contextVersion || 1 }) }}>{snapshot ? '查看并更新本作副本' : '引用到本作'}</Button><Button onClick={() => { form.setFieldsValue(card.content); setEditing(card) }}>编辑通用卡</Button><Button disabled={busy} onClick={() => void update(card, card.content, !card.archived)}>{card.archived ? '取消归档' : '归档'}</Button></Space>
      </div></details>
    })}</div>
    <Modal title="编辑个人通用卡" open={Boolean(editing)} width={700} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} onCancel={() => { if (!busy) setEditing(null) }} onOk={() => { void form.validateFields().then(values => { if (editing) return update(editing, values) }).catch(() => {}) }} okText="保存新版" forceRender>
      <Form form={form} layout="vertical"><Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item><Form.Item name="category" label="分类" rules={[{ required: true }]}><Select options={[...CREATIVE_RESEARCH_CATEGORIES]} /></Form.Item><Form.Item name="tags" label="标签"><Select mode="tags" maxCount={12} /></Form.Item><Form.Item name="sourceTitle" label="出处"><Input maxLength={160} /></Form.Item><Form.Item name="sourceUrl" label="出处链接"><Input maxLength={500} /></Form.Item><Form.Item name="content" label="通用机制" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={4000} autoSize={{ minRows: 4, maxRows: 12 }} /></Form.Item><Form.Item name="interpretation" label="理解（可选）"><Input.TextArea maxLength={1200} autoSize={{ minRows: 3, maxRows: 8 }} /></Form.Item></Form>
    </Modal>
    <Modal title={current ? '比较并更新本作副本' : '引用个人资料'} open={Boolean(adopting)} width={800} onCancel={() => { if (!busy) setAdopting(null) }} confirmLoading={busy} onOk={() => void reference()} okText={current ? '采用新版，保留本作转化' : '保存本作副本'} cancelButtonProps={{ disabled: busy }}>
      {adopting && <><Alert type="info" message="仅在确认后替换通用内容。本作转化方向始终保留。" /><div className="author-library-compare">{current && <div><h4>本作副本 · 第 {current.sharedReference?.revision} 版</h4><h3>{current.title}</h3><p className="author-prose">{current.content}</p><p>{current.interpretation}</p><p>分类：{getCreativeResearchCategoryLabel(current.category)} · 标签：{current.tags?.join("、") || "无"}</p><p>出处：{current.sourceTitle || "未填写"} {current.sourceUrl}</p></div>}<div><h4>个人资料 · 第 {adopting.card.revision} 版</h4><h3>{adopting.card.content.title}</h3><p className="author-prose">{adopting.card.content.content}</p><p>{adopting.card.content.interpretation}</p><p>分类：{getCreativeResearchCategoryLabel(adopting.card.content.category)} · 标签：{adopting.card.content.tags?.join("、") || "无"}</p><p>出处：{adopting.card.content.sourceTitle || "未填写"} {adopting.card.content.sourceUrl}</p></div></div><label htmlFor="reference-connection">本作转化方向</label><Input.TextArea id="reference-connection" value={connection} disabled={Boolean(current)} onChange={event => setConnection(event.target.value)} maxLength={1200} autoSize={{ minRows: 3 }} /></>}
    </Modal>
  </section>
}
