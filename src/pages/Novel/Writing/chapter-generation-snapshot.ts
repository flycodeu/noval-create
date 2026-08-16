import type { WritingPipelineSnapshot } from './parsers'

export function resolveCurrentPipelineSnapshot(
  chapterId: number | null,
  liveSnapshot: WritingPipelineSnapshot | null,
  persistedSnapshot: WritingPipelineSnapshot | null,
): WritingPipelineSnapshot | null {
  if (!chapterId) return null
  if (liveSnapshot?.chapterId === chapterId) return liveSnapshot
  if (persistedSnapshot?.chapterId === chapterId) return persistedSnapshot
  return null
}

export function getResumablePartialContent(snapshot: WritingPipelineSnapshot | null): string {
  if (snapshot?.status !== 'failed' && snapshot?.status !== 'cancelled') return ''
  return snapshot.partialContent?.trim() || ''
}
