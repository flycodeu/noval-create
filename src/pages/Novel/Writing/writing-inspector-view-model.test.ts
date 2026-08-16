import { describe, expect, it } from 'vitest'
import {
  buildBridgeItems,
  buildContinuityItems,
  buildHistoryInspectorViewModel,
  buildMemoryInspectorViewModel,
  buildProductionBriefItems,
  buildQualityFocusItems,
  buildReviewInsightItems,
} from './writing-inspector-view-model'

describe('writing inspector view models', () => {
  it('builds bounded memory lists without mutating the source snapshot', () => {
    const storyMemory = {
      coverageSummary: '覆盖 30 章',
      phaseDigest: ['阶段一'],
      plotMilestones: Array.from({ length: 14 }, (_, index) => `里程碑${index + 1}`),
      activeThreads: Array.from({ length: 14 }, (_, index) => `线程${index + 1}`),
      timelineAnchors: Array.from({ length: 12 }, (_, index) => `锚点${index + 1}`),
      itemLedger: Array.from({ length: 12 }, (_, index) => `道具${index + 1}`),
    } as Parameters<typeof buildMemoryInspectorViewModel>[0]

    const model = buildMemoryInspectorViewModel(storyMemory)

    expect(model).toMatchObject({ coverageSummary: '覆盖 30 章' })
    expect(model.plotMilestones).toHaveLength(12)
    expect(model.activeThreads).toHaveLength(12)
    expect(model.timelineAnchors).toHaveLength(10)
    expect(model.itemLedger).toHaveLength(10)
    expect(storyMemory?.plotMilestones).toHaveLength(14)
  })

  it('formats history rows and preserves the selected version contract', () => {
    const chapter = { id: 7, chapterNum: 3 } as Parameters<typeof buildHistoryInspectorViewModel>[0]['chapter']
    const versions = [{
      id: 11,
      novelId: 1,
      chapterId: 7,
      versionSource: 'ai-rewrite' as const,
      content: '修订正文',
      wordCount: 1200,
      createdAt: '2026-08-16T00:00:00.000Z',
    }]

    expect(buildHistoryInspectorViewModel({ chapter, versions, selectedVersion: versions[0], loading: false })).toMatchObject({
      chapterSelected: true,
      eyebrow: '第3章 · 可恢复版本',
      selectedVersionId: 11,
      selectedContent: '修订正文',
      canRestore: true,
      versions: [{ id: 11, sourceLabel: 'AI 重写' }],
    })
  })

  it('derives chapter focus copy from continuity, bridge and quality inputs', () => {
    expect(buildContinuityItems({
      plot_progress: ['拿到钥匙'],
      open_loops: ['门后身份未知'],
      arc_progress: '进入追查阶段',
    })).toEqual(['剧情推进：拿到钥匙', '未回收线索：门后身份未知', '故事弧推进：进入追查阶段'])
    expect(buildBridgeItems({
      locationTransition: '旧城到码头',
      timeJump: '次日凌晨',
      emotionCarry: '',
      firstSceneConstraint: '先确认跟踪者',
    } as Parameters<typeof buildBridgeItems>[0])).toEqual(['地点承接：旧城到码头', '时间承接：次日凌晨', '首场景约束：先确认跟踪者'])
    expect(buildQualityFocusItems({
      summaryHealth: null,
      expressionDedup: null,
      hookContinuity: { hookStrengthScore: 72 } as Parameters<typeof buildQualityFocusItems>[0]['hookContinuity'],
      reviewNotes: null,
      publishSummary: '可发布',
      nextChapterSeed: '从码头失踪案切入',
    })).toEqual(['钩子强度：72', '一致性快检：可发布', '下一章开场建议：从码头失踪案切入'])
  })

  it('keeps review and production priorities in their original order', () => {
    const notes = {
      summary: '风险摘要',
      critical_fixes: ['补足动机'],
      continuity_risks: [],
      language_risks: [],
      genre_hollowing_risks: [],
      revision_brief: '先修因果',
      protagonist_setback: 'none' as const,
      reward_state: 'major' as const,
      cost_present: false,
    }
    expect(buildReviewInsightItems(notes)).toEqual([
      '摘要回看：风险摘要',
      '修订摘要：先修因果',
      '关键修订：补足动机',
      '阶段回报：major',
    ])
    expect(buildProductionBriefItems(notes, [{ type: '表达', location: '', suggestion: '删掉模板句' }])).toEqual([
      '定稿方向：先修因果',
      '先改：补足动机',
      '主角阻力：当前章偏顺推，建议补出真实失败、失误或代价。',
      'AI体检：删掉模板句',
    ])
  })
})
