import { getDb } from '../database/db'
import { novels, chapters, characters, templates } from '../database/schema'
import { eq, asc } from 'drizzle-orm'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 1.5)
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '...'
}

interface ContextPart {
  priority: number // 0=必注入, 1=高, 2=中, 3=低
  label: string
  content: string
}

export interface ChapterContext {
  worldRules: string
  characterStates: string
  previousSummaries: string
  lastChapterEnding: string
  styleTemplate: string
  chapterGoal: string
}

// P0-P3 优先级动态分配：token超限时先裁P3→P2→P1，P0必注入
function allocateTokens(parts: ContextPart[], totalBudget: number): Record<string, string> {
  const result: Record<string, string> = {}

  // P0 必注入，先计算 P0 占用
  const p0Parts = parts.filter(p => p.priority === 0)
  let usedTokens = 0
  for (const p of p0Parts) {
    result[p.label] = p.content
    usedTokens += estimateTokens(p.content)
  }

  const remaining = totalBudget - usedTokens
  if (remaining <= 0) {
    // P0 已超限，截断 P0 内容
    for (const p of p0Parts) {
      result[p.label] = truncateToTokens(p.content, Math.floor(totalBudget / p0Parts.length))
    }
    // 其他 priority 全部清空
    const others = parts.filter(p => p.priority > 0)
    for (const p of others) result[p.label] = ''
    return result
  }

  // 按 P1, P2, P3 顺序分配剩余 token
  let budget = remaining
  for (const priority of [1, 2, 3]) {
    const pParts = parts.filter(p => p.priority === priority)
    for (const p of pParts) {
      const needed = estimateTokens(p.content)
      if (budget <= 0) {
        result[p.label] = ''
      } else if (needed <= budget) {
        result[p.label] = p.content
        budget -= needed
      } else {
        // 部分注入，截断到剩余 budget
        result[p.label] = truncateToTokens(p.content, budget)
        budget = 0
      }
    }
  }

  return result
}

export async function buildChapterContext(
  novelId: number,
  chapterNum: number,
  totalBudget: number = 6000
): Promise<ChapterContext> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  // 获取文风模板
  let styleTemplate = ''
  if (novel.styleTemplateId) {
    const tmpl = db.select().from(templates).where(eq(templates.id, novel.styleTemplateId)).all()[0]
    if (tmpl?.contentJson) {
      const content = JSON.parse(tmpl.contentJson)
      styleTemplate = `视角：${content.perspective || ''}\n句式：${content.sentence_style || ''}\n情感：${content.emotion_style || ''}\n对话：${content.dialogue_style || ''}`
    }
  }

  // 世界规则
  let worldRules = ''
  if (novel.worldRulesJson) {
    try {
      const rules = JSON.parse(novel.worldRulesJson)
      const ruleParts = []
      if (rules.power_system) ruleParts.push(`力量体系：${JSON.stringify(rules.power_system)}`)
      if (rules.forbidden_elements) ruleParts.push(`禁止元素：${rules.forbidden_elements.join('、')}`)
      if (rules.social_structure) ruleParts.push(`社会结构：${rules.social_structure}`)
      worldRules = ruleParts.join('\n')
    } catch {
      worldRules = novel.worldRulesJson
    }
  }

  // 前N章摘要
  const prevChapters = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter(c => c.chapterNum < chapterNum && c.summary)

  let previousSummaries = ''
  if (prevChapters.length > 0) {
    const recent = prevChapters.slice(-5)
    previousSummaries = recent.map(c => `第${c.chapterNum}章：${c.summary}`).join('\n')
  }

  // 上一章结尾
  let lastChapterEnding = ''
  const prevChapter = prevChapters[prevChapters.length - 1]
  if (prevChapter?.content) {
    lastChapterEnding = prevChapter.content.slice(-500)
    if (prevChapter.nextChapterSeed) {
      lastChapterEnding += `\n[衔接提示：${prevChapter.nextChapterSeed}]`
    }
  }

  // 本章相关人物状态
  const currentChapter = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
    .find(c => c.chapterNum === chapterNum)

  let characterStates = ''
  const allChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  if (allChars.length > 0) {
    const mainChars = allChars.filter(c => ['protagonist', 'major', 'antagonist'].includes(c.roleType || ''))
    characterStates = mainChars.map(c => {
      const traits = c.personalityTraitsJson ? JSON.parse(c.personalityTraitsJson).slice(0, 2).join('、') : ''
      return `${c.fullName}（${c.roleType}）：${c.occupation || ''}，${traits}`
    }).join('\n')
  }

  const chapterGoal = currentChapter?.outline || ''

  // 构建优先级部分，预留 reservedTokens 给生成内容
  const reservedForOutput = 2000
  const contextBudget = totalBudget - reservedForOutput

  const parts: ContextPart[] = [
    { priority: 0, label: 'chapterGoal', content: chapterGoal },
    { priority: 0, label: 'styleTemplate', content: styleTemplate },
    { priority: 1, label: 'lastChapterEnding', content: lastChapterEnding },
    { priority: 1, label: 'characterStates', content: characterStates },
    { priority: 2, label: 'previousSummaries', content: previousSummaries },
    { priority: 3, label: 'worldRules', content: worldRules },
  ]

  const allocated = allocateTokens(parts, contextBudget)

  return {
    worldRules: allocated.worldRules || '',
    characterStates: allocated.characterStates || '',
    previousSummaries: allocated.previousSummaries || '',
    lastChapterEnding: allocated.lastChapterEnding || '',
    styleTemplate: allocated.styleTemplate || '',
    chapterGoal: allocated.chapterGoal || '',
  }
}
