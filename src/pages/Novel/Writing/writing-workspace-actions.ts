import type { AiExecutionMode } from '../../../shared/ai-execution'
import { buildStorySettingsPayload } from '../../../shared/story-settings'
import type { Novel } from '../../../types'

export async function persistWritingDefaultAiMode(input: {
  novel: Novel
  mode: AiExecutionMode
  updateNovel(id: number, settingsJson: string): Promise<unknown>
  setCurrentNovel(novel: Novel): void
}): Promise<void> {
  const { mode, novel, setCurrentNovel, updateNovel } = input
  const payload = buildStorySettingsPayload({ aiEngine: { defaultMode: mode } }, novel.settingsJson)
  const settingsJson = JSON.stringify(payload)
  await updateNovel(novel.id, settingsJson)
  setCurrentNovel({ ...novel, settingsJson })
}

export async function compileWritingChapter(input: {
  chapterId: number
  compileChapter(chapterId: number): Promise<unknown>
  loadChapters(chapterId: number): Promise<unknown>
  refreshMeta(): Promise<unknown>
  refreshContextStatus(): Promise<unknown>
}): Promise<void> {
  const { chapterId, compileChapter, loadChapters, refreshContextStatus, refreshMeta } = input
  await compileChapter(chapterId)
  await Promise.all([loadChapters(chapterId), refreshMeta(), refreshContextStatus()])
}
