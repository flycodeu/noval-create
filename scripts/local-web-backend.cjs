const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

// Windows 终端默认 GBK 代码页会把 UTF-8 中文日志显示成乱码，先切到 UTF-8。
if (process.platform === 'win32') {
  try {
    require('node:child_process').execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // 无控制台时忽略
  }
}
const { LOCAL_WEB_BACKEND_VERSION } = require('./local-web-contract.cjs')
const Module = require('node:module')
const ts = require('typescript')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const host = process.env.NOVELFORGE_WEB_BACKEND_HOST || '127.0.0.1'
const port = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 8787)
const MASKED_KEY = '已设置'
const BACKEND_VERSION = LOCAL_WEB_BACKEND_VERSION

const webEventClients = new Set()

function broadcastWebEvent(channel, ...args) {
  let payload
  try {
    payload = `data: ${JSON.stringify({ channel, args })}\n\n`
  } catch (error) {
    console.warn('[local-web-backend] event serialization failed:', error)
    return
  }

  for (const client of webEventClients) {
    try {
      client.write(payload)
    } catch {
      webEventClients.delete(client)
    }
  }
}

const webEventSender = {
  isDestroyed: () => false,
  send: (channel, ...args) => broadcastWebEvent(channel, ...args),
}

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  }
  if (request.startsWith('@main/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  }

  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    const directCandidates = ['.ts', '.tsx', '.js', '.json'].map((ext) => path.resolve(baseDir, request + ext))
    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }

    const indexCandidates = ['.ts', '.tsx', '.js'].map((ext) => path.resolve(baseDir, request, 'index' + ext))
    for (const candidate of indexCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })

  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function createRuntime() {
  const { eq } = require('drizzle-orm')
  const { closeDb, getDb, initDb } = requireProject('electron/database/db.ts')
  const schema = requireProject('electron/database/schema.ts')
  const modelService = requireProject('electron/services/model.service.ts')
  const sourceSearchSettingsService = requireProject('electron/services/source-search-settings.service.ts')
  const taskService = requireProject('electron/services/task.service.ts')
  const novelService = requireProject('electron/services/novel.service.ts')
  const consistencyService = requireProject('electron/services/consistency.service.ts')
  const storyMemoryService = requireProject('electron/services/story-memory.service.ts')
  const contextImpactService = requireProject('electron/services/context-impact.service.ts')
  const assetImpactService = requireProject('electron/services/asset-impact.service.ts')
  const qualityDashboardService = requireProject('electron/services/quality-dashboard.service.ts')
  const workflowTaskService = requireProject('electron/services/workflow-task.service.ts')
  const workflowNodeService = requireProject('electron/services/workflow-node.service.ts')
  const batchWorkflowService = requireProject('electron/services/batch-workflow.service.ts')
  const batchWorkbenchService = requireProject('electron/services/batch-workbench.service.ts')
  const chapterWritebackService = requireProject('electron/services/chapter-writeback.service.ts')
  const historyService = requireProject('electron/services/history.service.ts')
  const revisionTaskService = requireProject('electron/services/revision-task.service.ts')
  const premiseService = requireProject('electron/services/premise.service.ts')
  const planningDraftService = requireProject('electron/services/planning-draft.service.ts')
  const promptOverrideService = requireProject('electron/services/prompt-override.service.ts')
  const worldStateService = requireProject('electron/services/world-state.service.ts')
  const exportService = requireProject('electron/services/export.service.ts')
  const qualityRepairService = requireProject('electron/services/quality-repair.service.ts')
  const styleAnalysisService = requireProject('electron/services/style-analysis.service.ts')
  const parallelGenerationService = requireProject('electron/services/parallel-generation.service.ts')
  const embeddingService = requireProject('electron/services/embedding.service.ts')
  const worldRulesService = requireProject('electron/services/world-rules.service.ts')
  const subplotService = requireProject('electron/services/subplot.service.ts')
  const projectBriefService = requireProject('electron/services/project-brief.service.ts')
  const themeVoiceService = requireProject('electron/services/theme-voice.service.ts')
  const coreSettingsService = requireProject('electron/services/core-settings.service.ts')
  const aiPatchService = requireProject('electron/services/ai-patch.service.ts')
  const chapterRecallRuntimeService = requireProject('electron/services/chapter-recall-runtime.service.ts')
  const workspaceQualityService = requireProject('electron/services/workspace-quality.service.ts')
  const chapterService = requireProject('electron/services/chapter.service.ts')
  const characterService = requireProject('electron/services/character.service.ts')
  const mapService = requireProject('electron/services/map.service.ts')
  const creativeStageService = requireProject('electron/services/creative-stage.service.ts')
  const itemService = requireProject('electron/services/item.service.ts')
  const storyThreadService = requireProject('electron/services/story-thread.service.ts')
  const factionService = requireProject('electron/services/faction.service.ts')
  const glossaryService = requireProject('electron/services/glossary.service.ts')
  const glossaryReferenceService = requireProject('electron/services/glossary-reference.service.ts')
  const sceneTemplateService = requireProject('electron/services/scene-template.service.ts')
  const endgameAssetService = requireProject('electron/services/endgame-asset.service.ts')
  const storyFactService = requireProject('electron/services/story-fact.service.ts')
  const growthSystemService = requireProject('electron/services/growth-system.service.ts')
  const resistanceService = requireProject('electron/services/resistance.service.ts')
  const characterArcService = requireProject('electron/services/character-arc.service.ts')
  const storyStructureService = requireProject('electron/services/story-structure.service.ts')
  const outlineGenerationService = requireProject('electron/services/outline-generation.service.ts')
  const storyArcService = requireProject('electron/services/story-arc.service.ts')
  const storyArcProgressService = requireProject('electron/services/story-arc-progress.service.ts')
  const rhythmTemplateService = requireProject('electron/services/rhythm-template.service.ts')
  const timelineService = requireProject('electron/services/timeline.service.ts')
  const { buildAiModelRouteReport, buildChatOptionsFromRoute, resolveAiExecutionMode } = requireProject('electron/services/ai-engine.service.ts')
  const { appendVariationMessage, buildVariationDigest, isCandidateTooSimilar } = requireProject('electron/services/variation-control.service.ts')
  const { requireId, requireObject } = requireProject('electron/utils/ipc-validate.ts')
  const { throwUserFacingError } = requireProject('electron/utils/user-facing-error.ts')
  const { novelForgeToolRegistry } = requireProject('electron/application/novelforge-tool-registry.ts')
  const { consumeApprovalGrant, createApprovalGrant } = requireProject('electron/services/approval.service.ts')
  const { maintenanceWorker } = requireProject('electron/services/maintenance-worker.service.ts')
  const { WEB_PREVIEW_AGENT_TOOL_SCOPES } = requireProject('src/shared/tool-contracts/index.ts')

  initDb()
  taskService.recoverOrphanedTasks()

  function getDatabasePath() {
    return path.join(app.getPath('userData'), 'novelforge.db')
  }

  const webAgentActor = {
    type: 'human',
    actorId: 'web-preview-user',
    clientId: 'novelforge-local-web',
    sessionId: 'local-web-preview',
  }

  function listModels() {
    const db = getDb()
    return db.select().from(schema.modelConfigs).all().map((config) => {
      const provider = modelService.normalizeModelProvider(config.provider)
      return {
        ...config,
        provider,
        temperature: modelService.normalizeModelTemperature(config.temperature, provider),
        maxTokens: modelService.normalizeModelMaxTokens(config.maxTokens, provider),
        maxConcurrency: modelService.normalizeModelConcurrency(config.maxConcurrency),
        maxContextTokens: modelService.normalizeModelContextTokensForModel(config.maxContextTokens, provider, config.modelId),
        extraParamsJson: modelService.normalizeModelExtraParamsJson(config.extraParamsJson, provider),
        apiKey: config.apiKey ? MASKED_KEY : '',
      }
    }).filter((config) => modelService.isSupportedModelProvider(config.provider))
  }

  function createModel(data) {
    const payload = { ...requireObject(data, 'data') }
    const db = getDb()
    const provider = modelService.normalizeModelProvider(payload.provider)
    if (!modelService.isSupportedModelProvider(provider)) {
      throwUserFacingError('model.unknownProvider', { provider })
    }
    if (modelService.providerRequiresApiKey(provider) && (!payload.apiKey || payload.apiKey === MASKED_KEY)) {
      throwUserFacingError('model.apiKeyRequired')
    }
    if (modelService.isNativeAgentProvider(provider)) payload.apiKey = null
    delete payload.kimiThinking
    const encryptedKey = payload.apiKey ? modelService.encryptApiKey(String(payload.apiKey)) : null
    const result = db.insert(schema.modelConfigs).values({
      ...payload,
      provider,
      baseUrl: modelService.normalizeModelBaseUrl(payload.baseUrl, provider),
      temperature: modelService.normalizeModelTemperature(payload.temperature, provider),
      maxTokens: modelService.normalizeModelMaxTokens(payload.maxTokens, provider),
      maxContextTokens: modelService.normalizeModelContextTokensForModel(payload.maxContextTokens, provider, payload.modelId),
      maxConcurrency: modelService.normalizeModelConcurrency(payload.maxConcurrency),
      extraParamsJson: modelService.normalizeModelExtraParamsJson(payload.extraParamsJson, provider),
      apiKey: encryptedKey,
    }).run()
    return Number(result.lastInsertRowid)
  }

  function updateModel(id, data) {
    const modelId = requireId(id)
    const payload = { ...requireObject(data, 'data') }
    const db = getDb()
    const existing = db.select().from(schema.modelConfigs).where(eq(schema.modelConfigs.id, modelId)).all()[0]
    const provider = modelService.normalizeModelProvider(
      typeof payload.provider === 'string' ? payload.provider : (existing && existing.provider) || 'openai',
    )
    if (!modelService.isSupportedModelProvider(provider)) {
      throwUserFacingError('model.unknownProvider', { provider })
    }

    const existingProvider = modelService.normalizeModelProvider((existing && existing.provider) || 'openai')
    const providerChanged = Boolean(existing) && provider !== existingProvider
    if (providerChanged && payload.apiKey === MASKED_KEY) {
      throwUserFacingError('model.providerChangeNeedsApiKey')
    }
    if (providerChanged && modelService.providerRequiresApiKey(provider) && !payload.apiKey) {
      throwUserFacingError('model.apiKeyRequired')
    }
    if (modelService.isNativeAgentProvider(provider)) payload.apiKey = null
    if ('provider' in payload || (existing && existing.provider)) {
      payload.provider = provider
    }
    if (providerChanged && !('baseUrl' in payload)) {
      payload.baseUrl = modelService.normalizeModelBaseUrl(null, provider)
    } else if ('baseUrl' in payload) {
      payload.baseUrl = modelService.normalizeModelBaseUrl(payload.baseUrl, provider)
    }
    if (payload.apiKey && payload.apiKey !== MASKED_KEY) {
      payload.apiKey = modelService.encryptApiKey(String(payload.apiKey))
    } else if (payload.apiKey === MASKED_KEY) {
      delete payload.apiKey
    } else if (payload.apiKey === '') {
      payload.apiKey = null
    }
    if ('temperature' in payload) {
      payload.temperature = modelService.normalizeModelTemperature(payload.temperature, provider)
    }
    if ('maxTokens' in payload) {
      payload.maxTokens = modelService.normalizeModelMaxTokens(payload.maxTokens, provider)
    }
    if ('maxContextTokens' in payload || providerChanged || 'modelId' in payload) {
      payload.maxContextTokens = modelService.normalizeModelContextTokensForModel(
        'maxContextTokens' in payload ? payload.maxContextTokens : existing && existing.maxContextTokens,
        provider,
        typeof payload.modelId === 'string' ? payload.modelId : existing && existing.modelId,
      )
    }
    if ('maxConcurrency' in payload) {
      payload.maxConcurrency = modelService.normalizeModelConcurrency(payload.maxConcurrency)
    }
    if (providerChanged || 'extraParamsJson' in payload) {
      payload.extraParamsJson = modelService.normalizeModelExtraParamsJson(
        'extraParamsJson' in payload ? payload.extraParamsJson : existing && existing.extraParamsJson,
        provider,
      )
    }
    delete payload.kimiThinking
    db.update(schema.modelConfigs).set(payload).where(eq(schema.modelConfigs.id, modelId)).run()
  }

  async function runPrompt(data) {
    const payload = requireObject(data, 'data')
    const count = Math.min(Math.max(Number(payload.count) || 1, 1), 3)
    const novel = typeof payload.novelId === 'number'
      ? getDb().select().from(schema.novels).where(eq(schema.novels.id, payload.novelId)).all()[0]
      : null
    const executionMode = resolveAiExecutionMode({
      explicitMode: payload.executionMode,
      settingsJson: novel && novel.settingsJson,
    })
    const route = buildAiModelRouteReport({
      taskKind: 'generic_prompt',
      stageLabel: 'Generic Prompt',
      executionMode: executionMode.mode,
      resolutionSource: executionMode.source,
      modelConfigId: payload.modelConfigId != null ? payload.modelConfigId : novel && novel.modelConfigId,
    })
    const accepted = []
    const rejectedDigests = []
    const maxAttempts = Math.max(count, count * 3)
    let lastOutput = ''

    for (let attemptNumber = 1; attemptNumber <= maxAttempts && accepted.length < count; attemptNumber += 1) {
      const messages = appendVariationMessage(Array.isArray(payload.messages) ? payload.messages : [], {
        attemptNumber,
        candidateIndex: accepted.length + 1,
        totalCandidates: count,
        rejectedDigests,
      })

      const output = await taskService.runChatTask({
        type: 'review',
        retryable: true,
        messages,
        modelConfigId: route.modelConfigId,
        chatOpts: buildChatOptionsFromRoute(route),
        sender: webEventSender,
      })

      lastOutput = output
      if (isCandidateTooSimilar(output, accepted)) {
        rejectedDigests.push(buildVariationDigest(output))
        continue
      }
      accepted.push(output)
    }

    if (accepted.length === 0 && lastOutput) accepted.push(lastOutput)
    return accepted
  }

  const handlers = {
    app: {
      getDatabasePath,
      getMaintenanceStatus: () => maintenanceWorker.getStatus(),
      getCapabilities: () => ({
        surface: 'local-web',
        realDatabase: true,
        writesEnabled: true,
        generationEnabled: true,
        eventStreaming: true,
      }),
    },
    agentTools: {
      list: (query) => novelForgeToolRegistry.list(query == null ? {} : requireObject(query, 'query')),
      approve: (approvalPayload) => {
        const approvalRequest = requireObject(approvalPayload, 'approvalRequest')
        const request = requireObject(approvalRequest.request, 'approvalRequest.request')
        const descriptor = novelForgeToolRegistry.get(request.toolId)
        if (!descriptor) return { approved: false, reason: `未知工具：${request.toolId}` }
        if (descriptor.approval !== 'always') return { approved: false, reason: '该工具不需要逐次批准。' }
        return createApprovalGrant({ request, actor: webAgentActor })
      },
      call: (rawRequest) => {
        const request = requireObject(rawRequest, 'request')
        const trustedApprovalId = typeof request.approvalId === 'string'
          && consumeApprovalGrant({
            approvalId: request.approvalId,
            request,
            actor: webAgentActor,
          })
          ? request.approvalId
          : undefined
        return novelForgeToolRegistry.invoke(request, {
          actor: webAgentActor,
          scopes: [...WEB_PREVIEW_AGENT_TOOL_SCOPES],
          requestId: `web-rpc-${Date.now()}`,
          locale: 'zh-CN',
          ...(trustedApprovalId ? { approvalId: trustedApprovalId } : {}),
        })
      },
    },
    model: {
      list: listModels,
      create: createModel,
      update: updateModel,
      delete: (id) => getDb().delete(schema.modelConfigs).where(eq(schema.modelConfigs.id, requireId(id))).run(),
      setDefault: (id) => {
        const modelId = requireId(id)
        const db = getDb()
        const config = db.select().from(schema.modelConfigs).where(eq(schema.modelConfigs.id, modelId)).all()[0]
        if (!config || !modelService.isSupportedModelProvider(config.provider)) {
          throwUserFacingError('model.unknownProvider', { provider: (config && config.provider) || 'unknown' })
        }
        db.update(schema.modelConfigs).set({ isDefault: 0 }).run()
        db.update(schema.modelConfigs).set({ isDefault: 1 }).where(eq(schema.modelConfigs.id, modelId)).run()
      },
      test: (id) => modelService.testAdapter(requireId(id)),
    },
    sourceSearch: {
      getSettings: () => sourceSearchSettingsService.getSourceSearchSettings(),
      updateSettings: (data) => sourceSearchSettingsService.updateSourceSearchSettings(requireObject(data, 'data')),
      test: () => sourceSearchSettingsService.testSourceSearchSettings(),
    },
    ai: {
      runPrompt,
      expandBackground: (data) => runPrompt({
        modelConfigId: data && data.modelConfigId,
        messages: [{
          role: 'user',
          content: `请把作者原始描述整理为可执行的开书背景卡，禁止擅自新增人名；只输出 JSON，包含 expandedBackground、worldRules、coreConflict、storyGoal。题材：${data && data.genreId || ''}\n作者描述：${data && data.userBackground || ''}`,
        }],
      }).then((outputs) => Array.isArray(outputs) ? outputs[0] || '' : outputs),
      generateCoreSettings: (data) => coreSettingsService.generateCoreSettings(data, webEventSender),
      generatePremise: (data) => premiseService.generatePremise(data, webEventSender),
      generateProjectBrief: (data) => projectBriefService.generateProjectBrief(data),
      generateThemeVoice: (data) => themeVoiceService.generateThemeVoice(data),
      generateWorldRules: (data) => worldRulesService.generateWorldRules(data, webEventSender),
      generateCharacter: (novelId, options) => characterService.generateProtagonist(requireId(novelId, 'novelId'), options),
      generateRelations: (novelId) => characterService.generateCharacterRelations(requireId(novelId, 'novelId')),
      generateSubplotBatch: (data) => subplotService.generateSubplotBatch(data, { sender: webEventSender }),
      rewriteParagraph: (data) => runPrompt({
        novelId: data && data.novelId,
        modelConfigId: data && data.modelConfigId,
        executionMode: data && data.executionMode,
        messages: [{
          role: 'user',
          content: `请只改写下面这一段，保留事实、人物和叙事视角。\n上下文：${data && data.contextBefore || ''}\n要求：${data && data.specificRequirements || ''}\n原文：${data && data.originalParagraph || ''}`,
        }],
      }).then((outputs) => Array.isArray(outputs) ? outputs[0] || '' : outputs),
      scoreContent: (data) => runPrompt({
        novelId: data && data.novelId,
        modelConfigId: data && data.modelConfigId,
        messages: [{
          role: 'user',
          content: `请按 JSON 返回内容评分（结构、连贯、人物、AI味风险），只输出 JSON。题材：${data && data.genreContext || ''}\n背景：${data && data.novelBackground || ''}\n内容：${data && data.content || ''}`,
        }],
      }).then((outputs) => Array.isArray(outputs) ? outputs[0] || '' : outputs),
      analyzeWorkspaceQuality: (data) => workspaceQualityService.analyzeWorkspaceQuality(requireObject(data, 'data')),
      repairWorkspaceQuality: (data) => workspaceQualityService.repairWorkspaceQuality(requireObject(data, 'data')),
    },
    // 与桌面端共用同一组服务和数据库；网页端的写入、生成结果通过 RPC 落到本地后端。
    novel: {
      list: (filters) => novelService.listNovels(filters),
      get: (id) => novelService.getNovel(requireId(id)),
      create: (data) => novelService.createNovel(requireObject(data, 'data')),
      update: (id, data) => novelService.updateNovel(requireId(id), data),
      delete: (id) => novelService.deleteNovel(requireId(id)),
      export: (id, format) => exportService.exportNovel(requireId(id), format),
      formatForPlatform: (id, options) => exportService.formatNovelForPlatform(requireId(id), options || {}),
      stats: (id) => novelService.getNovelStats(requireId(id)),
      getContextStatus: (id) => contextImpactService.getNovelContextStatus(requireId(id)),
      runConsistencyCheck: (id) => consistencyService.buildNovelConsistencyReport(requireId(id)),
      getStoryMemory: (id) => storyMemoryService.buildStoryMemorySnapshot(requireId(id)),
      getWorldStateSnapshot: (id, upToChapterNum) => worldStateService.getWorldStateContextSnapshot(
        requireId(id, 'novelId'),
        { upToChapterNum },
      ),
      getWorldStateLedgerSnapshot: (id, upToChapterNum) => worldStateService.getWorldStateLedgerSnapshot(
        requireId(id, 'novelId'),
        { upToChapterNum },
      ),
      getWorldStateHistory: (novelId, entityType, entityId, stateKey, limit) => worldStateService.listWorldStateHistory(
        requireId(novelId, 'novelId'),
        entityType,
        requireId(entityId, 'entityId'),
        stateKey,
        typeof limit === 'number' ? limit : 12,
      ),
      getImpactSummary: (id) => assetImpactService.getNovelAssetImpactSummary(requireId(id)),
      listImpactEvents: (id) => assetImpactService.listAssetChangeEvents(requireId(id)),
    },
    chapter: {
      list: (novelId) => chapterService.listChapters(requireId(novelId, 'novelId')),
      get: (id) => chapterService.getChapter(requireId(id)),
      create: (novelId, data) => chapterService.createChapter(requireId(novelId, 'novelId'), requireObject(data, 'data')),
      update: (id, data, options) => chapterService.updateChapter(
        requireId(id),
        chapterService.sanitizeChapterUpdatePayload(requireObject(data, 'data')),
        chapterService.sanitizeChapterUpdateOptions(options),
      ),
      delete: (id) => chapterService.deleteChapter(requireId(id)),
      listVersions: (chapterId) => chapterService.listChapterVersions(requireId(chapterId, 'chapterId')),
      restoreVersion: (versionId) => chapterService.restoreChapterVersion(requireId(versionId, 'versionId')),
      batchUpdate: (ids, data) => chapterService.batchUpdateChapters(ids, requireObject(data, 'data')),
      batchDelete: (ids) => chapterService.batchDeleteChapters(ids),
      batchRenumber: (ids, startChapterNum) => chapterService.batchRenumberChapters(ids, startChapterNum),
      reorder: (ids, startChapterNum) => chapterService.reorderChapters(ids, startChapterNum),
      getContextPreview: (chapterId, options) => chapterService.getChapterContextPreview(
        requireId(chapterId, 'chapterId'),
        chapterService.sanitizeChapterGenerationOptions(options),
      ),
      generateContent: (chapterId, options) => chapterService.generateChapterContent(
        requireId(chapterId, 'chapterId'),
        webEventSender,
        chapterService.sanitizeChapterGenerationOptions(options),
      ),
      resumeContent: (taskId) => chapterService.resumeChapterPipeline(requireId(taskId, 'taskId'), webEventSender),
      generateSummary: (chapterId) => chapterService.generateChapterSummary(requireId(chapterId, 'chapterId')),
      aiCheck: (chapterId) => chapterService.aiCheckChapter(requireId(chapterId, 'chapterId')),
      runPublishCheck: (chapterId) => chapterService.runChapterPublishCheck(requireId(chapterId, 'chapterId')),
      optimizeContent: (chapterId, options) => chapterService.optimizeChapterContent(requireId(chapterId, 'chapterId'), options || {}),
    },
    chapterBatch: {
      startAutoGenerate: (novelId, options) => batchWorkflowService.startChapterBatchGenerateWorkflow(requireId(novelId, 'novelId'), options, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getChapterBatchAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestChapterBatchAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
      startQualityAnalysis: (novelId, options) => batchWorkflowService.startChapterQualityAnalysisWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      getQualityAnalysisStatus: (taskId) => batchWorkflowService.getChapterQualityAnalysisStatus(requireId(taskId, 'taskId')),
      getLatestQualityAnalysisTask: (novelId) => batchWorkflowService.getLatestChapterQualityAnalysisTask(requireId(novelId, 'novelId')),
      resumeQualityAnalysis: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
    },
    character: {
      list: (novelId) => characterService.listCharacters(novelId),
      query: (filters) => characterService.queryCharacters(filters),
      search: (novelId, keyword, limit) => characterService.searchCharacters(novelId, keyword, limit),
      get: (id) => characterService.getCharacter(id),
      getDetailContext: (characterId) => characterService.getCharacterDetailContext(characterId),
      getRelations: (novelId) => characterService.getCharacterRelations(novelId),
      getStats: (filters) => characterService.getCharacterStats(filters),
      getFilterOptions: (novelId) => characterService.getCharacterFilterOptions(novelId),
      getGraph: (filters) => characterService.getCharacterGraph(filters),
      create: (novelId, data) => characterService.createCharacter(requireId(novelId, 'novelId'), data),
      update: (id, data) => characterService.updateCharacter(requireId(id), data),
      delete: (id) => characterService.deleteCharacter(requireId(id)),
      regenerate: (id) => characterService.regenerateCharacter(requireId(id)),
      suggestPatch: (id, instruction) => characterService.suggestCharacterPatch(requireId(id), typeof instruction === 'string' ? instruction : ''),
      applyPatch: (id, patch) => characterService.applyCharacterPatch(requireId(id), patch),
      startAutoGenerate: (novelId, options) => batchWorkflowService.startCharacterAutoGenerateWorkflow(requireId(novelId, 'novelId'), options, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getCharacterAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestCharacterAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
      generateProtagonist: (novelId, options) => characterService.generateProtagonist(requireId(novelId, 'novelId'), options),
      generateRelations: (novelId) => characterService.generateCharacterRelations(requireId(novelId, 'novelId')),
      upsertRelation: (data) => characterService.upsertRelation(data),
      clear: (novelId) => characterService.clearCharactersByNovel(requireId(novelId, 'novelId')),
      batchGenerate: (novelId, options) => batchWorkflowService.generateCharactersViaWorkflow(requireId(novelId, 'novelId'), options, webEventSender),
    },
    map: {
      getTree: (novelId) => mapService.getMapTree(novelId),
      queryNodes: (filters) => mapService.queryMapNodes(filters),
      getGraph: (filters) => mapService.getMapGraph(filters),
      getRelations: (novelId, focusNodeId) => mapService.getMapRelations(novelId, focusNodeId),
      getStats: (novelId) => mapService.getMapStats(novelId),
      getNode: (id) => mapService.getMapNode(id),
      searchNodes: (novelId, keyword, limit) => mapService.searchMapNodes(novelId, keyword, limit),
      create: (novelId, data) => mapService.createMapItem(requireId(novelId, 'novelId'), data),
      update: (id, data) => mapService.updateMapItem(requireId(id), data),
      upsertRelation: (data) => mapService.upsertMapRelation(data),
      deleteRelation: (id) => mapService.deleteMapRelation(requireId(id)),
      delete: (id) => mapService.deleteMapItem(requireId(id)),
      batchGenerate: (novelId, structure) => mapService.batchGenerateMap(requireId(novelId, 'novelId'), structure),
      batchGenerateToTarget: (novelId, structure) => mapService.batchGenerateMapToTarget(requireId(novelId, 'novelId'), structure),
      startAutoGenerate: (novelId, structure) => workflowTaskService.startMapAutoGenerateWorkflow(requireId(novelId, 'novelId'), structure, webEventSender),
      getAutoGenerateStatus: (taskId) => workflowTaskService.getMapAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => workflowTaskService.getLatestMapAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => workflowTaskService.resumeWorkflowTask(requireId(taskId, 'taskId'), webEventSender),
      clear: (novelId) => mapService.clearMapByNovel(requireId(novelId, 'novelId')),
    },
    creativeStage: {
      list: (novelId, includeArchived) => creativeStageService.listCreativeStages(requireId(novelId, 'novelId'), includeArchived === true),
      get: (stageId) => creativeStageService.getCreativeStage(requireId(stageId, 'stageId')),
      create: (novelId, input) => creativeStageService.createCreativeStage(requireId(novelId, 'novelId'), requireObject(input, 'input')),
      update: (input) => creativeStageService.updateCreativeStage(requireObject(input, 'input')),
      archive: (stageId) => creativeStageService.archiveCreativeStage(requireId(stageId, 'stageId')),
      listAssets: (stageId) => creativeStageService.listCreativeStageAssets(requireId(stageId, 'stageId')),
      upsertAsset: (input) => creativeStageService.upsertCreativeStageAsset(requireObject(input, 'input')),
      removeAsset: (assetId) => creativeStageService.removeCreativeStageAsset(requireId(assetId, 'assetId')),
      getContext: (novelId, stageId, chapterNum) => creativeStageService.getCreativeStageContext(
        requireId(novelId, 'novelId'),
        requireId(stageId, 'stageId'),
        chapterNum === undefined || chapterNum === null ? undefined : requireId(chapterNum, 'chapterNum'),
      ),
      listHandoffs: (novelId, stageId) => creativeStageService.listCreativeStageHandoffs(requireId(novelId, 'novelId'), requireId(stageId, 'stageId')),
      createHandoff: () => readOnlyMutation('creativeStage.createHandoff'),
      reviewHandoff: () => readOnlyMutation('creativeStage.reviewHandoff'),
      approveHandoff: () => readOnlyMutation('creativeStage.approveHandoff'),
    },
    item: {
      list: (novelId) => itemService.listStoryItems(novelId),
      search: (novelId, keyword, itemKind, limit) => itemService.searchStoryItems(novelId, keyword, itemKind, limit),
      query: (filters) => itemService.queryStoryItems(filters),
      getStats: (filters) => itemService.getStoryItemStats(filters),
      getFilterOptions: (novelId) => itemService.getStoryItemFilterOptions(novelId),
      get: (id) => itemService.getStoryItem(id),
      getDetailContext: (id) => itemService.getStoryItemDetailContext(id),
      create: (novelId, data) => itemService.createStoryItem(requireId(novelId, 'novelId'), data),
      update: (id, data) => itemService.updateStoryItem(requireId(id), data),
      delete: (id) => itemService.deleteStoryItem(requireId(id)),
      generate: (novelId, options) => batchWorkflowService.generateItemsViaWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      startAutoGenerate: (novelId, options) => batchWorkflowService.startItemAutoGenerateWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getItemAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestItemAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
      regenerate: (id, options) => itemService.regenerateStoryItem(requireId(id), options || {}),
      getLinkRecommendations: (itemId) => itemService.getStoryItemLinkRecommendations(requireId(itemId, 'itemId')),
      applyLinkRecommendations: (itemId, data) => itemService.applyStoryItemLinkRecommendations(requireId(itemId, 'itemId'), data || {}),
      repairCharacterLinks: (novelId) => itemService.repairItemCharacterLinks(requireId(novelId, 'novelId')),
      clear: (novelId) => itemService.clearStoryItemsByNovel(requireId(novelId, 'novelId')),
    },
    thread: {
      list: (novelId) => storyThreadService.listStoryThreads(novelId),
      query: (filters) => storyThreadService.queryStoryThreads(filters),
      get: (id) => storyThreadService.getStoryThread(id),
      getStats: (filters) => storyThreadService.getStoryThreadStats(filters),
      getForeshadowSnapshot: (novelId, chapterNum) => storyThreadService.getForeshadowSnapshot(
        requireId(novelId, 'novelId'),
        typeof chapterNum === 'number' ? chapterNum : undefined,
      ),
      generate: (novelId, options) => batchWorkflowService.generateStoryThreadsViaWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      startAutoGenerate: (novelId, options) => batchWorkflowService.startStoryThreadAutoGenerateWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getStoryThreadAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestStoryThreadAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
      create: (novelId, data) => storyThreadService.createStoryThread(requireId(novelId, 'novelId'), data),
      update: (id, data) => storyThreadService.updateStoryThread(requireId(id), data),
      delete: (id) => storyThreadService.deleteStoryThread(requireId(id)),
      batchUpdate: (ids, data) => storyThreadService.batchUpdateStoryThreads(ids, data),
      batchDelete: (ids) => storyThreadService.batchDeleteStoryThreads(ids),
      clear: (novelId) => storyThreadService.clearStoryThreads(requireId(novelId, 'novelId')),
      regenerate: (id, options) => storyThreadService.regenerateStoryThread(requireId(id), options || {}),
    },
    faction: {
      list: (novelId) => factionService.listFactions(requireId(novelId, 'novelId')),
      query: (filters) => factionService.queryFactions(filters),
      getStats: (filters) => factionService.getFactionStats(filters),
      get: (id) => factionService.getFaction(requireId(id)),
      search: (novelId, keyword, limit) => factionService.searchFactions(requireId(novelId, 'novelId'), keyword, limit),
      getGraph: (filters) => factionService.getFactionGraph(filters),
      create: (novelId, data) => factionService.createFaction(requireId(novelId, 'novelId'), data),
      update: (id, data) => factionService.updateFaction(requireId(id), data),
      delete: (id) => factionService.deleteFaction(requireId(id)),
      clear: (novelId) => factionService.clearFactions(requireId(novelId, 'novelId')),
      batchGenerate: (novelId, options) => batchWorkflowService.generateFactionsViaWorkflow(requireId(novelId, 'novelId'), options, webEventSender),
      startAutoGenerate: (novelId, options) => batchWorkflowService.startFactionAutoGenerateWorkflow(requireId(novelId, 'novelId'), options, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getFactionAutoGenerateStatus(requireId(taskId)),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestFactionAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId), webEventSender),
      resolveNameOptions: (novelId) => factionService.resolveFactionNameOptions(requireId(novelId, 'novelId')),
    },
    glossary: {
      list: (novelId) => glossaryService.listGlossary(requireId(novelId, 'novelId')),
      query: (filters) => glossaryService.queryGlossary(filters),
      getStats: (filters) => glossaryService.getGlossaryStats(filters),
      get: (id) => glossaryService.getGlossaryEntry(requireId(id)),
      search: (novelId, keyword, limit) => glossaryService.searchGlossary(requireId(novelId, 'novelId'), keyword, limit),
      create: (novelId, data) => glossaryService.createGlossaryEntry(requireId(novelId, 'novelId'), data),
      update: (id, data) => glossaryService.updateGlossaryEntry(requireId(id), data),
      delete: (id) => glossaryService.deleteGlossaryEntry(requireId(id)),
      scanReferences: (novelId) => glossaryReferenceService.scanNovelGlossaryReferences(requireId(novelId, 'novelId')),
      usageReport: (novelId) => glossaryReferenceService.getGlossaryUsageReport(requireId(novelId, 'novelId')),
    },
    sceneTemplate: {
      list: (filters) => sceneTemplateService.listSceneTemplates(filters || {}),
      query: (filters) => sceneTemplateService.querySceneTemplates(filters || {}),
      getStats: (filters) => sceneTemplateService.getSceneTemplateStats(filters || {}),
      get: (id) => sceneTemplateService.getSceneTemplate(requireId(id)),
      search: (novelId, genreId, keyword, limit) => sceneTemplateService.searchSceneTemplates(
        requireId(novelId, 'novelId'),
        typeof genreId === 'number' ? genreId : undefined,
        keyword,
        limit,
      ),
      create: (data) => sceneTemplateService.createSceneTemplate(data),
      update: (id, data) => sceneTemplateService.updateSceneTemplate(requireId(id), data),
      delete: (id) => sceneTemplateService.deleteSceneTemplate(requireId(id)),
    },
    template: {
      list: (type) => {
        const query = getDb().select().from(schema.templates)
        return typeof type === 'string' && type
          ? query.where(eq(schema.templates.type, type)).all()
          : query.all()
      },
      create: (data) => {
        const result = getDb().insert(schema.templates).values(requireObject(data, 'data')).run()
        return Number(result.lastInsertRowid)
      },
      update: (id, data) => getDb().update(schema.templates).set(requireObject(data, 'data')).where(eq(schema.templates.id, requireId(id))).run(),
      delete: (id) => {
        const targetId = requireId(id)
        const template = getDb().select().from(schema.templates).where(eq(schema.templates.id, targetId)).all()[0]
        if (template && template.isBuiltin) throwUserFacingError('template.builtinDeleteBlocked')
        return getDb().delete(schema.templates).where(eq(schema.templates.id, targetId)).run()
      },
    },
    prompt: {
      list: () => promptOverrideService.listPromptOverrides(),
      save: (key, content) => promptOverrideService.savePromptOverride(key, content),
      delete: (key) => promptOverrideService.deletePromptOverride(key),
    },
    structure: {
      getTree: (novelId) => storyStructureService.listStoryStructure(novelId),
      listVolumes: (novelId) => storyStructureService.listStructureVolumes(requireId(novelId, 'novelId')),
      listPartsPage: (volumeId, page, pageSize) => storyStructureService.listStructurePartsPage(requireId(volumeId, 'volumeId'), page, pageSize),
      listChaptersPage: (partId, page, pageSize) => storyStructureService.listStructureChaptersPage(requireId(partId, 'partId'), page, pageSize),
      listSegments: (chapterId) => storyStructureService.listChapterSegments(requireId(chapterId, 'chapterId')),
      getSegment: (id) => storyStructureService.getChapterSegment(requireId(id, 'segmentId')),
      listSegmentsPage: (chapterId, page, pageSize) => storyStructureService.listChapterSegmentsPage(requireId(chapterId, 'chapterId'), page, pageSize),
      listCheckpoints: (novelId) => storyStructureService.listStoryCheckpoints(requireId(novelId, 'novelId')),
      listCheckpointsPage: (filters, page, pageSize) => storyStructureService.listStoryCheckpointsPage(filters, page, pageSize),
      listLinkedTimelineEvents: (filters) => timelineService.listLinkedTimelineEvents(filters),
      listLinkedTimelineEventsPage: (filters, page, pageSize) => timelineService.listLinkedTimelineEventsPage(filters, page, pageSize),
      resolvePath: (filters) => storyStructureService.resolveStructurePath(filters),
      getLinkageSummary: (novelId) => storyStructureService.getStructureLinkageSummary(requireId(novelId, 'novelId')),
      createVolume: (novelId, data) => storyStructureService.createStoryVolume(requireId(novelId, 'novelId'), data),
      updateVolume: (id, data) => storyStructureService.updateStoryVolume(requireId(id), data),
      deleteVolume: (id) => storyStructureService.deleteStoryVolume(requireId(id)),
      reorderVolumes: (novelId, orderedIds) => storyStructureService.reorderStoryVolumes(requireId(novelId, 'novelId'), orderedIds),
      createPart: (volumeId, data) => storyStructureService.createStoryPart(requireId(volumeId, 'volumeId'), data),
      updatePart: (id, data) => storyStructureService.updateStoryPart(requireId(id), data),
      deletePart: (id) => storyStructureService.deleteStoryPart(requireId(id)),
      reorderParts: (novelId, operations) => storyStructureService.reorderStoryParts(requireId(novelId, 'novelId'), operations),
      reorderPartsInVolume: (volumeId, orderedIds) => storyStructureService.reorderStoryPartsInVolume(requireId(volumeId, 'volumeId'), orderedIds),
      assignChapter: (chapterId, partId) => storyStructureService.assignChapterToPart(requireId(chapterId, 'chapterId'), requireId(partId, 'partId')),
      createSegment: (chapterId, data) => storyStructureService.createChapterSegment(requireId(chapterId, 'chapterId'), data),
      updateSegment: (id, data) => storyStructureService.updateChapterSegment(requireId(id), data),
      deleteSegment: (id) => storyStructureService.deleteChapterSegment(requireId(id)),
      reorderSegments: (chapterId, orderedIds) => storyStructureService.reorderChapterSegments(requireId(chapterId, 'chapterId'), orderedIds),
      compileChapter: (chapterId) => storyStructureService.compileChapterFromSegments(requireId(chapterId, 'chapterId')),
      refreshCheckpoints: (novelId) => storyMemoryService.refreshStoryMemoryCheckpoints(requireId(novelId, 'novelId')),
      syncLinkage: (novelId) => storyStructureService.syncStructureLinkage(requireId(novelId, 'novelId')),
      clear: (novelId) => storyStructureService.clearStoryStructure(requireId(novelId, 'novelId')),
      applyBatchPlan: (novelId, plan) => storyStructureService.applyStructureBatchPlan(requireId(novelId, 'novelId'), plan),
      previewBatchEdit: (novelId, operations) => storyStructureService.previewStructureBatchEdit(requireId(novelId, 'novelId'), operations),
      applyBatchEdit: (novelId, operations) => storyStructureService.applyStructureBatchEdit(requireId(novelId, 'novelId'), operations),
    },
    outline: {
      getArcs: (novelId) => storyArcService.listStoryArcs(requireId(novelId, 'novelId')),
      getArcProgressSnapshot: (novelId) => storyArcProgressService.getStoryArcProgressSnapshot(requireId(novelId, 'novelId')),
      createArc: (novelId, data) => storyArcService.createStoryArc(
        requireId(novelId, 'novelId'),
        requireObject(data, 'data'),
      ),
      updateArc: (id, data) => {
        storyArcService.updateStoryArc(requireId(id), requireObject(data, 'data'))
      },
      deleteArc: (id) => storyArcService.deleteStoryArc(requireId(id)),
      clear: (novelId) => storyArcService.clearStoryArcs(requireId(novelId, 'novelId')),
      generateArcs: (novelId) => outlineGenerationService.generateStoryArcs(requireId(novelId, 'novelId')),
      generateChapterOutlines: (arcId, options) => outlineGenerationService.generateChapterOutlines(
        requireId(arcId, 'arcId'),
        options || {},
      ),
    },
    rhythm: {
      listTemplates: (novelId) => rhythmTemplateService.listRhythmTemplatesForNovel(requireId(novelId, 'novelId')),
      attachToArc: (arcId, templateKey) => rhythmTemplateService.attachRhythmTemplateToArc(
        requireId(arcId, 'arcId'),
        typeof templateKey === 'string' && templateKey ? templateKey : null,
      ),
    },
    timeline: {
      list: (novelId) => timelineService.listTimelineEvents(novelId),
      query: (filters) => timelineService.queryTimelineEvents(filters),
      search: (novelId, keyword, limit) => timelineService.searchTimelineEvents(novelId, keyword, limit),
      getStats: (filters) => timelineService.getTimelineStats(filters),
      getFilterOptions: (novelId) => timelineService.getTimelineFilterOptions(novelId),
      get: (id) => timelineService.getTimelineEvent(requireId(id)),
      create: (novelId, data) => timelineService.createTimelineEvent(requireId(novelId, 'novelId'), data),
      update: (id, data) => timelineService.updateTimelineEvent(requireId(id), data),
      delete: (id) => timelineService.deleteTimelineEvent(requireId(id)),
      batchUpdate: (ids, data) => timelineService.batchUpdateTimelineEvents(ids, data),
      batchDelete: (ids) => timelineService.batchDeleteTimelineEvents(ids),
      generate: (novelId, options) => batchWorkflowService.generateTimelineViaWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      startAutoGenerate: (novelId, options) => batchWorkflowService.startTimelineAutoGenerateWorkflow(requireId(novelId, 'novelId'), options || {}, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getTimelineAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestTimelineAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
      regenerate: (id, options) => timelineService.regenerateTimelineEvent(requireId(id), options || {}),
      clear: (novelId) => timelineService.clearTimelineByNovel(requireId(novelId, 'novelId')),
    },
    characterArc: {
      listCharacterArcs: (novelId) => characterArcService.listCharacterArcs(requireId(novelId, 'novelId')),
      getCharacterArc: (arcId) => characterArcService.getCharacterArc(requireId(arcId, 'arcId')),
      upsertCharacterArc: (data) => characterArcService.upsertCharacterArc(data),
      upsertCharacterArcBeat: (data) => characterArcService.upsertCharacterArcBeat(data),
      listRelationshipArcs: (novelId) => characterArcService.listRelationshipArcs(requireId(novelId, 'novelId')),
      upsertRelationshipArc: (data) => characterArcService.upsertRelationshipArc(data),
      getArcDashboard: (novelId) => characterArcService.getArcDashboard(requireId(novelId, 'novelId')),
    },
    resistance: {
      listTracks: (novelId) => resistanceService.listTracks(requireId(novelId, 'novelId')),
      getTrack: (trackId) => resistanceService.getTrack(requireId(trackId, 'trackId')),
      upsertTrack: (data) => resistanceService.upsertTrack(data),
      upsertBeat: (data) => resistanceService.upsertBeat(data),
      getDashboard: (novelId) => resistanceService.getDashboard(requireId(novelId, 'novelId')),
    },
    endgameAsset: {
      listCommitments: (novelId) => endgameAssetService.listEndgameCommitments(requireId(novelId, 'novelId')),
      getSummary: (novelId) => endgameAssetService.getEndgameAssetSummary(requireId(novelId, 'novelId')),
      syncFromSettings: (novelId, settingsJson) => endgameAssetService.syncEndgameCommitmentsFromSettings(requireId(novelId, 'novelId'), settingsJson),
      updateCommitment: (id, data) => endgameAssetService.updateEndgameCommitment(requireId(id), data),
    },
    foreshadow: {
      listLedger: (novelId) => endgameAssetService.listForeshadowLedger(requireId(novelId, 'novelId')),
      upsertLedger: (novelId, data) => endgameAssetService.upsertForeshadowLedger(requireId(novelId, 'novelId'), data),
      deleteLedger: (novelId, id) => endgameAssetService.deleteForeshadowLedger(requireId(novelId, 'novelId'), requireId(id, 'id')),
    },
    volumeDesign: {
      list: (novelId) => endgameAssetService.listVolumeDesigns(requireId(novelId, 'novelId')),
      getByVolume: (volumeId) => endgameAssetService.getVolumeDesignByVolumeId(requireId(volumeId, 'volumeId')),
      upsert: (volumeId, data) => endgameAssetService.upsertVolumeDesign(requireId(volumeId, 'volumeId'), data),
      auditVolume: (volumeId, options) => endgameAssetService.auditVolumeDesign(
        requireId(volumeId, 'volumeId'),
        options || {},
      ),
      syncConstraints: (volumeId) => endgameAssetService.syncVolumeDesignConstraintsToContracts(requireId(volumeId, 'volumeId')),
    },
    contract: {
      getChapter: (chapterId) => endgameAssetService.getChapterContract(requireId(chapterId, 'chapterId')),
      upsertChapter: (chapterId, data) => endgameAssetService.upsertChapterContract(requireId(chapterId, 'chapterId'), data),
      listScenes: (chapterId) => endgameAssetService.listSceneContracts(requireId(chapterId, 'chapterId')),
      upsertScene: (chapterId, segmentId, data) => endgameAssetService.upsertSceneContract(
        requireId(chapterId, 'chapterId'),
        segmentId == null ? null : requireId(segmentId, 'segmentId'),
        data,
      ),
    },
    storyFact: {
      list: (novelId) => storyFactService.listStoryFacts(requireId(novelId, 'novelId')),
      get: (id) => storyFactService.getStoryFact(requireId(id)),
      create: (novelId, data) => storyFactService.createStoryFact(requireId(novelId, 'novelId'), data),
      update: (id, data) => storyFactService.updateStoryFact(requireId(id), data),
      delete: (id) => storyFactService.deleteStoryFact(requireId(id)),
    },
    growthSystem: {
      getDashboard: (novelId) => growthSystemService.getGrowthSystemDashboard(requireId(novelId, 'novelId')),
      listTracks: (novelId) => growthSystemService.listGrowthTracks(requireId(novelId, 'novelId')),
      upsertTrack: (novelId, data) => growthSystemService.upsertGrowthTrack(requireId(novelId, 'novelId'), data),
      deleteTrack: (novelId, id) => growthSystemService.deleteGrowthTrack(requireId(novelId, 'novelId'), requireId(id, 'id')),
      upsertPool: (novelId, data) => growthSystemService.upsertResourcePool(requireId(novelId, 'novelId'), data),
      deletePool: (novelId, id) => growthSystemService.deleteResourcePool(requireId(novelId, 'novelId'), requireId(id, 'id')),
      listPools: (novelId) => growthSystemService.listResourcePools(requireId(novelId, 'novelId')),
      upsertEvent: (novelId, data) => growthSystemService.upsertRewardCostEvent(requireId(novelId, 'novelId'), data),
      deleteEvent: (novelId, id) => growthSystemService.deleteRewardCostEvent(requireId(novelId, 'novelId'), requireId(id, 'id')),
      listEvents: (novelId) => growthSystemService.listRewardCostEvents(requireId(novelId, 'novelId')),
      bindChapterContract: (novelId, data) => growthSystemService.bindGrowthAssetsToChapterContract(requireId(novelId, 'novelId'), data),
      bindVolumeDesign: (novelId, data) => growthSystemService.bindGrowthAssetsToVolumeDesign(requireId(novelId, 'novelId'), data),
    },
    task: {
      list: (novelId) => taskService.listTasks(novelId),
      query: (filters) => taskService.queryTasks(filters || {}),
      getStats: (novelId) => taskService.getTaskStats(novelId),
      getPipelineStats: (novelId) => taskService.getTaskPipelineStats(novelId),
      getLatestChapterPipeline: (chapterId) => taskService.getLatestChapterPipelineTask(requireId(chapterId, 'chapterId')),
      get: (id) => taskService.getTaskRecord(requireId(id)),
      clearHistory: (filters) => taskService.clearTaskHistory(filters || {}),
      cancel: (id) => taskService.cancelTask(requireId(id), webEventSender),
      retry: async (id) => {
        const taskId = requireId(id)
        const task = taskService.getTaskRecord(taskId)
        if (!task) throwUserFacingError('task.notFound', { id: taskId })
        if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) {
          return chapterService.resumeChapterPipeline(taskId, webEventSender)
        }
        if (task.type === 'subplot_framework') return subplotService.retrySubplotBatch(taskId)
        return taskService.retryTask(taskId, webEventSender)
      },
    },
    workflow: {
      list: (novelId) => workflowTaskService.listWorkflowTasks(novelId),
      get: (id) => workflowTaskService.getWorkflowTask(requireId(id)),
      cancel: (id) => taskService.cancelTask(requireId(id), webEventSender),
      resume: (id) => workflowTaskService.resumeWorkflowTask(requireId(id), webEventSender),
    },
    workflowNode: {
      list: (filters) => workflowNodeService.listWorkflowNodeRuns(
        parseObjectPayload(filters || {}, 'filters'),
      ),
      get: (id) => workflowNodeService.getWorkflowNodeRun(requireId(id, 'nodeRunId')),
      getSnapshot: (id) => workflowNodeService.getWorkflowNodeSnapshot(requireString(id, 'snapshotId')),
      retry: (id) => chapterService.retryChapterPipelineNode(requireId(id, 'nodeRunId'), webEventSender),
    },
    history: {
      listRecent: (novelId, limit) => historyService.listRecentOperationLogs(requireId(novelId, 'novelId'), limit),
      getLatestUndoable: (novelId) => historyService.getLatestUndoableOperation(requireId(novelId, 'novelId')),
      undo: (logId) => historyService.undoOperation(requireId(logId)),
    },
    revision: {
      list: (novelId) => revisionTaskService.listRevisionTasks(requireId(novelId, 'novelId')),
      query: (filters) => revisionTaskService.queryRevisionTasks(filters || {}),
      getStats: (filters) => revisionTaskService.getRevisionTaskStats(filters || {}),
      getSnapshot: (novelId) => revisionTaskService.getRevisionCenterSnapshot(requireId(novelId, 'novelId')),
      get: (id) => revisionTaskService.getRevisionTask(requireId(id)),
      create: (novelId, data) => revisionTaskService.createRevisionTask(requireId(novelId, 'novelId'), data),
      update: (id, data) => revisionTaskService.updateRevisionTask(requireId(id), data),
      delete: (id) => revisionTaskService.deleteRevisionTask(requireId(id)),
      autoFix: (id) => revisionTaskService.autoFixRevisionTask(requireId(id)),
    },
    premiseDraft: {
      getLatest: (novelId) => premiseService.getLatestPremiseDraft(requireId(novelId, 'novelId')),
      markApplied: (taskId, appliedMode) => premiseService.markPremiseDraftApplied(requireId(taskId, 'taskId'), appliedMode),
      clearAll: (novelId) => premiseService.clearPremiseDrafts(requireId(novelId, 'novelId')),
    },
    planningDraft: {
      getLatest: (novelId, pageKey) => planningDraftService.getLatestPlanningDraft(requireId(novelId, 'novelId'), pageKey),
      save: (data) => planningDraftService.savePlanningDraft(data),
      markApplied: (taskId) => planningDraftService.markPlanningDraftApplied(requireId(taskId, 'taskId')),
      finalize: (taskId, finalData) => planningDraftService.finalizePlanningDraft(requireId(taskId, 'taskId'), finalData),
      clear: (novelId, pageKey) => planningDraftService.clearPlanningDrafts(requireId(novelId, 'novelId'), pageKey),
    },
    subplot: {
      generate: (request) => batchWorkflowService.generateSubplotsViaWorkflow(request, webEventSender),
      startAutoGenerate: (request) => batchWorkflowService.startSubplotAutoGenerateWorkflow(request, webEventSender),
      getAutoGenerateStatus: (taskId) => batchWorkflowService.getSubplotAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => batchWorkflowService.getLatestSubplotAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId) => batchWorkflowService.resumeBatchAutoGenerateWorkflow(requireId(taskId, 'taskId'), webEventSender),
    },
    worldRules: {
      startAutoGenerate: (novelId, options) => workflowTaskService.startWorldRulesAutoGenerateWorkflow(requireId(novelId, 'novelId'), options, webEventSender),
      getAutoGenerateStatus: (taskId) => workflowTaskService.getWorldRulesAutoGenerateStatus(requireId(taskId, 'taskId')),
      getLatestAutoGenerateTask: (novelId) => workflowTaskService.getLatestWorldRulesAutoGenerateTask(requireId(novelId, 'novelId')),
      resumeAutoGenerate: (taskId, currentRules) => workflowTaskService.resumeWorldRulesAutoGenerateWorkflow(requireId(taskId, 'taskId'), currentRules, webEventSender),
      clearAutoGenerateDraft: (novelId) => workflowTaskService.clearWorldRulesAutoGenerateDraft(requireId(novelId, 'novelId')),
    },
    batchWorkbench: {
      getData: (novelId, snapshotId) => batchWorkbenchService.getBatchWorkbenchData(
        requireId(novelId, 'novelId'),
        snapshotId == null ? undefined : requireId(snapshotId, 'snapshotId'),
      ),
      createInspection: (snapshotId, data) => batchWorkbenchService.createBatchInspection(requireId(snapshotId, 'snapshotId'), requireObject(data, 'data')),
      previewRollback: (snapshotId, mode) => batchWorkbenchService.previewBatchRollback(requireId(snapshotId, 'snapshotId'), mode),
      applyRollback: (snapshotId, mode) => batchWorkbenchService.applyBatchRollback(requireId(snapshotId, 'snapshotId'), mode),
      getGlobalLockLibrary: (novelId) => batchWorkbenchService.getGlobalLockLibrary(requireId(novelId, 'novelId')),
      updateGlobalLockLibrary: (novelId, patch) => batchWorkbenchService.updateGlobalLockLibrary(requireId(novelId, 'novelId'), requireObject(patch, 'patch')),
    },
    writeback: {
      prepareRun: (chapterId, triggerSource) => chapterWritebackService.prepareChapterWritebackRun(requireId(chapterId, 'chapterId'), typeof triggerSource === 'string' ? triggerSource : 'manual'),
      getCenterData: (chapterId, runId) => chapterWritebackService.getChapterWritebackCenterData(requireId(chapterId, 'chapterId'), runId == null ? undefined : requireId(runId, 'runId')),
      listRuns: (chapterId) => chapterWritebackService.listChapterWritebackRuns(requireId(chapterId, 'chapterId')),
      updateDecision: (diffId, patch) => chapterWritebackService.updateChapterWritebackDecision(requireId(diffId, 'diffId'), requireObject(patch, 'patch')),
      bulkUpdateDecisions: (runId, patch) => chapterWritebackService.bulkUpdateChapterWritebackDecisions(requireId(runId, 'runId'), requireObject(patch, 'patch')),
      applyRun: (runId, options) => chapterWritebackService.applyChapterWritebackRun(requireId(runId, 'runId'), requireObject(options || {}, 'options')),
      retryFailed: (runId, options) => chapterWritebackService.retryFailedWritebackItems(requireId(runId, 'runId'), requireObject(options || {}, 'options')),
    },
    quality: {
      getDashboard: (novelId) => qualityDashboardService.getQualityDashboardData(requireId(novelId, 'novelId')),
      backfillRecallSnapshots: (novelId) => chapterRecallRuntimeService.backfillMissingChapterRecallRuntimeSnapshots(requireId(novelId, 'novelId')),
      createRepairTask: (novelId, action) => qualityRepairService.createQualityRepairTask(requireId(novelId, 'novelId'), action),
      executeRepairAction: (novelId, action) => qualityRepairService.executeQualityRepairAction(requireId(novelId, 'novelId'), action),
    },
    aiPatch: {
      suggest: (request) => aiPatchService.suggestAiPatch(requireObject(request, 'request')),
      apply: (target, patch) => aiPatchService.applyAiPatch(requireObject(target, 'target'), patch),
    },
    embedding: {
      reindex: async (novelId) => {
        const targetNovelId = requireId(novelId, 'novelId')
        const chapters = chapterService.listChapters(targetNovelId)
        let succeeded = 0
        let failed = 0
        for (const chapter of chapters) {
          try {
            await embeddingService.generateChapterEmbeddings(targetNovelId, chapter.id)
            succeeded += 1
          } catch {
            failed += 1
          }
        }
        return { novelId: targetNovelId, succeeded, failed }
      },
    },
    style: {
      analyze: (text, modelConfigId) => styleAnalysisService.analyzeReferenceText(text, modelConfigId),
      create: (novelId, name, text, modelConfigId) => styleAnalysisService.createStyleFingerprint(novelId, name, text, modelConfigId),
      createFromChapters: (novelId, name, chapterIds, modelConfigId) => styleAnalysisService.createStyleFingerprintFromChapters(
        requireId(novelId, 'novelId'),
        name,
        Array.isArray(chapterIds) ? chapterIds.map((id) => requireId(id, 'chapterId')) : [],
        modelConfigId,
      ),
      get: (id) => styleAnalysisService.getStyleFingerprint(requireId(id)),
      list: (novelId) => styleAnalysisService.listStyleFingerprints(novelId),
      delete: (id) => styleAnalysisService.deleteStyleFingerprint(requireId(id)),
      setActive: (novelId, fingerprintId) => styleAnalysisService.setActiveStyleFingerprint(
        requireId(novelId, 'novelId'),
        fingerprintId === null || fingerprintId === undefined ? null : requireId(fingerprintId, 'fingerprintId'),
      ),
      resolveActive: (novelId) => styleAnalysisService.resolveActiveStyleFingerprint(requireId(novelId, 'novelId')),
      abTest: (novelId, fingerprintId, sceneBrief, modelConfigId) => styleAnalysisService.runStyleAbTest(
        requireId(novelId, 'novelId'),
        requireId(fingerprintId, 'fingerprintId'),
        sceneBrief,
        modelConfigId,
      ),
    },
    parallel: {
      analyzePlan: (novelId, chapterStart, chapterEnd) => parallelGenerationService.identifyParallelizableSegments(requireId(novelId, 'novelId'), chapterStart, chapterEnd),
      getWorldState: (novelId, atChapterNum) => parallelGenerationService.buildSharedWorldState(requireId(novelId, 'novelId'), atChapterNum),
      mergeOutputs: (segments) => parallelGenerationService.mergeParallelOutputs(segments),
    },
  }

  return { handlers, closeDb }
}

function serializeError(error) {
  console.error('[local-web-backend]', error)
  return {
    code: typeof error === 'object' && error && typeof error.code === 'string'
      ? error.code
      : 'common.executionFailed',
    message: error instanceof Error ? error.message : '本地后端执行失败',
    detail: error instanceof Error ? error.stack || error.message : String(error),
  }
}

function getCorsHeaders(req) {
  const origin = req.headers.origin || ''
  const allowOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(origin)
    ? origin
    : `http://${host}:4175`
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin',
  }
}

function writeJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...getCorsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function openWebEventStream(req, res) {
  res.writeHead(200, {
    ...getCorsHeaders(req),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')
  webEventClients.add(res)
  res.on('close', () => webEventClients.delete(res))
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function start() {
  await app.whenReady()
  const runtime = createRuntime()

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders(req))
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      writeJson(req, res, 200, {
        ok: true,
        data: {
          app: 'NovelForge local web backend',
          version: BACKEND_VERSION,
          storage: 'ready',
        },
      })
      return
    }

    if (req.method === 'GET' && req.url === '/events') {
      openWebEventStream(req, res)
      return
    }

    if (req.method !== 'POST' || req.url !== '/rpc') {
      writeJson(req, res, 404, { ok: false, error: { code: 'localBackend.notFound', message: '接口不存在' } })
      return
    }

    try {
      const body = await readRequestJson(req)
      const service = typeof body.service === 'string' ? body.service : ''
      const method = typeof body.method === 'string' ? body.method : ''
      const args = Array.isArray(body.args) ? body.args : []
      const serviceHandlers = runtime.handlers[service]
      const handler = serviceHandlers && serviceHandlers[method]
      if (typeof handler !== 'function') {
        writeJson(req, res, 404, {
          ok: false,
          error: { code: 'localBackend.methodNotFound', message: `未实现本地后端接口：${service}.${method}` },
        })
        return
      }

      const data = await handler(...args)
      writeJson(req, res, 200, { ok: true, data })
    } catch (error) {
      writeJson(req, res, 200, { ok: false, error: serializeError(error) })
    }
  })

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[local-web-backend] 端口 ${port} 已被占用——通常是上一次的后端进程没有退出。`)
      console.error('[local-web-backend] Windows 处理：netstat -ano | findstr :8787 找到 PID 后 taskkill /PID <pid> /F，再重新运行 npm run dev:web。')
      console.error('[local-web-backend] 注意：旧进程运行的是旧代码，接口不全会导致网页数据看似"没同步"。')
    } else {
      console.error('[local-web-backend] server error:', error)
    }
    app.quit()
    process.exit(1)
  })

  server.listen(port, host, () => {
    console.log(`[local-web-backend] listening on http://${host}:${port}`)
    console.log('[local-web-backend] storage ready')
  })

  const eventHeartbeat = setInterval(() => {
    for (const client of webEventClients) {
      try {
        client.write(': heartbeat\n\n')
      } catch {
        webEventClients.delete(client)
      }
    }
  }, 15_000)
  eventHeartbeat.unref?.()

  const shutdown = () => {
    clearInterval(eventHeartbeat)
    for (const client of webEventClients) {
      try { client.end() } catch { /* ignore closed event streams */ }
    }
    webEventClients.clear()
    server.close(() => {
      runtime.closeDb()
      app.quit()
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((error) => {
  console.error('[local-web-backend] failed to start:', error)
  app.quit()
  process.exit(1)
})
