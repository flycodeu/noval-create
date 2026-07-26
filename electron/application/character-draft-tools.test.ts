import { describe, expect, it, vi } from 'vitest'
import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type {
  CharacterCommitDiffContent,
  CharacterDraftContent,
  CharacterDraftReviewContent,
} from '../../src/shared/character-draft-workflow'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CharacterDraftWorkflowError } from './character-draft-workflow-error'
import { registerCharacterDraftTools } from './character-draft-tools'
import { AgentToolRegistry } from './tool-registry'

const hash = `sha256:${'b'.repeat(64)}`
const baseArtifact = <T>(overrides: Partial<AgentArtifact<T>>): AgentArtifact<T> => ({
  id: 'art_test',
  novelId: 7,
  kind: 'character_draft',
  status: 'reviewed',
  version: 2,
  parentArtifactId: 'castplan_test',
  content: {} as T,
  contentHash: hash,
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
  ...overrides,
})

const review: CharacterDraftReviewContent = {
  schemaVersion: 'character-draft-review-v1',
  draftArtifactId: 'art_draft',
  draftContentHash: hash,
  status: 'passed',
  score: 94,
  committable: true,
  summary: '通过审校。',
  hardBlockers: [],
  warnings: [],
  checks: [],
  modelReview: { stage: 'accepted' },
  reviewedContextVersion: 4,
  createdAt: '2026-07-11T00:01:00.000Z',
}
const draftArtifact = baseArtifact<CharacterDraftContent>({ id: 'art_draft' })
const reviewArtifact = baseArtifact<CharacterDraftReviewContent>({
  id: 'art_review',
  kind: 'character_review',
  parentArtifactId: 'art_draft',
  content: review,
})
const commitArtifact = baseArtifact<CharacterCommitDiffContent>({
  id: 'art_commit',
  kind: 'character_commit_diff',
  status: 'committed',
  content: {
    schemaVersion: 'character-commit-diff-v1',
    draftArtifactId: 'art_draft',
    draftContentHash: hash,
    reviewArtifactId: 'art_review',
    createdCharacterIds: [41],
    createdCharacterNames: ['林渡'],
    skippedPlanActions: [],
    contextVersionBefore: 4,
    contextVersionAfter: 5,
    committedAt: '2026-07-11T00:02:00.000Z',
  },
})

const allScopes = Object.values(AGENT_TOOL_SCOPES)
const actor = { type: 'api_client' as const, actorId: 'api-test', clientId: 'vitest' }

function dependencies() {
  return {
    generateDraft: vi.fn(async () => ({
      draftArtifact,
      reviewArtifact,
      taskId: 11,
      characterCount: 1,
      characterNames: ['林渡'],
      diffSummary: { createCount: 1, updateSuggestionCount: 0, mergeSuggestionCount: 0, archiveSuggestionCount: 0 },
      review,
      idempotentReplay: false,
    })),
    reviewDraft: vi.fn(() => ({ reviewArtifact, review })),
    commitDraft: vi.fn(() => ({
      draftArtifactId: 'art_draft',
      commitArtifact,
      createdCharacterIds: [41],
      createdCharacterNames: ['林渡'],
      contextVersionBefore: 4,
      contextVersionAfter: 5,
      idempotentReplay: false,
      warnings: [],
    })),
  }
}

describe('character draft tools', () => {
  it('generates a compact artifact result without returning full draft content', async () => {
    const deps = dependencies()
    const registry = registerCharacterDraftTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.characters.generate_draft',
      input: { novelId: 7, planId: 'castplan_test', idempotencyKey: 'draft-key-001' },
    }, { actor, scopes: allScopes })

    expect(result).toMatchObject({
      ok: true,
      data: {
        draftArtifact: { id: 'art_draft', contentHash: hash },
        characterNames: ['林渡'],
        review: { status: 'passed', committable: true },
      },
    })
    expect(result).not.toMatchObject({ data: { draftArtifact: { content: expect.anything() } } })
  })

  it('requires a trusted approval before canonical commit', async () => {
    const deps = dependencies()
    const registry = registerCharacterDraftTools(new AgentToolRegistry(), deps)
    const request = {
      toolId: 'novelforge.characters.commit_draft',
      input: {
        novelId: 7,
        draftArtifactId: 'art_draft',
        expectedContextVersion: 4,
        expectedContentHash: hash,
        idempotencyKey: 'commit-key-001',
      },
      approvalId: 'approval-1',
    }
    const forged = await registry.invoke(request, { actor, scopes: allScopes })
    const trusted = await registry.invoke(request, { actor, scopes: allScopes, approvalId: 'approval-1' })
    expect(forged).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } })
    expect(trusted).toMatchObject({ ok: true, data: { createdCharacterIds: [41], contextVersionAfter: 5 } })
    expect(deps.commitDraft).toHaveBeenCalledTimes(1)
  })

  it('surfaces workflow domain errors with stable codes', async () => {
    const deps = dependencies()
    deps.reviewDraft.mockImplementation(() => {
      throw new CharacterDraftWorkflowError('CONTEXT_VERSION_CONFLICT', '上下文已变化。')
    })
    const registry = registerCharacterDraftTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.characters.review',
      input: { novelId: 7, draftArtifactId: 'art_draft' },
    }, { actor, scopes: allScopes })
    expect(result).toMatchObject({ ok: false, error: { code: 'CONTEXT_VERSION_CONFLICT' } })
  })
})
