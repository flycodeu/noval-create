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
  content?: string
  wordCount: number
  summary?: string
  nextChapterSeed?: string
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
  surname?: string
  givenName?: string
  fullName: string
  gender?: string
  age?: number
  birthplace?: string
  occupation?: string
  background?: string
  personalityTraitsJson?: string
  flawsJson?: string
  habitsJson?: string
  goals?: string
  firstImpression?: string
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
  description?: string
  atmosphere?: string
  plotRelevance?: string
  sortOrder: number
  children?: WorldMapItem[]
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
        batchGenerate: (novelId: number, opts: unknown) => Promise<number[]>
        generateProtagonist: (novelId: number, opts: unknown) => Promise<number>
        getRelations: (novelId: number) => Promise<CharacterRelation[]>
        generateRelations: (novelId: number) => Promise<void>
        upsertRelation: (data: unknown) => Promise<void>
      }
      map: {
        getTree: (novelId: number) => Promise<WorldMapItem[]>
        create: (novelId: number, data: unknown) => Promise<number>
        update: (id: number, data: unknown) => Promise<void>
        delete: (id: number) => Promise<void>
        batchGenerate: (novelId: number, structure: unknown) => Promise<void>
      }
      outline: {
        getArcs: (novelId: number) => Promise<StoryArc[]>
        createArc: (novelId: number, data: unknown) => Promise<number>
        updateArc: (id: number, data: unknown) => Promise<void>
        deleteArc: (id: number) => Promise<void>
        generateArcs: (novelId: number) => Promise<StoryArc[]>
        generateChapterOutlines: (arcId: number) => Promise<unknown[]>
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
        generateCharacter: (novelId: number, opts: unknown) => Promise<number>
        generateRelations: (novelId: number) => Promise<void>
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
