import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Tabs, Button, Modal, Form, Input, Select, Card, Tag, message, Empty, Skeleton, Spin
} from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Template } from '../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'
import './index.css'
import JsonViewer from '../../components/JsonViewer'

const TYPE_LABELS: Record<string, string> = {
  style: '文风模板',
  world: '世界观模板',
}
const TEMPLATE_USAGE: Record<string, {
  entry: string
  appliedTo: string
  fieldGuide: string
  placeholder: string
}> = {
  style: {
    entry: '新建小说时的「文风模板」下拉框',
    appliedTo: 'AI 写正文、改写章节时的文风参考',
    fieldGuide: '建议写清楚：叙事视角、句式风格、情绪表达、对话风格、描写风格、需要避免的写法。字段名直接用中文即可。',
    placeholder: '{\n  "叙事视角": "第三人称近距",\n  "句式风格": "短句推进，少空泛总结",\n  "避免": ["空泛燃句", "模板化情绪"]\n}',
  },
  world: {
    entry: '新建小说时的「世界模板」下拉框',
    appliedTo: 'AI 生成背景、写章节时的世界设定参考',
    fieldGuide: '建议写清楚：时代背景、科技或力量水平、社会结构、常见元素、不允许出现的元素。字段名直接用中文即可。',
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
  const [activeTab, setActiveTab] = useState('style')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const saveInFlightRef = useRef(false)
  const dirtyRef = useRef(false)

  const read = useCallback(() => window.electron.template.list(), [])
  const { data, loading: pending, error, reload: loadTemplates } = useAsyncSnapshot(read)
  const templates = data ?? []
  const loading = pending && data === null
  const refreshing = pending && data !== null
  useEffect(() => {
    if (error) message.error(getErrorMessage(error, 'common.loadFailed'))
  }, [error])

  const builtinCount = templates.filter((template) => template.isBuiltin === 1).length
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
    dirtyRef.current = false
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: activeTab })
    setEditOpen(true)
  }

  const handleSave = async () => {
    if (saveInFlightRef.current || editing?.isBuiltin) return
    saveInFlightRef.current = true
    setSaving(true)
    try {
      const values = await form.validateFields().catch(() => null)
      if (!values) return
      values.name = values.name.trim()
      if (values.contentJson) {
        try {
          JSON.parse(values.contentJson)
        } catch {
          message.error(getUserFacingMessage('common.contentJsonInvalid'))
          return
        }
      }

      if (editing) {
        await window.electron.template.update(editing.id, values)
      } else {
        await window.electron.template.create(values)
      }
      message.success(getUserFacingMessage('template.saved'))
      dirtyRef.current = false
      setEditOpen(false)
      form.resetFields()
      setEditing(null)
      await loadTemplates()
    } catch (error) {
      message.error(getErrorMessage(error, 'template.saveFailed'))
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }

  const closeEditor = () => {
    if (saveInFlightRef.current) return
    const close = () => {
      dirtyRef.current = false
      setEditOpen(false)
      setEditing(null)
      form.resetFields()
    }
    if (dirtyRef.current && !editing?.isBuiltin) {
      Modal.confirm({ title: '放弃尚未保存的模板修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: close })
    } else close()
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
          throw e
        }
      },
    })
  }

  const tabItems = Object.entries(TYPE_LABELS).map(([key, label]) => ({
    key,
    label,
    children: (
      <div className="admin-card-grid" data-p3-04-template-grid>
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="template-manager-card template-manager-card--skeleton">
              <Skeleton active paragraph={{ rows: 4 }} />
            </Card>
          ))
        ) : templates.filter(t => t.type === key).length === 0 ? (
          <Empty description="暂无模板" style={{ gridColumn: '1/-1' }} />
        ) : (
          templates.filter(t => t.type === key).map((tmpl) => {
            const preview = summarizeTemplateContent(tmpl.contentJson)

            return (
              <Card key={tmpl.id} className="template-manager-card" data-template-builtin={tmpl.isBuiltin === 1 ? 'true' : 'false'}>
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
                  </div>
                </div>
                <div className="template-manager-card__content">
                  {tmpl.description ? <p className="template-manager-card__desc">{tmpl.description}</p> : null}
                  {preview ? (
                    <div className="template-manager-card__preview">{preview}</div>
                  ) : null}
                </div>
                <div className="template-manager-card__footer">
                  <Button
                    className="template-manager-card__action template-manager-card__action--primary"
                    size="small"
                    icon={tmpl.isBuiltin ? <EyeOutlined /> : <EditOutlined />}
                    aria-label={tmpl.isBuiltin ? `查看内置模板 ${tmpl.name}` : `编辑模板 ${tmpl.name}`}
                    onClick={() => { dirtyRef.current = false; handleEdit(tmpl) }}
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
        title="文风与世界模板"
        actions={(
          <div className="admin-toolbar">
            <div className="admin-toolbar__actions">
              <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void loadTemplates()}>
                刷新模板
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
                新建模板
              </Button>
            </div>
          </div>
        )}
      >
        <WorkspacePanel
          extra={<div className="template-manager-catalog-actions"><span>{templates.length} 个模板 · {builtinCount} 个内置</span><Button type="text" onClick={() => navigate('/novels')}>去新建小说</Button></div>}
        >
          <details className="template-usage-details">
            <summary>用途与编辑提示</summary>
            <p>{activeUsage.entry} · {activeUsage.appliedTo}</p>
            <p>{activeUsage.fieldGuide}</p>
          </details>
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
        forceRender
        onCancel={closeEditor}
        onOk={editing?.isBuiltin ? closeEditor : handleSave}
        okText={editing?.isBuiltin ? '关闭' : '保存'}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving, style: editing?.isBuiltin ? { display: 'none' } : undefined }}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        width="min(700px, calc(100vw - 32px))"
      >
        {editing?.isBuiltin === 1 ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            message="内置模板为只读资源，不可直接编辑。"
          />
        ) : null}
        <Form form={form} layout="vertical" disabled={saving} onValuesChange={() => { dirtyRef.current = true }}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, whitespace: true }]}>
            <Input disabled={editing?.isBuiltin === 1} />
          </Form.Item>
          <Form.Item name="type" label="模板类型">
            <Select
              disabled={!!editing}
              options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input disabled={editing?.isBuiltin === 1} />
          </Form.Item>
          {editing?.isBuiltin === 1 ? <Form.Item label="模板内容"><JsonViewer raw={editing.contentJson} label="模板" /></Form.Item> : <Form.Item name="contentJson" label="内容（JSON 格式）">
            <Input.TextArea
              rows={10}
              disabled={editing?.isBuiltin === 1}
              placeholder={editingUsage.placeholder}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>}
        </Form>
      </Modal>
    </>
  )
}
