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
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

const SAMPLE_KEY = 'character-continuity.fanqie.20260721.v1'
const SAMPLE_TITLE = '拆迁清单上的第十三户'
const brief = {
  schemaVersion: 'project-brief-v2',
  platformMode: 'fanqie',
  targetAudience: '都市职业悬疑 / 家庭秘密 / 旧城更新',
  targetReader: '喜欢具体证据、人物关系变化和每章都有新压力的番茄读者。',
  readerPromise: '每章解决一个局部问题，同时让第十三户的真实身份更近一步。',
  sellingPoints: ['拆迁清单上的第十三户', '公共记录与家庭隐瞒互相咬合', '关系变化会改变证据解释'],
  tabooRules: ['不靠梦境直接揭谜', '不让人物听一句话就相信', '不使用空泛气氛替代现场证据'],
  deliveryRhythm: '首章异常清单与邮箱风险；第二章家庭关系转为阻力；第三章拿到转运记录并留下跟踪风险。',
  sampleKey: SAMPLE_KEY,
}
const settings = {
  sampleKey: SAMPLE_KEY,
  premise: {
    positioning: '番茄都市职业悬疑，主打旧城更新、公共记录、家庭秘密和证据反转。',
    coreHook: '测绘员林知微发现拆迁清单多出第十三户，追查时发现每条公共记录都牵连母亲当年的选择。',
    protagonistStart: '林知微，二十九岁，做旧城测绘与资料核验，习惯先复制证据再相信解释。',
    constraints: '每章必须有可验证证据、现实阻力和人物选择；禁止用巧合直接解决关键问题。',
    languageGuardrails: '以纸张、钥匙、监控、邮件和公共记录承担信息，减少空泛情绪判断。',
  },
  writingRules: {
    antiAiFlavor: '避免成串排比、万能震惊和解释性总结；对白保留打断、犹豫、误解与身份差异。',
    commonSenseRules: '物业、买方、医院档案和报警流程必须有现实阻力；人物不能无理由共享信息。',
    bannedTerms: '命运的齿轮、所有人都惊呆了、没人知道的是、一场更大的阴谋正在展开',
  },
  storyGoal: '林知微查清第十三户的真实身份，并决定是否公开母亲当年隐瞒的选择。',
  coreConflict: '旧城更新需要快速清库签约，林知微的证据会让母亲、物业和买方同时承担现实代价。',
  mainPlot: '从旧楼清库异常开始，追到旧市立医院转运记录，再牵出母亲当年保护一个孩子的选择。',
  ending: '公开记录，接受房屋交易失败和家庭关系重组的代价。',
  endgameDesign: { endingMode: '真相公开但关系不可逆', finalConflict: '在保护母亲和公开第十三户身份之间选择。', themeAnswer: '证据也逼人承担当时没有承担的选择。', mustDeliverPromises: '第十三户身份、母亲的选择、清单被篡改的责任链。' },
}

const fixtureRoot = path.join(workspaceRoot, 'todo/platform-evaluation-2026/samples/fanqie')
const chapterData = [
  { num: 1, title: '清单上多出来的那一户', file: '001.md', outline: '林知微在旧楼清库前发现多出的第十三户，复制借阅单并放弃签约，邮箱随即遭到登录尝试。', summary: '林知微发现借阅单与拆迁清单的时间矛盾，复制证据后选择追查北济路，付出错过签约和暴露邮箱的代价。', seed: '母亲认出北济路并要求烧掉复印件。', tone: '从职业谨慎转为被监视的不安' },
  { num: 2, title: '母亲说，别再问了', file: '002.md', outline: '母亲认出北济路，要求林知微烧掉复印件并交出旧医院库房钥匙；林知微保留证据，家庭关系变成调查阻力。', summary: '母亲承认曾在旧医院工作，却拒绝解释七码，拿出库房钥匙要求林知微停止调查；林知微留下钥匙并决定不烧纸。', seed: '退休护士改在北济路停车场见面，陌生短信要求不要带原件。', tone: '亲情保护与追查欲正面冲突' },
  { num: 3, title: '转运记录没有写完', file: '003.md', outline: '林知微在临时改址的停车场见到退休护士，拿到七码病房的转运记录，并确认有人提前知道她会来。', summary: '护士交出女婴转运记录，林知微确认母亲当年留下孩子却不是最终责任人；监控与短信表明有人持续跟踪。', seed: '林知微需要确认母亲保护的孩子是谁，同时查清是谁篡改转运记录。', tone: '证据兑现后转为现实追踪压力' },
].map((item) => ({ ...item, content: fs.readFileSync(path.join(fixtureRoot, 'chapters', item.file), 'utf8').trim() }))

const characters = [
  { key: 'lin', fullName: '林知微', aliasTerms: ['林知微', '知微'], roleType: 'protagonist', occupation: '旧城测绘与档案核验员', socialIdentity: '旧城更新项目外聘核验员', background: '习惯先复制证据再相信解释，和母亲相依为命。', goals: '查清拆迁清单上的第十三户', surfaceDesire: '保住工作并完成旧楼清库', deepNeed: '承认母亲的保护也可能制造了新的伤害', coreFear: '真相公开后母亲会失去房子', innerConflict: '证据必须公开，但公开会伤害最亲近的人', relationshipTension: '对母亲既依赖又不再完全相信', characterArc: '从只相信记录到承担公开记录的代价', speechPattern: '先问凭证和时间，再回应情绪', appearChapter: 1 },
  { key: 'mother', fullName: '沈岚', aliasTerms: ['沈岚', '母亲', '妈妈'], roleType: 'major', occupation: '社区药房退休职员', socialIdentity: '林知微的母亲', background: '三十年前在旧市立医院工作过，知道七码但拒绝说明全部经过。', goals: '保护林知微不被旧案牵连', surfaceDesire: '让女儿烧掉复印件', deepNeed: '承认当年留下孩子的选择需要承担后果', coreFear: '女儿知道真相后会把她当成帮凶', innerConflict: '保护家人和补偿被留下的人互相冲突', relationshipTension: '用命令代替解释，越保护越像阻拦', characterArc: '从隐瞒保护转向承认选择', speechPattern: '用命令代替解释', appearChapter: 2 },
  { key: 'zhou', fullName: '周启明', aliasTerms: ['周启明', '物业经理'], roleType: 'supporting', occupation: '物业项目经理', socialIdentity: '旧楼清库与买方签约接口人', background: '只想按期完成签约，但知道清单和档案存在不一致。', goals: '按期完成清库并保住项目奖金', surfaceDesire: '让林知微别把旧纸带出去', deepNeed: '决定是否承认自己见过被撕掉的登记页', coreFear: '项目延期后责任落到自己身上', innerConflict: '职业利益与对住户的愧疚冲突', relationshipTension: '表面催促，实际在试探林知微掌握了多少', characterArc: '从遮掩流程问题到提供关键时间证据', speechPattern: '用流程催促，回避具体日期', appearChapter: 1 },
  { key: 'nurse', fullName: '何秋梅', aliasTerms: ['何秋梅', '护士', '退休护士'], roleType: 'major', occupation: '退休护士', socialIdentity: '旧市立医院转运科知情人', background: '保存一页转运记录，但只在确认林知微不会先相信名字后交出证据。', goals: '让当年被转运的孩子重新获得身份', surfaceDesire: '只交出值班表和转运记录', deepNeed: '不再用沉默替旧同事承担风险', coreFear: '证词公开后自己成为唯一责任人', innerConflict: '想说出真相又害怕改变孩子现在的生活', relationshipTension: '对林知微保持合作但不交付信任', characterArc: '从控制证据节奏到承担证词后果', speechPattern: '先纠正问题顺序，不直接回答名字', appearChapter: 3 },
  { key: 'buyer', fullName: '顾衡', aliasTerms: ['顾衡', '买方', '法务代表'], roleType: 'antagonist', occupation: '旧城更新项目法务代表', socialIdentity: '买方风险控制负责人', background: '需要在签约前清掉历史住户记录，不能让第十三户进入正式审查。', goals: '让异常记录在签约前失去效力', surfaceDesire: '把问题定义为无效旧档案', deepNeed: '证明自己只是执行流程而不是篡改者', coreFear: '历史记录反向追责到买方公司', innerConflict: '知道记录有问题却必须把风险包装成程序问题', relationshipTension: '和林知微保持礼貌但不断施压', characterArc: '从幕后压力转为必须公开回应的人', speechPattern: '使用流程话术包装风险', appearChapter: 1 },
]

function json(value) { return JSON.stringify(value) }
function charPayload(character) {
  const { key, ...payload } = character
  return { ...payload, recordStatus: 'confirmed', entityType: 'human', personalityTraitsJson: json([]), flawsJson: json([]), habitsJson: json([]), contextHooksJson: json(['第十三户', '北济路', '旧市立医院', ...(character.aliasTerms || [])]), sourceContextJson: json({ source: 'canonical-sample', sampleKey: SAMPLE_KEY, aliases: character.aliasTerms || [] }) }
}

function ensureExecutableContracts(chapterService, endgameAssetService, novelId) {
  const chapters = chapterService.listChapters(novelId)
  chapters.forEach((chapter) => {
    const source = chapterData.find((item) => item.num === chapter.chapterNum)
    const chapterGoal = source?.outline || chapter.outline || `完成第${chapter.chapterNum}章的核心推进。`
    endgameAssetService.upsertChapterContract(chapter.id, {
      chapterGoal,
      openingStyle: chapter.chapterNum === 1 ? 'incident' : 'continuation',
      endingStyle: 'reversal',
      expositionMode: 'embedded_action',
      emotionFocus: source?.tone || '',
      requiredAssetRefs: chapter.chapterNum === 1 ? ['借阅单', '拆迁清单'] : chapter.chapterNum === 2 ? ['库房钥匙', '复印件'] : ['转运记录', '监控与短信'],
      forbiddenActions: ['不能用巧合直接解决关键问题', '不能提前揭穿第十三户的全部身份'],
      acceptanceNotes: ['本章必须出现可验证证据或现实阻力', '结尾必须留下下一章可执行的问题'],
      status: 'ready',
    })
    const scenes = endgameAssetService.listSceneContracts(chapter.id)
    scenes.forEach((scene, index) => {
      endgameAssetService.upsertSceneContract(chapter.id, scene.segmentId ?? null, {
        pov: '林知微',
        timeLocation: scene.timeLocation || '旧城更新现场',
        sceneGoal: scene.sceneGoal || chapterGoal,
        obstacle: scene.obstacle || '现实流程、家庭隐瞒或证据来源限制形成阻力。',
        conflictType: 'evidence_pressure',
        emotionShift: source?.tone || '',
        resultState: scene.resultState || (index === scenes.length - 1 ? source?.seed || '留下下一步追查压力。' : '获得局部证据并付出代价。'),
        linkageMode: 'carry_forward',
        status: 'ready',
      })
    })
  })
}

async function main() {
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const novelService = require(path.join(workspaceRoot, 'electron/services/novel.service.ts'))
  const structureService = require(path.join(workspaceRoot, 'electron/services/story-structure.service.ts'))
  const characterService = require(path.join(workspaceRoot, 'electron/services/character.service.ts'))
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const endgameAssetService = require(path.join(workspaceRoot, 'electron/services/endgame-asset.service.ts'))
  const stateService = require(path.join(workspaceRoot, 'electron/services/character-state.service.ts'))
  const arcService = require(path.join(workspaceRoot, 'electron/services/character-arc.service.ts'))
  const worldStateService = require(path.join(workspaceRoot, 'electron/services/world-state.service.ts'))
  const memoryService = require(path.join(workspaceRoot, 'electron/services/story-memory.service.ts'))

  const existing = novelService.listNovels().find((novel) => novel.title === SAMPLE_TITLE)
  if (existing) {
    const existingCharacters = characterService.listCharacters(existing.id)
    characters.forEach((character) => {
      const current = existingCharacters.find((item) => item.fullName === character.fullName)
      if (current) characterService.updateCharacter(current.id, { contextHooksJson: json(['第十三户', '北济路', '旧市立医院', ...(character.aliasTerms || [])]), sourceContextJson: json({ source: 'canonical-sample', sampleKey: SAMPLE_KEY, aliases: character.aliasTerms || [] }) })
    })
    ensureExecutableContracts(chapterService, endgameAssetService, existing.id)
    console.log(JSON.stringify({ sampleKey: SAMPLE_KEY, novelId: existing.id, reused: true, title: existing.title }, null, 2))
    app.quit()
    return
  }

  const novelId = novelService.createNovel({
    title: SAMPLE_TITLE,
    synopsis: '旧城拆迁清单多出第十三户，测绘员林知微沿着旧市立医院转运记录追查，发现母亲隐瞒了三十年前的选择。',
    launchMode: 'fast_launch',
    operatingMode: 'shortform',
    projectBriefJson: json(brief),
    settingsJson: json(settings),
    themeVoiceJson: json({ theme: '证据、隐瞒与家庭代价', emotionalCore: '让被删掉的人重新出现。', pov: '第三人称有限视角，跟随林知微。', styleRules: '从物件和现场切入，用人物选择推进，不用作者总结替代后果。', dialogueRules: '林知微问凭证；沈岚回避；何秋梅纠正问题顺序；顾衡使用流程话术。', writingContractTags: ['证据链', '家庭阻力', '职业悬疑', '去模板化表达'] }),
    userBackground: '番茄都市职业悬疑测试项目，验证人物增量、关系网络、前三章连贯与反 AI 味。',
    expandedBackground: '旧城更新项目在清库时抹掉了第十三户，公共档案和家庭记忆互相矛盾。',
    targetWords: 120000,
  })
  const volumeId = structureService.createStoryVolume(novelId, { title: '第一卷：清单之外', summary: '从旧楼清库异常追到旧市立医院转运记录。', targetWords: 30000, status: 'writing' })
  const partId = structureService.createStoryPart(volumeId, { title: '第一案：第七码', summary: '异常借阅单、母亲的库房钥匙和停车场转运记录。', targetWords: 12000, status: 'writing' })

  const ids = new Map()
  characters.forEach((character) => ids.set(character.key, characterService.createCharacter(novelId, charPayload(character))))
  const relation = (a, b, type, label, description, tension, interactionStyle, subtextRule) => characterService.upsertRelation({ novelId, charAId: ids.get(a), charBId: ids.get(b), relationType: type, relationLabel: label, description, bilateral: 1, tensionLevel: tension, interactionStyle, subtextRule })
  relation('lin', 'mother', 'family', '母女', '互相依赖但围绕七码和旧医院记录持续隐瞒。', 5, '林知微追问时间，沈岚用命令截断话题。', '说保护时其实都在害怕对方知道真相。')
  relation('lin', 'zhou', 'work', '项目接口', '周启明需要林知微完成清库，林知微需要他的登记权限。', 3, '一方催流程，一方反问记录。', '礼貌越完整，双方越不信任。')
  relation('lin', 'nurse', 'investigation', '证词合作', '何秋梅掌握转运记录，但要求林知微先确认问题再确认名字。', 4, '护士控制证据顺序，林知微控制追问节奏。', '谁先说出名字，谁就可能先失去判断。')
  relation('lin', 'buyer', 'enemy', '清库对立', '顾衡要让异常记录失去效力，林知微要让第十三户进入正式审查。', 4, '顾衡讲流程，林知微追问凭证。', '两人都用职业语言隐藏各自的恐惧。')
  relation('mother', 'nurse', 'secret', '旧医院知情', '两人都知道三十年前的转运经过，但承担的选择不同。', 5, '一个命令沉默，一个只交出半页证据。', '沈岚怕孩子被找到，何秋梅怕孩子永远没有名字。')

  const chapterIds = []
  for (const chapter of chapterData) {
    const chapterId = chapterService.createChapter(novelId, { chapterNum: chapter.num, title: chapter.title, outline: chapter.outline, targetWords: 2600, emotionTone: chapter.tone, volumeId, partId, allowedFactIdsJson: '[]', revealedFactIdsJson: '[]' })
    chapterService.updateChapter(chapterId, {
      content: chapter.content,
      summary: chapter.summary,
      nextChapterSeed: chapter.seed,
      status: 'draft',
      continuityStateJson: json({ plotProgress: [chapter.summary], characterStateChanges: [chapter.num === 1 ? '林知微从完成清库转为主动追查。' : chapter.num === 2 ? '林知微与沈岚从母女协商转为证据对抗。' : '林知微取得转运记录，但确认自己已被提前监视。'], worldStateChanges: ['第十三户从清单异常升级为旧医院转运案。'], openLoops: [chapter.seed], continuityNotes: ['样本章节使用正文证据，后续可继续通过章节服务生成。'], arcProgress: '第一卷第' + chapter.num + '章：' + chapter.outline }),
      reviewNotesJson: json({ aiRisk: '需复核', notes: ['关系网络已登记，需检查每条关系是否在正文中改变行动。', '第三章记录来源仍需后续章节验证。'] }),
      contractAuditJson: json({ status: 'ready', source: 'canonical-character-continuity-sample' }),
      hookContinuityJson: json({ hookType: chapter.num === 1 ? 'strong-cliffhanger' : 'evidence-escalation', hookStrengthScore: 4, unresolvedHookChain: [chapter.seed] }),
      contextVersion: 1,
    })
    stateService.refreshCharacterStateVersionsForChapter(chapterId)
    arcService.syncCharacterArcsFromChapterState(chapterId)
    worldStateService.refreshWorldStateVersionsForChapter(chapterId)
    chapterIds.push(chapterId)
  }
  memoryService.refreshStoryMemoryCheckpoints(novelId)
  ensureExecutableContracts(chapterService, endgameAssetService, novelId)

  console.log(JSON.stringify({ sampleKey: SAMPLE_KEY, reused: false, novelId, title: SAMPLE_TITLE, volumeId, partId, characterIds: Object.fromEntries(ids), chapterIds, counts: { characters: characters.length, chapters: chapterData.length, relations: 5 } }, null, 2))
  app.quit()
}

app.whenReady().then(() => main().catch((error) => {
  console.error(error)
  app.exit(1)
}))
