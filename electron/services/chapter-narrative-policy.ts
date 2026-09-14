import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, modelConfigs, novels, templates } from '../database/schema'
import { listPromptOverrides } from './prompt-override.service'
import { resolveAuthorStyleMaterial } from './style-analysis.service'
import { resolveContextCompilerMode } from './context-compiler'
import { assertNarrativeResumeIdentity, buildNarrativeInputIdentity, resolveNarrativePolicy, type NarrativeInputIdentity } from '../../src/shared/narrative-policy'
import { stableHash } from '../../src/shared/context-pack'
import { throwUserFacingError } from '../utils/user-facing-error'

const PROMPT_KEYS = new Set(['scenePlan', 'chapterDraft', 'chapterWriting', 'chapterReview', 'chapterRewrite'])

/** Read-only identity resolution. Model secrets never enter the descriptor or reports. */
export function resolveChapterNarrativeIdentity(chapterId: number): NarrativeInputIdentity {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  const novel = chapter && db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!chapter || !novel) throw new Error('章节或作品不存在。')
  const templateIds = [novel.styleTemplateId, novel.worldTemplateId].filter((id): id is number => typeof id === 'number')
  const selectedTemplates = templateIds.length ? db.select().from(templates).where(inArray(templates.id, templateIds)).all() : []
  const models = db.select({ id: modelConfigs.id, provider: modelConfigs.provider, modelId: modelConfigs.modelId,
    baseUrl: modelConfigs.baseUrl, temperature: modelConfigs.temperature, maxTokens: modelConfigs.maxTokens,
    maxContextTokens: modelConfigs.maxContextTokens, isDefault: modelConfigs.isDefault, extraParamsJson: modelConfigs.extraParamsJson }).from(modelConfigs).all()
  return buildNarrativeInputIdentity({
    policy: resolveNarrativePolicy(novel.settingsJson, true),
    compilerMode: resolveContextCompilerMode(),
    styleSource: { ...resolveAuthorStyleMaterial(novel.id), themeVoiceJson: novel.themeVoiceJson, templateId: novel.styleTemplateId },
    inputSource: { novelId: novel.id, title: novel.title, genreId: novel.genreId, settingsJson: novel.settingsJson,
      projectBriefJson: novel.projectBriefJson, userBackground: novel.userBackground, expandedBackground: novel.expandedBackground,
      synopsis: novel.synopsis, launchMode: novel.launchMode, novelTargetWords: novel.targetWords,
      worldRulesJson: novel.worldRulesJson, selectedTemplates,
      chapterId, chapterTitle: chapter.title, outline: chapter.outline, targetWords: chapter.targetWords, emotionTone: chapter.emotionTone,
      chapterNum: chapter.chapterNum, arcId: chapter.arcId, volumeId: chapter.volumeId, partId: chapter.partId,
      allowedFactIdsJson: chapter.allowedFactIdsJson, revealedFactIdsJson: chapter.revealedFactIdsJson },
    overrides: listPromptOverrides().filter((record) => PROMPT_KEYS.has(record.key)).sort((a, b) => a.key.localeCompare(b.key)),
    models: { selected: novel.modelConfigId, available: models.sort((a, b) => a.id - b.id) },
  })
}

export function currentNarrativeSceneIdentity(identity: NarrativeInputIdentity, scenePlanJson?: string | null): NarrativeInputIdentity {
  return { ...identity, scenePlanDigest: scenePlanJson?.trim() ? stableHash(JSON.parse(scenePlanJson)) : '' }
}

export function assertChapterNarrativeInputCurrent(chapterId: number, expected: NarrativeInputIdentity, expectedContextVersion?: number): void {
  const current = resolveChapterNarrativeIdentity(chapterId)
  const db = getDb()
  const chapter = db.select({ novelId: chapters.novelId, scenePlanJson: chapters.scenePlanJson }).from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (expectedContextVersion !== undefined && chapter) {
    const novel = db.select({ contextVersion: novels.contextVersion }).from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
    if ((novel?.contextVersion || 1) !== expectedContextVersion) throwUserFacingError('chapter.pipelineContextConflict')
  }
  assertNarrativeResumeIdentity(expected, currentNarrativeSceneIdentity(current, chapter?.scenePlanJson))
}
