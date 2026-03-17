export interface PromptParamMeta {
  key: string
  label: string
}

export interface PromptCatalogEntry {
  key: string
  name: string
  description: string
  category: string
  params: PromptParamMeta[]
  template: string
}

export interface ProtagonistPromptInput {
  novelTitle: string
  novelSynopsis: string
  genre: string
  worldSummary: string
  storyCore: string
  gender: string
  surnameHint?: string
  speciesSummary?: string
  factionSummary?: string
  ecologySummary?: string
  mapSummary?: string
  writingConstraints?: string
}

export interface BatchCharacterPromptInput {
  novelTitle: string
  novelSynopsis: string
  protagonistSummary: string
  existingNames: string
  genre: string
  worldSummary: string
  storyCore: string
  count: number
  genderRatio: string
  specialRequirements: string
  speciesSummary?: string
  factionSummary?: string
  ecologySummary?: string
  mapSummary?: string
  writingConstraints?: string
}

export interface RegenerateCharacterPromptInput {
  novelTitle: string
  novelSynopsis: string
  genre: string
  worldSummary: string
  storyCore: string
  protagonistRule: string
  lockedName: string
  lockedRoleType: string
  currentProfile: string
  relatedCharacters: string
  relationSummary: string
  speciesSummary?: string
  factionSummary?: string
  ecologySummary?: string
  writingConstraints?: string
}

export interface CharacterRelationsPromptInput {
  novelSynopsis: string
  characterList: string
}

export interface MapGenerationPromptInput {
  novelTitle: string
  worldSummary: string
  genre: string
  mapStructure: string
  namedPlaces: string
  factionSummary?: string
  mapSummary?: string
  writingConstraints?: string
}

export interface StoryArcPromptInput {
  novelTitle: string
  genre: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  totalChapters: number
  rhythmSummary: string
  background: string
  protagonistReference: string
  protagonistRule: string
}

export interface ChapterOutlinePromptInput {
  novelTitle: string
  genre: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  arcName: string
  arcGoal: string
  arcSummary: string
  chapterStart: number
  chapterEnd: number
  previousSummary: string
  characterStates: string
  continuitySummary: string
  openLoops: string
  worldRulesSummary: string
  protagonistReference: string
  protagonistRule: string
}

export interface TimelineEventPromptInput {
  novelTitle: string
  genre: string
  background: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  worldRulesSummary: string
  timelineRules: string
  arcSummary: string
  characterSummary: string
  locationSummary: string
  itemSummary: string
  existingEvents: string
  count: number
  protagonistReference: string
  protagonistRule: string
}

export interface ChapterWritingPromptInput {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  plotPoints: string
  emotionTone: string
  targetWords: number
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  previousSummaries: string
  lastChapterEnding: string
  styleTemplate: string
  continuitySummary: string
  openLoops: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  protagonistReference: string
  protagonistRule: string
}

export interface ScenePlanPromptInput {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  plotPoints: string
  emotionTone: string
  targetWords: number
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  itemSummary: string
  previousSummaries: string
  lastChapterEnding: string
  continuitySummary: string
  openLoops: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  longTermMemory: string
  consistencyNotes: string
  protagonistReference: string
  protagonistRule: string
}

export interface ChapterReviewPromptInput {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  itemSummary: string
  continuitySummary: string
  openLoops: string
  timelineSummary: string
  longTermMemory: string
  consistencyNotes: string
  scenePlan: string
  draftContent: string
  protagonistReference: string
  protagonistRule: string
}

export interface ChapterRewritePromptInput {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  emotionTone: string
  targetWords: number
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  itemSummary: string
  previousSummaries: string
  lastChapterEnding: string
  continuitySummary: string
  openLoops: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  longTermMemory: string
  consistencyNotes: string
  scenePlan: string
  draftContent: string
  reviewNotes: string
  protagonistReference: string
  protagonistRule: string
}

export interface ContinuityPromptInput {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  arcName: string
  chapterGoal: string
  summary: string
  chapterContent: string
}

export interface RewriteParagraphPromptInput {
  originalParagraph: string
  contextBefore: string
  specificRequirements: string
}

export interface GenericExpandPromptInput {
  contentType: string
  existingContent: string
  novelContext: string
  genreContext: string
  requirements?: string
}

export interface SubplotExpandPromptInput {
  novelTitle: string
  genreContext: string
  mainPlot: string
  subplot: {
    name: string
    characters: string
    conflict: string
    mainlineLink: string
    endChapter: string
  }
  requirements?: string
}

export interface ContentScoringPromptInput {
  contentType: string
  content: string
  genreContext: string
  novelBackground: string
}

function clean(value?: string | null): string {
  return value?.trim() || ''
}

function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function section(title: string, content?: string | null): string {
  const body = clean(content)
  if (!body) return ''
  return `【${title}】\n${body}`
}

function sectionLines(title: string, lines: Array<string | undefined | null | false>): string {
  const body = lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n')
  return section(title, body)
}

function placeholder(key: string): string {
  return `{${key}}`
}

export const HUMAN_LANGUAGE_RULE_LINES = [
  '使用常规中文表达和稳定的小说语感，句子要顺，不硬凹文学腔。',
  '检查主语、谓语、宾语是否搭配准确，动作、状态和后果要符合对象类别。',
  '人或生物才能“死亡、呼吸、哭泣、思考”；电网、系统、组织、设施等非生物应改写为“瘫痪、崩溃、中断、停摆、瓦解”等准确说法。',
  '除非上下文明确需要修辞且不会造成歧义，否则不要让物体承担人的情绪、感官、命运或生理反应。',
  '少用抽象口号和假深刻表达，多写具体事实、行动、关系和后果。',
  '普通概念、职业、情绪和判断不要随意加引号；只有称号、制度名、功法名、专有名词才保留引号。',
  '不要写“所谓”“某种意义上”“命运般”“这一刻”“无法言说”这类常见 AI 腔连接词。',
  '一旦出现不自然搭配，优先改成读者最熟悉、最直白、最准确的常规说法。',
] as const

export function buildHumanLanguageRules(extraLines: string[] = []): string {
  return [...HUMAN_LANGUAGE_RULE_LINES, ...extraLines]
    .map((line) => `- ${line}`)
    .join('\n')
}

export const GLOBAL_WRITING_RULES = `你现在写的是可直接入稿的中文小说正文。

基本要求：
1. 先写发生了什么，再让读者自己感受到意义，不替读者总结。
2. 情绪尽量落在动作、反应、对话和细节里，少用抽象判断句。
3. 对话要像人会说的话，允许停顿、岔开、答非所问，不要每句都补说话方式。
4. 句子自然，不摆写作腔，不堆对称句、排比句和故作深沉的收尾。
5. 一切服从当前章节任务、人物状态、世界规则和连续性。
6. 主谓宾搭配必须准确，动作和状态要符合对象本身；不要把非生物写成会死亡、呼吸、哭泣或思考。

高风险表达，尽量不要出现：
- 不禁、不由得、忍不住、此刻、顿时、瞬间、莫名、说不清
- 深吸一口气、攥紧拳头、微微一愣、瞪大眼睛、心头一紧
- 所谓的、命运、希望、成长 这类被刻意强调的抽象词
- 普通概念随意加中文引号或书名号，例如“人类筛选”“真正的成长”“命运齿轮”
- 用破折号解释、顿悟、硬造停顿
- 为了显得深刻而造词，尤其任何“XX之感 / 之际 / 之意”式表达
- 把对象写错，比如“电网的死亡”“城市在哭泣”“铁门感到愤怒”这类不成立或高歧义表达

输出要求：
- 只输出正文，不要解释，不要标题，不要 Markdown
- 用纯文本分段，段间空一行`.trim()

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary: string
}): string {
  return renderPrompt([
    '把一段小说初始设想扩成可以继续开发的开篇设定。只补足世界底色、时代气息、人物处境和冲突起点，不要替用户把后续完整剧情写完。',
    sectionLines('现有信息', [
      `用户背景：${params.userBackground}`,
      `题材：${params.genre}`,
      params.worldTemplateSummary ? `世界观参考：${params.worldTemplateSummary}` : '',
    ]),
    section('任务', [
      '1. 写一段 300 到 500 字的扩充背景。重点补世界规则、生活质感、矛盾起点和人物当下处境。',
      '2. 给 3 个标题。分别偏人物、偏主题、偏悬念，风格要拉开。',
      '3. 写一段 150 到 200 字的简介。站在读者视角勾起兴趣，但不要泄露关键转折和结局。',
    ].join('\n')),
    section('写法要求', [
      '优先沿用用户已有设定，不另起一套世界观。',
      '语言自然，不写百科，不写广告腔，不堆抽象大词。',
      '不要用“本文讲述了”“这是一个关于”这类介绍腔。',
      '背景只负责打底，不提前写完人物成长线或大结局。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '背景和简介都要像正常小说文案，不要写成概念拼贴或伪诗句。',
      '如果一句话有更自然的常规说法，优先使用常规说法。',
    ])),
    '只输出 JSON：{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}',
  ])
}

export function protagonistPrompt(params: ProtagonistPromptInput): string {
  return renderPrompt([
    '为这部小说确定主角档案。这个人物后面会直接进入故事弧、章节细纲和正文写作，所以信息必须能拿来用，不能只停在概念层。',
    sectionLines('小说信息', [
      `书名：${params.novelTitle}`,
      `背景：${params.novelSynopsis}`,
      `题材：${params.genre}`,
      params.worldSummary ? `世界规则：${params.worldSummary}` : '',
      params.storyCore ? `故事核心：${params.storyCore}` : '',
      params.speciesSummary ? `种族生态：${params.speciesSummary}` : '',
      params.factionSummary ? `势力结构：${params.factionSummary}` : '',
      params.ecologySummary ? `角色生态：${params.ecologySummary}` : '',
      params.mapSummary ? `地图蓝图：${params.mapSummary}` : '',
      params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
      `性别：${params.gender}`,
      params.surnameHint ? `姓名方向：${params.surnameHint}` : '',
    ]),
    section('命名要求', [
      '姓氏从以下范围选择：赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎。',
      '复姓可选：诸葛、司马、欧阳、上官、百里、令狐。',
      '名字以两字为主，符合题材和时代背景，避免生僻字堆砌。',
    ].join('\n')),
    section('人物要求', [
      '人物要复杂，但不是为了复杂而反差。要能解释他为什么会做出关键选择。',
      '背景经历必须落到现在的判断、习惯、伤口、关系或欲望上。',
      '外貌写可识别细节，不要“高挑、好看、气质出众”这种空描写。',
      '既要有人会喜欢他的地方，也要有人会警惕他、误解他或替他难受的地方。',
      '主角的实体类型、种族、等级/身份、势力归属必须贴合题材规则，不默认只能是普通人。',
      '所有信息必须和现有背景、世界规则、故事核心一致，不得另起一套设定。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '档案字段要能直接落到人物设定中，不写空泛评语和概念包装。',
      '不要给普通概念、情绪或关系加引号，不要写成“人类筛选”“真正成长”这类 AI 腔。',
    ])),
    '只输出 JSON：{"surname":"","given_name":"","full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/境界/身份阶位","social_identity":"社会身份或阵营位置","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主题/背景/主线的关联1"],"appearance":"外貌3~4句，写能认出来的细节","background":"180字以内，写关键经历以及它留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺陷1","缺陷2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"眼下最想得到的东西","deep_need":"真正缺失、却不愿承认的需要","core_fear":"最怕失去或面对的东西","inner_conflict":"最核心的拉扯","hidden_secret":"不愿公开的秘密","moral_line":"轻易不会跨过的底线","self_deception":"对自己说过的谎","trauma":"仍在影响现在的旧伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"在亲密或权力关系里的张力来源","resonance_point":"读者最容易共情的一点","character_arc":"后续可能的变化方向","first_impression":"第一次出场最抓人的地方"}',
  ])
}

export function batchCharacterPrompt(params: BatchCharacterPromptInput): string {
  return renderPrompt([
    `为小说《${params.novelTitle}》补出 ${params.count} 个配角。每个人都要能在后续剧情里承担明确作用，不是凑数。`,
    sectionLines('现有信息', [
      `小说背景：${params.novelSynopsis}`,
      params.storyCore ? `故事核心：${params.storyCore}` : '',
      `主角摘要：${params.protagonistSummary}`,
      `已有人物：${params.existingNames || '无'}`,
      `题材：${params.genre}`,
      params.worldSummary ? `世界规则：${params.worldSummary}` : '',
      params.speciesSummary ? `种族生态：${params.speciesSummary}` : '',
      params.factionSummary ? `势力结构：${params.factionSummary}` : '',
      params.ecologySummary ? `角色生态：${params.ecologySummary}` : '',
      params.mapSummary ? `地图蓝图：${params.mapSummary}` : '',
      params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
      `性别比例：${params.genderRatio}`,
      params.specialRequirements ? `特殊要求：${params.specialRequirements}` : '',
    ]),
    section('生成要求', [
      '每个配角都要有明确功能定位，且这个定位和主线推进有关。',
      '与主角的关系要有层次，不要只写“支持者”或“对立者”。',
      '至少体现出欲望、恐惧、秘密、软肋、关系张力中的一部分。',
      '人物类型要覆盖题材所需的角色生态，不默认全部都是人类。',
      '人物行为要像这个人会做的事，不是为了推动剧情硬安排。',
      '不得与已有背景、世界规则、主角设定冲突，也不得重名。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '人物描述要像编辑会采用的角色档案，不要写成悬浮文案。',
      '禁止把普通概念加引号，不要写成“希望载体”“真正人类”这类空洞标签。',
    ])),
    '只输出 JSON 数组：[{"full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"role_type":"major/minor/antagonist/supporting","occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"background":"80~120字，写关键经历和现状","personality_traits":["特点1","特点2"],"flaws":["缺陷1","缺陷2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"人物反差点","relationship_tension":"与主角或关键人物的张力","resonance_point":"读者共情点","character_arc":"后续变化方向","relation_to_protagonist":"与主角的关系与拉扯","first_impression":"第一次出场的印象","appearance":"外貌1~2句，写辨识度","appear_chapter":1}]',
  ])
}

export function regenerateCharacterPrompt(params: RegenerateCharacterPromptInput): string {
  return renderPrompt([
    '根据最新上下文，重写并深化同一个角色的档案。注意，这是更新，不是重新发明一个新人。',
    sectionLines('锁定条件', [
      `小说：${params.novelTitle}`,
      `背景：${params.novelSynopsis}`,
      `题材：${params.genre}`,
      params.worldSummary ? `世界规则：${params.worldSummary}` : '',
      params.storyCore ? `故事核心：${params.storyCore}` : '',
      params.speciesSummary ? `种族生态：${params.speciesSummary}` : '',
      params.factionSummary ? `势力结构：${params.factionSummary}` : '',
      params.ecologySummary ? `角色生态：${params.ecologySummary}` : '',
      params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
      `主角命名规则：${params.protagonistRule}`,
      `角色姓名必须保留：${params.lockedName}`,
      `角色类型必须保留：${params.lockedRoleType}`,
    ]),
    section('当前人物旧档案', params.currentProfile),
    section('相关人物', params.relatedCharacters || '暂无'),
    section('现有关系信息', params.relationSummary || '暂无'),
    section('重写要求', [
      '保留同一个人的身份、姓名和角色功能，不得改名换壳。',
      '新档案要能解释这个人现在为什么这样想、这样做、这样处理关系。',
      '人物不能写成纯善或纯恶，必须让读者能理解他、提防他或替他难受。',
      '所有内容必须服务现有背景、世界规则、主线冲突和关系网络，不能另起一套。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '所有字段都要写成清楚、可落地的角色信息，不要写成空洞总结。',
      '不要制造概念引号或伪深刻口号。',
    ])),
    `只输出 JSON：{"full_name":"${params.lockedName}","role_type":"${params.lockedRoleType}","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"appearance":"外貌3~4句，突出辨识度","background":"180字以内，写关键经历和留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺陷1","缺陷2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"与关键人物关系里的张力","resonance_point":"读者最容易共情的一点","character_arc":"后续变化方向","first_impression":"第一次出场印象","appear_chapter":1}`,
  ])
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  return renderPrompt([
    '为小说整理一张能直接服务剧情的人物关系网。',
    sectionLines('输入信息', [
      `小说背景：${params.novelSynopsis}`,
      `人物列表：\n${params.characterList}`,
    ]),
    section('关系要求', [
      '关系要具体，能看出拉扯，不要只写同事、朋友这种空标签。',
      '不是所有人都必须认识，关系疏密要合理。',
      '区分双向关系和单向关系，尤其是利用、暗恋、仇视这类关系。',
      '关系描述优先写可见事实和相处方式，不写空泛判断。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '关系描述要像真实人物之间会发生的拉扯，不要写成概念句。',
    ])),
    '关系类型只从这些里选：friend / enemy / lover / parent_child / colleague / rival / mentor_student / acquaintance',
    '只输出 JSON 数组：[{"char_a":"","char_b":"","type":"","label":"关系简称","description":"20字内，写清具体拉扯","bilateral":true}]',
  ])
}

export function mapGenerationPrompt(params: MapGenerationPromptInput): string {
  return renderPrompt([
    `为小说《${params.novelTitle}》补一套能支撑剧情的地图结构。`,
    sectionLines('现有信息', [
      `世界观：${params.worldSummary}`,
      `题材：${params.genre}`,
      `地图结构要求：${params.mapStructure}`,
      params.factionSummary ? `势力结构：${params.factionSummary}` : '',
      params.mapSummary ? `蓝图补充：${params.mapSummary}` : '',
      params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
      params.namedPlaces ? `用户指定地点：${params.namedPlaces}` : '',
    ]),
    section('生成要求', [
      '命名要贴合题材和文化背景，不要串味。',
      '每个地点既要有氛围，也要有存在价值，最好能看出会承载什么事件。',
      '地点之间要有基本地理逻辑和父子层级逻辑，不要像随机抽卡。',
      '地图层级严格服从题材蓝图，不要把丧尸题材写成宗门结构，也不要把仙侠地图写成现代行政区模板。',
      '剧情关联要写具体事件或用途，不写“重要地点”这种空话。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '地点描述要具体，不要堆砌形容词或写成旅游宣传语。',
      '普通地点性质不要加引号，不要写成“真正禁区”“希望之地”这类概念包装。',
    ])),
    '只输出递归 JSON：{"nodes":[{"name":"","node_type":"国家/宗门/基地/城市/秘境/设施等","structure_role":"该节点在蓝图中的职责","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"children":[{"name":"","node_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"children":[]}]}]}',
  ])
}

export function buildStoryArcPlanningPrompt(params: StoryArcPromptInput): string {
  return renderPrompt([
    '把这部小说拆成一组连续推进的故事弧。每个故事弧都要对主线有明确作用，不能只是把剧情切成几段。',
    sectionLines('项目背景', [
      `书名：${params.novelTitle}`,
      `题材：${params.genre || '未知题材'}`,
      params.background ? `故事背景：${params.background}` : '',
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
    ]),
    sectionLines('核心约束', [
      `故事核心目标：${params.storyGoal || '未提供'}`,
      `核心冲突：${params.coreConflict || '未提供'}`,
      `主线剧情：${params.mainPlot || '未提供'}`,
      `支线剧情：${params.subPlots || '暂无'}`,
      `结局方向：${params.ending || '未提供'}`,
      `节奏比例：${params.rhythmSummary || '未配置'}`,
      `预计总章节：${params.totalChapters}章`,
    ]),
    section('规划要求', [
      '规划 3 到 5 个故事弧，章节范围必须连续、无重叠、无空档。',
      '每个故事弧都要写清楚这一段到底完成了什么推进，而不是只写阶段名称。',
      'key_turns 必须写具体事件或决定，不能写“矛盾升级”“剧情推进”这种空话。',
      'subplot_links 要明确支线在哪个弧进入、加压、回收。',
      '最后一个故事弧必须负责主线和主要支线的收束。',
      '如果出现主角姓名冲突，统一按主角命名规则处理。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      'summary、arc_goal 和 key_turns 都要写成常规中文，不要写成策划黑话。',
    ])),
    '只输出 JSON 数组：[{"arc_name":"","stage":"铺垫/升级/高潮/收束","chapter_start":1,"chapter_end":10,"arc_goal":"本弧必须完成的推进","key_turns":["具体转折1","具体转折2"],"subplot_links":["某条支线如何介入/推进/回收"],"pacing":"快/中/慢","summary":"40到60字，写清这一弧发生了什么"}]',
  ])
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  return renderPrompt([
    '为当前故事弧拆分章节大纲。每一章都要能回答三个问题：这一章完成什么、承接什么、把什么递给下一章。',
    sectionLines('项目信息', [
      `书名：${params.novelTitle}`,
      `题材：${params.genre || '未知题材'}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
    ]),
    sectionLines('主线约束', [
      `故事核心目标：${params.storyGoal || '未提供'}`,
      `核心冲突：${params.coreConflict || '未提供'}`,
      `主线剧情：${params.mainPlot || '未提供'}`,
    ]),
    sectionLines('当前故事弧', [
      `名称：${params.arcName}`,
      `目标：${params.arcGoal || '未提供'}`,
      `概述：${params.arcSummary || '未提供'}`,
      `章节范围：第${params.chapterStart}章到第${params.chapterEnd}章`,
    ]),
    sectionLines('连续性上下文', [
      params.previousSummary ? `前情摘要：\n${params.previousSummary}` : '',
      params.continuitySummary ? `连续性记忆：\n${params.continuitySummary}` : '',
      params.openLoops ? `未回收事项：\n${params.openLoops}` : '',
      params.characterStates ? `关键人物状态：\n${params.characterStates}` : '',
      params.worldRulesSummary ? `世界规则：\n${params.worldRulesSummary}` : '',
    ]),
    section('生成要求', [
      '每章 goal 必须服务本弧目标，合起来能看出主线持续推进。',
      'plot_points 按发生顺序写具体事件，不写“制造冲突”“推进剧情”。',
      'bridge_in 要点明这章接住了什么，bridge_out 要点明这章把什么递出去了。',
      '至少回应一部分前文伏笔，或者继续压实某个未回收事项。',
      '如果出现主角姓名冲突，统一按主角命名规则处理。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '章节标题、目标和事件点都要写得清楚直接，避免抽象套话。',
    ])),
    `只输出 JSON 数组：[{"chapter_num":${params.chapterStart},"title":"","goal":"本章要完成的推进","plot_points":["事件1","事件2","事件3"],"characters":["登场人物A","登场人物B"],"location":"主要场景","emotion_tone":"情绪基调","bridge_in":"这章承接了什么","bridge_out":"这章给下章留下什么"}]`,
  ])
}

export function buildTimelineEventsPrompt(params: TimelineEventPromptInput): string {
  return renderPrompt([
    '为这部小说规划一条可持续使用的事件时间轴。只规划关键节点，不要把每一场戏都拆进去。事件必须能服务后续写作，帮助作者记住时间顺序、人物在场情况、行动和后果。',
    sectionLines('小说信息', [
      `书名：${params.novelTitle}`,
      `题材：${params.genre || '未知题材'}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
    ]),
    sectionLines('故事核心', [
      `背景：${params.background || '未提供'}`,
      `故事目标：${params.storyGoal || '未提供'}`,
      `核心冲突：${params.coreConflict || '未提供'}`,
      `主线剧情：${params.mainPlot || '未提供'}`,
      `支线剧情：${params.subPlots || '暂无'}`,
      `结局方向：${params.ending || '未提供'}`,
    ]),
    sectionLines('世界与时间规则', [
      params.worldRulesSummary ? `世界规则：\n${params.worldRulesSummary}` : '',
      params.timelineRules ? `时间规则：\n${params.timelineRules}` : '',
      params.arcSummary ? `故事弧：\n${params.arcSummary}` : '',
      params.characterSummary ? `关键人物：\n${params.characterSummary}` : '',
      params.locationSummary ? `关键地点：\n${params.locationSummary}` : '',
      params.itemSummary ? `关键物品：\n${params.itemSummary}` : '',
      params.existingEvents ? `已有事件：\n${params.existingEvents}` : '',
    ]),
    section('生成要求', [
      `只生成 ${params.count} 个左右的主事件或关键节点，覆盖开端、升级、反转、爆点、收束，不要生成流水账。`,
      '每个事件都要写清楚时间标签、事件名称、事件作用、主角是否在场、主角做了什么、直接结果、后续遗留问题。',
      '事件必须和已有故事弧、人物、地点相互勾连；如果能确定章节范围，就给出 chapter_start_num 和 chapter_end_num，否则留空。',
      'event_type 要贴合题材；time_label 要符合时间规则；time_sort_value 必须可排序，数值递增。',
      'present_characters 和 affected_characters 只写已有角色名；location_name 只写已有地点名；arc_name 只写已有故事弧名；linked_items 只写已有物品名。',
      'open_threads 只保留后文必须回收的问题；direct_consequences 只写事件立刻带来的变化。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '事件描述要像人类策划记录，不要写空洞口号，不要给普通概念随意加引号。',
      'summary、cause、process、result 都要写成具体事实，避免“矛盾升级”“命运转折”这类空话。',
    ])),
    '只输出 JSON 数组：[{"time_mode":"gregorian/regnal/relative-disaster/custom-era/future-date","time_label":"时间标签","time_sort_value":1,"time_precision":"年/月/日/阶段","event_title":"事件标题","event_summary":"30~60字概述","is_major_event":1,"event_type":"事件类型","arc_name":"关联故事弧","chapter_start_num":1,"chapter_end_num":2,"location_name":"关联地点","present_characters":["人物A","人物B"],"affected_characters":["人物C"],"protagonist_present":1,"protagonist_action":"主角做了什么","event_cause":"事件起因","event_process":"事件过程","event_result":"事件结果","linked_items":["物品A"],"direct_consequences":["直接后果1"],"open_threads":["待回收问题1"],"notes":"补充备注"}]',
  ])
}

export function buildScenePlanPrompt(params: ScenePlanPromptInput): string {
  return renderPrompt([
    '先为这一章做场景计划，再进入正文写作。场景计划必须为正文服务，不要写成策划空话。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
      `目标字数：${params.targetWords} 字左右`,
      params.emotionTone ? `情绪基调：${params.emotionTone}` : '',
    ]),
    section('本章目标', params.chapterGoal),
    section('本章细纲', params.plotPoints),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('关键物品与去向', params.itemSummary),
    section('上章结尾', params.lastChapterEnding),
    section('最近章节摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('长文压缩记忆', params.longTermMemory),
    section('当前结构体检提醒', params.consistencyNotes),
    section('计划要求', [
      '拆成 4 到 7 个场景或连续段落，每个场景都要能直接落成正文。',
      '每个场景写清：场景目标、冲突、谁在场、可能牵涉的关键物品、该段必须交代的事实、收尾钩子。',
      '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      '不要发明脱离当前背景的新设定，不要把普通概念乱加引号。',
      '输出给写手看的工作计划，不要写宣传口吻。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '场景目标和冲突都要写成具体事实，不要写“命运转折”“真正成长”这类空话。',
    ])),
    '只输出 JSON 数组：[{"scene_order":1,"scene_title":"场景名","purpose":"这一段必须完成什么","location":"地点或空间","time_anchor":"时间标签","present_characters":["人物A"],"key_items":["物品A"],"conflict":"这段最直接的冲突","beat":"这一段发生的关键动作","must_cover":["必须交代1","必须交代2"],"exit_hook":"如何推到下一段"}]',
  ])
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '下面是这一章的任务卡。先吃透任务，再直接写正文。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
      `目标字数：${params.targetWords} 字左右`,
      params.emotionTone ? `情绪基调：${params.emotionTone}` : '',
    ]),
    section('本章必须完成', params.chapterGoal || '按已定大纲执行'),
    section('已定章节大纲', params.plotPoints),
    section('本章必须承接', params.continuityNotes),
    section('当前未回收事项', params.openLoops),
    section('时间轴关键节点', params.timelineSummary),
    section('时间轴待回收事项', params.timelineOpenThreads),
    section('上章结尾', params.lastChapterEnding),
    section('当前人物状态', params.characterStates),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('世界规则与限制', params.worldRules),
    section('近章摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('文风参考', params.styleTemplate),
    section('写作要求', [
      '正文必须沿用既有设定和称呼，尤其不要擅自改主角名字或关系状态。',
      '先把场景和动作写出来，再让情绪自然露出来，不要空讲道理。',
      '如果制造新悬念，必须和主线、当前故事弧或现有支线直接相关。',
      '遇到不准确的搭配，优先改成日常中文里最自然的表达，不写“电网的死亡”这类句子。',
      '只输出正文，直接开写，不要解释。',
    ].join('\n')),
  ])
}

export function buildChapterDraftPrompt(params: ChapterRewritePromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '先根据场景计划写出一版完整初稿。重点是把事情写顺、把承接写准，先不要追求花哨修辞。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
      `目标字数：${params.targetWords} 字左右`,
      params.emotionTone ? `情绪基调：${params.emotionTone}` : '',
    ]),
    section('场景计划', params.scenePlan),
    section('本章目标', params.chapterGoal),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('关键物品与去向', params.itemSummary),
    section('上章结尾', params.lastChapterEnding),
    section('最近章节摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('长文压缩记忆', params.longTermMemory),
    section('结构体检提醒', params.consistencyNotes),
    section('初稿要求', [
      '只按场景计划推进，不要跳场景，不要漏掉 must_cover。',
      '先把行动链、对话链、后果链写清，再让情绪自然露出来。',
      '把人物、物品、地点、事件顺序写准，避免后续审校时再大改结构。',
      '只输出初稿正文，不要解释。',
    ].join('\n')),
  ])
}

export function buildChapterReviewPrompt(params: ChapterReviewPromptInput): string {
  return renderPrompt([
    '你是小说统稿编辑。请只找会影响后续长文稳定性的真实问题：结构断裂、人物/物品/时间轴冲突、承接缺失、语言 AI 味、信息漏写。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
    ]),
    section('本章目标', params.chapterGoal),
    section('场景计划', params.scenePlan),
    section('小说核心约束', params.storyCore),
    section('当前故事弧', params.currentArc),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('关键物品与去向', params.itemSummary),
    section('连续性记忆', params.continuitySummary),
    section('未回收事项', params.openLoops),
    section('时间轴锚点', params.timelineSummary),
    section('长文压缩记忆', params.longTermMemory),
    section('结构体检提醒', params.consistencyNotes),
    section('待审校初稿', params.draftContent),
    section('输出要求', [
      '只保留真正需要修改的问题，不要泛泛而谈。',
      'critical_fixes 最多 5 条，写能直接执行的修改动作。',
      'continuity_risks 只写承接、伏笔、人物状态、物品去向、时间顺序的风险。',
      'language_risks 只写 AI 味、引号滥用、抽象口号、错误搭配。',
      'missing_payoffs 只写该章已经提出但没落地的关键信息。',
      'revision_brief 用 60 到 120 字概括修订方向。',
    ].join('\n')),
    '只输出 JSON：{"summary":"本章初稿整体情况","critical_fixes":["修改动作1"],"continuity_risks":["风险1"],"language_risks":["风险1"],"missing_payoffs":["缺口1"],"strengths":["优点1"],"revision_brief":"修订说明"}',
  ])
}

export function buildChapterRewritePrompt(params: ChapterRewritePromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '根据初稿和审校意见重写这一章，输出可直接入稿的版本。修订时优先保证承接、人物状态、事件顺序和物品去向准确。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      `主角称呼：${params.protagonistReference}`,
      `主角命名规则：${params.protagonistRule}`,
      `目标字数：${params.targetWords} 字左右`,
      params.emotionTone ? `情绪基调：${params.emotionTone}` : '',
    ]),
    section('场景计划', params.scenePlan),
    section('初稿正文', params.draftContent),
    section('审校意见', params.reviewNotes),
    section('本章目标', params.chapterGoal),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('关键物品与去向', params.itemSummary),
    section('上章结尾', params.lastChapterEnding),
    section('最近章节摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('长文压缩记忆', params.longTermMemory),
    section('结构体检提醒', params.consistencyNotes),
    section('修订要求', [
      '保留初稿中已经成立的有效段落，但要修掉所有 critical_fixes。',
      '如果初稿遗漏场景计划里的 must_cover，必须补齐。',
      '让人物说话和行动更像人，不要保留抽象口号、概念引号和生硬排比。',
      '只输出最终正文，不要解释。',
    ].join('\n')),
  ])
}

export function buildContinuityStatePrompt(params: ContinuityPromptInput): string {
  return renderPrompt([
    '从这一章里提炼后续写作必须记住的事实。不要写评价，不要写赏析，不要复述空话。',
    sectionLines('章节信息', [
      `小说：${params.novelTitle}`,
      `章节：第${params.chapterNum}章 ${params.chapterTitle}`,
      params.arcName ? `所属故事弧：${params.arcName}` : '',
      params.chapterGoal ? `本章目标：${params.chapterGoal}` : '',
      params.summary ? `本章摘要：${params.summary}` : '',
    ]),
    section('本章正文', params.chapterContent),
    section('提炼规则', [
      'plot_progress 只写真正推动了主线或支线的事实。',
      'character_state_changes 只写后续章节不能忘的人物状态变化。',
      'world_state_changes 只写局势、地点、势力、规则变化。',
      'open_loops 只保留还没回收、后面必须回应的事。',
      'continuity_notes 只写下章或后文不能漏掉的承接事项。',
      '每条尽量写成短句，具体、可复用。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '只保留清楚、可验证的事实，不写情绪化判断和抽象口号。',
    ])),
    '只输出 JSON：{"plot_progress":["推进1","推进2"],"character_state_changes":["人物变化1","人物变化2"],"world_state_changes":["世界变化1"],"open_loops":["未回收事项1","未回收事项2"],"continuity_notes":["下章必须承接1","下章必须承接2"],"arc_progress":"本章对当前故事弧的推进情况"}',
  ])
}

export function storyArcsPrompt(params: {
  novelTitle: string
  genre: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  totalChapters: number
}): string {
  return buildStoryArcPlanningPrompt({
    ...params,
    rhythmSummary: '',
    background: '',
    protagonistReference: '主角',
    protagonistRule: '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterOutlinePrompt(params: {
  novelTitle: string
  arcName: string
  arcGoal: string
  chapterStart: number
  chapterEnd: number
  previousSummary: string
  characterStates: string
  worldRulesSummary: string
}): string {
  return buildChapterOutlinePlanningPrompt({
    novelTitle: params.novelTitle,
    genre: '',
    storyGoal: '',
    coreConflict: '',
    mainPlot: '',
    arcName: params.arcName,
    arcGoal: params.arcGoal,
    arcSummary: '',
    chapterStart: params.chapterStart,
    chapterEnd: params.chapterEnd,
    previousSummary: params.previousSummary,
    characterStates: params.characterStates,
    continuitySummary: '',
    openLoops: '',
    worldRulesSummary: params.worldRulesSummary,
    protagonistReference: '主角',
    protagonistRule: '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterWritingPrompt(params: {
  novelTitle: string
  chapterNum: number
  chapterTitle: string
  chapterGoal: string
  plotPoints: string
  emotionTone: string
  worldRules: string
  characterStates: string
  previousSummaries: string
  lastChapterEnding: string
  styleTemplate: string
  targetWords: number
}): string {
  return buildChapterWritingPrompt({
    novelTitle: params.novelTitle,
    chapterNum: params.chapterNum,
    chapterTitle: params.chapterTitle,
    chapterGoal: params.chapterGoal,
    plotPoints: params.plotPoints,
    emotionTone: params.emotionTone,
    targetWords: params.targetWords,
    storyCore: '',
    currentArc: '',
    worldRules: params.worldRules,
    characterStates: params.characterStates,
    previousSummaries: params.previousSummaries,
    lastChapterEnding: params.lastChapterEnding,
    styleTemplate: params.styleTemplate,
    continuitySummary: '',
    openLoops: '',
    continuityNotes: '',
    timelineSummary: '',
    timelineOpenThreads: '',
    protagonistReference: '主角',
    protagonistRule: '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterSummaryPrompt(chapterContent: string): string {
  return renderPrompt([
    '为这一章生成后续写作要用的结构化摘要。只写事实，不渲染气氛。',
    section('章节内容', chapterContent),
    section('要求', [
      'summary 控制在 150 到 200 字，写清楚发生了什么、涉及谁、造成了什么变化。',
      '记录重要人物状态变化、关系变化、获得或失去的关键物件、局势变化。',
      'next_chapter_seed 用 50 字以内写清下章最自然的承接点。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '摘要只写清楚事实和后果，不写悬浮的主题感悟。',
    ])),
    '只输出 JSON：{"summary":"...","next_chapter_seed":"..."}',
  ])
}

export function aiCheckPrompt(text: string): string {
  return renderPrompt([
    '检查下面这段小说文字里常见的 AI 写作痕迹，重点给出能直接修改的建议。',
    section('待检测文本', text),
    section('重点检查', [
      '1. 破折号拿来解释、顿悟、停顿。',
      '2. 引号给普通词加重，或“所谓的”这类概念包装。',
      '3. 宏大空话和抽象大词压过具体情节。',
      '4. 造词、之字结构、模板化抒情。',
      '5. 万能引导词和动作套路，比如“不禁”“微微一愣”。',
      '6. 主谓宾搭配不成立，或把物体、系统、组织写成只有人和生物才会有的状态。',
    ].join('\n')),
    section('输出要求', [
      'issues 里的 location 只截取 15 字以内原文。',
      'suggestion 要写成可执行改法，不要只说“更自然一点”。',
      'overall_feedback 用一句话概括最主要的问题。',
      '如果发现“电网的死亡”这一类问题，要明确指出应该改成“电网瘫痪/崩溃/中断”等准确表达。',
    ].join('\n')),
    '只输出 JSON：{"score":0,"issues":[{"type":"检测类型","location":"原文片段","suggestion":"具体改法","severity":"高/中/低"}],"repetitions":["重复词1","重复词2"],"quote_abuse_count":0,"overall_feedback":"一句总体评价","ai_like_rate":0}',
  ])
}

export function rewriteParagraphPrompt(params: RewriteParagraphPromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '把下面这段文字改得更像人写的，但不要改动核心事件和信息。',
    section('原段落', params.originalParagraph),
    section('前文参考', params.contextBefore),
    section('额外要求', params.specificRequirements || '保持原意，让语言更自然、更贴人。'),
    section('改写原则', [
      '先保住情节和信息，再处理语气、句式和细节。',
      '少解释，多把心理落到动作、反应、对话里。',
      '拆掉明显模板句、万能词和假深刻表达。',
      '逐句检查搭配是否成立，把不符合常规汉语的表达改成准确说法。',
      '只输出改写后的纯文本，不要解释。',
    ].join('\n')),
    section('语言修复重点', buildHumanLanguageRules([
      '不要保留“物体死亡”“系统悲鸣”这类高歧义或不成立表达。',
    ])),
  ])
}

export function genericExpandPrompt(params: GenericExpandPromptInput): string {
  return renderPrompt([
    `扩写并整理【${params.contentType}】。要求是在原有想法上补足细节，而不是另起一套。`,
    sectionLines('现有信息', [
      `小说背景：${params.novelContext}`,
      `题材：${params.genreContext}`,
      `已有内容：${params.existingContent || '暂无'}`,
      params.requirements ? `额外要求：${params.requirements}` : '',
    ]),
    section('扩写要求', [
      '保留原始意图，优先补足具体细节和可落地的信息。',
      '少写空洞概念，多写人物处境、事件条件、使用场景或判断依据。',
      '语言简洁，不写百科，不写广告腔，不用字段标签堆砌。',
      '只输出纯文本，不要 Markdown，不要前言。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules()),
  ])
}

export function subplotExpandPrompt(params: SubplotExpandPromptInput): string {
  return renderPrompt([
    `完善小说《${params.novelTitle}》里的一条支线。支线要能反过来影响主线，而不是独立小故事。`,
    sectionLines('现有信息', [
      `题材：${params.genreContext}`,
      `主线概述：${params.mainPlot}`,
      `支线名称：${params.subplot.name || '未命名'}`,
      `涉及人物：${params.subplot.characters}`,
      `核心冲突：${params.subplot.conflict}`,
      `与主线关联：${params.subplot.mainlineLink}`,
      `预计收束章节：第${params.subplot.endChapter || 'X'}章`,
      params.requirements ? `额外要求：${params.requirements}` : '',
    ]),
    section('输出内容', [
      '写清支线的引爆点、发展节点、与主线交织的方式、收束方式、角色变化。',
      '每一部分都写具体事件，不要只写方向。',
      '人物行为必须符合已有性格和处境，不能为了推进支线硬转。',
      '直接输出纯文本支线设定，不要解释。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '支线描述优先写清具体矛盾和作用，不写抽象口号。',
    ])),
  ])
}

export function contentScoringPrompt(params: ContentScoringPromptInput): string {
  return renderPrompt([
    `从编辑和普通读者两种视角，评估下面这段【${params.contentType}】。`,
    sectionLines('背景信息', [
      `题材：${params.genreContext}`,
      `故事背景：${params.novelBackground}`,
    ]),
    section('待评价内容', params.content),
    section('评分维度', [
      '创新性：有没有明显套路感，是否有独特内容。',
      '丰富度：信息和层次是否足够，有没有可读的细节。',
      '自然度：语言是否像人写的，是否有明显模板腔、主谓宾搭配错误或对象类别错配。',
      '逻辑性：因果、设定、人物动机是否自洽。',
      '代入感：读者是否愿意继续看下去。',
    ].join('\n')),
    section('补充分析', [
      '给出 ai_like_rate，重点看抽象大词、模板句、动作套路、概念包装、引号强调，以及“电网的死亡”这类搭配错误。',
      'top_fixes 只列最值得先改的 3 处，要具体、可操作，最好直接给出更自然的替换说法。',
    ].join('\n')),
    '只输出 JSON：{"dimensions":[{"name":"创新性","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"丰富度","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"自然度","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"逻辑性","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"读者代入感","score":0,"feedback":"一句简评","suggestion":"具体改法"}],"ai_like_rate":0,"repetition_risk":"低/中/高","overall_score":0,"overall_feedback":"综合评价","top_fixes":["修改建议1","修改建议2","修改建议3"]}',
  ])
}

export const PROMPT_CATEGORIES = ['全部', '创作初始化', '人物系统', '大纲规划', '正文编写', '世界构建'] as const

export const PROMPT_CATALOG: PromptCatalogEntry[] = [
  {
    key: 'expandBackground',
    name: '背景扩充',
    description: '扩写开篇设定，生成背景、标题和简介。',
    category: '创作初始化',
    params: [
      { key: 'userBackground', label: '用户背景' },
      { key: 'genre', label: '题材' },
      { key: 'worldTemplateSummary', label: '世界观模板摘要' },
    ],
    template: expandBackgroundPrompt({
      userBackground: placeholder('userBackground'),
      genre: placeholder('genre'),
      worldTemplateSummary: placeholder('worldTemplateSummary'),
    }),
  },
  {
    key: 'protagonist',
    name: '主角生成',
    description: '生成可直接进入后续剧情设计的主角档案。',
    category: '人物系统',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'genre', label: '题材' },
      { key: 'worldSummary', label: '世界规则摘要' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'gender', label: '性别' },
      { key: 'surnameHint', label: '姓名方向' },
    ],
    template: protagonistPrompt({
      novelTitle: placeholder('novelTitle'),
      novelSynopsis: placeholder('novelSynopsis'),
      genre: placeholder('genre'),
      worldSummary: placeholder('worldSummary'),
      storyCore: placeholder('storyCore'),
      gender: placeholder('gender'),
      surnameHint: placeholder('surnameHint'),
    }),
  },
  {
    key: 'batchCharacter',
    name: '批量配角生成',
    description: '批量补出能服务主线的配角。',
    category: '人物系统',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'protagonistSummary', label: '主角摘要' },
      { key: 'existingNames', label: '已有人名' },
      { key: 'genre', label: '题材' },
      { key: 'worldSummary', label: '世界规则摘要' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'count', label: '数量' },
      { key: 'genderRatio', label: '性别比例' },
      { key: 'specialRequirements', label: '特殊要求' },
    ],
    template: batchCharacterPrompt({
      novelTitle: placeholder('novelTitle'),
      novelSynopsis: placeholder('novelSynopsis'),
      protagonistSummary: placeholder('protagonistSummary'),
      existingNames: placeholder('existingNames'),
      genre: placeholder('genre'),
      worldSummary: placeholder('worldSummary'),
      storyCore: placeholder('storyCore'),
      count: Number.NaN,
      genderRatio: placeholder('genderRatio'),
      specialRequirements: placeholder('specialRequirements'),
    }).replace('NaN', placeholder('count')),
  },
  {
    key: 'characterRelations',
    name: '关系网络生成',
    description: '根据已有角色整理关系网络和张力。',
    category: '人物系统',
    params: [
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'characterList', label: '人物列表' },
    ],
    template: characterRelationsPrompt({
      novelSynopsis: placeholder('novelSynopsis'),
      characterList: placeholder('characterList'),
    }),
  },
  {
    key: 'storyArcs',
    name: '故事弧规划',
    description: '规划连续推进的故事弧和支线落位。',
    category: '大纲规划',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'genre', label: '题材' },
      { key: 'storyGoal', label: '故事目标' },
      { key: 'coreConflict', label: '核心冲突' },
      { key: 'mainPlot', label: '主线剧情' },
      { key: 'subPlots', label: '支线剧情' },
      { key: 'ending', label: '结局方向' },
      { key: 'totalChapters', label: '总章节数' },
      { key: 'rhythmSummary', label: '节奏比例' },
      { key: 'background', label: '背景补充' },
      { key: 'protagonistReference', label: '主角称呼' },
      { key: 'protagonistRule', label: '主角命名规则' },
    ],
    template: buildStoryArcPlanningPrompt({
      novelTitle: placeholder('novelTitle'),
      genre: placeholder('genre'),
      storyGoal: placeholder('storyGoal'),
      coreConflict: placeholder('coreConflict'),
      mainPlot: placeholder('mainPlot'),
      subPlots: placeholder('subPlots'),
      ending: placeholder('ending'),
      totalChapters: Number.NaN,
      rhythmSummary: placeholder('rhythmSummary'),
      background: placeholder('background'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('totalChapters')),
  },
  {
    key: 'chapterOutline',
    name: '章节细纲生成',
    description: '为当前故事弧拆出逐章大纲。',
    category: '大纲规划',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'genre', label: '题材' },
      { key: 'storyGoal', label: '故事目标' },
      { key: 'coreConflict', label: '核心冲突' },
      { key: 'mainPlot', label: '主线剧情' },
      { key: 'arcName', label: '故事弧名称' },
      { key: 'arcGoal', label: '故事弧目标' },
      { key: 'arcSummary', label: '故事弧概述' },
      { key: 'chapterStart', label: '起始章节' },
      { key: 'chapterEnd', label: '结束章节' },
      { key: 'previousSummary', label: '前情摘要' },
      { key: 'characterStates', label: '人物状态' },
      { key: 'continuitySummary', label: '连续性记忆' },
      { key: 'openLoops', label: '未回收事项' },
      { key: 'worldRulesSummary', label: '世界规则摘要' },
      { key: 'protagonistReference', label: '主角称呼' },
      { key: 'protagonistRule', label: '主角命名规则' },
    ],
    template: buildChapterOutlinePlanningPrompt({
      novelTitle: placeholder('novelTitle'),
      genre: placeholder('genre'),
      storyGoal: placeholder('storyGoal'),
      coreConflict: placeholder('coreConflict'),
      mainPlot: placeholder('mainPlot'),
      arcName: placeholder('arcName'),
      arcGoal: placeholder('arcGoal'),
      arcSummary: placeholder('arcSummary'),
      chapterStart: Number.NaN,
      chapterEnd: Number.NaN,
      previousSummary: placeholder('previousSummary'),
      characterStates: placeholder('characterStates'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      worldRulesSummary: placeholder('worldRulesSummary'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterStart')).replace('NaN', placeholder('chapterEnd')),
  },
  {
    key: 'chapterWriting',
    name: '正文生成',
    description: '根据细纲和上下文写出章节正文。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'plotPoints', label: '章节大纲' },
      { key: 'emotionTone', label: '情绪基调' },
      { key: 'targetWords', label: '目标字数' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'currentArc', label: '当前故事弧' },
      { key: 'worldRules', label: '世界规则' },
      { key: 'characterStates', label: '人物状态' },
      { key: 'previousSummaries', label: '近章摘要' },
      { key: 'lastChapterEnding', label: '上章结尾' },
      { key: 'styleTemplate', label: '文风参考' },
      { key: 'continuitySummary', label: '连续性记忆' },
      { key: 'openLoops', label: '未回收事项' },
      { key: 'continuityNotes', label: '必须承接事项' },
      { key: 'timelineSummary', label: '时间轴关键节点' },
      { key: 'timelineOpenThreads', label: '时间轴待回收事项' },
      { key: 'protagonistReference', label: '主角称呼' },
      { key: 'protagonistRule', label: '主角命名规则' },
    ],
    template: buildChapterWritingPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      plotPoints: placeholder('plotPoints'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      styleTemplate: placeholder('styleTemplate'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
  {
    key: 'chapterSummary',
    name: '章节摘要生成',
    description: '为完成章节生成后续写作摘要。',
    category: '正文编写',
    params: [{ key: 'chapterContent', label: '章节内容' }],
    template: chapterSummaryPrompt(placeholder('chapterContent')),
  },
  {
    key: 'continuityState',
    name: '连续性记忆提炼',
    description: '从当前章节提炼后文必须记住的事实。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'arcName', label: '故事弧名称' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'summary', label: '本章摘要' },
      { key: 'chapterContent', label: '章节正文' },
    ],
    template: buildContinuityStatePrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      arcName: placeholder('arcName'),
      chapterGoal: placeholder('chapterGoal'),
      summary: placeholder('summary'),
      chapterContent: placeholder('chapterContent'),
    }).replace('NaN', placeholder('chapterNum')),
  },
  {
    key: 'aiCheck',
    name: 'AI 痕迹检测',
    description: '检测文本里的模板腔和 AI 写作痕迹。',
    category: '正文编写',
    params: [{ key: 'text', label: '待检测文本' }],
    template: aiCheckPrompt(placeholder('text')),
  },
  {
    key: 'rewriteParagraph',
    name: '段落重写',
    description: '保留情节信息，压低模板腔和 AI 痕迹。',
    category: '正文编写',
    params: [
      { key: 'originalParagraph', label: '原段落' },
      { key: 'contextBefore', label: '前文上下文' },
      { key: 'specificRequirements', label: '额外要求' },
    ],
    template: rewriteParagraphPrompt({
      originalParagraph: placeholder('originalParagraph'),
      contextBefore: placeholder('contextBefore'),
      specificRequirements: placeholder('specificRequirements'),
    }),
  },
  {
    key: 'contentScoring',
    name: '内容评分',
    description: '从编辑和读者两侧评估内容质量与 AI 痕迹。',
    category: '正文编写',
    params: [
      { key: 'contentType', label: '内容类型' },
      { key: 'content', label: '待评估内容' },
      { key: 'genreContext', label: '题材' },
      { key: 'novelBackground', label: '故事背景' },
    ],
    template: contentScoringPrompt({
      contentType: placeholder('contentType'),
      content: placeholder('content'),
      genreContext: placeholder('genreContext'),
      novelBackground: placeholder('novelBackground'),
    }),
  },
  {
    key: 'mapGeneration',
    name: '地图生成',
    description: '生成能承载剧情的三层地图结构。',
    category: '世界构建',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'worldSummary', label: '世界观摘要' },
      { key: 'genre', label: '题材' },
      { key: 'mapStructure', label: '地图结构' },
      { key: 'namedPlaces', label: '已命名地点' },
    ],
    template: mapGenerationPrompt({
      novelTitle: placeholder('novelTitle'),
      worldSummary: placeholder('worldSummary'),
      genre: placeholder('genre'),
      mapStructure: placeholder('mapStructure'),
      namedPlaces: placeholder('namedPlaces'),
    }),
  },
]
