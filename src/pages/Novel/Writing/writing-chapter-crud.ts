import type { Chapter, StoryVolume } from '../../../types'
import type { ChapterSaveCoordinator } from './chapter-save-coordinator'

export interface NewChapterDraft {
  chapterNum: number
  title: string
  status: 'outline'
  volumeId?: number
}

export function buildNewChapterDraft(input: {
  chapters: Chapter[]
  currentChapter: Chapter | null
  volumes: StoryVolume[]
  requestedVolumeId?: number | null
}): NewChapterDraft {
  const nextNum = input.chapters.length > 0
    ? Math.max(...input.chapters.map((chapter) => chapter.chapterNum)) + 1
    : 1
  const targetVolumeId = typeof input.requestedVolumeId === 'number'
    ? input.requestedVolumeId
    : (input.currentChapter?.volumeId ?? input.volumes[0]?.id)

  return {
    chapterNum: nextNum,
    title: `第${nextNum}章`,
    status: 'outline',
    ...(targetVolumeId ? { volumeId: targetVolumeId } : {}),
  }
}

export async function deleteChapterAfterPendingSave(input: {
  chapterId: number
  saveCoordinator: Pick<ChapterSaveCoordinator, 'cancelScheduled' | 'waitForChapter'>
  deleteChapter(chapterId: number): Promise<void>
  refreshChapters(): Promise<void>
  refreshMeta(): Promise<void>
  refreshContextStatus(): Promise<void>
}): Promise<void> {
  input.saveCoordinator.cancelScheduled(input.chapterId)
  await input.saveCoordinator.waitForChapter(input.chapterId)
  await input.deleteChapter(input.chapterId)
  await Promise.all([
    input.refreshChapters(),
    input.refreshMeta(),
    input.refreshContextStatus(),
  ])
}
