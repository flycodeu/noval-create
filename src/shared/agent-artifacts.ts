export type AgentArtifactStatus = 'draft' | 'reviewed' | 'approved' | 'committed' | 'rejected' | 'superseded'

export type AgentArtifactKind =
  | 'character_cast_plan'
  | 'character_draft'
  | 'character_review'
  | 'character_commit_diff'
  | 'quality_report'
  | 'repair_plan'
  | 'quality_repair_draft'
  | 'quality_repair_review'
  | 'quality_comparison'
  | 'generic_draft'

export interface AgentArtifact<T = unknown> {
  id: string
  novelId: number
  kind: AgentArtifactKind | string
  status: AgentArtifactStatus
  version: number
  parentArtifactId: string | null
  content: T
  contentHash: string
  contextVersion: number
  producerType: 'novelforge_model' | 'human' | 'system' | 'api_client'
  producerId: string
  producerClient: string
  modelConfigId: number | null
  taskId: number | null
  reviewArtifactId: string | null
  committedEntityIds: number[]
  idempotencyKey: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAgentArtifactInput<T> {
  id?: string
  novelId: number
  kind: AgentArtifactKind | string
  status?: AgentArtifactStatus
  parentArtifactId?: string | null
  content: T
  contextVersion: number
  producerType: AgentArtifact['producerType']
  producerId: string
  producerClient: string
  modelConfigId?: number | null
  taskId?: number | null
  idempotencyKey?: string | null
}

export interface AgentArtifactListQuery {
  novelId: number
  kind?: AgentArtifactKind | string
  status?: AgentArtifactStatus
  limit?: number
}
