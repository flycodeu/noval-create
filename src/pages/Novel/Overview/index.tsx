import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Progress, Select, Space, message } from 'antd'
import {
  BarsOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { buildNovelBlurbPayload, parseNovelBlurbDocument, type NovelBlurbDocument } from '../../../shared/blurb'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { buildPremiseSummary, buildStoryDesignSummary, parseStorySettingsSnapshot } from '../../../shared/story-settings'
import { buildThemeVoiceSummary, parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import { useNovelStore } from '../../../stores/novel.store'
import { useAuthorWorkModeStore } from '../../../stores/author-work-mode.store'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import { generateOverviewDraft } from '../shared/planning-ai-service'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
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
import {
  type RegisteredWorkspaceQualityController,
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { EMPTY_WORKFLOW_STATS, getAssetBloatSignal, loadWorkflowStats, type WorkflowStats } from '../workflow'

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

type PackagingDraft = NovelBlurbDocument

const EMPTY_PACKAGING_DRAFT: PackagingDraft = {
  titleCandidates: [],
  oneLineHook: '',
  platformBlurbs: {},
  volumeNamingStyle: '',
}

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
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const [packagingDraft, setPackagingDraft] = useState<PackagingDraft>(parseNovelBlurbDocument(currentNovel?.blurbJson))
  const [packagingGenerating, setPackagingGenerating] = useState(false)
  const [qualitySummary, setQualitySummary] = useState<Pick<QualityDashboardData, 'productionReadiness' | 'batchHealth' | 'continuityHealth'> | null>(null)
  const draftWarningsRef = useRef<string[]>([])
  const draftObservabilityRef = useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)
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
    })

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

  const readinessItems = [
    {
      key: 'project-brief',
      title: '项目立项',
      ready: projectBrief.readyCount >= 4,
      summary: `${projectBrief.readyCount}/6`,
      icon: <EditOutlined />,
      action: () => navigate(`/novels/${novelId}/project-brief`),
    },
    {
      key: 'core-settings',
      title: '基础设定',
      ready: storySettings.premiseReadyCount >= 4,
      summary: `${storySettings.premiseReadyCount}/5`,
      icon: <SettingOutlined />,
      action: () => navigate(`/novels/${novelId}/core-settings`),
    },
    {
      key: 'theme-voice',
      title: '主题与文风',
      ready: themeVoice.readyCount >= 4,
      summary: `${themeVoice.readyCount}/6`,
      icon: <EditOutlined />,
      action: () => navigate(`/novels/${novelId}/theme-voice`),
    },
    {
      key: 'world-rules',
      title: '世界规则',
      ready: Boolean(currentNovel?.worldRulesJson),
      summary: `${worldRules.factionSystem.length} 势力 / ${worldRules.speciesSystem.length} 种族`,
      icon: <GlobalOutlined />,
      action: () => navigate(`/novels/${novelId}/world-rules`),
    },
    {
      key: 'endgame',
      title: '终局设计',
      ready: storySettings.endgameReadyCount >= 5,
      summary: `${storySettings.endgameReadyCount}/8`,
      icon: <BarsOutlined />,
      action: () => navigate(`/novels/${novelId}/endgame`),
    },
    {
      key: 'map',
      title: '地图结构',
      ready: stats.mapCount > 0,
      summary: `${stats.mapCount} 个节点`,
      icon: <EnvironmentOutlined />,
      action: () => navigate(`/novels/${novelId}/map`),
    },
    {
      key: 'characters',
      title: '角色系统',
      ready: stats.characterCount > 0 && stats.hasProtagonist,
      summary: `${stats.characterCount} 位角色`,
      icon: <TeamOutlined />,
      action: () => navigate(`/novels/${novelId}/characters`),
    },
    {
      key: 'threads',
      title: '故事线程',
      ready: stats.threadCount > 0,
      summary: `${stats.threadCount} 条线程`,
      icon: <BarsOutlined />,
      action: () => navigate(`/novels/${novelId}/threads`),
    },
    {
      key: 'timeline',
      title: '时间轴',
      ready: stats.timelineCount > 0,
      summary: `${stats.timelineCount} 个事件`,
      icon: <ClockCircleOutlined />,
      action: () => navigate(`/novels/${novelId}/timeline`),
    },
  ]

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
  const readyCount = readinessItems.filter((item) => item.ready).length
  const keyGapCount = readinessItems.length - readyCount
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

  const applyOverviewDraft = (draft: Partial<OverviewFormValues>) => {
    const currentValues = form.getFieldsValue(true)

    form.setFieldsValue({
      ...currentValues,
      title: typeof draft.title === 'string' ? draft.title : currentValues.title,
      synopsis: typeof draft.synopsis === 'string' ? draft.synopsis : currentValues.synopsis,
      userBackground: typeof draft.userBackground === 'string' ? draft.userBackground : currentValues.userBackground,
      expandedBackground: typeof draft.expandedBackground === 'string' ? draft.expandedBackground : currentValues.expandedBackground,
      targetWords: normalizeTargetWords(draft.targetWords ?? currentValues.targetWords),
    })
  }

  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<OverviewFormValues>({
    novelId,
    pageKey: 'overview',
    applyDraft: applyOverviewDraft,
  })

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
  }), [form, saveAppliedDraft])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleApplyDraft = (raw: string) => {
    const parsedDraft = parseDraftJson<OverviewFormValues>(raw)
    const currentValues = form.getFieldsValue(true)
    const mergedDraft: OverviewFormValues = {
      ...currentValues,
      title: typeof parsedDraft.title === 'string' ? parsedDraft.title : currentValues.title,
      synopsis: typeof parsedDraft.synopsis === 'string' ? parsedDraft.synopsis : currentValues.synopsis,
      userBackground: typeof parsedDraft.userBackground === 'string' ? parsedDraft.userBackground : currentValues.userBackground,
      expandedBackground: typeof parsedDraft.expandedBackground === 'string' ? parsedDraft.expandedBackground : currentValues.expandedBackground,
      targetWords: normalizeTargetWords(parsedDraft.targetWords ?? currentValues.targetWords),
    }

    applyOverviewDraft(mergedDraft)
    void saveAppliedDraft(mergedDraft, draftWarningsRef.current, 'overview', draftObservabilityRef.current || undefined).catch(console.error)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
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
        setDraftWarnings([])
        draftWarningsRef.current = []
        draftObservabilityRef.current = null
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
      description="统一查看底盘、资产和下一步重点。"
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
            label="结构承接"
            value={`${readyCount}/${readinessItems.length}`}
            hint={keyGapCount > 0 ? `仍有 ${keyGapCount} 个关键底盘位待补齐` : '关键底盘已基本就绪'}
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
      {draftWarnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="本轮 AI 草稿附带修补提示"
          description={draftWarnings.map((warning) => <div key={warning}>{warning}</div>)}
        />
      ) : null}
      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复最近一次未保存的 AI 草稿"
          description="当前表单包含最近一次已应用但尚未保存的 Overview 草稿。保存基础信息后会自动清除。"
        />
      ) : null}
      {assetBloat.risk !== 'none' ? (
        <Alert
          type={assetBloat.risk === 'high' ? 'warning' : 'info'}
          showIcon
          message="资产膨胀提示"
          action={(
            <Button size="small" onClick={() => navigate(`/novels/${novelId}/${stats.outlineCount > 0 ? 'writing' : 'outline'}`)}>
              {stats.outlineCount > 0 ? '进入正文' : '压成大纲'}
            </Button>
          )}
        />
      ) : null}

      <WorkspacePanel
        title={displayState.isZeroState ? '首章启动' : '今天最该做什么'}
        description={displayState.isZeroState
          ? '当前处于 0 章 / 0 字阶段，先给启动动作，再给统计与管理信息。'
          : '总览页只保留当前最值钱的下一步；详细模式切换仍放在创作向导。'}
        extra={<div className="novel-pill">{getAuthorWorkModeLabel(selectedAuthorMode)}</div>}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="guided-step__action-card">
            <div className="guided-step__action-head">
              <div className="guided-step__action-copy">
                <strong>{authorWorkflow.primaryTask.title}</strong>
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
          title="备选路径"
          description="如果你不打算执行当前主任务，可以从这两个次优动作继续推进。"
        >
          <div className="guided-step__action-grid">
            {authorWorkflow.alternateTasks.slice(0, 2).map((task) => (
              <div key={task.id} className="guided-step__action-card">
                <div className="guided-step__action-copy">
                  <strong>{task.title}</strong>
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
          title="当前阻塞项"
          description="这里回答为什么现在不建议继续下一步，并给出直接处理入口。"
        >
          <div className="novel-issue-list">
            {authorWorkflow.blockers.slice(0, 2).map((blocker) => (
              <div key={blocker.id} className="novel-issue-item">
                <div className="novel-issue-item__head">
                  <strong>{blocker.title}</strong>
                </div>
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
          title="风险和影响"
          description="这里回答最近的变更正在波及什么，避免作者靠记忆自己回查。"
        >
          <div className="novel-note-list">
            {authorWorkflow.impactNotices.slice(0, 2).map((notice) => (
              <div key={notice.id} className="novel-note-list__item">{notice.title}</div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}

      {displayState.showProgressPanel ? (
        <WorkspacePanel title="推进热度" description="进入正文后再看字数与章节进度，避免起步阶段被弱信息占住视线。">
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>字数进度</strong>
                <span>{wordProgress}%</span>
              </div>
              <Progress percent={wordProgress} showInfo={false} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
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
          title={authorWorkflow.blockers.length > 0 ? '继续扩批前先看这些风险' : '百万字健康速览'}
          description="健康信息降为次级区，只在进入正文后帮助你判断能否继续扩批。"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
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
        title="基础信息"
        description="基础信息已降到次级区；需要时再集中编辑，而不是一进来先管理表单。"
        extra={(
          <Space wrap>
            <AIGenerateButton
              novelId={novelId}
              label="AI 生成·基础信息"
              intent="generate"
              isJson
              runGeneration={async (input) => {
                const result = await generateOverviewDraft(input, { genre: currentNovel?.genreName })
                draftWarningsRef.current = result.warnings
                draftObservabilityRef.current = result.observability
                setDraftWarnings(result.warnings)
                return result.outputs
              }}
              buildMessages={() => {
                const values = form.getFieldsValue(true)

                return buildDraftMessages({
                  task: '小说基础信息',
                  mode: 'replace',
                  context: [
                    { label: '题材', value: currentNovel?.genreName || '' },
                    { label: '项目立项', value: buildProjectBriefSummary(projectBrief) },
                    { label: '基础设定', value: buildPremiseSummary(storySettings.premise) },
                    { label: '故事设计', value: buildStoryDesignSummary(storySettings.storyDesign) },
                    { label: '主题与文风', value: buildThemeVoiceSummary(themeVoice) },
                    {
                      label: '世界规则',
                      value: [
                        worldRules.mapBlueprint.overview,
                        worldRules.factionSystem.length > 0 ? `${worldRules.factionSystem.length} 个势力` : '',
                        worldRules.speciesSystem.length > 0 ? `${worldRules.speciesSystem.length} 个种族` : '',
                      ].filter(Boolean).join('；'),
                    },
                  ],
                  fields: [
                    { key: 'title', label: '书名', value: values.title, hint: '能体现题材和冲突，不要像占位名。' },
                    { key: 'synopsis', label: '一句话简介', value: values.synopsis, hint: '一句话交代主角处境、目标和最大阻碍。' },
                    { key: 'userBackground', label: '原始背景', value: values.userBackground, hint: '保留灵感来源，写清氛围和人物起点。' },
                    { key: 'expandedBackground', label: '扩展背景', value: values.expandedBackground, hint: '补齐资源、制度、环境压力和社会结构。' },
                    { key: 'targetWords', label: '目标字数', type: 'number', value: values.targetWords, hint: '给出适合当前题材的合理整数。' },
                  ],
                  requirements: [
                    '不要另起一套故事。',
                    '不要写口号和平台宣传语。',
                  ],
                })
              }}
              onResult={handleApplyDraft}
            />
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存基础信息
            </Button>
          </Space>
        )}
      >
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid guided-step__field-grid--basics">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="title" label="书名" rules={[{ required: true, message: '请填写书名' }]}>
                <Input placeholder="例如：北境回潮" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetWords" label="目标字数" rules={[{ required: true, message: '请填写目标字数' }]}>
                <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="synopsis" label="一句话简介" rules={[{ required: true, message: '请填写简介' }]}>
                <Input.TextArea rows={4} placeholder="写清主角处境、目标和最大阻碍。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                <Input.TextArea rows={7} placeholder="写灵感起点、氛围和人物困局。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                <Input.TextArea rows={7} placeholder="补齐环境压力、制度成本和社会结构。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel
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
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>书名候选</strong>
            <Select
              mode="tags"
              value={packagingDraft.titleCandidates}
              onChange={(value: string[]) => setPackagingDraft((current) => ({ ...current, titleCandidates: value }))}
              tokenSeparators={[',', '，', '、']}
              placeholder="输入或微调候选书名"
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>一句话钩子</strong>
            <Input.TextArea
              rows={3}
              value={packagingDraft.oneLineHook}
              onChange={(event) => setPackagingDraft((current) => ({ ...current, oneLineHook: event.target.value }))}
              placeholder="一句话概括主角、目标和最大阻碍。"
            />
          </div>
          <div className="guided-step__field-card">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>起点版简介</strong>
            <Input.TextArea
              rows={5}
              value={packagingDraft.platformBlurbs.qidian}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, qidian: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>番茄版简介</strong>
            <Input.TextArea
              rows={5}
              value={packagingDraft.platformBlurbs.tomato}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, tomato: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>出版版简介</strong>
            <Input.TextArea
              rows={4}
              value={packagingDraft.platformBlurbs.publishing}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, publishing: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>卷名风格</strong>
            <Input.TextArea
              rows={3}
              value={packagingDraft.volumeNamingStyle}
              onChange={(event) => setPackagingDraft((current) => ({ ...current, volumeNamingStyle: event.target.value }))}
              placeholder="例如：统一采用 地点 + 局势 / 代价 + 目标 的组合。"
            />
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="项目底盘概览" description="把底盘摘要和关键入口收在一个次级区，避免总览重复展示多层状态卡。">
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
            <strong className="novel-overview-page__entry-title">关键入口</strong>
            <div className="novel-overview-page__entry-grid">
              {readinessItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.action}
                  className="novel-overview-page__entry-card"
                >
                  <div className="novel-overview-page__entry-card-head">
                    <strong>{item.title}</strong>
                    <span>{item.icon}</span>
                  </div>
                  <div className={`novel-overview-page__entry-status${item.ready ? ' is-ready' : ' is-pending'}`}>
                    {item.ready ? '已就绪' : '待补齐'}
                  </div>
                  <div className="novel-overview-page__entry-summary">{item.summary}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
