/** Author-facing story function; never implies acquaintance or character knowledge. */
export const CAST_ROLES = [
  { value: 'protagonist', label: '主角' },
  { value: 'companion', label: '主角团' },
  { value: 'supporting', label: '剧情人物' },
  { value: 'walk_on', label: '过场人物' },
  { value: 'potential_enemy', label: '潜在敌人' },
  { value: 'antagonist', label: '对立人物' },
  { value: 'unassigned', label: '待分类' },
] as const
export type CastRole = typeof CAST_ROLES[number]['value']

export function characterCastRole(attributes: Record<string, unknown>): CastRole {
  const planning = attributes.authorPlanning
  const explicit = planning && typeof planning === 'object' && !Array.isArray(planning) ? (planning as Record<string, unknown>).castRole : undefined
  if (CAST_ROLES.some(role => role.value === explicit)) return explicit as CastRole
  // Importance alone does not establish allegiance. Keep old records readable.
  switch (attributes.roleType) {
    case 'protagonist': return 'protagonist'
    case 'antagonist': return 'antagonist'
    case 'major': case 'supporting': return 'supporting'
    case 'minor': return 'walk_on'
    default: return 'unassigned'
  }
}

export const CAST_RELATION_GUIDANCE = '人物有自己的生活与利益。区分主角、主角团、独立剧情人物、过场人物、潜在敌人与已形成对立的人物；主要人物不等于主角同伴。只为有具体交往、利益或冲突依据的双方建立人物关系；共同参与事件不等于彼此相识。允许配角之间的独立关系群和没有关系的过场人物，不为连接图谱强行关联主角。未来关系保持计划，不能提前成为人物知情或已发生事实。'
export const CAST_DESIGN_GUIDANCE = `${CAST_RELATION_GUIDANCE} 人物阶段可用 attributes.authorPlanning.castRole 标记 protagonist、companion、supporting、walk_on、potential_enemy、antagonist 或 unassigned，仅作为作者规划。关系阶段只修改关系，不为分类改写人物。共同参与事件使用 participation。`
