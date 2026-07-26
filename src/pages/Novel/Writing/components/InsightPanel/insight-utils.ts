import type {
  Chapter,
  HardConstraintSourceLabel,
  QualityDashboardData,
  StoryFact,
  StoryMemorySnapshot,
  StoryVolume,
} from '../../../../../types'
import type { ReviewNotes } from '../../parsers'

export const HARD_CONSTRAINT_PRESERVE_OPTIONS: Array<{ value: HardConstraintSourceLabel; label: string }> = [
  { value: 'chapterGoal', label: '章节目标' },
  { value: 'characterStates', label: '人物状态' },
  { value: 'worldStates', label: '世界状态' },
  { value: 'relationSummary', label: '人物关系' },
  { value: 'itemSummary', label: '关键物品' },
  { value: 'openLoops', label: '回收事项' },
  { value: 'continuityNotes', label: '必须承接' },
  { value: 'feedbackRecurrence', label: '审校复现' },
  { value: 'styleHardGuard', label: '文风硬约束' },
  { value: 'antiAiRules', label: '反 AI 硬约束' },
]

export function normalizeIdArray(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))]
}

export function getCurrentVolumeNumber(chapter: Chapter | null, volumes: StoryVolume[]): number | null {
  if (!chapter?.volumeId) return null
  const currentVolume = volumes.find((volume) => volume.id === chapter.volumeId) || null
  return currentVolume?.volumeNumber || null
}

export function computeVolumeTruthRevealStats(
  chapter: Chapter | null,
  volumes: StoryVolume[],
  facts: StoryFact[],
) {
  const volumeNumber = getCurrentVolumeNumber(chapter, volumes)
  if (!volumeNumber) {
    return {
      volumeName: '待绑定卷',
      volumeNumber: null,
      totalTruths: 0,
      plannedTruths: 0,
      ratio: 0,
      limit: null as number | null,
      overLimit: false,
    }
  }
  const currentVolume = volumes.find((volume) => volume.volumeNumber === volumeNumber) || null
  const truthFacts = facts.filter((fact) => fact.kind === 'truth' && fact.isKeyTruth !== 0)
  const totalTruths = truthFacts.length
  const plannedTruths = truthFacts.filter((fact) => fact.plannedRevealVolume === volumeNumber).length
  const ratio = totalTruths > 0 ? plannedTruths / totalTruths : 0
  const limit = typeof currentVolume?.maxTruthRevealRatio === 'number' ? currentVolume.maxTruthRevealRatio : null
  return {
    volumeName: currentVolume?.title?.trim() || `第${volumeNumber}卷`,
    volumeNumber,
    totalTruths,
    plannedTruths,
    ratio,
    limit,
    overLimit: limit !== null && ratio > limit,
  }
}

export type VolumeTruthRevealStats = ReturnType<typeof computeVolumeTruthRevealStats>

export function formatRatioPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export const chapterContextStageLabel = (stage: string) => {
  if (stage === 'scenePlan') return '场景规划'
  if (stage === 'draft') return '正文草稿'
  if (stage === 'review') return '章节审校'
  if (stage === 'rewrite') return '重写修订'
  return stage
}

export const recallBucketLabel = (bucket: string) => {
  if (bucket === 'character' || bucket === 'recall_character') return '人物'
  if (bucket === 'rule' || bucket === 'recall_rule') return '规则'
  if (bucket === 'thread' || bucket === 'recall_thread' || bucket === 'activeThreads') return '线程'
  if (bucket === 'story_memory' || bucket === 'longTermMemory') return '长程记忆'
  if (bucket === 'source_grounding') return '来源支撑'
  if (bucket === 'item' || bucket === 'itemSummary') return '物品'
  if (bucket === 'map_location' || bucket === 'mapSummary') return '地点'
  if (bucket === 'timeline' || bucket === 'timelineSummary' || bucket === 'timelineOpenThreads') return '时间线'
  if (bucket === 'world_state' || bucket === 'worldStates') return '世界状态'
  if (bucket === 'worldRules') return '世界规则'
  if (bucket === 'characterStates') return '人物状态'
  if (bucket === 'continuityNotes') return '连续性'
  if (bucket === 'openLoops') return '未回收事项'
  if (bucket === 'dueForeshadows') return '待回收伏笔'
  if (bucket === 'chapterBridgePlan') return '章节衔接'
  if (bucket === 'stepMemorySummary') return '步骤记忆'
  if (bucket === 'relationSummary') return '人物关系'
  if (bucket === 'dialogueVoiceLocks') return '角色声线'
  if (bucket === 'recalledMemory') return '召回记忆'
  if (bucket === 'cache') return '缓存'
  if (bucket === 'orchestrator') return '调度器'
  return bucket
}

export const fallbackReasonLabel = (reason?: string) => {
  if (!reason) return ''
  if (reason === 'embedding_service_failed') return '向量服务失败'
  if (reason === 'query_embedding_failed') return '查询向量失败'
  if (reason === 'no_hits') return '无命中'
  if (reason === 'only_stale_hits') return '仅命中过期片段'
  if (reason === 'budget_trimmed') return '预算裁剪'
  if (reason === 'disabled_by_config') return '配置关闭'
  if (reason === 'service_failed') return '服务失败'
  if (reason === 'empty_result') return '结果为空'
  if (reason === 'render_empty') return '渲染为空'
  return reason
}

export const writerToolStatusLabel = (status: string) => {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'skipped') return '跳过'
  if (status === 'cache_hit') return '命中缓存'
  if (status === 'empty') return '空结果'
  return status
}

export const writerFallbackModeLabel = (mode: string) => {
  if (mode === 'legacy_empty') return '旧链路空结果'
  if (mode === 'conservative') return '保守兜底'
  return mode
}

export const assetImpactTargetLabel = (targetType: string) => {
  if (targetType === 'chapter') return '章节'
  if (targetType === 'chapter_contract') return '章节合同'
  if (targetType === 'scene_contract') return '场景合同'
  if (targetType === 'thread') return '线程'
  if (targetType === 'timeline') return '时间线'
  if (targetType === 'foreshadow') return '伏笔'
  if (targetType === 'character_state') return '人物状态'
  if (targetType === 'world_state') return '世界状态'
  if (targetType === 'volume_design') return '分卷设计'
  return targetType
}

export function worldStateEntityLabel(entityType: StoryMemorySnapshot['worldCurrentStates'][number]['entityType']) {
  if (entityType === 'character') return '人物'
  if (entityType === 'faction') return '势力'
  if (entityType === 'item') return '物品'
  if (entityType === 'relation') return '关系'
  return '地点'
}

export function languageDriftStatusLabel(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']) {
  if (status === 'worsening') return '恶化中'
  if (status === 'improving') return '改善中'
  return '稳定'
}

export function languageDriftStatusColor(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']) {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

export function formatSignedDriftDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

export function storyAlertColor(severity: QualityDashboardData['storyPacingAlerts'][number]['severity']) {
  return severity === 'blocker' ? 'error' : 'warning'
}

export function storyAlertLabel(severity: QualityDashboardData['storyPacingAlerts'][number]['severity']) {
  return severity === 'blocker' ? '阻塞' : '中优先'
}

export function worldStateAlertColor(severity: QualityDashboardData['recentWorldStateAlerts'][number]['severity']) {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'default'
}

export function paceMarkerLabel(marker?: NonNullable<ReviewNotes['pace_marker']>) {
  if (marker === 'setup') return '铺垫'
  if (marker === 'conflict') return '冲突'
  if (marker === 'reversal') return '反转'
  if (marker === 'climax') return '高潮'
  if (marker === 'payoff') return '回收'
  if (marker === 'breather') return '喘息'
  return '未标注'
}
