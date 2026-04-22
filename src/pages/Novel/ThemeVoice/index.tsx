import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, List, Modal, Select, Space, Tag, message } from 'antd'
import { ArrowRightOutlined, DeleteOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import {
  buildThemeVoicePayload,
  parseThemeVoiceDocument,
  parseThemeVoiceSnapshot,
  type ThemeVoiceFlashbackPolicy,
  type ThemeVoiceOpeningStyle,
  type ThemeVoiceParallelTimelines,
  type ThemeVoicePov,
  type ThemeVoiceProtagonistCount,
  type ThemeVoiceTense,
  type ThemeVoiceViewpointMode,
} from '../../../shared/theme-voice'
import {
  WRITING_CONTRACT_PRESETS,
  formatWritingContractTags,
  getWritingContractValidationError,
  normalizeWritingContractTags,
} from '../../../shared/writing-contract'
import type {
  ThemeVoiceGenerationMode,
  ThemeVoiceGenerationResult,
} from '../../../shared/theme-voice-generation'
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

interface ThemeVoiceFormValues {
  writingContractTags: string[]
  theme: string
  motifs: string
  emotionalCore: string
  pov: ThemeVoicePov | ''
  tense: ThemeVoiceTense | ''
  protagonistCount: ThemeVoiceProtagonistCount | ''
  viewpointMode: ThemeVoiceViewpointMode | ''
  parallelTimelines: ThemeVoiceParallelTimelines | ''
  openingStyle: ThemeVoiceOpeningStyle | ''
  flashbackPolicy: ThemeVoiceFlashbackPolicy | ''
  narratorDistance: string
  voiceKeywords: string
  styleRules: string
  dialogueRules: string
  descriptionRules: string
  forbiddenPhrases: string
}

const POV_OPTIONS: Array<{ value: ThemeVoicePov; label: string }> = [
  { value: 'first_person', label: '第一人称' },
  { value: 'third_limited', label: '第三人称限知' },
  { value: 'third_omniscient', label: '第三人称全知' },
  { value: 'multi_pov', label: '多视角' },
]

const TENSE_OPTIONS: Array<{ value: ThemeVoiceTense; label: string }> = [
  { value: 'past', label: '过去时' },
  { value: 'present', label: '现在时' },
  { value: 'mixed', label: '混合时态' },
]

const PROTAGONIST_COUNT_OPTIONS: Array<{ value: ThemeVoiceProtagonistCount; label: string }> = [
  { value: 'single', label: '单主角' },
  { value: 'dual', label: '双主角' },
  { value: 'ensemble', label: '群像' },
]

const VIEWPOINT_MODE_OPTIONS: Array<{ value: ThemeVoiceViewpointMode; label: string }> = [
  { value: 'fixed', label: '固定视角' },
  { value: 'rotating', label: '轮换视角' },
  { value: 'free_switch', label: '自由切换' },
]

const PARALLEL_TIMELINES_OPTIONS: Array<{ value: ThemeVoiceParallelTimelines; label: string }> = [
  { value: 'none', label: '单线推进' },
  { value: 'light', label: '轻度多线' },
  { value: 'heavy', label: '重度多线' },
]

const OPENING_STYLE_OPTIONS: Array<{ value: ThemeVoiceOpeningStyle; label: string }> = [
  { value: 'hook', label: '钩子型开篇' },
  { value: 'daily', label: '日常切入' },
  { value: 'incident', label: '事件切入' },
  { value: 'flashback', label: '倒叙开场' },
]

const FLASHBACK_POLICY_OPTIONS: Array<{ value: ThemeVoiceFlashbackPolicy; label: string }> = [
  { value: 'forbidden', label: '禁止插叙' },
  { value: 'limited', label: '有限使用' },
  { value: 'allowed', label: '允许使用' },
]

const EMPTY_THEME_VOICE_VALUES: ThemeVoiceFormValues = {
  writingContractTags: [],
  theme: '',
  motifs: '',
  emotionalCore: '',
  pov: '',
  tense: '',
  protagonistCount: '',
  viewpointMode: '',
  parallelTimelines: '',
  openingStyle: '',
  flashbackPolicy: '',
  narratorDistance: '',
  voiceKeywords: '',
  styleRules: '',
  dialogueRules: '',
  descriptionRules: '',
  forbiddenPhrases: '',
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

function normalizeFormValues(values: ThemeVoiceFormValues): ThemeVoiceFormValues {
  return {
    writingContractTags: normalizeWritingContractTags(values.writingContractTags),
    theme: normalizeText(values.theme),
    motifs: normalizeText(values.motifs),
    emotionalCore: normalizeText(values.emotionalCore),
    pov: values.pov,
    tense: values.tense,
    protagonistCount: values.protagonistCount,
    viewpointMode: values.viewpointMode,
    parallelTimelines: values.parallelTimelines,
    openingStyle: values.openingStyle,
    flashbackPolicy: values.flashbackPolicy,
    narratorDistance: normalizeText(values.narratorDistance),
    voiceKeywords: normalizeText(values.voiceKeywords),
    styleRules: normalizeText(values.styleRules),
    dialogueRules: normalizeText(values.dialogueRules),
    descriptionRules: normalizeText(values.descriptionRules),
    forbiddenPhrases: normalizeText(values.forbiddenPhrases),
  }
}

function buildCurrentFormValues(
  snapshot: ThemeVoiceFormValues,
  formValues: Partial<ThemeVoiceFormValues>,
): ThemeVoiceFormValues {
  return {
    ...snapshot,
    ...formValues,
    writingContractTags: normalizeWritingContractTags(formValues.writingContractTags ?? snapshot.writingContractTags),
    pov: formValues.pov ?? snapshot.pov,
    tense: formValues.tense ?? snapshot.tense,
    protagonistCount: formValues.protagonistCount ?? snapshot.protagonistCount,
    viewpointMode: formValues.viewpointMode ?? snapshot.viewpointMode,
    parallelTimelines: formValues.parallelTimelines ?? snapshot.parallelTimelines,
    openingStyle: formValues.openingStyle ?? snapshot.openingStyle,
    flashbackPolicy: formValues.flashbackPolicy ?? snapshot.flashbackPolicy,
  }
}

function mergeGeneratedValues(
  current: ThemeVoiceFormValues,
  result: ThemeVoiceGenerationResult,
  mode: ThemeVoiceGenerationMode,
): ThemeVoiceFormValues {
  const pick = (existing?: string | null, next?: string | null) => {
    const currentValue = normalizeText(existing)
    if (mode === 'fill_blanks' && currentValue) return currentValue
    return normalizeText(next)
  }

  const pickTags = () => {
    const currentTags = normalizeWritingContractTags(current.writingContractTags)
    if (mode === 'fill_blanks' && currentTags.length > 0) return currentTags
    const nextTags = normalizeWritingContractTags(result.writingContractTags)
    return nextTags.length > 0 ? nextTags : currentTags
  }

  return {
    writingContractTags: pickTags(),
    theme: pick(current.theme, result.theme),
    motifs: pick(current.motifs, result.motifs),
    emotionalCore: pick(current.emotionalCore, result.emotionalCore),
    pov: mode === 'fill_blanks' && current.pov ? current.pov : (result.pov || current.pov),
    tense: mode === 'fill_blanks' && current.tense ? current.tense : (result.tense || current.tense),
    protagonistCount: mode === 'fill_blanks' && current.protagonistCount ? current.protagonistCount : (result.protagonistCount || current.protagonistCount),
    viewpointMode: mode === 'fill_blanks' && current.viewpointMode ? current.viewpointMode : (result.viewpointMode || current.viewpointMode),
    parallelTimelines: mode === 'fill_blanks' && current.parallelTimelines ? current.parallelTimelines : (result.parallelTimelines || current.parallelTimelines),
    openingStyle: mode === 'fill_blanks' && current.openingStyle ? current.openingStyle : (result.openingStyle || current.openingStyle),
    flashbackPolicy: mode === 'fill_blanks' && current.flashbackPolicy ? current.flashbackPolicy : (result.flashbackPolicy || current.flashbackPolicy),
    narratorDistance: pick(current.narratorDistance, result.narratorDistance),
    voiceKeywords: pick(current.voiceKeywords, result.voiceKeywords),
    styleRules: pick(current.styleRules, result.styleRules),
    dialogueRules: pick(current.dialogueRules, result.dialogueRules),
    descriptionRules: pick(current.descriptionRules, result.descriptionRules),
    forbiddenPhrases: pick(current.forbiddenPhrases, result.forbiddenPhrases),
  }
}

export default function ThemeVoicePage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ThemeVoiceFormValues>()
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<ThemeVoiceGenerationMode | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [stats, setStats] = useState({ totalWords: 0, revisionTaskCount: 0 })

  const snapshot = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )

  useEffect(() => {
    form.setFieldsValue(snapshot)
  }, [form, snapshot])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (!active) return
      setStats({
        totalWords: workflowStats.totalWords,
        revisionTaskCount: workflowStats.revisionTaskCount,
      })
    })
    return () => {
      active = false
    }
  }, [novelId])

  const watchedValues = (Form.useWatch([], form) as Partial<ThemeVoiceFormValues> | undefined) || {}
  const currentValues = buildCurrentFormValues(snapshot, watchedValues)
  const foundationCount = [
    currentValues.writingContractTags.length > 0,
    currentValues.theme,
    currentValues.emotionalCore,
    currentValues.pov,
    currentValues.tense,
    currentValues.styleRules,
    currentValues.dialogueRules,
  ].filter((value) => typeof value === 'string' ? isFilled(value) : Boolean(value)).length
  const detailCount = [
    currentValues.motifs,
    currentValues.protagonistCount,
    currentValues.viewpointMode,
    currentValues.parallelTimelines,
    currentValues.openingStyle,
    currentValues.flashbackPolicy,
    currentValues.narratorDistance,
    currentValues.voiceKeywords,
    currentValues.descriptionRules,
    currentValues.forbiddenPhrases,
  ].filter(isFilled).length
  const applyThemeVoiceDraft = (draft: Partial<ThemeVoiceFormValues>) => {
    form.setFieldsValue(buildCurrentFormValues(snapshot, draft))
  }
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<ThemeVoiceFormValues>({
    novelId,
    pageKey: 'theme-voice',
    applyDraft: applyThemeVoiceDraft,
  })

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'theme-voice',
    getSnapshot: () => ({
      scope: 'form',
      fields: normalizeFormValues(buildCurrentFormValues(snapshot, form.getFieldsValue(true))),
    }),
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<ThemeVoiceFormValues>
        : {}
      applyThemeVoiceDraft({
        writingContractTags: Array.isArray(fields.writingContractTags) ? fields.writingContractTags : undefined,
        theme: typeof fields.theme === 'string' ? fields.theme : undefined,
        motifs: typeof fields.motifs === 'string' ? fields.motifs : undefined,
        emotionalCore: typeof fields.emotionalCore === 'string' ? fields.emotionalCore : undefined,
        pov: fields.pov,
        tense: fields.tense,
        protagonistCount: fields.protagonistCount,
        viewpointMode: fields.viewpointMode,
        parallelTimelines: fields.parallelTimelines,
        openingStyle: fields.openingStyle,
        flashbackPolicy: fields.flashbackPolicy,
        narratorDistance: typeof fields.narratorDistance === 'string' ? fields.narratorDistance : undefined,
        voiceKeywords: typeof fields.voiceKeywords === 'string' ? fields.voiceKeywords : undefined,
        styleRules: typeof fields.styleRules === 'string' ? fields.styleRules : undefined,
        dialogueRules: typeof fields.dialogueRules === 'string' ? fields.dialogueRules : undefined,
        descriptionRules: typeof fields.descriptionRules === 'string' ? fields.descriptionRules : undefined,
        forbiddenPhrases: typeof fields.forbiddenPhrases === 'string' ? fields.forbiddenPhrases : undefined,
      })
    },
    persistPreview: async (nextSnapshot, preview) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<ThemeVoiceFormValues>
        : {}
      await saveAppliedDraft(normalizeFormValues(buildCurrentFormValues(snapshot, fields)), preview.warnings, 'theme-voice', {
        inputSummary: 'AI质量修复',
        rawOutputs: [JSON.stringify(preview.patchedSnapshot)],
      })
    },
  }), [form, saveAppliedDraft, snapshot])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = async () => {
    const values = normalizeFormValues(await form.validateFields())
    const contractError = getWritingContractValidationError(values.writingContractTags)
    if (contractError) {
      message.warning(contractError)
      return
    }

    setSaving(true)

    try {
      await window.electron.novel.update(novelId, {
        themeVoiceJson: buildThemeVoicePayload(values, currentNovel?.themeVoiceJson),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await finalizeDraft(values)
      await clearDraft()
      message.success(getUserFacingMessage('themeVoice.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'themeVoice.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async (mode: ThemeVoiceGenerationMode) => {
    setGeneratingMode(mode)
    setWarnings([])

    try {
      const result = await window.electron.ai.generateThemeVoice({
        novelId,
        mode,
        requirements: '优先生成自然、具体、可执行的中文规则，重点压制总结腔、模板句和不符合人物身份的空泛对白。',
      })

      const merged = mergeGeneratedValues(
        buildCurrentFormValues(snapshot, form.getFieldsValue(true)),
        result,
        mode,
      )
      form.setFieldsValue(merged)
      setWarnings(result.warnings)
      void saveAppliedDraft(merged, result.warnings, 'theme-voice', {
        inputSummary: `${mode === 'fill_blanks' ? '补空白' : '首版'} · ${currentNovel?.title || '未命名小说'}`,
      }).catch(console.error)

      if (result.warnings.length > 0) {
        message.warning(getUserFacingMessage('themeVoice.generatedWithWarnings', { count: result.warnings.length }))
      } else if (mode === 'fill_blanks') {
        message.success(getUserFacingMessage('themeVoice.filledBlanks'))
      } else {
        message.success(getUserFacingMessage('themeVoice.generated'))
      }
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'themeVoice.generateFailed'))
    } finally {
      setGeneratingMode(null)
    }
  }

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: '清空主题与文风？',
      content: '会清空当前文风规则、视角时态和写作约束，并直接保存为空白基线。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const nextPayload = buildThemeVoicePayload(EMPTY_THEME_VOICE_VALUES, currentNovel?.themeVoiceJson)
        await window.electron.novel.update(novelId, {
          themeVoiceJson: nextPayload,
        })

        const updated = await window.electron.novel.get(novelId)
        if (updated) setCurrentNovel(updated)
        form.setFieldsValue(parseThemeVoiceDocument(nextPayload))
        setWarnings([])
        await clearDraft()
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('themeVoice.cleared'))
      },
    })
  }, [clearDraft, currentNovel?.themeVoiceJson, form, novelId, notifyWorkspaceMutation, setCurrentNovel])

  useEffect(() => {
    registerClearHandler(() => {
      handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  return (
    <WorkspacePage
      className="novel-theme-voice-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="主题与文风"
      title="主题与文风"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存主题与文风
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
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/world-rules`)}>
            去世界规则
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '项目立项', value: currentNovel?.projectBriefJson ? '已存在' : '未设置' },
            { label: '写作类型', value: formatWritingContractTags(currentValues.writingContractTags) || '待设定' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="基础约束" value={`${foundationCount}/7`} tone="warm" hint="阅读预期、主题、情感核心、视角、时态、风格、对白。" />
          <WorkspaceMetric label="补充细则" value={`${detailCount}/10`} hint="母题、叙事调度、叙述距离、口吻词、描写规则、禁用表达。" />
          <WorkspaceMetric label="修订任务" value={stats.revisionTaskCount} hint="显示当前修订任务数量。" />
        </>
      )}
    >
      {!currentNovel?.projectBriefJson ? (
        <Alert
          type="info"
          showIcon
          message="项目立项未完成"
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
          description="当前主题与文风表单包含最近一次已应用但尚未保存的 AI 结果。保存后会自动清除。"
        />
      ) : null}

      <WorkspacePanel extra={<Tag color={generatingMode ? 'gold' : 'blue'}>{generatingMode ? 'AI 生成中' : '手动保存生效'}</Tag>}>
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item
                name="writingContractTags"
                label="写作类型"
                extra="内置标签会触发强规则；自定义标签只作为弱提示。核心阅读预期“爽文 / 写实”只能选一个。"
                rules={[{
                  validator: async (_, value?: string[]) => {
                    const error = getWritingContractValidationError(normalizeWritingContractTags(value))
                    if (error) throw new Error(error)
                  },
                }]}
              >
                <Select
                  mode="tags"
                  allowClear
                  options={WRITING_CONTRACT_PRESETS.map((preset) => ({
                    value: preset.value,
                    label: `${preset.label} · ${preset.group === 'core' ? '核心预期' : '内容重心'}`,
                  }))}
                  placeholder="例如：爽文、言情，或补充自定义短标签"
                  tokenSeparators={[',', '，', '、']}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="theme" label="主题" rules={[{ required: true, message: '请写清主题' }]}>
                <Input.TextArea rows={4} placeholder="写作品持续回答的命题，不要写成宣传口号。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="emotionalCore" label="情感核心" rules={[{ required: true, message: '请写清情感核心' }]}>
                <Input.TextArea rows={4} placeholder="写读者最稳定收到的情绪回报和压强。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="motifs" label="母题 / 重复意象">
                <Input.TextArea rows={3} placeholder="写会反复出现的母题、意象和回响，建议每行一条。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="pov" label="叙事视角" rules={[{ required: true, message: '请选择叙事视角' }]}>
                <Select options={POV_OPTIONS} placeholder="选择视角" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="tense" label="时态" rules={[{ required: true, message: '请选择时态' }]}>
                <Select options={TENSE_OPTIONS} placeholder="选择时态" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="protagonistCount" label="主角格局">
                <Select options={PROTAGONIST_COUNT_OPTIONS} placeholder="选择主角格局" allowClear />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="viewpointMode" label="视角调度">
                <Select options={VIEWPOINT_MODE_OPTIONS} placeholder="选择视角调度" allowClear />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="parallelTimelines" label="叙事线密度">
                <Select options={PARALLEL_TIMELINES_OPTIONS} placeholder="选择叙事线密度" allowClear />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="openingStyle" label="开篇方式">
                <Select options={OPENING_STYLE_OPTIONS} placeholder="选择开篇方式" allowClear />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="flashbackPolicy" label="插叙策略">
                <Select options={FLASHBACK_POLICY_OPTIONS} placeholder="选择插叙策略" allowClear />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="narratorDistance" label="叙述距离">
                <Input.TextArea rows={3} placeholder="写叙述者与人物之间的距离，以及解释密度。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="voiceKeywords" label="口吻关键词">
                <Input.TextArea rows={3} placeholder="建议 4-8 个词，每行一条，描述整体口吻而非营销词。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="styleRules" label="风格规则" rules={[{ required: true, message: '请补充风格规则' }]}>
                <Input.TextArea rows={5} placeholder="把句式、节奏和信息暴露方式写成规则，建议每行一条。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="dialogueRules" label="对白规则" rules={[{ required: true, message: '请补充对白规则' }]}>
                <Input.TextArea rows={5} placeholder="写潜台词密度、句长控制、留白方式和人物区分度。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="descriptionRules" label="描写规则">
                <Input.TextArea rows={4} placeholder="写场景、动作、心理描写的比例和取舍。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="forbiddenPhrases" label="禁用表达">
                <Input.TextArea rows={4} placeholder="写应避免的总结腔、模板句、空泛抒情和引号强调。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <StyleLearningPanel novelId={novelId} />
    </WorkspacePage>
  )
}

function StyleLearningPanel({ novelId }: { novelId: number }) {
  const [referenceText, setReferenceText] = useState('')
  const [fingerprintName, setFingerprintName] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [fingerprints, setFingerprints] = useState<Array<{
    id: number
    name: string
    fingerprintJson: string | null
    createdAt: string
  }>>([])

  const loadFingerprints = useCallback(async () => {
    try {
      const list = await window.electron.style.list(novelId)
      setFingerprints(list)
    } catch { /* ignore */ }
  }, [novelId])

  useEffect(() => { void loadFingerprints() }, [loadFingerprints])

  const handleAnalyze = async () => {
    if (!referenceText.trim() || referenceText.length < 500) {
      message.warning(getUserFacingMessage('themeVoice.referenceTextTooShort'))
      return
    }
    if (!fingerprintName.trim()) {
      message.warning(getUserFacingMessage('themeVoice.styleNameRequired'))
      return
    }
    setAnalyzing(true)
    try {
      await window.electron.style.create(novelId, fingerprintName.trim(), referenceText)
      message.success(getUserFacingMessage('themeVoice.styleFingerprintApplied'))
      setReferenceText('')
      setFingerprintName('')
      void loadFingerprints()
    } catch (error) {
      message.error(getUserFacingMessage('themeVoice.styleAnalysisFailed', {
        detail: error instanceof Error ? error.message : '未知错误',
      }))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await window.electron.style.delete(id)
      void loadFingerprints()
      message.success(getUserFacingMessage('themeVoice.deleted'))
    } catch { /* ignore */ }
  }

  return (
    <WorkspacePanel
      title="风格学习"
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Input
          placeholder={'风格名称，如"张三丰·冷硬派"'}
          value={fingerprintName}
          onChange={(e) => setFingerprintName(e.target.value)}
          style={{ maxWidth: 400 }}
        />
        <Input.TextArea
          rows={8}
          placeholder="粘贴参考文本（建议500字以上，越多越准）"
          value={referenceText}
          onChange={(e) => setReferenceText(e.target.value)}
        />
        <div>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={analyzing}
            onClick={() => void handleAnalyze()}
            disabled={!referenceText.trim() || !fingerprintName.trim()}
          >
            分析并生成风格指纹
          </Button>
          <span style={{ marginLeft: 12, fontSize: 12, opacity: 0.6 }}>
            {referenceText.length} 字
          </span>
        </div>

        {fingerprints.length > 0 ? (
          <div>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>已保存的风格指纹</div>
            <List
              size="small"
              dataSource={fingerprints}
              renderItem={(fp) => {
                let preview = ''
                if (fp.fingerprintJson) {
                  try {
                    const parsed = JSON.parse(fp.fingerprintJson)
                    preview = [
                      parsed.toneKeywords?.join('、'),
                      parsed.paceProfile,
                      parsed.dialogueStyle,
                    ].filter(Boolean).join(' · ')
                  } catch { /* ignore */ }
                }
                return (
                  <List.Item
                    actions={[
                      <Button
                        key="delete"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => void handleDelete(fp.id)}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Tag color="blue">{fp.name}</Tag>}
                      description={preview || '无预览'}
                    />
                  </List.Item>
                )
              }}
            />
          </div>
        ) : null}
      </div>
    </WorkspacePanel>
  )
}
