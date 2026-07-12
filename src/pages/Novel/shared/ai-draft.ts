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
const TEMPLATE_SENTENCE_PATTERNS = [
  /通过[^，。；;\n]{2,32}(?:体现|展现|表现|凸显|推动)/g,
  /在[^，。；;\n]{2,32}中(?:体现|展现|表现|完成|推进)/g,
]
const HOLLOW_PHRASE_PATTERN = /(某种无法言说|无法言说的?|命运的齿轮|真正的成长|灵魂深处|宿命般)/u

interface DraftQualityIssue {
  key: string
  message: string
}

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

function normalizeDraftItem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•:：,，、;；'"“”‘’()（）[\]【】{}<>《》\-_/\\|。！？!?]/g, '')
}

function flattenDraftStrings(value: unknown, path = ''): Array<{ key: string; value: string }> {
  if (typeof value === 'string') {
    return value.trim() ? [{ key: path || 'root', value: value.trim() }] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenDraftStrings(item, `${path}[${index}]`))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => (
      flattenDraftStrings(item, path ? `${path}.${key}` : key)
    ))
  }

  return []
}

function getRepeatedSentenceIssue(value: string): boolean {
  const normalizedSentences = value
    .split(/[。！？!?；;\n]+/u)
    .map(normalizeDraftItem)
    .filter((item) => item.length >= 6)

  if (normalizedSentences.length < 2) return false
  return new Set(normalizedSentences).size < normalizedSentences.length
}

function getCrossFieldRepeatIssues(entries: Array<{ key: string; value: string }>): DraftQualityIssue[] {
  const issues: DraftQualityIssue[] = []
  const seen = new Map<string, string>()

  entries.forEach((entry) => {
    const normalized = normalizeDraftItem(entry.value)
    if (normalized.length < 12) return

    const previousKey = seen.get(normalized)
    if (previousKey && previousKey !== entry.key) {
      issues.push({
        key: entry.key,
        message: `与 ${previousKey} 存在重复内容`,
      })
      return
    }

    seen.set(normalized, entry.key)
  })

  return issues
}

export function inspectDraftQuality(value: unknown): DraftQualityIssue[] {
  const issues: DraftQualityIssue[] = []

  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (!Array.isArray(item)) return
      const normalized = item
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeDraftItem)
        .filter(Boolean)
      if (new Set(normalized).size < normalized.length) {
        issues.push({ key, message: '数组字段存在重复或近似重复条目' })
      }
    })
  }

  const stringEntries = flattenDraftStrings(value)

  issues.push(...getCrossFieldRepeatIssues(stringEntries))

  stringEntries.forEach((entry) => {
    const templateHits = TEMPLATE_SENTENCE_PATTERNS.reduce((total, pattern) => {
      pattern.lastIndex = 0
      return total + [...entry.value.matchAll(pattern)].length
    }, 0)

    if (templateHits >= 2) {
      issues.push({ key: entry.key, message: '字段里有连续模板句式' })
    }

    if (HOLLOW_PHRASE_PATTERN.test(entry.value)) {
      issues.push({ key: entry.key, message: '字段里仍有假深刻或空泛词' })
    }

    if (getRepeatedSentenceIssue(entry.value)) {
      issues.push({ key: entry.key, message: '字段内存在重复句子或近似重复句意' })
    }
  })

  return issues
}

function assertDraftQuality(value: unknown) {
  const issues = inspectDraftQuality(value)
  if (issues.length <= 0) return

  const detail = issues
    .slice(0, 3)
    .map((issue) => `${issue.key}: ${issue.message}`)
    .join('；')
  throw new Error(getUserFacingMessage('common.aiDraftQualityInvalid', { detail }))
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

  const baseRequirementBlock = [
    '- 只输出 JSON 对象，不要 Markdown，不要解释。',
    '- 不要新增未要求的键。',
    `- ${describeMode(mode)}`,
    ...requirements.map((item) => `- ${item}`),
  ].join('\n')

  const hardRuleBlock = [
    '- 以下硬约束不可被上面的补充要求覆盖。',
    '- 语言要自然、克制、可直接回填到写作策划表单。',
    '- 禁止空话、套话、宣传腔和自我解释。',
    '- 先自检字段之间是否互相冲突，宁愿保守，也不要编造上下文没有支撑的人名、组织、能力或设定。',
    '- 每个字段都要落到当前故事可执行的信息：目标、阻力、代价、验证方式、人物选择或后续影响至少命中一项。',
    '- 已填写字段不需要机械复述；如果没有新增信息，就保留原值或补一个具体缺口。',
    '- 不同字段必须承担不同职责，不要把同一段结论复制到多个字段里。',
    '- 不要让多个字段套用同一套句式骨架，尤其避免连续使用“通过……体现……”“在……中……”这类模板句。',
    '- 少用“命运、灵魂、真正、某种、无法言说”等假深刻词；如果必须使用，必须有具体场景、动作或制度承载。',
    '- 数组字段只输出互不重复、可直接使用的条目；不要用近义词凑数量。',
  ].join('\n')

  return [{
    role: 'user',
    content: [
      `请为“${task}”生成一份可直接回填表单的草稿。`,
      contextBlock ? `已知上下文：\n${contextBlock}` : '',
      `需要回填的字段：\n${fieldBlock}`,
      `输出要求：\n${baseRequirementBlock}`,
      `硬性质量规则：\n${hardRuleBlock}`,
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
  if (start === -1) {
    throw new Error(getUserFacingMessage('common.aiJsonObjectInvalid'))
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) return trimmed.slice(start, index + 1)
    }
  }

  throw new Error(getUserFacingMessage('common.aiJsonObjectInvalid'))
}

export function parseDraftJson<T extends object>(raw: string): Partial<T> {
  let parsed: unknown
  try {
    parsed = cleanAiValue(JSON.parse(extractJsonObject(raw)))
  } catch {
    throw new Error(getUserFacingMessage('common.aiJsonObjectInvalid'))
  }
  assertDraftQuality(parsed)
  return parsed as Partial<T>
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
