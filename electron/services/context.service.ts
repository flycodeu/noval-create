import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, characters, genres, novels, storyArcs, templates } from '../database/schema'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(Math.floor(maxTokens * 1.5), 0)
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}

interface ContextPart {
  priority: 0 | 1 | 2 | 3
  label: string
  content: string
}

export interface StorySubPlot {
  name: string
  characters: string
  conflict: string
  mainlineLink: string
  endChapter: string
}

export interface StorySettings {
  storyGoal: string
  coreConflict: string
  mainPlot: string
  ending: string
  subPlotsText: string
  subPlotsList: StorySubPlot[]
  rhythmSetup?: number
  rhythmConflict?: number
  rhythmEnding?: number
}

export interface StoryProfile {
  novelId: number
  novelTitle: string
  genre: string
  background: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  rhythmSummary: string
  worldRulesSummary: string
  styleTemplateSummary: string
  hasProtagonist: boolean
  protagonistName: string
  protagonistReference: string
  protagonistRule: string
}

export interface ContinuityState {
  plotProgress: string[]
  characterStateChanges: string[]
  worldStateChanges: string[]
  openLoops: string[]
  continuityNotes: string[]
  arcProgress: string
}

export interface OutlineGenerationContext {
  profile: StoryProfile
  arc: typeof storyArcs.$inferSelect
  previousSummary: string
  characterStates: string
  continuitySummary: string
  openLoops: string
  worldRulesSummary: string
}

export interface ChapterContext {
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  previousSummaries: string
  lastChapterEnding: string
  styleTemplate: string
  chapterGoal: string
  continuitySummary: string
  openLoops: string
  continuityNotes: string
}

interface ChapterWithContinuity {
  chapterNum: number
  summary: string
  nextChapterSeed: string
  content: string
  continuityState: ContinuityState
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asText).filter(Boolean)
}

function parseJsonRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function dedupe(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map(v => v.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function allocateTokens(parts: ContextPart[], totalBudget: number): Record<string, string> {
  const result: Record<string, string> = {}
  const p0Parts = parts.filter((part) => part.priority === 0)

  let usedTokens = 0
  for (const part of p0Parts) {
    result[part.label] = part.content
    usedTokens += estimateTokens(part.content)
  }

  const remaining = totalBudget - usedTokens
  if (remaining <= 0) {
    for (const part of p0Parts) {
      result[part.label] = truncateToTokens(part.content, Math.floor(totalBudget / Math.max(p0Parts.length, 1)))
    }
    for (const part of parts.filter((part) => part.priority > 0)) {
      result[part.label] = ''
    }
    return result
  }

  let budget = remaining
  for (const priority of [1, 2, 3] as const) {
    for (const part of parts.filter((item) => item.priority === priority)) {
      const needed = estimateTokens(part.content)
      if (budget <= 0) {
        result[part.label] = ''
      } else if (needed <= budget) {
        result[part.label] = part.content
        budget -= needed
      } else {
        result[part.label] = truncateToTokens(part.content, budget)
        budget = 0
      }
    }
  }

  return result
}

function parseSubPlots(value: unknown): StorySubPlot[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const subplot = item as Record<string, unknown>
      return {
        name: asText(subplot.name),
        characters: asText(subplot.characters),
        conflict: asText(subplot.conflict),
        mainlineLink: asText(subplot.mainlineLink),
        endChapter: asText(subplot.endChapter),
      }
    })
    .filter((subplot) => Object.values(subplot).some(Boolean))
}

export function parseStorySettings(raw?: string | null): StorySettings {
  const settings = parseJsonRecord(raw)

  return {
    storyGoal: asText(settings.story_goal),
    coreConflict: asText(settings.core_conflict),
    mainPlot: asText(settings.main_plot),
    ending: asText(settings.ending),
    subPlotsText: asText(settings.sub_plots),
    subPlotsList: parseSubPlots(settings.sub_plots_list),
    rhythmSetup: asNumber(settings.rhythm_setup),
    rhythmConflict: asNumber(settings.rhythm_conflict),
    rhythmEnding: asNumber(settings.rhythm_ending),
  }
}

function formatSubPlots(settings: StorySettings): string {
  if (settings.subPlotsList.length > 0) {
    return settings.subPlotsList
      .map((subplot, index) => {
        const parts = [
          subplot.name ? `名称：${subplot.name}` : '',
          subplot.conflict ? `冲突：${subplot.conflict}` : '',
          subplot.mainlineLink ? `关联：${subplot.mainlineLink}` : '',
          subplot.endChapter ? `收束章节：${subplot.endChapter}` : '',
        ].filter(Boolean)
        return `${index + 1}. ${parts.join('；')}`
      })
      .join('\n')
  }

  return settings.subPlotsText || '（暂无支线）'
}

function formatRhythmSummary(settings: StorySettings): string {
  const parts = [
    settings.rhythmSetup ? `前期铺垫 ${settings.rhythmSetup}%` : '',
    settings.rhythmConflict ? `中期冲突 ${settings.rhythmConflict}%` : '',
    settings.rhythmEnding ? `后期收束 ${settings.rhythmEnding}%` : '',
  ].filter(Boolean)

  return parts.length > 0 ? parts.join('，') : '（未配置）'
}

function formatWorldRulesSummary(raw?: string | null): string {
  if (!raw) return ''

  const rules = parseJsonRecord(raw)
  if (Object.keys(rules).length === 0) return raw

  const lines: string[] = []
  const powerSystem = rules.power_system && typeof rules.power_system === 'object'
    ? rules.power_system as Record<string, unknown>
    : undefined

  if (powerSystem) {
    const powerName = asText(powerSystem.name)
    const powerRules = asText(powerSystem.rules)
    const levels = toStringArray(powerSystem.levels)
    const schools = toStringArray(powerSystem.schools)
    if (powerName) lines.push(`力量体系：${powerName}`)
    if (powerRules) lines.push(`核心规则：${powerRules}`)
    if (levels.length > 0) lines.push(`境界层级：${levels.slice(0, 8).join(' / ')}`)
    if (schools.length > 0) lines.push(`体系分支：${schools.slice(0, 8).join(' / ')}`)
  }

  const simpleFields: Array<[string, string]> = [
    ['social_structure', '社会结构'],
    ['time_period', '时间背景'],
    ['technology_level', '技术水平'],
    ['virus_rules', '感染规则'],
    ['special_rules', '特殊规则'],
    ['disaster_type', '灾变类型'],
  ]

  for (const [key, label] of simpleFields) {
    const value = asText(rules[key])
    if (value) lines.push(`${label}：${value}`)
  }

  const listFields: Array<[string, string]> = [
    ['forbidden_elements', '禁止元素'],
    ['common_elements', '常见元素'],
    ['unique_features', '独特元素'],
  ]

  for (const [key, label] of listFields) {
    const items = toStringArray(rules[key])
    if (items.length > 0) lines.push(`${label}：${items.slice(0, 6).join('、')}`)
  }

  return lines.join('\n')
}

function formatStyleTemplateSummary(contentJson?: string | null): string {
  const content = parseJsonRecord(contentJson)
  if (Object.keys(content).length === 0) return ''

  const lines: string[] = []
  const fields: Array<[string, string]> = [
    ['perspective', '视角'],
    ['sentence_style', '句式'],
    ['emotion_style', '情感表达'],
    ['dialogue_style', '对话风格'],
    ['description_style', '描写风格'],
    ['example_tone', '整体调性'],
  ]

  for (const [key, label] of fields) {
    const value = asText(content[key])
    if (value) lines.push(`${label}：${value}`)
  }

  const forbidden = toStringArray(content.forbidden)
  if (forbidden.length > 0) {
    lines.push(`避免：${forbidden.slice(0, 5).join('、')}`)
  }

  return lines.join('\n')
}

function buildBackgroundText(novel: typeof novels.$inferSelect): string {
  return novel.expandedBackground || novel.synopsis || novel.userBackground || ''
}

function getCanonicalProtagonist(
  allCharacters: Array<typeof characters.$inferSelect>,
): typeof characters.$inferSelect | null {
  return allCharacters.find((character) =>
    character.roleType === 'protagonist' && Boolean(character.fullName?.trim())) || null
}

function buildProtagonistPolicy(allCharacters: Array<typeof characters.$inferSelect>) {
  const protagonist = getCanonicalProtagonist(allCharacters)
  const protagonistName = protagonist?.fullName?.trim() || ''

  if (!protagonistName) {
    return {
      hasProtagonist: false,
      protagonistName: '',
      protagonistReference: '主角',
      protagonistRule: '当前尚未创建主角。若涉及核心人物，只能使用“主角”指代，禁止新增任何具体姓名、化名或变体名；若上下文出现旧名字，也应统一视为“主角”。',
    }
  }

  return {
    hasProtagonist: true,
    protagonistName,
    protagonistReference: protagonistName,
    protagonistRule: `当前主角已创建，唯一合法姓名为“${protagonistName}”。若上下文出现“主角”或其他旧名字，都应视为同一人，并统一改写为“${protagonistName}”；禁止新增、替换或变体化主角姓名。`,
  }
}

function buildStoryCoreText(profile: StoryProfile): string {
  return [
    `故事核心目标：${profile.storyGoal || '（未填写）'}`,
    `核心冲突：${profile.coreConflict || '（未填写）'}`,
    `主线剧情：${profile.mainPlot || '（未填写）'}`,
    `支线剧情：${profile.subPlots || '（暂无支线）'}`,
    `结局方向：${profile.ending || '（未填写）'}`,
  ].join('\n')
}

function formatArcContext(arc?: typeof storyArcs.$inferSelect | null): string {
  if (!arc) return ''

  return [
    `故事弧：${arc.arcName}`,
    `章节范围：第${arc.chapterStart || '?'}章 - 第${arc.chapterEnd || '?'}章`,
    `本弧目标：${arc.arcGoal || '（未填写）'}`,
    `本弧概述：${arc.arcSummary || '（未填写）'}`,
  ].join('\n')
}

function getImportantCharacters(allCharacters: Array<typeof characters.$inferSelect>): Array<typeof characters.$inferSelect> {
  const rolePriority = ['protagonist', 'major', 'antagonist', 'supporting']
  return [...allCharacters]
    .sort((left, right) => rolePriority.indexOf(left.roleType || 'minor') - rolePriority.indexOf(right.roleType || 'minor'))
    .slice(0, 8)
}

function buildCharacterStates(
  allCharacters: Array<typeof characters.$inferSelect>,
  recentChapters: ChapterWithContinuity[],
): string {
  const protagonist = getCanonicalProtagonist(allCharacters)
  const staticLines = getImportantCharacters(allCharacters).map((character) => {
    const traits = character.personalityTraitsJson ? toStringArray(parseJsonRecord(`{"items":${character.personalityTraitsJson}}`).items).slice(0, 2).join('、') : ''
    const summary = [
      character.occupation || '',
      traits || '',
      character.goals || '',
      character.innerConflict || '',
      character.relationshipTension || '',
    ].filter(Boolean).join('；')
    const displayName = protagonist && character.id === protagonist.id ? protagonist.fullName : character.fullName
    return `${displayName}（${character.roleType || 'minor'}）：${summary || '暂无补充'}`
  })

  const dynamicLines = dedupe(
    recentChapters.flatMap((chapter) => chapter.continuityState.characterStateChanges.map((item) => `第${chapter.chapterNum}章：${item}`)),
    8,
  )

  return [...staticLines, ...dynamicLines].filter(Boolean).join('\n')
}

function extractChapterGoal(outline?: string | null): string {
  if (!outline) return ''
  const match = outline.match(/(?:^|\n)(?:目标|本章目标)[:：]\s*(.+)/)
  if (match?.[1]) return match[1].trim()

  const firstLine = outline.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || ''
}

export function parseContinuityState(raw?: string | null): ContinuityState {
  const parsed = parseJsonRecord(raw)
  return {
    plotProgress: toStringArray(parsed.plot_progress),
    characterStateChanges: toStringArray(parsed.character_state_changes),
    worldStateChanges: toStringArray(parsed.world_state_changes),
    openLoops: toStringArray(parsed.open_loops),
    continuityNotes: toStringArray(parsed.continuity_notes),
    arcProgress: asText(parsed.arc_progress),
  }
}

function hasContinuityContent(state: ContinuityState): boolean {
  return Boolean(
    state.plotProgress.length > 0 ||
    state.characterStateChanges.length > 0 ||
    state.worldStateChanges.length > 0 ||
    state.openLoops.length > 0 ||
    state.continuityNotes.length > 0 ||
    state.arcProgress,
  )
}

function formatContinuityEntry(chapter: ChapterWithContinuity): string {
  const parts = [
    chapter.summary ? `摘要：${chapter.summary}` : '',
    chapter.continuityState.plotProgress.length > 0 ? `推进：${chapter.continuityState.plotProgress.join('；')}` : '',
    chapter.continuityState.characterStateChanges.length > 0 ? `人物变化：${chapter.continuityState.characterStateChanges.join('；')}` : '',
    chapter.continuityState.worldStateChanges.length > 0 ? `世界变化：${chapter.continuityState.worldStateChanges.join('；')}` : '',
    chapter.continuityState.arcProgress ? `故事弧推进：${chapter.continuityState.arcProgress}` : '',
  ].filter(Boolean)

  return `第${chapter.chapterNum}章：${parts.join(' | ')}`
}

function collectOpenLoops(chapterRows: ChapterWithContinuity[]): string {
  const values = dedupe(chapterRows.flatMap((chapter) => chapter.continuityState.openLoops), 8)
  return values.join('\n')
}

function collectContinuityNotes(chapterRows: ChapterWithContinuity[]): string {
  const values = dedupe(chapterRows.flatMap((chapter) => chapter.continuityState.continuityNotes), 8)
  return values.join('\n')
}

function resolveArcForChapter(
  chapterNum: number,
  chapterArcId: number | null | undefined,
  arcs: Array<typeof storyArcs.$inferSelect>,
): typeof storyArcs.$inferSelect | null {
  if (chapterArcId) {
    const linkedArc = arcs.find((arc) => arc.id === chapterArcId)
    if (linkedArc) return linkedArc
  }

  return arcs.find((arc) => {
    const start = arc.chapterStart ?? Number.MIN_SAFE_INTEGER
    const end = arc.chapterEnd ?? Number.MAX_SAFE_INTEGER
    return chapterNum >= start && chapterNum <= end
  }) || null
}

function toChapterWithContinuity(row: typeof chapters.$inferSelect): ChapterWithContinuity {
  return {
    chapterNum: row.chapterNum,
    summary: row.summary || '',
    nextChapterSeed: row.nextChapterSeed || '',
    content: row.content || '',
    continuityState: parseContinuityState(row.continuityStateJson),
  }
}

export async function buildStoryProfile(novelId: number): Promise<StoryProfile> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const genre = novel.genreId
    ? db.select().from(genres).where(eq(genres.id, novel.genreId)).all()[0]
    : null
  const styleTemplate = novel.styleTemplateId
    ? db.select().from(templates).where(eq(templates.id, novel.styleTemplateId)).all()[0]
    : null
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, novelId)).all()

  const settings = parseStorySettings(novel.settingsJson)
  const protagonistPolicy = buildProtagonistPolicy(allCharacters)

  return {
    novelId,
    novelTitle: novel.title,
    genre: genre?.name || '未知题材',
    background: buildBackgroundText(novel),
    storyGoal: settings.storyGoal,
    coreConflict: settings.coreConflict,
    mainPlot: settings.mainPlot,
    subPlots: formatSubPlots(settings),
    ending: settings.ending,
    rhythmSummary: formatRhythmSummary(settings),
    worldRulesSummary: formatWorldRulesSummary(novel.worldRulesJson),
    styleTemplateSummary: formatStyleTemplateSummary(styleTemplate?.contentJson),
    hasProtagonist: protagonistPolicy.hasProtagonist,
    protagonistName: protagonistPolicy.protagonistName,
    protagonistReference: protagonistPolicy.protagonistReference,
    protagonistRule: protagonistPolicy.protagonistRule,
  }
}

export async function buildOutlineGenerationContext(arcId: number): Promise<OutlineGenerationContext> {
  const db = getDb()
  const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
  if (!arc) throw new Error('故事弧不存在')

  const profile = await buildStoryProfile(arc.novelId)
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, arc.novelId)).all()
  const previousRows = db.select().from(chapters)
    .where(eq(chapters.novelId, arc.novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.chapterNum < (arc.chapterStart || 1))

  const recentChapters = previousRows.slice(-5).map(toChapterWithContinuity)
  const previousSummary = recentChapters
    .filter((chapter) => chapter.summary)
    .map((chapter) => `第${chapter.chapterNum}章：${chapter.summary}`)
    .join('\n')

  const continuityChapters = recentChapters.filter((chapter) => hasContinuityContent(chapter.continuityState))

  return {
    profile,
    arc,
    previousSummary,
    characterStates: buildCharacterStates(allCharacters, recentChapters),
    continuitySummary: continuityChapters.map(formatContinuityEntry).join('\n'),
    openLoops: collectOpenLoops(continuityChapters),
    worldRulesSummary: profile.worldRulesSummary,
  }
}

export async function buildChapterContext(
  novelId: number,
  chapterNum: number,
  totalBudget: number = 6000,
): Promise<ChapterContext> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const currentChapter = chapterRows.find((chapter) => chapter.chapterNum === chapterNum)
  const arcs = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const currentArc = resolveArcForChapter(chapterNum, currentChapter?.arcId, arcs)
  const previousRows = chapterRows.filter((chapter) => chapter.chapterNum < chapterNum)
  const recentChapters = previousRows.slice(-5).map(toChapterWithContinuity)
  const continuityChapters = recentChapters.filter((chapter) => hasContinuityContent(chapter.continuityState))
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, novelId)).all()

  const previousSummaries = recentChapters
    .filter((chapter) => chapter.summary)
    .map((chapter) => `第${chapter.chapterNum}章：${chapter.summary}`)
    .join('\n')

  const previousChapter = recentChapters[recentChapters.length - 1]
  const lastChapterEnding = previousChapter
    ? [
        previousChapter.content ? previousChapter.content.slice(-300) : '',
        previousChapter.nextChapterSeed ? `[衔接提示] ${previousChapter.nextChapterSeed}` : '',
      ].filter(Boolean).join('\n')
    : ''

  const reservedForOutput = 2000
  const contextBudget = totalBudget - reservedForOutput

  const parts: ContextPart[] = [
    { priority: 0, label: 'chapterGoal', content: extractChapterGoal(currentChapter?.outline) },
    { priority: 0, label: 'storyCore', content: buildStoryCoreText(profile) },
    { priority: 0, label: 'currentArc', content: formatArcContext(currentArc) },
    { priority: 1, label: 'continuityNotes', content: collectContinuityNotes(continuityChapters) },
    { priority: 1, label: 'lastChapterEnding', content: lastChapterEnding },
    { priority: 1, label: 'openLoops', content: collectOpenLoops(continuityChapters) },
    { priority: 2, label: 'continuitySummary', content: continuityChapters.map(formatContinuityEntry).join('\n') },
    { priority: 2, label: 'characterStates', content: buildCharacterStates(allCharacters, recentChapters) },
    { priority: 2, label: 'previousSummaries', content: previousSummaries },
    { priority: 3, label: 'worldRules', content: profile.worldRulesSummary },
    { priority: 3, label: 'styleTemplate', content: profile.styleTemplateSummary },
  ]

  const allocated = allocateTokens(parts, contextBudget)

  return {
    storyCore: allocated.storyCore || '',
    currentArc: allocated.currentArc || '',
    worldRules: allocated.worldRules || '',
    characterStates: allocated.characterStates || '',
    previousSummaries: allocated.previousSummaries || '',
    lastChapterEnding: allocated.lastChapterEnding || '',
    styleTemplate: allocated.styleTemplate || '',
    chapterGoal: allocated.chapterGoal || '',
    continuitySummary: allocated.continuitySummary || '',
    openLoops: allocated.openLoops || '',
    continuityNotes: allocated.continuityNotes || '',
  }
}
