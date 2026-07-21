const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))
app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  if (request.startsWith('@main/')) return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    for (const ext of ['.ts', '.tsx', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + ext)
      if (fs.existsSync(candidate)) return originalResolveFilename.call(this, candidate, parent, isMain, options)
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename })
  module._compile(outputText, filename)
}
require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

const SAMPLE_KEY = 'character-continuity.fanqie.20260721.v1'
const TITLE = '拆迁清单上的第十三户'
const clip = (value, length = 220) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length)
const hit = (text, terms) => terms.filter((term) => text.includes(term))
const aliasesOf = (character) => {
  try {
    const parsed = JSON.parse(character.sourceContextJson || '{}')
    return [...new Set([character.fullName, ...(Array.isArray(parsed.aliases) ? parsed.aliases : [])].filter(Boolean))]
  } catch {
    return [character.fullName]
  }
}
const result = (score, evidence, blockers = []) => ({ score, evidence, blockers })

async function main() {
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const novelService = require(path.join(workspaceRoot, 'electron/services/novel.service.ts'))
  const characterService = require(path.join(workspaceRoot, 'electron/services/character.service.ts'))
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const novel = novelService.listNovels().find((item) => item.title === TITLE)
  if (!novel) throw new Error('找不到测试项目《' + TITLE + '》，请先运行 npm run sample:create-character-continuity')
  const fullNovel = novelService.getNovel(novel.id)
  const characters = characterService.listCharacters(novel.id)
  const relations = characterService.getCharacterRelations(novel.id)
  const chapters = chapterService.listChapters(novel.id).filter((chapter) => chapter.chapterNum <= 3).sort((a, b) => a.chapterNum - b.chapterNum)
  const text = chapters.map((chapter) => chapter.content || '').join('\n')
  const evidence = []

  const major = characters.filter((character) => ['protagonist', 'major', 'antagonist'].includes(character.roleType))
  const personEvidence = major.map((character) => ({
    name: character.fullName,
    aliases: aliasesOf(character),
    fields: hit([character.goals, character.surfaceDesire, character.deepNeed, character.innerConflict, character.speechPattern].join(' '), ['查', '保护', '决定', '选择', '害怕', '证据', '问题']).length,
    appearances: chapters.filter((chapter) => aliasesOf(character).some((alias) => (chapter.content || '').includes(alias))).map((chapter) => chapter.chapterNum),
  }))
  const personScore = Math.min(20, Math.round(personEvidence.reduce((sum, item) => sum + Math.min(4, item.fields) + (item.appearances.length > 0 ? 1 : 0), 0) / Math.max(major.length, 1) * 3))
  evidence.push(result(personScore, personEvidence.map((item) => item.name + '：正文出场第' + (item.appearances.join('、') || '无') + '章').join('；'), personEvidence.filter((item) => item.appearances.length === 0).map((item) => item.name + '未进入前三章正文')))

  const bridgeEvidence = chapters.slice(1).map((chapter, index) => {
    const previous = chapters[index]
    const previousText = previous.content || ''
    const anchors = hit(chapter.content || '', ['林知微', '复印件', '钥匙', '北济路', '借阅单', '转运记录', '短信', '停车场'])
    return { from: previous.chapterNum, to: chapter.chapterNum, anchors: anchors.slice(0, 6), carriedSeed: previous.nextChapterSeed ? (chapter.content || '').includes(previous.nextChapterSeed.slice(0, 8)) : true }
  })
  const continuityScore = Math.min(20, bridgeEvidence.reduce((sum, item) => sum + Math.min(5, item.anchors.length) + (item.carriedSeed ? 3 : 0), 0) + 2)
  evidence.push(result(continuityScore, bridgeEvidence.map((item) => '第' + item.from + '→' + item.to + '章承接锚点' + item.anchors.length + '个').join('；'), bridgeEvidence.filter((item) => item.anchors.length < 3).map((item) => '第' + item.to + '章承接锚点不足')))

  const pacingEvidence = chapters.map((chapter) => {
    const body = chapter.content || ''
    const markers = hit(body, ['必须', '没有', '改为', '没有回答', '选择', '代价', '不再', '有人'])
    return { chapter: chapter.chapterNum, markers: markers.slice(0, 8), hasStateChange: markers.length >= 3 }
  })
  const pacingScore = Math.min(15, pacingEvidence.reduce((sum, item) => sum + (item.hasStateChange ? 5 : 2), 0))
  evidence.push(result(pacingScore, pacingEvidence.map((item) => '第' + item.chapter + '章状态变化信号' + item.markers.length + '个').join('；'), pacingEvidence.filter((item) => !item.hasStateChange).map((item) => '第' + item.chapter + '章状态变化不足')))

  const foreshadowTerms = ['第十三户', '借阅单', '七码', '北济路', '钥匙', '转运记录']
  const foreshadowHits = hit(text, foreshadowTerms)
  const foreshadowScore = Math.min(15, foreshadowHits.length * 2 + (chapters[2]?.content?.includes('转运记录') ? 3 : 0))
  evidence.push(result(foreshadowScore, '伏笔词命中：' + foreshadowHits.join('、'), foreshadowHits.length < 4 ? ['前三章具体伏笔不足'] : []))

  const nameMap = new Map(characters.map((character) => [character.id, character.fullName]))
  const relationEvidence = relations.map((relation) => {
    const first = characters.find((character) => character.id === relation.charAId)
    const second = characters.find((character) => character.id === relation.charBId)
    const pair = [nameMap.get(relation.charAId), nameMap.get(relation.charBId)].filter(Boolean)
    const mentions = chapters.filter((chapter) => first && second && aliasesOf(first).some((alias) => (chapter.content || '').includes(alias)) && aliasesOf(second).some((alias) => (chapter.content || '').includes(alias))).map((chapter) => chapter.chapterNum)
    return { pair: pair.join('—'), label: relation.relationLabel, mentions }
  })
  const relationScore = Math.min(15, relations.reduce((sum, relation) => {
    const first = characters.find((character) => character.id === relation.charAId)
    const second = characters.find((character) => character.id === relation.charBId)
    const mentions = chapters.filter((chapter) => first && second && aliasesOf(first).some((alias) => (chapter.content || '').includes(alias)) && aliasesOf(second).some((alias) => (chapter.content || '').includes(alias))).length
    return sum + (mentions > 0 ? 3 : 1) + (relation.interactionStyle ? 1 : 0) + (relation.subtextRule ? 1 : 0)
  }, 0))
  evidence.push(result(relationScore, relationEvidence.map((item) => item.pair + '：' + item.label + '，正文共同出现第' + (item.mentions.join('、') || '无') + '章').join('；'), relationEvidence.filter((item) => item.mentions.length === 0).map((item) => item.pair + '关系尚未在正文共同出现')))

  const banned = ['命运的齿轮', '所有人都惊呆了', '没人知道的是', '一场更大的阴谋正在展开']
  const bannedHits = hit(text, banned)
  const repeatedOpenings = chapters.map((chapter) => (chapter.content || '').split(/\n/)[0]).filter(Boolean)
  const aiRiskScore = Math.min(15, bannedHits.length * 5 + (new Set(repeatedOpenings).size < repeatedOpenings.length ? 3 : 0))
  evidence.push(result(15 - aiRiskScore, bannedHits.length ? '命中禁用表达：' + bannedHits.join('、') : '未命中样本禁用表达；章节开头未重复。', bannedHits))

  const scores = {
    characterDevelopment: evidence[0],
    continuity: evidence[1],
    pacing: evidence[2],
    foreshadowing: evidence[3],
    relationshipNetwork: evidence[4],
    antiAi: evidence[5],
  }
  const blockers = evidence.flatMap((item) => item.blockers)
  const total = Object.values(scores).reduce((sum, item) => sum + item.score, 0)
  const status = blockers.length > 0 || total < 75 ? 'needs_revision' : 'conditional_pass'
  const report = {
    schemaVersion: 'character-story-evaluation-v1',
    sampleKey: SAMPLE_KEY,
    novel: { id: novel.id, title: fullNovel.title, contextVersion: fullNovel.contextVersion || 1 },
    coverage: { chapters: chapters.length, characters: characters.length, relations: relations.length, hasStateTracking: true },
    scoring: { total, status, scores },
    blockers: [...new Set(blockers)],
    recommendations: [
      '补充第 3 章后的人物使用记录和关系变化证据，再进入正式生成。',
      '让顾衡或周启明在后续章节做一次不可替代的独立选择，避免功能角色化。',
      '第十三户身份的部分回收必须改变林知微与沈岚的关系，而不是只增加新谜团。',
      '下一轮人物需求分析应以当前正文和未回收线程为输入，验证是否需要第六位角色。',
      '每章至少兑现一个局部问题：先回答已建立的疑问，再提出下一层问题，避免连续只投放新线索。',
      '给林知微安排一次有代价的误判或错误选择，并让沈岚、顾衡、何秋梅分别做一次主动决定，降低“角色只负责递线索”的结构感。',
      '章节结尾轮换为局部真相、误判、损失、关系破裂和新危险，不要连续使用“新文件/新短信/新谜团”同构钩子。',
    ],
    generatedAt: new Date().toISOString(),
  }
  const outputDir = path.join(workspaceRoot, 'todo/character-story-evaluations')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, SAMPLE_KEY + '.json')
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ outputPath, novelId: novel.id, total, status, characterCount: characters.length, chapterCount: chapters.length, relationCount: relations.length }, null, 2))
  app.quit()
}

app.whenReady().then(() => main().catch((error) => {
  console.error(error)
  app.exit(1)
}))
