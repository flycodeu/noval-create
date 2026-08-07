import { asc, desc, eq } from 'drizzle-orm'
import type {
  ChapterBridgePlan,
  HookContinuitySnapshot,
  PovRotationPlan,
  StoryPacingCurve,
  VoiceEvolutionProfile,
} from '../../src/types'
import type { ThemeVoiceDocument } from '../../src/shared/theme-voice'
import { getDb } from '../database/db'
import { chapterContracts, chapters, sceneContracts } from '../database/schema'
import { getDialogueAnalyticsSnapshot } from './dialogue-fingerprint.service'

type ChapterRow = typeof chapters.$inferSelect

interface ParsedReviewNotes {
  readerHookRisks: string[]
  paceMarker: string
  chapterFunctionPrimary: string
}

interface ParsedContinuityState {
  openLoops: string[]
  continuityNotes: string[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => asText(item)).filter(Boolean)
}

function parseReviewNotes(raw: string | null | undefined): ParsedReviewNotes {
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object') {
    return { readerHookRisks: [], paceMarker: '', chapterFunctionPrimary: '' }
  }
  const record = parsed as Record<string, unknown>
  return {
    readerHookRisks: parseStringArray(record.reader_hook_risks),
    paceMarker: asText(record.pace_marker),
    chapterFunctionPrimary: asText(record.chapter_function_primary),
  }
}

function parseContinuityState(raw: string | null | undefined): ParsedContinuityState {
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object') {
    return { openLoops: [], continuityNotes: [] }
  }
  const record = parsed as Record<string, unknown>
  return {
    openLoops: parseStringArray(record.openLoops ?? record.open_loops),
    continuityNotes: parseStringArray(record.continuityNotes ?? record.continuity_notes),
  }
}

function parseScenePlan(raw: string | null | undefined): Array<Record<string, unknown>> {
  const parsed = parseJson(raw)
  return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []
}

function parseTimeLocation(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[，。；：]/g, ' ')
    .trim()
}

function extractLocationFromScenePlan(raw: string | null | undefined, position: 'first' | 'last'): string {
  const plan = parseScenePlan(raw)
  const entry = position === 'first' ? plan[0] : plan[plan.length - 1]
  if (!entry) return ''
  return asText(entry.location || entry.location_name)
}

function deriveTimeJumpHint(timeLocation: string, chapterGoal: string): string {
  const haystack = `${timeLocation} ${chapterGoal}`
  if (/翌日|次日|第二天|天亮|清晨|夜里|夜深/u.test(haystack)) return '存在短时跳切，开场 1 段内写清新的时间锚点。'
  if (/数日|几天|一周|半月|一月|数月|多年/u.test(haystack)) return '存在明显时间跳跃，必须先交代跳跃幅度和期间发生的关键变化。'
  return '默认紧接上章，只允许做极短时过渡。'
}

function normalizePovLabel(themeVoice?: ThemeVoiceDocument | null): string {
  if (!themeVoice?.pov) return '沿用当前章节已定义 POV'
  if (themeVoice.pov === 'first_person') return '第一人称'
  if (themeVoice.pov === 'third_limited') return '第三人称限视角'
  if (themeVoice.pov === 'third_omniscient') return '第三人称全知'
  return '多视角'
}

function pickChapterMarker(chapter: ChapterRow): string {
  const notes = parseReviewNotes(chapter.reviewNotesJson)
  return notes.chapterFunctionPrimary || notes.paceMarker || chapter.emotionTone || ''
}

function isHighEnergyMarker(marker: string): boolean {
  return /climax|高潮|决战|爆发|reversal|反转/u.test(marker)
}

function roundMetric(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = asText(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return typeof limit === 'number' ? result.slice(0, limit) : result
}

function getChapterById(chapterId: number): ChapterRow | null {
  const db = getDb()
  return db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0] || null
}

function listRecentChapters(novelId: number, beforeChapterNum: number, limit: number): ChapterRow[] {
  const db = getDb()
  return db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(desc(chapters.chapterNum))
    .all()
    .filter((row) => row.chapterNum < beforeChapterNum)
    .slice(0, limit)
}

export function buildChapterBridgePlan(
  chapterId: number,
  options: {
    themeVoice?: ThemeVoiceDocument | null
    chapterGoal?: string
  } = {},
): ChapterBridgePlan | null {
  const db = getDb()
  const chapter = getChapterById(chapterId)
  if (!chapter) return null
  const previousChapter = db.select().from(chapters)
    .where(eq(chapters.novelId, chapter.novelId))
    .orderBy(desc(chapters.chapterNum))
    .all()
    .find((row) => row.chapterNum < chapter.chapterNum)
  if (!previousChapter) return null

  const firstScene = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.id))
    .all()[0]
  const previousContinuity = parseContinuityState(previousChapter.continuityStateJson)
  const previousLocation = extractLocationFromScenePlan(previousChapter.scenePlanJson, 'last')
  const currentLocation = firstScene?.timeLocation || extractLocationFromScenePlan(chapter.scenePlanJson, 'first')
  const chapterGoal = asText(options.chapterGoal || chapter.outline)
  const openingMove = dedupeStrings([
    previousChapter.nextChapterSeed || '',
    previousContinuity.openLoops[0] || '',
    chapterGoal,
  ], 1)[0] || '先接住上章未完成动作，再推进本章主任务。'
  const locationTransition = previousLocation && currentLocation
    ? previousLocation === currentLocation
      ? `继续停留在 ${parseTimeLocation(currentLocation)}，开场先交代承接动作。`
      : `从 ${parseTimeLocation(previousLocation)} 过渡到 ${parseTimeLocation(currentLocation)}，必须补足移动或切场依据。`
    : currentLocation
      ? `开场落点为 ${parseTimeLocation(currentLocation)}，需要先说明为什么来到这里。`
      : '场景落点未完全定义，开头必须先补地点与进入方式。'
  const timeJump = deriveTimeJumpHint(firstScene?.timeLocation || '', chapterGoal)
  const previousTone = asText(previousChapter.emotionTone)
  const currentTone = asText(chapter.emotionTone)
  const emotionCarry = previousTone && currentTone && previousTone !== currentTone
    ? `先延续上章的 ${previousTone} 余波，再在开场 1-2 段内自然转入 ${currentTone}。`
    : previousTone
      ? `延续上章 ${previousTone} 的情绪惯性，不要开头直接断档。`
      : '从未完成动作、关系余波或现场后果承接情绪，而不是空降新气氛。'
  const allowedPov = asText(firstScene?.pov) || normalizePovLabel(options.themeVoice)
  const infoGapGuard = options.themeVoice?.viewpointMode === 'rotating' || options.themeVoice?.pov === 'multi_pov'
    ? '轮换视角章节必须在场景边界切 POV；未切换前只能写当前 POV 已知信息。'
    : '固定视角章节只允许写当前 POV 看见、听见、感到或合理推断的信息。'
  const bridgeWarnings = dedupeStrings([
    previousLocation && currentLocation && previousLocation !== currentLocation ? '地点已变化，但当前章节必须补足位移承接。' : '',
    previousTone && currentTone && previousTone !== currentTone ? '情绪基调发生切换，开头不能直接跳平。' : '',
    !firstScene?.pov ? '首场景缺少 POV 标注，承接时容易出现视角断层。': '',
  ])
  // 抽象 seed 只承接“事”，不承接上一章真实的结尾画面；强收尾意象若无人呼应，
  // 读者会感到断链。取上一章正文尾段作为回响义务注入。
  const previousEndingText = asText(previousChapter.content).trim()
  const endingEcho = previousEndingText
    ? `上一章结尾原文（收尾画面/悬念）：“${previousEndingText.slice(-160).replace(/\s+/g, ' ')}”。本章前半部分必须至少呼应一次（推进它、让人物提及或以环境细节回响）；确要延后回收时，需在正文中给出可见的挂起理由，不允许无痕丢弃。`
    : ''

  return {
    sourceChapterId: previousChapter.id,
    sourceChapterNum: previousChapter.chapterNum,
    locationTransition,
    timeJump,
    emotionCarry,
    openingMove,
    endingEcho,
    firstSceneConstraint: `前 200 字必须先接住上章结尾，再把动作落到 ${parseTimeLocation(currentLocation) || '本章首场景'}。`,
    allowedPov,
    infoGapGuard,
    bridgeWarnings,
    createdAt: new Date().toISOString(),
  }
}

export function formatChapterBridgePlan(plan: ChapterBridgePlan | null | undefined): string {
  if (!plan) return ''
  return [
    plan.sourceChapterNum ? `承接来源：第${plan.sourceChapterNum}章` : '',
    `地点承接：${plan.locationTransition}`,
    `时间承接：${plan.timeJump}`,
    `情绪承接：${plan.emotionCarry}`,
    `开场动作：${plan.openingMove}`,
    plan.endingEcho ? `结尾意象承接：${plan.endingEcho}` : '',
    `首场景约束：${plan.firstSceneConstraint}`,
    `POV 边界：${plan.allowedPov}`,
    `信息差保护：${plan.infoGapGuard}`,
    plan.bridgeWarnings.length > 0 ? `风险提醒：${plan.bridgeWarnings.join('；')}` : '',
  ].filter(Boolean).join('\n')
}

export function buildPovRotationPlan(
  chapterId: number,
  themeVoice?: ThemeVoiceDocument | null,
): PovRotationPlan {
  const chapter = getChapterById(chapterId)
  if (!chapter) {
    return {
      recommendedPov: '',
      previousPov: '',
      reason: '当前章节不存在。',
      infoGapGuard: '只写当前 POV 已知信息。',
      shouldRotate: false,
      warnings: ['章节不存在，无法生成 POV 轮转建议。'],
    }
  }
  const db = getDb()
  const currentScenePovs = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.id))
    .all()
    .map((row) => asText(row.pov))
    .filter(Boolean)
  const previousScenePov = listRecentChapters(chapter.novelId, chapter.chapterNum, 1)
    .flatMap((row) => db.select().from(sceneContracts).where(eq(sceneContracts.chapterId, row.id)).orderBy(asc(sceneContracts.id)).all())
    .map((row) => asText(row.pov))
    .find(Boolean) || ''
  const recommendedPov = currentScenePovs[0] || previousScenePov || normalizePovLabel(themeVoice)
  const rotating = themeVoice?.viewpointMode === 'rotating' || themeVoice?.pov === 'multi_pov'
  const shouldRotate = Boolean(rotating && previousScenePov && recommendedPov && previousScenePov === recommendedPov)
  const warnings = dedupeStrings([
    rotating && shouldRotate ? `上一章首 POV 与本章推荐 POV 都是 ${recommendedPov}，建议确认是否需要轮换。` : '',
    currentScenePovs.length === 0 ? '本章场景合同还没有 POV 标注。' : '',
  ])
  return {
    recommendedPov,
    previousPov: previousScenePov,
    reason: rotating
      ? shouldRotate
        ? '当前作品设置为轮换视角，但最近两章 POV 未明显轮换。'
        : '当前作品允许轮换视角，本章应显式确认切换边界。'
      : '当前作品以固定视角为主，本章保持单一 POV 更稳。',
    infoGapGuard: rotating
      ? '切 POV 只能发生在场景边界；段内禁止并列读取多名角色的内心。'
      : '固定视角章节不能偷跑到非 POV 角色的心理与场外信息。',
    shouldRotate,
    warnings,
  }
}

export function buildStoryPacingCurve(
  novelId: number,
  chapterNum: number,
  emotionTone: string,
  currentMarker = '',
): StoryPacingCurve {
  const recent = listRecentChapters(novelId, chapterNum, 8).sort((left, right) => left.chapterNum - right.chapterNum)
  const markers = recent.map((row) => ({
    chapterNum: row.chapterNum,
    marker: pickChapterMarker(row),
  }))
  const climaxChapters = markers.filter((item) => isHighEnergyMarker(item.marker)).map((item) => item.chapterNum)
  const recentClimaxSpacing = climaxChapters.slice(1).map((value, index) => value - climaxChapters[index])
  const latestMarker = markers.at(-1)?.marker || ''
  const previousMarker = markers.at(-2)?.marker || ''
  const hasDenseClimax = isHighEnergyMarker(latestMarker) && isHighEnergyMarker(previousMarker)
  const latestClimax = climaxChapters.at(-1) || 0
  const gapFromLatestClimax = latestClimax > 0 ? chapterNum - latestClimax : 999
  const shouldBreather = hasDenseClimax
  const shouldEscalate = gapFromLatestClimax >= 8
  const targetMarker = shouldBreather
    ? 'breather'
    : shouldEscalate
      ? 'reversal'
      : isHighEnergyMarker(emotionTone) || isHighEnergyMarker(currentMarker)
        ? 'climax'
        : currentMarker || emotionTone || 'progression'
  const warning = shouldBreather
    ? '最近两章节奏都偏高，本章应主动收束或给读者喘息位。'
    : shouldEscalate
      ? `已经连续 ${gapFromLatestClimax} 章没有明显高潮/反转，建议本章补强推进。`
      : ''
  return {
    label: `第${chapterNum}章节奏位`,
    targetMarker,
    actualMarker: currentMarker || emotionTone || '',
    shouldBreather,
    shouldEscalate,
    recentClimaxSpacing,
    warning,
    guidance: shouldBreather
      ? '本章优先做承接、代价延续和关系余波，不要再连续堆高声量。'
      : shouldEscalate
        ? '本章需要给出更明确的逆转、代价或钩子，不宜继续平推铺垫。'
        : '本章保持当前节奏角色，但要让章内冲突和章尾钩子明确落地。',
    updatedAt: new Date().toISOString(),
  }
}

export function buildHookContinuitySnapshot(
  chapterId: number,
  hookStrengthScore = 0,
): HookContinuitySnapshot {
  const db = getDb()
  const chapter = getChapterById(chapterId)
  if (!chapter) {
    return {
      hookType: '',
      hookStrengthScore: 0,
      unresolvedHookChain: [],
      weakHookStreak: 0,
      recentHookTypes: [],
      warning: '章节不存在。',
      updatedAt: new Date().toISOString(),
    }
  }
  const recent = db.select().from(chapters)
    .where(eq(chapters.novelId, chapter.novelId))
    .orderBy(desc(chapters.chapterNum))
    .all()
    .filter((row) => row.chapterNum <= chapter.chapterNum)
    .slice(0, 6)
  const contractByChapterId = new Map(
    db.select().from(chapterContracts)
      .where(eq(chapterContracts.novelId, chapter.novelId))
      .all()
      .map((row) => [row.chapterId, asText(row.hookType)] as const),
  )
  const recentHookTypes = dedupeStrings(recent.map((row) => contractByChapterId.get(row.id) || '').filter(Boolean), 6)
  const weakHookStreak = (() => {
    let count = 0
    for (const row of recent) {
      const stored = parseJson(row.hookContinuityJson)
      const storedScore = stored && typeof stored === 'object'
        ? Number((stored as Record<string, unknown>).hookStrengthScore || 0)
        : 0
      const notes = parseReviewNotes(row.reviewNotesJson)
      const score = row.id === chapterId ? hookStrengthScore : storedScore
      const weak = score < 70 || notes.readerHookRisks.length > 0 || !contractByChapterId.get(row.id)
      if (!weak) break
      count += 1
    }
    return count
  })()
  const currentHookType = contractByChapterId.get(chapterId) || ''
  const unresolvedHookChain = dedupeStrings([
    asText(chapter.nextChapterSeed),
    ...parseContinuityState(chapter.continuityStateJson).openLoops.slice(0, 3),
  ], 4)
  return {
    hookType: currentHookType,
    hookStrengthScore: roundMetric(hookStrengthScore),
    unresolvedHookChain,
    weakHookStreak,
    recentHookTypes,
    warning: weakHookStreak >= 2
      ? `已连续 ${weakHookStreak} 章钩子偏弱，本章章尾需要更明确的未完成动作或新压力。`
      : !currentHookType
        ? '当前章节合同缺少 hookType，章尾承接容易偏弱。'
        : '',
    updatedAt: new Date().toISOString(),
  }
}

export function buildVoiceEvolutionProfiles(
  novelId: number,
  activeCharacterIds: number[] = [],
): VoiceEvolutionProfile[] {
  const snapshot = getDialogueAnalyticsSnapshot(novelId)
  const activeIdSet = new Set(activeCharacterIds.filter((value) => Number.isFinite(value) && value > 0))
  const signatures = snapshot.characterDialogueSignatures
  return snapshot.dialogueDriftTrend
    .filter((entry) => activeIdSet.size === 0 || activeIdSet.has(entry.characterId))
    .slice(0, 4)
    .map((entry) => {
      const signature = signatures.find((item) => item.characterId === entry.characterId)
      return {
        characterId: entry.characterId,
        characterName: entry.characterName,
        stageLabel: `近期漂移率 ${entry.recentDriftRate}%`,
        allowedChanges: dedupeStrings(entry.reasons.slice(0, 2).map((reason) => `允许轻微变化：${reason}`), 2),
        stableAnchors: dedupeStrings([
          signature?.compareHints[0] ? `保留差异抓手：${signature.compareHints[0]}` : '',
          signature?.catchphraseCandidates[0]?.token ? `保留重复短语：${signature.catchphraseCandidates[0].token}` : '',
          signature?.distinctiveHabits[0] ? `保留习惯：${signature.distinctiveHabits[0]}` : '',
        ], 3),
        riskyChanges: dedupeStrings(entry.reasons.slice(0, 2).map((reason) => `不要一次性推翻：${reason}`), 2),
        summary: `${entry.characterName} 可以随弧线轻微变化语速、停顿或情绪密度，但称呼、关系温度和核心语气锚点必须保留。`,
      }
    })
}
