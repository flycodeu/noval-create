import React, { useState } from 'react'
import { Button, Modal, message } from 'antd'
import { RobotOutlined, CheckOutlined } from '@ant-design/icons'
import { cleanAiFieldText } from '../../utils/text'

/** 后处理：去除 Markdown 格式 + 引号着重，返回纯净文本 */
function cleanAIOutput(text: string): string {
  return cleanAiFieldText(text)
}

interface Props {
  label?: string
  /** 构建消息的函数，调用时生成提示词 */
  buildMessages: () => { role: 'user' | 'assistant'; content: string }[]
  /** 自定义生成执行器，返回抽卡候选结果；未提供时默认调用 ai.runPrompt */
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
  /** 是否自动去除 Markdown 格式标记（默认 true，JSON 内容设 false） */
  isJson?: boolean
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
      // 去除 Markdown 格式 + 引号着重（JSON 内容跳过清理）
      const outputs = isJson ? rawOutputs : rawOutputs.map(cleanAIOutput)

      if (count <= 1 || outputs.length === 1) {
        onResult(outputs[0])
        message.success('AI 生成完成')
      } else {
        setResults(outputs)
        setPicked(0)
        setPickOpen(true)
      }
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : '请先配置 AI 模型'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmPick = () => {
    onResult(results[picked])
    setPickOpen(false)
    setResults([])
    message.success('已填入选中结果')
  }

  const buttonLabel = drawCount > 1 ? `${label} ×${drawCount}` : label

  return (
    <>
      <Button
        size={size}
        type={type}
        icon={<RobotOutlined />}
        loading={loading}
        onClick={handleGenerate}
        disabled={disabled}
      >
        {buttonLabel}
      </Button>

      <Modal
        title={
          <span>
            抽卡结果&nbsp;
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 400 }}>
              — 共 {results.length} 个，请选择
            </span>
          </span>
        }
        open={pickOpen}
        onCancel={() => setPickOpen(false)}
        onOk={handleConfirmPick}
        okText={<><CheckOutlined /> 填入选中</>}
        width={Math.min(900, results.length * 340 + 48)}
        destroyOnHidden
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${results.length}, 1fr)`,
          gap: 12,
          marginTop: 8,
        }}>
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => setPicked(i)}
              style={{
                border: `2px solid ${picked === i ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
                borderRadius: 8,
                padding: '10px 14px',
                cursor: 'pointer',
                background: picked === i ? 'rgba(46,134,171,0.06)' : 'var(--color-bg-hover)',
                transition: 'border-color 0.15s, background 0.15s',
                position: 'relative',
              }}
            >
              <div style={{
                fontSize: 11,
                color: picked === i ? 'var(--color-blue-primary)' : 'var(--color-text-muted)',
                marginBottom: 8,
                fontWeight: 600,
              }}>
                {picked === i ? '✓ ' : ''}结果 {i + 1}
              </div>
              <div style={{
                fontSize: 12,
                color: 'var(--color-text-primary)',
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                maxHeight: 260,
                overflow: 'auto',
              }}>
                {r}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
