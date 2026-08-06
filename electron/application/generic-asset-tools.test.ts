import { describe, expect, it, vi } from 'vitest'
import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type {
  GenericAssetDraftContent,
  GenericAssetReviewContent,
} from '../../src/shared/generic-asset-workflow'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { GenericAssetWorkflowError } from './generic-asset-workflow-error'
import { registerGenericAssetTools } from './generic-asset-tools'
import { AgentToolRegistry } from './tool-registry'

const hash = `sha256:${'c'.repeat(64)}`
const now = '2026-07-11T01:00:00.000Z'
const modelReview = {
  stage: 'accepted' as const,
  review: {
    summary: '与当前项目设定一致。',
    severity: 'low' as const,
    rewriteRequired: false,
    rejectRequired: false,
    genreDriftRisks: [],
    themeDriftRisks: [],
    backgroundDriftRisks: [],
    languageRisks: [],
    humanLanguageRepairs: [],
    conflictRisks: [],
    topFixes: [],
  },
  warnings: [],
}
const draftContent: GenericAssetDraftContent = {
  schemaVersion: 'generic-asset-draft-v1',
  requestFingerprint: hash,
  assetType: 'world_rules',
  title: '代价规则',
  outputFormat: 'markdown',
  requirements: ['所有能力都有可验证代价'],
  schemaHint: '',
  output: '## 代价规则\n每次使用能力都会丢失一段近期记忆。',
  contextSummaryHash: hash,
  taskId: 31,
  quality: modelReview,
  createdAt: now,
}
const reviewContent: GenericAssetReviewContent = {
  schemaVersion: 'generic-asset-review-v1',
  draftArtifactId: 'art_generic',
  draftContentHash: hash,
  effectiveArtifactId: 'art_generic',
  effectiveContentHash: hash,
  status: 'passed',
  score: 100,
  readyForHumanApply: true,
  summary: '通过审校。',
  hardBlockers: [],
  warnings: [],
  checks: [
    { code: 'non_empty', status: 'pass', message: '资产正文非空。' },
  ],
  modelReview,
  reviewedContextVersion: 8,
  createdAt: now,
}

function artifact<T>(overrides: Partial<AgentArtifact<T>>): AgentArtifact<T> {
  return {
    id: 'art_generic',
    novelId: 9,
    kind: 'generic_draft',
    status: 'reviewed',
    version: 1,
    parentArtifactId: null,
    content: {} as T,
    contentHash: hash,
    contextVersion: 8,
    producerType: 'novelforge_model',
    producerId: 'task:31',
    producerClient: 'vitest',
    modelConfigId: 2,
    taskId: 31,
    reviewArtifactId: 'art_quality',
    committedEntityIds: [],
    idempotencyKey: 'generic-draft-key',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const draftArtifact = artifact<GenericAssetDraftContent>({ content: draftContent })
const reviewArtifact = artifact<GenericAssetReviewContent>({
  id: 'art_quality',
  kind: 'quality_report',
  parentArtifactId: 'art_generic',
  content: reviewContent,
})
const allScopes = Object.values(AGENT_TOOL_SCOPES)
const actor = { type: 'api_client' as const, actorId: 'api-test', clientId: 'vitest' }

function dependencies() {
  return {
    generateDraft: vi.fn(async () => ({
      draftArtifact,
      effectiveArtifact: draftArtifact,
      reviewArtifact,
      taskId: 31,
      outputPreview: draftContent.output,
      review: reviewContent,
      idempotentReplay: false,
    })),
    reviewDraft: vi.fn(async () => ({
      sourceArtifact: draftArtifact,
      effectiveArtifact: draftArtifact,
      reviewArtifact,
      outputPreview: draftContent.output,
      review: reviewContent,
      idempotentReplay: false,
    })),
  }
}

describe('generic asset tools', () => {
  it('discovers model-backed asset types and returns only compact artifact references', async () => {
    const deps = dependencies()
    const registry = registerGenericAssetTools(new AgentToolRegistry(), deps)
    const descriptor = registry.get('novelforge.assets.generate_draft')
    expect(descriptor?.inputSchema.properties?.assetType.enum).toContain('chapter')
    expect(descriptor?.inputSchema.properties?.assetType.enum).toContain('theme_voice')
    expect(descriptor?.outputSchema.properties?.review.properties).toHaveProperty('requestFingerprint')

    const result = await registry.invoke({
      toolId: 'novelforge.assets.generate_draft',
      input: {
        novelId: 9,
        assetType: 'world_rules',
        title: '代价规则',
        idempotencyKey: 'generic-draft-key',
      },
    }, { actor, scopes: allScopes })

    expect(result).toMatchObject({
      ok: true,
      data: {
        draftArtifact: { id: 'art_generic', contentHash: hash },
        reviewArtifact: { id: 'art_quality' },
        review: { status: 'passed', readyForHumanApply: true },
      },
    })
    expect(result).not.toMatchObject({ data: { draftArtifact: { content: expect.anything() } } })
  })

  it('requires the repair scope for independent optimization', async () => {
    const deps = dependencies()
    const registry = registerGenericAssetTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.assets.review_draft',
      input: { novelId: 9, draftArtifactId: 'art_generic', idempotencyKey: 'review-key-001' },
    }, { actor, scopes: allScopes.filter((scope) => scope !== AGENT_TOOL_SCOPES.qualityRepair) })
    expect(result).toMatchObject({ ok: false, error: { code: 'AUTH_SCOPE_REQUIRED' } })
    expect(deps.reviewDraft).not.toHaveBeenCalled()
  })

  it('maps stable workflow error codes', async () => {
    const deps = dependencies()
    deps.reviewDraft.mockRejectedValue(new GenericAssetWorkflowError('ARTIFACT_KIND_MISMATCH', '工件类型不匹配。'))
    const registry = registerGenericAssetTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.assets.review_draft',
      input: { novelId: 9, draftArtifactId: 'art_generic', idempotencyKey: 'review-key-002' },
    }, { actor, scopes: allScopes })
    expect(result).toMatchObject({ ok: false, error: { code: 'ARTIFACT_KIND_MISMATCH' } })
  })
})
