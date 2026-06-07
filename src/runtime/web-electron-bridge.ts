import type {
  BatchRollbackMode,
  BatchWorkbenchData,
  Chapter,
  ChapterWritebackCenterData,
  ChapterWritebackRun,
  GlobalLockLibrary,
  Template,
  Novel,
} from '../types'

type BridgeMethod = (...args: unknown[]) => Promise<unknown>
type BridgeService = Record<string, BridgeMethod>

const WEB_BRIDGE_MARKER = '__novalCreateWebBridgeInstalled'
const NOW = '2026-05-24T09:00:00.000Z'

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
const nextId = async () => Math.floor(Date.now() / 1000)

function createService(overrides: Partial<BridgeService> = {}): BridgeService {
  return new Proxy(overrides as BridgeService, {
    get(target, property) {
      if (typeof property !== 'string') return Reflect.get(target, property)
      if (property in target) return target[property]
      return createDefaultMethod(property)
    },
  })
}

function createDefaultMethod(methodName: string): BridgeMethod {
  if (/^(query|.*Page)$/i.test(methodName)) {
    return async () => emptyPagedResult
  }

  if (/^(list.*|search.*|get.*History|resolveNameOptions|get.*Options)$/i.test(methodName)) {
    return async () => []
  }

  if (/^(getStats|stats)$/i.test(methodName)) {
    return async () => emptyStats
  }

  if (/^get.*Dashboard$/i.test(methodName)) {
    return async () => ({
      tracks: [],
      characterArcs: [],
      relationshipArcs: [],
      summary: {},
    })
  }

  if (/^get.*Summary$/i.test(methodName)) {
    return async () => ({ total: 0, items: [] })
  }

  if (/^(create|update|delete|clear|save|setDefault|markApplied|resume|cancel|retry|generate|start|batch|upsert|apply|sync|refresh|restore|prepare|run|format)/i.test(methodName)) {
    return methodName.startsWith('create') || methodName.startsWith('start') || methodName.startsWith('resume')
      ? nextId
      : noop
  }

  return async () => null
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

  const bridge = {
    windowControls: {
      minimize: noop,
      toggleMaximize: async () => false,
      close: noop,
      isMaximized: async () => false,
      onMaximizedStateChange: () => () => undefined,
    },
    on: () => () => undefined,
    novel: createService({
      list: async () => demoNovels,
      get: async (id) => getNovelById(Number(id)),
      create: nextId,
      update: noop,
      delete: noop,
      export: async () => '',
      stats: async (id) => {
        const novel = getNovelById(Number(id))
        return {
          totalChapters: novel ? Math.max(1, Math.round(novel.totalWords / 3200)) : 0,
          completedChapters: novel ? Math.max(0, Math.round(novel.totalWords / 4800)) : 0,
          totalWords: novel?.totalWords ?? 0,
          characterCount: novel ? 3 : 0,
        }
      },
      getContextStatus: async () => ({
        staleChapterCount: 0,
        contextVersion: 1,
        staleCheckpointCount: 0,
        staleAssetCount: 0,
        staleAssetLabels: [],
      }),
      runConsistencyCheck: async () => ({
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
      }),
      getStoryMemory: async () => ({
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
      }),
      getImpactSummary: async () => ({ totalEvents: 0, affectedAssets: [] }),
      listImpactEvents: async () => [],
    }),
    template: createService({
      list: async (type?: unknown) => {
        if (typeof type !== 'string') return demoTemplates
        return demoTemplates.filter((template) => template.type === type)
      },
    }),
    model: createService({
      list: async () => [{
        id: 1,
        name: '浏览器预览模型',
        provider: 'mock',
        modelId: 'web-preview',
        apiKey: '',
        baseUrl: '',
        temperature: 0.7,
        maxTokens: 4096,
        maxContextTokens: 32000,
        maxConcurrency: 1,
        isDefault: 1,
        createdAt: NOW,
      }],
    }),
    sourceSearch: createService({
      getSettings: async () => ({
        provider: 'auto',
        tavilyApiKeySet: false,
        braveApiKeySet: false,
        tavilyEnvSet: false,
        braveEnvSet: false,
        activeProvider: null,
        updatedAt: NOW,
      }),
      updateSettings: async (data?: unknown) => ({
        provider: typeof (data as { provider?: unknown } | undefined)?.provider === 'string'
          ? (data as { provider: 'auto' | 'tavily' | 'brave' | 'disabled' }).provider
          : 'auto',
        tavilyApiKeySet: Boolean((data as { tavilyApiKey?: unknown } | undefined)?.tavilyApiKey),
        braveApiKeySet: Boolean((data as { braveApiKey?: unknown } | undefined)?.braveApiKey),
        tavilyEnvSet: false,
        braveEnvSet: false,
        activeProvider: null,
        updatedAt: NOW,
      }),
      test: async () => ({
        success: false,
        providerName: null,
        latency: 0,
        info: 'Web 预览未接入真实 Tavily/Brave 检索。',
      }),
    }),
    prompt: createService({ list: async () => [] }),
    task: createService({
      list: async () => [],
      query: async () => emptyPagedResult,
      getStats: async () => emptyStats,
      getPipelineStats: async () => emptyPipelineStats,
      cancel: async () => true,
    }),
    workflow: createService({ list: async () => [] }),
    structure: createService({
      getTree: async () => ({ volumes: [] }),
      listVolumes: async () => [],
      listPartsPage: async () => emptyPagedResult,
      listChaptersPage: async () => emptyPagedResult,
      listSegmentsPage: async () => emptyPagedResult,
      listLinkedTimelineEventsPage: async () => emptyPagedResult,
      getLinkageSummary: async () => emptyStructureLinkageSummary,
      syncLinkage: async () => ({
        ...emptyStructureLinkageSummary,
        createdChapterContractCount: 0,
        createdSceneContractCount: 0,
        createdTimelineAnchorCount: 0,
      }),
      clear: async () => ({
        volumesCleared: 0,
        partsCleared: 0,
        chaptersCleared: 0,
        segmentsCleared: 0,
        checkpointsCleared: 0,
      }),
    }),
    character: createService({
      getStats: async () => ({ ...emptyStats, total: 3, protagonistCount: 1 }),
      getFilterOptions: async () => ({ species: [], entityTypes: [] }),
      getGraph: async () => ({ characters: [], relations: [] }),
    }),
    item: createService({
      getStats: async () => ({ ...emptyStats, total: 2 }),
      getFilterOptions: async () => ({ categories: [], rarities: [] }),
    }),
    map: createService({
      getTree: async () => [],
      queryNodes: async () => emptyPagedResult,
      getStats: async () => ({ ...emptyStats, total: 2 }),
      getNode: async () => null,
      searchNodes: async () => [],
      getRelations: async () => [],
      getGraph: async () => ({ nodes: [], edges: [], relationNodeIds: [], rootNodeIds: [] }),
      getLatestAutoGenerateTask: async () => null,
      getAutoGenerateStatus: async () => null,
    }),
    faction: createService({
      getStats: async () => ({ ...emptyStats, total: 1 }),
      getGraph: async () => ({ nodes: [], edges: [], unalignedCharacters: [] }),
    }),
    glossary: createService({ getStats: async () => ({ ...emptyStats, total: 4 }) }),
    thread: createService({
      getStats: async () => ({ ...emptyStats, total: 3 }),
      getForeshadowSnapshot: async () => ({
        currentChapterNum: 0,
        pending: [],
        dueSoon: [],
        resolved: [],
        overdue: [],
      }),
    }),
    sceneTemplate: createService({ getStats: async () => ({ ...emptyStats, total: 2 }) }),
    revision: createService({
      getStats: async () => ({ ...emptyStats, openCount: 0, inProgressCount: 0, blockerCount: 0 }),
      getSnapshot: async () => ({ tasks: [], blockers: [] }),
    }),
    outline: createService({
      getArcs: async () => [{
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
      }],
      getArcProgressSnapshot: async () => ({ arcs: [], chapterPoints: [] }),
    }),
    timeline: createService({
      getStats: async () => ({ ...emptyStats, total: 5 }),
      getFilterOptions: async () => ({ eventTypes: [], statuses: [], volumes: [], parts: [] }),
    }),
    characterArc: createService({
      getArcDashboard: async () => ({
        characterArcs: [{ id: 1, characterId: 1, title: '从逃避到承担' }],
        relationshipArcs: [],
      }),
    }),
    resistance: createService({
      getDashboard: async () => ({
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
      }),
    }),
    endgameAsset: createService({
      listCommitments: async () => [],
      getSummary: async () => ({ total: 0, fulfilled: 0, pending: 0 }),
    }),
    foreshadow: createService({ listLedger: async () => [] }),
    volumeDesign: createService({ list: async () => [] }),
    contract: createService({ listScenes: async () => [] }),
    storyFact: createService({ list: async () => [] }),
    growthSystem: createService({
      getDashboard: async () => ({
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
      }),
      listTracks: async () => [],
      listPools: async () => [],
      listEvents: async () => [],
    }),
    chapter: createService({
      list: async () => demoChapters,
      get: async (id) => demoChapters.find((chapter) => chapter.id === Number(id)) ?? demoChapters[0] ?? null,
      runPublishCheck: async (id) => createPublishCheck(Number(id)),
    }),
    chapterBatch: createService({ getLatestQualityAnalysisTask: async () => null }),
    writeback: createService({
      listRuns: async () => [],
      getCenterData: async (chapterId) => {
        const chapter = demoChapters.find((item) => item.id === Number(chapterId)) ?? null
        return createEmptyWritebackCenterData(chapter)
      },
      prepareRun: async (chapterId) => createPreviewWritebackRun(Number(chapterId)),
      bulkUpdateDecisions: async () => [],
      applyRun: async () => createEmptyWritebackCenterData(demoChapters[0] ?? null),
      retryFailed: async () => createEmptyWritebackCenterData(demoChapters[0] ?? null),
    }),
    batchWorkbench: createService({
      getData: async (novelId) => createEmptyBatchWorkbenchData(Number(novelId)),
      getGlobalLockLibrary: async (novelId) => createEmptyGlobalLockLibrary(Number(novelId)),
      updateGlobalLockLibrary: async (novelId, patch) => ({
        ...createEmptyGlobalLockLibrary(Number(novelId)),
        ...(patch && typeof patch === 'object' ? patch as Partial<GlobalLockLibrary> : {}),
        novelId: Number(novelId),
        updatedAt: NOW,
      }),
      previewRollback: async (snapshotId, mode) => ({
        snapshotId: Number(snapshotId),
        mode: typeof mode === 'string' ? mode as BatchRollbackMode : 'chapter_rollback',
        chapterCount: 0,
        affectedChapters: [],
        affectedCounts: {},
        warnings: ['浏览器预览环境没有可回滚的批次快照。'],
      }),
    }),
    worldRules: createService(),
    subplot: createService(),
    history: createService({ listRecent: async () => [] }),
    premiseDraft: createService(),
    planningDraft: createService(),
    app: createService({
      getDatabasePath: async () => 'path/to/novelforge.db',
    }),
    quality: createService({
      getDashboard: async () => emptyQualityDashboard,
    }),
  }

  window.electron = bridge as unknown as Window['electron']
}
