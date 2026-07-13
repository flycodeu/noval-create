/*
 * Real-model, side-by-side humanization evaluation.
 *
 * Baseline is intentionally a minimal control prompt. Optimized uses the
 * current production chapter-writing prompt builder. This is a controlled
 * prompt comparison, not a claim that a historical model response was
 * captured before the code change.
 *
 * Usage:
 *   node scripts/run-humanization-eval.cjs
 *
 * Optional:
 *   NOVELFORGE_HUMANIZATION_EVAL_CHAPTERS=2
 *   NOVELFORGE_HUMANIZATION_EVAL_PROJECTS=mystery,urban,fantasy
 *   NOVELFORGE_HUMANIZATION_EVAL_MAX_CALLS=12
 *   NOVELFORGE_HUMANIZATION_EVAL_RUN_STAMP=20260713-real
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

const promptLibrary = require(path.join(workspaceRoot, 'src/shared/prompt-library.ts'))
const genreSystem = require(path.join(workspaceRoot, 'src/shared/genre-system.ts'))
const guardrails = require(path.join(workspaceRoot, 'src/shared/content-guardrails.ts'))
const languageDrift = require(path.join(workspaceRoot, 'src/shared/language-drift.ts'))

const BACKEND_URL = process.env.NOVELFORGE_LOCAL_BACKEND || 'http://127.0.0.1:8787/rpc'
const OUT_ROOT = path.join(workspaceRoot, 'out', 'real-model-humanization-eval')
const CHAPTERS_PER_GENRE = clampInt(process.env.NOVELFORGE_HUMANIZATION_EVAL_CHAPTERS, 2, 1, 4)
const MAX_CALLS = clampInt(process.env.NOVELFORGE_HUMANIZATION_EVAL_MAX_CALLS, 12, 1, 24)
const PROJECT_FILTER = new Set(
  String(process.env.NOVELFORGE_HUMANIZATION_EVAL_PROJECTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)
const RUN_STAMP = process.env.NOVELFORGE_HUMANIZATION_EVAL_RUN_STAMP
  || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)

function clampInt(raw, fallback, min, max) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

const PROJECTS = [
  {
    key: 'mystery',
    title: '雨夜档案',
    genre: '现代悬疑',
    protagonist: '沈砚',
    theme: '真相不是奖品，查清它的人必须承担公开后的关系和职业代价。',
    premise: '旧案修复员沈砚在整理一批即将销毁的纸质档案时，发现一张十七年前的借阅单上有自己的童年住址。',
    conflict: '沈砚既要在档案被销毁前确认借阅单的来源，又要面对主管、旧案当事人和家人对“别再查了”的不同压力。',
    world: '当代沿江城市，档案馆、旧医院、社区物业和地方报社各自掌握一小段不完整记录；没有超自然能力，证据必须有来源、时间和可复核路径。',
    arc: '从一张借阅单追到旧医院的转运记录，逐步确认当年有人修改了病历，但不能直接证明谁是主谋。',
    rules: '线索必须能被查证；人物不能因为听到一句话就立即相信；每次推进都带来关系或职业代价。',
    style: '克制、具体、靠动作和物件落地，不用抽象总结替代证据，不把所有人写成同一个语气。',
    plot: [
      '第1章：档案室即将清库，沈砚在一只发霉的借阅袋里发现一张不该出现的旧单据；他必须决定是否先复制证据。',
      '第2章：沈砚把复印件带回家后发现住址被人用铅笔改过，母亲认出旧医院名称，却要求他把纸烧掉。',
      '第3章：一名退休护士愿意见面，但见面地点被临时换到监控盲区，沈砚发现自己已经被人提前告知行踪。',
      '第4章：沈砚在旧医院库房找到一页转运记录，记录的缺口正好对应一段被家人隐瞒的童年记忆。',
    ],
  },
  {
    key: 'urban',
    title: '末班电梯',
    genre: '都市',
    protagonist: '许栩',
    theme: '城市里最难修复的不是设备，而是被责任链推来推去的人。',
    premise: '夜班物业工程师许栩接到一部老电梯的重复故障单，故障记录里却出现了尚未发生的维修时间。',
    conflict: '许栩要在不惊动开发商和住户的情况下确认电梯故障是否与改造偷工有关，同时保住自己和同事的工作。',
    world: '当代大城市旧改社区，物业、维保公司、业委会和住户各自承担不同责任；设备参数、值班记录和住户投诉都必须符合现实流程。',
    arc: '从重复故障和门机异响入手，追到一份被覆盖的维保记录；主角每多确认一条事实，就会失去一个可求助的同事。',
    rules: '不使用系统外挂或无成本打脸；技术问题要有可观察症状；人物选择要受工资、合同、邻里关系和安全风险影响。',
    style: '口语自然、细节贴近工作现场，少用宏大判断，多写工具、流程、时间差和人情压力。',
    plot: [
      '第1章：凌晨两点，老电梯在十七层停住又自行开门，许栩发现机房温度记录和门机报警时间对不上。',
      '第2章：物业经理要求先把故障单改成住户误报，许栩却从监控死角看到一名保洁员在电梯停运前取走了工具箱。',
      '第3章：维保公司派来的师傅只肯换一块传感器，许栩测出真正异常来自被封死的检修门。',
      '第4章：业委会要求公开维修报价，许栩必须在安全检查和公司口径之间留下书面证据。',
    ],
  },
  {
    key: 'fantasy',
    title: '灰炉契约',
    genre: '玄幻',
    protagonist: '陆沉舟',
    theme: '力量越方便，代价越容易被藏在别人身上；真正的成长要改变分配代价的方式。',
    premise: '边城铸炉学徒陆沉舟在修复一枚失效的引火牌时，发现牌内封着一段被宗门抹去的矿脉记录。',
    conflict: '陆沉舟需要借引火牌进入低阶炼气境，却必须付出燃烧记忆和欠下矿场债契的代价，还会触动宗门对矿脉的封锁。',
    world: '低阶修行世界，灵息分为引气、聚脉、照府三阶；灵石、药材、炉火都有明确消耗，宗门掌握矿脉与传承，普通人无法随意越阶。',
    arc: '主角从修炉和核对矿账开始，逐步确认城外矿脉被人为封存；每次借力都会减少可用记忆，并让师父承担连带债务。',
    rules: '境界、资源和伤势必须连续；不得凭一句天命越阶；法术要有消耗、范围和失败后果；人物说话有身份差。',
    style: '少写万能威压和抽象天道，多写炉火、矿尘、伤口、账契和具体选择；爽点来自有限资源下的准确判断。',
    plot: [
      '第1章：引火牌在炉口裂开，陆沉舟从灰烬里看见一行被抹掉的矿脉编号；他必须在守炉和藏牌之间选一边。',
      '第2章：宗门执事来查炉，陆沉舟用一次引气换回师父的账契，却发现自己忘了母亲留下的一个字。',
      '第3章：矿场塌方露出旧石门，陆沉舟只能带一件工具下井，师兄却要求他先交出引火牌。',
      '第4章：石门后的矿账证明宗门欠城民一笔灵石，陆沉舟若公开，师父将先被押去问罪。',
    ],
  },
]

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function countWords(text) {
  const source = String(text || '')
  return (source.match(/[\u4e00-\u9fa5]/g) || []).length + (source.match(/\b[a-zA-Z]+\b/g) || []).length
}

function clip(text, max = 900) {
  const value = cleanText(text)
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function lastPart(text, max = 260) {
  const value = cleanText(text)
  return value.length > max ? value.slice(-max) : value
}

function buildWorldRules(project) {
  return genreSystem.buildWorldRulesSummary(genreSystem.getBuiltinGenreRules(project.genre))
}

async function rpc(service, method, args = []) {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, method, args }),
  })
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
  const body = await response.json()
  if (!body.ok) {
    const detail = body.error?.detail ? `\n${body.error.detail}` : ''
    throw new Error(`${body.error?.message || `${service}.${method} failed`}${detail}`)
  }
  return body.data
}

function buildBaselineMessages(project, chapterNum, previousContent) {
  const previous = previousContent
    ? `上章结尾：${lastPart(previousContent)}\n上章摘要：${clip(previousContent, 700)}`
    : '这是第一章，不要补写前史。'
  return [
    {
      role: 'system',
      content: '你是一名中文网络小说作者。只输出正文，不要标题、解释、Markdown 或 JSON。',
    },
    {
      role: 'user',
      content: [
        `类型：${project.genre}`,
        `书名：${project.title}`,
        `主角：${project.protagonist}`,
        `主题：${project.theme}`,
        `故事前提：${project.premise}`,
        `主要冲突：${project.conflict}`,
        `世界背景：${project.world}`,
        `本章任务：${project.plot[chapterNum - 1]}`,
        `写作风格：${project.style}`,
        previous,
        '写一章约 900 到 1300 字的中文正文。要有现场、人物选择、冲突推进和结尾悬念，直接进入故事。',
      ].join('\n'),
    },
  ]
}

function buildOptimizedMessages(project, chapterNum, previousContent) {
  const previousSummary = previousContent ? clip(previousContent, 900) : '无'
  const lastEnding = previousContent ? lastPart(previousContent) : '无，这是第一章。'
  const chapterGoal = project.plot[chapterNum - 1]
  const prompt = promptLibrary.buildChapterWritingPrompt({
    novelTitle: project.title,
    genre: project.genre,
    chapterNum,
    chapterTitle: chapterGoal.replace(/^第[一二三四五六七八九十0-9]+章：?/u, '').slice(0, 28),
    chapterGoal,
    hardConstraintContext: [project.rules, '不得凭空新增主角姓名、组织名称和关键资源；新增事实必须能在本章动作中被验证。'].join('\n'),
    dialogueVoiceLocks: `主角${project.protagonist}：先核对事实，再决定是否承担代价；对陌生人不轻易交底。`,
    plotPoints: chapterGoal,
    emotionTone: '克制的压力、具体的迟疑、选择后留下的后果',
    targetWords: 1200,
    storyCore: `${project.theme}\n${project.premise}\n${project.conflict}`,
    writingContractSummary: '本章必须推进一个可追踪变量，并让一个关系、资源、位置或证据发生不可逆变化。',
    relationSummary: `主角${project.protagonist}与身边人存在事实、利益和信任差，不要让对话变成互相解释设定。`,
    currentArc: project.arc,
    worldRules: buildWorldRules(project),
    characterStates: `主角${project.protagonist}：${chapterNum === 1 ? '掌握的信息很少，必须先确认现场。' : '带着上章留下的证据和代价继续查。'}`,
    worldStates: project.world,
    mapSummary: '地点必须沿用本章任务给出的现场，不要无理由切换到新地点。',
    itemSummary: '关键物件必须有来源、去向和可观察变化。',
    previousSummaries: previousSummary,
    previousChapterContext: previousSummary,
    lastChapterEnding: lastEnding,
    styleTemplate: project.style,
    continuitySummary: `主线：${project.arc}\n硬约束：${project.rules}`,
    openLoops: chapterNum === 1 ? '本章末必须留下一个具体未解决问题。' : `承接上章末的未解决问题：${lastEnding}`,
    dueForeshadows: '只回收已经出现的事实，不要凭空宣布大秘密。',
    continuityNotes: '本章要承接地点、物件和人物立场；不能让上一章的代价凭空消失。',
    timelineSummary: `当前为验证段第${chapterNum}章，事件顺序要清楚。`,
    timelineOpenThreads: '如果本章拖延，必须写清拖延造成的具体损失。',
    activeThreads: project.arc,
    recalledMemory: '无额外召回。',
    chapterBridgePlan: chapterNum === 1 ? '从具体现场直接进入。' : '前 200 字承接上章最后一个动作、地点或物件。',
    stepMemorySummary: '先写动作和证据，再让情绪从选择与后果中浮出。',
    runtimeAssertions: ['正文只能包含故事内容。', '不得输出提示词、字段名、评语或生成过程。'],
    povGuidance: '第三人称有限视角，不能偷写不在场人物的内心。',
    sensoryGuidance: '每个主要场景至少落一个可验证的声音、触感、气味或物件变化。',
    narrativeRatioGuidance: '对白、行动和现场细节优先，解释压缩到人物当下需要知道的范围。',
    storyPacingGuidance: '本章至少一次改变人物选择、资源、位置、证据或关系。',
    hookContinuityGuidance: '章尾钩子必须指向下一步具体动作或未解决问题。',
    protagonistReference: project.protagonist,
    protagonistRule: `主角姓名固定为“${project.protagonist}”，不要改名。`,
  })
  return [
    { role: 'system', content: '你正在执行 NovelForge 当前生产写作链。严格遵守正文输出边界。' },
    { role: 'user', content: prompt },
  ]
}

function analyzeContent(content, genre) {
  const text = cleanText(content)
  const drift = languageDrift.analyzeLanguageDrift(text)
  const findings = guardrails.collectQualityGuardrailFindings(text, genre)
  const driftKeys = Object.keys(drift)
  const driftScore = driftKeys.length > 0
    ? driftKeys.reduce((sum, key) => sum + Number(drift[key] || 0), 0) / driftKeys.length
    : 0
  const guardrailRisk = findings.reduce((sum, finding) => (
    sum + (finding.severity === 'high' ? 18 : finding.severity === 'medium' ? 9 : 3)
  ), 0)
  const aiFlavorRisk = Math.round(Math.min(100, driftScore * 0.8 + guardrailRisk))
  return {
    wordCount: countWords(text),
    aiFlavorRisk,
    languageDriftScore: Math.round(driftScore * 10) / 10,
    shouldForceRepair: guardrails.shouldForceRepair(findings),
    guardrailHits: findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      excerpt: finding.excerpt,
    })),
    drift,
  }
}

async function runModel(modelConfigId, messages) {
  const outputs = await rpc('ai', 'runPrompt', [{
    modelConfigId,
    executionMode: 'cost_saver',
    count: 1,
    messages,
  }])
  const output = Array.isArray(outputs) ? outputs[0] : outputs
  const content = cleanText(output)
  if (!content) throw new Error('模型返回空正文')
  return content
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value))
  return valid.length > 0 ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0
}

function summarizePhase(chapters) {
  const successful = chapters.filter((item) => item.status === 'success')
  return {
    requestedChapters: chapters.length,
    completedChapters: successful.length,
    failedChapters: chapters.length - successful.length,
    averageWordCount: Math.round(average(successful.map((item) => item.analysis.wordCount))),
    averageAiFlavorRisk: Math.round(average(successful.map((item) => item.analysis.aiFlavorRisk)) * 10) / 10,
    averageLanguageDriftScore: Math.round(average(successful.map((item) => item.analysis.languageDriftScore)) * 10) / 10,
    forcedRepairChapters: successful.filter((item) => item.analysis.shouldForceRepair).length,
    guardrailHitCount: successful.reduce((sum, item) => sum + item.analysis.guardrailHits.length, 0),
  }
}

function writeMarkdown(report, outDir) {
  const lines = [
    '# 真实模型 AI 味前后对比',
    '',
    `运行时间：${report.generatedAt}`,
    `模型：${report.model.provider}:${report.model.modelId}（配置 #${report.model.id}）`,
    `每种题材章节数：${report.chaptersPerGenre}，模型调用数：${report.callCount}`,
    '',
    '说明：Before 是最小控制提示词，After 是当前代码中的 `buildChapterWritingPrompt` 生产提示词。两者均由同一个真实模型生成；Before 不是历史版本的回放，因此结论是受控提示词对比。',
    '',
  ]

  for (const project of report.projects) {
    const before = project.phases.baseline.summary
    const after = project.phases.optimized.summary
    lines.push(`## ${project.genre} · ${project.title}`)
    lines.push('')
    lines.push('| 指标 | Before | After | 变化（After-Before） |')
    lines.push('| --- | ---: | ---: | ---: |')
    lines.push(`| 平均 AI 味风险（越低越好） | ${before.averageAiFlavorRisk} | ${after.averageAiFlavorRisk} | ${round(after.averageAiFlavorRisk - before.averageAiFlavorRisk)} |`)
    lines.push(`| 平均语言漂移分（越低越好） | ${before.averageLanguageDriftScore} | ${after.averageLanguageDriftScore} | ${round(after.averageLanguageDriftScore - before.averageLanguageDriftScore)} |`)
    lines.push(`| 平均字数 | ${before.averageWordCount} | ${after.averageWordCount} | ${round(after.averageWordCount - before.averageWordCount)} |`)
    lines.push(`| 触发强制修复的章节 | ${before.forcedRepairChapters} | ${after.forcedRepairChapters} | ${after.forcedRepairChapters - before.forcedRepairChapters} |`)
    lines.push(`| 护栏命中数 | ${before.guardrailHitCount} | ${after.guardrailHitCount} | ${after.guardrailHitCount - before.guardrailHitCount} |`)
    lines.push('')
    for (const phaseKey of ['baseline', 'optimized']) {
      const phase = project.phases[phaseKey]
      lines.push(`### ${phaseKey === 'baseline' ? 'Before / 最小控制提示词' : 'After / 当前生产提示词'}`)
      lines.push('')
      phase.chapters.forEach((chapter) => {
        lines.push(`- 第 ${chapter.chapterNum} 章：${chapter.status === 'success' ? `AI 味风险 ${chapter.analysis.aiFlavorRisk}，护栏 ${chapter.analysis.guardrailHits.length} 项，原文文件 ${path.relative(outDir, chapter.rawPath)}` : `失败：${chapter.error}`}`)
        if (chapter.status === 'success' && chapter.analysis.guardrailHits.length > 0) {
          lines.push(`  - 命中：${chapter.analysis.guardrailHits.map((item) => `${item.code}/${item.severity}`).join('、')}`)
        }
      })
      lines.push('')
    }
  }

  fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`, 'utf8')
}

function round(value) {
  return Math.round(value * 10) / 10
}

async function main() {
  const models = await rpc('model', 'list')
  const model = models.find((item) => item.isDefault) || models[0]
  if (!model) throw new Error('未配置可用模型，无法执行真实模型评测。')

  const selectedProjects = PROJECT_FILTER.size > 0
    ? PROJECTS.filter((project) => PROJECT_FILTER.has(project.key))
    : PROJECTS
  if (selectedProjects.length === 0) throw new Error('题材筛选没有匹配项目。')

  const expectedCalls = selectedProjects.length * CHAPTERS_PER_GENRE * 2
  if (expectedCalls > MAX_CALLS) {
    throw new Error(`预计模型调用 ${expectedCalls} 次，超过上限 ${MAX_CALLS}；请提高 NOVELFORGE_HUMANIZATION_EVAL_MAX_CALLS。`)
  }

  const outDir = path.join(OUT_ROOT, RUN_STAMP)
  fs.mkdirSync(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    comparison: {
      baseline: 'minimal-control-prompt',
      optimized: 'current-production-buildChapterWritingPrompt',
      caveat: '受控提示词对比，不是历史模型输出回放。',
    },
    model: { id: model.id, provider: model.provider, modelId: model.modelId },
    chaptersPerGenre: CHAPTERS_PER_GENRE,
    callCount: 0,
    projects: [],
  }

  for (const project of selectedProjects) {
    const projectReport = {
      key: project.key,
      genre: project.genre,
      title: project.title,
      phases: { baseline: { chapters: [], summary: null }, optimized: { chapters: [], summary: null } },
    }

    for (const phaseKey of ['baseline', 'optimized']) {
      let previousContent = ''
      for (let chapterNum = 1; chapterNum <= CHAPTERS_PER_GENRE; chapterNum += 1) {
        const rawPath = path.join(outDir, `${project.key}-${phaseKey}-chapter-${chapterNum}.txt`)
        const chapter = { chapterNum, status: 'failed', rawPath, analysis: null, error: '' }
        try {
          const messages = phaseKey === 'baseline'
            ? buildBaselineMessages(project, chapterNum, previousContent)
            : buildOptimizedMessages(project, chapterNum, previousContent)
          console.log(`[humanization-eval] ${project.genre} ${phaseKey} 第${chapterNum}章：调用真实模型`)
          const content = await runModel(model.id, messages)
          fs.writeFileSync(rawPath, content, 'utf8')
          chapter.status = 'success'
          chapter.analysis = analyzeContent(content, project.genre)
          previousContent = content
          report.callCount += 1
          console.log(`[humanization-eval] ${project.genre} ${phaseKey} 第${chapterNum}章：AI味风险 ${chapter.analysis.aiFlavorRisk}，护栏 ${chapter.analysis.guardrailHits.length}`)
        } catch (error) {
          chapter.error = error instanceof Error ? error.message : String(error)
          console.error(`[humanization-eval] ${project.genre} ${phaseKey} 第${chapterNum}章失败：${chapter.error}`)
        }
        projectReport.phases[phaseKey].chapters.push(chapter)
      }
      projectReport.phases[phaseKey].summary = summarizePhase(projectReport.phases[phaseKey].chapters)
    }

    projectReport.comparison = {
      aiFlavorRiskDelta: round(projectReport.phases.optimized.summary.averageAiFlavorRisk - projectReport.phases.baseline.summary.averageAiFlavorRisk),
      languageDriftDelta: round(projectReport.phases.optimized.summary.averageLanguageDriftScore - projectReport.phases.baseline.summary.averageLanguageDriftScore),
      improved: projectReport.phases.optimized.summary.averageAiFlavorRisk <= projectReport.phases.baseline.summary.averageAiFlavorRisk,
    }
    report.projects.push(projectReport)
  }

  report.status = report.projects.every((project) => (
    project.phases.baseline.summary.failedChapters === 0 && project.phases.optimized.summary.failedChapters === 0
  )) ? 'complete' : 'partial'
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeMarkdown(report, outDir)
  console.log(`[humanization-eval] report: ${path.join(outDir, 'report.md')}`)
  console.log(JSON.stringify({ status: report.status, callCount: report.callCount, outDir }, null, 2))
}

main().catch((error) => {
  console.error('[humanization-eval] failed:', error)
  process.exitCode = 1
})
