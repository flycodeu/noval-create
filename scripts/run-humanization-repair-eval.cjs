/*
 * Real-model evaluation of the production post-generation chapter optimizer.
 * It creates temporary novels/chapters, runs chapter.optimizeContent, records
 * the candidate, and deletes the temporary records in a finally block.
 *
 * Usage:
 *   node scripts/run-humanization-repair-eval.cjs
 *
 * Optional:
 *   NOVELFORGE_HUMANIZATION_REPAIR_SOURCE=20260713-real
 *   NOVELFORGE_HUMANIZATION_REPAIR_RUN_STAMP=20260713-real-production-repair
 *   NOVELFORGE_HUMANIZATION_REPAIR_MAX_CALLS=6
 *   NOVELFORGE_HUMANIZATION_REPAIR_ONLY_KEYS=urban
 */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const workspaceRoot = path.resolve(__dirname, '..')
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    for (const ext of ['.ts', '.tsx', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + ext)
      if (fs.existsSync(candidate)) return candidate
    }
    for (const ext of ['.ts', '.tsx', '.js']) {
      const candidate = path.resolve(baseDir, request, 'index' + ext)
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

const guardrails = require(path.join(workspaceRoot, 'src/shared/content-guardrails.ts'))
const languageDrift = require(path.join(workspaceRoot, 'src/shared/language-drift.ts'))
const BACKEND_URL = process.env.NOVELFORGE_LOCAL_BACKEND || 'http://127.0.0.1:8787/rpc'
const SOURCE_STAMP = process.env.NOVELFORGE_HUMANIZATION_REPAIR_SOURCE || '20260713-real'
const RUN_STAMP = process.env.NOVELFORGE_HUMANIZATION_REPAIR_RUN_STAMP || `${SOURCE_STAMP}-production-repair`
const MAX_CALLS = clampInt(process.env.NOVELFORGE_HUMANIZATION_REPAIR_MAX_CALLS, 6, 1, 12)
const ONLY_KEYS = new Set((process.env.NOVELFORGE_HUMANIZATION_REPAIR_ONLY_KEYS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean))
const OUT_ROOT = path.join(workspaceRoot, 'out', 'real-model-humanization-eval')

function clampInt(raw, fallback, min, max) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function countWords(text) {
  const source = String(text || '')
  return (source.match(/[\u4e00-\u9fa5]/g) || []).length + (source.match(/\b[a-zA-Z]+\b/g) || []).length
}

function analyzeContent(content, genre) {
  const text = cleanText(content)
  const drift = languageDrift.analyzeLanguageDrift(text)
  const findings = guardrails.collectQualityGuardrailFindings(text, genre)
  const keys = Object.keys(drift)
  const driftScore = keys.length > 0
    ? keys.reduce((sum, key) => sum + Number(drift[key] || 0), 0) / keys.length
    : 0
  const guardrailRisk = findings.reduce((sum, finding) => (
    sum + (finding.severity === 'high' ? 18 : finding.severity === 'medium' ? 9 : 3)
  ), 0)
  return {
    wordCount: countWords(text),
    aiFlavorRisk: Math.round(Math.min(100, driftScore * 0.8 + guardrailRisk)),
    languageDriftScore: Math.round(driftScore * 10) / 10,
    guardrailHits: findings.map((finding) => ({ code: finding.code, severity: finding.severity, excerpt: finding.excerpt })),
  }
}

async function rpc(service, method, args = []) {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, method, args }),
  })
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
  const body = await response.json()
  if (!body.ok) throw new Error(body.error?.message || `${service}.${method} failed`)
  return body.data
}

async function createTempNovel(title) {
  const payload = { title, synopsis: '真实模型修复评测临时项目', launchMode: 'fast_launch', operatingMode: 'standard_longform' }
  const genreId = Number(process.env.NOVELFORGE_HUMANIZATION_REPAIR_GENRE_ID || 16)
  try {
    return await rpc('novel', 'create', [{ ...payload, genreId }])
  } catch {
    return rpc('novel', 'create', [payload])
  }
}

function average(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function writeMarkdown(report, outDir) {
  const lines = [
    '# 真实模型生产修复评测',
    '',
    `运行时间：${report.generatedAt}`,
    `来源报告：${report.sourceReport}`,
    `生产链路：chapter.optimizeContent（只生成候选，不自动覆盖正文）`,
    `模型调用数：${report.callCount}`,
    '',
    '说明：本报告把上一轮 After 正文送入当前生产级整章优化器，检查生成后护栏能否继续降低 AI 味风险；临时项目和章节已在每轮结束后删除。',
    '',
  ]
  for (const project of report.projects) {
    lines.push(`## ${project.genre} · ${project.title}`)
    lines.push('')
    lines.push('| 指标 | After / 修复前 | Production repair / 修复后 | 变化（修复后-修复前） |')
    lines.push('| --- | ---: | ---: | ---: |')
    lines.push(`| 平均 AI 味风险（越低越好） | ${project.before.averageAiFlavorRisk} | ${project.after.averageAiFlavorRisk} | ${project.comparison.aiFlavorRiskDelta} |`)
    lines.push(`| 平均语言漂移分（越低越好） | ${project.before.averageLanguageDriftScore} | ${project.after.averageLanguageDriftScore} | ${project.comparison.languageDriftDelta} |`)
    lines.push(`| 平均护栏命中数 | ${project.before.guardrailHitCount} | ${project.after.guardrailHitCount} | ${project.comparison.guardrailHitDelta} |`)
    lines.push('')
    for (const chapter of project.chapters) {
      lines.push(`- 第 ${chapter.chapterNum} 章：${chapter.status === 'success' ? `修复前风险 ${chapter.before.aiFlavorRisk} → 修复后 ${chapter.after.aiFlavorRisk}；候选文件 ${path.relative(outDir, chapter.rawPath)}` : `失败：${chapter.error}`}`)
      if (chapter.status === 'success' && chapter.warnings.length > 0) {
        lines.push(`  - 生产事实/质量门警告：${chapter.warnings.join('；')}`)
      }
    }
    lines.push('')
  }
  fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`, 'utf8')
}

async function main() {
  const sourceDir = path.join(OUT_ROOT, SOURCE_STAMP)
  const sourceReportPath = path.join(sourceDir, 'report.json')
  if (!fs.existsSync(sourceReportPath)) throw new Error(`找不到来源报告：${sourceReportPath}`)
  const sourceReport = JSON.parse(fs.readFileSync(sourceReportPath, 'utf8'))
  let candidates = sourceReport.projects.flatMap((project) => (
    project.phases.optimized.chapters
      .filter((chapter) => chapter.status === 'success' && fs.existsSync(chapter.rawPath))
      .map((chapter) => ({ project, chapter }))
  ))
  if (ONLY_KEYS.size > 0) {
    candidates = candidates.filter(({ project }) => ONLY_KEYS.has(project.key))
  }
  if (candidates.length === 0) throw new Error('来源报告没有可修复的 After 章节。')
  if (candidates.length > MAX_CALLS) candidates.splice(MAX_CALLS)

  const outDir = path.join(OUT_ROOT, RUN_STAMP)
  fs.mkdirSync(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    sourceReport: path.relative(workspaceRoot, sourceReportPath),
    callCount: 0,
    projects: [],
  }
  const projectMap = new Map()

  for (const { project, chapter } of candidates) {
    let novelId = 0
    let chapterId = 0
    const projectReport = projectMap.get(project.key) || {
      key: project.key,
      genre: project.genre,
      title: project.title,
      chapters: [],
      before: { averageAiFlavorRisk: 0, averageLanguageDriftScore: 0, guardrailHitCount: 0 },
      after: { averageAiFlavorRisk: 0, averageLanguageDriftScore: 0, guardrailHitCount: 0 },
      comparison: {},
    }
    const rawPath = path.join(outDir, `${project.key}-production-repair-chapter-${chapter.chapterNum}.txt`)
    const entry = { chapterNum: chapter.chapterNum, status: 'failed', rawPath, before: chapter.analysis, after: null, warnings: [], error: '' }
    try {
      novelId = Number(await createTempNovel(`AI味修复评测-${project.key}-${Date.now()}`))
      chapterId = Number(await rpc('chapter', 'create', [novelId, {
        chapterNum: chapter.chapterNum,
        title: `${project.title}评测章${chapter.chapterNum}`,
        outline: `保留${project.genre}原稿事实与事件顺序，只做语言优化。`,
        targetWords: 1400,
      }]))
      const content = fs.readFileSync(chapter.rawPath, 'utf8')
      await rpc('chapter', 'update', [chapterId, { content, status: 'draft' }])
      console.log(`[humanization-repair-eval] ${project.genre} 第${chapter.chapterNum}章：调用生产整章修复`)
      const result = await rpc('chapter', 'optimizeContent', [chapterId, {
        executionMode: 'cost_saver',
        extraRequirements: `保持${project.genre}题材质感；只修语言与读感，不改变原稿事实、人物、地点、数字和章尾钩子。`,
      }])
      const repaired = cleanText(result.optimizedContent)
      if (!repaired) throw new Error('生产优化器返回空正文')
      fs.writeFileSync(rawPath, repaired, 'utf8')
      entry.status = 'success'
      entry.after = analyzeContent(repaired, project.genre)
      entry.warnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : []
      report.callCount += Number(result.optimizationPasses) > 0 ? Number(result.optimizationPasses) : 1
      console.log(`[humanization-repair-eval] ${project.genre} 第${chapter.chapterNum}章：${entry.before.aiFlavorRisk} → ${entry.after.aiFlavorRisk}`)
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error)
      console.error(`[humanization-repair-eval] ${project.genre} 第${chapter.chapterNum}章失败：${entry.error}`)
    } finally {
      if (novelId > 0) {
        try { await rpc('novel', 'delete', [novelId]) } catch (error) { console.error('[humanization-repair-eval] 临时项目清理失败', error) }
      }
    }
    projectReport.chapters.push(entry)
    projectMap.set(project.key, projectReport)
  }

  for (const project of projectMap.values()) {
    const successful = project.chapters.filter((chapter) => chapter.status === 'success')
    project.before = {
      averageAiFlavorRisk: Math.round(average(successful.map((item) => item.before.aiFlavorRisk)) * 10) / 10,
      averageLanguageDriftScore: Math.round(average(successful.map((item) => item.before.languageDriftScore)) * 10) / 10,
      guardrailHitCount: successful.reduce((sum, item) => sum + item.before.guardrailHits.length, 0),
    }
    project.after = {
      averageAiFlavorRisk: Math.round(average(successful.map((item) => item.after.aiFlavorRisk)) * 10) / 10,
      averageLanguageDriftScore: Math.round(average(successful.map((item) => item.after.languageDriftScore)) * 10) / 10,
      guardrailHitCount: successful.reduce((sum, item) => sum + item.after.guardrailHits.length, 0),
    }
    project.comparison = {
      aiFlavorRiskDelta: Math.round((project.after.averageAiFlavorRisk - project.before.averageAiFlavorRisk) * 10) / 10,
      languageDriftDelta: Math.round((project.after.averageLanguageDriftScore - project.before.averageLanguageDriftScore) * 10) / 10,
      guardrailHitDelta: project.after.guardrailHitCount - project.before.guardrailHitCount,
    }
    report.projects.push(project)
  }

  const successfulCount = report.projects.reduce((sum, project) => (
    sum + project.chapters.filter((chapter) => chapter.status === 'success').length
  ), 0)
  report.status = successfulCount === candidates.length ? 'complete' : 'partial'
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeMarkdown(report, outDir)
  console.log(`[humanization-repair-eval] report: ${path.join(outDir, 'report.md')}`)
  console.log(JSON.stringify({ status: report.status, callCount: report.callCount, outDir }, null, 2))
}

main().catch((error) => {
  console.error('[humanization-repair-eval] failed:', error)
  process.exitCode = 1
})
