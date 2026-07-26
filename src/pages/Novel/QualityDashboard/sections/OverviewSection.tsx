import React, { useMemo } from 'react'
import { Button, Empty, Progress, Tag, message } from 'antd'
import VirtualList from 'rc-virtual-list'
import type { QualityDashboardData, QualityRepairAction, TaskPipelineStats } from '../../../../types'
import { WorkspacePanel } from '../../components/WorkspaceShell'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import RecommendationGovernancePanel from '../RecommendationGovernancePanel'
import { getQualityRiskSeverityColor, getQualityRiskSeverityLabel } from '../../shared/revision-quality'
import RepairRiskCard from './RepairRiskCard'
import {
  agentArtifactKindLabel,
  agentArtifactStatusColor,
  agentArtifactStatusLabel,
  artifactHashTail,
  batchStatusColor,
  batchStatusLabel,
  buildQualityHeatmapModel,
  buildSoakExportCommand,
  buildSoakReportPath,
  buildSoakValidateCommand,
  buildTrendPath,
  buildWeakDimensionBars,
  chapterGenerationModeLabel,
  healthScoreColor,
  heatmapCellColor,
  mainThreadPressureStrategyLabel,
  memoryScopeLabel,
  pipelineRoleLabel,
  precomputeQueueStatusLabel,
  promptSummaryModeLabel,
  qualityRepairMetricLabel,
  qualityRiskKindLabel,
  readinessStatusColor,
  recallSnapshotSourceColor,
  recallSnapshotSourceLabel,
  runtimePressureLevelLabel,
  scoreColor,
  signedDashboardDelta,
  type QualityChapterEntry,
  type QualityHeatmapPoint,
  type QualityRiskEntry,
  type VolumeFilteredDashboard,
  type VolumeQualityEntry,
} from '../quality-dashboard-presentation'

interface OverviewSectionProps {
  novelId: number
  data: QualityDashboardData
  pipelineStats: TaskPipelineStats | null
  filtered: VolumeFilteredDashboard
  selectedVolumeMetrics: VolumeQualityEntry | null
  selectedVolumeId: number | null
  hasScoreData: boolean
  chapterListHeight: number
  repairingActionId: string | null
  onSelectVolume: (volumeId: number | null) => void
  onSelectRisk: (risk: QualityRiskEntry) => void
  onRunAction: (action: QualityRepairAction) => void
  onSelectChapter: (entry: QualityChapterEntry) => void
}

/** 总览 Tab：健康指标、修复引擎、观测面板与章节详情列表。 */
export default function OverviewSection({
  novelId,
  data,
  pipelineStats,
  filtered,
  selectedVolumeMetrics,
  selectedVolumeId,
  hasScoreData,
  chapterListHeight,
  repairingActionId,
  onSelectVolume,
  onSelectRisk,
  onRunAction,
  onSelectChapter,
}: OverviewSectionProps) {
  return (
    <>
      <RecommendationGovernancePanel novelId={novelId} />
      <WorkspacePanel title="百万字健康指标" description="把继续扩批前最关键的生产、连续性、合同和批次回查信号收在一起。">
        <div className="quality-dashboard-page__stack">
          <div className="quality-dashboard-page__grid-220">
            <div className="quality-card">
              <div className="quality-dashboard-page__card-head">
                <strong>生产就绪度</strong>
                <Tag color={readinessStatusColor(data.productionReadiness.status)}>{`${data.productionReadiness.readyRate}%`}</Tag>
              </div>
              <div className="quality-dashboard-page__card-summary">{data.productionReadiness.summary}</div>
            </div>
            <div className="quality-card">
              <div className="quality-dashboard-page__card-head">
                <strong>批次健康</strong>
                <Tag color={batchStatusColor(data.batchHealth.status)}>{batchStatusLabel(data.batchHealth.status)}</Tag>
              </div>
              <div className="quality-dashboard-page__card-summary">{data.batchHealth.summary}</div>
            </div>
            <div className="quality-card">
              <div className="quality-dashboard-page__card-head">
                <strong>连续性健康</strong>
                <Tag color={data.continuityHealth.staleCheckpointCount > 0 || data.continuityHealth.worldConflictCount > 0 ? 'warning' : 'success'}>
                  {`检查点 ${data.continuityHealth.staleCheckpointCount}`}
                </Tag>
              </div>
              <div className="quality-dashboard-page__card-summary">
                {`召回降级 ${data.continuityHealth.recallDegradedChapterCount} 章，世界冲突 ${data.continuityHealth.worldConflictCount} 处，最新检查点落后 ${data.continuityHealth.latestCheckpointChapterGap} 章。`}
              </div>
            </div>
            <div className="quality-card">
              <div className="quality-dashboard-page__card-head">
                <strong>合同交付</strong>
                <Tag color={data.contractDelivery.blockerCount > 0 ? 'error' : data.contractDelivery.warningCount > 0 ? 'warning' : 'success'}>
                  {`${data.contractDelivery.readyRate}%`}
                </Tag>
              </div>
              <div className="quality-dashboard-page__card-summary">
                {`阻断 ${data.contractDelivery.blockerCount}，预警 ${data.contractDelivery.warningCount}，线程推进率 ${data.contractDelivery.storyThreadAdvanceRate}%。`}
              </div>
            </div>
          </div>
          <div className="quality-dashboard-page__grid-280">
            <div className="quality-card">
              <strong>继续下一批前</strong>
              <div className="quality-dashboard-page__note-list quality-dashboard-page__card-summary--dense">
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
              <div className="quality-dashboard-page__card-summary quality-dashboard-page__card-summary--dense">{data.batchReview.summary}</div>
              <div className="quality-dashboard-page__action-tags quality-dashboard-page__action-tags--dense">
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
        <div className="quality-dashboard-page__stack">
          {data.dashboardNotes?.length ? (
            <div className="quality-dashboard-page__note-list">
              {data.dashboardNotes.map((note) => <div key={note}>{note}</div>)}
            </div>
          ) : null}
          <div className="quality-dashboard-page__grid-220">
            {data.repairMetrics.map((metric) => (
              <div key={metric.key} className="quality-card">
                <div className="quality-dashboard-page__card-head quality-dashboard-page__card-head--tight">
                  <strong>{qualityRepairMetricLabel(metric.key)}</strong>
                  <Tag color={metric.score >= 80 ? 'success' : metric.score >= 60 ? 'warning' : 'error'}>{metric.score}</Tag>
                </div>
                <div className="quality-dashboard-page__card-summary">{metric.summary}</div>
                <div className="quality-dashboard-page__action-tags">
                  <Tag color={metric.riskCount > 0 ? 'orange' : 'success'}>{`风险 ${metric.riskCount}`}</Tag>
                  {metric.focusLabels.slice(0, 2).map((label) => <Tag key={`${metric.key}-${label}`}>{label}</Tag>)}
                </div>
              </div>
            ))}
          </div>
          <div className="quality-card quality-dashboard-page__pipeline-list">
            <div className="quality-dashboard-page__card-head quality-dashboard-page__card-head--tight">
              <strong>动作汇总</strong>
              <Tag color={data.repairActionSummary.actionableRiskCount > 0 ? 'processing' : 'success'}>
                {`可动作风险 ${data.repairActionSummary.actionableRiskCount}`}
              </Tag>
            </div>
            <div className="quality-dashboard-page__action-tags">
              <Tag color="blue">{`任务动作 ${data.repairActionSummary.taskActionCount}`}</Tag>
              <Tag color="gold">{`安全直落 ${data.repairActionSummary.directExecutableActionCount}`}</Tag>
              <Tag color="purple">{`允许偏移 ${data.repairActionSummary.allowDeviationCount}`}</Tag>
            </div>
            <div className="quality-dashboard-page__note-list">
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
          onSelectVolume={onSelectVolume}
          onClearVolume={() => onSelectVolume(null)}
          onSelectRisk={onSelectRisk}
          onRunAction={onRunAction}
          repairingActionId={repairingActionId}
        />
      </WorkspacePanel>

      {data.typedRefObservability ? (
        <WorkspacePanel title="引用覆盖观测">
          <TypedRefObservabilityPanel observability={data.typedRefObservability} />
        </WorkspacePanel>
      ) : null}

      {data.agentQualityObservability ? (
        <WorkspacePanel title="智能体质量工件" description="把 Agent 的质量报告、修复计划、章节候选 Diff、独立审校证据和报告比较集中到同一条可追溯链路。">
          <AgentQualityObservabilityPanel snapshot={data.agentQualityObservability} />
        </WorkspacePanel>
      ) : null}

      {data.operatingModeObservability ? (
        <WorkspacePanel title="运行模式观测">
          <OperatingModeObservabilityPanel observability={data.operatingModeObservability} />
        </WorkspacePanel>
      ) : null}

      {data.millionRuntimeObservability ? (
        <WorkspacePanel title="百万字运行时护栏">
          <MillionRuntimeObservabilityPanel observability={data.millionRuntimeObservability} />
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="长篇验收">
        <LongformSoakAcceptancePanel novelId={novelId} data={data} />
      </WorkspacePanel>

      {data.structuredMemoryObservability ? (
        <WorkspacePanel title="结构化记忆观测">
          <StructuredMemoryObservabilityPanel
            observability={data.structuredMemoryObservability}
            hookContinuitySummary={data.hookContinuitySummary}
            voiceEvolutionSummary={data.voiceEvolutionSummary}
          />
        </WorkspacePanel>
      ) : null}

      {pipelineStats ? (
        <WorkspacePanel title="长篇写作架构">
          <div className="quality-dashboard-page__stack">
            <div className="quality-dashboard-page__pipeline-tags">
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
            <div className="quality-dashboard-page__pipeline-list">
              {pipelineStats.roleStats.map((item) => (
                <div key={item.role} className="quality-card">
                  <div className="quality-dashboard-page__card-head">
                    <strong>{pipelineRoleLabel(item.role)}</strong>
                    <Tag color={item.failedCount > 0 ? 'error' : item.runningCount > 0 ? 'processing' : 'success'}>
                      {`成功 ${item.successCount} / 失败 ${item.failedCount} / 运行中 ${item.runningCount}`}
                    </Tag>
                  </div>
                  <div className="quality-dashboard-page__role-meta">
                    {`平均耗时 ${item.avgDurationMs ? `${(item.avgDurationMs / 1000).toFixed(1)}秒` : '-'}，累计用量 ${item.tokensUsedTotal || 0}，阻断 ${item.blockedCount} 条`}
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
            onSelectVolume={onSelectVolume}
            onSelectRisk={onSelectRisk}
            onRunAction={onRunAction}
            repairingActionId={repairingActionId}
          />
        </WorkspacePanel>
      ) : null}

      {data.recentEndgameDebtAlerts.length > 0 ? (
        <WorkspacePanel title="终局债务预警">
          <EndgameDebtPanel alerts={data.recentEndgameDebtAlerts} onSelectRisk={onSelectRisk} />
        </WorkspacePanel>
      ) : null}

      {hasScoreData ? (
        <>
          <WorkspacePanel title="质量热力图">
            <HeatmapChart data={filtered.heatmapData} chapterNums={filtered.overallTrend.map((d) => d.chapterNum)} />
          </WorkspacePanel>

          <WorkspacePanel title="评分趋势">
            <TrendChart
              overallTrend={filtered.overallTrend}
              aiLikeTrend={filtered.aiLikeTrend}
            />
          </WorkspacePanel>

          <WorkspacePanel title="薄弱维度分析">
            <WeakDimensionChart data={data.weakDimensionFrequency} />
          </WorkspacePanel>

          <WorkspacePanel title="章节详情">
            <div className="quality-dashboard-page__chapter-list" style={{ height: chapterListHeight }}>
              <VirtualList data={filtered.chapterDetails} height={chapterListHeight} itemHeight={56} itemKey="chapterId">
                {(entry: QualityChapterEntry) => (
                  <div
                    key={entry.chapterId}
                    className="quality-dashboard-page__chapter-row"
                    onClick={() => onSelectChapter(entry)}
                  >
                    <span className="quality-dashboard-page__chapter-row-num">第{entry.chapterNum}章</span>
                    <span className="quality-dashboard-page__chapter-row-title">{entry.title}</span>
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
}

async function copySoakCommand(command: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(command)
    message.success(getUserFacingMessage('qualityDashboard.commandCopied'))
  } catch {
    message.warning(getUserFacingMessage('qualityDashboard.clipboardUnavailable'))
  }
}

function AgentQualityObservabilityPanel({
  snapshot,
}: {
  snapshot: NonNullable<QualityDashboardData['agentQualityObservability']>
}) {
  if (snapshot.summary.artifactCount === 0) {
    return <Empty description="还没有智能体质量工件；运行一次质量评审或修复流程后，这里会显示完整证据链。" />
  }

  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">工件历史</div>
          <div className="quality-dashboard-page__big-number">{snapshot.summary.artifactCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">报告、计划、候选、审校与比较均保留不可变记录</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">修复链</div>
          <div className="quality-dashboard-page__big-number">{snapshot.summary.repairPlanCount} / {snapshot.summary.candidateDiffCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">修复计划 / 候选 Diff</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">独立审校</div>
          <div className="quality-dashboard-page__big-number">{snapshot.summary.independentReviewCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">展示分章任务、证据覆盖和回归风险</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">报告比较</div>
          <div className="quality-dashboard-page__big-number">{snapshot.summary.comparisonCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">候选是否改善、回归或等待人工判断</div>
        </div>
      </div>

      {snapshot.latestReport ? (
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>最新质量报告</strong>
            <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
              <Tag color={snapshot.latestReport.status === 'passed' ? 'success' : snapshot.latestReport.status === 'blocked' ? 'error' : 'warning'}>
                {snapshot.latestReport.status}
              </Tag>
              <Tag color="blue">{`Context ${snapshot.latestReport.contextVersion}`}</Tag>
              <Tag>{snapshot.latestReport.profile}</Tag>
            </div>
          </div>
          <div className="quality-dashboard-page__action-tags">
            <Tag color="processing">{`综合分 ${snapshot.latestReport.score}`}</Tag>
            <Tag color="cyan">{`置信下界 ${snapshot.latestReport.confidenceLowerBound}`}</Tag>
            <Tag color="purple">{`覆盖 ${snapshot.latestReport.coverageRate}%`}</Tag>
            <Tag color={snapshot.latestReport.blockingFindingCount > 0 ? 'error' : 'success'}>{`阻塞 Finding ${snapshot.latestReport.blockingFindingCount}`}</Tag>
            {snapshot.latestReport.semanticReview ? (
              <Tag color={snapshot.latestReport.semanticReview.independentModelReview ? 'success' : 'warning'}>
                {`独立语义证据 ${snapshot.latestReport.semanticReview.validEvidenceCount}/${snapshot.latestReport.semanticReview.validEvidenceCount + snapshot.latestReport.semanticReview.rejectedEvidenceCount}`}
              </Tag>
            ) : null}
          </div>
          <div className="quality-dashboard-page__card-summary">{snapshot.latestReport.summary || '暂无报告摘要。'}</div>
        </div>
      ) : null}

      <div className="quality-dashboard-page__dual-grid">
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head"><strong>工件历史</strong><Tag color="blue">{snapshot.artifactHistory.length}</Tag></div>
          <div className="quality-dashboard-page__note-list quality-dashboard-page__card-summary--dense">
            {snapshot.artifactHistory.slice(0, 12).map((artifact) => (
              <div key={artifact.id} className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
                <Tag color={agentArtifactStatusColor(artifact.status)}>{agentArtifactStatusLabel(artifact.status)}</Tag>
                <strong>{agentArtifactKindLabel(artifact.kind)}</strong>
                <span>{`v${artifact.version} · C${artifact.contextVersion} · ${artifactHashTail(artifact.contentHash)}`}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="quality-card">
          <div className="quality-dashboard-page__card-head"><strong>修复计划与依赖</strong><Tag color={snapshot.repairPlans.some((plan) => plan.status === 'blocked') ? 'error' : 'success'}>{snapshot.repairPlans.length}</Tag></div>
          <div className="quality-dashboard-page__note-list quality-dashboard-page__card-summary--dense">
            {snapshot.repairPlans.length > 0 ? snapshot.repairPlans.map((plan) => (
              <div key={plan.artifactId}>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
                  <Tag color={plan.status === 'ready' ? 'success' : 'error'}>{plan.status}</Tag>
                  <strong>{`计划 ${artifactHashTail(plan.artifactId)}`}</strong>
                  <span>{`Context ${plan.sourceContextVersion} · ${plan.items.length} 项`}</span>
                </div>
                {plan.items.slice(0, 3).map((item) => (
                  <div key={`${plan.artifactId}-${item.id}`} className="quality-dashboard-page__body-copy">
                    {`P${item.priority} ${item.objective || item.id} · 依赖 ${item.dependencies.length} · 验收 ${item.acceptanceCriteriaCount} · 回归保护 ${item.regressionGuardsCount}`}
                  </div>
                ))}
              </div>
            )) : <div>暂无修复计划。</div>}
          </div>
        </div>
      </div>

      <div className="quality-dashboard-page__dual-grid">
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head"><strong>候选 Diff</strong><Tag color={snapshot.candidateDiffs.length > 0 ? 'processing' : 'default'}>{snapshot.candidateDiffs.length}</Tag></div>
          <div className="quality-dashboard-page__note-list quality-dashboard-page__card-summary--dense">
            {snapshot.candidateDiffs.length > 0 ? snapshot.candidateDiffs.map((draft) => (
              <div key={draft.artifactId}>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
                  <Tag color={draft.readyForHumanReview ? 'success' : 'warning'}>{draft.readyForHumanReview ? '待人工审阅' : '需修订'}</Tag>
                  <strong>{`候选 ${artifactHashTail(draft.artifactId)}`}</strong>
                  <span>{`Context ${draft.sourceContextVersion} · ${draft.chapters.length} 章`}</span>
                </div>
                {draft.chapters.map((chapter) => (
                  <div key={`${draft.artifactId}-${chapter.chapterId}`} className="quality-dashboard-page__body-copy">
                    {`第${chapter.chapterNum}章 ${chapter.changed ? '已变更' : '未变更'} · 原 ${artifactHashTail(chapter.originalContentHash)} → 候选 ${artifactHashTail(chapter.optimizedContentHash)} · 事实 ${chapter.factGuardStatus} · 质量门 ${chapter.qualityGateStatus}`}
                  </div>
                ))}
              </div>
            )) : <div>暂无章节候选 Diff。</div>}
          </div>
        </div>

        <div className="quality-card">
          <div className="quality-dashboard-page__card-head"><strong>独立审校证据</strong><Tag color={snapshot.independentReviews.some((review) => review.readyForHumanDecision) ? 'success' : 'warning'}>{snapshot.independentReviews.length}</Tag></div>
          <div className="quality-dashboard-page__note-list quality-dashboard-page__card-summary--dense">
            {snapshot.independentReviews.length > 0 ? snapshot.independentReviews.map((review) => (
              <div key={review.artifactId}>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
                  <Tag color={review.readyForHumanDecision ? 'success' : 'warning'}>{review.readyForHumanDecision ? '可人工决策' : '证据不足'}</Tag>
                  <strong>{`审校 ${artifactHashTail(review.artifactId)}`}</strong>
                  <span>{`总分 ${review.score} · ${review.independentModelReview ? '独立模型' : '非独立'}`}</span>
                </div>
                {review.chapters.map((chapter) => (
                  <div key={`${review.artifactId}-${chapter.chapterId}`} className="quality-dashboard-page__body-copy">
                    {`第${chapter.chapterNum}章 ${chapter.status} · 评分 ${chapter.score} · 证据 ${chapter.evidencedCheckCount}/${chapter.checkCount} · 回归风险 ${chapter.regressionRiskCount} · ${chapter.separateReviewTask ? '独立 Task' : '非独立 Task'}`}
                  </div>
                ))}
              </div>
            )) : <div>暂无独立审校证据。</div>}
          </div>
        </div>
      </div>

      <div className="quality-card">
        <div className="quality-dashboard-page__card-head"><strong>候选报告比较</strong><Tag color={snapshot.comparisons.some((comparison) => comparison.status === 'regressed') ? 'error' : 'blue'}>{snapshot.comparisons.length}</Tag></div>
        <div className="quality-dashboard-page__note-list quality-dashboard-page__card-summary--dense">
          {snapshot.comparisons.length > 0 ? snapshot.comparisons.map((comparison) => (
            <div key={comparison.artifactId} className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
              <Tag color={comparison.status === 'improved' ? 'success' : comparison.status === 'regressed' ? 'error' : comparison.status === 'mixed' ? 'warning' : 'default'}>{comparison.status}</Tag>
              <strong>{`分数 ${signedDashboardDelta(comparison.scoreDelta)}`}</strong>
              <span>{`覆盖 ${signedDashboardDelta(comparison.coverageRateDelta)} · 下界 ${signedDashboardDelta(comparison.confidenceLowerBoundDelta)} · 新增阻塞 ${comparison.introducedBlockerCount}`}</span>
              <Tag color={comparison.readyForHumanReview ? 'success' : 'warning'}>{comparison.readyForHumanReview ? '可人工审阅' : '需人工判断'}</Tag>
              <span>{comparison.summary}</span>
            </div>
          )) : <div>暂无候选报告比较结果。</div>}
        </div>
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
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        质量面板会优先展示章节级召回快照：先读真实运行快照，其次读旧任务兼容快照；老章节若无历史任务快照，会先回填当前状态快照，并显式标记来源。只有结构化快照完全缺失时才回退到启发式诊断。
      </div>
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">全书健康分</div>
          <div className="quality-dashboard-page__big-number" style={{ color: healthScoreColor(summary.healthScore) }}>{summary.healthScore}</div>
          <div className="quality-dashboard-page__body-copy--soft">综合 AI 味、节奏、推进、召回与状态稳定性</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已分析章节</div>
          <div className="quality-dashboard-page__big-number">{summary.analyzedChapterCount} / {summary.totalChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">已纳入质量总览统计的章节数量</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">风险计数</div>
          <div className="quality-dashboard-page__big-number">{summary.criticalRiskCount} / {summary.warningRiskCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">高优先 / 中优先</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">伏笔债务</div>
          <div className="quality-dashboard-page__big-number">{summary.foreshadowPendingCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">
            待回收 {summary.foreshadowPendingCount} · 即将到期 {summary.foreshadowDueSoonCount} · 已超期 {summary.foreshadowOverdueCount}
          </div>
          <div className="quality-dashboard-page__body-copy--soft">
            延期说明 {summary.foreshadowBlockedCount} · 超期失管 {summary.foreshadowStaleCount}
          </div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">支线兑现率</div>
          <div className="quality-dashboard-page__big-number">{summary.storyThreadAdvanceRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">
            提及未推进 {summary.storyThreadMentionOnlyCount} · 只按真实推进/回收计入兑现
          </div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">终局债务</div>
          <div className="quality-dashboard-page__big-number">{summary.endgameActiveCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">
            已进入执行链 {summary.endgameServedCount} · 未绑定 {summary.endgameUnboundCount} · 已过期 {summary.endgameOverdueCount}
          </div>
        </div>
      </div>

      {activeVolume ? (
        <div className="quality-dashboard-page__filter-callout quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--start">
          <div className="quality-dashboard-page__dimension">
            <div className="quality-dashboard-page__section-title">{`当前卷筛选：${activeVolume.volumeName}`}</div>
            <div className="quality-dashboard-page__body-copy">{`第${activeVolume.chapterStart}-${activeVolume.chapterEnd}章 · 健康分 ${activeVolume.healthScore}`}</div>
          </div>
          <Button size="small" onClick={onClearVolume}>清除卷筛选</Button>
        </div>
      ) : null}

      <div className="quality-dashboard-page__dual-grid quality-dashboard-page__dual-grid--overview">
        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__section-title">风险分布</div>
          {summary.riskOverview.length > 0 ? summary.riskOverview.map((risk) => {
            const share = summary.criticalRiskCount + summary.warningRiskCount > 0
              ? Math.round((risk.count / Math.max(1, summary.criticalRiskCount + summary.warningRiskCount)) * 100)
              : 0
            return (
              <div key={risk.kind} className="quality-dashboard-page__dimension">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
                  <span>{risk.label || qualityRiskKindLabel(risk.kind)}</span>
                  <span className="quality-dashboard-page__section-title">{risk.count}</span>
                </div>
                <Progress percent={share} showInfo={false} strokeColor={share >= 60 ? '#f5222d' : share >= 35 ? '#faad14' : '#52c41a'} size="small" />
              </div>
            )
          }) : <div className="quality-dashboard-page__body-copy">风险分布目前稳定，暂时没有聚集型问题。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__section-title">建议先看的卷</div>
          {summary.recommendedFocusVolumes.length > 0 ? summary.recommendedFocusVolumes.map((volume) => (
            <button
              key={volume.volumeId}
              type="button"
              onClick={() => onSelectVolume(volume.volumeId)}
              className={`quality-dashboard-page__risk-button${activeVolume?.volumeId === volume.volumeId ? ' quality-dashboard-page__risk-button--selected' : ''}`}
              style={{ borderColor: activeVolume?.volumeId === volume.volumeId ? 'rgba(19,194,194,0.45)' : undefined }}
            >
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                <strong>{volume.volumeName}</strong>
                <Tag color={volume.healthScore < 55 ? 'error' : volume.healthScore < 70 ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">
                  健康分 {volume.healthScore}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy">{volume.summary}</div>
            </button>
          )) : <div className="quality-dashboard-page__body-copy">各卷风险接近，可先处理正在写的卷。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__pipeline-list">
        <div className="quality-dashboard-page__section-title">全书最高优先风险</div>
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
    <div className="quality-dashboard-page__metric-grid-320">
      {volumes.map((volume) => {
        const isActive = activeVolumeId === volume.volumeId
        return (
          <div
            key={volume.volumeId}
            className={`quality-dashboard-page__panel-card quality-dashboard-page__panel-card--volume${isActive ? ' quality-dashboard-page__panel-card--selected' : ''}`}
          >
            <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--start">
              <div className="quality-dashboard-page__dimension">
                <strong>{volume.volumeName}</strong>
                <div className="quality-dashboard-page__body-copy--soft-strong">{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章 · 已分析 ${volume.analyzedChapterCount} 章`}</div>
              </div>
              <Button size="small" type={isActive ? 'primary' : 'default'} onClick={() => onSelectVolume(isActive ? null : volume.volumeId)}>
                {isActive ? '取消筛选' : '筛选此卷'}
              </Button>
            </div>

            <div className="workspace-grid-auto-220">
              <div className="quality-dashboard-page__ghost-card">
                <div className="quality-dashboard-page__body-copy--soft-strong">健康分</div>
                <div className="quality-dashboard-page__medium-number" style={{ color: healthScoreColor(volume.healthScore) }}>{volume.healthScore}</div>
              </div>
              <div className="quality-dashboard-page__ghost-card">
                <div className="quality-dashboard-page__body-copy--soft-strong">平均总分</div>
                <div className="quality-dashboard-page__medium-number">{volume.averageOverallScore}</div>
              </div>
              <div className="quality-dashboard-page__ghost-card">
                <div className="quality-dashboard-page__body-copy--soft-strong">平均 AI 味</div>
                <div className="quality-dashboard-page__medium-number">{volume.averageAiLikeRate}%</div>
              </div>
            </div>

            <div className="quality-dashboard-page__metric-grid-220">
              <div className="quality-dashboard-page__ghost-card quality-dashboard-page__dimension quality-dashboard-page__body-copy--strong">
                <div>{`语言恶化项：${volume.worseningMetricCount}`}</div>
                <div>{`停滞故事弧：${volume.stalledArcCount}`}</div>
                <div>{`高危弧告警：${volume.criticalArcAlertCount}`}</div>
                <div>{`节奏平衡分：${volume.rhythmBalanceScore}`}</div>
              </div>
              <div className="quality-dashboard-page__ghost-card quality-dashboard-page__dimension quality-dashboard-page__body-copy--strong">
                <div>{`伏笔待回收：${volume.foreshadowPendingCount}`}</div>
                <div>{`伏笔已超期：${volume.foreshadowOverdueCount}`}</div>
                <div>{`终局待服务：${volume.endgamePendingCount}`}</div>
                <div>{`终局已过期：${volume.endgameOverdueCount}`}</div>
              </div>
              <div className="quality-dashboard-page__ghost-card quality-dashboard-page__dimension quality-dashboard-page__body-copy--strong">
                <div>{`终局已进入执行链：${volume.endgameServedCount}`}</div>
                <div>{`终局未绑定：${volume.endgameUnboundCount}`}</div>
                <div>{`过期召回：${volume.staleRecallCount} (${volume.staleRecallRate}%)`}</div>
                <div>{`世界冲突：${volume.worldConflictAlertCount} · 预警：${volume.worldWarningCount}`}</div>
              </div>
            </div>

            <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                <div className="quality-dashboard-page__body-copy--strong quality-dashboard-page__section-title">本卷最高优先风险</div>
                {volume.repeatedFunctionRunCount > 0 ? <Tag color="warning" className="quality-dashboard-page__tag-reset">{`重复功能 ${volume.repeatedFunctionRunCount}`}</Tag> : null}
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
              )) : <div className="quality-dashboard-page__body-copy">该卷暂未暴露高优先风险，适合继续写作或做局部修订。</div>}
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
    <div className="quality-dashboard-page__pipeline-list">
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
          className="quality-dashboard-page__risk-button"
        >
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
            <Tag color={getQualityRiskSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">
              {getQualityRiskSeverityLabel(alert.severity)}
            </Tag>
            <Tag color="blue" className="quality-dashboard-page__tag-reset">{alert.kind === 'payoff' ? '终局回收' : '终局承诺'}</Tag>
            <strong>{alert.title}</strong>
          </div>
          <div className="quality-dashboard-page__body-copy">{alert.detail}</div>
          <div className="quality-dashboard-page__body-copy--soft">
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

function HeatmapChart({ data, chapterNums }: { data: QualityHeatmapPoint[]; chapterNums: number[] }) {
  const { byDim, dimensions, displayNums } = useMemo(
    () => buildQualityHeatmapModel(data, chapterNums),
    [data, chapterNums],
  )

  return (
    <div className="quality-dashboard-page__heatmap-scroll">
      <div className="quality-dashboard-page__heatmap-chart" style={{ gridTemplateColumns: `100px repeat(${displayNums.length}, 28px)` }}>
        <div />
        {displayNums.map((num) => (
          <div key={num} className="quality-dashboard-page__heatmap-chart-head">{num}</div>
        ))}
        {dimensions.map((dim) => (
          <React.Fragment key={dim}>
            <div className="quality-dashboard-page__heatmap-chart-dimension">{dim}</div>
            {displayNums.map((num) => {
              const score = byDim.get(dim)?.get(num)
                return (
                  <div
                    key={num}
                    className="quality-dashboard-page__heatmap-chart-cell"
                    style={{ background: score != null ? heatmapCellColor(score) : 'rgba(255,255,255,0.05)' }}
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

  const chartHeight = 200
  const chartWidth = Math.max(400, overallTrend.length * 16)

  const overallPath = buildTrendPath(overallTrend.map((d) => ({ chapterNum: d.chapterNum, value: d.score })), chartWidth, chartHeight, 10)
  const aiLikePath = buildTrendPath(aiLikeTrend.map((d) => ({ chapterNum: d.chapterNum, value: d.rate })), chartWidth, chartHeight, 100)

  return (
    <div className="quality-dashboard-page__chart-scroll">
      <div className="quality-dashboard-page__chart-legend">
        <span className="quality-dashboard-page__chart-legend-item"><span className="quality-dashboard-page__chart-legend-swatch" style={{ background: '#52c41a' }} />总分 (0-10)</span>
        <span className="quality-dashboard-page__chart-legend-item"><span className="quality-dashboard-page__chart-legend-swatch" style={{ background: '#f5222d' }} />AI 味率 (0-100%)</span>
      </div>
      <svg width={chartWidth} height={chartHeight + 20} className="quality-dashboard-page__chart-svg">
        <path d={overallPath} fill="none" stroke="#52c41a" strokeWidth={2} />
        <path d={aiLikePath} fill="none" stroke="#f5222d" strokeWidth={1.5} strokeDasharray="4,3" />
        <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="rgba(255,255,255,0.1)" />
      </svg>
    </div>
  )
}

function WeakDimensionChart({ data }: { data: Array<{ dimension: string; count: number }> }) {
  const { items, maxCount } = buildWeakDimensionBars(data)
  if (items.length === 0) return <Empty description="当前维度表现稳定，没有持续走弱项" />

  return (
    <div className="quality-dashboard-page__bar-chart">
      {items.map((item) => (
        <div key={item.dimension} className="quality-dashboard-page__bar-row">
          <span className="quality-dashboard-page__bar-label">{item.dimension}</span>
          <div className="quality-dashboard-page__bar-track">
            <div className="quality-dashboard-page__bar-fill" style={{ width: `${(item.count / maxCount) * 100}%` }} />
          </div>
          <span className="quality-dashboard-page__bar-value">{item.count} 次</span>
        </div>
      ))}
    </div>
  )
}

function TypedRefObservabilityPanel({ observability }: { observability: NonNullable<QualityDashboardData['typedRefObservability']> }) {
  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__pipeline-tags">
        <Tag color={observability.unresolvedRefCount > 0 ? 'warning' : 'success'}>
          {`总覆盖率 ${observability.overallCoverageRate}%`}
        </Tag>
        <Tag color={observability.unresolvedRefCount > 0 ? 'error' : 'blue'}>
          {`未解析引用 ${observability.unresolvedRefCount}`}
        </Tag>
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        {observability.summary}
      </div>
      <div className="quality-dashboard-page__pipeline-list">
        {observability.buckets.map((bucket) => (
          <div key={bucket.assetType} className="quality-card">
            <div className="quality-dashboard-page__card-head">
              <strong>{bucket.assetType === 'thread' ? '故事线程' : bucket.assetType === 'timeline' ? '时间线事件' : '故事物品'}</strong>
              <Tag color={bucket.unresolvedCount > 0 ? 'warning' : 'success'}>
                {`覆盖 ${bucket.typedRefCount}/${bucket.totalCount}`}
              </Tag>
            </div>
            <div className="quality-dashboard-page__role-meta">
              {`覆盖率 ${bucket.coverageRate}% · 未解析 ${bucket.unresolvedCount}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OperatingModeObservabilityPanel({ observability }: { observability: NonNullable<QualityDashboardData['operatingModeObservability']> }) {
  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__pipeline-tags">
        <Tag color="blue">{observability.label}</Tag>
        <Tag color="cyan">{`参考 ${observability.recommendedChapterWords || 0} 字/章（弹性）`}</Tag>
        <Tag color="geekblue">{`估算约 ${observability.estimatedChapterCount || 0} 章`}</Tag>
        <Tag color="purple">{`近期窗口 ${observability.recentContextWindow || 0} 章`}</Tag>
        <Tag color={observability.quickStartAligned ? 'success' : 'warning'}>
          {observability.quickStartAligned ? '快启对齐' : '快启未对齐'}
        </Tag>
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        {observability.summary}
      </div>
    </div>
  )
}

function MillionRuntimeObservabilityPanel({ observability }: { observability: NonNullable<QualityDashboardData['millionRuntimeObservability']> }) {
  const pressureTagColor = observability.runtimePressureLevel === 'high'
    ? 'error'
    : observability.runtimePressureLevel === 'medium'
      ? 'warning'
      : 'success'
  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__pipeline-tags">
        <Tag color="blue">{observability.label}</Tag>
        <Tag color={observability.serialOnly ? 'success' : 'warning'}>
          {observability.serialOnly ? '正文串行' : chapterGenerationModeLabel(observability.chapterGenerationMode)}
        </Tag>
        <Tag color={observability.backgroundPrecomputeEnabled ? 'cyan' : 'default'}>
          {observability.backgroundPrecomputeEnabled ? '后台预计算开启' : '后台预计算关闭'}
        </Tag>
        <Tag color={observability.requireWritebackReady ? 'purple' : 'default'}>
          {observability.requireWritebackReady ? '回写前置闸门' : '回写非阻断'}
        </Tag>
        <Tag color={observability.precomputeQueueStatus === 'running' ? 'processing' : observability.precomputeQueueStatus === 'queued' ? 'warning' : observability.precomputeQueueStatus === 'failed' ? 'error' : 'default'}>
          {`预计算 ${precomputeQueueStatusLabel(observability.precomputeQueueStatus)}`}
        </Tag>
        <Tag color="geekblue">{`召回阈值 ${observability.recallPauseThreshold}`}</Tag>
        <Tag color={observability.latestCheckpointChapterGap >= observability.checkpointGapWarningThreshold ? 'warning' : 'success'}>
          {`检查点落后 ${observability.latestCheckpointChapterGap}/${observability.checkpointGapWarningThreshold}`}
        </Tag>
        <Tag color={pressureTagColor}>{`压力 ${runtimePressureLevelLabel(observability.runtimePressureLevel)} · ${observability.runtimePressureScore}`}</Tag>
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        {observability.summary}
      </div>
      <div className="quality-dashboard-page__grid-220">
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>运行策略</strong>
            <Tag color="blue">{mainThreadPressureStrategyLabel(observability.mainThreadPressureStrategy)}</Tag>
          </div>
          <div className="quality-dashboard-page__role-meta">{observability.strategySummary}</div>
        </div>
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>后台预计算</strong>
            <Tag color={observability.precomputeQueueStatus === 'running' ? 'processing' : observability.precomputeQueueStatus === 'queued' ? 'warning' : observability.precomputeQueueStatus === 'failed' ? 'error' : 'success'}>
              {precomputeQueueStatusLabel(observability.precomputeQueueStatus)}
            </Tag>
          </div>
          <div className="quality-dashboard-page__role-meta">
            {observability.precomputeActiveTaskSummary || '当前没有长程记忆预计算任务。'}
          </div>
          <div className="quality-dashboard-page__role-meta">
            {`原因 ${observability.precomputeReason || '无'} · 更新时间 ${observability.precomputeUpdatedAt || '无'}${observability.precomputeLastError ? ` · 最近错误 ${observability.precomputeLastError}` : ''}`}
          </div>
        </div>
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>回写与检查点</strong>
            <Tag color={observability.writebackFailedCount > 0 ? 'error' : observability.writebackPendingCount > 0 ? 'warning' : 'success'}>
              {`待处理 ${observability.writebackPendingCount} / 失败 ${observability.writebackFailedCount}`}
            </Tag>
          </div>
          <div className="quality-dashboard-page__role-meta">
            {`过期检查点 ${observability.staleCheckpointCount}，最新落后 ${observability.latestCheckpointChapterGap} 章。`}
          </div>
        </div>
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>召回与阻断</strong>
            <Tag color={observability.consecutiveRecallFallbackChapters >= observability.recallPauseThreshold ? 'error' : observability.recallDegradedChapterCount > 0 ? 'warning' : 'success'}>
              {`连续降级 ${observability.consecutiveRecallFallbackChapters}`}
            </Tag>
          </div>
          <div className="quality-dashboard-page__role-meta">
            {`召回降级 ${observability.recallDegradedChapterCount} 章，检查阻断 ${observability.inspectionBlockedCount}，批次闸门阻断 ${observability.batchGateBlockedCount}。`}
          </div>
        </div>
      </div>
      <div className="quality-dashboard-page__note-list">
        <div>{`当前暂停原因：${observability.pauseReason || '无'}`}</div>
        <div>{`当前护栏原因：${observability.activeGuardrailReason || (observability.guardrailActive ? '已触发运行时护栏。' : '当前无额外护栏阻断。')}`}</div>
        <div>{`主线程压力代理：${observability.runtimePressureSummary}`}</div>
      </div>
    </div>
  )
}

function LongformSoakAcceptancePanel({ novelId, data }: { novelId: number; data: QualityDashboardData }) {
  const exportCommand = buildSoakExportCommand(novelId)
  const validateCommand = buildSoakValidateCommand(novelId)
  const reportPath = buildSoakReportPath(novelId)
  const runtime = data.millionRuntimeObservability
  const typedRef = data.typedRefObservability
  const batchRange = data.batchHealth.chapterIds.length > 0
    ? `${data.batchHealth.chapterStart || Math.min(...data.batchHealth.chapterIds)}-${data.batchHealth.chapterEnd || Math.max(...data.batchHealth.chapterIds)}`
    : '无样本'
  const recallAtRisk = runtime
    ? runtime.consecutiveRecallFallbackChapters >= runtime.recallPauseThreshold || runtime.recallDegradedChapterCount > 0
    : data.continuityHealth.recallDegradedChapterCount > 0
  const gateBlocked = data.batchHealth.failedChapterCount > 0
    || data.batchHealth.pendingWritebackCount > 0
    || Boolean(runtime?.guardrailActive)
    || Boolean(runtime && runtime.inspectionBlockedCount + runtime.batchGateBlockedCount > 0)
  const gateLabel = gateBlocked ? '先修复再验收' : recallAtRisk ? '建议复核召回' : '可进入验收'
  const gateColor = gateBlocked ? 'error' : recallAtRisk ? 'warning' : 'success'

  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__pipeline-tags">
        <Tag color={gateColor}>{gateLabel}</Tag>
        <Tag color={batchStatusColor(data.batchHealth.status)}>{`批次 ${batchStatusLabel(data.batchHealth.status)}`}</Tag>
        <Tag color="blue">{`样本章节 ${batchRange}`}</Tag>
        <Tag color={typedRef && typedRef.unresolvedRefCount > 0 ? 'warning' : 'success'}>
          {`引用覆盖 ${typedRef ? `${typedRef.overallCoverageRate}% / 未解析 ${typedRef.unresolvedRefCount}` : '未统计'}`}
        </Tag>
        <Tag color={recallAtRisk ? 'warning' : 'success'}>
          {runtime ? `召回降级 ${runtime.recallDegradedChapterCount}` : `召回降级 ${data.continuityHealth.recallDegradedChapterCount}`}
        </Tag>
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        真实百万字稳定性需要用已生成项目导出报告再校验；这里把验收入口放进工作台，避免只依赖模拟单测判断生产稳定性。
      </div>
      <div className="quality-dashboard-page__grid-280">
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>导出真实报告</strong>
            <Button size="small" onClick={() => void copySoakCommand(exportCommand)}>复制</Button>
          </div>
          <div className="quality-dashboard-page__command-block">
            <code className="quality-dashboard-page__command-text">{exportCommand}</code>
          </div>
          <div className="quality-dashboard-page__role-meta">
            {`输出 ${reportPath}；导出时请把命令中的 path/to/novelforge.db 替换为本机数据库路径。`}
          </div>
        </div>
        <div className="quality-card">
          <div className="quality-dashboard-page__card-head">
            <strong>校验报告</strong>
            <Button size="small" onClick={() => void copySoakCommand(validateCommand)}>复制</Button>
          </div>
          <div className="quality-dashboard-page__command-block">
            <code className="quality-dashboard-page__command-text">{validateCommand}</code>
          </div>
          <div className="quality-dashboard-page__role-meta">
            验收脚本会检查空正文、上下文命中、重复度、门禁失败和召回退化。
          </div>
        </div>
      </div>
      <div className="quality-dashboard-page__note-list">
        <div>{`当前批次失败 ${data.batchHealth.failedChapterCount}，待回写 ${data.batchHealth.pendingWritebackCount}，待修订 ${data.batchHealth.pendingRevisionCount}。`}</div>
        <div>{runtime ? `运行时阻断：检查 ${runtime.inspectionBlockedCount}，批次闸门 ${runtime.batchGateBlockedCount}，连续召回降级 ${runtime.consecutiveRecallFallbackChapters}/${runtime.recallPauseThreshold}。` : '运行时护栏尚未统计，先用批次健康和连续性健康判断。'}</div>
      </div>
    </div>
  )
}

function StructuredMemoryObservabilityPanel(
  {
    observability,
    hookContinuitySummary,
    voiceEvolutionSummary,
  }: {
    observability: NonNullable<QualityDashboardData['structuredMemoryObservability']>
    hookContinuitySummary: QualityDashboardData['hookContinuitySummary']
    voiceEvolutionSummary: QualityDashboardData['voiceEvolutionSummary']
  },
) {
  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__pipeline-tags">
        <Tag color="blue">{promptSummaryModeLabel(observability.promptSummaryMode)}</Tag>
        <Tag color={observability.fallbackScopeCount > 0 ? 'warning' : 'success'}>{`兜底范围 ${observability.fallbackScopeCount}`}</Tag>
        <Tag color="cyan">{`范围覆盖 ${observability.scopeCoverageRate}%`}</Tag>
        <Tag color="geekblue">{`卡片覆盖 ${observability.cardCoverageRate}%`}</Tag>
        <Tag color={hookContinuitySummary.weakHookStreak > 0 ? 'warning' : 'success'}>{`弱钩子连续 ${hookContinuitySummary.weakHookStreak}`}</Tag>
        <Tag color={voiceEvolutionSummary.driftingCharacterCount > 0 ? 'warning' : 'success'}>{`漂移角色 ${voiceEvolutionSummary.driftingCharacterCount}`}</Tag>
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        {observability.summary}
      </div>
      <div className="quality-dashboard-page__pipeline-list">
        {observability.buckets.map((bucket) => (
          <div key={`${bucket.scopeType}-${bucket.label}`} className="quality-card">
            <div className="quality-dashboard-page__card-head">
              <strong>{`${memoryScopeLabel(bucket.scopeType)} · ${bucket.label}`}</strong>
              <Tag color={!bucket.hasCheckpoint ? 'default' : bucket.usesTextFallback ? 'warning' : 'success'}>
                {!bucket.hasCheckpoint ? '无检查点' : bucket.usesTextFallback ? '含兜底文本' : '结构化优先'}
              </Tag>
            </div>
            <div className="quality-dashboard-page__role-meta">
              {`结构化 ${bucket.structuredFamilyCount} / 兜底 ${bucket.fallbackFamilyCount} / 缺失 ${bucket.missingFamilyCount} · 覆盖 ${bucket.cardCoverageRate}%`}
            </div>
          </div>
        ))}
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        {hookContinuitySummary.summary}
      </div>
      <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">
        {voiceEvolutionSummary.summary}
      </div>
    </div>
  )
}
