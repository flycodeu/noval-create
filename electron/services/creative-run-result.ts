export interface SavedCreativeEntity { id: string; kind: string; name: string }

/** Names come from the committed candidate and its actual write receipt, never the request. */
export function savedCreativeEntities(result: Record<string, unknown>, output: unknown): SavedCreativeEntity[] {
  if (typeof output !== 'string' || !Array.isArray(result.appliedIds)) return []
  let data: { changes?: unknown }
  try { data = JSON.parse(output) } catch { return [] }
  if (!data || !Array.isArray(data.changes)) return []
  const applied = new Set(result.appliedIds.filter((id): id is string => typeof id === 'string'))
  const idMap = result.idMap && typeof result.idMap === 'object' ? result.idMap as Record<string, unknown> : {}
  const names = new Map<string, SavedCreativeEntity>()
  for (const value of data.changes) {
    if (!value || typeof value !== 'object') continue
    const change = value as Record<string, unknown>
    const id = typeof change.id === 'string' ? change.id : typeof change.clientId === 'string' ? idMap[change.clientId] : undefined
    if (change.op !== 'upsert_entity' || typeof id !== 'string' || !applied.has(id)
      || typeof change.kind !== 'string' || !id.startsWith(`${change.kind}:`)
      || typeof change.name !== 'string' || !change.name.trim()) continue
    names.set(id, { id, kind: change.kind, name: change.name.trim() })
  }
  return [...names.values()]
}
