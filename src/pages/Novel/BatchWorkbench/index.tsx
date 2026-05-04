import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Select, Space, Tag, message } from 'antd'
import {
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import type {
  BatchInspectionCategory,
  BatchInspectionStatus,
  BatchRollbackMode,
  BatchWorkbenchData,
  GlobalLockLibrary,
} from '../../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import './index.css'

interface Props {
  novelId: number
}

const INSPECTION_CATEGORY_OPTIONS: Array<{ label: string; value: BatchInspectionCategory }> = [
  { label: '流程', value: 'flow' },
  { label: 'AI 味', value: 'ai' },
  { label: '角色口吻', value: 'voice' },
  { label: '线程推进', value: 'thread' },
  { label: '追读钩子', value: 'hook' },
  { label: '连续性', value: 'continuity' },
]

const INSPECTION_STATUS_OPTIONS: Array<{ label: string; value: BatchInspectionStatus }> = [
  { label: '通过', value: 'pass' },
  { label: '预警', value: 'warning' },
  { label: '阻断', value: 'blocked' },
]

const ROLLBACK_MODE_OPTIONS: Array<{ label: string; value: BatchRollbackMode; detail: string }> = [
  { label: '单章回滚', value: 'chapter_rollback', detail: '仅恢复批次内章节正文与章级衍生记录。' },
  { label: '批次内容回滚', value: 'batch_content_rollback', detail: '恢复正文、合同、回写草稿与本批章节状态。' },
  { label: '批次全量回滚', value: 'batch_full_rollback', detail: '恢复正文、状态以及全书线程/物品/时间轴等快照。' },
]

function toLines(value: string[]): string {
  return value.join('\n')
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function snapshotStatusColor(status?: BatchWorkbenchData['snapshots'][number]['status']) {
  if (status === 'completed') return 'success'
  if (status === 'rolled_back') return 'warning'
  return 'processing'
}

function inspectionStatusColor(status: BatchInspectionStatus): string {
  if (status === 'pass') return 'success'
  if (status === 'warning') return 'warning'
  return 'error'
}

function rollbackModeLabel(mode?: BatchRollbackMode): string {
  return ROLLBACK_MODE_OPTIONS.find((item) => item.value === mode)?.label || '未执行'
}

export default function BatchWorkbench({ novelId }: Props) {
  const [loading, setLoading] = useState(true)
  const [savingLocks, setSavingLocks] = useState(false)
  const [submittingInspection, setSubmittingInspection] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [rollbackLoading, setRollbackLoading] = useState(false)
  const [data, setData] = useState<BatchWorkbenchData | null>(null)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | undefined>(undefined)
  const [inspectionCategory, setInspectionCategory] = useState<BatchInspectionCategory>('continuity')
  const [inspectionStatus, setInspectionStatus] = useState<BatchInspectionStatus>('warning')
  const [inspectionChapterNum, setInspectionChapterNum] = useState<number | undefined>(undefined)
  const [inspectionNote, setInspectionNote] = useState('')
  const [rollbackMode, setRollbackMode] = useState<BatchRollbackMode>('chapter_rollback')
  const [rollbackPreview, setRollbackPreview] = useState<Awaited<ReturnType<typeof window.electron.batchWorkbench.previewRollback>> | null>(null)
  const [lockDraft, setLockDraft] = useState<GlobalLockLibrary | null>(null)

  const loadData = useCallback(async (snapshotId = selectedSnapshotId) => {
    setLoading(true)
    try {
      const result = await window.electron.batchWorkbench.getData(novelId, snapshotId)
      setData(result)
      setSelectedSnapshotId(result.activeSnapshot?.id)
      setRollbackPreview(null)
      setLockDraft(result.globalLockLibrary)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [novelId, selectedSnapshotId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const activeSnapshot = data?.activeSnapshot
    if (!activeSnapshot) return
    if (typeof inspectionChapterNum === 'number' && activeSnapshot.chapterNums.includes(inspectionChapterNum)) return
    setInspectionChapterNum(activeSnapshot.chapterNums[0])
  }, [data?.activeSnapshot, inspectionChapterNum])

  const activeSnapshot = data?.activeSnapshot || null
  const chapterOptions = useMemo(
    () => (activeSnapshot?.chapterNums || []).map((chapterNum) => ({ label: `第 ${chapterNum} 章`, value: chapterNum })),
    [activeSnapshot],
  )

  const handleSaveLocks = async () => {
    if (!lockDraft) return
    setSavingLocks(true)
    try {
      const result = await window.electron.batchWorkbench.updateGlobalLockLibrary(novelId, {
        lockedCanonFacts: lockDraft.lockedCanonFacts,
        lockedParagraphs: lockDraft.lockedParagraphs,
        lockedStyleRules: lockDraft.lockedStyleRules,
        lockedCharacterVoice: lockDraft.lockedCharacterVoice,
      })
      setLockDraft(result)
      await loadData(activeSnapshot?.id)
      message.success(getUserFacingMessage('batchWorkbench.lockLibrarySaved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSavingLocks(false)
    }
  }

  const handleCreateInspection = async () => {
    if (!activeSnapshot) return
    if (!inspectionNote.trim()) {
      message.warning(getUserFacingMessage('batchWorkbench.inspectionNoteRequired'))
      return
    }
    setSubmittingInspection(true)
    try {
      await window.electron.batchWorkbench.createInspection(activeSnapshot.id, {
        chapterNum: inspectionChapterNum,
        category: inspectionCategory,
        status: inspectionStatus,
        note: inspectionNote.trim(),
      })
      setInspectionNote('')
      await loadData(activeSnapshot.id)
      message.success(getUserFacingMessage('batchWorkbench.inspectionSaved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSubmittingInspection(false)
    }
  }

  const handlePreviewRollback = async () => {
    if (!activeSnapshot) return
    setPreviewLoading(true)
    try {
      const result = await window.electron.batchWorkbench.previewRollback(activeSnapshot.id, rollbackMode)
      setRollbackPreview(result)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleApplyRollback = async () => {
    if (!activeSnapshot) return
    Modal.confirm({
      title: '确认执行回滚',
      content: rollbackPreview?.warnings[0] || '该操作会直接恢复快照状态。',
      okText: '执行回滚',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRollbackLoading(true)
        try {
          await window.electron.batchWorkbench.applyRollback(activeSnapshot.id, rollbackMode)
          await loadData(activeSnapshot.id)
          message.success(getUserFacingMessage('batchWorkbench.rollbackApplied'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.saveFailed'))
        } finally {
          setRollbackLoading(false)
        }
      },
    })
  }

  return (
    <WorkspacePage
      title="回滚工作台"
      description="为章节批量生成保留批次快照、人工检查记录、作者锁定库和三档回滚入口。"
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadData(activeSnapshot?.id)}>
            刷新
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={savingLocks} onClick={() => void handleSaveLocks()}>
            保存全局锁定
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '快照数', value: data?.snapshots.length || 0 },
            { label: '当前快照', value: activeSnapshot?.title || '未选择' },
            { label: '最近回滚', value: activeSnapshot?.latestRollbackMode ? rollbackModeLabel(activeSnapshot.latestRollbackMode) : '暂无' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="批次快照" value={data?.snapshots.length || 0} />
          <WorkspaceMetric label="检查记录" value={data?.inspections.length || 0} tone="warm" />
          <WorkspaceMetric label="回滚记录" value={data?.rollbacks.length || 0} />
          <WorkspaceMetric label="锁定事实" value={lockDraft?.lockedCanonFacts.length || 0} tone="cool" />
        </>
      )}
    >
      {loading ? (
        <WorkspacePanel title="正在加载工作台">
          <div>正在读取批次快照、检查记录和作者锁定库。</div>
        </WorkspacePanel>
      ) : null}

      {!loading && !activeSnapshot ? (
        <WorkspacePanel title="当前没有批次快照">
          <Empty description="先运行章节批量生成，系统会在批次启动时自动保存快照。" />
        </WorkspacePanel>
      ) : null}

      {activeSnapshot ? (
        <WorkspacePanel title="批次快照" description="选择一个批次快照进行检查、预演或回滚。">
          <div className="novel-batch-workbench__snapshot-layout">
            <div className="novel-batch-workbench__snapshot-list">
              {(data?.snapshots || []).map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => void loadData(snapshot.id)}
                  className={`novel-batch-workbench__snapshot-button${snapshot.id === activeSnapshot.id ? ' is-active' : ''}`}
                >
                  <div className="novel-batch-workbench__snapshot-head">
                    <strong>{snapshot.title}</strong>
                    <Tag color={snapshotStatusColor(snapshot.status)}>{snapshot.status}</Tag>
                  </div>
                  <div className="novel-batch-workbench__snapshot-summary">{snapshot.summary}</div>
                  <div className="novel-batch-workbench__snapshot-meta">
                    {`范围 ${snapshot.chapterStart || '-'} - ${snapshot.chapterEnd || '-'} · 创建于 ${snapshot.createdAt}`}
                  </div>
                </button>
              ))}
            </div>
            <div className="novel-batch-workbench__snapshot-detail">
              <Alert
                type={activeSnapshot.status === 'rolled_back' ? 'warning' : 'info'}
                showIcon
                message={activeSnapshot.summary}
                description={activeSnapshot.latestTaskMessage || `当前快照覆盖 ${activeSnapshot.chapterNums.length} 章。`}
              />
              <div className="novel-batch-workbench__tag-row">
                <Tag color="blue">{`章节 ${activeSnapshot.chapterNums.join('、')}`}</Tag>
                {activeSnapshot.workflowTaskId ? <Tag color="cyan">{`任务 #${activeSnapshot.workflowTaskId}`}</Tag> : null}
                {activeSnapshot.latestRollbackMode ? <Tag color="gold">{rollbackModeLabel(activeSnapshot.latestRollbackMode)}</Tag> : null}
              </div>
            </div>
          </div>
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="全局锁定库" description="把作者明确锁住、不能被自动重写改掉的事实、段落、风格和角色口吻写在这里。">
        <div className="novel-batch-workbench__lock-grid">
          <div>
            <strong className="novel-batch-workbench__field-title">锁定事实</strong>
            <Input.TextArea
              rows={6}
              value={toLines(lockDraft?.lockedCanonFacts || [])}
              onChange={(event) => setLockDraft((current) => ({
                ...(current || { novelId, lockedCanonFacts: [], lockedParagraphs: [], lockedStyleRules: [], lockedCharacterVoice: [], updatedAt: '' }),
                lockedCanonFacts: parseLines(event.target.value),
              }))}
              placeholder="一行一条，例如：主角左臂有旧伤，第三卷前不能痊愈。"
            />
          </div>
          <div>
            <strong className="novel-batch-workbench__field-title">锁定段落</strong>
            <Input.TextArea
              rows={6}
              value={toLines(lockDraft?.lockedParagraphs || [])}
              onChange={(event) => setLockDraft((current) => ({
                ...(current || { novelId, lockedCanonFacts: [], lockedParagraphs: [], lockedStyleRules: [], lockedCharacterVoice: [], updatedAt: '' }),
                lockedParagraphs: parseLines(event.target.value),
              }))}
              placeholder="一行一条，保留关键原文或不可改写的段落摘要。"
            />
          </div>
          <div>
            <strong className="novel-batch-workbench__field-title">锁定风格</strong>
            <Input.TextArea
              rows={6}
              value={toLines(lockDraft?.lockedStyleRules || [])}
              onChange={(event) => setLockDraft((current) => ({
                ...(current || { novelId, lockedCanonFacts: [], lockedParagraphs: [], lockedStyleRules: [], lockedCharacterVoice: [], updatedAt: '' }),
                lockedStyleRules: parseLines(event.target.value),
              }))}
              placeholder="一行一条，例如：战斗描写短句推进，不做抒情总结。"
            />
          </div>
          <div>
            <strong className="novel-batch-workbench__field-title">锁定角色口吻</strong>
            <Input.TextArea
              rows={6}
              value={toLines(lockDraft?.lockedCharacterVoice || [])}
              onChange={(event) => setLockDraft((current) => ({
                ...(current || { novelId, lockedCanonFacts: [], lockedParagraphs: [], lockedStyleRules: [], lockedCharacterVoice: [], updatedAt: '' }),
                lockedCharacterVoice: parseLines(event.target.value),
              }))}
              placeholder="一行一条，例如：林骁说话冷短句，不解释心路。"
            />
          </div>
        </div>
      </WorkspacePanel>

      {activeSnapshot ? (
        <WorkspacePanel title="批次检查" description="在继续下一批前，把本批的人工检查结论登记下来。">
          <div className="novel-batch-workbench__section-stack">
            <div className="novel-batch-workbench__toolbar">
              <Select
                className="novel-batch-workbench__select novel-batch-workbench__select--sm"
                value={inspectionCategory}
                options={INSPECTION_CATEGORY_OPTIONS}
                onChange={(value: BatchInspectionCategory) => setInspectionCategory(value)}
              />
              <Select
                className="novel-batch-workbench__select novel-batch-workbench__select--sm"
                value={inspectionStatus}
                options={INSPECTION_STATUS_OPTIONS}
                onChange={(value: BatchInspectionStatus) => setInspectionStatus(value)}
              />
              <Select
                allowClear
                className="novel-batch-workbench__select novel-batch-workbench__select--md"
                value={inspectionChapterNum}
                options={chapterOptions}
                onChange={(value: number | undefined) => setInspectionChapterNum(value)}
                placeholder="可选：指定章节"
              />
            </div>
            <Input.TextArea
              rows={6}
              value={inspectionNote}
              onChange={(event) => setInspectionNote(event.target.value)}
              placeholder="记录本批是否能继续，哪里需要改，哪些点必须锁住。"
            />
            <div>
              <Button type="primary" loading={submittingInspection} onClick={() => void handleCreateInspection()}>
                保存检查记录
              </Button>
            </div>
            <div className="novel-batch-workbench__record-list">
              {(data?.inspections || []).map((record) => (
                <div key={record.id} className="quality-card">
                  <div className="novel-batch-workbench__record-head">
                    <strong>{record.chapterNum ? `第 ${record.chapterNum} 章` : '整批'}</strong>
                    <Tag color={inspectionStatusColor(record.status)}>{record.status}</Tag>
                  </div>
                  <div className="novel-batch-workbench__record-meta">{`${record.category} · ${record.createdAt}`}</div>
                  <div className="novel-batch-workbench__record-note">{record.note}</div>
                </div>
              ))}
              {(data?.inspections.length || 0) === 0 ? <Empty description="当前还没有人工批次检查记录。" /> : null}
            </div>
          </div>
        </WorkspacePanel>
      ) : null}

      {activeSnapshot ? (
        <WorkspacePanel title="回滚预演与执行" description="先做影响预演，再执行单章、内容或全量回滚。">
          <div className="novel-batch-workbench__section-stack">
            <Select
              value={rollbackMode}
              options={ROLLBACK_MODE_OPTIONS.map((item) => ({ label: `${item.label} · ${item.detail}`, value: item.value }))}
              onChange={(value: BatchRollbackMode) => setRollbackMode(value)}
            />
            <div className="novel-batch-workbench__toolbar">
              <Button icon={<RollbackOutlined />} loading={previewLoading} onClick={() => void handlePreviewRollback()}>
                生成影响预演
              </Button>
              <Button
                danger
                type="primary"
                icon={<RollbackOutlined />}
                disabled={!rollbackPreview}
                loading={rollbackLoading}
                onClick={() => void handleApplyRollback()}
              >
                执行回滚
              </Button>
            </div>
            {rollbackPreview ? (
              <div className="novel-batch-workbench__section-stack">
                <Alert
                  type="warning"
                  showIcon
                  message={`${rollbackModeLabel(rollbackPreview.mode)} · 影响 ${rollbackPreview.chapterCount} 章`}
                  description={rollbackPreview.warnings.join(' ')}
                />
                <div className="quality-card">
                  <strong>将恢复的记录数</strong>
                  <div className="novel-batch-workbench__tag-row novel-batch-workbench__tag-row--spaced">
                    {Object.entries(rollbackPreview.affectedCounts).map(([key, value]) => (
                      <Tag key={key} color="blue">{`${key}: ${value}`}</Tag>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </WorkspacePanel>
      ) : null}

      {activeSnapshot ? (
        <WorkspacePanel title="回滚历史" description="查看该批次已经执行过的回滚记录。">
          <div className="novel-batch-workbench__record-list">
            {(data?.rollbacks || []).map((rollback) => (
              <div key={rollback.id} className="quality-card">
                <div className="novel-batch-workbench__record-head">
                  <strong>{rollbackModeLabel(rollback.mode)}</strong>
                  <Tag color="gold">{rollback.createdAt}</Tag>
                </div>
                <div className="novel-batch-workbench__record-note">{rollback.summary}</div>
              </div>
            ))}
            {(data?.rollbacks.length || 0) === 0 ? <Empty description="当前快照还没有执行过回滚。" /> : null}
          </div>
        </WorkspacePanel>
      ) : null}
    </WorkspacePage>
  )
}
