import { describe, expect, it } from 'vitest'
import { createWritingWorkspaceRequestTracker } from './writing-workspace-requests'

describe('writing workspace request tracker', () => {
  it('rejects an old linked query after A to B to A even though its chapter id matches again', () => {
    const tracker = createWritingWorkspaceRequestTracker()
    tracker.selectChapter(901)
    const oldPublishCheck = tracker.captureChapterSelection(901)
    tracker.selectChapter(15)
    tracker.selectChapter(901)
    expect(oldPublishCheck()).toBe(false)
    expect(tracker.captureChapterSelection(901)()).toBe(true)
  })

  it('preserves linked queries across background list refresh and invalidates them on empty', () => {
    const tracker = createWritingWorkspaceRequestTracker()
    tracker.selectChapter(901)
    const query = tracker.captureChapterSelection(901)
    tracker.beginListRequest(false)
    expect(query()).toBe(true)
    tracker.syncCurrentChapterId(null)
    tracker.invalidateDetailRequest()
    expect(query()).toBe(false)
  })

  it('a late A response cannot replace B text or selection', async () => {
    const tracker = createWritingWorkspaceRequestTracker()
    let resolveA!: () => void
    const delayed = new Promise<void>((resolve) => { resolveA = resolve })
    tracker.selectChapter(901)
    const isA = tracker.beginDetailRequest(901)
    let editor = { content: 'A', selection: null as string | null }
    const request = delayed.then(() => { if (isA()) editor = { content: 'late A', selection: null } })
    tracker.selectChapter(15)
    tracker.beginDetailRequest(15)
    editor = { content: 'B 用户草稿', selection: '用户' }
    resolveA()
    await request
    expect(editor).toEqual({ content: 'B 用户草稿', selection: '用户' })
  })
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
