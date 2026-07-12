const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')

const workspaceRoot = path.resolve(__dirname, '..')
const testUserData = path.join(workspaceRoot, '.tmp-tests', 'mcp-user-data')
const launcher = path.join(workspaceRoot, 'scripts', 'run-novelforge-mcp.cjs')

async function main() {
  fs.mkdirSync(path.dirname(testUserData), { recursive: true })
  fs.rmSync(testUserData, { recursive: true, force: true })

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher],
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NOVELFORGE_USER_DATA_DIR: testUserData,
      NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1',
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'codex-mcp-contract-test', version: '1.0.0' })
  let stderr = ''

  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })

  try {
    await client.connect(transport)
    const listed = await client.listTools()
    const toolIds = listed.tools.map((tool) => tool.name).sort()
    assert(toolIds.includes('novelforge.capabilities.list'))
    assert(toolIds.includes('novelforge.projects.list'))
    assert(toolIds.includes('novelforge.characters.analyze_needs'))
    assert(toolIds.includes('novelforge.characters.generate_draft'))
    assert(toolIds.includes('novelforge.characters.review'))
    assert(toolIds.includes('novelforge.characters.commit_draft'))
    assert(toolIds.includes('novelforge.assets.generate_draft'))
    assert(toolIds.includes('novelforge.assets.review_draft'))
    assert(toolIds.includes('novelforge.quality.run_evaluation'))
    assert(toolIds.includes('novelforge.quality.run_semantic_evaluation'))
    assert(toolIds.includes('novelforge.quality.propose_repairs'))
    assert(toolIds.includes('novelforge.quality.apply_repair_draft'))
    assert(toolIds.includes('novelforge.quality.review_repair_draft'))
    assert(toolIds.includes('novelforge.quality.compare_runs'))
    assert(toolIds.includes('novelforge.artifacts.get'))
    assert(toolIds.includes('novelforge.audit.query'))
    assert(toolIds.includes('novelforge.recommendation.run_preflight'))

    const capabilities = await client.callTool({
      name: 'novelforge.capabilities.list',
      arguments: {},
    })
    assert.equal(capabilities.isError, undefined)
    assert(capabilities.structuredContent)
    assert(Array.isArray(capabilities.structuredContent.tools))
    assert.equal(capabilities.structuredContent.tools.length, toolIds.length)

    const resources = await client.listResources()
    assert(resources.resources.some((resource) => resource.uri === 'novelforge://capabilities'))
    const resource = await client.readResource({ uri: 'novelforge://capabilities' })
    const document = JSON.parse(resource.contents[0].text)
    assert.equal(document.server.name, 'novelforge')
    assert.equal(document.tools.length, toolIds.length)
    assert(!document.grantedScopes.includes('canon:write'))
    assert(!document.grantedScopes.includes('recommendation:record'))
    assert(document.grantedScopes.includes('quality:repair'))

    const deniedWrite = await client.callTool({
      name: 'novelforge.characters.commit_draft',
      arguments: {
        novelId: 1,
        draftArtifactId: 'art_missing',
        expectedContextVersion: 1,
        expectedContentHash: `sha256:${'a'.repeat(64)}`,
        idempotencyKey: 'mcp-test-commit',
      },
    })
    assert.equal(deniedWrite.isError, true)
    assert.match(deniedWrite.content[0].text, /AUTH_SCOPE_REQUIRED/)

    process.stdout.write(`PASS NovelForge MCP: tools=${toolIds.length}, resources=${resources.resources.length}\n`)
  } catch (error) {
    if (stderr.trim()) process.stderr.write(stderr)
    throw error
  } finally {
    await client.close().catch(() => undefined)
    fs.rmSync(testUserData, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
