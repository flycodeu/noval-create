import { describe, expect, it, vi } from 'vitest'
import { buildNewChapterDraft, deleteChapterAfterPendingSave } from './writing-chapter-crud'

describe('writing chapter CRUD controller', () => {
  it('allocates the next chapter number and preserves volume preference order', () => {
    const chapters = [
      { chapterNum: 1 },
      { chapterNum: 4 },
    ] as Parameters<typeof buildNewChapterDraft>[0]['chapters']
    const currentChapter = { volumeId: 9 } as Parameters<typeof buildNewChapterDraft>[0]['currentChapter']

    expect(buildNewChapterDraft({ chapters, currentChapter, volumes: [], requestedVolumeId: 12 })).toEqual({
      chapterNum: 5,
      title: '第5章',
      status: 'outline',
      volumeId: 12,
    })
    expect(buildNewChapterDraft({ chapters, currentChapter, volumes: [] }).volumeId).toBe(9)
  })

  it('waits for the chapter save queue before deletion and refreshes afterward', async () => {
    const calls: string[] = []
    const record = (label: string) => vi.fn(async () => { calls.push(label) })

    await deleteChapterAfterPendingSave({
      chapterId: 7,
      saveCoordinator: {
        cancelScheduled: vi.fn(() => { calls.push('cancel') }),
        waitForChapter: record('wait'),
      },
      deleteChapter: record('delete'),
      refreshChapters: record('chapters'),
      refreshMeta: record('meta'),
      refreshContextStatus: record('context'),
    })

    expect(calls.slice(0, 3)).toEqual(['cancel', 'wait', 'delete'])
    expect(new Set(calls.slice(3))).toEqual(new Set(['chapters', 'meta', 'context']))
  })
})
