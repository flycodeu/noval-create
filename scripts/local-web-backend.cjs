const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const host = process.env.NOVELFORGE_WEB_BACKEND_HOST || '127.0.0.1'
const port = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 8787)
const MASKED_KEY = '已设置'
const BACKEND_VERSION = 2

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
  const chapterService = requireProject('electron/services/chapter.service.ts')
  const characterService = requireProject('electron/services/character.service.ts')
  const mapService = requireProject('electron/services/map.service.ts')
  const itemService = requireProject('electron/services/item.service.ts')
  const storyThreadService = requireProject('electron/services/story-thread.service.ts')
  const factionService = requireProject('electron/services/faction.service.ts')
  const storyStructureService = requireProject('electron/services/story-structure.service.ts')
  const timelineService = requireProject('electron/services/timeline.service.ts')
  const { buildAiModelRouteReport, buildChatOptionsFromRoute, resolveAiExecutionMode } = requireProject('electron/services/ai-engine.service.ts')
  const { appendVariationMessage, buildVariationDigest, isCandidateTooSimilar } = requireProject('electron/services/variation-control.service.ts')
  const { requireId, requireObject } = requireProject('electron/utils/ipc-validate.ts')
  const { throwUserFacingError } = requireProject('electron/utils/user-facing-error.ts')

  initDb()

  function getDatabasePath() {
    return path.join(app.getPath('userData'), 'novelforge.db')
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
    })
  }

  function createModel(data) {
    const payload = { ...requireObject(data, 'data') }
    const db = getDb()
    const provider = modelService.normalizeModelProvider(payload.provider)
    if (!modelService.isSupportedModelProvider(provider)) {
      throwUserFacingError('model.unknownProvider', { provider })
    }
    if (provider !== 'custom' && (!payload.apiKey || payload.apiKey === MASKED_KEY)) {
      throwUserFacingError('model.apiKeyRequired')
    }
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
    if (providerChanged && provider !== 'custom' && !payload.apiKey) {
      throwUserFacingError('model.apiKeyRequired')
    }
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
    },
    model: {
      list: listModels,
      create: createModel,
      update: updateModel,
      delete: (id) => getDb().delete(schema.modelConfigs).where(eq(schema.modelConfigs.id, requireId(id))).run(),
      setDefault: (id) => {
        const modelId = requireId(id)
        getDb().update(schema.modelConfigs).set({ isDefault: 0 }).run()
        getDb().update(schema.modelConfigs).set({ isDefault: 1 }).where(eq(schema.modelConfigs.id, modelId)).run()
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
    },
    // 只读数据透传：让网页端展示真实数据库内容（写操作仍留在 Electron 桌面端）。
    novel: {
      list: (filters) => novelService.listNovels(filters),
      get: (id) => novelService.getNovel(requireId(id)),
      stats: (id) => novelService.getNovelStats(requireId(id)),
    },
    chapter: {
      list: (novelId) => chapterService.listChapters(requireId(novelId, 'novelId')),
      get: (id) => chapterService.getChapter(requireId(id)),
    },
    character: {
      list: (novelId) => characterService.listCharacters(novelId),
      get: (id) => characterService.getCharacter(id),
      getStats: (filters) => characterService.getCharacterStats(filters),
      getFilterOptions: (novelId) => characterService.getCharacterFilterOptions(novelId),
      getGraph: (filters) => characterService.getCharacterGraph(filters),
    },
    map: {
      getTree: (novelId) => mapService.getMapTree(novelId),
      queryNodes: (filters) => mapService.queryMapNodes(filters),
      getGraph: (filters) => mapService.getMapGraph(filters),
      getRelations: (novelId, focusNodeId) => mapService.getMapRelations(novelId, focusNodeId),
      getStats: (novelId) => mapService.getMapStats(novelId),
      getNode: (id) => mapService.getMapNode(id),
      searchNodes: (novelId, keyword, limit) => mapService.searchMapNodes(novelId, keyword, limit),
    },
    item: {
      list: (novelId) => itemService.listStoryItems(novelId),
      query: (filters) => itemService.queryStoryItems(filters),
      getStats: (filters) => itemService.getStoryItemStats(filters),
      getFilterOptions: (novelId) => itemService.getStoryItemFilterOptions(novelId),
      get: (id) => itemService.getStoryItem(id),
      getDetailContext: (id) => itemService.getStoryItemDetailContext(id),
    },
    thread: {
      list: (novelId) => storyThreadService.listStoryThreads(novelId),
      get: (id) => storyThreadService.getStoryThread(id),
      getStats: (filters) => storyThreadService.getStoryThreadStats(filters),
    },
    faction: {
      list: (novelId) => factionService.listFactions(requireId(novelId, 'novelId')),
      getGraph: (filters) => factionService.getFactionGraph(filters),
    },
    structure: {
      getTree: (novelId) => storyStructureService.listStoryStructure(novelId),
    },
    outline: {
      getArcs: (novelId) => getDb().select().from(schema.storyArcs)
        .where(eq(schema.storyArcs.novelId, requireId(novelId, 'novelId')))
        .all(),
    },
    timeline: {
      list: (novelId) => timelineService.listTimelineEvents(novelId),
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

  server.listen(port, host, () => {
    console.log(`[local-web-backend] listening on http://${host}:${port}`)
    console.log('[local-web-backend] storage ready')
  })

  const shutdown = () => {
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
