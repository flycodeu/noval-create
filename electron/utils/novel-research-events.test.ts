import { describe, expect, it, vi } from 'vitest'
import { notifyNovelResearchChanged, onNovelResearchChanged } from './novel-research-events'

describe('saved research notifications', () => {
  it('sends a novel-scoped invalidation without transporting card contents or credentials', () => {
    const listener = vi.fn()
    const stop = onNovelResearchChanged(listener)
    try {
      notifyNovelResearchChanged(292)
      notifyNovelResearchChanged(0)
      notifyNovelResearchChanged(NaN)
      expect(listener.mock.calls).toEqual([[{ novelId: 292 }]])
      stop()
      notifyNovelResearchChanged(292)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally { stop() }
  })

  it('a disconnected listener cannot turn a committed save into an error or block other views', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = onNovelResearchChanged(() => { throw new Error('window gone') })
    const listener = vi.fn()
    const second = onNovelResearchChanged(listener)
    try {
      expect(() => notifyNovelResearchChanged(292)).not.toThrow()
      expect(listener).toHaveBeenCalledWith({ novelId: 292 })
    } finally { first(); second(); warn.mockRestore() }
  })
})
