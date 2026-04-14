import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  characters,
  characterArcBeats,
  characterArcs,
  factions,
  foreshadowLedger,
  novels,
  relationshipArcs,
  resistanceBeats,
  resistanceTracks,
  sceneContracts,
  storyItems,
  storyMemoryCheckpoints,
  storyThreads,
  timelineEvents,
} from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { buildNovelConsistencyReport, type ConsistencyIssue } from './consistency.service'
import { buildHeuristicRecallDiagnostics, getQualityDashboardData } from './quality-dashboard.service'

type AssetFreshnessKey = 'faction' | 'character' | 'item' | 'thread' | 'timeline'

const ASSET_FRESHNESS_GRACE_MS = 60 * 1000
const ASSET_FRESHNESS_LABELS: Record<AssetFreshnessKey, string> = {
  faction: '势力',
  character: '人物',
  item: '物品',
  thread: '故事线程',
  timeline: '时间轴',
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))]
  } catch {
    return []
  }
}

function stringifyStringArray(values: string[]): string {
  return JSON.stringify([...new Set(values.map((item) => item.trim()).filter(Boolean))])
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function parseAiScore(raw?: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const preferred = typeof parsed.overall_score === 'number'
      ? parsed.overall_score
      : typeof parsed.score === 'number'
        ? parsed.score
        : null
    return typeof preferred === 'number' && Number.isFinite(preferred) ? preferred : null
  } catch {
    return null
  }
}

function parseReviewState(raw?: string | null): {
  severity?: string
  rewriteRequired: boolean
  costEvaporation: boolean
  forcedReversal: boolean
  tooSmooth: boolean
  highPressureNoReward: boolean
} {
  if (!raw) {
    return {
      rewriteRequired: false,
      costEvaporation: false,
      forcedReversal: false,
      tooSmooth: false,
      highPressureNoReward: false,
    }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const protagonistSetback = typeof parsed.protagonist_setback === 'string' ? parsed.protagonist_setback : 'none'
    const rewardState = typeof parsed.reward_state === 'string' ? parsed.reward_state : 'none'
    const costPresent = parsed.cost_present === true
    const protagonistPressure = typeof parsed.protagonist_pressure === 'number' ? parsed.protagonist_pressure : 0
    return {
      severity: typeof parsed.severity === 'string' ? parsed.severity : undefined,
      rewriteRequired: parsed.rewrite_required === true,
      costEvaporation: parsed.cost_resolution_state === 'evaporated',
      forcedReversal: parsed.reversal_marker === true && parsed.reversal_support_state === 'forced',
      tooSmooth: protagonistSetback === 'none' && (rewardState === 'partial' || rewardState === 'major') && !costPresent,
      highPressureNoReward: (protagonistSetback === 'minor' || protagonistSetback === 'major' || protagonistPressure >= 60) && rewardState === 'none',
    }
  } catch {
    return {
      rewriteRequired: false,
      costEvaporation: false,
      forcedReversal: false,
      tooSmooth: false,
      highPressureNoReward: false,
    }
  }
}

function mergeReasons(raw: string | null | undefined, reasons: string[]): string {
  return stringifyStringArray([...parseStringArray(raw), ...reasons])
}

type ContractAuditStatus = 'pass' | 'warning' | 'blocker'

export interface ContractAuditItem {
  key: string
  label: string
  status: ContractAuditStatus
  detail: string
  source: 'chapter' | 'scene'
  segmentId?: number
  segmentTitle?: string
}

export interface ChapterContractAudit {
  checkedAt: string
  summary: string
  blockerCount: number
  warningCount: number
  passCount: number
  items: ContractAuditItem[]
}

interface ChapterContractAuditSceneSnapshot {
  segmentId?: number
  segmentOrder?: number
  segmentTitle: string
  status: string
  pov: string
  timeLocation: string
  sceneGoal: string
  obstacle: string
  resultState: string
  segmentPurpose: string
  segmentTimeAnchor: string
  segmentLocationName: string
  segmentInputState: string
  segmentOutputState: string
  hasSegmentBinding: boolean
}

interface ChapterContractAuditContext {
  chapter: typeof chapters.$inferSelect
  chapterContractRow: typeof chapterContracts.$inferSelect | null
  chapterContract: {
    chapterGoal: string
    requiredCharacterArcIds: number[]
    requiredRelationshipArcIds: number[]
    requiredResistanceTrackIds: number[]
    requiredForeshadowIds: number[]
    hookType: string
    acceptanceNotes: string[]
    status: string
  }
  sceneSnapshots: ChapterContractAuditSceneSnapshot[]
  characterRows: typeof characters.$inferSelect[]
  characterArcRows: typeof characterArcs.$inferSelect[]
  characterBeatRows: typeof characterArcBeats.$inferSelect[]
  relationshipArcRows: typeof relationshipArcs.$inferSelect[]
  resistanceTrackRows: typeof resistanceTracks.$inferSelect[]
  resistanceBeatRows: typeof resistanceBeats.$inferSelect[]
  foreshadowRows: typeof foreshadowLedger.$inferSelect[]
}

function normalizeText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeContractStatus(value?: string | null): string {
  return normalizeText(value) || 'draft'
}

function isExecutableContractStatus(value?: string | null): boolean {
  const status = normalizeContractStatus(value)
  return status === 'ready' || status === 'locked'
}

function getContractStatusLabel(value?: string | null): string {
  const status = normalizeContractStatus(value)
  if (status === 'ready') return '可执行'
  if (status === 'locked') return '锁定'
  if (status === 'draft') return '草稿'
  return status
}

function getSceneSnapshotLabel(scene: ChapterContractAuditSceneSnapshot): string {
  if (scene.segmentTitle) return scene.segmentTitle
  if (typeof scene.segmentOrder === 'number') return `场景 ${scene.segmentOrder}`
  if (typeof scene.segmentId === 'number') return `场景 #${scene.segmentId}`
  return '未命名场景'
}

function makeContractAuditItem(
  item: Omit<ContractAuditItem, 'source'> & { source?: 'chapter' | 'scene' },
): ContractAuditItem {
  return {
    source: item.source || 'chapter',
    ...item,
  }
}

function buildContractAuditSummary(items: ContractAuditItem[]): Pick<ChapterContractAudit, 'summary' | 'blockerCount' | 'warningCount' | 'passCount'> {
  const blockerCount = items.filter((item) => item.status === 'blocker').length
  const warningCount = items.filter((item) => item.status === 'warning').length
  const passCount = items.filter((item) => item.status === 'pass').length
  const summary = blockerCount > 0
    ? `合同对账命中 ${blockerCount} 项阻塞，${warningCount} 项预警。`
    : warningCount > 0
      ? `合同对账已通过，但仍有 ${warningCount} 项预警。`
      : `合同对账已通过，共核对 ${items.length} 项。`
  return {
    summary,
    blockerCount,
    warningCount,
    passCount,
  }
}

function loadChapterContractAuditContext(chapterId: number): ChapterContractAuditContext {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const chapterContractRow = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const segmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const sceneContractBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  sceneRows.forEach((row) => {
    if (typeof row.segmentId === 'number' && !sceneContractBySegmentId.has(row.segmentId)) {
      sceneContractBySegmentId.set(row.segmentId, row)
    }
  })

  const sceneSnapshots: ChapterContractAuditSceneSnapshot[] = [
    ...segmentRows.map((segment) => {
      const contract = sceneContractBySegmentId.get(segment.id) || null
      return {
        segmentId: segment.id,
        segmentOrder: segment.segmentOrder,
        segmentTitle: normalizeText(segment.title) || `场景 ${segment.segmentOrder}`,
        status: normalizeContractStatus(contract?.status),
        pov: normalizeText(contract?.pov),
        timeLocation: normalizeText(contract?.timeLocation),
        sceneGoal: normalizeText(contract?.sceneGoal) || normalizeText(segment.purpose),
        obstacle: normalizeText(contract?.obstacle),
        resultState: normalizeText(contract?.resultState) || normalizeText(segment.outputState),
        segmentPurpose: normalizeText(segment.purpose),
        segmentTimeAnchor: normalizeText(segment.timeAnchor),
        segmentLocationName: normalizeText(segment.locationName),
        segmentInputState: normalizeText(segment.inputState),
        segmentOutputState: normalizeText(segment.outputState),
        hasSegmentBinding: true,
      }
    }),
    ...sceneRows
      .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
      .map((row) => ({
        segmentId: row.segmentId ?? undefined,
        segmentOrder: undefined,
        segmentTitle: `场景合同 ${row.id}`,
        status: normalizeContractStatus(row.status),
        pov: normalizeText(row.pov),
        timeLocation: normalizeText(row.timeLocation),
        sceneGoal: normalizeText(row.sceneGoal),
        obstacle: normalizeText(row.obstacle),
        resultState: normalizeText(row.resultState),
        segmentPurpose: '',
        segmentTimeAnchor: '',
        segmentLocationName: '',
        segmentInputState: '',
        segmentOutputState: '',
        hasSegmentBinding: false,
      })),
  ]

  const requiredCharacterArcIds = parseNumberArray(chapterContractRow?.requiredCharacterArcIdsJson)
  const requiredRelationshipArcIds = parseNumberArray(chapterContractRow?.requiredRelationshipArcIdsJson)
  const requiredResistanceTrackIds = parseNumberArray(chapterContractRow?.requiredResistanceTrackIdsJson)
  const requiredForeshadowIds = parseNumberArray(chapterContractRow?.requiredForeshadowIdsJson)

  const characterArcRows = requiredCharacterArcIds.length > 0
    ? db.select().from(characterArcs).where(eq(characterArcs.novelId, chapter.novelId)).all()
      .filter((row) => requiredCharacterArcIds.includes(row.id))
    : []
  const characterBeatRows = requiredCharacterArcIds.length > 0
    ? db.select().from(characterArcBeats).where(eq(characterArcBeats.chapterId, chapterId)).all()
      .filter((row) => requiredCharacterArcIds.includes(row.arcId))
    : []
  const relationshipArcRows = requiredRelationshipArcIds.length > 0
    ? db.select().from(relationshipArcs).where(eq(relationshipArcs.novelId, chapter.novelId)).all()
      .filter((row) => requiredRelationshipArcIds.includes(row.id))
    : []
  const needsCharacterRows = characterArcRows.length > 0 || relationshipArcRows.length > 0
  const characterRows = needsCharacterRows
    ? db.select().from(characters).where(eq(characters.novelId, chapter.novelId)).all()
    : []
  const resistanceTrackRows = requiredResistanceTrackIds.length > 0
    ? db.select().from(resistanceTracks).where(eq(resistanceTracks.novelId, chapter.novelId)).all()
      .filter((row) => requiredResistanceTrackIds.includes(row.id))
    : []
  const resistanceBeatRows = requiredResistanceTrackIds.length > 0
    ? db.select().from(resistanceBeats).where(eq(resistanceBeats.chapterId, chapterId)).all()
      .filter((row) => requiredResistanceTrackIds.includes(row.trackId))
    : []
  const foreshadowRows = requiredForeshadowIds.length > 0
    ? db.select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, chapter.novelId)).all()
      .filter((row) => requiredForeshadowIds.includes(row.id))
    : []

  return {
    chapter,
    chapterContractRow,
    chapterContract: {
      chapterGoal: normalizeText(chapterContractRow?.chapterGoal),
      requiredCharacterArcIds,
      requiredRelationshipArcIds,
      requiredResistanceTrackIds,
      requiredForeshadowIds,
      hookType: normalizeText(chapterContractRow?.hookType),
      acceptanceNotes: parseStringArray(chapterContractRow?.acceptanceNotesJson),
      status: normalizeContractStatus(chapterContractRow?.status),
    },
    sceneSnapshots,
    characterRows,
    characterArcRows,
    characterBeatRows,
    relationshipArcRows,
    resistanceTrackRows,
    resistanceBeatRows,
    foreshadowRows,
  }
}

export function validateChapterContractsForGeneration(chapterId: number): void {
  const context = loadChapterContractAuditContext(chapterId)
  const blockers: string[] = []

  if (!context.chapterContractRow) {
    blockers.push('当前章节还没有章节合同。')
  } else {
    if (!isExecutableContractStatus(context.chapterContract.status)) {
      blockers.push(`章节合同状态仍是${getContractStatusLabel(context.chapterContract.status)}。`)
    }
    if (!context.chapterContract.chapterGoal) {
      blockers.push('章节合同缺少“本章目标”。')
    }
  }

  context.sceneSnapshots.forEach((scene) => {
    if (!isExecutableContractStatus(scene.status)) {
      blockers.push(`${getSceneSnapshotLabel(scene)} 的场景合同状态仍是${getContractStatusLabel(scene.status)}。`)
    }
    const missingFields = [
      !scene.pov ? 'POV' : '',
      !scene.sceneGoal ? '场景目标' : '',
      !scene.obstacle ? '障碍' : '',
      !scene.resultState ? '结果状态' : '',
    ].filter(Boolean)
    if (missingFields.length > 0) {
      blockers.push(`${getSceneSnapshotLabel(scene)} 缺少${missingFields.join('、')}。`)
    }
  })

  if (blockers.length > 0) {
    throw new Error(`章节流水线启动前合同校验未通过：${blockers.join('；')}`)
  }
}

function buildChapterContractAudit(chapterId: number): ChapterContractAudit {
  const context = loadChapterContractAuditContext(chapterId)
  const items: ContractAuditItem[] = []
  const checkedAt = new Date().toISOString()

  if (!context.chapterContractRow) {
    items.push(makeContractAuditItem({
      key: 'chapter_contract_exists',
      label: '章节合同',
      status: 'blocker',
      detail: '当前章节还没有独立章节合同。',
    }))
  } else {
    items.push(makeContractAuditItem({
      key: 'chapter_contract_status',
      label: '章节合同状态',
      status: isExecutableContractStatus(context.chapterContract.status) ? 'pass' : 'blocker',
      detail: isExecutableContractStatus(context.chapterContract.status)
        ? `章节合同已进入${getContractStatusLabel(context.chapterContract.status)}状态。`
        : `章节合同当前仍是${getContractStatusLabel(context.chapterContract.status)}，发布前应切到“可执行”或“锁定”。`,
    }))
  }

  items.push(makeContractAuditItem({
    key: 'chapter_contract_goal',
    label: '本章目标',
    status: context.chapterContract.chapterGoal ? 'pass' : 'blocker',
    detail: context.chapterContract.chapterGoal
      ? `已写明本章目标：${context.chapterContract.chapterGoal}`
      : '章节合同缺少“本章目标”，当前无法核对本章是否完成核心承诺。',
  }))

  items.push(makeContractAuditItem({
    key: 'chapter_contract_hook',
    label: '结尾钩子',
    status: context.chapterContract.hookType ? 'pass' : 'warning',
    detail: context.chapterContract.hookType
      ? `已定义结尾钩子：${context.chapterContract.hookType}`
      : '章节合同还没有填写结尾钩子类型，写后难以核对本章留钩是否兑现。',
  }))

  items.push(makeContractAuditItem({
    key: 'chapter_contract_acceptance',
    label: '章节验收要求',
    status: context.chapterContract.acceptanceNotes.length > 0 ? 'pass' : 'warning',
    detail: context.chapterContract.acceptanceNotes.length > 0
      ? `已登记 ${context.chapterContract.acceptanceNotes.length} 条章节验收要求。`
      : '章节合同还没有填写验收要求，当前只能核对结构化推进，无法核对人工验收口径。',
  }))

  const characterNameById = new Map(context.characterRows.map((row) => [row.id, normalizeText(row.fullName) || `角色#${row.id}`]))
  const characterArcById = new Map(context.characterArcRows.map((row) => [row.id, row]))
  const characterBeatArcIds = new Set(context.characterBeatRows.map((row) => row.arcId))
  context.chapterContract.requiredCharacterArcIds.forEach((arcId) => {
    const arc = characterArcById.get(arcId)
    const arcLabel = arc ? (characterNameById.get(arc.characterId) || `角色#${arc.characterId}`) : `#${arcId}`
    items.push(makeContractAuditItem({
      key: `character_arc_${arcId}`,
      label: `人物弧推进 · ${arcLabel}`,
      status: !arc
        ? 'blocker'
        : arc.lastProgressChapterId === context.chapter.id || characterBeatArcIds.has(arcId)
          ? 'pass'
          : 'blocker',
      detail: !arc
        ? '合同绑定的人物弧已不存在，需要回到人物弧线中心或章节合同重新绑定。'
        : arc.lastProgressChapterId === context.chapter.id || characterBeatArcIds.has(arcId)
          ? `本章已登记“${arcLabel}”的人物弧推进。`
          : `合同要求本章推进“${arcLabel}”的人物弧，但还没有本章推进记录。`,
    }))
  })

  const relationshipArcById = new Map(context.relationshipArcRows.map((row) => [row.id, row]))
  context.chapterContract.requiredRelationshipArcIds.forEach((arcId) => {
    const arc = relationshipArcById.get(arcId)
    const label = arc
      ? `${characterNameById.get(arc.charAId) || `角色#${arc.charAId}`} × ${characterNameById.get(arc.charBId) || `角色#${arc.charBId}`}`
      : `#${arcId}`
    items.push(makeContractAuditItem({
      key: `relationship_arc_${arcId}`,
      label: `关系弧推进 · ${label}`,
      status: !arc
        ? 'blocker'
        : arc.lastProgressChapterId === context.chapter.id
          ? 'pass'
          : 'blocker',
      detail: !arc
        ? '合同绑定的关系弧已不存在，需要回到人物弧线中心或章节合同重新绑定。'
        : arc.lastProgressChapterId === context.chapter.id
          ? `本章已登记关系弧“${label}”的推进。`
          : `合同要求本章推进关系弧“${label}”，但还没有本章推进记录。`,
    }))
  })

  const resistanceTrackById = new Map(context.resistanceTrackRows.map((row) => [row.id, row]))
  const resistanceBeatTrackIds = new Set(context.resistanceBeatRows.map((row) => row.trackId))
  context.chapterContract.requiredResistanceTrackIds.forEach((trackId) => {
    const track = resistanceTrackById.get(trackId)
    items.push(makeContractAuditItem({
      key: `resistance_track_${trackId}`,
      label: `阻力线出手 · ${normalizeText(track?.title) || `#${trackId}`}`,
      status: !track
        ? 'blocker'
        : track.lastActionChapterId === context.chapter.id || resistanceBeatTrackIds.has(trackId)
          ? 'pass'
          : 'blocker',
      detail: !track
        ? '合同绑定的阻力线已不存在，需要回到阻力系统或章节合同重新绑定。'
        : track.lastActionChapterId === context.chapter.id || resistanceBeatTrackIds.has(trackId)
          ? `本章已登记阻力线“${normalizeText(track.title) || '未命名阻力线'}”的出手记录。`
          : `合同要求本章让阻力线“${normalizeText(track.title) || '未命名阻力线'}”出手，但还没有本章出手记录。`,
    }))
  })

  const foreshadowById = new Map(context.foreshadowRows.map((row) => [row.id, row]))
  context.chapterContract.requiredForeshadowIds.forEach((entryId) => {
    const entry = foreshadowById.get(entryId)
    const normalizedStatus = normalizeContractStatus(entry?.status)
    const plantedHere = entry?.sourceChapterId === context.chapter.id
    const resolved = normalizedStatus === 'resolved' || normalizedStatus === 'archived'
    items.push(makeContractAuditItem({
      key: `foreshadow_${entryId}`,
      label: `伏笔账本 · ${normalizeText(entry?.title) || `#${entryId}`}`,
      status: !entry
        ? 'blocker'
        : plantedHere || resolved
          ? 'pass'
          : 'blocker',
      detail: !entry
        ? '合同绑定的伏笔账本条目已不存在，需要回到伏笔账本或章节合同重新绑定。'
        : plantedHere
          ? '该伏笔已登记为本章埋设。'
          : resolved
            ? `该伏笔当前状态为“${normalizedStatus === 'resolved' ? '已回收' : '已归档'}”，已形成处理痕迹。`
            : '合同要求本章处理该伏笔，但当前账本里还没有识别到“本章埋设”或“已回收/已归档”痕迹。',
    }))
  })

  if (context.sceneSnapshots.length === 0) {
    items.push(makeContractAuditItem({
      key: 'scene_contracts_not_applicable',
      label: '场景合同对账',
      status: 'pass',
      detail: '当前章节未拆场景，本次不适用场景合同对账。',
    }))
  } else {
    context.sceneSnapshots.forEach((scene, index) => {
      const sceneLabel = getSceneSnapshotLabel(scene)
      const sceneKey = scene.segmentId ?? index
      const missingFields = [
        !scene.pov ? 'POV' : '',
        !scene.sceneGoal ? '场景目标' : '',
        !scene.obstacle ? '障碍' : '',
        !scene.resultState ? '结果状态' : '',
      ].filter(Boolean)
      const mappingGaps = [
        !(scene.timeLocation || scene.segmentTimeAnchor || scene.segmentLocationName) ? '时间地点映射' : '',
        !(scene.sceneGoal || scene.segmentPurpose) ? '目标映射' : '',
        !(scene.resultState || scene.segmentOutputState) ? '结果状态映射' : '',
      ].filter(Boolean)

      items.push(makeContractAuditItem({
        key: `scene_status_${sceneKey}`,
        label: `场景合同状态 · ${sceneLabel}`,
        status: isExecutableContractStatus(scene.status) ? 'pass' : 'blocker',
        detail: isExecutableContractStatus(scene.status)
          ? `场景合同已进入${getContractStatusLabel(scene.status)}状态。`
          : `当前场景合同仍是${getContractStatusLabel(scene.status)}，发布前应切到“可执行”或“锁定”。`,
        source: 'scene',
        segmentId: scene.segmentId,
        segmentTitle: sceneLabel,
      }))

      items.push(makeContractAuditItem({
        key: `scene_fields_${sceneKey}`,
        label: `场景字段完整性 · ${sceneLabel}`,
        status: missingFields.length === 0 ? 'pass' : 'blocker',
        detail: missingFields.length === 0
          ? 'POV、场景目标、障碍和结果状态都已齐备。'
          : `当前场景还缺少：${missingFields.join('、')}。`,
        source: 'scene',
        segmentId: scene.segmentId,
        segmentTitle: sceneLabel,
      }))

      items.push(makeContractAuditItem({
        key: `scene_mapping_${sceneKey}`,
        label: `结构映射 · ${sceneLabel}`,
        status: !scene.hasSegmentBinding
          ? 'warning'
          : mappingGaps.length === 0
            ? 'pass'
            : 'warning',
        detail: !scene.hasSegmentBinding
          ? '该场景合同还没有绑定结构场景，后续很难从结构页追溯到正文场景。'
          : mappingGaps.length === 0
            ? '场景合同与结构字段已形成可追溯映射。'
            : `结构字段仍缺少：${mappingGaps.join('、')}。`,
        source: 'scene',
        segmentId: scene.segmentId,
        segmentTitle: sceneLabel,
      }))
    })
  }

  const summary = buildContractAuditSummary(items)
  return {
    checkedAt,
    summary: summary.summary,
    blockerCount: summary.blockerCount,
    warningCount: summary.warningCount,
    passCount: summary.passCount,
    items,
  }
}

export interface NovelContextStatus {
  novelId: number
  contextVersion: number
  totalChapterCount: number
  staleChapterCount: number
  staleChapterIds: number[]
  staleCheckpointCount: number
  staleAssetCount: number
  staleAssetKeys: AssetFreshnessKey[]
  staleAssetLabels: string[]
}

function parseIsoTime(raw?: string | null): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function collectLatestUpdatedAt(rows: Array<{ updatedAt?: string | null }>): number | null {
  return rows.reduce<number | null>((latest, row) => {
    const next = parseIsoTime(row.updatedAt)
    if (next === null) return latest
    return latest === null ? next : Math.max(latest, next)
  }, null)
}

export interface ChapterPublishCheckItem {
  key: string
  label: string
  status: 'pass' | 'warning' | 'blocker'
  detail: string
}

export interface ChapterPublishCheck {
  chapterId: number
  chapterNum: number
  ready: boolean
  summary: string
  blockerCount: number
  warningCount: number
  staleReasons: string[]
  chapterContextVersion: number
  novelContextVersion: number
  checklist: ChapterPublishCheckItem[]
  contractAudit: ChapterContractAudit
}

export function getNovelContextStatus(novelId: number): NovelContextStatus {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const staleChapterIds = chapterRows
    .filter((chapter) => parseStringArray(chapter.staleReasonJson).length > 0)
    .map((chapter) => chapter.id)
  const staleCheckpointCount = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
    .filter((checkpoint) => checkpoint.stale === 1 || (checkpoint.version || 1) < (novel.contextVersion || 1))
    .length
  const novelUpdatedAt = parseIsoTime(novel.updatedAt)
  const assetRows = {
    faction: db.select().from(factions).where(eq(factions.novelId, novelId)).all(),
    character: db.select().from(characters).where(eq(characters.novelId, novelId)).all(),
    item: db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all(),
    thread: db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
    timeline: db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
  }
  const staleAssetKeys = (Object.keys(assetRows) as AssetFreshnessKey[]).filter((key) => {
    if (assetRows[key].length === 0 || novelUpdatedAt === null) return false
    const latestUpdatedAt = collectLatestUpdatedAt(assetRows[key])
    if (latestUpdatedAt === null) return false
    return (novelUpdatedAt - latestUpdatedAt) > ASSET_FRESHNESS_GRACE_MS
  })

  return {
    novelId,
    contextVersion: novel.contextVersion || 1,
    totalChapterCount: chapterRows.length,
    staleChapterCount: staleChapterIds.length,
    staleChapterIds,
    staleCheckpointCount,
    staleAssetCount: staleAssetKeys.length,
    staleAssetKeys,
    staleAssetLabels: staleAssetKeys.map((key) => ASSET_FRESHNESS_LABELS[key]),
  }
}

export function markNovelContextChanged(novelId: number, reasons: string | string[]): number {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((item) => item.trim())
    .filter(Boolean))]
  if (normalizedReasons.length === 0) {
    return novel.contextVersion || 1
  }

  const nextVersion = (novel.contextVersion || 1) + 1
  const now = new Date().toISOString()

  getSqlite().transaction(() => {
    db.update(novels).set({
      contextVersion: nextVersion,
      updatedAt: now,
    }).where(eq(novels.id, novelId)).run()

    const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    for (const chapter of chapterRows) {
      db.update(chapters).set({
        staleReasonJson: mergeReasons(chapter.staleReasonJson, normalizedReasons),
        updatedAt: now,
      }).where(eq(chapters.id, chapter.id)).run()
    }

    markStoryMemoryCheckpointsDirty(novelId, now)
  })()

  return nextVersion
}

export function markStoryMemoryCheckpointsDirty(novelId: number, updatedAt = new Date().toISOString()): void {
  const db = getDb()
  db.update(storyMemoryCheckpoints).set({
    stale: 1,
    updatedAt,
  }).where(eq(storyMemoryCheckpoints.novelId, novelId)).run()
}

export function markSubsequentChaptersStale(
  novelId: number,
  chapterNum: number,
  reasons: string | string[],
): void {
  const db = getDb()
  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((item) => item.trim())
    .filter(Boolean))]
  if (normalizedReasons.length === 0) return

  const now = new Date().toISOString()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.chapterNum > chapterNum)

  if (chapterRows.length === 0) return

  getSqlite().transaction(() => {
    for (const chapter of chapterRows) {
      db.update(chapters).set({
        staleReasonJson: mergeReasons(chapter.staleReasonJson, normalizedReasons),
        updatedAt: now,
      }).where(eq(chapters.id, chapter.id)).run()
    }
  })()
}

export function markChapterContextCurrent(chapterId: number): void {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  db.update(chapters).set({
    contextVersion: novel.contextVersion || 1,
    staleReasonJson: JSON.stringify([]),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
}

function collectChapterRelatedIssues(
  novelId: number,
  chapterId: number,
  chapterNum: number,
): ConsistencyIssue[] {
  const db = getDb()
  const report = buildNovelConsistencyReport(novelId)
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const currentChapter = chapterRows.find((item) => item.id === chapterId)
  const chapterIdToNum = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const relatedEvents = eventRows.filter((event) => {
    if (currentChapter?.partId && event.partId === currentChapter.partId) return true
    if (currentChapter?.volumeId && event.volumeId === currentChapter.volumeId) return true
    if (event.chapterStartId === chapterId || event.chapterEndId === chapterId) return true
    const startNum = event.chapterStartId ? chapterIdToNum.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterIdToNum.get(event.chapterEndId) : undefined
    return typeof startNum === 'number' && typeof endNum === 'number'
      ? chapterNum >= startNum && chapterNum <= endNum
      : typeof startNum === 'number'
        ? chapterNum === startNum
        : typeof endNum === 'number'
          ? chapterNum === endNum
          : false
  })
  const relatedEventIds = new Set(relatedEvents.map((event) => event.id))
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const relatedItems = itemRows.filter((item) =>
    parseNumberArray(item.linkedTimelineEventIdsJson).some((id) => relatedEventIds.has(id)))
  const relatedItemIds = new Set(relatedItems.map((item) => item.id))

  return report.issues.filter((issue) =>
    ((issue.entityType === 'chapter' || issue.category === 'continuity') && issue.entityId === chapterId)
    || (issue.entityType === 'timeline' && issue.entityId ? relatedEventIds.has(issue.entityId) : false)
    || (issue.entityType === 'item' && issue.entityId ? relatedItemIds.has(issue.entityId) : false))
}

export function runChapterPublishCheck(chapterId: number): ChapterPublishCheck {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const staleReasons = parseStringArray(chapter.staleReasonJson)
  const consistencyIssues = collectChapterRelatedIssues(chapter.novelId, chapter.id, chapter.chapterNum)
  const highIssues = consistencyIssues.filter((issue) => issue.severity === 'high')
  const mediumIssues = consistencyIssues.filter((issue) => issue.severity === 'medium')
  const aiScore = parseAiScore(chapter.aiScoreJson)
  const reviewState = parseReviewState(chapter.reviewNotesJson)
  const qualityDashboard = getQualityDashboardData(chapter.novelId, { includeDialogueInsights: false })
  const recallDiagnostics = buildHeuristicRecallDiagnostics(chapter.novelId, {
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    summary: chapter.summary,
    outline: chapter.outline,
  })
  const contractAudit = buildChapterContractAudit(chapterId)
  const contractAuditJson = JSON.stringify(contractAudit)
  if (chapter.contractAuditJson !== contractAuditJson) {
    db.update(chapters).set({
      contractAuditJson,
    }).where(eq(chapters.id, chapterId)).run()
  }
  const storyAlerts = qualityDashboard.storyPacingAlerts
    .filter((alert) => alert.chapterNums.includes(chapter.chapterNum))
    .slice(0, 3)

  const checklist: ChapterPublishCheckItem[] = [
    {
      key: 'content',
      label: '正文已完成',
      status: chapter.content?.trim() ? 'pass' : 'blocker',
      detail: chapter.content?.trim() ? '当前章节已有正文。' : '当前章节还没有正文内容。',
    },
    {
      key: 'summary',
      label: '摘要已刷新',
      status: chapter.summary?.trim() ? 'pass' : 'blocker',
      detail: chapter.summary?.trim() ? '章节摘要已经生成。' : '需要先刷新摘要和后续承接信息。',
    },
    {
      key: 'continuity',
      label: '连续性记忆已更新',
      status: chapter.continuityStateJson?.trim() ? 'pass' : 'blocker',
      detail: chapter.continuityStateJson?.trim() ? '连续性记忆可用于后文承接。' : '需要先补齐连续性记忆。',
    },
    {
      key: 'context',
      label: '上下文未过期',
      status: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1) ? 'pass' : 'blocker',
      detail: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1)
        ? '章节上下文与当前全书版本一致。'
        : `需要先处理这些过期原因：${staleReasons.join('；') || '上下文版本落后于当前设定。'}`,
    },
    {
      key: 'consistency',
      label: '无高优先级结构风险',
      status: highIssues.length === 0 ? 'pass' : 'blocker',
      detail: highIssues.length === 0
        ? '没有命中当前章节的高优先级结构问题。'
        : highIssues.slice(0, 3).map((issue) => issue.title).join('；'),
    },
    {
      key: 'ai_score',
      label: 'AI 体检已完成',
      status: typeof aiScore === 'number' ? (aiScore >= 60 ? 'pass' : 'warning') : 'warning',
      detail: typeof aiScore === 'number'
        ? `当前 AI 体检分数为 ${aiScore}。`
        : '还没有执行 AI 体检，建议在发布前跑一次。',
    },
    {
      key: 'review',
      label: '审校意见已处理',
      status: reviewState.rewriteRequired || reviewState.severity === 'high' ? 'warning' : 'pass',
      detail: reviewState.rewriteRequired || reviewState.severity === 'high'
        ? '当前审校结果仍建议重写或存在高风险意见。'
        : '当前没有需要强制处理的审校意见。',
    },
    {
      key: 'story_dynamics',
      label: '主角与节奏风险可控',
      status: reviewState.costEvaporation
        || reviewState.forcedReversal
        || reviewState.tooSmooth
        || reviewState.highPressureNoReward
        || storyAlerts.length > 0
        ? 'warning'
        : 'pass',
      detail: reviewState.costEvaporation
        ? '当前章节存在代价蒸发迹象，建议把损失或后果延续写实。'
        : reviewState.forcedReversal
          ? '当前章节出现支撑不足的反转，建议补齐触发原因和前文铺垫。'
          : reviewState.tooSmooth
            ? '当前章节主角几乎无成本顺推，建议补出真实阻力、失误或损失。'
            : reviewState.highPressureNoReward
              ? '当前章节持续施压却没有阶段回报，建议补入喘息、收获或反击兑现。'
              : storyAlerts.length > 0
                ? storyAlerts.map((alert) => alert.title).join('；')
                : '当前没有命中明显的主角与节奏结构告警。',
    },
    {
      key: 'scene_plan',
      label: '场景计划可追溯',
      status: chapter.scenePlanJson?.trim() ? 'pass' : 'warning',
      detail: chapter.scenePlanJson?.trim() ? '可以追溯到当前章节的场景拆解。' : '当前缺少场景计划，后续排查承接问题会更难。',
    },
    {
      key: 'recall',
      label: '召回补充未依赖过期片段',
      status: recallDiagnostics.staleRecallCount > 0 ? 'warning' : 'pass',
      detail: recallDiagnostics.staleRecallCount > 0
        ? `识别到 ${recallDiagnostics.staleRecallCount} 条疑似过期召回片段。召回只应作为背景补充，建议优先以硬约束和结构化状态回查。`
        : '当前未识别到疑似过期的召回背景片段。',
    },
    {
      key: 'outline',
      label: '章节大纲存在',
      status: chapter.outline?.trim() ? 'pass' : 'warning',
      detail: chapter.outline?.trim() ? '章节大纲已保留。' : '当前章节缺少明确大纲，建议补齐后再标记完成。',
    },
    {
      key: 'medium_issues',
      label: '中优先级风险可控',
      status: mediumIssues.length <= 2 ? 'pass' : 'warning',
      detail: mediumIssues.length <= 2
        ? '没有堆积过多中优先级结构问题。'
        : mediumIssues.slice(0, 3).map((issue) => issue.title).join('；'),
    },
  ]

  const blockerCount = checklist.filter((item) => item.status === 'blocker').length + contractAudit.blockerCount
  const warningCount = checklist.filter((item) => item.status === 'warning').length + contractAudit.warningCount

  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    ready: blockerCount === 0,
    summary: blockerCount === 0
      ? warningCount === 0
        ? '当前章节可以直接标记为完成。'
        : '当前章节可以发布，但还有若干建议先处理的风险。'
      : contractAudit.blockerCount > 0
        ? '当前章节还不能标记为完成，请先处理合同对账或其他阻塞项。'
        : '当前章节还不能标记为完成，请先处理阻塞项。',
    blockerCount,
    warningCount,
    staleReasons,
    chapterContextVersion: chapter.contextVersion || 1,
    novelContextVersion: novel.contextVersion || 1,
    checklist,
    contractAudit,
  }
}
