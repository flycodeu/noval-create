import type { WebContents } from 'electron'
import { eq } from 'drizzle-orm'
import { Message } from '../adapters/base.adapter'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { createTask, executeChatTask, updateTask } from './task.service'
import {
  parseSubPlotFrameworkResponseDetailed,
  validateGeneratedSubplots,
  type SubplotGenerationRequest,
  type SubplotGenerationResult,
} from '../../src/shared/subplot-framework'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'

const SUBPLOT_MAX_CONFLICT_LENGTH = 90
const SUBPLOT_MAX_MAINLINE_LINK_LENGTH = 60

type SubplotFailureStage = 'model_request' | 'parse_json' | 'validate_items'

function updateTaskRecord(taskId: number, data: Partial<typeof tasks.$inferInsert>) {
  const db = getDb()
  db.update(tasks).set({
    ...data,
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run()
}

function formatBatchLabel(request: SubplotGenerationRequest): string {
  if (request.batchIndex && request.totalBatches) {
    return `第 ${request.batchIndex}/${request.totalBatches} 批`
  }

  if (request.batchIndex) {
    return `第 ${request.batchIndex} 批`
  }

  return '当前批次'
}

function formatFailureMessage(
  stage: SubplotFailureStage,
  request: SubplotGenerationRequest,
  reason: string,
): string {
  return `[${stage}] ${formatBatchLabel(request)}：${reason}`
}

function buildTaskInput(request: SubplotGenerationRequest) {
  return JSON.stringify({
    ...request,
    messages: request.messages,
  })
}

function buildSubplotReviewContext(request: SubplotGenerationRequest): string {
  const promptSummary = request.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-2)
    .join('\n\n')

  const existingSummary = request.existingSubplots.length > 0
    ? request.existingSubplots
      .map((subplot, index) => `${index + 1}. ${subplot.name} | ${subplot.characters} | ${subplot.conflict} | ${subplot.mainlineLink} | ${subplot.endChapter}`)
      .join('\n')
    : '当前还没有已保留的支线框架。'

  return [
    `目标数量：${request.expectedCount}`,
    request.batchIndex && request.totalBatches ? `当前批次：第 ${request.batchIndex}/${request.totalBatches} 批` : '',
    `已有支线：\n${existingSummary}`,
    promptSummary ? `生成提示：\n${promptSummary}` : '',
  ].filter(Boolean).join('\n\n')
}

function subplotSchemaHint(expectedCount: number): string {
  return [
    `输出应保持为 ${expectedCount} 条支线组成的 JSON 数组。`,
    '每条支线必须保留 name、characters、conflict、mainlineLink、endChapter 字段。',
    '不要把支线框架改写成解释性长文。',
  ].join('\n')
}

function joinWarnings(...warnings: Array<string | undefined | null>): string | undefined {
  const parts = warnings
    .map((warning) => warning?.trim())
    .filter((warning): warning is string => Boolean(warning))

  return parts.length > 0 ? parts.join('\uFF1B') : undefined
}

async function runSubplotBatchTask(
  request: SubplotGenerationRequest,
  taskId: number,
  sender?: WebContents,
): Promise<SubplotGenerationResult> {
  let finalResult: SubplotGenerationResult | null = null
  const messages = request.messages as Message[]

  try {
    await executeChatTask(taskId, {
      type: 'subplot_framework',
      novelId: request.novelId,
      modelConfigId: request.modelConfigId,
      relatedEntityType: 'novel',
      relatedEntityId: request.novelId,
      inputJson: buildTaskInput(request),
      messages,
      sender,
      onSuccess: async (rawOutput) => {
        if (!rawOutput.trim()) {
          throw new Error(formatFailureMessage('model_request', request, 'AI 未返回内容'))
        }

        const quality = await runAssetQualityLoop({
          targetType: 'subplot',
          novelId: request.novelId,
          modelConfigId: request.modelConfigId,
          relatedEntityType: 'novel',
          relatedEntityId: request.novelId,
          parentTaskId: taskId,
          sender,
          contextSummary: buildSubplotReviewContext(request),
          generatedOutput: rawOutput,
          schemaHint: subplotSchemaHint(request.expectedCount),
          reviewFocus: [
            '支线必须像可执行的结构草稿，而不是主题句、设定说明或空泛概念。',
            '冲突、主线连接和回收章位必须具体，且与当前主线推进兼容。',
          ],
          rewriteConstraints: [
            '保持支线条数不变。',
            '保持每条支线的字段结构稳定，不要改成说明文。',
          ],
        })
        if (quality.stage === 'rejected') {
          throw new Error(formatFailureMessage(
            'validate_items',
            request,
            summarizeAssetQualityWarnings(quality) || '资产审校拒收了当前支线批次',
          ))
        }

        let parsedResult
        try {
          parsedResult = parseSubPlotFrameworkResponseDetailed(quality.finalOutput)
        } catch (error) {
          throw new Error(formatFailureMessage(
            'parse_json',
            request,
            error instanceof Error ? error.message : 'JSON 解析失败',
          ))
        }

        const validation = validateGeneratedSubplots(parsedResult.subplots, {
          existingSubplots: request.existingSubplots,
          expectedCount: request.expectedCount,
          maxConflictLength: SUBPLOT_MAX_CONFLICT_LENGTH,
          maxMainlineLinkLength: SUBPLOT_MAX_MAINLINE_LINK_LENGTH,
        })

        if (validation.accepted.length === 0) {
          throw new Error(formatFailureMessage(
            'validate_items',
            request,
            validation.fatalMessage || '未找到可保留的支线结果',
          ))
        }

        const warningMessage = joinWarnings(
          summarizeAssetQualityWarnings(quality),
          parsedResult.notes.length > 0 ? parsedResult.notes.join('\uFF1B') : undefined,
          validation.warningMessage,
        )

        finalResult = {
          taskId,
          accepted: validation.accepted,
          rejectedCount: validation.rejected.length,
          rejectionReasons: validation.rejectionReasons,
          rawOutput: quality.finalOutput,
          warningMessage,
        }

        return finalResult
      },
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : '未知错误'
    const formatted = raw.startsWith('[') ? raw : formatFailureMessage('model_request', request, raw)
    updateTaskRecord(taskId, { errorMessage: formatted })
    throw new Error(formatted)
  }

  if (!finalResult) {
    const message = formatFailureMessage('model_request', request, '支线批次未返回可用结果')
    updateTaskRecord(taskId, { status: 'failed', errorMessage: message })
    throw new Error(message)
  }

  const stableResult = finalResult as SubplotGenerationResult
  updateTaskRecord(taskId, {
    errorMessage: stableResult.warningMessage || null,
  })

  return stableResult
}

export async function generateSubplotBatch(
  request: SubplotGenerationRequest,
  runtime: { parentTaskId?: number; sender?: WebContents } = {},
): Promise<SubplotGenerationResult> {
  const taskId = await createTask({
    type: 'subplot_framework',
    novelId: request.novelId,
    modelConfigId: request.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: request.novelId,
    inputJson: buildTaskInput(request),
    runnerType: 'chat',
    parentTaskId: runtime.parentTaskId,
  })

  if (typeof runtime.parentTaskId === 'number') {
    updateTask(runtime.parentTaskId, { currentChildTaskId: taskId })
  }

  try {
    return await runSubplotBatchTask(request, taskId, runtime.sender)
  } finally {
    if (typeof runtime.parentTaskId === 'number') {
      updateTask(runtime.parentTaskId, { currentChildTaskId: null })
    }
  }
}

export async function retrySubplotBatch(taskId: number): Promise<number> {
  const db = getDb()
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0]
  if (!task) throw new Error(`任务 ${taskId} 不存在`)
  if (!task.inputJson) throw new Error('\u4efb\u52a1\u7f3a\u5c11\u8f93\u5165\u4e0a\u4e0b\u6587\uff0c\u65e0\u6cd5\u91cd\u8bd5')

  const request = JSON.parse(task.inputJson) as SubplotGenerationRequest
  const result = await generateSubplotBatch(request)
  return result.taskId
}
