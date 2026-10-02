import { estimateTokens } from '../../src/shared/token-budget'
import type { CreativeContextReport, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { listChapters } from './chapter.service'
import { getNovel } from './novel.service'
import { queryStoryAtlas } from './story-atlas.service'
import { resolveModelRuntimeBudget } from './model.service'
import { compileCreativeChapterContext } from './creative-chapter-context'

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
  const maxInputTokens = Math.min(24_000, Math.max(0, Math.floor((budget.maxContextTokens || 32_768) * 0.85) - outputReserve * 2 - 2_000))
  if (maxInputTokens < 1_000) throw new Error('当前模型窗口不足以完成生成和审校，请降低输出上限或切换模型。')
  if (input.stage === 'chapter') return compileCreativeChapterContext(input, { maxInputTokens, outputReserve })
  const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: input.atChapter, includePlanned: true })
  const chapterRows = listChapters(input.novelId)
  const sources: string[] = []
  const omittedSources: string[] = []
  const pieces: string[] = []
  const seen = new Set<string>()
  let used = 0
  const add = (id: string, value: unknown, required = false) => {
    const text = typeof value === 'string' ? value.trim() : JSON.stringify(value)
    if (!text || text === 'null' || seen.has(text)) return
    const section = `<source id="${id}">\n${text}\n</source>`
    const size = estimateTokens(section)
    if (used + size > maxInputTokens) {
      if (required) throw new Error(`必要资料 ${id} 超出模型上下文预算，请缩小本阶段范围。`)
      omittedSources.push(id)
      return
    }
    used += size; seen.add(text); sources.push(id); pieces.push(section)
  }
  add('task', { stage: input.stage, request: input.request, count: input.count, atChapter: input.atChapter }, true)
  add('background', novel.userBackground, true)
  add('world_rules', novel.worldRulesJson, true)
  add('expanded_background', novel.expandedBackground)
  add('voice', novel.themeVoiceJson)
  const target = input.atChapter ?? chapterRows.reduce((n, chapter) => Math.max(n, chapter.chapterNum), 0) + 1
  // Identity catalog prevents incremental requests from accidentally recreating earlier people/places.
  add('identities', atlas.entities.map(entity => ({ id: entity.id, kind: entity.kind, name: entity.name, parentId: entity.parentId })), true)
  const stageKinds: Record<string, string> = { characters: 'character', map: 'location', factions: 'faction', items: 'item', events: 'event' }
  const stageKind = stageKinds[input.stage]
  const relevant = new Set(atlas.entities.filter(entity => input.request.includes(entity.name)).map(entity => entity.id))
  for (const edge of atlas.relations) if (relevant.has(edge.fromId) || relevant.has(edge.toId)) { relevant.add(edge.fromId); relevant.add(edge.toId) }
  const ordered = [...atlas.entities].sort((a, b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id)) || Number(b.kind === stageKind) - Number(a.kind === stageKind))
  for (const entity of ordered) add(entity.id, entity, relevant.has(entity.id))
  for (const edge of atlas.relations) add(`relation:${edge.id}`, edge)
  for (const chapter of [...chapterRows].sort((a, b) => Math.abs(a.chapterNum - target) - Math.abs(b.chapterNum - target))) {
    add(`chapter:${chapter.id}:plan`, { chapterNum: chapter.chapterNum, title: chapter.title, outline: chapter.outline, summary: chapter.summary })
  }
  return { text: pieces.join('\n\n'), estimatedTokens: used, maxInputTokens, outputReserve, sources, omittedSources }
}

