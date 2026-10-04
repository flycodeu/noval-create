import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { changedFields, mergeCanonicalDocument } from './content-document'
import { ContentDocument, DocumentEditor } from './ContentDocument'
import { documentReferenceLabel, documentReferenceOptions, loadDocumentNames } from './document-references'

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
  it('translates structured choices without replacing the same words in prose', () => {
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: { ending_mode: 'costly_victory', endingStyle: 'aftershock', expositionMode: 'embedded_action', content: 'costly_victory', writingContractTags: ['realism'], status: 'ready' } }))
    expect(html).toContain('付出代价的胜利')
    expect(html).toContain('余波未平')
    expect(html).toContain('动作带出')
    expect(html).toContain('写实')
    expect(html).toContain('已就绪')
    expect(html.match(/costly_victory/g)).toHaveLength(1)
  })
  it('translates chapter placement and quality report fields seen in version comparisons', () => {
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: {
      volumeId: 148, partId: 162, targetWords: 3200, checks: [{ status: 'pass', message: '字段完整' }],
      modelReview: { stage: 'accepted', review: { humanLanguageRepairs: ['删去重复对白'], languageRisks: ['形容重复'], rejectRequired: false, rewriteRequired: true, severity: 'low', topFixes: ['收紧结尾'] } },
    } }))
    for (const text of ['所属卷', '所属单元', '目标字数', '通过', '审校结果', '已通过', '表达修改建议', '语言风险', '需要退回', '需要修订', '严重程度', '低', '优先修改建议']) expect(html).toContain(text)
    for (const text of ['volumeId', 'partId', 'targetWords', 'humanLanguageRepairs', 'languageRisks', 'rejectRequired', 'rewriteRequired', 'topFixes', '>pass<', '>low<', '资料类别']) expect(html).not.toContain(text)
    const assetStage = renderToStaticMarkup(React.createElement(ContentDocument, { value: { stage: 'outline' } }))
    expect(assetStage).toContain('资料类别')
    expect(assetStage).toContain('卷章大纲')
    expect(assetStage).not.toContain('审校结果')
  })
  it('resolves structured references by type and retains full reveal instructions', () => {
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: { revealPayload: ['fact:28', '#29', '看见门锁后只能提出怀疑'], requiredForeshadowIds: [28], allowedFactIds: [28], characterIds: ['character:28'], knownChapterId: 28 }, names: { 'fact:28': '失踪者的去处', 'foreshadow:28': '桌上的旧钥匙', 'character:28': '陆闻', 'chapter:28': '第 4 章 · 干处走不得' } }))
    for (const text of ['失踪者的去处', '桌上的旧钥匙', '陆闻', '第 4 章 · 干处走不得', '看见门锁后只能提出怀疑', '关联信息点不可用']) expect(html).toContain(text)
    for (const text of ['fact:28', '#29', 'requiredForeshadowIds', 'character:28']) expect(html).not.toContain(text)
  })
  it('does not pile up placeholders for optional empty reference lists', () => {
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: { chapterGoal: '找到钥匙', requiredForeshadowIds: [], requiredCharacterArcIds: [], allowedFactIdsJson: '[]' }, showEmpty: true }))
    expect(html).toContain('找到钥匙')
    expect(html).not.toContain('尚未补充')
    expect(html).not.toContain('必须处理的伏笔')
    const empty = renderToStaticMarkup(React.createElement(ContentDocument, { value: { schemaVersion: 1, nested: { note: '' }, requiredForeshadowIds: [] } }))
    expect(empty.match(/尚未补充/g)).toHaveLength(1)
  })
  it('edits a known ending as a Chinese choice and preserves its saved code', () => {
    const changed = vi.fn()
    const editor = DocumentEditor({ value: 'costly_victory', fieldKey: 'endingMode', onChange: changed })
    expect(editor.props.options).toContainEqual({ value: 'costly_victory', label: '付出代价的胜利' })
    editor.props.onChange('hard_won')
    expect(changed).toHaveBeenCalledWith('hard_won')
    const prose = DocumentEditor({ value: '陆闻', fieldKey: 'pov', onChange: changed })
    expect(prose.props.value).toBe('陆闻')
    expect(prose.props.options).toBeUndefined()
  })
  it('edits linked requirements with names while keeping numeric IDs and unavailable selections', () => {
    const changed = vi.fn()
    const editor = DocumentEditor({ value: [28, 99], fieldKey: 'requiredForeshadowIds', names: { 'fact:28': '不应选入的信息点', 'foreshadow:28': '旧钥匙', 'foreshadow:29': '脚印' }, onChange: changed })
    expect(editor.props.options).toEqual([{ value: 28, label: '旧钥匙' }, { value: 29, label: '脚印' }, { value: 99, label: '关联伏笔不可用' }])
    editor.props.onChange([29])
    expect(changed).toHaveBeenCalledWith([29])
  })
  it('keeps field context when presenting a version difference', () => {
    expect(changedFields({ endingMode: 'open' }, { endingMode: 'costly_victory' })[0].fieldKey).toBe('endingMode')
  })
  it('keeps native character numbers distinct from atlas UUIDs and graph selections', () => {
    const names = { 'character:abc-def': '新图谱人物', 'nativeCharacter:41': '新图谱人物', 'character:28': '迁移人物', 'nativeCharacter:28': '迁移人物' }
    const native = documentReferenceOptions('characterId', names, [41])
    expect(native).toEqual([{ value: 41, label: '新图谱人物' }, { value: 28, label: '迁移人物' }])
    expect(native.every(option => typeof option.value === 'number' && Number.isFinite(option.value))).toBe(true)
    expect(documentReferenceLabel('characterId', 41, names)).toBe('新图谱人物')
    expect(documentReferenceOptions('knownFromStartCharacterIds', names, [])).toEqual([{ value: 'character:abc-def', label: '新图谱人物' }, { value: 'character:28', label: '迁移人物' }])
    expect(documentReferenceOptions('characterIds', names, ['character:abc-def'])).toEqual([{ value: 'character:abc-def', label: '新图谱人物' }, { value: 'character:28', label: '迁移人物' }])
    expect(documentReferenceOptions('requiredAssetRefs', names, []).some(option => String(option.value).startsWith('nativeCharacter:'))).toBe(false)
  })
  it('never converts UUIDs to numeric options when native lookup is unavailable', () => {
    expect(documentReferenceOptions('characterId', { 'character:abc-def': '新人物' }, [41])).toEqual([{ value: 41, label: '关联人物不可用' }])
    expect(documentReferenceOptions('revealPayload', { 'fact:28': '旧案真相', 'character:abc-def': '人物' }, [])).toEqual([{ value: 'fact:28', label: '旧案真相' }])
  })
})

describe('document reference lookup', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('loads actual names from the selected project without numeric collisions', async () => {
    const query = vi.fn().mockResolvedValue({ entities: [{ id: 'character:28', name: '陆闻' }] })
    const facts = vi.fn().mockResolvedValue([{ id: 28, title: '真实身份' }])
    const foreshadows = vi.fn().mockResolvedValue([{ id: 28, title: '一盏旧灯' }])
    const chapters = vi.fn().mockResolvedValue([{ id: 28, chapterNum: 3, title: '灯下' }])
    const empty = vi.fn().mockResolvedValue([])
    vi.stubGlobal('window', { electron: { storyAtlas: { query }, character: { list: async () => [{ id: 41, fullName: '新图谱人物' }] }, storyFact: { list: facts }, foreshadow: { listLedger: foreshadows }, chapter: { list: chapters }, thread: { list: empty }, characterArc: { listCharacterArcs: empty, listRelationshipArcs: empty }, resistance: { listTracks: empty }, endgameAsset: { listCommitments: empty } } })
    expect(await loadDocumentNames(292)).toEqual({ 'character:28': '陆闻', 'fact:28': '真实身份', 'foreshadow:28': '一盏旧灯', 'chapter:28': '第 3 章 · 灯下', 'nativeCharacter:41': '新图谱人物' })
    expect(query).toHaveBeenCalledWith({ novelId: 292, includePlanned: true })
    for (const request of [facts, chapters, empty]) expect(request).toHaveBeenCalledWith(292)
    expect(foreshadows).toHaveBeenCalledWith(292, { readOnly: true })
    expect(window.electron.endgameAsset.listCommitments).toHaveBeenCalledWith(292, { readOnly: true })
  })
  it('returns available names and reports failed sources without rejecting the page load', async () => {
    const empty = vi.fn().mockResolvedValue([])
    const failed = vi.fn().mockRejectedValue(new Error('query failed'))
    vi.stubGlobal('window', { electron: { storyAtlas: { query: async () => ({ entities: [{ id: 'character:28', name: '陆闻' }] }) }, character: { list: empty }, storyFact: { list: async () => [{ id: 28, title: '真实身份' }] }, foreshadow: { listLedger: failed }, chapter: { list: empty }, thread: { list: empty }, characterArc: { listCharacterArcs: empty, listRelationshipArcs: empty }, resistance: { listTracks: empty }, endgameAsset: { listCommitments: failed } } })
    const report = vi.fn()
    const [primary, names] = await Promise.all([Promise.resolve({ chapterGoal: '找出钥匙的主人' }), loadDocumentNames(292, report)])
    expect(primary.chapterGoal).toBe('找出钥匙的主人')
    expect(names).toEqual({ 'character:28': '陆闻', 'fact:28': '真实身份' })
    expect(report).toHaveBeenCalledWith('伏笔、结局承诺的关联名称读取失败，请重试。')
  })
})
