import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChapterReview } from './useChapterReview'
import type { Chapter } from '../../../types'

function mountReview() {
  const currentChapterIdRef = { current: 1 as number | null }
  const options: Parameters<typeof useChapterReview>[0] = {
    novelId: 1, currentChapter: { id: 1 } as Chapter, currentChapterIdRef,
    selectedSnippet: null, hasMultiSegments: false, editorText: () => '原文',
    effectiveAiExecutionMode: 'balanced', rewriteRequirements: '', optimizeRequirements: '',
    optimizationResult: null, selectedVersionId: null,
    setCurrentChapter: vi.fn(), setAiResult: vi.fn(), setPublishCheck: vi.fn(),
    setRewriteRequirements: vi.fn(), setRewriteModalOpen: vi.fn(), setRewritingSelection: vi.fn(),
    setOptimizingChapter: vi.fn(), setApplyingOptimizedChapter: vi.fn(), setOptimizeModalOpen: vi.fn(),
    setOptimizationResult: vi.fn(), setActionError: vi.fn(), navigate: vi.fn(),
    navigateToWritingRoute: vi.fn(), applyChapterContent: vi.fn(), commitContentState: text => text,
    saveNow: vi.fn().mockResolvedValue(undefined), loadChapters: vi.fn(), refreshMeta: vi.fn(),
    refreshContextStatus: vi.fn(), refreshQualityDashboard: vi.fn(), refreshVersionHistory: vi.fn(),
    notifyWorkspaceMutation: vi.fn(),
  }
  let review!: ReturnType<typeof useChapterReview>
  function Host() { review = useChapterReview(options); return null }
  renderToString(createElement(Host))
  return { review, options, currentChapterIdRef }
}

afterEach(() => { vi.unstubAllGlobals() })

describe.each([
  ['runAiCheck', 'aiCheck'],
  ['optimizeChapter', 'optimizeContent'],
] as const)('chapter review isolation: %s', (action, method) => {
  it('does not display a late failure on a different chapter', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise((_, rejectPromise) => { reject = rejectPromise })
    const api = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('window', { electron: { chapter: { [method]: api } } })
    const { review, options, currentChapterIdRef } = mountReview()
    const running = review[action]()
    await vi.waitFor(() => expect(api).toHaveBeenCalledOnce())
    currentChapterIdRef.current = 2
    reject(new Error('old chapter failed'))
    await running
    expect(options.setActionError).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('rejects an old retry after the author switches chapters', async () => {
    const api = vi.fn().mockRejectedValue(new Error('retryable'))
    vi.stubGlobal('window', { electron: { chapter: { [method]: api } } })
    const { review, options, currentChapterIdRef } = mountReview()
    await review[action]()
    const error = vi.mocked(options.setActionError).mock.calls.at(-1)![0]
    expect(error).toMatchObject({ retry: expect.any(Function) })
    currentChapterIdRef.current = 2
    if (typeof error === 'object' && error) error.retry?.()
    await Promise.resolve()
    expect(api).toHaveBeenCalledOnce()
  })

  it('keeps retry working on the original chapter', async () => {
    const api = vi.fn().mockRejectedValueOnce(new Error('retryable')).mockResolvedValue({})
    vi.stubGlobal('window', { electron: { chapter: { [method]: api } } })
    const { review, options } = mountReview()
    await review[action]()
    const error = vi.mocked(options.setActionError).mock.calls.at(-1)![0]
    expect(error).toMatchObject({ retry: expect.any(Function) })
    if (typeof error === 'object' && error) error.retry?.()
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    expect(options.navigateToWritingRoute).toHaveBeenCalledWith('review')
  })
})
