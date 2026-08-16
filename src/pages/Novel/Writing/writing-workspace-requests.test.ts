import { describe, expect, it } from 'vitest'
import { createWritingWorkspaceRequestTracker } from './writing-workspace-requests'

describe('writing workspace request tracker', () => {
  it('rejects an older chapter list and selection request', () => {
    const tracker = createWritingWorkspaceRequestTracker()
    const first = tracker.beginListRequest(true)
    const second = tracker.beginListRequest(true)

    expect(tracker.isLatestListRequest(first.listRequestId)).toBe(false)
    expect(tracker.isLatestSelectionRequest(first.selectionRequestId)).toBe(false)
    expect(tracker.isLatestListRequest(second.listRequestId)).toBe(true)
    expect(tracker.isLatestSelectionRequest(second.selectionRequestId)).toBe(true)
  })

  it('keeps a background list refresh from invalidating the selected chapter', () => {
    const tracker = createWritingWorkspaceRequestTracker()
    tracker.selectChapter(2)
    const background = tracker.beginListRequest(false)

    expect(background.selectionRequestId).toBeNull()
    expect(tracker.currentChapterIdRef.current).toBe(2)
    expect(tracker.isLatestSelectionRequest(background.selectionRequestId)).toBe(true)
  })

  it('rejects an old chapter detail after a fast chapter switch', () => {
    const tracker = createWritingWorkspaceRequestTracker()
    tracker.selectChapter(1)
    const isChapterOneCurrent = tracker.beginDetailRequest(1)
    tracker.selectChapter(2)
    const isChapterTwoCurrent = tracker.beginDetailRequest(2)

    expect(isChapterOneCurrent()).toBe(false)
    expect(isChapterTwoCurrent()).toBe(true)
  })

  it('updates the known chapter set used by generation event filtering', () => {
    const tracker = createWritingWorkspaceRequestTracker()
    tracker.syncChapterIds([1, 2])

    expect(tracker.chapterIdsRef.current.has(1)).toBe(true)
    expect(tracker.chapterIdsRef.current.has(3)).toBe(false)
  })
})
