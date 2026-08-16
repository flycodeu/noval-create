import { getAiExecutionModeLabel } from '../../../shared/ai-execution'
import type { Chapter, ForeshadowSnapshot, Task } from '../../../types'
import type { WritingGenerationSnapshot } from '../../../stores/writingView.store'
import { formatChapterNumber } from './chapter-labels'
import { resolveCurrentPipelineSnapshot } from './chapter-generation-snapshot'
import {
  parsePipelineSnapshot,
  type WritingPipelineRole,
  type WritingPipelineRoleState,
  type WritingPipelineSnapshot,
} from './parsers'

const PIPELINE_ROLE_ORDER: WritingPipelineRole[] = [
  'planner',
  'writer',
  'critic',
  'enforcer',
  'rewriter',
  'canonizer',
  'finalize',
]

export function hasMultipleChapterSegments(chapter: Chapter | null): boolean {
  return (chapter?.segmentCount || 0) > 1
}

export function buildWritingPipelineRuntimePresentation(input: {
  chapterId: number | null
  liveSnapshot: WritingPipelineSnapshot | null
  latestTask: Task | null
}) {
  const persistedSnapshot = parsePipelineSnapshot(input.latestTask?.progressJson)
  const snapshot = resolveCurrentPipelineSnapshot(input.chapterId, input.liveSnapshot, persistedSnapshot)
  const roles = PIPELINE_ROLE_ORDER
    .map((role) => snapshot?.roles[role])
    .filter(Boolean) as WritingPipelineRoleState[]
  return {
    snapshot,
    roles,
    executionModeLabel: snapshot?.executionMode
      ? getAiExecutionModeLabel(snapshot.executionMode)
      : undefined,
  }
}

export function resolveCurrentChapterGeneration(input: {
  chapter: Chapter | null
  activeGeneration: WritingGenerationSnapshot
  lastGenerationByChapter: Record<number, WritingGenerationSnapshot>
}) {
  const { activeGeneration, chapter, lastGenerationByChapter } = input
  const generation = chapter
    ? activeGeneration.chapterId === chapter.id && activeGeneration.status !== 'idle'
      ? activeGeneration
      : lastGenerationByChapter[chapter.id] || null
    : null
  return {
    generation,
    generating: generation?.status === 'running' && activeGeneration.chapterId === chapter?.id,
  }
}

export function buildDueForeshadowPresentation(snapshot: ForeshadowSnapshot | null) {
  if (!snapshot) {
    return { eyebrow: '即将到期 / 超期未收', items: [] as string[] }
  }
  const overdue = snapshot.overdue.map((item) => (
    `超期 · ${item.title} · 目标 ${formatChapterNumber(item.targetPayoffChapter)}`
    + `${item.payoffCondition ? ` · 条件：${item.payoffCondition}` : ''}`
    + `${item.warningText ? ` · ${item.warningText}` : ''}`
  ))
  const dueSoon = snapshot.dueSoon.map((item) => (
    `到期 · ${item.title} · 目标 ${formatChapterNumber(item.targetPayoffChapter)}`
    + `${item.payoffCondition ? ` · 条件：${item.payoffCondition}` : ''}`
  ))
  return {
    eyebrow: `按第 ${snapshot.currentChapterNum} 章进度计算`,
    items: [...overdue, ...dueSoon].slice(0, 8),
  }
}

export function countWritingEditorAdvisories(input: {
  productionBriefCount: number
  staleReasonCount: number
  readyForNextChapter?: boolean
  hasPublishCheck: boolean
  hasMultiSegments: boolean
}): number {
  return input.productionBriefCount
    + (input.staleReasonCount > 0 ? 1 : 0)
    + (input.readyForNextChapter === false ? 1 : 0)
    + (input.hasPublishCheck ? 1 : 0)
    + (input.hasMultiSegments ? 1 : 0)
}
