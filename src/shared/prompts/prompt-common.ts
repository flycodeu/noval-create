import { buildRealityConstraintSummary, getBuiltinGenreRules } from '../genre-system'
import type { VariationEntityType } from './prompt-types'

export function clean(value?: string | null): string {
  return value?.trim() || ''
}

export function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

export function section(title: string, content?: string | null): string {
  const body = clean(content)
  if (!body) return ''
  return `【${title}】\n${body}`
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Hard constraints are the canonical copy for the selected fields. Do not
 * inject the same field again as a normal context section when the allocator
 * has already placed it in the hard-constraint block.
 */
export function sectionUnlessCovered(
  title: string,
  content: string | null | undefined,
  hardConstraintContext: string | null | undefined,
  coveredTitles: string[] = [],
): string {
  const hardText = clean(hardConstraintContext)
  if (hardText) {
    const titles = [title, ...coveredTitles]
    const covered = titles.some((candidate) => (
      new RegExp(`(?:^|\\n)${escapeRegExp(candidate)}:\\s*(?:\\n|$)`, 'u').test(hardText)
    ))
    if (covered) return ''
  }
  return section(title, content)
}

export function sectionLines(title: string, lines: Array<string | undefined | null | false>): string {
  const body = lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n')
  return section(title, body)
}

export function isGoldenThreeChapter(chapterNum: number): boolean {
  return chapterNum >= 1 && chapterNum <= 3
}

export function buildGoldenThreeChapterGuidance(chapterNum: number, stage: 'scenePlan' | 'writing' | 'draft' | 'review' | 'rewrite'): string {
  if (!isGoldenThreeChapter(chapterNum)) return ''

  const phaseRules: Record<number, string> = {
    1: '第 1 章职责：前 300 字内必须出现具体现场、主角动作、可感压力和一个读者能立刻追问的问题；禁止从世界观百科、天气长描写、抽象命运感或人物履历开场。',
    2: '第 2 章职责：直接承接第 1 章造成的后果或疑问，必须让至少一项现实状态发生变化（关系、资源、位置、证据、名声或危险），并让一名配角为了自己的利益做出主动决定；禁止像新故事一样重启铺垫。',
    3: '第 3 章职责：必须兑现上一章建立的一条局部问题或证据，再用兑现后的损失、关系后果或暴露风险把主角推入更难退回的选择；禁止只继续投放新文件、新短信或新谜团。',
  }
  const stageRules: Record<'scenePlan' | 'writing' | 'draft' | 'review' | 'rewrite', string> = {
    scenePlan: '场景计划必须把章首钩子、承接动作、首次阻力和章尾递进写成可落地场景，不要只写气氛。',
    writing: '正文前 200 字必须自然承接章节衔接桥；前 800 字内要让读者看见问题、压力和主角的具体行动。',
    draft: '初稿优先保证开篇可读性和承接准确：动作先入场，信息随冲突释放，不要先讲概念。',
    review: '审校必须额外检查黄金三章是否吸引读者：开头是否慢热、标题是否空泛、承接是否断裂、章尾是否缺少追读理由。',
    rewrite: '重写必须先修开篇 800 字和章尾递进，再润色语言；不要只替换词句却保留慢热结构。',
  }

  return section('黄金三章开篇约束', [
    phaseRules[chapterNum],
    stageRules[stage],
    '章节标题必须具体、有场景感或冲突感，避免“开端”“觉醒”“风暴前夜”“命运齿轮”这类万能标题。',
    '不要用夸张噱头硬吊读者；吸引力来自具体困境、人物选择、信息差和可见代价。',
  ].join('\n'))
}

export function buildGoldenThreeOutlineGuidance(chapterStart: number, chapterEnd: number): string {
  if (chapterEnd < 1 || chapterStart > 3) return ''
  return section('黄金三章开篇约束', [
    '第 1 章：前 300 字内给出具体现场、主角动作、可感压力和一个明确追问点；章尾必须把问题递给第 2 章。',
    '第 2 章：承接第 1 章的后果或疑问，落地至少一个现实状态变化、一个配角主动选择和一个持续代价；章尾要把选择压力递给第 3 章。',
    '第 3 章：兑现一条已建立的局部问题或证据，并让兑现带来损失、关系变化或暴露风险；新谜团只能作为次级递进，不能代替本章回报。',
    '前三章 bridge_in / bridge_out 必须形成因果链：上章结果 -> 本章行动 -> 新代价或新问题。',
    '前三章标题必须具体、有场景感或冲突感，避免“开端”“觉醒”“风暴前夜”“命运齿轮”这类万能标题。',
  ].join('\n'))
}

export type StepMemoryStage = 'scenePlan' | 'writing' | 'draft' | 'review' | 'rewrite'
export type GenreExecutionStage = StepMemoryStage

export function buildStepMemoryContinuityGuidance(stage: StepMemoryStage): string {
  const stageRules: Record<StepMemoryStage, string> = {
    scenePlan: '场景计划要把“上一章结果 -> 本章首场动作 -> 本章退出钩子”写成连续因果链，并预留给正文可直接落地的承接动作。',
    writing: '正文必须优先兑现章节衔接桥、连续性记忆和本章目标；如果需要补充细节，只能补“当前上下文已经暗示或允许”的细节。',
    draft: '初稿先保上下文和事件链，后保文采；任何新增人物、地点、能力、资源都要能在已有世界规则或场景计划里找到来源。',
    review: '审校要逐项核对上游计划是否被正文执行，并把断承接、漏伏笔、跑题、标题空泛和 AI 腔列为优先修复项。',
    rewrite: '重写只能在既有计划、审校意见和上下文内修复，不得用删掉压力、改写目标或新增万能设定来绕开问题。',
  }
  return section('步骤记忆接力协议', [
    '本步骤不是孤立生成：上一章关键先验、上章结尾、章节衔接桥、连续性记忆、未回收事项、向量召回记忆和当前故事弧都是硬上下文。',
    stageRules[stage],
    '若上下文之间出现轻微冲突，优先保留明确事实、已写正文、章节合同和世界规则；不确定的内容写成保守推断，不要升级为新事实。',
    '输出必须给下一步骤留下可执行信息：明确谁行动、在哪里、因为什么、付出什么代价、留下什么后续压力。',
  ].join('\n'))
}

export function buildGenreCoreExecutionGuidance(params: {
  genre?: string | null
  novelTitle?: string | null
  storyCore?: string | null
  stage: GenreExecutionStage
}): string {
  const signal = [params.genre, params.novelTitle, params.storyCore].map((item) => item || '').join('\n')
  const isZhiguai = /志怪|民俗|神话|妖|鬼医|治妖|病帖|病例/u.test(signal)
  const isHistoricalDrama = /历史|正剧|革命|工矿|铁路|劳动|组织|纪律|钢铁|保尔/u.test(signal)
  const lines: string[] = []

  if (isZhiguai) {
    lines.push(
      '志怪治妖题材必须每章保留“妖病 -> 人间亏欠/规矩/误解 -> 诊疗选择 -> 病后余味”的闭环；只写妖术、债务或大阴谋不算完成。',
      '每个单元病例要有可见病症、具体患者、牵连的人类困局、主角的医道判断、治疗代价，以及一个治完后仍值得回味的关系变化。',
      '长线谜团只能从病例里长出来，不能把病例压成主线阴谋的线索采集任务；同行关系要轻巧、有温度、有互相遮掩或试探。',
    )
  }

  if (isHistoricalDrama) {
    lines.push(
      '历史正剧/精神锻造题材必须每章保留“具体劳动/制度场景 -> 组织关系或纪律反馈 -> 主角缺陷受挫 -> 能力或信念被重塑”的链条。',
      '苦难不能只写成励志口号；要落在工种、工具、工时、伤病、考核、粮饷、学习、组织谈话或同伴评价这些可验证材料上。',
      '主角成长必须经历冲动、误判、被教育、承担后果和继续工作的过程，不能一开始就像已经完成的英雄。',
    )
  }

  if (lines.length === 0) return ''

  const stageLines: Record<GenreExecutionStage, string> = {
    scenePlan: '场景计划阶段要把上述题材闭环拆进每个 scene 的 purpose / conflict / must_cover / exit_hook，不要只写成主题标签。',
    writing: '正文阶段要把上述题材闭环写在现场动作、对白、物件和结果里，不要靠段尾总结说明主题。',
    draft: '初稿阶段先保证题材闭环完整，再处理文采；缺任一环都视为未完成场景。',
    review: '审校阶段必须逐项检查题材闭环是否落地，并把缺病例闭环、缺劳动组织链、成长口号化写入 genre_hollowing_risks 或 critical_fixes。',
    rewrite: '重写阶段必须补事件和结果，不要只替换词句；优先补缺失的题材闭环环节。',
  }

  return section('题材核心执行链', [
    ...lines,
    stageLines[params.stage],
  ].join('\n'))
}

export function buildRuntimeAssertionSection(assertions?: string[]): string {
  const lines = Array.isArray(assertions)
    ? assertions.map((item) => item.trim()).filter(Boolean)
    : []
  if (lines.length === 0) return ''
  return section('运行时接力断言', [
    '以下断言来自本轮流水线上游步骤，必须优先执行；若与正文事实冲突，按已写正文、章节合同和硬约束校正。',
    ...lines.map((line) => `- ${line.replace(/^[-*]\s*/u, '')}`),
  ].join('\n'))
}

export function buildTitleAndStructureGuidance(scope: 'volume' | 'chapterOutline' | 'scenePlan'): string {
  const scopeRules: Record<'volume' | 'chapterOutline' | 'scenePlan', string> = {
    volume: '卷标题要概括本卷的阶段矛盾或主角处境，能看出卷与卷之间的递进，不要只写抽象意象。',
    chapterOutline: '章节标题必须贴合本章核心事件、场景物件、选择压力或反转点；读者看到标题应能产生具体期待。',
    scenePlan: '场景标题只服务执行，不追求诗意；要能看出场景地点、冲突或动作焦点。',
  }
  return section('标题与结构吸引力', [
    scopeRules[scope],
    '标题避免万能词：开端、觉醒、风暴前夜、命运齿轮、暗流涌动、真相边缘、破局、归途。',
    '卷、章、场景的划分要符合信息密度和冲突密度：一章只承担一个主推进，支线最多 3 条；卷内高潮、喘息和兑现要有节奏差。',
    '标题吸引力来自具体困境、信息差、代价和选择，不靠夸张噱头或空泛诗化。',
  ].join('\n'))
}

export function placeholder(key: string): string {
  return `{${key}}`
}

const VARIATION_HINTS_CHARACTER = [
  '本次侧重从成长弧线和转变节点切入来塑造人物。',
  '本次侧重从关系网络和利益纠葛切入来塑造人物。',
  '本次侧重从创伤、代价和内在矛盾切入来塑造人物。',
  '本次侧重从职业技能、日常习惯和行为细节切入来塑造人物。',
  '本次侧重从秘密、谎言和道德灰色地带切入来塑造人物。',
  '本次侧重从恐惧、软肋和失控时刻切入来塑造人物。',
]

const VARIATION_HINTS_CHAPTER = [
  '本次请以对话冲突作为开场方式。',
  '本次请以环境和氛围描写切入，再过渡到人物动作。',
  '本次请从配角或旁观者的视角起笔，再转回主线视角。',
  '本次请以一个具体的物件或细节作为开篇锚点。',
  '本次请以时间跳跃或回忆闪回作为开场手法。',
  '本次请以动作场景或紧张节奏直接开场。',
]

const VARIATION_HINTS_OUTLINE = [
  '本次侧重外部威胁和环境压力来推进章节结构。',
  '本次侧重内部矛盾和人物关系裂变来推进章节结构。',
  '本次侧重信息差、误解和秘密暴露来推进章节结构。',
  '本次侧重资源争夺和利益博弈来推进章节结构。',
  '本次侧重意外事件和计划失败来推进章节结构。',
  '本次侧重旧伤复发和历史遗留问题来推进章节结构。',
]

const VARIATION_HINTS_MAP = [
  '本次侧重地理阻隔和路线限制来构建地图逻辑。',
  '本次侧重资源分布和控制权争夺来构建地图逻辑。',
  '本次侧重历史遗迹和文化痕迹来构建地图逻辑。',
  '本次侧重危险等级梯度和生存难度来构建地图逻辑。',
  '本次侧重势力边界和缓冲地带来构建地图逻辑。',
]

const VARIATION_HINTS_GENERIC = [
  '本次请尝试与上次不同的切入角度和侧重方向。',
  '本次请优先从实用性和可操作性出发。',
  '本次请侧重矛盾、代价和限制条件。',
  '本次请侧重细节、具体场景和感官信息。',
  '本次请从风险和潜在问题出发来组织内容。',
]

export function buildVariationHint(attemptNumber: number, entityType: VariationEntityType): string {
  if (attemptNumber <= 1) return ''

  const hintsMap: Record<VariationEntityType, string[]> = {
    character: VARIATION_HINTS_CHARACTER,
    chapter: VARIATION_HINTS_CHAPTER,
    outline: VARIATION_HINTS_OUTLINE,
    map: VARIATION_HINTS_MAP,
    generic: VARIATION_HINTS_GENERIC,
  }

  const hints = hintsMap[entityType] || VARIATION_HINTS_GENERIC
  const index = (attemptNumber - 2) % hints.length
  const hint = hints[index]

  return section('创意方向提示', [
    `这是第 ${attemptNumber} 次生成，请确保本次结果与之前有明显差异。`,
    hint,
    '注意：方向提示只是引导，核心设定、世界规则和已锁定条件不能被覆盖。',
  ].join('\n'))
}

export function buildAvoidanceSection(rejectedDigests: string[]): string {
  if (!rejectedDigests || rejectedDigests.length === 0) return ''
  const lines = rejectedDigests.map((digest, i) => {
    const trimmed = digest.slice(0, 150).replace(/\n/g, ' ')
    return `方案${i + 1}摘要："${trimmed}…"`
  })
  return section('避免方向', [
    '以下是之前被否决的生成方案摘要，本次生成必须在核心方向、切入角度和关键设定上与它们明显不同：',
    ...lines,
    '不要只做表面改动（换名字、换措辞），要从根本思路上走不同的路。',
  ].join('\n'))
}

export const HUMAN_LANGUAGE_RULE_LINES = [
  '使用自然、可读的小说中文，先保证句子顺和意思准。',
  '先写清事实、动作、关系和后果，再让情绪与分量自然露出来。',
  '检查主语、谓语、宾语是否搭配准确，动作、状态和后果要符合对象类别。',
  '人或生物才能“死亡、呼吸、哭泣、思考”；电网、系统、组织、设施等非生物应改写为“瘫痪、崩溃、中断、停摆、瓦解”等准确说法。',
  '少用模板化引导词、抽象口号和假深刻表达，多写具体处境、判断依据和行为代价。',
  '避免翻译腔、硬书面语和不合中文语境的搭配，不要为了显得高级而拧巴表达。',
  '普通概念、职业、情绪和判断不要随意加引号；只有称号、制度名、功法名、专有名词才保留引号。',
  '贴近当前题材常见的叙述气质、节奏和措辞密度，不模仿具体作者。',
  '只处理当前字段和当前任务，不擅自扩写到无关领域，不拼接没有直接关系的概念。',
  '如果输入没有明确涉及某个专业领域，不要擅自引入卡路里、感染概率、药理、金融指标、法律结论等外部概念。',
  '不要为了显得高级，硬把两个语义上没有直接关系的词并在一句里。',
  '一旦出现不自然搭配，优先改成读者最熟悉、最直白、最准确的常规说法。',
  '不要在每个字段里都写成"一方面...另一方面..."或"既...又..."的平衡结构，真实人物的矛盾往往偏向一端。',
  '优先直接写事实和差异，避免用"不是……而是……"的解释性对照句；只有人物当场纠正误解时才保留。',
  '对白不要用"声音很轻/很低/压得很低"或"轻声/低声道"反复标注语气，让语气通过用词、停顿、打断和具体动作体现。',
  '不要用"某种"开头的模糊指代来假装深度，要么写清到底是什么，要么不提。',
  '段落结尾不要用一句感悟、总结或升华来收尾，让事件和动作自己说话。',
  '不要反复出现"似乎明白了什么""仿佛在诉说着什么""不知为何"这类伪留白。',
] as const

export function buildHumanLanguageRules(extraLines: string[] = []): string {
  return [...HUMAN_LANGUAGE_RULE_LINES, ...extraLines]
    .map((line) => `- ${line}`)
    .join('\n')
}

export interface PromptGuardrailOptions {
  genre?: string
  background?: string
  storyCore?: string
  worldSummary?: string
  taskFocus: string
  extraContextLines?: string[]
  extraRealityLines?: string[]
  extraQualityLines?: string[]
}

function getGenreRealityBaseline(genre?: string): string {
  return buildRealityConstraintSummary(getBuiltinGenreRules(genre).writingConstraints)
}

function getGenreNarrativeDiscipline(genre?: string): string[] {
  switch (getBuiltinGenreRules(genre).genreProfile.key) {
    case 'zombie':
      return [
        '丧尸题材先保生存链：食水、药物、体力、噪声、路线、感染和收容能力必须彼此挂钩。',
        '人与人的信任、纪律、谣言和利益分配要持续施压，不要把队伍写成自动同心。',
      ]
    case 'xianxia':
      return [
        '修仙题材要同时写境界、资源、宗门秩序、因果和凡俗牵连，不要只剩升级播报。',
        '凡人区域、坊市、散修、邪修、灵兽、异兽、恶灵和秘境都要有实际用途、进入门槛和代价。',
      ]
    case 'wuxia':
      return [
        '武侠题材要让江湖规矩、师承门第、名声、伤病、银钱和路程共同起作用。',
        '写实武侠优先服从史实与社会常识，架空武侠也要保住自己的朝廷、地理和江湖秩序闭环。',
      ]
    case 'modern-mystery':
      return [
        '\u73b0\u4ee3\u60ac\u7591\u8981\u5148\u7ed9\u51fa\u53ef\u8ffd\u67e5\u7684\u5f02\u5e38\u5207\u53e3\uff0c\u518d\u7528\u6863\u6848\u3001\u53e3\u4f9b\u3001\u76d1\u63a7\u3001\u65e7\u95fb\u6216\u8bbf\u95ee\u8bb0\u5f55\u628a\u7ebf\u7d22\u4e32\u8d77\u6765\u3002',
        '\u8981\u540c\u65f6\u5199\u51fa\u73b0\u5b9e\u673a\u6784\u963b\u529b\u3001\u5730\u65b9\u4eba\u60c5\u538b\u529b\u548c\u8c03\u67e5\u4ee3\u4ef7\uff0c\u4e0d\u8981\u53ea\u5806\u795e\u79d8\u6c1b\u56f4\u3002',
      ]
    case 'historical':
      return [
        '历史题材要先判断是真实历史、架空历史还是类历史奇幻；真实历史缺少来源时只能保守表达，不能把编造细节写成史实。',
        '古言、宫斗、权谋也要让礼法、门第、官制、宗族、地理脚程和物资成本进入剧情，不要只剩古风称谓和情绪拉扯。',
      ]
    case 'fantasy':
      return [
        '玄幻题材的爽点要建立在等级差、资源争夺、势力反应和能力边界上，不能只靠旁人震惊和主角突然变强。',
        '每次升级、打脸或反杀都要有前置压迫、可见行动、代价或后续压力，避免奖励无来源。',
      ]
    case 'urban-ability':
      return [
        '都市脑洞、神豪、系统流或异能爽文要同时保留现实身份、职业/生活场景、舆论与执法风险，不能脱离现代社会成本。',
        '爽点要按压迫-反证-行动-兑现-余波推进，避免连续堆“震惊”“后悔”“跪求”这类模板反应。',
      ]
    case 'western-fantasy':
      return [
        '西幻题材要让领地、教会、信仰、军需、阶层礼法和施法材料共同约束行动，不要只写种族标签和魔法奇观。',
        '王国、骑士、教会和异族关系要形成利益网络，每个奇观都要有成本、来源或禁忌。',
      ]
    default:
      return []
  }
}

function getReaderPleasureDiscipline(genre?: string): string[] {
  const text = genre || ''
  if (!/爽文|打脸|逆袭|神豪|系统|赘婿|重生|穿越|脑洞|男频|女频|癫文|发疯/u.test(text)) return []

  return [
    '爽文不是无代价碾压：每个爽点前要有清晰压迫、误判、反证线索或规则限制，兑现时要靠行动、信息差、资源调度或身份反转完成。',
    '打脸段落要控制重复：不要连续写旁观者震惊、反派后悔或路人议论；每次爽点都换一个冲突载体和后续代价。',
    '重生、穿越、系统和金手指要有触发边界、信息盲区和副作用，不能替角色自动解决全部选择。',
    '女频强情绪、癫文或发疯感要服务角色主体性与关系重排，不能退化成无逻辑短句和表情包式重复。',
  ]
}

function getLongFormGrowthRules(genre?: string): string[] {
  const base = [
    '主角不是许愿机或功能块，允许恐惧、迟疑、犯错、失望、开心、嫉妒、心软和阶段性退让。',
    '成长至少落到能力、关系、认知、责任、资源或道德选择中的两项，不要只写成单线变强。',
    '重要遭遇必须改变人物后续判断、关系站位或行动路线，不能只当世界观陈列。',
    '遇到暂时解决不了的问题时，允许人物求援、绕路、隐忍、付费、撤退或承担失败，不要硬开万能解。',
    '长篇推进里要持续追踪伤、债、名声、身份、物资、承诺和后遗症，让变化能累计。',
  ]

  switch (getBuiltinGenreRules(genre).genreProfile.key) {
    case 'zombie':
      return [...base, '末世成长重点是判断、纪律、信任和取舍，不是突然无敌。']
    case 'xianxia':
      return [...base, '修仙成长还要写闭关、破境失败、资源枯竭、师承压力和凡俗牵挂的长期影响。']
    case 'wuxia':
      return [...base, '武侠成长要写出见闻、挫败和行路中的选择，别把江湖磨成单纯打怪线。']
    case 'modern-mystery':
      return [...base, '\u73b0\u4ee3\u60ac\u7591\u7684\u6210\u957f\u8981\u843d\u5230\u5224\u65ad\u3001\u4fe1\u4efb\u3001\u627f\u538b\u80fd\u529b\u548c\u771f\u76f8\u4ee3\u4ef7\uff0c\u4e0d\u662f\u5355\u7eaf\u53d8\u6210\u66f4\u4f1a\u89e3\u8c1c\u7684\u4eba\u3002']
    default:
      return base
  }
}

export function buildContextAlignmentRules(params: {
  background?: string
  storyCore?: string
  worldSummary?: string
  taskFocus: string
  extraLines?: string[]
}): string {
  return [
    '只沿着当前背景、主题、世界规则和已知人物处境继续往下写。',
    '已有地点、势力、体系、资源和关系链优先复用，确有必要再新增。',
    '如果上下文不完整，选择最保守、最贴合当前题材和既有设定的延伸方案。',
    '每个新增事件或细节都要回答：为什么是现在、谁在推动、代价落在谁身上、之后改变了什么。',
    params.background ? '背景设定仍是本轮生成的第一锚点。' : '',
    params.storyCore ? '故事目标、核心冲突和主线推进是不能越界的硬边界。' : '',
    params.worldSummary ? '若给定世界摘要里没有支持某条规则、能力、机构或技术，就不要自行补造。' : '',
    params.taskFocus ? `本轮任务焦点：${params.taskFocus}` : '',
    ...(params.extraLines || []),
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

export function buildGenreRealityRules(params: {
  genre?: string
  worldSummary?: string
  extraLines?: string[]
}): string {
  return [
    '现实向题材默认要遵守常识、常规科学和常规物理，除非给定设定已经明确推翻了它们。',
    '幻想向题材可以有超常元素，但必须落在既定体系、等级、代价、触发条件和社会规则里。',
    getGenreRealityBaseline(params.genre),
    ...getGenreNarrativeDiscipline(params.genre),
    ...getReaderPleasureDiscipline(params.genre),
    params.worldSummary ? '如果题材默认与已给定世界摘要冲突，优先服从已给定的世界摘要，但不能与现有事实相矛盾。' : '',
    ...(params.extraLines || []),
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

export function buildOutputQualityRules(extraLines: string[] = [], genre?: string): string {
  return [
    '先写具体事实、动作、条件和后果，再写情绪、意义或评价。',
    '不要写口号腔、平台文案腔、百科腔、空洞概括或假深刻结论。',
    '避免翻译腔、硬书面语和不符合中文语境的词语搭配。',
    '人物行为必须匹配身份、信息量、伤势、体力、资源、环境和利害压力。',
    '拿不准时，选择最直白、最符合常识的说法，不要硬造新奇感。',
    '如果设定里有超常能力，同时要交代触发条件、限制或代价。',
    ...getReaderPleasureDiscipline(genre),
    ...(genre ? getLongFormGrowthRules(genre) : []),
    ...extraLines,
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

export function buildHumanizedLongformDesignRules(params: {
  genre?: string
  taskFocus?: string
  extraLines?: string[]
} = {}): string {
  const genreKey = getBuiltinGenreRules(params.genre).genreProfile.key
  const genreSubstrate: Record<string, string[]> = {
    zombie: [
      '末世每个推进点都要挂到食水、药品、感染、噪声、路线、体力、收容名额或信任分配中的至少一项。',
      '不要只写尸潮和绝望，要让补给链、守夜制度、伤病隔离和队伍纪律持续改变人物选择。',
    ],
    xianxia: [
      '修仙每个推进点都要挂到境界差、灵石丹药、宗门门规、师承因果、坊市交易或凡俗牵连中的至少一项。',
      '不要只写悟道和机缘，要让资源来源、破境风险、门派权限和因果债真正限制行动。',
    ],
    wuxia: [
      '武侠每个推进点都要挂到江湖规矩、师承门第、名声、盘缠、伤药、路程、官府或人情债中的至少一项。',
      '不要只写招式和气势，要让行路成本、名声后果、门规和旧债持续进入冲突。',
    ],
    'modern-mystery': [
      '现代悬疑每个推进点都要挂到证据载体、访问路径、时间线、机构阻力、地方人情或调查代价中的至少一项。',
      '不要只写压抑和秘密，要让档案、监控、通联、口供和现实权限推动线索变化。',
    ],
    historical: [
      '历史题材每个推进点都要挂到身份名分、官制礼法、地理脚程、军政后勤、赋税粮饷、宗族或地方秩序中的至少一项。',
      '不要只写朝堂气氛和宏大判断，要让文书传递、舟车速度、时代器物、利益网络和制度成本真正限制人物。',
    ],
    fantasy: [
      '玄幻每个推进点都要挂到等级差、能力边界、资源消耗、势力反应、装备来源、地图层级或身份后果中的至少一项。',
      '不要只写威压、震撼和升级，要让能力限制、成长成本、争夺对象和阵营关系持续改变局势。',
    ],
    'urban-ability': [
      '都市异能每个推进点都要挂到现实身份、职业日常、能力触发、副作用、监控痕迹、组织规程或暴露后果中的至少一项。',
      '不要只写异能展示和打脸，要让现代社会的取证、舆论、执法、收入与生活压力持续进入冲突。',
    ],
    'western-fantasy': [
      '西幻每个推进点都要挂到领地治理、阶层礼法、行军后勤、信仰秩序、施法代价、仪式材料或种族关系中的至少一项。',
      '不要只写魔法奇观和种族标签，要让交通、税收、军需、教会权力与盟约旧债持续限制选择。',
    ],
    generic: [
      '未细分题材也要让每个推进点挂到因果、资源、身份、规则、关系或行动条件中的至少一项。',
      '不要只写气氛和设定说明，要让约束进入现场并改变人物的选择、损耗和后续压力。',
    ],
  }

  return [
    '把每章当成长篇账本的一次交易：新增信息、人物选择、资源变化、关系温度、风险余波和待回收事项都要有明确增减。',
    '章节内容至少承担两类真实功能：行动推进、信息揭示、关系变形、代价延续、伏笔回收、世界规则验证、节奏喘息。',
    '同一章内不要连续使用同一种冲突载体；在物理阻力、制度阻力、人际阻力、资源阻力、认知误差和道德取舍之间轮换。',
    '跨章避免重复不是换词，而是更换开场入口、冲突承载物、对白权力关系、场景空间、感官焦点和章尾钩子类型。',
    '新设定必须有来源：既有资产支持、当前场景可观察、角色合理推断三者至少满足一项；否则只能写成猜测，不得写成定论。',
    '长期人物变化要有台阶：一次事件只能推动有限变化，不能让人物突然完成全部理解、和解、变强或转性。',
    '每个重要选择都写出被放弃的选项和承担后果的人，避免所有困难被一句正确决定抹平。',
    '对白优先承载立场、试探、隐瞒、命令、讨价还价或关系温度，不要让对白只负责解释设定。',
    '场景细节只保留会改变判断、行动、关系或后果的部分；低价值身体细节和空转氛围要主动删减。',
    '生成目标是提高成稿质量、原创性和可读性，并保留合规标识与人工确认流程，不把规则写成规避平台声明或伪装来源。',
    params.taskFocus ? `本轮人类化重点：${params.taskFocus}` : '',
    ...(genreSubstrate[genreKey] || []),
    ...getReaderPleasureDiscipline(params.genre),
    ...(params.extraLines || []),
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

export function buildPromptGuardrailSections(options: PromptGuardrailOptions): string[] {
  return [
    section('上下文护栏', buildContextAlignmentRules({
      background: options.background,
      storyCore: options.storyCore,
      worldSummary: options.worldSummary,
      taskFocus: options.taskFocus,
      extraLines: options.extraContextLines,
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: options.genre,
      worldSummary: options.worldSummary,
      extraLines: options.extraRealityLines,
    })),
    section('长篇人类化叙事设计', buildHumanizedLongformDesignRules({
      genre: options.genre,
      taskFocus: options.taskFocus,
    })),
    section('输出质量底线', buildOutputQualityRules(options.extraQualityLines || [], options.genre)),
  ]
}

export const GLOBAL_WRITING_RULES = `你现在写的是可直接入稿的中文小说正文。

核心规则：
1. 先把事件、动作、条件和后果写清，再进情绪和意义。
2. 情绪要落在动作、反应、对话、停顿和细节上，不要用抽象评语代替。
3. 对话要像这个人在当下压力里真会说的话——每个角色必须有辨识度的说话方式。
4. 句子保持自然，避免刻意对称、假深刻和过度修辞。
5. 无论什么时候，都要服从当前章节任务、人物状态、世界规则和连续性。
6. 主语、谓语、宾语必须搭配成立，不要给物体、系统或建筑安上只有人才有的生命状态。
7. 贴近当前题材常见的叙事质感，但不模仿具体作者。
8. 除非当前世界规则已经明确允许，不要自行发明新能力、技术跃迁、奇迹恒复、免费资源或瞬间全员达成一致。
9. 不要写成翻译腔、说明书腔或平台宣传腔，优先使用中文读者熟悉的自然表达。
10. 对话辨识度：如果人物状态中给了说话方式、口头禅、用词水平或方言特征，必须体现在对话中。不同角色的对话应一眼可辨。
11. 对话真实感：允许打断、省略、答非所问、沉默代替回答。上下级说话不同调，亲人和陌生人不同温度，紧张时短句碎句，放松时废话和口头禅变多。
12. 段落和句子要有自然参差：允许短段、长段、半截被打断的对白和不完美停顿，不要把每段都收成整齐的结论句。
13. 每个场景或关键叙事单元至少完成一次可追踪变化：有人做选择、让步、隐瞒、误判、损失资源、改变关系或获得新信息；场景未完成时不要因达到某个字数提前结束，已经完成时也不要为凑篇幅重复动作或解释。
14. 允许信息不完美：人物可以估错数字、迟疑官文措辞、误读对方意图；不要把旁白写成全知报告。
15. 历史、权谋、战争、现实题材优先写制度、路程、粮饷、官职、账册、传报、伤亡、天气和地形这些硬材料，少靠气氛词撑篇幅。
16. 不要把“去 AI 味”写成口语化灌水；真正的人类质感来自具体观察、取舍、偏见、遗漏和不完全漂亮的节奏。
17. 作者原始描述里的独特词、职业现场、物件和观察角度优先于常见套路；可以整理结构，但不要把它们改写成统一的“高概念简介腔”。信息不足时保留空白或局部不确定，不要擅自补成完整设定。

阻塞坏习惯（检测到会被强制修改）：
- “突然””不由得””这一刻””顷刻之间”这类万能起手——改为直接写动作
- 深吸一口气、攥紧拳头、瞪大眼睛、僵在原地——优先删掉冗余反应，或改成与当前冲突有关的选择和动作；正常停顿、比喻不必一律禁用
- “命运的齿轮””冥冥之中””也许这就是”——删掉，用事件本身说话
- 给普通概念乱加引号——去掉引号，只有专有名词保留
- 用破折号偷懒解释或做假揭示——改成正常叙述
- “嘴角微微上扬””目光深邃””心中涌起一股暖流””不由自主地”——换成具体的面部肌肉运动、手部动作或呼吸变化
- “系统死亡””城市哭泣””门感到愤怒”——物体用”瘫痪””破败””卡住”等准确动词
- 把重伤、物资短缺、秩序崩塌写成零代价解决——必须有伤、有债、有后遗症
- “某种说不清的””无法言喻的”——要么写清楚是什么，要么不提
- 每段结尾都用一句感悟或总结收尾——让事件自己说话，砍掉读后感
- “一方面…另一方面…””既是…也是…更是…”——真实人物的矛盾偏向一端
- “不是…而是…”式解释性对照——直接写事实、误判和后果，只有人物当场纠正误解时才保留
- “或许这就是””这一刻他终于明白”——伪哲学总结，直接删除
- “阳光洒在””月光如水””微风拂过”——换成当前场景独有的环境细节
- 连续两段以上使用相同句式结构——刻意打破节奏
- “与此同时””在另一边””不知过了多久”——用具体时间锚点或动作衔接
- “忽然明白了””恍然大悟””终于理解了”——用行动或决策体现领悟，不要直说
- “心中满是[情感]””心头涌上一阵[情感]”——把情绪落在身体反应和行为上
- “这一刻，他/她感受到了……”——删掉前缀，直接写感受到的具体事物
- “不知为何””莫名地””说不上来的”——要么找到原因写清楚，要么用具体反应代替
- “仿佛在诉说着什么””好像在暗示什么”——要么明确写出诉说/暗示的内容，要么删掉
- “眼中闪过一丝[情绪]””眼眸中带着[情绪]”——改为这个情绪导致的具体行为
- “缓缓开口””淡淡地说””轻声道”——直接写对话内容，从语气和用词体现态度
- “声音很轻””声音很低””声音压得很低”——删掉统一的软化标签，让语气落在具体措辞、停顿和动作上
- “事情远没有那么简单””这只是开始”——用下一个事件证明复杂性，不要空喊
- “他的内心无比[形容词]””她的心情十分[形容词]”——心理描写要通过感官细节和内心独白，不要贴标签
- “一切都在朝着好的/坏的方向发展”——写具体发生了什么事，让读者自己判断方向
- 同类意象一章反复出现（雨、雾、风、铁声、旧木、刀、船板等）——只保留能改变行动或判断的 1 到 2 处
- 每段都用漂亮动作或感悟关门——打破过度工整，让部分段落停在未答复、账册数字、脚步声或下一道命令上
- 先给抽象结论再举例证明——改为先写证据、动作和后果，让读者自己得出结论
- 旁白替角色做完全部判断——让角色在对白、误判、回避和补救里暴露立场

对比示例（坏→好）：
- 坏：”心中涌起一股复杂的情绪” → 好：”他把烟掐灭了，手指尖被烫得发白”
- 坏：”命运的齿轮开始转动” → 好：”审批单被驳回的第三天，他等来了另一封信”
- 坏：”阳光洒在脸上，带着一丝暖意” → 好：”防水布拉开一条缝，刺目的光让他眯了眼”
- 坏：”她不由自主地握紧了拳头” → 好：”她把钥匙攥在掌心，金属齿硌进肉里”

输出：
- 只输出最终正文
- 只用纯文本分段`.trim()

export function formatTargetWordsBand(targetWords: number): string {
  const target = Math.max(0, Math.round(targetWords || 0))
  if (target < 300) return '篇幅参考：' + target + ' 字左右（仅用于估算，不是硬性字数）'
  return '篇幅参考：约 ' + target + ' 字（非硬性字数上下限；以场景完整、冲突结果、人物变化和自然收束为准。关键章可以更长，过渡章可以更短，不得为了凑字数加戏或删掉必要剧情）'
}
