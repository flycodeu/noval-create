import type { AuthorWorkflowModeSummary, AuthorWorkflowRouteKey } from './author-workflow'
import type { WorkflowStats } from './workflow'
import type { ProductionReadinessSummary } from '../../types'

export interface OverviewDisplayState {
  isZeroState: boolean
  hasCriticalBlockers: boolean
  showProgressPanel: boolean
  showHealthPanel: boolean
  showBlockersPanel: boolean
  showImpactPanel: boolean
  showRevisionMetric: boolean
}

export interface OverviewQuickAction {
  id: string
  title: string
  description: string
  entryPage: AuthorWorkflowRouteKey
  actionLabel: string
}

export interface OverviewProductionReadinessPresentation {
  readyRate: number
  summary: string
  blockedByContext: boolean
}

export const OVERVIEW_ZERO_STATE_ACTIONS: OverviewQuickAction[] = [
  {
    id: 'zero-volume',
    title: '创建第一卷',
    description: '先把第一卷的目标、闭环和卷末爆点钉住，正文才有明确承接。',
    entryPage: 'volume-design',
    actionLabel: '打开卷级设计',
  },
  {
    id: 'zero-outline',
    title: '生成前三章骨架',
    description: '先搭出前三章的推进顺序和钩子，比继续堆抽象设定更接近开写。',
    entryPage: 'outline',
    actionLabel: '打开故事大纲',
  },
  {
    id: 'zero-characters',
    title: '创建主角与反派',
    description: '首章冲突要先有推动者和阻力位，避免正文只剩主角独走。',
    entryPage: 'characters',
    actionLabel: '打开角色系统',
  },
  {
    id: 'zero-contracts',
    title: '生成第一章场景合同',
    description: '在开写前先压稳章节目标、场景兑现点和禁越界约束。',
    entryPage: 'contracts',
    actionLabel: '打开章节合同',
  },
  {
    id: 'zero-writing',
    title: '开始第一章草稿',
    description: '当底盘达到最低可写门槛时，尽快进入正文比继续浏览页面更值钱。',
    entryPage: 'writing',
    actionLabel: '进入正文写作',
  },
]

export function resolveOverviewDisplayState(
  stats: Pick<WorkflowStats, 'chapterCount' | 'totalWords'>,
  authorWorkflow: Pick<AuthorWorkflowModeSummary, 'blockers' | 'impactNotices'>,
): OverviewDisplayState {
  const isZeroState = stats.chapterCount <= 0 && stats.totalWords <= 0
  const hasCriticalBlockers = authorWorkflow.blockers.some((blocker) => blocker.severity === 'high')

  return {
    isZeroState,
    hasCriticalBlockers,
    showProgressPanel: !isZeroState,
    showHealthPanel: !isZeroState,
    showBlockersPanel: !isZeroState
      ? authorWorkflow.blockers.length > 0
      : hasCriticalBlockers,
    showImpactPanel: !isZeroState && authorWorkflow.impactNotices.length > 0,
    showRevisionMetric: !isZeroState,
  }
}

export function resolveOverviewProductionReadiness(
  readiness: Pick<ProductionReadinessSummary, 'readyRate' | 'summary'>,
  stats: Pick<WorkflowStats, 'staleChapterCount' | 'staleAssetCount' | 'staleCheckpointCount'>,
): OverviewProductionReadinessPresentation {
  const staleChapterCount = Math.max(0, stats.staleChapterCount || 0)
  const staleAssetCount = Math.max(0, stats.staleAssetCount || 0)
  const staleCheckpointCount = Math.max(0, stats.staleCheckpointCount || 0)
  const blockedByContext = staleChapterCount > 0 || staleAssetCount > 0 || staleCheckpointCount > 0

  if (!blockedByContext) {
    return {
      readyRate: readiness.readyRate,
      summary: readiness.summary,
      blockedByContext: false,
    }
  }

  const contextPenalty = staleChapterCount * 12 + staleAssetCount * 10 + staleCheckpointCount * 8
  const contextReasons = [
    staleChapterCount > 0 ? `${staleChapterCount} 章引用旧上下文` : '',
    staleAssetCount > 0 ? `${staleAssetCount} 类资产待校准` : '',
    staleCheckpointCount > 0 ? `${staleCheckpointCount} 份检查点待刷新` : '',
  ].filter(Boolean)

  return {
    readyRate: Math.max(0, Math.min(readiness.readyRate, 100 - contextPenalty)),
    summary: `上下文尚未同步：${contextReasons.join('，')}；处理完成前不宜继续扩批。`,
    blockedByContext: true,
  }
}
