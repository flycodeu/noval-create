export type ChapterPipelineResumeMode = 'restart' | 'continue_writer' | 'review_preserved_draft'

/**
 * A Writer interruption may hold an incomplete stream and needs continuation.
 * Any later-stage failure already holds a complete candidate: appending more
 * prose would bypass the intended review loop and inflate the chapter.
 */
export function resolveChapterPipelineResumeMode(input: {
  hasPartialContent: boolean
  lastFailureRole?: string | null
}): ChapterPipelineResumeMode {
  if (!input.hasPartialContent) return 'restart'
  return input.lastFailureRole === 'writer'
    ? 'continue_writer'
    : 'review_preserved_draft'
}
