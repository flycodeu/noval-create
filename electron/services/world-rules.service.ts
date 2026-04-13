import type { WebContents } from 'electron'
import { eq } from 'drizzle-orm'
import type { GenreWorldRules } from '../../src/shared/genre-system'
import {
  buildCharacterEcologySummary,
  buildMapBlueprintSummary,
  buildRealityConstraintSummary,
  buildTimelineConfigSummary,
  buildWritingStyleSummary,
} from '../../src/shared/genre-system'
import { normalizeWorldRulesDraft } from '../../src/shared/world-rules-draft'
import {
  buildContextAlignmentRules,
  buildGenreRealityRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import {
  WORLD_RULE_SECTION_DEFINITIONS,
  WORLD_RULE_SECTION_ORDER,
  type WorldRuleSectionKey,
  type WorldRulesGenerationProgressEvent,
  type WorldRulesGenerationRequest,
  type WorldRulesGenerationResult,
  type WorldRulesGenerationStepResult,
} from '../../src/shared/world-rules-generation'
import { cleanAiFieldText, cleanAiValue } from '../../src/utils/text'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import { throwUserFacingError } from '../utils/user-facing-error'

const SECTION_LABELS = new Map(WORLD_RULE_SECTION_DEFINITIONS.map((item) => [item.key, item.label]))

function clean(value?: string | null): string {
  return value?.trim() || ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function joinLines(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n')
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

function summarizeLanguageConstraints(rules: GenreWorldRules): string {
  const writing = rules.writingConstraints
  return joinLines([
    writing.antiQuoteEmphasis ? '避免用引号抬高普通概念。' : '',
    writing.antiConceptSlogans ? '避免概念口号和空泛金句。' : '',
    writing.antiSymmetricLines ? '避免对称排比和刻意整句。' : '',
    buildRealityConstraintSummary(writing),
    buildWritingStyleSummary(writing),
  ])
}

function summarizeCurrentSection(sectionKey: WorldRuleSectionKey, rules: GenreWorldRules): string {
  switch (sectionKey) {
    case 'overview':
      return joinLines([
        `题材名称：${rules.genreProfile.name || '未设置'}`,
        rules.genreProfile.subgenre ? `子类型：${rules.genreProfile.subgenre}` : '',
        rules.genreProfile.worldviewTone ? `世界观基调：${rules.genreProfile.worldviewTone}` : '',
        rules.genreProfile.socialFrame ? `社会框架：${rules.genreProfile.socialFrame}` : '',
        rules.genreProfile.narrativeFocus.length > 0 ? `叙事焦点：${rules.genreProfile.narrativeFocus.join('、')}` : '',
        rules.genreProfile.languageAvoidances.length > 0 ? `语言避让：${rules.genreProfile.languageAvoidances.join('、')}` : '',
      ])
    case 'power':
      return rules.powerSystems
        .map((system, index) => joinLines([
          `${index + 1}. 体系：${system.name || '未命名'}`,
          system.appliesTo.length > 0 ? `   适用对象：${system.appliesTo.join('、')}` : '',
          system.levels.length > 0 ? `   等级阶段：${system.levels.join(' / ')}` : '',
          system.advancementRule ? `   晋升规则：${system.advancementRule}` : '',
          system.limitations ? `   限制条件：${system.limitations}` : '',
          system.cost ? `   代价：${system.cost}` : '',
          system.taboo ? `   禁忌：${system.taboo}` : '',
        ]))
        .join('\n')
    case 'species':
      return [
        rules.speciesSystem.length > 0
          ? section('种族实体', rules.speciesSystem.map((item, index) => joinLines([
              `${index + 1}. 名称：${item.name || '未命名'}`,
              item.entityType ? `   实体类型：${item.entityType}` : '',
              item.summary ? `   概述：${item.summary}` : '',
              item.traits.length > 0 ? `   特征：${item.traits.join('、')}` : '',
              item.commonIdentities.length > 0 ? `   常见身份：${item.commonIdentities.join('、')}` : '',
              item.relationToHumans ? `   与主流社会关系：${item.relationToHumans}` : '',
              item.storyUse ? `   剧情用途：${item.storyUse}` : '',
            ])).join('\n'))
          : '',
        rules.factionSystem.length > 0
          ? section('组织势力', rules.factionSystem.map((item, index) => joinLines([
              `${index + 1}. 名称：${item.name || '未命名'}`,
              item.factionType ? `   势力类型：${item.factionType}` : '',
              item.summary ? `   概述：${item.summary}` : '',
              item.structure ? `   组织结构：${item.structure}` : '',
              item.resources ? `   核心资源：${item.resources}` : '',
              item.externalRelations ? `   对外关系：${item.externalRelations}` : '',
              item.recruitFrom ? `   招募来源：${item.recruitFrom}` : '',
              item.notableSites.length > 0 ? `   重要据点：${item.notableSites.join('、')}` : '',
            ])).join('\n'))
          : '',
      ].filter(Boolean).join('\n\n')
    case 'ecology':
      return buildCharacterEcologySummary(rules)
    case 'map':
      return buildMapBlueprintSummary(rules)
    case 'timeline':
      return buildTimelineConfigSummary(rules)
    case 'language':
      return summarizeLanguageConstraints(rules)
    default:
      return ''
  }
}

function summarizeOtherSections(sectionKey: WorldRuleSectionKey, rules: GenreWorldRules): string {
  return WORLD_RULE_SECTION_ORDER
    .filter((key) => key !== sectionKey)
    .map((key) => {
      const summary = summarizeCurrentSection(key, rules)
      if (!summary) return ''
      return section(SECTION_LABELS.get(key) || key, summary)
    })
    .filter(Boolean)
    .join('\n\n')
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return joinLines([
    `小说：${profile.novelTitle}`,
    `题材：${profile.genre}`,
    profile.background ? `基础背景：${profile.background}` : '',
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.endgameDesignSummary,
    profile.writingRulesSummary,
    `主角指代：${profile.protagonistReference}`,
    `主角称呼规则：${profile.protagonistRule}`,
  ])
}

function buildActionInstruction(action: WorldRulesGenerationRequest['action']): string {
  if (action === 'expand') {
    return joinLines([
      '基于当前分区草稿继续扩写，不要推翻已有可用内容。',
      '新增信息要回扣基础背景、核心设定、题材以及其他分区。',
      '优先补足限制、代价、结构关系、剧情用途与可写场景。',
    ])
  }

  return joinLines([
    '如果当前分区为空，直接给出可落到表单的第一版规则。',
    '如果当前分区已有部分内容，允许继承并补全，不要重复堆砌。',
    '减少空泛口号与百科式说明，让规则能直接服务人物、地图、时间轴和写作。',
  ])
}

function buildSectionRequirement(sectionKey: WorldRuleSectionKey): string {
  switch (sectionKey) {
    case 'overview':
      return joinLines([
        '写清世界观基调、社会框架与故事叙事重心。',
        '尽量让基调和人物处境、资源竞争、组织关系直接相连。',
      ])
    case 'power':
      return joinLines([
        '每套体系都要具备对象、阶段、晋升条件、限制与代价。',
        '优先给出少而清晰的体系，不要一次堆出过多空壳等级。',
      ])
    case 'species':
      return joinLines([
        '种族、实体与势力的设定要能直接参与剧情冲突。',
        '种族写生存逻辑，势力写组织结构与资源控制。',
      ])
    case 'ecology':
      return joinLines([
        '人物槽位要与主线冲突、势力结构、地图空间相连。',
        '尽量给出可用于人物批量生成的结构性槽位。',
      ])
    case 'map':
      return joinLines([
        '地图按层级设计，第 1 层表示国家、大区或界域，第 2 层表示每个上级下属的区域，更深层再表示地点。',
        '对 suggestedCount 的理解是“每个父节点各自拥有的直属子节点数量”，不是全局总数。',
      ])
    case 'timeline':
      return joinLines([
        '写清纪元、零点、显示格式、可用精度和推荐事件类型。',
        '时间规则要能直接服务事件时间轴的命名和排序。',
      ])
    case 'language':
      return joinLines([
        '文风约束要能直接作为后续正文写作的硬规则。',
        '优先强化自然中文、关系感和具体场景，减少 AI 味。',
      ])
    default:
      return ''
  }
}

function buildOutputSchema(sectionKey: WorldRuleSectionKey): string {
  switch (sectionKey) {
    case 'overview':
      return '只输出 JSON：{"genreProfile":{"name":"","subgenre":"","worldviewTone":"","socialFrame":"","narrativeFocus":[""],"languageAvoidances":[""]}}'
    case 'power':
      return '只输出 JSON：{"powerSystems":[{"name":"","appliesTo":[""],"levels":[""],"advancementRule":"","limitations":"","cost":"","taboo":""}]}'
    case 'species':
      return '只输出 JSON：{"speciesSystem":[{"name":"","entityType":"human|undead|beast|immortal|nonhuman","summary":"","traits":[""],"commonIdentities":[""],"relationToHumans":"","storyUse":""}],"factionSystem":[{"name":"","factionType":"","summary":"","structure":"","resources":"","externalRelations":"","recruitFrom":"","notableSites":[""]}]}'
    case 'ecology':
      return '只输出 JSON：{"characterEcology":{"overview":"","slots":[{"label":"","entityType":"human|undead|beast|immortal|nonhuman","species":"","narrativeFunction":"","contextLink":"","preferredFactions":[""],"powerBias":[""]}]}}'
    case 'map':
      return '只输出 JSON：{"mapBlueprint":{"overview":"","levels":[{"depth":1,"label":"","nodeTypes":[""],"relationHint":"","suggestedCount":3,"examples":[""]}]}}'
    case 'timeline':
      return '只输出 JSON：{"timelineConfig":{"calendarType":"gregorian|regnal|relative-disaster|custom-era|future-date","eraName":"","epochLabel":"","baseYearLabel":"","displayPattern":"","relativeZeroLabel":"","recommendedEventTypes":[""],"precisionOptions":[""]}}'
    case 'language':
      return '只输出 JSON：{"writingConstraints":{"antiQuoteEmphasis":true,"antiConceptSlogans":true,"antiSymmetricLines":true,"narrationStyle":"","dialogueStyle":"","forbiddenPhrases":[""],"extraRules":[""],"realismLevel":"strict-realism|rule-realism|stylized-fantasy","sciencePolicy":"","physicsPolicy":"","commonSenseFocus":[""],"contextAlignmentFocus":[""]}}'
    default:
      return ''
  }
}

function buildSectionPrompt(
  sectionKey: WorldRuleSectionKey,
  action: WorldRulesGenerationRequest['action'],
  profile: Awaited<ReturnType<typeof buildStoryProfile>>,
  rules: GenreWorldRules,
  requirements?: string,
): string {
  const sectionLabel = SECTION_LABELS.get(sectionKey) || sectionKey
  const currentSummary = summarizeCurrentSection(sectionKey, rules)
  const otherSummary = summarizeOtherSections(sectionKey, rules)

  return renderPrompt([
    `你现在只负责补全世界规则分区：${sectionLabel}。`,
    section('故事核心', buildStoryCoreSummary(profile)),
    section('当前分区草稿', currentSummary || '当前分区暂无可用草稿，请从零开始补齐。'),
    otherSummary ? section('其他分区参考', otherSummary) : '',
    requirements ? section('额外要求', requirements) : '',
    section('本轮任务', buildActionInstruction(action)),
    section('本分区硬要求', buildSectionRequirement(sectionKey)),
    section('上下文护栏', buildContextAlignmentRules({
      background: profile.background,
      storyCore: buildStoryCoreSummary(profile),
      worldSummary: [currentSummary, otherSummary].filter(Boolean).join('\n\n'),
      taskFocus: `只补“${sectionLabel}”这一个区块，并与现有小说信息、其他规则分区保持一致。`,
      extraLines: ['不要静悄悄把小说改造成另一种题材、时代或规则体系。'],
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: profile.genre,
      worldSummary: summarizeLanguageConstraints(rules),
      extraLines: ['如果你定义了超常规则，同时要写出它的限制、代价或触发条件。'],
    })),
    section('输出质量底线', buildOutputQualityRules([
      '每条规则都要能直接服务后续的人物、地图、时间轴和章节生成。',
      '宁可给出少而硬的规则，也不要堆一串漂亮但空泛的装饰想法。',
    ])),
    section('语言要求', buildHumanLanguageRules([
      '只补能直接写进世界规则表单的内容，不要写成宣传文案或百科腔。',
      '新增设定要给出用途、限制或影响，不要只留下一个漂亮名词。',
      '如果当前分区与其他分区有冲突，先修正冲突，不要强行两套并存。',
      '现实向题材先守常识、科学、物理和社会运作逻辑；幻想向题材先守既定体系、等级与代价。',
    ])),
    buildOutputSchema(sectionKey),
  ])
}

function applySectionPatch(
  currentRules: GenreWorldRules,
  sectionKey: WorldRuleSectionKey,
  patch: Partial<GenreWorldRules>,
  genreName: string,
): GenreWorldRules {
  switch (sectionKey) {
    case 'overview':
      return normalizeWorldRulesDraft({
        ...currentRules,
        genreProfile: {
          ...currentRules.genreProfile,
          ...asRecord(patch.genreProfile),
        },
      }, genreName)
    case 'power':
      return normalizeWorldRulesDraft({
        ...currentRules,
        powerSystems: patch.powerSystems ?? currentRules.powerSystems,
      }, genreName)
    case 'species':
      return normalizeWorldRulesDraft({
        ...currentRules,
        speciesSystem: patch.speciesSystem ?? currentRules.speciesSystem,
        factionSystem: patch.factionSystem ?? currentRules.factionSystem,
      }, genreName)
    case 'ecology':
      return normalizeWorldRulesDraft({
        ...currentRules,
        characterEcology: {
          ...currentRules.characterEcology,
          ...asRecord(patch.characterEcology),
        },
      }, genreName)
    case 'map':
      return normalizeWorldRulesDraft({
        ...currentRules,
        mapBlueprint: {
          ...currentRules.mapBlueprint,
          ...asRecord(patch.mapBlueprint),
        },
      }, genreName)
    case 'timeline':
      return normalizeWorldRulesDraft({
        ...currentRules,
        timelineConfig: {
          ...currentRules.timelineConfig,
          ...asRecord(patch.timelineConfig),
        },
      }, genreName)
    case 'language':
      return normalizeWorldRulesDraft({
        ...currentRules,
        writingConstraints: {
          ...currentRules.writingConstraints,
          ...asRecord(patch.writingConstraints),
        },
      }, genreName)
    default:
      return currentRules
  }
}

function parseSectionPatch(sectionKey: WorldRuleSectionKey, text: string): Partial<GenreWorldRules> {
  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(text))

  switch (sectionKey) {
    case 'overview': {
      const genreProfile = asRecord(parsed.genreProfile)
      const direct = Object.keys(genreProfile).length > 0 ? genreProfile : parsed
      return { genreProfile: direct as unknown as GenreWorldRules['genreProfile'] }
    }
    case 'power': {
      const powerSystems = Array.isArray(parsed.powerSystems)
        ? parsed.powerSystems
        : Array.isArray(parsed.systems)
          ? parsed.systems
          : Array.isArray(parsed.list)
            ? parsed.list
            : []
      return { powerSystems: powerSystems as unknown as GenreWorldRules['powerSystems'] }
    }
    case 'species': {
      const speciesSystem = Array.isArray(parsed.speciesSystem)
        ? parsed.speciesSystem
        : Array.isArray(parsed.species)
          ? parsed.species
          : []
      const factionSystem = Array.isArray(parsed.factionSystem)
        ? parsed.factionSystem
        : Array.isArray(parsed.factions)
          ? parsed.factions
          : []
      return {
        speciesSystem: speciesSystem as unknown as GenreWorldRules['speciesSystem'],
        factionSystem: factionSystem as unknown as GenreWorldRules['factionSystem'],
      }
    }
    case 'ecology': {
      const ecology = asRecord(parsed.characterEcology)
      const direct = Object.keys(ecology).length > 0 ? ecology : parsed
      return { characterEcology: direct as unknown as GenreWorldRules['characterEcology'] }
    }
    case 'map': {
      const blueprint = asRecord(parsed.mapBlueprint)
      const direct = Object.keys(blueprint).length > 0 ? blueprint : parsed
      return { mapBlueprint: direct as unknown as GenreWorldRules['mapBlueprint'] }
    }
    case 'timeline': {
      const config = asRecord(parsed.timelineConfig)
      const direct = Object.keys(config).length > 0 ? config : parsed
      return { timelineConfig: direct as unknown as GenreWorldRules['timelineConfig'] }
    }
    case 'language': {
      const writing = asRecord(parsed.writingConstraints)
      const direct = Object.keys(writing).length > 0 ? writing : parsed
      return { writingConstraints: direct as unknown as GenreWorldRules['writingConstraints'] }
    }
    default:
      return {}
  }
}

function ensurePatchHasContent(sectionKey: WorldRuleSectionKey, patch: Partial<GenreWorldRules>) {
  switch (sectionKey) {
    case 'overview':
      if (!patch.genreProfile || Object.keys(asRecord(patch.genreProfile)).length === 0) {
        throwUserFacingError('worldRules.overviewMissing')
      }
      return
    case 'power':
      if (!Array.isArray(patch.powerSystems) || patch.powerSystems.length === 0) {
        throwUserFacingError('worldRules.powerSystemMissing')
      }
      return
    case 'species':
      if (
        (!Array.isArray(patch.speciesSystem) || patch.speciesSystem.length === 0)
        && (!Array.isArray(patch.factionSystem) || patch.factionSystem.length === 0)
      ) {
        throwUserFacingError('worldRules.factionMissing')
      }
      return
    case 'ecology':
      if (!patch.characterEcology || Object.keys(asRecord(patch.characterEcology)).length === 0) {
        throwUserFacingError('worldRules.ecologyMissing')
      }
      return
    case 'map':
      if (!patch.mapBlueprint || Object.keys(asRecord(patch.mapBlueprint)).length === 0) {
        throwUserFacingError('worldRules.mapBlueprintMissing')
      }
      return
    case 'timeline':
      if (!patch.timelineConfig || Object.keys(asRecord(patch.timelineConfig)).length === 0) {
        throwUserFacingError('worldRules.timelineRuleMissing')
      }
      return
    case 'language':
      if (!patch.writingConstraints || Object.keys(asRecord(patch.writingConstraints)).length === 0) {
        throwUserFacingError('worldRules.styleConstraintMissing')
      }
      return
    default:
      return
  }
}

function sanitizeErrorMessage(error: unknown, fallback = '生成失败'): string {
  const raw = error instanceof Error ? error.message : fallback
  return cleanAiFieldText(raw).replace(/^\[[^\]]+\]\s*/g, '').trim() || fallback
}

function sendProgress(sender: WebContents | undefined, payload: WorldRulesGenerationProgressEvent) {
  if (!sender || sender.isDestroyed()) return
  sender.send('ai:world-rules-progress', payload)
}

export interface WorldRulesGenerationContext {
  novelId: number
  modelConfigId?: number
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
}

export interface GenerateWorldRulesSectionOptions {
  context: WorldRulesGenerationContext
  sectionKey: WorldRuleSectionKey
  action: WorldRulesGenerationRequest['action']
  workingRules: GenreWorldRules
  requirements?: string
  sender?: WebContents
  parentTaskId?: number
  completedBefore?: number
  totalSections?: number
}

export interface GenerateWorldRulesSectionResult {
  nextRules: GenreWorldRules
  step: WorldRulesGenerationStepResult
  warning?: string
}

async function runPromptTask(params: {
  novelId: number
  modelConfigId?: number
  prompt: string
  sender?: WebContents
  parentTaskId?: number
}): Promise<string> {
  const messages = [{ role: 'user' as const, content: params.prompt }]

  if (typeof params.parentTaskId !== 'number') {
    return runChatTask({
      type: 'world_rules_generate',
      novelId: params.novelId,
      modelConfigId: params.modelConfigId,
      relatedEntityType: 'novel',
      relatedEntityId: params.novelId,
      inputJson: JSON.stringify(messages),
      messages,
      sender: params.sender,
    })
  }

  const childTaskId = await createTask({
    type: 'world_rules_generate',
    novelId: params.novelId,
    modelConfigId: params.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: params.novelId,
    inputJson: JSON.stringify(messages),
    runnerType: 'chat',
    parentTaskId: params.parentTaskId,
  })

  updateTask(params.parentTaskId, { currentChildTaskId: childTaskId })

  try {
    return await executeChatTask(childTaskId, {
      type: 'world_rules_generate',
      novelId: params.novelId,
      modelConfigId: params.modelConfigId,
      relatedEntityType: 'novel',
      relatedEntityId: params.novelId,
      inputJson: JSON.stringify(messages),
      messages,
      sender: params.sender,
    })
  } finally {
    updateTask(params.parentTaskId, { currentChildTaskId: null })
  }
}

function buildWorldRulesReviewContext(
  sectionKey: WorldRuleSectionKey,
  profile: Awaited<ReturnType<typeof buildStoryProfile>>,
  rules: GenreWorldRules,
  requirements?: string,
): string {
  const sectionLabel = SECTION_LABELS.get(sectionKey) || sectionKey
  const currentSummary = summarizeCurrentSection(sectionKey, rules)
  const otherSummary = summarizeOtherSections(sectionKey, rules)

  return renderPrompt([
    `目标分区：${sectionLabel}`,
    section('故事核心', buildStoryCoreSummary(profile)),
    section('当前分区草稿', currentSummary || '当前分区暂无可用草稿'),
    otherSummary ? section('其他分区参考', otherSummary) : '',
    requirements ? section('额外要求', requirements) : '',
    section('结构约束', [
      '只允许修当前分区，不要顺手改动其他 section 的语义。',
      '如果要重写，也必须保持当前分区的 JSON 结构稳定。',
    ].join('\n')),
  ])
}

export async function loadWorldRulesGenerationContext(novelId: number): Promise<WorldRulesGenerationContext> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  return {
    novelId,
    modelConfigId: novel.modelConfigId || undefined,
    profile,
  }
}

export async function generateWorldRulesSection(
  options: GenerateWorldRulesSectionOptions,
): Promise<GenerateWorldRulesSectionResult> {
  const {
    context,
    sectionKey,
    action,
    workingRules,
    requirements,
    sender,
    parentTaskId,
  } = options
  const label = SECTION_LABELS.get(sectionKey) || sectionKey
  const completedBefore = Math.max(0, options.completedBefore || 0)
  const totalSections = Math.max(options.totalSections || 1, 1)

  sendProgress(sender, {
    novelId: context.novelId,
    section: sectionKey,
    label,
    status: 'running',
    completed: completedBefore,
    total: totalSections,
    detail: action === 'expand'
      ? '正在结合现有草稿继续扩写当前分区...'
      : '正在根据上下文逐步生成当前分区...',
  })

  try {
    const prompt = buildSectionPrompt(sectionKey, action, context.profile, workingRules, requirements)
    const output = await runPromptTask({
      novelId: context.novelId,
      modelConfigId: context.modelConfigId,
      prompt,
      sender,
      parentTaskId,
    })
    const quality = await runAssetQualityLoop({
      targetType: 'world_rules',
      novelId: context.novelId,
      modelConfigId: context.modelConfigId,
      relatedEntityType: 'novel',
      relatedEntityId: context.novelId,
      parentTaskId,
      sender,
      contextSummary: buildWorldRulesReviewContext(sectionKey, context.profile, workingRules, requirements),
      generatedOutput: output,
      schemaHint: buildOutputSchema(sectionKey),
      reviewFocus: [
        `只审校并修正「${label}」这个分区，不要把其他分区内容塞进来。`,
        '新增规则必须写清用途、限制或影响，不能只留漂亮名词。',
      ],
      rewriteConstraints: [
        '保持当前 section key 和数据结构稳定。',
        '不要输出全文规则草稿，只输出当前分区对应的 JSON patch。',
      ],
    })
    if (quality.stage === 'rejected') {
      throw new Error(summarizeAssetQualityWarnings(quality) || quality.review.summary)
    }

    const patch = parseSectionPatch(sectionKey, quality.finalOutput)
    ensurePatchHasContent(sectionKey, patch)

    const nextRules = applySectionPatch(
      workingRules,
      sectionKey,
      patch,
      workingRules.genreProfile.name || context.profile.genre,
    )
    const changed = JSON.stringify(nextRules) !== JSON.stringify(workingRules)
    const qualityWarning = summarizeAssetQualityWarnings(quality)
    const warning = [changed ? undefined : '生成结果没有带来新的有效改动', qualityWarning]
      .filter((item): item is string => Boolean(item))
      .join('；') || undefined
    const step: WorldRulesGenerationStepResult = {
      key: sectionKey,
      label,
      status: warning ? 'warning' : 'success',
      warning,
    }

    sendProgress(sender, {
      novelId: context.novelId,
      section: sectionKey,
      label,
      status: 'success',
      completed: completedBefore + 1,
      total: totalSections,
      warning,
      detail: warning || `${label} 已更新到当前草稿`,
    })

    return {
      nextRules,
      step,
      warning,
    }
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error)
    sendProgress(sender, {
      novelId: context.novelId,
      section: sectionKey,
      label,
      status: 'failed',
      completed: completedBefore,
      total: totalSections,
      warning: errorMessage,
      detail: `${label} 生成失败`,
    })
    throw new Error(errorMessage)
  }
}

export async function generateWorldRules(
  data: WorldRulesGenerationRequest,
  sender?: WebContents,
): Promise<WorldRulesGenerationResult> {
  if (data.mode === 'section' && !data.section) {
    throwUserFacingError('worldRules.targetSectionMissing')
  }

  const context = await loadWorldRulesGenerationContext(data.novelId)
  const requestedSections = data.mode === 'section'
    ? [data.section as WorldRuleSectionKey]
    : [...WORLD_RULE_SECTION_ORDER]

  let workingRules = normalizeWorldRulesDraft(data.currentRules, context.profile.genre)
  const steps: WorldRulesGenerationStepResult[] = []
  const warnings: string[] = []
  let completedSteps = 0

  for (const sectionKey of requestedSections) {
    try {
      const result = await generateWorldRulesSection({
        context,
        sectionKey,
        action: data.action,
        workingRules,
        requirements: data.requirements,
        sender,
        completedBefore: completedSteps,
        totalSections: requestedSections.length,
      })

      workingRules = result.nextRules
      steps.push(result.step)
      if (result.warning) warnings.push(`${result.step.label}：${result.warning}`)
      completedSteps += 1
    } catch (error) {
      const label = SECTION_LABELS.get(sectionKey) || sectionKey
      const errorMessage = sanitizeErrorMessage(error)
      warnings.push(`${label}：${errorMessage}`)
      steps.push({
        key: sectionKey,
        label,
        status: 'failed',
        error: errorMessage,
      })

      if (data.mode === 'section') {
        break
      }
    }
  }

  const failedSteps = steps.filter((step) => step.status === 'failed').length
  return {
    rules: normalizeWorldRulesDraft(workingRules, workingRules.genreProfile.name || context.profile.genre),
    requestedSections,
    steps,
    warnings,
    completedSteps,
    failedSteps,
    hasPartialResult: completedSteps > 0,
  }
}

