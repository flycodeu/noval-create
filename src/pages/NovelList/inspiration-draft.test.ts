import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspirationDraft, readInspirationDraft, INSPIRATION_DRAFT_KEY } from './inspiration-draft'

afterEach(() => { vi.unstubAllGlobals() })
describe('inspiration session recovery', () => {
  it('does not restore a corrupted session draft', () => {
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => key === INSPIRATION_DRAFT_KEY ? '{"version":1,"draftId":"a-long-id","step":2,"seed":42}' : null })
    expect(readInspirationDraft()).toBeNull()
  })
  it('keeps author text but drops malformed cached candidates and task ids', () => {
    const draft = { ...createInspirationDraft({ title: '手写书名', userBackground: '普通船工修船' }), taskId: -1, directions: { taskId: 1, input: null }, selectedPackage: { taskId: 1, item: null } }
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(draft) })
    const restored = readInspirationDraft()
    expect(restored?.title).toBe('手写书名')
    expect(restored?.seed).toBe('普通船工修船')
    expect(restored?.taskId).toBeUndefined()
    expect(restored?.directions).toBeUndefined()
    expect(restored?.selectedPackage).toBeUndefined()
  })
})
