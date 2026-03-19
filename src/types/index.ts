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
  WorldRulesGenerationProgressEvent,
  WorldRulesGenerationRequest,
  WorldRulesGenerationResult,
} from '../shared/world-rules-generation'

export type {
  CoreSettingsGenerationProgressEvent,
  CoreSettingsGenerationRequest,
  CoreSettingsGenerationResult,
} from '../shared/core-settings-generation'
export type {
  WorldRulesGenerationProgressEvent,
  WorldRulesGenerationRequest,
  WorldRulesGenerationResult,
} from '../shared/world-rules-generation'

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
  settingsJson?: string
  worldRulesJson?: string
  styleTemplateId?: number
  worldTemplateId?: number
  modelConfigId?: number
  createdAt: string
  updatedAt: string
}

export interface Chapter {
  id: number
  novelId: number
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
  createdAt: string
  updatedAt: string
}

export interface Character {
  id: number
  novelId: number
  roleType: 'protagonist' | 'major' | 'minor' | 'antagonist' | 'supporting'
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

export interface MapBatchGenerateOptions {
  layerCounts?: number[] | Array<{ depth: number; count: number }>
  namedPlaces?: string
  parentBatchSize?: number
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
  chapterStartId?: number
  chapterEndId?: number
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
  sortOrder: number
  createdAt: string
  updatedAt: string
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
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  inputJson?: string
  outputText?: string
  modelConfigId?: number
  tokensUsed?: number
  durationMs?: number
  errorMessage?: string
  relatedEntityType?: string
  relatedEntityId?: number
  createdAt: string
  updatedAt: string
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
  category: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'outline' | 'continuity'
  title: string
  description: string
  suggestion: string
  entityType?: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'arc'
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
  }
  issues: ConsistencyIssue[]
}

export interface StoryMemorySnapshot {
  generatedAt: string
  chapterCount: number
  lastChapterNum: number
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
      }
      chapter: {
        list: (novelId: number) => Promise<Chapter[]>
        get: (id: number) => Promise<Chapter | null>
        create: (novelId: number, data: Partial<Chapter>) => Promise<number>
        update: (id: number, data: Partial<Chapter>) => Promise<void>
        delete: (id: number) => Promise<void>
        generateContent: (chapterId: number) => Promise<number>
        generateSummary: (chapterId: number) => Promise<void>
        aiCheck: (chapterId: number) => Promise<unknown>
      }
      character: {
        list: (novelId: number) => Promise<Character[]>
        get: (id: number) => Promise<Character | null>
        create: (novelId: number, data: Partial<Character>) => Promise<number>
        update: (id: number, data: Partial<Character>) => Promise<void>
        delete: (id: number) => Promise<void>
        regenerate: (id: number) => Promise<Character | null>
        batchGenerate: (novelId: number, opts: unknown) => Promise<number[]>
        generateProtagonist: (novelId: number, opts: unknown) => Promise<number>
        getRelations: (novelId: number) => Promise<CharacterRelation[]>
        generateRelations: (novelId: number) => Promise<void>
        upsertRelation: (data: unknown) => Promise<void>
        clear: (novelId: number) => Promise<void>
      }
      map: {
        getTree: (novelId: number) => Promise<WorldMapItem[]>
        create: (novelId: number, data: unknown) => Promise<number>
        update: (id: number, data: unknown) => Promise<void>
        delete: (id: number) => Promise<void>
        batchGenerate: (novelId: number, structure: MapBatchGenerateOptions) => Promise<MapBatchGenerationResult>
        clear: (novelId: number) => Promise<void>
      }
      timeline: {
        list: (novelId: number) => Promise<TimelineEvent[]>
        get: (id: number) => Promise<TimelineEvent | null>
        create: (novelId: number, data: Partial<TimelineEvent>) => Promise<number>
        update: (id: number, data: Partial<TimelineEvent>) => Promise<void>
        delete: (id: number) => Promise<void>
        generate: (novelId: number, options?: unknown) => Promise<number[]>
        clear: (novelId: number) => Promise<void>
      }
      item: {
        list: (novelId: number) => Promise<StoryItem[]>
        get: (id: number) => Promise<StoryItem | null>
        create: (novelId: number, data: Partial<StoryItem>) => Promise<number>
        update: (id: number, data: Partial<StoryItem>) => Promise<void>
        delete: (id: number) => Promise<void>
        generate: (novelId: number, options?: unknown) => Promise<number[]>
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
      task: {
        list: (novelId?: number) => Promise<Task[]>
        get: (id: number) => Promise<Task | null>
        cancel: (id: number) => Promise<boolean>
        retry: (id: number) => Promise<number>
      }
      ai: {
        expandBackground: (input: unknown) => Promise<{ expanded_background: string; titles: string[]; synopsis: string }>
        generateCoreSettings: (data: CoreSettingsGenerationRequest) => Promise<CoreSettingsGenerationResult>
        generateWorldRules: (data: WorldRulesGenerationRequest) => Promise<WorldRulesGenerationResult>
        generateCharacter: (novelId: number, opts: unknown) => Promise<number>
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
