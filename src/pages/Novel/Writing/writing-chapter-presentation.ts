import type { Chapter, WritebackSyncStatus } from '../../../types'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'
import { getStatusLabel } from './chapter-labels'

export interface EditorHeaderViewModel {
  statusLabel: string
  title: string
}

export interface WritingGenerationPreflight {
  ready: boolean
  messages: string[]
}

export function getWritebackPhaseLabel(phase?: WritebackSyncStatus['phase']): string {
  if (phase === 'preparing') return '准备回写'
  if (phase === 'ready') return '候选已生成·待正典确认'
  if (phase === 'applying') return '正在应用'
  if (phase === 'applied') return '已应用'
  if (phase === 'failed') return '回写失败'
  return '空闲'
}

export function buildEditorHeaderViewModel(input: { chapter: Chapter | null }): EditorHeaderViewModel {
  const statusLabel = input.chapter ? getStatusLabel(input.chapter.status) : '未选择章节'
  const title = input.chapter
    ? input.chapter.title || '未命名章节'
    : '请选择一个章节'

  return { statusLabel, title }
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
    ...(input.writability.ready ? [] : input.writability.risks),
    writebackMessage,
  ].filter(Boolean)

  return {
    ready: Boolean(input.chapter) && messages.length === 0,
    messages,
  }
}
