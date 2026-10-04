import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const rows = vi.hoisted(() => new Map<string, Record<string, any>>())
vi.mock('./artifact.service', () => ({
  hashArtifactContent: (content: unknown) => createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  findArtifactByIdempotency: (_novelId: number, _kind: string, key: string) => rows.get(key) || null,
  createArtifact: (input: any) => {
    const artifact = { ...input, id: `art_${rows.size + 1}`, modelConfigId: input.modelConfigId ?? null,
      contentHash: createHash('sha256').update(JSON.stringify(input.content)).digest('hex') }
    rows.set(input.idempotencyKey, artifact)
    return artifact
  },
}))
import { createCreativeModelCheckpoint } from './creative-model-checkpoint'
import { hasResumableWorkflowCheckpoint } from '../../src/shared/workflow-resilience'

describe('completed creative model checkpoints', () => {
  beforeEach(() => rows.clear())
  const request = { phase: 'generate' as const, prompt: '记录旧灯', modelConfigId: 1, chatOpts: { maxTokens: 100 } }
  const input = { novelId: 1, runId: 7, attempt: 1, contextVersion: 3, identityHash: 'identity', assertCurrent: () => {}, onSaved: vi.fn() }
  it('reuses a complete response after recreating the checkpoint reader', () => {
    createCreativeModelCheckpoint(input).save(request, '{"name":"旧灯"}', 2)
    expect(createCreativeModelCheckpoint(input).read(request)).toEqual({ output: '{"name":"旧灯"}', taskId: 2 })
    expect(hasResumableWorkflowCheckpoint({ runnerType: 'workflow', type: 'planning_draft', progressJson: JSON.stringify({ modelCheckpoint: input.onSaved.mock.lastCall?.[0] }) })).toBe(true)
  })
  it('never treats partial empty output, another attempt or changed prompt as a saved response', () => {
    const checkpoint = createCreativeModelCheckpoint(input)
    expect(() => checkpoint.save(request, ' ', 2)).toThrow('未完成')
    checkpoint.save(request, '{}', 2)
    expect(createCreativeModelCheckpoint({ ...input, attempt: 2 }).read(request)).toBeNull()
    expect(checkpoint.read({ ...request, prompt: '另一任务' })).toBeNull()
  })
  it('refuses stale, corrupted or cancelled checkpoints', () => {
    createCreativeModelCheckpoint(input).save(request, '{}', 2)
    expect(() => createCreativeModelCheckpoint({ ...input, contextVersion: 4 }).read(request)).toThrow('不一致')
    const artifact = [...rows.values()][0]
    artifact.content.output = '被替换'
    expect(() => createCreativeModelCheckpoint(input).read(request)).toThrow('不一致')
    expect(() => createCreativeModelCheckpoint({ ...input, assertCurrent: () => { throw new Error('已取消') } }).read(request)).toThrow('已取消')
  })
})
