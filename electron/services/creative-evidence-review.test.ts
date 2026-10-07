import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const factContext = vi.hoisted(() => ({ kind: 'truth', status: 'confirmed', notes: '', characterKnowledge: [] as Array<{ characterId: string; knownChapterId: number; knownFromStart: boolean }> }))
vi.mock('./artifact.service', () => ({
  hashArtifactContent: (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  createArtifact: vi.fn((input: Record<string, unknown>) => {
    const artifact = { ...input, id: `report:${store.size}`, contentHash: createHash('sha256').update(JSON.stringify(input.content)).digest('hex') }
    store.set(artifact.id, artifact); return artifact
  }),
  requireArtifact: (id: string) => store.get(id),
}))
vi.mock('./creative-facts', () => ({ queryCreativeFacts: () => [{ id: 1, title: '割绳者', summary: '周荷割断了绳索', ...factContext }] }))
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
  beforeEach(() => { store.clear(); vi.clearAllMocks(); Object.assign(factContext, { kind: 'truth', status: 'confirmed', notes: '', characterKnowledge: [] }); vi.mocked(creativeChapterSceneVisibility).mockReturnValue([]) })
  it('requires retained character delivery in its original chapter and invalidates a changed knowledge scope', async () => {
    factContext.characterKnowledge = [
      { characterId: 'character:1', knownChapterId: 2, knownFromStart: false },
      { characterId: 'character:earlier', knownChapterId: 1, knownFromStart: false },
      { characterId: 'character:later', knownChapterId: 3, knownFromStart: false },
      { characterId: 'character:initial', knownChapterId: 2, knownFromStart: true },
    ]
    const candidate = { chapterNum: 2, content: '沈墨亲眼看见周荷割断了绳索。', changes: [], factReveals: [] }
    const preserved = { preservedFactIds: [1], preservedChapterId: 2 }
    const claims = creativeEvidenceClaims(1, candidate, preserved)
    expect(claims.map(claim => claim.id)).toEqual(['preserved:fact:1:reader', 'preserved:fact:1:character:1'])
    expect(claims[1].conclusion).toContain('保留沈墨在原章实际获知的信息')
    const rows = claims.map(claim => ({ id: claim.id, support: 'supported', evidenceQuote: candidate.content, reason: '原章目击过程仍保留' }))
    expect(() => validateEvidenceAssessments({ assessments: rows.slice(0, 1) }, claims, candidate.content)).toThrow('逐项覆盖')
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: rows }))
    const report = await reviewCreativeEvidence({ ...base, ...preserved, data: candidate, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })
    const check = () => assertCreativeEvidence({ ...base, ...preserved, data: candidate, reportArtifactId: report!.artifactId })
    expect(check).not.toThrow()
    factContext.characterKnowledge[0].knownChapterId = 3
    expect(check).toThrow('未通过或已过期')
  })
  it('accepts a format repair only with a complete continuous quote and a bound positive certificate', async () => {
    const candidate = { ...data, content: '沈墨亲眼看见周荷割断了绳索。' }
    const rows = creativeEvidenceClaims(1, candidate).map(claim => ({ id: claim.id, support: 'supported', evidenceQuote: candidate.content, reason: '正文写明目击事实及知情人物' }))
    vi.mocked(runNestedReviewTask).mockResolvedValueOnce(JSON.stringify({ assessments: rows.map(row => ({ ...row, evidenceQuote: '正文不存在的引文。' })) })).mockResolvedValueOnce(JSON.stringify({ assessments: rows }))
    const report = await reviewCreativeEvidence({ ...base, data: candidate, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })
    expect(runNestedReviewTask).toHaveBeenCalledTimes(2)
    expect(report!.passed).toBe(true)
    expect((store.get(report!.artifactId)!.content as { formatRepairCount: number }).formatRepairCount).toBe(1)
    expect(() => assertCreativeEvidence({ ...base, data: candidate, reportArtifactId: report!.artifactId })).not.toThrow()
  })
  it('does not treat a provider failure as a format error or issue a second review', async () => {
    vi.mocked(runNestedReviewTask).mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(review()).rejects.toThrow('provider unavailable')
    expect(runNestedReviewTask).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(0)
  })
  it('reviews retained reveals in formal patches and binds the preservation scope to the certificate', async () => {
    const candidate = { chapterNum: 2, content: prose, changes: [], factReveals: [] }
    const preserved = { preservedFactIds: [1], preservedChapterId: 2 }
    const claims = creativeEvidenceClaims(1, candidate, preserved)
    expect(claims.map(claim => claim.id)).toEqual(['preserved:fact:1:reader'])
    expect(claims[0].conclusion).toContain('不登记新的事实或知情人物')
    expect(() => validateEvidenceAssessments({ assessments: [{ id: claims[0].id, support: 'supported', evidenceQuote: '', reason: '原信息已登记' }] }, claims, prose)).toThrow()
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: [{ id: claims[0].id, support: 'insufficient', evidenceQuote: prose, reason: '改后只有否认，未保留已确认的割绳事实' }] }))
    const rejected = await reviewCreativeEvidence({ ...base, ...preserved, data: candidate, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })
    expect(rejected!.passed).toBe(false)
    expect(() => assertCreativeEvidence({ ...base, ...preserved, data: candidate, reportArtifactId: rejected!.artifactId })).toThrow('未通过')
    const supportedProse = '沈墨亲眼看见周荷割断了绳索。'
    const supported = { ...candidate, content: supportedProse }
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: [{ id: claims[0].id, support: 'supported', evidenceQuote: supportedProse, reason: '合并正文仍完整保留目击事实' }] }))
    const accepted = await reviewCreativeEvidence({ ...base, ...preserved, data: supported, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })
    expect(() => assertCreativeEvidence({ ...base, ...preserved, data: supported, reportArtifactId: accepted!.artifactId })).not.toThrow()
    expect(() => assertCreativeEvidence({ ...base, preservedFactIds: [1, 99], data: supported, reportArtifactId: accepted!.artifactId })).toThrow()
  })
  it('repairs a stitched quote once without forcing a positive judgement', async () => {
    const invalid = assessments().map(row => ({ ...row, evidenceQuote: '沈墨看到信上写着周荷的名字。这封信不足以证明她割断绳索。' }))
    vi.mocked(runNestedReviewTask).mockResolvedValueOnce(JSON.stringify({ assessments: invalid })).mockResolvedValueOnce(JSON.stringify({ assessments: assessments('insufficient') }))
    const report = await review()
    expect(runNestedReviewTask).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runNestedReviewTask).mock.calls[1][0].prompt).toContain('禁止跨段拼接、改写与省略')
    expect(report!.passed).toBe(false)
    expect((store.get(report!.artifactId)!.content as { formatRepairCount: number }).formatRepairCount).toBe(1)
    expect(() => assertCreativeEvidence({ ...base, reportArtifactId: report!.artifactId })).toThrow('未通过')
  })
  it('stops after one invalid-format retry instead of regenerating prose or looping reviews', async () => {
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: assessments().map(row => ({ ...row, evidenceQuote: '并不存在的连续原句。' })) }))
    await expect(review()).rejects.toThrow('无效原文引用')
    expect(runNestedReviewTask).toHaveBeenCalledTimes(2)
    expect(store.size).toBe(0)
  })
  it('preserves testimony qualifications and never requires revealing a clue to prove the entire case', async () => {
    Object.assign(factContext, { kind: 'clue', status: 'introduced', notes: '这是证人的说法，尚未查明谁割断绳索，不得据此定罪。' })
    const claims = creativeEvidenceClaims(1, data)
    for (const claim of claims) {
      expect(claim.conclusion).toContain(factContext.notes)
      expect(claim.conclusion).toContain('证言或推断只证明该说法被表达及其归属')
      expect(claim.conclusion).toContain('已确认真相不能仅用传闻替代')
      expect(claim.conclusion).not.toContain('而非猜测或未证实证言')
    }
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: assessments() }))
    const report = await review()
    expect(report!.passed).toBe(true)
    expect(runNestedReviewTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('不要求本章证实说法') }))
    expect(() => assertCreativeEvidence({ ...base, reportArtifactId: report!.artifactId })).not.toThrow()
    factContext.notes = '新的独立证据已确认割绳者，不再是待核证言。'
    expect(() => assertCreativeEvidence({ ...base, reportArtifactId: report!.artifactId })).toThrow('未通过或已过期')
  })
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
  it.each([
    ['陈舟蹲下去。他知道库房钥匙在柜底。\n邱账房核对账目。', 'supported'],
    ['邱账房想到库房钥匙在柜底，陈舟肯定找不到。', 'contradicted'],
    ['邱账房想到钥匙藏在库房的柜子底下。', 'contradicted'],
  ])('delegates actual scene knowledge to bound semantic review: %s', async (content, support) => {
    vi.mocked(creativeChapterSceneVisibility).mockReturnValue([{ factId: 1, title: '钥匙位置', summary: '库房钥匙在柜底', allowedScenes: [{ sceneId: 3, sceneOrder: 1, povCharacterId: 1, povName: '陈舟' }], authorizedRevelations: [] }])
    const candidate = { chapterNum: 2, content, changes: [], factReveals: [] }
    const claims = creativeEvidenceClaims(1,candidate)
    vi.mocked(runNestedReviewTask).mockResolvedValue(JSON.stringify({ assessments: [{ id: claims[0].id, support, evidenceQuote: content, reason: '按实际场景、内心归属及知情过程核对' }] }))
    const report = await reviewCreativeEvidence({ ...base, data: candidate, maxInputTokens: 24000, outputReserve: 6000, checkpoint: {} as ModelOutputCheckpoint })
    expect(report!.passed).toBe(support === 'supported')
    const check = () => assertCreativeEvidence({ ...base, data: candidate, reportArtifactId: report!.artifactId })
    if (support === 'supported') expect(check).not.toThrow(); else expect(check).toThrow('未通过')
    expect(runNestedReviewTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining(JSON.stringify(content)) }))
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
