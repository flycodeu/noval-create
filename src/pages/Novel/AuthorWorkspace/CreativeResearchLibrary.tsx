import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Empty, Form, Input, Modal, Pagination, Select, Space, Tag, Typography, message, Segmented } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import {
  CREATIVE_RESEARCH_CATEGORIES,
  getCreativeResearchCategoryLabel,
  getCreativeResearchSourceKey,
  parseCreativeResearchEntries,
  type CreativeResearchDraft,
  type CreativeResearchEntry,
} from '../../../shared/creative-research'
import { formatUserFacingMessage } from '../../../shared/user-facing-messages'
import { useNovelStore } from '../../../stores/novel.store'
import { useNovelResearchRefresh } from '../../../hooks/useNovelResearchRefresh'
import './creative-research.css'
import ReferenceExtraction from './ReferenceExtraction'
import PersonalResearchLibrary from './PersonalResearchLibrary'
import { callAuthorTool } from './workflow-client'

const { Paragraph, Text } = Typography

function toolError(result: Awaited<ReturnType<typeof window.electron.agentTools.call>>) {
  if (!result.ok) throw new Error(result.error.message)
}

type Props = { novelId: number; onDirtyChange?: (dirty: boolean) => void }
export default function CreativeResearchLibrary(props: Props) { return <ResearchSession key={props.novelId} {...props} /> }
function ResearchSession({ novelId, onDirtyChange }: Props) {
  useNovelResearchRefresh(novelId)
  const novel = useNovelStore(state => state.currentNovel)
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [form] = Form.useForm<CreativeResearchDraft>()
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('all')
  const [requestedPage, setPage] = useState(1)
  const [editing, setEditing] = useState<CreativeResearchEntry | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [library, setLibrary] = useState('本作资料')
  const [personalDirty, setPersonalDirty] = useState(false)
  const dirty = open || saving || extracting || personalDirty
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const operationId = useRef(0)
  const busy = useRef(false)
  const editingVersion = useRef<number>()
  const confirmation = useRef<ReturnType<typeof Modal.confirm> | null>(null)
  const allEntries = useMemo(() => parseCreativeResearchEntries(novel?.id === novelId ? novel.sourceLedgerJson : undefined), [novel?.id, novel?.sourceLedgerJson, novelId])
  const entries = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    return allEntries
      .filter(entry => category === 'all' || entry.category === category)
      .filter(entry => !query || [entry.title, entry.sourceTitle, entry.content, entry.interpretation, entry.novelConnection, ...(entry.tags || [])]
        .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }, [allEntries, category, keyword])
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(entries.length / 20)))
  const pageEntries = entries.slice((page - 1) * 20, page * 20)

  useEffect(() => () => {
    operationId.current += 1
    busy.current = false
    confirmation.current?.destroy()
    confirmation.current = null
  }, [])

  const beginEditing = () => {
    operationId.current += 1
    editingVersion.current = useNovelStore.getState().currentNovel?.contextVersion
    confirmation.current?.destroy()
    confirmation.current = null
  }

  const startCreate = () => {
    beginEditing()
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ category: 'humanity', tags: [] })
    setOpen(true)
  }

  const startEdit = (entry: CreativeResearchEntry) => {
    beginEditing()
    setEditing(entry)
    form.setFieldsValue({
      category: entry.category, title: entry.title, sourceTitle: entry.sourceTitle,
      sourceUrl: entry.sourceUrl, tags: entry.tags || [], content: entry.content,
      interpretation: entry.interpretation, novelConnection: entry.novelConnection,
    })
    setOpen(true)
  }

  const isCurrent = (currentOperation: number) => currentOperation === operationId.current && useNovelStore.getState().currentNovelId === novelId

  const refreshNovel = async (currentOperation: number) => {
    const updated = await window.electron.novel.get(novelId)
    if (updated?.id !== novelId || !isCurrent(currentOperation)) return false
    const currentVersion = useNovelStore.getState().currentNovel?.contextVersion || 0
    if ((updated.contextVersion || 0) >= currentVersion) setNovel(updated)
    return true
  }

  const persist = async (entry: CreativeResearchDraft, expectedContextVersion: number | undefined, currentOperation: number, updated: boolean) => {
    if (!isCurrent(currentOperation) || busy.current) return
    busy.current = true
    setSaving(true)
    try {
      const result = await window.electron.agentTools.call({
        toolId: 'novelforge.research.upsert',
        input: { novelId, entries: [entry], expectedContextVersion },
      })
      toolError(result)
      if (!isCurrent(currentOperation) || !await refreshNovel(currentOperation)) return
      setPage(1)
      setKeyword('')
      setCategory('all')
      setOpen(false)
      message.success(formatUserFacingMessage(updated ? 'workspace.creativeResearch.updated' : 'workspace.creativeResearch.saved'))
    } catch (error) {
      if (isCurrent(currentOperation)) {
        // Refresh the library while retaining the draft and its original version.
        // Reopening the editor is the author's decision to use the newer data.
        await refreshNovel(currentOperation).catch(() => false)
        if (isCurrent(currentOperation)) message.error(error instanceof Error ? error.message : formatUserFacingMessage('workspace.creativeResearch.saveFailed'))
      }
    } finally {
      if (isCurrent(currentOperation)) { busy.current = false; setSaving(false) }
    }
  }

  const save = async () => {
    if (busy.current || confirmation.current) return
    const currentOperation = ++operationId.current
    const expectedContextVersion = editingVersion.current
    busy.current = true
    try {
      const values = await form.validateFields()
      if (!isCurrent(currentOperation)) return
      const entry: CreativeResearchDraft = { ...values, tags: [...(values.tags || [])], ...(editing ? { sourceKey: editing.sourceKey } : {}) }
      const sourceKey = getCreativeResearchSourceKey(entry)
      const duplicate = !editing && allEntries.find(item => item.sourceKey === sourceKey)
      busy.current = false
      if (duplicate) {
        confirmation.current = Modal.confirm({
          title: '相同标题、分类和出处的资料卡已存在',
          content: `继续保存会更新「${duplicate.title}」这张卡片。`,
          okText: '更新现有卡片', cancelText: '继续编辑',
          onOk: () => {
            confirmation.current = null
            return persist({ ...entry, sourceKey: duplicate.sourceKey }, expectedContextVersion, currentOperation, true)
          },
          onCancel: () => { confirmation.current = null },
        })
        return
      }
      await persist(entry, expectedContextVersion, currentOperation, Boolean(editing))
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      if (isCurrent(currentOperation)) message.error(error instanceof Error ? error.message : formatUserFacingMessage('workspace.creativeResearch.saveFailed'))
    } finally {
      if (isCurrent(currentOperation)) busy.current = false
    }
  }

  const remove = async (entry: CreativeResearchEntry) => {
    if (busy.current || confirmation.current) return
    const currentOperation = ++operationId.current
    busy.current = true
    setSaving(true)
    try {
      const request = { toolId: 'novelforge.research.delete', input: { novelId, sourceKey: entry.sourceKey, expectedContextVersion: novel?.contextVersion } }
      const approval = await window.electron.agentTools.approve({ request })
      if (!approval.approved || !approval.approvalId) return
      if (!isCurrent(currentOperation)) return
      const result = await window.electron.agentTools.call({
        ...request, approvalId: approval.approvalId,
      })
      toolError(result)
      if (!isCurrent(currentOperation) || !await refreshNovel(currentOperation)) return
      setPage(1)
      message.success(formatUserFacingMessage('workspace.creativeResearch.deleted'))
    } catch (error) {
      if (isCurrent(currentOperation)) message.error(error instanceof Error ? error.message : formatUserFacingMessage('workspace.creativeResearch.deleteFailed'))
    } finally {
      if (isCurrent(currentOperation)) { busy.current = false; setSaving(false) }
    }
  }

  return <div className="creative-research">
    <Segmented options={['本作资料', '个人资料']} value={library} onChange={value => setLibrary(String(value))} />
    {library === '个人资料' ? <PersonalResearchLibrary key={novelId} novelId={novelId} onDirtyChange={setPersonalDirty} /> : <>
    <ReferenceExtraction key={novelId} novelId={novelId} open={extracting} onClose={() => setExtracting(false)} onSaved={() => refreshNovel(operationId.current).then(() => undefined)} />
    <section className="creative-research__intro">
      <div>

        <h2>创作资料</h2>

      </div>
      <Space wrap><Button disabled={saving} onClick={() => setExtracting(true)}>从文本提炼</Button><Button type="primary" icon={<PlusOutlined />} disabled={saving} onClick={startCreate}>新建资料卡</Button></Space>
    </section>

    <div className="creative-research__toolbar">
      <Input allowClear prefix={<SearchOutlined />} value={keyword} onChange={event => { setPage(1); setKeyword(event.target.value) }} placeholder="搜索标题、内容或标签" />
      <Select value={category} onChange={value => { setPage(1); setCategory(value) }} options={[{ value: 'all', label: '全部分类' }, ...CREATIVE_RESEARCH_CATEGORIES.map(item => ({ value: item.value, label: item.label }))]} />
      <Text type="secondary">{entries.length} 条</Text>
    </div>

    {entries.length === 0 ? <div className="creative-research__empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword || category !== 'all' ? '没有匹配的资料卡' : '还没有作者自建资料'} /></div> :
      <div className="creative-research__grid">{pageEntries.map(entry => <Card key={entry.sourceKey} className="creative-research__card" size="small">
        <div className="creative-research__card-heading">
          <div><Tag>{getCreativeResearchCategoryLabel(entry.category)}</Tag></div>
          <Space size={4}>
            <Button type="text" size="small" disabled={saving} icon={<EditOutlined />} aria-label={`编辑${entry.title}`} onClick={() => startEdit(entry)} />
            <Button type="text" danger size="small" disabled={saving} icon={<DeleteOutlined />} aria-label={`删除${entry.title}`} onClick={() => void remove(entry)} />
          </Space>
        </div>
        <h3>{entry.title}</h3>
        {(entry.sourceTitle || entry.sourceUrl) && <Text type="secondary" className="creative-research__source">参考：{entry.sourceTitle}{entry.sourceUrl ? <>{entry.sourceTitle ? ' · ' : ''}<a href={entry.sourceUrl} target="_blank" rel="noreferrer">出处</a></> : null}</Text>}
        <Button size="small" disabled={saving} onClick={() => { void callAuthorTool('novelforge.research.publish', { novelId, sourceKey: entry.sourceKey }).then(() => message.success(formatUserFacingMessage('author.research.published'))).catch(cause => message.error(String(cause))) }}>发布通用卡到个人库</Button>
        {entry.provenance && <details className="author-disclosure"><summary>提炼依据{entry.provenance.sourceLabel ? ` · ${entry.provenance.sourceLabel}` : ''}</summary><blockquote>{entry.provenance.quote}</blockquote></details>}
        <Paragraph className="creative-research__body" ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>{entry.content}</Paragraph>
        {entry.interpretation && <div className="creative-research__meaning"><Text strong>深层含义</Text><Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>{entry.interpretation}</Paragraph></div>}
        {entry.novelConnection && <div className="creative-research__adaptation"><Text strong>本作转化</Text><Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>{entry.novelConnection}</Paragraph></div>}
        {entry.tags?.length ? <div className="creative-research__tags">{entry.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div> : null}
      </Card>)}</div>}
    {entries.length > 20 ? <Pagination className="creative-research__pagination" current={page} pageSize={20} total={entries.length} showSizeChanger={false} onChange={setPage} /> : null}

    <Modal title={editing ? `编辑资料卡 · ${editing.title}` : '新建创作资料卡'} open={open} onCancel={() => { if (!busy.current) { beginEditing(); setOpen(false) } }} onOk={() => void save()} confirmLoading={saving} okText="保存到创作参考" cancelText="取消" width={760} destroyOnClose>
      <Form form={form} disabled={saving} layout="vertical" requiredMark={false} className="creative-research__form">
        <div className="creative-research__form-row">
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: '请填写一个能说明机制或问题的标题' }, { max: 120, message: '标题最多 120 个字符' }]}><Input maxLength={120} placeholder="例如：赎罪为何会变成新的权力" /></Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}><Select options={CREATIVE_RESEARCH_CATEGORIES.map(item => ({ value: item.value, label: item.label }))} /></Form.Item>
        </div>
        <div className="creative-research__form-row">
          <Form.Item name="sourceTitle" label="参考出处（可选）"><Input maxLength={160} placeholder="作品、典籍、史料或口述来源" /></Form.Item>
          <Form.Item name="sourceUrl" label="出处链接（可选）" rules={[{ type: 'url', message: '请输入完整链接' }]}><Input maxLength={500} placeholder="https://..." /></Form.Item>
        </div>
        <Form.Item name="tags" label="标签（可选）"><Select mode="tags" maxCount={12} maxTagTextLength={30} tokenSeparators={[',', '，', '、']} placeholder="用标签标出适用主题或叙事用途" /></Form.Item>
        <Form.Item name="content" label="核心资料与机制" rules={[{ required: true, whitespace: true, message: '请写下要保存的内容' }, { max: 4000, message: '内容最多 4000 个字符' }]}><Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} maxLength={4000} showCount placeholder="自由写下概念、制度、场景结构、民间做法或人物处境……" /></Form.Item>
        <Form.Item name="interpretation" label="深层含义" rules={[{ required: true, whitespace: true, message: '请说明这条资料触及的深层问题' }, { max: 1200, message: '最多 1200 个字符' }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={1200} showCount placeholder="表层事件之外，它让读者重新理解什么？" /></Form.Item>
        <Form.Item name="novelConnection" label="本作转化方向" rules={[{ required: true, whitespace: true, message: '请写明它与本作背景或冲突的连接' }, { max: 1200, message: '最多 1200 个字符' }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={1200} showCount placeholder="它可以怎样映照本作的世界、人物困境或主线冲突？" /></Form.Item>
      </Form>
    </Modal>
    </>}
  </div>
}
