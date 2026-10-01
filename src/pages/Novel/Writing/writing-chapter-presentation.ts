import type { Chapter, ChapterPublishCheck, ContractAuditItem, WritebackSyncStatus } from '../../../types'
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
  chapters: Chapter[]
  publishCheck: ChapterPublishCheck | null
  writebackStatus: WritebackSyncStatus | null
}): WritingGenerationPreflight {
  const previousNum = (input.chapter?.chapterNum || 0) - 1
  const previousChapter = previousNum > 0
    ? input.chapters.find((chapter) => chapter.chapterNum === previousNum)
    : null
  const continuityMessage = previousNum > 0 && !previousChapter?.content?.trim()
    ? previousChapter
      ? `第${previousNum}章尚无正文，请先补上正文草稿再生成第${input.chapter?.chapterNum}章。`
      : `第${previousNum}章尚未创建，请先写出紧邻前章正文再生成第${input.chapter?.chapterNum}章。`
    : ''
  const audit = input.publishCheck && input.publishCheck.chapterId === input.chapter?.id
    ? input.publishCheck.contractAudit
    : null
  const items = audit?.items
  const chapterStatus = items?.find((item) => item.key === 'chapter_contract_status')
  const chapterMissing = items?.find((item) => item.key === 'chapter_contract_exists')
  const chapterGoal = items?.find((item) => item.key === 'chapter_contract_goal')
  const sceneStatusItems = items?.filter((item) => item.key.startsWith('scene_status_')) || []
  const sceneFieldItems = items?.filter((item) => item.key.startsWith('scene_fields_')) || []
  const sceneStatuses = new Set(sceneStatusItems.map((item) => item.key.slice('scene_status_'.length)))
  const sceneFields = new Set(sceneFieldItems.map((item) => item.key.slice('scene_fields_'.length)))
  const sceneAuditComplete = items?.some((item) => item.key === 'scene_contracts_not_applicable')
    || (sceneStatuses.size > 0 && sceneStatuses.size === sceneFields.size
      && [...sceneStatuses].every((key) => sceneFields.has(key)))
  const auditComplete = Boolean(items && (chapterStatus || chapterMissing) && chapterGoal && sceneAuditComplete)
  const generationContractItems: ContractAuditItem[] = [
    ...(chapterMissing ? [chapterMissing] : []),
    ...(chapterStatus ? [chapterStatus] : []),
    ...(chapterGoal ? [chapterGoal] : []),
    ...sceneStatusItems,
    ...sceneFieldItems,
  ]
  const contractMessages = input.chapter
    ? auditComplete
      ? generationContractItems
        .filter((item) => item.status !== 'pass')
        .map((item) => `${item.label}：${item.detail}`)
      : ['当前章节的合同校验尚未完成，请刷新章节后重试。']
    : []
  const writebackMessage = input.writebackStatus?.blockedGeneration || input.writebackStatus?.canonApplied === false
    ? `章后回写仍处于「${getWritebackPhaseLabel(input.writebackStatus.phase)}」，先完成回写确认再继续生成。`
    : ''
  const messages = [
    continuityMessage,
    ...contractMessages,
    writebackMessage,
  ].filter(Boolean)

  return {
    ready: Boolean(input.chapter) && messages.length === 0,
    messages,
  }
}
