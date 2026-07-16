import type { GenreWorldRules } from '../shared/genre-system'
import type { NovelOperatingMode } from '../shared/operating-mode'
import type { QualityAgentDashboardSnapshot } from '../shared/quality-agent-dashboard'
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
import type {
  AiExecutionMode,
  AiTaskKind,
} from '../shared/ai-execution'
import type {
  AgentToolCallRequest,
  AgentToolCallResult,
  AgentToolApprovalRequest,
  AgentToolApprovalResult,
  AgentToolDescriptor,
  AgentToolListQuery,
} from '../shared/tool-contracts'

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
  AiExecutionMode,
  AiTaskKind,
} from '../shared/ai-execution'
export type {
  AgentToolCallContext,
  AgentToolCallMeta,
  AgentToolCallRequest,
  AgentToolCallResult,
  AgentToolDescriptor,
  AgentToolEffect,
  AgentToolErrorPayload,
  AgentToolListQuery,
} from '../shared/tool-contracts'
export type {
  ThemeVoiceGenerationRequest,
  ThemeVoiceGenerationResult,
} from '../shared/theme-voice-generation'

export interface NovelSourceCanonFields {
  historicalProfileJson?: string
  sourceLedgerJson?: string
  chapterSourceUsageJson?: string
  factProvenanceJson?: string
  projectCanonProfileJson?: string
  canonConstraintSetJson?: string
  canonSourceLedgerJson?: string
  canonFactCardsJson?: string
}

export type SourceVerificationStatus =
  | 'pending'
  | 'web_found'
  | 'user_confirmed'
  | 'conflicted'
  | 'rejected'

export interface WebGroundingSourceEntry {
  sourceKey: string
  chapterId?: number
  chapterNum?: number
  assetType?: string
  sourceType?: 'web_search' | 'user_document' | 'writeback' | string
  provider?: string
  query?: string
  sourceUrl?: string
  factTitle?: string
  sourceText?: string
  confidence?: number
  verificationStatus?: SourceVerificationStatus | string
  publishedAt?: string
  recordedAt?: string
}

export interface CanonFactCardEntry {
  cardKey: string
  assetType?: string
  entityType?: string
  entityId?: number | null
  title: string
  summary?: string
  sourceTexts?: string[]
  sourceKeys?: string[]
  confidence?: number
  verificationStatus?: SourceVerificationStatus | string
  canonDecision?: string
  updatedAt?: string
}

export interface Novel extends NovelSourceCanonFields {
  id: number
  title: string
  synopsis?: string
  genreId?: number
  launchMode?: NovelLaunchMode
  operatingMode?: NovelOperatingMode
  genreName?: string
  genreColorTag?: string
  status: 'draft' | 'writing' | 'completed' | 'archived'
  lifecycleMode?: 'automatic' | 'manual'
  lifecycle?: {
    status: 'draft' | 'writing' | 'completed' | 'archived'
    label: string
    automatic: boolean
    reason: string
  }
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

export type NovelLaunchMode = 'professional_longform' | 'fast_launch'

export interface NovelCreateInput extends NovelSourceCanonFields {
  title: string
  synopsis?: string
  genreId?: number
  launchMode?: NovelLaunchMode
  operatingMode?: NovelOperatingMode
  userBackground?: string
  expandedBackground?: string
  projectBriefJson?: string
  settingsJson?: string
  themeVoiceJson?: string
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
  bridgePlanJson?: string
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
  allowedFactIdsJson?: string
  revealedFactIdsJson?: string
  contractAuditJson?: string
  summaryHealthJson?: string
  expressionDedupJson?: string
  hookContinuityJson?: string
  writebackStatusJson?: string
  createdAt: string
  updatedAt: string
}

export interface ChapterBridgePlan {
  sourceChapterId?: number
  sourceChapterNum?: number
  locationTransition: string
  timeJump: string
  emotionCarry: string
  openingMove: string
  endingEcho?: string
  firstSceneConstraint: string
  allowedPov: string
  infoGapGuard: string
  bridgeWarnings: string[]
  createdAt?: string
}

export interface PovRotationPlan {
  recommendedPov: string
  previousPov?: string
  reason: string
  infoGapGuard: string
  shouldRotate: boolean
  warnings: string[]
}

export interface HookContinuitySnapshot {
  hookType: string
  hookStrengthScore: number
  unresolvedHookChain: string[]
  weakHookStreak: number
  recentHookTypes: string[]
  warning?: string
  updatedAt?: string
}

export interface StoryPacingCurve {
  label: string
  targetMarker: string
  actualMarker?: string
  shouldBreather: boolean
  shouldEscalate: boolean
  recentClimaxSpacing: number[]
  warning?: string
  guidance: string
  updatedAt?: string
}

export interface ExpressionDedupHit {
  phrase: string
  count: number
  chapterNums: number[]
}

export type ExpressionDedupMode = 'short' | 'longform'

export interface ExpressionDedupReport {
  mode: ExpressionDedupMode
  recentWindowSize: number
  volumeWindowSize: number
  globalSampleWindowSize: number
  riskLevel: 'low' | 'medium' | 'high'
  repeatedPhrases: ExpressionDedupHit[]
  repeatedOpenings: string[]
  repeatedClosings: string[]
  repeatedStructuralPatterns: string[]
  repeatedClimaxPatterns: string[]
  volumeRepeatedPatterns: string[]
  globalRepeatedPatterns: string[]
  bannedExpressions: string[]
  guidance: string[]
  summary: string
  updatedAt?: string
}

export interface SummaryHealthReport {
  status: 'healthy' | 'warning' | 'degraded'
  densityScore: number
  entityCoverageScore: number
  eventCoverageScore: number
  recentWindowSize: number
  warnings: string[]
  triggeredRecompression: boolean
  recompressionReason?: string
  recompressionMode?: 'deterministic' | 'semantic'
  semanticSummary?: {
    chapterFacts: string
    characterStates: string
    threadForeshadow: string
  }
  focusEntities: string[]
  summaryPreview?: string
  updatedAt?: string
}

export interface VoiceEvolutionProfile {
  characterId: number
  characterName: string
  stageLabel: string
  allowedChanges: string[]
  stableAnchors: string[]
  riskyChanges: string[]
  summary: string
}

export interface WritebackSyncStatus {
  phase: 'idle' | 'preparing' | 'ready' | 'applying' | 'applied' | 'failed'
  runId?: number
  retryCount: number
  lastError?: string
  /** 候选事实/差异已经生成，但不代表已经写入正典。 */
  candidateReady: boolean
  /** 当前回写运行中的已确认项已经成功应用到正典。 */
  canonApplied: boolean
  blockedGeneration: boolean
  /** 兼容旧 UI 的派生字段，等价于 canonApplied && !blockedGeneration。 */
  readyForNextChapter: boolean
  contextVersion?: number
  lastAttemptAt?: string
  updatedAt?: string
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

export type CharacterArcStatus = 'draft' | 'active' | 'stalled' | 'completed'

export type CharacterArcBeatType = 'start' | 'crack' | 'turn' | 'change' | 'end' | 'progress-note'

export interface CharacterArcBeat {
  id?: number
  novelId: number
  arcId: number
  beatType: CharacterArcBeatType
  chapterId?: number
  chapterNum?: number
  chapterLabel?: string
  timelineEventId?: number
  timelineEventLabel?: string
  title: string
  summary: string
  status: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CharacterArc {
  id?: number
  novelId: number
  characterId: number
  characterName: string
  roleType?: Character['roleType']
  startState: string
  surfaceWant: string
  deepNeed: string
  coreFear: string
  misbelief: string
  firstCrackChapterId?: number
  firstCrackChapterNum?: number
  firstCrackChapterLabel?: string
  changeEvent: string
  changeTimelineEventId?: number
  changeTimelineEventLabel?: string
  endState: string
  currentStatus: CharacterArcStatus
  lastProgressChapterId?: number
  lastProgressChapterNum?: number
  lastProgressChapterLabel?: string
  stalledReason: string
  notes: string
  beatCount: number
  latestBeatSummary?: string
  createdAt: string
  updatedAt: string
  beats: CharacterArcBeat[]
}

export interface RelationshipArc {
  id?: number
  novelId: number
  charAId: number
  charBId: number
  charAName: string
  charBName: string
  relationLabelSnapshot: string
  relationTypeSnapshot?: string
  startState: string
  crackPoint: string
  changeEvent: string
  changeTimelineEventId?: number
  changeTimelineEventLabel?: string
  endState: string
  currentStatus: CharacterArcStatus
  lastProgressChapterId?: number
  lastProgressChapterNum?: number
  lastProgressChapterLabel?: string
  stalledReason: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CharacterArcDashboard {
  protagonistArc: CharacterArc | null
  characterArcs: CharacterArc[]
  relationshipArcs: RelationshipArc[]
  availableCharacters: Character[]
  availableRelations: CharacterRelation[]
  chapters: Array<{ id: number; chapterNum: number; title: string }>
  timelineEvents: Array<{ id: number; eventTitle: string; timeLabel: string; chapterStartId?: number; chapterEndId?: number }>
  stalledCharacterCount: number
  stalledRelationshipCount: number
}

export interface CharacterArcInput {
  id?: number
  novelId: number
  characterId: number
  startState?: string
  surfaceWant?: string
  deepNeed?: string
  coreFear?: string
  misbelief?: string
  firstCrackChapterId?: number
  changeEvent?: string
  changeTimelineEventId?: number
  endState?: string
  currentStatus?: CharacterArcStatus
  lastProgressChapterId?: number
  stalledReason?: string
  notes?: string
}

export interface CharacterArcBeatInput {
  id?: number
  novelId: number
  arcId: number
  beatType?: CharacterArcBeatType
  chapterId?: number
  timelineEventId?: number
  title?: string
  summary?: string
  status?: string
  sortOrder?: number
}

export interface RelationshipArcInput {
  id?: number
  novelId: number
  charAId: number
  charBId: number
  relationLabelSnapshot?: string
  relationTypeSnapshot?: string
  startState?: string
  crackPoint?: string
  changeEvent?: string
  changeTimelineEventId?: number
  endState?: string
  currentStatus?: CharacterArcStatus
  lastProgressChapterId?: number
  stalledReason?: string
  notes?: string
}

export type ResistanceSourceType = 'character' | 'faction' | 'environment' | 'institution'

export type ResistanceKind = 'antagonist' | 'faction' | 'environment' | 'institution'

export type ResistanceTrackStatus = 'draft' | 'active' | 'stalled' | 'contained' | 'resolved'

export type ResistanceBeatType = 'setup' | 'strike' | 'victory' | 'setback' | 'escalation' | 'counter' | 'status-note'

export interface ResistanceBeat {
  id?: number
  novelId: number
  trackId: number
  beatType: ResistanceBeatType
  chapterId?: number
  chapterNum?: number
  chapterLabel?: string
  timelineEventId?: number
  timelineEventLabel?: string
  title: string
  summary: string
  actionMode: string
  successLevel: string
  counterResponse: string
  protagonistImpact: string
  status: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ResistanceTrack {
  id?: number
  novelId: number
  sourceType: ResistanceSourceType
  sourceId?: number
  sourceName: string
  resistanceKind: ResistanceKind
  title: string
  goal: string
  intelSource: string
  resourcePool: string
  escalationPlan: string
  heroKnowledgeShift: string
  stageVictory: string
  counterMove: string
  currentPressureMode: string
  currentStatus: ResistanceTrackStatus
  lastActionChapterId?: number
  lastActionChapterNum?: number
  lastActionChapterLabel?: string
  nextEscalationChapterId?: number
  nextEscalationChapterNum?: number
  nextEscalationChapterLabel?: string
  linkedVolumeId?: number
  linkedVolumeLabel?: string
  notes: string
  beatCount: number
  latestBeatSummary?: string
  createdAt: string
  updatedAt: string
  beats: ResistanceBeat[]
}

export interface ResistanceDashboard {
  tracks: ResistanceTrack[]
  characterTracks: ResistanceTrack[]
  factionTracks: ResistanceTrack[]
  environmentTracks: ResistanceTrack[]
  institutionTracks: ResistanceTrack[]
  availableCharacters: Character[]
  availableFactions: Faction[]
  chapters: Array<{ id: number; chapterNum: number; title: string }>
  timelineEvents: Array<{ id: number; eventTitle: string; timeLabel: string; chapterStartId?: number; chapterEndId?: number }>
  volumes: Array<{ id: number; volumeNumber: number; title: string }>
  activeTrackCount: number
  stalledTrackCount: number
  resolvedTrackCount: number
}

export interface ResistanceTrackInput {
  id?: number
  novelId: number
  sourceType: ResistanceSourceType
  sourceId?: number
  resistanceKind?: ResistanceKind
  title?: string
  goal?: string
  intelSource?: string
  resourcePool?: string
  escalationPlan?: string
  heroKnowledgeShift?: string
  stageVictory?: string
  counterMove?: string
  currentPressureMode?: string
  currentStatus?: ResistanceTrackStatus
  lastActionChapterId?: number
  nextEscalationChapterId?: number
  linkedVolumeId?: number
  notes?: string
}

export interface ResistanceBeatInput {
  id?: number
  novelId: number
  trackId: number
  beatType?: ResistanceBeatType
  chapterId?: number
  timelineEventId?: number
  title?: string
  summary?: string
  actionMode?: string
  successLevel?: string
  counterResponse?: string
  protagonistImpact?: string
  status?: string
  sortOrder?: number
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

export type AiPatchTargetType =
  | 'character'
  | 'world_rules_section'
  | 'structure_chapter'
  | 'structure_segment'

export interface AiPatchTarget {
  type: AiPatchTargetType
  id: number
  novelId?: number
  sectionKey?: string
}

export interface AiPatchRequest {
  target: AiPatchTarget
  instruction: string
}

export interface AiPatchChange {
  field: string
  label: string
  before: string
  after: string
}

export interface AiPatchResult {
  summary: string
  patch: Record<string, unknown>
  changedFields: AiPatchChange[]
  warnings: string[]
  target: AiPatchTarget
}

export type CharacterAiPatchChange = AiPatchChange & { field: keyof Character | string }
export type CharacterAiPatchResult = AiPatchResult & { patch: Partial<Character> }

export interface StoryItemSourceContext {
  page?: string
  label?: string
  detectedAt?: string
  typedRefJson?: string
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

export interface MapGenerateToTargetResult {
  totalGeneratedNodeCount: number
  batchesRun: number
  completed: boolean
  lastResult: MapBatchGenerationResult | null
  message: string
}

export interface ItemCharacterLinkRepairResult {
  itemsScanned: number
  itemsLinked: number
  ownersAssigned: number
  details: string[]
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
  typedRefsJson?: string
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
  typedRefsJson?: string
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
  relatedSegments: StoryItemLinkedSegmentSummary[]
  derivedInstances: StoryItem[]
  siblingInstances: StoryItem[]
  sourceContexts: StoryItemSourceContext[]
}

export interface StoryItemLinkedSegmentSummary {
  segmentId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  segmentOrder: number
  title: string
  purpose?: string
  summary?: string
  locationName?: string
}

export interface StoryItemEventLinkRecommendation {
  eventId: number
  eventTitle: string
  timeLabel: string
  score: number
  reason: string
  alreadyLinked: boolean
}

export interface StoryItemSegmentLinkRecommendation {
  segmentId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  segmentOrder: number
  segmentTitle: string
  score: number
  reason: string
  alreadyLinked: boolean
}

export interface StoryItemLinkRecommendationResult {
  itemId: number
  generatedAt: string
  summary: string
  events: StoryItemEventLinkRecommendation[]
  segments: StoryItemSegmentLinkRecommendation[]
}

export interface StoryItemLinkApplyResult {
  itemId: number
  linkedEventCount: number
  linkedSegmentCount: number
  message: string
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

export type SourceSearchProviderMode = 'auto' | 'tavily' | 'brave' | 'disabled'
export type SourceSearchProviderName = 'tavily' | 'brave'

export interface SourceSearchSettingsView {
  provider: SourceSearchProviderMode
  tavilyApiKeySet: boolean
  braveApiKeySet: boolean
  tavilyEnvSet: boolean
  braveEnvSet: boolean
  activeProvider: SourceSearchProviderName | null
  updatedAt?: string | null
}

export interface SourceSearchSettingsUpdate {
  provider?: SourceSearchProviderMode
  tavilyApiKey?: string
  braveApiKey?: string
}

export interface SourceSearchTestResult {
  success: boolean
  providerName: SourceSearchProviderName | null
  latency: number
  info: string
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
  idempotencyKey?: string
  runnerType?: 'chat' | 'stream' | 'workflow'
  retryable?: number
  parentTaskId?: number
  currentChildTaskId?: number
  pipelineRole?: TaskPipelineRole
  pipelineStage?: TaskPipelineStage
  upstreamTaskId?: number
  contractVersion?: string
  canonRunId?: number
  recoveryHintJson?: string
  controlJson?: string
  progressJson?: string
  createdAt: string
  updatedAt: string
}

export type TaskPipelineRole =
  | 'planner'
  | 'writer'
  | 'critic'
  | 'rewriter'
  | 'canonizer'
  | 'finalize'

export type TaskPipelineStage =
  | 'pending'
  | 'running'
  | 'paused'
  | 'failed'
  | 'success'
  | 'blocked'

export interface TaskRecoveryHint {
  kind: 'open_page' | 'resume'
  label: string
  description: string
  path?: string
}

export interface TaskPipelineRoleStat {
  role: TaskPipelineRole
  total: number
  successCount: number
  failedCount: number
  runningCount: number
  pausedCount: number
  blockedCount: number
  avgDurationMs: number
  tokensUsedTotal: number
}

export interface TaskPipelineStats {
  totalPipelineCount: number
  activePipelineCount: number
  roleStats: TaskPipelineRoleStat[]
  commonRecoveryHints: Array<{
    label: string
    count: number
  }>
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
  | 'outline'
  | 'chapter'
  | 'project_brief'
  | 'theme_voice'

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

export interface ChapterBatchGenerateOptions {
  chapterIds: number[]
  batchSize?: number
}

export interface ChapterBatchAutoGenerateStatus extends BatchAutoGenerateStatusBase {
  chapterIds: number[]
  completedChapterIds: number[]
  failedChapterIds: number[]
  warnings: string[]
  currentChapterId?: number
  currentChapterNum?: number
  pauseReason?: string
  blockedChapterId?: number
  blockedTaskId?: number
  consecutiveRecallFallbackChapters: number
  snapshotId?: number
  currentWritebackStatus?: WritebackSyncStatus
  activeGuardrailReason?: string
  runtimePolicySnapshot?: {
    operatingMode: NovelOperatingMode
    chapterGenerationMode: 'serial_only'
    backgroundPrecomputeEnabled: boolean
    requireWritebackReady: boolean
    recallPauseThreshold: number
    checkpointGapWarningThreshold: number
    mainThreadPressureStrategy: 'latency_first' | 'balanced' | 'stability_first'
    strategySummary: string
  }
}

export interface ChapterQualityAnalysisOptions {
  chapterIds?: number[]
  includeAiCheck?: boolean
  includePublishCheck?: boolean
}

export interface ChapterQualityAnalysisStatus extends BatchAutoGenerateStatusBase {
  chapterIds: number[]
  completedChapterIds: number[]
  failedChapterIds: number[]
  warnings: string[]
  currentChapterId?: number
  currentChapterNum?: number
  snapshotId?: number
  inspectionIds: number[]
  publishBlockedChapterIds: number[]
  publishRewriteChapterIds: number[]
  generatedRevisionTaskCount: number
  aiCheckFailureCount: number
  publishCheckFailureCount: number
}

export type ProductionReadinessStatus = 'ready' | 'warning' | 'blocked'
export type BatchSnapshotStatus = 'active' | 'completed' | 'rolled_back'
export type BatchInspectionStatus = 'pass' | 'warning' | 'blocked'
export type BatchInspectionCategory = 'flow' | 'ai' | 'voice' | 'thread' | 'hook' | 'continuity'
export type BatchRollbackMode = 'chapter_rollback' | 'batch_content_rollback' | 'batch_full_rollback'

export interface ProductionReadinessSummary {
  status: ProductionReadinessStatus
  summary: string
  blockers: string[]
  warnings: string[]
  suggestedActions: string[]
  readyRate: number
  contractBlockerCount: number
  writebackPendingCount: number
  writebackFailedCount: number
  aiRecurrenceHighRiskCount: number
  feedbackPauseSuggestedCount: number
  consecutiveRecallFallbackChapters: number
  activeBatchTaskId?: number
  latestBatchSnapshotId?: number
}

export interface BatchHealthSummary {
  latestBatchTaskId?: number
  latestBatchSnapshotId?: number
  status: 'idle' | 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled'
  chapterIds: number[]
  chapterStart?: number
  chapterEnd?: number
  completedChapterCount: number
  failedChapterCount: number
  warningCount: number
  rewriteTaskCount: number
  pendingWritebackCount: number
  pendingRevisionCount: number
  pausedReason?: string
  canContinue: boolean
  summary: string
}

export interface ContinuityHealthSummary {
  staleCheckpointCount: number
  latestCheckpointChapterGap: number
  recallDegradedChapterCount: number
  consecutiveRecallFallbackChapters: number
  worldConflictCount: number
  writebackPendingCount: number
  writebackFailedCount: number
}

export interface ContractDeliverySummary {
  readyRate: number
  blockerCount: number
  warningCount: number
  storyThreadAdvanceRate: number
  storyThreadMentionOnlyCount: number
  foreshadowBlockedCount: number
  foreshadowStaleCount: number
}

export interface BatchReviewSummary {
  latestBatchSnapshotId?: number
  latestBatchTaskId?: number
  chapterStart?: number
  chapterEnd?: number
  chapterCount: number
  passedChapterCount: number
  rewrittenChapterCount: number
  failedChapterCount: number
  pendingWritebackCount: number
  recurringIssues: string[]
  recallAlerts: string[]
  avoidNextBatch: string[]
  summary: string
}

export interface GlobalLockLibrary {
  novelId: number
  lockedCanonFacts: string[]
  lockedParagraphs: string[]
  lockedStyleRules: string[]
  lockedCharacterVoice: string[]
  updatedAt: string
}

export interface BatchInspectionRecord {
  id: number
  snapshotId: number
  chapterId?: number
  chapterNum?: number
  category: BatchInspectionCategory
  status: BatchInspectionStatus
  note: string
  createdAt: string
  updatedAt: string
}

export interface BatchSnapshotSummary {
  id: number
  novelId: number
  workflowTaskId?: number
  title: string
  status: BatchSnapshotStatus
  chapterIds: number[]
  chapterNums: number[]
  chapterStart?: number
  chapterEnd?: number
  summary: string
  latestTaskStatus?: Task['status']
  latestTaskMessage?: string
  latestRollbackMode?: BatchRollbackMode
  rolledBackAt?: string
  createdAt: string
  updatedAt: string
}

export interface BatchRollbackImpactPreview {
  snapshotId: number
  mode: BatchRollbackMode
  chapterCount: number
  affectedChapters: Array<{
    chapterId: number
    chapterNum: number
    title: string
  }>
  affectedCounts: Record<string, number>
  warnings: string[]
}

export interface BatchRollbackRecord {
  id: number
  snapshotId: number
  mode: BatchRollbackMode
  summary: string
  impact: BatchRollbackImpactPreview
  restoredCounts: Record<string, number>
  createdAt: string
}

export interface BatchRollbackResult {
  snapshot: BatchSnapshotSummary
  rollback: BatchRollbackRecord
}

export interface BatchWorkbenchData {
  snapshots: BatchSnapshotSummary[]
  activeSnapshot: BatchSnapshotSummary | null
  inspections: BatchInspectionRecord[]
  rollbacks: BatchRollbackRecord[]
  globalLockLibrary: GlobalLockLibrary
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
  pendingImpactCount: number
  pendingManualConfirmationCount: number
  latestImpactEventAt?: string | null
}

export type AssetChangeOperation = 'create' | 'update' | 'delete' | 'sync'
export type AssetImpactLevel = 'low' | 'medium' | 'high'
export type AssetImpactTargetType =
  | 'chapter'
  | 'chapter_contract'
  | 'scene_contract'
  | 'thread'
  | 'timeline'
  | 'foreshadow'
  | 'character_state'
  | 'world_state'
  | 'volume_design'
export type AssetImpactResolutionStatus = 'pending' | 'reviewed' | 'resolved' | 'ignored'

export interface AssetChangeEvent {
  id: number
  novelId: number
  assetType: string
  assetId?: number | null
  assetLabel: string
  operation: AssetChangeOperation
  changeReason?: string | null
  impactLevel: AssetImpactLevel
  triggeredBy?: string | null
  payloadJson?: string | null
  createdAt: string
  updatedAt: string
}

export interface AssetChangeImpact {
  id: number
  eventId: number
  novelId: number
  targetType: AssetImpactTargetType
  targetId?: number | null
  chapterId?: number | null
  targetLabel: string
  impactReason: string
  detail?: string | null
  confidence?: number | null
  resolutionStatus: AssetImpactResolutionStatus
  relatedTaskId?: number | null
  eventAssetType?: string
  eventAssetId?: number | null
  eventAssetLabel?: string
  eventOperation?: AssetChangeOperation
  eventCreatedAt?: string
  createdAt: string
  updatedAt: string
}

export interface AssetImpactSummary {
  novelId: number
  totalEventCount: number
  pendingImpactCount: number
  pendingManualConfirmationCount: number
  affectedChapterCount: number
  latestImpactEventAt?: string | null
  topImpactLabels: string[]
}

export interface WritingContextUsageSnapshot {
  usedAssets: string[]
  usedContracts: string[]
  ignoredConstraints: string[]
  recentStateChanges: string[]
  linkedImpacts: AssetChangeImpact[]
}

export interface AiExecutionSettings {
  defaultMode?: AiExecutionMode
}

export interface AiModelRouteReport {
  taskKind: AiTaskKind
  stageLabel: string
  executionMode: AiExecutionMode
  resolutionSource: 'request_override' | 'global_default' | 'fallback_default'
  modelConfigId?: number
  modelLabel: string
  provider?: string
  providerOptions?: {
    kimiThinking?: 'enabled' | 'disabled'
  }
  temperature: number
  maxTokens: number
  tokenSafetyMarginPct?: number
  contextStrategy: 'trimmed' | 'balanced' | 'max_coverage'
  reviewDepth: 'lite' | 'standard' | 'deep'
  reasons: string[]
}

export interface AiStageExecutionReport {
  stageKey: string
  stageLabel: string
  taskKind: AiTaskKind
  executionMode: AiExecutionMode
  outputShape: 'json' | 'text' | 'workflow'
  summary: string
  route: AiModelRouteReport
}

export interface AiContextAssemblyLayerReport {
  key: 'graph_recall' | 'timeline_recall' | 'chapter_bridge' | 'contract_recall'
  label: string
  itemCount: number
  summary: string
}

export interface AiContextAssemblyReport {
  assemblyVersion: 'v2-unified'
  summary: string
  layers: AiContextAssemblyLayerReport[]
  notes: string[]
}

export interface AuthorStyleLockSummary {
  enabled: boolean
  sourceLabel: string
  sentenceLengthHint?: string
  dialogueRhythmHint?: string
  narrativeDensityHint?: string
  paceHint?: string
  targetWorkSampleGuide?: string
  humanStyleSampleLock?: string
  toneKeywords: string[]
  preferredLexicon: string[]
  forbiddenPatterns: string[]
  hardRules: string[]
}

export interface AiInferenceFact {
  label: string
  detail: string
  confidence: 'high' | 'medium' | 'low'
  source: 'model_inference' | 'constraint_gap' | 'impact_sync' | 'state_writeback'
  needsConfirmation: boolean
}

export interface AiExplainabilityReport {
  taskKind: AiTaskKind
  executionMode: AiExecutionMode
  routeSummary: string
  structuredOutputs: string[]
  activePromptOverrideKeys?: string[]
  usedAssets: string[]
  usedContracts: string[]
  ignoredConstraints: string[]
  inferredFacts: AiInferenceFact[]
  lowConfidenceFacts: AiInferenceFact[]
  stageReports: AiStageExecutionReport[]
  contextAssemblyReport?: AiContextAssemblyReport
  authorStyleLock?: AuthorStyleLockSummary
}

export type ChapterContextComplexity = 'simple' | 'standard' | 'key'
export type ChapterContextStage = 'scenePlan' | 'draft' | 'review' | 'rewrite'
export interface UpstreamRuntimeArtifacts {
  scenePlanSummary?: string
  draftTextSummary?: string
  contractVersionSummary?: string
  reviewRiskSummary?: string
  reviewProofSummary?: string
  rewriteDeltaSummary?: string
  publishGateRiskSummary?: string
  stepMemorySummary?: string
  runtimeAssertions?: string[]
}
export type StageAllocatorFieldKey =
  | 'characterStates'
  | 'dialogueVoiceLocks'
  | 'relationSummary'
  | 'activeThreads'
  | 'dueForeshadows'
  | 'continuityNotes'
  | 'openLoops'
  | 'chapterBridgePlan'
  | 'stepMemorySummary'
  | 'timelineSummary'
  | 'mapSummary'
  | 'recalledMemory'
  | 'writingContractSummary'
  | 'scenePlanSummary'
  | 'draftTextSummary'
  | 'contractVersionSummary'
  | 'reviewRiskSummary'
  | 'reviewProofSummary'
  | 'rewriteDeltaSummary'
  | 'publishGateRiskSummary'

export interface StageRenderSchema {
  stage: ChapterContextStage
  requiredAllocatorFields: StageAllocatorFieldKey[]
  optionalAllocatorFields: StageAllocatorFieldKey[]
}
export type RecallBucketKey = 'character' | 'rule' | 'thread'
export type RecallSearchMode = 'vector' | 'keyword'
export type HardConstraintSourceLabel =
  | 'chapterGoal'
  | 'characterStates'
  | 'worldStates'
  | 'writingContractSummary'
  | 'relationSummary'
  | 'itemSummary'
  | 'openLoops'
  | 'continuityNotes'
  | 'feedbackRecurrence'
  | 'antiAiRules'
  | 'styleHardGuard'
  | 'genrePacing'

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

export type PreviousChapterSampleSegmentType =
  | 'full_text'
  | 'opening'
  | 'middle'
  | 'summary'
  | 'continuity'
  | 'scene_anchor'
  | 'review'
  | 'writeback'
  | 'seed'
  | 'tail'

export interface PreviousChapterSampleSegment {
  type: PreviousChapterSampleSegmentType
  label: string
  text: string
  chars: number
}

export interface PreviousChapterSampleReport {
  sourceChapterId: number | null
  sourceChapterNum: number | null
  sourceChapterChars: number
  sampledChars: number
  coverageRate: number
  segmentCount: number
  fullyInjected: boolean
  segments: PreviousChapterSampleSegment[]
}

export type ContextDecisionStatus = 'kept' | 'truncated' | 'dropped'
export type ContextDecisionReason = 'budget_fit' | 'budget_insufficient' | 'covered_by_hard_constraint'
export type ContextDecisionSourceKind = 'hard_constraint' | 'previous_chapter' | 'chapter_bridge' | 'recent_summary' | 'vector_recall'

export interface ContextDecisionEntry {
  label: string
  title: string
  priority: 0 | 1 | 2 | 3 | 'hard'
  originalTokens: number
  allocatedTokens: number
  status: ContextDecisionStatus
  reason: ContextDecisionReason
  sourceKind?: ContextDecisionSourceKind
}

export type ContextBudgetOverflowLevel = 'none' | 'soft_trimmed' | 'hard_failed'

export interface ContextBudgetWarningSummary {
  priority: 0 | 1 | 2 | 3
  count: number
  labels: string[]
}

export interface ContextBudgetReport {
  modelContextLimit: number
  safeModelContextLimit?: number
  modelProvider?: string
  tokenSafetyMarginPct?: number
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
  preservedConstraintLabels: HardConstraintSourceLabel[]
  droppedConstraintLabels: HardConstraintSourceLabel[]
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
  preservedLabels: HardConstraintSourceLabel[]
  droppedLabels: HardConstraintSourceLabel[]
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
  entityMatches: string[]
  entityValidated: boolean
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
  validatedHitCount: number
  lowSimilarityRejectedCount: number
  entityValidationRejectedCount: number
  minVectorSimilarity: number
  minKeywordSimilarity: number
  summaryLines: string[]
}

export type RecallFallbackReason =
  | 'embedding_service_failed'
  | 'query_embedding_failed'
  | 'no_hits'
  | 'only_stale_hits'
  | 'budget_trimmed'
  | 'disabled_by_config'

export interface RecallBucketStats {
  hitCount: number
  selectedHitCount: number
  staleCount: number
  fallbackHitCount: number
  fallbackReason?: RecallFallbackReason
}

export interface RecallSnapshot {
  retrievalUsed: boolean
  degraded: boolean
  hitCount: number
  selectedHitCount: number
  staleRecallCount: number
  fallbackHitCount: number
  fallbackReason?: RecallFallbackReason
  assemblyStage?: 'base_recall' | 'unified_recall'
  bucketStats: Record<RecallBucketKey, RecallBucketStats>
}

export type RecallRuntimeSnapshotSource = 'runtime' | 'backfilled'

export interface ChapterRecallRuntimeBackfillResult {
  novelId: number
  totalChapterCount: number
  persistedTaskRuntimeCount: number
  backfilledCount: number
  skippedCount: number
  failedChapterIds: number[]
}

export interface ChapterContextPreviewStage {
  stage: ChapterContextStage
  hardConstraintContext: string
  hardConstraintSummary: string
  hardConstraintEntries: HardConstraintEntryPreview[]
  constraintInjectionStatus: ConstraintInjectionStatus
  softContextBudgetUsage: SoftContextBudgetUsage
  contextBudgetReport: ContextBudgetReport
  softContextDecisions: ContextDecisionEntry[]
  droppedConstraintCount: number
  upstreamArtifacts?: UpstreamRuntimeArtifacts
  renderSchema?: StageRenderSchema
}

export interface ChapterContextPreview {
  chapterId: number
  chapterNum: number
  complexity: ChapterContextComplexity
  assemblyVersion?: 'v1-base' | 'v2-unified'
  assemblyNotes?: string[]
  contextAssemblyReport?: AiContextAssemblyReport
  authorStyleLock?: AuthorStyleLockSummary
  generationExplainability?: AiExplainabilityReport
  previousChapterContext: string
  chapterBridgePlan?: string
  stepMemorySummary?: string
  previousChapterSampleReport: PreviousChapterSampleReport
  recalledMemory: string
  recallSnapshot: RecallSnapshot
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
  usageSnapshot: WritingContextUsageSnapshot
  writerContextResolution?: WriterContextOrchestratorResolution
  stages: ChapterContextPreviewStage[]
}

export type WriterContextOverrideKey =
  | 'worldRules'
  | 'characterStates'
  | 'worldStates'
  | 'mapSummary'
  | 'itemSummary'
  | 'continuityNotes'
  | 'timelineSummary'
  | 'timelineOpenThreads'
  | 'longTermMemory'
  | 'activeThreads'
  | 'openLoops'
  | 'dueForeshadows'
  | 'chapterBridgePlan'
  | 'stepMemorySummary'
  | 'relationSummary'
  | 'dialogueVoiceLocks'
  | 'recalledMemory'

export type WriterContextRenderedOverrides = Partial<Record<WriterContextOverrideKey, string>>

export interface WriterContextSignalInput {
  chapterTitle?: string
  chapterOutline?: string
  chapterGoal?: string
  arcSummary?: string
  arcGoal?: string
  previousSummaries?: string
  continuityNotes?: string
  openLoops?: string
  dueForeshadows?: string
  chapterBridgePlan?: string
  stepMemorySummary?: string
  timelineSummary?: string
  timelineOpenThreads?: string
  activeThreads?: string
  worldStates?: string
  relationSummary?: string
  dialogueVoiceLocks?: string
  genre?: string
  worldRules?: string
  backgroundText?: string
  glossaryTerms?: string[]
  historicalProfileJson?: string
  projectCanonProfileJson?: string
  canonConstraintSetJson?: string
  sourceLedgerJson?: string
  canonSourceLedgerJson?: string
  canonFactCardsJson?: string
  mentionedCharacters?: string[]
  mentionedItems?: string[]
  mentionedLocations?: string[]
  mentionedFactions?: string[]
}

export interface WriterContextOrchestratorInvalidationInput {
  chapterContextVersion?: number
  novelContextVersion?: number
  assetFingerprint?: string
  cacheSalt?: string
  stage?: string
  executionMode?: string
  preserveConstraintLabels?: string[]
}

export interface WriterContextOrchestratorRuntimeOptions {
  useMemoryCache?: boolean
  forceRefresh?: boolean
  maxCharacters?: number
  maxItems?: number
  maxMapLocations?: number
  maxTimelineEvents?: number
  maxThreads?: number
  maxRecallHitsPerBucket?: number
}

export interface WriterContextOrchestratorInput {
  novelId: number
  chapterId?: number
  chapterNum: number
  signals: WriterContextSignalInput
  baseContextParts?: WriterContextRenderedOverrides
  invalidation?: WriterContextOrchestratorInvalidationInput
  runtime?: WriterContextOrchestratorRuntimeOptions
}

export interface StageToolExecutionInput {
  novelId: number
  chapterId?: number
  chapterNum: number
  stage: ChapterContextStage
  objective: string
  signals: Record<string, unknown>
  upstreamArtifacts?: UpstreamRuntimeArtifacts
  limits?: {
    maxEntities?: number
    maxItems?: number
    maxEvents?: number
    maxHits?: number
    tokenCeiling?: number
  }
  invalidation?: {
    novelContextVersion?: number
    chapterContextVersion?: number
    assetFingerprint?: string
    promptOverrideHash?: string
    cacheSalt?: string
  }
}

export interface StageToolExecutionResult {
  toolName: string
  status: 'success' | 'empty' | 'failed'
  structuredPayload?: unknown
  summary: string
  itemCount: number
  charCount: number
  fallbackUsed?: boolean
  fallbackDetail?: string
}

export type WriterContextQueryBucket =
  | 'story_memory'
  | 'source_grounding'
  | 'character'
  | 'item'
  | 'map_location'
  | 'timeline'
  | 'world_state'
  | 'thread'
  | 'recall_character'
  | 'recall_rule'
  | 'recall_thread'

export interface WriterContextQueryPlanStep {
  bucket: WriterContextQueryBucket
  enabled: boolean
  reason: string
  terms: string[]
  queryText?: string
  serviceCalls: string[]
  resultLimit?: number
}

export type WriterContextToolTarget = WriterContextQueryBucket | WriterContextOverrideKey | 'cache' | 'orchestrator'

export interface WriterContextToolCall {
  target: WriterContextToolTarget
  toolName: string
  status: 'success' | 'failed' | 'skipped' | 'cache_hit'
  durationMs: number
  argsSummary?: string
  resultCount?: number
  errorMessage?: string
}

export type WriterContextFallbackReason =
  | RecallFallbackReason
  | 'service_failed'
  | 'empty_result'
  | 'render_empty'

export interface WriterContextFallbackEvent {
  target: WriterContextToolTarget
  reason: WriterContextFallbackReason
  detail: string
  fallbackMode: 'legacy_empty' | 'conservative'
}

export interface WriterContextRetrievalFingerprint {
  digest: string
  cacheKey: string
  signalHash: string
  planHash: string
  invalidationHash: string
  inputs: {
    novelId: number
    chapterId?: number
    chapterNum: number
    chapterContextVersion?: number
    novelContextVersion?: number
    assetFingerprint?: string
    cacheSalt?: string
    mentionedCharacterCount: number
    mentionedItemCount: number
    mentionedLocationCount: number
    mentionedFactionCount?: number
    enabledBuckets: WriterContextQueryBucket[]
  }
}

export interface WriterContextAllocatorInputBucketSummary {
  bucket: WriterContextQueryBucket
  renderedLabels: WriterContextOverrideKey[]
  itemCount: number
  charCount: number
}

export interface WriterContextAllocatorInputSummary {
  overrideLabels: WriterContextOverrideKey[]
  overrideCharCount: number
  overrideLineCount: number
  enabledBucketCount: number
  signalCharCount: number
  buckets: WriterContextAllocatorInputBucketSummary[]
}

export interface WriterOrchestratedStoryMemoryPack {
  generatedAt?: string
  coverageSummary: string
  phaseDigest: string[]
  plotMilestones: string[]
  activeThreads: string[]
  continuityDirectives: string[]
  timelineAnchors: string[]
  itemLedger: string[]
}

export interface WriterOrchestratedCharacterPackEntry {
  characterId: number
  name: string
  roleType?: Character['roleType']
  stateSummary: string
  relationSummaries: string[]
  relatedItemNames: string[]
  voiceHints: string[]
}

export interface WriterOrchestratedItemPackEntry {
  itemId: number
  name: string
  status?: StoryItem['status']
  ownerName?: string
  summary: string
  relatedEventTitles: string[]
}

export interface WriterOrchestratedTimelinePackEntry {
  eventId: number
  title: string
  timeLabel: string
  status: TimelineEvent['status']
  summary: string
  openThreads: string[]
}

export interface WriterOrchestratedWorldStatePack {
  stateLines: string[]
  alertLines: string[]
  worldStatesText?: string
}

export interface WriterOrchestratedMapLocationPackEntry {
  mapId: number
  name: string
  level: number
  path: string
  nodeType?: string
  locationType?: string
  structureRole?: string
  parentName?: string
  description?: string
  plotRelevance?: string
  dangerLevel?: string
  relationLines: string[]
}

export interface WriterOrchestratedThreadPack {
  activeThreadLines: string[]
  openLoopLines: string[]
  dueForeshadowLines: string[]
  continuityLines: string[]
}

export interface WriterOrchestratedSourceGroundingPack {
  assessmentSummary: string
  mode: string
  coverage: string
  conservativeFallbackActive: boolean
  sourceLines: string[]
  canonFactLines: string[]
  constraintLines: string[]
  missingSignals: string[]
}

export type WriterContextRecallBucket = 'character' | 'rule' | 'thread'

export interface WriterOrchestratedRecallHit {
  bucket: WriterContextRecallBucket
  chapterId: number
  chapterNum: number
  fragmentType: string
  summary: string
  similarity: number
  searchMode: 'vector' | 'keyword'
}

export interface WriterOrchestratedRecallPack {
  hits: WriterOrchestratedRecallHit[]
}

export interface WriterContextStructuredPack {
  storyMemory?: WriterOrchestratedStoryMemoryPack
  characters: WriterOrchestratedCharacterPackEntry[]
  items: WriterOrchestratedItemPackEntry[]
  mapLocations: WriterOrchestratedMapLocationPackEntry[]
  timeline: WriterOrchestratedTimelinePackEntry[]
  worldState?: WriterOrchestratedWorldStatePack
  threads?: WriterOrchestratedThreadPack
  sourceGrounding?: WriterOrchestratedSourceGroundingPack
  recall: WriterOrchestratedRecallPack
}

export interface WriterContextOrchestratorResolution {
  cacheKey: string
  cacheHit: boolean
  queryPlan: WriterContextQueryPlanStep[]
  retrievalFingerprint: WriterContextRetrievalFingerprint
  structuredPack: WriterContextStructuredPack
  renderedContextOverrides: WriterContextRenderedOverrides
  toolCalls: WriterContextToolCall[]
  fallbackEvents: WriterContextFallbackEvent[]
  allocatorInputSummary: WriterContextAllocatorInputSummary
}

export interface StageContextResolution {
  stage: ChapterContextStage
  cacheKey: string
  cacheHit: boolean
  queryPlan: Array<Record<string, unknown>>
  toolCalls: Array<Record<string, unknown>>
  fallbackEvents: Array<Record<string, unknown>>
  intentGraph?: Record<string, unknown>
  structuredPacks?: Record<string, unknown>
  renderedOverrides?: Record<string, string>
  upstreamArtifacts?: UpstreamRuntimeArtifacts
  renderSchema?: StageRenderSchema
  effectiveRawContext?: Record<string, unknown>
  allocatorCompatibleContextParts?: Record<string, unknown>
  allocatorInputSummary?: Record<string, unknown>
  writerContextResolution?: WriterContextOrchestratorResolution
}

export interface ChapterPublishCheckItem {
  key: string
  label: string
  status: 'pass' | 'warning' | 'blocker' | 'rewrite'
  detail: string
  source: 'chapter' | 'scene' | 'contract' | 'review' | 'thread' | 'volume'
  segmentId?: number
  segmentTitle?: string
  relatedPage?: 'writing' | 'structure' | 'contracts' | 'revision' | 'volume-design' | 'threads'
  fixHint?: string
  taskId?: number
}

export type ContractAuditStatus = 'pass' | 'warning' | 'blocker'

export type ChapterGateLevel = 'pass' | 'warning' | 'blocker' | 'rewrite'

export type ChapterGateScoreBand = 'stable' | 'attention' | 'risky' | 'unstable'

export interface ContractAuditItem {
  key: string
  label: string
  status: ContractAuditStatus
  detail: string
  source: 'chapter' | 'scene'
  segmentId?: number
  segmentTitle?: string
}

export interface ChapterContractAudit {
  checkedAt: string
  summary: string
  blockerCount: number
  warningCount: number
  passCount: number
  items: ContractAuditItem[]
}

export type ContractValidationVerdict = 'pass' | 'weak' | 'missing' | 'contradicted' | 'overdelivered'
export type ThreadProgressSemanticState = 'missing' | 'mentioned' | 'advanced' | 'blocked' | 'paid_off' | 'stale'

export interface ContractValidationItem {
  contractItemType: string
  contractItemId?: number
  expected: string
  verdict: ContractValidationVerdict
  semanticState?: ThreadProgressSemanticState
  semanticReason?: string
  evidenceExcerpt: string
  segmentId?: number
  segmentTitle?: string
  rewriteHint: string
}

export interface ChapterContractValidationResult {
  status: 'pass' | 'warning' | 'blocker'
  summary: string
  itemResults: ContractValidationItem[]
  rewriteHints: string[]
}

export interface ChapterRewriteTarget {
  kind: 'chapter' | 'segment' | 'selection'
  chapterId: number
  segmentId?: number
  segmentTitle?: string
  reason: string
  relatedPage: 'writing' | 'structure' | 'contracts' | 'revision' | 'volume-design' | 'threads'
}

export type ChapterRewriteScope = 'paragraph_patch' | 'scene_rewrite' | 'chapter_rewrite' | 'contract_replan'

export interface RewritePlan {
  scope: ChapterRewriteScope
  targetSegmentId?: number
  targetExcerpt?: string
  goals: string[]
  preserve: string[]
  recheckItems: string[]
}

export interface ChapterPublishCheckScoreBreakdown {
  totalScore: number
  continuityScore: number
  coherenceScore: number
  dialogueVoiceScore: number
  hookStrengthScore: number
  storyDynamicsScore: number
  languageNaturalnessScore: number
  styleComplianceScore: number
  povBoundaryScore: number
  sensoryCoverageScore: number
  narrativeRatioScore: number
  contractScore: number
  hookScore: number
  povPurityScore: number
  threadProgressScore: number
  volumeAlignmentScore: number
}

export interface ChapterGateDimensionDelta {
  key: string
  label: string
  score: number
  previousScore: number
  delta: number
}

export interface ChapterGateHistoryEntry {
  id: number
  novelId: number
  chapterId: number
  chapterNum: number
  gateLevel: ChapterGateLevel
  ready: boolean
  summary: string
  rewriteCount: number
  blockerCount: number
  warningCount: number
  generatedTaskCount: number
  topIssueKeys: string[]
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  createdAt: string
}

export interface ChapterGateDriftSummary {
  status: 'worsening' | 'improving' | 'stable'
  scoreBand: ChapterGateScoreBand
  currentScore: number
  previousScore?: number
  scoreDelta: number
  currentGateLevel: ChapterGateLevel
  previousGateLevel?: ChapterGateLevel
  topDimensions: ChapterGateDimensionDelta[]
  summary: string
  createdAt: string
}

export interface ChapterGateTrendPoint {
  chapterId: number
  chapterNum: number
  totalScore: number
  gateLevel: ChapterGateLevel
  scoreBand: ChapterGateScoreBand
  createdAt: string
}

export interface ChapterGateHeatmapPoint {
  chapterId: number
  chapterNum: number
  dimension: string
  score: number
  gateLevel: ChapterGateLevel
  scoreBand: ChapterGateScoreBand
  createdAt: string
}

export interface ChapterGateDriftAlert extends ChapterGateDriftSummary {
  chapterId: number
  chapterNum: number
  title: string
  detail: string
}

export interface ChapterGateSummary {
  coveredChapterCount: number
  snapshotCount: number
  averageTotalScore: number
  stableCount: number
  attentionCount: number
  riskyCount: number
  unstableCount: number
  worseningAlertCount: number
  latestLevelCounts: Record<ChapterGateLevel, number>
}

export interface ChapterGateChapterDetail {
  latest?: ChapterGateHistoryEntry
  history: ChapterGateHistoryEntry[]
  drift?: ChapterGateDriftSummary
}

export interface ChapterPublishCheck {
  chapterId: number
  chapterNum: number
  gateLevel: ChapterGateLevel
  ready: boolean
  summary: string
  blockerCount: number
  warningCount: number
  rewriteCount: number
  staleReasons: string[]
  chapterContextVersion: number
  novelContextVersion: number
  rewriteRecommended: boolean
  rewriteTarget?: ChapterRewriteTarget
  rewritePlan?: RewritePlan
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  history: ChapterGateHistoryEntry[]
  drift?: ChapterGateDriftSummary
  generatedTaskCount: number
  checklist: ChapterPublishCheckItem[]
  contractAudit: ChapterContractAudit
  contractValidation?: ChapterContractValidationResult
}

export type ChapterWritebackAssetType =
  | 'character'
  | 'world'
  | 'item'
  | 'relation'
  | 'thread'
  | 'foreshadow'
  | 'puzzle'
  | 'timeline'

export type ChapterWritebackRunStatus =
  | 'draft'
  | 'ready'
  | 'applying'
  | 'applied'
  | 'partially_failed'
  | 'failed'

export type ChapterWritebackDecision = 'pending' | 'accepted' | 'rejected' | 'edited'

export type ChapterWritebackStatus = 'pending' | 'applied' | 'failed' | 'skipped'
export type WritebackVerificationStatus = 'auto_ready' | 'needs_review' | 'conflicted'

export interface ChapterWritebackRun {
  id: number
  novelId: number
  chapterId: number
  status: ChapterWritebackRunStatus
  triggerSource: string
  summaryText?: string | null
  retryCount?: number
  lastAttemptAt?: string | null
  sourceChapterVersion?: number | null
  startedAt?: string | null
  completedAt?: string | null
  failedAt?: string | null
  errorMessage?: string | null
  applyIdempotencyKey?: string | null
  applyLockVersion?: number
  createdAt: string
  updatedAt: string
}

export interface ChapterWritebackApplyOptions {
  /** Caller-stable key for replaying the same apply command safely. */
  idempotencyKey?: string
}

export interface ChapterFactExtract {
  id: number
  runId: number
  assetType: ChapterWritebackAssetType
  sourceText?: string | null
  factJson: string
  confidence?: number | null
  verificationStatus: WritebackVerificationStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ChapterWritebackDiff {
  id: number
  runId: number
  assetType: ChapterWritebackAssetType
  entityType: string
  entityId?: number | null
  beforeStateJson?: string | null
  afterStateJson: string
  diffReason?: string | null
  confidence?: number | null
  verificationStatus: WritebackVerificationStatus
  canonDecision: ChapterWritebackDecision
  writebackStatus: ChapterWritebackStatus
  writebackError?: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ChapterWritebackCoverageItem {
  assetType: ChapterWritebackAssetType
  extractCount: number
  diffCount: number
  acceptedCount: number
  rejectedCount: number
  editedCount: number
  appliedCount: number
  failedCount: number
  pendingCount: number
}

export interface ChapterWritebackCenterData {
  chapter: Chapter | null
  writebackStatus: WritebackSyncStatus
  runs: ChapterWritebackRun[]
  activeRun: ChapterWritebackRun | null
  extracts: ChapterFactExtract[]
  diffs: ChapterWritebackDiff[]
  coverage: ChapterWritebackCoverageItem[]
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
  typedRefsJson?: string
  notes?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type StoryFactKind = 'puzzle' | 'clue' | 'truth' | 'red_herring'
export type StoryFactStatus = 'introduced' | 'partial_reveal' | 'pending_payoff' | 'explained'

export interface StoryFactCharacterKnowledge {
  characterId: number
  knownChapterId?: number | null
}

export interface StoryFact {
  id: number
  novelId: number
  volumeId?: number | null
  relatedPuzzleId?: number | null
  kind: StoryFactKind
  title: string
  summary?: string
  status: StoryFactStatus
  readerKnownChapterId?: number | null
  protagonistKnownChapterId?: number | null
  characterKnowledgeJson?: string
  forbiddenBeforeVolume?: number | null
  plannedRevealVolume?: number | null
  targetRevealChapterId?: number | null
  isKeyTruth: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export type GrowthTrackType = 'character' | 'organization' | 'relationship'
export type ResourcePoolType = 'material' | 'authority' | 'relationship' | 'knowledge' | 'time'
export type ScarcityLevel = 'abundant' | 'balanced' | 'scarce' | 'critical'
export type RewardCostEventType = 'reward' | 'cost' | 'bottleneck'

export interface GrowthTrack {
  id: number
  novelId: number
  trackType: GrowthTrackType
  sourceEntityType?: string | null
  sourceEntityId?: number | null
  sourceEntityLabel?: string | null
  title: string
  currentTier?: string | null
  stageGoal?: string | null
  nextGoal?: string | null
  bottleneck?: string | null
  scarceResource?: string | null
  acquirePath?: string | null
  consumptionRule?: string | null
  failureCost?: string | null
  rewardCadence?: string | null
  linkedVolumeId?: number | null
  linkedChapterId?: number | null
  status: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ResourcePool {
  id: number
  novelId: number
  name: string
  poolType: ResourcePoolType
  scarcityLevel: ScarcityLevel
  currentReserve?: string | null
  unit?: string | null
  replenishPath?: string | null
  consumptionRule?: string | null
  failureCost?: string | null
  pressureSource?: string | null
  linkedVolumeId?: number | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface RewardCostEvent {
  id: number
  novelId: number
  chapterId?: number | null
  chapterNumSnapshot?: number | null
  eventType: RewardCostEventType
  title: string
  summary?: string | null
  trackId?: number | null
  resourcePoolId?: number | null
  deltaValue?: string | null
  costResolutionState?: 'new' | 'ongoing' | 'resolved' | 'evaporated' | null
  rewardLevel?: 'none' | 'partial' | 'major' | null
  nextBottleneck?: string | null
  linkedVolumeId?: number | null
  createdAt: string
  updatedAt: string
}

export interface GrowthSystemDashboard {
  tracks: GrowthTrack[]
  pools: ResourcePool[]
  events: RewardCostEvent[]
  chapters: Array<{ id: number; chapterNum: number; title?: string | null }>
  volumes: Array<{ id: number; volumeNumber: number; title?: string | null }>
  summary: {
    trackCount: number
    characterTrackCount: number
    organizationTrackCount: number
    relationshipTrackCount: number
    criticalPoolCount: number
    unresolvedCostCount: number
    chapterWritebackCoverage: number
  }
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
  payoffSceneAction?: string
  requiredEvidence?: string
  readerVisibleOutcome?: string
  allowedDelayReason?: string
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
  relatedPage?: string
  entityType?: string
  entityId?: number
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
  maxTruthRevealRatio?: number | null
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

export interface StructureLinkageSummary {
  chapterCount: number
  segmentCount: number
  timelineEventCount: number
  missingChapterContractCount: number
  missingSceneContractCount: number
  uncoveredChapterCount: number
  uncoveredSegmentCount: number
  anchorInvalidEventCount: number
  totalGapCount: number
  missingChapterContractLabels: string[]
  missingSceneContractLabels: string[]
  uncoveredChapterLabels: string[]
  uncoveredSegmentLabels: string[]
  anchorInvalidEventTitles: string[]
  summary: string
}

export interface StructureLinkageSyncResult {
  createdChapterContractCount: number
  createdSceneContractCount: number
  createdTimelineEventCount: number
  message: string
  summary: StructureLinkageSummary
}

export type EndgameCommitmentKind = 'promise' | 'payoff'
export type EndgameCommitmentStatus = 'active' | 'served' | 'fulfilled' | 'waived'

export interface EndgameCommitment {
  id: number
  novelId: number
  commitmentKind: EndgameCommitmentKind
  title: string
  description?: string
  sourceOrder: number
  sourceText: string
  status: EndgameCommitmentStatus
  derivedStatus: EndgameCommitmentStatus
  targetResolutionChapter?: number
  lastServedChapter?: number
  fulfilledChapter?: number
  notes?: string
  referenceCount: number
  referencedVolumeIds: number[]
  referencedChapterIds: number[]
  referencedSegmentIds: number[]
  linkedForeshadowIds: number[]
  overdue: boolean
  createdAt: string
  updatedAt: string
}

export interface EndgameAssetSummary {
  totalCount: number
  promiseCount: number
  payoffCount: number
  activeCount: number
  servedCount: number
  fulfilledCount: number
  waivedCount: number
  overdueCount: number
  unboundCount: number
  linkedForeshadowCount: number
}

export interface ForeshadowLedgerEntry {
  id: number
  novelId: number
  title: string
  detail?: string | null
  sourceChapterId?: number | null
  sourceSegmentId?: number | null
  sourceChapterNum?: number | null
  plantMethod?: string | null
  salienceLevel: string
  targetPayoffChapter?: number | null
  payoffMethod?: string | null
  payoffSceneAction?: string | null
  requiredEvidence?: string | null
  readerVisibleOutcome?: string | null
  allowedDelayReason?: string | null
  impactScope: string
  status: string
  linkedThreadId?: number | null
  linkedEndgameCommitmentId?: number | null
  linkedEndgameCommitmentTitle?: string | null
  linkedVolumeId?: number | null
  createdAt: string
  updatedAt: string
}

export interface VolumeDesignAsset {
  id?: number
  novelId: number
  volumeId: number
  volumeNumber: number
  volumeName: string
  volumeTheme: string
  volumePromise: string
  mainConflict: string
  climaxPlan: string
  endStateShift: string
  mustAddClues: string[]
  mustResolveClues: string[]
  readerExpectation: string
  linkedEndgameCommitmentIds: number[]
  linkedResistanceTrackIds: number[]
  auditStatus: string
  createdAt: string
  updatedAt: string
}

export type VolumeAuditSeverity = 'high' | 'medium' | 'low'

export interface VolumeAuditFinding {
  id: string
  severity: VolumeAuditSeverity
  category: 'design' | 'foreshadow' | 'endgame' | 'arc' | 'progress'
  title: string
  description: string
  suggestedAction?: string
  chapterId?: number
  chapterNum?: number
  arcId?: number
  taskId?: number
}

export interface VolumeAuditResult {
  novelId: number
  volumeId: number
  volumeName: string
  auditedAt: string
  summary: {
    chapterCount: number
    contractCoveredChapterCount: number
    unresolvedMustResolveClueCount: number
    stalledArcCount: number
    weakProgressChapterCount: number
    totalFindings: number
    highCount: number
    mediumCount: number
    lowCount: number
    createdTaskCount: number
  }
  findings: VolumeAuditFinding[]
}

export interface VolumeConstraintSyncResult {
  novelId: number
  volumeId: number
  volumeName: string
  syncedAt: string
  chapterCount: number
  createdContractCount: number
  updatedContractCount: number
  syncedConstraintCount: number
  sampleConstraints: string[]
}

export interface ChapterContractAsset {
  id?: number
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  openingStyle: string
  endingStyle: string
  expositionMode: string
  emotionFocus: string
  servedThreadIds: number[]
  requiredArcProgress: string[]
  requiredCharacterArcIds: number[]
  requiredRelationshipArcIds: number[]
  requiredResistanceTrackIds: number[]
  requiredResistanceActions: string[]
  requiredAssetRefs: string[]
  requiredEndgameCommitmentIds: number[]
  requiredForeshadowIds: number[]
  hookType: string
  forbiddenActions: string[]
  acceptanceNotes: string[]
  status: string
  createdAt: string
  updatedAt: string
}

export interface SceneContractAsset {
  id?: number
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  segmentId?: number
  segmentOrder?: number
  segmentTitle: string
  pov: string
  timeLocation: string
  sceneGoal: string
  obstacle: string
  conflictType: string
  emotionShift: string
  revealPayload: string[]
  resultState: string
  linkageMode: string
  requiredEndgameCommitmentIds: number[]
  requiredForeshadowIds: number[]
  status: string
  createdAt: string
  updatedAt: string
}

export interface EndgameDebtAlert {
  commitmentId: number
  title: string
  description?: string
  kind: EndgameCommitmentKind
  status: EndgameCommitmentStatus
  referenceCount: number
  lastServedChapter?: number
  targetResolutionChapter?: number
  volumeId?: number
  volumeName?: string
  overdue: boolean
  unbound: boolean
  stale: boolean
  severity: 'warning' | 'critical'
  detail: string
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
  triggerEventId?: number
  sourceSegmentId?: number
  stateDeltaJson?: string
  createdAt: string
  updatedAt: string
}

export interface StateDeltaEntry {
  field: string
  before?: string
  after?: string
  cause?: string
  persistencePolicy: 'temporary' | 'ongoing' | 'resolved' | 'unknown'
  reversible?: boolean
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
  triggerEventId?: number
  sourceSegmentId?: number
  stateDeltaJson?: string
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
  triggerEventId?: number
  sourceSegmentId?: number
  stateDeltaJson?: string
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
  triggerEventId?: number
  sourceSegmentId?: number
  stateDeltaJson?: string
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
  dashDensity: number
  parentheticalExplanationDensity: number
  metaphorStackRate: number
  parallelismRate: number
  bodyDetailClicheRate: number
  isolatedTemplateParagraphRate: number
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

export interface AntiAiRuleHitDetail {
  ruleCode: string
  ruleTitle: string
  severity: 'low' | 'medium' | 'high'
  source: 'guardrail' | 'language_drift'
  excerpt: string
  promotedToHardConstraint: boolean
}

export interface AntiAiRuleTrendSummary {
  ruleCode: string
  ruleTitle: string
  scope: 'expression' | 'sentence' | 'structure' | 'genre' | 'drift' | 'quality'
  severity: 'low' | 'medium' | 'high'
  chapterCount: number
  hitCount: number
  promotedCount: number
  chapterNums: number[]
  lastChapterNum: number
  sourceBreakdown: Record<'guardrail' | 'language_drift', number>
  detail: string
}

export interface AntiAiPromotedRuleSummary {
  ruleCode: string
  ruleTitle: string
  scope: 'expression' | 'sentence' | 'structure' | 'genre' | 'drift' | 'quality'
  chapterNums: number[]
  avoid: string
  prefer?: string
}

export interface AntiAiRecentAlert {
  ruleCode: string
  ruleTitle: string
  severity: 'warning' | 'critical'
  chapterNums: number[]
  lastChapterNum: number
  detail: string
}

export interface VolumeAntiAiRecurrenceEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  hitChapterCount: number
  recurringRuleCount: number
  promotedRuleCount: number
  highRiskRuleCount: number
}

export type FeedbackRecurrenceIssueType =
  | 'cost_evaporation'
  | 'forced_reversal'
  | 'too_smooth'
  | 'ai_slogan'
  | 'template_emotion'
  | 'template_connector'
  | 'explanatory_narration'
  | 'ornament_overload'
  | 'sensory_anchor_missing'
  | 'weak_stance'
  | 'transition_density'
  | 'emotion_monotony'
  | 'world_exposition_dump'
  | 'pov_drift'
  | 'thread_stalled'
  | 'dialogue_homogenized'

export type FeedbackRecurrenceSource =
  | 'review'
  | 'chapter_gate'
  | 'contract_validation'
  | 'anti_ai'

export interface FeedbackRecurrenceIssueDetail {
  issueType: FeedbackRecurrenceIssueType
  title: string
  severity: 'low' | 'medium' | 'high'
  source: FeedbackRecurrenceSource
  detail: string
  promotedToHardConstraint: boolean
  pauseSuggested: boolean
}

export interface FeedbackRecurrenceTrendSummary {
  issueType: FeedbackRecurrenceIssueType
  title: string
  severity: 'low' | 'medium' | 'high'
  chapterCount: number
  hitCount: number
  promotedCount: number
  chapterNums: number[]
  lastChapterNum: number
  sourceBreakdown: Record<FeedbackRecurrenceSource, number>
  detail: string
  pauseSuggested: boolean
}

export interface FeedbackRecurrencePromotedIssueSummary {
  issueType: FeedbackRecurrenceIssueType
  title: string
  chapterNums: number[]
  avoid: string
  prefer?: string
  pauseSuggested: boolean
}

export interface FeedbackRecurrenceAlert {
  issueType: FeedbackRecurrenceIssueType
  title: string
  severity: 'warning' | 'critical'
  chapterNums: number[]
  lastChapterNum: number
  detail: string
  pauseSuggested: boolean
}

export interface VolumeFeedbackRecurrenceEntry {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
  hitChapterCount: number
  recurringIssueCount: number
  promotedIssueCount: number
  highRiskIssueCount: number
  pauseSuggestedIssueCount: number
}

export interface HumanizationSignal {
  issueType:
    | 'ai_slogan'
    | 'template_emotion'
    | 'template_connector'
    | 'explanatory_narration'
    | 'ornament_overload'
    | 'sensory_anchor_missing'
    | 'weak_stance'
    | 'transition_density'
    | 'emotion_monotony'
    | 'world_exposition_dump'
  title: string
  severity: 'low' | 'medium' | 'high'
  detail: string
  avoid: string
  prefer?: string
  metricKey?: string
  metricValue?: number
}

export type QualityDashboardRiskKind =
  | 'commitment_delivery'
  | 'typed_ref_coverage'
  | 'source_grounding'
  | 'operating_mode_policy'
  | 'genre_register_drift'
  | 'exposition_density'
  | 'long_window_homogenization'
  | 'dialogue_separability'
  | 'language_drift'
  | 'feedback_recurrence'
  | 'style_compliance'
  | 'voice_distinction'
  | 'growth_cost_balance'
  | 'story_dynamics'
  | 'chapter_function'
  | 'story_arc'
  | 'foreshadow_debt'
  | 'endgame_debt'
  | 'recall'
  | 'world_state'
  | 'info_reveal_pacing'

export type QualityDashboardRiskSeverity = 'info' | 'warning' | 'critical'
export type QualityRepairMetricKey =
  | 'commitment_delivery'
  | 'typed_ref_coverage'
  | 'source_grounding'
  | 'operating_mode_policy'
  | 'genre_register_drift'
  | 'exposition_density'
  | 'long_window_homogenization'
  | 'dialogue_separability'
  | 'language_drift'
  | 'feedback_recurrence'
  | 'style_compliance'
  | 'recall'
  | 'chapter_function'
  | 'story_arc'
  | 'voice_distinction'
  | 'growth_cost_balance'
  | 'foreshadow_debt'
  | 'world_state_drift'
  | 'info_reveal_pacing'
export type QualityRepairActionType =
  | 'create_revision_task'
  | 'open_chapter_rewrite'
  | 'open_bridge_patch'
  | 'sync_timeline'
  | 'sync_character_state'
  | 'allow_deviation'

export interface QualityRepairTaskDraft {
  issueKey?: string
  taskType: string
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  fixBrief?: string
  relatedPage: string
  entityType?: string
  entityId?: number
  chapterId?: number
  originMeta?: Record<string, unknown>
}

export interface QualityRepairAction {
  id: string
  label: string
  description: string
  actionType: QualityRepairActionType
  metricKey: QualityRepairMetricKey
  targetPage: string
  safeToExecute: boolean
  chapterId?: number
  chapterNum?: number
  entityType?: string
  entityId?: number
  navigationQuery?: Record<string, string>
  taskDraft?: QualityRepairTaskDraft
}

export interface QualityRepairActionResult {
  actionId: string
  status: 'task_created' | 'executed' | 'unsupported' | 'failed'
  message: string
  taskId?: number
  relatedPage?: string
  chapterId?: number
  entityType?: string
  entityId?: number
  navigationQuery?: Record<string, string>
}

export interface QualityRepairMetricSummary {
  key: QualityRepairMetricKey
  label: string
  score: number
  summary: string
  riskCount: number
  focusLabels: string[]
}

export interface QualityRepairActionSummary {
  actionableRiskCount: number
  taskActionCount: number
  directExecutableActionCount: number
  allowDeviationCount: number
  topPriorityActions: string[]
}

export interface QualityDashboardRiskItem {
  kind: QualityDashboardRiskKind
  severity: QualityDashboardRiskSeverity
  title: string
  detail: string
  volumeId?: number
  chapterNums: number[]
  metricKey?: QualityRepairMetricKey
  whyItHappened: string
  howToFix: string
  suggestedActions: QualityRepairAction[]
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
  endgamePendingCount: number
  endgameServedCount: number
  endgameOverdueCount: number
  endgameUnboundCount: number
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
  foreshadowBlockedCount: number
  foreshadowStaleCount: number
  storyThreadAdvanceRate: number
  storyThreadMentionOnlyCount: number
  endgameActiveCount: number
  endgameServedCount: number
  endgameOverdueCount: number
  endgameUnboundCount: number
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

export type PlatformFormat = 'fanqie' | 'qidian' | 'jjwxc' | 'generic'
export type PlatformFormatScope = 'currentChapter' | 'selectedChapters' | 'all'

export interface PlatformFormatOptions {
  platform?: PlatformFormat
  scope?: PlatformFormatScope
  chapterId?: number
  chapterIds?: number[]
  batchSize?: number
  sensitiveWords?: string[]
}

export interface PlatformFormatBatch {
  index: number
  title: string
  content: string
  chapterCount: number
  wordCount: number
  chapterStart?: number
  chapterEnd?: number
}

export interface PlatformFormatResult {
  platform: PlatformFormat
  scope: PlatformFormatScope
  title: string
  content: string
  chapterCount: number
  wordCount: number
  warnings: string[]
  removedLineCount: number
  sensitiveWordHits: Array<{
    word: string
    count: number
    chapterNums: number[]
  }>
  batches: PlatformFormatBatch[]
}

export interface ChapterOptimizationFactGuard {
  safeToApply: boolean
  warnings: string[]
  introducedTrackedEntities: string[]
  removedTrackedEntities: string[]
  changedNumbers: string[]
  endingHookChanged: boolean
  aiProcessLeakCount: number
}

export interface ChapterOptimizationQualityGate {
  safeToApply: boolean
  warnings: string[]
  originalGuardrailHits: string[]
  optimizedGuardrailHits: string[]
  originalStrongAiFlavorCount: number
  optimizedStrongAiFlavorCount: number
  originalHighSeverityCount: number
  optimizedHighSeverityCount: number
  originalDriftScore: number
  optimizedDriftScore: number
  languageDriftBefore: LanguageDriftMetrics
  languageDriftAfter: LanguageDriftMetrics
}

export interface ChapterOptimizeResult {
  originalContent: string
  optimizedContent: string
  issueSummary: string[]
  guardrailHits: string[]
  changed: boolean
  warnings: string[]
  factGuard: ChapterOptimizationFactGuard
  qualityGate: ChapterOptimizationQualityGate
  taskId?: number
  optimizationPasses?: number
}

export type WorkspaceQualityIssueKind =
  | 'relevance_drift'
  | 'workflow_misalignment'
  | 'context_loss'
  | 'ai_like_language'
  | 'ornament_overload'
  | 'fabricated_terms'
  | 'incoherent_sentence'
  | 'format_noise'
  | 'flat_narration'

export type WorkspaceQualitySeverity = 'info' | 'warning' | 'critical'
export type WorkspaceQualityAiFlavorSeverity = 'low' | 'medium' | 'high'
export type WorkspaceQualityPatchKind = 'field' | 'entity'

export interface WorkspaceQualityIssue {
  id: string
  kind: WorkspaceQualityIssueKind
  severity: WorkspaceQualitySeverity
  title: string
  description: string
  suggestion: string
  path?: string[]
  entityId?: number
  entityLabel?: string
  excerpt?: string
}

export interface WorkspaceQualityFieldResult {
  path: string[]
  label: string
  score: number
  severity: WorkspaceQualitySeverity
  issues: string[]
  suggestions: string[]
}

export interface WorkspaceQualityEntityResult {
  path: string[]
  label: string
  severity: WorkspaceQualitySeverity
  summary: string
  issues: string[]
  suggestions: string[]
  entityId?: number
}

export interface WorkspaceAiFlavorBreakdownItem {
  key: string
  label: string
  value: number
}

export interface WorkspaceAiFlavorReport {
  score: number
  severity: WorkspaceQualityAiFlavorSeverity
  summary: string
  breakdown: WorkspaceAiFlavorBreakdownItem[]
  sampleFindings: string[]
  humanizationDirections: string[]
  humanizationSignals: HumanizationSignal[]
}

export interface WorkspaceQualityAnalyzeRequest {
  novelId: number
  workspaceKey: string
  pageKey?: string
  workspaceLabel?: string
  workspaceSummary?: string
  contentSnapshot: Record<string, unknown>
  upstreamContext?: string
  downstreamContext?: string
  themeVoiceSummary?: string
  projectBriefSummary?: string
  backgroundSummary?: string
  genreContext?: string
  modelConfigId?: number
}

export interface WorkspaceQualityAnalyzeResult {
  summary: string
  severity: WorkspaceQualitySeverity
  overallScore: number
  aiFlavor: WorkspaceAiFlavorReport
  globalIssues: WorkspaceQualityIssue[]
  fieldResults: WorkspaceQualityFieldResult[]
  entityResults: WorkspaceQualityEntityResult[]
  repairPriority: string[]
  warnings: string[]
}

export interface WorkspaceQualityPatch {
  id: string
  patchKind: WorkspaceQualityPatchKind
  path: string[]
  label: string
  before: string
  after: string
  reason: string
  entityId?: number
  entityLabel?: string
}

export interface WorkspaceQualityRepairRequest extends WorkspaceQualityAnalyzeRequest {
  extraRequirements?: string
  issues?: WorkspaceQualityIssue[]
}

export interface WorkspaceQualityRepairPreview {
  summary: string
  warnings: string[]
  aiFlavor: WorkspaceAiFlavorReport
  fieldPatches: WorkspaceQualityPatch[]
  entityPatches: WorkspaceQualityPatch[]
  patchedSnapshot: Record<string, unknown>
}

export interface QualityDashboardData {
  dashboardVersion?: 'v1-health' | 'v2-repair'
  dashboardNotes?: string[]
  agentQualityObservability?: QualityAgentDashboardSnapshot
  operatingModeObservability?: {
    mode: NovelOperatingMode
    label: string
    summary: string
    quickStartAligned: boolean
    recommendedChapterWords?: number
    estimatedChapterCount?: number
    recentContextWindow?: number
  }
  millionRuntimeObservability?: {
    operatingMode: NovelOperatingMode
    label: string
    strategySummary: string
    chapterGenerationMode: 'serial_only'
    serialOnly: boolean
    backgroundPrecomputeEnabled: boolean
    requireWritebackReady: boolean
    recallPauseThreshold: number
    checkpointGapWarningThreshold: number
    mainThreadPressureStrategy: 'latency_first' | 'balanced' | 'stability_first'
    guardrailActive: boolean
    activeGuardrailReason?: string
    pauseReason?: string
    writebackPendingCount: number
    writebackFailedCount: number
    staleCheckpointCount: number
    latestCheckpointChapterGap: number
    recallDegradedChapterCount: number
    consecutiveRecallFallbackChapters: number
    inspectionBlockedCount: number
    batchGateBlockedCount: number
    precomputeQueueStatus: 'idle' | 'queued' | 'running' | 'failed'
    precomputeLastError?: string
    precomputeReason?: string
    precomputeUpdatedAt?: string
    precomputeActiveTaskSummary?: string
    runtimePressureLevel: 'low' | 'medium' | 'high'
    runtimePressureScore: number
    runtimePressureSummary: string
    summary: string
  }
  genreGroundingObservability?: {
    genreName: string
    resolvedGenreKey: string
    historicalGenericFallback: boolean
    historicalMode?: 'none' | 'historical_realist' | 'alternate_history' | 'pseudo_historical_fantasy'
    sourceCoverage?: 'none' | 'partial' | 'grounded'
    conservativeFallbackActive?: boolean
    sourceSignalCount?: number
    summary: string
  }
  typedRefObservability?: {
    overallCoverageRate: number
    unresolvedRefCount: number
    buckets: Array<{
      assetType: 'thread' | 'timeline' | 'item'
      totalCount: number
      typedRefCount: number
      unresolvedCount: number
      coverageRate: number
    }>
    summary: string
  }
  structuredMemoryObservability?: {
    promptSummaryMode: 'structured_first'
    activeScopeLabels: string[]
    scopeCoverageRate: number
    cardCoverageRate: number
    structuredScopeCount: number
    fallbackScopeCount: number
    buckets: Array<{
      scopeType: 'novel' | 'volume' | 'part'
      label: string
      hasCheckpoint: boolean
      structuredFamilyCount: number
      fallbackFamilyCount: number
      missingFamilyCount: number
      cardCoverageRate: number
      usesTextFallback: boolean
    }>
    summary: string
  }
  repairActionSummary: QualityRepairActionSummary
  repairMetrics: QualityRepairMetricSummary[]
  heatmapData: Array<{ chapterNum: number; dimension: string; score: number }>
  overallScoreTrend: Array<{ chapterNum: number; score: number }>
  aiLikeRateTrend: Array<{ chapterNum: number; rate: number }>
  chapterGateTrend: ChapterGateTrendPoint[]
  chapterGateHeatmap: ChapterGateHeatmapPoint[]
  chapterGateSummary: ChapterGateSummary
  chapterGateDriftAlerts: ChapterGateDriftAlert[]
  languageDriftTrends: {
    abstractTokenDensity: Array<{ chapterNum: number; value: number }>
    sentencePatternRepeatRate: Array<{ chapterNum: number; value: number }>
    endingSummaryRate: Array<{ chapterNum: number; value: number }>
    ornamentOverloadRate: Array<{ chapterNum: number; value: number }>
    nonHumanCollocationRate: Array<{ chapterNum: number; value: number }>
    dashDensity: Array<{ chapterNum: number; value: number }>
    parentheticalExplanationDensity: Array<{ chapterNum: number; value: number }>
    metaphorStackRate: Array<{ chapterNum: number; value: number }>
    parallelismRate: Array<{ chapterNum: number; value: number }>
    bodyDetailClicheRate: Array<{ chapterNum: number; value: number }>
    isolatedTemplateParagraphRate: Array<{ chapterNum: number; value: number }>
  }
  averageLanguageDrift: LanguageDriftMetrics
  recentLanguageDriftAlerts: LanguageDriftTrendSummary[]
  volumeLanguageDrift: VolumeLanguageDriftEntry[]
  novelLanguageDriftSummary: NovelLanguageDriftSummary
  antiAiRecurrence: {
    totalHitCount: number
    hitChapterCount: number
    recurringRuleCount: number
    promotedRuleCount: number
    highRiskRuleCount: number
    topRepeatedRules: AntiAiRuleTrendSummary[]
    promotedRules: AntiAiPromotedRuleSummary[]
    recentAlerts: AntiAiRecentAlert[]
    volumeEntries: VolumeAntiAiRecurrenceEntry[]
  }
  feedbackRecurrence: {
    totalHitCount: number
    hitChapterCount: number
    recurringIssueCount: number
    promotedIssueCount: number
    highRiskIssueCount: number
    pauseSuggestedIssueCount: number
    topRepeatedIssues: FeedbackRecurrenceTrendSummary[]
    promotedIssues: FeedbackRecurrencePromotedIssueSummary[]
    recentAlerts: FeedbackRecurrenceAlert[]
    humanization: {
      totalHitCount: number
      hitChapterCount: number
      recurringIssueCount: number
      promotedIssueCount: number
      highRiskIssueCount: number
      pauseSuggestedIssueCount: number
      topRepeatedIssues: FeedbackRecurrenceTrendSummary[]
      promotedIssues: FeedbackRecurrencePromotedIssueSummary[]
      recentAlerts: FeedbackRecurrenceAlert[]
    }
    volumeEntries: VolumeFeedbackRecurrenceEntry[]
  }
  styleCompliance: {
    analyzedChapterCount: number
    passCount: number
    warningCount: number
    rewriteCount: number
    averageScore: number
    recentAlerts: Array<{
      chapterId: number
      chapterNum: number
      title: string
      status: 'warning' | 'rewrite'
      score: number
      summary: string
    }>
  }
  dialogueFingerprintStats: DialogueFingerprintStats
  characterDialogueSignatures: CharacterDialogueSignature[]
  crossCharacterDialogueSimilarity: CrossCharacterDialogueSimilarity[]
  dialogueDriftTrend: CharacterDialogueDriftEntry[]
  volumeDialogueSimilarity: VolumeDialogueSimilarityEntry[]
  recentDialogueAlerts: DialogueAlert[]
  requiredDialogueVoiceLocks: DialogueVoiceLockCandidate[]
  storyDynamicsTrend: StoryDynamicsTrendPoint[]
  storyPacingAlerts: StoryDynamicsAlert[]
  volumeStoryDynamics: VolumeStoryDynamicsEntry[]
  volumeQualityMetrics: VolumeQualityMetrics[]
  novelQualityMetrics: NovelQualityMetrics
  productionReadiness: ProductionReadinessSummary
  batchHealth: BatchHealthSummary
  continuityHealth: ContinuityHealthSummary
  contractDelivery: ContractDeliverySummary
  batchReview: BatchReviewSummary
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
  expressionDedupSummary: {
    analyzedChapterCount: number
    currentMode: ExpressionDedupMode
    recentWindowSize: number
    volumeWindowSize: number
    globalSampleWindowSize: number
    highRiskChapterCount: number
    recentHighRiskChapterNums: number[]
    topRepeatedPhrases: ExpressionDedupHit[]
    repeatedOpeningPatterns: string[]
    repeatedClosingPatterns: string[]
    repeatedStructuralPatterns: string[]
    repeatedClimaxPatterns: string[]
    volumeRepeatedPatterns: string[]
    globalRepeatedPatterns: string[]
    summary: string
  }
  summaryHealthSummary: {
    analyzedChapterCount: number
    degradedChapterCount: number
    averageDensityScore: number
    averageEntityCoverageScore: number
    averageEventCoverageScore: number
    recentAlerts: Array<{
      chapterId: number
      chapterNum: number
      status: SummaryHealthReport['status']
      summary: string
    }>
    summary: string
  }
  hookContinuitySummary: {
    analyzedChapterCount: number
    weakHookChapterCount: number
    weakHookStreak: number
    averageHookStrengthScore: number
    recentHookTypes: string[]
    summary: string
  }
  voiceEvolutionSummary: {
    trackedCharacterCount: number
    driftingCharacterCount: number
    profiles: VoiceEvolutionProfile[]
    summary: string
  }
  recallSummary: {
    analyzedChapterCount: number
    recallAvailabilityRate: number
    averageHitCount: number
    bucketCoverageRate: number
    consecutiveFallbackChapters: number
    latestFallbackReason?: RecallFallbackReason
    recallDependencyRate: number
    staleRecallCount: number
    staleRecallRate: number
    fallbackHitCount: number
    selectedHitCount: number
    validatedHitCount: number
    lowSimilarityRejectedCount: number
    entityValidationRejectedCount: number
    minVectorSimilarity: number
    minKeywordSimilarity: number
    previousChapterFeedCoverageRate: number
    previousChapterFeedChars: number
  }
  recentRecallAlerts: Array<{
    chapterId: number
    chapterNum: number
    title: string
    degraded: boolean
    retrievalUsed: boolean
    recallSnapshotSource?: RecallRuntimeSnapshotSource
    fallbackReason?: RecallFallbackReason
    consecutiveFallbackChapters?: number
    staleRecallCount: number
    detail: string
  }>
  recentEndgameDebtAlerts: EndgameDebtAlert[]
  volumeRecallDiagnostics: Array<{
    volumeId: number
    volumeNumber: number
    volumeName: string
    chapterStart: number
    chapterEnd: number
    chapterCount: number
    recallAvailabilityRate: number
    averageHitCount: number
    bucketCoverageRate: number
    degradedChapterCount: number
    latestFallbackReason?: RecallFallbackReason
    recallDependencyRate: number
    staleRecallCount: number
    staleRecallRate: number
    validatedHitCount: number
    lowSimilarityRejectedCount: number
    entityValidationRejectedCount: number
    minVectorSimilarity: number
    minKeywordSimilarity: number
    previousChapterFeedCoverageRate: number
    previousChapterFeedChars: number
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
    antiAiRuleHits?: AntiAiRuleHitDetail[]
    feedbackRecurrenceHits?: FeedbackRecurrenceIssueDetail[]
    styleCompliance?: StyleComplianceResult
    dialogueReview?: ChapterDialogueReviewData
    storyDynamics?: ChapterStoryDynamics
    chapterFunction?: ChapterFunctionDetail
    storyArcProgress?: StoryArcProgressPoint[]
    worldStateAlerts?: WorldStateAlert[]
    recallSnapshot?: RecallSnapshot
    recallSnapshotSource?: RecallRuntimeSnapshotSource
    recallDiagnostics?: RecallDiagnostics
    chapterGate?: ChapterGateChapterDetail
  }>
  totalChaptersScored: number
  averageOverallScore: number
  averageAiLikeRate: number
}

export interface StyleHardGuard {
  summary: string
  sentenceLengthRange: {
    min: number
    max: number
    target: number
  }
  paragraphLengthRange: {
    min: number
    max: number
    target: number
  }
  dialogueLineRateRange: {
    min: number
    max: number
    target: number
  }
  abstractTokenDensityMax: number
  hardRules: string[]
  rewriteTriggers: string[]
}

export interface StyleComplianceMetricSnapshot {
  avgSentenceLength: number
  avgParagraphLength: number
  dialogueLineRate: number
  abstractTokenDensity: number
}

export interface StyleComplianceResult {
  status: 'pass' | 'warning' | 'rewrite'
  score: number
  summary: string
  deviations: string[]
  rewriteHints: string[]
  matchedForbiddenPatterns: string[]
  forbiddenPatternHitCount: number
  referenceMetrics: StyleComplianceMetricSnapshot
  actualMetrics: StyleComplianceMetricSnapshot
}

export interface StyleFingerprint {
  avgSentenceLength: number
  avgParagraphLength: number
  dialogueLineRate: number
  abstractTokenDensity: number
  sentencePatterns: string[]
  wordFrequencyProfile: Record<string, string[]>
  narrativeTechniques: string
  dialogueStyle: string
  descriptionDensity: string
  paceProfile: string
  toneKeywords: string[]
  forbiddenPatterns: string[]
  exampleExcerpts: string[]
  styleHardGuard?: StyleHardGuard
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

export interface DialogueVoiceLock {
  characterId: number
  characterName: string
  mustKeep: string[]
  mustAvoid: string[]
  relationTone: string
  sampleHint: string
}

export interface DialogueVoiceLockCandidate {
  characterId: number
  characterName: string
  reason: string
  severity: 'warning' | 'critical'
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
  voiceLockCandidateCount: number
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
  voiceLockSummary?: string
  risks: string[]
  similarities: DialogueSimilarityWarning[]
  drifts: DialogueDriftWarning[]
  fillerRisks: string[]
  infoDensityRisks: string[]
  requiredVoiceLockCharacterIds: number[]
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
      windowControls: {
        minimize: () => Promise<void>
        toggleMaximize: () => Promise<boolean>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizedStateChange: (callback: (isMaximized: boolean) => void) => () => void
      }
      app: {
        getDatabasePath: () => Promise<string>
        getLocalBackendStatus?: () => Promise<{
          isWebPreview: boolean
          status: 'checking' | 'connected' | 'unavailable'
          connected: boolean
          lastError: string
          message: string
          capabilities?: {
            realDatabase: boolean
            writesEnabled: boolean
            generationEnabled: boolean
            eventStreaming: boolean
          }
          demoFallbackEnabled?: boolean
        }>
      }
      agentTools: {
        list: (query?: AgentToolListQuery) => Promise<AgentToolDescriptor[]>
        call: (request: AgentToolCallRequest) => Promise<AgentToolCallResult>
        approve: (request: AgentToolApprovalRequest) => Promise<AgentToolApprovalResult>
      }
      aiPatch: {
        suggest: (request: AiPatchRequest) => Promise<AiPatchResult>
        apply: (target: AiPatchTarget, patch: Record<string, unknown>) => Promise<unknown>
      }
      novel: {
        list: (filters?: unknown) => Promise<Novel[]>
        get: (id: number) => Promise<Novel | null>
        create: (data: NovelCreateInput) => Promise<number>
        update: (id: number, data: Partial<Novel>) => Promise<void>
        delete: (id: number) => Promise<void>
        export: (id: number, format: string) => Promise<string>
        formatForPlatform: (id: number, options: PlatformFormatOptions) => Promise<PlatformFormatResult>
        stats: (id: number) => Promise<{ totalChapters: number; completedChapters: number; totalWords: number; characterCount: number }>
        runConsistencyCheck: (id: number) => Promise<NovelConsistencyReport>
        getStoryMemory: (id: number) => Promise<StoryMemorySnapshot>
        getWorldStateSnapshot: (id: number, upToChapterNum?: number) => Promise<{ currentStates: WorldStateSummary[]; alerts: WorldStateAlert[]; worldStatesText: string; trendSummary: string[] }>
        getWorldStateLedgerSnapshot: (id: number, upToChapterNum?: number) => Promise<WorldStateLedgerSnapshot>
        getWorldStateHistory: (novelId: number, entityType: WorldStateEntityType, entityId: number, stateKey?: string, limit?: number) => Promise<WorldStateVersion[]>
        getContextStatus: (id: number) => Promise<NovelContextStatus>
        getImpactSummary: (id: number) => Promise<AssetImpactSummary>
        listImpactEvents: (id: number) => Promise<AssetChangeEvent[]>
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
        getLinkageSummary: (novelId: number) => Promise<StructureLinkageSummary>
        syncLinkage: (novelId: number) => Promise<StructureLinkageSyncResult>
        clear: (novelId: number) => Promise<{
          volumesCleared: number
          partsCleared: number
          chaptersCleared: number
          segmentsCleared: number
          checkpointsCleared: number
        }>
        applyBatchPlan: (novelId: number, plan: StructureBatchPlan) => Promise<StructureBatchApplyResult>
        previewBatchEdit: (novelId: number, operations: StructureBatchEditOperation[]) => Promise<StructureBatchPreview>
        applyBatchEdit: (novelId: number, operations: StructureBatchEditOperation[]) => Promise<StructureBatchApplyResult>
      }
      endgameAsset: {
        listCommitments: (novelId: number) => Promise<EndgameCommitment[]>
        getSummary: (novelId: number) => Promise<EndgameAssetSummary>
        syncFromSettings: (novelId: number, settingsJson?: string | null) => Promise<{
          commitments: EndgameCommitment[]
          summary: EndgameAssetSummary
        }>
        updateCommitment: (id: number, data: Partial<Pick<EndgameCommitment, 'title' | 'description' | 'status' | 'targetResolutionChapter' | 'fulfilledChapter' | 'notes'>>) => Promise<EndgameCommitment | null>
      }
      foreshadow: {
        listLedger: (novelId: number) => Promise<ForeshadowLedgerEntry[]>
        upsertLedger: (novelId: number, data: Partial<ForeshadowLedgerEntry>) => Promise<ForeshadowLedgerEntry[]>
        deleteLedger: (novelId: number, id: number) => Promise<ForeshadowLedgerEntry[]>
      }
      volumeDesign: {
        list: (novelId: number) => Promise<VolumeDesignAsset[]>
        getByVolume: (volumeId: number) => Promise<VolumeDesignAsset>
        upsert: (volumeId: number, data: Partial<VolumeDesignAsset>) => Promise<VolumeDesignAsset>
        auditVolume: (volumeId: number, options?: {
          createRevisionTasks?: boolean
        }) => Promise<VolumeAuditResult>
        syncConstraints: (volumeId: number) => Promise<VolumeConstraintSyncResult>
      }
      contract: {
        getChapter: (chapterId: number) => Promise<ChapterContractAsset>
        upsertChapter: (chapterId: number, data: Partial<ChapterContractAsset>) => Promise<ChapterContractAsset>
        listScenes: (chapterId: number) => Promise<SceneContractAsset[]>
        upsertScene: (chapterId: number, segmentId: number | null, data: Partial<SceneContractAsset>) => Promise<SceneContractAsset[]>
      }
      storyFact: {
        list: (novelId: number) => Promise<StoryFact[]>
        get: (id: number) => Promise<StoryFact | null>
        create: (novelId: number, data: Partial<StoryFact>) => Promise<number>
        update: (id: number, data: Partial<StoryFact>) => Promise<void>
        delete: (id: number) => Promise<void>
      }
      growthSystem: {
        getDashboard: (novelId: number) => Promise<GrowthSystemDashboard>
        listTracks: (novelId: number) => Promise<GrowthTrack[]>
        upsertTrack: (novelId: number, data: Partial<GrowthTrack>) => Promise<GrowthTrack[]>
        deleteTrack: (novelId: number, id: number) => Promise<GrowthTrack[]>
        listPools: (novelId: number) => Promise<ResourcePool[]>
        upsertPool: (novelId: number, data: Partial<ResourcePool>) => Promise<ResourcePool[]>
        deletePool: (novelId: number, id: number) => Promise<ResourcePool[]>
        listEvents: (novelId: number) => Promise<RewardCostEvent[]>
        upsertEvent: (novelId: number, data: Partial<RewardCostEvent>) => Promise<RewardCostEvent[]>
        deleteEvent: (novelId: number, id: number) => Promise<RewardCostEvent[]>
        bindChapterContract: (novelId: number, data: {
          chapterId: number
          trackIds: number[]
          poolIds: number[]
          eventIds: number[]
        }) => Promise<{
          chapterId: number
          boundTrackCount: number
          boundPoolCount: number
          boundEventCount: number
        }>
        bindVolumeDesign: (novelId: number, data: {
          volumeId: number
          trackIds: number[]
          poolIds: number[]
          rewardCadence?: string
        }) => Promise<{
          volumeId: number
          boundTrackCount: number
          boundPoolCount: number
        }>
      }
      characterArc: {
        listCharacterArcs: (novelId: number) => Promise<CharacterArc[]>
        getCharacterArc: (arcId: number) => Promise<CharacterArc | null>
        upsertCharacterArc: (data: CharacterArcInput) => Promise<CharacterArc>
        upsertCharacterArcBeat: (data: CharacterArcBeatInput) => Promise<CharacterArcBeat>
        listRelationshipArcs: (novelId: number) => Promise<RelationshipArc[]>
        upsertRelationshipArc: (data: RelationshipArcInput) => Promise<RelationshipArc>
        getArcDashboard: (novelId: number) => Promise<CharacterArcDashboard>
      }
      resistance: {
        listTracks: (novelId: number) => Promise<ResistanceTrack[]>
        getTrack: (trackId: number) => Promise<ResistanceTrack | null>
        upsertTrack: (data: ResistanceTrackInput) => Promise<ResistanceTrack>
        upsertBeat: (data: ResistanceBeatInput) => Promise<ResistanceBeat>
        getDashboard: (novelId: number) => Promise<ResistanceDashboard>
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
        getContextPreview: (chapterId: number, options?: {
          executionMode?: AiExecutionMode
          preserveConstraintLabels?: HardConstraintSourceLabel[]
        }) => Promise<ChapterContextPreview>
        generateContent: (chapterId: number, options?: {
          executionMode?: AiExecutionMode
          preserveConstraintLabels?: HardConstraintSourceLabel[]
        }) => Promise<number>
        resumeContent: (taskId: number) => Promise<number>
        generateSummary: (chapterId: number) => Promise<void>
        aiCheck: (chapterId: number) => Promise<unknown>
        runPublishCheck: (chapterId: number) => Promise<ChapterPublishCheck>
        optimizeContent: (chapterId: number, options?: {
          executionMode?: AiExecutionMode
          extraRequirements?: string
        }) => Promise<ChapterOptimizeResult>
      }
      chapterBatch: {
        startAutoGenerate: (novelId: number, options: ChapterBatchGenerateOptions) => Promise<number>
        getAutoGenerateStatus: (taskId: number) => Promise<ChapterBatchAutoGenerateStatus | null>
        getLatestAutoGenerateTask: (novelId: number) => Promise<Task | null>
        resumeAutoGenerate: (taskId: number) => Promise<number>
        startQualityAnalysis: (novelId: number, options?: ChapterQualityAnalysisOptions) => Promise<number>
        getQualityAnalysisStatus: (taskId: number) => Promise<ChapterQualityAnalysisStatus | null>
        getLatestQualityAnalysisTask: (novelId: number) => Promise<Task | null>
        resumeQualityAnalysis: (taskId: number) => Promise<number>
      }
      writeback: {
        prepareRun: (chapterId: number, triggerSource?: string) => Promise<ChapterWritebackRun>
        getCenterData: (chapterId: number, runId?: number) => Promise<ChapterWritebackCenterData>
        listRuns: (chapterId: number) => Promise<ChapterWritebackRun[]>
        updateDecision: (diffId: number, patch: {
          canonDecision?: ChapterWritebackDecision
          afterStateJson?: string
          diffReason?: string
        }) => Promise<ChapterWritebackDiff>
        bulkUpdateDecisions: (runId: number, patch: {
          canonDecision: Exclude<ChapterWritebackDecision, 'pending'>
          assetType?: ChapterWritebackAssetType
        }) => Promise<ChapterWritebackDiff[]>
        applyRun: (runId: number, options?: ChapterWritebackApplyOptions) => Promise<ChapterWritebackCenterData>
        retryFailed: (runId: number, options?: ChapterWritebackApplyOptions) => Promise<ChapterWritebackCenterData>
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
        suggestPatch: (id: number, instruction: string) => Promise<CharacterAiPatchResult>
        applyPatch: (id: number, patch: Partial<Character>) => Promise<Character | null>
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
        batchGenerateToTarget: (novelId: number, structure: MapBatchGenerateOptions) => Promise<MapGenerateToTargetResult>
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
        getLinkRecommendations: (itemId: number) => Promise<StoryItemLinkRecommendationResult>
        applyLinkRecommendations: (itemId: number, data: {
          eventIds?: number[]
          segmentIds?: number[]
        }) => Promise<StoryItemLinkApplyResult>
        repairCharacterLinks: (novelId: number) => Promise<ItemCharacterLinkRepairResult>
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
        clear: (novelId: number) => Promise<number>
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
        clear: (novelId: number) => Promise<number>
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
      sourceSearch: {
        getSettings: () => Promise<SourceSearchSettingsView>
        updateSettings: (data: SourceSearchSettingsUpdate) => Promise<SourceSearchSettingsView>
        test: () => Promise<SourceSearchTestResult>
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
        getPipelineStats: (novelId?: number) => Promise<TaskPipelineStats>
        getLatestChapterPipeline: (chapterId: number) => Promise<Task | null>
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
        backfillRecallSnapshots: (novelId: number) => Promise<ChapterRecallRuntimeBackfillResult>
        createRepairTask: (novelId: number, action: QualityRepairAction) => Promise<QualityRepairActionResult>
        executeRepairAction: (novelId: number, action: QualityRepairAction) => Promise<QualityRepairActionResult>
      }
      batchWorkbench: {
        getData: (novelId: number, snapshotId?: number) => Promise<BatchWorkbenchData>
        createInspection: (snapshotId: number, data: {
          chapterId?: number
          chapterNum?: number
          category: BatchInspectionCategory
          status: BatchInspectionStatus
          note: string
        }) => Promise<BatchInspectionRecord>
        previewRollback: (snapshotId: number, mode: BatchRollbackMode) => Promise<BatchRollbackImpactPreview>
        applyRollback: (snapshotId: number, mode: BatchRollbackMode) => Promise<BatchRollbackResult>
        getGlobalLockLibrary: (novelId: number) => Promise<GlobalLockLibrary>
        updateGlobalLockLibrary: (novelId: number, patch: Partial<GlobalLockLibrary>) => Promise<GlobalLockLibrary>
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
        rewriteParagraph: (data: {
          originalParagraph: string
          contextBefore: string
          specificRequirements: string
          modelConfigId?: number
          novelId?: number
          executionMode?: AiExecutionMode
        }) => Promise<string>
        runPrompt: (data: {
          messages: unknown[]
          count?: number
          modelConfigId?: number
          novelId?: number
          executionMode?: AiExecutionMode
        }) => Promise<string[]>
        scoreContent: (data: {
          contentType: string
          content: string
          genreContext: string
          novelBackground: string
          modelConfigId?: number
        }) => Promise<AIScoreResult>
        analyzeWorkspaceQuality: (data: WorkspaceQualityAnalyzeRequest) => Promise<WorkspaceQualityAnalyzeResult>
        repairWorkspaceQuality: (data: WorkspaceQualityRepairRequest) => Promise<WorkspaceQualityRepairPreview>
      }
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
      off: (channel: string, callback: (...args: unknown[]) => void) => void
    }
  }
}
