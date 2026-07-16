import { describe, expect, it } from 'vitest'
import { describeNovelLifecycle, deriveNovelLifecycleStatus } from './novel-lifecycle.service'

describe('novel lifecycle derivation', () => {
  it('keeps an explicitly archived project archived', () => {
    expect(deriveNovelLifecycleStatus('archived', [{ status: 'writing', wordCount: 3000 }])).toBe('archived')
  })

  it('moves a structured project into writing after content production starts', () => {
    expect(deriveNovelLifecycleStatus('draft', [
      { status: 'outline', wordCount: 0 },
      { status: 'draft', wordCount: 2800 },
    ])).toBe('writing')
  })

  it('marks a project completed only when every chapter is final', () => {
    expect(deriveNovelLifecycleStatus('writing', [
      { status: 'final', wordCount: 3000 },
      { status: 'final', wordCount: 3200 },
    ])).toBe('completed')
    expect(deriveNovelLifecycleStatus('writing', [
      { status: 'final', wordCount: 3000 },
      { status: 'outline', wordCount: 0 },
    ])).toBe('writing')
  })

  it('exposes the automatic transition reason for the project card/status manager', () => {
    expect(describeNovelLifecycle('draft', [{ status: 'final', wordCount: 3000 }])).toEqual({
      status: 'completed',
      label: '已完成',
      automatic: true,
      reason: '所有章节均已定稿。',
    })
    expect(describeNovelLifecycle('archived', [{ status: 'writing', wordCount: 3000 }]).automatic).toBe(false)
  })

  it('preserves a manually selected status across lifecycle reconciliation', () => {
    expect(describeNovelLifecycle('completed', [], 'manual')).toEqual({
      status: 'completed',
      label: '已完成',
      automatic: false,
      reason: '作者手动设置了项目状态。',
    })
  })

  it('projects legacy work-state statuses without rewriting their durable value', () => {
    expect(describeNovelLifecycle('serializing', [{ status: 'final', wordCount: 3000 }])).toMatchObject({
      status: 'writing',
      automatic: true,
    })
  })
})
