import { AUTHOR_PROCESS_FIELDS, authorFieldKey, authorText, authorValueLabel } from './author-content'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_ATTRIBUTE_LABELS, atlasAttributeValue, locationPath } from './atlas-presentation'

export const ATLAS_KIND_LABELS = { location: '地点', character: '人物', faction: '组织势力', item: '物品', event: '事件' }
export const ATLAS_TABS = [
  { key: 'map', label: '地图', kind: 'location' }, { key: 'characters', label: '人物', kind: 'character' },
  { key: 'relationships', label: '人物关系', kind: 'character' }, { key: 'factions', label: '组织势力', kind: 'faction' },
  { key: 'items', label: '物品', kind: 'item' }, { key: 'events', label: '事件', kind: 'event' },
] as const
export type AtlasTab = typeof ATLAS_TABS[number]['key']
export const WORLD_WORKSPACE_TABS = [...ATLAS_TABS, { key: 'rules', label: '世界规则' }, { key: 'research', label: '联网参考' }] as const
export type WorldWorkspaceTab = typeof WORLD_WORKSPACE_TABS[number]['key']
export function resolveWorldWorkspaceTab(params: URLSearchParams): WorldWorkspaceTab {
  const tab = params.get('tab')
  return tab === 'rules' || tab === 'research' ? tab : resolveAtlasTab(params)
}
export function resolveAtlasTab(params: URLSearchParams): AtlasTab {
  const tab = params.get('tab')
  if (ATLAS_TABS.some(item => item.key === tab)) return tab as AtlasTab
  const byKind = ATLAS_TABS.find(item => item.kind === params.get('kind'))
  return byKind?.key || (params.get('view') === 'characters' ? 'relationships' : 'map')
}
export function atlasTabFor(entity: StoryAtlasEntity): AtlasTab { return ATLAS_TABS.find(item => item.kind === entity.kind)!.key }
export function atlasEntitySummary(entity: StoryAtlasEntity): string {
  const publicSummary = entity.kind === 'character' ? entity.attributes.publicSummary : undefined
  return typeof publicSummary === 'string' && publicSummary.trim() ? authorText(publicSummary) : authorText(entity.summary)
}
export function atlasEntityMatchesSearch(entity: StoryAtlasEntity, keyword: string): boolean {
  return `${entity.name} ${atlasEntitySummary(entity)} ${entity.summary}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())
}
export function atlasLocationScope(snapshot: StoryAtlasSnapshot, locationId: string | null | undefined): string | null {
  return snapshot.entities.find(entity => entity.kind === 'location' && entity.id === locationId)?.id ?? null
}
export function hasAtlasValue(value: unknown): boolean {
  if (value == null || value === '') return false
  if (typeof value === 'string' && (value.trim().startsWith('[') || value.trim().startsWith('{'))) { try { return hasAtlasValue(JSON.parse(value)) } catch { /* Keep ordinary prose. */ } }
  if (Array.isArray(value)) return value.some(hasAtlasValue)
  if (typeof value === 'object') return Object.values(value).some(hasAtlasValue)
  return true
}
const FIELD_LABELS: Record<string, string> = {
  politicalStatus: '政体与地位', label: '类别', shortName: '通称', sovereignty: '自治与主权范围', geographicNote: '地理与政治范围',
  governance: '治理方式', inhabitants: '居民与异类处境', foreignRelations: '对外关系', politicalLimits: '权力边界', economyAndFear: '生计与共同恐惧',
  politicalArc: '制度变化', externalIndexNote: '政体入口说明', aspiration: '共同诉求', fear: '共同恐惧', humanBeastConflict: '人与异类的利益冲突',
  defence: '防卫与代价', domesticContradiction: '国内矛盾', narrativeBoundary: '叙事范围', volume: '对应卷', chapter: '对应章', chapterId: '关联章节', evidence: '细纲依据', usage: '可用背景',
  developmentScope: '关系规划范围', developmentBasis: '规划依据', plannedChapterStart: '关系规划起章', plannedChapterEnd: '关系规划末章',
  perspectiveName: '人物视角', initialState: '相处起点', cause: '变化原因', unresolved: '仍未解决',
  internalConflicts: '内部冲突', planningBoundary: '规划范围', coordinateBasis: '地图位置依据', politicalBoundary: '政治边界', regionalPlanningBoundary: '区域规划范围',
  worldExpansion20261025: '卷章中的地点用途', worldPlanningAlias: '地点别称', worldStructure: '组织分工', worldAftercare: '后续责任', worldResourceLimit: '资源与权力限制',
  travelDurationLabel: '行程安排', travelAssumptions: '行程条件', travelLimitations: '通行限制', travelDaysRange: '普通行程天数', routeType: '通路性质', viaLocations: '途经地点', distanceBasis: '里程依据',
  strengths: '长处', weaknesses: '短处', motivation: '行动动机', relationshipTension: '关系冲突', bilateral: '双向关系',
  clothing: '常用衣着', carriedItems: '随身物品', physicalHabits: '动作与体态', portraitPrompt: '视觉描述', portraitImage: '角色参考像',
  authorPlanning: '作者后续规划', truthBoundary: '已发生与规划边界', speciesOrigin: '种属与来历', bodyAndDailyLife: '身体与日常规则',
  independentPreference: '个人喜好', entryPlan: '入场安排', independentRelationships: '独立关系', nonProtagonistScene: '人物自己的场景',
  humanAppearance: '人形视觉规划', speechAndPhase: '语言与形态阶段', personalGoals: '个人目标', futureFlaws: '后续弱点与代价', revision: '方案版本',
  name: '名称', summary: '说明', status: '状态', role: '职责', fromId: '起点', toId: '关联对象', kind: '关联类型', effectiveFromChapter: '生效章位',
  note: '说明', notes: '补充说明', traits: '特点', description: '说明', parentId: '上级', ...ATLAS_ATTRIBUTE_LABELS,
}
const VALUE_LABELS: Record<string, string> = { chapter_start: '章初已生效', chapter_end: '章内或章末生效', instance: '具体物品', template: '物品类别', available: '可用', consumed: '已消耗', destroyed: '已损毁', lost: '下落不明', written: '已写定', human: '人', monster: '妖异', spirit: '精怪', ghost: '鬼魂', faction: '组织', planned: '计划中', established: '已设岗位', confirmed: '已确认', organization: '组织', department: '部门', branch: '分部', male: '男', female: '女', unknown: '尚未明确', protagonist: '主角', supporting: '配角', ally: '盟友', enemy: '对立', neutral: '中立', friend: '朋友', family: '亲属', mentor: '师徒', rival: '竞争', active: '推进中', current: '当前位置', residence: '居住地', activity: '活动区域', birthplace: '出生地', headquarters: '主要驻地', outpost: '分驻点', jurisdiction: '涉及区域', relationship: '人物关系', presence: '地域关联', membership: '组织成员', route: '通路', ownership: '持有', participation: '事件参与' }
export function atlasFieldLabel(key: string) {
  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()).replace(/Json$/, '')
  return FIELD_LABELS[key] || FIELD_LABELS[camel] || (/[\u4e00-\u9fff]/.test(key) ? key : '补充设定')
}
const REFERENCE_KINDS: Record<string, StoryAtlasEntity['kind']> = { campFactionIds: 'faction', campFactionIdsJson: 'faction', factionId: 'faction', factionIds: 'faction', characterId: 'character', characterIds: 'character', memberCharacterIds: 'character', leaderId: 'character', leaderCharacterId: 'character', parentIds: 'character', presentCharacterIds: 'character', linkedCharacterIds: 'character', affectedCharacterIds: 'character', ownerCharacterId: 'character', linkedTimelineEventIds: 'event', linkedItemIds: 'item', locationId: 'location', locationIds: 'location', homeLocationId: 'location', currentLocationId: 'location', activityLocationIds: 'location', birthplaceLocationId: 'location', headquartersId: 'location', territoryIds: 'location', territoryMapNodeIds: 'location', locationMapId: 'location', mapNodeId: 'location' }
export const ATLAS_INTERNAL_FIELDS = new Set([...AUTHOR_PROCESS_FIELDS, 'id', 'schemaVersion', 'novelId', 'createdAt', 'updatedAt', 'sortOrder', 'recordStatus', 'sourceType', 'sourceId', 'bindingType', 'isCanonical', 'sourceContext', 'typedRefs', 'volumeId', 'partId', 'timeMode', 'timeSortValue', 'anchorInvalid', 'authorOnly', 'futureOnly'])
export function resolveAtlasReference(key: string, value: unknown, entities: StoryAtlasEntity[]) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const kind = REFERENCE_KINDS[key]
  const id = String(value)
  return entities.find(item => item.id === id || kind && item.id === `${kind}:${id}`)
}
export function atlasScalarText(key: string, value: unknown, entities: StoryAtlasEntity[], chapters: Array<{ id: number; chapterNum: number }>, positions: Array<{ id: string; title: string }> = []): string {
  if (key === 'castRole') return String(atlasAttributeValue(key, value))
  if (key === 'timeOfDayMinutes' && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440) return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  if (['lastProgressChapterId', 'chapterStartId', 'chapterEndId', 'chapterId'].includes(key)) return chapters.find(item => item.id === Number(value)) ? `第 ${chapters.find(item => item.id === Number(value))!.chapterNum} 章` : '关联章节不可用'
  if (key === 'positionId' || key === 'reportsToPositionId') return positions.find(item => item.id === String(value))?.title || '关联岗位尚未明确'
  const reference = resolveAtlasReference(key, value, entities)
  if (reference) return reference.name
  if (REFERENCE_KINDS[key] || typeof value === 'string' && /^(location|character|faction|item|event):/.test(value)) return '关联资料在当前章位不可用'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (key === 'kind' && ['sovereign_state', 'autonomous_federation', 'confederation'].includes(String(value))) return ({ sovereign_state: '主权国家', autonomous_federation: '自治联国', confederation: '独立联盟' } as Record<string, string>)[String(value)]
  if (key === 'status' && value === 'approved_design') return '已采纳规划'
  if (['protagonistPresent', 'isMajorEvent'].includes(key)) return Number(value) === 1 ? '是' : '否'
  return VALUE_LABELS[String(value)] || authorText(String(authorValueLabel(atlasAttributeValue(key, value))))
}

export type AtlasProfileSection = 'overview' | 'appearance' | 'abilities' | 'relationships' | 'planning'
export const CHARACTER_PROFILE_SECTIONS: Array<{ key: AtlasProfileSection; label: string }> = [
  { key: 'overview', label: '概览' }, { key: 'appearance', label: '形象日常' },
  { key: 'abilities', label: '能力限制' }, { key: 'relationships', label: '关系' }, { key: 'planning', label: '作者规划' },
]
export type AtlasProfileGroup = { title: string; fields: string[]; empty: string; section?: AtlasProfileSection }
export const PROFILE_GROUPS: Record<StoryAtlasEntity['kind'], AtlasProfileGroup[]> = {
  character: [
    { title: '身份', section: 'overview', fields: ['roleType', 'entityType', 'age', 'gender', 'species', 'occupation', 'socialIdentity'], empty: '身份尚未补充' },
    { title: '性格与动机', section: 'overview', fields: ['personalityTraits', 'flaws', 'strengths', 'weaknesses', 'goals', 'publicGoal', 'motivation', 'surfaceDesire', 'deepNeed', 'coreFear', 'innerConflict', 'moralLine', 'beliefs', 'values', 'selfDeception', 'contradiction', 'resonancePoint'], empty: '性格表现、目标与行事底线尚未补充' },
    { title: '外貌与衣着', section: 'appearance', fields: ['appearance', 'clothing', 'carriedItems', 'physicalHabits', 'firstImpression'], empty: '外貌、衣着与随身物品尚未补充' },
    { title: '日常与说话方式', section: 'appearance', fields: ['habits', 'speechPattern', 'dailyRoutine', 'catchphrases', 'vocabularyLevel', 'dialectFeatures'], empty: '日常习惯与说话方式尚未补充' },
    { title: '能力、代价与经历', section: 'abilities', fields: ['abilities', 'abilityLimits', 'abilityCosts', 'abilityCost', 'limitations', 'background'], empty: '能力边界、代价与经历尚未补充' },
    { title: '成长、秘密与后续安排', section: 'planning', fields: ['authorPlanning', 'characterArc', 'arcStage', 'dramaticEngine', 'hiddenSecret'], empty: '尚未补充作者规划' },
  ],
  faction: [
    { title: '组织特点与立场', fields: ['organizationLevel', 'category', 'traits', 'ideology', 'goal', 'goals', 'methods'], empty: '组织特点、目标与行事方式尚未补充' },
    { title: '运行与资源', fields: ['resources', 'funding', 'memberPolicy', 'structure', 'hierarchy', 'currentPhase'], empty: '组织运行、资源与成员规则尚未补充' },
    { title: '内部冲突与后续安排', fields: ['internalConflicts', 'worldStructure', 'worldAftercare', 'worldResourceLimit', 'authorPlanning'], empty: '尚未登记组织内部冲突和卷章发展。' },
  ],
  location: [
    { title: '地理与环境', fields: ['politicalStatus', 'geography', 'nodeType', 'locationType', 'terrain', 'waterSystem', 'waterSource', 'climate', 'atmosphere', 'dangerLevel'], empty: '地形、水源与环境尚未补充' },
    { title: '生计与通行', fields: ['inhabitants', 'livelihood', 'livelihoods', 'economy', 'economyAndFear', 'resources', 'access', 'routes', 'transport', 'plotRelevance', 'structureRole'], empty: '生计、产业与通路尚未补充' },
    { title: '卷章用途与范围', fields: ['worldExpansion20261025', 'politicalArc', 'authorPlanning', 'planningBoundary', 'politicalBoundary', 'narrativeBoundary', 'worldPlanningAlias', 'externalIndexNote'], empty: '尚未登记此地点的卷章用途。' },
  ],
  item: [{ title: '用途与限制', fields: ['itemKind', 'category', 'subType', 'status', 'plotFunction', 'abilitySpec', 'abilities', 'usageMethod', 'acquisitionMethod', 'limitations', 'cost', 'risk', 'background', 'linkedCharacterIds', 'linkedTimelineEventIds'], empty: '物品用途、代价与使用边界尚未补充' }],
  event: [{ title: '事件经过', fields: ['eventType', 'timeLabel', 'status', 'chapterNum', 'chapterStartId', 'chapterEndId', 'eventCause', 'eventProcess', 'eventResult', 'significance', 'protagonistPresent', 'protagonistAction', 'presentCharacterIds', 'affectedCharacterIds', 'directConsequences', 'openThreads'], empty: '前因、经过与结果尚未补充' }],
}
export function profileFieldGroups(entity: StoryAtlasEntity) {
  const used = new Set<string>(['positions', 'x', 'y', 'publicSummary', 'portraitImage', 'portraitPrompt', ...ATLAS_INTERNAL_FIELDS])
  const polityFields = ['governance', 'aspiration', 'fear', 'domesticContradiction', 'humanBeastConflict', 'defence', 'foreignRelations', 'politicalLimits']
  const definitions = entity.kind === 'location' && polityFields.some(key => hasAtlasValue(entity.attributes[key]))
    ? [...PROFILE_GROUPS.location.slice(0, 2), { title: '制度、利益与边界', fields: polityFields, empty: '' }, ...PROFILE_GROUPS.location.slice(2)]
    : PROFILE_GROUPS[entity.kind]
  const groups = definitions.map(group => {
    group.fields.forEach(key => used.add(key))
    return { ...group, values: Object.fromEntries(group.fields.filter(key => hasAtlasValue(entity.attributes[key])).map(key => [key, entity.attributes[key]])) }
  })
  const other = Object.fromEntries(Object.entries(entity.attributes).filter(([key, value]) => !used.has(authorFieldKey(key)) && hasAtlasValue(value)))
  if (Object.keys(other).length) groups.push({ title: '补充设定', fields: [], empty: '', values: other, ...(entity.kind === 'character' ? { section: 'planning' as const } : {}) })
  return groups
}

export type AtlasLink = { entity: StoryAtlasEntity; relation?: StoryAtlasRelation; label: string; planned: boolean }
export function atlasLinks(snapshot: StoryAtlasSnapshot, entity: StoryAtlasEntity, kind?: StoryAtlasEntity['kind']): AtlasLink[] {
  const result: AtlasLink[] = []
  for (const relation of snapshot.relations) {
    const otherId = relation.fromId === entity.id ? relation.toId : relation.toId === entity.id ? relation.fromId : null
    const other = otherId ? snapshot.entities.find(item => item.id === otherId) : undefined
    if (!other || kind && other.kind !== kind) continue
    const subject = entity.kind === 'location' ? other : entity
    const locationLabel = relation.kind === 'presence' && relation.attributes.locationRole === 'current' && ['event', 'item'].includes(subject.kind) ? subject.kind === 'event' ? '发生地点' : '所在地点' : undefined
    result.push({ entity: other, relation, label: locationLabel || VALUE_LABELS[String(relation.attributes.locationRole)] || VALUE_LABELS[relation.label] || relation.label || VALUE_LABELS[relation.kind], planned: relation.status === 'planned' || other.status === 'planned' })
  }
  return result
}
export function atlasRegionLinks(snapshot: StoryAtlasSnapshot, region: StoryAtlasEntity): AtlasLink[] {
  if (region.kind !== 'location') return []
  const result: AtlasLink[] = []
  const seen = new Set<string>()
  const locations = snapshot.entities.filter(entity => entity.kind === 'location' && locationPath(snapshot.entities, entity.id).some(parent => parent.id === region.id))
  for (const location of locations) {
    for (const link of atlasLinks(snapshot, location)) {
      if (!['character', 'faction', 'event'].includes(link.entity.kind)) continue
      const identity = JSON.stringify([link.entity.id, location.id, link.relation?.kind, link.relation?.attributes.locationRole || link.label, link.planned])
      if (seen.has(identity)) continue
      seen.add(identity)
      result.push({ ...link, label: location.id === region.id ? link.label : `${link.label} · ${location.name}` })
    }
  }
  return result
}

/** An explicit edit replaces changed fields; untouched migration references never become new input. */
export function atlasEditedAttributes(previous: Record<string, unknown>, next: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => !ATLAS_INTERNAL_FIELDS.has(authorFieldKey(key)) && !/(?:Id|Ids|Refs)(?:Json)?$/.test(key)
    && JSON.stringify(previous[key]) !== JSON.stringify(value)))
}
