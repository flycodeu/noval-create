import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal, Progress, Select, Spin, Tag, message } from 'antd'
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
import { useNavigate } from 'react-router-dom'
import type {
  Chapter,
  ChapterSegment,
  ChapterPublishCheck,
  NovelConsistencyReport,
  NovelContextStatus,
  StoryItem,
  StoryMemorySnapshot,
  TimelineEvent,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTaskStore } from '../../../stores/task.store'
import { useWorkspaceStore } from '../../../stores/workspace.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage } from '../components/WorkspaceShell'
import './index.css'

interface Props { novelId: number }
interface AiCheckPayload { score: number; issues: Array<{ type: string; location: string; suggestion: string }>; overall_feedback: string }
interface ContinuityPayload { plot_progress?: string[]; character_state_changes?: string[]; world_state_changes?: string[]; open_loops?: string[]; continuity_notes?: string[]; arc_progress?: string }
interface ScenePlanStep { scene_order: number; scene_title: string; purpose: string; location: string; time_anchor: string; present_characters: string[]; key_items: string[]; must_cover: string[] }
interface ReviewNotes { summary: string; critical_fixes: string[]; continuity_risks: string[]; language_risks: string[]; genre_hollowing_risks: string[]; revision_brief: string }
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

export default function Writing({ novelId }: Props) {
  const navigate = useNavigate()
  const { chapters, currentChapterId, currentNovel, setChapters, setCurrentChapterId, updateChapter } = useNovelStore()
  const { streams, clearStream } = useTaskStore()
  const { mode } = useWorkspaceStore()
  const editorRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentChapterIdRef = useRef<number | null>(null)

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

  useEffect(() => { currentChapterIdRef.current = currentChapterId }, [currentChapterId])
  useEffect(() => { if (mode === 'guided') setInsightTab('chapter') }, [mode])

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
    const [full, segments] = await Promise.all([
      window.electron.chapter.get(chapterId),
      window.electron.structure.listSegments(chapterId),
    ])
    if (!full) return
    setChapterSegments(segments)
    setCurrentChapter(full)
    setContent(full.content || '')
    setWordCount(countWords(full.content || ''))
    updateChapter(chapterId, full)
    if (editorRef.current) editorRef.current.innerHTML = (full.content || '').replace(/\n/g, '<br>')
    await Promise.all([refreshPublishCheck(chapterId), refreshContextStatus(), refreshChapterLinks(full)])
  }, [refreshChapterLinks, refreshContextStatus, refreshPublishCheck, updateChapter])

  const loadChapters = useCallback(async (preferredChapterId?: number) => {
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)
    if (list.length === 0) {
      setCurrentChapter(null); setCurrentChapterId(null); setContent(''); setWordCount(0); setPublishCheck(null); setChapterSegments([]); setTimelineEvents([]); setStoryItems([]); await refreshContextStatus(); return
    }
    const target = list.find((chapter) => chapter.id === (preferredChapterId ?? currentChapterIdRef.current)) || list[0]
    setCurrentChapterId(target.id)
    await refreshChapter(target.id)
  }, [novelId, refreshChapter, refreshContextStatus, setChapters, setCurrentChapterId])

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      try { await Promise.all([loadChapters(), refreshMeta(), refreshContextStatus()]) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [loadChapters, refreshContextStatus, refreshMeta])

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
  }, [streams, generatingTaskId, currentChapter?.id, clearStream, loadChapters, refreshMeta, refreshChapter])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const queueSave = useCallback((chapterId: number, text: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void window.electron.chapter.update(chapterId, { content: text, wordCount: countWords(text) })
        .then(async () => {
          await refreshContextStatus()
          if (currentChapterIdRef.current === chapterId) {
            await refreshPublishCheck(chapterId)
          }
        })
      updateChapter(chapterId, { content: text, wordCount: countWords(text) })
    }, 1500)
  }, [refreshContextStatus, refreshPublishCheck, updateChapter])

  const handleContentChange = (event: React.FormEvent<HTMLDivElement>) => {
    if ((currentChapter?.segmentCount || 0) > 1) return
    const text = event.currentTarget.innerText || ''
    setContent(text); setWordCount(countWords(text))
    if (currentChapter) queueSave(currentChapter.id, text)
  }

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
    ...(reviewNotes?.language_risks || []).map((item) => `语言提示：${item}`),
    ...(reviewNotes?.genre_hollowing_risks || []).map((item) => `体裁空心化：${item}`),
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
    ? `当前状态：${currentStatusLabel} · 文稿会在停止输入后自动保存。`
    : '从左侧选择章节后即可直接编辑，右侧同步查看本章链路与体检建议。'

  const resolvedEditorSubtitle = hasMultiSegments
    ? `当前状态：${currentStatusLabel} · 本章已拆成 ${currentChapter?.segmentCount || 0} 个场景，请优先在结构页维护场景后再编译整章。`
    : editorSubtitle

  return (
    <WorkspacePage
      className={`novel-writing-page novel-writing-page--${mode}`}
      layout="wide"
      eyebrow={mode === 'guided' ? '写作台' : '章节流水线'}
      title="正文写作"
      description={mode === 'guided' ? '在同一个写作台里完成章节生成、场景计划、审校修订、长文记忆和一致性检查。' : '正文页直接打通章节四阶段流水线、全书一致性报告、时间轴联动和长文压缩记忆。'}
      heroVariant="compact"
      actions={(
        <>
          <Button icon={<PlusOutlined />} onClick={() => void handleAddChapter()}>新建章节</Button>
          {generating
            ? <Button danger icon={<LoadingOutlined />} onClick={() => void handleCancelGenerate()}>取消流水线</Button>
            : <Button type="primary" icon={<RobotOutlined />} disabled={!currentChapter} onClick={() => void handleGenerateContent()}>{mode === 'guided' ? '运行四阶段写作' : '运行章节流水线'}</Button>}
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
            { label: '工作模式', value: mode === 'guided' ? '小白模式' : '专业模式' },
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
        <div className={`novel-writing-shell novel-writing-shell--${mode}`}>
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
                    <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={handleContentChange} className="novel-writing-shell__editor-sheet" dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br>') }} />
                  )}
                </div>
              ) : <div className="novel-empty novel-empty--writing">请选择左侧章节，或先创建一个新章节开始写作。</div>}
            </div>
            <div className="novel-writing-shell__editor-footer">
              <Button icon={<BulbOutlined />} disabled={!currentChapter} onClick={() => void handleGenerateSummary()}>更新摘要</Button>
              <Button icon={<FileSearchOutlined />} disabled={!currentChapter} onClick={() => void handleAiCheck()}>AI 体检</Button>
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
                    continuityItems={continuityItems.slice(0, mode === 'guided' ? 5 : continuityItems.length)}
                  />
                  <InsightCard title="场景拆解" eyebrow="执行顺序">
                    {scenePlan.length > 0 ? <div className="novel-scene-list">{scenePlan.map((scene) => <div key={`${scene.scene_order}-${scene.scene_title}`} className="novel-scene-card"><div className="novel-scene-card__header"><span>{`场景 ${String(scene.scene_order).padStart(2, '0')}`}</span><strong>{scene.scene_title}</strong></div><div className="novel-scene-card__body"><div>{scene.purpose}</div>{scene.location ? <div>地点：{scene.location}</div> : null}{scene.time_anchor ? <div>时间：{scene.time_anchor}</div> : null}{scene.present_characters?.length ? <div>人物：{scene.present_characters.join('、')}</div> : null}{scene.key_items?.length ? <div>道具：{scene.key_items.join('、')}</div> : null}{scene.must_cover?.length ? <div>必须覆盖：{scene.must_cover.join('、')}</div> : null}</div></div>)}</div> : <div className="novel-copy-block">先运行章节流水线后，这里会整理本章场景计划。</div>}
                  </InsightCard>
                </div>
                <div className="novel-writing-shell__insight-stack">
                  <InsightCard title="关联线索" eyebrow="时间轴 / 道具" tone="soft"><StringList items={relatedInsightItems.slice(0, mode === 'guided' ? 6 : 12)} empty="当前章节暂未关联时间轴事件或关键道具。" /></InsightCard>
                  <InsightCard title="修订提示" eyebrow="复盘重点" tone="soft"><StringList items={reviewInsightItems} empty="运行审校或摘要更新后，这里会汇总需要回看的修订点。" /></InsightCard>
                  <InsightCard title="世界规则" eyebrow="写作边界" tone="soft"><StringList items={worldRulesSummary} empty={currentNovel?.worldRulesJson ? '当前世界规则已录入，但还没有提炼出本章相关边界。' : '先完善世界规则，这里会同步展示写作边界。'} /></InsightCard>
                </div>
              </>
            ) : null}

            {insightTab === 'memory' ? (
              <div className="novel-writing-shell__insight-stack">
                <InsightCard title="阶段摘要" eyebrow={storyMemory?.coverageSummary || '长篇覆盖'} tone="soft"><StringList items={storyMemory?.phaseDigest || []} empty="章节量还不大，阶段摘要会在长篇推进后逐步显现。" /></InsightCard>
                <InsightCard title="剧情里程碑" eyebrow="压缩摘要"><StringList items={storyMemory ? storyMemory.plotMilestones.slice(0, mode === 'guided' ? 6 : 12) : []} empty="长文记忆尚未生成。" /></InsightCard>
                <InsightCard title="活跃线程" eyebrow="待持续追踪" tone="soft"><StringList items={storyMemory ? storyMemory.activeThreads.slice(0, mode === 'guided' ? 6 : 12) : []} empty="当前没有需要持续追踪的活跃线程。" /></InsightCard>
                <InsightCard title="时间锚点" eyebrow="时序参照" tone="soft"><StringList items={storyMemory ? storyMemory.timelineAnchors.slice(0, mode === 'guided' ? 6 : 10) : []} empty="时间轴锚点会在这里同步展示。" /></InsightCard>
                <InsightCard title="道具账本" eyebrow="状态同步" tone="soft"><StringList items={storyMemory ? storyMemory.itemLedger.slice(0, mode === 'guided' ? 6 : 10) : []} empty="关键道具与线索的状态变化会记录在这里。" /></InsightCard>
              </div>
            ) : null}

            {insightTab === 'health' ? (
              <>
                <div className="novel-writing-shell__insight-spotlight">
                  <InsightCard title="全书健康度" eyebrow="结构体检" tone="hero">{consistencyReport ? <div className="novel-health-board"><div className="novel-health-score"><strong>{consistencyReport.readinessScore}</strong><span>{getHealthLabel(consistencyReport.readinessScore)}</span></div><div className="novel-health-breakdown"><div><strong>{consistencyReport.highCount}</strong><span>高危</span></div><div><strong>{consistencyReport.mediumCount}</strong><span>中危</span></div><div><strong>{consistencyReport.lowCount}</strong><span>低危</span></div></div></div> : <div className="novel-copy-block">正在分析全书结构健康度。</div>}</InsightCard>
                  <InsightCard title="本章风险" eyebrow="优先修复">{chapterIssues.length > 0 ? <div className="novel-issue-list">{chapterIssues.slice(0, mode === 'guided' ? 4 : 8).map((issue) => <div key={issue.id} className="novel-issue-item"><div className="novel-issue-item__head"><Tag color={getIssueColor(issue.severity)}>{getIssueLabel(issue.severity)}</Tag><strong>{issue.title}</strong></div><div className="novel-issue-item__desc">{issue.description}</div><div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div></div>)}</div> : <div className="novel-copy-block">当前章节没有被结构体检命中的明显风险。</div>}</InsightCard>
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
                  <InsightCard title="AI 复检" eyebrow="局部诊断" tone="soft">{aiResult ? <AiCheckResult result={aiResult} /> : <div className="novel-copy-block">点击上方 AI 体检后，这里会展示语义与表达层面的复检结果。</div>}</InsightCard>
                  <InsightCard title="建议优先处理" eyebrow="下一步" tone="soft"><StringList items={consistencyReport?.focusAreas || []} empty="当前没有额外的优先处理建议。" /></InsightCard>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}
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

