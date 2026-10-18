import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
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
  if (input.stage !== 'chapter' || input.operation === 'review') throw new Error(formatUserFacingMessage('services.chapterRevision.chapterStageOnly'))
  const result = validateJsonSchema(input.chapterRevision, CREATIVE_CHAPTER_REVISION_SCHEMA)
  if (!result.valid) throw new Error(formatUserFacingMessage('services.chapterRevision.scopeInvalid', { issues: `${result.issues.join('；')}` }))
  const indexes = input.chapterRevision.target === 'summary' ? undefined : input.chapterRevision.paragraphIndexes
  if (indexes && new Set(indexes).size !== indexes.length) throw new Error(formatUserFacingMessage('services.chapterRevision.duplicateParagraphIndexes'))
}
export function readChapterRevisionBase(artifactId: string): ChapterRevisionBase {
  const artifact = requireArtifact<ChapterRevisionBase>(artifactId)
  if (artifact.kind !== 'creative_chapter_revision_base' || artifact.content.schemaVersion !== 'creative-chapter-revision-base-v1'
    || artifact.contentHash !== hashArtifactContent(artifact.content)) throw new Error(formatUserFacingMessage('services.chapterRevision.baseInvalid'))
  return artifact.content
}
function sourceChapter(input: CreativeWorkflowInput, chapter: NonNullable<ReturnType<typeof getChapter>>) {
  if (!input.sourceArtifactId) return { chapterNum: chapter.chapterNum, title: chapter.title || '', content: chapter.content || '', summary: chapter.summary || '', changes: [], factReveals: [] }
  const artifact = requireArtifact<GenericAssetDraftContent>(input.sourceArtifactId)
  if (artifact.novelId !== input.novelId || artifact.kind !== 'generic_draft' || artifact.content.assetType !== 'chapter'
    || artifact.contentHash !== hashArtifactContent(artifact.content)) throw new Error(formatUserFacingMessage('services.chapterRevision.sourceInvalid'))
  const data = JSON.parse(artifact.content.output) as Record<string, unknown>
  if (typeof data.content === 'string') {
    if (data.chapterNum !== chapter.chapterNum || typeof data.title !== 'string' || typeof data.summary !== 'string'
      || (data.changes !== undefined && !Array.isArray(data.changes)) || (data.factReveals !== undefined && !Array.isArray(data.factReveals))) throw new Error(formatUserFacingMessage('services.chapterRevision.chapterCandidateMissing'))
    return { chapterNum: chapter.chapterNum, title: data.title, content: data.content, summary: data.summary, changes: (data.changes || []) as unknown[], factReveals: (data.factReveals || []) as unknown[] }
  }
  const child = artifact.content.taskId ? getTaskRecord(artifact.content.taskId) : null
  const owner = child?.parentTaskId ? getTaskRecord(child.parentTaskId) : null
  const saved = JSON.parse(owner?.inputJson || '{}') as { chapterRevisionBaseArtifactId?: string }
  if (owner?.novelId !== input.novelId || owner.relatedEntityType !== 'creative_workflow' || !saved.chapterRevisionBaseArtifactId) throw new Error(formatUserFacingMessage('services.chapterRevision.verifiableBaseMissing'))
  const base = readChapterRevisionBase(saved.chapterRevisionBaseArtifactId)
  if (base.chapterNum !== chapter.chapterNum) throw new Error(formatUserFacingMessage('services.chapterRevision.chapterPositionMismatch'))
  return mergeChapterRevision(base, data)
}
/** Capture once before generation; candidates are materialized without adopting them. */
export function captureChapterRevisionBase(input: CreativeWorkflowInput): ChapterRevisionBase {
  validateChapterRevision(input)
  if (!input.chapterRevision || !input.atChapter) throw new Error(formatUserFacingMessage('services.chapterRevision.scopeMissing'))
  const formal = listChapters(input.novelId).find(chapter => chapter.chapterNum === input.atChapter)
  if (!formal) throw new Error(formatUserFacingMessage('services.chapterRevision.formalChapterMissing'))
  const chapter = sourceChapter(input, formal)
  if (!chapter.content.trim()) throw new Error(formatUserFacingMessage('services.chapterRevision.contentMissing'))
  let revision = input.chapterRevision
  const paragraphs = chapterRevisionParagraphs(chapter.content)
  if (revision.target === 'scene') {
    const sceneId = revision.sceneId
    const scene = listSceneContracts(formal.id).find(row => row.id === sceneId)
    if (!scene) throw new Error(formatUserFacingMessage('services.chapterRevision.sceneWrongChapter'))
    if (!revision.paragraphIndexes) {
      const text = listChapterSegments(formal.id).find(segment => segment.id === scene.segmentId)?.content
      const start = text ? chapter.content.indexOf(text) : -1
      const end = start + (text?.length || 0)
      const selected = paragraphs.filter(row => row.start >= start && row.end <= end)
      if (!text?.trim() || start < 0 || chapter.content.indexOf(text, start + 1) >= 0 || !selected.length
        || selected[0].start !== start || selected.at(-1)!.end !== end) throw new Error(formatUserFacingMessage('services.chapterRevision.sceneRangeAmbiguous'))
      revision = { ...revision, paragraphIndexes: selected.map(row => row.index) }
    }
  }
  if (revision.target !== 'summary' && revision.paragraphIndexes!.some(index => !paragraphs.some(row => row.index === index))) throw new Error(formatUserFacingMessage('services.chapterRevision.paragraphIndexOutOfRange'))
  const source = input.sourceArtifactId ? requireArtifact(input.sourceArtifactId) : undefined
  return { schemaVersion: 'creative-chapter-revision-base-v1', chapterId: formal.id, chapterNum: formal.chapterNum,
    formalHash: formalHash(formal), sourceArtifactId: source?.id, sourceContentHash: source?.contentHash, chapter, revision }
}
export function assertChapterRevisionBaseCurrent(input: CreativeWorkflowInput, base: ChapterRevisionBase) {
  const formal = getChapter(base.chapterId)
  if (!formal || formal.novelId !== input.novelId || formal.chapterNum !== input.atChapter || formalHash(formal) !== base.formalHash) throw new Error(formatUserFacingMessage('services.chapterRevision.formalChapterChanged'))
  if (base.sourceArtifactId) {
    const source = getArtifact(base.sourceArtifactId)
    if (!source || source.novelId !== input.novelId || source.contentHash !== base.sourceContentHash || source.contentHash !== hashArtifactContent(source.content)) throw new Error(formatUserFacingMessage('services.chapterRevision.candidateBaseChanged'))
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
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(formatUserFacingMessage('services.chapterRevision.outputObjectRequired'))
  if (base.revision.target === 'summary') {
    if (Object.keys(patch).length !== 1 || typeof patch.summary !== 'string' || !patch.summary.trim() || patch.summary.length > 12000) throw new Error(formatUserFacingMessage('services.chapterRevision.summaryOnly'))
    return { ...base.chapter, summary: patch.summary }
  }
  if (Object.keys(patch).length !== 1 || !Array.isArray(patch.paragraphs)) throw new Error(formatUserFacingMessage('services.chapterRevision.paragraphsOnly'))
  const targets = base.revision.paragraphIndexes!
  if (patch.paragraphs.length !== targets.length) throw new Error(formatUserFacingMessage('services.chapterRevision.selectedParagraphsRequired'))
  const rows = chapterRevisionParagraphs(base.chapter.content)
  const replacements = new Map<number, string>()
  for (const value of patch.paragraphs) {
    const row = value as Record<string, unknown>
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['index', 'text'].includes(key))
      || !Number.isInteger(row.index) || !targets.includes(Number(row.index)) || replacements.has(Number(row.index))
      || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 30000 || /\r?\n[\t ]*\r?\n/u.test(row.text)) throw new Error(formatUserFacingMessage('services.chapterRevision.paragraphPatchInvalid'))
    replacements.set(Number(row.index), row.text)
  }
  let content = base.chapter.content
  for (const row of rows.filter(row => replacements.has(row.index)).reverse()) content = content.slice(0, row.start) + replacements.get(row.index)! + content.slice(row.end)
  return { ...base.chapter, content }
}
