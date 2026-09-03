import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedSearch } from '../../../hooks/useDebouncedSearch'
import { Alert, Empty, Form, Input, Modal, Select, Spin, Switch, message } from 'antd'
import { CopyOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import VirtualList from 'rc-virtual-list'
import { useSearchParams } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { SceneTemplate } from '../../../types'
import { parseSceneTemplateStringList, stringifySceneTemplateStringList } from '../../../shared/scene-templates'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { buildDraftMessages, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { loadWorkflowStats } from '../workflow'
import { useNovelWorkspaceActions, useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import { useResponsivePanelHeight } from '../../../shared/use-responsive-panel-height'
import './index.css'

const CATEGORY_OPTIONS = [
  { value: 'conflict', label: '冲突' },
  { value: 'transition', label: '过渡' },
  { value: 'revelation', label: '揭示' },
  { value: 'bonding', label: '关系推进' },
  { value: 'crisis', label: '危机' },
  { value: 'climax', label: '高潮' },
] as const

interface Props {
  novelId: number
}

interface SceneTemplateFormValues {
  name: string
  category: SceneTemplate['category']
  description: string
  typicalBeats: string[]
  suggestedCharacterRoles: string[]
  emotionArc: string
  genreScoped: boolean
}

const EMPTY_VALUES: SceneTemplateFormValues = {
  name: '',
  category: 'conflict',
  description: '',
  typicalBeats: [],
  suggestedCharacterRoles: [],
  emotionArc: '',
  genreScoped: true,
}

const LIST_ITEM_HEIGHT = 88

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function serializeFormValues(values: Partial<SceneTemplateFormValues>) {
  return JSON.stringify({
    name: values.name?.trim() || '',
    category: values.category || 'conflict',
    description: values.description?.trim() || '',
    typicalBeats: values.typicalBeats || [],
    suggestedCharacterRoles: values.suggestedCharacterRoles || [],
    emotionArc: values.emotionArc?.trim() || '',
    genreScoped: values.genreScoped !== false,
  })
}

function buildFormValues(item?: SceneTemplate | null): SceneTemplateFormValues {
  if (!item) return EMPTY_VALUES
  return {
    name: item.name,
    category: item.category,
    description: item.description || '',
    typicalBeats: parseSceneTemplateStringList(item.typicalBeatsJson),
    suggestedCharacterRoles: parseSceneTemplateStringList(item.suggestedCharacterRolesJson),
    emotionArc: item.emotionArc || '',
    genreScoped: typeof item.genreId === 'number',
  }
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function SceneTemplatesPage({ novelId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { mutationToken, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const listHeight = useResponsivePanelHeight({ minHeight: 336, maxHeight: 640, ratio: 0.58, fallback: 460 })
  const [form] = Form.useForm<SceneTemplateFormValues>()
  const [items, setItems] = useState<SceneTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [stats, setStats] = useState({ total: 0, builtinCount: 0, customCount: 0, genreScopedCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ outlineCount: 0, chapterCount: 0 })
  const [keywordInput, setKeywordInput, keyword] = useDebouncedSearch('')
  const [scope, setScope] = useState<'all' | 'builtin' | 'custom'>('all')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [persistedFormSignature, setPersistedFormSignature] = useState(() => serializeFormValues(EMPTY_VALUES))
  const refreshRequestRef = useRef(0)
  const creatingRef = useRef(false)
  const routeFocusRef = useRef<number | null>(null)

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  )
  const selectedIsBuiltin = selectedItem?.isBuiltin === 1
  const watchedFormValues = Form.useWatch([], form) as Partial<SceneTemplateFormValues> | undefined
  const formValues = useMemo<Partial<SceneTemplateFormValues>>(
    () => watchedFormValues ?? {},
    [watchedFormValues],
  )
  const currentFormValues = useMemo<SceneTemplateFormValues>(() => ({
    ...buildFormValues(selectedItem),
    ...formValues,
    typicalBeats: formValues.typicalBeats ?? buildFormValues(selectedItem).typicalBeats,
    suggestedCharacterRoles: formValues.suggestedCharacterRoles ?? buildFormValues(selectedItem).suggestedCharacterRoles,
    genreScoped: formValues.genreScoped ?? buildFormValues(selectedItem).genreScoped,
  }), [formValues, selectedItem])
  const hasUnsavedChanges = Boolean(selectedItem || creating) && serializeFormValues(currentFormValues) !== persistedFormSignature
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)
  const routeTemplateId = useMemo(() => parseRouteId(searchParams.get('templateId')), [searchParams])

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const [page, nextStats, nextWorkflowStats] = await Promise.all([
        window.electron.sceneTemplate.query({
          novelId,
          genreId: currentNovel?.genreId,
          keyword,
          scope,
          page: 1,
          pageSize: 200,
        }),
        window.electron.sceneTemplate.getStats({ novelId, genreId: currentNovel?.genreId }),
        loadWorkflowStats(novelId),
      ])
      if (refreshRequestRef.current !== requestId) return
      setItems(page.items)
      setStats(nextStats)
      setWorkflowStats({ outlineCount: nextWorkflowStats.outlineCount, chapterCount: nextWorkflowStats.chapterCount })
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
  }, [currentNovel?.genreId, keyword, novelId, scope])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    form.setFieldsValue(buildFormValues(selectedItem))
    if (selectedItem) {
      setPersistedFormSignature(serializeFormValues(buildFormValues(selectedItem)))
    }
  }, [form, selectedId, selectedItem?.id])

  const syncTemplateRoute = useCallback((id: number | null) => {
    const nextParams = new URLSearchParams(searchParams)
    if (id) nextParams.set('templateId', String(id))
    else nextParams.delete('templateId')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const loadRouteTemplate = useCallback(async (id: number) => {
    const item = await window.electron.sceneTemplate.get(id)
    if (!item) return
    const isVisibleForNovel = item.novelId === novelId
      || (typeof item.novelId !== 'number' && (!item.genreId || item.genreId === currentNovel?.genreId))
    if (!isVisibleForNovel) return
    setItems((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current])
    creatingRef.current = false
    setCreating(false)
    setSelectedId(item.id)
  }, [currentNovel?.genreId, novelId])

  useEffect(() => {
    if (!routeTemplateId || routeFocusRef.current === routeTemplateId) return
    routeFocusRef.current = routeTemplateId
    void loadRouteTemplate(routeTemplateId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [loadRouteTemplate, routeTemplateId])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = '当前模板还有未保存修改。'
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
      title: '当前模板还有未保存修改',
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
      syncTemplateRoute(id)
      setDetailsOpen(false)
    })
  }, [requestNavigation, syncTemplateRoute])

  const handleCreate = useCallback(() => {
    requestNavigation(() => {
      creatingRef.current = true
      setCreating(true)
      setSelectedId(null)
      syncTemplateRoute(null)
      setDetailsOpen(true)
      form.setFieldsValue(EMPTY_VALUES)
      setPersistedFormSignature(serializeFormValues(EMPTY_VALUES))
    })
  }, [form, requestNavigation, syncTemplateRoute])

  const handleSave = async () => {
    if (selectedIsBuiltin) {
      message.warning(getUserFacingMessage('sceneTemplate.readonlyBuiltin'))
      return
    }
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const payload: Partial<SceneTemplate> = {
        novelId,
        genreId: values.genreScoped ? currentNovel?.genreId : undefined,
        name: values.name.trim(),
        category: values.category,
        description: values.description.trim(),
        typicalBeatsJson: stringifySceneTemplateStringList(values.typicalBeats || []),
        suggestedCharacterRolesJson: stringifySceneTemplateStringList(values.suggestedCharacterRoles || []),
        emotionArc: values.emotionArc.trim(),
        isBuiltin: 0,
      }
      if (selectedId) {
        await window.electron.sceneTemplate.update(selectedId, payload)
        message.success(getUserFacingMessage('sceneTemplate.updated'))
      } else {
        const id = await window.electron.sceneTemplate.create(payload)
        setSelectedId(id)
        syncTemplateRoute(id)
        message.success(getUserFacingMessage('sceneTemplate.created'))
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
    if (!selectedItem || selectedIsBuiltin) return
    Modal.confirm({
      title: `删除场景模板「${selectedItem.name}」？`,
      content: '删除后无法恢复；已使用该模板的章节不会自动改写。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.sceneTemplate.delete(selectedItem.id)
          creatingRef.current = false
          message.success(getUserFacingMessage('sceneTemplate.deleted'))
          syncTemplateRoute(null)
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

  const handleCopy = useCallback(async () => {
    if (!selectedItem) return
    try {
      const values = buildFormValues(selectedItem)
      const copiedValues = { ...values, name: `${selectedItem.name} · 副本` }
      const id = await window.electron.sceneTemplate.create({
        novelId,
        genreId: values.genreScoped ? currentNovel?.genreId : undefined,
        name: copiedValues.name,
        category: values.category,
        description: values.description,
        typicalBeatsJson: stringifySceneTemplateStringList(values.typicalBeats),
        suggestedCharacterRolesJson: stringifySceneTemplateStringList(values.suggestedCharacterRoles),
        emotionArc: values.emotionArc,
        isBuiltin: 0,
      })
      const copiedItem = await window.electron.sceneTemplate.get(id)
      if (!copiedItem) throw new Error(getUserFacingMessage('sceneTemplate.copyReadFailed'))
      creatingRef.current = false
      setCreating(false)
      setSelectedId(id)
      syncTemplateRoute(id)
      setPersistedFormSignature(serializeFormValues(copiedValues))
      setDetailsOpen(true)
      setScope('all')
      setItems((current) => [copiedItem, ...current.filter((item) => item.id !== copiedItem.id)])
      message.success(getUserFacingMessage('sceneTemplate.copied'))
      notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }, [currentNovel?.genreId, notifyWorkspaceMutation, novelId, selectedItem, syncTemplateRoute])

  return (
    <WorkspacePage
      className="novel-scene-templates-page"
      layout="wide"
      heroVariant="compact"
      chrome="shared"
      title="场景模板库"
      actionContract={{
        primary: {
          key: 'save',
          label: '保存模板',
          icon: <SaveOutlined />,
          loading: saving,
          disabled: selectedIsBuiltin || (!selectedItem && !creating),
          onClick: () => void handleSave(),
        },
        secondary: [
          {
            key: 'new',
            label: '新建模板',
            icon: <PlusOutlined />,
            onClick: handleCreate,
          },
          {
            key: 'copy',
            label: '复制为自定义',
            icon: <CopyOutlined />,
            disabled: !selectedItem,
            onClick: () => void handleCopy(),
          },
        ],
        more: {
          items: [
            { key: 'refresh', label: '刷新列表', icon: <ReloadOutlined />, onClick: () => void refresh() },
            { key: 'delete', label: '删除模板', icon: <DeleteOutlined />, danger: true, disabled: !selectedItem || selectedIsBuiltin, onClick: () => void handleDelete() },
          ],
        },
      }}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '当前选中', value: selectedItem?.name || '新建中' },
            { label: '已规划章节', value: workflowStats.chapterCount },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="模板总数" value={stats.total} tone="warm" />
          <WorkspaceMetric label="内置模板" value={stats.builtinCount} />
          <WorkspaceMetric label="自定义模板" value={stats.customCount} />
          <WorkspaceMetric label="题材作用域" value={stats.genreScopedCount} />
        </>
      )}
    >
      <div className="novel-scene-templates__status-rail" data-scene-template-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <span className={`novel-scene-templates__status-dot${hasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
        <strong>{hasUnsavedChanges ? '有未保存修改' : selectedIsBuiltin ? '内置模板只读' : '已与当前模板同步'}</strong>
        <span>{selectedItem ? `当前编辑：${selectedItem.name}` : creating ? '正在新建模板' : '从左侧选择一条模板开始'}</span>
      </div>
      {!workflowStats.outlineCount ? (
        <Alert
          type="info"
          showIcon
          message="大纲还不完整"
          description="场景模板可以先沉淀；等结构页和章节目标更明确后，套用效果会更稳定。"
        />
      ) : null}

      <WorkspacePanel
        title="模板清单"
        extra={<span className="novel-scene-templates__result-count">{items.length} / {stats.total} 条当前结果</span>}
      >
        <div className="novel-scene-templates__layout">
          <section className="novel-scene-templates__list-panel" aria-label="场景模板列表">
            <div className="novel-scene-templates__filters">
              <Input.Search value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="搜索模板名、描述或情绪弧线" allowClear />
              <Select value={scope} onChange={setScope} options={[
                { value: 'all', label: '全部作用域' },
                { value: 'builtin', label: '仅内置' },
                { value: 'custom', label: '仅自定义' },
              ]} />
            </div>
            {loading ? (
              <div className="novel-scene-templates__empty"><Spin /></div>
            ) : items.length === 0 ? (
              <div className="novel-scene-templates__empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有模板" /></div>
            ) : (
              <div className="novel-scene-templates__list-scroll">
                <VirtualList data={items} height={listHeight} itemHeight={LIST_ITEM_HEIGHT} itemKey="id">
                  {(item: SceneTemplate) => {
                    const beats = parseSceneTemplateStringList(item.typicalBeatsJson)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`novel-scene-templates__list-row${selectedId === item.id ? ' is-selected' : ''}`}
                        aria-current={selectedId === item.id ? 'true' : undefined}
                        onClick={() => handleSelect(item.id)}
                      >
                        <span className="novel-scene-templates__row-topline">
                          <strong>{item.name}</strong>
                          <span className="novel-scene-templates__row-category">{CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label || item.category}</span>
                          <span className={`novel-scene-templates__row-state${item.isBuiltin > 0 ? ' is-builtin' : ''}`}>{item.isBuiltin > 0 ? '内置只读' : '自定义'}</span>
                        </span>
                        <span className="novel-scene-templates__row-description">{item.description || item.emotionArc || '还没有写清模板说明。'}</span>
                        <span className="novel-scene-templates__row-facts">
                          <span>{beats.length ? `${beats.length} 个节拍` : '未补节拍'}</span>
                          <span>{typeof item.genreId === 'number' ? '当前题材' : '全局通用'}</span>
                        </span>
                      </button>
                    )
                  }}
                </VirtualList>
              </div>
            )}
          </section>

          <section className="novel-scene-templates__detail-panel" aria-label="场景模板详情">
            <div className="novel-scene-templates__detail-head">
              <div>
                <span className="novel-scene-templates__detail-kicker">{creating ? '新建模板' : selectedIsBuiltin ? '内置模板 · 只读' : selectedItem ? '当前模板' : '按需编辑'}</span>
                <h2>{selectedItem?.name || (creating ? '新建场景模板' : '选择一条模板')}</h2>
              </div>
              <AIGenerateButton
                novelId={novelId}
                label={selectedItem ? 'AI 补全·当前模板' : 'AI 生成·模板草稿'}
                intent={hasFilledValues([
                  currentFormValues.name,
                  currentFormValues.description,
                  currentFormValues.emotionArc,
                ]) || currentFormValues.typicalBeats.length > 0 || currentFormValues.suggestedCharacterRoles.length > 0 ? 'complete' : 'generate'}
                isJson
                disabled={selectedIsBuiltin || (!selectedItem && !creating)}
                buildMessages={() => buildDraftMessages({
                  task: selectedItem ? `场景模板 · ${selectedItem.name}` : '场景模板草稿',
                  mode: hasFilledValues([
                    currentFormValues.name,
                    currentFormValues.description,
                    currentFormValues.emotionArc,
                  ]) || currentFormValues.typicalBeats.length > 0 || currentFormValues.suggestedCharacterRoles.length > 0 ? 'optimize' : 'replace',
                  context: buildPlanningContextSections(currentNovel, {
                    includeSubplots: true,
                    extraSections: [
                      { label: '当前题材', value: currentNovel?.genreName || '' },
                      { label: '现有模板类型分布', value: items.slice(0, 12).map((item) => `${item.name} · ${item.category}`) },
                    ],
                  }),
                  fields: [
                    { key: 'name', label: '模板名称', value: currentFormValues.name, hint: '写清这类场景的功能。' },
                    { key: 'category', label: '模板类型', value: currentFormValues.category, hint: '只用既有模板类型。' },
                    { key: 'description', label: '模板说明', value: currentFormValues.description, hint: '写什么时候用、解决什么问题、避免什么误用。' },
                    { key: 'typicalBeats', label: '典型节拍', type: 'string[]', value: currentFormValues.typicalBeats, hint: '每条写一个节拍节点。' },
                    { key: 'suggestedCharacterRoles', label: '建议角色功能位', type: 'string[]', value: currentFormValues.suggestedCharacterRoles, hint: '写适合参与该模板的角色功能位。' },
                    { key: 'emotionArc', label: '情绪弧线', value: currentFormValues.emotionArc, hint: '写读者在这类场景里的情绪变化路径。' },
                  ],
                  requirements: [
                    '必须适配当前题材和已有世界/人物/冲突风格。',
                    '要生成可复用模板，而不是单个具体场景剧情。',
                  ],
                })}
                onResult={(raw) => {
                  const draft = parseDraftJson<Record<string, unknown>>(raw)
                  form.setFieldsValue({
                    name: typeof draft.name === 'string' ? draft.name : undefined,
                    category: typeof draft.category === 'string' ? draft.category as SceneTemplate['category'] : undefined,
                    description: typeof draft.description === 'string' ? draft.description : undefined,
                    typicalBeats: Object.prototype.hasOwnProperty.call(draft, 'typicalBeats') ? normalizeStringArray(draft.typicalBeats) : undefined,
                    suggestedCharacterRoles: Object.prototype.hasOwnProperty.call(draft, 'suggestedCharacterRoles') ? normalizeStringArray(draft.suggestedCharacterRoles) : undefined,
                    emotionArc: typeof draft.emotionArc === 'string' ? draft.emotionArc : undefined,
                  })
                }}
              />
            </div>
            <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} disabled={selectedIsBuiltin || (!selectedItem && !creating)} className="novel-scene-templates__detail-form">
              <div className="novel-scene-templates__core-fields">
                <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请填写模板名称' }]}>
                  <Input placeholder="例如：夜间突袭 / 内部争执 / 线索反转" />
                </Form.Item>
                <Form.Item name="category" label="模板类型" rules={[{ required: true, message: '请选择模板类型' }]}>
                  <Select options={CATEGORY_OPTIONS as unknown as Array<{ value: string; label: string }>} />
                </Form.Item>
                <Form.Item name="genreScoped" label="题材作用域" valuePropName="checked">
                  <Switch checkedChildren="当前题材" unCheckedChildren="全局通用" />
                </Form.Item>
                <Form.Item name="description" label="模板说明" rules={[{ required: true, message: '请填写模板说明' }]} className="novel-scene-templates__description-field">
                  <Input.TextArea rows={5} placeholder="写清这个模板适合解决什么问题，什么时候用，避免什么误用。" />
                </Form.Item>
              </div>
              <details className="novel-scene-templates__advanced" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
                <summary>
                  <span>结构细节</span>
                  <small>典型节拍、角色功能位和情绪弧线按需维护</small>
                </summary>
                <div className="novel-scene-templates__advanced-grid">
                  <Form.Item name="typicalBeats" label="典型节拍">
                    <Select mode="tags" allowClear tokenSeparators={[',', '，', '、']} placeholder="例如：触发 -> 试探 -> 失控 -> 留后患" />
                  </Form.Item>
                  <Form.Item name="suggestedCharacterRoles" label="建议角色功能位">
                    <Select mode="tags" allowClear tokenSeparators={[',', '，', '、']} placeholder="例如：主角、对手、见证者、情报源" />
                  </Form.Item>
                  <Form.Item name="emotionArc" label="情绪弧线" className="novel-scene-templates__long-field">
                    <Input.TextArea rows={5} placeholder="写清读者在这个场景里的情绪变化路径。" />
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
