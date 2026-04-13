import React from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  type CollapseProps,
  Drawer,
  Empty,
  Input,
  Progress,
  Space,
  Spin,
  Tag,
  message,
} from 'antd'
import {
  BarChartOutlined,
  CheckOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import type {
  Chapter,
  Novel,
  WorkspaceQualityAnalyzeResult,
  WorkspaceQualityPatch,
  WorkspaceQualityRepairPreview,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context'
import {
  buildWorkspaceQualityRequestBase,
  getFallbackWorkspaceQualityAdapter,
  type WorkspaceQualityAdapterContext,
  type WorkspaceQualityRouteKey,
} from '../shared/workspace-quality'

interface Props {
  open: boolean
  workspaceKey: WorkspaceQualityRouteKey
  workspaceLabel: string
  workspaceSummary: string
  novelId: number
  currentNovel: Novel | null
  currentChapter: Chapter | null
  controller: RegisteredWorkspaceQualityController | null
  onClose: () => void
  onApplied?: () => void
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getAtPath(target: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, target)
}

function setAtPath(target: unknown, path: string[], value: unknown) {
  if (path.length === 0 || !target || typeof target !== 'object') return
  let cursor: unknown = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(segment)
      cursor = Number.isInteger(arrayIndex) ? cursor[arrayIndex] : undefined
      continue
    }
    if (cursor && typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[segment]
    }
  }

  const last = path[path.length - 1]
  if (Array.isArray(cursor)) {
    const arrayIndex = Number(last)
    if (Number.isInteger(arrayIndex)) cursor[arrayIndex] = value
    return
  }
  if (cursor && typeof cursor === 'object') {
    (cursor as Record<string, unknown>)[last] = value
  }
}

function applySelectedPatches(
  baseSnapshot: Record<string, unknown>,
  patchedSnapshot: Record<string, unknown>,
  patches: WorkspaceQualityPatch[],
  selectedPatchIds: Set<string>,
) {
  const nextSnapshot = cloneJson(baseSnapshot)
  patches
    .filter((patch) => selectedPatchIds.has(patch.id))
    .forEach((patch) => {
      setAtPath(nextSnapshot, patch.path, getAtPath(patchedSnapshot, patch.path))
    })
  return nextSnapshot
}

function aiFlavorColor(score: number) {
  if (score >= 80) return '#52c41a'
  if (score >= 65) return '#13c2c2'
  if (score >= 50) return '#faad14'
  if (score >= 35) return '#fa8c16'
  return '#f5222d'
}

function severityTagColor(severity: string) {
  if (severity === 'critical' || severity === 'high') return 'error'
  if (severity === 'warning' || severity === 'medium') return 'warning'
  return 'default'
}

function issueKindLabel(kind: string) {
  switch (kind) {
    case 'relevance_drift': return '跑题'
    case 'workflow_misalignment': return '步骤脱节'
    case 'context_loss': return '上下文丢失'
    case 'ai_like_language': return 'AI 味'
    case 'ornament_overload': return '辞藻堆砌'
    case 'fabricated_terms': return '生造概念'
    case 'incoherent_sentence': return '语句不顺'
    case 'format_noise': return '格式异常'
    case 'flat_narration': return '叙事发平'
    default: return kind
  }
}

export default function WorkspaceAIQualityBoard({
  open,
  workspaceKey,
  workspaceLabel,
  workspaceSummary,
  novelId,
  currentNovel,
  currentChapter,
  controller,
  onClose,
  onApplied,
}: Props) {
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const [snapshotLoading, setSnapshotLoading] = React.useState(false)
  const [snapshot, setSnapshot] = React.useState<Record<string, unknown> | null>(null)
  const [analysisLoading, setAnalysisLoading] = React.useState(false)
  const [repairLoading, setRepairLoading] = React.useState(false)
  const [analysis, setAnalysis] = React.useState<WorkspaceQualityAnalyzeResult | null>(null)
  const [preview, setPreview] = React.useState<WorkspaceQualityRepairPreview | null>(null)
  const [selectedPatchIds, setSelectedPatchIds] = React.useState<string[]>([])
  const [extraRequirements, setExtraRequirements] = React.useState('')

  const adapterContext = React.useMemo<WorkspaceQualityAdapterContext>(() => ({
    novelId,
    currentNovel,
    currentChapter,
  }), [currentChapter, currentNovel, novelId])

  const activeController = controller?.workspaceKey === workspaceKey ? controller : null
  const fallbackAdapter = React.useMemo(() => getFallbackWorkspaceQualityAdapter(workspaceKey), [workspaceKey])
  const canFetch = Boolean(activeController || fallbackAdapter)
  const canRepair = Boolean(
    (activeController && !activeController.readonly)
    || (fallbackAdapter?.applySnapshot && !fallbackAdapter.readonly),
  )
  const detailItems = React.useMemo<NonNullable<CollapseProps['items']>>(() => {
    const items: NonNullable<CollapseProps['items']> = []

    if (analysis?.fieldResults.length) {
      items.push({
        key: 'fields',
        label: `字段级问题 (${analysis.fieldResults.length})`,
        children: (
          <div style={{ display: 'grid', gap: 8 }}>
            {analysis.fieldResults.map((item) => (
              <div key={item.path.join('.')} className="novel-note-list__item">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Tag color={severityTagColor(item.severity)}>{item.score}</Tag>
                  <strong>{item.label}</strong>
                </div>
                {item.issues.map((issue) => <div key={issue} style={{ color: 'var(--color-text-secondary)' }}>- {issue}</div>)}
                {item.suggestions.map((tip) => <div key={tip} style={{ color: 'var(--color-blue-light)' }}>→ {tip}</div>)}
              </div>
            ))}
          </div>
        ),
      })
    }

    if (analysis?.entityResults.length) {
      items.push({
        key: 'entities',
        label: `实体级问题 (${analysis.entityResults.length})`,
        children: (
          <div style={{ display: 'grid', gap: 8 }}>
            {analysis.entityResults.map((item) => (
              <div key={item.path.join('.')} className="novel-note-list__item">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Tag color={severityTagColor(item.severity)}>{item.severity === 'critical' ? '高' : item.severity === 'warning' ? '中' : '低'}</Tag>
                  <strong>{item.label}</strong>
                </div>
                <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>{item.summary}</div>
                {item.issues.map((issue) => <div key={issue} style={{ color: 'var(--color-text-secondary)' }}>- {issue}</div>)}
                {item.suggestions.map((tip) => <div key={tip} style={{ color: 'var(--color-blue-light)' }}>→ {tip}</div>)}
              </div>
            ))}
          </div>
        ),
      })
    }

    return items
  }, [analysis])

  const loadSnapshot = React.useCallback(async () => {
    if (!canFetch) return
    setSnapshotLoading(true)
    try {
      const nextSnapshot = activeController
        ? await activeController.getSnapshot()
        : await fallbackAdapter?.fetchSnapshot(adapterContext)
      setSnapshot(nextSnapshot || null)
      setAnalysis(null)
      setPreview(null)
      setSelectedPatchIds([])
    } catch (error) {
      console.error(error)
      message.error('加载工作区快照失败。')
    } finally {
      setSnapshotLoading(false)
    }
  }, [activeController, adapterContext, canFetch, fallbackAdapter])

  React.useEffect(() => {
    if (!open) return
    void loadSnapshot()
  }, [loadSnapshot, open])

  const handleAnalyze = React.useCallback(async () => {
    if (!snapshot) return
    setAnalysisLoading(true)
    try {
      const result = await window.electron.ai.analyzeWorkspaceQuality({
        ...buildWorkspaceQualityRequestBase(workspaceKey, adapterContext),
        workspaceLabel,
        workspaceSummary,
        contentSnapshot: snapshot,
      })
      setAnalysis(result)
      setPreview(null)
      setSelectedPatchIds([])
    } catch (error) {
      console.error(error)
      message.error('AI 分析失败。')
    } finally {
      setAnalysisLoading(false)
    }
  }, [adapterContext, snapshot, workspaceKey, workspaceLabel, workspaceSummary])

  const handleRepair = React.useCallback(async () => {
    if (!snapshot) return
    setRepairLoading(true)
    try {
      const result = await window.electron.ai.repairWorkspaceQuality({
        ...buildWorkspaceQualityRequestBase(workspaceKey, adapterContext),
        workspaceLabel,
        workspaceSummary,
        contentSnapshot: snapshot,
        issues: analysis?.globalIssues || [],
        extraRequirements,
      })
      const allPatchIds = [...result.fieldPatches, ...result.entityPatches].map((item) => item.id)
      setPreview(result)
      setSelectedPatchIds(allPatchIds)
    } catch (error) {
      console.error(error)
      message.error('AI 修复预览生成失败。')
    } finally {
      setRepairLoading(false)
    }
  }, [adapterContext, analysis?.globalIssues, extraRequirements, snapshot, workspaceKey, workspaceLabel, workspaceSummary])

  const handleApply = React.useCallback(async () => {
    if (!snapshot || !preview) return
    const selectedIds = new Set(selectedPatchIds)
    const allPatches = [...preview.fieldPatches, ...preview.entityPatches]
    const nextSnapshot = applySelectedPatches(snapshot, preview.patchedSnapshot, allPatches, selectedIds)

    try {
      if (activeController) {
        await activeController.applySnapshot(nextSnapshot)
        if (activeController.persistPreview) {
          await activeController.persistPreview(nextSnapshot, preview)
        }
      } else if (fallbackAdapter?.applySnapshot) {
        await fallbackAdapter.applySnapshot(snapshot, nextSnapshot, adapterContext)
        const refreshedNovel = await window.electron.novel.get(novelId)
        if (refreshedNovel) setCurrentNovel(refreshedNovel)
      }

      onApplied?.()
      message.success('AI 修复预览已应用。')
      await loadSnapshot()
    } catch (error) {
      console.error(error)
      message.error('应用修复失败。')
    }
  }, [
    activeController,
    adapterContext,
    fallbackAdapter,
    loadSnapshot,
    novelId,
    onApplied,
    preview,
    selectedPatchIds,
    setCurrentNovel,
    snapshot,
  ])

  const allPatches = preview ? [...preview.fieldPatches, ...preview.entityPatches] : []

  return (
    <Drawer
      title={`${workspaceLabel} · AI 质量看板`}
      width={640}
      open={open}
      onClose={onClose}
      extra={(
        <Space size="small">
          <Button icon={<ReloadOutlined />} onClick={() => void loadSnapshot()} disabled={snapshotLoading}>
            刷新
          </Button>
          <Button icon={<BarChartOutlined />} type="primary" ghost onClick={() => void handleAnalyze()} disabled={!snapshot || analysisLoading}>
            AI 分析
          </Button>
        </Space>
      )}
    >
      {!canFetch ? (
        <Empty description="当前工作区暂未接入 AI 质量看板。" />
      ) : null}

      {canFetch && snapshotLoading ? <Spin /> : null}

      {canFetch && !snapshotLoading && !snapshot ? (
        <Empty description="当前工作区没有可分析的内容。" />
      ) : null}

      {snapshot ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <Alert
            type="info"
            showIcon
            message="分析目标"
            description="会检查当前工作区内容是否贴合上下步骤、主题、背景与已有设定，并专项检测 AI 味、格式噪音、空泛修辞与不连贯表达。"
          />

          {analysisLoading ? <Spin /> : null}

          {analysis ? (
            <>
              <section className="novel-subpanel">
                <div className="novel-subpanel__header">
                  <div className="novel-subpanel__title">步骤总评</div>
                  <Tag color={severityTagColor(analysis.severity)}>{analysis.severity === 'critical' ? '高风险' : analysis.severity === 'warning' ? '需修复' : '基本可用'}</Tag>
                </div>
                <div className="novel-subpanel__body">
                  <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>{analysis.summary}</div>
                  {analysis.repairPriority.length > 0 ? (
                    <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                      {analysis.repairPriority.map((item) => (
                        <div key={item} style={{ color: 'var(--color-text-secondary)' }}>- {item}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="novel-subpanel">
                <div className="novel-subpanel__header">
                  <div className="novel-subpanel__title">AI 味检测</div>
                  <Tag color={severityTagColor(analysis.aiFlavor.severity)}>{analysis.aiFlavor.severity === 'high' ? '高' : analysis.aiFlavor.severity === 'medium' ? '中' : '低'}</Tag>
                </div>
                <div className="novel-subpanel__body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <Progress
                      type="circle"
                      percent={analysis.aiFlavor.score}
                      width={84}
                      strokeColor={aiFlavorColor(analysis.aiFlavor.score)}
                      format={(value) => (
                        <span style={{ color: aiFlavorColor(analysis.aiFlavor.score), fontWeight: 700 }}>{value}</span>
                      )}
                    />
                    <div style={{ flex: 1, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                      {analysis.aiFlavor.summary}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {analysis.aiFlavor.breakdown.map((item) => (
                      <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 120, color: 'var(--color-text-secondary)' }}>{item.label}</span>
                        <Progress percent={item.value} showInfo={false} size="small" strokeColor="#fa8c16" style={{ flex: 1, margin: 0 }} />
                        <span style={{ width: 40, textAlign: 'right', color: '#fa8c16', fontWeight: 600 }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {analysis.aiFlavor.sampleFindings.length > 0 ? (
                    <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                      {analysis.aiFlavor.sampleFindings.map((item) => (
                        <div key={item} style={{ color: 'var(--color-text-secondary)' }}>- {item}</div>
                      ))}
                    </div>
                  ) : null}
                  {analysis.aiFlavor.humanizationDirections.length > 0 ? (
                    <Alert
                      style={{ marginTop: 12 }}
                      type="warning"
                      showIcon
                      message="去 AI 味方向"
                      description={analysis.aiFlavor.humanizationDirections.map((item) => <div key={item}>{item}</div>)}
                    />
                  ) : null}
                </div>
              </section>

              <section className="novel-subpanel">
                <div className="novel-subpanel__header">
                  <div className="novel-subpanel__title">当前问题</div>
                  <Tag>{analysis.globalIssues.length}</Tag>
                </div>
                <div className="novel-subpanel__body" style={{ display: 'grid', gap: 8 }}>
                  {analysis.globalIssues.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有命中的明显问题。" /> : null}
                  {analysis.globalIssues.map((issue) => (
                    <div key={issue.id} className="novel-note-list__item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <Tag color={severityTagColor(issue.severity)}>{issue.severity === 'critical' ? '高' : issue.severity === 'warning' ? '中' : '低'}</Tag>
                        <Tag>{issueKindLabel(issue.kind)}</Tag>
                        <strong>{issue.title}</strong>
                      </div>
                      <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>{issue.description}</div>
                      <div style={{ color: 'var(--color-blue-light)', marginTop: 6 }}>建议：{issue.suggestion}</div>
                    </div>
                  ))}
                </div>
              </section>

              {detailItems.length > 0 ? <Collapse ghost items={detailItems} /> : null}

              <section className="novel-subpanel">
                <div className="novel-subpanel__header">
                  <div className="novel-subpanel__title">AI 修复</div>
                </div>
                <div className="novel-subpanel__body">
                  <Input.TextArea
                    rows={3}
                    value={extraRequirements}
                    onChange={(event) => setExtraRequirements(event.target.value)}
                    placeholder="可补充额外要求，例如“保留现有世界观词汇”“句子更短更利落”“增强人物立场和代价感”。"
                  />
                  <Space style={{ marginTop: 10 }}>
                    <Button
                      type="primary"
                      icon={<RobotOutlined />}
                      onClick={() => void handleRepair()}
                      loading={repairLoading}
                      disabled={!canRepair}
                    >
                      生成修复预览
                    </Button>
                    {!canRepair ? <Tag>当前工作区仅支持分析</Tag> : null}
                  </Space>
                </div>
              </section>
            </>
          ) : null}

          {preview ? (
            <section className="novel-subpanel">
              <div className="novel-subpanel__header">
                <div className="novel-subpanel__title">修复预览</div>
                <Tag color={severityTagColor(preview.aiFlavor.severity)}>{allPatches.length} 处修改</Tag>
              </div>
              <div className="novel-subpanel__body">
                {preview.warnings.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="预览警告"
                    description={preview.warnings.map((item) => <div key={item}>{item}</div>)}
                    style={{ marginBottom: 12 }}
                  />
                ) : null}
                <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, marginBottom: 12 }}>{preview.summary}</div>
                <Space style={{ marginBottom: 12 }}>
                  <Button size="small" onClick={() => setSelectedPatchIds(allPatches.map((item) => item.id))}>全选</Button>
                  <Button size="small" onClick={() => setSelectedPatchIds([])}>清空</Button>
                </Space>
                <Checkbox.Group
                  value={selectedPatchIds}
                  onChange={(values) => setSelectedPatchIds(values as string[])}
                  style={{ width: '100%' }}
                >
                  <div style={{ display: 'grid', gap: 8 }}>
                    {allPatches.map((patch) => (
                      <label key={patch.id} className="novel-note-list__item" style={{ display: 'block', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <Checkbox value={patch.id} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                              <Tag>{patch.patchKind === 'entity' ? '实体' : '字段'}</Tag>
                              <strong>{patch.label}</strong>
                            </div>
                            <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>原因：{patch.reason}</div>
                            <div style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>修改前：{patch.before || '空'}</div>
                            <div style={{ color: 'var(--color-blue-light)' }}>修改后：{patch.after || '空'}</div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </Checkbox.Group>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  style={{ marginTop: 12 }}
                  disabled={selectedPatchIds.length === 0}
                  onClick={() => void handleApply()}
                >
                  应用已选修复
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}
