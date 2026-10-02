const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')

const workspaceRoot = path.resolve(__dirname, '..')
const testRoot = path.resolve(workspaceRoot, '.tmp-tests')
const testUserData = path.resolve(testRoot, `packaged-mcp-${process.pid}-${randomUUID()}`)
const bundledEntry = process.argv.includes('--bundle') ? path.resolve(workspaceRoot, 'out', 'main', 'main.js') : null
const executable = bundledEntry ? require('electron') : path.resolve(workspaceRoot, 'release', 'win-unpacked', 'NovelForge.exe')

function verifyTestDirectory(target) {
  const workspace = fs.realpathSync(workspaceRoot)
  const root = fs.realpathSync(testRoot)
  const rootRelative = path.relative(workspace, root)
  assert(rootRelative && rootRelative !== '..' && !rootRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(rootRelative))
  const relative = path.relative(root, fs.realpathSync(target))
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function removeWithRetry(target) {
  verifyTestDirectory(target)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
      return
    } catch (error) {
      if (error?.code !== 'EBUSY' || attempt === 19) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

async function withTimeout(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Packaged MCP smoke requires Windows.')
  assert(fs.existsSync(executable), `Packaged executable missing: ${executable}`)
  if (bundledEntry) assert(fs.existsSync(bundledEntry), `Bundled MCP entry missing: ${bundledEntry}`)
  fs.mkdirSync(testUserData, { recursive: true })
  verifyTestDirectory(testUserData)
  const seedEnv = {
    ...process.env,
    NOVELFORGE_USER_DATA_DIR: testUserData,
    NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1',
  }
  delete seedEnv.ELECTRON_RUN_AS_NODE
  const seed = spawnSync(require('electron'), ['--disable-gpu', path.resolve(__dirname, 'seed-packaged-mcp-smoke.cjs')], {
    cwd: workspaceRoot,
    env: seedEnv,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  assert.equal(seed.status, 0, `Failed to seed test project: ${seed.stderr || seed.error || ''}`)
  const transport = new StdioClientTransport({
    command: executable,
    args: bundledEntry ? [bundledEntry, '--mcp'] : ['--mcp'],
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NOVELFORGE_USER_DATA_DIR: testUserData,
      NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1',
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'packaged-mcp-smoke', version: '1.0.0' })
  const lockPath = path.join(testUserData, 'novelforge.single-writer.lock')
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })

  try {
    await withTimeout(client.connect(transport), 30_000, 'MCP connect')
    const listed = await withTimeout(client.listTools(), 15_000, 'tools/list')
    const toolIds = listed.tools.map((tool) => tool.name)
    assert(toolIds.includes('novelforge.projects.list'))
    assert(toolIds.includes('novelforge.assets.import_draft'))
    assert(toolIds.includes('novelforge.artifacts.get'))
    const resource = await withTimeout(client.readResource({ uri: 'novelforge://capabilities' }), 15_000, 'resources/read')
    const capabilities = JSON.parse(resource.contents[0].text)
    const packageVersion = require('../package.json').version
    if (!bundledEntry) assert.equal(capabilities.server.version, packageVersion)
    assert(!capabilities.grantedScopes.includes('canon:write'))
    assert.equal(fs.existsSync(lockPath), false, 'idle MCP connection must not hold the desktop writer lock')
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      identity: 'desktop-main',
      startedAt: new Date().toISOString(),
      hostname: 'packaged-smoke',
    }))
    const busy = await client.callTool({ name: 'novelforge.projects.list', arguments: {} })
    assert.equal(busy.isError, true, 'MCP calls must respect an active desktop writer')
    assert.match(busy.content[0].text, /桌面端正在使用数据库/)
    fs.unlinkSync(lockPath)
    const projectsResult = await client.callTool({ name: 'novelforge.projects.list', arguments: {} })
    assert.equal(projectsResult.isError, undefined)
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    assert.equal(fs.existsSync(lockPath), false, 'MCP must release the writer lock after its tool call')
    const project = projectsResult.structuredContent.projects[0]
    assert.equal(project.title, '安装版 MCP 验收')
    const output = JSON.stringify({ readerPromise: '围绕边境商路的取舍展开；主角目标待确认。' })
    const imported = await client.callTool({
      name: 'novelforge.assets.import_draft',
      arguments: {
        novelId: project.id,
        expectedContextVersion: project.contextVersion,
        assetType: 'project_brief',
        title: '第一阶段立项候选',
        userRequest: '以边境商路为背景，先分析项目立项。',
        analysis: '目前仅有背景方向，主角身份和阻力来源待确认。',
        stageScope: '只完成项目立项',
        unresolvedQuestions: ['主角身份是什么？', '主要阻力来自哪里？'],
        outputFormat: 'json',
        output,
        idempotencyKey: `packaged-import-${randomUUID()}`,
      },
    })
    assert.equal(imported.isError, undefined, JSON.stringify(imported.content))
    const artifactId = imported.structuredContent.draftArtifact.id
    const detail = await client.callTool({ name: 'novelforge.artifacts.get', arguments: { artifactId } })
    assert.equal(detail.isError, undefined)
    assert.equal(detail.structuredContent.artifact.content.output, output)
    assert.equal(detail.structuredContent.artifact.content.externalSource.stageScope, '只完成项目立项')
    const after = await client.callTool({ name: 'novelforge.projects.get', arguments: { novelId: project.id } })
    assert.equal(after.structuredContent.project.contextVersion, project.contextVersion)
    assert(!after.structuredContent.project.availableAssets.includes('project_brief'))
    process.stdout.write(`PASS ${bundledEntry ? 'bundled' : 'packaged'} MCP ${packageVersion}: tools=${toolIds.length}, draft=${artifactId}\n`)
  } catch (error) {
    if (stderr.trim()) process.stderr.write(stderr)
    throw error
  } finally {
    await client.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
    await removeWithRetry(testUserData)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
