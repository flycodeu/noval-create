import {
  GLOBAL_WRITING_RULES,
  expandBackgroundPrompt as rawExpandBackgroundPrompt,
  protagonistPrompt as rawProtagonistPrompt,
  batchCharacterPrompt as rawBatchCharacterPrompt,
  regenerateCharacterPrompt as rawRegenerateCharacterPrompt,
  characterRelationsPrompt as rawCharacterRelationsPrompt,
  mapGenerationPrompt as rawMapGenerationPrompt,
  storyArcsPrompt as rawStoryArcsPrompt,
  chapterOutlinePrompt as rawChapterOutlinePrompt,
  chapterWritingPrompt as rawChapterWritingPrompt,
  chapterSummaryPrompt as rawChapterSummaryPrompt,
  aiCheckPrompt as rawAiCheckPrompt,
  rewriteParagraphPrompt as rawRewriteParagraphPrompt,
  genericExpandPrompt as rawGenericExpandPrompt,
  subplotExpandPrompt as rawSubplotExpandPrompt,
  contentScoringPrompt as rawContentScoringPrompt,
  type BatchCharacterPromptInput,
  type CharacterRelationsPromptInput,
  type ContentScoringPromptInput,
  type GenericExpandPromptInput,
  type MapGenerationPromptInput,
  type ProtagonistPromptInput,
  type RegenerateCharacterPromptInput,
  type RewriteParagraphPromptInput,
  type SubplotExpandPromptInput,
} from '../../src/shared/prompt-library'
import { applyPromptOverride } from './prompt-override.service'

export { GLOBAL_WRITING_RULES }

type StoryArcsPromptParams = Parameters<typeof rawStoryArcsPrompt>[0]
type ChapterOutlinePromptParams = Parameters<typeof rawChapterOutlinePrompt>[0]
type ChapterWritingPromptParams = Parameters<typeof rawChapterWritingPrompt>[0]

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary?: string
}): string {
  const normalizedParams = {
    ...params,
    worldTemplateSummary: params.worldTemplateSummary || '',
  }
  const fallback = rawExpandBackgroundPrompt(normalizedParams)
  return applyPromptOverride('expandBackground', fallback, normalizedParams)
}

export function protagonistPrompt(params: ProtagonistPromptInput): string {
  const fallback = rawProtagonistPrompt(params)
  return applyPromptOverride('protagonist', fallback, params as unknown as Record<string, unknown>)
}

export function batchCharacterPrompt(params: BatchCharacterPromptInput): string {
  const fallback = rawBatchCharacterPrompt(params)
  return applyPromptOverride('batchCharacter', fallback, params as unknown as Record<string, unknown>)
}

export function regenerateCharacterPrompt(params: RegenerateCharacterPromptInput): string {
  const fallback = rawRegenerateCharacterPrompt(params)
  return applyPromptOverride('regenerateCharacter', fallback, params as unknown as Record<string, unknown>)
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  const fallback = rawCharacterRelationsPrompt(params)
  return applyPromptOverride('characterRelations', fallback, params as unknown as Record<string, unknown>)
}

export function mapGenerationPrompt(params: MapGenerationPromptInput): string {
  const fallback = rawMapGenerationPrompt(params)
  return applyPromptOverride('mapGeneration', fallback, params as unknown as Record<string, unknown>)
}

export function storyArcsPrompt(params: StoryArcsPromptParams): string {
  const fallback = rawStoryArcsPrompt(params)
  return applyPromptOverride('storyArcsLegacy', fallback, params as unknown as Record<string, unknown>)
}

export function chapterOutlinePrompt(params: ChapterOutlinePromptParams): string {
  const fallback = rawChapterOutlinePrompt(params)
  return applyPromptOverride('chapterOutlineLegacy', fallback, params as unknown as Record<string, unknown>)
}

export function chapterWritingPrompt(params: ChapterWritingPromptParams): string {
  const fallback = rawChapterWritingPrompt(params)
  return applyPromptOverride('chapterWriting', fallback, params as unknown as Record<string, unknown>)
}

export function chapterSummaryPrompt(chapterContent: string): string {
  const fallback = rawChapterSummaryPrompt(chapterContent)
  return applyPromptOverride('chapterSummary', fallback, { chapterContent })
}

export function aiCheckPrompt(text: string): string {
  const fallback = rawAiCheckPrompt(text)
  return applyPromptOverride('aiCheck', fallback, { text })
}

export function rewriteParagraphPrompt(params: RewriteParagraphPromptInput): string {
  const fallback = rawRewriteParagraphPrompt(params)
  return applyPromptOverride('rewriteParagraph', fallback, params as unknown as Record<string, unknown>)
}

export function genericExpandPrompt(params: GenericExpandPromptInput): string {
  const fallback = rawGenericExpandPrompt(params)
  return applyPromptOverride('genericExpand', fallback, params as unknown as Record<string, unknown>)
}

export function subplotExpandPrompt(params: SubplotExpandPromptInput): string {
  const fallback = rawSubplotExpandPrompt(params)
  return applyPromptOverride('subplotExpand', fallback, params as unknown as Record<string, unknown>)
}

export function contentScoringPrompt(params: ContentScoringPromptInput): string {
  const fallback = rawContentScoringPrompt(params)
  return applyPromptOverride('contentScoring', fallback, params as unknown as Record<string, unknown>)
}
