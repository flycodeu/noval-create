import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd'
import {
  ArrowRightOutlined,
  CompassOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import type {
  CreativeStage,
  CreativeStageAssetBinding,
  CreativeStageAssetInput,
  CreativeStageCreateInput,
  CreativeStageContext,
  CreativeStageHandoffArtifact,
} from '../../../types'
import type { AgentQualityReportContent } from '../../../shared/quality-agent-workflow'
import {
  CREATIVE_STAGE_ASSET_ROLE_OPTIONS,
  CREATIVE_STAGE_ASSET_TYPE_OPTIONS,
  CREATIVE_STAGE_KIND_OPTIONS,
  CREATIVE_STAGE_STATUS_OPTIONS,
  formatCreativeStageRange,
  normalizeCreativeStageHandoffList,
} from '../../../shared/creative-stages'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { getErrorMessage, getUserFacingMessage } from '../../../utils/user-facing-message'
import { useNovelStore } from '../../../stores/novel.store'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceStepGuide,
} from '../components/WorkspaceShell'
import './index.css'

interface Props { novelId: number }

const statusColors: Record<string, string> = {
  planned: 'default',
  active: 'processing',
  locked: 'gold',
  completed: 'success',
  archived: 'default',
}

function stageKindLabel(kind: CreativeStage['kind']) {
  return CREATIVE_STAGE_KIND_OPTIONS.find((item) => item.value === kind)?.label || kind
}

function stageStatusLabel(status: CreativeStage['status']) {
  return CREATIVE_STAGE_STATUS_OPTIONS.find((item) => item.value === status)?.label || status
}

function contextHealthLabel(status?: CreativeStageContext['health']['status']) {
  if (status === 'ready') return '可用于生成'
  if (status === 'stale') return '上下文过期'
  if (status === 'needs_setup') return '需要补齐'
  return '未检查'
}

function contextHealthType(status?: CreativeStageContext['health']['status']): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'ready') return 'success'
  if (status === 'stale') return 'warning'
  if (status === 'needs_setup') return 'error'
  return 'info'
}

function qualityStatusLabel(status?: CreativeStageContext['quality']['status']) {
  if (status === 'healthy') return '阶段证据完整'
  if (status === 'needs_attention') return '需要补证据'
  return '尚未开始'
}

function qualityStatusColor(status?: CreativeStageContext['quality']['status']) {
  if (status === 'healthy') return 'success'
  if (status === 'needs_attention') return 'warning'
  return 'default'
}

function qualityTrendLabel(status?: CreativeStageContext['quality']['trend']['status']) {
  if (status === 'improving') return '趋势改善'
  if (status === 'worsening') return '趋势恶化'
  if (status === 'stable') return '趋势稳定'
  return '证据不足'
}

function qualityTrendColor(status?: CreativeStageContext['quality']['trend']['status']) {
  if (status === 'improving') return 'success'
  if (status === 'worsening') return 'error'
  if (status === 'stable') return 'processing'
  return 'default'
}

function handoffStatusLabel(status?: CreativeStageHandoffArtifact['status'] | 'missing' | 'legacy' | 'stale') {
  if (status === 'approved') return '已确认，进入召回'
  if (status === 'reviewed') return '待作者确认'
  if (status === 'draft') return '草稿'
  if (status === 'rejected') return '审阅未通过'
  if (status === 'superseded') return '已被新版本替代'
  if (status === 'stale') return '交接过期，需重新确认'
  if (status === 'legacy') return '旧文本交接'
  return '尚未建立'
}

type CreativeStageHandoffForm = {
  changes: string
  costs: string
  openQuestions: string
  nextPressure: string
}

type StageQualityReportView = Pick<
  AgentQualityReportContent,
  'status' | 'score' | 'confidenceLowerBound' | 'coverageRate' | 'summary' | 'blockers' | 'warnings' | 'findings'
>

type StageQualityReportHistoryEntry = StageQualityReportView & {
  artifactId: string
  createdAt: string
  contextVersion: number
}

export default function StagePlanner({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [createForm] = Form.useForm<CreativeStageCreateInput>()
  const [assetForm] = Form.useForm<CreativeStageAssetInput>()
  const [handoffForm] = Form.useForm<CreativeStageHandoffForm>()
  const [stages, setStages] = useState<CreativeStage[]>([])
  const [assets, setAssets] = useState<CreativeStageAssetBinding[]>([])
  const [handoffs, setHandoffs] = useState<CreativeStageHandoffArtifact[]>([])
  const [stageContext, setStageContext] = useState<CreativeStageContext | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingStage, setEditingStage] = useState<CreativeStage | null>(null)
  const [saving, setSaving] = useState(false)
  const [qualityRunning, setQualityRunning] = useState(false)
  const [stageQualityReport, setStageQualityReport] = useState<StageQualityReportView | null>(null)
  const [stageQualityReports, setStageQualityReports] = useState<StageQualityReportHistoryEntry[]>([])

  const selectedStage = useMemo(
    () => stages.find((stage) => stage.id === selectedStageId) || stages[0] || null,
    [selectedStageId, stages],
  )
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const nextStages = await window.electron.creativeStage.list(novelId)
      setStages(nextStages)
      setSelectedStageId((current) => current && nextStages.some((stage) => stage.id === current)
        ? current
        : nextStages.find((stage) => stage.status === 'active')?.id || nextStages[0]?.id || null)
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [novelId])

  const loadAssets = useCallback(async (stageId: number | null) => {
    if (!stageId) {
      setAssets([])
      setHandoffs([])
      setStageContext(null)
      return
    }
    try {
      const [context, nextHandoffs] = await Promise.all([
        window.electron.creativeStage.getContext(novelId, stageId),
        window.electron.creativeStage.listHandoffs(novelId, stageId),
      ])
      setStageContext(context)
      setAssets(context.assets)
      setHandoffs(nextHandoffs)
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }
  }, [novelId])

  const loadStageQualityHistory = useCallback(async (stageId: number | null) => {
    if (!stageId) {
      setStageQualityReports([])
      return
    }
    try {
      const listResult = await window.electron.agentTools.call({
        toolId: 'novelforge.artifacts.list',
        input: { novelId, kind: 'quality_report', limit: 100 },
      })
      if (!listResult.ok) return
      const references = (listResult.data as { artifacts?: Array<{ id: string }> }).artifacts || []
      const reports = await Promise.all(references.map(async (reference): Promise<StageQualityReportHistoryEntry | null> => {
        const result = await window.electron.agentTools.call({
          toolId: 'novelforge.artifacts.get',
          input: { artifactId: reference.id },
        })
        if (!result.ok) return null
        const artifact = (result.data as {
          artifact?: {
            id: string
            createdAt: string
            contextVersion: number
            content?: Partial<AgentQualityReportContent>
          }
        }).artifact
        const report = artifact?.content
        if (!artifact || !report || report.scope?.type !== 'stage' || report.scope.stageId !== stageId) return null
        return {
          artifactId: artifact.id,
          createdAt: artifact.createdAt,
          contextVersion: report.contextVersion || artifact.contextVersion,
          status: report.status || 'blocked',
          score: report.score || 0,
          confidenceLowerBound: report.confidenceLowerBound || 0,
          coverageRate: report.coverageRate || 0,
          summary: report.summary || '',
          blockers: report.blockers || [],
          warnings: report.warnings || [],
          findings: report.findings || [],
        }
      }))
      const sorted = reports
        .filter((report): report is StageQualityReportHistoryEntry => Boolean(report))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      setStageQualityReports(sorted)
      setStageQualityReport(sorted[0] || null)
    } catch {
      // 预览模式或旧后端可能没有工件列表能力；不影响阶段正文和门禁读取。
      setStageQualityReports([])
    }
  }, [novelId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadAssets(selectedStage?.id || null) }, [loadAssets, selectedStage?.id])
  useEffect(() => {
    setStageQualityReport(null)
    void loadStageQualityHistory(selectedStage?.id || null)
  }, [loadStageQualityHistory, selectedStage?.id])
  useEffect(() => {
    const handoff = handoffs[0]
    handoffForm.setFieldsValue(handoff ? {
      changes: handoff.content.changes.join('\n'),
      costs: handoff.content.costs.join('\n'),
      openQuestions: handoff.content.openQuestions.join('\n'),
      nextPressure: handoff.content.nextPressure,
    } : { changes: '', costs: '', openQuestions: '', nextPressure: '' })
  }, [handoffForm, handoffs])

  const openStageForm = (stage?: CreativeStage) => {
    setEditingStage(stage || null)
    createForm.setFieldsValue(stage
      ? {
          name: stage.name,
          kind: stage.kind,
          status: stage.status,
          chapterStart: stage.chapterStart,
          chapterEnd: stage.chapterEnd,
          objective: stage.objective,
          storySummary: stage.storySummary,
          handoffSummary: stage.handoffSummary,
        }
      : { kind: 'chapter-window', status: 'planned', name: '', chapterStart: undefined, chapterEnd: undefined, objective: '', storySummary: '', handoffSummary: '' })
    setCreateOpen(true)
  }

  const handleSaveStage = async () => {
    const values = await createForm.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const saved = editingStage
        ? await window.electron.creativeStage.update({ id: editingStage.id, ...values })
        : await window.electron.creativeStage.create(novelId, values)
      setCreateOpen(false)
      createForm.resetFields()
      setEditingStage(null)
      setSelectedStageId(saved.id)
      await load()
      message.success(getUserFacingMessage(editingStage ? 'creativeStage.updated' : 'creativeStage.created'))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (stage: CreativeStage, status: CreativeStage['status']) => {
    try {
      await window.electron.creativeStage.update({ id: stage.id, status })
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleArchive = async (stage: CreativeStage) => {
    try {
      await window.electron.creativeStage.archive(stage.id)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleAddAsset = async () => {
    if (!selectedStage) return
    const values = await assetForm.validateFields().catch(() => null)
    if (!values) return
    try {
      await window.electron.creativeStage.upsertAsset({ ...values, stageId: selectedStage.id })
      assetForm.resetFields()
      await loadAssets(selectedStage.id)
      await load()
      message.success(getUserFacingMessage('creativeStage.assetBound'))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleRemoveAsset = async (assetId: number) => {
    try {
      await window.electron.creativeStage.removeAsset(assetId)
      await loadAssets(selectedStage?.id || null)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleSaveHandoff = async (reviewAfterSave = false) => {
    if (!selectedStage) return
    const values = await handoffForm.validateFields().catch(() => null)
    if (!values) return
    try {
      const draft = await window.electron.creativeStage.createHandoff({
        stageId: selectedStage.id,
        parentArtifactId: handoffs[0]?.id || null,
        changes: normalizeCreativeStageHandoffList(values.changes),
        costs: normalizeCreativeStageHandoffList(values.costs),
        openQuestions: normalizeCreativeStageHandoffList(values.openQuestions),
        nextPressure: values.nextPressure.trim(),
        assetContinuity: [],
      })
      if (reviewAfterSave) {
        await window.electron.creativeStage.reviewHandoff(draft.id)
        message.success(getUserFacingMessage('creativeStage.handoffReviewed'))
      } else {
        message.success(getUserFacingMessage('creativeStage.handoffDraftSaved'))
      }
      await loadAssets(selectedStage.id)
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleReviewHandoff = async () => {
    if (!handoffs[0]) return
    try {
      await window.electron.creativeStage.reviewHandoff(handoffs[0].id)
      await loadAssets(selectedStage?.id || null)
      message.success(getUserFacingMessage('creativeStage.handoffReviewed'))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleApproveHandoff = async () => {
    if (!handoffs[0]) return
    try {
      await window.electron.creativeStage.approveHandoff(handoffs[0].id)
      await loadAssets(selectedStage?.id || null)
      message.success(getUserFacingMessage('creativeStage.handoffApproved'))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleRunStageQuality = async () => {
    if (!selectedStage || !stageContext) return
    setQualityRunning(true)
    try {
      const result = await window.electron.agentTools.call({
        toolId: 'novelforge.quality.run_evaluation',
        input: {
          novelId,
          scopeType: 'stage',
          stageId: selectedStage.id,
          profile: 'longform_health_v1',
          maxFindings: 12,
          idempotencyKey: `stage-quality:${selectedStage.id}:project-${stageContext.packet.projectContextVersion}:stage-${stageContext.packet.stageContextVersion}`,
        },
      })
      if (!result.ok) throw new Error(result.error.message)
      const data = result.data as { report?: StageQualityReportView }
      if (!data.report) throw new Error('质量工具没有返回阶段报告。')
      setStageQualityReport(data.report)
      await loadStageQualityHistory(selectedStage.id)
      message.success('阶段质量评审报告已生成；正文未被修改。')
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setQualityRunning(false)
    }
  }

  const currentStatus = selectedStage ? stageStatusLabel(selectedStage.status) : '尚未建立'
  const activeCount = stages.filter((stage) => stage.status === 'active').length
  const plannedCount = stages.filter((stage) => stage.status === 'planned').length

  return (
    <WorkspacePage
      eyebrow="创作节奏 / STAGE PLANNING"
      title="阶段计划"
      description="把百万字长篇拆成可交接的创作窗口：先锁当前真正要用的角色和地点，再随剧情推进增量扩展。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openStageForm()}>建立阶段</Button>
          {selectedStage ? (
            <>
              <Button icon={<ArrowRightOutlined />} onClick={() => window.location.hash = buildWorkspaceRoute(novelId, `characters?stageId=${selectedStage.id}`)}>
                查看人物窗口
              </Button>
              <Button icon={<ArrowRightOutlined />} onClick={() => window.location.hash = buildWorkspaceRoute(novelId, `map?stageId=${selectedStage.id}`)}>
                查看地图窗口
              </Button>
            </>
          ) : null}
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary items={[
          { label: '当前阶段', value: currentStatus },
          { label: '上下文', value: contextHealthLabel(stageContext?.health.status) },
          { label: '已建立', value: `${stages.length} 个` },
          { label: '当前项目', value: currentNovel?.title || '未命名小说' },
        ]} />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="当前工作段" value={activeCount} tone="warm" />
          <WorkspaceMetric label="待推进阶段" value={plannedCount} tone="cool" />
        </>
      )}
      guide={(
        <WorkspaceStepGuide
          title="阶段不是复制一套新世界，而是给当前窗口设置焦点"
          steps={[
            { title: '先定章节窗口', description: '例如第 1–100 章，只描述此段会真正出场的人物和地点。', status: selectedStage ? 'done' : 'focus' },
            { title: '登记资产角色', description: '核心人物做完整卡，功能人物只先登记动机、关系和出场任务。', status: assets.length > 0 ? 'done' : selectedStage ? 'focus' : 'todo' },
            { title: '交接给正文', description: '阶段结束时写明状态变化和下一阶段必须继承的事实。', status: selectedStage?.handoffSummary ? 'done' : 'todo' },
          ]}
        />
      )}
      className="creative-stage-page"
      layout="wide"
    >
      <div className="creative-stage-layout">
        <WorkspacePanel title="阶段序列" description="每个阶段都保留自己的章节范围、目标和交接条件。">
          <div className="creative-stage-list" aria-busy={loading}>
            {stages.map((stage) => (
              <button
                type="button"
                key={stage.id}
                className={`creative-stage-card${selectedStage?.id === stage.id ? ' is-selected' : ''}`}
                onClick={() => setSelectedStageId(stage.id)}
              >
                <span className="creative-stage-card__index">{String(stage.sequence).padStart(2, '0')}</span>
                <span className="creative-stage-card__body">
                  <span className="creative-stage-card__head">
                    <strong>{stage.name}</strong>
                    <Tag color={statusColors[stage.status]}>{stageStatusLabel(stage.status)}</Tag>
                  </span>
                  <span className="creative-stage-card__meta">{stageKindLabel(stage.kind)} · {formatCreativeStageRange(stage)}</span>
                  <span className="creative-stage-card__summary">{stage.objective || '还没有写阶段目标。'}</span>
                  <span className="creative-stage-card__counts">核心 {stage.coreAssetCount} · 活跃 {stage.activeAssetCount} · 待补 {stage.plannedAssetCount}</span>
                </span>
              </button>
            ))}
            {!loading && stages.length === 0 ? (
              <div className="creative-stage-empty">
                <CompassOutlined />
                <strong>还没有阶段</strong>
                <span>先建立“第 1–100 章”这样的窗口，后续生成会有明确边界。</span>
                <Button type="link" onClick={() => openStageForm()}>建立第一个阶段</Button>
              </div>
            ) : null}
          </div>
        </WorkspacePanel>

        <div className="creative-stage-detail-column">
          <WorkspacePanel
            title={selectedStage ? selectedStage.name : '阶段详情'}
            description={selectedStage ? `${stageKindLabel(selectedStage.kind)} · ${formatCreativeStageRange(selectedStage)}` : '选择一个阶段开始登记资产。'}
            extra={selectedStage ? (
              <Space>
                <Select
                  value={selectedStage.status}
                  options={CREATIVE_STAGE_STATUS_OPTIONS}
                  onChange={(value) => void handleStatusChange(selectedStage, value)}
                  style={{ width: 126 }}
                />
                {selectedStage.status !== 'archived' ? <Button danger type="text" icon={<DeleteOutlined />} onClick={() => void handleArchive(selectedStage)}>归档</Button> : null}
                {selectedStage.status !== 'archived' ? <Button type="text" icon={<EditOutlined />} onClick={() => openStageForm(selectedStage)}>编辑</Button> : null}
              </Space>
            ) : null}
          >
            {selectedStage ? (
              <>
                {stageContext ? (
                  <Alert
                    className="creative-stage-health"
                    type={contextHealthType(stageContext.health.status)}
                    showIcon
                    message={`阶段上下文：${contextHealthLabel(stageContext.health.status)}`}
                    description={[
                      ...stageContext.health.hardBlockers,
                      ...stageContext.health.warnings,
                    ].slice(0, 3).join('；') || '当前阶段边界、资产焦点和项目上下文版本已对齐。'}
                  />
                ) : null}
                <div className="creative-stage-brief">
                  <div><span>阶段目标</span><p>{selectedStage.objective || '尚未填写'}</p></div>
                  <div><span>本段剧情</span><p>{selectedStage.storySummary || '尚未填写'}</p></div>
                  <div><span>交接条件</span><p>{selectedStage.handoffSummary || '尚未填写'}</p></div>
                </div>
                {stageContext ? (
                  <div className="creative-stage-context-preview">
                    <span>正文召回包</span>
                    <strong>{stageContext.packet.chapterRange} · {stageContext.packet.focusAssets.length} 个阶段焦点</strong>
                    <p>{stageContext.packet.focusAssets.map((asset) => `${asset.name}（${asset.role}）`).join('、') || '尚未登记资产；生成器只能依赖项目正典和本阶段边界。'}</p>
                    {stageContext.packet.focusAssets.length > 0 ? (
                      <div className="creative-stage-context-preview__assets">
                        {stageContext.packet.focusAssets.map((asset) => (
                          <div key={`${asset.type}-${asset.name}`}>
                            <b>{asset.name}</b>
                            <span>{asset.brief || '当前仅登记名称，正文不得自行扩写未确认事实。'}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {stageContext ? (
                  <div className="creative-stage-quality">
                    <div className="creative-stage-quality__head">
                      <span>阶段质量快照</span>
                      <Space size={8}>
                        <Tag color={qualityStatusColor(stageContext.quality.status)}>{qualityStatusLabel(stageContext.quality.status)}</Tag>
                        <Button size="small" loading={qualityRunning} onClick={() => void handleRunStageQuality()}>
                          运行质量评审
                        </Button>
                      </Space>
                    </div>
                    <div className="creative-stage-quality__metrics">
                      <div><strong>{stageContext.quality.contentCoverageRate}%</strong><span>正文覆盖</span></div>
                      <div><strong>{stageContext.quality.summaryCoverageRate}%</strong><span>摘要覆盖</span></div>
                      <div><strong>{stageContext.quality.continuityCoverageRate}%</strong><span>连续性覆盖</span></div>
                      <div><strong>{stageContext.quality.completedChapterCount}/{stageContext.quality.chapterCount}</strong><span>已完成章节</span></div>
                    </div>
                    <p>{stageContext.quality.warnings.slice(0, 3).join('；') || '当前章节状态、章后记忆和阶段交接证据已形成闭环。'}</p>
                    <div className="creative-stage-quality__trend">
                      <div className="creative-stage-quality__trend-head">
                        <strong>质量趋势</strong>
                        <Tag color={qualityTrendColor(stageContext.quality.trend.status)}>
                          {qualityTrendLabel(stageContext.quality.trend.status)}
                        </Tag>
                      </div>
                      <div className="creative-stage-quality__trend-metrics">
                        <span>验收门 {stageContext.quality.trend.gateCoveredChapterCount}/{stageContext.quality.completedChapterCount || stageContext.quality.chapterCount} 章</span>
                        <span>平均 {stageContext.quality.trend.averageGateScore ?? '—'} 分</span>
                        <span>可放行 {stageContext.quality.trend.readyRate ?? '—'}%</span>
                        <span>阻塞/重写 {stageContext.quality.trend.blockerChapterCount} 章</span>
                      </div>
                      <p>{stageContext.quality.trend.summary}</p>
                      {stageContext.quality.trend.points.some((point) => point.contentReady) ? (
                        <div className="creative-stage-quality__trend-strip" aria-label="章节验收门趋势">
                          {stageContext.quality.trend.points.filter((point) => point.contentReady).slice(-12).map((point) => (
                            <span
                              key={point.chapterNum}
                              className={`creative-stage-quality__trend-point creative-stage-quality__trend-point--${point.gateLevel || 'missing'}`}
                              title={`第${point.chapterNum}章 · ${point.gateScore === undefined ? '尚未评审' : `${point.gateScore}分`} · ${point.gateLevel || '无门快照'}`}
                            >
                              {point.chapterNum}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {stageContext.quality.trend.repeatedIssueKeys.length > 0 ? (
                        <span className="creative-stage-quality__trend-issues">
                          重复风险：{stageContext.quality.trend.repeatedIssueKeys.slice(0, 3).map((item) => `${item.key} ×${item.count}`).join('、')}
                        </span>
                      ) : null}
                    </div>
                    {stageQualityReport ? (
                      <div className="creative-stage-quality__report">
                        <div className="creative-stage-quality__report-head">
                          <strong>质量智能体报告</strong>
                          <Space size={6}>
                            <Tag color={stageQualityReport.status === 'passed' ? 'success' : stageQualityReport.status === 'blocked' ? 'error' : 'warning'}>
                              {stageQualityReport.status === 'passed' ? '通过' : stageQualityReport.status === 'blocked' ? '阻断' : '需修订'}
                            </Tag>
                            <span>{stageQualityReport.score} 分 · 置信下界 {stageQualityReport.confidenceLowerBound}</span>
                          </Space>
                        </div>
                        <p>{stageQualityReport.summary}</p>
                        <span className="creative-stage-quality__report-meta">
                          覆盖率 {stageQualityReport.coverageRate}% · Finding {stageQualityReport.findings.length} 条
                        </span>
                        {[...stageQualityReport.blockers, ...stageQualityReport.warnings].slice(0, 3).map((item) => (
                          <span className="creative-stage-quality__report-warning" key={item}>{item}</span>
                        ))}
                        {stageQualityReports.length > 1 ? (
                          <div className="creative-stage-quality__report-history">
                            <span>历史阶段评审</span>
                            {stageQualityReports.slice(0, 5).map((report) => (
                              <button
                                type="button"
                                key={report.artifactId}
                                onClick={() => setStageQualityReport(report)}
                                className={report.artifactId === stageQualityReports[0]?.artifactId ? 'is-current' : ''}
                              >
                                {new Date(report.createdAt).toLocaleDateString('zh-CN')} · {report.score} 分 · {report.status === 'passed' ? '通过' : report.status === 'blocked' ? '阻断' : '需修订'}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : <div className="creative-stage-empty">建立阶段后，这里会显示它的剧情边界和资产焦点。</div>}
          </WorkspacePanel>

          <WorkspacePanel title="阶段交接工件" description="先记录变化、代价、未决问题和下一压力；审核通过后由作者确认，才会进入下一阶段召回。">
            {selectedStage ? (
              <>
                <div className="creative-stage-handoff__status">
                  <Tag color={handoffs[0]?.status === 'approved' ? 'success' : handoffs[0]?.status === 'reviewed' ? 'processing' : 'default'}>
                    {handoffStatusLabel(stageContext?.packet.handoffStatus)}
                  </Tag>
                  <span>{handoffs[0] ? `工件 v${handoffs[0].version} · 上下文 v${handoffs[0].contextVersion}` : '每次保存都会生成可回退的新版本'}</span>
                </div>
                <Form form={handoffForm} layout="vertical" className="creative-stage-handoff-form">
                  <Form.Item name="changes" label="状态变化" rules={[{ required: true, message: '至少填写一条状态变化，每行一条' }]}>
                    <Input.TextArea rows={3} placeholder="例如：主角第一次主动承担证据链责任\n例如：姜照夜从旁观者转为临时盟友" />
                  </Form.Item>
                  <Form.Item name="costs" label="付出的代价">
                    <Input.TextArea rows={2} placeholder="每行一条；没有也要明确写出本阶段为何没有新增代价" />
                  </Form.Item>
                  <Form.Item name="openQuestions" label="未决问题">
                    <Input.TextArea rows={2} placeholder="每行一条，作为下一阶段可检索的悬念抓手" />
                  </Form.Item>
                  <Form.Item name="nextPressure" label="下一阶段压力" rules={[{ required: true, message: '请填写下一阶段压力' }]}>
                    <Input.TextArea rows={2} placeholder="下一阶段会逼迫谁、付出什么、必须回应什么" />
                  </Form.Item>
                </Form>
                <Space wrap>
                  <Button onClick={() => void handleSaveHandoff(false)}>保存新草稿</Button>
                  <Button onClick={() => void handleSaveHandoff(true)}>保存并审阅</Button>
                  {handoffs[0]?.status === 'draft' ? <Button onClick={() => void handleReviewHandoff()}>审阅当前版本</Button> : null}
                  {handoffs[0]?.status === 'reviewed' ? <Button type="primary" onClick={() => void handleApproveHandoff()}>作者确认进入召回</Button> : null}
                </Space>
                <div className="creative-stage-handoff-list">
                  {handoffs.slice(0, 5).map((handoff) => (
                    <div className="creative-stage-handoff-card" key={handoff.id}>
                      <strong>v{handoff.version} · {handoff.content.nextPressure || '未填写下一压力'}</strong>
                      <span>{handoffStatusLabel(handoff.status)} · {handoff.content.changes.length} 条变化 · {handoff.content.openQuestions.length} 个未决问题</span>
                    </div>
                  ))}
                  {handoffs.length === 0 ? <div className="creative-stage-assets__empty">尚未建立交接工件；旧的交接文本只作为兼容提示，不会伪装成作者确认状态。</div> : null}
                </div>
              </>
            ) : (
              <>
                <Form form={handoffForm} style={{ display: 'none' }} />
                <div className="creative-stage-assets__empty">选择阶段后，可以建立可审阅、可回退的阶段交接。</div>
              </>
            )}
          </WorkspacePanel>

          <WorkspacePanel title="阶段资产焦点" description="先登记最小可用信息；正文推进后再升级为完整正典卡片。">
            {selectedStage ? (
              <>
                <Form form={assetForm} layout="vertical" className="creative-stage-asset-form">
                  <Form.Item name="assetType" label="资产类型" rules={[{ required: true, message: '请选择资产类型' }]}>
                    <Select options={CREATIVE_STAGE_ASSET_TYPE_OPTIONS} placeholder="人物 / 地点 / 线程" />
                  </Form.Item>
                  <Form.Item name="placeholderName" label="名称或占位名" rules={[{ required: true, message: '请填写名称或占位名' }]}>
                    <Input placeholder="例如：港口税吏、北境关隘" />
                  </Form.Item>
                  <Form.Item name="role" label="阶段角色" initialValue="supporting">
                    <Select options={CREATIVE_STAGE_ASSET_ROLE_OPTIONS} />
                  </Form.Item>
                  <Form.Item name="detailLevel" label="细化程度" initialValue="outline">
                    <Select options={[
                      { value: 'placeholder', label: '占位' },
                      { value: 'outline', label: '功能摘要' },
                      { value: 'working', label: '可写卡片' },
                      { value: 'canonical', label: '正典资产' },
                    ]} />
                  </Form.Item>
                  <Form.Item name="notes" label="当前任务" className="creative-stage-asset-form__wide">
                    <Input placeholder="这个资产在本阶段必须完成什么" />
                  </Form.Item>
                  <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => void handleAddAsset()}>登记焦点</Button>
                </Form>
                <div className="creative-stage-assets">
                  {assets.map((asset) => (
                    <div className="creative-stage-asset" key={asset.id}>
                      <div className="creative-stage-asset__icon"><TeamOutlined /></div>
                      <div className="creative-stage-asset__body">
                        <strong>{asset.placeholderName || `${asset.assetType}#${asset.assetId || '待建'}`}</strong>
                        <span>{asset.role} · {asset.detailLevel}{asset.notes ? ` · ${asset.notes}` : ''}</span>
                      </div>
                      <Button type="text" danger icon={<DeleteOutlined />} aria-label="移除阶段资产" onClick={() => void handleRemoveAsset(asset.id)} />
                    </div>
                  ))}
                  {assets.length === 0 ? <div className="creative-stage-assets__empty">这个阶段还没有资产焦点。先登记 3–8 个真正会出场的对象。</div> : null}
                </div>
              </>
            ) : <div className="creative-stage-assets__empty">选择阶段后，可在这里登记人物、地点和剧情线程。</div>}
          </WorkspacePanel>
        </div>
      </div>

      <Modal title={editingStage ? '编辑创作阶段' : '建立创作阶段'} open={createOpen} onCancel={() => { setCreateOpen(false); setEditingStage(null) }} onOk={() => void handleSaveStage()} confirmLoading={saving} okText={editingStage ? '保存阶段' : '建立阶段'} cancelText="取消" width={620}>
        <Form form={createForm} layout="vertical" initialValues={{ kind: 'chapter-window', status: 'planned' }}>
          <div className="creative-stage-form-grid">
            <Form.Item name="name" label="阶段名称" rules={[{ required: true, message: '请填写阶段名称' }]}>
              <Input placeholder="例如：第一卷·港城起局" />
            </Form.Item>
            <Form.Item name="kind" label="阶段类型">
              <Select options={CREATIVE_STAGE_KIND_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
            </Form.Item>
            <Form.Item name="chapterStart" label="起始章节"><InputNumber min={1} style={{ width: '100%' }} placeholder="1" /></Form.Item>
            <Form.Item name="chapterEnd" label="结束章节"><InputNumber min={1} style={{ width: '100%' }} placeholder="100" /></Form.Item>
          </div>
          <Form.Item name="objective" label="阶段目标"><Input.TextArea rows={2} placeholder="这一段结束时，主角、关系或主线必须发生什么变化" /></Form.Item>
          <Form.Item name="storySummary" label="剧情边界"><Input.TextArea rows={3} placeholder="只写这一阶段的冲突、地点和推进，不要提前展开全书后半部" /></Form.Item>
          <Form.Item name="handoffSummary" label="交接条件"><Input.TextArea rows={2} placeholder="阶段结束时必须留下哪些状态、关系和未决问题给下一阶段" /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
