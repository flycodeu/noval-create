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
  roleType: '角色定位', role_type: '角色定位', age: '年龄', gender: '性别', species: '种属',
  occupation: '职业', socialIdentity: '社会身份', social_identity: '社会身份',
  personalityTraits: '性格特点', personalityTraitsJson: '性格特点', personality_traits: '性格特点',
  goals: '当前目标', surfaceDesire: '表面欲望', deepNeed: '内在需要', coreFear: '恐惧', innerConflict: '内在矛盾',
  moralLine: '底线', flaws: '缺点', habits: '习惯', speechPattern: '说话方式', appearance: '外貌',
  relationshipTension: '关系压力', dramaticEngine: '行动动力', characterArc: '人物变化', background: '来历',
  locationType: '地点类型', nodeType: '地点层级', atmosphere: '氛围', plotRelevance: '故事作用', dangerLevel: '危险程度',
  level: '层级', structureRole: '地点作用', tags: '标签', description: '描述',
  travelHours: '行程小时', travelMode: '交通方式', routeOpen: '是否通行',
  terrain: '地形', waterSystem: '水系', waterSource: '水源', climate: '气候', livelihood: '生计', livelihoods: '生计',
  economy: '当地产业', access: '出入通路', routes: '通行路线', transport: '交通', resources: '资源',
  intimacyLevel: '亲近程度', tensionLevel: '紧张程度', interactionStyle: '相处方式', subtextRule: '潜台词',
  relationType: '关系类型', timeLabel: '发生时间', chapterNum: '章节', significance: '事件影响',
  abilities: '能力与限制', goal: '目标', memberPolicy: '成员规则', currentPhase: '当前阶段',
  category: '类型', plotFunction: '故事作用', limitations: '使用限制', abilitySpec: '作用', cost: '代价', risk: '风险',
  eventType: '事件类型', eventCause: '前因', eventProcess: '经过', eventResult: '结果',
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
  if (key === 'roleType') return ({ protagonist: '主角', major: '主要人物', antagonist: '对立人物', supporting: '配角', minor: '次要人物' } as Record<string, string>)[String(value)] || value
  if (key === 'nodeType' || key === 'locationType') return ({ region: '地域', country: '国家', province: '州郡', city: '城市', town: '城镇', village: '村庄', building: '建筑', room: '屋室', site: '场景地点', location: '地点' } as Record<string, string>)[String(value)] || value
  if (key === 'routeOpen') return value === false || value === 0 ? '关闭' : '可通行'
  return value
}

export function visibleAttributes(entity: StoryAtlasEntity) {
  return Object.entries(entity.attributes).filter(([key, value]) => ATLAS_ATTRIBUTE_LABELS[key]
    && value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
}
