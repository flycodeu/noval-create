import {
  buildStoryArcPlanningPrompt as rawBuildStoryArcPlanningPrompt,
  buildChapterOutlinePlanningPrompt as rawBuildChapterOutlinePlanningPrompt,
  buildTimelineEventsPrompt as rawBuildTimelineEventsPrompt,
  buildScenePlanPrompt as rawBuildScenePlanPrompt,
  buildChapterDraftPrompt as rawBuildChapterDraftPrompt,
  buildChapterWritingPrompt as rawBuildChapterWritingPrompt,
  buildChapterReviewPrompt as rawBuildChapterReviewPrompt,
  buildChapterRewritePrompt as rawBuildChapterRewritePrompt,
  buildContinuityStatePrompt as rawBuildContinuityStatePrompt,
  type PromptTier,
  type StoryArcPromptInput,
  type ChapterOutlinePromptInput,
  type TimelineEventPromptInput,
  type ScenePlanPromptInput,
  type ChapterWritingPromptInput,
  type ChapterReviewPromptInput,
  type ChapterRewritePromptInput,
  type ContinuityPromptInput,
} from '../../src/shared/prompt-library'
import { applyPromptOverride } from './prompt-override.service'

export type {
  StoryArcPromptInput,
  ChapterOutlinePromptInput,
  TimelineEventPromptInput,
  ScenePlanPromptInput,
  ChapterWritingPromptInput,
  ChapterReviewPromptInput,
  ChapterRewritePromptInput,
  ContinuityPromptInput,
  PromptTier,
}

function appendPromptSection(prompt: string, title: string, lines: string[]): string {
  const body = lines.map((line) => line.trim()).filter(Boolean).join('\n')
  if (!body) return prompt
  return `${prompt}\n\n【${title}】\n${body}`
}

function appendPromptText(prompt: string, text: string): string {
  const normalized = text.trim()
  if (!normalized) return prompt
  return `${prompt}\n\n${normalized}`
}

function normalizePromptTier(tier?: PromptTier): PromptTier {
  return tier || 'standard'
}

function isEnhancedTier(tier?: PromptTier): boolean {
  return normalizePromptTier(tier) !== 'simple'
}

function isKeyTier(tier?: PromptTier): boolean {
  return normalizePromptTier(tier) === 'key'
}

export function buildStoryArcPlanningPrompt(params: StoryArcPromptInput): string {
  const fallback = appendPromptSection(rawBuildStoryArcPlanningPrompt(params), '生产补充要求', [
    '- 故事弧不是展示概念，而是后续章节的事件生产线。',
    '- 每条弧线都要能回收到具体章节冲突、人物关系变化或资源代价，不要停在抽象主题。',
    '- 如果某段设计无法明显推动后续章节，就视为弱设计并主动压缩。',
  ])
  return applyPromptOverride('storyArcs', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  const fallback = appendPromptSection(rawBuildChapterOutlinePlanningPrompt(params), '生产补充要求', [
    '- 章节细纲要优先保证读者能顺着看下去，再保证结构漂亮。',
    '- 每章至少明确一项推进、一项阻力和一个代价落点，避免只有概述没有事件。',
    '- 章节之间的钩子要自然，不要用空悬念硬吊读者。',
    '- 章节标题必须准确、具体、有冲突感或场景感，不能用“开端”“觉醒”“风暴前夜”“命运齿轮”这类万能标题。',
    '- bridge_in / bridge_out 必须形成可追踪接力：上章结果 -> 本章行动 -> 新代价或新问题。',
  ])
  return applyPromptOverride('chapterOutline', fallback, params as unknown as Record<string, unknown>)
}

export function buildTimelineEventsPrompt(params: TimelineEventPromptInput): string {
  const fallback = appendPromptSection(rawBuildTimelineEventsPrompt(params), '生产补充要求', [
    '- 时间轴事件必须能反向服务章节承接、人物状态追踪和读者理解，不要只做资料库条目。',
    '- 如果事件缺少主角动作、直接后果或后续遗留问题，就补足后再输出。',
  ])
  return applyPromptOverride('timelineEvents', fallback, params as unknown as Record<string, unknown>)
}

export function buildScenePlanPrompt(params: ScenePlanPromptInput): string {
  const promptTier = normalizePromptTier(params.promptTier)
  const fallback = appendPromptSection(rawBuildScenePlanPrompt(params), '生产补充要求', [
    '- 这份场景计划会直接进入 AI 主写流程，所以每段都必须可落成正文。',
    '- 先保证场景连贯、动作清楚、冲突具体，再考虑节奏和文气。',
    '- 场景说明用自然中文写，不要夹解释腔、策划黑话或翻译腔。',
    '- 如果“本章应回收伏笔”里已有到期或超期线索，至少安排一个可见动作、对话或结果去推进它，而不是继续悬空。',
    '- 每章同时推进的活跃支线/伏笔不超过 3-5 条，避免信息过载——优先推进标注了[即将回收]的线索。',
    '- 如果"活跃支线与伏笔"中有标注[已N章未提及]的线索，至少用一个场景的细节或对话暗示来回顾它。',
    ...CHAPTER_DELIVERY_GATE_LINES,
    '- 每个场景必须包含：开场动作或悬念钩子、至少一个具体冲突或张力点、退出时留下未解决的问题或下一步悬念。',
    '- 同一关键物品在同一场戏只能有一个最终状态：如果退出钩子写了“收缴/拿走/放入口袋”，就不得再写“被掩埋/丢失/再也找不回来”；如果确实要写遗失，必须删除收缴动作并明确遗失的物理过程。',
    '- 场景数量必须覆盖现有章节合同的全部场景；不得把两个合同场景合并成一个，也不得让某个合同场景只有标题没有结果状态。',
    '- 不要写"角色思考了很久"或"一番讨论后"这类跳过过程的总结句——把过程展开写。',
  ])
  return applyPromptOverride('scenePlan', fallback, params as unknown as Record<string, unknown>)
}

function buildRhythmGuide(emotionTone?: string, targetWords?: number): string {
  const tone = (emotionTone || '').toLowerCase()
  const words = typeof targetWords === 'number' && targetWords > 0 ? Math.round(targetWords) : 0
  const lengthGuide = words > 0
    ? `篇幅参考约${words}字，仅作估算`
    : '不设固定篇幅，以场景完成、冲突结果和自然收束为准'

  if (tone.includes('高潮') || tone.includes('climax') || tone.includes('激烈') || tone.includes('爆发')) {
    return `高潮节奏——短句与未完成反应交替，段落紧凑，对话密集且急促，动作描写优先，删掉一切不推进冲突的修饰。${lengthGuide}；冲突未完成时允许自然展开。`
  }
  if (tone.includes('过渡') || tone.includes('transition') || tone.includes('平缓') || tone.includes('日常')) {
    return `过渡节奏——长短句交替，段落可以舒展，允许环境描写和内心独白，对话节奏放松，可用细节暗埋伏笔。${lengthGuide}；本章完成承接和递进后可以提前收束。`
  }
  if (tone.includes('悬念') || tone.includes('suspense') || tone.includes('紧张') || tone.includes('压抑')) {
    return `悬念节奏——句子长短参差制造不安感，关键信息放在段落末尾，适度留白和省略，对话含糊暗示多于直说。${lengthGuide}；悬念成立后即可收束，不要为了写满重复信息。`
  }
  if (tone.includes('悲伤') || tone.includes('沉重') || tone.includes('告别')) {
    return `沉郁节奏——句子偏长但不拖沓，重感官细节（触觉、温度、声音），对话少而重，沉默和停顿比语言更有力。`
  }

  return ''
}

const CHAPTER_DELIVERY_GATE_LINES = [
  '- 章节衔接桥是高优先级记忆：开头必须承接时间、地点、情绪和 POV 边界；如果跳切，必须在正文里交代跳切依据。',
  '- 步骤记忆接力是硬约束：Planner 输出要能被 Writer 执行，Writer 初稿要能被 Critic 核验，Rewriter 不得绕开上游约束。',
  '- 无论使用 Kimi、Claude、GPT、DeepSeek 或自定义兼容模型，都必须保守使用上下文：不能把推断升级成事实，不能补造未授权设定。',
  '- 章节合同里的必推人物弧，必须在本章让关键人物完成一次选择、行动、代价、关系变化或误信念裂缝，不能只提到人物状态。',
  '- 主题不是装饰句：本章冲突必须回应主题命题，让角色在底线、欲望、代价或妥协之间做出可见判断。',
  '- 关系弧变化必须同时有触发事件、可见互动和后果，不能只把关系状态从 A 改成 B。',
  '- 剧情质量门禁：每章都要能指出一个承接证据、一个状态变化、一个目标结果和一个后续压力；只写“推进了剧情”不算通过。',
  '- 如果场景计划给了“各方心思/信息差/演给谁看”，正文必须把它们落进对白潜台词、留白和分寸里：让在场各方带着各自的算盘说话，读者比某个角色多知道一层，而不是让角色互相直白通报信息。',
  '- 如果硬约束或文风参考包含真实样章对照/人工风格样本锁定，必须按其节奏、句式、信息密度、对白比例和现场质感执行。',
]

export function buildChapterDraftPrompt(params: ChapterRewritePromptInput): string {
  const promptTier = normalizePromptTier(params.promptTier)
  const rhythmGuide = buildRhythmGuide(params.emotionTone, params.targetWords)
  const withStructuralAlerts = params.structuralAlertsSummary
    ? appendPromptSection(rawBuildChapterDraftPrompt(params), '近期结构告警', params.structuralAlertsSummary.split('\n'))
    : rawBuildChapterDraftPrompt(params)
  const fallback = appendPromptSection(withStructuralAlerts, '生产补充要求', [
    '- 当前目标是交出可审校的初稿，不是一次性追求终稿腔调。',
    '- 先把事件、状态、关系、物品去向和代价写准，后续再精修语言。',
    '- 行文必须贴中文小说语感，不要露出提示词腔、翻译腔和说明书味。',
    ...CHAPTER_DELIVERY_GATE_LINES,
    '- 如果近期结构告警提示主角太顺、代价蒸发或反转硬塞，必须在本章正文里补出真实阻力、持续后果或铺垫兑现。',
    ...(isEnhancedTier(promptTier) && rhythmGuide ? [`- 本章节奏指导：${rhythmGuide}`] : []),
    ...(isKeyTier(promptTier)
      ? ['- 关键章节必须把冲突升级、关系变化或阶段代价明确落到事件结果里，不能只做铺陈。']
      : []),
  ])
  return applyPromptOverride('chapterDraft', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  const rhythmGuide = buildRhythmGuide(params.emotionTone, params.targetWords)
  const fallback = appendPromptSection(rawBuildChapterWritingPrompt(params), '生产补充要求', [
    '- 正文必须像给真实读者看的成稿，不要保留策划腔、提示词腔或解释腔。',
    '- 如果某个转折不能提高理解度或追读欲，就不要硬加。',
    '- 避免不合中文语境的搭配、书面翻译句式和为了显高级而生造的表达。',
    ...CHAPTER_DELIVERY_GATE_LINES,
    ...(rhythmGuide ? [`- 本章节奏指导：${rhythmGuide}`] : []),
  ])
  return applyPromptOverride('chapterWriting', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterReviewPrompt(params: ChapterReviewPromptInput): string {
  const promptTier = normalizePromptTier(params.promptTier)
  const withStructuralAlerts = params.structuralAlertsSummary
    ? appendPromptSection(rawBuildChapterReviewPrompt(params), '近期结构告警', params.structuralAlertsSummary.split('\n'))
    : rawBuildChapterReviewPrompt(params)
  const fallback = appendPromptText(
    appendPromptSection(withStructuralAlerts, '补充审校要求', [
      '- coherence_risks 只写会让读者读乱的地方，例如指代不明、信息顺序失衡、情绪跳变、动机断层。',
      '- reader_hook_risks 只写会削弱追读意愿的问题，例如冲突太虚、转折太轻、结果无代价、悬念不成立。',
      '- step_memory_risks 只写 Planner -> Writer -> Critic -> Rewriter 之间没有接上的地方，例如场景计划未执行、接力断言被忽略、衔接桥没落到正文。',
      '- opening_hook_risks 只写开篇吸引力问题：前 300 字无具体现场/动作/压力/追问点，前 800 字仍在解释设定，章尾没有把问题递出去。',
      '- title_alignment_risks 只写标题与本章核心事件、场景物件、选择压力或反转点不匹配的问题。',
      '- hallucination_risks 只写无来源新增设定、人物、能力、地点、物品、背景真相，或把推断升级成事实的问题。',
      '- human_language_repairs 只列最值得先改的 1 到 3 处生硬表达，尽量直接给出“原说法 -> 更自然说法”。',
      '- revision_brief 先讲承接和真实度，再讲语言和追读感。',
      '- 如果出现翻译腔、搭配不成立、伪文艺句或明显 AI 套话，要优先列进 language_risks 和 human_language_repairs。',
      '- missing_payoffs 还要重点检查“本章应回收伏笔”里的到期或超期线索：如果正文没有推进、暗示或说明延期原因，要明确指出。',
      '- missing_payoffs 重点检查：活跃支线和伏笔中标注了[即将回收]或[已N章未提及]的线索，在本章是否有推进或至少暗示。',
      '- continuity_risks 必须检查：本章角色行为是否与人物当前状态中记录的性格、立场、伤势、能力等一致。',
      '- 连贯性检查必须同时核对上章的时间、地点、未完成动作、人物状态、物品去向和信息差；没有解释的跳变要写入 continuity_risks 或 coherence_risks。',
      '- arc_progress_risks 只写本章没有推进当前故事弧目标、推进方向错误、关键检查点空转或连续多章偏离本弧的问题。',
      '- 紧凑度检查：本章至少要发生一次目标推进、受阻、改向或失败；解释、回忆和对白若没有改变局势，必须指出空转位置。',
      '- 铺垫检查：反转和回收必须能在正文中找到前置证据，兑现后必须留下后果；临时新增线索、作者宣布式反转或快速抹平代价要优先列入 missing_payoffs、reader_hook_risks 或 critical_fixes。',
      '- 人物刻画检查：选择必须来自人物已有性格、利益、关系、伤势和压力；情绪要落在动作、措辞、停顿、误判和关系反应上，角色不能只承担传递设定的功能。',
      '- 如果当前位于本弧 25% / 50% / 75% 检查点，必须更严格审查本章是否在兑现本弧目标，而不是重复铺陈。',
      '- protagonist_setback 只能是 none / minor / major；setback_summary 要用一句话写清主角到底输掉了什么或被压制了什么。',
      '- cost_present=true 时必须同时给出 cost_summary 与 cost_resolution_state；重大问题一两段就抹平，cost_resolution_state 应判为 evaporated。',
      '- reversal_marker=true 时必须同时给出 reversal_summary 与 reversal_support_state；没有铺垫支撑的反转应判为 forced。',
      '- pace_marker 只能保留一个主标签：setup / conflict / reversal / climax / payoff / breather。',
      '- reward_state 用来判断本章是否给了阶段性回报；持续受挫却没有回报要明确反映出来。',
      '- protagonist_pressure 用 0-100 反映结构压力，不要因为篇幅热闹就机械打高分。',
      '- chapter_function_primary 只能选 setup / progression / reversal / payoff / breather / climax / exposition / closure 其中一个主功能。',
      '- chapter_function_tags 只保留 1 到 3 个真正承担的叙事功能标签；如果 chapter_function_primary 已给出，必须包含在 tags 里。',
      '- dialogue_filler_risks 只写对白空转、互相接话却没有立场和动作承载的问题。',
      '- dialogue_info_density_risks 只写对白里该给而没给的地点、目标、证据、筹码或下一步动作。',
      '- dialogue_voice_lock_summary 用一句话说明本章生成前要锁谁的声音。',
      '- required_voice_lock_character_ids 只保留本章需要强制启用 voice lock 的角色 id。',
      ...CHAPTER_DELIVERY_GATE_LINES,
      '- 必须明确区分“语言修好了”和“剧情真的变紧了”：语言自然但冲突链、代价链、目标链没有变化，仍要写入 critical_fixes 或 arc_progress_risks。',
      '- 冲突链检查：正文是否让阻力升级、交锋可见、选择被迫发生；如果只是解释冲突存在而没有现场交锋，要判为偏弱。',
      '- 代价链检查：正文是否让行动带来损耗、失去、关系后果或后续压力；如果风险一段内被抹平，要判为代价蒸发。',
      '- 目标链检查：正文是否让本章目标发生可确认的前进、受阻、改向或失败；如果只重复目标口号，要判为没有推进。',
      '- 关键章如果主功能仍然只是 setup / exposition / breather，要在 reader_hook_risks 或 critical_fixes 里明确指出它名义关键、实际过渡的问题。',
      '- design_flatness_risks（设计感专项，只提示不阻塞）：判断本章是不是“只把事件/史实写顺了”，却缺少戏剧设计。命中信号：全章只有单向量冲突（一方有诉求、其余人只是接话）、对白只在互相通报信息而无潜台词、没有任何戏剧反讽（读者并不比角色多知道什么）、场景内没有发生局势转折（进场和退场时的力量/信息格局一样）、章节像史实/大事记的顺序复述而非有设计的情节。逐条写清是哪一处扁平、可以往哪个方向加设计；如果本章设计感足够，就留空数组。',
      ...(isEnhancedTier(promptTier)
        ? ['- 因果链检查：本章每个重大事件是否有合理的触发原因，结果是否产生了后续影响而非凭空出现凭空消失。']
        : []),
      ...(isKeyTier(promptTier)
        ? ['- 关键章节还要额外审查高潮是否兑现、代价是否落地、支线回收是否足够，避免只放大声量不推进结构。']
        : []),
    ]),
    '只输出 JSON：{"summary":"总体判断","critical_fixes":["必改项"],"continuity_risks":["连续性风险"],"arc_progress_risks":["故事弧推进风险"],"context_drift_risks":["漂移风险"],"realism_risks":["真实度风险"],"coherence_risks":["连贯性风险"],"reader_hook_risks":["追读风险"],"step_memory_risks":["步骤接力风险"],"opening_hook_risks":["开篇吸引力风险"],"title_alignment_risks":["标题偏题风险"],"hallucination_risks":["无来源新增或推断升级风险"],"language_risks":["语言风险"],"human_language_repairs":["原说法 -> 更自然说法"],"genre_hollowing_risks":["体裁空心化风险"],"design_flatness_risks":["设计扁平风险：只把事件写顺、缺潜台词/博弈/反讽/场景内转折"],"missing_payoffs":["未落地伏笔"],"strengths":["具体优点"],"severity":"medium","rewrite_required":true,"revision_brief":"修订方向摘要","protagonist_setback":"minor","setback_summary":"主角在关键交锋里被压制","cost_present":true,"cost_summary":"主角付出人手与资源损失","cost_resolution_state":"ongoing","reversal_marker":true,"reversal_summary":"看似得手后被埋伏反制","reversal_support_state":"supported","pace_marker":"reversal","reward_state":"partial","protagonist_pressure":72,"chapter_function_primary":"reversal","chapter_function_tags":["progression","reversal"],"dialogue_filler_risks":["对白空话"],"dialogue_info_density_risks":["信息推进不足"],"dialogue_voice_lock_summary":"","required_voice_lock_character_ids":[]}',
  )
  return applyPromptOverride('chapterReview', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterRewritePrompt(params: ChapterRewritePromptInput): string {
  const promptTier = normalizePromptTier(params.promptTier)
  const rhythmGuide = buildRhythmGuide(params.emotionTone, params.targetWords)
  const withStructuralAlerts = params.structuralAlertsSummary
    ? appendPromptSection(rawBuildChapterRewritePrompt(params), '近期结构告警', params.structuralAlertsSummary.split('\n'))
    : rawBuildChapterRewritePrompt(params)
  const fallback = appendPromptSection(withStructuralAlerts, '最终成稿补充要求', [
    '- 优先采纳审校里列出的关键修订、连贯性风险、追读风险和语言替换建议。',
    '- 目标是交付可入稿的最终版，不要留下明显模板腔、解释腔或人机味。',
    '- 如果初稿中有用【锁定】或 [LOCKED] 标记的段落，这些段落是作者已确认的内容，必须原封不动保留，只修改未标记的部分。',
    '- 如果提供了”作者锁定段落（逐字保留）”列表，必须逐字保留；即使上下文需要调整，也只能改动周边段落来衔接。',
    '- 对话辨识度要求：每个角色说话时要体现其独特的语言习惯（口头禅、用词水平、句式偏好）。如果人物状态里给了说话方式、口头禅或方言特征，必须体现在对话中。',
    '- 对话自然度：允许打断、省略、口误、沉默、答非所问。上下级不同调、亲疏不同温度、紧张时短句、放松时废话多。',
    '- 如果近期结构告警指出顺推、代价蒸发、反转硬塞或高潮分布失衡，重写时必须在正文里真实修复，而不是只润色句子。',
    ...(rhythmGuide ? [`- 本章节奏指导：${rhythmGuide}`] : []),
    ...CHAPTER_DELIVERY_GATE_LINES,
    '- 关键章节不允许只润色表面措辞，必须同时兑现阶段冲突、结果代价和关系变化。',
  ])
  return applyPromptOverride('chapterRewrite', fallback, params as unknown as Record<string, unknown>)
}

export function buildContinuityStatePrompt(params: ContinuityPromptInput): string {
  const fallback = rawBuildContinuityStatePrompt(params)
  return applyPromptOverride('continuityState', fallback, params as unknown as Record<string, unknown>)
}
