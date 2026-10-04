import type { ChatOptions } from '../adapters/base.adapter'
import { createArtifact, findArtifactByIdempotency, hashArtifactContent } from './artifact.service'

export interface ModelOutputRequest {
  phase: 'generate' | 'review' | 'rewrite'
  prompt: string
  modelConfigId?: number
  chatOpts?: Partial<ChatOptions>
}
export interface ModelOutputCheckpoint {
  read(request: ModelOutputRequest): { output: string; taskId: number } | null
  save(request: ModelOutputRequest, output: string, taskId: number): void
}
interface CheckpointContent {
  schemaVersion: 'creative-model-checkpoint-v1'
  identityHash: string
  requestHash: string
  phase: ModelOutputRequest['phase']
  output: string
  outputHash: string
  taskId: number
}

/** A completed physical model response is immutable; interrupted requests are never checkpoints. */
export function createCreativeModelCheckpoint(input: {
  novelId: number
  runId: number
  attempt: number
  contextVersion: number
  identityHash: string
  assertCurrent: () => void
  onSaved: (reference: { schemaVersion: 'creative-model-checkpoint-v1'; artifactId: string; attempt: number; identityHash: string }) => void
}): ModelOutputCheckpoint {
  const describe = (request: ModelOutputRequest) => {
    const requestHash = hashArtifactContent(request)
    return { requestHash, key: `creative:${input.runId}:${input.attempt}:checkpoint:${requestHash}` }
  }
  return {
    read(request) {
      input.assertCurrent()
      const { requestHash, key } = describe(request)
      const artifact = findArtifactByIdempotency<CheckpointContent>(input.novelId, 'creative_model_checkpoint', key)
      if (!artifact) return null
      const content = artifact.content
      if (artifact.contextVersion !== input.contextVersion || artifact.modelConfigId !== (request.modelConfigId || null)
        || artifact.contentHash !== hashArtifactContent(content) || content.schemaVersion !== 'creative-model-checkpoint-v1'
        || content.identityHash !== input.identityHash || content.requestHash !== requestHash || content.phase !== request.phase
        || !content.output?.trim() || content.outputHash !== hashArtifactContent(content.output)
        || !Number.isInteger(content.taskId) || content.taskId < 1) throw new Error('创作恢复检查点与当前需求、模型或资料不一致，请新建任务。')
      input.onSaved({ schemaVersion: content.schemaVersion, artifactId: artifact.id, attempt: input.attempt, identityHash: input.identityHash })
      return { output: content.output, taskId: content.taskId }
    },
    save(request, output, taskId) {
      input.assertCurrent()
      if (!output.trim() || !Number.isInteger(taskId) || taskId < 1) throw new Error('不能保存未完成的模型响应检查点。')
      const { requestHash, key } = describe(request)
      const content: CheckpointContent = { schemaVersion: 'creative-model-checkpoint-v1', identityHash: input.identityHash,
        requestHash, phase: request.phase, output, outputHash: hashArtifactContent(output), taskId }
      const artifact = createArtifact({ novelId: input.novelId, kind: 'creative_model_checkpoint', status: 'draft', content,
        contextVersion: input.contextVersion, producerType: 'novelforge_model', producerId: `task:${taskId}`,
        producerClient: 'novelforge', modelConfigId: request.modelConfigId, taskId, idempotencyKey: key })
      input.onSaved({ schemaVersion: content.schemaVersion, artifactId: artifact.id, attempt: input.attempt, identityHash: input.identityHash })
    },
  }
}
