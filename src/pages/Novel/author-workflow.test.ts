import { describe, expect, it } from 'vitest'
import { buildProjectBriefPayload } from '../../shared/project-brief'
import { buildStorySettingsPayload } from '../../shared/story-settings'
import { buildThemeVoicePayload, parseThemeVoiceDocument } from '../../shared/theme-voice'
import {
  buildAuthorWorkflowSummary,
  resolveSuggestedAuthorWorkMode,
  type AuthorWorkflowQualitySummary,
} from './author-workflow'
import { EMPTY_WORKFLOW_STATS, type WorkflowStats } from './workflow'

type WorkflowQualitySummary = NonNullable<AuthorWorkflowQualitySummary>

function makeStats(patch: Partial<WorkflowStats> = {}): WorkflowStats {
  return {
    ...EMPTY_WORKFLOW_STATS,
    ...patch,
  }
}

function makeQualitySummary(overrides: {
  productionReadiness?: Partial<WorkflowQualitySummary['productionReadiness']>
  batchHealth?: Partial<WorkflowQualitySummary['batchHealth']>
  continuityHealth?: Partial<WorkflowQualitySummary['continuityHealth']>
} = {}): WorkflowQualitySummary {
  const base: WorkflowQualitySummary = {
    productionReadiness: {
      status: 'ready',
      summary: '当前可以继续推进。',
      blockers: [],
      warnings: [],
      suggestedActions: [],
      readyRate: 92,
      contractBlockerCount: 0,
      writebackPendingCount: 0,
      writebackFailedCount: 0,
      aiRecurrenceHighRiskCount: 0,
      feedbackPauseSuggestedCount: 0,
      consecutiveRecallFallbackChapters: 0,
    },
    batchHealth: {
      status: 'idle',
      chapterIds: [],
      completedChapterCount: 0,
      failedChapterCount: 0,
      warningCount: 0,
      rewriteTaskCount: 0,
      pendingWritebackCount: 0,
      pendingRevisionCount: 0,
      canContinue: false,
      summary: '当前没有运行中的后台批次。',
    },
    continuityHealth: {
      staleCheckpointCount: 0,
      latestCheckpointChapterGap: 0,
      recallDegradedChapterCount: 0,
      consecutiveRecallFallbackChapters: 0,
      worldConflictCount: 0,
      writebackPendingCount: 0,
      writebackFailedCount: 0,
    },
  }

  return {
    productionReadiness: {
      ...base.productionReadiness,
      ...overrides.productionReadiness,
    },
    batchHealth: {
      ...base.batchHealth,
      ...overrides.batchHealth,
    },
    continuityHealth: {
      ...base.continuityHealth,
      ...overrides.continuityHealth,
    },
  }
}

function makeNovel(flags: {
  basics?: boolean
  projectBrief?: boolean
  storyCore?: boolean
  storyPlot?: boolean
  themeVoice?: boolean
  worldRules?: boolean
  endgame?: boolean
  launchMode?: 'professional_longform' | 'fast_launch'
} = {}) {
  const settingsPatch: Parameters<typeof buildStorySettingsPayload>[0] = {}

  if (flags.storyCore) {
    settingsPatch.premise = {
      positioning: '废土求生升级',
      coreHook: '主角必须在三十天内夺回遗失核心',
      protagonistStart: '被逐出主城的修补匠',
      constraints: '离开供氧圈就会迅速衰竭',
      languageGuardrails: '保持冷硬、具象、避免总结腔',
    }
  }

  if (flags.storyPlot) {
    settingsPatch.storyDesign = {
      storyGoal: '夺回城市供氧核心',
      coreConflict: '主角必须在旧同伴与新盟友之间选边',
      mainPlot: '围绕供氧核心展开的夺回与反夺回',
      ending: '主角重建秩序但失去旧身份',
    }
  }

  if (flags.endgame) {
    settingsPatch.endgameDesign = {
      endingMode: 'costly_victory',
      finalConflict: '在主城中枢与反派正面对决',
      themeAnswer: '秩序必须付代价才能重建',
      mustDeliverPromises: '兑现供氧核心、旧同伴、阶层裂痕三条承诺',
      payoffChecklist: '主角身份、旧债、主城归属',
      deliberateUnknowns: '保留外环文明的后续空间',
      finalImage: '主角独自看向重新亮起的城区',
      lastScene: '他关上主城最后一道隔离门',
    }
  }

  return {
    launchMode: flags.launchMode,
    title: flags.basics ? '北境回潮' : '',
    synopsis: flags.basics ? '被逐修补匠必须夺回供氧核心。' : '',
    userBackground: flags.basics ? '废土主城与外环遗迹共存。' : '',
    expandedBackground: flags.basics ? '资源、氧气与身份制度构成主要压力。' : '',
    projectBriefJson: flags.projectBrief
      ? buildProjectBriefPayload({
        platformMode: 'web_serial',
        targetAudience: '男频升级流',
        targetReader: '喜欢末世工业感与资源争夺的读者',
        readerPromise: '高压生存、升级与秩序重建',
        sellingPoints: '供氧核心争夺 + 工业废土 + 身份反转',
        compTitles: '狩魔手记 / 废土边缘',
      })
      : '',
    settingsJson: Object.keys(settingsPatch).length > 0
      ? JSON.stringify(buildStorySettingsPayload(settingsPatch))
      : '',
    themeVoiceJson: flags.themeVoice
      ? buildThemeVoicePayload({
        writingContractTags: ['强剧情', '强冲突'],
        theme: '秩序的代价',
        themeChapterTest: '每章冲突都要让角色在秩序和代价之间做选择。',
        emotionalCore: '在背叛与责任之间硬撑',
        pov: 'third_limited',
        tense: 'past',
        styleRules: '句子短，动作明确，少解释。',
        dialogueRules: '对白带压迫感，不替人物总结情绪。',
        targetWorkSampleGuide: '对照样章的短句、压迫节奏和动作密度。',
        humanStyleSampleLock: '保留人工样本的冷硬动作感，禁止总结腔。',
      })
      : '',
    worldRulesJson: flags.worldRules ? '{}' : '',
  }
}

describe('author-workflow mode selection', () => {
  it('preserves theme validation and sample lock fields in theme voice payloads', () => {
    const novel = makeNovel({ themeVoice: true })
    const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)

    expect(themeVoice.themeChapterTest).toContain('秩序和代价')
    expect(themeVoice.targetWorkSampleGuide).toContain('压迫节奏')
    expect(themeVoice.humanStyleSampleLock).toContain('冷硬动作感')
  })

  it('uses quick start for unopened projects', () => {
    const result = resolveSuggestedAuthorWorkMode(makeNovel(), makeStats(), makeQualitySummary())

    expect(result.mode).toBe('quick_start')
  })

  it('switches to asset building when the foundation is ready but assets are still missing', () => {
    const result = resolveSuggestedAuthorWorkMode(
      makeNovel({
        basics: true,
        projectBrief: true,
        storyCore: true,
        themeVoice: true,
        worldRules: true,
      }),
      makeStats(),
      makeQualitySummary(),
    )

    expect(result.mode).toBe('asset_building')
  })

  it('switches to daily push once writing has already started', () => {
    const result = resolveSuggestedAuthorWorkMode(
      makeNovel(),
      makeStats({ chapterCount: 3, totalWords: 6800 }),
      makeQualitySummary(),
    )

    expect(result.mode).toBe('daily_push')
  })

  it('switches to revision closure when production is blocked', () => {
    const result = resolveSuggestedAuthorWorkMode(
      makeNovel(),
      makeStats({ chapterCount: 2, totalWords: 4200 }),
      makeQualitySummary({
        productionReadiness: {
          status: 'blocked',
          summary: '当前生产总灯阻断。',
        },
      }),
    )

    expect(result.mode).toBe('revision_closure')
  })

  it('keeps fast-launch projects in quick-start mode before正文启动', () => {
    const result = resolveSuggestedAuthorWorkMode(
      makeNovel({
        basics: true,
        launchMode: 'fast_launch',
      }),
      makeStats({
        outlineCount: 1,
        timelineCount: 1,
        threadCount: 1,
        volumeCount: 1,
      }),
      makeQualitySummary(),
    )

    expect(result.mode).toBe('quick_start')
    expect(result.reason).toContain('极速开书路径')
  })
})

describe('author-workflow primary task selection', () => {
  it('routes quick-start projects to overview basics first', () => {
    const summary = buildAuthorWorkflowSummary(
      makeNovel(),
      makeStats(),
      makeQualitySummary(),
      'quick_start',
    )

    expect(summary.primaryTask.id).toBe('basics')
    expect(summary.primaryTask.entryPage).toBe('overview')
  })

  it('routes asset-building projects to map when world rules exist but the map is empty', () => {
    const summary = buildAuthorWorkflowSummary(
      makeNovel({
        basics: true,
        projectBrief: true,
        storyCore: true,
        themeVoice: true,
        worldRules: true,
      }),
      makeStats(),
      makeQualitySummary(),
      'asset_building',
    )

    expect(summary.primaryTask.id).toBe('asset-map')
    expect(summary.primaryTask.entryPage).toBe('map')
  })

  it('routes daily push to the backend task center when a paused batch can resume', () => {
    const summary = buildAuthorWorkflowSummary(
      makeNovel(),
      makeStats({ chapterCount: 6, totalWords: 24000 }),
      makeQualitySummary({
        batchHealth: {
          status: 'paused',
          canContinue: true,
          chapterIds: [11, 12],
          summary: '最近批次暂停，可从第 11 章继续。',
        },
      }),
      'daily_push',
    )

    expect(summary.primaryTask.id).toBe('daily-resume-batch')
    expect(summary.primaryTask.entryPage).toBe('task-center')
  })

  it('routes revision closure to writeback when writeback is still pending', () => {
    const summary = buildAuthorWorkflowSummary(
      makeNovel(),
      makeStats({ chapterCount: 8, totalWords: 36000 }),
      makeQualitySummary({
        productionReadiness: {
          writebackPendingCount: 2,
          summary: '仍有章节回写未完成。',
        },
      }),
      'revision_closure',
    )

    expect(summary.primaryTask.id).toBe('revision-writeback')
    expect(summary.primaryTask.entryPage).toBe('writeback')
  })

  it('stops pre-writing asset bloat by routing back to outline or writing', () => {
    const summary = buildAuthorWorkflowSummary(
      makeNovel({
        basics: true,
        projectBrief: true,
        storyCore: true,
        themeVoice: true,
        worldRules: true,
      }),
      makeStats({
        mapCount: 6,
        factionCount: 4,
        characterCount: 10,
        itemCount: 6,
        glossaryCount: 4,
        sceneTemplateCount: 2,
      }),
      makeQualitySummary(),
      'asset_building',
    )

    expect(summary.primaryTask.id).toBe('asset-compress-volume')
    expect(summary.impactNotices.some((notice) => notice.id === 'impact-asset-bloat')).toBe(true)
  })
})
