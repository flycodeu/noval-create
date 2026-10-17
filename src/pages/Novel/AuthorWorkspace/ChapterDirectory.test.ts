import { describe, expect, it } from 'vitest'
import type { Chapter, StoryStructureTree } from '../../../types'
import { chapterDirectoryItems, CHAPTER_DIRECTORY_PAGE_SIZE } from './chapter-directory'

const chapter = (id: number, chapterNum = id, title = `章节${id}`) => ({ id, chapterNum, title, wordCount: 0 } as Chapter)
const tree = { novelId: 1, volumes: [{ id: 8, volumeNumber: 1, title: '照夜', summary: '卷安排', parts: [{ id: 9, partNumber: 1, title: '渡桥', summary: '单元安排', chapters: [chapter(2), chapter(3)] }] }] } as StoryStructureTree

describe('卷章目录', () => {
  it('uses the same volume and unit ancestry for prose chapters and retains unassigned chapters', () => {
    const original = [chapter(3), chapter(1), chapter(2)]
    const items = chapterDirectoryItems(original, tree)
    expect(items.map(item => item.chapter.id)).toEqual([1, 2, 3])
    expect(items[0].location).toBeUndefined()
    expect(items[1].location).toEqual({ volumeId: 8, volume: '卷 1 · 照夜', volumeSummary: '卷安排', partId: 9, part: '渡桥', partSummary: '单元安排' })
    expect(original.map(item => item.id)).toEqual([3, 1, 2])
  })
  it('finds a chapter by its title, number, volume or unit without losing its parent scope', () => {
    const chapters = [chapter(1, 1, '晨起'), chapter(2, 2, '夜雨'), chapter(3, 3, '问路')]
    expect(chapterDirectoryItems(chapters, tree, '渡桥').map(item => item.chapter.id)).toEqual([2, 3])
    expect(chapterDirectoryItems(chapters, tree, '照夜').map(item => item.chapter.id)).toEqual([2, 3])
    expect(chapterDirectoryItems(chapters, tree, '夜雨')[0].location?.partId).toBe(9)
    expect(chapterDirectoryItems(chapters, tree, ' 1 ').map(item => item.chapter.id)).toEqual([1, 2, 3])
    expect(chapterDirectoryItems(chapters, null, '1').map(item => item.chapter.id)).toEqual([1])
    expect(chapterDirectoryItems(chapters, tree, '不存在')).toEqual([])
  })
  it('bounds the number of rendered chapter rows independently of book length', () => {
    const items = chapterDirectoryItems(Array.from({ length: 3200 }, (_, index) => chapter(index + 1)), null)
    const selectedIndex = items.findIndex(item => item.chapter.id === 3170)
    const page = Math.floor(selectedIndex / CHAPTER_DIRECTORY_PAGE_SIZE)
    const visible = items.slice(page * CHAPTER_DIRECTORY_PAGE_SIZE, (page + 1) * CHAPTER_DIRECTORY_PAGE_SIZE)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThanOrEqual(CHAPTER_DIRECTORY_PAGE_SIZE)
    expect(visible.some(item => item.chapter.id === 3170)).toBe(true)
    expect(items.at(-1)?.chapter.chapterNum).toBe(3200)
  })
})
