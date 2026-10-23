import { describe, expect, it } from 'vitest'
import { classifyCreativeResearchLedgerChange } from './creative-research-change'
import { upsertCreativeResearchEntries } from './creative-research'

const draft = { category: 'humanity', title: '自愿与代价', content: '每个人有自己的选择。', interpretation: '不能替别人同意。', novelConnection: '同行者可拒绝借力。' }
const [author] = upsertCreativeResearchEntries('[]', [draft], '2026-10-20T00:00:00.000Z')
const web = { sourceKey: 'web:one', assetType: 'external_web', sourceType: 'web_search', factTitle: '原典', sourceText: '公开参考摘要', sourceUrl: 'https://example.org/source', query: '道教', provider: 'fixture', recordedAt: '2026-10-20T00:00:00.000Z', verificationStatus: 'web_found', canonDecision: 'reference_only' }
const classify = (before: unknown[], after: unknown[]) => classifyCreativeResearchLedgerChange(JSON.stringify(before), JSON.stringify(after))

describe('creative research dependency classification', () => {
  it('allows known author and web reference additions, edits and deletions with untouched provenance', () => {
    const evidence = [{ sourceKey: 'chapter:old', supportingDiffIds: [1], sourceText: '正文证据' }, { sourceText: '无编号旧来源' }]
    expect(classify(evidence, [...evidence, author, web])).toBe('references_only')
    const [edited] = upsertCreativeResearchEntries(JSON.stringify([author]), [{ ...draft, sourceKey: author.sourceKey, content: '新观点' }])
    expect(classify([...evidence, author, web], [...evidence, edited, { ...web, sourceText: '新摘要', researchTopics: ['道教'], researchRequestKeys: ['request'] }])).toBe('references_only')
    expect(classify([...evidence, author, web], evidence)).toBe('references_only')
  })

  it.each([
    { canonDecision: 'accepted' }, { verificationStatus: 'rejected' }, { supportingDiffIds: [] },
    { supportingDiffIds: [8] }, { runId: 4 }, { unknownMetadata: '必须保守' }, { recordedAt: 'invalid' },
    { sourceUrl: 'javascript:alert(1)' },
  ])('retains global dependencies for adopted, audited, unknown or invalid web data: %s', patch => {
    expect(classify([web], [{ ...web, ...patch }])).toBe('context')
    const protectedWeb = { ...web, ...patch }
    expect(classify([protectedWeb], [{ ...protectedWeb, sourceText: '变动' }])).toBe('context')
  })

  it('protects author adoption and extra metadata, and detects changes to other ledger records', () => {
    for (const patch of [{ canonDecision: 'accepted' }, { supportingDiffIds: [1] }, { editorMetadata: true }, { updatedAt: 3 }]) {
      expect(classify([author], [{ ...author, ...patch }])).toBe('context')
    }
    expect(classify([author, { sourceKey: 'chapter:1', content: '原证据' }], [author, { sourceKey: 'chapter:1', content: '被改写' }])).toBe('context')
  })

  it('does not classify malformed, primitive, non-array or duplicated ledgers as reference-only', () => {
    for (const raw of ['{', '{}', '[null]', '[3]', JSON.stringify([author, author])]) {
      expect(classifyCreativeResearchLedgerChange(raw, JSON.stringify([author]))).toBe('context')
    }
  })

  it('recognizes identical JSON values without relying on formatting or object field order', () => {
    expect(classifyCreativeResearchLedgerChange('[]', ' [ ] ')).toBe('unchanged')
    expect(classifyCreativeResearchLedgerChange(JSON.stringify([web]), JSON.stringify([Object.fromEntries(Object.entries(web).reverse())], null, 2))).toBe('unchanged')
    expect(classifyCreativeResearchLedgerChange('broken', 'broken')).toBe('context')
  })
})
