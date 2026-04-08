import { asc, eq } from 'drizzle-orm'
import type {
  ChapterDialogueReviewData,
  CharacterDialogueDriftEntry,
  CharacterDialogueFingerprint,
  CharacterDialogueFingerprintRecord,
  CharacterDialogueSignature,
  CrossCharacterDialogueSimilarity,
  DialogueAlert,
  DialogueDriftWarning,
  DialogueFingerprintStats,
  DialogueSimilarityWarning,
  DialogueTokenStat,
  VolumeDialogueSimilarityEntry,
} from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import {
  chapters,
  characterDialogueFingerprints,
  characters,
  novels,
  storyVolumes,
} from '../database/schema'
import { getAdapterById, getDefaultAdapter } from './model.service'

type CharacterRow = typeof characters.$inferSelect
type ChapterRow = Pick<typeof chapters.$inferSelect, 'id' | 'chapterNum' | 'volumeId' | 'content'>

interface DialogueTurn {
  chapterId: number
  chapterNum: number
  volumeId?: number | null
  characterId?: number
  characterName?: string
  text: string
}

interface CharacterAlias {
  id: number
  fullName: string
  alias: string
}

interface DialogueSummaryPayload {
  voiceProfile: string
  distinctiveHabits: string[]
  antiPatterns: string[]
  compareHints: string[]
}

interface DialogueAnalyticsSnapshot {
  dialogueFingerprintStats: DialogueFingerprintStats
  characterDialogueSignatures: CharacterDialogueSignature[]
  crossCharacterDialogueSimilarity: CrossCharacterDialogueSimilarity[]
  dialogueDriftTrend: CharacterDialogueDriftEntry[]
  volumeDialogueSimilarity: VolumeDialogueSimilarityEntry[]
  recentDialogueAlerts: DialogueAlert[]
}

const QUOTE_REGEX = /[“「『"]([\s\S]{1,180}?)[”」』"]/gu
const SPEAKER_VERBS = ['说', '道', '问', '答', '回', '喊', '叫', '笑', '骂', '低声', '轻声', '沉声', '冷声', '咬牙', '喃喃', '嘀咕', '开口', '补充', '反问', '解释']
const MODAL_PARTICLES = ['啊', '呀', '呢', '吧', '嘛', '哦', '呗', '啦', '哼', '哈', '嘿', '唉']
const LOW_SIGNAL_PHRASES = new Set(['什么', '怎么', '不是', '一个', '这个', '那个', '你们', '我们', '他们', '自己', '知道', '现在', '真的', '不会', '不要', '可以', '一下', '已经'])
const HIGH_SIMILARITY_THRESHOLD = 75
const WATCH_SIMILARITY_THRESHOLD = 60
const DRIFT_ALERT_THRESHOLD = 45
const DRIFT_HIGH_THRESHOLD = 60
const RECENT_DRIFT_WINDOW = 8
const MIN_TURN_COUNT = 8
const MIN_DIALOGUE_CHARS = 200
const PREFERRED_MIN_TURN_COUNT = 4
const PREFERRED_MIN_DIALOGUE_CHARS = 120
const MAX_TOP_PHRASES = 6
const MAX_TOP_PARTICLES = 5
const MAX_LLM_SAMPLES = 6
const SUMMARY_MAX_CHARACTERS = 4

const pendingRefreshes = new Set<number>()

const DIALOGUE_SUMMARY_PROMPT = `你是一位中文小说人物语音分析师。请基于角色对白统计与样本，输出该角色的稳定说话指纹。

只输出 JSON：
{
  "voiceProfile": "<一句话概括该角色说话方式，必须具体可执行>",
  "distinctiveHabits": ["<3-5条可观察习惯>"],
  "antiPatterns": ["<2-4条重写时必须避免的偏移>"],
  "compareHints": ["<2-4条与其他角色拉开差异的抓手>"]
}

要求：
1. 不要写抽象文学评论，要写句长、停顿、语气、追问方式、口头短语等可执行特征。
2. 不要重复输入原句。
3. 如果样本不足，也必须给出谨慎但可执行的总结。`

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function roundPercent(value: number): number {
  return Math.max(0, Math.min(100, roundMetric(value)))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function variance(values: number[], mean: number): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
}

function countTextUnits(text: string): number {
  return text.replace(/\s+/gu, '').length
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function pushCount(map: Map<string, number>, key: string, amount = 1) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + amount)
}

function mapToTopStats(map: Map<string, number>, limit: number): DialogueTokenStat[] {
  return Array.from(map.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((left, right) => right.count - left.count || left.token.localeCompare(right.token, 'zh-Hans-CN'))
    .slice(0, limit)
}

function normalizeDialogueText(text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .replace(/[“”「」『』]/gu, '')
    .trim()
}

function splitSentences(text: string): string[] {
  const normalized = normalizeDialogueText(text)
  if (!normalized) return []
  const segments = normalized
    .split(/[。！？!?；;]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
  return segments.length > 0 ? segments : [normalized]
}

function buildCharacterAliases(rows: CharacterRow[]): CharacterAlias[] {
  const givenNameCounts = new Map<string, number>()
  rows.forEach((row) => {
    const givenName = asText(row.givenName)
    if (givenName.length >= 2) {
      givenNameCounts.set(givenName, (givenNameCounts.get(givenName) || 0) + 1)
    }
  })

  const aliases: CharacterAlias[] = []
  rows.forEach((row) => {
    const fullName = asText(row.fullName)
    if (fullName) aliases.push({ id: row.id, fullName, alias: fullName })
    const givenName = asText(row.givenName)
    if (givenName.length >= 2 && givenNameCounts.get(givenName) === 1 && givenName !== fullName) {
      aliases.push({ id: row.id, fullName, alias: givenName })
    }
  })

  return aliases.sort((left, right) => right.alias.length - left.alias.length || left.alias.localeCompare(right.alias, 'zh-Hans-CN'))
}

function scoreAliasMatch(before: string, after: string, alias: CharacterAlias): number {
  const escaped = escapeRegExp(alias.alias)
  const verbs = SPEAKER_VERBS.map(escapeRegExp).join('|')
  let score = 0

  if (new RegExp(`${escaped}[^\\n。！？]{0,12}(?:${verbs})\\s*$`, 'u').test(before)) score += 6
  if (new RegExp(`${escaped}[:：]\\s*$`, 'u').test(before)) score += 5
  if (new RegExp(`^\\s*${escaped}[^\\n。！？]{0,12}(?:${verbs})`, 'u').test(after)) score += 6

  const beforeIndex = before.lastIndexOf(alias.alias)
  if (beforeIndex >= 0 && before.length - beforeIndex <= alias.alias.length + 8) score += 2

  const afterIndex = after.indexOf(alias.alias)
  if (afterIndex >= 0 && afterIndex <= 8) score += 2

  return score
}

function resolveSpeaker(before: string, after: string, aliases: CharacterAlias[]): { characterId: number; characterName: string } | null {
  let best: { characterId: number; characterName: string; score: number } | null = null
  let tied = false

  for (const alias of aliases) {
    const score = scoreAliasMatch(before, after, alias)
    if (score <= 0) continue
    if (!best || score > best.score) {
      best = { characterId: alias.id, characterName: alias.fullName, score }
      tied = false
      continue
    }
    if (best && score === best.score && best.characterId !== alias.id) tied = true
  }

  if (!best || tied) return null
  return { characterId: best.characterId, characterName: best.characterName }
}

function extractDialogueTurns(chapter: ChapterRow, aliases: CharacterAlias[]): DialogueTurn[] {
  const content = asText(chapter.content)
  if (!content) return []

  const turns: DialogueTurn[] = []
  for (const match of content.matchAll(QUOTE_REGEX)) {
    const rawText = normalizeDialogueText(match[1] || '')
    if (!rawText || countTextUnits(rawText) < 2) continue
    const start = match.index || 0
    const end = start + match[0].length
    const before = content.slice(Math.max(0, start - 40), start)
    const after = content.slice(end, Math.min(content.length, end + 40))
    const speaker = resolveSpeaker(before, after, aliases)
    turns.push({
      chapterId: chapter.id,
      chapterNum: chapter.chapterNum,
      volumeId: chapter.volumeId,
      characterId: speaker?.characterId,
      characterName: speaker?.characterName,
      text: rawText,
    })
  }

  return turns
}

function isLowSignalPhrase(phrase: string): boolean {
  if (!phrase || LOW_SIGNAL_PHRASES.has(phrase)) return true
  if (/^([啊呀哈哼嗯哦啦呢吧])\1+$/u.test(phrase)) return true
  return false
}

function extractRepeatedPhrases(texts: string[], minLength: number, maxLength: number, limit: number): DialogueTokenStat[] {
  const counts = new Map<string, number>()
  for (const text of texts) {
    const compact = text.replace(/[^\p{Script=Han}A-Za-z]/gu, '')
    if (!compact) continue
    const local = new Set<string>()
    const asciiWords = compact.match(/[A-Za-z]{3,}/g) || []
    asciiWords.forEach((word) => local.add(word.toLowerCase()))

    const hanOnly = compact.replace(/[A-Za-z]/g, '')
    for (let length = minLength; length <= maxLength; length += 1) {
      for (let index = 0; index <= hanOnly.length - length; index += 1) {
        const phrase = hanOnly.slice(index, index + length)
        if (isLowSignalPhrase(phrase)) continue
        local.add(phrase)
      }
    }

    local.forEach((phrase) => pushCount(counts, phrase))
  }

  return mapToTopStats(counts, limit).filter((item) => item.count >= 2)
}

function buildSentencePatterns(stats: CharacterDialogueFingerprint): string[] {
  const patterns: string[] = []
  if (stats.shortSentenceRate >= 55) patterns.push('短句密集')
  if (stats.longSentenceRate >= 35) patterns.push('长句偏多')
  if (stats.questionRate >= 30) patterns.push('追问反问多')
  if (stats.exclamationRate >= 25) patterns.push('情绪外露')
  if (stats.ellipsisRate >= 20) patterns.push('停顿留白多')
  if (stats.dashRate >= 12 || stats.interruptionRate >= 22) patterns.push('打断抢话多')
  if (patterns.length === 0) patterns.push('陈述偏稳')
  return patterns.slice(0, 4)
}

function buildFingerprintFromTurns(turns: DialogueTurn[]): CharacterDialogueFingerprint {
  const normalizedTurns = turns.map((turn) => normalizeDialogueText(turn.text)).filter(Boolean)
  if (normalizedTurns.length === 0) {
    return {
      sampleCount: 0,
      totalDialogueChars: 0,
      avgSentenceLength: 0,
      sentenceLengthVariance: 0,
      shortSentenceRate: 0,
      longSentenceRate: 0,
      questionRate: 0,
      exclamationRate: 0,
      interruptionRate: 0,
      ellipsisRate: 0,
      dashRate: 0,
      modalParticles: [],
      catchphraseCandidates: [],
      topTokens: [],
      sentencePatterns: [],
      recentSampleChapterNums: [],
    }
  }

  const sentences = normalizedTurns.flatMap((turn) => splitSentences(turn))
  const sentenceLengths = sentences.map((sentence) => countTextUnits(sentence)).filter((length) => length > 0)
  const avgSentenceLength = roundMetric(average(sentenceLengths))
  const sentenceLengthVariance = roundMetric(variance(sentenceLengths, avgSentenceLength))
  const totalDialogueChars = normalizedTurns.reduce((sum, turn) => sum + countTextUnits(turn), 0)

  const modalParticles = new Map<string, number>()
  normalizedTurns.forEach((turn) => {
    MODAL_PARTICLES.forEach((particle) => {
      const matchCount = (turn.match(new RegExp(escapeRegExp(particle), 'gu')) || []).length
      if (matchCount > 0) pushCount(modalParticles, particle, matchCount)
    })
  })

  const fingerprint: CharacterDialogueFingerprint = {
    sampleCount: normalizedTurns.length,
    totalDialogueChars,
    avgSentenceLength,
    sentenceLengthVariance,
    shortSentenceRate: roundPercent((sentenceLengths.filter((length) => length <= 8).length / Math.max(sentenceLengths.length, 1)) * 100),
    longSentenceRate: roundPercent((sentenceLengths.filter((length) => length >= 20).length / Math.max(sentenceLengths.length, 1)) * 100),
    questionRate: roundPercent((normalizedTurns.filter((turn) => /[？?]/u.test(turn)).length / normalizedTurns.length) * 100),
    exclamationRate: roundPercent((normalizedTurns.filter((turn) => /[！!]/u.test(turn)).length / normalizedTurns.length) * 100),
    interruptionRate: roundPercent((normalizedTurns.filter((turn) => /(——|--|……|\.{3,})/u.test(turn) || !/[。！？!?]$/u.test(turn)).length / normalizedTurns.length) * 100),
    ellipsisRate: roundPercent((normalizedTurns.filter((turn) => /(……|\.{3,})/u.test(turn)).length / normalizedTurns.length) * 100),
    dashRate: roundPercent((normalizedTurns.filter((turn) => /(——|--|—)/u.test(turn)).length / normalizedTurns.length) * 100),
    modalParticles: mapToTopStats(modalParticles, MAX_TOP_PARTICLES),
    catchphraseCandidates: extractRepeatedPhrases(normalizedTurns, 2, 6, MAX_TOP_PHRASES),
    topTokens: extractRepeatedPhrases(normalizedTurns, 2, 4, MAX_TOP_PHRASES),
    sentencePatterns: [],
    recentSampleChapterNums: dedupeStrings(turns.map((turn) => String(turn.chapterNum)).slice(-6)).map((value) => Number(value)).filter(Number.isFinite),
  }
  fingerprint.sentencePatterns = buildSentencePatterns(fingerprint)
  return fingerprint
}

function normalizeVectorSimilarity(left: number, right: number, maxDiff: number): number {
  if (maxDiff <= 0) return 1
  return Math.max(0, 1 - (Math.abs(left - right) / maxDiff))
}

function jaccardScore(left: string[], right: string[]): number {
  const leftSet = new Set(left.filter(Boolean))
  const rightSet = new Set(right.filter(Boolean))
  if (leftSet.size === 0 && rightSet.size === 0) return 0.5
  const intersection = Array.from(leftSet).filter((value) => rightSet.has(value)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return union > 0 ? intersection / union : 0
}

function buildSimilarityReasons(left: CharacterDialogueSignature, right: CharacterDialogueSignature): string[] {
  const reasons: string[] = []

  if (Math.abs(left.avgSentenceLength - right.avgSentenceLength) <= 3 && Math.abs(left.shortSentenceRate - right.shortSentenceRate) <= 15) {
    reasons.push('句长节奏接近')
  }

  const sharedParticles = left.modalParticles
    .map((item) => item.token)
    .filter((token) => right.modalParticles.some((candidate) => candidate.token === token))
    .slice(0, 3)
  if (sharedParticles.length > 0) reasons.push(`共享语气词：${sharedParticles.join('、')}`)

  const sharedPhrases = left.catchphraseCandidates
    .map((item) => item.token)
    .filter((token) => right.catchphraseCandidates.some((candidate) => candidate.token === token))
    .slice(0, 2)
  if (sharedPhrases.length > 0) reasons.push(`重复短语重合：${sharedPhrases.join('、')}`)

  const sharedPatterns = left.sentencePatterns.filter((pattern) => right.sentencePatterns.includes(pattern)).slice(0, 2)
  if (sharedPatterns.length > 0) reasons.push(`句式偏好重合：${sharedPatterns.join('、')}`)

  return reasons.slice(0, 3)
}

function computeSimilarity(left: CharacterDialogueSignature, right: CharacterDialogueSignature): CrossCharacterDialogueSimilarity {
  const metricScore = average([
    normalizeVectorSimilarity(left.avgSentenceLength, right.avgSentenceLength, 18),
    normalizeVectorSimilarity(left.shortSentenceRate, right.shortSentenceRate, 100),
    normalizeVectorSimilarity(left.longSentenceRate, right.longSentenceRate, 100),
    normalizeVectorSimilarity(left.questionRate, right.questionRate, 100),
    normalizeVectorSimilarity(left.exclamationRate, right.exclamationRate, 100),
    normalizeVectorSimilarity(left.ellipsisRate, right.ellipsisRate, 100),
    normalizeVectorSimilarity(left.dashRate, right.dashRate, 100),
    normalizeVectorSimilarity(left.interruptionRate, right.interruptionRate, 100),
  ])
  const particleScore = jaccardScore(left.modalParticles.map((item) => item.token), right.modalParticles.map((item) => item.token))
  const phraseScore = jaccardScore(left.catchphraseCandidates.map((item) => item.token), right.catchphraseCandidates.map((item) => item.token))
  const patternScore = jaccardScore(left.sentencePatterns, right.sentencePatterns)
  const similarity = roundPercent((metricScore * 0.45 + particleScore * 0.2 + phraseScore * 0.2 + patternScore * 0.15) * 100)

  return {
    characterAId: left.characterId,
    characterAName: left.characterName,
    characterBId: right.characterId,
    characterBName: right.characterName,
    similarity,
    reasons: buildSimilarityReasons(left, right),
  }
}

function buildHeuristicVoiceProfile(stats: CharacterDialogueFingerprint): string {
  const parts: string[] = []
  if (stats.avgSentenceLength > 0) {
    if (stats.shortSentenceRate >= 55) parts.push('短句推进明显')
    else if (stats.longSentenceRate >= 35) parts.push('句子偏长')
    else parts.push(`句长约 ${stats.avgSentenceLength} 字`)
  }
  if (stats.questionRate >= 30) parts.push('常用追问施压')
  if (stats.exclamationRate >= 25) parts.push('情绪外露')
  if (stats.ellipsisRate >= 20) parts.push('停顿留白多')
  if (stats.dashRate >= 12 || stats.interruptionRate >= 22) parts.push('常有打断感')
  if (stats.catchphraseCandidates.length > 0) parts.push(`常重复 ${stats.catchphraseCandidates.slice(0, 2).map((item) => item.token).join('、')}`)
  return parts.slice(0, 3).join('，') || '对白样本偏少，当前仅能确认其语气节奏较稳定。'
}

function parseSummaryJson(raw?: string | null): DialogueSummaryPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      voiceProfile: asText(parsed.voiceProfile),
      distinctiveHabits: dedupeStrings(Array.isArray(parsed.distinctiveHabits) ? parsed.distinctiveHabits.map(asText) : [], 5),
      antiPatterns: dedupeStrings(Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.map(asText) : [], 4),
      compareHints: dedupeStrings(Array.isArray(parsed.compareHints) ? parsed.compareHints.map(asText) : [], 4),
    }
  } catch {
    return null
  }
}

function parseFingerprintJson(raw?: string | null): CharacterDialogueFingerprint | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CharacterDialogueFingerprint
    if (!parsed || typeof parsed !== 'object') return null
    return {
      sampleCount: Number(parsed.sampleCount) || 0,
      totalDialogueChars: Number(parsed.totalDialogueChars) || 0,
      avgSentenceLength: Number(parsed.avgSentenceLength) || 0,
      sentenceLengthVariance: Number(parsed.sentenceLengthVariance) || 0,
      shortSentenceRate: Number(parsed.shortSentenceRate) || 0,
      longSentenceRate: Number(parsed.longSentenceRate) || 0,
      questionRate: Number(parsed.questionRate) || 0,
      exclamationRate: Number(parsed.exclamationRate) || 0,
      interruptionRate: Number(parsed.interruptionRate) || 0,
      ellipsisRate: Number(parsed.ellipsisRate) || 0,
      dashRate: Number(parsed.dashRate) || 0,
      modalParticles: Array.isArray(parsed.modalParticles) ? parsed.modalParticles.slice(0, MAX_TOP_PARTICLES) : [],
      catchphraseCandidates: Array.isArray(parsed.catchphraseCandidates) ? parsed.catchphraseCandidates.slice(0, MAX_TOP_PHRASES) : [],
      topTokens: Array.isArray(parsed.topTokens) ? parsed.topTokens.slice(0, MAX_TOP_PHRASES) : [],
      sentencePatterns: Array.isArray(parsed.sentencePatterns) ? parsed.sentencePatterns.slice(0, 4) : [],
      recentSampleChapterNums: Array.isArray(parsed.recentSampleChapterNums) ? parsed.recentSampleChapterNums.slice(0, 6) : [],
    }
  } catch {
    return null
  }
}

function isPreferredRole(roleType: CharacterRow['roleType']): boolean {
  return roleType === 'protagonist' || roleType === 'major' || roleType === 'antagonist' || roleType === 'supporting'
}

function isEligibleCharacter(character: CharacterRow, fingerprint: CharacterDialogueFingerprint): boolean {
  if (isPreferredRole(character.roleType)) {
    return fingerprint.sampleCount >= PREFERRED_MIN_TURN_COUNT && fingerprint.totalDialogueChars >= PREFERRED_MIN_DIALOGUE_CHARS
  }
  return fingerprint.sampleCount >= MIN_TURN_COUNT && fingerprint.totalDialogueChars >= MIN_DIALOGUE_CHARS
}

function buildSignature(
  character: CharacterRow,
  fingerprint: CharacterDialogueFingerprint,
  summary: DialogueSummaryPayload | null,
): CharacterDialogueSignature {
  const habits = dedupeStrings([
    ...(summary?.distinctiveHabits || []),
    ...fingerprint.catchphraseCandidates.slice(0, 2).map((item) => `重复短语 ${item.token}`),
    ...fingerprint.sentencePatterns.slice(0, 2),
  ], 4)

  return {
    characterId: character.id,
    characterName: character.fullName,
    roleType: character.roleType,
    sampleChapterStart: fingerprint.recentSampleChapterNums[0],
    sampleChapterEnd: fingerprint.recentSampleChapterNums[fingerprint.recentSampleChapterNums.length - 1],
    voiceProfile: summary?.voiceProfile || buildHeuristicVoiceProfile(fingerprint),
    distinctiveHabits: habits,
    antiPatterns: summary?.antiPatterns || [],
    compareHints: summary?.compareHints || [],
    ...fingerprint,
  }
}

function buildDriftReasons(baseline: CharacterDialogueFingerprint, recent: CharacterDialogueFingerprint): string[] {
  const diffs: Array<{ label: string; delta: number }> = [
    { label: '句长明显变化', delta: Math.abs(recent.avgSentenceLength - baseline.avgSentenceLength) * 4 },
    { label: '追问比例变化', delta: Math.abs(recent.questionRate - baseline.questionRate) },
    { label: '情绪强度变化', delta: Math.abs(recent.exclamationRate - baseline.exclamationRate) },
    { label: '停顿习惯变化', delta: Math.abs(recent.ellipsisRate - baseline.ellipsisRate) + Math.abs(recent.dashRate - baseline.dashRate) },
    { label: '打断节奏变化', delta: Math.abs(recent.interruptionRate - baseline.interruptionRate) },
  ]
  const baselinePhrases = baseline.catchphraseCandidates.map((item) => item.token)
  const recentPhrases = recent.catchphraseCandidates.map((item) => item.token)
  const newPhrases = recentPhrases.filter((token) => !baselinePhrases.includes(token)).slice(0, 2)
  if (newPhrases.length > 0) diffs.push({ label: `新增重复短语 ${newPhrases.join('、')}`, delta: 18 })

  return diffs
    .filter((item) => item.delta >= 10)
    .sort((left, right) => right.delta - left.delta || left.label.localeCompare(right.label, 'zh-Hans-CN'))
    .slice(0, 3)
    .map((item) => item.label)
}

function buildTrendStatus(points: Array<{ chapterNum: number; value: number }>): CharacterDialogueDriftEntry['status'] {
  if (points.length < 2) return 'stable'
  const previous = average(points.slice(0, Math.max(1, Math.floor(points.length / 2))).map((point) => point.value))
  const latest = average(points.slice(Math.max(1, Math.floor(points.length / 2))).map((point) => point.value))
  const delta = latest - previous
  if (delta >= 10) return 'worsening'
  if (delta <= -10) return 'improving'
  return 'stable'
}

function buildDriftEntry(
  character: CharacterRow,
  chapterTurns: Array<[number, DialogueTurn[]]>,
): CharacterDialogueDriftEntry | null {
  if (chapterTurns.length < 3) return null

  const sorted = chapterTurns
    .slice()
    .sort((left, right) => left[0] - right[0])
    .map(([chapterNum, turns]) => ({ chapterNum, turns }))
    .filter((entry) => entry.turns.length > 0)
  if (sorted.length < 3) return null

  const recentWindowSize = Math.min(RECENT_DRIFT_WINDOW, sorted.length - 1)
  const baselineTurns = sorted.slice(0, sorted.length - recentWindowSize).flatMap((entry) => entry.turns)
  const recentTurns = sorted.slice(-recentWindowSize).flatMap((entry) => entry.turns)
  if (baselineTurns.length === 0 || recentTurns.length === 0) return null

  const baseline = buildFingerprintFromTurns(baselineTurns)
  const recent = buildFingerprintFromTurns(recentTurns)
  const recentDriftRate = roundPercent(100 - computeSimilarity(
    buildSignature(character, baseline, null),
    buildSignature(character, recent, null),
  ).similarity)

  const trend = sorted.slice(1).map((entry, index) => {
    const priorTurns = sorted.slice(0, index + 1).flatMap((item) => item.turns)
    const priorFingerprint = buildFingerprintFromTurns(priorTurns)
    const chapterFingerprint = buildFingerprintFromTurns(entry.turns)
    return {
      chapterNum: entry.chapterNum,
      value: roundPercent(100 - computeSimilarity(
        buildSignature(character, priorFingerprint, null),
        buildSignature(character, chapterFingerprint, null),
      ).similarity),
    }
  })

  return {
    characterId: character.id,
    characterName: character.fullName,
    recentDriftRate,
    baselineWindowSize: sorted.length - recentWindowSize,
    recentWindowSize,
    reasons: buildDriftReasons(baseline, recent),
    status: buildTrendStatus(trend),
    trend,
  }
}

function emptyDialogueSnapshot(): DialogueAnalyticsSnapshot {
  return {
    dialogueFingerprintStats: {
      analyzedCharacterCount: 0,
      eligibleCharacterCount: 0,
      chapterCount: 0,
      totalTurnCount: 0,
      attributedTurnCount: 0,
      unattributedTurnCount: 0,
      averageCrossCharacterSimilarity: 0,
      highSimilarityPairCount: 0,
      driftingCharacterCount: 0,
    },
    characterDialogueSignatures: [],
    crossCharacterDialogueSimilarity: [],
    dialogueDriftTrend: [],
    volumeDialogueSimilarity: [],
    recentDialogueAlerts: [],
  }
}

function listFingerprintRecords(novelId: number): CharacterDialogueFingerprintRecord[] {
  const db = getDb()
  return db.select()
    .from(characterDialogueFingerprints)
    .where(eq(characterDialogueFingerprints.novelId, novelId))
    .orderBy(asc(characterDialogueFingerprints.characterId))
    .all()
    .map((row) => ({
      id: row.id,
      novelId: row.novelId,
      characterId: row.characterId,
      sampleChapterStart: row.sampleChapterStart ?? null,
      sampleChapterEnd: row.sampleChapterEnd ?? null,
      sampleCount: row.sampleCount,
      statsJson: row.statsJson ?? null,
      summaryJson: row.summaryJson ?? null,
      analysisModelId: row.analysisModelId ?? null,
      createdAt: row.createdAt || '',
      updatedAt: row.updatedAt || '',
    }))
}

function buildSummaryPreview(record: CharacterDialogueFingerprintRecord): string {
  const summary = parseSummaryJson(record.summaryJson)
  const stats = parseFingerprintJson(record.statsJson)
  const voiceProfile = summary?.voiceProfile || (stats ? buildHeuristicVoiceProfile(stats) : '')
  const habits = summary?.distinctiveHabits || []
  const parts = [
    voiceProfile,
    habits.length > 0 ? `习惯=${habits.slice(0, 2).join('、')}` : '',
  ].filter(Boolean)
  return parts.join('；')
}

function createChapterDialogueReviewData(): ChapterDialogueReviewData {
  return {
    fingerprintSummary: '',
    risks: [],
    similarities: [],
    drifts: [],
  }
}

function buildNovelDialogueAnalytics(novelId: number): DialogueAnalyticsSnapshot {
  const db = getDb()
  const allCharacters = db.select()
    .from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
  if (allCharacters.length === 0) return emptyDialogueSnapshot()

  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    volumeId: chapters.volumeId,
    content: chapters.content,
  }).from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
  if (chapterRows.length === 0) return emptyDialogueSnapshot()

  const volumeRows = db.select({
    id: storyVolumes.id,
    volumeNumber: storyVolumes.volumeNumber,
    title: storyVolumes.title,
  }).from(storyVolumes).where(eq(storyVolumes.novelId, novelId)).orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id)).all()
  const volumeMap = new Map(volumeRows.map((row) => [row.id, row] as const))

  const aliases = buildCharacterAliases(allCharacters)
  const turnsByCharacter = new Map<number, DialogueTurn[]>()
  const chapterTurnsByCharacter = new Map<number, Array<[number, DialogueTurn[]]>>()
  const volumeTurnsByCharacter = new Map<number, Map<number, DialogueTurn[]>>()
  const cachedRecords = new Map(listFingerprintRecords(novelId).map((record) => [record.characterId, record] as const))

  let totalTurnCount = 0
  let attributedTurnCount = 0

  chapterRows.forEach((chapter) => {
    const turns = extractDialogueTurns(chapter, aliases)
    totalTurnCount += turns.length
    attributedTurnCount += turns.filter((turn) => typeof turn.characterId === 'number').length

    const grouped = new Map<number, DialogueTurn[]>()
    turns.forEach((turn) => {
      if (typeof turn.characterId !== 'number') return
      if (!turnsByCharacter.has(turn.characterId)) turnsByCharacter.set(turn.characterId, [])
      turnsByCharacter.get(turn.characterId)!.push(turn)
      if (!grouped.has(turn.characterId)) grouped.set(turn.characterId, [])
      grouped.get(turn.characterId)!.push(turn)
      if (typeof turn.volumeId === 'number') {
        if (!volumeTurnsByCharacter.has(turn.volumeId)) volumeTurnsByCharacter.set(turn.volumeId, new Map())
        const volumeMapForTurn = volumeTurnsByCharacter.get(turn.volumeId)!
        if (!volumeMapForTurn.has(turn.characterId)) volumeMapForTurn.set(turn.characterId, [])
        volumeMapForTurn.get(turn.characterId)!.push(turn)
      }
    })

    grouped.forEach((groupTurns, characterId) => {
      if (!chapterTurnsByCharacter.has(characterId)) chapterTurnsByCharacter.set(characterId, [])
      chapterTurnsByCharacter.get(characterId)!.push([chapter.chapterNum, groupTurns])
    })
  })

  const signatures: CharacterDialogueSignature[] = []
  allCharacters.forEach((character) => {
    const turns = turnsByCharacter.get(character.id) || []
    const fingerprint = buildFingerprintFromTurns(turns)
    if (!isEligibleCharacter(character, fingerprint)) return
    const cached = cachedRecords.get(character.id)
    const summary = parseSummaryJson(cached?.summaryJson)
    signatures.push(buildSignature(character, fingerprint, summary))
  })
  signatures.sort((left, right) => {
    const roleRank = (roleType: CharacterDialogueSignature['roleType']) => {
      if (roleType === 'protagonist') return 0
      if (roleType === 'major') return 1
      if (roleType === 'antagonist') return 2
      if (roleType === 'supporting') return 3
      return 4
    }
    return roleRank(left.roleType) - roleRank(right.roleType) || right.sampleCount - left.sampleCount || left.characterName.localeCompare(right.characterName, 'zh-Hans-CN')
  })

  const similarityPairs: CrossCharacterDialogueSimilarity[] = []
  for (let leftIndex = 0; leftIndex < signatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < signatures.length; rightIndex += 1) {
      similarityPairs.push(computeSimilarity(signatures[leftIndex], signatures[rightIndex]))
    }
  }
  similarityPairs.sort((left, right) => right.similarity - left.similarity || left.characterAName.localeCompare(right.characterAName, 'zh-Hans-CN'))

  const driftEntries = allCharacters
    .map((character) => buildDriftEntry(character, chapterTurnsByCharacter.get(character.id) || []))
    .filter((entry): entry is CharacterDialogueDriftEntry => Boolean(entry))
    .sort((left, right) => right.recentDriftRate - left.recentDriftRate || left.characterName.localeCompare(right.characterName, 'zh-Hans-CN'))

  const volumeDialogueSimilarity: VolumeDialogueSimilarityEntry[] = Array.from(volumeTurnsByCharacter.entries())
    .map(([volumeId, characterMap]) => {
      const meta = volumeMap.get(volumeId)
      const chapterNums = new Set<number>()
      const volumeSignatures = allCharacters
        .map((character) => {
          const turns = characterMap.get(character.id) || []
          turns.forEach((turn) => chapterNums.add(turn.chapterNum))
          const fingerprint = buildFingerprintFromTurns(turns)
          if (fingerprint.sampleCount < 2 || fingerprint.totalDialogueChars < 40) return null
          return buildSignature(character, fingerprint, null)
        })
        .filter((entry): entry is CharacterDialogueSignature => Boolean(entry))
      const topPairs: CrossCharacterDialogueSimilarity[] = []
      for (let leftIndex = 0; leftIndex < volumeSignatures.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < volumeSignatures.length; rightIndex += 1) {
          topPairs.push(computeSimilarity(volumeSignatures[leftIndex], volumeSignatures[rightIndex]))
        }
      }
      topPairs.sort((left, right) => right.similarity - left.similarity || left.characterAName.localeCompare(right.characterAName, 'zh-Hans-CN'))
      return {
        volumeId,
        volumeNumber: meta?.volumeNumber ?? volumeId,
        volumeName: asText(meta?.title) || `第${meta?.volumeNumber ?? volumeId}卷`,
        chapterStart: Math.min(...chapterNums),
        chapterEnd: Math.max(...chapterNums),
        chapterCount: chapterNums.size,
        averageSimilarity: topPairs.length > 0 ? roundMetric(average(topPairs.map((pair) => pair.similarity))) : 0,
        topPairs: topPairs.slice(0, 3),
      }
    })
    .filter((entry) => Number.isFinite(entry.chapterStart) && entry.chapterCount > 0)
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)

  const recentDialogueAlerts: DialogueAlert[] = [
    ...similarityPairs
      .filter((pair) => pair.similarity >= HIGH_SIMILARITY_THRESHOLD)
      .slice(0, 3)
      .map((pair) => ({
        kind: 'similarity' as const,
        severity: 'warning' as const,
        title: `${pair.characterAName} / ${pair.characterBName} 对白过近`,
        detail: pair.reasons.join('；') || '句长、停顿和常用短语高度接近。',
        relatedCharacterIds: [pair.characterAId, pair.characterBId],
      })),
    ...driftEntries
      .filter((entry) => entry.recentDriftRate >= DRIFT_ALERT_THRESHOLD)
      .slice(0, 3)
      .map((entry) => ({
        kind: 'drift' as const,
        severity: entry.recentDriftRate >= DRIFT_HIGH_THRESHOLD ? 'warning' as const : 'info' as const,
        title: `${entry.characterName} 语音漂移`,
        detail: entry.reasons.join('；') || '近期对白节奏和用语习惯出现明显变化。',
        relatedCharacterIds: [entry.characterId],
      })),
  ]

  const stats: DialogueFingerprintStats = {
    analyzedCharacterCount: Array.from(turnsByCharacter.keys()).length,
    eligibleCharacterCount: signatures.length,
    chapterCount: chapterRows.length,
    totalTurnCount,
    attributedTurnCount,
    unattributedTurnCount: Math.max(0, totalTurnCount - attributedTurnCount),
    averageCrossCharacterSimilarity: similarityPairs.length > 0 ? roundMetric(average(similarityPairs.map((pair) => pair.similarity))) : 0,
    highSimilarityPairCount: similarityPairs.filter((pair) => pair.similarity >= HIGH_SIMILARITY_THRESHOLD).length,
    driftingCharacterCount: driftEntries.filter((entry) => entry.recentDriftRate >= DRIFT_ALERT_THRESHOLD).length,
  }

  return {
    dialogueFingerprintStats: stats,
    characterDialogueSignatures: signatures,
    crossCharacterDialogueSimilarity: similarityPairs.slice(0, 12),
    dialogueDriftTrend: driftEntries.slice(0, 12),
    volumeDialogueSimilarity,
    recentDialogueAlerts,
  }
}

function shouldRefreshSummary(
  currentFingerprint: CharacterDialogueFingerprint,
  cachedRecord?: CharacterDialogueFingerprintRecord,
): boolean {
  if (!cachedRecord?.summaryJson) return true
  const cachedFingerprint = parseFingerprintJson(cachedRecord.statsJson)
  if (!cachedFingerprint) return true
  if (Math.abs(cachedFingerprint.avgSentenceLength - currentFingerprint.avgSentenceLength) >= 2) return true
  if (Math.abs(cachedFingerprint.questionRate - currentFingerprint.questionRate) >= 15) return true
  if (Math.abs(cachedFingerprint.ellipsisRate - currentFingerprint.ellipsisRate) >= 15) return true
  const currentCatchphrase = currentFingerprint.catchphraseCandidates[0]?.token || ''
  const cachedCatchphrase = cachedFingerprint.catchphraseCandidates[0]?.token || ''
  return currentCatchphrase !== cachedCatchphrase || currentFingerprint.sentencePatterns.join('|') !== cachedFingerprint.sentencePatterns.join('|')
}

async function summarizeCharacterDialogue(
  character: CharacterDialogueSignature,
  sampleTexts: string[],
  modelConfigId?: number,
): Promise<DialogueSummaryPayload | null> {
  try {
    const adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
    const statsSummary = [
      `角色：${character.characterName}`,
      `样本数：${character.sampleCount} 段，总对白字数：${character.totalDialogueChars}`,
      `平均句长：${character.avgSentenceLength}，短句率：${character.shortSentenceRate}%，长句率：${character.longSentenceRate}%`,
      `追问率：${character.questionRate}%，感叹率：${character.exclamationRate}%`,
      `停顿率：省略号 ${character.ellipsisRate}% ，破折号 ${character.dashRate}% ，打断 ${character.interruptionRate}%`,
      character.modalParticles.length > 0 ? `语气词：${character.modalParticles.map((item) => `${item.token}×${item.count}`).join('、')}` : '',
      character.catchphraseCandidates.length > 0 ? `重复短语：${character.catchphraseCandidates.map((item) => `${item.token}×${item.count}`).join('、')}` : '',
      character.sentencePatterns.length > 0 ? `句式标签：${character.sentencePatterns.join('、')}` : '',
      sampleTexts.length > 0 ? `样本：\n${sampleTexts.map((text, index) => `${index + 1}. ${text}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')

    const raw = await adapter.chat([
      { role: 'user', content: `${DIALOGUE_SUMMARY_PROMPT}\n\n${statsSummary}` },
    ], { temperature: 0.3, maxTokens: 1200 })
    const match = raw.match(/\{[\s\S]*\}/u)
    if (!match) return null
    return parseSummaryJson(match[0])
  } catch {
    return null
  }
}

async function refreshDialogueFingerprintCache(novelId: number, modelConfigId?: number): Promise<void> {
  const db = getDb()
  const sqlite = getSqlite()
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    volumeId: chapters.volumeId,
    content: chapters.content,
  }).from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, novelId)).orderBy(asc(characters.sortOrder), asc(characters.id)).all()
  if (chapterRows.length === 0 || allCharacters.length === 0) return

  const aliases = buildCharacterAliases(allCharacters)
  const turnsByCharacter = new Map<number, DialogueTurn[]>()
  chapterRows.forEach((chapter) => {
    extractDialogueTurns(chapter, aliases).forEach((turn) => {
      if (typeof turn.characterId !== 'number') return
      if (!turnsByCharacter.has(turn.characterId)) turnsByCharacter.set(turn.characterId, [])
      turnsByCharacter.get(turn.characterId)!.push(turn)
    })
  })

  const cachedRecords = new Map(listFingerprintRecords(novelId).map((record) => [record.characterId, record] as const))
  const upsert = sqlite.prepare(`
    INSERT INTO character_dialogue_fingerprints (
      novel_id,
      character_id,
      sample_chapter_start,
      sample_chapter_end,
      sample_count,
      stats_json,
      summary_json,
      analysis_model_id,
      created_at,
      updated_at
    ) VALUES (
      @novel_id,
      @character_id,
      @sample_chapter_start,
      @sample_chapter_end,
      @sample_count,
      @stats_json,
      @summary_json,
      @analysis_model_id,
      @created_at,
      @updated_at
    )
    ON CONFLICT(novel_id, character_id) DO UPDATE SET
      sample_chapter_start = excluded.sample_chapter_start,
      sample_chapter_end = excluded.sample_chapter_end,
      sample_count = excluded.sample_count,
      stats_json = excluded.stats_json,
      summary_json = excluded.summary_json,
      analysis_model_id = excluded.analysis_model_id,
      updated_at = excluded.updated_at
  `)

  const eligibleCharacters = allCharacters
    .map((character) => {
      const turns = turnsByCharacter.get(character.id) || []
      const fingerprint = buildFingerprintFromTurns(turns)
      if (!isEligibleCharacter(character, fingerprint)) return null
      return { character, turns, fingerprint }
    })
    .filter((entry): entry is { character: CharacterRow; turns: DialogueTurn[]; fingerprint: CharacterDialogueFingerprint } => Boolean(entry))

  const eligibleCharacterIds = eligibleCharacters.map((entry) => entry.character.id)
  if (eligibleCharacterIds.length > 0) {
    sqlite.prepare(`
      DELETE FROM character_dialogue_fingerprints
      WHERE novel_id = ?
        AND character_id NOT IN (${eligibleCharacterIds.map(() => '?').join(',')})
    `).run(novelId, ...eligibleCharacterIds)
  } else {
    sqlite.prepare(`
      DELETE FROM character_dialogue_fingerprints
      WHERE novel_id = ?
    `).run(novelId)
  }

  const summaryTargetIds = new Set(eligibleCharacterIds.slice(0, SUMMARY_MAX_CHARACTERS))
  for (const entry of eligibleCharacters) {
    const cached = cachedRecords.get(entry.character.id)
    const existingSummary = parseSummaryJson(cached?.summaryJson)
    const summary = summaryTargetIds.has(entry.character.id) && shouldRefreshSummary(entry.fingerprint, cached)
      ? await summarizeCharacterDialogue(
        buildSignature(entry.character, entry.fingerprint, existingSummary),
        entry.turns.slice(-MAX_LLM_SAMPLES).map((turn) => turn.text),
        modelConfigId,
      )
      : existingSummary
    const now = new Date().toISOString()
    upsert.run({
      novel_id: novelId,
      character_id: entry.character.id,
      sample_chapter_start: entry.fingerprint.recentSampleChapterNums[0] ?? null,
      sample_chapter_end: entry.fingerprint.recentSampleChapterNums[entry.fingerprint.recentSampleChapterNums.length - 1] ?? null,
      sample_count: entry.fingerprint.sampleCount,
      stats_json: JSON.stringify(entry.fingerprint),
      summary_json: JSON.stringify(summary || {
        voiceProfile: buildHeuristicVoiceProfile(entry.fingerprint),
        distinctiveHabits: buildSentencePatterns(entry.fingerprint),
        antiPatterns: [],
        compareHints: [],
      }),
      analysis_model_id: modelConfigId ? String(modelConfigId) : null,
      created_at: cached?.createdAt || now,
      updated_at: now,
    })
  }
}

export function scheduleDialogueFingerprintRefresh(novelId: number, modelConfigId?: number) {
  if (pendingRefreshes.has(novelId)) return
  pendingRefreshes.add(novelId)
  void (async () => {
    try {
      let resolvedModelConfigId = modelConfigId
      if (typeof resolvedModelConfigId !== 'number') {
        const db = getDb()
        const novel = db.select({ modelConfigId: novels.modelConfigId }).from(novels).where(eq(novels.id, novelId)).all()[0]
        resolvedModelConfigId = novel?.modelConfigId ?? undefined
      }
      await refreshDialogueFingerprintCache(novelId, resolvedModelConfigId)
    } catch (error) {
      console.warn('[dialogue] failed to refresh fingerprint cache', error)
    } finally {
      pendingRefreshes.delete(novelId)
    }
  })()
}

export function getDialogueAnalyticsSnapshot(novelId: number): DialogueAnalyticsSnapshot {
  return buildNovelDialogueAnalytics(novelId)
}

export function listCharacterDialogueFingerprintRecords(novelId: number): CharacterDialogueFingerprintRecord[] {
  return listFingerprintRecords(novelId)
}

export function getCharacterDialogueHintMap(novelId: number): Map<number, string> {
  const hints = new Map<number, string>()
  listFingerprintRecords(novelId).forEach((record) => {
    const preview = buildSummaryPreview(record)
    if (preview) hints.set(record.characterId, preview)
  })
  return hints
}

export function analyzeChapterDialogueAgainstNovel(
  novelId: number,
  chapterNum: number,
  content: string,
): ChapterDialogueReviewData {
  const db = getDb()
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, novelId)).orderBy(asc(characters.sortOrder), asc(characters.id)).all()
  if (allCharacters.length === 0) return createChapterDialogueReviewData()

  const turns = extractDialogueTurns({
    id: 0,
    chapterNum,
    volumeId: null,
    content,
  }, buildCharacterAliases(allCharacters))
  if (turns.length === 0) return createChapterDialogueReviewData()

  const result = createChapterDialogueReviewData()
  const cachedRecords = new Map(listFingerprintRecords(novelId).map((record) => [record.characterId, record] as const))
  const grouped = new Map<number, DialogueTurn[]>()
  turns.forEach((turn) => {
    if (typeof turn.characterId !== 'number') return
    if (!grouped.has(turn.characterId)) grouped.set(turn.characterId, [])
    grouped.get(turn.characterId)!.push(turn)
  })

  const chapterSignatures = Array.from(grouped.entries())
    .map(([characterId, groupTurns]) => {
      const character = allCharacters.find((item) => item.id === characterId)
      if (!character || groupTurns.length < 2) return null
      return buildSignature(character, buildFingerprintFromTurns(groupTurns), null)
    })
    .filter((entry): entry is CharacterDialogueSignature => Boolean(entry))

  if (chapterSignatures.length === 0) {
    result.fingerprintSummary = `本章识别出 ${turns.length} 段对白，但可稳定归属到角色的样本还不够。`
    return result
  }

  const similarities: DialogueSimilarityWarning[] = []
  for (let leftIndex = 0; leftIndex < chapterSignatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < chapterSignatures.length; rightIndex += 1) {
      const pair = computeSimilarity(chapterSignatures[leftIndex], chapterSignatures[rightIndex])
      if (pair.similarity < WATCH_SIMILARITY_THRESHOLD) continue
      similarities.push({
        characterAId: pair.characterAId,
        characterAName: pair.characterAName,
        characterBId: pair.characterBId,
        characterBName: pair.characterBName,
        similarity: pair.similarity,
        reason: pair.reasons.join('；') || '句长、停顿和重复短语过于接近。',
      })
    }
  }
  similarities.sort((left, right) => right.similarity - left.similarity || left.characterAName.localeCompare(right.characterAName, 'zh-Hans-CN'))

  const drifts: DialogueDriftWarning[] = chapterSignatures
    .map((signature) => {
      const cached = cachedRecords.get(signature.characterId)
      const baseline = parseFingerprintJson(cached?.statsJson)
      if (!baseline || baseline.sampleCount < PREFERRED_MIN_TURN_COUNT) return null
      const driftRate = roundPercent(100 - computeSimilarity(
        signature,
        buildSignature(
          allCharacters.find((character) => character.id === signature.characterId)!,
          baseline,
          parseSummaryJson(cached?.summaryJson),
        ),
      ).similarity)
      if (driftRate < DRIFT_ALERT_THRESHOLD) return null
      return {
        characterId: signature.characterId,
        characterName: signature.characterName,
        driftRate,
        reason: buildDriftReasons(baseline, signature).join('；') || '本章语气和既有说话习惯差异偏大。',
      }
    })
    .filter((entry): entry is DialogueDriftWarning => Boolean(entry))
    .sort((left, right) => right.driftRate - left.driftRate || left.characterName.localeCompare(right.characterName, 'zh-Hans-CN'))

  const topVoices = chapterSignatures
    .slice()
    .sort((left, right) => right.sampleCount - left.sampleCount || left.characterName.localeCompare(right.characterName, 'zh-Hans-CN'))
    .slice(0, 2)
    .map((signature) => `${signature.characterName}：${buildHeuristicVoiceProfile(signature)}`)

  result.fingerprintSummary = `本章识别出 ${grouped.size} 位说话角色。${topVoices.join('；')}`
  result.similarities = similarities.slice(0, 4)
  result.drifts = drifts.slice(0, 4)
  result.risks = [
    ...result.similarities
      .filter((item) => item.similarity >= HIGH_SIMILARITY_THRESHOLD)
      .map((item) => `${item.characterAName} 与 ${item.characterBName} 在本章对白过近：${item.reason}`),
    ...result.drifts.map((item) => `${item.characterName} 偏离既有语音画像：${item.reason}`),
  ]

  return result
}
