import type { AgentArtifact } from '../../../shared/agent-artifacts'

export function isExternalImportedDraft(
  artifact: Pick<AgentArtifact, 'kind' | 'producerType'>,
): boolean {
  return artifact.kind === 'generic_draft' && artifact.producerType === 'api_client'
}
