// Pure final-input capture. No Electron/SQLite/provider initialization is allowed.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { build } = require('esbuild')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const fixtures = require('./reader-first-fixtures.cjs')
const root = path.resolve(__dirname, '..')
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

function workingTreeIdentity() {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort()
  const files = paths.map((relative) => ({ path: relative,
    hash: fs.existsSync(path.join(root, relative)) ? hash(fs.readFileSync(path.join(root, relative))) : 'deleted' }))
  return { digest: hash(JSON.stringify(files)), files }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => !['--case=all', '--case=guardrails', '--case=writer', '--case=policy'].includes(arg)) || args.length > 1) {
    throw new Error('Unsupported argument/case. Real-model mode is not implemented: explicit provider configuration and budget are required; no provider fallback.')
  }
  const caseId = (args[0] || '--case=all').split('=')[1]
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`
  const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-00', runId)
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'novelforge-reader-first-'))
  process.env.NOVELFORGE_USER_DATA_DIR = temp
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  const server = net.createServer((socket) => socket.end())
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    registerProjectTsRuntime(root)
    const guardrails = require('../src/shared/content-guardrails.ts')
    const report = { runId, command: [process.execPath, ...process.argv.slice(1)], head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTree: workingTreeIdentity(), fixtureHash: hash(JSON.stringify(fixtures)), userData: temp, port: server.address().port, database: 'not opened; task execution adapter disabled', modelCalls: 0, policy: 'legacy default; explicit synthetic reader-first-v1 role comparisons', compiler: require('../electron/services/context-compiler.ts').resolveContextCompilerMode(), entry: 'actual role message builders -> built-in prompts (override adapter stubbed)', candidates: 'synthetic inputs only; no generated manuscript', results: {} }
    if (caseId !== 'writer' && caseId !== 'policy') {
      for (const name of ['camera', 'metaphor']) {
        const findings = guardrails.collectQualityGuardrailFindings(fixtures[name], '现实悬疑')
        report.results[name] = { input: fixtures[name], findings, forceRepair: guardrails.shouldForceRepair(findings), blocking: guardrails.hasBlockingGuardrailFindings(findings), observation: name === 'camera' ? 'Camera-word simile hits are a known defect, never a desired assertion.' : 'Style signals are observations; action policy is recorded separately.' }
      }
    }
    if (caseId !== 'guardrails') {
      const bundle = await build({ stdin: { contents: ['writer', 'planner', 'review', 'rewriter'].map((role) => `export * from './electron/services/chapter-pipeline-${role}.ts'`).join('\n'), resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'no-side-effects', setup(builder) {
        builder.onLoad({ filter: /prompt-override\.service\.ts$/ }, () => ({ contents: 'export function applyPromptOverride(key, fallback) { return fallback }; export function listPromptOverrides() { return [] }; export function getNarrativePromptSource(key) { return {key, source:"built-in", digest:"fixture", scope:"global-template"} }', loader: 'ts' }))
        builder.onLoad({ filter: /[\\/]task\.service\.ts$/ }, () => ({ contents: 'module.exports = new Proxy({}, { get() { return () => { throw new Error("Task execution forbidden in audit") } } })', loader: 'js' }))
      } }] })
      const module = { exports: {} }
      new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require)
      for (const kind of ['text', 'typed', 'prose', 'approved']) {
        const input = fixtures.writerFixture(kind)
        if (kind === 'approved') input.context.authorStyleMaterials.approvedSample = { text: '姐姐把袋子放在床边。弟弟没接，低头看了一眼手机。', source: 'synthetic-explicit-approval', digest: 'fixture-only' }
        const messages = module.exports.buildChapterWriterMessages(input)
        report.results[kind] = { input, materialReport: module.exports.buildChapterWriterMaterialReport?.(input), messages, messagesHash: hash(JSON.stringify(messages)) }
      }
      if (caseId === 'all' || caseId === 'policy') {
        const policy = require('../src/shared/narrative-policy.ts')
        const tokens = require('../src/shared/token-budget.ts')
        for (const version of ['legacy', 'reader-first-v1']) {
          const input = fixtures.writerFixture('typed')
          input.context.narrativeIdentity = policy.buildNarrativeInputIdentity({ policy: policy.resolveNarrativePolicy(JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: version, revision: 1 } }), true), inputSource: input.context.chapterGoal, styleSource: input.context.authorStyleMaterials, models: 'no-model-synthetic', overrides: [], compilerMode: report.compiler })
          const roleInputs = {
            planner: { ...input, plotPoints: input.scenePlanText }, writer: input,
            critic: { ...input, draftContent: '弟弟把时间记在纸上，问姐姐明天几点来。', arcProgress: '', arcProgressStatus: '', arcProgressCheckpoint: '' },
            rewriter: { ...input, draftContent: '弟弟把时间记在纸上，问姐姐明天几点来。', prioritizedReviewNotesText: '只修已定位的事实错误。', structuralRepairDirective: '', lockedParagraphs: [], attemptNumber: 1, rejectedDigests: [], revisionMode: 'full' },
          }
          const builders = { planner: 'buildChapterPlannerMessages', writer: 'buildChapterWriterMessages', critic: 'buildChapterCriticMessages', rewriter: 'buildChapterRewriterMessages' }
          report.results[version] = Object.fromEntries(Object.entries(roleInputs).map(([role, roleInput]) => {
            const messages = module.exports[builders[role]](roleInput)
            return [role, { input: roleInput, messages, messagesHash: hash(JSON.stringify(messages)), estimatedMessageTokens: messages.reduce((sum, message) => sum + tokens.estimateTokens(message.content), 0) }]
          }))
        }
      }
    }
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ output, userData: temp, port: report.port, modelCalls: 0 }))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
