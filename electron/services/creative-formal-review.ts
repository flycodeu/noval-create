import type { CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { queryStoryAtlas } from './story-atlas.service'
import { CreativeReviewTargetError } from './creative-review-issues'
import { getNovel } from './novel.service'
import { listChapters } from './chapter.service'
import { getChapterContract, listSceneContracts } from './endgame-asset.service'
import { getSqlite } from '../database/db'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { parseProjectBriefDocument } from '../../src/shared/project-brief'
import { queryCreativeFacts } from './creative-facts'

const kinds: Record<string, string> = { characters: 'character', map: 'location', factions: 'faction', items: 'item', events: 'event' }
export const ATLAS_REVIEW_STAGES = [...Object.keys(kinds), 'relationships']
export const PLANNING_REVIEW_STAGES = ['background', 'world_rules', 'story', 'style', 'outline']

/** Capture only authoring data; model credentials and unrelated application settings never enter review. */
export function captureFormalPlanningReview(input: CreativeWorkflowInput) {
  const novel = getNovel(input.novelId)
  if (!novel || !PLANNING_REVIEW_STAGES.includes(input.stage)) throw new CreativeReviewTargetError('正式资料复核目标不存在。')
  const base = { stage: input.stage, atChapter: input.atChapter }
  if (input.stage === 'background') return { ...base, assets: { userBackground: novel.userBackground, expandedBackground: novel.expandedBackground, synopsis: novel.synopsis } }
  if (input.stage === 'world_rules') return { ...base, assets: { worldRules: JSON.parse(novel.worldRulesJson || '{}') } }
  if (input.stage === 'style') return { ...base, assets: { voice: parseThemeVoiceDocument(novel.themeVoiceJson) } }
  if (input.stage === 'story') {
    const { premise, writingRules, storyDesign, endgameDesign } = parseStorySettingsDocument(novel.settingsJson)
    return { ...base, assets: { premise, writingRules, storyDesign, endgameDesign, projectBrief: parseProjectBriefDocument(novel.projectBriefJson), facts: queryCreativeFacts(input.novelId) } }
  }
  const ids = input.changeScope?.chapterIds
  if (!ids?.length) throw new CreativeReviewTargetError('大纲复核必须用 changeScope.chapterIds 指定已有章节。')
  const current = listChapters(input.novelId)
  const chapters = ids.map(id => {
    const chapter = current.find(row => row.id === id)
    if (!chapter) throw new CreativeReviewTargetError(`章节 ${id} 不属于当前小说。`)
    return { id, chapterNum: chapter.chapterNum, title: chapter.title, outline: chapter.outline, volumeId: chapter.volumeId, partId: chapter.partId,
      targetWords: chapter.targetWords, allowedFactIds: JSON.parse(chapter.allowedFactIdsJson || '[]'), revealedFactIds: JSON.parse(chapter.revealedFactIdsJson || '[]'),
      contract: getChapterContract(id), scenes: listSceneContracts(id) }
  })
  const sqlite = getSqlite()
  const volumes = (sqlite.prepare('SELECT id,title,summary,target_words AS targetWords FROM story_volumes WHERE novel_id=? ORDER BY volume_number,id').all(input.novelId) as Array<{ id: number }>)
    .filter(volume => chapters.some(chapter => chapter.volumeId === volume.id))
    .map(volume => ({ ...volume, parts: (sqlite.prepare('SELECT id,title,summary,target_words AS targetWords FROM story_parts WHERE volume_id=? ORDER BY part_number,id').all(volume.id) as Array<{ id: number }>).filter(part => chapters.some(chapter => chapter.partId === part.id)) }))
  return { ...base, chapters, volumes }
}

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
