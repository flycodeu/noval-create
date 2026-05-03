import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Collapse, Form, Input, Modal, Space, Tag, message, notification } from 'antd'
import {
  ArrowRightOutlined,
  BarsOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  PremiseGenerationMode,
  PremiseGenerationProgressEvent,
  PremiseGenerationResult,
} from '../../../shared/premise-generation'
import type { PremiseDraftRecord } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import {
  buildStorySettingsPayload,
  parseStorySettingsSnapshot,
} from '../../../shared/story-settings'
import {
  buildAiResultKey,
  useAiResultStore,
} from '../../../stores/ai-result.store'
import {
  isCharacterRosterReady,
  isItemsEquipmentReady,
  isMapStructureReady,
  isStoryPlotReady,
  isWorldFoundationReady,
  loadWorkflowStats,
} from '../workflow'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import {
  type RegisteredWorkspaceQualityController,
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

interface Props {
  novelId: number
}

interface PremiseFormValues {
  positioning: string
  coreHook: string
  protagonistStart: string
  constraints: string
  languageGuardrails: string
  antiAiFlavor: string
  commonSenseRules: string
  bannedTerms: string
}

type PremiseGenerationResultWithMeta = PremiseGenerationResult & {
  missingFields?: string[]
  draftTaskId?: number
}

const EMPTY_STATS = {
  mapCount: 0,
  characterCount: 0,
  itemCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  hasProtagonist: false,
}

const PREMISE_FIELD_LABELS: Record<string, string> = {
  positioning: '作品定位',
  coreHook: '核心信息',
  protagonistStart: '主角起点',
  constraints: '底层约束',
  languageGuardrails: '语言边界',
  antiAiFlavor: '去 AI 腔规则',
  commonSenseRules: '常识约束',
  bannedTerms: '禁用表达',
}

function normalizeText(value?: string | null): string {
  return value?.trim() || ''
}

function compactText(value?: string | null, max = 46): string {
  const text = value?.trim() || ''
  if (!text) return '未补背景'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function mergeGeneratedValues(
  current: PremiseFormValues,
  result: PremiseGenerationResult,
  mode: PremiseGenerationMode,
): PremiseFormValues {
  const pick = (existing?: string | null, next?: string | null) => {
    const currentValue = normalizeText(existing)
    if (mode === 'fill_blanks' && currentValue) return currentValue
    return normalizeText(next)
  }

  return {
    positioning: pick(current.positioning, result.positioning),
    coreHook: pick(current.coreHook, result.coreHook),
    protagonistStart: pick(current.protagonistStart, result.protagonistStart),
    constraints: pick(current.constraints, result.constraints),
    languageGuardrails: pick(current.languageGuardrails, result.languageGuardrails),
    antiAiFlavor: pick(current.antiAiFlavor, result.antiAiFlavor),
    commonSenseRules: pick(current.commonSenseRules, result.commonSenseRules),
    bannedTerms: pick(current.bannedTerms, result.bannedTerms),
  }
}

export default function PremisePage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const pendingResultKey = useMemo(() => buildAiResultKey('premise_generate', novelId), [novelId])
  const [form] = Form.useForm<PremiseFormValues>()
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<PremiseGenerationMode | null>(null)
  const [generationProgress, setGenerationProgress] = useState<PremiseGenerationProgressEvent | null>(null)
  const [stats, setStats] = useState(EMPTY_STATS)
  const aliveRef = useRef(true)
  const pendingResult = useAiResultStore(
    (state) => state.results[pendingResultKey],
  )
  const setPendingResult = useAiResultStore((state) => state.setPendingResult)
  const markApplied = useAiResultStore((state) => state.markApplied)
  const clearPendingResult = useAiResultStore((state) => state.clearPendingResult)

  const settings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    form.setFieldsValue({
      positioning: settings.premise.positioning,
      coreHook: settings.premise.coreHook,
      protagonistStart: settings.premise.protagonistStart,
      constraints: settings.premise.constraints,
      languageGuardrails: settings.premise.languageGuardrails,
      antiAiFlavor: settings.writingRules.antiAiFlavor,
      commonSenseRules: settings.writingRules.commonSenseRules,
      bannedTerms: settings.writingRules.bannedTerms,
    })
  }, [form, settings])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (active) setStats(workflowStats)
    })
    return () => {
      active = false
    }
  }, [novelId])

  useEffect(() => {
    const unsubscribe = window.electron.on('ai:premise-progress', (...args) => {
      const payload = args[0] as PremiseGenerationProgressEvent | undefined
      if (!payload || payload.novelId !== novelId) return
      setGenerationProgress(payload)
    })
    return unsubscribe
  }, [novelId])

  useEffect(() => {
    if (!pendingResult?.appliedAt) return

    const applyMode = (pendingResult.appliedMode || pendingResult.mode || 'replace') as PremiseGenerationMode
    const currentValues = form.getFieldsValue()
    form.setFieldsValue(mergeGeneratedValues(currentValues, pendingResult.result, applyMode))
  }, [
    form,
    pendingResult?.appliedAt,
    pendingResult?.appliedMode,
    pendingResult?.completedAt,
    pendingResult?.mode,
    pendingResult?.result,
  ])

  useEffect(() => {
    if (pendingResult) return

    let active = true
    void window.electron.premiseDraft.getLatest(novelId).then((draft) => {
      if (!active || !draft) return

      const restored = draft as PremiseDraftRecord
      setPendingResult({
        key: pendingResultKey,
        taskType: 'premise_generate',
        novelId,
        status: restored.status,
        result: restored.result as PremiseGenerationResultWithMeta,
        warnings: restored.warnings,
        sourcePage: restored.sourcePage,
        mode: restored.mode,
        appliedMode: restored.appliedMode,
        createdAt: restored.createdAt,
        completedAt: restored.completedAt,
        appliedAt: restored.appliedAt,
      })
    }).catch((error) => {
      console.error(error)
    })

    return () => {
      active = false
    }
  }, [novelId, pendingResult, pendingResultKey, setPendingResult])

  const syncDraftApplied = async (
    result: PremiseGenerationResultWithMeta | undefined,
    mode: PremiseGenerationMode,
  ) => {
    if (!result?.draftTaskId) return

    try {
      await window.electron.premiseDraft.markApplied(result.draftTaskId, mode)
    } catch (error) {
      console.error(error)
    }
  }

  const clearPersistedDrafts = async () => {
    try {
      await window.electron.premiseDraft.clearAll(novelId)
    } catch (error) {
      console.error(error)
    }
  }

  const handleDiscardPendingResult = async () => {
    await clearPersistedDrafts()
    clearPendingResult(pendingResultKey)
    message.info(getUserFacingMessage('premise.discardedDraft'))
  }

  const formValues = (Form.useWatch([], form) as Partial<PremiseFormValues> | undefined) || {}
  const assetReadiness = [
    isWorldFoundationReady(currentNovel),
    isMapStructureReady(stats),
    isCharacterRosterReady(stats),
    isItemsEquipmentReady(stats),
  ].filter(Boolean).length
  const storyDesignReady = isStoryPlotReady(currentNovel)
  const premiseFilledCount = [
    formValues.positioning,
    formValues.coreHook,
    formValues.protagonistStart,
    formValues.constraints,
    formValues.languageGuardrails,
  ].filter((value) => typeof value === 'string' && value.trim()).length
  const writingRuleCount = [
    formValues.antiAiFlavor,
    formValues.commonSenseRules,
    formValues.bannedTerms,
  ].filter((value) => typeof value === 'string' && value.trim()).length

  const pendingMissingFields = pendingResult?.result.missingFields || []

  const applyPendingResult = async (mode: PremiseGenerationMode) => {
    if (!pendingResult) return

    const currentValues = form.getFieldsValue()
    form.setFieldsValue(mergeGeneratedValues(currentValues, pendingResult.result, mode))
    markApplied(pendingResultKey, mode)
    await syncDraftApplied(pendingResult.result, mode)
  }

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'core-settings',
    getSnapshot: () => {
      const values = form.getFieldsValue(true)
      return {
        scope: 'form',
        fields: {
          positioning: typeof values.positioning === 'string' ? values.positioning.trim() : '',
          coreHook: typeof values.coreHook === 'string' ? values.coreHook.trim() : '',
          protagonistStart: typeof values.protagonistStart === 'string' ? values.protagonistStart.trim() : '',
          constraints: typeof values.constraints === 'string' ? values.constraints.trim() : '',
          languageGuardrails: typeof values.languageGuardrails === 'string' ? values.languageGuardrails.trim() : '',
          antiAiFlavor: typeof values.antiAiFlavor === 'string' ? values.antiAiFlavor.trim() : '',
          commonSenseRules: typeof values.commonSenseRules === 'string' ? values.commonSenseRules.trim() : '',
          bannedTerms: typeof values.bannedTerms === 'string' ? values.bannedTerms.trim() : '',
        },
      }
    },
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<PremiseFormValues>
        : {}
      form.setFieldsValue({
        positioning: typeof fields.positioning === 'string' ? fields.positioning : undefined,
        coreHook: typeof fields.coreHook === 'string' ? fields.coreHook : undefined,
        protagonistStart: typeof fields.protagonistStart === 'string' ? fields.protagonistStart : undefined,
        constraints: typeof fields.constraints === 'string' ? fields.constraints : undefined,
        languageGuardrails: typeof fields.languageGuardrails === 'string' ? fields.languageGuardrails : undefined,
        antiAiFlavor: typeof fields.antiAiFlavor === 'string' ? fields.antiAiFlavor : undefined,
        commonSenseRules: typeof fields.commonSenseRules === 'string' ? fields.commonSenseRules : undefined,
        bannedTerms: typeof fields.bannedTerms === 'string' ? fields.bannedTerms : undefined,
      })
    },
  }), [form])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)

    try {
      const payload = buildStorySettingsPayload({
        premise: {
          positioning: normalizeText(values.positioning),
          coreHook: normalizeText(values.coreHook),
          protagonistStart: normalizeText(values.protagonistStart),
          constraints: normalizeText(values.constraints),
          languageGuardrails: normalizeText(values.languageGuardrails),
        },
        writingRules: {
          antiAiFlavor: normalizeText(values.antiAiFlavor),
          commonSenseRules: normalizeText(values.commonSenseRules),
          bannedTerms: normalizeText(values.bannedTerms),
        },
      }, currentNovel?.settingsJson)

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(payload),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await clearPersistedDrafts()
      if (pendingResult?.appliedAt) {
        clearPendingResult(pendingResultKey)
      }
      message.success(getUserFacingMessage('premise.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'premise.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async (mode: PremiseGenerationMode) => {
    setGeneratingMode(mode)
    setGenerationProgress(null)
    const startedAt = new Date().toISOString()

    try {
      const result = await window.electron.ai.generatePremise({
        novelId,
        mode,
        requirements: '只生成基础设定与写作边界，不要写主线、支线、章节、阶段转折和结局。',
      })

      setPendingResult({
        key: pendingResultKey,
        taskType: 'premise_generate',
        novelId,
        status: 'pending',
        result,
        warnings: result.warnings,
        sourcePage: 'premise',
        mode,
        createdAt: startedAt,
        completedAt: new Date().toISOString(),
      })

      if (aliveRef.current) {
        const currentValues = form.getFieldsValue()
        form.setFieldsValue(mergeGeneratedValues(currentValues, result, mode))
        markApplied(pendingResultKey, mode)
        await syncDraftApplied(result as PremiseGenerationResultWithMeta, mode)

        if (result.warnings.length > 0) {
          message.warning(getUserFacingMessage('premise.generatedWithWarnings', { count: result.warnings.length }))
        } else if (mode === 'fill_blanks') {
          message.success(getUserFacingMessage('premise.filledBlanks'))
        } else {
          message.success(getUserFacingMessage('premise.generated'))
        }
      } else {
        notification.success({
          message: getUserFacingMessage('premise.notificationCompletedTitle'),
          description: result.warnings.length > 0
            ? getUserFacingMessage('premise.notificationCompletedDescriptionWithWarnings', { count: result.warnings.length })
            : getUserFacingMessage('premise.notificationCompletedDescription'),
          duration: 6,
          placement: 'bottomRight',
          onClick: () => {
            window.location.hash = `#/novels/${novelId}/core-settings`
          },
        })
      }
    } catch (error) {
      console.error(error)
      const errorMessage = error instanceof Error ? error.message : getUserFacingMessage('premise.generateFailed')
      if (aliveRef.current) {
        message.error(errorMessage)
      } else {
        notification.error({
          message: getUserFacingMessage('premise.notificationFailedTitle'),
          description: errorMessage,
          duration: 6,
          placement: 'bottomRight',
          onClick: () => {
            window.location.hash = `#/novels/${novelId}/core-settings`
          },
        })
      }
    } finally {
      if (aliveRef.current) {
        setGeneratingMode(null)
        setGenerationProgress(null)
      }
    }
  }

  const handleClear = () => {
    Modal.confirm({
      title: '清空基础设定？',
      content: '会清空当前基础设定与写作边界字段，并直接保存为空白基线。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const payload = buildStorySettingsPayload({
          premise: {
            positioning: '',
            coreHook: '',
            protagonistStart: '',
            constraints: '',
            languageGuardrails: '',
          },
          writingRules: {
            antiAiFlavor: '',
            commonSenseRules: '',
            bannedTerms: '',
          },
        }, currentNovel?.settingsJson)

        await window.electron.novel.update(novelId, {
          settingsJson: JSON.stringify(payload),
        })

        const updated = await window.electron.novel.get(novelId)
        if (updated) setCurrentNovel(updated)
        form.setFieldsValue({
          positioning: '',
          coreHook: '',
          protagonistStart: '',
          constraints: '',
          languageGuardrails: '',
          antiAiFlavor: '',
          commonSenseRules: '',
          bannedTerms: '',
        })
        await clearPersistedDrafts()
        clearPendingResult(pendingResultKey)
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('premise.cleared'))
      },
    })
  }

  useEffect(() => {
    registerClearHandler(handleClear)
    return () => registerClearHandler(null)
  }, [registerClearHandler, currentNovel?.settingsJson, pendingResultKey])

  return (
    <WorkspacePage
      className="novel-premise-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="基础设定"
      title="基础设定"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存基础设定
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={generatingMode === 'replace'}
            disabled={Boolean(generatingMode)}
            onClick={() => void handleGenerate('replace')}
          >
            AI 生成·基础设定
          </Button>
          <Button
            loading={generatingMode === 'fill_blanks'}
            disabled={Boolean(generatingMode)}
            onClick={() => void handleGenerate('fill_blanks')}
          >
            AI 补全·空白字段
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/story-design`)}>
            进入故事设计
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
            { label: '资产就绪', value: `${assetReadiness}/4` },
            { label: '故事设计', value: storyDesignReady ? '已存在' : '待设计' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="基础字段" value={`${premiseFilledCount}/5`} tone="warm" hint="定位、核心信息、主角起点、约束、语言边界" />
          <WorkspaceMetric label="写作约束" value={`${writingRuleCount}/3`} hint="去 AI 腔、常识约束、禁用表达" />
          <WorkspaceMetric label="世界资产" value={`${assetReadiness}/4`} hint="世界、地图、人物、物品就绪度" />
        </>
      )}
    >
      {!currentNovel?.expandedBackground && !currentNovel?.synopsis ? (
        <Alert type="warning" showIcon message="背景信息未补全" />
      ) : null}

      {generationProgress ? (
        <Alert
          type="info"
          showIcon
          message={`AI 正在生成：${generationProgress.label}`}
          description={generationProgress.detail || '正在根据当前背景和资产整理基础设定。'}
        />
      ) : null}

      {pendingResult ? (
        <div className={`premise-page__pending-result ${pendingResult.appliedAt ? 'premise-page__pending-result--applied' : ''}`}>
          <div className="premise-page__pending-head">
            <div className="premise-page__pending-copy">
              <span>{pendingResult.appliedAt ? '本轮结果已填入当前表单，尚未保存。' : '本轮结果已生成，等待应用到表单。'}</span>
              <strong>{pendingResult.mode === 'fill_blanks' ? '补空结果草稿' : '基础设定首版草稿'}</strong>
              <small>
                {pendingResult.appliedAt
                  ? '你可以重新应用全部覆盖，或按“只补空字段”保留当前已写内容。'
                  : '如果中途离开了页面，结果也不会丢失，回到这里仍可继续处理。'}
              </small>
            </div>
            <Space size={[8, 8]} wrap>
              <Tag color={pendingResult.appliedAt ? 'green' : 'gold'}>
                {pendingResult.appliedAt ? '已填入未保存' : '待应用'}
              </Tag>
              <Tag>
                {pendingResult.result.steps.filter((step) => step.status === 'success' || step.status === 'warning').length}
                /
                {pendingResult.result.steps.length}
                {' '}
                步
              </Tag>
              {pendingMissingFields.length > 0 ? <Tag color="red">缺少 {pendingMissingFields.length} 项</Tag> : null}
              {pendingResult.warnings.length > 0 ? <Tag color="orange">{pendingResult.warnings.length} 条修补提示</Tag> : <Tag color="blue">无额外提示</Tag>}
            </Space>
          </div>

          {pendingMissingFields.length > 0 ? (
            <div className="premise-page__pending-warnings">
              <div>{`以下基础设定字段仍为空：${pendingMissingFields.map((field) => PREMISE_FIELD_LABELS[field] || field).join('、')}`}</div>
            </div>
          ) : null}

          {pendingResult.warnings.length > 0 ? (
            <div className="premise-page__pending-warnings">
              {pendingResult.warnings.map((warning, index) => (
                <div key={`${pendingResult.completedAt}-${index}`}>{warning}</div>
              ))}
            </div>
          ) : null}

          <div className="premise-page__pending-actions">
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void applyPendingResult('replace')}>
              {pendingResult.appliedAt ? '重新应用全部' : '应用全部'}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void applyPendingResult('fill_blanks')}>
              只补空字段
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => void handleDiscardPendingResult()}
            >
              丢弃结果
            </Button>
          </div>
        </div>
      ) : null}

      <WorkspacePanel title="基础设定编辑器">
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card">
              <Form.Item name="positioning" label="作品定位" rules={[{ required: true, message: '请写清作品定位' }]}>
                <Input.TextArea rows={8} placeholder="写清作品的时代、环境、社会压力和整体叙事方向。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="coreHook" label="核心信息" rules={[{ required: true, message: '请写清核心信息' }]}>
                <Input.TextArea rows={8} placeholder="写这部书最值得展开的核心信息，不要直接写成事件链。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="protagonistStart" label="主角起点" rules={[{ required: true, message: '请写清主角起点' }]}>
                <Input.TextArea rows={8} placeholder="写主角开局的身份、处境、资源和限制。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="constraints" label="底层约束" rules={[{ required: true, message: '请写清底层约束' }]}>
                <Input.TextArea rows={8} placeholder="写不能违背的世界规则、社会规则、代价和常识边界。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="languageGuardrails" label="语言边界">
                <Input.TextArea rows={6} placeholder="写命名、称呼、语气、禁用表达和叙述口径边界。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel title="语言与写作边界">
        <Form form={form} layout="vertical">
          <Collapse
            ghost
            className="premise-page__advanced"
            items={[
              {
                key: 'writing-rules',
                label: (
                  <div className="premise-page__collapse-label">
                    <span>展开高级写作限制</span>
                    <Space size={6} wrap>
                      {formValues.antiAiFlavor?.trim() ? <Tag color="gold">已写去 AI 腔</Tag> : <Tag>待补去 AI 腔</Tag>}
                      {formValues.commonSenseRules?.trim() ? <Tag color="green">已写常识约束</Tag> : <Tag>待补常识约束</Tag>}
                    </Space>
                  </div>
                ),
                children: (
                  <div className="guided-step__field-grid">
                    <div className="guided-step__field-card">
                      <Form.Item name="antiAiFlavor" label="去 AI 腔规则">
                        <Input.TextArea rows={8} placeholder="例如：禁止口号式总结、禁止万能情绪句、禁止对称排比收尾。" />
                      </Form.Item>
                    </div>
                    <div className="guided-step__field-card">
                      <Form.Item name="commonSenseRules" label="常识约束">
                        <Input.TextArea rows={8} placeholder="例如：人物行为必须服从信息量、伤势、资源、地图距离和制度压力。" />
                      </Form.Item>
                    </div>
                    <div className="guided-step__field-card guided-step__field-card--full">
                      <Form.Item name="bannedTerms" label="禁用表达">
                        <Input.TextArea rows={6} placeholder="写需要尽量避免的空洞词、套话和生造词。" />
                      </Form.Item>
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </WorkspacePanel>

      <WorkspacePanel title="相关模块">
        <Space wrap>
          <Button icon={<GlobalOutlined />} onClick={() => navigate(`/novels/${novelId}/world-rules`)}>世界规则</Button>
          <Button icon={<EnvironmentOutlined />} onClick={() => navigate(`/novels/${novelId}/map`)}>地图</Button>
          <Button icon={<TeamOutlined />} onClick={() => navigate(`/novels/${novelId}/characters`)}>人物</Button>
          <Button icon={<BarsOutlined />} type="primary" onClick={() => navigate(`/novels/${novelId}/story-design`)}>故事设计</Button>
        </Space>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
