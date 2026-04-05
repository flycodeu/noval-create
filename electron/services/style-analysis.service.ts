import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { styleFingerprints } from '../database/schema'
import { getDefaultAdapter, getAdapterById } from './model.service'

export interface StyleFingerprint {
  avgSentenceLength: number
  sentencePatterns: string[]
  wordFrequencyProfile: Record<string, string[]>
  narrativeTechniques: string
  dialogueStyle: string
  descriptionDensity: string
  paceProfile: string
  toneKeywords: string[]
  forbiddenPatterns: string[]
  exampleExcerpts: string[]
}

const STYLE_ANALYSIS_PROMPT = `你是一位专业的文学风格分析师。请仔细阅读以下参考文本，提取其写作风格特征。

请以严格JSON格式返回，包含以下字段：
{
  "avgSentenceLength": <数字，平均句子字数>,
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

export async function analyzeReferenceText(
  text: string,
  modelConfigId?: number,
): Promise<StyleFingerprint> {
  const adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()

  // Split text into chunks if too long
  const maxChunkSize = 8000
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += maxChunkSize) {
    chunks.push(text.slice(i, i + maxChunkSize))
  }

  if (chunks.length === 1) {
    const result = await adapter.chat([
      { role: 'user', content: `${STYLE_ANALYSIS_PROMPT}\n\n---\n参考文本：\n${chunks[0]}` },
    ], { temperature: 0.3, maxTokens: 4096 })
    return parseStyleResult(result)
  }

  // Multi-chunk: analyze each, then merge
  const partialResults: StyleFingerprint[] = []
  for (const chunk of chunks.slice(0, 4)) { // Cap at 4 chunks (32000 chars)
    const result = await adapter.chat([
      { role: 'user', content: `${STYLE_ANALYSIS_PROMPT}\n\n---\n参考文本片段：\n${chunk}` },
    ], { temperature: 0.3, maxTokens: 4096 })
    partialResults.push(parseStyleResult(result))
  }

  return mergeStyleResults(partialResults)
}

function parseStyleResult(raw: string): StyleFingerprint {
  // Try to extract JSON from the response
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return getDefaultFingerprint()
  }
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      avgSentenceLength: typeof parsed.avgSentenceLength === 'number' ? parsed.avgSentenceLength : 20,
      sentencePatterns: Array.isArray(parsed.sentencePatterns) ? parsed.sentencePatterns : [],
      wordFrequencyProfile: parsed.wordFrequencyProfile || {},
      narrativeTechniques: parsed.narrativeTechniques || '',
      dialogueStyle: parsed.dialogueStyle || '',
      descriptionDensity: parsed.descriptionDensity || '',
      paceProfile: parsed.paceProfile || '',
      toneKeywords: Array.isArray(parsed.toneKeywords) ? parsed.toneKeywords : [],
      forbiddenPatterns: Array.isArray(parsed.forbiddenPatterns) ? parsed.forbiddenPatterns : [],
      exampleExcerpts: Array.isArray(parsed.exampleExcerpts) ? parsed.exampleExcerpts : [],
    }
  } catch {
    return getDefaultFingerprint()
  }
}

function getDefaultFingerprint(): StyleFingerprint {
  return {
    avgSentenceLength: 20,
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

function mergeStyleResults(results: StyleFingerprint[]): StyleFingerprint {
  if (results.length === 0) return getDefaultFingerprint()
  if (results.length === 1) return results[0]

  const merged = getDefaultFingerprint()
  merged.avgSentenceLength = Math.round(
    results.reduce((sum, r) => sum + r.avgSentenceLength, 0) / results.length,
  )
  merged.sentencePatterns = [...new Set(results.flatMap((r) => r.sentencePatterns))]
  merged.toneKeywords = [...new Set(results.flatMap((r) => r.toneKeywords))]
  merged.forbiddenPatterns = [...new Set(results.flatMap((r) => r.forbiddenPatterns))]
  merged.exampleExcerpts = results.flatMap((r) => r.exampleExcerpts).slice(0, 5)

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
    merged.wordFrequencyProfile[key] = [...new Set(
      results.flatMap((r) => r.wordFrequencyProfile[key] || []),
    )].slice(0, 10)
  }

  return merged
}

export async function createStyleFingerprint(
  novelId: number | null,
  name: string,
  text: string,
  modelConfigId?: number,
): Promise<number> {
  const fingerprint = await analyzeReferenceText(text, modelConfigId)
  const db = getDb()

  const result = db.insert(styleFingerprints).values({
    novelId,
    name,
    sourceText: text.slice(0, 50000), // Cap storage at 50k chars
    fingerprintJson: JSON.stringify(fingerprint),
    analysisModelId: modelConfigId ? String(modelConfigId) : null,
  }).run()

  return Number(result.lastInsertRowid)
}

export function getStyleFingerprint(id: number) {
  const db = getDb()
  return db.select().from(styleFingerprints).where(eq(styleFingerprints.id, id)).all()[0] || null
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
  const record = getStyleFingerprint(fingerprintId)
  if (!record || !record.fingerprintJson) return ''

  let fp: StyleFingerprint
  try {
    fp = JSON.parse(record.fingerprintJson)
  } catch {
    return ''
  }

  const parts: string[] = []
  parts.push(`【目标风格指纹 · ${record.name}】`)

  if (fp.avgSentenceLength) parts.push(`平均句长：${fp.avgSentenceLength}字`)
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
