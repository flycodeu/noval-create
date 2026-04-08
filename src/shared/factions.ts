export type FactionType =
  | 'organization'
  | 'faction'
  | 'family'
  | 'sect'
  | 'company'
  | 'government'
  | 'other'

export type FactionRelationType =
  | 'ally'
  | 'enemy'
  | 'neutral'
  | 'subordinate'
  | 'trade'
  | 'rival'
  | 'patron'
  | 'vassal'
  | 'truce'
  | 'manipulates'
  | 'protects'
  | 'infiltrates'

export interface FactionExternalRelation {
  targetFactionId?: number
  targetFactionName?: string
  relation: FactionRelationType
  note?: string
}

export const FACTION_RELATION_TYPE_OPTIONS: Array<{ value: FactionRelationType; label: string; color: string }> = [
  { value: 'ally', label: '盟友', color: '#1f7a63' },
  { value: 'enemy', label: '敌对', color: '#b14949' },
  { value: 'neutral', label: '中立', color: '#7b6b59' },
  { value: 'subordinate', label: '从属', color: '#4e6f95' },
  { value: 'trade', label: '交易', color: '#9a6a24' },
  { value: 'rival', label: '竞争', color: '#9d4f76' },
  { value: 'patron', label: '资助', color: '#6a6fbc' },
  { value: 'vassal', label: '附庸', color: '#4870a8' },
  { value: 'truce', label: '休战', color: '#63856c' },
  { value: 'manipulates', label: '操控', color: '#8a4b62' },
  { value: 'protects', label: '庇护', color: '#4d8a70' },
  { value: 'infiltrates', label: '渗透', color: '#7d5f92' },
]

function isFactionRelationType(value: string): value is FactionRelationType {
  return FACTION_RELATION_TYPE_OPTIONS.some((item) => item.value === value)
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

export function getFactionRelationLabel(value?: string | null): string {
  return FACTION_RELATION_TYPE_OPTIONS.find((item) => item.value === value)?.label || value || '未命名关系'
}

export function getFactionRelationColor(value?: string | null): string {
  return FACTION_RELATION_TYPE_OPTIONS.find((item) => item.value === value)?.color || '#8a6f54'
}
