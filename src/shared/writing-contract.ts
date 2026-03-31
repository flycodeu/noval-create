export type WritingContractGroup = 'core' | 'focus'

export interface WritingContractPreset {
  value: string
  label: string
  group: WritingContractGroup
  promptRules: string[]
  qualityFocus: string[]
}

export const WRITING_CONTRACT_PRESETS: WritingContractPreset[] = [
  {
    value: 'wish_fulfillment',
    label: '爽文',
    group: 'core',
    promptRules: [
      '优先保证情节兑现、压制解除、冲突反打和即时反馈，不长时间停在纯解释或空思考。',
      '人物决策要干脆，冲突和收益都要让读者快速感知。',
      '允许情绪更直接，但不能脱离既定世界规则和因果代价。',
    ],
    qualityFocus: [
      '重点检查节奏拖慢、兑现延迟、爽点被空洞感慨替代。',
      '重点检查关键冲突是否落到了行动、反击、结果和代价上。',
    ],
  },
  {
    value: 'realism',
    label: '写实',
    group: 'core',
    promptRules: [
      '优先遵守常识、资源消耗、伤害后果、阶层秩序和时间成本，禁止无代价推进。',
      '人物反应、关系变化和局势转折都必须由事件推动，不允许凭空升温或突变。',
      '语言保持自然中文和现实交流感，不拔高、不煽情、不做口号式收尾。',
    ],
    qualityFocus: [
      '重点检查行为是否符合常识、情绪是否有现实承载、关系推进是否有事件基础。',
      '重点检查对话是否像真人在当前处境下会说的话，而不是统一模板腔。',
    ],
  },
  {
    value: 'romance',
    label: '言情',
    group: 'focus',
    promptRules: [
      '关系推进要落在称呼变化、停顿、回避、试探、误会、照顾、占有欲或心软等细节上。',
      '对白要保留潜台词和情绪温差，不把情感写成说明书。',
      '重要互动优先承载关系变化，而不是只做情节过场。',
    ],
    qualityFocus: [
      '重点检查情感线是否真的发生了关系变化，而不是只有旁白判断。',
      '重点检查亲密关系对白是否有温度差、距离感和角色专属说话方式。',
    ],
  },
  {
    value: 'suspense',
    label: '悬念',
    group: 'focus',
    promptRules: [
      '优先维持信息差、线索递进和延迟揭示，不提前把答案讲透。',
      '每个关键段落都要留下可追踪的问题、误导或未解释后果。',
    ],
    qualityFocus: [
      '重点检查线索是否可回查、悬念是否被过早解释、信息暴露是否过量。',
    ],
  },
  {
    value: 'growth',
    label: '成长',
    group: 'focus',
    promptRules: [
      '成长必须落在选择、代价、认知变化、能力变化或关系站位变化上。',
      '禁止只在段尾用总结句宣布人物成长。',
    ],
    qualityFocus: [
      '重点检查成长是否有事件承载，是否留下后续选择差异。',
    ],
  },
  {
    value: 'ensemble',
    label: '群像',
    group: 'focus',
    promptRules: [
      '重要角色必须有不同的目标、语气、立场和关系位置，避免所有人只服务主角一句话。',
      '场景里的人物分工、利益和冲突来源要清楚，不要把多人写成一个声音。',
    ],
    qualityFocus: [
      '重点检查人物区分度、群像分工、关系网牵引是否成立。',
    ],
  },
]

const PRESET_BY_VALUE = new Map(WRITING_CONTRACT_PRESETS.map((preset) => [preset.value, preset]))
const PRESET_BY_LABEL = new Map(WRITING_CONTRACT_PRESETS.map((preset) => [preset.label, preset]))

function normalizeTagValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePresetLikeTag(value: string): string {
  return PRESET_BY_VALUE.get(value)?.value || PRESET_BY_LABEL.get(value)?.value || value
}

export function getWritingContractPreset(value?: string | null): WritingContractPreset | undefined {
  if (!value) return undefined
  return PRESET_BY_VALUE.get(normalizePresetLikeTag(value))
}

export function getWritingContractLabel(value?: string | null): string {
  if (!value) return ''
  return getWritingContractPreset(value)?.label || value
}

export function normalizeWritingContractTags(value: unknown): string[] {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，、]/)
      : []

  const seen = new Set<string>()
  const tags: string[] = []

  rawList.forEach((item) => {
    const normalized = normalizePresetLikeTag(normalizeTagValue(item))
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    tags.push(normalized)
  })

  return tags.slice(0, 12)
}

export function splitWritingContractTags(tags: string[]) {
  const normalized = normalizeWritingContractTags(tags)
  const presetTags: string[] = []
  const customTags: string[] = []
  const coreTags: string[] = []
  const focusTags: string[] = []

  normalized.forEach((tag) => {
    const preset = getWritingContractPreset(tag)
    if (!preset) {
      customTags.push(tag)
      return
    }

    presetTags.push(preset.value)
    if (preset.group === 'core') coreTags.push(preset.value)
    if (preset.group === 'focus') focusTags.push(preset.value)
  })

  return {
    normalized,
    presetTags,
    customTags,
    coreTags,
    focusTags,
  }
}

export function getWritingContractValidationError(tags: string[]): string | null {
  const { coreTags } = splitWritingContractTags(tags)
  if (coreTags.length > 1) {
    return '“爽文”和“写实”属于核心阅读预期，只能选择一个。'
  }
  return null
}

export function formatWritingContractTags(tags: string[]): string {
  const normalized = normalizeWritingContractTags(tags)
  if (normalized.length === 0) return ''
  return normalized.map((tag) => getWritingContractLabel(tag)).join(' / ')
}

export function buildWritingContractSummary(tags: string[]): string {
  const { normalized, customTags } = splitWritingContractTags(tags)
  if (normalized.length === 0) return ''

  const lines = [
    `写作类型：${normalized.map((tag) => getWritingContractLabel(tag)).join('、')}`,
  ]

  normalized.forEach((tag) => {
    const preset = getWritingContractPreset(tag)
    if (!preset) return
    lines.push(`${preset.label}要求：${preset.promptRules.join('；')}`)
  })

  if (customTags.length > 0) {
    lines.push(`自定义偏好：${customTags.join('、')}`)
  }

  return lines.join('\n')
}

export function buildWritingContractPromptRules(tags: string[]): string[] {
  const { normalized, customTags } = splitWritingContractTags(tags)
  const lines = normalized.flatMap((tag) => getWritingContractPreset(tag)?.promptRules || [])

  if (customTags.length > 0) {
    lines.push(`额外自定义偏好：${customTags.join('、')}。这些偏好只作为软约束，不能覆盖既定设定与世界规则。`)
  }

  return [...new Set(lines)]
}

export function buildWritingContractQualityFocus(tags: string[]): string[] {
  const { normalized } = splitWritingContractTags(tags)
  return [...new Set(normalized.flatMap((tag) => getWritingContractPreset(tag)?.qualityFocus || []))]
}