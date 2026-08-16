import { asc, eq } from 'drizzle-orm'
import type { ChapterContractValidationResult } from '../../src/types'
import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  characters,
  characterArcBeats,
  characterArcs,
  foreshadowLedger,
  relationshipArcs,
  resistanceBeats,
  resistanceTracks,
  sceneContracts,
} from '../database/schema'
import {
  deriveChapterContractValidationStatus,
  isContractValidationBlockerVerdict as isContractValidationBlockerVerdictValue,
  isContractValidationWarningVerdict as isContractValidationWarningVerdictValue,
  isHardContractValidationItem,
} from '../../src/shared/contract-validation'
import {
  normalizeSemanticGateReview,
  type SemanticGateDimension,
} from '../../src/shared/semantic-gate'
import { CORE_SEMANTIC_GATE_DIMENSIONS } from '../../src/shared/semantic-gate-policy'
import { throwUserFacingError } from '../utils/user-facing-error'
import { getContractValidationScore } from './chapter-contract-validator.service'
import {
  dedupeTextList,
  normalizeText,
  parseNumberArray,
  parseStringArray,
  type ChapterContractAudit,
  type ChapterContractAuditContext,
  type ChapterContractAuditSceneSnapshot,
  type ContractAuditItem,
} from './chapter-publish-types'

export function normalizeContractStatus(value?: string | null): string {
  return normalizeText(value) || 'draft'
}

export function isExecutableContractStatus(value?: string | null): boolean {
  const status = normalizeContractStatus(value)
  return status === 'ready' || status === 'locked'
}

export function getContractStatusLabel(value?: string | null): string {
  const status = normalizeContractStatus(value)
  if (status === 'ready') return '可执行'
  if (status === 'locked') return '锁定'
  if (status === 'draft') return '草稿'
  return status
}

export function getSceneSnapshotLabel(scene: ChapterContractAuditSceneSnapshot): string {
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

export function loadChapterContractAuditContext(chapterId: number): ChapterContractAuditContext {
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
        emotionShift: normalizeText(contract?.emotionShift),
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
        emotionShift: normalizeText(row.emotionShift),
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
  const servedThreadIds = parseNumberArray(chapterContractRow?.servedThreadIdsJson)
  const requiredArcProgress = parseStringArray(chapterContractRow?.requiredArcProgressJson)
  const requiredEndgameCommitmentIds = parseNumberArray(chapterContractRow?.requiredEndgameCommitmentIdsJson)
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
      openingStyle: normalizeText(chapterContractRow?.openingStyle),
      endingStyle: normalizeText(chapterContractRow?.endingStyle),
      expositionMode: normalizeText(chapterContractRow?.expositionMode),
      emotionFocus: normalizeText(chapterContractRow?.emotionFocus),
      servedThreadIds,
      requiredArcProgress,
      requiredCharacterArcIds,
      requiredRelationshipArcIds,
      requiredResistanceTrackIds,
      requiredEndgameCommitmentIds,
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

export function getChapterContractBlockers(chapterId: number): string[] {
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

  return blockers
}

export function validateChapterContractsForGeneration(chapterId: number): void {
  const blockers = getChapterContractBlockers(chapterId)
  if (blockers.length > 0) {
    throw new Error(`章节流水线启动前合同校验未通过：${blockers.join('；')}`)
  }
}

export function buildChapterContractAudit(chapterId: number): ChapterContractAudit {
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

type ContractValidationItemSnapshot = ChapterContractValidationResult['itemResults'][number]

function isContractValidationBlockingVerdict(item: ContractValidationItemSnapshot): boolean {
  return isContractValidationBlockerVerdictValue(item.verdict)
}

function isContractValidationWarningVerdict(item: ContractValidationItemSnapshot): boolean {
  return isContractValidationWarningVerdictValue(item.verdict)
}

function isContractValidationIssue(item: ContractValidationItemSnapshot): boolean {
  return isContractValidationBlockingVerdict(item) || isContractValidationWarningVerdict(item)
}

function isSoftContractValidationItem(item: ContractValidationItemSnapshot): boolean {
  return !isHardContractValidationItem(item)
}

function contractValidationItemIssueLine(item: ContractValidationItemSnapshot): string {
  return normalizeText(item.rewriteHint)
    || normalizeText(item.semanticReason)
    || normalizeText(item.evidenceExcerpt)
    || normalizeText(item.expected)
}

export function getContractValidationIssuesByType(
  contractValidation: ChapterContractValidationResult | null | undefined,
  contractItemType: string,
): string[] {
  return dedupeTextList((contractValidation?.itemResults || [])
    .filter((item) => item.contractItemType === contractItemType && isContractValidationIssue(item))
    .map(contractValidationItemIssueLine))
}

export function buildHardContractValidationResult(
  result: ChapterContractValidationResult | null,
  options: { verifiedSemanticPassDimensions?: Set<SemanticGateDimension> } = {},
): ChapterContractValidationResult | null {
  if (!result) return null
  const verifiedSemanticPassDimensions = options.verifiedSemanticPassDimensions || new Set<SemanticGateDimension>()
  const semanticReconciledItems = result.itemResults.filter((item) => (
    !isSoftContractValidationItem(item)
    && isContractValidationBlockingVerdict(item)
    && item.contractItemType !== 'chapter_hook'
    && (
      verifiedSemanticPassDimensions.has('contract_delivery')
      || (
        verifiedSemanticPassDimensions.has('structural_beat')
        && (item.contractItemType === 'scene_conflict' || item.contractItemType === 'scene_result_state')
      )
    )
  ))
  const hardItems = result.itemResults.filter((item) => (
    !isSoftContractValidationItem(item)
    && !semanticReconciledItems.includes(item)
  ))
  const hardBlockerCount = hardItems.filter(isContractValidationBlockingVerdict).length
  const hardWarningCount = hardItems.filter(isContractValidationWarningVerdict).length
  const status = deriveChapterContractValidationStatus(hardItems)
  const softIssueCount = result.itemResults
    .filter((item) => isSoftContractValidationItem(item) && isContractValidationIssue(item))
    .length
  const summary = status === 'blocker'
    ? `正文合同硬性验证命中 ${hardBlockerCount} 项阻塞，${hardWarningCount} 项预警。`
    : status === 'warning'
      ? `正文合同硬性验证仍有 ${hardWarningCount} 项预警。`
      : semanticReconciledItems.length > 0
        ? `正文合同硬性验证已通过；语义门已用正文证据复核并接管 ${semanticReconciledItems.length} 项关键词阻塞。`
      : softIssueCount > 0
        ? `正文合同硬性验证已通过；标题贴合与黄金三章开篇由专项门禁处理。`
        : result.summary

  return {
    ...result,
    status,
    summary,
    itemResults: hardItems,
    rewriteHints: hardItems
      .filter(isContractValidationIssue)
      .map((item) => item.rewriteHint)
      .filter(Boolean),
  }
}

/**
 * 只允许真实的 enforce 语义评审接管启发式合同 blocker：
 * - 评审本身必须成功且 mode=enforce；
 * - verdict 必须是 pass；
 * - 至少保留一条经过 normalizeSemanticGateReview 回指正文的证据。
 *
 * 这样 shadow/off 仍保留关键词门原行为；没有证据的模型 pass 也不会放行。
 */
export function getVerifiedSemanticPassDimensions(
  review: {
    mode?: string | null
    failed?: number | null
    verdictsJson?: string | null
  } | null | undefined,
  chapterContent: string,
): Set<SemanticGateDimension> {
  if (!review || review.mode !== 'enforce' || review.failed !== 0 || !chapterContent.trim()) {
    return new Set<SemanticGateDimension>()
  }
  let verdicts: unknown
  try {
    verdicts = JSON.parse(review.verdictsJson || '[]')
  } catch {
    return new Set<SemanticGateDimension>()
  }
  const normalized = normalizeSemanticGateReview({
    chapterContent,
    dimensions: CORE_SEMANTIC_GATE_DIMENSIONS,
    parsedPayload: { verdicts },
  })
  return new Set(normalized.verdicts
    .filter((verdict) => verdict.status === 'pass' && verdict.evidence.length > 0 && verdict.confidence > 0)
    .map((verdict) => verdict.dimension))
}

export function getPublishContractValidationScore(
  result: ChapterContractValidationResult | null | undefined,
): number | null {
  if (!result) return null
  const hardItems = result.itemResults.filter((item) => !isSoftContractValidationItem(item))
  if (hardItems.length === 0) return null
  return getContractValidationScore({
    ...result,
    itemResults: hardItems,
  })
}
