const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const workspaceRoot = path.resolve(__dirname, '..')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
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

function loadModule(relativePath, mocks = {}) {
  const entryPath = path.join(workspaceRoot, relativePath)
  delete require.cache[entryPath]

  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request]
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    return require(entryPath)
  } finally {
    Module._load = originalLoad
  }
}

function createTaskServiceMocks(task) {
  return {
    createTask: async () => task.id,
    getTaskRecord: (taskId) => (taskId === task.id ? task : null),
    parseTaskControl: (taskLike) => {
      if (!taskLike || !taskLike.controlJson) return {}
      return JSON.parse(taskLike.controlJson)
    },
    parseTaskProgress: (taskLike) => {
      if (!taskLike || !taskLike.progressJson) return {}
      return JSON.parse(taskLike.progressJson)
    },
    updateTask: (taskId, data) => {
      if (taskId !== task.id) return
      Object.assign(task, data)
    },
    updateTaskControl: (taskId, control) => {
      if (taskId !== task.id) return
      task.controlJson = JSON.stringify(control)
    },
    updateTaskProgress: (taskId, progress) => {
      if (taskId !== task.id) return
      task.progressJson = JSON.stringify(progress)
    },
    updateTaskStatus: (taskId, status, _sender, extra = {}) => {
      if (taskId !== task.id) return
      task.status = status
      Object.assign(task, extra)
    },
  }
}

function buildBatchModule(task, overrides = {}) {
  const taskServiceMocks = createTaskServiceMocks(task)
  return loadModule('electron/services/batch-workflow.service.ts', {
    '../database/db': { getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ all: () => [] }) }) }) }) }) },
    '../database/schema': { tasks: {} },
    '../utils/user-facing-error': {
      throwUserFacingError: (key) => {
        throw new Error(key)
      },
    },
    './character.service': { generateCharacterBatchChunk: async () => ({ ids: [], warning: '', batchDigest: '', majorGenerated: 0, minorGenerated: 0, antagonistGenerated: 0, supportingGenerated: 0 }) },
    './faction.service': { generateFactionBatchChunk: async () => ({ ids: [], warning: '', batchDigest: '' }) },
    './item.service': { generateStoryItemsBatchChunk: async () => ({ ids: [], warning: '', batchDigest: '' }) },
    './story-thread.service': { generateStoryThreadBatchChunk: async () => ({ ids: [], warnings: [], batchDigest: '' }) },
    './timeline.service': { generateTimelineBatchChunk: async () => ({ ids: [], warning: '', batchDigest: '' }) },
    './core-settings.service': {
      loadSubplotAutoGenerateContext: async () => {
        throw new Error('subplot context bootstrap failed')
      },
      polishGeneratedSubplots: async () => ({ subplots: [], warning: '' }),
      tryGenerateSubplotBatch: async () => ({ batchResult: null, warning: '' }),
      ...overrides.coreSettingsService,
    },
    './task.service': {
      ...taskServiceMocks,
    },
  })
}

function buildWorldRulesModule(task, overrides = {}) {
  const taskServiceMocks = createTaskServiceMocks(task)
  return loadModule('electron/services/workflow-task.service.ts', {
    '../database/db': { getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ all: () => [] }) }) }) }) }) },
    '../database/schema': { tasks: {} },
    '../utils/user-facing-error': {
      throwUserFacingError: (key) => {
        throw new Error(key)
      },
    },
    './map.service': { batchGenerateMap: async () => ({ completed: true, stage: 'completed', targetDepth: 0, processedParentNames: [], generatedNodeCount: 0, processedParentCount: 0, pendingParentCount: 0, message: 'ok' }) },
    './world-rules.service': {
      loadWorldRulesGenerationContext: async () => {
        throw new Error('world rules context bootstrap failed')
      },
      generateWorldRulesSection: async () => ({ nextRules: { genreProfile: { name: '测试世界' } } }),
      ...overrides.worldRulesService,
    },
    './batch-workflow.service': {
      isBatchWorkflowType: () => false,
      resumeBatchAutoGenerateWorkflow: async () => {
        throw new Error('not used')
      },
    },
    './task.service': {
      ...taskServiceMocks,
    },
    '../../src/shared/world-rules-draft': {
      createEmptyWorldRules: () => ({ genreProfile: { name: '' } }),
      normalizeWorldRulesDraft: (value, genreName) => value || { genreProfile: { name: genreName || '' } },
    },
    '../../src/shared/world-rules-generation': {
      WORLD_RULE_SECTION_DEFINITIONS: [
        { key: 'history', label: '历史' },
        { key: 'powerSystem', label: '力量体系' },
      ],
      WORLD_RULE_SECTION_ORDER: ['history', 'powerSystem'],
    },
  })
}

function testResumeCheckpointHelper() {
  const { hasResumableWorkflowCheckpoint } = loadModule('src/shared/workflow-resilience.ts')

  assert.equal(hasResumableWorkflowCheckpoint({
    runnerType: 'workflow',
    type: 'timeline_auto_generate',
    progressJson: JSON.stringify({
      resumeCursor: 1,
      totalBatches: 3,
      requestedCount: 6,
      generatedCount: 2,
      acceptedIds: [11, 12],
    }),
  }), true)

  assert.equal(hasResumableWorkflowCheckpoint({
    runnerType: 'workflow',
    type: 'world_rules_auto_generate',
    progressJson: JSON.stringify({
      pendingSections: ['history'],
      completedSections: [],
      totalSections: 2,
      completed: false,
    }),
  }), true)

  assert.equal(hasResumableWorkflowCheckpoint({
    runnerType: 'workflow',
    type: 'map_auto_generate',
    progressJson: JSON.stringify({
      currentStage: 'idle',
      generatedNodeCount: 0,
      processedParentCount: 0,
      pendingParentCount: 0,
      completed: false,
    }),
  }), true)

  assert.equal(hasResumableWorkflowCheckpoint({
    runnerType: 'workflow',
    type: 'timeline_auto_generate',
    progressJson: JSON.stringify({
      completed: true,
      resumeCursor: 3,
      totalBatches: 3,
    }),
  }), false)
}

async function testSubplotPreparationFailurePausesTask() {
  const task = {
    id: 17,
    novelId: 8,
    runnerType: 'workflow',
    type: 'subplot_auto_generate',
    status: 'pending',
    inputJson: JSON.stringify({
      novelId: 8,
      subplotCount: 4,
      storyGoal: '保住宗门',
      coreConflict: '内外夹击',
      mainPlot: '主角重建秩序',
    }),
    controlJson: JSON.stringify({ cancelRequested: false, retryCount: 0, maxRetries: 2 }),
    progressJson: null,
    errorMessage: null,
    currentChildTaskId: null,
  }

  const batchModule = buildBatchModule(task)
  await batchModule.__testing.runSubplotAutoGenerateWorkflow(task.id)

  const progress = JSON.parse(task.progressJson)
  assert.equal(task.status, 'paused')
  assert.equal(task.errorMessage, 'subplot context bootstrap failed')
  assert.equal(progress.lastError, 'subplot context bootstrap failed')
  assert.equal(progress.status, 'paused')
  assert.equal(Array.isArray(progress.subplots), true)
  assert.match(progress.message, /暂停/)
}

async function testWorldRulesPreparationFailurePausesTask() {
  const task = {
    id: 23,
    novelId: 9,
    runnerType: 'workflow',
    type: 'world_rules_auto_generate',
    status: 'pending',
    inputJson: JSON.stringify({
      currentRules: { genreProfile: { name: '玄幻' } },
      sectionOrder: ['history', 'powerSystem'],
      maxRetries: 2,
    }),
    controlJson: JSON.stringify({ cancelRequested: false, retryCount: 0, maxRetries: 2 }),
    progressJson: null,
    errorMessage: null,
    currentChildTaskId: null,
  }

  const workflowModule = buildWorldRulesModule(task)
  await workflowModule.__testing.runWorldRulesAutoGenerateWorkflow(task.id)

  const progress = JSON.parse(task.progressJson)
  assert.equal(task.status, 'paused')
  assert.equal(task.errorMessage, 'world rules context bootstrap failed')
  assert.equal(progress.lastError, 'world rules context bootstrap failed')
  assert.equal(progress.status, 'paused')
  assert.equal(progress.totalSections, 2)
  assert.equal(progress.completedSectionCount, 0)
  assert.equal(typeof progress.workingRules, 'object')
}

async function testBatchResumeRequiresPausedCheckpoint() {
  const task = {
    id: 31,
    novelId: 5,
    runnerType: 'workflow',
    type: 'timeline_auto_generate',
    status: 'success',
    inputJson: JSON.stringify({ count: 4, batchSize: 2 }),
    controlJson: JSON.stringify({ cancelRequested: false, retryCount: 0, maxRetries: 2 }),
    progressJson: JSON.stringify({
      resumeCursor: 2,
      totalBatches: 2,
      requestedCount: 4,
      generatedCount: 4,
      completed: true,
      acceptedIds: [1, 2, 3, 4],
      warnings: [],
    }),
    errorMessage: null,
    currentChildTaskId: null,
  }

  const batchModule = buildBatchModule(task, {
    coreSettingsService: {
      loadSubplotAutoGenerateContext: async () => ({}),
    },
  })

  await assert.rejects(
    () => batchModule.resumeBatchAutoGenerateWorkflow(task.id),
    /workflow\.resumeUnsupported/,
  )
}

async function testWorldRulesResumeRequiresCheckpoint() {
  const task = {
    id: 41,
    novelId: 6,
    runnerType: 'workflow',
    type: 'world_rules_auto_generate',
    status: 'paused',
    inputJson: JSON.stringify({
      currentRules: { genreProfile: { name: '悬疑' } },
      sectionOrder: ['history'],
    }),
    controlJson: JSON.stringify({ cancelRequested: false, retryCount: 0, maxRetries: 2 }),
    progressJson: JSON.stringify({}),
    errorMessage: 'broken',
    currentChildTaskId: null,
  }

  const workflowModule = buildWorldRulesModule(task, {
    worldRulesService: {
      loadWorldRulesGenerationContext: async () => ({ profile: { genre: '悬疑' } }),
    },
  })

  await assert.rejects(
    () => workflowModule.resumeWorldRulesAutoGenerateWorkflow(task.id),
    /workflow\.resumeUnsupported/,
  )
}

async function main() {
  testResumeCheckpointHelper()
  await testSubplotPreparationFailurePausesTask()
  await testWorldRulesPreparationFailurePausesTask()
  await testBatchResumeRequiresPausedCheckpoint()
  await testWorldRulesResumeRequiresCheckpoint()
  console.log('workflow-resilience tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
