import { describe, expect, it } from 'vitest'
import { changedFields, mergeCanonicalDocument } from './content-document'

describe('author document edits', () => {
  it('clears known fields while retaining unexposed extension data at each level', () => {
    expect(mergeCanonicalDocument({ rules: { known: 'old', extension: 'keep' }, custom: [1] }, { rules: { known: 'old' } }, { rules: {} })).toEqual({ rules: { extension: 'keep' }, custom: [1] })
  })
  it('reports a relationship target and chapter change instead of hiding them', () => {
    expect(changedFields({ toId: 'character:1', effectiveFromChapter: 2 }, { toId: 'character:2', effectiveFromChapter: 5 }).map(row => row.path)).toEqual(['终点/关联人物', '生效章位'])
  })
  it('preserves hidden array fields by stable id after reordering and permits record removal', () => {
    const original = [{ id: 'a', name: '甲', privateNote: 'keep-a' }, { id: 'b', name: '乙', privateNote: 'keep-b' }]
    const before = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]
    expect(mergeCanonicalDocument(original, before, [{ id: 'b', name: '乙改' }])).toEqual([{ id: 'b', name: '乙改', privateNote: 'keep-b' }])
  })
})
