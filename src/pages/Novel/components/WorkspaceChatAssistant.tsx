import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Drawer, Empty, Input, Segmented, Space, Spin, Tag, Tooltip, message } from 'antd'
import {
  BarChartOutlined,
  CheckOutlined,
  ClearOutlined,
  CloseOutlined,
  CopyOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { AiExecutionMode } from '../../../shared/ai-execution'
import type {
  Chapter,
  Novel,
  QualityDashboardData,
  WorkspaceQualityPatch,
  WorkspaceQualityRepairPreview,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  buildWorkspaceQualityRequestBase,
  getFallbackWorkspaceQualityAdapter,
  type WorkspaceQualityAdapterContext,
  type WorkspaceQualityRouteKey,
} from '../shared/workspace-quality'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import './WorkspaceChatAssistant.css'

type ChatRole = 'user' | 'assistant'

interface AssistantMessage {
  id: string
  role: ChatRole
  content: string
  intent?: string
  createdAt: number
  repairPreview?: WorkspaceQualityRepairPreview
  baseSnapshot?: Record<string, unknown>
  appliedAt?: number
}

interface AssistantIntent {
  id: string
  label: string
  prompt: string
}

interface Props {
  open: boolean
  compact: boolean
  resizable?: boolean
  width?: number
  workspaceKey: string
  workspaceLabel: string
  workspaceSummary: string
  novelId: number
  currentNovel: Novel | null
  currentChapter: Chapter | null
  controller: RegisteredWorkspaceQualityController | null
  onClose: () => void
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void
  onOpenQuality?: () => void
  onApplied?: () => void
}

const QUALITY_ROUTE_KEYS: WorkspaceQualityRouteKey[] = [
  'overview',
  'project-brief',
  'core-settings',
  'theme-voice',
  'world-rules',
  'endgame',
  'map',
  'factions',
  'characters',
  'arc-center',
  'resistance',
  'items',
  'glossary',
  'threads',
  'scene-templates',
  'story-design',
  'outline',
  'volume-design',
  'contracts',
  'structure',
  'timeline',
  'info-gap-board',
  'foreshadow-ledger',
  'growth-system',
  'writing',
  'revision',
]

const ASSISTANT_INTENTS: AssistantIntent[] = [
  {
    id: 'review',
    label: '综合评审',
    prompt: '请对当前页面内容做一次综合评审：结构是否完整、上下文是否一致、是否有 AI 味、是否能支撑后续写作，并给出优先级排序。',
  },
  {
    id: 'repair',
    label: '修复方案',
    prompt: '请基于当前上下文给出可执行修复方案。按“必须修、建议修、可暂缓”分层，并尽量给出可直接替换的中文文本。',
  },
  {
    id: 'direct_patch',
    label: '修改当前步骤',
    prompt: '请直接生成当前步骤可应用的修改补丁：保留作者原意，修掉空泛、重复和不连贯内容；只改当前步骤内最需要调整的字段。',
  },
  {
    id: 'humanize',
    label: '去 AI 味',
    prompt: '请专项检测当前内容的 AI 味，包括空泛抽象、模板句、假深刻、对称句式、解释型旁白和角色同质化，并给出更像真人作者的改写方向。',
  },
  {
    id: 'expand',
    label: '扩展内容',
    prompt: '请在不破坏已有设定的前提下扩展当前内容，重点补足目标、阻力、代价、场景可写性和后续章节钩子。',
  },
  {
    id: 'longform',
    label: '长篇检查',
    prompt: '请检查当前项目是否适合十几万字到百万字规模：上下文召回、伏笔回收、角色弧线、章节推进和反复生成的风险在哪里。',
  },
]

function isWorkspaceQualityRouteKey(value: string): value is WorkspaceQualityRouteKey {
  return QUALITY_ROUTE_KEYS.includes(value as WorkspaceQualityRouteKey)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getAtPath(target: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, target)
}

function setAtPath(target: unknown, path: string[], value: unknown) {
  if (path.length === 0 || !target || typeof target !== 'object') return
  let cursor: unknown = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(segment)
      cursor = Number.isInteger(arrayIndex) ? cursor[arrayIndex] : undefined
      continue
    }
    if (cursor && typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[segment]
    }
  }

  const last = path[path.length - 1]
  if (Array.isArray(cursor)) {
    const arrayIndex = Number(last)
    if (Number.isInteger(arrayIndex)) cursor[arrayIndex] = value
    return
  }
  if (cursor && typeof cursor === 'object') {
    (cursor as Record<string, unknown>)[last] = value
  }
}

function applyAllPatches(
  baseSnapshot: Record<string, unknown>,
  patchedSnapshot: Record<string, unknown>,
  patches: WorkspaceQualityPatch[],
) {
  const nextSnapshot = cloneJson(baseSnapshot)
  patches.forEach((patch) => {
    setAtPath(nextSnapshot, patch.path, getAtPath(patchedSnapshot, patch.path))
  })
  return nextSnapshot
}

function shouldPreparePatch(userRequest: string, intent?: string) {
  if (intent === 'direct_patch') return true
  return /直接(?:修改|改写|应用|更新)|帮我(?:修改|改写|更新)|把.+(?:改成|替换成)|修改.+(?:信息|内容|字段|步骤)|应用到当前步骤/u.test(userRequest)
}

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...（已截断 ${value.length - maxLength} 字，保留最相关的前段上下文）`
}

function stringifySnapshot(value: Record<string, unknown> | null) {
  if (!value) return '当前页面没有可用的结构化快照。'
  try {
    return truncateText(JSON.stringify(value, null, 2), 6200)
  } catch {
    return '当前页面快照无法序列化，只能根据小说基础信息与质量信号评审。'
  }
}

function formatWordCount(value?: number | null) {
  if (!value || !Number.isFinite(value)) return '未设置'
  if (value >= 10000) return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)} 万字`
  return `${value} 字`
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function takeStringList(value: unknown, count: number) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, count)
}

function buildQualitySignalLines(dashboard: QualityDashboardData | null) {
  if (!dashboard) return []

  const partial = dashboard as Partial<QualityDashboardData>
  const lines: string[] = []

  const readiness = partial.productionReadiness as Partial<QualityDashboardData['productionReadiness']> | undefined
  if (readiness) {
    const summary = asNonEmptyString(readiness.summary) || '暂无摘要'
    const readyRate = asFiniteNumber(readiness.readyRate)
    lines.push(`生产准备：${summary}${readyRate === null ? '' : `；可发布率 ${readyRate}%`}`)
    takeStringList(readiness.blockers, 3).forEach((item) => lines.push(`生产阻塞：${item}`))
    takeStringList(readiness.warnings, 3).forEach((item) => lines.push(`生产预警：${item}`))
  }

  const batchHealth = partial.batchHealth as Partial<QualityDashboardData['batchHealth']> | undefined
  const batchSummary = asNonEmptyString(batchHealth?.summary)
  if (batchSummary) {
    lines.push(`批量健康：${batchSummary}`)
  }

  const continuity = partial.continuityHealth as Partial<QualityDashboardData['continuityHealth']> | undefined
  if (continuity) {
    const staleCheckpointCount = asFiniteNumber(continuity.staleCheckpointCount) ?? 0
    const worldConflictCount = asFiniteNumber(continuity.worldConflictCount) ?? 0
    const recallDegradedChapterCount = asFiniteNumber(continuity.recallDegradedChapterCount) ?? 0
    lines.push(`连续性：检查点待刷新 ${staleCheckpointCount}，世界状态冲突 ${worldConflictCount}，召回降级章节 ${recallDegradedChapterCount}`)
  }

  const qualityMetrics = partial.novelQualityMetrics as Partial<QualityDashboardData['novelQualityMetrics']> | undefined
  if (qualityMetrics) {
    const healthScore = asFiniteNumber(qualityMetrics.healthScore)
    const analyzedChapterCount = asFiniteNumber(qualityMetrics.analyzedChapterCount)
    const totalChapterCount = asFiniteNumber(qualityMetrics.totalChapterCount)
    const topRiskCount = Array.isArray(qualityMetrics.topRisks) ? qualityMetrics.topRisks.length : null
    if (healthScore !== null || analyzedChapterCount !== null || totalChapterCount !== null) {
      lines.push(`长篇健康：${healthScore ?? '未评分'} 分；已分析 ${analyzedChapterCount ?? 0}/${totalChapterCount ?? 0} 章`)
    } else if (topRiskCount && topRiskCount > 0) {
      lines.push(`长篇健康：当前有 ${topRiskCount} 项主要风险待处理`)
    }
  }

  const antiAi = partial.antiAiRecurrence as Partial<QualityDashboardData['antiAiRecurrence']> | undefined
  if (antiAi) {
    const highRiskRuleCount = asFiniteNumber(antiAi.highRiskRuleCount)
    const promotedRuleCount = asFiniteNumber(antiAi.promotedRuleCount)
    if (highRiskRuleCount !== null || promotedRuleCount !== null) {
      lines.push(`Anti-AI 复现：高风险规则 ${highRiskRuleCount ?? 0}，已前置规则 ${promotedRuleCount ?? 0}`)
    }
  }

  const feedback = partial.feedbackRecurrence as Partial<QualityDashboardData['feedbackRecurrence']> | undefined
  const humanization = feedback?.humanization as Partial<QualityDashboardData['feedbackRecurrence']['humanization']> | undefined
  const feedbackSource = humanization || feedback
  if (feedbackSource) {
    const highRiskIssueCount = asFiniteNumber(feedbackSource.highRiskIssueCount)
    const pauseSuggestedIssueCount = asFiniteNumber(feedbackSource.pauseSuggestedIssueCount)
    if (highRiskIssueCount !== null || pauseSuggestedIssueCount !== null) {
      lines.push(`${humanization ? '人味反馈' : '反馈复现'}：高风险 ${highRiskIssueCount ?? 0}，建议暂停 ${pauseSuggestedIssueCount ?? 0}`)
    }
  }

  const millionRuntimeSummary = asNonEmptyString(partial.millionRuntimeObservability?.summary)
  if (millionRuntimeSummary) {
    lines.push(`百万字运行：${millionRuntimeSummary}`)
  }

  const structuredMemorySummary = asNonEmptyString(partial.structuredMemoryObservability?.summary)
  if (structuredMemorySummary) {
    lines.push(`结构化记忆：${structuredMemorySummary}`)
  }

  return lines.slice(0, 14)
}

function buildNovelContext(novel: Novel | null, chapter: Chapter | null) {
  const novelLines = [
    `书名：${novel?.title || '未命名小说'}`,
    `题材：${novel?.genreName || '未设置'}`,
    `目标字数：${formatWordCount(novel?.targetWords)}`,
    `简介：${novel?.synopsis || '未填写'}`,
    `原始背景：${truncateText(novel?.userBackground || '未填写', 900)}`,
    `扩写背景：${truncateText(novel?.expandedBackground || '未填写', 1400)}`,
  ]

  if (!chapter) return novelLines.join('\n')

  return [
    ...novelLines,
    `当前章节：第 ${chapter.chapterNum} 章 ${chapter.title || ''}`.trim(),
    `章节状态：${chapter.status || '未设置'}`,
    `章节摘要：${chapter.summary || '未填写'}`,
    `章节大纲：${truncateText(chapter.outline || '未填写', 900)}`,
  ].join('\n')
}

function buildHistoryBlock(messages: AssistantMessage[]) {
  return messages
    .slice(-8)
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${truncateText(item.content, 900)}`)
    .join('\n\n')
}

function buildAssistantPrompt(input: {
  userRequest: string
  workspaceKey: string
  workspaceLabel: string
  workspaceSummary: string
  novel: Novel | null
  chapter: Chapter | null
  snapshot: Record<string, unknown> | null
  qualitySignals: string[]
  history: AssistantMessage[]
  novelId: number
}) {
  const qualityKey = isWorkspaceQualityRouteKey(input.workspaceKey) ? input.workspaceKey : null
  const base = qualityKey
    ? buildWorkspaceQualityRequestBase(qualityKey, {
      novelId: input.novelId,
      currentNovel: input.novel,
      currentChapter: input.chapter,
    })
    : null

  return [
    '你是 NovelForge 右侧常驻 AI 协作面板。你必须基于当前小说、当前工作区、当前章节、结构化快照和质量信号回答，不要脱离上下文泛泛而谈。',
    [
      '请在同一个回答里模拟多个专业 agent 协同评审，但不要输出冗长角色扮演：',
      '- 结构审稿 Agent：检查目标、阻力、代价、递进和章节可写性。',
      '- 上下文一致性 Agent：检查人物、设定、时间线、伏笔、写作合同与当前步骤是否冲突。',
      '- 人味编辑 Agent：降低 AI 味，避免空泛抽象、模板句、假深刻、解释型旁白和同质化对白。',
      '- 长篇工程 Agent：判断十几万字、百万字规模下的召回、回写、伏笔回收和节奏风险。',
      '- 可用性 Agent：如果用户问界面或流程，只评估当前页面密度、步骤、按钮和布局，不臆造不存在的功能。',
    ].join('\n'),
    [
    '硬性规则：',
      '- 聊天回复本身不要声称已经保存数据库；如果本次生成了可应用补丁，界面会提供“应用本次修改”按钮。',
      '- 如果用户要求直接修改，请先说明将修改哪些字段和为什么改；最终落地由当前页面补丁机制完成。',
      '- 给修复时优先保留作者原意，只替换问题句、缺失约束和不稳定设定。',
      '- 如果最近聊天已经给过同类结论，不要换同义词重复；直接标出新增判断、修正判断和仍待确认的风险。',
      '- 回答必须显式承接当前工作区的上游和下游，不要把下一步页面的内容提前写满。',
      '- 不要输出“作为 AI”“以下是”“我将”“思考过程”等会污染小说正文的工作流文字。',
      '- 中文表达要像编辑给作者的工作稿：具体、克制、有场景抓手。',
    ].join('\n'),
    `当前工作区：${input.workspaceLabel}（${input.workspaceKey}）\n${input.workspaceSummary || base?.workspaceSummary || '无摘要'}`,
    base ? `上下游关联：\n上游：${base.upstreamContext}\n下游：${base.downstreamContext}\n项目立项：${base.projectBriefSummary || '未形成'}\n主题文风：${base.themeVoiceSummary || '未形成'}` : '',
    `当前小说上下文：\n${buildNovelContext(input.novel, input.chapter)}`,
    input.qualitySignals.length > 0 ? `质量/长篇信号：\n${input.qualitySignals.map((item) => `- ${item}`).join('\n')}` : '质量/长篇信号：暂未读取到质量看板数据。',
    `当前工作区快照：\n${stringifySnapshot(input.snapshot)}`,
    input.history.length > 0 ? `最近聊天：\n${buildHistoryBlock(input.history)}` : '',
    `用户本次需求：${input.userRequest}`,
    [
      '输出格式：',
      '1. 先给一句结论。',
      '2. 用短段落列出多 Agent 评审结果。',
      '3. 给出按优先级排序的修复/扩展步骤。',
      '4. 如果用户要求改写，给出可直接替换的候选文本。',
      '5. 最后列出需要人工确认的风险点。',
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
}

export default function WorkspaceChatAssistant({
  open,
  compact,
  resizable = false,
  width,
  workspaceKey,
  workspaceLabel,
  workspaceSummary,
  novelId,
  currentNovel,
  currentChapter,
  controller,
  onClose,
  onResizeStart,
  onOpenQuality,
  onApplied,
}: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)
  const [qualitySignals, setQualitySignals] = useState<string[]>([])
  const [executionMode, setExecutionMode] = useState<AiExecutionMode>('review_first')
  const contextRequestRef = useRef(0)
  const conversationVersionRef = useRef(0)
  const askInFlightRef = useRef(false)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)

  const qualityKey = useMemo(
    () => (isWorkspaceQualityRouteKey(workspaceKey) ? workspaceKey : null),
    [workspaceKey],
  )
  const adapterContext = useMemo<WorkspaceQualityAdapterContext>(() => ({
    novelId,
    currentNovel,
    currentChapter,
  }), [currentChapter, currentNovel, novelId])
  const activeController = controller?.workspaceKey === workspaceKey ? controller : null
  const fallbackAdapter = useMemo(
    () => (qualityKey ? getFallbackWorkspaceQualityAdapter(qualityKey) : undefined),
    [qualityKey],
  )
  const canUseWorkspaceSnapshot = Boolean(activeController || fallbackAdapter)
  const canApplyWorkspacePatch = Boolean(
    (activeController && !activeController.readonly)
    || (fallbackAdapter?.applySnapshot && !fallbackAdapter.readonly),
  )
  const contextKey = `${novelId}:${workspaceKey}:${currentChapter?.id ?? ''}`

  const fetchContext = useCallback(async () => {
    const snapshotPromise = (async () => {
      if (activeController) return activeController.getSnapshot()
      if (fallbackAdapter) return fallbackAdapter.fetchSnapshot(adapterContext)
      return null
    })()
    const dashboardPromise = window.electron.quality.getDashboard(novelId).catch(() => null)
    const [nextSnapshot, dashboard] = await Promise.all([snapshotPromise, dashboardPromise])
    return {
      snapshot: nextSnapshot,
      qualitySignals: buildQualitySignalLines(dashboard),
    }
  }, [activeController, adapterContext, fallbackAdapter, novelId])

  const loadContext = useCallback(async (showError = false) => {
    const requestId = contextRequestRef.current + 1
    contextRequestRef.current = requestId
    setSnapshotLoading(true)
    try {
      const context = await fetchContext()
      if (requestId !== contextRequestRef.current) return
      setSnapshot(context.snapshot)
      setQualitySignals(context.qualitySignals)
    } catch (error) {
      console.error(error)
      if (showError) message.error(getUserFacingMessage('workspaceChat.contextLoadFailed'))
    } finally {
      if (requestId === contextRequestRef.current) {
        setSnapshotLoading(false)
      }
    }
  }, [fetchContext])

  useEffect(() => {
    contextRequestRef.current += 1
    conversationVersionRef.current += 1
    askInFlightRef.current = false
    setMessages([])
    setInput('')
    setSnapshot(null)
    setQualitySignals([])
    setSnapshotLoading(false)
    setLoading(false)
    setApplyingMessageId(null)
  }, [contextKey])

  useEffect(() => {
    if (open) return
    contextRequestRef.current += 1
    conversationVersionRef.current += 1
    askInFlightRef.current = false
    setSnapshotLoading(false)
    setLoading(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    void loadContext()
  }, [loadContext, open, workspaceKey])

  const handleAsk = useCallback(async (request?: string, intent?: string) => {
    const userRequest = (request ?? input).trim()
    if (!userRequest || askInFlightRef.current) return
    const conversationVersion = conversationVersionRef.current
    askInFlightRef.current = true

    const userMessage: AssistantMessage = {
      id: createMessageId(),
      role: 'user',
      content: userRequest,
      intent,
      createdAt: Date.now(),
    }
    setMessages((current) => [...current, userMessage])
    setInput('')
    setLoading(true)

    try {
      const promptContext = await fetchContext()
        .then((context) => {
          if (conversationVersionRef.current !== conversationVersion) return { snapshot, qualitySignals }
          setSnapshot(context.snapshot)
          setQualitySignals(context.qualitySignals)
          return context
        })
        .catch(() => ({ snapshot, qualitySignals }))
      if (conversationVersionRef.current !== conversationVersion) return
      const prompt = buildAssistantPrompt({
        userRequest,
        workspaceKey,
        workspaceLabel,
        workspaceSummary,
        novel: currentNovel,
        chapter: currentChapter,
        snapshot: promptContext.snapshot,
        qualitySignals: promptContext.qualitySignals,
        history: messages,
        novelId,
      })
      const outputs = await window.electron.ai.runPrompt({
        novelId,
        count: 1,
        modelConfigId: currentNovel?.modelConfigId,
        executionMode,
        messages: [{ role: 'user', content: prompt }],
      })
      if (conversationVersionRef.current !== conversationVersion) return
      const answer = outputs[0]?.trim() || getUserFacingMessage('workspaceChat.replyEmpty')
      let repairPreview: WorkspaceQualityRepairPreview | undefined
      const shouldPatch = shouldPreparePatch(userRequest, intent)
      if (shouldPatch && promptContext.snapshot && qualityKey && canApplyWorkspacePatch) {
        repairPreview = await window.electron.ai.repairWorkspaceQuality({
          ...buildWorkspaceQualityRequestBase(qualityKey, adapterContext),
          workspaceLabel,
          workspaceSummary,
          contentSnapshot: promptContext.snapshot,
          issues: [],
          extraRequirements: userRequest,
        })
        if (conversationVersionRef.current !== conversationVersion) return
      }
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: 'assistant',
          content: repairPreview
            ? `${answer}\n\n已生成 ${repairPreview.fieldPatches.length + repairPreview.entityPatches.length} 项可应用修改。检查后可点击“应用本次修改”。`
            : answer,
          intent,
          createdAt: Date.now(),
          repairPreview,
          baseSnapshot: repairPreview ? promptContext.snapshot || undefined : undefined,
        },
      ])
    } catch (error) {
      if (conversationVersionRef.current !== conversationVersion) return
      console.error(error)
      message.error(error instanceof Error ? error.message : getUserFacingMessage('workspaceChat.replyFailed'))
    } finally {
      if (conversationVersionRef.current === conversationVersion) {
        askInFlightRef.current = false
        setLoading(false)
      }
    }
  }, [
    currentChapter,
    currentNovel,
    executionMode,
    fetchContext,
    input,
    messages,
    novelId,
    adapterContext,
    canApplyWorkspacePatch,
    qualitySignals,
    qualityKey,
    snapshot,
    workspaceKey,
    workspaceLabel,
    workspaceSummary,
  ])

  const handleApplyPreview = useCallback(async (item: AssistantMessage) => {
    if (!item.repairPreview || !item.baseSnapshot) return
    const allPatches = [...item.repairPreview.fieldPatches, ...item.repairPreview.entityPatches]
    if (allPatches.length === 0) {
      message.info('本次没有可应用的字段修改。')
      return
    }
    const nextSnapshot = applyAllPatches(item.baseSnapshot, item.repairPreview.patchedSnapshot, allPatches)
    setApplyingMessageId(item.id)
    try {
      if (activeController) {
        await activeController.applySnapshot(nextSnapshot)
        if (activeController.persistPreview) {
          await activeController.persistPreview(nextSnapshot, item.repairPreview)
        }
      } else if (fallbackAdapter?.applySnapshot) {
        await fallbackAdapter.applySnapshot(item.baseSnapshot, nextSnapshot, adapterContext)
        const refreshedNovel = await window.electron.novel.get(novelId)
        if (refreshedNovel) setCurrentNovel(refreshedNovel)
      }
      setMessages((current) => current.map((messageItem) => (
        messageItem.id === item.id ? { ...messageItem, appliedAt: Date.now() } : messageItem
      )))
      onApplied?.()
      message.success(getUserFacingMessage('workspaceQuality.previewApplied'))
      void loadContext()
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('workspaceQuality.applyFailed'))
    } finally {
      setApplyingMessageId(null)
    }
  }, [
    activeController,
    adapterContext,
    fallbackAdapter,
    loadContext,
    novelId,
    onApplied,
    setCurrentNovel,
  ])

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      message.success(getUserFacingMessage('workspaceChat.replyCopied'))
    } catch {
      message.error(getUserFacingMessage('workspaceChat.copyFailed'))
    }
  }, [])

  const body = (
    <aside
      className={`workspace-chat-assistant${resizable ? ' workspace-chat-assistant--resizable' : ''}`}
      aria-label="AI 聊天助手"
      style={width ? { '--workspace-chat-assistant-width': `${width}px` } as React.CSSProperties : undefined}
    >
      {resizable ? (
        <button
          type="button"
          className="workspace-chat-assistant__resize-handle"
          onPointerDown={onResizeStart}
          aria-label="拖动调整 AI 助手宽度"
          title="拖动调整宽度"
        />
      ) : null}
      <div className="workspace-chat-assistant__header">
        <div className="workspace-chat-assistant__title-block">
          <div className="workspace-chat-assistant__eyebrow">工作区 AI 评审</div>
          <strong>上下文协作</strong>
        </div>
        <Space size={6}>
          <Tooltip title="重新读取当前页面、章节和质量信号">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={snapshotLoading}
              onClick={() => void loadContext(true)}
              aria-label="刷新上下文"
            />
          </Tooltip>
          <Tooltip title="关闭助手">
            <Button size="small" icon={<CloseOutlined />} onClick={onClose} aria-label="关闭 AI 助手" />
          </Tooltip>
        </Space>
      </div>

      <div className="workspace-chat-assistant__context-strip">
        <Tag icon={<RobotOutlined />} color="processing">{workspaceLabel}</Tag>
        <Tag>{currentChapter ? `第 ${currentChapter.chapterNum} 章` : '全书上下文'}</Tag>
        <Tag color={canUseWorkspaceSnapshot ? 'success' : 'default'}>
          {canUseWorkspaceSnapshot ? '已接入页面快照' : '基础上下文'}
        </Tag>
      </div>

      <div className="workspace-chat-assistant__mode-row">
        <span>模式</span>
        <Segmented
          size="small"
          value={executionMode}
          onChange={(value) => setExecutionMode(value as AiExecutionMode)}
          options={[
            { label: '稳审', value: 'review_first' },
            { label: '均衡', value: 'balanced' },
            { label: '深修', value: 'premium' },
          ]}
        />
      </div>

      {qualitySignals.length > 0 ? (
        <div className="workspace-chat-assistant__signal-list">
          {qualitySignals.slice(0, 3).map((item) => (
            <div key={item} className="workspace-chat-assistant__signal-item">{item}</div>
          ))}
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          className="workspace-chat-assistant__empty-alert"
          message="已准备读取当前小说、章节和质量上下文。"
        />
      )}

      <div className="workspace-chat-assistant__intent-grid">
        {ASSISTANT_INTENTS.map((intent) => (
          <Button
            key={intent.id}
            size="small"
            icon={<ThunderboltOutlined />}
            disabled={loading}
            onClick={() => void handleAsk(intent.prompt, intent.id)}
          >
            {intent.label}
          </Button>
        ))}
      </div>

      <div className="workspace-chat-assistant__history">
        {messages.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="输入评审、修复、扩写或去 AI 味目标。"
          >
            {onOpenQuality ? (
              <Button size="small" icon={<BarChartOutlined />} onClick={onOpenQuality}>
                打开质量看板
              </Button>
            ) : null}
          </Empty>
        ) : null}
        {messages.map((item) => (
          <div key={item.id} className={`workspace-chat-assistant__message workspace-chat-assistant__message--${item.role}`}>
            <div className="workspace-chat-assistant__message-head">
              <span>{item.role === 'user' ? '你' : 'AI 助手'}</span>
              {item.role === 'assistant' ? (
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => void handleCopy(item.content)}
                  aria-label="复制助手回复"
                />
              ) : null}
            </div>
            <div className="workspace-chat-assistant__message-body">{item.content}</div>
            {item.role === 'assistant' && item.repairPreview ? (
              <div className="workspace-chat-assistant__patch-card">
                <div className="workspace-chat-assistant__patch-summary">
                  <strong>{item.repairPreview.summary || '当前步骤修改预览'}</strong>
                  <span>{`字段 ${item.repairPreview.fieldPatches.length} 项 · 实体 ${item.repairPreview.entityPatches.length} 项`}</span>
                </div>
                {item.repairPreview.warnings.length > 0 ? (
                  <div className="workspace-chat-assistant__patch-warning">
                    {item.repairPreview.warnings.slice(0, 2).join('；')}
                  </div>
                ) : null}
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  disabled={Boolean(item.appliedAt) || !canApplyWorkspacePatch}
                  loading={applyingMessageId === item.id}
                  onClick={() => void handleApplyPreview(item)}
                >
                  {item.appliedAt ? '已应用' : '应用本次修改'}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {loading ? (
          <div className="workspace-chat-assistant__message workspace-chat-assistant__message--assistant">
            <Spin size="small" />
            <span>正在结合当前上下文进行多角色评审...</span>
          </div>
        ) : null}
      </div>

      <div className="workspace-chat-assistant__composer">
        <Input.TextArea
          value={input}
          rows={4}
          placeholder="例如：帮我把这一步改得更像真人作者；检查是否支撑百万字；给当前章节做去 AI 味修复。"
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              void handleAsk()
            }
          }}
        />
        <div className="workspace-chat-assistant__composer-actions">
          <Button
            icon={<ClearOutlined />}
            disabled={messages.length === 0 || loading}
            onClick={() => setMessages([])}
          >
            清空
          </Button>
          <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void handleAsk()}>
            发送
          </Button>
        </div>
      </div>
    </aside>
  )

  if (compact) {
    return (
      <Drawer
        placement="right"
        width="min(92vw, 420px)"
        open={open}
        onClose={onClose}
        title={null}
        closeIcon={null}
        className="workspace-chat-assistant__drawer"
        destroyOnHidden
      >
        {body}
      </Drawer>
    )
  }

  return open ? body : null
}
