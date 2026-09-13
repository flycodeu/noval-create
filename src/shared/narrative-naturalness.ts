import { getBuiltinGenreRules } from './genre-system'

export interface NarrativeNaturalnessPromptOptions {
  genre?: string | null
  hasAuthorStyleReference?: boolean
  mode?: 'write' | 'rewrite' | 'review'
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function formatGenreFocus(genre?: string | null): string {
  const profile = getBuiltinGenreRules(genre).genreProfile
  const focus = unique(profile.narrativeFocus).slice(0, 4)
  const requestedGenre = genre?.trim() || ''
  const label = requestedGenre && requestedGenre !== profile.name
    ? `${requestedGenre}（${profile.name}）`
    : profile.name || requestedGenre || '当前题材'
  if (focus.length === 0) return label
  return `${label}；可用叙事焦点：${focus.join('、')}`
}

const RUNTIME_LINE_REPLACEMENTS: Array<[string, string]> = [
  [
    '- 每章至少明确一项推进、一项阻力和一个代价落点，避免只有概述没有事件。',
    '- 根据章节功能明确本章发生了什么变化、什么压力仍在持续；不要把推进、阻力和代价机械分配成固定三段。',
  ],
  [
    '- 无论使用 Kimi、Claude、GPT、DeepSeek 或自定义兼容模型，都必须保守使用上下文：不能把推断升级成事实，不能补造未授权设定。',
    '- 生成过程中必须保守使用上下文：不能把推断升级成事实，不能补造未授权设定。',
  ],
  [
    '- 剧情质量门禁：每章都要能指出一个承接证据、一个状态变化、一个目标结果和一个后续压力；只写“推进了剧情”不算通过。',
    '- 剧情质量门禁：按章节功能检查承接、变化、结果与后续压力，不要求每章平均具备全部项目。',
  ],
  [
    '- 局部问题闭环门禁：每章至少回答一个已经建立的问题，或明确写出它为何暂不能回答以及人物因此承担的代价；不能连续用新线索替代回收。',
    '- 局部问题闭环门禁：本章合同若安排问题回收，就写出回答、部分回答或延期造成的实际后果；不能连续用新线索替代已到期的回收。',
  ],
  [
    '- 配角主体性门禁：本章至少一名配角必须有独立目的、主动行动和可见代价；如果配角只解释资料、递交证据或等待主角提问，视为功能化风险。',
    '- 配角主体性门禁：出场配角应按自己的目的和关系采取行动；如果配角只解释资料、递交证据或等待主角提问，视为功能化风险。',
  ],
]

const LEGACY_REVIEW_SPECIAL_CASE = '志怪治妖如果没有“妖病-人事-诊疗选择-病后余味”的闭环，历史正剧如果没有“劳动/制度-组织反馈-受挫-重塑”的链条，都必须写进 genre_hollowing_risks 或 critical_fixes。'

/**
 * Keeps frozen prompt templates reproducible while removing legacy runtime
 * guidance that was tied to individual sample novels or mechanical quotas.
 */
export function sanitizeNarrativeRuntimePrompt(prompt: string): string {
  let normalized = prompt.replace(
    /(?:\n\n)?【题材核心执行链】\n[\s\S]*?(?=\n\n【|$)/u,
    '',
  )
  RUNTIME_LINE_REPLACEMENTS.forEach(([legacy, replacement]) => {
    normalized = normalized.replace(legacy, replacement)
  })
  normalized = normalized
    .split('\n')
    .filter((line) => !line.includes(LEGACY_REVIEW_SPECIAL_CASE))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
  return normalized.trim()
}

/**
 * A compact, genre-aware correction layer for the actual model call.
 *
 * The large prompt library keeps compatibility with saved prompt overrides.
 * This layer fixes reader-facing sameness without turning every genre into the
 * same checklist: the model must choose a dominant experience for the current
 * scene instead of mechanically satisfying every possible quality rule.
 */
export function buildNarrativeNaturalnessPrompt(
  options: NarrativeNaturalnessPromptOptions = {},
): string {
  const mode = options.mode || 'write'
  const action = mode === 'review' ? '检查' : mode === 'rewrite' ? '改写' : '写作'
  const lines = [
    `题材依据：${formatGenreFocus(options.genre)}。只选与本章冲突有关的一两个焦点，不要把全部题材标签塞进同一章。`,
    `把本章当成一次具体经历来${action}，不要把规则清单逐条翻译成“阻力、判断、代价、变化”的固定段落模板。`,
    '已经由动作、对白或物件展示出来的意思，不再由旁白解释一遍；专业流程只写到它真正改变人物选择或结果的位置。',
    '配角先维护自己的目标、偏见和关系，再提供信息；不要让人物轮流充当日志、设定或结论的播报口。',
    '对白可以回避、误听、改口或停在半句，但每处不完整都要来自人物和现场，不能随机添加口头废话。',
    '句长、段长和信息密度跟随人物注意力变化；紧张处可以碎，观察与回忆可以绵长，不要按固定配额制造参差。',
    '优先保留只属于本书的职业习惯、生活经验、关系称呼和观察偏差，删掉换一本书也成立的漂亮总结。',
    options.hasAuthorStyleReference
      ? '已有作者样章或人工风格锁时，以它的叙述距离、节奏和用词习惯为第一风格依据；通用建议只能补缺，不能覆盖样章。'
      : '没有作者样章时，从现有正文中延续已经稳定的叙述距离和人物口吻，不临时发明一套统一的“高级文风”。',
  ]

  if (mode === 'review') {
    lines.push(
      'AI 味只表示读者可能感到同质、过度解释或过度工整，不代表作者身份；不要因单个词、正常题材术语或有意重复直接判定。',
      '最多指出三项最影响阅读的问题，并引用当前正文中的短证据；若问题不成片出现，就不要为了凑数给建议。',
    )
  }

  return ['【读者自然度校准】', ...lines.map((line) => `- ${line}`)].join('\n')
}

export function appendNarrativeNaturalnessPrompt(
  prompt: string,
  options: NarrativeNaturalnessPromptOptions = {},
): string {
  const base = sanitizeNarrativeRuntimePrompt(prompt)
  const guidance = buildNarrativeNaturalnessPrompt(options)
  return base ? `${base}\n\n${guidance}` : guidance
}
