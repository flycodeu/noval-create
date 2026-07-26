import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Skeleton, Spin, Tabs, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { QualityDashboardData, QualityRepairAction, TaskPipelineStats } from '../../../types'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import './index.css'
import RecommendationGovernancePanel from './RecommendationGovernancePanel'
import {
  buildRepairActionTargetPath,
  buildRepairResultTargetPath,
  filterDashboardByVolume,
  findChapterByNum,
  historicalModeLabel,
  precomputeQueueStatusLabel,
  promptSummaryModeLabel,
  runtimePressureLevelLabel,
  sourceCoverageLabel,
} from './quality-dashboard-presentation'
import type { QualityChapterEntry, QualityRiskEntry } from './quality-dashboard-presentation'
import ChapterDetailModal from './sections/ChapterDetailModal'

const OverviewSection = React.lazy(() => import('./sections/OverviewSection'))
const LanguageSection = React.lazy(() => import('./sections/LanguageSection'))
const StructureSection = React.lazy(() => import('./sections/StructureSection'))
const StabilitySection = React.lazy(() => import('./sections/StabilitySection'))

interface Props { novelId: number }

function getQualityChapterListHeight(): number {
  if (typeof window === 'undefined') return 480
  return Math.min(720, Math.max(420, Math.round(window.innerHeight * 0.56)))
}

export default function QualityDashboard({ novelId }: Props) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState<QualityDashboardData | null>(null)
  const [pipelineStats, setPipelineStats] = useState<TaskPipelineStats | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<QualityChapterEntry | null>(null)
  const [selectedVolumeId, setSelectedVolumeId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [repairingActionId, setRepairingActionId] = useState<string | null>(null)
  const [chapterListHeight, setChapterListHeight] = useState(getQualityChapterListHeight)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)

  const loadData = useCallback(async (showLoading = false) => {
    const requestId = ++loadRequestRef.current
    if (showLoading || !loadedOnceRef.current) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
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
      if (loadRequestRef.current !== requestId) return
      setData(result)
      setPipelineStats(nextPipelineStats)
      setLoadError(null)
      setSelectedChapter((current) => current
        ? result.chapterDetails.find((entry) => entry.chapterNum === current.chapterNum && entry.volumeId === current.volumeId) || null
        : null)
      loadedOnceRef.current = true
    } catch (error) {
      if (loadRequestRef.current !== requestId) return
      console.error('Failed to load quality dashboard', error)
      setPipelineStats(null)
      setLoadError(error instanceof Error && error.message ? error.message : getUserFacingMessage('common.loadFailed'))
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [novelId])

  useEffect(() => { void loadData(true) }, [loadData])
  useEffect(() => {
    if (!data || selectedVolumeId == null) return
    if (!data.volumeQualityMetrics.some((entry) => entry.volumeId === selectedVolumeId)) {
      setSelectedVolumeId(null)
    }
  }, [data, selectedVolumeId])
  useEffect(() => {
    const handleResize = () => setChapterListHeight(getQualityChapterListHeight())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  if (loading && !data) {
    return (
      <WorkspacePage title="质量监控">
        <WorkspacePanel title="正在汇总质量数据">
          <Skeleton active paragraph={{ rows: 10 }} />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (loadError && !data) {
    return (
      <WorkspacePage title="质量监控" description="质量数据暂时不可用，修复连接后再继续判断是否适合进入正文生产。">
        <WorkspacePanel title="质量数据加载失败">
          <Alert
            type="error"
            showIcon
            message="没有拿到可靠的质量数据"
            description={loadError}
            action={<Button onClick={() => void loadData(true)}>重试</Button>}
          />
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
  const hasAgentQualityData = Boolean(data && (data.agentQualityObservability?.summary.artifactCount || 0) > 0)

  if (!data || (!hasScoreData && !hasChapterGateData && !hasStoryDynamicsData && !hasArcProgressData && !hasDialogueData && !hasStateData && !hasRecallData && !hasChapterFunctionData && !hasEndgameDebtData && !hasPipelineData && !hasAgentQualityData)) {
    return (
      <WorkspacePage title="质量监控">
        <RecommendationGovernancePanel novelId={novelId} />
        <WorkspacePanel title="先产出首轮检测">
          <Empty description="先在正文页运行章节审校、AI 体检或写作流水线，质量页才会开始累计趋势、风险和修复动作。">
            <Button type="primary" onClick={() => navigate(buildWorkspaceRoute(novelId, 'writing'))}>
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
  const filtered = filterDashboardByVolume(data, selectedVolumeMetrics)
  const openChapterByNum = (chapterNum: number) => {
    const matched = findChapterByNum(data.chapterDetails, chapterNum)
    if (!matched) return
    if (typeof matched.volumeId === 'number') setSelectedVolumeId(matched.volumeId)
    setSelectedChapter(matched)
  }
  const handleRiskSelect = (risk: QualityDashboardData['novelQualityMetrics']['topRisks'][number]) => {
    if (typeof risk.volumeId === 'number') setSelectedVolumeId(risk.volumeId)
    const chapterNum = risk.chapterNums[0]
    if (typeof chapterNum === 'number') openChapterByNum(chapterNum)
  }

  return (
    <WorkspacePage
      title="质量监控"
      metrics={[
        <WorkspaceMetric key="ready" label="生产就绪度" value={`${data.productionReadiness.readyRate}%`} tone="warm" />,
        <WorkspaceMetric key="mode" label="运行模式" value={data.operatingModeObservability?.label || '未推导'} hint={data.operatingModeObservability ? `篇幅参考约 ${data.operatingModeObservability.recommendedChapterWords || 0} 字/章（弹性）· 预计 ${data.operatingModeObservability.estimatedChapterCount || 0} 章 · 近期窗口 ${data.operatingModeObservability.recentContextWindow || 0} 章` : undefined} />,
        <WorkspaceMetric key="runtime-guardrail" label="运行时护栏" value={data.millionRuntimeObservability?.serialOnly ? '正文串行' : '未接管'} hint={data.millionRuntimeObservability ? `${data.millionRuntimeObservability.backgroundPrecomputeEnabled ? '后台预计算已开' : '后台预计算关闭'} · 召回阈值 ${data.millionRuntimeObservability.recallPauseThreshold} · 压力 ${runtimePressureLevelLabel(data.millionRuntimeObservability.runtimePressureLevel)}` : undefined} tone={data.millionRuntimeObservability?.guardrailActive ? 'warm' : 'default'} />,
        <WorkspaceMetric key="provenance" label="来源与模式" value={`引用未解析 ${data.typedRefObservability?.unresolvedRefCount || 0} / ${sourceCoverageLabel(data.genreGroundingObservability?.sourceCoverage)} / ${data.millionRuntimeObservability?.guardrailActive ? '护栏中' : '空闲'}`} hint={data.millionRuntimeObservability ? `引用覆盖 ${data.typedRefObservability?.overallCoverageRate || 0}% · 预计算 ${precomputeQueueStatusLabel(data.millionRuntimeObservability.precomputeQueueStatus)}` : undefined} tone={(data.typedRefObservability?.unresolvedRefCount || 0) > 0 || data.genreGroundingObservability?.conservativeFallbackActive || data.millionRuntimeObservability?.guardrailActive ? 'warm' : 'default'} />,
        <WorkspaceMetric key="grounding" label="题材支撑" value={data.genreGroundingObservability?.historicalGenericFallback ? '待修复' : (data.genreGroundingObservability?.genreName || data.genreGroundingObservability?.resolvedGenreKey || '未命中')} hint={data.genreGroundingObservability?.historicalMode && data.genreGroundingObservability.historicalMode !== 'none' ? `${historicalModeLabel(data.genreGroundingObservability.historicalMode)} · 来源 ${sourceCoverageLabel(data.genreGroundingObservability.sourceCoverage)} · 信号 ${data.genreGroundingObservability.sourceSignalCount || 0}` : undefined} tone={data.genreGroundingObservability?.historicalGenericFallback || data.genreGroundingObservability?.conservativeFallbackActive ? 'warm' : 'default'} />,
        <WorkspaceMetric key="memory" label="结构化记忆" value={data.structuredMemoryObservability ? `${data.structuredMemoryObservability.cardCoverageRate}% / ${data.structuredMemoryObservability.fallbackScopeCount}` : '未统计'} hint={data.structuredMemoryObservability ? `${data.structuredMemoryObservability.activeScopeLabels.join(' / ') || '无范围'} · ${promptSummaryModeLabel(data.structuredMemoryObservability.promptSummaryMode)}` : undefined} tone={data.structuredMemoryObservability && data.structuredMemoryObservability.fallbackScopeCount > 0 ? 'warm' : 'default'} />,
        <WorkspaceMetric key="typed-ref" label="引用覆盖" value={data.typedRefObservability ? `${data.typedRefObservability.overallCoverageRate}% / ${data.typedRefObservability.unresolvedRefCount}` : '未统计'} tone={data.typedRefObservability && data.typedRefObservability.unresolvedRefCount > 0 ? 'warm' : 'default'} />,
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
      {refreshing ? <div className="novel-dashboard__refresh-indicator quality-dashboard-page__refresh"><Spin size="small" /><span>正在同步质量监控数据</span></div> : null}
      <div className="quality-dashboard-page__toolbar">
        <Button loading={refreshing} onClick={() => void loadData()}>
          刷新质量数据
        </Button>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: '总览',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <OverviewSection
                  novelId={novelId}
                  data={data}
                  pipelineStats={pipelineStats}
                  filtered={filtered}
                  selectedVolumeMetrics={selectedVolumeMetrics}
                  selectedVolumeId={selectedVolumeId}
                  hasScoreData={hasScoreData}
                  chapterListHeight={chapterListHeight}
                  repairingActionId={repairingActionId}
                  onSelectVolume={setSelectedVolumeId}
                  onSelectRisk={handleRiskSelect}
                  onRunAction={handleRepairAction}
                  onSelectChapter={setSelectedChapter}
                />
              </React.Suspense>
            ),
          },
          {
            key: 'language',
            label: '语言与对白',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <LanguageSection data={data} filtered={filtered} hasScoreData={hasScoreData} />
              </React.Suspense>
            ),
          },
          {
            key: 'structure',
            label: '结构与推进',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <StructureSection
                  data={data}
                  filtered={filtered}
                  selectedVolumeLabel={selectedVolumeMetrics?.volumeName}
                  hasChapterGateData={hasChapterGateData}
                  hasChapterFunctionData={hasChapterFunctionData}
                  hasArcProgressData={hasArcProgressData}
                  onSelectChapter={openChapterByNum}
                />
              </React.Suspense>
            ),
          },
          {
            key: 'stability',
            label: '召回与状态',
            children: (
              <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                <StabilitySection
                  data={data}
                  filtered={filtered}
                  hasRecallData={hasRecallData}
                  hasStateData={hasStateData}
                />
              </React.Suspense>
            ),
          },
        ]}
      />

      <ChapterDetailModal chapter={selectedChapter} onClose={() => setSelectedChapter(null)} />
    </WorkspacePage>
  )
}

