import { useEffect, useMemo, useRef } from 'react'

/**
 * Returns a stable callback that debounces invocations: the wrapped function
 * only runs after `delay` ms have passed without another call. Useful for
 * remote-search inputs (AntD Select onSearch etc.) where every keystroke would
 * otherwise fire an IPC query.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void | Promise<void>,
  delay = 220,
): (...args: Args) => void {
  const callbackRef = useRef(callback)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return useMemo(() => {
    const debounced = (...args: Args) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void callbackRef.current(...args)
      }, delay)
    }
    return debounced
  }, [delay])
}
