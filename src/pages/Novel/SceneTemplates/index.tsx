import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, List, Select, Space, Switch, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { SceneTemplate } from '../../../types'
import { parseSceneTemplateStringList, stringifySceneTemplateStringList } from '../../../shared/scene-templates'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

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

export default function SceneTemplatesPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const [form] = Form.useForm<SceneTemplateFormValues>()
  const [items, setItems] = useState<SceneTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [stats, setStats] = useState({ total: 0, builtinCount: 0, customCount: 0, genreScopedCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ outlineCount: 0, chapterCount: 0 })
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<'all' | 'builtin' | 'custom'>('all')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  )
  const selectedIsBuiltin = selectedItem?.isBuiltin === 1

  const refresh = useCallback(async () => {
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
      setItems(page.items)
      setStats(nextStats)
      setWorkflowStats({ outlineCount: nextWorkflowStats.outlineCount, chapterCount: nextWorkflowStats.chapterCount })
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
  }, [currentNovel?.genreId, keyword, novelId, scope])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    form.setFieldsValue(buildFormValues(selectedItem))
  }, [form, selectedItem])

  const handleCreate = () => {
    setSelectedId(null)
    form.setFieldsValue(EMPTY_VALUES)
  }

  const handleSave = async () => {
    if (selectedIsBuiltin) {
      message.warning(getUserFacingMessage('sceneTemplate.readonlyBuiltin'))
      return
    }
    const values = await form.validateFields()
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
        message.success(getUserFacingMessage('sceneTemplate.created'))
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
    if (!selectedItem || selectedIsBuiltin) return
    try {
      await window.electron.sceneTemplate.delete(selectedItem.id)
      message.success(getUserFacingMessage('sceneTemplate.deleted'))
      setSelectedId(null)
      form.setFieldsValue(EMPTY_VALUES)
      notifyWorkspaceMutation()
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.deleteFailed'))
    }
  }

  return (
    <WorkspacePage
      className="novel-scene-templates-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="世界与资源"
      title="场景模板库"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={selectedIsBuiltin} onClick={() => void handleSave()}>
            保存模板
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleCreate}>新建模板</Button>
          <Button danger icon={<DeleteOutlined />} disabled={!selectedItem || selectedIsBuiltin} onClick={() => void handleDelete()}>
            删除模板
          </Button>
        </Space>
      )}
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
          <WorkspaceMetric label="模板总数" value={stats.total} tone="warm" hint="包含全局内置、题材内置和当前小说自定义。" />
          <WorkspaceMetric label="内置模板" value={stats.builtinCount} hint="内置模板只读，用于快速开局。" />
          <WorkspaceMetric label="自定义模板" value={stats.customCount} hint="真正适配本书节奏的模板应优先落在这里。" />
          <WorkspaceMetric label="题材作用域" value={stats.genreScopedCount} hint="按题材筛出的模板更适合复用。" />
        </>
      )}
    >
      {!workflowStats.outlineCount ? (
        <Alert
          type="info"
          showIcon
          message="大纲还不完整"
          description="场景模板可以先沉淀；等结构页和章节目标更明确后，套用效果会更稳定。"
        />
      ) : null}

      <WorkspacePanel title="模板清单">
        <div className="novel-resource-workspace__layout">
          <div className="novel-resource-workspace__sidebar">
            <Input.Search value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索模板名、描述或情绪弧线" allowClear />
            <Select value={scope} onChange={setScope} options={[
              { value: 'all', label: '全部' },
              { value: 'builtin', label: '仅内置' },
              { value: 'custom', label: '仅自定义' },
            ]} />
            <List
              loading={loading}
              size="small"
              dataSource={items}
              locale={{ emptyText: '当前没有场景模板' }}
              renderItem={(item) => (
                <List.Item
                  className="novel-resource-workspace__list-item"
                  onClick={() => setSelectedId(item.id)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 12,
                    padding: 12,
                    background: selectedId === item.id ? 'rgba(24, 144, 255, 0.08)' : 'transparent',
                    border: '1px solid rgba(120, 120, 120, 0.18)',
                    marginBottom: 8,
                  }}
                >
                  <List.Item.Meta
                    title={(
                      <div className="novel-resource-workspace__title-row">
                        <strong className="novel-resource-workspace__title-text">{item.name}</strong>
                        <Tag>{CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label || item.category}</Tag>
                        {item.isBuiltin > 0 ? <Tag color="gold">内置</Tag> : <Tag color="blue">自定义</Tag>}
                      </div>
                    )}
                    description={(
                      <div className="novel-resource-workspace__desc">
                        {item.description || item.emotionArc || '还没有写清模板说明。'}
                      </div>
                    )}
                  />
                </List.Item>
              )}
            />
          </div>

          <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} disabled={selectedIsBuiltin} className="novel-resource-workspace__content">
            <div className="guided-step__field-grid">
              <div className="guided-step__field-card">
                <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请填写模板名称' }]}>
                  <Input placeholder="例如：夜间突袭 / 内部争执 / 线索反转" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="category" label="模板类型" rules={[{ required: true, message: '请选择模板类型' }]}>
                  <Select options={CATEGORY_OPTIONS as unknown as Array<{ value: string; label: string }>} />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="genreScoped" label="题材作用域" valuePropName="checked">
                  <Switch checkedChildren="当前题材" unCheckedChildren="全局通用" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="description" label="模板说明" rules={[{ required: true, message: '请填写模板说明' }]}>
                  <Input.TextArea rows={6} placeholder="写清这个模板适合解决什么问题，什么时候用，避免什么误用。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="typicalBeats" label="典型节拍">
                  <Select mode="tags" allowClear tokenSeparators={[',', '，', '、']} placeholder="例如：触发 -> 试探 -> 失控 -> 留后患" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="suggestedCharacterRoles" label="建议角色功能位">
                  <Select mode="tags" allowClear tokenSeparators={[',', '，', '、']} placeholder="例如：主角、对手、见证者、情报源" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="emotionArc" label="情绪弧线">
                  <Input.TextArea rows={6} placeholder="写清读者在这个场景里的情绪变化路径。" />
                </Form.Item>
              </div>
            </div>
          </Form>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
