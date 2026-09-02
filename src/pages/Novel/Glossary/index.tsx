import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedSearch } from '../../../hooks/useDebouncedSearch'
import { Alert, Empty, Form, Input, Modal, Select, Spin, Switch, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined, ScanOutlined } from '@ant-design/icons'
import VirtualList from 'rc-virtual-list'
import { useSearchParams } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { GlossaryEntry, GlossaryUsageReport, GlossaryUsageReportItem } from '../../../types'
import { parseGlossaryAliases, stringifyGlossaryAliases } from '../../../shared/glossary'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { useResponsivePanelHeight } from '../../../shared/use-responsive-panel-height'
import './index.css'

const GLOSSARY_CATEGORY_OPTIONS = [
  { value: 'skill', label: '技能' },
  { value: 'rank', label: '阶位' },
  { value: 'event', label: '事件' },
  { value: 'material', label: '材料' },
  { value: 'species', label: '种族' },
  { value: 'lore', label: '设定' },
  { value: 'concept', label: '概念' },
  { value: 'organization', label: '组织' },
  { value: 'other', label: '其他' },
  { value: 'custom', label: '自定义' },
] as const

interface Props {
  novelId: number
}

interface GlossaryFormValues {
  term: string
  category: GlossaryEntry['category']
  definition: string
  bodyMd: string
  aliases: string[]
  firstAppearChapter?: number
  relatedEntityIds: string
  isCanonical: boolean
}

const EMPTY_VALUES: GlossaryFormValues = {
  term: '',
  category: 'custom',
  definition: '',
  bodyMd: '',
  aliases: [],
  firstAppearChapter: undefined,
  relatedEntityIds: '',
  isCanonical: true,
}

const LIST_ITEM_HEIGHT = 88

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function serializeFormValues(values: Partial<GlossaryFormValues>) {
  return JSON.stringify({
    term: values.term?.trim() || '',
    category: values.category || 'custom',
    definition: values.definition?.trim() || '',
    bodyMd: values.bodyMd?.trim() || '',
    aliases: values.aliases || [],
    firstAppearChapter: values.firstAppearChapter || null,
    relatedEntityIds: values.relatedEntityIds?.trim() || '',
    isCanonical: values.isCanonical !== false,
  })
}

function parseNumberJson(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .map((item) => (typeof item === 'number' ? item : Number(item)))
        .filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function buildFormValues(item?: GlossaryEntry | null): GlossaryFormValues {
  if (!item) return EMPTY_VALUES
  return {
    term: item.term,
    category: item.category,
    definition: item.definition || '',
    bodyMd: item.bodyMd || '',
    aliases: parseGlossaryAliases(item.aliasesJson),
    firstAppearChapter: item.firstAppearChapter,
    relatedEntityIds: parseNumberJson(item.relatedEntityIdsJson || '[]').join(', '),
    isCanonical: item.isCanonical > 0,
  }
}

export default function GlossaryPage({ novelId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { mutationToken, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const listHeight = useResponsivePanelHeight({ minHeight: 336, maxHeight: 640, ratio: 0.58, fallback: 460 })
  const [form] = Form.useForm<GlossaryFormValues>()
  const [items, setItems] = useState<GlossaryEntry[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [stats, setStats] = useState({ total: 0, canonicalCount: 0, deprecatedCount: 0, categoryCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ threadCount: 0, chapterCount: 0 })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [usageReport, setUsageReport] = useState<GlossaryUsageReport | null>(null)
  const [keywordInput, setKeywordInput, keyword] = useDebouncedSearch('')
  const [canonicalFilter, setCanonicalFilter] = useState<'all' | 'active' | 'deprecated'>('all')
  const [creating, setCreating] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [persistedFormSignature, setPersistedFormSignature] = useState(() => serializeFormValues(EMPTY_VALUES))
  const refreshRequestRef = useRef(0)
  const creatingRef = useRef(false)
  const routeFocusRef = useRef<number | null>(null)
  const watchedValues = Form.useWatch([], form) as Partial<GlossaryFormValues> | undefined
  const currentFormValues = useMemo<GlossaryFormValues>(() => ({
    ...EMPTY_VALUES,
    ...(watchedValues || {}),
    aliases: watchedValues?.aliases || EMPTY_VALUES.aliases,
  }), [watchedValues])
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  )
  const hasUnsavedChanges = Boolean(selectedItem || creating) && serializeFormValues(currentFormValues) !== persistedFormSignature
  const routeGlossaryId = useMemo(() => parseRouteId(searchParams.get('glossaryId')), [searchParams])

  const usageByGlossaryId = useMemo(() => {
    const map = new Map<number, GlossaryUsageReportItem>()
    usageReport?.items.forEach((item) => map.set(item.glossaryId, item))
    return map
  }, [usageReport])

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const [page, nextStats, nextWorkflowStats, nextUsageReport] = await Promise.all([
        window.electron.glossary.query({ novelId, keyword, canonical: canonicalFilter, page: 1, pageSize: 200 }),
        window.electron.glossary.getStats({ novelId }),
        loadWorkflowStats(novelId),
        window.electron.glossary.usageReport(novelId).catch(() => null),
      ])
      if (refreshRequestRef.current !== requestId) return
      setItems(page.items)
      setStats(nextStats)
      setUsageReport(nextUsageReport)
      setWorkflowStats({ threadCount: nextWorkflowStats.threadCount, chapterCount: nextWorkflowStats.chapterCount })
      setSelectedId((current) => {
        if (creatingRef.current) return null
        if (current && page.items.some((item) => item.id === current)) return current
        return page.items[0]?.id || null
      })
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) setLoading(false)
    }
  }, [canonicalFilter, keyword, novelId])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    form.setFieldsValue(buildFormValues(selectedItem))
    if (selectedItem) {
      setPersistedFormSignature(serializeFormValues(buildFormValues(selectedItem)))
    }
  }, [form, selectedItem])

  const syncGlossaryRoute = useCallback((id: number | null) => {
    const nextParams = new URLSearchParams(searchParams)
    if (id) nextParams.set('glossaryId', String(id))
    else nextParams.delete('glossaryId')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const loadRouteEntry = useCallback(async (id: number) => {
    const item = await window.electron.glossary.get(id)
    if (!item || item.novelId !== novelId) return
    setItems((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current])
    creatingRef.current = false
    setCreating(false)
    setSelectedId(item.id)
  }, [novelId])

  useEffect(() => {
    if (!routeGlossaryId || routeFocusRef.current === routeGlossaryId) return
    routeFocusRef.current = routeGlossaryId
    void loadRouteEntry(routeGlossaryId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [loadRouteEntry, routeGlossaryId])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = '当前术语还有未保存修改。'
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  const requestNavigation = useCallback((action: () => void) => {
    if (!hasUnsavedChanges) {
      action()
      return
    }
    Modal.confirm({
      title: '当前术语还有未保存修改',
      content: '切换前请决定是否放弃当前修改。',
      okText: '放弃并继续',
      okType: 'danger',
      cancelText: '留下继续编辑',
      onOk: action,
    })
  }, [hasUnsavedChanges])

  const handleSelect = useCallback((id: number) => {
    requestNavigation(() => {
      creatingRef.current = false
      setCreating(false)
      setSelectedId(id)
      syncGlossaryRoute(id)
      setDetailsOpen(false)
    })
  }, [requestNavigation, syncGlossaryRoute])

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const relatedEntityIds = values.relatedEntityIds
        .split(/[，,、\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
      const payload: Partial<GlossaryEntry> = {
        term: values.term.trim(),
        category: values.category,
        definition: values.definition.trim(),
        bodyMd: (values.bodyMd || '').trim(),
        aliasesJson: stringifyGlossaryAliases(values.aliases || []),
        firstAppearChapter: values.firstAppearChapter || undefined,
        relatedEntityIdsJson: JSON.stringify(relatedEntityIds),
        isCanonical: values.isCanonical ? 1 : 0,
      }
      if (selectedId) {
        await window.electron.glossary.update(selectedId, payload)
        message.success(getUserFacingMessage('glossary.updated'))
      } else {
        const id = await window.electron.glossary.create(novelId, payload)
        setSelectedId(id)
        syncGlossaryRoute(id)
        message.success(getUserFacingMessage('glossary.created'))
      }
      creatingRef.current = false
      setCreating(false)
      setPersistedFormSignature(serializeFormValues(values))
      notifyWorkspaceMutation()
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!selectedItem) return
    Modal.confirm({
      title: `删除术语「${selectedItem.term}」？`,
      content: '删除后无法恢复；正文中的历史引用不会自动改写。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.glossary.delete(selectedItem.id)
          creatingRef.current = false
          message.success(getUserFacingMessage('glossary.deleted'))
          syncGlossaryRoute(null)
          setSelectedId(null)
          setCreating(false)
          form.setFieldsValue(EMPTY_VALUES)
          setPersistedFormSignature(serializeFormValues(EMPTY_VALUES))
          notifyWorkspaceMutation()
          await refresh()
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }

  const handleCreate = useCallback(() => {
    requestNavigation(() => {
      creatingRef.current = true
      setCreating(true)
      setSelectedId(null)
      syncGlossaryRoute(null)
      setDetailsOpen(true)
      form.setFieldsValue(EMPTY_VALUES)
      setPersistedFormSignature(serializeFormValues(EMPTY_VALUES))
    })
  }, [form, requestNavigation, syncGlossaryRoute])

  const handleScanReferences = async () => {
    setScanning(true)
    try {
      const result = await window.electron.glossary.scanReferences(novelId)
      message.success(getUserFacingMessage('glossary.scanCompleted', {
        chapters: result.scannedChapters,
        terms: result.matchedTermCount,
        hits: result.totalHits,
      }))
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.executionFailed'))
    } finally {
      setScanning(false)
    }
  }

  return (
    <WorkspacePage
      className="novel-glossary-page"
      layout="wide"
      heroVariant="compact"
      chrome="shared"
      title="设定词典"
      actionContract={{
        primary: {
          key: 'save',
          label: '保存术语',
          icon: <SaveOutlined />,
          loading: saving,
          disabled: !selectedItem && !creating,
          onClick: () => void handleSave(),
        },
        secondary: [
          {
            key: 'new',
            label: '新建术语',
            icon: <PlusOutlined />,
            onClick: handleCreate,
          },
        ],
        more: {
          items: [
            { key: 'refresh', label: '刷新列表', onClick: () => void refresh() },
            { key: 'scan', label: '扫描全书引用', icon: <ScanOutlined />, disabled: scanning, onClick: () => void handleScanReferences() },
            { type: 'divider' },
            { key: 'delete', label: '删除术语', icon: <DeleteOutlined />, danger: true, disabled: !selectedItem, onClick: () => void handleDelete() },
          ],
        },
      }}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '当前选中', value: selectedItem?.term || '新建中' },
            { label: '章节数', value: workflowStats.chapterCount },
            { label: '线程数', value: workflowStats.threadCount },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="术语总数" value={stats.total} tone="warm" />
          <WorkspaceMetric label="规范用法" value={stats.canonicalCount} />
          <WorkspaceMetric label="废弃用法" value={stats.deprecatedCount} />
          <WorkspaceMetric label="分类数" value={stats.categoryCount} />
        </>
      )}
    >
      <div className="novel-glossary__status-rail" data-glossary-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <span className={`novel-glossary__status-dot${hasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
        <strong>{hasUnsavedChanges ? '有未保存修改' : '已与当前条目同步'}</strong>
        <span>{selectedItem ? `当前编辑：${selectedItem.term}` : creating ? '正在新建术语' : '从左侧选择一条术语开始'}</span>
      </div>
      {!workflowStats.chapterCount ? (
        <Alert
          type="info"
          showIcon
          message="正文还没开始推进"
          description="可以先录入核心名词。等结构和章节增加后，再回填首次出现章位。"
        />
      ) : null}

      <WorkspacePanel
        title="词典清单"
        extra={<span className="novel-glossary__result-count">{items.length} / {stats.total} 条当前结果</span>}
      >
        <div className="novel-glossary__layout">
          <section className="novel-glossary__list-panel" aria-label="术语列表">
            <div className="novel-glossary__filters">
              <Input.Search value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="搜索术语、定义或别名" allowClear />
              <Select value={canonicalFilter} onChange={setCanonicalFilter} options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '仅规范用法' },
                { value: 'deprecated', label: '仅废弃用法' },
              ]} />
            </div>
            {loading ? (
              <div className="novel-glossary__empty"><Spin /></div>
            ) : items.length === 0 ? (
              <div className="novel-glossary__empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有术语" /></div>
            ) : (
              <div className="novel-glossary__list-scroll">
                <VirtualList data={items} height={listHeight} itemHeight={LIST_ITEM_HEIGHT} itemKey="id">
                  {(item: GlossaryEntry) => {
                    const usage = usageByGlossaryId.get(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`novel-glossary__list-row${selectedId === item.id ? ' is-selected' : ''}`}
                        aria-current={selectedId === item.id ? 'true' : undefined}
                        onClick={() => handleSelect(item.id)}
                      >
                        <span className="novel-glossary__row-topline">
                          <strong>{item.term}</strong>
                          <span className="novel-glossary__row-category">{GLOSSARY_CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label || item.category}</span>
                          <span className={`novel-glossary__row-state${item.isCanonical > 0 ? ' is-canonical' : ''}`}>{item.isCanonical > 0 ? '规范' : '废弃'}</span>
                        </span>
                        <span className="novel-glossary__row-definition">{item.definition || '还没有定义。'}</span>
                        <span className="novel-glossary__row-facts">
                          <span>{item.firstAppearChapter ? `首见第 ${item.firstAppearChapter} 章` : '未标首见章'}</span>
                          <span>{usage?.unused ? '未引用' : usage ? `引用 ${usage.totalHits} 次` : '引用待扫描'}</span>
                        </span>
                      </button>
                    )
                  }}
                </VirtualList>
              </div>
            )}
          </section>

          <section className="novel-glossary__detail-panel" aria-label="术语详情">
            <div className="novel-glossary__detail-head">
              <div>
                <span className="novel-glossary__detail-kicker">{creating ? '新建条目' : selectedItem ? '当前条目' : '按需编辑'}</span>
                <h2>{selectedItem?.term || (creating ? '新建术语' : '选择一条术语')}</h2>
              </div>
              <AIGenerateButton
                novelId={novelId}
                label={selectedItem ? 'AI 补当前术语' : 'AI 生成术语草稿'}
                isJson
                disabled={!selectedItem && !creating}
                buildMessages={() => {
                  const values = form.getFieldsValue(true)
                  return buildDraftMessages({
                    task: '设定词典条目',
                    mode: values.term ? 'optimize' : 'replace',
                    context: [
                      { label: '书名', value: currentNovel?.title || '' },
                      { label: '题材', value: currentNovel?.genreName || '' },
                      { label: '简介', value: currentNovel?.synopsis || '' },
                      { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
                      { label: '现有术语', value: items.filter((item) => item.id !== selectedId).slice(0, 10).map((item) => item.term).join('、') },
                    ],
                    fields: [
                      { key: 'term', label: '术语名', value: values.term, hint: '要像作品内真实会反复出现的名词。' },
                      { key: 'category', label: '分类', value: values.category, hint: '只用已有分类。' },
                      { key: 'definition', label: '定义', value: values.definition, hint: '写清用途和边界，不要百科腔。' },
                      { key: 'aliases', label: '别名', type: 'string[]', value: values.aliases, hint: '只保留确实会被使用的叫法。' },
                      { key: 'firstAppearChapter', label: '首次出现章节', type: 'number', value: values.firstAppearChapter, hint: '不知道可留空。' },
                    ],
                    requirements: ['不要制造和现有术语冲突的新名词。', '定义要服务剧情与写作调用。'],
                  })
                }}
                onResult={(raw) => {
                  const values = form.getFieldsValue(true)
                  const draft = parseDraftJson<Record<string, unknown>>(raw)
                  form.setFieldsValue({
                    ...values,
                    term: typeof draft.term === 'string' ? draft.term : values.term,
                    category: typeof draft.category === 'string' ? draft.category as GlossaryEntry['category'] : values.category,
                    definition: typeof draft.definition === 'string' ? draft.definition : values.definition,
                    aliases: normalizeStringArray(draft.aliases).length > 0 ? normalizeStringArray(draft.aliases) : values.aliases,
                    firstAppearChapter: normalizeOptionalNumber(draft.firstAppearChapter ?? values.firstAppearChapter),
                  })
                }}
              />
            </div>
            <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} disabled={!selectedItem && !creating} className="novel-glossary__detail-form">
              <div className="novel-glossary__core-fields">
                <Form.Item name="term" label="术语" rules={[{ required: true, message: '请填写术语' }]}>
                  <Input placeholder="例如：灰潮、筑基、引火石" />
                </Form.Item>
                <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
                  <Select options={GLOSSARY_CATEGORY_OPTIONS as unknown as Array<{ value: string; label: string }>} />
                </Form.Item>
                <Form.Item name="firstAppearChapter" label="首次出现章位">
                  <Input type="number" min={1} />
                </Form.Item>
                <Form.Item name="isCanonical" label="规范用法" valuePropName="checked">
                  <Switch checkedChildren="规范" unCheckedChildren="废弃" />
                </Form.Item>
                <Form.Item name="definition" label="定义" rules={[{ required: true, message: '请填写定义' }]} className="novel-glossary__definition-field">
                  <Input.TextArea rows={5} placeholder="写清这个词在小说里的确切含义、作用边界和常见误用。" />
                </Form.Item>
              </div>
              <details className="novel-glossary__advanced" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
                <summary>
                  <span>扩展设定</span>
                  <small>Markdown 长文、别名和关联实体按需维护</small>
                </summary>
                <div className="novel-glossary__advanced-grid">
                  <Form.Item name="aliases" label="别名">
                    <Select mode="tags" allowClear tokenSeparators={[',', '，', '、']} placeholder="输入别名或旧称" />
                  </Form.Item>
                  <Form.Item name="relatedEntityIds" label="关联实体 ID">
                    <Input placeholder="可留空。多个 ID 用逗号分隔。" />
                  </Form.Item>
                  <Form.Item name="bodyMd" label="设定长文（Markdown，可选）" className="novel-glossary__long-field">
                    <Input.TextArea rows={7} placeholder="用于 lore / 世界观类词条的长文设定；不会默认注入正文生成。" />
                  </Form.Item>
                </div>
              </details>
            </Form>
          </section>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
