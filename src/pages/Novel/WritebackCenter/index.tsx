import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { CheckOutlined, EditOutlined, ReloadOutlined, RobotOutlined, StopOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { getErrorMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ChapterFactExtract,
  ChapterWritebackAssetType,
  ChapterWritebackCenterData,
  ChapterWritebackDiff,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

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
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
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

export default function WritebackCenterPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [centerData, setCenterData] = useState<ChapterWritebackCenterData | null>(null)
  const [assetFilter, setAssetFilter] = useState<'all' | ChapterWritebackAssetType>('all')
  const [decisionFilter, setDecisionFilter] = useState<'all' | ChapterWritebackDiff['canonDecision']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ChapterWritebackDiff['writebackStatus']>('all')
  const [editingDiff, setEditingDiff] = useState<ChapterWritebackDiff | null>(null)
  const [editingAfterState, setEditingAfterState] = useState('')
  const [editingReason, setEditingReason] = useState('')

  const selectedChapterId = parseNumber(searchParams.get('chapterId'))
  const selectedRunId = parseNumber(searchParams.get('runId'))

  const refresh = useCallback(async (chapterIdArg?: number | null, runIdArg?: number | null) => {
    setLoading(true)
    try {
      const chapterRows = await window.electron.chapter.list(novelId)
      setChapters(chapterRows)
      const fallbackChapterId = chapterIdArg || selectedChapterId || chapterRows.at(-1)?.id || null
      if (!fallbackChapterId) {
        setCenterData(null)
        return
      }
      const nextData = await window.electron.writeback.getCenterData(fallbackChapterId, runIdArg || selectedRunId || undefined)
      setCenterData(nextData)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('chapterId', String(fallbackChapterId))
      if (nextData.activeRun?.id) nextParams.set('runId', String(nextData.activeRun.id))
      else nextParams.delete('runId')
      setSearchParams(nextParams, { replace: true })
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [novelId, searchParams, selectedChapterId, selectedRunId, setSearchParams])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  const activeRun = centerData?.activeRun || null
  const filteredDiffs = useMemo(() => {
    const rows = centerData?.diffs || []
    return rows.filter((item) => (assetFilter === 'all' || item.assetType === assetFilter))
      .filter((item) => (decisionFilter === 'all' || item.canonDecision === decisionFilter))
      .filter((item) => (statusFilter === 'all' || item.writebackStatus === statusFilter))
  }, [assetFilter, centerData?.diffs, decisionFilter, statusFilter])

  const filteredExtracts = useMemo(() => {
    const rows = centerData?.extracts || []
    return rows.filter((item) => assetFilter === 'all' || item.assetType === assetFilter)
  }, [assetFilter, centerData?.extracts])

  const coverageMap = useMemo(
    () => new Map((centerData?.coverage || []).map((item) => [item.assetType, item] as const)),
    [centerData?.coverage],
  )

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

  const runAction = useCallback(async (task: () => Promise<unknown>, successText: string, runIdToReload?: number | null) => {
    setActionLoading(true)
    try {
      await task()
      await refresh(centerData?.chapter?.id, runIdToReload || activeRun?.id || null)
      notifyWorkspaceMutation()
      message.success(successText)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setActionLoading(false)
    }
  }, [activeRun?.id, centerData?.chapter?.id, notifyWorkspaceMutation, refresh])

  const diffColumns = [
    {
      title: '资产',
      width: 90,
      render: (_value: unknown, row: ChapterWritebackDiff) => <Tag color="geekblue">{assetLabel(row.assetType)}</Tag>,
    },
    {
      title: '候选',
      render: (_value: unknown, row: ChapterWritebackDiff) => (
        <div style={{ display: 'grid', gap: 4 }}>
          <strong>{resolveDiffTitle(row)}</strong>
          <span style={{ color: '#6b7280' }}>{row.diffReason || '未填写原因'}</span>
        </div>
      ),
    },
    {
      title: 'Canon',
      width: 110,
      render: (_value: unknown, row: ChapterWritebackDiff) => <Tag color={decisionColor(row.canonDecision)}>{decisionLabel(row.canonDecision)}</Tag>,
    },
    {
      title: '回写',
      width: 110,
      render: (_value: unknown, row: ChapterWritebackDiff) => <Tag color={writebackColor(row.writebackStatus)}>{writebackLabel(row.writebackStatus)}</Tag>,
    },
    {
      title: '操作',
      width: 220,
      render: (_value: unknown, row: ChapterWritebackDiff) => (
        <Space wrap>
          <Button size="small" icon={<CheckOutlined />} onClick={() => void runAction(() => window.electron.writeback.updateDecision(row.id, { canonDecision: 'accepted' }), '候选已接受。')}>
            接受
          </Button>
          <Button size="small" icon={<StopOutlined />} onClick={() => void runAction(() => window.electron.writeback.updateDecision(row.id, { canonDecision: 'rejected' }), '候选已拒绝。')}>
            拒绝
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(row)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <WorkspacePage
      className="novel-writeback-center-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="Canonizer / 统一回写"
      title="章后状态回写中心"
      description="先看事实抽取，再确认 Canon 差异，最后统一写回线程、伏笔、谜题、关系、物品与时间轴。"
      actions={(
        <Space wrap>
          <Button icon={<RobotOutlined />} loading={actionLoading} disabled={!centerData?.chapter?.id} onClick={() => void runAction(async () => {
            const run = await window.electron.writeback.prepareRun(centerData?.chapter?.id || 0, 'manual')
            await refresh(centerData?.chapter?.id, run.id)
          }, '新的回写草案已生成。')}>
            重新抽取
          </Button>
          <Button loading={actionLoading} disabled={!activeRun} onClick={() => void runAction(() => window.electron.writeback.bulkUpdateDecisions(activeRun?.id || 0, { canonDecision: 'accepted', assetType: assetFilter === 'all' ? undefined : assetFilter }), '已批量接受当前筛选结果。')}>
            批量接受
          </Button>
          <Button loading={actionLoading} disabled={!activeRun} onClick={() => void runAction(() => window.electron.writeback.bulkUpdateDecisions(activeRun?.id || 0, { canonDecision: 'rejected', assetType: assetFilter === 'all' ? undefined : assetFilter }), '已批量拒绝当前筛选结果。')}>
            批量拒绝
          </Button>
          <Button type="primary" loading={actionLoading} disabled={!activeRun} onClick={() => void runAction(() => window.electron.writeback.applyRun(activeRun?.id || 0), '已执行统一回写。')}>
            应用已确认项
          </Button>
          <Button icon={<ReloadOutlined />} loading={actionLoading} disabled={!activeRun} onClick={() => void runAction(() => window.electron.writeback.retryFailed(activeRun?.id || 0), '失败项已重试。')}>
            重试失败项
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前项目', value: currentNovel?.title || '未命名小说' },
            { label: '当前章节', value: centerData?.chapter ? `第${centerData.chapter.chapterNum}章 ${centerData.chapter.title || ''}`.trim() : '未选择' },
            { label: '当前运行', value: activeRun ? `#${activeRun.id}` : '暂无' },
            { label: '运行状态', value: activeRun ? runStatusLabel(activeRun.status) : '未生成' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="事实抽取" value={centerData?.extracts.length || 0} tone="cool" />
          <WorkspaceMetric label="回写候选" value={centerData?.diffs.length || 0} />
          <WorkspaceMetric label="待确认" value={(centerData?.diffs || []).filter((item) => item.canonDecision === 'pending').length} tone="warm" />
          <WorkspaceMetric label="已写回" value={(centerData?.diffs || []).filter((item) => item.writebackStatus === 'applied').length} />
          <WorkspaceMetric label="失败项" value={(centerData?.diffs || []).filter((item) => item.writebackStatus === 'failed').length} tone="warm" />
        </>
      )}
    >
      {chapters.length <= 0 ? (
        <Alert showIcon type="info" message="当前还没有章节" description="先去结构规划或正文写作创建章节，再进入章后状态回写中心。" />
      ) : null}

      <div style={{ display: 'grid', gap: 16 }}>
        <WorkspacePanel title="运行与筛选" description="回写中心按章节和运行批次查看。">
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Select
              value={centerData?.chapter?.id}
              placeholder="选择章节"
              options={chapters.map((chapter) => ({ value: chapter.id, label: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim() }))}
              onChange={(value) => void refresh(Number(value), null)}
            />
            <Select
              value={activeRun?.id}
              placeholder="选择运行"
              options={(centerData?.runs || []).map((run) => ({
                value: run.id,
                label: `#${run.id} · ${runStatusLabel(run.status)} · ${run.triggerSource}`,
              }))}
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
          </div>
          {activeRun ? (
            <div style={{ marginTop: 12 }}>
              <Tag color={runStatusColor(activeRun.status)}>{runStatusLabel(activeRun.status)}</Tag>
              <span style={{ color: '#6b7280' }}>{activeRun.summaryText || '当前运行暂无摘要。'}</span>
            </div>
          ) : (
            <Alert style={{ marginTop: 12 }} type="info" showIcon message="当前章节还没有回写运行" description="点击“重新抽取”后，会先生成事实抽取和状态候选，再进入人工确认。" />
          )}
        </WorkspacePanel>

        <WorkspacePanel title="八类资产覆盖" description="即使当前章没有命中某类资产，这里也会保持统一分组。">
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {ALL_ASSET_TYPES.map((assetType) => {
              const item = coverageMap.get(assetType)
              return (
                <div key={assetType} className="novel-panel" style={{ padding: 12, display: 'grid', gap: 6 }}>
                  <strong>{assetLabel(assetType)}</strong>
                  <span>{`抽取 ${item?.extractCount || 0} 条`}</span>
                  <span>{`候选 ${item?.diffCount || 0} 条`}</span>
                  <span>{`已确认 ${((item?.acceptedCount || 0) + (item?.editedCount || 0))} 条`}</span>
                  <span>{`已写回 ${item?.appliedCount || 0} 条`}</span>
                </div>
              )
            })}
          </div>
        </WorkspacePanel>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(520px, 1.35fr)' }}>
          <WorkspacePanel title={`事实抽取 · ${filteredExtracts.length}`} description="左侧是从本章正文抽出的结构化事实草案。">
            <div style={{ display: 'grid', gap: 10 }}>
              {filteredExtracts.length > 0 ? filteredExtracts.map((extract) => (
                <div key={extract.id} className="novel-note-list__item" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <strong>{resolveExtractTitle(extract)}</strong>
                    <Tag color="geekblue">{assetLabel(extract.assetType)}</Tag>
                  </div>
                  {extract.sourceText ? <div style={{ color: '#6b7280' }}>{extract.sourceText}</div> : null}
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{prettyJson(extract.factJson)}</pre>
                </div>
              )) : <div className="novel-copy-block">当前筛选下没有事实抽取结果。</div>}
            </div>
          </WorkspacePanel>

          <WorkspacePanel title={`回写候选 · ${filteredDiffs.length}`} description="右侧先确认或编辑，再执行统一写回。">
            <Table<ChapterWritebackDiff>
              rowKey="id"
              loading={loading || actionLoading}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              columns={diffColumns}
              dataSource={filteredDiffs}
              expandable={{
                expandedRowRender: (row) => (
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                    <div>
                      <strong>回写前</strong>
                      <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{prettyJson(row.beforeStateJson)}</pre>
                    </div>
                    <div>
                      <strong>回写后</strong>
                      <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{prettyJson(row.afterStateJson)}</pre>
                    </div>
                  </div>
                ),
              }}
            />
          </WorkspacePanel>
        </div>
      </div>

      <Modal
        title={editingDiff ? `编辑候选 · ${resolveDiffTitle(editingDiff)}` : '编辑候选'}
        open={Boolean(editingDiff)}
        onCancel={closeEditModal}
        onOk={() => {
          if (!editingDiff) return
          void runAction(
            () => window.electron.writeback.updateDecision(editingDiff.id, {
              canonDecision: 'edited',
              afterStateJson: editingAfterState,
              diffReason: editingReason,
            }),
            '候选已更新。',
          ).then(closeEditModal)
        }}
        width={860}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Input value={editingReason} onChange={(event) => setEditingReason(event.target.value)} placeholder="补充这条候选为什么需要回写" />
          <Input.TextArea value={editingAfterState} onChange={(event) => setEditingAfterState(event.target.value)} rows={18} placeholder="编辑 afterState JSON" />
        </div>
      </Modal>
    </WorkspacePage>
  )
}
