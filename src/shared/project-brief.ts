export type ProjectPlatformMode =
  | 'web_serial'
  | 'publishing'
  | 'general'
  | 'fanqie'
  | 'feilu'

export interface PlatformDesignProfile {
  mode: ProjectPlatformMode
  label: string
  positioning: string
  openingFocus: string
  rhythmFocus: string
  packagingFocus: string
  qualityFocus: string[]
  riskFocus: string[]
}

export interface ProjectBriefDocument {
  platformMode: ProjectPlatformMode | ''
  targetAudience: string
  targetReader: string
  readerPromise: string
  sellingPoints: string
  compTitles: string
  tabooRules: string
  deliveryRhythm: string
}

export interface ProjectBriefSnapshot extends ProjectBriefDocument {
  readyCount: number
}

const EMPTY_PROJECT_BRIEF: ProjectBriefDocument = {
  platformMode: '',
  targetAudience: '',
  targetReader: '',
  readerPromise: '',
  sellingPoints: '',
  compTitles: '',
  tabooRules: '',
  deliveryRhythm: '',
}

const PROJECT_PLATFORM_LABELS: Record<ProjectPlatformMode, string> = {
  general: '通用长篇',
  web_serial: '网文连载',
  publishing: '出版小说',
  fanqie: '番茄小说',
  feilu: '飞卢小说',
}

const PROJECT_PLATFORM_PROFILES: Record<ProjectPlatformMode, PlatformDesignProfile> = {
  general: {
    mode: 'general',
    label: '通用长篇',
    positioning: '先确定题材承诺、人物驱动力和长期矛盾，再选择适合的连载或出版节奏。',
    openingFocus: '开篇交代主角处境、核心问题和第一个必须做出的选择。',
    rhythmFocus: '每章至少推进一个可追踪变量，避免连续章节只做背景说明。',
    packagingFocus: '标题、简介和卖点要具体说明冲突对象与阅读回报。',
    qualityFocus: ['章节承接可复述', '铺垫能回收到行动或证据', '人物选择带来真实代价'],
    riskFocus: ['大段设定说明', '抽象口号代替冲突', '只靠反转制造推进'],
  },
  web_serial: {
    mode: 'web_serial',
    label: '网文连载',
    positioning: '以持续追读为目标，先把题材卖点、单章回报和长线主线固定下来。',
    openingFocus: '尽早给出异常、目标或即时损失，让读者知道下一步为什么值得追。',
    rhythmFocus: '章节要有明确任务、结果和新压力，连载中不能让线索长期悬空。',
    packagingFocus: '标题和简介优先写清主角困境、核心能力/关系与回报。',
    qualityFocus: ['单章有变化', '章尾有具体问题', '伏笔与回收保持可追踪'],
    riskFocus: ['水字数', '连续铺垫无兑现', '章节只剩情绪宣告'],
  },
  fanqie: {
    mode: 'fanqie',
    label: '番茄小说',
    positioning: '以类型承诺和情绪回报为核心，先让读者看见冲突、人物处境和可追更的问题。',
    openingFocus: '开篇快速落到主角处境、异常/目标与即时损失；首章结尾必须指向下一步具体动作。',
    rhythmFocus: '每章至少完成一次行动结果、关系变化、资源变化或证据推进；解释后置，连续章节不能只铺设不兑现。',
    packagingFocus: '标题、简介和封面文案突出冲突对象、独特机制和稳定回报，少用无法验证的宏大形容词。',
    qualityFocus: ['读者能复述主角当前要解决什么', '情绪回报来自选择与后果', '章节结尾留下可执行悬念'],
    riskFocus: ['开头慢热且信息密度低', '用连续震惊代替剧情', '标题简介承诺与正文回报不一致'],
  },
  feilu: {
    mode: 'feilu',
    label: '飞卢小说',
    positioning: '以即时反馈和高频结果为核心，突出身份/能力差、当前冲突和读者能马上看到的收益。',
    openingFocus: '尽快亮出主角的处境、能力或资源缺口，并在首章让一次行动产生可见反馈。',
    rhythmFocus: '每章都要有动作结果、他人反应或新压力；爽点必须由规则、成本和对手反应支撑。',
    packagingFocus: '标题和简介把能力、场景、冲突与结果写清，避免只堆“无敌、震惊、后悔”等空标签。',
    qualityFocus: ['能力使用有边界', '每章有可见反馈', '反馈推动下一次选择而非原地重复'],
    riskFocus: ['无成本打脸', '重复震惊和跪求', '只给结果不交代因果与代价'],
  },
  publishing: {
    mode: 'publishing',
    label: '出版小说',
    positioning: '优先保证完整结构、人物弧线、语言一致性和主题回收，不以单章刺激替代整体完成度。',
    openingFocus: '用一个有叙事功能的场景建立人物问题、关系张力和主题方向。',
    rhythmFocus: '允许慢，但每个场景都要改变人物认知、关系、处境或选择。',
    packagingFocus: '标题和简介服务于作品整体气质，不夸大正文没有兑现的卖点。',
    qualityFocus: ['长线结构闭合', '人物变化有阶段证据', '语言和主题前后一致'],
    riskFocus: ['为追求刺激牺牲因果', '人物只承担功能', '结尾突然升华'],
  },
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isProjectPlatformMode(value: unknown): value is ProjectPlatformMode {
  return typeof value === 'string' && value in PROJECT_PLATFORM_LABELS
}

export function getPlatformDesignProfile(mode?: ProjectPlatformMode | '' | null): PlatformDesignProfile {
  return PROJECT_PLATFORM_PROFILES[mode && isProjectPlatformMode(mode) ? mode : 'general']
}

function parseJsonObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}

  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return {}
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

export function parseProjectBriefDocument(raw?: string | null): ProjectBriefDocument {
  const root = parseJsonObject(raw)
  const platformMode = asText(root.platform_mode ?? root.platformMode)

  return {
    platformMode: isProjectPlatformMode(platformMode) ? platformMode : '',
    targetAudience: asText(root.target_audience ?? root.targetAudience),
    targetReader: asText(root.target_reader ?? root.targetReader),
    readerPromise: asText(root.reader_promise ?? root.readerPromise),
    sellingPoints: asText(root.selling_points ?? root.sellingPoints),
    compTitles: asText(root.comp_titles ?? root.compTitles),
    tabooRules: asText(root.taboo_rules ?? root.tabooRules),
    deliveryRhythm: asText(root.delivery_rhythm ?? root.deliveryRhythm),
  }
}

export function parseProjectBriefSnapshot(raw?: string | null): ProjectBriefSnapshot {
  const document = parseProjectBriefDocument(raw)
  const readyCount = [
    document.platformMode,
    document.targetAudience,
    document.targetReader,
    document.readerPromise,
    document.sellingPoints,
    document.compTitles,
  ].filter(Boolean).length

  return {
    ...EMPTY_PROJECT_BRIEF,
    ...document,
    readyCount,
  }
}

export function buildProjectBriefPayload(
  patch: Partial<ProjectBriefDocument>,
  existingRaw?: string | null,
): string {
  const current = parseProjectBriefDocument(existingRaw)
  const next = {
    ...current,
    ...patch,
  }

  return JSON.stringify(compactObject({
    platform_mode: next.platformMode,
    target_audience: next.targetAudience,
    target_reader: next.targetReader,
    reader_promise: next.readerPromise,
    selling_points: next.sellingPoints,
    comp_titles: next.compTitles,
    taboo_rules: next.tabooRules,
    delivery_rhythm: next.deliveryRhythm,
  }))
}

export function buildProjectBriefSummary(projectBrief: ProjectBriefDocument): string {
  const platform = projectBrief.platformMode ? getPlatformDesignProfile(projectBrief.platformMode) : null
  return [
    platform ? `目标平台：${platform.label}` : '',
    platform ? `平台定位：${platform.positioning}` : '',
    platform ? `开局重点：${platform.openingFocus}` : '',
    platform ? `节奏重点：${platform.rhythmFocus}` : '',
    platform ? `包装重点：${platform.packagingFocus}` : '',
    platform ? `质量门：${platform.qualityFocus.join('；')}` : '',
    platform ? `平台风险：${platform.riskFocus.join('；')}` : '',
    projectBrief.targetAudience ? `目标赛道：${projectBrief.targetAudience}` : '',
    projectBrief.targetReader ? `目标读者：${projectBrief.targetReader}` : '',
    projectBrief.readerPromise ? `读者承诺：${projectBrief.readerPromise}` : '',
    projectBrief.sellingPoints ? `卖点：${projectBrief.sellingPoints}` : '',
    projectBrief.compTitles ? `参考作品：${projectBrief.compTitles}` : '',
    projectBrief.tabooRules ? `禁区：${projectBrief.tabooRules}` : '',
    projectBrief.deliveryRhythm ? `交付节奏：${projectBrief.deliveryRhythm}` : '',
  ].filter(Boolean).join('\n')
}
