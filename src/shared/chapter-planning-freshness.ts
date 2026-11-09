interface ChapterPlanningSnapshot {
  chapterNum: number
  staleReasonJson?: string | null
  scenePlanJson?: string | null
  bridgePlanJson?: string | null
}

export function isChapterBodyEditStaleReason(chapterNum: number, reason: unknown): boolean {
  if (typeof reason !== 'string') return false
  if (reason.startsWith('正文已更新，')) return true
  const sourceChapter = /^第(\d+)章正文版本已修改/u.exec(reason)
  return sourceChapter !== null && Number(sourceChapter[1]) === chapterNum
}

/** Legacy editor saves retained plans for the previous body. Ignore those
 * snapshots on reads without rewriting author contracts or later chapters. */
export function projectChapterPlanningArtifacts<T extends ChapterPlanningSnapshot>(chapter: T): T {
  let reasons: unknown
  try { reasons = JSON.parse(chapter.staleReasonJson || '[]') } catch { return chapter }
  if (!Array.isArray(reasons) || !reasons.some((reason) => isChapterBodyEditStaleReason(chapter.chapterNum, reason))) return chapter
  return { ...chapter, scenePlanJson: '', bridgePlanJson: '' }
}
