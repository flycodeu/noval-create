import type { NovelResearchChangedEvent } from '../../src/shared/novel-research-events'

const listeners = new Set<(event: NovelResearchChangedEvent) => void>()

export function onNovelResearchChanged(listener: (event: NovelResearchChangedEvent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Notify after the save commits. A disconnected view cannot make a successful save fail. */
export function notifyNovelResearchChanged(novelId: number): void {
  if (!Number.isSafeInteger(novelId) || novelId < 1) return
  for (const listener of listeners) {
    try { listener({ novelId }) } catch (error) { console.warn('[novel-research-events] notification failed', error) }
  }
}
