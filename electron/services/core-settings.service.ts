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
  parseSubPlotFrameworkResponse,
  validateGeneratedSubplots,
  type PromptMessage,
  type SubPlotDraft,
} from '../../src/shared/subplot-framework'
import { cleanAiFieldText } from '../../src/utils/text'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { buildHumanLanguageRules } from '../../src/shared/prompt-library'
import { generateSubplotBatch } from './subplot.service'
import { runChatTask } from './task.service'

const SUBPLOT_GENERATION_CHUNK_SIZE = 3
const SUBPLOT_GENERATION_RETRY_LIMIT = 1
const DEFAULT_RHYTHM = {
  rhythm_setup: 30,
  rhythm_conflict: 50,
  rhythm_ending: 20,
}

interface StoryContext {
  novelId: number
  modelConfigId?: number
  novelTitle: string
  genre: string
  background: string
  worldRulesSummary: string
  protagonistReference: string
  protagonistRule: string
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

function sanitizeErrorMessage(error: unknown, fallback = '生成失败'): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clampSubplotCount(value: number): number {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(20, Math.round(value)))
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

async function loadStoryContext(request: CoreSettingsGenerationRequest): Promise<StoryContext> {
  const profile = await buildStoryProfile(request.novelId)
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, request.novelId)).all()[0]

  if (!novel) {
    throw new Error('小说不存在')
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
    requirements: clean(request.requirements),
  }
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
    throw new Error(`${label}生成结果为空`)
  }

  return polishPlainText(context, label, cleaned, relatedContext)
}

async function tryGenerateSubplotBatch(
  context: StoryContext,
  storyGoal: string,
  coreConflict: string,
  mainPlot: string,
  batchCount: number,
  accumulated: SubPlotDraft[],
  currentBatch: number,
  totalBatches: number,
): Promise<{ batchResult: Awaited<ReturnType<typeof generateSubplotBatch>> | null; warning?: string }> {
  let lastError: unknown

  const runBatch = async (maxConflictLength: number) => {
    const messages: PromptMessage[] = [{
      role: 'user',
      content: buildSubplotPrompt(
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
        })
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
      const polishedRaw = await runPromptTask(
        context.novelId,
        context.modelConfigId,
        buildSubplotPolishPrompt(context, storyGoal, coreConflict, mainPlot, accumulated),
      )
      const polished = parseSubPlotFrameworkResponse(polishedRaw)
      const validation = validateGeneratedSubplots(polished, {
        existingSubplots: [],
        expectedCount: accumulated.length,
        maxConflictLength: 90,
        maxMainlineLinkLength: 60,
      })

      if (validation.accepted.length > 0) {
        accumulated = validation.accepted
        if (validation.warningMessage) {
          warnings.push(`支线语言修正后校验提示：${validation.warningMessage}`)
        }
      } else {
        warnings.push('支线语言修正结果未通过校验，已保留原始支线框架')
      }
    } catch {
      warnings.push('支线语言修正失败，已保留原始支线框架')
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
      buildStoryGoalPrompt(context),
      '故事核心目标',
      '',
    ),
  }))

  const coreConflict = await runStep('core_conflict', '核心冲突', '', async () => ({
    value: await runPlainTextStep(
      context,
      buildCoreConflictPrompt(context, storyGoal),
      '核心冲突',
      `【故事核心目标】${storyGoal}`,
    ),
  }))

  const mainPlot = await runStep('main_plot', '主线剧情', '', async () => ({
    value: await runPlainTextStep(
      context,
      buildMainPlotPrompt(context, storyGoal, coreConflict),
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
      buildRhythmPrompt(context, storyGoal, coreConflict, mainPlot, subplotsResult),
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
      buildEndingPrompt(context, storyGoal, coreConflict, mainPlot, subplotsResult, rhythmSummary),
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
      ? await polishPlainText(
        context,
        '结局设定',
        rawEnding,
        `【故事核心目标】${storyGoal}\n【核心冲突】${coreConflict}\n【主线剧情】${mainPlot}`,
      )
      : ''

    if (!polishedEnding) {
      throw new Error('结局设定生成结果为空')
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
