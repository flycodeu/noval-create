import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Modal, Select, Spin, Tag, message } from 'antd'
import {
  ApartmentOutlined,
  BranchesOutlined,
  CheckOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import AIScorePanel from '../../../components/AIScorePanel'
import ActionErrorAlert from '../../../components/common/ActionErrorAlert'
import TruncatedList from '../../../components/common/TruncatedList'
import ActionBar from '../../../components/novel/common/ActionBar'
import CreativeStageScope from '../../../components/novel/CreativeStageScope'
import SectionHeader from '../../../components/novel/common/SectionHeader'
import { type ContractPanelSection } from '../../../components/novel/writing/ContractPanel'
import PipelineBar, { type PipelineBarItem } from '../../../components/novel/writing/PipelineBar'
import ReviewNotesPanel from '../../../components/novel/writing/ReviewNotesPanel'
import { formatFailure } from '../../../shared/task-labels'
import { formatStaleReasonsSummary, translateContextChangeReasons } from '../../../shared/context-change-reasons'
import VersionTimeline from '../../../components/novel/writing/VersionTimeline'
import {
  AI_EXECUTION_MODE_OPTIONS,
  getAiExecutionModeLabel,
  type AiExecutionMode,
} from '../../../shared/ai-execution'
import { buildWorkspaceRoute, getChapterWritabilitySummary } from '../../../shared/novel-workspace'
import {
  buildStorySettingsPayload,
  parseStorySettingsSnapshot,
} from '../../../shared/story-settings'
import type {
  Chapter,
  ChapterContractAudit,
  ChapterContextPreview,
  ChapterOptimizeResult,
  HardConstraintSourceLabel,
  ChapterPublishCheck,
  ChapterSegment,
  Task,
  ChapterVersion,
  Character,
  ForeshadowLedgerEntry,
  ForeshadowSnapshot,
  NovelConsistencyReport,
  NovelContextStatus,
  QualityDashboardData,
  StoryFact,
  StoryItem,
  StoryMemorySnapshot,
  StoryVolume,
  TimelineEvent,
  WritebackSyncStatus,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTaskStore } from '../../../stores/task.store'
import { useWritingViewStore, type WritingGenerationStage } from '../../../stores/writingView.store'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { createChapterSaveCoordinator } from './chapter-save-coordinator'
import { formatChapterNumber, getStatusLabel } from './chapter-labels'
import ChapterNavigator from './components/ChapterNavigator'
import InsightPanel, {
  AiCheckResult,
  AiExplainabilityCard,
  ChapterBridgeMemoryCard,
  ChapterFocusCard,
  ChapterForeshadowWritebackCard,
  ChapterRevealConstraintCard,
  CharacterStateMemoryCard,
  ConstraintInjectionCard,
  ContextUsageImpactCard,
  DialogueFingerprintHealthCard,
  HumanizationHealthCard,
  InsightCard,
  LanguageDriftHealthCard,
  PreviousChapterFeedCard,
  RecallDiagnosticsCard,
  StoryDynamicsHealthCard,
  StringList,
  WorldStateHealthCard,
  WriterToolsTraceCard,
  type WritingRouteKey,
} from './components/InsightPanel'
import StreamingOutput from './components/StreamingOutput'
import { computeVolumeTruthRevealStats, normalizeIdArray } from './components/InsightPanel/insight-utils'
import RewriteSelectionModal from './components/modals/RewriteSelectionModal'
import OptimizeCandidateModal from './components/modals/OptimizeCandidateModal'
import ParallelGenerationModal from './components/modals/ParallelGenerationModal'
import {
  getWorldRulesSummary,
  normalizeContractAudit,
  parseAiCheck,
  parseBridgePlan,
  parseContinuity,
  parseContractAudit,
  parseExpressionDedup,
  parseHookContinuity,
  parseNumberArray,
  parsePipelineSnapshot,
  parseReviewNotes,
  parseScenePlan,
  parseStringArray,
  parseSummaryHealth,
  parseWritebackStatus,
  type AiCheckPayload,
  type WritingPipelineRole,
  type WritingPipelineRoleState,
  type WritingPipelineSnapshot,
} from './parsers'
import './index.css'

interface Props { novelId: number }

interface TextSelectionSnapshot {
  start: number
  end: number
  text: string
}

/** 主链路（生成 / 优化 / 审校）失败后的区域内持久提示。 */
interface WritingActionError {
  title: string
  message: string
  retry?: () => void
}
interface ChapterGenerationProgressEvent {
  chapterId: number
  taskId?: number
  streamTaskId?: number
  role?: WritingPipelineRole
  stage: WritingGenerationStage
  label: string
  detail?: string
  completed: number
  total: number
  status: 'running' | 'success' | 'failed' | 'cancelled'
  pipeline?: WritingPipelineSnapshot
}
const loadWritingEditorRoute = () => import('./routes/EditorRoute')
const loadWritingContextRoute = () => import('./routes/ContextRoute')
const loadWritingReviewRoute = () => import('./routes/ReviewRoute')
const loadWritingHistoryRoute = () => import('./routes/HistoryRoute')

const WRITING_ROUTE_LOADERS: Record<WritingRouteKey, () => Promise<unknown>> = {
  editor: loadWritingEditorRoute,
  context: loadWritingContextRoute,
  review: loadWritingReviewRoute,
  history: loadWritingHistoryRoute,
}

const WritingEditorRoute = React.lazy(loadWritingEditorRoute)
const WritingContextRoute = React.lazy(loadWritingContextRoute)
const WritingReviewRoute = React.lazy(loadWritingReviewRoute)
const WritingHistoryRoute = React.lazy(loadWritingHistoryRoute)

const countWords = (text: string) => ((text.match(/[一-龥]/g) || []).length + (text.match(/\b[a-zA-Z]+\b/g) || []).length)
const formatPipelineMetaValue = (value: string, maxLength = 72) => {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 18)}…${value.slice(-16)}`
}
const getIssueColor = (severity: 'high' | 'medium' | 'low') => severity === 'high' ? 'error' : severity === 'medium' ? 'warning' : 'default'
const getIssueLabel = (severity: 'high' | 'medium' | 'low') => severity === 'high' ? '高优先' : severity === 'medium' ? '中优先' : '低优先'
const getHealthLabel = (score: number) => (score >= 80 ? '结构稳定' : score >= 60 ? '可继续推进' : '需要处理问题')
const getPublishCheckStatusLabel = (status: ChapterPublishCheck['checklist'][number]['status']) => {
  if (status === 'rewrite') return '退回重写'
  if (status === 'blocker') return '阻塞'
  if (status === 'warning') return '预警'
  return '通过'
}
const getPublishCheckStatusTagColor = (status: ChapterPublishCheck['checklist'][number]['status']) => {
  if (status === 'rewrite') return 'red'
  if (status === 'blocker') return 'error'
  if (status === 'warning') return 'warning'
  return 'success'
}
const formatPublishCheckItemText = (item: ChapterPublishCheck['checklist'][number]) => {
  const sourceLabel = item.segmentTitle
    ? ` · ${item.segmentTitle}`
    : item.source === 'scene'
      ? ' · 场景'
      : item.source === 'contract'
        ? ' · 合同'
        : item.source === 'review'
          ? ' · 审校'
          : item.source === 'thread'
            ? ' · 线程'
            : item.source === 'volume'
              ? ' · 卷目标'
              : ''
  return `${getPublishCheckStatusLabel(item.status)} · ${item.label}${sourceLabel}：${item.detail}`
}
const formatContractAuditItemText = (item: ChapterContractAudit['items'][number]) => {
  const prefix = item.status === 'pass' ? '通过' : item.status === 'warning' ? '中优先' : '阻塞'
  return `${prefix} · ${item.label}：${item.detail}`
}
const collectPublishCheckMessages = (check: ChapterPublishCheck, status: 'warning' | 'blocker' | 'rewrite') => [
  ...check.checklist
    .filter((item) => item.status === status)
    .map(formatPublishCheckItemText),
  ...(status === 'rewrite'
    ? []
    : check.contractAudit.items
      .filter((item) => item.status === status)
      .map((item) => `合同对账 · ${formatContractAuditItemText(item)}`)),
]
const getPublishCheckAlertType = (check: ChapterPublishCheck | null) => {
  if (!check) return 'info'
  if (check.gateLevel === 'rewrite' || check.gateLevel === 'blocker') return 'error'
  if (check.gateLevel === 'warning') return 'warning'
  return 'success'
}
const getPublishCheckScoreTagColor = (score: number) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'processing'
  if (score >= 40) return 'warning'
  return 'error'
}
const getPublishCheckDriftLabel = (status?: 'worsening' | 'improving' | 'stable') => {
  if (status === 'worsening') return '恶化'
  if (status === 'improving') return '改善'
  return '稳定'
}
const getPublishCheckDriftTagColor = (status?: 'worsening' | 'improving' | 'stable') => {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}
const getWritebackPhaseLabel = (phase?: WritebackSyncStatus['phase']) => {
  if (phase === 'preparing') return '准备回写'
  if (phase === 'ready') return '候选已生成·待正典确认'
  if (phase === 'applying') return '正在应用'
  if (phase === 'applied') return '已应用'
  if (phase === 'failed') return '回写失败'
  return '空闲'
}
function normalizeEditorText(value?: string | null): string {
  return (value || '').replace(/\r\n/g, '\n')
}

function writePlainEditorText(element: HTMLElement | null, value?: string | null) {
  if (!element) return
  element.textContent = normalizeEditorText(value)
}

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getSelectionSnapshot(container: HTMLElement): TextSelectionSnapshot | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const prefixRange = range.cloneRange()
  prefixRange.selectNodeContents(container)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  const rawText = normalizeEditorText(range.toString())
  const text = rawText.trim()
  if (!text) return null

  // Offset the start by any trimmed leading whitespace, otherwise the
  // replacement range shifts forward and eats trailing characters.
  const leadingTrimmed = rawText.length - rawText.trimStart().length
  const start = normalizeEditorText(prefixRange.toString()).length + leadingTrimmed
  return {
    start,
    end: start + text.length,
    text,
  }
}

function chapterVersionSourceLabel(source: ChapterVersion['versionSource']) {
  if (source === 'ai-rewrite') return 'AI 重写'
  if (source === 'pipeline-generate') return '流水线生成'
  if (source === 'version-restore') return '历史恢复'
  return '手动保存'
}

export default function Writing({ novelId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const { chapters, currentChapterId, currentNovel, setChapters, setCurrentChapterId, setCurrentNovel, updateChapter } = useNovelStore()
  const clearStream = useTaskStore((state) => state.clearStream)
  const {
    activeGeneration,
    lastGenerationByChapter,
    startGeneration,
    updateGenerationTask,
    updateGenerationStage,
    completeGeneration,
  } = useWritingViewStore()
  const editorRef = useRef<HTMLDivElement>(null)
  const saveCoordinatorRef = useRef(createChapterSaveCoordinator())
  const currentChapterIdRef = useRef<number | null>(null)
  const chapterIdsRef = useRef(new Set<number>())
  const chapterListRequestRef = useRef(0)
  const chapterSelectionRequestRef = useRef(0)
  const chapterDetailRequestRef = useRef(0)
  const versionHistoryRequestRef = useRef(0)
  const routeChapterFocusRef = useRef<number | null>(null)
  const routeChapterRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const initializedRef = useRef(false)
  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])
  const historyBaselineRef = useRef('')
  const lastHistoryAtRef = useRef(0)
  const generationBaselineRef = useRef('')
  const generationPreflightRef = useRef<{ ready: boolean; messages: string[] } | null>(null)
  const generationStartingRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [storyMemory, setStoryMemory] = useState<StoryMemorySnapshot | null>(null)
  const [foreshadowSnapshot, setForeshadowSnapshot] = useState<ForeshadowSnapshot | null>(null)
  const [foreshadowLedger, setForeshadowLedger] = useState<ForeshadowLedgerEntry[]>([])
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [storyItems, setStoryItems] = useState<StoryItem[]>([])
  const [preserveConstraintLabels, setPreserveConstraintLabels] = useState<HardConstraintSourceLabel[]>([])
  const [chapterSegments, setChapterSegments] = useState<ChapterSegment[]>([])
  const [storyFacts, setStoryFacts] = useState<StoryFact[]>([])
  const [storyVolumes, setStoryVolumes] = useState<StoryVolume[]>([])
  const [chapterCharacters, setChapterCharacters] = useState<Character[]>([])
  const [updatingRevealConstraints, setUpdatingRevealConstraints] = useState(false)
  const [updatingForeshadowWriteback, setUpdatingForeshadowWriteback] = useState(false)
  const [aiResult, setAiResult] = useState<AiCheckPayload | null>(null)
  const [qualityDashboard, setQualityDashboard] = useState<QualityDashboardData | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [chapterContextPreview, setChapterContextPreview] = useState<ChapterContextPreview | null>(null)
  const [generationExecutionModeOverride, setGenerationExecutionModeOverride] = useState<AiExecutionMode | 'follow_default'>('follow_default')
  const [savingAiMode, setSavingAiMode] = useState(false)
  const [publishCheck, setPublishCheck] = useState<ChapterPublishCheck | null>(null)
  const [latestPipelineTask, setLatestPipelineTask] = useState<Task | null>(null)
  const [livePipelineSnapshot, setLivePipelineSnapshot] = useState<WritingPipelineSnapshot | null>(null)
  const [gateReportExpanded, setGateReportExpanded] = useState(false)
  const [selectedSnippet, setSelectedSnippet] = useState<TextSelectionSnapshot | null>(null)
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false)
  const [rewriteRequirements, setRewriteRequirements] = useState('')
  const [rewritingSelection, setRewritingSelection] = useState(false)
  const [optimizingChapter, setOptimizingChapter] = useState(false)
  const [applyingOptimizedChapter, setApplyingOptimizedChapter] = useState(false)
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false)
  const [optimizeRequirements, setOptimizeRequirements] = useState('')
  const [optimizationResult, setOptimizationResult] = useState<ChapterOptimizeResult | null>(null)
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false)
  const [chapterVersions, setChapterVersions] = useState<ChapterVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [insightPanelOpen, setInsightPanelOpen] = useState(false)
  // 正文优先：修订建议/验收提示默认折叠在编辑器下方，避免把正文挤出首屏。
  const [advisoryPanelOpen, setAdvisoryPanelOpen] = useState(false)
  // 主链路失败提示常驻编辑器区域，替代一闪而过的 message.error。
  const [actionError, setActionError] = useState<WritingActionError | null>(null)
  const generateRetryRef = useRef<() => void>(() => {})
  const resumeRetryRef = useRef<() => void>(() => {})
  const routeChapterId = useMemo(() => parseRouteId(searchParams.get('chapterId')), [searchParams])
  const creativeStageId = useMemo(() => parseRouteId(searchParams.get('stageId')), [searchParams])
  const activeWritingRoute = useMemo<WritingRouteKey>(() => {
    const routeKey = location.pathname.split('/').filter(Boolean)[3]
    return routeKey === 'context' || routeKey === 'review' || routeKey === 'history' ? routeKey : 'editor'
  }, [location.pathname])
  const storySettings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const defaultAiExecutionMode = storySettings.aiDefaultMode
  const effectiveAiExecutionMode = generationExecutionModeOverride === 'follow_default'
    ? defaultAiExecutionMode
    : generationExecutionModeOverride
  const isHistoryRoute = activeWritingRoute === 'history'
  const selectedVersion = useMemo(
    () => chapterVersions.find((version) => version.id === selectedVersionId) || chapterVersions[0] || null,
    [chapterVersions, selectedVersionId],
  )
  const dueForeshadowItems = useMemo(() => {
    if (!foreshadowSnapshot) return []
    return [
      ...foreshadowSnapshot.overdue.map((item) => `超期 · ${item.title} · 目标 ${formatChapterNumber(item.targetPayoffChapter)}${item.payoffCondition ? ` · 条件：${item.payoffCondition}` : ''}${item.warningText ? ` · ${item.warningText}` : ''}`),
      ...foreshadowSnapshot.dueSoon.map((item) => `到期 · ${item.title} · 目标 ${formatChapterNumber(item.targetPayoffChapter)}${item.payoffCondition ? ` · 条件：${item.payoffCondition}` : ''}`),
    ].slice(0, 8)
  }, [foreshadowSnapshot])

  useEffect(() => {
    void WRITING_ROUTE_LOADERS[activeWritingRoute]().catch(console.error)

    const preloadTargets = (Object.keys(WRITING_ROUTE_LOADERS) as WritingRouteKey[])
      .filter((routeKey) => routeKey !== activeWritingRoute)

    const timer = window.setTimeout(() => {
      preloadTargets.forEach((routeKey) => {
        void WRITING_ROUTE_LOADERS[routeKey]().catch(console.error)
      })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [activeWritingRoute])

  useEffect(() => { currentChapterIdRef.current = currentChapterId }, [currentChapterId])
  useEffect(() => { chapterIdsRef.current = new Set(chapters.map((chapter) => chapter.id)) }, [chapters])
  useEffect(() => {
    if (!currentChapter) return
    const chapterRecord = currentChapter as unknown as Record<string, unknown>
    const persisted = parseAiCheck(currentChapter.aiScoreJson ?? chapterRecord.ai_score_json)
    if (persisted) setAiResult(persisted)
  }, [currentChapter])

  useEffect(() => {
    if (!publishCheck) return
    if (publishCheck.gateLevel !== 'pass') {
      setGateReportExpanded(true)
    }
  }, [publishCheck])

  const clearChapterArtifacts = useCallback(() => {
    setTimelineEvents([])
    setStoryItems([])
    setChapterSegments([])
    setAiResult(null)
    setForeshadowSnapshot(null)
    setChapterContextPreview(null)
    setPublishCheck(null)
    setGateReportExpanded(false)
    setSelectedSnippet(null)
    setActionError(null)
  }, [])

  const resetEditorHistory = useCallback((nextText: string) => {
    undoStackRef.current = []
    redoStackRef.current = []
    historyBaselineRef.current = normalizeEditorText(nextText)
    lastHistoryAtRef.current = Date.now()
  }, [])

  const recordUndoSnapshot = useCallback((nextText: string) => {
    const normalized = normalizeEditorText(nextText)
    const previousBaseline = historyBaselineRef.current
    if (normalized === previousBaseline) return

    const now = Date.now()
    const shouldCommit = !previousBaseline
      || (now - lastHistoryAtRef.current) > 700
      || Math.abs(normalized.length - previousBaseline.length) > 120

    if (shouldCommit && previousBaseline) {
      undoStackRef.current = [...undoStackRef.current.slice(-59), previousBaseline]
    }

    historyBaselineRef.current = normalized
    lastHistoryAtRef.current = now
    redoStackRef.current = []
  }, [])

  const refreshVersionHistory = useCallback(async (
    chapterId: number,
    isCurrent: () => boolean = () => true,
  ) => {
    const requestId = ++versionHistoryRequestRef.current
    setVersionHistoryLoading(true)
    try {
      const versions = await window.electron.chapter.listVersions(chapterId)
      if (versionHistoryRequestRef.current !== requestId || !isCurrent()) return
      setChapterVersions(versions)
      setSelectedVersionId((current) => current && versions.some((item) => item.id === current)
        ? current
        : versions[0]?.id || null)
    } finally {
      if (versionHistoryRequestRef.current === requestId && isCurrent()) setVersionHistoryLoading(false)
    }
  }, [])

  const refreshMeta = useCallback(async () => {
    const [report, memory] = await Promise.all([
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getStoryMemory(novelId),
    ])
    setConsistencyReport(report); setStoryMemory(memory)
  }, [novelId])

  const refreshQualityDashboard = useCallback(async () => {
    try {
      setQualityDashboard(await window.electron.quality.getDashboard(novelId))
    } catch (error) {
      console.error('Failed to load quality dashboard snapshot', error)
    }
  }, [novelId])

  const refreshInfoGapAssets = useCallback(async () => {
    try {
      const [factRows, volumeRows, characterRows] = await Promise.all([
        window.electron.storyFact.list(novelId),
        window.electron.structure.listVolumes(novelId),
        window.electron.character.list(novelId),
      ])
      setStoryFacts(factRows)
      setStoryVolumes(volumeRows)
      setChapterCharacters(characterRows)
    } catch (error) {
      console.error('Failed to load info-gap board assets', error)
    }
  }, [novelId])

  const refreshForeshadowSnapshot = useCallback(async (
    chapter?: Chapter | null,
    isCurrent: () => boolean = () => true,
  ) => {
    if (!chapter) {
      if (isCurrent()) setForeshadowSnapshot(null)
      return
    }
    try {
      const snapshot = await window.electron.thread.getForeshadowSnapshot(novelId, chapter.chapterNum)
      if (isCurrent()) setForeshadowSnapshot(snapshot)
    } catch (error) {
      console.error('Failed to load foreshadow snapshot', error)
      if (isCurrent()) setForeshadowSnapshot(null)
    }
  }, [novelId])

  const refreshForeshadowLedger = useCallback(async () => {
    try {
      setForeshadowLedger(await window.electron.foreshadow.listLedger(novelId))
    } catch (error) {
      console.error('Failed to load foreshadow ledger', error)
      setForeshadowLedger([])
    }
  }, [novelId])

  const refreshChapterLinks = useCallback(async (
    chapter?: Chapter | null,
    isCurrent: () => boolean = () => true,
  ) => {
    if (!chapter) {
      if (isCurrent()) {
        setTimelineEvents([])
        setStoryItems([])
      }
      return
    }

    const eventPage = await window.electron.timeline.query({
      novelId,
      chapterId: chapter.id,
      page: 1,
      pageSize: 200,
      sortBy: 'timeSortValue',
      sortDirection: 'asc',
    })
    const linkedItemIds = [...new Set(eventPage.items.flatMap((event) => parseNumberArray(event.linkedItemIdsJson)))]
    const itemRows = await Promise.all(linkedItemIds.map((id) => window.electron.item.get(id)))

    if (!isCurrent()) return
    setTimelineEvents(eventPage.items)
    setStoryItems(itemRows.filter((item): item is StoryItem => Boolean(item)))
  }, [novelId])

  const refreshContextStatus = useCallback(async () => {
    setContextStatus(await window.electron.novel.getContextStatus(novelId))
  }, [novelId])

  const refreshChapterContextPreview = useCallback(async (
    chapter?: Chapter | null,
    isCurrent: () => boolean = () => true,
  ) => {
    if (!chapter) {
      if (isCurrent()) setChapterContextPreview(null)
      return
    }
    try {
      const preview = await window.electron.chapter.getContextPreview(chapter.id, {
        executionMode: effectiveAiExecutionMode,
        preserveConstraintLabels,
        stageId: creativeStageId || undefined,
      })
      if (isCurrent()) setChapterContextPreview(preview)
    } catch (error) {
      console.error('Failed to load chapter context preview', error)
      if (isCurrent()) setChapterContextPreview(null)
    }
  }, [creativeStageId, effectiveAiExecutionMode, preserveConstraintLabels])

  const refreshPublishCheck = useCallback(async (
    chapterId: number,
    isCurrent: () => boolean = () => true,
  ) => {
    const nextCheck = await window.electron.chapter.runPublishCheck(chapterId)
    if (!isCurrent()) return
    setPublishCheck(nextCheck)
    setCurrentChapter((current) => current && current.id === chapterId
      ? { ...current, contractAuditJson: JSON.stringify(nextCheck.contractAudit) }
      : current)
  }, [])

  const refreshLatestPipelineTask = useCallback(async (
    chapterId?: number,
    isCurrent: () => boolean = () => true,
  ) => {
    if (!chapterId) {
      if (isCurrent()) setLatestPipelineTask(null)
      return
    }
    try {
      const task = await window.electron.task.getLatestChapterPipeline(chapterId)
      if (isCurrent()) setLatestPipelineTask(task)
    } catch {
      if (isCurrent()) setLatestPipelineTask(null)
    }
  }, [])

  const refreshChapter = useCallback(async (chapterId: number) => {
    const requestId = ++chapterDetailRequestRef.current
    const isCurrent = () => chapterDetailRequestRef.current === requestId
      && currentChapterIdRef.current === chapterId
    clearChapterArtifacts()
    setLivePipelineSnapshot(null)
    const [full, segments] = await Promise.all([
      window.electron.chapter.get(chapterId),
      window.electron.structure.listSegments(chapterId),
    ])
    if (!full || !isCurrent()) return
    setChapterSegments(segments)
    setCurrentChapter(full)
    const fullRecord = full as unknown as Record<string, unknown>
    setAiResult(parseAiCheck(full.aiScoreJson ?? fullRecord.ai_score_json))
    setContent(full.content || '')
    setWordCount(countWords(full.content || ''))
    resetEditorHistory(full.content || '')
    updateChapter(chapterId, full)
    writePlainEditorText(editorRef.current, full.content)
    await Promise.all([
      refreshPublishCheck(chapterId, isCurrent),
      refreshContextStatus(),
      refreshChapterLinks(full, isCurrent),
      refreshForeshadowSnapshot(full, isCurrent),
      refreshForeshadowLedger(),
      refreshLatestPipelineTask(chapterId, isCurrent),
    ])
  }, [clearChapterArtifacts, refreshChapterLinks, refreshContextStatus, refreshForeshadowLedger, refreshForeshadowSnapshot, refreshLatestPipelineTask, refreshPublishCheck, resetEditorHistory, updateChapter])

  const loadChapters = useCallback(async (
    preferredChapterId?: number,
    options: { selectChapter?: boolean } = {},
  ) => {
    const selectChapter = options.selectChapter !== false
    const listRequestId = ++chapterListRequestRef.current
    const selectionRequestId = selectChapter ? ++chapterSelectionRequestRef.current : null
    const list = await window.electron.chapter.list(novelId)
    if (chapterListRequestRef.current === listRequestId) setChapters(list)
    if (!selectChapter || chapterSelectionRequestRef.current !== selectionRequestId) return
    if (list.length === 0) {
      currentChapterIdRef.current = null
      chapterDetailRequestRef.current += 1
      resetEditorHistory('')
      setCurrentChapter(null); setCurrentChapterId(null); setContent(''); setWordCount(0); setPublishCheck(null); setLatestPipelineTask(null); setLivePipelineSnapshot(null); setChapterSegments([]); setTimelineEvents([]); setStoryItems([]); setForeshadowSnapshot(null); void refreshContextStatus().catch(console.error); return
    }
    const target = list.find((chapter) => chapter.id === (preferredChapterId ?? currentChapterIdRef.current)) || list[0]
    currentChapterIdRef.current = target.id
    setCurrentChapterId(target.id)
    await refreshChapter(target.id)
  }, [novelId, refreshChapter, refreshContextStatus, resetEditorHistory, setChapters, setCurrentChapterId])

  const refreshBackgroundChapter = useCallback(async (chapterId: number) => {
    await loadChapters(undefined, { selectChapter: false })
    if (currentChapterIdRef.current === chapterId) await refreshChapter(chapterId)
  }, [loadChapters, refreshChapter])

  const handleSelectChapter = useCallback(async (chapterId: number) => {
    chapterSelectionRequestRef.current += 1
    currentChapterIdRef.current = chapterId
    setCurrentChapterId(chapterId)
    setAiResult(null)
    try {
      await refreshChapter(chapterId)
    } catch (error) {
      if (currentChapterIdRef.current !== chapterId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }
  }, [refreshChapter, setCurrentChapterId])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    routeChapterFocusRef.current = routeChapterId

    let alive = true
    void (async () => {
      setLoading(true)
      setRefreshing(false)
      try {
        // 章节列表是首屏必需数据；一致性、质量和素材快照属于辅助信息，
        // 不应因为其中一个接口慢或暂时不可用而把正文工作台锁在加载动画里。
        await loadChapters(routeChapterId || undefined)
        if (!alive) return
        loadedOnceRef.current = true
        setLoading(false)
        setRefreshing(false)

        void Promise.allSettled([
          refreshMeta(),
          refreshContextStatus(),
          refreshQualityDashboard(),
          refreshInfoGapAssets(),
          refreshForeshadowLedger(),
        ]).then((results) => {
          results.forEach((result) => {
            if (result.status === 'rejected') console.error('Failed to refresh writing workspace metadata', result.reason)
          })
        })
      } catch (error) {
        if (alive) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.loadFailed'))
        }
      } finally {
        if (alive && !loadedOnceRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    })()
    return () => {
      alive = false
      // React StrictMode 会在开发环境中先清理一次 effect，再重新执行。
      // 如果首次加载尚未完成，必须允许下一次 effect 接管请求，否则空章节项目会永久停在 loading。
      if (!loadedOnceRef.current) initializedRef.current = false
    }
  }, [loadChapters, refreshContextStatus, refreshForeshadowLedger, refreshInfoGapAssets, refreshMeta, refreshQualityDashboard, routeChapterId])

  useEffect(() => {
    if (!routeChapterId || routeChapterFocusRef.current === routeChapterId) return
    const requestId = ++routeChapterRequestRef.current
    routeChapterFocusRef.current = routeChapterId
    if (loadedOnceRef.current) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    void loadChapters(routeChapterId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }).finally(() => {
      if (routeChapterRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    })
  }, [loadChapters, routeChapterId])

  useEffect(() => {
    const unsubscribe = window.electron.on('chapter:generation-progress', (data: unknown) => {
      const payload = data as ChapterGenerationProgressEvent
      if (!Number.isSafeInteger(payload?.chapterId) || !chapterIdsRef.current.has(payload.chapterId)) return
      if (!['running', 'success', 'failed', 'cancelled'].includes(payload.status)) return
      if (payload.pipeline && currentChapterIdRef.current === payload.chapterId) setLivePipelineSnapshot(payload.pipeline)
      if (payload.taskId) {
        updateGenerationTask({ chapterId: payload.chapterId, taskId: payload.taskId })
      }
      updateGenerationStage({
        chapterId: payload.chapterId,
        taskId: payload.taskId,
        streamTaskId: payload.streamTaskId,
        stage: payload.stage,
        status: payload.status === 'failed' ? 'failed' : 'running',
        label: payload.label,
        detail: payload.detail,
      })

      if (payload.status === 'success' && payload.stage === 'completed') {
        if (payload.streamTaskId) clearStream(payload.streamTaskId)
        void (async () => {
          await Promise.all([
            refreshBackgroundChapter(payload.chapterId),
            refreshMeta(),
            refreshQualityDashboard(),
          ])
          const latestChapter = await window.electron.chapter.get(payload.chapterId)
          const latestContent = normalizeEditorText(latestChapter?.content || '')
          const hasVisibleContentChange = latestContent !== generationBaselineRef.current
          completeGeneration({
            taskId: payload.taskId,
            chapterId: payload.chapterId,
            status: 'success',
            stage: 'completed',
            label: payload.label || '章节流水线已完成',
            detail: hasVisibleContentChange
              ? getUserFacingMessage('writing.pipelineCompleted')
              : '章节流水线已完成，但正文未产生新增内容。请优先检查合同、审校意见与回写草案。',
          })
          message.success(getUserFacingMessage('writing.pipelineCompleted'))
        })().catch((error) => {
          console.error('Failed to refresh completed chapter generation', error)
          completeGeneration({
            taskId: payload.taskId,
            chapterId: payload.chapterId,
            status: 'success',
            stage: 'completed',
            label: payload.label || '章节流水线已完成',
            detail: getUserFacingMessage('writing.pipelineCompleted'),
          })
          message.success(getUserFacingMessage('writing.pipelineCompleted'))
        })
        return
      }

      if (payload.status === 'failed' || payload.status === 'cancelled') {
        if (payload.streamTaskId) clearStream(payload.streamTaskId)
        void (async () => {
          await Promise.all([
            refreshBackgroundChapter(payload.chapterId),
            refreshQualityDashboard(),
          ])
        })().catch((error) => {
          console.error('Failed to refresh failed chapter generation', error)
        })
        completeGeneration({
          taskId: payload.taskId,
          chapterId: payload.chapterId,
          status: payload.status === 'cancelled' ? 'cancelled' : 'failed',
          stage: payload.stage,
          label: payload.status === 'cancelled' ? '章节流水线已取消' : '章节流水线执行失败',
          detail: payload.detail || (payload.status === 'cancelled'
            ? getUserFacingMessage('writing.generateCancelled')
            : getUserFacingMessage('writing.generateFailed')),
          error: payload.status === 'failed'
            ? (payload.detail || getUserFacingMessage('writing.generateFailed'))
            : null,
        })
        if (payload.status === 'cancelled') {
          message.info(getUserFacingMessage('writing.generateCancelled'))
        } else if (currentChapterIdRef.current === payload.chapterId) {
          setActionError({
            title: '章节流水线执行失败',
            message: payload.detail || getUserFacingMessage('writing.generateFailed'),
            retry: () => generateRetryRef.current(),
          })
        } else {
          message.error(getUserFacingMessage('writing.generateFailed'))
        }
      }
    })
    return unsubscribe
  }, [clearStream, completeGeneration, refreshBackgroundChapter, refreshMeta, refreshQualityDashboard, updateGenerationStage, updateGenerationTask])

  useEffect(() => {
    if (!isHistoryRoute || !currentChapter) return
    const chapterId = currentChapter.id
    const isCurrent = () => currentChapterIdRef.current === chapterId && isHistoryRoute
    void refreshVersionHistory(chapterId, isCurrent).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [currentChapter, isHistoryRoute, refreshVersionHistory])

  useEffect(() => {
    if (isHistoryRoute && currentChapter) return
    versionHistoryRequestRef.current += 1
    setVersionHistoryLoading(false)
    setChapterVersions([])
    setSelectedVersionId(null)
  }, [currentChapter, isHistoryRoute])

  useEffect(() => {
    if (!currentChapter) return
    const chapterId = currentChapter.id
    const isCurrent = () => currentChapterIdRef.current === chapterId
    void refreshChapterContextPreview(currentChapter, isCurrent)
  }, [currentChapter, effectiveAiExecutionMode, refreshChapterContextPreview])

  // Fine-grained subscription: only this task's stream status can rerun the
  // effect, instead of every chunk of every stream re-rendering the page.
  const activeStreamStatus = useTaskStore((state) => (
    activeGeneration.taskId ? state.streams[activeGeneration.taskId]?.status ?? null : null
  ))

  useEffect(() => {
    if (activeGeneration.status !== 'running' || !activeGeneration.taskId || !activeGeneration.chapterId) return
    if (!activeStreamStatus) return
    const stream = { taskId: activeGeneration.taskId, status: activeStreamStatus }
    if (stream.status === 'completed') {
      const chapterId = activeGeneration.chapterId
      clearStream(stream.taskId)
      void (async () => {
        await Promise.all([refreshBackgroundChapter(chapterId), refreshMeta(), refreshQualityDashboard()])
        const latestChapter = await window.electron.chapter.get(chapterId)
        const latestContent = normalizeEditorText(latestChapter?.content || '')
        const hasVisibleContentChange = latestContent !== generationBaselineRef.current
        completeGeneration({
          taskId: stream.taskId,
          chapterId,
          status: 'success',
          stage: 'completed',
          label: '章节流水线已完成',
          detail: hasVisibleContentChange
            ? getUserFacingMessage('writing.pipelineCompleted')
            : '章节流水线已完成，但正文未产生新增内容。请优先检查场景计划与审校建议。',
        })
        message.success(getUserFacingMessage('writing.pipelineCompleted'))
      })().catch((error) => {
        console.error('Failed to refresh completed chapter stream', error)
        completeGeneration({
          taskId: stream.taskId,
          chapterId,
          status: 'success',
          stage: 'completed',
          label: '章节流水线已完成',
          detail: getUserFacingMessage('writing.pipelineCompleted'),
        })
        message.success(getUserFacingMessage('writing.pipelineCompleted'))
      })
    }
    if (stream.status === 'failed') {
      const chapterId = activeGeneration.chapterId
      clearStream(stream.taskId)
      void (async () => {
        await Promise.all([
          refreshBackgroundChapter(chapterId),
          refreshQualityDashboard(),
        ])
      })().catch((error) => {
        console.error('Failed to refresh failed chapter stream', error)
      })
      completeGeneration({
        taskId: stream.taskId,
        chapterId,
        status: 'failed',
        stage: activeGeneration.stage,
        label: '章节流水线执行失败',
        detail: activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
        error: activeGeneration.error || activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
      })
      if (currentChapterIdRef.current === chapterId) {
        setActionError({
          title: '章节流水线执行失败',
          message: activeGeneration.error || activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
          retry: () => generateRetryRef.current(),
        })
      } else {
        message.error(getUserFacingMessage('writing.generateFailed'))
      }
    }
    if (stream.status === 'cancelled') {
      const chapterId = activeGeneration.chapterId
      clearStream(stream.taskId)
      void (async () => {
        await refreshBackgroundChapter(chapterId)
      })().catch((error) => {
        console.error('Failed to refresh cancelled chapter stream', error)
      })
      completeGeneration({
        taskId: stream.taskId,
        chapterId,
        status: 'cancelled',
        stage: activeGeneration.stage,
        label: '章节流水线已取消',
        detail: getUserFacingMessage('writing.generateCancelled'),
      })
      message.info(getUserFacingMessage('writing.generateCancelled'))
    }
  }, [activeGeneration, activeStreamStatus, clearStream, completeGeneration, refreshBackgroundChapter, refreshMeta, refreshQualityDashboard])

  const persistChapter = useCallback(async (
    chapterId: number,
    text: string,
    versionSource: 'manual-save' | 'ai-rewrite' = 'manual-save',
  ) => {
    const nextWordCount = countWords(text)
    await window.electron.chapter.update(chapterId, {
      content: text,
      wordCount: nextWordCount,
    }, {
      versionSource,
    })
    await refreshContextStatus()
    if (currentChapterIdRef.current === chapterId) {
      await refreshPublishCheck(chapterId)
    }
    updateChapter(chapterId, { content: text, wordCount: nextWordCount })
  }, [refreshContextStatus, refreshPublishCheck, updateChapter])

  const saveNow = useCallback((
    chapterId: number,
    text: string,
    versionSource: 'manual-save' | 'ai-rewrite' = 'manual-save',
  ) => saveCoordinatorRef.current.runNow(
    chapterId,
    () => persistChapter(chapterId, text, versionSource),
  ), [persistChapter])

  const queueSave = useCallback((
    chapterId: number,
    text: string,
    versionSource: 'manual-save' | 'ai-rewrite' = 'manual-save',
  ) => {
    saveCoordinatorRef.current.schedule(
      chapterId,
      () => persistChapter(chapterId, text, versionSource),
    )
  }, [persistChapter])

  useEffect(() => () => {
    void saveCoordinatorRef.current.flushAll().catch((error) => {
      console.error('Failed to flush pending chapter saves', error)
    })
    clearChapterArtifacts()
  }, [clearChapterArtifacts])

  const handleContentChange = (event: React.FormEvent<HTMLDivElement>) => {
    if ((currentChapter?.segmentCount || 0) > 1) return
    const text = event.currentTarget.innerText || ''
    recordUndoSnapshot(text)
    setContent(text); setWordCount(countWords(text))
    if (currentChapter) queueSave(currentChapter.id, text)
  }

  const syncSelectedSnippet = useCallback(() => {
    if (!editorRef.current || (currentChapter?.segmentCount || 0) > 1) {
      setSelectedSnippet(null)
      return
    }
    setSelectedSnippet(getSelectionSnapshot(editorRef.current))
  }, [currentChapter?.segmentCount])

  const applyChapterContent = useCallback((
    nextText: string,
    versionSource: 'manual-save' | 'ai-rewrite' = 'manual-save',
  ) => {
    const normalized = normalizeEditorText(nextText)
    const nextWordCount = countWords(normalized)
    setContent(normalized)
    setWordCount(nextWordCount)
    setSelectedSnippet(null)
    writePlainEditorText(editorRef.current, normalized)
    if (currentChapter) {
      historyBaselineRef.current = normalized
      lastHistoryAtRef.current = Date.now()
      queueSave(currentChapter.id, normalized, versionSource)
      updateChapter(currentChapter.id, { content: normalized, wordCount: nextWordCount })
    }
  }, [currentChapter, queueSave, updateChapter])

  const handleUndoEditor = useCallback(() => {
    if ((currentChapter?.segmentCount || 0) > 1) return
    const previous = undoStackRef.current.pop()
    if (typeof previous !== 'string') return
    redoStackRef.current = [...redoStackRef.current, normalizeEditorText(editorRef.current?.innerText || content)]
    historyBaselineRef.current = previous
    applyChapterContent(previous)
  }, [applyChapterContent, content, currentChapter?.segmentCount])

  const handleRedoEditor = useCallback(() => {
    if ((currentChapter?.segmentCount || 0) > 1) return
    const next = redoStackRef.current.pop()
    if (typeof next !== 'string') return
    undoStackRef.current = [...undoStackRef.current, normalizeEditorText(editorRef.current?.innerText || content)]
    historyBaselineRef.current = next
    applyChapterContent(next)
  }, [applyChapterContent, content, currentChapter?.segmentCount])

  const navigateToWritingRoute = useCallback((routeKey: WritingRouteKey) => {
    const search = searchParams.toString()
    navigate({
      pathname: buildWorkspaceRoute(novelId, `writing/${routeKey}`),
      search: search ? `?${search}` : '',
    })
  }, [navigate, novelId, searchParams])

  const handleRestoreVersion = useCallback(async () => {
    if (!selectedVersionId || !currentChapter) return
    try {
      await window.electron.chapter.restoreVersion(selectedVersionId)
      await Promise.all([
        loadChapters(currentChapter.id),
        refreshMeta(),
        refreshContextStatus(),
        refreshVersionHistory(currentChapter.id),
      ])
      message.success(getUserFacingMessage('writing.versionRestored'))
      notifyWorkspaceMutation()
    } catch (error: unknown) {
      message.error(getErrorMessage(error, 'writing.restoreVersionFailed'))
    }
  }, [currentChapter, loadChapters, notifyWorkspaceMutation, refreshContextStatus, refreshMeta, refreshVersionHistory, selectedVersionId])

  useEffect(() => {
    registerSaveHandler(() => {
      if (!currentChapter || (currentChapter.segmentCount || 0) > 1) return
      const latestText = normalizeEditorText(editorRef.current?.innerText || content)
      void saveNow(currentChapter.id, latestText).then(() => {
        message.success(getUserFacingMessage('writing.saved'))
      }).catch((error) => {
        console.error(error)
        message.error(getErrorMessage(error, 'writing.saveFailed'))
      })
    })

    return () => registerSaveHandler(null)
  }, [content, currentChapter, registerSaveHandler, saveNow])

  useEffect(() => {
    registerEscapeHandler(() => {
      if (optimizeModalOpen) {
        setOptimizeModalOpen(false)
        return
      }
      if (rewriteModalOpen) {
        setRewriteModalOpen(false)
        return
      }
      if (isHistoryRoute) {
        navigateToWritingRoute('editor')
      }
    })

    return () => registerEscapeHandler(null)
  }, [isHistoryRoute, navigateToWritingRoute, optimizeModalOpen, registerEscapeHandler, rewriteModalOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((currentChapter?.segmentCount || 0) > 1) return
      const isMeta = event.metaKey || event.ctrlKey
      if (!isMeta) return

      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        handleUndoEditor()
        return
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        handleRedoEditor()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentChapter?.segmentCount, handleRedoEditor, handleUndoEditor])

  const handleGenerateContent = useCallback(async () => {
    if (!currentChapter) return message.warning(getUserFacingMessage('writing.selectChapterFirst'))
    if (generationStartingRef.current || activeGeneration.status === 'running') return
    const preflight = generationPreflightRef.current
    if (preflight && !preflight.ready) {
      Modal.warning({
        title: '当前章节暂不适合生成',
        okText: '知道了',
        content: (
          <div className="novel-note-list">
            {preflight.messages.slice(0, 6).map((item) => (
              <div key={item} className="novel-note-list__item">{item}</div>
            ))}
          </div>
        ),
      })
      return
    }
    generationStartingRef.current = true
    generationBaselineRef.current = normalizeEditorText(currentChapter.content || content)
    setActionError(null)
    startGeneration({ chapterId: currentChapter.id })
    updateGenerationStage({
      chapterId: currentChapter.id,
      stage: 'planning',
      label: '正在启动章节流水线',
      detail: `正在创建任务，并按「${getAiExecutionModeLabel(effectiveAiExecutionMode)}」模式准备本章场景计划与上下文注入。`,
    })
    try {
      const taskId = await window.electron.chapter.generateContent(currentChapter.id, {
        executionMode: effectiveAiExecutionMode,
        preserveConstraintLabels,
        stageId: creativeStageId || undefined,
      })
      updateGenerationTask({ chapterId: currentChapter.id, taskId })
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'writing.configureModelFirst')
      completeGeneration({
        chapterId: currentChapter.id,
        status: 'failed',
        stage: 'planning',
        label: '章节流水线启动失败',
        detail: errorMessage,
        error: errorMessage,
      })
      setActionError({
        title: '章节流水线启动失败',
        message: errorMessage,
        retry: () => generateRetryRef.current(),
      })
    } finally {
      generationStartingRef.current = false
    }
  }, [
    activeGeneration.status,
    completeGeneration,
    content,
    currentChapter,
    creativeStageId,
    effectiveAiExecutionMode,
    preserveConstraintLabels,
    startGeneration,
    updateGenerationStage,
    updateGenerationTask,
  ])

  useEffect(() => {
    generateRetryRef.current = () => void handleGenerateContent()
  }, [handleGenerateContent])

  const persistedPipelineSnapshot = useMemo(
    () => parsePipelineSnapshot(latestPipelineTask?.progressJson),
    [latestPipelineTask],
  )
  const currentPipelineSnapshot = useMemo(() => {
    if (livePipelineSnapshot && currentChapter && livePipelineSnapshot.chapterId === currentChapter.id) {
      return livePipelineSnapshot
    }
    if (persistedPipelineSnapshot && currentChapter && persistedPipelineSnapshot.chapterId === currentChapter.id) {
      return persistedPipelineSnapshot
    }
    return null
  }, [currentChapter, livePipelineSnapshot, persistedPipelineSnapshot])
  const resumablePartialContent = useMemo(
    () => currentPipelineSnapshot?.partialContent?.trim() || '',
    [currentPipelineSnapshot?.partialContent],
  )
  const hasResumablePartialContent = Boolean(
    currentChapter
    && resumablePartialContent
    && (currentPipelineSnapshot?.status === 'failed' || currentPipelineSnapshot?.status === 'cancelled'),
  )

  const handleResumePartialContent = useCallback(async () => {
    if (!currentChapter || !latestPipelineTask?.id || !hasResumablePartialContent) return
    if (generationStartingRef.current || activeGeneration.status === 'running') return
    generationStartingRef.current = true
    generationBaselineRef.current = normalizeEditorText(resumablePartialContent)
    setActionError(null)
    startGeneration({ chapterId: currentChapter.id, taskId: latestPipelineTask.id })
    updateGenerationStage({
      chapterId: currentChapter.id,
      taskId: latestPipelineTask.id,
      stage: 'drafting',
      label: '正在从断点继续',
      detail: '系统将基于已保留正文继续补齐本章，不会从头重写前文。',
    })
    try {
      const taskId = await window.electron.chapter.resumeContent(latestPipelineTask.id)
      updateGenerationTask({ chapterId: currentChapter.id, taskId })
      message.success(getUserFacingMessage('writing.resumedFromDraft'))
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'writing.generateFailed')
      completeGeneration({
        chapterId: currentChapter.id,
        status: 'failed',
        stage: 'drafting',
        label: '断点续写启动失败',
        detail: errorMessage,
        error: errorMessage,
      })
      setActionError({
        title: '断点续写启动失败',
        message: errorMessage,
        retry: () => resumeRetryRef.current(),
      })
    } finally {
      generationStartingRef.current = false
    }
  }, [activeGeneration.status, completeGeneration, currentChapter, hasResumablePartialContent, latestPipelineTask?.id, resumablePartialContent, startGeneration, updateGenerationStage, updateGenerationTask])

  useEffect(() => {
    resumeRetryRef.current = () => void handleResumePartialContent()
  }, [handleResumePartialContent])

  const handleRestartGeneration = useCallback(async () => {
    await handleGenerateContent()
  }, [handleGenerateContent])

  const handleDefaultAiModeChange = useCallback(async (mode: AiExecutionMode) => {
    if (!currentNovel) return
    setSavingAiMode(true)
    try {
      const payload = buildStorySettingsPayload({
        aiEngine: {
          defaultMode: mode,
        },
      }, currentNovel.settingsJson)
      await window.electron.novel.update(currentNovel.id, {
        settingsJson: JSON.stringify(payload),
      })
      setCurrentNovel({
        ...currentNovel,
        settingsJson: JSON.stringify(payload),
      })
      message.success(getUserFacingMessage('writing.defaultModeChanged', { mode: getAiExecutionModeLabel(mode) }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSavingAiMode(false)
    }
  }, [currentNovel, setCurrentNovel])

  const handleCancelGenerate = async () => {
    if (!activeGeneration.taskId || !activeGeneration.chapterId) return
    await window.electron.task.cancel(activeGeneration.taskId)
    if (activeGeneration.streamTaskId) clearStream(activeGeneration.streamTaskId)
    completeGeneration({
      taskId: activeGeneration.taskId,
      chapterId: activeGeneration.chapterId,
      status: 'cancelled',
      stage: activeGeneration.stage,
      label: '章节流水线已取消',
      detail: getUserFacingMessage('writing.generateCancelled'),
    })
  }

  const handleCompileCurrentChapter = async () => {
    if (!currentChapter) return
    try {
      await window.electron.structure.compileChapter(currentChapter.id)
      await Promise.all([loadChapters(currentChapter.id), refreshMeta(), refreshContextStatus()])
      message.success(getUserFacingMessage('writing.compiled'))
    } catch (error: unknown) {
      message.error(getErrorMessage(error, 'writing.compileFailed'))
    }
  }

  const handleAiCheck = async () => {
    if (!currentChapter) return
    setActionError(null)
    try {
      setAiResult(await window.electron.chapter.aiCheck(currentChapter.id) as AiCheckPayload)
      navigateToWritingRoute('review')
      await refreshQualityDashboard()
    }
    catch (error: unknown) {
      setActionError({
        title: '章节审校失败',
        message: getUserFacingMessage('writing.aiCheckFailed', {
          detail: error instanceof Error ? error.message : '请稍后重试。',
        }),
        retry: () => void handleAiCheck(),
      })
    }
  }

  const handleOpenRewriteModal = () => {
    if (!currentChapter || !selectedSnippet?.text) {
      message.warning(getUserFacingMessage('writing.selectSnippetFirst'))
      return
    }
    setRewriteRequirements('')
    setRewriteModalOpen(true)
  }

  const handleRewriteSelectedText = async () => {
    if (!currentChapter || !selectedSnippet?.text) return
    const latestText = normalizeEditorText(editorRef.current?.innerText || content)
    const before = latestText.slice(0, selectedSnippet.start)
    const after = latestText.slice(selectedSnippet.end)

    setRewritingSelection(true)
    try {
      const rewritten = normalizeEditorText(await window.electron.ai.rewriteParagraph({
        originalParagraph: selectedSnippet.text,
        contextBefore: before.slice(-800),
        specificRequirements: rewriteRequirements.trim() || '保持事件与设定不变，重点修语言自然度、逻辑衔接和人类表达。',
        modelConfigId: currentNovel?.modelConfigId,
        novelId,
        executionMode: effectiveAiExecutionMode,
      }) as string)

      if (!rewritten.trim()) {
        message.warning(getUserFacingMessage('writing.rewriteNoResult'))
        return
      }

      applyChapterContent(`${before}${rewritten}${after}`, 'ai-rewrite')
      setRewriteModalOpen(false)
      navigateToWritingRoute('review')
      message.success(getUserFacingMessage('writing.rewriteApplied'))
    } catch (error: unknown) {
      message.error(getUserFacingMessage('writing.rewriteFailed', {
        detail: error instanceof Error ? error.message : '请稍后重试。',
      }))
    } finally {
      setRewritingSelection(false)
    }
  }

  const handleOptimizeChapter = async () => {
    if (!currentChapter || hasMultiSegments) return
    const latestText = normalizeEditorText(editorRef.current?.innerText || content)
    setOptimizingChapter(true)
    setActionError(null)
    try {
      await saveNow(currentChapter.id, latestText)
      const result = await window.electron.chapter.optimizeContent(currentChapter.id, {
        executionMode: effectiveAiExecutionMode,
        extraRequirements: optimizeRequirements.trim(),
      })
      setOptimizationResult(result)
      setOptimizeModalOpen(true)
      navigateToWritingRoute('review')
    } catch (error: unknown) {
      setActionError({
        title: '整章优化失败',
        message: getErrorMessage(error, 'writing.optimizeFailed'),
        retry: () => void handleOptimizeChapter(),
      })
    } finally {
      setOptimizingChapter(false)
    }
  }

  const handleApplyOptimizedChapter = async () => {
    if (!currentChapter || !optimizationResult?.optimizedContent.trim()) return
    if (
      (optimizationResult.factGuard && !optimizationResult.factGuard.safeToApply)
      || (optimizationResult.qualityGate && !optimizationResult.qualityGate.safeToApply)
    ) {
      message.warning(getUserFacingMessage('writing.optimizeBlockedByQuality'))
      return
    }

    const normalized = normalizeEditorText(optimizationResult.optimizedContent)
    const nextWordCount = countWords(normalized)
    setApplyingOptimizedChapter(true)
    try {
      await saveNow(currentChapter.id, normalized, 'ai-rewrite')
      setContent(normalized)
      setWordCount(nextWordCount)
      setSelectedSnippet(null)
      writePlainEditorText(editorRef.current, normalized)
      historyBaselineRef.current = normalized
      lastHistoryAtRef.current = Date.now()
      await Promise.all([
        refreshQualityDashboard(),
        refreshVersionHistory(currentChapter.id),
      ])
      setOptimizeModalOpen(false)
      setOptimizationResult(null)
      message.success(getUserFacingMessage('writing.optimizeApplied'))
    } catch (error) {
      message.error(getErrorMessage(error, 'writing.optimizeApplyFailed'))
    } finally {
      setApplyingOptimizedChapter(false)
    }
  }

  const handleOpenGateIssue = useCallback((item: ChapterPublishCheck['checklist'][number]) => {
    if (!currentChapter) return
    if (item.relatedPage === 'structure') {
      const params = new URLSearchParams({ chapterId: String(currentChapter.id) })
      if (typeof item.segmentId === 'number') params.set('segmentId', String(item.segmentId))
      navigate(buildWorkspaceRoute(novelId, `structure?${params.toString()}`))
      return
    }
    if (item.relatedPage === 'contracts') {
      navigate(buildWorkspaceRoute(novelId, `contracts?chapterId=${currentChapter.id}`))
      return
    }
    if (item.relatedPage === 'revision') {
      navigate(buildWorkspaceRoute(novelId, 'revision'))
      return
    }
    if (item.relatedPage === 'volume-design') {
      navigate(buildWorkspaceRoute(novelId, 'volume-design'))
      return
    }
    if (item.relatedPage === 'threads') {
      navigate(buildWorkspaceRoute(novelId, 'threads'))
      return
    }
    navigateToWritingRoute('editor')
    message.info(item.status === 'rewrite'
      ? getUserFacingMessage('writing.gateIssueRewriteOpen')
      : getUserFacingMessage('writing.gateIssueOpen'))
  }, [currentChapter, navigate, navigateToWritingRoute, novelId])

  const statusChangeInFlightRef = useRef(false)
  const handleStatusChange = async (status: string) => {
    if (!currentChapter) return
    if (statusChangeInFlightRef.current) return
    statusChangeInFlightRef.current = true
    try {
      await handleStatusChangeInternal(status)
    } finally {
      statusChangeInFlightRef.current = false
    }
  }

  const handleStatusChangeInternal = async (status: string) => {
    if (!currentChapter) return
    if (status === 'final') {
      const nextPublishCheck = await window.electron.chapter.runPublishCheck(currentChapter.id)
      setPublishCheck(nextPublishCheck)
      setCurrentChapter((current) => current && current.id === currentChapter.id
        ? { ...current, contractAuditJson: JSON.stringify(nextPublishCheck.contractAudit) }
        : current)
      await refreshContextStatus()

      if (nextPublishCheck.gateLevel === 'rewrite') {
        const rewriteMessages = collectPublishCheckMessages(nextPublishCheck, 'rewrite')
        const rewriteItem = nextPublishCheck.checklist.find((item) => item.status === 'rewrite')
          Modal.confirm({
            title: '章节必须退回重写',
            content: (
              <div className="novel-note-list novel-note-list--spaced-top">
                <div className="novel-note-list__item">{nextPublishCheck.summary}</div>
                {rewriteMessages.map((item) => <div key={item} className="novel-note-list__item">{item}</div>)}
              </div>
            ),
          okText: '去处理',
          cancelText: '留在当前页',
          onOk: () => {
            if (rewriteItem) handleOpenGateIssue(rewriteItem)
          },
        })
        return
      }

      if (!nextPublishCheck.ready || nextPublishCheck.gateLevel === 'blocker') {
        const blockerMessages = collectPublishCheckMessages(nextPublishCheck, 'blocker')
        Modal.confirm({
          title: '章节验收未通过',
          content: (
            <div className="novel-note-list novel-note-list--spaced-top">
              <div className="novel-note-list__item">{nextPublishCheck.summary}</div>
              {blockerMessages.map((item) => <div key={item} className="novel-note-list__item">{item}</div>)}
            </div>
          ),
          okText: '去处理',
          cancelText: '留在当前页',
          onOk: () => {
            const blockerItem = nextPublishCheck.checklist.find((item) => item.status === 'blocker')
            if (blockerItem) {
              handleOpenGateIssue(blockerItem)
              return
            }
            navigate(buildWorkspaceRoute(novelId, `contracts?chapterId=${currentChapter.id}`))
          },
        })
        return
      }

      if (nextPublishCheck.gateLevel === 'warning' && nextPublishCheck.warningCount > 0) {
        const warningMessages = collectPublishCheckMessages(nextPublishCheck, 'warning')
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '章节验收仍有预警',
            content: (
              <div className="novel-note-list novel-note-list--spaced-top">
                <div className="novel-note-list__item">{nextPublishCheck.summary}</div>
                {warningMessages.map((item) => <div key={item} className="novel-note-list__item">{item}</div>)}
              </div>
            ),
            okText: '仍标记完成',
            cancelText: '继续处理',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          })
        })

        if (!shouldContinue) return
      }
    }

    await window.electron.chapter.update(currentChapter.id, { status: status as Chapter['status'] })
    await Promise.all([loadChapters(currentChapter.id), refreshMeta(), refreshContextStatus()])
  }

  const handleAddChapter = async (volumeId?: number | null) => {
    const nextNum = chapters.length > 0 ? Math.max(...chapters.map((chapter) => chapter.chapterNum)) + 1 : 1
    const targetVolumeId = typeof volumeId === 'number' ? volumeId : currentChapter?.volumeId ?? storyVolumes[0]?.id
    const chapterId = await window.electron.chapter.create(novelId, {
      chapterNum: nextNum,
      title: `第${nextNum}章`,
      status: 'outline',
      ...(targetVolumeId ? { volumeId: targetVolumeId } : {}),
    })
    await Promise.all([loadChapters(chapterId), refreshMeta(), refreshContextStatus()])
    message.success(getUserFacingMessage('writing.chapterCreated'))
  }

  const handleDeleteChapter = async (chapterId: number, event: React.MouseEvent) => {
    event.stopPropagation()
    Modal.confirm({
      title: '确认删除这个章节？',
      content: '删除后章节内容无法恢复。',
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        saveCoordinatorRef.current.cancelScheduled(chapterId)
        await saveCoordinatorRef.current.waitForChapter(chapterId)
        await window.electron.chapter.delete(chapterId)
        await Promise.all([loadChapters(), refreshMeta(), refreshContextStatus()])
      },
    })
  }

  const handleUpdateRevealConstraints = useCallback(async (
    nextAllowedIds: number[],
    nextRevealedIds: number[],
  ) => {
    if (!currentChapter) return
    const normalizedAllowed = normalizeIdArray(nextAllowedIds)
    const normalizedRevealed = normalizeIdArray(nextRevealedIds.filter((id) => normalizedAllowed.includes(id)))
    setUpdatingRevealConstraints(true)
    try {
      await window.electron.chapter.update(currentChapter.id, {
        allowedFactIdsJson: JSON.stringify(normalizedAllowed),
        revealedFactIdsJson: JSON.stringify(normalizedRevealed),
      }, {
        skipStaleTracking: true,
        versionSource: false,
      })
      setCurrentChapter((previous) => (
        previous && previous.id === currentChapter.id
          ? {
              ...previous,
              allowedFactIdsJson: JSON.stringify(normalizedAllowed),
              revealedFactIdsJson: JSON.stringify(normalizedRevealed),
            }
          : previous
      ))
      updateChapter(currentChapter.id, {
        allowedFactIdsJson: JSON.stringify(normalizedAllowed),
        revealedFactIdsJson: JSON.stringify(normalizedRevealed),
      })
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setUpdatingRevealConstraints(false)
    }
  }, [currentChapter, updateChapter])

  const handleCreateForeshadowWriteback = useCallback(async (data: Partial<ForeshadowLedgerEntry>) => {
    if (!currentChapter) return
    setUpdatingForeshadowWriteback(true)
    try {
      const nextRows = await window.electron.foreshadow.upsertLedger(novelId, {
        ...data,
        sourceChapterId: currentChapter.id,
      })
      setForeshadowLedger(nextRows)
      await refreshForeshadowSnapshot(currentChapter)
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('writing.foreshadowCreated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
      throw error
    } finally {
      setUpdatingForeshadowWriteback(false)
    }
  }, [currentChapter, novelId, notifyWorkspaceMutation, refreshForeshadowSnapshot])

  const handlePatchForeshadowWriteback = useCallback(async (id: number, data: Partial<ForeshadowLedgerEntry>) => {
    if (!currentChapter) return
    setUpdatingForeshadowWriteback(true)
    try {
      const nextRows = await window.electron.foreshadow.upsertLedger(novelId, {
        id,
        ...data,
      })
      setForeshadowLedger(nextRows)
      await refreshForeshadowSnapshot(currentChapter)
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('writing.foreshadowUpdated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setUpdatingForeshadowWriteback(false)
    }
  }, [currentChapter, novelId, notifyWorkspaceMutation, refreshForeshadowSnapshot])

  const handleDeleteForeshadowWriteback = useCallback((entry: ForeshadowLedgerEntry) => {
    Modal.confirm({
      title: `删除伏笔「${entry.title}」`,
      content: '删除后会从伏笔账本移除，本章回写记录也会同步消失。',
      okType: 'danger',
      onOk: async () => {
        if (!currentChapter) return
        setUpdatingForeshadowWriteback(true)
        try {
          const nextRows = await window.electron.foreshadow.deleteLedger(novelId, entry.id)
          setForeshadowLedger(nextRows)
          await refreshForeshadowSnapshot(currentChapter)
          notifyWorkspaceMutation()
          message.success(getUserFacingMessage('writing.foreshadowDeleted'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.saveFailed'))
        } finally {
          setUpdatingForeshadowWriteback(false)
        }
      },
    })
  }, [currentChapter, novelId, notifyWorkspaceMutation, refreshForeshadowSnapshot])

  const continuity = useMemo(() => parseContinuity(currentChapter?.continuityStateJson), [currentChapter?.continuityStateJson])
  const scenePlan = useMemo(() => parseScenePlan(currentChapter?.scenePlanJson), [currentChapter?.scenePlanJson])
  const reviewNotes = useMemo(() => parseReviewNotes(currentChapter?.reviewNotesJson), [currentChapter?.reviewNotesJson])
  const bridgePlan = useMemo(() => parseBridgePlan(currentChapter?.bridgePlanJson), [currentChapter?.bridgePlanJson])
  const summaryHealth = useMemo(() => parseSummaryHealth(currentChapter?.summaryHealthJson), [currentChapter?.summaryHealthJson])
  const expressionDedup = useMemo(() => parseExpressionDedup(currentChapter?.expressionDedupJson), [currentChapter?.expressionDedupJson])
  const hookContinuity = useMemo(() => parseHookContinuity(currentChapter?.hookContinuityJson), [currentChapter?.hookContinuityJson])
  const currentContractAudit = useMemo(
    () => normalizeContractAudit(publishCheck?.contractAudit) || parseContractAudit(currentChapter?.contractAuditJson),
    [currentChapter?.contractAuditJson, publishCheck],
  )
  const allowedRevealFactIds = useMemo(
    () => normalizeIdArray(parseNumberArray(currentChapter?.allowedFactIdsJson)),
    [currentChapter?.allowedFactIdsJson],
  )
  const revealedFactIds = useMemo(
    () => normalizeIdArray(parseNumberArray(currentChapter?.revealedFactIdsJson)),
    [currentChapter?.revealedFactIdsJson],
  )
  const currentVolumeTruthStats = useMemo(
    () => computeVolumeTruthRevealStats(currentChapter, storyVolumes, storyFacts),
    [currentChapter, storyFacts, storyVolumes],
  )
  const currentChapterStaleReasons = useMemo(
    () => translateContextChangeReasons(parseStringArray(currentChapter?.staleReasonJson)),
    [currentChapter?.staleReasonJson],
  )
  const worldRulesSummary = useMemo(() => getWorldRulesSummary(currentNovel?.worldRulesJson), [currentNovel?.worldRulesJson])
  const chapterIdToNum = useMemo(() => new Map(chapters.map((chapter) => [chapter.id, chapter.chapterNum])), [chapters])

  const relatedEvents = useMemo(() => {
    if (!currentChapter) return []
    return timelineEvents.filter((event) => {
      if (event.partId && event.partId === currentChapter.partId) return true
      if (event.volumeId && event.volumeId === currentChapter.volumeId) return true
      if (event.chapterStartId === currentChapter.id || event.chapterEndId === currentChapter.id) return true
      const startNum = event.chapterStartId ? chapterIdToNum.get(event.chapterStartId) : undefined
      const endNum = event.chapterEndId ? chapterIdToNum.get(event.chapterEndId) : undefined
      return typeof startNum === 'number' && typeof endNum === 'number'
        ? currentChapter.chapterNum >= startNum && currentChapter.chapterNum <= endNum
        : typeof startNum === 'number'
          ? currentChapter.chapterNum === startNum
          : typeof endNum === 'number'
            ? currentChapter.chapterNum === endNum
            : false
    })
  }, [chapterIdToNum, currentChapter, timelineEvents])

  const relatedEventIds = useMemo(() => new Set(relatedEvents.map((event) => event.id)), [relatedEvents])
  const relatedItems = useMemo(() => storyItems.filter((item) => parseNumberArray(item.linkedTimelineEventIdsJson).some((id) => relatedEventIds.has(id))), [relatedEventIds, storyItems])

  const chapterIssues = useMemo(() => {
    if (!consistencyReport || !currentChapter) return []
    const relatedItemIds = new Set(relatedItems.map((item) => item.id))
    return consistencyReport.issues.filter((issue) =>
      ((issue.entityType === 'chapter' || issue.category === 'continuity') && issue.entityId === currentChapter.id)
      || (issue.entityType === 'timeline' && issue.entityId ? relatedEventIds.has(issue.entityId) : false)
      || (issue.entityType === 'item' && issue.entityId ? relatedItemIds.has(issue.entityId) : false))
  }, [consistencyReport, currentChapter, relatedEventIds, relatedItems])

  const continuityItems = [
    ...(continuity?.plot_progress || []).map((item) => `剧情推进：${item}`),
    ...(continuity?.character_state_changes || []).map((item) => `人物变化：${item}`),
    ...(continuity?.world_state_changes || []).map((item) => `世界变化：${item}`),
    ...(continuity?.open_loops || []).map((item) => `未回收线索：${item}`),
    ...(continuity?.continuity_notes || []).map((item) => `承接提示：${item}`),
    continuity?.arc_progress ? `故事弧推进：${continuity.arc_progress}` : '',
  ].filter(Boolean)
  const bridgeItems = [
    bridgePlan?.locationTransition ? `地点承接：${bridgePlan.locationTransition}` : '',
    bridgePlan?.timeJump ? `时间承接：${bridgePlan.timeJump}` : '',
    bridgePlan?.emotionCarry ? `情绪承接：${bridgePlan.emotionCarry}` : '',
    bridgePlan?.firstSceneConstraint ? `首场景约束：${bridgePlan.firstSceneConstraint}` : '',
  ].filter(Boolean)
  const qualityFocusItems = [
    summaryHealth ? `摘要健康：${summaryHealth.status} · 密度 ${summaryHealth.densityScore} / 实体 ${summaryHealth.entityCoverageScore} / 事件 ${summaryHealth.eventCoverageScore}` : '',
    summaryHealth?.warnings?.[0] ? `摘要提醒：${summaryHealth.warnings[0]}` : '',
    expressionDedup?.mode
      ? `表达去重：${expressionDedup.mode === 'longform' ? '长篇' : '短篇'}窗口 · 近章 ${expressionDedup.recentWindowSize || 0} / 当前卷 ${expressionDedup.volumeWindowSize || 0} / 全书采样 ${expressionDedup.globalSampleWindowSize || 0}`
      : '',
    expressionDedup?.summary ? `跨章复用：${expressionDedup.summary}` : '',
    expressionDedup?.repeatedClimaxPatterns?.length ? `高潮复用：${expressionDedup.repeatedClimaxPatterns.slice(0, 3).join('、')}` : '',
    expressionDedup?.repeatedOpenings?.length ? `章首同质：${expressionDedup.repeatedOpenings.slice(0, 2).join('、')}` : '',
    expressionDedup?.repeatedClosings?.length ? `章尾同质：${expressionDedup.repeatedClosings.slice(0, 2).join('、')}` : '',
    hookContinuity?.warning ? `钩子连续性：${hookContinuity.warning}` : (hookContinuity ? `钩子强度：${hookContinuity.hookStrengthScore}` : ''),
    reviewNotes?.dialogue_fingerprint_summary ? `章节指纹：${reviewNotes.dialogue_fingerprint_summary}` : '',
    publishCheck?.summary ? `一致性快检：${publishCheck.summary}` : '',
    currentChapter?.nextChapterSeed ? `下一章开场建议：${currentChapter.nextChapterSeed}` : '',
    qualityDashboard?.voiceEvolutionSummary?.summary || '',
  ].filter(Boolean)

  const relatedInsightItems = [
    ...relatedEvents.map((event) => `${event.timeLabel || '时间未标注'} · ${event.eventTitle}`),
    ...relatedItems.map((item) => `道具 / 线索：${item.itemName}${item.plotFunction ? ` · ${item.plotFunction}` : ''}`),
  ]

  const reviewInsightItems = [
    reviewNotes?.summary ? `摘要回看：${reviewNotes.summary}` : '',
    reviewNotes?.revision_brief ? `修订摘要：${reviewNotes.revision_brief}` : '',
    reviewNotes?.contract_validation?.summary ? `合同兑现：${reviewNotes.contract_validation.summary}` : '',
    ...(reviewNotes?.critical_fixes || []).map((item) => `关键修订：${item}`),
    ...(reviewNotes?.continuity_risks || []).map((item) => `连续性风险：${item}`),
    ...(reviewNotes?.arc_progress_risks || []).map((item) => `弧推进风险：${item}`),
    ...(reviewNotes?.context_drift_risks || []).map((item) => `上下文漂移：${item}`),
    ...(reviewNotes?.realism_risks || []).map((item) => `真实度风险：${item}`),
    ...(reviewNotes?.coherence_risks || []).map((item) => `连贯性风险：${item}`),
    ...(reviewNotes?.reader_hook_risks || []).map((item) => `追读风险：${item}`),
    ...(reviewNotes?.language_risks || []).map((item) => `语言提示：${item}`),
    ...(reviewNotes?.human_language_repairs || []).map((item) => `语言替换：${item}`),
    ...(reviewNotes?.genre_hollowing_risks || []).map((item) => `体裁空心化：${item}`),
    reviewNotes?.dialogue_fingerprint_summary ? `对白辨识度：${reviewNotes.dialogue_fingerprint_summary}` : '',
    ...(reviewNotes?.dialogue_homogenization_risks || []).map((item) => `对白同质化：${item}`),
    ...(reviewNotes?.contract_validation?.itemResults || [])
      .filter((item) => item.verdict !== 'pass')
      .slice(0, 3)
      .map((item) => `合同缺口：${item.segmentTitle ? `${item.segmentTitle} · ` : ''}${item.expected}`),
    reviewNotes?.protagonist_setback && reviewNotes.protagonist_setback !== 'none'
      ? `主角受挫：${reviewNotes.protagonist_setback}${reviewNotes.setback_summary ? ` · ${reviewNotes.setback_summary}` : ''}`
      : '',
    reviewNotes?.cost_present
      ? `代价状态：${reviewNotes.cost_resolution_state || 'new'}${reviewNotes.cost_summary ? ` · ${reviewNotes.cost_summary}` : ''}`
      : '',
    reviewNotes?.reversal_marker
      ? `反转判断：${reviewNotes.reversal_support_state || 'weak'}${reviewNotes.reversal_summary ? ` · ${reviewNotes.reversal_summary}` : ''}`
      : '',
    reviewNotes?.pace_marker ? `节奏标签：${reviewNotes.pace_marker}` : '',
    reviewNotes?.reward_state && reviewNotes.reward_state !== 'none' ? `阶段回报：${reviewNotes.reward_state}` : '',
    typeof reviewNotes?.protagonist_pressure === 'number' && reviewNotes.protagonist_pressure > 0 ? `主角压力：${reviewNotes.protagonist_pressure}` : '',
  ].filter((item): item is string => Boolean(item))

  const productionBriefItems = [
    reviewNotes?.revision_brief ? `定稿方向：${reviewNotes.revision_brief}` : '',
    ...(reviewNotes?.contract_validation?.rewriteHints || []).slice(0, 2).map((item) => `合同修补：${item}`),
    ...(reviewNotes?.critical_fixes || []).slice(0, 2).map((item) => `先改：${item}`),
    ...(reviewNotes?.arc_progress_risks || []).slice(0, 2).map((item) => `弧推进：${item}`),
    ...(reviewNotes?.coherence_risks || []).slice(0, 2).map((item) => `读者易乱：${item}`),
    ...(reviewNotes?.reader_hook_risks || []).slice(0, 2).map((item) => `追读流失点：${item}`),
    ...(reviewNotes?.human_language_repairs || []).slice(0, 2).map((item) => `语言替换：${item}`),
    ...(reviewNotes?.dialogue_homogenization_risks || []).slice(0, 2).map((item) => `对白区分：${item}`),
    reviewNotes?.cost_resolution_state === 'evaporated' ? '代价延续：当前章节不能把重大损失快速抹平。' : '',
    reviewNotes?.reversal_marker && reviewNotes?.reversal_support_state === 'forced' ? '反转支撑：补齐前文铺垫与触发链，再保留这次反转。' : '',
    reviewNotes?.protagonist_setback === 'none' && (reviewNotes?.reward_state === 'partial' || reviewNotes?.reward_state === 'major') && !reviewNotes?.cost_present
      ? '主角阻力：当前章偏顺推，建议补出真实失败、失误或代价。'
      : '',
    ...((aiResult?.issues || []).slice(0, 2).map((issue) => `AI体检：${issue.suggestion}`)),
  ].filter((item): item is string => Boolean(item))

  const publishCheckSections = useMemo(() => {
    if (!publishCheck) return []
    return [
      { key: 'rewrite', title: '退回重写', items: publishCheck.checklist.filter((item) => item.status === 'rewrite') },
      { key: 'blocker', title: '阻塞项', items: publishCheck.checklist.filter((item) => item.status === 'blocker') },
      { key: 'warning', title: '预警项', items: publishCheck.checklist.filter((item) => item.status === 'warning') },
      { key: 'pass', title: '已通过', items: publishCheck.checklist.filter((item) => item.status === 'pass') },
    ].filter((section) => section.items.length > 0)
  }, [publishCheck])

  const publishCheckScores = useMemo(() => {
    if (!publishCheck) return []
    return [
      { label: '总分', value: publishCheck.scoreBreakdown.totalScore },
      { label: '连续性', value: publishCheck.scoreBreakdown.continuityScore },
      { label: '结构连贯', value: publishCheck.scoreBreakdown.coherenceScore },
      { label: '对白辨识', value: publishCheck.scoreBreakdown.dialogueVoiceScore },
      { label: '钩子强度', value: publishCheck.scoreBreakdown.hookStrengthScore },
      { label: '主角与节奏', value: publishCheck.scoreBreakdown.storyDynamicsScore },
      { label: '语言自然度', value: publishCheck.scoreBreakdown.languageNaturalnessScore },
    ]
  }, [publishCheck])

  const publishCheckDriftHighlights = useMemo(() => {
    if (!publishCheck?.drift) return []
    return publishCheck.drift.topDimensions
      .filter((item) => item.delta !== 0)
      .slice(0, 3)
      .map((item) => `${item.label}${item.delta > 0 ? '+' : ''}${item.delta}`)
  }, [publishCheck])

  const publishCheckHistoryItems = useMemo(() => {
    if (!publishCheck?.history?.length) return []
    return publishCheck.history.slice(0, 3).map((entry) => ({
      id: entry.id,
      text: `${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''} · ${entry.gateLevel === 'rewrite' ? '退回重写' : entry.gateLevel === 'blocker' ? '阻塞' : entry.gateLevel === 'warning' ? '预警' : '通过'} · 总分 ${entry.scoreBreakdown.totalScore}`,
    }))
  }, [publishCheck])
  const currentWritebackStatus = useMemo(
    () => parseWritebackStatus(currentChapter?.writebackStatusJson),
    [currentChapter?.writebackStatusJson],
  )
  const activePromptOverrideKeys = useMemo(
    () => chapterContextPreview?.generationExplainability?.activePromptOverrideKeys || [],
    [chapterContextPreview?.generationExplainability?.activePromptOverrideKeys],
  )

  const currentChapterGeneration = currentChapter
    ? (
      activeGeneration.chapterId === currentChapter.id && activeGeneration.status !== 'idle'
        ? activeGeneration
        : lastGenerationByChapter[currentChapter.id] || null
    )
    : null
  const currentChapterGenerating = currentChapterGeneration?.status === 'running'
    && activeGeneration.chapterId === currentChapter?.id
  const pipelineRoleItems = useMemo(() => {
    const order: WritingPipelineRole[] = ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize']
    return order.map((role) => currentPipelineSnapshot?.roles[role]).filter(Boolean) as WritingPipelineRoleState[]
  }, [currentPipelineSnapshot])

  const currentStatusLabel = currentChapter ? getStatusLabel(currentChapter.status) : '未选择章节'
  const hasMultiSegments = (currentChapter?.segmentCount || 0) > 1
  const editorAdvisoryCount = productionBriefItems.length
    + (currentChapterStaleReasons.length > 0 ? 1 : 0)
    + (currentWritebackStatus?.readyForNextChapter === false ? 1 : 0)
    + (publishCheck ? 1 : 0)
    + (hasMultiSegments ? 1 : 0)
  const editorTitle = currentChapter ? currentChapter.title || `第${currentChapter.chapterNum}章` : '请选择一个章节'
  const editorSubtitle = currentChapter
    ? `当前状态：${currentStatusLabel} · 当前正文视为入库稿，停止输入后会自动保存。`
    : '从左侧选择章节后即可直接编辑，右侧同步查看本章链路、修订建议与体检结果。'

  const resolvedEditorSubtitle = hasMultiSegments
    ? `当前状态：${currentStatusLabel} · 本章已拆成 ${currentChapter?.segmentCount || 0} 个场景，请优先在结构页维护场景后再编译整章。`
    : editorSubtitle
  const primaryStatusText = currentChapterGenerating
    ? `AI 正在生成第 ${currentChapter?.chapterNum || '-'} 章`
    : refreshing
      ? '正在同步写作数据'
      : currentChapter
        ? `自动保存开启 · ${currentStatusLabel}`
        : '请选择章节开始写作'
  const chapterInsightContent = (
    <>
      <div className="novel-writing-shell__insight-spotlight">
        <ChapterFocusCard
          summary={currentChapter?.summary}
          nextChapterSeed={currentChapter?.nextChapterSeed}
          continuityItems={continuityItems}
          bridgeItems={bridgeItems}
          qualityItems={qualityFocusItems}
        />
        <InsightCard title="场景拆解" eyebrow="执行顺序">
          {scenePlan.length > 0 ? <div className="novel-scene-list">{scenePlan.map((scene) => <div key={`${scene.scene_order}-${scene.scene_title}`} className="novel-scene-card"><div className="novel-scene-card__header"><span>{`场景 ${String(scene.scene_order).padStart(2, '0')}`}</span><strong>{scene.scene_title}</strong></div><div className="novel-scene-card__body"><div>{scene.purpose}</div>{scene.location ? <div>地点：{scene.location}</div> : null}{scene.time_anchor ? <div>时间：{scene.time_anchor}</div> : null}{scene.present_characters?.length ? <div>人物：{scene.present_characters.join('、')}</div> : null}{scene.key_items?.length ? <div>道具：{scene.key_items.join('、')}</div> : null}{scene.must_cover?.length ? <div>必须覆盖：{scene.must_cover.join('、')}</div> : null}{scene.climax_variant ? <div>高潮变体：{scene.climax_variant}</div> : null}</div></div>)}</div> : <div className="novel-copy-block">先运行章节流水线，系统会按合同拆出场景计划后在这里核对。</div>}
        </InsightCard>
      </div>
      <div className="novel-writing-shell__insight-stack">
        <InsightCard title="长篇写作架构" eyebrow="规划 / 写作 / 审校 / 重写 / 回写" tone="soft">
          {currentPipelineSnapshot ? (
            <div className="writing-layout-stack">
              <div className="novel-copy-block">
                {`当前阶段：${currentPipelineSnapshot.currentRole ? currentPipelineSnapshot.roles[currentPipelineSnapshot.currentRole]?.label || currentPipelineSnapshot.currentRole : '待启动'} · AI 模式 ${currentPipelineSnapshot.executionMode ? getAiExecutionModeLabel(currentPipelineSnapshot.executionMode) : '未记录'} · 合同版本 ${currentPipelineSnapshot.contractVersion || '未记录'} · 总耗时 ${currentPipelineSnapshot.totalDurationMs ? `${(currentPipelineSnapshot.totalDurationMs / 1000).toFixed(1)}秒` : '-'} · 总用量 ${currentPipelineSnapshot.totalTokensUsed || 0}${currentPipelineSnapshot.failureCode ? ` · 退出码 ${currentPipelineSnapshot.failureCode}` : ''}`}
              </div>
              {currentPipelineSnapshot.stepMemory?.summary ? (
                <div className="novel-copy-block writing-layout-copy-prewrap">{currentPipelineSnapshot.stepMemory.summary}</div>
              ) : (
                <div className="novel-copy-block">当前流水线还没有记录运行时步骤记忆。</div>
              )}
              <StringList
                items={(currentPipelineSnapshot.stepMemory?.runtimeAssertions || []).map((item) => `运行时断言：${item}`)}
                empty="当前流水线没有额外运行时断言。"
              />
              <div className="writing-layout-stack writing-layout-stack--xs">
                {pipelineRoleItems.map((item) => (
                  <div key={item.role} className="novel-issue-item">
                    <div className="novel-issue-item__head">
                      <Tag color={item.status === 'success' ? 'success' : item.status === 'running' ? 'processing' : item.status === 'blocked' ? 'warning' : item.status === 'failed' ? 'error' : 'default'}>
                        {item.status === 'success' ? '已完成' : item.status === 'running' ? '执行中' : item.status === 'blocked' ? '已阻断' : item.status === 'failed' ? '失败' : '待执行'}
                      </Tag>
                      <strong>{item.label}</strong>
                      {item.taskId ? <Tag color="blue">{`任务 #${item.taskId}`}</Tag> : null}
                      {item.canonRunId ? <Tag color="geekblue">{`回写 #${item.canonRunId}`}</Tag> : null}
                    </div>
                    <div className="novel-issue-item__desc">{item.detail || item.summary}</div>
                    <div className="novel-issue-item__suggestion">
                      {`预算：${item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}秒` : '-'} / 用量 ${item.tokensUsed || 0}${item.failureCode ? ` · ${formatFailure(item.failureCode).title}` : ''}${item.rewriteScope ? ` · ${item.rewriteScope}` : ''}${typeof item.targetSegmentId === 'number' ? ` · 场景#${item.targetSegmentId}` : ''}`}
                    </div>
                  </div>
                ))}
              </div>
              {currentPipelineSnapshot.canonRunId ? (
                <div className="novel-copy-block">{`已生成回写草案 #${currentPipelineSnapshot.canonRunId}，可直接进入章后状态回写中心确认。`}</div>
              ) : null}
            </div>
          ) : <div className="novel-copy-block">当前章节还没有最近一次角色化流水线快照。</div>}
        </InsightCard>
        <InsightCard
          title="更多诊断与回写"
          eyebrow="上下文 / 资产 / 伏笔 / 世界规则 · 按需展开"
          tone="soft"
          collapsible
        >
          <div className="novel-writing-shell__insight-stack novel-writing-shell__insight-stack--nested">
            {chapterContextPreview?.contractReady === false ? (
              <Alert
                type="warning"
                showIcon
                message="当前章节还不能启动合同驱动写作"
                description={(
                  <div className="writing-layout-stack writing-layout-stack--xs">
                    <div>{(chapterContextPreview.contractBlockers || ['请先补齐章节合同和场景合同。']).join('；')}</div>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => currentChapter && navigate(buildWorkspaceRoute(novelId, `contracts?chapterId=${currentChapter.id}`))}
                    >
                      去补齐章节合同
                    </Button>
                  </div>
                )}
              />
            ) : null}
            <InsightCard title="关键约束注入" eyebrow="本章关键约束已注入" tone="soft">
              <ConstraintInjectionCard
                preview={chapterContextPreview}
                preserveConstraintLabels={preserveConstraintLabels}
                onPreserveConstraintChange={setPreserveConstraintLabels}
              />
            </InsightCard>
            <InsightCard title="上一章关键先验" eyebrow="承接上一章的真实输入" tone="soft">
              <PreviousChapterFeedCard preview={chapterContextPreview} />
            </InsightCard>
            <InsightCard title="章节衔接桥" eyebrow="时间 / 地点 / 情绪 / 视角" tone="soft">
              <ChapterBridgeMemoryCard preview={chapterContextPreview} />
            </InsightCard>
            <InsightCard title="召回补充层" eyebrow="背景补充 / 非事实源" tone="soft">
              <RecallDiagnosticsCard preview={chapterContextPreview} />
            </InsightCard>
            <InsightCard title="资产影响与注入" eyebrow="本次实际使用 / 待同步影响" tone="soft">
              <ContextUsageImpactCard preview={chapterContextPreview} />
            </InsightCard>
            <InsightCard title="AI 生成解释" eyebrow={`当前模式 · ${getAiExecutionModeLabel(effectiveAiExecutionMode)}`} tone="soft">
              <AiExplainabilityCard preview={chapterContextPreview} />
            </InsightCard>
            <InsightCard title="写作工具追踪" eyebrow="按需检索 / 降级 / 覆盖" tone="soft">
              <WriterToolsTraceCard preview={chapterContextPreview} />
            </InsightCard>
            <InsightCard title="生产摘要" eyebrow="AI 主写 / 人工定稿" tone="soft"><StringList items={productionBriefItems} empty="先完成审校或刷新摘要，再回到这里收口定稿优先级。" /></InsightCard>
            <InsightCard title="关联线索" eyebrow="时间轴 / 道具" tone="soft"><StringList items={relatedInsightItems.slice(0, 12)} empty="当前章节暂未关联时间轴事件或关键道具。" /></InsightCard>
            <InsightCard title="本章信息揭示控制" eyebrow="允许揭示 / 已揭示" tone="soft">
              <ChapterRevealConstraintCard
                chapter={currentChapter}
                facts={storyFacts}
                volumes={storyVolumes}
                characters={chapterCharacters}
                allowedFactIds={allowedRevealFactIds}
                revealedFactIds={revealedFactIds}
                truthStats={currentVolumeTruthStats}
                saving={updatingRevealConstraints}
                onUpdate={handleUpdateRevealConstraints}
                onOpenBoard={() => navigate(buildWorkspaceRoute(novelId, 'info-gap-board'))}
              />
            </InsightCard>
            <InsightCard title="本章伏笔回写" eyebrow="新增埋设 / 已回收登记" tone="soft">
              <ChapterForeshadowWritebackCard
                chapter={currentChapter}
                chapterSegments={chapterSegments}
                ledger={foreshadowLedger}
                saving={updatingForeshadowWriteback}
                onCreate={handleCreateForeshadowWriteback}
                onPatch={handlePatchForeshadowWriteback}
                onDelete={handleDeleteForeshadowWriteback}
                onOpenLedger={() => navigate(buildWorkspaceRoute(novelId, 'foreshadow-ledger'))}
              />
            </InsightCard>
            <InsightCard title="本章应回收伏笔" eyebrow={foreshadowSnapshot ? `按第 ${foreshadowSnapshot.currentChapterNum} 章进度计算` : '即将到期 / 超期未收'} tone="soft">
              <StringList items={dueForeshadowItems} empty="当前章节附近没有到期或超期未收的伏笔债务。" />
            </InsightCard>
            <InsightCard title="修订提示" eyebrow="复盘重点" tone="soft"><StringList items={reviewInsightItems} empty="先运行审校或刷新摘要，再集中处理需要回看的修订点。" /></InsightCard>
            <InsightCard title="世界规则" eyebrow="写作边界" tone="soft"><StringList items={worldRulesSummary} empty={currentNovel?.worldRulesJson ? '本章暂未命中明确的世界边界。' : '先完善世界规则，再回来校对本章边界。'} /></InsightCard>
          </div>
        </InsightCard>
      </div>
    </>
  )

  const memoryInsightContent = (
    <div className="novel-writing-shell__insight-stack">
      <InsightCard title="阶段摘要" eyebrow={storyMemory?.coverageSummary || '长篇覆盖'} tone="soft"><StringList items={storyMemory?.phaseDigest || []} empty="章节量还不大，阶段摘要会在长篇推进后逐步显现。" /></InsightCard>
      <InsightCard title="剧情里程碑" eyebrow="压缩摘要"><StringList items={storyMemory ? storyMemory.plotMilestones.slice(0, 12) : []} empty="长篇记忆还没刷新到可复盘里程碑。" /></InsightCard>
      <InsightCard title="人物与世界状态" eyebrow="统一总账" tone="soft"><CharacterStateMemoryCard storyMemory={storyMemory} /></InsightCard>
      <InsightCard title="活跃线程" eyebrow="待持续追踪" tone="soft"><StringList items={storyMemory ? storyMemory.activeThreads.slice(0, 12) : []} empty="当前章没有命中持续追踪线程，适合回查线程挂载是否缺失。" /></InsightCard>
      <InsightCard title="时间锚点" eyebrow="时序参照" tone="soft"><StringList items={storyMemory ? storyMemory.timelineAnchors.slice(0, 10) : []} empty="时间轴锚点会在这里同步展示。" /></InsightCard>
      <InsightCard title="道具账本" eyebrow="状态同步" tone="soft"><StringList items={storyMemory ? storyMemory.itemLedger.slice(0, 10) : []} empty="关键道具与线索的状态变化会记录在这里。" /></InsightCard>
    </div>
  )

  const reviewInsightContent = (
    <>
      <div className="novel-writing-shell__insight-spotlight">
        <InsightCard title="全书健康度" eyebrow="结构体检" tone="hero">{consistencyReport ? <div className="novel-health-board"><div className="novel-health-score"><strong>{consistencyReport.readinessScore}</strong><span>{getHealthLabel(consistencyReport.readinessScore)}</span></div><div className="novel-health-breakdown"><div><strong>{consistencyReport.highCount}</strong><span>高危</span></div><div><strong>{consistencyReport.mediumCount}</strong><span>中危</span></div><div><strong>{consistencyReport.lowCount}</strong><span>低危</span></div></div></div> : <div className="novel-copy-block">正在分析全书结构健康度。</div>}</InsightCard>
        <InsightCard title="本章风险" eyebrow="优先修复">{chapterIssues.length > 0 ? <div className="novel-issue-list">{chapterIssues.slice(0, 8).map((issue) => <div key={issue.id} className="novel-issue-item"><div className="novel-issue-item__head"><Tag color={getIssueColor(issue.severity)}>{getIssueLabel(issue.severity)}</Tag><strong>{issue.title}</strong></div><div className="novel-issue-item__desc">{issue.description}</div><div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div></div>)}</div> : <div className="novel-copy-block">当前章节没有被结构体检命中的明显风险。</div>}</InsightCard>
      </div>
      <div className="novel-writing-shell__insight-stack">
        <InsightCard title="审校意见分层" eyebrow="必须处理 / 建议处理 / 仅参考" tone="soft">
          <ReviewNotesPanel notes={reviewNotes as Record<string, unknown> | null} />
        </InsightCard>
        <InsightCard title="发布前检查" eyebrow="完成门槛" tone="soft">
          {publishCheck ? (
            <div className="novel-gate-report">
              <div className="novel-gate-report__summary">
                <div className="novel-gate-report__summary-copy">
                  <div className="novel-gate-report__headline">
                    <Tag color={getPublishCheckAlertType(publishCheck) === 'success' ? 'success' : getPublishCheckAlertType(publishCheck) === 'warning' ? 'warning' : 'error'}>
                      {publishCheck.gateLevel === 'rewrite' ? '退回重写' : publishCheck.gateLevel === 'blocker' ? '阻塞' : publishCheck.gateLevel === 'warning' ? '预警' : '通过'}
                    </Tag>
                    <strong>{publishCheck.summary}</strong>
                    <Tag color={getPublishCheckScoreTagColor(publishCheck.scoreBreakdown.totalScore)}>{`总分 ${publishCheck.scoreBreakdown.totalScore}`}</Tag>
                    {publishCheck.drift ? (
                      <Tag color={getPublishCheckDriftTagColor(publishCheck.drift.status)}>
                        {`${getPublishCheckDriftLabel(publishCheck.drift.status)} ${publishCheck.drift.scoreDelta > 0 ? `+${publishCheck.drift.scoreDelta}` : publishCheck.drift.scoreDelta}`}
                      </Tag>
                    ) : null}
                  </div>
                  <div className="novel-gate-report__counts">
                    <span>{`重写 ${publishCheck.rewriteCount}`}</span>
                    <span>{`阻塞 ${publishCheck.blockerCount}`}</span>
                    <span>{`预警 ${publishCheck.warningCount}`}</span>
                    {publishCheck.generatedTaskCount > 0 ? <span>{`任务 ${publishCheck.generatedTaskCount}`}</span> : null}
                  </div>
                </div>
                <div className="novel-gate-report__actions">
                  {publishCheck.rewriteTarget ? (
                    <Button
                      size="small"
                      type="primary"
                      danger={publishCheck.gateLevel === 'rewrite'}
                      onClick={() => {
                        const rewriteItem = publishCheck.checklist.find((item) => item.status === 'rewrite')
                        if (rewriteItem) handleOpenGateIssue(rewriteItem)
                      }}
                    >
                      打开重写目标
                    </Button>
                  ) : null}
                  <Button size="small" onClick={() => setGateReportExpanded((current) => !current)}>
                    {gateReportExpanded ? '收起报告' : '展开报告'}
                  </Button>
                  <Button size="small" onClick={() => navigate(buildWorkspaceRoute(novelId, 'quality'))}>
                    去质量看板
                  </Button>
                </div>
              </div>
              {publishCheck.drift || publishCheckHistoryItems.length > 0 ? (
                <div className="novel-gate-report__meta-grid">
                  {publishCheck.drift ? (
                    <div className="novel-gate-report__meta-card">
                      <div className="novel-gate-report__meta-head">
                        <strong>较上次验收</strong>
                        <span>{publishCheck.drift.previousScore != null ? `上次 ${publishCheck.drift.previousScore}` : '首次记录'}</span>
                      </div>
                      <div className="novel-gate-report__meta-copy">{publishCheck.drift.summary}</div>
                      {publishCheckDriftHighlights.length > 0 ? (
                        <div className="novel-gate-report__meta-tags">
                          {publishCheckDriftHighlights.map((item) => <Tag key={item}>{item}</Tag>)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {publishCheckHistoryItems.length > 0 ? (
                    <div className="novel-gate-report__meta-card">
                      <div className="novel-gate-report__meta-head">
                        <strong>最近门记录</strong>
                        <span>{`${publishCheck.history.length} 次快照`}</span>
                      </div>
                      <div className="novel-gate-report__history-list">
                        {publishCheckHistoryItems.map((item) => <div key={item.id}>{item.text}</div>)}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="novel-gate-report__score-grid">
                {publishCheckScores.map((item) => (
                  <div key={item.label} className="novel-gate-report__score-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              <div className="novel-copy-block">合同对账：{publishCheck.contractAudit.summary}</div>
              {publishCheck.contractValidation?.summary ? (
                <div className="novel-copy-block">正文兑现：{publishCheck.contractValidation.summary}</div>
              ) : null}
              {gateReportExpanded ? (
                <div className="novel-gate-report__sections">
                  {publishCheckSections.map((section) => (
                    <section key={section.key} className="novel-gate-report__section">
                      <div className="novel-gate-report__section-head">
                        <strong>{section.title}</strong>
                        <span>{section.items.length} 项</span>
                      </div>
                      <div className="novel-gate-report__item-list">
                        {section.items.map((item) => (
                          <div key={item.key} className="novel-gate-report__item">
                            <div className="novel-gate-report__item-head">
                              <div className="novel-gate-report__item-title">
                                <Tag color={getPublishCheckStatusTagColor(item.status)}>{getPublishCheckStatusLabel(item.status)}</Tag>
                                <strong>{item.label}</strong>
                                {item.segmentTitle ? <span>{item.segmentTitle}</span> : null}
                                {typeof item.taskId === 'number' ? <Tag color="blue">{`任务 #${item.taskId}`}</Tag> : null}
                              </div>
                              {item.status !== 'pass' ? (
                                <Button size="small" onClick={() => handleOpenGateIssue(item)}>
                                  去处理
                                </Button>
                              ) : null}
                            </div>
                            <div className="novel-gate-report__item-detail">{item.detail}</div>
                            {item.fixHint ? <div className="novel-gate-report__item-hint">{`建议：${item.fixHint}`}</div> : null}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>
          ) : <div className="novel-copy-block">先运行发布前检查，再决定是否可定稿。</div>}
        </InsightCard>
        <InsightCard title="合同对账" eyebrow="章节 / 场景合同" tone="soft">
          {currentContractAudit ? (
            <StringList
              items={currentContractAudit.items.map(formatContractAuditItemText)}
              empty="先生成或刷新合同对账，再看当前缺口。"
            />
          ) : <div className="novel-copy-block">先生成或刷新合同对账，再看当前缺口。</div>}
        </InsightCard>
        <InsightCard title="章后状态回写" eyebrow="正典确认 / 统一写回" tone="soft">
          {currentChapter ? (
            <div className="writing-layout-stack writing-layout-stack--sm">
              <div className="novel-copy-block">写完本章后，在这里进入独立回写中心，先确认事实抽取和状态候选，再统一写回线程、伏笔、谜题、关系、物品与时间轴。</div>
              <div>
                <Button onClick={() => navigate(buildWorkspaceRoute(novelId, `writeback?chapterId=${currentChapter.id}`))}>
                  打开章后状态回写中心
                </Button>
              </div>
            </div>
          ) : <div className="novel-copy-block">先选择章节，再进入章后状态回写中心。</div>}
        </InsightCard>
        <InsightCard title="最近恶化项" eyebrow="跨章节语言退化" tone="soft">
          <LanguageDriftHealthCard dashboard={qualityDashboard} currentChapter={currentChapter} />
        </InsightCard>
        <InsightCard title="人味硬约束" eyebrow="模板 / 解释 / 立场" tone="soft">
          <HumanizationHealthCard dashboard={qualityDashboard} reviewNotes={reviewNotes} />
        </InsightCard>
        <InsightCard title="角色对白辨识度" eyebrow="语音指纹" tone="soft">
          <DialogueFingerprintHealthCard dashboard={qualityDashboard} reviewNotes={reviewNotes} />
        </InsightCard>
        <InsightCard title="主角与节奏风险" eyebrow="跨章节结构告警" tone="soft">
          <StoryDynamicsHealthCard dashboard={qualityDashboard} currentChapter={currentChapter} reviewNotes={reviewNotes} />
        </InsightCard>
        <InsightCard title="世界状态概览" eyebrow="总账 / 冲突实体" tone="soft">
          <WorldStateHealthCard dashboard={qualityDashboard} />
        </InsightCard>
        <InsightCard title="AI 检测与复检" eyebrow="局部诊断" tone="soft">
          <AIScorePanel
            getContent={() => normalizeEditorText(editorRef.current?.innerText || content)}
            contentType="chapter"
            genreContext={currentNovel?.genreName || ''}
            novelBackground={[currentNovel?.synopsis, currentNovel?.expandedBackground].filter(Boolean).join('\n')}
            modelConfigId={currentNovel?.modelConfigId}
            novelId={novelId}
            disabled={!currentChapter}
            onRegenerate={applyChapterContent}
            drawCount={1}
          />
          {aiResult ? <div className="writing-layout-note-space-top"><AiCheckResult result={aiResult} /></div> : <div className="novel-copy-block writing-layout-note-space-top">点击上方 AI 体检后，这里也会展示语义与表达层面的复检结果。</div>}
        </InsightCard>
        <InsightCard title="建议优先处理" eyebrow="下一步" tone="soft"><StringList items={consistencyReport?.focusAreas || []} empty="最近没有新的高优先项，继续推进正文即可。" /></InsightCard>
      </div>
    </>
  )

  const historyInsightContent = (
    <div className="novel-writing-shell__insight-stack">
      <InsightCard title="章节版本历史" eyebrow={currentChapter ? `${formatChapterNumber(currentChapter.chapterNum)} · 可恢复版本` : '选择章节后可查看'}>
        {!currentChapter ? (
          <div className="novel-copy-block">请先从左侧选择一个章节。</div>
        ) : (
          <div className="novel-split novel-split--sidebar">
            <div className="novel-note-list">
              {versionHistoryLoading ? <Spin size="small" /> : null}
              {!versionHistoryLoading && chapterVersions.length === 0 ? (
                <div className="novel-note-list__item">当前章节还没有可恢复的版本。</div>
              ) : null}
              {chapterVersions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className={`novel-sidebar__nav-item chapter-console-page__version-button ${selectedVersion?.id === version.id ? 'novel-sidebar__nav-item--active' : ''}`}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  <span className="novel-sidebar__nav-copy">
                    <strong>{chapterVersionSourceLabel(version.versionSource)}</strong>
                    <small>{`${version.wordCount || 0} 字 · ${new Date(version.createdAt).toLocaleString()}`}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="writing-layout-stack">
              <div className="novel-copy-block writing-layout-copy-prewrap writing-layout-copy-tall">
                {selectedVersion?.content || '先从左侧选择版本，再比较正文差异。'}
              </div>
              <div className="writing-layout-row writing-layout-row--end writing-layout-row--wrap">
                <Button onClick={() => navigateToWritingRoute('editor')}>返回编辑</Button>
                <Button type="primary" disabled={!selectedVersion} onClick={() => void handleRestoreVersion()}>
                  恢复所选版本
                </Button>
              </div>
            </div>
          </div>
        )}
      </InsightCard>
    </div>
  )

  const chapterWritability = useMemo(() => getChapterWritabilitySummary({
    chapter: currentChapter,
    publishCheck,
    scenePlanCount: scenePlan.length,
    chapterSegmentCount: chapterSegments.length,
    threadCount: storyMemory?.activeThreads.length || 0,
    chapterCharactersCount: chapterCharacters.length,
    relatedEventCount: relatedEvents.length,
    staleReasonCount: currentChapterStaleReasons.length,
    dueForeshadowCount: dueForeshadowItems.length,
    revisionBlockerCount: publishCheck?.blockerCount || 0,
    staleAssetCount: contextStatus?.staleAssetCount || 0,
    staleCheckpointCount: contextStatus?.staleCheckpointCount || 0,
  }), [
    chapterSegments.length,
    chapterCharacters.length,
    contextStatus?.staleAssetCount,
    contextStatus?.staleCheckpointCount,
    currentChapter,
    currentChapterStaleReasons.length,
    dueForeshadowItems.length,
    publishCheck,
    relatedEvents.length,
    scenePlan.length,
    storyMemory?.activeThreads.length,
  ])
  const generationPreflight = useMemo(() => {
    const messages = [
      !chapterWritability.ready ? chapterWritability.summary : '',
      ...chapterWritability.risks,
      (currentWritebackStatus?.blockedGeneration || currentWritebackStatus?.canonApplied === false)
        ? `章后回写仍处于「${getWritebackPhaseLabel(currentWritebackStatus.phase)}」，先完成回写确认再继续生成。`
        : '',
    ].filter(Boolean)

    return {
      ready: Boolean(currentChapter) && messages.length === 0,
      messages,
    }
  }, [chapterWritability, currentChapter, currentWritebackStatus?.blockedGeneration, currentWritebackStatus?.canonApplied, currentWritebackStatus?.phase])

  generationPreflightRef.current = generationPreflight

  const sceneListItems = useMemo(
    () => scenePlan.map((scene) => `${scene.scene_title} · ${scene.purpose}`),
    [scenePlan],
  )

  const sceneContractSections = useMemo<ContractPanelSection[]>(() => (
    scenePlan.slice(0, 6).map((scene) => ({
      key: `${scene.scene_order}-${scene.scene_title}`,
      title: `场景 ${String(scene.scene_order).padStart(2, '0')} · ${scene.scene_title}`,
      items: [
        scene.purpose ? `目的：${scene.purpose}` : '',
        scene.location ? `地点：${scene.location}` : '',
        scene.time_anchor ? `时间：${scene.time_anchor}` : '',
        scene.present_characters?.length ? `人物：${scene.present_characters.join('、')}` : '',
        scene.key_items?.length ? `道具：${scene.key_items.join('、')}` : '',
        scene.must_cover?.length ? `必须覆盖：${scene.must_cover.join('、')}` : '',
        scene.climax_variant ? `高潮变体：${scene.climax_variant}` : '',
      ].filter(Boolean),
      tone: 'soft',
    }))
  ), [scenePlan])

  const chapterContractSections = useMemo<ContractPanelSection[]>(() => {
    const sections: ContractPanelSection[] = [
      {
        key: 'goal',
        title: '本章目标',
        items: [
          currentChapter?.summary ? `摘要：${currentChapter.summary}` : '',
          currentChapter?.outline ? `大纲：${currentChapter.outline}` : '',
          currentChapter?.targetWords ? `篇幅参考：${currentChapter.targetWords} 字（弹性）` : '',
          currentChapter?.nextChapterSeed ? `下一章接力：${currentChapter.nextChapterSeed}` : '',
        ].filter(Boolean),
        tone: 'soft',
      },
      {
        key: 'scene-list',
        title: '场景列表',
        items: sceneListItems,
      },
      {
        key: 'threads',
        title: '必须推进的线程',
        items: (storyMemory?.activeThreads || []).slice(0, 6),
      },
      {
        key: 'foreshadow',
        title: '必须服务的伏笔',
        items: dueForeshadowItems.slice(0, 6),
      },
      {
        key: 'forbidden',
        title: '禁止事项',
        items: [
          currentVolumeTruthStats.overLimit
            ? `当前卷真相揭示比例超限，避免提前泄露关键真相。`
            : '',
          ...currentChapterStaleReasons.map((item) => `上下文未同步：${item}`),
          ...(publishCheck?.checklist || [])
            .filter((item) => item.status === 'blocker' || item.status === 'rewrite')
            .slice(0, 4)
            .map((item) => `${item.label}：${item.detail}`),
        ].filter(Boolean),
        tone: 'danger',
      },
      {
        key: 'acceptance',
        title: '验收标准',
        items: [
          currentContractAudit?.summary ? `合同对账：${currentContractAudit.summary}` : '',
          ...(currentContractAudit?.items || []).slice(0, 4).map((item) => `${item.label}：${item.detail}`),
          ...(publishCheck?.contractValidation?.rewriteHints || []).slice(0, 3).map((item) => `补齐：${item}`),
        ].filter(Boolean),
      },
    ]

    return sections
  }, [
    currentChapter?.nextChapterSeed,
    currentChapter?.outline,
    currentChapter?.summary,
    currentChapter?.targetWords,
    currentChapterStaleReasons,
    currentContractAudit,
    currentVolumeTruthStats.overLimit,
    dueForeshadowItems,
    publishCheck?.checklist,
    publishCheck?.contractValidation?.rewriteHints,
    sceneListItems,
    storyMemory?.activeThreads,
  ])

  const qualityIssueItems = useMemo(() => ([
    ...(publishCheck?.checklist || [])
      .filter((item) => item.status === 'rewrite' || item.status === 'blocker' || item.status === 'warning')
      .slice(0, 6)
      .map((item) => `${item.label}：${item.detail}`),
    ...chapterIssues.slice(0, 4).map((issue) => `${issue.title}：${issue.description || issue.suggestion || '需要修订'}`),
    ...(aiResult?.issues || []).slice(0, 4).map((issue) => `${issue.type}：${issue.suggestion}`),
  ]), [aiResult?.issues, chapterIssues, publishCheck?.checklist])

  const pipelineItems = useMemo<PipelineBarItem[]>(() => {
    const roleKeyOrder: WritingPipelineRole[] = ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize']
    const roleLabelMap: Record<WritingPipelineRole, string> = {
      planner: '规划',
      writer: '写作',
      critic: '审校',
      rewriter: '重写',
      canonizer: '回写',
      finalize: '定稿',
    }

    return roleKeyOrder.map((role) => {
      const roleState = currentPipelineSnapshot?.roles[role]
      const status = roleState?.status || (role === 'planner' && scenePlan.length > 0
        ? 'success'
        : role === 'writer' && Boolean(currentChapter?.content)
          ? 'success'
          : role === 'critic' && Boolean(reviewNotes)
            ? 'success'
            : role === 'rewriter' && Boolean(currentChapter?.content && reviewNotes)
              ? 'success'
              : role === 'canonizer' && Boolean(currentPipelineSnapshot?.canonRunId)
                ? 'success'
                : role === 'finalize' && currentChapter?.status === 'final'
                  ? 'success'
                  : 'pending')

      return {
        key: role,
        label: roleLabelMap[role],
        status,
        detail: roleState?.detail || roleState?.summary || (
          role === 'finalize'
            ? '确认终稿并进入章后回写。'
            : '等待进入该阶段。'
        ),
        taskId: roleState?.taskId || currentPipelineSnapshot?.workflowTaskId,
        contractVersion: roleState?.contractVersion || currentPipelineSnapshot?.contractVersion,
        durationMs: roleState?.durationMs,
        tokensUsed: roleState?.tokensUsed,
        error: roleState?.failureCode,
        canRetry: status === 'failed' || status === 'blocked',
        onRetry: status === 'failed' || status === 'blocked'
          ? (() => void handleGenerateContent())
          : undefined,
      }
    })
  }, [
    currentChapter?.content,
    currentChapter?.status,
    currentPipelineSnapshot,
    handleGenerateContent,
    reviewNotes,
    scenePlan.length,
  ])

  const acceptanceCards = useMemo(() => ([
    { label: '合同对账', value: currentContractAudit?.summary || '待检查' },
    { label: '连续性检查', value: publishCheck ? `${publishCheck.scoreBreakdown.continuityScore} 分` : '待检查' },
    { label: 'AI 味检查', value: aiResult ? `${aiResult.score} 分` : '待检查' },
    { label: '节奏检查', value: reviewNotes?.pace_marker || '待检查' },
    { label: '人物一致性', value: publishCheck ? `${publishCheck.scoreBreakdown.storyDynamicsScore} 分` : '待检查' },
    { label: '世界规则一致性', value: publishCheck ? `${publishCheck.scoreBreakdown.coherenceScore} 分` : '待检查' },
    { label: '章节功能达成', value: publishCheck?.contractValidation?.summary || '待检查' },
  ]), [aiResult, currentContractAudit?.summary, publishCheck, reviewNotes?.pace_marker])

  const pipelineMetaItems = useMemo(() => ([
    {
      label: '当前任务 ID',
      value: currentPipelineSnapshot?.workflowTaskId ? `#${currentPipelineSnapshot.workflowTaskId}` : '未运行',
    },
    {
      label: '合同版本',
      value: formatPipelineMetaValue(currentPipelineSnapshot?.contractVersion || '未记录'),
    },
    {
      label: '生成用量',
      value: currentPipelineSnapshot?.totalTokensUsed ? `${currentPipelineSnapshot.totalTokensUsed}` : '0',
    },
    {
      label: '耗时',
      value: currentPipelineSnapshot?.totalDurationMs ? `${(currentPipelineSnapshot.totalDurationMs / 1000).toFixed(1)}s` : '-',
    },
    {
      label: '失败原因',
      value: currentPipelineSnapshot?.failureCode
        ? formatFailure(currentPipelineSnapshot.failureCode).title
        : '当前无失败',
    },
    {
      label: '回写状态',
      value: currentWritebackStatus
        ? `${getWritebackPhaseLabel(currentWritebackStatus.phase)}${currentWritebackStatus.blockedGeneration ? ' · 后续生成已暂停' : ''}`
        : '未记录',
    },
    {
      label: '下一章就绪',
      value: currentWritebackStatus
        ? (currentWritebackStatus.canonApplied && currentWritebackStatus.readyForNextChapter ? '正典已应用 · 下一章已就绪' : currentWritebackStatus.candidateReady ? '候选已生成 · 等待正典应用' : '等待回写候选')
        : '未记录',
    },
    {
      label: 'Prompt Override',
      value: activePromptOverrideKeys.length > 0 ? activePromptOverrideKeys.join('、') : '当前未启用',
    },
    {
      label: '恢复提示',
      value: currentWritebackStatus?.readyForNextChapter === false
        ? `等待章后回写完成${currentWritebackStatus.lastError ? `：${currentWritebackStatus.lastError}` : '。'}`
        : currentPipelineSnapshot?.status === 'failed'
        ? '先检查合同、上下文召回与审校提示，再重试流水线。'
        : '当前无需恢复操作。',
    },
  ]), [activePromptOverrideKeys, currentPipelineSnapshot, currentWritebackStatus])

  const insightRouteContent = (
    <React.Suspense fallback={<div className="novel-copy-block">正在切换视图...</div>}>
      {activeWritingRoute === 'context' ? (
        <WritingContextRoute>{memoryInsightContent}</WritingContextRoute>
      ) : activeWritingRoute === 'review' ? (
        <WritingReviewRoute>{reviewInsightContent}</WritingReviewRoute>
      ) : activeWritingRoute === 'history' ? (
        <WritingHistoryRoute>{historyInsightContent}</WritingHistoryRoute>
      ) : (
        <WritingEditorRoute>{chapterInsightContent}</WritingEditorRoute>
      )}
    </React.Suspense>
  )

  return (
    <>
      <div className="novel-writing-console-page chapter-console-page">
        {loading && !currentChapter ? (
          <div className="chapter-console-page__loading"><Spin size="large" /></div>
        ) : (
          <>
            {refreshing ? (
              <div className="novel-dashboard__refresh-indicator workspace-alert-spaced">
                <Spin size="small" />
                <span>正在同步正文工作台数据</span>
              </div>
            ) : null}
            <div className="chapter-console-page__pipeline">
              <PipelineBar items={pipelineItems} />
            </div>

            <div className="chapter-console-page__hero">
              <section className="chapter-console-page__panel chapter-console-page__hero-card">
                <SectionHeader
                  eyebrow="当前章节"
                  title={currentChapter ? `${formatChapterNumber(currentChapter.chapterNum)} · ${currentChapter.title || '未命名章节'}` : '请选择一个章节'}
                  description={currentChapter
                    ? `当前卷：${currentVolumeTruthStats.volumeName} · 状态：${currentStatusLabel} · ${wordCount} 字`
                    : '先从左侧章节列表选择当前要生产的一章。'}
                  extra={currentChapter ? <Tag color={currentChapter.status === 'final' ? 'success' : 'blue'}>{currentStatusLabel}</Tag> : null}
                />
                <div className="chapter-console-page__hero-meta">
                  <div><span>当前卷</span><strong>{currentVolumeTruthStats.volumeName}</strong></div>
                  <div><span>当前章</span><strong>{currentChapter ? formatChapterNumber(currentChapter.chapterNum) : '未选择'}</strong></div>
                  <div><span>版本状态</span><strong>{chapterVersions.length > 0 ? `${chapterVersions.length} 个版本` : '暂无历史版本'}</strong></div>
                  <div><span>可写性评分</span><strong>{`${chapterWritability.score}% · ${chapterWritability.label}`}</strong></div>
                </div>
              </section>

              <section className="chapter-console-page__panel chapter-console-page__writability-card">
                <SectionHeader
                  eyebrow="可写性判断"
                  title={`第 ${currentChapter?.chapterNum || '-'} 章可写性：${chapterWritability.label}`}
                  description={chapterWritability.summary}
                  extra={chapterWritability.ready ? <Tag color="success">可直接开写</Tag> : <Tag color="gold">建议先补缺口</Tag>}
                />
                <div className="chapter-console-page__writability-checks">
                  {chapterWritability.checks.map((item) => (
                    <div key={item.key} className={`chapter-console-page__writability-item ${item.ready ? 'is-ready' : 'is-risk'}`}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
                {chapterWritability.risks.length > 0 ? (
                  <div className="chapter-console-page__risk-note">
                    <strong>主要风险</strong>
                    <span>{chapterWritability.risks.slice(0, 2).join('；')}</span>
                  </div>
                ) : null}
              </section>
            </div>

            <div className={`chapter-console-page__grid${insightPanelOpen ? ' has-assist-panel' : ' is-assist-collapsed'}`}>
              <aside className="chapter-console-page__column chapter-console-page__column--left">
                <ChapterNavigator
                  chapters={chapters}
                  volumes={storyVolumes}
                  currentChapter={currentChapter}
                  currentChapterId={currentChapterId}
                  defaultAiExecutionMode={defaultAiExecutionMode}
                  executionModeOverride={generationExecutionModeOverride}
                  onExecutionModeChange={setGenerationExecutionModeOverride}
                  onSelectChapter={(chapterId) => void handleSelectChapter(chapterId)}
                  onAddChapter={(volumeId) => void handleAddChapter(volumeId)}
                  onDeleteChapter={(chapterId, event) => void handleDeleteChapter(chapterId, event)}
                  onOpenStructure={() => navigate(buildWorkspaceRoute(novelId, 'structure'))}
                />
              </aside>

              <section className="chapter-console-page__column chapter-console-page__column--center">
                <section className="chapter-console-page__panel chapter-console-page__editor-hero">
                  <div className="chapter-console-page__editor-hero-main">
                    <SectionHeader
                      eyebrow="写作主任务"
                      title={currentChapter ? `${formatChapterNumber(currentChapter.chapterNum)} · ${editorTitle}` : '请选择一个章节'}
                      description={primaryStatusText}
                    />
                    <div className="chapter-console-page__hero-meta chapter-console-page__hero-meta--compact">
                      <div><span>字数</span><strong>{currentChapter ? `${wordCount} 字` : '未开始'}</strong></div>
                      <div><span>可写性</span><strong>{`${chapterWritability.score}% · ${chapterWritability.label}`}</strong></div>
                      <div><span>版本</span><strong>{chapterVersions.length > 0 ? `${chapterVersions.length} 个` : '暂无'}</strong></div>
                      <div><span>状态</span><strong>{currentStatusLabel}</strong></div>
                    </div>
                  </div>
                  <div className="chapter-console-page__editor-hero-actions">
                    <Button onClick={() => setInsightPanelOpen((current) => !current)}>
                      {insightPanelOpen ? '收起辅助区' : '展开辅助区'}
                    </Button>
                    <Button onClick={() => navigateToWritingRoute('context')}>
                      上下文
                    </Button>
                    <Button onClick={() => navigateToWritingRoute('review')}>
                      审校
                    </Button>
                  </div>
                </section>

                <section className="chapter-console-page__panel chapter-console-page__editor-card">
                  <SectionHeader
                    eyebrow="正文编辑器"
                    title={editorTitle}
                    description={resolvedEditorSubtitle}
                    extra={currentChapter ? <Tag color="default">{`字数 ${wordCount}`}</Tag> : null}
                  />
                  <ActionBar align="between">
                    <div className="chapter-console-page__editor-status">
                      <CreativeStageScope
                        novelId={novelId}
                        value={creativeStageId || null}
                        onChange={(stageId) => {
                          const next = new URLSearchParams(searchParams)
                          if (stageId) next.set('stageId', String(stageId))
                          else next.delete('stageId')
                          setSearchParams(next)
                        }}
                      />
                      <Select
                        size="small"
                        className="writing-layout-select-default"
                        value={defaultAiExecutionMode}
                        loading={savingAiMode}
                        options={AI_EXECUTION_MODE_OPTIONS.map((item) => ({
                          value: item.value,
                          label: `默认·${item.label}`,
                        }))}
                        onChange={(value) => void handleDefaultAiModeChange(value)}
                      />
                      {selectedSnippet?.text ? <span>{`已选 ${selectedSnippet.text.length} 字`}</span> : null}
                    </div>
                    <div className="chapter-console-page__editor-actions">
                      <Button
                        onClick={() => {
                          if (!currentChapter || (currentChapter.segmentCount || 0) > 1) return
                          const latestText = normalizeEditorText(editorRef.current?.innerText || content)
                          void saveNow(currentChapter.id, latestText).then(() => {
                            message.success(getUserFacingMessage('writing.saved'))
                          }).catch((error) => {
                            console.error(error)
                            message.error(getErrorMessage(error, 'writing.saveFailed'))
                          })
                        }}
                        disabled={!currentChapter || hasMultiSegments}
                      >
                        保存
                      </Button>
                      {currentChapterGenerating ? (
                        <Button danger icon={<LoadingOutlined />} onClick={() => void handleCancelGenerate()}>
                          停止
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          icon={<RobotOutlined />}
                          disabled={!currentChapter || !generationPreflight.ready}
                          title={generationPreflight.ready ? '生成正文' : generationPreflight.messages[0] || '当前章节暂不适合生成'}
                          onClick={() => void handleGenerateContent()}
                        >
                          生成
                        </Button>
                      )}
                      <Button
                        icon={<RobotOutlined />}
                        disabled={!currentChapter || hasMultiSegments || !selectedSnippet?.text}
                        loading={rewritingSelection}
                        onClick={handleOpenRewriteModal}
                      >
                        重写
                      </Button>
                      <Button
                        icon={<RobotOutlined />}
                        disabled={!currentChapter || hasMultiSegments || currentChapterGenerating}
                        loading={optimizingChapter}
                        onClick={() => void handleOptimizeChapter()}
                      >
                        整章优化
                      </Button>
                      <Button icon={<FileSearchOutlined />} disabled={!currentChapter} onClick={() => void handleAiCheck()}>
                        审校
                      </Button>
                      <Button icon={<CheckOutlined />} disabled={!currentChapter} onClick={() => void handleStatusChange('final')}>
                        定稿
                      </Button>
                    </div>
                  </ActionBar>

                  {actionError ? (
                    <ActionErrorAlert
                      title={actionError.title}
                      message={actionError.message}
                      onRetry={actionError.retry}
                      onDismiss={() => setActionError(null)}
                    />
                  ) : null}

                  {currentChapterGenerating ? (
                    <StreamingOutput streamTaskId={activeGeneration.streamTaskId} />
                  ) : null}

                  {hasResumablePartialContent ? (
                    <Alert
                      showIcon
                      type={currentPipelineSnapshot?.status === 'cancelled' ? 'warning' : 'error'}
                      message="检测到可恢复的中断正文"
                      description={(
                        <div className="novel-writing-shell__segment-alert">
                          <div className="novel-writing-shell__segment-alert-copy">
                            {`已保留 ${countWords(resumablePartialContent)} 字正文草稿。当前恢复模式会基于这份内容继续往后写，不会重写前文。`}
                          </div>
                          <div className="novel-writing-shell__segment-alert-actions">
                            <Button size="small" type="primary" onClick={() => void handleResumePartialContent()}>
                              从断点继续
                            </Button>
                            <Button size="small" onClick={() => void handleRestartGeneration()}>
                              从头重来
                            </Button>
                          </div>
                        </div>
                      )}
                    />
                  ) : null}

                  <div className="chapter-console-page__editor-sheet-wrap">
                    {currentChapter ? (
                      hasMultiSegments ? (
                        <div className="novel-writing-shell__segment-preview">
                          <div
                            className="novel-writing-shell__editor-sheet novel-writing-shell__editor-sheet--readonly"
                          >
                            {content}
                          </div>
                          <SegmentBoardPreview
                            segments={chapterSegments}
                            onOpenStructure={() => navigate(buildWorkspaceRoute(novelId, 'structure'))}
                            onCompile={() => void handleCompileCurrentChapter()}
                          />
                        </div>
                      ) : (
                        <div
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={handleContentChange}
                          onMouseUp={syncSelectedSnippet}
                          onKeyUp={syncSelectedSnippet}
                          className="novel-writing-shell__editor-sheet"
                        >
                          {content}
                        </div>
                      )
                    ) : (
                      <div className="novel-empty novel-empty--writing">请选择左侧章节，或先创建一个新章节开始写作。</div>
                    )}
                  </div>

                  {editorAdvisoryCount > 0 ? (
                    <div className="chapter-console-page__advisory">
                      <button
                        type="button"
                        className="chapter-console-page__advisory-toggle"
                        onClick={() => setAdvisoryPanelOpen((current) => !current)}
                      >
                        {advisoryPanelOpen ? '收起' : '展开'}修订建议与验收（{editorAdvisoryCount}）
                      </button>
                      {advisoryPanelOpen ? (
                        <div className="chapter-console-page__advisory-body">
                          {productionBriefItems.length > 0 ? (
                            <div className="chapter-console-page__brief-strip">
                              {productionBriefItems.map((item) => (
                                <div key={item} className="chapter-console-page__brief-chip">{item}</div>
                              ))}
                            </div>
                          ) : null}
                          {currentChapterStaleReasons.length > 0 ? (
                            <Alert
                              showIcon
                              type="warning"
                              message="当前章节上下文已过期"
                              description={formatStaleReasonsSummary(currentChapterStaleReasons)}
                            />
                          ) : null}
                          {currentWritebackStatus?.readyForNextChapter === false ? (
                            <Alert
                              showIcon
                              type={currentWritebackStatus.phase === 'failed' ? 'error' : 'warning'}
                              message={currentWritebackStatus.candidateReady ? '候选已生成，等待正典应用' : '等待回写候选'}
                              description={`当前处于 ${getWritebackPhaseLabel(currentWritebackStatus.phase)}，正典${currentWritebackStatus.canonApplied ? '已应用' : '尚未应用'}。${currentWritebackStatus.lastError ? `原因：${currentWritebackStatus.lastError}` : '完成正典应用前，系统会暂停后续章节生成。'}`}
                            />
                          ) : null}
                          {publishCheck ? (
                            <Alert
                              showIcon
                              type={getPublishCheckAlertType(publishCheck)}
                              message={`章节验收：${publishCheck.summary}`}
                              description={`重写 ${publishCheck.rewriteCount} 项，阻塞 ${publishCheck.blockerCount} 项，预警 ${publishCheck.warningCount} 项。`}
                            />
                          ) : null}
                          {hasMultiSegments ? (
                            <Alert
                              showIcon
                              type="info"
                              message="当前章节处于多场景结构模式"
                              description={(
                                <div className="novel-writing-shell__segment-alert">
                                  <div className="novel-writing-shell__segment-alert-copy">
                                    该章节已经拆成多个场景。请优先维护场景合同，再重新编译整章。
                                  </div>
                                  <div className="novel-writing-shell__segment-alert-actions">
                                    <Button size="small" icon={<ApartmentOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'structure'))}>
                                      去结构页
                                    </Button>
                                    <Button size="small" icon={<BranchesOutlined />} onClick={() => void handleCompileCurrentChapter()}>
                                      重新编译
                                    </Button>
                                  </div>
                                </div>
                              )}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="chapter-console-page__panel chapter-console-page__review-strip">
                  <SectionHeader
                    eyebrow="轻量验收反馈"
                    title="当前章检查结果"
                    description="合同、连续性、AI 味与节奏的当前状态。"
                  />
                  <div className="chapter-console-page__acceptance-grid">
                    <TruncatedList
                      items={acceptanceCards}
                      limit={4}
                      renderItem={(item) => (
                        <div key={item.label} className="chapter-console-page__acceptance-card">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      )}
                    />
                  </div>
                  {qualityIssueItems.length > 0 ? (
                    <div className="chapter-console-page__quality-list">
                      <TruncatedList
                        items={qualityIssueItems}
                        limit={4}
                        renderItem={(item) => (
                          <div key={item} className="chapter-console-page__quality-item">{item}</div>
                        )}
                      />
                    </div>
                  ) : (
                    <div className="chapter-console-page__empty-copy">当前还没有新的审校问题。</div>
                  )}
                </section>
              </section>

              <InsightPanel
                open={insightPanelOpen}
                activeRoute={activeWritingRoute}
                chapterContractSections={chapterContractSections}
                sceneContractSections={sceneContractSections}
                onNavigate={navigateToWritingRoute}
              >
                {insightRouteContent}
              </InsightPanel>
            </div>

            <div className="chapter-console-page__footer">
              <div className="chapter-console-page__footer-grid">
                <section className="chapter-console-page__panel">
                  <SectionHeader
                    eyebrow="流水线元数据"
                    title="执行记录"
                    description="本次流水线运行记录。"
                  />
                  <div className="chapter-console-page__meta-grid">
                    {pipelineMetaItems.map((item) => (
                      <div key={item.label} className="chapter-console-page__meta-card">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <VersionTimeline
                  versions={chapterVersions}
                  selectedVersionId={selectedVersionId}
                  onSelect={setSelectedVersionId}
                  onRestore={() => void handleRestoreVersion()}
                />
              </div>
            </div>
          </>
        )}
      </div>
      <RewriteSelectionModal
        open={rewriteModalOpen}
        selectedText={selectedSnippet?.text || ''}
        requirements={rewriteRequirements}
        confirmLoading={rewritingSelection}
        onRequirementsChange={setRewriteRequirements}
        onCancel={() => setRewriteModalOpen(false)}
        onOk={() => void handleRewriteSelectedText()}
      />

      <OptimizeCandidateModal
        open={optimizeModalOpen}
        result={optimizationResult}
        requirements={optimizeRequirements}
        applying={applyingOptimizedChapter}
        onRequirementsChange={setOptimizeRequirements}
        onCancel={() => setOptimizeModalOpen(false)}
        onApply={() => void handleApplyOptimizedChapter()}
      />

      <ParallelGenerationModal novelId={novelId} chapters={chapters} />
    </>
  )
}

function SegmentBoardPreview({
  segments,
  onOpenStructure,
  onCompile,
}: {
  segments: ChapterSegment[]
  onOpenStructure: () => void
  onCompile: () => void
}) {
  return (
    <div className="novel-writing-shell__segment-board">
      <div className="novel-writing-shell__segment-board-head">
        <div>
          <div className="novel-kicker">场景结构</div>
          <strong>{segments.length} 个场景片段</strong>
        </div>
        <div className="novel-writing-shell__segment-board-actions">
          <Button size="small" icon={<ApartmentOutlined />} onClick={onOpenStructure}>结构页</Button>
          <Button size="small" icon={<BranchesOutlined />} onClick={onCompile}>编译章节</Button>
        </div>
      </div>
      <div className="novel-writing-shell__segment-board-grid">
        {segments.map((segment) => (
          <div key={segment.id} className="novel-writing-shell__segment-card">
            <div className="novel-writing-shell__segment-card-head">
              <span>{`场景 ${String(segment.segmentOrder).padStart(2, '0')}`}</span>
              <Tag color={segment.status === 'locked' ? 'success' : segment.status === 'draft' ? 'processing' : 'default'}>
                {segment.status || 'planned'}
              </Tag>
            </div>
            <strong>{segment.title || `场景 ${segment.segmentOrder}`}</strong>
            <div className="novel-writing-shell__segment-card-meta">
              <span>{segment.segmentType || 'scene'}</span>
              <span>{segment.locationName || '地点未定'}</span>
              <span>{segment.timeAnchor || '时间未定'}</span>
            </div>
            <div className="novel-writing-shell__segment-card-desc">
              {segment.purpose || segment.summary || '当前场景还没有明确作用。'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
