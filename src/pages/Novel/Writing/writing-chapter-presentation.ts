import type {
  Chapter,
  ChapterContractAudit,
  ChapterPublishCheck,
  ConsistencyIssue,
  WritebackSyncStatus,
} from '../../../types'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'
import { formatFailure } from '../../../shared/task-labels'
import { formatChapterNumber, getStatusLabel } from './chapter-labels'
import type { AiCheckPayload, ReviewNotes, WritingPipelineSnapshot } from './parsers'

export interface ChapterHeaderViewModel {
  selected: boolean
  title: string
  description: string
  statusLabel: string
  statusColor: 'success' | 'blue'
  metadata: Array<{ label: string; value: string }>
  writabilityTitle: string
  writability: ChapterWritabilitySummary
}

export interface EditorHeaderViewModel {
  statusLabel: string
  title: string
  subtitle: string
  primaryStatusText: string
}

export interface WritingGenerationPreflight {
  ready: boolean
  messages: string[]
}

export interface WritingMetadataViewModel {
  pipeline: Array<{ label: string; value: string }>
  acceptance: Array<{ label: string; value: string }>
  qualityIssues: string[]
}

export function getWritebackPhaseLabel(phase?: WritebackSyncStatus['phase']): string {
  if (phase === 'preparing') return '准备回写'
  if (phase === 'ready') return '候选已生成·待正典确认'
  if (phase === 'applying') return '正在应用'
  if (phase === 'applied') return '已应用'
  if (phase === 'failed') return '回写失败'
  return '空闲'
}

export function buildChapterHeaderViewModel(input: {
  chapter: Chapter | null
  volumeName: string
  wordCount: number
  versionCount: number
  writability: ChapterWritabilitySummary
}): ChapterHeaderViewModel {
  const statusLabel = input.chapter ? getStatusLabel(input.chapter.status) : '未选择章节'
  const chapterLabel = input.chapter ? formatChapterNumber(input.chapter.chapterNum) : '未选择'

  return {
    selected: Boolean(input.chapter),
    title: input.chapter
      ? `${chapterLabel} · ${input.chapter.title || '未命名章节'}`
      : '请选择一个章节',
    description: input.chapter
      ? `当前卷：${input.volumeName} · 状态：${statusLabel} · ${input.wordCount} 字`
      : '先从左侧章节列表选择当前要生产的一章。',
    statusLabel,
    statusColor: input.chapter?.status === 'final' ? 'success' : 'blue',
    metadata: [
      { label: '当前卷', value: input.volumeName },
      { label: '当前章', value: chapterLabel },
      { label: '版本状态', value: input.versionCount > 0 ? `${input.versionCount} 个版本` : '暂无历史版本' },
      { label: '可写性评分', value: `${input.writability.score}% · ${input.writability.label}` },
    ],
    writabilityTitle: `第 ${input.chapter?.chapterNum || '-'} 章可写性：${input.writability.label}`,
    writability: input.writability,
  }
}

export function buildEditorHeaderViewModel(input: {
  chapter: Chapter | null
  generating: boolean
  refreshing: boolean
  hasMultiSegments: boolean
}): EditorHeaderViewModel {
  const statusLabel = input.chapter ? getStatusLabel(input.chapter.status) : '未选择章节'
  const title = input.chapter
    ? input.chapter.title || `第${input.chapter.chapterNum}章`
    : '请选择一个章节'
  const defaultSubtitle = input.chapter
    ? `当前状态：${statusLabel} · 当前正文视为入库稿，停止输入后会自动保存。`
    : '从左侧选择章节后即可直接编辑，右侧同步查看本章链路、修订建议与体检结果。'
  const subtitle = input.hasMultiSegments
    ? `当前状态：${statusLabel} · 本章已拆成 ${input.chapter?.segmentCount || 0} 个场景，请优先在结构页维护场景后再编译整章。`
    : defaultSubtitle
  const primaryStatusText = input.generating
    ? `AI 正在生成第 ${input.chapter?.chapterNum || '-'} 章`
    : input.refreshing
      ? '正在同步写作数据'
      : input.chapter
        ? `自动保存开启 · ${statusLabel}`
        : '请选择章节开始写作'

  return { statusLabel, title, subtitle, primaryStatusText }
}

export function buildGenerationPreflight(input: {
  chapter: Chapter | null
  writability: ChapterWritabilitySummary
  writebackStatus: WritebackSyncStatus | null
}): WritingGenerationPreflight {
  const writebackMessage = input.writebackStatus?.blockedGeneration || input.writebackStatus?.canonApplied === false
    ? `章后回写仍处于「${getWritebackPhaseLabel(input.writebackStatus.phase)}」，先完成回写确认再继续生成。`
    : ''
  const messages = [
    !input.writability.ready ? input.writability.summary : '',
    ...input.writability.risks,
    writebackMessage,
  ].filter(Boolean)

  return {
    ready: Boolean(input.chapter) && messages.length === 0,
    messages,
  }
}

function formatPipelineMetaValue(value: string, maxLength = 72): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 18)}…${value.slice(-16)}`
}

export function buildPipelineMetadata(input: {
  snapshot: WritingPipelineSnapshot | null
  writebackStatus: WritebackSyncStatus | null
  activePromptOverrideKeys: string[]
}): WritingMetadataViewModel['pipeline'] {
  const { snapshot, writebackStatus } = input
  return [
    { label: '当前任务 ID', value: snapshot?.workflowTaskId ? `#${snapshot.workflowTaskId}` : '未运行' },
    { label: '合同版本', value: formatPipelineMetaValue(snapshot?.contractVersion || '未记录') },
    { label: '生成用量', value: snapshot?.totalTokensUsed ? `${snapshot.totalTokensUsed}` : '0' },
    { label: '耗时', value: snapshot?.totalDurationMs ? `${(snapshot.totalDurationMs / 1000).toFixed(1)}s` : '-' },
    { label: '失败原因', value: snapshot?.failureCode ? formatFailure(snapshot.failureCode).title : '当前无失败' },
    {
      label: '回写状态',
      value: writebackStatus
        ? `${getWritebackPhaseLabel(writebackStatus.phase)}${writebackStatus.blockedGeneration ? ' · 后续生成已暂停' : ''}`
        : '未记录',
    },
    {
      label: '下一章就绪',
      value: writebackStatus
        ? writebackStatus.canonApplied && writebackStatus.readyForNextChapter
          ? '正典已应用 · 下一章已就绪'
          : writebackStatus.candidateReady
            ? '候选已生成 · 等待正典应用'
            : '等待回写候选'
        : '未记录',
    },
    { label: 'Prompt Override', value: input.activePromptOverrideKeys.length > 0 ? input.activePromptOverrideKeys.join('、') : '当前未启用' },
    {
      label: '恢复提示',
      value: writebackStatus?.readyForNextChapter === false
        ? `等待章后回写完成${writebackStatus.lastError ? `：${writebackStatus.lastError}` : '。'}`
        : snapshot?.status === 'failed'
          ? '先检查合同、上下文召回与审校提示，再重试流水线。'
          : '当前无需恢复操作。',
    },
  ]
}

export function buildAcceptanceCards(input: {
  contractAudit: ChapterContractAudit | null
  publishCheck: ChapterPublishCheck | null
  aiResult: AiCheckPayload | null
  reviewNotes: ReviewNotes | null
}): WritingMetadataViewModel['acceptance'] {
  return [
    { label: '合同对账', value: input.contractAudit?.summary || '待检查' },
    { label: '连续性检查', value: input.publishCheck ? `${input.publishCheck.scoreBreakdown.continuityScore} 分` : '待检查' },
    { label: 'AI 味检查', value: input.aiResult ? `${input.aiResult.score} 分` : '待检查' },
    { label: '节奏检查', value: input.reviewNotes?.pace_marker || '待检查' },
    { label: '人物一致性', value: input.publishCheck ? `${input.publishCheck.scoreBreakdown.storyDynamicsScore} 分` : '待检查' },
    { label: '世界规则一致性', value: input.publishCheck ? `${input.publishCheck.scoreBreakdown.coherenceScore} 分` : '待检查' },
    { label: '章节功能达成', value: input.publishCheck?.contractValidation?.summary || '待检查' },
  ]
}

export function buildQualityIssueItems(input: {
  publishCheck: ChapterPublishCheck | null
  chapterIssues: ConsistencyIssue[]
  aiResult: AiCheckPayload | null
}): string[] {
  return [
    ...(input.publishCheck?.checklist || [])
      .filter((item) => item.status === 'rewrite' || item.status === 'blocker' || item.status === 'warning')
      .slice(0, 6)
      .map((item) => `${item.label}：${item.detail}`),
    ...input.chapterIssues.slice(0, 4).map((issue) => `${issue.title}：${issue.description || issue.suggestion || '需要修订'}`),
    ...(input.aiResult?.issues || []).slice(0, 4).map((issue) => `${issue.type}：${issue.suggestion}`),
  ]
}
