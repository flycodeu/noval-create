import { useCallback, useRef, useState } from 'react'

export interface TrackedGenerationError {
  message: string
  code: string | null
  at: number
}

export interface TrackedGenerationState<T> {
  running: boolean
  error: TrackedGenerationError | null
  run: (fn: () => Promise<T>) => Promise<T | null>
  retry: () => Promise<T | null>
  dismissError: () => void
}

function toTrackedError(error: unknown): TrackedGenerationError {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '操作失败，请重试。'
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
  return { message, code, at: Date.now() }
}

/**
 * Migration sugar for pages that still call one-shot Promise IPC (no taskId).
 * Replaces the setGenerating(true) / message.error / console.error triple with
 * a persistent error object suitable for an Alert + retry button.
 */
export function useTrackedGeneration<T = unknown>(): TrackedGenerationState<T> {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<TrackedGenerationError | null>(null)
  const lastFnRef = useRef<(() => Promise<T>) | null>(null)

  const run = useCallback(async (fn: () => Promise<T>): Promise<T | null> => {
    lastFnRef.current = fn
    setRunning(true)
    setError(null)
    try {
      return await fn()
    } catch (caught) {
      console.error('[useTrackedGeneration]', caught)
      setError(toTrackedError(caught))
      return null
    } finally {
      setRunning(false)
    }
  }, [])

  const retry = useCallback(async (): Promise<T | null> => {
    const fn = lastFnRef.current
    if (!fn) return null
    return run(fn)
  }, [run])

  const dismissError = useCallback(() => setError(null), [])

  return { running, error, run, retry, dismissError }
}
