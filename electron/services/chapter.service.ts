import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, novels, storyArcs } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { aiCheckPrompt, chapterSummaryPrompt } from './prompts'
import {
  buildChapterContext,
  buildStoryProfile,
  ContinuityState,
} from './context.service'
import {
  buildChapterDraftPrompt,
  buildChapterReviewPrompt,
  buildChapterRewritePrompt,
  buildContinuityStatePrompt,
  buildScenePlanPrompt,
} from './story-prompts'
import { runChatTask, runStreamTask } from './task.service'
import { buildConsistencyPromptSummary, buildNovelConsistencyReport } from './consistency.service'
import { syncChapterTimelineStatuses } from './link-sync.service'

interface ChapterSummaryData {
  summary: string
  nextChapterSeed: string
}

interface ScenePlanStep {
  scene_order: number
  scene_title: string
  purpose: string
  location: string
  time_anchor: string
  present_characters: string[]
  key_items: string[]
  conflict: string
  beat: string
  must_cover: string[]
  exit_hook: string
}

interface ChapterReviewNotes {
  summary: string
  critical_fixes: string[]
  continuity_risks: string[]
  language_risks: string[]
  missing_payoffs: string[]
  strengths: string[]
  revision_brief: string
}

type ChapterGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'completed' | 'failed'

interface ChapterGenerationProgressEvent {
  chapterId: number
  stage: ChapterGenerationStage
  label: string
  detail?: string
  completed: number
  total: number
  status: 'running' | 'success' | 'failed'
}

function countChineseWords(text: string): number {
  const chinese = (text.match(/[一-龥]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractChapterGoal(outline?: string | null): string {
  if (!outline) return ''
  const match = outline.match(/(?:^|\n)(?:目标|本章目标)[:：]\s*(.+)/)
  if (match?.[1]) return match[1].trim()

  const firstLine = outline.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || ''
}

function serializeContinuityState(state: ContinuityState): string {
  return JSON.stringify({
    plot_progress: state.plotProgress,
    character_state_changes: state.characterStateChanges,
    world_state_changes: state.worldStateChanges,
    open_loops: state.openLoops,
    continuity_notes: state.continuityNotes,
    arc_progress: state.arcProgress,
  })
}

function sendGenerationProgress(
  sender: WebContents | undefined,
  payload: ChapterGenerationProgressEvent,
) {
  if (sender && !sender.isDestroyed()) {
    sender.send('chapter:generation-progress', payload)
  }
}

function buildStoryCore(profile: Awaited<ReturnType<typeof buildStoryProfile>>, fallback?: string): string {
  if (fallback?.trim()) return fallback
  return [
    `故事核心目标：${profile.storyGoal || '（未填写）'}`,
    `核心冲突：${profile.coreConflict || '（未填写）'}`,
    `主线剧情：${profile.mainPlot || '（未填写）'}`,
    `支线剧情：${profile.subPlots || '（暂无支线）'}`,
    `结局方向：${profile.ending || '（未填写）'}`,
  ].join('\n')
}

function buildFallbackContinuityState(
  chapter: typeof chapters.$inferSelect,
  summaryData: ChapterSummaryData,
): ContinuityState {
  const chapterGoal = extractChapterGoal(chapter.outline)
  const summary = summaryData.summary || chapter.title || `第${chapter.chapterNum}章完成当前章节推进`
  const nextSeed = summaryData.nextChapterSeed

  return {
    plotProgress: [summary].filter(Boolean),
    characterStateChanges: [],
    worldStateChanges: [],
    openLoops: nextSeed ? [nextSeed] : [],
    continuityNotes: [nextSeed || chapterGoal].filter(Boolean),
    arcProgress: chapterGoal || '',
  }
}

function normalizeContinuityState(parsed: Record<string, unknown>, fallback: ContinuityState): ContinuityState {
  const state: ContinuityState = {
    plotProgress: toStringArray(parsed.plot_progress),
    characterStateChanges: toStringArray(parsed.character_state_changes),
    worldStateChanges: toStringArray(parsed.world_state_changes),
    openLoops: toStringArray(parsed.open_loops),
    continuityNotes: toStringArray(parsed.continuity_notes),
    arcProgress: typeof parsed.arc_progress === 'string' ? parsed.arc_progress.trim() : '',
  }

  const hasContent = Boolean(
    state.plotProgress.length > 0 ||
    state.characterStateChanges.length > 0 ||
    state.worldStateChanges.length > 0 ||
    state.openLoops.length > 0 ||
    state.continuityNotes.length > 0 ||
    state.arcProgress,
  )

  return hasContent ? state : fallback
}

function normalizeScenePlan(raw: unknown, fallback: ScenePlanStep[]): ScenePlanStep[] {
  if (!Array.isArray(raw)) return fallback

  const normalized = raw
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const purpose = asText(record.purpose)
      const beat = asText(record.beat)
      const title = asText(record.scene_title)
      if (!purpose && !beat && !title) return null

      return {
        scene_order: typeof record.scene_order === 'number' ? Math.round(record.scene_order) : index + 1,
        scene_title: title || `场景 ${index + 1}`,
        purpose,
        location: asText(record.location),
        time_anchor: asText(record.time_anchor),
        present_characters: toStringArray(record.present_characters),
        key_items: toStringArray(record.key_items),
        conflict: asText(record.conflict),
        beat,
        must_cover: toStringArray(record.must_cover),
        exit_hook: asText(record.exit_hook),
      }
    })
    .filter((item): item is ScenePlanStep => Boolean(item))

  return normalized.length > 0 ? normalized : fallback
}

function buildFallbackScenePlan(chapter: typeof chapters.$inferSelect): ScenePlanStep[] {
  const outlineLines = (chapter.outline || '')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)

  const seeds = outlineLines.length > 0
    ? outlineLines
    : [extractChapterGoal(chapter.outline) || `完成第${chapter.chapterNum}章的核心推进`]

  return seeds.map((line, index) => ({
    scene_order: index + 1,
    scene_title: `场景 ${index + 1}`,
    purpose: line,
    location: '',
    time_anchor: '',
    present_characters: [],
    key_items: [],
    conflict: '',
    beat: line,
    must_cover: [line],
    exit_hook: index === seeds.length - 1 ? '把本章推进到自然收束点。' : '把冲突继续推向下一段。',
  }))
}

function formatScenePlan(scenePlan: ScenePlanStep[]): string {
  return scenePlan
    .map((step) => {
      const parts = [
        `目标=${step.purpose}`,
        step.location ? `地点=${step.location}` : '',
        step.time_anchor ? `时间=${step.time_anchor}` : '',
        step.present_characters.length > 0 ? `人物=${step.present_characters.join('、')}` : '',
        step.key_items.length > 0 ? `物品=${step.key_items.join('、')}` : '',
        step.conflict ? `冲突=${step.conflict}` : '',
        step.beat ? `动作=${step.beat}` : '',
        step.must_cover.length > 0 ? `必须交代=${step.must_cover.join('；')}` : '',
        step.exit_hook ? `收尾=${step.exit_hook}` : '',
      ].filter(Boolean)
      return `${step.scene_order}. ${step.scene_title}\n${parts.join('\n')}`
    })
    .join('\n\n')
}

function normalizeReviewNotes(raw: unknown): ChapterReviewNotes {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  return {
    summary: asText(record.summary),
    critical_fixes: toStringArray(record.critical_fixes),
    continuity_risks: toStringArray(record.continuity_risks),
    language_risks: toStringArray(record.language_risks),
    missing_payoffs: toStringArray(record.missing_payoffs),
    strengths: toStringArray(record.strengths),
    revision_brief: asText(record.revision_brief),
  }
}

function hasReviewNotes(notes: ChapterReviewNotes): boolean {
  return Boolean(
    notes.summary ||
    notes.critical_fixes.length > 0 ||
    notes.continuity_risks.length > 0 ||
    notes.language_risks.length > 0 ||
    notes.missing_payoffs.length > 0 ||
    notes.strengths.length > 0 ||
    notes.revision_brief,
  )
}

function buildFallbackReviewNotes(consistencyNotes: string): ChapterReviewNotes {
  const consistencyLines = consistencyNotes
    .split('\n')
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  return {
    summary: '先按场景计划写顺结构，再统一修正承接和语言。',
    critical_fixes: ['逐段核对场景计划里的 must_cover 是否全部落地。'],
    continuity_risks: consistencyLines,
    language_risks: ['删除抽象口号、概念引号和不自然搭配。'],
    missing_payoffs: [],
    strengths: [],
    revision_brief: '保持当前剧情方向，重点修承接、人物状态、物品去向和语言自然度。',
  }
}

function formatReviewNotes(notes: ChapterReviewNotes): string {
  return [
    notes.summary ? `整体判断：${notes.summary}` : '',
    notes.critical_fixes.length > 0 ? `必须修改：\n- ${notes.critical_fixes.join('\n- ')}` : '',
    notes.continuity_risks.length > 0 ? `连续性风险：\n- ${notes.continuity_risks.join('\n- ')}` : '',
    notes.language_risks.length > 0 ? `语言风险：\n- ${notes.language_risks.join('\n- ')}` : '',
    notes.missing_payoffs.length > 0 ? `缺失回收：\n- ${notes.missing_payoffs.join('\n- ')}` : '',
    notes.strengths.length > 0 ? `可保留优点：\n- ${notes.strengths.join('\n- ')}` : '',
    notes.revision_brief ? `修订摘要：${notes.revision_brief}` : '',
  ].filter(Boolean).join('\n\n')
}

async function updateChapterContinuityState(
  chapterId: number,
  summaryData: ChapterSummaryData,
): Promise<ContinuityState> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) {
    throw new Error('章节内容为空，无法更新连续性记忆')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const arc = chapter.arcId
    ? db.select().from(storyArcs).where(eq(storyArcs.id, chapter.arcId)).all()[0]
    : null

  const fallback = buildFallbackContinuityState(chapter, summaryData)

  try {
    const result = await runChatTask({
      type: 'continuity',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{
        role: 'user',
        content: buildContinuityStatePrompt({
          novelTitle: novel.title,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
          arcName: arc?.arcName || '',
          chapterGoal: extractChapterGoal(chapter.outline),
          summary: summaryData.summary,
          chapterContent: chapter.content,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const parsed = safeParseJson<Record<string, unknown>>(result)
    const normalized = normalizeContinuityState(parsed, fallback)

    db.update(chapters).set({
      continuityStateJson: serializeContinuityState(normalized),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()

    return normalized
  } catch {
    db.update(chapters).set({
      continuityStateJson: serializeContinuityState(fallback),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()

    return fallback
  }
}

async function updateChapterSummaryData(chapterId: number): Promise<ChapterSummaryData> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throw new Error('章节内容为空，无法生成摘要')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  let summaryData: ChapterSummaryData
  try {
    const result = await runChatTask({
      type: 'summary',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{ role: 'user', content: chapterSummaryPrompt(chapter.content) }],
      modelConfigId: novel?.modelConfigId || undefined,
    })

    try {
      const parsed = safeParseJson<Record<string, unknown>>(result)
      summaryData = {
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
        nextChapterSeed: typeof parsed.next_chapter_seed === 'string' ? parsed.next_chapter_seed.trim() : '',
      }
    } catch {
      summaryData = {
        summary: result.trim(),
        nextChapterSeed: '',
      }
    }
  } catch {
    summaryData = {
      summary: chapter.content.slice(0, 180),
      nextChapterSeed: extractChapterGoal(chapter.outline),
    }
  }

  if (!summaryData.summary) {
    summaryData.summary = chapter.content.slice(0, 180)
  }

  db.update(chapters).set({
    summary: summaryData.summary,
    nextChapterSeed: summaryData.nextChapterSeed,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()

  return summaryData
}

async function refreshChapterMemory(chapterId: number): Promise<{
  summary: ChapterSummaryData
  continuity: ContinuityState
}> {
  const summary = await updateChapterSummaryData(chapterId)
  const continuity = await updateChapterContinuityState(chapterId, summary)
  return { summary, continuity }
}

async function finalizeGeneratedChapterContent(chapterId: number, content: string) {
  updateChapter(chapterId, {
    content,
    status: 'draft',
  })

  const { summary } = await refreshChapterMemory(chapterId)
  const chapter = getChapter(chapterId)
  if (chapter) {
    syncChapterTimelineStatuses(chapter.novelId, chapter.chapterNum)
  }

  return {
    chapterId,
    summary: summary.summary,
    nextChapterSeed: summary.nextChapterSeed,
    wordCount: chapter?.wordCount || 0,
    status: chapter?.status || 'draft',
  }
}

export function listChapters(novelId: number) {
  const db = getDb()
  return db.select().from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
}

export function getChapter(id: number) {
  const db = getDb()
  return db.select().from(chapters).where(eq(chapters.id, id)).all()[0] || null
}

export function createChapter(novelId: number, data: Partial<{
  chapterNum: number
  title: string
  outline: string
  targetWords: number
  emotionTone: string
  arcId: number
}>) {
  const db = getDb()
  const chapterNum = data.chapterNum ?? (db.select().from(chapters).where(eq(chapters.novelId, novelId)).all().length + 1)
  const result = db.insert(chapters).values({ novelId, ...data, chapterNum }).run()
  return Number(result.lastInsertRowid)
}

export function updateChapter(id: number, data: Partial<{
  title: string
  outline: string
  scenePlanJson: string
  content: string
  wordCount: number
  summary: string
  nextChapterSeed: string
  continuityStateJson: string
  reviewNotesJson: string
  status: string
  aiScoreJson: string
  targetWords: number
  emotionTone: string
  chapterNum: number
  arcId: number | null
}>) {
  const db = getDb()

  if (data.content !== undefined) {
    data.wordCount = countChineseWords(data.content)
  }

  db.update(chapters).set({
    ...data,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, id)).run()

  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  if (chapter) {
    const allChapters = db.select().from(chapters).where(eq(chapters.novelId, chapter.novelId)).all()
    const totalWords = allChapters.reduce((sum, item) => sum + (item.wordCount || 0), 0)
    db.update(novels).set({
      totalWords,
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, chapter.novelId)).run()
  }
}

export function deleteChapter(id: number) {
  const db = getDb()
  db.delete(chapters).where(eq(chapters.id, id)).run()
}

export async function generateChapterContent(chapterId: number, sender?: WebContents): Promise<number> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throw new Error(`Chapter #${chapterId} not found`)

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) throw new Error('Novel not found')

  const profile = await buildStoryProfile(chapter.novelId)
  const context = await buildChapterContext(chapter.novelId, chapter.chapterNum, 7200)
  const consistencyNotes = buildConsistencyPromptSummary(buildNovelConsistencyReport(chapter.novelId))
  const previousStatus = chapter.status || 'outline'
  const fallbackScenePlan = buildFallbackScenePlan(chapter)
  const storyCore = buildStoryCore(profile, context.storyCore)

  updateChapter(chapterId, {
    status: 'writing',
    scenePlanJson: '',
    reviewNotesJson: '',
  })

  try {
    sendGenerationProgress(sender, {
      chapterId,
      stage: 'planning',
      label: '场景计划',
      detail: '先把本章拆成可执行的场景链。',
      completed: 1,
      total: 4,
      status: 'running',
    })

    let scenePlan = fallbackScenePlan
    try {
      const scenePlanResult = await runChatTask({
        type: 'chapter_scene_plan',
        novelId: chapter.novelId,
        relatedEntityType: 'chapter',
        relatedEntityId: chapterId,
        messages: [{
          role: 'user',
          content: buildScenePlanPrompt({
            novelTitle: novel.title,
            chapterNum: chapter.chapterNum,
            chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
            chapterGoal: context.chapterGoal,
            plotPoints: chapter.outline || '',
            emotionTone: chapter.emotionTone || '平稳',
            targetWords: chapter.targetWords || 3000,
            storyCore,
            currentArc: context.currentArc,
            worldRules: context.worldRules,
            characterStates: context.characterStates,
            itemSummary: context.itemSummary,
            previousSummaries: context.previousSummaries,
            lastChapterEnding: context.lastChapterEnding,
            continuitySummary: context.continuitySummary,
            openLoops: context.openLoops,
            continuityNotes: context.continuityNotes,
            timelineSummary: context.timelineSummary,
            timelineOpenThreads: context.timelineOpenThreads,
            longTermMemory: context.longTermMemory,
            consistencyNotes,
            protagonistReference: profile.protagonistReference,
            protagonistRule: profile.protagonistRule,
          }),
        }],
        modelConfigId: novel.modelConfigId || undefined,
      })
      scenePlan = normalizeScenePlan(safeParseJson<unknown>(scenePlanResult), fallbackScenePlan)
    } catch {
      scenePlan = fallbackScenePlan
    }

    updateChapter(chapterId, { scenePlanJson: JSON.stringify(scenePlan) })
    const scenePlanText = formatScenePlan(scenePlan)

    sendGenerationProgress(sender, {
      chapterId,
      stage: 'drafting',
      label: '正文初稿',
      detail: '按场景计划生成第一版正文。',
      completed: 2,
      total: 4,
      status: 'running',
    })

    const draftContent = await runChatTask({
      type: 'chapter_draft',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{
        role: 'user',
        content: buildChapterDraftPrompt({
          novelTitle: novel.title,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
          chapterGoal: context.chapterGoal,
          emotionTone: chapter.emotionTone || '平稳',
          targetWords: chapter.targetWords || 3000,
          storyCore,
          currentArc: context.currentArc,
          worldRules: context.worldRules,
          characterStates: context.characterStates,
          itemSummary: context.itemSummary,
          previousSummaries: context.previousSummaries,
          lastChapterEnding: context.lastChapterEnding,
          continuitySummary: context.continuitySummary,
          openLoops: context.openLoops,
          continuityNotes: context.continuityNotes,
          timelineSummary: context.timelineSummary,
          timelineOpenThreads: context.timelineOpenThreads,
          longTermMemory: context.longTermMemory,
          consistencyNotes,
          scenePlan: scenePlanText,
          draftContent: '',
          reviewNotes: '',
          protagonistReference: profile.protagonistReference,
          protagonistRule: profile.protagonistRule,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    sendGenerationProgress(sender, {
      chapterId,
      stage: 'reviewing',
      label: '自动审校',
      detail: '检查承接、事件顺序和语言问题。',
      completed: 3,
      total: 4,
      status: 'running',
    })

    let reviewNotes = buildFallbackReviewNotes(consistencyNotes)
    try {
      const reviewResult = await runChatTask({
        type: 'chapter_review',
        novelId: chapter.novelId,
        relatedEntityType: 'chapter',
        relatedEntityId: chapterId,
        messages: [{
          role: 'user',
          content: buildChapterReviewPrompt({
            novelTitle: novel.title,
            chapterNum: chapter.chapterNum,
            chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
            chapterGoal: context.chapterGoal,
            storyCore,
            currentArc: context.currentArc,
            worldRules: context.worldRules,
            characterStates: context.characterStates,
            itemSummary: context.itemSummary,
            continuitySummary: context.continuitySummary,
            openLoops: context.openLoops,
            timelineSummary: context.timelineSummary,
            longTermMemory: context.longTermMemory,
            consistencyNotes,
            scenePlan: scenePlanText,
            draftContent,
            protagonistReference: profile.protagonistReference,
            protagonistRule: profile.protagonistRule,
          }),
        }],
        modelConfigId: novel.modelConfigId || undefined,
      })

      const normalizedNotes = normalizeReviewNotes(safeParseJson<unknown>(reviewResult))
      reviewNotes = hasReviewNotes(normalizedNotes) ? normalizedNotes : reviewNotes
    } catch {
      reviewNotes = buildFallbackReviewNotes(consistencyNotes)
    }

    updateChapter(chapterId, { reviewNotesJson: JSON.stringify(reviewNotes) })

    sendGenerationProgress(sender, {
      chapterId,
      stage: 'rewriting',
      label: '定稿润色',
      detail: '根据审校意见重写成可直接入稿的版本。',
      completed: 4,
      total: 4,
      status: 'running',
    })

    const prompt = buildChapterRewritePrompt({
      novelTitle: novel.title,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
      chapterGoal: context.chapterGoal,
      emotionTone: chapter.emotionTone || '平稳',
      targetWords: chapter.targetWords || 3000,
      storyCore,
      currentArc: context.currentArc,
      worldRules: context.worldRules,
      characterStates: context.characterStates,
      itemSummary: context.itemSummary,
      previousSummaries: context.previousSummaries,
      lastChapterEnding: context.lastChapterEnding,
      continuitySummary: context.continuitySummary,
      openLoops: context.openLoops,
      continuityNotes: context.continuityNotes,
      timelineSummary: context.timelineSummary,
      timelineOpenThreads: context.timelineOpenThreads,
      longTermMemory: context.longTermMemory,
      consistencyNotes,
      scenePlan: scenePlanText,
      draftContent,
      reviewNotes: formatReviewNotes(reviewNotes),
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
    })

    const messages = [{ role: 'user' as const, content: prompt }]

    return runStreamTask({
      type: 'chapter_write',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(messages),
      messages,
      modelConfigId: novel.modelConfigId || undefined,
      sender,
      onSuccess: async (output) => {
        const result = await finalizeGeneratedChapterContent(chapterId, output)
        sendGenerationProgress(sender, {
          chapterId,
          stage: 'completed',
          label: '生成完成',
          detail: '摘要、连续性记忆和时间轴状态已同步。',
          completed: 4,
          total: 4,
          status: 'success',
        })
        return result
      },
    })
  } catch (error) {
    updateChapter(chapterId, { status: previousStatus })
    sendGenerationProgress(sender, {
      chapterId,
      stage: 'failed',
      label: '生成失败',
      detail: error instanceof Error ? error.message : '章节生成中断',
      completed: 0,
      total: 4,
      status: 'failed',
    })
    throw error
  }
}

export async function generateChapterSummary(chapterId: number): Promise<void> {
  await refreshChapterMemory(chapterId)
}

export async function aiCheckChapter(chapterId: number): Promise<unknown> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throw new Error('章节内容为空')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  const content = chapter.content
  const textToCheck = content.length > 6000
    ? `${content.slice(0, 3200)}\n\n……\n\n${content.slice(-2400)}`
    : content

  const result = await runChatTask({
    type: 'ai_check',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    messages: [{ role: 'user', content: aiCheckPrompt(textToCheck) }],
    modelConfigId: novel?.modelConfigId || undefined,
  })

  try {
    const parsed = safeParseJson<Record<string, unknown>>(result)
    db.update(chapters).set({
      aiScoreJson: result,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    return parsed
  } catch {
    return { score: 0, issues: [], overall_feedback: result }
  }
}
