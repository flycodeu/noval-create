import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { AtlasEditValue } from './AtlasEntityEditor'
import { atlasEditedAttributes } from './atlas-profile'

const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: null, entities: [], relations: [], locationChildren: [], diagnostics: [] }
describe('explicit atlas edits', () => {
  it('submits only editable changes, including removals, without resubmitting imported references', () => {
    const previous = { campFactionIds: [7], age: 22, habits: ['捻衣角'], personalityTraits: ['急躁', '谨慎'], speechPattern: '简短', sourceContext: { imported: true } }
    const next = { ...previous, age: null, habits: [], personalityTraits: ['沉稳'], speechPattern: '', campFactionIds: [8] }
    expect(atlasEditedAttributes(previous, next)).toEqual({ age: null, habits: [], personalityTraits: ['沉稳'], speechPattern: '' })
  })
  it('uses an integer control even before a character has an age', () => {
    const html = renderToStaticMarkup(React.createElement(AtlasEditValue, { field: 'age', name: '年龄', value: '', snapshot, onChange: () => undefined }))
    expect(html).toContain('role="spinbutton"')
    expect(html).toContain('aria-label="年龄"')
    expect(html).not.toContain('textarea')
  })
  it('shows imported reference names without exposing an editable ID field', () => {
    const withFaction = { ...snapshot, entities: [{ id: 'faction:7', kind: 'faction' as const, name: '渡务会', summary: '', parentId: null, attributes: {}, status: 'confirmed' as const, effectiveFromChapter: 0, source: { kind: 'test' } }] }
    const html = renderToStaticMarkup(React.createElement(AtlasEditValue, { field: 'campFactionIds', name: '所属组织', value: [7], snapshot: withFaction, onChange: () => undefined }))
    expect(html).toContain('渡务会')
    expect(html).not.toContain('textarea')
    expect(html).not.toContain('spinbutton')
  })
  it('keeps a new line while adding another trait', () => {
    const input = AtlasEditValue({ field: 'personalityTraits', name: '性格特点', value: ['谨慎'], snapshot, onChange: next => expect(next).toEqual(['谨慎', '']) })
    input.props.onChange({ target: { value: '谨慎\n' } })
  })
  it('preserves the numeric control after clearing a nested optional number', () => {
    const html = renderToStaticMarkup(React.createElement(AtlasEditValue, { field: 'heightCm', name: '身高', value: null, originalValue: 180, snapshot, onChange: () => undefined }))
    expect(html).toContain('role="spinbutton"')
    expect(html).not.toContain('textarea')
  })
  it('limits position status and prevents selecting itself as supervisor', () => {
    const props = { name: '岗位状态', value: 'established', positionId: 'watch', snapshot, onChange: () => undefined }
    const status = AtlasEditValue({ ...props, field: 'status' })
    expect(status.props.options.map((option: { value: string }) => option.value)).toEqual(['planned', 'established'])
    expect(status.props.allowClear).toBe(false)
    const parent = AtlasEditValue({ ...props, field: 'reportsToPositionId', positions: [{ id: 'watch', title: '巡守' }, { id: 'chief', title: '会首' }] })
    expect(parent.props.options).toEqual([{ value: 'chief', label: '会首' }])
  })
  it('can remove the last structured entry without turning it into a string-list input', () => {
    const value = [{ name: '辨妖', effect: '只能看见近处妖气' }]
    const list = AtlasEditValue({ field: 'abilities', name: '能力', value, originalValue: value, snapshot, onChange: next => expect(next).toEqual([]) })
    list.props.children[0].props.children[1].props.onClick()
    const html = renderToStaticMarkup(React.createElement(AtlasEditValue, { field: 'abilities', name: '能力', value: [], originalValue: value, snapshot, onChange: () => undefined }))
    expect(html).not.toContain('textarea')
  })
})
