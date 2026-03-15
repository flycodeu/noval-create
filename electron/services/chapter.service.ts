import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'
import { eq, asc } from 'drizzle-orm'
import { runStreamTask, runChatTask } from './task.service'
import { chapterWritingPrompt, chapterSummaryPrompt, aiCheckPrompt } from './prompts'
import { safeParseJson } from '../utils/json'
import { buildChapterContext } from './context.service'
import { WebContents } from 'electron'

function countChineseWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
}

export function listChapters(novelId: number) {
  const db = getDb()
  return db.select().from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
}

export function getChapter(id: number) {
  const db = getDb()
  const rows = db.select().from(chapters).where(eq(chapters.id, id)).all()
  return rows[0] || null
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
  // 自动计算下一章节序号
  if (!data.chapterNum) {
    const existing = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    data.chapterNum = existing.length + 1
  }
  const result = db.insert(chapters).values({ novelId, ...data }).run()
  return Number(result.lastInsertRowid)
}

export function updateChapter(id: number, data: Partial<{
  title: string
  outline: string
  content: string
  wordCount: number
  summary: string
  nextChapterSeed: string
  status: string
  aiScoreJson: string
  targetWords: number
  emotionTone: string
}>) {
  const db = getDb()

  // 自动计算字数
  if (data.content !== undefined) {
    data.wordCount = countChineseWords(data.content)
  }

  db.update(chapters).set({
    ...data,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, id)).run()

  // 更新小说总字数
  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  if (chapter) {
    const allChapters = db.select().from(chapters).where(eq(chapters.novelId, chapter.novelId)).all()
    const totalWords = allChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0)
    db.update(novels).set({ totalWords, updatedAt: new Date().toISOString() })
      .where(eq(novels.id, chapter.novelId)).run()
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

  const context = await buildChapterContext(chapter.novelId, chapter.chapterNum, 4000)

  const worldRulesJson = novel.worldRulesJson ? JSON.parse(novel.worldRulesJson) : {}
  const settingsJson = novel.settingsJson ? JSON.parse(novel.settingsJson) : {}

  const prompt = chapterWritingPrompt({
    novelTitle: novel.title,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
    chapterGoal: context.chapterGoal || '',
    plotPoints: chapter.outline || '',
    emotionTone: chapter.emotionTone || '平静',
    worldRules: context.worldRules,
    characterStates: context.characterStates,
    previousSummaries: context.previousSummaries,
    lastChapterEnding: context.lastChapterEnding,
    styleTemplate: context.styleTemplate,
    targetWords: chapter.targetWords || 3000,
  })

  const taskId = await runStreamTask({
    type: 'chapter_write',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    inputJson: JSON.stringify([{ role: 'user', content: prompt }]),
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
    sender,
  })

  return taskId
}

export async function generateChapterSummary(chapterId: number): Promise<void> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throw new Error('章节内容为空，无法生成摘要')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]

  const prompt = chapterSummaryPrompt(chapter.content)
  const result = await runChatTask({
    type: 'summary',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel?.modelConfigId || undefined,
  })

  try {
    const parsed = safeParseJson<Record<string, unknown>>(result)
    db.update(chapters).set({
      summary: parsed.summary,
      nextChapterSeed: parsed.next_chapter_seed,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
  } catch {
    // 摘要解析失败，存原始文本
    db.update(chapters).set({
      summary: result,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
  }
}

export async function aiCheckChapter(chapterId: number): Promise<unknown> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throw new Error('章节内容为空')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]

  // 只检测前 2000 字
  const textToCheck = chapter.content.slice(0, 2000)
  const prompt = aiCheckPrompt(textToCheck)

  const result = await runChatTask({
    type: 'ai_check',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    messages: [{ role: 'user', content: prompt }],
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
