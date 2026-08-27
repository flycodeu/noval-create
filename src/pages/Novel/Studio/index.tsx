import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Spin, Tag, message } from 'antd'
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
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
import BlockerCard from '../../../components/novel/cards/BlockerCard'
import SectionHeader from '../../../components/novel/common/SectionHeader'
import { useNovelStore } from '../../../stores/novel.store'
import {
  buildWorkspaceRoute,
  getWorkspaceSnapshot,
} from '../../../shared/novel-workspace'
import type { ProjectBlocker } from '../../../shared/workspace-types'
import {
  WorkspaceContextSummary,
  WorkspacePage,
} from '../components/WorkspaceShell'
import { EMPTY_WORKFLOW_STATS, loadWorkflowStats, type WorkflowStats } from '../workflow'
import { getErrorMessage } from '@/utils/user-facing-message'
import './index.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface Props {
  novelId: number
}

type QualitySummary = Pick<QualityDashboardData, 'productionReadiness' | 'batchHealth' | 'continuityHealth'> | null

interface KeyEntrance {
  key: string
  label: string
  route: string
  hint: string
}

function activityTone(log: OperationLog) {
  if (log.operationType.includes('delete')) return 'danger'
  if (log.operationType.includes('update') || log.operationType.includes('reindex')) return 'warm'
  return 'default'
}

function nextStepPriorityPresentation(priority: string): { color: 'volcano' | 'gold' | 'default'; label: string } {
  if (priority === 'high') return { color: 'volcano', label: '高优先' }
  return priority === 'medium'
    ? { color: 'gold', label: '中优先' }
    : { color: 'default', label: '低优先' }
}

export default function StudioPage({ novelId }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [qualitySummary, setQualitySummary] = useState<QualitySummary>(null)
  const [revisionSnapshot, setRevisionSnapshot] = useState<RevisionCenterSnapshot | null>(null)
  const [recentActivities, setRecentActivities] = useState<OperationLog[]>([])
  const [ignoredBlockerIds, setIgnoredBlockerIds] = useState<string[]>([])
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
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

    if (novel) setCurrentNovel(novel)
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
    setRefreshing(true)
    try {
      await loadConsoleData()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [loadConsoleData])

  useEffect(() => {
    let active = true
    setLoading(true)

    void (async () => {
      try {
        await loadConsoleData()
      } catch (error) {
        if (active) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.loadFailed'))
        }
      } finally {
        if (active) setLoading(false)
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

  const queryPanel = useMemo(
    () => new URLSearchParams(location.search).get('panel'),
    [location.search],
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

  const keyEntrances = useMemo<KeyEntrance[]>(() => ([
    { key: 'contracts', label: '章节合同', route: 'contracts', hint: '先把章节约束压稳' },
    { key: 'writing', label: '正文写作', route: 'writing/editor', hint: '进入章节生产台' },
    { key: 'writeback', label: '章后回写', route: 'writeback', hint: '同步人物、伏笔与时间轴' },
    { key: 'revision', label: '修订中心', route: 'revision', hint: '处理系统反推任务' },
    { key: 'quality', label: '质量监控', route: 'quality', hint: '检查生产健康和趋势' },
  ]), [])

  const nextStepPriority = nextStepPriorityPresentation(workspaceSnapshot.nextStep.priority)

  const openRecommendedStep = useCallback(() => {
    navigate(buildWorkspaceRoute(novelId, workspaceSnapshot.nextStep.targetPage))
  }, [navigate, novelId, workspaceSnapshot.nextStep.targetPage])

  if (loading && !currentNovel) {
    return (
      <div className="studio-page__loading novel-route-shell__loading-card">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <WorkspacePage
      className="studio-page"
      layout="wide"
      chrome="shared"
      eyebrow="创作控制台"
      title="现在做什么"
      description="只处理推荐下一步与当前阻塞；项目资料请在项目资料页维护。"
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前阶段', value: workspaceSnapshot.stage.label },
            { label: '模块完成', value: `${workspaceSnapshot.moduleDoneCount}/${workspaceSnapshot.moduleTotalCount}` },
            { label: '当前阻塞', value: visibleBlockers.length > 0 ? `${visibleBlockers.length} 项` : '无' },
          ]}
        />
      )}
      actionContract={{
        primary: {
          key: 'recommended-next-step',
          label: workspaceSnapshot.nextStep.actionLabel,
          icon: <ThunderboltOutlined />,
          onClick: openRecommendedStep,
        },
        secondary: [
          {
            key: 'refresh',
            label: '刷新状态',
            icon: <ReloadOutlined />,
            loading: refreshing,
            onClick: () => void refreshConsole(),
          },
          {
            key: 'overview',
            label: '项目资料',
            icon: <FileSearchOutlined />,
            onClick: () => navigate(buildWorkspaceRoute(novelId, 'overview')),
          },
        ],
        more: {
          items: [
            {
              key: 'focus-blockers',
              label: '定位当前阻塞',
              onClick: () => navigate(buildWorkspaceRoute(novelId, 'guide?panel=blockers')),
            },
            {
              key: 'focus-diagnostics',
              label: '展开诊断层',
              onClick: () => setDiagnosticsExpanded(true),
            },
          ],
        },
      }}
    >
      <div data-studio-responsibility="next-step-blockers" className="studio-page__body">
        {refreshing ? (
          <div className="studio-page__syncing" role="status">
            <ReloadOutlined spin />
            <span>正在同步控制台状态</span>
          </div>
        ) : null}

        <section
          className={`studio-page__next-step${queryPanel === 'next-step' ? ' is-focused' : ''}`}
          data-studio-next-step
          data-target-route={workspaceSnapshot.nextStep.targetPage}
        >
          <div className="studio-page__section-heading">
            <div>
              <span className="studio-page__eyebrow">推荐下一步</span>
              <h2>{workspaceSnapshot.nextStep.title}</h2>
              <p>{workspaceSnapshot.nextStep.reason}</p>
            </div>
            <Tag color={nextStepPriority.color}>
              {nextStepPriority.label}
            </Tag>
          </div>
          <div className="studio-page__next-step-footer">
            <span>{workspaceSnapshot.nextStep.estimatedMinutes ? `预计 ${workspaceSnapshot.nextStep.estimatedMinutes} 分钟` : '预计耗时未记录'}</span>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={openRecommendedStep}>
              {workspaceSnapshot.nextStep.actionLabel}
            </Button>
          </div>
        </section>

        <section
          className={`studio-page__blockers${queryPanel === 'blockers' ? ' is-focused' : ''}`}
          data-studio-blockers
        >
          <SectionHeader
            eyebrow="需要先处理"
            title="当前阻塞"
            description="阻塞项单独列出；处理完后再回到推荐下一步。"
            extra={visibleBlockers.length > 0 ? <Tag color="volcano">{`${visibleBlockers.length} 项`}</Tag> : null}
          />
          {visibleBlockers.length > 0 ? (
            <div className="studio-page__blocker-list">
              {visibleBlockers.map((blocker: ProjectBlocker) => (
                <div key={blocker.id} data-studio-blocker>
                  <BlockerCard
                    blocker={blocker}
                    onOpen={(item) => navigate(buildWorkspaceRoute(novelId, item.suggestedAction.targetPage))}
                    onIgnore={blocker.canIgnoreOnce
                      ? (item) => setIgnoredBlockerIds((current) => [...current, item.id])
                      : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Alert
              type="success"
              showIcon
              message="当前没有阻塞"
              description="可以直接执行上面的推荐下一步。"
            />
          )}
        </section>

        <section className="studio-page__entrances">
          <SectionHeader
            eyebrow="直接进入"
            title="生产链路入口"
            description="常用入口保持在这里，不与推荐下一步争夺注意力。"
          />
          <div className="studio-page__entrance-list">
            {keyEntrances.map((item) => (
              <button
                key={item.key}
                type="button"
                className="studio-page__entrance"
                onClick={() => navigate(buildWorkspaceRoute(novelId, item.route))}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <ArrowRightOutlined />
              </button>
            ))}
          </div>
        </section>

        <details
          className="studio-page__diagnostics"
          data-studio-diagnostics
          open={diagnosticsExpanded}
          onToggle={(event) => setDiagnosticsExpanded(event.currentTarget.open)}
        >
          <summary>
            <span>
              <span className="studio-page__eyebrow">按需展开</span>
              <strong>诊断与活动</strong>
            </span>
            <span className="studio-page__diagnostics-summary">
              {`活动 ${recentActivities.length} · 风险 ${riskItems.length} · 修订 ${topRevisionTasks.length}`}
            </span>
          </summary>
          <div className="studio-page__diagnostics-grid">
            <section className="studio-page__diagnostic-section">
              <SectionHeader title="最近活动" description="修改、生成、修订和回滚记录。" />
              {recentActivities.length > 0 ? (
                <div className="studio-page__activity-list">
                  {recentActivities.map((activity) => (
                    <article key={activity.id} className={`studio-page__activity tone-${activityTone(activity)}`}>
                      <div>
                        <strong>{activity.summary}</strong>
                        <span>{activity.entityType} · {activity.operationType}</span>
                      </div>
                      <time dateTime={activity.createdAt}>{dayjs(activity.createdAt).fromNow()}</time>
                    </article>
                  ))}
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有活动记录。" />}
            </section>

            <section className="studio-page__diagnostic-section">
              <SectionHeader title="风险信号" description="结构体检、上下文和生产健康的高价值信号。" />
              {riskItems.length > 0 ? (
                <div className="studio-page__risk-list">
                  {riskItems.map((item) => (
                    <div key={item} className="studio-page__risk-item">
                      <ExclamationCircleOutlined />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ) : <Alert type="success" showIcon message="当前没有新的风险信号" />}
            </section>

            <section className="studio-page__diagnostic-section">
              <SectionHeader title="修订反推" description="从质量问题回到对应页面处理。" />
              {topRevisionTasks.length > 0 ? (
                <div className="studio-page__revision-list">
                  {topRevisionTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className="studio-page__revision"
                      onClick={() => navigate(buildWorkspaceRoute(novelId, task.relatedPage || 'revision'))}
                    >
                      <span>
                        <strong>{task.title}</strong>
                        <small>{task.description || task.fixBrief || '跳回对应页面处理。'}</small>
                      </span>
                      <Tag color={task.severity === 'high' ? 'volcano' : task.severity === 'medium' ? 'gold' : 'default'}>
                        {task.severity === 'high' ? '高优先' : task.severity === 'medium' ? '中优先' : '低优先'}
                      </Tag>
                    </button>
                  ))}
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有新的修订任务。" />}
            </section>

            <section className="studio-page__diagnostic-section">
              <SectionHeader title="生产健康" description="仅在需要诊断时查看，不占用首屏。" />
              <div className="studio-page__health-list">
                <div>
                  <ClockCircleOutlined />
                  <span><strong>写作准备</strong>{qualitySummary?.productionReadiness.summary || '当前没有生产健康摘要。'}</span>
                </div>
                <div>
                  <HistoryOutlined />
                  <span><strong>连续性</strong>{contextStatus ? `待同步章节 ${contextStatus.staleChapterCount}，待刷新检查点 ${contextStatus.staleCheckpointCount}。` : '当前没有连续性状态。'}</span>
                </div>
                <div>
                  <ThunderboltOutlined />
                  <span><strong>结构体检</strong>{consistencyReport ? `总分 ${consistencyReport.readinessScore}，高危 ${consistencyReport.highCount}，中危 ${consistencyReport.mediumCount}。` : '当前没有结构体检结果。'}</span>
                </div>
              </div>
            </section>
          </div>
        </details>
      </div>
    </WorkspacePage>
  )
}
