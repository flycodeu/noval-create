const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'workflow-node-integrity')
if (!tempRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}
fs.rmSync(tempRoot, { recursive: true, force: true })
fs.mkdirSync(tempRoot, { recursive: true })
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setName('NovelForge Workflow Node Test')
app.setPath('userData', tempRoot)
app.commandLine.appendSwitch('disable-gpu')
registerProjectTsRuntime(workspaceRoot)

function project(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

async function run() {
  await app.whenReady()
  const { initDb, closeDb, getSqlite } = project('electron/database/db.ts')
  const nodeService = project('electron/services/workflow-node.service.ts')
  initDb()
  try {
    const sqlite = getSqlite()
    const novelId = Number(sqlite.prepare("INSERT INTO novels (title, status, context_version) VALUES ('节点测试', 'draft', 1)").run().lastInsertRowid)
    const workflowTaskId = Number(sqlite.prepare("INSERT INTO tasks (novel_id, type, status, runner_type) VALUES (?, 'chapter_write', 'failed', 'workflow')").run(novelId).lastInsertRowid)

    const first = nodeService.beginWorkflowNode({
      workflowTaskId,
      novelId,
      chapterId: null,
      nodeKey: 'writer',
      inputHash: nodeService.hashWorkflowNodeInput({ prompt: 'first' }),
      contextVersion: 1,
      leaseOwner: 'test-worker',
    })
    assert.equal(first.attempt, 1)
    const snapshot = nodeService.recordWorkflowNodeSnapshot({
      nodeRunId: first.nodeRunId,
      leaseToken: first.leaseToken,
      payload: { output: 'immutable' },
    })
    const replayed = nodeService.recordWorkflowNodeSnapshot({
      nodeRunId: first.nodeRunId,
      leaseToken: 'no-longer-needed',
      payload: { output: 'different' },
    })
    assert.equal(replayed.id, snapshot.id)
    assert.equal(nodeService.getWorkflowNodeSnapshot(snapshot.id).payload.output, 'immutable')

    const failed = nodeService.beginWorkflowNode({
      workflowTaskId,
      novelId,
      nodeKey: 'critic',
      inputHash: nodeService.hashWorkflowNodeInput({ prompt: 'critic' }),
      contextVersion: 1,
      leaseOwner: 'test-worker',
    })
    nodeService.failWorkflowNode({
      nodeRunId: failed.nodeRunId,
      leaseToken: failed.leaseToken,
      status: 'failed',
      errorClass: 'network',
    })
    const plan = nodeService.prepareWorkflowNodeRetry(failed.nodeRunId)
    assert.equal(plan.source.status, 'failed')
    const retry = nodeService.beginWorkflowNode({
      workflowTaskId,
      novelId,
      nodeKey: 'critic',
      inputHash: plan.source.inputHash,
      contextVersion: plan.source.contextVersion,
      upstreamSnapshotId: plan.source.upstreamSnapshotId,
      retryOfNodeRunId: plan.source.id,
      retryReason: 'manual_retry:critic',
      leaseOwner: 'test-worker-2',
    })
    assert.equal(retry.attempt, 2)
    const retryRow = nodeService.getWorkflowNodeRun(retry.nodeRunId)
    assert.equal(retryRow.retryOfNodeRunId, failed.nodeRunId)
    assert.equal(retryRow.retryReason, 'manual_retry:critic')
    assert.equal(nodeService.listWorkflowNodeRuns({ workflowTaskId }).length, 3)
    nodeService.failWorkflowNode({ nodeRunId: retry.nodeRunId, leaseToken: retry.leaseToken, status: 'cancelled' })
  } finally {
    closeDb()
  }
  await app.quit()
  process.stdout.write('workflow-node integrity tests passed\n')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
