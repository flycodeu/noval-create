import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFallbackReviewNotes } from './chapter-review-notes'
import type { ChapterContext } from './context.service'
import type { ChapterPublishCheck } from './context-impact.service'

const mocks = vi.hoisted(() => ({
  runChatTask: vi.fn(),
  executeStreamTask: vi.fn(),
  isTransientModelNetworkError: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  persistAntiAiRuleHits: vi.fn(),
}))

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, fallback: string) => fallback,
}))

vi.mock('./task.service', () => ({
  runChatTask: mocks.runChatTask,
  executeStreamTask: mocks.executeStreamTask,
  isTransientModelNetworkError: mocks.isTransientModelNetworkError,
  updateTask: mocks.updateTask,
  updateTaskStatus: mocks.updateTaskStatus,
}))

vi.mock('./anti-ai-rule.service', () => ({
  persistAntiAiRuleHits: mocks.persistAntiAiRuleHits,
}))

import {
  buildChapterRewriterMessages,
  buildRewriterReleaseError,
  createRewriterStreamAttemptRunner,
  repairChapterOutputIfNeeded,
  runPublishGateRepair,
  runRewriterCandidateLoop,
  runRewriterQualityPipeline,
  runRewriteRiskRecheck,
  type RewriteOutcome,
} from './chapter-pipeline-rewriter'

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

const guidance = {
  povRotationGuidance: '固定单一视角',
  storyPacingGuidance: '前紧后缓',
  hookContinuityGuidance: '承接脚步声',
  expressionDedupGuidance: '避免重复冷笑',
  summaryHealthGuidance: '保留因果',
  voiceEvolutionGuidance: '说话更克制',
}

function rewriteOutcome(content: string): RewriteOutcome {
  return {
    content,
    reviewNotes: buildFallbackReviewNotes('重写复检通过'),
    miniReview: {
      improved: true,
      needsHumanReview: false,
      deltaDrivenOnly: false,
      reason: '已形成有效差异',
      similarityToOriginal: 0.2,
      narrativeDelta: {
        status: 'pass',
        structuralIssueCount: 0,
        similarityToOriginal: 0.2,
        changedSentenceRate: 0.8,
        narrativeAnchorChangeRate: 0.5,
        actionVerbDeltaRate: 0.5,
        conflictChain: { score: 1, status: 'pass', originalHitRate: 0, rewrittenHitRate: 1, deltaRate: 1, findings: [] },
        costChain: { score: 1, status: 'pass', originalHitRate: 0, rewrittenHitRate: 1, deltaRate: 1, findings: [] },
        goalChain: { score: 1, status: 'pass', originalHitRate: 0, rewrittenHitRate: 1, deltaRate: 1, findings: [] },
        findings: [],
        recommendation: '',
      },
    },
    dialogueAnalysis: {
      risks: [],
      similarities: [],
      drifts: [],
      fillerRisks: [],
      infoDensityRisks: [],
      requiredVoiceLockCharacterIds: [],
    },
  }
}

const noPriorityIssues = {
  topIssues: [],
  deferredIssues: [],
  rewriteScope: 'paragraph_patch' as const,
  requiresFullRewrite: false,
  forceMaxCoverage: false,
  counts: { high: 0, medium: 0, low: 0 },
  reasons: [],
}

function publishCheckFixture(overrides: Partial<ChapterPublishCheck> = {}): ChapterPublishCheck {
  return {
    ready: false,
    gateLevel: 'rewrite',
    summary: '开篇硬缺口',
    checklist: [{ key: 'opening', label: '开篇', status: 'blocker', detail: '缺少即时压力' }],
    ...overrides,
  } as ChapterPublishCheck
}

beforeEach(() => {
  mocks.runChatTask.mockReset()
  mocks.executeStreamTask.mockReset()
  mocks.isTransientModelNetworkError.mockReset()
  mocks.updateTask.mockReset()
  mocks.updateTaskStatus.mockReset()
  mocks.persistAntiAiRuleHits.mockReset().mockReturnValue({ hits: [] })
})

describe('chapter pipeline rewriter', () => {
  it('restarts a chapter 1 stream once when the provider fails before usable output', async () => {
    const transientError = new Error('connection reset')
    mocks.executeStreamTask
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ output: '第二个任务返回可用正文。' })
    mocks.isTransientModelNetworkError.mockImplementation((error) => error === transientError)
    const startRole = vi.fn()
      .mockResolvedValueOnce(71)
      .mockResolvedValueOnce(72)
    const runner = createRewriterStreamAttemptRunner({
      novelId: 7,
      chapterId: 101,
      defaultChatOptions: {},
      buildMessages: () => [{ role: 'user', content: '重写第一章' }],
      startRole,
      validateInputs: vi.fn(),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
      onChunk: vi.fn(),
    })

    const result = await runner(1, [], '执行重写')

    expect(result).toEqual({ taskId: 72, result: { output: '第二个任务返回可用正文。' } })
    expect(startRole).toHaveBeenCalledTimes(2)
    expect(mocks.updateTask).toHaveBeenCalledWith(71, expect.objectContaining({
      outputText: expect.stringContaining('自动新建 Rewriter 任务'),
    }))
  })

  it('accepts a distinct chapter 1 candidate without spending a retry', async () => {
    const runAttempt = vi.fn().mockResolvedValue({ taskId: 11, result: { output: '他撞开侧门，警铃随即响起。' } })
    const processOutcome = vi.fn(async (content: string) => rewriteOutcome(content))
    const markAttemptComplete = vi.fn()

    const result = await runRewriterCandidateLoop({
      draftContent: '他站在门前，没有动作。',
      reviewPrioritySummary: noPriorityIssues,
      requiresFullRewrite: false,
      genre: '悬疑',
      knownTerms: [],
      criticSemanticReview: null,
      runAttempt,
      processOutcome,
      evaluateSemantics: vi.fn().mockResolvedValue(null),
      markAttemptComplete,
      resolvePremiumChatOptions: vi.fn(),
    })

    expect(result.attemptNumber).toBe(1)
    expect(result.outcome.content).toBe('他撞开侧门，警铃随即响起。')
    expect(runAttempt).toHaveBeenCalledOnce()
    expect(processOutcome).toHaveBeenCalledOnce()
    expect(markAttemptComplete).not.toHaveBeenCalled()
  })

  it('composes the chapter 1 candidate, publish gate, and release check in order', async () => {
    const content = '他撞开侧门，警铃随即响起。'
    const outcome = rewriteOutcome(content)
    const publishCheck = publishCheckFixture({ ready: true, gateLevel: 'pass', summary: '通过', checklist: [] })
    const finalizePublishArtifacts = vi.fn()
    const syncRevisionState = vi.fn()
    const result = await runRewriterQualityPipeline({
      candidateLoop: {
        draftContent: '他站在门前。',
        reviewPrioritySummary: noPriorityIssues,
        requiresFullRewrite: false,
        genre: '悬疑',
        knownTerms: [],
        criticSemanticReview: null,
        runAttempt: vi.fn().mockResolvedValue({ taskId: 12, result: { output: content } }),
        processOutcome: vi.fn().mockResolvedValue(outcome),
        evaluateSemantics: vi.fn().mockResolvedValue(null),
        markAttemptComplete: vi.fn(),
        resolvePremiumChatOptions: vi.fn(),
      },
      postProcess: {
        genre: '悬疑',
        knownTerms: [],
        novelId: 7,
        chapterId: 0,
        chapterNum: 1,
        chapterTitle: '夜账',
        emotionTone: '紧张',
        scenePlanText: '1. 撞开侧门',
        criticSemanticReview: null,
        evaluateSemantics: vi.fn().mockResolvedValue(null),
      },
      gateRepair: {
        chapterId: 101,
        genre: '悬疑',
        knownTerms: [],
        markCurrentAttempt: vi.fn(),
        runAttempt: vi.fn(),
        processOutcome: vi.fn(),
        recheckRisks: vi.fn(),
        persistAccepted: vi.fn(),
      },
      goldenReview: {
        policy: { mode: 'off', fallbackMode: 'heuristic', goldenChapterNums: [], maxSemanticCallsPerChapter: 2 },
        evaluator: { hasBudget: () => true } as never,
        novelId: 7,
        chapterId: 101,
        chapterNum: 1,
        chapterTitle: '夜账',
        contractSummary: '必须逃出院落',
        scenePlanSummary: '撞开侧门',
        protagonistReference: '沈砚青',
      },
      persistCandidate: vi.fn().mockResolvedValue(publishCheck),
      persistGoldenReview: vi.fn(),
      rerunHeuristicPublishCheck: vi.fn(() => publishCheck),
      finalizePublishArtifacts,
      syncRevisionState,
      failRole: vi.fn(() => { throw new Error('unexpected') }),
      rewriteScope: 'paragraph_patch',
    })

    expect(result).toMatchObject({ content, taskId: 12, publishCheck })
    expect(finalizePublishArtifacts).toHaveBeenCalledWith(publishCheck)
    expect(syncRevisionState).toHaveBeenCalledOnce()
  })

  it('switches chapter 2 to a bounded variation when the first rewrite copies the draft', async () => {
    const draftContent = '楼梯上的脚步声逼近，他站在门后没有动作。'
    const runAttempt = vi.fn()
      .mockResolvedValueOnce({ taskId: 21, result: { output: draftContent } })
      .mockResolvedValueOnce({ taskId: 22, result: { output: '脚步压到门外时，他吹灭灯，从窗沿滑进雨巷。' } })
    const processOutcome = vi.fn(async (content: string) => rewriteOutcome(content))
    const markAttemptComplete = vi.fn()

    const result = await runRewriterCandidateLoop({
      draftContent,
      reviewPrioritySummary: {
        ...noPriorityIssues,
        rewriteScope: 'chapter_rewrite' as const,
        requiresFullRewrite: true,
        counts: { high: 1, medium: 0, low: 0 },
      },
      requiresFullRewrite: true,
      genre: '悬疑',
      knownTerms: [],
      criticSemanticReview: null,
      runAttempt,
      processOutcome,
      evaluateSemantics: vi.fn().mockResolvedValue(null),
      markAttemptComplete,
      resolvePremiumChatOptions: vi.fn(),
    })

    expect(result.attemptNumber).toBe(2)
    expect(result.taskId).toBe(22)
    expect(result.outcome.content).toContain('滑进雨巷')
    expect(runAttempt).toHaveBeenCalledTimes(2)
    expect(markAttemptComplete).toHaveBeenCalledWith(21, '首轮重写与初稿过近，已切换变体重试。', true)
    expect(result.rejectedDigests).toHaveLength(1)
  })
})

describe('chapter pipeline rewriter safeguards', () => {
  it('runs one final chapter 2 publish-gate repair and persists only the accepted candidate', async () => {
    const reviewNotes = buildFallbackReviewNotes('开篇待修复')
    const current = rewriteOutcome('脚步逼近，他仍站在原地。')
    const candidate = rewriteOutcome('脚步撞上门板时，他吹灭灯，翻窗落进雨巷。')
    const runAttempt = vi.fn().mockResolvedValue({ taskId: 32, result: { output: candidate.content } })
    const persistAccepted = vi.fn().mockResolvedValue(publishCheckFixture({
      ready: true,
      gateLevel: 'pass',
      summary: '验收通过',
      checklist: [],
    }))

    const result = await runPublishGateRepair({
      chapterId: 102,
      content: current.content,
      reviewNotes,
      miniReview: current.miniReview,
      publishCheck: publishCheckFixture(),
      taskId: 31,
      attemptNumber: 2,
      rejectedDigests: [],
      genre: '悬疑',
      knownTerms: [],
      markCurrentAttempt: vi.fn(),
      runAttempt,
      processOutcome: vi.fn().mockResolvedValue(candidate),
      recheckRisks: vi.fn(async (notes) => notes),
      persistAccepted,
    })

    expect(result.attemptNumber).toBe(5)
    expect(result.taskId).toBe(32)
    expect(result.publishCheck.ready).toBe(true)
    expect(runAttempt.mock.calls[0][3]).toContain('章节验收门定向修复')
    expect(persistAccepted).toHaveBeenCalledWith(candidate, 32)
  })

  it('maps an unresolved rewrite delta to a blocked release error before Canonizer', () => {
    const miniReview = rewriteOutcome('未改善').miniReview
    miniReview.needsHumanReview = true
    miniReview.reason = '结构差异不足'

    const error = buildRewriterReleaseError({
      miniReview,
      rewriteScope: 'chapter_rewrite',
      publishCheck: publishCheckFixture({ ready: true, gateLevel: 'pass' }),
    })

    expect(error?.code).toBe('human_review_required')
    expect(error?.message).toContain('结构差异不足')
    expect(error?.blocked).toBe(true)
  })

  it('assembles chapter 1 rewrite prompt with Critic evidence and locked paragraphs', () => {
    const messages = buildChapterRewriterMessages({
      novelTitle: '雾城旧账',
      genre: '悬疑',
      chapterNum: 1,
      chapterTitle: '夜账',
      emotionTone: '紧张',
      targetWords: 3200,
      storyCore: '追查矿难真相',
      context: contextFixture(1),
      themeChapterTest: '真相是否值得代价',
      consistencyNotes: '铜腰牌仍在韩铁根手中',
      structuralAlertsSummary: '主角推进过顺',
      scenePlanText: '1. 追出后门',
      draftContent: '【锁定】\n作者原句。\n【/锁定】',
      prioritizedReviewNotesText: '高优先级：补出可见代价',
      structuralRepairDirective: '重排冲突切入点',
      lockedParagraphs: ['作者原句。'],
      runtimeAssertions: ['不得新增无来源设定'],
      narrativeFields: {
        povGuidance: '固定沈砚青 POV',
        sensoryGuidance: '突出煤灰触感',
        narrativeRatioGuidance: '动作多于说明',
      },
      guidance,
      protagonistReference: '沈砚青',
      protagonistRule: '不凭空知晓幕后信息',
      promptTier: 'key',
      attemptNumber: 2,
      rejectedDigests: ['digest-1'],
    })

    expect(messages[0].content).toContain('chapter-1-hard-contract')
    expect(messages[0].content).toContain('高优先级：补出可见代价')
    expect(messages[0].content).toContain('重排冲突切入点')
    expect(messages[0].content).toContain('作者原句。')
    expect(messages[0].content).toContain('不得新增无来源设定')
  })

  it('keeps a clean chapter 1 candidate without spending a repair model call', async () => {
    const reviewNotes = buildFallbackReviewNotes('连续性正常')
    const output = await repairChapterOutputIfNeeded({
      chapter: { id: 101, novelId: 7, chapterNum: 1, title: '夜账' },
      novel: { title: '雾城旧账', modelConfigId: 3 },
      context: contextFixture(1),
      storyCore: '追查矿难真相',
      profile: { genre: '悬疑', protagonistReference: '沈砚青', protagonistRule: '不得全知' },
      scenePlanText: '1. 追出后门',
      consistencyNotes: '铜腰牌仍在韩铁根手中',
      structuralAlertsSummary: '',
      reviewNotes,
      content: '追兵踏进前院时，沈砚青已经翻过后墙。',
      lockedParagraphs: [],
      promptTier: 'standard',
      knownTerms: ['沈砚青'],
      targetWords: 3000,
    })

    expect(output.content).toBe('追兵踏进前院时，沈砚青已经翻过后墙。')
    expect(output.reviewNotes).toBe(reviewNotes)
    expect(mocks.runChatTask).not.toHaveBeenCalled()
  })

  it('rechecks only persisted chapter 2 risk categories and records resolved evidence', async () => {
    mocks.runChatTask.mockResolvedValue(JSON.stringify({
      step_memory_risks: [],
      opening_hook_risks: ['开篇压力仍不够具体'],
      hallucination_risks: [],
      title_alignment_risks: [],
      resolved_risks: ['已承接上章脚步声'],
    }))
    const reviewNotes = {
      ...buildFallbackReviewNotes('待复检'),
      step_memory_risks: ['未承接上章脚步声'],
      opening_hook_risks: ['开篇压力不具体'],
    }
    const output = await runRewriteRiskRecheck({
      reviewNotes,
      content: '楼梯上的脚步声逼近，他立刻吹灭油灯。',
      novelId: 7,
      chapterId: 102,
      chapterNum: 2,
      chapterTitle: '缺页',
      scenePlanText: '1. 吹灭油灯',
      modelConfigId: 3,
    })

    expect(output.step_memory_risks).toEqual([])
    expect(output.opening_hook_risks).toEqual(['开篇压力仍不够具体'])
    expect(output.rewrite_recheck?.resolved).toEqual(['已承接上章脚步声'])
    expect(mocks.runChatTask).toHaveBeenCalledOnce()
  })

  it('retains chapter 2 review evidence when the bounded recheck output is invalid', async () => {
    mocks.runChatTask.mockResolvedValue('not-json')
    const reviewNotes = {
      ...buildFallbackReviewNotes('待复检'),
      hallucination_risks: ['疑似新增无来源组织'],
    }
    const output = await runRewriteRiskRecheck({
      reviewNotes,
      content: '他提到了陌生组织。',
      novelId: 7,
      chapterId: 102,
      chapterNum: 2,
      chapterTitle: '缺页',
      scenePlanText: '',
    })

    expect(output).toBe(reviewNotes)
    expect(output.hallucination_risks).toEqual(['疑似新增无来源组织'])
  })
})
