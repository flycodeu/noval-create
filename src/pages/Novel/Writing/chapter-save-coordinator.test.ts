import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChapterSaveCoordinator } from './chapter-save-coordinator'

describe('chapter save coordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces each chapter independently', async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const coordinator = createChapterSaveCoordinator()

    coordinator.schedule(1, async () => { saved.push('chapter-1-old') })
    coordinator.schedule(2, async () => { saved.push('chapter-2') })
    coordinator.schedule(1, async () => { saved.push('chapter-1-new') })
    await vi.advanceTimersByTimeAsync(1500)

    expect(saved).toHaveLength(2)
    expect(saved).toContain('chapter-1-new')
    expect(saved).toContain('chapter-2')
    expect(saved).not.toContain('chapter-1-old')
  })

  it('serializes saves for the same chapter', async () => {
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const coordinator = createChapterSaveCoordinator()

    const first = coordinator.runNow(1, async () => {
      events.push('first-start')
      await firstGate
      events.push('first-end')
    })
    const second = coordinator.runNow(1, async () => { events.push('second') })
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual(['first-start'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'first-end', 'second'])
  })

  it('flushes pending chapter edits immediately', async () => {
    vi.useFakeTimers()
    const saved: number[] = []
    const coordinator = createChapterSaveCoordinator()

    coordinator.schedule(1, async () => { saved.push(1) })
    coordinator.schedule(2, async () => { saved.push(2) })
    await coordinator.flushAll()

    expect(saved.sort()).toEqual([1, 2])
    await vi.runAllTimersAsync()
    expect(saved).toHaveLength(2)
  })

  it('waits for an in-flight save before destructive chapter actions', async () => {
    let releaseSave: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseSave = resolve })
    const coordinator = createChapterSaveCoordinator()
    const save = coordinator.runNow(8, async () => gate)
    let settled = false
    const wait = coordinator.waitForChapter(8).then(() => { settled = true })
    await Promise.resolve()

    expect(settled).toBe(false)
    releaseSave?.()
    await Promise.all([save, wait])
    expect(settled).toBe(true)
  })
})
