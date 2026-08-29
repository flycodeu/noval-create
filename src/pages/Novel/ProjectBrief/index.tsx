import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Tag, message } from 'antd'
import { ArrowRightOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { ProjectPlatformMode } from '../../../shared/project-brief'
import {
  buildProjectBriefPayload,
  getPlatformDesignProfile,
  parseProjectBriefDocument,
  parseProjectBriefSnapshot,
} from '../../../shared/project-brief'
import type {
  ProjectBriefGenerationMode,
  ProjectBriefGenerationResult,
} from '../../../shared/project-brief-generation'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { usePlanningDraft } from '../shared/planning-draft'
import {
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context-core'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { loadWorkflowStats } from '../workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import './index.css'

interface Props {
  novelId: number
}

interface ProjectBriefFormValues {
  platformMode: ProjectPlatformMode | ''
  targetAudience: string
  targetReader: string
  readerPromise: string
  sellingPoints: string
  compTitles: string
  tabooRules: string
  deliveryRhythm: string
}

const PLATFORM_OPTIONS: Array<{ value: ProjectPlatformMode; label: string }> = [
  { value: 'fanqie', label: '番茄小说' },
  { value: 'feilu', label: '飞卢小说' },
  { value: 'web_serial', label: '通用网文连载' },
  { value: 'general', label: '通用长篇' },
  { value: 'publishing', label: '出版小说' },
]

const EMPTY_PROJECT_BRIEF_VALUES: ProjectBriefFormValues = {
  platformMode: '',
  targetAudience: '',
  targetReader: '',
  readerPromise: '',
  sellingPoints: '',
  compTitles: '',
  tabooRules: '',
  deliveryRhythm: '',
}

function normalizeText(value?: string | null): string {
  return value?.trim() || ''
}

function normalizeFormValues(values: ProjectBriefFormValues): ProjectBriefFormValues {
  return {
    platformMode: values.platformMode,
    targetAudience: normalizeText(values.targetAudience),
    targetReader: normalizeText(values.targetReader),
    readerPromise: normalizeText(values.readerPromise),
    sellingPoints: normalizeText(values.sellingPoints),
    compTitles: normalizeText(values.compTitles),
    tabooRules: normalizeText(values.tabooRules),
    deliveryRhythm: normalizeText(values.deliveryRhythm),
  }
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

function buildCurrentFormValues(
  snapshot: ProjectBriefFormValues,
  formValues: Partial<ProjectBriefFormValues>,
): ProjectBriefFormValues {
  return {
    ...snapshot,
    ...formValues,
    platformMode: formValues.platformMode ?? snapshot.platformMode,
  }
}

function mergeGeneratedValues(
  current: ProjectBriefFormValues,
  result: ProjectBriefGenerationResult,
  mode: ProjectBriefGenerationMode,
): ProjectBriefFormValues {
  const pick = (existing?: string | null, next?: string | null) => {
    const currentValue = normalizeText(existing)
    if (mode === 'fill_blanks' && currentValue) return currentValue
    return normalizeText(next)
  }

  return {
    platformMode: mode === 'fill_blanks' && current.platformMode ? current.platformMode : (result.platformMode || current.platformMode),
    targetAudience: pick(current.targetAudience, result.targetAudience),
    targetReader: pick(current.targetReader, result.targetReader),
    readerPromise: pick(current.readerPromise, result.readerPromise),
    sellingPoints: pick(current.sellingPoints, result.sellingPoints),
    compTitles: pick(current.compTitles, result.compTitles),
    tabooRules: pick(current.tabooRules, result.tabooRules),
    deliveryRhythm: pick(current.deliveryRhythm, result.deliveryRhythm),
  }
}

export default function ProjectBriefPage({ novelId }: Props) {
  const navigate = useNavigate()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const { notifyWorkspaceMutation, registerClearHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ProjectBriefFormValues>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [generatingMode, setGeneratingMode] = useState<ProjectBriefGenerationMode | null>(null)
  const [aiAssistOpen, setAiAssistOpen] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [stats, setStats] = useState({ threadCount: 0, outlineCount: 0, timelineCount: 0, chapterCount: 0 })

  const snapshot = useMemo(
    () => parseProjectBriefSnapshot(currentNovel?.projectBriefJson),
    [currentNovel?.projectBriefJson],
  )

  useEffect(() => {
    form.setFieldsValue(snapshot)
  }, [form, snapshot])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (!active) return
      setStats({
        threadCount: workflowStats.threadCount,
        outlineCount: workflowStats.outlineCount,
        timelineCount: workflowStats.timelineCount,
        chapterCount: workflowStats.chapterCount,
      })
    }).catch(console.error)
    return () => {
      active = false
    }
  }, [novelId])

  const watchedValues = (Form.useWatch([], form) as Partial<ProjectBriefFormValues> | undefined) || {}
  const currentValues = buildCurrentFormValues(snapshot, watchedValues)
  const selectedPlatform = currentValues.platformMode
    ? getPlatformDesignProfile(currentValues.platformMode)
    : null
  const hasUnsavedChanges = JSON.stringify(normalizeFormValues(currentValues))
    !== JSON.stringify(normalizeFormValues(snapshot))
  const applyProjectBriefDraft = React.useCallback((draft: Partial<ProjectBriefFormValues>) => {
    form.setFieldsValue(buildCurrentFormValues(snapshot, draft))
  }, [form, snapshot])
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<ProjectBriefFormValues>({
    novelId,
    pageKey: 'project-brief',
    applyDraft: applyProjectBriefDraft,
  })

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'project-brief',
    getSnapshot: () => ({
      scope: 'form',
      fields: normalizeFormValues(buildCurrentFormValues(snapshot, form.getFieldsValue(true))),
    }),
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<ProjectBriefFormValues>
        : {}
      applyProjectBriefDraft({
        platformMode: fields.platformMode,
        targetAudience: typeof fields.targetAudience === 'string' ? fields.targetAudience : undefined,
        targetReader: typeof fields.targetReader === 'string' ? fields.targetReader : undefined,
        readerPromise: typeof fields.readerPromise === 'string' ? fields.readerPromise : undefined,
        sellingPoints: typeof fields.sellingPoints === 'string' ? fields.sellingPoints : undefined,
        compTitles: typeof fields.compTitles === 'string' ? fields.compTitles : undefined,
        tabooRules: typeof fields.tabooRules === 'string' ? fields.tabooRules : undefined,
        deliveryRhythm: typeof fields.deliveryRhythm === 'string' ? fields.deliveryRhythm : undefined,
      })
    },
    persistPreview: async (nextSnapshot, preview) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<ProjectBriefFormValues>
        : {}
      await saveAppliedDraft(normalizeFormValues(buildCurrentFormValues(snapshot, fields)), preview.warnings, 'project-brief', {
        inputSummary: 'AI质量修复',
        rawOutputs: [JSON.stringify(preview.patchedSnapshot)],
      })
    },
  }), [applyProjectBriefDraft, form, saveAppliedDraft, snapshot])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = React.useCallback(async () => {
    const rawValues = await form.validateFields().catch(() => null)
    if (!rawValues) return false
    const values = normalizeFormValues(rawValues)
    setSaving(true)
    setSaveError(null)

    try {
      await window.electron.novel.update(novelId, {
        projectBriefJson: buildProjectBriefPayload(values, currentNovel?.projectBriefJson),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await finalizeDraft(values)
      await clearDraft()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('projectBrief.saved'))
      return true
    } catch (error) {
      console.error(error)
      const messageText = getErrorMessage(error, 'projectBrief.saveFailed')
      setSaveError(messageText)
      message.error(messageText)
      return false
    } finally {
      setSaving(false)
    }
  }, [clearDraft, currentNovel?.projectBriefJson, finalizeDraft, form, notifyWorkspaceMutation, novelId, setCurrentNovel])

  const navigateToSettings = React.useCallback(() => {
    if (!hasUnsavedChanges) {
      navigate(buildWorkspaceRoute(novelId, 'core-settings'))
      return
    }
    Modal.confirm({
      title: '项目立项还有未保存修改',
      content: '先保存当前字段再离开，避免读者承诺和禁区内容丢失。',
      okText: '保存并离开',
      cancelText: '留在当前页',
      onOk: async () => {
        const saved = await handleSave()
        if (saved) navigate(buildWorkspaceRoute(novelId, 'core-settings'))
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

  const handleGenerate = async (mode: ProjectBriefGenerationMode) => {
    setGeneratingMode(mode)
    setWarnings([])

    try {
      const result = await window.electron.ai.generateProjectBrief({
        novelId,
        mode,
        requirements: '优先生成具体、可执行、像编辑会写的中文，不要写口号，不要代替故事设计页面输出剧情。',
      })

      const merged = mergeGeneratedValues(
        buildCurrentFormValues(snapshot, form.getFieldsValue(true)),
        result,
        mode,
      )
      form.setFieldsValue(merged)
      setWarnings(result.warnings)
      setSaveError(null)
      void saveAppliedDraft(merged, result.warnings, 'project-brief', {
        inputSummary: `${mode === 'fill_blanks' ? '补空白' : '首版'} · ${currentNovel?.title || '未命名小说'}`,
      }).catch(console.error)

      if (result.warnings.length > 0) {
        message.warning(getUserFacingMessage('projectBrief.generatedWithWarnings', { count: result.warnings.length }))
      } else if (mode === 'fill_blanks') {
        message.success(getUserFacingMessage('projectBrief.filledBlanks'))
      } else {
        message.success(getUserFacingMessage('projectBrief.generated'))
      }
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'projectBrief.generateFailed'))
    } finally {
      setGeneratingMode(null)
    }
  }

  const handleClear = React.useCallback(() => {
    Modal.confirm({
      title: '清空项目立项？',
      content: '会清空当前立项表单，并直接保存为空白基线。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const nextPayload = buildProjectBriefPayload(EMPTY_PROJECT_BRIEF_VALUES, currentNovel?.projectBriefJson)
        await window.electron.novel.update(novelId, {
          projectBriefJson: nextPayload,
        })

        const updated = await window.electron.novel.get(novelId)
        if (updated) setCurrentNovel(updated)
        form.setFieldsValue(parseProjectBriefDocument(nextPayload))
        setWarnings([])
        await clearDraft()
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('projectBrief.cleared'))
      },
    })
  }, [clearDraft, currentNovel?.projectBriefJson, form, novelId, notifyWorkspaceMutation, setCurrentNovel])

  useEffect(() => {
    registerClearHandler(handleClear)
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  return (
    <WorkspacePage
      className="novel-project-brief-page"
      layout="wide"
      heroVariant="compact"
      chrome="shared"
      title="项目立项"
      description="把读者承诺、平台方向和创作边界压成一份可执行简报。"
      actionContract={{
        primary: {
          key: 'save',
          label: '保存项目立项',
          icon: <SaveOutlined />,
          loading: saving,
          onClick: () => void handleSave(),
        },
        secondary: [
          {
            key: 'ai-assist',
            label: 'AI 辅助',
            icon: <RobotOutlined />,
            loading: Boolean(generatingMode),
            disabled: Boolean(generatingMode),
            onClick: () => setAiAssistOpen(true),
          },
          {
            key: 'next-settings',
            label: '去基础设定',
            icon: <ArrowRightOutlined />,
            onClick: navigateToSettings,
          },
        ],
      }}
    >
      {!currentNovel?.synopsis && !currentNovel?.expandedBackground ? (
        <Alert
          type="warning"
          showIcon
          message="缺少一句话简介或扩展背景"
        />
      ) : null}

      {warnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="本轮 AI 结果附带修补提示"
          description={(
            <div>
              {warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
        />
      ) : null}
      {saveError ? (
        <Alert
          type="error"
          showIcon
          className="project-brief__save-error"
          message="保存失败，当前表单内容仍保留"
          description={saveError}
          action={(
            <Button size="small" danger onClick={() => void handleSave()} disabled={saving}>
              重试保存
            </Button>
          )}
          closable
          onClose={() => setSaveError(null)}
        />
      ) : null}
      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复未保存的 AI 结果，保存后自动生效"
        />
      ) : null}

      <WorkspacePanel>
        <Form form={form} layout="vertical">
          <div className="project-brief__form" data-project-brief-unsaved-guard={hasUnsavedChanges ? 'active' : 'inactive'}>
            <section className="project-brief__section project-brief__section--core">
              <div className="project-brief__section-header">
                <div>
                  <h2>赛道与读者承诺</h2>
                </div>
                <div className="project-brief__section-actions">
                  <div className="project-brief__save-state" role="status" aria-live="polite">
                    <Tag color={saving || generatingMode ? 'gold' : hasUnsavedChanges ? 'orange' : 'blue'}>
                      {saving ? '保存中' : generatingMode ? 'AI 生成中' : hasUnsavedChanges ? '有未保存修改' : '已保存'}
                    </Tag>
                  </div>
                  <AIGenerateButton
                    novelId={novelId}
                    label="AI 生成·赛道与承诺"
                    intent={hasFilledValues([
                      currentValues.targetAudience,
                      currentValues.targetReader,
                      currentValues.readerPromise,
                      currentValues.sellingPoints,
                      currentValues.compTitles,
                    ]) ? 'complete' : 'generate'}
                    isJson
                    buildMessages={() => buildDraftMessages({
                    task: '项目立项的赛道与读者承诺',
                    mode: hasFilledValues([
                      currentValues.targetAudience,
                      currentValues.targetReader,
                      currentValues.readerPromise,
                      currentValues.sellingPoints,
                      currentValues.compTitles,
                    ]) ? 'optimize' : 'replace',
                    context: buildPlanningContextSections(currentNovel, {
                      includeSubplots: false,
                      extraSections: [
                        { label: '结构资产', value: `线程 ${stats.threadCount} / 大纲 ${stats.outlineCount} / 时间轴 ${stats.timelineCount} / 章节 ${stats.chapterCount}` },
                        { label: '目标平台策略', value: selectedPlatform ? `${selectedPlatform.label}：${selectedPlatform.positioning}\n开局：${selectedPlatform.openingFocus}\n节奏：${selectedPlatform.rhythmFocus}` : '' },
                      ],
                    }),
                    fields: [
                      { key: 'platformMode', label: '目标平台', value: currentValues.platformMode, hint: '选择平台策略，详情在下方“平台策略”中查看。' },
                      { key: 'targetAudience', label: '目标赛道', value: currentValues.targetAudience, hint: '写清题材、受众和市场位置。' },
                      { key: 'targetReader', label: '目标读者', value: currentValues.targetReader, hint: '写读者偏好、节奏预期和情绪需求。' },
                      { key: 'readerPromise', label: '读者承诺', value: currentValues.readerPromise, hint: '说明读者会稳定收到什么体验回报。' },
                      { key: 'sellingPoints', label: '卖点列表', value: currentValues.sellingPoints, hint: '建议每行一条，写 3 到 5 条真正能落地的卖点。' },
                      { key: 'compTitles', label: '参考作品 / 对标方向', value: currentValues.compTitles, hint: '写 2 到 4 个参考作品，并点明借鉴点。' },
                    ],
                    requirements: [
                      '不要代替故事设计页面输出完整剧情。',
                      '不要写宣传口号、空泛褒义词和平台套话。',
                      '必须服从当前目标平台策略，不要把番茄的情绪回报和飞卢的即时反馈写成同一套模板。',
                    ],
                  })}
                    onResult={(raw) => {
                      const draft = parseDraftJson<Partial<ProjectBriefFormValues>>(raw)
                      applyProjectBriefDraft({
                        platformMode: draft.platformMode,
                        targetAudience: typeof draft.targetAudience === 'string' ? draft.targetAudience : undefined,
                        targetReader: typeof draft.targetReader === 'string' ? draft.targetReader : undefined,
                        readerPromise: typeof draft.readerPromise === 'string' ? draft.readerPromise : undefined,
                        sellingPoints: typeof draft.sellingPoints === 'string' ? draft.sellingPoints : undefined,
                        compTitles: typeof draft.compTitles === 'string' ? draft.compTitles : undefined,
                      })
                    }}
                  />
                </div>
              </div>
              <div className="project-brief__field-grid">
                <div className="project-brief__field project-brief__field--compact" data-project-brief-field="platformMode">
                  <Form.Item name="platformMode" label="目标平台" rules={[{ required: true, message: '请选择目标平台' }]}>
                    <Select options={PLATFORM_OPTIONS} placeholder="选择平台，后续设计会套用对应策略" />
                  </Form.Item>
                </div>
                <div className="project-brief__field project-brief__field--compact" data-project-brief-field="targetAudience">
                  <Form.Item name="targetAudience" label="目标赛道" rules={[{ required: true, message: '请写清目标赛道' }]}>
                    <Input placeholder="例如：女频悬疑成长 / 男频末世群像" />
                  </Form.Item>
                </div>
                <div className="project-brief__field" data-project-brief-field="targetReader">
                  <Form.Item name="targetReader" label="目标读者" rules={[{ required: true, message: '请写清目标读者' }]}>
                    <Input.TextArea rows={2} placeholder="写读者的阅读偏好、节奏预期和情绪需求。" />
                  </Form.Item>
                </div>
                <div className="project-brief__field" data-project-brief-field="readerPromise">
                  <Form.Item name="readerPromise" label="读者承诺" rules={[{ required: true, message: '请写清读者承诺' }]}>
                    <Input.TextArea rows={2} placeholder="写读者会稳定收到什么体验回报，不要写宣传口号。" />
                  </Form.Item>
                </div>
                <div className="project-brief__field project-brief__field--full" data-project-brief-field="sellingPoints">
                  <Form.Item name="sellingPoints" label="卖点列表" rules={[{ required: true, message: '请补充作品卖点' }]}>
                    <Input.TextArea rows={2} placeholder="建议每行一条，写 3-5 条真正能落地的卖点。" />
                  </Form.Item>
                </div>
                <div className="project-brief__field project-brief__field--full" data-project-brief-field="tabooRules">
                  <Form.Item name="tabooRules" label="禁区 / 不可偏离项">
                    <Input.TextArea rows={2} placeholder="写必须避开的跑偏方式、雷点和失真方向。" />
                  </Form.Item>
                </div>
              </div>
            </section>

            <details className="project-brief__strategy-disclosure">
              <summary>
                <span className="project-brief__disclosure-title">平台策略</span>
                <span className="project-brief__disclosure-summary">
                  {selectedPlatform
                    ? `${selectedPlatform.label} · ${selectedPlatform.positioning}`
                    : '选择平台后显示开局、节奏和包装摘要'}
                </span>
                <span className="project-brief__disclosure-action">查看详情</span>
              </summary>
              {selectedPlatform ? (
                <div className="project-brief__platform-detail">
                  <div className="project-brief__platform-detail-grid">
                    <div className="project-brief__platform-detail-item">
                      <span>开局设计</span>
                      <p>{selectedPlatform.openingFocus}</p>
                    </div>
                    <div className="project-brief__platform-detail-item">
                      <span>连载节奏</span>
                      <p>{selectedPlatform.rhythmFocus}</p>
                    </div>
                    <div className="project-brief__platform-detail-item">
                      <span>包装建议</span>
                      <p>{selectedPlatform.packagingFocus}</p>
                    </div>
                  </div>
                  <div className="project-brief__platform-meta-row">
                    <span className="project-brief__platform-meta-label">质量门准则</span>
                    <div className="project-brief__platform-tags">
                      {selectedPlatform.qualityFocus.map((item, idx) => (
                        <Tag key={idx} color="blue">{item}</Tag>
                      ))}
                    </div>
                  </div>
                  <div className="project-brief__platform-meta-row">
                    <span className="project-brief__platform-meta-label">主要风险</span>
                    <div className="project-brief__platform-tags">
                      {selectedPlatform.riskFocus.map((item, idx) => (
                        <Tag key={idx} color="orange">{item}</Tag>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="project-brief__platform-detail project-brief__platform-detail--empty">
                  选择目标平台后显示策略摘要。
                </div>
              )}
            </details>

            <section className="project-brief__section project-brief__section--boundary">
              <div className="project-brief__section-header">
                <div>
                  <h2>边界与交付</h2>
                </div>
                <AIGenerateButton
                  novelId={novelId}
                  label="AI 生成·边界与交付"
                  intent={hasFilledValues([
                    currentValues.tabooRules,
                    currentValues.deliveryRhythm,
                  ]) ? 'complete' : 'generate'}
                  isJson
                  buildMessages={() => buildDraftMessages({
                    task: '项目立项的边界与交付节奏',
                    mode: hasFilledValues([
                      currentValues.tabooRules,
                      currentValues.deliveryRhythm,
                    ]) ? 'optimize' : 'replace',
                    context: buildPlanningContextSections(currentNovel, {
                      includeSubplots: false,
                      extraSections: [
                        { label: '当前读者承诺', value: currentValues.readerPromise },
                        { label: '当前卖点', value: currentValues.sellingPoints },
                      ],
                    }),
                    fields: [
                      { key: 'tabooRules', label: '禁区 / 不可偏离项', value: currentValues.tabooRules, hint: '写必须避开的跑偏方向、雷点和失真方式。' },
                      { key: 'deliveryRhythm', label: '连载 / 交付节奏', value: currentValues.deliveryRhythm, hint: '写更新节奏、单章回报、卷末闭环和追读节拍。' },
                    ],
                    requirements: [
                      '不要和读者承诺自相矛盾。',
                      '交付节奏要可执行，不要写空话式“持续高能”。',
                    ],
                  })}
                  onResult={(raw) => {
                    const draft = parseDraftJson<Partial<ProjectBriefFormValues>>(raw)
                    applyProjectBriefDraft({
                      tabooRules: typeof draft.tabooRules === 'string' ? draft.tabooRules : undefined,
                      deliveryRhythm: typeof draft.deliveryRhythm === 'string' ? draft.deliveryRhythm : undefined,
                    })
                  }}
                />
              </div>
              <div className="project-brief__field-grid">
                <div className="project-brief__field" data-project-brief-field="deliveryRhythm">
                  <Form.Item name="deliveryRhythm" label="连载 / 交付节奏">
                    <Input.TextArea rows={3} placeholder="写更新节奏、单章回报和卷末回收的基本预期。" />
                  </Form.Item>
                </div>
              </div>

            </section>

            <details className="project-brief__references-disclosure">
              <summary>参考作品 / 对标方向 <span>可选</span></summary>
              <div className="project-brief__field project-brief__field--disclosure" data-project-brief-field="compTitles">
                <Form.Item name="compTitles" label="参考作品 / 对标方向">
                  <Input.TextArea rows={3} placeholder="写 2-4 个参考作品，并点明借鉴点。" />
                </Form.Item>
              </div>
            </details>
          </div>
        </Form>
      </WorkspacePanel>
      <Modal
        title="AI 辅助"
        open={aiAssistOpen}
        onCancel={() => setAiAssistOpen(false)}
        footer={null}
        width={520}
      >
        <div className="project-brief__ai-assist">
          <p>选择本轮对项目立项的作用方式；分区定向生成仍保留在对应区标题。</p>
          <div className="project-brief__ai-assist-actions">
            <Button
              type="primary"
              icon={<RobotOutlined />}
              loading={generatingMode === 'replace'}
              onClick={() => {
                setAiAssistOpen(false)
                void handleGenerate('replace')
              }}
            >
              生成整份首版
            </Button>
            <Button
              icon={<RobotOutlined />}
              loading={generatingMode === 'fill_blanks'}
              onClick={() => {
                setAiAssistOpen(false)
                void handleGenerate('fill_blanks')
              }}
            >
              补全空白字段
            </Button>
          </div>
        </div>
      </Modal>
    </WorkspacePage>
  )
}
