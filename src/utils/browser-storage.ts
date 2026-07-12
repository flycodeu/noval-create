const memoryStorage = new Map<string, string>()

interface BrowserStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function getBrowserStorage(): BrowserStorage | null {
  try {
    const storage = (globalThis as typeof globalThis & { localStorage?: BrowserStorage }).localStorage
    return storage ?? null
  } catch {
    return null
  }
}

export function readBrowserStorage(key: string): string | null {
  const storage = getBrowserStorage()
  if (storage) {
    try {
      const value = storage.getItem(key)
      if (value !== null) memoryStorage.set(key, value)
      return value
    } catch {
      // Fall back to process memory when storage is denied or unavailable.
    }
  }
  return memoryStorage.get(key) ?? null
}

export function writeBrowserStorage(key: string, value: string): boolean {
  memoryStorage.set(key, value)
  const storage = getBrowserStorage()
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeBrowserStorage(key: string): boolean {
  memoryStorage.delete(key)
  const storage = getBrowserStorage()
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function __resetBrowserStorageForTests(): void {
  memoryStorage.clear()
}
