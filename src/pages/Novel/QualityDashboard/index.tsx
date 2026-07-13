import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal, Progress, Skeleton, Spin, Tabs, Tag, message } from 'antd'
import VirtualList from 'rc-virtual-list'
import { useNavigate } from 'react-router-dom'
import type { LanguageDriftMetrics, QualityDashboardData, QualityRepairAction, QualityRepairActionResult, TaskPipelineStats } from '../../../types'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import './index.css'
import RecommendationGovernancePanel from './RecommendationGovernancePanel'
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

function getQualityChapterListHeight(): number {
  if (typeof window === 'undefined') return 480
  return Math.min(720, Math.max(420, Math.round(window.innerHeight * 0.56)))
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
  if (kind === 'typed_ref_coverage') return '引用覆盖'
  if (kind === 'source_grounding') return '来源支撑'
  if (kind === 'operating_mode_policy') return '运行模式策略'
  if (kind === 'genre_register_drift') return '题材语域漂移'
  if (kind === 'exposition_density') return '解释密度 / 说明文'
  if (kind === 'long_window_homogenization') return '累积同质化'
  if (kind === 'dialogue_separability') return '对白可分离度'
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
  if (key === 'typed_ref_coverage') return '引用覆盖'
  if (key === 'source_grounding') return '来源支撑'
  if (key === 'operating_mode_policy') return '运行模式策略'
  if (key === 'genre_register_drift') return '题材语域漂移'
  if (key === 'exposition_density') return '解释密度 / 说明文'
  if (key === 'long_window_homogenization') return '累积同质化'
  if (key === 'dialogue_separability') return '对白可分离度'
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
  return buildWorkspaceRoute(novelId, `${page}${queryString ? `?${queryString}` : ''}`)
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

function batchStatusLabel(status: QualityDashboardData['batchHealth']['status']): string {
  if (status === 'idle') return '空闲'
  if (status === 'pending') return '待启动'
  if (status === 'running') return '运行中'
  if (status === 'paused') return '已暂停'
  if (status === 'success') return '已完成'
  if (status === 'failed') return '失败'
  return '已取消'
}

function pipelineRoleLabel(role: TaskPipelineStats['roleStats'][number]['role']): string {
  if (role === 'planner') return '规划'
  if (role === 'writer') return '写作'
  if (role === 'critic') return '审校'
  if (role === 'rewriter') return '重写'
  if (role === 'canonizer') return '回写'
  return '定稿'
}

function runtimePressureLevelLabel(level: NonNullable<QualityDashboardData['millionRuntimeObservability']>['runtimePressureLevel']): string {
  if (level === 'high') return '高'
  if (level === 'medium') return '中'
  return '低'
}

function precomputeQueueStatusLabel(status: NonNullable<QualityDashboardData['millionRuntimeObservability']>['precomputeQueueStatus']): string {
  if (status === 'queued') return '排队'
  if (status === 'running') return '运行中'
  if (status === 'failed') return '失败'
  return '空闲'
}

function chapterGenerationModeLabel(mode: NonNullable<QualityDashboardData['millionRuntimeObservability']>['chapterGenerationMode']): string {
  if (mode === 'serial_only') return '正文串行'
  return mode
}

function mainThreadPressureStrategyLabel(strategy: NonNullable<QualityDashboardData['millionRuntimeObservability']>['mainThreadPressureStrategy']): string {
  if (strategy === 'latency_first') return '优先速度'
  if (strategy === 'balanced') return '均衡'
  return '优先稳定'
}

function sourceCoverageLabel(coverage?: NonNullable<QualityDashboardData['genreGroundingObservability']>['sourceCoverage']): string {
  if (coverage === 'grounded') return '已支撑'
  if (coverage === 'partial') return '部分支撑'
  return '无来源'
}

function historicalModeLabel(mode?: NonNullable<QualityDashboardData['genreGroundingObservability']>['historicalMode']): string {
  if (mode === 'historical_realist') return '历史写实'
  if (mode === 'alternate_history') return '架空历史'
  if (mode === 'pseudo_historical_fantasy') return '类史幻想'
  return '非历史'
}

function promptSummaryModeLabel(mode: NonNullable<QualityDashboardData['structuredMemoryObservability']>['promptSummaryMode']): string {
  if (mode === 'structured_first') return '结构化优先'
  return mode
}

function memoryScopeLabel(scope: NonNullable<QualityDashboardData['structuredMemoryObservability']>['buckets'][number]['scopeType']): string {
  if (scope === 'novel') return '全书'
  if (scope === 'volume') return '分卷'
  return '分部'
}

function characterRoleTypeLabel(roleType: string): string {
  if (roleType === 'protagonist') return '主角'
  if (roleType === 'major') return '主要角色'
  if (roleType === 'minor') return '次要角色'
  if (roleType === 'antagonist') return '对手'
  if (roleType === 'supporting') return '配角'
  return roleType
}

function costResolutionStateLabel(state?: NonNullable<QualityDashboardData['chapterDetails'][number]['storyDynamics']>['costResolutionState'] | null): string {
  if (state === 'ongoing') return '持续中'
  if (state === 'resolved') return '已解决'
  if (state === 'evaporated') return '已蒸发'
  return '新代价'
}

function reversalSupportStateLabel(state?: NonNullable<QualityDashboardData['chapterDetails'][number]['storyDynamics']>['reversalSupportState'] | null): string {
  if (state === 'supported') return '有支撑'
  if (state === 'forced') return '生硬'
  return '偏弱'
}

function rewardStateLabel(state: NonNullable<QualityDashboardData['chapterDetails'][number]['storyDynamics']>['rewardState']): string {
  if (state === 'major') return '明确回报'
  if (state === 'partial') return '部分回报'
  return '无回报'
}

function buildSoakReportPath(novelId: number): string {
  return `.tmp-tests/real-chapter-soak-report-${novelId}.json`
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildSoakExportCommand(novelId: number): string {
  return `npm run soak:export-chapter-report -- --db ${quotePowerShellArg('path/to/novelforge.db')} --novelId ${novelId} --out ${quotePowerShellArg(buildSoakReportPath(novelId))}`
}

function buildSoakValidateCommand(novelId: number): string {
  return `npm run test:chapter-soak -- --report ${quotePowerShellArg(buildSoakReportPath(novelId))}`
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

function recallSnapshotSourceLabel(source?: QualityDashboardData['chapterDetails'][number]['recallSnapshotSource']): string | null {
  if (source === 'runtime') return '真实运行快照'
  if (source === 'backfilled') return '历史回填快照'
  return null
}

function recallSnapshotSourceColor(source?: QualityDashboardData['chapterDetails'][number]['recallSnapshotSource']): string {
  return source === 'backfilled' ? 'gold' : 'cyan'
}

function recallFallbackReasonLabel(reason?: string): string {
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

function agentArtifactKindLabel(kind: string): string {
  if (kind === 'quality_report') return '质量报告'
  if (kind === 'repair_plan') return '修复计划'
  if (kind === 'quality_repair_draft') return '候选 Diff'
  if (kind === 'quality_repair_review') return '独立审校'
  if (kind === 'quality_comparison') return '比较结果'
  return kind
}

function agentArtifactStatusLabel(status: string): string {
  if (status === 'draft') return '草稿'
  if (status === 'reviewed') return '已审校'
  if (status === 'approved') return '已批准'
  if (status === 'committed') return '已提交'
  if (status === 'rejected') return '已拒绝'
  if (status === 'superseded') return '已被替代'
  return status
}

function agentArtifactStatusColor(status: string): string {
  if (status === 'approved' || status === 'committed' || status === 'reviewed') return 'success'
  if (status === 'rejected') return 'error'
  if (status === 'superseded') return 'default'
  return 'processing'
}

function artifactHashTail(hash: string): string {
  return hash ? `…${hash.slice(-12)}` : '-'
}

function signedDashboardDelta(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
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

  const overviewContent = (
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
          onSelectVolume={setSelectedVolumeId}
          onClearVolume={() => setSelectedVolumeId(null)}
          onSelectRisk={handleRiskSelect}
          onRunAction={handleRepairAction}
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
            <div className="quality-dashboard-page__chapter-list" style={{ height: chapterListHeight }}>
              <VirtualList data={filteredChapterDetails} height={chapterListHeight} itemHeight={56} itemKey="chapterId">
                {(entry: QualityChapterEntry) => (
                  <div
                    key={entry.chapterId}
                    className="quality-dashboard-page__chapter-row"
                    onClick={() => setSelectedChapter(entry)}
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
            expressionDedupSummary={data.expressionDedupSummary}
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
        <WorkspaceMetric key="mode" label="运行模式" value={data.operatingModeObservability?.label || '未推导'} hint={data.operatingModeObservability ? `约 ${data.operatingModeObservability.recommendedChapterWords || 0} 字/章 · 预计 ${data.operatingModeObservability.estimatedChapterCount || 0} 章 · 近期窗口 ${data.operatingModeObservability.recentContextWindow || 0} 章` : undefined} />,
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
          <div className="quality-dashboard-page__chapter-modal">
            <div className="quality-dashboard-page__chapter-scores">
              <div className="quality-dashboard-page__chapter-score">
                <Progress
                  type="dashboard"
                  percent={selectedChapter.overallScore * 10}
                  strokeColor={scoreColor(selectedChapter.overallScore)}
                  format={() => <span className="quality-dashboard-page__chapter-score-value">{selectedChapter.overallScore}</span>}
                />
                <div className="quality-dashboard-page__chapter-score-label">总分</div>
              </div>
              <div className="quality-dashboard-page__chapter-score">
                <Progress
                  type="dashboard"
                  percent={100 - selectedChapter.aiLikeRate}
                  strokeColor={selectedChapter.aiLikeRate > 50 ? '#f5222d' : selectedChapter.aiLikeRate > 30 ? '#faad14' : '#52c41a'}
                  format={() => <span className="quality-dashboard-page__chapter-score-value">{selectedChapter.aiLikeRate}%</span>}
                />
                <div className="quality-dashboard-page__chapter-score-label">AI 味率</div>
              </div>
            </div>
            {selectedChapter.dimensions.map((dim) => (
              <div key={dim.name} className="quality-dashboard-page__dimension">
                <div className="quality-dashboard-page__dimension-head">
                  <span className="quality-dashboard-page__dimension-name">{dim.name}</span>
                  <Tag color={scoreColor(dim.score)} className="quality-dashboard-page__tag-reset">{dim.score}</Tag>
                </div>
                <Progress
                  percent={dim.score * 10}
                  showInfo={false}
                  strokeColor={scoreColor(dim.score)}
                  size="small"
                />
                {dim.feedback ? <div className="quality-dashboard-page__dimension-feedback">{dim.feedback}</div> : null}
                {dim.suggestion ? <div className="quality-dashboard-page__dimension-hint">{dim.suggestion}</div> : null}
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
    <div className="quality-dashboard-page__stack">
      {selectedVolumeLabel ? (
        <div className="quality-dashboard-page__filter-callout">
          当前按卷筛选：{selectedVolumeLabel}。章节验收门趋势、热力图和漂移告警已同步收窄到该卷。
        </div>
      ) : null}

      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均门分</div>
          <div className="quality-dashboard-page__big-number" style={{ color: chapterGateHeatmapColor(averageVisibleScore) }}>{averageVisibleScore}</div>
          <div className="quality-dashboard-page__body-copy--soft">当前视图下最近快照的总分均值</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">稳定 / 关注</div>
          <div className="quality-dashboard-page__big-number">{bandCounts.stable} / {bandCounts.attention}</div>
          <div className="quality-dashboard-page__body-copy--soft">80+ 稳定，60-79 需要关注</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">风险 / 失稳</div>
          <div className="quality-dashboard-page__big-number">{bandCounts.risky} / {bandCounts.unstable}</div>
          <div className="quality-dashboard-page__body-copy--soft">40-59 风险，40 以下失稳</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最近恶化</div>
          <div className="quality-dashboard-page__big-number" style={{ color: visibleAlerts.length > 0 ? '#f5222d' : '#52c41a' }}>{visibleAlerts.filter((alert) => alert.status === 'worsening').length}</div>
          <div className="quality-dashboard-page__body-copy--soft">门级恶化或总分明显回落的章节数</div>
        </div>
      </div>

      <div className="quality-dashboard-page__dual-grid">
        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__section-title">章节门趋势</div>
          <MiniTrendRow label="总分" points={trend.map((entry) => ({ chapterNum: entry.chapterNum, value: entry.totalScore }))} />
          <MiniTrendRow
            label="门级压力"
            points={trend.map((entry) => ({
              chapterNum: entry.chapterNum,
              value: entry.gateLevel === 'rewrite' ? 100 : entry.gateLevel === 'blocker' ? 72 : entry.gateLevel === 'warning' ? 38 : 10,
            }))}
          />
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
            <Tag color={chapterGateLevelColor('pass')} className="quality-dashboard-page__tag-reset">{`通过 ${levelCounts.pass}`}</Tag>
            <Tag color={chapterGateLevelColor('warning')} className="quality-dashboard-page__tag-reset">{`预警 ${levelCounts.warning}`}</Tag>
            <Tag color={chapterGateLevelColor('blocker')} className="quality-dashboard-page__tag-reset">{`阻塞 ${levelCounts.blocker}`}</Tag>
            <Tag color={chapterGateLevelColor('rewrite')} className="quality-dashboard-page__tag-reset">{`重写 ${levelCounts.rewrite}`}</Tag>
          </div>
        </div>

        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__section-title">最近漂移告警</div>
          {visibleAlerts.length > 0 ? visibleAlerts.map((alert) => (
            <button
              key={`${alert.chapterId}-${alert.createdAt}`}
              type="button"
              onClick={() => onSelectChapter(alert.chapterNum)}
              className="quality-dashboard-page__risk-button"
            >
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
                <Tag color={chapterGateAlertColor(alert.status)} className="quality-dashboard-page__tag-reset">{chapterGateAlertLabel(alert.status)}</Tag>
                <Tag color={chapterGateLevelColor(alert.currentGateLevel)} className="quality-dashboard-page__tag-reset">{chapterGateLevelLabel(alert.currentGateLevel)}</Tag>
                <strong>{alert.title}</strong>
              </div>
              <div className="quality-dashboard-page__body-copy">{alert.detail}</div>
            </button>
          )) : <div className="quality-dashboard-page__body-copy">当前视图内最近没有明显的门级恶化或回升。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__panel-card">
        <div className="quality-dashboard-page__section-title">维度热力图</div>
        <div className="quality-dashboard-page__heatmap-scroll">
          <div className="quality-dashboard-page__heatmap-grid" style={{ minWidth: Math.max(640, chapterNums.length * 64) }}>
            <div className="quality-dashboard-page__heatmap-row quality-dashboard-page__heatmap-header" style={{ gridTemplateColumns: `120px repeat(${chapterNums.length}, minmax(44px, 1fr))` }}>
              <div>维度 / 章节</div>
              {chapterNums.map((chapterNum) => <div key={`head-${chapterNum}`} className="quality-dashboard-page__heatmap-head-cell">{chapterNum}</div>)}
            </div>
            {dimensions.map((dimension) => (
              <div key={dimension} className="quality-dashboard-page__heatmap-row" style={{ gridTemplateColumns: `120px repeat(${chapterNums.length}, minmax(44px, 1fr))` }}>
                <div className="quality-dashboard-page__heatmap-dimension">{dimension}</div>
                {chapterNums.map((chapterNum) => {
                  const entry = heatmapValueMap.get(`${chapterNum}:${dimension}`)
                  const score = entry?.score || 0
                  return (
                    <button
                      key={`${chapterNum}-${dimension}`}
                      type="button"
                      onClick={() => onSelectChapter(chapterNum)}
                      className="quality-dashboard-page__heatmap-button"
                      style={{ background: chapterGateHeatmapColor(score) }}
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

      <div className="quality-dashboard-page__chapter-snapshot">
        <div className="quality-dashboard-page__section-title">最近章节快照</div>
        {recentTrend.map((entry) => (
          <button
            key={`${entry.chapterId}-${entry.createdAt}`}
            type="button"
            onClick={() => onSelectChapter(entry.chapterNum)}
            className="quality-dashboard-page__chapter-snapshot-item"
          >
            <strong>{`第${entry.chapterNum}章`}</strong>
            <Tag color={chapterGateLevelColor(entry.gateLevel)} className="quality-dashboard-page__tag-reset">{chapterGateLevelLabel(entry.gateLevel)}</Tag>
            <Tag color={chapterGateBandColor(entry.scoreBand)} className="quality-dashboard-page__tag-reset">{chapterGateBandLabel(entry.scoreBand)}</Tag>
            <span style={{ fontWeight: 700, color: chapterGateHeatmapColor(entry.totalScore) }}>{entry.totalScore}</span>
            <span className="quality-dashboard-page__body-copy--soft-strong">{new Date(entry.createdAt).toLocaleString()}</span>
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
    <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
        <Tag color={getQualityRiskSeverityColor(risk.severity)} className="quality-dashboard-page__tag-reset">
          {getQualityRiskSeverityLabel(risk.severity)}
        </Tag>
        <Tag color="blue" className="quality-dashboard-page__tag-reset">{qualityRiskKindLabel(risk.kind)}</Tag>
        {risk.metricKey ? <Tag color="purple" className="quality-dashboard-page__tag-reset">{qualityRepairMetricLabel(risk.metricKey)}</Tag> : null}
        <strong>{risk.title}</strong>
      </div>
      <div className="quality-dashboard-page__body-copy">{risk.detail}</div>
      <div className="quality-dashboard-page__dimension quality-dashboard-page__body-copy--strong">
        <div><strong>原因：</strong>{risk.whyItHappened}</div>
        <div><strong>修法：</strong>{risk.howToFix}</div>
      </div>
      <div className="quality-dashboard-page__body-copy--soft">
        {risk.chapterNums.length > 0 ? `涉及章节：${risk.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}` : '当前风险没有绑定具体章节。'}
      </div>
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
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
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已标注章节</div>
          <div className="quality-dashboard-page__medium-number">{summary.trackedChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">具备主功能或功能标签的章节数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">功能覆盖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.chapterPurposeCoverage}%</div>
          <div className="quality-dashboard-page__body-copy--soft">已被明确标注叙事职责的章节占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">节奏平衡分</div>
          <div className="quality-dashboard-page__medium-number">{summary.rhythmBalanceScore}</div>
          <div className="quality-dashboard-page__body-copy--soft">
            主功能偏向 {summary.dominantTag ? `${chapterFunctionLabel(summary.dominantTag)} ${summary.dominantTagShare}%` : '待分析'}
          </div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最长重复链</div>
          <div className="quality-dashboard-page__medium-number">{summary.longestRepeatedFunctionRun}</div>
          <div className="quality-dashboard-page__body-copy--soft">连续重复主功能区段 {summary.repeatedFunctionRunCount} 处</div>
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
        <div className="quality-dashboard-page__section-title">功能覆盖分布</div>
        <div className="quality-dashboard-page__chapter-function-grid">
          {CHAPTER_FUNCTION_ORDER.map((tag) => {
            const count = summary.tagCounts[tag] || 0
            const share = summary.trackedChapterCount > 0 ? Math.round((count / summary.trackedChapterCount) * 100) : 0
            return (
              <div key={tag} className="quality-dashboard-page__function-card" style={{ border: `1px solid ${chapterFunctionColor(tag)}` }}>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{chapterFunctionLabel(tag)}</span>
                  <span className="quality-dashboard-page__row-label" style={{ color: chapterFunctionColor(tag) }}>{share}%</span>
                </div>
                <Progress percent={share} showInfo={false} strokeColor={chapterFunctionColor(tag)} size="small" />
                <div className="quality-dashboard-page__body-copy--tiny">覆盖 {count} 章</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-260">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">重复功能区段</div>
          {runs.length > 0 ? runs.slice(0, 8).map((run, index) => (
            <div key={`${run.startChapterNum}-${run.primaryTag}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={run.length >= 5 ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">{chapterFunctionLabel(run.primaryTag)}</Tag>
                <span className="quality-dashboard-page__row-label">第{run.startChapterNum}-{run.endChapterNum}章</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">连续 {run.length} 章都以 {chapterFunctionLabel(run.primaryTag)} 为主功能。</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">章节主功能没有出现连续空转。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期功能告警</div>
          {alerts.length > 0 ? alerts.slice(0, 8).map((alert, index) => (
            <div key={`${alert.code}-${index}-${alert.chapterNums.join('-')}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={chapterFunctionAlertColor(alert.severity)} className="quality-dashboard-page__tag-reset">
                  {getStoryPacingSeverityLabel(alert.severity)}
                </Tag>
                <span className="quality-dashboard-page__row-label">{alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">近期没有新的章节功能偏移。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级功能摘要</div>
          <div className="quality-dashboard-page__metric-grid-240">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div className="quality-dashboard-page__body-copy--strong">
                  覆盖 {volume.trackedChapterCount} 章 · 平衡分 {volume.rhythmBalanceScore}
                </div>
                <div className="quality-dashboard-page__body-copy--strong">
                  主功能偏向 {volume.dominantTag ? `${chapterFunctionLabel(volume.dominantTag)} ${volume.dominantTagShare}%` : '待分析'}
                </div>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--tight">
                  {volume.repeatedRuns.slice(0, 2).map((run) => (
                    <Tag key={`${volume.volumeId}-${run.startChapterNum}-${run.primaryTag}`} color={run.length >= 5 ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                      {chapterFunctionLabel(run.primaryTag)} {run.length}连
                    </Tag>
                  ))}
                  {volume.alerts.filter((alert) => alert.code === 'volume_function_skew').slice(0, 1).map((alert, index) => (
                    <Tag key={`${volume.volumeId}-skew-${index}`} color={chapterFunctionAlertColor(alert.severity)} className="quality-dashboard-page__tag-reset">
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">分析章节</div>
          <div className="quality-dashboard-page__medium-number">{summary.analyzedChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">已纳入召回可靠性诊断的章节数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回依赖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.recallDependencyRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">实际保留下来的背景补充片段占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回可用率</div>
          <div className="quality-dashboard-page__medium-number">{summary.recallAvailabilityRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">最终 prompt 实际使用召回补充的章节占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均命中数</div>
          <div className="quality-dashboard-page__medium-number">{summary.averageHitCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">每章平均召回到的历史片段数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">过期召回</div>
          <div className="quality-dashboard-page__medium-number">{summary.staleRecallCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">被识别为疑似过期的历史片段</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">过期召回率</div>
          <div className="quality-dashboard-page__medium-number">{summary.staleRecallRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">本地回查命中里疑似过期片段的平均占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">上章先验覆盖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.previousChapterFeedCoverageRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">上一章先验采样覆盖上一章正文的平均比例</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回桶覆盖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.bucketCoverageRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">角色 / 规则 / 线程三个桶的平均命中覆盖</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">上章先验字数</div>
          <div className="quality-dashboard-page__medium-number">{summary.previousChapterFeedChars}</div>
          <div className="quality-dashboard-page__body-copy--soft">每章平均喂入的上一章先验文本长度</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">连续降级章节</div>
          <div className="quality-dashboard-page__medium-number">{summary.consecutiveFallbackChapters}</div>
          <div className="quality-dashboard-page__body-copy--soft">{summary.latestFallbackReason ? `最近原因：${summary.latestFallbackReason}` : '召回链路目前稳定。'}</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期召回降级章节</div>
          {alerts.length > 0 ? alerts.map((alert) => (
            <div key={alert.chapterId} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={alert.degraded ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">{alert.degraded ? '召回降级' : '过期召回'}</Tag>
                {alert.recallSnapshotSource ? (
                  <Tag color={recallSnapshotSourceColor(alert.recallSnapshotSource)} className="quality-dashboard-page__tag-reset">
                    {recallSnapshotSourceLabel(alert.recallSnapshotSource)}
                  </Tag>
                ) : null}
                <span className="quality-dashboard-page__row-label">第{alert.chapterNum}章 · {alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的召回降级章节。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回摘要</div>
          <div className="quality-dashboard-page__pipeline-tags">
            <Tag color="blue">{`保留 ${summary.selectedHitCount}`}</Tag>
            <Tag color={summary.fallbackHitCount > 0 ? 'warning' : 'success'}>{`兜底 ${summary.fallbackHitCount}`}</Tag>
            <Tag color="cyan">{`可用 ${summary.recallAvailabilityRate}%`}</Tag>
            <Tag color="geekblue">{`桶覆盖 ${summary.bucketCoverageRate}%`}</Tag>
            <Tag>{`上章 ${summary.previousChapterFeedCoverageRate}%`}</Tag>
          </div>
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级召回诊断</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div className="quality-dashboard-page__body-copy--strong">可用率 {volume.recallAvailabilityRate}% · 平均命中 {volume.averageHitCount} · 召回桶 {volume.bucketCoverageRate}%</div>
                <div className="quality-dashboard-page__body-copy--strong">依赖率 {volume.recallDependencyRate}% · 过期 {volume.staleRecallCount} · 过期率 {volume.staleRecallRate}%</div>
                <div className="quality-dashboard-page__body-copy--strong">降级 {volume.degradedChapterCount} 章{volume.latestFallbackReason ? ` · 最近原因 ${volume.latestFallbackReason}` : ''}</div>
                <div className="quality-dashboard-page__body-copy--strong">上章先验覆盖 {volume.previousChapterFeedCoverageRate}% · 平均 {volume.previousChapterFeedChars} 字</div>
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
  const filtered = data.filter((d) => d.count > 0)
  if (filtered.length === 0) return <Empty description="当前维度表现稳定，没有持续走弱项" />

  const maxCount = Math.max(...filtered.map((d) => d.count), 1)

  return (
    <div className="quality-dashboard-page__bar-chart">
      {filtered.map((item) => (
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

const LANGUAGE_DRIFT_LABELS: Array<{ key: keyof LanguageDriftMetrics; label: string }> = [
  { key: 'abstractTokenDensity', label: '抽象词密度' },
  { key: 'sentencePatternRepeatRate', label: '句式重复率' },
  { key: 'endingSummaryRate', label: '段尾升华率' },
  { key: 'ornamentOverloadRate', label: '华丽词堆砌率' },
  { key: 'nonHumanCollocationRate', label: '非人类搭配率' },
  { key: 'dashDensity', label: '破折号密度' },
  { key: 'parentheticalExplanationDensity', label: '括号说明密度' },
  { key: 'metaphorStackRate', label: '比喻堆叠率' },
  { key: 'parallelismRate', label: '排比句率' },
  { key: 'bodyDetailClicheRate', label: '手眼声音细节密度' },
  { key: 'isolatedTemplateParagraphRate', label: '孤立模板短段率' },
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
  expressionDedupSummary,
  antiAiRecurrence,
  feedbackRecurrence,
}: {
  averages: LanguageDriftMetrics
  trends: QualityDashboardData['languageDriftTrends']
  recentAlerts: QualityDashboardData['recentLanguageDriftAlerts']
  volumeEntries: QualityDashboardData['volumeLanguageDrift']
  novelSummary: QualityDashboardData['novelLanguageDriftSummary']
  expressionDedupSummary: QualityDashboardData['expressionDedupSummary']
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-160">
        {cards.map((card) => (
          <div key={card.key} className="quality-dashboard-page__stat-card">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
            <div className="quality-dashboard-page__medium-number" style={{ color: languageDriftRiskColor(card.value) }}>{card.value}</div>
            <div className="quality-dashboard-page__body-copy--soft">平均风险值，越低越好</div>
          </div>
        ))}
      </div>

      <div className="quality-dashboard-page__grid-220">
        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">全书级摘要</div>
          <div className="quality-dashboard-page__row-label">
            已纳入 {novelSummary.chapterCount} 章
            {novelSummary.recentWindowSize > 0 ? ` · 最近窗口 ${novelSummary.recentWindowSize} 章` : ''}
          </div>
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
            <Tag color="error" className="quality-dashboard-page__tag-reset">恶化 {novelSummary.statusBreakdown.worsening}</Tag>
            <Tag color="success" className="quality-dashboard-page__tag-reset">改善 {novelSummary.statusBreakdown.improving}</Tag>
            <Tag className="quality-dashboard-page__tag-reset">稳定 {novelSummary.statusBreakdown.stable}</Tag>
          </div>
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">当前最高优先问题</div>
          {topRiskMetrics.length > 0 ? topRiskMetrics.map((item) => (
            <div key={item.metric} className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
              <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{item.label}</span>
              <span className="quality-dashboard-page__value-accent" style={{ color: languageDriftRiskColor(item.value) }}>{item.value}</span>
            </div>
          )) : (
            <div className="quality-dashboard-page__body-copy">等待分解结果</div>
          )}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最近恶化项</div>
          {recentAlerts.length > 0 ? recentAlerts.slice(0, 3).map((alert) => (
            <div key={alert.metric} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                  <Tag color={languageDriftStatusColor(alert.status)} className="quality-dashboard-page__tag-reset">
                    {languageDriftStatusLabel(alert.status)}
                  </Tag>
                  <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{alert.label}</span>
                </div>
                <span className="quality-dashboard-page__row-label" style={{ color: '#f5222d' }}>{formatSignedValue(alert.delta)}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny">
                窗口均值 {alert.previousValue} → {alert.latestValue}
              </div>
            </div>
          )) : (
            <div className="quality-dashboard-page__body-copy">最近窗口内没有明显恶化项。</div>
          )}
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-160">
        {[
          { label: '命中章节', value: antiAiRecurrence.hitChapterCount, note: '至少命中过一次 AI 味规则的章节' },
          { label: '复现规则', value: antiAiRecurrence.recurringRuleCount, note: '跨章重复出现的问题类型' },
          { label: '已升级硬约束', value: antiAiRecurrence.promotedRuleCount, note: '连续 2 章命中后自动升级' },
          { label: '5章高风险', value: antiAiRecurrence.highRiskRuleCount, note: '5 章窗口内至少 3 次复现' },
        ].map((card) => (
          <div key={card.label} className="quality-dashboard-page__stat-card">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
            <div className="quality-dashboard-page__medium-number">{card.value}</div>
            <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跨章高频问题</div>
          {antiAiRecurrence.topRepeatedRules.length > 0 ? antiAiRecurrence.topRepeatedRules.slice(0, 4).map((item) => (
            <div key={item.ruleCode} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <span className="quality-dashboard-page__row-label">{item.ruleTitle}</span>
                <Tag color={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                  {`第 ${item.lastChapterNum} 章`}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">
                {`命中 ${item.hitCount} 次 / 覆盖 ${item.chapterCount} 章`}
                {item.promotedCount > 0 ? ` · 已升级 ${item.promotedCount} 次` : ''}
              </div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">当前还没有跨章复现的 AI 味规则。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已升级为下一章硬约束</div>
          {antiAiRecurrence.promotedRules.length > 0 ? antiAiRecurrence.promotedRules.slice(0, 4).map((item) => (
            <div key={item.ruleCode} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                <span className="quality-dashboard-page__row-label">{item.ruleTitle}</span>
                <Tag color="gold" className="quality-dashboard-page__tag-reset">已前置</Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">
                {`触发章节：${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}
              </div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的连续两章复现问题。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期告警</div>
          {antiAiRecurrence.recentAlerts.length > 0 ? antiAiRecurrence.recentAlerts.slice(0, 4).map((alert) => (
            <div key={`${alert.ruleCode}-${alert.lastChapterNum}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <span className="quality-dashboard-page__row-label">{alert.ruleTitle}</span>
                <Tag color={alert.severity === 'critical' ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                  {alert.severity === 'critical' ? '需回查' : '已升级'}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">近期没有新的 AI 味复现。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
        {LANGUAGE_DRIFT_LABELS.map(({ key, label }) => (
          <MiniTrendRow key={key} label={label} points={trends[key]} />
        ))}
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级语言退化</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => {
              const topMetrics = getTopLanguageDriftMetrics(volume.averageMetrics, 2)
              return (
                <div key={volume.volumeId} className="quality-dashboard-page__panel-card">
                  <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--start">
                    <div>
                      <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                      <div className="quality-dashboard-page__body-copy--tiny">
                        第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章
                      </div>
                    </div>
                    <Tag color={volume.topWorseningMetrics.length > 0 ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">
                      {volume.topWorseningMetrics.length > 0 ? `${volume.topWorseningMetrics.length} 项恶化` : '近期稳定'}
                    </Tag>
                  </div>

                  <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-6">
                    {topMetrics.map((item) => (
                      <div key={item.key} className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
                        <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{item.label}</span>
                        <span className="quality-dashboard-page__value-accent" style={{ color: languageDriftRiskColor(item.value) }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="quality-dashboard-page__body-copy--tiny">
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
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级 AI 味复现</div>
          <div className="quality-dashboard-page__grid-220">
            {antiAiRecurrence.volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章`}</div>
                <div className="quality-dashboard-page__body-copy--strong">{`命中章节 ${volume.hitChapterCount} · 复现规则 ${volume.recurringRuleCount}`}</div>
                <div className="quality-dashboard-page__body-copy--strong">{`已升级 ${volume.promotedRuleCount} · 高风险 ${volume.highRiskRuleCount}`}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
        <div className="quality-dashboard-page__section-title">跨章表达去重</div>

        <div className="quality-dashboard-page__metric-grid-160">
          {[
            {
              label: '当前模式',
              value: expressionDedupSummary.currentMode === 'longform' ? '长篇' : '短篇',
              note: expressionDedupSummary.currentMode === 'longform' ? '启用近章 / 当前卷 / 全书采样三级窗口' : '重点盯最近窗口内的直接复用',
            },
            { label: '高风险章节', value: expressionDedupSummary.highRiskChapterCount, note: '跨章表达或结构复用已进入高风险的章节数' },
            { label: '近章窗口', value: expressionDedupSummary.recentWindowSize || '-', note: '直接进入禁复用判断的最近章节数' },
            {
              label: '卷/全书窗口',
              value: `${expressionDedupSummary.volumeWindowSize || 0}/${expressionDedupSummary.globalSampleWindowSize || 0}`,
              note: '卷内轮换提醒 / 全书级稀疏采样窗口',
            },
          ].map((card) => (
            <div key={card.label} className="quality-dashboard-page__stat-card">
              <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
              <div className="quality-dashboard-page__medium-number">{card.value}</div>
              <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="quality-dashboard-page__metric-grid-240">
          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">高频复用表达</div>
            {expressionDedupSummary.topRepeatedPhrases.length > 0 ? expressionDedupSummary.topRepeatedPhrases.slice(0, 4).map((item) => (
              <div key={item.phrase} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{item.phrase}</span>
                  <Tag className="quality-dashboard-page__tag-reset">{`${item.chapterNums.length} 章`}</Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{`命中 ${item.count} 次 · 覆盖 ${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}</div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">当前还没有稳定复现的高频表达。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">结构同质化</div>
            <div className="quality-dashboard-page__body-copy--tiny-strong">{expressionDedupSummary.summary}</div>
            <div className="quality-dashboard-page__body-copy--strong">
              {expressionDedupSummary.repeatedOpeningPatterns.length > 0 ? `章首：${expressionDedupSummary.repeatedOpeningPatterns.join('、')}` : '章首暂无明显同质化'}
            </div>
            <div className="quality-dashboard-page__body-copy--strong">
              {expressionDedupSummary.repeatedClosingPatterns.length > 0 ? `章尾：${expressionDedupSummary.repeatedClosingPatterns.join('、')}` : '章尾暂无明显同质化'}
            </div>
            <div className="quality-dashboard-page__body-copy--strong">
              {expressionDedupSummary.repeatedClimaxPatterns.length > 0 ? `高潮：${expressionDedupSummary.repeatedClimaxPatterns.join('、')}` : '高潮结构暂无明显复用'}
            </div>
            {expressionDedupSummary.currentMode === 'longform' ? (
              <div className="quality-dashboard-page__body-copy--tiny">
                {expressionDedupSummary.volumeRepeatedPatterns.length > 0 ? `当前卷：${expressionDedupSummary.volumeRepeatedPatterns.join('、')}` : '当前卷暂无稳定同质化模式。'}
                {expressionDedupSummary.globalRepeatedPatterns.length > 0 ? ` 全书：${expressionDedupSummary.globalRepeatedPatterns.join('、')}` : ''}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
        <div className="quality-dashboard-page__section-title">审校反哺与复现闭环</div>

        <div className="quality-dashboard-page__metric-grid-160">
          {[
            { label: '命中章节', value: feedbackRecurrence.hitChapterCount, note: '至少出现一次通用复现问题的章节' },
            { label: '复现问题', value: feedbackRecurrence.recurringIssueCount, note: '跨章重复出现的问题类型' },
            { label: '已升级硬约束', value: feedbackRecurrence.promotedIssueCount, note: '连续 2 章或窗口高风险后自动前置' },
            { label: '建议暂停', value: feedbackRecurrence.pauseSuggestedIssueCount, note: '结构/连续性类高风险复现，建议暂停批量' },
          ].map((card) => (
            <div key={card.label} className="quality-dashboard-page__stat-card">
              <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
              <div className="quality-dashboard-page__medium-number">{card.value}</div>
              <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="quality-dashboard-page__metric-grid-160">
          {[
            { label: '人味命中章节', value: feedbackRecurrence.humanization.hitChapterCount, note: '模板衔接、解释腔、锚点不足、立场发虚等' },
            { label: '人味复现问题', value: feedbackRecurrence.humanization.recurringIssueCount, note: '跨章重复出现的人味问题类型' },
            { label: '人味已前置', value: feedbackRecurrence.humanization.promotedIssueCount, note: '下一章会作为硬约束注入的去 AI 味问题' },
            { label: '人味高风险', value: feedbackRecurrence.humanization.highRiskIssueCount, note: '5 章窗口内高频复现的人味问题' },
          ].map((card) => (
            <div key={card.label} className="quality-dashboard-page__stat-card">
              <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
              <div className="quality-dashboard-page__medium-number">{card.value}</div>
              <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="quality-dashboard-page__metric-grid-240">
          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跨章高频问题</div>
            {feedbackRecurrence.topRepeatedIssues.length > 0 ? feedbackRecurrence.topRepeatedIssues.slice(0, 4).map((item) => (
              <div key={item.issueType} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                    {`第 ${item.lastChapterNum} 章`}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">
                  {`命中 ${item.hitCount} 次 / 覆盖 ${item.chapterCount} 章`}
                  {item.promotedCount > 0 ? ` · 已升级 ${item.promotedCount} 次` : ''}
                </div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">当前还没有跨章复现的通用审校问题。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已升级为下一章硬约束</div>
            {feedbackRecurrence.promotedIssues.length > 0 ? feedbackRecurrence.promotedIssues.slice(0, 4).map((item) => (
              <div key={item.issueType} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.pauseSuggested ? 'error' : 'gold'} className="quality-dashboard-page__tag-reset">
                    {item.pauseSuggested ? '高风险前置' : '已前置'}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">
                  {`触发章节：${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}
                </div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">最近没有新的审校复现硬约束。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期告警</div>
            {feedbackRecurrence.recentAlerts.length > 0 ? feedbackRecurrence.recentAlerts.slice(0, 4).map((alert) => (
              <div key={`${alert.issueType}-${alert.lastChapterNum}`} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{alert.title}</span>
                  <Tag color={alert.pauseSuggested ? 'error' : alert.severity === 'critical' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                    {alert.pauseSuggested ? '建议暂停' : alert.severity === 'critical' ? '需回查' : '已升级'}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">近期没有新的审校复现。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">人味前置约束</div>
            {feedbackRecurrence.humanization.promotedIssues.length > 0 ? feedbackRecurrence.humanization.promotedIssues.slice(0, 4).map((item) => (
              <div key={`humanization-${item.issueType}`} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.pauseSuggested ? 'error' : 'gold'} className="quality-dashboard-page__tag-reset">
                    {item.pauseSuggested ? '高风险前置' : '已前置'}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{item.avoid}</div>
              </div>
            )) : feedbackRecurrence.humanization.topRepeatedIssues.length > 0 ? feedbackRecurrence.humanization.topRepeatedIssues.slice(0, 4).map((item) => (
              <div key={`humanization-trend-${item.issueType}`} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.severity === 'high' ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                    {`第 ${item.lastChapterNum} 章`}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{item.detail}</div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">风格硬约束目前稳定。</div>}
          </div>
        </div>

        {feedbackRecurrence.volumeEntries.length > 0 ? (
          <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
            <div className="quality-dashboard-page__section-title">卷级审校复现</div>
            <div className="quality-dashboard-page__grid-220">
              {feedbackRecurrence.volumeEntries.map((volume) => (
                <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                  <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                  <div className="quality-dashboard-page__body-copy--tiny">{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章`}</div>
                  <div className="quality-dashboard-page__body-copy--strong">{`命中章节 ${volume.hitChapterCount} · 复现问题 ${volume.recurringIssueCount}`}</div>
                  <div className="quality-dashboard-page__body-copy--strong">{`已升级 ${volume.promotedIssueCount} · 高风险 ${volume.highRiskIssueCount}`}</div>
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
      <div className="quality-dashboard-page__mini-trend-empty">
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
    <div className="quality-dashboard-page__mini-trend-row">
      <span className="quality-dashboard-page__mini-trend-label">{label}</span>
      <div className="quality-dashboard-page__mini-trend-scroll">
        <svg width={width} height={height + 4} className="quality-dashboard-page__mini-trend-svg">
          <path d={path} fill="none" stroke={languageDriftRiskColor(latest)} strokeWidth={2} />
        </svg>
      </div>
      <span className="quality-dashboard-page__mini-trend-value" style={{ color: languageDriftRiskColor(latest) }}>{latest}</span>
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-170">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已建角色指纹</div>
          <div className="quality-dashboard-page__medium-number">{stats.eligibleCharacterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">累计识别对白 {stats.totalTurnCount} 段</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均跨角色相似度</div>
          <div className="quality-dashboard-page__medium-number" style={{ color: dialogueSimilarityColor(stats.averageCrossCharacterSimilarity) }}>{stats.averageCrossCharacterSimilarity}</div>
          <div className="quality-dashboard-page__body-copy--soft">越低越能拉开角色声音</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">高相似组合</div>
          <div className="quality-dashboard-page__medium-number">{stats.highSimilarityPairCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">阈值 75 以上</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">漂移角色</div>
          <div className="quality-dashboard-page__medium-number">{stats.driftingCharacterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">近期漂移率 45 以上</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">需声线锁定角色</div>
          <div className="quality-dashboard-page__medium-number">{stats.voiceLockCandidateCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">连续漂移或同声化预警</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期告警</div>
          {alerts.length > 0 ? alerts.map((alert, index) => (
            <div key={`${alert.kind}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={alert.severity === 'warning' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                  {alert.kind === 'similarity' ? '同质化' : '漂移'}
                </Tag>
                <span className="quality-dashboard-page__row-label">{alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的对白指纹告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最高相似角色组合</div>
          {similarities.length > 0 ? similarities.slice(0, 4).map((pair) => (
            <div key={`${pair.characterAId}-${pair.characterBId}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
                <span>{pair.characterAName} / {pair.characterBName}</span>
                <span className="quality-dashboard-page__text-strong" style={{ color: dialogueSimilarityColor(pair.similarity) }}>{pair.similarity}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny">{pair.reasons.join('、') || '句长、停顿和惯用短语接近。'}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">当前样本还不足以计算跨角色相似度。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">需要声线锁定的角色</div>
          {voiceLockCandidates.length > 0 ? voiceLockCandidates.slice(0, 5).map((candidate) => (
            <div key={`${candidate.characterId}-${candidate.severity}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <strong className="quality-dashboard-page__row-label">{candidate.characterName}</strong>
                <Tag color={candidate.severity === 'critical' ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                  {candidate.severity === 'critical' ? '强制' : '建议'}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{candidate.reason}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">当前角色声音区分度足够，不需要新增声线锁定。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        {signatures.slice(0, 6).map((signature) => (
          <div key={signature.characterId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
              <div>
                <div className="quality-dashboard-page__section-title">{signature.characterName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">
                  {signature.sampleCount} 段对白 · {signature.totalDialogueChars} 字
                </div>
              </div>
              <Tag className="quality-dashboard-page__tag-reset">{characterRoleTypeLabel(signature.roleType)}</Tag>
            </div>
            <div className="quality-dashboard-page__body-copy--strong">{signature.voiceProfile}</div>
            {signature.distinctiveHabits.length > 0 ? (
              <div className="quality-dashboard-page__body-copy--tiny-strong">特点：{signature.distinctiveHabits.join('、')}</div>
            ) : null}
            <div className="quality-dashboard-page__body-copy--tiny-strong">
              句长 {signature.avgSentenceLength} · 追问 {signature.questionRate}% · 停顿 {signature.ellipsisRate}% · 重复短语 {signature.catchphraseCandidates.slice(0, 2).map((item) => item.token).join('、') || '未捕捉'}
            </div>
          </div>
        ))}
      </div>

      {driftEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
          <div className="quality-dashboard-page__section-title">角色语音漂移趋势</div>
          {driftEntries.slice(0, 5).map((entry) => (
            <div key={entry.characterId} className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-6">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                  <strong>{entry.characterName}</strong>
                  <Tag color={dialogueTrendColor(entry.status)} className="quality-dashboard-page__tag-reset">{dialogueTrendLabel(entry.status)}</Tag>
                </div>
                <span className="quality-dashboard-page__row-label" style={{ color: dialogueSimilarityColor(entry.recentDriftRate) }}>{entry.recentDriftRate}</span>
              </div>
              <MiniTrendRow label="漂移率" points={entry.trend.map((point) => ({ chapterNum: point.chapterNum, value: point.value }))} />
              {entry.reasons.length > 0 ? <div className="quality-dashboard-page__body-copy--tiny">{entry.reasons.join('、')}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级对白同质化</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <div>
                    <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                    <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <span className="quality-dashboard-page__row-label" style={{ color: dialogueSimilarityColor(volume.averageSimilarity) }}>{volume.averageSimilarity}</span>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">主角受挫率</div>
          <div className="quality-dashboard-page__medium-number">{protagonistSummary.protagonistSetbackRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">重大受挫 {protagonistSummary.majorSetbackRate}%</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均主角压力</div>
          <div className="quality-dashboard-page__medium-number" style={{ color: pressureColor(protagonistSummary.averagePressure) }}>{protagonistSummary.averagePressure}</div>
          <div className="quality-dashboard-page__body-copy--soft">最新压力 {latestPressure}</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">顺推 / 压抑跨度</div>
          <div className="quality-dashboard-page__medium-number">{protagonistSummary.longestSmoothRun} / {protagonistSummary.longestPressureRun}</div>
          <div className="quality-dashboard-page__body-copy--soft">最长连续章节数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">代价持续</div>
          <div className="quality-dashboard-page__medium-number">{costSummary.averageCostDuration}</div>
          <div className="quality-dashboard-page__body-copy--soft">蒸发 {costSummary.evaporatedCostCount} 次 · 未解 {costSummary.unresolvedCostCount} 条</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">节奏告警</div>
          {alerts.length > 0 ? alerts.slice(0, 4).map((alert, index) => (
            <div key={`${alert.code}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={getStoryPacingSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">{getStoryPacingSeverityLabel(alert.severity)}</Tag>
                <span className="quality-dashboard-page__row-label">{alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近窗口内没有明显结构告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">反转 / 高潮 / 喘息</div>
          <div className="quality-dashboard-page__body-copy--strong">反转：{reversalSummary.reversalChapterNums.length > 0 ? reversalSummary.reversalChapterNums.join('、') : '未记录'}</div>
          <div className="quality-dashboard-page__body-copy--strong">高潮：{reversalSummary.climaxChapterNums.length > 0 ? reversalSummary.climaxChapterNums.join('、') : '未记录'}</div>
          <div className="quality-dashboard-page__body-copy--strong">喘息：{reversalSummary.breatherChapterNums.length > 0 ? reversalSummary.breatherChapterNums.join('、') : '未记录'}</div>
          <div className="quality-dashboard-page__body-copy--tiny-strong">强行反转 {reversalSummary.forcedReversalCount} 次，弱反转 {reversalSummary.weakReversalCount} 次，高潮间距 {reversalSummary.climaxSpacing.length > 0 ? reversalSummary.climaxSpacing.join('、') : '未记录'}。</div>
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">未解代价</div>
          {costSummary.activeCosts.length > 0 ? costSummary.activeCosts.map((entry) => (
            <div key={`${entry.startChapterNum}-${entry.summary}`} className="quality-dashboard-page__body-copy--strong">
              第{entry.startChapterNum}章起持续 {entry.duration} 章：{entry.summary}
            </div>
          )) : <div className="quality-dashboard-page__body-copy">代价链目前都已收口或转入稳定阶段。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
        <div className="quality-dashboard-page__section-title">主角压力曲线</div>
        <MiniTrendRow label="主角压力" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.pressure }))} />
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级结构摘要</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <div>
                    <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                    <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <Tag color={volume.alerts.length > 0 ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">{volume.alerts.length > 0 ? `${volume.alerts.length} 项告警` : '近期稳定'}</Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--strong">受挫率 {volume.protagonistSetbackRate}% · 重大受挫 {volume.majorSetbackRate}% · 平均压力 {volume.averagePressure}</div>
                <div className="quality-dashboard-page__body-copy--strong">代价持续 {volume.averageCostDuration} 章 · 蒸发 {volume.evaporatedCostCount} 次</div>
                <div className="quality-dashboard-page__body-copy--strong">高潮 {volume.climaxChapterNums.length > 0 ? volume.climaxChapterNums.join('、') : '未记录'} · 反转 {volume.reversalChapterNums.length > 0 ? volume.reversalChapterNums.join('、') : '未记录'}</div>
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跟踪故事弧</div>
          <div className="quality-dashboard-page__medium-number">{summary.trackedArcCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">已进入推进分析层的主线与支线</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">推进章 / 空转章</div>
          <div className="quality-dashboard-page__medium-number">{summary.progressChapterCount} / {summary.stalledChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">覆盖章节 {summary.coveredChapterCount}</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">停滞故事弧</div>
          <div className="quality-dashboard-page__medium-number">{summary.stalledArcCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">连续空转过长或阶段未兑现</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">严重告警</div>
          <div className="quality-dashboard-page__medium-number">{summary.criticalAlertCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">优先回查阶段收束和长段空转</div>
        </div>
      </div>

      {trend.length > 0 ? (
        <div className="quality-dashboard-page__detail-stack">
          <div className="quality-dashboard-page__section-title">推进 / 空转曲线</div>
          <MiniTrendRow label="推进章数" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.progressCount }))} />
          <MiniTrendRow label="空转章数" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.stalledCount }))} />
        </div>
      ) : null}

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期推进告警</div>
          {alerts.length > 0 ? alerts.slice(0, 6).map((alert, index) => (
            <div key={`${alert.code}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={getStoryArcSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">
                  {getStoryArcSeverityLabel(alert.severity)}
                </Tag>
                <span className="quality-dashboard-page__row-label">{alert.arcName} · {alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的推进告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">故事弧摘要</div>
          {arcs.length > 0 ? arcs.slice(0, 6).map((arc) => (
            <div key={arc.arcId} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <div className="quality-dashboard-page__row-label">{arc.arcName}</div>
                <span className="quality-dashboard-page__row-label" style={{ color: arcProgressRateColor(arc.progressRate) }}>{arc.progressRate}%</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{arc.statusSummary}</div>
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--tight">
                <Tag color={arc.stallRate >= 70 ? 'error' : arc.stallRate >= 50 ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">空转 {arc.stallRate}%</Tag>
                <Tag color={arc.missedPhaseCount > 0 ? 'error' : arc.hitPhaseCount > 0 ? 'processing' : 'default'} className="quality-dashboard-page__tag-reset">
                  阶段 {arc.hitPhaseCount}/{arc.phaseTargets.length}
                </Tag>
              </div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">尚未形成可分析的故事弧。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级推进摘要</div>
          <div className="quality-dashboard-page__metric-grid-240">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                {volume.arcEntries.length > 0 ? volume.arcEntries.slice(0, 4).map((arcEntry) => (
                  <div key={`${volume.volumeId}-${arcEntry.arcId}`} className="quality-dashboard-page__body-copy--strong">
                    {arcEntry.arcName}：推进 {arcEntry.progressRate}% · 空转 {arcEntry.stallRate}% · 阶段 {arcEntry.hitPhaseLabels.length}/{arcEntry.hitPhaseLabels.length + arcEntry.missedPhaseLabels.length}
                  </div>
                )) : <div className="quality-dashboard-page__body-copy">本卷还没有足够的故事弧覆盖数据。</div>}
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跟踪实体</div>
          <div className="quality-dashboard-page__medium-number">{summary.trackedEntityCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">统一总账已接管的人物与世界实体</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">状态跳变</div>
          <div className="quality-dashboard-page__medium-number">{summary.driftAlertCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">缺少事件承接的跨章节变化</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">状态冲突</div>
          <div className="quality-dashboard-page__medium-number">{summary.conflictAlertCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">不可用物品、敌对关系等矛盾状态</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">预警快照</div>
          <div className="quality-dashboard-page__medium-number">{summary.warningCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">账本中缺少原因或阻塞状态的记录数</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">世界状态概览</div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">人物 {summary.trackedByType.character} · 势力 {summary.trackedByType.faction} · 物品 {summary.trackedByType.item}</div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">关系 {summary.trackedByType.relation} · 地点 {summary.trackedByType.location}</div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">冲突实体 {summary.conflictEntityCount} · 严重告警 {summary.criticalCount}</div>
          {summary.recentConflictEntities.length > 0 ? (
            <div className="quality-dashboard-page__body-copy--tiny">近期命中：{summary.recentConflictEntities.join('、')}</div>
          ) : (
            <div className="quality-dashboard-page__body-copy--tiny">最近没有新的冲突实体。</div>
          )}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期阻塞实体</div>
          {alerts.length > 0 ? alerts.slice(0, 5).map((alert, index) => (
            <div key={`${alert.summary}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={worldStateSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
                <span className="quality-dashboard-page__row-label">{worldStateEntityLabel(alert.entityType)} · {alert.entityName}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.summary}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近窗口内没有新的状态告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跨章节趋势</div>
          <MiniTrendRow label="状态跳变" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.driftCount }))} />
          <MiniTrendRow label="状态冲突" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.conflictCount }))} />
          <MiniTrendRow label="预警快照" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.warningCount }))} />
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">冲突实体列表</div>
          {conflictEntities.length > 0 ? conflictEntities.slice(0, 5).map((entity, index) => (
            <div key={`${entity.entityType}-${entity.entityId}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={worldStateSeverityColor(entity.severity)} className="quality-dashboard-page__tag-reset">
                  {entity.conflictCount > 0 ? '冲突实体' : '跳变实体'}
                </Tag>
                <span className="quality-dashboard-page__row-label">{worldStateEntityLabel(entity.entityType)} · {entity.entityName}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{entity.reasons.join('；') || entity.summaryText}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">世界状态目前没有需要优先回查的冲突实体。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级状态摘要</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div className="quality-dashboard-page__body-copy--strong">跳变 {volume.driftAlertCount} · 冲突 {volume.conflictAlertCount} · 预警 {volume.warningCount}</div>
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
    return <div className="quality-dashboard-page__detail-empty">本章还没有章节验收门历史</div>
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
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
        <strong>章节验收门</strong>
        <Tag color={chapterGateLevelColor(latest.gateLevel)} className="quality-dashboard-page__tag-reset">{chapterGateLevelLabel(latest.gateLevel)}</Tag>
        <Tag color={chapterGateBandColor(chapterGateScoreBand(latest.scoreBreakdown.totalScore))} className="quality-dashboard-page__tag-reset">
          {chapterGateBandLabel(chapterGateScoreBand(latest.scoreBreakdown.totalScore))}
        </Tag>
        <span className="quality-dashboard-page__text-strong" style={{ color: chapterGateHeatmapColor(latest.scoreBreakdown.totalScore) }}>{`总分 ${latest.scoreBreakdown.totalScore}`}</span>
      </div>
      <div className="quality-dashboard-page__body-copy--strong">{latest.summary}</div>
      {drift ? (
        <div className="quality-dashboard-page__body-copy--strong" style={{ color: drift.status === 'worsening' ? '#ff7875' : drift.status === 'improving' ? '#95de64' : 'rgba(255,255,255,0.72)' }}>
          {drift.summary}
        </div>
      ) : null}
      {dimensions.map((dimension) => (
        <div key={dimension.label} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
            <span>{dimension.label}</span>
            <span className="quality-dashboard-page__value-accent" style={{ color: chapterGateHeatmapColor(dimension.value) }}>{dimension.value}</span>
          </div>
          <Progress percent={dimension.value} showInfo={false} strokeColor={chapterGateHeatmapColor(dimension.value)} size="small" />
        </div>
      ))}
      {chapterGate.history.length > 1 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-6">
          <div className="quality-dashboard-page__row-label">最近门变更</div>
          {chapterGate.history.slice(0, 3).map((entry) => (
            <div key={`${entry.id}-${entry.createdAt}`} className="quality-dashboard-page__body-copy">
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
    return <div className="quality-dashboard-page__detail-empty">本章还没有 AI 味分解数据</div>
  }

  const ranked = getTopLanguageDriftMetrics(metrics, LANGUAGE_DRIFT_LABELS.length)

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">AI 味分解</div>
      {ranked.map((item) => (
        <div key={item.key} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
            <span>{item.label}</span>
            <span className="quality-dashboard-page__value-accent" style={{ color: languageDriftRiskColor(item.value) }}>{item.value}</span>
          </div>
          <Progress percent={item.value} showInfo={false} strokeColor={languageDriftRiskColor(item.value)} size="small" />
        </div>
      ))}
    </div>
  )
}

function AntiAiRuleHitDetails({ hits }: { hits?: QualityDashboardData['chapterDetails'][number]['antiAiRuleHits'] }) {
  if (!hits || hits.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章暂无 AI 味检测记录</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">本章 AI 味命中</div>
      {hits.map((hit) => (
        <div key={`${hit.ruleCode}-${hit.excerpt}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
            <Tag color={hit.severity === 'high' ? 'error' : hit.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
              {hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}
            </Tag>
            <span className="quality-dashboard-page__row-label">{hit.ruleTitle}</span>
            <Tag color={hit.source === 'language_drift' ? 'blue' : 'purple'} className="quality-dashboard-page__tag-reset">
              {hit.source === 'language_drift' ? '漂移' : '护栏'}
            </Tag>
            {hit.promotedToHardConstraint ? <Tag color="gold" className="quality-dashboard-page__tag-reset">已升级硬约束</Tag> : null}
          </div>
          {hit.excerpt ? <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">{hit.excerpt}</div> : null}
        </div>
      ))}
    </div>
  )
}

function FeedbackRecurrenceDetails({ hits }: { hits?: QualityDashboardData['chapterDetails'][number]['feedbackRecurrenceHits'] }) {
  if (!hits || hits.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章没有通用复现问题</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">本章审校复现信号</div>
      {hits.map((hit) => (
        <div key={`${hit.issueType}-${hit.source}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
            <Tag color={hit.severity === 'high' ? 'error' : hit.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
              {hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}
            </Tag>
            <span className="quality-dashboard-page__row-label">{hit.title}</span>
            <Tag color={hit.source === 'chapter_gate' ? 'purple' : hit.source === 'contract_validation' ? 'blue' : hit.source === 'anti_ai' ? 'gold' : 'default'} className="quality-dashboard-page__tag-reset">
              {hit.source === 'chapter_gate' ? '章节门' : hit.source === 'contract_validation' ? '合同校验' : hit.source === 'anti_ai' ? 'AI 味' : '审校'}
            </Tag>
            {hit.promotedToHardConstraint ? <Tag color="gold" className="quality-dashboard-page__tag-reset">已升级硬约束</Tag> : null}
            {hit.pauseSuggested ? <Tag color="error" className="quality-dashboard-page__tag-reset">建议暂停</Tag> : null}
          </div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">{hit.detail}</div>
        </div>
      ))}
    </div>
  )
}

function StyleComplianceDetails({ styleCompliance }: { styleCompliance?: QualityDashboardData['chapterDetails'][number]['styleCompliance'] }) {
  if (!styleCompliance) {
    return <div className="quality-dashboard-page__detail-empty">本章未启用风格硬约束校验</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
        <div className="quality-dashboard-page__detail-title">风格硬约束</div>
        <Tag color={styleCompliance.status === 'rewrite' ? 'error' : styleCompliance.status === 'warning' ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">
          {styleCompliance.status === 'rewrite' ? '重写' : styleCompliance.status === 'warning' ? '预警' : '通过'}
        </Tag>
        <span className="quality-dashboard-page__row-label">{`得分 ${styleCompliance.score}`}</span>
      </div>
      <div className="quality-dashboard-page__body-copy--strong">{styleCompliance.summary}</div>
      <div className="quality-dashboard-page__body-copy--strong">
        指标：
        {` 句长 ${styleCompliance.actualMetrics.avgSentenceLength}/${styleCompliance.referenceMetrics.avgSentenceLength}`}
        {` · 段长 ${styleCompliance.actualMetrics.avgParagraphLength}/${styleCompliance.referenceMetrics.avgParagraphLength}`}
        {` · 对话占比 ${styleCompliance.actualMetrics.dialogueLineRate}%/${styleCompliance.referenceMetrics.dialogueLineRate}%`}
        {` · 抽象词 ${styleCompliance.actualMetrics.abstractTokenDensity}%/${styleCompliance.referenceMetrics.abstractTokenDensity}%`}
      </div>
      {styleCompliance.deviations.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">偏移：{styleCompliance.deviations.join('；')}</div>
      ) : null}
      {styleCompliance.matchedForbiddenPatterns.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">禁用表达：{styleCompliance.matchedForbiddenPatterns.join('、')}</div>
      ) : null}
      {styleCompliance.rewriteHints.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">修正：{styleCompliance.rewriteHints.join('；')}</div>
      ) : null}
    </div>
  )
}

function DialogueReviewDetails({ review }: { review?: QualityDashboardData['chapterDetails'][number]['dialogueReview'] }) {
  if (!review) {
    return <div className="quality-dashboard-page__detail-empty">本章对白样本不足，暂时无法评估辨识度</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">角色对白辨识度</div>
      {review.fingerprintSummary ? <div className="quality-dashboard-page__body-copy--strong">{review.fingerprintSummary}</div> : null}
      {review.voiceLockSummary ? <div className="quality-dashboard-page__body-copy--strong">声线锁定：{review.voiceLockSummary}</div> : null}
      {review.risks.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">风险：{review.risks.join('；')}</div>
      ) : (
        <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">当前章没有明确的对白同质化风险。</div>
      )}
      {review.fillerRisks.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">空转：{review.fillerRisks.join('；')}</div>
      ) : null}
      {review.infoDensityRisks.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">信息密度：{review.infoDensityRisks.join('；')}</div>
      ) : null}
      {review.requiredVoiceLockCharacterIds.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">需锁角色 ID：{review.requiredVoiceLockCharacterIds.join('、')}</div>
      ) : null}
      {review.similarities.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">
          高相似：{review.similarities.map((item) => `${item.characterAName}/${item.characterBName} ${item.similarity}`).join('、')}
        </div>
      ) : null}
      {review.drifts.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">
          漂移：{review.drifts.map((item) => `${item.characterName} ${item.driftRate}`).join('、')}
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsDetails({ dynamics }: { dynamics?: QualityDashboardData['chapterDetails'][number]['storyDynamics'] }) {
  if (!dynamics) return null

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">主角与节奏</div>
      <div className="quality-dashboard-page__body-copy--strong">主角受挫：{dynamics.protagonistSetback}{dynamics.setbackSummary ? ` · ${dynamics.setbackSummary}` : ''}</div>
      <div className="quality-dashboard-page__body-copy--strong">主角压力：<span className="quality-dashboard-page__value-accent" style={{ color: pressureColor(dynamics.protagonistPressure) }}>{dynamics.protagonistPressure}</span></div>
      <div className="quality-dashboard-page__body-copy--strong">代价：{dynamics.costPresent ? `${costResolutionStateLabel(dynamics.costResolutionState)}${dynamics.costSummary ? ` · ${dynamics.costSummary}` : ''}` : '无明确代价'}</div>
      <div className="quality-dashboard-page__body-copy--strong">反转：{dynamics.reversalMarker ? `${reversalSupportStateLabel(dynamics.reversalSupportState)}${dynamics.reversalSummary ? ` · ${dynamics.reversalSummary}` : ''}` : '无'}</div>
      <div className="quality-dashboard-page__body-copy--strong">节奏标签：{paceMarkerLabel(dynamics.paceMarker)} · 阶段回报：{rewardStateLabel(dynamics.rewardState)}</div>
    </div>
  )
}

function ChapterFunctionDetails({ chapterFunction }: { chapterFunction?: QualityDashboardData['chapterDetails'][number]['chapterFunction'] }) {
  if (!chapterFunction) {
    return <div className="quality-dashboard-page__detail-empty">本章还没有章节功能标注</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">章节功能</div>
      <div className="quality-dashboard-page__body-copy--strong">
        主功能：{chapterFunction.primaryTag ? chapterFunctionLabel(chapterFunction.primaryTag) : '未标注'}
      </div>
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--tight">
        {chapterFunction.tags.length > 0 ? chapterFunction.tags.map((tag) => (
          <Tag key={tag} color={chapterFunctionColor(tag)} className="quality-dashboard-page__tag-reset">
            {chapterFunctionLabel(tag)}
          </Tag>
        )) : <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">待标注</span>}
      </div>
      <div className="quality-dashboard-page__body-copy--strong">
        重复链：{chapterFunction.repeatedFunctionRunLength > 0
          ? `连续 ${chapterFunction.repeatedFunctionRunLength} 章`
          : '当前不在重复主功能链中'}
      </div>
      {chapterFunction.repeatedFunctionRange ? (
        <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">
          区段：第{chapterFunction.repeatedFunctionRange.startChapterNum}-{chapterFunction.repeatedFunctionRange.endChapterNum}章
        </div>
      ) : null}
      {chapterFunction.keyChapterRisk ? (
        <div className="quality-dashboard-page__body-copy--strong" style={{ color: '#faad14' }}>
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
    return <div className="quality-dashboard-page__detail-empty">本章还没有故事弧推进数据</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">故事弧推进</div>
      {progress.map((entry) => (
        <div key={`${entry.arcId}-${entry.chapterId}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
            <span className="quality-dashboard-page__row-label">{entry.arcName}</span>
            <Tag color={entry.progressHit ? 'success' : 'default'} className="quality-dashboard-page__tag-reset">{entry.progressHit ? '推进章' : '空转章'}</Tag>
            {entry.checkpointPhaseLabels.map((label) => <Tag key={`${entry.arcId}-${label}`} color={entry.progressHit ? 'processing' : 'warning'} className="quality-dashboard-page__tag-reset">{label}</Tag>)}
          </div>
          <div className="quality-dashboard-page__body-copy--strong">推进度：{entry.progressPercent}%{entry.arcProgressText ? ` · ${entry.arcProgressText}` : ''}</div>
          {entry.reviewRisks.length > 0 ? <div className="quality-dashboard-page__body-copy--strong">审校风险：{entry.reviewRisks.join('；')}</div> : null}
          {entry.alertDetails.length > 0 ? <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">告警：{entry.alertDetails.join('；')}</div> : null}
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
    return <div className="quality-dashboard-page__detail-empty">本章还没有召回可靠性数据</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
        <div className="quality-dashboard-page__detail-title">召回可靠性</div>
        {recallSnapshotSource ? (
          <Tag color={recallSnapshotSourceColor(recallSnapshotSource)} className="quality-dashboard-page__tag-reset">
            {recallSnapshotSourceLabel(recallSnapshotSource)}
          </Tag>
        ) : null}
      </div>
      {snapshot ? (
        <div className="quality-dashboard-page__body-copy--strong">
          运行结果：{snapshot.retrievalUsed ? '实际使用召回' : '未实际使用召回'}
          {snapshot.degraded ? ` · 已降级${snapshot.fallbackReason ? `：${recallFallbackReasonLabel(snapshot.fallbackReason)}` : ''}` : ' · 未降级'}
          {' '}· 总命中：{snapshot.hitCount}
        </div>
      ) : null}
      {diagnostics ? (
        <div className="quality-dashboard-page__body-copy--strong">召回依赖率：{diagnostics.recallDependencyRate}% · 过期召回率：{diagnostics.staleRecallRate}%</div>
      ) : null}
      {diagnostics ? (
        <div className="quality-dashboard-page__body-copy--strong">可用片段：{diagnostics.selectedHitCount} · 过期片段：{diagnostics.staleRecallCount} · 兜底命中：{diagnostics.fallbackHitCount}</div>
      ) : null}
      {diagnostics && diagnostics.summaryLines.length > 0 ? (
        <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">{diagnostics.summaryLines.join(' ')}</div>
      ) : null}
    </div>
  )
}

function WorldStateAlertDetails({ alerts }: { alerts?: QualityDashboardData['chapterDetails'][number]['worldStateAlerts'] }) {
  if (!alerts || alerts.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章没有状态稳定性告警</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">状态稳定性</div>
      {alerts.map((alert, index) => (
        <div key={`${alert.summary}-${index}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
            <Tag color={worldStateSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
            <span className="quality-dashboard-page__row-label">{worldStateEntityLabel(alert.entityType)} · {alert.entityName}</span>
          </div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{alert.summary}</div>
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
        <Tag color="cyan">{`推荐 ${observability.recommendedChapterWords || 0} 字/章`}</Tag>
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
