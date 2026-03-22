import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Pagination, Select, Space, Spin, Tag, message } from 'antd'
import { AppstoreAddOutlined, DeleteOutlined, InboxOutlined, ReloadOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons'
import VirtualList from 'rc-virtual-list'
import type { Character, MapNodeSummary, PagedResult, StoryItem, StoryItemFilterOptions, StoryItemStats, TimelineEvent } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getItemGenerationProfile } from '../../../shared/creation-tools'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import '../components/boards.css'

interface Props { novelId: number }
interface ItemFormValues { itemKind: 'template' | 'instance'; parentItemId?: number; itemName: string; category?: string; subType?: string; rarity?: string; ownerCharacterId?: number; locationMapId?: number; status: 'available' | 'consumed' | 'hidden' | 'destroyed'; summary?: string; acquisitionMethod?: string; usageMethod?: string; cost?: string; risk?: string; plotFunction?: string; appearance?: string; factionHint?: string; linkedCharacterIds: number[]; linkedTimelineEventIds: number[]; tags: string[] }
interface GenerateFormValues { templateOnly: boolean; refreshTemplates: boolean; count: number; batchSize: number; focus?: string }

const PAGE_SIZE = 24
const EMPTY_PAGE: PagedResult<StoryItem> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: StoryItemStats = { total: 0, templateCount: 0, instanceCount: 0, linkedEventCount: 0, categoryCount: 0 }
const EMPTY_FILTERS: StoryItemFilterOptions = { categories: [], rarities: [] }
const ITEM_BOARD_COLUMNS: StoryItem['status'][] = ['available', 'hidden', 'consumed', 'destroyed']

function parseNumberArray(raw?: string | null): number[] { if (!raw) return []; try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map((item) => (typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : Number.NaN)).filter((item) => Number.isFinite(item)) : [] } catch { return [] } }
function parseStringArray(raw?: string | null): string[] { if (!raw) return []; try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [] } catch { return [] } }
function toFormValues(item: StoryItem): ItemFormValues { return { itemKind: item.itemKind, parentItemId: item.parentItemId, itemName: item.itemName, category: item.category || '', subType: item.subType || '', rarity: item.rarity || '', ownerCharacterId: item.ownerCharacterId, locationMapId: item.locationMapId, status: item.status, summary: item.summary || '', acquisitionMethod: item.acquisitionMethod || '', usageMethod: item.usageMethod || '', cost: item.cost || '', risk: item.risk || '', plotFunction: item.plotFunction || '', appearance: item.appearance || '', factionHint: item.factionHint || '', linkedCharacterIds: parseNumberArray(item.linkedCharacterIdsJson), linkedTimelineEventIds: parseNumberArray(item.linkedTimelineEventIdsJson), tags: parseStringArray(item.tagsJson) } }
function serialize(values: ItemFormValues): Partial<StoryItem> { return { itemKind: values.itemKind, parentItemId: values.parentItemId, itemName: values.itemName.trim(), category: values.category?.trim() || '', subType: values.subType?.trim() || '', rarity: values.rarity?.trim() || '', ownerCharacterId: values.ownerCharacterId, locationMapId: values.locationMapId, status: values.status, summary: values.summary?.trim() || '', acquisitionMethod: values.acquisitionMethod?.trim() || '', usageMethod: values.usageMethod?.trim() || '', cost: values.cost?.trim() || '', risk: values.risk?.trim() || '', plotFunction: values.plotFunction?.trim() || '', appearance: values.appearance?.trim() || '', factionHint: values.factionHint?.trim() || '', linkedCharacterIdsJson: JSON.stringify(values.linkedCharacterIds || []), linkedTimelineEventIdsJson: JSON.stringify(values.linkedTimelineEventIds || []), tagsJson: JSON.stringify((values.tags || []).map((item) => item.trim()).filter(Boolean)) } }
function mergeById<T extends { id: number }>(base: T[], extras: Array<T | null | undefined>) { const map = new Map(base.map((item) => [item.id, item])); extras.forEach((item) => { if (item) map.set(item.id, item) }); return [...map.values()] }

export default function ItemsWorkspace({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<ItemFormValues>()
  const [generateForm] = Form.useForm<GenerateFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [pageData, setPageData] = useState<PagedResult<StoryItem>>(EMPTY_PAGE)
  const [stats, setStats] = useState<StoryItemStats>(EMPTY_STATS)
  const [filterOptions, setFilterOptions] = useState<StoryItemFilterOptions>(EMPTY_FILTERS)
  const [selectedItem, setSelectedItem] = useState<StoryItem | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [listMode, setListMode] = useState<'template' | 'instance'>('template')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [templateOptions, setTemplateOptions] = useState<StoryItem[]>([])
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [locationOptions, setLocationOptions] = useState<MapNodeSummary[]>([])
  const [eventOptions, setEventOptions] = useState<TimelineEvent[]>([])
  const itemKind = Form.useWatch('itemKind', form)

  const profile = useMemo(() => getItemGenerationProfile(currentNovel?.genreName), [currentNovel?.genreName])
  const categoryOptions = useMemo(() => Array.from(new Set([...profile.templates.map((item) => item.category).filter(Boolean), ...filterOptions.categories])), [filterOptions.categories, profile.templates])
  const rarityOptions = useMemo(() => Array.from(new Set(['常见', '稀有', '核心', '禁用级', ...filterOptions.rarities])).filter(Boolean), [filterOptions.rarities])
  const currentModeLabel = listMode === 'template' ? '模板' : '实例'

  const buildQuery = useCallback((targetPage = page) => ({ novelId, itemKind: listMode, page: targetPage, pageSize: PAGE_SIZE, ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}), ...(keyword.trim() ? { keyword: keyword.trim() } : {}) }), [categoryFilter, keyword, listMode, novelId, page])
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
    if (!item) { setSelectedId(null); setSelectedItem(null); form.resetFields(); return }
    setSelectedId(item.id); setSelectedItem(item); form.setFieldsValue(toFormValues(item)); await hydrateOptions(item)
  }, [form, hydrateOptions])

  const loadPage = useCallback(async (preferredId?: number | null, targetPage = page) => {
    setLoading(true)
    try {
      const query = buildQuery(targetPage)
      const [list, summary, nextFilters] = await Promise.all([window.electron.item.query(query), window.electron.item.getStats({ novelId }), window.electron.item.getFilterOptions(novelId)])
      setPageData(list); setStats(summary); setFilterOptions(nextFilters)
      const nextId = preferredId ?? (list.items.some((item) => item.id === selectedId) ? selectedId : list.items[0]?.id ?? null)
      if (nextId) { setCreating(false); await loadItemDetail(nextId) } else { setSelectedId(null); setSelectedItem(null); setCreating(false); form.resetFields(); await hydrateOptions(null) }
    } finally { setLoading(false) }
  }, [buildQuery, form, hydrateOptions, loadItemDetail, novelId, page, selectedId])

  useEffect(() => { void loadPage(selectedId, page) }, [loadPage, page])
  useEffect(() => { setPage(1) }, [categoryFilter, keyword, listMode])
  useEffect(() => { generateForm.setFieldsValue({ count: profile.defaultBatch, batchSize: 4, templateOnly: false, refreshTemplates: true, focus: '' }) }, [generateForm, profile.defaultBatch])

  const handleNew = (kind: 'template' | 'instance') => { setCreating(true); setListMode(kind); setSelectedId(null); setSelectedItem(null); form.setFieldsValue({ itemKind: kind, parentItemId: undefined, itemName: '', category: '', subType: '', rarity: '', ownerCharacterId: undefined, locationMapId: undefined, status: 'available', summary: '', acquisitionMethod: '', usageMethod: '', cost: '', risk: '', plotFunction: '', appearance: '', factionHint: '', linkedCharacterIds: [], linkedTimelineEventIds: [], tags: [] }); void hydrateOptions(null) }
  const handleSave = async () => { const values = await form.validateFields(); setSaving(true); try { if (selectedItem?.id) { await window.electron.item.update(selectedItem.id, serialize(values)); await loadPage(selectedItem.id, page) } else { const nextId = await window.electron.item.create(novelId, serialize(values)); await loadPage(nextId, page) } setCreating(false); message.success('物品已保存。') } catch (error) { console.error(error); message.error('保存失败，请稍后再试。') } finally { setSaving(false) } }
  const handleDelete = async () => { if (!selectedItem?.id) return; Modal.confirm({ title: `删除「${selectedItem.itemName}」？`, content: '删除后不会自动清理人物、地点和时间轴中的关联描述，请确认它不是正在使用的关键物品。', okButtonProps: { danger: true }, onOk: async () => { await window.electron.item.delete(selectedItem.id); await loadPage(null, page); message.success('物品已删除。') } }) }
  const handleGenerate = async () => { const values = generateForm.getFieldsValue(); setGenerating(true); try { await window.electron.item.generate(novelId, values); setGenerateOpen(false); await loadPage(null, 1); message.success(values.templateOnly ? '题材模板已生成。' : '模板和实例首批已补齐，可继续生成下一批。') } catch (error) { console.error(error); message.error('生成失败，请稍后再试。') } finally { setGenerating(false) } }
  const handleClear = async () => { Modal.confirm({ title: '清空物品系统？', content: '会删除当前小说下全部物品模板与实例，此操作不可撤销。', okType: 'danger', okText: '确认清空', onOk: async () => { await window.electron.item.clear(novelId); form.resetFields(); setSelectedId(null); setSelectedItem(null); setCreating(false); await loadPage(null, 1); message.success('物品系统已清空') } }) }

  return (
    <WorkspacePage eyebrow="物品系统" title="物品与装备系统" description="左侧只加载当前页，右侧关联字段全部改为远程搜索，长篇下不再一次性拉全量物品、人物、地点和事件。" actions={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void loadPage(selectedId, page)}>刷新</Button><Button icon={<AppstoreAddOutlined />} onClick={() => handleNew('template')}>新建模板</Button><Button icon={<InboxOutlined />} onClick={() => handleNew('instance')}>新建实例</Button><Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setGenerateOpen(true)}>AI 分批生成</Button><Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空物品</Button></Space>} contextSummary={<WorkspaceContextSummary items={[{ label: '题材', value: currentNovel?.genreName || '未设置' }, { label: '当前列表', value: `${currentModeLabel}列表` }, { label: '筛选结果', value: `${pageData.total} 条` }, { label: '当前焦点', value: selectedItem ? `${selectedItem.itemName} · ${selectedItem.itemKind === 'template' ? '模板' : '实例'}` : '先选一条记录，或分批补出首版模板' }]} />} metrics={<><WorkspaceMetric label="模板总量" value={stats.templateCount} tone="warm" hint="控制题材里的常见物品结构" /><WorkspaceMetric label="实例总量" value={stats.instanceCount} hint="真正落到人物、地点和事件里的物品" /><WorkspaceMetric label="物品分类" value={stats.categoryCount} tone="cool" hint="按后端聚合统计，不依赖前端全量遍历" /><WorkspaceMetric label="事件挂点" value={stats.linkedEventCount} hint="已挂到时间轴事件上的物品引用" /></>}>
      <WorkspacePanel title="物品状态板" description={listMode === 'instance' ? '状态板只渲染当前页实例，避免整表渲染。' : '切到实例列表后，这里会按当前页实例显示状态板。'}>{listMode === 'instance' ? <ItemStatusBoard items={pageData.items} selectedId={selectedId} onSelect={(itemId) => void loadItemDetail(itemId)} /> : <div className="novel-empty">当前处于模板列表，切到实例列表后查看状态板。</div>}</WorkspacePanel>
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel title="模板与实例" description="列表改成查询式分页，分类和关键字都走后端过滤。" extra={<div className="novel-filter-bar"><div className="novel-filter-bar__row"><Input.Search allowClear placeholder="搜索名称、分类、作用或阵营" value={keyword} onChange={(event) => setKeyword(event.target.value)} onSearch={setKeyword} /><Select value={listMode} options={[{ value: 'template', label: '模板列表' }, { value: 'instance', label: '实例列表' }]} onChange={(value) => setListMode(value)} /></div><div className="novel-filter-bar__row"><Select value={categoryFilter} options={[{ value: 'all', label: '全部分类' }, ...categoryOptions.map((item) => ({ value: item, label: item }))]} onChange={setCategoryFilter} /></div><div className="novel-filter-bar__summary">当前显示 {pageData.total} 条{currentModeLabel}记录。</div></div>}>
          {loading ? <div className="novel-empty"><Spin /></div> : pageData.total === 0 ? <div className="novel-empty">当前筛选下还没有{currentModeLabel}记录，可以放宽筛选，或直接 AI 分批生成首版。</div> : <div style={{ display: 'grid', gap: 12 }}><VirtualList data={pageData.items} height={520} itemHeight={118} itemKey="id">{(item: StoryItem) => <button key={item.id} type="button" className={`novel-list-card ${selectedId === item.id ? 'novel-list-card--active' : ''}`} onClick={() => void loadItemDetail(item.id)} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="novel-list-card__title">{item.itemName}</div><div className="novel-list-card__meta">{item.category ? <Tag>{item.category}</Tag> : null}{item.subType ? <Tag>{item.subType}</Tag> : null}{item.rarity ? <Tag color="gold">{item.rarity}</Tag> : null}{item.itemKind === 'template' ? <Tag color="blue">模板</Tag> : <Tag color="processing">实例</Tag>}</div><div className="novel-list-card__desc">{item.summary || item.plotFunction || item.appearance || '这条记录还没有补出写作用途。'}</div></button>}</VirtualList><Pagination current={pageData.page} pageSize={pageData.pageSize} total={pageData.total} size="small" showSizeChanger={false} onChange={setPage} /></div>}
        </WorkspacePanel>
        <WorkspacePanel title={selectedItem ? `编辑：${selectedItem.itemName}` : creating ? '新建物品' : '物品详情'} description="先交代清楚它是什么、怎么流通、谁会用、会带来什么后果，再补人物和事件挂点。" extra={<Space>{selectedItem ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button></Space>}>
          {!selectedItem && !creating && !loading ? <div className="novel-empty">左侧选择一条模板或实例后，右侧就能直接编辑。也可以新建，从物品身份开始补。</div> : <Form form={form} layout="vertical"><div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">物品身份</div><div className="novel-form-section__desc">先说明它属于哪类物品、叫什么、现在处于什么状态。</div></div><div className="novel-grid novel-grid--3"><Form.Item name="itemKind" label="记录类型" rules={[{ required: true, message: '请选择记录类型' }]}><Select options={[{ value: 'template', label: '模板' }, { value: 'instance', label: '实例' }]} /></Form.Item><Form.Item name="category" label="主分类"><Input placeholder="例如：武器、药品、功法、证据、载具" /></Form.Item><Form.Item name="subType" label="细分类"><Input placeholder="例如：手枪、镇定剂、飞船、门派令牌" /></Form.Item></div><div className="novel-grid novel-grid--3"><Form.Item name="itemName" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="写得像小说里的真实物品，不要故作玄虚。" /></Form.Item><Form.Item name="rarity" label="稀缺度"><Select allowClear options={rarityOptions.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="status" label="当前状态"><Select options={[{ value: 'available', label: '可用' }, { value: 'consumed', label: '已消耗' }, { value: 'hidden', label: '被藏匿' }, { value: 'destroyed', label: '已损毁' }]} /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="summary" label="一句话说明"><Input.TextArea rows={3} placeholder="只说清它是什么，不要写成宣传文案。" /></Form.Item><Form.Item name="appearance" label="可识别外观"><Input.TextArea rows={3} placeholder="写读者一眼能记住的细节，不用堆形容词。" /></Form.Item></div></div><div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">流通与使用</div><div className="novel-form-section__desc">写清它通常怎么得到、谁会用、和哪类阵营有关。</div></div><div className="novel-grid novel-grid--2"><Form.Item name="acquisitionMethod" label="获取方式"><Input.TextArea rows={3} placeholder="例如：交易、继承、抢夺、任务奖励、秘境所得。" /></Form.Item><Form.Item name="usageMethod" label="使用方式"><Input.TextArea rows={3} placeholder="写具体怎么用，适合什么场景，谁能驾驭。" /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="factionHint" label="关联势力 / 流通来源"><Input placeholder="例如：第七基地、太玄宗、远航集团。" /></Form.Item><Form.Item name="tags" label="标签"><Select mode="tags" open={false} placeholder="例如：救命、交易、禁用、身份象征" /></Form.Item></div></div><div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">代价与剧情作用</div><div className="novel-form-section__desc">让物品有成本、有风险、有真正推进剧情的功能，而不是纯摆设。</div></div><div className="novel-grid novel-grid--2"><Form.Item name="cost" label="代价"><Input.TextArea rows={3} placeholder="例如：消耗资源、暴露身份、需要高阶权限、会伤身。" /></Form.Item><Form.Item name="risk" label="风险"><Input.TextArea rows={3} placeholder="例如：会引来追查、引发副作用、让人失控、触发阵营冲突。" /></Form.Item></div><Form.Item name="plotFunction" label="剧情作用"><Input.TextArea rows={3} placeholder="写它推动哪条线、为什么值得反复记住。" /></Form.Item></div>{itemKind === 'instance' ? <div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">剧情挂点</div><div className="novel-form-section__desc">这些字段全部走远程搜索，不再一次性加载全量人物、地点和事件。</div></div><div className="novel-grid novel-grid--3"><Form.Item name="parentItemId" label="来源模板"><Select allowClear showSearch filterOption={false} options={templateOptions.map((item) => ({ value: item.id, label: item.itemName }))} onFocus={() => void searchTemplates('')} onSearch={(value) => void searchTemplates(value)} /></Form.Item><Form.Item name="ownerCharacterId" label="当前持有者"><Select allowClear showSearch filterOption={false} options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))} onFocus={() => void searchCharacters('')} onSearch={(value) => void searchCharacters(value)} /></Form.Item><Form.Item name="locationMapId" label="常见地点"><Select allowClear showSearch filterOption={false} options={locationOptions.map((item) => ({ value: item.id, label: item.name }))} onFocus={() => void searchLocations('')} onSearch={(value) => void searchLocations(value)} /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="linkedCharacterIds" label="相关人物"><Select mode="multiple" allowClear showSearch filterOption={false} options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))} onFocus={() => void searchCharacters('')} onSearch={(value) => void searchCharacters(value)} /></Form.Item><Form.Item name="linkedTimelineEventIds" label="关联事件"><Select mode="multiple" allowClear showSearch filterOption={false} options={eventOptions.map((item) => ({ value: item.id, label: `${item.timeLabel} · ${item.eventTitle}` }))} onFocus={() => void searchEvents('')} onSearch={(value) => void searchEvents(value)} /></Form.Item></div></div> : null}</Form>}
        </WorkspacePanel>
      </div>
      <WorkspacePanel title="当前题材的物品逻辑" description={profile.overview}><div className="novel-note-list" style={{ marginBottom: 16 }}>{profile.beginnerTips.map((tip) => <div key={tip} className="novel-note-list__item">{tip}</div>)}</div><div className="novel-stage-grid">{profile.templates.map((template) => <div key={template.key} className="novel-stage-card"><div className="novel-stage-card__header"><div><div className="novel-kicker">{template.category}</div><div className="novel-stage-card__title">{template.name}</div></div><div className="novel-stage-card__meta"><Tag color="blue">{template.category}</Tag></div></div><div className="novel-stage-card__desc">{template.summary}</div><div className="novel-stage-card__support"><div>常见持有者：{template.holders}</div><div>流通方式：{template.circulation}</div><div>剧情作用：{template.storyValue}</div><div>可参考：{template.examples.join('、')}</div></div></div>)}</div></WorkspacePanel>
      <Modal title="AI 分批生成物品" open={generateOpen} onCancel={() => setGenerateOpen(false)} onOk={() => void handleGenerate()} confirmLoading={generating} okText="生成下一批"><Form form={generateForm} layout="vertical"><div className="novel-note-list" style={{ marginBottom: 16 }}><div className="novel-note-list__item">建议先刷新模板，再补实例。</div><div className="novel-note-list__item">长篇建议把每批数量控制在 3 到 5 条。</div><div className="novel-note-list__item">额外聚焦用来指定本轮优先补哪条线。</div></div><Form.Item name="templateOnly" label="生成模式"><Select options={[{ value: false, label: '模板 + 实例一起生成' }, { value: true, label: '只生成模板' }]} /></Form.Item><Form.Item name="refreshTemplates" label="模板同步方式"><Select options={[{ value: true, label: '按当前题材刷新模板' }, { value: false, label: '保留现有模板，只补缺失项' }]} /></Form.Item><Form.Item name="count" label="本轮目标实例数"><Select options={[8, 10, 12, 14, 18].map((count) => ({ value: count, label: `${count} 条` }))} /></Form.Item><Form.Item name="batchSize" label="每批生成数量"><Select options={[2, 3, 4, 5, 6].map((count) => ({ value: count, label: `${count} 条 / 批` }))} /></Form.Item><Form.Item name="focus" label="额外聚焦"><Input.TextArea rows={3} placeholder="例如：主角团的求生装备、宗门功法或恋爱线证物。" /></Form.Item></Form></Modal>
    </WorkspacePage>
  )
}

function ItemStatusBoard({ items, selectedId, onSelect }: { items: StoryItem[]; selectedId: number | null; onSelect: (itemId: number) => void }) {
  if (items.length === 0) return <div className="novel-empty">当前页还没有物品实例。</div>
  return <div className="novel-board-lanes">{ITEM_BOARD_COLUMNS.map((status) => { const laneItems = items.filter((item) => item.status === status); return <section key={status} className="novel-board-lane"><div className="novel-board-lane__head"><strong>{status}</strong><span>{laneItems.length} 条</span></div><div className="novel-board-lane__body">{laneItems.length > 0 ? laneItems.map((item) => <button key={item.id} type="button" className={`novel-board-card ${selectedId === item.id ? 'novel-board-card--active' : ''}`} onClick={() => onSelect(item.id)}><div className="novel-board-card__kicker">{item.category || '未分类'}</div><strong>{item.itemName}</strong><div className="novel-board-card__meta"><span>{item.subType || '细分类未定'}</span><span>{item.rarity || '常规'}</span></div><div className="novel-board-card__desc">{item.plotFunction || item.summary || item.risk || '这件物品还没有补出剧情功能。'}</div></button>) : <div className="novel-board-lane__empty">当前列暂无物品。</div>}</div></section> })}</div>
}
