import { describe, expect, it, vi } from 'vitest'
import type { ChapterContext } from './context.service'
import type { ScenePlanStep } from './chapter-scene-plan'

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, fallback: string) => fallback,
}))

import {
  buildChapterPlannerMessages,
  loadReusablePlannerOutput,
  resolvePlannerModelOutput,
  runChapterPlannerStage,
} from './chapter-pipeline-planner'

function contextFixture(chapterNum: number): ChapterContext {
  const prefix = `chapter-${chapterNum}`
  return {
    chapterGoal: `${prefix}-goal`,
    hardConstraintContext: `${prefix}-hard-contract`,
    dialogueVoiceLocks: `${prefix}-voice-lock`,
    writingContractSummary: `${prefix}-contract`,
    relationSummary: `${prefix}-relations`,
    currentArc: `${prefix}-arc`,
    worldRules: `${prefix}-world-rules`,
    characterStates: `${prefix}-character-states`,
    worldStates: `${prefix}-world-states`,
    mapSummary: `${prefix}-map`,
    itemSummary: `${prefix}-items`,
    previousSummaries: `${prefix}-previous-summary`,
    previousChapterContext: `${prefix}-previous-context`,
    lastChapterEnding: `${prefix}-last-ending`,
    chapterBridgePlan: `${prefix}-bridge`,
    stepMemorySummary: `${prefix}-step-memory`,
    continuitySummary: `${prefix}-continuity`,
    openLoops: `${prefix}-open-loops`,
    dueForeshadows: `${prefix}-foreshadows`,
    continuityNotes: `${prefix}-continuity-notes`,
    timelineSummary: `${prefix}-timeline`,
    timelineOpenThreads: `${prefix}-timeline-threads`,
    longTermMemory: `${prefix}-long-memory`,
    recalledMemory: `${prefix}-recalled-memory`,
    activeThreads: `${prefix}-active-threads`,
  } as ChapterContext
}

function sceneFixture(overrides: Partial<ScenePlanStep> = {}): ScenePlanStep {
  return {
    scene_order: 1,
    scene_title: '追出后门',
    purpose: '承接追兵压力',
    location: '后巷',
    time_anchor: '深夜',
    present_characters: ['沈砚青'],
    key_items: [],
    conflict: '必须在追兵合围前转移证据',
    beat: '翻墙进入后巷',
    must_cover: ['带走账册'],
    climax_variant: '',
    exit_hook: '巷口出现陌生灯号',
    hidden_agendas: ['接头人并不准备救他'],
    irony_gap: '读者知道灯号来自内鬼',
    audience: '追兵',
    ...overrides,
  }
}

describe('chapter pipeline planner', () => {
  it('assembles chapter 1 prompt from the prepared context without dropping handoff fields', () => {
    const messages = buildChapterPlannerMessages({
      novelTitle: '雾城旧账',
      genre: '悬疑',
      chapterNum: 1,
      chapterTitle: '夜账',
      plotPoints: '发现被改写的工册',
      emotionTone: '紧张',
      targetWords: 3200,
      storyCore: '追查矿难真相',
      context: contextFixture(1),
      consistencyNotes: '铜腰牌仍在韩铁根手中',
      runtimeAssertions: ['必须承接后巷追兵'],
      narrativeFields: {
        povGuidance: '固定沈砚青 POV',
        sensoryGuidance: '突出潮湿与煤灰触感',
        narrativeRatioGuidance: '动作多于说明',
      },
      guidance: {
        povRotationGuidance: '本章不轮换 POV',
        storyPacingGuidance: '前紧后缓',
        hookContinuityGuidance: '兑现上一章脚步声',
        expressionDedupGuidance: '避免重复冷笑',
        summaryHealthGuidance: '保留因果信息',
        voiceEvolutionGuidance: '沈砚青说话更克制',
      },
      protagonistReference: '沈砚青',
      protagonistRule: '不凭空知晓幕后信息',
      promptTier: 'key',
      designGateDirective: '必须推进原创工册制度',
      rhythmSection: '第一拍：追逃',
    })

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('chapter-1-hard-contract')
    expect(messages[0].content).toContain('chapter-1-step-memory')
    expect(messages[0].content).toContain('必须承接后巷追兵')
    expect(messages[0].content).toContain('必须推进原创工册制度')
    expect(messages[0].content).toContain('第一拍：追逃')
  })

  it('normalizes and reconciles chapter 1 output before persistence and writeback', () => {
    const persistScenePlan = vi.fn()
    const writeBackDesignFields = vi.fn(() => 1)
    const output = resolvePlannerModelOutput({
      chapterId: 101,
      novelId: 7,
      rawOutput: JSON.stringify([sceneFixture({ must_cover: [] })]),
      fallbackScenePlan: [sceneFixture()],
      contractSeeds: [{
        sceneOrder: 1,
        sceneTitle: '追出后门',
        sceneGoal: '承接追兵压力',
        location: '后巷',
        obstacle: '追兵合围',
        conflictType: '追逐',
        resultState: '账册被安全转移',
      }],
      persistScenePlan,
      writeBackDesignFields,
    })

    expect(output.scenePlan[0].must_cover).toContain('合同结果：账册被安全转移')
    expect(output.scenePlanText).toContain('账册被安全转移')
    expect(output.sceneDesignFieldGaps).toEqual([])
    expect(persistScenePlan).toHaveBeenCalledOnce()
    expect(writeBackDesignFields).toHaveBeenCalledWith(101, output.scenePlan)
  })

  it('uses the deterministic fallback for malformed chapter 2 output and reports design gaps', () => {
    const fallback = [sceneFixture({
      scene_order: 2,
      scene_title: '核对缺页',
      hidden_agendas: [],
      irony_gap: '',
    })]
    const output = resolvePlannerModelOutput({
      chapterId: 102,
      novelId: 7,
      rawOutput: 'not-json',
      fallbackScenePlan: fallback,
      contractSeeds: [],
      persistScenePlan: vi.fn(),
      writeBackDesignFields: vi.fn(() => 0),
    })

    expect(output.scenePlan).not.toBe(fallback)
    expect(output.scenePlan[0].scene_order).toBe(2)
    expect(output.sceneDesignFieldGaps).toHaveLength(2)
    expect(output.sceneDesignFieldGaps[0]).toContain('hidden_agendas 为空')
  })

  it('loads an immutable reusable planner snapshot or returns null when absent', () => {
    const scene = sceneFixture()
    const reusable = loadReusablePlannerOutput(JSON.stringify([scene]), [sceneFixture({ scene_title: 'fallback' })])

    expect(reusable?.scenePlan).toMatchObject([scene])
    expect(reusable?.scenePlan[0]).not.toBe(scene)
    expect(loadReusablePlannerOutput('', [scene])).toBeNull()
  })

  it('reuses the chapter 2 planner snapshot without starting or executing a model task', async () => {
    const scene = sceneFixture({ scene_order: 2, scene_title: '核对缺页' })
    const startRole = vi.fn()
    const setUpstreamTaskId = vi.fn()

    const output = await runChapterPlannerStage({
      shouldRun: false,
      chapterId: 102,
      novelId: 7,
      messages: [],
      chatOptions: {},
      fallbackScenePlan: [sceneFixture()],
      storedScenePlanJson: JSON.stringify([scene]),
      priorTaskId: 41,
      startRole,
      validateContracts: () => 'contract-v2',
      onContractValidated: vi.fn(),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
      persistScenePlan: vi.fn(),
      setUpstreamTaskId,
    })

    expect(output).toMatchObject({ reused: true, taskId: 41, contractVersion: 'contract-v2' })
    expect(output.scenePlan[0].scene_title).toBe('核对缺页')
    expect(startRole).not.toHaveBeenCalled()
    expect(setUpstreamTaskId).toHaveBeenCalledWith(41)
  })
})
