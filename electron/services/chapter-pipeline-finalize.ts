import { desc, eq } from 'drizzle-orm'
import type { WebContents } from 'electron'
import { getDb } from '../database/db'
import { chapterWritebackRuns } from '../database/schema'
import type { ChapterContextRawData } from './context.service'
import { createChapterEndCreativeStageHandoffDraft } from './creative-stage-handoff.service'
import { upsertCreativeStageAsset } from './creative-stage.service'
import { scheduleDialogueFingerprintRefresh } from './dialogue-fingerprint.service'
import { generateChapterEmbeddings } from './embedding.service'
import { buildPipelineFailureOutput, ChapterPipelineStageError } from './chapter-pipeline-errors'
import type { ChapterPipelineRuntimeBindings } from './chapter-pipeline-runtime'
import { prepareChapterWritebackRunWithRetry } from './chapter-writeback.service'
import { updateTaskStatus } from './task.service'

export type ChapterCanonRun = Awaited<ReturnType<typeof prepareChapterWritebackRunWithRetry>>

export interface GeneratedChapterFinalizeResult {
  chapterId: number
  summary: string
  nextChapterSeed: string
  wordCount: number
  status: string
}

interface FinalizeChapterRecord {
  id: number
  novelId: number
  chapterNum: number
  title?: string | null
}

export async function loadOrPrepareChapterCanonRun(input: {
  chapterId: number
  prepare: boolean
}): Promise<{ canonRun: ChapterCanonRun; reused: boolean }> {
  if (input.prepare) {
    return {
      canonRun: await prepareChapterWritebackRunWithRetry(input.chapterId, 'pipeline-canonizer', 3),
      reused: false,
    }
  }
  const reusableCanonRun = getDb().select().from(chapterWritebackRuns)
    .where(eq(chapterWritebackRuns.chapterId, input.chapterId))
    .orderBy(desc(chapterWritebackRuns.id))
    .all()
    .find((run) => ['draft', 'ready', 'applying', 'applied'].includes(run.status || ''))
  if (!reusableCanonRun) {
    throw new ChapterPipelineStageError('canon_pending', '没有可复用的 Canon 快照，无法从 Finalize 节点重试。', {
      blocked: true,
      outputText: buildPipelineFailureOutput('canon_pending', '没有可复用的 Canon 草案。'),
    })
  }
  return {
    canonRun: reusableCanonRun as unknown as ChapterCanonRun,
    reused: true,
  }
}

export async function finalizeChapterPipelineOutput(input: {
  chapter: FinalizeChapterRecord
  novelModelConfigId?: number
  creativeStageContext?: ChapterContextRawData['creativeStageContext']
  content: string
  commitContent: () => Promise<GeneratedChapterFinalizeResult>
  getCommittedChapter: () => FinalizeChapterRecord | null
}): Promise<GeneratedChapterFinalizeResult> {
  const result = await input.commitContent()
  const creativeStageContext = input.creativeStageContext
  if (creativeStageContext) {
    try {
      upsertCreativeStageAsset({
        stageId: creativeStageContext.stage.id,
        assetType: 'outline',
        assetId: input.chapter.id,
        placeholderName: `第${input.chapter.chapterNum}章 ${input.chapter.title || '正文'}`,
        role: 'handoff',
        detailLevel: 'canonical',
        status: 'active',
        notes: '正文已完成，章后 Canon / 连续性回写已进入阶段交接。',
      })
    } catch (error) {
      console.warn('[creative-stage] 正文阶段交接绑定失败', error)
    }
    if (creativeStageContext.stage.chapterEnd === input.chapter.chapterNum) {
      try {
        const handoffDraft = await createChapterEndCreativeStageHandoffDraft({
          novelId: input.chapter.novelId,
          stageId: creativeStageContext.stage.id,
          chapterId: input.chapter.id,
          chapterNum: input.chapter.chapterNum,
          chapterTitle: input.chapter.title || '',
          chapterContent: input.content,
          summary: result.summary,
          nextChapterSeed: result.nextChapterSeed,
          continuitySummary: '',
          modelConfigId: input.novelModelConfigId,
        })
        console.info(`[creative-stage] 章末交接草稿已生成 mode=${handoffDraft.extractionMode} chapter=${input.chapter.chapterNum}`)
      } catch (error) {
        console.warn('[creative-stage] 阶段交接草稿种子创建失败', error)
      }
    }
  }

  scheduleDialogueFingerprintRefresh(input.chapter.novelId, input.novelModelConfigId)
  const committedChapter = input.getCommittedChapter()
  if (committedChapter) {
    generateChapterEmbeddings(committedChapter.novelId, input.chapter.id, input.novelModelConfigId)
      .catch((error) => console.warn('[embedding] 向量生成失败（不影响主流程）:', error))
  }
  return result
}

export function buildChapterFinalizeDetail(input: {
  publishSummary: string
  nextChapterSeed: string
}): string {
  return [
    '章节已入稿，并刷新摘要、连续性与长期记忆。',
    input.publishSummary ? `一致性快检：${input.publishSummary}` : '',
    input.nextChapterSeed ? `下一章开场建议：${input.nextChapterSeed}` : '',
  ].filter(Boolean).join(' ')
}

export async function runChapterCanonizerAndFinalize(input: {
  chapterId: number
  sender?: WebContents
  contractVersion: string
  prepareCanon: boolean
  priorCanonizerTaskId?: number
  canonizerRecoveryHintJson?: string
  startCanonizer: () => Promise<number>
  startFinalize: (canonRunId: number) => Promise<number>
  finishCanonizer: (taskId: number, detail: string, canonRunId: number) => void
  finishFinalize: (taskId: number, detail: string, canonRunId: number) => void
  failCanonizer: (taskId: number, error: unknown) => never
  onCanonReused: (canonRun: ChapterCanonRun, priorTaskId?: number) => void
  finalizeContent: () => Promise<GeneratedChapterFinalizeResult>
  publishSummary: string
}): Promise<{
  result: GeneratedChapterFinalizeResult
  canonRun: ChapterCanonRun
  finalizeDetail: string
}> {
  let canonizerTaskId: number | undefined
  if (input.prepareCanon) {
    canonizerTaskId = await input.startCanonizer()
    updateTaskStatus(canonizerTaskId, 'running', input.sender, {
      pipelineStage: 'running',
      contractVersion: input.contractVersion,
    })
  }
  const { canonRun, reused } = await loadOrPrepareChapterCanonRun({
    chapterId: input.chapterId,
    prepare: input.prepareCanon,
  })
  if (!reused && typeof canonizerTaskId === 'number') {
    if (canonRun.status === 'failed') {
      updateTaskStatus(canonizerTaskId, 'failed', input.sender, {
        pipelineStage: 'failed',
        contractVersion: input.contractVersion,
        canonRunId: canonRun.id,
        errorMessage: canonRun.errorMessage || 'Canon 草案生成失败',
        recoveryHintJson: input.canonizerRecoveryHintJson,
      })
      input.failCanonizer(canonizerTaskId, new Error(canonRun.errorMessage || 'Canon 草案生成失败'))
    }
    const detail = canonRun.summaryText?.trim() || 'Canon 差异草案已生成，可进入章后状态回写中心确认。'
    updateTaskStatus(canonizerTaskId, 'success', input.sender, {
      pipelineStage: 'success',
      contractVersion: input.contractVersion,
      canonRunId: canonRun.id,
      outputText: detail,
      errorMessage: null,
      recoveryHintJson: null,
    })
    input.finishCanonizer(canonizerTaskId, detail, canonRun.id)
  } else {
    input.onCanonReused(canonRun, input.priorCanonizerTaskId)
  }

  const finalizeTaskId = await input.startFinalize(canonRun.id)
  updateTaskStatus(finalizeTaskId, 'running', input.sender, {
    pipelineStage: 'running',
    contractVersion: input.contractVersion,
    canonRunId: canonRun.id,
  })
  const result = await input.finalizeContent()
  const finalizeDetail = buildChapterFinalizeDetail({
    publishSummary: input.publishSummary,
    nextChapterSeed: result.nextChapterSeed,
  })
  updateTaskStatus(finalizeTaskId, 'success', input.sender, {
    pipelineStage: 'success',
    contractVersion: input.contractVersion,
    canonRunId: canonRun.id,
    outputText: finalizeDetail,
    errorMessage: null,
    recoveryHintJson: null,
  })
  input.finishFinalize(finalizeTaskId, finalizeDetail, canonRun.id)
  return { result, canonRun, finalizeDetail }
}

export async function executeChapterFinalizePhase(input: {
  chapterId: number
  sender?: WebContents
  contractVersion: string
  priorCanonizerTaskId?: number
  canonizerRecoveryHintJson?: string
  bindings: Pick<
    ChapterPipelineRuntimeBindings,
    'shouldRun' | 'startRole' | 'finishRole' | 'reuseRole' | 'failRole'
  >
  finalizeContent: () => Promise<GeneratedChapterFinalizeResult>
  publishSummary: string
}): ReturnType<typeof runChapterCanonizerAndFinalize> {
  const { bindings } = input
  return runChapterCanonizerAndFinalize({
    chapterId: input.chapterId,
    sender: input.sender,
    contractVersion: input.contractVersion,
    prepareCanon: bindings.shouldRun('canonizer'),
    priorCanonizerTaskId: input.priorCanonizerTaskId,
    canonizerRecoveryHintJson: input.canonizerRecoveryHintJson,
    startCanonizer: () => bindings.startRole(
      'canonizer',
      'chapter_canonizer',
      'Canonizer 正在为本章准备可确认的状态差异草案。',
      { runnerType: 'workflow' },
    ),
    startFinalize: (canonRunId) => bindings.startRole(
      'finalize',
      'chapter_finalize',
      '正在刷新摘要、连续性与故事记忆。',
      { runnerType: 'workflow', canonRunId },
    ),
    finishCanonizer: (taskId, detail, canonRunId) => bindings.finishRole(
      'canonizer',
      taskId,
      detail,
      { canonRunId },
    ),
    finishFinalize: (taskId, detail, canonRunId) => bindings.finishRole(
      'finalize',
      taskId,
      detail,
      { canonRunId },
    ),
    failCanonizer: (taskId, error) => bindings.failRole('canonizer', taskId, error),
    onCanonReused: (canonRun, priorTaskId) => {
      bindings.reuseRole('canonizer', {
        taskId: priorTaskId,
        detail: '复用不可变 Canon 快照，未重复抽取状态差异。',
        outputText: '已复用 Canon 不可变快照，直接进入 Finalize。',
        snapshot: { canonRunId: canonRun.id },
        extra: { canonRunId: canonRun.id },
      })
    },
    finalizeContent: input.finalizeContent,
    publishSummary: input.publishSummary,
  })
}
