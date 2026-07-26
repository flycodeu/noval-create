/**
 * Pure helpers for TruncatedList so the fold/expand logic can be unit-tested
 * without a DOM environment.
 */

export interface VisibleItemsResult<T> {
  visible: T[]
  hiddenCount: number
  canToggle: boolean
}

/**
 * Compute the visible slice of a truncatable list.
 * - When collapsed, show at most `limit` items and report how many are hidden.
 * - When expanded, show everything but keep `canToggle` so the UI can collapse back.
 * - A non-positive limit is treated as "no truncation".
 */
export function computeVisibleItems<T>(items: T[], limit: number, expanded: boolean): VisibleItemsResult<T> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : items.length
  const overflow = Math.max(0, items.length - normalizedLimit)
  if (expanded || overflow === 0) {
    return { visible: items, hiddenCount: 0, canToggle: overflow > 0 }
  }
  return { visible: items.slice(0, normalizedLimit), hiddenCount: overflow, canToggle: true }
}
