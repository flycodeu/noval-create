import { describe, expect, it, vi } from 'vitest'
import { persistWritingChapter } from './writing-editor-lifecycle'

describe('persistWritingChapter', () => {
  it('preserves remote, context, publish and store update ordering for the current chapter', async () => {
    const calls: string[] = []
    await persistWritingChapter({
      chapterId: 7,
      text: '正文 text',
      versionSource: 'manual-save',
      isCurrentChapter: () => true,
      updateRemote: vi.fn(async (_id, _text, wordCount, source) => calls.push(`remote:${wordCount}:${source}`)),
      refreshContextStatus: vi.fn(async () => { calls.push('context') }),
      refreshPublishCheck: vi.fn(async () => { calls.push('publish') }),
      updateStore: vi.fn(() => { calls.push('store') }),
    })

    expect(calls).toEqual(['remote:3:manual-save', 'context', 'publish', 'store'])
  })

  it('does not refresh a background chapter publish check', async () => {
    const refreshPublishCheck = vi.fn(async () => undefined)
    const updateStore = vi.fn()
    await persistWritingChapter({
      chapterId: 8,
      text: 'background',
      versionSource: 'ai-rewrite',
      isCurrentChapter: () => false,
      updateRemote: vi.fn(async () => undefined),
      refreshContextStatus: vi.fn(async () => undefined),
      refreshPublishCheck,
      updateStore,
    })

    expect(refreshPublishCheck).not.toHaveBeenCalled()
    expect(updateStore).toHaveBeenCalledWith(8, 'background', 1)
  })

  it('canonicalizes contenteditable blank lines before remote persistence', async () => {
    const updateRemote = vi.fn(async () => undefined)
    const updateStore = vi.fn()
    const expected = '第一段\n\n第二段'

    await persistWritingChapter({
      chapterId: 9,
      text: '第一段\n\n\n第二段',
      versionSource: 'manual-save',
      isCurrentChapter: () => true,
      updateRemote,
      refreshContextStatus: vi.fn(async () => undefined),
      refreshPublishCheck: vi.fn(async () => undefined),
      updateStore,
    })

    expect(updateRemote).toHaveBeenCalledWith(9, expected, 6, 'manual-save')
    expect(updateStore).toHaveBeenCalledWith(9, expected, 6)
  })
})
