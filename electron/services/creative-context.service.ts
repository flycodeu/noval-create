import { estimateTokens } from '../../src/shared/token-budget'
import type { CreativeContextReport, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { listChapters } from './chapter.service'
import { getNovel } from './novel.service'
import { queryStoryAtlas } from './story-atlas.service'
import { resolveModelRuntimeBudget } from './model.service'
import { compileCreativeChapterContext, creativeProjectSources, creativeRevisionSource } from './creative-chapter-context'
import { getSqlite } from '../database/db'
import { queryCreativeFacts } from './creative-facts'

/** Freeze generation at a real narrative position; omitted atlas position is only for browsing. */
export function resolveCreativeChapterPosition(input: CreativeWorkflowInput): number {
  if (input.atChapter !== undefined && !(input.stage === 'chapter' && input.atChapter === 0)) return input.atChapter
  const writtenThrough = listChapters(input.novelId).filter(chapter => chapter.content?.trim()).reduce((n, chapter) => Math.max(n, chapter.chapterNum), 0)
  return input.stage === 'chapter' ? writtenThrough + 1 : writtenThrough
}

/** A bounded, inspectable projection shared by generation, review and MCP preview. */
export async function compileCreativeContext(input: CreativeWorkflowInput, modelConfigId?: number): Promise<CreativeContextReport> {
  input = { ...input, atChapter: resolveCreativeChapterPosition(input) }
  const novel = getNovel(input.novelId)
  if (!novel) throw new Error('项目不存在。')
  const budget = resolveModelRuntimeBudget(modelConfigId || novel.modelConfigId)
  const outputReserve = Math.min(budget.maxTokens || 12_000, input.stage === 'chapter' ? 16_000 : 12_000, Math.floor((budget.maxContextTokens || 32_768) * 0.22))
  // Leave room for the candidate and instructions during the independent review request.
  const reviewedChapterTokens = input.operation === 'review' && input.stage === 'chapter'
    ? estimateTokens(listChapters(input.novelId).find(chapter => chapter.chapterNum === input.atChapter)?.content || '') : 0
  const maxInputTokens = Math.min(24_000, Math.max(0, Math.floor((budget.maxContextTokens || 32_768) * 0.85) - outputReserve * 2 - 2_000 - Math.max(0, reviewedChapterTokens - outputReserve)))
  if (maxInputTokens < 1_000) throw new Error('当前模型窗口不足以完成生成和审校，请降低输出上限或切换模型。')
  if (input.stage === 'chapter') return compileCreativeChapterContext(input, { maxInputTokens, outputReserve })
  const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: input.atChapter, includePlanned: true })
  const chapterRows = listChapters(input.novelId)
  const sources: string[] = []
  const omittedSources: string[] = []
  const pieces: string[] = []
  const candidates: Array<{ id: string; text: string; required: boolean }> = []
  const seen = new Map<string, { id: string; text: string; required: boolean }>()
  let used = 0
  const add = (id: string, value: unknown, required = false) => {
    const text = typeof value === 'string' ? value.trim() : JSON.stringify(value)
    if (!text || text === 'null') return
    const previous = seen.get(text)
    if (previous) { previous.required ||= required; return }
    const candidate = { id, text, required }
    seen.set(text, candidate); candidates.push(candidate)
  }
  add('task', { stage: input.stage, request: input.request, count: input.count, atChapter: input.atChapter }, true)
  add('background', novel.userBackground, true)
  for (const source of creativeProjectSources(novel)) add(source.key, source.value, source.required)
  const revisionSource = creativeRevisionSource(input)
  if (revisionSource) add(`revision:${input.sourceArtifactId}`, revisionSource, true)
  add('expanded_background', novel.expandedBackground)
  if (input.stage === 'outline' || input.stage === 'story') {
    const sqlite = getSqlite()
    const catalogs = [
      ['volume', sqlite.prepare('SELECT id,title,summary FROM story_volumes WHERE novel_id=? ORDER BY volume_number,id').all(input.novelId)],
      ['part', sqlite.prepare('SELECT id,volume_id AS volumeId,title,summary FROM story_parts WHERE novel_id=? ORDER BY volume_id,part_number,id').all(input.novelId)],
      ['fact', queryCreativeFacts(input.novelId)],
    ] as const
    for (const [kind, rows] of catalogs) for (const row of rows as Array<{ id: number; title: string }>) {
      add(`${kind}:${row.id}:planning`, row, input.request.includes(row.title))
    }
  }
  const target = input.atChapter ?? chapterRows.reduce((n, chapter) => Math.max(n, chapter.chapterNum), 0) + 1
  const stageKinds: Partial<Record<string, string>> = { characters: 'character', map: 'location', factions: 'faction', items: 'item', events: 'event' }
  const stageKind = stageKinds[input.stage]
  const requested = new Set(atlas.entities.filter(entity => input.request.includes(entity.name)).map(entity => entity.id))
  const relevant = new Set(requested)
  const relevantEdges = new Set(atlas.relations.filter(edge => requested.has(edge.fromId) || requested.has(edge.toId)).map(edge => edge.id))
  for (const edge of atlas.relations) if (relevantEdges.has(edge.id)) { relevant.add(edge.fromId); relevant.add(edge.toId) }
  const ordered = [...atlas.entities].sort((a, b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id)) || Number(b.kind === stageKind) - Number(a.kind === stageKind))
  for (const entity of ordered.filter(entity => relevant.has(entity.id))) add(entity.id, entity, true)
  for (const edge of atlas.relations.filter(edge => relevantEdges.has(edge.id))) add(`relation:${edge.id}`, edge, true)
  // Compact optional catalog is selected before optional full entities. Large projects can omit names
  // explicitly instead of blocking every local task on an ever-growing mandatory global directory.
  for (let index = 0; index < ordered.length; index += 40) add(`identities:${index / 40}`, ordered.slice(index, index + 40).map(entity => `${entity.id}|${entity.kind}|${entity.name}`).join('\n'))
  for (const entity of ordered.filter(entity => !relevant.has(entity.id))) add(entity.id, entity)
  for (const edge of atlas.relations.filter(edge => !relevantEdges.has(edge.id))) add(`relation:${edge.id}`, edge)
  for (const chapter of [...chapterRows].sort((a, b) => Math.abs(a.chapterNum - target) - Math.abs(b.chapterNum - target))) {
    add(`chapter:${chapter.id}:plan`, { chapterNum: chapter.chapterNum, title: chapter.title, outline: chapter.outline, summary: chapter.summary })
  }
  for (const { id, text, required } of [...candidates.filter(source => source.required), ...candidates.filter(source => !source.required)]) {
    const section = `<source id="${id}">\n${text}\n</source>`
    const size = estimateTokens(`${pieces.length ? '\n\n' : ''}${section}`)
    if (used + size > maxInputTokens) {
      if (required) throw new Error(`必要资料 ${id} 超出模型上下文预算，请缩小本阶段范围。`)
      omittedSources.push(id); continue
    }
    used += size; sources.push(id); pieces.push(section)
  }
  return { text: pieces.join('\n\n'), estimatedTokens: used, maxInputTokens, outputReserve, sources, omittedSources }
}

