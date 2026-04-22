import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Modal, Progress, Skeleton, Tabs, Tag, message } from 'antd'
import VirtualList from 'rc-virtual-list'
import { useNavigate } from 'react-router-dom'
import type { LanguageDriftMetrics, QualityDashboardData, QualityRepairAction, QualityRepairActionResult, TaskPipelineStats } from '../../../types'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import {
  getQualityRiskSeverityColor,
  getQualityRiskSeverityLabel,
  getStoryArcSeverityColor,
  getStoryArcSeverityLabel,
  getStoryPacingSeverityColor,
  getStoryPacingSeverityLabel,
} from '../shared/revision-quality'

interface Props { novelId: number }

type QualityChapterEntry = QualityDashboardData['chapterDetails'][number]
type QualityHeatmapPoint = QualityDashboardData['heatmapData'][number]
type QualityRiskEntry = QualityDashboardData['novelQualityMetrics']['topRisks'][number]
type VolumeQualityEntry = QualityDashboardData['volumeQualityMetrics'][number]

const OverviewTab = React.lazy(() => import('./tabs/OverviewTab'))
const LanguageTab = React.lazy(() => import('./tabs/LanguageTab'))
const StructureTab = React.lazy(() => import('./tabs/StructureTab'))
const StabilityTab = React.lazy(() => import('./tabs/StabilityTab'))

const DIMENSION_NAMES = [
  '文笔质量', '逻辑连贯', '节奏控制', '情感深度',
  '人物塑造', '世界一致', '创新性', '追读欲',
]
const CHAPTER_FUNCTION_ORDER: Array<Exclude<QualityDashboardData['chapterFunctionSummary']['dominantTag'], undefined>> = [
  'setup',
  'progression',
  'reversal',
  'payoff',
  'breather',
  'climax',
  'exposition',
  'closure',
]

function scoreColor(score: number): string {
  if (score >= 8) return '#52c41a'
  if (score >= 6) return '#faad14'
  if (score >= 4) return '#fa8c16'
  return '#f5222d'
}

function heatmapCellColor(score: number): string {
  if (score >= 9) return '#135200'
  if (score >= 8) return '#237804'
  if (score >= 7) return '#389e0d'
  if (score >= 6) return '#52c41a'
  if (score >= 5) return '#fadb14'
  if (score >= 4) return '#faad14'
  if (score >= 3) return '#fa8c16'
  return '#f5222d'
}

function languageDriftRiskColor(value: number): string {
  if (value >= 70) return '#f5222d'
  if (value >= 50) return '#fa8c16'
  if (value >= 30) return '#faad14'
  return '#52c41a'
}

function languageDriftStatusLabel(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return '恶化中'
  if (status === 'improving') return '改善中'
  return '稳定'
}

function languageDriftStatusColor(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

function dialogueSimilarityColor(value: number): string {
  if (value >= 85) return '#f5222d'
  if (value >= 75) return '#fa8c16'
  if (value >= 60) return '#faad14'
  return '#52c41a'
}

function dialogueTrendLabel(status: QualityDashboardData['dialogueDriftTrend'][number]['status']): string {
  if (status === 'worsening') return '漂移加剧'
  if (status === 'improving') return '回稳中'
  return '稳定'
}

function dialogueTrendColor(status: QualityDashboardData['dialogueDriftTrend'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

function formatSignedValue(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function pressureColor(value: number): string {
  if (value >= 80) return '#f5222d'
  if (value >= 60) return '#fa8c16'
  if (value >= 40) return '#faad14'
  return '#52c41a'
}

function arcProgressRateColor(value: number): string {
  if (value >= 45) return '#52c41a'
  if (value >= 30) return '#faad14'
  if (value >= 15) return '#fa8c16'
  return '#f5222d'
}

function paceMarkerLabel(marker?: QualityDashboardData['storyDynamicsTrend'][number]['paceMarker']): string {
  if (marker === 'setup') return '铺垫'
  if (marker === 'conflict') return '冲突'
  if (marker === 'reversal') return '反转'
  if (marker === 'climax') return '高潮'
  if (marker === 'payoff') return '回收'
  if (marker === 'breather') return '喘息'
  return '未标注'
}

function chapterFunctionLabel(tag?: QualityDashboardData['chapterFunctionSummary']['dominantTag']): string {
  if (tag === 'setup') return '铺垫'
  if (tag === 'progression') return '推进'
  if (tag === 'reversal') return '反转'
  if (tag === 'payoff') return '回收'
  if (tag === 'breather') return '喘息'
  if (tag === 'climax') return '爆发'
  if (tag === 'exposition') return '解释'
  if (tag === 'closure') return '收束'
  return '未标注'
}

function chapterFunctionColor(tag?: QualityDashboardData['chapterFunctionSummary']['dominantTag']): string {
  if (tag === 'setup') return '#6c8ebf'
  if (tag === 'progression') return '#52c41a'
  if (tag === 'reversal') return '#fa8c16'
  if (tag === 'payoff') return '#13c2c2'
  if (tag === 'breather') return '#8c8c8c'
  if (tag === 'climax') return '#f5222d'
  if (tag === 'exposition') return '#722ed1'
  if (tag === 'closure') return '#2f54eb'
  return '#8c8c8c'
}

function chapterFunctionAlertColor(severity: QualityDashboardData['chapterFunctionAlerts'][number]['severity']): string {
  return severity === 'blocker' ? 'error' : 'warning'
}

function healthScoreColor(value: number): string {
  if (value >= 85) return '#52c41a'
  if (value >= 70) return '#13c2c2'
  if (value >= 55) return '#faad14'
  if (value >= 40) return '#fa8c16'
  return '#f5222d'
}

function chapterGateLevelLabel(level: QualityDashboardData['chapterGateTrend'][number]['gateLevel']): string {
  if (level === 'rewrite') return '退回重写'
  if (level === 'blocker') return '阻塞'
  if (level === 'warning') return '预警'
  return '通过'
}

function chapterGateLevelColor(level: QualityDashboardData['chapterGateTrend'][number]['gateLevel']): string {
  if (level === 'rewrite') return 'red'
  if (level === 'blocker') return 'error'
  if (level === 'warning') return 'warning'
  return 'success'
}

function chapterGateBandLabel(band: QualityDashboardData['chapterGateTrend'][number]['scoreBand']): string {
  if (band === 'stable') return '稳定'
  if (band === 'attention') return '关注'
  if (band === 'risky') return '风险'
  return '失稳'
}

function chapterGateScoreBand(score: number): QualityDashboardData['chapterGateTrend'][number]['scoreBand'] {
  if (score >= 80) return 'stable'
  if (score >= 60) return 'attention'
  if (score >= 40) return 'risky'
  return 'unstable'
}

function chapterGateBandColor(band: QualityDashboardData['chapterGateTrend'][number]['scoreBand']): string {
  if (band === 'stable') return 'success'
  if (band === 'attention') return 'processing'
  if (band === 'risky') return 'warning'
  return 'error'
}

function chapterGateAlertColor(status: QualityDashboardData['chapterGateDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

function chapterGateAlertLabel(status: QualityDashboardData['chapterGateDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return '恶化'
  if (status === 'improving') return '改善'
  return '稳定'
}

function chapterGateHeatmapColor(score: number): string {
  if (score >= 85) return '#237804'
  if (score >= 70) return '#52c41a'
  if (score >= 60) return '#13c2c2'
  if (score >= 45) return '#faad14'
  if (score >= 30) return '#fa8c16'
  return '#f5222d'
}

function qualityRiskKindLabel(kind: QualityDashboardData['novelQualityMetrics']['riskOverview'][number]['kind']): string {
  if (kind === 'commitment_delivery') return '承诺兑现率'
  if (kind === 'language_drift') return 'AI 味退化'
  if (kind === 'feedback_recurrence') return '审校复现'
  if (kind === 'style_compliance') return '风格硬约束'
  if (kind === 'voice_distinction') return '角色声音区分度'
  if (kind === 'growth_cost_balance') return '成长-代价平衡'
  if (kind === 'story_dynamics') return '主角与节奏'
  if (kind === 'chapter_function') return '章节功能'
  if (kind === 'story_arc') return '故事弧推进'
  if (kind === 'foreshadow_debt') return '伏笔债务'
  if (kind === 'endgame_debt') return '终局债务'
  if (kind === 'recall') return '召回风险'
  if (kind === 'info_reveal_pacing') return '信息揭示节奏'
  return '状态稳定性'
}

function qualityRepairMetricLabel(key: QualityRepairAction['metricKey']): string {
  if (key === 'commitment_delivery') return '承诺兑现率'
  if (key === 'voice_distinction') return '角色声音区分度'
  if (key === 'growth_cost_balance') return '成长-代价平衡'
  if (key === 'foreshadow_debt') return '伏笔债务压力'
  if (key === 'world_state_drift') return '世界状态漂移'
  return '信息揭示节奏'
}

function buildWorkspacePath(novelId: number, page: string, query?: Record<string, string>): string {
  const params = new URLSearchParams()
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  const queryString = params.toString()
  return `/novels/${novelId}/${page}${queryString ? `?${queryString}` : ''}`
}

function buildRepairActionTargetPath(novelId: number, page?: string, query?: Record<string, string>): string | null {
  if (!page) return null
  return buildWorkspacePath(novelId, page, query)
}

function buildRepairResultTargetPath(novelId: number, result: QualityRepairActionResult): string | null {
  if (!result.relatedPage) return null
  return buildWorkspacePath(novelId, result.relatedPage, result.navigationQuery)
}

function readinessStatusColor(status: QualityDashboardData['productionReadiness']['status']): string {
  if (status === 'ready') return 'success'
  if (status === 'warning') return 'warning'
  return 'error'
}

function batchStatusColor(status: QualityDashboardData['batchHealth']['status']): string {
  if (status === 'success' || status === 'idle') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'error'
  return 'processing'
}

function recallSnapshotSourceLabel(source?: QualityDashboardData['chapterDetails'][number]['recallSnapshotSource']): string | null {
  if (source === 'runtime') return '真实运行快照'
  if (source === 'backfilled') return '历史回填快照'
  return null
}

function recallSnapshotSourceColor(source?: QualityDashboardData['chapterDetails'][number]['recallSnapshotSource']): string {
  return source === 'backfilled' ? 'gold' : 'cyan'
}

export default function QualityDashboard({ novelId }: Props) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<QualityDashboardData | null>(null)
  const [pipelineStats, setPipelineStats] = useState<TaskPipelineStats | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<QualityChapterEntry | null>(null)
  const [selectedVolumeId, setSelectedVolumeId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [repairingActionId, setRepairingActionId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      try {
        await window.electron.quality.backfillRecallSnapshots(novelId)
      } catch (error) {
        console.warn('Failed to backfill recall runtime snapshots before loading quality dashboard', error)
      }
      const [result, nextPipelineStats] = await Promise.all([
        window.electron.quality.getDashboard(novelId),
        window.electron.task.getPipelineStats(novelId),
      ])
      setData(result)
      setPipelineStats(nextPipelineStats)
    } catch (error) {
      console.error('Failed to load quality dashboard', error)
      setPipelineStats(null)
    } finally {
      setLoading(false)
    }
  }, [novelId])

  useEffect(() => { void loadData() }, [loadData])
  useEffect(() => {
    if (!data || selectedVolumeId == null) return
    if (!data.volumeQualityMetrics.some((entry) => entry.volumeId === selectedVolumeId)) {
      setSelectedVolumeId(null)
    }
  }, [data, selectedVolumeId])

  if (loading) {
    return (
      <WorkspacePage title="质量监控">
        <WorkspacePanel title="正在汇总质量数据">
          <Skeleton active paragraph={{ rows: 10 }} />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  const hasScoreData = Boolean(data && data.totalChaptersScored > 0)
  const hasChapterGateData = Boolean(data && data.chapterGateSummary.coveredChapterCount > 0)
  const hasStoryDynamicsData = Boolean(data && data.protagonistSetbackSummary.chapterCount > 0)
  const hasArcProgressData = Boolean(data && (data.storyArcProgressSummary.trackedArcCount > 0 || data.storyArcProgressAlerts.length > 0))
  const hasDialogueData = Boolean(data && data.dialogueFingerprintStats.eligibleCharacterCount > 0)
  const hasStateData = Boolean(data && (data.worldStateSummary.trackedEntityCount > 0 || data.recentWorldStateAlerts.length > 0))
  const hasRecallData = Boolean(data && (data.recallSummary.analyzedChapterCount > 0 || data.recentRecallAlerts.length > 0))
  const hasChapterFunctionData = Boolean(data && (data.chapterFunctionSummary.trackedChapterCount > 0 || data.chapterFunctionAlerts.length > 0))
  const hasEndgameDebtData = Boolean(data && data.recentEndgameDebtAlerts.length > 0)
  const hasPipelineData = Boolean(pipelineStats && pipelineStats.totalPipelineCount > 0)

  if (!data || (!hasScoreData && !hasChapterGateData && !hasStoryDynamicsData && !hasArcProgressData && !hasDialogueData && !hasStateData && !hasRecallData && !hasChapterFunctionData && !hasEndgameDebtData && !hasPipelineData)) {
    return (
      <WorkspacePage title="质量监控">
        <WorkspacePanel title="先产出首轮检测">
          <Empty description="先在正文页运行章节审校、AI 体检或写作流水线，质量页才会开始累计趋势、风险和修复动作。">
            <Button type="primary" onClick={() => navigate(`/novels/${novelId}/writing`)}>
              进入正文写作
            </Button>
          </Empty>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  const selectedVolumeMetrics = selectedVolumeId != null
    ? data.volumeQualityMetrics.find((entry) => entry.volumeId === selectedVolumeId) || null
    : null
  const selectedVolumeChapterNums = selectedVolumeMetrics
    ? new Set(
      data.chapterDetails
        .filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
        .map((entry) => entry.chapterNum),
    )
    : null
  const filteredChapterDetails = selectedVolumeMetrics
    ? data.chapterDetails.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.chapterDetails
  const filteredHeatmapData = selectedVolumeChapterNums
    ? data.heatmapData.filter((entry) => selectedVolumeChapterNums.has(entry.chapterNum))
    : data.heatmapData
  const filteredChapterGateTrend = selectedVolumeChapterNums
    ? data.chapterGateTrend.filter((entry) => selectedVolumeChapterNums.has(entry.chapterNum))
    : data.chapterGateTrend
  const filteredChapterGateHeatmap = selectedVolumeChapterNums
    ? data.chapterGateHeatmap.filter((entry) => selectedVolumeChapterNums.has(entry.chapterNum))
    : data.chapterGateHeatmap
  const filteredChapterGateAlerts = selectedVolumeMetrics
    ? data.chapterGateDriftAlerts.filter((entry) => entry.chapterNum >= selectedVolumeMetrics.chapterStart && entry.chapterNum <= selectedVolumeMetrics.chapterEnd)
    : data.chapterGateDriftAlerts
  const filteredOverallTrend = selectedVolumeChapterNums
    ? data.overallScoreTrend.filter((entry) => selectedVolumeChapterNums.has(entry.chapterNum))
    : data.overallScoreTrend
  const filteredAiLikeTrend = selectedVolumeChapterNums
    ? data.aiLikeRateTrend.filter((entry) => selectedVolumeChapterNums.has(entry.chapterNum))
    : data.aiLikeRateTrend
  const filteredLanguageVolumes = selectedVolumeMetrics
    ? data.volumeLanguageDrift.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.volumeLanguageDrift
  const filteredStoryVolumes = selectedVolumeMetrics
    ? data.volumeStoryDynamics.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.volumeStoryDynamics
  const filteredChapterFunctionRuns = selectedVolumeMetrics
    ? data.repeatedFunctionRuns.filter((entry) => entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd))
    : data.repeatedFunctionRuns
  const filteredChapterFunctionAlerts = selectedVolumeMetrics
    ? data.chapterFunctionAlerts.filter((entry) => (
      entry.volumeId === selectedVolumeMetrics.volumeId
      || entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd)
    ))
    : data.chapterFunctionAlerts
  const filteredChapterFunctionVolumes = selectedVolumeMetrics
    ? data.volumeChapterFunctions.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.volumeChapterFunctions
  const filteredArcVolumes = selectedVolumeMetrics
    ? data.storyArcProgressVolumes.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.storyArcProgressVolumes
  const filteredRecallAlerts = selectedVolumeMetrics
    ? data.recentRecallAlerts.filter((entry) => entry.chapterNum >= selectedVolumeMetrics.chapterStart && entry.chapterNum <= selectedVolumeMetrics.chapterEnd)
    : data.recentRecallAlerts
  const filteredRecallVolumes = selectedVolumeMetrics
    ? data.volumeRecallDiagnostics.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.volumeRecallDiagnostics
  const filteredWorldAlerts = selectedVolumeMetrics
    ? data.recentWorldStateAlerts.filter((entry) => entry.chapterNum >= selectedVolumeMetrics.chapterStart && entry.chapterNum <= selectedVolumeMetrics.chapterEnd)
    : data.recentWorldStateAlerts
  const filteredWorldVolumes = selectedVolumeMetrics
    ? data.volumeWorldStateStability.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId)
    : data.volumeWorldStateStability
  const openChapterByNum = (chapterNum: number) => {
    const matched = data.chapterDetails.find((entry) => entry.chapterNum === chapterNum)
    if (!matched) return
    if (typeof matched.volumeId === 'number') setSelectedVolumeId(matched.volumeId)
    setSelectedChapter(matched)
  }
  const handleRiskSelect = (risk: QualityDashboardData['novelQualityMetrics']['topRisks'][number]) => {
    if (typeof risk.volumeId === 'number') setSelectedVolumeId(risk.volumeId)
    const chapterNum = risk.chapterNums[0]
    if (typeof chapterNum === 'number') openChapterByNum(chapterNum)
  }
  const handleRepairAction = useCallback(async (action: QualityRepairAction) => {
    setRepairingActionId(action.id)
    try {
      const result = await window.electron.quality.executeRepairAction(novelId, action)
      if (result.status === 'failed') {
        message.error(result.message)
        return
      }
      if (result.status === 'unsupported') {
        message.warning(result.message)
      } else {
        message.success(result.message)
      }

      const targetPath = buildRepairResultTargetPath(novelId, result)
        || buildRepairActionTargetPath(novelId, action.targetPage, action.navigationQuery)
      if (targetPath) navigate(targetPath)
      await loadData()
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('qualityDashboard.repairFailed'))
    } finally {
      setRepairingActionId(null)
    }
  }, [loadData, navigate, novelId])

  const overviewContent = (
    <>
      <WorkspacePanel title="百万字健康指标" description="把继续扩批前最关键的生产、连续性、合同和批次回查信号收在一起。">
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="quality-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <strong>生产就绪度</strong>
                <Tag color={readinessStatusColor(data.productionReadiness.status)}>{`${data.productionReadiness.readyRate}%`}</Tag>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{data.productionReadiness.summary}</div>
            </div>
            <div className="quality-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <strong>批次健康</strong>
                <Tag color={batchStatusColor(data.batchHealth.status)}>{data.batchHealth.status}</Tag>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{data.batchHealth.summary}</div>
            </div>
            <div className="quality-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <strong>连续性健康</strong>
                <Tag color={data.continuityHealth.staleCheckpointCount > 0 || data.continuityHealth.worldConflictCount > 0 ? 'warning' : 'success'}>
                  {`检查点 ${data.continuityHealth.staleCheckpointCount}`}
                </Tag>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                {`召回降级 ${data.continuityHealth.recallDegradedChapterCount} 章，世界冲突 ${data.continuityHealth.worldConflictCount} 处，最新检查点落后 ${data.continuityHealth.latestCheckpointChapterGap} 章。`}
              </div>
            </div>
            <div className="quality-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <strong>合同交付</strong>
                <Tag color={data.contractDelivery.blockerCount > 0 ? 'error' : data.contractDelivery.warningCount > 0 ? 'warning' : 'success'}>
                  {`${data.contractDelivery.readyRate}%`}
                </Tag>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                {`阻断 ${data.contractDelivery.blockerCount}，预警 ${data.contractDelivery.warningCount}，线程推进率 ${data.contractDelivery.storyThreadAdvanceRate}%。`}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div className="quality-card">
              <strong>继续下一批前</strong>
              <div style={{ display: 'grid', gap: 8, marginTop: 10, fontSize: 12, opacity: 0.82 }}>
                {(data.productionReadiness.blockers.length > 0
                  ? data.productionReadiness.blockers
                  : data.productionReadiness.suggestedActions.slice(0, 3)
                ).map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            </div>
            <div className="quality-card">
              <strong>最近批次回查</strong>
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.82 }}>{data.batchReview.summary}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <Tag color="blue">{`通过 ${data.batchReview.passedChapterCount}`}</Tag>
                <Tag color="gold">{`重写 ${data.batchReview.rewrittenChapterCount}`}</Tag>
                <Tag color="red">{`失败 ${data.batchReview.failedChapterCount}`}</Tag>
                <Tag color="purple">{`回写待处理 ${data.batchReview.pendingWritebackCount}`}</Tag>
              </div>
            </div>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="修复引擎摘要" description="把六类高价值质量指标压缩成可执行动作，优先处理最影响正文继续推进的问题。">
        <div style={{ display: 'grid', gap: 16 }}>
          {data.dashboardNotes?.length ? (
            <div style={{ display: 'grid', gap: 6, fontSize: 12, opacity: 0.78 }}>
              {data.dashboardNotes.map((note) => <div key={note}>{note}</div>)}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {data.repairMetrics.map((metric) => (
              <div key={metric.key} className="quality-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong>{metric.label}</strong>
                  <Tag color={metric.score >= 80 ? 'success' : metric.score >= 60 ? 'warning' : 'error'}>{metric.score}</Tag>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{metric.summary}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Tag color={metric.riskCount > 0 ? 'orange' : 'success'}>{`风险 ${metric.riskCount}`}</Tag>
                  {metric.focusLabels.slice(0, 2).map((label) => <Tag key={`${metric.key}-${label}`}>{label}</Tag>)}
                </div>
              </div>
            ))}
          </div>
          <div className="quality-card" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong>动作汇总</strong>
              <Tag color={data.repairActionSummary.actionableRiskCount > 0 ? 'processing' : 'success'}>
                {`可动作风险 ${data.repairActionSummary.actionableRiskCount}`}
              </Tag>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue">{`任务动作 ${data.repairActionSummary.taskActionCount}`}</Tag>
              <Tag color="gold">{`安全直落 ${data.repairActionSummary.directExecutableActionCount}`}</Tag>
              <Tag color="purple">{`允许偏移 ${data.repairActionSummary.allowDeviationCount}`}</Tag>
            </div>
            <div style={{ display: 'grid', gap: 6, fontSize: 12, opacity: 0.78 }}>
              {data.repairActionSummary.topPriorityActions.length > 0
                ? data.repairActionSummary.topPriorityActions.map((item) => <div key={item}>{item}</div>)
                : <div>当前总灯允许继续推进，先盯住新增章节和最新批次即可。</div>}
            </div>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="全书健康总览">
        <NovelHealthOverviewPanel
          summary={data.novelQualityMetrics}
          activeVolume={selectedVolumeMetrics}
          onSelectVolume={setSelectedVolumeId}
          onClearVolume={() => setSelectedVolumeId(null)}
          onSelectRisk={handleRiskSelect}
          onRunAction={handleRepairAction}
          repairingActionId={repairingActionId}
        />
      </WorkspacePanel>

      {pipelineStats ? (
        <WorkspacePanel title="长篇写作架构">
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Tag color={pipelineStats.activePipelineCount > 0 ? 'processing' : 'success'}>
                {pipelineStats.activePipelineCount > 0
                  ? `运行中 ${pipelineStats.activePipelineCount} 条`
                  : '当前无运行中的正文流水线'}
              </Tag>
              <Tag color="blue">{`累计流水线 ${pipelineStats.totalPipelineCount} 条`}</Tag>
              {pipelineStats.commonRecoveryHints.map((item) => (
                <Tag key={item.label} color="warning">{`${item.label} × ${item.count}`}</Tag>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {pipelineStats.roleStats.map((item) => (
                <div key={item.role} className="quality-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <strong>{item.role === 'planner' ? 'Planner' : item.role === 'writer' ? 'Writer' : item.role === 'critic' ? 'Critic' : item.role === 'rewriter' ? 'Rewriter' : item.role === 'canonizer' ? 'Canonizer' : 'Finalize'}</strong>
                    <Tag color={item.failedCount > 0 ? 'error' : item.runningCount > 0 ? 'processing' : 'success'}>
                      {`成功 ${item.successCount} / 失败 ${item.failedCount} / 运行中 ${item.runningCount}`}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                    {`平均耗时 ${item.avgDurationMs ? `${(item.avgDurationMs / 1000).toFixed(1)}s` : '-'}，累计 tokens ${item.tokensUsedTotal || 0}，阻断 ${item.blockedCount} 条`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </WorkspacePanel>
      ) : null}

      {data.volumeQualityMetrics.length > 0 ? (
        <WorkspacePanel title="卷级健康面板">
          <VolumeHealthPanel
            volumes={data.volumeQualityMetrics}
            activeVolumeId={selectedVolumeId}
            onSelectVolume={setSelectedVolumeId}
            onSelectRisk={handleRiskSelect}
            onRunAction={handleRepairAction}
            repairingActionId={repairingActionId}
          />
        </WorkspacePanel>
      ) : null}

      {data.recentEndgameDebtAlerts.length > 0 ? (
        <WorkspacePanel title="终局债务预警">
          <EndgameDebtPanel alerts={data.recentEndgameDebtAlerts} onSelectRisk={handleRiskSelect} />
        </WorkspacePanel>
      ) : null}

      {hasScoreData ? (
        <>
          <WorkspacePanel title="质量热力图">
            <HeatmapChart data={filteredHeatmapData} chapterNums={filteredOverallTrend.map((d) => d.chapterNum)} />
          </WorkspacePanel>

          <WorkspacePanel title="评分趋势">
            <TrendChart
              overallTrend={filteredOverallTrend}
              aiLikeTrend={filteredAiLikeTrend}
            />
          </WorkspacePanel>

          <WorkspacePanel title="薄弱维度分析">
            <WeakDimensionChart data={data.weakDimensionFrequency} />
          </WorkspacePanel>

          <WorkspacePanel title="章节详情">
            <div style={{ height: 480 }}>
              <VirtualList data={filteredChapterDetails} height={480} itemHeight={56} itemKey="chapterId">
                {(entry: QualityChapterEntry) => (
                  <div
                    key={entry.chapterId}
                    className="quality-chapter-row"
                    onClick={() => setSelectedChapter(entry)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                    }}
                  >
                    <span style={{ width: 60, fontWeight: 500 }}>第{entry.chapterNum}章</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                    <Progress
                      type="circle"
                      percent={entry.overallScore * 10}
                      size={36}
                      strokeColor={scoreColor(entry.overallScore)}
                      format={() => entry.overallScore.toFixed(1)}
                    />
                    <Tag color={entry.aiLikeRate > 50 ? 'red' : entry.aiLikeRate > 30 ? 'orange' : 'green'}>
                      AI 味 {entry.aiLikeRate}%
                    </Tag>
                    {entry.weakDimensions.length > 0 ? (
                      <Tag color="warning">{`薄弱：${entry.weakDimensions.join('、')}`}</Tag>
                    ) : null}
                  </div>
                )}
              </VirtualList>
            </div>
          </WorkspacePanel>
        </>
      ) : null}
    </>
  )

  const languageContent = (
    <>
      {hasScoreData ? (
        <WorkspacePanel title="AI 味分解">
          <LanguageDriftPanel
            averages={data.averageLanguageDrift}
            trends={data.languageDriftTrends}
            recentAlerts={data.recentLanguageDriftAlerts}
            volumeEntries={filteredLanguageVolumes}
            novelSummary={data.novelLanguageDriftSummary}
            antiAiRecurrence={selectedVolumeMetrics
              ? {
                ...data.antiAiRecurrence,
                recentAlerts: data.antiAiRecurrence.recentAlerts.filter((entry) => entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd)),
                volumeEntries: data.antiAiRecurrence.volumeEntries.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId),
              }
              : data.antiAiRecurrence}
            feedbackRecurrence={selectedVolumeMetrics
              ? {
                ...data.feedbackRecurrence,
                recentAlerts: data.feedbackRecurrence.recentAlerts.filter((entry) => entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd)),
                humanization: {
                  ...data.feedbackRecurrence.humanization,
                  topRepeatedIssues: data.feedbackRecurrence.humanization.topRepeatedIssues.filter((entry) => entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd)),
                  promotedIssues: data.feedbackRecurrence.humanization.promotedIssues.filter((entry) => entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd)),
                  recentAlerts: data.feedbackRecurrence.humanization.recentAlerts.filter((entry) => entry.chapterNums.some((chapterNum) => chapterNum >= selectedVolumeMetrics.chapterStart && chapterNum <= selectedVolumeMetrics.chapterEnd)),
                },
                volumeEntries: data.feedbackRecurrence.volumeEntries.filter((entry) => entry.volumeId === selectedVolumeMetrics.volumeId),
              }
              : data.feedbackRecurrence}
          />
        </WorkspacePanel>
      ) : null}

      {data.dialogueFingerprintStats.eligibleCharacterCount > 0 ? (
        <WorkspacePanel title="角色对白辨识度">
          <DialogueFingerprintPanel
            stats={data.dialogueFingerprintStats}
            signatures={data.characterDialogueSignatures}
            similarities={data.crossCharacterDialogueSimilarity}
            driftEntries={data.dialogueDriftTrend}
            volumeEntries={data.volumeDialogueSimilarity}
            alerts={data.recentDialogueAlerts}
            voiceLockCandidates={data.requiredDialogueVoiceLocks}
          />
        </WorkspacePanel>
      ) : (
        <WorkspacePanel title="角色对白辨识度">
          <Empty description="当前还没有足够的对白指纹数据。" />
        </WorkspacePanel>
      )}
    </>
  )

  const structureContent = (
    <>
      {hasChapterGateData ? (
        <WorkspacePanel title="章节验收门">
          <ChapterGatePanel
            summary={data.chapterGateSummary}
            trend={filteredChapterGateTrend}
            heatmap={filteredChapterGateHeatmap}
            alerts={filteredChapterGateAlerts}
            selectedVolumeLabel={selectedVolumeMetrics?.volumeName}
            onSelectChapter={openChapterByNum}
          />
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="主角受挫与节奏">
        <StoryDynamicsPanel
          trend={data.storyDynamicsTrend}
          alerts={data.storyPacingAlerts}
          protagonistSummary={data.protagonistSetbackSummary}
          costSummary={data.costPersistenceSummary}
          reversalSummary={data.reversalDistributionSummary}
          volumeEntries={filteredStoryVolumes}
        />
      </WorkspacePanel>

      {hasChapterFunctionData ? (
        <WorkspacePanel title="章节功能与节奏分布">
          <ChapterFunctionPanel
            summary={data.chapterFunctionSummary}
            runs={filteredChapterFunctionRuns}
            alerts={filteredChapterFunctionAlerts}
            volumeEntries={filteredChapterFunctionVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasArcProgressData ? (
        <WorkspacePanel title="故事弧推进">
          <StoryArcProgressPanel
            summary={data.storyArcProgressSummary}
            trend={data.storyArcProgressTrend}
            arcs={data.storyArcProgressArcs}
            alerts={data.storyArcProgressAlerts}
            volumeEntries={filteredArcVolumes}
          />
        </WorkspacePanel>
      ) : null}
    </>
  )

  const stabilityContent = (
    <>
      {hasRecallData ? (
        <WorkspacePanel title="召回可靠性">
          <RecallReliabilityPanel
            summary={data.recallSummary}
            alerts={filteredRecallAlerts}
            volumeEntries={filteredRecallVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasStateData ? (
        <WorkspacePanel title="状态稳定性">
          <WorldStateStabilityPanel
            trend={data.worldStateTrend}
            alerts={filteredWorldAlerts}
            conflictEntities={data.worldConflictEntities}
            summary={data.worldStateSummary}
            volumeEntries={filteredWorldVolumes}
          />
        </WorkspacePanel>
      ) : null}
    </>
  )

  return (
    <WorkspacePage
      title="质量监控"
      metrics={[
        <WorkspaceMetric key="ready" label="生产就绪度" value={`${data.productionReadiness.readyRate}%`} tone="warm" />,
        <WorkspaceMetric key="batch" label="最近批次" value={data.batchHealth.chapterIds.length > 0 ? `${data.batchHealth.chapterIds.length}章` : '空闲'} />,
        <WorkspaceMetric key="scored" label="已评分章节" value={data.totalChaptersScored} />,
        <WorkspaceMetric key="gate" label="章节门覆盖" value={data.chapterGateSummary.coveredChapterCount} />,
        <WorkspaceMetric key="style" label="风格预警" value={data.styleCompliance.warningCount + data.styleCompliance.rewriteCount} />,
        <WorkspaceMetric key="tracked" label="节奏追踪章节" value={data.protagonistSetbackSummary.chapterCount} />,
        <WorkspaceMetric key="arc" label="跟踪故事弧" value={data.storyArcProgressSummary.trackedArcCount} />,
        <WorkspaceMetric key="pipeline" label="正文流水线" value={pipelineStats?.totalPipelineCount || 0} />,
        <WorkspaceMetric key="avg" label="平均总分 / 压力" value={hasScoreData ? `${data.averageOverallScore} / 10` : `${data.protagonistSetbackSummary.averagePressure}`} />,
      ]}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: '总览',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <OverviewTab content={overviewContent} />
              </React.Suspense>
            ),
          },
          {
            key: 'language',
            label: '语言与对白',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <LanguageTab content={languageContent} />
              </React.Suspense>
            ),
          },
          {
            key: 'structure',
            label: '结构与推进',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <StructureTab content={structureContent} />
              </React.Suspense>
            ),
          },
          {
            key: 'stability',
            label: '召回与状态',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <StabilityTab content={stabilityContent} />
              </React.Suspense>
            ),
          },
        ]}
      />

      <Modal
        title={selectedChapter ? `第${selectedChapter.chapterNum}章 · ${selectedChapter.title}` : '章节评分'}
        open={!!selectedChapter}
        onCancel={() => setSelectedChapter(null)}
        footer={null}
        width={600}
      >
        {selectedChapter ? (
          <div style={{ display: 'grid', gap: 16, padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="dashboard"
                  percent={selectedChapter.overallScore * 10}
                  strokeColor={scoreColor(selectedChapter.overallScore)}
                  format={() => <span style={{ fontSize: 20 }}>{selectedChapter.overallScore}</span>}
                />
                <div style={{ marginTop: 4 }}>总分</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="dashboard"
                  percent={100 - selectedChapter.aiLikeRate}
                  strokeColor={selectedChapter.aiLikeRate > 50 ? '#f5222d' : selectedChapter.aiLikeRate > 30 ? '#faad14' : '#52c41a'}
                  format={() => <span style={{ fontSize: 20 }}>{selectedChapter.aiLikeRate}%</span>}
                />
                <div style={{ marginTop: 4 }}>AI 味率</div>
              </div>
            </div>
            {selectedChapter.dimensions.map((dim) => (
              <div key={dim.name} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>{dim.name}</span>
                  <Tag color={scoreColor(dim.score)} style={{ marginRight: 0 }}>{dim.score}</Tag>
                </div>
                <Progress
                  percent={dim.score * 10}
                  showInfo={false}
                  strokeColor={scoreColor(dim.score)}
                  size="small"
                />
                {dim.feedback ? <div style={{ fontSize: 12, opacity: 0.7 }}>{dim.feedback}</div> : null}
                {dim.suggestion ? <div style={{ fontSize: 12, opacity: 0.55 }}>{dim.suggestion}</div> : null}
              </div>
            ))}
            <ChapterGateDetails chapterGate={selectedChapter.chapterGate} />
            <LanguageDriftDetails metrics={selectedChapter.languageDriftMetrics} />
            <AntiAiRuleHitDetails hits={selectedChapter.antiAiRuleHits} />
            <FeedbackRecurrenceDetails hits={selectedChapter.feedbackRecurrenceHits} />
            <StyleComplianceDetails styleCompliance={selectedChapter.styleCompliance} />
            <DialogueReviewDetails review={selectedChapter.dialogueReview} />
            <StoryDynamicsDetails dynamics={selectedChapter.storyDynamics} />
            <ChapterFunctionDetails chapterFunction={selectedChapter.chapterFunction} />
            <StoryArcProgressDetails progress={selectedChapter.storyArcProgress} />
            <RecallDiagnosticsDetails
              diagnostics={selectedChapter.recallDiagnostics}
              snapshot={selectedChapter.recallSnapshot}
              recallSnapshotSource={selectedChapter.recallSnapshotSource}
            />
            <WorldStateAlertDetails alerts={selectedChapter.worldStateAlerts} />
          </div>
        ) : null}
      </Modal>
    </WorkspacePage>
  )
}

function ChapterGatePanel({
  summary,
  trend,
  heatmap,
  alerts,
  selectedVolumeLabel,
  onSelectChapter,
}: {
  summary: QualityDashboardData['chapterGateSummary']
  trend: QualityDashboardData['chapterGateTrend']
  heatmap: QualityDashboardData['chapterGateHeatmap']
  alerts: QualityDashboardData['chapterGateDriftAlerts']
  selectedVolumeLabel?: string
  onSelectChapter: (chapterNum: number) => void
}) {
  if (summary.coveredChapterCount === 0 || trend.length === 0) {
    return <Empty description="先跑一轮章节验收门，历史快照会从这里累计" />
  }

  const averageVisibleScore = trend.length > 0
    ? Math.round((trend.reduce((sum, entry) => sum + entry.totalScore, 0) / trend.length) * 10) / 10
    : 0
  const bandCounts = trend.reduce<Record<QualityDashboardData['chapterGateTrend'][number]['scoreBand'], number>>((result, entry) => {
    result[entry.scoreBand] += 1
    return result
  }, { stable: 0, attention: 0, risky: 0, unstable: 0 })
  const levelCounts = trend.reduce<Record<QualityDashboardData['chapterGateTrend'][number]['gateLevel'], number>>((result, entry) => {
    result[entry.gateLevel] += 1
    return result
  }, { pass: 0, warning: 0, blocker: 0, rewrite: 0 })
  const visibleAlerts = alerts.filter((alert) => alert.status !== 'stable').slice(0, 6)
  const dimensions = Array.from(new Set(heatmap.map((entry) => entry.dimension)))
  const chapterNums = trend.map((entry) => entry.chapterNum)
  const heatmapValueMap = new Map(heatmap.map((entry) => [`${entry.chapterNum}:${entry.dimension}`, entry] as const))
  const recentTrend = trend.slice(-8).reverse()

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {selectedVolumeLabel ? (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(19,194,194,0.08)', border: '1px solid rgba(19,194,194,0.24)', fontSize: 12 }}>
          当前按卷筛选：{selectedVolumeLabel}。章节验收门趋势、热力图和漂移告警已同步收窄到该卷。
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>平均门分</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: chapterGateHeatmapColor(averageVisibleScore) }}>{averageVisibleScore}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>当前视图下最近快照的总分均值</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>稳定 / 关注</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{bandCounts.stable} / {bandCounts.attention}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>80+ 稳定，60-79 需要关注</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>风险 / 失稳</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{bandCounts.risky} / {bandCounts.unstable}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>40-59 风险，40 以下失稳</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>最近恶化</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: visibleAlerts.length > 0 ? '#f5222d' : '#52c41a' }}>{visibleAlerts.filter((alert) => alert.status === 'worsening').length}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>门级恶化或总分明显回落的章节数</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 1fr)', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>章节门趋势</div>
          <MiniTrendRow label="总分" points={trend.map((entry) => ({ chapterNum: entry.chapterNum, value: entry.totalScore }))} />
          <MiniTrendRow
            label="门级压力"
            points={trend.map((entry) => ({
              chapterNum: entry.chapterNum,
              value: entry.gateLevel === 'rewrite' ? 100 : entry.gateLevel === 'blocker' ? 72 : entry.gateLevel === 'warning' ? 38 : 10,
            }))}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag color={chapterGateLevelColor('pass')} style={{ marginRight: 0 }}>{`通过 ${levelCounts.pass}`}</Tag>
            <Tag color={chapterGateLevelColor('warning')} style={{ marginRight: 0 }}>{`预警 ${levelCounts.warning}`}</Tag>
            <Tag color={chapterGateLevelColor('blocker')} style={{ marginRight: 0 }}>{`阻塞 ${levelCounts.blocker}`}</Tag>
            <Tag color={chapterGateLevelColor('rewrite')} style={{ marginRight: 0 }}>{`重写 ${levelCounts.rewrite}`}</Tag>
          </div>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>最近漂移告警</div>
          {visibleAlerts.length > 0 ? visibleAlerts.map((alert) => (
            <button
              key={`${alert.chapterId}-${alert.createdAt}`}
              type="button"
              onClick={() => onSelectChapter(alert.chapterNum)}
              style={{
                textAlign: 'left',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={chapterGateAlertColor(alert.status)} style={{ marginRight: 0 }}>{chapterGateAlertLabel(alert.status)}</Tag>
                <Tag color={chapterGateLevelColor(alert.currentGateLevel)} style={{ marginRight: 0 }}>{chapterGateLevelLabel(alert.currentGateLevel)}</Tag>
                <strong>{alert.title}</strong>
              </div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>{alert.detail}</div>
            </button>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前视图内最近没有明显的门级恶化或回升。</div>}
        </div>
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>维度热力图</div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: Math.max(640, chapterNums.length * 64), display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${chapterNums.length}, minmax(44px, 1fr))`, gap: 6, fontSize: 11, opacity: 0.65 }}>
              <div>维度 / 章节</div>
              {chapterNums.map((chapterNum) => <div key={`head-${chapterNum}`} style={{ textAlign: 'center' }}>{chapterNum}</div>)}
            </div>
            {dimensions.map((dimension) => (
              <div key={dimension} style={{ display: 'grid', gridTemplateColumns: `120px repeat(${chapterNums.length}, minmax(44px, 1fr))`, gap: 6, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{dimension}</div>
                {chapterNums.map((chapterNum) => {
                  const entry = heatmapValueMap.get(`${chapterNum}:${dimension}`)
                  const score = entry?.score || 0
                  return (
                    <button
                      key={`${chapterNum}-${dimension}`}
                      type="button"
                      onClick={() => onSelectChapter(chapterNum)}
                      style={{
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 0',
                        cursor: 'pointer',
                        background: chapterGateHeatmapColor(score),
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {score}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>最近章节快照</div>
        {recentTrend.map((entry) => (
          <button
            key={`${entry.chapterId}-${entry.createdAt}`}
            type="button"
            onClick={() => onSelectChapter(entry.chapterNum)}
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 10,
              padding: '12px 14px',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ minWidth: 72 }}>{`第${entry.chapterNum}章`}</strong>
            <Tag color={chapterGateLevelColor(entry.gateLevel)} style={{ marginRight: 0 }}>{chapterGateLevelLabel(entry.gateLevel)}</Tag>
            <Tag color={chapterGateBandColor(entry.scoreBand)} style={{ marginRight: 0 }}>{chapterGateBandLabel(entry.scoreBand)}</Tag>
            <span style={{ fontWeight: 700, color: chapterGateHeatmapColor(entry.totalScore) }}>{entry.totalScore}</span>
            <span style={{ fontSize: 12, opacity: 0.65 }}>{new Date(entry.createdAt).toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function RepairRiskCard({
  risk,
  onSelectRisk,
  onRunAction,
  repairingActionId,
  compact = false,
}: {
  risk: QualityRiskEntry
  onSelectRisk: (risk: QualityRiskEntry) => void
  onRunAction: (action: QualityRepairAction) => void
  repairingActionId: string | null
  compact?: boolean
}) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag color={getQualityRiskSeverityColor(risk.severity)} style={{ marginRight: 0 }}>
          {getQualityRiskSeverityLabel(risk.severity)}
        </Tag>
        <Tag color="blue" style={{ marginRight: 0 }}>{qualityRiskKindLabel(risk.kind)}</Tag>
        {risk.metricKey ? <Tag color="purple" style={{ marginRight: 0 }}>{qualityRepairMetricLabel(risk.metricKey)}</Tag> : null}
        <strong>{risk.title}</strong>
      </div>
      <div style={{ fontSize: 12, opacity: 0.78 }}>{risk.detail}</div>
      <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <div><strong>原因：</strong>{risk.whyItHappened}</div>
        <div><strong>修法：</strong>{risk.howToFix}</div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.58 }}>
        {risk.chapterNums.length > 0 ? `涉及章节：${risk.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}` : '当前风险没有绑定具体章节。'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="small" onClick={() => onSelectRisk(risk)}>定位风险</Button>
        {risk.suggestedActions.slice(0, compact ? 2 : 3).map((action) => (
          <Button
            key={action.id}
            size="small"
            type={action.safeToExecute ? 'primary' : 'default'}
            loading={repairingActionId === action.id}
            onClick={() => onRunAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function NovelHealthOverviewPanel({
  summary,
  activeVolume,
  onSelectVolume,
  onClearVolume,
  onSelectRisk,
  onRunAction,
  repairingActionId,
}: {
  summary: QualityDashboardData['novelQualityMetrics']
  activeVolume: VolumeQualityEntry | null
  onSelectVolume: (volumeId: number | null) => void
  onClearVolume: () => void
  onSelectRisk: (risk: QualityRiskEntry) => void
  onRunAction: (action: QualityRepairAction) => void
  repairingActionId: string | null
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.68 }}>
        质量面板会优先展示章节级召回快照：先读真实运行快照，其次读旧任务兼容快照；老章节若无历史任务快照，会先回填当前状态快照，并显式标记来源。只有结构化快照完全缺失时才回退到启发式诊断。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>全书健康分</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: healthScoreColor(summary.healthScore) }}>{summary.healthScore}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>综合 AI 味、节奏、推进、召回与状态稳定性</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>已分析章节</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.analyzedChapterCount} / {summary.totalChapterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>已纳入质量总览统计的章节数量</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>风险计数</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.criticalRiskCount} / {summary.warningRiskCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>高优先 / 中优先</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>伏笔债务</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.foreshadowPendingCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            待回收 {summary.foreshadowPendingCount} · 即将到期 {summary.foreshadowDueSoonCount} · 已超期 {summary.foreshadowOverdueCount}
          </div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            延期说明 {summary.foreshadowBlockedCount} · 超期失管 {summary.foreshadowStaleCount}
          </div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>支线兑现率</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.storyThreadAdvanceRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            提及未推进 {summary.storyThreadMentionOnlyCount} · 只按真实推进/回收计入兑现
          </div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>终局债务</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.endgameActiveCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            已进入执行链 {summary.endgameServedCount} · 未绑定 {summary.endgameUnboundCount} · 已过期 {summary.endgameOverdueCount}
          </div>
        </div>
      </div>

      {activeVolume ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'rgba(19,194,194,0.08)', border: '1px solid rgba(19,194,194,0.24)' }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontWeight: 600 }}>{`当前卷筛选：${activeVolume.volumeName}`}</div>
            <div style={{ fontSize: 12, opacity: 0.72 }}>{`第${activeVolume.chapterStart}-${activeVolume.chapterEnd}章 · 健康分 ${activeVolume.healthScore}`}</div>
          </div>
          <Button size="small" onClick={onClearVolume}>清除卷筛选</Button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.1fr) minmax(320px, 1.4fr)', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>风险分布</div>
          {summary.riskOverview.length > 0 ? summary.riskOverview.map((risk) => {
            const share = summary.criticalRiskCount + summary.warningRiskCount > 0
              ? Math.round((risk.count / Math.max(1, summary.criticalRiskCount + summary.warningRiskCount)) * 100)
              : 0
            return (
              <div key={risk.kind} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                  <span>{risk.label || qualityRiskKindLabel(risk.kind)}</span>
                  <span style={{ fontWeight: 600 }}>{risk.count}</span>
                </div>
                <Progress percent={share} showInfo={false} strokeColor={share >= 60 ? '#f5222d' : share >= 35 ? '#faad14' : '#52c41a'} size="small" />
              </div>
            )
          }) : <div style={{ fontSize: 12, opacity: 0.6 }}>风险分布目前稳定，暂时没有聚集型问题。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>建议先看的卷</div>
          {summary.recommendedFocusVolumes.length > 0 ? summary.recommendedFocusVolumes.map((volume) => (
            <button
              key={volume.volumeId}
              type="button"
              onClick={() => onSelectVolume(volume.volumeId)}
              style={{
                border: activeVolume?.volumeId === volume.volumeId ? '1px solid rgba(19,194,194,0.45)' : '1px solid rgba(255,255,255,0.08)',
                background: activeVolume?.volumeId === volume.volumeId ? 'rgba(19,194,194,0.08)' : 'rgba(255,255,255,0.02)',
                borderRadius: 10,
                padding: '12px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <strong>{volume.volumeName}</strong>
                <Tag color={volume.healthScore < 55 ? 'error' : volume.healthScore < 70 ? 'warning' : 'success'} style={{ marginRight: 0 }}>
                  健康分 {volume.healthScore}
                </Tag>
              </div>
              <div style={{ fontSize: 12, opacity: 0.72 }}>{volume.summary}</div>
            </button>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>各卷风险接近，可先处理正在写的卷。</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>全书最高优先风险</div>
        {summary.topRisks.length > 0 ? summary.topRisks.map((risk, index) => (
          <RepairRiskCard
            key={`${risk.kind}-${risk.title}-${index}`}
            risk={risk}
            onSelectRisk={onSelectRisk}
            onRunAction={onRunAction}
            repairingActionId={repairingActionId}
          />
        )) : <Empty description="当前全书级风险已压到可继续推进" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </div>
    </div>
  )
}

function VolumeHealthPanel({
  volumes,
  activeVolumeId,
  onSelectVolume,
  onSelectRisk,
  onRunAction,
  repairingActionId,
}: {
  volumes: QualityDashboardData['volumeQualityMetrics']
  activeVolumeId: number | null
  onSelectVolume: (volumeId: number | null) => void
  onSelectRisk: (risk: QualityRiskEntry) => void
  onRunAction: (action: QualityRepairAction) => void
  repairingActionId: string | null
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
      {volumes.map((volume) => {
        const isActive = activeVolumeId === volume.volumeId
        return (
          <div
            key={volume.volumeId}
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: isActive ? 'rgba(19,194,194,0.08)' : 'rgba(255,255,255,0.04)',
              border: isActive ? '1px solid rgba(19,194,194,0.35)' : '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong>{volume.volumeName}</strong>
                <div style={{ fontSize: 12, opacity: 0.65 }}>{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章 · 已分析 ${volume.analyzedChapterCount} 章`}</div>
              </div>
              <Button size="small" type={isActive ? 'primary' : 'default'} onClick={() => onSelectVolume(isActive ? null : volume.volumeId)}>
                {isActive ? '取消筛选' : '筛选此卷'}
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 11, opacity: 0.65 }}>健康分</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: healthScoreColor(volume.healthScore) }}>{volume.healthScore}</div>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 11, opacity: 0.65 }}>平均总分</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{volume.averageOverallScore}</div>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 11, opacity: 0.65 }}>平均 AI 味</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{volume.averageAiLikeRate}%</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', display: 'grid', gap: 4, fontSize: 12 }}>
                <div>{`语言恶化项：${volume.worseningMetricCount}`}</div>
                <div>{`停滞故事弧：${volume.stalledArcCount}`}</div>
                <div>{`高危弧告警：${volume.criticalArcAlertCount}`}</div>
                <div>{`节奏平衡分：${volume.rhythmBalanceScore}`}</div>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', display: 'grid', gap: 4, fontSize: 12 }}>
                <div>{`伏笔待回收：${volume.foreshadowPendingCount}`}</div>
                <div>{`伏笔已超期：${volume.foreshadowOverdueCount}`}</div>
                <div>{`终局待服务：${volume.endgamePendingCount}`}</div>
                <div>{`终局已过期：${volume.endgameOverdueCount}`}</div>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', display: 'grid', gap: 4, fontSize: 12 }}>
                <div>{`终局已进入执行链：${volume.endgameServedCount}`}</div>
                <div>{`终局未绑定：${volume.endgameUnboundCount}`}</div>
                <div>{`过期召回：${volume.staleRecallCount} (${volume.staleRecallRate}%)`}</div>
                <div>{`世界冲突：${volume.worldConflictAlertCount} · 预警：${volume.worldWarningCount}`}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>本卷最高优先风险</div>
                {volume.repeatedFunctionRunCount > 0 ? <Tag color="warning" style={{ marginRight: 0 }}>{`重复功能 ${volume.repeatedFunctionRunCount}`}</Tag> : null}
              </div>
              {volume.topRisks.length > 0 ? volume.topRisks.slice(0, 3).map((risk, index) => (
                <RepairRiskCard
                  key={`${volume.volumeId}-${risk.kind}-${index}`}
                  risk={risk}
                  onSelectRisk={onSelectRisk}
                  onRunAction={onRunAction}
                  repairingActionId={repairingActionId}
                  compact
                />
              )) : <div style={{ fontSize: 12, opacity: 0.6 }}>该卷暂未暴露高优先风险，适合继续写作或做局部修订。</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EndgameDebtPanel({
  alerts,
  onSelectRisk,
}: {
  alerts: QualityDashboardData['recentEndgameDebtAlerts']
  onSelectRisk: (risk: QualityRiskEntry) => void
}) {
  if (alerts.length <= 0) {
    return <Empty description="终局承诺暂时没有新增债务" />
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {alerts.map((alert) => (
        <button
          key={`endgame-debt-${alert.commitmentId}`}
          type="button"
          onClick={() => onSelectRisk({
            kind: 'endgame_debt',
            severity: alert.severity,
            title: alert.title,
            detail: alert.detail,
            chapterNums: alert.targetResolutionChapter ? [alert.targetResolutionChapter] : [],
            volumeId: alert.volumeId,
            metricKey: 'commitment_delivery',
            whyItHappened: '终局承诺已经接近计划兑现节点，但仍未被稳定服务或进入执行链。',
            howToFix: '补卷级绑定、章节合同或兑现桥段，并明确新的兑现节点。',
            suggestedActions: [],
          })}
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 10,
            padding: '12px 14px',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag color={getQualityRiskSeverityColor(alert.severity)} style={{ marginRight: 0 }}>
              {getQualityRiskSeverityLabel(alert.severity)}
            </Tag>
            <Tag color="blue" style={{ marginRight: 0 }}>{alert.kind === 'payoff' ? '终局回收' : '终局承诺'}</Tag>
            <strong>{alert.title}</strong>
          </div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>{alert.detail}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            {[
              alert.volumeName || '',
              typeof alert.targetResolutionChapter === 'number' ? `目标章位：第${alert.targetResolutionChapter}章` : '',
              `引用次数：${alert.referenceCount}`,
            ].filter(Boolean).join(' · ')}
          </div>
        </button>
      ))}
    </div>
  )
}

function ChapterFunctionPanel({
  summary,
  runs,
  alerts,
  volumeEntries,
}: {
  summary: QualityDashboardData['chapterFunctionSummary']
  runs: QualityDashboardData['repeatedFunctionRuns']
  alerts: QualityDashboardData['chapterFunctionAlerts']
  volumeEntries: QualityDashboardData['volumeChapterFunctions']
}) {
  if (summary.trackedChapterCount === 0 && alerts.length === 0) {
    return <Empty description="先完成章节功能分析，节奏分布会在这里展开" />
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>已标注章节</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.trackedChapterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>具备主功能或功能标签的章节数</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>功能覆盖率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.chapterPurposeCoverage}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>已被明确标注叙事职责的章节占比</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>节奏平衡分</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.rhythmBalanceScore}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            主功能偏向 {summary.dominantTag ? `${chapterFunctionLabel(summary.dominantTag)} ${summary.dominantTagShare}%` : '待分析'}
          </div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>最长重复链</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.longestRepeatedFunctionRun}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>连续重复主功能区段 {summary.repeatedFunctionRunCount} 处</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 600 }}>功能覆盖分布</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {CHAPTER_FUNCTION_ORDER.map((tag) => {
            const count = summary.tagCounts[tag] || 0
            const share = summary.trackedChapterCount > 0 ? Math.round((count / summary.trackedChapterCount) * 100) : 0
            return (
              <div key={tag} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${chapterFunctionColor(tag)}`, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{chapterFunctionLabel(tag)}</span>
                  <span style={{ fontSize: 12, color: chapterFunctionColor(tag) }}>{share}%</span>
                </div>
                <Progress percent={share} showInfo={false} strokeColor={chapterFunctionColor(tag)} size="small" />
                <div style={{ fontSize: 11, opacity: 0.6 }}>覆盖 {count} 章</div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>重复功能区段</div>
          {runs.length > 0 ? runs.slice(0, 8).map((run, index) => (
            <div key={`${run.startChapterNum}-${run.primaryTag}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={run.length >= 5 ? 'error' : 'warning'} style={{ marginRight: 0 }}>{chapterFunctionLabel(run.primaryTag)}</Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>第{run.startChapterNum}-{run.endChapterNum}章</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>连续 {run.length} 章都以 {chapterFunctionLabel(run.primaryTag)} 为主功能。</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>章节主功能没有出现连续空转。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期功能告警</div>
          {alerts.length > 0 ? alerts.slice(0, 8).map((alert, index) => (
            <div key={`${alert.code}-${index}-${alert.chapterNums.join('-')}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={chapterFunctionAlertColor(alert.severity)} style={{ marginRight: 0 }}>
                  {getStoryPacingSeverityLabel(alert.severity)}
                </Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>近期没有新的章节功能偏移。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级功能摘要</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div style={{ fontSize: 12 }}>
                  覆盖 {volume.trackedChapterCount} 章 · 平衡分 {volume.rhythmBalanceScore}
                </div>
                <div style={{ fontSize: 12 }}>
                  主功能偏向 {volume.dominantTag ? `${chapterFunctionLabel(volume.dominantTag)} ${volume.dominantTagShare}%` : '待分析'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {volume.repeatedRuns.slice(0, 2).map((run) => (
                    <Tag key={`${volume.volumeId}-${run.startChapterNum}-${run.primaryTag}`} color={run.length >= 5 ? 'error' : 'warning'} style={{ marginRight: 0 }}>
                      {chapterFunctionLabel(run.primaryTag)} {run.length}连
                    </Tag>
                  ))}
                  {volume.alerts.filter((alert) => alert.code === 'volume_function_skew').slice(0, 1).map((alert, index) => (
                    <Tag key={`${volume.volumeId}-skew-${index}`} color={chapterFunctionAlertColor(alert.severity)} style={{ marginRight: 0 }}>
                      偏科
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RecallReliabilityPanel({
  summary,
  alerts,
  volumeEntries,
}: {
  summary: QualityDashboardData['recallSummary']
  alerts: QualityDashboardData['recentRecallAlerts']
  volumeEntries: QualityDashboardData['volumeRecallDiagnostics']
}) {
  if (summary.analyzedChapterCount === 0 && alerts.length === 0) {
    return <Empty description="先产出召回样本，可靠性数据会在这里汇总" />
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>分析章节</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.analyzedChapterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>已纳入召回可靠性诊断的章节数</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>召回依赖率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.recallDependencyRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>实际保留下来的背景补充片段占比</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>召回可用率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.recallAvailabilityRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>最终 prompt 实际使用召回补充的章节占比</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>平均命中数</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.averageHitCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>每章平均召回到的历史片段数</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>过期召回</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.staleRecallCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>被识别为疑似过期的历史片段</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>过期召回率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.staleRecallRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>本地回查命中里疑似过期片段的平均占比</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>上章先验覆盖率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.previousChapterFeedCoverageRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>上一章先验采样覆盖上一章正文的平均比例</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Bucket 覆盖率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.bucketCoverageRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>角色 / 规则 / 线程三个桶的平均命中覆盖</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>上章先验字数</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.previousChapterFeedChars}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>每章平均喂入的上一章先验文本长度</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>连续降级章节</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.consecutiveFallbackChapters}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>{summary.latestFallbackReason ? `最近原因：${summary.latestFallbackReason}` : '召回链路目前稳定。'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期召回降级章节</div>
          {alerts.length > 0 ? alerts.map((alert) => (
            <div key={alert.chapterId} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={alert.degraded ? 'error' : 'warning'} style={{ marginRight: 0 }}>{alert.degraded ? '召回降级' : '过期召回'}</Tag>
                {alert.recallSnapshotSource ? (
                  <Tag color={recallSnapshotSourceColor(alert.recallSnapshotSource)} style={{ marginRight: 0 }}>
                    {recallSnapshotSourceLabel(alert.recallSnapshotSource)}
                  </Tag>
                ) : null}
                <span style={{ fontSize: 12, fontWeight: 600 }}>第{alert.chapterNum}章 · {alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的召回降级章节。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>诊断说明</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>质量看板会优先读取章节级持久化召回快照；旧任务快照会被兼容导入，老章节缺少快照时会自动回填当前状态，并区分真实运行与历史回填来源。</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>实际生成链路仍以硬约束和结构化状态为主，召回只作背景补充。</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>当前保留片段 {summary.selectedHitCount} 条，本地兜底命中 {summary.fallbackHitCount} 条。</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>召回可用率 {summary.recallAvailabilityRate}% ，平均命中 {summary.averageHitCount} 条，Bucket 覆盖 {summary.bucketCoverageRate}% 。</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>上一章先验平均覆盖 {summary.previousChapterFeedCoverageRate}% ，平均采样 {summary.previousChapterFeedChars} 字。</div>
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级召回诊断</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div style={{ fontSize: 12 }}>可用率 {volume.recallAvailabilityRate}% · 平均命中 {volume.averageHitCount} · Bucket {volume.bucketCoverageRate}%</div>
                <div style={{ fontSize: 12 }}>依赖率 {volume.recallDependencyRate}% · 过期 {volume.staleRecallCount} · 过期率 {volume.staleRecallRate}%</div>
                <div style={{ fontSize: 12 }}>降级 {volume.degradedChapterCount} 章{volume.latestFallbackReason ? ` · 最近原因 ${volume.latestFallbackReason}` : ''}</div>
                <div style={{ fontSize: 12 }}>上章先验覆盖 {volume.previousChapterFeedCoverageRate}% · 平均 {volume.previousChapterFeedChars} 字</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HeatmapChart({ data, chapterNums }: { data: QualityHeatmapPoint[]; chapterNums: number[] }) {
  const byDim = useMemo(() => {
    const map = new Map<string, Map<number, number>>()
    for (const p of data) {
      if (!map.has(p.dimension)) map.set(p.dimension, new Map())
      map.get(p.dimension)!.set(p.chapterNum, p.score)
    }
    return map
  }, [data])

  const dimensions = useMemo(() => {
    const seen = new Set<string>()
    for (const p of data) seen.add(p.dimension)
    return DIMENSION_NAMES.filter((d) => seen.has(d))
  }, [data])

  const displayNums = chapterNums.length > 50 ? chapterNums.filter((_, i) => i % Math.ceil(chapterNums.length / 50) === 0) : chapterNums

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `100px repeat(${displayNums.length}, 28px)`, gap: 2, fontSize: 11 }}>
        <div />
        {displayNums.map((num) => (
          <div key={num} style={{ textAlign: 'center', opacity: 0.6 }}>{num}</div>
        ))}
        {dimensions.map((dim) => (
          <React.Fragment key={dim}>
            <div style={{ lineHeight: '24px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dim}</div>
            {displayNums.map((num) => {
              const score = byDim.get(dim)?.get(num)
                return (
                  <div
                    key={num}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 3,
                      background: score != null ? heatmapCellColor(score) : 'rgba(255,255,255,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: '#fff',
                    }}
                  >
                    {score != null ? score : ''}
                  </div>
                )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function TrendChart({ overallTrend, aiLikeTrend }: {
  overallTrend: Array<{ chapterNum: number; score: number }>
  aiLikeTrend: Array<{ chapterNum: number; rate: number }>
}) {
  if (overallTrend.length === 0) return <Empty description="当前样本还不足以形成趋势" />

  const maxScore = 10
  const maxRate = 100
  const chartHeight = 200
  const chartWidth = Math.max(400, overallTrend.length * 16)

  const toScorePath = (points: Array<{ chapterNum: number; value: number }>, maxVal: number) => {
    if (points.length === 0) return ''
    const stepX = chartWidth / Math.max(points.length - 1, 1)
    return points.map((p, i) => {
      const x = i * stepX
      const y = chartHeight - (p.value / maxVal) * chartHeight
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    }).join(' ')
  }

  const overallPath = toScorePath(overallTrend.map((d) => ({ chapterNum: d.chapterNum, value: d.score })), maxScore)
  const aiLikePath = toScorePath(aiLikeTrend.map((d) => ({ chapterNum: d.chapterNum, value: d.rate })), maxRate)

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12 }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 3, background: '#52c41a', marginRight: 4 }} />总分 (0-10)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 3, background: '#f5222d', marginRight: 4 }} />AI 味率 (0-100%)</span>
      </div>
      <svg width={chartWidth} height={chartHeight + 20} style={{ minWidth: 400 }}>
        <path d={overallPath} fill="none" stroke="#52c41a" strokeWidth={2} />
        <path d={aiLikePath} fill="none" stroke="#f5222d" strokeWidth={1.5} strokeDasharray="4,3" />
        <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="rgba(255,255,255,0.1)" />
      </svg>
    </div>
  )
}

function WeakDimensionChart({ data }: { data: Array<{ dimension: string; count: number }> }) {
  const filtered = data.filter((d) => d.count > 0)
  if (filtered.length === 0) return <Empty description="当前维度表现稳定，没有持续走弱项" />

  const maxCount = Math.max(...filtered.map((d) => d.count), 1)

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {filtered.map((item) => (
        <div key={item.dimension} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 80, fontSize: 13, textAlign: 'right' }}>{item.dimension}</span>
          <div style={{ flex: 1, height: 20, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${(item.count / maxCount) * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #fa8c16, #f5222d)',
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
          <span style={{ width: 40, fontSize: 12, opacity: 0.7 }}>{item.count} 次</span>
        </div>
      ))}
    </div>
  )
}

const LANGUAGE_DRIFT_LABELS: Array<{ key: keyof LanguageDriftMetrics; label: string }> = [
  { key: 'abstractTokenDensity', label: '抽象词密度' },
  { key: 'sentencePatternRepeatRate', label: '句式重复率' },
  { key: 'endingSummaryRate', label: '段尾升华率' },
  { key: 'ornamentOverloadRate', label: '华丽词堆砌率' },
  { key: 'nonHumanCollocationRate', label: '非人类搭配率' },
]

function getTopLanguageDriftMetrics(metrics: LanguageDriftMetrics, limit = 3) {
  return [...LANGUAGE_DRIFT_LABELS]
    .map(({ key, label }) => ({ key, label, value: metrics[key] }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit)
}

function LanguageDriftPanel({
  averages,
  trends,
  recentAlerts,
  volumeEntries,
  novelSummary,
  antiAiRecurrence,
  feedbackRecurrence,
}: {
  averages: LanguageDriftMetrics
  trends: QualityDashboardData['languageDriftTrends']
  recentAlerts: QualityDashboardData['recentLanguageDriftAlerts']
  volumeEntries: QualityDashboardData['volumeLanguageDrift']
  novelSummary: QualityDashboardData['novelLanguageDriftSummary']
  antiAiRecurrence: QualityDashboardData['antiAiRecurrence']
  feedbackRecurrence: QualityDashboardData['feedbackRecurrence']
}) {
  const hasAnyData = LANGUAGE_DRIFT_LABELS.some(({ key }) => trends[key].length > 0)
  if (!hasAnyData) {
    return <Empty description="先生成 AI 味分解，才能判断问题来源" />
  }
  const cards = LANGUAGE_DRIFT_LABELS.map(({ key, label }) => ({ key, label, value: averages[key] }))
  const topRiskMetrics = novelSummary.topRiskMetrics.slice(0, 3)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {cards.map((card) => (
          <div
            key={card.key}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: languageDriftRiskColor(card.value) }}>{card.value}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>平均风险值，越低越好</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>全书级摘要</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            已纳入 {novelSummary.chapterCount} 章
            {novelSummary.recentWindowSize > 0 ? ` · 最近窗口 ${novelSummary.recentWindowSize} 章` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag color="error">恶化 {novelSummary.statusBreakdown.worsening}</Tag>
            <Tag color="success">改善 {novelSummary.statusBreakdown.improving}</Tag>
            <Tag>稳定 {novelSummary.statusBreakdown.stable}</Tag>
          </div>
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>当前最高优先问题</div>
          {topRiskMetrics.length > 0 ? topRiskMetrics.map((item) => (
            <div key={item.metric} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
              <span style={{ opacity: 0.85 }}>{item.label}</span>
              <span style={{ fontWeight: 600, color: languageDriftRiskColor(item.value) }}>{item.value}</span>
            </div>
          )) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>等待分解结果</div>
          )}
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>最近恶化项</div>
          {recentAlerts.length > 0 ? recentAlerts.slice(0, 3).map((alert) => (
            <div key={alert.metric} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Tag color={languageDriftStatusColor(alert.status)} style={{ marginRight: 0 }}>
                    {languageDriftStatusLabel(alert.status)}
                  </Tag>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>{alert.label}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f5222d' }}>{formatSignedValue(alert.delta)}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                窗口均值 {alert.previousValue} → {alert.latestValue}
              </div>
            </div>
          )) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内没有明显恶化项。</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: '命中章节', value: antiAiRecurrence.hitChapterCount, note: '至少命中过一次 anti-AI 规则的章节' },
          { label: '复现规则', value: antiAiRecurrence.recurringRuleCount, note: '跨章重复出现的问题类型' },
          { label: '已升级硬约束', value: antiAiRecurrence.promotedRuleCount, note: '连续 2 章命中后自动升级' },
          { label: '5章高风险', value: antiAiRecurrence.highRiskRuleCount, note: '5 章窗口内至少 3 次复现' },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{card.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>跨章高频问题</div>
          {antiAiRecurrence.topRepeatedRules.length > 0 ? antiAiRecurrence.topRepeatedRules.slice(0, 4).map((item) => (
            <div key={item.ruleCode} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{item.ruleTitle}</span>
                <Tag color={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
                  {`第 ${item.lastChapterNum} 章`}
                </Tag>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>
                {`命中 ${item.hitCount} 次 / 覆盖 ${item.chapterCount} 章`}
                {item.promotedCount > 0 ? ` · 已升级 ${item.promotedCount} 次` : ''}
              </div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前还没有跨章复现的 anti-AI 规则。</div>}
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>已升级为下一章硬约束</div>
          {antiAiRecurrence.promotedRules.length > 0 ? antiAiRecurrence.promotedRules.slice(0, 4).map((item) => (
            <div key={item.ruleCode} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{item.ruleTitle}</span>
                <Tag color="gold" style={{ marginRight: 0 }}>已前置</Tag>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>
                {`触发章节：${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}
              </div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的连续两章复现问题。</div>}
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期告警</div>
          {antiAiRecurrence.recentAlerts.length > 0 ? antiAiRecurrence.recentAlerts.slice(0, 4).map((alert) => (
            <div key={`${alert.ruleCode}-${alert.lastChapterNum}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.ruleTitle}</span>
                <Tag color={alert.severity === 'critical' ? 'error' : 'warning'} style={{ marginRight: 0 }}>
                  {alert.severity === 'critical' ? '需回查' : '已升级'}
                </Tag>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>近期没有新的 anti-AI 复现。</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {LANGUAGE_DRIFT_LABELS.map(({ key, label }) => (
          <MiniTrendRow key={key} label={label} points={trends[key]} />
        ))}
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级语言退化</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => {
              const topMetrics = getTopLanguageDriftMetrics(volume.averageMetrics, 2)
              return (
                <div
                  key={volume.volumeId}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>
                        第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章
                      </div>
                    </div>
                    <Tag color={volume.topWorseningMetrics.length > 0 ? 'warning' : 'success'} style={{ marginRight: 0 }}>
                      {volume.topWorseningMetrics.length > 0 ? `${volume.topWorseningMetrics.length} 项恶化` : '近期稳定'}
                    </Tag>
                  </div>

                  <div style={{ display: 'grid', gap: 6 }}>
                    {topMetrics.map((item) => (
                      <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                        <span style={{ opacity: 0.85 }}>{item.label}</span>
                        <span style={{ fontWeight: 600, color: languageDriftRiskColor(item.value) }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {volume.topWorseningMetrics.length > 0
                      ? `近期恶化：${volume.topWorseningMetrics.map((item) => `${item.label} ${formatSignedValue(item.delta)}`).join('、')}`
                      : '最近窗口内没有明显恶化项。'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {antiAiRecurrence.volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级 anti-AI 复现</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {antiAiRecurrence.volumeEntries.map((volume) => (
              <div
                key={volume.volumeId}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章`}</div>
                <div style={{ fontSize: 12 }}>{`命中章节 ${volume.hitChapterCount} · 复现规则 ${volume.recurringRuleCount}`}</div>
                <div style={{ fontSize: 12 }}>{`已升级 ${volume.promotedRuleCount} · 高风险 ${volume.highRiskRuleCount}`}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 600 }}>审校反哺与复现闭环</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { label: '命中章节', value: feedbackRecurrence.hitChapterCount, note: '至少出现一次通用复现问题的章节' },
            { label: '复现问题', value: feedbackRecurrence.recurringIssueCount, note: '跨章重复出现的问题类型' },
            { label: '已升级硬约束', value: feedbackRecurrence.promotedIssueCount, note: '连续 2 章或窗口高风险后自动前置' },
            { label: '建议暂停', value: feedbackRecurrence.pauseSuggestedIssueCount, note: '结构/连续性类高风险复现，建议暂停批量' },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{card.note}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { label: '人味命中章节', value: feedbackRecurrence.humanization.hitChapterCount, note: '模板衔接、解释腔、锚点不足、立场发虚等' },
            { label: '人味复现问题', value: feedbackRecurrence.humanization.recurringIssueCount, note: '跨章重复出现的人味问题类型' },
            { label: '人味已前置', value: feedbackRecurrence.humanization.promotedIssueCount, note: '下一章会作为硬约束注入的去 AI 味问题' },
            { label: '人味高风险', value: feedbackRecurrence.humanization.highRiskIssueCount, note: '5 章窗口内高频复现的人味问题' },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{card.note}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>跨章高频问题</div>
            {feedbackRecurrence.topRepeatedIssues.length > 0 ? feedbackRecurrence.topRepeatedIssues.slice(0, 4).map((item) => (
              <div key={item.issueType} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</span>
                  <Tag color={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
                    {`第 ${item.lastChapterNum} 章`}
                  </Tag>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>
                  {`命中 ${item.hitCount} 次 / 覆盖 ${item.chapterCount} 章`}
                  {item.promotedCount > 0 ? ` · 已升级 ${item.promotedCount} 次` : ''}
                </div>
              </div>
            )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前还没有跨章复现的通用审校问题。</div>}
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>已升级为下一章硬约束</div>
            {feedbackRecurrence.promotedIssues.length > 0 ? feedbackRecurrence.promotedIssues.slice(0, 4).map((item) => (
              <div key={item.issueType} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</span>
                  <Tag color={item.pauseSuggested ? 'error' : 'gold'} style={{ marginRight: 0 }}>
                    {item.pauseSuggested ? '高风险前置' : '已前置'}
                  </Tag>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>
                  {`触发章节：${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}
                </div>
              </div>
            )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的审校复现硬约束。</div>}
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>近期告警</div>
            {feedbackRecurrence.recentAlerts.length > 0 ? feedbackRecurrence.recentAlerts.slice(0, 4).map((alert) => (
              <div key={`${alert.issueType}-${alert.lastChapterNum}`} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
                  <Tag color={alert.pauseSuggested ? 'error' : alert.severity === 'critical' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
                    {alert.pauseSuggested ? '建议暂停' : alert.severity === 'critical' ? '需回查' : '已升级'}
                  </Tag>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
              </div>
            )) : <div style={{ fontSize: 12, opacity: 0.6 }}>近期没有新的审校复现。</div>}
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>人味前置约束</div>
            {feedbackRecurrence.humanization.promotedIssues.length > 0 ? feedbackRecurrence.humanization.promotedIssues.slice(0, 4).map((item) => (
              <div key={`humanization-${item.issueType}`} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</span>
                  <Tag color={item.pauseSuggested ? 'error' : 'gold'} style={{ marginRight: 0 }}>
                    {item.pauseSuggested ? '高风险前置' : '已前置'}
                  </Tag>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>{item.avoid}</div>
              </div>
            )) : feedbackRecurrence.humanization.topRepeatedIssues.length > 0 ? feedbackRecurrence.humanization.topRepeatedIssues.slice(0, 4).map((item) => (
              <div key={`humanization-trend-${item.issueType}`} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</span>
                  <Tag color={item.severity === 'high' ? 'error' : 'warning'} style={{ marginRight: 0 }}>
                    {`第 ${item.lastChapterNum} 章`}
                  </Tag>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>{item.detail}</div>
              </div>
            )) : <div style={{ fontSize: 12, opacity: 0.6 }}>风格硬约束目前稳定。</div>}
          </div>
        </div>

        {feedbackRecurrence.volumeEntries.length > 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 600 }}>卷级审校复现</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {feedbackRecurrence.volumeEntries.map((volume) => (
                <div
                  key={volume.volumeId}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章`}</div>
                  <div style={{ fontSize: 12 }}>{`命中章节 ${volume.hitChapterCount} · 复现问题 ${volume.recurringIssueCount}`}</div>
                  <div style={{ fontSize: 12 }}>{`已升级 ${volume.promotedIssueCount} · 高风险 ${volume.highRiskIssueCount}`}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MiniTrendRow({
  label,
  points,
}: {
  label: string
  points: Array<{ chapterNum: number; value: number }>
}) {
  if (points.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
        <span>{label}</span>
        <span>等待分解结果</span>
      </div>
    )
  }

  const width = Math.max(200, points.length * 12)
  const height = 36
  const stepX = width / Math.max(points.length - 1, 1)
  const path = points.map((point, index) => {
    const x = index * stepX
    const y = height - (Math.max(0, Math.min(100, point.value)) / 100) * height
    return `${index === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
  const latest = points[points.length - 1]?.value ?? 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 56px', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{label}</span>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={height + 4} style={{ minWidth: 200 }}>
          <path d={path} fill="none" stroke={languageDriftRiskColor(latest)} strokeWidth={2} />
        </svg>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: languageDriftRiskColor(latest) }}>{latest}</span>
    </div>
  )
}

function DialogueFingerprintPanel({
  stats,
  signatures,
  similarities,
  driftEntries,
  volumeEntries,
  alerts,
  voiceLockCandidates,
}: {
  stats: QualityDashboardData['dialogueFingerprintStats']
  signatures: QualityDashboardData['characterDialogueSignatures']
  similarities: QualityDashboardData['crossCharacterDialogueSimilarity']
  driftEntries: QualityDashboardData['dialogueDriftTrend']
  volumeEntries: QualityDashboardData['volumeDialogueSimilarity']
  alerts: QualityDashboardData['recentDialogueAlerts']
  voiceLockCandidates: QualityDashboardData['requiredDialogueVoiceLocks']
}) {
  if (stats.eligibleCharacterCount === 0) {
    return <Empty description="对白样本还不够，继续累积章节后再比对" />
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>已建角色指纹</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.eligibleCharacterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>累计识别对白 {stats.totalTurnCount} 段</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>平均跨角色相似度</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: dialogueSimilarityColor(stats.averageCrossCharacterSimilarity) }}>{stats.averageCrossCharacterSimilarity}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>越低越能拉开角色声音</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>高相似组合</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.highSimilarityPairCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>阈值 75 以上</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>漂移角色</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.driftingCharacterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>近期漂移率 45 以上</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>需 Voice Lock 角色</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.voiceLockCandidateCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>连续漂移或同声化预警</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期告警</div>
          {alerts.length > 0 ? alerts.map((alert, index) => (
            <div key={`${alert.kind}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={alert.severity === 'warning' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
                  {alert.kind === 'similarity' ? '同质化' : '漂移'}
                </Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的对白指纹告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>最高相似角色组合</div>
          {similarities.length > 0 ? similarities.slice(0, 4).map((pair) => (
            <div key={`${pair.characterAId}-${pair.characterBId}`} style={{ display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                <span>{pair.characterAName} / {pair.characterBName}</span>
                <span style={{ color: dialogueSimilarityColor(pair.similarity), fontWeight: 700 }}>{pair.similarity}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{pair.reasons.join('、') || '句长、停顿和惯用短语接近。'}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前样本还不足以计算跨角色相似度。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>需要 Voice Lock 的角色</div>
          {voiceLockCandidates.length > 0 ? voiceLockCandidates.slice(0, 5).map((candidate) => (
            <div key={`${candidate.characterId}-${candidate.severity}`} style={{ display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <strong style={{ fontSize: 12 }}>{candidate.characterName}</strong>
                <Tag color={candidate.severity === 'critical' ? 'error' : 'warning'} style={{ marginRight: 0 }}>
                  {candidate.severity === 'critical' ? '强制' : '建议'}
                </Tag>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{candidate.reason}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前角色声音区分度足够，不需要新增 voice lock。</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {signatures.slice(0, 6).map((signature) => (
          <div
            key={signature.characterId}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{signature.characterName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  {signature.sampleCount} 段对白 · {signature.totalDialogueChars} 字
                </div>
              </div>
              <Tag style={{ marginRight: 0 }}>{signature.roleType}</Tag>
            </div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{signature.voiceProfile}</div>
            {signature.distinctiveHabits.length > 0 ? (
              <div style={{ fontSize: 11, opacity: 0.65 }}>特点：{signature.distinctiveHabits.join('、')}</div>
            ) : null}
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              句长 {signature.avgSentenceLength} · 追问 {signature.questionRate}% · 停顿 {signature.ellipsisRate}% · 重复短语 {signature.catchphraseCandidates.slice(0, 2).map((item) => item.token).join('、') || '未捕捉'}
            </div>
          </div>
        ))}
      </div>

      {driftEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>角色语音漂移趋势</div>
          {driftEntries.slice(0, 5).map((entry) => (
            <div key={entry.characterId} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{entry.characterName}</strong>
                  <Tag color={dialogueTrendColor(entry.status)} style={{ marginRight: 0 }}>{dialogueTrendLabel(entry.status)}</Tag>
                </div>
                <span style={{ color: dialogueSimilarityColor(entry.recentDriftRate), fontWeight: 700 }}>{entry.recentDriftRate}</span>
              </div>
              <MiniTrendRow label="漂移率" points={entry.trend.map((point) => ({ chapterNum: point.chapterNum, value: point.value }))} />
              {entry.reasons.length > 0 ? <div style={{ fontSize: 11, opacity: 0.6 }}>{entry.reasons.join('、')}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级对白同质化</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <span style={{ color: dialogueSimilarityColor(volume.averageSimilarity), fontWeight: 700 }}>{volume.averageSimilarity}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>
                  {volume.topPairs.length > 0
                    ? `最像：${volume.topPairs.map((pair) => `${pair.characterAName}/${pair.characterBName} ${pair.similarity}`).join('、')}`
                    : '该卷样本还不够，暂时无法做稳定对比。'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsPanel({
  trend,
  alerts,
  protagonistSummary,
  costSummary,
  reversalSummary,
  volumeEntries,
}: {
  trend: QualityDashboardData['storyDynamicsTrend']
  alerts: QualityDashboardData['storyPacingAlerts']
  protagonistSummary: QualityDashboardData['protagonistSetbackSummary']
  costSummary: QualityDashboardData['costPersistenceSummary']
  reversalSummary: QualityDashboardData['reversalDistributionSummary']
  volumeEntries: QualityDashboardData['volumeStoryDynamics']
}) {
  if (protagonistSummary.chapterCount === 0) {
    return <Empty description="先积累主角受挫与高潮样本，再看节奏跟踪" />
  }

  const latestPressure = trend[trend.length - 1]?.pressure ?? 0

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>主角受挫率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{protagonistSummary.protagonistSetbackRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>重大受挫 {protagonistSummary.majorSetbackRate}%</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>平均主角压力</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: pressureColor(protagonistSummary.averagePressure) }}>{protagonistSummary.averagePressure}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>最新压力 {latestPressure}</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>顺推 / 压抑跨度</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{protagonistSummary.longestSmoothRun} / {protagonistSummary.longestPressureRun}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>最长连续章节数</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>代价持续</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{costSummary.averageCostDuration}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>蒸发 {costSummary.evaporatedCostCount} 次 · 未解 {costSummary.unresolvedCostCount} 条</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>节奏告警</div>
          {alerts.length > 0 ? alerts.slice(0, 4).map((alert, index) => (
            <div key={`${alert.code}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={getStoryPacingSeverityColor(alert.severity)} style={{ marginRight: 0 }}>{getStoryPacingSeverityLabel(alert.severity)}</Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内没有明显结构告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>反转 / 高潮 / 喘息</div>
          <div style={{ fontSize: 12 }}>反转：{reversalSummary.reversalChapterNums.length > 0 ? reversalSummary.reversalChapterNums.join('、') : '未记录'}</div>
          <div style={{ fontSize: 12 }}>高潮：{reversalSummary.climaxChapterNums.length > 0 ? reversalSummary.climaxChapterNums.join('、') : '未记录'}</div>
          <div style={{ fontSize: 12 }}>喘息：{reversalSummary.breatherChapterNums.length > 0 ? reversalSummary.breatherChapterNums.join('、') : '未记录'}</div>
          <div style={{ fontSize: 11, opacity: 0.65 }}>强行反转 {reversalSummary.forcedReversalCount} 次，弱反转 {reversalSummary.weakReversalCount} 次，高潮间距 {reversalSummary.climaxSpacing.length > 0 ? reversalSummary.climaxSpacing.join('、') : '未记录'}。</div>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>未解代价</div>
          {costSummary.activeCosts.length > 0 ? costSummary.activeCosts.map((entry) => (
            <div key={`${entry.startChapterNum}-${entry.summary}`} style={{ fontSize: 12 }}>
              第{entry.startChapterNum}章起持续 {entry.duration} 章：{entry.summary}
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>代价链目前都已收口或转入稳定阶段。</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>主角压力曲线</div>
        <MiniTrendRow label="主角压力" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.pressure }))} />
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级结构摘要</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <Tag color={volume.alerts.length > 0 ? 'warning' : 'success'} style={{ marginRight: 0 }}>{volume.alerts.length > 0 ? `${volume.alerts.length} 项告警` : '近期稳定'}</Tag>
                </div>
                <div style={{ fontSize: 12 }}>受挫率 {volume.protagonistSetbackRate}% · 重大受挫 {volume.majorSetbackRate}% · 平均压力 {volume.averagePressure}</div>
                <div style={{ fontSize: 12 }}>代价持续 {volume.averageCostDuration} 章 · 蒸发 {volume.evaporatedCostCount} 次</div>
                <div style={{ fontSize: 12 }}>高潮 {volume.climaxChapterNums.length > 0 ? volume.climaxChapterNums.join('、') : '未记录'} · 反转 {volume.reversalChapterNums.length > 0 ? volume.reversalChapterNums.join('、') : '未记录'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StoryArcProgressPanel({
  summary,
  trend,
  arcs,
  alerts,
  volumeEntries,
}: {
  summary: QualityDashboardData['storyArcProgressSummary']
  trend: QualityDashboardData['storyArcProgressTrend']
  arcs: QualityDashboardData['storyArcProgressArcs']
  alerts: QualityDashboardData['storyArcProgressAlerts']
  volumeEntries: QualityDashboardData['storyArcProgressVolumes']
}) {
  if (summary.trackedArcCount === 0 && alerts.length === 0) {
    return <Empty description="先积累故事弧推进样本，再看覆盖情况" />
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>跟踪故事弧</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.trackedArcCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>已进入推进分析层的主线与支线</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>推进章 / 空转章</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.progressChapterCount} / {summary.stalledChapterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>覆盖章节 {summary.coveredChapterCount}</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>停滞故事弧</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.stalledArcCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>连续空转过长或阶段未兑现</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>严重告警</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.criticalAlertCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>优先回查阶段收束和长段空转</div>
        </div>
      </div>

      {trend.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>推进 / 空转曲线</div>
          <MiniTrendRow label="推进章数" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.progressCount }))} />
          <MiniTrendRow label="空转章数" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.stalledCount }))} />
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期推进告警</div>
          {alerts.length > 0 ? alerts.slice(0, 6).map((alert, index) => (
            <div key={`${alert.code}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={getStoryArcSeverityColor(alert.severity)} style={{ marginRight: 0 }}>
                  {getStoryArcSeverityLabel(alert.severity)}
                </Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.arcName} · {alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的推进告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>故事弧摘要</div>
          {arcs.length > 0 ? arcs.slice(0, 6).map((arc) => (
            <div key={arc.arcId} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{arc.arcName}</div>
                <span style={{ color: arcProgressRateColor(arc.progressRate), fontWeight: 700 }}>{arc.progressRate}%</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{arc.statusSummary}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Tag color={arc.stallRate >= 70 ? 'error' : arc.stallRate >= 50 ? 'warning' : 'default'} style={{ marginRight: 0 }}>空转 {arc.stallRate}%</Tag>
                <Tag color={arc.missedPhaseCount > 0 ? 'error' : arc.hitPhaseCount > 0 ? 'processing' : 'default'} style={{ marginRight: 0 }}>
                  阶段 {arc.hitPhaseCount}/{arc.phaseTargets.length}
                </Tag>
              </div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>尚未形成可分析的故事弧。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级推进摘要</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                {volume.arcEntries.length > 0 ? volume.arcEntries.slice(0, 4).map((arcEntry) => (
                  <div key={`${volume.volumeId}-${arcEntry.arcId}`} style={{ fontSize: 12 }}>
                    {arcEntry.arcName}：推进 {arcEntry.progressRate}% · 空转 {arcEntry.stallRate}% · 阶段 {arcEntry.hitPhaseLabels.length}/{arcEntry.hitPhaseLabels.length + arcEntry.missedPhaseLabels.length}
                  </div>
                )) : <div style={{ fontSize: 12, opacity: 0.6 }}>本卷还没有足够的故事弧覆盖数据。</div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function worldStateSeverityColor(severity: QualityDashboardData['recentWorldStateAlerts'][number]['severity']): string {
  if (severity === 'critical') return 'red'
  if (severity === 'warning') return 'orange'
  return 'default'
}

function worldStateEntityLabel(entityType: QualityDashboardData['recentWorldStateAlerts'][number]['entityType']): string {
  if (entityType === 'character') return '人物'
  if (entityType === 'faction') return '势力'
  if (entityType === 'item') return '物品'
  if (entityType === 'relation') return '关系'
  return '地点'
}

function WorldStateStabilityPanel({
  trend,
  alerts,
  conflictEntities,
  summary,
  volumeEntries,
}: {
  trend: QualityDashboardData['worldStateTrend']
  alerts: QualityDashboardData['recentWorldStateAlerts']
  conflictEntities: QualityDashboardData['worldConflictEntities']
  summary: QualityDashboardData['worldStateSummary']
  volumeEntries: QualityDashboardData['volumeWorldStateStability']
}) {
  if (summary.trackedEntityCount === 0 && alerts.length === 0) {
    return <Empty description="先积累状态回写样本，再看稳定性数据" />
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>跟踪实体</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.trackedEntityCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>统一总账已接管的人物与世界实体</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>状态跳变</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.driftAlertCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>缺少事件承接的跨章节变化</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>状态冲突</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.conflictAlertCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>不可用物品、敌对关系等矛盾状态</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>预警快照</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.warningCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>账本中缺少原因或阻塞状态的记录数</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>世界状态概览</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>人物 {summary.trackedByType.character} · 势力 {summary.trackedByType.faction} · 物品 {summary.trackedByType.item}</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>关系 {summary.trackedByType.relation} · 地点 {summary.trackedByType.location}</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>冲突实体 {summary.conflictEntityCount} · 严重告警 {summary.criticalCount}</div>
          {summary.recentConflictEntities.length > 0 ? (
            <div style={{ fontSize: 11, opacity: 0.6 }}>近期命中：{summary.recentConflictEntities.join('、')}</div>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.6 }}>最近没有新的冲突实体。</div>
          )}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期阻塞实体</div>
          {alerts.length > 0 ? alerts.slice(0, 5).map((alert, index) => (
            <div key={`${alert.summary}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={worldStateSeverityColor(alert.severity)} style={{ marginRight: 0 }}>{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{worldStateEntityLabel(alert.entityType)} · {alert.entityName}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.summary}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内没有新的状态告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>跨章节趋势</div>
          <MiniTrendRow label="状态跳变" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.driftCount }))} />
          <MiniTrendRow label="状态冲突" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.conflictCount }))} />
          <MiniTrendRow label="预警快照" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.warningCount }))} />
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>冲突实体列表</div>
          {conflictEntities.length > 0 ? conflictEntities.slice(0, 5).map((entity, index) => (
            <div key={`${entity.entityType}-${entity.entityId}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={worldStateSeverityColor(entity.severity)} style={{ marginRight: 0 }}>
                  {entity.conflictCount > 0 ? '冲突实体' : '跳变实体'}
                </Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{worldStateEntityLabel(entity.entityType)} · {entity.entityName}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{entity.reasons.join('；') || entity.summaryText}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>世界状态目前没有需要优先回查的冲突实体。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级状态摘要</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div style={{ fontSize: 12 }}>跳变 {volume.driftAlertCount} · 冲突 {volume.conflictAlertCount} · 预警 {volume.warningCount}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ChapterGateDetails({ chapterGate }: { chapterGate?: QualityDashboardData['chapterDetails'][number]['chapterGate'] }) {
  if (!chapterGate?.latest) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章还没有章节验收门历史</div>
  }

  const latest = chapterGate.latest
  const drift = chapterGate.drift
  const dimensions = [
    { label: '连续性', value: latest.scoreBreakdown.continuityScore },
    { label: '结构连贯', value: latest.scoreBreakdown.coherenceScore },
    { label: '对白辨识', value: latest.scoreBreakdown.dialogueVoiceScore },
    { label: '钩子强度', value: latest.scoreBreakdown.hookStrengthScore },
    { label: '主角与节奏', value: latest.scoreBreakdown.storyDynamicsScore },
    { label: '语言自然度', value: latest.scoreBreakdown.languageNaturalnessScore },
  ]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>章节验收门</strong>
        <Tag color={chapterGateLevelColor(latest.gateLevel)} style={{ marginRight: 0 }}>{chapterGateLevelLabel(latest.gateLevel)}</Tag>
        <Tag color={chapterGateBandColor(chapterGateScoreBand(latest.scoreBreakdown.totalScore))} style={{ marginRight: 0 }}>
          {chapterGateBandLabel(chapterGateScoreBand(latest.scoreBreakdown.totalScore))}
        </Tag>
        <span style={{ fontWeight: 700, color: chapterGateHeatmapColor(latest.scoreBreakdown.totalScore) }}>{`总分 ${latest.scoreBreakdown.totalScore}`}</span>
      </div>
      <div style={{ fontSize: 12 }}>{latest.summary}</div>
      {drift ? (
        <div style={{ fontSize: 12, color: drift.status === 'worsening' ? '#ff7875' : drift.status === 'improving' ? '#95de64' : 'rgba(255,255,255,0.72)' }}>
          {drift.summary}
        </div>
      ) : null}
      {dimensions.map((dimension) => (
        <div key={dimension.label} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{dimension.label}</span>
            <span style={{ fontWeight: 600, color: chapterGateHeatmapColor(dimension.value) }}>{dimension.value}</span>
          </div>
          <Progress percent={dimension.value} showInfo={false} strokeColor={chapterGateHeatmapColor(dimension.value)} size="small" />
        </div>
      ))}
      {chapterGate.history.length > 1 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>最近门变更</div>
          {chapterGate.history.slice(0, 3).map((entry) => (
            <div key={`${entry.id}-${entry.createdAt}`} style={{ fontSize: 12, opacity: 0.78 }}>
              {new Date(entry.createdAt).toLocaleString()} · {chapterGateLevelLabel(entry.gateLevel)} · 总分 {entry.scoreBreakdown.totalScore}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LanguageDriftDetails({ metrics }: { metrics?: LanguageDriftMetrics }) {
  if (!metrics) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章还没有 AI 味分解数据</div>
  }

  const ranked = getTopLanguageDriftMetrics(metrics, LANGUAGE_DRIFT_LABELS.length)

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>AI 味分解</div>
      {ranked.map((item) => (
        <div key={item.key} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{item.label}</span>
            <span style={{ color: languageDriftRiskColor(item.value), fontWeight: 600 }}>{item.value}</span>
          </div>
          <Progress percent={item.value} showInfo={false} strokeColor={languageDriftRiskColor(item.value)} size="small" />
        </div>
      ))}
    </div>
  )
}

function AntiAiRuleHitDetails({ hits }: { hits?: QualityDashboardData['chapterDetails'][number]['antiAiRuleHits'] }) {
  if (!hits || hits.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章没有持久化 anti-AI 命中</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>本章 anti-AI 命中</div>
      {hits.map((hit) => (
        <div key={`${hit.ruleCode}-${hit.excerpt}`} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag color={hit.severity === 'high' ? 'error' : hit.severity === 'medium' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
              {hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}
            </Tag>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{hit.ruleTitle}</span>
            <Tag color={hit.source === 'language_drift' ? 'blue' : 'purple'} style={{ marginRight: 0 }}>
              {hit.source === 'language_drift' ? '漂移' : '护栏'}
            </Tag>
            {hit.promotedToHardConstraint ? <Tag color="gold" style={{ marginRight: 0 }}>已升级硬约束</Tag> : null}
          </div>
          {hit.excerpt ? <div style={{ fontSize: 12, opacity: 0.72 }}>{hit.excerpt}</div> : null}
        </div>
      ))}
    </div>
  )
}

function FeedbackRecurrenceDetails({ hits }: { hits?: QualityDashboardData['chapterDetails'][number]['feedbackRecurrenceHits'] }) {
  if (!hits || hits.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章没有通用复现问题</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>本章审校复现信号</div>
      {hits.map((hit) => (
        <div key={`${hit.issueType}-${hit.source}`} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag color={hit.severity === 'high' ? 'error' : hit.severity === 'medium' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
              {hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}
            </Tag>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{hit.title}</span>
            <Tag color={hit.source === 'chapter_gate' ? 'purple' : hit.source === 'contract_validation' ? 'blue' : hit.source === 'anti_ai' ? 'gold' : 'default'} style={{ marginRight: 0 }}>
              {hit.source === 'chapter_gate' ? '章节门' : hit.source === 'contract_validation' ? '合同校验' : hit.source === 'anti_ai' ? 'anti-AI' : '审校'}
            </Tag>
            {hit.promotedToHardConstraint ? <Tag color="gold" style={{ marginRight: 0 }}>已升级硬约束</Tag> : null}
            {hit.pauseSuggested ? <Tag color="error" style={{ marginRight: 0 }}>建议暂停</Tag> : null}
          </div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>{hit.detail}</div>
        </div>
      ))}
    </div>
  )
}

function StyleComplianceDetails({ styleCompliance }: { styleCompliance?: QualityDashboardData['chapterDetails'][number]['styleCompliance'] }) {
  if (!styleCompliance) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章未启用风格硬约束校验</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>风格硬约束</div>
        <Tag color={styleCompliance.status === 'rewrite' ? 'error' : styleCompliance.status === 'warning' ? 'warning' : 'success'} style={{ marginRight: 0 }}>
          {styleCompliance.status === 'rewrite' ? '重写' : styleCompliance.status === 'warning' ? '预警' : '通过'}
        </Tag>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{`得分 ${styleCompliance.score}`}</span>
      </div>
      <div style={{ fontSize: 12 }}>{styleCompliance.summary}</div>
      <div style={{ fontSize: 12 }}>
        指标：
        {` 句长 ${styleCompliance.actualMetrics.avgSentenceLength}/${styleCompliance.referenceMetrics.avgSentenceLength}`}
        {` · 段长 ${styleCompliance.actualMetrics.avgParagraphLength}/${styleCompliance.referenceMetrics.avgParagraphLength}`}
        {` · 对话占比 ${styleCompliance.actualMetrics.dialogueLineRate}%/${styleCompliance.referenceMetrics.dialogueLineRate}%`}
        {` · 抽象词 ${styleCompliance.actualMetrics.abstractTokenDensity}%/${styleCompliance.referenceMetrics.abstractTokenDensity}%`}
      </div>
      {styleCompliance.deviations.length > 0 ? (
        <div style={{ fontSize: 12 }}>偏移：{styleCompliance.deviations.join('；')}</div>
      ) : null}
      {styleCompliance.matchedForbiddenPatterns.length > 0 ? (
        <div style={{ fontSize: 12 }}>禁用表达：{styleCompliance.matchedForbiddenPatterns.join('、')}</div>
      ) : null}
      {styleCompliance.rewriteHints.length > 0 ? (
        <div style={{ fontSize: 12 }}>修正：{styleCompliance.rewriteHints.join('；')}</div>
      ) : null}
    </div>
  )
}

function DialogueReviewDetails({ review }: { review?: QualityDashboardData['chapterDetails'][number]['dialogueReview'] }) {
  if (!review) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章对白样本不足，暂时无法评估辨识度</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>角色对白辨识度</div>
      {review.fingerprintSummary ? <div style={{ fontSize: 12 }}>{review.fingerprintSummary}</div> : null}
      {review.voiceLockSummary ? <div style={{ fontSize: 12 }}>Voice Lock：{review.voiceLockSummary}</div> : null}
      {review.risks.length > 0 ? (
        <div style={{ fontSize: 12 }}>风险：{review.risks.join('；')}</div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7 }}>当前章没有明确的对白同质化风险。</div>
      )}
      {review.fillerRisks.length > 0 ? (
        <div style={{ fontSize: 12 }}>空转：{review.fillerRisks.join('；')}</div>
      ) : null}
      {review.infoDensityRisks.length > 0 ? (
        <div style={{ fontSize: 12 }}>信息密度：{review.infoDensityRisks.join('；')}</div>
      ) : null}
      {review.requiredVoiceLockCharacterIds.length > 0 ? (
        <div style={{ fontSize: 12 }}>需锁角色 ID：{review.requiredVoiceLockCharacterIds.join('、')}</div>
      ) : null}
      {review.similarities.length > 0 ? (
        <div style={{ fontSize: 12 }}>
          高相似：{review.similarities.map((item) => `${item.characterAName}/${item.characterBName} ${item.similarity}`).join('、')}
        </div>
      ) : null}
      {review.drifts.length > 0 ? (
        <div style={{ fontSize: 12 }}>
          漂移：{review.drifts.map((item) => `${item.characterName} ${item.driftRate}`).join('、')}
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsDetails({ dynamics }: { dynamics?: QualityDashboardData['chapterDetails'][number]['storyDynamics'] }) {
  if (!dynamics) return null

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>主角与节奏</div>
      <div style={{ fontSize: 12 }}>主角受挫：{dynamics.protagonistSetback}{dynamics.setbackSummary ? ` · ${dynamics.setbackSummary}` : ''}</div>
      <div style={{ fontSize: 12 }}>主角压力：<span style={{ color: pressureColor(dynamics.protagonistPressure), fontWeight: 600 }}>{dynamics.protagonistPressure}</span></div>
      <div style={{ fontSize: 12 }}>代价：{dynamics.costPresent ? `${dynamics.costResolutionState || 'new'}${dynamics.costSummary ? ` · ${dynamics.costSummary}` : ''}` : '无明确代价'}</div>
      <div style={{ fontSize: 12 }}>反转：{dynamics.reversalMarker ? `${dynamics.reversalSupportState || 'weak'}${dynamics.reversalSummary ? ` · ${dynamics.reversalSummary}` : ''}` : '无'}</div>
      <div style={{ fontSize: 12 }}>节奏标签：{paceMarkerLabel(dynamics.paceMarker)} · 阶段回报：{dynamics.rewardState}</div>
    </div>
  )
}

function ChapterFunctionDetails({ chapterFunction }: { chapterFunction?: QualityDashboardData['chapterDetails'][number]['chapterFunction'] }) {
  if (!chapterFunction) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章还没有章节功能标注</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>章节功能</div>
      <div style={{ fontSize: 12 }}>
        主功能：{chapterFunction.primaryTag ? chapterFunctionLabel(chapterFunction.primaryTag) : '未标注'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chapterFunction.tags.length > 0 ? chapterFunction.tags.map((tag) => (
          <Tag key={tag} color={chapterFunctionColor(tag)} style={{ marginRight: 0 }}>
            {chapterFunctionLabel(tag)}
          </Tag>
        )) : <span style={{ fontSize: 12, opacity: 0.7 }}>待标注</span>}
      </div>
      <div style={{ fontSize: 12 }}>
        重复链：{chapterFunction.repeatedFunctionRunLength > 0
          ? `连续 ${chapterFunction.repeatedFunctionRunLength} 章`
          : '当前不在重复主功能链中'}
      </div>
      {chapterFunction.repeatedFunctionRange ? (
        <div style={{ fontSize: 12, opacity: 0.72 }}>
          区段：第{chapterFunction.repeatedFunctionRange.startChapterNum}-{chapterFunction.repeatedFunctionRange.endChapterNum}章
        </div>
      ) : null}
      {chapterFunction.keyChapterRisk ? (
        <div style={{ fontSize: 12, color: '#faad14' }}>
          {chapterFunction.keyChapterRisk === 'missing_primary'
            ? '关键章节缺少主功能标签，建议补出本章真正承担的叙事职责。'
            : '当前章节属于关键节奏节点，但主功能偏弱，建议补出推进、回收、反转或爆发。'}
        </div>
      ) : null}
    </div>
  )
}

function StoryArcProgressDetails({ progress }: { progress?: QualityDashboardData['chapterDetails'][number]['storyArcProgress'] }) {
  if (!progress || progress.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章还没有故事弧推进数据</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>故事弧推进</div>
      {progress.map((entry) => (
        <div key={`${entry.arcId}-${entry.chapterId}`} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{entry.arcName}</span>
            <Tag color={entry.progressHit ? 'success' : 'default'} style={{ marginRight: 0 }}>{entry.progressHit ? '推进章' : '空转章'}</Tag>
            {entry.checkpointPhaseLabels.map((label) => <Tag key={`${entry.arcId}-${label}`} color={entry.progressHit ? 'processing' : 'warning'} style={{ marginRight: 0 }}>{label}</Tag>)}
          </div>
          <div style={{ fontSize: 12 }}>推进度：{entry.progressPercent}%{entry.arcProgressText ? ` · ${entry.arcProgressText}` : ''}</div>
          {entry.reviewRisks.length > 0 ? <div style={{ fontSize: 12 }}>审校风险：{entry.reviewRisks.join('；')}</div> : null}
          {entry.alertDetails.length > 0 ? <div style={{ fontSize: 12, opacity: 0.72 }}>告警：{entry.alertDetails.join('；')}</div> : null}
        </div>
      ))}
    </div>
  )
}

function RecallDiagnosticsDetails({
  diagnostics,
  snapshot,
  recallSnapshotSource,
}: {
  diagnostics?: QualityDashboardData['chapterDetails'][number]['recallDiagnostics']
  snapshot?: QualityDashboardData['chapterDetails'][number]['recallSnapshot']
  recallSnapshotSource?: QualityDashboardData['chapterDetails'][number]['recallSnapshotSource']
}) {
  if (!diagnostics && !snapshot) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章还没有召回可靠性数据</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>召回可靠性</div>
        {recallSnapshotSource ? (
          <Tag color={recallSnapshotSourceColor(recallSnapshotSource)} style={{ marginRight: 0 }}>
            {recallSnapshotSourceLabel(recallSnapshotSource)}
          </Tag>
        ) : null}
      </div>
      {snapshot ? (
        <div style={{ fontSize: 12 }}>
          运行结果：{snapshot.retrievalUsed ? '实际使用召回' : '未实际使用召回'}
          {snapshot.degraded ? ` · 已降级${snapshot.fallbackReason ? `：${snapshot.fallbackReason}` : ''}` : ' · 未降级'}
          {' '}· 总命中：{snapshot.hitCount}
        </div>
      ) : null}
      {diagnostics ? (
        <div style={{ fontSize: 12 }}>召回依赖率：{diagnostics.recallDependencyRate}% · 过期召回率：{diagnostics.staleRecallRate}%</div>
      ) : null}
      {diagnostics ? (
        <div style={{ fontSize: 12 }}>可用片段：{diagnostics.selectedHitCount} · 过期片段：{diagnostics.staleRecallCount} · 兜底命中：{diagnostics.fallbackHitCount}</div>
      ) : null}
      {diagnostics && diagnostics.summaryLines.length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.72 }}>{diagnostics.summaryLines.join(' ')}</div>
      ) : null}
    </div>
  )
}

function WorldStateAlertDetails({ alerts }: { alerts?: QualityDashboardData['chapterDetails'][number]['worldStateAlerts'] }) {
  if (!alerts || alerts.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章没有状态稳定性告警</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>状态稳定性</div>
      {alerts.map((alert, index) => (
        <div key={`${alert.summary}-${index}`} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color={worldStateSeverityColor(alert.severity)} style={{ marginRight: 0 }}>{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{worldStateEntityLabel(alert.entityType)} · {alert.entityName}</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{alert.summary}</div>
        </div>
      ))}
    </div>
  )
}
