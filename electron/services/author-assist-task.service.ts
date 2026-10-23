import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import type { AuthorAssistKind, AuthorAssistRun } from '../../src/shared/author-assist'
import { getSqlite } from '../database/db'
import { createArtifact, hashArtifactContent } from './artifact.service'
import { getNovel } from './novel.service'
import { getDefaultModelConfigRecord, getModelConfigRecord } from './model.service'
import { cancelTask, getTaskRecord, parseTaskProgress, startChatTask, updateTaskProgress, type RunTaskOptions } from './task.service'

const starting = new Map<string, Promise<AuthorAssistRun>>()

export function requireAssistNovel(novelId: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new Error(formatUserFacingMessage('author.project.notFound'))
  return novel
}

export function getAuthorAssistRun(novelId: number, taskId: number): AuthorAssistRun {
  const task = getTaskRecord(taskId)
  if (!task || task.novelId !== novelId || !['reference_extraction', 'selection_revision'].includes(task.relatedEntityType || '')) {
    throw new Error(formatUserFacingMessage('author.assist.notFound'))
  }
  const progress = parseTaskProgress<{ artifactId?: string }>(task)
  return { taskId, kind: task.relatedEntityType as AuthorAssistKind, status: task.status || 'failed', artifactId: progress.artifactId, error: task.errorMessage || undefined, createdAt: task.createdAt }
}

export function listAuthorAssistRuns(novelId: number, kind: AuthorAssistKind, chapterId?: number) {
  requireAssistNovel(novelId)
  const rows = getSqlite().prepare('SELECT id FROM tasks WHERE novel_id=? AND related_entity_type=? AND (? IS NULL OR related_entity_id=?) ORDER BY created_at DESC,id DESC LIMIT 20')
    .all(novelId, kind, chapterId ?? null, chapterId ?? null) as Array<{ id: number }>
  return rows.map(task => getAuthorAssistRun(novelId, task.id))
}

export function cancelAuthorAssistRun(novelId: number, taskId: number) {
  const run = getAuthorAssistRun(novelId, taskId)
  if (['pending', 'running', 'cancel_requested'].includes(run.status)) cancelTask(taskId)
  return getAuthorAssistRun(novelId, taskId)
}

/** Two bounded author operations share the existing task runner, not another workflow engine. */
export function startAuthorAssistTask(input: {
  novelId: number; kind: AuthorAssistKind; idempotencyKey: string; request: unknown; chapterId?: number
  prepare: (modelId: number) => Pick<RunTaskOptions, 'messages' | 'chatOpts'> | Promise<Pick<RunTaskOptions, 'messages' | 'chatOpts'>>
  result: (raw: string) => unknown
}): Promise<AuthorAssistRun> {
  if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200) throw new Error(formatUserFacingMessage('author.assist.invalidIdempotencyKey'))
  const key = `author-assist:${input.novelId}:${input.kind}:${input.idempotencyKey}`
  const fingerprint = hashArtifactContent(input.request)
  const run = async () => {
    const existing = getSqlite().prepare('SELECT id,input_json FROM tasks WHERE idempotency_key=?').get(key) as { id: number; input_json: string } | undefined
    if (existing) {
      if (JSON.parse(existing.input_json).fingerprint !== fingerprint) throw new Error(formatUserFacingMessage('author.assist.idempotencyConflict'))
      return getAuthorAssistRun(input.novelId, existing.id)
    }
    const novel = requireAssistNovel(input.novelId)
    const model = novel.modelConfigId ? getModelConfigRecord(novel.modelConfigId) : getDefaultModelConfigRecord()
    const modelHash = hashArtifactContent(model)
    const prepared = await input.prepare(model.id)
    const taskId = await startChatTask({
      type: 'planning_draft', novelId: novel.id, relatedEntityType: input.kind, relatedEntityId: input.chapterId,
      modelConfigId: model.id, idempotencyKey: key, retryable: false,
      inputJson: JSON.stringify({ kind: input.kind, fingerprint, request: input.request }), ...prepared,
      prepareInput: request => {
        if (hashArtifactContent(getModelConfigRecord(model.id)) !== modelHash) throw new Error(formatUserFacingMessage('author.assist.modelChanged'))
        return { messages: [...request.messages] }
      },
      onSuccess: (raw, id) => {
        const content = input.result(raw)
        const artifact = createArtifact({ novelId: novel.id, kind: input.kind, content,
          contextVersion: novel.contextVersion || 1, producerType: 'novelforge_model', producerId: `task:${id}`,
          producerClient: 'novelforge', taskId: id, modelConfigId: model.id, idempotencyKey: `author-assist:${id}:result` })
        updateTaskProgress(id, { artifactId: artifact.id })
      },
    })
    return getAuthorAssistRun(input.novelId, taskId)
  }
  const pending = starting.get(key)
  if (pending) return pending.then(result => {
    const task = getTaskRecord(result.taskId)!
    if (JSON.parse(task.inputJson || '{}').fingerprint !== fingerprint) throw new Error(formatUserFacingMessage('author.assist.idempotencyConflict'))
    return result
  })
  const promise = run().finally(() => { starting.delete(key) })
  starting.set(key, promise)
  return promise
}
