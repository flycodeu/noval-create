import type { WebContents } from 'electron'
import { eq } from 'drizzle-orm'
import {
  CORE_SETTINGS_GENERATION_STEPS,
  type CoreSettingsEndingType,
  type CoreSettingsGenerationProgressEvent,
  type CoreSettingsGenerationRequest,
  type CoreSettingsGenerationResult,
  type CoreSettingsGenerationStepKey,
  type CoreSettingsGenerationStepResult,
} from '../../src/shared/core-settings-generation'
import {
  normalizeSubplotIdentity,
  parseSubPlotFrameworkResponseDetailed,
  validateGeneratedSubplots,
  type PromptMessage,
  type SubPlotDraft,
} from '../../src/shared/subplot-framework'
import { cleanAiFieldText } from '../../src/utils/text'
import { getDb } from '../database/db'
import { characters, novels } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile, buildStoryRelationSummary } from './context.service'
import {
  buildContextAlignmentRules,
  buildGenreRealityRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import { generateSubplotBatch } from './subplot.service'
import { runChatTask } from './task.service'
import { throwUserFacingError } from '../utils/user-facing-error'

const SUBPLOT_GENERATION_CHUNK_SIZE = 3
const SUBPLOT_GENERATION_RETRY_LIMIT = 1
const MAX_SUBPLOT_GENERATION_COUNT = 40
const DEFAULT_RHYTHM = {
  rhythm_setup: 30,
  rhythm_conflict: 50,
  rhythm_ending: 20,
}

const DECISION_REALISM_HINT = [
  '角色必须像真实的人，不是道德口号或完美圣人。',
  '角色可以犯错，但必须在当前资源、风险、时间压力下做出合理决策。',
  '冲突要落到谁承担代价、谁承担风险、谁必须现在做选择。',
].join('\n')

export interface StoryContext {
  novelId: number
  modelConfigId?: number
  novelTitle: string
  genre: string
  background: string
  worldRulesSummary: string
  protagonistReference: string
  protagonistRule: string
  writingContractSummary: string
  relationSummary: string
  requirements: string
}

interface CoreSettingsStepRunnerResult<T> {
  value: T
  status?: 'success' | 'warning' | 'failed' | 'skipped'
  warning?: string
  error?: string
}

function clean(value?: string | null): string {
  return value?.trim() || ''
}

function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function section(title: string, content?: string | null): string {
  const body = clean(content)
  if (!body) return ''
  return `【${title}】\n${body}`
}

function sectionLines(title: string, lines: Array<string | undefined | null | false>): string {
  const body = lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n')
  return section(title, body)
}

function cleanPlainText(text: string): string {
  return cleanAiFieldText(text).trim()
}

function sanitizeErrorMessage(error: unknown, fallback = '\u751f\u6210\u5931\u8d25'): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function joinWarnings(...warnings: Array<string | undefined | null>): string | undefined {
  const parts = warnings
    .map((warning) => warning?.trim())
    .filter((warning): warning is string => Boolean(warning))

  return parts.length > 0 ? parts.join('\uFF1B') : undefined
}

function buildSubplotSummaryText(subplots: SubPlotDraft[]): string {
  return subplots.length > 0
    ? subplots
      .map((subplot, index) => `${index + 1}. ${subplot.name} | ${subplot.characters} | ${subplot.conflict} | ${subplot.mainlineLink} | ${subplot.endChapter}`)
      .join('\n')
    : '当前还没有支线框架。'
}

function buildSubplotPolishReviewContext(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
): string {
  return renderPrompt([
    sectionLines('故事上下文', [
      `小说：${context.novelTitle}`,
      `题材：${context.genre}`,
      `背景：${context.background || '未提供'}`,
      `世界规则：${context.worldRulesSummary || '未提供'}`,
      `故事目标：${storyGoal || '未提供'}`,
      `核心冲突：${coreConflict || '未提供'}`,
      `主线剧情：${mainPlot || '未提供'}`,
      context.protagonistReference ? `主角称呼：${context.protagonistReference}` : '',
      context.protagonistRule ? `主角规则：${context.protagonistRule}` : '',
      context.relationSummary ? `关系摘要：${context.relationSummary}` : '',
    ]),
    section('当前支线框架', buildSubplotSummaryText(subplots)),
    sectionLines('润色约束', [
      '保持支线数量不变。',
      '保持 name / characters / conflict / mainlineLink / endChapter 结构稳定。',
      '只修语言、贴合度、冲突表达和主线连接，不要改成说明文。',
    ]),
  ])
}

function subplotSchemaHint(expectedCount: number): string {
  return [
    `输出应保持为 ${expectedCount} 条支线组成的 JSON 数组。`,
    '每条支线必须保留 name、characters、conflict、mainlineLink、endChapter 字段。',
    '不要把支线框架改写成解释性长文。',
  ].join('\n')
}

async function runSubplotPolishPass(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
) {
  const polishedRaw = await runPromptTask(
    context.novelId,
    context.modelConfigId,
    buildSubplotPolishPromptV2(context, storyGoal, coreConflict, mainPlot, subplots),
  )
  const quality = await runAssetQualityLoop({
    targetType: 'subplot',
    novelId: context.novelId,
    modelConfigId: context.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: context.novelId,
    contextSummary: buildSubplotPolishReviewContext(context, storyGoal, coreConflict, mainPlot, subplots),
    generatedOutput: polishedRaw,
    schemaHint: subplotSchemaHint(subplots.length),
    reviewFocus: [
      '支线润色结果必须保持为结构草稿，而不是散文式解释。',
      '冲突、主线连接和回收章位需要更具体、更贴近当前故事。',
    ],
    rewriteConstraints: [
      '保持支线条数不变。',
      '保持字段结构稳定，不要新增无关字段。',
    ],
  })
  if (quality.stage === 'rejected') {
    throw new Error(summarizeAssetQualityWarnings(quality) || quality.review.summary)
  }

  return {
    parsedResult: parseSubPlotFrameworkResponseDetailed(quality.finalOutput),
    validation: validateGeneratedSubplots(parseSubPlotFrameworkResponseDetailed(quality.finalOutput).subplots, {
      existingSubplots: [],
      expectedCount: subplots.length,
      maxConflictLength: 90,
      maxMainlineLinkLength: 60,
    }),
    qualityWarning: summarizeAssetQualityWarnings(quality),
  }
}

function buildSubplotJsonHardRules(example: string, keepOrder = false): string {
  const lines = [
    'JSON output rules:',
    '- Output JSON only. No explanation, no title, no numbering, no code fence, no comments.',
    '- Use only these keys: name / characters / conflict / mainlineLink / endChapter.',
    '- Every string value must stay inside double quotes. Never output {"conflict": bare text}.',
    '- conflict must be one concrete sentence about who faces what dilemma or pressure.',
    '- mainlineLink must be one concrete sentence about what this subplot changes in the main story.',
  ]

  if (keepOrder) {
    lines.push('- Keep item count, item order, and field order exactly the same as the input.')
  }

  lines.push(`- Example: ${example}`)
  return lines.join('\n')
}

function mergePolishedSubplots(original: SubPlotDraft[], polished: SubPlotDraft[]) {
  const merged = [...original]
  const matched = new Set<number>()
  const originalIndexesByName = new Map<string, number[]>()

  original.forEach((subplot, index) => {
    const key = normalizeSubplotIdentity(subplot.name)
    if (!key) return
    const list = originalIndexesByName.get(key) || []
    list.push(index)
    originalIndexesByName.set(key, list)
  })

  let fallbackIndex = 0
  let replacedCount = 0

  for (const subplot of polished) {
    let targetIndex = -1
    const key = normalizeSubplotIdentity(subplot.name)
    const namedCandidates = key
      ? (originalIndexesByName.get(key) || []).filter((index) => !matched.has(index))
      : []

    if (namedCandidates.length > 0) {
      targetIndex = namedCandidates[0]
    } else {
      while (fallbackIndex < original.length && matched.has(fallbackIndex)) {
        fallbackIndex += 1
      }
      if (fallbackIndex < original.length) {
        targetIndex = fallbackIndex
        fallbackIndex += 1
      }
    }

    if (targetIndex === -1) continue
    merged[targetIndex] = subplot
    matched.add(targetIndex)
    replacedCount += 1
  }

  return { merged, replacedCount }
}

function clampSubplotCount(value: number): number {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(MAX_SUBPLOT_GENERATION_COUNT, Math.round(value)))
}

function sendProgress(sender: WebContents | undefined, payload: CoreSettingsGenerationProgressEvent) {
  if (!sender || sender.isDestroyed()) return
  sender.send('ai:core-settings-progress', payload)
}

async function runPromptTask(
  novelId: number,
  modelConfigId: number | undefined,
  prompt: string,
): Promise<string> {
  const messages = [{ role: 'user' as const, content: prompt }]
  return runChatTask({
    type: 'core_settings_generate',
    novelId,
    modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson: JSON.stringify(messages),
    messages,
  })
}

async function polishPlainText(
  context: StoryContext,
  label: string,
  content: string,
  relatedContext: string,
): Promise<string> {
  const prompt = renderPrompt([
    `请只修正【${label}】的中文表达，不改动事实方向、设定关系和核心信息。`,
    sectionLines('基础背景', [
      `小说：${context.novelTitle}`,
      `题材：${context.genre}`,
      context.background ? `故事背景：${context.background}` : '',
      context.worldRulesSummary ? `世界规则：${context.worldRulesSummary}` : '',
      `主角称呼：${context.protagonistReference}`,
      `主角命名规则：${context.protagonistRule}`,
    ]),
    relatedContext ? section('关联上下文', relatedContext) : '',
    section('待修正文案', content),
    section('修正重点', [
      buildHumanLanguageRules([
        '只修语言，不补新设定，不改剧情走向，不改人物关系。',
        '重点修复主谓宾搭配不当、对象类别错配、抽象化过度、词语搭配生硬。',
        '比如“电网的死亡”必须改成“电网瘫痪”“电力系统崩溃”或同类准确表达。',
      ]),
    ].join('\n')),
    '只输出修正后的纯文本，不要解释，不要 Markdown。',
  ])

  const result = await runPromptTask(context.novelId, context.modelConfigId, prompt)
  return cleanPlainText(result) || cleanPlainText(content)
}

function normalizeRhythmValue(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function normalizeRhythm(raw: Record<string, unknown>) {
  const setup = normalizeRhythmValue(raw.rhythm_setup, 10, 60, DEFAULT_RHYTHM.rhythm_setup)
  const conflict = normalizeRhythmValue(raw.rhythm_conflict, 20, 70, DEFAULT_RHYTHM.rhythm_conflict)
  const ending = normalizeRhythmValue(raw.rhythm_ending, 5, 40, DEFAULT_RHYTHM.rhythm_ending)
  const total = setup + conflict + ending

  if (total === 100) {
    return { rhythm_setup: setup, rhythm_conflict: conflict, rhythm_ending: ending }
  }

  const scaledSetup = Math.round((setup / total) * 100)
  const scaledConflict = Math.round((conflict / total) * 100)
  const scaledEnding = Math.max(5, 100 - scaledSetup - scaledConflict)

  return {
    rhythm_setup: Math.max(10, Math.min(60, scaledSetup)),
    rhythm_conflict: Math.max(20, Math.min(70, scaledConflict)),
    rhythm_ending: Math.max(5, Math.min(40, scaledEnding)),
  }
}

function parseEndingType(value: unknown): CoreSettingsEndingType | null {
  if (value === 'HE' || value === 'BE' || value === 'open' || value === 'multi' || value === 'HE_BE') {
    return value
  }
  return null
}

function inferEndingType(text: string): CoreSettingsEndingType {
  if (/多结局|不同结局|多条结局/.test(text)) return 'multi'
  if (/部分.*悲剧|有人得偿所愿.*有人失去|主线圆满.*代价/.test(text)) return 'HE_BE'
  if (/悲剧|牺牲|覆灭|身亡|死去|无法挽回/.test(text)) return 'BE'
  if (/开放|未给答案|仍未结束|留待以后/.test(text)) return 'open'
  if (/圆满|和解|团圆|守住了|获得了/.test(text)) return 'HE'
  return 'open'
}

function buildBaseContext(context: StoryContext): string {
  return [
    `小说：${context.novelTitle}`,
    `题材：${context.genre}`,
    context.background ? `故事背景：${context.background}` : '',
    context.worldRulesSummary ? `世界规则：${context.worldRulesSummary}` : '',
    `主角称呼：${context.protagonistReference}`,
    `主角命名规则：${context.protagonistRule}`,
  ].filter(Boolean).join('\n')
}

function buildUserRequirementSection(requirements: string): string {
  return requirements ? `【额外要求】\n${requirements}` : ''
}

function buildStoryGoalPrompt(context: StoryContext): string {
  return renderPrompt([
    '你是资深中文小说总策划。现在只生成【故事核心目标】。',
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    section('字段职责', '只回答故事最终要抵达什么状态、结果、目标或核心命题，不写过程，不写阻碍。'),
    section('生成要求', [
      '目标要具体、稳定，能成为整部小说的最终落点。',
      '可以带出主题方向，但必须落到可感知的结果或终局变化上。',
      '不要把冲突、敌人、危机或阶段任务误写成目标。',
      buildHumanLanguageRules([
        '用常规中文表达，不要写成概念口号、伪诗句或悬浮文案。',
      ]),
    ].join('\n')),
    '直接输出纯文本，不要标题，不要解释，不要 Markdown。',
  ])
}

function buildCoreConflictPrompt(context: StoryContext, storyGoal: string): string {
  return renderPrompt([
    '你是资深中文小说总策划。现在只生成【核心冲突】。',
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    section('已确定目标', storyGoal),
    section('字段职责', '只回答为什么这个目标难以实现，写出阻碍目标实现的核心对立、代价、矛盾和持续张力。'),
    section('生成要求', [
      '必须明确冲突双方、冲突来源或必须付出的代价。',
      '它要能长期驱动主线，而不是单一场景的小矛盾。',
      '不要把目标改写成近义句，也不要把主线剧情提前写成流水账。',
      buildHumanLanguageRules([
        '冲突描述要说人话，直接点明谁和谁、为什么冲突，不要堆抽象词。',
      ]),
    ].join('\n')),
    '直接输出纯文本，不要标题，不要解释，不要 Markdown。',
  ])
}

function buildMainPlotPrompt(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
): string {
  return renderPrompt([
    '你是资深中文小说总策划。现在只生成【主线剧情】。',
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    section('故事核心目标', storyGoal),
    section('核心冲突', coreConflict),
    section('字段职责', '只写围绕目标和冲突展开的关键事件链，体现因果推进、升级、转折和逼近终局。'),
    section('生成要求', [
      '主线要写出起点、关键升级、重大转折和收束前的逼近过程。',
      '每个阶段都要与核心目标、核心冲突直接相关。',
      '不要只列场景或情绪，要能看出事件之间的因果关系。',
      buildHumanLanguageRules([
        '优先写清发生了什么和为什么会这样，不要写抽象的“命运变化”“世界回响”。',
      ]),
    ].join('\n')),
    '直接输出纯文本，不要标题，不要解释，不要 Markdown。',
  ])
}

function buildSubplotPrompt(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  batchCount: number,
  existingSubplots: SubPlotDraft[],
  batchIndex: number,
  totalBatches: number,
  maxConflictLength: number = 90,
): string {
  const existingSummary = existingSubplots
    .map((subplot, index) => `${index + 1}. ${[subplot.name, subplot.conflict, subplot.mainlineLink].filter(Boolean).join(' / ')}`)
    .filter(Boolean)
    .join('\n')

  return renderPrompt([
    `请为这部小说生成 ${batchCount} 条新的支线剧情框架。`,
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    sectionLines('主线约束', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
    ]),
    sectionLines('当前批次', [
      `批次：第 ${batchIndex}/${totalBatches} 批`,
      `本批数量：${batchCount}`,
      `已有支线数量：${existingSubplots.length}`,
    ]),
    existingSummary ? section('已有支线摘要', existingSummary) : '',
    section('生成要求', [
      '每条支线都必须与主线推进、主题揭示、人物成长或关键关系变化形成明确因果关联。',
      '不同支线要承担不同功能，避免名称、核心冲突或主线作用重复。',
      'characters 只写人物称谓，用逗号分隔；涉及主角时只能写当前主角称呼。',
      `conflict 用 1 到 2 句写清核心矛盾，不超过 ${maxConflictLength} 字。`,
      'mainlineLink 用一句话写清它如何推动主线、人物或主题，不超过 60 字。',
      'endChapter 输出数字。',
      buildHumanLanguageRules([
        '冲突和主线关联都要写得准确直接，不要出现“电网的死亡”这类搭配错误。',
        '宁可短，也不要扩写成长段情节；一句写清矛盾即可。',
      ]),
    ].join('\n')),
    '只输出 JSON array，且数组长度必须等于本批数量：',
    '[{"name":"支线名称","characters":"涉及人物1,涉及人物2","conflict":"支线核心冲突","mainlineLink":"与主线或主题的具体关联方式","endChapter":15}]',
  ])
}

function buildSubplotPolishPrompt(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
): string {
  return renderPrompt([
    '请只修正下面这组支线框架的中文表达，不改动条目数量、名称方向、主线作用和收束章节。',
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    sectionLines('主线约束', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
    ]),
    section('待修正支线', JSON.stringify(subplots, null, 2)),
    section('修正重点', [
      buildHumanLanguageRules([
        '重点修 conflict 和 mainlineLink 的表达，不要改成另一条支线。',
        '如果某条文案存在对象类别错配，要改成常规说法，比如把“电网的死亡”改成“电网瘫痪”。',
        '保留 characters 和 endChapter 的原意，不新增设定。',
      ]),
    ].join('\n')),
    '只输出修正后的 JSON array，不要解释，不要 Markdown。',
  ])
}

function buildRhythmPrompt(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
): string {
  return renderPrompt([
    '请根据当前小说设定，给出三段式叙事节奏建议。',
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    sectionLines('核心设定', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
      `支线概况：${subplots.length > 0 ? subplots.map((sub) => `${sub.name}：${sub.mainlineLink}`).join('；') : '暂无支线'}`,
    ]),
    section('要求', [
      '输出前期铺垫、中期冲突、后期收束三个百分比。',
      '三个数字合计必须等于 100。',
      '前期铺垫控制在 10 到 60，中期冲突控制在 20 到 70，后期收束控制在 5 到 40。',
      'reason 用一句话解释为什么采用这个比例。',
    ].join('\n')),
    '只输出 JSON：{"rhythm_setup":30,"rhythm_conflict":50,"rhythm_ending":20,"reason":"一句说明"}',
  ])
}

function buildEndingPrompt(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
  rhythmSummary: string,
): string {
  return renderPrompt([
    '你是资深中文小说总策划。现在生成【结局设定】。',
    section('基础背景', buildBaseContext(context)),
    buildUserRequirementSection(context.requirements),
    sectionLines('既定约束', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
      `支线概况：${subplots.length > 0 ? subplots.map((sub) => `${sub.name}：${sub.mainlineLink}`).join('；') : '暂无支线'}`,
      `叙事节奏：${rhythmSummary}`,
    ]),
    section('生成要求', [
      '结局必须回应核心目标、核心冲突和主线推进结果。',
      '要交代主要矛盾如何收束，以及结局之后留下的余波。',
      'ending_type 只能从 HE / BE / open / multi / HE_BE 中选择一个。',
      'ending 写成一段完整、自然的中文，不要重新展开中段剧情。',
      buildHumanLanguageRules([
        '结局用常规小说语言表达，避免概念化结尾和对象类别错配。',
      ]),
    ].join('\n')),
    '只输出 JSON：{"ending_type":"HE","ending":"结局内容"}',
  ])
}

function buildBaseContextV2(context: StoryContext): string {
  return [
    `小说：${context.novelTitle}`,
    `题材：${context.genre}`,
    context.background ? `故事背景：${context.background}` : '',
    context.worldRulesSummary ? `世界规则：${context.worldRulesSummary}` : '',
    `主角称呼：${context.protagonistReference}`,
    `主角命名规则：${context.protagonistRule}`,
  ].filter(Boolean).join('\n')
}

function buildWritingContractSectionV2(context: StoryContext): string {
  return section('写作类型', context.writingContractSummary)
}

function buildRelationSectionV2(context: StoryContext): string {
  return section('关键人物关系', context.relationSummary)
}

function buildNarrativeExecutionSectionV2(): string {
  return section('写作落实要求', [
    '把写作类型翻译成节奏、冲突兑现速度、关系推进方式和语言边界，不要只把标签挂在页面上。',
    '关系线只能从现有人物关系网长出来，不要凭空再造与角色网脱节的情感线、冲突线或立场线。',
    '家人、朋友、陌生人、上下级、恋人、敌对关系，必须体现不同的称呼距离、互动方式、试探强度和潜台词。',
    '如果标签偏爽文，重点强化冲突兑现、回报反馈和情绪释放，但仍服从世界规则与代价逻辑。',
    '如果标签偏写实，重点强化事件基础、成本承担和时间积累，禁止无成本升温或空降转折。',
    '如果标签含言情，关系变化优先落在称呼变化、停顿、回避、试探、照顾、误会和潜台词上。',
  ].join('\n'))
}

function buildUserRequirementSectionV2(requirements: string): string {
  return requirements ? `【额外要求】\n${requirements}` : ''
}

function buildDecisionConstraintSectionV2(context: StoryContext): string {
  return section('人物与决策约束', [
    DECISION_REALISM_HINT,
    '角色不是道德符号。不要把主角或其他人物写成无条件接纳所有人、永远正确、永远愿意承担全部代价的圣母。',
    '角色可以不完美、可以误判、可以害怕，但必须根据当前信息、资源和风险做出当下最合理的选择。',
    '如果设定涉及感染、灾变、围困、生存压力、组织治理或秩序崩塌，必须明确筛查、隔离、隐瞒伤情、资源分配、纪律处罚、救人与防扩散之间的冲突。',
    `涉及主角时，只能使用「${context.protagonistReference}」称呼，不能擅自补实名。`,
  ].join('\n'))
}

async function polishPlainTextV2(
  context: StoryContext,
  label: string,
  content: string,
  relatedContext: string,
): Promise<string> {
  const prompt = renderPrompt([
    `请只润色「${label}」的中文表达，不改动事实方向、设定关系和核心信息。`,
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    relatedContext ? section('关联上下文', relatedContext) : '',
    section('待润色文本', content),
    section('润色要求', buildHumanLanguageRules([
      '只修语言，不补新设定，不改剧情走向，不改人物关系。',
      '重点修复对象错配、词语搭配生硬、空泛悬浮、像说明书或口号的句子。',
      '人物要像真实的人，不要把果断、残酷、犹豫、误判这些真实反应抹平。',
      '如果文本里出现无条件拯救所有人、零代价维持秩序、所有人都立刻达成一致等表达，要改成更符合处境和代价的写法。',
    ])),
    '只输出润色后的纯文本，不要解释，不要 Markdown。',
  ])

  const result = await runPromptTask(context.novelId, context.modelConfigId, prompt)
  return cleanPlainText(result) || cleanPlainText(content)
}

function buildStoryGoalPromptV2(context: StoryContext): string {
  return renderPrompt([
    '你是资深中文小说策划。现在只生成「故事核心目标」。',
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    section('字段职责', '只回答故事最后要抵达什么状态、结果或根本性改变，不写过程，不写冲突本身。'),
    section('生成要求', [
      '目标要具体、稳定，能够成为整部小说的最终落点。',
      '可以带出主题方向，但必须落到可感知的结果或终局变化上。',
      '不要把阶段任务、敌人、危机或过程误写成目标。',
      buildHumanLanguageRules([
        '用常规中文表达，不要写成概念口号、海报文案或悬浮金句。',
      ]),
    ].join('\n')),
    '直接输出纯文本，不要标题，不要解释，不要 Markdown。',
  ])
}

function buildCoreConflictPromptV2(context: StoryContext, storyGoal: string): string {
  return renderPrompt([
    '你是资深中文小说策划。现在只生成「核心冲突」。',
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    section('已确定目标', storyGoal),
    section('字段职责', '只回答为什么这个目标难以实现，明确写出对立双方、风险来源、不可兼得之处和持续代价。'),
    section('生成要求', [
      '必须写清冲突双方、风险来源、必须牺牲什么，或者为什么无论怎么选都会付出代价。',
      '冲突要能长期驱动主线，而不是一场局部争执。',
      '不要把目标改写成近义句，也不要把主线事件提前写成流水账。',
      '不要把“善良、接纳、守护所有人”直接写成无条件正确答案。',
      '如果背景涉及感染、筛查、隔离、幸存者接纳、伤情隐瞒、纪律维持等问题，必须把这些现实压力写进冲突。',
      buildHumanLanguageRules([
        '冲突描述要说人话，直接写谁和谁冲突、为什么冲突、代价落在哪里，不要堆抽象词。',
      ]),
    ].join('\n')),
    '直接输出纯文本，不要标题，不要解释，不要 Markdown。',
  ])
}

function buildMainPlotPromptV2(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
): string {
  return renderPrompt([
    '你是资深中文小说策划。现在只生成「主线剧情」。',
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    section('故事核心目标', storyGoal),
    section('核心冲突', coreConflict),
    section('字段职责', '只写围绕目标与冲突展开的关键事件链，强调因果推进、升级、转折和逼近结局。'),
    section('生成要求', [
      '主线要写出起点、关键升级、重大转折和收束前的逼近过程。',
      '每个阶段都要与核心目标、核心冲突直接相关。',
      '重点写人物在压力下做了什么、为什么那样做、造成了什么后果。',
      '不要只列场景或情绪，要能看出事件之间的因果关系。',
      buildHumanLanguageRules([
        '优先写清发生了什么和为什么会这样，不要写抽象的“命运改变”“世界回响”。',
      ]),
    ].join('\n')),
    '直接输出纯文本，不要标题，不要解释，不要 Markdown。',
  ])
}

function buildSubplotPromptV2(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  batchCount: number,
  existingSubplots: SubPlotDraft[],
  batchIndex: number,
  totalBatches: number,
  maxConflictLength: number = 90,
): string {
  const existingSummary = existingSubplots
    .map((subplot, index) => `${index + 1}. ${[subplot.name, subplot.conflict, subplot.mainlineLink].filter(Boolean).join(' / ')}`)
    .filter(Boolean)
    .join('\n')

  return renderPrompt([
    `请为这部小说生成 ${batchCount} 条新的支线框架。`,
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    sectionLines('主线约束', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
    ]),
    sectionLines('当前批次', [
      `批次：${batchIndex}/${totalBatches}`,
      `本批数量：${batchCount}`,
      `已有支线数量：${existingSubplots.length}`,
    ]),
    existingSummary ? section('已有支线摘要', existingSummary) : '',
    section('上下文护栏', buildContextAlignmentRules({
      background: context.background,
      storyCore: [`故事核心目标：${storyGoal}`, `核心冲突：${coreConflict}`, `主线剧情：${mainPlot}`].join('\n'),
      worldSummary: context.worldRulesSummary,
      taskFocus: '只补与当前主线同一套背景和规则下的支线，不要跳到另一种题材或另一套规则。',
      extraLines: [`涉及主角时，只能使用「${context.protagonistReference}」称呼，不能自行补实名。`],
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: context.genre,
      worldSummary: context.worldRulesSummary,
      extraLines: ['如果支线涉及末世生存、感染、秩序、围困或资源分配，必须写清风险承担者、代价承担者和决策压力。'],
    })),
    section('输出质量底线', buildOutputQualityRules([
      '每条支线都要写成能直接落进后续剧情的具体矛盾，不要写成题材标签或主题口号。',
      '不同支线要承担不同剧情功能，避免名称、冲突或主线作用重复。',
    ])),
    section('生成要求', [
      'characters 只写人物称谓，用英文逗号分隔；涉及主角时只能写当前主角称呼。',
      `conflict 必须是 1 句具体中文，不超过 ${maxConflictLength} 字，写清谁面临什么两难、风险或代价。`,
      'mainlineLink 必须是 1 句具体中文，不超过 60 字，写清它改变了主线的哪一处推进、关系或局势。',
      'endChapter 输出数字。',
      '优先用短句，先写行动、压力和后果，不要写成空泛主题句或章节摘要腔。',
      buildHumanLanguageRules([
        '先写清具体行动、压力和后果。',
        '不要写成标签化短语或空泛主题口号。',
      ]),
      buildSubplotJsonHardRules('[{"name":"支线名","characters":"人物A,人物B","conflict":"队伍找到稀缺药物，主角必须在救治伤员和换取通行之间做选择。","mainlineLink":"这个选择把后勤盟友推向对立面，并把主线资源冲突继续升级。","endChapter":15}]'),
    ].join('\n')),
    '只输出 JSON array，数组长度必须等于本批数量，不要解释，不要 Markdown。',
  ])
}

function buildSubplotPolishPromptV2(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
): string {
  return renderPrompt([
    '请只润色下面这组支线框架的中文表达，不改动条目数量、功能方向和收束章节。',
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    sectionLines('主线约束', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
    ]),
    section('待修正支线', JSON.stringify(subplots, null, 2)),
    section('上下文护栏', buildContextAlignmentRules({
      background: context.background,
      storyCore: [`故事核心目标：${storyGoal}`, `核心冲突：${coreConflict}`, `主线剧情：${mainPlot}`].join('\n'),
      worldSummary: context.worldRulesSummary,
      taskFocus: '只修正这组支线的中文表达，不要借机换成另一组剧情。',
      extraLines: ['如果某条文案已经自然准确，就直接保留。'],
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: context.genre,
      worldSummary: context.worldRulesSummary,
      extraLines: ['如果某条支线涉及生存、感染、秩序或资源，修辞后仍要保留风险承担者与代价落点。'],
    })),
    section('修正重点', [
      '只重写字符串内容，不能改动条目数量、字段名、字段顺序、对象顺序和 endChapter 原意。',
      '重点修 conflict 和 mainlineLink 的语感，但不能修成另一条支线。',
      '把空泛、悬浮、对象错配或生硬的表达改成自然、准确的中文。',
      '不要为了“换一种说法”就硬改原本已经成立的句子。',
      buildHumanLanguageRules([
        '只修语言，不补新设定，不换冲突，不扩写剧情。',
        '输出前再自查一遍，确保所有字符串字段都是合法 JSON。',
      ]),
      buildSubplotJsonHardRules('[{"name":"支线名","characters":"人物A,人物B","conflict":"队伍找到稀缺药物，主角必须在救治伤员和换取通行之间做选择。","mainlineLink":"这个选择把后勤盟友推向对立面，并把主线资源冲突继续升级。","endChapter":15}]', true),
    ].join('\n')),
    '只输出修正后的 JSON array，不要解释，不要 Markdown。',
  ])
}

function buildRhythmPromptV2(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
): string {
  return renderPrompt([
    '请根据当前小说设定，给出三段式叙事节奏建议。',
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    sectionLines('核心设定', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
      `支线概况：${subplots.length > 0 ? subplots.map((sub) => `${sub.name}：${sub.mainlineLink}`).join('；') : '暂无支线'}`,
    ]),
    section('要求', [
      '输出前期铺垫、中期冲突、后期收束三个百分比。',
      '三个数字合计必须等于 100。',
      '前期铺垫控制在 10 到 60，中期冲突控制在 20 到 70，后期收束控制在 5 到 40。',
      'reason 用一句话解释为什么采用这个比例。',
    ].join('\n')),
    '只输出 JSON，例如 {"rhythm_setup":30,"rhythm_conflict":50,"rhythm_ending":20,"reason":"一句话说明"}',
  ])
}

function buildEndingPromptV2(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplots: SubPlotDraft[],
  rhythmSummary: string,
): string {
  return renderPrompt([
    '你是资深中文小说策划。现在生成「结局设定」。',
    section('基础背景', buildBaseContextV2(context)),
    buildWritingContractSectionV2(context),
    buildRelationSectionV2(context),
    buildUserRequirementSectionV2(context.requirements),
    buildNarrativeExecutionSectionV2(),
    buildDecisionConstraintSectionV2(context),
    sectionLines('既定约束', [
      `故事核心目标：${storyGoal}`,
      `核心冲突：${coreConflict}`,
      `主线剧情：${mainPlot}`,
      `支线概况：${subplots.length > 0 ? subplots.map((sub) => `${sub.name}：${sub.mainlineLink}`).join('；') : '暂无支线'}`,
      `叙事节奏：${rhythmSummary}`,
    ]),
    section('生成要求', [
      '结局必须回应核心目标、核心冲突和主线推进结果。',
      '要交代主要矛盾如何收束，以及结局之后留下的余波。',
      '如果结局代价很重，要写清谁失去了什么，而不是只给价值判断。',
      'ending_type 只能从 HE / BE / open / multi / HE_BE 中选择一个。',
      'ending 写成一段完整、自然的中文，不要重新铺陈中段剧情。',
      buildHumanLanguageRules([
        '结局要像小说结尾，不要像总结汇报或口号收尾。',
      ]),
    ].join('\n')),
    '只输出 JSON，例如 {"ending_type":"HE","ending":"结局内容"}',
  ])
}

async function loadStoryContext(request: CoreSettingsGenerationRequest): Promise<StoryContext> {
  const profile = await buildStoryProfile(request.novelId)
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, request.novelId)).all()[0]
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, request.novelId)).all()

  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  return {
    novelId: request.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    novelTitle: profile.novelTitle,
    genre: profile.genre,
    background: profile.background,
    worldRulesSummary: profile.worldRulesSummary,
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
    writingContractSummary: profile.writingContractSummary,
    relationSummary: buildStoryRelationSummary(
      request.novelId,
      allCharacters,
      [
        profile.protagonistReference,
        profile.storyGoal,
        profile.coreConflict,
        profile.mainPlot,
        profile.themeVoiceSummary,
        profile.storyThreadsSummary,
      ].filter(Boolean).join('\n'),
      8,
    ),
    requirements: clean(request.requirements),
  }
}

export async function loadSubplotAutoGenerateContext(request: {
  novelId: number
  requirements?: string
}): Promise<StoryContext> {
  return loadStoryContext({
    novelId: request.novelId,
    subplotCount: 1,
    requirements: request.requirements,
  })
}

async function runPlainTextStep(
  context: StoryContext,
  prompt: string,
  label: string,
  relatedContext: string,
): Promise<string> {
  const raw = await runPromptTask(context.novelId, context.modelConfigId, prompt)
  const cleaned = cleanPlainText(raw)
  if (!cleaned) {
    throwUserFacingError('coreSettings.sectionEmpty', { label })
  }

  return polishPlainTextV2(context, label, cleaned, relatedContext)
}

export async function tryGenerateSubplotBatch(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  batchCount: number,
  accumulated: SubPlotDraft[],
  currentBatch: number,
  totalBatches: number,
  runtime: {
    parentTaskId?: number
    sender?: WebContents
  } = {},
): Promise<{ batchResult: Awaited<ReturnType<typeof generateSubplotBatch>> | null; warning?: string }> {
  let lastError: unknown

  const runBatch = async (maxConflictLength: number) => {
    const messages: PromptMessage[] = [{
      role: 'user',
      content: buildSubplotPromptV2(
        context,
        storyGoal,
        coreConflict,
        mainPlot,
        batchCount,
        accumulated,
        currentBatch,
        totalBatches,
        maxConflictLength,
      ),
    }]

    for (let attempt = 0; attempt <= SUBPLOT_GENERATION_RETRY_LIMIT; attempt += 1) {
      try {
        return await generateSubplotBatch({
          novelId: context.novelId,
          messages,
          expectedCount: batchCount,
          existingSubplots: accumulated,
          modelConfigId: context.modelConfigId,
          batchIndex: currentBatch,
          totalBatches,
        }, runtime)
      } catch (error) {
        lastError = error
      }
    }

    return null
  }

  const initialResult = await runBatch(90)
  if (initialResult) {
    return { batchResult: initialResult }
  }

  const initialError = sanitizeErrorMessage(lastError, '支线生成失败')
  if (!initialError.includes('核心冲突过长')) {
    return {
      batchResult: null,
      warning: `第 ${currentBatch}/${totalBatches} 批未生成可用支线：${initialError}`,
    }
  }

  const compactResult = await runBatch(60)
  if (compactResult) {
    return {
      batchResult: compactResult,
      warning: `第 ${currentBatch}/${totalBatches} 批首次结果过长，已按更短冲突摘要重试保留`,
    }
  }

  return {
    batchResult: null,
    warning: `第 ${currentBatch}/${totalBatches} 批未生成可用支线：${sanitizeErrorMessage(lastError, initialError)}`,
  }
}

export async function polishGeneratedSubplots(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  accumulated: SubPlotDraft[],
): Promise<{ subplots: SubPlotDraft[]; warning?: string }> {
  let nextSubplots = [...accumulated]
  const warnings: string[] = []

  if (nextSubplots.length <= 0) {
    return {
      subplots: nextSubplots,
    }
  }

  try {
    const { parsedResult, validation, qualityWarning } = await runSubplotPolishPass(
      context,
      storyGoal,
      coreConflict,
      mainPlot,
      nextSubplots,
    )

    if (validation.accepted.length > 0) {
      const originalCount = nextSubplots.length
      const { merged, replacedCount } = mergePolishedSubplots(nextSubplots, validation.accepted)
      nextSubplots = merged

      const polishWarning = joinWarnings(
        qualityWarning,
        parsedResult.notes.length > 0 ? parsedResult.notes.join('\uFF1B') : undefined,
        validation.rejectionReasons.length > 0 ? `润色结果拒绝原因：${validation.rejectionReasons.join('\uFF1B')}` : undefined,
        replacedCount < originalCount ? `仅替换 ${replacedCount}/${originalCount} 条润色结果，其余保留原始支线框架` : undefined,
      )

      if (polishWarning) {
        warnings.push(`支线语言修正提示：${polishWarning}`)
      }
    } else {
      const failedReasons = joinWarnings(
        qualityWarning,
        parsedResult.notes.length > 0 ? parsedResult.notes.join('\uFF1B') : undefined,
        validation.rejectionReasons.length > 0 ? `校验原因：${validation.rejectionReasons.join('\uFF1B')}` : undefined,
      )
      warnings.push(joinWarnings(
        '支线语言修正结果未通过校验，已保留原始支线框架',
        failedReasons,
      ) || '支线语言修正结果未通过校验，已保留原始支线框架')
    }
  } catch (error) {
    warnings.push(joinWarnings(
      '支线语言修正失败，已保留原始支线框架',
      sanitizeErrorMessage(error),
    ) || '支线语言修正失败，已保留原始支线框架')
  }

  return {
    subplots: nextSubplots,
    warning: warnings.length > 0 ? warnings.join('；') : undefined,
  }
}

async function generateSubplots(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  subplotCount: number,
  sender?: WebContents,
  baseProgress?: Omit<CoreSettingsGenerationProgressEvent, 'status' | 'detail' | 'warning'>,
): Promise<{ subplots: SubPlotDraft[]; warning?: string; error?: string; status?: 'success' | 'warning' | 'failed' }> {
  const totalBatches = Math.ceil(subplotCount / SUBPLOT_GENERATION_CHUNK_SIZE)
  let generatedCount = 0
  let accumulated: SubPlotDraft[] = []
  const warnings: string[] = []
  const failedBatches: string[] = []

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const currentBatch = batchIndex + 1
    const batchCount = Math.min(SUBPLOT_GENERATION_CHUNK_SIZE, subplotCount - generatedCount)

    if (baseProgress) {
      sendProgress(sender, {
        ...baseProgress,
        status: 'running',
        detail: `第 ${currentBatch}/${totalBatches} 批，已生成 ${generatedCount}/${subplotCount} 条`,
      })
    }

    const { batchResult, warning } = await tryGenerateSubplotBatch(
      context,
      storyGoal,
      coreConflict,
      mainPlot,
      batchCount,
      accumulated,
      currentBatch,
      totalBatches,
    )

    if (!batchResult) {
      if (warning) {
        failedBatches.push(warning)
        warnings.push(warning)
      }
      continue
    }

    generatedCount += batchResult.accepted.length
    accumulated = [...accumulated, ...batchResult.accepted]

    if (batchResult.warningMessage) {
      warnings.push(batchResult.warningMessage)
    }
    if (warning) {
      warnings.push(warning)
    }
  }

  if (accumulated.length === 0) {
    const error = failedBatches.length > 0
      ? `支线未生成。${failedBatches.join('；')}`
      : '支线未生成'
    return {
      subplots: [],
      status: 'failed',
      error,
      warning: warnings.length > 0 ? warnings.join('；') : undefined,
    }
  }

  if (accumulated.length > 0) {
    try {
      const { parsedResult, validation, qualityWarning } = await runSubplotPolishPass(
        context,
        storyGoal,
        coreConflict,
        mainPlot,
        accumulated,
      )

      if (validation.accepted.length > 0) {
        const originalCount = accumulated.length
        const { merged, replacedCount } = mergePolishedSubplots(accumulated, validation.accepted)
        accumulated = merged

        const polishWarning = joinWarnings(
          qualityWarning,
          parsedResult.notes.length > 0 ? parsedResult.notes.join('\uFF1B') : undefined,
          validation.rejectionReasons.length > 0 ? `\u6da6\u8272\u7ed3\u679c\u62d2\u7edd\u539f\u56e0\uff1a${validation.rejectionReasons.join('\uFF1B')}` : undefined,
          replacedCount < originalCount ? `\u4ec5\u66ff\u6362 ${replacedCount}/${originalCount} \u6761\u6da6\u8272\u7ed3\u679c\uff0c\u5176\u4f59\u4fdd\u7559\u539f\u59cb\u652f\u7ebf\u6846\u67b6` : undefined,
        )

        if (polishWarning) {
          warnings.push(`\u652f\u7ebf\u8bed\u8a00\u4fee\u6b63\u63d0\u793a\uff1a${polishWarning}`)
        }
      } else {
        const failedReasons = joinWarnings(
          qualityWarning,
          parsedResult.notes.length > 0 ? parsedResult.notes.join('\uFF1B') : undefined,
          validation.rejectionReasons.length > 0 ? `\u6821\u9a8c\u539f\u56e0\uff1a${validation.rejectionReasons.join('\uFF1B')}` : undefined,
        )
        warnings.push(joinWarnings(
          '\u652f\u7ebf\u8bed\u8a00\u4fee\u6b63\u7ed3\u679c\u672a\u901a\u8fc7\u6821\u9a8c\uff0c\u5df2\u4fdd\u7559\u539f\u59cb\u652f\u7ebf\u6846\u67b6',
          failedReasons,
        ) || '\u652f\u7ebf\u8bed\u8a00\u4fee\u6b63\u7ed3\u679c\u672a\u901a\u8fc7\u6821\u9a8c\uff0c\u5df2\u4fdd\u7559\u539f\u59cb\u652f\u7ebf\u6846\u67b6')
      }
    } catch (error) {
      warnings.push(joinWarnings(
        '\u652f\u7ebf\u8bed\u8a00\u4fee\u6b63\u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u539f\u59cb\u652f\u7ebf\u6846\u67b6',
        sanitizeErrorMessage(error),
      ) || '\u652f\u7ebf\u8bed\u8a00\u4fee\u6b63\u5931\u8d25\uff0c\u5df2\u4fdd\u7559\u539f\u59cb\u652f\u7ebf\u6846\u67b6')
    }
  }

  return {
    subplots: accumulated,
    status: failedBatches.length > 0 ? 'warning' : 'success',
    warning: warnings.length > 0 ? warnings.join('；') : undefined,
  }
}

export async function generateCoreSettings(
  request: CoreSettingsGenerationRequest,
  sender?: WebContents,
): Promise<CoreSettingsGenerationResult> {
  const context = await loadStoryContext(request)
  const steps: CoreSettingsGenerationStepResult[] = []
  const warnings: string[] = []
  const total = CORE_SETTINGS_GENERATION_STEPS.length
  const subplotCount = clampSubplotCount(request.subplotCount)
  let completedCount = 0

  const runStep = async <T>(
    key: CoreSettingsGenerationStepKey,
    label: string,
    fallbackValue: T,
    runner: () => Promise<CoreSettingsStepRunnerResult<T>>,
  ): Promise<T> => {
    sendProgress(sender, {
      novelId: context.novelId,
      step: key,
      label,
      status: 'running',
      completed: completedCount,
      total,
    })

    try {
      const result = await runner()
      const status = result.status ?? (result.error ? 'failed' : result.warning ? 'warning' : 'success')
      const normalizedWarning = clean(result.warning)
      const normalizedError = clean(result.error)

      steps.push({
        key,
        label,
        status,
        warning: normalizedWarning || undefined,
        error: normalizedError || undefined,
      })

      if (normalizedWarning) warnings.push(`${label}：${normalizedWarning}`)
      if (normalizedError && normalizedError !== normalizedWarning) warnings.push(`${label}：${normalizedError}`)

      if (status === 'failed') {
        sendProgress(sender, {
          novelId: context.novelId,
          step: key,
          label,
          status: 'failed',
          completed: completedCount,
          total,
          warning: normalizedError || normalizedWarning || '生成失败',
        })
        return result.value
      }

      completedCount += 1
      sendProgress(sender, {
        novelId: context.novelId,
        step: key,
        label,
        status: 'success',
        completed: completedCount,
        total,
        warning: normalizedWarning || undefined,
      })

      return result.value
    } catch (error) {
      const normalizedError = sanitizeErrorMessage(error)
      steps.push({ key, label, status: 'failed', error: normalizedError })
      warnings.push(`${label}：${normalizedError}`)
      sendProgress(sender, {
        novelId: context.novelId,
        step: key,
        label,
        status: 'failed',
        completed: completedCount,
        total,
        warning: normalizedError,
      })
      return fallbackValue
    }
  }

  const storyGoal = await runStep('story_goal', '故事核心目标', '', async () => ({
    value: await runPlainTextStep(
      context,
      buildStoryGoalPromptV2(context),
      '故事核心目标',
      '',
    ),
  }))

  const coreConflict = await runStep('core_conflict', '核心冲突', '', async () => ({
    value: await runPlainTextStep(
      context,
      buildCoreConflictPromptV2(context, storyGoal),
      '核心冲突',
      `【故事核心目标】${storyGoal}`,
    ),
  }))

  const mainPlot = await runStep('main_plot', '主线剧情', '', async () => ({
    value: await runPlainTextStep(
      context,
      buildMainPlotPromptV2(context, storyGoal, coreConflict),
      '主线剧情',
      `【故事核心目标】${storyGoal}\n【核心冲突】${coreConflict}`,
    ),
  }))

  const subplotsResult = await runStep('sub_plots_list', '支线剧情', [] as SubPlotDraft[], async () => {
    const baseProgress = {
      novelId: context.novelId,
      step: 'sub_plots_list' as const,
      label: '支线剧情',
      completed: completedCount,
      total,
    }
    const { subplots, warning, status, error } = await generateSubplots(
      context,
      storyGoal,
      coreConflict,
      mainPlot,
      subplotCount,
      sender,
      baseProgress,
    )
    return {
      value: subplots,
      warning,
      status,
      error: error || (subplots.length > 0 ? undefined : '支线未生成，本次将继续生成节奏和结局'),
    }
  })

  const rhythm = await runStep('rhythm', '叙事节奏', DEFAULT_RHYTHM, async () => {
    const raw = await runPromptTask(
      context.novelId,
      context.modelConfigId,
      buildRhythmPromptV2(context, storyGoal, coreConflict, mainPlot, subplotsResult),
    )
    let parsed: Record<string, unknown>
    try {
      parsed = safeParseJson<Record<string, unknown>>(raw)
    } catch {
      return { value: DEFAULT_RHYTHM, warning: '节奏建议解析失败，已回退为 30/50/20' }
    }

    return { value: normalizeRhythm(parsed) }
  })

  const endingPayload = await runStep('ending', '结局设定', {
    ending_type: 'open' as CoreSettingsEndingType,
    ending: '',
  }, async () => {
    const rhythmSummary = `前期铺垫 ${rhythm.rhythm_setup}% / 中期冲突 ${rhythm.rhythm_conflict}% / 后期收束 ${rhythm.rhythm_ending}%`
    const raw = await runPromptTask(
      context.novelId,
      context.modelConfigId,
      buildEndingPromptV2(context, storyGoal, coreConflict, mainPlot, subplotsResult, rhythmSummary),
    )

    let parsed: Record<string, unknown> | null = null
    try {
      parsed = safeParseJson<Record<string, unknown>>(raw)
    } catch {
      parsed = null
    }

    const rawEnding = parsed && typeof parsed.ending === 'string'
      ? parsed.ending.trim()
      : cleanPlainText(raw)
    const polishedEnding = rawEnding
      ? await polishPlainTextV2(
        context,
        '结局设定',
        rawEnding,
        `【故事核心目标】${storyGoal}\n【核心冲突】${coreConflict}\n【主线剧情】${mainPlot}`,
      )
      : ''

    if (!polishedEnding) {
      throwUserFacingError('coreSettings.endingEmpty')
    }

    return {
      value: {
        ending_type: parseEndingType(parsed?.ending_type) || inferEndingType(polishedEnding),
        ending: polishedEnding,
      },
      warning: parsed ? undefined : '结局类型解析失败，已按文案语义推断',
    }
  })

  return {
    story_goal: storyGoal,
    core_conflict: coreConflict,
    main_plot: mainPlot,
    sub_plots_list: subplotsResult,
    rhythm_setup: rhythm.rhythm_setup,
    rhythm_conflict: rhythm.rhythm_conflict,
    rhythm_ending: rhythm.rhythm_ending,
    ending_type: endingPayload.ending_type,
    ending: endingPayload.ending,
    steps,
    warnings,
    completedSteps: steps.filter((step) => step.status === 'success' || step.status === 'warning').length,
    failedSteps: steps.filter((step) => step.status === 'failed').length,
    hasPartialResult: Boolean(
      clean(storyGoal) ||
      clean(coreConflict) ||
      clean(mainPlot) ||
      subplotsResult.length > 0 ||
      clean(endingPayload.ending),
    ),
  }
}
