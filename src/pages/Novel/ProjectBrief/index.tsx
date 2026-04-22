import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Tag, message } from 'antd'
import { ArrowRightOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { ProjectPlatformMode } from '../../../shared/project-brief'
import {
  buildProjectBriefPayload,
  parseProjectBriefDocument,
  parseProjectBriefSnapshot,
} from '../../../shared/project-brief'
import type {
  ProjectBriefGenerationMode,
  ProjectBriefGenerationResult,
} from '../../../shared/project-brief-generation'
import { useNovelStore } from '../../../stores/novel.store'
import { usePlanningDraft } from '../shared/planning-draft'
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
import { loadWorkflowStats } from '../workflow'

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
  { value: 'general', label: '通用长篇' },
  { value: 'web_serial', label: '网文连载' },
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
  const { currentNovel, setCurrentNovel } = useNovelStore()
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
    })
    return () => {
      active = false
    }
  }, [novelId])

  const watchedValues = (Form.useWatch([], form) as Partial<ProjectBriefFormValues> | undefined) || {}
  const currentValues = buildCurrentFormValues(snapshot, watchedValues)
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
  const applyProjectBriefDraft = (draft: Partial<ProjectBriefFormValues>) => {
    form.setFieldsValue(buildCurrentFormValues(snapshot, draft))
  }
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
  }), [form, saveAppliedDraft, snapshot])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = async () => {
    const values = normalizeFormValues(await form.validateFields())
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

  const handleClear = () => {
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
  }

  useEffect(() => {
    registerClearHandler(handleClear)
    return () => registerClearHandler(null)
  }, [registerClearHandler, currentNovel?.projectBriefJson])

  return (
    <WorkspacePage
      className="novel-project-brief-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="项目立项"
      title="项目立项"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存项目立项
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={generatingMode === 'replace'}
            disabled={Boolean(generatingMode)}
            onClick={() => void handleGenerate('replace')}
          >
            AI 生成·首版
          </Button>
          <Button
            loading={generatingMode === 'fill_blanks'}
            disabled={Boolean(generatingMode)}
            onClick={() => void handleGenerate('fill_blanks')}
          >
            AI 补全·空白字段
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/theme-voice`)}>
            去主题与文风
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
            { label: '完成度', value: `${coreFilledCount}/6` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="核心字段" value={`${coreFilledCount}/6`} tone="warm" hint="模式、赛道、读者、承诺、卖点、参考。" />
          <WorkspaceMetric label="边界约束" value={`${guardrailCount}/2`} hint="禁区和交付节奏决定后续是否容易跑偏。" />
          <WorkspaceMetric label="故事线程" value={stats.threadCount} hint="线索页应服从立项表里的产品承诺。" />
          <WorkspaceMetric label="结构资产" value={structureAssetCount} hint="结构越多，越需要先把 Brief 写稳。" />
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
          message="已恢复最近一次未保存的 AI 草稿"
          description="当前项目立项表单包含最近一次已应用但尚未保存的 AI 结果。保存后会自动清除。"
        />
      ) : null}

      <WorkspacePanel extra={<Tag color={generatingMode ? 'gold' : 'blue'}>{generatingMode ? 'AI 生成中' : '手动保存生效'}</Tag>}>
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="platformMode" label="产品形态" rules={[{ required: true, message: '请选择产品形态' }]}>
                <Select options={PLATFORM_OPTIONS} placeholder="这本书主要面向哪种交付方式" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetAudience" label="目标赛道" rules={[{ required: true, message: '请写清目标赛道' }]}>
                <Input placeholder="例如：女频悬疑成长 / 男频末世群像" />
              </Form.Item>
            </div>
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
                <Input.TextArea rows={3} placeholder="写 2-4 个参考作品，并点明借鉴点。" />
              </Form.Item>
            </div>
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
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
