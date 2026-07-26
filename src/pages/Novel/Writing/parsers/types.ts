import type { ChapterContractValidationResult } from '../../../../types'
import type { AiExecutionMode } from '../../../../shared/ai-execution'
import type { WritingGenerationStage } from '../../../../stores/writingView.store'

export interface AiCheckPayload {
  score: number
  issues: Array<{ type: string; location: string; suggestion: string; severity?: 'high' | 'medium' | 'low' }>
  overall_feedback: string
  ai_like_rate?: number
  repetition_risk?: '低' | '中' | '高'
}

export interface ContinuityPayload {
  plot_progress?: string[]
  character_state_changes?: string[]
  world_state_changes?: string[]
  open_loops?: string[]
  continuity_notes?: string[]
  arc_progress?: string
}

export interface ScenePlanStep {
  scene_order: number
  scene_title: string
  purpose: string
  location: string
  time_anchor: string
  present_characters: string[]
  key_items: string[]
  must_cover: string[]
  climax_variant?: string
}

export interface ReviewNotes {
  summary: string
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks?: string[]
  context_drift_risks?: string[]
  realism_risks?: string[]
  coherence_risks?: string[]
  reader_hook_risks?: string[]
  language_risks: string[]
  human_language_repairs?: string[]
  genre_hollowing_risks: string[]
  revision_brief: string
  protagonist_setback?: 'none' | 'minor' | 'major'
  setback_summary?: string
  cost_present?: boolean
  cost_summary?: string
  cost_resolution_state?: 'new' | 'ongoing' | 'resolved' | 'evaporated'
  reversal_marker?: boolean
  reversal_summary?: string
  reversal_support_state?: 'supported' | 'weak' | 'forced'
  pace_marker?: 'setup' | 'conflict' | 'reversal' | 'climax' | 'payoff' | 'breather'
  reward_state?: 'none' | 'partial' | 'major'
  protagonist_pressure?: number
  dialogue_homogenization_risks?: string[]
  dialogue_fingerprint_summary?: string
  dialogue_voice_lock_summary?: string
  dialogue_filler_risks?: string[]
  dialogue_info_density_risks?: string[]
  required_voice_lock_character_ids?: number[]
  cross_character_similarity?: Array<{
    characterAId: number
    characterAName: string
    characterBId: number
    characterBName: string
    similarity: number
    reason: string
  }>
  dialogue_drift_alerts?: Array<{
    characterId: number
    characterName: string
    driftRate: number
    reason: string
  }>
  humanization_signals?: Array<{
    issueType: string
    title: string
    severity: 'low' | 'medium' | 'high'
    detail: string
    avoid: string
    prefer?: string
  }>
  contract_validation?: ChapterContractValidationResult
}

export type WritingPipelineRole = 'planner' | 'writer' | 'critic' | 'rewriter' | 'canonizer' | 'finalize'

export interface WritingPipelineRoleState {
  role: WritingPipelineRole
  label: string
  summary: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'blocked'
  detail?: string
  taskId?: number
  upstreamTaskId?: number
  contractVersion?: string
  canonRunId?: number
  durationMs?: number
  tokensUsed?: number
  failureCode?: string
  rewriteScope?: string
  targetSegmentId?: number | null
}

export interface StepMemoryRuntimeState {
  summary: string
  runtimeAssertions: string[]
}

export interface WritingPipelineSnapshot {
  kind: 'chapter_pipeline'
  chapterId: number
  workflowTaskId: number
  currentRole: WritingPipelineRole | null
  currentStage: WritingGenerationStage | null
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  message?: string
  streamTaskId?: number
  executionMode?: AiExecutionMode
  contractVersion?: string
  canonRunId?: number
  totalTokensUsed: number
  totalDurationMs: number
  stepMemory?: StepMemoryRuntimeState
  failureCode?: string
  rewriteScope?: string
  targetSegmentId?: number | null
  partialContent?: string
  resumeReason?: 'failed' | 'cancelled' | 'timeout' | 'network' | 'unknown'
  resumeSourceTaskId?: number
  roles: Record<WritingPipelineRole, WritingPipelineRoleState>
}
