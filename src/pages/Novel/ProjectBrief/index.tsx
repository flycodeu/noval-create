import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Tag, message } from 'antd'
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
  WorkspaceContextSummary,
  WorkspaceMetric,
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

function compactText(value?: string | null, max = 44): string {
  const text = value?.trim() || ''
  if (!text) return '待补充'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function isFilled(value?: string | null): boolean {
  return Boolean(value && value.trim())
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
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ProjectBriefFormValues>()
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<ProjectBriefGenerationMode | null>(null)
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
  const coreFilledCount = [
    currentValues.platformMode,
    currentValues.targetAudience,
    currentValues.targetReader,
    currentValues.readerPromise,
    currentValues.sellingPoints,
    currentValues.compTitles,
  ].filter((value) => typeof value === 'string' ? isFilled(value) : Boolean(value)).length
  const guardrailCount = [currentValues.tabooRules, currentValues.deliveryRhythm].filter(isFilled).length
  const structureAssetCount = stats.outlineCount + stats.timelineCount + stats.chapterCount
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

  const handleSave = async () => {
    const rawValues = await form.validateFields().catch(() => null)
    if (!rawValues) return
    const values = normalizeFormValues(rawValues)
    setSaving(true)

    try {
      await window.electron.novel.update(novelId, {
        projectBriefJson: buildProjectBriefPayload(values, currentNovel?.projectBriefJson),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await finalizeDraft(values)
      await clearDraft()
      message.success(getUserFacingMessage('projectBrief.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'projectBrief.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

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
            key: 'generate-first',
            label: 'AI 生成·首版',
            icon: <RobotOutlined />,
            loading: generatingMode === 'replace',
            disabled: Boolean(generatingMode),
            onClick: () => void handleGenerate('replace'),
          },
          {
            key: 'fill-blanks',
            label: 'AI 补全·空白字段',
            loading: generatingMode === 'fill_blanks',
            disabled: Boolean(generatingMode),
            onClick: () => void handleGenerate('fill_blanks'),
          },
          {
            key: 'next-settings',
            label: '去基础设定',
            icon: <ArrowRightOutlined />,
            onClick: () => navigate(buildWorkspaceRoute(novelId, 'core-settings')),
          },
        ],
      }}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '目标平台', value: selectedPlatform?.label || '未选择' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
            { label: '完成度', value: `${coreFilledCount}/6` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="核心字段" value={`${coreFilledCount}/6`} tone="warm" />
          <WorkspaceMetric label="边界约束" value={`${guardrailCount}/2`} />
          <WorkspaceMetric label="故事线程" value={stats.threadCount} />
          <WorkspaceMetric label="结构资产" value={structureAssetCount} />
        </>
      )}
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
      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复未保存的 AI 结果，保存后自动生效"
        />
      ) : null}

      <WorkspacePanel extra={<Tag color={generatingMode ? 'gold' : 'blue'}>{generatingMode ? 'AI 生成中' : '手动保存生效'}</Tag>}>
        <Form form={form} layout="vertical">
          <div className="workspace-stack-16">
            <div className="workspace-stack-10">
              <Space wrap align="center">
                <strong className="workspace-card-section-title">赛道与读者承诺</strong>
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
                      { key: 'platformMode', label: '目标平台', value: currentValues.platformMode, hint: '可选番茄、飞卢或通用网文/出版；平台会约束后续开局、节奏和质量门。' },
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
              </Space>
              <div className="guided-step__field-grid project-brief__grid">
                <div className="guided-step__field-card guided-step__field-card--compact project-brief__platform-select-card">
                  <Form.Item name="platformMode" label="目标平台" rules={[{ required: true, message: '请选择目标平台' }]}>
                    <Select options={PLATFORM_OPTIONS} placeholder="选择平台，后续设计会套用对应策略" />
                  </Form.Item>
                </div>
                <div className="guided-step__field-card guided-step__field-card--compact project-brief__track-card">
                  <Form.Item name="targetAudience" label="目标赛道" rules={[{ required: true, message: '请写清目标赛道' }]}>
                    <Input placeholder="例如：女频悬疑成长 / 男频末世群像" />
                  </Form.Item>
                </div>

                {selectedPlatform ? (
                  <div className="guided-step__field-card guided-step__field-card--full project-brief__platform-card">
                    <div className="project-brief__platform-header">
                      <div className="project-brief__platform-header-row">
                        <span className="project-brief__platform-badge">平台设计约束</span>
                        <strong className="project-brief__platform-title">{selectedPlatform.label}</strong>
                        <Tag color="gold">已绑定后续生成与质量门</Tag>
                      </div>
                      <div className="project-brief__platform-quote">
                        {selectedPlatform.positioning}
                      </div>
                    </div>

                    <div className="project-brief__platform-subgrid">
                      <div className="project-brief__platform-subcard">
                        <div className="project-brief__platform-subcard-head">
                          <span className="project-brief__platform-pill project-brief__platform-pill--opening">开局设计</span>
                        </div>
                        <div className="project-brief__platform-subcard-text">{selectedPlatform.openingFocus}</div>
                      </div>
                      <div className="project-brief__platform-subcard">
                        <div className="project-brief__platform-subcard-head">
                          <span className="project-brief__platform-pill project-brief__platform-pill--rhythm">连载节奏</span>
                        </div>
                        <div className="project-brief__platform-subcard-text">{selectedPlatform.rhythmFocus}</div>
                      </div>
                      <div className="project-brief__platform-subcard">
                        <div className="project-brief__platform-subcard-head">
                          <span className="project-brief__platform-pill project-brief__platform-pill--packaging">包装建议</span>
                        </div>
                        <div className="project-brief__platform-subcard-text">{selectedPlatform.packagingFocus}</div>
                      </div>
                    </div>

                    <div className="project-brief__platform-footer">
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
                  </div>
                ) : null}

                <div className="guided-step__field-card">
                  <Form.Item name="targetReader" label="目标读者" rules={[{ required: true, message: '请写清目标读者' }]}>
                    <Input.TextArea rows={4} placeholder="写读者的阅读偏好、节奏预期和情绪需求。" />
                  </Form.Item>
                </div>
                <div className="guided-step__field-card">
                  <Form.Item name="readerPromise" label="读者承诺" rules={[{ required: true, message: '请写清读者承诺' }]}>
                    <Input.TextArea rows={4} placeholder="写读者会稳定收到什么体验回报，不要写宣传口号。" />
                  </Form.Item>
                </div>
                <div className="guided-step__field-card guided-step__field-card--full">
                  <Form.Item name="sellingPoints" label="卖点列表" rules={[{ required: true, message: '请补充作品卖点' }]}>
                    <Input.TextArea rows={4} placeholder="建议每行一条，写 3-5 条真正能落地的卖点。" />
                  </Form.Item>
                </div>
                <div className="guided-step__field-card guided-step__field-card--full">
                  <Form.Item name="compTitles" label="参考作品 / 对标方向" rules={[{ required: true, message: '请补充参考作品' }]}>
                    <Input.TextArea rows={4} placeholder="写 2-4 个参考作品，并点明借鉴点。" />
                  </Form.Item>
                </div>
              </div>
            </div>

            <div className="workspace-stack-10">
              <Space wrap align="center">
                <strong className="workspace-card-section-title">边界与交付</strong>
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
              </Space>
              <div className="guided-step__field-grid">
                <div className="guided-step__field-card">
                  <Form.Item name="tabooRules" label="禁区 / 不可偏离项">
                    <Input.TextArea rows={4} placeholder="写必须避开的跑偏方式、雷点和失真方向。" />
                  </Form.Item>
                </div>
                <div className="guided-step__field-card">
                  <Form.Item name="deliveryRhythm" label="连载 / 交付节奏">
                    <Input.TextArea rows={4} placeholder="写更新节奏、单章回报和卷末回收的基本预期。" />
                  </Form.Item>
                </div>
              </div>
            </div>
          </div>
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
