const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempBase = path.resolve(workspaceRoot, '.tmp-tests')
fs.mkdirSync(tempBase, { recursive: true })
const tempRoot = path.resolve(tempBase, `mcp-import-${process.pid}-${randomUUID()}`)
if (!tempRoot.startsWith(`${tempBase}${path.sep}`) || !fs.realpathSync(tempBase).startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', tempRoot)
app.disableHardwareAcceleration()
registerProjectTsRuntime(workspaceRoot)

async function main() {
  await app.whenReady()
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  const { novelForgeToolRegistry } = require('../electron/application/novelforge-tool-registry.ts')
  const { MCP_AGENT_TOOL_DEFAULT_SCOPES } = require('../src/shared/tool-contracts/index.ts')
  initDb()
  try {
    const sqlite = getSqlite()
    const novelId = Number(sqlite.prepare(`INSERT INTO novels (title, status, context_version) VALUES (?, ?, ?)`)
      .run('外部创作草稿测试', 'draft', 1).lastInsertRowid)
    const actor = { type: 'api_client', actorId: 'codex:test', clientId: 'codex' }
    const context = { actor, scopes: [...MCP_AGENT_TOOL_DEFAULT_SCOPES] }
    const input = {
      novelId,
      expectedContextVersion: 1,
      assetType: 'project_brief',
      title: '第一阶段立项',
      userRequest: '写一部边境商路背景的小说，先做立项。',
      analysis: '主角需要一个马上可兑现的目标；地名与制度缺资料，暂不虚构。',
      stageScope: '只做立项，不写正文',
      unresolvedQuestions: ['商路所处时代与交通方式待作者确认'],
      outputFormat: 'json',
      output: JSON.stringify({ readerPromise: '围绕边境商路展开，主角目标与阻力来源待确认。' }),
      idempotencyKey: `codex-import-${randomUUID()}`,
    }
    const invoke = (payload) => novelForgeToolRegistry.invoke({ toolId: 'novelforge.assets.import_draft', input: payload }, context)
    const first = await invoke(input)
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(first.data.draftArtifact.kind, 'generic_draft')
    assert.equal(first.data.draftArtifact.status, 'draft')
    assert.equal(first.data.draftArtifact.reviewArtifactId, null)
    assert.equal(first.data.draftArtifact.taskId, null)
    const artifact = sqlite.prepare('SELECT content_json, status, context_version FROM artifacts WHERE id = ?')
      .get(first.data.draftArtifact.id)
    const content = JSON.parse(artifact.content_json)
    assert.equal(content.externalSource.stageScope, input.stageScope)
    assert.equal(content.externalSource.userRequest, input.userRequest)
    assert.equal(content.output, input.output)
    assert.equal(artifact.status, 'draft')
    assert.equal(artifact.context_version, 1)
    const novel = sqlite.prepare('SELECT project_brief_json, context_version FROM novels WHERE id = ?').get(novelId)
    assert.equal(novel.project_brief_json, null, 'import must not update canonical project brief')
    assert.equal(novel.context_version, 1, 'import must not advance canonical context')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM tasks WHERE novel_id = ?').get(novelId).count, 0)

    const replay = await invoke(input)
    assert.equal(replay.ok, true)
    assert.equal(replay.data.draftArtifact.id, first.data.draftArtifact.id)
    assert.equal(replay.data.idempotentReplay, true)
    const conflict = await invoke({ ...input, output: '{"readerPromise":"另一份内容"}' })
    assert.deepEqual({ ok: conflict.ok, code: conflict.error?.code }, { ok: false, code: 'IDEMPOTENCY_KEY_CONFLICT' })
    const stale = await invoke({ ...input, expectedContextVersion: 2, idempotencyKey: `stale-${randomUUID()}` })
    assert.deepEqual({ ok: stale.ok, code: stale.error?.code }, { ok: false, code: 'CONTEXT_VERSION_CONFLICT' })
    const malformed = await invoke({ ...input, output: '{broken', idempotencyKey: `malformed-${randomUUID()}` })
    assert.deepEqual({ ok: malformed.ok, code: malformed.error?.code }, { ok: false, code: 'OUTPUT_SHAPE_INVALID' })
    process.stdout.write('PASS MCP import draft: persisted candidate, replay, stale guard, JSON guard, canonical unchanged\n')
  } finally {
    closeDb()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
  app.exit(0)
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
