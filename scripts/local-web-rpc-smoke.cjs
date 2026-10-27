const assert = require('node:assert/strict')
const { createServer } = require('node:http')

const BACKEND_URL = process.env.NOVELFORGE_LOCAL_BACKEND || 'http://127.0.0.1:8787/rpc'
const EVENT_STREAM_URL = BACKEND_URL.replace(/\/rpc$/, '/events')

async function assertEventStream() {
  const controller = new AbortController()
  const response = await fetch(EVENT_STREAM_URL, { signal: controller.signal })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
  assert.ok(response.body)
  const reader = response.body.getReader()
  const first = await reader.read()
  const text = new TextDecoder().decode(first.value)
  assert.match(text, /: connected/)
  await reader.cancel()
  controller.abort()
}

async function assertTaskEventStream(novelId) {
  const controller = new AbortController()
  const response = await fetch(EVENT_STREAM_URL, { signal: controller.signal })
  assert.equal(response.status, 200)
  assert.ok(response.body)
  const reader = response.body.getReader()
  const connected = await reader.read()
  assert.match(new TextDecoder().decode(connected.value), /: connected/)

  const taskId = Number(await rpc('chapterBatch', 'startAutoGenerate', [novelId, { chapterIds: [] }]))
  assert.ok(taskId > 0)
  let captured = ''
  for (let attempt = 0; attempt < 10 && !captured.includes('task:progress'); attempt += 1) {
    const next = await reader.read()
    if (next.done) break
    captured += new TextDecoder().decode(next.value)
  }
  assert.match(captured, /task:progress/)
  assert.match(captured, new RegExp(`\\"taskId\\":${taskId}`))
  await reader.cancel()
  controller.abort()
}

async function rpcPayload(service, method, args = []) {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, method, args }),
  })
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
  return response.json()
}

async function rpc(service, method, args = []) {
  const payload = await rpcPayload(service, method, args)
  if (!payload.ok) throw new Error(payload.error?.message || `${service}.${method} failed`)
  return payload.data
}

async function expectRpcError(service, method, args, code) {
  const payload = await rpcPayload(service, method, args)
  assert.equal(payload.ok, false)
  assert.equal(payload.error?.code, code)
}

async function assertConcurrentHttpClients(novelId) {
  const clientCount = 24
  const responses = await Promise.all(Array.from({ length: clientCount }, () => Promise.all([
    rpcPayload('novel', 'get', [novelId]),
    rpcPayload('novel', 'stats', [novelId]),
  ])))
  responses.flat().forEach((payload) => {
    assert.equal(payload.ok, true, JSON.stringify(payload))
  })
}

async function assertModelAndSearchSettingsRpc() {
  const requests = []
  const testKey = 'test-only-model-discovery-rpc-key'
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk.toString('utf8')
    const body = raw ? JSON.parse(raw) : null
    requests.push({ url: request.url, authorization: request.headers.authorization, body,
      method: request.method, braveKey: request.headers['x-subscription-token'] })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    const source = { title: '受控博物馆资料', url: 'https://museum.example/reference', snippet: '受控网页摘要，不是模型回答。' }
    const payload = request.url.endsWith('/models') ? { data: [{ id: 'rpc-model-b' }, { id: 'rpc-model-a' }] }
      : request.url.endsWith('/responses') ? { status: 'completed', output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: source.url, title: source.title }] } },
        { type: 'message', status: 'completed', content: [{ type: 'output_text', text: '不能冒充网页原文的模型回答', annotations: [] }] },
      ] }
        : request.url.endsWith('/chat/completions') ? { choices: [{ finish_reason: 'stop', message: {
          content: '不能冒充网页原文的模型回答', annotations: [{ type: 'url_citation', url_citation: source }],
        } }] }
          : request.url.includes('/brave') ? { web: { results: [{ ...source, description: source.snippet }] } }
            : { results: [{ ...source, content: source.snippet, rerank_score: 3, date: '2026-10-18' }] }
    response.end(JSON.stringify(payload))
  })
  let configId = 0
  let researchNovelId = 0
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
    const before = await rpc('model', 'list')
    const input = { provider: 'custom', apiKey: testKey, baseUrl }
    const expected = { models: ['rpc-model-a', 'rpc-model-b'] }
    assert.deepEqual(await rpc('model', 'discover', [input]), expected)
    assert.deepEqual(await rpc('model', 'list'), before, 'unsaved model discovery must not create a configuration')

    configId = Number(await rpc('model', 'create', [{ ...input, name: 'Model discovery RPC fixture', modelId: 'rpc-model-a' }]))
    const saved = (await rpc('model', 'list')).find(config => config.id === configId)
    assert.equal(saved.apiKey, '已设置', 'saved model keys must stay masked across RPC')
    assert.deepEqual(await rpc('model', 'discover', [{ ...input, apiKey: '已设置', configId }]), expected)
    assert.deepEqual(requests.map(({ url, authorization }) => ({ url, authorization })), [
      { url: '/v1/models', authorization: `Bearer ${testKey}` },
      { url: '/v1/models', authorization: `Bearer ${testKey}` },
    ])
    await expectRpcError('model', 'discover', [{ ...input, apiKey: '已设置', configId, baseUrl: `${baseUrl}/changed` }], 'modelDiscovery.credentialsChanged')
    assert.equal(requests.length, 2, 'changing a URL must not forward the saved key')
    await rpc('model', 'discover', [{ ...input, apiKey: '' }])
    assert.deepEqual({ url: requests.at(-1).url, authorization: requests.at(-1).authorization },
      { url: '/v1/models', authorization: undefined }, 'an explicitly cleared custom key is not silently reused')

    const disabled = await rpc('sourceSearch', 'updateSettings', [{ provider: 'disabled' }])
    assert.equal((await rpc('sourceSearch', 'test')).success, false, 'no-argument search tests must cross JSON RPC without a null payload')
    const draft = await rpc('sourceSearch', 'test', [{ provider: 'disabled', tavilyApiKey: 'test-only-unsaved-search-key' }])
    assert.equal(draft.success, false)
    assert.deepEqual(await rpc('sourceSearch', 'getSettings'), disabled, 'testing a draft must not save its provider or keys')
    const platformFixtures = [
      ['deepseek', 'deepseek', '/v1/tools/search', ''],
      ['openai', 'responses', '/v1/responses', 'rpc-search-model'],
      ['openai', 'chat-completions', '/v1/chat/completions', 'rpc-chat-search'],
      ['custom', 'tavily', '/v1/search', ''],
      ['custom', 'brave', '/v1/brave/search', ''],
    ]
    for (const [slot, protocol, endpoint, model] of platformFixtures) {
      const platform = { protocol, baseUrl: protocol === 'brave' ? `${baseUrl}/brave/search` : baseUrl,
        model, apiKey: `test-only-${slot}-${protocol}-key` }
      const result = await rpc('sourceSearch', 'test', [{ provider: slot, platforms: { [slot]: platform } }])
      assert.equal(result.success, true, `${slot}/${protocol}: ${result.info}`)
      assert.equal(result.providerName, slot)
      assert.match(result.info, /1 条/)
      assert.equal(requests.at(-1).url.split('?')[0], endpoint)
      assert.equal(requests.at(-1)[protocol === 'brave' ? 'braveKey' : 'authorization'],
        protocol === 'brave' ? platform.apiKey : `Bearer ${platform.apiKey}`)
      assert.deepEqual(await rpc('sourceSearch', 'getSettings'), disabled, 'each unsaved protocol test is read-only')
    }
    const platforms = {
      deepseek: { protocol: 'deepseek', baseUrl, model: '', apiKey: 'test-only-deepseek-persisted-key' },
      openai: { protocol: 'responses', baseUrl, model: 'rpc-search-model', apiKey: 'test-only-openai-persisted-key' },
      custom: { protocol: 'chat-completions', baseUrl, model: 'rpc-chat-search', apiKey: 'test-only-custom-persisted-key' },
    }
    const savedSearch = await rpc('sourceSearch', 'updateSettings', [{ provider: 'deepseek', platforms }])
    for (const slot of Object.keys(platforms)) {
      assert.equal(savedSearch.platforms[slot].apiKeySet, true)
      assert.equal(savedSearch.platforms[slot].apiKey, undefined)
      assert(!JSON.stringify(savedSearch).includes(platforms[slot].apiKey), 'RPC returns flags, never search credentials')
    }
    assert.equal((await rpc('sourceSearch', 'test')).success, true, 'no-argument tests use the selected persisted provider')
    assert.equal(requests.at(-1).authorization, `Bearer ${platforms.deepseek.apiKey}`)
    for (const slot of Object.keys(platforms)) {
      const result = await rpc('sourceSearch', 'test', [{ provider: slot, platforms: { [slot]: { apiKey: '已设置' } } }])
      assert.equal(result.success, true, 'masked credentials can be reused only within their own unchanged platform')
      assert.equal(requests.at(-1).authorization, `Bearer ${platforms[slot].apiKey}`)
    }
    const countBeforeGuard = requests.length
    for (const slot of Object.keys(platforms)) {
      const changed = { provider: slot, platforms: { [slot]: { baseUrl: `${baseUrl}/changed`, apiKey: '已设置' } } }
      assert.equal((await rpc('sourceSearch', 'test', [changed])).success, false)
      const rejectedSave = await rpcPayload('sourceSearch', 'updateSettings', [changed])
      assert.equal(rejectedSave.ok, false)
      assert.equal(rejectedSave.error.code, 'sourceSearch.credentialsChanged')
      assert.match(rejectedSave.error.message, /重新填写.*API Key/)
      assert(!JSON.stringify(rejectedSave).includes(platforms[slot].apiKey), 'actionable RPC errors never expose stored credentials')
    }
    assert.equal(requests.length, countBeforeGuard, 'changed URLs must never receive the saved key')
    assert.deepEqual(await rpc('sourceSearch', 'getSettings'), savedSearch, 'rejected saves leave all platform slots intact')
    const clearedDraft = await rpc('sourceSearch', 'test', [{ provider: 'deepseek', platforms: { deepseek: { apiKey: '' } } }])
    assert.equal(clearedDraft.success, false)
    assert.equal(requests.length, countBeforeGuard, 'cleared drafts must not silently reuse saved credentials')
    assert.deepEqual(await rpc('sourceSearch', 'getSettings'), savedSearch)

    researchNovelId = Number(await rpc('novel', 'create', [{ title: '多平台资料 RPC 隔离验收', launchMode: 'fast_launch', operatingMode: 'standard_longform' }]))
    const beforeResearch = await rpc('novel', 'get', [researchNovelId])
    const research = await rpc('sourceSearch', 'research', [researchNovelId, '检索明代客栈生活资料'])
    assert.equal(research.updated, true)
    assert.ok(research.sources.length > 0)
    const afterResearch = await rpc('novel', 'get', [researchNovelId])
    const entries = JSON.parse(afterResearch.sourceLedgerJson)
    assert(entries.length > 0 && entries.every(entry => entry.canonDecision === 'reference_only' && entry.provider === 'deepseek'))
    for (const key of Object.keys(beforeResearch)) {
      if (!['sourceLedgerJson', 'contextVersion', 'updatedAt'].includes(key)) {
        assert.deepEqual(afterResearch[key], beforeResearch[key], `research must not change formal project field ${key}`)
      }
    }
    const beforeCached = requests.length
    assert.equal((await rpc('sourceSearch', 'research', [researchNovelId, '检索明代客栈生活资料'])).cached, true)
    assert.equal(requests.length, beforeCached, 'cached requests do not call any paid provider again')
    await rpc('sourceSearch', 'updateSettings', [{ provider: 'disabled', tavilyApiKey: '', braveApiKey: '',
      platforms: Object.fromEntries(Object.keys(platforms).map(slot => [slot, { apiKey: '' }])) }])
    console.log('PASS model/search RPC: model discovery, five loopback search protocols, non-persisting drafts, isolated saved keys, URL guards, research reference-only writeback and cache')
  } finally {
    try {
      if (configId > 0) await rpc('model', 'delete', [configId])
      if (researchNovelId > 0) await rpc('novel', 'delete', [researchNovelId])
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}

async function assertNovelCoverRpc(novelId) {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  let imageRequests = 0
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(request.url, '/v1/images/generations')
    assert.equal(body.model, 'gpt-image-1')
    assert.equal(body.response_format, undefined)
    imageRequests++
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: png }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let configId
  try {
    configId = Number(await rpc('model', 'create', [{ provider: 'custom', name: 'Cover RPC fixture', modelId: 'text-model', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }]))
    const before = await rpc('novel', 'get', [novelId])
    const image = await rpc('novel', 'generateCover', [novelId, { configId, modelId: 'gpt-image-1', prompt: '一盏灯', size: '1024x1536' }])
    assert.match(image, /^data:image\/jpeg;base64,/)
    assert.equal(imageRequests, 1)
    assert.deepEqual(await rpc('novel', 'get', [novelId]), before, 'web generation never saves its candidate')
    const saved = await rpc('novel', 'setCover', [novelId, { image, expectedCoverImage: null }])
    assert.ok(saved.coverImage)
    assert.equal(saved.contextVersion, before.contextVersion)
    assert.equal((await rpc('novel', 'list')).find(book => book.id === novelId).coverImage, saved.coverImage)
    await expectRpcError('novel', 'setCover', [novelId, { image: null, expectedCoverImage: null }], 'cover.conflict')
    await rpc('novel', 'setCover', [novelId, { image: null, expectedCoverImage: saved.coverImage }])
    const cleared = await rpc('novel', 'get', [novelId])
    for (const field of ['title', 'synopsis', 'settingsJson', 'contextVersion']) assert.deepEqual(cleared[field], before[field])
    console.log('PASS cover Web RPC: loopback image generation, explicit adoption, list refresh, CAS conflict and clear preserve story data')
  } finally {
    if (configId) await rpc('model', 'delete', [configId])
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

async function main() {
  const stamp = Date.now().toString()
  let novelId = 0
  try {
    await assertEventStream()
    const capabilities = await rpc('app', 'getCapabilities')
    assert.equal(capabilities.eventStreaming, true)
    const zhuque = await rpc('zhuque', 'getSettings')
    assert.deepEqual(zhuque, { enabled: false, autoDetect: true, apiKeySet: false })
    const disabled = await rpc('zhuque', 'updateSettings', [{ enabled: false, autoDetect: false }])
    assert.deepEqual(disabled, { enabled: false, autoDetect: false, apiKeySet: false })
    assert.equal((await rpc('zhuque', 'test')).success, false)
    await expectRpcError('zhuque', 'localKey', [], 'runtime.methodNotAllowed')
    await assertModelAndSearchSettingsRpc()
    const retention = await rpc('task', 'getRetentionSettings')
    assert.deepEqual(retention, { enabled: false, keepDays: 30, cleanTasks: true, cleanLogs: true })
    const policy = { ...retention, keepDays: 60 }
    assert.deepEqual(await rpc('task', 'updateRetentionSettings', [policy]), policy)
    const cleanupPreview = await rpc('task', 'previewCleanup', [policy])
    assert.equal(cleanupPreview.taskCount, 0)
    const nothingToClean = await rpc('task', 'runCleanup', [policy])
    assert.equal(nothingToClean.deletedCount, 0)
    assert.deepEqual(nothingToClean.deletedTaskIds, [])
    assert.equal(nothingToClean.deletedLogs, 0)
    assert.equal((await rpcPayload('task', 'updateRetentionSettings', [{ ...policy, keepDays: 0 }])).ok, false)

    novelId = Number(await rpc('novel', 'create', [{
      title: `Web RPC smoke ${stamp}`,
      synopsis: '本地 Web RPC 一致性验收临时项目。',
      launchMode: 'fast_launch',
      operatingMode: 'standard_longform',
    }]))
    assert.ok(novelId > 0)
    await assertNovelCoverRpc(novelId)
    await assertTaskEventStream(novelId)

    const before = await rpc('novel', 'get', [novelId])
    assert.equal(before.title, `Web RPC smoke ${stamp}`)
    await rpc('novel', 'update', [novelId, { title: `Web RPC smoke ${stamp} updated` }])
    const after = await rpc('novel', 'get', [novelId])
    assert.equal(after.title, `Web RPC smoke ${stamp} updated`)
    await rpc('novel', 'update', [novelId, { synopsis: '支持预期版本的兼容保存。' }, { expectedContextVersion: after.contextVersion }])
    const guarded = await rpc('novel', 'get', [novelId])
    assert.equal(guarded.synopsis, '支持预期版本的兼容保存。')
    const stale = await rpcPayload('novel', 'update', [novelId, { synopsis: '过期客户端不得覆盖。' }, { expectedContextVersion: after.contextVersion }])
    assert.equal(stale.ok, false, 'the browser RPC forwards the optional expected version to the shared writer')
    assert.equal(stale.error.code, 'novel.contextVersionConflict', 'the conflict is transported as an actionable user-facing error')
    assert.match(stale.error.message, /其他任务修改/)
    assert.equal((await rpc('novel', 'get', [novelId])).synopsis, guarded.synopsis)
    await assertConcurrentHttpClients(novelId)
    const stats = await rpc('novel', 'stats', [novelId])
    assert.equal(typeof stats.totalChapters, 'number')

    const arcId = Number(await rpc('outline', 'createArc', [novelId, {
      id: 99999998,
      novelId: 99999999,
      arcName: '边界测试故事弧',
      arcOrder: 1,
    }]))
    assert.ok(arcId > 0)
    let arcs = await rpc('outline', 'getArcs', [novelId])
    assert.equal(arcs.some((arc) => arc.id === arcId && arc.novelId === novelId), true)

    await rpc('outline', 'updateArc', [arcId, {
      id: 99999997,
      novelId: 99999999,
      arcName: '边界测试故事弧已更新',
    }])
    arcs = await rpc('outline', 'getArcs', [novelId])
    assert.equal(arcs.some((arc) => (
      arc.id === arcId
      && arc.novelId === novelId
      && arc.arcName === '边界测试故事弧已更新'
    )), true)

    await expectRpcError('outline', 'generateArcs', [99999999], 'novel.notFound')
    await expectRpcError('outline', 'generateChapterOutlines', [99999999, { batchSize: 4 }], 'storyArc.notFound')

    const tools = await rpc('agentTools', 'list', [])
    assert(tools.some((tool) => tool.id === 'novelforge.workflows.start'))
    const sharedRead = await rpc('agentTools', 'call', [{ toolId: 'novelforge.projects.list', input: {} }])
    assert.equal(sharedRead.ok, true)
    assert(JSON.stringify(sharedRead.data).includes(`Web RPC smoke ${stamp} updated`))
    await expectRpcError('agentTools', 'approve', [{}], 'runtime.methodNotAllowed')
    await expectRpcError('app', 'openReleasePage', [], 'runtime.methodNotAllowed')

    const deleted = await rpc('novel', 'delete', [novelId])
    assert.equal(deleted ?? null, null)
    novelId = 0
    const missing = await rpc('novel', 'get', [Number(before.id || 0) || Number(after.id || 0) || -1])
    assert.equal(missing ?? null, null)
    console.log('PASS shared runtime Web RPC: CRUD, concurrent reads, outline handlers, task events, creative tools and native-operation denylist')
  } finally {
    if (novelId > 0) {
      try { await rpc('novel', 'delete', [novelId]) } catch (error) { console.error('[local-web-rpc-smoke] cleanup failed:', error.message) }
    }
  }
}

main().catch((error) => {
  console.error('[local-web-rpc-smoke] failed:', error.message)
  process.exitCode = 1
})
