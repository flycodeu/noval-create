import type { WebContents } from 'electron'
import type { ChatOptions, Message } from '../adapters/base.adapter'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  appendRevisionBrief,
  buildTitleMismatchRisk,
  dedupeTextList,
  mergeSeverity,
  stripChapterHeadingNoise,
  type ChapterReviewNotes,
} from './chapter-review-notes'
import type { ChapterContext } from './context.service'
import type { ChapterComplexity } from './chapter-pipeline-context'
import type {
  ChapterPromptGuidance,
  ChapterPromptNarrativeFields,
} from './chapter-pipeline-planner'
import {
  getChapterPipelineRoleLabel,
  type ChapterPipelineRole,
} from './chapter-pipeline-state'
import { buildChapterDraftPrompt } from './story-prompts'
import { executeChatTask, updateTaskStatus } from './task.service'
import { buildPipelineFailureOutput, ChapterPipelineStageError } from './chapter-pipeline-errors'

export interface ChapterWriterPromptInput {
  novelTitle: string
  genre: string
  chapterNum: number
  chapterTitle: string
  emotionTone: string
  targetWords: number
  storyCore: string
  context: ChapterContext
  themeChapterTest: string
  consistencyNotes: string
  structuralAlertsSummary: string
  scenePlanText: string
  runtimeAssertions: string[]
  narrativeFields: ChapterPromptNarrativeFields
  guidance: ChapterPromptGuidance
  protagonistReference: string
  protagonistRule: string
  promptTier: ChapterComplexity
}

export interface WriterDraftOutput {
  content: string
  titleMismatchRisk: string
}

export interface WriterExecutionOutput extends WriterDraftOutput {
  taskId?: number
  reused: boolean
  resumed: boolean
}

export interface LockedParagraphContext {
  lockedParagraphs: string[]
  promptDraftContent: string
  initialFallbackContent: string
}

export function buildChapterWriterMessages(input: ChapterWriterPromptInput): Message[] {
  const { context } = input
  return [{
    role: 'user',
    content: buildChapterDraftPrompt({
      novelTitle: input.novelTitle,
      genre: input.genre,
      chapterNum: input.chapterNum,
      chapterTitle: input.chapterTitle,
      chapterGoal: context.chapterGoal,
      hardConstraintContext: context.hardConstraintContext,
      dialogueVoiceLocks: context.dialogueVoiceLocks,
      emotionTone: input.emotionTone,
      targetWords: input.targetWords,
      storyCore: input.storyCore,
      writingContractSummary: context.writingContractSummary,
      themeChapterTest: input.themeChapterTest,
      relationSummary: context.relationSummary,
      currentArc: context.currentArc,
      worldRules: context.worldRules,
      characterStates: context.characterStates,
      worldStates: context.worldStates,
      mapSummary: context.mapSummary,
      itemSummary: context.itemSummary,
      previousSummaries: context.previousSummaries,
      previousChapterContext: context.previousChapterContext,
      lastChapterEnding: context.lastChapterEnding,
      chapterBridgePlan: context.chapterBridgePlan,
      stepMemorySummary: context.stepMemorySummary,
      runtimeAssertions: input.runtimeAssertions,
      continuitySummary: context.continuitySummary,
      openLoops: context.openLoops,
      dueForeshadows: context.dueForeshadows,
      continuityNotes: context.continuityNotes,
      timelineSummary: context.timelineSummary,
      timelineOpenThreads: context.timelineOpenThreads,
      longTermMemory: context.longTermMemory,
      recalledMemory: context.recalledMemory,
      consistencyNotes: input.consistencyNotes,
      structuralAlertsSummary: input.structuralAlertsSummary,
      scenePlan: input.scenePlanText,
      draftContent: '',
      reviewNotes: '',
      activeThreads: context.activeThreads,
      ...input.narrativeFields,
      ...input.guidance,
      protagonistReference: input.protagonistReference,
      protagonistRule: input.protagonistRule,
      promptTier: input.promptTier,
    }),
  }]
}

export function resolveWriterDraftOutput(
  rawOutput: string,
  chapterNum: number,
  chapterTitle: string,
): WriterDraftOutput {
  const heading = stripChapterHeadingNoise(rawOutput, chapterNum, chapterTitle)
  return {
    content: heading.content,
    titleMismatchRisk: buildTitleMismatchRisk(heading.detectedTitle, chapterTitle, chapterNum),
  }
}

export function assertContractDrivenStageInputs(
  role: Exclude<ChapterPipelineRole, 'planner' | 'canonizer' | 'finalize'>,
  contractVersion: string,
  writingContractSummary: string,
  scenePlanText: string,
): void {
  if (!contractVersion.trim()) {
    throwUserFacingError('chapter.pipelineMissingContractVersion', { role: getChapterPipelineRoleLabel(role) })
  }
  if (!writingContractSummary.trim()) {
    throwUserFacingError('chapter.pipelineMissingContractSummary', { role: getChapterPipelineRoleLabel(role) })
  }
  if (!scenePlanText.trim()) {
    throwUserFacingError('chapter.pipelineMissingScenePlan', { role: getChapterPipelineRoleLabel(role) })
  }
}

export function parseLockedParagraphsJson(raw?: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return dedupeTextList(parsed.map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
      const record = item as Record<string, unknown>
      return typeof record.content === 'string'
        ? record.content
        : typeof record.paragraph === 'string'
          ? record.paragraph
          : typeof record.text === 'string'
            ? record.text
            : ''
    }))
  } catch {
    return []
  }
}

function normalizeParagraphFingerprint(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
}

function contentContainsLockedParagraph(content: string, lockedParagraph: string): boolean {
  const normalizedContent = normalizeParagraphFingerprint(content)
  const normalizedParagraph = normalizeParagraphFingerprint(lockedParagraph)
  return Boolean(normalizedParagraph && normalizedContent.includes(normalizedParagraph))
}

export function contentPreservesLockedParagraphs(content: string, lockedParagraphs: string[]): boolean {
  if (lockedParagraphs.length === 0) return true
  if (!content.trim()) return false
  return lockedParagraphs.every((paragraph) => contentContainsLockedParagraph(content, paragraph))
}

export function markLockedParagraphsInContent(content: string, lockedParagraphs: string[]): string {
  if (!content.trim() || lockedParagraphs.length === 0) return content
  let next = content
  lockedParagraphs
    .slice()
    .sort((left, right) => right.length - left.length)
    .forEach((paragraph) => {
      if (!paragraph || !next.includes(paragraph)) return
      next = next.split(paragraph).join(`【锁定】\n${paragraph}\n【/锁定】`)
    })
  return next
}

export function buildLockedParagraphContext(
  chapter: { lockedParagraphsJson?: string | null; content?: string | null },
  draftContent: string,
): LockedParagraphContext {
  const lockedParagraphs = parseLockedParagraphsJson(chapter.lockedParagraphsJson)
  const previousContent = typeof chapter.content === 'string' ? chapter.content.trim() : ''
  const initialFallbackContent = contentPreservesLockedParagraphs(previousContent, lockedParagraphs)
    ? previousContent
    : draftContent.trim()
  return {
    lockedParagraphs,
    promptDraftContent: markLockedParagraphsInContent(draftContent, lockedParagraphs),
    initialFallbackContent,
  }
}

export function enforceLockedParagraphProtection(
  content: string,
  lockedParagraphs: string[],
  fallbackContent: string,
  reviewNotes: ChapterReviewNotes,
): { content: string; reviewNotes: ChapterReviewNotes; violated: boolean } {
  const trimmed = content.trim()
  if (lockedParagraphs.length === 0 || contentPreservesLockedParagraphs(trimmed, lockedParagraphs)) {
    return { content: trimmed, reviewNotes, violated: false }
  }
  return {
    content: fallbackContent.trim() || trimmed,
    reviewNotes: {
      ...reviewNotes,
      critical_fixes: dedupeTextList([
        '严格保留作者锁定段落，任何改动只能发生在未锁定内容。',
        ...reviewNotes.critical_fixes,
      ]),
      language_risks: dedupeTextList([
        '本次重写改动了作者锁定段落，已触发保护回退。',
        ...reviewNotes.language_risks,
      ]),
      severity: mergeSeverity(reviewNotes.severity, 'high'),
      rewrite_required: true,
      summary: reviewNotes.summary || '检测到锁定段落被改写，当前结果已回退到安全版本。',
      revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
        '锁定段落必须逐字保留，只能调整周边衔接。',
      ]),
    },
    violated: true,
  }
}

export async function runChapterWriterStage(input: {
  shouldRun: boolean
  chapterId: number
  novelId: number
  chapterNum: number
  chapterTitle: string
  modelConfigId?: number
  sender?: WebContents
  promptInput: ChapterWriterPromptInput
  chatOptions: ChatOptions
  contractVersion: string
  scenePlanText: string
  initialContent: string
  resumeDraft?: string
  priorTaskId?: number
  recoveryHintJson?: string
  startRole: (messages: Message[], resumed: boolean) => Promise<number>
  failRole: (taskId: number, error: unknown, blocked?: boolean) => never
}): Promise<WriterExecutionOutput> {
  if (!input.shouldRun) {
    const output = resolveWriterDraftOutput(input.initialContent, input.chapterNum, input.chapterTitle)
    if (!output.content.trim()) {
      throw new ChapterPipelineStageError('empty_output', '没有可复用的 Writer 正文快照，无法从当前节点重试。', {
        blocked: true,
        outputText: buildPipelineFailureOutput('empty_output', '没有可复用的 Writer 正文快照。'),
      })
    }
    return { ...output, taskId: input.priorTaskId, reused: true, resumed: false }
  }

  const messages = buildChapterWriterMessages(input.promptInput)
  const resumedDraft = input.resumeDraft?.trim() || ''
  const taskId = await input.startRole(messages, Boolean(resumedDraft))
  try {
    assertContractDrivenStageInputs(
      'writer',
      input.contractVersion,
      input.promptInput.context.writingContractSummary,
      input.scenePlanText,
    )
  } catch (error) {
    updateTaskStatus(taskId, 'failed', input.sender, {
      pipelineStage: 'blocked',
      errorMessage: error instanceof Error ? error.message : 'Writer 缺少合同输入',
      recoveryHintJson: input.recoveryHintJson,
    })
    input.failRole(taskId, error, true)
  }
  const rawOutput = resumedDraft || await executeChatTask(taskId, {
    type: 'chapter_writer',
    novelId: input.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: input.chapterId,
    inputJson: JSON.stringify(messages),
    messages,
    modelConfigId: input.modelConfigId,
    chatOpts: input.chatOptions,
    retryable: true,
    sender: input.sender,
  })
  if (resumedDraft) {
    updateTaskStatus(taskId, 'success', input.sender, {
      pipelineStage: 'success',
      contractVersion: input.contractVersion,
      outputText: '已复用失败流程保留稿；未跳过 Critic、Rewriter、发布门、Canonizer 或 Finalize。',
    })
  }
  const output = resolveWriterDraftOutput(rawOutput, input.chapterNum, input.chapterTitle)
  if (!output.content.trim()) {
    input.failRole(taskId, new ChapterPipelineStageError(
      'empty_output',
      'Writer 未返回可用正文，已阻断后续审校与回写；请重试或检查模型输出。',
      { outputText: buildPipelineFailureOutput('empty_output', 'Writer 未返回可用正文，已阻断后续审校与回写。') },
    ))
  }
  return { ...output, taskId, reused: false, resumed: Boolean(resumedDraft) }
}

/** Keeps Writer prompt assembly and stage execution behind one pipeline boundary. */
export async function executeChapterWriterPhase(input: {
  promptInput: ChapterWriterPromptInput
  shouldRun: boolean
  chapterId: number
  novelId: number
  chapterNum: number
  chapterTitle: string
  modelConfigId?: number
  sender?: WebContents
  chatOptions: ChatOptions
  contractVersion: string
  scenePlanText: string
  initialContent: string
  resumeDraft?: string
  priorTaskId?: number
  recoveryHintJson?: string
  startRole: (messages: Message[], resumed: boolean) => Promise<number>
  failRole: (taskId: number, error: unknown, blocked?: boolean) => never
}): Promise<WriterExecutionOutput> {
  return runChapterWriterStage(input)
}
