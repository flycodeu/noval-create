import { useEffect, useState } from 'react'

export interface DebouncedSearchOptions {
  delay?: number
}

/**
 * Unified debounced keyword input for list-page searches.
 *
 * Returns the raw input value (updates on every keystroke for instant UI
 * feedback) together with a debounced value that only changes after the user
 * pauses typing, so data-loading effects that depend on the debounced value
 * do not fire an IPC query per keystroke.
 */
export function useDebouncedSearch(
  initialValue = '',
  options: DebouncedSearchOptions = {},
): [string, React.Dispatch<React.SetStateAction<string>>, string] {
  const { delay = 220 } = options
  const [input, setInput] = useState(initialValue)
  const [debounced, setDebounced] = useState(initialValue)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(input), delay)
    return () => window.clearTimeout(timer)
  }, [input, delay])

  return [input, setInput, debounced]
}
