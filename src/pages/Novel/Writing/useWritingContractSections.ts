import { useMemo } from 'react'
import {
  buildChapterContractSections,
  buildSceneContractSections,
  type ChapterContractSectionInput,
} from './writing-contract-view-model'

export function useWritingContractSections(input: ChapterContractSectionInput) {
  const {
    activeThreads,
    chapter,
    contractAudit,
    dueForeshadowItems,
    publishCheck,
    scenePlan,
    staleReasons,
    truthRevealOverLimit,
  } = input
  const chapterSections = useMemo(() => buildChapterContractSections({
    activeThreads,
    chapter,
    contractAudit,
    dueForeshadowItems,
    publishCheck,
    scenePlan,
    staleReasons,
    truthRevealOverLimit,
  }), [
    activeThreads,
    chapter,
    contractAudit,
    dueForeshadowItems,
    publishCheck,
    scenePlan,
    staleReasons,
    truthRevealOverLimit,
  ])
  const sceneSections = useMemo(() => buildSceneContractSections(scenePlan), [scenePlan])

  return { chapterSections, sceneSections }
}
