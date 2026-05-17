import { cleanAiValue } from '../../../utils/text'
import { getUserFacingMessage } from '../../../utils/user-facing-message'

export type DraftMode = 'replace' | 'fill_blanks' | 'optimize'
export type DraftFieldType = 'string' | 'number' | 'string[]'

export interface DraftContextSection {
  label: string
  value?: string | number | string[] | null
}

export interface DraftFieldDefinition {
  key: string
  label: string
  type?: DraftFieldType
  value?: string | number | string[] | null
  hint?: string
}

export interface DraftSelectionOption {
  id?: number
  label: string
  aliases?: string[]
}

interface BuildDraftMessagesOptions {
  task: string
  mode?: DraftMode
  context: DraftContextSection[]
  fields: DraftFieldDefinition[]
  requirements?: string[]
}

const EMPTY_VALUE = '未填写'

function formatValue(value?: string | number | string[] | null): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join('、') : EMPTY_VALUE
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : EMPTY_VALUE
  }

  return value?.trim() || EMPTY_VALUE
}

function describeMode(mode: DraftMode): string {
  if (mode === 'fill_blanks') return '优先补空白项，已有内容只在明显冲突时才调整。'
  if (mode === 'optimize') return '保留原有方向，重点优化自然度、逻辑和可写性。'
  return '可以整体重写，但必须与当前小说设定保持一致。'
}

function describeType(type: DraftFieldType): string {
  if (type === 'number') return '整数'
  if (type === 'string[]') return '字符串数组'
  return '字符串'
}

function buildJsonSkeleton(fields: DraftFieldDefinition[]): string {
  const rows = fields.map((field) => {
    if (field.type === 'number') return `  "${field.key}": 0`
    if (field.type === 'string[]') return `  "${field.key}": []`
    return `  "${field.key}": ""`
  })

  return `{\n${rows.join(',\n')}\n}`
}

export function buildDraftMessages({
  task,
  mode = 'replace',
  context,
  fields,
  requirements = [],
}: BuildDraftMessagesOptions): Array<{ role: 'user'; content: string }> {
  const contextBlock = context
    .filter((section) => formatValue(section.value) !== EMPTY_VALUE)
    .map((section) => `- ${section.label}：${formatValue(section.value)}`)
    .join('\n')

  const fieldBlock = fields
    .map((field) => {
      const lines = [
        `- ${field.label}（${field.key}，${describeType(field.type || 'string')}）`,
        `  当前值：${formatValue(field.value)}`,
      ]

      if (field.hint) {
        lines.push(`  要求：${field.hint}`)
      }

      return lines.join('\n')
    })
    .join('\n')

  const requirementBlock = [
    '- 只输出 JSON 对象，不要 Markdown，不要解释。',
    '- 不要新增未要求的键。',
    '- 语言要自然、克制、可直接回填到写作策划表单。',
    '- 禁止空话、套话、宣传腔和自我解释。',
    `- ${describeMode(mode)}`,
    ...requirements.map((item) => `- ${item}`),
  ].join('\n')

  return [{
    role: 'user',
    content: [
      `请为“${task}”生成一份可直接回填表单的草稿。`,
      contextBlock ? `已知上下文：\n${contextBlock}` : '',
      `需要回填的字段：\n${fieldBlock}`,
      `输出要求：\n${requirementBlock}`,
      `请严格输出如下 JSON 结构：\n${buildJsonSkeleton(fields)}`,
    ].filter(Boolean).join('\n\n'),
  }]
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')

  if (start === -1 || end === -1 || end < start) {
    throw new Error(getUserFacingMessage('common.aiJsonObjectInvalid'))
  }

  return trimmed.slice(start, end + 1)
}

export function parseDraftJson<T extends object>(raw: string): Partial<T> {
  return cleanAiValue(JSON.parse(extractJsonObject(raw))) as Partial<T>
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const next = Number(value)
    if (Number.isFinite(next)) return Math.round(next)
  }

  return undefined
}

function normalizeSelectionToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•:：,，、;；'"“”‘’()（）[\]【】{}<>《》\-_/\\|]/g, '')
}

export function matchSelectionIdsByLabels(value: unknown, options: DraftSelectionOption[]): number[] {
  const targets = normalizeStringArray(value)
    .map(normalizeSelectionToken)
    .filter(Boolean)

  if (targets.length <= 0) return []

  const matched = new Set<number>()

  targets.forEach((target) => {
    options.forEach((option) => {
      if (typeof option.id !== 'number') return
      const candidates = [option.label, ...(option.aliases || [])]
        .map(normalizeSelectionToken)
        .filter(Boolean)

      if (candidates.some((candidate) => candidate === target || candidate.includes(target) || target.includes(candidate))) {
        matched.add(option.id)
      }
    })
  })

  return Array.from(matched)
}

export function matchSelectionIdByLabels(value: unknown, options: DraftSelectionOption[]): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === 'string') {
    const [first] = matchSelectionIdsByLabels([value], options)
    return first
  }

  const [first] = matchSelectionIdsByLabels(value, options)
  return first
}
