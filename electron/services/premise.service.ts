import type { WebContents } from 'electron'
import { desc, eq } from 'drizzle-orm'
import {
  PREMISE_GENERATION_STEPS,
  type PremiseGenerationMode,
  type PremiseGenerationProgressEvent,
  type PremiseGenerationRequest,
  type PremiseGenerationResult,
  type PremiseGenerationStepKey,
  type PremiseGenerationStepResult,
} from '../../src/shared/premise-generation'
import {
  buildContextAlignmentRules,
  buildGenreRealityRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import {
  parseStorySettingsDocument,
  type StorySettingsDocument,
} from '../../src/shared/story-settings'
import { cleanAiFieldText, cleanAiValue } from '../../src/utils/text'
import { getDb } from '../database/db'
import { characters, novels, tasks } from '../database/schema'
import { safeParseAiJson } from '../utils/json'
import { buildStoryProfile, buildStoryRelationSummary } from './context.service'
import { createTask, runChatTask, updateTask } from './task.service'

interface PremiseContext {
  novelId: number
  modelConfigId?: number
  mode: PremiseGenerationMode
  novelTitle: string
  genre: string
  background: string
  worldRulesSummary: string
  protagonistReference: string
  protagonistRule: string
  writingContractSummary: string
  relationSummary: string
  requirements: string
  currentSettings: StorySettingsDocument
}

interface PremiseCoreDraft {
  positioning: string
  coreHook: string
  protagonistStart: string
  constraints: string
  languageGuardrails: string
}

interface WritingRulesDraft {
  antiAiFlavor: string
  commonSenseRules: string
  bannedTerms: string
}

type PremiseFieldKey =
  | 'positioning'
  | 'coreHook'
  | 'protagonistStart'
  | 'constraints'
  | 'languageGuardrails'
  | 'antiAiFlavor'
  | 'commonSenseRules'
  | 'bannedTerms'

type WritingRulesFieldKey = 'antiAiFlavor' | 'commonSenseRules' | 'bannedTerms'

interface PremiseResultWithMeta extends PremiseGenerationResult {
  missingFields?: PremiseFieldKey[]
  draftTaskId?: number
}

interface PremiseDraftRecord {
  taskId: number
  novelId: number
  status: 'pending' | 'applied'
  result: PremiseResultWithMeta
  warnings: string[]
  sourcePage?: string
  mode?: PremiseGenerationMode
  appliedMode?: PremiseGenerationMode
  createdAt: string
  completedAt: string
  appliedAt?: string
}

interface PersistedPremiseDraftProgress {
  kind: 'premise_draft'
  message: string
  cleared?: boolean
  draft: PremiseDraftRecord
}

const STEP_LABELS = new Map(PREMISE_GENERATION_STEPS.map((item) => [item.key, item.label]))

const FIELD_LABELS: Record<PremiseFieldKey, string> = {
  positioning: '作品定位',
  coreHook: '核心信息',
  protagonistStart: '主角起点',
  constraints: '底层约束',
  languageGuardrails: '语言边界',
  antiAiFlavor: '去 AI 腔规则',
  commonSenseRules: '常识约束',
  bannedTerms: '禁用表达',
}

const WRITING_RULE_FIELD_KEYS: WritingRulesFieldKey[] = ['antiAiFlavor', 'commonSenseRules', 'bannedTerms']

function clean(value?: string | null): string {
  return value?.trim() || ''
}

function section(title: string, content?: string | null): string {
  const body = clean(content)
  if (!body) return ''
  return `【${title}】\n${body}`
}

function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function sanitizeErrorMessage(error: unknown, fallback = '生成失败'): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[[^\]]+\]\s*/g, '').replace(/\s+/g, ' ').trim()
}

function previewText(text: string, max = 220): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function parseJsonObject<T extends Record<string, unknown>>(raw?: string | null): T {
  if (!raw) return {} as T

  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : {} as T
  } catch {
    return {} as T
  }
}

function getWritingRuleMissingFields(draft: WritingRulesDraft): WritingRulesFieldKey[] {
  return WRITING_RULE_FIELD_KEYS.filter((field) => !clean(draft[field]))
}

function getMissingPremiseFields(result: PremiseResultWithMeta): PremiseFieldKey[] {
  return (Object.keys(FIELD_LABELS) as PremiseFieldKey[]).filter((field) => !clean(result[field]))
}

function buildDraftMessage(draft: PremiseDraftRecord, cleared = false): string {
  if (cleared) return '基础设定 AI 草稿已清除。'
  if (draft.appliedAt) return '基础设定 AI 草稿已应用到表单，尚未保存。'
  return '基础设定 AI 草稿已生成，等待应用到表单。'
}

function serializePremiseDraftProgress(draft: PremiseDraftRecord, cleared = false): string {
  const payload: PersistedPremiseDraftProgress = {
    kind: 'premise_draft',
    message: buildDraftMessage(draft, cleared),
    cleared,
    draft,
  }
  return JSON.stringify(payload)
}

function parsePremiseDraftProgress(raw?: string | null): PersistedPremiseDraftProgress | null {
  const parsed = parseJsonObject<Record<string, unknown>>(raw)
  if (parsed.kind !== 'premise_draft') return null

  const draft = parsed.draft
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null

  const record = draft as Record<string, unknown>
  const result = record.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null

  return {
    kind: 'premise_draft',
    message: typeof parsed.message === 'string' ? parsed.message : '',
    cleared: Boolean(parsed.cleared),
    draft: {
      taskId: typeof record.taskId === 'number' ? record.taskId : 0,
      novelId: typeof record.novelId === 'number' ? record.novelId : 0,
      status: record.status === 'applied' ? 'applied' : 'pending',
      result: result as PremiseResultWithMeta,
      warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === 'string') : [],
      sourcePage: typeof record.sourcePage === 'string' ? record.sourcePage : undefined,
      mode: record.mode === 'fill_blanks' ? 'fill_blanks' : record.mode === 'replace' ? 'replace' : undefined,
      appliedMode: record.appliedMode === 'fill_blanks' ? 'fill_blanks' : record.appliedMode === 'replace' ? 'replace' : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
      completedAt: typeof record.completedAt === 'string' ? record.completedAt : '',
      appliedAt: typeof record.appliedAt === 'string' ? record.appliedAt : undefined,
    },
  }
}

function listPremiseDraftTasks(novelId: number) {
  const db = getDb()
  return db.select().from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .filter((task) => task.type === 'premise_generate' && parsePremiseDraftProgress(task.progressJson))
}

function sendProgress(sender: WebContents | undefined, payload: PremiseGenerationProgressEvent) {
  if (!sender || sender.isDestroyed()) return
  sender.send('ai:premise-progress', payload)
}

async function runPromptTask(
  novelId: number,
  modelConfigId: number | undefined,
  prompt: string,
): Promise<string> {
  const messages = [{ role: 'user' as const, content: prompt }]
  return runChatTask({
    type: 'premise_generate',
    novelId,
    modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson: JSON.stringify(messages),
    messages,
    retryable: true,
  })
}

function buildJsonRepairPrompt(label: string, raw: string, allowedKeys: string[]): string {
  const schema = `{${allowedKeys.map((key) => `"${key}": ""`).join(', ')}}`
  return renderPrompt([
    `你现在只负责修复 ${label} 的 JSON 格式，不新增设定，不重写内容。`,
    section('任务目标', [
      '把下面的原始输出整理成一个合法的 JSON 对象。',
      `只允许保留这些键：${allowedKeys.join(' / ')}`,
      '所有字段值都必须是字符串。',
    ].join('\n')),
    section('原始输出', raw),
    section('强约束', [
      '不要补剧情，不要扩写，不要改事实方向。',
      '如果有代码块、说明文字、多余字段或数组包裹，删除它们。',
      '如果字符串内部出现双引号，必须正确转义。',
      '只输出合法 JSON 对象，不要解释，不要 Markdown，不要注释。',
    ].join('\n')),
    `输出格式参考：${schema}`,
  ])
}

async function runPromptTaskWithJsonRepair<T>(
  novelId: number,
  modelConfigId: number | undefined,
  prompt: string,
  label: string,
  allowedKeys: string[],
  parser: (raw: string) => T,
): Promise<{ value: T; repaired: boolean }> {
  const raw = await runPromptTask(novelId, modelConfigId, prompt)

  try {
    return { value: parser(raw), repaired: false }
  } catch (initialError) {
    const initialMessage = sanitizeErrorMessage(initialError, `${label} 解析失败`)

    let repairedRaw = ''
    try {
      repairedRaw = await runPromptTask(
        novelId,
        modelConfigId,
        buildJsonRepairPrompt(label, raw, allowedKeys),
      )
    } catch (repairTaskError) {
      throw new Error(`${label} JSON 解析失败，自动修复步骤执行失败：${sanitizeErrorMessage(repairTaskError)}。原始输出片段：${previewText(raw)}`)
    }

    try {
      return { value: parser(repairedRaw), repaired: true }
    } catch (repairError) {
      throw new Error(
        `${label} JSON 解析失败，已自动修复一次仍未成功。首轮原因：${initialMessage}。修复后原因：${sanitizeErrorMessage(repairError)}。原始输出片段：${previewText(raw)}`,
      )
    }
  }
}

function resolveField(currentValue: string, generatedValue: unknown, mode: PremiseGenerationMode): string {
  const current = clean(currentValue)
  if (mode === 'fill_blanks' && current) return current
  return cleanAiFieldText(typeof generatedValue === 'string' ? generatedValue : '')
}

function buildModeInstruction(mode: PremiseGenerationMode): string {
  if (mode === 'fill_blanks') {
    return [
      '本轮是补空模式。已有字段视为已确认边界，不要重写成另一套设定。',
      '如果某个字段已有清晰内容，你可以沿用它的方向，但输出时保留原字段，不要强行改写。',
      '优先补齐缺口，减少扩写，保证后续故事设计能直接引用。',
    ].join('\n')
  }

  return [
    '本轮是重整首版模式。允许统一整理措辞，但不能脱离当前题材、背景、世界规则和人物处境。',
    '目标是给出更稳定的基础设定底盘，而不是提前写剧情。',
  ].join('\n')
}

function buildPremiseCorePrompt(context: PremiseContext): string {
  const premise = context.currentSettings.premise
  return renderPrompt([
    '请为这部小说生成一版“基础设定”，只处理背景定位、核心信息、主角起点、底层约束和语言边界。',
    section('任务模式', buildModeInstruction(context.mode)),
    section('作品输入', [
      `小说：${context.novelTitle}`,
      `题材：${context.genre}`,
      context.background ? `背景：${context.background}` : '',
      context.worldRulesSummary ? `世界规则摘要：${context.worldRulesSummary}` : '',
      `主角指代：${context.protagonistReference}`,
      `主角称呼规则：${context.protagonistRule}`,
    ].filter(Boolean).join('\n')),
    section('写作类型', context.writingContractSummary),
    section('关键人物关系', context.relationSummary),
    section('当前基础设定', [
      premise.positioning ? `作品定位：${premise.positioning}` : '',
      premise.coreHook ? `核心信息：${premise.coreHook}` : '',
      premise.protagonistStart ? `主角起点：${premise.protagonistStart}` : '',
      premise.constraints ? `底层约束：${premise.constraints}` : '',
      premise.languageGuardrails ? `语言边界：${premise.languageGuardrails}` : '',
    ].filter(Boolean).join('\n')),
    section('强约束', [
      '这里只能生成基础设定，不准写主线、支线、章节、转折、结局。',
      '不要把背景底盘直接写成已经发生的详细剧情。',
      '命名、概念和措辞必须符合正常中文表达，不准生造不连贯词语。',
      '人物行为、资源条件、制度压力、距离、风险和代价必须符合常识或已给定题材规则。',
      '如果给了写作类型，就要把它翻译成读者预期、关系推进速度和语言边界，而不是只把标签换个说法写回去。',
      '如果给了关系摘要，主角起点、核心信息和底层约束必须能解释关键关系为什么会这样拉扯。',
      '如果输入信息不足，就保守输出，不要幻觉补完。',
      context.requirements,
    ].filter(Boolean).join('\n')),
    section('上下文护栏', buildContextAlignmentRules({
      background: context.background,
      storyCore: '',
      worldSummary: context.worldRulesSummary,
      taskFocus: '稳定基础设定，不提前写剧情',
      extraLines: [
        '所有输出都要服务后续故事设计、世界规则、人物资产和地图资产。',
        '不要将人物命运、主线推进和结局提前塞进基础设定。',
      ],
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: context.genre,
      worldSummary: context.worldRulesSummary,
      extraLines: [
        '如果题材允许超常元素，也必须写清限制、代价和社会后果。',
      ],
    })),
    section('输出质量底线', buildOutputQualityRules([
      '减少空话、套话、价值判断句和总结腔。',
      '用具体、可执行、可引用的表达写设定，不要写宣传文案。',
      '每个字段都要能直接被后续的故事设计页面引用。',
    ])),
    section('语言要求', buildHumanLanguageRules([
      '不要输出模板化金句、对称排比或万能情绪句。',
      '不要发明没有上下文支撑的专有名词。',
      '如果需要强调限制，请直接写规则、条件和代价。',
    ])),
    section('JSON 格式要求', [
      '顶层必须是 JSON 对象，不要输出数组。',
      '不要输出注释、额外说明、代码块或省略号。',
      '字符串内部如果出现双引号，必须转义。',
    ].join('\n')),
    '只输出 JSON，不要解释，不要代码块。',
    'JSON 键必须且只能使用 positioning / coreHook / protagonistStart / constraints / languageGuardrails。',
  ])
}

function buildWritingRulesPrompt(context: PremiseContext, premiseCore: PremiseCoreDraft): string {
  const writingRules = context.currentSettings.writingRules
  return renderPrompt([
    '请为这部小说生成“写作与去 AI 味约束”，只处理语言规则，不要补剧情。',
    section('任务模式', buildModeInstruction(context.mode)),
    section('已确定的基础设定', [
      `作品定位：${premiseCore.positioning}`,
      `核心信息：${premiseCore.coreHook}`,
      `主角起点：${premiseCore.protagonistStart}`,
      `底层约束：${premiseCore.constraints}`,
      premiseCore.languageGuardrails ? `语言边界：${premiseCore.languageGuardrails}` : '',
    ].filter(Boolean).join('\n')),
    section('写作类型', context.writingContractSummary),
    section('关键人物关系', context.relationSummary),
    section('当前写作规则', [
      writingRules.antiAiFlavor ? `去 AI 腔：${writingRules.antiAiFlavor}` : '',
      writingRules.commonSenseRules ? `常识约束：${writingRules.commonSenseRules}` : '',
      writingRules.bannedTerms ? `禁用表达：${writingRules.bannedTerms}` : '',
    ].filter(Boolean).join('\n')),
    section('输出目标', [
      'antiAiFlavor：写清具体禁写习惯，例如口号式总结、模板化情绪句、对称排比收尾。',
      'commonSenseRules：写清行为、伤势、资源、地图距离、制度压力、信息差等常识约束。',
      'bannedTerms：写需要尽量避免的空洞词、网文套话或容易显 AI 味的表达。',
    ].join('\n')),
    section('强约束', [
      '不要输出抽象价值观口号，要输出可执行的硬规则。',
      '不要写“语言优美”“富有张力”这类空泛要求。',
      '禁用表达必须是具体词类、句式类或命名类问题，不是泛泛提醒。',
      '常识约束必须能直接用于限制后续人物行为与情节推进。',
      '如果有爽文、写实、言情等写作类型，要把它们翻译成节奏、对白和关系推进规则。',
      '如果有关键关系摘要，要明确不同关系不能共用同一种语气，家人、朋友、陌生人、上下级和亲密关系要有不同说话方式。',
      context.requirements,
    ].filter(Boolean).join('\n')),
    section('输出质量底线', buildOutputQualityRules([
      '规则要短、硬、直接，避免写成长段抒情说明。',
      '尽量输出能直接复制到写作规则中的中文句子。',
    ])),
    section('语言要求', buildHumanLanguageRules([
      '所有规则都必须符合正常的人类中文表达。',
      '不要生造词，不要使用不自然的混搭概念。',
    ])),
    section('JSON 格式要求', [
      '顶层必须是 JSON 对象，不要输出数组。',
      '不要输出注释、额外说明、代码块或省略号。',
      '字符串内部如果出现双引号，必须转义。',
    ].join('\n')),
    '只输出 JSON，不要解释，不要代码块。',
    'JSON 键必须且只能使用 antiAiFlavor / commonSenseRules / bannedTerms。',
  ])
}

function buildWritingRulesPatchPrompt(
  context: PremiseContext,
  premiseCore: PremiseCoreDraft,
  currentRules: WritingRulesDraft,
  missingFields: WritingRulesFieldKey[],
): string {
  return renderPrompt([
    '请补齐这部小说缺失的“写作与去 AI 味约束”字段，只补空字段，不重写已有规则。',
    section('任务模式', [
      '本轮只补缺失字段，已有规则视为已确认内容。',
      `本轮只需要补这几个键：${missingFields.join(' / ')}`,
    ].join('\n')),
    section('已确定的基础设定', [
      `作品定位：${premiseCore.positioning}`,
      `核心信息：${premiseCore.coreHook}`,
      `主角起点：${premiseCore.protagonistStart}`,
      `底层约束：${premiseCore.constraints}`,
      premiseCore.languageGuardrails ? `语言边界：${premiseCore.languageGuardrails}` : '',
    ].filter(Boolean).join('\n')),
    section('写作类型', context.writingContractSummary),
    section('关键人物关系', context.relationSummary),
    section('当前已有写作规则', [
      currentRules.antiAiFlavor ? `去 AI 腔：${currentRules.antiAiFlavor}` : '去 AI 腔：<待补>',
      currentRules.commonSenseRules ? `常识约束：${currentRules.commonSenseRules}` : '常识约束：<待补>',
      currentRules.bannedTerms ? `禁用表达：${currentRules.bannedTerms}` : '禁用表达：<待补>',
    ].join('\n')),
    section('补齐要求', [
      missingFields.includes('antiAiFlavor') ? '- antiAiFlavor：补具体禁写句式、总结腔、模板化情绪句、对称排比收尾。' : '',
      missingFields.includes('commonSenseRules') ? '- commonSenseRules：补行为、伤势、资源、距离、制度压力、信息差等常识约束。' : '',
      missingFields.includes('bannedTerms') ? '- bannedTerms：补容易显 AI 味的空洞词、套话、命名习惯或句式。' : '',
      '只补缺的键，不要改写已有内容。',
      '规则必须短、硬、可执行，不要写空泛口号。',
      context.requirements,
    ].filter(Boolean).join('\n')),
    '只输出 JSON，不要解释，不要代码块。',
    `JSON 键必须且只能使用 ${missingFields.join(' / ')}。`,
  ])
}

function parsePremiseCore(raw: string): PremiseCoreDraft {
  const parsed = cleanAiValue(safeParseAiJson<Record<string, unknown>>(raw, 'object'))
  return {
    positioning: cleanAiFieldText(typeof parsed.positioning === 'string' ? parsed.positioning : ''),
    coreHook: cleanAiFieldText(typeof parsed.coreHook === 'string' ? parsed.coreHook : typeof parsed.core_hook === 'string' ? parsed.core_hook : ''),
    protagonistStart: cleanAiFieldText(
      typeof parsed.protagonistStart === 'string'
        ? parsed.protagonistStart
        : typeof parsed.protagonist_start === 'string'
          ? parsed.protagonist_start
          : '',
    ),
    constraints: cleanAiFieldText(typeof parsed.constraints === 'string' ? parsed.constraints : ''),
    languageGuardrails: cleanAiFieldText(
      typeof parsed.languageGuardrails === 'string'
        ? parsed.languageGuardrails
        : typeof parsed.language_guardrails === 'string'
          ? parsed.language_guardrails
          : '',
    ),
  }
}

function parseWritingRules(raw: string): WritingRulesDraft {
  const parsed = cleanAiValue(safeParseAiJson<Record<string, unknown>>(raw, 'object'))
  return {
    antiAiFlavor: cleanAiFieldText(
      typeof parsed.antiAiFlavor === 'string'
        ? parsed.antiAiFlavor
        : typeof parsed.anti_ai_flavor === 'string'
          ? parsed.anti_ai_flavor
          : '',
    ),
    commonSenseRules: cleanAiFieldText(
      typeof parsed.commonSenseRules === 'string'
        ? parsed.commonSenseRules
        : typeof parsed.common_sense_rules === 'string'
          ? parsed.common_sense_rules
          : '',
    ),
    bannedTerms: cleanAiFieldText(
      typeof parsed.bannedTerms === 'string'
        ? parsed.bannedTerms
        : typeof parsed.banned_terms === 'string'
          ? parsed.banned_terms
          : '',
    ),
  }
}

function resolvePremiseCore(
  currentSettings: StorySettingsDocument,
  draft: PremiseCoreDraft,
  mode: PremiseGenerationMode,
): PremiseCoreDraft {
  return {
    positioning: resolveField(currentSettings.premise.positioning, draft.positioning, mode),
    coreHook: resolveField(currentSettings.premise.coreHook, draft.coreHook, mode),
    protagonistStart: resolveField(currentSettings.premise.protagonistStart, draft.protagonistStart, mode),
    constraints: resolveField(currentSettings.premise.constraints, draft.constraints, mode),
    languageGuardrails: resolveField(currentSettings.premise.languageGuardrails, draft.languageGuardrails, mode),
  }
}

function resolveWritingRules(
  currentSettings: StorySettingsDocument,
  draft: WritingRulesDraft,
  mode: PremiseGenerationMode,
): WritingRulesDraft {
  return {
    antiAiFlavor: resolveField(currentSettings.writingRules.antiAiFlavor, draft.antiAiFlavor, mode),
    commonSenseRules: resolveField(currentSettings.writingRules.commonSenseRules, draft.commonSenseRules, mode),
    bannedTerms: resolveField(currentSettings.writingRules.bannedTerms, draft.bannedTerms, mode),
  }
}

function mergeMissingWritingRules(
  currentRules: WritingRulesDraft,
  patch: WritingRulesDraft,
  missingFields: WritingRulesFieldKey[],
): WritingRulesDraft {
  return {
    antiAiFlavor: missingFields.includes('antiAiFlavor') ? clean(patch.antiAiFlavor) || currentRules.antiAiFlavor : currentRules.antiAiFlavor,
    commonSenseRules: missingFields.includes('commonSenseRules') ? clean(patch.commonSenseRules) || currentRules.commonSenseRules : currentRules.commonSenseRules,
    bannedTerms: missingFields.includes('bannedTerms') ? clean(patch.bannedTerms) || currentRules.bannedTerms : currentRules.bannedTerms,
  }
}

async function loadPremiseContext(data: PremiseGenerationRequest): Promise<PremiseContext> {
  const profile = await buildStoryProfile(data.novelId)
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, data.novelId)).all()[0]
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, data.novelId)).all()

  if (!novel) {
    throw new Error('小说不存在')
  }

  return {
    novelId: data.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    mode: data.mode || 'replace',
    novelTitle: profile.novelTitle,
    genre: profile.genre,
    background: profile.background,
    worldRulesSummary: profile.worldRulesSummary,
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
    writingContractSummary: profile.writingContractSummary,
    relationSummary: buildStoryRelationSummary(
      data.novelId,
      allCharacters,
      [profile.protagonistReference, profile.storyGoal, profile.coreConflict, profile.themeVoiceSummary].filter(Boolean).join('\n'),
      6,
    ),
    requirements: clean(data.requirements),
    currentSettings: parseStorySettingsDocument(novel.settingsJson),
  }
}

function buildStepResult(
  key: PremiseGenerationStepKey,
  status: PremiseGenerationStepResult['status'],
  options: { warning?: string; error?: string } = {},
): PremiseGenerationStepResult {
  return {
    key,
    label: STEP_LABELS.get(key) || key,
    status,
    warning: options.warning,
    error: options.error,
  }
}

async function persistPremiseDraft(
  request: PremiseGenerationRequest,
  result: PremiseResultWithMeta,
  options: {
    warnings: string[]
    sourcePage?: string
    completedAt: string
  },
): Promise<number> {
  const taskId = await createTask({
    type: 'premise_generate',
    novelId: request.novelId,
    relatedEntityType: 'novel',
    relatedEntityId: request.novelId,
    inputJson: JSON.stringify({
      novelId: request.novelId,
      mode: request.mode || 'replace',
      requirements: request.requirements || '',
    }),
    runnerType: 'workflow',
    retryable: false,
    status: 'success',
  })

  const draft: PremiseDraftRecord = {
    taskId,
    novelId: request.novelId,
    status: 'pending',
    result: {
      ...result,
      draftTaskId: taskId,
    },
    warnings: options.warnings,
    sourcePage: options.sourcePage,
    mode: request.mode || 'replace',
    createdAt: new Date().toISOString(),
    completedAt: options.completedAt,
  }

  updateTask(taskId, {
    progressJson: serializePremiseDraftProgress(draft),
    outputText: JSON.stringify(draft.result, null, 2),
    errorMessage: null,
  })

  return taskId
}

export function getLatestPremiseDraft(novelId: number): PremiseDraftRecord | null {
  const task = listPremiseDraftTasks(novelId)
    .find((item) => {
      const progress = parsePremiseDraftProgress(item.progressJson)
      return progress && !progress.cleared
    }) || null

  if (!task) return null

  const progress = parsePremiseDraftProgress(task.progressJson)
  if (!progress || progress.cleared) return null

  return {
    ...progress.draft,
    taskId: task.id,
    result: {
      ...progress.draft.result,
      draftTaskId: task.id,
    },
  }
}

export function markPremiseDraftApplied(taskId: number, appliedMode: PremiseGenerationMode) {
  const db = getDb()
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0]
  if (!task) return

  const progress = parsePremiseDraftProgress(task.progressJson)
  if (!progress || progress.cleared) return

  const nextDraft: PremiseDraftRecord = {
    ...progress.draft,
    taskId,
    status: 'applied',
    appliedMode,
    appliedAt: progress.draft.appliedAt || new Date().toISOString(),
    result: {
      ...progress.draft.result,
      draftTaskId: taskId,
    },
  }

  updateTask(taskId, {
    progressJson: serializePremiseDraftProgress(nextDraft),
    outputText: JSON.stringify(nextDraft.result, null, 2),
  })
}

export function clearPremiseDrafts(novelId: number, excludeTaskId?: number) {
  listPremiseDraftTasks(novelId).forEach((task) => {
    if (excludeTaskId && task.id === excludeTaskId) return

    const progress = parsePremiseDraftProgress(task.progressJson)
    if (!progress || progress.cleared) return

    updateTask(task.id, {
      progressJson: serializePremiseDraftProgress({
        ...progress.draft,
        taskId: task.id,
        result: {
          ...progress.draft.result,
          draftTaskId: task.id,
        },
      }, true),
    })
  })
}

export async function generatePremise(
  data: PremiseGenerationRequest,
  sender?: WebContents,
): Promise<PremiseGenerationResult> {
  const context = await loadPremiseContext(data)
  const total = PREMISE_GENERATION_STEPS.length
  const warnings: string[] = []
  const steps: PremiseGenerationStepResult[] = []

  sendProgress(sender, {
    novelId: context.novelId,
    step: 'premise_core',
    label: STEP_LABELS.get('premise_core') || '基础定位与约束',
    status: 'running',
    completed: 0,
    total,
    detail: '正在整理基础定位、主角起点与底层约束。',
  })

  let premiseCore: PremiseCoreDraft
  let premiseCoreWarning: string | undefined
  try {
    const premiseCoreResult = await runPromptTaskWithJsonRepair(
      context.novelId,
      context.modelConfigId,
      buildPremiseCorePrompt(context),
      '基础定位与约束',
      ['positioning', 'coreHook', 'protagonistStart', 'constraints', 'languageGuardrails'],
      parsePremiseCore,
    )
    premiseCore = resolvePremiseCore(context.currentSettings, premiseCoreResult.value, context.mode)
    if (premiseCoreResult.repaired) {
      premiseCoreWarning = '基础定位与约束的 JSON 输出格式异常，已自动修复一次后继续使用结果。'
      warnings.push(premiseCoreWarning)
    }
  } catch (error) {
    const errorMessage = `基础定位与约束生成失败：${sanitizeErrorMessage(error)}`
    sendProgress(sender, {
      novelId: context.novelId,
      step: 'premise_core',
      label: STEP_LABELS.get('premise_core') || '基础定位与约束',
      status: 'failed',
      completed: 0,
      total,
      detail: errorMessage,
      warning: errorMessage,
    })
    throw new Error(errorMessage)
  }

  sendProgress(sender, {
    novelId: context.novelId,
    step: 'premise_core',
    label: STEP_LABELS.get('premise_core') || '基础定位与约束',
    status: 'success',
    completed: 1,
    total,
    detail: '基础定位与约束已生成。',
    warning: premiseCoreWarning,
  })
  steps.push(buildStepResult('premise_core', 'success', premiseCoreWarning ? { warning: premiseCoreWarning } : {}))

  let writingRules = {
    antiAiFlavor: context.currentSettings.writingRules.antiAiFlavor,
    commonSenseRules: context.currentSettings.writingRules.commonSenseRules,
    bannedTerms: context.currentSettings.writingRules.bannedTerms,
  }
  let hasPartialResult = false
  const writingRuleStepWarnings: string[] = []

  sendProgress(sender, {
    novelId: context.novelId,
    step: 'writing_rules',
    label: STEP_LABELS.get('writing_rules') || '语言与去 AI 边界',
    status: 'running',
    completed: 1,
    total,
    detail: '正在整理语言边界、常识约束与禁用表达。',
  })

  let initialWritingRulesError: string | undefined
  try {
    const writingRulesResult = await runPromptTaskWithJsonRepair(
      context.novelId,
      context.modelConfigId,
      buildWritingRulesPrompt(context, premiseCore),
      '语言与写作边界',
      ['antiAiFlavor', 'commonSenseRules', 'bannedTerms'],
      parseWritingRules,
    )
    writingRules = resolveWritingRules(context.currentSettings, writingRulesResult.value, context.mode)
    const repairWarning = writingRulesResult.repaired
      ? '语言与写作边界的 JSON 输出格式异常，已自动修复一次后继续使用结果。'
      : undefined
    if (repairWarning) {
      warnings.push(repairWarning)
      writingRuleStepWarnings.push(repairWarning)
    }
  } catch (error) {
    initialWritingRulesError = sanitizeErrorMessage(error, '生成失败')
    const warning = `写作边界首轮生成失败，准备仅针对缺失规则补救一次：${initialWritingRulesError}`
    warnings.push(warning)
    writingRuleStepWarnings.push(warning)
  }

  let missingWritingFields = getWritingRuleMissingFields(writingRules)

  if (missingWritingFields.length > 0) {
    try {
      const patchResult = await runPromptTaskWithJsonRepair(
        context.novelId,
        context.modelConfigId,
        buildWritingRulesPatchPrompt(context, premiseCore, writingRules, missingWritingFields),
        '语言与写作边界补字段',
        missingWritingFields,
        parseWritingRules,
      )
      writingRules = mergeMissingWritingRules(writingRules, patchResult.value, missingWritingFields)

      const patchRepairWarning = patchResult.repaired
        ? '语言与写作边界补字段时 JSON 输出格式异常，已自动修复一次后继续使用结果。'
        : undefined

      if (patchRepairWarning) {
        warnings.push(patchRepairWarning)
        writingRuleStepWarnings.push(patchRepairWarning)
      }
    } catch (error) {
      const warning = `写作边界补字段失败：${sanitizeErrorMessage(error, '生成失败')}`
      warnings.push(warning)
      writingRuleStepWarnings.push(warning)
    }

    missingWritingFields = getWritingRuleMissingFields(writingRules)
  }

  if (missingWritingFields.length > 0) {
    const warning = `以下规则仍为空：${missingWritingFields.map((field) => FIELD_LABELS[field]).join('、')}`
    warnings.push(warning)
    writingRuleStepWarnings.push(warning)
    hasPartialResult = true

    sendProgress(sender, {
      novelId: context.novelId,
      step: 'writing_rules',
      label: STEP_LABELS.get('writing_rules') || '语言与去 AI 边界',
      status: 'failed',
      completed: 1,
      total,
      detail: warning,
      warning,
    })
  } else {
    sendProgress(sender, {
      novelId: context.novelId,
      step: 'writing_rules',
      label: STEP_LABELS.get('writing_rules') || '语言与去 AI 边界',
      status: 'success',
      completed: 2,
      total,
      detail: '语言与写作边界已生成。',
      warning: writingRuleStepWarnings.join('；') || undefined,
    })
  }

  steps.push(buildStepResult(
    'writing_rules',
    writingRuleStepWarnings.length > 0 ? 'warning' : 'success',
    writingRuleStepWarnings.length > 0 ? { warning: writingRuleStepWarnings.join('；') } : {},
  ))

  const resultWithoutDraftId: PremiseResultWithMeta = {
    positioning: premiseCore.positioning,
    coreHook: premiseCore.coreHook,
    protagonistStart: premiseCore.protagonistStart,
    constraints: premiseCore.constraints,
    languageGuardrails: premiseCore.languageGuardrails,
    antiAiFlavor: writingRules.antiAiFlavor,
    commonSenseRules: writingRules.commonSenseRules,
    bannedTerms: writingRules.bannedTerms,
    steps,
    warnings,
    hasPartialResult,
    missingFields: [],
  }

  resultWithoutDraftId.missingFields = getMissingPremiseFields(resultWithoutDraftId)

  if (resultWithoutDraftId.missingFields.length > 0) {
    warnings.push(`以下字段仍为空：${resultWithoutDraftId.missingFields.map((field) => FIELD_LABELS[field]).join('、')}`)
    resultWithoutDraftId.missingFields = getMissingPremiseFields(resultWithoutDraftId)
    resultWithoutDraftId.hasPartialResult = true
  }

  try {
    const completedAt = new Date().toISOString()
    const draftTaskId = await persistPremiseDraft(data, resultWithoutDraftId, {
      warnings,
      sourcePage: 'premise',
      completedAt,
    })
    clearPremiseDrafts(data.novelId, draftTaskId)
    resultWithoutDraftId.draftTaskId = draftTaskId
  } catch (error) {
    warnings.push(`基础设定草稿持久化失败，重启后可能丢失：${sanitizeErrorMessage(error, '持久化失败')}`)
  }

  return resultWithoutDraftId
}
