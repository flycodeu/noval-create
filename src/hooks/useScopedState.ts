import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * State owned by a filter or editor identity. Reset before committing children
 * or running their effects, so a new query never uses the previous page/draft.
 * Setters from an earlier scope are ignored, including after switching back.
 */
export function useScopedState<T>(scopeKey: string | number | object | null | undefined, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => ({ scopeKey, value: initialValue, version: {} }))
  if (state.scopeKey !== scopeKey) {
    setState({ scopeKey, value: initialValue, version: {} })
  }
  const { version } = state
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setState((current) => {
      if (current.version !== version) return current
      const value = typeof update === 'function'
        ? (update as (previous: T) => T)(current.value)
        : update
      return Object.is(current.value, value) ? current : { ...current, value }
    })
  }, [version])
  return [state.scopeKey === scopeKey ? state.value : initialValue, setValue]
}
