import { and, desc, eq, isNull } from 'drizzle-orm'
import type { StyleComplianceResult, StyleFingerprint, StyleHardGuard } from '../../src/types'
import { computeStyleStats, type StyleStats } from '../../src/shared/style-fingerprint-stats'
import { getDb } from '../database/db'
import { chapters, novels, styleFingerprints } from '../database/schema'
import { getDefaultAdapter, getAdapterById } from './model.service'
import { analyzeStyleCompliance } from './style-compliance.service'
import { runChatTask } from './task.service'

export type { StyleFingerprint, StyleHardGuard }

const MAX_EXCERPT_LENGTH = 140
const MAX_ANALYSIS_WINDOW_COUNT = 6

const STYLE_ANALYSIS_PROMPT = `你是一位专业的文学风格分析师。请仔细阅读以下参考文本，提取其写作风格特征。

请以严格JSON格式返回，包含以下字段：
{
  "avgSentenceLength": <数字，平均句子字数>,
  "avgParagraphLength": <数字，平均段落字数>,
  "dialogueLineRate": <数字，对话段占比百分比>,
  "abstractTokenDensity": <数字，抽象词密度百分比>,
  "sentencePatterns": [<字符串数组，如"短长交替","多用破折号">],
  "wordFrequencyProfile": {"高频动词": [...], "偏好形容词": [...], "特色词汇": [...]},
  "narrativeTechniques": "<叙事技巧描述，如'以动作驱动，少用心理独白'>",
  "dialogueStyle": "<对话风格描述，如'口语化，常用省略句'>",
  "descriptionDensity": "<描写密度描述，如'偏少，集中在转场段落'>",
  "paceProfile": "<节奏特征，如'快节奏，短段落为主'>",
  "toneKeywords": [<语调关键词数组，如"冷硬","克制","留白">],
  "forbiddenPatterns": [<应避免的模式，如"不用'不禁'","避免抽象情绪词">],
  "exampleExcerpts": [<3-5段最能体现风格的原文摘录，每段50-100字>]
}

注意：只返回JSON，不要添加额外说明。`

function clampPercentage(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.round(numeric)
}

function buildRepresentativeChunks(text: string, maxChunkSize = 8000): string[] {
  if (text.length <= maxChunkSize) return [text]
  const maxWindows = Math.min(MAX_ANALYSIS_WINDOW_COUNT, Math.ceil(text.length / maxChunkSize))
  const maxStart = Math.max(0, text.length - maxChunkSize)
  const seen = new Set<number>()
  const chunks: string[] = []

  for (let index = 0; index < maxWindows; index += 1) {
    const ratio = maxWindows === 1 ? 0 : index / (maxWindows - 1)
    const start = Math.min(maxStart, Math.max(0, Math.round(maxStart * ratio)))
    if (seen.has(start)) continue
    seen.add(start)
    chunks.push(text.slice(start, start + maxChunkSize))
  }

  return chunks
}

function buildStatsPreamble(stats: StyleStats): string {
  return [
    '以下数值已由程序精确统计，请勿重新估算，直接沿用（你只分析语气、视角、修辞等不可量化维度）：',
    `- 平均句长 ${stats.avgSentenceLength} 字（标准差 ${stats.sentenceLengthStdev}）`,
    `- 平均段长 ${stats.avgParagraphLength} 字`,
    `- 对话段占比 ${stats.dialogueLineRate}%`,
  ].join('\n')
}

/** Deterministic numbers always win over LLM estimates. */
function overrideWithComputedStats(fingerprint: StyleFingerprint, stats: StyleStats): StyleFingerprint {
  return {
    ...fingerprint,
    avgSentenceLength: stats.avgSentenceLength > 0 ? Math.round(stats.avgSentenceLength) : fingerprint.avgSentenceLength,
    avgParagraphLength: stats.avgParagraphLength > 0 ? Math.round(stats.avgParagraphLength) : fingerprint.avgParagraphLength,
    dialogueLineRate: Math.round(stats.dialogueLineRate),
  }
}

export async function analyzeReferenceText(
  text: string,
  modelConfigId?: number,
): Promise<StyleFingerprint> {
  const adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
  const chunks = buildRepresentativeChunks(text)
  const stats = computeStyleStats(text)
  const statsPreamble = buildStatsPreamble(stats)

  if (chunks.length === 1) {
    const result = await adapter.chat([
      { role: 'user', content: `${STYLE_ANALYSIS_PROMPT}\n\n${statsPreamble}\n\n---\n参考文本：\n${chunks[0]}` },
    ], { temperature: 0.3, maxTokens: 4096 })
    return overrideWithComputedStats(parseStyleResult(result), stats)
  }

  // Multi-chunk: analyze each, then merge
  const partialResults: StyleFingerprint[] = []
  for (const chunk of chunks) {
    const result = await adapter.chat([
      { role: 'user', content: `${STYLE_ANALYSIS_PROMPT}\n\n${statsPreamble}\n\n---\n参考文本片段：\n${chunk}` },
    ], { temperature: 0.3, maxTokens: 4096 })
    partialResults.push(parseStyleResult(result))
  }

  return overrideWithComputedStats(mergeStyleResults(partialResults), stats)
}

function normalizeStyleStringArray(value: unknown, limit?: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const normalized = entry.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (limit && result.length >= limit) break
  }
  return result
}

function normalizeExampleExcerpts(value: unknown, limit = 5): string[] {
  return normalizeStyleStringArray(value)
    .map((excerpt) => (excerpt.length > MAX_EXCERPT_LENGTH
      ? `${excerpt.slice(0, MAX_EXCERPT_LENGTH - 3).trim()}...`
      : excerpt))
    .slice(0, limit)
}

function normalizeWordFrequencyProfile(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string[]> = {}
  for (const [key, words] of Object.entries(value)) {
    const normalizedKey = key.trim()
    if (!normalizedKey) continue
    const normalizedWords = normalizeStyleStringArray(words, 10)
    if (normalizedWords.length > 0) {
      result[normalizedKey] = normalizedWords
    }
  }
  return result
}

export function parseStyleResult(raw: string): StyleFingerprint {
  // Try to extract JSON from the response
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return getDefaultFingerprint()
  }
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      avgSentenceLength: normalizePositiveNumber(parsed.avgSentenceLength, 20),
      avgParagraphLength: normalizePositiveNumber(parsed.avgParagraphLength, 85),
      dialogueLineRate: clampPercentage(parsed.dialogueLineRate, 25),
      abstractTokenDensity: clampPercentage(parsed.abstractTokenDensity, 8),
      sentencePatterns: normalizeStyleStringArray(parsed.sentencePatterns, 10),
      wordFrequencyProfile: normalizeWordFrequencyProfile(parsed.wordFrequencyProfile),
      narrativeTechniques: parsed.narrativeTechniques || '',
      dialogueStyle: parsed.dialogueStyle || '',
      descriptionDensity: parsed.descriptionDensity || '',
      paceProfile: parsed.paceProfile || '',
      toneKeywords: normalizeStyleStringArray(parsed.toneKeywords, 12),
      forbiddenPatterns: normalizeStyleStringArray(parsed.forbiddenPatterns, 12),
      exampleExcerpts: normalizeExampleExcerpts(parsed.exampleExcerpts),
      styleHardGuard: undefined,
    }
  } catch {
    return getDefaultFingerprint()
  }
}

export function getDefaultFingerprint(): StyleFingerprint {
  return {
    avgSentenceLength: 20,
    avgParagraphLength: 85,
    dialogueLineRate: 25,
    abstractTokenDensity: 8,
    sentencePatterns: [],
    wordFrequencyProfile: {},
    narrativeTechniques: '',
    dialogueStyle: '',
    descriptionDensity: '',
    paceProfile: '',
    toneKeywords: [],
    forbiddenPatterns: [],
    exampleExcerpts: [],
  }
}

export function mergeStyleResults(results: StyleFingerprint[]): StyleFingerprint {
  if (results.length === 0) return getDefaultFingerprint()
  if (results.length === 1) return results[0]

  const merged = getDefaultFingerprint()
  merged.avgSentenceLength = Math.round(
    results.reduce((sum, r) => sum + r.avgSentenceLength, 0) / results.length,
  )
  merged.avgParagraphLength = Math.round(
    results.reduce((sum, r) => sum + r.avgParagraphLength, 0) / results.length,
  )
  merged.dialogueLineRate = clampPercentage(
    results.reduce((sum, r) => sum + r.dialogueLineRate, 0) / results.length,
    25,
  )
  merged.abstractTokenDensity = clampPercentage(
    results.reduce((sum, r) => sum + r.abstractTokenDensity, 0) / results.length,
    8,
  )
  merged.sentencePatterns = normalizeStyleStringArray(results.flatMap((r) => r.sentencePatterns), 12)
  merged.toneKeywords = normalizeStyleStringArray(results.flatMap((r) => r.toneKeywords), 12)
  merged.forbiddenPatterns = normalizeStyleStringArray(results.flatMap((r) => r.forbiddenPatterns), 12)
  merged.exampleExcerpts = normalizeExampleExcerpts(results.flatMap((r) => r.exampleExcerpts))

  // Take from first non-empty result
  for (const r of results) {
    if (!merged.narrativeTechniques && r.narrativeTechniques) merged.narrativeTechniques = r.narrativeTechniques
    if (!merged.dialogueStyle && r.dialogueStyle) merged.dialogueStyle = r.dialogueStyle
    if (!merged.descriptionDensity && r.descriptionDensity) merged.descriptionDensity = r.descriptionDensity
    if (!merged.paceProfile && r.paceProfile) merged.paceProfile = r.paceProfile
  }

  // Merge word frequency profiles
  const freqKeys = new Set(results.flatMap((r) => Object.keys(r.wordFrequencyProfile)))
  for (const key of freqKeys) {
    merged.wordFrequencyProfile[key] = normalizeStyleStringArray(
      results.flatMap((r) => r.wordFrequencyProfile[key] || []),
      10,
    )
  }

  return merged
}

function buildNumericRange(target: number, minRatio: number, maxRatio: number, floor: number, ceil = Number.MAX_SAFE_INTEGER) {
  const normalizedTarget = Math.max(floor, Math.min(ceil, Math.round(target)))
  const min = Math.max(floor, Math.min(ceil, Math.round(normalizedTarget * minRatio)))
  const max = Math.max(min, Math.min(ceil, Math.round(normalizedTarget * maxRatio)))
  return { min, max, target: normalizedTarget }
}

function parseStoredFingerprint(raw?: string | null): StyleFingerprint | null {
  if (!raw?.trim()) return null
  try {
    return {
      ...getDefaultFingerprint(),
      ...parseStyleResult(raw),
    }
  } catch {
    return null
  }
}

export function buildStyleHardGuard(fingerprint: StyleFingerprint): StyleHardGuard {
  const sentenceLengthRange = buildNumericRange(fingerprint.avgSentenceLength || 20, 0.72, 1.32, 6)
  const paragraphLengthRange = buildNumericRange(fingerprint.avgParagraphLength || 85, 0.68, 1.38, 24)
  const dialogueLineRateRange = buildNumericRange(fingerprint.dialogueLineRate || 25, 0.6, 1.4, 0, 100)
  const abstractTokenDensityMax = Math.max(2, Math.min(100, Math.round((fingerprint.abstractTokenDensity || 8) + 4)))

  const hardRules = [
    sentenceLengthRange.target > 0
      ? `句长尽量维持在 ${sentenceLengthRange.min}-${sentenceLengthRange.max} 字，目标值约 ${sentenceLengthRange.target} 字。`
      : '',
    paragraphLengthRange.target > 0
      ? `单段长度尽量维持在 ${paragraphLengthRange.min}-${paragraphLengthRange.max} 字，避免连续大段解释。`
      : '',
    `对话段占比控制在 ${dialogueLineRateRange.min}% - ${dialogueLineRateRange.max}% 之间，避免整章口播或整章无对白。`,
    `抽象词密度不高于 ${abstractTokenDensityMax}% ，优先用动作、反应、物理细节落地。`,
    fingerprint.narrativeTechniques ? `叙事执行：${fingerprint.narrativeTechniques}` : '',
    fingerprint.dialogueStyle ? `对白执行：${fingerprint.dialogueStyle}` : '',
    fingerprint.descriptionDensity ? `描写密度：${fingerprint.descriptionDensity}` : '',
    fingerprint.paceProfile ? `节奏要求：${fingerprint.paceProfile}` : '',
    fingerprint.sentencePatterns.length > 0 ? `句式骨架：${fingerprint.sentencePatterns.join('、')}` : '',
    fingerprint.toneKeywords.length > 0 ? `语气边界：${fingerprint.toneKeywords.join('、')}` : '',
  ].filter(Boolean)

  const rewriteTriggers = [
    fingerprint.forbiddenPatterns.length > 0 ? `命中禁用模式：${fingerprint.forbiddenPatterns.join('；')}` : '',
    `平均句长偏离目标超过 ${Math.max(6, Math.round(sentenceLengthRange.target * 0.45))} 字。`,
    `段落长度持续偏离目标，出现大段解释或碎段堆砌。`,
    `对话段占比偏离参考超过 18 个百分点。`,
    `抽象词密度显著高于参考线。`,
  ].filter(Boolean)

  return {
    summary: `句长约 ${sentenceLengthRange.target} 字，段长约 ${paragraphLengthRange.target} 字，对话段占比约 ${dialogueLineRateRange.target}%，抽象词密度不高于 ${abstractTokenDensityMax}%。`,
    sentenceLengthRange,
    paragraphLengthRange,
    dialogueLineRateRange,
    abstractTokenDensityMax,
    hardRules,
    rewriteTriggers,
  }
}

export async function createStyleFingerprint(
  novelId: number | null,
  name: string,
  text: string,
  modelConfigId?: number,
  options: { sourceType?: 'pasted' | 'chapters' | 'genre-default'; sourceChapterIds?: number[]; genreId?: number } = {},
): Promise<number> {
  const fingerprint = await analyzeReferenceText(text, modelConfigId)
  const stats = computeStyleStats(text)
  const db = getDb()

  const result = db.insert(styleFingerprints).values({
    novelId,
    name,
    sourceText: text.slice(0, 50000), // Cap storage at 50k chars
    fingerprintJson: JSON.stringify(fingerprint),
    analysisModelId: modelConfigId ? String(modelConfigId) : null,
    sourceType: options.sourceType || 'pasted',
    sourceChapterIdsJson: options.sourceChapterIds ? JSON.stringify(options.sourceChapterIds) : null,
    statsJson: JSON.stringify(stats),
    genreId: options.genreId ?? null,
  }).run()

  return Number(result.lastInsertRowid)
}

/** Build a fingerprint by sampling existing (preferably finalized) chapters. */
export async function createStyleFingerprintFromChapters(
  novelId: number,
  name: string,
  chapterIds: number[],
  modelConfigId?: number,
): Promise<number> {
  const db = getDb()
  const rows = db.select({ id: chapters.id, content: chapters.content, chapterNum: chapters.chapterNum })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
    .filter((row) => chapterIds.includes(row.id) && row.content?.trim())
    .sort((left, right) => left.chapterNum - right.chapterNum)
  if (rows.length === 0) {
    throw new Error('所选章节没有可用正文，无法生成风格指纹。')
  }
  const sample = rows.map((row) => row.content || '').join('\n\n').slice(0, 48000)
  return createStyleFingerprint(novelId, name, sample, modelConfigId, {
    sourceType: 'chapters',
    sourceChapterIds: rows.map((row) => row.id),
  })
}

export function setActiveStyleFingerprint(novelId: number, fingerprintId: number | null): void {
  const db = getDb()
  if (fingerprintId !== null) {
    const record = getStyleFingerprint(fingerprintId)
    if (!record) throw new Error('风格指纹不存在。')
    if (record.novelId !== null && record.novelId !== novelId) {
      throw new Error('不能激活其他小说的风格指纹。')
    }
  }
  db.update(novels)
    .set({ activeStyleFingerprintId: fingerprintId, updatedAt: new Date().toISOString() })
    .where(eq(novels.id, novelId))
    .run()
}

export interface ResolvedStyleFingerprint {
  record: NonNullable<ReturnType<typeof getStyleFingerprint>>
  fingerprint: StyleFingerprint
  source: 'active' | 'latest' | 'genre-default'
}

/**
 * Fingerprint fallback chain: explicitly activated → newest novel fingerprint
 * → genre default seed (novel_id NULL + genre_id) → null.
 */
export function resolveActiveStyleFingerprint(novelId: number, genreId?: number | null): ResolvedStyleFingerprint | null {
  const db = getDb()
  const novel = db.select({ activeId: novels.activeStyleFingerprintId, genreId: novels.genreId })
    .from(novels)
    .where(eq(novels.id, novelId))
    .all()[0]

  if (novel?.activeId) {
    const payload = getStyleFingerprintPayload(novel.activeId)
    if (payload?.record) return { record: payload.record, fingerprint: payload.fingerprint, source: 'active' }
  }

  const latest = getLatestStyleFingerprintForNovel(novelId)
  if (latest?.record) return { record: latest.record, fingerprint: latest.fingerprint, source: 'latest' }

  const effectiveGenreId = genreId ?? novel?.genreId
  if (effectiveGenreId) {
    const seed = db.select().from(styleFingerprints)
      .where(and(isNull(styleFingerprints.novelId), eq(styleFingerprints.genreId, effectiveGenreId)))
      .orderBy(desc(styleFingerprints.id))
      .limit(1)
      .all()[0]
    if (seed) {
      const fingerprint = parseStoredFingerprint(seed.fingerprintJson)
      if (fingerprint) return { record: seed, fingerprint, source: 'genre-default' }
    }
  }

  return null
}

export function getStyleFingerprint(id: number) {
  const db = getDb()
  return db.select().from(styleFingerprints).where(eq(styleFingerprints.id, id)).all()[0] || null
}

export function getStyleFingerprintPayload(id: number): { record: ReturnType<typeof getStyleFingerprint>; fingerprint: StyleFingerprint } | null {
  const record = getStyleFingerprint(id)
  if (!record) return null
  const fingerprint = parseStoredFingerprint(record.fingerprintJson)
  if (!fingerprint) return null
  return { record, fingerprint }
}

export function listStyleFingerprints(novelId?: number) {
  const db = getDb()
  if (novelId) {
    return db.select().from(styleFingerprints)
      .where(eq(styleFingerprints.novelId, novelId))
      .all()
  }
  return db.select().from(styleFingerprints).all()
}

export function deleteStyleFingerprint(id: number) {
  const db = getDb()
  db.delete(styleFingerprints).where(eq(styleFingerprints.id, id)).run()
}

export function buildStyleFingerprintPromptSection(fingerprintId: number): string {
  const payload = getStyleFingerprintPayload(fingerprintId)
  if (!payload) return ''
  const { record, fingerprint: fp } = payload

  const parts: string[] = []
  parts.push(`【目标风格指纹 · ${record.name}】`)

  if (fp.avgSentenceLength) parts.push(`平均句长：${fp.avgSentenceLength}字`)
  if (fp.avgParagraphLength) parts.push(`平均段长：${fp.avgParagraphLength}字`)
  parts.push(`对话段占比：${fp.dialogueLineRate}%`)
  parts.push(`抽象词密度参考上限：${fp.abstractTokenDensity}%`)
  if (fp.sentencePatterns.length > 0) parts.push(`句式偏好：${fp.sentencePatterns.join('，')}`)
  if (fp.narrativeTechniques) parts.push(`叙事技巧：${fp.narrativeTechniques}`)
  if (fp.dialogueStyle) parts.push(`对话风格：${fp.dialogueStyle}`)
  if (fp.descriptionDensity) parts.push(`描写密度：${fp.descriptionDensity}`)
  if (fp.paceProfile) parts.push(`节奏特征：${fp.paceProfile}`)
  if (fp.toneKeywords.length > 0) parts.push(`语调关键词：${fp.toneKeywords.join('、')}`)
  if (fp.forbiddenPatterns.length > 0) parts.push(`禁用模式：${fp.forbiddenPatterns.join('；')}`)
  if (fp.exampleExcerpts.length > 0) {
    parts.push('风格示范：')
    for (const excerpt of fp.exampleExcerpts.slice(0, 3)) {
      parts.push(`> ${excerpt}`)
    }
  }

  return parts.join('\n')
}

export function buildStyleHardGuardPromptSection(fingerprintId: number): string {
  const payload = getStyleFingerprintPayload(fingerprintId)
  if (!payload) return ''
  const guard = buildStyleHardGuard(payload.fingerprint)

  const parts = [
    `【风格硬约束 · ${payload.record.name}】`,
    guard.summary,
    ...guard.hardRules.map((item) => `- ${item}`),
    guard.rewriteTriggers.length > 0 ? '触发重写条件：' : '',
    ...guard.rewriteTriggers.map((item) => `- ${item}`),
  ].filter(Boolean)

  return parts.join('\n')
}

export function getLatestStyleFingerprintForNovel(novelId: number): {
  record: ReturnType<typeof getStyleFingerprint>
  fingerprint: StyleFingerprint
} | null {
  const fingerprints = listStyleFingerprints(novelId)
  const latest = fingerprints[fingerprints.length - 1]
  if (!latest) return null
  const fingerprint = parseStoredFingerprint(latest.fingerprintJson)
  if (!fingerprint) return null
  return {
    record: latest,
    fingerprint,
  }
}

// ---------------------------------------------------------------------------
// A/B 试写：同一场景梗概，注入指纹 vs 不注入，对照统计与合规结果。
// ---------------------------------------------------------------------------

export interface StyleAbTestVariant {
  text: string
  stats: StyleStats
  compliance: StyleComplianceResult
}

export interface StyleAbTestResult {
  withFingerprint: StyleAbTestVariant
  without: StyleAbTestVariant
  fingerprintName: string
}

const AB_TEST_TARGET_WORDS = 400

function buildAbTestBasePrompt(sceneBrief: string): string {
  return [
    `你是一位中文小说写手。请根据下面的场景梗概写一段约 ${AB_TEST_TARGET_WORDS} 字的正文片段。`,
    '要求：只输出正文，不要标题、不要解释、不要列点；写成可以直接放进章节的叙事文字。',
    '',
    '场景梗概：',
    sceneBrief.trim(),
  ].join('\n')
}

export async function runStyleAbTest(
  novelId: number,
  fingerprintId: number,
  sceneBrief: string,
  modelConfigId?: number,
): Promise<StyleAbTestResult> {
  if (!sceneBrief.trim()) {
    throw new Error('场景梗概不能为空。')
  }
  const payload = getStyleFingerprintPayload(fingerprintId)
  if (!payload?.record) {
    throw new Error('风格指纹不存在或数据已损坏。')
  }

  const basePrompt = buildAbTestBasePrompt(sceneBrief)
  const fingerprintSections = [
    buildStyleFingerprintPromptSection(fingerprintId),
    buildStyleHardGuardPromptSection(fingerprintId),
  ].filter(Boolean).join('\n\n')

  const withFingerprintText = (await runChatTask({
    type: 'style_ab_test',
    novelId,
    relatedEntityType: 'style_fingerprint',
    relatedEntityId: fingerprintId,
    modelConfigId,
    messages: [{ role: 'user', content: `${fingerprintSections}\n\n${basePrompt}` }],
  })).trim()

  const withoutText = (await runChatTask({
    type: 'style_ab_test',
    novelId,
    relatedEntityType: 'style_fingerprint',
    relatedEntityId: fingerprintId,
    modelConfigId,
    messages: [{ role: 'user', content: basePrompt }],
  })).trim()

  const buildVariant = (text: string): StyleAbTestVariant => ({
    text,
    stats: computeStyleStats(text),
    compliance: analyzeStyleCompliance(text, payload.fingerprint),
  })

  return {
    withFingerprint: buildVariant(withFingerprintText),
    without: buildVariant(withoutText),
    fingerprintName: payload.record.name,
  }
}

// ---------------------------------------------------------------------------
// 自动采样刷新：定稿章节积累到阈值后自动生成新的章节采样指纹（不自动激活）。
// ---------------------------------------------------------------------------

export interface AutoSampleDecision {
  chapterIds: number[]
  startChapterNum: number
  endChapterNum: number
}

/**
 * Pure trigger logic: given the novel's finalized chapters and the highest
 * chapter number already covered by the latest chapter-sampled fingerprint,
 * decide whether to resample. Requires at least `minNewFinalCount` NEW final
 * chapters since the last sample, then samples the most recent `sampleSize`
 * final chapters.
 */
export function selectAutoSampleChapters(
  finalChapters: Array<{ id: number; chapterNum: number }>,
  lastSampledMaxChapterNum: number | null,
  options: { minNewFinalCount?: number; sampleSize?: number } = {},
): AutoSampleDecision | null {
  const minNewFinalCount = options.minNewFinalCount ?? 5
  const sampleSize = options.sampleSize ?? 5

  const sorted = [...finalChapters].sort((left, right) => left.chapterNum - right.chapterNum)
  const freshCount = lastSampledMaxChapterNum === null
    ? sorted.length
    : sorted.filter((chapter) => chapter.chapterNum > lastSampledMaxChapterNum).length
  if (freshCount < minNewFinalCount) return null

  const sample = sorted.slice(-sampleSize)
  if (sample.length === 0) return null
  return {
    chapterIds: sample.map((chapter) => chapter.id),
    startChapterNum: sample[0].chapterNum,
    endChapterNum: sample[sample.length - 1].chapterNum,
  }
}

/**
 * Fire-and-forget refresher called after chapter finalization. Creates a new
 * chapter-sampled fingerprint once enough new finalized chapters accumulated.
 * Never touches the active pointer — the user opts in manually.
 */
export async function maybeRefreshNovelStyleFingerprint(novelId: number): Promise<number | null> {
  const db = getDb()

  const latestSampled = db.select().from(styleFingerprints)
    .where(and(eq(styleFingerprints.novelId, novelId), eq(styleFingerprints.sourceType, 'chapters')))
    .orderBy(desc(styleFingerprints.id))
    .limit(1)
    .all()[0]

  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    status: chapters.status,
    content: chapters.content,
  })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()

  let lastSampledMaxChapterNum: number | null = null
  if (latestSampled?.sourceChapterIdsJson) {
    try {
      const sampledIds = JSON.parse(latestSampled.sourceChapterIdsJson) as unknown
      if (Array.isArray(sampledIds)) {
        const idSet = new Set(sampledIds.filter((id): id is number => typeof id === 'number'))
        const sampledNums = chapterRows
          .filter((row) => idSet.has(row.id))
          .map((row) => row.chapterNum)
        if (sampledNums.length > 0) {
          lastSampledMaxChapterNum = Math.max(...sampledNums)
        }
      }
    } catch {
      lastSampledMaxChapterNum = null
    }
  }

  const finalChapters = chapterRows
    .filter((row) => row.status === 'final' && row.content?.trim())
    .map((row) => ({ id: row.id, chapterNum: row.chapterNum }))

  const decision = selectAutoSampleChapters(finalChapters, lastSampledMaxChapterNum)
  if (!decision) return null

  const name = decision.startChapterNum === decision.endChapterNum
    ? `自动采样 · 第${decision.startChapterNum}章`
    : `自动采样 · 第${decision.startChapterNum}-${decision.endChapterNum}章`
  return createStyleFingerprintFromChapters(novelId, name, decision.chapterIds)
}
