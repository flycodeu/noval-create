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
    staleRecallCount: 0,
  })),
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
      content: '这是已经完成的正文内容。',
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

    expect(result.gateLevel).toBe('rewrite')
    expect(result.rewriteRecommended).toBe(true)
    expect(result.rewriteTarget?.kind).toBe('segment')
    expect(result.rewriteTarget?.segmentId).toBe(1002)
    expect(result.checklist.find((item) => item.key === 'pov_purity')?.status).toBe('rewrite')
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
})
