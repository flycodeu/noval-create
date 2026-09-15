import type { ChapterContextPreview } from '../../../types'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'

export interface GenerationHandoffItem {
  key: string
  label: string
  ready: boolean
  detail: string
}

export interface GenerationHandoffViewModel {
  status: 'ready' | 'attention' | 'blocked'
  label: string
  readyCount: number
  totalCount: number
  items: GenerationHandoffItem[]
  styleSource: string
  styleReady: boolean
  summary: string
}

function formatContextPreviewError(error?: string | null): string {
  const normalized = error?.trim() || ''
  if (!normalized) return ''
  if (normalized.includes('NF_CONTEXT_REQUIRED_OVERFLOW')) {
    return '关键上下文超出模型预算。请缩小本章范围、减少必须承接项，或拆分章节后再生成。'
  }
  return '上下文预览未完成。请到上下文视图查看原因并重试。'
}

export function buildGenerationHandoffViewModel(input: {
  hasChapter: boolean
  writability: ChapterWritabilitySummary
  contextPreview: ChapterContextPreview | null
  contextPreviewError?: string | null
}): GenerationHandoffViewModel {
  const preview = input.contextPreview
  const contextPreviewError = formatContextPreviewError(input.contextPreviewError)
  const baseItems = input.writability.checks.map((check) => ({
    key: check.key,
    label: check.label,
    ready: check.ready,
    detail: check.detail,
  }))
  const continuityItems: GenerationHandoffItem[] = [
    {
      key: 'previous-chapter',
      label: '上一章承接',
      ready: Boolean(preview && (preview.chapterNum === 1 || preview.previousChapterContext.trim())),
      detail: preview?.chapterNum === 1
        ? '首章不需要上一章承接。'
        : preview?.previousChapterContext.trim()
          ? preview.previousChapterSampleReport?.sources
            ? preview.previousChapterSampleReport.fullyInjected
              ? '已加载上一章完整原文；发送前会再次核对预算。'
              : '已加载视角允许的相关原文；省略内容可在上下文视图查看。'
            : '已加载上一章关键先验。'
          : '尚未加载上一章关键先验。',
    },
    {
      key: 'chapter-bridge',
      label: '章节衔接桥',
      ready: Boolean(preview?.chapterBridgePlan?.trim()),
      detail: preview?.chapterBridgePlan?.trim()
        ? preview.chapterBridgePlan.trim().slice(0, 120)
        : '尚未形成时间、地点、情绪或视角交接。',
    },
    {
      key: 'context-preview',
      label: '模型上下文',
      ready: Boolean(preview && !input.contextPreviewError),
      detail: contextPreviewError || preview?.contextAssemblyReport?.summary || '上下文预览尚未完成。',
    },
  ]
  const items = [...baseItems, ...continuityItems]
  const readyCount = items.filter((item) => item.ready).length
  const styleReady = Boolean(preview?.authorStyleLock?.enabled)
  const styleSource = styleReady
    ? preview?.authorStyleLock?.sourceLabel || '作者风格锁'
    : '未设置作者样章；有已接受正文时沿用本书表达'
  const status = !input.hasChapter || !input.writability.ready
    ? 'blocked'
    : readyCount < items.length || !styleReady
      ? 'attention'
      : 'ready'

  return {
    status,
    label: status === 'ready' ? '已交接' : status === 'attention' ? '有提醒' : '未就绪',
    readyCount,
    totalCount: items.length,
    items,
    styleSource,
    styleReady,
    summary: !input.hasChapter
      ? '先选择章节，再核对首稿输入。'
      : status === 'blocked'
        ? '关键输入未齐，生成按钮会保持不可用。'
        : styleReady
          ? '首稿会按正典、场景任务、人物边界和作者风格的顺序执行。'
          : '事实与场景输入已可用；补作者样章可提高声音稳定性，但不是生成硬门槛。',
  }
}
