import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>())
vi.mock('./artifact.service', () => ({
  hashArtifactContent: (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  createArtifact: vi.fn((input: Record<string, unknown>) => {
    const artifact = { ...input, id: `report:${store.size}`, contentHash: createHash('sha256').update(JSON.stringify(input.content)).digest('hex') }
    store.set(artifact.id, artifact); return artifact
  }),
  requireArtifact: (id: string) => store.get(id),
}))
vi.mock('./creative-facts', () => ({ queryCreativeFacts: () => [{ id: 1, title: '割绳者', summary: '周荷割断了绳索' }] }))
vi.mock('./story-atlas.service', () => ({ queryStoryAtlas: () => ({ entities: [{ id: 'character:1', kind: 'character', name: '沈墨' }] }) }))
vi.mock('./asset-quality.service', () => ({ runNestedReviewTask: vi.fn() }))
vi.mock('./creative-chapter-context', () => ({ creativeChapterSceneVisibility: vi.fn(() => []) }))
import { creativeChapterSceneVisibility } from './creative-chapter-context'
import { runNestedReviewTask } from './asset-quality.service'
import { assertCreativeEvidence, creativeEvidenceClaims, reviewCreativeEvidence, validateEvidenceAssessments } from './creative-evidence-review'
import type { ModelOutputCheckpoint } from './creative-model-checkpoint'

const prose = '沈墨看到信上写着周荷的名字，但他说：“这封信不足以证明她割断绳索。”'
const data = { chapterNum: 2, content: prose, factReveals: [{ factId: 1, characterIds: ['character:1'], evidenceQuote: prose }], changes: [] }
const base = { novelId: 1, runId: 12, modelConfigId: 7, contextVersion: 9, candidateArtifactId: 'draft:1', candidateHash: 'hash:1', data }
const assessments = (support = 'supported') => creativeEvidenceClaims(1, data).map(claim => ({ id: claim.id, support, evidenceQuote: prose, reason: '逐项分析结论与原文' }))
const review = () => reviewCreativeEvidence({ ...base, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })

describe('evidence support certificates', () => {
  beforeEach(() => { store.clear(); vi.clearAllMocks(); vi.mocked(creativeChapterSceneVisibility).mockReturnValue([]) })
  it('reviews scene-limited knowledge even without fact reveals or graph changes and blocks wrong POV use', async () => {
    vi.mocked(creativeChapterSceneVisibility).mockReturnValue([{ factId: 1, title: '割绳者', summary: '周荷割断了绳索', allowedScenes: [{ sceneId: 3, sceneOrder: 1, povCharacterId: 1, povName: '沈墨' }], authorizedRevelations: [] }])
    const candidate = { chapterNum: 2, content: prose, changes: [], factReveals: [] }
    const claims = creativeEvidenceClaims(1, candidate)
    expect(claims).toHaveLength(1)
    expect(claims[0].conclusion).toContain('无法定位场景或知情过程则 insufficient')
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: [{ id: claims[0].id, support: 'contradicted', evidenceQuote: prose, reason: '第二场的未知情 POV 把秘密当作既知事实' }] }))
    const report = await reviewCreativeEvidence({ ...base, data: candidate, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })
    expect(report!.passed).toBe(false)
    expect(() => assertCreativeEvidence({ ...base, data: candidate, reportArtifactId: report!.artifactId })).toThrow('未通过')
    expect(() => validateEvidenceAssessments({ assessments: [{ id: claims[0].id, support: 'supported', evidenceQuote: '', reason: '整章没有使用此事实，各场均未提前知情' }] }, claims, prose)).not.toThrow()
  })
  it('reviews reader revelation and actual character knowledge separately with the full prose', async () => {
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: assessments('insufficient') }))
    const report = await review()
    expect(report?.passed).toBe(false)
    expect(report?.blockers).toHaveLength(2)
    expect(runNestedReviewTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('引文存在不等于结论成立') }))
    expect(runNestedReviewTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('本章确实获知') }))
    expect(() => assertCreativeEvidence({ ...base, reportArtifactId: report!.artifactId })).toThrow('未通过或已过期')
  })
  it('requires a complete assessment and a verbatim supporting quote for every claim', () => {
    const claims = creativeEvidenceClaims(1, data)
    expect(() => validateEvidenceAssessments({ assessments: [] }, claims, prose)).toThrow('逐项覆盖')
    expect(() => validateEvidenceAssessments({ assessments: [assessments()[0], assessments()[0]] }, claims, prose)).toThrow('重复')
    expect(() => validateEvidenceAssessments({ assessments: assessments().map(row => ({ ...row, evidenceQuote: '凭空出现的结论' })) }, claims, prose)).toThrow('无效原文')
    expect(() => assertCreativeEvidence(base)).toThrow('缺少逐项')
  })
  it('binds passing reports to candidate, claims, context, task and review model', async () => {
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: assessments() }))
    const report = await review()
    const checked = { ...base, reportArtifactId: report!.artifactId }
    expect(() => assertCreativeEvidence(checked)).not.toThrow()
    for (const patch of [{ candidateHash: 'changed' }, { contextVersion: 10 }, { modelConfigId: 8 }, { runId: 13 }, { data: { ...data, factReveals: [{ ...data.factReveals[0], characterIds: [] }] } }]) {
      expect(() => assertCreativeEvidence({ ...checked, ...patch })).toThrow('未通过或已过期')
    }
    store.get(report!.artifactId)!.contentHash = 'tampered'
    expect(() => assertCreativeEvidence(checked)).toThrow('未通过或已过期')
  })
  it('blocks incomplete responses and oversized inputs without treating them as evidence', async () => {
    vi.mocked(runNestedReviewTask).mockResolvedValue('{')
    await expect(review()).rejects.toThrow()
    expect(store.size).toBe(0)
    vi.clearAllMocks()
    await expect(reviewCreativeEvidence({ ...base, maxInputTokens: 1, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })).rejects.toThrow('超过预算')
    expect(runNestedReviewTask).not.toHaveBeenCalled()
  })
})
