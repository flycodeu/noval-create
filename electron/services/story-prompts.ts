import {
  buildStoryArcPlanningPrompt as rawBuildStoryArcPlanningPrompt,
  buildChapterOutlinePlanningPrompt as rawBuildChapterOutlinePlanningPrompt,
  buildTimelineEventsPrompt as rawBuildTimelineEventsPrompt,
  buildScenePlanPrompt as rawBuildScenePlanPrompt,
  buildChapterDraftPrompt as rawBuildChapterDraftPrompt,
  buildChapterWritingPrompt as rawBuildChapterWritingPrompt,
  buildChapterReviewPrompt as rawBuildChapterReviewPrompt,
  buildChapterRewritePrompt as rawBuildChapterRewritePrompt,
  buildContinuityStatePrompt as rawBuildContinuityStatePrompt,
  type StoryArcPromptInput,
  type ChapterOutlinePromptInput,
  type TimelineEventPromptInput,
  type ScenePlanPromptInput,
  type ChapterWritingPromptInput,
  type ChapterReviewPromptInput,
  type ChapterRewritePromptInput,
  type ContinuityPromptInput,
} from '../../src/shared/prompt-library'
import { applyPromptOverride } from './prompt-override.service'

export type {
  StoryArcPromptInput,
  ChapterOutlinePromptInput,
  TimelineEventPromptInput,
  ScenePlanPromptInput,
  ChapterWritingPromptInput,
  ChapterReviewPromptInput,
  ChapterRewritePromptInput,
  ContinuityPromptInput,
}

export function buildStoryArcPlanningPrompt(params: StoryArcPromptInput): string {
  const fallback = rawBuildStoryArcPlanningPrompt(params)
  return applyPromptOverride('storyArcs', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  const fallback = rawBuildChapterOutlinePlanningPrompt(params)
  return applyPromptOverride('chapterOutline', fallback, params as unknown as Record<string, unknown>)
}

export function buildTimelineEventsPrompt(params: TimelineEventPromptInput): string {
  const fallback = rawBuildTimelineEventsPrompt(params)
  return applyPromptOverride('timelineEvents', fallback, params as unknown as Record<string, unknown>)
}

export function buildScenePlanPrompt(params: ScenePlanPromptInput): string {
  const fallback = rawBuildScenePlanPrompt(params)
  return applyPromptOverride('scenePlan', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterDraftPrompt(params: ChapterRewritePromptInput): string {
  const fallback = rawBuildChapterDraftPrompt(params)
  return applyPromptOverride('chapterDraft', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  const fallback = rawBuildChapterWritingPrompt(params)
  return applyPromptOverride('chapterWriting', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterReviewPrompt(params: ChapterReviewPromptInput): string {
  const fallback = rawBuildChapterReviewPrompt(params)
  return applyPromptOverride('chapterReview', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterRewritePrompt(params: ChapterRewritePromptInput): string {
  const fallback = rawBuildChapterRewritePrompt(params)
  return applyPromptOverride('chapterRewrite', fallback, params as unknown as Record<string, unknown>)
}

export function buildContinuityStatePrompt(params: ContinuityPromptInput): string {
  const fallback = rawBuildContinuityStatePrompt(params)
  return applyPromptOverride('continuityState', fallback, params as unknown as Record<string, unknown>)
}
