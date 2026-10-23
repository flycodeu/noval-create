import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeNovelResearchRefresh } from './novel-research-events'
import { useNovelStore } from '../stores/novel.store'
import { NOVEL_RESEARCH_CHANGED_CHANNEL, parseNovelResearchChangedEvent } from '../shared/novel-research-events'
import { WEB_EVENT_STREAM_CONNECTED_EVENT } from '../shared/runtime-events'
import type { Novel } from '../types'

const novel = (id = 1, version = 1, source = 'old') => ({ id, contextVersion: version, sourceLedgerJson: source }) as Novel
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
let dispose: (() => void) | undefined

function fixture(hasEvents = true) {
  const handlers = new Map<string, (payload: unknown) => void>()
  const windowTarget = new EventTarget()
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const reads: Array<{ id: number; resolve: (value: Novel) => void; reject: (error: Error) => void }> = []
  const get = vi.fn((id: number) => new Promise<Novel>((resolve, reject) => reads.push({ id, resolve, reject })))
  const on = hasEvents ? vi.fn((channel: string, callback: (payload: unknown) => void) => {
    handlers.set(channel, callback)
    return () => { handlers.delete(channel) }
  }) : undefined
  vi.stubGlobal('window', Object.assign(windowTarget, { electron: { novel: { get }, on } }))
  vi.stubGlobal('document', documentTarget)
  useNovelStore.getState().setCurrentNovel(novel())
  dispose = subscribeNovelResearchRefresh(1)
  return { reads, get, handlers, windowTarget, documentTarget, emit: (payload: unknown) => handlers.get(NOVEL_RESEARCH_CHANGED_CHANNEL)?.(payload) }
}

afterEach(() => { dispose?.(); dispose = undefined; useNovelStore.getState().resetWorkspace(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('novel research refresh', () => {
  it('validates the novel identity instead of accepting unscoped events', () => {
    for (const value of [null, {}, { novelId: '1' }, { novelId: -1 }, { novelId: 0.5 }, { novelId: Infinity }]) expect(parseNovelResearchChangedEvent(value)).toBeNull()
    expect(parseNovelResearchChangedEvent({ novelId: 1, ignored: 'not a command' })).toEqual({ novelId: 1 })
  })

  it('refreshes the open saved snapshot only for this novel and coalesces bursts', async () => {
    const f = fixture()
    f.reads[0].resolve(novel()); await settle()
    f.emit({ novelId: 2 }); f.emit({}); f.emit({ novelId: '1' })
    expect(f.get).toHaveBeenCalledTimes(1)
    f.emit({ novelId: 1 }); f.emit({ novelId: 1 }); f.emit({ novelId: 1 })
    expect(f.get).toHaveBeenCalledTimes(2)
    f.reads[1].resolve(novel(1, 2, 'first imported card')); await settle()
    expect(f.get).toHaveBeenCalledTimes(3)
    f.reads[2].resolve(novel(1, 3, 'latest imported cards')); await settle()
    expect(useNovelStore.getState().currentNovel).toMatchObject({ contextVersion: 3, sourceLedgerJson: 'latest imported cards' })
    expect(f.get).toHaveBeenCalledTimes(3)
  })

  it('keeps newer store data when an older read completes late', async () => {
    const f = fixture()
    useNovelStore.getState().setCurrentNovel(novel(1, 4, 'newer saved snapshot'))
    f.reads[0].resolve(novel(1, 2, 'stale')); await settle()
    expect(useNovelStore.getState().currentNovel?.contextVersion).toBe(4)
    f.emit({ novelId: 1 })
    useNovelStore.getState().setCurrentNovel(novel(1, 4, 'same-version newer saved snapshot'))
    f.reads[1].resolve(novel(1, 4, 'older same-version snapshot')); await settle()
    expect(useNovelStore.getState().currentNovel?.sourceLedgerJson).toBe('same-version newer saved snapshot')
  })

  it('cannot overwrite another novel or publish after unmount', async () => {
    const f = fixture()
    f.emit({ novelId: 1 })
    useNovelStore.getState().setCurrentNovel(novel(2, 9, 'second book'))
    f.reads[0].resolve(novel(1, 8, 'first book')); await settle()
    expect(useNovelStore.getState().currentNovel?.id).toBe(2)
    expect(f.get).toHaveBeenCalledTimes(1)
    dispose?.()
    expect(f.handlers.size).toBe(0)
    f.windowTarget.dispatchEvent(new Event('focus'))
    expect(f.get).toHaveBeenCalledTimes(1)
  })

  it('drops an in-flight response when disposed and never uses periodic polling', async () => {
    const f = fixture()
    dispose?.()
    f.reads[0].resolve(novel(1, 99, 'late')); await settle()
    expect(useNovelStore.getState().currentNovel?.contextVersion).toBe(1)
    expect(f.get).toHaveBeenCalledTimes(1)
  })

  it('stays idle between explicit invalidations instead of periodically rereading', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.reads[0].resolve(novel()); await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.get).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('supports focus/visible recovery with no native event API and preserves data on failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fixture(false)
    f.reads[0].reject(new Error('isolated offline failure')); await settle()
    expect(useNovelStore.getState().currentNovel?.sourceLedgerJson).toBe('old')
    f.windowTarget.dispatchEvent(new Event('focus'))
    f.reads[1].resolve(novel(1, 2, 'focus refreshed')); await settle()
    expect(useNovelStore.getState().currentNovel?.sourceLedgerJson).toBe('focus refreshed')
    f.documentTarget.visibilityState = 'hidden'
    f.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(f.get).toHaveBeenCalledTimes(2)
    f.documentTarget.visibilityState = 'visible'
    f.documentTarget.dispatchEvent(new Event('visibilitychange'))
    f.reads[2].resolve(novel(1, 3, 'visible refreshed')); await settle()
    expect(useNovelStore.getState().currentNovel?.sourceLedgerJson).toBe('visible refreshed')
    f.windowTarget.dispatchEvent(new Event(WEB_EVENT_STREAM_CONNECTED_EVENT))
    f.reads[3].resolve(novel(1, 4, 'reconnected snapshot')); await settle()
    expect(useNovelStore.getState().currentNovel?.sourceLedgerJson).toBe('reconnected snapshot')
    dispose?.()
    f.windowTarget.dispatchEvent(new Event(WEB_EVENT_STREAM_CONNECTED_EVENT))
    expect(f.get).toHaveBeenCalledTimes(4)
  })
})
