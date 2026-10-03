import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getSqlite } from '../database/db'
import { insertAtlasRevision, readAtlasRecords, type AtlasStoredRecord, type AtlasRecord } from '../database/story-atlas-store'
import { markNovelContextChanged } from './context-impact.service'
import { meaningfulAtlasValue, mergeAtlasAttributes, normalizeAtlasAttributePatch, validateAtlasPositions } from './story-atlas-attributes'
import type {
  StoryAtlasApplyInput, StoryAtlasApplyResult, StoryAtlasDiagnostic, StoryAtlasEntity, StoryAtlasEntityKind,
  StoryAtlasQuery, StoryAtlasRelation, StoryAtlasSnapshot, StoryAtlasValidationResult,
} from '../../src/shared/story-atlas'

export class StoryAtlasError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'StoryAtlasError' }
}
function fail(code: string, message: string): never { throw new StoryAtlasError(code, message) }
const isEntity = (record: AtlasRecord): record is StoryAtlasEntity => 'name' in record
const entityKinds = new Set(['location', 'character', 'faction', 'item', 'event'])
const relationKinds = new Set(['relationship', 'route', 'presence', 'ownership', 'membership', 'participation'])
const identity = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase()
function projectVersion(sqlite: Database.Database, novelId: number): number {
  if (!Number.isInteger(novelId) || novelId <= 0) fail('INVALID_INPUT', 'novelId 必须为正整数。')
  const row = sqlite.prepare('SELECT context_version FROM novels WHERE id=?').get(novelId) as { context_version: number } | undefined
  if (!row) fail('PROJECT_NOT_FOUND', '小说项目不存在。')
  return row.context_version || 1
}
function chapter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail('INVALID_INPUT', '章节序号必须为非负整数，背景事实用 0。')
  return value
}
function diagnose(entities: StoryAtlasEntity[], relations: StoryAtlasRelation[]): StoryAtlasDiagnostic[] {
  const result: StoryAtlasDiagnostic[] = []
  const locations = entities.filter((entity) => entity.kind === 'location')
  if (!locations.length) result.push({ severity: 'warning', code: 'LOCATIONS_EMPTY', message: '尚未登记地点，无法校验行程与空间关系。', entityIds: [] })
  if (entities.some((entity) => entity.kind === 'character') && !relations.some((relation) => relation.kind === 'relationship')) {
    result.push({ severity: 'warning', code: 'RELATIONSHIPS_EMPTY', message: '已有人物，但尚未登记人物之间的关系。', entityIds: [] })
  }
  for (const entity of entities.filter((record) => record.kind === 'character')) {
    if (!meaningfulAtlasValue(entity.attributes.personalityTraits) && !meaningfulAtlasValue(entity.attributes.speechPattern)) result.push({ severity: 'info', code: 'CHARACTER_VOICE_MISSING', message: `${entity.name}尚未填写性格表现和说话方式。`, entityIds: [entity.id] })
    if (!relations.some(edge => edge.kind === 'presence' && edge.fromId === entity.id)) result.push({ severity: 'info', code: 'CHARACTER_GEOGRAPHY_MISSING', message: `${entity.name}尚未登记出生、常住或活动地点；不会从职业推断位置。`, entityIds: [entity.id] })
  }
  for (const entity of entities.filter(record => record.kind === 'faction')) {
    if (!meaningfulAtlasValue(entity.attributes.goal) && !meaningfulAtlasValue(entity.attributes.traits)) result.push({ severity: 'info', code: 'FACTION_PROFILE_MISSING', message: `${entity.name}尚未登记目标与组织特点。`, entityIds: [entity.id] })
    if (!relations.some(edge => edge.kind === 'presence' && edge.fromId === entity.id)) result.push({ severity: 'info', code: 'FACTION_GEOGRAPHY_MISSING', message: `${entity.name}尚未登记总部、据点或涉及区域。`, entityIds: [entity.id] })
  }
  for (const route of relations.filter((record) => record.kind === 'route')) {
    const hours = Number(route.attributes.travelHours)
    const km = Number(route.attributes.distanceKm)
    if (route.attributes.travelHours === undefined || route.attributes.travelHours === null) result.push({ severity: 'info', code: 'TRAVEL_TIME_UNKNOWN', message: `${route.label || '路线'}尚未登记通行耗时。`, entityIds: [route.fromId, route.toId] })
    if (km > 0 && hours > 0 && /步行|foot|walk/i.test(String(route.attributes.travelMode || '')) && km / hours > 8) result.push({ severity: 'warning', code: 'WALKING_SPEED_IMPLAUSIBLE', message: `${route.label || '路线'}的步行速度超过每小时 8 公里，请复核距离、耗时或特殊设定。`, entityIds: [route.fromId, route.toId] })
  }
  return result
}

export function queryStoryAtlas(input: StoryAtlasQuery): StoryAtlasSnapshot {
  const sqlite = getSqlite()
  const contextVersion = projectVersion(sqlite, input.novelId)
  if (input.atChapter !== undefined) chapter(input.atChapter)
  const all = readAtlasRecords(sqlite, input.novelId, input.atChapter, input.includePlanned === true).filter((item) => !item.retired)
  let entities = all.flatMap((item) => item.recordType === 'entity' ? [item.record as StoryAtlasEntity] : [])
  const ids = new Set(entities.map((entity) => entity.id))
  let relations = all.flatMap((item) => item.recordType === 'relation' ? [item.record as StoryAtlasRelation] : [])
  const hidden = relations.filter((edge) => !ids.has(edge.fromId) || !ids.has(edge.toId))
  relations = relations.filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId))
  const diagnostics = diagnose(entities, relations)
  if (hidden.length) diagnostics.push({ severity: 'warning', code: 'RELATION_ENDPOINT_UNAVAILABLE', message: `${hidden.length} 条关系的端点在当前章节或状态下不可见。`, entityIds: hidden.map((edge) => edge.id) })
  if (input.locationParentId && !entities.some((entity) => entity.id === input.locationParentId && entity.kind === 'location')) fail('ENTITY_NOT_FOUND', '所选上级地点不在当前小说或章节中。')
  const locationChildren = entities.filter((entity) => entity.kind === 'location' && entity.parentId === (input.locationParentId || null))
  if (input.focusEntityId) {
    if (!ids.has(input.focusEntityId)) fail('ENTITY_NOT_FOUND', '焦点实体不在当前小说或章节中。')
    const focusedIds = new Set([input.focusEntityId])
    const focus = entities.find(entity => entity.id === input.focusEntityId)!
    for (let previousSize = -1; previousSize !== focusedIds.size;) {
      previousSize = focusedIds.size
      for (const entity of entities) if (entity.parentId && focusedIds.has(entity.parentId)) focusedIds.add(entity.id)
    }
    relations = relations.filter(edge => focusedIds.has(edge.fromId) || focusedIds.has(edge.toId))
    for (const edge of relations) { focusedIds.add(edge.fromId); focusedIds.add(edge.toId) }
    if (focus.parentId) focusedIds.add(focus.parentId)
    entities = entities.filter((entity) => focusedIds.has(entity.id))
  }
  return { novelId: input.novelId, contextVersion, atChapter: input.atChapter ?? null, entities, relations, locationChildren, diagnostics }
}

interface Prepared { records: AtlasStoredRecord[]; changed: AtlasStoredRecord[]; idMap: Record<string, string>; diagnostics: StoryAtlasDiagnostic[]; contextVersion: number }
function prepare(input: StoryAtlasApplyInput): Prepared {
  const sqlite = getSqlite()
  const contextVersion = projectVersion(sqlite, input.novelId)
  if (input.expectedContextVersion !== contextVersion) fail('CONTEXT_VERSION_CONFLICT', `项目上下文已变为 v${contextVersion}，请重新读取后提交。`)
  chapter(input.effectiveFromChapter)
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) fail('INVALID_INPUT', '需要长度不超过 200 的幂等键。')
  if (!input.source || typeof input.source.kind !== 'string' || !input.source.kind.trim()) fail('SOURCE_REQUIRED', '变更必须说明来源。')
  if (JSON.stringify(input.source).length > 8000) fail('INVALID_INPUT', '来源说明过长。')
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 100) fail('INVALID_INPUT', '每次提交须包含 1 至 100 项变更。')
  const current = readAtlasRecords(sqlite, input.novelId, input.effectiveFromChapter)
  const allIds = new Map(readAtlasRecords(sqlite, input.novelId).map((item) => [item.record.id, item]))
  const byId = new Map(current.map((item) => [item.record.id, structuredClone(item)]))
  const idMap: Record<string, string> = {}
  const changeIds = new Map<number, string>()
  const changedIds = new Set<string>()
  for (const [index, change] of input.changes.entries()) {
    if (!change || !['upsert_entity', 'upsert_relation', 'retire'].includes(change.op)) fail('INVALID_INPUT', '未知的图谱变更操作。')
    if (change.op === 'retire') continue
    if (change.attributes && (typeof change.attributes !== 'object' || Array.isArray(change.attributes) || JSON.stringify(change.attributes).length > 32000)) fail('INVALID_INPUT', 'attributes 必须为不超过 32KB 的对象。')
    if (change.status && !['confirmed', 'planned'].includes(change.status)) fail('INVALID_INPUT', '不支持的资料状态。')
    if (change.clientId !== undefined && (typeof change.clientId !== 'string' || !change.clientId.trim() || change.clientId.length > 200)) fail('INVALID_INPUT', '临时 ID 须为 1 至 200 字符。')
    if (!(change.op === 'upsert_entity' ? entityKinds : relationKinds).has(change.kind)) fail('INVALID_INPUT', '不支持的图谱类型。')
    if (change.op === 'upsert_entity' && (typeof change.name !== 'string' || !change.name.trim() || change.name.length > 200)) fail('INVALID_INPUT', '实体名称须为 1 至 200 字符。')
    if (change.op === 'upsert_entity') {
      if (change.summary !== undefined && (typeof change.summary !== 'string' || change.summary.length > 20000)) fail('INVALID_INPUT', '摘要须为不超过 20000 字符的文本。')
      if (change.parentId !== undefined && change.parentId !== null && typeof change.parentId !== 'string') fail('INVALID_INPUT', '上级地点 ID 格式不正确。')
      for (const [attribute, column] of Object.entries(fields[change.kind])) {
        const value = change.attributes?.[attribute]
        if (value === undefined || value === null) continue
        if (attribute === 'age' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) fail('INVALID_ATTRIBUTE', '人物年龄必须为非负整数。')
        if (attribute === 'timeSortValue' && (typeof value !== 'number' || !Number.isFinite(value))) fail('INVALID_ATTRIBUTE', '事件时间排序值必须为有限数字。')
        if (!column.endsWith('_json') && !['age', 'timeSortValue'].includes(attribute) && typeof value !== 'string') fail('INVALID_ATTRIBUTE', `${attribute} 必须为文本。`)
      }
    } else {
      if (typeof change.fromId !== 'string' || typeof change.toId !== 'string' || !change.fromId || !change.toId) fail('INVALID_INPUT', '关系必须提供两端实体 ID。')
      if (change.label !== undefined && (typeof change.label !== 'string' || change.label.length > 2000)) fail('INVALID_INPUT', '关系标签须为文本。')
    }
    if (change.id && !allIds.has(change.id)) fail('ENTITY_NOT_FOUND', `引用 ${change.id} 不属于当前项目。`)
    if (change.id && !byId.has(change.id)) fail('FUTURE_ENTITY_REFERENCE', `引用 ${change.id} 在该章节尚未建立。`)
    let id = change.id
    if (!id && change.op === 'upsert_entity') {
      const same = [...byId.values()].find((item) => !item.retired && isEntity(item.record) && item.record.kind === change.kind && identity(item.record.name) === identity(change.name)
        && (!['location', 'faction'].includes(change.kind) || item.record.parentId === (idMap[change.parentId || ''] || change.parentId || null)))
      id = same?.record.id
    }
    id ||= `${change.kind}:${randomUUID()}`
    if (changedIds.has(id)) fail('DUPLICATE_CHANGE', `同一批次不能重复修改 ${id}。`)
    changedIds.add(id)
    changeIds.set(index, id)
    if (change.clientId) {
      if (idMap[change.clientId] || allIds.has(change.clientId)) fail('DUPLICATE_CLIENT_ID', `临时 ID ${change.clientId} 重复。`)
      idMap[change.clientId] = id
    }
    if (change.op === 'upsert_entity') {
      const old = byId.get(id)
      if (old && (old.recordType !== 'entity' || old.record.kind !== change.kind)) fail('KIND_MISMATCH', '更新不能改变实体类型。')
      const previous = old?.record as StoryAtlasEntity | undefined
      byId.set(id, { recordType: 'entity', nativeTable: old?.nativeTable || null, nativeId: old?.nativeId || null, retired: false, record: {
        id, kind: change.kind, name: change.name.trim(), summary: change.summary ?? previous?.summary ?? '',
        parentId: change.parentId !== undefined ? change.parentId : previous?.parentId || null,
        attributes: mergeAtlasAttributes(previous?.attributes, normalizeAtlasAttributePatch(change.kind, change.attributes)), status: change.status || previous?.status || 'confirmed',
        effectiveFromChapter: input.effectiveFromChapter, source: input.source,
      } })
    }
  }
  const resolve = (id: string) => idMap[id] || id
  for (const id of changedIds) {
    const item = byId.get(id)
    if (item && isEntity(item.record) && item.record.parentId) item.record.parentId = resolve(item.record.parentId)
  }
  for (const [index, change] of input.changes.entries()) {
    if (change.op !== 'upsert_relation') continue
    let id = changeIds.get(index)!
    const fromId = resolve(change.fromId), toId = resolve(change.toId)
    if (!change.id) {
      const same = [...byId.values()].find((item) => {
        if (item.retired || isEntity(item.record) || item.record.kind !== change.kind) return false
        const edge = item.record
        if (change.kind === 'presence') {
          const role = String(change.attributes?.locationRole || 'current'), previousRole = String(edge.attributes.locationRole || (edge.attributes.bindingType ? 'unspecified' : 'current'))
          if (role !== previousRole || edge.fromId !== fromId) return false
          return role === 'current' || role === 'birthplace' ? true : edge.toId === toId
        }
        if (change.kind === 'membership') return edge.fromId === fromId && edge.toId === toId && (edge.attributes.positionId || '') === (change.attributes?.positionId || '')
        if (change.kind === 'ownership') return edge.toId === toId
        return edge.fromId === fromId && edge.toId === toId
          || (change.kind === 'relationship' || change.kind === 'route') && change.attributes?.bilateral !== false && edge.attributes.bilateral !== false && edge.fromId === toId && edge.toId === fromId
      })
      if (same) {
        changedIds.delete(id)
        id = same.record.id
        if (changedIds.has(id)) fail('DUPLICATE_CHANGE', `同一批次不能重复修改 ${id}。`)
        changedIds.add(id)
        changeIds.set(index, id)
        if (change.clientId) idMap[change.clientId] = id
      }
    }
    const old = byId.get(id)
    if (old && (old.recordType !== 'relation' || old.record.kind !== change.kind)) fail('KIND_MISMATCH', '更新不能改变关系类型。')
    const previous = old?.record as StoryAtlasRelation | undefined
    byId.set(id, { recordType: 'relation', nativeTable: old?.nativeTable || null, nativeId: old?.nativeId || null, retired: false, record: {
      id, kind: change.kind, fromId, toId, label: change.label ?? previous?.label ?? '',
      attributes: mergeAtlasAttributes(previous?.attributes, normalizeAtlasAttributePatch(change.kind, change.attributes)), status: change.status || previous?.status || 'confirmed',
      effectiveFromChapter: input.effectiveFromChapter, source: input.source,
    } })
  }
  for (const change of input.changes) if (change.op === 'retire') {
    const id = resolve(change.id)
    const old = byId.get(id)
    if (!old || old.retired) fail('ENTITY_NOT_FOUND', `无法停用不存在的记录 ${id}。`)
    old.retired = true
    old.record = { ...old.record, effectiveFromChapter: input.effectiveFromChapter, source: input.source }
    changedIds.add(id)
    if (old.recordType === 'entity') for (const edge of byId.values()) {
      if (!isEntity(edge.record) && (edge.record.fromId === id || edge.record.toId === id)) {
        edge.retired = true
        edge.record = { ...edge.record, effectiveFromChapter: input.effectiveFromChapter, source: input.source }
        changedIds.add(edge.record.id)
      }
    }
  }
  const live = [...byId.values()].filter((item) => !item.retired)
  const entities = live.flatMap((item) => isEntity(item.record) ? [item.record] : [])
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const locationRank = (entity: StoryAtlasEntity) => {
    const type = String(entity.attributes.locationType || entity.attributes.nodeType || '').toLowerCase()
    return ({ region: 1, province: 1, 区域: 1, 地区: 1, 省: 1, city: 2, town: 2, 城市: 2, 城镇: 2, 镇: 2, village: 3, 村庄: 3, 村: 3, site: 4, location: 4, 地点: 4, 场所: 4, room: 5, 房间: 5 } as Record<string, number>)[type]
  }
  for (const entity of entities) if (entity.parentId) {
    const parent = entityById.get(entity.parentId)
    if (!['location', 'faction'].includes(entity.kind) || parent?.kind !== entity.kind) fail('INVALID_ENTITY_PARENT', '上级必须是当前项目中生效的同类地点或组织。')
    if (entity.status === 'confirmed' && parent.status === 'planned') fail('UNCONFIRMED_PARENT', '已生效资料不能隶属尚未确定的上级资料。')
    const childRank = entity.kind === 'location' ? locationRank(entity) : undefined, parentRank = entity.kind === 'location' ? locationRank(parent) : undefined
    if (childRank && parentRank && childRank < parentRank) fail('LOCATION_HIERARCHY_INVERTED', '地区、城镇、村庄、场所的包含层级不能倒置。')
    const seen = new Set([entity.id])
    let ancestor: StoryAtlasEntity | undefined = parent
    while (ancestor) {
      if (seen.has(ancestor.id)) fail('ENTITY_CYCLE', '地点或组织不能成为自身的上级。')
      seen.add(ancestor.id)
      ancestor = ancestor.parentId ? entityById.get(ancestor.parentId) : undefined
    }
  }
  const positions = new Map(entities.filter(entity => entity.kind === 'faction').map(entity => [entity.id, validateAtlasPositions(entity.attributes.positions)]))
  const relations = live.flatMap((item) => !isEntity(item.record) ? [item.record] : [])
  const endpointKinds: Record<StoryAtlasRelation['kind'], [string[], string[]]> = {
    relationship: [['character'], ['character']], route: [['location'], ['location']], presence: [['character', 'item', 'faction', 'event'], ['location']],
    ownership: [['character', 'faction'], ['item']], membership: [['character'], ['faction']], participation: [['character', 'faction', 'item'], ['event']],
  }
  for (const edge of relations) {
    const from = entityById.get(edge.fromId), to = entityById.get(edge.toId)
    if (!from || !to) fail('INVALID_RELATION_REFERENCE', `关系 ${edge.label || edge.id} 引用了不在该章节生效的实体。`)
    if (from.id === to.id || !endpointKinds[edge.kind][0].includes(from.kind) || !endpointKinds[edge.kind][1].includes(to.kind)) fail('INVALID_RELATION_KIND', `关系 ${edge.kind} 的端点类型不正确。`)
    if (edge.status === 'confirmed' && (from.status === 'planned' || to.status === 'planned')) fail('UNCONFIRMED_ENDPOINT', '已生效关系不能引用尚未确定的实体。')
    if (edge.kind === 'presence' && from.kind === 'faction' && changedIds.has(edge.id) && !edge.attributes.locationRole) fail('LOCATION_ROLE_REQUIRED', '组织地点关联必须明确是总部、据点还是涉及区域。')
    if (edge.kind === 'presence' && edge.attributes.locationRole) {
      const roles = from.kind === 'character' ? ['current', 'birthplace', 'residence', 'activity'] : from.kind === 'faction' ? ['headquarters', 'outpost', 'jurisdiction'] : ['current']
      if (!roles.includes(String(edge.attributes.locationRole))) fail('INVALID_LOCATION_ROLE', '地点关联角色与来源实体类型不匹配。')
    }
    if (edge.kind === 'membership' && edge.attributes.positionId) {
      const position = positions.get(to.id)?.find(position => position.id === edge.attributes.positionId)
      if (!position) fail('INVALID_POSITION_REFERENCE', '任职岗位必须是成员所属组织已经登记的岗位ID。')
      if (edge.status === 'confirmed' && position.status !== 'established') fail('UNCONFIRMED_POSITION', '实际成员不能任职尚未设立的计划岗位；请先确认岗位或将任职关系标为计划。')
    }
    if (edge.kind === 'route') for (const key of ['travelHours', 'distanceKm']) {
      const value = edge.attributes[key]
      if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('INVALID_TRAVEL_VALUE', `${key} 必须为非负数。`)
    }
  }
  for (const id of changedIds) {
    const future = allIds.get(id)
    if (future && future.record.effectiveFromChapter > input.effectiveFromChapter) fail('ATLAS_HISTORY_CONFLICT', `记录 ${id} 在后续章节已有变化，请从最新状态修改，或先明确后续变化如何调整。`)
  }
  return { records: [...byId.values()], changed: [...changedIds].map((id) => byId.get(id)!), idMap, contextVersion, diagnostics: diagnose(entities, relations) }
}

export function validateStoryAtlasChanges(input: StoryAtlasApplyInput): StoryAtlasValidationResult {
  const prepared = prepare(input)
  return { valid: true, novelId: input.novelId, contextVersion: prepared.contextVersion, diagnostics: prepared.diagnostics }
}

const entityTables: Record<StoryAtlasEntityKind, string> = { character: 'characters', location: 'world_map', faction: 'factions', item: 'story_items', event: 'timeline_events' }
const fields: Record<StoryAtlasEntityKind, Record<string, string>> = {
  location: { locationType: 'location_type', nodeType: 'node_type', atmosphere: 'atmosphere', plotRelevance: 'plot_relevance', dangerLevel: 'danger_level', tags: 'tags_json' },
  character: { roleType: 'role_type', entityType: 'entity_type', age: 'age', occupation: 'occupation', personalityTraits: 'personality_traits_json', flaws: 'flaws_json', habits: 'habits_json', goals: 'goals', surfaceDesire: 'surface_desire', deepNeed: 'deep_need', coreFear: 'core_fear', moralLine: 'moral_line', speechPattern: 'speech_pattern', appearance: 'appearance_json', abilities: 'abilities_json', relationshipTension: 'relationship_tension', dramaticEngine: 'dramatic_engine' },
  faction: { type: 'type', goal: 'goal', resources: 'resources', memberPolicy: 'member_policy', currentPhase: 'current_phase' },
  item: { category: 'category', status: 'status', plotFunction: 'plot_function', limitations: 'limitations', abilitySpec: 'ability_spec', cost: 'cost', risk: 'risk' },
  event: { timeLabel: 'time_label', eventType: 'event_type', eventCause: 'event_cause', eventProcess: 'event_process', eventResult: 'event_result', timeSortValue: 'time_sort_value' },
}
function writeRow(sqlite: Database.Database, table: string, nativeId: number | null, values: Record<string, unknown>): number {
  const entries = Object.entries(values)
  if (nativeId && sqlite.prepare(`SELECT 1 FROM ${table} WHERE id=? AND novel_id=?`).get(nativeId, values.novel_id)) {
    sqlite.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=? AND novel_id=?`).run(...entries.map(([, value]) => value), nativeId, values.novel_id)
    return nativeId
  }
  return Number(sqlite.prepare(`INSERT INTO ${table} (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map(() => '?').join(',')})`).run(...entries.map(([, value]) => value)).lastInsertRowid)
}
function projectNative(sqlite: Database.Database, novelId: number, item: AtlasStoredRecord, records: Map<string, AtlasStoredRecord>): void {
  // Planned records stay in the plan layer until a confirmed revision is applied.
  if (item.retired || item.record.status !== 'confirmed') return
  const record = item.record
  const native = (id: string) => records.get(id)?.nativeId || null
  if (isEntity(record)) {
    const values: Record<string, unknown> = { novel_id: novelId }
    const nameField = { character: 'full_name', location: 'name', faction: 'name', item: 'item_name', event: 'event_title' }[record.kind]
    const summaryField = { character: 'background', location: 'description', faction: 'notes', item: 'summary', event: 'event_summary' }[record.kind]
    values[nameField] = record.name
    values[summaryField] = record.summary
    for (const [attribute, column] of Object.entries(fields[record.kind])) if (record.attributes[attribute] !== undefined) {
      const value = record.attributes[attribute]
      values[column] = column.endsWith('_json') ? JSON.stringify(value) : typeof value === 'object' ? JSON.stringify(value) : value
    }
    if (record.kind === 'location') {
      values.parent_id = record.parentId ? native(record.parentId) : null
      let level = 1, parentId = record.parentId
      while (parentId) { level++; const parent = records.get(parentId)?.record; parentId = parent && isEntity(parent) ? parent.parentId : null }
      values.level = level
    }
    if (record.kind === 'event') {
      values.time_label ||= record.effectiveFromChapter ? `第 ${record.effectiveFromChapter} 章` : '背景事件'
      values.status = 'confirmed'
      values.chapter_start_id = (sqlite.prepare('SELECT id FROM chapters WHERE novel_id=? AND chapter_num=?').get(novelId, record.effectiveFromChapter) as { id: number } | undefined)?.id || null
    }
    if (record.kind === 'character' || record.kind === 'item') values.record_status = 'confirmed'
    item.nativeTable = entityTables[record.kind]
    item.nativeId = writeRow(sqlite, item.nativeTable, item.nativeId, values)
    return
  }
  const fromId = native(record.fromId), toId = native(record.toId)
  if (!fromId || !toId) fail('INVALID_RELATION_REFERENCE', '关系端点尚未保存。')
  if (record.kind === 'relationship' || record.kind === 'route') {
    const table = record.kind === 'relationship' ? 'character_relations' : 'map_relations'
    const values: Record<string, unknown> = { novel_id: novelId, relation_label: record.label, relation_type: String(record.attributes.relationType || record.kind),
      bilateral: record.attributes.bilateral === false ? 0 : 1, description: String(record.attributes.description || record.attributes.endState || '') }
    if (record.kind === 'relationship') { values.char_a_id = fromId; values.char_b_id = toId }
    else { values.map_a_id = fromId; values.map_b_id = toId; values.travel_hours = record.attributes.travelHours ?? null; values.travel_mode = record.attributes.travelMode ?? null; values.route_open = record.attributes.routeOpen === false ? 0 : 1 }
    item.nativeId = writeRow(sqlite, table, item.nativeTable === table ? item.nativeId : null, values)
    item.nativeTable = table
  } else if (record.kind === 'ownership' && record.fromId.startsWith('character:')) {
    sqlite.prepare('UPDATE story_items SET owner_character_id=? WHERE id=? AND novel_id=?').run(fromId, toId, novelId)
  } else if (record.kind === 'presence') {
    const from = records.get(record.fromId)?.record
    if (from?.kind === 'character') {
      item.nativeTable = 'character_location_binding'
      item.nativeId = writeRow(sqlite, item.nativeTable, item.nativeTable === 'character_location_binding' ? item.nativeId : null, { novel_id: novelId, character_id: fromId, map_node_id: toId, binding_type: String(record.attributes.locationRole || 'presence'), source_type: record.source.kind, is_canonical: 1, notes: record.label })
    } else if (from?.kind === 'item') sqlite.prepare('UPDATE story_items SET location_map_id=? WHERE id=? AND novel_id=?').run(toId, fromId, novelId)
  } else if (record.kind === 'membership') {
    const row = sqlite.prepare('SELECT camp_faction_ids_json FROM characters WHERE id=? AND novel_id=?').get(fromId, novelId) as { camp_faction_ids_json: string } | undefined
    let ids: number[] = []
    try { ids = JSON.parse(row?.camp_faction_ids_json || '[]') } catch { /* New structured reference replaces malformed old data. */ }
    sqlite.prepare('UPDATE characters SET camp_faction_ids_json=? WHERE id=? AND novel_id=?').run(JSON.stringify([...new Set([...ids, toId])]), fromId, novelId)
  } else if (record.kind === 'participation' && records.get(record.fromId)?.record.kind === 'character') {
    const row = sqlite.prepare('SELECT present_character_ids_json FROM timeline_events WHERE id=? AND novel_id=?').get(toId, novelId) as { present_character_ids_json: string } | undefined
    let ids: number[] = []
    try { ids = JSON.parse(row?.present_character_ids_json || '[]') } catch { /* Keep the source-backed new reference. */ }
    sqlite.prepare('UPDATE timeline_events SET present_character_ids_json=? WHERE id=? AND novel_id=?').run(JSON.stringify([...new Set([...ids, fromId])]), toId, novelId)
  }
}

function retireNativeRelation(sqlite: Database.Database, novelId: number, item: AtlasStoredRecord): void {
  if (!item.retired || item.recordType !== 'relation' || !item.nativeId) return
  if (item.nativeTable && ['character_relations', 'map_relations', 'character_location_binding'].includes(item.nativeTable)) {
    sqlite.prepare(`DELETE FROM ${item.nativeTable} WHERE id=? AND novel_id=?`).run(item.nativeId, novelId)
  }
}

/** Derived native references are rebuilt from graph edges, including removals. */
function syncNativeReferences(sqlite: Database.Database, novelId: number, records: Map<string, AtlasStoredRecord>): void {
  const live = [...records.values()].filter((item) => !item.retired && item.record.status === 'confirmed')
  const edges = live.flatMap((item) => !isEntity(item.record) ? [item.record] : [])
  const native = (id: string) => records.get(id)?.nativeId || null
  for (const item of live) {
    if (!isEntity(item.record) || !item.nativeId) continue
    const entity = item.record
    if (entity.kind === 'character') {
      const factionIds = edges.filter((edge) => edge.kind === 'membership' && edge.fromId === entity.id).map((edge) => native(edge.toId)).filter(Boolean)
      sqlite.prepare('UPDATE characters SET camp_faction_ids_json=? WHERE id=? AND novel_id=?').run(JSON.stringify([...new Set(factionIds)]), item.nativeId, novelId)
    }
    if (entity.kind === 'item') {
      const owner = edges.find((edge) => edge.kind === 'ownership' && edge.toId === entity.id && records.get(edge.fromId)?.record.kind === 'character')
      const location = edges.find((edge) => edge.kind === 'presence' && edge.fromId === entity.id)
      sqlite.prepare('UPDATE story_items SET owner_character_id=?,location_map_id=? WHERE id=? AND novel_id=?').run(owner ? native(owner.fromId) : null, location ? native(location.toId) : null, item.nativeId, novelId)
    }
    if (entity.kind === 'event') {
      const participantIds = edges.filter((edge) => edge.kind === 'participation' && edge.toId === entity.id && records.get(edge.fromId)?.record.kind === 'character').map((edge) => native(edge.fromId)).filter(Boolean)
      sqlite.prepare('UPDATE timeline_events SET present_character_ids_json=? WHERE id=? AND novel_id=?').run(JSON.stringify([...new Set(participantIds)]), item.nativeId, novelId)
    }
  }
}

export function applyStoryAtlasChanges(input: StoryAtlasApplyInput): StoryAtlasApplyResult {
  const sqlite = getSqlite()
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const run = () => {
    const replay = sqlite.prepare('SELECT fingerprint,result_json FROM story_atlas_changes WHERE novel_id=? AND idempotency_key=?').get(input.novelId, input.idempotencyKey) as { fingerprint: string; result_json: string } | undefined
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_CONFLICT', '同一个幂等键不能对应不同变更。')
      return { ...JSON.parse(replay.result_json), idempotentReplay: true } as StoryAtlasApplyResult
    }
    const prepared = prepare(input)
    const records = new Map(prepared.records.map((record) => [record.record.id, record]))
    const pendingEntities = prepared.changed.filter((item) => item.recordType === 'entity')
    // Save parents before children even when the submitted changes are in reverse order.
    const saved = new Set<string>()
    const saveEntity = (item: AtlasStoredRecord) => {
      if (saved.has(item.record.id)) return
      const record = item.record as StoryAtlasEntity
      if (record.parentId) { const parent = pendingEntities.find((candidate) => candidate.record.id === record.parentId); if (parent) saveEntity(parent) }
      projectNative(sqlite, input.novelId, item, records)
      saved.add(item.record.id)
    }
    pendingEntities.forEach(saveEntity)
    prepared.changed.forEach((item) => retireNativeRelation(sqlite, input.novelId, item))
    prepared.changed.filter((item) => item.recordType === 'relation').forEach((item) => projectNative(sqlite, input.novelId, item, records))
    const contextVersion = markNovelContextChanged(input.novelId, 'Story atlas changed')
    prepared.changed.forEach((item) => insertAtlasRevision(sqlite, input.novelId, item, contextVersion))
    syncNativeReferences(sqlite, input.novelId, new Map(readAtlasRecords(sqlite, input.novelId, undefined, false).map((item) => [item.record.id, item])))
    const result: StoryAtlasApplyResult = { novelId: input.novelId, contextVersion, appliedIds: prepared.changed.map((item) => item.record.id), idMap: prepared.idMap, diagnostics: prepared.diagnostics, idempotentReplay: false }
    sqlite.prepare('INSERT INTO story_atlas_changes(novel_id,idempotency_key,fingerprint,result_json) VALUES (?,?,?,?)').run(input.novelId, input.idempotencyKey, fingerprint, JSON.stringify(result))
    return result
  }
  return sqlite.inTransaction ? run() : sqlite.transaction(run).immediate()
}
