import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'

export function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('、')
  if (value == null) return ''
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${displayValue(item)}`).join('\n')
  return String(value)
}

export function locationPath(entities: StoryAtlasEntity[], id: string | null) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const path: StoryAtlasEntity[] = []
  const seen = new Set<string>()
  let current = id ? byId.get(id) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

export function relatedEntities(snapshot: StoryAtlasSnapshot, locationId: string | null) {
  if (!locationId) return snapshot.entities.filter((entity) => entity.kind !== 'location')
  const descendantIds = new Set<string>([locationId])
  let changed = true
  while (changed) {
    changed = false
    snapshot.entities.forEach((entity) => {
      if (entity.kind === 'location' && entity.parentId && descendantIds.has(entity.parentId) && !descendantIds.has(entity.id)) {
        descendantIds.add(entity.id); changed = true
      }
    })
  }
  const relatedIds = new Set<string>()
  snapshot.relations.forEach((relation) => {
    if (descendantIds.has(relation.toId)) relatedIds.add(relation.fromId)
    if (descendantIds.has(relation.fromId)) relatedIds.add(relation.toId)
  })
  return snapshot.entities.filter((entity) => entity.kind !== 'location' && relatedIds.has(entity.id))
}

export const ATLAS_ATTRIBUTE_LABELS: Record<string, string> = {
  geography: '地理范围', areaKm2: '面积（平方公里）', development: '资料展开', widthKm: '东西跨度（公里）', heightKm: '南北跨度（公里）', mapFrame: '地图范围', boundary: '区域边界', position: '地图位置',
  roleType: '角色定位', role_type: '角色定位', age: '年龄', gender: '性别', species: '种属',
  occupation: '职业', socialIdentity: '社会身份', social_identity: '社会身份',
  personalityTraits: '性格特点', personalityTraitsJson: '性格特点', personality_traits: '性格特点',
  goals: '当前目标', surfaceDesire: '表面欲望', deepNeed: '内在需要', coreFear: '恐惧', innerConflict: '内在矛盾',
  moralLine: '底线', flaws: '缺点', habits: '习惯', speechPattern: '说话方式', appearance: '外貌',
  relationshipTension: '关系压力', dramaticEngine: '行动动力', characterArc: '人物变化', background: '来历',
  locationType: '地点类型', nodeType: '地点层级', atmosphere: '氛围', plotRelevance: '故事作用', dangerLevel: '危险程度',
  level: '层级', structureRole: '地点作用', tags: '标签', description: '描述',
  travelHours: '行程耗时（小时）', distanceKm: '路线里程（公里）', travelMode: '交通方式', routeOpen: '是否通行',
  terrain: '地形', waterSystem: '水系', waterSource: '水源', climate: '气候', livelihood: '生计', livelihoods: '生计',
  economy: '当地产业', access: '出入通路', routes: '通行路线', transport: '交通', resources: '资源',
  intimacyLevel: '亲近程度', tensionLevel: '紧张程度', interactionStyle: '相处方式', subtextRule: '潜台词',
  relationType: '关系类型', timeLabel: '发生时间', chapterNum: '章节', significance: '事件影响',
  relationLabelSnapshot: '关系称谓', relationTypeSnapshot: '关系类型', startState: '起初状态', crackPoint: '关系裂痕', changeEvent: '变化事件', endState: '当前关系状态', currentStatus: '进展状态', lastProgressChapterId: '最近推进章节', stalledReason: '停滞原因', notes: '补充说明',
  abilities: '能力与限制', goal: '目标', memberPolicy: '成员规则', currentPhase: '当前阶段',
  category: '类型', plotFunction: '故事作用', limitations: '使用限制', abilitySpec: '作用', cost: '代价', risk: '风险',
  eventType: '事件类型', eventCause: '前因', eventProcess: '经过', eventResult: '结果',
  chronologyOrder: '事件先后', relativeDay: '相对开篇天数', sequenceInDay: '同日顺序', timeOfDayMinutes: '发生时刻', timePrecision: '时间精度', evidenceQuote: '正文依据',
  campFactionIds: '所属组织', campFactionIdsJson: '所属组织', factionId: '所属组织', factionIds: '关联组织', characterId: '人物', characterIds: '相关人物', memberCharacterIds: '组织成员', locationId: '地点', locationIds: '涉及地点', homeLocationId: '居住地点', currentLocationId: '当前地点', activityLocationIds: '活动区域', birthplaceLocationId: '出生地点',
  dailyRoutine: '职业日常', motivation: '行动动机', abilityLimits: '能力限制', abilityCosts: '能力代价', abilityCost: '能力代价', beliefs: '信念', values: '价值取向', strengths: '长处', weaknesses: '弱点', secrets: '秘密', arcStage: '变化阶段',
  publicSummary: '公开表现', publicGoal: '公开目标',
  entityType: '人物类别', surname: '姓氏', givenName: '名字', birthplace: '出生地', activeRegions: '活动区域', rankLevel: '身份位阶', firstImpression: '第一印象', hiddenSecret: '隐藏的秘密', selfDeception: '自我蒙蔽', trauma: '既有创伤', contradiction: '内在矛盾', resonancePoint: '共鸣点', catchphrases: '惯用说法', vocabularyLevel: '用语特点', dialectFeatures: '方言特征', parentIds: '父母', appearChapter: '首次出场章序', powerSystemRefs: '能力体系关联', contextHooks: '相关设定', sourceContext: '原始依据',
  type: '类型', territoryMapNodeIds: '涉及区域', leaderCharacterId: '负责人', externalRelations: '对外关系', ownerCharacterId: '持有人', locationMapId: '所在地点', presentCharacterIds: '在场人物', mapNodeId: '关联地点', chapterStartId: '开始章节', chapterEndId: '结束章节',
  itemKind: '物品类型', subType: '细分类别', acquisitionMethod: '获得方式', usageMethod: '使用与查验方法', rarity: '稀有程度', factionHint: '组织关联说明', linkedCharacterIds: '关联人物', linkedTimelineEventIds: '关联事件', linkedItemIds: '相关物品', affectedCharacterIds: '受影响人物', protagonistAction: '主角行动', protagonistPresent: '主角是否在场', isMajorEvent: '是否重要事件', directConsequences: '直接后果', openThreads: '尚未解决的问题',
  organizationLevel: '组织层级', ideology: '理念与立场', methods: '行事方式', funding: '资金来源', positions: '组织岗位', positionId: '担任岗位', title: '名称', responsibilities: '职责', requirements: '任职要求', reportsToPositionId: '汇报岗位', hierarchy: '组织结构', leaderId: '负责人', headquartersId: '主要驻地', territoryIds: '涉及区域', structure: '组织结构', memberCount: '人员规模',
  locationRole: '地域关联', bilateral: '双向关系', strength: '关系强度', isHidden: '隐秘关系', publicLabel: '公开关系', privateReality: '真实关系', startsAt: '开始时间', endsAt: '结束时间', notesJson: '补充说明', x: '示意横坐标', y: '示意纵坐标',
}

export function atlasDisplayAttributes(attributes: Record<string, unknown>, chapters: Array<{ id: number; chapterNum: number }>) {
  const result = { ...attributes }
  if (result.lastProgressChapterId != null && result.lastProgressChapterId !== '') {
    const chapter = chapters.find(item => item.id === Number(result.lastProgressChapterId))
    result.lastProgressChapterId = chapter ? `第 ${chapter.chapterNum} 章` : '关联章节不可用'
  }
  return result
}

export function locationCoordinates(entities: StoryAtlasEntity[]): Map<string, { x: number; y: number }> {
  const positioned = entities.filter((entity) => typeof entity.attributes.x === 'number' && Number.isFinite(entity.attributes.x)
    && typeof entity.attributes.y === 'number' && Number.isFinite(entity.attributes.y))
  if (!positioned.length) return new Map()
  const xs = positioned.map((entity) => entity.attributes.x as number)
  const ys = positioned.map((entity) => entity.attributes.y as number)
  const left = Math.min(...xs); const top = Math.min(...ys)
  if (positioned.length > 1 && Math.max(...xs) === left && Math.max(...ys) === top) return new Map()
  const scale = Math.min(760 / Math.max(1, Math.max(...xs) - left), 480 / Math.max(1, Math.max(...ys) - top))
  const occupied = new Map<string, number>()
  return new Map(positioned.map((entity) => {
    const key = `${entity.attributes.x}:${entity.attributes.y}`
    const duplicateIndex = occupied.get(key) || 0
    occupied.set(key, duplicateIndex + 1)
    return [entity.id, { x: ((entity.attributes.x as number) - left) * scale + (duplicateIndex % 3) * 235, y: ((entity.attributes.y as number) - top) * scale + 70 + Math.floor(duplicateIndex / 3) * 170 }]
  }))
}

export function atlasAttributeValue(key: string, value: unknown) {
  if (key === 'development') return ({ detailed: '已展开', outlined: '已有轮廓', unexplored: '待拓展' } as Record<string, string>)[String(value)] || value
  if (key === 'entityType') return ({ human: '人类', nonhuman: '异类', undead: '亡灵', monster: '妖异', spirit: '精怪', ghost: '鬼魂' } as Record<string, string>)[String(value)] || value
  if (key === 'currentStatus') return ({ active: '推进中', stalled: '暂时停滞', completed: '已完成', resolved: '已解决', planned: '待推进', abandoned: '已放弃' } as Record<string, string>)[String(value)] || value
  if (key === 'roleType') return ({ protagonist: '主角', major: '主要人物', antagonist: '对立人物', supporting: '配角', minor: '次要人物' } as Record<string, string>)[String(value)] || value
  if (key === 'nodeType' || key === 'locationType') return ({ region: '地域', country: '国家', province: '州郡', city: '城市', town: '城镇', village: '村庄', building: '建筑', room: '屋室', site: '场景地点', location: '地点', bridge: '桥梁', inn: '客栈', ferry: '渡口', courtyard: '庭院', yard: '院落', well: '井', corridor: '廊道', hall: '厅堂', storeroom: '储物房', storage: '储物处', river: '河流', road: '道路', platform: '台地', landmark: '地标', port: '港口', mountain: '山地', forest: '林地', lake: '湖泊', settlement: '聚落', interior_space: '室内场所', stone_platform: '石台', guest_room_area: '客房区域' } as Record<string, string>)[String(value)] || value
  if (key === 'routeOpen') return value === false || value === 0 ? '关闭' : '可通行'
  return value
}

export function visibleAttributes(entity: StoryAtlasEntity) {
  return Object.entries(entity.attributes).filter(([key, value]) => ATLAS_ATTRIBUTE_LABELS[key]
    && value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
}
