export interface CharacterRelationPreset {
  value: string
  label: string
}

export const CHARACTER_RELATION_PRESETS: CharacterRelationPreset[] = [
  { value: 'stranger', label: '陌生人' },
  { value: 'acquaintance', label: '泛熟人' },
  { value: 'friend', label: '朋友' },
  { value: 'family', label: '家人' },
  { value: 'colleague', label: '同事' },
  { value: 'mentor_student', label: '师徒' },
  { value: 'ally', label: '同盟' },
  { value: 'subordinate', label: '上下级' },
  { value: 'rival', label: '竞争对手' },
  { value: 'lover', label: '恋人' },
  { value: 'enemy', label: '敌对' },
]

const PRESET_LABELS = new Map(CHARACTER_RELATION_PRESETS.map((preset) => [preset.value, preset.label]))

export interface CharacterRelationNarrativeInput {
  relationType?: string | null
  relationLabel?: string | null
  description?: string | null
  intimacyLevel?: number | null
  tensionLevel?: number | null
  interactionStyle?: string | null
  subtextRule?: string | null
}

export function getCharacterRelationLabel(type?: string | null, fallback?: string | null): string {
  if (type && PRESET_LABELS.has(type)) return PRESET_LABELS.get(type) || fallback || type
  return fallback || type || '关系待补'
}

export function normalizeCharacterRelationLevel(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return undefined
  const rounded = Math.round(numeric)
  if (rounded < 1) return 1
  if (rounded > 5) return 5
  return rounded
}

export function formatCharacterRelationNarrative(relation: CharacterRelationNarrativeInput): string {
  const parts = [
    relation.relationLabel || getCharacterRelationLabel(relation.relationType),
    relation.description,
    relation.interactionStyle ? '互动：' + relation.interactionStyle : '',
    relation.subtextRule ? '潜台词：' + relation.subtextRule : '',
    relation.intimacyLevel ? '亲密 ' + relation.intimacyLevel + '/5' : '',
    relation.tensionLevel ? '张力 ' + relation.tensionLevel + '/5' : '',
  ].filter(Boolean)

  return parts.join('；')
}

export function buildCharacterRelationSummaryLine(
  charAName: string,
  charBName: string,
  relation: CharacterRelationNarrativeInput,
): string {
  const detail = formatCharacterRelationNarrative(relation)
  return '- ' + charAName + ' ↔ ' + charBName + (detail ? '：' + detail : '')
}
