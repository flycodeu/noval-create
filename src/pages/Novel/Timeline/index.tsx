import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  message,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { Character, Chapter, StoryArc, StoryItem, TimelineEvent, WorldMapItem } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
}

interface TimelineFormValues {
  eventTitle: string
  eventSummary?: string
  timeMode: string
  timeLabel: string
  timeSortValue: number
  timePrecision?: string
  isMajorEvent: boolean
  eventType?: string
  arcId?: number
  chapterStartId?: number
  chapterEndId?: number
  locationMapId?: number
  presentCharacterIds: number[]
  affectedCharacterIds: number[]
  linkedItemIds: number[]
  protagonistPresent: boolean
  protagonistAction?: string
  eventCause?: string
  eventProcess?: string
  eventResult?: string
  directConsequences: string[]
  openThreads: string[]
  notes?: string
  status: 'planned' | 'seeded' | 'written' | 'resolved'
}

interface TimelineGenerateFormValues {
  count: number
  batchSize: number
  focus?: string
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .map((item) => (typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : Number.NaN))
        .filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function toFormValues(
  event: TimelineEvent,
  defaultMode: string,
  defaultPrecision: string,
  defaultEventType: string,
): TimelineFormValues {
  return {
    eventTitle: event.eventTitle,
    eventSummary: event.eventSummary || '',
    timeMode: event.timeMode || defaultMode,
    timeLabel: event.timeLabel,
    timeSortValue: event.timeSortValue ?? 0,
    timePrecision: event.timePrecision || defaultPrecision,
    isMajorEvent: Boolean(event.isMajorEvent),
    eventType: event.eventType || defaultEventType,
    arcId: event.arcId,
    chapterStartId: event.chapterStartId,
    chapterEndId: event.chapterEndId,
    locationMapId: event.locationMapId,
    presentCharacterIds: parseNumberArray(event.presentCharacterIdsJson),
    affectedCharacterIds: parseNumberArray(event.affectedCharacterIdsJson),
    linkedItemIds: parseNumberArray(event.linkedItemIdsJson),
    protagonistPresent: Boolean(event.protagonistPresent),
    protagonistAction: event.protagonistAction || '',
    eventCause: event.eventCause || '',
    eventProcess: event.eventProcess || '',
    eventResult: event.eventResult || '',
    directConsequences: parseStringArray(event.directConsequencesJson),
    openThreads: parseStringArray(event.openThreadsJson),
    notes: event.notes || '',
    status: event.status,
  }
}

function serialize(values: TimelineFormValues): Partial<TimelineEvent> {
  return {
    eventTitle: values.eventTitle.trim(),
    eventSummary: values.eventSummary?.trim() || '',
    timeMode: values.timeMode,
    timeLabel: values.timeLabel.trim(),
    timeSortValue: Number(values.timeSortValue || 0),
    timePrecision: values.timePrecision?.trim() || '',
    isMajorEvent: values.isMajorEvent ? 1 : 0,
    eventType: values.eventType?.trim() || '',
    arcId: values.arcId,
    chapterStartId: values.chapterStartId,
    chapterEndId: values.chapterEndId,
    locationMapId: values.locationMapId,
    presentCharacterIdsJson: JSON.stringify(values.presentCharacterIds || []),
    affectedCharacterIdsJson: JSON.stringify(values.affectedCharacterIds || []),
    linkedItemIdsJson: JSON.stringify(values.linkedItemIds || []),
    protagonistPresent: values.protagonistPresent ? 1 : 0,
    protagonistAction: values.protagonistAction?.trim() || '',
    eventCause: values.eventCause?.trim() || '',
    eventProcess: values.eventProcess?.trim() || '',
    eventResult: values.eventResult?.trim() || '',
    directConsequencesJson: JSON.stringify((values.directConsequences || []).map((item) => item.trim()).filter(Boolean)),
    openThreadsJson: JSON.stringify((values.openThreads || []).map((item) => item.trim()).filter(Boolean)),
    notes: values.notes?.trim() || '',
    status: values.status,
  }
}

const STATUS_META: Record<TimelineEvent['status'], { label: string; color: string }> = {
  planned: { label: '计划中', color: 'default' },
  seeded: { label: '已埋点', color: 'orange' },
  written: { label: '已写入正文', color: 'blue' },
  resolved: { label: '已回收', color: 'green' },
}

const TIME_MODE_OPTIONS = [
  { value: 'gregorian', label: '公历时间' },
  { value: 'regnal', label: '年号 / 王朝纪年' },
  { value: 'relative-disaster', label: '灾变后相对时间' },
  { value: 'custom-era', label: '虚构纪元' },
  { value: 'future-date', label: '未来时间' },
]

const TIME_MODE_EXAMPLES: Record<string, string> = {
  gregorian: '示例：2026年3月17日 21:00',
  regnal: '示例：昭宁三年秋 / 王历十二年冬',
  'relative-disaster': '示例：灾变后第7天 / 断电后第3周',
  'custom-era': '示例：玄曜纪三百二十七年 / 第六次开荒季',
  'future-date': '示例：公元2089年 · 近地轨道站时 04:20',
}

function buildDefaultValues(
  events: TimelineEvent[],
  defaultMode: string,
  defaultPrecision: string,
  defaultEventType: string,
): TimelineFormValues {
  return {
    eventTitle: '',
    eventSummary: '',
    timeMode: defaultMode,
    timeLabel: '',
    timeSortValue: events.length + 1,
    timePrecision: defaultPrecision,
    isMajorEvent: true,
    eventType: defaultEventType,
    arcId: undefined,
    chapterStartId: undefined,
    chapterEndId: undefined,
    locationMapId: undefined,
    presentCharacterIds: [],
    affectedCharacterIds: [],
    linkedItemIds: [],
    protagonistPresent: true,
    protagonistAction: '',
    eventCause: '',
    eventProcess: '',
    eventResult: '',
    directConsequences: [],
    openThreads: [],
    notes: '',
    status: 'planned',
  }
}

export default function TimelinePage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<TimelineFormValues>()
  const [generateForm] = Form.useForm<TimelineGenerateFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [locations, setLocations] = useState<WorldMapItem[]>([])
  const [items, setItems] = useState<StoryItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | TimelineEvent['status']>('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const defaultMode = worldRules.timelineConfig.calendarType
  const defaultPrecision = worldRules.timelineConfig.precisionOptions[0] || '阶段'
  const defaultEventTypes = worldRules.timelineConfig.recommendedEventTypes

  const loadData = useCallback(async (preferredId?: number | null) => {
    setLoading(true)
    try {
      const [timelineList, arcList, chapterList, characterList, mapTree, itemList] = await Promise.all([
        window.electron.timeline.list(novelId),
        window.electron.outline.getArcs(novelId),
        window.electron.chapter.list(novelId),
        window.electron.character.list(novelId),
        window.electron.map.getTree(novelId),
        window.electron.item.list(novelId),
      ])

      const flatLocations = mapTree.flatMap(function flatten(node: WorldMapItem): WorldMapItem[] {
        return [node, ...(node.children || []).flatMap(flatten)]
      })

      setEvents(timelineList)
      setArcs(arcList)
      setChapters(chapterList)
      setCharacters(characterList)
      setLocations(flatLocations)
      setItems(itemList.filter((item) => item.itemKind === 'instance'))

      const nextSelectedId = preferredId ?? timelineList[0]?.id ?? null
      const selected = timelineList.find((item) => item.id === nextSelectedId)
      if (selected) {
        setSelectedId(selected.id)
        setCreating(false)
        form.setFieldsValue(toFormValues(selected, defaultMode, defaultPrecision, defaultEventTypes[0] || ''))
      } else {
        setSelectedId(null)
        setCreating(false)
        form.setFieldsValue(buildDefaultValues(timelineList, defaultMode, defaultPrecision, defaultEventTypes[0] || ''))
      }
    } finally {
      setLoading(false)
    }
  }, [defaultEventTypes, defaultMode, defaultPrecision, form, novelId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    generateForm.setFieldsValue({
      count: 12,
      batchSize: 4,
      focus: '',
    })
  }, [generateForm])

  const eventTypeOptions = Array.from(new Set(defaultEventTypes.concat(events.map((item) => item.eventType || '').filter(Boolean))))
  const filteredEvents = events.filter((event) => {
    if (statusFilter !== 'all' && event.status !== statusFilter) return false
    if (typeFilter !== 'all' && event.eventType !== typeFilter) return false
    return true
  })
  const selectedEvent = events.find((item) => item.id === selectedId) || null
  const selectedTimeMode = Form.useWatch('timeMode', form) || defaultMode
  const selectedTimeModeLabel = TIME_MODE_OPTIONS.find((item) => item.value === selectedTimeMode)?.label || selectedTimeMode
  const openThreadCount = events.reduce((count, item) => count + parseStringArray(item.openThreadsJson).length, 0)

  const handleSelect = (event: TimelineEvent) => {
    setSelectedId(event.id)
    setCreating(false)
    form.setFieldsValue(toFormValues(event, defaultMode, defaultPrecision, defaultEventTypes[0] || ''))
  }

  const handleNew = () => {
    setCreating(true)
    setSelectedId(null)
    form.setFieldsValue(buildDefaultValues(events, defaultMode, defaultPrecision, defaultEventTypes[0] || ''))
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (selectedEvent?.id) {
        await window.electron.timeline.update(selectedEvent.id, serialize(values))
        await loadData(selectedEvent.id)
      } else {
        const nextId = await window.electron.timeline.create(novelId, serialize(values))
        await loadData(nextId)
      }
      setCreating(false)
      message.success('事件已保存。')
    } catch (error) {
      console.error(error)
      message.error('保存失败，请稍后再试。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedEvent?.id) return
    Modal.confirm({
      title: `删除「${selectedEvent.eventTitle}」？`,
      content: '删除后不会自动清理章节、大纲或物品中的关联文字，请确认这不是仍在使用的事件。',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.timeline.delete(selectedEvent.id)
        await loadData()
        message.success('事件已删除。')
      },
    })
  }

  const handleGenerate = async () => {
    const values = generateForm.getFieldsValue()
    setGenerating(true)
    try {
      await window.electron.timeline.generate(novelId, {
        count: values.count || 12,
        batchSize: values.batchSize || 4,
        focus: values.focus || '把主角、关键地点、关键物品和主线冲突串成完整时间链，同时补上后果与未回收线索。',
      })
      setGenerateOpen(false)
      await loadData()
      message.success('时间轴首批事件已补齐，可继续追加下一批。')
    } catch (error) {
      console.error(error)
      message.error('生成失败，请稍后再试。')
    } finally {
      setGenerating(false)
    }
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空事件时间轴？',
      content: '会删除当前小说下全部时间轴事件，但不会删除章节正文。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.timeline.clear(novelId)
        form.resetFields()
        setSelectedId(null)
        setCreating(false)
        await loadData(null)
        message.success('事件时间轴已清空')
      },
    })
  }

  return (
    <WorkspacePage
      eyebrow="时间轴"
      title="事件时间轴"
      description="把时间点、人物、地点和关键物品记成一条线。后面写章节时，就不会再忘记谁在场、谁拿着什么、结果有没有回收。"
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => loadData()}>
            刷新
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleNew}>
            新建事件
          </Button>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={() => setGenerateOpen(true)}>
            AI 分批生成
          </Button>
          <Button danger icon={<DeleteOutlined />} loading={generating} onClick={() => void handleClear()}>
            清空时间轴
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '时间制', value: `${selectedTimeModeLabel} · ${worldRules.timelineConfig.eraName || '当前题材时间制'}` },
            { label: '时间零点', value: worldRules.timelineConfig.relativeZeroLabel || worldRules.timelineConfig.baseYearLabel || '未设定' },
            {
              label: '当前焦点',
              value: selectedEvent
                ? `${selectedEvent.timeLabel} · ${selectedEvent.eventTitle}`
                : '先选一个事件，或分批补出首版时间链',
            },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="事件数量" value={events.length} tone="warm" hint="包含计划、埋点、已写和已回收事件" />
          <WorkspaceMetric label="关键事件" value={events.filter((item) => item.isMajorEvent).length} tone="cool" hint="建议后续优先和大纲对齐" />
          <WorkspaceMetric label="已回收" value={events.filter((item) => item.status === 'resolved').length} hint="已经在正文或后续事件中完成回收" />
          <WorkspaceMetric label="待回收线" value={openThreadCount} hint="仍挂在时间轴上的问题与伏笔" />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title="事件列表"
          description="先筛出状态和类型，再在右侧补时间、因果和关联挂点。"
          extra={(
            <div className="novel-filter-bar">
              <div className="novel-filter-bar__row">
                <Select
                  value={statusFilter}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'planned', label: '计划中' },
                    { value: 'seeded', label: '已埋点' },
                    { value: 'written', label: '已写入正文' },
                    { value: 'resolved', label: '已回收' },
                  ]}
                  onChange={setStatusFilter}
                />
                <Select
                  value={typeFilter}
                  options={[
                    { value: 'all', label: '全部类型' },
                    ...eventTypeOptions.map((item) => ({ value: item, label: item })),
                  ]}
                  onChange={setTypeFilter}
                />
              </div>
              <div className="novel-filter-bar__summary">
                当前筛出 {filteredEvents.length} 个事件。建议优先检查关键事件的顺序、结果和待回收问题是否完整。
              </div>
            </div>
          )}
        >
          {loading ? (
            <div className="novel-empty"><Spin /></div>
          ) : filteredEvents.length === 0 ? (
            <div className="novel-empty">
              当前筛选下还没有事件，可以放宽筛选，或直接 AI 分批生成首版时间轴。
            </div>
          ) : (
            <div className="novel-grid">
              {filteredEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`novel-list-card ${selectedId === event.id ? 'novel-list-card--active' : ''}`}
                  onClick={() => handleSelect(event)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="novel-kicker">{event.timeLabel}</div>
                  <div className="novel-list-card__title">{event.eventTitle}</div>
                  <div className="novel-list-card__meta">
                    <Tag color={STATUS_META[event.status].color}>{STATUS_META[event.status].label}</Tag>
                    {event.eventType ? <Tag>{event.eventType}</Tag> : null}
                    {event.isMajorEvent ? <Tag color="gold">关键节点</Tag> : null}
                  </div>
                  <div className="novel-list-card__desc">
                    {event.eventSummary || event.eventResult || '这个事件还没有补出摘要。'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel
          title={selectedEvent ? `编辑：${selectedEvent.eventTitle}` : creating ? '新建事件' : '事件详情'}
          description="按“时间定义 → 剧情挂点 → 人物与物品 → 因果链 → 回收项”顺序补齐，后续最好回查。"
          extra={(
            <Space>
              {selectedEvent ? (
                <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                  删除
                </Button>
              ) : null}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                保存
              </Button>
            </Space>
          )}
        >
          {!selectedEvent && !creating && !loading ? (
            <div className="novel-empty">
              左侧选择一个事件后，这里就能直接补完整的时间链信息。也可以从零新建。
            </div>
          ) : (
            <Form form={form} layout="vertical">
              <div className="novel-form-section">
                <div className="novel-form-section__header">
                  <div className="novel-form-section__title">时间定义</div>
                  <div className="novel-form-section__desc">先保证时间标签和排序值可读、可排、可回查。</div>
                </div>
                <div className="novel-note-list" style={{ marginBottom: 14 }}>
                  <div className="novel-note-list__item">
                    {selectedTimeModeLabel}写法建议：{TIME_MODE_EXAMPLES[selectedTimeMode] || '先统一口径，再写具体事件。'}
                  </div>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="eventTitle" label="事件标题" rules={[{ required: true, message: '请输入事件标题' }]}>
                    <Input placeholder="例如：南门补给线断裂" />
                  </Form.Item>
                  <Form.Item name="timeLabel" label="时间标签" rules={[{ required: true, message: '请输入时间标签' }]}>
                    <Input placeholder={TIME_MODE_EXAMPLES[selectedTimeMode] || '例如：灾变后第七天'} />
                  </Form.Item>
                  <Form.Item name="timeSortValue" label="排序值" rules={[{ required: true, message: '请输入排序值' }]}>
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="timeMode" label="时间模式">
                    <Select options={TIME_MODE_OPTIONS} />
                  </Form.Item>
                  <Form.Item name="timePrecision" label="时间精度">
                    <Select
                      allowClear
                      options={worldRules.timelineConfig.precisionOptions.map((item) => ({ value: item, label: item }))}
                    />
                  </Form.Item>
                  <Form.Item name="status" label="当前状态">
                    <Select
                      options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
                    />
                  </Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="eventType" label="事件类型">
                    <Select
                      allowClear
                      showSearch
                      options={eventTypeOptions.map((item) => ({ value: item, label: item }))}
                    />
                  </Form.Item>
                  <div className="novel-grid novel-grid--2" style={{ alignItems: 'start' }}>
                    <Form.Item name="isMajorEvent" label="关键节点" valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Switch />
                    </Form.Item>
                    <Form.Item name="protagonistPresent" label="主角在场" valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Switch />
                    </Form.Item>
                  </div>
                </div>
                <Form.Item name="eventSummary" label="事件摘要">
                  <Input.TextArea rows={3} placeholder="用 1-2 句话说明这个事件为什么重要，不要写空话。" />
                </Form.Item>
              </div>

              <div className="novel-form-section">
                <div className="novel-form-section__header">
                  <div className="novel-form-section__title">剧情挂点</div>
                  <div className="novel-form-section__desc">把时间轴和大纲、章节、地点接起来，后续写正文时就能直接回查。</div>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="arcId" label="关联故事弧">
                    <Select allowClear options={arcs.map((arc) => ({ value: arc.id, label: arc.arcName }))} />
                  </Form.Item>
                  <Form.Item name="locationMapId" label="主要地点">
                    <Select
                      allowClear
                      showSearch
                      options={locations.map((location) => ({ value: location.id, label: location.name }))}
                    />
                  </Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="chapterStartId" label="起始章节">
                    <Select
                      allowClear
                      options={chapters.map((chapter) => ({ value: chapter.id, label: `第 ${chapter.chapterNum} 章` }))}
                    />
                  </Form.Item>
                  <Form.Item name="chapterEndId" label="结束章节">
                    <Select
                      allowClear
                      options={chapters.map((chapter) => ({ value: chapter.id, label: `第 ${chapter.chapterNum} 章` }))}
                    />
                  </Form.Item>
                </div>
              </div>

              <div className="novel-form-section">
                <div className="novel-form-section__header">
                  <div className="novel-form-section__title">人物与物品</div>
                  <div className="novel-form-section__desc">写清谁在场、谁受影响、主角做了什么，以及哪些物品在这场事件里被用到。</div>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="presentCharacterIds" label="在场人物">
                    <Select
                      mode="multiple"
                      allowClear
                      options={characters.map((character) => ({ value: character.id, label: character.fullName }))}
                    />
                  </Form.Item>
                  <Form.Item name="affectedCharacterIds" label="受影响人物">
                    <Select
                      mode="multiple"
                      allowClear
                      options={characters.map((character) => ({ value: character.id, label: character.fullName }))}
                    />
                  </Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="linkedItemIds" label="关联物品">
                    <Select
                      mode="multiple"
                      allowClear
                      options={items.map((item) => ({ value: item.id, label: item.itemName }))}
                    />
                  </Form.Item>
                  <Form.Item name="protagonistAction" label="主角做了什么">
                    <Input.TextArea rows={3} placeholder="写动作或选择，不要写抽象评价。" />
                  </Form.Item>
                </div>
              </div>

              <div className="novel-form-section">
                <div className="novel-form-section__header">
                  <div className="novel-form-section__title">因果链</div>
                  <div className="novel-form-section__desc">尽量把起因、过程、结果写成能直接接到后续章节的句子。</div>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="eventCause" label="事件起因">
                    <Input.TextArea rows={4} placeholder="这件事为什么会发生，前面埋了什么原因。" />
                  </Form.Item>
                  <Form.Item name="eventProcess" label="事件过程">
                    <Input.TextArea rows={4} placeholder="中间发生了哪些关键动作、冲突和转折。" />
                  </Form.Item>
                  <Form.Item name="eventResult" label="事件结果">
                    <Input.TextArea rows={4} placeholder="最后是谁得利、谁受伤、局面被改成了什么样。" />
                  </Form.Item>
                </div>
                <Form.Item name="directConsequences" label="直接后果">
                  <Select
                    mode="tags"
                    open={false}
                    placeholder="例如：补给线暴露、角色受伤、某势力开始追查"
                  />
                </Form.Item>
              </div>

              <div className="novel-form-section">
                <div className="novel-form-section__header">
                  <div className="novel-form-section__title">回收项与备注</div>
                  <div className="novel-form-section__desc">把还没解决的问题挂在这里，后续写章时就不容易忘。</div>
                </div>
                <Form.Item name="openThreads" label="待回收问题">
                  <Select
                    mode="tags"
                    open={false}
                    placeholder="例如：药剂来源未明、反派是否已经察觉、证物去向尚未回收"
                  />
                </Form.Item>
                <Form.Item name="notes" label="补充备注">
                  <Input.TextArea
                    rows={4}
                    placeholder="写给后续自己的提醒，比如谁已经受伤、哪件物品已经消耗、哪条线不能提前揭开。"
                  />
                </Form.Item>
              </div>
            </Form>
          )}
        </WorkspacePanel>
      </div>

      <Modal
        title="AI 分批生成时间轴"
        open={generateOpen}
        onCancel={() => setGenerateOpen(false)}
        onOk={handleGenerate}
        confirmLoading={generating}
        okText="生成下一批"
      >
        <Form form={generateForm} layout="vertical">
          <div className="novel-note-list" style={{ marginBottom: 16 }}>
            <div className="novel-note-list__item">长篇建议先补关键事件骨架，再逐轮追加人物后果、伏笔和回收节点。</div>
            <div className="novel-note-list__item">每批数量越小，越容易避免时间顺序断裂或重复生成。</div>
            <div className="novel-note-list__item">已有事件会被带入上下文，系统优先补缺口，不整段重写。</div>
          </div>

          <Form.Item name="count" label="本轮目标事件数">
            <Select options={[8, 10, 12, 16, 20].map((count) => ({ value: count, label: count + ' 个' }))} />
          </Form.Item>

          <Form.Item name="batchSize" label="每批生成数量">
            <Select options={[2, 3, 4, 5, 6].map((count) => ({ value: count, label: count + ' 个 / 批' }))} />
          </Form.Item>

          <Form.Item name="focus" label="额外聚焦">
            <Input.TextArea
              rows={3}
              placeholder="例如：主角行动线、政变前后节点、物品回收或感情线转折。"
            />
          </Form.Item>
        </Form>
      </Modal>

    </WorkspacePage>
  )
}

