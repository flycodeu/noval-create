import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, novels, storyArcs } from '../database/schema'
import * as taskService from './task.service'
import { buildOutlineGenerationContext, buildStoryProfile } from './context.service'
import { discoverEntitiesFromContent } from './entity-discovery.service'
import { markNovelContextChanged } from './context-impact.service'
import {
  buildChapterOutlinePlanningPrompt,
  buildStoryArcPlanningPrompt,
} from './story-prompts'
import { parseAiJsonResult } from '../utils/json'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  analyzeOutlineDesignAlignment,
  type OutlineDesignGateChapter,
} from './outline-design-gate.service'
import { syncStructureLinkage } from './story-structure.service'
import { getRecommendedChapterWordsForOperatingMode } from '../../src/shared/operating-mode'

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toLedgerText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()

  const items = toStringArray(value)
  return items.length > 0 ? items.join('；') : ''
}

function toBlueprintText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const items = toStringArray(value)
  if (items.length > 0) return items.join('；')
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return ''
}

function formatGeneratedArcSummary(arc: Record<string, unknown>): string {
  const summary = typeof arc.summary === 'string' ? arc.summary.trim() : ''
  const stage = typeof arc.stage === 'string' ? arc.stage.trim() : ''
  const keyTurns = toBlueprintText(arc.key_turns)
  const subplotLinks = toBlueprintText(arc.subplot_links)
  const pacing = toBlueprintText(arc.pacing)

  return [
    summary,
    stage ? `阶段：${stage}` : '',
    keyTurns ? `关键转折：${keyTurns}` : '',
    subplotLinks ? `支线连接：${subplotLinks}` : '',
    pacing ? `节奏：${pacing}` : '',
  ].filter(Boolean).join('\n')
}

function formatGeneratedOutline(outline: Record<string, unknown>): string {
  const characters = toStringArray(outline.characters)
  const growthLedger = toLedgerText(outline.growth_ledger)
  const costLedger = toLedgerText(outline.cost_ledger)

  return [
    typeof outline.goal === 'string' && outline.goal.trim() ? `目标：${outline.goal.trim()}` : '',
    growthLedger ? `成长账本：${growthLedger}` : '',
    costLedger ? `代价账本：${costLedger}` : '',
    characters.length > 0 ? `人物：${characters.join('、')}` : '',
    typeof outline.location === 'string' && outline.location.trim() ? `场景：${outline.location.trim()}` : '',
    ...toStringArray(outline.plot_points).map((item) => `- ${item}`),
    typeof outline.bridge_in === 'string' && outline.bridge_in.trim() ? `承接：${outline.bridge_in.trim()}` : '',
    typeof outline.bridge_out === 'string' && outline.bridge_out.trim() ? `转出：${outline.bridge_out.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function previewText(text: string, max = 220): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function buildOutlineJsonRepairPrompt(label: string, raw: string, schemaHint: string): string {
  return [
    `你现在只负责修复 ${label} 的 JSON 格式，不新增设定，不重写内容。`,
    '',
    '【任务目标】',
    '把下面的原始输出整理成一个合法 JSON 数组。',
    schemaHint,
    '',
    '【原始输出】',
    raw,
    '',
    '【强约束】',
    '不要补剧情，不要扩写，不要改事实方向。',
    '如果有代码块、说明文字、注释、尾逗号或数组外包裹对象，删除它们。',
    '如果字符串内部出现双引号，必须正确转义。',
    '只输出合法 JSON 数组，不要解释，不要 Markdown。',
  ].filter(Boolean).join('\n')
}

async function parseOutlineJsonArrayWithRepair<T>(params: {
  label: string
  raw: string
  novelId: number
  modelConfigId?: number
  taskType: taskService.TaskType
  schemaHint: string
}): Promise<T[]> {
  const parsed = parseAiJsonResult<T[]>(params.raw, 'array', {
    channel: 'outline-json',
    message: `${params.label} JSON 解析失败，尝试自动修复。`,
    consoleSummary: `[outline-json:warn] ${params.label} parse failed`,
  })
  if (parsed.success && Array.isArray(parsed.data)) return parsed.data

  const repairedRaw = await taskService.runChatTask({
    type: params.taskType,
    novelId: params.novelId,
    messages: [{
      role: 'user',
      content: buildOutlineJsonRepairPrompt(params.label, params.raw, params.schemaHint),
    }],
    modelConfigId: params.modelConfigId,
    retryable: true,
  })
  const repaired = parseAiJsonResult<T[]>(repairedRaw, 'array', {
    channel: 'outline-json',
    message: `${params.label} JSON 自动修复后仍解析失败。`,
    consoleSummary: `[outline-json:error] ${params.label} repair parse failed`,
  })
  if (repaired.success && Array.isArray(repaired.data)) return repaired.data

  const firstMessage = parsed.error?.message || '首轮解析失败'
  const secondMessage = repaired.error?.message || '修复后解析失败'
  throw new Error(`${params.label} JSON 解析失败，自动修复一次仍未成功。首轮原因：${firstMessage}。修复后原因：${secondMessage}。原始输出片段：${previewText(params.raw)}`)
}

export async function generateStoryArcs(novelId: number): Promise<Record<string, unknown>[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const result = await taskService.runChatTask({
    type: 'generate_arcs',
    novelId,
    messages: [{
      role: 'user',
      content: buildStoryArcPlanningPrompt({
        novelTitle: profile.novelTitle,
        genre: profile.genre,
        storyGoal: profile.storyGoal,
        coreConflict: profile.coreConflict,
        mainPlot: profile.mainPlot,
        subPlots: profile.subPlots,
        ending: profile.ending,
        totalChapters: Math.ceil((novel.targetWords || 200000) / 3000),
        rhythmSummary: profile.rhythmSummary,
        background: profile.background,
        protagonistReference: profile.protagonistReference,
        protagonistRule: profile.protagonistRule,
      }),
    }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const arcs = await parseOutlineJsonArrayWithRepair<Record<string, unknown>>({
    label: '故事弧规划',
    raw: result,
    novelId,
    modelConfigId: novel.modelConfigId || undefined,
    taskType: 'generate_arcs',
    schemaHint: '数组元素必须保留 arc_name、stage、chapter_start、chapter_end、arc_goal、target_words、growth_ledger、cost_ledger、key_turns、subplot_links、pacing、summary 字段。',
  })
  if (arcs.length === 0) throwUserFacingError('outline.arcGenerationEmpty')

  const invalidIndex = arcs.findIndex((arc) => {
    const goal = typeof arc.arc_goal === 'string' ? arc.arc_goal.trim() : typeof arc.goal === 'string' ? arc.goal.trim() : ''
    const summary = typeof arc.summary === 'string' ? arc.summary.trim() : ''
    return !goal && !summary
  })
  if (invalidIndex >= 0) {
    throwUserFacingError('outline.arcGenerationInvalid', {
      detail: `第 ${invalidIndex + 1} 个故事弧缺少目标和摘要。`,
    })
  }

  const preparedArcs = arcs.map((arc, index) => ({
    novelId,
    arcName: typeof arc.arc_name === 'string' ? arc.arc_name : typeof arc.name === 'string' ? arc.name : `故事弧 ${index + 1}`,
    arcOrder: typeof arc.order === 'number' ? arc.order : index + 1,
    chapterStart: typeof arc.chapter_start === 'number' ? arc.chapter_start : null,
    chapterEnd: typeof arc.chapter_end === 'number' ? arc.chapter_end : null,
    arcGoal: typeof arc.arc_goal === 'string' ? arc.arc_goal : typeof arc.goal === 'string' ? arc.goal : '',
    arcSummary: formatGeneratedArcSummary(arc),
    growthLedger: toLedgerText(arc.growth_ledger),
    costLedger: toLedgerText(arc.cost_ledger),
    targetWords: typeof arc.target_words === 'number' ? arc.target_words : 0,
  }))

  const insertedArcs = db.transaction((tx) => {
    tx.delete(storyArcs).where(eq(storyArcs.novelId, novelId)).run()
    tx.update(chapters).set({
      arcId: null,
      outline: null,
      emotionTone: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.novelId, novelId)).run()

    return preparedArcs.map((resultArc) => {
      const insertResult = tx.insert(storyArcs).values(resultArc).run()
      return { resultArc, id: Number(insertResult.lastInsertRowid) }
    })
  })

  for (const { resultArc, id } of insertedArcs) {
    const discoveryText = [resultArc.arcGoal, resultArc.arcSummary, resultArc.growthLedger, resultArc.costLedger].filter(Boolean).join('\n')
    if (discoveryText.trim()) {
      void discoverEntitiesFromContent({
        novelId,
        sourcePage: 'outline',
        sourceLabel: `故事弧 ${resultArc.arcName}`,
        sourceEntityId: id,
        content: discoveryText,
      }).catch(console.error)
    }
  }

  markNovelContextChanged(novelId, 'Story outline changed')
  return arcs
}

export async function generateChapterOutlines(arcId: number, options: { batchSize?: number } = {}) {
  const db = getDb()
  const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
  if (!arc) throwUserFacingError('storyArc.notFound')

  const novel = db.select().from(novels).where(eq(novels.id, arc.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const chapterStart = arc.chapterStart || 1
  const chapterEnd = arc.chapterEnd || Math.max(chapterStart, chapterStart + 9)
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || 4), 6))
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, arc.novelId)).all()
  const outlinedNums = new Set(
    chapterRows
      .filter((chapter) => chapter.chapterNum >= chapterStart && chapter.chapterNum <= chapterEnd)
      .filter((chapter) => typeof chapter.outline === 'string' && chapter.outline.trim())
      .map((chapter) => chapter.chapterNum),
  )

  let batchStart: number | null = null
  for (let chapterNum = chapterStart; chapterNum <= chapterEnd; chapterNum += 1) {
    if (!outlinedNums.has(chapterNum)) {
      batchStart = chapterNum
      break
    }
  }

  if (!batchStart) {
    const structureLinkage = syncStructureLinkage(arc.novelId)
    return {
      generatedCount: 0,
      completed: true,
      batchStart: null,
      batchEnd: null,
      message: '当前故事弧的章节细纲已补齐。',
      structureLinkage,
    }
  }

  let batchEnd = batchStart
  let slotCount = 1
  while (batchEnd < chapterEnd && slotCount < batchSize) {
    const nextChapterNum = batchEnd + 1
    if (outlinedNums.has(nextChapterNum)) break
    batchEnd = nextChapterNum
    slotCount += 1
  }

  const context = await buildOutlineGenerationContext(arcId)
  const existingOutlines = chapterRows
    .filter((chapter) => outlinedNums.has(chapter.chapterNum) && chapter.outline)
    .sort((a, b) => a.chapterNum - b.chapterNum)
    .slice(-6)
    .map((chapter) => `第${chapter.chapterNum}章《${chapter.title || '无标题'}》：${(chapter.outline || '').split('\n')[0].slice(0, 60)}`)
    .join('\n')

  const generateOutlineBatch = async (designGateDirective?: string): Promise<Record<string, unknown>[]> => {
    const raw = await taskService.runChatTask({
      type: 'chapter_outline',
      novelId: arc.novelId,
      messages: [{
        role: 'user',
        content: buildChapterOutlinePlanningPrompt({
          novelTitle: context.profile.novelTitle,
          genre: context.profile.genre,
          storyGoal: context.profile.storyGoal,
          coreConflict: context.profile.coreConflict,
          mainPlot: context.profile.mainPlot,
          arcName: arc.arcName,
          arcGoal: arc.arcGoal || '',
          arcSummary: arc.arcSummary || '',
          arcGrowthLedger: arc.growthLedger || '',
          arcCostLedger: arc.costLedger || '',
          arcTargetWords: arc.targetWords || undefined,
          chapterStart: batchStart,
          chapterEnd: batchEnd,
          previousSummary: context.previousSummary,
          characterStates: context.characterStates,
          continuitySummary: context.continuitySummary,
          openLoops: context.openLoops,
          worldRulesSummary: context.worldRulesSummary,
          previousChapterOutlines: existingOutlines || undefined,
          protagonistReference: context.profile.protagonistReference,
          protagonistRule: context.profile.protagonistRule,
          designGateDirective,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })
    return parseOutlineJsonArrayWithRepair<Record<string, unknown>>({
      label: `第${batchStart}至第${batchEnd}章章节细纲`,
      raw,
      novelId: arc.novelId,
      modelConfigId: novel.modelConfigId || undefined,
      taskType: 'chapter_outline',
      schemaHint: '数组元素必须保留 chapter_num、title、goal、growth_ledger、cost_ledger、plot_points、characters、location、emotion_tone、bridge_in、bridge_out 字段。',
    })
  }

  const toGateChapters = (rows: Record<string, unknown>[]): OutlineDesignGateChapter[] => rows.map((row) => ({
    chapterNum: typeof row.chapter_num === 'number' ? row.chapter_num : typeof row.num === 'number' ? row.num : 0,
    title: typeof row.title === 'string' ? row.title : '',
    goal: typeof row.goal === 'string' ? row.goal : '',
    plotPoints: toStringArray(row.plot_points).join('\n'),
    growthLedger: toLedgerText(row.growth_ledger),
    costLedger: toLedgerText(row.cost_ledger),
  }))

  const gateArc = {
    arcName: arc.arcName,
    arcGoal: arc.arcGoal || '',
    arcSummary: arc.arcSummary || '',
    growthLedger: arc.growthLedger || '',
    costLedger: arc.costLedger || '',
  }

  let outlines = await generateOutlineBatch()
  let designGate = analyzeOutlineDesignAlignment(gateArc, toGateChapters(outlines))
  if (!designGate.passed) {
    console.warn(`[outline-design-gate] arc=${arc.arcName} ${designGate.summary} 触发重生成。`)
    try {
      const retryOutlines = await generateOutlineBatch(designGate.correctiveDirective)
      const retryGate = analyzeOutlineDesignAlignment(gateArc, toGateChapters(retryOutlines))
      if (retryGate.flaggedChapters.length <= designGate.flaggedChapters.length) {
        outlines = retryOutlines
        designGate = retryGate
      }
      console.warn(`[outline-design-gate] arc=${arc.arcName} 重生成后：${designGate.summary}`)
    } catch (retryError) {
      console.error('[outline-design-gate] 重生成失败，沿用首轮结果。', retryError)
    }
  }

  let generatedCount = 0
  for (const outline of outlines) {
    const chapterNum = typeof outline.chapter_num === 'number'
      ? outline.chapter_num
      : typeof outline.num === 'number'
        ? outline.num
        : 0
    if (!chapterNum || chapterNum < batchStart || chapterNum > batchEnd) continue

    const existing = chapterRows.find((chapter) => chapter.chapterNum === chapterNum)
    const outlineText = formatGeneratedOutline(outline)
    const title = typeof outline.title === 'string' ? outline.title : `第${chapterNum}章`
    const emotionTone = typeof outline.emotion_tone === 'string' ? outline.emotion_tone : ''

    let chapterId = existing?.id
    if (existing) {
      db.update(chapters).set({ title, outline: outlineText, emotionTone, arcId }).where(eq(chapters.id, existing.id)).run()
    } else {
      const insertResult = db.insert(chapters).values({
        novelId: arc.novelId,
        chapterNum,
        title,
        outline: outlineText,
        emotionTone,
        arcId,
        status: 'outline',
        targetWords: getRecommendedChapterWordsForOperatingMode({ targetWords: novel.targetWords }),
        contextVersion: novel.contextVersion || 1,
        staleReasonJson: JSON.stringify([]),
      }).run()
      chapterId = Number(insertResult.lastInsertRowid)
    }
    if (outlineText.trim()) {
      void discoverEntitiesFromContent({
        novelId: arc.novelId,
        sourcePage: 'outline',
        sourceLabel: `第${chapterNum}章 ${title}`.trim(),
        sourceEntityId: chapterId,
        content: outlineText,
      }).catch(console.error)
    }
    generatedCount += 1
  }

  const refreshedChapters = db.select().from(chapters).where(eq(chapters.novelId, arc.novelId)).all()
  const refreshedOutlinedNums = new Set(
    refreshedChapters
      .filter((chapter) => chapter.chapterNum >= chapterStart && chapter.chapterNum <= chapterEnd)
      .filter((chapter) => typeof chapter.outline === 'string' && chapter.outline.trim())
      .map((chapter) => chapter.chapterNum),
  )
  const completed = Array.from({ length: chapterEnd - chapterStart + 1 }, (_, index) => chapterStart + index)
    .every((chapterNum) => refreshedOutlinedNums.has(chapterNum))

  const structureLinkage = syncStructureLinkage(arc.novelId)

  return {
    generatedCount,
    completed,
    batchStart,
    batchEnd,
    designGate: {
      judgeable: designGate.judgeable,
      passed: designGate.passed,
      summary: designGate.summary,
      designTerms: designGate.designTerms,
      flaggedChapters: designGate.flaggedChapters,
    },
    structureLinkage,
    message: completed
      ? `第${batchStart}至第${batchEnd}章细纲已生成，当前故事弧已补齐；结构联动已同步，请到章节合同页完成草稿审核。`
      : `第${batchStart}至第${batchEnd}章细纲已生成，可继续生成下一批；结构联动已同步，请到章节合同页完成草稿审核。`,
  }
}
