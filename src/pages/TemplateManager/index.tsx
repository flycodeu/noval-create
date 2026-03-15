import React, { useEffect, useState, useCallback } from 'react'
import {
  Tabs, Button, Modal, Form, Input, Select, Card, Tag, message, Empty, Tooltip
} from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, LockOutlined } from '@ant-design/icons'
import { Template } from '../../types'

const TYPE_LABELS: Record<string, string> = {
  style: '文风模板',
  world: '世界观模板',
  writing_step: '步骤提示词',
}

export default function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [activeTab, setActiveTab] = useState('style')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const loadTemplates = useCallback(async () => {
    const list = await window.electron.template.list()
    setTemplates(list)
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const filteredTemplates = templates.filter(t => t.type === activeTab)

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
          message.error('内容 JSON 格式错误')
          setSaving(false)
          return
        }
      }

      if (editing) {
        await window.electron.template.update(editing.id, values)
      } else {
        await window.electron.template.create(values)
      }
      message.success('已保存')
      setEditOpen(false)
      form.resetFields()
      setEditing(null)
      loadTemplates()
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tmpl: Template) => {
    if (tmpl.isBuiltin) { message.warning('内置模板不可删除'); return }
    Modal.confirm({
      title: `确认删除「${tmpl.name}」？`,
      okType: 'danger',
      onOk: async () => {
        try {
          await window.electron.template.delete(tmpl.id)
          loadTemplates()
        } catch (e: unknown) {
          message.error(e instanceof Error ? e.message : '删除失败')
        }
      },
    })
  }

  const tabItems = Object.entries(TYPE_LABELS).map(([key, label]) => ({
    key,
    label,
    children: (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filteredTemplates.length === 0 ? (
          <Empty description="暂无模板" style={{ gridColumn: '1/-1' }} />
        ) : (
          filteredTemplates.map(tmpl => (
            <Card
              key={tmpl.id}
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--border-color)' }}
              actions={[
                <Tooltip title={tmpl.isBuiltin ? '内置模板只读' : '编辑'} key="edit">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(tmpl)}
                  >
                    {tmpl.isBuiltin ? '查看' : '编辑'}
                  </Button>
                </Tooltip>,
                !tmpl.isBuiltin && (
                  <Button
                    key="delete"
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDelete(tmpl)}
                  >
                    删除
                  </Button>
                ),
              ].filter(Boolean)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{tmpl.name}</span>
                {tmpl.isBuiltin === 1 && (
                  <Tag icon={<LockOutlined />} style={{ fontSize: 10 }}>内置</Tag>
                )}
              </div>
              {tmpl.description && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                  {tmpl.description}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    ),
  }))

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ color: 'var(--color-text-primary)', margin: 0 }}>模板系统</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
          新建模板
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />

      <Modal
        title={editing ? (editing.isBuiltin ? '查看模板' : '编辑模板') : '新建模板'}
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditing(null); form.resetFields() }}
        onOk={editing?.isBuiltin ? () => setEditOpen(false) : handleSave}
        okText={editing?.isBuiltin ? '关闭' : '保存'}
        confirmLoading={saving}
        width={700}
      >
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
    </div>
  )
}
