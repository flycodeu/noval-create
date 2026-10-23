import { AGENT_TOOL_SCOPES, type AgentToolDescriptor, type AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AgentToolRegistry, AgentToolInvocationError } from './tool-registry'
import { AuthorLibraryError } from '../services/author-library-error'
import { CreativeChapterContextError } from '../services/creative-chapter-context'
import { completeInline, cancelInlineCompletion } from '../services/inline-completion.service'
import { startInspiration, getInspirationRun, cancelInspirationRun } from '../services/inspiration.service'
import { getSqlite } from '../database/db'
import { getNovel } from '../services/novel.service'

export function registerWritingDiscoveryTools(registry: AgentToolRegistry) {
  const id: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
  const token: AgentToolJsonSchema = { type: 'string', minLength: 8, maxLength: 100 }
  const add = (name: string, title: string, effect: AgentToolDescriptor['effect'], properties: Record<string, AgentToolJsonSchema>, required: string[], handler: (input: Record<string, unknown>) => unknown) => {
    registry.register({ descriptor: { id: `novelforge.${name}`, version: '1.0.0', domain: name.split('.')[0], title, description: title,
      inputSchema: { type: 'object', properties, required, additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: true },
      effect, approval: 'policy', scopes: effect === 'read' ? [AGENT_TOOL_SCOPES.novelRead] : [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.draftCreate],
      idempotent: name !== 'writing.complete', taskMode: 'sync', timeoutClass: name === 'writing.complete' ? 'model' : 'short', tags: ['creative-workspace'] }, handler: async input => {
        try { return await handler(input) } catch (error) { if (error instanceof AuthorLibraryError || error instanceof CreativeChapterContextError) throw new AgentToolInvocationError(error.code, error.message); throw error }
      } })
  }
  const editor = { novelId: id, chapterId: id, editorId: token, requestId: token }
  add('writing.complete', '请求当前光标的短补全，不保存正文或后台任务', 'draft_write', { ...editor, editVersion: { type: 'integer', minimum: 0 }, cursor: { type: 'integer', minimum: 0 }, before: { type: 'string', maxLength: 1500 }, after: { type: 'string', maxLength: 300 }, mode: { enum: ['sentence', 'paragraph'] }, modelConfigId: id }, [...Object.keys(editor), 'editVersion', 'cursor', 'before', 'after', 'mode'], input => completeInline(input as unknown as Parameters<typeof completeInline>[0]))
  add('writing.cancel_completion', '停止指定光标补全请求及上游模型输出', 'draft_write', editor, Object.keys(editor), input => cancelInlineCompletion(input as unknown as Parameters<typeof cancelInlineCompletion>[0]))
  const idea = { draftId: token, requestId: token, kind: { enum: ['directions', 'packaging'] }, seed: { type: 'string', minLength: 1, maxLength: 6000 }, constraints: { type: 'string', maxLength: 3000 }, direction: { type: 'string', maxLength: 2400 }, request: { type: 'string', maxLength: 1500 }, modelConfigId: id } satisfies Record<string, AgentToolJsonSchema>
  add('inspiration.generate', '生成开书候选任务，不创建作品', 'draft_write', idea, ['draftId', 'requestId', 'kind', 'seed', 'constraints', 'direction', 'request'], async input => ({ run: await startInspiration(input as unknown as Parameters<typeof startInspiration>[0]) }))
  add('inspiration.get', '查询指定构思的候选任务', 'read', { draftId: token, taskId: id }, ['draftId', 'taskId'], input => ({ run: getInspirationRun(String(input.draftId), Number(input.taskId)) }))
  add('inspiration.cancel', '停止构思候选，保留作者填写内容', 'draft_write', { draftId: token, taskId: id }, ['draftId', 'taskId'], input => ({ run: cancelInspirationRun(String(input.draftId), Number(input.taskId)) }))
  add('projects.creation_status', '按固定创建编号查询已创建作品，用于重试恢复', 'read', { idempotencyKey: token }, ['idempotencyKey'], input => {
    const row = getSqlite().prepare("SELECT id FROM novels WHERE json_valid(settings_json) AND json_extract(settings_json,'$.mcpCreation.idempotencyKey')=?").get(input.idempotencyKey) as { id: number } | undefined
    return { project: row ? getNovel(row.id) : null }
  })
  return registry
}
