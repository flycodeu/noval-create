import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../database/db'
import { semanticGateReviews } from '../../database/schema'
import { parseAiJsonResult } from '../../utils/json'
import * as taskService from '../task.service'
import {
  buildChapterSemanticGatePrompt,
  normalizeSemanticGateReview,
  type SemanticGateDimension,
  type SemanticGateHeuristicHint,
  type SemanticGateReview,
} from '../../../src/shared/semantic-gate'
import type { SemanticGateMode } from '../../../src/shared/semantic-gate-policy'

export interface ChapterSemanticGateInput {
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle?: string | null
  chapterContent: string
  dimensions: SemanticGateDimension[]
  stage: 'critic' | 'repair_review' | 'golden_final'
  mode: SemanticGateMode
  modelConfigId?: number
  contractSummary?: string
  scenePlanSummary?: string
  protagonistBrief?: string
  dramaticEngine?: string
  designTerms?: string[]
  heuristicHints?: SemanticGateHeuristicHint[]
}

export interface ChapterSemanticGateRun {
  review: SemanticGateReview
  /** True when the LLM call or parsing failed and the caller should apply its fallback policy. */
  degraded: boolean
  promptFingerprint: string
}

function fingerprint(prompt: string): string {
  return createHash('sha1').update(prompt).digest('hex').slice(0, 16)
}

export function persistSemanticGateReview(input: {
  novelId: number
  chapterId: number
  stage: string
  mode: SemanticGateMode
  dimensions: SemanticGateDimension[]
  review: SemanticGateReview
  modelConfigId?: number
  promptFingerprint: string
}): void {
  try {
    const db = getDb()
    db.insert(semanticGateReviews).values({
      novelId: input.novelId,
      chapterId: input.chapterId,
      stage: input.stage,
      mode: input.mode,
      dimensionsJson: JSON.stringify(input.dimensions),
      verdictsJson: JSON.stringify(input.review.verdicts),
      warningsJson: JSON.stringify(input.review.warnings),
      evidenceAccepted: input.review.evidenceAccepted,
      evidenceRejected: input.review.evidenceRejected,
      failed: input.review.failed ? 1 : 0,
      modelConfigId: input.modelConfigId ?? null,
      promptFingerprint: input.promptFingerprint,
    }).run()
  } catch (error) {
    // Persistence is observability, never a generation blocker.
    console.warn('[semantic-gate] 评审结果落库失败', error)
  }
}

/**
 * Run the chapter semantic gate once (with a single parse-failure retry) and
 * persist the review. Never throws: on total failure it returns a failed
 * review with degraded=true so the caller applies the configured fallback.
 */
export async function runChapterSemanticGate(input: ChapterSemanticGateInput): Promise<ChapterSemanticGateRun> {
  const prompt = buildChapterSemanticGatePrompt({
    chapterNum: input.chapterNum,
    chapterTitle: input.chapterTitle,
    chapterContent: input.chapterContent,
    dimensions: input.dimensions,
    contractSummary: input.contractSummary,
    scenePlanSummary: input.scenePlanSummary,
    protagonistBrief: input.protagonistBrief,
    dramaticEngine: input.dramaticEngine,
    designTerms: input.designTerms,
    heuristicHints: input.heuristicHints,
  })
  const promptFingerprint = fingerprint(prompt)

  const attempt = async (): Promise<SemanticGateReview> => {
    const raw = await taskService.runChatTask({
      type: 'review',
      novelId: input.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapterId,
      retryable: true,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: input.modelConfigId,
    })
    const parsed = parseAiJsonResult<Record<string, unknown>>(raw, 'object', {
      channel: 'chapter',
      message: '语义门 JSON 解析失败。',
      consoleSummary: `[semantic-gate] parse-failed chapter=${input.chapterId} stage=${input.stage}`,
      context: { chapterId: input.chapterId, novelId: input.novelId, stage: `semantic-gate:${input.stage}` },
    })
    return normalizeSemanticGateReview({
      chapterContent: input.chapterContent,
      dimensions: input.dimensions,
      ...(parsed.success ? { parsedPayload: parsed.data } : { parseError: '模型输出不是有效 JSON。' }),
    })
  }

  let review: SemanticGateReview
  let degraded = false
  try {
    review = await attempt()
    if (review.failed) {
      review = await attempt()
    }
    degraded = review.failed
  } catch (error) {
    console.warn(`[semantic-gate] 评审调用失败 chapter=${input.chapterId} stage=${input.stage}`, error)
    review = normalizeSemanticGateReview({
      chapterContent: input.chapterContent,
      dimensions: input.dimensions,
      parseError: error instanceof Error ? error.message : '语义门调用失败。',
    })
    degraded = true
  }

  persistSemanticGateReview({
    novelId: input.novelId,
    chapterId: input.chapterId,
    stage: input.stage,
    mode: input.mode,
    dimensions: input.dimensions,
    review,
    modelConfigId: input.modelConfigId,
    promptFingerprint,
  })

  return { review, degraded, promptFingerprint }
}

export function loadLatestSemanticGateReview(chapterId: number, stage?: string): {
  verdicts: unknown
  warnings: unknown
  mode: string
  stage: string
  createdAt: string | null
} | null {
  try {
    const db = getDb()
    const condition = stage
      ? and(eq(semanticGateReviews.chapterId, chapterId), eq(semanticGateReviews.stage, stage))
      : eq(semanticGateReviews.chapterId, chapterId)
    const latest = db.select().from(semanticGateReviews)
      .where(condition)
      .orderBy(desc(semanticGateReviews.id))
      .limit(1)
      .all()[0]
    if (!latest) return null
    return {
      verdicts: JSON.parse(latest.verdictsJson || '[]'),
      warnings: JSON.parse(latest.warningsJson || '[]'),
      mode: latest.mode,
      stage: latest.stage,
      createdAt: latest.createdAt,
    }
  } catch {
    return null
  }
}
