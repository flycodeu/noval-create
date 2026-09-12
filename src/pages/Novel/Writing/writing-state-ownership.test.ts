import { describe, expect, it } from 'vitest'
import type { ChapterContextPreview } from '../../../types'
import type { WritingPipelineSnapshot } from './parsers'
import {
  canResumeWritingPipeline,
  isWritingPipelineResumeHandoff,
  reduceWritingContextPreview,
} from './writing-state-ownership'
import { reduceWritingReviewGateState } from './useWritingReviewState'

describe('NF-18 query and review ownership', () => {
  it('commits preview success/failure/clear atomically without touching editor state', () => {
    const preview = { chapterId: 901 } as ChapterContextPreview
    const editor = { content: '用户正文', selection: [1, 3], undo: ['原文'] }
    const before = structuredClone(editor)
    let query = reduceWritingContextPreview({ preview: null, error: '旧错误' }, { type: 'success', preview })
    expect(query).toEqual({ preview, error: null })
    query = reduceWritingContextPreview(query, { type: 'failure', error: '加载失败' })
    expect(query).toEqual({ preview: null, error: '加载失败' })
    expect(reduceWritingContextPreview(query, { type: 'clear' })).toEqual({ preview: null, error: null })
    expect(editor).toEqual(before)
  })

  it('keeps the last preview during refresh and clears only its old error', () => {
    const preview = { chapterId: 901 } as ChapterContextPreview
    expect(reduceWritingContextPreview({ preview, error: '重试' }, { type: 'start' }))
      .toEqual({ preview, error: null })
  })

  it('resets chapter review gate even when the previous report was manually expanded', () => {
    expect(reduceWritingReviewGateState({ publishCheck: null, gateReportExpanded: true }, { type: 'reset' }))
      .toEqual({ publishCheck: null, gateReportExpanded: false })
  })
})

describe('NF-18 pipeline resume identity', () => {
  const snapshot = {
    kind: 'chapter_pipeline', chapterId: 901, workflowTaskId: 5001, status: 'cancelled',
    revisionBudget: { id: 'original-budget', limit: 2, used: 1, attemptKeys: ['rewrite:1'] },
  } as unknown as WritingPipelineSnapshot

  it('accepts only the current chapter and the task belonging to its snapshot', () => {
    expect(canResumeWritingPipeline(901, { id: 5001 }, snapshot)).toBe(true)
    expect(canResumeWritingPipeline(15, { id: 5001 }, snapshot)).toBe(false)
    expect(canResumeWritingPipeline(901, { id: 5002 }, snapshot)).toBe(false)
    expect(canResumeWritingPipeline(null, { id: 5001 }, snapshot)).toBe(false)
    expect(canResumeWritingPipeline(901, null, snapshot)).toBe(false)
  })

  it('does not reset the persisted revision budget and rejects a running/success snapshot', () => {
    const before = structuredClone(snapshot)
    expect(canResumeWritingPipeline(901, { id: 5001 }, snapshot)).toBe(true)
    expect(snapshot).toEqual(before)
    expect(canResumeWritingPipeline(901, { id: 5001 }, { ...snapshot, status: 'running' })).toBe(false)
    expect(canResumeWritingPipeline(901, { id: 5001 }, { ...snapshot, status: 'success' })).toBe(false)
  })

  it('adopts only the running workflow that names the exact resume source', () => {
    const resumed = {
      ...snapshot,
      workflowTaskId: 5002,
      status: 'running',
      resumeSourceTaskId: 5001,
    } as WritingPipelineSnapshot
    const input = {
      sourceChapterId: 901,
      sourceTaskId: 5001,
      eventChapterId: 901,
      eventTaskId: 5002,
      snapshot: resumed,
    }

    expect(isWritingPipelineResumeHandoff(input)).toBe(true)
    expect(isWritingPipelineResumeHandoff({ ...input, eventChapterId: 15 })).toBe(false)
    expect(isWritingPipelineResumeHandoff({ ...input, eventTaskId: 5003 })).toBe(false)
    expect(isWritingPipelineResumeHandoff({ ...input, snapshot: { ...resumed, resumeSourceTaskId: 4999 } })).toBe(false)
    expect(isWritingPipelineResumeHandoff({ ...input, snapshot: { ...resumed, status: 'cancelled' } })).toBe(false)
  })
})
