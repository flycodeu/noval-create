import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Select, Tag, message } from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import type {
  BatchInspectionCategory,
  BatchInspectionStatus,
  BatchRollbackImpactPreview,
  BatchRollbackMode,
  BatchWorkbenchData,
  GlobalLockLibrary,
} from '../../../types'
import type { WorkspaceActionContract } from '../../../components/novel/workspace-layout/workspace-chrome-contract'
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

const IMPACT_LABELS: Record<string, string> = {
  chapters: '章节',
  chapterVersions: '章节版本',
  chapterSegments: '场景段落',
  chapterContracts: '章节合同',
  sceneContracts: '场景合同',
  chapterGateRuns: '章节门记录',
  chapterRecallRuntimeSnapshots: '召回快照',
  antiAiRuleHits: '反 AI 命中',
  chapterWritebackRuns: '回写运行',
  chapterFactExtracts: '事实抽取',
  chapterWritebackDiffs: '回写 Diff',
  characterStateVersions: '人物状态',
  worldStateVersions: '世界状态',
  revisionTasks: '修订任务',
  storyThreads: '故事线程',
  storyFacts: '谜题信息',
  timelineEvents: '时间轴事件',
  storyItems: '物品',
  characterRelations: '人物关系',
  foreshadowLedger: '伏笔账本',
}

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

function snapshotStatusLabel(status?: BatchWorkbenchData['snapshots'][number]['status']) {
  if (status === 'completed') return '已完成'
  if (status === 'rolled_back') return '已回滚'
  if (status === 'active') return '当前批次'
  return '未记录'
}

function inspectionStatusColor(status: BatchInspectionStatus): string {
  if (status === 'pass') return 'success'
  if (status === 'warning') return 'warning'
  return 'error'
}

function inspectionStatusLabel(status: BatchInspectionStatus): string {
  return INSPECTION_STATUS_OPTIONS.find((item) => item.value === status)?.label || '阻断'
}

function inspectionCategoryLabel(category: BatchInspectionCategory): string {
  return INSPECTION_CATEGORY_OPTIONS.find((item) => item.value === category)?.label || '检查'
}

function rollbackModeLabel(mode?: BatchRollbackMode): string {
  return ROLLBACK_MODE_OPTIONS.find((item) => item.value === mode)?.label || '未执行'
}

function rollbackModeDetail(mode: BatchRollbackMode): string {
  return ROLLBACK_MODE_OPTIONS.find((item) => item.value === mode)?.detail || ''
}

function lockEntryCount(lock?: GlobalLockLibrary | null): number {
  if (!lock) return 0
  return lock.lockedCanonFacts.length + lock.lockedParagraphs.length + lock.lockedStyleRules.length + lock.lockedCharacterVoice.length
}

function impactCountLabel(key: string): string {
  return IMPACT_LABELS[key] || key
}

function formatSnapshotRange(snapshot: BatchWorkbenchData['snapshots'][number]): string {
  if (snapshot.chapterStart && snapshot.chapterEnd) return `第 ${snapshot.chapterStart}–${snapshot.chapterEnd} 章`
  return `${snapshot.chapterNums.length} 章`
}

function ImpactSummary({ preview, compact = false }: { preview: BatchRollbackImpactPreview; compact?: boolean }) {
  return (
    <div className={`novel-batch-workbench__impact-summary${compact ? ' is-compact' : ''}`}>
      <div className="novel-batch-workbench__impact-heading">
        <div>
          <span className="novel-batch-workbench__kicker">预演范围</span>
          <strong>{`${rollbackModeLabel(preview.mode)} · 影响 ${preview.chapterCount} 章`}</strong>
        </div>
        <Tag color="warning">执行前仍需确认</Tag>
      </div>
      <div className="novel-batch-workbench__impact-chapters">
        {preview.affectedChapters.map((chapter) => (
          <span key={chapter.chapterId}>{`第 ${chapter.chapterNum} 章 ${chapter.title}`}</span>
        ))}
      </div>
      <div className="novel-batch-workbench__impact-counts">
        {Object.entries(preview.affectedCounts).map(([key, value]) => (
          <span key={key}><b>{value}</b>{impactCountLabel(key)}</span>
        ))}
      </div>
      {preview.warnings.length > 0 ? (
        <div className="novel-batch-workbench__impact-warnings">
          {preview.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      ) : null}
    </div>
  )
}

export default function BatchWorkbench({ novelId }: Props) {
  const [loading, setLoading] = useState(true)
  const [savingLocks, setSavingLocks] = useState(false)
  const [submittingInspection, setSubmittingInspection] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [rollbackLoading, setRollbackLoading] = useState(false)
  const [data, setData] = useState<BatchWorkbenchData | null>(null)
  const [inspectionCategory, setInspectionCategory] = useState<BatchInspectionCategory>('continuity')
  const [inspectionStatus, setInspectionStatus] = useState<BatchInspectionStatus>('warning')
  const [inspectionChapterNum, setInspectionChapterNum] = useState<number | undefined>(undefined)
  const [inspectionNote, setInspectionNote] = useState('')
  const [rollbackMode, setRollbackMode] = useState<BatchRollbackMode>('chapter_rollback')
  const [rollbackPreview, setRollbackPreview] = useState<BatchRollbackImpactPreview | null>(null)
  const [lockDraft, setLockDraft] = useState<GlobalLockLibrary | null>(null)
  const loadRequestRef = useRef(0)

  const loadData = useCallback(async (snapshotId?: number) => {
    const requestId = ++loadRequestRef.current
    setLoading(true)
    try {
      const result = await window.electron.batchWorkbench.getData(novelId, snapshotId)
      if (loadRequestRef.current !== requestId) return
      setData(result)
      setRollbackPreview(null)
      setLockDraft(result.globalLockLibrary)
    } catch (error) {
      if (loadRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false)
    }
  }, [novelId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const activeSnapshot = data?.activeSnapshot || null
  const chapterOptions = useMemo(
    () => (activeSnapshot?.chapterNums || []).map((chapterNum) => ({ label: `第 ${chapterNum} 章`, value: chapterNum })),
    [activeSnapshot],
  )
  const lockCount = lockEntryCount(lockDraft)
  const hasPreviewForCurrentMode = Boolean(rollbackPreview && rollbackPreview.mode === rollbackMode)

  useEffect(() => {
    if (!activeSnapshot) {
      setInspectionChapterNum(undefined)
      return
    }
    if (typeof inspectionChapterNum === 'number' && activeSnapshot.chapterNums.includes(inspectionChapterNum)) return
    setInspectionChapterNum(activeSnapshot.chapterNums[0])
  }, [activeSnapshot, inspectionChapterNum])

  const handleSaveLocks = useCallback(async () => {
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
  }, [activeSnapshot?.id, loadData, lockDraft, novelId])

  const handleCreateInspection = useCallback(async () => {
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
  }, [activeSnapshot, inspectionCategory, inspectionChapterNum, inspectionNote, inspectionStatus, loadData])

  const handlePreviewRollback = useCallback(async () => {
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
  }, [activeSnapshot, rollbackMode])

  const handleRollbackModeChange = useCallback((value: BatchRollbackMode) => {
    setRollbackMode(value)
    setRollbackPreview(null)
  }, [])

  const handleApplyRollback = useCallback(() => {
    if (!activeSnapshot || !rollbackPreview || rollbackPreview.mode !== rollbackMode) return
    const preview = rollbackPreview
    Modal.confirm({
      title: '确认执行危险回滚',
      width: 720,
      icon: <ExclamationCircleOutlined />,
      content: (
        <div className="novel-batch-workbench__confirmation" data-batch-danger-confirmation>
          <p>这是不可通过“撤销”恢复的批次恢复动作。请确认下面的完整影响范围后继续：</p>
          <ImpactSummary preview={preview} />
        </div>
      ),
      okText: '我已了解影响，执行回滚',
      cancelText: '取消',
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
  }, [activeSnapshot, loadData, rollbackMode, rollbackPreview])

  const setLockField = useCallback((field: keyof Pick<GlobalLockLibrary, 'lockedCanonFacts' | 'lockedParagraphs' | 'lockedStyleRules' | 'lockedCharacterVoice'>, value: string) => {
    setLockDraft((current) => ({
      ...(current || { novelId, lockedCanonFacts: [], lockedParagraphs: [], lockedStyleRules: [], lockedCharacterVoice: [], updatedAt: '' }),
      [field]: parseLines(value),
    }))
  }, [novelId])

  const actionContract = useMemo<WorkspaceActionContract>(() => ({
    primary: {
      key: 'preview-rollback',
      label: activeSnapshot ? '生成影响预演' : '刷新批次状态',
      icon: activeSnapshot ? <RollbackOutlined /> : <ReloadOutlined />,
      loading: activeSnapshot ? previewLoading : loading,
      disabled: false,
      onClick: activeSnapshot ? () => void handlePreviewRollback() : () => void loadData(),
    },
    secondary: [
      {
        key: 'save-locks',
        label: '保存全局锁定',
        icon: <SaveOutlined />,
        loading: savingLocks,
        disabled: !lockDraft,
        onClick: () => void handleSaveLocks(),
      },
      {
        key: 'refresh',
        label: '刷新批次状态',
        icon: <ReloadOutlined />,
        loading,
        onClick: () => void loadData(activeSnapshot?.id),
      },
    ],
  }), [activeSnapshot, handlePreviewRollback, handleSaveLocks, loadData, loading, lockDraft, previewLoading, savingLocks])

  return (
    <WorkspacePage
      className="novel-batch-workbench-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="正文生产 / 安全恢复"
      title="批次回滚工作台"
      description="只围绕当前批次做恢复决策；锁定库、检查记录和历史放进诊断层，危险影响必须先预演再确认。"
      chrome="shared"
      actionContract={actionContract}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前批次', value: activeSnapshot?.title || '暂无批次快照' },
            { label: '批次状态', value: activeSnapshot ? snapshotStatusLabel(activeSnapshot.status) : '等待批量生成' },
            { label: '章节范围', value: activeSnapshot ? formatSnapshotRange(activeSnapshot) : '—' },
            { label: '恢复准备', value: hasPreviewForCurrentMode ? `${rollbackModeLabel(rollbackMode)} 已预演` : '尚未预演' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="批次快照" value={data?.snapshots.length || 0} />
          <WorkspaceMetric label="当前章节" value={activeSnapshot?.chapterNums.length || 0} tone="cool" />
          <WorkspaceMetric label="锁定条目" value={lockCount} tone="warm" />
          <WorkspaceMetric label="检查/回滚" value={`${data?.inspections.length || 0}/${data?.rollbacks.length || 0}`} />
        </>
      )}
    >
      <div data-batch-workbench-page data-batch-responsibility="single-current-batch" className="novel-batch-workbench__body">
        {loading ? <div className="novel-batch-workbench__syncing" role="status"><ReloadOutlined spin />正在读取当前批次状态</div> : null}

        <WorkspacePanel
          className="novel-batch-workbench__current-panel"
          title="当前批次"
          description={activeSnapshot ? '当前批次是唯一默认工作对象；恢复动作紧接在下方。' : '批次快照由章节批量生成流程自动创建。'}
          extra={activeSnapshot ? <Tag color={snapshotStatusColor(activeSnapshot.status)}>{snapshotStatusLabel(activeSnapshot.status)}</Tag> : null}
        >
          {activeSnapshot ? (
            <div data-batch-current className="novel-batch-workbench__current">
              <div className="novel-batch-workbench__current-heading">
                <div>
                  <span className="novel-batch-workbench__kicker">唯一当前对象</span>
                  <h2>{activeSnapshot.title}</h2>
                  <p>{activeSnapshot.summary}</p>
                </div>
                <div className="novel-batch-workbench__current-badge">
                  <SafetyCertificateOutlined />
                  <span>{activeSnapshot.latestTaskStatus ? `任务 ${activeSnapshot.latestTaskStatus}` : '快照已保留'}</span>
                </div>
              </div>
              <div className="novel-batch-workbench__current-facts">
                <div><span>覆盖章节</span><strong>{activeSnapshot.chapterNums.join('、')}</strong></div>
                <div><span>创建时间</span><strong>{activeSnapshot.createdAt}</strong></div>
                <div><span>检查记录</span><strong>{data?.inspections.length || 0} 条</strong></div>
                <div><span>历史回滚</span><strong>{data?.rollbacks.length || 0} 次</strong></div>
              </div>
              {activeSnapshot.latestTaskMessage ? <Alert type="info" showIcon message="最近任务状态" description={activeSnapshot.latestTaskMessage} /> : null}
              <div className="novel-batch-workbench__current-strip">
                <span><SafetyCertificateOutlined /> 全局锁定库：{lockCount > 0 ? `${lockCount} 条规则已锁定` : '尚未设置条目'}</span>
                <span><CheckCircleOutlined /> 恢复准备：{hasPreviewForCurrentMode ? '已有当前模式预演' : '请先生成影响预演'}</span>
              </div>
            </div>
          ) : (
            <div data-batch-current className="novel-batch-workbench__empty-current">
              <div className="novel-batch-workbench__empty-mark">◌</div>
              <div>
                <strong>当前没有批次快照</strong>
                <p>先运行章节批量生成，系统会在批次启动时自动保存快照；这里不会伪造可恢复批次。</p>
              </div>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新批次状态</Button>
            </div>
          )}
        </WorkspacePanel>

        {activeSnapshot ? (
          <WorkspacePanel
            className="novel-batch-workbench__recovery-panel"
            title="恢复动作"
            description="默认建议先生成影响预演；只有预演与当前模式一致时，危险执行按钮才会解锁。"
            extra={<Tag color="gold">先预演 · 后确认</Tag>}
          >
            <div data-batch-recovery className="novel-batch-workbench__recovery">
              <div className="novel-batch-workbench__recovery-intro">
                <div>
                  <span className="novel-batch-workbench__kicker">安全恢复入口</span>
                  <strong>{rollbackModeLabel(rollbackMode)}</strong>
                  <p>{rollbackModeDetail(rollbackMode)}</p>
                </div>
                <div className="novel-batch-workbench__recovery-mode">
                  <span>恢复级别</span>
                  <Select
                    className="novel-batch-workbench__mode-select"
                    value={rollbackMode}
                    options={ROLLBACK_MODE_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                    onChange={(value: BatchRollbackMode) => handleRollbackModeChange(value)}
                  />
                </div>
              </div>
              <div className="novel-batch-workbench__recovery-actions">
                <Button icon={<RollbackOutlined />} loading={previewLoading} onClick={() => void handlePreviewRollback()}>
                  生成影响预演
                </Button>
                <Button
                  danger
                  type="primary"
                  icon={<ExclamationCircleOutlined />}
                  disabled={!hasPreviewForCurrentMode}
                  loading={rollbackLoading}
                  onClick={handleApplyRollback}
                >
                  执行回滚
                </Button>
              </div>
              {hasPreviewForCurrentMode && rollbackPreview ? (
                <div data-batch-impact-preview>
                  <Alert type="warning" showIcon message="影响预演已生成：请阅读范围和数量" />
                  <ImpactSummary preview={rollbackPreview} />
                </div>
              ) : (
                <div className="novel-batch-workbench__preview-placeholder">
                  <span>尚未生成当前恢复级别的影响预演</span>
                  <small>执行按钮会保持锁定，避免沿用其他恢复级别的旧结果。</small>
                </div>
              )}
            </div>
          </WorkspacePanel>
        ) : null}

        <div className="novel-batch-workbench__diagnostics" data-batch-diagnostics>
          <details data-batch-locks className="novel-batch-workbench__disclosure">
            <summary>
              <span className="novel-batch-workbench__summary-main"><span className="novel-batch-workbench__summary-index">01</span><strong>全局锁定库</strong></span>
              <span className="novel-batch-workbench__summary-meta">{lockCount ? `${lockCount} 条锁定规则` : '尚未设置'} · 按需编辑</span>
            </summary>
            <div className="novel-batch-workbench__disclosure-content">
              <div className="novel-batch-workbench__lock-note"><SafetyCertificateOutlined /><span>锁定内容会进入后续批次的上下文约束，不会被自动重写覆盖。修改后请保存。</span></div>
              <div className="novel-batch-workbench__lock-grid">
                <label><span>锁定事实</span><Input.TextArea rows={5} value={toLines(lockDraft?.lockedCanonFacts || [])} onChange={(event) => setLockField('lockedCanonFacts', event.target.value)} placeholder="一行一条，例如：主角左臂有旧伤，第三卷前不能痊愈。" /></label>
                <label><span>锁定段落</span><Input.TextArea rows={5} value={toLines(lockDraft?.lockedParagraphs || [])} onChange={(event) => setLockField('lockedParagraphs', event.target.value)} placeholder="保留关键原文或不可改写的段落摘要。" /></label>
                <label><span>锁定风格</span><Input.TextArea rows={5} value={toLines(lockDraft?.lockedStyleRules || [])} onChange={(event) => setLockField('lockedStyleRules', event.target.value)} placeholder="一行一条，例如：战斗描写短句推进。" /></label>
                <label><span>角色口吻</span><Input.TextArea rows={5} value={toLines(lockDraft?.lockedCharacterVoice || [])} onChange={(event) => setLockField('lockedCharacterVoice', event.target.value)} placeholder="一行一条，例如：林骁说话冷短句。" /></label>
              </div>
              <div className="novel-batch-workbench__disclosure-actions"><Button type="primary" icon={<SaveOutlined />} loading={savingLocks} onClick={() => void handleSaveLocks()}>保存全局锁定</Button></div>
            </div>
          </details>

          <details data-batch-inspections className="novel-batch-workbench__disclosure">
            <summary>
              <span className="novel-batch-workbench__summary-main"><span className="novel-batch-workbench__summary-index">02</span><strong>批次检查</strong></span>
              <span className="novel-batch-workbench__summary-meta">{data?.inspections.length || 0} 条记录 · 按需登记</span>
            </summary>
            <div className="novel-batch-workbench__disclosure-content">
              {activeSnapshot ? (
                <>
                  <div className="novel-batch-workbench__inspection-toolbar">
                    <Select value={inspectionCategory} options={INSPECTION_CATEGORY_OPTIONS} onChange={(value: BatchInspectionCategory) => setInspectionCategory(value)} />
                    <Select value={inspectionStatus} options={INSPECTION_STATUS_OPTIONS} onChange={(value: BatchInspectionStatus) => setInspectionStatus(value)} />
                    <Select allowClear value={inspectionChapterNum} options={chapterOptions} onChange={(value: number | undefined) => setInspectionChapterNum(value)} placeholder="可选：指定章节" />
                  </div>
                  <Input.TextArea rows={4} value={inspectionNote} onChange={(event) => setInspectionNote(event.target.value)} placeholder="记录本批是否能继续，哪里需要改，哪些点必须锁住。" />
                  <div className="novel-batch-workbench__disclosure-actions"><Button type="primary" loading={submittingInspection} onClick={() => void handleCreateInspection()}>保存检查记录</Button></div>
                  <div className="novel-batch-workbench__record-list">
                    {(data?.inspections || []).map((record) => (
                      <article key={record.id} className="novel-batch-workbench__record">
                        <div className="novel-batch-workbench__record-head"><strong>{record.chapterNum ? `第 ${record.chapterNum} 章` : '整批'}</strong><Tag color={inspectionStatusColor(record.status)}>{inspectionStatusLabel(record.status)}</Tag></div>
                        <div className="novel-batch-workbench__record-meta">{`${inspectionCategoryLabel(record.category)} · ${record.createdAt}`}</div>
                        <p>{record.note}</p>
                      </article>
                    ))}
                    {(data?.inspections.length || 0) === 0 ? <Empty description="当前还没有人工批次检查记录。" /> : null}
                  </div>
                </>
              ) : <Empty description="需要先产生批次快照，才能登记检查记录。" />}
            </div>
          </details>

          <details data-batch-history className="novel-batch-workbench__disclosure">
            <summary>
              <span className="novel-batch-workbench__summary-main"><span className="novel-batch-workbench__summary-index">03</span><strong>批次与回滚历史</strong></span>
              <span className="novel-batch-workbench__summary-meta">{data?.snapshots.length || 0} 个批次 · {data?.rollbacks.length || 0} 次回滚 · 按需查看</span>
            </summary>
            <div className="novel-batch-workbench__disclosure-content">
              <div className="novel-batch-workbench__history-section">
                <div className="novel-batch-workbench__history-heading"><span className="novel-batch-workbench__kicker">批次快照</span><span>点击切换当前对象</span></div>
                {(data?.snapshots || []).map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    data-batch-snapshot-id={snapshot.id}
                    className={`novel-batch-workbench__snapshot${snapshot.id === activeSnapshot?.id ? ' is-active' : ''}`}
                    onClick={() => void loadData(snapshot.id)}
                  >
                    <span className="novel-batch-workbench__snapshot-copy"><strong>{snapshot.title}</strong><span>{`${formatSnapshotRange(snapshot)} · ${snapshot.createdAt}`}</span></span>
                    <Tag color={snapshotStatusColor(snapshot.status)}>{snapshotStatusLabel(snapshot.status)}</Tag>
                  </button>
                ))}
                {(data?.snapshots.length || 0) === 0 ? <Empty description="当前还没有批次快照。" /> : null}
              </div>
              <div className="novel-batch-workbench__history-section">
                <div className="novel-batch-workbench__history-heading"><span className="novel-batch-workbench__kicker">回滚记录</span><span>当前批次</span></div>
                {(data?.rollbacks || []).map((rollback) => (
                  <article key={rollback.id} className="novel-batch-workbench__record">
                    <div className="novel-batch-workbench__record-head"><strong>{rollbackModeLabel(rollback.mode)}</strong><Tag color="gold">{rollback.createdAt}</Tag></div>
                    <p>{rollback.summary}</p>
                  </article>
                ))}
                {(data?.rollbacks.length || 0) === 0 ? <Empty description="当前快照还没有执行过回滚。" /> : null}
              </div>
            </div>
          </details>
        </div>
      </div>
    </WorkspacePage>
  )
}
