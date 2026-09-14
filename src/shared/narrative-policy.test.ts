import { describe, expect, it } from 'vitest'
import { compileContextPack, deserializeContextPack, serializeContextPack } from './context-pack'
import { assertNarrativeResumeIdentity, buildNarrativeInputIdentity, mergeNarrativePolicySettings, narrativeRequestIdentity, resolveNarrativePolicy } from './narrative-policy'

const configured = JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 1 } })
const identity = () => buildNarrativeInputIdentity({ policy: resolveNarrativePolicy(configured, true), styleSource: 'author sample', inputSource: 'known context', models: 'model A', overrides: 'literal {value}', compilerMode: 'legacy' })

describe('RF-05 policy and immutable input identity', () => {
  it('keeps absent, unknown and unavailable policies explicitly on legacy', () => {
    expect(resolveNarrativePolicy().policyVersion).toBe('legacy')
    expect(resolveNarrativePolicy('{"readerFirst":{"schemaVersion":99}}', true).diagnostics).toContain('unknown_or_invalid_readerFirst_config')
    expect(resolveNarrativePolicy(configured).diagnostics).toContain('reader_first_implementation_unavailable')
    expect(resolveNarrativePolicy(configured, true).policyVersion).toBe('reader-first-v1')
  })
  it('rejects changed policy, source, model, override and Planner identity on recovery', () => {
    const saved = identity()
    expect(() => assertNarrativeResumeIdentity(saved, identity())).not.toThrow()
    for (const key of ['policyRevision', 'styleSourceDigest', 'inputSourceDigest', 'modelDigest', 'overrideDigest', 'compilerMode'] as const) {
      expect(() => assertNarrativeResumeIdentity(saved, { ...saved, [key]: 'changed' })).toThrow('不能混用旧稿恢复')
    }
    expect(() => assertNarrativeResumeIdentity({ ...saved, scenePlanDigest: 'old' }, { ...saved, scenePlanDigest: 'new' })).toThrow('不能混用旧稿恢复')
    expect(() => assertNarrativeResumeIdentity(undefined, saved)).toThrow('从 Planner 新建任务')
    expect(narrativeRequestIdentity({ ...saved, scenePlanDigest: 'Planner checkpoint' })).toBe(narrativeRequestIdentity(saved))
  })
  it('merges policy updates without losing settings and rejects stale revisions', () => {
    const current = JSON.stringify({ ...JSON.parse(configured), other: { keep: 7 } })
    const next = mergeNarrativePolicySettings(current, '{"readerFirst":{"schemaVersion":1,"policyVersion":"legacy","revision":2}}')
    expect(JSON.parse(next).other).toEqual({ keep: 7 })
    expect(resolveNarrativePolicy(next, true).policyVersion).toBe('legacy')
    expect(JSON.parse(mergeNarrativePolicySettings(next, '{"more":8}')).readerFirst.revision).toBe(2)
    expect(() => mergeNarrativePolicySettings(next, configured)).toThrow('请刷新设置')
  })
  it('serializes the same policy identity in chapter and null-chapter planning context packs', async () => {
    for (const stage of ['planning', 'draft'] as const) {
      const result = await compileContextPack({ novelId: 1, ...(stage === 'draft' ? { chapterId: 2, chapterNum: 1 } : {}), stage, contextVersion: 1, sources: [], narrativeIdentity: identity() })
      expect(deserializeContextPack(serializeContextPack(result.pack))?.narrativeIdentity).toEqual(identity())
      const changed = await compileContextPack({ novelId: 1, ...(stage === 'draft' ? { chapterId: 2, chapterNum: 1 } : {}), stage, contextVersion: 1, sources: [], narrativeIdentity: { ...identity(), styleSourceDigest: 'changed' } })
      expect(changed.pack.id).not.toBe(result.pack.id)
    }
  })
})
