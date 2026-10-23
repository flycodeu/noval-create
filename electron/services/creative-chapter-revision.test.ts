import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertChapterRevisionBaseCurrent, captureChapterRevisionBase, chapterRevisionParagraphs, mergeChapterRevision,
  validateChapterRevision, type ChapterRevisionBase } from './creative-chapter-revision'
import type { CreativeWorkflowInput } from '../../src/shared/creative-workflow'

const state = vi.hoisted(() => ({ chapter: { id: 2, novelId: 1, chapterNum: 4, title: '旧标题', content: '  第一段。\r\n \t\r\n第二段。\r\n\r\n尾段。 ', summary: '旧摘要' }, artifacts: new Map<string, any>(), tasks: new Map<number, any>(), scenes: [{ id: 9, segmentId: 10 }], segments: [{ id: 10, content: '第二段。' }] }))
vi.mock('./chapter.service', () => ({ getChapter: () => state.chapter, listChapters: () => [state.chapter] }))
vi.mock('./task.service', () => ({ getTaskRecord: (id: number) => state.tasks.get(id) }))
vi.mock('./endgame-asset.service', () => ({ listSceneContracts: () => state.scenes }))
vi.mock('./story-structure.service', () => ({ listChapterSegments: () => state.segments }))
vi.mock('./artifact.service', () => ({ getArtifact: (id: string) => state.artifacts.get(id), requireArtifact: (id: string) => { if (!state.artifacts.has(id)) throw new Error('不存在'); return state.artifacts.get(id) }, hashArtifactContent: (value: unknown) => JSON.stringify(value) }))
const request: CreativeWorkflowInput = { novelId: 1, stage: 'chapter', atChapter: 4, request: '只修一段', chapterRevision: { target: 'paragraphs', paragraphIndexes: [2] }, idempotencyKey: 'patch-fixture' }
const save = (id: string, kind: string, content: unknown) => { const artifact = { id, novelId: 1, kind, content, contentHash: JSON.stringify(content) }; state.artifacts.set(id, artifact); return artifact }

describe('bounded chapter revision', () => {
  beforeEach(() => { state.artifacts.clear(); state.tasks.clear(); state.chapter.content = '  第一段。\r\n \t\r\n第二段。\r\n\r\n尾段。 '; state.chapter.summary = '旧摘要'; state.segments = [{ id: 10, content: '第二段。' }] })
  it('preserves every unselected character and CRLF separator', () => {
    expect(chapterRevisionParagraphs(state.chapter.content).map(row => row.text)).toEqual(['  第一段。', '第二段。', '尾段。 '])
    const base = captureChapterRevisionBase(request)
    const merged = mergeChapterRevision(base, { paragraphs: [{ index: 2, text: '第二段已修。' }] })
    expect(merged.content).toBe('  第一段。\r\n \t\r\n第二段已修。\r\n\r\n尾段。 ')
    expect(merged.title).toBe('旧标题'); expect(merged.summary).toBe('旧摘要')
  })
  it('allows only summary to change and rejects hidden prose or graph fields', () => {
    const base = captureChapterRevisionBase({ ...request, chapterRevision: { target: 'summary' } })
    expect(mergeChapterRevision(base, { summary: '短摘要' })).toEqual({ ...base.chapter, summary: '短摘要' })
    for (const patch of [{ summary: '短摘要', content: '暗改正文' }, { summary: '' }, { summary: '短摘要', changes: [] }]) expect(() => mergeChapterRevision(base, patch)).toThrow('summary')
  })
  it('rejects out-of-range, duplicate and paragraph-splitting output before review', () => {
    const base = captureChapterRevisionBase(request)
    for (const patch of [{ paragraphs: [{ index: 1, text: '越界' }] }, { paragraphs: [{ index: 2, text: 'a\n\nb' }] }, { paragraphs: [{ index: 2, text: 'a' }, { index: 2, text: 'b' }] }, { paragraphs: [{ index: 2, text: 'a' }], title: '新标题' }]) expect(() => mergeChapterRevision(base, patch)).toThrow()
    expect(() => captureChapterRevisionBase({ ...request, chapterRevision: { target: 'paragraphs', paragraphIndexes: [4] } })).toThrow('序号')
    expect(() => validateChapterRevision({ ...request, chapterRevision: { target: 'paragraphs', paragraphIndexes: [2, 2] } })).toThrow('重复')
  })
  it('resolves an existing scene only from a unique exact paragraph range', () => {
    expect(captureChapterRevisionBase({ ...request, chapterRevision: { target: 'scene', sceneId: 9 } }).revision).toEqual({ target: 'scene', sceneId: 9, paragraphIndexes: [2] })
    state.segments[0].content = '没有确切正文'
    expect(() => captureChapterRevisionBase({ ...request, chapterRevision: { target: 'scene', sceneId: 9 } })).toThrow('不会猜测')
  })
  it('materializes a chain of unapplied patches without adopting its source', () => {
    const original = save('source', 'generic_draft', { assetType: 'chapter', output: JSON.stringify({ chapterNum: 4, title: '候选标题', content: '候选首段。\n\n候选尾段。', summary: '候选摘要', changes: [], factReveals: [] }) })
    const base = captureChapterRevisionBase({ ...request, sourceArtifactId: original.id, chapterRevision: { target: 'summary' } })
    save('base', 'creative_chapter_revision_base', base)
    const patch = save('patch', 'generic_draft', { assetType: 'chapter', taskId: 30, output: JSON.stringify({ summary: '候选新摘要' }) })
    state.tasks.set(30, { parentTaskId: 31 }); state.tasks.set(31, { novelId: 1, relatedEntityType: 'creative_workflow', inputJson: JSON.stringify({ chapterRevisionBaseArtifactId: 'base' }) })
    const second = captureChapterRevisionBase({ ...request, sourceArtifactId: patch.id, chapterRevision: { target: 'paragraphs', paragraphIndexes: [1] } })
    expect(second.chapter.summary).toBe('候选新摘要'); expect(second.chapter.title).toBe('候选标题')
    expect(mergeChapterRevision(second, { paragraphs: [{ index: 1, text: '修首段。' }] }).content).toBe('修首段。\n\n候选尾段。')
    expect(state.chapter.content).not.toContain('候选')
  })
  it('rejects formal edits or candidate hash changes at apply time', () => {
    const base = captureChapterRevisionBase(request)
    expect(() => assertChapterRevisionBaseCurrent(request, base)).not.toThrow()
    state.chapter.summary = '作者新摘要'
    expect(() => assertChapterRevisionBaseCurrent(request, base)).toThrow('正式章')
    state.chapter.summary = '旧摘要'
    const source = save('source', 'generic_draft', { assetType: 'chapter', output: JSON.stringify(base.chapter) })
    const fromSource = captureChapterRevisionBase({ ...request, sourceArtifactId: source.id })
    ;(source.content as { output: string }).output = '被篡改'
    expect(() => assertChapterRevisionBaseCurrent(request, fromSource as ChapterRevisionBase)).toThrow('候选基线')
  })
})
