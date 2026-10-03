import type { CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { queryStoryAtlas } from './story-atlas.service'
import { CreativeReviewTargetError } from './creative-review-issues'

const kinds: Record<string, string> = { characters: 'character', map: 'location', factions: 'faction', items: 'item', events: 'event' }
export const ATLAS_REVIEW_STAGES = [...Object.keys(kinds), 'relationships']

/** Formal asset review always names existing records, never an unresolved candidate. */
export function captureFormalAtlasReview(input: CreativeWorkflowInput) {
  if (!ATLAS_REVIEW_STAGES.includes(input.stage)) throw new CreativeReviewTargetError('资料复核目前支持人物、地图、关系、阵营、物品和事件。')
  const scope = input.changeScope
  if (!scope || scope.newEntityCount !== 0 || scope.allowNewRelations !== false || !scope.existingEntityIds || !scope.existingRelationIds
    || !(scope.existingEntityIds.length + scope.existingRelationIds.length)) throw new CreativeReviewTargetError('正式资料复核必须指定已有资料和关系 ID，新增数量为0，禁止新增关系。')
  const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: input.atChapter, includePlanned: true })
  const entities = scope.existingEntityIds.map(id => {
    const entity = atlas.entities.find(row => row.id === id)
    if (!entity || entity.kind !== kinds[input.stage]) throw new CreativeReviewTargetError(`资料 ${id} 不属于本阶段或在当前章位不存在。`)
    return entity
  })
  const allowedRelations: Record<string, string[]> = { characters: ['relationship', 'presence', 'membership'], map: ['route', 'presence'], factions: ['membership', 'presence'], items: ['ownership', 'presence'], events: ['participation', 'presence'], relationships: ['relationship', 'presence', 'membership', 'ownership', 'participation'] }
  const relations = scope.existingRelationIds.map(id => {
    const relation = atlas.relations.find(row => row.id === id)
    if (!relation || !allowedRelations[input.stage].includes(relation.kind)) throw new CreativeReviewTargetError(`关系 ${id} 不属于本阶段或在当前章位不存在。`)
    return relation
  })
  return { stage: input.stage, atChapter: input.atChapter, entities, relations }
}
