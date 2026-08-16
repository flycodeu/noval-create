import { useMemo } from 'react'
import type { PipelineBarItem } from '../../../components/novel/writing/PipelineBar'
import {
  attachWritingPipelineRetry,
  buildWritingPipelineItemViewModels,
  type WritingPipelineItemInput,
} from './writing-pipeline-items'

export function useWritingPipelineItems(
  input: WritingPipelineItemInput,
  onRetry: () => void,
): PipelineBarItem[] {
  const { chapter, reviewNotes, sceneCount, snapshot } = input
  const viewModels = useMemo(
    () => buildWritingPipelineItemViewModels({ chapter, reviewNotes, sceneCount, snapshot }),
    [chapter, reviewNotes, sceneCount, snapshot],
  )

  return useMemo(
    () => attachWritingPipelineRetry(viewModels, onRetry),
    [onRetry, viewModels],
  )
}
