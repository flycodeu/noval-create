import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Tabs, Button, Modal, Form, Input, Select, Card, Tag, message, Empty, Skeleton, Spin
} from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons'
import { Template } from '../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'

const TYPE_LABELS: Record<string, string> = {
  style: '文风模板',
  world: '世界观模板',
  writing_step: '步骤提示词',
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
        if (Array.isArray(value)) return `${key}: ${value.slice(0, 3).join('、')}`
        if (value && typeof value === 'object') return `${key}: ${Object.keys(value).slice(0, 3).join(' / ')}`
        return `${key}: ${String(value ?? '').slice(0, 28)}`
      })
      .join(' · ')
  } catch {
    return contentJson.slice(0, 140)
  }
}

export default function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('style')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const loadedOnceRef = useRef(false)

  const loadTemplates = useCallback(async (showLoading = false) => {
    if (showLoading || !loadedOnceRef.current) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const list = await window.electron.template.list()
      setTemplates(list)
      loadedOnceRef.current = true
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void loadTemplates(true) }, [loadTemplates])

  const filteredTemplates = templates.filter(t => t.type === activeTab)
  const builtinCount = templates.filter((template) => template.isBuiltin === 1).length
  const customCount = templates.length - builtinCount

  const handleEdit = (tmpl: Template) => {
    setEditing(tmpl)
    form.setFieldsValue({
      name: tmpl.name,
      type: tmpl.type,
      description: tmpl.description,
      contentJson: tmpl.contentJson ? JSON.stringify(JSON.parse(tmpl.contentJson), null, 2) : '',
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
    const values = await form.validateFields()
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
          message.success('模板已删除')
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
                    <div className="template-manager-card__meta">{TYPE_LABELS[tmpl.type] || tmpl.type}</div>
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
        eyebrow="复用资产"
        title="模板系统"
        description="统一维护文风模板、世界观模板和运行辅助模板，区分内置模板与可编辑自定义模板。"
        actions={(
          <div className="admin-toolbar">
            <div className="novel-pill">{`当前查看：${TYPE_LABELS[activeTab]}`}</div>
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
        metrics={(
          <>
            <WorkspaceMetric label="模板总数" value={templates.length} tone="cool" />
            <WorkspaceMetric label="内置模板" value={builtinCount} />
            <WorkspaceMetric label="自定义模板" value={customCount} tone="warm" />
            <WorkspaceMetric label="当前分类" value={TYPE_LABELS[activeTab]} />
          </>
        )}
      >
        <WorkspacePanel
          title="模板目录"
          description="内置模板只读，自定义模板可以直接编辑或删除。切换标签后会同步筛选当前卡片列表。"
        >
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
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
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
          <Form.Item name="contentJson" label="内容（JSON 格式）">
            <Input.TextArea
              rows={10}
              disabled={editing?.isBuiltin === 1}
              placeholder='{"key": "value"}'
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
