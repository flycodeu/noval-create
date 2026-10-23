import { AGENT_TOOL_SCOPES, type AgentToolDescriptor, type AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import type { ReferenceExtractionInput } from '../../src/shared/reference-extraction'
import { AgentToolRegistry } from './tool-registry'
import { previewReferenceExtraction, startReferenceExtraction, adoptReferenceCandidates } from '../services/reference-extraction.service'
import { getAuthorAssistRun, listAuthorAssistRuns, cancelAuthorAssistRun } from '../services/author-assist-task.service'
import { getChapterReviewView } from '../services/chapter-review-view.service'
import { previewSelectionRevision, startSelectionRevision, editSelectionRevision, applySelectionRevision } from '../services/selection-revision.service'
import type { SelectionRange, SelectionRevisionInput } from '../../src/shared/selection-revision'

const id: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
const text: AgentToolJsonSchema = { type: 'string', minLength: 1, maxLength: 200 }

export function registerAuthorAssistTools(registry: AgentToolRegistry) {
  const add = (name: string, title: string, effect: AgentToolDescriptor['effect'], properties: Record<string, AgentToolJsonSchema>, required: string[], handler: (input: Record<string, unknown>) => unknown) => {
    registry.register({ descriptor: { id: `novelforge.${name}`, version: '1.0.0', domain: name.split('.')[0], title, description: title,
      inputSchema: { type: 'object', properties, required, additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: true },
      effect, approval: 'policy', scopes: effect === 'read' ? [AGENT_TOOL_SCOPES.novelRead] : [AGENT_TOOL_SCOPES.novelRead, effect === 'draft_write' ? AGENT_TOOL_SCOPES.draftCreate : AGENT_TOOL_SCOPES.canonWrite],
      idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: ['creative-workspace'] }, handler: async input => handler(input) })
  }
  const extractFields = { novelId: id, text: { type: 'string', minLength: 1, maxLength: 20000 }, sourceTitle: { type: 'string', minLength: 1, maxLength: 160 },
    sourceLabel: { type: 'string', maxLength: 160 }, request: { type: 'string', minLength: 1, maxLength: 2000 }, idempotencyKey: text } satisfies Record<string, AgentToolJsonSchema>
  const required = ['novelId', 'text', 'sourceTitle', 'request', 'idempotencyKey']
  add('research.extract_preview', '检查所选文本的提炼预算', 'read', extractFields, required, input => ({ budget: previewReferenceExtraction(input as unknown as ReferenceExtractionInput) }))
  add('research.extract', '提炼所选文本为参考卡候选，返回任务编号', 'draft_write', extractFields, required, async input => ({ run: await startReferenceExtraction(input as unknown as ReferenceExtractionInput) }))
  add('research.adopt', '保存明确选中的参考卡，核对证据与作品版本', 'canonical_write', {
    novelId: id, artifactId: text, expectedContextVersion: id, idempotencyKey: text,
    entries: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: { candidateId: text, draft: { type: 'object', additionalProperties: true } }, required: ['candidateId', 'draft'], additionalProperties: false } },
  }, ['novelId', 'artifactId', 'expectedContextVersion', 'idempotencyKey', 'entries'], input => adoptReferenceCandidates(input as unknown as Parameters<typeof adoptReferenceCandidates>[0]))
  add('assist.get', '查询当前作品的提炼或选区修订任务', 'read', { novelId: id, taskId: id }, ['novelId', 'taskId'], input => ({ run: getAuthorAssistRun(Number(input.novelId), Number(input.taskId)) }))
  add('assist.list', '列出最近的提炼或选区修订任务', 'read', { novelId: id, kind: { enum: ['reference_extraction', 'selection_revision'] }, chapterId: id }, ['novelId', 'kind'], input => ({ runs: listAuthorAssistRuns(Number(input.novelId), input.kind as 'reference_extraction' | 'selection_revision', input.chapterId as number | undefined) }))
  add('assist.cancel', '停止辅助任务，保留原文和已有结果', 'draft_write', { novelId: id, taskId: id }, ['novelId', 'taskId'], input => ({ run: cancelAuthorAssistRun(Number(input.novelId), Number(input.taskId)) }))
  add('chapters.review_view', '读取本章审校对照和有效原文位置，不调用模型', 'read', { novelId: id, chapterId: id, reportId: text }, ['novelId', 'chapterId'], input => ({ view: getChapterReviewView(Number(input.novelId), Number(input.chapterId), input.reportId as string | undefined) }))
  const selection = { novelId: id, chapterId: id, start: { type: 'integer', minimum: 0 }, end: id, original: { type: 'string', minLength: 1, maxLength: 6000 } } satisfies Record<string, AgentToolJsonSchema>
  add('chapters.selection_preview', '核对选区并读取正文版本', 'read', selection, Object.keys(selection), input => ({ snapshot: previewSelectionRevision(input as unknown as SelectionRange) }))
  add('chapters.rewrite_selection', '生成选区修订候选，保留正文', 'draft_write', { ...selection, sourceContentHash: text, contextVersion: id, request: { type: 'string', minLength: 1, maxLength: 2000 }, idempotencyKey: text }, [...Object.keys(selection), 'sourceContentHash', 'contextVersion', 'request', 'idempotencyKey'], async input => ({ run: await startSelectionRevision(input as unknown as SelectionRevisionInput) }))
  add('chapters.edit_selection', '另存作者编辑的选区候选版本', 'draft_write', { novelId: id, artifactId: text, replacement: { type: 'string', minLength: 1, maxLength: 12000 }, idempotencyKey: text }, ['novelId', 'artifactId', 'replacement', 'idempotencyKey'], input => editSelectionRevision(Number(input.novelId), String(input.artifactId), String(input.replacement), String(input.idempotencyKey)))
  add('chapters.apply_selection', '采用选区候选，校验版本并保存正文历史', 'canonical_write', { novelId: id, chapterId: id, artifactId: text, expectedContentHash: text, expectedContextVersion: id, idempotencyKey: text }, ['novelId', 'chapterId', 'artifactId', 'expectedContentHash', 'expectedContextVersion', 'idempotencyKey'], input => applySelectionRevision(input as unknown as Parameters<typeof applySelectionRevision>[0]))
  return registry
}
