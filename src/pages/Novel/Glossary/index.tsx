import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, List, Select, Space, Switch, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { GlossaryEntry } from '../../../types'
import { parseGlossaryAliases, stringifyGlossaryAliases } from '../../../shared/glossary'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

const GLOSSARY_CATEGORY_OPTIONS = [
  { value: 'skill', label: '技能' },
  { value: 'rank', label: '阶位' },
  { value: 'event', label: '事件' },
  { value: 'material', label: '材料' },
  { value: 'species', label: '种族' },
  { value: 'custom', label: '自定义' },
] as const

interface Props {
  novelId: number
}

interface GlossaryFormValues {
  term: string
  category: GlossaryEntry['category']
  definition: string
  aliases: string[]
  firstAppearChapter?: number
  relatedEntityIds: string
  isCanonical: boolean
}

const EMPTY_VALUES: GlossaryFormValues = {
  term: '',
  category: 'custom',
  definition: '',
  aliases: [],
  firstAppearChapter: undefined,
  relatedEntityIds: '',
  isCanonical: true,
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
    aliases: parseGlossaryAliases(item.aliasesJson),
    firstAppearChapter: item.firstAppearChapter,
    relatedEntityIds: parseNumberJson(item.relatedEntityIdsJson || '[]').join(', '),
    isCanonical: item.isCanonical > 0,
  }
}

export default function GlossaryPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const [form] = Form.useForm<GlossaryFormValues>()
  const [items, setItems] = useState<GlossaryEntry[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [stats, setStats] = useState({ total: 0, canonicalCount: 0, deprecatedCount: 0, categoryCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ threadCount: 0, chapterCount: 0 })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [canonicalFilter, setCanonicalFilter] = useState<'all' | 'active' | 'deprecated'>('all')

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [page, nextStats, nextWorkflowStats] = await Promise.all([
        window.electron.glossary.query({ novelId, keyword, canonical: canonicalFilter, page: 1, pageSize: 200 }),
        window.electron.glossary.getStats({ novelId }),
        loadWorkflowStats(novelId),
      ])
      setItems(page.items)
      setStats(nextStats)
      setWorkflowStats({ threadCount: nextWorkflowStats.threadCount, chapterCount: nextWorkflowStats.chapterCount })
      setSelectedId((current) => {
        if (current && page.items.some((item) => item.id === current)) return current
        return page.items[0]?.id || null
      })
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [canonicalFilter, keyword, novelId])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    form.setFieldsValue(buildFormValues(selectedItem))
  }, [form, selectedItem])

  const handleSave = async () => {
    const values = await form.validateFields()
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
        message.success(getUserFacingMessage('glossary.created'))
      }
      notifyWorkspaceMutation()
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return
    try {
      await window.electron.glossary.delete(selectedItem.id)
      message.success(getUserFacingMessage('glossary.deleted'))
      setSelectedId(null)
      form.setFieldsValue(EMPTY_VALUES)
      notifyWorkspaceMutation()
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.deleteFailed'))
    }
  }

  const handleCreate = () => {
    setSelectedId(null)
    form.setFieldsValue(EMPTY_VALUES)
  }

  return (
    <WorkspacePage
      className="novel-glossary-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="世界与资源"
      title="设定词典"
      description="把术语、阶位、材料、事件和种族名词固定成可检索资产，减少章节生成和修订时的命名漂移。"
      actions={(
        <Space wrap>
          <AIGenerateButton
            novelId={novelId}
            label={selectedItem ? 'AI 补当前术语' : 'AI 生成术语草稿'}
            isJson
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
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存术语
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleCreate}>新建术语</Button>
          <Button danger icon={<DeleteOutlined />} disabled={!selectedItem} onClick={() => void handleDelete()}>
            删除术语
          </Button>
        </Space>
      )}
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
          <WorkspaceMetric label="术语总数" value={stats.total} tone="warm" hint="优先录入会重复出现的专有名词。" />
          <WorkspaceMetric label="规范用法" value={stats.canonicalCount} hint="默认只把规范词注入写作上下文。" />
          <WorkspaceMetric label="废弃用法" value={stats.deprecatedCount} hint="可把旧称、错称和历史别名沉到这里。" />
          <WorkspaceMetric label="分类数" value={stats.categoryCount} hint="分类越稳，后面越方便筛选和复用。" />
        </>
      )}
    >
      {!workflowStats.chapterCount ? (
        <Alert
          type="info"
          showIcon
          message="正文还没开始推进"
          description="可以先录入核心名词。等结构和章节增加后，再回填首次出现章位。"
        />
      ) : null}

      <WorkspacePanel title="词典清单" description="左侧筛选，右侧编辑定义与别名。">
        <div className="novel-resource-workspace__layout">
          <div className="novel-resource-workspace__sidebar">
            <Input.Search value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索术语、定义或别名" allowClear />
            <Select value={canonicalFilter} onChange={setCanonicalFilter} options={[
              { value: 'all', label: '全部' },
              { value: 'active', label: '仅规范用法' },
              { value: 'deprecated', label: '仅废弃用法' },
            ]} />
            <List
              loading={loading}
              size="small"
              dataSource={items}
              locale={{ emptyText: '当前没有术语记录' }}
              renderItem={(item) => (
                <List.Item
                  className="novel-resource-workspace__list-item"
                  onClick={() => setSelectedId(item.id)}
                  style={selectedId === item.id ? {
                    background: 'rgba(24, 144, 255, 0.08)',
                  } : undefined}
                >
                  <List.Item.Meta
                    title={(
                      <div className="novel-resource-workspace__title-row">
                        <strong className="novel-resource-workspace__title-text">{item.term}</strong>
                        <Tag>{GLOSSARY_CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label || item.category}</Tag>
                        {item.isCanonical > 0 ? <Tag color="success">规范</Tag> : <Tag>废弃</Tag>}
                      </div>
                    )}
                    description={(
                      <div className="novel-resource-workspace__desc">
                        {item.definition || '还没有定义。'}
                      </div>
                    )}
                  />
                </List.Item>
              )}
            />
          </div>

          <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} className="novel-resource-workspace__content">
            <div className="guided-step__field-grid">
              <div className="guided-step__field-card">
                <Form.Item name="term" label="术语" rules={[{ required: true, message: '请填写术语' }]}>
                  <Input placeholder="例如：灰潮、筑基、引火石" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
                  <Select options={GLOSSARY_CATEGORY_OPTIONS as unknown as Array<{ value: string; label: string }>} />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="firstAppearChapter" label="首次出现章位">
                  <Input type="number" min={1} />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="isCanonical" label="规范用法" valuePropName="checked">
                  <Switch checkedChildren="规范" unCheckedChildren="废弃" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="definition" label="定义" rules={[{ required: true, message: '请填写定义' }]}>
                  <Input.TextArea rows={6} placeholder="写清这个词在小说里的确切含义、作用边界和常见误用。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="aliases" label="别名">
                  <Select mode="tags" allowClear tokenSeparators={[',', '，', '、']} placeholder="输入别名或旧称" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="relatedEntityIds" label="关联实体 ID">
                  <Input placeholder="可留空。多个 ID 用逗号分隔。" />
                </Form.Item>
              </div>
            </div>
          </Form>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
