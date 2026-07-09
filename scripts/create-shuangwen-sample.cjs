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

const SAMPLE_KEY = 'sample.shuangwen.shenzhangju.v1'
const SAMPLE_TITLE = '神账局：我给万神讨薪'
const GENRE_NAME = '都市民俗高武'
const TARGET_WORDS = 1000000

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function backupDatabaseFiles(dbPath) {
  if (!fs.existsSync(dbPath)) return []
  const marker = `before-shuangwen-sample-${stamp()}`
  const copied = []
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`
    if (!fs.existsSync(source)) continue
    const target = `${dbPath}.${marker}${suffix || '-main'}.bak`
    fs.copyFileSync(source, target)
    copied.push(target)
  }
  return copied
}

function parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toJson(value) {
  return JSON.stringify(value)
}

function insertRow(db, table, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (entries.length === 0) throw new Error(`No fields for ${table}`)
  const columns = entries.map(([column]) => column)
  const placeholders = entries.map((_, index) => `@p${index}`)
  const params = Object.fromEntries(entries.map(([, value], index) => [`p${index}`, value]))
  return Number(db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(params).lastInsertRowid)
}

function updateRow(db, table, id, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return
  const assignments = entries.map(([column], index) => `${column} = @p${index}`)
  const params = Object.fromEntries(entries.map(([, value], index) => [`p${index}`, value]))
  params.id = id
  db.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = @id`).run(params)
}

function countHanzi(text) {
  return (String(text || '').match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length
}

function ensureGenre(db) {
  const existing = db.prepare('SELECT id FROM genres WHERE name = ? ORDER BY id LIMIT 1').get(GENRE_NAME)
  if (existing) return Number(existing.id)
  return insertRow(db, 'genres', {
    name: GENRE_NAME,
    description: '现代都市、民俗志怪、香火债务、高武升级和爽文清算线混合题材。',
    is_builtin: 0,
    color_tag: '#0f766e',
  })
}

function resetExistingSample(db) {
  const existing = db.prepare('SELECT id, settings_json AS settingsJson FROM novels WHERE title = ? ORDER BY id DESC LIMIT 1').get(SAMPLE_TITLE)
  if (!existing) return null
  const settings = parseJson(existing.settingsJson)
  if (settings?.sampleKey !== SAMPLE_KEY) {
    throw new Error(`已存在同名小说《${SAMPLE_TITLE}》，但不是本脚本创建的样稿。为避免覆盖用户数据，请先手动改名或删除。`)
  }
  db.prepare('DELETE FROM novels WHERE id = ?').run(existing.id)
  return Number(existing.id)
}

const projectBrief = {
  premise: '失业审计员陆沉入职城市资产清算中心后，发现自己核的不是烂尾楼旧账，而是被资本、平台和地方豪强欠了百年的城隍、河神、灶王和无名英魂的香火债。每清一笔神债，他就能临时借用一次神权；欠债者会被拖进民俗规则副本，当场偿还利息。',
  targetReader: '偏好番茄式强钩子、都市玄幻、高武升级、民俗志怪和短剧名场面的长篇读者。',
  sellingPoints: [
    '现代职场审计和民俗神明债务结合',
    '清账即升级，爽点可量化但有代价',
    '每案一个地方民俗副本，方便连续名场面',
    '反派不是单个邪神，而是把香火做成算法生意的新资本',
  ],
  coreEmotion: '替被遗忘的人和神把旧账讨回来。',
  constraints: [
    '神怪力量必须通过账目、证据、民俗规则触发，不能无条件开挂。',
    '每个副本先给生活细节，再给怪异压迫，避免空喊设定。',
    '爽点以证据反杀、规则反转、当众清算为主，不写无意义装逼。',
    '主角每次借神权都留下现实代价，推动后续选择。',
  ],
  millionWordPlan: {
    targetWords: TARGET_WORDS,
    volumeCount: 5,
    plannedChapters: 220,
    cadence: '前30章每3章完成一个小清算，之后每卷完成一条城市级神债。',
  },
  trendPositioning: {
    platformSignals: ['都市玄幻', '民俗志怪', '规则副本', '强名场面', '短剧改编潜力', '考据式都市传说'],
    differentiation: '不用“神明降临拯救世界”的常见线，而用“审计、欠薪、清算、香火金融”把日常职场和超自然爽点扣在一起。',
  },
  readyCount: 7,
}

const settings = {
  sampleKey: SAMPLE_KEY,
  premise: {
    positioning: '百万字都市民俗高武爽文，主打神明欠薪、香火债务、规则副本和当众清算。',
    coreHook: '主角能看见万神账本，所有被拖欠的香火、命债、愿债都会变成可审计的现实证据；清掉一笔债，就能借一段神权。',
    protagonistStart: '陆沉，二十八岁，刚被审计事务所背锅裁员，习惯先看凭证再说话，讨厌别人把苦难写成“系统误差”。',
    constraints: '每次胜利必须同时满足证据链、民俗规则和现实执行三条线；不得靠突然顿悟和无来源神力解决冲突。',
    languageGuardrails: '句子尽量具体，少用“命运、宿命、深渊、棋局”等泛化大词；让账本、收据、雨水、旧庙灰、手机录音承担信息。',
  },
  writingRules: {
    antiAiFlavor: '正文避免成串排比、万能震惊、过度解释和角色自述设定。每段至少有一个可看见的动作、物件或场地细节；对白保留停顿、顶嘴、误解和人情味。',
    commonSenseRules: '审计取证、公安介入、公司法务、媒体传播都要有现实阻力；神怪场面不能让普通人全程无反应。',
    bannedTerms: '命运的齿轮、所有人都惊呆了、恐怖如斯、没人知道的是、一场更大的阴谋正在展开、他不知道的是、从此走上巅峰。',
  },
  storyGoal: '陆沉从临时核账员成长为“万神债主”，清掉江州市三十七类香火债，逼出算法造神计划，最终把城市被吞掉的旧愿望还给普通人。',
  coreConflict: '旧神需要人间记得他们，新资本想把香火变成可交易流量；陆沉夹在法律证据、民俗规则和现实人情中间清账。',
  mainPlot: '从旧城隍欠薪案切入，依次清理河神断流、鬼市上市、灶王失语、无名英魂被剪辑成短视频素材等案件，最后发现父亲当年的失踪是第一笔被隐藏的神债。',
  ending: '陆沉拒绝成为新的香火垄断者，公开万神账本的清算规则，让每座旧庙、每条河和每个被借走名字的人都能自己追债。',
  endgameDesign: {
    endingMode: '大清算胜利但神权去中心化',
    finalConflict: '陆沉必须在独占万神账本维持秩序，和公开账本让所有人承担混乱之间选择。',
    themeAnswer: '真正的神不是高高在上的奇迹，而是普通人愿意记账、还账、认账。',
    mustDeliverPromises: '父亲失踪真相、万神账本来源、算法神造神计划、旧城隍第一笔欠薪全部回收。',
    payoffChecklist: '第一章的红章收据、第二章的电梯水痕、黑水河旧闸、父亲留下的错账本、温阙的无脸神像。',
    deliberateUnknowns: '保留江州市之外的全国民俗清算网络，为续部留出口。',
    finalImage: '清晨，旧城厢所有小庙同时打开门，门口不再摆功德箱，而摆着一本公开账册。',
    lastScene: '陆沉把朱笔交给排队的第一个老人：阿姨，您先说，哪一年欠的？',
  },
}

const themeVoice = {
  theme: '欠债、记忆与公共正义',
  emotionalCore: '替沉默者把话说完，替被遗忘者把账收回来。',
  pov: '第三人称有限视角，主要跟随陆沉。',
  tense: '过去时为主。',
  styleRules: '开局快，信息密，但不用旁白硬讲设定。每个爽点前先给现实委屈和可核验证据，爽点后补代价。',
  dialogueRules: '对话带职业身份差异：陆沉说凭证和流程，姜照夜说风险和现场，温阙说商业模型，旧神说人间旧称呼。',
  antiAiRewriteChecklist: [
    '删掉泛泛情绪判断，换成动作和物件。',
    '删掉“他不知道的是”等上帝视角句。',
    '每章至少保留两处生活化细节。',
    '每次打脸必须先有对方具体错误，不写空泛嘲讽。',
  ],
  writingContractTags: ['证据链爽点', '民俗规则', '现实阻力', '短剧名场面', '去模板化表达'],
}

const worldRules = {
  summary: '江州市表面是普通新一线城市，旧城改造和平台经济吞掉了大量庙产、河道、祠堂和无名烈士纪念地。香火复苏后，旧神不是万能存在，而是拿着旧契、旧愿、旧账向人间讨债。',
  powerSystem: {
    core: '万神账本记录“愿债、香火债、命债、名债”。只有现实证据和民俗规则同时成立，账页才会翻开。',
    upgrade: '主角通过清账积累“可借神权时长”，能力从问账、验印、封门、请神，逐步到开城隍庭、断河脉、清算法神。',
    cost: '每次借权都会留下身体或社会成本：失眠、旧伤、被监控标记、法律风险、人情债。',
  },
  debtRules: [
    '债务必须有凭证：契书、收据、口供、碑文、录音、监控、民俗仪式残留。',
    '神明不能主动杀人，只能把欠债者拖入对应规则，让其偿还等价利息。',
    '被大众遗忘越久的神，力量越不稳定，越容易被算法神收购名称和愿力。',
    '主角只负责核账，是否宽限、折抵、公开，要在当章作出选择。',
  ],
  organizations: [
    { name: '城市资产清算中心', alias: '神账局', role: '披着事业单位外壳的民俗债务处理部门。' },
    { name: '新愿集团', role: '用短视频、祈愿 App 和商业庙会收割愿力，试图制造算法神。' },
    { name: '旧城民俗会', role: '老人、庙祝、非遗匠人和地方志研究者组成的松散网络。' },
  ],
  timelineConfig: {
    calendarType: 'modern-date',
    eraName: '香火复苏前夜',
    epochLabel: '万神账本翻开',
    baseYearLabel: '2028 年',
    displayPattern: '2028-江州市-案号',
    relativeZeroLabel: '陆沉入职当晚',
    recommendedEventTypes: ['入职', '清算', '副本', '反杀', '伏笔', '代价'],
    precisionOptions: ['分钟', '日', '案号', '阶段'],
  },
  sections: [
    { key: 'city', title: '江州市', content: '旧城厢、黑水河、高新区和天光 Mall 构成第一卷主要舞台，传统空间被现代商业层层覆盖。' },
    { key: 'folk-rules', title: '民俗规则', content: '城隍管账，河神管流，灶王管口供，门神管边界；每种神权只在对应场景生效。' },
    { key: 'algorithm-god', title: '算法神', content: '新愿集团把愿望拆成标签和流量，用匿名祈愿制造无脸神，是全书中后期主反派系统。' },
  ],
}

const blurb = {
  platformTitle: SAMPLE_TITLE,
  shortBlurb: '别人上班打卡，陆沉上班给城隍讨薪。欠神明的钱，可以拖；欠普通人的命，必须还。',
  longBlurb: '被事务所裁掉那天，陆沉接到一份临时工 Offer：城市资产清算中心，月薪四千八，包五险一金。入职第一晚，他核到一张民国旧收据，抬头写着“城隍庙香火修缮款”，欠款方却是江州市最有钱的地产老板。午夜零点，烂尾楼封门，旧神敲章。陆沉拿起朱笔才知道，自己不是来做账的，是来讨债的。',
  tags: ['都市玄幻', '民俗志怪', '规则副本', '神明欠薪', '爽文', '短剧潜力'],
  openingPromise: '第一章入职即进副本，三章内完成第一笔清算。',
}

const chapterOneContent = `
陆沉收到录用短信的时候，正站在事务所楼下等雨停。

短信只有两行。

【江州市城市资产清算中心：陆沉先生，您的入职审核已通过。请于今晚二十二点前到旧城厢分部报到。岗位：临时核账员。】

【备注：夜班，有加班餐。】

他看了三遍，第一反应不是高兴，而是把发件号码复制进浏览器。

网页跳出来的结果很干净。市属单位，地址确实在旧城厢，业务范围写得含糊：历史遗留资产、特殊产权、无主账册、民俗附属物清查。最后一项让陆沉停了一下。

民俗附属物。

他在审计事务所干了五年，见过烂尾楼、空壳公司、假合同和拿亲戚身份证套补贴的村办企业，没见过哪份政府采购把“民俗”写进资产项。

雨越下越急。楼上有人推开窗，把一个纸箱递给保安，保安转手放在门口。纸箱上贴着他的名字，里面是水杯、工牌、两本准则和一只用了三年的计算器。

就在二十分钟前，合伙人把他叫进会议室，说话很客气。

“小陆，这次瑞恒广场的底稿，客户意见很大。你年轻，先休整一段时间。”

陆沉问：“哪一张底稿？”

对方翻了翻文件，没翻出来。

陆沉又问：“哪一条程序错了？”

会议室安静了两秒。合伙人把钢笔帽按回去：“不是程序问题，是沟通问题。”

所谓沟通问题，就是客户把三千万拆迁补偿挂在“历史文化配套费用”里，他在底稿上写了四个字：缺少凭证。

现在他抱着纸箱，站在雨里，看着那条月薪四千八的短信，忽然笑了一声。

“行。”他说，“我去看看什么叫特殊产权。”

旧城厢分部不在办公楼里。

它夹在一家修鞋摊和一家卖烧饼的小门面中间，门头窄得像临时钉上去的，白底黑字，城市资产清算中心。卷帘门只拉开半截，里面透出一截灯光。陆沉弯腰进去，先闻到一股潮木头和旧纸混在一起的味道。

前台坐着个女人，二十七八岁，黑色冲锋衣，头发扎得很低，正在给一把桃木尺缠红线。她抬眼看了看陆沉怀里的纸箱。

“陆沉？”

“是。”

“姜照夜，外勤。”她把一张临时工牌推过来，“签字，领钥匙，今晚跟我出现场。”

陆沉看了一眼墙上的钟：“我还没办入职。”

“已经办完了。”

“劳动合同？”

“抽屉里。”

“岗位说明？”

姜照夜终于停下手：“核账。看得懂字，找得到凭证，遇事别乱许愿。够了。”

这句话像玩笑，又不像。陆沉翻开合同，甲方名称没错，公章也是真的。他多看了一眼章边，红泥压得很重，边缘有一圈细小的裂纹，像干掉的血痂。

姜照夜把一个牛皮纸档案袋丢到桌上。

“瑞恒广场，旧城厢三期，今晚二十三点清场。你负责核一笔账。”

陆沉手指顿住。

瑞恒广场。

他被裁的那个项目。

档案袋里只有三样东西：一张民国二十三年的收据复印件，一份十年前的旧城改造会议纪要，还有一张打印出来的照片。照片上是瑞恒广场负一层的消防通道，墙根堆着香炉、破匾和半截泥塑像。泥塑像只剩肩膀，手里托着一本账册。

收据抬头写得工整。

【江州府城隍庙香火修缮款，银元叁佰陆拾。经手：瑞恒堂。】

右下角盖着一个小红章：已欠。

陆沉盯着那个“欠”字看了几秒：“收据还能盖已欠？”

姜照夜把桃木尺塞进包里：“所以叫你来。”

二十三点二十，瑞恒广场负一层还有灯。

这里本来要做民俗商业街，招商 PPT 上写着“江州记忆，国潮新生”。现实是电梯停运，地砖起鼓，玻璃围挡后面堆着塑料花和发霉的灯笼。几十个老商户被保安堵在通道口，有人抱着账本，有人举着手机直播。

“说好今晚给补偿尾款！”卖纸扎的老头嗓子都哑了，“拖了七年，你们还要不要脸？”

保安队长不耐烦地挥手：“找开发商，别堵消防通道。”

“开发商电话打不通！”

“那找法院。”

人群后面，一个穿深灰西装的男人站在干净处，皮鞋没沾一点水。陆沉认得他，瑞恒集团副总，陈启明。上周审计沟通会上，就是他笑着说“历史文化配套费用不好拆太细”。

陈启明也看见了陆沉。

他先愣了一下，很快笑起来：“陆老师，换单位了？”

陆沉说：“临时工。”

“临时工好，压力小。”陈启明把烟夹在手里，没有点，“这里是企业内部清场，城市资产清算中心也管？”

姜照夜亮出证件：“涉及无主民俗附属物和历史遗留账册，我们可以进。”

陈启明脸上的笑淡了一层：“那就看，别影响执行。”

陆沉没说话。他蹲到墙根，拨开一块湿帆布。下面果然是照片里的半截泥塑像，泥胎裂开，里面塞着旧报纸。神像怀里的账册不是雕出来的，是真的，一本薄薄的线装册，被泥水糊住半边。

他戴上手套，把账册托起来。

第一页空白。

第二页也空白。

翻到第三页，纸上忽然浮出一行湿红的字。

【瑞恒堂欠江州城隍香火修缮款，折今银叁佰陆拾万。逾期九十四年，利息另计。】

陆沉的手停在半空。

灯闪了一下。

商户的吵闹声像被人从水里捞走，整个负一层忽然安静。所有卷帘门同时落下，砸在地上，发出一串沉闷的响。手机信号格清零，消防灯变成暗红色。通道尽头，那尊没有头的泥塑像慢慢站了起来。

保安队长骂了一句，抡起甩棍冲过去。甩棍打在泥塑像肩上，声音像敲湿墙。下一秒，他胸口的工牌翻转，背面多出一行字。

【欠薪：三个月。】

他整个人被一股看不见的力拖到墙边，膝盖重重磕在地砖上。

人群炸了。

陈启明终于变了脸色：“谁搞的装置？把电闸拉了！”

姜照夜一把拽住陆沉，把一支朱笔塞进他手里：“看到字没有？”

“看到了。”

“念出来。”

“念哪个？”

“账。”

陆沉低头看账册。第三页的红字像活的一样往外渗，后面又添了几行。

【欠商户补偿尾款：壹佰肆拾贰户，共壹仟壹佰捌拾万。】

【欠工人工资：伍拾陆人，共贰佰叁拾万。】

【欠城隍庙地契归还：一处。】

每一行后面都有小字：可核。

陆沉听见自己的心跳，一下，一下，撞得胸口发疼。他本该害怕，可职业习惯先一步压过来。他把账册往灯下一放，抬头问陈启明：“瑞恒三期历史文化配套费用，三千万，凭证在哪？”

陈启明后退半步：“你疯了？”

“我问凭证。”陆沉握紧朱笔，“上周你说有合同、有支付记录、有现场签收。现在账在这里，人也在这里。陈总，拿出来。”

泥塑像抬起没有头的脖子，账册哗啦啦翻页。每一页都盖着“已欠”，红得刺眼。

陈启明的皮鞋踩进积水里。他终于吼道：“那笔钱走的是咨询费！跟我没关系！”

朱笔在陆沉手里一沉。

账册第三页自动摊开，空白处浮出一枚印框。陆沉几乎是本能地把朱笔按下去，笔尖落纸的一瞬，整个负一层响起一声惊堂木般的闷响。

【问账成立。】

陈启明胸口的西装内袋突然鼓起，几十张折叠发票、转账截图、空白签收单像被风掀出来，噼里啪啦落了一地。最上面一张，是他私人公司收走三千万咨询费的银行回单。

卖纸扎的老头扑过去捡，手抖得厉害。

“就是这个章。”老人声音发颤，“当年他们让我们签，说先搬，钱后补。”

陈启明转身就跑。

卷帘门上浮出一张巨大的红色封条。

【城隍封门，欠清之前，不得出。】

陆沉抬头，看见那尊半截城隍像站在暗红灯光里，泥水从袖口往下滴。它没有脸，却像在等他继续写。

姜照夜低声说：“第一笔，收不收？”

陆沉看着满地票据，又看着那些被拖了七年的老商户。有人还举着手机，屏幕黑了，手却没放下。保安队长跪在墙边，嘴里小声念着“我也是打工的”。

陆沉翻到最后一页。

那里有一行新字。

【临时核账员陆沉，可代城隍问账一次。】

下面空着签名。

他拿起朱笔，写下自己的名字。

“收。”他说，“先收欠普通人的。”

红章落下。

瑞恒广场负一层所有灯同时亮起。`

const chapterTwoContent = `
灯亮以后，最先响起来的不是尖叫，是手机提示音。

叮、叮、叮。

一百多部手机同时找回信号，像雨点砸在铁皮棚上。有人下意识打开录像，有人给家里打电话，还有人举着那张银行回单，嘴唇哆嗦了半天，只说出一句：“拍清楚点，别糊。”

陈启明趴在卷帘门前，额头撞出一块青。他身上的西装湿透了，内袋还在往外吐纸。合同、发票、会议纪要、转账截图，像一只吃坏肚子的碎纸机，把他这些年藏得最深的东西一张张吐出来。

陆沉站在原地，右手还握着朱笔。

笔比刚才轻了，笔杆上的红漆褪掉一小块，露出里面暗沉的木色。他低头看自己的掌心，虎口裂了一道细口，血没流出来，只渗出一点朱砂似的红。

姜照夜递给他一张纸巾。

“第一次问账，都这样。”

陆沉接过来，按住虎口：“你们入职培训是不是漏了很多东西？”

“你没参加培训。”

“所以今晚是试用期？”

“今晚是抢人。”姜照夜看了一眼角落里的城隍像，“它先看见你。”

那尊泥塑像已经坐回墙根，仍旧没有头，肩膀塌着，像一位累到睡着的老人。可它怀里的账册还摊着。第三页的欠款数字一点点减少，商户尾款后面多了两个字：待偿。

陈启明被两个保安扶起来。他脸上的惊慌褪得很快，换成一种更熟练的愤怒。

“你们非法拘禁，非法取证。”他声音发哑，却还稳得住，“陆沉，你知道这些材料拿出去有没有效？你一个被事务所辞退的人，拿着一支破笔演戏，想讹瑞恒？”

人群静了一下。

这句话戳得准。普通人不怕见鬼，怕见了鬼以后，第二天照样没人认账。

卖纸扎的老头把回单攥在手里，问陆沉：“小陆，这个能要回钱吗？”

陆沉没有立刻回答。

他蹲下去，把地上的材料按类别分开。银行回单一摞，空白签收单一摞，会议纪要一摞，陈启明私人公司的发票一摞。动作很慢，却比任何保证都让人安静。

“能不能要回钱，不看我说什么。”陆沉把第一张回单举起来，“看证据够不够。今晚这些原件从陈启明身上掉出来，现场一百四十二户商户、五十六名工人、七名保安都看见了。现在开始，别围他，别打他，别抢材料。每个人打开录像，对着我这边拍。”

姜照夜挑了下眉。

陆沉继续说：“第一，拍材料原始状态。第二，拍陈启明本人在场。第三，拍瑞恒广场负一层堆放的旧庙构件。第四，拍刚才卷帘门无法打开的时间。谁手里有当年签的搬迁协议，按户号排队，别挤。”

老商户们互相看了看，很快动起来。

他们比谁都懂排队。七年里，他们排过信访办、法院立案窗口、街道调解室，也排过开发商前台。只是从来没人把他们的队当一回事。

陈启明脸色终于难看起来。

他摸向手机。屏幕刚亮，一条电话先打进来，备注是“温总”。陈启明像抓到救命绳，立刻接起。

“温总，现场出了点意外，有人搞封建迷信那套，还把资料抢了出来……”

电话那头很安静。

陆沉隔着几步，听不清对方说什么，只看见陈启明的表情一点点僵住。

“现在？”陈启明压低声音，“可是这里很多人拍着……我明白，我明白。”

他挂断电话，忽然笑了。

“陆沉，你真以为账是这么讨的？”

负一层尽头传来电梯运行的声音。

这里明明停电停运了半年，那部观光电梯却从一层慢慢降下来。透明轿厢里站着四个人，两个法务，一个公证员，还有一个戴金丝眼镜的年轻男人。男人穿白衬衫，没打领带，手里拿着一台平板。

电梯门打开，积水往两边退了一寸。

姜照夜低声说：“温阙，新愿集团法务合伙人。瑞恒后面真正出钱的人。”

温阙走出电梯，先对商户们点了点头，态度温和得像来参加发布会。

“各位，今晚的误会，我们会登记。”他说，“但请大家注意，未经核验的材料在网络传播，可能构成侵权。瑞恒集团愿意开放调解通道，也请这位陆先生停止煽动。”

他把平板转向众人。

屏幕上是一份刚生成的公告，标题已经写好：瑞恒广场遭遇恶意闹事，部分人员冒充公职人员传播不实信息。

发布时间，三分钟后。

人群里有人骂了一句。更多人沉默下来。

这就是现实的速度。鬼门关刚打开，公关稿已经排好版。

陆沉看着温阙：“你们连夜带公证员来，是为了调解？”

“为了固定证据。”温阙微笑，“固定你们非法获取商业资料的证据。”

他抬手，两个法务走向材料堆。

姜照夜的手摸到桃木尺。

陆沉拦了她一下。

“温律师。”他说，“你刚才说，未经核验。”

“是。”

“那就核验。”

温阙眼里终于有了一点兴趣：“你拿什么核？”

陆沉翻开城隍账册。第一页依旧空白，第三页的欠款还在。可第四页不知何时多了一行小字。

【新愿集团，代持瑞恒香火资产，欠名债一笔。】

欠名债。

陆沉想起世界规则里还没有任何解释，但他已经明白了七八分。瑞恒广场拿旧城隍做“国潮商业街”的招牌，拆了庙，搬了像，欠了商户的钱，最后又把“江州城隍”四个字注册成活动 IP，交给新愿集团运营。

神的名字被拿去招商，香火却没还给神。

他抬起朱笔，问：“江州城隍文化节这个项目，新愿拿了多少授权费？”

温阙笑意不变：“商业机密。”

“资金流从瑞恒三期历史文化配套费走，还是从新愿祈愿 App 的推广费走？”

温阙没有回答。

朱笔忽然在陆沉指间发烫。虎口的裂口重新疼起来，他听见一个很老的声音贴着耳边说：“问名，要拿自己的名抵。”

陆沉顿了顿。

姜照夜看向他：“别乱来。你今晚已经问过一次账，再问名，明天你的身份信息可能会从系统里消失几个小时。”

“几个小时？”

“也可能几天。”

陆沉想了想：“社保会断吗？”

姜照夜被他问得一怔：“都什么时候了？”

“那就行。”

他在账册第四页写下两个字：问名。

负一层的广播突然响了。不是商场音乐，而是一段段混在一起的录音。

“江州城隍国潮节，预计曝光三千万……”

“旧庙构件不用修，做旧更有味道……”

“商户补偿先压着，等他们自己熬不住……”

“城隍这个名字好，老人信，年轻人拍照也好看……”

每一句话，都带着时间、地点和说话人的名字。电梯里的公证员脸白了，手里的记录仪却很诚实，红灯一直亮着。

温阙第一次收起笑。

他看向陆沉，像在看一份突然活过来的坏账。

“你知道自己在碰什么吗？”

陆沉的手机震了一下。屏幕亮起，运营商、银行卡、社保 App 同时弹出登录异常。他的头像变成灰色，姓名栏闪了两下，短暂地空白。

那一瞬间，陆沉心里发冷。

不是因为神怪，而是因为他真的从系统里少了一块。

可人群里，卖纸扎的老头举着手机喊：“录下来了！这次真录下来了！”

更多声音跟着响起。

“我也录了。”

“发不出去，先蓝牙传。”

“我儿子在电视台，我给他打电话。”

温阙看着那些亮起来的屏幕，忽然低声说：“封。”

电梯井里传来水声。

黑色的水从门缝、排水口、电缆井同时涌出，速度快得不正常。水面上浮着细碎的纸灰，纸灰聚成一行行小字。

【黑水河河神，欠款三十七年。】

【利息，按命算。】

城隍账册哗啦一声翻到下一页。

陆沉抬头，看见观光电梯外侧，一张湿漉漉的旧河工照片贴在玻璃上。照片里的人都没有脸，只有胸前的工号还在往下滴水。

姜照夜把桃木尺抽出来，声音压得很低。

“第二笔债来了。”

陆沉把账册合上，虎口疼得像被火燎过。

“先把这里的人送出去。”他说，“账可以慢慢算，人不能再欠。”`

const chapterOutlines = [
  {
    chapterNum: 1,
    title: '入职当天，城隍来讨薪',
    content: chapterOneContent.trim(),
    outline: '陆沉被事务所裁员后入职城市资产清算中心，跟姜照夜进入瑞恒广场负一层，发现旧城隍香火修缮款和商户补偿尾款被长期挪用。城隍封门，陆沉第一次问账，逼出陈启明藏匿的证据。',
    emotionTone: '雨夜压迫、证据反杀、第一爽点',
    nextSeed: '陈启明背后的新愿集团入场，试图用法务和舆论反压现场。',
    scenes: [
      ['裁员后收到夜班 Offer', '用现实职场委屈建立主角的审计能力和情绪底色。', '事务所楼下', '失业和陌生单位形成压力', '陆沉决定去旧城厢分部。'],
      ['旧城厢分部入职', '交代姜照夜、特殊资产和瑞恒广场任务。', '城市资产清算中心旧城厢分部', '手续真实但业务异常', '陆沉拿到城隍旧收据。'],
      ['城隍封门问账', '进入民俗副本，完成第一笔证据反杀。', '瑞恒广场负一层', '陈启明否认欠款，城隍账册要求核账', '陆沉签名代问账。'],
    ],
  },
  {
    chapterNum: 2,
    title: '第一笔神债，先收利息',
    content: chapterTwoContent.trim(),
    outline: '城隍副本解除后，陆沉组织商户固定证据。温阙带法务和公证员入场，试图把神怪证据反打成非法取证。陆沉冒着身份信息短暂消失的代价问名，逼出新愿集团代持城隍 IP 的录音，同时触发黑水河河神债。',
    emotionTone: '现实反压、二次反杀、代价显形',
    nextSeed: '黑水倒灌，河神债要求按命收利息，陆沉必须先救人再查三十七年前河工旧案。',
    scenes: [
      ['现场固定证据', '让主角用专业流程稳住群众，避免神怪戏脱离现实。', '瑞恒广场负一层', '材料有效性和普通人的恐惧', '商户开始录像排队。'],
      ['新愿法务入场', '引出温阙和算法资本反派，不让第一胜利太轻。', '观光电梯口', '法务、公关、商业机密压制证据', '陆沉决定问名。'],
      ['黑水河债出现', '用代价和新案钩子结束章节。', '负一层电梯井', '问名导致身份异常，黑水倒灌威胁人命', '陆沉选择先救人。'],
    ],
  },
  {
    chapterNum: 3,
    title: '黑水倒灌，电梯里有三十七条命',
    outline: '陆沉和姜照夜疏散商户，发现黑水只追欠债相关人。河工旧照片出现三十七个工号，温阙试图带走关键硬盘。陆沉用城隍残印封住一扇门，第一次付出失眠代价。',
    emotionTone: '救人优先、追债转救命',
    nextSeed: '硬盘里有三十七年前黑水河改道工程的死亡名单。',
  },
  {
    chapterNum: 4,
    title: '河神不要香火，要名单',
    outline: '陆沉查到黑水河工程被包装成城市景观项目，死亡河工被改成临时失踪。河神副本不是索命，而是要完整名单和家属赔偿。陆沉找到第一位河工后人。',
    emotionTone: '沉痛取证、民俗温度',
    nextSeed: '河工后人梁岁安正在调查新愿集团的祈愿 App。',
  },
  {
    chapterNum: 5,
    title: '祈愿 App 的第一百万个愿望',
    outline: '新愿集团通过 App 收集愿望标签，把用户的真实困境转成算法愿力。陆沉潜入发布会，发现城隍、河神的名字都被商业化授权。',
    emotionTone: '都市商业压迫、信息战',
    nextSeed: '发布会现场，一个用户的愿望被算法神提前“实现”。',
  },
  {
    chapterNum: 6,
    title: '算法神第一次睁眼',
    outline: '无脸算法神在大屏上生成每个人最想听的话，现场愿力暴涨。陆沉用问账识破愿望背后的债务转移，救下被反噬的用户。',
    emotionTone: '名场面、系统反杀',
    nextSeed: '陆沉名字被新愿列入异常资产名单。',
  },
  {
    chapterNum: 7,
    title: '灶王爷不说好话',
    outline: '一条餐饮街集体遭遇差评和食品安全诬陷，灶王像嘴被金箔封住。陆沉发现新愿用外卖数据收购“口碑愿力”。',
    emotionTone: '市井烟火、口碑清算',
    nextSeed: '灶王提供线索：陆沉父亲曾查过同一批香火资产。',
  },
  {
    chapterNum: 8,
    title: '父亲留下的错账本',
    outline: '陆沉回老家翻出父亲遗物，发现一本账页顺序全错的手抄本。每一页都对应一个被新愿收购的民俗名称。',
    emotionTone: '家庭旧伤、主线加深',
    nextSeed: '错账本最后一页写着：不要替神做主。',
  },
  {
    chapterNum: 9,
    title: '天光 Mall 地下鬼市',
    outline: '姜照夜带陆沉进入地下鬼市，购买修复账页的旧墨。鬼市卖的不是商品，而是被人放弃的愿望。',
    emotionTone: '奇观探索、规则交易',
    nextSeed: '陆沉在鬼市看见父亲当年的交易记录。',
  },
  {
    chapterNum: 10,
    title: '一支朱笔，买断你的名字',
    outline: '温阙提出交易：新愿替陆沉恢复身份，陆沉交出朱笔和城隍账页。陆沉表面赴约，实则用鬼市旧墨反向标记新愿的名债。',
    emotionTone: '谈判反杀、阶段高潮',
    nextSeed: '第一卷中段转入主动清算新愿资产。',
  },
  {
    chapterNum: 11,
    title: '旧城厢万人对账',
    outline: '陆沉公开设立临时对账点，旧城厢居民带着收据、照片、口供排队。万神账本第一次出现多页共振。',
    emotionTone: '群像燃点、公共正义',
    nextSeed: '对账队伍里混入一名不该存在的死者。',
  },
  {
    chapterNum: 12,
    title: '死者来领自己的赔偿',
    outline: '一名三十七年前登记死亡的河工出现在对账现场，带来黑水河案最关键证词，也暴露新愿早期造神实验。',
    emotionTone: '悬疑反转、卷内升级',
    nextSeed: '黑水河案即将进入河底副本。',
  },
]

const volumes = [
  ['第一卷：城隍欠薪', '陆沉入职神账局，从瑞恒广场旧账切入，清掉城隍和黑水河两笔城市旧债，确认新愿集团是幕后香火资本。', 200000, 0.18],
  ['第二卷：河神断流', '黑水河旧案扩展到城市供水和河道改造，陆沉第一次面对“救人”和“清算彻底”的冲突。', 200000, 0.32],
  ['第三卷：鬼市上市', '地下鬼市被新愿资本化，愿望、名字和福报变成可交易资产，主角从被动查案转为主动做局。', 200000, 0.52],
  ['第四卷：万庙封神', '全国民俗节点陆续复苏，新愿制造算法神分身，主角需要联合旧神和普通人公开账目。', 200000, 0.74],
  ['第五卷：天庭资产清算', '万神账本源头揭开，陆沉清算父亲失踪真相和算法神总账，完成去中心化结局。', 200000, 0.95],
]

const characters = [
  {
    key: 'luchen',
    role_type: 'protagonist',
    full_name: '陆沉',
    gender: '男',
    age: 28,
    occupation: '城市资产清算中心临时核账员',
    social_identity: '前审计事务所高级助理，被瑞恒项目背锅裁员。',
    background: '出身江州市黑水河边的老家属院，父亲陆怀章曾是地方志资料员，十七年前查旧庙资产时失踪。陆沉靠审计专业把生活过得很规矩，也因此总被要求替别人“沟通”。',
    personality_traits_json: toJson(['冷静', '较真', '不轻易许诺', '对弱者有耐心', '嘴上克制但下手很准']),
    flaws_json: toJson(['过度依赖证据', '不擅长求人', '容易把个人代价压到最后']),
    goals: '查清父亲失踪和万神账本来源，替被拖欠的人和神完成清算。',
    surface_desire: '保住这份临时工作，证明自己不是事务所推出去背锅的人。',
    deep_need: '学会在证据之外承担选择，而不是永远躲在流程后面。',
    core_fear: '自己像父亲一样查到一半就从世界上消失。',
    hidden_secret: '小时候曾在黑水河边听见无脸河工叫过自己的小名。',
    moral_line: '不拿普通人的命和名字做交易。',
    dramatic_engine: '每一笔神债都逼他在“按流程清账”和“先救眼前的人”之间承担代价。',
    character_arc: '从只相信凭证的审计员，成长为敢公开规则、让普通人一起认账的万神债主。',
    speech_pattern: '短句，先问凭证和时间；情绪上来时会突然问很现实的问题。',
    catchphrases: '凭证在哪？|先救人，再算账。',
    vocabulary_level: '专业审计词和市井口语混用。',
    abilities_json: toJson(['问账', '验印', '代城隍封门', '短时借用神权']),
    appear_chapter: 1,
    sort_order: 10,
  },
  {
    key: 'jiangzhaoye',
    role_type: 'deuteragonist',
    full_name: '姜照夜',
    gender: '女',
    age: 27,
    occupation: '神账局外勤',
    social_identity: '民俗债务现场处置员，负责把失控副本压回可谈判范围。',
    background: '祖上做过庙会会首，家里保存大量仪式规矩。她相信规则，但不迷信神，见过太多人用神怪当借口逃避现实责任。',
    personality_traits_json: toJson(['利落', '警惕', '讲现场纪律', '嘴硬心软']),
    flaws_json: toJson(['不愿解释自己的旧伤', '习惯先把危险扛下来']),
    goals: '查出新愿集团收购民俗名称的完整链条，保住陆沉这个罕见的核账人。',
    surface_desire: '让陆沉活过试用期。',
    deep_need: '承认神账局内部也有错账，不能只靠压制现场维稳。',
    core_fear: '再一次因为判断迟疑导致普通人死在副本里。',
    hidden_secret: '她曾参与封存陆怀章档案，知道陆沉父亲不是普通失踪。',
    moral_line: '不能牺牲无关者换取副本稳定。',
    dramatic_engine: '她每次保护陆沉，都会被迫暴露一点自己当年参与封档的真相。',
    character_arc: '从只执行现场规程，转向帮助陆沉公开不合理规程。',
    speech_pattern: '干脆、有现场指令感，危急时先骂人再救人。',
    catchphrases: '别乱许愿。|站我后面，不是让你闭嘴。',
    vocabulary_level: '外勤术语、民俗黑话和短促日常话混用。',
    abilities_json: toJson(['桃木尺封界', '红线定位', '副本风险判断']),
    appear_chapter: 1,
    sort_order: 20,
  },
  {
    key: 'wenque',
    role_type: 'antagonist',
    full_name: '温阙',
    gender: '男',
    age: 32,
    occupation: '新愿集团法务合伙人',
    social_identity: '算法造神计划的前台操盘者，擅长用合法外衣包装香火资产收购。',
    background: '顶级法学院出身，早年做文化 IP 并购，发现民俗名称和用户愿望可以被平台化交易后，成为新愿集团核心人物。',
    personality_traits_json: toJson(['温和', '精准', '利益优先', '极少失态']),
    flaws_json: toJson(['低估普通人的记忆', '相信所有信仰都能定价']),
    goals: '把旧神名称、愿望标签和城市民俗空间全部纳入算法神的资产池。',
    surface_desire: '压下瑞恒广场事件，回收城隍账页。',
    deep_need: '证明神明只是落后的流量入口。',
    core_fear: '无法定价的公共记忆让他的商业模型崩盘。',
    hidden_secret: '他手里有陆怀章最后一次问名的录音。',
    moral_line: '不亲手杀人，但会让系统把人逼到没有路。',
    dramatic_engine: '每次法务胜利都会制造更大的民俗反噬，迫使他从商业操盘走向真正造神。',
    character_arc: '从冷静资本代理人，逐步成为算法神的人间口舌。',
    speech_pattern: '礼貌、准确，常用商业和法律词替代道德判断。',
    catchphrases: '我们只是在帮助愿望找到效率。|请注意证据来源。',
    vocabulary_level: '法律、资本和产品术语。',
    abilities_json: toJson(['合同封口', '舆论预案', '算法愿力调度']),
    appear_chapter: 2,
    sort_order: 30,
  },
  {
    key: 'liangsui',
    role_type: 'supporting',
    full_name: '梁岁安',
    gender: '女',
    age: 24,
    occupation: '短视频调查博主',
    social_identity: '黑水河河工后人，表面做城市探店，实际追查父亲家族的失踪旧案。',
    background: '外婆一直保存黑水河旧工号牌，她靠拍摄废弃空间和城市传说积累粉丝，知道哪些故事是平台故意推火的。',
    personality_traits_json: toJson(['敏锐', '胆大', '会装糊涂', '对镜头有本能判断']),
    flaws_json: toJson(['为了素材会冒险', '不完全信任机构']),
    goals: '公开三十七名河工的真实名单，找到外婆一直等的人。',
    surface_desire: '拍到能让全网看见的爆款证据。',
    deep_need: '理解记忆不是流量，而是家里等了几十年的交代。',
    core_fear: '亲人的死最终只变成一条热点视频。',
    hidden_secret: '她的账号早被新愿标记为可利用的民俗流量入口。',
    moral_line: '不剪掉受害者最想留下的话。',
    dramatic_engine: '她越会传播，越容易被算法神利用，必须学会反用镜头。',
    character_arc: '从追热点的调查博主，成长为民俗记忆的公开记录者。',
    speech_pattern: '快，带网络感，但遇到家人旧事会突然安静。',
    catchphrases: '这段别剪。|镜头开着，你继续说。',
    vocabulary_level: '网络传播语和地方口音混用。',
    abilities_json: toJson(['现场拍摄', '信息扩散', '废弃空间路线判断']),
    appear_chapter: 4,
    sort_order: 40,
  },
  {
    key: 'zhouboheng',
    role_type: 'mentor',
    full_name: '周伯衡',
    gender: '男',
    age: 51,
    occupation: '城市资产清算中心主任',
    social_identity: '神账局江州分部负责人，懂制度也懂旧神脾气。',
    background: '曾任地方志办副主任，参与过多起民俗资产封存。表面油滑，实际一直在等能翻开万神账本的人。',
    personality_traits_json: toJson(['圆滑', '老练', '怕麻烦', '关键时刻敢兜底']),
    flaws_json: toJson(['习惯压事', '总想用最小代价换稳定']),
    goals: '在城市不失控的前提下，逐步清掉新愿集团埋下的神债。',
    surface_desire: '让陆沉按流程办案，不要把分部炸了。',
    deep_need: '承认旧账已经不能再靠封存解决。',
    core_fear: '江州重演十七年前的问名事故。',
    hidden_secret: '他保存着陆怀章最后交回的一页错账。',
    moral_line: '不允许主动把普通人送进副本当诱饵。',
    dramatic_engine: '他每次选择维稳，都会被陆沉逼着多公开一点旧档案。',
    character_arc: '从守门人变成公开清算的背书者。',
    speech_pattern: '官腔里夹着市井玩笑，喜欢把危险说成小麻烦。',
    catchphrases: '流程上不行，现实上再想想。|小陆，别把楼拆了。',
    vocabulary_level: '机关话、地方志术语、老江州口语。',
    abilities_json: toJson(['档案调取', '民俗协调', '副本善后']),
    appear_chapter: 3,
    sort_order: 50,
  },
]

function buildScenePlan(chapter) {
  return toJson((chapter.scenes || [[chapter.title, chapter.outline, '江州市', '按章节冲突推进', chapter.nextSeed || '']]).map((scene, index) => ({
    scene_order: index + 1,
    scene_title: scene[0],
    purpose: scene[1],
    location: scene[2],
    conflict: scene[3],
    exit_hook: scene[4],
    present_characters: index === 0 && chapter.chapterNum === 1 ? ['陆沉'] : ['陆沉', '姜照夜'],
  })))
}

function createNovel(db, genreId, now) {
  const totalWords = chapterOutlines.reduce((sum, chapter) => sum + countHanzi(chapter.content || ''), 0)
  return insertRow(db, 'novels', {
    title: SAMPLE_TITLE,
    synopsis: blurb.shortBlurb,
    genre_id: genreId,
    launch_mode: 'professional_longform',
    status: 'writing',
    total_words: totalWords,
    target_words: TARGET_WORDS,
    user_background: '参考当前平台热门的都市玄幻、民俗志怪、规则副本和短剧名场面趋势，创建一部百万字爽文流新书样稿。',
    expanded_background: '核心差异化是“现代审计 + 神明欠薪 + 香火债务 + 算法造神”。开局先给现实欠薪和证据链，再进入城隍封门副本，降低空泛 AI 腔。',
    project_brief_json: toJson(projectBrief),
    settings_json: toJson(settings),
    theme_voice_json: toJson(themeVoice),
    world_rules_json: toJson(worldRules),
    blurb_json: toJson(blurb),
    context_version: 1,
    created_at: now,
    updated_at: now,
  })
}

function createStructure(db, novelId, now) {
  const volumeIds = new Map()
  volumes.forEach(([title, summary, targetWords, revealRatio], index) => {
    const volumeId = insertRow(db, 'story_volumes', {
      novel_id: novelId,
      volume_number: index + 1,
      title,
      summary,
      target_words: targetWords,
      max_truth_reveal_ratio: revealRatio,
      status: index === 0 ? 'active' : 'planning',
      created_at: now,
      updated_at: now,
    })
    volumeIds.set(index + 1, volumeId)
    insertRow(db, 'volume_designs', {
      novel_id: novelId,
      volume_id: volumeId,
      volume_theme: ['讨回第一笔账', '救命先于清算', '愿望不能上市', '旧神不是商品', '公开规则'][index],
      volume_promise: summary,
      main_conflict: ['城隍旧债对瑞恒和新愿法务反压', '黑水河命债对城市改造真相', '鬼市交易对算法愿力', '万庙复苏对平台造神', '账本公开对秩序代价'][index],
      climax_plan: ['旧城厢万人对账，黑水河副本入口打开', '河底名单公开，第一批河工回家', '鬼市上市失败，新愿露出算法神主体', '全国旧庙同步封门，算法神分身失控', '陆沉公开万神账本，清算父亲旧案'][index],
      end_state_shift: ['陆沉确认新愿是主敌', '陆沉从查案转向主动做局', '神账局内部旧账曝光', '全民对账不可逆', '神权去中心化'][index],
      must_add_clues_json: toJson(['红章收据', '黑水河工号', '祈愿 App 标签', '父亲错账页']),
      must_resolve_clues_json: toJson(index === 0 ? ['瑞恒三千万咨询费', '城隍 IP 代持'] : []),
      reader_expectation: '每卷必须有至少三个当众清算名场面，并在卷尾兑现一笔城市级旧债。',
      audit_status: index === 0 ? 'ready' : 'draft',
      created_at: now,
      updated_at: now,
    })
  })

  const partIds = new Map()
  const partRows = [
    [1, 1, '入职与城隍封门', '第1-20章：瑞恒广场、城隍欠薪、黑水河债出现。', 1, 20],
    [1, 2, '黑水河名单', '第21-40章：河工旧案、祈愿 App 和第一卷高潮。', 21, 40],
    [2, 1, '断流旧案', '第41-60章：河道改造与供水系统。', 41, 60],
    [2, 2, '命债回家', '第61-80章：河底副本和河工家属线。', 61, 80],
    [3, 1, '鬼市挂牌', '第81-100章：愿望交易所成形。', 81, 100],
    [3, 2, '上市失败', '第101-120章：陆沉反做局。', 101, 120],
    [4, 1, '万庙封门', '第121-145章：全国民俗节点复苏。', 121, 145],
    [4, 2, '算法分身', '第146-170章：算法神多地降临。', 146, 170],
    [5, 1, '父亲旧账', '第171-195章：陆怀章失踪真相。', 171, 195],
    [5, 2, '公开账本', '第196-220章：最终清算和去中心化结局。', 196, 220],
  ]
  partRows.forEach(([volumeNumber, partNumber, title, summary, start, end]) => {
    const id = insertRow(db, 'story_parts', {
      novel_id: novelId,
      volume_id: volumeIds.get(volumeNumber),
      part_number: partNumber,
      title,
      summary,
      target_words: Math.round(TARGET_WORDS / 10),
      status: volumeNumber === 1 && partNumber === 1 ? 'active' : 'planning',
      start_chapter_num: start,
      end_chapter_num: end,
      created_at: now,
      updated_at: now,
    })
    partIds.set(`${volumeNumber}.${partNumber}`, id)
  })

  const arcIds = new Map()
  ;[
    ['城隍欠薪清算弧', 1, 1, 20, '完成第一笔神债清算，建立问账、问名、封门三种基础规则。', '从被动入职到主动对账。'],
    ['黑水河命债弧', 2, 21, 55, '从欠款案转向命债案，逼主角把救人放在清算前面。', '黑水河名单公开。'],
    ['祈愿 App 反制弧', 3, 56, 100, '揭开新愿集团用愿望标签制造算法神的机制。', '陆沉开始反向标记新愿资产。'],
    ['鬼市愿望交易弧', 4, 101, 150, '愿望上市失败，鬼市从中立交易场转为公共证据场。', '神账局内部旧账被迫公开。'],
    ['万神总账终局弧', 5, 151, 220, '父亲失踪和万神账本源头回收，完成最终公开。', '陆沉拒绝独占账本。'],
  ].forEach(([name, order, start, end, goal, summary]) => {
    const id = insertRow(db, 'story_arcs', {
      novel_id: novelId,
      arc_name: name,
      arc_order: order,
      chapter_start: start,
      chapter_end: end,
      arc_goal: goal,
      arc_summary: summary,
      growth_ledger: order === 1 ? '陆沉获得问账、问名，付出身份异常和失眠代价。' : '每卷新增一种清算能力，同时留下现实代价。',
      cost_ledger: order === 1 ? '第一次问名导致身份信息短暂空白；城隍残印消耗。' : '代价随神权扩大而转向社会关系和公共秩序。',
      phase_targets_json: toJson(['开局钩子', '证据链', '规则反转', '当众清算', '代价回收']),
      target_words: order === 1 ? 90000 : 180000,
      progress_percent: order === 1 ? 10 : 0,
      stalled_chapter_count: 0,
      last_progress_chapter_num: order === 1 ? 2 : null,
    })
    arcIds.set(order, id)
  })

  return { volumeIds, partIds, arcIds }
}

function createCharactersAndFactions(db, novelId, now) {
  const characterIds = new Map()
  characters.forEach((character) => {
    const id = insertRow(db, 'characters', {
      novel_id: novelId,
      role_type: character.role_type,
      record_status: 'confirmed',
      entity_type: 'human',
      full_name: character.full_name,
      gender: character.gender,
      age: character.age,
      occupation: character.occupation,
      social_identity: character.social_identity,
      background: character.background,
      personality_traits_json: character.personality_traits_json,
      flaws_json: character.flaws_json,
      habits_json: toJson([]),
      goals: character.goals,
      surface_desire: character.surface_desire,
      deep_need: character.deep_need,
      core_fear: character.core_fear,
      hidden_secret: character.hidden_secret,
      moral_line: character.moral_line,
      dramatic_engine: character.dramatic_engine,
      character_arc: character.character_arc,
      speech_pattern: character.speech_pattern,
      catchphrases: character.catchphrases,
      vocabulary_level: character.vocabulary_level,
      abilities_json: character.abilities_json,
      source_context_json: toJson({ sampleKey: SAMPLE_KEY, source: 'manual-seed' }),
      appear_chapter: character.appear_chapter,
      sort_order: character.sort_order,
      created_at: now,
      updated_at: now,
    })
    characterIds.set(character.key, id)
  })

  const factionRows = [
    ['神账局江州分部', 'agency', '控制民俗债务现场，避免副本伤及普通人，同时逐步清理旧账。', '档案库、外勤符具、地方志、人脉协调权。', characterIds.get('zhouboheng'), '小心吸纳能核账的人，不公开招募。', '瑞恒广场案后进入被动公开阶段'],
    ['新愿集团', 'corporation', '收购民俗名称、愿望标签和香火入口，制造可商业化的算法神。', '祈愿 App、法务团队、公关矩阵、商业庙会授权。', characterIds.get('wenque'), '用高薪、授权、数据合作绑定成员。', '瑞恒广场事件暴露前台资产'],
    ['旧城民俗会', 'community', '保存地方民俗、庙产旧契和口述证词，帮助普通人对账。', '老人证词、旧照片、庙会账本、非遗匠人。', null, '熟人互保，信任慢但记账细。', '等待神账局证明自己不是来封口'],
    ['江州无名旧神', 'deity-network', '讨回被拖欠的香火、名字和愿望，不再被商业活动借名。', '城隍残印、河工名册、灶王口供、门神边界。', null, '只认账，不认平台授权。', '城隍率先翻开账页'],
  ]
  const factionIds = new Map()
  factionRows.forEach(([name, type, goal, resources, leader, memberPolicy, phase], index) => {
    factionIds.set(name, insertRow(db, 'factions', {
      novel_id: novelId,
      name,
      type,
      goal,
      resources,
      leader_character_id: leader,
      member_policy: memberPolicy,
      current_phase: phase,
      external_relations_json: toJson([]),
      notes: '新样稿核心阵营。',
      sort_order: (index + 1) * 10,
      created_at: now,
      updated_at: now,
    }))
  })

  updateRow(db, 'characters', characterIds.get('luchen'), { camp_faction_ids_json: toJson([factionIds.get('神账局江州分部')]), updated_at: now })
  updateRow(db, 'characters', characterIds.get('jiangzhaoye'), { camp_faction_ids_json: toJson([factionIds.get('神账局江州分部')]), updated_at: now })
  updateRow(db, 'characters', characterIds.get('wenque'), { camp_faction_ids_json: toJson([factionIds.get('新愿集团')]), updated_at: now })
  updateRow(db, 'characters', characterIds.get('liangsui'), { camp_faction_ids_json: toJson([factionIds.get('旧城民俗会')]), updated_at: now })
  updateRow(db, 'characters', characterIds.get('zhouboheng'), { camp_faction_ids_json: toJson([factionIds.get('神账局江州分部')]), updated_at: now })

  const relationRows = [
    ['luchen', 'jiangzhaoye', 'partner', '试用期搭档', 55, 65, '她负责把他从副本里捞出来，他负责把她不愿公开的旧账问出来。'],
    ['luchen', 'wenque', 'enemy', '核账人与法务资本', 5, 90, '温阙每次用合法外衣压证据，都会刺激陆沉寻找可公开的硬凭证。'],
    ['luchen', 'zhouboheng', 'mentor', '主任与临时工', 45, 50, '周伯衡想控节奏，陆沉总把旧账翻得更大。'],
    ['luchen', 'liangsui', 'ally', '证据与镜头', 35, 35, '陆沉提供证据链，梁岁安提供传播和民间证词。'],
  ]
  relationRows.forEach(([a, b, type, label, intimacy, tension, description]) => {
    insertRow(db, 'character_relations', {
      novel_id: novelId,
      char_a_id: characterIds.get(a),
      char_b_id: characterIds.get(b),
      relation_type: type,
      relation_label: label,
      bilateral: 1,
      description,
      intimacy_level: intimacy,
      tension_level: tension,
      interaction_style: '以具体目标和证据冲突推动关系，不用空泛互相欣赏。',
      subtext_rule: '对白里保留没说出口的旧账和风险。',
    })
  })

  ;[
    ['luchen', 'jiangzhaoye', '试用期搭档', 'partner', '一个只信凭证，一个只信现场规程，合作从互相防备开始。', '陆沉追问父亲封档，姜照夜必须选择继续隐瞒还是交出旧案入口。', '两人把“保护现场”和“公开旧账”合成同一套行动准则。'],
    ['luchen', 'wenque', '核账人与法务资本', 'enemy', '温阙把陆沉当成可回收的异常资产，陆沉把温阙当成第一条能追到算法神的资金线。', '温阙拿陆沉的身份稳定度做交易，逼他在保住自己和公开证据之间选择。', '陆沉公开温阙无法定价的公共记忆，破坏算法神的名称垄断。'],
    ['luchen', 'zhouboheng', '主任与临时工', 'mentor', '周伯衡想控风险，陆沉想把账问到底。', '陆沉发现周伯衡保存父亲错账页，信任出现裂缝。', '周伯衡从守门人转成公开清算的制度背书者。'],
  ].forEach(([a, b, label, type, startState, crackPoint, endState]) => {
    insertRow(db, 'relationship_arcs', {
      novel_id: novelId,
      char_a_id: characterIds.get(a),
      char_b_id: characterIds.get(b),
      relation_label_snapshot: label,
      relation_type_snapshot: type,
      start_state: startState,
      crack_point: crackPoint,
      change_event: '通过第一卷连续清算和信息公开推进关系变化。',
      end_state: endState,
      current_status: 'active',
      stalled_reason: '',
      notes: '样稿关系弧。',
      created_at: now,
      updated_at: now,
    })
  })

  characters.forEach((character) => {
    const characterId = characterIds.get(character.key)
    const arcId = insertRow(db, 'character_arcs', {
      novel_id: novelId,
      character_id: characterId,
      start_state: character.surface_desire,
      surface_want: character.surface_desire,
      deep_need: character.deep_need,
      core_fear: character.core_fear,
      misbelief: character.role_type === 'antagonist' ? '所有愿望都能被效率定价。' : '只要流程正确，就能避免承担选择。',
      first_crack_chapter_id: null,
      change_event: character.character_arc,
      end_state: character.role_type === 'antagonist' ? '被公开账本证明无法定价公共记忆。' : '愿意公开旧账并承担代价。',
      current_status: 'active',
      notes: '样稿人物成长弧。',
      created_at: now,
      updated_at: now,
    })
    insertRow(db, 'character_arc_beats', {
      novel_id: novelId,
      arc_id: arcId,
      beat_type: 'setup',
      title: `${character.full_name} 开局状态`,
      summary: character.dramatic_engine,
      status: 'planned',
      sort_order: character.sort_order,
      created_at: now,
      updated_at: now,
    })
  })

  return { characterIds, factionIds }
}

function createResistanceSystem(db, novelId, structure, refs, chapters, now) {
  const trackRows = [
    {
      sourceType: 'character',
      sourceId: refs.characterIds.get('wenque'),
      resistanceKind: 'antagonist',
      title: '温阙法务与舆论反压',
      goal: '把瑞恒广场事件定义成非法取证和恶意闹事，逼陆沉交出城隍账页。',
      intelSource: '公告、公证员、法务函和祈愿 App 后台。',
      resourcePool: '新愿法务团队、公关矩阵、商业授权合同。',
      escalationPlan: '先压传播，再收买证人，最后用身份稳定度威胁陆沉。',
      heroKnowledgeShift: '陆沉意识到神债不只在旧庙，也藏在名称授权和平台合同里。',
      stageVictory: '陆沉问名拿到录音，暂时打断公关稿。',
      counterMove: '温阙触发黑水河命债转移现场压力。',
      currentPressureMode: '法律反压 + 舆论封锁',
      currentStatus: 'active',
      lastActionChapterId: chapters.chapterIds.get(2),
      nextEscalationChapterId: chapters.chapterIds.get(5),
      linkedVolumeId: structure.volumeIds.get(1),
      notes: '第一卷核心人形阻力。',
      beats: [
        ['entry', chapters.chapterIds.get(2), '温阙带法务入场', '以非法取证、公关公告和商业机密压制现场证据。', 'legal-pressure', 'partial-fail', '问名录音反杀。'],
      ],
    },
    {
      sourceType: 'faction',
      sourceId: refs.factionIds.get('新愿集团'),
      resistanceKind: 'systemic',
      title: '新愿集团算法造神资产链',
      goal: '把旧神名称、用户愿望和民俗空间全部资产化，制造无脸算法神。',
      intelSource: '祈愿 App、商业庙会合同、愿望标签和授权费流向。',
      resourcePool: '资本、数据、短视频流量、城市商业改造项目。',
      escalationPlan: '从瑞恒广场单案扩展到全城民俗 IP 代持，再到全国多地算法神分身。',
      heroKnowledgeShift: '陆沉从查单笔欠款升级为追踪名称权属和愿力流向。',
      stageVictory: '第一卷末破坏江州城隍 IP 代持链。',
      counterMove: '新愿转入鬼市愿望交易。',
      currentPressureMode: '资产链压迫',
      currentStatus: 'active',
      lastActionChapterId: chapters.chapterIds.get(2),
      nextEscalationChapterId: chapters.chapterIds.get(6),
      linkedVolumeId: structure.volumeIds.get(1),
      notes: '全书主反派系统。',
      beats: [
        ['setup', chapters.chapterIds.get(2), '城隍 IP 代持暴露', '第二章录音证明新愿参与城隍名称商业化。', 'asset-chain', 'damaged', '新愿改用黑水河债转移注意。'],
      ],
    },
    {
      sourceType: 'environment',
      sourceId: refs.mapIds.get('黑水河旧闸'),
      resistanceKind: 'environment',
      title: '黑水河命债倒灌',
      goal: '逼所有欠命债的人面对三十七名河工名单，先救人再清算。',
      intelSource: '旧闸水痕、河工照片、工号牌和倒灌黑水。',
      resourcePool: '水位、旧闸、河工无名怨气、被删改的工程档案。',
      escalationPlan: '从瑞恒广场电梯井倒灌，升级到旧闸副本和河底名单。',
      heroKnowledgeShift: '陆沉确认清算不能只追钱，命债必须先还名。',
      stageVictory: '主角先救出无关商户，保住第一案证人。',
      counterMove: '名单不全时黑水继续追人。',
      currentPressureMode: '环境副本压力',
      currentStatus: 'active',
      lastActionChapterId: chapters.chapterIds.get(2),
      nextEscalationChapterId: chapters.chapterIds.get(3),
      linkedVolumeId: structure.volumeIds.get(1),
      notes: '第二案环境阻力。',
      beats: [
        ['escalation', chapters.chapterIds.get(2), '电梯井黑水出现', '黑水河债页翻开，利息按命算。', 'environmental-threat', 'success', '陆沉改成先疏散人群。'],
      ],
    },
  ]

  trackRows.forEach((track, index) => {
    const trackId = insertRow(db, 'resistance_tracks', {
      novel_id: novelId,
      source_type: track.sourceType,
      source_id: track.sourceId,
      resistance_kind: track.resistanceKind,
      title: track.title,
      goal: track.goal,
      intel_source: track.intelSource,
      resource_pool: track.resourcePool,
      escalation_plan: track.escalationPlan,
      hero_knowledge_shift: track.heroKnowledgeShift,
      stage_victory: track.stageVictory,
      counter_move: track.counterMove,
      current_pressure_mode: track.currentPressureMode,
      current_status: track.currentStatus,
      last_action_chapter_id: track.lastActionChapterId,
      next_escalation_chapter_id: track.nextEscalationChapterId,
      linked_volume_id: track.linkedVolumeId,
      notes: track.notes,
      created_at: now,
      updated_at: now,
    })

    track.beats.forEach(([beatType, chapterId, title, summary, actionMode, successLevel, counterResponse], beatIndex) => {
      insertRow(db, 'resistance_beats', {
        novel_id: novelId,
        track_id: trackId,
        beat_type: beatType,
        chapter_id: chapterId,
        title,
        summary,
        action_mode: actionMode,
        success_level: successLevel,
        counter_response: counterResponse,
        protagonist_impact: beatType === 'escalation' ? '陆沉必须先救人再算账。' : '陆沉确认现实反压和神债必须一起处理。',
        status: 'logged',
        sort_order: (index + 1) * 10 + beatIndex,
        created_at: now,
        updated_at: now,
      })
    })
  })
}

function createMapItemsAndThreads(db, novelId, refs, structure, now) {
  const { characterIds, factionIds } = refs
  const mapIds = new Map()
  const cityId = insertRow(db, 'world_map', {
    novel_id: novelId,
    level: 1,
    name: '江州市',
    location_type: '现代城市',
    node_type: 'city',
    structure_role: '主舞台',
    description: '新一线城市，旧城厢、黑水河和高新区互相挤压。传统民俗空间被商业化包装，香火债务集中爆发。',
    atmosphere: '雨水、霓虹、旧庙灰和商业屏幕并存。',
    plot_relevance: '全书第一阶段所有神债都从江州市旧资产清算开始。',
    key_events_json: toJson(['陆沉入职', '城隍封门', '黑水倒灌', '万人对账']),
    tags_json: toJson(['主城', '民俗复苏', '商业改造']),
    danger_level: '中高',
    sort_order: 10,
  })
  mapIds.set('江州市', cityId)
  ;[
    ['旧城厢', '老街区', '第一卷核心区域，旧城隍庙遗址、清算中心分部和老商户集中在这里。', '潮湿、拥挤、烟火气重', '城隍欠薪和万人对账发生地', ['城隍欠薪', '旧商户', '对账点'], 'high'],
    ['城市资产清算中心旧城厢分部', '机构据点', '夹在修鞋摊和烧饼铺之间的窄门面，地下三层是神账局档案库。', '旧纸、潮木头、红章味', '主角据点和任务领取点', ['神账局', '档案库'], 'medium'],
    ['瑞恒广场负一层', '烂尾商业体', '原计划打造民俗商业街，实际堆着旧庙构件和被拖欠补偿的商户档案。', '停运电梯、发霉灯笼、暗红消防灯', '第一笔城隍债副本入口', ['城隍封门', '瑞恒', '副本'], 'high'],
    ['黑水河旧闸', '河道遗址', '三十七年前改造工程事故核心地点，河工名单被藏在旧闸水泥层里。', '黑水、铁锈、旧工号牌', '第二笔河神命债核心地', ['河神', '命债', '旧案'], 'critical'],
    ['天光 Mall 地下鬼市', '隐藏交易场', '白天是商场地下仓库，午夜后交易被放弃的愿望、旧名和香火碎片。', '冷白灯、塑料布、旧愿望标签', '第三卷愿望交易线核心舞台', ['鬼市', '愿望交易'], 'high'],
    ['新愿集团江州总部', '企业总部', '高新区玻璃楼，祈愿 App、法务、公关和算法神训练中心都在这里。', '干净、无味、屏幕过亮', '反派主基地', ['新愿', '算法神', '资本'], 'high'],
  ].forEach(([name, type, description, atmosphere, plot, tags, danger], index) => {
    const id = insertRow(db, 'world_map', {
      novel_id: novelId,
      level: 2,
      parent_id: cityId,
      name,
      location_type: type,
      node_type: index <= 2 ? 'location' : 'dungeon',
      structure_role: index <= 2 ? '开局舞台' : '中期舞台',
      description,
      atmosphere,
      plot_relevance: plot,
      key_events_json: toJson([]),
      related_characters_json: toJson(['陆沉', '姜照夜']),
      tags_json: toJson(tags),
      affiliated_faction_ids_json: name.includes('新愿') ? toJson([factionIds.get('新愿集团')]) : null,
      danger_level: danger,
      sort_order: (index + 1) * 10,
    })
    mapIds.set(name, id)
  })

  const relationRows = [
    ['城市资产清算中心旧城厢分部', '瑞恒广场负一层', '任务地点', '神账局第一案直达现场'],
    ['瑞恒广场负一层', '黑水河旧闸', '债务牵连', '瑞恒改造款牵出黑水河旧工程'],
    ['旧城厢', '天光 Mall 地下鬼市', '午夜入口', '旧城愿望会流向地下交易场'],
    ['新愿集团江州总部', '天光 Mall 地下鬼市', '资本控制', '新愿试图把鬼市愿望挂牌交易'],
  ]
  relationRows.forEach(([a, b, type, label]) => {
    insertRow(db, 'map_relations', {
      novel_id: novelId,
      map_a_id: mapIds.get(a),
      map_b_id: mapIds.get(b),
      relation_type: type,
      relation_label: label,
      bilateral: 1,
      description: label,
      intensity: 'strong',
      color_hint: '#0f766e',
      sort_order: 10,
    })
  })

  const itemIds = new Map()
  ;[
    ['万神账本', 'artifact', 'ledger', 'legendary', characterIds.get('luchen'), mapIds.get('瑞恒广场负一层'), '记录愿债、香火债、命债和名债的旧账本，只在证据链成立时翻页。', '清账积累可借神权，问账问名都从账页触发。', '每问一次都要支付身份、记忆或身体代价。', ['账本', '核心能力']],
    ['核账朱笔', 'artifact', 'tool', 'rare', characterIds.get('luchen'), mapIds.get('瑞恒广场负一层'), '暗红木杆的旧朱笔，能在账册上落印。', '写下问账、问名、封门等动作。', '笔漆剥落代表可用次数和主角状态下降。', ['朱笔', '神权']],
    ['城隍残印', 'relic', 'seal', 'rare', null, mapIds.get('瑞恒广场负一层'), '旧城隍庙被拆后留下的残印，章边缺一角。', '可短时封门，保护现场证据。', '只能保护欠债现场，不能主动攻击无关者。', ['城隍', '封门']],
    ['黑水河工号牌', 'clue', 'evidence', 'uncommon', null, mapIds.get('黑水河旧闸'), '三十七年前河工佩戴的铁牌，号码被水锈盖住。', '拼出死亡名单，打开河神命债。', '名单不全时会引发黑水追人。', ['河神', '名单']],
    ['祈愿 App 愿望标签', 'digital', 'data', 'uncommon', null, mapIds.get('新愿集团江州总部'), '新愿集团把用户愿望拆成可交易标签的后台数据。', '证明算法神造神链条。', '标签越完整，用户越容易被反向操控。', ['算法神', '新愿']],
  ].forEach(([name, kind, category, rarity, owner, location, summary, usage, risk, tags], index) => {
    const id = insertRow(db, 'story_items', {
      novel_id: novelId,
      item_kind: kind,
      item_name: name,
      genre_family: 'urban-folk-fantasy',
      category,
      rarity,
      record_status: 'confirmed',
      owner_character_id: owner,
      location_map_id: location,
      status: index <= 2 ? 'active' : 'planned',
      summary,
      acquisition_method: index <= 2 ? '瑞恒广场城隍账副本获得' : '后续案件发现',
      usage_method: usage,
      cost: risk,
      risk,
      plot_function: usage,
      ability_spec: usage,
      limitations: risk,
      linked_character_ids_json: toJson([characterIds.get('luchen')]),
      tags_json: toJson(tags),
      source_context_json: toJson({ sampleKey: SAMPLE_KEY }),
      sort_order: (index + 1) * 10,
      created_at: now,
      updated_at: now,
    })
    itemIds.set(name, id)
  })

  const threadIds = new Map()
  ;[
    ['main', '万神账本到底从何而来', '陆沉手里的账本为何会选择他，和父亲陆怀章失踪有什么关系。', 1, 210, [characterIds.get('luchen'), characterIds.get('zhouboheng')], [itemIds.get('万神账本')]],
    ['subplot', '新愿集团算法造神计划', '新愿把民俗名称和用户愿望转成平台资产，逐步制造无脸算法神。', 2, 180, [characterIds.get('wenque')], [itemIds.get('祈愿 App 愿望标签')]],
    ['case', '瑞恒广场城隍欠薪案', '第一案：旧城隍庙修缮款、商户补偿尾款和城隍 IP 被挪用。', 1, 18, [characterIds.get('luchen'), characterIds.get('jiangzhaoye'), characterIds.get('wenque')], [itemIds.get('城隍残印')]],
    ['case', '黑水河三十七名河工命债', '第二案：河道改造事故死亡名单被抹掉，河神要求先救人再还名。', 2, 42, [characterIds.get('luchen'), characterIds.get('liangsui')], [itemIds.get('黑水河工号牌')]],
    ['relationship', '陆沉与姜照夜互相隐瞒的旧账', '两人合作越深，姜照夜越难隐瞒陆怀章封档真相。', 1, 120, [characterIds.get('luchen'), characterIds.get('jiangzhaoye')], []],
  ].forEach(([type, title, summary, start, payoff, relatedChars, relatedItems], index) => {
    const id = insertRow(db, 'story_threads', {
      novel_id: novelId,
      thread_type: type,
      title,
      summary,
      premise: summary,
      status: index <= 2 ? 'active' : 'planned',
      priority: index <= 1 ? 'high' : 'medium',
      start_chapter: start,
      target_payoff_chapter: payoff,
      payoff_condition: '必须通过证据链、民俗规则和现实执行三线回收。',
      current_state: index <= 2 ? '已在前两章启动。' : '待后续章节启动。',
      planted_chapter: start,
      last_referenced_chapter: index <= 2 ? 2 : null,
      reminder_interval: 8,
      related_character_ids_json: toJson(relatedChars.filter(Boolean)),
      related_item_ids_json: toJson(relatedItems.filter(Boolean)),
      typed_refs_json: toJson({ characters: relatedChars.filter(Boolean), items: relatedItems.filter(Boolean) }),
      notes: '样稿核心线索。',
      sort_order: (index + 1) * 10,
      created_at: now,
      updated_at: now,
    })
    threadIds.set(title, id)
  })

  return { mapIds, itemIds, threadIds }
}

function createChapters(db, novelId, structure, refs, now) {
  const chapterIds = new Map()
  const segmentIds = new Map()
  const firstVolumeId = structure.volumeIds.get(1)
  const firstPartId = structure.partIds.get('1.1')
  const firstArcId = structure.arcIds.get(1)

  chapterOutlines.forEach((chapter) => {
    const content = chapter.content || ''
    const wordCount = countHanzi(content)
    const chapterId = insertRow(db, 'chapters', {
      novel_id: novelId,
      volume_id: firstVolumeId,
      part_id: firstPartId,
      chapter_num: chapter.chapterNum,
      title: chapter.title,
      outline: chapter.outline,
      scene_plan_json: buildScenePlan(chapter),
      content,
      word_count: wordCount,
      summary: chapter.content ? chapter.outline : '',
      next_chapter_seed: chapter.nextSeed || '',
      bridge_plan_json: toJson({ in: chapter.chapterNum === 1 ? '开局直接入职' : '承接上一章钩子', out: chapter.nextSeed || '' }),
      continuity_state_json: toJson({ activeThreads: ['城隍欠薪', '新愿集团', '万神账本'], latestState: chapter.outline }),
      status: chapter.content ? 'draft' : 'outline',
      arc_id: firstArcId,
      target_words: chapter.chapterNum <= 2 ? 3200 : 2600,
      emotion_tone: chapter.emotionTone,
      compiled_from_segments: 0,
      segment_count: (chapter.scenes || []).length || 1,
      quality_scores_json: toJson({ humanFlavor: chapter.content ? 82 : null, aiClicheRisk: chapter.content ? 'low-medium' : 'not-generated' }),
      allowed_fact_ids_json: '[]',
      revealed_fact_ids_json: '[]',
      contract_audit_json: toJson({ status: 'ready', notes: '样稿手写章节，后续可用合同驱动续写。' }),
      writeback_status_json: toJson({ phase: 'idle', retryCount: 0, blockedGeneration: false, readyForNextChapter: true, contextVersion: 1, updatedAt: now }),
      context_version: 1,
      stale_reason_json: '[]',
      created_at: now,
      updated_at: now,
    })
    chapterIds.set(chapter.chapterNum, chapterId)

    if (content) {
      insertRow(db, 'chapter_versions', {
        novel_id: novelId,
        chapter_id: chapterId,
        version_source: 'manual-sample-seed',
        content,
        word_count: wordCount,
        created_at: now,
      })
    }

    const scenePlan = JSON.parse(buildScenePlan(chapter))
    scenePlan.forEach((scene, index) => {
      const segmentId = insertRow(db, 'chapter_segments', {
        novel_id: novelId,
        chapter_id: chapterId,
        volume_id: firstVolumeId,
        part_id: firstPartId,
        segment_order: index + 1,
        title: scene.scene_title,
        segment_type: 'scene',
        purpose: scene.purpose,
        time_anchor: `第${chapter.chapterNum}章`,
        location_name: scene.location,
        present_character_ids_json: toJson([refs.characterIds.get('luchen'), refs.characterIds.get('jiangzhaoye')].filter(Boolean)),
        linked_item_ids_json: toJson([refs.itemIds.get('万神账本'), refs.itemIds.get('核账朱笔')].filter(Boolean)),
        input_state: index === 0 ? '章节开场' : '承接上一场',
        output_state: scene.exit_hook || chapter.nextSeed || '',
        summary: scene.purpose,
        content: '',
        risk_tags_json: toJson(['现实证据', '民俗规则']),
        status: chapter.content ? 'draft' : 'planned',
        created_at: now,
        updated_at: now,
      })
      segmentIds.set(`${chapter.chapterNum}.${index + 1}`, segmentId)
      insertRow(db, 'scene_contracts', {
        novel_id: novelId,
        chapter_id: chapterId,
        segment_id: segmentId,
        pov: '第三人称有限视角-陆沉',
        time_location: `${scene.location} / ${scene.time_anchor || `第${chapter.chapterNum}章`}`,
        scene_goal: scene.purpose,
        obstacle: scene.conflict,
        conflict_type: '证据链与民俗规则双冲突',
        emotion_shift: chapter.emotionTone,
        reveal_payload_json: toJson([scene.exit_hook || chapter.nextSeed || '']),
        result_state: scene.exit_hook || chapter.nextSeed || '',
        linkage_mode: index === scenePlan.length - 1 ? 'chapter-hook' : 'scene-bridge',
        required_endgame_commitment_ids_json: '[]',
        required_foreshadow_ids_json: '[]',
        status: 'ready',
        created_at: now,
        updated_at: now,
      })
    })

    insertRow(db, 'chapter_contracts', {
      novel_id: novelId,
      chapter_id: chapterId,
      chapter_goal: chapter.outline,
      opening_style: chapter.chapterNum === 1 ? '直接从裁员和入职短信切入，不铺长设定。' : '承接上一章钩子，先处理现场后解释规则。',
      ending_style: chapter.nextSeed || '留下下一章强钩子。',
      exposition_mode: '通过账册、收据、录音、现场阻力展示设定，禁止大段解释。',
      emotion_focus: chapter.emotionTone,
      served_thread_ids_json: toJson([refs.threadIds.get('瑞恒广场城隍欠薪案'), refs.threadIds.get('新愿集团算法造神计划')].filter(Boolean)),
      required_arc_progress_json: toJson([{ arcId: firstArcId, progress: chapter.chapterNum <= 2 ? '启动第一案并引出新愿集团' : '继续第一卷清算' }]),
      required_character_arc_ids_json: '[]',
      required_relationship_arc_ids_json: '[]',
      required_resistance_track_ids_json: '[]',
      required_resistance_actions_json: '[]',
      required_asset_refs_json: toJson([{ type: 'item', id: refs.itemIds.get('万神账本'), name: '万神账本' }]),
      required_endgame_commitment_ids_json: '[]',
      required_foreshadow_ids_json: '[]',
      hook_type: chapter.chapterNum <= 2 ? 'strong-cliffhanger' : 'case-chain',
      forbidden_actions_json: toJson(settings.writingRules.bannedTerms.split('、')),
      acceptance_notes_json: toJson([
        '必须先给现实委屈，再给超自然反转。',
        '每个爽点必须有可见证据。',
        '对白保持身份差异，不写成同一种旁白腔。',
      ]),
      status: 'ready',
      created_at: now,
      updated_at: now,
    })
  })

  return { chapterIds, segmentIds }
}

function createMemoryAndPayoffs(db, novelId, structure, refs, chapters, now) {
  const firstVolumeId = structure.volumeIds.get(1)
  const factRows = [
    ['clue', '瑞恒三千万咨询费去向', '瑞恒把历史文化配套费用拆到陈启明私人公司，导致商户补偿和城隍修缮款长期拖欠。', 'introduced', chapters.chapterIds.get(1), chapters.chapterIds.get(1), 1],
    ['rule', '问账必须有凭证', '万神账本只在现实证据和民俗规则同时成立时翻页，无法凭空审判。', 'introduced', chapters.chapterIds.get(1), chapters.chapterIds.get(1), 1],
    ['rule', '问名会抵押身份', '追查名称所有权时，核账人的现实身份信息会短暂失真。', 'introduced', chapters.chapterIds.get(2), chapters.chapterIds.get(2), 1],
    ['truth', '新愿代持城隍 IP', '新愿集团把江州城隍包装为国潮活动和祈愿 App 入口，截走名称和香火收益。', 'introduced', chapters.chapterIds.get(2), chapters.chapterIds.get(2), 1],
    ['clue', '黑水河三十七名河工', '黑水河改造工程死亡名单被抹掉，河神债务按命计算利息。', 'planned', null, null, 1],
  ]
  const factIds = []
  factRows.forEach(([kind, title, summary, status, readerKnown, protagonistKnown, revealVolume], index) => {
    factIds.push(insertRow(db, 'story_facts', {
      novel_id: novelId,
      volume_id: firstVolumeId,
      kind,
      title,
      summary,
      status,
      reader_known_chapter_id: readerKnown,
      protagonist_known_chapter_id: protagonistKnown,
      character_knowledge_json: toJson([{ characterId: refs.characterIds.get('luchen'), state: status === 'introduced' ? 'known' : 'unknown' }]),
      planned_reveal_volume: revealVolume,
      is_key_truth: 1,
      notes: '样稿事实卡。',
      created_at: now,
      updated_at: now,
    }))
  })

  const commitmentIds = new Map()
  ;[
    ['promise', '第一笔账必须讨回普通人的钱', '第一章陆沉明确“先收欠普通人的”，卷内必须兑现商户和工人工资清算。', 1, '陆沉说“先收欠普通人的”。', 18],
    ['mystery', '陆沉父亲为何失踪', '父亲陆怀章与万神账本和神账局封档有关，必须在终局前完整回收。', 2, '陆沉父亲曾查旧庙资产时失踪。', 190],
    ['antagonist', '新愿算法神会真正成形', '温阙不是普通法务，他代表算法造神计划，必须在中后期成为世界级压力。', 3, '温阙入场并封锁现场。', 160],
  ].forEach(([kind, title, description, order, source, target]) => {
    const id = insertRow(db, 'endgame_commitments', {
      novel_id: novelId,
      commitment_kind: kind,
      title,
      description,
      source_order: order,
      source_text: source,
      status: 'active',
      target_resolution_chapter: target,
      last_served_chapter: order === 1 ? 2 : null,
      notes: '样稿终局承诺。',
      created_at: now,
      updated_at: now,
    })
    commitmentIds.set(title, id)
  })

  ;[
    ['红章“已欠”', '第一章收据右下角的“已欠”红章，是万神账本判断旧债的外显符号。', chapters.chapterIds.get(1), '细节物件', 'medium', 18, '商户尾款兑现时红章变为“已偿”。', refs.threadIds.get('瑞恒广场城隍欠薪案'), commitmentIds.get('第一笔账必须讨回普通人的钱')],
    ['电梯井黑水', '第二章末电梯井涌出的黑水预告黑水河命债。', chapters.chapterIds.get(2), '场景异象', 'high', 35, '河底副本打开，三十七名河工名单浮出。', refs.threadIds.get('黑水河三十七名河工命债'), null],
    ['身份栏空白', '第二章问名后陆沉手机 App 的姓名栏短暂空白，预告父亲当年也被抵押过名字。', chapters.chapterIds.get(2), '现实系统异常', 'medium', 170, '陆怀章失踪真相回收。', refs.threadIds.get('万神账本到底从何而来'), commitmentIds.get('陆沉父亲为何失踪')],
  ].forEach(([title, detail, sourceChapter, plant, salience, payoff, method, threadId, commitmentId]) => {
    insertRow(db, 'foreshadow_ledger', {
      novel_id: novelId,
      title,
      detail,
      source_chapter_id: sourceChapter,
      plant_method: plant,
      salience_level: salience,
      target_payoff_chapter: payoff,
      payoff_method: method,
      payoff_scene_action: method,
      required_evidence: '必须用已出现的账册、录音、照片或名单回收。',
      reader_visible_outcome: method,
      allowed_delay_reason: '只有当现实证据链不完整时允许延后。',
      impact_scope: 'global',
      status: 'active',
      linked_thread_id: threadId,
      linked_endgame_commitment_id: commitmentId,
      linked_volume_id: firstVolumeId,
      created_at: now,
      updated_at: now,
    })
  })

  insertRow(db, 'story_memory_checkpoints', {
    novel_id: novelId,
    scope_type: 'novel',
    label: '样稿开局记忆',
    summary: '前两章完成陆沉入职、城隍封门问账、温阙入场、问名代价和黑水河新案钩子。',
    resolved_threads_json: toJson([]),
    active_threads_json: toJson([...refs.threadIds.entries()].map(([title, id]) => ({ id, title }))),
    character_cards_json: toJson([...refs.characterIds.entries()].map(([key, id]) => ({ id, key }))),
    item_cards_json: toJson([...refs.itemIds.entries()].map(([name, id]) => ({ id, name }))),
    timeline_cards_json: toJson([]),
    thread_cards_json: toJson([...refs.threadIds.entries()].map(([title, id]) => ({ id, title }))),
    character_state_digest: '陆沉获得问账和问名，身份开始出现异常；姜照夜确认他是账本选择的人；温阙把他列为异常资产。',
    item_digest: '万神账本、核账朱笔、城隍残印已出场；黑水河工号牌和祈愿 App 标签待出场。',
    timeline_digest: '瑞恒广场案启动，黑水河案被触发。',
    forbidden_directions_json: toJson(['不要让神明无凭证直接惩罚所有人', '不要让温阙脸谱化暴怒', '不要跳过普通人取证流程']),
    style_guard: themeVoice.styleRules,
    source_range_start: 1,
    source_range_end: 2,
    version: 1,
    stale: 0,
    last_refreshed_chapter_num: 2,
    locked: 0,
    created_at: now,
    updated_at: now,
  })

  return { factIds, commitmentIds }
}

function createTimelineGrowthAndGlossary(db, novelId, structure, refs, chapters, now) {
  const firstVolumeId = structure.volumeIds.get(1)
  const firstPartId = structure.partIds.get('1.1')
  const timelineRows = [
    ['陆沉被裁并收到神账局 Offer', '瑞恒审计底稿导致陆沉被推出背锅，他收到旧城厢夜班入职短信。', '2028-雨夜-22:00', 1, chapters.chapterIds.get(1), refs.mapIds.get('旧城厢'), ['luchen'], ['万神账本']],
    ['瑞恒广场城隍封门', '城隍账册翻页，陈启明藏匿的三千万咨询费凭证被问账逼出。', '2028-瑞恒广场-23:50', 2, chapters.chapterIds.get(1), refs.mapIds.get('瑞恒广场负一层'), ['luchen', 'jiangzhaoye', 'wenque'], ['城隍残印']],
    ['温阙带法务入场', '新愿集团以非法取证和舆论公告反压现场，陆沉被迫问名。', '2028-瑞恒广场-00:20', 3, chapters.chapterIds.get(2), refs.mapIds.get('瑞恒广场负一层'), ['luchen', 'jiangzhaoye', 'wenque'], ['祈愿 App 愿望标签']],
    ['黑水河命债触发', '电梯井黑水倒灌，河神债页出现，第二案启动。', '2028-瑞恒广场-00:37', 4, chapters.chapterIds.get(2), refs.mapIds.get('黑水河旧闸'), ['luchen', 'jiangzhaoye'], ['黑水河工号牌']],
  ]
  timelineRows.forEach(([title, summary, label, sort, chapterId, locationId, characterKeys, itemNames]) => {
    insertRow(db, 'timeline_events', {
      novel_id: novelId,
      sort_order: sort * 10,
      event_title: title,
      event_summary: summary,
      time_mode: 'modern-date',
      time_label: label,
      time_sort_value: sort,
      time_precision: '分钟',
      is_major_event: 1,
      event_type: sort <= 2 ? '清算' : '反压',
      arc_id: structure.arcIds.get(1),
      volume_id: firstVolumeId,
      part_id: firstPartId,
      chapter_start_id: chapterId,
      chapter_end_id: chapterId,
      location_map_id: locationId,
      present_character_ids_json: toJson(characterKeys.map((key) => refs.characterIds.get(key)).filter(Boolean)),
      affected_character_ids_json: toJson(characterKeys.map((key) => refs.characterIds.get(key)).filter(Boolean)),
      protagonist_present: 1,
      protagonist_action: sort <= 2 ? '核账并问账' : '问名并优先救人',
      event_cause: '旧债被拖欠并试图商业化掩盖。',
      event_process: summary,
      event_result: sort === 4 ? '黑水河新案启动' : '证据链继续扩大',
      linked_item_ids_json: toJson(itemNames.map((name) => refs.itemIds.get(name)).filter(Boolean)),
      typed_refs_json: toJson({ characters: characterKeys.map((key) => refs.characterIds.get(key)).filter(Boolean), items: itemNames.map((name) => refs.itemIds.get(name)).filter(Boolean) }),
      direct_consequences_json: toJson(['新愿集团暴露', '陆沉代价加重']),
      open_threads_json: toJson(['万神账本来源', '新愿算法造神']),
      notes: '样稿时间线。',
      status: 'introduced',
      created_at: now,
      updated_at: now,
    })
  })

  const trackId = insertRow(db, 'growth_tracks', {
    novel_id: novelId,
    track_type: 'ability',
    source_entity_type: 'character',
    source_entity_id: refs.characterIds.get('luchen'),
    source_entity_label: '陆沉',
    title: '万神账本清算权限',
    current_tier: '问账初开',
    stage_goal: '掌握问账和问名的边界，完成第一卷城隍与黑水河清算。',
    next_goal: '获得封门稳定能力，避免副本伤及普通人。',
    bottleneck: '证据不完整时账页不会翻开。',
    scarce_resource: '真实凭证、证人、旧契和主角身份稳定度。',
    acquire_path: '每清一笔神债，获得短时神权或规则碎片。',
    consumption_rule: '问账消耗体力，问名抵押身份，封门消耗城隍残印。',
    failure_cost: '身份失真、失眠、被新愿标记、普通人被卷入副本。',
    reward_cadence: '前30章每3章给一次小升级，每卷给一次城市级权限。',
    linked_volume_id: firstVolumeId,
    linked_chapter_id: chapters.chapterIds.get(1),
    status: 'active',
    sort_order: 10,
    created_at: now,
    updated_at: now,
  })
  const poolId = insertRow(db, 'resource_pools', {
    novel_id: novelId,
    name: '身份稳定度',
    pool_type: 'cost',
    scarcity_level: 'scarce',
    current_reserve: '前两章后开始波动，问名会短时清空姓名栏。',
    unit: '现实系统可识别程度',
    replenish_path: '完成债务清算、获得神账局背书、被普通人记住真名。',
    consumption_rule: '问名、改名、追查名称权属都会消耗。',
    failure_cost: '账号失效、身份空白、银行卡和社保异常，严重时被现实抹除。',
    pressure_source: '新愿集团名称资产化和万神账本代价。',
    linked_volume_id: firstVolumeId,
    notes: '把能力代价落到现实生活，避免无成本开挂。',
    created_at: now,
    updated_at: now,
  })
  insertRow(db, 'reward_cost_events', {
    novel_id: novelId,
    chapter_id: chapters.chapterIds.get(2),
    chapter_num_snapshot: 2,
    event_type: 'cost',
    title: '问名导致身份栏短暂空白',
    summary: '陆沉追查新愿代持城隍名称时，自己的现实身份信息开始闪烁。',
    track_id: trackId,
    resource_pool_id: poolId,
    delta_value: '-15 身份稳定度',
    cost_resolution_state: 'new',
    reward_level: 'minor',
    next_bottleneck: '必须用公开记录和他人记忆稳住身份。',
    linked_volume_id: firstVolumeId,
    created_at: now,
    updated_at: now,
  })

  ;[
    ['万神账本', 'power', '记录愿债、香火债、命债、名债的核心账册。只在证据链和民俗规则同时成立时翻页。', ['神账', '账本'], 1],
    ['问账', 'power', '核账员以现实凭证触发神明债务审计，逼欠债方吐出隐藏证据。', ['核账', '问凭证'], 1],
    ['问名', 'power', '追查名称权属和香火代持关系，代价是核账人身份信息短暂失真。', ['查名债'], 2],
    ['香火债', 'world_rule', '被借用、挪用、拖欠的祭祀、记忆、愿望和公共名称形成的债。', ['愿债', '名债'], 1],
    ['算法神', 'antagonist', '新愿集团以用户愿望标签和民俗名称资产训练出的无脸神明。', ['无脸神'], 2],
    ['神账局', 'organization', '城市资产清算中心的真实业务线，负责处理民俗债务和特殊资产。', ['城市资产清算中心'], 1],
  ].forEach(([term, category, definition, aliases, firstAppear], index) => {
    insertRow(db, 'glossary', {
      novel_id: novelId,
      term,
      category,
      definition,
      aliases_json: toJson(aliases),
      first_appear_chapter: firstAppear,
      related_entity_ids_json: toJson([]),
      is_canonical: 1,
      sort_order: (index + 1) * 10,
      created_at: now,
      updated_at: now,
    })
  })

  ;[
    ['证据反杀清算', 'conflict', '先让反派用现实权力压人，再用账册和证据链当众反杀。', ['现实委屈', '反派否认', '主角找凭证', '神账翻页', '证据公开', '留下代价'], ['陆沉', '反派', '普通债权人'], '压抑到痛快'],
    ['民俗副本救人', 'action', '副本不只是打怪，必须先保护普通人，再完成清算。', ['规则显形', '无关者受困', '主角判断债务边界', '先救人', '再追责'], ['陆沉', '姜照夜', '受困者'], '紧张到克制'],
    ['法务公关反压', 'political', '反派用公告、律师、公证和平台规则压制超自然证据。', ['反派入场', '定义非法', '群众动摇', '主角转向可公开证据', '反压失败'], ['温阙', '陆沉', '群众'], '冷静到锋利'],
  ].forEach(([name, category, description, beats, roles, emotion], index) => {
    insertRow(db, 'scene_templates', {
      novel_id: novelId,
      name,
      category,
      description,
      typical_beats_json: toJson(beats),
      suggested_character_roles_json: toJson(roles),
      emotion_arc: emotion,
      is_builtin: 0,
      sort_order: (index + 1) * 10,
      created_at: now,
      updated_at: now,
    })
  })
}

async function main() {
  await app.whenReady()
  const dbPath = path.join(app.getPath('userData'), 'novelforge.db')
  const backups = backupDatabaseFiles(dbPath)
  const { initDb, getSqlite, closeDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const db = getSqlite()
  const now = new Date().toISOString()

  const result = db.transaction(() => {
    resetExistingSample(db)
    const genreId = ensureGenre(db)
    const novelId = createNovel(db, genreId, now)
    const structure = createStructure(db, novelId, now)
    const actorRefs = createCharactersAndFactions(db, novelId, now)
    const worldRefs = createMapItemsAndThreads(db, novelId, actorRefs, structure, now)
    const refs = { ...actorRefs, ...worldRefs }
    const chapters = createChapters(db, novelId, structure, refs, now)
    createResistanceSystem(db, novelId, structure, refs, chapters, now)
    createMemoryAndPayoffs(db, novelId, structure, refs, chapters, now)
    createTimelineGrowthAndGlossary(db, novelId, structure, refs, chapters, now)

    return {
      novelId,
      title: SAMPLE_TITLE,
      totalWords: db.prepare('SELECT total_words AS totalWords FROM novels WHERE id = ?').get(novelId).totalWords,
      chapters: db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE novel_id = ?').get(novelId).count,
      draftChapters: db.prepare("SELECT COUNT(*) AS count FROM chapters WHERE novel_id = ? AND status = 'draft'").get(novelId).count,
      characters: db.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id = ?').get(novelId).count,
      factions: db.prepare('SELECT COUNT(*) AS count FROM factions WHERE novel_id = ?').get(novelId).count,
      maps: db.prepare('SELECT COUNT(*) AS count FROM world_map WHERE novel_id = ?').get(novelId).count,
      items: db.prepare('SELECT COUNT(*) AS count FROM story_items WHERE novel_id = ?').get(novelId).count,
      threads: db.prepare('SELECT COUNT(*) AS count FROM story_threads WHERE novel_id = ?').get(novelId).count,
      facts: db.prepare('SELECT COUNT(*) AS count FROM story_facts WHERE novel_id = ?').get(novelId).count,
      foreshadows: db.prepare('SELECT COUNT(*) AS count FROM foreshadow_ledger WHERE novel_id = ?').get(novelId).count,
      chapterContracts: db.prepare('SELECT COUNT(*) AS count FROM chapter_contracts WHERE novel_id = ?').get(novelId).count,
      sceneContracts: db.prepare('SELECT COUNT(*) AS count FROM scene_contracts WHERE novel_id = ?').get(novelId).count,
      sceneTemplates: db.prepare('SELECT COUNT(*) AS count FROM scene_templates WHERE novel_id = ?').get(novelId).count,
      relationshipArcs: db.prepare('SELECT COUNT(*) AS count FROM relationship_arcs WHERE novel_id = ?').get(novelId).count,
      resistanceTracks: db.prepare('SELECT COUNT(*) AS count FROM resistance_tracks WHERE novel_id = ?').get(novelId).count,
    }
  })()

  console.log(JSON.stringify({ backups, ...result }, null, 2))
  closeDb()
  app.quit()
}

main().catch((error) => {
  console.error(error)
  setTimeout(() => {
    app.quit()
    process.exit(1)
  }, 100)
})
