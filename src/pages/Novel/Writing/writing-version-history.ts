import type { ChapterVersion } from '../../../types'

export interface WritingVersionHistoryRequestTracker {
  beginRequest(): number
  invalidate(): void
  isCurrent(requestId: number, isRouteCurrent?: () => boolean): boolean
}

export function createWritingVersionHistoryRequestTracker(): WritingVersionHistoryRequestTracker {
  let latestRequestId = 0
  return {
    beginRequest: () => ++latestRequestId,
    invalidate: () => { latestRequestId += 1 },
    isCurrent: (requestId, isRouteCurrent = () => true) => (
      requestId === latestRequestId && isRouteCurrent()
    ),
  }
}

export function resolveSelectedVersionId(
  currentVersionId: number | null,
  versions: ChapterVersion[],
): number | null {
  if (currentVersionId && versions.some((version) => version.id === currentVersionId)) return currentVersionId
  return versions[0]?.id || null
}
