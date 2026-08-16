import type { ChapterRewriteScope } from '../../src/types'
import { ContextOverflowError, HardConstraintOverflowError } from './context.service'
import type {
  ChapterPipelineFailureCode,
  ChapterPipelineRole,
} from './chapter-pipeline-state'

export interface ChapterPipelineFailure {
  code?: ChapterPipelineFailureCode
  blocked: boolean
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  outputText?: string
}

export class ChapterPipelineStageError extends Error {
  readonly code: ChapterPipelineFailureCode
  readonly blocked: boolean
  readonly rewriteScope?: ChapterRewriteScope
  readonly targetSegmentId?: number | null
  readonly outputText?: string

  constructor(
    code: ChapterPipelineFailureCode,
    message: string,
    options: {
      blocked?: boolean
      rewriteScope?: ChapterRewriteScope
      targetSegmentId?: number | null
      outputText?: string
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'ChapterPipelineStageError'
    this.code = code
    this.blocked = Boolean(options.blocked)
    this.rewriteScope = options.rewriteScope
    this.targetSegmentId = options.targetSegmentId
    this.outputText = options.outputText
  }
}

export function buildPipelineFailureOutput(
  code: ChapterPipelineFailureCode,
  detail: string,
  options: {
    rewriteScope?: ChapterRewriteScope
    targetSegmentId?: number | null
  } = {},
): string {
  const scopeText = options.rewriteScope ? `rewrite_scope: ${options.rewriteScope}` : ''
  const segmentText = typeof options.targetSegmentId === 'number' ? `target_segment_id: ${options.targetSegmentId}` : ''
  return [
    `exit_code: ${code}`,
    `detail: ${detail}`,
    scopeText,
    segmentText,
  ].filter(Boolean).join('\n')
}

export function classifyChapterPipelineFailure(
  role: ChapterPipelineRole,
  error: unknown,
): ChapterPipelineFailure {
  if (error instanceof ChapterPipelineStageError) {
    return {
      code: error.code,
      blocked: error.blocked,
      rewriteScope: error.rewriteScope,
      targetSegmentId: error.targetSegmentId,
      outputText: error.outputText,
    }
  }
  if (error instanceof HardConstraintOverflowError || error instanceof ContextOverflowError) {
    const detail = error.message || '上下文超预算，无法完整注入本章硬约束。'
    return {
      code: 'context_overflow',
      blocked: true,
      outputText: buildPipelineFailureOutput('context_overflow', detail),
    }
  }
  const detail = error instanceof Error ? error.message : ''
  if (/合同校验未通过|章节合同|场景合同|缺少章节合同摘要|缺少 Planner 产出的场景计划/u.test(detail)) {
    return {
      code: 'contract_blocked',
      blocked: true,
      rewriteScope: 'contract_replan',
      outputText: buildPipelineFailureOutput('contract_blocked', detail, { rewriteScope: 'contract_replan' }),
    }
  }
  if (/Canon/u.test(detail) || role === 'canonizer') {
    return {
      code: 'canon_failed',
      blocked: true,
      outputText: buildPipelineFailureOutput('canon_failed', detail || 'Canon 草案生成失败。'),
    }
  }
  return { blocked: false }
}
