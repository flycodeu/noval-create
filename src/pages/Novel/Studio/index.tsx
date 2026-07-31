import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Spin, Tag, message } from 'antd'
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { useLocation, useNavigate } from 'react-router-dom'
import type {
  NovelConsistencyReport,
  NovelContextStatus,
  OperationLog,
  QualityDashboardData,
  RevisionCenterSnapshot,
} from '../../../types'
import MetricCard from '../../../components/novel/cards/MetricCard'
import BlockerCard from '../../../components/novel/cards/BlockerCard'
import SectionHeader from '../../../components/novel/common/SectionHeader'
import ActionBar from '../../../components/novel/common/ActionBar'
import NextStepPanel from '../../../components/novel/workflow/NextStepPanel'
import ReadinessMeter from '../../../components/novel/workflow/ReadinessMeter'
import StatusTag from '../../../components/novel/common/StatusTag'
import { useNovelStore } from '../../../stores/novel.store'
import {
  buildWorkspaceRoute,
  getWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from '../../../shared/novel-workspace'
import type { ProjectBlocker } from '../../../shared/workspace-types'
import { EMPTY_WORKFLOW_STATS, loadWorkflowStats, type WorkflowStats } from '../workflow'
import { getErrorMessage } from '@/utils/user-facing-message'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface Props {
  novelId: number
}

type QualitySummary = Pick<QualityDashboardData, 'productionReadiness' | 'batchHealth' | 'continuityHealth'> | null

interface CurrentTaskCard {
  title: string
  reason: string
  affectedModules: string[]
  actionLabel: string
  targetRoute: string
  impactedRoute?: string
  canIgnoreOnce: boolean
  blocker?: ProjectBlocker
}

function stageDescription(groupKey: WorkspaceSnapshot['groups'][number]['key']) {
  if (groupKey === 'foundation') return '立项、故事底盘和文风基线'
  if (groupKey === 'world-building') return '世界规则、地点场景、物品线索和术语'
  if (groupKey === 'cast-factions') return '人物档案、人物弧、阻力和阵营组织'
  if (groupKey === 'plot-architecture') return '主线、支线、终局、信息差和伏笔'
  if (groupKey === 'volume-outline') return '卷级设计、大纲、卷章结构和时间轴'
  if (groupKey === 'chapter-production') return '合同、正文和章后回写'
  if (groupKey === 'quality-control') return '修订闭环与持续质量监控'
  return '项目状态'
}

function activityTone(log: OperationLog) {
  if (log.operationType.includes('delete')) return 'danger'
  if (log.operationType.includes('update') || log.operationType.includes('reindex')) return 'warm'
  return 'default'
}

export default function StudioPage({ novelId }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [qualitySummary, setQualitySummary] = useState<QualitySummary>(null)
  const [revisionSnapshot, setRevisionSnapshot] = useState<RevisionCenterSnapshot | null>(null)
  const [recentActivities, setRecentActivities] = useState<OperationLog[]>([])
  const [ignoredBlockerIds, setIgnoredBlockerIds] = useState<string[]>([])
  const [referenceExpanded, setReferenceExpanded] = useState(false)
  const loadRequestRef = React.useRef(0)

  const loadConsoleData = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    const [novel, workflowStats, report, nextContextStatus, qualityDashboard, revisions, activities] = await Promise.all([
      window.electron.novel.get(novelId),
      loadWorkflowStats(novelId),
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getContextStatus(novelId),
      window.electron.quality.getDashboard(novelId).catch(() => null),
      window.electron.revision.getSnapshot(novelId).catch(() => null),
      window.electron.history.listRecent(novelId, 8).catch(() => []),
    ])
    if (loadRequestRef.current !== requestId) return

    if (novel) {
      setCurrentNovel(novel)
    }

    setStats(workflowStats)
    setConsistencyReport(report)
    setContextStatus(nextContextStatus)
    setRevisionSnapshot(revisions)
    setRecentActivities(activities)
    setQualitySummary(qualityDashboard ? {
      productionReadiness: qualityDashboard.productionReadiness,
      batchHealth: qualityDashboard.batchHealth,
      continuityHealth: qualityDashboard.continuityHealth,
    } : null)
  }, [novelId, setCurrentNovel])

  const refreshConsole = useCallback(async () => {
    const requestId = loadRequestRef.current + 1
    setRefreshing(true)
    try {
      await loadConsoleData()
    } catch (error) {
      if (loadRequestRef.current === requestId) {
        console.error(error)
        message.error(getErrorMessage(error, 'common.loadFailed'))
      }
    } finally {
      if (loadRequestRef.current === requestId) setRefreshing(false)
    }
  }, [loadConsoleData])

  useEffect(() => {
    let active = true
    setLoading(true)
    setRefreshing(false)

    void (async () => {
      try {
        await loadConsoleData()
      } catch (error) {
        if (active) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.loadFailed'))
        }
      } finally {
        if (active) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [loadConsoleData])

  const workspaceSnapshot = useMemo(
    () => getWorkspaceSnapshot(currentNovel, stats, {
      viewMode: currentNovel?.launchMode === 'fast_launch' ? 'quick' : 'professional',
      qualitySummary: qualitySummary || undefined,
    }),
    [currentNovel, qualitySummary, stats],
  )

  const visibleBlockers = useMemo(
    () => workspaceSnapshot.blockers.filter((item) => !ignoredBlockerIds.includes(item.id)),
    [ignoredBlockerIds, workspaceSnapshot.blockers],
  )

  const currentBlocker = visibleBlockers[0] || null
  const queryPanel = useMemo(
    () => new URLSearchParams(location.search).get('panel'),
    [location.search],
  )

  const moduleLabelRouteMap = useMemo(() => {
    const pairs = workspaceSnapshot.modules.flatMap((item) => [
      [item.label, item.route] as const,
      [item.key, item.route] as const,
    ])
    return new Map<string, string>(pairs)
  }, [workspaceSnapshot.modules])

  const currentTask = useMemo<CurrentTaskCard>(() => {
    if (!currentBlocker) {
      return {
        title: workspaceSnapshot.nextStep.title,
        reason: workspaceSnapshot.nextStep.reason,
        affectedModules: [workspaceSnapshot.stage.label],
        actionLabel: workspaceSnapshot.nextStep.actionLabel,
        targetRoute: workspaceSnapshot.nextStep.targetPage,
        canIgnoreOnce: false,
      }
    }

    const impactedRoute = currentBlocker.affectedModules
      .map((item) => moduleLabelRouteMap.get(item))
      .find(Boolean)
    return {
      title: currentBlocker.title,
      reason: currentBlocker.reason,
      affectedModules: currentBlocker.affectedModules,
      actionLabel: currentBlocker.suggestedAction.label,
      targetRoute: currentBlocker.suggestedAction.targetPage,
      impactedRoute: impactedRoute || currentBlocker.suggestedAction.targetPage,
      canIgnoreOnce: currentBlocker.canIgnoreOnce,
      blocker: currentBlocker,
    }
  }, [currentBlocker, moduleLabelRouteMap, workspaceSnapshot.nextStep, workspaceSnapshot.stage.label])

  const stageGroups = useMemo(
    () => workspaceSnapshot.groups.filter((group) => group.key !== 'project-status'),
    [workspaceSnapshot.groups],
  )

  const riskItems = useMemo(() => {
    const items = [
      ...(qualitySummary?.productionReadiness.blockers || []).map((item) => `生产阻塞：${item}`),
      ...(qualitySummary?.productionReadiness.warnings || []).map((item) => `生产预警：${item}`),
      ...(consistencyReport?.focusAreas || []).map((item) => `结构关注：${item}`),
      contextStatus?.staleChapterCount
        ? `上下文待同步：${contextStatus.staleChapterCount} 章仍引用旧上下文。`
        : '',
      contextStatus?.staleCheckpointCount
        ? `长期记忆检查点：${contextStatus.staleCheckpointCount} 份待刷新。`
        : '',
    ].filter(Boolean)

    return items.slice(0, 6)
  }, [consistencyReport?.focusAreas, contextStatus?.staleChapterCount, contextStatus?.staleCheckpointCount, qualitySummary?.productionReadiness.blockers, qualitySummary?.productionReadiness.warnings])

  const topRevisionTasks = useMemo(
    () => (revisionSnapshot?.tasks || [])
      .filter((task) => task.status !== 'resolved' && task.status !== 'ignored')
      .slice(0, 5),
    [revisionSnapshot?.tasks],
  )

  const keyEntrances = useMemo(() => ([
    { key: 'contracts', label: '章节合同', route: 'contracts', hint: '先把章节约束压稳' },
    { key: 'writing', label: '正文写作', route: 'writing/editor', hint: '进入章节生产台' },
    { key: 'writeback', label: '章后回写', route: 'writeback', hint: '同步人物、伏笔与时间轴' },
    { key: 'revision', label: '修订中心', route: 'revision', hint: '处理系统反推任务' },
    { key: 'quality', label: '质量监控', route: 'quality', hint: '检查生产健康和趋势' },
  ]), [])

  if (loading && !currentNovel) {
    return (
      <div className="novel-dashboard__loading novel-route-shell__loading-card">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="novel-dashboard">
      {refreshing ? (
        <div className="novel-dashboard__refresh-indicator">
          <Spin size="small" />
          <span>正在同步当前工作台数据</span>
        </div>
      ) : null}
      <div className="novel-dashboard__hero">
        <section className="novel-dashboard__task-card">
          <SectionHeader
            eyebrow="当前任务"
            title={currentBlocker ? '当前最该处理：先清阻塞项' : `当前最该处理：${currentTask.title}`}
            description={currentTask.reason}
            extra={currentBlocker ? <Tag color="volcano">阻塞中</Tag> : <Tag color="gold">可推进</Tag>}
          />
          <div className="novel-dashboard__task-meta">
            <div className="novel-dashboard__task-row">
              <span>原因</span>
              <strong>{currentTask.reason}</strong>
            </div>
            <div className="novel-dashboard__task-row">
              <span>影响范围</span>
              <strong>{currentTask.affectedModules.join('、')}</strong>
            </div>
            <div className="novel-dashboard__task-row">
              <span>当前阶段</span>
              <strong>{workspaceSnapshot.stage.label}</strong>
            </div>
          </div>
          <ActionBar align="start">
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => navigate(buildWorkspaceRoute(novelId, currentTask.targetRoute))}
            >
              {currentTask.actionLabel}
            </Button>
            <Button onClick={() => void refreshConsole()}>
              刷新面板
            </Button>
            <Button
              icon={<FileSearchOutlined />}
              onClick={() => navigate(buildWorkspaceRoute(novelId, currentTask.impactedRoute || currentTask.targetRoute))}
            >
              查看影响
            </Button>
            {currentTask.canIgnoreOnce && currentTask.blocker ? (
              <Button onClick={() => {
                if (!currentTask.blocker) return
                setIgnoredBlockerIds((current) => [...current, currentTask.blocker!.id])
              }}>
                暂时忽略
              </Button>
            ) : null}
          </ActionBar>
        </section>

        <ReadinessMeter readiness={workspaceSnapshot.readiness} />
      </div>

      <div className="novel-dashboard__metrics">
        <MetricCard
          label="当前阶段"
          value={workspaceSnapshot.stage.label}
          tone="warm"
        />
        <MetricCard
          label="模块完成度"
          value={`${workspaceSnapshot.moduleDoneCount}/${workspaceSnapshot.moduleTotalCount}`}
        />
        <MetricCard
          label="高优先风险"
          value={visibleBlockers.length}
          tone={visibleBlockers.length > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="上下文版本"
          value={contextStatus ? `v${contextStatus.contextVersion}` : '未建立'}
        />
        <MetricCard
          label="待回写"
          value={qualitySummary?.productionReadiness.writebackPendingCount || 0}
          tone={(qualitySummary?.productionReadiness.writebackPendingCount || 0) > 0 ? 'warm' : 'default'}
        />
      </div>

      <section className="novel-dashboard__panel">
        <SectionHeader
          eyebrow="阶段进度"
          title="项目阶段面板"
          description="进入项目后先看当前推进到哪个阶段，再决定补底盘还是进入章节生产。"
        />
        <div className="novel-dashboard__stage-grid">
          {stageGroups.map((group) => (
            <button
              key={group.key}
              type="button"
              className={`novel-dashboard__stage-card ${workspaceSnapshot.stage.key === group.key ? 'is-active' : ''}`}
              onClick={() => navigate(buildWorkspaceRoute(novelId, group.route))}
            >
              <div className="novel-dashboard__stage-card-head">
                <strong>{group.title}</strong>
                <StatusTag status={group.status} size="small" />
              </div>
              <div className="novel-dashboard__stage-card-value">{`${group.completedCount}/${group.totalCount}`}</div>
              <div className="novel-dashboard__stage-card-copy">
                <span>{stageDescription(group.key)}</span>
                <span>{group.blockerCount > 0 ? `${group.blockerCount} 个 blocker` : '当前无 blocker'}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="novel-dashboard__main-grid">
        <div className="novel-dashboard__main-stack">
          <section className={`novel-dashboard__panel ${queryPanel === 'blockers' ? 'is-focused' : ''}`}>
            <SectionHeader
              eyebrow="当前阻塞"
              title="阻塞项列表"
              description="每个阻塞项都给出原因、影响范围和处理入口。"
              extra={visibleBlockers.length > 0 ? <Tag color="volcano">{`${visibleBlockers.length} 个`}</Tag> : null}
            />
            {visibleBlockers.length > 0 ? (
              <div className="novel-dashboard__blocker-list">
                {visibleBlockers.map((blocker) => (
                  <BlockerCard
                    key={blocker.id}
                    blocker={blocker}
                    onOpen={(item) => navigate(buildWorkspaceRoute(novelId, item.suggestedAction.targetPage))}
                    onIgnore={blocker.canIgnoreOnce
                      ? (item) => setIgnoredBlockerIds((current) => [...current, item.id])
                      : undefined}
                  />
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前没有阻塞项，可以直接按推荐下一步推进。"
              />
            )}
          </section>

          <section className="novel-dashboard__panel">
            <SectionHeader
              eyebrow="参考层"
              title="活动、风险与修订反推"
              description="这里保留诊断信息和修订回流，默认折叠，避免首次进入时被次要信息打断。"
              extra={(
                <Button
                  size="small"
                  type={referenceExpanded ? 'default' : 'primary'}
                  icon={referenceExpanded ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => setReferenceExpanded((current) => !current)}
                >
                  {referenceExpanded ? '收起参考层' : '展开参考层'}
                </Button>
              )}
            />
            {!referenceExpanded ? (
              <div className="novel-dashboard__reference-preview">
                <span>{`最近活动 ${recentActivities.length} 条`}</span>
                <span>{`高优先风险 ${riskItems.length} 条`}</span>
                <span>{`修订反推 ${topRevisionTasks.length} 条`}</span>
              </div>
            ) : (
              <div className="novel-dashboard__reference-stack">
                <section className="novel-dashboard__reference-section">
                  <SectionHeader
                    eyebrow="最近活动"
                    title="项目活动流"
                    description="最近的修改、生成、修订和回滚都会汇总在这里。"
                  />
                  {recentActivities.length > 0 ? (
                    <div className="novel-dashboard__activity-list">
                      {recentActivities.map((activity) => (
                        <article
                          key={activity.id}
                          className={`novel-dashboard__activity-card tone-${activityTone(activity)}`}
                        >
                          <div className="novel-dashboard__activity-head">
                            <strong>{activity.summary}</strong>
                            <span>{dayjs(activity.createdAt).fromNow()}</span>
                          </div>
                          <div className="novel-dashboard__activity-meta">
                            <span>{activity.entityType}</span>
                            <span>{activity.operationType}</span>
                            <span>{new Date(activity.createdAt).toLocaleString()}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="novel-dashboard__empty-copy">当前还没有最近活动记录。</div>
                  )}
                </section>

                <section className="novel-dashboard__reference-section">
                  <SectionHeader
                    eyebrow="风险提示"
                    title="当前风险"
                    description="这里汇总结构体检、上下文同步和质量监控给出的高价值信号。"
                  />
                  {riskItems.length > 0 ? (
                    <div className="novel-dashboard__risk-list">
                      {riskItems.map((item) => (
                        <div key={item} className="novel-dashboard__risk-item">
                          <ExclamationCircleOutlined />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Alert
                      type="success"
                      showIcon
                      message="当前没有新的高优先风险"
                      description="可以直接按推荐下一步推进章节生产或修订。"
                    />
                  )}
                </section>

                <section className="novel-dashboard__reference-section">
                  <SectionHeader
                    eyebrow="修订反推"
                    title="质量问题回推任务"
                    description="修订中心里最该先处理的问题会直接出现在这里。"
                  />
                  {topRevisionTasks.length > 0 ? (
                    <div className="novel-dashboard__revision-list">
                      {topRevisionTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          className="novel-dashboard__revision-card"
                          onClick={() => navigate(buildWorkspaceRoute(novelId, task.relatedPage || 'revision'))}
                        >
                          <div className="novel-dashboard__revision-head">
                            <strong>{task.title}</strong>
                            <Tag color={task.severity === 'high' ? 'volcano' : task.severity === 'medium' ? 'gold' : 'default'}>
                              {task.severity === 'high' ? '高优先' : task.severity === 'medium' ? '中优先' : '低优先'}
                            </Tag>
                          </div>
                          <span>{task.description || task.fixBrief || '跳回对应页面处理。'}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="novel-dashboard__empty-copy">当前没有新的修订反推任务。</div>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>

        <div className="novel-dashboard__side-stack">
          <section className={`novel-dashboard__panel ${queryPanel === 'next-step' ? 'is-focused' : ''}`}>
            <NextStepPanel
              nextStep={workspaceSnapshot.nextStep}
              onOpen={() => navigate(buildWorkspaceRoute(novelId, workspaceSnapshot.nextStep.targetPage))}
            />
          </section>

          <section className="novel-dashboard__panel">
            <SectionHeader
              eyebrow="关键入口"
              title="常用控制入口"
              description="这里保留最常用的生产链路入口，不再把大量主操作堆到顶部。"
            />
            <div className="novel-dashboard__entry-grid">
              {keyEntrances.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="novel-dashboard__entry-card"
                  onClick={() => navigate(buildWorkspaceRoute(novelId, item.route))}
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                  <ArrowRightOutlined />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="novel-dashboard__panel">
        <SectionHeader
          eyebrow="控制台状态"
          title="写作准备与生产健康"
          description="从写作条件、连续性和批量生产健康三个维度看当前项目是否适合继续推进。"
        />
        <div className="novel-dashboard__health-grid">
          <div className="novel-dashboard__health-card">
            <div className="novel-dashboard__health-head">
              <ClockCircleOutlined />
              <strong>写作准备</strong>
            </div>
            <span>{qualitySummary?.productionReadiness.summary || '当前没有质量看板摘要。'}</span>
          </div>
          <div className="novel-dashboard__health-card">
            <div className="novel-dashboard__health-head">
              <HistoryOutlined />
              <strong>连续性</strong>
            </div>
            <span>
              {contextStatus
                ? `待同步章节 ${contextStatus.staleChapterCount}，待刷新检查点 ${contextStatus.staleCheckpointCount}。`
                : '当前没有连续性状态数据。'}
            </span>
          </div>
          <div className="novel-dashboard__health-card">
            <div className="novel-dashboard__health-head">
              <ThunderboltOutlined />
              <strong>结构体检</strong>
            </div>
            <span>
              {consistencyReport
                ? `总分 ${consistencyReport.readinessScore}，高危 ${consistencyReport.highCount}，中危 ${consistencyReport.mediumCount}。`
                : '当前没有结构体检结果。'}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
