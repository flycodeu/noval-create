import type {
  BatchRollbackMode,
  BatchWorkbenchData,
  Chapter,
  ChapterWritebackCenterData,
  ChapterWritebackRun,
  GlobalLockLibrary,
  ModelConfig,
  Template,
  Novel,
  SourceSearchProviderMode,
  SourceSearchSettingsView,
} from '../types'
import {
  isWebDemoPreviewEnabled,
  WEB_DEMO_PREVIEW_STORAGE_KEY,
} from './web-preview-mode'
import { normalizeWritebackSyncStatus } from '../shared/writeback-status'

type BridgeMethod = (...args: unknown[]) => Promise<unknown>
type BridgeService = Record<string, BridgeMethod>
type WebEventCallback = (...args: unknown[]) => void

const webEventCallbacks = new Map<string, Set<WebEventCallback>>()
let webEventSource: EventSource | null = null

function ensureWebEventSource() {
  if (typeof window === 'undefined' || typeof window.EventSource !== 'function' || webEventSource) return

  webEventSource = new window.EventSource('/events')
  webEventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { channel?: unknown; args?: unknown[] }
      if (typeof payload.channel !== 'string' || !Array.isArray(payload.args)) return
      webEventCallbacks.get(payload.channel)?.forEach((callback) => callback(...payload.args!))
    } catch {
      // Ignore malformed or keep-alive event frames.
    }
  }
}

function subscribeWebEvent(channel: string, callback: WebEventCallback): () => void {
  const callbacks = webEventCallbacks.get(channel) || new Set<WebEventCallback>()
  callbacks.add(callback)
  webEventCallbacks.set(channel, callbacks)
  ensureWebEventSource()

  return () => {
    callbacks.delete(callback)
    if (callbacks.size === 0) webEventCallbacks.delete(channel)
    if (webEventCallbacks.size === 0 && webEventSource) {
      webEventSource.close()
      webEventSource = null
    }
  }
}

function unsubscribeWebEvent(channel: string, callback: WebEventCallback) {
  const callbacks = webEventCallbacks.get(channel)
  if (!callbacks) return
  callbacks.delete(callback)
  if (callbacks.size === 0) webEventCallbacks.delete(channel)
  if (webEventCallbacks.size === 0 && webEventSource) {
    webEventSource.close()
    webEventSource = null
  }
}

const WEB_BRIDGE_MARKER = '__novalCreateWebBridgeInstalled'
const NOW = '2026-05-24T09:00:00.000Z'
const LOCAL_BACKEND_URL = ''
const LOCAL_BACKEND_RPC_TIMEOUT_MS = 15_000
const WEB_MODEL_CONFIGS_KEY = 'novelforge.webPreview.modelConfigs'
const WEB_SOURCE_SEARCH_KEY = 'novelforge.webPreview.sourceSearchSettings'
const MASKED_KEY = '已设置'

type WebModelConfig = Omit<ModelConfig, 'apiKey'> & { apiKeySet?: boolean }
type WebSourceSearchSettings = Pick<SourceSearchSettingsView, 'provider' | 'tavilyApiKeySet' | 'braveApiKeySet' | 'updatedAt'>

let localBackendLastError = ''
let localBackendStatus: 'checking' | 'connected' | 'unavailable' = 'checking'
let backendCheckPromise: Promise<boolean> | null = null

function isDemoFallbackEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return isWebDemoPreviewEnabled(
      window.location.search,
      window.localStorage.getItem(WEB_DEMO_PREVIEW_STORAGE_KEY),
    )
  } catch {
    return false
  }
}

async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch('/health', { method: 'GET' })
    if (!response.ok) return false
    const data = await response.json()
    return data?.ok === true
  } catch {
    return false
  }
}

async function waitForBackend(maxRetries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (await checkBackendHealth()) {
      localBackendLastError = ''
      localBackendStatus = 'connected'
      console.log('[local-backend] connected')
      return true
    }
    if (attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)))
    }
  }
  rememberLocalBackendError('健康检查失败，本地后端可能未启动')
  return false
}

const projectBriefJson = JSON.stringify({
  premise: '在近未来城市的旧城区，一名修复记忆档案的调查员发现自己的童年被写进了不存在的案件。',
  targetReader: '偏好悬疑、轻科幻和人物成长的长篇读者',
  sellingPoints: ['记忆档案犯罪', '旧城更新阴谋', '双线追凶'],
  coreEmotion: '在被篡改的过去里重新选择信任',
  constraints: ['每卷保留一个可验证线索', '关键反转必须提前埋点'],
  readyCount: 6,
})

const settingsJson = JSON.stringify({
  premise: {
    positioning: '都市悬疑长篇',
    coreHook: '主角修复别人的记忆时，发现所有证据都指向自己。',
    protagonistStart: '谨慎、专业、拒绝谈论过去',
    constraints: '案件推进必须依靠可见线索，而非突然的灵感解释。',
  },
  storyGoal: '查清旧城区连环失踪案背后的记忆交易网络。',
  coreConflict: '个人记忆的真实性与城市秩序的稳定性互相冲突。',
  mainPlot: '从一份错档案切入，逐步追到城市治理系统和旧案真相。',
  ending: '主角公开真相，同时保留对亲密关系的重新选择。',
  endgameDesign: {
    endingMode: '真相公开但代价明确',
    finalConflict: '主角必须在保住关键证人和公开档案之间做选择。',
    themeAnswer: '真实不是完整无缺的记录，而是愿意承担后果的选择。',
    mustDeliverPromises: '旧案真凶、童年缺口、记忆交易规则全部回收。',
    payoffChecklist: '第一卷照片、第三卷录音、主角手套习惯最终回扣。',
    deliberateUnknowns: '保留城市外部联盟的下一部空间。',
    finalImage: '清晨的旧档案馆重新开门。',
    lastScene: '主角把自己的档案放回公开目录。',
  },
})

const themeVoiceJson = JSON.stringify({
  theme: '记忆与选择',
  emotionalCore: '克制的互相信任',
  pov: '第三人称有限视角',
  tense: '现在时为主',
  styleRules: '句子保持清晰具体，少用宏大抽象判断；动作和物件承担情绪。',
  dialogueRules: '对话短促、有信息差，避免角色解释自己已经知道的事。',
  writingContractTags: ['具象线索', '克制情绪', '伏笔回收'],
})

const worldRulesJson = JSON.stringify({
  summary: '城市允许合法记忆修复，但禁止商业化改写人格经历。地下组织通过旧城区诊所绕过监管。',
  sections: [
    { key: 'technology', title: '记忆修复', content: '只能修补断裂片段，无法无代价创造新记忆。' },
    { key: 'society', title: '城市治理', content: '档案馆、诊所和警署共享有限索引。' },
  ],
  timelineConfig: {
    calendarType: 'future-date',
    eraName: '近未来旧城改造期',
    epochLabel: '旧城档案馆重启',
    baseYearLabel: '2042 年',
    displayPattern: '2042-雨夜-序列',
    relativeZeroLabel: '错档案出现当晚',
    recommendedEventTypes: ['线索', '冲突', '反转', '回收'],
    precisionOptions: ['时刻', '日', '阶段'],
  },
})

const demoNovels: Novel[] = [
  {
    id: 1,
    title: '雾城档案',
    synopsis: '记忆修复师在一宗旧城失踪案里发现自己的童年被人为剪掉，所有线索都指向一份不该存在的档案。',
    genreId: 5,
    launchMode: 'professional_longform',
    operatingMode: 'standard_longform',
    genreName: '科幻悬疑',
    genreColorTag: '#2e86ab',
    status: 'writing',
    totalWords: 46800,
    targetWords: 320000,
    userBackground: '希望写一部偏现实质感的近未来悬疑长篇，节奏紧凑但人物关系要细。',
    expandedBackground: '核心卖点是记忆档案、旧城更新和亲密关系信任危机，故事从一个错档案开始。',
    projectBriefJson,
    settingsJson,
    themeVoiceJson,
    worldRulesJson,
    contextVersion: 3,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 2,
    title: '长夜列车',
    synopsis: '一列只在雨夜出现的城际列车，把六个失踪者的家属带向同一个终点。',
    genreId: 4,
    launchMode: 'professional_longform',
    operatingMode: 'standard_longform',
    genreName: '悬疑推理',
    genreColorTag: '#4b5563',
    status: 'draft',
    totalWords: 12800,
    targetWords: 260000,
    userBackground: '想要强谜面、多人物视角和列车空间压迫感。',
    expandedBackground: '每节车厢对应一段旧案证词，最终汇合成共同隐瞒。',
    projectBriefJson,
    settingsJson,
    themeVoiceJson,
    worldRulesJson,
    contextVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 3,
    title: '山海债',
    synopsis: '没落镖局的女继承人押送一份不能打开的契约，沿途遇见被旧神债务追索的人。',
    genreId: 3,
    launchMode: 'fast_launch',
    operatingMode: 'standard_longform',
    genreName: '玄幻修真',
    genreColorTag: '#7c3aed',
    status: 'draft',
    totalWords: 8200,
    targetWords: 500000,
    userBackground: '东方奇幻公路文，想要江湖规矩和神怪债务系统。',
    expandedBackground: '主角每完成一段押送，就要替别人偿还一项代价。',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 4,
    title: '第七间诊室',
    synopsis: '心理诊所的第七间诊室从不对外开放，直到一名患者在里面留下了未来日期的遗书。',
    genreId: 4,
    launchMode: 'fast_launch',
    operatingMode: 'shortform',
    genreName: '都市悬疑',
    genreColorTag: '#0f766e',
    status: 'writing',
    totalWords: 23500,
    targetWords: 180000,
    userBackground: '短中篇悬疑，重点是空间谜题和人物互相试探。',
    expandedBackground: '诊所每个人都有一段不能被记录的治疗经历。',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 5,
    title: '北境邮差',
    synopsis: '边境邮差负责投递战争结束后的最后一批信件，却逐渐发现收信人都已经提前知道内容。',
    genreId: 6,
    launchMode: 'professional_longform',
    operatingMode: 'epic_longform',
    genreName: '架空历史',
    genreColorTag: '#b45309',
    status: 'draft',
    totalWords: 5200,
    targetWords: 420000,
    userBackground: '架空历史、公路叙事、战争余波。',
    expandedBackground: '每封信打开一段边境政治与个人承诺的旧账。',
    createdAt: NOW,
    updatedAt: NOW,
  },
]

const demoTemplates: Template[] = [
  {
    id: 1,
    type: 'style',
    name: '克制悬疑文风',
    description: '适合线索密集、情绪内收的长篇悬疑。',
    contentJson: JSON.stringify({ tone: '冷静、具体、少解释', avoid: '模板化震惊和夸张口号' }),
    isBuiltin: 1,
    createdAt: NOW,
  },
  {
    id: 2,
    type: 'world',
    name: '近未来城市规则',
    description: '包含技术边界、监管关系和地下交易限制。',
    contentJson: JSON.stringify({ rules: ['技术有代价', '机构之间存在信息墙', '黑市只能绕开不能消除规则'] }),
    isBuiltin: 1,
    createdAt: NOW,
  },
]

const demoChapters: Chapter[] = [
  {
    id: 101,
    novelId: 1,
    chapterNum: 1,
    title: '错档案',
    outline: '主角在夜班中接手一份编号错误的记忆档案，发现当事人证词和自己的童年照片重叠。',
    scenePlanJson: JSON.stringify([
      {
        scene_order: 1,
        scene_title: '夜班错档',
        purpose: '建立旧档案馆氛围，并抛出无法回溯的档案编号。',
        location: '旧城档案馆',
        time_anchor: '雨夜 23:40',
        present_characters: ['林晏'],
        key_items: ['编号错误的档案袋', '童年照片'],
        must_cover: ['档案编号无法回溯', '照片背面出现主角姓名'],
      },
      {
        scene_order: 2,
        scene_title: '委托人来访',
        purpose: '引出关键委托人，确认缺失记忆不是孤例。',
        location: '档案馆接待室',
        time_anchor: '雨夜 00:20',
        present_characters: ['林晏', '周岑'],
        key_items: ['旧录音笔'],
        must_cover: ['委托人拒绝说明档案来源', '两人缺失同一段记忆'],
      },
    ]),
    content: '雨声贴着档案馆的玻璃往下流。林晏把第七柜的锁重新扣上，指尖却停在那份没有登记人的档案袋上。',
    wordCount: 3200,
    summary: '林晏接触错档案，发现旧城失踪案与自己的童年缺口有关。',
    status: 'draft',
    targetWords: 3200,
    contextVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

const emptyPagedResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
}

const emptyPipelineStats = {
  totalPipelineCount: 0,
  activePipelineCount: 0,
  roleStats: [],
  commonRecoveryHints: [],
}

const emptyQualityDashboard = {
  totalChaptersScored: 0,
  chapterGateSummary: {
    coveredChapterCount: 0,
  },
  protagonistSetbackSummary: {
    chapterCount: 0,
  },
  storyArcProgressSummary: {
    trackedArcCount: 0,
  },
  storyArcProgressAlerts: [],
  dialogueFingerprintStats: {
    eligibleCharacterCount: 0,
  },
  worldStateSummary: {
    trackedEntityCount: 0,
  },
  recentWorldStateAlerts: [],
  recallSummary: {
    analyzedChapterCount: 0,
  },
  recentRecallAlerts: [],
  chapterFunctionSummary: {
    trackedChapterCount: 0,
  },
  chapterFunctionAlerts: [],
  recentEndgameDebtAlerts: [],
  productionReadiness: {
    status: 'ready',
    summary: '浏览器预览数据处于可继续状态。',
    blockers: [],
    warnings: [],
    suggestedActions: ['继续完善故事底盘'],
    readyRate: 86,
    contractBlockerCount: 0,
    writebackPendingCount: 0,
    writebackFailedCount: 0,
    aiRecurrenceHighRiskCount: 0,
    feedbackPauseSuggestedCount: 0,
    consecutiveRecallFallbackChapters: 0,
  },
  batchHealth: {
    status: 'idle',
    chapterIds: [],
    completedChapterCount: 0,
    failedChapterCount: 0,
    warningCount: 0,
    rewriteTaskCount: 0,
    pendingWritebackCount: 0,
    pendingRevisionCount: 0,
    canContinue: false,
    summary: '当前没有运行中的批量任务。',
  },
  continuityHealth: {
    staleCheckpointCount: 0,
    latestCheckpointChapterGap: 0,
    recallDegradedChapterCount: 0,
    consecutiveRecallFallbackChapters: 0,
    worldConflictCount: 0,
    writebackPendingCount: 0,
    writebackFailedCount: 0,
  },
  contractDelivery: {
    readyRate: 100,
    blockerCount: 0,
    warningCount: 0,
    storyThreadAdvanceRate: 0,
  },
  batchReview: {
    summary: '浏览器预览暂无最近批次。',
    passedChapterCount: 0,
    rewrittenChapterCount: 0,
    failedChapterCount: 0,
    pendingWritebackCount: 0,
  },
  dashboardNotes: [],
  repairMetrics: [],
  repairActionSummary: {
    actionableRiskCount: 0,
    taskActionCount: 0,
    directExecutableActionCount: 0,
    allowDeviationCount: 0,
    topPriorityActions: [],
  },
  novelQualityMetrics: {
    riskOverview: [],
    topRisks: [],
    volumeSummaries: [],
  },
  volumeQualityMetrics: [],
  chapterDetails: [],
  heatmapData: [],
  chapterGateTrend: [],
  chapterGateHeatmap: [],
  chapterGateDriftAlerts: [],
  overallScoreTrend: [],
  aiLikeRateTrend: [],
  volumeLanguageDrift: [],
  volumeStoryDynamics: [],
  repeatedFunctionRuns: [],
  volumeChapterFunctions: [],
  storyArcProgressVolumes: [],
  volumeRecallDiagnostics: [],
  volumeWorldStateStability: [],
}

function createEmptyGlobalLockLibrary(novelId: number): GlobalLockLibrary {
  return {
    novelId,
    lockedCanonFacts: [],
    lockedParagraphs: [],
    lockedStyleRules: [],
    lockedCharacterVoice: [],
    updatedAt: NOW,
  }
}

function createEmptyWritebackCenterData(chapter: Chapter | null): ChapterWritebackCenterData {
  return {
    chapter,
    writebackStatus: normalizeWritebackSyncStatus(undefined),
    runs: [],
    activeRun: null,
    extracts: [],
    diffs: [],
    coverage: [],
  }
}

function createPreviewWritebackRun(chapterId: number): ChapterWritebackRun {
  return {
    id: Math.floor(Date.now() / 1000),
    novelId: 1,
    chapterId,
    status: 'draft',
    triggerSource: 'web-preview',
    summaryText: '浏览器预览环境不会实际写回资产。',
    retryCount: 0,
    sourceChapterVersion: 1,
    startedAt: NOW,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function createEmptyBatchWorkbenchData(novelId: number): BatchWorkbenchData {
  return {
    snapshots: [],
    activeSnapshot: null,
    inspections: [],
    rollbacks: [],
    globalLockLibrary: createEmptyGlobalLockLibrary(novelId),
  }
}

const emptyStructureLinkageSummary = {
  summary: '浏览器预览结构联动暂无缺口。',
  totalGapCount: 0,
  missingChapterContractLabels: [],
  missingSceneContractLabels: [],
  uncoveredChapterLabels: [],
  uncoveredSegmentLabels: [],
  anchorInvalidEventTitles: [],
}

const emptyStats = {
  total: 0,
  protagonistCount: 0,
  openCount: 0,
  inProgressCount: 0,
  blockerCount: 0,
  pendingCount: 0,
  runningCount: 0,
  cancelRequestedCount: 0,
  pausedCount: 0,
  successCount: 0,
  failedCount: 0,
  cancelledCount: 0,
}

const emptyContractAudit = {
  checkedAt: NOW,
  summary: '浏览器预览合同对账通过。',
  blockerCount: 0,
  warningCount: 0,
  passCount: 0,
  items: [],
}

const emptyScoreBreakdown = {
  totalScore: 86,
  continuityScore: 86,
  coherenceScore: 86,
  dialogueVoiceScore: 86,
  hookStrengthScore: 86,
  storyDynamicsScore: 86,
  languageNaturalnessScore: 86,
  styleComplianceScore: 86,
  povBoundaryScore: 86,
  sensoryCoverageScore: 86,
  narrativeRatioScore: 86,
  contractScore: 86,
  hookScore: 86,
  povPurityScore: 86,
  threadProgressScore: 86,
  volumeAlignmentScore: 86,
}

function createPublishCheck(chapterId: number) {
  const chapter = demoChapters.find((item) => item.id === chapterId) ?? demoChapters[0]
  return {
    chapterId: chapter?.id ?? chapterId,
    chapterNum: chapter?.chapterNum ?? 1,
    gateLevel: 'pass',
    ready: true,
    summary: '浏览器预览章节通过发布前检查。',
    blockerCount: 0,
    warningCount: 0,
    rewriteCount: 0,
    staleReasons: [],
    chapterContextVersion: 1,
    novelContextVersion: 1,
    rewriteRecommended: false,
    scoreBreakdown: emptyScoreBreakdown,
    history: [],
    generatedTaskCount: 0,
    checklist: [],
    contractAudit: emptyContractAudit,
    contractValidation: {
      status: 'pass',
      summary: '浏览器预览合同验证通过。',
      itemResults: [],
      rewriteHints: [],
    },
  }
}

const noop = async () => undefined

class WebPreviewReadOnlyError extends Error {
  code = 'WEB_PREVIEW_READ_ONLY'

  constructor(methodName: string) {
    super(`浏览器预览不支持写入操作：${methodName}。请在 NovelForge 桌面端执行。`)
    this.name = 'WebPreviewReadOnlyError'
  }
}

const readOnlyMutation = async (methodName: string): Promise<never> => {
  throw new WebPreviewReadOnlyError(methodName)
}

function createService(serviceName: string, overrides: Partial<BridgeService> = {}): BridgeService {
  return new Proxy(overrides as BridgeService, {
    get(target, property) {
      if (typeof property !== 'string') return Reflect.get(target, property)
      if (property in target) return target[property]
      return createDefaultMethod(serviceName, property)
    },
  })
}

function createDefaultMethod(serviceName: string, methodName: string): BridgeMethod {
  return (...args) => withLocalBackend(
    serviceName,
    methodName,
    args,
    async () => {
      if (/^(query|.*Page)$/i.test(methodName)) return emptyPagedResult

      if (/^(list.*|search.*|get.*History|resolveNameOptions|get.*Options)$/i.test(methodName)) return []

      if (/^(getStats|stats)$/i.test(methodName)) return emptyStats

      if (/^get.*Dashboard$/i.test(methodName)) {
        return {
          tracks: [],
          characterArcs: [],
          relationshipArcs: [],
          summary: {},
        }
      }

      if (/^get.*Summary$/i.test(methodName)) return { total: 0, items: [] }

      if (/^(create|update|delete|clear|save|setDefault|markApplied|resume|cancel|retry|generate|start|batch|upsert|apply|sync|refresh|restore|prepare|run|format)/i.test(methodName)) {
        return readOnlyMutation(`${serviceName}.${methodName}`)
      }

      return null
    },
  )
}

function readJsonFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJsonToStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Browser preview storage can be unavailable in strict privacy modes.
  }
}

function createDefaultWebModelConfig(): WebModelConfig {
  return {
    id: 1,
    name: '浏览器预览模型',
    provider: 'custom',
    modelId: 'web-preview',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 4096,
    maxContextTokens: 32000,
    maxConcurrency: 1,
    isDefault: 1,
    createdAt: NOW,
    apiKeySet: false,
  }
}

function readWebModelConfigs(): WebModelConfig[] {
  const configs = readJsonFromStorage<WebModelConfig[]>(WEB_MODEL_CONFIGS_KEY, [])
  if (!Array.isArray(configs) || configs.length === 0) return [createDefaultWebModelConfig()]
  return configs.map((config, index) => ({
    ...createDefaultWebModelConfig(),
    ...config,
    id: Number(config.id) || index + 1,
    isDefault: config.isDefault === 1 ? 1 : 0,
    apiKeySet: Boolean(config.apiKeySet),
  }))
}

function writeWebModelConfigs(configs: WebModelConfig[]) {
  const hasDefault = configs.some((item) => item.isDefault === 1)
  const normalized = configs.map((config, index) => ({
    ...config,
    isDefault: hasDefault ? (config.isDefault === 1 ? 1 : 0) : (index === 0 ? 1 : 0),
  }))
  writeJsonToStorage(WEB_MODEL_CONFIGS_KEY, normalized)
}

function exposeWebModelConfig(config: WebModelConfig): ModelConfig {
  const { apiKeySet: _apiKeySet, ...publicConfig } = config
  return {
    ...publicConfig,
    apiKey: config.apiKeySet ? MASKED_KEY : '',
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function getTextField(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  return typeof value === 'string' ? value : fallback
}

function getNumberField(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(input[key])
  return Number.isFinite(value) ? value : fallback
}

function resolveApiKeySet(input: Record<string, unknown>, existing?: WebModelConfig): boolean {
  if (!('apiKey' in input)) return Boolean(existing?.apiKeySet)
  const value = input.apiKey
  if (value === MASKED_KEY) return Boolean(existing?.apiKeySet)
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)
}

function buildWebModelConfig(input: unknown, existing?: WebModelConfig): WebModelConfig {
  const record = asRecord(input)
  const fallback = existing ?? createDefaultWebModelConfig()
  return {
    id: fallback.id,
    name: getTextField(record, 'name', fallback.name),
    provider: getTextField(record, 'provider', fallback.provider),
    modelId: getTextField(record, 'modelId', fallback.modelId),
    baseUrl: getTextField(record, 'baseUrl', fallback.baseUrl || ''),
    temperature: getNumberField(record, 'temperature', fallback.temperature),
    maxTokens: getNumberField(record, 'maxTokens', fallback.maxTokens),
    maxContextTokens: 'maxContextTokens' in record
      ? getNumberField(record, 'maxContextTokens', fallback.maxContextTokens || 32000)
      : fallback.maxContextTokens,
    maxConcurrency: getNumberField(record, 'maxConcurrency', fallback.maxConcurrency),
    isDefault: fallback.isDefault,
    extraParamsJson: getTextField(record, 'extraParamsJson', fallback.extraParamsJson || ''),
    createdAt: fallback.createdAt || new Date().toISOString(),
    apiKeySet: resolveApiKeySet(record, fallback),
  }
}

function normalizeSourceProvider(value: unknown): SourceSearchProviderMode {
  if (value === 'tavily' || value === 'brave' || value === 'disabled') return value
  return 'auto'
}

function readWebSourceSearchSettings(): WebSourceSearchSettings {
  const settings = readJsonFromStorage<WebSourceSearchSettings>(WEB_SOURCE_SEARCH_KEY, {
    provider: 'auto',
    tavilyApiKeySet: false,
    braveApiKeySet: false,
    updatedAt: NOW,
  })
  return {
    provider: normalizeSourceProvider(settings.provider),
    tavilyApiKeySet: Boolean(settings.tavilyApiKeySet),
    braveApiKeySet: Boolean(settings.braveApiKeySet),
    updatedAt: settings.updatedAt || NOW,
  }
}

function exposeWebSourceSearchSettings(settings: WebSourceSearchSettings): SourceSearchSettingsView {
  const activeProvider = settings.provider === 'disabled'
    ? null
    : settings.provider === 'tavily'
      ? (settings.tavilyApiKeySet ? 'tavily' : null)
      : settings.provider === 'brave'
        ? (settings.braveApiKeySet ? 'brave' : null)
        : settings.tavilyApiKeySet
          ? 'tavily'
          : settings.braveApiKeySet
            ? 'brave'
            : null

  return {
    provider: settings.provider,
    tavilyApiKeySet: settings.tavilyApiKeySet,
    braveApiKeySet: settings.braveApiKeySet,
    tavilyEnvSet: false,
    braveEnvSet: false,
    activeProvider,
    updatedAt: settings.updatedAt,
  }
}

function resolveSavedKeyFlag(current: boolean, value: unknown): boolean {
  if (value === undefined || value === MASKED_KEY) return current
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)
}

class LocalBackendUnavailableError extends Error {
  constructor(message = 'Local backend unavailable') {
    super(message)
    this.name = 'LocalBackendUnavailableError'
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rememberLocalBackendError(message: string, error?: unknown) {
  localBackendLastError = error == null ? message : `${message}: ${describeError(error)}`
  localBackendStatus = 'unavailable'
  console.warn(`[local-backend] ${localBackendLastError}`)
}

function getLocalBackendUnavailableMessage() {
  return localBackendLastError
    ? `本地后端未连接：${localBackendLastError}。请确认 npm run dev:web 正在运行，并刷新页面。`
    : '本地后端未连接，请运行 npm run dev:web 后再测试。'
}

async function getLocalBackendStatus() {
  if (backendCheckPromise) {
    await backendCheckPromise
    backendCheckPromise = null
  } else if (localBackendStatus !== 'connected' && await checkBackendHealth()) {
    localBackendLastError = ''
    localBackendStatus = 'connected'
  }

  return {
    isWebPreview: true,
    status: localBackendStatus,
    connected: localBackendStatus === 'connected',
    lastError: localBackendLastError,
    message: localBackendStatus === 'unavailable' ? getLocalBackendUnavailableMessage() : '',
    capabilities: {
      realDatabase: localBackendStatus === 'connected',
      writesEnabled: localBackendStatus === 'connected',
      generationEnabled: localBackendStatus === 'connected',
      eventStreaming: localBackendStatus === 'connected',
    },
    demoFallbackEnabled: isDemoFallbackEnabled(),
  }
}

function toBackendError(payload: { code?: unknown; message?: unknown; detail?: unknown }) {
  const message = typeof payload.message === 'string' ? payload.message : '本地后端执行失败'
  const error = new Error(message) as Error & { code?: string; detail?: string }
  error.name = 'LocalBackendError'
  if (typeof payload.code === 'string') error.code = payload.code
  if (typeof payload.detail === 'string') error.detail = payload.detail
  return error
}

async function callLocalBackend<T>(service: string, method: string, args: unknown[] = []): Promise<T> {
  if (backendCheckPromise) {
    await backendCheckPromise
    backendCheckPromise = null
  }

  let response: Response
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), LOCAL_BACKEND_RPC_TIMEOUT_MS)
  try {
    response = await fetch(`${LOCAL_BACKEND_URL}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, method, args }),
      signal: controller.signal,
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError'
    rememberLocalBackendError(timedOut ? `本地后端请求超时：${service}.${method}` : '无法请求 /rpc', error)
    throw new LocalBackendUnavailableError(
      timedOut ? `${service}.${method} 请求超时，请检查本地后端状态` : undefined,
    )
  } finally {
    window.clearTimeout(timeout)
  }

  if (response.status === 404) {
    rememberLocalBackendError(`本地后端未实现接口 ${service}.${method}`)
    throw new LocalBackendUnavailableError(`${service}.${method} is not implemented by local backend`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    rememberLocalBackendError('本地后端返回了非 JSON 响应', error)
    throw new LocalBackendUnavailableError('Local backend returned a non-JSON response')
  }

  const record = asRecord(payload)
  if (record.ok === true) {
    localBackendLastError = ''
    localBackendStatus = 'connected'
    return record.data as T
  }

  if (record.ok === false && record.error && typeof record.error === 'object') {
    throw toBackendError(record.error as { code?: unknown; message?: unknown; detail?: unknown })
  }

  rememberLocalBackendError('本地后端返回格式无效')
  throw new LocalBackendUnavailableError('Local backend returned an invalid response')
}

async function withLocalBackend<T>(
  service: string,
  method: string,
  args: unknown[],
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await callLocalBackend<T>(service, method, args)
  } catch (error) {
    if (error instanceof LocalBackendUnavailableError && isDemoFallbackEnabled()) return fallback()
    throw error
  }
}

function getNovelById(id: number): Novel | null {
  return demoNovels.find((novel) => novel.id === id) ?? demoNovels[0] ?? null
}

function installMarker(): boolean {
  const globalWindow = window as unknown as Window & Record<string, unknown>
  if (globalWindow[WEB_BRIDGE_MARKER]) return false
  globalWindow[WEB_BRIDGE_MARKER] = true
  return true
}

export function installWebElectronBridge(): void {
  if (typeof window === 'undefined') return
  if (typeof window.electron?.novel?.list === 'function') return
  if (!installMarker()) return

  backendCheckPromise = waitForBackend()

  const bridge = {
    windowControls: {
      minimize: noop,
      toggleMaximize: async () => false,
      close: noop,
      isMaximized: async () => false,
      onMaximizedStateChange: () => () => undefined,
    },
    on: (channel: string, callback: (...args: unknown[]) => void) => subscribeWebEvent(channel, callback),
    off: (channel: string, callback: (...args: unknown[]) => void) => unsubscribeWebEvent(channel, callback),
    novel: createService('novel', {
      // 读取优先走本地后端（真实数据库）；演示数据必须通过 ?demo=1 显式开启。
      list: async (filters?: unknown) => withLocalBackend('novel', 'list', [filters], async () => demoNovels),
      get: async (id) => withLocalBackend('novel', 'get', [id], async () => getNovelById(Number(id))),
      create: (...args) => withLocalBackend('novel', 'create', args, async () => readOnlyMutation('novel.create')),
      update: (...args) => withLocalBackend('novel', 'update', args, async () => readOnlyMutation('novel.update')),
      delete: (...args) => withLocalBackend('novel', 'delete', args, async () => readOnlyMutation('novel.delete')),
      export: (...args) => withLocalBackend('novel', 'export', args, async () => readOnlyMutation('novel.export')),
      formatForPlatform: (...args) => withLocalBackend('novel', 'formatForPlatform', args, async () => readOnlyMutation('novel.formatForPlatform')),
      stats: async (id) => withLocalBackend('novel', 'stats', [id], async () => {
        const novel = getNovelById(Number(id))
        return {
          totalChapters: novel ? Math.max(1, Math.round(novel.totalWords / 3200)) : 0,
          completedChapters: novel ? Math.max(0, Math.round(novel.totalWords / 4800)) : 0,
          totalWords: novel?.totalWords ?? 0,
          characterCount: novel ? 3 : 0,
        }
      }),
      getContextStatus: async (id) => withLocalBackend('novel', 'getContextStatus', [id], async () => ({
        novelId: Number(id),
        totalChapterCount: demoChapters.length,
        staleChapterCount: 0,
        staleChapterIds: [],
        contextVersion: getNovelById(Number(id))?.contextVersion || 1,
        staleCheckpointCount: 0,
        staleAssetCount: 0,
        staleAssetKeys: [],
        staleAssetLabels: [],
        pendingImpactCount: 0,
        pendingManualConfirmationCount: 0,
        latestImpactEventAt: null,
      })),
      runConsistencyCheck: async (id) => withLocalBackend('novel', 'runConsistencyCheck', [id], async () => ({
        generatedAt: NOW,
        readinessScore: 82,
        overview: '浏览器预览数据未发现一致性问题。',
        issueCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        focusAreas: [],
        metrics: {
          chapterCount: demoChapters.length,
          chaptersMissingSummary: 0,
          chaptersMissingContinuity: 0,
          timelineCount: 0,
          linkedTimelineCount: 0,
          itemCount: 0,
          bidirectionalLinkCount: 0,
          writingContractTagCount: 0,
          protagonistRelationCount: 0,
          styledRelationCount: 0,
          subtextRelationCount: 0,
          ratedRelationCount: 0,
          worldStateTrackedEntityCount: 0,
          worldStateDriftAlertCount: 0,
          worldStateConflictAlertCount: 0,
        },
        issues: [],
      })),
      getStoryMemory: async (id) => withLocalBackend('novel', 'getStoryMemory', [id], async () => ({
        generatedAt: NOW,
        chapterCount: demoChapters.length,
        lastChapterNum: 1,
        memoryMode: 'standard',
        coverageSummary: '浏览器预览记忆覆盖首章草稿。',
        phaseDigest: ['旧档案馆夜班', '错档案出现'],
        plotMilestones: ['主角发现错档案与童年照片重叠'],
        arcSignals: [],
        characterLedger: [],
        characterCurrentStates: [],
        characterStateAlerts: [],
        worldCurrentStates: [],
        worldStateAlerts: [],
        worldStateOverview: {},
        worldConflictEntities: [],
        characterStateTrendSummary: [],
        worldStateTrendSummary: [],
        worldLedger: [],
        activeThreads: ['旧城失踪案', '主角童年缺口'],
        continuityDirectives: [],
        timelineAnchors: ['雨夜档案馆'],
        itemLedger: ['编号错误的档案袋'],
      })),
      getImpactSummary: async (id) => withLocalBackend('novel', 'getImpactSummary', [id], async () => ({ totalEvents: 0, affectedAssets: [] })),
      listImpactEvents: async (id) => withLocalBackend('novel', 'listImpactEvents', [id], async () => []),
    }),
    template: createService('template', {
      list: async (type?: unknown) => withLocalBackend('template', 'list', [type], async () => {
        if (typeof type !== 'string') return demoTemplates
        return demoTemplates.filter((template) => template.type === type)
      }),
    }),
    model: createService('model', {
      list: async () => withLocalBackend('model', 'list', [], async () => readWebModelConfigs().map(exposeWebModelConfig)),
      create: async (data?: unknown) => withLocalBackend('model', 'create', [data], async () => {
        const configs = readWebModelConfigs()
        const nextIdValue = configs.reduce((maxId, config) => Math.max(maxId, Number(config.id) || 0), 0) + 1
        const nextConfig = {
          ...buildWebModelConfig(data),
          id: nextIdValue,
          createdAt: new Date().toISOString(),
          isDefault: configs.length === 0 ? 1 : 0,
        }
        writeWebModelConfigs([...configs, nextConfig])
        return nextIdValue
      }),
      update: async (id?: unknown, data?: unknown) => withLocalBackend('model', 'update', [id, data], async () => {
        const targetId = Number(id)
        const configs = readWebModelConfigs()
        const nextConfigs = configs.map((config) => (
          config.id === targetId
            ? { ...buildWebModelConfig(data, config), id: config.id, isDefault: config.isDefault }
            : config
        ))
        writeWebModelConfigs(nextConfigs)
      }),
      delete: async (id?: unknown) => withLocalBackend('model', 'delete', [id], async () => {
        const targetId = Number(id)
        const nextConfigs = readWebModelConfigs().filter((config) => config.id !== targetId)
        writeWebModelConfigs(nextConfigs)
      }),
      setDefault: async (id?: unknown) => withLocalBackend('model', 'setDefault', [id], async () => {
        const targetId = Number(id)
        const nextConfigs = readWebModelConfigs().map((config) => ({
          ...config,
          isDefault: config.id === targetId ? 1 : 0,
        }))
        writeWebModelConfigs(nextConfigs)
      }),
      test: async (id?: unknown) => withLocalBackend('model', 'test', [id], async () => ({
        success: false,
        latency: 0,
        info: getLocalBackendUnavailableMessage(),
      })),
    }),
    sourceSearch: createService('sourceSearch', {
      getSettings: async () => withLocalBackend(
        'sourceSearch',
        'getSettings',
        [],
        async () => exposeWebSourceSearchSettings(readWebSourceSearchSettings()),
      ),
      updateSettings: async (data?: unknown) => withLocalBackend('sourceSearch', 'updateSettings', [data], async () => {
        const current = readWebSourceSearchSettings()
        const record = asRecord(data)
        const nextSettings: WebSourceSearchSettings = {
          provider: normalizeSourceProvider(record.provider ?? current.provider),
          tavilyApiKeySet: resolveSavedKeyFlag(current.tavilyApiKeySet, record.tavilyApiKey),
          braveApiKeySet: resolveSavedKeyFlag(current.braveApiKeySet, record.braveApiKey),
          updatedAt: new Date().toISOString(),
        }
        writeJsonToStorage(WEB_SOURCE_SEARCH_KEY, nextSettings)
        return exposeWebSourceSearchSettings(nextSettings)
      }),
      test: async () => withLocalBackend('sourceSearch', 'test', [], async () => ({
        success: false,
        providerName: null,
        latency: 0,
        info: getLocalBackendUnavailableMessage(),
      })),
    }),
    ai: createService('ai', {
      runPrompt: async (data?: unknown) => withLocalBackend('ai', 'runPrompt', [data], async () => {
        throw new Error(getLocalBackendUnavailableMessage())
      }),
    }),
    aiPatch: createService('aiPatch', {
      suggest: async (request?: unknown) => withLocalBackend('aiPatch', 'suggest', [request], async () => {
        throw new Error(getLocalBackendUnavailableMessage())
      }),
      apply: async (target?: unknown, patch?: unknown) => withLocalBackend('aiPatch', 'apply', [target, patch], async () => {
        throw new Error(getLocalBackendUnavailableMessage())
      }),
    }),
    embedding: createService('embedding', {
      reindex: async (novelId?: unknown) => withLocalBackend('embedding', 'reindex', [novelId], async () => {
        throw new Error(getLocalBackendUnavailableMessage())
      }),
    }),
    style: createService('style', {
      analyze: async (text?: unknown, modelConfigId?: unknown) => withLocalBackend('style', 'analyze', [text, modelConfigId], async () => null),
      create: async (novelId?: unknown, name?: unknown, text?: unknown, modelConfigId?: unknown) => withLocalBackend('style', 'create', [novelId, name, text, modelConfigId], async () => null),
      createFromChapters: async (novelId?: unknown, name?: unknown, chapterIds?: unknown, modelConfigId?: unknown) => withLocalBackend('style', 'createFromChapters', [novelId, name, chapterIds, modelConfigId], async () => null),
      get: async (id?: unknown) => withLocalBackend('style', 'get', [id], async () => null),
      list: async (novelId?: unknown) => withLocalBackend('style', 'list', [novelId], async () => []),
      delete: async (id?: unknown) => withLocalBackend('style', 'delete', [id], async () => undefined),
      setActive: async (novelId?: unknown, fingerprintId?: unknown) => withLocalBackend('style', 'setActive', [novelId, fingerprintId], async () => undefined),
      resolveActive: async (novelId?: unknown) => withLocalBackend('style', 'resolveActive', [novelId], async () => null),
      abTest: async (novelId?: unknown, fingerprintId?: unknown, sceneBrief?: unknown, modelConfigId?: unknown) => withLocalBackend('style', 'abTest', [novelId, fingerprintId, sceneBrief, modelConfigId], async () => null),
    }),
    parallel: createService('parallel', {
      analyzePlan: async (novelId?: unknown, chapterStart?: unknown, chapterEnd?: unknown) => withLocalBackend('parallel', 'analyzePlan', [novelId, chapterStart, chapterEnd], async () => null),
      getWorldState: async (novelId?: unknown, atChapterNum?: unknown) => withLocalBackend('parallel', 'getWorldState', [novelId, atChapterNum], async () => null),
      mergeOutputs: async (segments?: unknown) => withLocalBackend('parallel', 'mergeOutputs', [segments], async () => null),
    }),
    prompt: createService('prompt', {
      list: async () => withLocalBackend('prompt', 'list', [], async () => []),
    }),
    task: createService('task', {
      list: async (novelId?: unknown) => withLocalBackend('task', 'list', [novelId], async () => []),
      query: async (filters?: unknown) => withLocalBackend('task', 'query', [filters], async () => emptyPagedResult),
      getStats: async (novelId?: unknown) => withLocalBackend('task', 'getStats', [novelId], async () => emptyStats),
      getPipelineStats: async (novelId?: unknown) => withLocalBackend('task', 'getPipelineStats', [novelId], async () => emptyPipelineStats),
      getLatestChapterPipeline: async (chapterId?: unknown) => withLocalBackend('task', 'getLatestChapterPipeline', [chapterId], async () => null),
      get: async (id?: unknown) => withLocalBackend('task', 'get', [id], async () => null),
      cancel: (...args) => withLocalBackend('task', 'cancel', args, async () => readOnlyMutation('task.cancel')),
    }),
    workflow: createService('workflow', {
      list: async (novelId?: unknown) => withLocalBackend('workflow', 'list', [novelId], async () => []),
      get: async (id?: unknown) => withLocalBackend('workflow', 'get', [id], async () => null),
    }),
    workflowNode: createService('workflowNode', {
      list: async (filters?: unknown) => withLocalBackend('workflowNode', 'list', [filters], async () => []),
      get: async (id?: unknown) => withLocalBackend('workflowNode', 'get', [id], async () => null),
      getSnapshot: async (id?: unknown) => withLocalBackend('workflowNode', 'getSnapshot', [id], async () => null),
      retry: async (id?: unknown) => withLocalBackend('workflowNode', 'retry', [id], async () => {
        throw new Error(getLocalBackendUnavailableMessage())
      }),
    }),
    structure: createService('structure', {
      getTree: async (novelId?: unknown) => withLocalBackend('structure', 'getTree', [novelId], async () => ({ volumes: [] })),
      listVolumes: async (novelId?: unknown) => withLocalBackend('structure', 'listVolumes', [novelId], async () => []),
      listPartsPage: async (volumeId?: unknown, page?: unknown, pageSize?: unknown) => withLocalBackend('structure', 'listPartsPage', [volumeId, page, pageSize], async () => emptyPagedResult),
      listChaptersPage: async (partId?: unknown, page?: unknown, pageSize?: unknown) => withLocalBackend('structure', 'listChaptersPage', [partId, page, pageSize], async () => emptyPagedResult),
      listSegments: async (chapterId?: unknown) => withLocalBackend('structure', 'listSegments', [chapterId], async () => []),
      getSegment: async (id?: unknown) => withLocalBackend('structure', 'getSegment', [id], async () => null),
      listSegmentsPage: async (chapterId?: unknown, page?: unknown, pageSize?: unknown) => withLocalBackend('structure', 'listSegmentsPage', [chapterId, page, pageSize], async () => emptyPagedResult),
      listCheckpoints: async (novelId?: unknown) => withLocalBackend('structure', 'listCheckpoints', [novelId], async () => []),
      listCheckpointsPage: async (filters?: unknown, page?: unknown, pageSize?: unknown) => withLocalBackend('structure', 'listCheckpointsPage', [filters, page, pageSize], async () => emptyPagedResult),
      listLinkedTimelineEvents: async (filters?: unknown) => withLocalBackend('structure', 'listLinkedTimelineEvents', [filters], async () => []),
      listLinkedTimelineEventsPage: async (filters?: unknown, page?: unknown, pageSize?: unknown) => withLocalBackend('structure', 'listLinkedTimelineEventsPage', [filters, page, pageSize], async () => emptyPagedResult),
      resolvePath: async (filters?: unknown) => withLocalBackend('structure', 'resolvePath', [filters], async () => null),
      getLinkageSummary: async (novelId?: unknown) => withLocalBackend('structure', 'getLinkageSummary', [novelId], async () => emptyStructureLinkageSummary),
      syncLinkage: (...args) => withLocalBackend('structure', 'syncLinkage', args, async () => readOnlyMutation('structure.syncLinkage')),
      clear: (...args) => withLocalBackend('structure', 'clear', args, async () => readOnlyMutation('structure.clear')),
    }),
    character: createService('character', {
      list: async (novelId?: unknown) => withLocalBackend('character', 'list', [novelId], async () => []),
      query: async (filters?: unknown) => withLocalBackend('character', 'query', [filters], async () => emptyPagedResult),
      search: async (novelId?: unknown, keyword?: unknown, limit?: unknown) => withLocalBackend('character', 'search', [novelId, keyword, limit], async () => []),
      get: async (id?: unknown) => withLocalBackend('character', 'get', [id], async () => null),
      getDetailContext: async (characterId?: unknown) => withLocalBackend('character', 'getDetailContext', [characterId], async () => null),
      getRelations: async (novelId?: unknown) => withLocalBackend('character', 'getRelations', [novelId], async () => []),
      getStats: async (filters?: unknown) => withLocalBackend('character', 'getStats', [filters], async () => ({ ...emptyStats, total: 3, protagonistCount: 1 })),
      getFilterOptions: async (novelId?: unknown) => withLocalBackend('character', 'getFilterOptions', [novelId], async () => ({ species: [], entityTypes: [] })),
      getGraph: async (filters?: unknown) => withLocalBackend('character', 'getGraph', [filters], async () => ({ characters: [], relations: [] })),
    }),
    item: createService('item', {
      list: async (novelId?: unknown) => withLocalBackend('item', 'list', [novelId], async () => []),
      search: async (novelId?: unknown, keyword?: unknown, itemKind?: unknown, limit?: unknown) => withLocalBackend('item', 'search', [novelId, keyword, itemKind, limit], async () => []),
      query: async (filters?: unknown) => withLocalBackend('item', 'query', [filters], async () => emptyPagedResult),
      get: async (id?: unknown) => withLocalBackend('item', 'get', [id], async () => null),
      getDetailContext: async (id?: unknown) => withLocalBackend('item', 'getDetailContext', [id], async () => null),
      getStats: async (filters?: unknown) => withLocalBackend('item', 'getStats', [filters], async () => ({ ...emptyStats, total: 2 })),
      getFilterOptions: async (novelId?: unknown) => withLocalBackend('item', 'getFilterOptions', [novelId], async () => ({ categories: [], rarities: [] })),
    }),
    map: createService('map', {
      getTree: async (novelId?: unknown) => withLocalBackend('map', 'getTree', [novelId], async () => []),
      queryNodes: async (filters?: unknown) => withLocalBackend('map', 'queryNodes', [filters], async () => emptyPagedResult),
      getStats: async (novelId?: unknown) => withLocalBackend('map', 'getStats', [novelId], async () => ({ ...emptyStats, total: 2 })),
      getNode: async (id?: unknown) => withLocalBackend('map', 'getNode', [id], async () => null),
      searchNodes: async (novelId?: unknown, keyword?: unknown, limit?: unknown) => withLocalBackend('map', 'searchNodes', [novelId, keyword, limit], async () => []),
      getRelations: async (novelId?: unknown, focusNodeId?: unknown) => withLocalBackend('map', 'getRelations', [novelId, focusNodeId], async () => []),
      getGraph: async (filters?: unknown) => withLocalBackend('map', 'getGraph', [filters], async () => ({ nodes: [], edges: [], relationNodeIds: [], rootNodeIds: [] })),
      getLatestAutoGenerateTask: async (novelId?: unknown) => withLocalBackend('map', 'getLatestAutoGenerateTask', [novelId], async () => null),
      getAutoGenerateStatus: async (taskId?: unknown) => withLocalBackend('map', 'getAutoGenerateStatus', [taskId], async () => null),
    }),
    creativeStage: createService('creativeStage', {
      list: async (novelId?: unknown, includeArchived?: unknown) => withLocalBackend('creativeStage', 'list', [novelId, includeArchived], async () => []),
      get: async (stageId?: unknown) => withLocalBackend('creativeStage', 'get', [stageId], async () => null),
      listAssets: async (stageId?: unknown) => withLocalBackend('creativeStage', 'listAssets', [stageId], async () => []),
      getContext: async (novelId?: unknown, stageId?: unknown, chapterNum?: unknown) => withLocalBackend('creativeStage', 'getContext', [novelId, stageId, chapterNum], async () => null),
      listHandoffs: async (novelId?: unknown, stageId?: unknown) => withLocalBackend('creativeStage', 'listHandoffs', [novelId, stageId], async () => []),
      create: (...args) => withLocalBackend('creativeStage', 'create', args, async () => readOnlyMutation('creativeStage.create')),
      update: (...args) => withLocalBackend('creativeStage', 'update', args, async () => readOnlyMutation('creativeStage.update')),
      archive: (...args) => withLocalBackend('creativeStage', 'archive', args, async () => readOnlyMutation('creativeStage.archive')),
      upsertAsset: (...args) => withLocalBackend('creativeStage', 'upsertAsset', args, async () => readOnlyMutation('creativeStage.upsertAsset')),
      removeAsset: (...args) => withLocalBackend('creativeStage', 'removeAsset', args, async () => readOnlyMutation('creativeStage.removeAsset')),
      createHandoff: (...args) => withLocalBackend('creativeStage', 'createHandoff', args, async () => readOnlyMutation('creativeStage.createHandoff')),
      reviewHandoff: (...args) => withLocalBackend('creativeStage', 'reviewHandoff', args, async () => readOnlyMutation('creativeStage.reviewHandoff')),
      approveHandoff: (...args) => withLocalBackend('creativeStage', 'approveHandoff', args, async () => readOnlyMutation('creativeStage.approveHandoff')),
    }),
    faction: createService('faction', {
      list: async (novelId?: unknown) => withLocalBackend('faction', 'list', [novelId], async () => []),
      query: async (filters?: unknown) => withLocalBackend('faction', 'query', [filters], async () => emptyPagedResult),
      getStats: async (filters?: unknown) => withLocalBackend('faction', 'getStats', [filters], async () => ({ ...emptyStats, total: 1 })),
      get: async (id?: unknown) => withLocalBackend('faction', 'get', [id], async () => null),
      search: async (novelId?: unknown, keyword?: unknown, limit?: unknown) => withLocalBackend('faction', 'search', [novelId, keyword, limit], async () => []),
      getGraph: async (filters?: unknown) => withLocalBackend('faction', 'getGraph', [filters], async () => ({ nodes: [], edges: [], unalignedCharacters: [] })),
    }),
    glossary: createService('glossary', {
      list: async (novelId?: unknown) => withLocalBackend('glossary', 'list', [novelId], async () => []),
      query: async (filters?: unknown) => withLocalBackend('glossary', 'query', [filters], async () => emptyPagedResult),
      getStats: async (filters?: unknown) => withLocalBackend('glossary', 'getStats', [filters], async () => ({ ...emptyStats, total: 4 })),
      get: async (id?: unknown) => withLocalBackend('glossary', 'get', [id], async () => null),
      search: async (novelId?: unknown, keyword?: unknown, limit?: unknown) => withLocalBackend('glossary', 'search', [novelId, keyword, limit], async () => []),
      scanReferences: async (novelId?: unknown) => withLocalBackend('glossary', 'scanReferences', [novelId], async () => readOnlyMutation('glossary.scanReferences')),
      usageReport: async (novelId?: unknown) => withLocalBackend('glossary', 'usageReport', [novelId], async () => ({ novelId: 0, latestChapterNum: 0, items: [] })),
    }),
    thread: createService('thread', {
      list: async (novelId?: unknown) => withLocalBackend('thread', 'list', [novelId], async () => []),
      query: async (filters?: unknown) => withLocalBackend('thread', 'query', [filters], async () => emptyPagedResult),
      get: async (id?: unknown) => withLocalBackend('thread', 'get', [id], async () => null),
      getStats: async (filters?: unknown) => withLocalBackend('thread', 'getStats', [filters], async () => ({ ...emptyStats, total: 3 })),
      getForeshadowSnapshot: async (novelId?: unknown, chapterNum?: unknown) => withLocalBackend(
        'thread',
        'getForeshadowSnapshot',
        [novelId, chapterNum],
        async () => ({
          currentChapterNum: 0,
          pending: [],
          dueSoon: [],
          resolved: [],
          overdue: [],
        }),
      ),
    }),
    sceneTemplate: createService('sceneTemplate', {
      list: async (filters?: unknown) => withLocalBackend('sceneTemplate', 'list', [filters], async () => []),
      query: async (filters?: unknown) => withLocalBackend('sceneTemplate', 'query', [filters], async () => emptyPagedResult),
      getStats: async (filters?: unknown) => withLocalBackend('sceneTemplate', 'getStats', [filters], async () => ({ ...emptyStats, total: 2 })),
      get: async (id?: unknown) => withLocalBackend('sceneTemplate', 'get', [id], async () => null),
      search: async (novelId?: unknown, genreId?: unknown, keyword?: unknown, limit?: unknown) => withLocalBackend('sceneTemplate', 'search', [novelId, genreId, keyword, limit], async () => []),
    }),
    revision: createService('revision', {
      getStats: async (filters?: unknown) => withLocalBackend('revision', 'getStats', [filters], async () => ({ ...emptyStats, openCount: 0, inProgressCount: 0, blockerCount: 0 })),
      getSnapshot: async (novelId?: unknown) => withLocalBackend('revision', 'getSnapshot', [novelId], async () => ({ tasks: [], blockers: [] })),
    }),
    outline: createService('outline', {
      getArcs: async (novelId?: unknown) => withLocalBackend('outline', 'getArcs', [novelId], async () => [{
        id: 1,
        novelId: 1,
        arcName: '第一卷：错档案',
        arcOrder: 1,
        chapterStart: 1,
        chapterEnd: 12,
        arcGoal: '从错误档案切入旧城案件。',
        arcSummary: '主角先确认档案异常，再追到旧城失踪案的第一条可验证线索。',
        growthLedger: '',
        costLedger: '',
      }]),
      getArcProgressSnapshot: async (novelId?: unknown) => withLocalBackend('outline', 'getArcProgressSnapshot', [novelId], async () => ({ arcs: [], chapterPoints: [] })),
      generateArcs: async (novelId?: unknown) => withLocalBackend('outline', 'generateArcs', [novelId], async () => readOnlyMutation('outline.generateArcs')),
      generateChapterOutlines: async (arcId?: unknown, options?: unknown) => withLocalBackend('outline', 'generateChapterOutlines', [arcId, options], async () => readOnlyMutation('outline.generateChapterOutlines')),
    }),
    rhythm: createService('rhythm', {
      listTemplates: async (novelId?: unknown) => withLocalBackend('rhythm', 'listTemplates', [novelId], async () => []),
      attachToArc: async (arcId?: unknown, templateKey?: unknown) => withLocalBackend('rhythm', 'attachToArc', [arcId, templateKey], async () => readOnlyMutation('rhythm.attachToArc')),
    }),
    timeline: createService('timeline', {
      list: async (novelId?: unknown) => withLocalBackend('timeline', 'list', [novelId], async () => []),
      query: async (filters?: unknown) => withLocalBackend('timeline', 'query', [filters], async () => emptyPagedResult),
      getStats: async (filters?: unknown) => withLocalBackend('timeline', 'getStats', [filters], async () => ({ ...emptyStats, total: 5 })),
      getFilterOptions: async (novelId?: unknown) => withLocalBackend('timeline', 'getFilterOptions', [novelId], async () => ({ eventTypes: [], statuses: [], volumes: [], parts: [] })),
    }),
    characterArc: createService('characterArc', {
      listCharacterArcs: async (novelId?: unknown) => withLocalBackend('characterArc', 'listCharacterArcs', [novelId], async () => []),
      getCharacterArc: async (arcId?: unknown) => withLocalBackend('characterArc', 'getCharacterArc', [arcId], async () => null),
      listRelationshipArcs: async (novelId?: unknown) => withLocalBackend('characterArc', 'listRelationshipArcs', [novelId], async () => []),
      getArcDashboard: async (novelId?: unknown) => withLocalBackend('characterArc', 'getArcDashboard', [novelId], async () => ({
        characterArcs: [{ id: 1, characterId: 1, title: '从逃避到承担' }],
        relationshipArcs: [],
      })),
    }),
    resistance: createService('resistance', {
      listTracks: async (novelId?: unknown) => withLocalBackend('resistance', 'listTracks', [novelId], async () => []),
      getTrack: async (trackId?: unknown) => withLocalBackend('resistance', 'getTrack', [trackId], async () => null),
      getDashboard: async (novelId?: unknown) => withLocalBackend('resistance', 'getDashboard', [novelId], async () => ({
        tracks: [],
        characterTracks: [],
        factionTracks: [],
        environmentTracks: [],
        institutionTracks: [],
        availableCharacters: [],
        availableFactions: [],
        chapters: demoChapters.map((chapter) => ({ id: chapter.id, chapterNum: chapter.chapterNum, title: chapter.title })),
        timelineEvents: [],
        volumes: [],
        activeTrackCount: 0,
        stalledTrackCount: 0,
        resolvedTrackCount: 0,
      })),
    }),
    endgameAsset: createService('endgameAsset', {
      listCommitments: async (novelId?: unknown) => withLocalBackend('endgameAsset', 'listCommitments', [novelId], async () => []),
      getSummary: async (novelId?: unknown) => withLocalBackend('endgameAsset', 'getSummary', [novelId], async () => ({ total: 0, fulfilled: 0, pending: 0 })),
    }),
    foreshadow: createService('foreshadow', {
      listLedger: async (novelId?: unknown) => withLocalBackend('foreshadow', 'listLedger', [novelId], async () => []),
    }),
    volumeDesign: createService('volumeDesign', {
      list: async (novelId?: unknown) => withLocalBackend('volumeDesign', 'list', [novelId], async () => []),
      getByVolume: async (volumeId?: unknown) => withLocalBackend('volumeDesign', 'getByVolume', [volumeId], async () => null),
    }),
    contract: createService('contract', {
      getChapter: async (chapterId?: unknown) => withLocalBackend('contract', 'getChapter', [chapterId], async () => null),
      listScenes: async (chapterId?: unknown) => withLocalBackend('contract', 'listScenes', [chapterId], async () => []),
    }),
    storyFact: createService('storyFact', {
      list: async (novelId?: unknown) => withLocalBackend('storyFact', 'list', [novelId], async () => []),
      get: async (id?: unknown) => withLocalBackend('storyFact', 'get', [id], async () => null),
    }),
    growthSystem: createService('growthSystem', {
      getDashboard: async (novelId?: unknown) => withLocalBackend('growthSystem', 'getDashboard', [novelId], async () => ({
        tracks: [],
        pools: [],
        events: [],
        chapters: demoChapters.map((chapter) => ({ id: chapter.id, chapterNum: chapter.chapterNum, title: chapter.title })),
        volumes: [],
        summary: {
          trackCount: 0,
          characterTrackCount: 0,
          organizationTrackCount: 0,
          relationshipTrackCount: 0,
          criticalPoolCount: 0,
          unresolvedCostCount: 0,
          chapterWritebackCoverage: 0,
        },
      })),
      listTracks: async (novelId?: unknown) => withLocalBackend('growthSystem', 'listTracks', [novelId], async () => []),
      listPools: async (novelId?: unknown) => withLocalBackend('growthSystem', 'listPools', [novelId], async () => []),
      listEvents: async (novelId?: unknown) => withLocalBackend('growthSystem', 'listEvents', [novelId], async () => []),
    }),
    chapter: createService('chapter', {
      list: async (novelId?: unknown) => withLocalBackend('chapter', 'list', [novelId], async () => demoChapters),
      get: async (id) => withLocalBackend(
        'chapter',
        'get',
        [id],
        async () => demoChapters.find((chapter) => chapter.id === Number(id)) ?? demoChapters[0] ?? null,
      ),
      runPublishCheck: async (id) => withLocalBackend('chapter', 'runPublishCheck', [id], async () => createPublishCheck(Number(id))),
    }),
    chapterBatch: createService('chapterBatch', {
      getLatestQualityAnalysisTask: async (novelId?: unknown) => withLocalBackend('chapterBatch', 'getLatestQualityAnalysisTask', [novelId], async () => null),
    }),
    writeback: createService('writeback', {
      listRuns: async (chapterId?: unknown) => withLocalBackend('writeback', 'listRuns', [chapterId], async () => []),
      getCenterData: async (chapterId?: unknown, runId?: unknown) => withLocalBackend('writeback', 'getCenterData', [chapterId, runId], async () => {
        const chapter = demoChapters.find((item) => item.id === Number(chapterId)) ?? null
        return createEmptyWritebackCenterData(chapter)
      }),
      prepareRun: async (chapterId?: unknown, triggerSource?: unknown) => withLocalBackend('writeback', 'prepareRun', [chapterId, triggerSource], async () => createPreviewWritebackRun(Number(chapterId))),
      updateDecision: async (diffId?: unknown, patch?: unknown) => withLocalBackend('writeback', 'updateDecision', [diffId, patch], async () => null),
      bulkUpdateDecisions: async (runId?: unknown, patch?: unknown) => withLocalBackend('writeback', 'bulkUpdateDecisions', [runId, patch], async () => []),
      applyRun: async (runId?: unknown, options?: unknown) => withLocalBackend('writeback', 'applyRun', [runId, options], async () => createEmptyWritebackCenterData(demoChapters[0] ?? null)),
      retryFailed: async (runId?: unknown, options?: unknown) => withLocalBackend('writeback', 'retryFailed', [runId, options], async () => createEmptyWritebackCenterData(demoChapters[0] ?? null)),
    }),
    batchWorkbench: createService('batchWorkbench', {
      getData: async (novelId, snapshotId) => withLocalBackend('batchWorkbench', 'getData', [novelId, snapshotId], async () => createEmptyBatchWorkbenchData(Number(novelId))),
      createInspection: async (snapshotId?: unknown, data?: unknown) => withLocalBackend('batchWorkbench', 'createInspection', [snapshotId, data], async () => null),
      previewRollback: async (snapshotId?: unknown, mode?: unknown) => withLocalBackend('batchWorkbench', 'previewRollback', [snapshotId, mode], async () => ({
        snapshotId: Number(snapshotId),
        mode: typeof mode === 'string' ? mode as BatchRollbackMode : 'chapter_rollback',
        chapterCount: 0,
        affectedChapters: [],
        affectedCounts: {},
        warnings: ['浏览器预览环境没有可回滚的批次快照。'],
      })),
      applyRollback: async (snapshotId?: unknown, mode?: unknown) => withLocalBackend('batchWorkbench', 'applyRollback', [snapshotId, mode], async () => null),
      getGlobalLockLibrary: async (novelId?: unknown) => withLocalBackend('batchWorkbench', 'getGlobalLockLibrary', [novelId], async () => createEmptyGlobalLockLibrary(Number(novelId))),
      updateGlobalLockLibrary: async (novelId?: unknown, patch?: unknown) => withLocalBackend('batchWorkbench', 'updateGlobalLockLibrary', [novelId, patch], async () => ({
        ...createEmptyGlobalLockLibrary(Number(novelId)),
        ...(patch && typeof patch === 'object' ? patch as Partial<GlobalLockLibrary> : {}),
        novelId: Number(novelId),
        updatedAt: NOW,
      })),
    }),
    worldRules: createService('worldRules'),
    subplot: createService('subplot'),
    history: createService('history', {
      listRecent: async (novelId?: unknown, limit?: unknown) => withLocalBackend('history', 'listRecent', [novelId, limit], async () => []),
    }),
    premiseDraft: createService('premiseDraft'),
    planningDraft: createService('planningDraft'),
    app: createService('app', {
      getDatabasePath: async () => withLocalBackend(
        'app',
        'getDatabasePath',
        [],
        async () => 'web-preview://localStorage/novelforge',
      ),
      getMaintenanceStatus: async () => withLocalBackend('app', 'getMaintenanceStatus', [], async () => ({
        state: 'stopped',
        allowRemoteEmbeddings: false,
        outbox: {
          pendingCount: 0,
          retryingCount: 0,
          processingCount: 0,
          deadLetterCount: 0,
        },
        checkpointNovelCursor: 0,
        checkpointRefreshScheduled: 0,
      })),
      getCapabilities: async () => withLocalBackend('app', 'getCapabilities', [], async () => ({
        surface: 'local-web',
        realDatabase: false,
        writesEnabled: false,
        generationEnabled: false,
        eventStreaming: false,
        message: '网页预览后端未连接。',
      })),
      getLocalBackendStatus,
    }),
    agentTools: createService('agentTools', {
      list: async (query?: unknown) => withLocalBackend('agentTools', 'list', [query], async () => []),
      call: async (request?: unknown) => withLocalBackend('agentTools', 'call', [request], async () => {
        throw new Error(getLocalBackendUnavailableMessage())
      }),
      approve: async (request?: unknown) => withLocalBackend('agentTools', 'approve', [request], async () => ({
        approved: false,
        reason: '网页演示模式不发放正式写入授权，请连接本地后端。',
      })),
    }),
    quality: createService('quality', {
      getDashboard: async (novelId?: unknown) => withLocalBackend('quality', 'getDashboard', [novelId], async () => emptyQualityDashboard),
    }),
  }

  window.electron = bridge as unknown as Window['electron']
}
