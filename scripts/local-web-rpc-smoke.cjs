const assert = require('node:assert/strict')

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

async function main() {
  const stamp = Date.now().toString()
  let novelId = 0
  try {
    await assertEventStream()
    const capabilities = await rpc('app', 'getCapabilities')
    assert.equal(capabilities.eventStreaming, true)

    novelId = Number(await rpc('novel', 'create', [{
      title: `Web RPC smoke ${stamp}`,
      synopsis: '本地 Web RPC 一致性验收临时项目。',
      launchMode: 'fast_launch',
      operatingMode: 'standard_longform',
    }]))
    assert.ok(novelId > 0)
    await assertTaskEventStream(novelId)

    const before = await rpc('novel', 'get', [novelId])
    assert.equal(before.title, `Web RPC smoke ${stamp}`)
    await rpc('novel', 'update', [novelId, { title: `Web RPC smoke ${stamp} updated` }])
    const after = await rpc('novel', 'get', [novelId])
    assert.equal(after.title, `Web RPC smoke ${stamp} updated`)
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

    const request = {
      toolId: 'novelforge.characters.commit_draft',
      input: {
        novelId,
        draftArtifactId: 'missing-draft',
        expectedContextVersion: 1,
        expectedContentHash: `sha256:${'0'.repeat(64)}`,
        idempotencyKey: `web-rpc-smoke-${stamp}`,
      },
    }
    const beforeApproval = await rpc('agentTools', 'call', [request])
    assert.equal(beforeApproval.ok, false)
    assert.equal(beforeApproval.error.code, 'APPROVAL_REQUIRED')

    const approval = await rpc('agentTools', 'approve', [{ request }])
    assert.equal(approval.approved, true)
    assert.ok(approval.approvalId)

    const approvedCall = await rpc('agentTools', 'call', [{ ...request, approvalId: approval.approvalId }])
    assert.equal(approvedCall.ok, false)
    assert.equal(approvedCall.error.code, 'ARTIFACT_NOT_FOUND')

    const replay = await rpc('agentTools', 'call', [{ ...request, approvalId: approval.approvalId }])
    assert.equal(replay.ok, false)
    assert.equal(replay.error.code, 'APPROVAL_REQUIRED')

    const deleted = await rpc('novel', 'delete', [novelId])
    assert.equal(deleted ?? null, null)
    novelId = 0
    const missing = await rpc('novel', 'get', [Number(before.id || 0) || Number(after.id || 0) || -1])
    assert.equal(missing ?? null, null)
    console.log('PASS local web RPC: CRUD/stats, multi-client concurrency, outline handlers, event stream, and single-use agent approval flow')
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
