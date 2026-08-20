const { _electron: electron } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const SAMPLE_TITLE = '神账局：我给万神讨薪'
const PREPARE_DENSITY = process.argv.includes('--prepare') || process.env.NOVELFORGE_UI_ACCEPTANCE_PREPARE === '1'
const REQUESTED_NOVEL_ID = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 0) || null
const MINIMUM_DENSITY = { volumes: 5, chapters: 120, characters: 20, timelineEvents: 30, foreshadowRevisionItems: 50 }

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]

const GLOBAL_ROUTES = [
  ['novels', '/novels', '我的小说', 'src/pages/NovelList/index.tsx', '项目目录', '选择、创建和进入小说项目'],
  ['models', '/models', '模型与搜索管理', 'src/pages/ModelManager/index.tsx', '配置控制台', '配置模型、搜索源并验证可用性'],
  ['templates', '/templates', '文风与世界模板', 'src/pages/TemplateManager/index.tsx', '资源目录', '维护可复用文风与世界模板'],
  ['prompts', '/prompts', '提示词控制台', 'src/pages/PromptManager/index.tsx', '运行时控制台', '检索、审阅和编辑运行时提示词'],
  ['tasks', '/tasks', '任务中心', 'src/pages/TaskCenter/index.tsx', '任务队列', '追踪、诊断和恢复 AI 任务'],
]

const PROJECT_ROUTES = [
  ['guide', '创作总控台', 'src/pages/Novel/Studio/index.tsx', '控制台', '查看项目状态并选择下一步'],
  ['overview', '项目总览', 'src/pages/Novel/Overview/index.tsx', '概览表单', '维护书名、简介、背景和目标'],
  ['project-brief', '项目简报', 'src/pages/Novel/ProjectBrief/index.tsx', '聚焦表单', '固化读者承诺、卖点与禁区'],
  ['core-settings', '故事底盘', 'src/pages/Novel/Premise/index.tsx', '设定表单', '维护主角起点、核心钩子与约束'],
  ['theme-voice', '主题文风', 'src/pages/Novel/ThemeVoice/index.tsx', '设定表单', '约束主题、情绪、视角与对白'],
  ['style-lab', '文风实验室', 'src/pages/Novel/StyleLab/index.tsx', '对照实验', '比较风格指纹与试写结果'],
  ['world-rules', '世界规则', 'src/pages/Novel/WorldRules/index.tsx', '规则工作台', '维护世界制度、能力边界和口径'],
  ['map', '地点场景', 'src/pages/Novel/MapExplorer/index.tsx', '树图工作台', '管理地点层级、关系和事件锚点'],
  ['items', '物品线索', 'src/pages/Novel/ItemsWorkspace/index.tsx', '资产目录', '管理道具、资源流通与证据'],
  ['glossary', '设定词典', 'src/pages/Novel/Glossary/index.tsx', '术语目录', '统一名词、术语和标准口径'],
  ['scene-templates', '场景模板', 'src/pages/Novel/SceneTemplates/index.tsx', '模板目录', '维护可复用场景结构和检查项'],
  ['characters', '人物档案', 'src/pages/Novel/Characters/index.tsx', '人物目录', '管理人物档案、功能位和关系'],
  ['arc-center', '人物弧线', 'src/pages/Novel/CharacterArcCenter/index.tsx', '弧线工作台', '管理人物变化、关系位移和代价'],
  ['resistance', '阻力系统', 'src/pages/Novel/Resistance/index.tsx', '压力工作台', '编排对手、环境、制度和关系压力'],
  ['factions', '阵营组织', 'src/pages/Novel/Factions/index.tsx', '组织图谱', '管理组织、阵营和对立结构'],
  ['story-design', '主线骨架', 'src/pages/Novel/CoreSettings/index.tsx', '剧情表单', '固化主线目标、冲突和结局方向'],
  ['threads', '剧情线程', 'src/pages/Novel/StoryThreads/index.tsx', '线程看板', '追踪主线、支线、伏笔和关系推进'],
  ['endgame', '终局承诺', 'src/pages/Novel/Endgame/index.tsx', '承诺清单', '管理最终冲突、兑现项和最后一幕'],
  ['info-gap-board', '信息差', 'src/pages/Novel/InfoGapBoard/index.tsx', '信息看板', '控制真相揭示、读者信息差和谜题'],
  ['foreshadow-ledger', '伏笔账本', 'src/pages/Novel/ForeshadowLedger/index.tsx', '账本', '追踪伏笔埋设、到期与回收'],
  ['growth-system', '成长/代价', 'src/pages/Novel/GrowthSystem/index.tsx', '曲线工作台', '维护能力成长和资源消耗曲线'],
  ['volume-design', '卷级设计', 'src/pages/Novel/VolumeDesign/index.tsx', '卷级表单', '规划每卷目标、爆点和阶段代价'],
  ['stage-planner', '阶段计划', 'src/pages/Novel/StagePlanner/index.tsx', '阶段规划器', '按章节窗口增量扩展故事资产'],
  ['outline', '故事大纲', 'src/pages/Novel/Outline/index.tsx', '大纲树', '编排故事弧、章节承接和推进骨架'],
  ['structure', '卷章结构', 'src/pages/Novel/Structure/index.tsx', '结构树', '拆分卷、部、章和场景节奏'],
  ['timeline', '事件时间轴', 'src/pages/Novel/Timeline/index.tsx', '时间轴', '校验事件先后、因果锚点和状态变化'],
  ['contracts', '章节合同', 'src/pages/Novel/Contracts/index.tsx', '合同工作台', '定义章节目标、场景合同和验收标准'],
  ['writing', '正文写作', 'src/pages/Novel/Writing/index.tsx', '生产台', '选择章节、生成、编辑和审阅正文'],
  ['writeback', '章后回写', 'src/pages/Novel/Writeback/index.tsx', '回写工作台', '确认事实抽取、状态回写和正典变更'],
  ['batch-workbench', '批次回滚', 'src/pages/Novel/BatchWorkbench/index.tsx', '恢复工作台', '恢复、重放和回滚失败流水线'],
  ['revision', '修订中心', 'src/pages/Novel/RevisionCenter/index.tsx', '问题队列', '筛选、处理和关闭修订任务'],
  ['quality', '质量监控', 'src/pages/Novel/QualityDashboard/index.tsx', '质量仪表盘', '监控生产就绪度、连续性和风险趋势'],
]

const ROUTES = [
  ...GLOBAL_ROUTES.map(([key, routePath, label, entry, prototype, mainTask]) => buildRoute({ key, path: routePath, label, entry, prototype, mainTask, project: false })),
  ...PROJECT_ROUTES.map(([key, label, entry, prototype, mainTask]) => buildRoute({ key, path: `/novels/{id}/${key === 'writing' ? 'writing/editor' : key}`, label, entry, prototype, mainTask, project: true })),
]

function buildRoute(route) {
  const destructive = ['novels', 'templates', 'characters', 'items', 'factions', 'structure', 'timeline', 'revision'].includes(route.key)
  const unsaved = ['models', 'prompts', 'overview', 'project-brief', 'core-settings', 'theme-voice', 'world-rules', 'story-design', 'writing'].includes(route.key)
  return {
    ...route,
    layers: {
      L0: route.project ? '项目工作区与全局导航' : '应用外壳与全局导航',
      L1: `${route.label}：${route.mainTask}`,
      L2: `${route.prototype}的状态、数据与主要动作`,
      L3: '筛选、编辑、详情、校验与操作反馈',
    },
    duplicates: route.project
      ? '与项目顶栏、侧栏及页面自建标题可能重复；迁移时保留单一业务信息源。'
      : '与全局外壳及页面 Hero 可能重复；不得复制标题、说明或指标。',
    risk: `${destructive ? '存在删除或批量变更动作，必须保留确认与影响范围。' : '无主要删除动作，但仍需验证状态反馈。'}${unsaved ? ' 表单存在未保存离开风险。' : ' 未保存风险以页面实际控件为准。'}`,
  }
}

function safeField(value) {
  return String(value ?? '').replace(/\|/g, '／').replace(/[\r\n]+/g, ' ').trim()
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function verifyRouteInventorySources() {
  const appSource = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf8')
  const workspaceSource = fs.readFileSync(path.join(REPO_ROOT, 'src/shared/novel-workspace.ts'), 'utf8')
  const missingGlobals = GLOBAL_ROUTES.filter(([, routePath]) => !appSource.includes(`path=\"${routePath}`)).map(([key]) => key)
  const definitionBlock = workspaceSource.split('export const WORKSPACE_MODULE_DEFINITIONS')[1]?.split('const GROUP_ROUTE_MAP')[0] || ''
  const sourceKeys = [...definitionBlock.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((match) => match[1])
  const expectedProjectKeys = PROJECT_ROUTES.filter(([key]) => key !== 'guide').map(([key]) => key)
  const missingProjectKeys = expectedProjectKeys.filter((key) => !sourceKeys.includes(key))
  const extraProjectKeys = sourceKeys.filter((key) => !expectedProjectKeys.includes(key))
  if (ROUTES.length !== 37 || missingGlobals.length || missingProjectKeys.length || extraProjectKeys.length) {
    throw new Error(`路由清单与源码不一致：count=${ROUTES.length}, missingGlobals=${missingGlobals.join(',')}, missingProject=${missingProjectKeys.join(',')}, extraProject=${extraProjectKeys.join(',')}`)
  }
  return {
    total: ROUTES.length,
    globalSource: 'src/App.tsx',
    projectSource: 'src/shared/novel-workspace.ts#ALL_WORKSPACE_ROUTE_KEYS',
    verifiedAt: new Date().toISOString(),
  }
}

async function readProjectDensity(page, novelId) {
  return page.evaluate(async (id) => {
    const [volumes, chapters, characters, timelineEvents, foreshadows, revisions] = await Promise.all([
      window.electron.structure.listVolumes(id),
      window.electron.chapter.list(id),
      window.electron.character.list(id),
      window.electron.timeline.list(id),
      window.electron.foreshadow.listLedger(id),
      window.electron.revision.list(id),
    ])
    return {
      volumes: volumes.length,
      chapters: chapters.length,
      characters: characters.length,
      timelineEvents: timelineEvents.length,
      foreshadows: foreshadows.length,
      revisions: revisions.length,
      foreshadowRevisionItems: foreshadows.length + revisions.length,
    }
  }, novelId)
}

function densityMeetsMinimum(density) {
  return Object.entries(MINIMUM_DENSITY).every(([key, minimum]) => Number(density[key]) >= minimum)
}

async function chooseProject(page) {
  const novels = await page.evaluate(() => window.electron.novel.list())
  if (!Array.isArray(novels) || novels.length === 0) throw new Error('Electron 数据库中没有可用项目。')
  if (REQUESTED_NOVEL_ID) {
    const requested = novels.find((item) => Number(item.id) === REQUESTED_NOVEL_ID)
    if (!requested) throw new Error(`指定项目 ${REQUESTED_NOVEL_ID} 不存在。`)
    return requested
  }
  const samples = novels.filter((item) => item.title === SAMPLE_TITLE).sort((a, b) => Number(b.id) - Number(a.id))
  if (samples[0]) return samples[0]
  for (const novel of [...novels].sort((a, b) => Number(b.id) - Number(a.id))) {
    if (densityMeetsMinimum(await readProjectDensity(page, novel.id))) return novel
  }
  throw new Error(`没有满足 P0-00 密度的项目，也没有找到可准备的样例项目「${SAMPLE_TITLE}」。`)
}

async function prepareSampleDensity(page, project) {
  if (!PREPARE_DENSITY) {
    return { volumes: 0, chapters: 0, characters: 0, timelineEvents: 0, foreshadows: 0, revisions: 0 }
  }
  if (project.title !== SAMPLE_TITLE) throw new Error('数据准备仅允许写入明确命名的非生产样例项目。')
  return page.evaluate(async ({ id, minimums }) => {
    const created = { volumes: 0, chapters: 0, characters: 0, timelineEvents: 0, foreshadows: 0, revisions: 0 }
    let volumes = await window.electron.structure.listVolumes(id)
    for (let index = volumes.length; index < minimums.volumes; index += 1) {
      await window.electron.structure.createVolume(id, {
        volumeNumber: index + 1,
        title: `P0验收卷${index + 1}`,
        summary: 'P0-00 非生产验收密度样本。',
        targetWords: 100000,
        status: 'planning',
      })
      created.volumes += 1
    }
    volumes = await window.electron.structure.listVolumes(id)

    let chapters = await window.electron.chapter.list(id)
    let nextChapterNum = Math.max(0, ...chapters.map((item) => Number(item.chapterNum) || 0)) + 1
    while (chapters.length + created.chapters < minimums.chapters) {
      const offset = created.chapters
      const volume = volumes[offset % volumes.length]
      await window.electron.chapter.create(id, {
        chapterNum: nextChapterNum,
        volumeId: volume?.id,
        title: `P0验收章节${nextChapterNum}`,
        outline: '用于验证长篇项目列表、滚动和信息密度，不作为正式正文。',
        status: 'outline',
        targetWords: 2500,
      })
      nextChapterNum += 1
      created.chapters += 1
    }

    const characters = await window.electron.character.list(id)
    while (characters.length + created.characters < minimums.characters) {
      const seq = characters.length + created.characters + 1
      await window.electron.character.create(id, {
        fullName: `验收角色${String(seq).padStart(2, '0')}`,
        roleType: 'supporting',
        recordStatus: 'draft',
        background: 'P0-00 非生产验收人物样本。',
        goals: '验证人物目录在真实数据密度下的可用性。',
        sortOrder: seq,
      })
      created.characters += 1
    }

    const timeline = await window.electron.timeline.list(id)
    while (timeline.length + created.timelineEvents < minimums.timelineEvents) {
      const seq = timeline.length + created.timelineEvents + 1
      await window.electron.timeline.create(id, {
        eventTitle: `验收事件${String(seq).padStart(2, '0')}`,
        eventSummary: 'P0-00 非生产验收时间轴样本。',
        timeMode: 'relative',
        timeLabel: `第${seq}阶段`,
        timeSortValue: seq,
        sortOrder: seq,
        isMajorEvent: seq % 5 === 0 ? 1 : 0,
        protagonistPresent: 0,
        status: 'planned',
      })
      created.timelineEvents += 1
    }

    let foreshadows = await window.electron.foreshadow.listLedger(id)
    let revisions = await window.electron.revision.list(id)
    while (foreshadows.length + revisions.length < minimums.foreshadowRevisionItems) {
      const seq = foreshadows.length + 1
      foreshadows = await window.electron.foreshadow.upsertLedger(id, {
        title: `验收伏笔${String(seq).padStart(2, '0')}`,
        detail: 'P0-00 非生产验收伏笔样本。',
        plantMethod: '背景细节',
        salienceLevel: 'medium',
        targetPayoffChapter: Math.min(minimums.chapters, Math.max(2, seq * 2)),
        payoffMethod: '情节兑现',
        impactScope: 'volume',
        status: 'active',
      })
      created.foreshadows += 1
      revisions = await window.electron.revision.list(id)
    }
    return created
  }, { id: project.id, minimums: MINIMUM_DENSITY })
}

async function setViewport(app, page, viewport) {
  await page.setViewportSize(viewport)
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setContentSize(size.width, size.height)
  }, viewport)
  await page.waitForTimeout(250)
}

async function navigateAndMeasure(page, route, projectId, viewport, screenshotsDir) {
  const routePath = route.path.replace('{id}', String(projectId))
  const expectedHash = `#${routePath}`
  await page.evaluate(({ hash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = hash
  }, { hash: expectedHash, storageKey: VIEW_MODE_STORAGE_KEY })

  const deadline = Date.now() + 10000
  let state
  do {
    await page.waitForTimeout(300)
    state = await page.evaluate(({ expected, label, project, storageKey }) => {
      const errorCard = document.querySelector('.novel-route-shell__error-card')
      const workspaceLabel = document.querySelector('.project-topbar__workspace-name')?.textContent?.trim() || ''
      const activeMode = document.querySelector('.project-topbar__mode-button[aria-selected="true"]')?.textContent?.trim() || ''
      const bodyText = document.body?.innerText || ''
      const resolvedHash = window.location.hash
      const resolvedPath = resolvedHash.split('?')[0]
      const hashMatches = resolvedPath === expected
      const labelMatches = project ? workspaceLabel === label : bodyText.includes(label)
      return {
        ready: Boolean(errorCard) || !hashMatches || labelMatches,
        resolvedHash,
        workspaceLabel,
        activeMode,
        storedMode: localStorage.getItem(storageKey),
        errorText: errorCard?.textContent?.replace(/\s+/g, ' ').trim() || '',
      }
    }, { expected: expectedHash, label: route.label, project: route.project, storageKey: VIEW_MODE_STORAGE_KEY })
  } while (!state.ready && Date.now() < deadline)

  const metrics = await page.evaluate(({ expected, label, project, storageKey }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector('.novel-workspace, .workspace-page, main')
    const header = document.querySelector('.project-topbar, .novel-route-shell__header, .workspace-page__hero, .novel-list-page__header')
    const errorCard = document.querySelector('.novel-route-shell__error-card')
    const workspaceLabel = document.querySelector('.project-topbar__workspace-name')?.textContent?.trim() || ''
    const activeMode = document.querySelector('.project-topbar__mode-button[aria-selected="true"]')?.textContent?.trim() || ''
    const bodyText = body?.innerText || ''
    const resolvedHash = window.location.hash
    const resolvedPath = resolvedHash.split('?')[0]
    const reasons = []
    if (resolvedPath !== expected) reasons.push(`路由重定向到 ${resolvedHash}`)
    if (project && workspaceLabel !== label) reasons.push(`页面标签为「${workspaceLabel || '空'}」而非「${label}」`)
    if (!project && !bodyText.includes(label)) reasons.push(`页面正文未出现「${label}」`)
    if (project && (localStorage.getItem(storageKey) !== 'professional' || activeMode !== '完整')) reasons.push(`工作模式不是完整模式（storage=${localStorage.getItem(storageKey)}, active=${activeMode || '空'}）`)
    if (errorCard) reasons.push(errorCard.textContent?.replace(/\s+/g, ' ').trim() || '页面错误边界已触发')
    return {
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth || 0),
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
      businessHeaderHeight: header?.getBoundingClientRect().height || 0,
      visibleActionCount: [...document.querySelectorAll('button, [role="button"], a')].filter((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }).length,
      expectedHash: expected,
      resolvedHash,
      workspaceLabel,
      storedMode: localStorage.getItem(storageKey),
      activeMode,
      errorText: errorCard?.textContent?.replace(/\s+/g, ' ').trim() || '',
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
    }
  }, { expected: expectedHash, label: route.label, project: route.project, storageKey: VIEW_MODE_STORAGE_KEY })

  const fileName = `${route.key}-${viewport.width}x${viewport.height}.png`
  await page.screenshot({ path: path.join(screenshotsDir, fileName), fullPage: false })
  return { ...metrics, fileName }
}

function buildBaseline({ runId, project, density, created, inventory, results }) {
  const prepared = {
    volumes: Number(created?.volumes || 0),
    chapters: Number(created?.chapters || 0),
    characters: Number(created?.characters || 0),
    timelineEvents: Number(created?.timelineEvents || 0),
    foreshadows: Number(created?.foreshadows || 0),
    revisions: Number(created?.revisions || 0),
  }
  const statuses = ROUTES.map((route) => {
    const measurements = Object.values(results[route.key] || {})
    return { route, status: measurements.every((item) => item.status === 'PASS') ? 'PASS' : 'BLOCKED', reasons: [...new Set(measurements.flatMap((item) => item.reasons || []))] }
  })
  const passCount = statuses.filter((item) => item.status === 'PASS').length
  const lines = [
    '# P0-00 Electron 真实项目 UI 基线',
    '',
    `- 运行编号：\`${runId}\``,
    `- 真实项目：\`${safeField(project.title)}\`（ID ${project.id}）`,
    `- 数据密度：${density.volumes} 卷 / ${density.chapters} 章 / ${density.characters} 人物 / ${density.timelineEvents} 事件 / ${density.foreshadows} 伏笔 + ${density.revisions} 修订 = ${density.foreshadowRevisionItems} 项`,
    `- 本次准备新增：${prepared.volumes} 卷 / ${prepared.chapters} 章 / ${prepared.characters} 人物 / ${prepared.timelineEvents} 事件 / ${prepared.foreshadows} 伏笔 / ${prepared.revisions} 修订`,
    `- 路由来源：\`${inventory.globalSource}\` 与 \`${inventory.projectSource}\`；共 ${inventory.total} 页`,
    `- 结果：${passCount} PASS / ${statuses.length - passCount} BLOCKED。BLOCKED 表示该页不能作为布局已通过证据。`,
    '- 模式约束：全部项目页必须命中目标 hash、显示目标工作区名，且活动模式为「完整」。',
    '- 证据说明：截图和原始 JSON 位于本次 `runs` 目录；顶层文件仅指向最近一次运行。',
    '',
    '| 路由 | 入口文件 | 原型 | 主任务 | L0 | L1 | L2 | L3 | 重复项 | 危险/未保存风险 | 1440×900 | 1280×800 | 1024×768 | 900×760 | 结果 | 证据 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of statuses) {
    const route = item.route
    const sizes = VIEWPORTS.map(({ width, height }) => {
      const metric = results[route.key]?.[`${width}x${height}`]
      if (!metric) return '缺失'
      return `${metric.clientWidth}/${metric.scrollWidth}; H${Math.round(metric.pageHeight)}; B${Math.round(metric.businessHeaderHeight)}; A${metric.visibleActionCount}; ${metric.status}`
    })
    const routePath = route.path.replace('{id}', String(project.id))
    const statusText = item.status === 'PASS' ? 'PASS' : `BLOCKED：${item.reasons.join('；')}`
    const screenshot = `runs/${runId}/screenshots/${route.key}-1440x900.png`
    lines.push(`| \`${safeField(routePath)}\` | \`${safeField(route.entry)}\` | ${safeField(route.prototype)} | ${safeField(route.mainTask)} | ${safeField(route.layers.L0)} | ${safeField(route.layers.L1)} | ${safeField(route.layers.L2)} | ${safeField(route.layers.L3)} | ${safeField(route.duplicates)} | ${safeField(route.risk)} | ${sizes.map(safeField).join(' | ')} | ${safeField(statusText)} | [截图](${screenshot}) |`)
  }
  lines.push('', '几何格式：`clientWidth/scrollWidth; H页面高度; B业务信息栏高度; A可见动作数; 状态`。', '')
  return lines.join('\n')
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function regenerateLatestBaseline() {
  const latestPath = path.join(EVIDENCE_ROOT, 'latest-run.json')
  if (!fs.existsSync(latestPath)) throw new Error('latest-run.json 不存在，请先运行采集。')
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'))
  const runDir = path.join(EVIDENCE_ROOT, 'runs', latest.runId)
  const results = JSON.parse(fs.readFileSync(path.join(runDir, 'metrics.json'), 'utf8'))
  const density = JSON.parse(fs.readFileSync(path.join(runDir, 'project-density.json'), 'utf8'))
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'capture-summary.json'), 'utf8'))
  const inventory = JSON.parse(fs.readFileSync(path.join(runDir, 'route-inventory.json'), 'utf8'))
  const baseline = buildBaseline({ runId: latest.runId, project: summary.project, density, created: summary.created, inventory, results })
  fs.writeFileSync(path.join(EVIDENCE_ROOT, 'baseline.md'), baseline, 'utf8')
  fs.writeFileSync(path.join(runDir, 'baseline.md'), baseline, 'utf8')
  return path.join(EVIDENCE_ROOT, 'baseline.md')
}

async function main() {
  const runId = timestampId()
  const runDir = path.join(EVIDENCE_ROOT, 'runs', runId)
  const screenshotsDir = path.join(runDir, 'screenshots')
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const inventory = verifyRouteInventorySources()
  writeJson(path.join(runDir, 'route-inventory.json'), inventory)
  fs.writeFileSync(path.join(runDir, 'git-status.txt'), execFileSync('git', ['status', '--short'], { cwd: REPO_ROOT, encoding: 'utf8' }), 'utf8')

  let app
  try {
    console.log(`[P0-00] 启动 Electron，run=${runId}`)
    const electronPath = require('electron')
    app = await electron.launch({
      executablePath: electronPath,
      args: [path.join(REPO_ROOT, 'out/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RENDERER_URL: `file://${path.join(REPO_ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}`,
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)
    await page.evaluate((storageKey) => {
      localStorage.setItem(storageKey, 'professional')
      window.location.hash = '#/novels'
    }, VIEW_MODE_STORAGE_KEY)
    await page.waitForTimeout(1200)

    const project = await chooseProject(page)
    console.log(`[P0-00] 项目 ${project.id}：${project.title}`)
    const created = await prepareSampleDensity(page, project)
    const density = await readProjectDensity(page, project.id)
    writeJson(path.join(runDir, 'project-density.json'), density)
    if (!densityMeetsMinimum(density)) {
      throw new Error(`项目密度不足：${JSON.stringify(density)}。若为指定非生产样例，可设置 NOVELFORGE_UI_ACCEPTANCE_PREPARE=1。`)
    }

    const results = {}
    for (const viewport of VIEWPORTS) {
      console.log(`[P0-00] 视口 ${viewport.width}x${viewport.height}`)
      await setViewport(app, page, viewport)
      for (const route of ROUTES) {
        const metric = await navigateAndMeasure(page, route, project.id, viewport, screenshotsDir)
        if (!results[route.key]) results[route.key] = {}
        results[route.key][`${viewport.width}x${viewport.height}`] = metric
        console.log(`  ${metric.status.padEnd(7)} ${route.key}${metric.reasons.length ? ` - ${metric.reasons.join('; ')}` : ''}`)
      }
    }

    const blockedRoutes = ROUTES.filter((route) => Object.values(results[route.key]).some((item) => item.status !== 'PASS')).map((route) => route.key)
    const summary = {
      runId,
      capturedAt: new Date().toISOString(),
      project: { id: project.id, title: project.title },
      created,
      densityMinimums: MINIMUM_DENSITY,
      densitySatisfied: true,
      routeCount: ROUTES.length,
      viewportCount: VIEWPORTS.length,
      measurementCount: ROUTES.length * VIEWPORTS.length,
      passRouteCount: ROUTES.length - blockedRoutes.length,
      blockedRouteCount: blockedRoutes.length,
      blockedRoutes,
      mode: 'professional',
      runtime: 'Electron production build',
      scopeException: '证据基于当前工作树的 Electron production build；除 --prepare 只允许通过 Electron bridge 补齐明确命名的非生产样例外，不写入其他项目，不改数据库 schema 或 IPC 合同。',
    }
    writeJson(path.join(runDir, 'metrics.json'), results)
    writeJson(path.join(runDir, 'capture-summary.json'), summary)
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, runDirectory: `runs/${runId}`, capturedAt: summary.capturedAt })
    writeJson(path.join(EVIDENCE_ROOT, 'route-inventory.json'), inventory)
    writeJson(path.join(EVIDENCE_ROOT, 'project-density.json'), density)
    writeJson(path.join(EVIDENCE_ROOT, 'metrics.json'), results)
    writeJson(path.join(EVIDENCE_ROOT, 'capture-summary.json'), summary)
    regenerateLatestBaseline()
    console.log(`[P0-00] 完成：${summary.passRouteCount} PASS / ${summary.blockedRouteCount} BLOCKED`)
    if (summary.blockedRouteCount > 0) {
      throw new Error(`P0-00 验收存在 ${summary.blockedRouteCount} 个 BLOCKED 路由：${summary.blockedRoutes.join(', ')}`)
    }
  } finally {
    if (app) await app.close().catch(() => undefined)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[P0-00] FAILED', error)
    process.exitCode = 1
  })
}

module.exports = { ROUTES, VIEWPORTS, MINIMUM_DENSITY, buildBaseline, regenerateLatestBaseline, verifyRouteInventorySources }
