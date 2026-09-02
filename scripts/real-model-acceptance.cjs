const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const workspaceRoot = path.resolve(__dirname, '..')
const pipelineScript = path.join(workspaceRoot, 'scripts', 'run-novel-ai-eval-pipeline.cjs')
const runRequested = process.argv.includes('--run')
const jsonOnly = process.argv.includes('--json')

function buildPreflight() {
  const missing = []
  const projects = String(process.env.NOVELFORGE_EVAL_PROJECTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const contentChapters = Number(process.env.NOVELFORGE_EVAL_CONTENT_CHAPTERS || 2)
  const isolatedDir = String(process.env.NOVELFORGE_EVAL_USER_DATA_DIR || '').trim()
  const allowLiveDb = process.env.NOVELFORGE_EVAL_ALLOW_LIVE_DB === '1'

  if (process.env.NOVELFORGE_EVAL_REAL_MODEL !== '1') missing.push('NOVELFORGE_EVAL_REAL_MODEL=1')
  if (projects.length === 0) missing.push('NOVELFORGE_EVAL_PROJECTS（至少一个项目）')
  if (!Number.isInteger(contentChapters) || contentChapters < 1 || contentChapters > 100) {
    missing.push('NOVELFORGE_EVAL_CONTENT_CHAPTERS（1-100 的整数）')
  }
  if (!isolatedDir && !allowLiveDb) {
    missing.push('NOVELFORGE_EVAL_USER_DATA_DIR（推荐）或 NOVELFORGE_EVAL_ALLOW_LIVE_DB=1')
  }
  if (isolatedDir && !fs.existsSync(path.join(path.resolve(isolatedDir), 'novelforge.db'))) {
    missing.push('NOVELFORGE_EVAL_USER_DATA_DIR/novelforge.db（需包含已配置模型的数据库副本）')
  }

  return {
    mode: 'real-model-preflight',
    ready: missing.length === 0,
    realModelCalled: false,
    missing,
    projects,
    contentChapters,
    dataMode: isolatedDir ? 'isolated-user-data' : 'live-user-data',
    userDataDir: isolatedDir ? path.resolve(isolatedDir) : null,
    pipelineScript: path.relative(workspaceRoot, pipelineScript).replace(/\\/g, '/'),
    notes: [
      '预检不发起网络请求，也不读取或输出 API key。',
      '隔离目录必须先复制一份包含可用模型配置的 NovelForge 用户数据目录。',
      '真实流水线会创建评测项目并执行正文生成；长章节、供应商限流和流式断线仍需以本次报告为准。',
    ],
  }
}

function printPreflight(report) {
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(report.ready
    ? 'real model preflight READY; use --run to start the explicitly approved pipeline.'
    : `real model preflight BLOCKED; missing ${report.missing.join(', ')}.`)
  console.log(`projects=${report.projects.join(',') || '(none)'} chapters=${report.contentChapters} dataMode=${report.dataMode}`)
  report.notes.forEach((note) => console.log(`- ${note}`))
}

function runPipeline(report) {
  if (!report.ready) {
    printPreflight(report)
    process.exitCode = 2
    return
  }

  const electronBinary = require('electron')
  const child = spawn(electronBinary, [pipelineScript], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NOVELFORGE_EVAL_REAL_MODEL: '1',
    },
    stdio: 'inherit',
  })
  child.on('error', (error) => {
    console.error(`[real-model-acceptance] failed to start Electron: ${error.message}`)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[real-model-acceptance] pipeline stopped by ${signal}`)
      process.exitCode = 1
      return
    }
    process.exitCode = code ?? 1
  })
}

const report = buildPreflight()
if (runRequested) runPipeline(report)
else {
  printPreflight(report)
  if (!report.ready) process.exitCode = 2
}
