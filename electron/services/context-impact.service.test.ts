import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(() => ({
    transaction: (callback: () => void) => callback,
  })),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

vi.mock('./consistency.service', () => ({
  buildNovelConsistencyReport: vi.fn(() => ({
    issues: [],
  })),
}))

vi.mock('./quality-dashboard.service', () => ({
  getQualityDashboardData: vi.fn(() => ({
    storyPacingAlerts: [],
  })),
  buildHeuristicRecallDiagnostics: vi.fn(() => ({
    searchedBucketCount: 0,
    selectedBucketCount: 0,
    totalHitCount: 0,
    selectedHitCount: 0,
    staleRecallCount: 0,
    staleRecallRate: 0,
    recallDependencyRate: 0,
    overriddenHitCount: 0,
    fallbackHitCount: 0,
    summaryLines: [],
  })),
}))

vi.mock('./chapter-recall-runtime.service', () => ({
  listChapterRecallRuntimeMap: vi.fn(() => new Map()),
}))

import { getDb } from '../database/db'
import {
  chapterGateRuns,
  chapterContracts,
  chapterSegments,
  chapters,
  novels,
  revisionTasks,
  sceneContracts,
  storyArcs,
  storyThreads,
  storyVolumes,
  volumeDesigns,
} from '../database/schema'
import { buildNovelConsistencyReport } from './consistency.service'
import { listChapterRecallRuntimeMap } from './chapter-recall-runtime.service'
import { buildHeuristicRecallDiagnostics } from './quality-dashboard.service'
import { runChapterPublishCheck } from './context-impact.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function createQuery(rowsByTable: TableRows, table: unknown) {
  const query: {
    where: () => typeof query
    orderBy: () => typeof query
    all: () => Array<Record<string, unknown>>
  } = {
    where: () => query,
    orderBy: () => query,
    all: () => rowsByTable.get(table) || [],
  }
  return query
}

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => createQuery(rowsByTable, table)),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          run: vi.fn(() => {
            const rows = rowsByTable.get(table) || []
            if (rows.length > 0) Object.assign(rows[0], patch)
            return { changes: rows.length > 0 ? 1 : 0 }
          }),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((payload: Record<string, unknown>) => ({
        run: vi.fn(() => {
          const rows = rowsByTable.get(table) || []
          const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
          rows.push({ id: nextId, ...payload })
          rowsByTable.set(table, rows)
          return { lastInsertRowid: nextId }
        }),
      })),
    })),
  }
}

function createBaseRows() {
  const reviewNotes = JSON.stringify({
    severity: 'low',
    rewrite_required: false,
    reader_hook_risks: [],
    arc_progress_risks: [],
    dialogue_homogenization_risks: [],
    dialogue_drift_alerts: [],
    cross_character_similarity: [],
    chapter_function_primary: 'progression',
    chapter_function_tags: ['progression'],
    revision_brief: '',
    protagonist_setback: 'minor',
    reward_state: 'partial',
    cost_present: true,
  })

  return new Map<unknown, Array<Record<string, unknown>>>([
    [novels, [{
      id: 1,
      contextVersion: 1,
      themeVoiceJson: JSON.stringify({
        pov: 'third_limited',
        tense: 'past',
        protagonistCount: 'single',
        viewpointMode: 'fixed',
      }),
    }]],
    [chapters, [{
      id: 10,
      novelId: 1,
      chapterNum: 12,
      title: '第十二章',
      summary: '本章摘要',
      outline: '本章大纲',
      content: '夜晚的北门外，林远假意盘问守卫，继续追查失窃药箱。守卫追查他的来路，两人几乎动手。林远趁乱确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。\n\n他刚转身，门外又传来急促脚步声，像是有人已经知道了他的发现。',
      continuityStateJson: JSON.stringify({ arc_progress: '主线推进 60%' }),
      reviewNotesJson: reviewNotes,
      aiScoreJson: JSON.stringify({ overall_score: 82 }),
      contextVersion: 1,
      staleReasonJson: JSON.stringify([]),
      scenePlanJson: JSON.stringify([{ scene_title: '场景一', exit_hook: '门外传来脚步声' }]),
      contractAuditJson: '',
      volumeId: 2,
      arcId: 5,
      status: 'draft',
    }]],
    [chapterContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      chapterGoal: '让主线再向前推进一步',
      servedThreadIdsJson: JSON.stringify([100]),
      requiredArcProgressJson: JSON.stringify(['主线必须向前推进']),
      requiredCharacterArcIdsJson: JSON.stringify([]),
      requiredRelationshipArcIdsJson: JSON.stringify([]),
      requiredResistanceTrackIdsJson: JSON.stringify([]),
      requiredEndgameCommitmentIdsJson: JSON.stringify([]),
      requiredForeshadowIdsJson: JSON.stringify([]),
      acceptanceNotesJson: JSON.stringify(['本章必须推进主线']),
      hookType: 'suspense',
      status: 'ready',
    }]],
    [chapterSegments, [{
      id: 1001,
      novelId: 1,
      chapterId: 10,
      segmentOrder: 1,
      title: '场景一',
      purpose: '推进主线',
      timeAnchor: '夜晚',
      locationName: '北门',
      inputState: '双方试探',
      outputState: '线索升级',
    }]],
    [sceneContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      segmentId: 1001,
      status: 'ready',
      pov: '林远',
      timeLocation: '夜晚 / 北门',
      sceneGoal: '推进主线',
      obstacle: '守卫追查',
      resultState: '线索升级',
    }]],
    [storyThreads, [{
      id: 100,
      novelId: 1,
      sortOrder: 1,
      title: '失窃药箱',
      status: 'active',
      targetPayoffChapter: 15,
      plantedChapter: 10,
      lastReferencedChapter: 12,
      resolvedChapter: null,
    }]],
    [storyVolumes, [{
      id: 2,
      novelId: 1,
      volumeNumber: 1,
      title: '第一卷',
    }]],
    [volumeDesigns, [{
      id: 2,
      novelId: 1,
      volumeId: 2,
      volumeTheme: '信任代价',
      volumePromise: '主角第一次付出真正代价',
      mainConflict: '药箱争夺',
      climaxPlan: '北门遭遇战',
      endStateShift: '队伍信任破裂',
      mustAddCluesJson: JSON.stringify([]),
      mustResolveCluesJson: JSON.stringify(['药箱失踪真相']),
      readerExpectation: '本卷必须让主角付出真实损失',
      auditStatus: 'locked',
    }]],
    [storyArcs, [{
      id: 5,
      novelId: 1,
      arcName: '主线',
      arcOrder: 1,
      chapterStart: 1,
      chapterEnd: 20,
      phaseTargetsJson: JSON.stringify([]),
    }]],
    [chapterGateRuns, []],
    [revisionTasks, []],
  ])
}

describe('runChapterPublishCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns warning when only hook-related acceptance risks remain', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapterContracts) || [])[0], {
      hookType: '',
    })
    Object.assign((rows.get(chapters) || [])[0], {
      reviewNotesJson: JSON.stringify({
        severity: 'low',
        rewrite_required: false,
        reader_hook_risks: ['章尾承接偏弱'],
        arc_progress_risks: [],
        chapter_function_primary: 'progression',
        chapter_function_tags: ['progression'],
      }),
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('warning')
    expect(result.ready).toBe(true)
    expect(result.checklist.find((item) => item.key === 'hook_strength')?.status).toBe('warning')
    expect(result.scoreBreakdown.hookStrengthScore).toBeLessThan(result.scoreBreakdown.continuityScore)
    expect(result.generatedTaskCount).toBe(0)
  })

  it('returns blocker and creates a system revision task when required thread is not progressed', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(storyThreads) || [])[0], {
      lastReferencedChapter: 11,
      plantedChapter: 10,
      resolvedChapter: null,
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('blocker')
    expect(result.ready).toBe(false)
    expect(result.checklist.find((item) => item.key === 'thread_progress')?.status).toBe('blocker')
    expect((rows.get(revisionTasks) || []).length).toBe(1)
    expect(result.checklist.find((item) => item.key === 'thread_progress')?.taskId).toBe(1)
    expect(JSON.parse(String((rows.get(revisionTasks) || [])[0].originMetaJson || '{}')).rewritePlan?.recheckItems).toContain('thread_progress')
  })

  it('returns rewrite and points at the conflicting segment when fixed POV chapter mixes scene POVs', () => {
    const rows = createBaseRows()
    ;(rows.get(chapterSegments) || []).push({
      id: 1002,
      novelId: 1,
      chapterId: 10,
      segmentOrder: 2,
      title: '场景二',
      purpose: '继续追查',
      timeAnchor: '深夜',
      locationName: '仓库',
      inputState: '线索升级',
      outputState: '真相更近',
    })
    ;(rows.get(sceneContracts) || []).push({
      id: 2,
      novelId: 1,
      chapterId: 10,
      segmentId: 1002,
      status: 'ready',
      pov: '赵临',
      timeLocation: '深夜 / 仓库',
      sceneGoal: '继续追查',
      obstacle: '身份暴露',
      resultState: '真相更近',
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)
    const taskRow = (rows.get(revisionTasks) || []).find((row) => row.issueKey === 'chapter_gate:10:check:pov_purity')
    const taskMeta = JSON.parse(String(taskRow?.originMetaJson || '{}'))

    expect(result.gateLevel).toBe('rewrite')
    expect(result.rewriteRecommended).toBe(true)
    expect(result.rewriteTarget?.kind).toBe('segment')
    expect(result.rewriteTarget?.segmentId).toBe(1002)
    expect(result.rewritePlan?.scope).toBe('scene_rewrite')
    expect(result.rewritePlan?.targetSegmentId).toBe(1002)
    expect(result.checklist.find((item) => item.key === 'pov_purity')?.status).toBe('rewrite')
    expect(taskMeta.rewritePlan?.scope).toBe('scene_rewrite')
    expect(taskMeta.rewritePlan?.recheckItems).toContain('pov_purity')
  })

  it('returns rewrite when fixed POV content directly reads another character mind', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapters) || [])[0], {
      content: '林远贴着墙根往前挪。赵临心里已经认定他在撒谎。守卫心中甚至开始盘算要不要先下手。',
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('rewrite')
    expect(result.rewriteTarget?.kind).toBe('selection')
    expect(result.checklist.find((item) => item.key === 'pov_boundary')?.status).toBe('rewrite')
  })

  it('returns rewrite when chapter falls into all-dialogue ratio drift', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapters) || [])[0], {
      content: '“你来了？”“我来了。”“现在怎么办？”“先等。”\n“别说话。”“那你倒是给个主意。”“没有主意。”“那就继续等。”',
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('rewrite')
    expect(result.checklist.find((item) => item.key === 'narrative_ratio')?.status).toBe('rewrite')
    expect(result.rewritePlan?.scope).toBe('paragraph_patch')
    expect(result.rewritePlan?.recheckItems).toContain('narrative_ratio')
    expect(result.scoreBreakdown.narrativeRatioScore).toBeLessThanOrEqual(49)
  })

  it('does not create duplicate gate revision tasks for the same unresolved blocker', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(storyThreads) || [])[0], {
      lastReferencedChapter: 11,
      plantedChapter: 10,
      resolvedChapter: null,
    })
    const db = createDbMock(rows)

    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    runChapterPublishCheck(10)
    runChapterPublishCheck(10)

    expect((rows.get(revisionTasks) || []).length).toBe(1)
    expect((rows.get(chapterGateRuns) || []).length).toBe(1)
  })

  it('tracks worsening and improving drift across gate history snapshots', () => {
    const rows = createBaseRows()
    const db = createDbMock(rows)

    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const baseline = runChapterPublishCheck(10)
    Object.assign((rows.get(chapters) || [])[0], {
      aiScoreJson: JSON.stringify({ overall_score: 58 }),
      reviewNotesJson: JSON.stringify({
        severity: 'high',
        rewrite_required: false,
        reader_hook_risks: ['章尾承接偏弱'],
        arc_progress_risks: [],
        dialogue_homogenization_risks: ['多人对白同声化'],
        dialogue_drift_alerts: [{ characterName: '林远', reason: '口吻明显漂移' }],
        cross_character_similarity: [{ reason: '林远/赵临措辞过近' }],
        language_risks: ['修辞堆砌偏重'],
        human_language_repairs: ['把模板化表达换成人话'],
        chapter_function_primary: 'progression',
        chapter_function_tags: ['progression'],
      }),
    })
    const worsened = runChapterPublishCheck(10)

    expect(baseline.history).toHaveLength(1)
    expect(worsened.history).toHaveLength(2)
    expect(worsened.drift?.status).toBe('worsening')
    expect(worsened.drift?.scoreDelta).toBeLessThan(0)

    Object.assign((rows.get(chapters) || [])[0], {
      aiScoreJson: JSON.stringify({ overall_score: 90 }),
      reviewNotesJson: JSON.stringify({
        severity: 'low',
        rewrite_required: false,
        reader_hook_risks: [],
        arc_progress_risks: [],
        dialogue_homogenization_risks: [],
        dialogue_drift_alerts: [],
        cross_character_similarity: [],
        language_risks: [],
        human_language_repairs: [],
        chapter_function_primary: 'progression',
        chapter_function_tags: ['progression'],
        protagonist_setback: 'minor',
        reward_state: 'partial',
        cost_present: true,
      }),
    })
    const improved = runChapterPublishCheck(10)

    expect(improved.history).toHaveLength(3)
    expect(improved.drift?.status).toBe('improving')
    expect(improved.drift?.scoreDelta).toBeGreaterThan(0)
  })

  it('keeps language and dialogue penalties scoped to their own dimensions', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapters) || [])[0], {
      aiScoreJson: JSON.stringify({ overall_score: 74 }),
      reviewNotesJson: JSON.stringify({
        severity: 'low',
        rewrite_required: false,
        reader_hook_risks: [],
        arc_progress_risks: [],
        dialogue_homogenization_risks: ['多人对白同声化'],
        dialogue_drift_alerts: [{ characterName: '林远', reason: '角色口吻漂移' }],
        cross_character_similarity: [{ reason: '林远/赵临词汇相似' }],
        language_risks: ['句式重复偏多', '抽象词密度偏高'],
        human_language_repairs: ['把总结句改成动作反馈'],
        chapter_function_primary: 'progression',
        chapter_function_tags: ['progression'],
        protagonist_setback: 'minor',
        reward_state: 'partial',
        cost_present: true,
      }),
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.scoreBreakdown.dialogueVoiceScore).toBeLessThan(result.scoreBreakdown.continuityScore)
    expect(result.scoreBreakdown.languageNaturalnessScore).toBeLessThan(result.scoreBreakdown.storyDynamicsScore)
  })

  it('caps total score below stable bands when contract blockers remain', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapterContracts) || [])[0], {
      chapterGoal: '',
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('blocker')
    expect(result.scoreBreakdown.contractScore).toBeLessThan(80)
    expect(result.scoreBreakdown.totalScore).toBeLessThanOrEqual(59)
  })

  it('uses正文合同验证 to block chapters that only have structure records but no textual delivery evidence', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapters) || [])[0], {
      content: '夜色很沉，林远站在北门外想起失窃药箱，却没有继续行动。守卫看了他一眼，气氛发冷。\n\n他最终只是回了客栈睡下。',
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)
    const taskRow = (rows.get(revisionTasks) || []).find((row) => row.issueKey === 'chapter_gate:10:check:contract_delivery')
    const taskMeta = JSON.parse(String(taskRow?.originMetaJson || '{}'))

    expect(result.checklist.find((item) => item.key === 'contract_delivery')?.status).toBe('blocker')
    expect(result.contractValidation?.status).toBe('blocker')
    expect(result.contractValidation?.summary).toContain('正文合同验证命中')
    expect(result.rewritePlan?.scope).toBe('scene_rewrite')
    expect(result.rewritePlan?.recheckItems).toContain('contract_delivery')
    expect(taskMeta.rewritePlan?.scope).toBe('scene_rewrite')
    expect(result.history[0]?.topIssueKeys.some((item) => item.startsWith('contract_delivery:'))).toBe(true)
  })

  it('blocks publish when recall degradation has continued for three chapters', () => {
    const rows = createBaseRows()
    const chapterRows = rows.get(chapters) || []
    chapterRows.push(
      { ...chapterRows[0], id: 9, chapterNum: 11, title: '第十一章' },
      { ...chapterRows[0], id: 8, chapterNum: 10, title: '第十章' },
    )

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)
    vi.mocked(listChapterRecallRuntimeMap).mockReturnValue(new Map([
      [10, {
        chapterId: 10,
        novelId: 1,
        recallSnapshot: {
          retrievalUsed: false,
          degraded: true,
          hitCount: 4,
          selectedHitCount: 0,
          staleRecallCount: 0,
          fallbackHitCount: 4,
          fallbackReason: 'query_embedding_failed',
          bucketStats: {
            character: { hitCount: 2, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 2, fallbackReason: 'query_embedding_failed' },
            rule: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
            thread: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
          },
        },
        recallDiagnostics: {
          searchedBucketCount: 3,
          selectedBucketCount: 0,
          totalHitCount: 4,
          selectedHitCount: 0,
          staleRecallCount: 0,
          staleRecallRate: 0,
          recallDependencyRate: 0,
          overriddenHitCount: 0,
          fallbackHitCount: 4,
          summaryLines: ['召回降级'],
        },
      }],
      [9, {
        chapterId: 9,
        novelId: 1,
        recallSnapshot: {
          retrievalUsed: false,
          degraded: true,
          hitCount: 3,
          selectedHitCount: 0,
          staleRecallCount: 0,
          fallbackHitCount: 3,
          fallbackReason: 'query_embedding_failed',
          bucketStats: {
            character: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
            rule: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
            thread: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
          },
        },
      }],
      [8, {
        chapterId: 8,
        novelId: 1,
        recallSnapshot: {
          retrievalUsed: false,
          degraded: true,
          hitCount: 2,
          selectedHitCount: 0,
          staleRecallCount: 0,
          fallbackHitCount: 2,
          fallbackReason: 'query_embedding_failed',
          bucketStats: {
            character: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
            rule: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'query_embedding_failed' },
            thread: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0, fallbackReason: 'query_embedding_failed' },
          },
        },
      }],
    ]))

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('blocker')
    expect(result.checklist.find((item) => item.key === 'recall')?.status).toBe('blocker')
  })

  it('uses persisted chapter recall runtime snapshots before heuristic fallback', () => {
    const rows = createBaseRows()

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)
    vi.mocked(listChapterRecallRuntimeMap).mockReturnValue(new Map([
      [10, {
        chapterId: 10,
        novelId: 1,
        recallSnapshot: {
          retrievalUsed: false,
          degraded: true,
          hitCount: 1,
          selectedHitCount: 0,
          staleRecallCount: 0,
          fallbackHitCount: 1,
          fallbackReason: 'budget_trimmed',
          bucketStats: {
            character: { hitCount: 1, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 1, fallbackReason: 'budget_trimmed' },
            rule: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
            thread: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
          },
        },
        recallDiagnostics: {
          searchedBucketCount: 3,
          selectedBucketCount: 0,
          totalHitCount: 1,
          selectedHitCount: 0,
          staleRecallCount: 0,
          staleRecallRate: 0,
          recallDependencyRate: 0,
          overriddenHitCount: 0,
          fallbackHitCount: 1,
          summaryLines: ['历史回填快照'],
        },
        recallSnapshotSource: 'backfilled',
      }],
    ]))

    const result = runChapterPublishCheck(10)

    expect(buildHeuristicRecallDiagnostics).not.toHaveBeenCalled()
    expect(result.checklist.find((item) => item.key === 'recall')?.detail).toContain('召回被预算裁剪')
  })

  it('marks style compliance as rewrite when review notes persist severe style drift', () => {
    const rows = createBaseRows()
    Object.assign((rows.get(chapters) || [])[0], {
      reviewNotesJson: JSON.stringify({
        severity: 'medium',
        rewrite_required: true,
        reader_hook_risks: [],
        arc_progress_risks: [],
        chapter_function_primary: 'progression',
        chapter_function_tags: ['progression'],
        style_compliance: {
          status: 'rewrite',
          score: 42,
          summary: '风格偏离已达到重写阈值。',
          deviations: ['平均句长偏离明显。'],
          rewriteHints: ['把句长拉回参考区间。'],
          matchedForbiddenPatterns: ['命运的齿轮'],
          forbiddenPatternHitCount: 1,
          referenceMetrics: {
            avgSentenceLength: 18,
            avgParagraphLength: 80,
            dialogueLineRate: 35,
            abstractTokenDensity: 6,
          },
          actualMetrics: {
            avgSentenceLength: 34,
            avgParagraphLength: 140,
            dialogueLineRate: 8,
            abstractTokenDensity: 15,
          },
        },
      }),
    })

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(buildNovelConsistencyReport).mockReturnValue({ issues: [] } as never)

    const result = runChapterPublishCheck(10)

    expect(result.gateLevel).toBe('rewrite')
    expect(result.checklist.find((item) => item.key === 'style_compliance')?.status).toBe('rewrite')
    expect(result.scoreBreakdown.styleComplianceScore).toBeLessThanOrEqual(49)
    expect(result.checklist.some((item) => item.key === 'style_compliance' && item.status === 'rewrite')).toBe(true)
  })
})
