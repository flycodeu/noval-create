import { beforeEach, describe, expect, it } from 'vitest'
import type { Chapter } from '../types'
import { useNovelStore } from './novel.store'

function chapter(id: number): Chapter {
  return { id, novelId: 1, chapterNum: id, title: `第${id}章` } as Chapter
}

describe('novel.store selection consistency', () => {
  beforeEach(() => {
    useNovelStore.getState().resetWorkspace()
  })

  it('clears a selected chapter removed by a refreshed list', () => {
    useNovelStore.getState().setChapters([chapter(1), chapter(2)])
    useNovelStore.getState().setCurrentChapterId(2)
    useNovelStore.getState().setChapters([chapter(1)])

    expect(useNovelStore.getState().currentChapterId).toBeNull()
  })

  it('preserves a selected chapter that still exists', () => {
    useNovelStore.getState().setChapters([chapter(1), chapter(2)])
    useNovelStore.getState().setCurrentChapterId(2)
    useNovelStore.getState().setChapters([chapter(2), chapter(3)])

    expect(useNovelStore.getState().currentChapterId).toBe(2)
  })
})
