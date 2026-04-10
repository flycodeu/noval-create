import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Modal, Progress, Spin, Tag } from 'antd'
import VirtualList from 'rc-virtual-list'
import type { LanguageDriftMetrics, QualityDashboardData } from '../../../types'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel, WorkspaceStepGuide } from '../components/WorkspaceShell'
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

function qualityRiskKindLabel(kind: QualityDashboardData['novelQualityMetrics']['riskOverview'][number]['kind']): string {
  if (kind === 'language_drift') return 'AI 味退化'
  if (kind === 'story_dynamics') return '主角与节奏'
  if (kind === 'chapter_function') return '章节功能'
  if (kind === 'story_arc') return '故事弧推进'
  if (kind === 'foreshadow_debt') return '伏笔债务'
  if (kind === 'recall') return '召回风险'
  return '状态稳定性'
}

export default function QualityDashboard({ novelId }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<QualityDashboardData | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<QualityChapterEntry | null>(null)
  const [selectedVolumeId, setSelectedVolumeId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electron.quality.getDashboard(novelId)
      setData(result)
    } catch (error) {
      console.error('Failed to load quality dashboard', error)
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

  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', padding: 80 }} />

  const hasScoreData = Boolean(data && data.totalChaptersScored > 0)
  const hasStoryDynamicsData = Boolean(data && data.protagonistSetbackSummary.chapterCount > 0)
  const hasArcProgressData = Boolean(data && (data.storyArcProgressSummary.trackedArcCount > 0 || data.storyArcProgressAlerts.length > 0))
  const hasDialogueData = Boolean(data && data.dialogueFingerprintStats.eligibleCharacterCount > 0)
  const hasStateData = Boolean(data && (data.worldStateSummary.trackedEntityCount > 0 || data.recentWorldStateAlerts.length > 0))
  const hasRecallData = Boolean(data && (data.recallSummary.analyzedChapterCount > 0 || data.recentRecallAlerts.length > 0))
  const hasChapterFunctionData = Boolean(data && (data.chapterFunctionSummary.trackedChapterCount > 0 || data.chapterFunctionAlerts.length > 0))

  if (!data || (!hasScoreData && !hasStoryDynamicsData && !hasArcProgressData && !hasDialogueData && !hasStateData && !hasRecallData && !hasChapterFunctionData)) {
    return (
      <WorkspacePage title="质量监控" description="查看各章节的 AI 检测结果与质量趋势。">
        <WorkspacePanel title="暂无数据">
          <Empty description="还没有可用的 AI 检测、对白指纹、章节功能、状态稳定性或结构节奏跟踪数据。先运行章节审校或 AI 检测后再来查看。" />
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

  return (
    <WorkspacePage
      title="质量监控"
      description="查看各章节的 AI 检测结果、修补优先级和全书质量趋势。"
      metrics={[
        <WorkspaceMetric key="scored" label="已评分章节" value={data.totalChaptersScored} />,
        <WorkspaceMetric key="tracked" label="节奏追踪章节" value={data.protagonistSetbackSummary.chapterCount} />,
        <WorkspaceMetric key="arc" label="跟踪故事弧" value={data.storyArcProgressSummary.trackedArcCount} />,
        <WorkspaceMetric key="avg" label="平均总分 / 压力" value={hasScoreData ? `${data.averageOverallScore} / 10` : `${data.protagonistSetbackSummary.averagePressure}`} />,
      ]}
      guide={(
        <WorkspaceStepGuide
          title="进入质量看板先看什么"
          steps={[
            {
              title: '先找阻塞卷和章节',
              description: '先看全书健康总览与卷级健康面板，定位最先该修的卷和章节。',
              status: 'focus',
            },
            {
              title: '再拆 AI 味来源',
              description: '用趋势图和 AI 味分解确认问题来自语言退化、节奏还是结构承接。',
              status: 'todo',
            },
            {
              title: '最后回到修订中心',
              description: '把发现的高优先问题转回修订中心或正文页处理，形成闭环。',
              status: 'todo',
            },
          ]}
        />
      )}
    >
      <WorkspacePanel title="全书健康总览" description="先判断全书当前最危险的卷和主要风险，再往下钻到卷级和章节级。">
        <NovelHealthOverviewPanel
          summary={data.novelQualityMetrics}
          activeVolume={selectedVolumeMetrics}
          onSelectVolume={setSelectedVolumeId}
          onClearVolume={() => setSelectedVolumeId(null)}
          onSelectRisk={handleRiskSelect}
        />
      </WorkspacePanel>

      {data.volumeQualityMetrics.length > 0 ? (
        <WorkspacePanel title="卷级健康面板" description="统一比较每一卷的 AI 味、故事弧推进、节奏结构、伏笔债务、召回和状态稳定性。">
          <VolumeHealthPanel
            volumes={data.volumeQualityMetrics}
            activeVolumeId={selectedVolumeId}
            onSelectVolume={setSelectedVolumeId}
            onSelectRisk={handleRiskSelect}
          />
        </WorkspacePanel>
      ) : null}

      {hasScoreData ? (
        <>
          <WorkspacePanel title="质量热力图" description="X=章节，Y=评分维度，颜色越绿越好。">
            <HeatmapChart data={filteredHeatmapData} chapterNums={filteredOverallTrend.map((d) => d.chapterNum)} />
          </WorkspacePanel>

          <WorkspacePanel title="评分趋势" description="总分与 AI 味率逐章变化。">
            <TrendChart
              overallTrend={filteredOverallTrend}
              aiLikeTrend={filteredAiLikeTrend}
            />
          </WorkspacePanel>

          <WorkspacePanel title="AI 味分解" description="拆开看语言退化由哪些问题构成。">
            <LanguageDriftPanel
              averages={data.averageLanguageDrift}
              trends={data.languageDriftTrends}
              recentAlerts={data.recentLanguageDriftAlerts}
              volumeEntries={filteredLanguageVolumes}
              novelSummary={data.novelLanguageDriftSummary}
            />
          </WorkspacePanel>

        </>
      ) : null}

      {data.dialogueFingerprintStats.eligibleCharacterCount > 0 ? (
        <WorkspacePanel title="角色对白辨识度" description="查看角色之间是否越说越像，以及谁正在偏离自己的语音指纹。">
          <DialogueFingerprintPanel
            stats={data.dialogueFingerprintStats}
            signatures={data.characterDialogueSignatures}
            similarities={data.crossCharacterDialogueSimilarity}
            driftEntries={data.dialogueDriftTrend}
            volumeEntries={data.volumeDialogueSimilarity}
            alerts={data.recentDialogueAlerts}
          />
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="主角受挫与节奏" description="跨章节查看主角受挫、代价持续、反转与高潮分布。">
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
        <WorkspacePanel title="章节功能与节奏分布" description="查看章节主功能是否重复、卷内是否偏科，以及关键章节是否仍在原地过渡。">
          <ChapterFunctionPanel
            summary={data.chapterFunctionSummary}
            runs={filteredChapterFunctionRuns}
            alerts={filteredChapterFunctionAlerts}
            volumeEntries={filteredChapterFunctionVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasArcProgressData ? (
        <WorkspacePanel title="故事弧推进" description="查看每条故事弧的推进率、空转率、阶段兑现和卷级分布。">
          <StoryArcProgressPanel
            summary={data.storyArcProgressSummary}
            trend={data.storyArcProgressTrend}
            arcs={data.storyArcProgressArcs}
            alerts={data.storyArcProgressAlerts}
            volumeEntries={filteredArcVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasRecallData ? (
        <WorkspacePanel title="召回可靠性" description="查看历史片段召回是否过度依赖、以及是否命中过期信息。">
          <RecallReliabilityPanel
            summary={data.recallSummary}
            alerts={filteredRecallAlerts}
            volumeEntries={filteredRecallVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasStateData ? (
        <WorkspacePanel title="状态稳定性" description="查看人物、物品、关系、势力与地点的跳变和冲突是否在放大。">
          <WorldStateStabilityPanel
            trend={data.worldStateTrend}
            alerts={filteredWorldAlerts}
            conflictEntities={data.worldConflictEntities}
            summary={data.worldStateSummary}
            volumeEntries={filteredWorldVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasScoreData ? (
        <>
          <WorkspacePanel title="薄弱维度分析" description="各维度被标记为薄弱项的频次。">
            <WeakDimensionChart data={data.weakDimensionFrequency} />
          </WorkspacePanel>

          <WorkspacePanel title="章节详情" description="点击查看某章完整评分。">
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
            <LanguageDriftDetails metrics={selectedChapter.languageDriftMetrics} />
            <DialogueReviewDetails review={selectedChapter.dialogueReview} />
            <StoryDynamicsDetails dynamics={selectedChapter.storyDynamics} />
            <ChapterFunctionDetails chapterFunction={selectedChapter.chapterFunction} />
            <StoryArcProgressDetails progress={selectedChapter.storyArcProgress} />
            <RecallDiagnosticsDetails diagnostics={selectedChapter.recallDiagnostics} />
            <WorldStateAlertDetails alerts={selectedChapter.worldStateAlerts} />
          </div>
        ) : null}
      </Modal>
    </WorkspacePage>
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
    return <Empty description="暂无章节功能与节奏分布数据" />
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
            主功能偏向 {summary.dominantTag ? `${chapterFunctionLabel(summary.dominantTag)} ${summary.dominantTagShare}%` : '暂无'}
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
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前没有连续重复主功能的区段。</div>}
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
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前没有新的章节功能告警。</div>}
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
                  主功能偏向 {volume.dominantTag ? `${chapterFunctionLabel(volume.dominantTag)} ${volume.dominantTagShare}%` : '暂无'}
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
    return <Empty description="暂无召回可靠性数据" />
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
          <div style={{ fontSize: 12, opacity: 0.7 }}>过期召回</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.staleRecallCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>被识别为疑似过期的历史片段</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>过期召回率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.staleRecallRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>本地回查命中里疑似过期片段的平均占比</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期过期召回章节</div>
          {alerts.length > 0 ? alerts.map((alert) => (
            <div key={alert.chapterId} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="warning" style={{ marginRight: 0 }}>过期召回</Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>第{alert.chapterNum}章 · {alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的过期召回章节。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>诊断说明</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>质量看板里的召回可靠性采用本地关键词回查估算，只用于发现阻塞章节。</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>实际生成链路仍以硬约束和结构化状态为主，召回只作背景补充。</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>当前保留片段 {summary.selectedHitCount} 条，本地兜底命中 {summary.fallbackHitCount} 条。</div>
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
                <div style={{ fontSize: 12 }}>依赖率 {volume.recallDependencyRate}% · 过期 {volume.staleRecallCount} · 过期率 {volume.staleRecallRate}%</div>
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
  if (overallTrend.length === 0) return <Empty description="暂无趋势数据" />

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
  if (filtered.length === 0) return <Empty description="暂无薄弱维度" />

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
}: {
  averages: LanguageDriftMetrics
  trends: QualityDashboardData['languageDriftTrends']
  recentAlerts: QualityDashboardData['recentLanguageDriftAlerts']
  volumeEntries: QualityDashboardData['volumeLanguageDrift']
  novelSummary: QualityDashboardData['novelLanguageDriftSummary']
}) {
  const hasAnyData = LANGUAGE_DRIFT_LABELS.some(({ key }) => trends[key].length > 0)
  if (!hasAnyData) {
    return <Empty description="暂无 AI 味分解数据" />
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
            <div style={{ fontSize: 12, opacity: 0.6 }}>暂无分解数据</div>
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
            <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内暂无明显恶化项。</div>
          )}
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
                      : '最近窗口内暂无明显恶化项。'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
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
        <span>暂无分解数据</span>
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
}: {
  stats: QualityDashboardData['dialogueFingerprintStats']
  signatures: QualityDashboardData['characterDialogueSignatures']
  similarities: QualityDashboardData['crossCharacterDialogueSimilarity']
  driftEntries: QualityDashboardData['dialogueDriftTrend']
  volumeEntries: QualityDashboardData['volumeDialogueSimilarity']
  alerts: QualityDashboardData['recentDialogueAlerts']
}) {
  if (stats.eligibleCharacterCount === 0) {
    return <Empty description="暂无足够的角色对白样本" />
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
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>暂无跨角色相似度数据。</div>}
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
              句长 {signature.avgSentenceLength} · 追问 {signature.questionRate}% · 停顿 {signature.ellipsisRate}% · 重复短语 {signature.catchphraseCandidates.slice(0, 2).map((item) => item.token).join('、') || '暂无'}
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
                    : '该卷暂无足够的对比样本。'}
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
    return <Empty description="暂无主角受挫与节奏跟踪数据" />
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
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内暂无明显结构告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>反转 / 高潮 / 喘息</div>
          <div style={{ fontSize: 12 }}>反转：{reversalSummary.reversalChapterNums.length > 0 ? reversalSummary.reversalChapterNums.join('、') : '暂无'}</div>
          <div style={{ fontSize: 12 }}>高潮：{reversalSummary.climaxChapterNums.length > 0 ? reversalSummary.climaxChapterNums.join('、') : '暂无'}</div>
          <div style={{ fontSize: 12 }}>喘息：{reversalSummary.breatherChapterNums.length > 0 ? reversalSummary.breatherChapterNums.join('、') : '暂无'}</div>
          <div style={{ fontSize: 11, opacity: 0.65 }}>强行反转 {reversalSummary.forcedReversalCount} 次，弱反转 {reversalSummary.weakReversalCount} 次，高潮间距 {reversalSummary.climaxSpacing.length > 0 ? reversalSummary.climaxSpacing.join('、') : '暂无'}。</div>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>未解代价</div>
          {costSummary.activeCosts.length > 0 ? costSummary.activeCosts.map((entry) => (
            <div key={`${entry.startChapterNum}-${entry.summary}`} style={{ fontSize: 12 }}>
              第{entry.startChapterNum}章起持续 {entry.duration} 章：{entry.summary}
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前没有持续中的代价链。</div>}
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
                <div style={{ fontSize: 12 }}>高潮 {volume.climaxChapterNums.length > 0 ? volume.climaxChapterNums.join('、') : '暂无'} · 反转 {volume.reversalChapterNums.length > 0 ? volume.reversalChapterNums.join('、') : '暂无'}</div>
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
    return <Empty description="暂无故事弧推进数据" />
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
                )) : <div style={{ fontSize: 12, opacity: 0.6 }}>本卷暂无故事弧覆盖数据。</div>}
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
    return <Empty description="暂无状态稳定性数据" />
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
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前没有需要优先回查的冲突实体。</div>}
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

function LanguageDriftDetails({ metrics }: { metrics?: LanguageDriftMetrics }) {
  if (!metrics) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>暂无 AI 味分解数据</div>
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

function DialogueReviewDetails({ review }: { review?: QualityDashboardData['chapterDetails'][number]['dialogueReview'] }) {
  if (!review) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>暂无角色对白辨识度数据</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>角色对白辨识度</div>
      {review.fingerprintSummary ? <div style={{ fontSize: 12 }}>{review.fingerprintSummary}</div> : null}
      {review.risks.length > 0 ? (
        <div style={{ fontSize: 12 }}>风险：{review.risks.join('；')}</div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7 }}>当前章暂无明确的对白同质化风险。</div>
      )}
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
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章暂无章节功能标注</div>
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
        )) : <span style={{ fontSize: 12, opacity: 0.7 }}>暂无功能标签</span>}
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
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章暂无故事弧推进数据</div>
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

function RecallDiagnosticsDetails({ diagnostics }: { diagnostics?: QualityDashboardData['chapterDetails'][number]['recallDiagnostics'] }) {
  if (!diagnostics || diagnostics.totalHitCount === 0) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章暂无召回可靠性数据</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>召回可靠性</div>
      <div style={{ fontSize: 12 }}>召回依赖率：{diagnostics.recallDependencyRate}% · 过期召回率：{diagnostics.staleRecallRate}%</div>
      <div style={{ fontSize: 12 }}>可用片段：{diagnostics.selectedHitCount} · 过期片段：{diagnostics.staleRecallCount} · 兜底命中：{diagnostics.fallbackHitCount}</div>
      {diagnostics.summaryLines.length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.72 }}>{diagnostics.summaryLines.join(' ')}</div>
      ) : null}
    </div>
  )
}

function WorldStateAlertDetails({ alerts }: { alerts?: QualityDashboardData['chapterDetails'][number]['worldStateAlerts'] }) {
  if (!alerts || alerts.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>本章暂无状态稳定性告警</div>
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
