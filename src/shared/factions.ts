export type FactionType =
  | 'organization'
  | 'faction'
  | 'family'
  | 'sect'
  | 'company'
  | 'government'
  | 'other'

export type FactionRelationType = 'ally' | 'enemy' | 'neutral' | 'subordinate'

export interface FactionExternalRelation {
  targetFactionId?: number
  targetFactionName?: string
  relation: FactionRelationType
  note?: string
}

function isFactionRelationType(value: string): value is FactionRelationType {
  return value === 'ally' || value === 'enemy' || value === 'neutral' || value === 'subordinate'
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

export function parseFactionExternalRelations(raw?: string | null): FactionExternalRelation[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []

      const relation = asText((item as Record<string, unknown>).relation)
      if (!isFactionRelationType(relation)) return []

      const targetFactionId = asNumber((item as Record<string, unknown>).targetFactionId ?? (item as Record<string, unknown>).target_faction_id)
      const targetFactionName = asText((item as Record<string, unknown>).targetFactionName ?? (item as Record<string, unknown>).target_faction_name)
      const note = asText((item as Record<string, unknown>).note)
      const next: FactionExternalRelation = { relation }

      if (typeof targetFactionId === 'number') next.targetFactionId = targetFactionId
      if (targetFactionName) next.targetFactionName = targetFactionName
      if (note) next.note = note

      return [next]
    })
  } catch {
    return []
  }
}

export function buildFactionExternalRelationsPayload(relations: FactionExternalRelation[]): string {
  return JSON.stringify(
    relations
      .map((relation) => ({
        target_faction_id: relation.targetFactionId,
        target_faction_name: relation.targetFactionName?.trim() || undefined,
        relation: relation.relation,
        note: relation.note?.trim() || undefined,
      }))
      .filter((relation) => relation.target_faction_id || relation.target_faction_name),
  )
}
