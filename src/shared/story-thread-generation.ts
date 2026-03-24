export interface StoryThreadBatchGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
}

export interface StoryThreadBatchGenerationResult {
  ids: number[]
  requestedCount: number
  createdCount: number
  warnings: string[]
}
