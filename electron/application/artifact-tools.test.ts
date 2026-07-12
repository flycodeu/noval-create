import { describe, expect, it, vi } from 'vitest'
import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { registerArtifactTools } from './artifact-tools'
import { AgentToolRegistry } from './tool-registry'

const artifact: AgentArtifact = {
  id: 'art_test',
  novelId: 7,
  kind: 'character_draft',
  status: 'reviewed',
  version: 2,
  parentArtifactId: 'castplan_test',
  content: { characters: [{ fullName: '林渡' }] },
  contentHash: `sha256:${'a'.repeat(64)}`,
  contextVersion: 4,
  producerType: 'novelforge_model',
  producerId: 'task:11',
  producerClient: 'vitest',
  modelConfigId: 2,
  taskId: 11,
  reviewArtifactId: 'art_review',
  committedEntityIds: [],
  idempotencyKey: 'draft-key',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:01:00.000Z',
}

const context = {
  actor: { type: 'codex' as const, actorId: 'codex-test', clientId: 'vitest' },
  scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead],
}

describe('artifact tools', () => {
  it('lists compact references and fetches full immutable content on demand', async () => {
    const getArtifact = vi.fn(() => artifact)
    const listArtifacts = vi.fn(() => [artifact])
    const registry = registerArtifactTools(new AgentToolRegistry(), { getArtifact, listArtifacts })

    const list = await registry.invoke({
      toolId: 'novelforge.artifacts.list',
      input: { novelId: 7, kind: 'character_draft' },
    }, context)
    const get = await registry.invoke({
      toolId: 'novelforge.artifacts.get',
      input: { artifactId: 'art_test' },
    }, context)

    expect(list).toMatchObject({
      ok: true,
      data: { artifacts: [{ id: 'art_test', contentHash: artifact.contentHash }], count: 1 },
    })
    expect(list).not.toMatchObject({ data: { artifacts: [{ content: expect.anything() }] } })
    expect(get).toMatchObject({ ok: true, data: { artifact: { id: 'art_test', content: artifact.content } } })
  })
})
