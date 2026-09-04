import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, storyParts } from '../database/schema'

/** 根据当前章节归属维护部的实际章节范围；空部的实际范围置空。 */
export function syncStoryPartRanges(novelId: number): void {
  const db = getDb()
  const partRows = db.select().from(storyParts)
    .where(eq(storyParts.novelId, novelId))
    .all()
  const chapterNumsByPart = new Map<number, number[]>()

  db.select({ partId: chapters.partId, chapterNum: chapters.chapterNum })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
    .forEach((chapter) => {
      if (chapter.partId == null) return
      const chapterNums = chapterNumsByPart.get(chapter.partId) || []
      chapterNums.push(chapter.chapterNum)
      chapterNumsByPart.set(chapter.partId, chapterNums)
    })

  for (const part of partRows) {
    const chapterNums = (chapterNumsByPart.get(part.id) || []).sort((left, right) => left - right)
    const nextStartChapterNum = chapterNums[0] ?? null
    const nextEndChapterNum = chapterNums.at(-1) ?? null
    if (part.startChapterNum === nextStartChapterNum && part.endChapterNum === nextEndChapterNum) continue
    db.update(storyParts).set({
      startChapterNum: nextStartChapterNum,
      endChapterNum: nextEndChapterNum,
      updatedAt: new Date().toISOString(),
    }).where(eq(storyParts.id, part.id)).run()
  }
}
