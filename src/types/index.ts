import type { GenreWorldRules } from '../shared/genre-system'
import type {
  SubPlotDraft,
  SubplotGenerationRequest,
  SubplotGenerationResult,
} from '../shared/subplot-framework'
import type {
  CoreSettingsGenerationRequest,
  CoreSettingsGenerationResult,
} from '../shared/core-settings-generation'
import type {
  PremiseGenerationMode,
  PremiseGenerationRequest,
  PremiseGenerationResult,
} from '../shared/premise-generation'
import type {
  ProjectBriefGenerationRequest,
  ProjectBriefGenerationResult,
} from '../shared/project-brief-generation'
import type {
  StoryThreadBatchGenerateOptions,
  StoryThreadBatchGenerationResult,
} from '../shared/story-thread-generation'
import type {
  WorldRuleSectionKey,
  WorldRulesAutoGenerateOptions,
  WorldRulesGenerationRequest,
  WorldRulesGenerationResult,
} from '../shared/world-rules-generation'
import type {
  ThemeVoiceGenerationRequest,
  ThemeVoiceGenerationResult,
} from '../shared/theme-voice-generation'
import type { FactionRelationType, FactionType } from '../shared/factions'
import type { GlossaryCategory } from '../shared/glossary'
import type { SceneTemplateCategory } from '../shared/scene-templates'

export type {
  CoreSettingsGenerationProgressEvent,
  CoreSettingsGenerationRequest,
  CoreSettingsGenerationResult,
} from '../shared/core-settings-generation'
export type { NovelBlurbDocument } from '../shared/blurb'
export type {
  FactionExternalRelation,
  FactionRelationType,
  FactionType,
} from '../shared/factions'
export type { GlossaryCategory } from '../shared/glossary'
export type { SceneTemplateCategory } from '../shared/scene-templates'
export type {
  PremiseGenerationMode,
  PremiseGenerationProgressEvent,
  PremiseGenerationRequest,
  PremiseGenerationResult,
} from '../shared/premise-generation'
export type {
  ProjectBriefDocument,
  ProjectBriefSnapshot,
} from '../shared/project-brief'
export type {
  ProjectBriefGenerationRequest,
  ProjectBriefGenerationResult,
} from '../shared/project-brief-generation'
export type {
  StoryThreadBatchGenerateOptions,
  StoryThreadBatchGenerationResult,
} from '../shared/story-thread-generation'
export type {
  WorldRuleSectionKey,
  WorldRulesAutoGenerateOptions,
  WorldRulesGenerationProgressEvent,
  WorldRulesGenerationRequest,
  WorldRulesGenerationResult,
} from '../shared/world-rules-generation'
export type {
  ThemeVoiceDocument,
  ThemeVoiceSnapshot,
} from '../shared/theme-voice'
export type {
  ThemeVoiceGenerationRequest,
  ThemeVoiceGenerationResult,
} from '../shared/theme-voice-generation'

export interface Novel {
  id: number
  title: string
  synopsis?: string
  genreId?: number
  genreName?: string
  genreColorTag?: string
  status: 'draft' | 'writing' | 'completed' | 'archived'
  totalWords: number
  targetWords: number
  coverImage?: string
  userBackground?: string
  expandedBackground?: string
  projectBriefJson?: string
  settingsJson?: string
  themeVoiceJson?: string
  worldRulesJson?: string
  blurbJson?: string
  styleTemplateId?: number
  worldTemplateId?: number
  contextVersion?: number
  modelConfigId?: number
  createdAt: string
  updatedAt: string
}

export interface NovelCreateInput {
  title: string
  synopsis?: string
  genreId?: number
  userBackground?: string
  expandedBackground?: string
  projectBriefJson?: string
  styleTemplateId?: number
  worldTemplateId?: number
  targetWords?: number
  modelConfigId?: number
}

export interface Chapter {
  id: number
  novelId: number
  volumeId?: number
  partId?: number
  chapterNum: number
  title?: string
  outline?: string
  scenePlanJson?: string
  content?: string
  wordCount: number
  summary?: string
  nextChapterSeed?: string
  continuityStateJson?: string
  reviewNotesJson?: string
  status: 'outline' | 'writing' | 'draft' | 'reviewing' | 'final'
  aiScoreJson?: string
  arcId?: number
  targetWords: number
  emotionTone?: string
  compiledFromSegments?: number
  segmentCount?: number
  contextVersion?: number
  staleReasonJson?: string
  createdAt: string
  updatedAt: string
}

export interface ChapterUpdateOptions {
  skipStaleTracking?: boolean
  versionSource?: 'manual-save' | 'ai-rewrite' | 'pipeline-generate' | 'version-restore' | false
}

export interface ChapterVersion {
  id: number
  novelId: number
  chapterId: number
  versionSource: 'manual-save' | 'ai-rewrite' | 'pipeline-generate' | 'version-restore'
  content: string
  wordCount: number
  createdAt: string
}

export interface Character {
  id: number
  novelId: number
  roleType: 'protagonist' | 'major' | 'minor' | 'antagonist' | 'supporting'
  recordStatus?: 'draft' | 'confirmed'
  entityType?: string
  species?: string
  surname?: string
  givenName?: string
  fullName: string
  gender?: string
  age?: number
  birthplace?: string
  occupation?: string
  rankLevel?: string
  socialIdentity?: string
  background?: string
  personalityTraitsJson?: string
  flawsJson?: string
  habitsJson?: string
  campFactionIdsJson?: string
  powerSystemRefsJson?: string
  contextHooksJson?: string
  goals?: string
  firstImpression?: string
  surfaceDesire?: string
  deepNeed?: string
  coreFear?: string
  innerConflict?: string
  hiddenSecret?: string
  moralLine?: string
  selfDeception?: string
  trauma?: string
  contradiction?: string
  relationshipTension?: string
  resonancePoint?: string
  characterArc?: string
  speechPattern?: string
  catchphrases?: string
  vocabularyLevel?: string
  dialectFeatures?: string
  appearanceJson?: string
  abilitiesJson?: string
  sourceContextJson?: string
  appearChapter?: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CharacterRelation {
  id: number
  novelId: number
  charAId: number
  charBId: number
  relationType?: string
  relationLabel?: string
  bilateral: number
  description?: string
  intimacyLevel?: number
  tensionLevel?: number
  interactionStyle?: string
  subtextRule?: string
}

export interface CharacterRelationInput {
  id?: number
  novelId: number
  charAId: number
  charBId: number
  relationType: string
  relationLabel?: string
  description?: string
  bilateral?: number
  intimacyLevel?: number
  tensionLevel?: number
  interactionStyle?: string
  subtextRule?: string
}

export interface CharacterQueryInput {
  novelId: number
  roleType?: Character['roleType']
  recordStatus?: 'draft' | 'confirmed' | 'all'
  entityType?: string
  species?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface CharacterStats {
  total: number
  confirmedCount?: number
  draftCount?: number
  protagonistCount: number
  majorCount: number
  antagonistCount: number
  relationCount: number
  speciesCount: number
}

export interface CharacterFilterOptions {
  species: string[]
  entityTypes: string[]
}

export interface CharacterGraphQueryInput {
  novelId: number
  characterIds?: number[]
  focusCharacterId?: number
  roleTypes?: Character['roleType'][]
  relationTypes?: string[]
  factionNames?: string[]
  recordStatus?: 'draft' | 'confirmed' | 'all'
  limit?: number
}

export interface CharacterGraphPayload {
  characters: Character[]
  relations: CharacterRelation[]
}

export interface CharacterGenerationOptions {
  gender?: string
  surnameHint?: string
  ageRange?: string
  species?: string
  occupationHint?: string
  factionHint?: string
  itemPreferences?: string[]
  personalitySeed?: string
  forbiddenNames?: string[]
  forceDifferentFromExisting?: boolean
}

export interface CharacterBatchGenerationOptions {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
  genderRatio?: string
  preferredSpecies?: string[]
  factionBias?: string[]
  helperRoles?: string[]
  batchSize: number
  specialRequirements?: string
  relationSeedMode?: 'balanced' | 'conflict-heavy' | 'ally-heavy'
  requiredItemLinks?: string[]
  diversityConstraints?: string[]
}

export interface StoryItemGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
  refreshTemplates?: boolean
  templateOnly?: boolean
}

export interface TimelineGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
}

export interface CharacterDetailContext {
  relatedItems: StoryItem[]
  relatedCharacters: Character[]
  relatedRelations: CharacterRelation[]
}

export interface StoryItemSourceContext {
  page?: string
  label?: string
  detectedAt?: string
}

export interface WorldMapItem {
  id: number
  novelId: number
  level: number
  parentId?: number
  name: string
  locationType?: string
  nodeType?: string
  structureRole?: string
  parentRuleType?: string
  description?: string
  atmosphere?: string
  plotRelevance?: string
  tagsJson?: string
  affiliatedFactionIdsJson?: string
  dangerLevel?: string
  sortOrder: number
  children?: WorldMapItem[]
}

export interface Faction {
  id: number
  novelId: number
  name: string
  type: FactionType
  goal?: string
  resources?: string
  territoryMapNodeIdsJson?: string
  leaderCharacterId?: number
  memberPolicy?: string
  currentPhase?: string
  externalRelationsJson?: string
  notes?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FactionQueryInput {
  novelId: number
  type?: FactionType
  keyword?: string
  page?: number
  pageSize?: number
}

export interface FactionStats {
  total: number
  withLeaderCount: number
  territoryBoundCount: number
  relationCount: number
}

export interface FactionBatchGenerationOptions {
  count: number
  batchSize: number
  preferredTypes?: FactionType[]
  relationshipDensity?: 'sparse' | 'balanced' | 'dense'
  allowCharacterlessFactions?: boolean
  preferExistingCharacters?: boolean
  specialRequirements?: string
}

export interface FactionGraphQueryInput {
  novelId: number
  focusFactionId?: number
}

export interface FactionGraphNode {
  id: string
  entityType: 'faction' | 'character'
  entityId: number
  label: string
  subLabel?: string
  summary?: string
  factionId?: number
  color?: string
}

export interface FactionGraphEdge {
  id: string
  source: string
  target: string
  relationType: FactionRelationType | 'leader' | 'member' | 'associate'
  relationLabel: string
  note?: string
  bilateral?: boolean
  color?: string
}

export interface FactionGraphCharacterSummary {
  id: number
  fullName: string
  roleType: Character['roleType']
  occupation?: string
  summary?: string
}

export interface FactionGraphPayload {
  nodes: FactionGraphNode[]
  edges: FactionGraphEdge[]
  unalignedCharacters: FactionGraphCharacterSummary[]
}

export interface GlossaryEntry {
  id: number
  novelId: number
  term: string
  category: GlossaryCategory
  definition?: string
  aliasesJson?: string
  firstAppearChapter?: number
  relatedEntityIdsJson?: string
  isCanonical: 0 | 1
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface GlossaryQueryInput {
  novelId: number
  category?: GlossaryCategory
  canonical?: 'all' | 'active' | 'deprecated'
  keyword?: string
  page?: number
  pageSize?: number
}

export interface GlossaryStats {
  total: number
  canonicalCount: number
  deprecatedCount: number
  categoryCount: number
}

export interface SceneTemplate {
  id: number
  novelId?: number
  genreId?: number
  name: string
  category: SceneTemplateCategory
  description?: string
  typicalBeatsJson?: string
  suggestedCharacterRolesJson?: string
  emotionArc?: string
  isBuiltin: 0 | 1
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface SceneTemplateQueryInput {
  novelId?: number
  genreId?: number
  category?: SceneTemplateCategory
  scope?: 'all' | 'builtin' | 'custom'
  keyword?: string
  page?: number
  pageSize?: number
}

export interface SceneTemplateStats {
  total: number
  builtinCount: number
  customCount: number
  genreScopedCount: number
}

export interface MapNodeSummary {
  id: number
  novelId: number
  level: number
  parentId?: number
  name: string
  locationType?: string
  nodeType?: string
  structureRole?: string
  parentRuleType?: string
  description?: string
  atmosphere?: string
  plotRelevance?: string
  tagsJson?: string
  affiliatedFactionIdsJson?: string
  dangerLevel?: string
  sortOrder: number
  childCount: number
}

export interface MapRelation {
  id: number
  novelId: number
  mapAId: number
  mapBId: number
  relationType?: string
  relationLabel?: string
  bilateral: number
  description?: string
  intensity?: string
  colorHint?: string
  sortOrder: number
}

export interface MapRelationInput {
  id?: number
  novelId: number
  mapAId: number
  mapBId: number
  relationType?: string
  relationLabel?: string
  bilateral?: number
  description?: string
  intensity?: string
  colorHint?: string
  sortOrder?: number
}

export interface MapGraphQueryInput {
  novelId: number
  focusNodeId?: number
  relationDepth?: number
  includeSiblingNodes?: boolean
  includeRelationEdges?: boolean
}

export interface MapGraphNode extends MapNodeSummary {
  graphRole: 'root' | 'focus' | 'ancestor' | 'descendant' | 'sibling' | 'related'
  tags: string[]
  affiliatedFactions: string[]
  summaryText: string
}

export interface MapGraphEdge {
  id: string
  sourceId: number
  targetId: number
  edgeKind: 'hierarchy' | 'relation'
  relationId?: number
  relationType?: string
  relationLabel?: string
  description?: string
  bilateral?: number
  colorHint?: string
}

export interface MapGraphPayload {
  nodes: MapGraphNode[]
  edges: MapGraphEdge[]
  focusNodeId?: number
  relationNodeIds: number[]
  rootNodeIds: number[]
}

export interface MapQueryInput {
  novelId: number
  parentId?: number | null
  level?: number
  keyword?: string
  page?: number
  pageSize?: number
}

export interface MapStats {
  total: number
  rootCount: number
  secondLevelCount: number
  leafCount: number
  maxDepth: number
  countsByLevel: Array<{ level: number; count: number }>
}

export interface MapBatchGenerateOptions {
  layerCounts?: number[] | Array<{ depth: number; count: number }>
  namedPlaces?: string
  parentBatchSize?: number
  maxRetries?: number
}

export interface MapBatchGenerationResult {
  stage: 'root' | 'children' | 'completed'
  targetDepth: number | null
  generatedNodeCount: number
  processedParentCount: number
  pendingParentCount: number
  processedParentNames: string[]
  completed: boolean
  message: string
  nextDepth: number | null
}

export interface TimelineEvent {
  id: number
  novelId: number
  sortOrder: number
  eventTitle: string
  eventSummary?: string
  timeMode: string
  timeLabel: string
  timeSortValue: number
  timePrecision?: string
  isMajorEvent: number
  eventType?: string
  arcId?: number
  volumeId?: number
  partId?: number
  chapterStartId?: number
  chapterEndId?: number
  segmentId?: number
  locationMapId?: number
  presentCharacterIdsJson?: string
  affectedCharacterIdsJson?: string
  protagonistPresent: number
  protagonistAction?: string
  eventCause?: string
  eventProcess?: string
  eventResult?: string
  linkedItemIdsJson?: string
  directConsequencesJson?: string
  openThreadsJson?: string
  notes?: string
  anchorInvalid?: number
  status: 'planned' | 'seeded' | 'written' | 'resolved'
  createdAt: string
  updatedAt: string
}

export interface StoryItem {
  id: number
  novelId: number
  itemKind: 'template' | 'instance'
  parentItemId?: number
  itemName: string
  genreFamily?: string
  category?: string
  subType?: string
  rarity?: string
  recordStatus?: 'draft' | 'confirmed'
  ownerCharacterId?: number
  locationMapId?: number
  status: 'available' | 'consumed' | 'hidden' | 'destroyed'
  summary?: string
  acquisitionMethod?: string
  usageMethod?: string
  cost?: string
  risk?: string
  plotFunction?: string
  appearance?: string
  factionHint?: string
  linkedCharacterIdsJson?: string
  linkedTimelineEventIdsJson?: string
  tagsJson?: string
  sourceContextJson?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface StoryItemDetailContext {
  item: StoryItem | null
  parentTemplate: StoryItem | null
  ownerCharacter: Character | null
  location: MapNodeSummary | null
  relatedCharacters: Character[]
  relatedEvents: TimelineEvent[]
  relatedArcs: StoryArc[]
  relatedLocations: MapNodeSummary[]
  derivedInstances: StoryItem[]
  siblingInstances: StoryItem[]
  sourceContexts: StoryItemSourceContext[]
}

export interface ModelConfig {
  id: number
  name: string
  provider: string
  modelId: string
  apiKey?: string
  baseUrl?: string
  temperature: number
  maxTokens: number
  maxContextTokens?: number | null
  maxConcurrency: number
  isDefault: number
  extraParamsJson?: string
  createdAt: string
}

export interface Template {
  id: number
  type: string
  name: string
  description?: string
  contentJson?: string
  isBuiltin: number
  genreCompatibilityJson?: string
  createdAt: string
}

export interface Task {
  id: number
  novelId?: number
  type: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'paused' | 'cancel_requested'
  inputJson?: string
  outputText?: string
  modelConfigId?: number
  tokensUsed?: number
  durationMs?: number
  errorMessage?: string
  relatedEntityType?: string
  relatedEntityId?: number
  runnerType?: 'chat' | 'stream' | 'workflow'
  retryable?: number
  parentTaskId?: number
  currentChildTaskId?: number
  controlJson?: string
  progressJson?: string
  createdAt: string
  updatedAt: string
}

export type AssetReviewTarget =
  | 'character'
  | 'faction'
  | 'item'
  | 'thread'
  | 'timeline'
  | 'subplot'
  | 'map'
  | 'world_rules'

export interface AssetReviewResult {
  summary: string
  severity: 'low' | 'medium' | 'high'
  rewriteRequired: boolean
  rejectRequired: boolean
  genreDriftRisks: string[]
  themeDriftRisks: string[]
  backgroundDriftRisks: string[]
  languageRisks: string[]
  humanLanguageRepairs: string[]
  conflictRisks: string[]
  topFixes: string[]
  strengths?: string[]
}

export interface AssetReviewObservability {
  targetType: AssetReviewTarget
  stage: 'drafted' | 'reviewed' | 'rewritten' | 'rejected' | 'accepted'
  reviewSummary: string
  severity: AssetReviewResult['severity']
  rewriteRequired: boolean
  rejectRequired: boolean
  topFixes: string[]
  risks: string[]
  warnings?: string[]
}

export interface TaskQueryInput {
  novelId?: number
  status?: Task['status']
  type?: string
  page?: number
  pageSize?: number
}

export interface TaskStats {
  total: number
  pendingCount: number
  runningCount: number
  cancelRequestedCount: number
  pausedCount: number
  successCount: number
  failedCount: number
  cancelledCount: number
}

export interface TaskHistoryClearInput {
  novelId?: number
  status?: Task['status']
  type?: string
}

export interface TaskHistoryClearResult {
  deletedCount: number
  deletedTaskIds: number[]
}

export interface PremiseDraftRecord {
  taskId: number
  novelId: number
  status: 'pending' | 'applied'
  result: PremiseGenerationResult & {
    missingFields?: string[]
    draftTaskId?: number
  }
  warnings: string[]
  sourcePage?: string
  mode?: PremiseGenerationMode
  appliedMode?: PremiseGenerationMode
  createdAt: string
  completedAt: string
  appliedAt?: string
}

export type PlanningDraftPageKey =
  | 'overview'
  | 'project-brief'
  | 'theme-voice'
  | 'story-design'
  | 'outline'
  | 'structure'
  | 'timeline'
  | 'revision'

export interface PlanningDraftRecord {
  taskId: number
  novelId: number
  pageKey: PlanningDraftPageKey
  status: 'pending' | 'applied'
  data: Record<string, unknown>
  warnings: string[]
  sourcePage?: string
  inputSummary?: string
  lintWarnings?: string[]
  rawOutputs?: string[]
  rejectionReason?: string
  finalData?: Record<string, unknown>
  diffSummary?: string[]
  finalizedAt?: string
  createdAt: string
  completedAt: string
  appliedAt?: string
}

export interface TaskControlState {
  cancelRequested?: boolean
  maxRetries?: number
  retryCount?: number
  batchKey?: string
}

export interface MapAutoGenerateStatus {
  taskId: number
  novelId: number
  status: Task['status']
  currentStage: 'idle' | 'root' | 'children' | 'completed'
  targetDepth: number | null
  currentParentName?: string
  generatedNodeCount: number
  processedParentCount: number
  pendingParentCount: number
  retryCount: number
  lastError?: string
  completed: boolean
  message?: string
  currentBatchKey?: string
}

export interface WorldRulesAutoGenerateFailure {
  key: WorldRuleSectionKey
  label: string
  error: string
}

export interface WorldRulesAutoGenerateStatus {
  taskId: number
  novelId: number
  status: Task['status']
  currentSection: WorldRuleSectionKey | ''
  currentSectionLabel?: string
  completedSectionCount: number
  pendingSectionCount: number
  totalSections: number
  completedSections: WorldRuleSectionKey[]
  pendingSections: WorldRuleSectionKey[]
  failedSections: WorldRulesAutoGenerateFailure[]
  retryCount: number
  lastError?: string
  completed: boolean
  message?: string
  workingRules?: GenreWorldRules
}

export interface BatchAutoGenerateStatusBase {
  taskId: number
  novelId: number
  status: Task['status']
  requestedCount: number
  batchSize: number
  currentBatch: number
  totalBatches: number
  resumeCursor: number
  generatedCount: number
  retryCount: number
  lastError?: string
  completed: boolean
  message?: string
  batchDigest?: string
}

export interface EntityBatchAutoGenerateStatus extends BatchAutoGenerateStatusBase {
  acceptedIds: number[]
  warnings: string[]
}

export interface CharacterAutoGenerateStatus extends EntityBatchAutoGenerateStatus {
  majorGenerated: number
  minorGenerated: number
  antagonistGenerated: number
  supportingGenerated: number
}

export type FactionAutoGenerateStatus = EntityBatchAutoGenerateStatus
export type ItemAutoGenerateStatus = EntityBatchAutoGenerateStatus
export type TimelineAutoGenerateStatus = EntityBatchAutoGenerateStatus

export interface StoryThreadAutoGenerateStatus extends BatchAutoGenerateStatusBase {
  acceptedIds: number[]
  warnings: string[]
}

export interface SubplotAutoGenerateRequest {
  novelId: number
  subplotCount: number
  storyGoal: string
  coreConflict: string
  mainPlot: string
  requirements?: string
}

export interface SubplotAutoGenerateStatus extends BatchAutoGenerateStatusBase {
  subplots: SubPlotDraft[]
  warnings: string[]
}

export interface StoryItemQueryInput {
  novelId: number
  itemKind?: StoryItem['itemKind']
  recordStatus?: 'draft' | 'confirmed' | 'all'
  category?: string
  status?: StoryItem['status']
  keyword?: string
  page?: number
  pageSize?: number
}

export interface StoryItemStats {
  total: number
  confirmedCount?: number
  draftCount?: number
  templateCount: number
  instanceCount: number
  linkedEventCount: number
  categoryCount: number
}

export interface EntityRegenerateOptions {
  mode?: 'repair' | 'replace'
}

export interface DiscoveredEntityCandidate {
  entityType: 'character' | 'item'
  name: string
  summary?: string
  relationHint?: string
  sourcePage: 'outline' | 'writing'
  sourceLabel: string
  sourceEntityId?: number
}

export interface StoryItemFilterOptions {
  categories: string[]
  rarities: string[]
}

export interface PromptOverride {
  key: string
  content: string
  updatedAt: string
}

export interface NovelContextStatus {
  novelId: number
  contextVersion: number
  totalChapterCount: number
  staleChapterCount: number
  staleChapterIds: number[]
  staleCheckpointCount: number
  staleAssetCount: number
  staleAssetKeys: string[]
  staleAssetLabels: string[]
}

export type ChapterContextComplexity = 'simple' | 'standard' | 'key'
export type ChapterContextStage = 'scenePlan' | 'draft' | 'review' | 'rewrite'
export type RecallBucketKey = 'character' | 'rule' | 'thread'
export type RecallSearchMode = 'vector' | 'keyword'
export type HardConstraintSourceLabel =
  | 'chapterGoal'
  | 'characterStates'
  | 'worldStates'
  | 'relationSummary'
  | 'itemSummary'
  | 'openLoops'
  | 'continuityNotes'

export interface HardConstraintEntryPreview {
  label: HardConstraintSourceLabel
  title: string
  content: string
  originalTokens: number
  allocatedTokens: number
  truncated: boolean
}

export interface SoftContextBudgetUsage {
  budget: number
  used: number
  warningCount: number
  droppedLabels: string[]
  truncatedLabels: string[]
}

export type ContextBudgetOverflowLevel = 'none' | 'soft_trimmed' | 'hard_failed'

export interface ContextBudgetWarningSummary {
  priority: 0 | 1 | 2 | 3
  count: number
  labels: string[]
}

export interface ContextBudgetReport {
  modelContextLimit: number
  requestedBudget: number
  effectiveBudget: number
  promptFixedOverhead: number
  reservedForOutput: number
  availableContextBudget: number
  hardConstraintBudget: number
  hardConstraintUsed: number
  softContextBudget: number
  softContextUsed: number
  overflowLevel: ContextBudgetOverflowLevel
  warningCount: number
  droppedLabels: string[]
  truncatedLabels: string[]
  droppedByPriority: ContextBudgetWarningSummary[]
}

export interface ConstraintInjectionStatus {
  promptProfile: ChapterContextStage
  hardConstraintBudget: number
  hardConstraintUsed: number
  softContextBudget: number
  softContextUsed: number
  droppedConstraintCount: number
  truncatedHardConstraintCount: number
  injectedLabels: HardConstraintSourceLabel[]
  truncatedLabels: HardConstraintSourceLabel[]
}

export interface RecallMemorySource {
  bucket: RecallBucketKey
  chapterId: number
  chapterNum: number
  fragmentType: string
  similarity: number
  searchMode: RecallSearchMode
  sourceLabel: string
  summary: string
  stale: boolean
  staleReasons: string[]
  overriddenByConstraint: boolean
}

export interface RecallDiagnostics {
  searchedBucketCount: number
  selectedBucketCount: number
  totalHitCount: number
  selectedHitCount: number
  staleRecallCount: number
  staleRecallRate: number
  recallDependencyRate: number
  overriddenHitCount: number
  fallbackHitCount: number
  summaryLines: string[]
}

export interface ChapterContextPreviewStage {
  stage: ChapterContextStage
  hardConstraintContext: string
  hardConstraintSummary: string
  hardConstraintEntries: HardConstraintEntryPreview[]
  constraintInjectionStatus: ConstraintInjectionStatus
  softContextBudgetUsage: SoftContextBudgetUsage
  contextBudgetReport: ContextBudgetReport
  droppedConstraintCount: number
}

export interface ChapterContextPreview {
  chapterId: number
  chapterNum: number
  complexity: ChapterContextComplexity
  recalledMemory: string
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
  stages: ChapterContextPreviewStage[]
}

export interface ChapterPublishCheckItem {
  key: string
  label: string
  status: 'pass' | 'warning' | 'blocker'
  detail: string
}

export interface ChapterPublishCheck {
  chapterId: number
  chapterNum: number
  ready: boolean
  summary: string
  blockerCount: number
  warningCount: number
  staleReasons: string[]
  chapterContextVersion: number
  novelContextVersion: number
  checklist: ChapterPublishCheckItem[]
}

export interface Genre {
  id: number
  name: string
  description?: string
  isBuiltin: number
  colorTag?: string
}

export interface StoryArc {
  id: number
  novelId: number
  arcName: string
  arcOrder: number
  chapterStart?: number
  chapterEnd?: number
  arcGoal?: string
  arcSummary?: string
  growthLedger?: string
  costLedger?: string
  phaseTargetsJson?: string
  targetWords?: number
  progressPercent?: number
  stalledChapterCount?: number
  lastProgressChapterNum?: number
}

export interface StoryArcPhaseTarget {
  key: 'phase_25' | 'phase_50' | 'phase_75' | 'phase_closure' | string
  label: string
  targetRatio: number
  targetChapterNum?: number
  expectedBeat?: string
  source: 'derived' | 'manual'
}

export interface StoryArcProgressAlert {
  code: 'stalled_run' | 'phase_missed' | 'low_volume_progress'
  severity: 'info' | 'warning' | 'critical'
  arcId: number
  arcName: string
  chapterNum?: number
  volumeId?: number
  title: string
  detail: string
}

export interface StoryArcProgressPoint {
  arcId: number
  arcName: string
  chapterId: number
  chapterNum: number
  title: string
  volumeId?: number
  progressPercent: number
  progressHit: boolean
  stalled: boolean
  arcProgressText?: string
  reviewRisks: string[]
  checkpointPhaseLabels: string[]
  hitPhaseLabels: string[]
  alertDetails: string[]
}

export interface StoryArcProgressSummary {
  arcId: number
  arcName: string
  chapterStart?: number
  chapterEnd?: number
  totalChapters: number
  coveredChapterCount: number
  progressChapterCount: number
  stalledChapterCount: number
  progressRate: number
  stallRate: number
  progressPercent: number
  longestStalledRun: number
  lastProgressChapterNum?: number
  phaseTargets: StoryArcPhaseTarget[]
  hitPhaseCount: number
  missedPhaseCount: number
  alerts: StoryArcProgressAlert[]
  statusSummary: string
}

export interface VolumeStoryArcProgressArcEntry {
  arcId: number
  arcName: string
  coveredChapterCount: number
  progressChapterCount: number
  stalledChapterCount: number
  progressRate: number
  stallRate: number
  hitPhaseLabels: string[]
  missedPhaseLabels: string[]
  alertCount: number
}

export interface VolumeArcProgressEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  arcEntries: VolumeStoryArcProgressArcEntry[]
}

export interface StoryArcProgressSnapshot {
  arcs: StoryArcProgressSummary[]
  chapterPoints: StoryArcProgressPoint[]
  alerts: StoryArcProgressAlert[]
  volumeEntries: VolumeArcProgressEntry[]
}

export interface StoryThread {
  id: number
  novelId: number
  threadType: 'main' | 'subplot' | 'mystery' | 'payoff' | 'relationship'
  title: string
  summary?: string
  premise?: string
  status: 'planned' | 'active' | 'resolved' | 'stalled' | 'abandoned'
  priority: 'high' | 'medium' | 'low'
  startChapter?: number
  targetPayoffChapter?: number
  payoffCondition?: string
  currentState?: string
  plantedChapter?: number
  lastReferencedChapter?: number
  reminderInterval?: number
  resolvedChapter?: number
  relatedCharacterIdsJson?: string
  relatedItemIdsJson?: string
  relatedTimelineEventIdsJson?: string
  notes?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface OperationLog {
  id: number
  novelId: number
  entityType: 'chapter' | 'thread' | 'timeline' | string
  entityIdsJson?: string
  operationType: 'batch_update' | 'batch_delete' | 'batch_reindex' | string
  summary: string
  batchKey?: string
  beforeJson?: string
  afterJson?: string
  undoPayloadJson: string
  undone: number
  undoneAt?: string
  createdAt: string
}

export interface StoryThreadQueryInput {
  novelId: number
  threadType?: StoryThread['threadType']
  status?: StoryThread['status']
  keyword?: string
  page?: number
  pageSize?: number
}

export interface StoryThreadStats {
  total: number
  activeCount: number
  resolvedCount: number
  stalledCount: number
  overdueCount: number
}

export type ForeshadowStatus = 'pending' | 'due' | 'overdue' | 'paid_off'

export interface ForeshadowThreadCard {
  id: number
  title: string
  threadType: StoryThread['threadType']
  status: StoryThread['status']
  foreshadowStatus: ForeshadowStatus
  priority: StoryThread['priority']
  plantedChapter?: number
  startChapter?: number
  targetPayoffChapter?: number
  resolvedChapter?: number
  payoffSpan?: number
  currentDistance?: number
  relatedCharacterCount: number
  payoffCondition?: string
  summary?: string
  currentState?: string
  warningText?: string
}

export interface ForeshadowSnapshot {
  currentChapterNum: number
  pending: ForeshadowThreadCard[]
  dueSoon: ForeshadowThreadCard[]
  resolved: ForeshadowThreadCard[]
  overdue: ForeshadowThreadCard[]
}

export interface RevisionTask {
  id: number
  novelId: number
  taskSource: 'manual' | 'system'
  issueKey?: string
  taskType: string
  status: 'open' | 'in_progress' | 'resolved' | 'ignored'
  severity: 'high' | 'medium' | 'low'
  title: string
  description?: string
  fixBrief?: string
  relatedPage?: string
  entityType?: string
  entityId?: number
  chapterId?: number
  originMetaJson?: string
  lastDetectedAt?: string
  resolvedAt?: string
  autoFixable?: boolean
  createdAt: string
  updatedAt: string
}

export interface RevisionAutoFixResult {
  taskId: number
  novelId: number
  status: 'fixed' | 'unsupported' | 'failed'
  message: string
  relatedPage?: string
  refreshedTask?: RevisionTask | null
}

export interface RevisionTaskQueryInput {
  novelId: number
  taskSource?: RevisionTask['taskSource']
  status?: RevisionTask['status']
  severity?: RevisionTask['severity']
  keyword?: string
  page?: number
  pageSize?: number
}

export interface RevisionTaskStats {
  total: number
  openCount: number
  inProgressCount: number
  resolvedCount: number
  blockerCount: number
}

export interface RevisionCenterSnapshot {
  tasks: RevisionTask[]
  stats: RevisionTaskStats
}

export interface StoryVolume {
  id: number
  novelId: number
  volumeNumber: number
  title?: string
  summary?: string
  targetWords: number
  status: 'planning' | 'draft' | 'locked'
  createdAt: string
  updatedAt: string
}

export interface StoryPart {
  id: number
  novelId: number
  volumeId: number
  partNumber: number
  title?: string
  summary?: string
  targetWords: number
  status: 'planning' | 'draft' | 'locked'
  startChapterNum?: number
  endChapterNum?: number
  createdAt: string
  updatedAt: string
}

export interface ChapterSegment {
  id: number
  novelId: number
  chapterId: number
  volumeId?: number
  partId?: number
  segmentOrder: number
  title?: string
  segmentType?: string
  purpose?: string
  timeAnchor?: string
  locationName?: string
  presentCharacterIdsJson?: string
  linkedItemIdsJson?: string
  inputState?: string
  outputState?: string
  summary?: string
  content?: string
  riskTagsJson?: string
  status?: string
  createdAt: string
  updatedAt: string
}

export interface StoryMemoryCheckpoint {
  id: number
  novelId: number
  scopeType: 'novel' | 'volume' | 'part'
  scopeId?: number
  label?: string
  summary?: string
  resolvedThreadsJson?: string
  activeThreadsJson?: string
  characterCardsJson?: string
  relationCardsJson?: string
  itemCardsJson?: string
  timelineCardsJson?: string
  threadCardsJson?: string
  characterStateDigest?: string
  relationDigest?: string
  itemDigest?: string
  timelineDigest?: string
  forbiddenDirectionsJson?: string
  styleGuard?: string
  sourceRangeStart?: number
  sourceRangeEnd?: number
  version: number
  stale: number
  createdAt: string
  updatedAt: string
}

export interface StoryStructureChapterView extends Chapter {
  segments: ChapterSegment[]
}

export interface StoryStructurePartView extends StoryPart {
  chapters: StoryStructureChapterView[]
  wordCount: number
  segmentCount: number
}

export interface StoryStructureVolumeView extends StoryVolume {
  parts: StoryStructurePartView[]
  wordCount: number
  chapterCount: number
  segmentCount: number
}

export interface StoryStructureTree {
  novelId: number
  volumes: StoryStructureVolumeView[]
}

export interface PagedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

export interface StoryStructureVolumeSummary extends StoryVolume {
  wordCount: number
  chapterCount: number
  segmentCount: number
  partCount: number
  linkedTimelineEventCount: number
}

export interface StoryStructurePartSummary extends StoryPart {
  wordCount: number
  chapterCount: number
  segmentCount: number
  linkedTimelineEventCount: number
}

export interface StoryStructureChapterSummary extends Chapter {
  linkedTimelineEventCount: number
}

export interface StoryStructureSegmentSummary extends ChapterSegment {
  linkedTimelineEventCount: number
}

export interface StoryCheckpointListFilters {
  novelId: number
  scopeType?: 'novel' | 'volume' | 'part'
  scopeId?: number
}

export interface StructurePathResolution {
  novelId: number
  volumeId: number | null
  volumeIndex: number
  partId: number | null
  partPage: number
  partPageSize: number
  chapterId: number | null
  chapterPage: number
  chapterPageSize: number
  segmentId: number | null
  segmentPage: number
  segmentPageSize: number
  resolvedLevel: 'novel' | 'volume' | 'part' | 'chapter' | 'segment'
}

export interface StructureBatchPlanSegmentInput {
  title?: string
  segmentType?: string
  purpose?: string
  timeAnchor?: string
  locationName?: string
  inputState?: string
  outputState?: string
  summary?: string
  content?: string
  status?: string
}

export interface StructureBatchPlanChapterInput {
  title?: string
  outline?: string
  targetWords?: number
  status?: Chapter['status']
  segments: StructureBatchPlanSegmentInput[]
}

export interface StructureBatchPlanPartInput {
  title?: string
  summary?: string
  targetWords?: number
  status?: StoryPart['status']
  chapters: StructureBatchPlanChapterInput[]
}

export interface StructureBatchPlanVolumeInput {
  title?: string
  summary?: string
  targetWords?: number
  status?: StoryVolume['status']
  parts: StructureBatchPlanPartInput[]
}

export interface StructureBatchPlan {
  summary?: string
  volumes: StructureBatchPlanVolumeInput[]
}

export type StructureBatchEditOperation =
  | { kind: 'move_parts'; partIds: number[]; targetVolumeId: number }
  | { kind: 'move_chapters'; chapterIds: number[]; targetPartId: number }
  | { kind: 'move_segments'; segmentIds: number[]; targetChapterId: number }
  | { kind: 'delete_volumes'; volumeIds: number[] }
  | { kind: 'delete_parts'; partIds: number[] }
  | { kind: 'delete_chapters'; chapterIds: number[] }
  | { kind: 'delete_segments'; segmentIds: number[] }
  | { kind: 'reorder_volumes'; orderedIds: number[] }
  | { kind: 'reorder_parts'; volumeId: number; orderedIds: number[] }
  | { kind: 'reorder_chapters'; partId: number; orderedIds: number[] }
  | { kind: 'reorder_segments'; chapterId: number; orderedIds: number[] }

export interface StructureBatchPreviewItem {
  kind: StructureBatchEditOperation['kind']
  summary: string
  targetLabel?: string
  timelineEffect: 'rebind' | 'invalidate' | 'none'
  selectedCount: number
  volumeCount: number
  partCount: number
  chapterCount: number
  segmentCount: number
  timelineEventCount: number
  anchorRiskCount: number
  warnings: string[]
}

export interface StructureBatchPreview {
  novelId: number
  summary: string
  items: StructureBatchPreviewItem[]
  warnings: string[]
}

export interface StructureBatchFocus {
  volumeId?: number
  partId?: number
  chapterId?: number
  segmentId?: number
}

export interface StructureBatchApplyResult {
  novelId: number
  message: string
  firstChapterId: number | null
  focus?: StructureBatchFocus
}

export interface StoryPartReorderOperation {
  id: number
  volumeId: number
  partNumber: number
}

export interface TimelineAnchorFilters {
  novelId: number
  volumeId?: number
  partId?: number
  chapterId?: number
  segmentId?: number
}

export interface TimelineQueryInput extends TimelineAnchorFilters {
  status?: TimelineEvent['status']
  eventType?: string
  keyword?: string
  page?: number
  pageSize?: number
  sortBy?: 'timeSortValue' | 'createdAt'
  sortDirection?: 'asc' | 'desc'
}

export interface TimelineStats {
  total: number
  majorCount: number
  resolvedCount: number
  openThreadCount: number
}

export interface TimelineFilterOptions {
  eventTypes: string[]
}

export interface OutlineChapterBatchGenerateOptions {
  batchSize?: number
}

export interface OutlineChapterBatchGenerationResult {
  generatedCount: number
  completed: boolean
  batchStart: number | null
  batchEnd: number | null
  message: string
}

export interface ConsistencyIssue {
  id: string
  severity: 'high' | 'medium' | 'low'
  category: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'outline' | 'continuity' | 'thread' | 'voice' | 'relation' | 'worldState'
  title: string
  description: string
  suggestion: string
  entityType?: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'arc' | 'thread' | 'faction' | 'relation' | 'location'
  entityId?: number
  entityLabel?: string
}

export interface NovelConsistencyReport {
  generatedAt: string
  readinessScore: number
  overview: string
  issueCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  focusAreas: string[]
  metrics: {
    chapterCount: number
    chaptersMissingSummary: number
    chaptersMissingContinuity: number
    timelineCount: number
    linkedTimelineCount: number
    itemCount: number
    bidirectionalLinkCount: number
    writingContractTagCount: number
    protagonistRelationCount: number
    styledRelationCount: number
    subtextRelationCount: number
    ratedRelationCount: number
    worldStateTrackedEntityCount: number
    worldStateDriftAlertCount: number
    worldStateConflictAlertCount: number
  }
  issues: ConsistencyIssue[]
}

export interface CharacterStateVersion {
  id: number
  novelId: number
  characterId: number
  chapterId: number
  chapterNum: number
  injuryState?: string
  resourceState?: string
  stanceState?: string
  mentalState?: string
  relationshipHeatSummary?: string
  goalState?: string
  eventCause?: string
  changeReason?: string
  summaryText?: string
  createdAt: string
  updatedAt: string
}

export interface CharacterStateSummary {
  characterId: number
  characterName: string
  roleType: Character['roleType']
  chapterId: number
  chapterNum: number
  injuryState?: string
  resourceState?: string
  stanceState?: string
  mentalState?: string
  relationshipHeatSummary?: string
  goalState?: string
  eventCause?: string
  changeReason?: string
  summaryText: string
  driftAlert?: string
}

export interface CharacterStateDriftAlert {
  characterId: number
  characterName: string
  chapterId: number
  chapterNum: number
  driftScore: number
  reasons: string[]
  summary: string
}

export type WorldStateEntityType = 'character' | 'faction' | 'item' | 'relation' | 'location'
export type WorldStateSeverity = 'info' | 'warning' | 'critical'
export type WorldStateAlertType = 'drift' | 'conflict'

export interface WorldStateVersion {
  id: number
  novelId: number
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  chapterId: number
  chapterNum: number
  stateKey: string
  stateValue?: string
  normalizedValue?: string
  summaryText?: string
  eventCause?: string
  changeReason?: string
  sourceKind?: string
  sourceRef?: string
  severity?: WorldStateSeverity
  createdAt: string
  updatedAt: string
}

export interface WorldStateSummary {
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  chapterId: number
  chapterNum: number
  summaryText: string
  stateItems: string[]
  eventCause?: string
  changeReason?: string
  severity: WorldStateSeverity
}

export interface WorldStateAlert {
  alertType: WorldStateAlertType
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  chapterId: number
  chapterNum: number
  stateKey?: string
  severity: WorldStateSeverity
  score: number
  reasons: string[]
  summary: string
}

export interface WorldStateTrendPoint {
  chapterNum: number
  driftCount: number
  conflictCount: number
  warningCount: number
}

export interface WorldStateLedgerEntity extends WorldStateSummary {
  alerts: WorldStateAlert[]
  driftCount: number
  conflictCount: number
}

export interface WorldStateLedgerConflictEntity {
  entityType: WorldStateEntityType
  entityId: number
  entityName: string
  severity: WorldStateSeverity
  chapterId: number
  chapterNum: number
  summaryText: string
  alertCount: number
  driftCount: number
  conflictCount: number
  reasons: string[]
}

export interface WorldStateLedgerOverview {
  trackedEntityCount: number
  trackedByType: Record<WorldStateEntityType, number>
  driftAlertCount: number
  conflictAlertCount: number
  warningCount: number
  criticalCount: number
  conflictEntityCount: number
  recentConflictEntities: string[]
}

export interface WorldStateLedgerSnapshot {
  generatedAt: string
  upToChapterNum?: number
  entities: WorldStateLedgerEntity[]
  alerts: WorldStateAlert[]
  conflictEntities: WorldStateLedgerConflictEntity[]
  trend: WorldStateTrendPoint[]
  trendSummary: string[]
  overview: WorldStateLedgerOverview
  worldStatesText: string
}

export interface StoryMemorySnapshot {
  generatedAt: string
  chapterCount: number
  lastChapterNum: number
  memoryMode: 'standard' | 'longform' | 'epic' | 'mega'
  coverageSummary: string
  phaseDigest: string[]
  plotMilestones: string[]
  arcSignals: string[]
  characterLedger: string[]
  characterCurrentStates: CharacterStateSummary[]
  characterStateAlerts: CharacterStateDriftAlert[]
  worldCurrentStates: WorldStateSummary[]
  worldStateAlerts: WorldStateAlert[]
  worldStateOverview: WorldStateLedgerOverview
  worldConflictEntities: WorldStateLedgerConflictEntity[]
  characterStateTrendSummary: string[]
  worldStateTrendSummary: string[]
  worldLedger: string[]
  activeThreads: string[]
  continuityDirectives: string[]
  timelineAnchors: string[]
  itemLedger: string[]
}

export type SubPlot = SubPlotDraft

// AI 评分结果类型
export interface AIScoreDimension {
  name: string
  score: number
  feedback: string
  suggestion: string
}

export interface LanguageDriftMetrics {
  abstractTokenDensity: number
  sentencePatternRepeatRate: number
  endingSummaryRate: number
  ornamentOverloadRate: number
  nonHumanCollocationRate: number
}

export type ProtagonistSetbackLevel = 'none' | 'minor' | 'major'
export type CostResolutionState = 'new' | 'ongoing' | 'resolved' | 'evaporated'
export type ReversalSupportState = 'supported' | 'weak' | 'forced'
export type ChapterPacingMarker = 'setup' | 'conflict' | 'reversal' | 'climax' | 'payoff' | 'breather'
export type RewardState = 'none' | 'partial' | 'major'
export type ChapterFunctionTag = 'setup' | 'progression' | 'reversal' | 'payoff' | 'breather' | 'climax' | 'exposition' | 'closure'

export interface ChapterStoryDynamics {
  protagonistSetback: ProtagonistSetbackLevel
  setbackSummary?: string
  costPresent: boolean
  costSummary?: string
  costResolutionState?: CostResolutionState
  reversalMarker: boolean
  reversalSummary?: string
  reversalSupportState?: ReversalSupportState
  paceMarker?: ChapterPacingMarker
  rewardState: RewardState
  protagonistPressure: number
}

export interface StoryDynamicsAlert {
  code: 'too_smooth' | 'cost_evaporation' | 'forced_reversal' | 'long_oppression_without_reward' | 'climax_overcrowded' | 'climax_gap_too_long'
  severity: 'warning' | 'blocker'
  title: string
  detail: string
  chapterNums: number[]
}

export interface StoryDynamicsTrendPoint {
  chapterId: number
  chapterNum: number
  title: string
  volumeId?: number
  pressure: number
  setbackLevel: 0 | 1 | 2
  rewardLevel: 0 | 1 | 2
  paceMarker?: ChapterPacingMarker
  reversalMarker: boolean
  climaxMarker: boolean
}

export interface CostDurationEntry {
  startChapterNum: number
  endChapterNum?: number
  duration: number
  status: 'ongoing' | 'resolved' | 'evaporated'
  summary: string
}

export interface ProtagonistSetbackSummary {
  chapterCount: number
  protagonistSetbackRate: number
  majorSetbackRate: number
  averagePressure: number
  longestSmoothRun: number
  longestPressureRun: number
}

export interface CostPersistenceSummary {
  averageCostDuration: number
  evaporatedCostCount: number
  unresolvedCostCount: number
  activeCosts: CostDurationEntry[]
}

export interface ReversalDistributionSummary {
  reversalChapterNums: number[]
  climaxChapterNums: number[]
  breatherChapterNums: number[]
  payoffChapterNums: number[]
  forcedReversalCount: number
  weakReversalCount: number
  climaxSpacing: number[]
  paceMarkerCounts: Record<ChapterPacingMarker, number>
}

export type LanguageDriftTrendStatus = 'worsening' | 'stable' | 'improving'

export interface LanguageDriftMetricSnapshot {
  metric: keyof LanguageDriftMetrics
  label: string
  value: number
}

export interface LanguageDriftTrendSummary {
  metric: keyof LanguageDriftMetrics
  label: string
  latestValue: number
  previousValue: number
  delta: number
  status: LanguageDriftTrendStatus
}

export interface VolumeLanguageDriftEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  averageMetrics: LanguageDriftMetrics
  topWorseningMetrics: LanguageDriftTrendSummary[]
}

export interface NovelLanguageDriftSummary {
  chapterCount: number
  recentWindowSize: number
  statusBreakdown: Record<LanguageDriftTrendStatus, number>
  topRiskMetrics: LanguageDriftMetricSnapshot[]
}

export interface VolumeStoryDynamicsEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  protagonistSetbackRate: number
  majorSetbackRate: number
  averagePressure: number
  averageCostDuration: number
  evaporatedCostCount: number
  climaxChapterNums: number[]
  reversalChapterNums: number[]
  paceMarkerCounts: Record<ChapterPacingMarker, number>
  alerts: StoryDynamicsAlert[]
}

export interface ChapterFunctionRun {
  primaryTag: ChapterFunctionTag
  startChapterNum: number
  endChapterNum: number
  length: number
  chapterNums: number[]
}

export interface ChapterFunctionAlert {
  code: 'repeated_function_run' | 'volume_function_skew' | 'weak_key_chapter_function'
  severity: 'warning' | 'blocker'
  title: string
  detail: string
  chapterNums: number[]
  volumeId?: number
  primaryTag?: ChapterFunctionTag
}

export interface ChapterFunctionSummary {
  trackedChapterCount: number
  chapterPurposeCoverage: number
  rhythmBalanceScore: number
  repeatedFunctionRunCount: number
  longestRepeatedFunctionRun: number
  dominantTag?: ChapterFunctionTag
  dominantTagShare: number
  tagCounts: Record<ChapterFunctionTag, number>
}

export interface VolumeChapterFunctionEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  trackedChapterCount: number
  rhythmBalanceScore: number
  dominantTag?: ChapterFunctionTag
  dominantTagShare: number
  tagCounts: Record<ChapterFunctionTag, number>
  repeatedRuns: ChapterFunctionRun[]
  alerts: ChapterFunctionAlert[]
}

export type QualityDashboardRiskKind =
  | 'language_drift'
  | 'story_dynamics'
  | 'chapter_function'
  | 'story_arc'
  | 'foreshadow_debt'
  | 'recall'
  | 'world_state'

export type QualityDashboardRiskSeverity = 'info' | 'warning' | 'critical'

export interface QualityDashboardRiskItem {
  kind: QualityDashboardRiskKind
  severity: QualityDashboardRiskSeverity
  title: string
  detail: string
  volumeId?: number
  chapterNums: number[]
}

export interface VolumeQualityMetrics {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  analyzedChapterCount: number
  healthScore: number
  averageAiLikeRate: number
  averageOverallScore: number
  worseningMetricCount: number
  stalledArcCount: number
  criticalArcAlertCount: number
  rhythmBalanceScore: number
  repeatedFunctionRunCount: number
  foreshadowPendingCount: number
  foreshadowDueSoonCount: number
  foreshadowOverdueCount: number
  foreshadowResolvedCount: number
  staleRecallCount: number
  staleRecallRate: number
  worldWarningCount: number
  worldConflictAlertCount: number
  topRisks: QualityDashboardRiskItem[]
}

export interface NovelQualityMetrics {
  healthScore: number
  totalVolumeCount: number
  totalChapterCount: number
  analyzedChapterCount: number
  criticalRiskCount: number
  warningRiskCount: number
  foreshadowPendingCount: number
  foreshadowDueSoonCount: number
  foreshadowOverdueCount: number
  riskOverview: Array<{
    kind: QualityDashboardRiskKind
    label: string
    count: number
  }>
  topRisks: QualityDashboardRiskItem[]
  recommendedFocusVolumes: Array<{
    volumeId: number
    volumeNumber: number
    volumeName: string
    healthScore: number
    summary: string
  }>
}

export interface ChapterFunctionDetail {
  primaryTag?: ChapterFunctionTag
  tags: ChapterFunctionTag[]
  repeatedFunctionRunLength: number
  repeatedFunctionRange?: ChapterFunctionRun
  keyChapterRisk?: 'weak_primary' | 'missing_primary'
}

export interface AIScoreResult {
  dimensions: AIScoreDimension[]
  ai_like_rate: number
  repetition_risk: '低' | '中' | '高'
  overall_score: number
  overall_feedback: string
  top_fixes: string[]
  weak_dimensions?: string[]
  language_drift_metrics?: LanguageDriftMetrics
}

export interface QualityDashboardData {
  heatmapData: Array<{ chapterNum: number; dimension: string; score: number }>
  overallScoreTrend: Array<{ chapterNum: number; score: number }>
  aiLikeRateTrend: Array<{ chapterNum: number; rate: number }>
  languageDriftTrends: {
    abstractTokenDensity: Array<{ chapterNum: number; value: number }>
    sentencePatternRepeatRate: Array<{ chapterNum: number; value: number }>
    endingSummaryRate: Array<{ chapterNum: number; value: number }>
    ornamentOverloadRate: Array<{ chapterNum: number; value: number }>
    nonHumanCollocationRate: Array<{ chapterNum: number; value: number }>
  }
  averageLanguageDrift: LanguageDriftMetrics
  recentLanguageDriftAlerts: LanguageDriftTrendSummary[]
  volumeLanguageDrift: VolumeLanguageDriftEntry[]
  novelLanguageDriftSummary: NovelLanguageDriftSummary
  dialogueFingerprintStats: DialogueFingerprintStats
  characterDialogueSignatures: CharacterDialogueSignature[]
  crossCharacterDialogueSimilarity: CrossCharacterDialogueSimilarity[]
  dialogueDriftTrend: CharacterDialogueDriftEntry[]
  volumeDialogueSimilarity: VolumeDialogueSimilarityEntry[]
  recentDialogueAlerts: DialogueAlert[]
  storyDynamicsTrend: StoryDynamicsTrendPoint[]
  storyPacingAlerts: StoryDynamicsAlert[]
  volumeStoryDynamics: VolumeStoryDynamicsEntry[]
  volumeQualityMetrics: VolumeQualityMetrics[]
  novelQualityMetrics: NovelQualityMetrics
  chapterFunctionSummary: ChapterFunctionSummary
  repeatedFunctionRuns: ChapterFunctionRun[]
  chapterFunctionAlerts: ChapterFunctionAlert[]
  volumeChapterFunctions: VolumeChapterFunctionEntry[]
  storyArcProgressSummary: {
    trackedArcCount: number
    coveredChapterCount: number
    progressChapterCount: number
    stalledChapterCount: number
    stalledArcCount: number
    criticalAlertCount: number
  }
  storyArcProgressTrend: Array<{
    chapterNum: number
    activeArcCount: number
    progressCount: number
    stalledCount: number
  }>
  storyArcProgressArcs: StoryArcProgressSummary[]
  storyArcProgressAlerts: StoryArcProgressAlert[]
  storyArcProgressVolumes: VolumeArcProgressEntry[]
  worldStateTrend: WorldStateTrendPoint[]
  recentWorldStateAlerts: WorldStateAlert[]
  worldConflictEntities: WorldStateLedgerConflictEntity[]
  recallSummary: {
    analyzedChapterCount: number
    recallDependencyRate: number
    staleRecallCount: number
    staleRecallRate: number
    fallbackHitCount: number
    selectedHitCount: number
  }
  recentRecallAlerts: Array<{
    chapterId: number
    chapterNum: number
    title: string
    staleRecallCount: number
    detail: string
  }>
  volumeRecallDiagnostics: Array<{
    volumeId: number
    volumeNumber: number
    volumeName: string
    chapterStart: number
    chapterEnd: number
    chapterCount: number
    recallDependencyRate: number
    staleRecallCount: number
    staleRecallRate: number
  }>
  volumeWorldStateStability: Array<{
    volumeId: number
    volumeNumber: number
    volumeName: string
    chapterStart: number
    chapterEnd: number
    chapterCount: number
    driftAlertCount: number
    conflictAlertCount: number
    warningCount: number
  }>
  worldStateSummary: WorldStateLedgerOverview
  protagonistSetbackSummary: ProtagonistSetbackSummary
  costPersistenceSummary: CostPersistenceSummary
  reversalDistributionSummary: ReversalDistributionSummary
  weakDimensionFrequency: Array<{ dimension: string; count: number }>
  chapterDetails: Array<{
    chapterId: number
    chapterNum: number
    title: string
    volumeId?: number
    overallScore: number
    aiLikeRate: number
    weakDimensions: string[]
    dimensions: AIScoreDimension[]
    languageDriftMetrics?: LanguageDriftMetrics
    dialogueReview?: ChapterDialogueReviewData
    storyDynamics?: ChapterStoryDynamics
    chapterFunction?: ChapterFunctionDetail
    storyArcProgress?: StoryArcProgressPoint[]
    worldStateAlerts?: WorldStateAlert[]
    recallDiagnostics?: RecallDiagnostics
  }>
  totalChaptersScored: number
  averageOverallScore: number
  averageAiLikeRate: number
}

export interface StyleFingerprint {
  avgSentenceLength: number
  sentencePatterns: string[]
  wordFrequencyProfile: Record<string, string[]>
  narrativeTechniques: string
  dialogueStyle: string
  descriptionDensity: string
  paceProfile: string
  toneKeywords: string[]
  forbiddenPatterns: string[]
  exampleExcerpts: string[]
}

export interface StyleFingerprintRecord {
  id: number
  novelId: number | null
  name: string
  sourceText: string | null
  fingerprintJson: string | null
  analysisModelId: string | null
  createdAt: string
  updatedAt: string
}

export interface DialogueTokenStat {
  token: string
  count: number
}

export interface CharacterDialogueFingerprint {
  sampleCount: number
  totalDialogueChars: number
  avgSentenceLength: number
  sentenceLengthVariance: number
  shortSentenceRate: number
  longSentenceRate: number
  questionRate: number
  exclamationRate: number
  interruptionRate: number
  ellipsisRate: number
  dashRate: number
  modalParticles: DialogueTokenStat[]
  catchphraseCandidates: DialogueTokenStat[]
  topTokens: DialogueTokenStat[]
  sentencePatterns: string[]
  recentSampleChapterNums: number[]
}

export interface CharacterDialogueSignature extends CharacterDialogueFingerprint {
  characterId: number
  characterName: string
  roleType: Character['roleType']
  sampleChapterStart?: number
  sampleChapterEnd?: number
  voiceProfile: string
  distinctiveHabits: string[]
  antiPatterns: string[]
  compareHints: string[]
}

export interface CharacterDialogueFingerprintRecord {
  id: number
  novelId: number
  characterId: number
  sampleChapterStart: number | null
  sampleChapterEnd: number | null
  sampleCount: number
  statsJson: string | null
  summaryJson: string | null
  analysisModelId: string | null
  createdAt: string
  updatedAt: string
}

export interface CrossCharacterDialogueSimilarity {
  characterAId: number
  characterAName: string
  characterBId: number
  characterBName: string
  similarity: number
  reasons: string[]
}

export type DialogueTrendStatus = 'stable' | 'worsening' | 'improving'

export interface CharacterDialogueDriftPoint {
  chapterNum: number
  value: number
}

export interface CharacterDialogueDriftEntry {
  characterId: number
  characterName: string
  recentDriftRate: number
  baselineWindowSize: number
  recentWindowSize: number
  reasons: string[]
  status: DialogueTrendStatus
  trend: CharacterDialogueDriftPoint[]
}

export interface DialogueFingerprintStats {
  analyzedCharacterCount: number
  eligibleCharacterCount: number
  chapterCount: number
  totalTurnCount: number
  attributedTurnCount: number
  unattributedTurnCount: number
  averageCrossCharacterSimilarity: number
  highSimilarityPairCount: number
  driftingCharacterCount: number
}

export interface VolumeDialogueSimilarityEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  averageSimilarity: number
  topPairs: CrossCharacterDialogueSimilarity[]
}

export interface DialogueAlert {
  kind: 'similarity' | 'drift'
  severity: 'info' | 'warning'
  title: string
  detail: string
  relatedCharacterIds: number[]
}

export interface DialogueSimilarityWarning {
  characterAId: number
  characterAName: string
  characterBId: number
  characterBName: string
  similarity: number
  reason: string
}

export interface DialogueDriftWarning {
  characterId: number
  characterName: string
  driftRate: number
  reason: string
}

export interface ChapterDialogueReviewData {
  fingerprintSummary?: string
  risks: string[]
  similarities: DialogueSimilarityWarning[]
  drifts: DialogueDriftWarning[]
}

export interface ParallelSegmentGroup {
  id: string
  label: string
  arcId: number
  arcName: string
  chapterRange: [number, number]
  primaryCharacterIds: number[]
  primaryCharacterNames: string[]
  threadIds: number[]
  isIndependent: boolean
}

export interface ParallelGenerationPlan {
  parallelGroups: ParallelSegmentGroup[][]
  sequentialSegments: ParallelSegmentGroup[]
  convergencePoints: number[]
  estimatedSpeedup: number
}

export interface ParallelMergeConflict {
  characterId: number
  characterName: string
  conflictType: 'state' | 'location' | 'relationship'
  description: string
  sourceSegments: string[]
}

export interface ParallelMergeResult {
  conflicts: ParallelMergeConflict[]
  mergedState: Record<string, unknown>
  success: boolean
}

// 扩展 window 类型
declare global {
  interface Window {
    electron: {
      novel: {
        list: (filters?: unknown) => Promise<Novel[]>
        get: (id: number) => Promise<Novel | null>
        create: (data: NovelCreateInput) => Promise<number>
        update: (id: number, data: Partial<Novel>) => Promise<void>
        delete: (id: number) => Promise<void>
        export: (id: number, format: string) => Promise<string>
        stats: (id: number) => Promise<{ totalChapters: number; completedChapters: number; totalWords: number; characterCount: number }>
        runConsistencyCheck: (id: number) => Promise<NovelConsistencyReport>
        getStoryMemory: (id: number) => Promise<StoryMemorySnapshot>
        getWorldStateSnapshot: (id: number, upToChapterNum?: number) => Promise<{ currentStates: WorldStateSummary[]; alerts: WorldStateAlert[]; worldStatesText: string; trendSummary: string[] }>
        getWorldStateLedgerSnapshot: (id: number, upToChapterNum?: number) => Promise<WorldStateLedgerSnapshot>
        getWorldStateHistory: (novelId: number, entityType: WorldStateEntityType, entityId: number, stateKey?: string, limit?: number) => Promise<WorldStateVersion[]>
        getContextStatus: (id: number) => Promise<NovelContextStatus>
      }
      structure: {
        getTree: (novelId: number) => Promise<StoryStructureTree>
        listVolumes: (novelId: number) => Promise<StoryStructureVolumeSummary[]>
        listPartsPage: (volumeId: number, page?: number, pageSize?: number) => Promise<PagedResult<StoryStructurePartSummary>>
        listChaptersPage: (partId: number, page?: number, pageSize?: number) => Promise<PagedResult<StoryStructureChapterSummary>>
        listSegments: (chapterId: number) => Promise<ChapterSegment[]>
        getSegment: (id: number) => Promise<ChapterSegment | null>
        listSegmentsPage: (chapterId: number, page?: number, pageSize?: number) => Promise<PagedResult<StoryStructureSegmentSummary>>
        listCheckpoints: (novelId: number) => Promise<StoryMemoryCheckpoint[]>
        listCheckpointsPage: (filters: StoryCheckpointListFilters, page?: number, pageSize?: number) => Promise<PagedResult<StoryMemoryCheckpoint>>
        listLinkedTimelineEvents: (filters: TimelineAnchorFilters) => Promise<TimelineEvent[]>
        listLinkedTimelineEventsPage: (filters: TimelineAnchorFilters, page?: number, pageSize?: number) => Promise<PagedResult<TimelineEvent>>
        resolvePath: (filters: TimelineAnchorFilters) => Promise<StructurePathResolution>
        createVolume: (novelId: number, data: Partial<StoryVolume>) => Promise<number>
        updateVolume: (id: number, data: Partial<StoryVolume>) => Promise<void>
        deleteVolume: (id: number) => Promise<void>
        reorderVolumes: (novelId: number, orderedIds: number[]) => Promise<void>
        createPart: (volumeId: number, data: Partial<StoryPart>) => Promise<number>
        updatePart: (id: number, data: Partial<StoryPart>) => Promise<void>
        deletePart: (id: number) => Promise<void>
        reorderParts: (novelId: number, operations: StoryPartReorderOperation[]) => Promise<void>
        reorderPartsInVolume: (volumeId: number, orderedIds: number[]) => Promise<void>
        assignChapter: (chapterId: number, partId: number) => Promise<void>
        createSegment: (chapterId: number, data: Partial<ChapterSegment>) => Promise<number>
        updateSegment: (id: number, data: Partial<ChapterSegment>) => Promise<void>
        deleteSegment: (id: number) => Promise<void>
        reorderSegments: (chapterId: number, orderedIds: number[]) => Promise<void>
        compileChapter: (chapterId: number) => Promise<Chapter | null>
        refreshCheckpoints: (novelId: number) => Promise<StoryMemoryCheckpoint[]>
        applyBatchPlan: (novelId: number, plan: StructureBatchPlan) => Promise<StructureBatchApplyResult>
        previewBatchEdit: (novelId: number, operations: StructureBatchEditOperation[]) => Promise<StructureBatchPreview>
        applyBatchEdit: (novelId: number, operations: StructureBatchEditOperation[]) => Promise<StructureBatchApplyResult>
      }
      chapter: {
        list: (novelId: number) => Promise<Chapter[]>
        get: (id: number) => Promise<Chapter | null>
        create: (novelId: number, data: Partial<Chapter>) => Promise<number>
        update: (id: number, data: Partial<Chapter>, options?: ChapterUpdateOptions) => Promise<void>
        delete: (id: number) => Promise<void>
        listVersions: (chapterId: number) => Promise<ChapterVersion[]>
        restoreVersion: (versionId: number) => Promise<Chapter | null>
        batchUpdate: (ids: number[], data: Partial<Pick<Chapter, 'status' | 'arcId'>>) => Promise<number>
        batchDelete: (ids: number[]) => Promise<number>
        batchRenumber: (ids: number[], startChapterNum: number) => Promise<number>
        getContextPreview: (chapterId: number) => Promise<ChapterContextPreview>
        generateContent: (chapterId: number) => Promise<number>
        generateSummary: (chapterId: number) => Promise<void>
        aiCheck: (chapterId: number) => Promise<unknown>
        runPublishCheck: (chapterId: number) => Promise<ChapterPublishCheck>
      }
      character: {
        list: (novelId: number) => Promise<Character[]>
        query: (filters: CharacterQueryInput) => Promise<PagedResult<Character>>
        getStats: (filters: CharacterQueryInput) => Promise<CharacterStats>
        getFilterOptions: (novelId: number) => Promise<CharacterFilterOptions>
        get: (id: number) => Promise<Character | null>
        search: (novelId: number, keyword?: string, limit?: number) => Promise<Character[]>
        getGraph: (filters: CharacterGraphQueryInput) => Promise<CharacterGraphPayload>
        getDetailContext: (characterId: number) => Promise<CharacterDetailContext>
        create: (novelId: number, data: Partial<Character>) => Promise<number>
        update: (id: number, data: Partial<Character>) => Promise<void>
        delete: (id: number) => Promise<void>
        regenerate: (id: number) => Promise<Character | null>
        batchGenerate: (novelId: number, opts: CharacterBatchGenerationOptions) => Promise<number[]>
        startAutoGenerate: (novelId: number, opts: CharacterBatchGenerationOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<CharacterAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        generateProtagonist: (novelId: number, opts: CharacterGenerationOptions) => Promise<number>
        getRelations: (novelId: number) => Promise<CharacterRelation[]>
        generateRelations: (novelId: number) => Promise<void>
        upsertRelation: (data: CharacterRelationInput) => Promise<void>
        clear: (novelId: number) => Promise<void>
      }
      map: {
        getTree: (novelId: number) => Promise<WorldMapItem[]>
        queryNodes: (filters: MapQueryInput) => Promise<PagedResult<MapNodeSummary>>
        getGraph: (filters: MapGraphQueryInput) => Promise<MapGraphPayload>
        getRelations: (novelId: number, focusNodeId?: number) => Promise<MapRelation[]>
        getStats: (novelId: number) => Promise<MapStats>
        getNode: (id: number) => Promise<MapNodeSummary | null>
        searchNodes: (novelId: number, keyword?: string, limit?: number) => Promise<MapNodeSummary[]>
        create: (novelId: number, data: unknown) => Promise<number>
        update: (id: number, data: unknown) => Promise<void>
        upsertRelation: (data: MapRelationInput) => Promise<void>
        deleteRelation: (id: number) => Promise<void>
        delete: (id: number) => Promise<void>
        batchGenerate: (novelId: number, structure: MapBatchGenerateOptions) => Promise<MapBatchGenerationResult>
        startAutoGenerate: (novelId: number, structure: MapBatchGenerateOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<MapAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        clear: (novelId: number) => Promise<void>
      }
      worldRules: {
        startAutoGenerate: (novelId: number, options: WorldRulesAutoGenerateOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<WorldRulesAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number, currentRules?: GenreWorldRules) => Promise<number>
        clearAutoGenerateDraft: (novelId: number) => Promise<void>
      }
      timeline: {
        list: (novelId: number) => Promise<TimelineEvent[]>
        query: (filters: TimelineQueryInput) => Promise<PagedResult<TimelineEvent>>
        search: (novelId: number, keyword?: string, limit?: number) => Promise<TimelineEvent[]>
        getStats: (filters: { novelId: number; status?: TimelineEvent['status']; eventType?: string; volumeId?: number; partId?: number; chapterId?: number; segmentId?: number }) => Promise<TimelineStats>
        getFilterOptions: (novelId: number) => Promise<TimelineFilterOptions>
        get: (id: number) => Promise<TimelineEvent | null>
        create: (novelId: number, data: Partial<TimelineEvent>) => Promise<number>
        update: (id: number, data: Partial<TimelineEvent>) => Promise<void>
        delete: (id: number) => Promise<void>
        batchUpdate: (ids: number[], data: Partial<Pick<TimelineEvent, 'status' | 'isMajorEvent'>>) => Promise<number>
        batchDelete: (ids: number[]) => Promise<number>
        generate: (novelId: number, options?: TimelineGenerateOptions) => Promise<number[]>
        startAutoGenerate: (novelId: number, options?: TimelineGenerateOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<TimelineAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        regenerate: (id: number, options?: EntityRegenerateOptions) => Promise<TimelineEvent | null>
        clear: (novelId: number) => Promise<void>
      }
      item: {
        list: (novelId: number) => Promise<StoryItem[]>
        query: (filters: StoryItemQueryInput) => Promise<PagedResult<StoryItem>>
        getStats: (filters: StoryItemQueryInput) => Promise<StoryItemStats>
        getFilterOptions: (novelId: number) => Promise<StoryItemFilterOptions>
        get: (id: number) => Promise<StoryItem | null>
        getDetailContext: (id: number) => Promise<StoryItemDetailContext>
        search: (novelId: number, keyword?: string, itemKind?: StoryItem['itemKind'], limit?: number) => Promise<StoryItem[]>
        create: (novelId: number, data: Partial<StoryItem>) => Promise<number>
        update: (id: number, data: Partial<StoryItem>) => Promise<void>
        delete: (id: number) => Promise<void>
        generate: (novelId: number, options?: StoryItemGenerateOptions) => Promise<number[]>
        startAutoGenerate: (novelId: number, options?: StoryItemGenerateOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<ItemAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        regenerate: (id: number, options?: EntityRegenerateOptions) => Promise<StoryItem | null>
        clear: (novelId: number) => Promise<void>
      }
      outline: {
        getArcs: (novelId: number) => Promise<StoryArc[]>
        getArcProgressSnapshot: (novelId: number) => Promise<StoryArcProgressSnapshot>
        createArc: (novelId: number, data: unknown) => Promise<number>
        updateArc: (id: number, data: unknown) => Promise<void>
        deleteArc: (id: number) => Promise<void>
        generateArcs: (novelId: number) => Promise<StoryArc[]>
        generateChapterOutlines: (arcId: number, options?: OutlineChapterBatchGenerateOptions) => Promise<OutlineChapterBatchGenerationResult>
        clear: (novelId: number) => Promise<void>
      }
      thread: {
        list: (novelId: number) => Promise<StoryThread[]>
        query: (filters: StoryThreadQueryInput) => Promise<PagedResult<StoryThread>>
        getStats: (filters: StoryThreadQueryInput) => Promise<StoryThreadStats>
        get: (id: number) => Promise<StoryThread | null>
        getForeshadowSnapshot: (novelId: number, chapterNum?: number) => Promise<ForeshadowSnapshot>
        generate: (novelId: number, options?: StoryThreadBatchGenerateOptions) => Promise<StoryThreadBatchGenerationResult>
        startAutoGenerate: (novelId: number, options?: StoryThreadBatchGenerateOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<StoryThreadAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        create: (novelId: number, data: Partial<StoryThread>) => Promise<number>
        update: (id: number, data: Partial<StoryThread>) => Promise<void>
        delete: (id: number) => Promise<void>
        batchUpdate: (ids: number[], data: Partial<Pick<StoryThread, 'status' | 'priority'>>) => Promise<number>
        batchDelete: (ids: number[]) => Promise<number>
        regenerate: (id: number, options?: EntityRegenerateOptions) => Promise<StoryThread | null>
      }
      faction: {
        list: (novelId: number) => Promise<Faction[]>
        query: (filters: FactionQueryInput) => Promise<PagedResult<Faction>>
        getStats: (filters: { novelId: number }) => Promise<FactionStats>
        get: (id: number) => Promise<Faction | null>
        search: (novelId: number, keyword?: string, limit?: number) => Promise<Faction[]>
        getGraph: (filters: FactionGraphQueryInput) => Promise<FactionGraphPayload>
        create: (novelId: number, data: Partial<Faction>) => Promise<number>
        update: (id: number, data: Partial<Faction>) => Promise<void>
        delete: (id: number) => Promise<void>
        batchGenerate: (novelId: number, opts: FactionBatchGenerationOptions) => Promise<number[]>
        startAutoGenerate: (novelId: number, opts: FactionBatchGenerationOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<FactionAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        resolveNameOptions: (novelId: number) => Promise<string[]>
      }
      glossary: {
        list: (novelId: number) => Promise<GlossaryEntry[]>
        query: (filters: GlossaryQueryInput) => Promise<PagedResult<GlossaryEntry>>
        getStats: (filters: { novelId: number }) => Promise<GlossaryStats>
        get: (id: number) => Promise<GlossaryEntry | null>
        search: (novelId: number, keyword?: string, limit?: number) => Promise<GlossaryEntry[]>
        create: (novelId: number, data: Partial<GlossaryEntry>) => Promise<number>
        update: (id: number, data: Partial<GlossaryEntry>) => Promise<void>
        delete: (id: number) => Promise<void>
      }
      sceneTemplate: {
        list: (filters: { novelId?: number; genreId?: number }) => Promise<SceneTemplate[]>
        query: (filters: SceneTemplateQueryInput) => Promise<PagedResult<SceneTemplate>>
        getStats: (filters: { novelId?: number; genreId?: number }) => Promise<SceneTemplateStats>
        get: (id: number) => Promise<SceneTemplate | null>
        search: (novelId: number, genreId?: number, keyword?: string, limit?: number) => Promise<SceneTemplate[]>
        create: (data: Partial<SceneTemplate>) => Promise<number>
        update: (id: number, data: Partial<SceneTemplate>) => Promise<void>
        delete: (id: number) => Promise<void>
      }
      subplot: {
        generate: (request: SubplotAutoGenerateRequest) => Promise<SubPlotDraft[]>
        startAutoGenerate: (request: SubplotAutoGenerateRequest) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<SubplotAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
      }
      history: {
        listRecent: (novelId: number, limit?: number) => Promise<OperationLog[]>
        getLatestUndoable: (novelId: number) => Promise<OperationLog | null>
        undo: (logId: number) => Promise<OperationLog | null>
      }
      revision: {
        list: (novelId: number) => Promise<RevisionTask[]>
        query: (filters: RevisionTaskQueryInput) => Promise<PagedResult<RevisionTask>>
        getStats: (filters: RevisionTaskQueryInput) => Promise<RevisionTaskStats>
        getSnapshot: (novelId: number) => Promise<RevisionCenterSnapshot>
        get: (id: number) => Promise<RevisionTask | null>
        create: (novelId: number, data: Partial<RevisionTask>) => Promise<number>
        update: (id: number, data: Partial<RevisionTask>) => Promise<void>
        delete: (id: number) => Promise<void>
        autoFix: (id: number) => Promise<RevisionAutoFixResult>
      }
      model: {
        list: () => Promise<ModelConfig[]>
        create: (data: Partial<ModelConfig>) => Promise<number>
        update: (id: number, data: Partial<ModelConfig>) => Promise<void>
        delete: (id: number) => Promise<void>
        setDefault: (id: number) => Promise<void>
        test: (id: number) => Promise<{ success: boolean; latency: number; info: string }>
      }
      template: {
        list: (type?: string) => Promise<Template[]>
        create: (data: Partial<Template>) => Promise<number>
        update: (id: number, data: Partial<Template>) => Promise<void>
        delete: (id: number) => Promise<void>
      }
      prompt: {
        list: () => Promise<PromptOverride[]>
        save: (key: string, content: string) => Promise<void>
        delete: (key: string) => Promise<void>
      }
      task: {
        list: (novelId?: number) => Promise<Task[]>
        query: (filters: TaskQueryInput) => Promise<PagedResult<Task>>
        getStats: (novelId?: number) => Promise<TaskStats>
        clearHistory: (filters?: TaskHistoryClearInput) => Promise<TaskHistoryClearResult>
        get: (id: number) => Promise<Task | null>
        cancel: (id: number) => Promise<boolean>
        retry: (id: number) => Promise<number>
      }
      workflow: {
        list: (novelId?: number) => Promise<Task[]>
        get: (id: number) => Promise<Task | null>
        cancel: (id: number) => Promise<boolean>
        resume: (id: number) => Promise<number>
      }
      premiseDraft: {
        getLatest: (novelId: number) => Promise<PremiseDraftRecord | null>
        markApplied: (taskId: number, appliedMode: PremiseGenerationMode) => Promise<void>
        clearAll: (novelId: number) => Promise<void>
      }
      planningDraft: {
        getLatest: (novelId: number, pageKey: PlanningDraftPageKey) => Promise<PlanningDraftRecord | null>
        save: (data: {
          novelId: number
          pageKey: PlanningDraftPageKey
          data: Record<string, unknown>
          warnings?: string[]
          sourcePage?: string
          inputSummary?: string
          lintWarnings?: string[]
          rawOutputs?: string[]
          rejectionReason?: string
        }) => Promise<PlanningDraftRecord>
        markApplied: (taskId: number) => Promise<void>
        finalize: (taskId: number, finalData: Record<string, unknown>) => Promise<PlanningDraftRecord | null>
        clear: (novelId: number, pageKey: PlanningDraftPageKey) => Promise<void>
      }
      quality: {
        getDashboard: (novelId: number) => Promise<QualityDashboardData>
      }
      embedding: {
        reindex: (novelId: number) => Promise<{ reindexed: number }>
      }
      style: {
        analyze: (text: string, modelConfigId?: number) => Promise<StyleFingerprint>
        create: (novelId: number | null, name: string, text: string, modelConfigId?: number) => Promise<number>
        get: (id: number) => Promise<StyleFingerprintRecord | null>
        list: (novelId?: number) => Promise<StyleFingerprintRecord[]>
        delete: (id: number) => Promise<void>
      }
      parallel: {
        analyzePlan: (novelId: number, chapterStart: number, chapterEnd: number) => Promise<ParallelGenerationPlan>
        getWorldState: (novelId: number, atChapterNum: number) => Promise<Record<string, unknown>>
        mergeOutputs: (segments: unknown[]) => Promise<ParallelMergeResult>
      }
      ai: {
        expandBackground: (input: unknown) => Promise<{ expanded_background: string; titles: string[]; synopsis: string }>
        generateCoreSettings: (data: CoreSettingsGenerationRequest) => Promise<CoreSettingsGenerationResult>
        generatePremise: (data: PremiseGenerationRequest) => Promise<PremiseGenerationResult>
        generateProjectBrief: (data: ProjectBriefGenerationRequest) => Promise<ProjectBriefGenerationResult>
        generateThemeVoice: (data: ThemeVoiceGenerationRequest) => Promise<ThemeVoiceGenerationResult>
        generateWorldRules: (data: WorldRulesGenerationRequest) => Promise<WorldRulesGenerationResult>
        generateCharacter: (novelId: number, opts: CharacterGenerationOptions) => Promise<number>
        generateRelations: (novelId: number) => Promise<void>
        generateSubplotBatch: (data: SubplotGenerationRequest) => Promise<SubplotGenerationResult>
        rewriteParagraph: (data: unknown) => Promise<string>
        runPrompt: (data: { messages: unknown[]; count?: number; modelConfigId?: number }) => Promise<string[]>
        scoreContent: (data: {
          contentType: string
          content: string
          genreContext: string
          novelBackground: string
          modelConfigId?: number
        }) => Promise<AIScoreResult>
      }
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
      off: (channel: string, callback: (...args: unknown[]) => void) => void
    }
  }
}
