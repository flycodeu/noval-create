import { parseReaderFeedbackSettings, resolveReaderFeedbackForContext } from '../../src/shared/reader-feedback'
import { buildSceneWritingBrief, formatAuthorStyleReference } from '../../src/shared/scene-writing-brief'
import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'
import { requireId } from '../utils/ipc-validate'
import { safeParseJson } from '../utils/json'
import { throwUserFacingError } from '../utils/user-facing-error'
import { resolveNarrativePolicy } from '../../src/shared/narrative-policy'
import { stableHash } from '../../src/shared/context-pack'
import { appendNarrativeNaturalnessPrompt } from '../../src/shared/narrative-naturalness'
import type { AiExecutionMode } from '../../src/shared/ai-execution'
import { resolveAuthorStyleMaterial } from './style-analysis.service'
import { applyPromptOverride, getNarrativePromptSource } from './prompt-override.service'
import { contentScoringPrompt, rewriteParagraphPrompt } from './prompts'
import { enhanceAiScoreResult } from './ai-score.service'
import { buildAiModelRouteReport, buildChatOptionsFromRoute, resolveAiExecutionMode } from './ai-engine.service'
import { runChatTask } from './task.service'

interface ProseSource {
  novelId?: number
  chapterId?: number
  modelConfigId?: number
  executionMode?: AiExecutionMode
}
export interface RewriteProseInput extends ProseSource {
  originalParagraph: string
  contextBefore: string
  specificRequirements: string
}
export interface ScoreProseInput extends ProseSource {
  contentType: string
  content: string
  genreContext: string
  novelBackground: string
}

function resolveSource(input: ProseSource) {
  const db = getDb()
  const chapter = input.chapterId === undefined ? undefined
    : db.select().from(chapters).where(eq(chapters.id, requireId(input.chapterId))).all()[0]
  if (input.chapterId !== undefined && !chapter) throwUserFacingError('chapter.notFound')
  if (chapter && input.novelId !== undefined && chapter.novelId !== input.novelId) throwUserFacingError('chapter.pipelineContentConflict')
  const novelId = input.novelId ?? chapter?.novelId
  const novel = novelId === undefined ? undefined
    : db.select().from(novels).where(eq(novels.id, requireId(novelId))).all()[0]
  if (novelId !== undefined && !novel) throwUserFacingError('novel.notFound')
  return novel
}

export function resolveProsePolicyMaterial(novelId: number, chapterId?: number) {
  const novel = resolveSource({ novelId, chapterId })!
  const policy = resolveNarrativePolicy(novel.settingsJson, true)
  const style = resolveAuthorStyleMaterial(novelId)
  const sources = getDb().select({ id: chapters.id, content: chapters.content }).from(chapters).where(eq(chapters.novelId, novelId)).all()
  const feedback = resolveReaderFeedbackForContext(parseReaderFeedbackSettings(novel.settingsJson), {
    novelId, chapterId: chapterId ?? 0,
    sourceContentsByChapterId: Object.fromEntries(sources.map((row) => [row.id, row.content || ''])),
  })
  return { policy, style, feedback, reference: formatAuthorStyleReference(buildSceneWritingBrief(null, { targetWorkSampleGuide: '', humanStyleSampleLock: '', ...style, readerFeedback: feedback })) }
}

/** Both transports compile here. These operations return candidates, never write prose or Canon. */
export function buildProseOperation(kind: 'rewrite' | 'score', input: RewriteProseInput | ScoreProseInput) {
  const novel = resolveSource(input)
  const policy = resolveNarrativePolicy(novel?.settingsJson, true)
  const material = novel ? resolveProsePolicyMaterial(novel.id, input.chapterId) : undefined
  const style = material?.style
  const key = kind === 'rewrite' ? 'rewriteParagraph' : 'contentScoring'
  const source = getNarrativePromptSource(key)
  let prompt: string
  if (policy.policyVersion === 'legacy') {
    prompt = kind === 'rewrite' ? rewriteParagraphPrompt(input as RewriteProseInput)
      : appendNarrativeNaturalnessPrompt(contentScoringPrompt(input as ScoreProseInput), {
        genre: (input as ScoreProseInput).genreContext, mode: 'review',
      })
  } else {
    const rules = '保留已确认事实、人物差异、叙事视角与作者明确要求。风格偏好只是建议，不能因单词命中、相似度或数量升级为事实阻断。只处理有原文依据的问题；结构因果问题应返回规划建议。'
    const body = kind === 'rewrite'
      ? `只输出所选原文的修订候选，不扩写邻段；允许最小修改和有依据的删冗。\n要求：${(input as RewriteProseInput).specificRequirements}\n前文：${(input as RewriteProseInput).contextBefore}\n原文：${(input as RewriteProseInput).originalParagraph}`
      : `评价当前文本的阅读效果，有效表达应保留；指出问题原文、最小修改范围与需保留之处。只输出 JSON，字段 dimensions（name/score/feedback/suggestion）、ai_like_rate、repetition_risk、overall_score、overall_feedback、top_fixes。评分不能证明作者身份，也不授予定稿许可。\n内容类型：${(input as ScoreProseInput).contentType}\n原文：${(input as ScoreProseInput).content}`
    prompt = applyPromptOverride(key, [rules, body, material?.reference || ''].filter(Boolean).join('\n\n'), { ...input }, 'reader-first-v1')
  }
  const execution = resolveAiExecutionMode({ explicitMode: input.executionMode, settingsJson: novel?.settingsJson })
  const route = buildAiModelRouteReport({ taskKind: kind === 'rewrite' ? 'paragraph_rewrite' : 'chapter_review', stageLabel: kind === 'rewrite' ? 'Paragraph Rewrite' : 'Content Score', executionMode: execution.mode, resolutionSource: execution.source, modelConfigId: input.modelConfigId ?? novel?.modelConfigId })
  return { prompt, route, novelId: novel?.id, diagnostics: { policy, styleSourceDigest: style?.approvedSample?.digest || '', style: style?.styleSourceDiagnostics || [], source, feedback: material?.feedback, inputDigest: stableHash(input), messagesDigest: stableHash(prompt) } }
}

async function runProseOperation(kind: 'rewrite' | 'score', input: RewriteProseInput | ScoreProseInput) {
  const compiled = buildProseOperation(kind, input)
  return runChatTask({ novelId: compiled.novelId, relatedEntityType: input.chapterId ? 'chapter' : undefined, relatedEntityId: input.chapterId, recoveryHintJson: JSON.stringify({ kind: 'prose-operation', operation: kind, diagnostics: compiled.diagnostics }), type: 'review', retryable: true, messages: [{ role: 'user', content: compiled.prompt }], modelConfigId: compiled.route.modelConfigId, chatOpts: buildChatOptionsFromRoute(compiled.route) })
}
export function rewriteProse(input: RewriteProseInput): Promise<string> {
  return runProseOperation('rewrite', input)
}
export async function scoreProse(input: ScoreProseInput) {
  return enhanceAiScoreResult(safeParseJson(await runProseOperation('score', input)), input.content)
}
