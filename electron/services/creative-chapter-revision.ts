import type { CreativeChapterRevision, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { CREATIVE_CHAPTER_REVISION_SCHEMA } from '../../src/shared/creative-workflow'
export { PROSE_ONLY_CHANGE_SCOPE } from '../../src/shared/creative-workflow'
import type { GenericAssetDraftContent } from '../../src/shared/generic-asset-workflow'
import { validateJsonSchema } from '../../src/shared/tool-contracts'
import { getChapter, listChapters } from './chapter.service'
import { getTaskRecord } from './task.service'
import { listSceneContracts } from './endgame-asset.service'
import { listChapterSegments } from './story-structure.service'
import { getArtifact, hashArtifactContent, requireArtifact } from './artifact.service'
import { chapterRevisionParagraphs } from '../../src/shared/chapter-revision'
export { chapterRevisionParagraphs } from '../../src/shared/chapter-revision'

export interface ChapterRevisionBase {
  schemaVersion: 'creative-chapter-revision-base-v1'
  chapterId: number
  chapterNum: number
  formalHash: string
  sourceArtifactId?: string
  sourceContentHash?: string
  chapter: { chapterNum: number; title: string; content: string; summary: string; changes: unknown[]; factReveals: unknown[] }
  revision: CreativeChapterRevision
}

function formalHash(chapter: { title?: string | null; content?: string | null; summary?: string | null }) {
  return hashArtifactContent({ title: chapter.title || '', content: chapter.content || '', summary: chapter.summary || '' })
}
export function validateChapterRevision(input: CreativeWorkflowInput): void {
  if (!input.chapterRevision) return
  if (input.stage !== 'chapter' || input.operation === 'review') throw new Error('局部修订仅用于正文生成阶段。')
  const result = validateJsonSchema(input.chapterRevision, CREATIVE_CHAPTER_REVISION_SCHEMA)
  if (!result.valid) throw new Error(`局部修订范围无效：${result.issues.join('；')}`)
  const indexes = input.chapterRevision.target === 'summary' ? undefined : input.chapterRevision.paragraphIndexes
  if (indexes && new Set(indexes).size !== indexes.length) throw new Error('修订段落序号不能重复。')
}
export function readChapterRevisionBase(artifactId: string): ChapterRevisionBase {
  const artifact = requireArtifact<ChapterRevisionBase>(artifactId)
  if (artifact.kind !== 'creative_chapter_revision_base' || artifact.content.schemaVersion !== 'creative-chapter-revision-base-v1'
    || artifact.contentHash !== hashArtifactContent(artifact.content)) throw new Error('局部修订基线无效，请重新选择正式章或候选。')
  return artifact.content
}
function sourceChapter(input: CreativeWorkflowInput, chapter: NonNullable<ReturnType<typeof getChapter>>) {
  if (!input.sourceArtifactId) return { chapterNum: chapter.chapterNum, title: chapter.title || '', content: chapter.content || '', summary: chapter.summary || '', changes: [], factReveals: [] }
  const artifact = requireArtifact<GenericAssetDraftContent>(input.sourceArtifactId)
  if (artifact.novelId !== input.novelId || artifact.kind !== 'generic_draft' || artifact.content.assetType !== 'chapter'
    || artifact.contentHash !== hashArtifactContent(artifact.content)) throw new Error('局部修订来源必须是当前项目的正文候选。')
  const data = JSON.parse(artifact.content.output) as Record<string, unknown>
  if (typeof data.content === 'string') {
    if (data.chapterNum !== chapter.chapterNum || typeof data.title !== 'string' || typeof data.summary !== 'string'
      || (data.changes !== undefined && !Array.isArray(data.changes)) || (data.factReveals !== undefined && !Array.isArray(data.factReveals))) throw new Error('正文候选缺少有效的同章内容。')
    return { chapterNum: chapter.chapterNum, title: data.title, content: data.content, summary: data.summary, changes: (data.changes || []) as unknown[], factReveals: (data.factReveals || []) as unknown[] }
  }
  const child = artifact.content.taskId ? getTaskRecord(artifact.content.taskId) : null
  const owner = child?.parentTaskId ? getTaskRecord(child.parentTaskId) : null
  const saved = JSON.parse(owner?.inputJson || '{}') as { chapterRevisionBaseArtifactId?: string }
  if (owner?.novelId !== input.novelId || owner.relatedEntityType !== 'creative_workflow' || !saved.chapterRevisionBaseArtifactId) throw new Error('所选候选没有可验证的局部修订基线。')
  const base = readChapterRevisionBase(saved.chapterRevisionBaseArtifactId)
  if (base.chapterNum !== chapter.chapterNum) throw new Error('局部候选的章节位置与本次修订不一致。')
  return mergeChapterRevision(base, data)
}
/** Capture once before generation; candidates are materialized without adopting them. */
export function captureChapterRevisionBase(input: CreativeWorkflowInput): ChapterRevisionBase {
  validateChapterRevision(input)
  if (!input.chapterRevision || !input.atChapter) throw new Error('局部修订必须指定当前章节与范围。')
  const formal = listChapters(input.novelId).find(chapter => chapter.chapterNum === input.atChapter)
  if (!formal) throw new Error('局部修订的正式章节不存在。')
  const chapter = sourceChapter(input, formal)
  if (!chapter.content.trim()) throw new Error('当前正式章或所选候选没有可修订的正文。')
  let revision = input.chapterRevision
  const paragraphs = chapterRevisionParagraphs(chapter.content)
  if (revision.target === 'scene') {
    const sceneId = revision.sceneId
    const scene = listSceneContracts(formal.id).find(row => row.id === sceneId)
    if (!scene) throw new Error('指定场景不属于本章。')
    if (!revision.paragraphIndexes) {
      const text = listChapterSegments(formal.id).find(segment => segment.id === scene.segmentId)?.content
      const start = text ? chapter.content.indexOf(text) : -1
      const end = start + (text?.length || 0)
      const selected = paragraphs.filter(row => row.start >= start && row.end <= end)
      if (!text?.trim() || start < 0 || chapter.content.indexOf(text, start + 1) >= 0 || !selected.length
        || selected[0].start !== start || selected.at(-1)!.end !== end) throw new Error('该场景没有可唯一定位的正文范围，请明确提供 paragraphIndexes；系统不会猜测场景边界。')
      revision = { ...revision, paragraphIndexes: selected.map(row => row.index) }
    }
  }
  if (revision.target !== 'summary' && revision.paragraphIndexes!.some(index => !paragraphs.some(row => row.index === index))) throw new Error('指定段落序号不在当前正文范围内。')
  const source = input.sourceArtifactId ? requireArtifact(input.sourceArtifactId) : undefined
  return { schemaVersion: 'creative-chapter-revision-base-v1', chapterId: formal.id, chapterNum: formal.chapterNum,
    formalHash: formalHash(formal), sourceArtifactId: source?.id, sourceContentHash: source?.contentHash, chapter, revision }
}
export function assertChapterRevisionBaseCurrent(input: CreativeWorkflowInput, base: ChapterRevisionBase) {
  const formal = getChapter(base.chapterId)
  if (!formal || formal.novelId !== input.novelId || formal.chapterNum !== input.atChapter || formalHash(formal) !== base.formalHash) throw new Error('局部修订期间正式章正文、标题或摘要已变化，请重新修订。')
  if (base.sourceArtifactId) {
    const source = getArtifact(base.sourceArtifactId)
    if (!source || source.novelId !== input.novelId || source.contentHash !== base.sourceContentHash || source.contentHash !== hashArtifactContent(source.content)) throw new Error('局部修订的候选基线已变化，请重新修订。')
  }
}
export function chapterRevisionSchemaHint(base: ChapterRevisionBase) {
  return base.revision.target === 'summary'
    ? '只输出 {"summary":"修订后的本章实际事件摘要"}，只改摘要，不输出章名、正文、changes或factReveals。'
    : `只输出 {"paragraphs":[{"index":1,"text":"该段修订后完整文字"}]}。恰好包含指定段落 ${base.revision.paragraphIndexes!.join('、')}；index为本章原段落序号，每项text不含空白分段行。不能输出未选择段落、章名、摘要、changes或factReveals。`
}
export function chapterRevisionGenerationMaterial(base: ChapterRevisionBase) {
  if (base.revision.target === 'summary') return { chapterNum: base.chapterNum, title: base.chapter.title,
    content: base.chapter.content, summary: base.chapter.summary, instruction: '只修订摘要；完整正文仅作已发生事实依据，不得改写。' }
  const targets = new Set(base.revision.paragraphIndexes)
  const rows = chapterRevisionParagraphs(base.chapter.content)
  const selected = rows.filter(row => targets.has(row.index))
  const neighbors = rows.filter(row => !targets.has(row.index) && (targets.has(row.index - 1) || targets.has(row.index + 1)))
  return { chapterNum: base.chapterNum, title: base.chapter.title, summary: base.chapter.summary, revision: base.revision,
    paragraphs: selected.map(({ index, text }) => ({ index, text })), neighbors: neighbors.map(({ index, text }) => ({ index, text })),
    instruction: '只输出指定段落的替换文字；邻段是衔接依据，不能修改。正文其他段落、章名、摘要、信息揭示与图谱均锁定。' }
}
export function mergeChapterRevision(base: ChapterRevisionBase, patch: Record<string, unknown>): ChapterRevisionBase['chapter'] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('局部修订输出必须是 JSON 对象。')
  if (base.revision.target === 'summary') {
    if (Object.keys(patch).length !== 1 || typeof patch.summary !== 'string' || !patch.summary.trim() || patch.summary.length > 12000) throw new Error('摘要修订只允许一个非空 summary 字段。')
    return { ...base.chapter, summary: patch.summary }
  }
  if (Object.keys(patch).length !== 1 || !Array.isArray(patch.paragraphs)) throw new Error('段落修订只允许 paragraphs 数组。')
  const targets = base.revision.paragraphIndexes!
  if (patch.paragraphs.length !== targets.length) throw new Error('必须且只能返回本次选中的全部段落。')
  const rows = chapterRevisionParagraphs(base.chapter.content)
  const replacements = new Map<number, string>()
  for (const value of patch.paragraphs) {
    const row = value as Record<string, unknown>
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['index', 'text'].includes(key))
      || !Number.isInteger(row.index) || !targets.includes(Number(row.index)) || replacements.has(Number(row.index))
      || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 30000 || /\r?\n[\t ]*\r?\n/u.test(row.text)) throw new Error('修订段落包含重复序号、越界范围或无效正文；不能增删段落或其他字段。')
    replacements.set(Number(row.index), row.text)
  }
  let content = base.chapter.content
  for (const row of rows.filter(row => replacements.has(row.index)).reverse()) content = content.slice(0, row.start) + replacements.get(row.index)! + content.slice(row.end)
  return { ...base.chapter, content }
}
