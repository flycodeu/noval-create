import { afterEach, describe, expect, it, vi } from 'vitest'

describe('workspace.store persistence guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('falls back to pro mode when persisted data is invalid', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'corrupted-mode',
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    const { useWorkspaceStore } = await import('./workspace.store')

    expect(useWorkspaceStore.getState().mode).toBe('pro')
  })

  it('remains usable when browser storage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    const { useWorkspaceStore } = await import('./workspace.store')

    useWorkspaceStore.getState().setMode('guided')
    expect(useWorkspaceStore.getState().mode).toBe('guided')
  })
})
