import { describe, expect, it } from 'vitest'
import { savedCreativeEntities } from './creative-run-result'

describe('committed creative result names', () => {
  const output = JSON.stringify({ changes: [
    { op: 'upsert_entity', clientId: 'lamp', kind: 'item', name: '旧铜灯' },
    { op: 'upsert_entity', id: 'item:2', kind: 'item', name: '薄册' },
    { op: 'upsert_entity', id: 'item:3', kind: 'item', name: '未应用资料' },
    { op: 'upsert_relation', id: 'ownership:1', kind: 'ownership', name: '关系' },
  ] })
  it('resolves historical client IDs using the receipt and excludes unapplied candidates', () => {
    expect(savedCreativeEntities({ appliedIds: ['item:1', 'item:2', 'ownership:1'], idMap: { lamp: 'item:1' } }, output)).toEqual([
      { id: 'item:1', kind: 'item', name: '旧铜灯' }, { id: 'item:2', kind: 'item', name: '薄册' },
    ])
  })
  it('does not infer saved records from candidates without a receipt or mismatched kinds', () => {
    expect(savedCreativeEntities({}, output)).toEqual([])
    expect(savedCreativeEntities({ appliedIds: ['character:1'], idMap: { lamp: 'character:1' } }, output)).toEqual([])
  })
  it('keeps legacy run history readable when its candidate is missing or malformed', () => {
    for (const value of [null, 'not json', 'null', '{}']) expect(savedCreativeEntities({ appliedIds: ['item:1'] }, value)).toEqual([])
  })
})
