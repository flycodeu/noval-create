import React, { useState } from 'react'
import { Button, Modal, message } from 'antd'
import { CheckOutlined, RobotOutlined } from '@ant-design/icons'
import { cleanAiFieldText } from '../../utils/text'

interface Props {
  label?: string
  buildMessages: () => { role: 'user' | 'assistant'; content: string }[]
  runGeneration?: (input: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    count: number
    modelConfigId?: number
  }) => Promise<string[]>
  drawCount?: number
  onResult: (content: string) => void
  modelConfigId?: number
  size?: 'small' | 'middle' | 'large'
  disabled?: boolean
  type?: 'default' | 'text' | 'primary' | 'dashed' | 'link'
  isJson?: boolean
}

function cleanOutput(text: string): string {
  return cleanAiFieldText(text)
}

export default function AIGenerateButton({
  label = 'AI 生成',
  buildMessages,
  runGeneration,
  drawCount = 1,
  onResult,
  modelConfigId,
  size = 'small',
  disabled,
  type = 'default',
  isJson = false,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [picked, setPicked] = useState(0)

  const handleGenerate = async () => {
    setLoading(true)

    try {
      const messages = buildMessages()
      const count = Math.max(1, Math.min(drawCount, 3))
      const rawOutputs = runGeneration
        ? await runGeneration({ messages, count, modelConfigId })
        : await window.electron.ai.runPrompt({ messages, count, modelConfigId })
      const outputs = isJson ? rawOutputs : rawOutputs.map(cleanOutput)

      if (count === 1 || outputs.length <= 1) {
        onResult(outputs[0])
        message.success('AI 草稿已填入。')
        return
      }

      setResults(outputs)
      setPicked(0)
      setPickOpen(true)
    } catch (error) {
      message.error(`生成失败：${error instanceof Error ? error.message : '请先检查 AI 模型配置。'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmPick = () => {
    onResult(results[picked])
    setPickOpen(false)
    setResults([])
    message.success('已填入所选草稿。')
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
        {drawCount > 1 ? `${label} ×${drawCount}` : label}
      </Button>

      <Modal
        title="选择草稿"
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
                border: `2px solid ${picked === index ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
                borderRadius: 8,
                padding: '10px 14px',
                cursor: 'pointer',
                background: picked === index ? 'rgba(46,134,171,0.06)' : 'var(--color-bg-hover)',
                transition: 'border-color 0.15s, background 0.15s',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: picked === index ? 'var(--color-blue-primary)' : 'var(--color-text-muted)',
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                {picked === index ? '当前选择' : `候选 ${index + 1}`}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-primary)',
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
