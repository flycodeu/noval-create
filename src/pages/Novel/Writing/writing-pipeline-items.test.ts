import { describe, expect, it, vi } from 'vitest'
import {
  attachWritingPipelineRetry,
  buildWritingPipelineItemViewModels,
} from './writing-pipeline-items'
import type { WritingPipelineSnapshot } from './parsers'

describe('writing pipeline item view models', () => {
  it('derives legacy completion fallbacks without a persisted snapshot', () => {
    const items = buildWritingPipelineItemViewModels({
      chapter: { content: '正文', status: 'final' },
      snapshot: null,
      reviewNotes: { summary: '已审校' } as Parameters<typeof buildWritingPipelineItemViewModels>[0]['reviewNotes'],
      sceneCount: 2,
    })

    expect(items.map((item) => [item.key, item.status])).toEqual([
      ['planner', 'success'],
      ['writer', 'success'],
      ['critic', 'success'],
      ['enforcer', 'pending'],
      ['rewriter', 'success'],
      ['canonizer', 'pending'],
      ['finalize', 'success'],
    ])
  })

  it('prefers persisted role state and keeps retry as a separate action binding', () => {
    const snapshot = {
      workflowTaskId: 42,
      contractVersion: 'contract-v2',
      roles: {
        planner: { role: 'planner', status: 'failed', failureCode: 'planner.failed' },
      },
    } as unknown as WritingPipelineSnapshot
    const viewModels = buildWritingPipelineItemViewModels({
      chapter: { content: '', status: 'draft' },
      snapshot,
      reviewNotes: null,
      sceneCount: 0,
    })
    const retry = vi.fn()
    const items = attachWritingPipelineRetry(viewModels, retry)

    expect(items[0]).toMatchObject({
      key: 'planner',
      status: 'failed',
      taskId: 42,
      contractVersion: 'contract-v2',
      error: 'planner.failed',
      canRetry: true,
      onRetry: retry,
    })
    expect(items[1].onRetry).toBeUndefined()
    expect(viewModels[0]).not.toHaveProperty('onRetry')
  })
})
