import type { Chapter, StoryStructureTree } from '../../../types'

export const CHAPTER_DIRECTORY_PAGE_SIZE = 36

export function chapterDirectoryItems(chapters: Chapter[], tree: StoryStructureTree | null, query = '') {
  const locations = new Map<number, { volumeId: number; volume: string; volumeSummary?: string; partId: number; part: string; partSummary?: string }>()
  for (const volume of tree?.volumes || []) {
    for (const part of volume.parts) {
      for (const chapter of part.chapters) locations.set(chapter.id, {
        volumeId: volume.id, volume: `卷 ${volume.volumeNumber} · ${volume.title || '未命名'}`, volumeSummary: volume.summary,
        partId: part.id, part: part.title || `单元 ${part.partNumber}`, partSummary: part.summary,
      })
    }
  }
  const keyword = query.trim().toLocaleLowerCase()
  return [...chapters].sort((a, b) => a.chapterNum - b.chapterNum || a.id - b.id).map(chapter => ({ chapter, location: locations.get(chapter.id) })).filter(({ chapter, location }) => !keyword || `${chapter.chapterNum} ${chapter.title || ''} ${location?.volume || ''} ${location?.part || ''}`.toLocaleLowerCase().includes(keyword))
}
