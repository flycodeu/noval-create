import React, { useEffect, useState, useCallback } from 'react'
import {
  Form, Input, InputNumber, Button, Collapse, Select, Slider, message, Row, Col,
  Popover, Radio, Badge, Alert, Tooltip, Modal
} from 'antd'
import {
  SaveOutlined, SettingOutlined, PlusOutlined, DeleteOutlined, RobotOutlined,
} from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'
import { useAIDraftStore } from '../../../stores/aiDraft.store'
import AIGenerateButton from '../../../components/AIGenerateButton'
import AIScorePanel from '../../../components/AIScorePanel'
import { parseSections } from '../../../utils/text'
import type { AIScoreResult, SubPlot } from '../../../types'
import type {
  CoreSettingsGenerationProgressEvent,
  CoreSettingsGenerationResult,
} from '../../../shared/core-settings-generation'
import {
  normalizeSubPlot,
  parseSubPlotFrameworkResponse,
  type PromptMessage,
} from '../../../shared/subplot-framework'
import { buildHumanLanguageRules } from '../../../shared/prompt-library'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceTip,
} from '../components/WorkspaceShell'
import { useWorkspaceStore } from '../../../stores/workspace.store'

interface Props { novelId: number }

// AdvancedAI 配置（页面级状态）
interface AIConfig {
  drawCount: 1 | 2 | 3
  requirements: string
}

const DEFAULT_SUBPLOT_BATCH_COUNT = 10
const MIN_SUBPLOT_BATCH_COUNT = 1
const MAX_SUBPLOT_BATCH_COUNT = 20
const SUBPLOT_GENERATION_CHUNK_SIZE = 3
const SUBPLOT_GENERATION_RETRY_LIMIT = 1
const SUBPLOT_SUMMARY_LIMIT = 8
const SUBPLOT_MAX_CONFLICT_LENGTH = 90
const SUBPLOT_MAX_MAINLINE_LINK_LENGTH = 60
const SUBPLOT_PROGRESS_MESSAGE_KEY = 'subplot-batch-generation'

type StoryFieldName = 'story_goal' | 'core_conflict' | 'main_plot' | 'ending'

interface SubplotGenerationProgress {
  completed: number
  currentBatch: number
  total: number
  totalBatches: number
}

type GeneratedApplyMode = 'draft' | 'save'

function clampSubplotBatchCount(value: unknown): number {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN

  if (!Number.isFinite(numericValue)) return DEFAULT_SUBPLOT_BATCH_COUNT
  return Math.min(MAX_SUBPLOT_BATCH_COUNT, Math.max(MIN_SUBPLOT_BATCH_COUNT, Math.round(numericValue)))
}

function getSubplotSummary(subplots: SubPlot[], limit = 3): string {
  return subplots
    .slice(0, limit)
    .map((sub, index) => {
      const parts = [sub.name, sub.conflict, sub.mainlineLink].filter(Boolean)
      return parts.length > 0 ? `${index + 1}. ${parts.join(' / ')}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function getFieldPromptGuidance(fieldName: StoryFieldName, label: string) {
  switch (fieldName) {
    case 'story_goal':
      return {
        label,
        duty: '只写故事最终要抵达的目标、终局状态或核心命题。',
        requirements: [
          '回答“这个故事最后要实现什么”，而不是“中间会发生什么”。',
          '可以带出主题方向，但要落在明确的终局追求或最终改变上。',
        ],
        avoid: [
          '不要展开事件流程、阶段任务或场景细节。',
          '不要把阻碍、敌人或困难写成目标本身。',
          '不要直接复述主线剧情或核心冲突。',
        ],
      }
    case 'core_conflict':
      return {
        label,
        duty: '只写阻碍目标实现的核心对立、不可回避的代价与矛盾张力。',
        requirements: [
          '回答“为什么这个目标难以实现”，而不是“最后想实现什么”。',
          '要明确对立双方、冲突来源或必须付出的代价。',
        ],
        avoid: [
          '不要写成终局目标、主题口号或人物愿望。',
          '不要用剧情流水账代替冲突本身。',
          '不要把主线概述换一种说法重复出来。',
        ],
      }
    case 'main_plot':
      return {
        label,
        duty: '只写围绕目标与冲突展开的关键事件链，强调因果推进、升级和转折。',
        requirements: [
          '回答“故事如何一步步推进到终局”，至少体现起点、升级、转折与逼近收束。',
          '主线必须显式承接故事核心目标与核心冲突，不能另起一套故事。',
        ],
        avoid: [
          '不要重新定义故事核心目标或核心冲突。',
          '不要只写抽象主题句、人物评价或世界观说明。',
          '不要只列场景，不写事件之间的因果关系。',
        ],
      }
    case 'ending':
      return {
        label,
        duty: '只写故事最终如何收束、主要矛盾如何落地以及结局余波。',
        requirements: [
          '结局要回应既定目标、冲突和主线推进结果。',
          '说明收束状态，而不是重新铺陈新的主线。',
        ],
        avoid: [
          '不要把未发生的中段情节写进结局字段。',
          '不要只写价值判断，不写结果落点。',
        ],
      }
  }
}

export default function CoreSettings({ novelId }: Props) {
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { saveDraft, clearByPrefix } = useAIDraftStore()
  const { mode } = useWorkspaceStore()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [subPlots, setSubPlots] = useState<SubPlot[]>([])
  const [aiConfig, setAIConfig] = useState<AIConfig>({ drawCount: 1, requirements: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [subplotGenerationProgress, setSubplotGenerationProgress] = useState<SubplotGenerationProgress | null>(null)
  const [isGeneratingCoreSettings, setIsGeneratingCoreSettings] = useState(false)
  const [coreSettingsProgress, setCoreSettingsProgress] = useState<CoreSettingsGenerationProgressEvent | null>(null)
  const [pendingGeneratedSettings, setPendingGeneratedSettings] = useState<CoreSettingsGenerationResult | null>(null)
  const [generatedApplyModalOpen, setGeneratedApplyModalOpen] = useState(false)
  const [applyingGeneratedMode, setApplyingGeneratedMode] = useState<GeneratedApplyMode | null>(null)
  const [isBackgroundExpanded, setIsBackgroundExpanded] = useState(false)

  // 检查是否有待填充的草稿
  const draftPrefix = `novel:${novelId}:coresettings`
  const hasDraft = useAIDraftStore(s => Object.keys(s.drafts).some(k => k.startsWith(draftPrefix)))

  const genreContext = currentNovel?.genreName || '未知题材'
  const novelBackground = currentNovel?.expandedBackground || currentNovel?.synopsis || ''
  const backgroundBasisText = novelBackground.trim() || '尚未补充背景，建议先写清世界处境'
  const canToggleBackgroundBasis = backgroundBasisText.length > 120
  const storyGoalValue = Form.useWatch('story_goal', form)
  const coreConflictValue = Form.useWatch('core_conflict', form)
  const mainPlotValue = Form.useWatch('main_plot', form)
  const endingValue = Form.useWatch('ending', form)
  const rhythmSetupValue = Form.useWatch('rhythm_setup', form)
  const rhythmConflictValue = Form.useWatch('rhythm_conflict', form)
  const rhythmEndingValue = Form.useWatch('rhythm_ending', form)

  useEffect(() => {
    if (currentNovel?.settingsJson) {
      try {
        const settings = JSON.parse(currentNovel.settingsJson)
        form.setFieldsValue({
          subplot_batch_count: DEFAULT_SUBPLOT_BATCH_COUNT,
          ...settings,
        })
        setSubPlots(Array.isArray(settings.sub_plots_list)
          ? settings.sub_plots_list.map(normalizeSubPlot).filter((subplot: SubPlot | null): subplot is SubPlot => Boolean(subplot))
          : [])
      } catch {
        form.setFieldsValue({ subplot_batch_count: DEFAULT_SUBPLOT_BATCH_COUNT })
        setSubPlots([])
      }
    } else {
      form.setFieldsValue({ subplot_batch_count: DEFAULT_SUBPLOT_BATCH_COUNT })
      setSubPlots([])
    }
  }, [currentNovel, form])

  useEffect(() => {
    setIsBackgroundExpanded(false)
  }, [backgroundBasisText, novelId])

  const protagonistReference = '主角'
  const protagonistRule = '在核心设定与支线设定中，凡涉及主角，一律只使用「主角」指代；禁止出现任何具体姓名、旧名字、化名或代号；若输入中已有姓名，也必须在输出中统一改写为「主角」。'
  const isGeneratingSubplots = Boolean(subplotGenerationProgress)
  const isAnyAIActionRunning = isGeneratingSubplots || isGeneratingCoreSettings

  useEffect(() => {
    const unsubscribe = window.electron.on('ai:core-settings-progress', (...args) => {
      const payload = args[0] as CoreSettingsGenerationProgressEvent | undefined
      if (!payload || payload.novelId !== novelId) return
      setCoreSettingsProgress(payload)
    })

    return unsubscribe
  }, [novelId])

  const buildRelatedSettingsContext = useCallback((fieldName?: string) => {
    const values = form.getFieldsValue(['story_goal', 'core_conflict', 'main_plot', 'ending'])
    const relatedLines = [
      fieldName !== 'story_goal' && values.story_goal ? `【故事核心目标】${values.story_goal}` : '',
      fieldName !== 'core_conflict' && values.core_conflict ? `【核心冲突】${values.core_conflict}` : '',
      fieldName !== 'main_plot' && values.main_plot ? `【主线剧情】${values.main_plot}` : '',
      fieldName !== 'ending' && values.ending ? `【结局方向】${values.ending}` : '',
    ].filter(Boolean)

    if (subPlots.length > 0) {
      const subplotSummary = getSubplotSummary(subPlots)

      if (subplotSummary) {
        relatedLines.push(`【支线摘要】\n${subplotSummary}`)
      }
    }

    return relatedLines.join('\n')
  }, [form, subPlots])

  const buildOptimizationMessages = useCallback((
    fieldName: StoryFieldName,
    label: string,
    content: string,
    result: AIScoreResult,
    extraReqs: string,
  ) => {
    const guidance = getFieldPromptGuidance(fieldName, label)
    const sorted = [...result.dimensions].sort((a, b) => a.score - b.score)
    const dimSuggestions = sorted.slice(0, 3)
      .filter(d => d.suggestion)
      .map(d => `${d.name}（当前${d.score}分）：${d.suggestion}`)
      .join('\n')
    const topFixes = result.top_fixes.map((fix, index) => `${index + 1}. ${fix}`).join('\n')
    const relatedContext = buildRelatedSettingsContext(fieldName)

    return [{
      role: 'user' as const,
      content: `你是专业的中文小说策划师，请根据 AI 评分反馈，优化【${label}】。
【字段职责】${guidance.duty}
【当前内容】${content}
【小说背景】${novelBackground || '（暂无补充背景）'}
【题材】${genreContext}
【当前主角指代】${protagonistReference}
【主角称谓规则】${protagonistRule}
${relatedContext ? `【已确定的关联设定】\n${relatedContext}\n` : ''}【优先修复问题】${topFixes}
【重点改进方向】${dimSuggestions || '请优先修正最弱维度，并补足具体细节。'}
${extraReqs ? `【追加要求】${extraReqs}` : ''}
【语言要求】
${buildHumanLanguageRules([
  '重点修复主谓宾搭配错误、对象类别错配和抽象概念堆砌。',
  '如果出现“电网的死亡”这类表达，必须改成“电网瘫痪”“电力系统崩溃”等准确说法。',
])}

优化要求：
- ${guidance.requirements.join('\n- ')}
- 只能在当前背景、题材和已确定设定上润色，禁止改写成另一套故事
- 若上下文中出现旧名字、占位名或彼此冲突的人名，统一按主角称谓规则处理
- 与其他字段的人物关系、事件因果、情绪走向保持一致，不得自相矛盾
- 禁止事项：
- ${guidance.avoid.join('\n- ')}
- 直接输出优化后的纯文本内容，不要解释，不要使用 Markdown。`,
    }]
  }, [buildRelatedSettingsContext, genreContext, novelBackground, protagonistReference, protagonistRule])

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue(true)
      const data = { ...values, sub_plots_list: subPlots }
      await window.electron.novel.update(novelId, { settingsJson: JSON.stringify(data) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      clearByPrefix(draftPrefix)
      message.success('已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // AI扩展通用处理：填入字段并保存草稿
  const applyAndSaveDraft = (fieldName: string, value: string, label: string) => {
    form.setFieldValue(fieldName, value)
    saveDraft(`${draftPrefix}:${fieldName}`, value, label)
  }

  const hasSuccessfulGeneratedStep = useCallback((
    result: CoreSettingsGenerationResult,
    key: CoreSettingsGenerationResult['steps'][number]['key'],
  ) => {
    return result.steps.some((step) => step.key === key && (step.status === 'success' || step.status === 'warning'))
  }, [])

  const applyGeneratedSettingsToForm = useCallback((result: CoreSettingsGenerationResult, saveAsDraft: boolean) => {
    const normalizedSubplots = result.sub_plots_list
      .map(normalizeSubPlot)
      .filter((subplot): subplot is SubPlot => Boolean(subplot))
    const nextValues: Record<string, unknown> = {}

    if (hasSuccessfulGeneratedStep(result, 'story_goal') && result.story_goal.trim()) {
      nextValues.story_goal = result.story_goal
    }
    if (hasSuccessfulGeneratedStep(result, 'core_conflict') && result.core_conflict.trim()) {
      nextValues.core_conflict = result.core_conflict
    }
    if (hasSuccessfulGeneratedStep(result, 'main_plot') && result.main_plot.trim()) {
      nextValues.main_plot = result.main_plot
    }
    if (hasSuccessfulGeneratedStep(result, 'rhythm')) {
      nextValues.rhythm_setup = result.rhythm_setup
      nextValues.rhythm_conflict = result.rhythm_conflict
      nextValues.rhythm_ending = result.rhythm_ending
    }
    if (hasSuccessfulGeneratedStep(result, 'ending') && result.ending.trim()) {
      nextValues.ending_type = result.ending_type
      nextValues.ending = result.ending
    }

    if (Object.keys(nextValues).length > 0) {
      form.setFieldsValue(nextValues)
    }
    if (hasSuccessfulGeneratedStep(result, 'sub_plots_list')) {
      setSubPlots(normalizedSubplots)
    }

    if (!saveAsDraft) return

    if (hasSuccessfulGeneratedStep(result, 'story_goal') && result.story_goal.trim()) {
      saveDraft(`${draftPrefix}:story_goal`, result.story_goal, '故事核心目标（一键生成）')
    }
    if (hasSuccessfulGeneratedStep(result, 'core_conflict') && result.core_conflict.trim()) {
      saveDraft(`${draftPrefix}:core_conflict`, result.core_conflict, '核心冲突（一键生成）')
    }
    if (hasSuccessfulGeneratedStep(result, 'main_plot') && result.main_plot.trim()) {
      saveDraft(`${draftPrefix}:main_plot`, result.main_plot, '主线剧情（一键生成）')
    }
    if (hasSuccessfulGeneratedStep(result, 'sub_plots_list')) {
      saveDraft(`${draftPrefix}:sub_plots_list`, JSON.stringify(normalizedSubplots, null, 2), '支线剧情（一键生成）')
    }
    if (hasSuccessfulGeneratedStep(result, 'rhythm')) {
      saveDraft(
        `${draftPrefix}:rhythm`,
        `前期铺垫 ${result.rhythm_setup}% / 中期冲突 ${result.rhythm_conflict}% / 后期收束 ${result.rhythm_ending}%`,
        '叙事节奏（一键生成）',
      )
    }
    if (hasSuccessfulGeneratedStep(result, 'ending') && result.ending.trim()) {
      saveDraft(`${draftPrefix}:ending`, result.ending, '结局设定（一键生成）')
    }
  }, [draftPrefix, form, hasSuccessfulGeneratedStep, saveDraft])

  const persistGeneratedSettings = useCallback(async (result: CoreSettingsGenerationResult) => {
    const values = form.getFieldsValue(true)
    const normalizedSubplots = result.sub_plots_list
      .map(normalizeSubPlot)
      .filter((subplot): subplot is SubPlot => Boolean(subplot))
    const data = {
      ...values,
    }

    if (hasSuccessfulGeneratedStep(result, 'story_goal') && result.story_goal.trim()) {
      data.story_goal = result.story_goal
    }
    if (hasSuccessfulGeneratedStep(result, 'core_conflict') && result.core_conflict.trim()) {
      data.core_conflict = result.core_conflict
    }
    if (hasSuccessfulGeneratedStep(result, 'main_plot') && result.main_plot.trim()) {
      data.main_plot = result.main_plot
    }
    if (hasSuccessfulGeneratedStep(result, 'sub_plots_list')) {
      data.sub_plots_list = normalizedSubplots
    }
    if (hasSuccessfulGeneratedStep(result, 'rhythm')) {
      data.rhythm_setup = result.rhythm_setup
      data.rhythm_conflict = result.rhythm_conflict
      data.rhythm_ending = result.rhythm_ending
    }
    if (hasSuccessfulGeneratedStep(result, 'ending') && result.ending.trim()) {
      data.ending_type = result.ending_type
      data.ending = result.ending
    }

    setSaving(true)
    try {
      await window.electron.novel.update(novelId, { settingsJson: JSON.stringify(data) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      form.setFieldsValue(data)
      if (hasSuccessfulGeneratedStep(result, 'sub_plots_list')) {
        setSubPlots(normalizedSubplots)
      }
      clearByPrefix(draftPrefix)
      message.success('核心设定已生成并保存')
      return true
    } catch {
      message.error('核心设定保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }, [clearByPrefix, draftPrefix, form, hasSuccessfulGeneratedStep, novelId, setCurrentNovel])

  const handleApplyGeneratedSettings = useCallback(async (mode: GeneratedApplyMode) => {
    if (!pendingGeneratedSettings) return

    setApplyingGeneratedMode(mode)
    try {
      if (mode === 'draft') {
        applyGeneratedSettingsToForm(pendingGeneratedSettings, true)
        message.success('一键生成结果已填入表单，请确认后保存')
      } else {
        const saved = await persistGeneratedSettings(pendingGeneratedSettings)
        if (!saved) return
      }

      setGeneratedApplyModalOpen(false)
      setPendingGeneratedSettings(null)
      setCoreSettingsProgress(null)
    } finally {
      setApplyingGeneratedMode(null)
    }
  }, [applyGeneratedSettingsToForm, pendingGeneratedSettings, persistGeneratedSettings])

  const getSubplotBatchCount = useCallback(() => {
    return clampSubplotBatchCount(form.getFieldValue('subplot_batch_count'))
  }, [form])

  const handleGenerateCoreSettings = useCallback(async () => {
    if (isAnyAIActionRunning) return

    setIsGeneratingCoreSettings(true)
    setCoreSettingsProgress(null)
    setPendingGeneratedSettings(null)
    setGeneratedApplyModalOpen(false)

    try {
      const result = await window.electron.ai.generateCoreSettings({
        novelId,
        subplotCount: getSubplotBatchCount(),
        requirements: aiConfig.requirements,
      })

      if (result.failedSteps > 0) {
        const failedDetails = result.steps
          .filter((step) => step.status === 'failed')
          .map((step) => `${step.label}${step.error ? `：${step.error}` : ''}`)
          .join('；')
        setCoreSettingsProgress({
          novelId,
          step: 'ending',
          label: '部分步骤需要处理',
          status: 'failed',
          completed: result.completedSteps,
          total: result.steps.length,
          warning: failedDetails,
        })
      }

      if (result.hasPartialResult) {
        setPendingGeneratedSettings(result)
        setGeneratedApplyModalOpen(true)
      }

      if (result.failedSteps > 0 && result.hasPartialResult) {
        message.warning('一键生成已完成，但部分步骤失败，可先应用已生成内容')
      } else if (result.warnings.length > 0) {
        message.warning('核心设定已生成，部分内容带有提示，应用前建议检查')
      } else if (result.hasPartialResult) {
        message.success('核心设定一键生成完成')
      } else {
        message.error('一键生成未产生可应用内容，请调整要求后重试')
      }
    } catch (error) {
      message.error(`一键生成失败：${error instanceof Error ? error.message : '请先配置 AI 模型'}`)
    } finally {
      setIsGeneratingCoreSettings(false)
    }
  }, [aiConfig.requirements, getSubplotBatchCount, isAnyAIActionRunning, novelId])

  const addSubPlot = () => {
    setSubPlots(prev => [...prev, { name: '', characters: '', conflict: '', mainlineLink: '', endChapter: '' }])
  }

  const updateSubPlot = (index: number, field: keyof SubPlot, value: string) => {
    setSubPlots(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const removeSubPlot = (index: number) => {
    setSubPlots(prev => prev.filter((_, i) => i !== index))
  }

  const applySubplotFramework = useCallback((index: number, subplot: SubPlot) => {
    setSubPlots(prev => prev.map((item, i) => i === index ? subplot : item))
  }, [])

  const applySingleSubplotFromResponse = useCallback((index: number, raw: string) => {
    const [subplot] = parseSubPlotFrameworkResponse(raw)
    if (!subplot) {
      throw new Error('empty')
    }
    applySubplotFramework(index, subplot)
    return subplot
  }, [applySubplotFramework])

  const buildContextAwareExpandMessages = useCallback((fieldName: StoryFieldName, label: string) => {
    const guidance = getFieldPromptGuidance(fieldName, label)
    const current = form.getFieldValue(fieldName) || ''
    const relatedContext = buildRelatedSettingsContext(fieldName)
    const prompt = `你是专业的中文小说策划师。请围绕【${label}】进行专业扩充和润色。
【字段职责】${guidance.duty}
【小说背景】${novelBackground || '（暂无补充背景）'}
【题材】${genreContext}
【当前主角指代】${protagonistReference}
【主角称谓规则】${protagonistRule}
${relatedContext ? `【已确定的关联设定】\n${relatedContext}\n` : ''}【当前字段内容】${current || '（暂无，请根据背景和已确定设定生成合适内容）'}
${aiConfig.requirements ? `【额外要求】${aiConfig.requirements}` : ''}
【语言要求】
${buildHumanLanguageRules([
  '输出前自行检查搭配是否准确，不要保留物体被写成人或生物的表达。',
  '优先采用常规小说语言，不写概念口号和硬凹文学腔。',
])}

扩充原则：
- ${guidance.requirements.join('\n- ')}
- 只允许在当前背景、题材和已确定设定上深化，禁止改写成另一套故事
- 若上下文中出现旧名字、占位名或彼此冲突的人名，统一按主角称谓规则处理
- 与其他字段中的人物关系、事件因果、核心矛盾保持前后一致，不得漂移
- 保留原有思路，在其基础上补足动机、推进关系和关键细节
- 语言简洁有力，避免空话和套路化描述
- 禁止事项：
- ${guidance.avoid.join('\n- ')}

输出格式：
- 直接输出润色后的纯文本内容，不要解释
- 不要使用 Markdown、标题、列表或字段标签
- 段落之间可以空一行`

    return [{ role: 'user' as const, content: prompt }]
  }, [aiConfig.requirements, buildRelatedSettingsContext, form, genreContext, novelBackground, protagonistReference, protagonistRule])

  const buildContextAwareSubplotMessages = useCallback((index: number, optimization?: {
    topFixes: string
    dimSuggestions: string
    extraReqs: string
  }) => {
    const sub = subPlots[index]
    const mainPlot = form.getFieldValue('main_plot') || ''
    const relatedContext = buildRelatedSettingsContext('sub_plots_list')
    const prompt = `请根据最新上下文，刷新这一条支线剧情框架。
【小说背景】${novelBackground || '（暂无补充背景）'}
【题材】${genreContext}
【当前主角指代】${protagonistReference}
【主角称谓规则】${protagonistRule}
${relatedContext ? `【已确定的关联设定】\n${relatedContext}\n` : ''}【主线剧情】${mainPlot || '（暂未填写）'}
【当前支线基础信息】
- 名称：${sub?.name || '（未命名）'}
- 涉及人物：${sub?.characters || '（暂未填写）'}
- 核心冲突：${sub?.conflict || '（暂未填写）'}
- 与主线关联：${sub?.mainlineLink || '（暂未填写）'}
- 预计收束章节：第${sub?.endChapter || 'X'}章
${aiConfig.requirements ? `【额外要求】${aiConfig.requirements}
` : ''}${optimization ? `【评分问题】${optimization.topFixes}
【改进方向】${optimization.dimSuggestions || '请优先修正评分最低的维度。'}
${optimization.extraReqs ? `【追加要求】${optimization.extraReqs}` : ''}` : ''}
【语言要求】
${buildHumanLanguageRules([
  'conflict 和 mainlineLink 必须是常规中文句子，不要写成抽象标签。',
  '若存在搭配错误或表达生硬，优先改成最常见、最准确的说法。',
])}

刷新要求：
- 支线必须与主题核心、故事核心目标、核心冲突或主线推进形成明确关联，不能是独立小故事
- 这条支线至少承担以下一种作用：推进主线、揭示主题或世界真相、推动人物成长或关系变化、制造阶段性反转
- 若旧版本与最新上下文冲突，优先按最新上下文重写；若旧版本仍有效，可以保留其核心方向
- 若涉及主角，characters 字段中只能写「${protagonistReference}」
- characters 只写人物称谓，用逗号分隔
- conflict 要写成完整、具体的支线核心冲突，不能只写抽象关键词
- mainlineLink 要写清这条支线如何推动主线、人物或主题，不能写空泛口号
- endChapter 输出数字
- 只输出 JSON 对象，不要解释，不要使用 Markdown：
{"name":"支线名称","characters":"涉及人物1,涉及人物2","conflict":"支线核心冲突","mainlineLink":"与主线或主题的具体关联方式","endChapter":15}`

    return [{ role: 'user' as const, content: prompt }]
  }, [aiConfig.requirements, buildRelatedSettingsContext, form, genreContext, novelBackground, protagonistReference, protagonistRule, subPlots])

  const buildSubplotFrameworkMessages = useCallback((batchCount: number, existingSubplots: SubPlot[], batchIndex: number, totalBatches: number) => {
    const mainPlot = form.getFieldValue('main_plot') || ''
    const relatedContext = buildRelatedSettingsContext('sub_plots_list')
    const existingSummary = getSubplotSummary(existingSubplots, SUBPLOT_SUMMARY_LIMIT)
    const prompt = `请为小说分批生成新的支线剧情框架，本次只生成 ${batchCount} 条。
【小说背景】${novelBackground || '（暂无补充背景）'}
【题材】${genreContext}
【当前主角指代】${protagonistReference}
【主角称谓规则】${protagonistRule}
${relatedContext ? `【已确定的关联设定】\n${relatedContext}\n` : ''}【主线剧情】${mainPlot || '（暂未填写）'}
【生成进度】第 ${batchIndex} / ${totalBatches} 批
【当前已有支线数量】${existingSubplots.length}
${existingSummary ? `【当前已有支线摘要】\n${existingSummary}\n` : ''}【本批生成数量】${batchCount}
${aiConfig.requirements ? `【额外要求】${aiConfig.requirements}` : ''}
【语言要求】
${buildHumanLanguageRules([
  '每条支线都要写得准确、直接，不能为了显得高级而写不自然的句子。',
  '重点避免冲突描述和主线关联中的对象类别错配。',
])}

生成要求：
- 本次只生成 ${batchCount} 条不同支线，输出 JSON array，数组长度必须等于 ${batchCount}
- 每条支线都必须与主题核心、故事核心目标、核心冲突或主线推进形成明确因果关联
- 从整轮已生成支线来看，要尽量覆盖不同功能；若当前类型单一，本批优先补足推进主线、揭示世界或主题、推动人物成长、放大人物关系、制造反转或伏笔回收等未覆盖方向
- 不要与当前已有支线在名称、核心冲突或主线作用上重复
- 若涉及主角，characters 字段中只能写「${protagonistReference}」，禁止发明新名字
- 每条 conflict 必须压缩成 1-2 句核心冲突摘要，控制在 ${SUBPLOT_MAX_CONFLICT_LENGTH} 字以内，禁止扩写成长段情节
- 每条 mainlineLink 控制在 ${SUBPLOT_MAX_MAINLINE_LINK_LENGTH} 字以内，只写它如何推动主线、人物或主题
- endChapter 输出数字
- 输出 JSON array，且只输出 JSON：
[
  {"name":"支线名称","characters":"涉及人物1,涉及人物2","conflict":"支线核心冲突","mainlineLink":"与主线或主题的具体关联方式","endChapter":15}
]`

    return [{ role: 'user' as const, content: prompt }]
  }, [aiConfig.requirements, buildRelatedSettingsContext, form, genreContext, novelBackground, protagonistReference, protagonistRule])

  const generateSubplotBatch = useCallback(async (
    messages: PromptMessage[],
    batchCount: number,
    existingSubplots: SubPlot[],
    batchIndex: number,
    totalBatches: number,
  ) => {
    let lastError: unknown

    for (let attempt = 0; attempt <= SUBPLOT_GENERATION_RETRY_LIMIT; attempt += 1) {
      try {
        return await window.electron.ai.generateSubplotBatch({
          novelId,
          messages,
          expectedCount: batchCount,
          existingSubplots,
          modelConfigId: currentNovel?.modelConfigId,
          batchIndex,
          totalBatches,
        })
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('支线生成失败')
  }, [currentNovel?.modelConfigId, novelId])

  const runSubplotRefreshDraws = useCallback(async (
    index: number,
    messages: PromptMessage[],
    count: number,
  ) => {
    const outputs: string[] = []
    let warningCount = 0
    let existingPool = subPlots.filter((_, subplotIndex) => subplotIndex !== index)

    for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
      const result = await generateSubplotBatch(
        messages,
        1,
        existingPool,
        drawIndex + 1,
        count,
      )

      const subplot = result.accepted[0]
      if (!subplot) {
        throw new Error('AI 未返回可保留的支线结果')
      }

      outputs.push(JSON.stringify(subplot))
      existingPool = [...existingPool, subplot]
      if (result.warningMessage) {
        warningCount += 1
      }
    }

    if (warningCount > 0) {
      message.warning(`支线结果已部分放宽保留，详情见任务中心`)
    }

    return outputs
  }, [generateSubplotBatch, subPlots])

  const handleBatchGenerateSubplots = useCallback(async () => {
    if (isGeneratingSubplots || isGeneratingCoreSettings) return

    const totalToGenerate = getSubplotBatchCount()
    const totalBatches = Math.ceil(totalToGenerate / SUBPLOT_GENERATION_CHUNK_SIZE)
    let generatedCount = 0
    let failedBatch = 1
    let accumulatedSubplots = [...subPlots]
    let partialBatchCount = 0

    setSubplotGenerationProgress({
      completed: 0,
      currentBatch: 1,
      total: totalToGenerate,
      totalBatches,
    })

    message.open({
      key: SUBPLOT_PROGRESS_MESSAGE_KEY,
      type: 'loading',
      duration: 0,
      content: `正在生成支线：第 1/${totalBatches} 批，已生成 0/${totalToGenerate} 条`,
    })

    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        const batchCount = Math.min(SUBPLOT_GENERATION_CHUNK_SIZE, totalToGenerate - generatedCount)
        const currentBatch = batchIndex + 1
        failedBatch = currentBatch

        setSubplotGenerationProgress({
          completed: generatedCount,
          currentBatch,
          total: totalToGenerate,
          totalBatches,
        })
        message.open({
          key: SUBPLOT_PROGRESS_MESSAGE_KEY,
          type: 'loading',
          duration: 0,
          content: `正在生成支线：第 ${currentBatch}/${totalBatches} 批，已生成 ${generatedCount}/${totalToGenerate} 条`,
        })

        const batchResult = await generateSubplotBatch(
          buildSubplotFrameworkMessages(batchCount, accumulatedSubplots, currentBatch, totalBatches),
          batchCount,
          accumulatedSubplots,
          currentBatch,
          totalBatches,
        )
        accumulatedSubplots = [...accumulatedSubplots, ...batchResult.accepted]
        generatedCount += batchResult.accepted.length
        if (batchResult.warningMessage) {
          partialBatchCount += 1
        }
        setSubPlots(accumulatedSubplots)
        setSubplotGenerationProgress({
          completed: generatedCount,
          currentBatch,
          total: totalToGenerate,
          totalBatches,
        })
      }

      message.open({
        key: SUBPLOT_PROGRESS_MESSAGE_KEY,
        type: partialBatchCount > 0 || generatedCount < totalToGenerate ? 'warning' : 'success',
        duration: 3,
        content: partialBatchCount > 0 || generatedCount < totalToGenerate
          ? `已保留 ${generatedCount}/${totalToGenerate} 条支线框架，部分批次有校验拒绝，详情见任务中心`
          : `已分批生成 ${generatedCount} 条支线框架`,
      })
    } catch (error) {
      message.open({
        key: SUBPLOT_PROGRESS_MESSAGE_KEY,
        type: generatedCount > 0 ? 'warning' : 'error',
        duration: 3,
        content: generatedCount > 0
          ? `支线生成在第 ${failedBatch}/${totalBatches} 批中断，已保留前面生成的 ${generatedCount}/${totalToGenerate} 条，详情见任务中心`
          : `支线生成失败：${error instanceof Error ? error.message : '请重试'}`,
      })
    } finally {
      setSubplotGenerationProgress(null)
    }
  }, [buildSubplotFrameworkMessages, generateSubplotBatch, getSubplotBatchCount, isGeneratingCoreSettings, isGeneratingSubplots, subPlots])

  const buildStoryCoreOptimizationMessages = useCallback((
    content: string,
    result: AIScoreResult,
    extraReqs: string,
  ) => {
    const sorted = [...result.dimensions].sort((a, b) => a.score - b.score)
    const dimSuggestions = sorted.slice(0, 3)
      .filter(d => d.suggestion)
      .map(d => `${d.name}（当前${d.score}分）：${d.suggestion}`)
      .join('\n')
    const topFixes = result.top_fixes.map((fix, index) => `${index + 1}. ${fix}`).join('\n')
    const relatedContext = buildRelatedSettingsContext()

    return [{
      role: 'user' as const,
      content: `请根据 AI 评分反馈，分别优化「故事核心目标」和「核心冲突」两个字段。
【当前内容】${content}
【小说背景】${novelBackground || '（暂无补充背景）'}
【题材】${genreContext}
【当前主角指代】${protagonistReference}
【主角称谓规则】${protagonistRule}
${relatedContext ? `【已确定的关联设定】\n${relatedContext}\n` : ''}【评分问题】${topFixes}
【改进方向】${dimSuggestions || '请优先修正评分最低的维度，并补足具体细节。'}
${extraReqs ? `【追加要求】${extraReqs}` : ''}
【语言要求】
${buildHumanLanguageRules([
  '重点修正目标和冲突里的语义重复、搭配错误和抽象化表达。',
  '两个字段都要能被普通读者直接读懂，不要写成策划黑话。',
])}

优化要求：
- 「故事核心目标」只回答故事最终要抵达什么状态、目标或命题，不写过程和阻碍
- 「核心冲突」只回答阻止目标实现的核心对立、代价与张力，不写完整剧情流程
- 两个字段内容都要独立完整，但必须属于同一套故事设定，且不能互相改写成近义句
- 若出现旧名字、占位名或彼此冲突的人名，统一按主角称谓规则处理
- 不要使用 Markdown
- 严格按以下格式输出：
【故事核心目标】此处输出优化后的故事核心目标
【核心冲突】此处输出优化后的核心冲突`,
    }]
  }, [buildRelatedSettingsContext, genreContext, novelBackground, protagonistReference, protagonistRule])

  // 高级设置 Popover 内容
  const advancedSettingsContent = (
    <div className="novel-core-settings__popover">
      <div className="novel-core-settings__popover-section">
        <div className="novel-core-settings__popover-label">
          抽卡次数（生成 N 个版本供选择）
        </div>
        <Radio.Group
          value={aiConfig.drawCount}
          onChange={e => setAIConfig(c => ({ ...c, drawCount: e.target.value }))}
          size="small"
        >
          <Radio.Button value={1}>1 次</Radio.Button>
          <Radio.Button value={2}>2 次</Radio.Button>
          <Radio.Button value={3}>3 次</Radio.Button>
        </Radio.Group>
      </div>
      <div>
        <div className="novel-core-settings__popover-label">
          全局生成要求（可选）
        </div>
        <Input.TextArea
          className="novel-core-settings__popover-textarea"
          value={aiConfig.requirements}
          onChange={e => setAIConfig(c => ({ ...c, requirements: e.target.value }))}
          placeholder="例如：风格更黑暗、避免主角开挂、增加反转..."
          rows={3}
        />
        <div className="novel-core-settings__popover-help">
          整页一键生成会沿用这里的全局要求；抽卡次数仅作用于单字段生成和评分重生成。
        </div>
      </div>
    </div>
  )

  const collapseItems = [
    {
      key: 'core',
      label: (
        <div className="novel-core-settings__section-head">
          <span className="novel-core-settings__section-title">故事核心</span>
          <span className="novel-core-settings__section-meta">
            目标 / 冲突 / 主线职责分离
          </span>
        </div>
      ),
      children: (
        <>
          <div className="novel-core-settings__section-description">
            故事核心目标回答“最后要达成什么”，核心冲突回答“为什么难以达成”，主线概述回答“故事如何一步步推进”。
          </div>
          <Form.Item
            name="story_goal"
            extra="只写故事最终要达成的目标、终局状态或核心命题，不写过程。"
            label={
              <span className="novel-core-settings__field-label">
                故事核心目标
                <AIGenerateButton
                  label="AI"
                  size="small"
                  type="text"
                  buildMessages={() => buildContextAwareExpandMessages('story_goal', '故事核心目标')}
                  drawCount={aiConfig.drawCount}
                  disabled={isAnyAIActionRunning}
                  onResult={v => applyAndSaveDraft('story_goal', v, '故事核心目标')}
                />
              </span>
            }
          >
            <Input.TextArea rows={5} placeholder="只写故事最终要抵达的目标、终局状态或核心命题" />
          </Form.Item>
          <Form.Item
            name="core_conflict"
            extra="只写阻碍目标实现的核心对立、代价与张力，不写完整剧情流程。"
            label={
              <span className="novel-core-settings__field-label">
                核心冲突
                <AIGenerateButton
                  label="AI"
                  size="small"
                  type="text"
                  buildMessages={() => buildContextAwareExpandMessages('core_conflict', '核心冲突')}
                  drawCount={aiConfig.drawCount}
                  disabled={isAnyAIActionRunning}
                  onResult={v => applyAndSaveDraft('core_conflict', v, '核心冲突')}
                />
              </span>
            }
          >
            <Input.TextArea rows={5} placeholder="只写阻碍目标实现的最核心对立、代价与矛盾张力" />
          </Form.Item>
          <AIScorePanel
            getContent={() => {
              const v = form.getFieldsValue()
              return [v.story_goal, v.core_conflict].filter(Boolean).join('\n\n')
            }}
            contentType="故事核心"
            novelBackground={novelBackground}
            genreContext={genreContext}
            drawCount={aiConfig.drawCount}
            customIsJson={false}
            disabled={isAnyAIActionRunning}
            buildCustomRegenMessages={buildStoryCoreOptimizationMessages}
            onRegenerate={v => {
              // 用标记解析，每个字段内容独立完整
              const sections = parseSections(v, '故事核心目标', '核心冲突')
              if (sections['故事核心目标']) {
                applyAndSaveDraft('story_goal', sections['故事核心目标'], '故事核心目标（优化版）')
              }
              if (sections['核心冲突']) {
                applyAndSaveDraft('core_conflict', sections['核心冲突'], '核心冲突（优化版）')
              }
              if (!sections['故事核心目标'] && !sections['核心冲突']) {
                // 回退：整体放入 story_goal
                applyAndSaveDraft('story_goal', v, '故事核心（优化版）')
              }
            }}
          />
        </>
      ),
    },
    {
      key: 'plot',
      label: (
        <div className="novel-core-settings__section-head">
          <span className="novel-core-settings__section-title">主线剧情</span>
          <AIGenerateButton
            label="AI 扩展"
            drawCount={aiConfig.drawCount}
            buildMessages={() => buildContextAwareExpandMessages('main_plot', '主线剧情概述')}
            disabled={isAnyAIActionRunning}
            onResult={v => applyAndSaveDraft('main_plot', v, '主线剧情')}
          />
        </div>
      ),
      children: (
        <>
          <Form.Item
            name="main_plot"
            label="主线概述"
            extra="只写围绕目标与冲突展开的关键事件链，重点体现因果推进、升级和转折。"
          >
            <Input.TextArea rows={6} placeholder="只写围绕目标与冲突展开的关键事件链和推进节点" />
          </Form.Item>
          <AIScorePanel
            getContent={() => form.getFieldValue('main_plot') || ''}
            contentType="主线剧情"
            novelBackground={novelBackground}
            genreContext={genreContext}
            drawCount={aiConfig.drawCount}
            disabled={isAnyAIActionRunning}
            buildCustomRegenMessages={(content, result, extraReqs) =>
              buildOptimizationMessages('main_plot', '主线剧情', content, result, extraReqs)}
            onRegenerate={v => applyAndSaveDraft('main_plot', v, '主线剧情（优化版）')}
          />
        </>
      ),
    },
    {
      key: 'subplot',
      label: (
        <div className="novel-core-settings__section-head">
          <span className="novel-core-settings__section-title">
            支线剧情 <span className="novel-core-settings__section-title-extra">({subPlots.length}条)</span>
          </span>
          <div className="novel-core-settings__subplot-toolbar" onClick={e => e.stopPropagation()}>
            <div className="novel-core-settings__subplot-toolbar-group">
              <span className="novel-core-settings__toolbar-label">生成数量</span>
              <Form.Item name="subplot_batch_count" noStyle initialValue={DEFAULT_SUBPLOT_BATCH_COUNT}>
                <InputNumber
                  size="small"
                  min={MIN_SUBPLOT_BATCH_COUNT}
                  max={MAX_SUBPLOT_BATCH_COUNT}
                  precision={0}
                  className="novel-core-settings__batch-input"
                  disabled={isAnyAIActionRunning}
                  onChange={value => form.setFieldValue('subplot_batch_count', clampSubplotBatchCount(value))}
                />
              </Form.Item>
              <span className="novel-core-settings__toolbar-hint">
                按每批 {SUBPLOT_GENERATION_CHUNK_SIZE} 条分批生成
              </span>
            </div>
            <Button
              size="small"
              icon={<RobotOutlined />}
              loading={isGeneratingSubplots}
              disabled={isGeneratingCoreSettings}
              onClick={e => {
                e.stopPropagation()
                void handleBatchGenerateSubplots()
              }}
            >
              {isGeneratingSubplots ? '分批生成中' : 'AI 分批生成'}
            </Button>
            <Button
              size="small"
              icon={<PlusOutlined />}
              disabled={isAnyAIActionRunning}
              onClick={e => { e.stopPropagation(); addSubPlot() }}
            >
              手动添加
            </Button>
          </div>
        </div>
      ),
      children: (
        <div className="novel-core-settings__subplot-body">
          {subplotGenerationProgress && (
            <div className="novel-core-settings__subplot-progress">
              正在分批生成：第 {subplotGenerationProgress.currentBatch}/{subplotGenerationProgress.totalBatches} 批，
              已生成 {subplotGenerationProgress.completed}/{subplotGenerationProgress.total} 条
            </div>
          )}
          {subPlots.length === 0 ? (
            <div className="novel-core-settings__subplot-empty">
              暂无支线，点击「AI 分批生成」或「手动添加」
            </div>
          ) : (
            subPlots.map((sub, index) => (
              <div
                key={index}
                className="novel-core-settings__subplot-card"
              >
                <div className="novel-core-settings__subplot-card-head">
                  <span className="novel-core-settings__subplot-card-title">
                    支线 {index + 1}
                  </span>
                  <div className="novel-core-settings__subplot-card-actions">
                    <AIGenerateButton
                      label="AI 刷新"
                      size="small"
                      type="text"
                      drawCount={aiConfig.drawCount}
                      disabled={isAnyAIActionRunning}
                      buildMessages={() => buildContextAwareSubplotMessages(index)}
                      runGeneration={({ messages, count }) => runSubplotRefreshDraws(index, messages as PromptMessage[], count)}
                      isJson
                      onResult={v => {
                        try {
                          applySingleSubplotFromResponse(index, v)
                          message.success('支线已按最新上下文刷新')
                        } catch {
                          message.error('AI 返回格式异常，请重试')
                        }
                      }}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      disabled={isAnyAIActionRunning}
                      icon={<DeleteOutlined />}
                      onClick={() => removeSubPlot(index)}
                    />
                  </div>
                </div>
                <Row gutter={12}>
                  <Col span={12}>
                    <div className="novel-core-settings__subplot-field">
                      <div className="novel-core-settings__subplot-field-label">支线名称</div>
                      <Input
                        size="small"
                        disabled={isAnyAIActionRunning}
                        value={sub.name}
                        onChange={e => updateSubPlot(index, 'name', e.target.value)}
                        placeholder="例如：师门情仇、商战暗线"
                      />
                    </div>
                  </Col>
                  <Col span={12}>
                    <div className="novel-core-settings__subplot-field">
                      <div className="novel-core-settings__subplot-field-label">涉及人物</div>
                      <Input
                        size="small"
                        disabled={isAnyAIActionRunning}
                        value={sub.characters}
                        onChange={e => updateSubPlot(index, 'characters', e.target.value)}
                        placeholder="角色名，逗号分隔"
                      />
                    </div>
                  </Col>
                  <Col span={24}>
                    <div className="novel-core-settings__subplot-field">
                      <div className="novel-core-settings__subplot-field-label">核心矛盾</div>
                      <Input.TextArea
                        size="small"
                        rows={4}
                        disabled={isAnyAIActionRunning}
                        value={sub.conflict}
                        onChange={e => updateSubPlot(index, 'conflict', e.target.value)}
                        placeholder="这条支线的核心矛盾和目的"
                      />
                    </div>
                  </Col>
                  <Col span={16}>
                    <div className="novel-core-settings__subplot-field">
                      <div className="novel-core-settings__subplot-field-label">与主线关联</div>
                      <Input
                        size="small"
                        disabled={isAnyAIActionRunning}
                        value={sub.mainlineLink}
                        onChange={e => updateSubPlot(index, 'mainlineLink', e.target.value)}
                        placeholder="如何与主线产生交集或呼应"
                      />
                    </div>
                  </Col>
                  <Col span={8}>
                    <div className="novel-core-settings__subplot-field">
                      <div className="novel-core-settings__subplot-field-label">预计收束章节</div>
                      <Input
                        size="small"
                        disabled={isAnyAIActionRunning}
                        value={sub.endChapter}
                        onChange={e => updateSubPlot(index, 'endChapter', e.target.value)}
                        placeholder="第X章"
                      />
                    </div>
                  </Col>
                </Row>
                <AIScorePanel
                  getContent={() => [sub.name, sub.conflict, sub.mainlineLink].filter(Boolean).join('\n\n')}
                  contentType={`支线剧情（${sub.name || '未命名'}）`}
                  novelBackground={novelBackground}
                  genreContext={genreContext}
                  drawCount={aiConfig.drawCount}
                  disabled={isAnyAIActionRunning}
                  customRunGeneration={({ messages, count }) => runSubplotRefreshDraws(index, messages as PromptMessage[], count)}
                  onRegenerate={isGeneratingSubplots ? undefined : (v => {
                    try {
                      applySingleSubplotFromResponse(index, v)
                      message.info('支线框架已按评分意见更新')
                    } catch {
                      message.error('AI 返回格式异常，请重试')
                    }
                  })}
                  customIsJson
                  buildCustomRegenMessages={(_, result, extraReqs) => {
                    const sorted = [...result.dimensions].sort((a, b) => a.score - b.score)
                    const dimSuggestions = sorted.slice(0, 3)
                      .filter(d => d.suggestion)
                      .map(d => `${d.name}（当前${d.score}分）：${d.suggestion}`)
                      .join('\n')
                    const topFixes = result.top_fixes.map((fix, fixIndex) => `${fixIndex + 1}. ${fix}`).join('\n')
                    return buildContextAwareSubplotMessages(index, {
                      topFixes,
                      dimSuggestions,
                      extraReqs,
                    })
                  }}
                />
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      key: 'rhythm',
      label: (
        <div className="novel-core-settings__section-head">
          <span className="novel-core-settings__section-title">叙事节奏</span>
          <Tooltip title="三段比例建议合计100%，可以不严格">
            <span className="novel-core-settings__section-meta">比例参考</span>
          </Tooltip>
        </div>
      ),
      children: (
        <div>
          <div className="novel-core-settings__rhythm-note">
            三段节奏比例（仅为参考，合计约100%）
          </div>
          <Row gutter={24}>
            <Col span={8}>
              <div className="novel-core-settings__rhythm-label">前期铺垫</div>
              <Form.Item name="rhythm_setup" initialValue={30} noStyle>
                <Slider min={10} max={60} step={5} marks={{ 10: '10%', 30: '30%', 60: '60%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <div className="novel-core-settings__rhythm-label">中期冲突</div>
              <Form.Item name="rhythm_conflict" initialValue={50} noStyle>
                <Slider min={20} max={70} step={5} marks={{ 20: '20%', 50: '50%', 70: '70%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <div className="novel-core-settings__rhythm-label">后期收束</div>
              <Form.Item name="rhythm_ending" initialValue={20} noStyle>
                <Slider min={5} max={40} step={5} marks={{ 5: '5%', 20: '20%', 40: '40%' }} />
              </Form.Item>
            </Col>
          </Row>
        </div>
      ),
    },
    {
      key: 'ending',
      label: (
        <div className="novel-core-settings__section-head">
          <span className="novel-core-settings__section-title">结局设定</span>
          <AIGenerateButton
            label="AI 扩展"
            drawCount={aiConfig.drawCount}
            buildMessages={() => buildContextAwareExpandMessages('ending', '结局内容')}
            disabled={isAnyAIActionRunning}
            onResult={v => applyAndSaveDraft('ending', v, '结局设定')}
          />
        </div>
      ),
      children: (
        <>
          <Form.Item name="ending_type" label="结局类型">
            <Select options={[
              { value: 'HE', label: '圆满结局（HE）' },
              { value: 'BE', label: '悲剧结局（BE）' },
              { value: 'open', label: '开放式结局' },
              { value: 'multi', label: '多结局' },
              { value: 'HE_BE', label: '主CP圆满，部分角色悲剧' },
            ]} />
          </Form.Item>
          <Form.Item
            name="ending"
            label={
              <span className="novel-core-settings__field-label">
                结局内容
                <AIGenerateButton
                  label="AI"
                  size="small"
                  type="text"
                  buildMessages={() => buildContextAwareExpandMessages('ending', '故事结局内容')}
                  drawCount={aiConfig.drawCount}
                  disabled={isAnyAIActionRunning}
                  onResult={v => applyAndSaveDraft('ending', v, '结局内容')}
                />
              </span>
            }
          >
            <Input.TextArea rows={5} placeholder="故事如何结束，主要矛盾如何收束" />
          </Form.Item>
          <AIScorePanel
            getContent={() => form.getFieldValue('ending') || ''}
            contentType="结局设定"
            novelBackground={novelBackground}
            genreContext={genreContext}
            drawCount={aiConfig.drawCount}
            disabled={isAnyAIActionRunning}
            buildCustomRegenMessages={(content, result, extraReqs) =>
              buildOptimizationMessages('ending', '结局设定', content, result, extraReqs)}
            onRegenerate={v => applyAndSaveDraft('ending', v, '结局设定（优化版）')}
          />
        </>
      ),
    },
  ]

  const storyAnchorCount = [storyGoalValue, coreConflictValue, mainPlotValue, endingValue]
    .filter((item) => typeof item === 'string' && item.trim()).length
  const rhythmReady = [rhythmSetupValue, rhythmConflictValue, rhythmEndingValue]
    .every((item) => typeof item === 'number' && item > 0)
  const isGuided = mode === 'guided'
  const collapseDefaultKeys = isGuided
    ? ['core', 'plot', 'ending']
    : ['core', 'plot', 'subplot', 'rhythm', 'ending']
  const heroContextSummary = (
    <div className="novel-core-settings__hero-context-clean">
      <WorkspaceContextSummary
        items={[
          { label: '工作模式', value: isGuided ? '小白模式' : '专业模式' },
          { label: '题材', value: genreContext },
          { label: '主角称谓规则', value: '涉及主角时统一使用“主角”，避免混用旧名、代号或占位名。' },
          { label: '当前模式', value: hasDraft ? '已有 AI 草稿待保存' : '纯编辑状态' },
        ]}
      />
      <section className="novel-core-settings__background-strip">
        <div className="novel-core-settings__background-head">
          <div className="novel-core-settings__background-label">背景依据</div>
          {canToggleBackgroundBasis ? (
            <button
              type="button"
              className="novel-core-settings__background-toggle"
              onClick={() => setIsBackgroundExpanded(value => !value)}
              aria-expanded={isBackgroundExpanded}
            >
              {isBackgroundExpanded ? '收起' : '展开全文'}
            </button>
          ) : null}
        </div>
        <div
          className={[
            'novel-core-settings__background-copy',
            !isBackgroundExpanded && canToggleBackgroundBasis ? 'novel-core-settings__background-copy--collapsed' : '',
          ].filter(Boolean).join(' ')}
        >
          {backgroundBasisText}
        </div>
      </section>
    </div>
  )

  return (
    <WorkspacePage
      className={`novel-core-settings novel-core-settings--${mode}`}
      heroVariant="compact"
      eyebrow={isGuided ? 'Core Story Engine' : 'Story Engine'}
      title="核心设定"
      description="把题材、背景、故事目标、核心冲突、主线推进、支线和结局先锁成一个可写的故事引擎。后续的人物、物品、时间轴和大纲都会沿用这里的叙事口径。"
      actions={(
        <div className="novel-core-settings__actions">
          <Button
            icon={<RobotOutlined />}
            loading={isGeneratingCoreSettings}
            disabled={isGeneratingSubplots}
            onClick={() => void handleGenerateCoreSettings()}
          >
            {isGeneratingCoreSettings ? '整页生成中' : 'AI 一键生成'}
          </Button>
          <Popover
            title={<span className="novel-core-settings__popover-title">AI 高级设置</span>}
            content={advancedSettingsContent}
            trigger="click"
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            placement="bottomRight"
          >
            <Badge dot={aiConfig.drawCount > 1 || !!aiConfig.requirements} color="var(--color-blue-primary)">
              <Button icon={<SettingOutlined />} size="small" disabled={isGeneratingCoreSettings}>
                高级设置{aiConfig.drawCount > 1 ? ` (抽卡×${aiConfig.drawCount})` : ''}
              </Button>
            </Badge>
          </Popover>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={isGeneratingCoreSettings} onClick={handleSave}>
            保存设定
          </Button>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="故事锚点" value={`${storyAnchorCount}/4`} tone="warm" hint="目标、冲突、主线、结局" />
          <WorkspaceMetric label="支线数量" value={subPlots.length} hint={subplotGenerationProgress ? `当前生成 ${subplotGenerationProgress.completed}/${subplotGenerationProgress.total}` : '建议控制在主线能承载的范围内'} />
          <WorkspaceMetric label="叙事节奏" value={rhythmReady ? '已设定' : '待补齐'} tone="cool" hint={rhythmReady ? `${rhythmSetupValue}% / ${rhythmConflictValue}% / ${rhythmEndingValue}%` : '前中后段占比还未明确'} />
          <WorkspaceMetric label="AI 附加要求" value={aiConfig.requirements.trim() ? '已启用' : '未启用'} hint={`抽卡 ${aiConfig.drawCount} 次`} />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '工作模式', value: isGuided ? '小白模式' : '专业模式' },
            { label: '题材', value: genreContext },
            { label: '背景依据', value: novelBackground || '尚未补充背景，建议先写清世界处境' },
            { label: '主角称谓规则', value: '涉及主角时统一使用“主角”，避免混用旧名、代号或占位名。' },
            { label: '当前模式', value: hasDraft ? '已有 AI 草稿待保存' : '纯编辑状态' },
          ]}
        />
      )}
      aside={(
        <>
          <WorkspaceTip title="新手最稳的填写顺序">
            <div>先写故事最终要抵达什么状态，再写阻碍这个目标实现的核心对立，最后补主线推进与结局。</div>
            <div>支线不是越多越好，必须和主线、人物成长或世界真相有明确连接，才能在后面写作时真正用得上。</div>
          </WorkspaceTip>

          <WorkspacePanel title="生成状态" description="这里统一看当前 AI 工作状态">
            <div className="novel-note-list">
              <div className="novel-note-list__item">整页生成：{isGeneratingCoreSettings ? '进行中' : '空闲'}</div>
              <div className="novel-note-list__item">支线批量生成：{isGeneratingSubplots ? '进行中' : '空闲'}</div>
              <div className="novel-note-list__item">抽卡次数：{aiConfig.drawCount}</div>
              <div className="novel-note-list__item">附加要求：{aiConfig.requirements.trim() || '未设置'}</div>
            </div>
          </WorkspacePanel>

          <WorkspacePanel title="页面职责提醒" description="这页不是碎片化灵感板">
            <div className="novel-note-list">
              <div className="novel-note-list__item">核心设定负责统一叙事方向，而不是堆砌漂亮设定词。</div>
              <div className="novel-note-list__item">后面的人物、物品、时间轴和大纲都会默认引用这里的目标、冲突和结局口径。</div>
            </div>
          </WorkspacePanel>
        </>
      )}
    >
      {heroContextSummary}

      {isGuided && (
        <WorkspaceTip title="小白模式建议先这样填">
          <div>先锁定故事最终要抵达的状态，再写阻碍它实现的核心冲突，最后补主线推进和结局。</div>
          <div>如果你暂时不确定支线和节奏，可以先把核心四项填稳，再回来细化剩余部分。</div>
        </WorkspaceTip>
      )}

      {coreSettingsProgress && (
        <Alert
          type={coreSettingsProgress.status === 'failed' ? 'error' : coreSettingsProgress.status === 'success' ? 'success' : 'info'}
          showIcon
          message={
            coreSettingsProgress.status === 'running'
              ? `AI 一键生成中：${coreSettingsProgress.label}`
              : coreSettingsProgress.status === 'success'
                ? `AI 一键生成完成：${coreSettingsProgress.label}`
                : `AI 一键生成失败：${coreSettingsProgress.label}`
          }
          description={[
            `已完成 ${coreSettingsProgress.completed}/${coreSettingsProgress.total} 个步骤`,
            coreSettingsProgress.detail || '',
            coreSettingsProgress.warning || '',
          ].filter(Boolean).join(' · ')}
        />
      )}

      {hasDraft && (
        <Alert
          type="info"
          showIcon
          closable
          message="有 AI 生成的内容已填入表单，记得点击「保存设定」"
          action={
            <Button size="small" onClick={() => clearByPrefix(draftPrefix)}>
              清除草稿
            </Button>
          }
        />
      )}

      <WorkspacePanel
        title="故事引擎编辑台"
        description="先锁定故事目标、核心冲突和主线，再处理支线、节奏与结局。整页生成只是起点，最后仍然建议你用人类语言再收一遍。"
        extra={<div className="novel-pill">AI 输出会自动遵守去引号、去口号和去模板化要求</div>}
      >
        <Form form={form} layout="vertical">
          <Collapse
            items={collapseItems}
            className="novel-core-settings__collapse"
            defaultActiveKey={collapseDefaultKeys}
          />
        </Form>
      </WorkspacePanel>

      <Modal
        title="应用一键生成结果"
        open={generatedApplyModalOpen}
        onCancel={() => {
          if (applyingGeneratedMode) return
          setGeneratedApplyModalOpen(false)
          setPendingGeneratedSettings(null)
          setCoreSettingsProgress(null)
        }}
        destroyOnClose
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setGeneratedApplyModalOpen(false)
              setPendingGeneratedSettings(null)
              setCoreSettingsProgress(null)
            }}
            disabled={Boolean(applyingGeneratedMode)}
          >
            暂不应用
          </Button>,
          <Button
            key="draft"
            loading={applyingGeneratedMode === 'draft'}
            disabled={Boolean(applyingGeneratedMode)}
            onClick={() => void handleApplyGeneratedSettings('draft')}
          >
            仅填入草稿
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={applyingGeneratedMode === 'save'}
            disabled={Boolean(applyingGeneratedMode)}
            onClick={() => void handleApplyGeneratedSettings('save')}
          >
            直接保存
          </Button>,
        ]}
      >
        <div className="novel-core-settings__result-copy">
          {pendingGeneratedSettings?.failedSteps
            ? '本次生成已完成，但有部分步骤失败。你可以先应用已完成内容，再补充或重试失败步骤。'
            : '已完成整页核心设定生成。你可以先把结果填入表单作为草稿检查，也可以直接写入当前小说设定。'}
        </div>
        {pendingGeneratedSettings && (
          <div className="novel-core-settings__result-summary">
            <div className="novel-core-settings__result-summary-title">
              生成摘要
            </div>
            <div className="novel-core-settings__result-summary-copy">
              已完成 {pendingGeneratedSettings.completedSteps}/{pendingGeneratedSettings.steps.length} 个步骤，
              失败 {pendingGeneratedSettings.failedSteps} 个步骤。
              {hasSuccessfulGeneratedStep(pendingGeneratedSettings, 'sub_plots_list')
                ? ` 支线已生成 ${pendingGeneratedSettings.sub_plots_list.length} 条。`
                : ' 支线本次未生成。'}
              {hasSuccessfulGeneratedStep(pendingGeneratedSettings, 'rhythm')
                ? ` 节奏建议为 ${pendingGeneratedSettings.rhythm_setup}% / ${pendingGeneratedSettings.rhythm_conflict}% / ${pendingGeneratedSettings.rhythm_ending}%。`
                : ''}
            </div>
            <div className="novel-core-settings__result-list">
              {pendingGeneratedSettings.steps.map((step) => (
                <div
                  key={step.key}
                  className={`novel-core-settings__result-step novel-core-settings__result-step--${step.status}`}
                >
                  <div className="novel-core-settings__result-step-title">
                    {step.label} · {
                      step.status === 'failed'
                        ? '失败'
                        : step.status === 'warning'
                          ? '部分成功'
                          : '成功'
                    }
                  </div>
                  {(step.warning || step.error) && (
                    <div className="novel-core-settings__result-step-copy">
                      {step.error || step.warning}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {pendingGeneratedSettings.warnings.length > 0 && (
              <Alert
                className="novel-core-settings__result-alert"
                type="warning"
                showIcon
                message="生成提示"
                description={pendingGeneratedSettings.warnings.join('；')}
              />
            )}
          </div>
        )}
      </Modal>
    </WorkspacePage>
  )
}
