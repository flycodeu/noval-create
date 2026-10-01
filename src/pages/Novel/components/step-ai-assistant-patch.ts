export function pickChangedDraftFields<T extends Record<string, unknown>>(
  patch: T,
  currentValues: Record<string, unknown>,
): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => {
    if (value === null || value === undefined) return false
    if (typeof value === 'string' && !value.trim()) return false
    if (Array.isArray(value) && value.length === 0) return false
    if (typeof value === 'number' && !Number.isFinite(value)) return false
    const current = currentValues[key]
    return Array.isArray(value) || Array.isArray(current)
      ? JSON.stringify(value) !== JSON.stringify(current)
      : value !== current
  })) as Partial<T>
}
