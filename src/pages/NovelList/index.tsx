import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Skeleton, message } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ModelConfig, Novel } from '../../types'
import { useNovelStore } from '../../stores/novel.store'
import { buildWorkspaceRoute } from '../../shared/novel-workspace'
import { buildStorySettingsPayload } from '../../shared/story-settings'
import ProjectCard from '../../components/novel/cards/ProjectCard'
import './index.css'

interface NewBook {
  title: string
  userBackground?: string
  constraints?: string
  genreId?: number
  targetWords?: number
  modelConfigId?: number
}
const GENRES = ['现代都市', '古代言情', '玄幻修真', '悬疑推理', '科幻未来', '架空历史', '赛博朋克', '武侠', '历史正剧', '末世求生', '丧尸末日', '盗墓探秘']
const STATUS = [{ value: 'all', label: '全部作品' }, { value: 'draft', label: '构思中' }, { value: 'writing', label: '写作中' }, { value: 'completed', label: '已完成' }, { value: 'archived', label: '已归档' }]

export default function NovelList() {
  const navigate = useNavigate()
  const novels = useNovelStore(state => state.novels)
  const setNovels = useNovelStore(state => state.setNovels)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('updatedAt')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelError, setModelError] = useState('')
  const [form] = Form.useForm<NewBook>()
  const createInFlight = useRef(false)
  const loadVersion = useRef(0)
  const load = useCallback(async () => {
    const version = ++loadVersion.current
    setLoading(true)
    try { const rows = await window.electron.novel.list(); if (version === loadVersion.current) { setNovels(rows); setError('') } }
    catch (cause) { if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : '读取作品失败') }
    finally { if (version === loadVersion.current) setLoading(false) }
  }, [setNovels])
  useEffect(() => { void load(); return () => { loadVersion.current += 1 } }, [load])
  useEffect(() => {
    if (!creating) return
    let current = true
    void window.electron.model.list().then(rows => { if (current) { setModels(rows); setModelError('') } }).catch(cause => { if (current) setModelError(cause instanceof Error ? cause.message : '读取模型失败') })
    return () => { current = false }
  }, [creating])
  const create = async () => {
    if (createInFlight.current) return
    createInFlight.current = true
    try {
      const values = await form.validateFields()
      setSaving(true)
      const id = await window.electron.novel.create({
        title: values.title.trim(), userBackground: values.userBackground?.trim() || '',
        genreId: values.genreId, targetWords: values.targetWords, modelConfigId: values.modelConfigId,
        launchMode: 'professional_longform',
        settingsJson: JSON.stringify(buildStorySettingsPayload({ premise: { constraints: values.constraints?.trim() || '' } })),
      })
      setCreating(false); form.resetFields()
      navigate(buildWorkspaceRoute(id, 'guide'))
    } catch (cause) {
      if (!(typeof cause === 'object' && cause !== null && 'errorFields' in cause)) message.error(cause instanceof Error ? cause.message : '创建作品失败')
    } finally { createInFlight.current = false; setSaving(false) }
  }
  const remove = (novel: Novel) => Modal.confirm({ title: `删除《${novel.title}》？`, content: '章节、人物、地图及历史版本都会删除，无法恢复。', okText: '删除作品', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => { await window.electron.novel.delete(novel.id); await load() } })
  const updateStatus = async (id: number, next: Novel['status']) => {
    try { await window.electron.novel.update(id, { status: next }); await load() }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '保存状态失败') }
  }
  const exportBook = async (id: number, format: string) => {
    try { const destination = await window.electron.novel.export(id, format); if (destination) message.success(`已导出到 ${destination}`) }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '导出失败') }
  }
  const filtered = novels.filter(novel => (status === 'all' || novel.status === status) && `${novel.title} ${novel.synopsis || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
    if (sort === 'totalWords') return (b.totalWords || 0) - (a.totalWords || 0)
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  })
  return <div className="novel-list-page"><div className="novel-list-page__shell">
    <header className="novel-list-page__header"><div className="novel-list-page__copy"><span className="novel-library-eyebrow">NOVELFORGE / 作品书架</span><h1 className="novel-list-page__title">我的小说</h1></div><Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建小说</Button></header>
    <div className="novel-list-page__toolbar">
      <Input className="novel-list-page__toolbar-field--search" prefix={<SearchOutlined />} aria-label="搜索作品" placeholder="搜索书名或简介" value={search} onChange={event => setSearch(event.target.value)} allowClear />
      <Select aria-label="作品状态" value={status} onChange={setStatus} options={STATUS} />
      <Select aria-label="作品排序" value={sort} onChange={setSort} options={[{ value: 'updatedAt', label: '最近修改' }, { value: 'totalWords', label: '正文字数' }, { value: 'title', label: '书名' }]} />
      <Button type="text" icon={<ReloadOutlined />} aria-label="刷新作品" onClick={() => void load()} loading={loading} /><span className="novel-library-count">{filtered.length} 部作品</span>
    </div>
    {error && <Alert type="error" message={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : !filtered.length ? <Empty description={novels.length ? '没有匹配的作品。' : '给你的第一个故事留一个位置。'}>{!novels.length && <Button onClick={() => setCreating(true)}>新建小说</Button>}</Empty> : <div className="novel-list-page__grid">{filtered.map(novel => <ProjectCard key={novel.id} novel={novel} onOpen={() => navigate(buildWorkspaceRoute(novel.id, 'guide'))} onDelete={() => remove(novel)} onExport={format => void exportBook(novel.id, format)} onStatusChange={next => void updateStatus(novel.id, next)} />)}</div>}
    <Modal title="开始一部小说" open={creating} onCancel={() => { if (!saving) setCreating(false) }} onOk={() => void create().catch(() => undefined)} okText="创建并进入创作台" cancelText="取消" confirmLoading={saving} closable={!saving} maskClosable={!saving} width={720}>
      <Form form={form} layout="vertical" className="novel-create-form">
        <Form.Item name="title" label="书名" rules={[{ required: true, whitespace: true, message: '先给作品一个名字，之后可以修改。' }]}><Input maxLength={100} placeholder="可以先用暂定名" /></Form.Item>
        <Form.Item name="userBackground" label="故事起点" extra="填写已经确定的时代、人物处境或已有故事；其余内容可以在创作台逐步生成。"><Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} placeholder="故事发生在哪里？主角目前面临什么？也可以暂时留空。" /></Form.Item>
        <Form.Item name="constraints" label="创作要求与限制"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="例如：主角是普通人；不改已有关系；第三人称限知。" /></Form.Item>
        <div className="novel-create-pair"><Form.Item name="genreId" label="题材"><Select allowClear placeholder="暂不指定" options={GENRES.map((label, index) => ({ value: index + 1, label }))} /></Form.Item><Form.Item name="targetWords" label="预计总字数（可选）"><InputNumber min={1000} max={10000000} step={10000} placeholder="仅作为规划参考" style={{ width: '100%' }} /></Form.Item></div>
        <Form.Item name="modelConfigId" label="创作模型"><Select allowClear placeholder={models.find(model => model.isDefault)?.name ? `跟随默认：${models.find(model => model.isDefault)?.name}` : '稍后配置模型也可以创建'} options={models.map(model => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))} /></Form.Item>
        {modelError && <Alert type="warning" message={modelError} />}
      </Form>
    </Modal>
  </div></div>
}
