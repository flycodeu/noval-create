import { chapterRevisionParagraphs } from '../../../shared/chapter-revision'

export function selectedChapterParagraphs(content: string, start: number, end: number): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.length) return []
  return chapterRevisionParagraphs(content).filter(row => row.start < end && row.end > start).map(row => row.index)
}
