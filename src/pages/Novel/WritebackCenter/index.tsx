import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import {
  CheckOutlined,
  EditOutlined,
  FilterOutlined,
  ReloadOutlined,
  RobotOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { diffJson } from 'diff'
import { getErrorMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ChapterFactExtract,
  ChapterWritebackAssetType,
  ChapterWritebackCenterData,
  ChapterWritebackDiff,
} from '../../../types'
import type { WorkspaceActionContract } from '../../../components/novel/workspace-layout/workspace-chrome-contract'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import './index.css'

interface Props {
  novelId: number
}

const ALL_ASSET_TYPES: ChapterWritebackAssetType[] = [
  'character',
  'world',
  'item',
  'relation',
  'thread',
  'foreshadow',
  'puzzle',
  'timeline',
]

function parseNumber(value?: string | null): number | null {
  if (!value) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function parseJson(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function prettyJson(raw?: string | null): string {
  const parsed = parseJson(raw)
  return parsed ? JSON.stringify(parsed, null, 2) : raw || '{}'
}

function assetLabel(assetType: ChapterWritebackAssetType): string {
  switch (assetType) {
    case 'character': return '人物'
    case 'world': return '世界'
    case 'item': return '物品'
    case 'relation': return '关系'
    case 'thread': return '线程'
    case 'foreshadow': return '伏笔'
    case 'puzzle': return '谜题'
    case 'timeline': return '时间轴'
    default: return assetType
  }
}

function decisionColor(value: ChapterWritebackDiff['canonDecision']): string {
  if (value === 'accepted') return 'green'
  if (value === 'edited') return 'blue'
  if (value === 'rejected') return 'default'
  return 'gold'
}

function decisionLabel(value: ChapterWritebackDiff['canonDecision']): string {
  if (value === 'accepted') return '已接受'
  if (value === 'edited') return '已编辑'
  if (value === 'rejected') return '已拒绝'
  return '待确认'
}

function writebackColor(value: ChapterWritebackDiff['writebackStatus']): string {
  if (value === 'applied') return 'green'
  if (value === 'failed') return 'red'
  if (value === 'skipped') return 'default'
  return 'gold'
}

function writebackLabel(value: ChapterWritebackDiff['writebackStatus']): string {
  if (value === 'applied') return '已写回'
  if (value === 'failed') return '失败'
  if (value === 'skipped') return '跳过'
  return '待写回'
}

function verificationColor(value: ChapterWritebackDiff['verificationStatus'] | ChapterFactExtract['verificationStatus']): string {
  if (value === 'auto_ready') return 'green'
  if (value === 'needs_review') return 'gold'
  return 'red'
}

function verificationLabel(value: ChapterWritebackDiff['verificationStatus'] | ChapterFactExtract['verificationStatus']): string {
  if (value === 'auto_ready') return '自动通过'
  if (value === 'needs_review') return '待人工确认'
  return '冲突'
}

function runStatusColor(status?: string | null): string {
  if (status === 'applied') return 'green'
  if (status === 'partially_failed') return 'orange'
  if (status === 'failed') return 'red'
  if (status === 'applying') return 'blue'
  return 'gold'
}

function runStatusLabel(status?: string | null): string {
  if (status === 'ready') return '候选就绪'
  if (status === 'applying') return '回写中'
  if (status === 'applied') return '已完成'
  if (status === 'partially_failed') return '部分失败'
  if (status === 'failed') return '失败'
  return '草稿中'
}

function resolveDiffTitle(diff: ChapterWritebackDiff): string {
  const after = parseJson(diff.afterStateJson)
  return String(after?.title || after?.itemName || after?.eventTitle || after?.entityName || `${assetLabel(diff.assetType)}候选`)
}

function resolveExtractTitle(extract: ChapterFactExtract): string {
  const fact = parseJson(extract.factJson)
  return String(fact?.title || fact?.itemName || fact?.eventTitle || fact?.summary || `${assetLabel(extract.assetType)}事实`)
}

function confidenceLabel(value?: number | null): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}% 置信度` : '未记录置信度'
}

function JsonDiffViewer({ beforeJson, afterJson }: { beforeJson?: string | null, afterJson?: string | null }) {
  const beforeObj = parseJson(beforeJson) || {}
  const afterObj = parseJson(afterJson) || {}
  const diffResult = diffJson(beforeObj, afterObj)

  return (
    <div className="novel-writeback-center-page__diff-viewer" aria-label="当前候选 Diff">
      {diffResult.map((part, index) => {
        const bg = part.added ? 'var(--writeback-diff-added)' : part.removed ? 'var(--writeback-diff-removed)' : 'transparent'
        const color = part.added ? 'var(--writeback-diff-added-ink)' : part.removed ? 'var(--writeback-diff-removed-ink)' : 'inherit'
        const prefix = part.added ? '+ ' : part.removed ? '- ' : '  '

        return (
          <div key={index} style={{ backgroundColor: bg, color, whiteSpace: 'pre-wrap', padding: '0 8px' }}>
            {part.value.split('\n').map((line, lineIndex, lines) => (
              lineIndex === lines.length - 1 && line === '' ? null : (
                <div key={lineIndex} className="novel-writeback-center-page__diff-line">
                  <span className="novel-writeback-center-page__diff-prefix" aria-hidden="true">{prefix}</span>
                  <span>{line}</span>
                </div>
              )
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function WritebackCenterPage({ novelId }: Props) {
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { mutationToken, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [centerData, setCenterData] = useState<ChapterWritebackCenterData | null>(null)
  const [selectedDiffId, setSelectedDiffId] = useState<number | null>(null)
  const [assetFilter, setAssetFilter] = useState<'all' | ChapterWritebackAssetType>('all')
  const [decisionFilter, setDecisionFilter] = useState<'all' | ChapterWritebackDiff['canonDecision']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ChapterWritebackDiff['writebackStatus']>('all')
  const [verificationFilter, setVerificationFilter] = useState<'all' | ChapterWritebackDiff['verificationStatus']>('all')
  const [editingDiff, setEditingDiff] = useState<ChapterWritebackDiff | null>(null)
  const [editingAfterState, setEditingAfterState] = useState('')
  const [editingReason, setEditingReason] = useState('')
  const loadedOnceRef = useRef(false)
  const refreshRequestRef = useRef(0)
  const routeValuesRef = useRef<{ chapterId: number | null; runId: number | null }>({ chapterId: null, runId: null })
  const searchParamsRef = useRef(searchParams)
  const internalRouteKeyRef = useRef<string | null>(null)
  const actionInFlightRef = useRef(false)

  const selectedChapterId = parseNumber(searchParams.get('chapterId'))
  const selectedRunId = parseNumber(searchParams.get('runId'))
  routeValuesRef.current = { chapterId: selectedChapterId, runId: selectedRunId }
  searchParamsRef.current = searchParams

  const refresh = useCallback(async (chapterIdArg?: number | null, runIdArg?: number | null, showLoading = false) => {
    const requestId = ++refreshRequestRef.current
    if (showLoading || !loadedOnceRef.current) setLoading(true)
    else setRefreshing(true)
    try {
      const chapterRows = await window.electron.chapter.list(novelId)
      if (refreshRequestRef.current !== requestId) return
      setChapters(chapterRows)
      const requestedChapterId = chapterIdArg === undefined ? routeValuesRef.current.chapterId : chapterIdArg
      const requestedRunId = runIdArg === undefined ? routeValuesRef.current.runId : runIdArg
      const fallbackChapterId = requestedChapterId && chapterRows.some((chapter) => chapter.id === requestedChapterId)
        ? requestedChapterId
        : chapterRows.at(-1)?.id ?? null
      if (!fallbackChapterId) {
        setCenterData(null)
        loadedOnceRef.current = true
        const nextParams = new URLSearchParams(searchParamsRef.current)
        nextParams.delete('chapterId')
        nextParams.delete('runId')
        const nextRouteKey = nextParams.toString()
        if (nextRouteKey !== searchParamsRef.current.toString()) {
          internalRouteKeyRef.current = nextRouteKey
          setSearchParams(nextParams, { replace: true })
        }
        return
      }
      const nextData = await window.electron.writeback.getCenterData(fallbackChapterId, requestedRunId ?? undefined)
      if (refreshRequestRef.current !== requestId) return
      setCenterData(nextData)
      loadedOnceRef.current = true
      const nextParams = new URLSearchParams(searchParamsRef.current)
      nextParams.set('chapterId', String(fallbackChapterId))
      if (nextData.activeRun?.id) nextParams.set('runId', String(nextData.activeRun.id))
      else nextParams.delete('runId')
      const nextRouteKey = nextParams.toString()
      if (nextRouteKey !== searchParamsRef.current.toString()) {
        internalRouteKeyRef.current = nextRouteKey
        setSearchParams(nextParams, { replace: true })
      }
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [novelId, setSearchParams])

  useEffect(() => {
    const routeKey = searchParams.toString()
    if (internalRouteKeyRef.current === routeKey) {
      internalRouteKeyRef.current = null
      return
    }
    void refresh(selectedChapterId, selectedRunId, true)
  }, [mutationToken, refresh, searchParams, selectedChapterId, selectedRunId])

  const activeRun = centerData?.activeRun || null
  const pendingDiffCount = useMemo(
    () => (centerData?.diffs || []).filter((item) => item.canonDecision === 'pending').length,
    [centerData?.diffs],
  )
  const pendingReviewCount = useMemo(
    () => (centerData?.diffs || []).filter((item) => item.canonDecision === 'pending' && item.verificationStatus !== 'auto_ready').length,
    [centerData?.diffs],
  )
  const filteredDiffs = useMemo(() => {
    const rows = centerData?.diffs || []
    return rows
      .filter((item) => assetFilter === 'all' || item.assetType === assetFilter)
      .filter((item) => decisionFilter === 'all' || item.canonDecision === decisionFilter)
      .filter((item) => statusFilter === 'all' || item.writebackStatus === statusFilter)
      .filter((item) => verificationFilter === 'all' || item.verificationStatus === verificationFilter)
  }, [assetFilter, centerData?.diffs, decisionFilter, statusFilter, verificationFilter])
  const filteredExtracts = useMemo(() => {
    const rows = centerData?.extracts || []
    return rows
      .filter((item) => assetFilter === 'all' || item.assetType === assetFilter)
      .filter((item) => verificationFilter === 'all' || item.verificationStatus === verificationFilter)
  }, [assetFilter, centerData?.extracts, verificationFilter])
  const coverageMap = useMemo(
    () => new Map((centerData?.coverage || []).map((item) => [item.assetType, item] as const)),
    [centerData?.coverage],
  )
  const currentDiff = filteredDiffs.find((item) => item.id === selectedDiffId) || filteredDiffs[0] || null
  const currentDiffIndex = currentDiff ? filteredDiffs.findIndex((item) => item.id === currentDiff.id) : -1

  useEffect(() => {
    setSelectedDiffId((current) => current && filteredDiffs.some((item) => item.id === current) ? current : filteredDiffs[0]?.id || null)
  }, [filteredDiffs])

  const openEditModal = useCallback((diff: ChapterWritebackDiff) => {
    setEditingDiff(diff)
    setEditingAfterState(prettyJson(diff.afterStateJson))
    setEditingReason(diff.diffReason || '')
  }, [])

  const closeEditModal = useCallback(() => {
    setEditingDiff(null)
    setEditingAfterState('')
    setEditingReason('')
  }, [])

  const runAction = useCallback(async (
    task: () => Promise<unknown>,
    successText: string,
    runIdToReload?: number | null,
    refreshAfter = true,
  ) => {
    if (actionInFlightRef.current) return false
    actionInFlightRef.current = true
    setActionLoading(true)
    try {
      await task()
      if (refreshAfter) await refresh(centerData?.chapter?.id, runIdToReload ?? activeRun?.id ?? null)
      notifyWorkspaceMutation()
      message.success(successText)
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
      return false
    } finally {
      actionInFlightRef.current = false
      setActionLoading(false)
    }
  }, [activeRun?.id, centerData?.chapter?.id, notifyWorkspaceMutation, refresh])

  const prepareRun = useCallback(() => {
    if (!centerData?.chapter?.id) return
    void runAction(async () => {
      const run = await window.electron.writeback.prepareRun(centerData.chapter?.id || 0, 'manual')
      await refresh(centerData.chapter?.id, run.id)
    }, '新的回写草案已生成。', null, false)
  }, [centerData?.chapter?.id, refresh, runAction])

  const applyConfirmedRun = useCallback(() => {
    if (!activeRun) return
    const runId = activeRun.id
    const execute = () => void runAction(() => window.electron.writeback.applyRun(runId), '已执行统一回写。')
    if (pendingDiffCount <= 0) {
      execute()
      return
    }
    Modal.confirm({
      title: '仍有候选未确认',
      content: `当前还有 ${pendingDiffCount} 条候选未确认${pendingReviewCount > 0 ? `，其中 ${pendingReviewCount} 条需要人工复核` : ''}。继续操作只会写回已接受或已编辑的候选，未确认项将被跳过，不会进入正典。`,
      okText: '继续应用已确认项',
      cancelText: '返回确认',
      onOk: execute,
    })
  }, [activeRun, pendingDiffCount, pendingReviewCount, runAction])

  const acceptCurrent = useCallback(() => {
    if (!currentDiff) return
    void runAction(() => window.electron.writeback.updateDecision(currentDiff.id, { canonDecision: 'accepted' }), '候选已接受。')
  }, [currentDiff, runAction])

  const rejectCurrent = useCallback(() => {
    if (!currentDiff) return
    void runAction(() => window.electron.writeback.updateDecision(currentDiff.id, { canonDecision: 'rejected' }), '候选已拒绝。')
  }, [currentDiff, runAction])

  const retryFailed = useCallback(() => {
    if (!activeRun) return
    const runId = activeRun.id
    void runAction(() => window.electron.writeback.retryFailed(runId), '失败项已重试。')
  }, [activeRun, runAction])

  const selectAdjacentDiff = useCallback((offset: -1 | 1) => {
    if (currentDiffIndex < 0) return
    const target = filteredDiffs[currentDiffIndex + offset]
    if (target) setSelectedDiffId(target.id)
  }, [currentDiffIndex, filteredDiffs])

  const actionContract = useMemo<WorkspaceActionContract>(() => ({
    primary: {
      key: 'apply-confirmed',
      label: '应用已确认项',
      icon: <CheckOutlined />,
      loading: actionLoading,
      disabled: !activeRun,
      onClick: applyConfirmedRun,
    },
    secondary: [
      {
        key: 'retry',
        label: '重试失败项',
        icon: <ReloadOutlined />,
        loading: actionLoading,
        disabled: !activeRun,
        onClick: retryFailed,
      },
    ],
    more: {
      items: [
        {
          key: 'prepare',
          label: '重新抽取本章',
          icon: <RobotOutlined />,
          loading: actionLoading,
          disabled: !centerData?.chapter?.id,
          onClick: prepareRun,
        },
        {
          key: 'bulk-accept',
          label: '批量接受当前筛选',
          icon: <CheckOutlined />,
          disabled: !activeRun || filteredDiffs.length === 0,
          onClick: () => void runAction(() => window.electron.writeback.bulkUpdateDecisions(activeRun?.id || 0, { canonDecision: 'accepted', assetType: assetFilter === 'all' ? undefined : assetFilter, diffIds: filteredDiffs.map((item) => item.id) }), '已批量接受当前筛选结果。'),
        },
        {
          key: 'bulk-reject',
          label: '批量拒绝当前筛选',
          icon: <StopOutlined />,
          danger: true,
          disabled: !activeRun || filteredDiffs.length === 0,
          onClick: () => void runAction(() => window.electron.writeback.bulkUpdateDecisions(activeRun?.id || 0, { canonDecision: 'rejected', assetType: assetFilter === 'all' ? undefined : assetFilter, diffIds: filteredDiffs.map((item) => item.id) }), '已批量拒绝当前筛选结果。'),
        },
        {
          key: 'refresh',
          label: '刷新回写数据',
          icon: <ReloadOutlined />,
          onClick: () => void refresh(centerData?.chapter?.id, activeRun?.id || null),
        },
      ],
    },
  }), [actionLoading, activeRun, applyConfirmedRun, assetFilter, centerData?.chapter?.id, filteredDiffs, prepareRun, refresh, retryFailed, runAction])

  if (loading && !centerData) {
    return (
      <WorkspacePage className="novel-writeback-center-page" title="章后状态回写中心">
        <WorkspacePanel title="正在加载回写中心">
          <div className="novel-workspace__loading-card"><Spin /></div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      className="novel-writeback-center-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="正文生产 / Canon 同步"
      title="章后状态回写中心"
      chrome="shared"
      actionContract={actionContract}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前项目', value: currentNovel?.title || '未命名小说' },
            { label: '当前章节', value: centerData?.chapter ? `第${centerData.chapter.chapterNum}章 ${centerData.chapter.title || ''}`.trim() : '未选择' },
            { label: '当前运行', value: activeRun ? `#${activeRun.id}` : '暂无' },
            { label: '同步状态', value: activeRun ? runStatusLabel(activeRun.status) : centerData?.writebackStatus.canonApplied ? '正典已同步' : '暂无候选' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="当前 Diff" value={currentDiff ? `${currentDiffIndex + 1}/${filteredDiffs.length}` : '—'} tone="warm" />
          <WorkspaceMetric label="待确认" value={pendingDiffCount} tone={pendingDiffCount > 0 ? 'warm' : 'cool'} />
          <WorkspaceMetric label="已写回" value={(centerData?.diffs || []).filter((item) => item.writebackStatus === 'applied').length} />
          <WorkspaceMetric label="失败项" value={(centerData?.diffs || []).filter((item) => item.writebackStatus === 'failed').length} tone="warm" />
        </>
      )}
    >
      <div data-writeback-page data-writeback-responsibility="single-current-diff" className="novel-writeback-center-page__body">
        {refreshing ? (
          <div className="novel-writeback-center-page__refresh" role="status">
            <Spin size="small" />
            <span>正在同步章后回写数据</span>
          </div>
        ) : null}
        {chapters.length <= 0 ? (
          <Alert showIcon type="info" message="当前还没有章节" description="先去结构规划或正文写作创建章节，再进入章后状态回写中心。" />
        ) : null}

        <WorkspacePanel
          className="novel-writeback-center-page__current-panel"
          title="当前 Diff"
          extra={activeRun ? <Tag color={runStatusColor(activeRun.status)}>{runStatusLabel(activeRun.status)}</Tag> : null}
        >
          <div className="novel-writeback-center-page__focus-grid">
            <aside className="novel-writeback-center-page__candidate-rail" data-writeback-candidate-list aria-label="待确认候选列表">
              <div className="novel-writeback-center-page__rail-heading">
                <div>
                  <span className="novel-writeback-center-page__kicker">待确认队列</span>
                  <strong>{filteredDiffs.length ? `${filteredDiffs.length} 条候选` : '空队列'}</strong>
                </div>
                {filteredDiffs.length > 1 ? <span className="novel-writeback-center-page__rail-hint">点击切换 Diff</span> : null}
              </div>
              <div className="novel-writeback-center-page__candidate-list">
                {filteredDiffs.map((diff, index) => (
                  <button
                    key={diff.id}
                    type="button"
                    data-writeback-candidate-id={diff.id}
                    aria-current={currentDiff?.id === diff.id ? 'true' : undefined}
                    className={`novel-writeback-center-page__candidate${currentDiff?.id === diff.id ? ' is-active' : ''}`}
                    onClick={() => setSelectedDiffId(diff.id)}
                  >
                    <span className="novel-writeback-center-page__candidate-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="novel-writeback-center-page__candidate-copy">
                      <strong>{resolveDiffTitle(diff)}</strong>
                      <span>{diff.diffReason || '未填写变更原因'}</span>
                    </span>
                    <span className="novel-writeback-center-page__candidate-state">
                      <Tag color={decisionColor(diff.canonDecision)}>{decisionLabel(diff.canonDecision)}</Tag>
                    </span>
                  </button>
                ))}
                {filteredDiffs.length === 0 ? (
                  <div className="novel-writeback-center-page__candidate-empty" data-writeback-empty-candidate>
                    <span className="novel-writeback-center-page__empty-mark">∅</span>
                    <strong>没有待处理候选</strong>
                    <span>可从页面动作重新抽取本章状态。</span>
                  </div>
                ) : null}
              </div>
            </aside>

            <article data-writeback-current-diff className="novel-writeback-center-page__current-diff">
              {currentDiff ? (
                <>
                  <div className="novel-writeback-center-page__diff-head">
                    <div className="novel-writeback-center-page__diff-title-wrap">
                      <span className="novel-writeback-center-page__kicker">候选对象</span>
                      <h3>{resolveDiffTitle(currentDiff)}</h3>
                      <span className="novel-writeback-center-page__muted">{currentDiff.entityType} · {confidenceLabel(currentDiff.confidence)}</span>
                    </div>
                    <div className="novel-writeback-center-page__tag-row">
                      <Tag color="geekblue">{assetLabel(currentDiff.assetType)}</Tag>
                      <Tag color={verificationColor(currentDiff.verificationStatus)}>{verificationLabel(currentDiff.verificationStatus)}</Tag>
                      <Tag color={writebackColor(currentDiff.writebackStatus)}>{writebackLabel(currentDiff.writebackStatus)}</Tag>
                    </div>
                  </div>
                  <div className="novel-writeback-center-page__reason">
                    <span>为什么出现</span>
                    <strong>{currentDiff.diffReason || '本章检测到状态变化，等待人工确认。'}</strong>
                  </div>
                  {currentDiff.writebackError ? <Alert showIcon type="error" message="上次写回失败" description={currentDiff.writebackError} /> : null}
                  <div className="novel-writeback-center-page__diff-actions" data-writeback-decision-actions>
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      disabled={currentDiff.writebackStatus === 'applied'}
                      loading={actionLoading}
                      onClick={acceptCurrent}
                    >
                      接受候选
                    </Button>
                    <Button
                      icon={<StopOutlined />}
                      disabled={currentDiff.writebackStatus === 'applied'}
                      loading={actionLoading}
                      onClick={rejectCurrent}
                    >
                      拒绝候选
                    </Button>
                    <Button
                      icon={<EditOutlined />}
                      disabled={currentDiff.writebackStatus === 'applied'}
                      onClick={() => openEditModal(currentDiff)}
                    >
                      编辑候选
                    </Button>
                    {filteredDiffs.length > 1 ? (
                      <Space.Compact className="novel-writeback-center-page__diff-navigation">
                        <Button
                          type="text"
                          disabled={currentDiffIndex <= 0}
                          onClick={() => selectAdjacentDiff(-1)}
                        >
                          ← 上一条
                        </Button>
                        <Button
                          type="text"
                          disabled={currentDiffIndex < 0 || currentDiffIndex >= filteredDiffs.length - 1}
                          onClick={() => selectAdjacentDiff(1)}
                        >
                          下一条 →
                        </Button>
                      </Space.Compact>
                    ) : null}
                  </div>
                  <div className="novel-writeback-center-page__diff-caption">
                    <span>前后状态对比</span>
                    <span>绿色为新增 · 红色为移除</span>
                  </div>
                  <JsonDiffViewer beforeJson={currentDiff.beforeStateJson} afterJson={currentDiff.afterStateJson} />
                </>
              ) : (
                <div className="novel-writeback-center-page__empty-diff" data-writeback-empty-diff>
                  <div className="novel-writeback-center-page__empty-orbit" aria-hidden="true">◎</div>
                  <span className="novel-writeback-center-page__kicker">当前章节</span>
                  <h3>还没有可写回的 Diff</h3>
                  <p>从页面顶部“更多”菜单重新抽取，会生成事实与状态候选；有候选后，这里只聚焦一条当前 Diff。</p>
                </div>
              )}
            </article>
          </div>
        </WorkspacePanel>

        <div className="novel-writeback-center-page__disclosure-stack">
          <details data-writeback-facts className="novel-writeback-center-page__disclosure">
            <summary>
              <span className="novel-writeback-center-page__summary-main"><span className="novel-writeback-center-page__summary-icon">01</span><strong>事实抽取与原始结果</strong></span>
              <span className="novel-writeback-center-page__summary-meta">{filteredExtracts.length} 条 · 查看详情</span>
            </summary>
            <div className="novel-writeback-center-page__disclosure-content" data-writeback-raw-results>
              {filteredExtracts.length > 0 ? filteredExtracts.map((extract) => (
                <article key={extract.id} className="novel-writeback-center-page__fact-item">
                  <div className="novel-writeback-center-page__fact-head">
                    <div>
                      <span className="novel-writeback-center-page__kicker">{assetLabel(extract.assetType)}</span>
                      <strong>{resolveExtractTitle(extract)}</strong>
                    </div>
                    <Space size={6} wrap>
                      <Tag color={verificationColor(extract.verificationStatus)}>{verificationLabel(extract.verificationStatus)}</Tag>
                      <span className="novel-writeback-center-page__muted">{confidenceLabel(extract.confidence)}</span>
                    </Space>
                  </div>
                  {extract.sourceText ? <p>{extract.sourceText}</p> : null}
                  <pre>{prettyJson(extract.factJson)}</pre>
                </article>
              )) : <div className="novel-copy-block">当前筛选下没有事实抽取结果。</div>}
            </div>
          </details>

          <details data-writeback-coverage className="novel-writeback-center-page__disclosure">
            <summary>
              <span className="novel-writeback-center-page__summary-main"><span className="novel-writeback-center-page__summary-icon">02</span><strong>八类资产覆盖</strong></span>
              <span className="novel-writeback-center-page__summary-meta">{centerData?.coverage.length || 0}/8 类 · 查看详情</span>
            </summary>
            <div className="novel-writeback-center-page__disclosure-content">
              <div className="novel-writeback-center-page__coverage-grid">
                {ALL_ASSET_TYPES.map((assetType) => {
                  const item = coverageMap.get(assetType)
                  const confirmedCount = (item?.acceptedCount || 0) + (item?.editedCount || 0)
                  return (
                    <div key={assetType} className="novel-writeback-center-page__coverage-card">
                      <div className="novel-writeback-center-page__coverage-head">
                        <strong>{assetLabel(assetType)}</strong>
                        <span>{item?.diffCount || 0} 候选</span>
                      </div>
                      <div className="novel-writeback-center-page__coverage-numbers">
                        <span><b>{item?.extractCount || 0}</b>抽取</span>
                        <span><b>{confirmedCount}</b>确认</span>
                        <span><b>{item?.appliedCount || 0}</b>写回</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </details>

          <details data-writeback-diagnostics className="novel-writeback-center-page__disclosure">
            <summary>
              <span className="novel-writeback-center-page__summary-main"><span className="novel-writeback-center-page__summary-icon"><FilterOutlined /></span><strong>筛选与诊断</strong></span>
              <span className="novel-writeback-center-page__summary-meta">章节、运行、状态过滤 · 查看诊断</span>
            </summary>
            <div className="novel-writeback-center-page__diagnostics-content">
              <div className="novel-writeback-center-page__filters">
                <Select
                  value={centerData?.chapter?.id}
                  placeholder="选择章节"
                  options={chapters.map((chapter) => ({ value: chapter.id, label: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim() }))}
                  onChange={(value) => void refresh(Number(value), null)}
                />
                <Select
                  value={activeRun?.id}
                  placeholder="选择运行"
                  options={(centerData?.runs || []).map((run) => ({ value: run.id, label: `#${run.id} · ${runStatusLabel(run.status)} · ${run.triggerSource}` }))}
                  onChange={(value) => void refresh(centerData?.chapter?.id, Number(value))}
                />
                <Select
                  value={assetFilter}
                  options={[{ value: 'all', label: '全部资产' }, ...ALL_ASSET_TYPES.map((item) => ({ value: item, label: assetLabel(item) }))]}
                  onChange={(value) => setAssetFilter(value as 'all' | ChapterWritebackAssetType)}
                />
                <Select
                  value={decisionFilter}
                  options={[
                    { value: 'all', label: '全部确认状态' },
                    { value: 'pending', label: '待确认' },
                    { value: 'accepted', label: '已接受' },
                    { value: 'edited', label: '已编辑' },
                    { value: 'rejected', label: '已拒绝' },
                  ]}
                  onChange={(value) => setDecisionFilter(value as typeof decisionFilter)}
                />
                <Select
                  value={statusFilter}
                  options={[
                    { value: 'all', label: '全部回写状态' },
                    { value: 'pending', label: '待写回' },
                    { value: 'applied', label: '已写回' },
                    { value: 'failed', label: '失败' },
                    { value: 'skipped', label: '跳过' },
                  ]}
                  onChange={(value) => setStatusFilter(value as typeof statusFilter)}
                />
                <Select
                  value={verificationFilter}
                  options={[
                    { value: 'all', label: '全部验证状态' },
                    { value: 'auto_ready', label: '自动通过' },
                    { value: 'needs_review', label: '待人工确认' },
                    { value: 'conflicted', label: '冲突' },
                  ]}
                  onChange={(value) => setVerificationFilter(value as typeof verificationFilter)}
                />
              </div>
              {activeRun ? (
                <div className="novel-writeback-center-page__diagnostic-summary">
                  <div>
                    <span className="novel-writeback-center-page__kicker">当前运行摘要</span>
                    <strong>{activeRun.summaryText || '当前运行暂无摘要。'}</strong>
                  </div>
                  {pendingDiffCount > 0 ? (
                    <Alert
                      type="warning"
                      showIcon
                      message={`还有 ${pendingDiffCount} 条候选未确认`}
                      description={pendingReviewCount > 0 ? `其中 ${pendingReviewCount} 条需要人工复核。应用动作只写回已接受或已编辑项。` : '应用动作只写回已接受或已编辑项。'}
                    />
                  ) : <Tag color="green">当前运行已无待确认候选</Tag>}
                </div>
              ) : (
                <Alert type="info" showIcon message="当前章节还没有回写运行" description="点击页面动作“重新抽取”后，会先生成事实抽取和状态候选，再进入人工确认。" />
              )}
            </div>
          </details>
        </div>
      </div>

      <Modal
        title={editingDiff ? `编辑候选 · ${resolveDiffTitle(editingDiff)}` : '编辑候选'}
        open={Boolean(editingDiff)}
        onCancel={() => { if (!actionLoading) closeEditModal() }}
        onOk={() => {
          if (!editingDiff) return
          void runAction(
            () => window.electron.writeback.updateDecision(editingDiff.id, {
              canonDecision: 'edited',
              afterStateJson: editingAfterState,
              diffReason: editingReason,
            }),
            '候选已更新。',
          ).then((succeeded) => {
            if (succeeded) closeEditModal()
          })
        }}
        cancelButtonProps={{ disabled: actionLoading }}
        maskClosable={!actionLoading}
        width={860}
      >
        <div className="novel-writeback-center-page__modal-fields">
          <Input value={editingReason} onChange={(event) => setEditingReason(event.target.value)} placeholder="补充这条候选为什么需要回写" />
          <Input.TextArea value={editingAfterState} onChange={(event) => setEditingAfterState(event.target.value)} rows={18} placeholder="编辑回写后的状态数据（JSON 格式）" />
        </div>
      </Modal>
    </WorkspacePage>
  )
}
