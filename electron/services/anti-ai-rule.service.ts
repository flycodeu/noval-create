import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import { analyzeLanguageDrift, type LanguageDriftMetrics } from '../../src/shared/language-drift'
import {
  collectQualityGuardrailFindings,
  getBuiltinAntiAiPromptRules,
  type AntiAiPromptRuleBucket,
  type GuardrailSeverity,
  type TextGuardrailFinding,
} from '../../src/shared/content-guardrails'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { getDb } from '../database/db'
import { antiAiRuleHits, revisionTasks } from '../database/schema'

export type AntiAiRuleHitScope = AntiAiPromptRuleBucket | 'genre' | 'drift' | 'quality'
export type AntiAiRuleHitSource = 'guardrail' | 'language_drift'

export interface AntiAiRuleHitDraft {
  ruleCode: string
  ruleTitle: string
  scope: AntiAiRuleHitScope
  severity: GuardrailSeverity
  excerpt: string
  source: AntiAiRuleHitSource
  detail: string
}

export interface AntiAiPromotedRule {
  ruleCode: string
  ruleTitle: string
  scope: AntiAiRuleHitScope
  chapterNums: number[]
  avoid: string
  prefer?: string
}

export interface AntiAiRuleHitSummary {
  ruleCode: string
  ruleTitle: string
  scope: AntiAiRuleHitScope
  severity: GuardrailSeverity
  chapterCount: number
  hitCount: number
  promotedCount: number
  chapterNums: number[]
  lastChapterNum: number
  sourceBreakdown: Record<AntiAiRuleHitSource, number>
  detail: string
}

export interface AntiAiRecentAlert {
  ruleCode: string
  ruleTitle: string
  severity: 'warning' | 'critical'
  chapterNums: number[]
  lastChapterNum: number
  detail: string
}

export interface AntiAiChapterSignal {
  chapterId: number
  chapterNum: number
  hitCount: number
  promotedRuleCount: number
  highRiskRuleCount: number
  rules: Array<{
    ruleCode: string
    ruleTitle: string
    severity: GuardrailSeverity
    source: AntiAiRuleHitSource
    excerpt: string
    promotedToHardConstraint: boolean
  }>
}

export interface AntiAiDashboardSummary {
  overview: {
    totalHitCount: number
    hitChapterCount: number
    recurringRuleCount: number
    promotedRuleCount: number
    highRiskRuleCount: number
  }
  topRepeatedRules: AntiAiRuleHitSummary[]
  promotedRules: AntiAiPromotedRule[]
  recentAlerts: AntiAiRecentAlert[]
  chapterSignals: AntiAiChapterSignal[]
}

type AntiAiRuleDescriptor = {
  title: string
  scope: AntiAiRuleHitScope
  avoid: string
  prefer?: string
}

type AntiAiRuleHitRowLike = {
  chapterId: number | null
  chapterNum: number | null
  ruleCode: string | null
  ruleTitle?: string | null
  scope?: string | null
  severity?: string | null
  excerpt?: string | null
  source?: string | null
  promotedToHardConstraint?: number | null
  detail?: string | null
}

const RULE_SCOPE_FALLBACK: Record<string, AntiAiRuleHitScope> = {
  ai_slogan: 'expression',
  ai_opener: 'sentence',
  ai_action_cliche: 'sentence',
  ai_emotional_cliche: 'sentence',
  ai_description_cliche: 'expression',
  ai_dialogue_filler: 'sentence',
  zero_cost_resolution: 'quality',
  relation_labelization: 'structure',
  abstract_emotion_packaging: 'expression',
  world_rules_hollowing: 'structure',
  ai_symmetry: 'sentence',
  ai_pseudo_philosophy: 'structure',
  template_emotion: 'sentence',
  ai_transition_cliche: 'sentence',
  ai_ending_summary: 'structure',
  ai_repetitive_structure: 'sentence',
  genre_hollowing: 'genre',
  high_frequency_repetition: 'sentence',
  object_category_mismatch: 'quality',
  id_pollution: 'quality',
  prompt_leak: 'quality',
  ai_process_leak: 'quality',
  dash_abuse: 'sentence',
  parenthetical_explanation_abuse: 'sentence',
  not_but_definition_pattern: 'sentence',
  double_metaphor_or_simile_stack: 'expression',
  parallelism_overuse: 'sentence',
  low_value_body_detail: 'sentence',
  eye_open_close_standalone_paragraph: 'sentence',
  soft_voice_cliche: 'sentence',
  abstract_token_density_high: 'drift',
  sentence_pattern_repeat_high: 'drift',
  ending_summary_rate_high: 'drift',
  ornament_overload_rate_high: 'drift',
  non_human_collocation_high: 'drift',
  dash_density_high: 'drift',
  parenthetical_explanation_density_high: 'drift',
  metaphor_stack_rate_high: 'drift',
  parallelism_rate_high: 'drift',
  body_detail_cliche_rate_high: 'drift',
  isolated_template_paragraph_rate_high: 'drift',
}

const RULE_DESCRIPTOR_MAP: Record<string, AntiAiRuleDescriptor> = {
  ai_slogan: {
    title: '口号化空词',
    scope: 'expression',
    avoid: '不要写“命运的齿轮、某种无法言说、灵魂深处、这就是所谓的”这类空词套话。',
    prefer: '把判断拆成动作、后果和可见细节。',
  },
  ai_opener: {
    title: '万能开头',
    scope: 'sentence',
    avoid: '不要用“突然、这一刻、就在这时”做万能开头。',
    prefer: '直接从动作、阻力或异常切入。',
  },
  ai_action_cliche: {
    title: '模板动作',
    scope: 'sentence',
    avoid: '不要反复写“深吸一口气、瞳孔骤缩、双拳紧握”这类模板动作。',
    prefer: '改成角色特有的身体反应或失误。',
  },
  ai_emotional_cliche: {
    title: '模板情绪句',
    scope: 'sentence',
    avoid: '不要用“心中涌起一股、百感交集、热泪盈眶”包办情绪。',
    prefer: '把情绪落到姿势、呼吸、说话方式和选择上。',
  },
  ai_description_cliche: {
    title: '空泛氛围描写',
    scope: 'expression',
    avoid: '不要堆“阳光洒在、空气中弥漫着、阴影笼罩”这类空泛描写。',
    prefer: '只保留会改变判断和行动的环境细节。',
  },
  ai_dialogue_filler: {
    title: '对白空话',
    scope: 'sentence',
    avoid: '不要让对白靠“你知道吗、说实话、事实上”起势。',
    prefer: '让对白承担试探、回避、命令或信息交换。',
  },
  zero_cost_resolution: {
    title: '零成本解决',
    scope: 'quality',
    avoid: '不要把重大冲突、伤势或资源问题写成零成本解决。',
    prefer: '让代价、损耗、后续压力继续存在。',
  },
  relation_labelization: {
    title: '关系标签化',
    scope: 'structure',
    avoid: '不要只用“盟友、宿敌、恋人、师徒”标签直接说明关系。',
    prefer: '用称呼、站位、潜台词和利益冲突证明关系。',
  },
  abstract_emotion_packaging: {
    title: '抽象情绪包装',
    scope: 'expression',
    avoid: '不要用“复杂情绪、宿命感、安全感、压迫感”代替具体反应。',
    prefer: '把情绪拆成动作、感官和后果。',
  },
  world_rules_hollowing: {
    title: '世界规则空心化',
    scope: 'structure',
    avoid: '不要只写“制度森严、法则完善、体系严密”而没有执行方式和代价。',
    prefer: '写清规则如何约束行动、资源和惩罚。',
  },
  ai_symmetry: {
    title: '对称排比',
    scope: 'sentence',
    avoid: '不要滥用“一方面…另一方面…”或“既是…也是…更是…”这类对称排比。',
    prefer: '让句子跟着人物思路自然倾斜。',
  },
  ai_pseudo_philosophy: {
    title: '伪哲学升华',
    scope: 'structure',
    avoid: '不要用“或许，这就是 / 也许，这便是 / 这一刻他终于明白”做硬升华。',
    prefer: '让结果和余波自己收尾，不替读者总结。',
  },
  template_emotion: {
    title: '低配模板情绪',
    scope: 'sentence',
    avoid: '不要高频复用“不禁、不由得、微微一愣、嘴角微微上扬”这类低配模板句。',
    prefer: '换成身份、关系和情境专属的即时反应。',
  },
  ai_transition_cliche: {
    title: '万能转场',
    scope: 'sentence',
    avoid: '不要靠“与此同时、在另一边、不知过了多久、就这样”硬转场。',
    prefer: '用时间节点、空间变化和动作承接过渡。',
  },
  ai_ending_summary: {
    title: '总结式章尾',
    scope: 'structure',
    avoid: '不要用“而这一切才刚刚开始、故事远没有结束”这类总结式章尾。',
    prefer: '让风险余波、未完成动作或下一步选择收尾。',
  },
  ai_repetitive_structure: {
    title: '句式重复',
    scope: 'sentence',
    avoid: '不要连续多句沿用同一种句法骨架。',
    prefer: '打散句长、主语、切入角度和节奏。',
  },
  genre_hollowing: {
    title: '题材生态空心化',
    scope: 'genre',
    avoid: '不要只写题材气氛词，不补制度、资源、线索或生存链。',
    prefer: '把题材真正依赖的生态细节写回现场。',
  },
  high_frequency_repetition: {
    title: '高频词组重复',
    scope: 'sentence',
    avoid: '不要在短距离内重复同一描写词组。',
    prefer: '删减重复并改成同义表达或不同观察角度。',
  },
  object_category_mismatch: {
    title: '对象类别错配',
    scope: 'quality',
    avoid: '不要把地点、组织、设施写成人类才有的生命状态。',
    prefer: '按对象类别写物理状态、运行状态或结构状态。',
  },
  id_pollution: {
    title: '内部标识泄露',
    scope: 'quality',
    avoid: '不要把角色、场景、线程等内部编号直接写进正文。',
    prefer: '只保留读者能感知的自然称呼。',
  },
  prompt_leak: {
    title: '提示词泄露',
    scope: 'quality',
    avoid: '不要把场景计划、must_cover、exit_hook 这类提示词残留进正文。',
    prefer: '只输出故事文本本身。',
  },
  ai_process_leak: {
    title: 'AI过程泄露',
    scope: 'quality',
    avoid: '不要把“AI生成中、思考过程、以下是优化、修订建议”等工作流文字写入正文。',
    prefer: '正文只保留读者可见的故事文本。',
  },
  dash_abuse: {
    title: '破折号滥用',
    scope: 'sentence',
    avoid: '不要用破折号频繁插解释、补设定或制造假停顿。',
    prefer: '把补充信息拆成自然动作、对白或独立叙述句。',
  },
  parenthetical_explanation_abuse: {
    title: '括号说明滥用',
    scope: 'sentence',
    avoid: '不要在正文中用括号解释设定、提示写法或补作者备注。',
    prefer: '把必要信息写进人物判断、现场证据或自然叙述。',
  },
  not_but_definition_pattern: {
    title: '否定定义句',
    scope: 'sentence',
    avoid: '不要反复使用“不是……而是/是……”式工整定义句。',
    prefer: '让人物通过行动和选择证明变化，不用旁白下定义。',
  },
  double_metaphor_or_simile_stack: {
    title: '双重比喻堆叠',
    scope: 'expression',
    avoid: '不要连续写“像……又像……”“仿佛……又仿佛……”等双重比喻。',
    prefer: '只保留一个真正有信息量的感官落点。',
  },
  parallelism_overuse: {
    title: '排比堆叠',
    scope: 'sentence',
    avoid: '不要为了整齐强行写排比、递进和平衡句。',
    prefer: '让句子跟随角色当下注意力自然移动。',
  },
  low_value_body_detail: {
    title: '低价值身体细节',
    scope: 'sentence',
    avoid: '不要高频堆手指、指节、指腹、瞳孔、睫毛、喉咙和声音很轻这类细节。',
    prefer: '改成推动行动、暴露立场或造成后果的细节。',
  },
  eye_open_close_standalone_paragraph: {
    title: '孤立模板动作段',
    scope: 'sentence',
    avoid: '不要把“他睁眼/闭眼/抬头/低头”单独成段当节拍。',
    prefer: '把动作并入具体判断、阻力、对白或下一步行动。',
  },
  soft_voice_cliche: {
    title: '轻声低声模板',
    scope: 'sentence',
    avoid: '不要用“声音很轻、声音很低、轻声说”反复替代人物声音。',
    prefer: '用措辞、称呼、停顿和信息保留区分人物声音。',
  },
  abstract_token_density_high: {
    title: '抽象词密度过高',
    scope: 'drift',
    avoid: '不要让抽象感受词持续压过具体场景。',
    prefer: '增加具体动作、感官和可验证结果。',
  },
  sentence_pattern_repeat_high: {
    title: '句式重复率过高',
    scope: 'drift',
    avoid: '不要连续使用同一种句法节奏。',
    prefer: '打散短中长句和叙述切口。',
  },
  ending_summary_rate_high: {
    title: '段尾升华率过高',
    scope: 'drift',
    avoid: '不要频繁用总结句和感悟句收尾。',
    prefer: '让段尾停在动作余波或风险悬念上。',
  },
  ornament_overload_rate_high: {
    title: '修辞堆砌率过高',
    scope: 'drift',
    avoid: '不要堆“仿佛、似乎、氤氲、深邃、苍茫”这类装饰词。',
    prefer: '把修辞让位给信息量和动作。',
  },
  non_human_collocation_high: {
    title: '非自然搭配率过高',
    scope: 'drift',
    avoid: '不要出现不合中文直觉的主谓搭配和物类错配。',
    prefer: '用符合对象属性的动词和状态词。',
  },
  dash_density_high: {
    title: '破折号密度过高',
    scope: 'drift',
    avoid: '不要让破折号成为解释和停顿的默认工具。',
    prefer: '用标点、段落和动作本身完成节奏控制。',
  },
  parenthetical_explanation_density_high: {
    title: '括号说明密度过高',
    scope: 'drift',
    avoid: '不要把括号说明、作者备注或设定补丁留在正文。',
    prefer: '把必要背景自然放进场景。',
  },
  metaphor_stack_rate_high: {
    title: '比喻堆叠率过高',
    scope: 'drift',
    avoid: '不要连续双重比喻或多重修辞排队出现。',
    prefer: '每段只保留真正改变读者理解的一处修辞。',
  },
  parallelism_rate_high: {
    title: '排比句率过高',
    scope: 'drift',
    avoid: '不要让句子持续呈现工整排比和平衡结构。',
    prefer: '让叙述节奏随人物注意力和现场压力变化。',
  },
  body_detail_cliche_rate_high: {
    title: '手眼声音细节密度过高',
    scope: 'drift',
    avoid: '不要反复使用手指、指节、瞳孔、喉咙和声音很轻这类低价值细节。',
    prefer: '把细节换成行动代价、信息变化和关系压力。',
  },
  isolated_template_paragraph_rate_high: {
    title: '孤立模板短段率过高',
    scope: 'drift',
    avoid: '不要让“睁眼、闭眼、抬头、低头”单独成段反复出现。',
    prefer: '用完整场景节拍承接动作和后果。',
  },
}

const DRIFT_RULE_DEFINITIONS: Array<{
  code: string
  title: string
  metricKey: keyof LanguageDriftMetrics
  medium: number
  high: number
  detail: string
}> = [
  {
    code: 'abstract_token_density_high',
    title: '抽象词密度过高',
    metricKey: 'abstractTokenDensity',
    medium: 28,
    high: 45,
    detail: '抽象词正在替代具象动作和感官。',
  },
  {
    code: 'sentence_pattern_repeat_high',
    title: '句式重复率过高',
    metricKey: 'sentencePatternRepeatRate',
    medium: 24,
    high: 40,
    detail: '句法骨架过于整齐，容易显得像模板生成。',
  },
  {
    code: 'ending_summary_rate_high',
    title: '段尾升华率过高',
    metricKey: 'endingSummaryRate',
    medium: 18,
    high: 30,
    detail: '段尾总结句过多，正在挤压叙事余味。',
  },
  {
    code: 'ornament_overload_rate_high',
    title: '修辞堆砌率过高',
    metricKey: 'ornamentOverloadRate',
    medium: 26,
    high: 42,
    detail: '装饰性词组偏多，削弱动作与信息密度。',
  },
  {
    code: 'non_human_collocation_high',
    title: '非自然搭配率过高',
    metricKey: 'nonHumanCollocationRate',
    medium: 10,
    high: 22,
    detail: '对象类别错配或非自然搭配正在积累。',
  },
  {
    code: 'dash_density_high',
    title: '破折号密度过高',
    metricKey: 'dashDensity',
    medium: 16,
    high: 32,
    detail: '破折号正在替代自然叙述节奏。',
  },
  {
    code: 'parenthetical_explanation_density_high',
    title: '括号说明密度过高',
    metricKey: 'parentheticalExplanationDensity',
    medium: 12,
    high: 26,
    detail: '括号说明或设定补丁正在进入正文。',
  },
  {
    code: 'metaphor_stack_rate_high',
    title: '比喻堆叠率过高',
    metricKey: 'metaphorStackRate',
    medium: 18,
    high: 34,
    detail: '连续比喻正在压过叙事信息。',
  },
  {
    code: 'parallelism_rate_high',
    title: '排比句率过高',
    metricKey: 'parallelismRate',
    medium: 18,
    high: 36,
    detail: '排比和工整定义句正在模板化。',
  },
  {
    code: 'body_detail_cliche_rate_high',
    title: '手眼声音细节密度过高',
    metricKey: 'bodyDetailClicheRate',
    medium: 20,
    high: 38,
    detail: '低价值身体细节正在重复替代真实行动。',
  },
  {
    code: 'isolated_template_paragraph_rate_high',
    title: '孤立模板短段率过高',
    metricKey: 'isolatedTemplateParagraphRate',
    medium: 12,
    high: 26,
    detail: '睁眼闭眼、抬头低头等孤立短段正在重复出现。',
  },
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeScope(value: unknown, ruleCode: string): AntiAiRuleHitScope {
  if (value === 'expression' || value === 'sentence' || value === 'structure' || value === 'genre' || value === 'drift' || value === 'quality') {
    return value
  }
  return RULE_SCOPE_FALLBACK[ruleCode] || 'structure'
}

function normalizeSeverity(value: unknown): GuardrailSeverity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeSource(value: unknown): AntiAiRuleHitSource {
  return value === 'language_drift' ? 'language_drift' : 'guardrail'
}

function severityRank(value: GuardrailSeverity): number {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

function splitRules(text: string, mode: 'line' | 'token' = 'line'): string[] {
  if (!text.trim()) return []
  const separator = mode === 'token'
    ? /[\n,，;；、|]+/u
    : /[\n;；]+/u
  return [...new Set(text
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean))]
}

function limitUnique(values: string[], limit: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return result.slice(0, limit)
}

function getRuleDescriptor(ruleCode: string): AntiAiRuleDescriptor {
  const descriptor = RULE_DESCRIPTOR_MAP[ruleCode]
  if (descriptor) return descriptor
  return {
    title: ruleCode,
    scope: RULE_SCOPE_FALLBACK[ruleCode] || 'structure',
    avoid: `不要重复出现 ${ruleCode} 对应的问题。`,
  }
}

function hasThreeHitsWithinFiveChapters(chapterNums: number[]): boolean {
  const sorted = [...new Set(chapterNums)].sort((left, right) => left - right)
  for (let index = 0; index <= sorted.length - 3; index += 1) {
    if (sorted[index + 2] - sorted[index] <= 4) return true
  }
  return false
}

function mapFindingToDraft(finding: TextGuardrailFinding): AntiAiRuleHitDraft {
  const descriptor = getRuleDescriptor(finding.code)
  return {
    ruleCode: finding.code,
    ruleTitle: descriptor.title,
    scope: descriptor.scope,
    severity: finding.severity,
    excerpt: finding.excerpt,
    source: 'guardrail',
    detail: finding.message,
  }
}

function buildDriftHitDrafts(metrics: LanguageDriftMetrics): AntiAiRuleHitDraft[] {
  return DRIFT_RULE_DEFINITIONS.reduce<AntiAiRuleHitDraft[]>((result, rule) => {
    const value = metrics[rule.metricKey]
    const severity: GuardrailSeverity | null = value >= rule.high ? 'high' : value >= rule.medium ? 'medium' : null
    if (!severity) return result
    const descriptor = getRuleDescriptor(rule.code)
    result.push({
      ruleCode: rule.code,
      ruleTitle: rule.title,
      scope: descriptor.scope,
      severity,
      excerpt: `${rule.title} ${value}`,
      source: 'language_drift',
      detail: `${rule.detail} 当前值 ${value}。`,
    })
    return result
  }, [])
}

function dedupeDraftsByRuleCode(drafts: AntiAiRuleHitDraft[]): AntiAiRuleHitDraft[] {
  const grouped = new Map<string, AntiAiRuleHitDraft>()
  drafts.forEach((draft) => {
    const existing = grouped.get(draft.ruleCode)
    if (!existing || severityRank(draft.severity) > severityRank(existing.severity)) {
      grouped.set(draft.ruleCode, draft)
      return
    }
    if (severityRank(draft.severity) === severityRank(existing.severity) && existing.source === 'guardrail' && draft.source === 'language_drift') {
      grouped.set(draft.ruleCode, draft)
    }
  })
  return [...grouped.values()]
}

function loadRecentRuleRows(novelId: number, chapterNum: number) {
  try {
    const db = getDb()
    return db.select().from(antiAiRuleHits)
      .where(and(
        eq(antiAiRuleHits.novelId, novelId),
        lte(antiAiRuleHits.chapterNum, chapterNum - 1),
        gte(antiAiRuleHits.chapterNum, Math.max(1, chapterNum - 5)),
      ))
      .orderBy(desc(antiAiRuleHits.chapterNum), desc(antiAiRuleHits.id))
      .all()
  } catch {
    return []
  }
}

function resolvePromotedRules(rows: Array<typeof antiAiRuleHits.$inferSelect>, currentChapterNum: number): AntiAiPromotedRule[] {
  const grouped = new Map<string, Array<typeof antiAiRuleHits.$inferSelect>>()
  rows.forEach((row) => {
    const ruleCode = asText(row.ruleCode)
    if (!ruleCode) return
    const current = grouped.get(ruleCode) || []
    current.push(row)
    grouped.set(ruleCode, current)
  })

  return [...grouped.entries()].reduce<AntiAiPromotedRule[]>((result, [ruleCode, entries]) => {
    const chapterNums = [...new Set(entries
      .map((entry) => entry.chapterNum)
      .filter((value): value is number => typeof value === 'number'))]
      .sort((left, right) => left - right)
    if (!chapterNums.includes(currentChapterNum - 1) || !chapterNums.includes(currentChapterNum - 2)) {
      return result
    }
    const latest = entries.sort((left, right) => (right.chapterNum || 0) - (left.chapterNum || 0) || right.id - left.id)[0]
    const descriptor = getRuleDescriptor(ruleCode)
    result.push({
      ruleCode,
      ruleTitle: asText(latest.ruleTitle) || descriptor.title,
      scope: normalizeScope(latest.scope, ruleCode),
      chapterNums: [currentChapterNum - 2, currentChapterNum - 1],
      avoid: descriptor.avoid,
      prefer: descriptor.prefer,
    })
    return result
  }, []).sort((left, right) => right.chapterNums[right.chapterNums.length - 1] - left.chapterNums[left.chapterNums.length - 1])
}

function buildSection(title: string, lines: string[]): string {
  const normalized = limitUnique(lines, 8)
  if (normalized.length === 0) return ''
  return [title, ...normalized.map((line) => `- ${line}`)].join('\n')
}

function buildTopRuleDetail(rule: AntiAiRuleHitSummary): string {
  const recentSpan = rule.chapterNums.slice(-3).map((chapterNum) => `第${chapterNum}章`).join('、')
  return `${rule.ruleTitle} 已在 ${rule.chapterCount} 章出现，最近命中 ${recentSpan || '无'}。`
}

function buildAlertDetail(rule: AntiAiRuleHitSummary, highRisk: boolean): string {
  if (highRisk) {
    return `${rule.ruleTitle} 已在 5 章窗口内至少出现 3 次，需要回头做专项修订。`
  }
  return `${rule.ruleTitle} 已连续两章命中，下一章应自动升级为硬约束。`
}

export function collectAntiAiRuntimeHits(content: string, genre?: string): AntiAiRuleHitDraft[] {
  const normalized = content.trim()
  if (!normalized) return []
  const findings = collectQualityGuardrailFindings(normalized, genre).map(mapFindingToDraft)
  const driftHits = buildDriftHitDrafts(analyzeLanguageDrift(normalized))
  return dedupeDraftsByRuleCode([...findings, ...driftHits])
}

export function buildAntiAiHardConstraintContext(options: {
  genre?: string
  settingsJson?: string | null
  promotedRules?: AntiAiPromotedRule[]
}): string {
  const settings = parseStorySettingsDocument(options.settingsJson)
  const promptRules = getBuiltinAntiAiPromptRules(options.genre)
  const promotedRules = options.promotedRules || []
  const promotedByBucket = promotedRules.reduce<Record<AntiAiPromptRuleBucket, string[]>>((result, rule) => {
    const bucket = rule.scope === 'expression' || rule.scope === 'sentence' || rule.scope === 'structure'
      ? rule.scope
      : 'structure'
    result[bucket].push(`本书近章复现：${rule.avoid}（已在第${rule.chapterNums.join('、')}章连续出现）`)
    return result
  }, { expression: [], sentence: [], structure: [] })

  const builtinByBucket = promptRules.reduce<Record<AntiAiPromptRuleBucket, string[]>>((result, rule) => {
    result[rule.bucket].push(rule.avoid)
    return result
  }, { expression: [], sentence: [], structure: [] })

  const customAntiAiLines = splitRules(settings.writingRules.antiAiFlavor, 'line')
  const customBannedTerms = splitRules(settings.writingRules.bannedTerms, 'token')
  const positiveLines = limitUnique([
    ...promotedRules.map((rule) => rule.prefer || '').filter(Boolean),
    ...promptRules.map((rule) => rule.prefer || '').filter(Boolean),
    '优先写角色当下在做什么、承受什么、误判什么，而不是替角色总结感悟。',
    '优先用动作、感官、对话潜台词和现实后果承接情绪。',
  ], 8)

  return [
    buildSection('【必须避免-禁用表达】', [
      ...promotedByBucket.expression,
      ...customBannedTerms.map((item) => `本书禁用：${item}`),
      ...builtinByBucket.expression,
    ]),
    buildSection('【必须避免-禁用句式】', [
      ...promotedByBucket.sentence,
      ...builtinByBucket.sentence,
    ]),
    buildSection('【必须避免-结构套路】', [
      ...promotedByBucket.structure,
      ...customAntiAiLines.map((item) => `本书自定义：${item}`),
      ...builtinByBucket.structure,
    ]),
    buildSection('【正向替代表达】', positiveLines),
  ].filter(Boolean).join('\n\n')
}

export function summarizeAntiAiRuleHits(rows: AntiAiRuleHitRowLike[]): AntiAiDashboardSummary {
  const grouped = new Map<string, AntiAiRuleHitSummary>()
  const chapterSignals = new Map<number, AntiAiChapterSignal>()
  const chapterNums = new Set<number>()

  rows.forEach((row) => {
    const chapterId = typeof row.chapterId === 'number' ? row.chapterId : null
    const chapterNum = typeof row.chapterNum === 'number' ? row.chapterNum : null
    const ruleCode = asText(row.ruleCode)
    if (!chapterId || !chapterNum || !ruleCode) return

    chapterNums.add(chapterNum)
    const severity = normalizeSeverity(row.severity)
    const source = normalizeSource(row.source)
    const promoted = Number(row.promotedToHardConstraint || 0) > 0
    const descriptor = getRuleDescriptor(ruleCode)
    const currentRule = grouped.get(ruleCode) || {
      ruleCode,
      ruleTitle: asText(row.ruleTitle) || descriptor.title,
      scope: normalizeScope(row.scope, ruleCode),
      severity,
      chapterCount: 0,
      hitCount: 0,
      promotedCount: 0,
      chapterNums: [],
      lastChapterNum: chapterNum,
      sourceBreakdown: { guardrail: 0, language_drift: 0 },
      detail: asText(row.detail) || descriptor.avoid,
    }
    currentRule.hitCount += 1
    currentRule.sourceBreakdown[source] += 1
    if (!currentRule.chapterNums.includes(chapterNum)) {
      currentRule.chapterNums.push(chapterNum)
      currentRule.chapterNums.sort((left, right) => left - right)
      currentRule.chapterCount = currentRule.chapterNums.length
    }
    if (promoted) currentRule.promotedCount += 1
    if (severityRank(severity) > severityRank(currentRule.severity)) currentRule.severity = severity
    currentRule.lastChapterNum = Math.max(currentRule.lastChapterNum, chapterNum)
    if (!currentRule.detail) currentRule.detail = asText(row.detail) || descriptor.avoid
    grouped.set(ruleCode, currentRule)

    const currentChapter = chapterSignals.get(chapterId) || {
      chapterId,
      chapterNum,
      hitCount: 0,
      promotedRuleCount: 0,
      highRiskRuleCount: 0,
      rules: [],
    }
    currentChapter.hitCount += 1
    if (promoted) currentChapter.promotedRuleCount += 1
    currentChapter.rules.push({
      ruleCode,
      ruleTitle: asText(row.ruleTitle) || descriptor.title,
      severity,
      source,
      excerpt: asText(row.excerpt),
      promotedToHardConstraint: promoted,
    })
    currentChapter.rules.sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.ruleTitle.localeCompare(right.ruleTitle))
    chapterSignals.set(chapterId, currentChapter)
  })

  const summaries = [...grouped.values()]
    .sort((left, right) => right.chapterCount - left.chapterCount || right.lastChapterNum - left.lastChapterNum || left.ruleTitle.localeCompare(right.ruleTitle))

  const promotedRules = summaries
    .filter((summary) => summary.promotedCount > 0)
    .map<AntiAiPromotedRule>((summary) => {
      const descriptor = getRuleDescriptor(summary.ruleCode)
      return {
        ruleCode: summary.ruleCode,
        ruleTitle: summary.ruleTitle,
        scope: summary.scope,
        chapterNums: summary.chapterNums.slice(-2),
        avoid: descriptor.avoid,
        prefer: descriptor.prefer,
      }
    })
    .slice(0, 6)

  const recentAlerts = summaries
    .filter((summary) => summary.chapterCount >= 2)
    .map<AntiAiRecentAlert>((summary) => {
      const highRisk = hasThreeHitsWithinFiveChapters(summary.chapterNums)
      return {
        ruleCode: summary.ruleCode,
        ruleTitle: summary.ruleTitle,
        severity: highRisk ? 'critical' : 'warning',
        chapterNums: summary.chapterNums.slice(-5),
        lastChapterNum: summary.lastChapterNum,
        detail: buildAlertDetail(summary, highRisk),
      }
    })

  recentAlerts.sort((left, right) => {
    const severityDelta = (right.severity === 'critical' ? 1 : 0) - (left.severity === 'critical' ? 1 : 0)
    if (severityDelta !== 0) return severityDelta
    return right.lastChapterNum - left.lastChapterNum || left.ruleTitle.localeCompare(right.ruleTitle)
  })

  const highRiskRuleCount = summaries.filter((summary) => hasThreeHitsWithinFiveChapters(summary.chapterNums)).length
  const chapterSignalList = [...chapterSignals.values()]
    .map((signal) => ({
      ...signal,
      highRiskRuleCount: signal.rules.filter((rule) => hasThreeHitsWithinFiveChapters(grouped.get(rule.ruleCode)?.chapterNums || [])).length,
      rules: signal.rules.slice(0, 6),
    }))
    .sort((left, right) => right.chapterNum - left.chapterNum)

  return {
    overview: {
      totalHitCount: rows.length,
      hitChapterCount: chapterNums.size,
      recurringRuleCount: summaries.filter((summary) => summary.chapterCount >= 2).length,
      promotedRuleCount: summaries.filter((summary) => summary.promotedCount > 0).length,
      highRiskRuleCount,
    },
    topRepeatedRules: summaries
      .map((summary) => ({
        ...summary,
        detail: buildTopRuleDetail(summary),
      }))
      .slice(0, 8),
    promotedRules,
    recentAlerts: recentAlerts.slice(0, 8),
    chapterSignals: chapterSignalList,
  }
}

function syncAntiAiRevisionTasks(novelId: number, activeAlerts: AntiAiRecentAlert[]): number {
  const db = getDb()
  const now = new Date().toISOString()
  const existingRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => asText(row.taskSource) === 'system')
    .filter((row) => asText(row.issueKey).startsWith('anti_ai_recurrence:'))
  const existingByKey = new Map(existingRows.map((row) => [asText(row.issueKey), row] as const))
  const activeKeys = new Set<string>()

  activeAlerts
    .filter((alert) => alert.severity === 'critical')
    .forEach((alert) => {
      const issueKey = `anti_ai_recurrence:${alert.ruleCode}`
      activeKeys.add(issueKey)
      const existing = existingByKey.get(issueKey)
      const severity = alert.severity === 'critical' ? 'high' : 'medium'
      const title = `[反AI味][复现预警] ${alert.ruleTitle}`
      const description = alert.detail
      const fixBrief = `回查 ${alert.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}，把该问题改成下一章强制禁写项。`
      const originMetaJson = JSON.stringify({
        issueCategory: 'anti_ai_recurrence',
        ruleCode: alert.ruleCode,
        chapterNums: alert.chapterNums,
        suggestion: fixBrief,
      })
      if (!existing) {
        db.insert(revisionTasks).values({
          novelId,
          taskSource: 'system',
          issueKey,
          taskType: 'continuity',
          status: 'open',
          severity,
          title,
          description,
          fixBrief,
          relatedPage: 'writing',
          entityType: 'novel',
          entityId: novelId,
          chapterId: null,
          originMetaJson,
          lastDetectedAt: now,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        }).run()
        return
      }

      const nextStatus = asText(existing.status) === 'ignored'
        ? 'ignored'
        : asText(existing.status) === 'resolved'
          ? 'open'
          : asText(existing.status) || 'open'
      db.update(revisionTasks).set({
        status: nextStatus,
        severity,
        title,
        description,
        fixBrief,
        relatedPage: 'writing',
        entityType: 'novel',
        entityId: novelId,
        chapterId: null,
        originMetaJson,
        lastDetectedAt: now,
        resolvedAt: null,
        updatedAt: now,
      }).where(eq(revisionTasks.id, existing.id)).run()
    })

  existingRows
    .filter((row) => {
      const issueKey = asText(row.issueKey)
      return issueKey && !activeKeys.has(issueKey)
    })
    .forEach((row) => {
      const currentStatus = asText(row.status)
      if (currentStatus === 'ignored' || currentStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })

  return activeKeys.size
}

export function getPromotedAntiAiRulesForChapter(
  novelId: number,
  chapterNum: number,
): AntiAiPromotedRule[] {
  if (chapterNum <= 2) return []
  return resolvePromotedRules(loadRecentRuleRows(novelId, chapterNum), chapterNum)
}

export function persistAntiAiRuleHits(params: {
  novelId: number
  chapterId: number
  chapterNum: number
  content: string
  genre?: string
}): {
  hits: AntiAiRuleHitDraft[]
  promotedRules: AntiAiPromotedRule[]
  alertCount: number
  taskCount: number
} {
  const db = getDb()
  const now = new Date().toISOString()
  const hits = collectAntiAiRuntimeHits(params.content, params.genre)
  db.delete(antiAiRuleHits).where(eq(antiAiRuleHits.chapterId, params.chapterId)).run()

  if (hits.length === 0) {
    syncAntiAiRevisionTasks(params.novelId, [])
    return {
      hits: [],
      promotedRules: [],
      alertCount: 0,
      taskCount: 0,
    }
  }

  const recentRows = db.select().from(antiAiRuleHits)
    .where(and(
      eq(antiAiRuleHits.novelId, params.novelId),
      gte(antiAiRuleHits.chapterNum, Math.max(1, params.chapterNum - 5)),
      lte(antiAiRuleHits.chapterNum, params.chapterNum - 1),
    ))
    .orderBy(desc(antiAiRuleHits.chapterNum), desc(antiAiRuleHits.id))
    .all()
  const recentByRule = recentRows.reduce<Map<string, number[]>>((result, row) => {
    const ruleCode = asText(row.ruleCode)
    if (!ruleCode || typeof row.chapterNum !== 'number') return result
    const current = result.get(ruleCode) || []
    if (!current.includes(row.chapterNum)) current.push(row.chapterNum)
    current.sort((left, right) => left - right)
    result.set(ruleCode, current)
    return result
  }, new Map())

  hits.forEach((hit) => {
    const previousChapterNums = recentByRule.get(hit.ruleCode) || []
    const chapterNums = [...new Set([...previousChapterNums, params.chapterNum])].sort((left, right) => left - right)
    const promotedToHardConstraint = chapterNums.includes(params.chapterNum - 1)
    db.insert(antiAiRuleHits).values({
      novelId: params.novelId,
      chapterId: params.chapterId,
      chapterNum: params.chapterNum,
      ruleCode: hit.ruleCode,
      ruleTitle: hit.ruleTitle,
      scope: hit.scope,
      severity: hit.severity,
      excerpt: hit.excerpt,
      source: hit.source,
      detail: hit.detail,
      promotedToHardConstraint: promotedToHardConstraint ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }).run()
  })

  const allRows = db.select().from(antiAiRuleHits)
    .where(eq(antiAiRuleHits.novelId, params.novelId))
    .orderBy(asc(antiAiRuleHits.chapterNum), asc(antiAiRuleHits.id))
    .all()
  const summary = summarizeAntiAiRuleHits(allRows)
  const taskCount = syncAntiAiRevisionTasks(params.novelId, summary.recentAlerts)
  return {
    hits,
    promotedRules: resolvePromotedRules(
      allRows.filter((row) => typeof row.chapterNum === 'number' && row.chapterNum >= Math.max(1, params.chapterNum - 2)),
      params.chapterNum + 1,
    ),
    alertCount: summary.recentAlerts.length,
    taskCount,
  }
}

export function getAntiAiDashboardSummary(novelId: number): AntiAiDashboardSummary {
  try {
    const db = getDb()
    const rows = db.select().from(antiAiRuleHits)
      .where(eq(antiAiRuleHits.novelId, novelId))
      .orderBy(asc(antiAiRuleHits.chapterNum), asc(antiAiRuleHits.id))
      .all()
    return summarizeAntiAiRuleHits(rows)
  } catch {
    return summarizeAntiAiRuleHits([])
  }
}
