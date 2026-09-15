import { describe, expect, it } from 'vitest'
import {
  appendReaderFeedbackSettings,
  createReaderFeedbackSourceRef,
  parseReaderFeedbackSettings,
  preserveReaderFeedbackSettings,
  resolveReaderFeedbackForContext,
  revokeReaderFeedbackSettings,
  type ReaderFeedbackItem,
  type ReaderFeedbackScope,
  type ReaderFeedbackSentiment,
} from './reader-feedback'
import { buildSceneWritingBrief, formatAuthorStyleReference } from './scene-writing-brief'

const sourceText = '沈宁望着门闩，直接说出自己的判断。'
const source = createReaderFeedbackSourceRef(sourceText, 11, 0, sourceText.length)

function item(input: {
  id: string
  scope: ReaderFeedbackScope
  note: string
  topic: string
  sentiment: ReaderFeedbackSentiment
  sourceRef?: typeof source
}): ReaderFeedbackItem {
  return {
    id: input.id,
    novelId: 7,
    source: input.sourceRef || source,
    note: input.note,
    topic: input.topic,
    sentiment: input.sentiment,
    scope: input.scope,
    status: 'approved',
    version: 1,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  }
}

describe('RF-12 reader feedback selection and settings', () => {
  it('RF-12-01 limits character feedback to scenes containing that character', () => {
    const settings = { schemaVersion: 1 as const, revision: 2, items: [
      item({ id: 'shen', scope: { type: 'character', characterId: 1, characterName: '沈宁' }, topic: '对白直率度', note: '说得太直接，给她留一点回避。', sentiment: 'reduce' }),
      item({ id: 'zhao', scope: { type: 'character', characterId: 2, characterName: '赵安' }, topic: '对白直率度', note: '保留赵安的直说。', sentiment: 'keep' }),
    ] }
    const resolved = resolveReaderFeedbackForContext(settings, {
      novelId: 7,
      chapterId: 12,
      characterIds: [1],
      characterNames: ['沈宁'],
      sourceContentsByChapterId: { 11: sourceText },
    })
    expect(resolved.selected.map((entry) => entry.id)).toEqual(['shen'])
    expect(resolved.states).toContainEqual({ id: 'zhao', state: 'out_of_scope' })
  })

  it('RF-12-02 keeps compatible scene feedback as two scoped preferences', () => {
    const resolved = resolveReaderFeedbackForContext({ schemaVersion: 1, revision: 2, items: [
      item({ id: 'inner', scope: { type: 'scene', sceneOrder: 1 }, topic: '直接心理', note: '保留这段直接心理活动。', sentiment: 'keep' }),
      item({ id: 'explain', scope: { type: 'scene', sceneOrder: 1 }, topic: '解释密度', note: '减少已经能从动作读出的解释。', sentiment: 'reduce' }),
    ] }, { novelId: 7, chapterId: 11, sceneOrders: [1], sourceContentsByChapterId: { 11: sourceText } })
    const text = formatAuthorStyleReference(buildSceneWritingBrief(null, {
      targetWorkSampleGuide: '',
      humanStyleSampleLock: '',
      readerFeedback: resolved,
    }))
    expect(text).toContain('保留｜来源章节 11 / 场景 1｜直接心理')
    expect(text).toContain('减少｜来源章节 11 / 场景 1｜解释密度')
    expect(text).not.toContain('禁止心理')
    expect(resolved.conflicts).toEqual([])
  })

  it('RF-12-03 omits revoked, edited, and deleted sources while exposing their state', () => {
    const changedSource = createReaderFeedbackSourceRef('另一段来源', 12, 0, 5)
    const deletedSource = createReaderFeedbackSourceRef('已删除来源', 13, 0, 5)
    let raw = appendReaderFeedbackSettings('{}', 0,
      item({ id: 'revoked', scope: { type: 'book' }, topic: '解释', note: '减少解释。', sentiment: 'reduce' })).settingsJson
    raw = appendReaderFeedbackSettings(raw, 1,
      item({ id: 'changed', scope: { type: 'book' }, topic: '动作', note: '保留动作。', sentiment: 'keep', sourceRef: changedSource })).settingsJson
    raw = appendReaderFeedbackSettings(raw, 2,
      item({ id: 'deleted', scope: { type: 'book' }, topic: '对白', note: '保留对白。', sentiment: 'keep', sourceRef: deletedSource })).settingsJson
    raw = revokeReaderFeedbackSettings(raw, { id: 'revoked', expectedRevision: 3, revokedAt: '2026-09-15T01:00:00.000Z' }).settingsJson
    const resolved = resolveReaderFeedbackForContext(parseReaderFeedbackSettings(raw), {
      novelId: 7,
      chapterId: 14,
      sourceContentsByChapterId: { 11: sourceText, 12: '来源已经改变' },
    })
    expect(resolved.selected).toEqual([])
    expect(resolved.states).toEqual([
      { id: 'revoked', state: 'revoked' },
      { id: 'changed', state: 'source_changed' },
      { id: 'deleted', state: 'source_deleted' },
    ])
  })

  it('RF-12-04 deduplicates retries, preserves unrelated settings, and exposes true conflicts', () => {
    const original = JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 4 }, modelChoice: 'alpha' })
    const first = appendReaderFeedbackSettings(original, 0,
      item({ id: 'first', scope: { type: 'book' }, topic: '解释密度', note: '减少解释。', sentiment: 'reduce' }))
    const retry = appendReaderFeedbackSettings(first.settingsJson, 0,
      item({ id: 'retry-id', scope: { type: 'book' }, topic: '解释密度', note: '减少解释。', sentiment: 'reduce' }))
    expect(retry.changed).toBe(false)
    expect(retry.feedback.items).toHaveLength(1)

    const protectedSettings = preserveReaderFeedbackSettings(first.settingsJson,
      JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 5 }, modelChoice: 'beta' }))
    expect(parseReaderFeedbackSettings(protectedSettings).items).toHaveLength(1)
    expect(JSON.parse(protectedSettings).modelChoice).toBe('beta')

    const opposing = appendReaderFeedbackSettings(first.settingsJson, 1,
      item({ id: 'opposing', scope: { type: 'book' }, topic: '解释密度', note: '保留必要解释。', sentiment: 'keep' }))
    const resolved = resolveReaderFeedbackForContext({ ...opposing.feedback, items: [
      ...opposing.feedback.items,
      { ...opposing.feedback.items[0], id: 'historical-duplicate' },
    ] }, {
      novelId: 7,
      chapterId: 12,
      sourceContentsByChapterId: { 11: sourceText },
    })
    expect(resolved.selected).toHaveLength(2)
    expect(resolved.conflicts).toHaveLength(1)
    expect(resolved.states).toContainEqual({ id: 'historical-duplicate', state: 'duplicate' })
    expect(() => appendReaderFeedbackSettings(opposing.settingsJson, 1,
      item({ id: 'stale', scope: { type: 'book' }, topic: '句长', note: '缩短句子。', sentiment: 'reduce' })))
      .toThrow('作者反馈版本已变化')
  })
})
