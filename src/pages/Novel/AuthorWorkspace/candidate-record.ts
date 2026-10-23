import type { AgentArtifact } from '../../../shared/agent-artifacts'

export type ArtifactReference = Omit<AgentArtifact, 'content' | 'idempotencyKey'>
export const ARTIFACT_STATUS_LABELS: Record<string, string> = { draft: '候选', reviewed: '已评审', approved: '已认可', committed: '已保存', rejected: '未通过', superseded: '旧版本' }
