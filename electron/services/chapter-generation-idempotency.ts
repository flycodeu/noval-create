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
