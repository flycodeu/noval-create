import { formatUserFacingMessage } from '../../../shared/user-facing-messages'
import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import { useScopedState } from '@/hooks/useScopedState'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Empty, Spin, Tag, message } from 'antd'
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { AgentArtifact } from '../../../shared/agent-artifacts'
import type { GenericAssetDraftContent } from '../../../shared/generic-asset-workflow'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { useLocation, useNavigate } from 'react-router-dom'
import type {
  OperationLog,
} from '../../../types'
import BlockerCard from '../../../components/novel/cards/BlockerCard'
import SectionHeader from '../../../components/novel/common/SectionHeader'
import { useNovelStore } from '../../../stores/novel.store'
import {
  buildWorkspaceRoute,
  getWorkspaceSnapshot,
} from '../../../shared/novel-workspace'
import { getWorkspaceViewModeForNovel } from '../../../shared/operating-mode'
import type { ProjectBlocker } from '../../../shared/workspace-types'
import {
  WorkspacePage,
} from '../components/WorkspaceShell'
import { EMPTY_WORKFLOW_STATS, loadWorkflowStats } from '../workflow'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { getStudioNextStep, getRecentStudioChapter, getStudioSceneLabel } from './studio-next-step'
import { isExternalImportedDraft } from './imported-drafts'
import './index.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface Props {
  novelId: number
}

type ImportedDraftRef = Pick<AgentArtifact, 'id' | 'kind' | 'status' | 'createdAt' | 'producerClient' | 'producerType' | 'contextVersion'>
type ImportedDraft = ImportedDraftRef & { content: GenericAssetDraftContent; novelId: number }

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
  return <StudioWorkspace key={novelId} novelId={novelId} />
}

function StudioWorkspace({ novelId }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const [ignoredBlockerIds, setIgnoredBlockerIds] = useState<string[]>([])
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [importDrawerOpen, setImportDrawerOpen] = useState(false)
  const [requestedImportedId, setRequestedImportedId] = useScopedState<string | null>(novelId, null)
  const readImportedDrafts = useCallback(async () => {
    const result = await window.electron.agentTools.call({
      toolId: 'novelforge.artifacts.list', input: { novelId, kind: 'generic_draft', limit: 50 },
    })
    if (!result.ok) throw new Error(result.error.message)
    return (result.data as { artifacts: ImportedDraftRef[] }).artifacts
      .filter(isExternalImportedDraft).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [novelId])
  const { data: importedRows, loading: importListLoading, error: importListError, reload: loadImportedDrafts } = useAsyncSnapshot(readImportedDrafts)
  const importedDrafts = importedRows ?? []
  const importedId = importedDrafts.find(item => item.id === requestedImportedId)?.id || importedDrafts[0]?.id || null
  const readImportedDraft = useCallback(async () => {
    if (!importDrawerOpen || !importedId) return null
    const result = await window.electron.agentTools.call({
      toolId: 'novelforge.artifacts.get', input: { artifactId: importedId },
    })
    if (!result.ok) throw new Error(result.error.message)
    const artifact = (result.data as { artifact: ImportedDraft }).artifact
    if (artifact.novelId !== novelId || !isExternalImportedDraft(artifact)) throw new Error(formatUserFacingMessage('workspace.import.wrongNovelOrSource'))
    return artifact
  }, [importDrawerOpen, importedId, novelId])
  const { data: selectedImportedDraft, loading: importDetailLoading, error: importDetailError, reload: reloadImportedDraft } = useAsyncSnapshot(readImportedDraft)
  const importLoading = importListLoading || (importDrawerOpen && Boolean(importedId) && importDetailLoading)
  const importFailure = importListError || importDetailError
  const importError = importFailure ? importFailure instanceof Error ? importFailure.message : '草稿读取失败' : ''
  const openImportedDraft = (id: string) => {
    if (id === importedId) void reloadImportedDraft()
    else setRequestedImportedId(id)
  }

  const readConsole = useCallback(async () => {
    const [novel, workflowStats, report, nextContextStatus, qualityDashboard, revisions, activities, chapterList, taskList, voice] = await Promise.all([
      window.electron.novel.get(novelId),
      loadWorkflowStats(novelId),
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getContextStatus(novelId),
      window.electron.quality.getDashboard(novelId).catch(() => null),
      window.electron.revision.getSnapshot(novelId).catch(() => null),
      window.electron.history.listRecent(novelId, 8).catch(() => []),
      window.electron.chapter.list(novelId),
      window.electron.task.list(novelId),
      window.electron.style.resolveActive(novelId),
    ])
    return { novel, workflowStats, report, nextContextStatus, qualityDashboard, revisions, activities, chapterList, taskList, voice }
  }, [novelId])
  const { data: consoleData, loading: consolePending, error: consoleError, reload: refreshConsole } = useAsyncSnapshot(readConsole)
  const loading = consolePending && consoleData === null
  const refreshing = consolePending && consoleData !== null
  const chapters = useMemo(() => consoleData?.chapterList ?? [], [consoleData])
  const tasks = useMemo(() => consoleData?.taskList ?? [], [consoleData])
  const approvedVoice = Boolean(consoleData?.voice?.approvedSample)
  const stats = consoleData?.workflowStats ?? EMPTY_WORKFLOW_STATS
  const consistencyReport = consoleData?.report ?? null
  const contextStatus = consoleData?.nextContextStatus ?? null
  const revisionSnapshot = consoleData?.revisions ?? null
  const recentActivities = consoleData?.activities ?? []
  const qualitySummary = consoleData?.qualityDashboard ?? null
  useEffect(() => {
    if (consoleData?.novel) setCurrentNovel(consoleData.novel)
  }, [consoleData, setCurrentNovel])
  useEffect(() => {
    if (consoleError) {
      console.error(consoleError)
      message.error(getErrorMessage(consoleError, 'common.loadFailed'))
    }
  }, [consoleError])

  const workspaceSnapshot = useMemo(
    () => getWorkspaceSnapshot(currentNovel, stats, {
      viewMode: getWorkspaceViewModeForNovel(currentNovel),
      qualitySummary: qualitySummary || undefined,
    }),
    [currentNovel, qualitySummary, stats],
  )

  const availableBlockers = useMemo(
    () => workspaceSnapshot.blockers.filter((item) => !ignoredBlockerIds.includes(item.id)),
    [ignoredBlockerIds, workspaceSnapshot.blockers],
  )
  const visibleBlockers = availableBlockers.slice(0, 3)
  const deferredBlockers = availableBlockers.slice(3)

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
  }, [consistencyReport?.focusAreas, contextStatus, qualitySummary?.productionReadiness.blockers, qualitySummary?.productionReadiness.warnings])

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

  const nextStep = useMemo(() => getStudioNextStep(chapters, tasks, approvedVoice), [chapters, tasks, approvedVoice])
  const recentScene = getStudioSceneLabel(getRecentStudioChapter(chapters))
  const nextStepPriority = nextStepPriorityPresentation(nextStep.priority)
  const importedDraftStale = Boolean(selectedImportedDraft && currentNovel?.id === novelId
    && selectedImportedDraft.contextVersion !== (currentNovel.contextVersion || 1))

  const openRecommendedStep = useCallback(() => {
    navigate(nextStep.targetPage.startsWith('/') ? nextStep.targetPage : buildWorkspaceRoute(novelId, nextStep.targetPage))
  }, [navigate, novelId, nextStep.targetPage])

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
      actionContract={{
        primary: {
          key: 'recommended-next-step',
          label: nextStep.actionLabel,
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

        <div className="studio-page__scene-status" data-studio-phase>
          <Tag>{chapters.some((chapter) => chapter.content?.trim()) ? '正文创作' : '开书试写'}</Tag>
          <span>最近场景：{recentScene}</span>
          <Tag color={approvedVoice ? 'green' : 'default'}>{approvedVoice ? '声音已认可' : '声音试用中'}</Tag>
        </div>
        <section
          className={`studio-page__next-step${queryPanel === 'next-step' ? ' is-focused' : ''}`}
          data-studio-next-step
          data-target-route={nextStep.targetPage}
        >
          <div className="studio-page__section-heading">
            <div>
              <span className="studio-page__eyebrow">推荐下一步</span>
              <h2>{nextStep.title}</h2>
              <p>{nextStep.reason}</p>
            </div>
            <Tag color={nextStepPriority.color}>
              {nextStepPriority.label}
            </Tag>
          </div>
          <div className="studio-page__next-step-footer">
            <span>{nextStep.estimatedMinutes ? `预计 ${nextStep.estimatedMinutes} 分钟` : '预计耗时未记录'}</span>
            <div className="studio-page__next-step-actions">
              <Button size="small" onClick={() => setImportDrawerOpen(true)}>
                查看导入草稿{importedDrafts.length > 0 ? ` (${importedDrafts.length})` : ''}
              </Button>
              <span className="studio-page__primary-hint">使用顶部主操作进入</span>
            </div>
          </div>
        </section>

        <section
          className={`studio-page__blockers${queryPanel === 'blockers' ? ' is-focused' : ''}`}
          data-studio-blockers
        >
          <SectionHeader
            eyebrow="正式创作检查"
            title="资料与事实待办"
            extra={availableBlockers.length > 0 ? <Tag color="volcano">{`${availableBlockers.length} 项`}</Tag> : null}
          />
          {availableBlockers.length > 0 ? (
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
              {deferredBlockers.length > 0 ? (
                <details className="studio-page__deferred-blockers">
                  <summary>展开其余 {deferredBlockers.length} 项阻塞</summary>
                  <div className="studio-page__blocker-list studio-page__blocker-list--deferred">
                    {deferredBlockers.map((blocker: ProjectBlocker) => (
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
                </details>
              ) : null}
            </div>
          ) : (
            <Alert
              type="success"
              showIcon
              message="当前没有阻塞"
            />
          )}
        </section>

        <section className="studio-page__entrances">
          <SectionHeader
            eyebrow="直接进入"
            title="生产链路入口"
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
              <span className="studio-page__eyebrow">辅助诊断</span>
              <strong>诊断与活动</strong>
            </span>
            <span className="studio-page__diagnostics-summary">
              {`活动 ${recentActivities.length} · 风险 ${riskItems.length} · 修订 ${topRevisionTasks.length}`}
            </span>
          </summary>
          <div className="studio-page__diagnostics-grid">
            <section className="studio-page__diagnostic-section">
              <SectionHeader title="最近活动" />
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
              <SectionHeader title="风险信号" />
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
              <SectionHeader title="修订反推" />
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
              <SectionHeader title="生产健康" />
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
      <Drawer
        title="外部导入草稿"
        width={760}
        rootClassName="studio-page__import-drawer"
        open={importDrawerOpen}
        onClose={() => setImportDrawerOpen(false)}
        extra={<Button size="small" onClick={() => void loadImportedDrafts()} loading={importLoading}>刷新</Button>}
      >
        <div className="studio-page__imported-drafts">
          <Alert type="info" showIcon message="这里是 Codex 等外部工具导入的候选内容；外部导入未经系统审校，导入本身不会修改小说设定。" />
          {importError ? <Alert type="error" showIcon message={importError} /> : null}
          <div className="studio-page__imported-layout">
            <div className="studio-page__imported-list">
              {importedDrafts.length === 0 && !importLoading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这部作品还没有外部草稿" /> : null}
              {importedDrafts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  className={`studio-page__imported-item${selectedImportedDraft?.id === artifact.id ? ' is-selected' : ''}`}
                  onClick={() => void openImportedDraft(artifact.id)}
                >
                  <strong>{artifact.producerClient === 'novelforge-mcp' ? 'Codex / MCP 导入' : artifact.producerClient || '外部草稿'}</strong>
                  <span>{dayjs(artifact.createdAt).format('YYYY-MM-DD HH:mm')} · {artifact.status === 'draft' ? '待审' : artifact.status === 'reviewed' ? '已审校' : '旧版本或阻断'}</span>
                </button>
              ))}
            </div>
            <div className="studio-page__imported-detail">
              {importLoading && !selectedImportedDraft ? <Spin /> : null}
              {selectedImportedDraft ? (
                <>
                  <div className="studio-page__imported-heading">
                    <div>
                      <strong>{selectedImportedDraft.content.title}</strong>
                      <span>{selectedImportedDraft.content.assetType === 'project_brief' ? '项目立项' : selectedImportedDraft.content.assetType} · {selectedImportedDraft.content.externalSource?.stageScope || '未标注阶段'} · {dayjs(selectedImportedDraft.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                    </div>
                    <div><Tag>{selectedImportedDraft.status === 'draft' ? '未审校' : '请人工核对'}</Tag>{importedDraftStale ? <Tag color="orange">旧上下文</Tag> : null}<Tag>未应用</Tag></div>
                  </div>
                  {selectedImportedDraft.content.externalSource ? (
                    <div className="studio-page__imported-source">
                      <strong>原始要求</strong><p>{selectedImportedDraft.content.externalSource.userRequest}</p>
                      <strong>分析依据</strong><p>{selectedImportedDraft.content.externalSource.analysis}</p>
                      {selectedImportedDraft.content.externalSource.unresolvedQuestions?.length > 0 ? (
                        <><strong>待确认</strong><p>{selectedImportedDraft.content.externalSource.unresolvedQuestions.join('；')}</p></>
                      ) : null}
                    </div>
                  ) : null}
                  <strong>草稿全文</strong>
                  <pre className="studio-page__imported-output">{selectedImportedDraft.content.output}</pre>
                  <div className="studio-page__imported-actions">
                    <Button icon={<CopyOutlined />} onClick={() => {
                      void (navigator.clipboard?.writeText(selectedImportedDraft.content.output) || Promise.reject(new Error('Clipboard unavailable')))
                        .then(() => message.success(getUserFacingMessage('workspace.import.draftCopied')))
                        .catch(() => message.error(getUserFacingMessage('workspace.import.copyFailed')))
                    }}>复制全文</Button>
                    {selectedImportedDraft.content.assetType === 'project_brief' && selectedImportedDraft.content.outputFormat === 'json' ? (
                      <Button type="primary" disabled={importedDraftStale} onClick={() => {
                        setImportDrawerOpen(false)
                        navigate(buildWorkspaceRoute(novelId, `project-brief?importArtifact=${encodeURIComponent(selectedImportedDraft.id)}`))
                      }}>去项目立项核对并回填</Button>
                    ) : <span>此类型暂需复制到对应页面，人工核对后保存。</span>}
                    {importedDraftStale ? <span>项目资料已变化，请用当前版本重新导入后再回填。</span> : null}
                  </div>
                </>
              ) : !importLoading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一份草稿查看原始要求和全文" /> : null}
            </div>
          </div>
        </div>
      </Drawer>
    </WorkspacePage>
  )
}
