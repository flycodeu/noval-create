export interface WritingWorkspaceRequestTracker {
  readonly currentChapterIdRef: { current: number | null }
  readonly chapterIdsRef: { current: Set<number> }
  syncCurrentChapterId(chapterId: number | null): void
  syncChapterIds(chapterIds: number[]): void
  beginListRequest(selectChapter: boolean): { listRequestId: number; selectionRequestId: number | null }
  isLatestListRequest(requestId: number): boolean
  isLatestSelectionRequest(requestId: number | null): boolean
  selectChapter(chapterId: number): void
  beginDetailRequest(chapterId: number): () => boolean
  invalidateDetailRequest(): void
}

export function createWritingWorkspaceRequestTracker(): WritingWorkspaceRequestTracker {
  let listRequestId = 0
  let selectionRequestId = 0
  let detailRequestId = 0
  const currentChapterIdRef = { current: null as number | null }
  const chapterIdsRef = { current: new Set<number>() }

  return {
    currentChapterIdRef,
    chapterIdsRef,
    syncCurrentChapterId(chapterId) {
      currentChapterIdRef.current = chapterId
    },
    syncChapterIds(chapterIds) {
      chapterIdsRef.current = new Set(chapterIds)
    },
    beginListRequest(selectChapter) {
      listRequestId += 1
      if (selectChapter) selectionRequestId += 1
      return {
        listRequestId,
        selectionRequestId: selectChapter ? selectionRequestId : null,
      }
    },
    isLatestListRequest(requestId) {
      return listRequestId === requestId
    },
    isLatestSelectionRequest(requestId) {
      return requestId === null || selectionRequestId === requestId
    },
    selectChapter(chapterId) {
      selectionRequestId += 1
      currentChapterIdRef.current = chapterId
    },
    beginDetailRequest(chapterId) {
      detailRequestId += 1
      const requestId = detailRequestId
      return () => detailRequestId === requestId && currentChapterIdRef.current === chapterId
    },
    invalidateDetailRequest() {
      detailRequestId += 1
    },
  }
}
