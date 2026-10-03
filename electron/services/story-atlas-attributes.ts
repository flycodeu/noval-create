import { STORY_ATLAS_ATTRIBUTE_SCHEMAS, type StoryAtlasEntityKind, type StoryAtlasPosition, type StoryAtlasRelationKind } from '../../src/shared/story-atlas'
import { validateJsonSchema } from '../../src/shared/tool-contracts'

export function meaningfulAtlasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (typeof value === 'object') return Object.values(value).some(meaningfulAtlasValue)
  return true
}

export function normalizeAtlasAttributePatch(kind: StoryAtlasEntityKind | StoryAtlasRelationKind, raw: Record<string, unknown> = {}): Record<string, unknown> {
  const patch = Object.fromEntries(Object.entries(raw).filter(([, value]) => meaningfulAtlasValue(value)))
  for (const key of ['campFactionIds', 'birthLocationId', 'homeLocationId', 'activityLocationIds', 'headquartersLocationId', 'baseLocationIds', 'territoryLocationIds']) {
    if (key in patch) throw new Error(`${key} 请改用明确的 presence 或 membership 关系与图谱ID，不能把未校验ID放在属性中。`)
  }
  const schema = STORY_ATLAS_ATTRIBUTE_SCHEMAS[kind]
  if (schema) {
    const result = validateJsonSchema(patch, schema)
    if (!result.valid) throw new Error(`${kind} 属性结构错误：${result.issues.join('；')}`)
  }
  if (kind === 'faction' && Array.isArray(patch.positions)) {
    const ids = patch.positions.map(position => (position as StoryAtlasPosition).id)
    if (new Set(ids).size !== ids.length) throw new Error('同一批岗位补丁不能重复使用岗位ID。')
  }
  return patch
}

/** Absent/empty fields preserve canon; lists add items and organization slots merge by local id. */
export function mergeAtlasAttributes(current: Record<string, unknown> = {}, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current, ...patch }
  for (const [key, value] of Object.entries(patch)) {
    if (!Array.isArray(value)) continue
    const previous = Array.isArray(current[key]) ? current[key] as unknown[] : []
    if (value.every(item => typeof item === 'string')) next[key] = [...new Set([...previous, ...value])]
    else if (key === 'positions') {
      const positions = new Map((previous as StoryAtlasPosition[]).map(position => [position.id, position]))
      for (const position of value as StoryAtlasPosition[]) positions.set(position.id, { ...positions.get(position.id), ...position })
      next[key] = [...positions.values()]
    }
  }
  return next
}

export function validateAtlasPositions(raw: unknown): StoryAtlasPosition[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('组织岗位必须为数组。')
  const positions = raw as StoryAtlasPosition[]
  const ids = new Set<string>()
  for (const position of positions) {
    if (!position.id?.trim() || ids.has(position.id)) throw new Error('组织岗位须使用唯一且非空的稳定ID。')
    if (!position.title?.trim() || !['planned', 'established'].includes(position.status)) throw new Error('新岗位必须明确名称和计划/已设状态，不能把空岗位当作实际人物。')
    ids.add(position.id)
  }
  const byId = new Map(positions.map(position => [position.id, position]))
  for (const position of positions) {
    let parentId = position.reportsToPositionId
    const seen = new Set([position.id])
    while (parentId) {
      const parent = byId.get(parentId)
      if (!parent) throw new Error('岗位的上级必须属于同一组织；跨组织层级使用组织 parentId。')
      if (seen.has(parentId)) throw new Error('组织岗位汇报层级不能循环。')
      if (position.status === 'established' && parent.status === 'planned') throw new Error('已设岗位不能隶属尚未设立的上级岗位。')
      seen.add(parentId)
      parentId = parent.reportsToPositionId
    }
  }
  return positions
}
