export const CREATIVE_STAGES = ['background', 'world_rules', 'story', 'style', 'outline', 'characters', 'map', 'relationships', 'factions', 'items', 'events', 'chapter'] as const
export type CreativeStage = typeof CREATIVE_STAGES[number]
export const CREATIVE_STAGE_LABELS: Record<CreativeStage, string> = {
  background: '背景', world_rules: '规则与限制', story: '故事设计', style: '文风', outline: '卷章大纲', characters: '人物', map: '地图', relationships: '关系',
  factions: '阵营', items: '物品', events: '事件', chapter: '正文',
}
export interface CreativeWorkflowInput {
  novelId: number
  stage: CreativeStage
  request: string
  count?: number
  atChapter?: number
  autoApply?: boolean
  sourceArtifactId?: string
  operation?: 'generate' | 'review'
  idempotencyKey: string
}
export interface CreativeContextReport {
  text: string
  estimatedTokens: number
  maxInputTokens: number
  outputReserve: number
  sources: string[]
  omittedSources: string[]
}
export interface CreativeRun {
  runId: number
  novelId: number
  stage: CreativeStage
  request: string
  atChapter: number
  count?: number
  sourceArtifactId?: string
  operation?: 'generate' | 'review'
  status: string
  step: 'context' | 'generating' | 'reviewing' | 'revising' | 'applying' | 'completed' | 'needs_attention' | 'cancelled'
  message: string
  modelConfigId: number | null
  artifactId?: string
  reviewArtifactId?: string
  reviewStatus?: string
  result?: Record<string, unknown>
  context?: Omit<CreativeContextReport, 'text'>
  events: Array<{ at: string; step: CreativeRun['step']; message: string }>
  createdAt: string | null
  updatedAt: string | null
}
