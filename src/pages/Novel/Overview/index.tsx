import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Select, message } from 'antd'
import {
  EditOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { buildNovelBlurbPayload, parseNovelBlurbDocument, type NovelBlurbDocument } from '../../../shared/blurb'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { buildPremiseSummary, buildStoryDesignSummary, parseStorySettingsSnapshot } from '../../../shared/story-settings'
import { buildThemeVoiceSummary, parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import { useNovelStore } from '../../../stores/novel.store'
import { normalizeOptionalNumber, parseDraftJson, type DraftFieldDefinition } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import {
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import StepAIAssistant, { type StepAIAssistantPatch } from '../components/StepAIAssistant'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import { useRegisterWorkspaceQualityController } from '../workspace-quality-context-core'
import { useNovelWorkspaceActions, useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import './index.css'

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

function hasText(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const { notifyWorkspaceMutation, registerClearHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<OverviewFormValues>()
  const [saving, setSaving] = useState(false)
  const [packagingSaving, setPackagingSaving] = useState(false)
  const [packagingDraft, setPackagingDraft] = useState<PackagingDraft>(parseNovelBlurbDocument(currentNovel?.blurbJson))
  const [packagingGenerating, setPackagingGenerating] = useState(false)
  const [packagingExpanded, setPackagingExpanded] = useState(false)

  useEffect(() => {
    setPackagingDraft(parseNovelBlurbDocument(currentNovel?.blurbJson))
  }, [currentNovel?.blurbJson])

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
  const overviewFormValues = Form.useWatch([], form) as Partial<OverviewFormValues> | undefined
  const basicInfoDirty = useMemo(() => {
    if (!currentNovel || !overviewFormValues) return false
    return (
      String(overviewFormValues.title || '').trim() !== String(currentNovel.title || '').trim()
      || String(overviewFormValues.synopsis || '').trim() !== String(currentNovel.synopsis || '').trim()
      || String(overviewFormValues.userBackground || '').trim() !== String(currentNovel.userBackground || '').trim()
      || String(overviewFormValues.expandedBackground || '').trim() !== String(currentNovel.expandedBackground || '').trim()
      || normalizeTargetWords(overviewFormValues.targetWords) !== normalizeTargetWords(currentNovel.targetWords)
    )
  }, [currentNovel, overviewFormValues])
  const hasUnsavedChanges = basicInfoDirty || packagingDirty
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)

  useEffect(() => {
    if (basicInfoDirty) return
    form.setFieldsValue({
      title: currentNovel?.title || '',
      synopsis: currentNovel?.synopsis || '',
      userBackground: currentNovel?.userBackground || '',
      expandedBackground: currentNovel?.expandedBackground || '',
      targetWords: currentNovel?.targetWords ?? 200000,
    })
  }, [basicInfoDirty, currentNovel, form])
  const projectInfoFilledCount = [
    overviewFormValues?.title,
    overviewFormValues?.synopsis,
    overviewFormValues?.userBackground,
    overviewFormValues?.expandedBackground,
    overviewFormValues?.targetWords,
  ].filter(hasText).length
  const packagingFilledCount = [
    packagingDraft.titleCandidates.length > 0,
    hasText(packagingDraft.oneLineHook),
    Object.values(packagingDraft.platformBlurbs).some(hasText),
    hasText(packagingDraft.volumeNamingStyle),
  ].filter(Boolean).length

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

  const handleSave = useCallback(async (): Promise<boolean> => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return false
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
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('overview.saved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'overview.saveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }, [clearDraft, currentNovel?.blurbJson, finalizeDraft, form, notifyWorkspaceMutation, novelId, packagingDraft, setCurrentNovel])

  const handleSavePackaging = async () => {
    setPackagingSaving(true)

    try {
      await window.electron.novel.update(novelId, { blurbJson: packagingPayload })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('overview.packagingSaved'))
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('overview.packagingSaveFailed'))
    } finally {
      setPackagingSaving(false)
    }
  }

  const handleGeneratePackaging = async () => {
    setPackagingGenerating(true)
    try {
      const outputs = await window.electron.ai.runPrompt({
        novelId,
        modelConfigId: currentNovel?.modelConfigId,
        messages: [{
          role: 'user',
          content: [
            '你是中文网络小说包装编辑，只输出 JSON，不要解释，不要 Markdown。',
            '番茄版简介优先写清开局处境、第一重冲突和持续追读问题；飞卢版简介优先写清开局冲突、能力/身份差、即时回报和连载爽点；不要用空泛的“精彩纷呈”“热血沸腾”填充。',
            `书名：${form.getFieldValue('title') || currentNovel?.title || ''}`,
            `一句话简介：${form.getFieldValue('synopsis') || currentNovel?.synopsis || ''}`,
            `扩展背景：${form.getFieldValue('expandedBackground') || currentNovel?.expandedBackground || ''}`,
            projectBrief.readyCount > 0 ? `项目立项：${buildProjectBriefSummary(projectBrief)}` : '',
            storySettings.storyDesign.mainPlot ? `故事设计：${buildStoryDesignSummary(storySettings.storyDesign)}` : '',
            themeVoice.readyCount > 0 ? `主题与文风：${buildThemeVoiceSummary(themeVoice)}` : '',
            '返回：',
            '- titleCandidates: 5 个可上架书名候选',
            '- oneLineHook: 1 句导语',
            '- platformBlurbs.qidian / tomato / feilu / publishing: 4 种平台简介',
            '- volumeNamingStyle: 卷名风格规范',
            '{"titleCandidates":[""],"oneLineHook":"","platformBlurbs":{"qidian":"","tomato":"","feilu":"","publishing":""},"volumeNamingStyle":""}',
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
          feilu: typeof parsed.platformBlurbs?.feilu === 'string' ? parsed.platformBlurbs.feilu : current.platformBlurbs.feilu,
          publishing: typeof parsed.platformBlurbs?.publishing === 'string' ? parsed.platformBlurbs.publishing : current.platformBlurbs.publishing,
        },
        volumeNamingStyle: typeof parsed.volumeNamingStyle === 'string' ? parsed.volumeNamingStyle : current.volumeNamingStyle,
      }))
      setPackagingExpanded(true)
      message.success(getUserFacingMessage('overview.packagingGenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'overview.aiDraftFailed'))
    } finally {
      setPackagingGenerating(false)
    }
  }

  const navigateToStudio = useCallback(() => {
    if (!hasUnsavedChanges) {
      navigate(buildWorkspaceRoute(novelId, 'guide'))
      return
    }
    Modal.confirm({
      title: '项目资料还有未保存修改',
      content: '先保存当前项目资料，再回到创作控制台，避免书名、简介或包装信息丢失。',
      okText: '保存并离开',
      cancelText: '留在当前页',
      onOk: async () => {
        const saved = await handleSave()
        if (saved) navigate(buildWorkspaceRoute(novelId, 'guide'))
      },
    })
  }, [handleSave, hasUnsavedChanges, navigate, novelId])

  useEffect(() => {
    registerSaveHandler(() => {
      if (hasUnsavedChanges && !saving) void handleSave()
    })
    return () => registerSaveHandler(null)
  }, [handleSave, hasUnsavedChanges, registerSaveHandler, saving])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges || saving) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges, saving])

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: '清空项目资料？',
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
    registerClearHandler(handleClear)
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  return (
    <WorkspacePage
      className="novel-overview-page"
      layout="wide"
      heroVariant="compact"
      chrome="shared"
      title="项目资料"
      actionContract={{
        primary: {
          key: 'save',
          label: '保存项目资料',
          icon: <SaveOutlined />,
          loading: saving,
          onClick: () => void handleSave(),
        },
        secondary: [
          {
            key: 'studio',
            label: '回到创作控制台',
            icon: <EditOutlined />,
            onClick: navigateToStudio,
          },
          {
            key: 'packaging',
            label: packagingExpanded ? '收起包装信息' : '展开包装信息',
            onClick: () => setPackagingExpanded((current) => !current),
          },
        ],
      }}
    >
      <div data-overview-responsibility="project-information" className="overview-page__body">
        <div className="overview-page__alert-stack">
          {projectInfoFilledCount < 4 ? (
            <Alert
              type="warning"
              showIcon
              message="项目资料还不完整"
              description={`当前已填写 ${projectInfoFilledCount}/5 项核心资料，保存前请补齐必填字段。`}
            />
          ) : null}
          {draft?.appliedAt ? (
            <Alert
              type="info"
              showIcon
              message="已恢复未保存的 AI 草稿，保存项目资料后自动生效。"
            />
          ) : null}
        </div>

        <section data-overview-project-info className="overview-page__project-info">
          <WorkspacePanel
            title="核心资料"
            extra={(
              <span className={`overview-page__save-state${hasUnsavedChanges ? ' is-unsaved' : ''}`} data-overview-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
                {hasUnsavedChanges ? '有未保存修改' : '已与项目数据同步'}
              </span>
            )}
          >
            <Form form={form} layout="vertical">
              <div className="overview-page__field-grid">
                <div className="overview-page__field overview-page__field--title">
                  <Form.Item name="title" label="书名" rules={[{ required: true, message: '请填写书名' }]}>
                    <Input placeholder="例如：北境回潮" />
                  </Form.Item>
                </div>
                <div className="overview-page__field overview-page__field--target">
                  <Form.Item name="targetWords" label="目标字数" rules={[{ required: true, message: '请填写目标字数' }]}>
                    <InputNumber min={1000} step={1000} className="workspace-input-number-full" />
                  </Form.Item>
                </div>
                <div className="overview-page__field overview-page__field--wide">
                  <Form.Item name="synopsis" label="一句话简介" rules={[{ required: true, message: '请填写简介' }]}>
                    <Input.TextArea rows={3} placeholder="写清主角处境、目标和最大阻碍。" />
                  </Form.Item>
                </div>
                <div className="overview-page__field">
                  <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                    <Input.TextArea rows={5} placeholder="写灵感起点、氛围和人物困局。" />
                  </Form.Item>
                </div>
                <div className="overview-page__field">
                  <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                    <Input.TextArea rows={5} placeholder="补齐环境压力、制度成本和社会结构。" />
                  </Form.Item>
                </div>
              </div>
            </Form>

            <details className="overview-page__assistant">
              <summary>
                <span>
                  <strong>AI 辅助</strong>
                </span>
                <span>查看辅助</span>
              </summary>
              <div data-overview-ai-assistant className="overview-page__assistant-body">
                <StepAIAssistant<OverviewAssistantPatch>
                  novel={currentNovel}
                  novelId={novelId}
                  stepKey="basics"
                  stepTitle="项目核心资料"
                  fields={OVERVIEW_AI_FIELDS}
                  values={{
                    title: overviewFormValues?.title || currentNovel?.title || '',
                    synopsis: overviewFormValues?.synopsis || currentNovel?.synopsis || '',
                    userBackground: overviewFormValues?.userBackground || currentNovel?.userBackground || '',
                    expandedBackground: overviewFormValues?.expandedBackground || currentNovel?.expandedBackground || '',
                    targetWords: overviewFormValues?.targetWords || currentNovel?.targetWords || 200000,
                  }}
                  tools={OVERVIEW_AI_TOOLS}
                  extraContext={[
                    { label: '当前步骤', value: '创建/维护项目核心资料' },
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
              </div>
            </details>
          </WorkspacePanel>
        </section>

        <section data-overview-packaging className="overview-page__packaging">
          <WorkspacePanel
            title="包装信息"
            extra={(
              <Button
                size="small"
                aria-expanded={packagingExpanded}
                onClick={() => setPackagingExpanded((current) => !current)}
              >
                {packagingExpanded ? '收起包装信息' : '展开包装信息'}
              </Button>
            )}
          >
            <div className="overview-page__packaging-summary">
              <div>
                <strong>{packagingFilledCount > 0 ? `已填写 ${packagingFilledCount}/4 类包装资料` : '尚未填写包装资料'}</strong>
              </div>
              {packagingDirty ? <span className="overview-page__packaging-dirty">有未保存修改</span> : null}
            </div>

            {packagingExpanded ? (
              <div data-overview-packaging-content className="overview-page__packaging-content">
                <div className="overview-page__packaging-actions">
                  <span>包装草稿不会改变核心资料。</span>
                  <div>
                    <Button loading={packagingGenerating} onClick={() => void handleGeneratePackaging()}>
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
                  </div>
                </div>
                <div className="overview-page__packaging-grid">
                  <div className="overview-page__packaging-field overview-page__packaging-field--wide">
                    <strong>书名候选</strong>
                    <Select
                      mode="tags"
                      value={packagingDraft.titleCandidates}
                      onChange={(value: string[]) => setPackagingDraft((current) => ({ ...current, titleCandidates: value }))}
                      tokenSeparators={[',', '，', '、']}
                      placeholder="输入或微调候选书名"
                    />
                  </div>
                  <div className="overview-page__packaging-field overview-page__packaging-field--wide">
                    <strong>一句话钩子</strong>
                    <Input.TextArea
                      rows={3}
                      value={packagingDraft.oneLineHook}
                      onChange={(event) => setPackagingDraft((current) => ({ ...current, oneLineHook: event.target.value }))}
                      placeholder="一句话概括主角、目标和最大阻碍。"
                    />
                  </div>
                  <div className="overview-page__packaging-field">
                    <strong>起点版简介</strong>
                    <Input.TextArea
                      rows={5}
                      value={packagingDraft.platformBlurbs.qidian || ''}
                      onChange={(event) => setPackagingDraft((current) => ({
                        ...current,
                        platformBlurbs: { ...current.platformBlurbs, qidian: event.target.value },
                      }))}
                    />
                  </div>
                  <div className="overview-page__packaging-field">
                    <strong>番茄版简介</strong>
                    <Input.TextArea
                      rows={5}
                      value={packagingDraft.platformBlurbs.tomato || ''}
                      onChange={(event) => setPackagingDraft((current) => ({
                        ...current,
                        platformBlurbs: { ...current.platformBlurbs, tomato: event.target.value },
                      }))}
                    />
                  </div>
                  <div className="overview-page__packaging-field">
                    <strong>飞卢版简介</strong>
                    <Input.TextArea
                      rows={5}
                      value={packagingDraft.platformBlurbs.feilu || ''}
                      onChange={(event) => setPackagingDraft((current) => ({
                        ...current,
                        platformBlurbs: { ...current.platformBlurbs, feilu: event.target.value },
                      }))}
                      placeholder="突出开局冲突、即时回报和连续更新承诺。"
                    />
                  </div>
                  <div className="overview-page__packaging-field">
                    <strong>出版版简介</strong>
                    <Input.TextArea
                      rows={5}
                      value={packagingDraft.platformBlurbs.publishing || ''}
                      onChange={(event) => setPackagingDraft((current) => ({
                        ...current,
                        platformBlurbs: { ...current.platformBlurbs, publishing: event.target.value },
                      }))}
                    />
                  </div>
                  <div className="overview-page__packaging-field overview-page__packaging-field--wide">
                    <strong>卷名风格</strong>
                    <Input.TextArea
                      rows={3}
                      value={packagingDraft.volumeNamingStyle}
                      onChange={(event) => setPackagingDraft((current) => ({ ...current, volumeNamingStyle: event.target.value }))}
                      placeholder="例如：统一采用 地点 + 局势 / 代价 + 目标 的组合。"
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </WorkspacePanel>
        </section>
      </div>
    </WorkspacePage>
  )
}
