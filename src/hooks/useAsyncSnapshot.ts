import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useScopedState } from './useScopedState'

interface Snapshot<T> {
  data: T | null
  error: unknown
  loading: boolean
  refreshKey: unknown
}

// Convert synchronous IPC failures to rejected promises without deferring the
// actual read or wrapping any state updates.
async function readSnapshot<T>(read: () => Promise<T>): Promise<T> {
  return read()
}

/** Pass a useCallback reader containing only reads. Its identity owns the data.
 * Refresh keeps the previous successful value; changing the reader clears it.
 * An external revision can re-read the same scope without clearing its data.
 */
export function useAsyncSnapshot<T>(read: () => Promise<T>, refreshKey?: unknown) {
  const [snapshot, setSnapshot] = useScopedState<Snapshot<T>>(read, { data: null, error: null, loading: true, refreshKey })
  if (!Object.is(snapshot.refreshKey, refreshKey)) {
    setSnapshot({ ...snapshot, refreshKey, error: null, loading: true })
  }
  const request = useRef(0)
  const activeSetter = useRef<typeof setSnapshot | null>(setSnapshot)
  useLayoutEffect(() => {
    activeSetter.current = setSnapshot
    return () => { activeSetter.current = null; request.current += 1 }
  }, [setSnapshot, refreshKey])
  const load = useCallback(() => {
    if (activeSetter.current !== setSnapshot) return Promise.resolve(undefined)
    const id = ++request.current
    return readSnapshot(read).then((data) => {
      if (request.current === id) setSnapshot(current => ({ ...current, data, error: null, loading: false }))
      return data
    }, (error: unknown) => {
      if (request.current === id) setSnapshot(current => ({ ...current, error, loading: false }))
      return undefined
    })
  }, [read, setSnapshot])

  useEffect(() => {
    void load()
    return () => { request.current += 1 }
  }, [load, refreshKey])

  const reload = useCallback(() => {
    setSnapshot(current => ({ ...current, loading: true }))
    return load()
  }, [load, setSnapshot])
  return { data: snapshot.data, error: snapshot.error, loading: snapshot.loading, reload }
}
