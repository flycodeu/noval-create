import { describe, expect, it } from 'vitest'
import type { Chapter, ForeshadowSnapshot, Task } from '../../../types'
import type { WritingGenerationSnapshot } from '../../../stores/writingView.store'
import {
  buildDueForeshadowPresentation,
  buildWritingPipelineRuntimePresentation,
  countWritingEditorAdvisories,
  hasMultipleChapterSegments,
  resolveCurrentChapterGeneration,
} from './writing-runtime-presentation'

const generation = (chapterId: number, status: WritingGenerationSnapshot['status']): WritingGenerationSnapshot => ({
  chapterId,
  taskId: null,
  streamTaskId: null,
  stage: null,
  status,
  error: null,
  label: null,
  detail: null,
  startedAt: null,
  finishedAt: null,
})

describe('writing runtime presentation', () => {
  it('detects multi-segment chapters from the persisted segment count', () => {
    expect(hasMultipleChapterSegments({ segmentCount: 2 } as Chapter)).toBe(true)
    expect(hasMultipleChapterSegments({ segmentCount: 1 } as Chapter)).toBe(false)
    expect(hasMultipleChapterSegments(null)).toBe(false)
  })

  it('prefers the current live pipeline and keeps canonical role ordering', () => {
    const liveSnapshot = {
      kind: 'chapter_pipeline',
      chapterId: 2,
      executionMode: 'fast',
      roles: {
        writer: { role: 'writer' },
        planner: { role: 'planner' },
      },
    } as never
    const latestTask = {
      progressJson: JSON.stringify({ kind: 'chapter_pipeline', chapterId: 2, roles: {} }),
    } as Task
    const result = buildWritingPipelineRuntimePresentation({ chapterId: 2, liveSnapshot, latestTask })

    expect(result.snapshot).toBe(liveSnapshot)
    expect(result.roles.map((role) => role.role)).toEqual(['planner', 'writer'])
  })

  it('selects active generation only for the current chapter', () => {
    const activeGeneration = generation(3, 'running')
    const chapterTwo = { id: 2 } as Chapter
    const result = resolveCurrentChapterGeneration({
      chapter: chapterTwo,
      activeGeneration,
      lastGenerationByChapter: { 2: generation(2, 'success') },
    })

    expect(result.generation?.status).toBe('success')
    expect(result.generating).toBe(false)
  })

  it('formats overdue items before due-soon items and limits the summary', () => {
    const snapshot = {
      currentChapterNum: 8,
      overdue: [{ title: '旧伏笔', targetPayoffChapter: 6, warningText: '已经超期' }],
      dueSoon: Array.from({ length: 9 }, (_, index) => ({ title: `伏笔${index}`, targetPayoffChapter: 9 })),
    } as ForeshadowSnapshot
    const result = buildDueForeshadowPresentation(snapshot)

    expect(result.eyebrow).toBe('按第 8 章进度计算')
    expect(result.items).toHaveLength(8)
    expect(result.items[0]).toContain('超期 · 旧伏笔')
  })

  it('counts each editor advisory domain once', () => {
    expect(countWritingEditorAdvisories({
      productionBriefCount: 2,
      staleReasonCount: 3,
      readyForNextChapter: false,
      hasPublishCheck: true,
      hasMultiSegments: true,
    })).toBe(6)
  })
})
