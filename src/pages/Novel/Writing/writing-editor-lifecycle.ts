import { countChapterWords } from './useChapterEditor'

export type WritingChapterVersionSource = 'manual-save' | 'ai-rewrite'

interface PersistWritingChapterInput {
  chapterId: number
  text: string
  versionSource: WritingChapterVersionSource
  isCurrentChapter(chapterId: number): boolean
  updateRemote(chapterId: number, text: string, wordCount: number, versionSource: WritingChapterVersionSource): Promise<unknown>
  refreshContextStatus(): Promise<void>
  refreshPublishCheck(chapterId: number): Promise<void>
  updateStore(chapterId: number, text: string, wordCount: number): void
}

export async function persistWritingChapter(input: PersistWritingChapterInput): Promise<void> {
  const { chapterId, isCurrentChapter, refreshContextStatus, refreshPublishCheck, text, updateRemote, updateStore, versionSource } = input
  const wordCount = countChapterWords(text)
  await updateRemote(chapterId, text, wordCount, versionSource)
  await refreshContextStatus()
  if (isCurrentChapter(chapterId)) await refreshPublishCheck(chapterId)
  updateStore(chapterId, text, wordCount)
}
