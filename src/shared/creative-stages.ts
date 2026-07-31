export type CreativeStageKind =
  | 'foundation'
  | 'volume'
  | 'arc'
  | 'chapter-window'
  | 'expansion'

export type CreativeStageStatus =
  | 'planned'
  | 'active'
  | 'locked'
  | 'completed'
  | 'archived'

export type CreativeStageAssetType =
  | 'character'
  | 'world'
  | 'map'
  | 'faction'
  | 'item'
  | 'thread'
  | 'timeline'
  | 'outline'

export type CreativeStageAssetRole = 'core' | 'supporting' | 'latent' | 'handoff'
export type CreativeStageAssetDetail = 'placeholder' | 'outline' | 'working' | 'canonical'
export type CreativeStageAssetStatus = 'planned' | 'draft' | 'active' | 'deferred' | 'retired'

export interface CreativeStage {
  id: number
  novelId: number
  sequence: number
  name: string
  kind: CreativeStageKind
  status: CreativeStageStatus
  chapterStart?: number
  chapterEnd?: number
  volumeId?: number
  partId?: number
  objective: string
  storySummary: string
  handoffSummary: string
  constraintsJson?: string
  contextVersion: number
  activeAssetCount: number
  plannedAssetCount: number
  coreAssetCount: number
  createdAt: string
  updatedAt: string
}

export interface CreativeStageCreateInput {
  name: string
  kind?: CreativeStageKind
  status?: CreativeStageStatus
  chapterStart?: number
  chapterEnd?: number
  volumeId?: number
  partId?: number
  objective?: string
  storySummary?: string
  handoffSummary?: string
  constraintsJson?: string
}

export interface CreativeStageUpdateInput extends Partial<CreativeStageCreateInput> {
  id: number
}

export interface CreativeStageAssetBinding {
  id: number
  novelId: number
  stageId: number
  assetType: CreativeStageAssetType
  assetId?: number
  placeholderName?: string
  role: CreativeStageAssetRole
  detailLevel: CreativeStageAssetDetail
  status: CreativeStageAssetStatus
  requestedFieldsJson?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CreativeStageAssetInput {
  id?: number
  stageId: number
  assetType: CreativeStageAssetType
  assetId?: number
  placeholderName?: string
  role?: CreativeStageAssetRole
  detailLevel?: CreativeStageAssetDetail
  status?: CreativeStageAssetStatus
  requestedFieldsJson?: string
  notes?: string
}

export interface CreativeStageContext {
  stage: CreativeStage
  assets: CreativeStageAssetBinding[]
  activeCharacterIds: number[]
  activeMapIds: number[]
  promptSummary: string
}

export const CREATIVE_STAGE_KIND_OPTIONS: Array<{ value: CreativeStageKind; label: string; description: string }> = [
  { value: 'foundation', label: '全书底盘', description: '只锁定不可轻易推翻的核心设定与终局方向。' },
  { value: 'volume', label: '卷级阶段', description: '围绕一卷的主要冲突、人物弧和地点范围展开。' },
  { value: 'arc', label: '故事弧阶段', description: '围绕一条主线、支线或关系弧集中推进。' },
  { value: 'chapter-window', label: '章节窗口', description: '只为指定章节区间补齐当前真正会出场的资产。' },
  { value: 'expansion', label: '增量扩展', description: '在正文推进后补充新人物、地点或世界分支。' },
]

export const CREATIVE_STAGE_STATUS_OPTIONS: Array<{ value: CreativeStageStatus; label: string }> = [
  { value: 'planned', label: '待规划' },
  { value: 'active', label: '当前工作段' },
  { value: 'locked', label: '已锁定' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

export const CREATIVE_STAGE_ASSET_TYPE_OPTIONS: Array<{ value: CreativeStageAssetType; label: string }> = [
  { value: 'character', label: '人物' },
  { value: 'world', label: '世界规则' },
  { value: 'map', label: '地点' },
  { value: 'faction', label: '势力' },
  { value: 'item', label: '物品' },
  { value: 'thread', label: '剧情线程' },
  { value: 'timeline', label: '时间轴事件' },
  { value: 'outline', label: '大纲节点' },
]

export const CREATIVE_STAGE_ASSET_ROLE_OPTIONS: Array<{ value: CreativeStageAssetRole; label: string }> = [
  { value: 'core', label: '核心' },
  { value: 'supporting', label: '支撑' },
  { value: 'latent', label: '潜伏' },
  { value: 'handoff', label: '交接' },
]

export function clampChapterRange(start?: number, end?: number): { chapterStart?: number; chapterEnd?: number } {
  const normalizedStart = Number.isFinite(start) && Number(start) > 0 ? Math.round(Number(start)) : undefined
  const normalizedEnd = Number.isFinite(end) && Number(end) > 0 ? Math.round(Number(end)) : undefined
  if (!normalizedStart && !normalizedEnd) return {}
  if (!normalizedStart) return { chapterEnd: normalizedEnd }
  if (!normalizedEnd) return { chapterStart: normalizedStart }
  return normalizedStart <= normalizedEnd
    ? { chapterStart: normalizedStart, chapterEnd: normalizedEnd }
    : { chapterStart: normalizedEnd, chapterEnd: normalizedStart }
}

export function formatCreativeStageRange(stage: Pick<CreativeStage, 'chapterStart' | 'chapterEnd'>): string {
  if (stage.chapterStart && stage.chapterEnd) return `第 ${stage.chapterStart}–${stage.chapterEnd} 章`
  if (stage.chapterStart) return `第 ${stage.chapterStart} 章起`
  if (stage.chapterEnd) return `截至第 ${stage.chapterEnd} 章`
  return '全书范围'
}

export function buildCreativeStagePromptSummary(context: Pick<CreativeStageContext, 'stage' | 'assets'>): string {
  const { stage, assets } = context
  const grouped = new Map<string, string[]>()
  assets.forEach((asset) => {
    const key = asset.assetType
    const name = asset.placeholderName?.trim() || `${asset.assetType}#${asset.assetId ?? '待建'}`
    grouped.set(key, [...(grouped.get(key) || []), `${name}（${asset.role} / ${asset.detailLevel}）`])
  })
  const assetLines = [...grouped.entries()].map(([type, names]) => `- ${type}: ${names.join('、')}`)
  return [
    `当前创作阶段：${stage.name}（${formatCreativeStageRange(stage)}）`,
    stage.objective ? `阶段目标：${stage.objective}` : '',
    stage.storySummary ? `本段剧情：${stage.storySummary}` : '',
    stage.handoffSummary ? `交接条件：${stage.handoffSummary}` : '',
    assetLines.length > 0 ? `阶段资产清单：\n${assetLines.join('\n')}` : '阶段资产清单：尚未登记，生成器只能补充当前窗口所需的最小资产。',
  ].filter(Boolean).join('\n')
}
