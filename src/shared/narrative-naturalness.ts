import { getBuiltinGenreRules } from './genre-system'

export interface NarrativeNaturalnessPromptOptions {
  policyVersion?: 'legacy' | 'reader-first-v1'
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

/** Scene-level criteria shared by creative drafting and its independent reviews. */
export function buildStoryQualityGuidance(mode: 'write' | 'review'): string[] {
  return [
    '重大选择要符合当事人已知信息、眼前诉求和可行办法；放弃明显更省事的办法须有情境依据，判断错误也应有来由，后果不能下场清零。缺少关键依据时回到计划，不临时补造旧伤、动机或解围规则。',
    '配角按自己的生计、承诺和关系行动，允许拒绝、忙别的事或与主角分歧；不为凑层次强造秘密。人情通过称呼、礼数、担保与实际取舍体现，不把中国人物统一写成讲面子；他人私心不能写成当前视角已知。',
    '悬疑与反转只在本场需要时使用，转折须能回看已有线索及其原先解释；不得藏起视角人物已知的必要信息或临时补决定性证据。不要求每章都有损失、反转或新危险，生活与安静收束可以自身成立。',
    '道教、历史与地方人情须区分有来源的知识、地方习俗、人物信念和作品原创规则；具体断言沿用材料的时代、地域与适用边界。未核实不冒充通行事实或保证准确，也不为显得有文化堆术语。',
    ...(mode === 'review' ? [
      '在现有 summary 中简述因果选择、人物自主性、伏笔兑现、文化依据、语言自然度中本次适用的判断；不适用或依据不足明说。问题沿用现有风险数组，引用候选连续原句，说明依据与最小修改范围；无证据不补造问题，不新增输出字段或以风格偏好否定合法日常。',
    ] : [
      '正文用人物经历呈现上述取舍；大纲保留场景安排与字段格式，不扩写成整章。不输出检查清单；局部修订只处理选中范围及其衔接，保留有效表达。',
    ]),
  ]
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
    ...(mode === 'write' ? [
      '首稿取舍顺序：已确认的事实与状态 > 章节/场景合同 > 当前视角人物的知识边界、目标与关系 > 作者样章或本书既有正文的表达习惯 > 题材通用建议。低优先级内容不得覆盖高优先级内容。',
      '动笔前先锁定本场景的视角人物：此刻知道什么、想从谁那里得到什么、刻意避开什么、哪件事会迫使其改变选择。正文表现这些结果，不输出检查过程。',
      '作者样章只用于学习叙述距离、句法节奏、用词范围和对白习惯；不得复刻样章中的句子、情节、人物动作或专有细节。',
      '首稿就按可直接阅读的正文完成，不预留给后续“去 AI 味”重写；审校只负责发现有证据的问题，不能代替本次写作决策。',
    ] : []),
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
      'language_risks、long_window_humanization_risks、genre_register_risks 和对白自然度风险中的每条结论，都必须写成“问题。【证据】正文连续短片段”；证据必须逐字来自待审初稿，没有可回指证据就不要输出该结论。',
    )
  }

  return ['【读者自然度校准】', ...lines.map((line) => `- ${line}`)].join('\n')
}

export function appendNarrativeNaturalnessPrompt(
  prompt: string,
  options: NarrativeNaturalnessPromptOptions = {},
): string {
  if (options.policyVersion === 'reader-first-v1') return prompt
  const base = sanitizeNarrativeRuntimePrompt(prompt)
  const guidance = buildNarrativeNaturalnessPrompt(options)
  return base ? `${base}\n\n${guidance}` : guidance
}
