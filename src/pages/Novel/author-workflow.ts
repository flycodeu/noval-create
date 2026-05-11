import type { Novel, QualityDashboardData } from '../../types'
import { resolveOperatingMode } from '../../shared/operating-mode'
import {
  getAssetBloatSignal,
  getRecommendedGuidedWorkflowStep,
  isBasicsReady,
  isCharacterRosterReady,
  isProjectBriefReady,
  isStoryCoreReady,
  isStoryPlotReady,
  isThemeVoiceReady,
  isWorldFoundationReady,
  type WorkflowStats,
} from './workflow'

export type AuthorWorkMode =
  | 'quick_start'
  | 'asset_building'
  | 'daily_push'
  | 'revision_closure'

export type AuthorWorkflowRouteKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'world-rules'
  | 'endgame'
  | 'map'
  | 'items'
  | 'characters'
  | 'threads'
  | 'story-design'
  | 'outline'
  | 'volume-design'
  | 'timeline'
  | 'writing'
  | 'contracts'
  | 'writeback'
  | 'revision'
  | 'quality'
  | 'task-center'

export interface AuthorWorkflowTask {
  id: string
  title: string
  reason: string
  estimatedMinutes: number
  unlocks: string[]
  entryPage: AuthorWorkflowRouteKey
  actionLabel: string
}

export interface AuthorWorkflowBlocker {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  reason: string
  entryPage: AuthorWorkflowRouteKey
  actionLabel: string
}

export interface AuthorImpactNotice {
  id: string
  title: string
  reason: string
  affectedKinds: string[]
  entryPage: AuthorWorkflowRouteKey
}

export interface AuthorWorkflowModeSummary {
  mode: AuthorWorkMode
  modeReason: string
  primaryTask: AuthorWorkflowTask
  alternateTasks: AuthorWorkflowTask[]
  blockers: AuthorWorkflowBlocker[]
  impactNotices: AuthorImpactNotice[]
  recommendedEntryPage: AuthorWorkflowRouteKey
}

export type AuthorWorkflowQualitySummary = Pick<
  QualityDashboardData,
  'productionReadiness' | 'batchHealth' | 'continuityHealth'
> | null

const MODE_LABELS: Record<AuthorWorkMode, string> = {
  quick_start: '快速启动',
  asset_building: '资产建设',
  daily_push: '日更推进',
  revision_closure: '修订收口',
}

export function getAuthorWorkModeLabel(mode: AuthorWorkMode): string {
  return MODE_LABELS[mode]
}

function createTask(
  id: string,
  title: string,
  reason: string,
  entryPage: AuthorWorkflowRouteKey,
  estimatedMinutes: number,
  unlocks: string[],
  actionLabel: string,
): AuthorWorkflowTask {
  return { id, title, reason, entryPage, estimatedMinutes, unlocks, actionLabel }
}

function createBlocker(
  id: string,
  severity: AuthorWorkflowBlocker['severity'],
  title: string,
  reason: string,
  entryPage: AuthorWorkflowRouteKey,
  actionLabel: string,
): AuthorWorkflowBlocker {
  return { id, severity, title, reason, entryPage, actionLabel }
}

function countAssetGaps(novel: Pick<Novel, 'settingsJson' | 'worldRulesJson'> | null | undefined, stats: WorkflowStats) {
  return [
    !isWorldFoundationReady(novel),
    stats.mapCount <= 0,
    stats.itemCount <= 0,
    !isCharacterRosterReady(stats),
    stats.threadCount <= 0,
    !isStoryPlotReady(novel),
    stats.outlineCount <= 0,
    stats.timelineCount <= 0,
    stats.volumeCount <= 0,
  ].filter(Boolean).length
}

function resolveAssetCompressionTask(stats: WorkflowStats): AuthorWorkflowTask {
  if (stats.volumeCount <= 0) {
    return createTask('asset-compress-volume', '先把资产压到第一卷', '首章前资产已经开始堆积，优先把现有资产收束成第一卷目标与闭环。', 'volume-design', 12, ['大纲', '章节合同'], '打开卷级设计')
  }
  if (stats.outlineCount <= 0) {
    return createTask('asset-compress-outline', '先把资产落成大纲', '继续补资产的收益已经低于把现有信息落成前三章与卷级承接。', 'outline', 12, ['时间轴', '正文'], '打开故事大纲')
  }
  if (stats.timelineCount <= 0) {
    return createTask('asset-compress-timeline', '先把关键事件钉进时间轴', '已有资产需要先形成先后顺序，再继续扩展才不会放大返工。', 'timeline', 10, ['正文承接', '回写闭环'], '打开时间轴')
  }
  if (stats.threadCount <= 0) {
    return createTask('asset-compress-threads', '先把资产挂到主线线程', '当前缺的不是更多资产，而是把已有设定挂回主线推进。', 'threads', 8, ['大纲', '正文'], '打开故事线程')
  }
  return createTask('asset-compress-writing', '停止补资产，直接进入正文', '现有资产已经足够支撑起稿，继续堆数量只会提高维护成本。', 'writing', 15, ['正文起稿', '章后回写'], '进入正文写作')
}

function resolveQuickStartPrimaryTask(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'projectBriefJson' | 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson' | 'launchMode' | 'operatingMode'> | null | undefined,
  stats: WorkflowStats,
): AuthorWorkflowTask {
  const assetBloat = getAssetBloatSignal(stats)
  if (assetBloat.risk !== 'none') {
    return resolveAssetCompressionTask(stats)
  }

  switch (getRecommendedGuidedWorkflowStep(novel, stats)) {
    case 'basics':
      return createTask('basics', '补齐基础信息', '先把书名、简介、背景和目标字数钉住，后面的推荐才有可靠上下文。', 'overview', 5, ['项目立项', '世界规则', '首章启动'], '打开基础信息')
    case 'project-brief':
      return createTask('project-brief', '锁定项目立项', '先明确读者承诺、卖点和禁区，避免后续所有资产都往不同方向长。', 'project-brief', 8, ['基础设定', '主题与文风'], '打开项目立项')
    case 'story-core':
      return createTask('story-core', '锁定基础设定', '主角起点、核心钩子和底层约束还没钉住，现在补这一步最能降低后续发散。', 'core-settings', 8, ['世界规则', '角色生成'], '打开基础设定')
    case 'theme-voice':
      return createTask('theme-voice', '锁定主题与文风', '先把主题、情绪核心、视角和对白边界压稳，正文和资产才不会越写越散。', 'theme-voice', 8, ['正文口径', '审校基线'], '打开主题与文风')
    case 'world-foundation':
      return createTask('world-foundation', '同步世界规则', '当前题材规则、时间制度和世界边界还未统一，后续生成会失去底层口径。', 'world-rules', 6, ['地图结构', '物品与角色生成'], '打开世界规则')
    case 'endgame-design':
      return createTask('endgame-design', '补齐终局设计', '终局还没锁住，越早确定最后一幕和兑现承诺，越不容易中后段失焦。', 'endgame', 10, ['卷级设计', '故事设计'], '打开终局设计')
    case 'map-structure':
      return createTask('map-structure', '生成地图骨架', '地点层级和活动半径还没落地，后续人物、物品和事件没有可靠发生位置。', 'map', 8, ['物品生成', '角色落点'], '打开地图结构')
    case 'items-equipment':
      return createTask('items-equipment', '生成首批物品', '先把资源流通链和关键道具铺出来，后面的角色和冲突才有具体抓手。', 'items', 8, ['角色生成', '事件冲突'], '打开物品装备')
    case 'character-roster':
      return createTask('character-roster', '生成人物网络', '当前缺少主角之外的关键人物关系，正文会很快只剩主角独走。', 'characters', 10, ['故事线程', '冲突关系'], '打开角色系统')
    case 'story-threads':
      return createTask('story-threads', '生成故事线程', '主线、支线和伏笔还没挂成可追踪线程，结构和正文都缺统一锚点。', 'threads', 8, ['故事设计', '伏笔回收'], '打开故事线程')
    case 'story-plot':
      return createTask('story-plot', '生成故事设计', '现在最缺的是主线目标、核心冲突和结局方向的统一骨架。', 'story-design', 10, ['大纲', '卷级设计'], '打开故事设计')
    case 'volume-planning':
      return createTask('volume-planning', '补第一卷设计', '卷级目标和闭环尚未成型，先补第一卷结构比继续堆资产更值钱。', 'volume-design', 12, ['结构规划', '章节合同'], '打开卷级设计')
    case 'write-start':
    default:
      return createTask('write-start', '创建并开始第一章', '当前底盘已经具备可写条件，最有价值的下一步是尽快进入首章而不是继续补页面。', 'writing', 15, ['正文草稿', '日更推进'], '进入正文写作')
  }
}

function resolveAssetPrimaryTask(
  novel: Pick<Novel, 'settingsJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): AuthorWorkflowTask {
  const assetBloat = getAssetBloatSignal(stats)
  if (!isWorldFoundationReady(novel)) {
    return createTask('asset-world-rules', '补世界规则底盘', '资产建设前先统一题材规则和时间制度，避免后面资产口径冲突。', 'world-rules', 6, ['地图', '人物', '物品'], '打开世界规则')
  }
  if (assetBloat.risk !== 'none') {
    return resolveAssetCompressionTask(stats)
  }
  if (stats.mapCount <= 0) {
    return createTask('asset-map', '补地图骨架', '地点层级是后续角色、事件和势力关系的共同落点。', 'map', 8, ['物品落点', '事件场景'], '打开地图结构')
  }
  if (stats.itemCount <= 0) {
    return createTask('asset-items', '补关键物品与资源', '当前资源流通链还是空的，先补物品比继续抽象设定更能服务正文。', 'items', 8, ['冲突抓手', '剧情证据'], '打开物品装备')
  }
  if (!isCharacterRosterReady(stats)) {
    return createTask('asset-characters', '补关键角色网络', '人物生态还没形成稳定关系网，现在继续结构设计会缺少行为主体。', 'characters', 10, ['主线推动者', '阻力位'], '打开角色系统')
  }
  if (stats.threadCount <= 0) {
    return createTask('asset-threads', '补主线与支线线程', '没有线程层，后面的卷级设计和正文很难形成长期承接。', 'threads', 8, ['卷级推进', '伏笔回收'], '打开故事线程')
  }
  if (!isStoryPlotReady(novel)) {
    return createTask('asset-story-design', '补故事设计骨架', '资产已有基础，但主线目标和结局方向还没被统一设计。', 'story-design', 10, ['大纲', '卷级设计'], '打开故事设计')
  }
  if (stats.volumeCount <= 0) {
    return createTask('asset-volume', '补第一卷设计', '现在最缺的是卷级闭环，不是继续新增孤立资产。', 'volume-design', 12, ['结构规划', '章节合同'], '打开卷级设计')
  }
  if (stats.outlineCount <= 0) {
    return createTask('asset-outline', '补故事大纲', '资产基础已经够用，下一步该让它们真正落到结构推进上。', 'outline', 12, ['时间轴', '正文'], '打开故事大纲')
  }
  if (stats.timelineCount <= 0) {
    return createTask('asset-timeline', '补关键时间轴', '事件顺序还没钉实，继续扩资产只会加重后续对齐成本。', 'timeline', 10, ['正文承接', '状态回写'], '打开时间轴')
  }
  return createTask('asset-writing', '把资产落到第一章', '当前资产已经超过最小开写门槛，继续补资产的边际价值低于进入正文。', 'writing', 15, ['正文起稿', '回写闭环'], '进入正文写作')
}

function resolveDailyPrimaryTask(
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
): AuthorWorkflowTask {
  if (qualitySummary?.batchHealth.status === 'paused' && qualitySummary.batchHealth.canContinue) {
    return createTask('daily-resume-batch', '恢复暂停的后台批次', '当前已有暂停的批量流程，先恢复它比重新发起新动作更直接。', 'task-center', 5, ['继续批次推进', '查看失败详情'], '打开后台任务中心')
  }
  return createTask('daily-writing', '推进当前正文', '项目已经进入正文阶段，当前最值钱的下一步是继续章节推进而不是回到页面式补充。', 'writing', 20, ['章节产出', '章后回写'], '进入正文写作')
}

function resolveRevisionPrimaryTask(
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
): AuthorWorkflowTask {
  if ((qualitySummary?.productionReadiness.writebackFailedCount || 0) > 0 || (qualitySummary?.productionReadiness.writebackPendingCount || 0) > 0) {
    return createTask('revision-writeback', '清理章后回写积压', '当前章后回写未闭环，继续推进正文会持续放大状态漂移。', 'writeback', 10, ['状态同步', '连续性恢复'], '打开章后回写')
  }
  if (stats.revisionBlockerCount > 0) {
    return createTask('revision-blockers', '处理高优先修订问题', '系统已经给出高优先级 blocker，先清掉它们比继续推进正文更稳。', 'revision', 15, ['继续写作', '恢复批次'], '打开修订中心')
  }
  return createTask('revision-quality', '回查质量风险', '当前更适合统一看生产灯、连续性和风险趋势，再决定修订顺序。', 'quality', 12, ['修订顺序', '继续推进判断'], '打开质量监控')
}

function buildAlternateTasks(
  mode: AuthorWorkMode,
  novel: Pick<Novel, 'settingsJson' | 'worldRulesJson' | 'projectBriefJson' | 'themeVoiceJson' | 'title' | 'synopsis' | 'userBackground' | 'expandedBackground'> | null | undefined,
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
  primaryTaskId: string,
): AuthorWorkflowTask[] {
  const candidates: AuthorWorkflowTask[] = []

  if (mode === 'quick_start') {
    candidates.push(
      createTask('quick-story-design', '补故事设计骨架', '如果你已经有足够底盘，也可以直接先把主线目标和结局方向压出来。', 'story-design', 10, ['大纲', '卷级设计'], '打开故事设计'),
      createTask('quick-writing-contract', '补第一章写作合同', '在开写前先补章节合同，能显著降低首章散掉的概率。', 'contracts', 8, ['场景计划', '正文起稿'], '打开章节合同'),
      createTask('quick-quality', '看一眼生产健康', '进入正文前先看生产灯和连续性风险，可以少走一次返工。', 'quality', 6, ['继续推进判断'], '打开质量监控'),
    )
  } else if (mode === 'asset_building') {
    candidates.push(
      createTask('asset-threads-alt', '补故事线程', '线程层是把已有资产真正挂到主线推进上的关键胶水。', 'threads', 8, ['结构推进', '伏笔回收'], '打开故事线程'),
      createTask('asset-volume-alt', '补卷级设计', '当资产基本到位后，卷级设计会比继续堆数量更值钱。', 'volume-design', 10, ['章节计划', '卷末闭环'], '打开卷级设计'),
      createTask('asset-outline-alt', '把资产落成大纲', '结构化资产只有进入大纲后才真正开始服务正文。', 'outline', 12, ['时间轴', '正文'], '打开故事大纲'),
    )
  } else if (mode === 'daily_push') {
    candidates.push(
      createTask('daily-contracts', '检查本章合同', '正文推进前先看本章与场景合同，可以减少返工。', 'contracts', 8, ['更稳的初稿'], '打开章节合同'),
      createTask('daily-revision', '清一轮修订积压', `当前仍有 ${stats.revisionTaskCount} 条修订任务待处理，适合在写作间隙清掉高价值问题。`, 'revision', 10, ['更稳的继续推进'], '打开修订中心'),
      createTask('daily-quality', '检查质量总灯', '连载推进前看一眼生产灯、批次健康和连续性，会比写完再返工更省。', 'quality', 6, ['继续批量推进判断'], '打开质量监控'),
    )
    if (qualitySummary?.batchHealth.status === 'paused' && qualitySummary.batchHealth.canContinue) {
      candidates.unshift(
        createTask('daily-task-center', '查看后台流程恢复点', '当前已有可继续的后台流程，先回到任务中心确认恢复点最直接。', 'task-center', 5, ['批次恢复'], '打开后台任务中心'),
      )
    }
  } else {
    candidates.push(
      createTask('revision-center', '打开修订中心', '集中处理一致性问题、待同步章节和人工修订项。', 'revision', 12, ['清理 blocker'], '打开修订中心'),
      createTask('revision-quality-alt', '检查质量趋势', '先看风险分布和总灯，再决定先修哪个问题。', 'quality', 8, ['修订优先级'], '打开质量监控'),
      createTask('revision-writing-alt', '回到正文定位问题章节', '修订判断完成后，通常需要回正文页落局部修改。', 'writing', 10, ['局部修订'], '进入正文写作'),
    )
  }

  const seen = new Set<string>([primaryTaskId])
  return candidates.filter((task) => {
    if (seen.has(task.id)) return false
    seen.add(task.id)
    return true
  }).slice(0, 2)
}

function buildBlockers(
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
): AuthorWorkflowBlocker[] {
  const blockers: AuthorWorkflowBlocker[] = []
  const assetBloat = getAssetBloatSignal(stats)
  if (stats.revisionBlockerCount > 0) {
    blockers.push(createBlocker('revision-blockers', 'high', '高优先修订问题未清理', `当前有 ${stats.revisionBlockerCount} 个 blocker 级修订问题未处理，继续推进正文会放大返工。`, 'revision', '打开修订中心'))
  }
  if (stats.staleChapterCount > 0) {
    blockers.push(createBlocker('stale-chapters', 'high', '已有章节仍在引用旧上下文', `当前有 ${stats.staleChapterCount} 章待同步，设定或结构变更还没有回补到正文。`, 'revision', '查看待同步任务'))
  }
  if (stats.staleAssetCount > 0) {
    blockers.push(createBlocker('stale-assets', 'medium', '资产仍挂着旧设定', `当前有 ${stats.staleAssetCount} 类资产待校准，继续生成会污染后续时间轴和正文。`, 'revision', '处理资产同步'))
  }
  if (stats.staleCheckpointCount > 0) {
    blockers.push(createBlocker('stale-checkpoints', 'medium', '长期记忆检查点待刷新', `当前有 ${stats.staleCheckpointCount} 份检查点未刷新，长程记忆仍可能引用旧事实。`, 'quality', '打开质量监控'))
  }
  if (qualitySummary?.productionReadiness.status === 'blocked') {
    blockers.push(createBlocker('production-blocked', 'high', '当前生产总灯不建议继续扩批', qualitySummary.productionReadiness.summary, 'quality', '查看生产总灯'))
  }
  if (qualitySummary?.batchHealth.status === 'paused' && qualitySummary.batchHealth.canContinue) {
    blockers.push(createBlocker('paused-batch', 'medium', '后台批次流程已暂停', qualitySummary.batchHealth.summary, 'task-center', '打开后台任务中心'))
  }
  if (assetBloat.risk === 'high') {
    blockers.push(createBlocker('asset-bloat', 'medium', '首章前资产已经开始膨胀', assetBloat.reason, stats.outlineCount > 0 ? 'writing' : 'outline', stats.outlineCount > 0 ? '进入正文写作' : '打开故事大纲'))
  }
  return blockers.slice(0, 3)
}

function buildImpactNotices(
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
): AuthorImpactNotice[] {
  const notices: AuthorImpactNotice[] = []
  const assetBloat = getAssetBloatSignal(stats)
  if (stats.staleAssetCount > 0) {
    notices.push({
      id: 'impact-assets',
      title: '设定变更正在波及资产与章节',
      reason: `当前有 ${stats.staleAssetCount} 类资产待校准，继续推进前应先确认受影响章节与资产。`,
      affectedKinds: ['资产', '章节', '时间轴'],
      entryPage: 'revision',
    })
  }
  if (stats.staleCheckpointCount > 0) {
    notices.push({
      id: 'impact-memory',
      title: '长期记忆仍在引用旧版本',
      reason: `当前有 ${stats.staleCheckpointCount} 份检查点待刷新，后续大纲与正文可能继续读取旧长程记忆。`,
      affectedKinds: ['检查点', '大纲', '正文'],
      entryPage: 'quality',
    })
  }
  if (qualitySummary?.continuityHealth.recallDegradedChapterCount && qualitySummary.continuityHealth.recallDegradedChapterCount > 0) {
    notices.push({
      id: 'impact-recall',
      title: '近期召回降级正在影响连续性',
      reason: `已有 ${qualitySummary.continuityHealth.recallDegradedChapterCount} 章出现召回降级，继续扩批前应先确认连续性是否稳定。`,
      affectedKinds: ['上下文', '章节承接', '批次推进'],
      entryPage: 'quality',
    })
  }
  if (qualitySummary?.batchHealth.chapterIds.length && qualitySummary.batchHealth.chapterIds.length > 0) {
    notices.push({
      id: 'impact-batch',
      title: '最近批次已有明确回查范围',
      reason: qualitySummary.batchHealth.summary,
      affectedKinds: ['批次', '章节'],
      entryPage: qualitySummary.batchHealth.status === 'paused' ? 'task-center' : 'quality',
    })
  }
  if (assetBloat.risk !== 'none') {
    notices.push({
      id: 'impact-asset-bloat',
      title: '资产增长已经快于正文推进',
      reason: assetBloat.reason,
      affectedKinds: ['资产', '大纲', '正文'],
      entryPage: stats.outlineCount > 0 ? 'writing' : 'outline',
    })
  }
  return notices.slice(0, 3)
}

export function resolveSuggestedAuthorWorkMode(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'projectBriefJson' | 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson' | 'launchMode' | 'operatingMode'> | null | undefined,
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
): { mode: AuthorWorkMode; reason: string } {
  const hasStartedWriting = stats.chapterCount > 0 || stats.totalWords > 0
  const assetBloat = getAssetBloatSignal(stats)
  const hasRevisionPressure = stats.revisionBlockerCount > 0
    || stats.staleChapterCount > 0
    || stats.staleAssetCount > 0
    || stats.staleCheckpointCount > 0
    || qualitySummary?.productionReadiness.status === 'blocked'

  if (hasRevisionPressure) {
    return {
      mode: 'revision_closure',
      reason: '当前存在 blocker、待同步章节、资产滞后或生产总灯阻断，最值钱的动作是先收口风险。',
    }
  }

  if (hasStartedWriting) {
    return {
      mode: 'daily_push',
      reason: '项目已经进入正文阶段，当前最有价值的工作流是围绕章节推进、合同和质量做日更式推进。',
    }
  }

  const operatingMode = resolveOperatingMode({
    launchMode: novel?.launchMode,
    operatingMode: novel?.operatingMode,
    targetWords: stats.totalWords > 0 ? stats.totalWords : undefined,
    settingsJson: novel?.settingsJson,
    chapterCount: stats.chapterCount,
  })

  const hasNoFoundation = !isBasicsReady(novel)
    && !isProjectBriefReady(novel)
    && !isStoryCoreReady(novel)
    && !isThemeVoiceReady(novel)
    && !isWorldFoundationReady(novel)

  if (novel?.launchMode === 'fast_launch' || (operatingMode === 'shortform' && hasNoFoundation)) {
    return {
      mode: 'quick_start',
      reason: '当前项目采用极速开书路径，系统会优先把最小可写底盘压成首章入口，而不是先补完整资产库。',
    }
  }

  if (assetBloat.risk === 'high') {
    return {
      mode: 'quick_start',
      reason: assetBloat.reason,
    }
  }

  const foundationReady = isBasicsReady(novel)
    && isProjectBriefReady(novel)
    && isStoryCoreReady(novel)
    && isThemeVoiceReady(novel)
    && isWorldFoundationReady(novel)

  if (foundationReady && countAssetGaps(novel, stats) >= 2) {
    return {
      mode: 'asset_building',
      reason: '底盘已经基本成型，但关键资产和结构承载位仍缺口明显，先补有效资产比直接开写更稳。',
    }
  }

  return {
    mode: 'quick_start',
    reason: '当前项目还处于开书前或首章前阶段，最值钱的动作是尽快进入可写第一章，而不是在模块间来回跳转。',
  }
}

export function buildAuthorWorkflowSummary(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'projectBriefJson' | 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson' | 'launchMode' | 'operatingMode'> | null | undefined,
  stats: WorkflowStats,
  qualitySummary: AuthorWorkflowQualitySummary,
  mode?: AuthorWorkMode,
): AuthorWorkflowModeSummary {
  const suggested = resolveSuggestedAuthorWorkMode(novel, stats, qualitySummary)
  const selectedMode = mode || suggested.mode

  const primaryTask = selectedMode === 'quick_start'
    ? resolveQuickStartPrimaryTask(novel, stats)
    : selectedMode === 'asset_building'
      ? resolveAssetPrimaryTask(novel, stats)
      : selectedMode === 'daily_push'
        ? resolveDailyPrimaryTask(stats, qualitySummary)
        : resolveRevisionPrimaryTask(stats, qualitySummary)

  return {
    mode: selectedMode,
    modeReason: selectedMode === suggested.mode ? suggested.reason : `当前为手动切换到“${MODE_LABELS[selectedMode]}”，系统推荐仍为“${MODE_LABELS[suggested.mode]}”。`,
    primaryTask,
    alternateTasks: buildAlternateTasks(selectedMode, novel, stats, qualitySummary, primaryTask.id),
    blockers: buildBlockers(stats, qualitySummary),
    impactNotices: buildImpactNotices(stats, qualitySummary),
    recommendedEntryPage: primaryTask.entryPage,
  }
}

export function resolveAuthorWorkflowHref(novelId: number, entryPage: AuthorWorkflowRouteKey): string {
  if (entryPage === 'task-center') return '/tasks'
  return `/novels/${novelId}/${entryPage}`
}
