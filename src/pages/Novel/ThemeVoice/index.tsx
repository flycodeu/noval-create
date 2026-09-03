import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Segmented, Select, Tag, message } from 'antd'
import { AppstoreAddOutlined, ArrowRightOutlined, ExperimentOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
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
import type { Template } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { usePlanningDraft } from '../shared/planning-draft'
import {
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context-core'
import { useNovelWorkspaceActions, useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import { loadWorkflowStats } from '../workflow'
import './index.css'

interface Props {
  novelId: number
}

interface ThemeVoiceFormValues {
  writingContractTags: string[]
  theme: string
  themeChapterTest: string
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
  targetWorkSampleGuide: string
  humanStyleSampleLock: string
}

type ThemeVoiceGenerationTarget = 'all' | 'narrative' | 'style'

const THEME_VOICE_TARGET_FIELDS: Record<ThemeVoiceGenerationTarget, Array<keyof ThemeVoiceFormValues>> = {
  all: [
    'writingContractTags', 'theme', 'themeChapterTest', 'motifs', 'emotionalCore', 'pov', 'tense',
    'protagonistCount', 'viewpointMode', 'parallelTimelines', 'openingStyle', 'flashbackPolicy',
    'narratorDistance', 'voiceKeywords', 'styleRules', 'dialogueRules', 'descriptionRules',
    'forbiddenPhrases', 'targetWorkSampleGuide', 'humanStyleSampleLock',
  ],
  narrative: [
    'writingContractTags', 'theme', 'themeChapterTest', 'motifs', 'emotionalCore', 'pov', 'tense',
    'protagonistCount', 'viewpointMode', 'parallelTimelines', 'openingStyle', 'flashbackPolicy',
    'narratorDistance', 'voiceKeywords',
  ],
  style: ['styleRules', 'dialogueRules', 'descriptionRules', 'forbiddenPhrases', 'targetWorkSampleGuide', 'humanStyleSampleLock'],
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
  themeChapterTest: '',
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
  targetWorkSampleGuide: '',
  humanStyleSampleLock: '',
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
    themeChapterTest: normalizeText(values.themeChapterTest),
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
    targetWorkSampleGuide: normalizeText(values.targetWorkSampleGuide),
    humanStyleSampleLock: normalizeText(values.humanStyleSampleLock),
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
  target: ThemeVoiceGenerationTarget = 'all',
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

  const merged: ThemeVoiceFormValues = {
    writingContractTags: pickTags(),
    theme: pick(current.theme, result.theme),
    themeChapterTest: pick(current.themeChapterTest, result.themeChapterTest),
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
    targetWorkSampleGuide: pick(current.targetWorkSampleGuide, result.targetWorkSampleGuide),
    humanStyleSampleLock: pick(current.humanStyleSampleLock, result.humanStyleSampleLock),
  }

  if (target === 'all') return merged
  return THEME_VOICE_TARGET_FIELDS[target].reduce<ThemeVoiceFormValues>(
    (next, key) => ({ ...next, [key]: merged[key] }),
    current,
  )
}

interface StyleTemplateContent {
  perspective?: string
  sentence_style?: string
  emotion_style?: string
  dialogue_style?: string
  description_style?: string
  forbidden?: string[]
  example_tone?: string
}

function parseStyleTemplate(template: Template): StyleTemplateContent {
  if (!template.contentJson) return {}
  try {
    const parsed = JSON.parse(template.contentJson) as StyleTemplateContent
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function applyStyleTemplateValues(
  current: ThemeVoiceFormValues,
  template: Template,
  mode: 'fill_blanks' | 'replace',
): ThemeVoiceFormValues {
  const content = parseStyleTemplate(template)
  const pick = (existing: string, next?: string) => {
    if (!next?.trim()) return existing
    if (mode === 'fill_blanks' && existing.trim()) return existing
    return next.trim()
  }
  const forbidden = Array.isArray(content.forbidden) ? content.forbidden.filter(Boolean).join('\n') : ''
  return {
    ...current,
    emotionalCore: pick(current.emotionalCore, content.emotion_style),
    narratorDistance: pick(current.narratorDistance, content.perspective),
    voiceKeywords: pick(current.voiceKeywords, content.example_tone),
    styleRules: pick(current.styleRules, content.sentence_style),
    dialogueRules: pick(current.dialogueRules, content.dialogue_style),
    descriptionRules: pick(current.descriptionRules, content.description_style),
    forbiddenPhrases: pick(current.forbiddenPhrases, forbidden),
    targetWorkSampleGuide: pick(current.targetWorkSampleGuide, content.example_tone),
  }
}

export default function ThemeVoicePage({ novelId }: Props) {
  const navigate = useNavigate()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const { notifyWorkspaceMutation, registerClearHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ThemeVoiceFormValues>()
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<ThemeVoiceGenerationMode | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [stats, setStats] = useState({ totalWords: 0, revisionTaskCount: 0 })
  const [styleTemplates, setStyleTemplates] = useState<Template[]>([])
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateApplyMode, setTemplateApplyMode] = useState<'fill_blanks' | 'replace'>('fill_blanks')
  const [selectedStyleTemplateId, setSelectedStyleTemplateId] = useState<number | null>(currentNovel?.styleTemplateId || null)
  const [templateCandidateId, setTemplateCandidateId] = useState<number | null>(currentNovel?.styleTemplateId || null)
  const [aiAssistOpen, setAiAssistOpen] = useState(false)
  const [aiTarget, setAiTarget] = useState<ThemeVoiceGenerationTarget>('all')
  const [aiMode, setAiMode] = useState<ThemeVoiceGenerationMode>('fill_blanks')

  const snapshot = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )

  useEffect(() => {
    form.setFieldsValue(snapshot)
  }, [form, snapshot])

  useEffect(() => {
    setSelectedStyleTemplateId(currentNovel?.styleTemplateId || null)
  }, [currentNovel?.styleTemplateId])

  useEffect(() => {
    let active = true
    void window.electron.template.list('style').then((templates) => {
      if (active) setStyleTemplates(templates.filter((template) => template.type === 'style'))
    }).catch(console.error)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (!active) return
      setStats({
        totalWords: workflowStats.totalWords,
        revisionTaskCount: workflowStats.revisionTaskCount,
      })
    }).catch(console.error)
    return () => {
      active = false
    }
  }, [novelId])

  const watchedValues = (Form.useWatch([], form) as Partial<ThemeVoiceFormValues> | undefined) || {}
  const currentValues = buildCurrentFormValues(snapshot, watchedValues)
  const persistedSignature = useMemo(() => JSON.stringify({
    values: normalizeFormValues(snapshot),
    styleTemplateId: currentNovel?.styleTemplateId || null,
  }), [currentNovel?.styleTemplateId, snapshot])
  const [lastSavedSignature, setLastSavedSignature] = useState(persistedSignature)
  useEffect(() => {
    setLastSavedSignature(persistedSignature)
  }, [persistedSignature])
  const hasUnsavedChanges = JSON.stringify({
    values: normalizeFormValues(currentValues),
    styleTemplateId: selectedStyleTemplateId,
  }) !== lastSavedSignature
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)
  const foundationCount = [
    currentValues.writingContractTags.length > 0,
    currentValues.theme,
    currentValues.themeChapterTest,
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
    currentValues.targetWorkSampleGuide,
    currentValues.humanStyleSampleLock,
  ].filter(isFilled).length
  const applyThemeVoiceDraft = useCallback((draft: Partial<ThemeVoiceFormValues>) => {
    form.setFieldsValue(buildCurrentFormValues(snapshot, draft))
  }, [form, snapshot])
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
        themeChapterTest: typeof fields.themeChapterTest === 'string' ? fields.themeChapterTest : undefined,
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
        targetWorkSampleGuide: typeof fields.targetWorkSampleGuide === 'string' ? fields.targetWorkSampleGuide : undefined,
        humanStyleSampleLock: typeof fields.humanStyleSampleLock === 'string' ? fields.humanStyleSampleLock : undefined,
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
  }), [applyThemeVoiceDraft, form, saveAppliedDraft, snapshot])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = useCallback(async () => {
    const rawValues = await form.validateFields().catch(() => null)
    if (!rawValues) return false
    const values = normalizeFormValues(rawValues)
    const contractError = getWritingContractValidationError(values.writingContractTags)
    if (contractError) {
      message.warning(contractError)
      return false
    }

    setSaving(true)

    try {
      await window.electron.novel.update(novelId, {
        themeVoiceJson: buildThemeVoicePayload(values, currentNovel?.themeVoiceJson),
        styleTemplateId: selectedStyleTemplateId || undefined,
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      setLastSavedSignature(JSON.stringify({ values, styleTemplateId: selectedStyleTemplateId }))
      await finalizeDraft(values)
      await clearDraft()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('themeVoice.saved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'themeVoice.saveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }, [clearDraft, currentNovel?.themeVoiceJson, finalizeDraft, form, novelId, notifyWorkspaceMutation, selectedStyleTemplateId, setCurrentNovel])

  const handleApplyTemplate = () => {
    if (!templateCandidateId) {
      message.warning(getUserFacingMessage('themeVoice.selectTemplateFirst'))
      return
    }
    const template = styleTemplates.find((item) => item.id === templateCandidateId)
    if (!template) {
      message.warning(getUserFacingMessage('themeVoice.templateUnavailable'))
      return
    }
    const nextValues = applyStyleTemplateValues(
      buildCurrentFormValues(snapshot, form.getFieldsValue(true)),
      template,
      templateApplyMode,
    )
    form.setFieldsValue(nextValues)
    setSelectedStyleTemplateId(template.id)
    setTemplateOpen(false)
    message.success(templateApplyMode === 'fill_blanks' ? '模板已补入空白文风字段，现有内容保持不变。' : '模板文风字段已覆盖到表单，保存后生效。')
  }

  const navigateWithUnsavedGuard = (target: 'world-rules' | 'style-lab') => {
    const leave = () => navigate(buildWorkspaceRoute(novelId, target))
    if (!hasUnsavedChanges) {
      leave()
      return
    }
    Modal.confirm({
      title: '主题与文风还有未保存修改',
      content: '模板和规则都只在当前表单中，先保存再离开可避免内容丢失。',
      okText: '保存并离开',
      cancelText: '留在当前页',
      onOk: async () => {
        const saved = await handleSave()
        if (saved) leave()
      },
    })
  }

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

  const handleGenerate = async (mode: ThemeVoiceGenerationMode, target: ThemeVoiceGenerationTarget = 'all') => {
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
        target,
      )
      form.setFieldsValue(merged)
      setWarnings(result.warnings)
      void saveAppliedDraft(merged, result.warnings, 'theme-voice', {
        inputSummary: `${target === 'all' ? '全部区域' : target === 'narrative' ? '主题与叙事调度' : '文风执行规则'} · ${mode === 'fill_blanks' ? '补空白' : '首版'} · ${currentNovel?.title || '未命名小说'}`,
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

  const handleAIAssistGenerate = async () => {
    setAiAssistOpen(false)
    await handleGenerate(aiMode, aiTarget)
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
      chrome="shared"
      title="主题与文风"
      actionContract={{
        primary: {
          key: 'save',
          label: '保存主题与文风',
          icon: <SaveOutlined />,
          loading: saving,
          onClick: () => void handleSave(),
        },
        secondary: [
          {
            key: 'template',
            label: '应用文风模板',
            icon: <AppstoreAddOutlined />,
            onClick: () => {
              setTemplateCandidateId(selectedStyleTemplateId || styleTemplates[0]?.id || null)
              setTemplateOpen(true)
            },
          },
          {
            key: 'ai-assist',
            label: 'AI 辅助',
            icon: <RobotOutlined />,
            loading: Boolean(generatingMode),
            disabled: Boolean(generatingMode),
            onClick: () => setAiAssistOpen(true),
          },
          {
            key: 'style-lab',
            label: '去文风实验室',
            icon: <ExperimentOutlined />,
            onClick: () => navigateWithUnsavedGuard('style-lab'),
          },
          {
            key: 'world-rules',
            label: '去世界规则',
            icon: <ArrowRightOutlined />,
            onClick: () => navigateWithUnsavedGuard('world-rules'),
          },
        ],
      }}
    >
      <div className="theme-voice__status-rail" data-theme-voice-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <div>
          <strong>{hasUnsavedChanges ? '有未保存修改' : '已确认的标准文风'}</strong>
          <span>{formatWritingContractTags(currentValues.writingContractTags) || '待设定写作契约'} · 核心约束 {foundationCount}/8</span>
        </div>
        <div className="theme-voice__status-meta">
          <span>高级细则 {detailCount}/12</span>
          <span>修订任务 {stats.revisionTaskCount}</span>
        </div>
      </div>
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

      <WorkspacePanel
        className="novel-theme-voice-page__editor-panel"
        extra={generatingMode ? <Tag color="gold">AI 生成中</Tag> : null}
      >
        <Form form={form} layout="vertical">
          <div className="workspace-stack-16">
            <div className="workspace-stack-10 novel-theme-voice-page__section novel-theme-voice-page__section--narrative">
              <div className="theme-voice__section-heading">
                <strong className="workspace-card-section-title">主题与叙事调度</strong>
              </div>
              <div className="theme-voice__core-grid" data-theme-voice-core-fields="visible">
                <div className="theme-voice__field theme-voice__field--full">
                  <Form.Item
                    name="writingContractTags"
                    label="写作契约"
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
                <div className="theme-voice__field">
                  <Form.Item name="theme" label="主题" rules={[{ required: true, message: '请写清主题' }]}>
                    <Input.TextArea rows={4} placeholder="写作品持续回答的命题，不要写成宣传口号。" />
                  </Form.Item>
                </div>
                <div className="theme-voice__field">
                  <Form.Item name="emotionalCore" label="情感核心" rules={[{ required: true, message: '请写清情感核心' }]}>
                    <Input.TextArea rows={4} placeholder="写读者最稳定收到的情绪回报和压强。" />
                  </Form.Item>
                </div>
                <div className="theme-voice__field theme-voice__field--compact">
                  <Form.Item name="pov" label="叙事视角" rules={[{ required: true, message: '请选择叙事视角' }]}>
                    <Select options={POV_OPTIONS} placeholder="选择视角" />
                  </Form.Item>
                </div>
                <div className="theme-voice__field theme-voice__field--compact">
                  <Form.Item name="tense" label="时态" rules={[{ required: true, message: '请选择时态' }]}>
                    <Select options={TENSE_OPTIONS} placeholder="选择时态" />
                  </Form.Item>
                </div>
              </div>
              <details className="theme-voice__disclosure" data-theme-voice-disclosure="narrative-advanced">
                <summary>
                  <span>叙事调度与母题</span>
                  <span>{compactText(currentValues.themeChapterTest || currentValues.motifs || currentValues.narratorDistance, 68)}</span>
                  <b>查看详情</b>
                </summary>
                <div className="theme-voice__advanced-grid">
                  <div className="theme-voice__field">
                    <Form.Item name="themeChapterTest" label="章节级主题验证">
                      <Input.TextArea rows={4} placeholder="写每章冲突如何回应主题命题：选择、底线、代价或妥协必须如何落到现场。" />
                    </Form.Item>
                  </div>
                  <div className="theme-voice__field">
                    <Form.Item name="motifs" label="母题 / 重复意象">
                      <Input.TextArea rows={4} placeholder="写会反复出现的母题、意象和回响，建议每行一条。" />
                    </Form.Item>
                  </div>
                  <div className="theme-voice__field theme-voice__field--compact"><Form.Item name="protagonistCount" label="主角格局"><Select options={PROTAGONIST_COUNT_OPTIONS} placeholder="选择主角格局" allowClear /></Form.Item></div>
                  <div className="theme-voice__field theme-voice__field--compact"><Form.Item name="viewpointMode" label="视角调度"><Select options={VIEWPOINT_MODE_OPTIONS} placeholder="选择视角调度" allowClear /></Form.Item></div>
                  <div className="theme-voice__field theme-voice__field--compact"><Form.Item name="parallelTimelines" label="叙事线密度"><Select options={PARALLEL_TIMELINES_OPTIONS} placeholder="选择叙事线密度" allowClear /></Form.Item></div>
                  <div className="theme-voice__field theme-voice__field--compact"><Form.Item name="openingStyle" label="开篇方式"><Select options={OPENING_STYLE_OPTIONS} placeholder="选择开篇方式" allowClear /></Form.Item></div>
                  <div className="theme-voice__field theme-voice__field--compact"><Form.Item name="flashbackPolicy" label="插叙策略"><Select options={FLASHBACK_POLICY_OPTIONS} placeholder="选择插叙策略" allowClear /></Form.Item></div>
                  <div className="theme-voice__field"><Form.Item name="narratorDistance" label="叙述距离"><Input.TextArea rows={4} placeholder="写叙述者与人物之间的距离，以及解释密度。" /></Form.Item></div>
                  <div className="theme-voice__field theme-voice__field--full"><Form.Item name="voiceKeywords" label="口吻关键词"><Input.TextArea rows={3} placeholder="建议 4-8 个词，每行一条，描述整体口吻而非营销词。" /></Form.Item></div>
                </div>
              </details>
            </div>

            <div className="workspace-stack-10 novel-theme-voice-page__section novel-theme-voice-page__section--style">
              <div className="theme-voice__section-heading">
                <strong className="workspace-card-section-title">文风执行规则</strong>
              </div>
              <div className="theme-voice__core-grid theme-voice__core-grid--rules">
                <div className="theme-voice__field">
                  <Form.Item name="styleRules" label="风格规则" rules={[{ required: true, message: '请补充风格规则' }]}>
                    <Input.TextArea rows={4} placeholder="把句式、节奏和信息暴露方式写成规则，建议每行一条。" />
                  </Form.Item>
                </div>
                <div className="theme-voice__field">
                  <Form.Item name="dialogueRules" label="对白规则" rules={[{ required: true, message: '请补充对白规则' }]}>
                    <Input.TextArea rows={4} placeholder="写潜台词密度、句长控制、留白方式和人物区分度。" />
                  </Form.Item>
                </div>
              </div>
              <details className="theme-voice__disclosure" data-theme-voice-disclosure="style-advanced">
                <summary>
                  <span>描写、禁用表达与样本锁定</span>
                  <span>{compactText(currentValues.descriptionRules || currentValues.forbiddenPhrases || currentValues.targetWorkSampleGuide, 68)}</span>
                  <b>查看详情</b>
                </summary>
                <div className="theme-voice__advanced-grid">
                  <div className="theme-voice__field"><Form.Item name="descriptionRules" label="描写规则"><Input.TextArea rows={4} placeholder="写场景、动作、心理描写的比例和取舍。" /></Form.Item></div>
                  <div className="theme-voice__field"><Form.Item name="forbiddenPhrases" label="禁用表达"><Input.TextArea rows={4} placeholder="写应避免的总结腔、模板句、空泛抒情和引号强调。" /></Form.Item></div>
                  <div className="theme-voice__field"><Form.Item name="targetWorkSampleGuide" label="真实样章对照"><Input.TextArea rows={4} placeholder="写像不像目标作品时要核对的节奏、句式、对白比例、信息密度和现场质感。" /></Form.Item></div>
                  <div className="theme-voice__field"><Form.Item name="humanStyleSampleLock" label="人工风格样本锁定"><Input.TextArea rows={4} placeholder="写人工样本必须保留的特征，以及哪些 AI 化偏移一出现就退回重写。" /></Form.Item></div>
                </div>
              </details>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <section className="theme-voice__lab-handoff">
        <Button type="link" icon={<ExperimentOutlined />} onClick={() => navigateWithUnsavedGuard('style-lab')}>文风实验室</Button>
      </section>

      <Modal
        title="AI 辅助"
        open={aiAssistOpen}
        width={520}
        onCancel={() => setAiAssistOpen(false)}
        onOk={() => void handleAIAssistGenerate()}
        okText="开始处理"
        cancelText="取消"
        confirmLoading={Boolean(generatingMode)}
      >
        <div className="theme-voice__ai-dialog">
          <div className="theme-voice__ai-dialog-field">
            <span>目标区域</span>
            <Segmented
              block
              value={aiTarget}
              onChange={(value) => setAiTarget(value as ThemeVoiceGenerationTarget)}
              options={[
                { value: 'all', label: '全部主题与文风' },
                { value: 'narrative', label: '主题与叙事调度' },
                { value: 'style', label: '文风执行规则' },
              ]}
            />
          </div>
          <div className="theme-voice__ai-dialog-field">
            <span>处理方式</span>
            <Segmented
              block
              value={aiMode}
              onChange={(value) => setAiMode(value as ThemeVoiceGenerationMode)}
              options={[
                { value: 'fill_blanks', label: '只补空字段' },
                { value: 'replace', label: '生成首版并覆盖目标区' },
              ]}
            />
          </div>
          <p>结果先回填到当前表单，不会自动保存；其他区域保持不变。</p>
        </div>
      </Modal>

      <Modal
        title="应用文风模板"
        width={720}
        open={templateOpen}
        onCancel={() => setTemplateOpen(false)}
        okText="应用到当前表单"
        cancelText="取消"
        okButtonProps={{ disabled: !templateCandidateId }}
        onOk={handleApplyTemplate}
      >
        <div className="theme-voice__template-dialog" data-theme-template-mode={templateApplyMode}>
          <div className="theme-voice__template-mode">
            <span>应用方式</span>
            <Segmented
              value={templateApplyMode}
              onChange={(value) => setTemplateApplyMode(value as 'fill_blanks' | 'replace')}
              options={[
                { value: 'fill_blanks', label: '只补空字段' },
                { value: 'replace', label: '覆盖文风字段' },
              ]}
            />
          </div>
          <p className="theme-voice__template-note">
            {templateApplyMode === 'fill_blanks'
              ? '推荐：只填补模板能提供且当前为空的字段，不改动已经写好的内容。'
              : '仅覆盖模板明确提供的文风字段；主题、视角、写作契约等其他内容仍会保留。'}
          </p>
          <div className="theme-voice__template-list" role="radiogroup" aria-label="文风模板">
            {styleTemplates.map((template) => {
              const content = parseStyleTemplate(template)
              const active = template.id === templateCandidateId
              return (
                <button
                  key={template.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`theme-voice__template-row${active ? ' is-active' : ''}`}
                  onClick={() => setTemplateCandidateId(template.id)}
                >
                  <span className="theme-voice__template-copy">
                    <strong>{template.name}</strong>
                    <small>{template.description || '未填写模板说明'}</small>
                  </span>
                  <span className="theme-voice__template-preview">
                    {content.sentence_style || content.dialogue_style || content.example_tone || '模板内容待补充'}
                  </span>
                  <Tag color={template.isBuiltin === 1 ? 'gold' : 'blue'}>{template.isBuiltin === 1 ? '内置' : '自定义'}</Tag>
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    </WorkspacePage>
  )
}
