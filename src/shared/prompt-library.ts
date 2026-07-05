import { buildRealityConstraintSummary, getBuiltinGenreRules } from './genre-system'

export interface PromptParamMeta {
  key: string
  label: string
}

export interface PromptCatalogEntry {
  key: string
  name: string
  description: string
  category: string
  params: PromptParamMeta[]
  template: string
}

export interface ProtagonistPromptInput {
  novelTitle: string
  novelSynopsis: string
  genre: string
  worldSummary: string
  storyCore: string
  gender: string
  surnameHint?: string
  speciesSummary?: string
  factionSummary?: string
  ecologySummary?: string
  mapSummary?: string
  writingConstraints?: string
  attemptNumber?: number
}

export interface BatchCharacterPromptInput {
  novelTitle: string
  novelSynopsis: string
  protagonistSummary: string
  existingNames: string
  genre: string
  worldSummary: string
  storyCore: string
  count: number
  genderRatio: string
  specialRequirements: string
  speciesSummary?: string
  factionSummary?: string
  ecologySummary?: string
  mapSummary?: string
  writingConstraints?: string
  attemptNumber?: number
}

export interface RegenerateCharacterPromptInput {
  novelTitle: string
  novelSynopsis: string
  genre: string
  worldSummary: string
  storyCore: string
  protagonistRule: string
  lockedName: string
  lockedRoleType: string
  currentProfile: string
  relatedCharacters: string
  relationSummary: string
  speciesSummary?: string
  factionSummary?: string
  ecologySummary?: string
  writingConstraints?: string
}

export interface CharacterRelationsPromptInput {
  novelSynopsis: string
  characterList: string
  genre?: string
  worldSummary?: string
}

export interface MapGenerationPromptInput {
  novelTitle: string
  worldSummary: string
  genre: string
  mapStructure: string
  namedPlaces: string
  factionSummary?: string
  mapSummary?: string
  writingConstraints?: string
  attemptNumber?: number
}

export interface StoryArcPromptInput {
  novelTitle: string
  genre: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  totalChapters: number
  rhythmSummary: string
  background: string
  protagonistReference: string
  protagonistRule: string
  targetWords?: number
  attemptNumber?: number
}

export interface ChapterOutlinePromptInput {
  novelTitle: string
  genre: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  arcName: string
  arcGoal: string
  arcSummary: string
  arcGrowthLedger?: string
  arcCostLedger?: string
  arcTargetWords?: number
  chapterStart: number
  chapterEnd: number
  previousSummary: string
  characterStates: string
  continuitySummary: string
  openLoops: string
  worldRulesSummary: string
  previousChapterOutlines?: string
  protagonistReference: string
  protagonistRule: string
  attemptNumber?: number
}

export interface TimelineEventPromptInput {
  novelTitle: string
  genre: string
  background: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  worldRulesSummary: string
  timelineRules: string
  arcSummary: string
  characterSummary: string
  locationSummary: string
  itemSummary: string
  existingEvents: string
  count: number
  protagonistReference: string
  protagonistRule: string
}

export type PromptTier = 'simple' | 'standard' | 'key'

export interface ChapterWritingPromptInput {
  novelTitle: string
  genre?: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  hardConstraintContext?: string
  dialogueVoiceLocks?: string
  plotPoints: string
  emotionTone: string
  targetWords: number
  storyCore: string
  writingContractSummary?: string
  relationSummary?: string
  currentArc: string
  worldRules: string
  characterStates: string
  worldStates?: string
  mapSummary?: string
  itemSummary?: string
  previousSummaries: string
  previousChapterContext: string
  lastChapterEnding: string
  styleTemplate: string
  continuitySummary: string
  openLoops: string
  dueForeshadows?: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  activeThreads?: string
  recalledMemory?: string
  chapterBridgePlan?: string
  stepMemorySummary?: string
  runtimeAssertions?: string[]
  povGuidance?: string
  povRotationGuidance?: string
  sensoryGuidance?: string
  narrativeRatioGuidance?: string
  storyPacingGuidance?: string
  hookContinuityGuidance?: string
  expressionDedupGuidance?: string
  summaryHealthGuidance?: string
  voiceEvolutionGuidance?: string
  protagonistReference: string
  protagonistRule: string
  promptTier?: PromptTier
  attemptNumber?: number
  rejectedDigests?: string[]
}

export interface ScenePlanPromptInput {
  novelTitle: string
  genre?: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  hardConstraintContext?: string
  dialogueVoiceLocks?: string
  plotPoints: string
  emotionTone: string
  targetWords: number
  storyCore: string
  writingContractSummary?: string
  relationSummary?: string
  currentArc: string
  worldRules: string
  characterStates: string
  worldStates?: string
  mapSummary?: string
  itemSummary: string
  previousSummaries: string
  previousChapterContext: string
  lastChapterEnding: string
  continuitySummary: string
  openLoops: string
  dueForeshadows?: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  longTermMemory: string
  consistencyNotes: string
  activeThreads?: string
  recalledMemory?: string
  chapterBridgePlan?: string
  stepMemorySummary?: string
  runtimeAssertions?: string[]
  povGuidance?: string
  povRotationGuidance?: string
  sensoryGuidance?: string
  narrativeRatioGuidance?: string
  storyPacingGuidance?: string
  hookContinuityGuidance?: string
  expressionDedupGuidance?: string
  summaryHealthGuidance?: string
  voiceEvolutionGuidance?: string
  protagonistReference: string
  protagonistRule: string
  promptTier?: PromptTier
  attemptNumber?: number
  rejectedDigests?: string[]
}

export interface ChapterReviewPromptInput {
  novelTitle: string
  genre?: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  hardConstraintContext?: string
  dialogueVoiceLocks?: string
  storyCore: string
  writingContractSummary?: string
  relationSummary?: string
  currentArc: string
  worldRules: string
  characterStates: string
  worldStates?: string
  mapSummary?: string
  itemSummary: string
  previousChapterContext: string
  continuitySummary: string
  openLoops: string
  dueForeshadows?: string
  timelineSummary: string
  longTermMemory: string
  consistencyNotes: string
  recalledMemory?: string
  chapterBridgePlan?: string
  stepMemorySummary?: string
  runtimeAssertions?: string[]
  arcProgress?: string
  arcProgressStatus?: string
  arcProgressCheckpoint?: string
  povGuidance?: string
  povRotationGuidance?: string
  sensoryGuidance?: string
  narrativeRatioGuidance?: string
  storyPacingGuidance?: string
  hookContinuityGuidance?: string
  expressionDedupGuidance?: string
  summaryHealthGuidance?: string
  voiceEvolutionGuidance?: string
  scenePlan: string
  draftContent: string
  scenePlanSummary?: string
  draftTextSummary?: string
  contractVersionSummary?: string
  reviewRiskSummary?: string
  reviewProofSummary?: string
  publishGateRiskSummary?: string
  structuralAlertsSummary?: string
  protagonistReference: string
  protagonistRule: string
  promptTier?: PromptTier
  attemptNumber?: number
  rejectedDigests?: string[]
}

export interface ChapterRewritePromptInput {
  novelTitle: string
  genre?: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  hardConstraintContext?: string
  dialogueVoiceLocks?: string
  emotionTone: string
  targetWords: number
  storyCore: string
  writingContractSummary?: string
  relationSummary?: string
  currentArc: string
  worldRules: string
  characterStates: string
  worldStates?: string
  mapSummary?: string
  itemSummary: string
  previousSummaries: string
  previousChapterContext: string
  lastChapterEnding: string
  continuitySummary: string
  openLoops: string
  dueForeshadows?: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  longTermMemory: string
  consistencyNotes: string
  scenePlan: string
  draftContent: string
  reviewNotes: string
  scenePlanSummary?: string
  draftTextSummary?: string
  contractVersionSummary?: string
  reviewRiskSummary?: string
  reviewProofSummary?: string
  rewriteDeltaSummary?: string
  publishGateRiskSummary?: string
  structuralAlertsSummary?: string
  lockedParagraphs?: string[]
  activeThreads?: string
  recalledMemory?: string
  chapterBridgePlan?: string
  stepMemorySummary?: string
  runtimeAssertions?: string[]
  povGuidance?: string
  povRotationGuidance?: string
  sensoryGuidance?: string
  narrativeRatioGuidance?: string
  storyPacingGuidance?: string
  hookContinuityGuidance?: string
  expressionDedupGuidance?: string
  summaryHealthGuidance?: string
  voiceEvolutionGuidance?: string
  protagonistReference: string
  protagonistRule: string
  promptTier?: PromptTier
  attemptNumber?: number
  rejectedDigests?: string[]
}

export interface ContinuityPromptInput {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  arcName: string
  chapterGoal: string
  summary: string
  chapterContent: string
  inboundOpenLoops?: string
  inboundDueForeshadows?: string
  inboundContinuityNotes?: string
  chapterBridgePlan?: string
}

export interface RewriteParagraphPromptInput {
  originalParagraph: string
  contextBefore: string
  specificRequirements: string
  genreContext?: string
  worldSummary?: string
}

export interface GenericExpandPromptInput {
  contentType: string
  existingContent: string
  novelContext: string
  genreContext: string
  requirements?: string
}

export interface SubplotExpandPromptInput {
  novelTitle: string
  genreContext: string
  mainPlot: string
  subplot: {
    name: string
    characters: string
    conflict: string
    mainlineLink: string
    endChapter: string
  }
  requirements?: string
}

export interface ContentScoringPromptInput {
  contentType: string
  content: string
  genreContext: string
  novelBackground: string
}

export type StoryAnchorField = 'story_goal' | 'core_conflict' | 'main_plot' | 'ending'

export interface StoryAnchorPromptInput {
  field: StoryAnchorField
  label: string
  novelBackground: string
  genre: string
  currentContent?: string
  relatedContext?: string
  protagonistReference?: string
  protagonistRule?: string
  requirements?: string
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

function isGoldenThreeChapter(chapterNum: number): boolean {
  return chapterNum >= 1 && chapterNum <= 3
}

function buildGoldenThreeChapterGuidance(chapterNum: number, stage: 'scenePlan' | 'writing' | 'draft' | 'review' | 'rewrite'): string {
  if (!isGoldenThreeChapter(chapterNum)) return ''

  const phaseRules: Record<number, string> = {
    1: '第 1 章职责：前 300 字内必须出现具体现场、主角动作、可感压力和一个读者能立刻追问的问题；禁止从世界观百科、天气长描写、抽象命运感或人物履历开场。',
    2: '第 2 章职责：直接承接第 1 章造成的后果或疑问，放大阻力、关系张力或资源代价；禁止像新故事一样重启铺垫。',
    3: '第 3 章职责：给出第一个清晰兑现、反转或承诺升级，让主角被迫做出更难退回的选择；禁止只继续解释设定。',
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

function buildGoldenThreeOutlineGuidance(chapterStart: number, chapterEnd: number): string {
  if (chapterEnd < 1 || chapterStart > 3) return ''
  return section('黄金三章开篇约束', [
    '第 1 章：前 300 字内给出具体现场、主角动作、可感压力和一个明确追问点；章尾必须把问题递给第 2 章。',
    '第 2 章：承接第 1 章的后果或疑问，放大阻力、关系张力或资源代价；章尾要把选择压力递给第 3 章。',
    '第 3 章：给出第一个清晰兑现、反转或承诺升级，让主角进入更难退回的局面。',
    '前三章 bridge_in / bridge_out 必须形成因果链：上章结果 -> 本章行动 -> 新代价或新问题。',
    '前三章标题必须具体、有场景感或冲突感，避免“开端”“觉醒”“风暴前夜”“命运齿轮”这类万能标题。',
  ].join('\n'))
}

type StepMemoryStage = 'scenePlan' | 'writing' | 'draft' | 'review' | 'rewrite'

function buildStepMemoryContinuityGuidance(stage: StepMemoryStage): string {
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

function buildRuntimeAssertionSection(assertions?: string[]): string {
  const lines = Array.isArray(assertions)
    ? assertions.map((item) => item.trim()).filter(Boolean)
    : []
  if (lines.length === 0) return ''
  return section('运行时接力断言', [
    '以下断言来自本轮流水线上游步骤，必须优先执行；若与正文事实冲突，按已写正文、章节合同和硬约束校正。',
    ...lines.map((line) => `- ${line.replace(/^[-*]\s*/u, '')}`),
  ].join('\n'))
}

function buildTitleAndStructureGuidance(scope: 'volume' | 'chapterOutline' | 'scenePlan'): string {
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

function placeholder(key: string): string {
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

export type VariationEntityType = 'character' | 'chapter' | 'outline' | 'map' | 'generic'

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

function getStoryAnchorGuidance(field: StoryAnchorField, label: string) {
  switch (field) {
    case 'story_goal':
      return {
        label,
        duty: '只写故事最后要抵达的目标、终局状态或核心命题。',
        requirements: [
          '回答“这本书最后要实现什么”，不要改写成过程描述。',
          '可以带出主题方向，但落点必须是明确结果，而不是抽象口号。',
        ],
        avoid: [
          '不要把中段剧情、阶段任务或具体场景塞进来。',
          '不要把阻碍、敌人或困难本身写成最终目标。',
          '不要复述主线推进或核心冲突。',
        ],
      }
    case 'core_conflict':
      return {
        label,
        duty: '只写阻碍目标实现的核心对立、不可回避的代价与持续张力。',
        requirements: [
          '回答“为什么这件事难以实现”，而不是“最后想实现什么”。',
          '写清对立双方、冲突来源或必须支付的代价。',
        ],
        avoid: [
          '不要写成结局目标、主题口号或人物愿望。',
          '不要用流水账代替冲突本身。',
          '不要换一种说法重复主线概述。',
        ],
      }
    case 'main_plot':
      return {
        label,
        duty: '只写围绕目标与冲突展开的关键事件链，强调因果推进、升级和转折。',
        requirements: [
          '回答“故事如何一步步推进到结局”，至少体现起点、升级、转折与逼近收束。',
          '主线必须显式承接故事目标和核心冲突，不能另起一条故事。',
        ],
        avoid: [
          '不要重新定义故事目标或核心冲突。',
          '不要只写抽象主题感受、人物评价或世界观说明。',
          '不要只列场景，不写事件之间的因果关系。',
        ],
      }
    case 'ending':
      return {
        label,
        duty: '只写故事最终如何收束、主要矛盾如何落地以及结局余波。',
        requirements: [
          '结局要回应既定目标、冲突和主线推进结果。',
          '说明最终状态，不要在结局字段里再铺一条新主线。',
        ],
        avoid: [
          '不要把尚未发生的中段情节写进结局字段。',
          '不要只写价值判断，不写结果落点。',
        ],
      }
  }
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
  '不要用"某种"开头的模糊指代来假装深度，要么写清到底是什么，要么不提。',
  '段落结尾不要用一句感悟、总结或升华来收尾，让事件和动作自己说话。',
  '不要反复出现"似乎明白了什么""仿佛在诉说着什么""不知为何"这类伪留白。',
] as const

export function buildHumanLanguageRules(extraLines: string[] = []): string {
  return [...HUMAN_LANGUAGE_RULE_LINES, ...extraLines]
    .map((line) => `- ${line}`)
    .join('\n')
}

interface PromptGuardrailOptions {
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

function buildPromptGuardrailSections(options: PromptGuardrailOptions): string[] {
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

export function buildStoryAnchorPrompt(params: StoryAnchorPromptInput): string {
  const guidance = getStoryAnchorGuidance(params.field, params.label)
  const protagonistReference = params.protagonistReference?.trim() || '主角'
  const protagonistRule = params.protagonistRule?.trim() || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。'

  return renderPrompt([
    `你在补《${params.label}》这一项，请只完成这一项。`,
    section('本项职责', guidance.duty),
    sectionLines('输入信息', [
      `题材：${params.genre}`,
      `小说背景：${params.novelBackground || '（暂无补充背景）'}`,
      `主角称呼：${protagonistReference}`,
      `主角命名规则：${protagonistRule}`,
    ]),
    section('已确定的关联设定', params.relatedContext || '暂无'),
    section('当前字段内容', params.currentContent || '暂无，请根据背景与已确定设定补全'),
    section('额外要求', params.requirements || ''),
    section('本次处理原则', [
      ...guidance.requirements,
      '只允许在当前背景、题材和已确定设定上深化，禁止改写成另一套故事。',
      '先补人物动机、因果关系和结果落点，再考虑气质和文气。',
      `本轮只处理《${params.label}》，不要越界代写其他字段。`,
      '如果上下文出现旧名字、占位名或彼此冲突的人名，统一按主角命名规则处理。',
      '与其他字段中的人物关系、事件因果和核心矛盾保持前后一致，不得漂移。',
      '如果原内容可用，保留它的核心方向，只补缺口和逻辑。',
      '禁止事项：',
      ...guidance.avoid.map((item) => `- ${item}`),
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '输出前自行检查搭配是否准确，不要保留物体被写成人或生物的表达。',
      '贴近当前题材常见的策划口径，但不要模仿具体作者。',
    ])),
    '输出要求：',
    '- 直接输出可落进表单的纯文本',
    '- 不要使用 Markdown、标题、列表或字段标签',
  ])
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

阻塞坏习惯（检测到会被强制修改）：
- “突然””不由得””这一刻””顷刻之间”这类万能起手——改为直接写动作
- 深吸一口气、攥紧拳头、瞪大眼睛、僵在原地——换成这个角色独有的应激反应
- “命运的齿轮””冥冥之中””也许这就是”——删掉，用事件本身说话
- 给普通概念乱加引号——去掉引号，只有专有名词保留
- 用破折号偷懒解释或做假揭示——改成正常叙述
- “嘴角微微上扬””目光深邃””心中涌起一股暖流””不由自主地”——换成具体的面部肌肉运动、手部动作或呼吸变化
- “系统死亡””城市哭泣””门感到愤怒”——物体用”瘫痪””破败””卡住”等准确动词
- 把重伤、物资短缺、秩序崩塌写成零代价解决——必须有伤、有债、有后遗症
- “某种说不清的””无法言喻的”——要么写清楚是什么，要么不提
- 每段结尾都用一句感悟或总结收尾——让事件自己说话，砍掉读后感
- “一方面…另一方面…””既是…也是…更是…”——真实人物的矛盾偏向一端
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
- “事情远没有那么简单””这只是开始”——用下一个事件证明复杂性，不要空喊
- “他的内心无比[形容词]””她的心情十分[形容词]”——心理描写要通过感官细节和内心独白，不要贴标签
- “一切都在朝着好的/坏的方向发展”——写具体发生了什么事，让读者自己判断方向

对比示例（坏→好）：
- 坏：”心中涌起一股复杂的情绪” → 好：”他把烟掐灭了，手指尖被烫得发白”
- 坏：”命运的齿轮开始转动” → 好：”审批单被驳回的第三天，他等来了另一封信”
- 坏：”阳光洒在脸上，带着一丝暖意” → 好：”防水布拉开一条缝，刺目的光让他眯了眼”
- 坏：”她不由自主地握紧了拳头” → 好：”她把钥匙攥在掌心，金属齿硌进肉里”

输出：
- 只输出最终正文
- 只用纯文本分段`.trim()

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary: string
}): string {
  const genreKey = getBuiltinGenreRules(params.genre).genreProfile.key
  const isModernMystery = genreKey === 'modern-mystery'

  const taskLines = [
    '1. 写一段 300 到 500 字的扩展背景，只补当前可写的世界处境、日常规则、危险来源和人物起步位置。',
    '2. 给 3 个标题，分别偏人物、偏悬念、偏题材气质，名字要像正经小说，不要像宣传语。',
    '3. 写一段 150 到 220 字的简介，直接点明这本书开局最抓人的矛盾和阅读钩子。',
    ...(isModernMystery ? ['4. 如果题材是现代悬疑，背景里必须交代异常事件入口、调查第一道阻力和现实场域纹理。'] : []),
  ]

  const writingLines = [
    '先沿用用户已有设想，再补缺口，不要另起一套世界观。',
    '背景只负责把开局写扎实，不提前剧透关键反转和结局。',
    '优先写具体处境、规则、限制、代价和冲突来源，少写宏大口号。',
    '标题和简介都要贴题材，避免万能热词和平台套路文案。',
    ...(isModernMystery ? [
      '现代悬疑要优先使用旧案、档案、监控、通联、医院记录、报社旧闻和厂区空间这类现实线索载体。',
      '不要只写“有秘密”或“气氛压抑”，要写出谁在封口、谁在拦人、谁的权限或利害让事情难以继续。',
      '标题尽量从证据载体、地点纹理、时间锚点和职业现场取词，不要堆“迷雾”、“深渊”、“命运”等万能词。',
      '如果用户已明确给了人名地名，延用并保持现实质感；如果没给，就继续使用泛称。',
    ] : []),
  ]

  const languageLines = [
    '背景、标题和简介都要像编辑会留下来的成稿，不要写成概念清单或广告文案。',
    '如果一句话可以更短、更直白，就不要故意写得玄。',
    ...(isModernMystery ? ['现代悬疑的句子要克制、准确、像真实世界里的记录和叙述，而不是刻意拿腔调气氛。'] : []),
  ]

  return renderPrompt([
    '你在补一份小说立项用的背景设定。只把开局底盘垫稳：世界处境、时代气味、人物起点和首轮冲突，不要把中后期剧情一次写完。',
    sectionLines('现有信息', [
      '用户背景：' + params.userBackground,
      '题材：' + params.genre,
      params.worldTemplateSummary ? '世界观参考：' + params.worldTemplateSummary : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.userBackground,
      worldSummary: params.worldTemplateSummary,
      taskFocus: '1. 写一段 300 到 500 字的扩展背景，只补当前可写的世界处境、日常规则、危险来源和人物起步位置。',
      extraQualityLines: [
        '标题和简介都要贴题材，避免万能热词和平台套路文案。',
        ...(isModernMystery ? ['如果是现代悬疑，标题和简介都要优先从证据、地点、时间或机构阻力取词。'] : []),
      ],
    }),
    section('任务', taskLines.join('\n')),
    section('写法要求', writingLines.join('\n')),
    section('语言要求', buildHumanLanguageRules(languageLines)),
    '只输出 JSON：{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}',
  ])
}
export function protagonistPrompt(params: ProtagonistPromptInput): string {
  return renderPrompt([
    '为这部小说确定主角档案。这个角色后面会直接进入故事弧、章节细纲和正文，所以信息必须能拿来写戏，不能只停在概念层。',
    sectionLines('小说信息', [
      '书名：' + params.novelTitle,
      '背景：' + params.novelSynopsis,
      '题材：' + params.genre,
      params.worldSummary ? '世界规则：' + params.worldSummary : '',
      params.storyCore ? '故事核心：' + params.storyCore : '',
      params.speciesSummary ? '种族生态：' + params.speciesSummary : '',
      params.factionSummary ? '势力结构：' + params.factionSummary : '',
      params.ecologySummary ? '角色生态：' + params.ecologySummary : '',
      params.mapSummary ? '地图蓝图：' + params.mapSummary : '',
      params.writingConstraints ? '语言约束：' + params.writingConstraints : '',
      '性别：' + params.gender,
      params.surnameHint ? '姓名方向：' + params.surnameHint : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      storyCore: params.storyCore,
      worldSummary: params.worldSummary,
      taskFocus: '这个人要能解释为什么能卷进主线、为什么会撑到后续关键选择。',
      extraQualityLines: ['优点、缺点、秘密、软肋和关系张力都要能互相咬合，别把角色写成完美设定包。'],
    }),
    section('命名要求', [
      '姓名要贴题材、时代和社会环境，优先顺口、可记、可读。',
      params.surnameHint ? '如果给了姓名方向，优先沿用，不要故意逆着来。' : '',
      '避免堆生僻字、堆设定词，名字一眼要能读出来。',
    ].filter(Boolean).join('\n')),
    section('人物要求', [
      '先写清主角眼下想要什么、缺什么、怕什么，再决定他会怎么做。',
      '允许主角在早期和中期出现恐惧、犹豫、误判、嫉妒、失望或心软，别做成天降满配人设。',
      '成长至少落到能力、关系、认知、责任、资源或道德选择中的两项，不要只写成变强。',
      '背景经历必须落实到现在的判断、习惯、伤口、关系或行动方式里。',
      '这个人要能解释为什么能卷进主线、为什么会撑到后续关键选择。',
      '外貌只写辨识度和气质来源，不写空泛形容词堆砌。',
      '优点、缺点、秘密、软肋和关系张力都要能互相咬合，别把角色写成完美设定包。',
      '实体类型、种族、身份、势力归属和力量体系必须贴合现有规则，不默认只有普通人模板。',
      '心理维度之间必须互相咬合形成因果链：core_fear 必须直接解释 self_deception 为什么成立，trauma 必须影响 inner_conflict 的具体内容，surface_desire 和 deep_need 之间必须存在具体矛盾而非抽象对立。不允许每个字段独立编一套说辞。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '档案要像编辑可直接交给作者继续写戏的人物卡，不要写悬浮鸡汤和伪深刻结论。',
      '贴近当前题材常见角色写法，但不要模仿具体作者。',
    ])),
    '只输出 JSON：{"surname":"","given_name":"","full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/境界/身份阶位","social_identity":"社会身份或阵营位置","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线/背景/主题的关联"],"appearance":"外貌3到4句，只写能认出来的细节","background":"180字以内，写关键经历以及它留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层最想得到的东西","deep_need":"真正缺失却不愿承认的需要","core_fear":"最怕失去或面对的东西","inner_conflict":"最核心的内在拉扯","hidden_secret":"不愿公开的秘密","moral_line":"轻易不会跨过的底线","self_deception":"一直拿来自我说服的谎话","trauma":"仍在影响现在的旧伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"在亲密或权力关系里的张力来源","resonance_point":"读者最容易共情的一点","character_arc":"后续可能的变化方向","first_impression":"第一次出场最抓人的地方"}',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
  ])
}

export function batchCharacterPrompt(params: BatchCharacterPromptInput): string {
  return renderPrompt([
    '为小说《' + params.novelTitle + '》补出 ' + params.count + ' 个配角。每个人都要在后续剧情里承担明确作用，不能只是凑人头。',
    sectionLines('现有信息', [
      '小说背景：' + params.novelSynopsis,
      params.storyCore ? '故事核心：' + params.storyCore : '',
      '主角摘要：' + params.protagonistSummary,
      '已有人物：' + (params.existingNames || '无'),
      '题材：' + params.genre,
      params.worldSummary ? '世界规则：' + params.worldSummary : '',
      params.speciesSummary ? '种族生态：' + params.speciesSummary : '',
      params.factionSummary ? '势力结构：' + params.factionSummary : '',
      params.ecologySummary ? '角色生态：' + params.ecologySummary : '',
      params.mapSummary ? '地图蓝图：' + params.mapSummary : '',
      params.writingConstraints ? '语言约束：' + params.writingConstraints : '',
      '性别比例：' + params.genderRatio,
      params.specialRequirements ? '特殊要求：' + params.specialRequirements : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      storyCore: params.storyCore,
      worldSummary: params.worldSummary,
      taskFocus: '先把人物网补完整：主线推进位、对立位、辅助位、搅局位、情感或利益牵引位。',
      extraQualityLines: ['人物之间要有层次差异：有人强势、有人实用、有人隐忍、有人会制造额外麻烦，不要一批人一个腔调。'],
    }),
    section('生成要求', [
      '先把人物网补完整：主线推进位、对立位、辅助位、搅局位、情感或利益牵引位。',
      '每个人都要写清与主角、主线或某条支线的实际关系，不要只给一个空标签。',
      '人物之间要有层次差异：有人强势、有人实用、有人隐忍、有人会制造额外麻烦，不要一批人一个腔调。',
      '至少让一部分角色携带秘密、旧债、错位立场或利益冲突，这样后面才有戏。',
      '遵守现有世界规则、势力结构、地图和题材生态，不重名，不撞设定。',
      '贴近当前题材常见群像写法，但不要直接模仿具体作者。',
      '每个角色的心理维度必须形成因果链：core_fear 解释 self_deception，trauma 影响 inner_conflict，surface_desire 和 deep_need 之间有具体矛盾。不允许每个字段独立编一套说辞。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '人物描述要像编辑会采纳的角色档案，不要写成悬浮文案。',
      '少用万能热词，多写这个人具体能做什么、会卡住谁、会被什么反噬。',
    ])),
    '只输出 JSON 数组：[{"full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"role_type":"major/minor/antagonist/supporting","occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"background":"80到120字，写关键经历和现状","personality_traits":["特点1","特点2"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"人物反差点","relationship_tension":"与主角或关键人物的张力","resonance_point":"读者共情点","character_arc":"后续变化方向","relation_to_protagonist":"与主角的关系与拉扯","first_impression":"第一次出场的印象","appearance":"外貌1到2句，只写辨识度","appear_chapter":1}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
  ])
}

export function regenerateCharacterPrompt(params: RegenerateCharacterPromptInput): string {
  return renderPrompt([
    '根据最新上下文重写并深化同一个角色的档案。注意，这是返修，不是重新发明一个新人。',
    sectionLines('锁定条件', [
      '小说：' + params.novelTitle,
      '背景：' + params.novelSynopsis,
      '题材：' + params.genre,
      params.worldSummary ? '世界规则：' + params.worldSummary : '',
      params.storyCore ? '故事核心：' + params.storyCore : '',
      params.speciesSummary ? '种族生态：' + params.speciesSummary : '',
      params.factionSummary ? '势力结构：' + params.factionSummary : '',
      params.ecologySummary ? '角色生态：' + params.ecologySummary : '',
      params.writingConstraints ? '语言约束：' + params.writingConstraints : '',
      '主角命名规则：' + params.protagonistRule,
      '角色姓名必须保留：' + params.lockedName,
      '角色类型必须保留：' + params.lockedRoleType,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      storyCore: params.storyCore,
      worldSummary: params.worldSummary,
      taskFocus: '优先修正旧档案里不贴合主线、不贴合关系网、或和世界规则脱节的部分。',
      extraQualityLines: ['让优点、缺点、秘密、软肋和利益立场彼此咬合，避免空转的复杂。'],
    }),
    section('当前人物旧档案', params.currentProfile),
    section('相关人物', params.relatedCharacters || '暂无'),
    section('现有关系信息', params.relationSummary || '暂无'),
    section('返修要求', [
      '保留同一个人的身份、姓名和角色功能，不得改名换壳。',
      '优先修正旧档案里不贴合主线、不贴合关系网、或和世界规则脱节的部分。',
      '新档案要能解释这个人现在为什么会这么想、这么做、这么处理关系。',
      '如果一个设定很酷但和主线没有关系，宁可收住，也不要继续往上堆。',
      '让优点、缺点、秘密、软肋和利益立场彼此咬合，避免空转的复杂。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '所有字段都要写成清楚、可落地的人物信息，不要写成总结式空话。',
      '减少概念包装，优先写行为依据、关系拉扯和代价。',
    ])),
    '只输出 JSON：{"full_name":"' + params.lockedName + '","role_type":"' + params.lockedRoleType + '","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"appearance":"外貌3到4句，突出辨识度","background":"180字以内，写关键经历和留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"与关键人物关系里的张力","resonance_point":"读者最容易共情的一点","character_arc":"后续变化方向","first_impression":"第一次出场印象","appear_chapter":1}',
  ])
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  return renderPrompt([
    '基于现有小说背景和角色清单，生成能直接作用于章节写作的人物关系网。关系不能只停在“朋友”“家人”这种空标签，必须能写进对白、动作和情绪变化里。',
    sectionLines('现有信息', [
      '故事背景：' + params.novelSynopsis,
      '角色清单：\n' + params.characterList,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      worldSummary: params.worldSummary,
      taskFocus: '人物关系要能解释他们为什么这样说话、这样试探、这样互相靠近或互相伤害。',
      extraQualityLines: ['重点检查不同关系是否真的有不同温度、边界、称呼和冲突方式。'],
    }),
    section('生成要求', [
      '优先补足主角相关、当前剧情高频互动、以及会影响主线推进的关键关系。',
      '每条关系都要给出当前状态，而不是只写一个静态身份标签。',
      '关系必须体现亲密度、张力度、互动方式和潜台词规则，确保后续章节对白不再一个基调。',
      'description 写关系形成原因、当前状态和主要拉扯，不写空泛概括。',
      'interaction_style 写双方平时如何说话、试探、回避、照顾、顶撞或施压。',
      'subtext_rule 写这段关系里不能直说但会持续影响对白的暗线。',
      'intimacy_level 和 tension_level 使用 1 到 5 的整数，1 最弱，5 最强。',
      '如果关系是单向错位，例如一方把对方当盟友、另一方只把他当工具，也要在说明里写出来。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '关系描述要像编剧室会直接拿去写戏的工作备注，不要写成百科定义。',
      '少用“感情深厚”“关系复杂”这类空词，优先写称呼、边界、顾忌、依赖、旧账和压迫感。',
    ])),
    'type 仅可使用：stranger / acquaintance / friend / family / colleague / mentor_student / ally / subordinate / rival / lover / enemy',
    '只输出 JSON 数组：[{"char_a":"","char_b":"","type":"","label":"朋友/师徒/互相利用等中文简称","description":"20到60字，写关系形成与当前状态","bilateral":true,"intimacy_level":3,"tension_level":2,"interaction_style":"平时如何说话和互动","subtext_rule":"这段关系里不能直说的暗线"}]',
  ])
}
export function mapGenerationPrompt(params: MapGenerationPromptInput): string {
  return renderPrompt([
    `为小说《${params.novelTitle}》补一套能支撑剧情的地图结构。`,
    sectionLines('现有信息', [
      `世界观：${params.worldSummary}`,
      `题材：${params.genre}`,
      `地图结构要求：${params.mapStructure}`,
      params.factionSummary ? `势力结构：${params.factionSummary}` : '',
      params.mapSummary ? `蓝图补充：${params.mapSummary}` : '',
      params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
      params.namedPlaces ? `用户指定地点：${params.namedPlaces}` : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.worldSummary,
      worldSummary: params.worldSummary,
      taskFocus: '地点之间要有基本地理逻辑和父子层级逻辑，不要像随机抽卡。',
      extraRealityLines: ['地图层级严格服从题材蓝图，不要把丧尸题材写成宗门结构，也不要把仙侠地图写成现代行政区模板。'],
      extraQualityLines: ['剧情关联要写具体事件或用途，不写“重要地点”这种空话。'],
    }),
    section('生成要求', [
      '命名要贴合题材和文化背景，不要串味。',
      '每个地点既要有氛围，也要有存在价值，最好能看出会承载什么事件。',
      '地点之间要有基本地理逻辑和父子层级逻辑，不要像随机抽卡。',
      '地图层级严格服从题材蓝图，不要把丧尸题材写成宗门结构，也不要把仙侠地图写成现代行政区模板。',
      '第一层数量是根节点总数，必须严格等于要求。',
      '从第二层开始，数量要求表示“每个父节点都要生成多少个直属子节点”，不是整张地图共享一个总数。',
      '如果要求是“2 个国家 / 每国 3 个区域 / 每区域 4 个地点”，就必须输出 2 -> 3 -> 4 的父子扶出结构。',
      '剧情关联要写具体事件或用途，不写“重要地点”这种空话。',
      'children 只能放直属下一层节点，不能跳层。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '地点描述要具体，不要堆砌形容词或写成旅游宣传语。',
      '普通地点性质不要加引号，不要写成“真正禁区”“希望之地”这类概念包装。',
    ])),
    '只输出递归 JSON：{"nodes":[{"name":"","node_type":"国家/宗门/基地/城市/秘境/设施等","structure_role":"该节点在蓝图中的职责","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"children":[{"name":"","node_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"children":[]}]}]}',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'map') : '',
  ])
}

export function buildStoryArcPlanningPrompt(params: StoryArcPromptInput): string {
  return renderPrompt([
    '把这部小说拆成一组连续推进的故事弧。你现在做的是长篇结构规划，不是写宣传提纲。',
    sectionLines('项目背景', [
      '书名：' + params.novelTitle,
      '题材：' + (params.genre || '未知题材'),
      params.background ? '故事背景：' + params.background : '',
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.background,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.ending].filter(Boolean).join('\n'),
      taskFocus: '每个故事弧都要回答：这一段推进了什么、加压了什么、把什么交给下一段。',
      extraQualityLines: ['先保证主线因果顺，再安排支线落位；不要为了平均分配章节硬拆结构。'],
    }),
    sectionLines('核心约束', [
      '故事核心目标：' + (params.storyGoal || '未提供'),
      '核心冲突：' + (params.coreConflict || '未提供'),
      '主线剧情：' + (params.mainPlot || '未提供'),
      '支线剧情：' + (params.subPlots || '暂无'),
      '结局方向：' + (params.ending || '未提供'),
      '节奏比例：' + (params.rhythmSummary || '未配置'),
      '预计总章节：' + params.totalChapters + '章',
      params.targetWords ? '全书目标字数：' + params.targetWords + '字，请在每个弧的 target_words 字段中分配字数预算，总和必须等于全书目标。' : '',
    ]),
    section('规划要求', [
      '规划 3 到 5 个故事弧，章节范围必须连续、无重叠、无空档。',
      '每个故事弧都要回答：这一段推进了什么、加压了什么、把什么交给下一段。',
      '每个故事弧都要让主角在能力、关系、认知、责任、资源或道德选择上至少有一项发生可追踪变化。',
      'growth_ledger 要写 2 到 4 条本弧累计形成的成长账本，明确主角到底学会了什么、失去了什么盲点、换来了什么位置变化。',
      'cost_ledger 要写 2 到 4 条本弧累计付出的代价账本，优先记录伤病、资源、人情、名声、机会、秩序或道德代价。',
      'key_turns 只写会改变量势的具体事件或决定，不写“矛盾升级”“命运转折”这种空话。',
      'subplot_links 要明确哪条支线在这里进入、发酵、反咬或回收。',
      '先保证主线因果顺，再安排支线落位；不要为了平均分配章节硬拆结构。',
      '最后一个故事弧必须负责主线收束，并给主要支线留出回扣空间。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      'summary、arc_goal、growth_ledger、cost_ledger 和 key_turns 都写成普通编辑能直接接手的结构说明，不要写策划黑话。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前故事的具体内容：',
    '[{"arc_name":"","stage":"铺垫/升级/高潮/收束","chapter_start":1,"chapter_end":10,"arc_goal":"","target_words":50000,"growth_ledger":[],"cost_ledger":[],"key_turns":[],"subplot_links":[],"pacing":"快/中/慢","summary":""}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
  ])
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  return renderPrompt([
    '为当前故事弧拆分章节大纲。每一章都要能回答三个问题：这一章完成什么、承接什么、把什么递给下一章。',
    sectionLines('项目信息', [
      '书名：' + params.novelTitle,
      '题材：' + (params.genre || '未知题材'),
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
    ]),
    sectionLines('主线约束', [
      '故事核心目标：' + (params.storyGoal || '未提供'),
      '核心冲突：' + (params.coreConflict || '未提供'),
      '主线剧情：' + (params.mainPlot || '未提供'),
    ]),
    sectionLines('当前故事弧', [
      '名称：' + params.arcName,
      '目标：' + (params.arcGoal || '未提供'),
      '概述：' + (params.arcSummary || '未提供'),
      params.arcGrowthLedger ? '成长账本：' + params.arcGrowthLedger : '',
      params.arcCostLedger ? '代价账本：' + params.arcCostLedger : '',
      params.arcTargetWords ? '本弧字数预算：' + params.arcTargetWords + '字，章节数量和单章篇幅要匹配这个预算。' : '',
      '章节范围：第' + params.chapterStart + '章到第' + params.chapterEnd + '章',
    ]),
    sectionLines('连续性上下文', [
      params.previousSummary ? '前情摘要：\n' + params.previousSummary : '',
      params.continuitySummary ? '连续性记忆：\n' + params.continuitySummary : '',
      params.openLoops ? '未回收事项：\n' + params.openLoops : '',
      params.characterStates ? '关键人物状态：\n' + params.characterStates : '',
      params.worldRulesSummary ? '世界规则：\n' + params.worldRulesSummary : '',
    ]),
    params.previousChapterOutlines ? section('已有章节大纲（差异化参考）', params.previousChapterOutlines) : '',
    buildGoldenThreeOutlineGuidance(params.chapterStart, params.chapterEnd),
    buildTitleAndStructureGuidance('chapterOutline'),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.arcGoal].filter(Boolean).join('\n'),
      worldSummary: params.worldRulesSummary,
      taskFocus: '每章 目标 必须服务本弧目标，合起来能看出主线持续推进。',
      extraQualityLines: ['章节之间要有轻重起伏，不能每章都像同一个节奏模板。'],
    }),
    section('生成要求', [
      '每章 goal 必须服务本弧目标，合起来能看出主线持续推进。',
      'title 必须准确对应本章核心事件或选择压力，不能为了“高级感”脱离具体内容。',
      'plot_points 按发生顺序写具体事件，不写“制造冲突”“推进剧情”这种空话。',
      'bridge_in 写清这章接住了什么，bridge_out 写清这章把什么递给下一章。',
      'growth_ledger 要写 1 到 3 条本章真正新增或兑现的成长账本，落在能力、关系、认知、责任、资源或道德选择的变化上。',
      'cost_ledger 要写 1 到 3 条本章真正付出的代价账本，落在伤病、资源、人情、时间、名声、机会或秩序压力上。',
      '至少安排部分章节让主角遭遇暂时解决不了的问题或明确代价，不要章章顺利推进。',
      '章节之间要有轻重起伏，不能每章都像同一个节奏模板。',
      '新生成的章节开头方式、情绪基调、登场人物组合不得与已有章节大纲连续重复超过两章。',
      '优先安排真正需要上场的人物和地点，别把所有线索都塞进每一章。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '章节标题、目标、成长账本和代价账本都要写得清楚直接，避免抽象套话。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前故事的具体内容：',
    '[{"chapter_num":' + params.chapterStart + ',"title":"","goal":"","growth_ledger":[],"cost_ledger":[],"plot_points":[],"characters":[],"location":"","emotion_tone":"","bridge_in":"","bridge_out":""}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
  ])
}

export interface VolumePlanningPromptInput {
  novelTitle: string
  novelSynopsis: string
  genre: string
  targetTotalWords: number
  storyGoal: string
  coreConflict: string
  mainPlot: string
  ending: string
  existingArcs: string
  protagonistSummary: string
  worldRulesSummary: string
  threadsSummary: string
  attemptNumber?: number
}

export function buildVolumePlanningPrompt(params: VolumePlanningPromptInput): string {
  const estimatedVolumes = Math.max(1, Math.ceil(params.targetTotalWords / 300000))
  return renderPrompt([
    `为这部${params.targetTotalWords >= 1000000 ? '百万字级' : '长篇'}小说规划卷结构。`,
    `总目标字数约 ${params.targetTotalWords} 字，预估 ${estimatedVolumes} 卷左右（可根据剧情需要调整）。`,
    '每卷必须有独立的阶段性目标和高潮，同时服务于全书主线推进。',
    sectionLines('小说信息', [
      '书名：' + params.novelTitle,
      '简介：' + params.novelSynopsis,
      '题材：' + params.genre,
    ]),
    sectionLines('故事主线', [
      '故事目标：' + (params.storyGoal || '未提供'),
      '核心冲突：' + (params.coreConflict || '未提供'),
      '主线剧情：' + (params.mainPlot || '未提供'),
      '结局方向：' + (params.ending || '未提供'),
    ]),
    params.existingArcs ? section('已有故事弧', params.existingArcs) : '',
    params.protagonistSummary ? section('主角概况', params.protagonistSummary) : '',
    params.worldRulesSummary ? section('世界规则', params.worldRulesSummary) : '',
    params.threadsSummary ? section('故事线索', params.threadsSummary) : '',
    buildTitleAndStructureGuidance('volume'),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot].filter(Boolean).join('\n'),
      worldSummary: params.worldRulesSummary,
      taskFocus: '卷规划必须体现主角成长阶梯和主线推进节奏，每卷有明确的阶段性高潮。',
    }),
    section('规划要求', [
      '每卷的 theme 不能是空泛的"成长""蜕变"，必须写清这一卷主角面对的具体困境和要解决的具体问题。',
      '每卷的 key_arcs 必须指向具体的故事弧名称或事件，不能只写泛化推进标签。',
      '相邻两卷之间必须有明确的承接关系：上一卷的遗留问题如何影响下一卷。',
      '字数分配要考虑节奏：开篇卷可以短一些（15-25万字），中段卷可以长一些（25-35万字），收束卷根据需要调整。',
      '每卷必须标注主角在该卷的成长阶段和实力/地位变化。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '卷标题和主题描述要具体，不要写成万能隐喻标题或只表达气氛的空泛卷名。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前故事的具体内容：',
    '[{"volume_number":1,"title":"","theme":"","target_words":' + Math.round(params.targetTotalWords / estimatedVolumes) + ',"chapter_estimate":{"start":1,"end":100},"protagonist_stage":"","key_arcs":[],"major_events":[],"subplot_status":{},"volume_climax":"","bridge_to_next":""}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
  ])
}

export function buildTimelineEventsPrompt(params: TimelineEventPromptInput): string {
  return renderPrompt([
    '为这部小说规划一条可持续使用的事件时间轴。只规划关键节点，不要把每一场戏都拆进去。事件必须能服务后续写作，帮助作者记住时间顺序、人物在场情况、行动和后果。',
    sectionLines('小说信息', [
      `书名：${params.novelTitle}`,
      `题材：${params.genre || '未知题材'}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
    ]),
    sectionLines('故事核心', [
      `背景：${params.background || '未提供'}`,
      `故事目标：${params.storyGoal || '未提供'}`,
      `核心冲突：${params.coreConflict || '未提供'}`,
      `主线剧情：${params.mainPlot || '未提供'}`,
      `支线剧情：${params.subPlots || '暂无'}`,
      `结局方向：${params.ending || '未提供'}`,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.background,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.ending].filter(Boolean).join('\n'),
      worldSummary: [params.worldRulesSummary, params.timelineRules].filter(Boolean).join('\n'),
      taskFocus: '每个事件都要写清楚时间标签、事件名称、事件作用、主角是否在场、主角做了什么、直接结果、后续遗留问题。',
      extraRealityLines: ['事件描述要像人类策划记录，不要写空洞口号，不要给普通概念随意加引号。'],
    }),
    sectionLines('世界与时间规则', [
      params.worldRulesSummary ? `世界规则：\n${params.worldRulesSummary}` : '',
      params.timelineRules ? `时间规则：\n${params.timelineRules}` : '',
      params.arcSummary ? `故事弧：\n${params.arcSummary}` : '',
      params.characterSummary ? `关键人物：\n${params.characterSummary}` : '',
      params.locationSummary ? `关键地点：\n${params.locationSummary}` : '',
      params.itemSummary ? `关键物品：\n${params.itemSummary}` : '',
      params.existingEvents ? `已有事件：\n${params.existingEvents}` : '',
    ]),
    section('生成要求', [
      `只生成 ${params.count} 个左右的主事件或关键节点，覆盖开端、升级、反转、爆点、收束，不要生成流水账。`,
      '每个事件都要写清楚时间标签、事件名称、事件作用、主角是否在场、主角做了什么、直接结果、后续遗留问题。',
      '事件必须和已有故事弧、人物、地点相互勾连；如果能确定章节范围，就给出 chapter_start_num 和 chapter_end_num，否则留空。',
      'event_type 要贴合题材；time_label 要符合时间规则；time_sort_value 必须可排序，数值递增。',
      'present_characters 和 affected_characters 只写已有角色名；location_name 只写已有地点名；arc_name 只写已有故事弧名；linked_items 只写已有物品名。',
      'open_threads 只保留后文必须回收的问题；direct_consequences 只写事件立刻带来的变化。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '事件描述要像人类策划记录，不要写空洞口号，不要给普通概念随意加引号。',
      'summary、cause、process、result 都要写成具体事实，避免“矛盾升级”“命运转折”这类空话。',
    ])),
    '只输出 JSON 数组：[{"time_mode":"gregorian/regnal/relative-disaster/custom-era/future-date","time_label":"时间标签","time_sort_value":1,"time_precision":"年/月/日/阶段","event_title":"事件标题","event_summary":"30~60字概述","is_major_event":1,"event_type":"事件类型","arc_name":"关联故事弧","chapter_start_num":1,"chapter_end_num":2,"location_name":"关联地点","present_characters":["人物A","人物B"],"affected_characters":["人物C"],"protagonist_present":1,"protagonist_action":"主角做了什么","event_cause":"事件起因","event_process":"事件过程","event_result":"事件结果","linked_items":["物品A"],"direct_consequences":["直接后果1"],"open_threads":["待回收问题1"],"notes":"补充备注"}]',
  ])
}

function formatTargetWordsBand(targetWords: number): string {
  const target = Math.max(0, Math.round(targetWords || 0))
  if (target < 300) return '目标字数：' + target + ' 字左右'
  const floor = Math.round(target * 0.8)
  const ceiling = Math.round(target * 1.5)
  return '目标字数：' + target + ' 字（正文控制在 ' + floor + '-' + ceiling + ' 字之间；超过上限必须先删掉微动作堆叠、重复感官描写和无信息增量段落再交稿，不许靠加戏凑字数）'
}

export function buildScenePlanPrompt(params: ScenePlanPromptInput): string {
  return renderPrompt([
    '先为这一章做场景计划，再进入正文写作。场景计划是写作施工单，不是悬浮策划文案。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      '目标字数：' + params.targetWords + ' 字左右',
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      extraContextLines: ['每个场景写清：这一段要完成什么、当前冲突是什么、谁在场、会用到什么关键物品、必须交代什么。'],
      extraRealityLines: ['优先处理章节任务和因果推进，不要为了花样强行加戏。'],
    }),
    section('本章目标', params.chapterGoal),
    section('硬约束', params.hardConstraintContext),
    section('角色 Voice Lock', params.dialogueVoiceLocks),
    section('本章细纲', params.plotPoints),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('写作类型', params.writingContractSummary),
    section('关键人物关系', params.relationSummary),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('当前世界状态', params.worldStates),
    section('地图地点上下文', params.mapSummary),
    section('关键物品与去向', params.itemSummary),
    section('上一章关键先验', params.previousChapterContext),
    section('上章结尾', params.lastChapterEnding),
    section('章节衔接桥', params.chapterBridgePlan),
    section('步骤接力记忆', params.stepMemorySummary),
    buildRuntimeAssertionSection(params.runtimeAssertions),
    buildGoldenThreeChapterGuidance(params.chapterNum, 'scenePlan'),
    buildStepMemoryContinuityGuidance('scenePlan'),
    buildTitleAndStructureGuidance('scenePlan'),
    section('最近章节摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('本章应回收伏笔', params.dueForeshadows),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('活跃支线与伏笔', params.activeThreads),
    section('POV 约束', params.povGuidance),
    section('POV 轮转建议', params.povRotationGuidance),
    section('感官雷达', params.sensoryGuidance),
    section('叙事比例', params.narrativeRatioGuidance),
    section('节奏曲线', params.storyPacingGuidance),
    section('钩子连续性', params.hookContinuityGuidance),
    section('长文压缩记忆', params.longTermMemory),
    section('向量召回记忆', params.recalledMemory),
    section('跨章表达去重', params.expressionDedupGuidance),
    section('摘要健康', params.summaryHealthGuidance),
    section('角色声音进化', params.voiceEvolutionGuidance),
    section('当前结构体检提醒', params.consistencyNotes),
    section('计划要求', [
      '拆成 4 到 7 个场景或连续段落，每一段都要能直接落成正文。',
      '每个场景写清：这一段要完成什么、当前冲突是什么、谁在场、会用到什么关键物品、必须交代什么。',
      '至少安排一两个场景通过试错、碰壁或代价来体现人物成长，不要只靠总结句宣布成长。',
      '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      '优先处理章节任务和因果推进，不要为了花样强行加戏。',
      'exit_hook 只写最自然的收尾钩子，不要故作玄虚。',
      '',
      '可执行性检查（每个场景必须同时满足）：',
      '1. 开场钩子：场景开头 50 字内必须有一个动作、悬念或感官冲击，不能以描写天气/环境/心理活动开头。',
      '2. 具体冲突：conflict 字段必须写出「谁 vs 谁/什么」以及冲突的具体表现，不能写"矛盾升级""关系紧张"这种抽象词。',
      '3. 退出悬念：exit_hook 必须包含一个未解决的问题或即将发生的动作，让读者必须翻页。',
      '4. 因果链：每个场景的 purpose 必须承接上一个场景的 exit_hook 或结果。',
      '',
      '负面示例（以下写法会被打回重写）：',
      '× purpose: "推进剧情发展" → ✓ "林远发现仓库存粮被偷，追踪脚印到三号楼"',
      '× conflict: "矛盾进一步激化" → ✓ "林远要求搜查三号楼，赵队长以安全为由拒绝放行"',
      '× exit_hook: "事情变得更加复杂" → ✓ "林远在三号楼门缝里闻到血腥味"',
      '× beat: "众人讨论后达成一致" → ✓ "投票 4:3 通过搜查，赵队长摔门离开"',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '场景目标和冲突都写具体事实，不写“命运转折”“真正成长”这种空话。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前章节的具体内容：',
    '[{"scene_order":1,"scene_title":"","purpose":"","location":"","time_anchor":"","present_characters":[],"key_items":[],"conflict":"","beat":"","must_cover":[],"climax_variant":"","exit_hook":""}]',
    buildAvoidanceSection(params.rejectedDigests || []),
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
  ])
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '下面是这一章的任务卡。先吃透任务，再直接写正文。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      formatTargetWordsBand(params.targetWords),
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '先把事件链、动作链和后果链写顺，再让情绪自然浮出来。',
      extraContextLines: ['只写和本章任务有关的场景，不要为了凑字数平铺日常。'],
      extraRealityLines: ['遇到不准确搭配，优先改成读者最熟悉、最准确的常规说法。'],
    }),
    section('本章必须完成', params.chapterGoal || '按已定大纲执行'),
    section('硬约束', params.hardConstraintContext),
    section('角色 Voice Lock', params.dialogueVoiceLocks),
    section('已定章节大纲', params.plotPoints),
    section('写作类型', params.writingContractSummary),
    section('关键人物关系', params.relationSummary),
    section('本章必须承接', params.continuityNotes),
    section('当前未回收事项', params.openLoops),
    section('本章应回收伏笔', params.dueForeshadows),
    section('时间轴关键节点', params.timelineSummary),
    section('时间轴待回收事项', params.timelineOpenThreads),
    section('活跃支线与伏笔', params.activeThreads),
    section('POV 约束', params.povGuidance),
    section('POV 轮转建议', params.povRotationGuidance),
    section('感官雷达', params.sensoryGuidance),
    section('叙事比例', params.narrativeRatioGuidance),
    section('章节衔接桥', params.chapterBridgePlan),
    section('步骤接力记忆', params.stepMemorySummary),
    buildRuntimeAssertionSection(params.runtimeAssertions),
    buildGoldenThreeChapterGuidance(params.chapterNum, 'writing'),
    buildStepMemoryContinuityGuidance('writing'),
    section('节奏曲线', params.storyPacingGuidance),
    section('钩子连续性', params.hookContinuityGuidance),
    section('上一章关键先验', params.previousChapterContext),
    section('上章结尾', params.lastChapterEnding),
    section('当前人物状态', params.characterStates),
    section('当前世界状态', params.worldStates),
    section('地图地点上下文', params.mapSummary),
    section('关键物品与去向', params.itemSummary),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('世界规则与限制', params.worldRules),
    section('近章摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('向量召回记忆', params.recalledMemory),
    section('跨章表达去重', params.expressionDedupGuidance),
    section('摘要健康', params.summaryHealthGuidance),
    section('角色声音进化', params.voiceEvolutionGuidance),
    section('文风参考', params.styleTemplate),
    section('写作要求', [
      '先把事件链、动作链和后果链写顺，再让情绪自然浮出来。',
      '人物说话要像这个人当下会说的话，别让所有角色一个语气。',
      '如果上下文给了关系摘要，就把亲疏、权力差、潜台词和说话习惯写进对白。',
      '主角在本章里可以害怕、迟疑、失望、心软或犯错，但这些反应必须推动后续选择。',
      '只写和本章任务有关的场景，不要为了凑字数平铺日常。',
      '如果给了文风参考，只借叙述气质、视角和句子密度，不模仿具体作者。',
      '遇到不准确搭配，优先改成读者最熟悉、最准确的常规说法。',
      '只输出正文，不要解释。正文第一行直接进入叙事，不要写“第X章”、章节标题或任何标题行。',
    ].join('\n')),
    buildAvoidanceSection(params.rejectedDigests || []),
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'chapter') : '',
  ])
}

export function buildChapterDraftPrompt(params: ChapterRewritePromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '先根据场景计划写出一版完整初稿。重点是把事情写顺、把承接写准，先不要追求花哨修辞。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      formatTargetWordsBand(params.targetWords),
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '只按场景计划推进，不跳场景，不漏 必须交代项。',
      extraContextLines: ['只按场景计划推进，不跳场景，不漏 必须交代项。'],
      extraRealityLines: ['人物状态、物品去向、地点变换和事件顺序必须写准，避免后面大修。'],
    }),
    section('场景计划', params.scenePlan),
    section('本章目标', params.chapterGoal),
    section('硬约束', params.hardConstraintContext),
    section('角色 Voice Lock', params.dialogueVoiceLocks),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('写作类型', params.writingContractSummary),
    section('关键人物关系', params.relationSummary),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('当前世界状态', params.worldStates),
    section('地图地点上下文', params.mapSummary),
    section('关键物品与去向', params.itemSummary),
    section('上一章关键先验', params.previousChapterContext),
    section('上章结尾', params.lastChapterEnding),
    section('章节衔接桥', params.chapterBridgePlan),
    section('步骤接力记忆', params.stepMemorySummary),
    buildRuntimeAssertionSection(params.runtimeAssertions),
    buildGoldenThreeChapterGuidance(params.chapterNum, 'draft'),
    buildStepMemoryContinuityGuidance('draft'),
    section('最近章节摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('本章应回收伏笔', params.dueForeshadows),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('活跃支线与伏笔', params.activeThreads),
    section('POV 约束', params.povGuidance),
    section('POV 轮转建议', params.povRotationGuidance),
    section('感官雷达', params.sensoryGuidance),
    section('叙事比例', params.narrativeRatioGuidance),
    section('节奏曲线', params.storyPacingGuidance),
    section('钩子连续性', params.hookContinuityGuidance),
    section('长文压缩记忆', params.longTermMemory),
    section('向量召回记忆', params.recalledMemory),
    section('跨章表达去重', params.expressionDedupGuidance),
    section('摘要健康', params.summaryHealthGuidance),
    section('角色声音进化', params.voiceEvolutionGuidance),
    section('结构体检提醒', params.consistencyNotes),
    section('近期结构告警', params.structuralAlertsSummary),
    section('初稿要求', [
      '只按场景计划推进，不跳场景，不漏 must_cover。',
      '先把行为、对话、信息交接和后果写清，再处理气氛。',
      '每个主要场景都要包含可观察动作、可感知环境细节、人物选择和场景结束后的状态变化，不能只写心理总结。',
      '人物情绪必须通过停顿、动作、措辞变化、错误判断、资源消耗或关系反应体现，禁止用“他心中一震”“命运的齿轮”“某种情绪蔓延”这类模板句替代刻画。',
      '冲突不能只靠外部口号推进：至少写出一处具体阻力、一处主角判断成本、一处后续仍会持续的代价或未解决问题。',
      '涉及多人对话时，家人、朋友、陌生人、上下级和恋爱关系不能一个语气。',
      '对白每轮必须承担信息推进、关系变化、试探遮掩或行动决策之一；删掉寒暄式互相解释和角色替作者讲设定的句子。',
      '让成长落在事件、关系和代价里，不要只在段尾用一句总结硬说人物成长。',
      '人物状态、物品去向、地点变换和事件顺序必须写准，避免后面大修。',
      '如果某段只有情绪没有动作或结果，补上能落地的外部承载。',
      '如果近期结构告警提示主角太顺、代价蒸发、反转硬塞或高潮分布异常，必须在本章补出真实阻力、持续后果、铺垫兑现或节奏缓冲。',
      '叙事视角一致性：全篇保持同一叙事人称和视角限制。如果是第三人称限制视角，只能写视角角色能看到、听到、感受到的内容，不能偷跑到其他角色的内心。如果是第一人称，不能突然出现"他想着"这种第三人称描写。',
      '章节开头过渡：本章前 200 字必须自然衔接上章结尾的情境（时间、地点、情绪、未完成的动作），不能跳过不交代就进入新场景。',
      '只输出初稿正文，不要解释。正文第一行直接进入叙事，不要写“第X章”、章节标题或任何标题行。',
    ].join('\n')),
    buildAvoidanceSection(params.rejectedDigests || []),
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'chapter') : '',
  ])
}

export function buildChapterReviewPrompt(params: ChapterReviewPromptInput): string {
  return renderPrompt([
    '你是本书的连续性审校编辑。只指出会真正影响后续章节的问题：连续性断裂、上下文漂移、常识或规则违反、因果薄弱、铺垫落空、以及明显的 AI 腔。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '只找出真正砸掉上下文、真实度、连续性或人话感的问题。',
      extraQualityLines: ['优先给出具体修法，不要给空泛评论。'],
    }),
    section('本章目标', params.chapterGoal),
    section('硬约束', params.hardConstraintContext),
    section('角色 Voice Lock', params.dialogueVoiceLocks),
    section('场景计划', params.scenePlan),
    section('场景计划摘要', params.scenePlanSummary),
    section('小说核心', params.storyCore),
    section('写作类型', params.writingContractSummary),
    section('合同版本摘要', params.contractVersionSummary),
    section('关键人物关系', params.relationSummary),
    section('当前故事弧', params.currentArc),
    section('本弧推进记录', params.arcProgress),
    section('本弧进度状态', params.arcProgressStatus),
    section('弧检查点提醒', params.arcProgressCheckpoint),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('当前世界状态', params.worldStates),
    section('地图地点上下文', params.mapSummary),
    section('关键物品与去向', params.itemSummary),
    section('上一章关键先验', params.previousChapterContext),
    section('连续性记忆', params.continuitySummary),
    section('未回收事项', params.openLoops),
    section('本章应回收伏笔', params.dueForeshadows),
    section('时间轴锚点', params.timelineSummary),
    section('长期记忆', params.longTermMemory),
    section('向量召回记忆', params.recalledMemory),
    section('POV 约束', params.povGuidance),
    section('POV 轮转建议', params.povRotationGuidance),
    section('感官雷达', params.sensoryGuidance),
    section('叙事比例', params.narrativeRatioGuidance),
    section('章节衔接桥', params.chapterBridgePlan),
    section('步骤接力记忆', params.stepMemorySummary),
    buildRuntimeAssertionSection(params.runtimeAssertions),
    buildGoldenThreeChapterGuidance(params.chapterNum, 'review'),
    buildStepMemoryContinuityGuidance('review'),
    section('节奏曲线', params.storyPacingGuidance),
    section('钩子连续性', params.hookContinuityGuidance),
    section('跨章表达去重', params.expressionDedupGuidance),
    section('摘要健康', params.summaryHealthGuidance),
    section('角色声音进化', params.voiceEvolutionGuidance),
    section('结构体检提醒', params.consistencyNotes),
    section('近期结构告警', params.structuralAlertsSummary),
    section('当前稿件摘要', params.draftTextSummary),
    section('审校风险摘要', params.reviewRiskSummary),
    section('审校证据摘要', params.reviewProofSummary),
    section('发布门风险', params.publishGateRiskSummary),
    section('待审初稿', params.draftContent),
    section('输出规则', [
      '只保留真正值得修的问题。',
      'critical_fixes 最多 5 条，且必须是可直接执行的修改动作。',
      'continuity_risks 只写连续性、伏笔、状态跟踪、物品跟踪或时间顺序问题。',
      'arc_progress_risks 只写本章没有推进、反向推进、在关键检查点空转，或与当前故事弧目标脱节的问题。',
      'context_drift_risks 只写脱离既定背景、主题、世界规则或人物动机的问题。',
      'realism_risks 只写常识、科学、物理、资源、伤病、秩序或能力规则问题。',
      'coherence_risks 只写叙事链条会让读者读乱的地方，例如视角滑移、过渡断层、因果跳跃、信息顺序失衡。',
      'reader_hook_risks 只写会削弱追读欲的问题，例如冲突太轻、结果没代价、反转不成立、主角一路顺推。',
      'step_memory_risks 只写 Planner 场景计划、章节衔接桥、运行时接力断言、Writer 初稿之间没有对上的地方。',
      'opening_hook_risks 只写开篇吸引力问题：前 300 字无现场/动作/压力/追问点，前 800 字还在解释设定，或章尾没有递进。',
      'title_alignment_risks 只写标题与本章核心事件、场景物件、选择压力或反转点不匹配的问题。',
      'hallucination_risks 只写无来源新增设定、人物、能力、地点、物品、背景真相，或把推断升级成事实的问题。',
      'language_risks 只写 AI 腔、抽象化、搭配错误、空洞抒情或不自然表达。',
      'human_language_repairs 只列最值得优先替换的 1 到 3 处生硬表达，格式尽量写成“原说法 -> 更自然说法”。',
      '如果对话无视人物关系、称呼层级、亲疏温度或潜台词，也要归入 language_risks 或 context_drift_risks。',
      'dialogue_filler_risks 只写对白空转、打哈哈、重复问答却没有立场和动作承载的问题。',
      'dialogue_info_density_risks 只写对白信息推进不足的问题，要明确指出该补地点、目标、证据、筹码或下一步动作。',
      'dialogue_voice_lock_summary 用一句话概括本章生成前要锁哪些角色的声音。',
      'required_voice_lock_character_ids 只保留本章生成前必须启用 voice lock 的角色 id。',
      '必须结合当前故事弧、本章目标、场景计划、待审初稿和本弧进度状态，判断本章是否真的在服务当前弧目标。',
      'genre_hollowing_risks 只写体裁生态被写空的问题，例如修仙只喊大道却没有境界资源和宗门秩序，末世只有丧尸却没有生存链，武侠只有打斗却没有江湖秩序。',
      '如果主角像功能人、体裁生态被写空，或成长只剩口号，也要明确指出。',
      '主角受挫判断 protagonist_setback 只能是 none / minor / major，并给出 setback_summary 概括本章主角到底输了什么、失去了什么或被压制了什么。',
      'cost_present 表示本章是否出现明确代价；cost_present=true 时必须同时给出 cost_summary 和 cost_resolution_state。cost_resolution_state 只能是 new / ongoing / resolved / evaporated。',
      '如果本章把重大损失、风险或冲突一两段就抹平，cost_resolution_state 应判为 evaporated，而不是 resolved。',
      'reversal_marker 表示本章是否发生明确反转；为 true 时必须同时给出 reversal_summary 和 reversal_support_state。reversal_support_state 只能是 supported / weak / forced。',
      'pace_marker 只能选 setup / conflict / reversal / climax / payoff / breather 其中一个主标签。',
      'reward_state 只能是 none / partial / major，用来区分持续压抑、部分回报和阶段性大回报。',
      'protagonist_pressure 用 0-100 评估主角本章承受的结构压力；纯顺推爽章不要虚报高分。',
      'chapter_function_primary 只能选 setup / progression / reversal / payoff / breather / climax / exposition / closure 其中一个主功能。',
      'chapter_function_tags 只保留 1 到 3 个真正承担的叙事功能标签，并且必须包含 chapter_function_primary。',
      '如果关键章的主功能仍然只是 setup / exposition / breather，也要明确写进 critical_fixes 或 reader_hook_risks。',
      '如果“本章应回收伏笔”里存在到期或超期线索，而正文没有推进、暗示或交代延期原因，要优先写进 missing_payoffs 或 critical_fixes。',
      'missing_payoffs 只写本章已经抛出但没有落地的铺垫。',
      'strengths 只写已经成立且应该保留的具体优点。',
      'severity 只能是 low / medium / high。',
      '出现 high 级问题时 rewrite_required 必须是 true，其余情况可以是 false。',
      'revision_brief 用 60 到 120 字中文写清修改方向。',
    ].join('\n')),
    '只输出 JSON：{"summary":"总体判断","critical_fixes":["必改项"],"continuity_risks":["连续性风险"],"arc_progress_risks":["故事弧推进风险"],"context_drift_risks":["漂移风险"],"realism_risks":["真实度风险"],"coherence_risks":["连贯性风险"],"reader_hook_risks":["追读风险"],"step_memory_risks":["步骤接力风险"],"opening_hook_risks":["开篇吸引力风险"],"title_alignment_risks":["标题偏题风险"],"hallucination_risks":["无来源新增或推断升级风险"],"language_risks":["语言风险"],"human_language_repairs":["原说法 -> 更自然说法"],"genre_hollowing_risks":["体裁空心化风险"],"missing_payoffs":["未落地伏笔"],"strengths":["具体优点"],"severity":"medium","rewrite_required":true,"revision_brief":"修订方向摘要","protagonist_setback":"minor","setback_summary":"主角在关键交锋中被压制","cost_present":true,"cost_summary":"主角失去可靠盟友与补给","cost_resolution_state":"ongoing","reversal_marker":true,"reversal_summary":"看似得手后被埋伏反制","reversal_support_state":"supported","pace_marker":"reversal","reward_state":"partial","protagonist_pressure":72,"chapter_function_primary":"reversal","chapter_function_tags":["progression","reversal"],"dialogue_filler_risks":["对白空话"],"dialogue_info_density_risks":["信息推进不足"],"dialogue_voice_lock_summary":"","required_voice_lock_character_ids":[]}',
    buildAvoidanceSection(params.rejectedDigests || []),
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'chapter') : '',
  ])
}

export function buildChapterRewritePrompt(params: ChapterRewritePromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '把这一章重写成可直接入稿的版本。先修连续性、因果、人物状态、真实度、时间和物品准确性，最后再打磨语言。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      formatTargetWordsBand(params.targetWords),
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '只在既有上下文内重写，同时修复连续性、真实度和语言风险。',
      extraContextLines: ['不要通过删掉剧情压力或改写章节目标来假装解决上下文问题。'],
      extraRealityLines: ['如果审校指出反应、伤势、代价、移动跳跃或能力使用不合理，必须在正文里明确修正。'],
    }),
    section('场景计划', params.scenePlan),
    section('场景计划摘要', params.scenePlanSummary),
    section('当前稿件', params.draftContent),
    section('当前稿件摘要', params.draftTextSummary),
    section('作者锁定段落（逐字保留）', params.lockedParagraphs?.join('\n\n')),
    section('审校意见', params.reviewNotes),
    section('审校风险摘要', params.reviewRiskSummary),
    section('审校证据摘要', params.reviewProofSummary),
    section('重写差量摘要', params.rewriteDeltaSummary),
    section('合同版本摘要', params.contractVersionSummary),
    section('发布门风险', params.publishGateRiskSummary),
    section('本章目标', params.chapterGoal),
    section('硬约束', params.hardConstraintContext),
    section('角色 Voice Lock', params.dialogueVoiceLocks),
    section('当前故事弧', params.currentArc),
    section('小说核心', params.storyCore),
    section('写作类型', params.writingContractSummary),
    section('关键人物关系', params.relationSummary),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('当前世界状态', params.worldStates),
    section('地图地点上下文', params.mapSummary),
    section('关键物品与去向', params.itemSummary),
    section('上一章关键先验', params.previousChapterContext),
    section('上章结尾', params.lastChapterEnding),
    section('章节衔接桥', params.chapterBridgePlan),
    section('步骤接力记忆', params.stepMemorySummary),
    buildRuntimeAssertionSection(params.runtimeAssertions),
    buildGoldenThreeChapterGuidance(params.chapterNum, 'rewrite'),
    buildStepMemoryContinuityGuidance('rewrite'),
    section('近章摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('本章应回收伏笔', params.dueForeshadows),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('长期记忆', params.longTermMemory),
    section('向量召回记忆', params.recalledMemory),
    section('POV 约束', params.povGuidance),
    section('POV 轮转建议', params.povRotationGuidance),
    section('感官雷达', params.sensoryGuidance),
    section('叙事比例', params.narrativeRatioGuidance),
    section('节奏曲线', params.storyPacingGuidance),
    section('钩子连续性', params.hookContinuityGuidance),
    section('跨章表达去重', params.expressionDedupGuidance),
    section('摘要健康', params.summaryHealthGuidance),
    section('角色声音进化', params.voiceEvolutionGuidance),
    section('结构体检提醒', params.consistencyNotes),
    section('近期结构告警', params.structuralAlertsSummary),
    section('重写要求', [
      '已经成立的段落可以保留，但凡是影响成稿质量的都要修。',
      '如果场景计划里的 must_cover 漏了，补上。',
      '先修因果、指代清晰度、节奏、人物反应和真实度，最后再抛光语言。',
      '删掉空洞抒情、模板句和解释性旁白，把情绪放回动作、对话和细节里。',
      '把每个主要场景改成“具体阻力 -> 人物判断 -> 行动代价 -> 状态变化”的链条，不能只保留气氛、震惊和旁白解释。',
      '补足人物的私心、误判、顾虑、迟疑或遮掩，让角色像在维护自己的利益和关系，而不是替作者朗读剧情。',
      '对话重写时优先压缩说明句，改成试探、反问、打断、避重就轻、交换条件或暴露关系温度的说法。',
      '把关系温度、权力差和潜台词写回称呼、打断、停顿和回避方式，不要让所有对白一个基调。',
      '把成长变化写回事件、关系、资源和代价，不要只靠总结句宣告人物成长。',
      '在同一轮里一起修好上下文漂移、常识失效、规则越界、零代价奇迹和 AI 腔。',
      '如果近期结构告警提示主角太顺，就补出真实受挫、失误或代价；如果提示代价蒸发，就把后果延续到本章；如果提示反转硬塞，就补足前文呼应和触发链；如果提示高潮过密或过疏，就主动收束或蓄力。',
      '叙事视角一致性：检查并修正任何视角跳跃——限制视角不能写不在场角色的心理活动，第一人称不能突然变第三人称。如果初稿中有视角滑移，重写时修正为一致的视角。',
      '章节过渡：确保开头自然衔接上章结尾（参考"上章结尾"段），时间/地点/情绪过渡平滑，不能跳过未交代就进入新场景。',
      '作者锁定段落不得改写、删减、拆分、合并或替换措辞，只能改动周边段落来完成衔接。',
      '如果审校意见里有字数带宽或压缩要求，删减时优先砍微动作细节堆叠和重复描写，保留全部事件、冲突结果与伏笔。',
      '只输出重写后的最终正文。正文第一行直接进入叙事，不要写“第X章”、章节标题或任何标题行。',
    ].join('\n')),
    buildAvoidanceSection(params.rejectedDigests || []),
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'chapter') : '',
  ])
}

export function buildContinuityStatePrompt(params: ContinuityPromptInput): string {
  return renderPrompt([
    '从这一章里提炼后续写作必须记住的事实。不要写评价，不要写赏析，不要复述空话。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      params.arcName ? `所属故事弧：${params.arcName}` : '',
      params.chapterGoal ? `本章目标：${params.chapterGoal}` : '',
      params.summary ? `本章摘要：${params.summary}` : '',
    ]),
    ...buildPromptGuardrailSections({
      background: params.summary,
      taskFocus: '只保留清楚、可验证的事实，不写情绪化判断和抽象口号。',
      extraQualityLines: ['每条尽量写成短句，具体、可复用。'],
    }),
    section('入站义务', [
      params.chapterBridgePlan ? `章节衔接桥：\n${params.chapterBridgePlan}` : '',
      params.inboundContinuityNotes ? `本章必须承接：\n${params.inboundContinuityNotes}` : '',
      params.inboundOpenLoops ? `入站未回收事项：\n${params.inboundOpenLoops}` : '',
      params.inboundDueForeshadows ? `入站应回收伏笔：\n${params.inboundDueForeshadows}` : '',
    ].filter(Boolean).join('\n\n')),
    section('本章正文', params.chapterContent),
    section('提炼规则', [
      'plot_progress 只写真正推动了主线或支线的事实。',
      'character_state_changes 只写后续章节不能忘的人物状态变化。',
      'world_state_changes 只写局势、地点、势力、规则变化。',
      'open_loops 只保留还没回收、后面必须回应的事。',
      'continuity_notes 只写下章或后文不能漏掉的承接事项。',
      '如果入站未回收事项或入站应回收伏笔在正文里没有明确解决、回收或说明延期原因，必须继续写入 open_loops 或 continuity_notes，不得因为正文没提到就删除。',
      '如果章节衔接桥里的时间、地点、情绪、POV 或上章压力在正文里没有完全消化，也要保留为 continuity_notes 供后续修复。',
      '每条尽量写成短句，具体、可复用。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '只保留清楚、可验证的事实，不写情绪化判断和抽象口号。',
    ])),
    '只输出 JSON。示例值只表示字段结构，实际输出必须写入当前章节的具体事实：{"plot_progress":[],"character_state_changes":[],"world_state_changes":[],"open_loops":[],"continuity_notes":[],"arc_progress":""}',
  ])
}

export function storyArcsPrompt(params: {
  novelTitle: string
  genre: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  totalChapters: number
  rhythmSummary?: string
  background?: string
  protagonistReference?: string
  protagonistRule?: string
}): string {
  return buildStoryArcPlanningPrompt({
    ...params,
    rhythmSummary: params.rhythmSummary || '',
    background: params.background || '',
    protagonistReference: params.protagonistReference || '主角',
    protagonistRule: params.protagonistRule || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterOutlinePrompt(params: {
  novelTitle: string
  genre?: string
  storyGoal?: string
  coreConflict?: string
  mainPlot?: string
  arcName: string
  arcGoal: string
  arcSummary?: string
  arcGrowthLedger?: string
  arcCostLedger?: string
  chapterStart: number
  chapterEnd: number
  previousSummary: string
  characterStates: string
  continuitySummary?: string
  openLoops?: string
  worldRulesSummary: string
  protagonistReference?: string
  protagonistRule?: string
}): string {
  return buildChapterOutlinePlanningPrompt({
    novelTitle: params.novelTitle,
    genre: params.genre || '',
    storyGoal: params.storyGoal || '',
    coreConflict: params.coreConflict || '',
    mainPlot: params.mainPlot || '',
    arcName: params.arcName,
    arcGoal: params.arcGoal,
    arcSummary: params.arcSummary || '',
    arcGrowthLedger: params.arcGrowthLedger || '',
    arcCostLedger: params.arcCostLedger || '',
    chapterStart: params.chapterStart,
    chapterEnd: params.chapterEnd,
    previousSummary: params.previousSummary,
    characterStates: params.characterStates,
    continuitySummary: params.continuitySummary || '',
    openLoops: params.openLoops || '',
    worldRulesSummary: params.worldRulesSummary,
    protagonistReference: params.protagonistReference || '主角',
    protagonistRule: params.protagonistRule || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterWritingPrompt(params: {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  hardConstraintContext?: string
  dialogueVoiceLocks?: string
  plotPoints: string
  emotionTone: string
  worldRules: string
  characterStates: string
  worldStates?: string
  previousSummaries: string
  previousChapterContext: string
  lastChapterEnding: string
  styleTemplate: string
  targetWords: number
  genre?: string
  storyCore?: string
  currentArc?: string
  continuitySummary?: string
  openLoops?: string
  continuityNotes?: string
  timelineSummary?: string
  timelineOpenThreads?: string
  recalledMemory?: string
  protagonistReference?: string
  protagonistRule?: string
}): string {
  return buildChapterWritingPrompt({
    novelTitle: params.novelTitle,
    chapterNum: params.chapterNum,
    chapterTitle: params.chapterTitle,
    chapterGoal: params.chapterGoal,
    hardConstraintContext: params.hardConstraintContext || '',
    dialogueVoiceLocks: params.dialogueVoiceLocks || '',
    plotPoints: params.plotPoints,
    emotionTone: params.emotionTone,
    targetWords: params.targetWords,
    genre: params.genre || '',
    storyCore: params.storyCore || '',
    currentArc: params.currentArc || '',
    worldRules: params.worldRules,
    characterStates: params.characterStates,
    worldStates: params.worldStates || '',
    previousSummaries: params.previousSummaries,
    previousChapterContext: params.previousChapterContext,
    lastChapterEnding: params.lastChapterEnding,
    styleTemplate: params.styleTemplate,
    continuitySummary: params.continuitySummary || '',
    openLoops: params.openLoops || '',
    continuityNotes: params.continuityNotes || '',
    timelineSummary: params.timelineSummary || '',
    timelineOpenThreads: params.timelineOpenThreads || '',
    recalledMemory: params.recalledMemory || '',
    protagonistReference: params.protagonistReference || '主角',
    protagonistRule: params.protagonistRule || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterSummaryPrompt(chapterContent: string): string {
  return renderPrompt([
    '为这一章生成后续写作要用的结构化摘要。只写事实，不渲染气氛。',
    section('章节内容', chapterContent),
    section('上下文护栏', buildContextAlignmentRules({
      taskFocus: '只总结具体事实、状态变化和下一章最自然的承接点。',
    })),
    section('输出质量底线', buildOutputQualityRules([
      '不要把不确定的解读升级成硬事实。',
    ])),
    section('要求', [
      'summary 控制在 150 到 200 字，写清楚发生了什么、涉及谁、造成了什么变化。',
      '记录重要人物状态变化、关系变化、获得或失去的关键物件、局势变化。',
      'next_chapter_seed 用 50 字以内写清下章最自然的承接点。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '摘要只写清楚事实和后果，不写悬浮的主题感悟。',
    ])),
    '只输出 JSON：{"summary":"...","next_chapter_seed":"..."}',
  ])
}

export function aiCheckPrompt(text: string, truncated = false): string {
  return renderPrompt([
    '检查这段小说文字里的 AI 指纹，以及会让读者出戏的真实度或上下文问题。',
    truncated
      ? '【注意】以下文本因篇幅过长已做首尾采样，中间省略部分用“……”表示。请基于可见内容进行评估，不要对省略部分下结论。'
      : '',
    section('待检查文本', text),
    section('真实度护栏', buildGenreRealityRules({
      extraLines: ['同时标出上下文漂移、不合理恢复、不合理移动、不可能的资源结果，以及缺乏规则支撑的能力使用。'],
    })),
    section('检查重点', [
      '1. 用破折号偷懒解释或做假揭示',
      '2. 用引号抬高普通概念',
      '3. 抽象口号压过具体场景材料',
      '4. 硬造伪文艺句或模板抒情',
      '5. 万能引子和套路肌体反应',
      '6. 主谓宾逻辑断裂或对象类别错配',
      '7. 伤病、断缺、秩序、距离或能力上限被零代价解决',
    ].join('\n')),
    section('输出规则', [
      'issues.location 最多引用原文 15 个字。',
      'suggestion 必须是可直接执行的修改方向。',
      'overall_feedback 用一句话概括最主要的问题。',
      '如果发现“电网死亡”这类对象类别错配，要明确建议改成“电网瘫痪”“电力中断”“系统崩溃”这类精确说法。',
    ].join('\n')),
    '只输出 JSON：{"score":0,"issues":[{"type":"问题类型","location":"原文位置","suggestion":"具体修改方向","severity":"high/medium/low"}],"repetitions":["重复 1","重复 2"],"quote_abuse_count":0,"overall_feedback":"一句结论","ai_like_rate":0}',
  ])
}

export function rewriteParagraphPrompt(params: RewriteParagraphPromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '把下面这段文字改得更像人写的，但不要改动核心事件和信息。',
    section('原段落', params.originalParagraph),
    section('前文参考', params.contextBefore),
    section('额外要求', params.specificRequirements || '保持原意，让语言更自然、更贴人。'),
    ...buildPromptGuardrailSections({
      genre: params.genreContext,
      background: params.contextBefore,
      worldSummary: params.worldSummary,
      taskFocus: '先保住情节和信息，再处理语气、句式和细节。',
      extraQualityLines: ['逐句检查搭配是否成立，把不符合常规汉语的表达改成准确说法。'],
    }),
    section('改写原则', [
      '先保住情节和信息，再处理语气、句式和细节。',
      '少解释，多把心理落到动作、反应、对话里。',
      '拆掉明显模板句、万能词和假深刻表达。',
      '逐句检查搭配是否成立，把不符合常规汉语的表达改成准确说法。',
      '只输出改写后的纯文本，不要解释。',
    ].join('\n')),
    section('语言修复重点', buildHumanLanguageRules([
      '不要保留“物体死亡”“系统悲鸣”这类高歧义或不成立表达。',
    ])),
  ])
}

export function genericExpandPrompt(params: GenericExpandPromptInput): string {
  return renderPrompt([
    '扩写并整理【' + params.contentType + '】。要求是在原有想法上补足细节，而不是另起一套。',
    sectionLines('现有信息', [
      '小说背景：' + params.novelContext,
      '题材：' + params.genreContext,
      '已有内容：' + (params.existingContent || '暂无'),
      params.requirements ? '额外要求：' + params.requirements : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genreContext,
      background: params.novelContext,
      taskFocus: '只处理当前内容类型，不跳出去发明无关设定、专业指标或跨领域比喻。',
      extraQualityLines: ['先补事实、条件、关系、限制、用途和代价，再谈气质或意义。'],
    }),
    section('扩写要求', [
      '保留原始意图，优先补足能直接写进后续流程的细节。',
      '先补事实、条件、关系、限制、用途和代价，再谈气质或意义。',
      '如果原内容已经成立，就顺着往下补，不要推翻重来。',
      '只处理当前内容类型，不跳出去发明无关设定、专业指标或跨领域比喻。',
      '语言紧一点，少写套话和百科说明。',
      '只输出纯文本，不要 Markdown，不要前言。',
    ].join('\n')),    section('语言要求', buildHumanLanguageRules([
      '贴近当前题材常见写法，但不要模仿具体作者。',
    ])),
  ])
}

export function subplotExpandPrompt(params: SubplotExpandPromptInput): string {
  return renderPrompt([
    '完善小说《' + params.novelTitle + '》里的一条支线。支线必须反过来影响主线、人物关系或主题推进，不能写成独立番外。',
    sectionLines('现有信息', [
      '题材：' + params.genreContext,
      '主线概述：' + params.mainPlot,
      '支线名称：' + (params.subplot.name || '未命名'),
      '涉及人物：' + params.subplot.characters,
      '核心冲突：' + params.subplot.conflict,
      '与主线关联：' + params.subplot.mainlineLink,
      '预计收束章节：第' + (params.subplot.endChapter || 'X') + '章',
      params.requirements ? '额外要求：' + params.requirements : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genreContext,
      storyCore: params.mainPlot,
      taskFocus: '写清支线的引爆点、推进节点、转折、与主线交织的位置、收束方式和留下的余波。',
      extraQualityLines: ['支线最好至少改变一层关系、一次判断或一项局势，不然就不值得保留。'],
    }),
    section('输出内容', [
      '写清支线的引爆点、推进节点、转折、与主线交织的位置、收束方式和留下的余波。',
      '每一部分都写具体事件，不要只写方向或主题口号。',
      '人物行为必须符合现有性格、立场和处境，不能为了让支线成立硬拧。',
      '支线最好至少改变一层关系、一次判断或一项局势，不然就不值得保留。',
      '直接输出纯文本支线设定，不要解释。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '支线描述优先写清具体矛盾和作用，不写抽象口号。',
      '贴近当前题材常见写法，但不要模仿具体作者。',
    ])),
  ])
}

export function contentScoringPrompt(params: ContentScoringPromptInput): string {
  return renderPrompt([
    `从编辑和普通读者两种视角，评估下面这段【${params.contentType}】。`,
    sectionLines('背景信息', [
      `题材：${params.genreContext}`,
      `故事背景：${params.novelBackground}`,
    ]),
    section('上下文护栏', buildContextAlignmentRules({
      background: params.novelBackground,
      taskFocus: '从当前背景和题材出发给文本打分，不要拿它去和一个虚构的“更好版本”比较。',
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: params.genreContext,
      extraLines: ['把上下文贴合度、真实度贴合度和常识贴合度也纳入逻辑质量评价。'],
    })),
    section('待评价内容', params.content),
    section('评分维度（每项1-10分）', [
      '文笔质量：语言是否自然流畅，有无模板腔、翻译腔、对象类别错配。',
      '逻辑连贯：因果链、人物动机、事件顺序是否自洽，有无前后矛盾。',
      '节奏控制：叙事松紧是否有变化，是否存在匀速推进或拖沓。',
      '情感深度：情绪是否落在具体行为和细节上，还是停在抽象标签。',
      '人物塑造：角色行为是否贴合性格，对话是否有辨识度，成长是否可信。',
      '世界一致：设定、规则、物品、能力是否前后一致，有无违规。',
      '创新性：有没有明显套路感，是否有独特内容。',
      '追读欲：读者是否愿意继续看下去，结尾是否有有效钩子。',
    ].join('\n')),
    section('补充分析', [
      '给出 ai_like_rate（0-100，越低越好），重点看抽象大词、模板句、动作套路、概念包装、引号强调、伪哲学总结和对象类别错配。',
      '所有建议必须基于当前文本本身，不得发明额外设定、专业指标、概率判断或跨领域概念。',
      'top_fixes 只列最值得先改的 3 处，要具体、可操作，最好直接给出更自然的替换说法。',
      'weak_dimensions 列出得分最低的 2 个维度名称，用于后续章节生成时作为重点改进方向。',
    ].join('\n')),
    '只输出 JSON：{"dimensions":[{"name":"文笔质量","score":0,"feedback":"","suggestion":""},{"name":"逻辑连贯","score":0,"feedback":"","suggestion":""},{"name":"节奏控制","score":0,"feedback":"","suggestion":""},{"name":"情感深度","score":0,"feedback":"","suggestion":""},{"name":"人物塑造","score":0,"feedback":"","suggestion":""},{"name":"世界一致","score":0,"feedback":"","suggestion":""},{"name":"创新性","score":0,"feedback":"","suggestion":""},{"name":"追读欲","score":0,"feedback":"","suggestion":""}],"ai_like_rate":0,"repetition_risk":"低/中/高","overall_score":0,"overall_feedback":"","top_fixes":[],"weak_dimensions":[]}',
  ])
}

export const PROMPT_CATEGORIES = ['全部', '创作初始化', '人物系统', '大纲规划', '正文编写', '世界构建'] as const

export const PROMPT_CATALOG: PromptCatalogEntry[] = [
  {
    key: 'expandBackground',
    name: '背景扩充',
    description: '扩写开篇设定，生成背景、标题和简介。',
    category: '创作初始化',
    params: [
      { key: 'userBackground', label: '用户背景' },
      { key: 'genre', label: '题材' },
      { key: 'worldTemplateSummary', label: '世界观模板摘要' },
    ],
    template: expandBackgroundPrompt({
      userBackground: placeholder('userBackground'),
      genre: placeholder('genre'),
      worldTemplateSummary: placeholder('worldTemplateSummary'),
    }),
  },
  {
    key: 'protagonist',
    name: '主角生成',
    description: '生成可直接进入后续剧情设计的主角档案。',
    category: '人物系统',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'genre', label: '题材' },
      { key: 'worldSummary', label: '世界规则摘要' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'gender', label: '性别' },
      { key: 'surnameHint', label: '姓名方向' },
    ],
    template: protagonistPrompt({
      novelTitle: placeholder('novelTitle'),
      novelSynopsis: placeholder('novelSynopsis'),
      genre: placeholder('genre'),
      worldSummary: placeholder('worldSummary'),
      storyCore: placeholder('storyCore'),
      gender: placeholder('gender'),
      surnameHint: placeholder('surnameHint'),
    }),
  },
  {
    key: 'batchCharacter',
    name: '批量配角生成',
    description: '批量补出能服务主线的配角。',
    category: '人物系统',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'protagonistSummary', label: '主角摘要' },
      { key: 'existingNames', label: '已有人名' },
      { key: 'genre', label: '题材' },
      { key: 'worldSummary', label: '世界规则摘要' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'count', label: '数量' },
      { key: 'genderRatio', label: '性别比例' },
      { key: 'specialRequirements', label: '特殊要求' },
    ],
    template: batchCharacterPrompt({
      novelTitle: placeholder('novelTitle'),
      novelSynopsis: placeholder('novelSynopsis'),
      protagonistSummary: placeholder('protagonistSummary'),
      existingNames: placeholder('existingNames'),
      genre: placeholder('genre'),
      worldSummary: placeholder('worldSummary'),
      storyCore: placeholder('storyCore'),
      count: Number.NaN,
      genderRatio: placeholder('genderRatio'),
      specialRequirements: placeholder('specialRequirements'),
    }).replace('NaN', placeholder('count')),
  },
  {
    key: 'characterRelations',
    name: '关系网络生成',
    description: '根据已有角色整理关系网络和张力。',
    category: '人物系统',
    params: [
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'characterList', label: '人物列表' },
    ],
    template: characterRelationsPrompt({
      novelSynopsis: placeholder('novelSynopsis'),
      characterList: placeholder('characterList'),
    }),
  },
  {
    key: 'storyArcs',
    name: '故事弧规划',
    description: '规划连续推进的故事弧和支线落位。',
    category: '大纲规划',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'genre', label: '题材' },
      { key: 'storyGoal', label: '故事目标' },
      { key: 'coreConflict', label: '核心冲突' },
      { key: 'mainPlot', label: '主线剧情' },
      { key: 'subPlots', label: '支线剧情' },
      { key: 'ending', label: '结局方向' },
      { key: 'totalChapters', label: '总章节数' },
      { key: 'rhythmSummary', label: '节奏比例' },
      { key: 'background', label: '背景补充' },
      { key: 'protagonistReference', label: '主角称呼' },
      { key: 'protagonistRule', label: '主角命名规则' },
    ],
    template: buildStoryArcPlanningPrompt({
      novelTitle: placeholder('novelTitle'),
      genre: placeholder('genre'),
      storyGoal: placeholder('storyGoal'),
      coreConflict: placeholder('coreConflict'),
      mainPlot: placeholder('mainPlot'),
      subPlots: placeholder('subPlots'),
      ending: placeholder('ending'),
      totalChapters: Number.NaN,
      rhythmSummary: placeholder('rhythmSummary'),
      background: placeholder('background'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('totalChapters')),
  },
  {
    key: 'chapterOutline',
    name: '章节细纲生成',
    description: '为当前故事弧拆出逐章大纲。',
    category: '大纲规划',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'genre', label: '题材' },
      { key: 'storyGoal', label: '故事目标' },
      { key: 'coreConflict', label: '核心冲突' },
      { key: 'mainPlot', label: '主线剧情' },
      { key: 'arcName', label: '故事弧名称' },
      { key: 'arcGoal', label: '故事弧目标' },
      { key: 'arcSummary', label: '故事弧概述' },
      { key: 'arcGrowthLedger', label: '成长账本' },
      { key: 'arcCostLedger', label: '代价账本' },
      { key: 'chapterStart', label: '起始章节' },
      { key: 'chapterEnd', label: '结束章节' },
      { key: 'previousSummary', label: '前情摘要' },
      { key: 'characterStates', label: '人物状态' },
      { key: 'continuitySummary', label: '连续性记忆' },
      { key: 'openLoops', label: '未回收事项' },
      { key: 'worldRulesSummary', label: '世界规则摘要' },
      { key: 'protagonistReference', label: '主角称呼' },
      { key: 'protagonistRule', label: '主角命名规则' },
    ],
    template: buildChapterOutlinePlanningPrompt({
      novelTitle: placeholder('novelTitle'),
      genre: placeholder('genre'),
      storyGoal: placeholder('storyGoal'),
      coreConflict: placeholder('coreConflict'),
      mainPlot: placeholder('mainPlot'),
      arcName: placeholder('arcName'),
      arcGoal: placeholder('arcGoal'),
      arcSummary: placeholder('arcSummary'),
      arcGrowthLedger: placeholder('arcGrowthLedger'),
      arcCostLedger: placeholder('arcCostLedger'),
      chapterStart: Number.NaN,
      chapterEnd: Number.NaN,
      previousSummary: placeholder('previousSummary'),
      characterStates: placeholder('characterStates'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      worldRulesSummary: placeholder('worldRulesSummary'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterStart')).replace('NaN', placeholder('chapterEnd')),
  },
  {
    key: 'chapterWriting',
    name: '正文生成',
    description: '根据细纲和上下文写出章节正文。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'plotPoints', label: '章节大纲' },
      { key: 'emotionTone', label: '情绪基调' },
      { key: 'targetWords', label: '目标字数' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'currentArc', label: '当前故事弧' },
      { key: 'worldRules', label: '世界规则' },
      { key: 'characterStates', label: '人物状态' },
      { key: 'previousSummaries', label: '近章摘要' },
      { key: 'previousChapterContext', label: '上一章关键先验' },
      { key: 'lastChapterEnding', label: '上章结尾' },
      { key: 'chapterBridgePlan', label: '章节衔接桥' },
      { key: 'stepMemorySummary', label: '步骤接力记忆' },
      { key: 'runtimeAssertions', label: '运行时接力断言' },
      { key: 'styleTemplate', label: '文风参考' },
      { key: 'continuitySummary', label: '连续性记忆' },
      { key: 'recalledMemory', label: '向量召回记忆' },
      { key: 'openLoops', label: '未回收事项' },
      { key: 'continuityNotes', label: '必须承接事项' },
      { key: 'timelineSummary', label: '时间轴关键节点' },
      { key: 'timelineOpenThreads', label: '时间轴待回收事项' },
      { key: 'protagonistReference', label: '主角称呼' },
      { key: 'protagonistRule', label: '主角命名规则' },
    ],
    template: buildChapterWritingPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      plotPoints: placeholder('plotPoints'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      previousSummaries: placeholder('previousSummaries'),
      previousChapterContext: placeholder('previousChapterContext'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      chapterBridgePlan: placeholder('chapterBridgePlan'),
      stepMemorySummary: placeholder('stepMemorySummary'),
      runtimeAssertions: [placeholder('runtimeAssertions')],
      styleTemplate: placeholder('styleTemplate'),
      continuitySummary: placeholder('continuitySummary'),
      recalledMemory: placeholder('recalledMemory'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
  {
    key: 'chapterSummary',
    name: '章节摘要生成',
    description: '为完成章节生成后续写作摘要。',
    category: '正文编写',
    params: [{ key: 'chapterContent', label: '章节内容' }],
    template: chapterSummaryPrompt(placeholder('chapterContent')),
  },
  {
    key: 'continuityState',
    name: '连续性记忆提炼',
    description: '从当前章节提炼后文必须记住的事实。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'arcName', label: '故事弧名称' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'summary', label: '本章摘要' },
      { key: 'chapterContent', label: '章节正文' },
    ],
    template: buildContinuityStatePrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      arcName: placeholder('arcName'),
      chapterGoal: placeholder('chapterGoal'),
      summary: placeholder('summary'),
      chapterContent: placeholder('chapterContent'),
    }).replace('NaN', placeholder('chapterNum')),
  },
  {
    key: 'aiCheck',
    name: 'AI 检测·AI 痕迹',
    description: '检测文本里的模板腔和 AI 写作痕迹。',
    category: '正文编写',
    params: [{ key: 'text', label: '待检测文本' }],
    template: aiCheckPrompt(placeholder('text')),
  },
  {
    key: 'rewriteParagraph',
    name: '段落重写',
    description: '保留情节信息，压低模板腔和 AI 痕迹。',
    category: '正文编写',
    params: [
      { key: 'originalParagraph', label: '原段落' },
      { key: 'contextBefore', label: '前文上下文' },
      { key: 'specificRequirements', label: '额外要求' },
    ],
    template: rewriteParagraphPrompt({
      originalParagraph: placeholder('originalParagraph'),
      contextBefore: placeholder('contextBefore'),
      specificRequirements: placeholder('specificRequirements'),
    }),
  },
  {
    key: 'contentScoring',
    name: '内容评分',
    description: '从编辑和读者两侧评估内容质量与 AI 痕迹。',
    category: '正文编写',
    params: [
      { key: 'contentType', label: '内容类型' },
      { key: 'content', label: '待评估内容' },
      { key: 'genreContext', label: '题材' },
      { key: 'novelBackground', label: '故事背景' },
    ],
    template: contentScoringPrompt({
      contentType: placeholder('contentType'),
      content: placeholder('content'),
      genreContext: placeholder('genreContext'),
      novelBackground: placeholder('novelBackground'),
    }),
  },
  {
    key: 'mapGeneration',
    name: '地图生成',
    description: '生成能承载剧情的三层地图结构。',
    category: '世界构建',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'worldSummary', label: '世界观摘要' },
      { key: 'genre', label: '题材' },
      { key: 'mapStructure', label: '地图结构' },
      { key: 'namedPlaces', label: '已命名地点' },
    ],
    template: mapGenerationPrompt({
      novelTitle: placeholder('novelTitle'),
      worldSummary: placeholder('worldSummary'),
      genre: placeholder('genre'),
      mapStructure: placeholder('mapStructure'),
      namedPlaces: placeholder('namedPlaces'),
    }),
  },
]

export interface PowerSystemExpandInput {
  novelTitle: string
  genre: string
  worldSummary: string
  existingPowerSystems: string
  attemptNumber?: number
}

export function buildPowerSystemExpandPrompt(input: PowerSystemExpandInput): string {
  return renderPrompt([
    sectionLines('任务', [
      '你是一位精通力量体系设计的世界观架构师。',
      `为小说《${input.novelTitle}》（${input.genre}）深度扩展力量体系。`,
    ]),
    sectionLines('世界观背景', [input.worldSummary]),
    sectionLines('已有力量体系', [input.existingPowerSystems || '暂无']),
    sectionLines('扩展要求', [
      '为每个力量体系补充以下维度：',
      '1. 境界细分：每个大境界拆出 2-4 个小阶段，写清每阶段的标志性能力变化。',
      '2. 修炼资源：写清每个阶段需要什么资源、资源从哪来、谁控制资源。',
      '3. 瓶颈与代价：每次突破的风险、失败后果、不可逆的代价。',
      '4. 战力锚点：给出 2-3 个具体场景说明该境界能做什么、不能做什么。',
      '5. 体系交互：不同力量体系之间的克制、协同或冲突关系。',
    ]),
    sectionLines('硬约束', [
      '不要写成百科词条，要写成能直接用于剧情的设定。',
      '每个境界的描述必须包含"能做什么"和"做不到什么"两面。',
      '资源和代价必须具体到可以写进剧情的程度。',
    ]),
    input.attemptNumber ? buildVariationHint(input.attemptNumber, 'generic') : '',
    sectionLines('输出格式', [
      '输出 JSON 数组，每个元素代表一个力量体系：',
      '[{"name":"体系名","levels":[{"rank":"境界名","subStages":["小阶段1","小阶段2"],"abilities":"能力描述","limitations":"限制描述","resources":"所需资源","breakthroughRisk":"突破风险"}],"interactions":"与其他体系的关系"}]',
    ]),
  ])
}

export interface FactionSystemExpandInput {
  novelTitle: string
  genre: string
  worldSummary: string
  existingFactions: string
  attemptNumber?: number
}

export function buildFactionSystemExpandPrompt(input: FactionSystemExpandInput): string {
  return renderPrompt([
    sectionLines('任务', [
      '你是一位精通势力组织设计的世界观架构师。',
      `为小说《${input.novelTitle}》（${input.genre}）深度扩展势力组织体系。`,
    ]),
    sectionLines('世界观背景', [input.worldSummary]),
    sectionLines('已有势力', [input.existingFactions || '暂无']),
    sectionLines('扩展要求', [
      '为每个势力补充以下维度：',
      '1. 内部层级：写清从底层到顶层的权力结构，每层有多少人、掌握什么权限。',
      '2. 核心资源：这个势力靠什么立足——领地、技术、人脉、信仰还是暴力。',
      '3. 内部矛盾：派系分歧、继承危机、理念冲突，写出至少一个可以推动剧情的内部裂痕。',
      '4. 外部关系网：与其他势力的同盟、敌对、利用关系，写清利益交换的具体内容。',
      '5. 关键人物槽位：预留 2-3 个关键角色位置（掌权者、叛逆者、中间人），写清其职能但不命名。',
    ]),
    sectionLines('硬约束', [
      '势力之间必须存在至少一组不可调和的利益冲突。',
      '每个势力的"核心资源"必须是其他势力想要但得不到的东西。',
      '内部矛盾必须具体到可以写成剧情线的程度，不要写"内部存在分歧"这种空话。',
    ]),
    input.attemptNumber ? buildVariationHint(input.attemptNumber, 'generic') : '',
    sectionLines('输出格式', [
      '输出 JSON 数组，每个元素代表一个势力：',
      '[{"name":"势力名","hierarchy":[{"level":"层级名","count":"人数规模","authority":"权限范围"}],"coreResource":"核心资源描述","internalConflict":"内部矛盾描述","externalRelations":[{"target":"对方势力","relation":"关系类型","exchange":"利益交换内容"}],"keySlots":[{"role":"角色定位","function":"职能描述"}]}]',
    ]),
  ])
}
