import { NOVEL_RESEARCH_CHANGED_CHANNEL, parseNovelResearchChangedEvent } from '../shared/novel-research-events'
import { WEB_EVENT_STREAM_CONNECTED_EVENT } from '../shared/runtime-events'
import { useNovelStore } from '../stores/novel.store'

/** Refresh the saved snapshot only. Editor drafts and their captured CAS version stay local. */
export function subscribeNovelResearchRefresh(novelId: number): () => void {
  let disposed = false
  let reading = false
  let pending = false
  const refresh = async () => {
    if (disposed || useNovelStore.getState().currentNovelId !== novelId) return
    if (reading) { pending = true; return }
    reading = true
    const initialSnapshot = useNovelStore.getState().currentNovel
    try {
      const latest = await window.electron.novel.get(novelId)
      const current = useNovelStore.getState()
      if (disposed || !latest || latest.id !== novelId || current.currentNovelId !== novelId) return
      const latestVersion = latest.contextVersion || 0
      const currentVersion = current.currentNovel?.contextVersion || 0
      if (latestVersion < currentVersion || current.currentNovel !== initialSnapshot && latestVersion <= currentVersion) return
      current.setCurrentNovel(latest)
    } catch (error) {
      // Retain the saved snapshot and every draft on a transient disconnect; focus retries it.
      if (!disposed) console.warn('[novel-research-events] refresh failed', error)
    } finally {
      reading = false
      if (!disposed && pending) { pending = false; void refresh() }
    }
  }
  const changed = (payload: unknown) => { if (parseNovelResearchChangedEvent(payload)?.novelId === novelId) void refresh() }
  const focused = () => { void refresh() }
  const visible = () => { if (document.visibilityState === 'visible') void refresh() }
  const unsubscribe = typeof window.electron.on === 'function' ? window.electron.on(NOVEL_RESEARCH_CHANGED_CHANNEL, changed) : undefined
  window.addEventListener('focus', focused)
  window.addEventListener(WEB_EVENT_STREAM_CONNECTED_EVENT, focused)
  document.addEventListener('visibilitychange', visible)
  void refresh()
  return () => {
    disposed = true
    pending = false
    unsubscribe?.()
    window.removeEventListener('focus', focused)
    window.removeEventListener(WEB_EVENT_STREAM_CONNECTED_EVENT, focused)
    document.removeEventListener('visibilitychange', visible)
  }
}
