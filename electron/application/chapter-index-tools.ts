import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { getChapterIndexStatus, rebuildChapterIndex } from '../services/chapter-index.service'
import type { AgentToolRegistry } from './tool-registry'

export function registerChapterIndexTools(registry: AgentToolRegistry): void {
  for (const rebuild of [false, true]) {
    registry.register({ descriptor: {
      id: `novelforge.chapters.${rebuild ? 'index_rebuild' : 'index_status'}`, version: '2.0.0', domain: 'chapters',
      title: rebuild ? '补齐已保存正文索引' : '读取正文索引状态',
      description: rebuild ? '仅为正式章节中的非空已保存正文补齐文字索引；默认不联网。vectors=true 将向量工作持久入队并允许模型请求，后台有限重试。throughChapter限定到已写章位，不读候选、摘要或未来规划，不修改正文。用status查看进度和失败原因。' : '只读返回本项目正式正文的文字、向量索引覆盖数量、持久队列状态与失败原因。文字回退检索始终可用。',
      inputSchema: { type: 'object', properties: { novelId: { type: 'integer', minimum: 1 }, ...(rebuild ? {
        throughChapter: { type: 'integer' as const, minimum: 1 }, vectors: { type: 'boolean' as const },
      } : {}) }, required: ['novelId'], additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: true }, effect: rebuild ? 'canonical_write' : 'read', approval: 'policy',
      scopes: rebuild ? [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.canonWrite] : [AGENT_TOOL_SCOPES.novelRead],
      idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: ['creative-workspace', 'chapter-recall'],
    }, handler: input => rebuild ? rebuildChapterIndex(input as unknown as Parameters<typeof rebuildChapterIndex>[0]) : getChapterIndexStatus(Number(input.novelId)) })
  }
}
