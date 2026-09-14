import { narrativeRequestIdentity, type NarrativeInputIdentity } from '../../src/shared/narrative-policy'
import { stableHash } from '../../src/shared/context-pack'

export function chapterGenerationInputIdentity(identity: NarrativeInputIdentity, options: {
  stageId?: number; executionMode?: string; totalBudget?: number; resumeSourceTaskId?: number; retryNodeRole?: string
} = {}): string {
  return stableHash({ narrative: narrativeRequestIdentity(identity), stageId: options.stageId ?? null,
    executionMode: options.executionMode ?? null, totalBudget: options.totalBudget ?? null,
    resumeSourceTaskId: options.resumeSourceTaskId ?? null, retryNodeRole: options.retryNodeRole ?? null })
}

const RETRYABLE_CHAPTER_GENERATION_STATUSES = new Set(['failed', 'cancelled'])

export function isRetryableChapterGenerationStatus(status?: string | null): boolean {
  return RETRYABLE_CHAPTER_GENERATION_STATUSES.has(status || '')
}

export function buildChapterGenerationRequestKey(
  baseKey: string,
  options: { existingStatus?: string | null; retryToken?: string } = {},
): string {
  if (!isRetryableChapterGenerationStatus(options.existingStatus)) return baseKey
  const retryToken = options.retryToken?.trim()
  if (!retryToken) throw new Error('retryToken is required for a failed or cancelled chapter generation task')
  return `${baseKey}:retry:${retryToken}`
}
