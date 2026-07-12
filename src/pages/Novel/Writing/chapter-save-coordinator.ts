export type ChapterSaveOperation = () => Promise<void>

export interface ChapterSaveCoordinator {
  cancelScheduled: (chapterId: number) => void
  flushAll: () => Promise<PromiseSettledResult<void>[]>
  runNow: (chapterId: number, operation: ChapterSaveOperation) => Promise<void>
  schedule: (chapterId: number, operation: ChapterSaveOperation, delayMs?: number) => void
  waitForChapter: (chapterId: number) => Promise<void>
}

interface PendingSave {
  operation: ChapterSaveOperation
  timer: ReturnType<typeof setTimeout>
}

export function createChapterSaveCoordinator(
  onBackgroundError: (error: unknown) => void = console.error,
): ChapterSaveCoordinator {
  const pendingByChapter = new Map<number, PendingSave>()
  const queueByChapter = new Map<number, Promise<void>>()

  const cancelScheduled = (chapterId: number) => {
    const pending = pendingByChapter.get(chapterId)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingByChapter.delete(chapterId)
  }

  const enqueue = (chapterId: number, operation: ChapterSaveOperation) => {
    const previous = queueByChapter.get(chapterId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    queueByChapter.set(chapterId, next)
    void next.finally(() => {
      if (queueByChapter.get(chapterId) === next) queueByChapter.delete(chapterId)
    }).catch(() => undefined)
    return next
  }

  const runNow = (chapterId: number, operation: ChapterSaveOperation) => {
    cancelScheduled(chapterId)
    return enqueue(chapterId, operation)
  }

  const schedule = (chapterId: number, operation: ChapterSaveOperation, delayMs = 1500) => {
    cancelScheduled(chapterId)
    const pending: PendingSave = {
      operation,
      timer: setTimeout(() => {
        if (pendingByChapter.get(chapterId) !== pending) return
        pendingByChapter.delete(chapterId)
        void enqueue(chapterId, operation).catch(onBackgroundError)
      }, delayMs),
    }
    pendingByChapter.set(chapterId, pending)
  }

  const flushAll = () => {
    const pending = [...pendingByChapter.entries()]
    pendingByChapter.clear()
    return Promise.allSettled(pending.map(([chapterId, save]) => {
      clearTimeout(save.timer)
      return enqueue(chapterId, save.operation)
    }))
  }

  const waitForChapter = async (chapterId: number) => {
    while (queueByChapter.has(chapterId)) {
      await queueByChapter.get(chapterId)?.catch(() => undefined)
    }
  }

  return { cancelScheduled, flushAll, runNow, schedule, waitForChapter }
}
