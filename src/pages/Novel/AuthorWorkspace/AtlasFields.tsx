import React from 'react'
import type { StoryAtlasEntity } from '../../../shared/story-atlas'
import { parseDocument, recordOf } from './content-document'
import { ATLAS_INTERNAL_FIELDS, atlasFieldLabel, atlasScalarText, hasAtlasValue, resolveAtlasReference } from './atlas-profile'

type Props = { values: Record<string, unknown>; entities: StoryAtlasEntity[]; chapters: Array<{ id: number; chapterNum: number }>; positions?: Array<{ id: string; title: string }>; onOpen?: (entity: StoryAtlasEntity) => void }
function FieldValue({ value, field, ...props }: Omit<Props, 'values'> & { value: unknown; field: string }): React.ReactElement {
  if (field === 'geography') {
    const geography = recordOf(value), frame = recordOf(geography.mapFrame)
    return <AtlasFields values={{ areaKm2: geography.areaKm2, development: geography.development, widthKm: frame.widthKm, heightKm: frame.heightKm }} {...props} />
  }
  const parsed = parseDocument(value)
  if (parsed !== value) return <FieldValue value={parsed} field={field} {...props} />
  if (Array.isArray(value)) return <ul className="atlas-field-list">{value.filter(hasAtlasValue).map((item, index) => <li key={index}><FieldValue value={item} field={field} {...props} /></li>)}</ul>
  if (value && typeof value === 'object') return <AtlasFields values={value as Record<string, unknown>} {...props} />
  const reference = resolveAtlasReference(field, value, props.entities)
  return reference && props.onOpen ? <button type="button" className="atlas-text-link" onClick={() => props.onOpen?.(reference)}>{reference.name}</button> : <span>{atlasScalarText(field, value, props.entities, props.chapters, props.positions)}</span>
}
export function AtlasFields({ values, ...props }: Props) {
  const entries = Object.entries(values).filter(([key, value]) => !ATLAS_INTERNAL_FIELDS.has(key) && hasAtlasValue(value))
  return <dl className="atlas-profile-fields">{entries.map(([key, value]) => <div key={key}><dt>{atlasFieldLabel(key)}</dt><dd><FieldValue value={value} field={key} {...props} /></dd></div>)}</dl>
}
