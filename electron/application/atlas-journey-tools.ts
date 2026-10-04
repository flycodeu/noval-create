import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { calculateAtlasJourney, type AtlasTravelSeason } from '../../src/shared/story-atlas-travel'
import { queryStoryAtlas } from '../services/story-atlas.service'
import { AgentToolInvocationError, type AgentToolRegistry } from './tool-registry'

export function registerAtlasJourneyTools(registry: AgentToolRegistry): void {
  registry.register({ descriptor: {
    id: 'novelforge.atlas.journey', version: '2.0.0', domain: 'atlas', title: '查询地图行程',
    description: '只读计算指定章位已确认通路的最短耗时方案。起终点使用atlas.query返回的地点ID；只取已明确开放、交通方式和正数耗时的路线。默认不换乘；allowTransfers=true也须地点明确登记换乘耗时。season指定时须路线有该季通行记录。缺失资料返回unknown及原因，不猜里程、不修改地图。',
    inputSchema: { type: 'object', properties: {
      novelId: { type: 'integer', minimum: 1 }, atChapter: { type: 'integer', minimum: 0 },
      fromId: { type: 'string', minLength: 1 }, toId: { type: 'string', minLength: 1 },
      travelMode: { type: 'string', minLength: 1 }, allowTransfers: { type: 'boolean' },
      season: { enum: ['spring', 'summer', 'autumn', 'winter'] },
    }, required: ['novelId', 'fromId', 'toId'], additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true }, effect: 'read', approval: 'policy',
    scopes: [AGENT_TOOL_SCOPES.novelRead], idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: ['creative-workspace', 'geography'],
  }, handler: input => {
    try {
      const snapshot = queryStoryAtlas({ novelId: Number(input.novelId), atChapter: input.atChapter as number | undefined })
      return { novelId: snapshot.novelId, contextVersion: snapshot.contextVersion, atChapter: snapshot.atChapter,
        journey: calculateAtlasJourney(snapshot.entities, snapshot.relations, String(input.fromId), String(input.toId), {
          travelMode: input.travelMode as string | undefined, allowTransfers: input.allowTransfers as boolean | undefined, season: input.season as AtlasTravelSeason | undefined,
        }) }
    } catch (error) {
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new AgentToolInvocationError(error.code, error.message)
      throw error
    }
  } })
}
