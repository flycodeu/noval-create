import { useEffect, useState } from 'react'
import { Alert, Button, Input, Space, message } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import type { AiPatchResult, AiPatchTarget } from '../../../types'
import { getErrorMessage } from '@/utils/user-facing-message'
import './ai-patch-editor.css'

interface AiPatchEditorProps {
  target: AiPatchTarget | null
  title?: string
  description?: string
  placeholder?: string
  disabled?: boolean
  compact?: boolean
  onApplied?: (result: unknown, patch: AiPatchResult) => void | Promise<void>
}

export default function AiPatchEditor({
  target,
  title = '定向 AI 修改',
  description = '输入自然语言要求，AI 只生成字段级补丁；确认后才写入。',
  placeholder = '例如：强化它和当前主线的关联，保留名称和基本定位，只补需要改的字段。',
  disabled,
  compact,
  onApplied,
}: AiPatchEditorProps) {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<AiPatchResult | null>(null)

  useEffect(() => {
    setInstruction('')
    setResult(null)
  }, [target?.type, target?.id, target?.sectionKey])

  const suggestPatch = async () => {
    if (!target || !instruction.trim()) return
    setLoading(true)
    try {
      const next = await window.electron.aiPatch.suggest({ target, instruction: instruction.trim() })
      setResult(next)
      if (next.changedFields.length === 0) {
        message.warning('AI 没有生成可应用字段修改。')
      }
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const applyPatch = async () => {
    if (!target || !result || result.changedFields.length === 0) return
    setApplying(true)
    try {
      const applied = await window.electron.aiPatch.apply(result.target || target, result.patch)
      await onApplied?.(applied, result)
      setResult(null)
      setInstruction('')
      message.success('已应用 AI 修改。')
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className={`novel-ai-patch-editor${compact ? ' novel-ai-patch-editor--compact' : ''}`}>
      <div className="novel-ai-patch-editor__head">
        <div>
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        <Button
          icon={<MessageOutlined />}
          loading={loading}
          disabled={disabled || !target || !instruction.trim()}
          onClick={() => void suggestPatch()}
        >
          生成修改建议
        </Button>
      </div>
      <Input.TextArea
        rows={compact ? 2 : 3}
        value={instruction}
        disabled={disabled || !target}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder={placeholder}
      />
      {result ? (
        <div className="novel-ai-patch-editor__result">
          <div className="novel-ai-patch-editor__summary">
            <span>{result.summary}</span>
            <Button
              type="primary"
              size="small"
              loading={applying}
              disabled={disabled || result.changedFields.length === 0}
              onClick={() => void applyPatch()}
            >
              应用修改
            </Button>
          </div>
          {result.warnings.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="应用前注意"
              description={result.warnings.join('；')}
            />
          ) : null}
          <div className="novel-ai-patch-editor__diffs">
            {result.changedFields.length === 0 ? (
              <div className="novel-empty">没有字段变化。</div>
            ) : result.changedFields.map((change) => (
              <div key={`${change.field}-${change.label}`} className="novel-ai-patch-diff">
                <strong>{change.label}</strong>
                <div className="novel-ai-patch-diff__body">
                  <span>{change.before || '空'}</span>
                  <span>{change.after || '空'}</span>
                </div>
              </div>
            ))}
          </div>
          <Space className="novel-ai-patch-editor__foot">
            <Button size="small" onClick={() => setResult(null)}>丢弃建议</Button>
          </Space>
        </div>
      ) : null}
    </div>
  )
}
