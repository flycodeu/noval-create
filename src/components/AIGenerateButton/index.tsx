import React, { useState } from 'react'
import { Button, Modal, message } from 'antd'
import { CheckOutlined, RobotOutlined } from '@ant-design/icons'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import { cleanAiFieldText } from '../../utils/text'
import type { AiExecutionMode } from '../../shared/ai-execution'

type AttemptStatus = 'running' | 'retrying' | 'failed' | 'succeeded'

interface RetryConfig {
  max: number
  backoffMs?: number
  shouldRetry?: (error: unknown) => boolean
}

interface Props {
  label?: string
  intent?: 'generate' | 'complete' | 'repair' | 'review'
  buildMessages: () => { role: 'user' | 'assistant'; content: string }[]
  runGeneration?: (input: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    count: number
    modelConfigId?: number
    novelId?: number
    executionMode?: AiExecutionMode
  }) => Promise<string[]>
  drawCount?: number
  onResult: (content: string) => void
  modelConfigId?: number
  novelId?: number
  executionMode?: AiExecutionMode
  size?: 'small' | 'middle' | 'large'
  disabled?: boolean
  type?: 'default' | 'text' | 'primary' | 'dashed' | 'link'
  isJson?: boolean
  retry?: RetryConfig
  onAttemptChange?: (attempt: { current: number; max: number; status: AttemptStatus }) => void
}

function cleanOutput(text: string): string {
  return cleanAiFieldText(text)
}

function getDefaultLabel(intent: NonNullable<Props['intent']>) {
  if (intent === 'complete') return 'AI 补全'
  if (intent === 'repair') return 'AI 修复'
  if (intent === 'review') return 'AI 评审'
  return 'AI 生成'
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function hasRetryableMessage(messageText: string) {
  return /(timeout|timed out|network|fetch|socket|temporar|429|rate limit|503|502|504|econn|reset|unavailable|empty)/i.test(messageText)
}

function isRetryableGenerationError(error: unknown, shouldRetry?: RetryConfig['shouldRetry']) {
  if (shouldRetry) return shouldRetry(error)
  if (error instanceof Error) {
    return hasRetryableMessage(error.message)
  }
  if (error && typeof error === 'object') {
    const status = 'status' in error ? Number((error as { status?: unknown }).status) : NaN
    const code = 'code' in error ? String((error as { code?: unknown }).code || '') : ''
    const messageText = 'message' in error ? String((error as { message?: unknown }).message || '') : ''
    if (Number.isFinite(status) && (status === 429 || status >= 500)) return true
    return hasRetryableMessage(`${code} ${messageText}`)
  }
  return false
}

function resolveRetryConfig(intent: NonNullable<Props['intent']>, retry?: RetryConfig): RetryConfig | undefined {
  if (retry) return retry
  if (intent === 'repair') return { max: 2, backoffMs: 600 }
  return undefined
}

export default function AIGenerateButton({
  label,
  intent = 'generate',
  buildMessages,
  runGeneration,
  drawCount = 1,
  onResult,
  modelConfigId,
  novelId,
  executionMode,
  size = 'small',
  disabled,
  type = 'default',
  isJson = false,
  retry,
  onAttemptChange,
}: Props) {
  const resolvedLabel = label || getDefaultLabel(intent)
  const [loading, setLoading] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [picked, setPicked] = useState(0)
  const [retryAttempt, setRetryAttempt] = useState<{ current: number; max: number } | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setRetryAttempt(null)

    try {
      const messages = buildMessages()
      const count = Math.max(1, Math.min(drawCount, 3))
      const retryConfig = resolveRetryConfig(intent, retry)
      const maxRetries = Math.max(0, retryConfig?.max ?? 0)
      const totalAttempts = maxRetries + 1
      let rawOutputs: string[] = []
      let resolvedAttempt = 1

      for (let attemptIndex = 0; attemptIndex < totalAttempts; attemptIndex += 1) {
        const currentAttempt = attemptIndex + 1
        resolvedAttempt = currentAttempt
        onAttemptChange?.({
          current: currentAttempt,
          max: totalAttempts,
          status: attemptIndex === 0 ? 'running' : 'retrying',
        })

        try {
          rawOutputs = runGeneration
            ? await runGeneration({ messages, count, modelConfigId, novelId, executionMode })
            : await window.electron.ai.runPrompt({ messages, count, modelConfigId, novelId, executionMode })
          if (!Array.isArray(rawOutputs) || rawOutputs.length === 0 || rawOutputs.every((output) => !String(output || '').trim())) {
            throw new Error(getUserFacingMessage('aiGenerate.empty'))
          }
          break
        } catch (error) {
          const canRetry = attemptIndex < maxRetries && isRetryableGenerationError(error, retryConfig?.shouldRetry)
          if (!canRetry) {
            onAttemptChange?.({
              current: currentAttempt,
              max: totalAttempts,
              status: 'failed',
            })
            throw error
          }

          const nextRetryAttempt = attemptIndex + 1
          setRetryAttempt({ current: nextRetryAttempt, max: maxRetries })
          onAttemptChange?.({
            current: currentAttempt,
            max: totalAttempts,
            status: 'retrying',
          })
          await sleep((retryConfig?.backoffMs ?? 600) * (2 ** attemptIndex))
        }
      }

      setRetryAttempt(null)
      onAttemptChange?.({
        current: resolvedAttempt,
        max: totalAttempts,
        status: 'succeeded',
      })
      const outputs = rawOutputs
        .map((output) => {
          const normalized = String(output || '').trim()
          return isJson ? normalized : cleanOutput(normalized)
        })
        .filter(Boolean)

      if (outputs.length === 0) {
        throw new Error(getUserFacingMessage('aiGenerate.empty'))
      }

      if (count === 1 || outputs.length <= 1) {
        onResult(outputs[0])
        message.success(getUserFacingMessage('aiGenerate.filled'))
        return
      }

      setResults(outputs)
      setPicked(0)
      setPickOpen(true)
    } catch (error) {
      setRetryAttempt(null)
      message.error(getUserFacingMessage('aiGenerate.failed', {
        detail: error instanceof Error ? error.message : getUserFacingMessage('writing.configureModelFirst'),
      }))
    } finally {
      setRetryAttempt(null)
      setLoading(false)
    }
  }

  const handleConfirmPick = () => {
    const selected = results[picked]
    if (!selected) {
      message.error(getUserFacingMessage('aiGenerate.empty'))
      return
    }
    onResult(selected)
    setPickOpen(false)
    setResults([])
    message.success(getUserFacingMessage('aiGenerate.picked'))
  }

  return (
    <>
      <Button
        size={size}
        type={type}
        icon={<RobotOutlined />}
        loading={loading}
        disabled={disabled}
        onClick={handleGenerate}
      >
        {retryAttempt
          ? `${resolvedLabel} · 重试中 (${retryAttempt.current}/${retryAttempt.max})`
          : drawCount > 1
            ? `${resolvedLabel} ×${drawCount}`
            : resolvedLabel}
      </Button>

      <Modal
        title="选择 AI 候选草稿"
        open={pickOpen}
        onCancel={() => setPickOpen(false)}
        onOk={handleConfirmPick}
        okText={<><CheckOutlined /> 填入所选</>}
        width={Math.min(900, Math.max(420, results.length * 320 + 48))}
        destroyOnHidden
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${results.length}, 1fr)`,
            gap: 12,
            marginTop: 8,
          }}
        >
          {results.map((result, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setPicked(index)}
              style={{
                border: `2px solid ${picked === index ? 'var(--accent)' : 'var(--border-default)'}`,
                borderRadius: 8,
                padding: '10px 14px',
                cursor: 'pointer',
                background: picked === index ? 'rgba(46,134,171,0.06)' : 'var(--bg-hover)',
                transition: 'border-color 0.15s, background 0.15s',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: picked === index ? 'var(--accent)' : 'var(--text-muted)',
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                {picked === index ? '当前选择' : `候选 ${index + 1}`}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 260,
                  overflow: 'auto',
                }}
              >
                {result}
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}
