import React, { useMemo, useState } from 'react'
import { Button, Tag, message, Input, Modal } from 'antd'
import { CopyOutlined, EditOutlined } from '@ant-design/icons'
import {
  PROMPT_CATALOG,
  PROMPT_CATEGORIES,
  type PromptCatalogEntry,
} from '../../shared/prompt-library'

function normalizePromptText(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
}

function looksLikePromptSource(text: string): boolean {
  return /renderPrompt\s*\(|sectionLines?\s*\(|PROMPT_CATALOG|=>\s*renderPrompt/.test(text)
}

function sanitizePromptText(text: string, fallback?: string): string {
  const normalized = normalizePromptText(text || '')
  if (!normalized) return normalizePromptText(fallback || '')

  if (fallback && looksLikePromptSource(normalized)) {
    const fallbackText = normalizePromptText(fallback)
    if (!looksLikePromptSource(fallbackText)) return fallbackText
  }

  return normalized
}

export default function PromptManager() {
  const [activeCategory, setActiveCategory] = useState('全部')
  const [searchText, setSearchText] = useState('')
  const [selectedPrompt, setSelectedPrompt] = useState<PromptCatalogEntry | null>(null)
  const [editingTemplate, setEditingTemplate] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [customOverrides, setCustomOverrides] = useState<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('novelforge-prompt-overrides') || '{}') as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([key, value]) => [key, normalizePromptText(value)]),
      )
    } catch {
      return {}
    }
  })

  const filteredPrompts = useMemo(() => {
    return PROMPT_CATALOG.filter((prompt) => {
      if (activeCategory !== '全部' && prompt.category !== activeCategory) return false
      if (!searchText) return true
      return prompt.name.includes(searchText) || prompt.description.includes(searchText)
    })
  }, [activeCategory, searchText])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(sanitizePromptText(text)).then(() => message.success('已复制到剪贴板'))
  }

  const handleEditSave = () => {
    if (!selectedPrompt) return
    const nextOverrides = { ...customOverrides, [selectedPrompt.key]: normalizePromptText(editingTemplate) }
    setCustomOverrides(nextOverrides)
    localStorage.setItem('novelforge-prompt-overrides', JSON.stringify(nextOverrides))
    setEditModalOpen(false)
    message.success('本地参考模板已保存')
  }

  const handleResetOverride = (key: string) => {
    const nextOverrides = { ...customOverrides }
    delete nextOverrides[key]
    setCustomOverrides(nextOverrides)
    localStorage.setItem('novelforge-prompt-overrides', JSON.stringify(nextOverrides))
    message.success('已恢复默认模板')
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: 'var(--color-text-primary)', margin: 0, marginBottom: 4 }}>提示词管理中心</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            查看和复制系统当前默认提示词 · 本地自定义仅作参考，不会改动实际运行时调用
          </div>
        </div>
        <Input.Search
          placeholder="搜索提示词..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {PROMPT_CATEGORIES.map(category => (
          <Tag
            key={category}
            onClick={() => setActiveCategory(category)}
            style={{
              cursor: 'pointer',
              padding: '4px 12px',
              fontSize: 13,
              background: activeCategory === category ? 'var(--color-blue-primary)' : 'transparent',
              border: `1px solid ${activeCategory === category ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
              color: activeCategory === category ? 'white' : 'var(--color-text-secondary)',
              borderRadius: 20,
            }}
          >
            {category}
          </Tag>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {filteredPrompts.map((prompt) => {
          const hasOverride = Boolean(customOverrides[prompt.key])
          const currentTemplate = sanitizePromptText(customOverrides[prompt.key] || prompt.template, prompt.template)

          return (
            <div
              key={prompt.key}
              style={{
                background: 'var(--color-bg-card)',
                border: `1px solid ${hasOverride ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
                borderRadius: 10,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text-primary)' }}>
                      {prompt.name}
                    </span>
                    {hasOverride && (
                      <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>
                        本地草稿
                      </Tag>
                    )}
                  </div>
                  <Tag
                    style={{
                      fontSize: 10,
                      padding: '0 6px',
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {prompt.category}
                  </Tag>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => handleCopy(currentTemplate)}
                    title="复制模板"
                  />
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setSelectedPrompt(prompt)
                      setEditingTemplate(currentTemplate)
                      setEditModalOpen(true)
                    }}
                    title="编辑本地参考模板"
                  />
                  {hasOverride && (
                    <Button
                      size="small"
                      onClick={() => handleResetOverride(prompt.key)}
                      title="恢复默认"
                      style={{ fontSize: 10 }}
                    >
                      重置
                    </Button>
                  )}
                </div>
              </div>

              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.7 }}>
                {prompt.description}
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>输入参数：</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {prompt.params.map((param) => (
                    <Tag
                      key={param.key}
                      style={{
                        fontSize: 10,
                        background: 'rgba(46,134,171,0.1)',
                        border: '1px solid rgba(46,134,171,0.25)',
                        color: 'var(--color-blue-light)',
                        padding: '1px 6px',
                      }}
                    >
                      {param.key}（{param.label}）
                    </Tag>
                  ))}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--color-bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'monospace',
                  maxHeight: 120,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                }}
              >
                {currentTemplate}
              </div>
            </div>
          )
        })}
      </div>

      <Modal
        title={`编辑本地参考模板：${selectedPrompt?.name || ''}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleEditSave}
        okText="保存本地草稿"
        width={760}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          这里保存的是本地参考文本，便于复制和比较。当前版本不会直接改动系统运行时提示词。
        </div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedPrompt?.params.map((param) => (
            <Tag
              key={param.key}
              style={{ fontSize: 11, cursor: 'pointer', color: 'var(--color-blue-light)' }}
              onClick={() => setEditingTemplate((prev) => `${prev}{${param.key}}`)}
            >
              + {`{${param.key}}`}
            </Tag>
          ))}
        </div>
        <Input.TextArea
          value={editingTemplate}
          onChange={e => setEditingTemplate(e.target.value)}
          rows={18}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </div>
  )
}
