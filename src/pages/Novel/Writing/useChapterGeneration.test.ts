import { describe, expect, it } from 'vitest'
import {
  getResumablePartialContent,
  resolveCurrentPipelineSnapshot,
} from './chapter-generation-snapshot'
import type { WritingPipelineSnapshot } from './parsers'
import { buildWritingPipelineRuntimePresentation } from './writing-runtime-presentation'

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
  it('keeps A live progress available after visiting B and uses B persisted data while selected', () => {
    const live = createSnapshot(901, 'running')
    const persisted = createSnapshot(15, 'cancelled', 'B 保留草稿')
    const task = { id: 150, progressJson: JSON.stringify(persisted) } as Parameters<typeof buildWritingPipelineRuntimePresentation>[0]['latestTask']
    expect(buildWritingPipelineRuntimePresentation({ chapterId: 15, liveSnapshot: live, latestTask: task }).snapshot).toEqual(persisted)
    expect(buildWritingPipelineRuntimePresentation({ chapterId: 901, liveSnapshot: live, latestTask: null }).snapshot).toBe(live)
    expect(buildWritingPipelineRuntimePresentation({ chapterId: null, liveSnapshot: live, latestTask: task }).snapshot).toBeNull()
  })
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
