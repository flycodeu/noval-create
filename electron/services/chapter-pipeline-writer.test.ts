import { describe, expect, it, vi } from 'vitest'
import { buildFallbackReviewNotes } from './chapter-review-notes'
import type { ChapterContext } from './context.service'
import type { ScenePlanStep } from './chapter-scene-plan'

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, fallback: string) => fallback,
}))

import {
  assertContractDrivenStageInputs,
  buildChapterWriterMessages,
  buildChapterWriterMaterialReport,
  buildLockedParagraphContext,
  enforceLockedParagraphProtection,
  parseLockedParagraphsJson,
  resolveWriterDraftOutput,
  runChapterWriterStage,
} from './chapter-pipeline-writer'

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
    authorStyleMaterials: {
      targetWorkSampleGuide: '作者说明：短句，现场细节优先。',
      humanStyleSampleLock: '他把账册压在膝上，没有先解释。',
    },
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

describe('chapter pipeline writer', () => {
  it('RF-04 renders each typed scene once and separates approved prose from instructions', () => {
    const scene = (order: number): ScenePlanStep => ({ scene_order: order, scene_title: `场景${order}`,
      purpose: `目的标记${order}`, conflict: `冲突标记${order}`, hidden_agendas: [`诉求标记${order}`], irony_gap: `信息差标记${order}`,
      location: '厨房', time_anchor: '早晨', present_characters: ['姐弟'], key_items: [], beat: '收碗', must_cover: [], climax_variant: '', exit_hook: '', audience: '' })
    const context = contextFixture(2)
    context.authorStyleMaterials = { targetWorkSampleGuide: '说明标记', humanStyleSampleLock: '日常中文。',
      approvedSample: { text: '样稿正文标记。', source: 'style_fingerprints:7', digest: 'fixture' } }
    const input: Parameters<typeof buildChapterWriterMessages>[0] = { novelTitle: '原创诊断', genre: '家庭关系', chapterNum: 2, chapterTitle: '厨房', emotionTone: '平静', targetWords: 1500,
      storyCore: '照顾母亲', context, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '旧文本不应重复注入',
      scenePlan: [scene(1), scene(2)], runtimeAssertions: [], narrativeFields: { povGuidance: '', sensoryGuidance: '', narrativeRatioGuidance: '' }, guidance,
      protagonistReference: '姐姐', protagonistRule: '', promptTier: 'standard' }
    const text = buildChapterWriterMessages(input)[0].content
    for (const marker of ['目的标记1', '目的标记2', '诉求标记1', '诉求标记2', '信息差标记1', '信息差标记2', '样稿正文标记', '说明标记']) {
      expect(text.split(marker)).toHaveLength(2)
    }
    expect(text.indexOf('诉求标记1')).toBeLessThan(text.indexOf('目的标记2'))
    expect(text).not.toMatch(/旧文本不应重复注入|场景目标与冲突均缺失|来源追踪：|风格材料估算：/)
    expect(buildChapterWriterMaterialReport(input).sceneSource).toBe('typed')
    const legacy = { ...input, scenePlan: undefined, scenePlanText: '姐弟约好明天接母亲出院。' }
    expect(buildChapterWriterMessages(legacy)[0].content.split(legacy.scenePlanText)).toHaveLength(2)
    expect(buildChapterWriterMaterialReport(legacy).diagnostics.join('')).toContain('未提供结构字段')
    expect(buildChapterWriterMaterialReport({ ...legacy, scenePlanText: '' }).diagnostics.join('')).toContain('未提供结构场景或历史场景文本')
    const calm = { ...input, scenePlan: [scene(1)].map((item) => ({ ...item, conflict: '', hidden_agendas: [], irony_gap: '' })) }
    const calmText = buildChapterWriterMessages(calm)[0].content
    expect(calmText).toContain('目的标记1')
    expect(calmText).not.toContain('各方心思=')
    context.authorStyleMaterials.approvedSample!.text = '长'.repeat(1500)
    const report = buildChapterWriterMaterialReport(input)
    expect(report.authorStyle.samples).toEqual([])
    expect(report.authorStyle.omittedSamples).toBe(1)
    expect(buildChapterWriterMessages(input)[0].content).not.toContain('作者样稿正文1')
  })
  it('assembles chapter 1 prompt with the Planner handoff and contract context', () => {
    const messages = buildChapterWriterMessages({
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
      structuralAlertsSummary: '近期主角推进过顺',
      scenePlanText: '1. 追出后门\n必须交代=带走账册',
      runtimeAssertions: ['逐场执行 Planner 计划'],
      narrativeFields: {
        povGuidance: '固定沈砚青 POV',
        sensoryGuidance: '突出煤灰触感',
        narrativeRatioGuidance: '动作多于说明',
      },
      guidance,
      protagonistReference: '沈砚青',
      protagonistRule: '不凭空知晓幕后信息',
      promptTier: 'key',
    })

    expect(messages[0].content).toContain('chapter-1-hard-contract')
    expect(messages[0].content).toContain('chapter-1-step-memory')
    expect(messages[0].content).toContain('逐场执行 Planner 计划')
    expect(messages[0].content).toContain('必须交代=带走账册')
    expect(messages[0].content).toContain('近期主角推进过顺')
    expect(messages[0].content).not.toContain('作者样稿正文1')
    expect(messages[0].content).toContain('作者说明（非正文样稿）')
    expect(messages[0].content.split('必须交代=带走账册')).toHaveLength(2)
    expect(messages[0].content).toContain('【读者自然度校准】')
    expect(messages[0].content).not.toContain('来源追踪：')
  })

  it('strips a model-authored chapter 1 heading and reports title mismatch', () => {
    const output = resolveWriterDraftOutput('# 第1章 假标题\n他翻过院墙。', 1, '夜账')

    expect(output.content).toBe('他翻过院墙。')
    expect(output.titleMismatchRisk).toContain('假标题')
    expect(output.titleMismatchRisk).toContain('夜账')
  })

  it('keeps chapter 2 locked paragraphs immutable and falls back after a violation', () => {
    const locked = '这段由作者亲自确认，不能改。'
    const chapter = {
      lockedParagraphsJson: JSON.stringify([
        locked,
        { content: locked },
        { paragraph: '第二个锁定段。' },
      ]),
      content: `开头。\n${locked}\n第二个锁定段。\n结尾。`,
    }
    const lockContext = buildLockedParagraphContext(chapter, '模型初稿。')

    expect(parseLockedParagraphsJson(chapter.lockedParagraphsJson)).toEqual([
      locked,
      '第二个锁定段。',
    ])
    expect(lockContext.promptDraftContent).toBe('模型初稿。')
    expect(lockContext.initialFallbackContent).toBe(chapter.content)

    const protectedOutput = enforceLockedParagraphProtection(
      '重写稿删除了锁定内容。',
      lockContext.lockedParagraphs,
      lockContext.initialFallbackContent,
      buildFallbackReviewNotes(''),
    )
    expect(protectedOutput.violated).toBe(true)
    expect(protectedOutput.content).toBe(chapter.content)
    expect(protectedOutput.reviewNotes.rewrite_required).toBe(true)
    expect(protectedOutput.reviewNotes.severity).toBe('high')
    expect(protectedOutput.reviewNotes.revision_brief).toContain('锁定段落必须逐字保留')
  })

  it('fails closed when Writer, Critic, or Rewriter lacks a contract handoff', () => {
    expect(() => assertContractDrivenStageInputs('writer', '', 'contract', 'scene')).toThrow()
    expect(() => assertContractDrivenStageInputs('critic', 'v1', '', 'scene')).toThrow()
    expect(() => assertContractDrivenStageInputs('rewriter', 'v1', 'contract', '')).toThrow()
    expect(() => assertContractDrivenStageInputs('writer', 'v1', 'contract', 'scene')).not.toThrow()
  })

  it('reuses the chapter 2 Writer snapshot without creating a model task', async () => {
    const startRole = vi.fn()
    const output = await runChapterWriterStage({
      shouldRun: false,
      chapterId: 102,
      novelId: 7,
      chapterNum: 2,
      chapterTitle: '缺页',
      promptInput: {} as never,
      chatOptions: {},
      contractVersion: 'contract-v2',
      scenePlanText: '1. 核对缺页',
      initialContent: '# 第2章 缺页\n他把缺页压进衣袋。',
      priorTaskId: 51,
      startRole,
      failRole: vi.fn(() => { throw new Error('unexpected') }),
    })

    expect(output).toMatchObject({
      content: '他把缺页压进衣袋。',
      taskId: 51,
      reused: true,
      resumed: false,
    })
    expect(startRole).not.toHaveBeenCalled()
  })
})
