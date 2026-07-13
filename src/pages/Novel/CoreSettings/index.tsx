import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, InputNumber, Modal, Select, Slider, Space, Tabs, Tag, message } from 'antd'
import {
  ArrowRightOutlined,
  DeleteOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { useNovelStore } from '../../../stores/novel.store'
import type { SubPlot } from '../../../types'
import type {
  CoreSettingsGenerationProgressEvent,
  CoreSettingsGenerationResult,
} from '../../../shared/core-settings-generation'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { estimateChapterCountFromOperatingMode } from '../../../shared/operating-mode'
import {
  buildStorySettingsPayload,
  parseStorySettingsSnapshot,
  type StoryEndingType,
} from '../../../shared/story-settings'
import {
  getWorkflowBlockers,
  isCharacterRosterReady,
  isItemsEquipmentReady,
  isMapStructureReady,
  isStoryPlotReady,
  isWorldFoundationReady,
  loadWorkflowStats,
  type WorkflowStats,
} from '../workflow'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context-core'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { usePlanningDraft } from '../shared/planning-draft'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { getWorkspaceViewModeForNovel } from '../../../shared/operating-mode'

interface Props {
  novelId: number
}

interface StoryDesignFormValues {
  story_goal: string
  core_conflict: string
  main_plot: string
  rhythm_setup: number
  rhythm_conflict: number
  rhythm_ending: number
  ending_type: StoryEndingType | ''
  ending: string
  subplot_batch_count: number
}

type GenerationMode = 'all' | 'subplots'
type SubplotLaneKey = 'setup' | 'escalation' | 'pressure' | 'payoff' | 'unscheduled'

const DEFAULT_SUBPLOT_BATCH_COUNT = 8
const MIN_SUBPLOT_BATCH_COUNT = 1
const MAX_SUBPLOT_BATCH_COUNT = 40
const EMPTY_STATS: WorkflowStats = {
  mapCount: 0,
  factionCount: 0,
  characterCount: 0,
  characterArcCount: 0,
  relationshipArcCount: 0,
  resistanceTrackCount: 0,
  itemCount: 0,
  glossaryCount: 0,
  threadCount: 0,
  sceneTemplateCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  revisionTaskCount: 0,
  revisionBlockerCount: 0,
  revisionOpenCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  staleChapterCount: 0,
  contextVersion: 1,
  staleCheckpointCount: 0,
  staleAssetCount: 0,
  staleAssetLabels: [],
  hasProtagonist: false,
  volumeCount: 0,
}

const SUBPLOT_LANES: Array<{ key: SubplotLaneKey; label: string; hint: string }> = [
  { key: 'setup', label: '前段铺垫', hint: '埋钩子、立代价、把支线挂到主线。' },
  { key: 'escalation', label: '中段升温', hint: '让人物关系与主线压力持续抬高。' },
  { key: 'pressure', label: '后段反压', hint: '让支线反咬主线，制造失控与代价。' },
  { key: 'payoff', label: '回收兑现', hint: '回收伏笔、兑现代价、落下后果。' },
  { key: 'unscheduled', label: '未排回收', hint: '尚未安排回收章位，后期失控风险最高。' },
]

const ENDING_OPTIONS: Array<{ value: StoryEndingType; label: string }> = [
  { value: 'HE', label: '圆满结局（HE）' },
  { value: 'BE', label: '悲剧结局（BE）' },
  { value: 'open', label: '开放结局' },
  { value: 'multi', label: '多线并收' },
  { value: 'HE_BE', label: '部分圆满，部分失去' },
]

const AnchorsTab = React.lazy(() => import('./tabs/AnchorsTab'))
const RhythmTab = React.lazy(() => import('./tabs/RhythmTab'))
const SubplotsTab = React.lazy(() => import('./tabs/SubplotsTab'))

function emptySubplot(): SubPlot {
  return {
    name: '',
    characters: '',
    conflict: '',
    mainlineLink: '',
    endChapter: '',
  }
}

function compactText(value?: string | null, max = 44): string {
  const text = value?.trim() || ''
  if (!text) return '未补背景'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function normalizeText(value?: string | null): string {
  return value?.trim() || ''
}

function clampBatchCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_SUBPLOT_BATCH_COUNT
  return Math.min(MAX_SUBPLOT_BATCH_COUNT, Math.max(MIN_SUBPLOT_BATCH_COUNT, Math.round(numeric)))
}

function parseChapterMarker(value?: string): number | null {
  if (!value) return null
  const match = value.match(/\d+/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function splitCharacterNames(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[、，,/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getEstimatedChapterTotal(targetWords: number | undefined, subplots: SubPlot[]): number {
  const byTarget = estimateChapterCountFromOperatingMode({
    targetWords,
  })
  const bySubplotEnd = subplots.reduce((maxValue, subplot) => {
    const end = parseChapterMarker(subplot.endChapter)
    return end && end > maxValue ? end : maxValue
  }, 0)
  const byScale = subplots.length > 0 ? Math.max(12, subplots.length * 4) : 12
  return Math.max(byTarget, bySubplotEnd, byScale)
}

function resolveLane(endChapter: string, estimatedTotal: number): SubplotLaneKey {
  const chapter = parseChapterMarker(endChapter)
  if (!chapter) return 'unscheduled'
  const ratio = chapter / Math.max(estimatedTotal, 1)
  if (ratio <= 0.25) return 'setup'
  if (ratio <= 0.55) return 'escalation'
  if (ratio <= 0.82) return 'pressure'
  return 'payoff'
}

function getSubplotCompleteness(subplot: SubPlot): number {
  const fields = [subplot.name, subplot.characters, subplot.conflict, subplot.mainlineLink, subplot.endChapter]
  const completed = fields.filter((field) => field && field.trim()).length
  return Math.round((completed / fields.length) * 100)
}

function buildLegacySubplotText(subplots: SubPlot[]): string {
  return subplots
    .map((subplot, index) => {
      const parts = [
        subplot.name ? `名称：${subplot.name}` : '',
        subplot.characters ? `人物：${subplot.characters}` : '',
        subplot.conflict ? `冲突：${subplot.conflict}` : '',
        subplot.mainlineLink ? `关联：${subplot.mainlineLink}` : '',
        subplot.endChapter ? `回收：${subplot.endChapter}` : '',
      ].filter(Boolean)
      return parts.length > 0 ? `${index + 1}. ${parts.join('；')}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeSubplots(list: Array<Partial<SubPlot> | null | undefined>): SubPlot[] {
  return list.map((item) => ({
    name: item?.name?.trim() || '',
    characters: item?.characters?.trim() || '',
    conflict: item?.conflict?.trim() || '',
    mainlineLink: item?.mainlineLink?.trim() || '',
    endChapter: item?.endChapter?.trim() || '',
  }))
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function CoreSettings({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<StoryDesignFormValues>()
  const [subplots, setSubplots] = useState<SubPlot[]>([])
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<GenerationMode | null>(null)
  const [generationProgress, setGenerationProgress] = useState<CoreSettingsGenerationProgressEvent | null>(null)
  const [subplotTaskId, setSubplotTaskId] = useState<number | null>(null)
  const [selectedSubplotIndex, setSelectedSubplotIndex] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState('anchors')
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_STATS)
  const isMountedRef = React.useRef(true)

  const settings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    form.setFieldsValue({
      story_goal: settings.storyDesign.storyGoal,
      core_conflict: settings.storyDesign.coreConflict,
      main_plot: settings.storyDesign.mainPlot,
      rhythm_setup: settings.storyDesign.rhythmSetup ?? 30,
      rhythm_conflict: settings.storyDesign.rhythmConflict ?? 50,
      rhythm_ending: settings.storyDesign.rhythmEnding ?? 20,
      ending_type: settings.storyDesign.endingType ?? '',
      ending: settings.storyDesign.ending,
      subplot_batch_count: DEFAULT_SUBPLOT_BATCH_COUNT,
    })
    setSubplots(normalizeSubplots(settings.storyDesign.subPlotsList))
    setSelectedSubplotIndex(null)
  }, [form, settings])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (active) setStats(workflowStats)
    }).catch(console.error)
    return () => {
      active = false
    }
  }, [novelId])

  useEffect(() => {
    const unsubscribe = window.electron.on('ai:core-settings-progress', (...args) => {
      const payload = args[0] as CoreSettingsGenerationProgressEvent | undefined
      if (!payload || payload.novelId !== novelId) return
      setGenerationProgress(payload)
    })
    return unsubscribe
  }, [novelId])

  const formValues = (Form.useWatch([], form) as Partial<StoryDesignFormValues> | undefined) || {}
  const premiseReady = settings.premiseReadyCount >= 4
  const assetReadyCount = [
    isWorldFoundationReady(currentNovel),
    isMapStructureReady(stats),
    isCharacterRosterReady(stats),
    isItemsEquipmentReady(stats),
  ].filter(Boolean).length
  const generationBlockers = useMemo(
    () => getWorkflowBlockers('story-design', currentNovel, stats),
    [currentNovel, stats],
  )
  const storyReady = isStoryPlotReady(currentNovel)
  const nextDesignPage = getWorkspaceViewModeForNovel(currentNovel) === 'professional' ? 'endgame' : 'volume-design'
  const watchedBatchCount = Form.useWatch('subplot_batch_count', form) as number | undefined
  const batchCount = clampBatchCount(watchedBatchCount)
  const estimatedChapterTotal = useMemo(
    () => Math.max(
      estimateChapterCountFromOperatingMode({
        launchMode: currentNovel?.launchMode,
        operatingMode: currentNovel?.operatingMode,
        targetWords: currentNovel?.targetWords,
        settingsJson: currentNovel?.settingsJson,
      }),
      getEstimatedChapterTotal(currentNovel?.targetWords, subplots),
    ),
    [currentNovel?.launchMode, currentNovel?.operatingMode, currentNovel?.settingsJson, currentNovel?.targetWords, subplots],
  )
  const anchorReadyCount = [
    formValues.story_goal,
    formValues.core_conflict,
    formValues.main_plot,
    formValues.ending,
  ].filter((value) => typeof value === 'string' && value.trim()).length
  const subplotLinkedCount = subplots.filter((subplot) => subplot.mainlineLink.trim()).length
  const subplotScheduledCount = subplots.filter((subplot) => Boolean(parseChapterMarker(subplot.endChapter))).length
  const selectedSubplot = selectedSubplotIndex === null ? null : subplots[selectedSubplotIndex] || null
  const applyStoryDesignDraft = React.useCallback((draft: Partial<StoryDesignFormValues> & { subplots?: SubPlot[] }) => {
    form.setFieldsValue({
      story_goal: typeof draft.story_goal === 'string' ? draft.story_goal : settings.storyDesign.storyGoal,
      core_conflict: typeof draft.core_conflict === 'string' ? draft.core_conflict : settings.storyDesign.coreConflict,
      main_plot: typeof draft.main_plot === 'string' ? draft.main_plot : settings.storyDesign.mainPlot,
      rhythm_setup: typeof draft.rhythm_setup === 'number' ? draft.rhythm_setup : settings.storyDesign.rhythmSetup ?? 30,
      rhythm_conflict: typeof draft.rhythm_conflict === 'number' ? draft.rhythm_conflict : settings.storyDesign.rhythmConflict ?? 50,
      rhythm_ending: typeof draft.rhythm_ending === 'number' ? draft.rhythm_ending : settings.storyDesign.rhythmEnding ?? 20,
      ending_type: typeof draft.ending_type === 'string' ? draft.ending_type : settings.storyDesign.endingType ?? '',
      ending: typeof draft.ending === 'string' ? draft.ending : settings.storyDesign.ending,
      subplot_batch_count: clampBatchCount(draft.subplot_batch_count),
    })
    if (Array.isArray(draft.subplots)) {
      setSubplots(normalizeSubplots(draft.subplots))
      setSelectedSubplotIndex(null)
    }
  }, [form, settings.storyDesign.ending, settings.storyDesign.endingType, settings.storyDesign.coreConflict, settings.storyDesign.mainPlot, settings.storyDesign.rhythmConflict, settings.storyDesign.rhythmEnding, settings.storyDesign.rhythmSetup, settings.storyDesign.storyGoal])
  const { clearDraft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<StoryDesignFormValues & { subplots?: SubPlot[] }>({
    novelId,
    pageKey: 'story-design',
    applyDraft: applyStoryDesignDraft,
  })

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'story-design',
    getSnapshot: () => {
      const values = form.getFieldsValue(true)
      return {
        scope: 'form',
        fields: {
          story_goal: typeof values.story_goal === 'string' ? values.story_goal.trim() : '',
          core_conflict: typeof values.core_conflict === 'string' ? values.core_conflict.trim() : '',
          main_plot: typeof values.main_plot === 'string' ? values.main_plot.trim() : '',
          rhythm_setup: typeof values.rhythm_setup === 'number' ? values.rhythm_setup : settings.storyDesign.rhythmSetup ?? 30,
          rhythm_conflict: typeof values.rhythm_conflict === 'number' ? values.rhythm_conflict : settings.storyDesign.rhythmConflict ?? 50,
          rhythm_ending: typeof values.rhythm_ending === 'number' ? values.rhythm_ending : settings.storyDesign.rhythmEnding ?? 20,
          ending_type: typeof values.ending_type === 'string' ? values.ending_type : '',
          ending: typeof values.ending === 'string' ? values.ending.trim() : '',
          subplot_batch_count: batchCount,
        },
        subplots: normalizeSubplots(subplots),
      }
    },
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<StoryDesignFormValues>
        : {}
      applyStoryDesignDraft({
        ...fields,
        subplots: Array.isArray(nextSnapshot.subplots) ? nextSnapshot.subplots as SubPlot[] : undefined,
      })
    },
    persistPreview: async (nextSnapshot, preview) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<StoryDesignFormValues>
        : {}
      await saveAppliedDraft({
        story_goal: typeof fields.story_goal === 'string' ? fields.story_goal : '',
        core_conflict: typeof fields.core_conflict === 'string' ? fields.core_conflict : '',
        main_plot: typeof fields.main_plot === 'string' ? fields.main_plot : '',
        rhythm_setup: typeof fields.rhythm_setup === 'number' ? fields.rhythm_setup : settings.storyDesign.rhythmSetup ?? 30,
        rhythm_conflict: typeof fields.rhythm_conflict === 'number' ? fields.rhythm_conflict : settings.storyDesign.rhythmConflict ?? 50,
        rhythm_ending: typeof fields.rhythm_ending === 'number' ? fields.rhythm_ending : settings.storyDesign.rhythmEnding ?? 20,
        ending_type: typeof fields.ending_type === 'string' ? fields.ending_type : '',
        ending: typeof fields.ending === 'string' ? fields.ending : '',
        subplot_batch_count: typeof fields.subplot_batch_count === 'number' ? fields.subplot_batch_count : batchCount,
        subplots: Array.isArray(nextSnapshot.subplots) ? normalizeSubplots(nextSnapshot.subplots as SubPlot[]) : normalizeSubplots(subplots),
      }, preview.warnings, 'story-design', {
        inputSummary: 'AI质量修复',
        rawOutputs: [JSON.stringify(preview.patchedSnapshot)],
      })
    },
  }), [applyStoryDesignDraft, batchCount, form, saveAppliedDraft, settings.storyDesign.rhythmConflict, settings.storyDesign.rhythmEnding, settings.storyDesign.rhythmSetup, subplots])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const subplotBoard = useMemo(() => {
    const lanes = SUBPLOT_LANES.map((lane) => ({
      ...lane,
      items: [] as Array<SubPlot & { index: number; completeness: number }>,
    }))
    const laneMap = new Map(lanes.map((lane) => [lane.key, lane]))

    subplots.forEach((subplot, index) => {
      const lane = resolveLane(subplot.endChapter, estimatedChapterTotal)
      laneMap.get(lane)?.items.push({
        ...subplot,
        index,
        completeness: getSubplotCompleteness(subplot),
      })
    })

    return lanes
  }, [estimatedChapterTotal, subplots])

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)

    try {
      const payload = buildStorySettingsPayload({
        storyDesign: {
          storyGoal: normalizeText(values.story_goal),
          coreConflict: normalizeText(values.core_conflict),
          mainPlot: normalizeText(values.main_plot),
          subPlotsList: subplots,
          subPlotsText: buildLegacySubplotText(subplots),
          rhythmSetup: values.rhythm_setup,
          rhythmConflict: values.rhythm_conflict,
          rhythmEnding: values.rhythm_ending,
          endingType: values.ending_type || undefined,
          ending: normalizeText(values.ending),
        },
      }, currentNovel?.settingsJson)

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(payload),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await finalizeDraft({
        story_goal: normalizeText(values.story_goal),
        core_conflict: normalizeText(values.core_conflict),
        main_plot: normalizeText(values.main_plot),
        rhythm_setup: values.rhythm_setup,
        rhythm_conflict: values.rhythm_conflict,
        rhythm_ending: values.rhythm_ending,
        ending_type: values.ending_type || '',
        ending: normalizeText(values.ending),
        subplot_batch_count: batchCount,
        subplots: normalizeSubplots(subplots),
      })
      await clearDraft()
      message.success(getUserFacingMessage('coreSettings.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'coreSettings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const clearStoryDesign = React.useCallback(() => {
    Modal.confirm({
      title: '清空当前故事设计',
      content: '会清空主线锚点、节奏、结局和支线卡片，但不会直接覆盖已经保存的小说设定。确认继续？',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        form.setFieldsValue({
          story_goal: '',
          core_conflict: '',
          main_plot: '',
          rhythm_setup: 30,
          rhythm_conflict: 50,
          rhythm_ending: 20,
          ending_type: '',
          ending: '',
          subplot_batch_count: DEFAULT_SUBPLOT_BATCH_COUNT,
        })
        setSubplots([])
        setSelectedSubplotIndex(null)
        message.success(getUserFacingMessage('coreSettings.designCleared'))
      },
    })
  }, [form])

  const clearSubplots = () => {
    Modal.confirm({
      title: '清空支线卡片',
      content: '只会清空当前支线列表，不影响主线锚点、节奏和结局。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setSubplots([])
        setSelectedSubplotIndex(null)
        message.success(getUserFacingMessage('coreSettings.subplotsCleared'))
      },
    })
  }

  useEffect(() => {
    registerClearHandler(clearStoryDesign)
    return () => registerClearHandler(null)
  }, [clearStoryDesign, registerClearHandler])

  const applyGeneratedResult = (result: CoreSettingsGenerationResult) => {
    form.setFieldsValue({
      story_goal: result.story_goal || '',
      core_conflict: result.core_conflict || '',
      main_plot: result.main_plot || '',
      rhythm_setup: result.rhythm_setup || 30,
      rhythm_conflict: result.rhythm_conflict || 50,
      rhythm_ending: result.rhythm_ending || 20,
      ending_type: result.ending_type || '',
      ending: result.ending || '',
    })
    setSubplots(normalizeSubplots(result.sub_plots_list))
    setSelectedSubplotIndex(null)
  }

  const waitForSubplotAutoGenerate = async (taskId: number) => {
    while (true) {
      if (!isMountedRef.current) {
        throw new Error(getUserFacingMessage('coreSettings.subplotBatchCancelled'))
      }

      const status = await window.electron.subplot.getAutoGenerateStatus(taskId)
      if (!status) {
        throw new Error(getUserFacingMessage('coreSettings.subplotTaskMissing'))
      }

      if (isMountedRef.current) {
        setGenerationProgress({
          novelId,
          step: 'sub_plots_list',
          label: '支线布局',
          status: status.status === 'failed' ? 'failed' : 'running',
          completed: Math.min(status.currentBatch, status.totalBatches),
          total: Math.max(status.totalBatches, 1),
          detail: status.message || `正在执行第 ${Math.min(status.currentBatch + 1, Math.max(status.totalBatches, 1))} 批支线生成。`,
          warning: status.warnings[status.warnings.length - 1],
        })
      }

      if (status.status === 'success') return status
      if (status.status === 'failed') {
        throw new Error(status.lastError || status.message || getUserFacingMessage('coreSettings.subplotBatchFailed'))
      }
      if (status.status === 'paused') {
        throw new Error(status.message || getUserFacingMessage('coreSettings.subplotBatchPaused'))
      }
      if (status.status === 'cancelled') {
        throw new Error(status.message || getUserFacingMessage('coreSettings.subplotBatchCancelled'))
      }

      await new Promise((resolve) => window.setTimeout(resolve, 500))
    }
  }

  const handleGenerate = async (mode: GenerationMode) => {
    const nextStats = await loadWorkflowStats(novelId)
    setStats(nextStats)
    const blockers = getWorkflowBlockers('story-design', currentNovel, nextStats)
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }

    setGeneratingMode(mode)
    setGenerationProgress(null)

    try {
      const values = form.getFieldsValue()
      const requirements = [
        '故事设计必须建立在已经存在的世界规则、地图、人物和物品基础上，不要把背景底盘直接写成剧情。',
        '减少 AI 腔、减少重复句式、减少空洞口号、减少无关支线。',
        '命名和措辞必须符合常规人类语言，禁止生造不连贯词语。',
        settings.writingRules.antiAiFlavor,
        settings.writingRules.commonSenseRules,
        mode === 'subplots'
          ? [
              '本轮重点是重做支线布局，只需要围绕现有主线目标、核心冲突、主推进链和结局落点重新排支线。',
              values.story_goal ? `已定主线目标：${values.story_goal}` : '',
              values.core_conflict ? `已定核心冲突：${values.core_conflict}` : '',
              values.main_plot ? `已定主推进链：${values.main_plot}` : '',
              values.ending ? `已定结局落点：${values.ending}` : '',
            ].filter(Boolean).join('\n')
          : '本轮生成需要同时整理主线目标、冲突、推进链、节奏、结局和支线布局。',
      ].filter(Boolean).join('\n')

      if (mode === 'subplots') {
        const taskId = await window.electron.subplot.startAutoGenerate({
          novelId,
          subplotCount: Math.max(batchCount, subplots.length || DEFAULT_SUBPLOT_BATCH_COUNT),
          storyGoal: normalizeText(values.story_goal),
          coreConflict: normalizeText(values.core_conflict),
          mainPlot: normalizeText(values.main_plot),
          requirements,
        })
        setSubplotTaskId(taskId)
        const status = await waitForSubplotAutoGenerate(taskId)
        const nextSubplots = normalizeSubplots(status.subplots)
        setSubplots(nextSubplots)
        setSelectedSubplotIndex(null)
        void saveAppliedDraft({
          story_goal: normalizeText(values.story_goal),
          core_conflict: normalizeText(values.core_conflict),
          main_plot: normalizeText(values.main_plot),
          rhythm_setup: values.rhythm_setup || 30,
          rhythm_conflict: values.rhythm_conflict || 50,
          rhythm_ending: values.rhythm_ending || 20,
          ending_type: values.ending_type || '',
          ending: normalizeText(values.ending),
          subplot_batch_count: batchCount,
          subplots: nextSubplots,
        }, status.warnings, 'story-design', {
          inputSummary: `重排支线 · ${currentNovel?.title || '未命名小说'}`,
        }).catch(console.error)

        if (status.warnings.length > 0) {
          message.warning(getUserFacingMessage('coreSettings.subplotGeneratedWithWarnings', { count: status.warnings.length }))
        } else {
          message.success(getUserFacingMessage('coreSettings.subplotRecomputed'))
        }
      } else {
        const result = await window.electron.ai.generateCoreSettings({
          novelId,
          subplotCount: Math.max(batchCount, subplots.length || DEFAULT_SUBPLOT_BATCH_COUNT),
          requirements,
        })

        if (result.failedSteps > 0) {
          message.error(getUserFacingMessage('coreSettings.partialGenerationBlocked', { count: result.failedSteps }))
          return
        }

        applyGeneratedResult(result)
        void saveAppliedDraft({
          story_goal: result.story_goal || values.story_goal || '',
          core_conflict: result.core_conflict || values.core_conflict || '',
          main_plot: result.main_plot || values.main_plot || '',
          rhythm_setup: result.rhythm_setup || values.rhythm_setup || 30,
          rhythm_conflict: result.rhythm_conflict || values.rhythm_conflict || 50,
          rhythm_ending: result.rhythm_ending || values.rhythm_ending || 20,
          ending_type: result.ending_type || values.ending_type || '',
          ending: result.ending || values.ending || '',
          subplot_batch_count: batchCount,
          subplots: normalizeSubplots(result.sub_plots_list),
        }, result.warnings, 'story-design', {
          inputSummary: `生成故事骨架 · ${currentNovel?.title || '未命名小说'}`,
        }).catch(console.error)

        if (result.warnings.length > 0) {
          message.warning(getUserFacingMessage('coreSettings.generatedWithWarnings', { count: result.warnings.length }))
        } else {
          message.success(getUserFacingMessage('coreSettings.generated'))
        }
      }
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'coreSettings.generateFailed'))
    } finally {
      setGeneratingMode(null)
      setGenerationProgress(null)
      setSubplotTaskId(null)
    }
  }

  const handleStopSubplotGenerate = async () => {
    if (!subplotTaskId) return
    try {
      await window.electron.workflow.cancel(subplotTaskId)
      message.success(getUserFacingMessage('coreSettings.subplotStopRequested'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'coreSettings.generateFailed'))
    }
  }

  const updateSubplot = (index: number, patch: Partial<SubPlot>) => {
    setSubplots((current) => current.map((subplot, currentIndex) => (
      currentIndex === index ? { ...subplot, ...patch } : subplot
    )))
  }

  const addSubplot = () => {
    setSubplots((current) => {
      const next = [...current, emptySubplot()]
      setSelectedSubplotIndex(next.length - 1)
      return next
    })
  }

  const removeSubplot = (index: number) => {
    setSubplots((current) => current.filter((_, currentIndex) => currentIndex !== index))
    setSelectedSubplotIndex((current) => {
      if (current === null) return null
      if (current === index) return null
      return current > index ? current - 1 : current
    })
  }

  const openSubplot = (index: number) => {
    setSelectedSubplotIndex(index)
  }

  const anchorsTabContent = (
    <>
      <WorkspacePanel title="设计原则" description="先把剧情骨架写硬，再继续拆结构、时间轴和正文。">
        <div className="guided-step__checklist">
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>只做骨架</strong></div>
            <p>本页维护目标、冲突、推进链、支线作用和结局。</p>
          </div>
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>支线必须有用</strong></div>
            <p>每条支线都要直接作用于主线、人物关系或主题压力，不能游离成无关故事。</p>
          </div>
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>语言必须自然</strong></div>
            <p>禁止口号式总结、生造词、万能情绪句和违背常识的推进方式。</p>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        title="故事锚点"
        description="四个锚点先固定住，后面的结构页和时间轴页都围绕这里展开。"
        extra={(
          <AIGenerateButton
            novelId={novelId}
            label="AI 生成·故事锚点"
            intent={hasFilledValues([
              typeof formValues.story_goal === 'string' ? formValues.story_goal : '',
              typeof formValues.core_conflict === 'string' ? formValues.core_conflict : '',
              typeof formValues.main_plot === 'string' ? formValues.main_plot : '',
              typeof formValues.ending === 'string' ? formValues.ending : '',
            ]) ? 'complete' : 'generate'}
            isJson
            buildMessages={() => buildDraftMessages({
              task: '故事设计的核心锚点',
              mode: hasFilledValues([
                typeof formValues.story_goal === 'string' ? formValues.story_goal : '',
                typeof formValues.core_conflict === 'string' ? formValues.core_conflict : '',
                typeof formValues.main_plot === 'string' ? formValues.main_plot : '',
                typeof formValues.ending === 'string' ? formValues.ending : '',
              ]) ? 'optimize' : 'replace',
              context: buildPlanningContextSections(currentNovel, {
                includeSubplots: false,
                extraSections: [
                  { label: '基础设定已完成', value: premiseReady ? '是' : '否' },
                  { label: '资产就绪度', value: `${assetReadyCount}/4` },
                ],
              }),
              fields: [
                { key: 'story_goal', label: '故事核心目标', value: formValues.story_goal, hint: '写最终要抵达什么状态，不写流水账。' },
                { key: 'core_conflict', label: '核心冲突', value: formValues.core_conflict, hint: '写目标为何难实现、谁在对抗、代价落在哪。' },
                { key: 'main_plot', label: '主推进链', value: formValues.main_plot, hint: '写主线如何因果推进到终局。' },
                { key: 'ending_type', label: '结局类型', value: formValues.ending_type, hint: '只用 HE、BE、open、multi、HE_BE 之一。' },
                { key: 'ending', label: '结局落点', value: formValues.ending, hint: '写主要矛盾如何落地，代价与余波如何留下。' },
              ],
              requirements: [
                '不要重写基础设定、人物设定和世界规则。',
                '锚点必须可继续拆成结构、时间轴和章节。',
              ],
            })}
            onResult={(raw) => {
              const draft = parseDraftJson<Partial<StoryDesignFormValues>>(raw)
              applyStoryDesignDraft({
                story_goal: typeof draft.story_goal === 'string' ? draft.story_goal : undefined,
                core_conflict: typeof draft.core_conflict === 'string' ? draft.core_conflict : undefined,
                main_plot: typeof draft.main_plot === 'string' ? draft.main_plot : undefined,
                ending_type: typeof draft.ending_type === 'string' ? draft.ending_type : undefined,
                ending: typeof draft.ending === 'string' ? draft.ending : undefined,
              })
            }}
          />
        )}
      >
        <Form form={form} layout="vertical">
          <div className="story-design__anchor-grid">
            <div className="story-design__anchor-card">
              <Form.Item name="story_goal" label="故事核心目标" rules={[{ required: true, message: '请写清故事核心目标' }]}>
                <Input.TextArea rows={6} placeholder="写这部书最终要抵达什么状态，不写过程流水账。" />
              </Form.Item>
            </div>
            <div className="story-design__anchor-card">
              <Form.Item name="core_conflict" label="核心冲突" rules={[{ required: true, message: '请写清核心冲突' }]}>
                <Input.TextArea rows={6} placeholder="写目标为什么难实现，谁在对抗，代价落在谁身上。" />
              </Form.Item>
            </div>
            <div className="story-design__anchor-card story-design__anchor-card--full">
              <Form.Item name="main_plot" label="主推进链" rules={[{ required: true, message: '请写清主推进链' }]}>
                <Input.TextArea rows={5} placeholder="写主线如何一步步推进到结局，强调因果、升级和转折。" />
              </Form.Item>
            </div>
            <div className="story-design__anchor-card story-design__anchor-card--compact">
              <Form.Item name="ending_type" label="结局类型">
                <Select allowClear options={ENDING_OPTIONS} placeholder="选择结局类型" />
              </Form.Item>
            </div>
            <div className="story-design__anchor-card story-design__anchor-card--full">
              <Form.Item name="ending" label="结局落点" rules={[{ required: true, message: '请写清结局落点' }]}>
                <Input.TextArea rows={6} placeholder="写故事最终如何收束，主要矛盾如何落地，代价与余波如何留下。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>
    </>
  )

  const rhythmTabContent = (
    <WorkspacePanel
      title="节奏与结局"
      description="长篇不要只盯着章数，先把三段比例定下来。"
      extra={<Tag color="gold">推荐先定比例，再拆卷部章</Tag>}
    >
      <Form form={form} layout="vertical">
        <div className="story-design__ratio-grid">
          <div className="story-design__ratio-card">
            <Form.Item name="rhythm_setup" label="前段铺垫">
              <Slider min={10} max={60} />
            </Form.Item>
            <small>负责立环境、立代价、立悬念。</small>
          </div>
          <div className="story-design__ratio-card">
            <Form.Item name="rhythm_conflict" label="中段冲突">
              <Slider min={20} max={70} />
            </Form.Item>
            <small>负责持续抬升压力与关系对抗。</small>
          </div>
          <div className="story-design__ratio-card">
            <Form.Item name="rhythm_ending" label="后段回收">
              <Slider min={10} max={40} />
            </Form.Item>
            <small>负责回收伏笔、兑现代价和后果。</small>
          </div>
        </div>
      </Form>
    </WorkspacePanel>
  )

  const subplotsTabContent = (
    <WorkspacePanel
      title="支线看板"
      description="先把支线当成项目卡片管理，而不是堆成长文本。点击卡片可在右侧抽屉细修。"
      extra={(
        <div className="story-design__toolbar">
          <Form form={form} component={false}>
            <Form.Item name="subplot_batch_count" className="workspace-form-item-inline">
              <InputNumber min={MIN_SUBPLOT_BATCH_COUNT} max={MAX_SUBPLOT_BATCH_COUNT} />
            </Form.Item>
          </Form>
          <Button icon={<RobotOutlined />} loading={generatingMode === 'subplots'} onClick={() => void handleGenerate('subplots')}>
            AI 重算支线
          </Button>
          {generatingMode === 'subplots' && subplotTaskId ? (
            <Button danger icon={<StopOutlined />} onClick={() => void handleStopSubplotGenerate()}>
              停止
            </Button>
          ) : null}
          <Button icon={<PlusOutlined />} onClick={addSubplot}>
            新增支线
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={clearSubplots}>
            一键清空支线
          </Button>
        </div>
      )}
    >
      <div className="story-design__stats-grid">
        <div className="guided-step__fact-card">
          <span>本轮 AI 数量</span>
          <strong>{batchCount}</strong>
          <small>用于生成或重算支线时的目标数量。</small>
        </div>
        <div className="guided-step__fact-card">
          <span>已挂主线</span>
          <strong>{subplotLinkedCount}/{subplots.length}</strong>
          <small>没有主线因果的支线，应优先删掉或改写。</small>
        </div>
        <div className="guided-step__fact-card">
          <span>已排回收</span>
          <strong>{subplotScheduledCount}/{subplots.length}</strong>
          <small>未定回收章位越多，后期失控风险越高。</small>
        </div>
        <div className="guided-step__fact-card">
          <span>预计全书长度</span>
          <strong>{estimatedChapterTotal} 章</strong>
          <small>按目标字数和支线回收章位粗估。</small>
        </div>
      </div>

      <div className="story-design__board">
        {subplotBoard.map((lane) => (
          <section key={lane.key} className="story-design__lane">
            <div className="story-design__lane-head">
              <div className="story-design__lane-copy">
                <strong>{lane.label}</strong>
                <span>{lane.hint}</span>
              </div>
              <Tag>{lane.items.length}</Tag>
            </div>

            <div className="story-design__lane-body">
              {lane.items.length === 0 ? (
                <div className="story-design__lane-empty">当前还没有落在这一阶段的支线。</div>
              ) : lane.items.map((subplot) => (
                <button
                  key={`${lane.key}-${subplot.index}`}
                  type="button"
                  className="story-design__card"
                  onClick={() => openSubplot(subplot.index)}
                >
                  <div className="story-design__card-head">
                    <strong>{subplot.name || `支线 ${subplot.index + 1}`}</strong>
                    <Tag color={subplot.completeness === 100 ? 'success' : 'default'}>{subplot.completeness}%</Tag>
                  </div>
                  <div className="story-design__card-copy">
                    {subplot.conflict || '还没有写清这条支线的核心冲突。'}
                  </div>
                  <div className="story-design__card-copy story-design__card-copy--soft">
                    {subplot.mainlineLink || '还没有写清这条支线如何反作用于主线。'}
                  </div>
                  <div className="story-design__card-meta">
                    {splitCharacterNames(subplot.characters).slice(0, 3).map((name) => (
                      <Tag key={name}>{name}</Tag>
                    ))}
                    <Tag>{parseChapterMarker(subplot.endChapter) ? `第 ${parseChapterMarker(subplot.endChapter)} 章回收` : '未安排回收'}</Tag>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </WorkspacePanel>
  )

  return (
    <WorkspacePage
      className="novel-story-design-page"
      layout="wide"
      heroVariant="compact"
      asidePlacement="side"
      eyebrow="故事设计"
      title="故事设计"
      description="这里专门负责主线目标、核心冲突、主推进链、支线布局、节奏比例和结局落点。背景、人物、地图、物品先在前面准备好，再来这里把剧情骨架压实。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存故事设计
          </Button>
          <Button icon={<RobotOutlined />} loading={generatingMode === 'all'} onClick={() => void handleGenerate('all')}>
            AI 生成故事骨架
          </Button>
          <Button icon={<DeleteOutlined />} danger onClick={clearStoryDesign}>
            清空当前设计
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, nextDesignPage))}>
            {nextDesignPage === 'endgame' ? '去终局设计' : '去卷级设计'}
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
            { label: '基础设定', value: premiseReady ? '已就绪' : '待补齐' },
            { label: '预计章数', value: `约 ${estimatedChapterTotal} 章` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="剧情锚点" value={`${anchorReadyCount}/4`} tone="warm" hint="目标、冲突、推进链、结局" />
          <WorkspaceMetric label="支线数量" value={subplots.length} hint="只保留对主线有因果作用的支线" />
          <WorkspaceMetric label="节奏比例" value={`${formValues.rhythm_setup ?? 30}/${formValues.rhythm_conflict ?? 50}/${formValues.rhythm_ending ?? 20}`} hint="铺垫 / 冲突 / 回收" />
          <WorkspaceMetric label="已保存版本" value={storyReady ? '存在' : '未保存'} hint="保存后会进入全书上下文。" />
        </>
      )}
      aside={(
          <div className="story-design__side-list">
            <WorkspacePanel title="支线健康度" description="支线必须服务主线，不准游离。">
            <div className="premise-page__summary-grid">
              <div className="premise-page__summary-card premise-page__summary-card--accent">
                <span>已挂主线</span>
                <strong>{subplotLinkedCount}/{subplots.length}</strong>
                <small>没有主线因果的支线，应优先删掉或改写。</small>
              </div>
              <div className="premise-page__summary-card">
                <span>已排回收</span>
                <strong>{subplotScheduledCount}/{subplots.length}</strong>
                <small>没有回收章位的支线，后期失控风险最高。</small>
              </div>
            </div>
          </WorkspacePanel>
        </div>
      )}
    >
      {!premiseReady ? (
        <Alert
          type="warning"
          showIcon
          message="基础设定未完成"
        />
      ) : null}

      {generationBlockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="当前还不适合生成故事设计"
          description={(
            <div>
              {generationBlockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      {assetReadyCount < 4 ? (
        <Alert
          type="info"
          showIcon
          message="资产还没有完全到位。你已经可以起一版故事设计，但人物、地图、物品越完整，剧情越不容易空转。"
        />
      ) : null}

      {generationProgress ? (
        <Alert
          type={generationProgress.status === 'failed' ? 'error' : generationProgress.status === 'skipped' ? 'warning' : 'info'}
          showIcon
          message={generationProgress.status === 'running'
            ? `AI 正在生成：${generationProgress.label}`
            : generationProgress.status === 'skipped'
              ? `已跳过：${generationProgress.label}`
              : generationProgress.status === 'failed'
                ? `生成失败：${generationProgress.label}`
                : `已完成：${generationProgress.label}`}
          description={generationProgress.detail || generationProgress.warning || (generationProgress.status === 'running' ? '正在根据当前设定整理故事骨架。' : '')}
        />
      ) : null}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'anchors',
            label: '锚点',
            children: (
              <React.Suspense fallback={<div className="novel-empty"><Tag>加载中</Tag></div>}>
                <AnchorsTab content={anchorsTabContent} />
              </React.Suspense>
            ),
          },
          {
            key: 'rhythm',
            label: '节奏',
            children: (
              <React.Suspense fallback={<div className="novel-empty"><Tag>加载中</Tag></div>}>
                <RhythmTab content={rhythmTabContent} />
              </React.Suspense>
            ),
          },
          {
            key: 'subplots',
            label: '支线',
            children: (
              <React.Suspense fallback={<div className="novel-empty"><Tag>加载中</Tag></div>}>
                <SubplotsTab content={subplotsTabContent} />
              </React.Suspense>
            ),
          },
        ]}
      />

      <Drawer
        title={selectedSubplot ? selectedSubplot.name || '支线编辑' : '支线编辑'}
        placement="right"
        width={420}
        open={selectedSubplotIndex !== null && Boolean(selectedSubplot)}
        onClose={() => setSelectedSubplotIndex(null)}
        extra={selectedSubplotIndex !== null ? (
          <Space wrap>
            {selectedSubplot ? (
              <AIGenerateButton
                novelId={novelId}
                label="AI 补全·当前支线"
                intent={hasFilledValues([
                  selectedSubplot.name,
                  selectedSubplot.characters,
                  selectedSubplot.conflict,
                  selectedSubplot.mainlineLink,
                  selectedSubplot.endChapter,
                ]) ? 'complete' : 'generate'}
                isJson
                buildMessages={() => buildDraftMessages({
                  task: '单条支线卡片',
                  mode: hasFilledValues([
                    selectedSubplot.name,
                    selectedSubplot.characters,
                    selectedSubplot.conflict,
                    selectedSubplot.mainlineLink,
                    selectedSubplot.endChapter,
                  ]) ? 'optimize' : 'replace',
                  context: buildPlanningContextSections(currentNovel, {
                    includeSubplots: false,
                    extraSections: [
                      { label: '主线目标', value: typeof formValues.story_goal === 'string' ? formValues.story_goal : '' },
                      { label: '核心冲突', value: typeof formValues.core_conflict === 'string' ? formValues.core_conflict : '' },
                      { label: '主推进链', value: typeof formValues.main_plot === 'string' ? formValues.main_plot : '' },
                      { label: '结局落点', value: typeof formValues.ending === 'string' ? formValues.ending : '' },
                    ],
                  }),
                  fields: [
                    { key: 'name', label: '支线名称', value: selectedSubplot.name, hint: '短、准、可识别，能直接点出这条支线的作用。' },
                    { key: 'endChapter', label: '回收章位', value: selectedSubplot.endChapter, hint: '给出合理章位数字。' },
                    { key: 'characters', label: '涉及人物', value: selectedSubplot.characters, hint: '使用顿号或逗号分隔。' },
                    { key: 'conflict', label: '核心冲突', value: selectedSubplot.conflict, hint: '写这条支线真正制造的麻烦、代价与压力。' },
                    { key: 'mainlineLink', label: '对主线的作用', value: selectedSubplot.mainlineLink, hint: '写它怎样反作用于主线、人物关系或主题压力。' },
                  ],
                  requirements: [
                    '支线必须直接服务主线，不准游离成独立小故事。',
                    '冲突和回收章位要与全书节奏和终局方向一致。',
                  ],
                })}
                onResult={(raw) => {
                  const draft = parseDraftJson<Partial<SubPlot>>(raw)
                  updateSubplot(selectedSubplotIndex, {
                    name: typeof draft.name === 'string' ? draft.name : selectedSubplot.name,
                    endChapter: normalizeOptionalNumber(draft.endChapter ?? selectedSubplot.endChapter)
                      ? String(normalizeOptionalNumber(draft.endChapter ?? selectedSubplot.endChapter))
                      : (typeof draft.endChapter === 'string' ? draft.endChapter : selectedSubplot.endChapter),
                    characters: typeof draft.characters === 'string' ? draft.characters : selectedSubplot.characters,
                    conflict: typeof draft.conflict === 'string' ? draft.conflict : selectedSubplot.conflict,
                    mainlineLink: typeof draft.mainlineLink === 'string' ? draft.mainlineLink : selectedSubplot.mainlineLink,
                  })
                }}
              />
            ) : null}
            <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeSubplot(selectedSubplotIndex)}>
              删除
            </Button>
          </Space>
        ) : null}
      >
        {selectedSubplot && selectedSubplotIndex !== null ? (
          <div className="story-design__drawer">
            <div className="story-design__drawer-section story-design__drawer-section--compact">
              <label>支线名称</label>
              <Input
                value={selectedSubplot.name}
                onChange={(event) => updateSubplot(selectedSubplotIndex, { name: event.target.value })}
                placeholder="例如：后勤线崩盘"
              />
            </div>

            <div className="story-design__drawer-meta">
              <div className="story-design__drawer-section story-design__drawer-section--compact">
                <label>回收章位</label>
                <Input
                  value={selectedSubplot.endChapter}
                  onChange={(event) => updateSubplot(selectedSubplotIndex, { endChapter: event.target.value })}
                  placeholder="例如：36"
                />
              </div>
              <div className="story-design__drawer-section story-design__drawer-section--compact">
                <label>涉及人物</label>
                <Input
                  value={selectedSubplot.characters}
                  onChange={(event) => updateSubplot(selectedSubplotIndex, { characters: event.target.value })}
                  placeholder="使用顿号或逗号分隔"
                />
              </div>
            </div>

            <div className="story-design__drawer-section">
              <label>核心冲突</label>
              <Input.TextArea
                rows={5}
                value={selectedSubplot.conflict}
                onChange={(event) => updateSubplot(selectedSubplotIndex, { conflict: event.target.value })}
                placeholder="写这条支线真正制造的麻烦、代价与压力。"
              />
            </div>

            <div className="story-design__drawer-section">
              <label>对主线的作用</label>
              <Input.TextArea
                rows={5}
                value={selectedSubplot.mainlineLink}
                onChange={(event) => updateSubplot(selectedSubplotIndex, { mainlineLink: event.target.value })}
                placeholder="写它怎样反作用于主线、人物关系或主题压力。"
              />
            </div>

            <div className="story-design__inline-note">
              支线卡片只保留 5 个高频字段，方便超长篇拆分、替换、回查和后续挂到结构页、时间轴页。
            </div>
          </div>
        ) : null}
      </Drawer>
    </WorkspacePage>
  )
}
