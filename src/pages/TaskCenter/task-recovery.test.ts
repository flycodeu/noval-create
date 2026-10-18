import { describe, expect, it } from 'vitest'
import type { Task } from '../../types'
import { buildTaskRecoveryAction } from '../Novel/shared/workspace-navigation'

const task = (type: string, progress: Record<string, unknown>) => ({
  id: 13, novelId: 7, type, status: 'success', progressJson: JSON.stringify(progress),
}) as Task

describe('task historical drafts', () => {
  it.each([
    ['planning_draft', 'planning_draft'],
    ['premise_generate', 'premise_draft'],
  ])('keeps %s readable without navigating to unsupported restore routes', (type, kind) => {
    const draft = { pageKey: 'story-design', data: { title: '原始草稿', locked: true } }
    const value = task(type, { kind, draft })
    const before = value.progressJson
    const action = buildTaskRecoveryAction(value)
    expect(action?.kind).toBe('view_draft')
    expect(action?.path).toBeUndefined()
    expect(action?.description).toContain('只读')
    expect(value.progressJson).toBe(before)
  })

  it.each([null, [], 'broken'])('does not advertise a malformed draft: %j', draft => {
    expect(buildTaskRecoveryAction(task('planning_draft', { kind: 'planning_draft', draft }))).toBeNull()
    expect(buildTaskRecoveryAction(task('premise_generate', { kind: 'premise_draft', draft }))).toBeNull()
  })

  it('does not expose cleared drafts or change genuine workflow resume', () => {
    expect(buildTaskRecoveryAction(task('planning_draft', { kind: 'planning_draft', cleared: true, draft: {} }))).toBeNull()
    const resumable = { ...task('map_auto_generate', {}), runnerType: 'workflow', status: 'paused' } as Task
    expect(buildTaskRecoveryAction(resumable)?.kind).toBe('resume')
  })
})
