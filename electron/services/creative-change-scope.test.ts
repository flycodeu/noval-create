import { describe, expect, it } from 'vitest'
import { assertCreativeChangeScope, validateCreativeChangeScope } from './creative-change-scope'
import type { CreativeChangeScope, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasValidationResult } from '../../src/shared/story-atlas'

const input = (changeScope?: CreativeChangeScope): CreativeWorkflowInput => ({ novelId: 1, stage: 'items', request: '整理两件已有实物', count: 2, idempotencyKey: 'fixture-scope', changeScope })
const changes = [
  { op: 'upsert_entity', kind: 'item', clientId: 'lamp', name: '旧铜灯' },
  { op: 'upsert_entity', kind: 'item', clientId: 'notebook', name: '薄册' },
]
const resolved = (isNew = true): StoryAtlasValidationResult => ({ valid: true, novelId: 1, contextVersion: 1, diagnostics: [], resolvedChanges: changes.map((_, index) => ({ index, id: `item:${index}`, isNew })) })
const scope: CreativeChangeScope = { existingEntityIds: [], existingRelationIds: [], newEntityCount: 2, allowNewRelations: false }
describe('creative save scope', () => {
  it('accepts the exact number of genuinely new records', () => {
    expect(() => assertCreativeChangeScope(input(scope), { changes }, resolved())).not.toThrow()
  })
  it('rejects too few or too many new records', () => {
    for (const count of [1, 3]) expect(() => assertCreativeChangeScope(input({ ...scope, newEntityCount: count }), { changes }, resolved())).toThrow('实际新增 2 项')
  })
  it('rejects a clientId that resolves to an existing object outside the whitelist', () => {
    expect(() => assertCreativeChangeScope(input(scope), { changes }, resolved(false))).toThrow('item:0 超出')
    expect(() => assertCreativeChangeScope(input({ existingEntityIds: ['item:0', 'item:1'], newEntityCount: 0 }), { changes }, resolved(false))).not.toThrow()
  })
  it('checks existing and new relations independently of new entity count', () => {
    const data = { changes: [{ op: 'upsert_relation', kind: 'ownership', clientId: 'bond', fromId: 'character:1', toId: 'item:1' }] }
    const resolution = { ...resolved(), resolvedChanges: [{ index: 0, id: 'ownership:1', isNew: true }] }
    expect(() => assertCreativeChangeScope(input({ allowNewRelations: false }), data, resolution)).toThrow('不允许新增关系')
    resolution.resolvedChanges[0].isNew = false
    expect(() => assertCreativeChangeScope(input({ existingRelationIds: [] }), data, resolution)).toThrow('ownership:1 超出')
    expect(() => assertCreativeChangeScope(input({ existingRelationIds: ['ownership:1'], allowNewRelations: false }), data, resolution)).not.toThrow()
  })
  it('does not reinterpret the planning count as a save restriction for general batches', () => {
    expect(() => assertCreativeChangeScope(input(), { changes: [...changes, {}] })).not.toThrow()
  })
  it('requires complete resolved identities before checking asset changes', () => {
    expect(() => assertCreativeChangeScope(input(scope), { changes })).toThrow('缺少完整')
  })
  it('limits outline edits to existing chapter IDs and forbids volumes and new chapters', () => {
    const request = { ...input({ chapterIds: [4] }), stage: 'outline' as const }
    expect(() => assertCreativeChangeScope(request, { chapters: [{ id: 4 }] })).not.toThrow()
    for (const data of [{ chapters: [{ id: 3 }] }, { chapters: [{}] }, { chapters: [{ id: 4 }], volumes: [{}] }]) {
      expect(() => assertCreativeChangeScope(request, data)).toThrow(/超出|不能修改卷/u)
    }
  })
  it('rejects malformed, duplicate and stage-inapplicable constraints before generation', () => {
    for (const value of [{}, { newEntityCount: -1 }, { newEntityCount: 1.5 }, { existingEntityIds: ['same', 'same'] }, { existingEntityIds: [' padded '] }, { chapterIds: [4] }, { unknown: true }]) {
      expect(() => validateCreativeChangeScope(input(value as CreativeChangeScope))).toThrow()
    }
    expect(() => validateCreativeChangeScope({ ...input(scope), stage: 'chapter' })).toThrow('当前阶段不支持')
  })
})
