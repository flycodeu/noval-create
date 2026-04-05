import type { GenreWorldRules } from '../shared/genre-system'
import type {
  SubPlotDraft,
  SubplotGenerationRequest,
  SubplotGenerationResult,
} from '../shared/subplot-framework'
import type {
  CoreSettingsGenerationProgressEvent,
  CoreSettingsGenerationRequest,
  CoreSettingsGenerationResult,
} from '../shared/core-settings-generation'
import type {
  PremiseGenerationMode,
  PremiseGenerationProgressEvent,
  PremiseGenerationRequest,
  PremiseGenerationResult,
} from '../shared/premise-generation'
import type {
  ProjectBriefDocument,
  ProjectBriefSnapshot,
} from '../shared/project-brief'
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
  WorldRulesGenerationProgressEvent,
  WorldRulesGenerationRequest,
  WorldRulesGenerationResult,
} from '../shared/world-rules-generation'
import type {
  ThemeVoiceDocument,
  ThemeVoiceSnapshot,
} from '../shared/theme-voice'
import type {
  ThemeVoiceGenerationRequest,
  ThemeVoiceGenerationResult,
} from '../shared/theme-voice-generation'

export type {
  CoreSettingsGenerationProgressEvent,
  CoreSettingsGenerationRequest,
  CoreSettingsGenerationResult,
} from '../shared/core-settings-generation'
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
  styleTemplateId?: number
  worldTemplateId?: number
  contextVersion?: number
  modelConfigId?: number
  createdAt: string
  updatedAt: string
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
  targetWords?: number
  progressPercent?: number
  stalledChapterCount?: number
  lastProgressChapterNum?: number
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
  category: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'outline' | 'continuity' | 'thread' | 'voice' | 'relation'
  title: string
  description: string
  suggestion: string
  entityType?: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'arc' | 'thread'
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
  }
  issues: ConsistencyIssue[]
}

export interface StoryMemorySnapshot {
  generatedAt: string
  chapterCount: number
  lastChapterNum: number
  memoryMode: 'standard' | 'longform' | 'epic'
  coverageSummary: string
  phaseDigest: string[]
  plotMilestones: string[]
  arcSignals: string[]
  characterLedger: string[]
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

export interface AIScoreResult {
  dimensions: AIScoreDimension[]
  ai_like_rate: number
  repetition_risk: '低' | '中' | '高'
  overall_score: number
  overall_feedback: string
  top_fixes: string[]
  weak_dimensions?: string[]
}

export interface QualityDashboardData {
  heatmapData: Array<{ chapterNum: number; dimension: string; score: number }>
  overallScoreTrend: Array<{ chapterNum: number; score: number }>
  aiLikeRateTrend: Array<{ chapterNum: number; rate: number }>
  weakDimensionFrequency: Array<{ dimension: string; count: number }>
  chapterDetails: Array<{
    chapterId: number
    chapterNum: number
    title: string
    overallScore: number
    aiLikeRate: number
    weakDimensions: string[]
    dimensions: AIScoreDimension[]
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
        create: (data: Partial<Novel>) => Promise<number>
        update: (id: number, data: Partial<Novel>) => Promise<void>
        delete: (id: number) => Promise<void>
        export: (id: number, format: string) => Promise<string>
        stats: (id: number) => Promise<{ totalChapters: number; completedChapters: number; totalWords: number; characterCount: number }>
        runConsistencyCheck: (id: number) => Promise<NovelConsistencyReport>
        getStoryMemory: (id: number) => Promise<StoryMemorySnapshot>
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
