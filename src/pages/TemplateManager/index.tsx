import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Tabs, Button, Modal, Form, Input, Select, Card, Tag, message, Empty, Skeleton, Spin
} from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Template } from '../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'

const TYPE_LABELS: Record<string, string> = {
  style: '文风模板',
  world: '世界观模板',
}
const TEMPLATE_USAGE: Record<string, {
  entry: string
  appliedTo: string
  cardMeta: string
  fieldGuide: string
  modalDescription: string
  placeholder: string
}> = {
  style: {
    entry: '新建小说时的「文风模板」下拉框',
    appliedTo: 'AI 写正文、改写章节时的文风参考',
    cardMeta: '新建小说可选 · 文风参考',
    fieldGuide: '建议写清楚：叙事视角、句式风格、情绪表达、对话风格、描写风格、需要避免的写法。字段名直接用中文即可。',
    modalDescription: '选好这个文风模板后，AI 写正文时会照着它的风格来写，让全书文风保持统一。',
    placeholder: '{\n  "叙事视角": "第三人称近距",\n  "句式风格": "短句推进，少空泛总结",\n  "避免": ["空泛燃句", "模板化情绪"]\n}',
  },
  world: {
    entry: '新建小说时的「世界模板」下拉框',
    appliedTo: 'AI 生成背景、写章节时的世界设定参考',
    cardMeta: '新建小说可选 · 世界设定参考',
    fieldGuide: '建议写清楚：时代背景、科技或力量水平、社会结构、常见元素、不允许出现的元素。字段名直接用中文即可。',
    modalDescription: '选好这个世界模板后，AI 会基于它来生成背景和写章节，让世界设定前后一致。',
    placeholder: '{\n  "时代背景": "当代",\n  "科技水平": "现代城市基础设施",\n  "常见元素": ["职场压力", "社交媒体"]\n}',
  },
}

const FIELD_KEY_LABELS: Record<string, string> = {
  perspective: '叙事视角',
  sentence_style: '句式风格',
  emotion_style: '情绪表达',
  dialogue_style: '对话风格',
  description_style: '描写风格',
  forbidden: '避免',
  example_tone: '整体语气',
  time_period: '时代背景',
  technology_level: '科技水平',
  social_structure: '社会结构',
  common_elements: '常见元素',
  forbidden_elements: '禁止元素',
}

function toFieldLabel(key: string) {
  return FIELD_KEY_LABELS[key] || key
}

function summarizeTemplateContent(contentJson?: string) {
  if (!contentJson) return ''

  try {
    const parsed = JSON.parse(contentJson) as Record<string, unknown> | string | number | boolean | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return String(parsed ?? '').slice(0, 140)
    }

    return Object.entries(parsed)
      .slice(0, 3)
      .map(([key, value]) => {
        const label = toFieldLabel(key)
        if (Array.isArray(value)) return `${label}: ${value.slice(0, 3).join('、')}`
        if (value && typeof value === 'object') return `${label}: ${Object.keys(value).map(toFieldLabel).slice(0, 3).join(' / ')}`
        return `${label}: ${String(value ?? '').slice(0, 28)}`
      })
      .join(' · ')
  } catch {
    return contentJson.slice(0, 140)
  }
}

export default function TemplateManager() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('style')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)

  const loadTemplates = useCallback(async (showLoading = false) => {
    const requestId = ++loadRequestRef.current
    if (showLoading || !loadedOnceRef.current) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const list = await window.electron.template.list()
      if (loadRequestRef.current !== requestId) return
      setTemplates(list)
      loadedOnceRef.current = true
    } catch (error) {
      if (loadRequestRef.current === requestId) message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => { void loadTemplates(true) }, [loadTemplates])

  const filteredTemplates = templates.filter(t => t.type === activeTab)
  const builtinCount = templates.filter((template) => template.isBuiltin === 1).length
  const customCount = templates.length - builtinCount
  const activeUsage = TEMPLATE_USAGE[activeTab]
  const editingType = Form.useWatch('type', form) || activeTab
  const editingUsage = TEMPLATE_USAGE[editingType] || activeUsage

  const handleEdit = (tmpl: Template) => {
    let formattedContent = tmpl.contentJson || ''
    if (tmpl.contentJson) {
      try {
        formattedContent = JSON.stringify(JSON.parse(tmpl.contentJson), null, 2)
      } catch {
        formattedContent = tmpl.contentJson
      }
    }

    setEditing(tmpl)
    form.setFieldsValue({
      name: tmpl.name,
      type: tmpl.type,
      description: tmpl.description,
      contentJson: formattedContent,
    })
    setEditOpen(true)
  }

  const handleNew = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: activeTab })
    setEditOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      // 验证 JSON
      if (values.contentJson) {
        try {
          JSON.parse(values.contentJson)
        } catch {
          message.error(getUserFacingMessage('common.contentJsonInvalid'))
          setSaving(false)
          return
        }
      }

      if (editing) {
        await window.electron.template.update(editing.id, values)
      } else {
        await window.electron.template.create(values)
      }
      message.success(getUserFacingMessage('template.saved'))
      setEditOpen(false)
      form.resetFields()
      setEditing(null)
      await loadTemplates()
    } catch (error) {
      message.error(getErrorMessage(error, 'template.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tmpl: Template) => {
    if (tmpl.isBuiltin) { message.warning(getUserFacingMessage('template.builtinDeleteBlocked')); return }
    Modal.confirm({
      title: `确认删除「${tmpl.name}」？`,
      okType: 'danger',
      onOk: async () => {
        try {
          await window.electron.template.delete(tmpl.id)
          await loadTemplates()
          message.success(getUserFacingMessage('template.deleted'))
        } catch (e: unknown) {
          message.error(getErrorMessage(e, 'template.deleteFailed'))
        }
      },
    })
  }

  const tabItems = Object.entries(TYPE_LABELS).map(([key, label]) => ({
    key,
    label,
    children: (
      <div className="admin-card-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="template-manager-card template-manager-card--skeleton">
              <Skeleton active paragraph={{ rows: 4 }} />
            </Card>
          ))
        ) : filteredTemplates.length === 0 ? (
          <Empty description="暂无模板" style={{ gridColumn: '1/-1' }} />
        ) : (
          filteredTemplates.map((tmpl) => {
            const preview = summarizeTemplateContent(tmpl.contentJson)
            const usage = TEMPLATE_USAGE[tmpl.type]

            return (
              <Card key={tmpl.id} className="template-manager-card">
                <div className="template-manager-card__header">
                  <div className="template-manager-card__title-wrap">
                    <div className="template-manager-card__title-row">
                      <span className="template-manager-card__title">{tmpl.name}</span>
                      {tmpl.isBuiltin === 1 ? (
                        <Tag className="template-manager-card__tag" icon={<LockOutlined />}>内置</Tag>
                      ) : (
                        <Tag className="template-manager-card__tag template-manager-card__tag--custom">自定义</Tag>
                      )}
                    </div>
                    <div className="template-manager-card__meta">
                      {TYPE_LABELS[tmpl.type] || tmpl.type}
                      {usage ? ` · ${usage.cardMeta}` : ''}
                    </div>
                  </div>
                </div>
                <div className="template-manager-card__content">
                  <p className="template-manager-card__desc">
                    {tmpl.description || '未填写模板说明，建议补充用途、适用场景和关键约束。'}
                  </p>
                  {preview ? (
                    <div className="template-manager-card__preview">{preview}</div>
                  ) : null}
                </div>
                <div className="template-manager-card__footer">
                  <Button
                    className="template-manager-card__action template-manager-card__action--primary"
                    size="small"
                    icon={tmpl.isBuiltin ? <EyeOutlined /> : <EditOutlined />}
                    onClick={() => handleEdit(tmpl)}
                  >
                    {tmpl.isBuiltin ? '查看' : '编辑'}
                  </Button>
                  {!tmpl.isBuiltin && (
                    <Button
                      className="template-manager-card__action"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(tmpl)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>
    ),
  }))

  return (
    <>
      <WorkspacePage
        className="admin-page template-manager-page"
        layout="wide"
        heroVariant="compact"
        eyebrow="创作模板"
        title="文风与世界模板"
        description="这里管理新建小说时可以选用的文风模板和世界设定模板。选好模板后，AI 写正文和生成背景时会参考它，让全书的风格和设定保持统一。"
        actions={(
          <div className="admin-toolbar">
            <div className="novel-pill">{`当前查看：${TYPE_LABELS[activeTab]}`}</div>
            <div className="admin-toolbar__actions">
              <Button onClick={() => navigate('/novels')}>
                去新建小说
              </Button>
              <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void loadTemplates()}>
                刷新模板
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
                新建模板
              </Button>
            </div>
          </div>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="模板总数" value={templates.length} tone="cool" />
            <WorkspaceMetric label="内置模板" value={builtinCount} />
            <WorkspaceMetric label="自定义模板" value={customCount} tone="warm" />
            <WorkspaceMetric label="应用入口" value="新建小说" />
          </>
        )}
      >
        <WorkspacePanel
          title="模板目录"
          description="内置模板只能查看，自己新建的模板可以编辑或删除。模板用来在新建小说时一键套用一套固定的文风或世界设定。"
        >
          <div className="template-usage-overview">
            <div className="template-usage-overview__item">
              <span>在哪里选</span>
              <strong>{activeUsage.entry}</strong>
            </div>
            <div className="template-usage-overview__item">
              <span>用在哪里</span>
              <strong>{activeUsage.appliedTo}</strong>
            </div>
            <div className="template-usage-overview__item template-usage-overview__item--wide">
              <span>编辑提示</span>
              <strong>{activeUsage.fieldGuide}</strong>
            </div>
          </div>
          {refreshing ? (
            <div className="novel-dashboard__refresh-indicator" style={{ marginBottom: 16 }}>
              <Spin size="small" />
              <span>正在同步模板目录</span>
            </div>
          ) : null}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
          />
        </WorkspacePanel>
      </WorkspacePage>

      <Modal
        title={editing ? (editing.isBuiltin ? '查看模板' : '编辑模板') : '新建模板'}
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditing(null); form.resetFields() }}
        onOk={editing?.isBuiltin ? () => setEditOpen(false) : handleSave}
        okText={editing?.isBuiltin ? '关闭' : '保存'}
        confirmLoading={saving}
        width={700}
      >
        {editing?.isBuiltin === 1 ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            message="当前是内置模板"
            description="内置模板为只读资源，可查看结构和内容，但不能直接编辑。"
          />
        ) : null}
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={editingUsage.entry}
          description={editingUsage.modalDescription}
        />
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]} extra="会显示在新建小说弹窗的模板下拉框里。">
            <Input disabled={editing?.isBuiltin === 1} />
          </Form.Item>
          <Form.Item name="type" label="模板类型">
            <Select
              disabled={!!editing}
              options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述" extra="一句话说明这个模板适合什么题材和风格，会显示在卡片上。">
            <Input disabled={editing?.isBuiltin === 1} />
          </Form.Item>
          <Form.Item name="contentJson" label="内容（JSON 格式）" extra={editingUsage.fieldGuide}>
            <Input.TextArea
              rows={10}
              disabled={editing?.isBuiltin === 1}
              placeholder={editingUsage.placeholder}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
