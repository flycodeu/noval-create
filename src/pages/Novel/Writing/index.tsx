import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Input, InputNumber, Modal, Progress, Select, Spin, Tag, message } from 'antd'
import {
  ApartmentOutlined,
  BranchesOutlined,
  BulbOutlined,
  CheckOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import AIScorePanel from '../../../components/AIScorePanel'
import ActionBar from '../../../components/novel/common/ActionBar'
import SectionHeader from '../../../components/novel/common/SectionHeader'
import ContractPanel, { type ContractPanelSection } from '../../../components/novel/writing/ContractPanel'
import ContextPanel, { type ContextPanelSection } from '../../../components/novel/writing/ContextPanel'
import PipelineBar, { type PipelineBarItem } from '../../../components/novel/writing/PipelineBar'
import VersionTimeline from '../../../components/novel/writing/VersionTimeline'
import {
  AI_EXECUTION_MODE_OPTIONS,
  getAiExecutionModeLabel,
  type AiExecutionMode,
} from '../../../shared/ai-execution'
import { getChapterWritabilitySummary } from '../../../shared/novel-workspace'
import {
  buildStorySettingsPayload,
  parseStorySettingsSnapshot,
} from '../../../shared/story-settings'
import type {
  Chapter,
  ChapterBridgePlan,
  ChapterContractAudit,
  ChapterContractValidationResult,
  ChapterContextPreview,
  ChapterPublishCheck,
  ChapterSegment,
  ExpressionDedupReport,
  HookContinuitySnapshot,
  Task,
  ChapterVersion,
  Character,
  ForeshadowLedgerEntry,
  ForeshadowSnapshot,
  NovelConsistencyReport,
  NovelContextStatus,
  ParallelGenerationPlan,
  QualityDashboardData,
  SummaryHealthReport,
  StoryFact,
  StoryFactCharacterKnowledge,
  StoryItem,
  StoryMemorySnapshot,
  StoryVolume,
  TimelineEvent,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTaskStore } from '../../../stores/task.store'
import { useWritingViewStore, type WritingGenerationSnapshot, type WritingGenerationStage } from '../../../stores/writingView.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspaceStepGuide } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import './index.css'

interface Props { novelId: number }
interface AiCheckPayload { score: number; issues: Array<{ type: string; location: string; suggestion: string }>; overall_feedback: string }
interface ContinuityPayload { plot_progress?: string[]; character_state_changes?: string[]; world_state_changes?: string[]; open_loops?: string[]; continuity_notes?: string[]; arc_progress?: string }
interface ScenePlanStep { scene_order: number; scene_title: string; purpose: string; location: string; time_anchor: string; present_characters: string[]; key_items: string[]; must_cover: string[]; climax_variant?: string }
interface ReviewNotes {
  summary: string
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks?: string[]
  context_drift_risks?: string[]
  realism_risks?: string[]
  coherence_risks?: string[]
  reader_hook_risks?: string[]
  language_risks: string[]
  human_language_repairs?: string[]
  genre_hollowing_risks: string[]
  revision_brief: string
  protagonist_setback?: 'none' | 'minor' | 'major'
  setback_summary?: string
  cost_present?: boolean
  cost_summary?: string
  cost_resolution_state?: 'new' | 'ongoing' | 'resolved' | 'evaporated'
  reversal_marker?: boolean
  reversal_summary?: string
  reversal_support_state?: 'supported' | 'weak' | 'forced'
  pace_marker?: 'setup' | 'conflict' | 'reversal' | 'climax' | 'payoff' | 'breather'
  reward_state?: 'none' | 'partial' | 'major'
  protagonist_pressure?: number
  dialogue_homogenization_risks?: string[]
  dialogue_fingerprint_summary?: string
  dialogue_voice_lock_summary?: string
  dialogue_filler_risks?: string[]
  dialogue_info_density_risks?: string[]
  required_voice_lock_character_ids?: number[]
  cross_character_similarity?: Array<{
    characterAId: number
    characterAName: string
    characterBId: number
    characterBName: string
    similarity: number
    reason: string
  }>
  dialogue_drift_alerts?: Array<{
    characterId: number
    characterName: string
    driftRate: number
    reason: string
  }>
  humanization_signals?: Array<{
    issueType: string
    title: string
    severity: 'low' | 'medium' | 'high'
    detail: string
    avoid: string
    prefer?: string
  }>
  contract_validation?: ChapterContractValidationResult
}
interface TextSelectionSnapshot {
  start: number
  end: number
  text: string
}
type WritingPipelineRole = 'planner' | 'writer' | 'critic' | 'rewriter' | 'canonizer' | 'finalize'

interface WritingPipelineRoleState {
  role: WritingPipelineRole
  label: string
  summary: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'blocked'
  detail?: string
  taskId?: number
  upstreamTaskId?: number
  contractVersion?: string
  canonRunId?: number
  durationMs?: number
  tokensUsed?: number
  failureCode?: string
  rewriteScope?: string
  targetSegmentId?: number | null
}

interface WritingPipelineSnapshot {
  kind: 'chapter_pipeline'
  chapterId: number
  workflowTaskId: number
  currentRole: WritingPipelineRole | null
  currentStage: WritingGenerationStage | null
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  message?: string
  streamTaskId?: number
  executionMode?: AiExecutionMode
  contractVersion?: string
  canonRunId?: number
  totalTokensUsed: number
  totalDurationMs: number
  failureCode?: string
  rewriteScope?: string
  targetSegmentId?: number | null
  roles: Record<WritingPipelineRole, WritingPipelineRoleState>
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
type WritingRouteKey = 'editor' | 'context' | 'review' | 'history'

const WritingEditorRoute = React.lazy(() => import('./routes/EditorRoute'))
const WritingContextRoute = React.lazy(() => import('./routes/ContextRoute'))
const WritingReviewRoute = React.lazy(() => import('./routes/ReviewRoute'))
const WritingHistoryRoute = React.lazy(() => import('./routes/HistoryRoute'))

const STATUS_OPTIONS = [
  { value: 'outline', label: '待写' },
  { value: 'writing', label: '写作中' },
  { value: 'draft', label: '草稿' },
  { value: 'reviewing', label: '审校中' },
  { value: 'final', label: '已完成' },
]

const PIPELINE_STAGES = [
  { key: 'planning', title: '场景计划', summary: '先拆出本章场景链和必须覆盖点。' },
  { key: 'drafting', title: '正文初稿', summary: '按计划生成初稿。' },
  { key: 'reviewing', title: '自动审校', summary: '检查连续性和语言问题。' },
  { key: 'rewriting', title: '修订定稿', summary: '按审校意见重写入库。' },
  { key: 'canonizing', title: 'Canon 草案', summary: '把正文转成可确认的 Canon 差异。' },
] as const

const STATUS_COLORS: Record<string, string> = { outline: '#5c6378', writing: '#2e86ab', draft: '#d48806', reviewing: '#c25f0a', final: '#389e0d' }

const parseNumberArray = (raw?: string | null) => {
  if (!raw) return []
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map((v) => Number(v)).filter(Number.isFinite) : [] } catch { return [] }
}
const parseStringArray = (raw?: string | null) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
      : []
  } catch {
    return []
  }
}
const parsePipelineSnapshot = (task?: Task | null): WritingPipelineSnapshot | null => {
  if (!task?.progressJson) return null
  try {
    const parsed = JSON.parse(task.progressJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return record.kind === 'chapter_pipeline' ? record as unknown as WritingPipelineSnapshot : null
  } catch {
    return null
  }
}
const parseCharacterKnowledgeJson = (raw?: string | null): StoryFactCharacterKnowledge[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const normalized: StoryFactCharacterKnowledge[] = []
    parsed.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const record = entry as Record<string, unknown>
      const characterId = Number(record.characterId)
      if (!Number.isFinite(characterId) || characterId <= 0) return
      const knownChapterId = Number(record.knownChapterId)
      normalized.push({
        characterId,
        knownChapterId: Number.isFinite(knownChapterId) && knownChapterId > 0
          ? knownChapterId
          : null,
      })
    })
    return normalized
  } catch {
    return []
  }
}
const parseContinuity = (raw?: string) => { try { return raw ? JSON.parse(raw) as ContinuityPayload : null } catch { return null } }
const parseScenePlan = (raw?: string) => { try { const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed as ScenePlanStep[] : [] } catch { return [] } }
const parseReviewNotes = (raw?: string) => { try { return raw ? JSON.parse(raw) as ReviewNotes : null } catch { return null } }
const parseContractAudit = (raw?: string) => { try { return raw ? JSON.parse(raw) as ChapterContractAudit : null } catch { return null } }
const parseBridgePlan = (raw?: string) => { try { return raw ? JSON.parse(raw) as ChapterBridgePlan : null } catch { return null } }
const parseSummaryHealth = (raw?: string) => { try { return raw ? JSON.parse(raw) as SummaryHealthReport : null } catch { return null } }
const parseExpressionDedup = (raw?: string) => { try { return raw ? JSON.parse(raw) as ExpressionDedupReport : null } catch { return null } }
const parseHookContinuity = (raw?: string) => { try { return raw ? JSON.parse(raw) as HookContinuitySnapshot : null } catch { return null } }
const countWords = (text: string) => ((text.match(/[一-龥]/g) || []).length + (text.match(/\b[a-zA-Z]+\b/g) || []).length)
const formatChapterNumber = (chapterNum?: number) => typeof chapterNum === 'number' ? `第${chapterNum}章` : '章节号待补'
const getStatusLabel = (status?: Chapter['status']) => STATUS_OPTIONS.find((item) => item.value === status)?.label || '未设置'
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
const getWorldRulesSummary = (raw?: string) => {
  if (!raw) return []
  try {
    const rules = JSON.parse(raw) as Record<string, unknown>
    const power = rules.power_system && typeof rules.power_system === 'object' ? (rules.power_system as Record<string, unknown>).name : ''
    return [
      typeof power === 'string' && power.trim() ? `力量体系：${power.trim()}` : '',
      typeof rules.social_structure === 'string' && rules.social_structure.trim() ? `社会结构：${rules.social_structure.trim()}` : '',
      Array.isArray(rules.forbidden_elements) && rules.forbidden_elements.length > 0 ? `禁用元素：${rules.forbidden_elements.slice(0, 3).join('、')}` : '',
    ].filter(Boolean)
  } catch { return [] }
}

function normalizeIdArray(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))]
}

function getCurrentVolumeNumber(chapter: Chapter | null, volumes: StoryVolume[]): number | null {
  if (!chapter?.volumeId) return null
  const currentVolume = volumes.find((volume) => volume.id === chapter.volumeId) || null
  return currentVolume?.volumeNumber || null
}

function computeVolumeTruthRevealStats(
  chapter: Chapter | null,
  volumes: StoryVolume[],
  facts: StoryFact[],
) {
  const volumeNumber = getCurrentVolumeNumber(chapter, volumes)
  if (!volumeNumber) {
    return {
      volumeName: '待绑定卷',
      volumeNumber: null,
      totalTruths: 0,
      plannedTruths: 0,
      ratio: 0,
      limit: null as number | null,
      overLimit: false,
    }
  }
  const currentVolume = volumes.find((volume) => volume.volumeNumber === volumeNumber) || null
  const truthFacts = facts.filter((fact) => fact.kind === 'truth' && fact.isKeyTruth !== 0)
  const totalTruths = truthFacts.length
  const plannedTruths = truthFacts.filter((fact) => fact.plannedRevealVolume === volumeNumber).length
  const ratio = totalTruths > 0 ? plannedTruths / totalTruths : 0
  const limit = typeof currentVolume?.maxTruthRevealRatio === 'number' ? currentVolume.maxTruthRevealRatio : null
  return {
    volumeName: currentVolume?.title?.trim() || `第${volumeNumber}卷`,
    volumeNumber,
    totalTruths,
    plannedTruths,
    ratio,
    limit,
    overLimit: limit !== null && ratio > limit,
  }
}

function normalizeEditorText(value?: string | null): string {
  return (value || '').replace(/\r\n/g, '\n')
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

  const text = normalizeEditorText(range.toString()).trim()
  if (!text) return null

  const start = normalizeEditorText(prefixRange.toString()).length
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

function getGenerationTagMeta(snapshot: WritingGenerationSnapshot) {
  if (snapshot.status === 'running') return { color: 'processing' as const, label: '生成中' }
  if (snapshot.status === 'failed') return { color: 'error' as const, label: '失败' }
  if (snapshot.status === 'cancelled') return { color: 'default' as const, label: '已取消' }
  return { color: 'success' as const, label: '刚完成' }
}

function getGenerationAlertType(snapshot: WritingGenerationSnapshot): 'info' | 'success' | 'error' | 'warning' {
  if (snapshot.status === 'failed') return 'error'
  if (snapshot.status === 'cancelled') return 'warning'
  if (snapshot.status === 'success') return 'success'
  return 'info'
}

function getGenerationAlertMessage(snapshot: WritingGenerationSnapshot) {
  if (snapshot.status === 'failed') return snapshot.label || '章节流水线执行失败'
  if (snapshot.status === 'cancelled') return snapshot.label || '章节流水线已取消'
  if (snapshot.status === 'success') {
    return snapshot.detail?.includes('未产生新增内容')
      ? '章节流水线已完成，但正文没有新增内容'
      : (snapshot.label || '章节流水线已完成')
  }
  return snapshot.label || 'AI 正在处理当前章节'
}

function getGenerationAlertDescription(snapshot: WritingGenerationSnapshot) {
  if (snapshot.status === 'failed') return snapshot.error || snapshot.detail || getUserFacingMessage('writing.generateFailed')
  if (snapshot.status === 'cancelled') return snapshot.detail || getUserFacingMessage('writing.generateCancelled')
  if (snapshot.status === 'success') return snapshot.detail || getUserFacingMessage('writing.pipelineCompleted')
  return snapshot.detail || '正在推进当前章的流水线阶段。'
}

export default function Writing({ novelId }: Props) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const { chapters, currentChapterId, currentNovel, setChapters, setCurrentChapterId, setCurrentNovel, updateChapter } = useNovelStore()
  const { streams, clearStream } = useTaskStore()
  const {
    activeGeneration,
    lastGenerationByChapter,
    startGeneration,
    updateGenerationTask,
    updateGenerationStage,
    completeGeneration,
    clearChapterGenerationNotice,
  } = useWritingViewStore()
  const editorRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentChapterIdRef = useRef<number | null>(null)
  const routeChapterFocusRef = useRef<number | null>(null)
  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])
  const historyBaselineRef = useRef('')
  const lastHistoryAtRef = useRef(0)
  const generationBaselineRef = useRef('')

  const [loading, setLoading] = useState(true)
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [storyMemory, setStoryMemory] = useState<StoryMemorySnapshot | null>(null)
  const [foreshadowSnapshot, setForeshadowSnapshot] = useState<ForeshadowSnapshot | null>(null)
  const [foreshadowLedger, setForeshadowLedger] = useState<ForeshadowLedgerEntry[]>([])
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [storyItems, setStoryItems] = useState<StoryItem[]>([])
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
  const [hoverChapterId, setHoverChapterId] = useState<number | null>(null)
  const [selectedSnippet, setSelectedSnippet] = useState<TextSelectionSnapshot | null>(null)
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false)
  const [rewriteRequirements, setRewriteRequirements] = useState('')
  const [rewritingSelection, setRewritingSelection] = useState(false)
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false)
  const [chapterVersions, setChapterVersions] = useState<ChapterVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const routeChapterId = useMemo(() => parseRouteId(searchParams.get('chapterId')), [searchParams])
  const activeWritingRoute = useMemo<WritingRouteKey>(() => {
    const routeKey = location.pathname.split('/').filter(Boolean)[4]
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

  useEffect(() => { currentChapterIdRef.current = currentChapterId }, [currentChapterId])

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

  const refreshVersionHistory = useCallback(async (chapterId: number) => {
    setVersionHistoryLoading(true)
    try {
      const versions = await window.electron.chapter.listVersions(chapterId)
      setChapterVersions(versions)
      setSelectedVersionId((current) => current && versions.some((item) => item.id === current)
        ? current
        : versions[0]?.id || null)
    } finally {
      setVersionHistoryLoading(false)
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

  const refreshForeshadowSnapshot = useCallback(async (chapter?: Chapter | null) => {
    if (!chapter) {
      setForeshadowSnapshot(null)
      return
    }
    try {
      setForeshadowSnapshot(await window.electron.thread.getForeshadowSnapshot(novelId, chapter.chapterNum))
    } catch (error) {
      console.error('Failed to load foreshadow snapshot', error)
      setForeshadowSnapshot(null)
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

  const refreshChapterLinks = useCallback(async (chapter?: Chapter | null) => {
    if (!chapter) {
      setTimelineEvents([])
      setStoryItems([])
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

    setTimelineEvents(eventPage.items)
    setStoryItems(itemRows.filter((item): item is StoryItem => Boolean(item)))
  }, [novelId])

  const refreshContextStatus = useCallback(async () => {
    setContextStatus(await window.electron.novel.getContextStatus(novelId))
  }, [novelId])

  const refreshChapterContextPreview = useCallback(async (chapter?: Chapter | null) => {
    if (!chapter) {
      setChapterContextPreview(null)
      return
    }
    try {
      setChapterContextPreview(await window.electron.chapter.getContextPreview(chapter.id, {
        executionMode: effectiveAiExecutionMode,
      }))
    } catch (error) {
      console.error('Failed to load chapter context preview', error)
      setChapterContextPreview(null)
    }
  }, [effectiveAiExecutionMode])

  const refreshPublishCheck = useCallback(async (chapterId: number) => {
    const nextCheck = await window.electron.chapter.runPublishCheck(chapterId)
    setPublishCheck(nextCheck)
    setCurrentChapter((current) => current && current.id === chapterId
      ? { ...current, contractAuditJson: JSON.stringify(nextCheck.contractAudit) }
      : current)
  }, [])

  const refreshLatestPipelineTask = useCallback(async (chapterId?: number) => {
    if (!chapterId) {
      setLatestPipelineTask(null)
      return
    }
    try {
      setLatestPipelineTask(await window.electron.task.getLatestChapterPipeline(chapterId))
    } catch {
      setLatestPipelineTask(null)
    }
  }, [])

  const refreshChapter = useCallback(async (chapterId: number) => {
    clearChapterArtifacts()
    setLivePipelineSnapshot(null)
    const [full, segments] = await Promise.all([
      window.electron.chapter.get(chapterId),
      window.electron.structure.listSegments(chapterId),
    ])
    if (!full) return
    setChapterSegments(segments)
    setCurrentChapter(full)
    setContent(full.content || '')
    setWordCount(countWords(full.content || ''))
    resetEditorHistory(full.content || '')
    updateChapter(chapterId, full)
    if (editorRef.current) editorRef.current.innerHTML = (full.content || '').replace(/\n/g, '<br>')
    if (isHistoryRoute) {
      await refreshVersionHistory(chapterId)
    }
    await Promise.all([
      refreshPublishCheck(chapterId),
      refreshContextStatus(),
      refreshChapterLinks(full),
      refreshForeshadowSnapshot(full),
      refreshForeshadowLedger(),
      refreshChapterContextPreview(full),
      refreshLatestPipelineTask(chapterId),
    ])
  }, [clearChapterArtifacts, isHistoryRoute, refreshChapterContextPreview, refreshChapterLinks, refreshContextStatus, refreshForeshadowLedger, refreshForeshadowSnapshot, refreshLatestPipelineTask, refreshPublishCheck, refreshVersionHistory, resetEditorHistory, updateChapter])

  const loadChapters = useCallback(async (preferredChapterId?: number) => {
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)
    if (list.length === 0) {
      resetEditorHistory('')
      setCurrentChapter(null); setCurrentChapterId(null); setContent(''); setWordCount(0); setPublishCheck(null); setLatestPipelineTask(null); setLivePipelineSnapshot(null); setChapterSegments([]); setTimelineEvents([]); setStoryItems([]); setForeshadowSnapshot(null); await refreshContextStatus(); return
    }
    const target = list.find((chapter) => chapter.id === (preferredChapterId ?? currentChapterIdRef.current)) || list[0]
    setCurrentChapterId(target.id)
    await refreshChapter(target.id)
  }, [novelId, refreshChapter, refreshContextStatus, resetEditorHistory, setChapters, setCurrentChapterId])

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      try {
        await Promise.all([
          loadChapters(routeChapterId || undefined),
          refreshMeta(),
          refreshContextStatus(),
          refreshQualityDashboard(),
          refreshInfoGapAssets(),
          refreshForeshadowLedger(),
        ])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [loadChapters, refreshContextStatus, refreshForeshadowLedger, refreshInfoGapAssets, refreshMeta, refreshQualityDashboard, routeChapterId])

  useEffect(() => {
    if (!routeChapterId || routeChapterFocusRef.current === routeChapterId) return
    routeChapterFocusRef.current = routeChapterId
    void loadChapters(routeChapterId)
  }, [loadChapters, routeChapterId])

  useEffect(() => {
    const unsubscribe = window.electron.on('chapter:generation-progress', (data: unknown) => {
      const payload = data as ChapterGenerationProgressEvent
      if (!payload?.chapterId) return
      if (payload.pipeline) setLivePipelineSnapshot(payload.pipeline)
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
            loadChapters(payload.chapterId),
            refreshMeta(),
            refreshQualityDashboard(),
            refreshLatestPipelineTask(payload.chapterId),
          ])
          await refreshChapter(payload.chapterId)
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
              : '章节流水线已完成，但正文未产生新增内容。请优先检查合同、审校意见与 Canon 草案。',
          })
          message.success(getUserFacingMessage('writing.pipelineCompleted'))
        })()
        return
      }

      if (payload.status === 'failed' || payload.status === 'cancelled') {
        if (payload.streamTaskId) clearStream(payload.streamTaskId)
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
        } else {
          message.error(getUserFacingMessage('writing.generateFailed'))
        }
      }
    })
    return unsubscribe
  }, [clearStream, completeGeneration, loadChapters, refreshChapter, refreshLatestPipelineTask, refreshMeta, refreshQualityDashboard, updateGenerationStage, updateGenerationTask])

  useEffect(() => {
    if (!isHistoryRoute || !currentChapter) return
    void refreshVersionHistory(currentChapter.id)
  }, [currentChapter, isHistoryRoute, refreshVersionHistory])

  useEffect(() => {
    if (!currentChapter) {
      setChapterVersions([])
      setSelectedVersionId(null)
      return
    }
    void refreshVersionHistory(currentChapter.id)
  }, [currentChapter, refreshVersionHistory])

  useEffect(() => {
    if (!currentChapter) return
    void refreshChapterContextPreview(currentChapter)
  }, [currentChapter, effectiveAiExecutionMode, refreshChapterContextPreview])

  useEffect(() => {
    if (!activeGeneration.taskId || !activeGeneration.chapterId) return
    const stream = streams[activeGeneration.taskId]
    if (!stream) return
    if (stream.status === 'completed') {
      const chapterId = activeGeneration.chapterId
      clearStream(stream.taskId)
      void (async () => {
        await Promise.all([loadChapters(chapterId), refreshMeta(), refreshQualityDashboard()])
        if (chapterId) await refreshChapter(chapterId)
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
      })()
    }
    if (stream.status === 'failed') {
      clearStream(stream.taskId)
      completeGeneration({
        taskId: stream.taskId,
        chapterId: activeGeneration.chapterId,
        status: 'failed',
        stage: activeGeneration.stage,
        label: '章节流水线执行失败',
        detail: activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
        error: activeGeneration.error || activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
      })
      message.error(getUserFacingMessage('writing.generateFailed'))
    }
    if (stream.status === 'cancelled') {
      clearStream(stream.taskId)
      completeGeneration({
        taskId: stream.taskId,
        chapterId: activeGeneration.chapterId,
        status: 'cancelled',
        stage: activeGeneration.stage,
        label: '章节流水线已取消',
        detail: getUserFacingMessage('writing.generateCancelled'),
      })
      message.info(getUserFacingMessage('writing.generateCancelled'))
    }
  }, [activeGeneration, clearStream, completeGeneration, loadChapters, refreshChapter, refreshMeta, refreshQualityDashboard, streams])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    clearChapterArtifacts()
  }, [clearChapterArtifacts])

  const saveNow = useCallback(async (
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

  const queueSave = useCallback((
    chapterId: number,
    text: string,
    versionSource: 'manual-save' | 'ai-rewrite' = 'manual-save',
  ) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveNow(chapterId, text, versionSource).catch(console.error)
    }, 1500)
  }, [saveNow])

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
    if (editorRef.current) {
      editorRef.current.innerHTML = normalized.replace(/\n/g, '<br>')
    }
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
      pathname: `/novels/${novelId}/writing/${routeKey}`,
      search: search ? `?${search}` : '',
    })
  }, [navigate, novelId, searchParams])

  const handleOpenVersionHistory = useCallback(async () => {
    if (!currentChapter) return
    navigateToWritingRoute('history')
    await refreshVersionHistory(currentChapter.id)
  }, [currentChapter, navigateToWritingRoute, refreshVersionHistory])

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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
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
      if (rewriteModalOpen) {
        setRewriteModalOpen(false)
        return
      }
      if (isHistoryRoute) {
        navigateToWritingRoute('editor')
      }
    })

    return () => registerEscapeHandler(null)
  }, [isHistoryRoute, navigateToWritingRoute, registerEscapeHandler, rewriteModalOpen])

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

  const handleGenerateContent = async () => {
    if (!currentChapter) return message.warning(getUserFacingMessage('writing.selectChapterFirst'))
    generationBaselineRef.current = normalizeEditorText(currentChapter.content || content)
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
      message.error(errorMessage)
    }
  }

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

  const handleGenerateSummary = async () => {
    if (!currentChapter) return
    try {
      await window.electron.chapter.generateSummary(currentChapter.id)
      await Promise.all([loadChapters(currentChapter.id), refreshMeta(), refreshContextStatus()])
      message.success(getUserFacingMessage('writing.summaryUpdated'))
    } catch (error: unknown) {
      message.error(getUserFacingMessage('writing.summaryUpdateFailed', {
        detail: error instanceof Error ? error.message : '请稍后重试。',
      }))
    }
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
    try {
      setAiResult(await window.electron.chapter.aiCheck(currentChapter.id) as AiCheckPayload)
      navigateToWritingRoute('review')
      await refreshQualityDashboard()
    }
    catch (error: unknown) {
      message.error(getUserFacingMessage('writing.aiCheckFailed', {
        detail: error instanceof Error ? error.message : '请稍后重试。',
      }))
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

  const handleOpenGateIssue = useCallback((item: ChapterPublishCheck['checklist'][number]) => {
    if (!currentChapter) return
    if (item.relatedPage === 'structure') {
      const params = new URLSearchParams({ chapterId: String(currentChapter.id) })
      if (typeof item.segmentId === 'number') params.set('segmentId', String(item.segmentId))
      navigate(`/novels/${novelId}/structure?${params.toString()}`)
      return
    }
    if (item.relatedPage === 'contracts') {
      navigate(`/novels/${novelId}/contracts?chapterId=${currentChapter.id}`)
      return
    }
    if (item.relatedPage === 'revision') {
      navigate(`/novels/${novelId}/revision`)
      return
    }
    if (item.relatedPage === 'volume-design') {
      navigate(`/novels/${novelId}/volume-design`)
      return
    }
    if (item.relatedPage === 'threads') {
      navigate(`/novels/${novelId}/threads`)
      return
    }
    navigateToWritingRoute('editor')
    message.info(item.status === 'rewrite'
      ? '回到正文后先处理重写项，再重新执行章节验收。'
      : '回到正文页处理当前验收问题。')
  }, [currentChapter, navigate, navigateToWritingRoute, novelId])

  const handleStatusChange = async (status: string) => {
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
            <div className="novel-note-list" style={{ marginTop: 12 }}>
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
            <div className="novel-note-list" style={{ marginTop: 12 }}>
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
            navigate(`/novels/${novelId}/contracts?chapterId=${currentChapter.id}`)
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
              <div className="novel-note-list" style={{ marginTop: 12 }}>
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

  const handleAddChapter = async () => {
    const nextNum = chapters.length > 0 ? Math.max(...chapters.map((chapter) => chapter.chapterNum)) + 1 : 1
    const chapterId = await window.electron.chapter.create(novelId, { chapterNum: nextNum, title: `第${nextNum}章`, status: 'outline' })
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
      onOk: async () => { await window.electron.chapter.delete(chapterId); await Promise.all([loadChapters(), refreshMeta(), refreshContextStatus()]) },
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
    () => publishCheck?.contractAudit || parseContractAudit(currentChapter?.contractAuditJson),
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
  const currentChapterStaleReasons = useMemo(() => parseStringArray(currentChapter?.staleReasonJson), [currentChapter?.staleReasonJson])
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

  const persistedPipelineSnapshot = useMemo(
    () => parsePipelineSnapshot(latestPipelineTask),
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

  const currentChapterGeneration = currentChapter
    ? (
      activeGeneration.chapterId === currentChapter.id && activeGeneration.status !== 'idle'
        ? activeGeneration
        : lastGenerationByChapter[currentChapter.id] || null
    )
    : null
  const currentChapterGenerating = currentChapterGeneration?.status === 'running'
    && activeGeneration.chapterId === currentChapter?.id
  const pipelineStatus = PIPELINE_STAGES.map((stage, index) => {
    const running = currentChapterGeneration?.status === 'running' && currentChapterGeneration.stage === stage.key
    const failed = currentChapterGeneration?.status === 'failed' && currentChapterGeneration.stage === stage.key
    const done = currentChapterGeneration?.status === 'success'
      || currentChapterGeneration?.stage === 'completed'
      || (stage.key === 'planning' && scenePlan.length > 0)
      || (stage.key === 'drafting' && Boolean(currentChapter?.content || reviewNotes))
      || (stage.key === 'reviewing' && Boolean(reviewNotes))
      || (stage.key === 'rewriting' && Boolean(currentChapter?.content))
      || (stage.key === 'canonizing' && Boolean(currentPipelineSnapshot?.canonRunId))
    return { ...stage, index, status: failed ? 'failed' : running ? 'running' : done ? 'done' : 'pending' }
  })
  const pipelineRoleItems = useMemo(() => {
    const order: WritingPipelineRole[] = ['planner', 'writer', 'critic', 'rewriter', 'canonizer']
    return order.map((role) => currentPipelineSnapshot?.roles[role]).filter(Boolean) as WritingPipelineRoleState[]
  }, [currentPipelineSnapshot])

  const currentStatusLabel = currentChapter ? getStatusLabel(currentChapter.status) : '未选择章节'
  const otherStaleChapterCount = Math.max(0, (contextStatus?.staleChapterCount || 0) - (currentChapterStaleReasons.length > 0 ? 1 : 0))
  const streamContent = currentChapterGenerating && activeGeneration.streamTaskId
    ? streams[activeGeneration.streamTaskId]?.content || ''
    : ''
  const hasMultiSegments = (currentChapter?.segmentCount || 0) > 1
  const editorEyebrow = currentChapter ? `第 ${String(currentChapter.chapterNum).padStart(2, '0')} 章` : '写作编辑器'
  const editorTitle = currentChapter ? currentChapter.title || `第${currentChapter.chapterNum}章` : '请选择一个章节'
  const editorSubtitle = currentChapter
    ? `当前状态：${currentStatusLabel} · 当前正文视为入库稿，停止输入后会自动保存。`
    : '从左侧选择章节后即可直接编辑，右侧同步查看本章链路、修订建议与体检结果。'

  const resolvedEditorSubtitle = hasMultiSegments
    ? `当前状态：${currentStatusLabel} · 本章已拆成 ${currentChapter?.segmentCount || 0} 个场景，请优先在结构页维护场景后再编译整章。`
    : editorSubtitle

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
        <InsightCard title="长篇写作架构" eyebrow="Planner / Writer / Critic / Rewriter / Canonizer" tone="soft">
          {currentPipelineSnapshot ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="novel-copy-block">
                {`当前阶段：${currentPipelineSnapshot.currentRole ? currentPipelineSnapshot.roles[currentPipelineSnapshot.currentRole]?.label || currentPipelineSnapshot.currentRole : '待启动'} · AI 模式 ${currentPipelineSnapshot.executionMode ? getAiExecutionModeLabel(currentPipelineSnapshot.executionMode) : '未记录'} · 合同版本 ${currentPipelineSnapshot.contractVersion || '未记录'} · 总耗时 ${currentPipelineSnapshot.totalDurationMs ? `${(currentPipelineSnapshot.totalDurationMs / 1000).toFixed(1)}s` : '-'} · 总 tokens ${currentPipelineSnapshot.totalTokensUsed || 0}${currentPipelineSnapshot.failureCode ? ` · 退出码 ${currentPipelineSnapshot.failureCode}` : ''}`}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {pipelineRoleItems.map((item) => (
                  <div key={item.role} className="novel-issue-item">
                    <div className="novel-issue-item__head">
                      <Tag color={item.status === 'success' ? 'success' : item.status === 'running' ? 'processing' : item.status === 'blocked' ? 'warning' : item.status === 'failed' ? 'error' : 'default'}>
                        {item.status === 'success' ? '已完成' : item.status === 'running' ? '执行中' : item.status === 'blocked' ? '已阻断' : item.status === 'failed' ? '失败' : '待执行'}
                      </Tag>
                      <strong>{item.label}</strong>
                      {item.taskId ? <Tag color="blue">{`任务 #${item.taskId}`}</Tag> : null}
                      {item.canonRunId ? <Tag color="geekblue">{`Canon #${item.canonRunId}`}</Tag> : null}
                    </div>
                    <div className="novel-issue-item__desc">{item.detail || item.summary}</div>
                    <div className="novel-issue-item__suggestion">
                      {`预算：${item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : '-'} / ${item.tokensUsed || 0} tokens${item.failureCode ? ` · ${item.failureCode}` : ''}${item.rewriteScope ? ` · ${item.rewriteScope}` : ''}${typeof item.targetSegmentId === 'number' ? ` · scene#${item.targetSegmentId}` : ''}`}
                    </div>
                  </div>
                ))}
              </div>
              {currentPipelineSnapshot.canonRunId ? (
                <div className="novel-copy-block">{`Canonizer 已生成回写草案 #${currentPipelineSnapshot.canonRunId}，可直接进入章后状态回写中心确认。`}</div>
              ) : null}
            </div>
          ) : <div className="novel-copy-block">当前章节还没有最近一次角色化流水线快照。</div>}
        </InsightCard>
        <InsightCard title="关键约束注入" eyebrow="本章关键约束已注入" tone="soft">
          <ConstraintInjectionCard preview={chapterContextPreview} />
        </InsightCard>
        <InsightCard title="上一章关键先验" eyebrow="承接上一章的真实输入" tone="soft">
          <PreviousChapterFeedCard preview={chapterContextPreview} />
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
            onOpenBoard={() => navigate(`/novels/${novelId}/info-gap-board`)}
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
            onOpenLedger={() => navigate(`/novels/${novelId}/foreshadow-ledger`)}
          />
        </InsightCard>
        <InsightCard title="本章应回收伏笔" eyebrow={foreshadowSnapshot ? `按第 ${foreshadowSnapshot.currentChapterNum} 章进度计算` : '即将到期 / 超期未收'} tone="soft">
          <StringList items={dueForeshadowItems} empty="当前章节附近没有到期或超期未收的伏笔债务。" />
        </InsightCard>
        <InsightCard title="修订提示" eyebrow="复盘重点" tone="soft"><StringList items={reviewInsightItems} empty="先运行审校或刷新摘要，再集中处理需要回看的修订点。" /></InsightCard>
        <InsightCard title="世界规则" eyebrow="写作边界" tone="soft"><StringList items={worldRulesSummary} empty={currentNovel?.worldRulesJson ? '本章暂未命中明确的世界边界。' : '先完善世界规则，再回来校对本章边界。'} /></InsightCard>
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
                  <Button size="small" onClick={() => navigate(`/novels/${novelId}/quality`)}>
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
        <InsightCard title="章后状态回写" eyebrow="Canon 确认 / 统一写回" tone="soft">
          {currentChapter ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="novel-copy-block">写完本章后，在这里进入独立回写中心，先确认事实抽取和状态候选，再统一写回线程、伏笔、谜题、关系、物品与时间轴。</div>
              <div>
                <Button onClick={() => navigate(`/novels/${novelId}/writeback?chapterId=${currentChapter.id}`)}>
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
          {aiResult ? <div style={{ marginTop: 12 }}><AiCheckResult result={aiResult} /></div> : <div className="novel-copy-block" style={{ marginTop: 12 }}>点击上方 AI 体检后，这里也会展示语义与表达层面的复检结果。</div>}
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
                  className={`novel-sidebar__nav-item ${selectedVersion?.id === version.id ? 'novel-sidebar__nav-item--active' : ''}`}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  <span className="novel-sidebar__nav-copy">
                    <strong>{chapterVersionSourceLabel(version.versionSource)}</strong>
                    <small>{`${version.wordCount || 0} 字 · ${new Date(version.createdAt).toLocaleString()}`}</small>
                  </span>
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="novel-copy-block" style={{ whiteSpace: 'pre-wrap', minHeight: 320 }}>
                {selectedVersion?.content || '先从左侧选择版本，再比较正文差异。'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
          currentChapter?.targetWords ? `目标字数：${currentChapter.targetWords} 字` : '',
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

  const locationStatusItems = useMemo(() => {
    const values = [
      ...scenePlan.map((scene) => scene.location || ''),
      ...relatedEvents.map((event) => event.timeLabel && event.eventTitle ? `${event.timeLabel} · ${event.eventTitle}` : event.eventTitle),
    ].filter(Boolean)
    return [...new Set(values)].slice(0, 6)
  }, [relatedEvents, scenePlan])

  const worldFactItems = useMemo(() => {
    const factPool = storyFacts.filter((fact) => (
      allowedRevealFactIds.includes(fact.id)
      || revealedFactIds.includes(fact.id)
      || (fact.targetRevealChapterId != null && fact.targetRevealChapterId === currentChapter?.id)
    ))
    return (factPool.length > 0 ? factPool : storyFacts.filter((fact) => fact.isKeyTruth !== 0)).slice(0, 6).map((fact) => (
      `${fact.title}${fact.summary ? ` · ${fact.summary}` : ''}`
    ))
  }, [allowedRevealFactIds, currentChapter?.id, revealedFactIds, storyFacts])

  const puzzleItems = useMemo(
    () => storyFacts
      .filter((fact) => fact.relatedPuzzleId != null)
      .slice(0, 6)
      .map((fact) => `${fact.title}${fact.notes ? ` · ${fact.notes}` : ''}`),
    [storyFacts],
  )

  const characterStateItems = useMemo(
    () => chapterCharacters.slice(0, 6).map((character) => (
      `${character.fullName} · ${character.goals || character.surfaceDesire || character.innerConflict || character.background || '已载入人物状态'}`
    )),
    [chapterCharacters],
  )

  const recallItems = useMemo(() => (
    chapterContextPreview?.recalledMemorySources.slice(0, 6).map((item) => (
      `${item.sourceLabel} · ${item.summary}${item.stale ? ' · 已过期' : ''}`
    )) || chapterContextPreview?.recallDiagnostics.summaryLines.slice(0, 6) || []
  ), [chapterContextPreview?.recalledMemorySources, chapterContextPreview?.recallDiagnostics.summaryLines])

  const qualityIssueItems = useMemo(() => ([
    ...(publishCheck?.checklist || [])
      .filter((item) => item.status === 'rewrite' || item.status === 'blocker' || item.status === 'warning')
      .slice(0, 6)
      .map((item) => `${item.label}：${item.detail}`),
    ...chapterIssues.slice(0, 4).map((issue) => `${issue.title}：${issue.description || issue.suggestion || '需要修订'}`),
    ...(aiResult?.issues || []).slice(0, 4).map((issue) => `${issue.type}：${issue.suggestion}`),
  ]), [aiResult?.issues, chapterIssues, publishCheck?.checklist])

  const contextSections = useMemo<ContextPanelSection[]>(() => ([
    {
      key: 'recall',
      title: '上下文召回',
      items: recallItems,
    },
    {
      key: 'characters',
      title: '相关人物状态',
      items: characterStateItems,
    },
    {
      key: 'locations',
      title: '地点状态',
      items: locationStatusItems,
    },
    {
      key: 'facts',
      title: '世界事实',
      items: worldFactItems,
    },
    {
      key: 'foreshadow',
      title: '伏笔快照',
      items: dueForeshadowItems.slice(0, 6),
    },
    {
      key: 'puzzles',
      title: '谜题信息',
      items: puzzleItems,
    },
    {
      key: 'timeline',
      title: '时间轴锚点',
      items: relatedEvents.slice(0, 6).map((event) => `${event.timeLabel || '时间未标注'} · ${event.eventTitle}`),
    },
    {
      key: 'quality',
      title: '质量问题',
      items: qualityIssueItems,
      tone: 'danger',
    },
  ]), [
    characterStateItems,
    dueForeshadowItems,
    locationStatusItems,
    puzzleItems,
    qualityIssueItems,
    recallItems,
    relatedEvents,
    worldFactItems,
  ])

  const pipelineItems = useMemo<PipelineBarItem[]>(() => {
    const roleKeyOrder: WritingPipelineRole[] = ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize']
    const roleLabelMap: Record<WritingPipelineRole, string> = {
      planner: 'Planner',
      writer: 'Writer',
      critic: 'Critic',
      rewriter: 'Rewriter',
      canonizer: 'Canonizer',
      finalize: 'Finalize',
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
      value: currentPipelineSnapshot?.contractVersion || '未记录',
    },
    {
      label: 'Token 消耗',
      value: currentPipelineSnapshot?.totalTokensUsed ? `${currentPipelineSnapshot.totalTokensUsed} tok` : '0 tok',
    },
    {
      label: '耗时',
      value: currentPipelineSnapshot?.totalDurationMs ? `${(currentPipelineSnapshot.totalDurationMs / 1000).toFixed(1)}s` : '-',
    },
    {
      label: '失败原因',
      value: currentPipelineSnapshot?.failureCode || '当前无失败',
    },
    {
      label: '恢复提示',
      value: currentPipelineSnapshot?.status === 'failed'
        ? '先检查合同、上下文召回与审校提示，再重试流水线。'
        : '当前无需恢复操作。',
    },
  ]), [currentPipelineSnapshot])

  return (
    <>
      <div className="chapter-console-page">
        {loading ? (
          <div className="chapter-console-page__loading"><Spin size="large" /></div>
        ) : (
          <>
            <div className="chapter-console-page__hero">
              <section className="chapter-console-page__panel chapter-console-page__hero-card">
                <SectionHeader
                  eyebrow="章节选择区"
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

            <div className="chapter-console-page__grid">
              <aside className="chapter-console-page__column chapter-console-page__column--left">
                <section className="chapter-console-page__panel">
                  <SectionHeader
                    eyebrow="章节生产"
                    title="章节列表"
                    description={`共 ${chapters.length} 章，优先从这里切到当前正在生产的章节。`}
                  />
                  <div className="chapter-console-page__chapter-list">
                    {chapters.length > 0 ? chapters.map((chapter) => {
                      const chapterGeneration = activeGeneration.chapterId === chapter.id && activeGeneration.status !== 'idle'
                        ? activeGeneration
                        : lastGenerationByChapter[chapter.id]
                      const chapterGenerationMeta = chapterGeneration ? getGenerationTagMeta(chapterGeneration) : null
                      return (
                        <div
                          key={chapter.id}
                          className={`chapter-console-page__chapter-card ${currentChapterId === chapter.id ? 'is-active' : ''}`}
                          onClick={() => void refreshChapter(chapter.id).then(() => { setCurrentChapterId(chapter.id); setAiResult(null) })}
                          onMouseEnter={() => setHoverChapterId(chapter.id)}
                          onMouseLeave={() => setHoverChapterId(null)}
                        >
                          <div className="chapter-console-page__chapter-copy">
                            <strong>{formatChapterNumber(chapter.chapterNum)}</strong>
                            <span>{chapter.title || `第${chapter.chapterNum}章`}</span>
                            <small>{`${chapter.wordCount} 字 · ${getStatusLabel(chapter.status)}`}</small>
                            <div className="chapter-console-page__chapter-tags">
                              {parseStringArray(chapter.staleReasonJson).length > 0 ? <Tag color="warning">待同步</Tag> : null}
                              {chapterGenerationMeta ? <Tag color={chapterGenerationMeta.color}>{chapterGenerationMeta.label}</Tag> : null}
                            </div>
                          </div>
                          {hoverChapterId === chapter.id ? (
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(event) => handleDeleteChapter(chapter.id, event)}
                            />
                          ) : null}
                        </div>
                      )
                    }) : <Empty description="还没有章节，先创建一个。" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </div>
                  <ActionBar align="between">
                    <Button type="dashed" icon={<PlusOutlined />} onClick={() => void handleAddChapter()}>
                      新建章节
                    </Button>
                    <Select
                      size="small"
                      style={{ width: 208 }}
                      value={generationExecutionModeOverride}
                      options={[
                        { value: 'follow_default', label: `跟随默认（${getAiExecutionModeLabel(defaultAiExecutionMode)}）` },
                        ...AI_EXECUTION_MODE_OPTIONS.map((item) => ({
                          value: item.value,
                          label: `本次覆盖·${item.label}`,
                        })),
                      ]}
                      onChange={(value) => setGenerationExecutionModeOverride(value)}
                    />
                  </ActionBar>
                </section>

                <ContractPanel
                  title="章节合同"
                  subtitle="本章目标、线程、伏笔、禁越界事项和验收口径。"
                  sections={chapterContractSections}
                />

                <ContractPanel
                  title="场景合同"
                  subtitle={sceneContractSections.length > 0 ? `已挂 ${sceneContractSections.length} 个场景约束。` : '当前还没有稳定的场景合同。'}
                  sections={sceneContractSections.length > 0 ? sceneContractSections : [{
                    key: 'empty-scene',
                    title: '场景合同缺失',
                    items: ['建议先补场景计划，避免正文只剩大段泛写。'],
                    tone: 'danger',
                  }]}
                />
              </aside>

              <section className="chapter-console-page__column chapter-console-page__column--center">
                <section className="chapter-console-page__panel chapter-console-page__editor-card">
                  <SectionHeader
                    eyebrow="正文编辑器"
                    title={editorTitle}
                    description={resolvedEditorSubtitle}
                    extra={currentChapter ? <Tag color="default">{`字数 ${wordCount}`}</Tag> : null}
                  />
                  <ActionBar align="between">
                    <div className="chapter-console-page__editor-status">
                      <Select
                        size="small"
                        style={{ width: 140 }}
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
                          disabled={!currentChapter}
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
                      <Button icon={<FileSearchOutlined />} disabled={!currentChapter} onClick={() => void handleAiCheck()}>
                        审校
                      </Button>
                      <Button icon={<CheckOutlined />} disabled={!currentChapter} onClick={() => void handleStatusChange('final')}>
                        定稿
                      </Button>
                    </div>
                  </ActionBar>

                  {currentChapterGenerating ? (
                    <div className="chapter-console-page__stream">
                      <div className="chapter-console-page__stream-head">AI 正在生产本章 <Spin size="small" /></div>
                      <div className="chapter-console-page__stream-body">{streamContent}<span className="streaming-cursor" /></div>
                    </div>
                  ) : null}

                  {productionBriefItems.length > 0 ? (
                    <div className="chapter-console-page__brief-strip">
                      {productionBriefItems.slice(0, 4).map((item) => (
                        <div key={item} className="chapter-console-page__brief-chip">{item}</div>
                      ))}
                    </div>
                  ) : null}

                  {currentChapterStaleReasons.length > 0 ? (
                    <Alert
                      showIcon
                      type="warning"
                      message="当前章节上下文已过期"
                      description={`受这些变更影响：${currentChapterStaleReasons.join('；')}。建议先同步后再继续写。`}
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
                            <Button size="small" icon={<ApartmentOutlined />} onClick={() => navigate(`/novels/${novelId}/structure`)}>
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

                  <div className="chapter-console-page__editor-sheet-wrap">
                    {currentChapter ? (
                      hasMultiSegments ? (
                        <div className="novel-writing-shell__segment-preview">
                          <SegmentBoardPreview
                            segments={chapterSegments}
                            onOpenStructure={() => navigate(`/novels/${novelId}/structure`)}
                            onCompile={() => void handleCompileCurrentChapter()}
                          />
                          <div
                            className="novel-writing-shell__editor-sheet novel-writing-shell__editor-sheet--readonly"
                            dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br>') }}
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
                          dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br>') }}
                        />
                      )
                    ) : (
                      <div className="novel-empty novel-empty--writing">请选择左侧章节，或先创建一个新章节开始写作。</div>
                    )}
                  </div>
                </section>

                <section className="chapter-console-page__panel">
                  <SectionHeader
                    eyebrow="审校与验收"
                    title="章节验收面板"
                    description="这里统一看合同兑现、连续性、AI 味、节奏、人物一致性和世界规则一致性。"
                  />
                  <div className="chapter-console-page__acceptance-grid">
                    {acceptanceCards.map((item) => (
                      <div key={item.label} className="chapter-console-page__acceptance-card">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  {qualityIssueItems.length > 0 ? (
                    <div className="chapter-console-page__quality-list">
                      {qualityIssueItems.slice(0, 8).map((item) => (
                        <div key={item} className="chapter-console-page__quality-item">{item}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="chapter-console-page__empty-copy">当前还没有新的审校问题。</div>
                  )}
                </section>
              </section>

              <aside className="chapter-console-page__column chapter-console-page__column--right">
                <section className="chapter-console-page__panel">
                  <SectionHeader
                    eyebrow="视图焦点"
                    title="右侧辅助面板"
                    description="保留兼容路由，但现在统一汇总上下文、审校、历史和回写入口。"
                  />
                  <div className="chapter-console-page__route-switch">
                    {([
                      { key: 'editor', label: '生产台' },
                      { key: 'context', label: '召回' },
                      { key: 'review', label: '审校' },
                      { key: 'history', label: '历史' },
                    ] as Array<{ key: WritingRouteKey; label: string }>).map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={activeWritingRoute === tab.key ? 'is-active' : ''}
                        onClick={() => navigateToWritingRoute(tab.key)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </section>

                <ContextPanel
                  title="上下文与 Canon"
                  sections={contextSections}
                />

                <section className="chapter-console-page__panel">
                  <SectionHeader
                    eyebrow="章后回写"
                    title="回写候选入口"
                    description="正文定稿后，把事实、人物状态、伏笔、时间轴变化回写到资产总账。"
                  />
                  <div className="chapter-console-page__writeback-card">
                    <strong>{(qualityDashboard?.productionReadiness.writebackPendingCount || 0) > 0 ? `当前有 ${qualityDashboard?.productionReadiness.writebackPendingCount || 0} 章待回写` : '当前章可随时进入回写'}</strong>
                    <span>{qualityDashboard?.productionReadiness.summary || '回写完成后，质量监控和修订中心会基于新 Canon 继续反推任务。'}</span>
                    <ActionBar align="start">
                      <Button type="primary" onClick={() => navigate(`/novels/${novelId}/writeback`)}>
                        进入章后回写
                      </Button>
                      <Button onClick={() => navigate(`/novels/${novelId}/revision`)}>
                        打开修订中心
                      </Button>
                    </ActionBar>
                  </div>
                </section>
              </aside>
            </div>

            <div className="chapter-console-page__footer">
              <PipelineBar items={pipelineItems} />
              <div className="chapter-console-page__footer-grid">
                <section className="chapter-console-page__panel">
                  <SectionHeader
                    eyebrow="流水线元数据"
                    title="执行记录"
                    description="任务、合同版本、Token 消耗、耗时和恢复提示都收在这里。"
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
      <Modal
        title="重写选中文段"
        open={rewriteModalOpen}
        onCancel={() => setRewriteModalOpen(false)}
        onOk={() => void handleRewriteSelectedText()}
        confirmLoading={rewritingSelection}
        okText="应用重写"
      >
        <div className="novel-note-list" style={{ marginBottom: 12 }}>
          <div className="novel-note-list__item">AI 只会重写当前选中的文段，不会改动其他正文。</div>
          <div className="novel-note-list__item">默认保留事件与设定，优先修正语言、逻辑和衔接。</div>
        </div>
        <Input.TextArea value={selectedSnippet?.text || ''} rows={6} readOnly />
        <Input.TextArea
          style={{ marginTop: 12 }}
          value={rewriteRequirements}
          rows={3}
          onChange={(event) => setRewriteRequirements(event.target.value)}
          placeholder="补充要求，例如：更克制、减少说明句、强化动作细节。"
        />
      </Modal>

      <ParallelGenerationModal novelId={novelId} chapters={chapters} />
    </>
  )
}

function formatRatioPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function ChapterForeshadowWritebackCard({
  chapter,
  chapterSegments,
  ledger,
  saving,
  onCreate,
  onPatch,
  onDelete,
  onOpenLedger,
}: {
  chapter: Chapter | null
  chapterSegments: ChapterSegment[]
  ledger: ForeshadowLedgerEntry[]
  saving: boolean
  onCreate: (data: Partial<ForeshadowLedgerEntry>) => Promise<void>
  onPatch: (id: number, data: Partial<ForeshadowLedgerEntry>) => Promise<void>
  onDelete: (entry: ForeshadowLedgerEntry) => void
  onOpenLedger: () => void
}) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [sourceSegmentId, setSourceSegmentId] = useState<number | undefined>(undefined)
  const [targetPayoffChapter, setTargetPayoffChapter] = useState<number | null>(null)
  const [plantMethod, setPlantMethod] = useState('')
  const [salienceLevel, setSalienceLevel] = useState('medium')
  const [impactScope, setImpactScope] = useState('global')

  const chapterEntries = useMemo(
    () => ledger
      .filter((item) => chapter && item.sourceChapterId === chapter.id)
      .sort((left, right) => right.id - left.id),
    [chapter, ledger],
  )
  const segmentById = useMemo(
    () => new Map(chapterSegments.map((segment) => [segment.id, segment] as const)),
    [chapterSegments],
  )

  if (!chapter) {
    return <div className="novel-copy-block">先选择章节后再执行“本章伏笔回写”。</div>
  }

  const handleCreate = async () => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      message.warning(getUserFacingMessage('writing.foreshadowTitleRequired'))
      return
    }
    await onCreate({
      title: normalizedTitle,
      detail: detail.trim() || undefined,
      sourceSegmentId: sourceSegmentId || null,
      plantMethod: plantMethod.trim() || undefined,
      salienceLevel,
      targetPayoffChapter: targetPayoffChapter || null,
      impactScope,
      status: 'active',
    })
    setTitle('')
    setDetail('')
    setSourceSegmentId(undefined)
    setTargetPayoffChapter(null)
    setPlantMethod('')
    setSalienceLevel('medium')
    setImpactScope('global')
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="novel-insight-list">
          <div className="novel-insight-list__item">{`当前章节：第${chapter.chapterNum}章`}</div>
          <div className="novel-insight-list__item">{`本章已回写：${chapterEntries.length} 条`}</div>
        </div>
        <Button size="small" onClick={onOpenLedger}>打开伏笔回收账本</Button>
      </div>
      <div className="novel-note-list">
        <div className="novel-note-list__item" style={{ display: 'grid', gap: 8 }}>
          <strong>新增本章伏笔</strong>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="伏笔标题，例如：断裂的族徽纹章"
            disabled={saving}
          />
          <Input.TextArea
            value={detail}
            rows={2}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="伏笔说明（可选）"
            disabled={saving}
          />
          <Input
            value={plantMethod}
            onChange={(event) => setPlantMethod(event.target.value)}
            placeholder="埋设方式（可选），例如：对话暗示 / 道具特写"
            disabled={saving}
          />
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Select
              allowClear
              value={sourceSegmentId}
              onChange={(value) => setSourceSegmentId(value)}
              placeholder="埋设场景（可选）"
              options={chapterSegments.map((segment) => ({
                value: segment.id,
                label: `场景${String(segment.segmentOrder || 0).padStart(2, '0')} · ${segment.title || '未命名场景'}`,
              }))}
              disabled={saving}
            />
            <InputNumber
              min={1}
              precision={0}
              value={targetPayoffChapter}
              onChange={(value) => setTargetPayoffChapter(typeof value === 'number' ? value : null)}
              style={{ width: '100%' }}
              placeholder="目标回收章位"
              disabled={saving}
            />
            <Select
              value={salienceLevel}
              onChange={(value) => setSalienceLevel(value)}
              options={[
                { value: 'low', label: '低显著' },
                { value: 'medium', label: '中显著' },
                { value: 'high', label: '高显著' },
              ]}
              disabled={saving}
            />
            <Select
              value={impactScope}
              onChange={(value) => setImpactScope(value)}
              options={[
                { value: 'local', label: '局部' },
                { value: 'character', label: '人物线' },
                { value: 'world', label: '世界观线' },
                { value: 'global', label: '全局主线' },
              ]}
              disabled={saving}
            />
          </div>
          <div>
            <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={() => void handleCreate()}>
              回写为本章新伏笔
            </Button>
          </div>
        </div>
      </div>
      {chapterEntries.length <= 0 ? (
        <div className="novel-copy-block">当前章节还没有回写伏笔。你可以先新增，或去账本页导入现有伏笔。</div>
      ) : (
        <div className="novel-note-list">
          {chapterEntries.map((entry) => {
            const segment = entry.sourceSegmentId ? segmentById.get(entry.sourceSegmentId) : null
            return (
              <div key={entry.id} className="novel-note-list__item" style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{entry.title}</strong>
                  <Tag color={entry.status === 'resolved' ? 'success' : entry.status === 'active' ? 'processing' : 'default'}>
                    {entry.status || 'draft'}
                  </Tag>
                  {typeof entry.targetPayoffChapter === 'number' ? <Tag>{`目标第${entry.targetPayoffChapter}章`}</Tag> : null}
                </div>
                <div style={{ opacity: 0.85 }}>
                  {segment ? `场景：${segment.title || `场景${segment.segmentOrder}`}` : '场景：未设置'}
                  {entry.plantMethod ? ` · 埋设：${entry.plantMethod}` : ''}
                </div>
                {entry.detail ? <div>{entry.detail}</div> : null}
                {entry.payoffSceneAction ? <div style={{ opacity: 0.85 }}>{`回收动作：${entry.payoffSceneAction}`}</div> : null}
                {entry.requiredEvidence ? <div style={{ opacity: 0.85 }}>{`可见证据：${entry.requiredEvidence}`}</div> : null}
                {entry.readerVisibleOutcome ? <div style={{ opacity: 0.85 }}>{`读者结果：${entry.readerVisibleOutcome}`}</div> : null}
                {entry.allowedDelayReason ? <div style={{ opacity: 0.72 }}>{`允许延期：${entry.allowedDelayReason}`}</div> : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Select
                    size="small"
                    value={entry.status || 'draft'}
                    style={{ width: 128 }}
                    disabled={saving}
                    onChange={(value) => void onPatch(entry.id, { status: value })}
                    options={[
                      { value: 'draft', label: '草稿' },
                      { value: 'active', label: '进行中' },
                      { value: 'resolved', label: '已回收' },
                      { value: 'archived', label: '归档' },
                    ]}
                  />
                  <Button
                    size="small"
                    loading={saving}
                    onClick={() => void onPatch(entry.id, { status: 'resolved' })}
                    disabled={entry.status === 'resolved'}
                  >
                    标记已回收
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(entry)}>
                    删除
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChapterRevealConstraintCard({
  chapter,
  facts,
  volumes,
  characters,
  allowedFactIds,
  revealedFactIds,
  truthStats,
  saving,
  onUpdate,
  onOpenBoard,
}: {
  chapter: Chapter | null
  facts: StoryFact[]
  volumes: StoryVolume[]
  characters: Character[]
  allowedFactIds: number[]
  revealedFactIds: number[]
  truthStats: ReturnType<typeof computeVolumeTruthRevealStats>
  saving: boolean
  onUpdate: (nextAllowedIds: number[], nextRevealedIds: number[]) => Promise<void>
  onOpenBoard: () => void
}) {
  const [kind, setKind] = useState<'truth' | 'clue' | 'red_herring'>('truth')
  const chapterVolumeNumber = useMemo(
    () => getCurrentVolumeNumber(chapter, volumes),
    [chapter, volumes],
  )
  const puzzleTitleById = useMemo(() => {
    const map = new Map<number, string>()
    facts
      .filter((fact) => fact.kind === 'puzzle')
      .forEach((fact) => {
        map.set(fact.id, fact.title)
      })
    return map
  }, [facts])
  const characterNameById = useMemo(() => {
    const map = new Map<number, string>()
    characters.forEach((character) => {
      map.set(character.id, character.fullName)
    })
    return map
  }, [characters])
  const candidateFacts = useMemo(
    () => facts
      .filter((fact) => fact.kind === kind)
      .sort((left, right) => {
        const leftVolume = left.plannedRevealVolume || 999
        const rightVolume = right.plannedRevealVolume || 999
        if (leftVolume !== rightVolume) return leftVolume - rightVolume
        return left.id - right.id
      }),
    [facts, kind],
  )
  const allowedSet = useMemo(() => new Set(allowedFactIds), [allowedFactIds])
  const revealedSet = useMemo(() => new Set(revealedFactIds), [revealedFactIds])
  const volumeLabel = chapterVolumeNumber ? `第${chapterVolumeNumber}卷` : '待绑定卷'
  const ratioLabel = `${truthStats.plannedTruths}/${truthStats.totalTruths}`

  if (!chapter) {
    return <div className="novel-copy-block">先选择章节后再设置“本章允许揭示什么”。</div>
  }

  const handleAllowedToggle = (fact: StoryFact, checked: boolean) => {
    const nextAllowed = checked
      ? normalizeIdArray([...allowedFactIds, fact.id])
      : allowedFactIds.filter((id) => id !== fact.id)
    const nextRevealed = checked
      ? revealedFactIds
      : revealedFactIds.filter((id) => id !== fact.id)
    void onUpdate(nextAllowed, nextRevealed)
    if (checked && fact.kind === 'truth' && truthStats.overLimit) {
      message.warning(getUserFacingMessage('writing.truthRatioExceeded', { ratio: formatRatioPercent(truthStats.ratio) }))
    }
  }

  const handleRevealedToggle = (fact: StoryFact, checked: boolean) => {
    const withAllowed = checked
      ? normalizeIdArray([...allowedFactIds, fact.id])
      : allowedFactIds
    const nextRevealed = checked
      ? normalizeIdArray([...revealedFactIds, fact.id])
      : revealedFactIds.filter((id) => id !== fact.id)
    void onUpdate(withAllowed, nextRevealed)
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="novel-insight-list">
          <div className="novel-insight-list__item">{`当前卷：${volumeLabel}`}</div>
          <div className="novel-insight-list__item">{`真相揭示：${ratioLabel}（${formatRatioPercent(truthStats.ratio)}）`}</div>
          <div className="novel-insight-list__item">
            {truthStats.limit == null ? '卷级上限：未设置' : `卷级上限：${formatRatioPercent(truthStats.limit)}`}
          </div>
        </div>
        <Button size="small" onClick={onOpenBoard}>打开信息差谜题板</Button>
      </div>
      {truthStats.overLimit ? (
        <Alert
          showIcon
          type="warning"
          message="当前卷真相揭示比例超限"
          description="系统不会阻止勾选，但建议回到“信息差谜题板”调整计划揭示卷。"
        />
      ) : null}
      <Select
        value={kind}
        onChange={(value) => setKind(value as 'truth' | 'clue' | 'red_herring')}
        options={[
          { value: 'truth', label: '真相' },
          { value: 'clue', label: '线索' },
          { value: 'red_herring', label: '假线索' },
        ]}
      />
      {candidateFacts.length <= 0 ? (
        <div className="novel-copy-block">当前分类下没有命中可调度条目。</div>
      ) : (
        <div className="novel-note-list">
          {candidateFacts.map((fact) => {
            const locked = typeof fact.forbiddenBeforeVolume === 'number'
              && (!chapterVolumeNumber || chapterVolumeNumber < fact.forbiddenBeforeVolume)
            const relatedPuzzle = fact.relatedPuzzleId ? puzzleTitleById.get(fact.relatedPuzzleId) : null
            const characterKnowledge = parseCharacterKnowledgeJson(fact.characterKnowledgeJson)
              .map((entry) => characterNameById.get(entry.characterId) || `角色#${entry.characterId}`)
            return (
              <div key={fact.id} className="novel-note-list__item">
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{fact.title}</strong>
                    <Tag color={fact.kind === 'truth' ? 'gold' : fact.kind === 'red_herring' ? 'volcano' : 'processing'}>
                      {fact.kind === 'truth' ? '真相' : fact.kind === 'red_herring' ? '假线索' : '线索'}
                    </Tag>
                    {fact.plannedRevealVolume ? <Tag>{`计划揭示：第${fact.plannedRevealVolume}卷`}</Tag> : null}
                    {locked ? <Tag color="warning">{`锁定到第${fact.forbiddenBeforeVolume}卷`}</Tag> : null}
                  </div>
                  {fact.summary ? <div>{fact.summary}</div> : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {relatedPuzzle ? <span>{`关联谜题：${relatedPuzzle}`}</span> : null}
                    {characterKnowledge.length > 0 ? <span>{`角色已知：${characterKnowledge.join('、')}`}</span> : null}
                    {fact.readerKnownChapterId ? <span>{`读者已知章节ID：${fact.readerKnownChapterId}`}</span> : null}
                    {fact.protagonistKnownChapterId ? <span>{`主角已知章节ID：${fact.protagonistKnownChapterId}`}</span> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <Checkbox
                      checked={allowedSet.has(fact.id)}
                      disabled={saving || locked}
                      onChange={(event) => handleAllowedToggle(fact, event.target.checked)}
                    >
                      本章允许揭示
                    </Checkbox>
                    <Checkbox
                      checked={revealedSet.has(fact.id)}
                      disabled={saving || !allowedSet.has(fact.id)}
                      onChange={(event) => handleRevealedToggle(fact, event.target.checked)}
                    >
                      本章已揭示
                    </Checkbox>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InsightCard({
  title,
  eyebrow,
  tone = 'default',
  children,
}: {
  title: string
  eyebrow?: string
  tone?: 'default' | 'hero' | 'soft'
  children: React.ReactNode
}) {
  return (
    <section className={`novel-writing-shell__insight-card novel-writing-shell__insight-card--${tone}`}>
      <div className="novel-writing-shell__insight-card-header">
        {eyebrow ? <div className="novel-writing-shell__insight-card-eyebrow">{eyebrow}</div> : null}
        <div className="novel-writing-shell__insight-card-title">{title}</div>
      </div>
      <div className="novel-writing-shell__insight-card-body">{children}</div>
    </section>
  )
}

function ConstraintInjectionCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview || preview.stages.length === 0) {
    return <div className="novel-copy-block">先切到具体章节并生成上下文预览，再核对四个阶段的约束注入状态。</div>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {preview.stages.map((stage) => {
        const injectedTitles = stage.hardConstraintEntries.map((entry) => entry.title)
        const truncatedTitles = stage.hardConstraintEntries.filter((entry) => entry.truncated).map((entry) => entry.title)
        const hasDrop = stage.droppedConstraintCount > 0
        const report = stage.contextBudgetReport
        const droppedByPriority = report.droppedByPriority
          .filter((entry) => entry.count > 0)
          .map((entry) => `P${entry.priority} ${entry.count}项`)
          .join('，')
        const decisionLines = stage.softContextDecisions
          .filter((entry) => entry.status !== 'kept' || entry.reason === 'covered_by_hard_constraint')
          .map((entry) => {
            if (entry.reason === 'covered_by_hard_constraint') {
              return `${entry.title}：走硬约束通道${entry.status === 'truncated' ? `，已压缩到 ${entry.allocatedTokens}/${entry.originalTokens} tokens` : '，未占用软预算'}`
            }
            return `${entry.title}：${entry.status === 'dropped'
              ? `被踢出（${entry.originalTokens} tokens）`
              : `被压缩 ${entry.originalTokens}→${entry.allocatedTokens} tokens`}`
          })
        return (
          <div key={stage.stage} className="novel-note-list">
            <div className="novel-note-list__item">
              <strong>{stage.stage}</strong>
              {` · 复杂度 ${preview.complexity} · 硬约束 ${stage.constraintInjectionStatus.hardConstraintUsed}/${stage.constraintInjectionStatus.hardConstraintBudget} · 软上下文 ${stage.constraintInjectionStatus.softContextUsed}/${stage.constraintInjectionStatus.softContextBudget}`}
            </div>
            <div className="novel-note-list__item">
              {`预算：上下文 ${report.hardConstraintUsed + report.softContextUsed}/${report.availableContextBudget} · 总窗口 ${report.effectiveBudget} · 输出预留 ${report.reservedForOutput}`}
            </div>
            <div className="novel-note-list__item">
              {report.overflowLevel === 'hard_failed'
                ? '阻塞：关键约束已超出预算，当前阶段不能安全生成。'
                : report.overflowLevel === 'soft_trimmed'
                  ? '已降级：低优先级上下文已被自动裁剪。'
                  : '预算充足，当前阶段未触发裁剪。'}
            </div>
            <div className="novel-note-list__item">{stage.hardConstraintSummary}</div>
            <div className="novel-note-list__item">
              已注入：{injectedTitles.length > 0 ? injectedTitles.join('、') : '无'}
            </div>
            <div className="novel-note-list__item">
              {truncatedTitles.length > 0
                ? `已压缩：${truncatedTitles.join('、')}`
                : '硬约束未发生压缩。'}
            </div>
            <div className="novel-note-list__item">
              {hasDrop
                ? `警告：仍有 ${stage.droppedConstraintCount} 项关键约束未注入。`
                : '关键约束未发生丢失。'}
            </div>
            <div className="novel-note-list__item">
              {report.droppedLabels.length > 0
                ? `被踢出：${report.droppedLabels.join('、')}${droppedByPriority ? ` · ${droppedByPriority}` : ''}`
                : '没有字段因预算被整体踢出。'}
            </div>
            <div className="novel-note-list__item">
              {report.truncatedLabels.length > 0
                ? `被压缩：${report.truncatedLabels.join('、')}`
                : '没有字段因预算被截断。'}
            </div>
            <div className="novel-note-list__item">
              {decisionLines.length > 0
                ? `软预算决策：${decisionLines.join('；')}`
                : '软上下文没有额外裁剪，也没有字段改走硬约束。'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PreviousChapterFeedCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对上一章承接采样、覆盖率和实际喂给模型的文本。</div>
  }

  const report = preview.previousChapterSampleReport
  const segmentSummary = report.segments.map((segment) => `${segment.label} ${segment.chars}字`)

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">
          {report.sourceChapterNum ? `来源第${report.sourceChapterNum}章` : '当前还没有上一章可供采样'}
        </div>
        <div className="novel-insight-list__item">采样 {report.sampledChars} 字</div>
        <div className="novel-insight-list__item">覆盖率 {report.coverageRate}%</div>
        <div className="novel-insight-list__item">{report.fullyInjected ? '短章全文注入' : `片段 ${report.segmentCount} 段`}</div>
      </div>
      <StringList items={segmentSummary} empty="上一章没有命中可直接注入的承接片段。" />
      {preview.previousChapterContext
        ? <div className="novel-copy-block" style={{ whiteSpace: 'pre-wrap' }}>{preview.previousChapterContext}</div>
        : <div className="novel-copy-block">当前章节前没有可注入的上一章先验。</div>}
    </div>
  )
}

function RecallDiagnosticsCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对召回来源、过期拦截和依赖率。</div>
  }

  const diagnostics = preview.recallDiagnostics
  const snapshot = preview.recallSnapshot
  const freshSources = preview.recalledMemorySources.filter((source) => !source.stale && !source.overriddenByConstraint).slice(0, 4)
  const staleSources = preview.recalledMemorySources.filter((source) => source.stale).slice(0, 4)
  const bucketLines = Object.entries(snapshot.bucketStats)
    .map(([bucket, stats]) => `${bucket}：命中 ${stats.hitCount} / 采用 ${stats.selectedHitCount}${stats.fallbackReason ? ` / ${stats.fallbackReason}` : ''}`)

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">{snapshot.retrievalUsed ? '本章已实际使用召回' : '本章未实际使用召回'}</div>
        <div className="novel-insight-list__item">命中 {snapshot.hitCount}</div>
        <div className="novel-insight-list__item">召回依赖率 {diagnostics.recallDependencyRate}%</div>
        <div className="novel-insight-list__item">过期召回率 {diagnostics.staleRecallRate}%</div>
        <div className="novel-insight-list__item">可用片段 {diagnostics.selectedHitCount}</div>
        <div className="novel-insight-list__item">过期拦截 {diagnostics.staleRecallCount}</div>
      </div>
      <StringList
        items={[
          snapshot.fallbackReason ? `降级原因：${snapshot.fallbackReason}` : '当前未记录召回降级原因。',
          ...bucketLines,
        ]}
        empty="当前还没有召回桶统计。"
      />
      <StringList items={diagnostics.summaryLines} empty="当前还没有召回诊断摘要。" />
      <StringList
        items={freshSources.map((source) => `${source.sourceLabel}：${source.summary}`)}
        empty="本次没有额外背景补充片段进入上下文。"
      />
      {staleSources.length > 0 ? (
        <div className="novel-note-list">
          {staleSources.map((source, index) => (
            <div key={`${source.sourceLabel}-${index}`} className="novel-note-list__item">
              已拦截 · {source.sourceLabel}：{source.staleReasons.join('；')}
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">本次没有命中过期召回片段。</div>
      )}
      {preview.recalledMemory ? <div className="novel-copy-block" style={{ whiteSpace: 'pre-wrap' }}>{preview.recalledMemory}</div> : null}
    </div>
  )
}

function ContextUsageImpactCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对本次真正用了哪些资产、合同约束，以及当前章节挂着哪些待同步影响。</div>
  }

  const snapshot = preview.usageSnapshot
  const linkedImpactLines = snapshot.linkedImpacts.map((item) => {
    const prefix = item.eventAssetLabel ? `${item.eventAssetLabel} -> ` : ''
    return `${prefix}${item.targetLabel}：${item.impactReason}`
  })

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <StringList items={snapshot.usedAssets} empty="本次生成还没记录到实际命中的关键资产。" />
      <StringList items={snapshot.usedContracts} empty="本次生成还没记录到注入的合同与硬约束。" />
      <StringList items={snapshot.recentStateChanges} empty="本次生成没有新增状态变化汇总。" />
      {snapshot.ignoredConstraints.length > 0 ? (
        <div className="novel-note-list">
          {snapshot.ignoredConstraints.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">忽略 / 压缩：{item}</div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">本次没有约束被压缩或忽略。</div>
      )}
      {snapshot.linkedImpacts.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <StringList items={linkedImpactLines} empty="当前章节没有挂起的影响项。" />
          <div className="novel-insight-list">
            {snapshot.linkedImpacts.map((item) => (
              <div key={item.id} className="novel-insight-list__item">
                {item.resolutionStatus === 'pending' ? '待同步' : '已复核'} · {item.targetType}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="novel-copy-block">当前章节没有挂起的资产影响任务。</div>
      )}
    </div>
  )
}

function AiExplainabilityCard({ preview }: { preview: ChapterContextPreview | null }) {
  const explainability = preview?.generationExplainability
  if (!preview || !explainability) {
    return <div className="novel-copy-block">先生成上下文预览，再查看模型路由、结构化输出、风格锁和低置信度事实。</div>
  }

  const routeLines = explainability.stageReports.map((stage) => {
    const route = stage.route
    return `${stage.stageLabel}：${route.modelLabel} · 温度 ${route.temperature.toFixed(2)} · 输出 ${route.maxTokens} · ${route.reviewDepth}`
  })
  const structuredLines = explainability.structuredOutputs
  const inferredLines = explainability.inferredFacts.map((item) => `${item.label}：${item.detail}${item.needsConfirmation ? ' · 待确认' : ''}`)
  const lowConfidenceLines = explainability.lowConfidenceFacts.map((item) => `${item.label}：${item.detail}`)
  const assemblyLayers = explainability.contextAssemblyReport?.layers.map((layer) => `${layer.label} · ${layer.itemCount} 项：${layer.summary}`) || []
  const styleLock = explainability.authorStyleLock
  const styleLockLines = styleLock?.enabled
    ? [
        styleLock.sourceLabel ? `来源：${styleLock.sourceLabel}` : '',
        styleLock.sentenceLengthHint ? `句长：${styleLock.sentenceLengthHint}` : '',
        styleLock.dialogueRhythmHint ? `对白：${styleLock.dialogueRhythmHint}` : '',
        styleLock.narrativeDensityHint ? `密度：${styleLock.narrativeDensityHint}` : '',
        styleLock.paceHint ? `节奏：${styleLock.paceHint}` : '',
        styleLock.toneKeywords.length > 0 ? `语调：${styleLock.toneKeywords.join('、')}` : '',
        styleLock.preferredLexicon.length > 0 ? `偏好词汇：${styleLock.preferredLexicon.join('、')}` : '',
        styleLock.forbiddenPatterns.length > 0 ? `禁用表达：${styleLock.forbiddenPatterns.join('、')}` : '',
        styleLock.hardRules.length > 0 ? `硬约束：${styleLock.hardRules.join('；')}` : '',
      ].filter(Boolean)
    : []

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="novel-copy-block">{explainability.routeSummary}</div>
      <StringList items={routeLines} empty="当前还没有模型路由记录。" />
      <StringList items={structuredLines} empty="本次没有新增结构化输出节点记录。" />
      <StringList items={assemblyLayers} empty="当前还没有上下文组装层说明。" />
      <StringList items={styleLockLines} empty="还没有作者风格锁，可去主题与文风页补样本。" />
      <StringList items={inferredLines} empty="本次没有新增推断候选。" />
      {lowConfidenceLines.length > 0 ? (
        <div className="novel-note-list">
          {lowConfidenceLines.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">低置信度：{item}</div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">本次没有低置信度事实或被压缩约束。</div>
      )}
    </div>
  )
}

function ChapterFocusCard({
  summary,
  nextChapterSeed,
  continuityItems,
  bridgeItems,
  qualityItems,
}: {
  summary?: string | null
  nextChapterSeed?: string | null
  continuityItems: string[]
  bridgeItems: string[]
  qualityItems: string[]
}) {
  const hasSummary = Boolean(summary?.trim())
  const hasNextChapterSeed = Boolean(nextChapterSeed?.trim())
  const hasContinuity = continuityItems.length > 0
  const hasBridge = bridgeItems.length > 0
  const hasQuality = qualityItems.length > 0

  return (
    <InsightCard title="本章聚焦" eyebrow="主线锚点" tone="hero">
      {hasSummary || hasNextChapterSeed || hasContinuity || hasBridge || hasQuality ? (
        <div className="novel-writing-shell__focus-card">
          {hasSummary ? <section className="novel-writing-shell__focus-block"><div className="novel-writing-shell__focus-label">一句话摘要</div><div className="novel-writing-shell__focus-copy">{summary}</div></section> : null}
          {hasNextChapterSeed ? <section className="novel-writing-shell__focus-block novel-writing-shell__focus-block--accent"><div className="novel-writing-shell__focus-label">下一章引子</div><div className="novel-writing-shell__focus-copy">{nextChapterSeed}</div></section> : null}
          {hasBridge ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">章节衔接桥</div><div className="novel-insight-list">{bridgeItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
          {hasContinuity ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">连续性提醒</div><div className="novel-insight-list">{continuityItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
          {hasQuality ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">健康提示</div><div className="novel-insight-list">{qualityItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
        </div>
      ) : <div className="novel-copy-block">章节流水线完成后，会在这里收束本章摘要、承接提醒与下一章引子。</div>}
    </InsightCard>
  )
}

function StringList({ items, empty }: { items: string[]; empty: string }) {
  return items.length > 0 ? <div className="novel-insight-list">{items.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item">{item}</div>)}</div> : <div className="novel-copy-block">{empty}</div>
}

function CharacterStateMemoryCard({ storyMemory }: { storyMemory: StoryMemorySnapshot | null }) {
  if (!storyMemory) {
    return <div className="novel-copy-block">先运行章节流水线或刷新记忆，再核对人物与世界实体的当前状态、近期跳变和冲突告警。</div>
  }

  const characterStateItems = storyMemory.characterCurrentStates
    .slice(0, 8)
    .map((item) => {
      const reason = item.changeReason && item.changeReason !== '延续前章状态，无新增显式变化'
        ? ` · ${item.changeReason}`
        : ''
      return `${item.characterName}：${item.summaryText}${reason}`
    })
  const worldStateItems = storyMemory.worldCurrentStates
    .slice(0, 6)
    .map((item) => `${worldStateEntityLabel(item.entityType)} ${item.entityName}：${item.summaryText}`)
  const conflictEntityItems = storyMemory.worldConflictEntities
    .slice(0, 4)
    .map((item) => `${worldStateEntityLabel(item.entityType)} ${item.entityName}：${item.reasons.join('；')}`)
  const alertItems = [
    ...storyMemory.characterStateAlerts
    .slice(0, 4)
      .map((item) => `人物 ${item.characterName}：${item.reasons.join('；')}`),
    ...storyMemory.worldStateAlerts
      .slice(0, 4)
      .map((item) => `${worldStateEntityLabel(item.entityType)} ${item.entityName}：${item.reasons.join('；')}`),
  ]
  const trendItems = [
    ...storyMemory.characterStateTrendSummary.slice(0, 3),
    ...storyMemory.worldStateTrendSummary.slice(0, 3),
  ]

  if (characterStateItems.length === 0 && worldStateItems.length === 0 && alertItems.length === 0 && conflictEntityItems.length === 0) {
    return <div className="novel-copy-block">状态版本会在章节连续性刷新后写入，这里随后会开始累积“当前状态”“趋势摘要”和“跳变告警”。</div>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <StringList items={characterStateItems} empty="当前还没有可用的人物状态快照。" />
      <StringList items={worldStateItems} empty="当前还没有可用的世界状态快照。" />
      {alertItems.length > 0 ? (
        <div className="novel-note-list">
          {alertItems.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">状态漂移：{item}</div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">最近没有命中的状态跳变或冲突告警。</div>
      )}
      <StringList items={conflictEntityItems} empty="没有发现需要优先回查的冲突实体。" />
      <StringList items={trendItems} empty="跨章节状态趋势会在这里汇总。" />
    </div>
  )
}

function worldStateEntityLabel(entityType: StoryMemorySnapshot['worldCurrentStates'][number]['entityType']) {
  if (entityType === 'character') return '人物'
  if (entityType === 'faction') return '势力'
  if (entityType === 'item') return '物品'
  if (entityType === 'relation') return '关系'
  return '地点'
}

function languageDriftStatusLabel(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']) {
  if (status === 'worsening') return '恶化中'
  if (status === 'improving') return '改善中'
  return '稳定'
}

function languageDriftStatusColor(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']) {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

function formatSignedDriftDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

function storyAlertColor(severity: QualityDashboardData['storyPacingAlerts'][number]['severity']) {
  return severity === 'blocker' ? 'error' : 'warning'
}

function storyAlertLabel(severity: QualityDashboardData['storyPacingAlerts'][number]['severity']) {
  return severity === 'blocker' ? '阻塞' : '中优先'
}

function worldStateAlertColor(severity: QualityDashboardData['recentWorldStateAlerts'][number]['severity']) {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'default'
}

function WorldStateHealthCard({ dashboard }: { dashboard: QualityDashboardData | null }) {
  if (!dashboard) {
    return <div className="novel-copy-block">先加载质量数据，再看跨章节的状态稳定性趋势与近期冲突。</div>
  }

  const alerts = dashboard.recentWorldStateAlerts.slice(0, 4)
  const trackedByType = dashboard.worldStateSummary.trackedByType
  const overviewItems = [
    `人物 ${trackedByType.character}`,
    `势力 ${trackedByType.faction}`,
    `物品 ${trackedByType.item}`,
    `关系 ${trackedByType.relation}`,
    `地点 ${trackedByType.location}`,
    `冲突实体 ${dashboard.worldStateSummary.conflictEntityCount}`,
  ]
  const conflictEntities = dashboard.worldConflictEntities.slice(0, 4)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">跟踪实体 {dashboard.worldStateSummary.trackedEntityCount}</div>
        <div className="novel-insight-list__item">漂移告警 {dashboard.worldStateSummary.driftAlertCount}</div>
        <div className="novel-insight-list__item">冲突告警 {dashboard.worldStateSummary.conflictAlertCount}</div>
        <div className="novel-insight-list__item">预警快照 {dashboard.worldStateSummary.warningCount}</div>
      </div>
      <StringList items={overviewItems} empty="状态总账还没形成可读概览。" />
      {conflictEntities.length > 0 ? (
        <div className="novel-note-list">
          {conflictEntities.map((entity, index) => (
            <div key={`${entity.entityType}-${entity.entityId}-${index}`} className="novel-note-list__item">
              <Tag color={worldStateAlertColor(entity.severity)} style={{ marginRight: 8 }}>
                {entity.conflictCount > 0 ? '冲突实体' : '跳变实体'}
              </Tag>
              {worldStateEntityLabel(entity.entityType)} {entity.entityName}：{entity.reasons.join('；')}
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">世界状态暂时稳定，没有需要优先回查的冲突实体。</div>
      )}
      {alerts.length > 0 ? (
        <div className="novel-note-list">
          {alerts.map((alert, index) => (
            <div key={`${alert.summary}-${index}`} className="novel-note-list__item">
              <Tag color={worldStateAlertColor(alert.severity)} style={{ marginRight: 8 }}>{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
              {alert.summary}
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">最近窗口内没有新的状态稳定性告警。</div>
      )}
    </div>
  )
}

function paceMarkerLabel(marker?: NonNullable<ReviewNotes['pace_marker']>) {
  if (marker === 'setup') return '铺垫'
  if (marker === 'conflict') return '冲突'
  if (marker === 'reversal') return '反转'
  if (marker === 'climax') return '高潮'
  if (marker === 'payoff') return '回收'
  if (marker === 'breather') return '喘息'
  return '未标注'
}

function LanguageDriftHealthCard({
  dashboard,
  currentChapter,
}: {
  dashboard: QualityDashboardData | null
  currentChapter: Chapter | null
}) {
  if (!dashboard || dashboard.totalChaptersScored === 0) {
    return <div className="novel-copy-block">先对多章运行 AI 体检，系统才会积累跨章节语言退化趋势。</div>
  }

  const alerts = dashboard.recentLanguageDriftAlerts.slice(0, 3)
  const topRiskMetrics = dashboard.novelLanguageDriftSummary.topRiskMetrics.slice(0, 3)
  const currentVolume = currentChapter?.volumeId
    ? dashboard.volumeLanguageDrift.find((entry) => entry.volumeId === currentChapter.volumeId) || null
    : null

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {alerts.length > 0 ? (
        <div className="novel-issue-list">
          {alerts.map((alert) => (
            <div key={alert.metric} className="novel-issue-item">
              <div className="novel-issue-item__head">
                <Tag color={languageDriftStatusColor(alert.status)}>{languageDriftStatusLabel(alert.status)}</Tag>
                <strong>{alert.label}</strong>
              </div>
              <div className="novel-issue-item__desc">窗口均值 {alert.previousValue} → {alert.latestValue}</div>
              <div className="novel-issue-item__suggestion">变化 {formatSignedDriftDelta(alert.delta)}，建议优先检查这类表达是否在连续章节里反复累积。</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">
          最近 {dashboard.novelLanguageDriftSummary.recentWindowSize || dashboard.totalChaptersScored} 章保持稳定，没有明显恶化项。
        </div>
      )}

      {currentVolume ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            当前卷：{currentVolume.volumeName}（第{currentVolume.chapterStart}-{currentVolume.chapterEnd}章，共 {currentVolume.chapterCount} 章）
          </div>
          <div className="novel-note-list__item">
            {currentVolume.topWorseningMetrics.length > 0
              ? `卷内近期恶化：${currentVolume.topWorseningMetrics.map((item) => `${item.label} ${formatSignedDriftDelta(item.delta)}`).join('、')}`
              : '卷内近期保持稳定。'}
          </div>
        </div>
      ) : null}

      {topRiskMetrics.length > 0 ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            全书当前最高优先问题：{topRiskMetrics.map((item) => `${item.label} ${item.value}`).join('、')}
          </div>
          <div className="novel-note-list__item">
            趋势状态：恶化 {dashboard.novelLanguageDriftSummary.statusBreakdown.worsening} 项，改善 {dashboard.novelLanguageDriftSummary.statusBreakdown.improving} 项，稳定 {dashboard.novelLanguageDriftSummary.statusBreakdown.stable} 项。
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HumanizationHealthCard({
  dashboard,
  reviewNotes,
}: {
  dashboard: QualityDashboardData | null
  reviewNotes: ReviewNotes | null
}) {
  const currentSignals = reviewNotes?.humanization_signals?.slice(0, 4) || []
  const promotedIssues = dashboard?.feedbackRecurrence.humanization.promotedIssues.slice(0, 3) || []
  const recentAlerts = dashboard?.feedbackRecurrence.humanization.recentAlerts.slice(0, 3) || []

  if (currentSignals.length === 0 && promotedIssues.length === 0 && recentAlerts.length === 0) {
    return <div className="novel-copy-block">语言风险一旦开始跨章复现，系统会直接提示下一章该避免什么。</div>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {currentSignals.length > 0 ? (
        <div className="novel-note-list">
          {currentSignals.map((item) => (
            <div key={`${item.issueType}-${item.detail}`} className="novel-note-list__item">
              当前章 {item.title}：{item.detail}
            </div>
          ))}
        </div>
      ) : null}

      {promotedIssues.length > 0 ? (
        <div className="novel-copy-block">
          下一章硬约束：{promotedIssues.map((item) => `${item.title} -> ${item.avoid}`).join('；')}
        </div>
      ) : null}

      {recentAlerts.length > 0 ? (
        <div className="novel-note-list">
          {recentAlerts.map((alert) => (
            <div key={`${alert.issueType}-${alert.lastChapterNum}`} className="novel-note-list__item">
              {alert.pauseSuggested ? '批次预警' : '复现预警'}：{alert.detail}
            </div>
          ))}
        </div>
      ) : null}

      {dashboard ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            近章人味问题覆盖 {dashboard.feedbackRecurrence.humanization.hitChapterCount} 章，已升级硬约束 {dashboard.feedbackRecurrence.humanization.promotedIssueCount} 项，高风险 {dashboard.feedbackRecurrence.humanization.highRiskIssueCount} 项。
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DialogueFingerprintHealthCard({
  dashboard,
  reviewNotes,
}: {
  dashboard: QualityDashboardData | null
  reviewNotes: ReviewNotes | null
}) {
  const currentSimilarities = reviewNotes?.cross_character_similarity?.slice(0, 3) || []
  const currentDrifts = reviewNotes?.dialogue_drift_alerts?.slice(0, 3) || []
  const globalPairs = dashboard?.crossCharacterDialogueSimilarity.filter((pair) => pair.similarity >= 75).slice(0, 3) || []
  const globalDrifts = dashboard?.dialogueDriftTrend.filter((entry) => entry.recentDriftRate >= 45).slice(0, 3) || []

  if (
    !reviewNotes?.dialogue_fingerprint_summary
    && currentSimilarities.length === 0
    && currentDrifts.length === 0
    && (!dashboard || dashboard.dialogueFingerprintStats.eligibleCharacterCount === 0)
  ) {
    return <div className="novel-copy-block">等章节里出现稳定对白样本后，就会提示“谁说话太像”以及“谁正在偏离自己的声音”。</div>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {reviewNotes?.dialogue_fingerprint_summary ? (
        <div className="novel-copy-block">{reviewNotes.dialogue_fingerprint_summary}</div>
      ) : null}

      {reviewNotes?.dialogue_voice_lock_summary ? (
        <div className="novel-copy-block">{reviewNotes.dialogue_voice_lock_summary}</div>
      ) : null}

      {currentSimilarities.length > 0
      || currentDrifts.length > 0
      || (reviewNotes?.dialogue_homogenization_risks?.length || 0) > 0
      || (reviewNotes?.dialogue_filler_risks?.length || 0) > 0
      || (reviewNotes?.dialogue_info_density_risks?.length || 0) > 0
      || (reviewNotes?.required_voice_lock_character_ids?.length || 0) > 0 ? (
        <div className="novel-note-list">
          {(reviewNotes?.dialogue_homogenization_risks || []).slice(0, 3).map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">{item}</div>
          ))}
          {currentSimilarities.map((item) => (
            <div key={`${item.characterAId}-${item.characterBId}`} className="novel-note-list__item">
              当前章高相似：{item.characterAName} / {item.characterBName}（{item.similarity}）· {item.reason}
            </div>
          ))}
          {currentDrifts.map((item) => (
            <div key={`${item.characterId}-${item.driftRate}`} className="novel-note-list__item">
              当前章漂移：{item.characterName}（{item.driftRate}）· {item.reason}
            </div>
          ))}
          {(reviewNotes?.dialogue_filler_risks || []).slice(0, 2).map((item, index) => (
            <div key={`filler-${index}`} className="novel-note-list__item">
              对白空转：{item}
            </div>
          ))}
          {(reviewNotes?.dialogue_info_density_risks || []).slice(0, 2).map((item, index) => (
            <div key={`density-${index}`} className="novel-note-list__item">
              信息推进：{item}
            </div>
          ))}
          {(reviewNotes?.required_voice_lock_character_ids || []).length > 0 ? (
            <div className="novel-note-list__item">
              需强制 Voice Lock 角色 ID：{(reviewNotes?.required_voice_lock_character_ids || []).join('、')}
            </div>
          ) : null}
        </div>
      ) : null}

      {dashboard ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            已建立 {dashboard.dialogueFingerprintStats.eligibleCharacterCount} 个角色语音指纹，累计识别对白 {dashboard.dialogueFingerprintStats.totalTurnCount} 段，其中归属成功 {dashboard.dialogueFingerprintStats.attributedTurnCount} 段。
          </div>
          <div className="novel-note-list__item">
            全书平均跨角色相似度 {dashboard.dialogueFingerprintStats.averageCrossCharacterSimilarity}，高相似组合 {dashboard.dialogueFingerprintStats.highSimilarityPairCount} 对，近期漂移角色 {dashboard.dialogueFingerprintStats.driftingCharacterCount} 个。
          </div>
        </div>
      ) : null}

      {globalPairs.length > 0 ? (
        <div className="novel-issue-list">
          {globalPairs.map((pair) => (
            <div key={`${pair.characterAId}-${pair.characterBId}`} className="novel-issue-item">
              <div className="novel-issue-item__head">
                <Tag color="warning">高相似</Tag>
                <strong>{pair.characterAName} / {pair.characterBName}</strong>
              </div>
              <div className="novel-issue-item__desc">相似度 {pair.similarity}</div>
              <div className="novel-issue-item__suggestion">{pair.reasons.join('、') || '句长、停顿和惯用短语接近。'}</div>
            </div>
          ))}
        </div>
      ) : globalDrifts.length > 0 ? null : (
        <div className="novel-copy-block">全书对白同质化目前没有达到高阈值。</div>
      )}

      {globalDrifts.length > 0 ? (
        <div className="novel-note-list">
          {globalDrifts.map((entry) => (
            <div key={entry.characterId} className="novel-note-list__item">
              近期漂移：{entry.characterName}（{entry.recentDriftRate}）· {entry.reasons.join('、') || '说话节奏正在偏移。'}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsHealthCard({
  dashboard,
  currentChapter,
  reviewNotes,
}: {
  dashboard: QualityDashboardData | null
  currentChapter: Chapter | null
  reviewNotes: ReviewNotes | null
}) {
  const currentSignals = [
    reviewNotes?.cost_resolution_state === 'evaporated'
      ? '当前章代价疑似蒸发，建议把伤势、资源损耗或关系后果继续写下去。'
      : '',
    reviewNotes?.reversal_marker && reviewNotes?.reversal_support_state === 'forced'
      ? '当前章反转支撑不足，建议补齐触发原因和前文铺垫。'
      : '',
    reviewNotes?.protagonist_setback === 'none' && (reviewNotes?.reward_state === 'partial' || reviewNotes?.reward_state === 'major') && !reviewNotes?.cost_present
      ? '当前章主角偏顺推，建议补出失败、失误或阶段代价。'
      : '',
    typeof reviewNotes?.protagonist_pressure === 'number' && reviewNotes.protagonist_pressure >= 70 && reviewNotes?.reward_state === 'none'
      ? '当前章压力很高但没有回报，建议安排一次缓冲、收获或反击兑现。'
      : '',
  ].filter((item): item is string => Boolean(item))

  if (currentSignals.length === 0 && (!dashboard || dashboard.protagonistSetbackSummary.chapterCount === 0)) {
    return <div className="novel-copy-block">运行新版章节审校后，就会累计主角受挫、代价持续和反转节奏告警。</div>
  }

  const alerts = dashboard?.storyPacingAlerts.slice(0, 3) || []
  const currentVolume = currentChapter?.volumeId
    ? dashboard?.volumeStoryDynamics.find((entry) => entry.volumeId === currentChapter.volumeId) || null
    : null

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {currentSignals.length > 0 ? (
        <div className="novel-note-list">
          {currentSignals.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">{item}</div>
          ))}
          {reviewNotes?.pace_marker ? <div className="novel-note-list__item">当前章主节奏：{paceMarkerLabel(reviewNotes.pace_marker)}</div> : null}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className="novel-issue-list">
          {alerts.map((alert, index) => (
            <div key={`${alert.code}-${index}`} className="novel-issue-item">
              <div className="novel-issue-item__head">
                <Tag color={storyAlertColor(alert.severity)}>{storyAlertLabel(alert.severity)}</Tag>
                <strong>{alert.title}</strong>
              </div>
              <div className="novel-issue-item__desc">{alert.detail}</div>
              <div className="novel-issue-item__suggestion">涉及章节：{alert.chapterNums.join('、')}</div>
            </div>
          ))}
        </div>
      ) : dashboard ? (
        <div className="novel-copy-block">
          最近 {Math.min(20, dashboard.protagonistSetbackSummary.chapterCount)} 章保持稳定，没有明显的主角与节奏结构告警。
        </div>
      ) : null}

      {dashboard ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            全书受挫率 {dashboard.protagonistSetbackSummary.protagonistSetbackRate}% ，重大受挫 {dashboard.protagonistSetbackSummary.majorSetbackRate}% ，平均压力 {dashboard.protagonistSetbackSummary.averagePressure}。
          </div>
          <div className="novel-note-list__item">
            最长顺推 {dashboard.protagonistSetbackSummary.longestSmoothRun} 章，最长持续压抑 {dashboard.protagonistSetbackSummary.longestPressureRun} 章。
          </div>
          <div className="novel-note-list__item">
            代价蒸发 {dashboard.costPersistenceSummary.evaporatedCostCount} 次，未解代价 {dashboard.costPersistenceSummary.unresolvedCostCount} 条。
          </div>
        </div>
      ) : null}

      {currentVolume ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            当前卷：{currentVolume.volumeName} · 受挫率 {currentVolume.protagonistSetbackRate}% · 平均压力 {currentVolume.averagePressure}
          </div>
          <div className="novel-note-list__item">
            卷内高潮：{currentVolume.climaxChapterNums.length > 0 ? currentVolume.climaxChapterNums.join('、') : '未记录'}；反转：{currentVolume.reversalChapterNums.length > 0 ? currentVolume.reversalChapterNums.join('、') : '未记录'}；代价蒸发 {currentVolume.evaporatedCostCount} 次。
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AiCheckResult({ result }: { result: AiCheckPayload }) {
  const scoreColor = result.score >= 80 ? '#389e0d' : result.score >= 60 ? '#d48806' : '#cf1322'
  return (
    <div className="novel-ai-score">
      <div className="novel-ai-score__summary">
        <Progress type="circle" percent={result.score} size={86} strokeColor={scoreColor} trailColor="rgba(143, 99, 48, 0.12)" format={(percent) => <span style={{ color: scoreColor, fontSize: 18, fontWeight: 700 }}>{percent}</span>} />
        <div className="novel-ai-score__feedback">{result.overall_feedback}</div>
      </div>
      <div className="novel-insight-list">
        {result.issues.map((issue, index) => <div key={`${issue.type}-${index}`} className="novel-ai-issue"><div className="novel-ai-issue__type">{issue.type}</div><div className="novel-ai-issue__location">{issue.location}</div><div className="novel-ai-issue__suggestion">{issue.suggestion}</div></div>)}
      </div>
    </div>
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

function ParallelGenerationModal({ novelId, chapters: chapterList }: { novelId: number; chapters: Chapter[] }) {
  const [open, setOpen] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [plan, setPlan] = useState<ParallelGenerationPlan | null>(null)

  const handleAnalyze = async () => {
    if (chapterList.length < 2) {
      message.warning(getUserFacingMessage('writing.parallelNeedMoreChapters'))
      return
    }
    setAnalyzing(true)
    try {
      const minNum = Math.min(...chapterList.map((c) => c.chapterNum))
      const maxNum = Math.max(...chapterList.map((c) => c.chapterNum))
      const result = await window.electron.parallel.analyzePlan(novelId, minNum, maxNum)
      setPlan(result)
    } catch (error) {
      message.error(getUserFacingMessage('writing.parallelAnalyzeFailed', {
        detail: error instanceof Error ? error.message : '未知错误',
      }))
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <>
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 10 }}>
        <Button
          icon={<BranchesOutlined />}
          onClick={() => setOpen(true)}
          shape="circle"
          size="large"
          title="并行生成分析"
        />
      </div>
      <Modal
        title="多视角并行生成分析"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={640}
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ opacity: 0.7 }}>
            分析故事弧中哪些叙事线可以并行生成。独立叙事线（无共享角色和线索）可以同时生成以加速创作。
          </p>
          <Button
            type="primary"
            icon={<BranchesOutlined />}
            loading={analyzing}
            onClick={() => void handleAnalyze()}
          >
            分析并行可能性
          </Button>
        </div>

        {plan ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 24 }}>
              <Tag color="blue">预计加速 {plan.estimatedSpeedup}x</Tag>
              <Tag color="green">{plan.parallelGroups.length} 组可并行</Tag>
              <Tag>{plan.sequentialSegments.length} 段需串行</Tag>
            </div>

            {plan.parallelGroups.length > 0 ? (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>可并行组</div>
                {plan.parallelGroups.map((group, gi) => (
                  <div key={gi} style={{ marginBottom: 12, padding: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>并行组 {gi + 1}</div>
                    {group.map((seg) => (
                      <div key={seg.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Tag color="processing">{seg.arcName}</Tag>
                        <span style={{ fontSize: 12 }}>第{seg.chapterRange[0]}-{seg.chapterRange[1]}章</span>
                        <span style={{ fontSize: 11, opacity: 0.5 }}>
                          {seg.primaryCharacterNames.slice(0, 3).join('、')}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <Alert type="info" message="当前章节范围内未发现可并行的独立叙事线。不同弧共享了相同角色或线索。" />
            )}

            {plan.convergencePoints.length > 0 ? (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>汇合点</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  并行生成完成后需在以下章节做状态合并：
                  {plan.convergencePoints.map((cp) => `第${cp}章`).join('、')}
                </div>
              </div>
            ) : null}

            {plan.sequentialSegments.length > 0 ? (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>需串行</div>
                {plan.sequentialSegments.map((seg) => (
                  <div key={seg.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <Tag>{seg.arcName}</Tag>
                    <span style={{ fontSize: 12 }}>第{seg.chapterRange[0]}-{seg.chapterRange[1]}章</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
