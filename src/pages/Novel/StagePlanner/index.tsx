import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd'
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
} from '../../../types'
import {
  CREATIVE_STAGE_ASSET_ROLE_OPTIONS,
  CREATIVE_STAGE_ASSET_TYPE_OPTIONS,
  CREATIVE_STAGE_KIND_OPTIONS,
  CREATIVE_STAGE_STATUS_OPTIONS,
  formatCreativeStageRange,
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

export default function StagePlanner({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [createForm] = Form.useForm<CreativeStageCreateInput>()
  const [assetForm] = Form.useForm<CreativeStageAssetInput>()
  const [stages, setStages] = useState<CreativeStage[]>([])
  const [assets, setAssets] = useState<CreativeStageAssetBinding[]>([])
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingStage, setEditingStage] = useState<CreativeStage | null>(null)
  const [saving, setSaving] = useState(false)

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
      return
    }
    try {
      setAssets(await window.electron.creativeStage.listAssets(stageId))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadAssets(selectedStage?.id || null) }, [loadAssets, selectedStage?.id])

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
              <div className="creative-stage-brief">
                <div><span>阶段目标</span><p>{selectedStage.objective || '尚未填写'}</p></div>
                <div><span>本段剧情</span><p>{selectedStage.storySummary || '尚未填写'}</p></div>
                <div><span>交接条件</span><p>{selectedStage.handoffSummary || '尚未填写'}</p></div>
              </div>
            ) : <div className="creative-stage-empty">建立阶段后，这里会显示它的剧情边界和资产焦点。</div>}
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
