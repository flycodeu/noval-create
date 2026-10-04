import { describe, expect, it, vi } from 'vitest'
import { assertCreativeChangeScope, validateCreativeChangeScope } from './creative-change-scope'
import type { CreativeChangeScope, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasValidationResult } from '../../src/shared/story-atlas'

vi.mock('./chapter.service', () => ({ listChapters: () => [{ id: 4, chapterNum: 4, title: '夜试', outline: '只验证已有湿痕', volumeId: 11, partId: 12, targetWords: 3200, allowedFactIdsJson: '[28,29]', revealedFactIdsJson: '[]' }] }))

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
  it('enforces a prose-only scope against both new and existing atlas mutations', () => {
    const request = { ...input({ existingEntityIds: [], existingRelationIds: [], newEntityCount: 0, allowNewRelations: false }), stage: 'chapter' as const }
    expect(() => assertCreativeChangeScope(request, { changes: [] })).not.toThrow()
    expect(() => assertCreativeChangeScope(request, { changes }, resolved())).toThrow('须新增 0 项')
    expect(() => assertCreativeChangeScope(request, { changes }, resolved(false))).toThrow('超出')
    const relation = { changes: [{ op: 'upsert_relation', kind: 'ownership', fromId: 'character:1', toId: 'item:1' }] }
    for (const isNew of [true, false]) {
      expect(() => assertCreativeChangeScope(request, relation, { ...resolved(), resolvedChanges: [{ index: 0, id: 'ownership:1', isNew }] })).toThrow(/新增关系|超出/)
    }
  })
  it('limits outline edits to existing chapter IDs and forbids volumes and new chapters', () => {
    const request = { ...input({ chapterIds: [4] }), stage: 'outline' as const }
    expect(() => assertCreativeChangeScope(request, { chapters: [{ id: 4 }] })).not.toThrow()
    for (const data of [{ chapters: [{ id: 3 }] }, { chapters: [{}] }, { chapters: [{ id: 4 }], volumes: [{}] }]) {
      expect(() => assertCreativeChangeScope(request, data)).toThrow(/超出|不能修改卷/u)
    }
  })
  it('locks the saved title and outline during chapter preparation, even after model review', () => {
    const request = { ...input({ chapterIds: [4], preserveChapterFields: ['title', 'outline'] }), stage: 'outline' as const }
    const original = { id: 4, title: '夜试', outline: '只验证已有湿痕' }
    expect(() => assertCreativeChangeScope(request, { chapters: [original] })).not.toThrow()
    expect(() => assertCreativeChangeScope(request, { chapters: [{ ...original, outline: '干断已证实有效' }] })).toThrow('原大纲必须保持不变')
    expect(() => assertCreativeChangeScope(request, { chapters: [{ ...original, title: '已破案' }] })).toThrow('标题必须保持不变')
    expect(() => validateCreativeChangeScope(input({ preserveChapterFields: ['outline'] }))).toThrow('必须指定章节')
    expect(() => validateCreativeChangeScope(input({ chapterIds: [4], preserveChapterFields: ['outline', 'outline'] }))).toThrow('字段不得重复')
  })
  it('prevents a reviewed scene plan from silently moving the chapter or changing its fact boundary', () => {
    const request = { ...input({ chapterIds: [4], preserveChapterFields: ['title', 'outline', 'volumeId', 'partId', 'targetWords', 'allowedFactIds', 'revealedFactIds'] }), stage: 'outline' as const }
    const base = { id: 4, title: '夜试', outline: '只验证已有湿痕', volumeId: 11, partId: 12, targetWords: 3200, allowedFactIds: [28, 29], revealedFactIds: [] }
    expect(() => assertCreativeChangeScope(request, { chapters: [base] })).not.toThrow()
    for (const [field, changed] of [
      ['volumeId', 14], ['partId', 15], ['targetWords', 3800], ['allowedFactIds', [28, 29, 30]], ['revealedFactIds', [30]],
    ] as const) {
      expect(() => assertCreativeChangeScope(request, { chapters: [{ ...base, [field]: changed }] })).toThrow('必须保持不变')
    }
    expect(() => assertCreativeChangeScope(request, { chapters: [{ id: 4, title: base.title, outline: base.outline }] })).not.toThrow()
  })
  it('rejects malformed, duplicate and stage-inapplicable constraints before generation', () => {
    for (const value of [{}, { newEntityCount: -1 }, { newEntityCount: 1.5 }, { existingEntityIds: ['same', 'same'] }, { existingEntityIds: [' padded '] }, { chapterIds: [4] }, { unknown: true }]) {
      expect(() => validateCreativeChangeScope(input(value as CreativeChangeScope))).toThrow()
    }
    expect(() => validateCreativeChangeScope({ ...input(scope), stage: 'background' })).toThrow('当前阶段不支持')
  })
})
