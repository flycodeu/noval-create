import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Pagination, Select, Space, Spin, Tag, message } from 'antd'
import { AppstoreAddOutlined, DeleteOutlined, InboxOutlined, ReloadOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons'
import VirtualList from 'rc-virtual-list'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { Character, MapNodeSummary, PagedResult, StoryItem, StoryItemFilterOptions, StoryItemStats, TimelineEvent } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { EMPTY_WORKFLOW_STATS, getWorkflowBlockers, loadWorkflowStats, type WorkflowStats } from '../workflow'

interface Props { novelId: number }
interface ItemFormValues {
  itemKind: 'template' | 'instance'
  parentItemId?: number
  itemName: string
  category?: string
  subType?: string
  rarity?: string
  ownerCharacterId?: number
  locationMapId?: number
  status: StoryItem['status']
  summary?: string
  acquisitionMethod?: string
  usageMethod?: string
  cost?: string
  risk?: string
  plotFunction?: string
  appearance?: string
  factionHint?: string
  linkedCharacterIds: number[]
  linkedTimelineEventIds: number[]
  tags: string[]
}
interface GenerateFormValues {
  templateOnly: boolean
  refreshTemplates: boolean
  count: number
  batchSize: number
  focus?: string
}

const PAGE_SIZE = 24
const EMPTY_PAGE: PagedResult<StoryItem> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: StoryItemStats = { total: 0, templateCount: 0, instanceCount: 0, linkedEventCount: 0, categoryCount: 0 }
const EMPTY_FILTERS: StoryItemFilterOptions = { categories: [], rarities: [] }
const RARITY_OPTIONS = ['常见', '稀有', '核心', '禁用级']

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((item) => typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : Number.NaN).filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function toFormValues(item: StoryItem): ItemFormValues {
  return {
    itemKind: item.itemKind,
    parentItemId: item.parentItemId,
    itemName: item.itemName,
    category: item.category || '',
    subType: item.subType || '',
    rarity: item.rarity || '',
    ownerCharacterId: item.ownerCharacterId,
    locationMapId: item.locationMapId,
    status: item.status,
    summary: item.summary || '',
    acquisitionMethod: item.acquisitionMethod || '',
    usageMethod: item.usageMethod || '',
    cost: item.cost || '',
    risk: item.risk || '',
    plotFunction: item.plotFunction || '',
    appearance: item.appearance || '',
    factionHint: item.factionHint || '',
    linkedCharacterIds: parseNumberArray(item.linkedCharacterIdsJson),
    linkedTimelineEventIds: parseNumberArray(item.linkedTimelineEventIdsJson),
    tags: parseStringArray(item.tagsJson),
  }
}

function emptyValues(kind: StoryItem['itemKind']): ItemFormValues {
  return {
    itemKind: kind, parentItemId: undefined, itemName: '', category: '', subType: '', rarity: '',
    ownerCharacterId: undefined, locationMapId: undefined, status: 'available', summary: '', acquisitionMethod: '',
    usageMethod: '', cost: '', risk: '', plotFunction: '', appearance: '', factionHint: '',
    linkedCharacterIds: [], linkedTimelineEventIds: [], tags: [],
  }
}

function serialize(values: ItemFormValues): Partial<StoryItem> {
  return {
    itemKind: values.itemKind,
    parentItemId: values.parentItemId,
    itemName: values.itemName.trim(),
    category: values.category?.trim() || '',
    subType: values.subType?.trim() || '',
    rarity: values.rarity?.trim() || '',
    ownerCharacterId: values.ownerCharacterId,
    locationMapId: values.locationMapId,
    status: values.status,
    summary: values.summary?.trim() || '',
    acquisitionMethod: values.acquisitionMethod?.trim() || '',
    usageMethod: values.usageMethod?.trim() || '',
    cost: values.cost?.trim() || '',
    risk: values.risk?.trim() || '',
    plotFunction: values.plotFunction?.trim() || '',
    appearance: values.appearance?.trim() || '',
    factionHint: values.factionHint?.trim() || '',
    linkedCharacterIdsJson: JSON.stringify(values.linkedCharacterIds || []),
    linkedTimelineEventIdsJson: JSON.stringify(values.linkedTimelineEventIds || []),
    tagsJson: JSON.stringify((values.tags || []).map((item) => item.trim()).filter(Boolean)),
  }
}

function mergeById<T extends { id: number }>(base: T[], extras: Array<T | null | undefined>) {
  const map = new Map(base.map((item) => [item.id, item]))
  extras.forEach((item) => { if (item) map.set(item.id, item) })
  return [...map.values()]
}

export default function ItemsWorkspace({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<ItemFormValues>()
  const [generateForm] = Form.useForm<GenerateFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [pageData, setPageData] = useState<PagedResult<StoryItem>>(EMPTY_PAGE)
  const [stats, setStats] = useState<StoryItemStats>(EMPTY_STATS)
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [filters, setFilters] = useState<StoryItemFilterOptions>(EMPTY_FILTERS)
  const [selectedItem, setSelectedItem] = useState<StoryItem | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [listMode, setListMode] = useState<'template' | 'instance'>('template')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [templateOptions, setTemplateOptions] = useState<StoryItem[]>([])
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [locationOptions, setLocationOptions] = useState<MapNodeSummary[]>([])
  const [eventOptions, setEventOptions] = useState<TimelineEvent[]>([])
  const itemKind = Form.useWatch('itemKind', form)
  const rarityOptions = useMemo(() => Array.from(new Set([...RARITY_OPTIONS, ...filters.rarities].filter(Boolean))), [filters.rarities])
  const generationBlockers = useMemo(() => getWorkflowBlockers('items', currentNovel, workflowStats), [currentNovel, workflowStats])

  const searchTemplates = useCallback(async (value = '') => {
    const rows = await window.electron.item.search(novelId, value, 'template', 20)
    setTemplateOptions((prev) => mergeById(rows, prev))
  }, [novelId])
  const searchCharacters = useCallback(async (value = '') => {
    const rows = await window.electron.character.search(novelId, value, 20)
    setCharacterOptions((prev) => mergeById(rows, prev))
  }, [novelId])
  const searchLocations = useCallback(async (value = '') => {
    const rows = await window.electron.map.searchNodes(novelId, value, 20)
    setLocationOptions((prev) => mergeById(rows, prev))
  }, [novelId])
  const searchEvents = useCallback(async (value = '') => {
    const rows = await window.electron.timeline.search(novelId, value, 20)
    setEventOptions((prev) => mergeById(rows, prev))
  }, [novelId])

  const hydrateOptions = useCallback(async (item?: StoryItem | null) => {
    const templateId = item?.parentItemId
    const ownerId = item?.ownerCharacterId
    const locationId = item?.locationMapId
    const linkedCharacterIds = item ? parseNumberArray(item.linkedCharacterIdsJson) : []
    const linkedEventIds = item ? parseNumberArray(item.linkedTimelineEventIdsJson) : []
    const [baseTemplates, baseCharacters, baseLocations, baseEvents, extraTemplate, extraOwner, extraLocation, extraCharacters, extraEvents] = await Promise.all([
      window.electron.item.search(novelId, '', 'template', 20),
      window.electron.character.search(novelId, '', 20),
      window.electron.map.searchNodes(novelId, '', 20),
      window.electron.timeline.search(novelId, '', 20),
      templateId ? window.electron.item.get(templateId) : Promise.resolve(null),
      ownerId ? window.electron.character.get(ownerId) : Promise.resolve(null),
      locationId ? window.electron.map.getNode(locationId) : Promise.resolve(null),
      Promise.all(linkedCharacterIds.map((id) => window.electron.character.get(id))),
      Promise.all(linkedEventIds.map((id) => window.electron.timeline.get(id))),
    ])
    setTemplateOptions(mergeById(baseTemplates, [extraTemplate]))
    setCharacterOptions(mergeById(baseCharacters, [extraOwner, ...extraCharacters]))
    setLocationOptions(mergeById(baseLocations, [extraLocation]))
    setEventOptions(mergeById(baseEvents, extraEvents))
  }, [novelId])

  const loadItemDetail = useCallback(async (itemId: number) => {
    const item = await window.electron.item.get(itemId)
    if (!item) {
      setSelectedId(null); setSelectedItem(null); form.resetFields(); return
    }
    setSelectedId(item.id)
    setSelectedItem(item)
    form.setFieldsValue(toFormValues(item))
    await hydrateOptions(item)
  }, [form, hydrateOptions])

  const loadPage = useCallback(async (preferredId?: number | null, targetPage = page) => {
    setLoading(true)
    try {
      const query = { novelId, itemKind: listMode, page: targetPage, pageSize: PAGE_SIZE, ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}), ...(keyword.trim() ? { keyword: keyword.trim() } : {}) }
      const [list, summary, nextFilters, nextWorkflowStats] = await Promise.all([window.electron.item.query(query), window.electron.item.getStats({ novelId }), window.electron.item.getFilterOptions(novelId), loadWorkflowStats(novelId)])
      setPageData(list)
      setStats(summary)
      setFilters(nextFilters)
      setWorkflowStats(nextWorkflowStats)
      const nextId = preferredId ?? (list.items.some((item) => item.id === selectedId) ? selectedId : list.items[0]?.id ?? null)
      if (nextId) { setCreating(false); await loadItemDetail(nextId) }
      else { setSelectedId(null); setSelectedItem(null); setCreating(false); form.resetFields(); await hydrateOptions(null) }
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, form, hydrateOptions, keyword, listMode, loadItemDetail, novelId, page, selectedId])

  useEffect(() => { void loadPage(selectedId, page) }, [loadPage, page, selectedId])
  useEffect(() => { setPage(1) }, [categoryFilter, keyword, listMode])
  useEffect(() => { generateForm.setFieldsValue({ count: 12, batchSize: 4, templateOnly: false, refreshTemplates: true, focus: '' }) }, [generateForm])

  const handleNew = (kind: 'template' | 'instance') => {
    setCreating(true)
    setListMode(kind)
    setSelectedId(null)
    setSelectedItem(null)
    form.setFieldsValue(emptyValues(kind))
    void hydrateOptions(null)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (selectedItem?.id) { await window.electron.item.update(selectedItem.id, serialize(values)); await loadPage(selectedItem.id, page) }
      else { const nextId = await window.electron.item.create(novelId, serialize(values)); await loadPage(nextId, page) }
      setCreating(false)
      message.success('物品已保存。')
    } catch (error) {
      console.error(error)
      message.error('保存失败，请稍后再试。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem?.id) return
    Modal.confirm({
      title: `删除“${selectedItem.itemName}”？`,
      content: '删除后不会自动清理其它模块中的引用。',
      okButtonProps: { danger: true },
      onOk: async () => { await window.electron.item.delete(selectedItem.id); await loadPage(null, page); message.success('物品已删除。') },
    })
  }

  const resolveGenerationBlockers = useCallback(async () => {
    const nextWorkflowStats = await loadWorkflowStats(novelId)
    setWorkflowStats(nextWorkflowStats)
    return getWorkflowBlockers('items', currentNovel, nextWorkflowStats)
  }, [currentNovel, novelId])

  const openGenerateModal = useCallback(async () => {
    const blockers = await resolveGenerationBlockers()
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }

    setGenerateOpen(true)
  }, [resolveGenerationBlockers])

  const handleGenerate = async () => {
    const blockers = await resolveGenerationBlockers()
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }

    const values = generateForm.getFieldsValue()
    setGenerating(true)
    try {
      await window.electron.item.generate(novelId, values)
      setGenerateOpen(false)
      await loadPage(null, 1)
      message.success(values.templateOnly ? '模板已生成。' : '物品已补齐一批。')
    } catch (error) {
      console.error(error)
      message.error('生成失败，请稍后再试。')
    } finally {
      setGenerating(false)
    }
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空物品系统？',
      content: '会删除当前小说下全部模板和实例。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => { await window.electron.item.clear(novelId); form.resetFields(); setSelectedId(null); setSelectedItem(null); setCreating(false); await loadPage(null, 1); message.success('物品系统已清空。') },
    })
  }

  const aiActions = selectedItem || creating ? (
    <AIGenerateButton
      label={itemKind === 'instance' ? 'AI 生成实例' : 'AI 生成模板'}
      isJson
      buildMessages={() => {
        const values = form.getFieldsValue(true)
        return buildDraftMessages({
          task: itemKind === 'instance' ? '剧情物品实例' : '物品模板',
          mode: values.itemName ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '简介', value: currentNovel?.synopsis || '' },
            { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
            { label: '记录类型', value: itemKind === 'instance' ? '实例' : '模板' },
            { label: '已选模板', value: templateOptions.find((item) => item.id === values.parentItemId)?.itemName || '' },
            { label: '已选持有者', value: characterOptions.find((item) => item.id === values.ownerCharacterId)?.fullName || '' },
            { label: '已选地点', value: locationOptions.find((item) => item.id === values.locationMapId)?.name || '' },
          ],
          fields: [
            { key: 'itemName', label: '名称', value: values.itemName, hint: '像小说里的真实物品。' },
            { key: 'category', label: '主分类', value: values.category, hint: '例如武器、药品、证据、信物。' },
            { key: 'subType', label: '细分类', value: values.subType, hint: '进一步说明形态或用途。' },
            { key: 'rarity', label: '稀缺度', value: values.rarity, hint: '可用常见、稀有、核心、禁用级。' },
            { key: 'summary', label: '一句话说明', value: values.summary, hint: '一句话说清它是什么。' },
            { key: 'appearance', label: '外观', value: values.appearance, hint: '写识别点，不要堆形容词。' },
            { key: 'acquisitionMethod', label: '获取方式', value: values.acquisitionMethod, hint: '写清怎么得到。' },
            { key: 'usageMethod', label: '使用方式', value: values.usageMethod, hint: '写清怎么用。' },
            { key: 'cost', label: '代价', value: values.cost, hint: '明确成本或门槛。' },
            { key: 'risk', label: '风险', value: values.risk, hint: '明确副作用或后果。' },
            { key: 'plotFunction', label: '剧情作用', value: values.plotFunction, hint: '写清推动哪条线。' },
            { key: 'factionHint', label: '关联势力', value: values.factionHint, hint: '没有可留空。' },
            { key: 'tags', label: '标签', type: 'string[]', value: values.tags, hint: '3 到 6 个标签。' },
          ],
          requirements: ['不要改动已选中的模板、角色、地点和事件关联。', '不要写百科腔和口号。'],
        })
      }}
      onResult={(raw) => {
        const draft = parseDraftJson<Record<string, unknown>>(raw)
        const currentValues = form.getFieldsValue(true)
        form.setFieldsValue({
          ...currentValues,
          itemName: typeof draft.itemName === 'string' ? draft.itemName : currentValues.itemName,
          category: typeof draft.category === 'string' ? draft.category : currentValues.category,
          subType: typeof draft.subType === 'string' ? draft.subType : currentValues.subType,
          rarity: typeof draft.rarity === 'string' ? draft.rarity : currentValues.rarity,
          summary: typeof draft.summary === 'string' ? draft.summary : currentValues.summary,
          appearance: typeof draft.appearance === 'string' ? draft.appearance : currentValues.appearance,
          acquisitionMethod: typeof draft.acquisitionMethod === 'string' ? draft.acquisitionMethod : currentValues.acquisitionMethod,
          usageMethod: typeof draft.usageMethod === 'string' ? draft.usageMethod : currentValues.usageMethod,
          cost: typeof draft.cost === 'string' ? draft.cost : currentValues.cost,
          risk: typeof draft.risk === 'string' ? draft.risk : currentValues.risk,
          plotFunction: typeof draft.plotFunction === 'string' ? draft.plotFunction : currentValues.plotFunction,
          factionHint: typeof draft.factionHint === 'string' ? draft.factionHint : currentValues.factionHint,
          tags: normalizeStringArray(draft.tags ?? currentValues.tags),
        })
      }}
    />
  ) : null

  return (
    <WorkspacePage
      eyebrow="物品系统"
      title="物品与装备"
      description="模板和实例统一管理，单条记录支持 AI 起草。"
      actions={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void loadPage(selectedId, page)}>刷新</Button><Button icon={<AppstoreAddOutlined />} onClick={() => handleNew('template')}>新建模板</Button><Button icon={<InboxOutlined />} onClick={() => handleNew('instance')}>新建实例</Button><Button type="primary" icon={<ThunderboltOutlined />} onClick={() => void openGenerateModal()}>AI 批量生成</Button><Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空</Button></Space>}
      contextSummary={<WorkspaceContextSummary items={[{ label: '书名', value: currentNovel?.title || '未命名小说' }, { label: '当前列表', value: listMode === 'template' ? '模板' : '实例' }, { label: '筛选结果', value: `${pageData.total} 条` }, { label: '当前焦点', value: selectedItem?.itemName || (creating ? '新建中' : '未选择') }]} />}
      metrics={<><WorkspaceMetric label="模板" value={stats.templateCount} tone="warm" /><WorkspaceMetric label="实例" value={stats.instanceCount} /><WorkspaceMetric label="分类" value={stats.categoryCount} tone="cool" /><WorkspaceMetric label="事件关联" value={stats.linkedEventCount} /></>}
    >
      {generationBlockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="当前还不适合批量生成物品"
          description={(
            <div>
              {generationBlockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel title="列表" description="筛选和搜索都走后端查询。" extra={<div className="novel-filter-bar"><div className="novel-filter-bar__row"><Input.Search allowClear placeholder="搜索名称、分类、作用" value={keyword} onChange={(event) => setKeyword(event.target.value)} onSearch={setKeyword} /><Select value={listMode} options={[{ value: 'template', label: '模板' }, { value: 'instance', label: '实例' }]} onChange={(value) => setListMode(value)} /></div><div className="novel-filter-bar__row"><Select value={categoryFilter} options={[{ value: 'all', label: '全部分类' }, ...filters.categories.map((item) => ({ value: item, label: item }))]} onChange={setCategoryFilter} /></div><div className="novel-filter-bar__summary">当前共 {pageData.total} 条</div></div>}>
          {loading ? <div className="novel-empty"><Spin /></div> : pageData.total === 0 ? <div className="novel-empty">当前筛选下还没有记录。</div> : <div style={{ display: 'grid', gap: 12 }}><VirtualList data={pageData.items} height={520} itemHeight={118} itemKey="id">{(item: StoryItem) => <button key={item.id} type="button" className={`novel-list-card ${selectedId === item.id ? 'novel-list-card--active' : ''}`} onClick={() => void loadItemDetail(item.id)} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="novel-list-card__title">{item.itemName}</div><div className="novel-list-card__meta"><Tag color={item.itemKind === 'template' ? 'blue' : 'processing'}>{item.itemKind === 'template' ? '模板' : '实例'}</Tag>{item.category ? <Tag>{item.category}</Tag> : null}{item.subType ? <Tag>{item.subType}</Tag> : null}{item.rarity ? <Tag color="gold">{item.rarity}</Tag> : null}</div><div className="novel-list-card__desc">{item.plotFunction || item.summary || item.appearance || '还没有补充说明。'}</div></button>}</VirtualList><Pagination current={pageData.page} pageSize={pageData.pageSize} total={pageData.total} size="small" showSizeChanger={false} onChange={setPage} /></div>}
        </WorkspacePanel>
        <WorkspacePanel title={selectedItem ? `编辑：${selectedItem.itemName}` : creating ? '新建物品' : '物品详情'} description="只编辑当前记录。" extra={<Space wrap>{aiActions}{selectedItem ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button></Space>}>
          {!selectedItem && !creating && !loading ? <div className="novel-empty">从左侧选择一条记录，或直接新建。</div> : <Form form={form} layout="vertical"><div className="novel-grid novel-grid--3"><Form.Item name="itemKind" label="记录类型" rules={[{ required: true, message: '请选择记录类型' }]}><Select options={[{ value: 'template', label: '模板' }, { value: 'instance', label: '实例' }]} /></Form.Item><Form.Item name="category" label="主分类"><Input placeholder="例如：武器、药品、证据" /></Form.Item><Form.Item name="subType" label="细分类"><Input placeholder="进一步说明形态或用途" /></Form.Item></div><div className="novel-grid novel-grid--3"><Form.Item name="itemName" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="写得像剧情里的真实物品" /></Form.Item><Form.Item name="rarity" label="稀缺度"><Select allowClear options={rarityOptions.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="status" label="状态"><Select options={[{ value: 'available', label: '可用' }, { value: 'hidden', label: '隐藏' }, { value: 'consumed', label: '已消耗' }, { value: 'destroyed', label: '已毁损' }]} /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="summary" label="一句话说明"><Input.TextArea rows={3} /></Form.Item><Form.Item name="appearance" label="外观"><Input.TextArea rows={3} /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="acquisitionMethod" label="获取方式"><Input.TextArea rows={3} /></Form.Item><Form.Item name="usageMethod" label="使用方式"><Input.TextArea rows={3} /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="cost" label="代价"><Input.TextArea rows={3} /></Form.Item><Form.Item name="risk" label="风险"><Input.TextArea rows={3} /></Form.Item></div><Form.Item name="plotFunction" label="剧情作用"><Input.TextArea rows={3} /></Form.Item><div className="novel-grid novel-grid--2"><Form.Item name="factionHint" label="关联势力"><Input /></Form.Item><Form.Item name="tags" label="标签"><Select mode="tags" open={false} placeholder="输入后回车" /></Form.Item></div>{itemKind === 'instance' ? <><div className="novel-grid novel-grid--3"><Form.Item name="parentItemId" label="来源模板"><Select allowClear showSearch filterOption={false} options={templateOptions.map((item) => ({ value: item.id, label: item.itemName }))} onFocus={() => void searchTemplates('')} onSearch={(value) => void searchTemplates(value)} /></Form.Item><Form.Item name="ownerCharacterId" label="当前持有者"><Select allowClear showSearch filterOption={false} options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))} onFocus={() => void searchCharacters('')} onSearch={(value) => void searchCharacters(value)} /></Form.Item><Form.Item name="locationMapId" label="主要地点"><Select allowClear showSearch filterOption={false} options={locationOptions.map((item) => ({ value: item.id, label: item.name }))} onFocus={() => void searchLocations('')} onSearch={(value) => void searchLocations(value)} /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="linkedCharacterIds" label="关联人物"><Select mode="multiple" allowClear showSearch filterOption={false} options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))} onFocus={() => void searchCharacters('')} onSearch={(value) => void searchCharacters(value)} /></Form.Item><Form.Item name="linkedTimelineEventIds" label="关联事件"><Select mode="multiple" allowClear showSearch filterOption={false} options={eventOptions.map((item) => ({ value: item.id, label: `${item.timeLabel} · ${item.eventTitle}` }))} onFocus={() => void searchEvents('')} onSearch={(value) => void searchEvents(value)} /></Form.Item></div></> : null}</Form>}
        </WorkspacePanel>
      </div>
      <Modal title="AI 批量生成物品" open={generateOpen} forceRender onCancel={() => setGenerateOpen(false)} onOk={() => void handleGenerate()} confirmLoading={generating} okText="生成下一批"><Form form={generateForm} layout="vertical"><Form.Item name="templateOnly" label="生成模式"><Select options={[{ value: false, label: '模板和实例一起生成' }, { value: true, label: '只生成模板' }]} /></Form.Item><Form.Item name="refreshTemplates" label="模板同步"><Select options={[{ value: true, label: '按当前题材刷新模板' }, { value: false, label: '保留已有模板，只补缺口' }]} /></Form.Item><Form.Item name="count" label="本轮目标数量"><Select options={[8, 10, 12, 14, 18].map((count) => ({ value: count, label: `${count} 条` }))} /></Form.Item><Form.Item name="batchSize" label="每批数量"><Select options={[2, 3, 4, 5, 6].map((count) => ({ value: count, label: `${count} 条 / 批` }))} /></Form.Item><Form.Item name="focus" label="额外聚焦"><Input.TextArea rows={3} placeholder="例如：主角团装备、关键证据、宗门资源" /></Form.Item></Form></Modal>
    </WorkspacePage>
  )
}
