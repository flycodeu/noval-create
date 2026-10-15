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

/** Keep prose readable without changing the story or treating style as a fact gate. */
export function buildProseFluencyGuidance(mode: 'write' | 'rewrite' | 'review'): string[] {
  return [
    '同一信息已经由动作、对白或物证说清后，省去换话重述的结论；必要复核、情绪回响和人物立场不同的重复仍可保留。知识边界约束人物判断，不必每次观察都解释一次“还不能确定”。',
    '人物已转向下一件事时，不反复补“没应声、没接话、没答”说明其沉默；沉默若改变对方理解或关系，则保留具体后果。限制用来守住行为与推断，不逐条写成“没有做什么”的旁白。',
    '问答顺序由各人的诉求、避讳和已知信息决定；第二个人不照抄第一个人的问询步骤。不为打破整齐而添口癖、微动作、新异常或额外冲突。',
    '同一场景有多名证人或来客时，第一人的基础事实确认后，后续人物从自己的差异、顾虑或新物证切入；不要对每个人重复“姓名—所见—称呼—动作”的四步问答。',
    '观察与记录保留首次发现、关键差异和行动结果，合并没有新增内容的重复步骤；保住证据来源、同意、原始抄底与比较条件，不把职业调查删成跳结论。详略随注意和情绪变化，不用同义词轮换或句长配额制造人味。',
    '同一物证已经记入薄册或被读者看见后，后续只写变化、比较或新用途；不要为了显得严谨再次完整抄录。人物的谨慎通过他选择暂缓、核对或改变路线来表现，不用连续的“只能说明、还不能证明”收束每个段落。',
    '必要的勘验细节可以随人物的视线、触感、疑问和被打断的行动展开，不必每次都写成观察、记录、限定结论三步。原始引文、关键测量、证据归属与比较条件仍须准确保留。',
    '句子长短服从当下经验：连续观察和犹豫允许舒展，动作抢迫或对白中断时再收紧。不为检测比例把句子统一切碎，也不按长短句、感官或方言的百分比配额修饰正文。',
    '场景感优先来自已建立的空间、声响、光影、触感和生活细节，允许不承担线索功能的停顿与余味。修订可展开已有细节，但不得凭空添加天气季节、方言地域、伤病或新线索；不把守规要求逐条翻成角色没有做什么的旁白。',
    '转场承接上一场实际留下的未完动作、物品去向和人物决定，让读者明白此刻为何换地方、换问法或停止追问；不重启已经完成的问询或准备。连接只能来自已有事实，缺少关键原因时标明计划缺口，不补造动机或证据。',
    '充实内容优先展开已有选择怎样影响眼前的人和下一步行动，保留人物迟疑、争执与情绪消化所需的篇幅；不靠重复勘验、轮流微动作或补景物凑字。详略围绕本场真正发生的变化，不要求每段都有新线索或冲突。',
    '局部修订须连同前后未选段落回读：不能把邻段的到场、收物、提问或发现搬进补丁，造成同一动作发生两遍；也不能提前写出下一段才观察到的状态。衔接只补已有行动之间的联系，范围外正文保持不变。',
    ...(mode === 'review' ? [
      '指出成片的同质问答、重复解释或让人读乱的转场，引用对应原句并核对说话者、动作主体；说明最小删并范围和必须保留的事实或情绪。单个词、正常沉默与有效长描写不是缺陷，风格建议不升级为事实阻断。',
      '依据章节合同区分“已准备”与“已实施”；安排后章兑现的道具和试验不要求本章提前完成。未知后文不判铺垫失败，不用人物未提供的信息补审读结论。',
    ] : mode === 'rewrite' ? [
      '先删并有依据的重复，再理顺动作与转场；不为显示修改而改写有效句子，保留所选范围之外的正文。不得删改事实、移走揭示章位或添总结句补篇幅。',
    ] : []),
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
    ...buildProseFluencyGuidance(mode),
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
