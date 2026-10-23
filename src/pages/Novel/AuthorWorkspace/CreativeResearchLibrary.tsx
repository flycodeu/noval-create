import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm, Select, Space, Tag, Typography, message, Segmented } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import {
  CREATIVE_RESEARCH_CATEGORIES,
  getCreativeResearchCategoryLabel,
  parseCreativeResearchEntries,
  type CreativeResearchDraft,
  type CreativeResearchEntry,
} from '../../../shared/creative-research'
import { useNovelStore } from '../../../stores/novel.store'
import './creative-research.css'
import ReferenceExtraction from './ReferenceExtraction'
import PersonalResearchLibrary from './PersonalResearchLibrary'
import { callAuthorTool } from './workflow-client'

const { Paragraph, Text } = Typography

function toolError(result: Awaited<ReturnType<typeof window.electron.agentTools.call>>) {
  if (!result.ok) throw new Error(result.error.message)
}

export default function CreativeResearchLibrary({ novelId, onDirtyChange }: { novelId: number; onDirtyChange?: (dirty: boolean) => void }) {
  const novel = useNovelStore(state => state.currentNovel)
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [form] = Form.useForm<CreativeResearchDraft>()
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<CreativeResearchEntry | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [library, setLibrary] = useState('本作资料')
  const [personalDirty, setPersonalDirty] = useState(false)
  const dirty = open || saving || extracting || personalDirty
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const entries = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    return parseCreativeResearchEntries(novel?.sourceLedgerJson)
      .filter(entry => category === 'all' || entry.category === category)
      .filter(entry => !query || [entry.title, entry.sourceTitle, entry.content, entry.interpretation, entry.novelConnection, ...(entry.tags || [])]
        .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }, [category, keyword, novel?.sourceLedgerJson])
  const pageEntries = entries.slice((page - 1) * 20, page * 20)

  const startCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ category: 'humanity', tags: [] })
    setOpen(true)
  }

  const startEdit = (entry: CreativeResearchEntry) => {
    setEditing(entry)
    form.setFieldsValue({
      category: entry.category, title: entry.title, sourceTitle: entry.sourceTitle,
      sourceUrl: entry.sourceUrl, tags: entry.tags || [], content: entry.content,
      interpretation: entry.interpretation, novelConnection: entry.novelConnection,
    })
    setOpen(true)
  }

  const refreshNovel = async () => {
    const updated = await window.electron.novel.get(novelId)
    if (updated && useNovelStore.getState().currentNovel?.id === novelId) setNovel(updated)
  }

  const save = async () => {
    try {
      const values = await form.validateFields()
      const entry: CreativeResearchDraft = { ...values, ...(editing ? { sourceKey: editing.sourceKey } : {}) }
      setSaving(true)
      const result = await window.electron.agentTools.call({
        toolId: 'novelforge.research.upsert',
        input: { novelId, entries: [entry] },
      })
      toolError(result)
      await refreshNovel()
      setPage(1)
      setOpen(false)
      message.success(editing ? '资料已更新' : '资料已保存到创作参考库')
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(error instanceof Error ? error.message : '保存资料失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry: CreativeResearchEntry) => {
    try {
      const result = await window.electron.agentTools.call({
        toolId: 'novelforge.research.delete', input: { novelId, sourceKey: entry.sourceKey },
      })
      toolError(result)
      await refreshNovel()
      setPage(1)
      message.success('资料卡已删除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除资料失败')
    }
  }

  return <div className="creative-research">
    <Segmented options={['本作资料', '个人资料']} value={library} onChange={value => setLibrary(String(value))} />
    {library === '个人资料' ? <PersonalResearchLibrary key={novelId} novelId={novelId} onDirtyChange={setPersonalDirty} /> : <>
    <ReferenceExtraction key={novelId} novelId={novelId} open={extracting} onClose={() => setExtracting(false)} onSaved={refreshNovel} />
    <section className="creative-research__intro">
      <div>
        <Text className="creative-research__eyebrow">作者自建 · 可自由撰写与拆解</Text>
        <h2>把参考转成可用的创作机制</h2>
        <p>记录概念如何运作、冲突由谁承担、它揭示了什么；再写清怎样转化到本作。资料只作灵感参考，不会自动成为世界设定或人物已知事实。</p>
      </div>
      <Space wrap><Button onClick={() => setExtracting(true)}>从文本提炼</Button><Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>新建资料卡</Button></Space>
    </section>

    <div className="creative-research__toolbar">
      <Input allowClear prefix={<SearchOutlined />} value={keyword} onChange={event => { setPage(1); setKeyword(event.target.value) }} placeholder="搜索标题、内容或标签" />
      <Select value={category} onChange={value => { setPage(1); setCategory(value) }} options={[{ value: 'all', label: '全部分类' }, ...CREATIVE_RESEARCH_CATEGORIES.map(item => ({ value: item.value, label: item.label }))]} />
      <Text type="secondary">{entries.length} 条</Text>
    </div>

    {entries.length === 0 ? <div className="creative-research__empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword || category !== 'all' ? '没有匹配的资料卡' : '还没有作者自建资料'} /><p>可以从一条具体的思想、制度、民俗或志怪机制开始，再补上它在本作中的意义。</p></div> :
      <div className="creative-research__grid">{pageEntries.map(entry => <Card key={entry.sourceKey} className="creative-research__card" size="small">
        <div className="creative-research__card-heading">
          <div><Tag>{getCreativeResearchCategoryLabel(entry.category)}</Tag><Tag color="blue">仅供启发</Tag></div>
          <Space size={4}>
            <Button type="text" size="small" icon={<EditOutlined />} aria-label={`编辑${entry.title}`} onClick={() => startEdit(entry)} />
            <Popconfirm title="删除这条创作参考？" description="删除后不会影响正文与 Canon。" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => void remove(entry)}>
              <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`删除${entry.title}`} />
            </Popconfirm>
          </Space>
        </div>
        <h3>{entry.title}</h3>
        <Button size="small" onClick={() => { void callAuthorTool('novelforge.research.publish', { novelId, sourceKey: entry.sourceKey }).then(() => message.success('已发布到个人资料；本作转化说明未发布')).catch(cause => message.error(String(cause))) }}>发布通用卡到个人库</Button>
        {entry.sourceTitle && <Text type="secondary" className="creative-research__source">参考：{entry.sourceTitle}{entry.sourceUrl ? <> · <a href={entry.sourceUrl} target="_blank" rel="noreferrer">出处</a></> : null}</Text>}
        {entry.provenance && <details className="author-disclosure"><summary>提炼依据{entry.provenance.sourceLabel ? ` · ${entry.provenance.sourceLabel}` : ''}</summary><blockquote>{entry.provenance.quote}</blockquote></details>}
        <Paragraph className="creative-research__body" ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>{entry.content}</Paragraph>
        {entry.interpretation && <div className="creative-research__meaning"><Text strong>深层含义</Text><Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>{entry.interpretation}</Paragraph></div>}
        {entry.novelConnection && <div className="creative-research__adaptation"><Text strong>本作转化</Text><Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>{entry.novelConnection}</Paragraph></div>}
        {entry.tags?.length ? <div className="creative-research__tags">{entry.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div> : null}
      </Card>)}</div>}
    {entries.length > 20 ? <Pagination className="creative-research__pagination" current={page} pageSize={20} total={entries.length} showSizeChanger={false} onChange={setPage} /> : null}

    <Modal title={editing ? `编辑资料卡 · ${editing.title}` : '新建创作资料卡'} open={open} onCancel={() => { if (!saving) setOpen(false) }} onOk={() => void save()} confirmLoading={saving} okText="保存到创作参考" cancelText="取消" width={760} destroyOnClose>
      <Form form={form} layout="vertical" requiredMark={false} className="creative-research__form">
        <div className="creative-research__form-row">
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: '请填写一个能说明机制或问题的标题' }, { max: 120, message: '标题最多 120 个字符' }]}><Input maxLength={120} placeholder="例如：赎罪为何会变成新的权力" /></Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}><Select options={CREATIVE_RESEARCH_CATEGORIES.map(item => ({ value: item.value, label: item.label }))} /></Form.Item>
        </div>
        <div className="creative-research__form-row">
          <Form.Item name="sourceTitle" label="参考出处（可选）"><Input maxLength={160} placeholder="作品、典籍、史料或口述来源" /></Form.Item>
          <Form.Item name="sourceUrl" label="出处链接（可选）" rules={[{ type: 'url', message: '请输入完整链接' }]}><Input maxLength={500} placeholder="https://..." /></Form.Item>
        </div>
        <Form.Item name="tags" label="标签（可选）"><Select mode="tags" maxCount={12} maxTagTextLength={30} tokenSeparators={[',', '，', '、']} placeholder="用标签标出适用主题或叙事用途" /></Form.Item>
        <Form.Item name="content" label="核心资料与机制" extra="写清它如何运作、会造成什么冲突或代价；可以自由组织段落。" rules={[{ required: true, whitespace: true, message: '请写下要保存的内容' }, { max: 4000, message: '内容最多 4000 个字符' }]}><Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} maxLength={4000} showCount placeholder="自由写下概念、制度、场景结构、民间做法或人物处境……" /></Form.Item>
        <Form.Item name="interpretation" label="深层含义" extra="写出它触及的信仰、权力、人性矛盾或读者感受。" rules={[{ required: true, whitespace: true, message: '请说明这条资料触及的深层问题' }, { max: 1200, message: '最多 1200 个字符' }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={1200} showCount placeholder="表层事件之外，它让读者重新理解什么？" /></Form.Item>
        <Form.Item name="novelConnection" label="本作转化方向" extra="结合当前小说的背景、人物困境或主线，说明原创转化方式；不要照搬原作。" rules={[{ required: true, whitespace: true, message: '请写明它与本作背景或冲突的连接' }, { max: 1200, message: '最多 1200 个字符' }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={1200} showCount placeholder="它可以怎样映照本作的世界、人物困境或主线冲突？" /></Form.Item>
      </Form>
    </Modal>
    </>}
  </div>
}
