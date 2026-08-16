import { describe, expect, it } from 'vitest'
import {
  getResumablePartialContent,
  resolveCurrentPipelineSnapshot,
} from './chapter-generation-snapshot'
import type { WritingPipelineSnapshot } from './parsers'

function createSnapshot(
  chapterId: number,
  status: WritingPipelineSnapshot['status'],
  partialContent = '',
): WritingPipelineSnapshot {
  return {
    kind: 'chapter_pipeline',
    chapterId,
    workflowTaskId: chapterId * 10,
    currentRole: null,
    currentStage: null,
    status,
    totalTokensUsed: 0,
    totalDurationMs: 0,
    partialContent,
    roles: {} as WritingPipelineSnapshot['roles'],
  }
}

describe('chapter generation snapshot selection', () => {
  it('prefers the live snapshot for the current chapter', () => {
    const live = createSnapshot(2, 'running')
    const persisted = createSnapshot(2, 'failed', '旧草稿')

    expect(resolveCurrentPipelineSnapshot(2, live, persisted)).toBe(live)
  })

  it('falls back to the persisted snapshot and rejects another chapter', () => {
    const persisted = createSnapshot(2, 'failed', '保留草稿')

    expect(resolveCurrentPipelineSnapshot(2, createSnapshot(1, 'running'), persisted)).toBe(persisted)
    expect(resolveCurrentPipelineSnapshot(3, createSnapshot(1, 'running'), persisted)).toBeNull()
  })

  it('only exposes trimmed failed or cancelled partial content for resume', () => {
    expect(getResumablePartialContent(createSnapshot(2, 'failed', ' 失败草稿 '))).toBe('失败草稿')
    expect(getResumablePartialContent(createSnapshot(2, 'cancelled', ' 取消草稿 '))).toBe('取消草稿')
    expect(getResumablePartialContent(createSnapshot(2, 'running', '半截流'))).toBe('')
    expect(getResumablePartialContent(createSnapshot(2, 'success', '已完成正文'))).toBe('')
  })
})
