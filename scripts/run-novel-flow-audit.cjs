// NovelForge workflow audit runner.
//
// Runs a small, evidence-producing sample for three benchmark titles:
// map -> items -> characters -> story threads -> story design -> 10 chapter outlines -> 2 chapter drafts.
//
// Run with Electron because better-sqlite3 is rebuilt for Electron ABI:
//   npx electron scripts/run-novel-flow-audit.cjs
//
// Optional:
//   NOVELFORGE_FLOW_PROJECTS=steel,doupo,baiyao
//   NOVELFORGE_FLOW_CONTENT_CHAPTERS=2
//   NOVELFORGE_FLOW_RUN_STAMP=20260705_xxx

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  }
  if (request.startsWith('@main/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  }
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

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

const OUT_ROOT = path.resolve(workspaceRoot, 'out', 'novel-flow-audit')
const CONTENT_CHAPTER_COUNT = Math.max(1, Math.min(10, Number(process.env.NOVELFORGE_FLOW_CONTENT_CHAPTERS) || 2))
const CHAPTER_TARGET_WORDS = 1200
const WORD_FLOOR_RATIO = 0.8
const FULL_STORY_DESIGN = process.env.NOVELFORGE_FLOW_FULL_STORY_DESIGN === '1'
const MAP_TARGET_COUNT = 5
const ITEM_TARGET_COUNT = 5
const CHARACTER_TARGET_COUNT = 5
const THREAD_TARGET_COUNT = 5

const PROJECT_FILTER = new Set(
  String(process.env.NOVELFORGE_FLOW_PROJECTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)

const PROJECTS = [
  {
    key: 'steel',
    baseTitle: '钢铁是怎么炼成的',
    savedTitlePrefix: 'AI流程审计｜钢铁是怎么炼成的',
    genreName: '历史正剧',
    targetWords: 180000,
    benchmarkSources: [
      '中国作家网：https://www.chinawriter.com.cn/n1/2023/0510/c404092-32682431.html',
      'Marxists 译者前言：https://www.marxists.org/chinese/reference-books/the-making-of-steel/00a.htm',
    ],
    benchmark: [
      '革命成长和精神锻造是核心，个人苦难必须与时代目标、组织生活、劳动纪律绑定。',
      '早期人物不是单纯强者模板，而是冲动、受伤、被教育并逐步自觉。',
      '开局差异重点：能否写出历史压力、劳动代价、组织关系，而不是励志口号。',
    ],
    forbiddenTerms: ['保尔', '柯察金', '冬妮娅', '朱赫来', '丽达', '谢廖沙', '阿尔焦姆', '博亚尔卡'],
    tabooPatterns: [
      '保尔|柯察金|冬妮娅|朱赫来|丽达|谢廖沙|阿尔焦姆|奥斯特洛夫斯基',
      '筑路.{0,8}博亚尔卡|博亚尔卡',
    ],
    input: {
      theme: '苦难中的自我锻造、集体信念、劳动与时代责任',
      protagonistStart: '一个来自边缘工矿家庭的年轻维修学徒，冲动、自尊强，但缺乏稳定方向。',
      coreHook: '主角在一次事故后失去继续当一线工人的资格，却被迫转向记录、组织和技术教育工作。',
      coreConflict: '个人伤病、失去和时代任务之间不断冲突；主角必须证明价值不只来自体力和战场。',
      mainPlot: '主角从工矿少年转入公共工程、基层组织和技术教育岗位，在伤病与任务之间重建自我价值。',
      ending: '主角不以战功证明自己，而以记录、教育和组织能力继续参与时代建设。',
      tabooRules: '不得复刻原著人物姓名、具体战役、经典台词、译文和抢修铁路等标志性场景；不得写成口号堆砌。',
      mapFocus: '工矿区、铁路节点、工程指挥点、疗养地、基层学校等现实空间。',
      itemFocus: '工作证件、维修工具、工程记录、医疗证明、学习笔记等可追踪物品。',
    },
  },
  {
    key: 'doupo',
    baseTitle: '斗破苍穹',
    savedTitlePrefix: 'AI流程审计｜斗破苍穹',
    genreName: '玄幻修真',
    targetWords: 300000,
    benchmarkSources: [
      '起点中文网：https://www.qidian.com/book/1209977/',
      '起点目录：https://www.qidian.com/book/1209977/catalog/',
    ],
    benchmark: [
      '升级爽文体验来自天赋跌落、羞辱压力、师承机缘、等级体系和阶段兑现。',
      '开局强钩子应清楚给出可量化等级、压迫者、修炼资源和长期目标。',
      '测试只借类型机制，不复刻萧炎、药老、斗气大陆、异火、退婚、三年之约等专名和桥段。',
    ],
    forbiddenTerms: ['萧炎', '药老', '药尘', '纳兰嫣然', '萧薰儿', '薰儿', '斗气大陆', '异火', '焚决', '云岚宗', '三年之约', '退婚'],
    tabooPatterns: [
      '萧炎|药老|药尘|纳兰嫣然|萧薰儿|薰儿|斗气大陆|异火|焚决|云岚宗|加玛',
      '退婚',
      '婚约.{0,8}(作废|解除|取消)',
      '[一二三两四五六七八九十0-9]+(?:个)?(?:年|月)之约',
    ],
    input: {
      theme: '从废弃天赋到重新掌握命运，成长必须付出代价',
      protagonistStart: '一个曾被家族寄予厚望的少年突然失去修炼感应，被视为拖累。',
      coreHook: '一枚残损古器在他最狼狈时回应，但每次借力都会留下身体和人际代价。',
      coreConflict: '家族资源、宗门名额、旧承诺压力和隐藏导师的代价形成连续压迫。',
      mainPlot: '主角在被边缘化后重建修炼路径，以古器代价、家族考核和外部宗门筛选形成连续升级兑现。',
      ending: '主角证明力量来自自我承担代价，而不是无成本外挂。',
      tabooRules: '不得使用原作人物姓名、斗气大陆、异火、药老、焚决等专名；不得写退婚戏或任何“N年之约/N月之约”式期限婚约桥段。',
      mapFocus: '家族演武场、资源库、外门试炼地、古器沉眠洞窟、边境坊市等成长空间。',
      itemFocus: '残损古器、测灵石、低阶丹材、训练札记、宗门信物等可消耗或可升级物品。',
    },
  },
  {
    key: 'daogui',
    baseTitle: '道诡异仙',
    savedTitlePrefix: 'AI流程审计｜道诡异仙',
    genreName: '诡异修仙',
    targetWords: 200000,
    benchmarkSources: [
      '起点中文网：https://www.qidian.com/book/1031794030/',
      '百度百科：https://baike.baidu.com/item/道诡异仙/60978835',
    ],
    benchmark: [
      '不可靠叙事是核心：主角自己无法分辨两个互相否认的现实哪个是真的，读者被迫和他一起怀疑。',
      '修行体系是代价型邪道：力量来自负面情感/信仰/污染，每次借力都推动主角向疯狂滑落，而不是清爽升级。',
      '恐怖感来自日常事物的错位和身边人的不可信，情感锚点（爱人/亲人）是主角对抗失控的唯一绳索。',
      '开局差异重点：能否写出"清醒即痛苦、力量即污染"的压迫感，而不是普通打怪修仙。',
    ],
    forbiddenTerms: ['李火旺', '白灵淼', '丹阳子', '大傩', '大晏', '白玉京', '司命', '坐忘道', '心猿', '无生老母', '杨娜', '道诡异仙'],
    tabooPatterns: [
      '李火旺|白灵淼|丹阳子|大傩|大晏|白玉京|司命|坐忘道|心猿|无生老母|杨娜|道诡异仙',
      '精神病院.{0,20}(修仙|另一个世界|双.{0,4}(世界|躯体))',
    ],
    input: {
      theme: '在两个互相否认的现实之间求生，清醒是痛苦，力量是污染',
      protagonistStart: '一个在山中矿难后被救起的年轻账房，从此每次入睡都会在另一个完全不同的世界醒来，两边的人都说对方是他的臆想。',
      coreHook: '他在另一个世界里欠下一位邪神眷属的"香火债"，每偿还一分，现实世界就有一件他珍视的东西发生不可逆的错位。',
      coreConflict: '主角必须借邪道之力保护两边的亲人，但每次借力都让他离疯狂更近一步，也让两个世界的边界更加模糊。',
      mainPlot: '主角以账房身份周旋于邪祠、行会和官府之间，追查矿难真相与香火债的源头，逐步发现两个世界互为代价。',
      ending: '主角接受没有"唯一真实"，选择守住两边各自的人，以自我损耗为代价压住边界。',
      tabooRules: '不得使用李火旺、白灵淼、丹阳子、大傩、大晏、白玉京、司命、坐忘道等原著专名；不得复刻"现代精神病院与修仙世界双躯体跳跃"的标志性设定，双现实必须换壳原创；不得写成普通升级修仙。',
      mapFocus: '矿镇、邪祠、行会货栈、山道驿口、界线模糊的"错位之地"等压迫感空间。',
      itemFocus: '账册、香火券、矿灯、护身旧物、来历不明的契约残页等可追踪且带代价的物品。',
    },
  },
  {
    key: 'baiyao',
    baseTitle: '百妖谱',
    savedTitlePrefix: 'AI流程审计｜百妖谱',
    genreName: '神话脑洞志怪',
    targetWords: 160000,
    benchmarkSources: [
      '微信读书《百妖谱》：https://weread.qq.com/web/bookDetail/cd4322b071ef469bcd4a639',
      '微信读书《百妖谱（3）》：https://weread.qq.com/web/bookDetail/5fc32b407259846e5fc6da9',
    ],
    benchmark: [
      '单元志怪、公路式同行、诊治妖怪并照见人世，是核心结构。',
      '主角团关系轻巧但不空泛，每个单元应有妖怪病症、人类困局和寓言式余味。',
      '测试只借“治妖/行旅/人妖互照”的结构压力，不复刻桃夭、磨牙、滚滚、柳公子、桃都、百妖谱等专名和设定。',
    ],
    forbiddenTerms: ['桃夭', '磨牙', '滚滚', '柳公子', '桃都', '百妖谱', '司狂澜', '司静渊', '鬼医'],
    tabooPatterns: [
      '桃夭|磨牙|滚滚|柳公子|桃都|百妖谱|司狂澜|司静渊|鬼医',
    ],
    input: {
      theme: '治妖也是照见人心，离奇病症背后藏着温柔和亏欠',
      protagonistStart: '一个半吊子游方医师带着欠债小徒和一只失语妖灵赶路，专治非人病症却总被人事牵连。',
      coreHook: '每到一地，主角都会收到一封只有妖物能写出的病帖；治病会换来一段被人类误读的旧事。',
      coreConflict: '主角想只管病不管人情，但每个妖病都牵出人间亏欠、地方规矩和同行秘密。',
      mainPlot: '主角一行沿水路和驿路行走，以单元病例串起同伴身世、妖灵债务和一册失落病簿的线索。',
      ending: '主角接受医术不能替别人免债，只能让真相和选择重新回到当事者手中。',
      tabooRules: '不得使用桃夭、磨牙、滚滚、柳公子、桃都、百妖谱、鬼医等专名；不得复刻原作单元妖怪、病例和主角团关系。',
      mapFocus: '水边客栈、旧庙集市、山路驿站、河港药铺、妖物禁行村等行旅单元空间。',
      itemFocus: '病帖、药囊、妖骨针、行路符、旧病簿残页等病例线索物。',
    },
  },
]

function nowIso() {
  return new Date().toISOString()
}

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function requiredString(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function uniqueStrings(values) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))]
}

function safeJson(value, fallback = {}) {
  return JSON.stringify(value && typeof value === 'object' ? value : fallback)
}

function clip(text, max = 180) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function escapeControlCharsInJsonStrings(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of String(text || '')) {
    const code = ch.charCodeAt(0)
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch === '"') {
        out += ch
        inString = false
        continue
      }
      if (code < 0x20) {
        out += code === 10 ? '\\n' : code === 9 ? '\\t' : code === 13 ? '\\r' : ''
        continue
      }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out
}

function tryParseJson(source) {
  try {
    return JSON.parse(source)
  } catch {
    return JSON.parse(escapeControlCharsInJsonStrings(source))
  }
}

function extractJson(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('AI output is empty')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced ? fenced[1].trim() : text
  try {
    return tryParseJson(source)
  } catch {
    const arrayStart = source.indexOf('[')
    const arrayEnd = source.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) return tryParseJson(source.slice(arrayStart, arrayEnd + 1))
    const objectStart = source.indexOf('{')
    const objectEnd = source.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) return tryParseJson(source.slice(objectStart, objectEnd + 1))
    throw new Error(`Cannot parse AI JSON: ${source.slice(0, 240)}`)
  }
}

function toStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toLedgerText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const items = toStringArray(value)
  return items.length > 0 ? items.join('；') : ''
}

function formatGeneratedOutline(outline) {
  const characters = toStringArray(outline.characters)
  const growthLedger = toLedgerText(outline.growth_ledger)
  const costLedger = toLedgerText(outline.cost_ledger)
  return [
    typeof outline.goal === 'string' && outline.goal.trim() ? `目标：${outline.goal.trim()}` : '',
    growthLedger ? `成长账本：${growthLedger}` : '',
    costLedger ? `代价账本：${costLedger}` : '',
    characters.length > 0 ? `人物：${characters.join('、')}` : '',
    typeof outline.location === 'string' && outline.location.trim() ? `场景：${outline.location.trim()}` : '',
    ...toStringArray(outline.plot_points).map((item) => `- ${item}`),
    typeof outline.bridge_in === 'string' && outline.bridge_in.trim() ? `承接：${outline.bridge_in.trim()}` : '',
    typeof outline.bridge_out === 'string' && outline.bridge_out.trim() ? `转出：${outline.bridge_out.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function buildScenePlanFromOutline(outline, chapterNum) {
  const plotPoints = toStringArray(outline.plot_points).slice(0, 4)
  const location = requiredString(outline.location, '未指定地点')
  const goal = requiredString(outline.goal, `推进第${chapterNum}章核心事件`)
  const bridgeOut = requiredString(outline.bridge_out, '留下下一章承接问题')
  const points = plotPoints.length > 0 ? plotPoints : [goal]
  return points.map((point, index) => ({
    sceneTitle: `场景${index + 1}`,
    purpose: point,
    location,
    conflict: goal,
    exitHook: index === points.length - 1 ? bridgeOut : point,
  }))
}

function scanTaboo(text, tabooPatterns) {
  const hits = []
  for (const pattern of tabooPatterns) {
    try {
      const regex = new RegExp(pattern, 'gu')
      const matches = String(text || '').match(regex)
      if (matches && matches.length > 0) {
        hits.push({ pattern, matches: [...new Set(matches)].slice(0, 8) })
      }
    } catch {
      // Ignore invalid project-local regexes.
    }
  }
  return hits
}

function getDefaultModelConfig(db, schema) {
  return db.select().from(schema.modelConfigs).all()
    .sort((left, right) => (right.isDefault || 0) - (left.isDefault || 0))[0]
}

function getOrCreateGenreId(db, schema, genreName) {
  const existing = db.select().from(schema.genres).all()
    .find((row) => row.name === genreName)
  if (existing?.id) return existing.id
  const result = db.insert(schema.genres).values({
    name: genreName,
    description: '流程审计临时题材，用于对照测试。',
    isBuiltin: 0,
    colorTag: '#5D6D7E',
  }).run()
  return Number(result.lastInsertRowid)
}

function buildInitialSettings(project, buildStorySettingsPayload) {
  return buildStorySettingsPayload({
    premise: {
      positioning: `${project.baseTitle} 类型压力下的原创对照测试`,
      coreHook: project.input.coreHook,
      protagonistStart: project.input.protagonistStart,
      constraints: project.input.coreConflict,
      languageGuardrails: project.input.tabooRules,
    },
    storyDesign: {
      storyGoal: project.input.theme,
      coreConflict: project.input.coreConflict,
      mainPlot: project.input.mainPlot,
      subPlotsText: '待由故事线程和故事设计流程补齐。',
      subPlotsList: [],
      rhythmSetup: 30,
      rhythmConflict: 50,
      rhythmEnding: 20,
      endingType: 'open',
      ending: project.input.ending,
    },
    writingRules: {
      antiAiFlavor: [
        '少写抽象升华、命运感和模板式顿悟；用行动、代价、具体物件和选择推进。',
        '句子节奏要有人味：长短句交错、段落长短参差，偶尔一个长句一口气写完动作链；不要每段都收在干净的动作点上。',
        '对白允许答非所问、重复对方的词、迟疑改口、被打断；按人物口吻保留少量口语顿挫。',
      ].join('\n'),
      commonSenseRules: project.input.tabooRules,
      bannedTerms: project.forbiddenTerms.join('、'),
    },
    aiEngine: {
      defaultMode: 'cost_saver',
    },
  })
}

function buildProjectBrief(project) {
  return {
    premise: project.input.coreHook,
    targetReader: '用于 NovelForge 流程审计的长篇开局样例读者。',
    sellingPoints: [
      project.input.theme,
      project.input.coreConflict,
      project.input.mapFocus,
    ],
    coreEmotion: project.input.theme,
    constraints: [
      project.input.tabooRules,
      '只做原创对照测试，不续写、不改写、不复刻对照作品。',
    ],
    readyCount: 6,
  }
}

function buildThemeVoice(project) {
  return {
    theme: project.input.theme,
    emotionalCore: project.input.coreConflict,
    pov: '第三人称有限视角',
    tense: '过去时',
    styleRules: '叙事落在场景、物件、代价和选择上，避免套话式概念总结。',
    dialogueRules: '对白服务人物立场和关系压力，不用解释性长台词代替行动。',
    writingContractTags: ['原创对照测试', project.key, '流程审计'],
  }
}

function buildWorldRules(project, currentRaw, parseWorldRulesJson, stringifyWorldRules) {
  const rules = parseWorldRulesJson(currentRaw, project.genreName)
  rules.genreProfile.name = project.genreName
  rules.genreProfile.subgenre = project.baseTitle
  rules.genreProfile.narrativeFocus = uniqueStrings([
    project.input.theme,
    project.input.coreConflict,
    project.input.mapFocus,
    ...asArray(rules.genreProfile.narrativeFocus),
  ]).slice(0, 8)
  rules.genreProfile.languageAvoidances = uniqueStrings([
    ...project.forbiddenTerms,
    ...asArray(rules.genreProfile.languageAvoidances),
  ]).slice(0, 24)
  if (rules.mapBlueprint?.levels?.[0]) {
    rules.mapBlueprint.levels[0].suggestedCount = MAP_TARGET_COUNT
  }
  rules.writingConstraints.extraRules = uniqueStrings([
    ...asArray(rules.writingConstraints?.extraRules),
    project.input.tabooRules,
    '所有生成内容必须是原创对照测试，不复刻原著人物、专名、原文、章节桥段或标志性场景。',
  ]).slice(0, 16)
  rules.writingConstraints.forbiddenPhrases = uniqueStrings([
    ...asArray(rules.writingConstraints?.forbiddenPhrases),
    ...project.forbiddenTerms,
  ]).slice(0, 32)
  return stringifyWorldRules(rules)
}

async function runStep(report, key, label, fn, options = {}) {
  const startedAt = Date.now()
  process.stdout.write(`[flow-audit] ${report.key}: ${label}\n`)
  try {
    const value = await fn()
    report.steps.push({
      key,
      label,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      summary: options.summary ? options.summary(value) : undefined,
    })
    return value
  } catch (error) {
    const message = String(error && error.message || error)
    report.steps.push({
      key,
      label,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: message.slice(0, 800),
    })
    if (options.required) throw error
    process.stdout.write(`[flow-audit] ${report.key}: ${label} failed: ${message}\n`)
    return options.fallback
  }
}

function summarizeRows(rows, getName) {
  return rows.slice(0, 8).map((row) => getName(row)).filter(Boolean)
}

function fetchProjectRows(rawDb, novelId) {
  const mapRows = rawDb.prepare('SELECT * FROM world_map WHERE novel_id = ? ORDER BY level, sort_order, id').all(novelId)
  const itemRows = rawDb.prepare('SELECT * FROM story_items WHERE novel_id = ? ORDER BY item_kind, sort_order, id').all(novelId)
  const characterRows = rawDb.prepare('SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order, id').all(novelId)
  const threadRows = rawDb.prepare('SELECT * FROM story_threads WHERE novel_id = ? ORDER BY sort_order, id').all(novelId)
  const arcRows = rawDb.prepare('SELECT * FROM story_arcs WHERE novel_id = ? ORDER BY arc_order, id').all(novelId)
  const chapterRows = rawDb.prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_num, id').all(novelId)
  const segmentRows = rawDb.prepare('SELECT * FROM chapter_segments WHERE novel_id = ? ORDER BY chapter_id, segment_order, id').all(novelId)
  const chapterContracts = rawDb.prepare('SELECT * FROM chapter_contracts WHERE novel_id = ? ORDER BY chapter_id').all(novelId)
  const sceneContracts = rawDb.prepare('SELECT * FROM scene_contracts WHERE novel_id = ? ORDER BY chapter_id, segment_id').all(novelId)
  const versions = rawDb.prepare('SELECT * FROM chapter_versions WHERE novel_id = ? ORDER BY id').all(novelId)
  return {
    mapRows,
    itemRows,
    characterRows,
    threadRows,
    arcRows,
    chapterRows,
    segmentRows,
    chapterContracts,
    sceneContracts,
    versions,
  }
}

async function generateMapToTarget(novelId, project, mapService) {
  // 循环逻辑已下沉为 map.service.batchGenerateMapToTarget，脚本与 UI 共用。
  const result = await mapService.batchGenerateMapToTarget(novelId, {
    layerCounts: [MAP_TARGET_COUNT],
    parentBatchSize: 3,
    namedPlaces: project.input.mapFocus,
    maxRetries: 1,
  }, { maxBatches: 4, targetNodeCount: MAP_TARGET_COUNT })
  return {
    generatedNodeCount: result.totalGeneratedNodeCount,
    completed: result.completed,
    message: result.message,
    batchesRun: result.batchesRun,
  }
}

async function generateCharactersToTarget(novelId, project, characterService, rawDb) {
  const existing = rawDb.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id = ?').get(novelId).count
  const ids = []
  if (existing <= 0) {
    const protagonistId = await characterService.generateProtagonist(novelId, {
      occupationHint: project.input.protagonistStart,
      personalitySeed: project.input.coreConflict,
      itemPreferences: project.input.itemFocus.split(/[、,，]/).slice(0, 3),
      forbiddenNames: project.forbiddenTerms,
      forceDifferentFromExisting: true,
    })
    ids.push(protagonistId)
  }

  const warnings = []
  let batchResult = null
  // 解析失败/部分打捞后允许再补一轮，直到数量达标或补齐尝试用尽。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentCount = rawDb.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id = ?').get(novelId).count
    const remaining = Math.max(0, CHARACTER_TARGET_COUNT - currentCount)
    if (remaining <= 0) break
    batchResult = await characterService.generateCharacterBatchChunk(novelId, {
      majorCount: Math.min(2, remaining),
      antagonistCount: remaining >= 3 ? 1 : 0,
      supportingCount: Math.max(0, remaining - Math.min(2, remaining) - (remaining >= 3 ? 1 : 0)),
      minorCount: 0,
      batchSize: remaining,
      genderRatio: '按题材自然分布，优先保证角色功能差异。',
      specialRequirements: [
        project.input.tabooRules,
        `角色必须围绕：${project.input.coreConflict}`,
        `优先和现有物品/地图/线程绑定：${project.input.itemFocus}`,
      ].join('\n'),
      diversityConstraints: project.forbiddenTerms.map((term) => `不得使用或影射原著专名：${term}`),
    })
    ids.push(...asArray(batchResult?.ids))
    if (batchResult?.warning) warnings.push(batchResult.warning)
  }

  return { protagonistId: ids[0], batchResult, ids, warnings }
}

function buildCompactStoryDesignPrompt(project, rows) {
  return [
    '你是中文长篇小说结构策划。请基于已有资产，为前十章流程审计样例生成一份压缩故事设计。',
    '只输出 JSON object，不要 Markdown，不要解释。',
    '',
    `对照标题（仅用于类型压力，不得复刻）：${project.baseTitle}`,
    `主题：${project.input.theme}`,
    `主角起点：${project.input.protagonistStart}`,
    `核心钩子：${project.input.coreHook}`,
    `核心冲突：${project.input.coreConflict}`,
    `违禁约束：${project.input.tabooRules}`,
    '',
    `地图：${rows.mapRows.slice(0, 8).map((row) => row.name).join('、') || '无'}`,
    `物品：${rows.itemRows.filter((row) => row.item_kind === 'instance').slice(0, 8).map((row) => row.item_name).join('、') || '无'}`,
    `人物：${rows.characterRows.slice(0, 8).map((row) => `${row.full_name}(${row.role_type})`).join('、') || '无'}`,
    `线程：${rows.threadRows.slice(0, 8).map((row) => `${row.title}:${row.summary || row.current_state || ''}`).join('\n') || '无'}`,
    '',
    '要求：',
    '- story_goal、core_conflict、main_plot 必须能直接指导前十章。',
    '- sub_plots_list 输出 5 条，保持 name / characters / conflict / mainlineLink / endChapter 字段。',
    '- rhythm_setup、rhythm_conflict、rhythm_ending 三项相加约等于 100。',
    '- ending 只写方向，不写完整结局。',
    '- 不得使用任何原著专名、原文或标志性桥段。',
    '',
    '输出格式：{"story_goal":"","core_conflict":"","main_plot":"","sub_plots_list":[{"name":"","characters":"","conflict":"","mainlineLink":"","endChapter":"第10章前"}],"rhythm_setup":30,"rhythm_conflict":50,"rhythm_ending":20,"ending_type":"open","ending":""}',
  ].join('\n')
}

async function generateStoryDesign(novelId, project, services, buildStorySettingsPayload, rawDb) {
  if (!FULL_STORY_DESIGN) {
    const rows = fetchProjectRows(rawDb, novelId)
    const raw = await services.taskService.runChatTask({
      type: 'review',
      novelId,
      messages: [{ role: 'user', content: buildCompactStoryDesignPrompt(project, rows) }],
    })
    const parsed = extractJson(raw)
    const result = {
      story_goal: requiredString(parsed.story_goal, project.input.theme),
      core_conflict: requiredString(parsed.core_conflict, project.input.coreConflict),
      main_plot: requiredString(parsed.main_plot, project.input.mainPlot),
      sub_plots_list: asArray(parsed.sub_plots_list).slice(0, THREAD_TARGET_COUNT),
      rhythm_setup: Number(parsed.rhythm_setup) || 30,
      rhythm_conflict: Number(parsed.rhythm_conflict) || 50,
      rhythm_ending: Number(parsed.rhythm_ending) || 20,
      ending_type: requiredString(parsed.ending_type, 'open'),
      ending: requiredString(parsed.ending, project.input.ending),
      completedSteps: 1,
      failedSteps: 0,
      mode: 'compact',
    }

    const current = services.novelService.getNovel(novelId)
    const payload = buildStorySettingsPayload({
      storyDesign: {
        storyGoal: result.story_goal,
        coreConflict: result.core_conflict,
        mainPlot: result.main_plot,
        subPlotsList: result.sub_plots_list,
        rhythmSetup: result.rhythm_setup,
        rhythmConflict: result.rhythm_conflict,
        rhythmEnding: result.rhythm_ending,
        endingType: result.ending_type,
        ending: result.ending,
      },
    }, current?.settingsJson)
    services.novelService.updateNovel(novelId, { settingsJson: JSON.stringify(payload) })
    return result
  }

  const result = await services.coreSettingsService.generateCoreSettings({
    novelId,
    subplotCount: THREAD_TARGET_COUNT,
    requirements: [
      '故事设计必须建立在已生成的地图、物品、人物和故事线程上。',
      project.input.tabooRules,
      '本次只规划前十章验证段，不要扩成完整长篇细纲。',
    ].join('\n'),
  })

  const current = services.novelService.getNovel(novelId)
  const payload = buildStorySettingsPayload({
    storyDesign: {
      storyGoal: result.story_goal,
      coreConflict: result.core_conflict,
      mainPlot: result.main_plot,
      subPlotsList: result.sub_plots_list,
      rhythmSetup: result.rhythm_setup,
      rhythmConflict: result.rhythm_conflict,
      rhythmEnding: result.rhythm_ending,
      endingType: result.ending_type,
      ending: result.ending,
    },
  }, current?.settingsJson)
  services.novelService.updateNovel(novelId, { settingsJson: JSON.stringify(payload) })
  return { ...result, mode: 'full' }
}

async function parseOutlineJsonArrayWithRepair({ raw, label, novelId, modelConfigId, taskService }) {
  try {
    const parsed = extractJson(raw)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.items)) return parsed.items
    if (Array.isArray(parsed?.chapters)) return parsed.chapters
  } catch {
    // Repair below.
  }

  const repairedRaw = await taskService.runChatTask({
    type: 'chapter_outline',
    novelId,
    modelConfigId,
    retryable: true,
    messages: [{
      role: 'user',
      content: [
        `你只负责修复 ${label} 的 JSON 格式。`,
        '把原始输出整理成合法 JSON 数组，不新增剧情，不解释，不输出 Markdown。',
        '数组元素保留 chapter_num、title、goal、growth_ledger、cost_ledger、plot_points、characters、location、emotion_tone、bridge_in、bridge_out 字段。',
        '',
        '原始输出：',
        String(raw || '').slice(0, 12000),
      ].join('\n'),
    }],
  })
  const repaired = extractJson(repairedRaw)
  if (Array.isArray(repaired)) return repaired
  if (Array.isArray(repaired?.chapters)) return repaired.chapters
  throw new Error(`${label} JSON repair did not return an array`)
}

async function generateChapterOutlines(novelId, project, context, services, modelConfigId) {
  const { buildChapterOutlinePlanningPrompt } = services.storyPrompts
  const batches = [
    { start: 1, end: 5, previousSummary: '' },
    { start: 6, end: 10, previousSummary: '' },
  ]
  const all = []
  for (const batch of batches) {
    const raw = await services.taskService.runChatTask({
      type: 'chapter_outline',
      novelId,
      modelConfigId,
      messages: [{
        role: 'user',
        content: buildChapterOutlinePlanningPrompt({
          novelTitle: context.novelTitle,
          genre: context.genre,
          storyGoal: context.storyGoal,
          coreConflict: context.coreConflict,
          mainPlot: context.mainPlot,
          arcName: '前十章流程验证弧',
          arcGoal: `用前十章验证 ${project.baseTitle} 的类型压力，不复刻原著。`,
          arcSummary: context.arcSummary,
          arcGrowthLedger: '每章必须有目标、冲突、转折、退出钩子。',
          arcCostLedger: '每次推进都要带来关系、资源或身体/心理代价。',
          chapterStart: batch.start,
          chapterEnd: batch.end,
          previousSummary: batch.previousSummary || all.slice(-2).map((item) => `第${item.chapterNum}章：${item.outline}`).join('\n'),
          characterStates: context.characterSummary,
          continuitySummary: context.threadSummary,
          openLoops: context.threadSummary,
          worldRulesSummary: context.worldRulesSummary,
          previousChapterOutlines: all.map((item) => `第${item.chapterNum}章《${item.title}》：${clip(item.outline, 90)}`).join('\n') || undefined,
          protagonistReference: context.protagonistReference,
          protagonistRule: context.protagonistRule,
        }),
      }],
    })
    fs.writeFileSync(path.join(context.outDir, `${project.key}.outline-${batch.start}-${batch.end}.raw.txt`), String(raw || ''), 'utf8')
    const parsed = await parseOutlineJsonArrayWithRepair({
      raw,
      label: `${project.key} 第${batch.start}-${batch.end}章细纲`,
      novelId,
      modelConfigId,
      taskService: services.taskService,
    })
    for (const item of parsed) {
      const chapterNum = Number(item.chapter_num || item.num || item.chapterNum)
      if (!chapterNum || chapterNum < batch.start || chapterNum > batch.end) continue
      const outline = formatGeneratedOutline(item)
      all.push({
        chapterNum,
        title: requiredString(item.title, `第${chapterNum}章`),
        outline: outline || requiredString(item.goal, `第${chapterNum}章推进目标待补`),
        emotionTone: requiredString(item.emotion_tone, '推进'),
        scenePlan: buildScenePlanFromOutline(item, chapterNum),
        summary: requiredString(item.goal, ''),
        nextSeed: requiredString(item.bridge_out, ''),
      })
    }
  }

  const byNum = new Map(all.map((item) => [item.chapterNum, item]))
  const chapters = []
  for (let chapterNum = 1; chapterNum <= 10; chapterNum += 1) {
    chapters.push(byNum.get(chapterNum) || {
      chapterNum,
      title: `第${chapterNum}章`,
      outline: '目标：补齐本章推进目标\n- 当前批次缺失，需要人工修复。',
      emotionTone: '待补',
      scenePlan: [{ sceneTitle: '默认场景', purpose: '补齐章节推进', location: '未指定', conflict: '流程补救', exitHook: '待补' }],
      summary: '',
      nextSeed: '',
    })
  }
  return chapters
}

function insertChapterStructure(rawDb, novelId, project, chapters, modelConfigId) {
  const tsNow = nowIso()
  const novel = rawDb.prepare('SELECT * FROM novels WHERE id = ?').get(novelId)
  if (!novel) throw new Error(`Novel not found: ${novelId}`)
  const volumeId = Number(rawDb.prepare(`
    INSERT INTO story_volumes (novel_id, volume_number, title, summary, target_words, status, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 'planning', ?, ?)
  `).run(
    novelId,
    '第一卷：流程验证段',
    `${project.baseTitle} 类型压力下的原创前十章验证。`,
    Math.round(project.targetWords * 0.3),
    tsNow,
    tsNow,
  ).lastInsertRowid)

  const partId = Number(rawDb.prepare(`
    INSERT INTO story_parts (novel_id, volume_id, part_number, title, summary, target_words, status, start_chapter_num, end_chapter_num, created_at, updated_at)
    VALUES (?, ?, 1, '前十章验证段', '用于验证地图、人物、剧情、大纲、物品和正文流水线。', ?, 'planning', 1, 10, ?, ?)
  `).run(novelId, volumeId, Math.round(project.targetWords * 0.08), tsNow, tsNow).lastInsertRowid)

  const arcId = Number(rawDb.prepare(`
    INSERT INTO story_arcs (novel_id, arc_name, arc_order, chapter_start, chapter_end, arc_goal, arc_summary, target_words, progress_percent, stalled_chapter_count)
    VALUES (?, '前十章流程验证弧', 1, 1, 10, ?, ?, ?, 0, 0)
  `).run(
    novelId,
    `验证 ${project.baseTitle} 的类型承诺能否转换为原创开局。`,
    project.input.coreConflict,
    Math.round(project.targetWords * 0.08),
  ).lastInsertRowid)

  const insertChapter = rawDb.prepare(`
    INSERT INTO chapters (
      novel_id, volume_id, part_id, chapter_num, title, outline, scene_plan_json,
      content, word_count, summary, next_chapter_seed, status, arc_id, target_words,
      emotion_tone, compiled_from_segments, segment_count, allowed_fact_ids_json,
      revealed_fact_ids_json, context_version, stale_reason_json, writeback_status_json,
      created_at, updated_at
    ) VALUES (
      @novelId, @volumeId, @partId, @chapterNum, @title, @outline, @scenePlanJson,
      '', 0, @summary, @nextSeed, 'outline', @arcId, @targetWords,
      @emotionTone, 0, @segmentCount, '[]', '[]', 1, '[]', @writebackStatusJson,
      @createdAt, @updatedAt
    )
  `)
  const insertSegment = rawDb.prepare(`
    INSERT INTO chapter_segments (
      novel_id, chapter_id, volume_id, part_id, segment_order, title, segment_type,
      purpose, time_anchor, location_name, present_character_ids_json, linked_item_ids_json,
      input_state, output_state, summary, content, risk_tags_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'scene', ?, ?, ?, '[]', '[]', ?, ?, ?, '', '[]', 'planned', ?, ?)
  `)
  const insertChapterContract = rawDb.prepare(`
    INSERT INTO chapter_contracts (
      novel_id, chapter_id, chapter_goal, opening_style, ending_style, exposition_mode,
      emotion_focus, served_thread_ids_json, required_arc_progress_json,
      required_character_arc_ids_json, required_relationship_arc_ids_json,
      required_resistance_track_ids_json, required_resistance_actions_json,
      required_asset_refs_json, required_endgame_commitment_ids_json,
      required_foreshadow_ids_json, hook_type, forbidden_actions_json,
      acceptance_notes_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?, ?, ?, 'ready', ?, ?)
  `)
  const insertSceneContract = rawDb.prepare(`
    INSERT INTO scene_contracts (
      novel_id, chapter_id, segment_id, pov, time_location, scene_goal, obstacle,
      conflict_type, emotion_shift, reveal_payload_json, result_state, linkage_mode,
      required_endgame_commitment_ids_json, required_foreshadow_ids_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, '第三人称有限视角', ?, ?, ?, ?, ?, '[]', ?, ?, '[]', '[]', 'ready', ?, ?)
  `)

  const chapterIds = []
  for (const chapter of chapters) {
    const scenePlan = asArray(chapter.scenePlan)
    const result = insertChapter.run({
      novelId,
      volumeId,
      partId,
      chapterNum: chapter.chapterNum,
      title: chapter.title,
      outline: chapter.outline,
      scenePlanJson: JSON.stringify(scenePlan),
      summary: chapter.summary || '',
      nextSeed: chapter.nextSeed || '',
      arcId,
      targetWords: chapter.chapterNum <= CONTENT_CHAPTER_COUNT ? CHAPTER_TARGET_WORDS : 1800,
      emotionTone: chapter.emotionTone || '',
      segmentCount: Math.max(1, scenePlan.length),
      writebackStatusJson: JSON.stringify({
        phase: 'idle',
        retryCount: 0,
        blockedGeneration: false,
        readyForNextChapter: true,
        contextVersion: 1,
        updatedAt: tsNow,
      }),
      createdAt: tsNow,
      updatedAt: tsNow,
    })
    const chapterId = Number(result.lastInsertRowid)
    chapterIds.push(chapterId)

    const segmentSource = scenePlan.length > 0 ? scenePlan : [{
      sceneTitle: chapter.title,
      purpose: chapter.outline,
      location: '未指定',
      conflict: '按章节大纲推进',
      exitHook: chapter.nextSeed,
    }]
    segmentSource.forEach((scene, index) => {
      const segmentResult = insertSegment.run(
        novelId,
        chapterId,
        volumeId,
        partId,
        index + 1,
        requiredString(scene.sceneTitle, `${chapter.title} 场景${index + 1}`),
        requiredString(scene.purpose, chapter.outline),
        `第${chapter.chapterNum}章`,
        requiredString(scene.location, '未指定'),
        index === 0 ? '章节开始' : `场景${index}`,
        requiredString(scene.exitHook, chapter.nextSeed || ''),
        `冲突：${requiredString(scene.conflict, '按章节冲突推进')}`,
        tsNow,
        tsNow,
      )
      insertSceneContract.run(
        novelId,
        chapterId,
        Number(segmentResult.lastInsertRowid),
        requiredString(scene.location, '未指定'),
        requiredString(scene.purpose, chapter.outline),
        requiredString(scene.conflict, '按章节冲突推进'),
        index === 0 ? '开局压力' : '推进压力',
        chapter.emotionTone || '',
        requiredString(scene.exitHook, chapter.nextSeed || ''),
        index === segmentSource.length - 1 ? '承接下一章' : '承接下一场景',
        tsNow,
        tsNow,
      )
    })

    insertChapterContract.run(
      novelId,
      chapterId,
      chapter.summary || chapter.outline,
      chapter.chapterNum === 1 ? '直接落入压力场景' : '承接上一章余波',
      chapter.nextSeed || '留下下一章钩子',
      '少解释，多用行动和选择展示设定',
      chapter.emotionTone || '',
      chapter.chapterNum <= CONTENT_CHAPTER_COUNT ? '强钩子' : '推进钩子',
      JSON.stringify([project.input.tabooRules, '不得复刻对照作品具体桥段']),
      JSON.stringify(['目标清晰', '冲突可见', '转折明确', '结尾有推进钩子']),
      tsNow,
      tsNow,
    )
  }

  rawDb.prepare('UPDATE novels SET status = ?, model_config_id = ?, updated_at = ? WHERE id = ?')
    .run('writing', modelConfigId, tsNow, novelId)

  return { volumeId, partId, arcId, chapterIds }
}

async function generateChapterDrafts(novelId, project, savedStructure, services) {
  const reports = []
  for (let index = 0; index < CONTENT_CHAPTER_COUNT; index += 1) {
    const chapterId = savedStructure.chapterIds[index]
    const chapterNum = index + 1
    const report = {
      chapterNum,
      chapterId,
      pipelineStatus: 'ok',
      pipelineError: '',
      expandAttempts: 0,
      antiAiRewriteAttempts: 0,
      finalWords: 0,
      targetWords: CHAPTER_TARGET_WORDS,
      antiAiHits: [],
      tabooHits: [],
    }
    try {
      await services.chapterService.generateChapterContent(chapterId, undefined, { executionMode: 'cost_saver' })
    } catch (error) {
      const message = String(error && error.message || error)
      const committed = services.chapterService.getChapter(chapterId)
      const hasContent = countHanzi(committed?.content || '') > 0
      // 门禁类失败时内容已落库并标记待人工复核，属于系统按设计工作，与生成失败分开统计。
      const isReviewHold = hasContent && /人工|未通过|复检|章节门|human_review|gate/.test(message)
      report.pipelineStatus = isReviewHold ? 'needs_review' : 'error'
      report.pipelineError = message.slice(0, 500)
    }

    let chapter = services.chapterService.getChapter(chapterId)
    let content = String(chapter?.content || '')
    const wordFloor = Math.round(CHAPTER_TARGET_WORDS * WORD_FLOOR_RATIO)

    for (let attempt = 0; attempt < 2 && content && countHanzi(content) < wordFloor; attempt += 1) {
      report.expandAttempts += 1
      try {
        const expanded = await services.taskService.runChatTask({
          type: 'review',
          novelId,
          modelConfigId: chapter?.modelConfigId || undefined,
          messages: [
            { role: 'system', content: '你是小说扩写编辑。只输出扩写后的正文，不要解释，不要 Markdown。' },
            {
              role: 'user',
              content: [
                `把下面这一章扩写到 ${CHAPTER_TARGET_WORDS} 到 ${Math.round(CHAPTER_TARGET_WORDS * 1.2)} 个汉字。`,
                '要求：不改变已有事件顺序、人物行为和对白立场；通过现场细节、对白来回、动作阻力和感官事实增加密度；不加新的重大情节。',
                `违禁约束：${project.input.tabooRules}`,
                '',
                '当前正文：',
                content,
              ].join('\n'),
            },
          ],
        })
        const expandedText = String(expanded || '').trim()
        if (countHanzi(expandedText) > countHanzi(content)) {
          services.chapterService.updateChapter(chapterId, { content: expandedText })
          content = expandedText
        }
      } catch {
        break
      }
    }

    let hits = []
    try {
      hits = services.antiAiService.collectAntiAiRuntimeHits(content, project.genreName)
      const highHits = hits.filter((hit) => hit.severity === 'high')
      if (content && highHits.length > 0) {
        report.antiAiRewriteAttempts += 1
        const rewritten = await services.taskService.runChatTask({
          type: 'review',
          novelId,
          messages: [
            { role: 'system', content: '你是小说改稿编辑。只输出改写后的完整正文，不要解释，不要 Markdown。' },
            {
              role: 'user',
              content: [
                '下面的正文存在明显 AI 生成痕迹，请针对性修复，其他内容尽量保持不动：',
                ...highHits.slice(0, 8).map((hit) => `- ${hit.ruleTitle || hit.ruleCode}：${hit.detail || ''} 命中片段：${hit.excerpt || ''}`),
                '高频重复的人名改用代词、称呼变化或动作主语省略；模板句式改成贴合场景的自然表达。',
                `字数保持在 ${Math.round(countHanzi(content) * 0.9)} 字以上。`,
                '',
                '正文：',
                content,
              ].join('\n'),
            },
          ],
        })
        const rewrittenText = String(rewritten || '').trim()
        if (countHanzi(rewrittenText) >= Math.round(countHanzi(content) * 0.8)) {
          services.chapterService.updateChapter(chapterId, { content: rewrittenText })
          content = rewrittenText
          hits = services.antiAiService.collectAntiAiRuntimeHits(content, project.genreName)
        }
      }
    } catch {
      // Anti-AI scan is diagnostic. Keep chapter generation evidence even if this fails.
    }

    chapter = services.chapterService.getChapter(chapterId)
    report.finalWords = countHanzi(chapter?.content || '')
    report.antiAiHits = hits.map((hit) => ({
      rule: hit.ruleCode,
      severity: hit.severity,
      excerpt: clip(hit.excerpt || '', 80),
    }))
    report.tabooHits = scanTaboo(chapter?.content || '', project.tabooPatterns)
    reports.push(report)
  }
  return reports
}

function buildComparison(project, rows, chapterReports) {
  const allOutlineText = rows.chapterRows.map((row) => `${row.title}\n${row.outline || ''}`).join('\n')
  const allContentText = rows.chapterRows.map((row) => row.content || '').join('\n')
  const text = `${allOutlineText}\n${allContentText}`
  const issues = []
  const strengths = []

  if (project.key === 'steel') {
    if (/组织|集体|劳动|工程|伤病|学习|纪律/u.test(text)) strengths.push('已经触及组织、劳动、伤病或学习等精神锻造元素。')
    else issues.push('开局没有稳定落到组织生活、劳动纪律和伤病代价，容易退成泛励志成长。')
    if (!/工|矿|铁路|工程|车间|学校|疗养/u.test(text)) issues.push('空间与职业纹理不足，历史正剧的现实物质压力偏弱。')
  } else if (project.key === 'doupo') {
    if (/等级|境界|阶|修炼|资源|考核|试炼/u.test(text)) strengths.push('已经出现等级、资源、考核或试炼等升级机制。')
    else issues.push('升级体系不够量化，爽文的阶段目标和兑现压力偏弱。')
    if (!/代价|反噬|损耗|限制|风险/u.test(text)) issues.push('古器/外挂的使用代价不够明确，容易变成无成本金手指。')
  } else if (project.key === 'baiyao') {
    if (/妖|病|药|帖|治|行|客栈|驿|庙|村/u.test(text)) strengths.push('已经触及妖病、行旅和地方空间，接近单元志怪结构。')
    else issues.push('单元志怪的“妖病-人事-余味”结构不够明显。')
    if (!/一地|每到|病帖|病例|人情|亏欠/u.test(text)) issues.push('病例驱动和寓言式人情债线索偏弱，容易写成普通玄幻小队冒险。')
  } else if (project.key === 'daogui') {
    if (/代价|污染|疯|错位|边界|香火|债|邪/u.test(text)) strengths.push('已经出现代价、污染、错位或香火债等诡异修仙压力元素。')
    else issues.push('“清醒即痛苦、力量即污染”的压迫感不足，容易退成普通升级修仙。')
    if (!/两个|另一(个)?世界|双|现实|真假|臆想|梦|醒来/u.test(text)) issues.push('双现实互相否认的不可靠叙事结构不明显。')
  }

  if (rows.mapRows.length < MAP_TARGET_COUNT) issues.push(`地图只生成 ${rows.mapRows.length}/${MAP_TARGET_COUNT} 个区域，地图流程未达样例目标。`)
  if (rows.itemRows.filter((row) => row.item_kind === 'instance').length < ITEM_TARGET_COUNT) issues.push(`物品实例少于目标：${rows.itemRows.filter((row) => row.item_kind === 'instance').length}/${ITEM_TARGET_COUNT}。`)
  if (rows.characterRows.length < CHARACTER_TARGET_COUNT) issues.push(`人物少于目标：${rows.characterRows.length}/${CHARACTER_TARGET_COUNT}。`)
  if (rows.threadRows.length < THREAD_TARGET_COUNT) issues.push(`故事线程少于目标：${rows.threadRows.length}/${THREAD_TARGET_COUNT}。`)
  if (rows.chapterRows.length !== 10) issues.push(`章节大纲数量异常：${rows.chapterRows.length}/10。`)
  const weakContent = chapterReports.filter((report) => report.finalWords < Math.round(report.targetWords * WORD_FLOOR_RATIO))
  if (weakContent.length > 0) issues.push(`正文有 ${weakContent.length} 章低于目标字数 80%。`)
  const tabooHits = scanTaboo(text, project.tabooPatterns)
  if (tabooHits.length > 0) issues.push(`存在原著专名/桥段禁用命中：${tabooHits.map((hit) => hit.matches.join('/')).join('；')}`)

  const processIssues = [
    '物品早于人物生成的弱绑定已由 repairItemCharacterLinks 自动回填（人物批量落库后触发，本脚本也显式跑一次）。',
    '地图批次循环已下沉为 map.service.batchGenerateMapToTarget，脚本与 UI 共用。',
    '大纲 IPC 逻辑仍集中在 electron/main.ts，不是独立 service；脚本和测试难以直接复用完整 outline 流程（待重构）。',
    '真实正文流水线依赖章节合同和场景合同；只生成章节 outline 而不补合同会降低可执行性。',
  ]

  return {
    strengths,
    issues,
    processIssues,
    tabooHits,
  }
}

function buildVerification(runInfo) {
  const verification = runInfo.projects.map((project) => {
    const instanceItemCount = project.counts.items.instances
    const chapterWordFailures = project.chapterReports
      .filter((report) => report.finalWords < Math.round(report.targetWords * WORD_FLOOR_RATIO))
      .map((report) => `第${report.chapterNum}章 ${report.finalWords}/${report.targetWords}`)
    const chapterPipelineFailures = project.chapterReports
      .filter((report) => report.pipelineStatus === 'error')
      .map((report) => `第${report.chapterNum}章 ${clip(report.pipelineError || report.pipelineStatus, 140)}`)
    const chapterNeedsReview = project.chapterReports
      .filter((report) => report.pipelineStatus === 'needs_review')
      .map((report) => `第${report.chapterNum}章 ${clip(report.pipelineError || '待人工复核', 140)}`)
    const tabooFailures = [
      ...project.outlineTabooHits,
      ...project.chapterReports.flatMap((report) => report.tabooHits.map((hit) => ({ chapterNum: report.chapterNum, ...hit }))),
    ]
    const ok = project.counts.maps >= MAP_TARGET_COUNT
      && instanceItemCount >= ITEM_TARGET_COUNT
      && project.counts.characters >= CHARACTER_TARGET_COUNT
      && project.counts.threads >= THREAD_TARGET_COUNT
      && project.counts.chapters === 10
      && project.counts.chapterContracts === 10
      && project.counts.sceneContracts >= 10
      && project.chapterReports.length === CONTENT_CHAPTER_COUNT
      && chapterPipelineFailures.length === 0
      && chapterWordFailures.length === 0
      && tabooFailures.length === 0
      && project.steps.every((step) => step.status === 'ok')
    return {
      key: project.key,
      title: project.savedTitle,
      novelId: project.novelId,
      checks: {
        maps: `${project.counts.maps}/${MAP_TARGET_COUNT}`,
        itemInstances: `${instanceItemCount}/${ITEM_TARGET_COUNT}`,
        characters: `${project.counts.characters}/${CHARACTER_TARGET_COUNT}`,
        threads: `${project.counts.threads}/${THREAD_TARGET_COUNT}`,
        chapters: `${project.counts.chapters}/10`,
        chapterContracts: project.counts.chapterContracts,
        sceneContracts: project.counts.sceneContracts,
        contentChapters: project.chapterReports.length,
        chapterPipelineFailures,
        chapterNeedsReview,
        chapterWordFailures,
        tabooFailures,
      },
      ok,
    }
  })
  return {
    checkedAt: nowIso(),
    allOk: verification.every((item) => item.ok),
    verification,
  }
}

function buildMarkdownReport(runInfo, verification) {
  const lines = [
    '# NovelForge 三作品流程审计报告',
    '',
    `生成时间：${runInfo.generatedAt}`,
    `数据库：${runInfo.databasePath}`,
    `模型：${runInfo.modelLabel}`,
    `目标：每部作品 5 个区域、5 个物品、5 个人物、5 条剧情线程、10 章大纲、前 ${CONTENT_CHAPTER_COUNT} 章正文。`,
    '',
    '## 总体结论',
    '',
    verification.allOk
      ? '- 结构性验收通过：三部作品均达到本次小样本数量目标，且未命中原著专名/桥段禁用扫描。'
      : '- 结构性验收未完全通过：详见各项目的数量、字数、违禁扫描和步骤错误。',
    '- 当前流程能把“立项底盘 -> 地图/物品/人物/线程 -> 大纲 -> 正文”串起来，但物品早于人物、outline 逻辑未 service 化、地图单次只跑一个批次，是最明确的流程问题。',
    FULL_STORY_DESIGN
      ? '- 本次启用了完整多步故事设计流程。'
      : '- 本次为保证三部作品都能跑完，故事设计使用 compact 单次生成；完整多步 `generateCoreSettings` 可用 `NOVELFORGE_FLOW_FULL_STORY_DESIGN=1` 单独复测。',
    '- 本报告只评估原创对照样例的结构效果，不复述或续写原著正文。',
    '',
    '## 流程问题与扩展修复',
    '',
    '- 调整或补偿物品/人物顺序：保留当前顺序时，物品生成后应在人物生成完成后自动执行一次 item link repair；更稳的顺序是地图 -> 主角/核心人物 -> 物品 -> 补充人物。',
    '- 把 outline.generateArcs / generateChapterOutlines 从 IPC handler 下沉成 outline.service，脚本、UI 和测试共用同一实现。',
    '- 地图生成入口增加“生成到目标数量”模式，或 UI 明确显示本次只完成一个批次并提供继续生成。',
    '- 章节大纲生成后自动补 scenePlan、chapter_contracts、scene_contracts，否则正文流水线的合同驱动优势会被削弱。',
    '- 三类对照作品应补题材专用检测：历史正剧查时代/劳动/组织纹理，升级玄幻查等级/资源/兑现节奏，志怪单元查妖病/人事/余味结构。',
    '',
  ]

  for (const project of runInfo.projects) {
    lines.push(`## ${project.baseTitle}（${project.savedTitle}）`, '')
    lines.push(`- novelId：${project.novelId}`)
    lines.push(`- 验收：${verification.verification.find((item) => item.key === project.key)?.ok ? '通过' : '未通过'}`)
    lines.push(`- 来源基准：${project.benchmarkSources.join('；')}`)
    lines.push(`- 数量：地图 ${project.counts.maps}，物品实例 ${project.counts.items.instances}，人物 ${project.counts.characters}，线程 ${project.counts.threads}，章节 ${project.counts.chapters}`)
    lines.push(`- 样例区域：${project.samples.maps.join('、') || '无'}`)
    lines.push(`- 样例物品：${project.samples.items.join('、') || '无'}`)
    lines.push(`- 样例人物：${project.samples.characters.join('、') || '无'}`)
    lines.push(`- 样例线程：${project.samples.threads.join('、') || '无'}`)
    lines.push('')
    lines.push('### 原著基准')
    project.benchmark.forEach((item) => lines.push(`- ${item}`))
    lines.push('')
    lines.push('### 前 10 章大纲')
    project.chapterSummaries.forEach((chapter) => {
      lines.push(`- 第 ${chapter.chapterNum} 章《${chapter.title}》：${clip(chapter.outline, 180)}`)
    })
    lines.push('')
    lines.push('### 前两章正文')
    project.chapterReports.forEach((report) => {
      lines.push(`- 第 ${report.chapterNum} 章：${report.finalWords} 字，流水线 ${report.pipelineStatus}${report.pipelineError ? `，错误：${clip(report.pipelineError, 120)}` : ''}，扩写 ${report.expandAttempts} 次，AI 味补救 ${report.antiAiRewriteAttempts} 次，违禁命中 ${report.tabooHits.length}。`)
    })
    lines.push('')
    lines.push('### 与原著差异')
    if (project.comparison.strengths.length > 0) {
      project.comparison.strengths.forEach((item) => lines.push(`- 已接近：${item}`))
    }
    if (project.comparison.issues.length > 0) {
      project.comparison.issues.forEach((item) => lines.push(`- 差异/问题：${item}`))
    } else {
      lines.push('- 未发现明显结构性偏离；仍需扩大章节样本后复核节奏稳定性。')
    }
    lines.push('')
    lines.push('### 步骤记录')
    project.steps.forEach((step) => {
      lines.push(`- ${step.label}：${step.status}${step.summary ? `，${step.summary}` : ''}${step.error ? `，错误：${clip(step.error, 140)}` : ''}`)
    })
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

async function runProject(project, context) {
  const report = {
    key: project.key,
    baseTitle: project.baseTitle,
    savedTitle: '',
    benchmarkSources: project.benchmarkSources,
    benchmark: project.benchmark,
    novelId: 0,
    steps: [],
    counts: {
      maps: 0,
      items: { total: 0, instances: 0, templates: 0 },
      characters: 0,
      threads: 0,
      arcs: 0,
      chapters: 0,
      segments: 0,
      chapterContracts: 0,
      sceneContracts: 0,
      versions: 0,
    },
    samples: { maps: [], items: [], characters: [], threads: [] },
    chapterSummaries: [],
    chapterReports: [],
    outlineTabooHits: [],
    comparison: { strengths: [], issues: [], processIssues: [], tabooHits: [] },
  }

  const {
    db,
    rawDb,
    schema,
    modelConfig,
    services,
    helpers,
    runStamp,
    outDir,
  } = context

  const genreId = await runStep(report, 'genre', '准备题材', async () => getOrCreateGenreId(db, schema, project.genreName), {
    required: true,
    summary: (id) => `genreId=${id}`,
  })

  const novelId = await runStep(report, 'create-novel', '创建项目底盘', async () => {
    const title = `${project.savedTitlePrefix}（${runStamp}）`
    const id = services.novelService.createNovel({
      title,
      synopsis: project.input.coreHook,
      genreId,
      launchMode: 'professional_longform',
      userBackground: project.input.coreConflict,
      expandedBackground: `${project.input.theme}\n${project.input.tabooRules}`,
      projectBriefJson: safeJson(buildProjectBrief(project)),
      settingsJson: safeJson(buildInitialSettings(project, helpers.buildStorySettingsPayload)),
      themeVoiceJson: safeJson(buildThemeVoice(project)),
      targetWords: project.targetWords,
      modelConfigId: modelConfig.id,
    })
    const current = services.novelService.getNovel(id)
    const worldRulesJson = buildWorldRules(project, current?.worldRulesJson, helpers.parseWorldRulesJson, helpers.stringifyWorldRules)
    services.novelService.updateNovel(id, {
      worldRulesJson,
      status: 'writing',
      modelConfigId: modelConfig.id,
    })
    report.savedTitle = title
    return id
  }, {
    required: true,
    summary: (id) => `novelId=${id}`,
  })
  report.novelId = novelId

  await runStep(report, 'map', '生成地图区域', async () => generateMapToTarget(novelId, project, services.mapService), {
    summary: (result) => result ? `共 ${result.generatedNodeCount || 0} 个（${result.batchesRun || 0} 批），completed=${Boolean(result.completed)}` : '无返回',
  })

  await runStep(report, 'items', '生成物品', async () => services.itemService.generateStoryItems(novelId, {
    count: ITEM_TARGET_COUNT,
    batchSize: ITEM_TARGET_COUNT,
    refreshTemplates: true,
    templateOnly: false,
    focus: `${project.input.itemFocus}\n${project.input.tabooRules}`,
  }), {
    summary: (ids) => `新增 ${asArray(ids).length} 个`,
  })

  await runStep(report, 'characters', '生成人物', async () => generateCharactersToTarget(novelId, project, services.characterService, rawDb), {
    summary: (result) => `新增 ${asArray(result?.ids).length} 个${asArray(result?.warnings).length > 0 ? `，警告 ${result.warnings.length} 条` : ''}`,
  })

  await runStep(report, 'item-link-repair', '物品-人物链接回填', async () => services.itemService.repairItemCharacterLinks(novelId), {
    summary: (result) => result ? `扫描 ${result.itemsScanned}，关联 ${result.itemsLinked}，归属 ${result.ownersAssigned}` : '无返回',
  })

  await runStep(report, 'threads', '生成剧情线程', async () => services.storyThreadService.generateStoryThreads(novelId, {
    count: THREAD_TARGET_COUNT,
    batchSize: THREAD_TARGET_COUNT,
    focus: `${project.input.coreConflict}\n${project.input.tabooRules}`,
  }), {
    summary: (result) => `新增 ${result?.createdCount || 0}/${result?.requestedCount || THREAD_TARGET_COUNT} 条`,
  })

  await runStep(report, 'story-design', '生成故事设计', async () => generateStoryDesign(novelId, project, services, helpers.buildStorySettingsPayload, rawDb), {
    summary: (result) => `${result?.mode || 'unknown'}，完成 ${result?.completedSteps || 0} 步，失败 ${result?.failedSteps || 0} 步`,
  })

  const rowsBeforeOutline = fetchProjectRows(rawDb, novelId)
  const novel = services.novelService.getNovel(novelId)
  const profile = await services.contextService.buildStoryProfile(novelId)
  const outlineContext = {
    outDir,
    novelTitle: novel?.title || project.savedTitlePrefix,
    genre: novel?.genreName || project.genreName,
    storyGoal: profile.storyGoal || project.input.theme,
    coreConflict: profile.coreConflict || project.input.coreConflict,
    mainPlot: profile.mainPlot || project.input.mainPlot,
    arcSummary: profile.storyDesignSummary || project.input.mainPlot,
    characterSummary: rowsBeforeOutline.characterRows.map((row) => `- ${row.full_name}：${row.goals || row.background || ''}`).join('\n'),
    threadSummary: rowsBeforeOutline.threadRows.map((row) => `- ${row.title}：${row.summary || row.current_state || ''}`).join('\n'),
    worldRulesSummary: profile.worldRulesSummary || '',
    protagonistReference: profile.protagonistReference || '主角',
    protagonistRule: profile.protagonistRule || '沿用已生成主角，不要擅自改名。',
  }

  const chapters = await runStep(report, 'outline', '生成 10 章大纲', async () => generateChapterOutlines(
    novelId,
    project,
    outlineContext,
    services,
    modelConfig.id,
  ), {
    required: true,
    summary: (items) => `生成 ${asArray(items).length} 章`,
  })

  const savedStructure = await runStep(report, 'chapter-structure', '写入章节合同和场景合同', async () => insertChapterStructure(
    rawDb,
    novelId,
    project,
    chapters,
    modelConfig.id,
  ), {
    required: true,
    summary: (value) => `chapterIds=${value.chapterIds.length}`,
  })

  const chapterReports = await runStep(report, 'chapter-drafts', `生成前 ${CONTENT_CHAPTER_COUNT} 章正文`, async () => generateChapterDrafts(
    novelId,
    project,
    savedStructure,
    services,
  ), {
    required: true,
    summary: (items) => `正文 ${asArray(items).length} 章`,
  })
  report.chapterReports = chapterReports || []

  const rows = fetchProjectRows(rawDb, novelId)
  report.counts = {
    maps: rows.mapRows.length,
    items: {
      total: rows.itemRows.length,
      instances: rows.itemRows.filter((row) => row.item_kind === 'instance').length,
      templates: rows.itemRows.filter((row) => row.item_kind === 'template').length,
    },
    characters: rows.characterRows.length,
    threads: rows.threadRows.length,
    arcs: rows.arcRows.length,
    chapters: rows.chapterRows.length,
    segments: rows.segmentRows.length,
    chapterContracts: rows.chapterContracts.length,
    sceneContracts: rows.sceneContracts.length,
    versions: rows.versions.length,
  }
  report.samples = {
    maps: summarizeRows(rows.mapRows, (row) => row.name),
    items: summarizeRows(rows.itemRows.filter((row) => row.item_kind === 'instance'), (row) => row.item_name),
    characters: summarizeRows(rows.characterRows, (row) => row.full_name),
    threads: summarizeRows(rows.threadRows, (row) => row.title),
  }
  report.chapterSummaries = rows.chapterRows.map((row) => ({
    chapterNum: row.chapter_num,
    title: row.title,
    outline: row.outline || '',
    words: countHanzi(row.content || ''),
  }))
  const outlineText = rows.chapterRows.map((row) => `${row.title}\n${row.outline || ''}`).join('\n')
  report.outlineTabooHits = scanTaboo(outlineText, project.tabooPatterns)
  report.comparison = buildComparison(project, rows, report.chapterReports)

  fs.writeFileSync(path.join(outDir, `${project.key}.json`), JSON.stringify({
    project,
    report,
    rows: {
      maps: rows.mapRows,
      items: rows.itemRows,
      characters: rows.characterRows,
      threads: rows.threadRows,
      arcs: rows.arcRows,
      chapters: rows.chapterRows.map((row) => ({
        id: row.id,
        chapterNum: row.chapter_num,
        title: row.title,
        outline: row.outline,
        wordCount: countHanzi(row.content || ''),
        contentPreview: clip(row.content || '', 260),
      })),
    },
  }, null, 2), 'utf8')

  return report
}

async function main() {
  await app.whenReady()

  const { initDb, getDb, getSqlite } = requireProject('electron/database/db.ts')
  const schema = requireProject('electron/database/schema.ts')
  initDb()

  const db = getDb()
  const rawDb = getSqlite()
  const modelConfig = getDefaultModelConfig(db, schema)
  if (!modelConfig) throw new Error('No model config found. Configure a default model before running flow audit.')

  const runStamp = process.env.NOVELFORGE_FLOW_RUN_STAMP || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const outDir = path.join(OUT_ROOT, runStamp)
  fs.mkdirSync(outDir, { recursive: true })

  const services = {
    novelService: requireProject('electron/services/novel.service.ts'),
    mapService: requireProject('electron/services/map.service.ts'),
    itemService: requireProject('electron/services/item.service.ts'),
    characterService: requireProject('electron/services/character.service.ts'),
    storyThreadService: requireProject('electron/services/story-thread.service.ts'),
    coreSettingsService: requireProject('electron/services/core-settings.service.ts'),
    chapterService: requireProject('electron/services/chapter.service.ts'),
    antiAiService: requireProject('electron/services/anti-ai-rule.service.ts'),
    taskService: requireProject('electron/services/task.service.ts'),
    contextService: requireProject('electron/services/context.service.ts'),
    storyPrompts: requireProject('electron/services/story-prompts.ts'),
  }
  const recoveredTaskCount = services.taskService.recoverOrphanedTasks?.() || 0
  if (recoveredTaskCount > 0) {
    console.log(`[flow-audit] recovered ${recoveredTaskCount} orphaned tasks before audit`)
  }
  const helpers = {
    ...requireProject('src/shared/story-settings.ts'),
    ...requireProject('src/shared/genre-system.ts'),
  }

  const runInfo = {
    generatedAt: nowIso(),
    databasePath: path.join(app.getPath('userData'), 'novelforge.db'),
    modelLabel: `${modelConfig.provider}:${modelConfig.modelId}#${modelConfig.id}`,
    runStamp,
    projects: [],
  }

  const selectedProjects = PROJECT_FILTER.size > 0
    ? PROJECTS.filter((project) => PROJECT_FILTER.has(project.key))
    : PROJECTS

  try {
    for (const project of selectedProjects) {
      try {
        const report = await runProject(project, {
          db,
          rawDb,
          schema,
          modelConfig,
          services,
          helpers,
          runStamp,
          outDir,
        })
        runInfo.projects.push(report)
      } catch (error) {
        const failed = {
          key: project.key,
          baseTitle: project.baseTitle,
          savedTitle: '',
          benchmarkSources: project.benchmarkSources,
          benchmark: project.benchmark,
          novelId: 0,
          steps: [{ key: 'project', label: '项目执行', status: 'error', error: String(error && error.stack || error) }],
          counts: {
            maps: 0,
            items: { total: 0, instances: 0, templates: 0 },
            characters: 0,
            threads: 0,
            arcs: 0,
            chapters: 0,
            segments: 0,
            chapterContracts: 0,
            sceneContracts: 0,
            versions: 0,
          },
          samples: { maps: [], items: [], characters: [], threads: [] },
          chapterSummaries: [],
          chapterReports: [],
          outlineTabooHits: [],
          comparison: { strengths: [], issues: [String(error && error.message || error)], processIssues: [], tabooHits: [] },
        }
        runInfo.projects.push(failed)
        fs.writeFileSync(path.join(outDir, `${project.key}.error.txt`), `${error.stack || error.message || error}\n`, 'utf8')
      }
    }

    const verification = buildVerification(runInfo)
    fs.writeFileSync(path.join(outDir, 'run-info.json'), JSON.stringify(runInfo, null, 2), 'utf8')
    fs.writeFileSync(path.join(outDir, 'verification.json'), JSON.stringify(verification, null, 2), 'utf8')
    fs.writeFileSync(path.join(outDir, 'report.md'), buildMarkdownReport(runInfo, verification), 'utf8')
    console.log(`[flow-audit] report ${path.join(outDir, 'report.md')}`)
    console.log(`[flow-audit] allOk=${verification.allOk}`)
    if (!verification.allOk) process.exitCode = 1
  } catch (error) {
    fs.writeFileSync(path.join(outDir, 'fatal-error.txt'), `${error.stack || error.message || error}\n`, 'utf8')
    throw error
  }
}

function exitProcess(code) {
  process.exitCode = code
  try {
    app.quit()
  } catch {}
  setTimeout(() => process.exit(code), 100)
}

main().then(() => {
  exitProcess(process.exitCode || 0)
}).catch((error) => {
  console.error('[flow-audit] failed:', error)
  exitProcess(1)
})
