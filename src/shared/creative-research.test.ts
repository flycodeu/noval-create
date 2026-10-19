import { describe, expect, it } from 'vitest'
import {
  buildCreativeResearchContext,
  creativeResearchTopics,
  getCreativeResearchSourceKey,
  isCreativeResearchEntry,
  normalizeCreativeResearchDraft,
  parseCreativeResearchEntries,
  preserveCreativeResearchEntriesWhenTrimming,
  selectRelevantCreativeResearchEntries,
  needsCreativeResearch,
  upsertCreativeResearchEntries,
} from './creative-research'

const daoismCard = {
  category: 'daoism',
  title: '不争作为权力约束',
  sourceTitle: '道家思想',
  tags: ['道教', '权力边界'],
  content: '人物拒绝垄断渡口的救命药，代价是失去军中晋升。',
  interpretation: '克制不是无欲，而是拒绝把他人困境换成自己的权力。',
  novelConnection: '在饥荒粮药分配上放弃短期胜利，留下后续政治代价。',
} as const

describe('author-created creative research', () => {
  it('recognizes Buddhist, folk-life and strange-tale research requests', () => {
    expect(needsCreativeResearch('补充佛教因果资料')).toBe(true)
    expect(needsCreativeResearch('增加中国古代志怪资料')).toBe(true)
    expect(creativeResearchTopics('民俗与民间生活')).toContain('民俗与生活')
    expect(creativeResearchTopics('聊斋式妖异传闻')).toContain('志怪与妖异')
  })

  it('normalizes concise cards and rejects unsafe or oversized input', () => {
    expect(normalizeCreativeResearchDraft(daoismCard)).toMatchObject({ title: daoismCard.title, tags: daoismCard.tags })
    expect(() => normalizeCreativeResearchDraft({ ...daoismCard, sourceUrl: 'https://user:secret@example.org/source' })).toThrow('无嵌入凭据')
    expect(() => normalizeCreativeResearchDraft({ ...daoismCard, content: '过长'.repeat(1001) })).toThrow('2000')
    expect(() => normalizeCreativeResearchDraft({ ...daoismCard, category: 'unknown' })).toThrow('分类')
  })

  it('creates stable reference-only records while preserving external provenance', () => {
    const existingSource = { sourceKey: 'web:verified', sourceType: 'web_search', factTitle: '宋代驿站', sourceText: '既有网页证据。' }
    const first = upsertCreativeResearchEntries(JSON.stringify([existingSource]), [daoismCard], '2026-10-19T00:00:00.000Z')
    const entries = parseCreativeResearchEntries(JSON.stringify(first))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ sourceType: 'author_created', assetType: 'creative_reference', canonDecision: 'reference_only', recordedAt: '2026-10-19T00:00:00.000Z' })
    expect(first).toEqual(expect.arrayContaining([existingSource]))
    expect(entries[0].sourceKey).toBe(getCreativeResearchSourceKey(daoismCard))
    expect(isCreativeResearchEntry(entries[0])).toBe(true)

    const updated = upsertCreativeResearchEntries(JSON.stringify(first), [{ ...daoismCard, content: '更新机制', sourceKey: entries[0].sourceKey }], '2026-10-20T00:00:00.000Z')
    const revised = parseCreativeResearchEntries(JSON.stringify(updated))[0]
    expect(revised).toMatchObject({ sourceKey: entries[0].sourceKey, recordedAt: entries[0].recordedAt, updatedAt: '2026-10-20T00:00:00.000Z', content: '更新机制' })
    expect(updated).toEqual(expect.arrayContaining([existingSource]))
  })

  it('refuses key collisions and duplicate records instead of overwriting another source', () => {
    const external = { sourceKey: 'author:claimed', sourceType: 'web_search', factTitle: '外部来源', sourceText: '保留。' }
    expect(() => upsertCreativeResearchEntries(JSON.stringify([external]), [{ ...daoismCard, sourceKey: 'author:claimed' }])).toThrow('不能覆盖')
    expect(() => upsertCreativeResearchEntries('[]', [daoismCard, daoismCard])).toThrow('重复')
  })

  it('selects relevant cards only, clips prompt fields, and preserves cards during ledger trimming', () => {
    const cards = parseCreativeResearchEntries(JSON.stringify(upsertCreativeResearchEntries('[]', [
      daoismCard,
      { ...daoismCard, title: '佛教因果与赎罪', category: 'buddhism', tags: ['佛教'], content: '寺院以赎罪名义接管灾民土地。' },
    ])))
    const selected = selectRelevantCreativeResearchEntries(cards, '渡口药材与军中晋升', 1)
    expect(selected).toHaveLength(1)
    expect(selected[0].title).toBe(daoismCard.title)
    expect(selectRelevantCreativeResearchEntries(cards, '完全无关的海上钟表', 3)).toEqual([])
    expect(String(buildCreativeResearchContext(cards[0]).usageBoundary)).toContain('不证明本书事实')

    const padded = Array.from({ length: 5 }, (_, index) => ({ sourceKey: `web:${index}`, sourceText: `source ${index}` }))
    const trimmed = preserveCreativeResearchEntriesWhenTrimming([...padded, cards[0]], 5)
    expect(trimmed).toHaveLength(5)
    expect(trimmed).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKey: cards[0].sourceKey })]))
  })

  it('matches Chinese topic requests to category aliases without requiring a matching title', () => {
    const cards = parseCreativeResearchEntries(JSON.stringify(upsertCreativeResearchEntries('[]', [{
      ...daoismCard,
      title: '斋醮与地方互助',
      sourceTitle: '',
      tags: [],
      content: '设坛如何组织灾后互助。',
      interpretation: '仪式关系也能承担地方治理。',
      novelConnection: '以客栈邻里往来牵出失踪者的线索。',
    }])))
    expect(selectRelevantCreativeResearchEntries(cards, '道教信仰', 1)).toHaveLength(1)
  })

  it('samples long Chinese requests across the full text and ignores generic category-only matches', () => {
    const cards = parseCreativeResearchEntries(JSON.stringify(upsertCreativeResearchEntries('[]', [
      { ...daoismCard, title: '民间生活与邻里互助', category: 'folk_life', tags: ['生活'], content: '客栈邻里在灾年互换粮食。' },
      { ...daoismCard, title: '佛教因果与赎罪', category: 'buddhism', tags: ['佛教'], content: '寺院要求灾民交出土地凭据。' },
    ])))
    expect(selectRelevantCreativeResearchEntries(cards, '生活', 3)).toEqual([])
    const longQuery = `${'主角沿河村查账，只想知道粮药去了哪里。'.repeat(40)} 佛教因果与赎罪如何影响寺院收留灾民的选择`
    expect(selectRelevantCreativeResearchEntries(cards, longQuery, 1).map(entry => entry.title)).toEqual(['佛教因果与赎罪'])
  })
})
