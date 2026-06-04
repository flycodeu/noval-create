import React, { useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, Space, Tag, Tooltip, message } from 'antd'
import {
  CheckOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  SendOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import type { Novel } from '../../../types'
import type { GuidedWorkflowStepKey } from '../workflow'
import type { DraftContextSection, DraftFieldDefinition } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { cleanAiValue } from '../../../utils/text'
import './StepAIAssistant.css'

type ChatRole = 'user' | 'assistant'

interface StepAssistantMessage {
  role: ChatRole
  content: string
}

interface StepAssistantTool {
  id: string
  label: string
  description: string
}

export interface StepAIAssistantPatch {
  [key: string]: string | number | string[] | undefined
}

interface StepAIAssistantDraft {
  assistantMessage: string
  draftPatch: StepAIAssistantPatch
  toolCalls: Array<{ tool: string; reason: string }>
  checks: string[]
  suggestions: string[]
}

interface StepAIAssistantProps<TPatch extends StepAIAssistantPatch> {
  novel: Novel | null | undefined
  novelId: number
  stepKey: GuidedWorkflowStepKey
  stepTitle: string
  fields: DraftFieldDefinition[]
  values: TPatch
  tools: StepAssistantTool[]
  extraContext?: DraftContextSection[]
  onApplyDraft: (patch: Partial<TPatch>) => void
}

const DEFAULT_USER_PROMPT = '我只有一个大概想法，请补齐这一步能用的基础信息。'

function formatValue(value?: string | number | string[] | null): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '未填写'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '未填写'
  return value?.trim() || '未填写'
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error('AI 没有返回可解析的 JSON。')
  }
  return trimmed.slice(start, end + 1)
}

function normalizeDraft(raw: string, allowedKeys: string[]): StepAIAssistantDraft {
  const parsed = cleanAiValue(JSON.parse(extractJsonObject(raw))) as Record<string, unknown>
  const rawPatch = parsed.draftPatch && typeof parsed.draftPatch === 'object'
    ? parsed.draftPatch as Record<string, unknown>
    : {}
  const allowed = new Set(allowedKeys)
  const draftPatch = Object.fromEntries(
    Object.entries(rawPatch)
      .filter(([key]) => allowed.has(key))
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || Array.isArray(value)),
  ) as StepAIAssistantPatch

  const toolCalls = Array.isArray(parsed.toolCalls)
    ? parsed.toolCalls
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        tool: typeof item.tool === 'string' ? item.tool : 'unknown',
        reason: typeof item.reason === 'string' ? item.reason : '',
      }))
    : []

  return {
    assistantMessage: typeof parsed.assistantMessage === 'string' ? parsed.assistantMessage.trim() : '已生成候选补丁。',
    draftPatch,
    toolCalls,
    checks: Array.isArray(parsed.checks) ? parsed.checks.filter((item): item is string => typeof item === 'string') : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((item): item is string => typeof item === 'string') : [],
  }
}

function buildAssistantPrompt(input: {
  stepTitle: string
  userRequest: string
  fields: DraftFieldDefinition[]
  context: DraftContextSection[]
  values: StepAIAssistantPatch
  tools: StepAssistantTool[]
  history: StepAssistantMessage[]
}) {
  const contextBlock = input.context
    .filter((section) => formatValue(section.value) !== '未填写')
    .map((section) => `- ${section.label}：${formatValue(section.value)}`)
    .join('\n')
  const fieldBlock = input.fields
    .map((field) => [
      `- ${field.label}（${field.key}）`,
      `  当前值：${formatValue(input.values[field.key])}`,
      field.hint ? `  字段要求：${field.hint}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n')
  const toolBlock = input.tools
    .map((tool) => `- ${tool.id}：${tool.label}。${tool.description}`)
    .join('\n')
  const historyBlock = input.history
    .slice(-8)
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`)
    .join('\n')
  const skeleton = `{
  "assistantMessage": "给用户看的简短回复",
  "toolCalls": [{"tool": "read_step_context", "reason": "为什么需要"}],
  "draftPatch": {
${input.fields.map((field) => `    "${field.key}": ${field.type === 'number' ? '0' : field.type === 'string[]' ? '[]' : '""'}`).join(',\n')}
  },
  "checks": ["质量自检"],
  "suggestions": ["下一步建议"]
}`

  return [
    `你是 NovelForge 本地写作工作区里的步骤 AI 助手，正在协助「${input.stepTitle}」。`,
    '你的目标是把用户的模糊想法转成可回填的结构化草稿，也可以按用户要求只更新指定字段。',
    contextBlock ? `当前小说上下文：\n${contextBlock}` : '',
    `当前步骤字段：\n${fieldBlock}`,
    `本步骤允许使用的工具能力：\n${toolBlock}`,
    historyBlock ? `最近对话：\n${historyBlock}` : '',
    `用户这次的要求：${input.userRequest}`,
    [
      '硬性规则：',
      '- 只输出 JSON 对象，不要 Markdown，不要解释性外壳。',
      '- draftPatch 只能包含上面列出的字段键；用户要求只改某字段时，其它字段保持当前值或留空。',
      '- 如果用户给的信息不足，可以合理补全，但要让补全落在目标、阻力、代价、环境压力和人物选择上。',
      '- 避免 AI 腔：不要写命运齿轮、灵魂深处、某种无法言说、真正的成长、不是……而是……等模板表达。',
      '- 不要使用“以下是、我将、作为AI、修订建议、思考过程”等工作流文字作为字段内容。',
      '- 中文要自然克制，像给作者的策划草稿，不像广告文案。',
    ].join('\n'),
    `请严格按这个 JSON 结构输出：\n${skeleton}`,
  ].filter(Boolean).join('\n\n')
}

function getPatchEntries(fields: DraftFieldDefinition[], draft: StepAIAssistantDraft | null) {
  if (!draft) return []
  return fields
    .map((field) => ({
      field,
      value: draft.draftPatch[field.key],
    }))
    .filter((item) => item.value !== undefined && formatValue(item.value) !== '未填写')
}

export default function StepAIAssistant<TPatch extends StepAIAssistantPatch>({
  novel,
  novelId,
  stepKey,
  stepTitle,
  fields,
  values,
  tools,
  extraContext = [],
  onApplyDraft,
}: StepAIAssistantProps<TPatch>) {
  const [input, setInput] = useState(DEFAULT_USER_PROMPT)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<StepAIAssistantDraft | null>(null)
  const [messages, setMessages] = useState<StepAssistantMessage[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>(fields.map((field) => field.key))

  const context = useMemo(
    () => buildPlanningContextSections(novel, {
      includeSubplots: true,
      includeWorldRules: true,
      extraSections: extraContext,
    }),
    [extraContext, novel],
  )
  const patchEntries = getPatchEntries(fields, draft)

  const handleAsk = async () => {
    const userRequest = input.trim()
    if (!userRequest) return

    setLoading(true)
    const nextMessages = [...messages, { role: 'user' as const, content: userRequest }]

    try {
      const prompt = buildAssistantPrompt({
        stepTitle,
        userRequest,
        fields,
        context,
        values,
        tools,
        history: messages,
      })
      const outputs = await window.electron.ai.runPrompt({
        novelId,
        count: 1,
        executionMode: 'balanced',
        messages: [{ role: 'user', content: prompt }],
      })
      const parsed = normalizeDraft(outputs[0] || '', fields.map((field) => field.key))
      setDraft(parsed)
      setMessages([...nextMessages, { role: 'assistant', content: parsed.assistantMessage }])
      setSelectedKeys(fields.map((field) => field.key).filter((key) => parsed.draftPatch[key] !== undefined))
      setInput('')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 助手生成失败，请检查模型配置后重试。')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    if (!draft) return
    const allowed = new Set(selectedKeys)
    const patch = Object.fromEntries(
      Object.entries(draft.draftPatch).filter(([key]) => allowed.has(key)),
    ) as Partial<TPatch>
    onApplyDraft(patch)
    message.success('AI 草稿已回填到当前步骤，保存前仍可手动调整。')
  }

  return (
    <section className="step-ai-assistant" data-step={stepKey}>
      <div className="step-ai-assistant__header">
        <div>
          <div className="step-ai-assistant__eyebrow">上下文 AI 助手</div>
          <h2>边聊边补齐当前步骤</h2>
        </div>
        <Tooltip title="本面板只生成候选补丁，点击回填后才会写入表单。">
          <Tag icon={<ToolOutlined />} color="processing">工具受控</Tag>
        </Tooltip>
      </div>

      <div className="step-ai-assistant__tool-row">
        {tools.map((tool) => (
          <Tooltip key={tool.id} title={tool.description}>
            <span className="step-ai-assistant__tool-chip">
              <DatabaseOutlined />
              {tool.label}
            </span>
          </Tooltip>
        ))}
      </div>

      {messages.length > 0 ? (
        <div className="step-ai-assistant__history">
          {messages.slice(-4).map((item, index) => (
            <div key={`${item.role}-${index}-${item.content.slice(0, 12)}`} className={`step-ai-assistant__bubble step-ai-assistant__bubble--${item.role}`}>
              {item.content}
            </div>
          ))}
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          icon={<ExperimentOutlined />}
          message="可以直接描述大概剧情，也可以说“只改简介”“把背景写得更像悬疑”“目标字数改成 5 万”。"
        />
      )}

      <div className="step-ai-assistant__composer">
        <Input.TextArea
          value={input}
          rows={4}
          placeholder="告诉 AI 你想补齐、改写或测试什么"
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              void handleAsk()
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void handleAsk()}>
          发送
        </Button>
      </div>

      {draft ? (
        <div className="step-ai-assistant__draft">
          <div className="step-ai-assistant__draft-head">
            <strong>候选补丁</strong>
            <Button size="small" type="primary" icon={<CheckOutlined />} disabled={selectedKeys.length === 0} onClick={handleApply}>
              回填选中字段
            </Button>
          </div>
          <Checkbox.Group value={selectedKeys} onChange={(keys) => setSelectedKeys(keys.map(String))}>
            <div className="step-ai-assistant__patch-list">
              {patchEntries.map(({ field, value }) => (
                <label key={field.key} className="step-ai-assistant__patch-item">
                  <Checkbox value={field.key} />
                  <span>
                    <strong>{field.label}</strong>
                    <small>{formatValue(value)}</small>
                  </span>
                </label>
              ))}
            </div>
          </Checkbox.Group>
          {draft.checks.length > 0 || draft.suggestions.length > 0 ? (
            <div className="step-ai-assistant__notes">
              {[...draft.checks, ...draft.suggestions].slice(0, 4).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
