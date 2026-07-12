import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Progress, Select, Space, message } from 'antd'
import {
  EditOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { buildNovelBlurbPayload, parseNovelBlurbDocument, type NovelBlurbDocument } from '../../../shared/blurb'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { buildPremiseSummary, buildStoryDesignSummary, parseStorySettingsSnapshot } from '../../../shared/story-settings'
import { buildThemeVoiceSummary, parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import { useNovelStore } from '../../../stores/novel.store'
import { useAuthorWorkModeStore } from '../../../stores/author-work-mode.store'
import { normalizeOptionalNumber, parseDraftJson, type DraftFieldDefinition } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import StepAIAssistant, { type StepAIAssistantPatch } from '../components/StepAIAssistant'
import type { QualityDashboardData } from '../../../types'
import {
  buildAuthorWorkflowSummary,
  getAuthorWorkModeLabel,
  resolveAuthorWorkflowHref,
  resolveSuggestedAuthorWorkMode,
} from '../author-workflow'
import {
  OVERVIEW_ZERO_STATE_ACTIONS,
  resolveOverviewDisplayState,
} from '../overview-presentation'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context-core'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import {
  EMPTY_WORKFLOW_STATS,
  GUIDED_STEP_ORDER,
  GUIDED_STEP_TARGET_ROUTE,
  GUIDED_WORKFLOW_PHASES,
  getAssetBloatSignal,
  getGuidedStepProgressMap,
  loadWorkflowStats,
  type WorkflowStats,
} from '../workflow'

interface Props {
  novelId: number
}

interface OverviewFormValues {
  title: string
  synopsis: string
  userBackground: string
  expandedBackground: string
  targetWords: number
}

type OverviewAssistantPatch = StepAIAssistantPatch & Partial<OverviewFormValues>

type PackagingDraft = NovelBlurbDocument

const EMPTY_PACKAGING_DRAFT: PackagingDraft = {
  titleCandidates: [],
  oneLineHook: '',
  platformBlurbs: {},
  volumeNamingStyle: '',
}

const OVERVIEW_AI_FIELDS: DraftFieldDefinition[] = [
  { key: 'title', label: '书名', hint: '2-8 个中文字符优先，能体现题材记忆点，不要像营销标题。' },
  { key: 'synopsis', label: '一句话简介', hint: '写清主角处境、目标和最硬冲突，控制在 80 字以内。' },
  { key: 'userBackground', label: '原始背景', hint: '保留用户最初想法，补足人物处境、目标、阻力和开局压力。' },
  { key: 'expandedBackground', label: '扩展背景', hint: '展开环境压力、资源条件、制度成本、题材生态和可持续冲突。' },
  { key: 'targetWords', label: '目标字数', type: 'number', hint: '短篇测试不超过 50000；长篇可按项目目标建议。' },
]

const OVERVIEW_AI_TOOLS = [
  {
    id: 'read_project_context',
    label: '读取项目上下文',
    description: '读取题材、简介、项目立项、基础设定、主题文风、世界规则和终局设计摘要。',
  },
  {
    id: 'draft_overview_patch',
    label: '生成基础补丁',
    description: '把模糊剧情转成可回填的书名、简介、背景和目标字数候选稿。',
  },
  {
    id: 'targeted_field_update',
    label: '定向字段更新',
    description: '按用户要求只更新指定字段，其它字段保持不动。',
  },
  {
    id: 'anti_ai_style_check',
    label: '反 AI 味自检',
    description: '检查模板句、工作流泄露、空泛套话和过度解释。',
  },
]

function normalizeTargetWords(value: unknown): number {
  const next = normalizeOptionalNumber(value)
  if (!next) return 200000
  return Math.max(1000, next)
}

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<OverviewFormValues>()
  const [saving, setSaving] = useState(false)
  const [packagingSaving, setPackagingSaving] = useState(false)
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [packagingDraft, setPackagingDraft] = useState<PackagingDraft>(parseNovelBlurbDocument(currentNovel?.blurbJson))
  const [packagingGenerating, setPackagingGenerating] = useState(false)
  const [qualitySummary, setQualitySummary] = useState<Pick<QualityDashboardData, 'productionReadiness' | 'batchHealth' | 'continuityHealth'> | null>(null)
  const authorMode = useAuthorWorkModeStore((state) => state.mode)
  const syncSuggestedAuthorMode = useAuthorWorkModeStore((state) => state.syncSuggestedMode)

  useEffect(() => {
    form.setFieldsValue({
      title: currentNovel?.title || '',
      synopsis: currentNovel?.synopsis || '',
      userBackground: currentNovel?.userBackground || '',
      expandedBackground: currentNovel?.expandedBackground || '',
      targetWords: currentNovel?.targetWords ?? 200000,
    })
  }, [currentNovel, form])

  useEffect(() => {
    setPackagingDraft(parseNovelBlurbDocument(currentNovel?.blurbJson))
  }, [currentNovel?.blurbJson])

  useEffect(() => {
    let active = true

    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (active) setStats(workflowStats)
    }).catch(console.error)

    void window.electron.quality.getDashboard(novelId)
      .then((result) => {
        if (!active) return
        setQualitySummary({
          productionReadiness: result.productionReadiness,
          batchHealth: result.batchHealth,
          continuityHealth: result.continuityHealth,
        })
      })
      .catch((error) => {
        console.warn('Failed to load overview quality summary', error)
        if (active) setQualitySummary(null)
      })

    return () => {
      active = false
    }
  }, [novelId])

  const projectBrief = useMemo(
    () => parseProjectBriefSnapshot(currentNovel?.projectBriefJson),
    [currentNovel?.projectBriefJson],
  )
  const storySettings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const themeVoice = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )
  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const packagingPayload = useMemo(
    () => buildNovelBlurbPayload(packagingDraft, currentNovel?.blurbJson),
    [currentNovel?.blurbJson, packagingDraft],
  )
  const persistedPackagingPayload = useMemo(
    () => buildNovelBlurbPayload(parseNovelBlurbDocument(currentNovel?.blurbJson), currentNovel?.blurbJson),
    [currentNovel?.blurbJson],
  )
  const packagingDirty = packagingPayload !== persistedPackagingPayload

  const targetWords = currentNovel?.targetWords ?? 0
  const wordProgress = targetWords > 0 ? Math.min(100, Math.round((stats.totalWords / targetWords) * 100)) : 0
  const chapterProgress = stats.chapterCount > 0
    ? Math.round((stats.completedChapterCount / stats.chapterCount) * 100)
    : 0

  const guidedProgressMap = useMemo(
    () => getGuidedStepProgressMap(currentNovel, stats),
    [currentNovel, stats],
  )
  const workflowStepReadyCount = GUIDED_STEP_ORDER.filter((stepKey) => guidedProgressMap[stepKey]?.isComplete).length
  const workflowStageCards = useMemo(() => GUIDED_WORKFLOW_PHASES.map((phase, index) => {
    const phaseProgress = phase.stepKeys.map((stepKey) => guidedProgressMap[stepKey])
    const done = phaseProgress.filter((progress) => progress?.isComplete).length
    const total = phase.stepKeys.length
    const completedUnits = phaseProgress.reduce((sum, progress) => sum + (progress?.completedCount || 0), 0)
    const totalUnits = phaseProgress.reduce((sum, progress) => sum + (progress?.totalCount || 0), 0)
    const firstPendingStep = phase.stepKeys.find((stepKey) => !guidedProgressMap[stepKey]?.isComplete) || phase.stepKeys[0]

    return {
      key: phase.key,
      title: `${index + 1}. ${phase.title}`,
      summary: phase.summary,
      ready: done >= total,
      progressText: `${done}/${total}`,
      detailText: totalUnits > 0 ? `${completedUnits}/${totalUnits} 项` : '待开始',
      route: GUIDED_STEP_TARGET_ROUTE[firstPendingStep],
    }
  }), [guidedProgressMap])

  const suggestedAuthorMode = useMemo(
    () => resolveSuggestedAuthorWorkMode(currentNovel, stats, qualitySummary),
    [currentNovel, qualitySummary, stats],
  )
  const selectedAuthorMode = authorMode || suggestedAuthorMode.mode
  const authorWorkflow = useMemo(
    () => buildAuthorWorkflowSummary(currentNovel, stats, qualitySummary, selectedAuthorMode),
    [currentNovel, qualitySummary, selectedAuthorMode, stats],
  )
  const displayState = useMemo(
    () => resolveOverviewDisplayState(stats, authorWorkflow),
    [authorWorkflow, stats],
  )
  const assetBloat = useMemo(() => getAssetBloatSignal(stats), [stats])
  const nextFocus = authorWorkflow.primaryTask.title
  const keyGapCount = GUIDED_STEP_ORDER.length - workflowStepReadyCount
  const hasContextLag = stats.staleChapterCount > 0 || stats.staleCheckpointCount > 0 || stats.staleAssetCount > 0
  const writingStageValue = displayState.isZeroState
    ? '未开写'
    : stats.chapterCount > 0
      ? `已写 ${stats.completedChapterCount}/${stats.chapterCount} 章`
      : '已开写'
  const contextStatusValue = displayState.isZeroState
    ? '未建立'
    : hasContextLag
      ? '待同步'
      : '稳定'
  const revisionRiskValue = authorWorkflow.blockers.some((item) => item.severity === 'high')
    ? '有阻塞'
    : stats.revisionTaskCount > 0
      ? '待清理'
      : '稳定'

  useEffect(() => {
    syncSuggestedAuthorMode(suggestedAuthorMode.mode)
  }, [suggestedAuthorMode.mode, syncSuggestedAuthorMode])

  const applyOverviewDraft = useCallback((draft: Partial<OverviewFormValues>) => {
    const currentValues = form.getFieldsValue(true)

    form.setFieldsValue({
      ...currentValues,
      title: typeof draft.title === 'string' ? draft.title : currentValues.title,
      synopsis: typeof draft.synopsis === 'string' ? draft.synopsis : currentValues.synopsis,
      userBackground: typeof draft.userBackground === 'string' ? draft.userBackground : currentValues.userBackground,
      expandedBackground: typeof draft.expandedBackground === 'string' ? draft.expandedBackground : currentValues.expandedBackground,
      targetWords: normalizeTargetWords(draft.targetWords ?? currentValues.targetWords),
    })
  }, [form])

  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<OverviewFormValues>({
    novelId,
    pageKey: 'overview',
    applyDraft: applyOverviewDraft,
  })

  const overviewAssistantValues = Form.useWatch([], form) as OverviewAssistantPatch | undefined

  const handleApplyOverviewAssistantDraft = useCallback((patch: Partial<OverviewAssistantPatch>) => {
    const currentValues = form.getFieldsValue(true)
    const mergedDraft: OverviewFormValues = {
      ...currentValues,
      title: typeof patch.title === 'string' ? patch.title : currentValues.title,
      synopsis: typeof patch.synopsis === 'string' ? patch.synopsis : currentValues.synopsis,
      userBackground: typeof patch.userBackground === 'string' ? patch.userBackground : currentValues.userBackground,
      expandedBackground: typeof patch.expandedBackground === 'string' ? patch.expandedBackground : currentValues.expandedBackground,
      targetWords: normalizeTargetWords(patch.targetWords ?? currentValues.targetWords),
    }

    applyOverviewDraft(mergedDraft)
    void saveAppliedDraft(mergedDraft, [], 'overview', {
      inputSummary: '步骤 AI 助手候选补丁',
      rawOutputs: [JSON.stringify(patch)],
    }).catch(console.error)
  }, [applyOverviewDraft, form, saveAppliedDraft])

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'overview',
    getSnapshot: () => {
      const values = form.getFieldsValue(true)
      return {
        scope: 'form',
        fields: {
          title: values.title || '',
          synopsis: values.synopsis || '',
          userBackground: values.userBackground || '',
          expandedBackground: values.expandedBackground || '',
          targetWords: normalizeTargetWords(values.targetWords),
        },
      }
    },
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<OverviewFormValues>
        : {}
      applyOverviewDraft({
        title: typeof fields.title === 'string' ? fields.title : undefined,
        synopsis: typeof fields.synopsis === 'string' ? fields.synopsis : undefined,
        userBackground: typeof fields.userBackground === 'string' ? fields.userBackground : undefined,
        expandedBackground: typeof fields.expandedBackground === 'string' ? fields.expandedBackground : undefined,
        targetWords: normalizeTargetWords(fields.targetWords),
      })
    },
    persistPreview: async (nextSnapshot, preview) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<OverviewFormValues>
        : {}
      await saveAppliedDraft({
        title: typeof fields.title === 'string' ? fields.title : '',
        synopsis: typeof fields.synopsis === 'string' ? fields.synopsis : '',
        userBackground: typeof fields.userBackground === 'string' ? fields.userBackground : '',
        expandedBackground: typeof fields.expandedBackground === 'string' ? fields.expandedBackground : '',
        targetWords: normalizeTargetWords(fields.targetWords),
      }, preview.warnings, 'overview', {
        inputSummary: 'AI质量修复',
        rawOutputs: [JSON.stringify(preview.patchedSnapshot)],
      })
    },
  }), [applyOverviewDraft, form, saveAppliedDraft])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)

    try {
      const finalPayload = {
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        userBackground: values.userBackground.trim(),
        expandedBackground: values.expandedBackground.trim(),
        targetWords: values.targetWords,
        blurbJson: buildNovelBlurbPayload(packagingDraft, currentNovel?.blurbJson),
      }
      await window.electron.novel.update(novelId, finalPayload)

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await finalizeDraft(finalPayload)
      await clearDraft()
      message.success(getUserFacingMessage('overview.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'overview.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleSavePackaging = async () => {
    setPackagingSaving(true)

    try {
      await window.electron.novel.update(novelId, { blurbJson: packagingPayload })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      message.success(getUserFacingMessage('overview.packagingSaved'))
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('overview.packagingSaveFailed'))
    } finally {
      setPackagingSaving(false)
    }
  }

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: '清空基础信息？',
      content: '会清空书名、简介、背景、目标字数和包装信息，并直接保存为空白基线。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const clearedPayload = {
          title: '',
          synopsis: '',
          userBackground: '',
          expandedBackground: '',
          targetWords: 200000,
          blurbJson: buildNovelBlurbPayload(EMPTY_PACKAGING_DRAFT, currentNovel?.blurbJson),
        }

        await window.electron.novel.update(novelId, clearedPayload)
        const updated = await window.electron.novel.get(novelId)
        if (updated) setCurrentNovel(updated)
        form.setFieldsValue({
          title: '',
          synopsis: '',
          userBackground: '',
          expandedBackground: '',
          targetWords: 200000,
        })
        setPackagingDraft(EMPTY_PACKAGING_DRAFT)
        await clearDraft()
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('overview.cleared'))
      },
    })
  }, [clearDraft, currentNovel?.blurbJson, form, novelId, notifyWorkspaceMutation, setCurrentNovel])

  useEffect(() => {
    registerClearHandler(() => {
      handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  return (
    <WorkspacePage
      className="novel-overview-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="基础总览"
      title="项目总览"
      description="统一查看基础设定、素材和下一步重点。"
      actions={(
        <Button
          type="primary"
          icon={<EditOutlined />}
          onClick={() => navigate(resolveAuthorWorkflowHref(novelId, authorWorkflow.primaryTask.entryPage))}
        >
            {authorWorkflow.primaryTask.actionLabel}
        </Button>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '开书路径', value: currentNovel?.launchMode === 'fast_launch' ? '极速开书' : '专业长篇' },
            { label: '当前模式', value: getAuthorWorkModeLabel(selectedAuthorMode) },
            { label: '当前主任务', value: nextFocus },
            { label: '正文阶段', value: displayState.isZeroState ? '首章前' : '正文推进中' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric
            label="正文阶段"
            value={writingStageValue}
            tone="warm"
            hint={displayState.isZeroState ? '当前优先进入首章启动动作。' : `累计 ${stats.totalWords.toLocaleString()} 字`}
          />
          <WorkspaceMetric
            label="流程完成"
            value={`${workflowStepReadyCount}/${GUIDED_STEP_ORDER.length}`}
            hint={keyGapCount > 0 ? `仍有 ${keyGapCount} 个关键步骤待补齐` : '关键创作链路已基本闭合'}
          />
          <WorkspaceMetric
            label="上下文状态"
            value={contextStatusValue}
            tone="cool"
            hint={displayState.isZeroState
              ? '正文与长程记忆尚未建立，不展示连续性噪音。'
              : hasContextLag
                ? '存在待同步章节、检查点或资产。'
                : '当前正文与上下文状态保持一致。'}
          />
          {displayState.showRevisionMetric ? (
            <WorkspaceMetric
              label="修订风险"
              value={revisionRiskValue}
              hint={stats.revisionTaskCount > 0 ? `当前有 ${stats.revisionTaskCount} 条修订任务待处理` : '当前链路稳定，可继续推进正文或结构收口'}
            />
          ) : null}
        </>
      )}
    >
      {!displayState.isZeroState && (!currentNovel?.synopsis || !currentNovel?.expandedBackground) ? (
        <Alert
          type="warning"
          showIcon
          message="简介或扩展背景还不完整。"
        />
      ) : null}
      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复最近一次未保存的 AI 草稿"
          description="当前表单包含最近一次已应用但尚未保存的草稿内容。保存基础信息后会自动清除。"
        />
      ) : null}
      {assetBloat.risk !== 'none' ? (
        <Alert
          type={assetBloat.risk === 'high' ? 'warning' : 'info'}
          showIcon
          message="素材增长过快提示"
          action={(
            <Button size="small" onClick={() => navigate(`/novels/${novelId}/${stats.outlineCount > 0 ? 'writing' : 'outline'}`)}>
              {stats.outlineCount > 0 ? '进入正文' : '整理成大纲'}
            </Button>
          )}
        />
      ) : null}

      <WorkspacePanel
        className="novel-overview-page__focus-panel"
        title={displayState.isZeroState ? '首章启动' : '今天最该做什么'}
        description={displayState.isZeroState
          ? '当前处于 0 章 / 0 字阶段，先给启动动作，再给统计与管理信息。'
          : '总览页只保留当前最值钱的下一步；详细模式切换仍放在创作向导。'}
        extra={<div className="novel-pill">{getAuthorWorkModeLabel(selectedAuthorMode)}</div>}
      >
        <div className="workspace-stack-16">
          <div className="guided-step__action-card">
            <div className="guided-step__action-head">
              <div className="guided-step__action-copy">
                <strong>{authorWorkflow.primaryTask.title}</strong>
                <span>{authorWorkflow.primaryTask.reason}</span>
              </div>
              <Space wrap>
                <Button type="primary" onClick={() => navigate(resolveAuthorWorkflowHref(novelId, authorWorkflow.primaryTask.entryPage))}>
                  {authorWorkflow.primaryTask.actionLabel}
                </Button>
                <Button onClick={() => navigate(`/novels/${novelId}/guide`)}>
                  打开创作向导
                </Button>
              </Space>
            </div>
          </div>
        </div>
      </WorkspacePanel>

      {displayState.isZeroState ? (
        <WorkspacePanel
          className="novel-overview-page__alternate-panel"
          title="首章启动路径"
          description="先给动作，再给统计；新项目优先在这里落成第一章入口。"
        >
          <div className="guided-step__action-grid">
            {OVERVIEW_ZERO_STATE_ACTIONS.map((task) => (
              <div key={task.id} className="guided-step__action-card">
                <div className="guided-step__action-copy">
                  <strong>{task.title}</strong>
                  <span>{task.description}</span>
                </div>
                <Button onClick={() => navigate(resolveAuthorWorkflowHref(novelId, task.entryPage))}>
                  {task.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      ) : authorWorkflow.alternateTasks.length > 0 ? (
        <WorkspacePanel
          className="novel-overview-page__alternate-panel"
          title="备选路径"
          description="如果你不打算执行当前主任务，可以从这两个次优动作继续推进。"
        >
          <div className="guided-step__action-grid">
            {authorWorkflow.alternateTasks.slice(0, 2).map((task) => (
              <div key={task.id} className="guided-step__action-card">
                <div className="guided-step__action-copy">
                  <strong>{task.title}</strong>
                  <span>{task.reason}</span>
                </div>
                <Button onClick={() => navigate(resolveAuthorWorkflowHref(novelId, task.entryPage))}>
                  {task.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}

      {displayState.showBlockersPanel ? (
        <WorkspacePanel
          className="novel-overview-page__signal-panel"
          title="当前阻塞项"
          description="这里回答为什么现在不建议继续下一步，并给出直接处理入口。"
        >
          <div className="novel-issue-list">
            {authorWorkflow.blockers.slice(0, 2).map((blocker) => (
              <div key={blocker.id} className="novel-issue-item novel-issue-item--compact">
                <div className="novel-issue-item__head novel-issue-item__head--inline">
                  <strong>{blocker.title}</strong>
                </div>
                <div className="novel-issue-item__desc novel-issue-item__desc--inline">{blocker.reason}</div>
                <Button size="small" onClick={() => navigate(resolveAuthorWorkflowHref(novelId, blocker.entryPage))}>
                  {blocker.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}

      {displayState.showImpactPanel ? (
        <WorkspacePanel
          className="novel-overview-page__signal-panel"
          title="风险和影响"
          description="这里回答最近的变更正在波及什么，避免作者靠记忆自己回查。"
        >
          <div className="novel-note-list">
            {authorWorkflow.impactNotices.slice(0, 2).map((notice) => (
              <div key={notice.id} className="novel-note-list__item">{`${notice.title}：${notice.reason}`}</div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}

      {displayState.showProgressPanel ? (
        <WorkspacePanel className="novel-overview-page__progress-panel" title="推进热度" description="进入正文后再看字数与章节进度，避免起步阶段被弱信息占住视线。">
          <div className="workspace-stack-16">
            <div>
              <div className="workspace-row workspace-row--between workspace-margin-bottom-6">
                <strong>字数进度</strong>
                <span>{wordProgress}%</span>
              </div>
              <Progress percent={wordProgress} showInfo={false} />
            </div>
            <div>
              <div className="workspace-row workspace-row--between workspace-margin-bottom-6">
                <strong>章节进度</strong>
                <span>{chapterProgress}%</span>
              </div>
              <Progress percent={chapterProgress} showInfo={false} />
            </div>
          </div>
        </WorkspacePanel>
      ) : null}

      {displayState.showHealthPanel && qualitySummary ? (
        <WorkspacePanel
          className="novel-overview-page__health-panel"
          title={authorWorkflow.blockers.length > 0 ? '继续扩批前先看这些风险' : '百万字健康速览'}
          description="健康信息降为次级区，只在进入正文后帮助你判断能否继续扩批。"
        >
          <div className="workspace-grid-auto-220">
            <div className="guided-step__fact-card">
              <span>生产就绪度</span>
              <strong>{qualitySummary.productionReadiness.readyRate}%</strong>
              <small>{qualitySummary.productionReadiness.summary}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>最近批次</span>
              <strong>{qualitySummary.batchHealth.chapterIds.length > 0 ? `${qualitySummary.batchHealth.chapterIds.length} 章` : '空闲'}</strong>
              <small>{qualitySummary.batchHealth.summary}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>连续性健康</span>
              <strong>{`${qualitySummary.continuityHealth.staleCheckpointCount} / ${qualitySummary.continuityHealth.worldConflictCount}`}</strong>
              <small>{`检查点待刷新 ${qualitySummary.continuityHealth.staleCheckpointCount}，世界冲突 ${qualitySummary.continuityHealth.worldConflictCount}。`}</small>
            </div>
          </div>
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel
        className="novel-overview-page__basic-panel"
        title="基础信息"
        description="基础信息已降到次级区；需要时再集中编辑，而不是一进来先管理表单。"
        extra={(
          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存基础信息
            </Button>
          </Space>
        )}
      >
        <StepAIAssistant<OverviewAssistantPatch>
          novel={currentNovel}
          novelId={novelId}
          stepKey="basics"
          stepTitle="小说基础信息"
          fields={OVERVIEW_AI_FIELDS}
          values={{
            title: overviewAssistantValues?.title || currentNovel?.title || '',
            synopsis: overviewAssistantValues?.synopsis || currentNovel?.synopsis || '',
            userBackground: overviewAssistantValues?.userBackground || currentNovel?.userBackground || '',
            expandedBackground: overviewAssistantValues?.expandedBackground || currentNovel?.expandedBackground || '',
            targetWords: overviewAssistantValues?.targetWords || currentNovel?.targetWords || 200000,
          }}
          tools={OVERVIEW_AI_TOOLS}
          extraContext={[
            { label: '当前步骤', value: '创建/维护小说基础信息' },
            { label: '项目立项摘要', value: buildProjectBriefSummary(projectBrief) },
            { label: '基础设定摘要', value: buildPremiseSummary(storySettings.premise) },
            { label: '故事设计摘要', value: buildStoryDesignSummary(storySettings.storyDesign) },
            { label: '主题文风摘要', value: buildThemeVoiceSummary(themeVoice) },
            {
              label: '世界规则摘要',
              value: [
                worldRules.mapBlueprint.overview,
                worldRules.factionSystem.length > 0 ? `${worldRules.factionSystem.length} 个势力` : '',
                worldRules.speciesSystem.length > 0 ? `${worldRules.speciesSystem.length} 个种族` : '',
              ].filter(Boolean).join('；'),
            },
            { label: '短篇测试上限', value: '临时测试可把目标字数控制在 50000 字以内' },
          ]}
          onApplyDraft={handleApplyOverviewAssistantDraft}
        />
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid guided-step__field-grid--basics">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="title" label="书名" rules={[{ required: true, message: '请填写书名' }]}>
                <Input placeholder="例如：北境回潮" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetWords" label="目标字数" rules={[{ required: true, message: '请填写目标字数' }]}>
                <InputNumber min={1000} step={1000} className="workspace-input-number-full" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="synopsis" label="一句话简介" rules={[{ required: true, message: '请填写简介' }]}>
                <Input.TextArea rows={6} placeholder="写清主角处境、目标和最大阻碍。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                <Input.TextArea rows={8} placeholder="写灵感起点、氛围和人物困局。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                <Input.TextArea rows={8} placeholder="补齐环境压力、制度成本和社会结构。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel
        className="novel-overview-page__packaging-panel"
        title="包装信息"
        description="生成后可单独保存，不受基础信息必填校验影响。"
        extra={(
          <Space wrap>
            <Button
              loading={packagingGenerating}
              onClick={() => void (async () => {
                setPackagingGenerating(true)
                try {
                  const outputs = await window.electron.ai.runPrompt({
                    novelId,
                    modelConfigId: currentNovel?.modelConfigId,
                    messages: [{
                      role: 'user',
                      content: [
                        '你是中文网络小说包装编辑，只输出 JSON，不要解释，不要 Markdown。',
                        `书名：${form.getFieldValue('title') || currentNovel?.title || ''}`,
                        `一句话简介：${form.getFieldValue('synopsis') || currentNovel?.synopsis || ''}`,
                        `扩展背景：${form.getFieldValue('expandedBackground') || currentNovel?.expandedBackground || ''}`,
                        projectBrief.readyCount > 0 ? `项目立项：${buildProjectBriefSummary(projectBrief)}` : '',
                        storySettings.storyDesign.mainPlot ? `故事设计：${buildStoryDesignSummary(storySettings.storyDesign)}` : '',
                        themeVoice.readyCount > 0 ? `主题与文风：${buildThemeVoiceSummary(themeVoice)}` : '',
                        '返回：',
                        '- titleCandidates: 5 个可上架书名候选',
                        '- oneLineHook: 1 句导语',
                        '- platformBlurbs.qidian / tomato / publishing: 3 种平台简介',
                        '- volumeNamingStyle: 卷名风格规范',
                        '{"titleCandidates":[""],"oneLineHook":"","platformBlurbs":{"qidian":"","tomato":"","publishing":""},"volumeNamingStyle":""}',
                      ].filter(Boolean).join('\n'),
                    }],
                  })
                  const first = Array.isArray(outputs) ? outputs[0] : ''
                  if (!first) return
                  const parsed = parseDraftJson<PackagingDraft>(first)
                  setPackagingDraft((current) => ({
                    titleCandidates: Array.isArray(parsed.titleCandidates)
                      ? parsed.titleCandidates.filter((item): item is string => typeof item === 'string')
                      : current.titleCandidates,
                    oneLineHook: typeof parsed.oneLineHook === 'string' ? parsed.oneLineHook : current.oneLineHook,
                    platformBlurbs: {
                      qidian: typeof parsed.platformBlurbs?.qidian === 'string' ? parsed.platformBlurbs.qidian : current.platformBlurbs.qidian,
                      tomato: typeof parsed.platformBlurbs?.tomato === 'string' ? parsed.platformBlurbs.tomato : current.platformBlurbs.tomato,
                      publishing: typeof parsed.platformBlurbs?.publishing === 'string' ? parsed.platformBlurbs.publishing : current.platformBlurbs.publishing,
                    },
                    volumeNamingStyle: typeof parsed.volumeNamingStyle === 'string' ? parsed.volumeNamingStyle : current.volumeNamingStyle,
                  }))
                  message.success(getUserFacingMessage('overview.packagingGenerated'))
                } catch (error) {
                  console.error(error)
                  message.error(getErrorMessage(error, 'overview.aiDraftFailed'))
                } finally {
                  setPackagingGenerating(false)
                }
              })()}
            >
              生成包装文案
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={packagingSaving}
              disabled={!packagingDirty}
              onClick={() => void handleSavePackaging()}
            >
              保存包装信息
            </Button>
          </Space>
        )}
      >
        <div className="guided-step__field-grid novel-overview-page__packaging-grid">
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong className="workspace-card-section-title">书名候选</strong>
            <Select
              mode="tags"
              value={packagingDraft.titleCandidates}
              onChange={(value: string[]) => setPackagingDraft((current) => ({ ...current, titleCandidates: value }))}
              tokenSeparators={[',', '，', '、']}
              placeholder="输入或微调候选书名"
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong className="workspace-card-section-title">一句话钩子</strong>
            <Input.TextArea
              rows={6}
              value={packagingDraft.oneLineHook}
              onChange={(event) => setPackagingDraft((current) => ({ ...current, oneLineHook: event.target.value }))}
              placeholder="一句话概括主角、目标和最大阻碍。"
            />
          </div>
          <div className="guided-step__field-card">
            <strong className="workspace-card-section-title">起点版简介</strong>
            <Input.TextArea
              rows={8}
              value={packagingDraft.platformBlurbs.qidian}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, qidian: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card">
            <strong className="workspace-card-section-title">番茄版简介</strong>
            <Input.TextArea
              rows={8}
              value={packagingDraft.platformBlurbs.tomato}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, tomato: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong className="workspace-card-section-title">出版版简介</strong>
            <Input.TextArea
              rows={6}
              value={packagingDraft.platformBlurbs.publishing}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, publishing: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong className="workspace-card-section-title">卷名风格</strong>
            <Input.TextArea
              rows={6}
              value={packagingDraft.volumeNamingStyle}
              onChange={(event) => setPackagingDraft((current) => ({ ...current, volumeNamingStyle: event.target.value }))}
              placeholder="例如：统一采用 地点 + 局势 / 代价 + 目标 的组合。"
            />
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="novel-overview-page__summary-panel" title="创作流程概览" description="按阶段查看当前缺口，点击进入该阶段第一个未完成步骤。">
        <div className="novel-overview-page__summary-stack">
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <span>项目立项</span>
              <strong>{projectBrief.readyCount}/6</strong>
              <small>{projectBrief.readerPromise || '还没有写清读者承诺。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>基础设定</span>
              <strong>{storySettings.premiseReadyCount}/5</strong>
              <small>{storySettings.premise.constraints || '还没有写清底层约束。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>主题与文风</span>
              <strong>{themeVoice.readyCount}/6</strong>
              <small>{themeVoice.styleRules || '还没有固定文风与句式规则。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>世界规则</span>
              <strong>{currentNovel?.worldRulesJson ? '已建立' : '待建立'}</strong>
              <small>{worldRules.mapBlueprint.overview || '还没有统一地点层级和行动边界。'}</small>
            </div>
          </div>

          <div className="novel-overview-page__entry-section">
            <strong className="novel-overview-page__entry-title">阶段入口</strong>
            <div className="novel-overview-page__entry-grid">
              {workflowStageCards.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(`/novels/${novelId}/${item.route}`)}
                  className="novel-overview-page__entry-card"
                >
                  <div className="novel-overview-page__entry-card-head">
                    <strong>{item.title}</strong>
                    <span>{item.progressText}</span>
                  </div>
                  <div className={`novel-overview-page__entry-status${item.ready ? ' is-ready' : ' is-pending'}`}>
                    {item.ready ? '已就绪' : '待补齐'}
                  </div>
                  <div className="novel-overview-page__entry-summary">{`${item.detailText} · ${item.summary}`}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
