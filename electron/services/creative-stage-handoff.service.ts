import { parseAiJsonResult } from '../utils/json'
import { runChatTask } from './task.service'
import { createCreativeStageHandoff } from './creative-stage.service'
import {
  normalizeCreativeStageHandoffList,
  type CreativeStageAssetType,
  type CreativeStageHandoffAssetContinuity,
  type CreativeStageHandoffArtifact,
} from '../../src/shared/creative-stages'

export interface CreateChapterEndHandoffDraftInput {
  novelId: number
  stageId: number
  chapterId: number
  chapterNum: number
  chapterTitle?: string | null
  chapterContent?: string | null
  summary?: string | null
  nextChapterSeed?: string | null
  continuitySummary?: string | null
  modelConfigId?: number | null
}

export interface CreateChapterEndHandoffDraftResult {
  artifact: CreativeStageHandoffArtifact
  extractionMode: 'model' | 'deterministic'
}

interface HandoffDraftFields {
  changes: string[]
  costs: string[]
  openQuestions: string[]
  nextPressure: string
  assetContinuity: CreativeStageHandoffAssetContinuity[]
}

const ASSET_TYPES: readonly CreativeStageAssetType[] = [
  'character',
  'world',
  'map',
  'faction',
  'item',
  'thread',
  'timeline',
  'outline',
]

const ASSET_CHANGES: readonly CreativeStageHandoffAssetContinuity['change'][] = [
  'introduced',
  'changed',
  'retired',
  'unchanged',
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readList(record: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key]
    const normalized = normalizeCreativeStageHandoffList(value)
    if (normalized.length > 0) return normalized
  }
  return []
}

function normalizeAssetContinuity(value: unknown): CreativeStageHandoffAssetContinuity[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const rawType = asText(item.assetType ?? item.asset_type)
      const rawChange = asText(item.change)
      return {
        assetType: (ASSET_TYPES.includes(rawType as CreativeStageAssetType) ? rawType : 'world') as CreativeStageAssetType,
        name: asText(item.name),
        change: (ASSET_CHANGES.includes(rawChange as CreativeStageHandoffAssetContinuity['change']) ? rawChange : 'changed') as CreativeStageHandoffAssetContinuity['change'],
        note: asText(item.note),
      }
    })
    .filter((item) => item.name)
    .slice(0, 30)
}

function clipChapterContent(content: string): string {
  const maxChars = 16000
  if (content.length <= maxChars) return content
  return `${content.slice(0, 11000)}\n……（正文中段省略）……\n${content.slice(-5000)}`
}

function buildHandoffExtractionPrompt(input: CreateChapterEndHandoffDraftInput): string {
  return [
    '你是长篇小说的阶段交接编辑。请只根据本章已经发生的正文和章后状态，提炼下一阶段可审阅的交接草稿。',
    '只输出 JSON，不要 Markdown、解释或补写正文。',
    '{"changes":[],"costs":[],"open_questions":[],"next_pressure":"","asset_continuity":[{"asset_type":"character|world|map|faction|item|thread|timeline|outline","name":"","change":"introduced|changed|retired|unchanged","note":""}]}',
    '规则：',
    '- changes 只写本章已经发生的状态变化、关系变化、资源变化或剧情推进，1-6 条。',
    '- costs 只写本章已经付出的代价，不要把未来风险冒充已发生事实。',
    '- open_questions 只写本章结束仍未解决、且正文确实提出的问题。',
    '- next_pressure 写下一阶段最直接的压力或必须回应的后果；没有新信息时可沿用下一章种子。',
    '- asset_continuity 只列正文明确涉及的资产；不确定的名称不要臆造。',
    `第${input.chapterNum}章：${asText(input.chapterTitle) || '正文'}`,
    input.summary ? `章后摘要：${asText(input.summary)}` : '',
    input.nextChapterSeed ? `下一章种子：${asText(input.nextChapterSeed)}` : '',
    input.continuitySummary ? `连续性状态：${asText(input.continuitySummary)}` : '',
    '【本章正文】',
    clipChapterContent(asText(input.chapterContent)),
  ].filter(Boolean).join('\n')
}

function deterministicInput(input: CreateChapterEndHandoffDraftInput): HandoffDraftFields {
  return {
    changes: input.summary ? [asText(input.summary)] : [],
    costs: [],
    openQuestions: [],
    nextPressure: asText(input.nextChapterSeed),
    assetContinuity: [],
  }
}

export async function createChapterEndCreativeStageHandoffDraft(
  input: CreateChapterEndHandoffDraftInput,
): Promise<CreateChapterEndHandoffDraftResult> {
  const fallback = deterministicInput(input)
  let extracted = fallback
  let extractionMode: CreateChapterEndHandoffDraftResult['extractionMode'] = 'deterministic'

  try {
    const raw = await runChatTask({
      type: 'creative_stage_handoff',
      novelId: input.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapterId,
      modelConfigId: input.modelConfigId || undefined,
      retryable: true,
      idempotencyKey: `chapter-handoff-extraction:${input.chapterId}`,
      messages: [{ role: 'user', content: buildHandoffExtractionPrompt(input) }],
    })
    const parsed = parseAiJsonResult<Record<string, unknown>>(raw, 'object', {
      channel: 'creative-stage',
      message: '阶段交接 JSON 解析失败，已回退到确定性章后种子。',
      consoleSummary: `[creative-stage:warn] handoff-json chapter=${input.chapterId}`,
      context: { chapterId: input.chapterId, novelId: input.novelId, stage: 'handoff' },
    })
    if (parsed.success && parsed.data) {
      const changes = readList(parsed.data, 'changes', 'state_changes')
      const costs = readList(parsed.data, 'costs', 'consequences')
      const openQuestions = readList(parsed.data, 'open_questions', 'openQuestions', 'unresolved_questions')
      const nextPressure = asText(parsed.data.next_pressure ?? parsed.data.nextPressure) || fallback.nextPressure
      if (changes.length > 0 || nextPressure) {
        extracted = {
          changes: changes.length > 0 ? changes : fallback.changes,
          costs,
          openQuestions,
          nextPressure,
          assetContinuity: normalizeAssetContinuity(parsed.data.asset_continuity ?? parsed.data.assetContinuity),
        }
        extractionMode = 'model'
      }
    }
  } catch {
    // Model extraction is an enhancement; the deterministic seed keeps the chapter finalization path recoverable.
  }

  const artifact = createCreativeStageHandoff({
    stageId: input.stageId,
    idempotencyKey: `chapter-handoff-seed:${input.chapterId}`,
    ...extracted,
    producerType: extractionMode === 'model' ? 'novelforge_model' : 'system',
    producerId: extractionMode === 'model' ? 'creative-stage-handoff-extractor-v1' : 'chapter-finalize-fallback',
    producerClient: 'novelforge-chapter-pipeline',
    modelConfigId: input.modelConfigId,
  })
  return { artifact, extractionMode }
}
