import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Tabs,
  message,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { Task, WorldRulesAutoGenerateStatus } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import type { GenreWorldRules } from '../../../shared/genre-system'
import {
  createEmptyWorldRules,
  normalizeWorldRulesDraft,
  parseWorldRulesDraftJson,
} from '../../../shared/world-rules-draft'
import {
  WORLD_RULE_SECTION_DEFINITIONS,
  WORLD_RULE_SECTION_ORDER,
  type WorldRuleSectionKey,
  type WorldRulesGenerationProgressEvent,
} from '../../../shared/world-rules-generation'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
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

type RunningAction = 'all-generate' | 'section-generate' | 'section-expand' | null

const ENTITY_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'human', label: '人类' },
  { value: 'undead', label: '亡者' },
  { value: 'beast', label: '异兽' },
  { value: 'immortal', label: '长生种' },
  { value: 'nonhuman', label: '非人智慧体' },
]

const CALENDAR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'gregorian', label: '公历' },
  { value: 'regnal', label: '年号 / 王朝纪年' },
  { value: 'relative-disaster', label: '灾变相对时间' },
  { value: 'custom-era', label: '自定义纪元' },
  { value: 'future-date', label: '未来日期' },
]

const REALISM_LEVEL_OPTIONS = [
  { value: 'strict-realism', label: '严格写实' },
  { value: 'rule-realism', label: '规则写实' },
  { value: 'stylized-fantasy', label: '风格化幻想' },
]

const EMPTY_AUTO_STATUS: WorldRulesAutoGenerateStatus = {
  taskId: 0,
  novelId: 0,
  status: 'pending',
  currentSection: '',
  currentSectionLabel: '',
  completedSectionCount: 0,
  pendingSectionCount: 0,
  totalSections: 0,
  completedSections: [],
  pendingSections: [],
  failedSections: [],
  retryCount: 0,
  lastError: '',
  completed: false,
  message: '',
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

function RuleListCard({
  title,
  extra,
  children,
}: {
  title: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="novel-subpanel">
      <div className="novel-subpanel__header">
        <div className="novel-subpanel__title">{title}</div>
        {extra ? <div>{extra}</div> : null}
      </div>
      <div className="novel-subpanel__body">{children}</div>
    </section>
  )
}

function normalizeFormRules(formValues: Record<string, unknown>, genreName?: string) {
  return normalizeWorldRulesDraft(formValues, genreName)
}

function getProgressType(progress: WorldRulesGenerationProgressEvent | null): 'info' | 'success' | 'error' {
  if (!progress) return 'info'
  if (progress.status === 'failed') return 'error'
  if (progress.status === 'success') return 'success'
  return 'info'
}

export default function WorldRules({ novelId }: Props) {
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<GenreWorldRules>()
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<WorldRuleSectionKey>('overview')
  const [runningAction, setRunningAction] = useState<RunningAction>(null)
  const [generationProgress, setGenerationProgress] = useState<WorldRulesGenerationProgressEvent | null>(null)
  const [autoTask, setAutoTask] = useState<Task | null>(null)
  const [autoStatus, setAutoStatus] = useState<WorldRulesAutoGenerateStatus>(EMPTY_AUTO_STATUS)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoStopping, setAutoStopping] = useState(false)

  const parsedRules = useMemo(
    () => parseWorldRulesDraftJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const blankRules = useMemo(
    () => createEmptyWorldRules(currentNovel?.genreName),
    [currentNovel?.genreName],
  )
  const watchedValues = Form.useWatch([], form) as GenreWorldRules | undefined
  const liveRules = useMemo(
    () => normalizeFormRules((watchedValues || parsedRules) as unknown as Record<string, unknown>, currentNovel?.genreName),
    [currentNovel?.genreName, parsedRules, watchedValues],
  )

  const loadAutoStatus = useCallback(async (applyDraft = false) => {
    const latestTask = await window.electron.worldRules.getLatestAutoGenerateTask(novelId)
    setAutoTask(latestTask)

    if (!latestTask) {
      setAutoStatus(EMPTY_AUTO_STATUS)
      return null
    }

    const latestStatus = await window.electron.worldRules.getAutoGenerateStatus(latestTask.id) || EMPTY_AUTO_STATUS
    setAutoStatus(latestStatus)
    if (applyDraft && latestStatus.workingRules) {
      form.setFieldsValue(latestStatus.workingRules)
    }
    return latestTask
  }, [form, novelId])

  useEffect(() => {
    form.setFieldsValue(parsedRules)
  }, [form, parsedRules])

  useEffect(() => {
    void loadAutoStatus(true)
  }, [loadAutoStatus])

  useEffect(() => {
    const unsubscribe = window.electron.on('ai:world-rules-progress', (...args) => {
      const payload = args[0] as WorldRulesGenerationProgressEvent | undefined
      if (!payload || payload.novelId !== novelId) return
      setGenerationProgress(payload)
    })
    return unsubscribe
  }, [novelId])

  useEffect(() => {
    if (!autoTask?.id) return
    if (!['running', 'cancel_requested'].includes(autoTask.status || '')) return

    const reload = () => {
      void loadAutoStatus(true)
    }
    const unsubProgress = window.electron.on('task:progress', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) reload()
    })
    const unsubStatus = window.electron.on('task:status-change', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) reload()
    })
    const unsubComplete = window.electron.on('task:complete', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) reload()
    })
    const timer = setInterval(reload, 5000)

    return () => {
      clearInterval(timer)
      unsubProgress()
      unsubStatus()
      unsubComplete()
    }
  }, [autoTask?.id, autoTask?.status, loadAutoStatus])

  const tokenCount = useMemo(() => estimateTokens(JSON.stringify(liveRules)), [liveRules])
  const tokenStatusText = tokenCount > 1400
    ? '规则体量较大，建议优先按分区生成'
    : `~ ${tokenCount} token`
  const activeLanguageRules = [
    liveRules.writingConstraints.antiQuoteEmphasis,
    liveRules.writingConstraints.antiConceptSlogans,
    liveRules.writingConstraints.antiSymmetricLines,
  ].filter(Boolean).length
  const activeSectionMeta = useMemo(
    () => WORLD_RULE_SECTION_DEFINITIONS.find((item) => item.key === activeTab) || WORLD_RULE_SECTION_DEFINITIONS[0],
    [activeTab],
  )
  const generationPercent = generationProgress
    ? Math.max(0, Math.min(100, Math.round((generationProgress.completed / Math.max(generationProgress.total, 1)) * 100)))
    : 0
  const isGenerating = Boolean(runningAction)
  const hasRunningAutoTask = autoTask?.status === 'running' || autoTask?.status === 'cancel_requested'
  const autoPercent = autoTask
    ? autoStatus.completed
      ? 100
      : autoStatus.totalSections > 0
        ? Math.max(autoTask.status === 'running' ? 5 : 0, Math.min(95, Math.round((autoStatus.completedSectionCount / Math.max(autoStatus.totalSections, 1)) * 100)))
        : 0
    : 0
  const calendarLabel = CALENDAR_OPTIONS.find((item) => item.value === liveRules.timelineConfig.calendarType)?.label
    || liveRules.timelineConfig.calendarType
    || '未设置'

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'world-rules',
    getSnapshot: () => ({
      scope: 'form',
      ...JSON.parse(JSON.stringify(liveRules)) as GenreWorldRules,
    }),
    applySnapshot: async (nextSnapshot) => {
      form.setFieldsValue(normalizeFormRules(nextSnapshot, currentNovel?.genreName))
    },
  }), [currentNovel?.genreName, form, liveRules])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = normalizeFormRules(form.getFieldsValue(true) as unknown as Record<string, unknown>, currentNovel?.genreName)
      await window.electron.novel.update(novelId, { worldRulesJson: JSON.stringify(values) })
      await window.electron.worldRules.clearAutoGenerateDraft(novelId)
      setAutoTask(null)
      setAutoStatus(EMPTY_AUTO_STATUS)
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      message.success(getUserFacingMessage('worldRules.saved'))
    } catch (error) {
      message.error(getErrorMessage(error, 'worldRules.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const resetWorldRulesEditor = useCallback(async () => {
    await window.electron.worldRules.clearAutoGenerateDraft(novelId)
    form.resetFields()
    form.setFieldsValue(blankRules)
    setActiveTab('overview')
    setRunningAction(null)
    setGenerationProgress(null)
    setAutoTask(null)
    setAutoStatus(EMPTY_AUTO_STATUS)
    message.success(getUserFacingMessage('worldRules.flowCleared'))
  }, [blankRules, form, novelId])

  const handleClearCurrentFlow = useCallback(() => {
    if (isGenerating || hasRunningAutoTask) return

    Modal.confirm({
      title: '清空当前流程内容？',
      content: '会清空当前页的世界规则编辑内容，并丢弃未保存的自动生成草稿，但不会直接覆盖已保存规则。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: resetWorldRulesEditor,
    })
  }, [hasRunningAutoTask, isGenerating, resetWorldRulesEditor])

  useEffect(() => {
    registerClearHandler(() => {
      handleClearCurrentFlow()
    })
    return () => registerClearHandler(null)
  }, [handleClearCurrentFlow, registerClearHandler])

  const handleGenerateWorldRules = useCallback(async (mode: 'all' | 'section', action: 'generate' | 'expand') => {
    if (hasRunningAutoTask) {
      message.warning(getUserFacingMessage('worldRules.stopAutoBeforeManual'))
      return
    }

    const nextAction: RunningAction = mode === 'all'
      ? 'all-generate'
      : action === 'expand'
        ? 'section-expand'
        : 'section-generate'

    setRunningAction(nextAction)
    setGenerationProgress(null)

    try {
      const result = await window.electron.ai.generateWorldRules({
        novelId,
        mode,
        action,
        section: mode === 'section' ? activeTab : undefined,
        currentRules: liveRules,
      })

      if (result.hasPartialResult) {
        form.setFieldsValue(result.rules)
      }

      const actionLabel = action === 'expand' ? '扩写' : '生成'
      const sectionLabel = mode === 'all'
        ? '世界规则分批生成'
        : `${activeSectionMeta.label}${actionLabel}`

      if (result.failedSteps > 0 && result.hasPartialResult) {
        message.warning(getUserFacingMessage('worldRules.partialFailed', { label: sectionLabel }))
      } else if (result.failedSteps > 0) {
        message.error(getUserFacingMessage('worldRules.sectionFailed', { label: sectionLabel }))
      } else {
        message.success(mode === 'all'
          ? getUserFacingMessage('worldRules.generatedAll')
          : getUserFacingMessage('worldRules.generatedSection', { label: `${activeSectionMeta.label}${actionLabel}` }))
      }
    } catch (error) {
      message.error(getUserFacingMessage('worldRules.generationFailed', {
        detail: error instanceof Error ? error.message : '请稍后重试',
      }))
    } finally {
      setRunningAction(null)
    }
  }, [activeSectionMeta.label, activeTab, form, hasRunningAutoTask, liveRules, novelId])

  const handleStartAutoGenerate = useCallback(async () => {
    if (isGenerating) return

    setAutoLoading(true)
    setGenerationProgress(null)
    try {
      await window.electron.worldRules.startAutoGenerate(novelId, {
        currentRules: liveRules,
        sectionOrder: WORLD_RULE_SECTION_ORDER,
      })
      await loadAutoStatus(true)
      message.success(getUserFacingMessage('worldRules.autoStarted'))
    } catch (error) {
      message.error(getErrorMessage(error, 'worldRules.autoStartFailed'))
    } finally {
      setAutoLoading(false)
    }
  }, [isGenerating, liveRules, loadAutoStatus, novelId])

  const handleStopAutoGenerate = useCallback(async () => {
    if (!autoTask?.id) return

    setAutoStopping(true)
    try {
      await window.electron.workflow.cancel(autoTask.id)
      await loadAutoStatus(true)
      message.info(getUserFacingMessage('worldRules.autoStopRequested'))
    } finally {
      setAutoStopping(false)
    }
  }, [autoTask?.id, loadAutoStatus])

  const handleResumeAutoGenerate = useCallback(async () => {
    if (!autoTask?.id) return

    setAutoLoading(true)
    try {
      await window.electron.worldRules.resumeAutoGenerate(autoTask.id, liveRules)
      await loadAutoStatus(true)
      message.success(getUserFacingMessage('worldRules.autoResumed'))
    } catch (error) {
      message.error(getErrorMessage(error, 'worldRules.autoResumeFailed'))
    } finally {
      setAutoLoading(false)
    }
  }, [autoTask?.id, liveRules, loadAutoStatus])

  const genreName = currentNovel?.genreName || liveRules.genreProfile.name || ''
  const isFantasyGenre = /仙侠|武侠|玄幻|修真|奇幻|异能/.test(genreName)

  const tabItems = [
    {
      key: 'overview',
      label: '世界概览',
      children: (
        <>
          <Form.Item name={['genreProfile', 'name']} label="题材名称">
            <Input placeholder="例如：都市异能、修真仙侠" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'subgenre']} label="子类型 / 题材关键词">
            <Input placeholder="例如：悬疑成长、宗门争斗" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'worldviewTone']} label="世界观基调">
            <Input.TextArea rows={4} placeholder="概括这个世界整体的气质、运转逻辑和主要矛盾。" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'socialFrame']} label="社会框架">
            <Input.TextArea rows={4} placeholder="写清权力结构、阶层秩序、组织关系和资源分配方式。" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'narrativeFocus']} label="叙事焦点">
            <Select mode="tags" placeholder="输入叙事重点后回车" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'languageAvoidances']} label="语言避让">
            <Select mode="tags" placeholder="输入需要避开的表达后回车" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'power',
      label: '力量体系',
      children: (
        <Form.List name="powerSystems">
          {(fields, { add, remove }) => (
            <>
              <div style={{ marginBottom: 12 }}>
                <Space>
                  <Button icon={<PlusOutlined />} onClick={() => add({ appliesTo: [], levels: [] })}>添加体系</Button>
                  {isFantasyGenre && (
                    <Button icon={<RobotOutlined />} disabled={saving || isGenerating} onClick={() => void handleGenerateWorldRules('section', 'expand')}>
                      AI 深度扩展境界/资源/限制
                    </Button>
                  )}
                </Space>
              </div>
              {fields.map((field, index) => (
                <RuleListCard
                  key={field.key}
                  title={`体系 ${index + 1}`}
                  extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                >
                  <Form.Item name={[field.name, 'name']} label="体系名称" rules={[{ required: true, message: '请输入体系名称' }]}>
                    <Input placeholder="例如：修为体系、军阶体系、异能评级" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'appliesTo']} label="适用对象">
                    <Select mode="tags" placeholder="输入适用对象后回车" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'levels']} label="等级阶段">
                    <Select mode="tags" placeholder="输入等级阶段后回车" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'advancementRule']} label="晋升规则">
                    <Input.TextArea rows={3} placeholder="写清如何升级、需要什么条件、由谁决定晋升。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'limitations']} label="限制条件">
                    <Input.TextArea rows={2} placeholder="写清不能做什么、会被什么卡住。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'cost']} label="代价">
                    <Input.TextArea rows={2} placeholder="写清获得力量或资源后要付出的成本。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'taboo']} label="禁忌">
                    <Input.TextArea rows={2} placeholder="写清绝不能触碰的规则或后果。" />
                  </Form.Item>
                </RuleListCard>
              ))}
            </>
          )}
        </Form.List>
      ),
    },
    {
      key: 'species',
      label: '种族势力',
      children: (
        <>
          <Divider orientation="left">种族 / 实体</Divider>
          <Form.List name="speciesSystem">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ traits: [], commonIdentities: [] })}>添加种族</Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`种族 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'name']} label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                        <Input placeholder="例如：人类、夜行者、山海异种" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'entityType']} label="实体类型">
                        <Select options={ENTITY_TYPE_OPTIONS} />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'summary']} label="概述">
                      <Input.TextArea rows={2} placeholder="写清这个实体在世界里的定位和存在方式。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'traits']} label="特征">
                      <Select mode="tags" placeholder="输入特征后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'commonIdentities']} label="常见身份">
                      <Select mode="tags" placeholder="输入常见身份后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'relationToHumans']} label="与主流社会关系">
                      <Input.TextArea rows={2} placeholder="写清和主流秩序是合作、对立、依附还是隔绝。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'storyUse']} label="剧情作用">
                      <Input.TextArea rows={2} placeholder="写清这个种族通常承担什么剧情功能。" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>

          <Divider orientation="left">势力</Divider>
          <Form.List name="factionSystem">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Space>
                    <Button icon={<PlusOutlined />} onClick={() => add({ notableSites: [] })}>添加势力</Button>
                    {isFantasyGenre && (
                      <Button icon={<RobotOutlined />} disabled={saving || isGenerating} onClick={() => void handleGenerateWorldRules('section', 'expand')}>
                        AI 深度扩展层级/资源/冲突
                      </Button>
                    )}
                  </Space>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`势力 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'name']} label="势力名称" rules={[{ required: true, message: '请输入势力名称' }]}>
                        <Input placeholder="例如：监察司、九曜宗、北境军团" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'factionType']} label="势力类型">
                        <Input placeholder="例如：宗门、官方机构、商会、军团" />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'summary']} label="概述">
                      <Input.TextArea rows={2} placeholder="概括这个势力的定位、立场和影响力。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'structure']} label="组织结构">
                      <Input.TextArea rows={2} placeholder="写清内部层级、决策方式和执行链条。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'resources']} label="核心资源">
                      <Input.TextArea rows={2} placeholder="写清这个势力掌握的关键资源、情报或人手。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'externalRelations']} label="对外关系">
                      <Input.TextArea rows={2} placeholder="写清它与其他势力、社会和主角线的关系。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'recruitFrom']} label="吸纳来源">
                      <Input.TextArea rows={2} placeholder="写清成员主要来自哪里、通过什么路径进入。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'notableSites']} label="重要据点">
                      <Select mode="tags" placeholder="输入重要据点后回车" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>
        </>
      ),
    },
    {
      key: 'ecology',
      label: '人物生态',
      children: (
        <>
          <Form.Item name={['characterEcology', 'overview']} label="生态概览">
            <Input.TextArea rows={3} placeholder="概括这个题材下的人物生态、功能分层和角色来源。" />
          </Form.Item>
          <Form.List name={['characterEcology', 'slots']}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ preferredFactions: [], powerBias: [] })}>添加槽位</Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`槽位 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'label']} label="槽位名称" rules={[{ required: true, message: '请输入槽位名称' }]}>
                        <Input placeholder="例如：主视角、压迫源、关系纽带" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'entityType']} label="实体类型">
                        <Select options={ENTITY_TYPE_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'species']} label="对应种族">
                        <Input placeholder="例如：人类、异裔、长生种" />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'narrativeFunction']} label="叙事功能">
                      <Input.TextArea rows={2} placeholder="写清这个槽位在主线里承担什么作用。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'contextLink']} label="关联设定 / 冲突 / 场景">
                      <Input.TextArea rows={2} placeholder="写清它通常和哪些设定、冲突或场景绑定。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'preferredFactions']} label="偏向势力">
                      <Select mode="tags" placeholder="输入偏向势力后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'powerBias']} label="力量倾向">
                      <Select mode="tags" placeholder="输入力量倾向后回车" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>
        </>
      ),
    },
    {
      key: 'map',
      label: '地图蓝图',
      children: (
        <>
          <Form.Item name={['mapBlueprint', 'overview']} label="蓝图概览">
            <Input.TextArea rows={3} placeholder="概括地图层级、空间分布和主要冲突区域。" />
          </Form.Item>
          <Form.List name={['mapBlueprint', 'levels']}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ nodeTypes: [], examples: [], suggestedCount: 3 })}>添加层级</Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`层级 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 140px', gap: 12 }}>
                      <Form.Item name={[field.name, 'depth']} label="层级深度">
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'label']} label="层级名称" rules={[{ required: true, message: '请输入层级名称' }]}>
                        <Input placeholder="例如：国家、区域、据点、场景" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'suggestedCount']} label="建议数量">
                        <InputNumber min={1} max={12} style={{ width: '100%' }} />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'nodeTypes']} label="节点类型">
                      <Select mode="tags" placeholder="输入节点类型后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'relationHint']} label="结构提示">
                      <Input.TextArea rows={2} placeholder="写清这一层主要负责什么结构作用。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'examples']} label="示例">
                      <Select mode="tags" placeholder="输入示例地点后回车" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>
        </>
      ),
    },
    {
      key: 'timeline',
      label: '时间规则',
      children: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name={['timelineConfig', 'calendarType']} label="时间制度">
              <Select options={CALENDAR_OPTIONS} allowClear />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'eraName']} label="纪元名称">
              <Input placeholder="例如：公历、王朝纪年、修真历" />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'epochLabel']} label="纪元标签">
              <Input placeholder="例如：灾变后、王历、玄曜纪" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name={['timelineConfig', 'baseYearLabel']} label="起始年份">
              <Input placeholder="例如：元年、2026、王历元年" />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'relativeZeroLabel']} label="时间零点">
              <Input placeholder="例如：故事开始前、爆发当日、新王登基前" />
            </Form.Item>
          </div>
          <Form.Item name={['timelineConfig', 'displayPattern']} label="显示格式">
            <Input.TextArea rows={3} placeholder="例如：王历 X 年 / 雪月 / 战后第 N 周" />
          </Form.Item>
          <Form.Item name={['timelineConfig', 'precisionOptions']} label="时间精度">
            <Select mode="tags" placeholder="输入时间精度后回车" />
          </Form.Item>
          <Form.Item name={['timelineConfig', 'recommendedEventTypes']} label="推荐事件类型">
            <Select mode="tags" placeholder="输入事件类型后回车" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'language',
      label: '文风约束',
      children: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiQuoteEmphasis']} label="避免引号强调" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            </Card>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiConceptSlogans']} label="避免概念口号" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            </Card>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiSymmetricLines']} label="避免对称排比" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            </Card>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name={['writingConstraints', 'realismLevel']} label="真实度层级"><Select options={REALISM_LEVEL_OPTIONS} placeholder="选择文本真实度基线" /></Form.Item>
            <Form.Item name={['writingConstraints', 'forbiddenPhrases']} label="禁用 AI 腔"><Select mode="tags" placeholder="输入禁用表达后回车" /></Form.Item>
          </div>
          <Form.Item name={['writingConstraints', 'narrationStyle']} label="叙述风格"><Input.TextArea rows={3} placeholder="写清叙述应偏冷静、克制、直接还是抒情。" /></Form.Item>
          <Form.Item name={['writingConstraints', 'dialogueStyle']} label="对话风格"><Input.TextArea rows={3} placeholder="写清人物说话的语气、节奏和用词边界。" /></Form.Item>
          <Form.Item name={['writingConstraints', 'sciencePolicy']} label="科学边界"><Input.TextArea rows={2} placeholder="例如现代题材先守现实常识，幻想题材明确哪些超常现象成立。" /></Form.Item>
          <Form.Item name={['writingConstraints', 'physicsPolicy']} label="物理边界"><Input.TextArea rows={2} placeholder="写清行动、伤势、破坏、移动和恢复速度的底线。" /></Form.Item>
          <Form.Item name={['writingConstraints', 'commonSenseFocus']} label="常识重点"><Select mode="tags" placeholder="输入需要长期校验的常识重点后回车" /></Form.Item>
          <Form.Item name={['writingConstraints', 'contextAlignmentFocus']} label="上下文对齐重点"><Select mode="tags" placeholder="输入需要长期对齐的背景或规则后回车" /></Form.Item>
          <Form.Item name={['writingConstraints', 'extraRules']} label="额外规则"><Select mode="tags" placeholder="输入额外规则后回车" /></Form.Item>
        </>
      ),
    },
  ]

  const autoTaskActions = (
    <Space wrap>
      {!autoTask || !['running', 'cancel_requested', 'paused'].includes(autoTask.status || '') ? <Button type="primary" icon={<RobotOutlined />} loading={autoLoading} disabled={saving || isGenerating} onClick={() => void handleStartAutoGenerate()}>后台连续生成</Button> : null}
      {autoTask?.status === 'paused' ? <Button icon={<ReloadOutlined />} loading={autoLoading} disabled={saving || isGenerating} onClick={() => void handleResumeAutoGenerate()}>继续生成</Button> : null}
      {hasRunningAutoTask ? <Button danger icon={<StopOutlined />} loading={autoStopping} onClick={() => void handleStopAutoGenerate()}>停止生成</Button> : null}
    </Space>
  )

    return (
      <WorkspacePage
        eyebrow="世界规则"
        title="世界规则"
        actions={(
        <Space wrap>
          <Button icon={<RobotOutlined />} loading={runningAction === 'all-generate'} disabled={saving || isGenerating || hasRunningAutoTask || autoTask?.status === 'paused'} onClick={() => void handleGenerateWorldRules('all', 'generate')}>
            {'生成全部分区'}
          </Button>
          <Button icon={<ReloadOutlined />} loading={runningAction === 'section-generate'} disabled={saving || isGenerating || hasRunningAutoTask || autoTask?.status === 'paused'} onClick={() => void handleGenerateWorldRules('section', 'generate')}>
            {'生成当前分区'}
          </Button>
          <Button icon={<PlusOutlined />} loading={runningAction === 'section-expand'} disabled={saving || isGenerating || hasRunningAutoTask || autoTask?.status === 'paused'} onClick={() => void handleGenerateWorldRules('section', 'expand')}>
            {'扩写当前分区'}
          </Button>
          <Button danger icon={<DeleteOutlined />} disabled={saving || isGenerating || hasRunningAutoTask} onClick={handleClearCurrentFlow}>
            {'清空当前流程'}
          </Button>
          {autoTaskActions}
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={isGenerating || hasRunningAutoTask} onClick={handleSave}>
            {'保存规则'}
          </Button>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="力量体系" value={liveRules.powerSystems.length} tone="warm" hint="成长规则与限制条件" />
          <WorkspaceMetric label="种族实体" value={liveRules.speciesSystem.length} hint="可与人物系统联动的种族 / 实体" />
          <WorkspaceMetric label="组织势力" value={liveRules.factionSystem.length} tone="cool" hint="可与地图、人物、剧情挂接的势力" />
          <WorkspaceMetric label="地图层级" value={liveRules.mapBlueprint.levels.length} hint={tokenStatusText} />
        </>
      )}
      contextSummary={<WorkspaceContextSummary items={[{ label: '题材', value: liveRules.genreProfile.name || currentNovel?.genreName || '未设置' }, { label: '当前分区', value: activeSectionMeta.label }, { label: '时间制度', value: calendarLabel }, { label: '文风约束', value: `${activeLanguageRules} 项硬约束 / ${liveRules.writingConstraints.forbiddenPhrases.length} 条禁用语` }]} />}
    >
      {generationProgress ? (
        <Alert
          type={getProgressType(generationProgress)}
          showIcon
          message={`${generationProgress.label} - ${generationProgress.status === 'failed' ? '失败' : generationProgress.status === 'success' ? '已完成' : '生成中'}`}
          description={<div style={{ display: 'grid', gap: 12 }}><Progress percent={generationPercent} size="small" status={generationProgress.status === 'failed' ? 'exception' : generationProgress.status === 'success' && generationProgress.completed >= generationProgress.total ? 'success' : 'active'} /><div>{generationProgress.detail || '正在处理当前分区...'}</div>{generationProgress.warning ? <div>{generationProgress.warning}</div> : null}</div>}
          style={{ marginBottom: 18 }}
        />
      ) : tokenCount > 1400 ? (
        <Alert type="warning" message={`当前世界规则约 ${tokenCount} token，建议后续优先按分区生成。`} showIcon style={{ marginBottom: 18 }} />
      ) : (
        <div className="novel-pill" style={{ marginBottom: 18 }}>{tokenCount > 0 ? `当前规则体量约 ${tokenCount} token` : '当前规则体量尚未形成'}</div>
      )}
      <WorkspacePanel title="后台连续生成" extra={autoTaskActions}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Alert
            type={autoTask?.status === 'failed' ? 'error' : autoTask?.status === 'paused' ? 'warning' : autoTask?.status === 'success' ? 'success' : 'info'}
            showIcon
            message={autoTask ? `状态：${autoTask.status || 'idle'}` : '当前没有后台任务'}
            description={autoTask
              ? [autoStatus.currentSectionLabel ? `当前分区：${autoStatus.currentSectionLabel}` : '', `已完成 ${autoStatus.completedSectionCount}/${autoStatus.totalSections || WORLD_RULE_SECTION_ORDER.length}`, autoStatus.lastError || autoStatus.message || '']
                .filter(Boolean)
                .join(' · ')
              : '需要时再启动，系统会按分区连续生成当前草稿。'}
          />
          {autoTask ? (
            <Progress percent={autoPercent} status={autoTask.status === 'failed' ? 'exception' : autoTask.status === 'success' ? 'success' : 'active'} />
          ) : null}
          {autoStatus.failedSections.length > 0 ? (
            <div className="novel-note-list">
              {autoStatus.failedSections.map((item) => (
                <div key={item.key} className="novel-note-list__item">{`${item.label}：${item.error}`}</div>
              ))}
            </div>
          ) : null}
        </div>
      </WorkspacePanel>
      <WorkspacePanel title="分区编辑器" extra={<div className="novel-pill">{`当前分区：${activeSectionMeta.label}`}</div>}>
        <Form form={form} layout="vertical" disabled={hasRunningAutoTask}>
          <Tabs className="novel-editor-tabs" items={tabItems} activeKey={activeTab} onChange={(key) => setActiveTab(key as WorldRuleSectionKey)} />
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
