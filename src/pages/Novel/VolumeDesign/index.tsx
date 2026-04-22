import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Form, Input, Select, Space, Spin, Switch, Tag, message } from 'antd'
import { SaveOutlined, BarsOutlined, LinkOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'
import type {
  EndgameCommitment,
  ResistanceTrack,
  StoryStructureVolumeSummary,
  VolumeAuditFinding,
  VolumeAuditResult,
  VolumeConstraintSyncResult,
  VolumeDesignAsset,
} from '../../../types'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceStepGuide,
} from '../components/WorkspaceShell'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'

interface Props {
  novelId: number
}

interface VolumeDesignFormValues {
  volumeTheme: string
  volumePromise: string
  mainConflict: string
  climaxPlan: string
  endStateShift: string
  mustAddCluesText: string
  mustResolveCluesText: string
  readerExpectation: string
  linkedEndgameCommitmentIds: number[]
  linkedResistanceTrackIds: number[]
  auditStatus: string
}

function splitLines(value?: string): string[] {
  return (value || '')
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildFormValues(design?: VolumeDesignAsset | null): VolumeDesignFormValues {
  return {
    volumeTheme: design?.volumeTheme || '',
    volumePromise: design?.volumePromise || '',
    mainConflict: design?.mainConflict || '',
    climaxPlan: design?.climaxPlan || '',
    endStateShift: design?.endStateShift || '',
    mustAddCluesText: (design?.mustAddClues || []).join('\n'),
    mustResolveCluesText: (design?.mustResolveClues || []).join('\n'),
    readerExpectation: design?.readerExpectation || '',
    linkedEndgameCommitmentIds: design?.linkedEndgameCommitmentIds || [],
    linkedResistanceTrackIds: design?.linkedResistanceTrackIds || [],
    auditStatus: design?.auditStatus || 'draft',
  }
}

function getFindingTagColor(severity: VolumeAuditFinding['severity']): string {
  if (severity === 'high') return 'red'
  if (severity === 'medium') return 'orange'
  return 'blue'
}

function getFindingSeverityLabel(severity: VolumeAuditFinding['severity']): string {
  if (severity === 'high') return '高'
  if (severity === 'medium') return '中'
  return '低'
}

export default function VolumeDesignPage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<VolumeDesignFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [volumes, setVolumes] = useState<StoryStructureVolumeSummary[]>([])
  const [designs, setDesigns] = useState<VolumeDesignAsset[]>([])
  const [commitments, setCommitments] = useState<EndgameCommitment[]>([])
  const [resistanceTracks, setResistanceTracks] = useState<ResistanceTrack[]>([])
  const [activeVolumeId, setActiveVolumeId] = useState<number | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [syncingConstraints, setSyncingConstraints] = useState(false)
  const [createTasksOnAudit, setCreateTasksOnAudit] = useState(true)
  const [lastAuditResult, setLastAuditResult] = useState<VolumeAuditResult | null>(null)
  const [lastSyncResult, setLastSyncResult] = useState<VolumeConstraintSyncResult | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [volumeRows, designRows, commitmentRows, resistanceDashboard] = await Promise.all([
        window.electron.structure.listVolumes(novelId),
        window.electron.volumeDesign.list(novelId),
        window.electron.endgameAsset.listCommitments(novelId),
        window.electron.resistance.getDashboard(novelId),
      ])
      setVolumes(volumeRows)
      setDesigns(designRows)
      setCommitments(commitmentRows.filter((item) => item.derivedStatus !== 'waived'))
      setResistanceTracks(resistanceDashboard.tracks)
      setActiveVolumeId((current) => current ?? volumeRows[0]?.id ?? null)
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('volumeDesign.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [novelId])

  const activeVolume = useMemo(
    () => volumes.find((item) => item.id === activeVolumeId) || null,
    [activeVolumeId, volumes],
  )
  const activeDesign = useMemo(
    () => designs.find((item) => item.volumeId === activeVolumeId) || null,
    [activeVolumeId, designs],
  )

  useEffect(() => {
    form.setFieldsValue(buildFormValues(activeDesign))
  }, [activeDesign, form])

  useEffect(() => {
    setLastAuditResult(null)
    setLastSyncResult(null)
  }, [activeVolumeId])

  const linkedCommitments = useMemo(
    () => commitments.filter((item) => (activeDesign?.linkedEndgameCommitmentIds || []).includes(item.id)),
    [activeDesign?.linkedEndgameCommitmentIds, commitments],
  )
  const linkedResistanceTracks = useMemo(
    () => resistanceTracks.filter((item) => (activeDesign?.linkedResistanceTrackIds || []).includes(item.id || -1)),
    [activeDesign?.linkedResistanceTrackIds, resistanceTracks],
  )
  const hasAuditBlockingRisk = (lastAuditResult?.summary.highCount || 0) > 0

  const handleSave = async () => {
    if (!activeVolumeId) return
    const values = await form.validateFields()
    setSaving(true)
    try {
      await window.electron.volumeDesign.upsert(activeVolumeId, {
        volumeTheme: values.volumeTheme,
        volumePromise: values.volumePromise,
        mainConflict: values.mainConflict,
        climaxPlan: values.climaxPlan,
        endStateShift: values.endStateShift,
        mustAddClues: splitLines(values.mustAddCluesText),
        mustResolveClues: splitLines(values.mustResolveCluesText),
        readerExpectation: values.readerExpectation,
        linkedEndgameCommitmentIds: values.linkedEndgameCommitmentIds,
        linkedResistanceTrackIds: values.linkedResistanceTrackIds,
        auditStatus: values.auditStatus,
      })
      message.success(getUserFacingMessage('volumeDesign.saved'))
      await loadData()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleRunAudit = async () => {
    if (!activeVolumeId) return
    setAuditing(true)
    try {
      const result = await window.electron.volumeDesign.auditVolume(activeVolumeId, {
        createRevisionTasks: createTasksOnAudit,
      })
      setLastAuditResult(result)
      if (result.summary.highCount > 0) {
        message.warning(getUserFacingMessage('volumeDesign.auditFoundHighRisk', { count: result.summary.highCount }))
      } else {
        message.success(getUserFacingMessage('volumeDesign.auditCompleted'))
      }
      await loadData()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'volumeDesign.auditFailed'))
    } finally {
      setAuditing(false)
    }
  }

  const handleSyncConstraints = async () => {
    if (!activeVolumeId) return
    setSyncingConstraints(true)
    try {
      const result = await window.electron.volumeDesign.syncConstraints(activeVolumeId)
      setLastSyncResult(result)
      message.success(getUserFacingMessage('volumeDesign.constraintsSynced', {
        chapterCount: result.chapterCount,
        createdCount: result.createdContractCount,
        updatedCount: result.updatedContractCount,
      }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'volumeDesign.constraintsSyncFailed'))
    } finally {
      setSyncingConstraints(false)
    }
  }

  if (loading) {
    return (
      <WorkspacePage title="卷级设计中心">
        <WorkspacePanel title="正在加载卷级设计">
          <Spin />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      eyebrow="卷级设计中心"
      title="卷级设计中心"
      description="把终局承诺拆到各卷，让每卷都有自己的主题、闭环和必须服务的终局压力。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存当前卷设计
          </Button>
          <Button
            icon={<LinkOutlined />}
            loading={syncingConstraints}
            disabled={!activeVolumeId}
            onClick={() => void handleSyncConstraints()}
          >
            同步为章节硬约束
          </Button>
          <Space size={4}>
            <Switch size="small" checked={createTasksOnAudit} onChange={setCreateTasksOnAudit} />
            <span style={{ fontSize: 12, opacity: 0.75 }}>审计后自动建修订任务</span>
          </Space>
          <Button
            danger
            icon={<SafetyCertificateOutlined />}
            loading={auditing}
            disabled={!activeVolumeId}
            onClick={() => void handleRunAudit()}
          >
            卷后审计
          </Button>
          <Button icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/contracts`)}>
            去章节合同
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '卷数量', value: volumes.length > 0 ? `${volumes.length} 卷` : '未拆卷' },
            { label: '终局承诺', value: commitments.length > 0 ? `${commitments.length} 条` : '未同步' },
            { label: '当前卷', value: activeVolume ? (activeVolume.title || `第${activeVolume.volumeNumber}卷`) : '未选择' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="已绑定终局承诺" value={activeDesign?.linkedEndgameCommitmentIds.length || 0} tone="warm" />
          <WorkspaceMetric label="主阻力来源" value={activeDesign?.linkedResistanceTrackIds.length || 0} />
          <WorkspaceMetric label="必须回收线索" value={activeDesign?.mustResolveClues.length || 0} tone="cool" />
        </>
      )}
      guide={(
        <WorkspaceStepGuide
          steps={[
            { title: '先选卷', description: '先确认当前在设计哪一卷，不要把全书目标和卷级目标混写。', status: 'focus' },
            { title: '绑定终局与主阻力', description: '把这一卷明确要服务的终局承诺和主要阻力来源直接挂上。', status: 'todo' },
            { title: '写清本卷闭环', description: '至少把本卷承诺、主冲突、高潮和卷末状态变化写完整。', status: 'todo' },
          ]}
        />
      )}
    >
      {commitments.length <= 0 ? (
        <Alert
          type="warning"
          showIcon
          message="还没有可引用的终局承诺"
          description="先到终局设计页保存并同步承诺，再回来把各卷绑定到具体终局压力。"
        />
      ) : null}

      {hasAuditBlockingRisk ? (
        <Alert
          type="error"
          showIcon
          message="卷后审计发现高风险（不阻止操作）"
          description={`当前卷有 ${lastAuditResult?.summary.highCount || 0} 条高风险。你仍可继续编辑和保存，但建议先处理红色问题。`}
          style={{ marginTop: 12 }}
        />
      ) : null}

      <WorkspacePanel title="卷选择" description="每卷单独维护，避免全书级描述混入卷级目标。">
        <Space wrap>
          <Select
            value={activeVolumeId ?? undefined}
            onChange={(value) => setActiveVolumeId(value)}
            style={{ minWidth: 240 }}
            options={volumes.map((item) => ({
              value: item.id,
              label: `${item.title || `第${item.volumeNumber}卷`} · ${item.chapterCount}章`,
            }))}
            placeholder="选择要设计的卷"
          />
          {activeVolume ? <Tag color="blue">{`第${activeVolume.volumeNumber}卷 · ${activeVolume.chapterCount}章 · ${activeVolume.wordCount.toLocaleString()}字`}</Tag> : null}
        </Space>
      </WorkspacePanel>

      <WorkspacePanel title="卷级闭环" description="写当前卷为什么值得读完，以及它怎么向终局继续施压。">
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card">
              <Form.Item name="volumeTheme" label="本卷主题">
                <Input.TextArea rows={3} placeholder="写这一卷真正反复验证的主题命题。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="volumePromise" label="本卷承诺">
                <Input.TextArea rows={3} placeholder="写读者读完这一卷必须拿到的情绪收益或叙事兑现。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="mainConflict" label="本卷主冲突">
                <Input.TextArea rows={4} placeholder="写本卷主要对手、压力结构或核心困局。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="climaxPlan" label="本卷高潮">
                <Input.TextArea rows={4} placeholder="写这一卷最高压的冲突爆点和兑现方式。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="endStateShift" label="卷末状态变化">
                <Input.TextArea rows={4} placeholder="写卷末人物、局势或资源格局发生了什么不可逆变化。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="readerExpectation" label="卷末读者期待">
                <Input.TextArea rows={4} placeholder="写读者读完本卷后，下一卷最该等待什么。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel title="终局绑定与阻力清单" description="这一卷必须服务哪些终局承诺、主要阻力来源是什么，以及必须新增和回收哪些线索。">
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="linkedEndgameCommitmentIds" label="本卷绑定的终局承诺">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本卷直接服务的终局承诺"
                  options={commitments.map((item) => ({
                    value: item.id,
                    label: `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`,
                  }))}
                />
              </Form.Item>
              {linkedCommitments.length > 0 ? (
                <Space wrap>
                  {linkedCommitments.map((item) => (
                    <Tag key={item.id} color={item.commitmentKind === 'payoff' ? 'gold' : 'cyan'}>
                      {`${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="linkedResistanceTrackIds" label="本卷主要阻力来源">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择这一卷主要承受的阻力来源"
                  options={resistanceTracks.map((item) => ({
                    value: item.id,
                    label: `${item.title} · ${item.sourceName}`,
                  }))}
                />
              </Form.Item>
              {linkedResistanceTracks.length > 0 ? (
                <Space wrap>
                  {linkedResistanceTracks.map((item) => (
                    <Tag key={item.id} color="volcano">
                      {`${item.title} · ${item.sourceName}`}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="mustAddCluesText" label="本卷必须新增的线索">
                <Input.TextArea rows={6} placeholder={'建议每行一条，例如：\n反派真正动机的新证据\n主角无法回避的新成本'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="mustResolveCluesText" label="本卷必须回收的线索">
                <Input.TextArea rows={6} placeholder={'建议每行一条，例如：\n第一卷埋下的伤口来源\n本卷中段埋下的身份误判'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="auditStatus" label="卷后审计状态">
                <Select
                  options={[
                    { value: 'draft', label: '草稿' },
                    { value: 'ready', label: '待审计' },
                    { value: 'audited', label: '已审计' },
                  ]}
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel title="卷后审计结果" description="审计会输出未回收线索、弧线停滞和推进不足清单；可选自动生成修订任务。">
        {lastAuditResult ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert
              type={lastAuditResult.summary.highCount > 0 ? 'error' : lastAuditResult.summary.mediumCount > 0 ? 'warning' : 'success'}
              showIcon
              message={`共 ${lastAuditResult.summary.totalFindings} 条发现（高 ${lastAuditResult.summary.highCount} / 中 ${lastAuditResult.summary.mediumCount} / 低 ${lastAuditResult.summary.lowCount}）`}
              description={`覆盖章节 ${lastAuditResult.summary.contractCoveredChapterCount}/${lastAuditResult.summary.chapterCount}，未回收线索 ${lastAuditResult.summary.unresolvedMustResolveClueCount}，弧线停滞 ${lastAuditResult.summary.stalledArcCount}，推进不足 ${lastAuditResult.summary.weakProgressChapterCount}。自动任务 ${lastAuditResult.summary.createdTaskCount} 条。`}
            />
            <Space wrap>
              {lastAuditResult.findings.length > 0 ? lastAuditResult.findings.map((finding) => (
                <Tag key={finding.id} color={getFindingTagColor(finding.severity)}>
                  {`[${getFindingSeverityLabel(finding.severity)}] ${finding.title}${finding.taskId ? ` · 任务#${finding.taskId}` : ''}`}
                </Tag>
              )) : <Tag color="success">未发现风险</Tag>}
            </Space>
          </Space>
        ) : (
          <Alert
            type="info"
            showIcon
            message="尚未执行卷后审计"
            description="点击顶部“卷后审计”后，这里会展示发现清单与自动任务回执。"
          />
        )}
      </WorkspacePanel>

      <WorkspacePanel title="硬约束同步回执" description="把卷级目标同步到本卷章节合同的 requiredAssetRefs 与 acceptanceNotes。">
        {lastSyncResult ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert
              type="success"
              showIcon
              message={`同步完成：${lastSyncResult.chapterCount} 章（新增合同 ${lastSyncResult.createdContractCount}，更新合同 ${lastSyncResult.updatedContractCount}）`}
              description={`本次写入卷级约束 ${lastSyncResult.syncedConstraintCount} 条。`}
            />
            <Space wrap>
              {lastSyncResult.sampleConstraints.map((line) => (
                <Tag key={line} color="cyan">{line}</Tag>
              ))}
            </Space>
          </Space>
        ) : (
          <Alert
            type="info"
            showIcon
            message="尚未执行硬约束同步"
            description="点击顶部“同步为章节硬约束”后，这里会展示写入回执。"
          />
        )}
      </WorkspacePanel>
    </WorkspacePage>
  )
}
