import { describe, expect, it, vi } from 'vitest'
import type { Novel } from '../../../types'
import { parseStorySettingsSnapshot } from '../../../shared/story-settings'
import { compileWritingChapter, persistWritingDefaultAiMode } from './writing-workspace-actions'

describe('writing workspace actions', () => {
  it('persists default AI mode before updating the current novel store', async () => {
    const calls: string[] = []
    const novel = { id: 7, settingsJson: '{"aiEngine":{"defaultMode":"quality"}}' } as Novel
    await persistWritingDefaultAiMode({
      novel,
      mode: 'fast',
      updateNovel: vi.fn(async (_id, settingsJson) => {
        calls.push(`remote:${parseStorySettingsSnapshot(settingsJson).aiDefaultMode}`)
      }),
      setCurrentNovel: vi.fn((next) => calls.push(`store:${parseStorySettingsSnapshot(next.settingsJson).aiDefaultMode}`)),
    })

    expect(calls).toEqual(['remote:fast', 'store:fast'])
  })

  it('compiles before starting chapter, metadata and context refreshes', async () => {
    const calls: string[] = []
    await compileWritingChapter({
      chapterId: 9,
      compileChapter: vi.fn(async () => { calls.push('compile') }),
      loadChapters: vi.fn(async () => { calls.push('chapters') }),
      refreshMeta: vi.fn(async () => { calls.push('meta') }),
      refreshContextStatus: vi.fn(async () => { calls.push('context') }),
    })

    expect(calls).toEqual(['compile', 'chapters', 'meta', 'context'])
  })
})
