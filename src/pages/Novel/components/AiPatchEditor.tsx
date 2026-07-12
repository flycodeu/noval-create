import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Space, message } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import type { AiPatchResult, AiPatchTarget } from '../../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
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
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<AiPatchResult | null>(null)
  const operationRequestRef = useRef(0)

  useEffect(() => {
    operationRequestRef.current += 1
    setOpen(false)
    setInstruction('')
    setResult(null)
    setLoading(false)
    setApplying(false)
  }, [target?.type, target?.id, target?.sectionKey])

  const suggestPatch = async () => {
    if (!target || !instruction.trim()) return
    const requestId = ++operationRequestRef.current
    setLoading(true)
    try {
      const next = await window.electron.aiPatch.suggest({ target, instruction: instruction.trim() })
      if (operationRequestRef.current !== requestId) return
      setResult(next)
      if (next.changedFields.length === 0) {
        message.warning(getUserFacingMessage('aiPatch.noApplicableChanges'))
      }
    } catch (error) {
      if (operationRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (operationRequestRef.current === requestId) setLoading(false)
    }
  }

  const applyPatch = async () => {
    if (!target || !result || result.changedFields.length === 0) return
    const requestId = ++operationRequestRef.current
    setApplying(true)
    try {
      const applied = await window.electron.aiPatch.apply(result.target || target, result.patch)
      if (operationRequestRef.current !== requestId) return
      await onApplied?.(applied, result)
      if (operationRequestRef.current !== requestId) return
      setResult(null)
      setInstruction('')
      setOpen(false)
      message.success(getUserFacingMessage('aiPatch.applied'))
    } catch (error) {
      if (operationRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      if (operationRequestRef.current === requestId) setApplying(false)
    }
  }

  return (
    <>
      <Button
        icon={<MessageOutlined />}
        disabled={disabled || !target}
        size={compact ? 'small' : 'middle'}
        onClick={() => setOpen(true)}
      >
        {title}
      </Button>
      <Modal
        title={title}
        open={open}
        width={760}
        footer={null}
        maskClosable={!applying}
        closable={!applying}
        onCancel={() => {
          if (applying) return
          operationRequestRef.current += 1
          setLoading(false)
          setOpen(false)
        }}
      >
        <div className={`novel-ai-patch-editor${compact ? ' novel-ai-patch-editor--compact' : ''}`}>
          <div className="novel-ai-patch-editor__head">
            <div>
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
      </Modal>
    </>
  )
}
