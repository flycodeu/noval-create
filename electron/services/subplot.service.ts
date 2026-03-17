import { eq } from 'drizzle-orm'
import { Message } from '../adapters/base.adapter'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { getAdapterById, getDefaultAdapter } from './model.service'
import { createTask } from './task.service'
import {
  parseSubPlotFrameworkResponse,
  validateGeneratedSubplots,
  type SubplotGenerationRequest,
  type SubplotGenerationResult,
} from '../../src/shared/subplot-framework'

const SUBPLOT_MAX_CONFLICT_LENGTH = 90
const SUBPLOT_MAX_MAINLINE_LINK_LENGTH = 60

type SubplotFailureStage = 'model_request' | 'parse_json' | 'validate_items'

class SubplotGenerationError extends Error {
  stage: SubplotFailureStage

  constructor(stage: SubplotFailureStage, message: string) {
    super(message)
    this.name = 'SubplotGenerationError'
    this.stage = stage
  }
}

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

async function runSubplotBatchTask(
  request: SubplotGenerationRequest,
  taskId: number,
): Promise<SubplotGenerationResult> {
  const startedAt = Date.now()
  let rawOutput = ''
  let adapter: Awaited<ReturnType<typeof getDefaultAdapter>> | null = null

  try {
    adapter = request.modelConfigId
      ? await getAdapterById(request.modelConfigId)
      : await getDefaultAdapter()

    rawOutput = await adapter.chat(request.messages as Message[])
    if (!rawOutput.trim()) {
      throw new SubplotGenerationError('model_request', 'AI 未返回内容')
    }

    let parsed
    try {
      parsed = parseSubPlotFrameworkResponse(rawOutput)
    } catch (error) {
      throw new SubplotGenerationError(
        'parse_json',
        error instanceof Error ? error.message : 'JSON 解析失败',
      )
    }

    const validation = validateGeneratedSubplots(parsed, {
      existingSubplots: request.existingSubplots,
      expectedCount: request.expectedCount,
      maxConflictLength: SUBPLOT_MAX_CONFLICT_LENGTH,
      maxMainlineLinkLength: SUBPLOT_MAX_MAINLINE_LINK_LENGTH,
    })

    if (validation.accepted.length === 0) {
      throw new SubplotGenerationError(
        'validate_items',
        validation.fatalMessage || '未找到可保留的支线结果',
      )
    }

    updateTaskRecord(taskId, {
      status: 'success',
      outputText: rawOutput,
      tokensUsed: adapter.countTokens(rawOutput),
      durationMs: Date.now() - startedAt,
      errorMessage: validation.warningMessage || null,
    })

    return {
      taskId,
      accepted: validation.accepted,
      rejectedCount: validation.rejected.length,
      rejectionReasons: validation.rejectionReasons,
      rawOutput,
      warningMessage: validation.warningMessage,
    }
  } catch (error) {
    const subplotError = error instanceof SubplotGenerationError
      ? error
      : new SubplotGenerationError(
          'model_request',
          error instanceof Error ? error.message : '未知错误',
        )

    updateTaskRecord(taskId, {
      status: 'failed',
      outputText: rawOutput || null,
      tokensUsed: rawOutput && adapter ? adapter.countTokens(rawOutput) : null,
      durationMs: Date.now() - startedAt,
      errorMessage: formatFailureMessage(subplotError.stage, request, subplotError.message),
    })

    throw new Error(formatFailureMessage(subplotError.stage, request, subplotError.message))
  }
}

export async function generateSubplotBatch(
  request: SubplotGenerationRequest,
): Promise<SubplotGenerationResult> {
  const taskId = await createTask({
    type: 'subplot_framework',
    novelId: request.novelId,
    modelConfigId: request.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: request.novelId,
    inputJson: buildTaskInput(request),
  })

  updateTaskRecord(taskId, { status: 'running' })

  return runSubplotBatchTask(request, taskId)
}

export async function retrySubplotBatch(taskId: number): Promise<number> {
  const db = getDb()
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0]
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.inputJson) throw new Error('任务缺少输入上下文，无法重试')

  const request = JSON.parse(task.inputJson) as SubplotGenerationRequest
  const result = await generateSubplotBatch(request)
  return result.taskId
}
