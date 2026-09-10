/**
 * Stable compatibility facade for IPC, local-web and legacy service imports.
 * Business rules live in the owner modules; this file intentionally only re-exports them.
 */
export {
  __testing,
  aiCheckChapter,
  batchDeleteChapters,
  batchRenumberChapters,
  batchUpdateChapters,
  createChapter,
  deleteChapter,
  generateChapterContent,
  generateChapterSummary,
  getChapter,
  getChapterContextPreview,
  listChapterVersions,
  listChapters,
  optimizeChapterContent,
  refreshChapterDerivedState,
  reorderChapters,
  restoreChapterVersion,
  resumeChapterPipeline,
  retryChapterPipelineNode,
  runChapterPublishCheck,
  sanitizeChapterGenerationOptions,
  sanitizeChapterUpdateOptions,
  sanitizeChapterUpdatePayload,
  updateChapter,
} from './chapter-generation.usecase'
export type { ChapterVersionSource } from './chapter-generation.usecase'
