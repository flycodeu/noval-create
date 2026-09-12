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
  /** 按题材筛出的节奏骨架参考（模板名+概述），只作可选参考，不强制。 */
  rhythmTemplateSection?: string
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
  designGateDirective?: string
  /** 弧上挂载的节奏模板换算成本弧章节区间后的节拍约束段。 */
  rhythmSection?: string
  /** 当前创作阶段的目标、边界和最小资产范围。 */
  creativeStageSummary?: string
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
  /** 本章必须被事件、选择与代价证明的主题命题。 */
  themeChapterTest?: string
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
  sceneWritingBrief?: string
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
  /** 弧级设计校验未通过时的矫正指令（设计词元 + 重写要求），本章被 flagged 时注入。 */
  designGateDirective?: string
  /** 本章所属弧挂载节奏模板时的单章节拍约束段。 */
  rhythmSection?: string
  plotPoints: string
  emotionTone: string
  targetWords: number
  storyCore: string
  writingContractSummary?: string
  /** 本章必须被事件、选择与代价证明的主题命题。 */
  themeChapterTest?: string
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
  sceneWritingBrief?: string
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
  /** Critic 必须逐字核对的章节级主题命题。 */
  themeChapterTest?: string
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
  /** Rewriter 必须修复到正文中的章节级主题命题。 */
  themeChapterTest?: string
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
  sceneWritingBrief?: string
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

export type VariationEntityType = 'character' | 'chapter' | 'outline' | 'map' | 'generic'

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

export interface PowerSystemExpandInput {
  novelTitle: string
  genre: string
  worldSummary: string
  existingPowerSystems: string
  attemptNumber?: number
}

export interface FactionSystemExpandInput {
  novelTitle: string
  genre: string
  worldSummary: string
  existingFactions: string
  attemptNumber?: number
}
