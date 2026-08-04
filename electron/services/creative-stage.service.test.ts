import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createArtifact: vi.fn(),
  listArtifacts: vi.fn(),
  requireArtifact: vi.fn(),
  updateArtifactLifecycle: vi.fn(),
  markNovelContextChanged: vi.fn(),
}))

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))
vi.mock('./artifact.service', () => ({
  createArtifact: mocks.createArtifact,
  listArtifacts: mocks.listArtifacts,
  requireArtifact: mocks.requireArtifact,
  updateArtifactLifecycle: mocks.updateArtifactLifecycle,
}))
vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: mocks.markNovelContextChanged,
}))

import { getDb, getSqlite } from '../database/db'
import { creativeStages, novels } from '../database/schema'
import {
  approveCreativeStageHandoff,
  createCreativeStageHandoff,
  resolveCreativeStageHandoffStatus,
  reviewCreativeStageHandoff,
  upsertCreativeStageAsset,
} from './creative-stage.service'

const stage = {
  id: 11,
  novelId: 3,
  sequence: 1,
  name: '第一卷起局',
  kind: 'chapter-window',
  status: 'active',
  chapterStart: 1,
  chapterEnd: 100,
  volumeId: null,
  partId: null,
  objective: '让主角第一次主动选择',
  storySummary: '只处理港城失踪案',
  handoffSummary: '',
  constraintsJson: null,
  contextVersion: 7,
  createdAt: '',
  updatedAt: '',
}

const novel = { id: 3, contextVersion: 7 }

function installDbMock() {
  const rows = new Map<unknown, Array<Record<string, unknown>>>([
    [creativeStages, [stage]],
    [novels, [novel]],
  ])
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          all: vi.fn(() => rows.get(table) || []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ run: vi.fn() })),
      })),
    })),
  }
  vi.mocked(getDb).mockReturnValue(db as never)
  vi.mocked(getSqlite).mockReturnValue({
    transaction: vi.fn((run: () => unknown) => () => run()),
  } as never)
}

const handoff = {
  id: 'art_handoff_1',
  novelId: 3,
  kind: 'creative_stage_handoff',
  status: 'draft',
  version: 1,
  parentArtifactId: null,
  content: {
    schemaVersion: 'creative-stage-handoff-v1',
    stageId: 11,
    stageName: '第一卷起局',
    chapterRange: '第 1–100 章',
    changes: ['主角主动承担证据链责任'],
    costs: ['失去证人保护'],
    openQuestions: ['谁在篡改账本'],
    nextPressure: '城隍封门倒计时',
    assetContinuity: [],
  },
  contextVersion: 7,
} as any

describe('creative stage handoff artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installDbMock()
  })

  it('creates a normalized draft without touching canon', () => {
    mocks.createArtifact.mockReturnValue(handoff)
    const result = createCreativeStageHandoff({
      stageId: 11,
      idempotencyKey: 'manual-handoff-1',
      changes: ['主角主动承担证据链责任', '', '主角主动承担证据链责任'],
      costs: ['失去证人保护'],
      openQuestions: ['谁在篡改账本'],
      nextPressure: '城隍封门倒计时',
      assetContinuity: [],
    })

    expect(result).toBe(handoff)
    expect(mocks.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      novelId: 3,
      kind: 'creative_stage_handoff',
      status: 'draft',
      contextVersion: 7,
      content: expect.objectContaining({
        stageId: 11,
        changes: ['主角主动承担证据链责任'],
        nextPressure: '城隍封门倒计时',
      }),
      idempotencyKey: 'manual-handoff-1',
    }))
    expect(mocks.markNovelContextChanged).not.toHaveBeenCalled()
  })

  it('moves a draft through deterministic review before author approval', () => {
    mocks.requireArtifact.mockReturnValue(handoff)
    const reviewed = { ...handoff, status: 'reviewed' }
    const review = { id: 'art_review_1', kind: 'creative_stage_handoff_review' }
    mocks.createArtifact.mockReturnValue(review)
    mocks.updateArtifactLifecycle.mockReturnValue(reviewed)

    const reviewResult = reviewCreativeStageHandoff(handoff.id)
    expect(reviewResult.handoff.status).toBe('reviewed')
    expect(mocks.updateArtifactLifecycle).toHaveBeenCalledWith(handoff.id, expect.objectContaining({ status: 'reviewed' }))

    mocks.requireArtifact.mockReturnValue(reviewed)
    mocks.listArtifacts.mockReturnValue([reviewed])
    const approved = { ...reviewed, status: 'approved' }
    mocks.updateArtifactLifecycle.mockReturnValue(approved)
    expect(approveCreativeStageHandoff(handoff.id).status).toBe('approved')
    expect(mocks.updateArtifactLifecycle).toHaveBeenLastCalledWith(handoff.id, { status: 'approved' })
    expect(vi.mocked(getSqlite).mock.results[0]?.value.transaction).toHaveBeenCalledTimes(2)
  })

  it('rejects a bound canonical asset that does not belong to the stage novel', () => {
    expect(() => upsertCreativeStageAsset({
      stageId: 11,
      assetType: 'outline',
      assetId: 999,
      placeholderName: '其他项目的章节',
      role: 'handoff',
      detailLevel: 'canonical',
      status: 'active',
    })).toThrow('阶段资产不存在')
  })

  it('keeps the effective handoff approved while a newer draft waits for review', () => {
    expect(resolveCreativeStageHandoffStatus({
      hasCurrentApprovedHandoff: true,
      latestApprovedContextVersion: 7,
      projectContextVersion: 7,
      latestArtifactStatus: 'draft',
      hasLegacyHandoff: false,
    })).toBe('approved')
    expect(resolveCreativeStageHandoffStatus({
      hasCurrentApprovedHandoff: false,
      latestApprovedContextVersion: 6,
      projectContextVersion: 7,
      latestArtifactStatus: 'draft',
      hasLegacyHandoff: false,
    })).toBe('stale')
  })
})
