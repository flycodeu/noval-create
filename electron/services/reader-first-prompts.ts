import { section, sectionUnlessCovered } from '../../src/shared/prompts/prompt-common'
import { compileNarrativeTechniques, type NarrativeTechniqueScene } from '../../src/shared/narrative-techniques'
import type { NarrativeInputIdentity } from '../../src/shared/narrative-policy'

export interface NarrativePromptOptions {
  outputFormat?: 'patch'
  scenePlan?: string
  sceneWritingBrief?: string
  narrativeIdentity?: NarrativeInputIdentity
  narrativeScenes?: NarrativeTechniqueScene[]
}
export type ReaderFirstRole = 'planner' | 'writer' | 'critic' | 'rewriter'
type PromptParams = Record<string, unknown> & NarrativePromptOptions
const text = (params: PromptParams, key: string) => typeof params[key] === 'string' ? params[key] as string : ''

const FACT_FIELDS = [
  ['storyCore', '本书立意'], ['currentArc', '当前故事阶段'], ['worldRules', '世界规则'],
  ['mapSummary', '地点与路线'], ['previousChapterContext', '相关前章原文'], ['lastChapterEnding', '前章结尾'],
  ['chapterBridgePlan', '本章承接'], ['dueForeshadows', '已安排回应的事项'], ['timelineSummary', '已知时间线'],
  ['timelineOpenThreads', '时间线待续'], ['longTermMemory', '相关旧事'], ['recalledMemory', '召回依据'],
  ['consistencyNotes', '连续性核对'], ['activeThreads', '相关支线'],
] as const
const COVERED_FIELDS = [
  ['chapterGoal', '本章目标', '章节目标'], ['writingContractSummary', '写作合同', '写作合同/章节合同'],
  ['characterStates', '人物当前状态', '人物当前状态'], ['worldStates', '当前世界状态', '当前世界状态'],
  ['relationSummary', '关键人物关系', '关键人物关系'], ['itemSummary', '关键物品去向', '关键物品去向'],
  ['openLoops', '必须回收事项', '必须回收事项'], ['continuityNotes', '必须承接', '必须承接'],
] as const
const COMMON = [
  '依据顺序：已确认事实和知识边界、作者明确合同、本场目标与人物关系、作品声音、可选写法。人物猜测和未来计划不当作已发生事实。',
  '普通陈设、生活动作和感受可在既有世界与视角内合理创造；决定脱困的新钥匙、新能力、关键证据、关系或背景真相需要已有依据或先确认计划，不能临时补出解决条件。',
  '句段长短跟随人物注意和现场需要。直接心理、长描写、日常交流和安静收束均可成立；表达已使读者明白的意思无需再解释一次。',
]
const ROLE_RULES: Record<ReaderFirstRole, string[]> = {
  planner: ['规划能被写出来的具体经历：谁在何时何地做什么、为何接着做下一件事。合法日常可以只完成一次约定或相处。', '依已有合同安排场景，保留人物各自诉求和谁知道什么；秘密、反转、代价与主题回应只在本场确有需要时安排，允许相关字段为空。'],
  writer: ['直接完成可阅读的首稿，写眼前的人怎样行动、回应和注意事物。沿用认可样稿或本书既有正文的叙述距离和人物口吻，不复制样稿句子与情节。', '逐场承接已有计划，关系、物品和未完动作的变化要有来由。生活细节和审美体验可停留到其自身完成，收束不以另造危险为条件。'],
  critic: ['只判断当前稿是否使读者读乱、重复理解或误解人物选择，引用当前正文的连续原句说明原因与最小修改范围。缺少证据时说明不能判断。', '正常长句、心理、职业词与有意重复不是作者身份依据。风格偏好是建议；已证实的事实/格式/明确合同问题单独表达。没有使用某项文学方法不构成缺陷。'],
  rewriter: ['只修复有当前正文证据且被要求处理的问题，保留有效句子、叙述距离、人物口吻与锁定段落；不为显示改过而扩大范围。', '局部重复可以直接删除。因果缺口需要新关键事实时返回计划建议，不擅自编造动机和解围条件；不添加总结句替读者确认本段意义。'],
}
const PLANNER_SCHEMA = '只输出非空 JSON 数组。每项字段：scene_order（正整数）、scene_title、purpose、location、time_anchor、present_characters（字符串数组）、key_items（字符串数组）、conflict、beat、must_cover（字符串数组）、climax_variant、exit_hook、hidden_agendas（字符串数组）、irony_gap、audience。除说明为数组/数字者均为字符串，可选主题字段 theme_question/theme_choice/theme_cost/theme_consequence 也为字符串。不承担的设计字段用空串或空数组，不增加其他字段。'
const CRITIC_SCHEMA = '只输出 JSON 对象：{"summary":"根据具体正文判断","strengths":[],"critical_fixes":[],"continuity_risks":[],"coherence_risks":[],"hallucination_risks":[],"language_risks":[],"human_language_repairs":[],"missing_payoffs":[],"severity":"low","rewrite_required":false,"revision_brief":"","verdicts":[]}。风险项写作“问题。【证据】正文连续原句”，不得捏造引文。verdicts 可用 contract_delivery/structural_beat/cost_and_choice/supporting_agency/dialogue_voice/prose_economy，status 为 pass/warning/blocker/uncertain，附 summary、suggestion、evidence:[{excerpt,explanation}]；不适用或无证据不补强判定。动作由质量 policy 校验，不由 rewrite_required 自行授权。'

export function buildReaderFirstRolePrompt(role: ReaderFirstRole, params: PromptParams): string {
  const hard = text(params, 'hardConstraintContext')
  const methodMaterial = compileNarrativeTechniques(params.narrativeScenes || [])
  const parts = [
    `${role === 'planner' ? '规划本章场景' : role === 'critic' ? '审读本章正文' : role === 'rewriter' ? '修订本章正文' : '写本章正文'}：${text(params, 'novelTitle')} · 第 ${params.chapterNum} 章 ${text(params, 'chapterTitle')}`,
    section('写作依据', [...COMMON, ...ROLE_RULES[role]].join('\n')),
    section('题材与当下语气', [text(params, 'genre'), text(params, 'emotionTone')].filter(Boolean).join('；')),
    (role === 'planner' || role === 'writer') && typeof params.targetWords === 'number' && params.targetWords > 0
      ? section('篇幅', `本章目标约 ${params.targetWords} 字，按场景需要安排详略，不用重复解释或无关事件凑字。`) : '',
    section('硬约束', hard),
    ...COVERED_FIELDS.map(([key, title, covered]) => sectionUnlessCovered(title, text(params, key), hard, [covered])),
    ...FACT_FIELDS.map(([key, title]) => section(title, text(params, key))),
    !text(params, 'previousChapterContext') ? section('前章摘要', text(params, 'previousSummaries')) : '',
    section('人物声音', text(params, 'dialogueVoiceLocks')),
    section('视角边界', text(params, 'protagonistRule')),
    section('视角指导', text(params, 'povGuidance')),
    role === 'planner' ? section('本章已有安排', text(params, 'plotPoints')) : section('场景计划', text(params, 'scenePlan')),
    section('作品表达参考', text(params, 'sceneWritingBrief')),
    (role === 'planner' || role === 'writer') ? section('本场可选写法', methodMaterial.text) : '',
    role === 'critic' || role === 'rewriter' ? section('待处理正文', text(params, 'draftContent')) : '',
    role === 'rewriter' ? section('本次修订要求', text(params, 'reviewNotes')) : '',
    role === 'rewriter' && Array.isArray(params.lockedParagraphs) ? section('锁定段落（逐字保留）', params.lockedParagraphs.join('\n\n')) : '',
    role === 'planner' ? PLANNER_SCHEMA : role === 'critic' ? CRITIC_SCHEMA : params.outputFormat === 'patch'
      ? '只输出本次修订要求中的 C-07 补丁 JSON，不输出整章正文或检查过程。'
      : '只输出小说正文，不输出标题、分析、检查过程、计划、规则或自述。',
  ]
  const seen = new Set<string>()
  return parts.filter((part) => { if (!part || seen.has(part)) return false; seen.add(part); return true }).join('\n\n')
}
