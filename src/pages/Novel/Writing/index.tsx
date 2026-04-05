import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Progress, Select, Spin, Tag, message } from 'antd'
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
import { useNavigate, useSearchParams } from 'react-router-dom'
import AIScorePanel from '../../../components/AIScorePanel'
import type {
  Chapter,
  ChapterSegment,
  ChapterVersion,
  ChapterPublishCheck,
  NovelConsistencyReport,
  NovelContextStatus,
  ParallelGenerationPlan,
  StoryItem,
  StoryMemorySnapshot,
  TimelineEvent,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTaskStore } from '../../../stores/task.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts'
import './index.css'

interface Props { novelId: number }
interface AiCheckPayload { score: number; issues: Array<{ type: string; location: string; suggestion: string }>; overall_feedback: string }
interface ContinuityPayload { plot_progress?: string[]; character_state_changes?: string[]; world_state_changes?: string[]; open_loops?: string[]; continuity_notes?: string[]; arc_progress?: string }
interface ScenePlanStep { scene_order: number; scene_title: string; purpose: string; location: string; time_anchor: string; present_characters: string[]; key_items: string[]; must_cover: string[] }
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
}
interface TextSelectionSnapshot {
  start: number
  end: number
  text: string
}
type InsightTab = 'chapter' | 'memory' | 'health'
type ChapterGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'completed' | 'failed'
interface ChapterGenerationProgressEvent { chapterId: number; stage: ChapterGenerationStage; label: string; detail?: string; completed: number; total: number; status: 'running' | 'success' | 'failed' }

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
const parseContinuity = (raw?: string) => { try { return raw ? JSON.parse(raw) as ContinuityPayload : null } catch { return null } }
const parseScenePlan = (raw?: string) => { try { const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed as ScenePlanStep[] : [] } catch { return [] } }
const parseReviewNotes = (raw?: string) => { try { return raw ? JSON.parse(raw) as ReviewNotes : null } catch { return null } }
const countWords = (text: string) => ((text.match(/[一-龥]/g) || []).length + (text.match(/\b[a-zA-Z]+\b/g) || []).length)
const getStatusLabel = (status?: Chapter['status']) => STATUS_OPTIONS.find((item) => item.value === status)?.label || '未设置'
const getIssueColor = (severity: 'high' | 'medium' | 'low') => severity === 'high' ? 'error' : severity === 'medium' ? 'warning' : 'default'
const getIssueLabel = (severity: 'high' | 'medium' | 'low') => severity === 'high' ? '高优先' : severity === 'medium' ? '中优先' : '低优先'
const getHealthLabel = (score: number) => (score >= 80 ? '结构稳定' : score >= 60 ? '可继续推进' : '建议先修问题')
const getPublishCheckAlertType = (check: ChapterPublishCheck | null) => {
  if (!check) return 'info'
  if (!check.ready) return 'error'
  if (check.warningCount > 0) return 'warning'
  return 'success'
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

export default function Writing({ novelId }: Props) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const { chapters, currentChapterId, currentNovel, setChapters, setCurrentChapterId, updateChapter } = useNovelStore()
  const { streams, clearStream } = useTaskStore()
  const editorRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentChapterIdRef = useRef<number | null>(null)
  const routeChapterFocusRef = useRef<number | null>(null)
  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])
  const historyBaselineRef = useRef('')
  const lastHistoryAtRef = useRef(0)

  const [loading, setLoading] = useState(true)
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [generatingTaskId, setGeneratingTaskId] = useState<number | null>(null)
  const [generationProgress, setGenerationProgress] = useState<ChapterGenerationProgressEvent | null>(null)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [storyMemory, setStoryMemory] = useState<StoryMemorySnapshot | null>(null)
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [storyItems, setStoryItems] = useState<StoryItem[]>([])
  const [chapterSegments, setChapterSegments] = useState<ChapterSegment[]>([])
  const [aiResult, setAiResult] = useState<AiCheckPayload | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [publishCheck, setPublishCheck] = useState<ChapterPublishCheck | null>(null)
  const [hoverChapterId, setHoverChapterId] = useState<number | null>(null)
  const [insightTab, setInsightTab] = useState<InsightTab>('chapter')
  const [selectedSnippet, setSelectedSnippet] = useState<TextSelectionSnapshot | null>(null)
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false)
  const [rewriteRequirements, setRewriteRequirements] = useState('')
  const [rewritingSelection, setRewritingSelection] = useState(false)
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false)
  const [chapterVersions, setChapterVersions] = useState<ChapterVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const routeChapterId = useMemo(() => parseRouteId(searchParams.get('chapterId')), [searchParams])
  const routeInsight = useMemo(() => {
    const value = searchParams.get('insight')
    return value === 'memory' || value === 'health' ? value : 'chapter'
  }, [searchParams])
  const selectedVersion = useMemo(
    () => chapterVersions.find((version) => version.id === selectedVersionId) || chapterVersions[0] || null,
    [chapterVersions, selectedVersionId],
  )

  useEffect(() => { currentChapterIdRef.current = currentChapterId }, [currentChapterId])

  const clearChapterArtifacts = useCallback(() => {
    setTimelineEvents([])
    setStoryItems([])
    setChapterSegments([])
    setAiResult(null)
    setPublishCheck(null)
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

  const refreshPublishCheck = useCallback(async (chapterId: number) => {
    setPublishCheck(await window.electron.chapter.runPublishCheck(chapterId))
  }, [])

  const refreshChapter = useCallback(async (chapterId: number) => {
    clearChapterArtifacts()
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
    if (versionHistoryOpen) {
      await refreshVersionHistory(chapterId)
    }
    await Promise.all([refreshPublishCheck(chapterId), refreshContextStatus(), refreshChapterLinks(full)])
  }, [clearChapterArtifacts, refreshChapterLinks, refreshContextStatus, refreshPublishCheck, refreshVersionHistory, resetEditorHistory, updateChapter, versionHistoryOpen])

  const loadChapters = useCallback(async (preferredChapterId?: number) => {
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)
    if (list.length === 0) {
      resetEditorHistory('')
      setCurrentChapter(null); setCurrentChapterId(null); setContent(''); setWordCount(0); setPublishCheck(null); setChapterSegments([]); setTimelineEvents([]); setStoryItems([]); await refreshContextStatus(); return
    }
    const target = list.find((chapter) => chapter.id === (preferredChapterId ?? currentChapterIdRef.current)) || list[0]
    setCurrentChapterId(target.id)
    await refreshChapter(target.id)
  }, [novelId, refreshChapter, refreshContextStatus, resetEditorHistory, setChapters, setCurrentChapterId])

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      try { await Promise.all([loadChapters(routeChapterId || undefined), refreshMeta(), refreshContextStatus()]) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [loadChapters, refreshContextStatus, refreshMeta, routeChapterId])

  useEffect(() => {
    if (!routeChapterId || routeChapterFocusRef.current === routeChapterId) return
    routeChapterFocusRef.current = routeChapterId
    void loadChapters(routeChapterId)
  }, [loadChapters, routeChapterId])

  useEffect(() => {
    setInsightTab(routeInsight)
  }, [routeInsight])

  useEffect(() => {
    const unsubscribe = window.electron.on('chapter:generation-progress', (data: unknown) => {
      const payload = data as ChapterGenerationProgressEvent
      if (payload?.chapterId === currentChapterIdRef.current) setGenerationProgress(payload)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!generatingTaskId) return
    const stream = streams[generatingTaskId]
    if (!stream) return
    if (stream.status === 'completed') {
      const chapterId = currentChapter?.id
      setGenerating(false); setGeneratingTaskId(null); clearStream(stream.taskId)
      void (async () => {
        await Promise.all([loadChapters(chapterId), refreshMeta()])
        if (chapterId) await refreshChapter(chapterId)
        message.success('章节流水线已完成，场景计划、审校记录和长文记忆已同步。')
      })()
    }
    if (stream.status === 'failed') {
      setGenerating(false); setGeneratingTaskId(null); clearStream(stream.taskId)
      message.error('正文生成失败，请检查模型配置或前置结构。')
    }
    if (stream.status === 'cancelled') {
      setGenerating(false); setGeneratingTaskId(null); clearStream(stream.taskId)
      message.info('正文生成已取消。')
    }
  }, [streams, generatingTaskId, currentChapter?.id, clearStream, loadChapters, refreshMeta, refreshChapter])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    clearChapterArtifacts()
    setGenerationProgress(null)
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

  const handleOpenVersionHistory = useCallback(async () => {
    if (!currentChapter) return
    setVersionHistoryOpen(true)
    await refreshVersionHistory(currentChapter.id)
  }, [currentChapter, refreshVersionHistory])

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
      message.success('已恢复所选历史版本。')
      notifyWorkspaceMutation()
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '恢复历史版本失败。')
    }
  }, [currentChapter, loadChapters, notifyWorkspaceMutation, refreshContextStatus, refreshMeta, refreshVersionHistory, selectedVersionId])

  useEffect(() => {
    registerSaveHandler(() => {
      if (!currentChapter || (currentChapter.segmentCount || 0) > 1) return
      const latestText = normalizeEditorText(editorRef.current?.innerText || content)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      void saveNow(currentChapter.id, latestText).then(() => {
        message.success('正文已保存。')
      }).catch((error) => {
        console.error(error)
        message.error(error instanceof Error ? error.message : '正文保存失败。')
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
      if (versionHistoryOpen) {
        setVersionHistoryOpen(false)
      }
    })

    return () => registerEscapeHandler(null)
  }, [registerEscapeHandler, rewriteModalOpen, versionHistoryOpen])

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
    if (!currentChapter) return message.warning('请先选择章节。')
    setGenerationProgress(null); setGenerating(true)
    try { setGeneratingTaskId(await window.electron.chapter.generateContent(currentChapter.id)) }
    catch (error: unknown) { setGenerating(false); message.error(error instanceof Error ? error.message : '请先配置可用的 AI 模型。') }
  }

  const handleCancelGenerate = async () => {
    if (!generatingTaskId) return
    await window.electron.task.cancel(generatingTaskId)
    setGenerating(false); setGeneratingTaskId(null); setGenerationProgress(null); clearStream(generatingTaskId)
  }

  const handleGenerateSummary = async () => {
    if (!currentChapter) return
    try {
      await window.electron.chapter.generateSummary(currentChapter.id)
      await Promise.all([loadChapters(currentChapter.id), refreshMeta(), refreshContextStatus()])
      message.success('摘要、连续性记忆和长文记忆已更新。')
    } catch (error: unknown) {
      message.error(`更新失败：${error instanceof Error ? error.message : '请稍后重试。'}`)
    }
  }

  const handleCompileCurrentChapter = async () => {
    if (!currentChapter) return
    try {
      await window.electron.structure.compileChapter(currentChapter.id)
      await Promise.all([loadChapters(currentChapter.id), refreshMeta(), refreshContextStatus()])
      message.success('已按场景重新编译当前章节。')
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '章节编译失败，请稍后再试。')
    }
  }

  const handleAiCheck = async () => {
    if (!currentChapter) return
    try { setAiResult(await window.electron.chapter.aiCheck(currentChapter.id) as AiCheckPayload); setInsightTab('health') }
    catch (error: unknown) { message.error(`检测失败：${error instanceof Error ? error.message : '请稍后重试。'}`) }
  }

  const handleOpenRewriteModal = () => {
    if (!currentChapter || !selectedSnippet?.text) {
      message.warning('请先在正文里选中需要重写的文段。')
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
      }) as string)

      if (!rewritten.trim()) {
        message.warning('AI 没有返回可用的重写结果。')
        return
      }

      applyChapterContent(`${before}${rewritten}${after}`, 'ai-rewrite')
      setRewriteModalOpen(false)
      setInsightTab('health')
      message.success('选中文段已重写并回填。')
    } catch (error: unknown) {
      message.error(`重写失败：${error instanceof Error ? error.message : '请稍后重试。'}`)
    } finally {
      setRewritingSelection(false)
    }
  }

  const handleStatusChange = async (status: string) => {
    if (!currentChapter) return
    if (status === 'final') {
      const nextPublishCheck = await window.electron.chapter.runPublishCheck(currentChapter.id)
      setPublishCheck(nextPublishCheck)
      await refreshContextStatus()

      if (!nextPublishCheck.ready) {
        Modal.error({
          title: '发布前检查未通过',
          content: (
            <div className="novel-note-list" style={{ marginTop: 12 }}>
              <div className="novel-note-list__item">{nextPublishCheck.summary}</div>
              {nextPublishCheck.checklist
                .filter((item) => item.status === 'blocker')
                .map((item) => <div key={item.key} className="novel-note-list__item">{`${item.label}：${item.detail}`}</div>)}
            </div>
          ),
          okText: '返回处理',
        })
        return
      }

      if (nextPublishCheck.warningCount > 0) {
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '发布前仍有提醒项',
            content: (
              <div className="novel-note-list" style={{ marginTop: 12 }}>
                <div className="novel-note-list__item">{nextPublishCheck.summary}</div>
                {nextPublishCheck.checklist
                  .filter((item) => item.status === 'warning')
                  .map((item) => <div key={item.key} className="novel-note-list__item">{`${item.label}：${item.detail}`}</div>)}
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
    message.success('新章节已创建。')
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

  const continuity = useMemo(() => parseContinuity(currentChapter?.continuityStateJson), [currentChapter?.continuityStateJson])
  const scenePlan = useMemo(() => parseScenePlan(currentChapter?.scenePlanJson), [currentChapter?.scenePlanJson])
  const reviewNotes = useMemo(() => parseReviewNotes(currentChapter?.reviewNotesJson), [currentChapter?.reviewNotesJson])
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

  const relatedInsightItems = [
    ...relatedEvents.map((event) => `${event.timeLabel || '时间未标注'} · ${event.eventTitle}`),
    ...relatedItems.map((item) => `道具 / 线索：${item.itemName}${item.plotFunction ? ` · ${item.plotFunction}` : ''}`),
  ]

  const reviewInsightItems = [
    reviewNotes?.summary ? `摘要回看：${reviewNotes.summary}` : '',
    reviewNotes?.revision_brief ? `修订摘要：${reviewNotes.revision_brief}` : '',
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
  ].filter((item): item is string => Boolean(item))

  const productionBriefItems = [
    reviewNotes?.revision_brief ? `定稿方向：${reviewNotes.revision_brief}` : '',
    ...(reviewNotes?.critical_fixes || []).slice(0, 2).map((item) => `先改：${item}`),
    ...(reviewNotes?.arc_progress_risks || []).slice(0, 2).map((item) => `弧推进：${item}`),
    ...(reviewNotes?.coherence_risks || []).slice(0, 2).map((item) => `读者易乱：${item}`),
    ...(reviewNotes?.reader_hook_risks || []).slice(0, 2).map((item) => `追读流失点：${item}`),
    ...(reviewNotes?.human_language_repairs || []).slice(0, 2).map((item) => `语言替换：${item}`),
    ...((aiResult?.issues || []).slice(0, 2).map((issue) => `AI体检：${issue.suggestion}`)),
  ].filter((item): item is string => Boolean(item))

  const pipelineStatus = PIPELINE_STAGES.map((stage, index) => {
    const running = generationProgress?.status === 'running' && generationProgress.stage === stage.key
    const failed = generationProgress?.status === 'failed' && generationProgress.stage === stage.key
    const done = generationProgress?.stage === 'completed'
      || (stage.key === 'planning' && scenePlan.length > 0)
      || (stage.key === 'drafting' && Boolean(currentChapter?.content || reviewNotes))
      || (stage.key === 'reviewing' && Boolean(reviewNotes))
      || (stage.key === 'rewriting' && Boolean(currentChapter?.content))
    return { ...stage, index, status: failed ? 'failed' : running ? 'running' : done ? 'done' : 'pending' }
  })

  const currentStatusLabel = currentChapter ? getStatusLabel(currentChapter.status) : '未选择章节'
  const otherStaleChapterCount = Math.max(0, (contextStatus?.staleChapterCount || 0) - (currentChapterStaleReasons.length > 0 ? 1 : 0))
  const streamContent = generatingTaskId ? streams[generatingTaskId]?.content || '' : ''
  const hasMultiSegments = (currentChapter?.segmentCount || 0) > 1
  const editorEyebrow = currentChapter ? `第 ${String(currentChapter.chapterNum).padStart(2, '0')} 章` : '写作编辑器'
  const editorTitle = currentChapter ? currentChapter.title || `第${currentChapter.chapterNum}章` : '请选择一个章节'
  const editorSubtitle = currentChapter
    ? `当前状态：${currentStatusLabel} · 当前正文视为入库稿，停止输入后会自动保存。`
    : '从左侧选择章节后即可直接编辑，右侧同步查看本章链路、修订建议与体检结果。'

  const resolvedEditorSubtitle = hasMultiSegments
    ? `当前状态：${currentStatusLabel} · 本章已拆成 ${currentChapter?.segmentCount || 0} 个场景，请优先在结构页维护场景后再编译整章。`
    : editorSubtitle

  return (
    <WorkspacePage
      className="novel-writing-page"
      layout="wide"
      eyebrow="正文工作台"
      title="正文写作"
      description="在同一个工作台里完成场景计划、AI 主写、自动审校、修订定稿、长文记忆和一致性检查。"
      heroVariant="compact"
      actions={(
        <>
          <Button icon={<PlusOutlined />} onClick={() => void handleAddChapter()}>新建章节</Button>
          {generating
            ? <Button danger icon={<LoadingOutlined />} onClick={() => void handleCancelGenerate()}>取消流水线</Button>
            : <Button type="primary" icon={<RobotOutlined />} disabled={!currentChapter} onClick={() => void handleGenerateContent()}>运行章节流水线</Button>}
          <Button icon={<BulbOutlined />} disabled={!currentChapter} onClick={() => void handleGenerateSummary()}>更新记忆</Button>
          <Button icon={<FileSearchOutlined />} disabled={!currentChapter} onClick={() => void handleAiCheck()}>AI 检测</Button>
        </>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="章节总数" value={chapters.length} tone="warm" hint="左侧列表可快速切章" />
          <WorkspaceMetric label="当前字数" value={`${wordCount} 字`} hint={currentChapter ? `章节状态：${currentStatusLabel}` : '先选择章节'} />
          <WorkspaceMetric label="结构体检" value={consistencyReport ? `${consistencyReport.readinessScore} 分` : '加载中'} tone="cool" hint={consistencyReport ? getHealthLabel(consistencyReport.readinessScore) : '正在分析全书结构'} />
          <WorkspaceMetric label="待同步章节" value={contextStatus ? contextStatus.staleChapterCount : '加载中'} hint={contextStatus?.staleChapterCount ? '最近的设定或前文变动已影响后续章节' : '当前没有受上下文变更影响的章节'} />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前章节', value: currentChapter ? `第${currentChapter.chapterNum}章 ${currentChapter.title || ''}` : '未选择章节' },
            { label: '当前状态', value: currentStatusLabel },
            { label: '长文记忆', value: storyMemory ? `${storyMemory.chapterCount} 章 · ${storyMemory.memoryMode === 'epic' ? '超长篇' : storyMemory.memoryMode === 'longform' ? '长篇' : '标准'}` : '尚未加载' },
            { label: '上下文版本', value: contextStatus ? `v${contextStatus.contextVersion}` : '加载中' },
          ]}
        />
      )}
    >
      {loading ? (
        <div className="novel-empty novel-empty--writing"><Spin /></div>
      ) : (
        <div className="novel-writing-shell">
          <aside className="novel-writing-shell__sidebar">
            <div className="novel-writing-shell__sidebar-header">
              <div className="novel-writing-shell__sidebar-title">章节列表</div>
              <div className="novel-writing-shell__sidebar-meta">共 {chapters.length} 章</div>
            </div>
            <div className="novel-writing-shell__chapter-list">
              {chapters.length > 0 ? chapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className={`novel-writing-shell__chapter-item ${currentChapterId === chapter.id ? 'novel-writing-shell__chapter-item--active' : ''}`}
                  onClick={() => void refreshChapter(chapter.id).then(() => { setCurrentChapterId(chapter.id); setAiResult(null); setGenerationProgress(null) })}
                  onMouseEnter={() => setHoverChapterId(chapter.id)}
                  onMouseLeave={() => setHoverChapterId(null)}
                >
                  <div className="novel-writing-shell__chapter-copy">
                    <div className="novel-writing-shell__chapter-number">第 {chapter.chapterNum} 章</div>
                    <div className="novel-writing-shell__chapter-name">{chapter.title || `第${chapter.chapterNum}章`}</div>
                    <div className="novel-writing-shell__chapter-words" style={{ color: STATUS_COLORS[chapter.status] || '#5c6378' }}>{chapter.wordCount} 字 · {getStatusLabel(chapter.status)}</div>
                    {parseStringArray(chapter.staleReasonJson).length > 0 ? <Tag color="warning">待同步</Tag> : null}
                  </div>
                  {hoverChapterId === chapter.id ? <Button type="text" size="small" danger className="novel-writing-shell__chapter-delete" icon={<DeleteOutlined />} onClick={(event) => handleDeleteChapter(chapter.id, event)} /> : null}
                </div>
              )) : <Empty description="还没有章节，先创建一个。" />}
            </div>
            <div className="novel-writing-shell__sidebar-footer">
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => void handleAddChapter()} style={{ width: '100%' }}>新建章节</Button>
            </div>
          </aside>

          <section className="novel-writing-shell__editor">
            <div className="novel-writing-shell__editor-header">
              <div className="novel-writing-shell__editor-title-block">
                <div className="novel-writing-shell__editor-kicker">{editorEyebrow}</div>
                <div className="novel-writing-shell__editor-title">{editorTitle}</div>
                <div className="novel-writing-shell__editor-subtitle">{resolvedEditorSubtitle}</div>
              </div>
              <div className="novel-writing-shell__editor-tools">
                {currentChapter ? <Select value={currentChapter.status} onChange={(value) => void handleStatusChange(value)} className="novel-writing-shell__editor-select" size="small" style={{ width: 156 }} options={STATUS_OPTIONS} /> : null}
                <div className="novel-writing-shell__editor-meta"><span className="novel-writing-shell__editor-meta-label">正文体量</span><strong>{wordCount} 字</strong></div>
              </div>
            </div>
            <div className="novel-writing-shell__editor-stage">
              {currentChapter ? (
                <div className="novel-writing-shell__editor-stage-inner">
                  <div className="novel-writing-shell__pipeline">
                    {pipelineStatus.map((stage) => (
                      <div key={stage.key} className={`novel-pipeline-stage novel-pipeline-stage--${stage.status}`}>
                        <div className="novel-pipeline-stage__eyebrow">{`阶段 ${String(stage.index + 1).padStart(2, '0')}`}</div>
                        <div className="novel-pipeline-stage__title">{stage.title}</div>
                        <div className="novel-pipeline-stage__summary">{stage.summary}</div>
                      </div>
                    ))}
                  </div>
                  {generationProgress ? <div className={`novel-writing-shell__generation-note novel-writing-shell__generation-note--${generationProgress.status}`}><strong>{generationProgress.label}</strong><span>{generationProgress.detail || '正在同步最新阶段进度。'}</span></div> : null}
                  {productionBriefItems.length > 0 ? (
                    <section className="novel-writing-shell__review-strip">
                      <div className="novel-writing-shell__review-strip-head">
                        <div>
                          <div className="novel-kicker">AI 定稿摘要</div>
                          <strong>本章最值得先处理的问题已经汇总到这里</strong>
                        </div>
                        {reviewNotes?.revision_brief ? <Tag color="gold">审校已生成</Tag> : null}
                      </div>
                      <div className="novel-writing-shell__review-strip-list">
                        {productionBriefItems.map((item, index) => (
                          <div key={`${item}-${index}`} className="novel-writing-shell__review-strip-item">{item}</div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {currentChapterStaleReasons.length > 0 ? (
                    <Alert
                      showIcon
                      type="warning"
                      style={{ marginBottom: 16 }}
                      message="当前章节上下文已过期"
                      description={`受这些变更影响：${currentChapterStaleReasons.join('；')}。建议先刷新摘要/记忆，必要时重新生成或回查本章承接。`}
                    />
                  ) : null}
                  {currentChapterStaleReasons.length === 0 && otherStaleChapterCount > 0 ? (
                    <Alert
                      showIcon
                      type="info"
                      style={{ marginBottom: 16 }}
                      message={`还有 ${otherStaleChapterCount} 章待同步`}
                      description="当前章节本身是最新的，但小说里还有其他章节受设定变更影响。继续推进后文前，建议回到这些章节逐一复查。"
                    />
                  ) : null}
                  {publishCheck ? (
                    <Alert
                      showIcon
                      type={getPublishCheckAlertType(publishCheck)}
                      style={{ marginBottom: 16 }}
                      message={`发布前检查：${publishCheck.summary}`}
                      description={`阻塞 ${publishCheck.blockerCount} 项，提醒 ${publishCheck.warningCount} 项。标记完成时会再次自动复检。`}
                    />
                  ) : null}
                  {hasMultiSegments ? (
                    <Alert
                      showIcon
                      type="info"
                      style={{ marginBottom: 16 }}
                      message="当前章节处于多场景结构模式"
                      description={(
                        <div className="novel-writing-shell__segment-alert">
                          <div className="novel-writing-shell__segment-alert-copy">
                            该章节已经拆成多个场景。为避免整章直改破坏场景顺序和上下文链路，正文区改为只读预览。
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
                  {generating ? (
                    <div className="novel-writing-shell__editor-sheet novel-writing-shell__editor-sheet--streaming">
                      <div className="novel-writing-shell__editor-stream-head">AI 正在续写本章 <Spin size="small" /></div>
                      <div className="novel-writing-shell__editor-stream">{streamContent}<span className="streaming-cursor" /></div>
                    </div>
                  ) : hasMultiSegments ? (
                    <div className="novel-writing-shell__segment-preview">
                      <SegmentBoardPreview
                        segments={chapterSegments}
                        onOpenStructure={() => navigate(`/novels/${novelId}/structure`)}
                        onCompile={() => void handleCompileCurrentChapter()}
                      />
                      <div className="novel-writing-shell__editor-sheet novel-writing-shell__editor-sheet--readonly" dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br>') }} />
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
                  )}
                </div>
              ) : <div className="novel-empty novel-empty--writing">请选择左侧章节，或先创建一个新章节开始写作。</div>}
            </div>
            <div className="novel-writing-shell__editor-footer">
              <Button disabled={!currentChapter} onClick={() => void handleOpenVersionHistory()}>版本历史</Button>
              <Button icon={<BulbOutlined />} disabled={!currentChapter} onClick={() => void handleGenerateSummary()}>更新摘要</Button>
              <Button icon={<FileSearchOutlined />} disabled={!currentChapter} onClick={() => void handleAiCheck()}>AI 体检</Button>
              <Button icon={<RobotOutlined />} disabled={!currentChapter || hasMultiSegments || !selectedSnippet?.text} loading={rewritingSelection} onClick={handleOpenRewriteModal}>重写选中文段</Button>
              {selectedSnippet?.text ? <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{`已选 ${selectedSnippet.text.length} 字`}</span> : null}
              <Button icon={<CheckOutlined />} disabled={!currentChapter} onClick={() => void handleStatusChange('final')} style={{ marginLeft: 'auto' }}>标记完成</Button>
            </div>
          </section>

          <aside className="novel-writing-shell__insight">
            <div className="novel-writing-shell__insight-switch">
              {(['chapter', 'memory', 'health'] as InsightTab[]).map((tab) => (
                <button key={tab} type="button" className={insightTab === tab ? 'is-active' : ''} onClick={() => setInsightTab(tab)}>
                  {tab === 'chapter' ? '本章链路' : tab === 'memory' ? '长文记忆' : '结构体检'}
                </button>
              ))}
            </div>

            {insightTab === 'chapter' ? (
              <>
                <div className="novel-writing-shell__insight-spotlight">
                  <ChapterFocusCard
                    summary={currentChapter?.summary}
                    nextChapterSeed={currentChapter?.nextChapterSeed}
                    continuityItems={continuityItems}
                  />
                  <InsightCard title="场景拆解" eyebrow="执行顺序">
                    {scenePlan.length > 0 ? <div className="novel-scene-list">{scenePlan.map((scene) => <div key={`${scene.scene_order}-${scene.scene_title}`} className="novel-scene-card"><div className="novel-scene-card__header"><span>{`场景 ${String(scene.scene_order).padStart(2, '0')}`}</span><strong>{scene.scene_title}</strong></div><div className="novel-scene-card__body"><div>{scene.purpose}</div>{scene.location ? <div>地点：{scene.location}</div> : null}{scene.time_anchor ? <div>时间：{scene.time_anchor}</div> : null}{scene.present_characters?.length ? <div>人物：{scene.present_characters.join('、')}</div> : null}{scene.key_items?.length ? <div>道具：{scene.key_items.join('、')}</div> : null}{scene.must_cover?.length ? <div>必须覆盖：{scene.must_cover.join('、')}</div> : null}</div></div>)}</div> : <div className="novel-copy-block">先运行章节流水线后，这里会整理本章场景计划。</div>}
                  </InsightCard>
                </div>
                <div className="novel-writing-shell__insight-stack">
                  <InsightCard title="生产摘要" eyebrow="AI 主写 / 人工定稿" tone="soft"><StringList items={productionBriefItems} empty="章节进入审校后，这里会先汇总最值得优先处理的定稿建议。" /></InsightCard>
                  <InsightCard title="关联线索" eyebrow="时间轴 / 道具" tone="soft"><StringList items={relatedInsightItems.slice(0, 12)} empty="当前章节暂未关联时间轴事件或关键道具。" /></InsightCard>
                  <InsightCard title="修订提示" eyebrow="复盘重点" tone="soft"><StringList items={reviewInsightItems} empty="运行审校或摘要更新后，这里会汇总需要回看的修订点。" /></InsightCard>
                  <InsightCard title="世界规则" eyebrow="写作边界" tone="soft"><StringList items={worldRulesSummary} empty={currentNovel?.worldRulesJson ? '当前世界规则已录入，但还没有提炼出本章相关边界。' : '先完善世界规则，这里会同步展示写作边界。'} /></InsightCard>
                </div>
              </>
            ) : null}

            {insightTab === 'memory' ? (
              <div className="novel-writing-shell__insight-stack">
                <InsightCard title="阶段摘要" eyebrow={storyMemory?.coverageSummary || '长篇覆盖'} tone="soft"><StringList items={storyMemory?.phaseDigest || []} empty="章节量还不大，阶段摘要会在长篇推进后逐步显现。" /></InsightCard>
                <InsightCard title="剧情里程碑" eyebrow="压缩摘要"><StringList items={storyMemory ? storyMemory.plotMilestones.slice(0, 12) : []} empty="长文记忆尚未生成。" /></InsightCard>
                <InsightCard title="活跃线程" eyebrow="待持续追踪" tone="soft"><StringList items={storyMemory ? storyMemory.activeThreads.slice(0, 12) : []} empty="当前没有需要持续追踪的活跃线程。" /></InsightCard>
                <InsightCard title="时间锚点" eyebrow="时序参照" tone="soft"><StringList items={storyMemory ? storyMemory.timelineAnchors.slice(0, 10) : []} empty="时间轴锚点会在这里同步展示。" /></InsightCard>
                <InsightCard title="道具账本" eyebrow="状态同步" tone="soft"><StringList items={storyMemory ? storyMemory.itemLedger.slice(0, 10) : []} empty="关键道具与线索的状态变化会记录在这里。" /></InsightCard>
              </div>
            ) : null}

            {insightTab === 'health' ? (
              <>
                <div className="novel-writing-shell__insight-spotlight">
                  <InsightCard title="全书健康度" eyebrow="结构体检" tone="hero">{consistencyReport ? <div className="novel-health-board"><div className="novel-health-score"><strong>{consistencyReport.readinessScore}</strong><span>{getHealthLabel(consistencyReport.readinessScore)}</span></div><div className="novel-health-breakdown"><div><strong>{consistencyReport.highCount}</strong><span>高危</span></div><div><strong>{consistencyReport.mediumCount}</strong><span>中危</span></div><div><strong>{consistencyReport.lowCount}</strong><span>低危</span></div></div></div> : <div className="novel-copy-block">正在分析全书结构健康度。</div>}</InsightCard>
                  <InsightCard title="本章风险" eyebrow="优先修复">{chapterIssues.length > 0 ? <div className="novel-issue-list">{chapterIssues.slice(0, 8).map((issue) => <div key={issue.id} className="novel-issue-item"><div className="novel-issue-item__head"><Tag color={getIssueColor(issue.severity)}>{getIssueLabel(issue.severity)}</Tag><strong>{issue.title}</strong></div><div className="novel-issue-item__desc">{issue.description}</div><div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div></div>)}</div> : <div className="novel-copy-block">当前章节没有被结构体检命中的明显风险。</div>}</InsightCard>
                </div>
                <div className="novel-writing-shell__insight-stack">
                  <InsightCard title="发布前检查" eyebrow="完成门槛" tone="soft">
                    {publishCheck ? (
                      <StringList
                        items={publishCheck.checklist.map((item) => {
                          const prefix = item.status === 'pass' ? '通过' : item.status === 'warning' ? '提醒' : '阻塞'
                          return `${prefix} · ${item.label}：${item.detail}`
                        })}
                        empty="当前没有发布前检查结果。"
                      />
                    ) : <div className="novel-copy-block">当前没有发布前检查结果。</div>}
                  </InsightCard>
                  <InsightCard title="AI 评分与复检" eyebrow="局部诊断" tone="soft">
                    <AIScorePanel
                      getContent={() => normalizeEditorText(editorRef.current?.innerText || content)}
                      contentType="chapter"
                      genreContext={currentNovel?.genreName || ''}
                      novelBackground={[currentNovel?.synopsis, currentNovel?.expandedBackground].filter(Boolean).join('\n')}
                      modelConfigId={currentNovel?.modelConfigId}
                      disabled={!currentChapter}
                      onRegenerate={applyChapterContent}
                      drawCount={1}
                    />
                    {aiResult ? <div style={{ marginTop: 12 }}><AiCheckResult result={aiResult} /></div> : <div className="novel-copy-block" style={{ marginTop: 12 }}>点击上方 AI 体检后，这里也会展示语义与表达层面的复检结果。</div>}
                  </InsightCard>
                  <InsightCard title="建议优先处理" eyebrow="下一步" tone="soft"><StringList items={consistencyReport?.focusAreas || []} empty="当前没有额外的优先处理建议。" /></InsightCard>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}
      <Modal
        title="章节版本历史"
        open={versionHistoryOpen}
        onCancel={() => setVersionHistoryOpen(false)}
        onOk={() => void handleRestoreVersion()}
        okButtonProps={{ disabled: !selectedVersion }}
        okText="恢复所选版本"
        width={860}
      >
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
          <div className="novel-copy-block" style={{ whiteSpace: 'pre-wrap', minHeight: 320 }}>
            {selectedVersion?.content || '选择左侧版本后，这里会显示正文预览。'}
          </div>
        </div>
      </Modal>
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
    </WorkspacePage>
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

function ChapterFocusCard({
  summary,
  nextChapterSeed,
  continuityItems,
}: {
  summary?: string | null
  nextChapterSeed?: string | null
  continuityItems: string[]
}) {
  const hasSummary = Boolean(summary?.trim())
  const hasNextChapterSeed = Boolean(nextChapterSeed?.trim())
  const hasContinuity = continuityItems.length > 0

  return (
    <InsightCard title="本章聚焦" eyebrow="主线锚点" tone="hero">
      {hasSummary || hasNextChapterSeed || hasContinuity ? (
        <div className="novel-writing-shell__focus-card">
          {hasSummary ? <section className="novel-writing-shell__focus-block"><div className="novel-writing-shell__focus-label">一句话摘要</div><div className="novel-writing-shell__focus-copy">{summary}</div></section> : null}
          {hasNextChapterSeed ? <section className="novel-writing-shell__focus-block novel-writing-shell__focus-block--accent"><div className="novel-writing-shell__focus-label">下一章引子</div><div className="novel-writing-shell__focus-copy">{nextChapterSeed}</div></section> : null}
          {hasContinuity ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">连续性提醒</div><div className="novel-insight-list">{continuityItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
        </div>
      ) : <div className="novel-copy-block">章节流水线完成后，这里会自动汇总本章摘要、承接提醒与下一章引子。</div>}
    </InsightCard>
  )
}

function StringList({ items, empty }: { items: string[]; empty: string }) {
  return items.length > 0 ? <div className="novel-insight-list">{items.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item">{item}</div>)}</div> : <div className="novel-copy-block">{empty}</div>
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
      message.warning('至少需要2个章节才能分析并行可能性')
      return
    }
    setAnalyzing(true)
    try {
      const minNum = Math.min(...chapterList.map((c) => c.chapterNum))
      const maxNum = Math.max(...chapterList.map((c) => c.chapterNum))
      const result = await window.electron.parallel.analyzePlan(novelId, minNum, maxNum)
      setPlan(result)
    } catch (error) {
      message.error('分析失败：' + (error instanceof Error ? error.message : '未知错误'))
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

