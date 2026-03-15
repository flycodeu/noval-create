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
  buildChapterWritingPrompt,
  buildContinuityStatePrompt,
} from './story-prompts'
import { runChatTask, runStreamTask } from './task.service'

interface ChapterSummaryData {
  summary: string
  nextChapterSeed: string
}

function countChineseWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
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

function buildFallbackContinuityState(chapter: typeof chapters.$inferSelect, summaryData: ChapterSummaryData): ContinuityState {
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
  content: string
  wordCount: number
  summary: string
  nextChapterSeed: string
  continuityStateJson: string
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
  if (!chapter) throw new Error(`章节 #${chapterId} 不存在`)

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(chapter.novelId)
  const context = await buildChapterContext(chapter.novelId, chapter.chapterNum, 4500)

  updateChapter(chapterId, { status: 'writing' })

  const prompt = buildChapterWritingPrompt({
    novelTitle: novel.title,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
    chapterGoal: context.chapterGoal,
    plotPoints: chapter.outline || '',
    emotionTone: chapter.emotionTone || '平稳',
    targetWords: chapter.targetWords || 3000,
    storyCore: context.storyCore || [
      `故事核心目标：${profile.storyGoal || '（未填写）'}`,
      `核心冲突：${profile.coreConflict || '（未填写）'}`,
      `主线剧情：${profile.mainPlot || '（未填写）'}`,
      `支线剧情：${profile.subPlots || '（暂无支线）'}`,
      `结局方向：${profile.ending || '（未填写）'}`,
    ].join('\n'),
    currentArc: context.currentArc,
    worldRules: context.worldRules,
    characterStates: context.characterStates,
    previousSummaries: context.previousSummaries,
    lastChapterEnding: context.lastChapterEnding,
    styleTemplate: context.styleTemplate,
    continuitySummary: context.continuitySummary,
    openLoops: context.openLoops,
    continuityNotes: context.continuityNotes,
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
    onSuccess: async (output) => finalizeGeneratedChapterContent(chapterId, output),
  })
}

export async function generateChapterSummary(chapterId: number): Promise<void> {
  await refreshChapterMemory(chapterId)
}

export async function aiCheckChapter(chapterId: number): Promise<unknown> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throw new Error('章节内容为空')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  const textToCheck = chapter.content.slice(0, 2000)
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
