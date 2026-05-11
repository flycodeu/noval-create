import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'novelforge-author-work-mode'

interface MockStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
  key: (index: number) => string | null
  readonly length: number
}

function createStorage(): MockStorage {
  const store = new Map<string, string>()

  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value))
    },
    removeItem: (key) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
}

async function loadStore() {
  const module = await import('./author-work-mode.store')
  return module.useAuthorWorkModeStore
}

function readStorage() {
  return (globalThis as typeof globalThis & { localStorage: MockStorage }).localStorage
}

describe('author-work-mode.store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists manual mode across module reloads', async () => {
    const store = await loadStore()

    store.getState().setManualMode('daily_push')

    expect(readStorage().getItem(STORAGE_KEY)).toContain('"mode":"daily_push"')
    expect(readStorage().getItem(STORAGE_KEY)).toContain('"source":"manual"')

    vi.resetModules()

    const reloadedStore = await loadStore()

    expect(reloadedStore.getState().mode).toBe('daily_push')
    expect(reloadedStore.getState().source).toBe('manual')
  })

  it('does not let auto-sync override a manual choice', async () => {
    const store = await loadStore()

    store.getState().setManualMode('asset_building')
    store.getState().syncSuggestedMode('revision_closure')

    expect(store.getState().mode).toBe('asset_building')
    expect(store.getState().source).toBe('manual')
    expect(readStorage().getItem(STORAGE_KEY)).toContain('"mode":"asset_building"')
  })

  it('resets back to the suggested mode when leaving manual mode', async () => {
    const store = await loadStore()

    store.getState().setManualMode('revision_closure')
    store.getState().resetToAuto('quick_start')

    expect(store.getState().mode).toBe('quick_start')
    expect(store.getState().source).toBe('auto')
    expect(readStorage().getItem(STORAGE_KEY)).toContain('"mode":"quick_start"')
    expect(readStorage().getItem(STORAGE_KEY)).toContain('"source":"auto"')
  })
})
