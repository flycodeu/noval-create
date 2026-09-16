import type { Chapter, Task } from '../../../types'
import type { NextStep } from '../../../shared/workspace-types'
import { buildTaskRecoveryAction } from '../shared/workspace-navigation'

export function getStudioNextStep(chapters: Chapter[], tasks: Task[], approved: boolean): NextStep {
  const interrupted = [...tasks].filter((task) => ['failed', 'paused', 'blocked'].includes(task.status)
    && !tasks.some((later) => later.id > task.id && later.status === 'success' && later.type === task.type
      && later.relatedEntityId === task.relatedEntityId && later.relatedEntityType === task.relatedEntityType
      && later.inputJson === task.inputJson))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0]
  if (interrupted) {
    const recovery = buildTaskRecoveryAction(interrupted)
    return { title: `处理未完成任务 #${interrupted.id}`, reason: interrupted.errorMessage || recovery?.description || '查看失败原因与已保留的结果，再决定重试或继续。',
      targetPage: recovery?.path || '/tasks', priority: 'high', actionLabel: recovery?.path ? recovery.label : '查看未完成任务' }
  }
  const latest = getRecentStudioChapter(chapters)
  if (latest?.content?.trim()) return {
    title: `继续第 ${latest.chapterNum} 章`, reason: '从最近保存的正文与审校结果继续，确认当前场景后再推进。',
    targetPage: `writing/editor?chapterId=${latest.id}`, priority: 'medium', actionLabel: '继续正文',
  }
  if (approved) return { title: '写下第一个场景', reason: '作品声音已有认可样稿。进入正文，确认人物和事件所需事实。', targetPage: 'writing/editor', priority: 'medium', actionLabel: '开始正文' }
  return { title: '先试写一个场景', reason: '写清人物、眼前事件和已知事实即可试写；无需先填完地图、成长体系或全卷大纲。',
    targetPage: 'style-lab?view=ab', priority: 'medium', actionLabel: '试写作品声音', estimatedMinutes: 5 }
}

export function getRecentStudioChapter(chapters: Chapter[]) {
  return [...chapters].filter((chapter) => chapter.content?.trim())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.chapterNum - a.chapterNum)[0]
}

export function getStudioSceneLabel(chapter?: Chapter): string {
  if (!chapter) return '尚无正文场景'
  try {
    const scenes: unknown = JSON.parse(chapter.scenePlanJson || '[]')
    if (Array.isArray(scenes)) {
      const scene = scenes.at(-1)
      if (typeof scene?.scene_title === 'string') return `第 ${chapter.chapterNum} 章 · ${scene.scene_title}`
    }
  } catch { /* Existing malformed plans must not block navigation. */ }
  return `第 ${chapter.chapterNum} 章 · ${chapter.title || '未命名场景'}`
}
