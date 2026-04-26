export type ModuleStatus =
  | 'not_started'
  | 'draft'
  | 'ready'
  | 'warning'
  | 'blocked'
  | 'done'

export const MODULE_STATUS_CONFIG: Record<ModuleStatus, { label: string; color: string; dotColor: string }> = {
  not_started: { label: '未开始', color: '#9CA3AF', dotColor: '#9CA3AF' },
  draft: { label: '草稿', color: '#2563EB', dotColor: '#2563EB' },
  ready: { label: '已就绪', color: '#2F855A', dotColor: '#2F855A' },
  warning: { label: '待确认', color: '#B7791F', dotColor: '#B7791F' },
  blocked: { label: '阻塞', color: '#C2410C', dotColor: '#C2410C' },
  done: { label: '已完成', color: '#276749', dotColor: '#276749' },
}

export interface ProjectBlocker {
  id: string
  level: 'fatal' | 'high' | 'medium' | 'low'
  title: string
  reason: string
  affectedModules: string[]
  suggestedAction: {
    label: string
    targetPage: string
    actionType: 'open_page' | 'auto_fix' | 'generate_draft'
  }
  canIgnoreOnce: boolean
  createdAt: string
}

export interface NextStep {
  title: string
  reason: string
  targetPage: string
  priority: 'high' | 'medium' | 'low'
  estimatedMinutes?: number
  actionLabel: string
}

export interface ModuleProgress {
  moduleKey: string
  requiredTotal: number
  requiredDone: number
  optionalTotal: number
  optionalDone: number
  status: ModuleStatus
  blockers: ProjectBlocker[]
}

export interface WorkspaceNavGroup {
  key: string
  title: string
  route?: string
  progress?: { done: number; total: number }
  items: WorkspaceNavItem[]
}

export interface WorkspaceNavItem {
  key: string
  label: string
  route: string
  status: ModuleStatus
  progress?: { done: number; total: number }
  meta?: string
  hasBlocker?: boolean
}

export const BLOCKER_LEVEL_CONFIG: Record<ProjectBlocker['level'], { label: string; color: string }> = {
  fatal: { label: '致命', color: '#991B1B' },
  high: { label: '高', color: '#C2410C' },
  medium: { label: '中', color: '#B7791F' },
  low: { label: '低', color: '#6B7280' },
}

export function getModuleStatus(progress: ModuleProgress): ModuleStatus {
  if (progress.status && progress.status !== 'not_started') {
    if (progress.blockers.length > 0 && progress.status !== 'blocked') return 'blocked'
    return progress.status
  }
  if (progress.blockers.length > 0) return 'blocked'
  if (progress.requiredDone >= progress.requiredTotal && progress.requiredTotal > 0) {
    return progress.optionalDone >= progress.optionalTotal ? 'done' : 'ready'
  }
  if (progress.requiredDone > 0) return 'draft'
  return 'not_started'
}

export function formatProgress(progress: ModuleProgress): string {
  if (progress.optionalTotal > 0) {
    return `必填 ${progress.requiredDone}/${progress.requiredTotal}，扩展 ${progress.optionalDone}/${progress.optionalTotal}`
  }
  return `必填 ${progress.requiredDone}/${progress.requiredTotal}`
}

export function formatProgressShort(progress: ModuleProgress): string {
  return `${progress.requiredDone}/${progress.requiredTotal}`
}
