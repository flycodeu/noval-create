import { buildRealityConstraintSummary, getBuiltinGenreRules } from './genre-system'

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
  genre?: string
  worldSummary?: string
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
  genreContext?: string
  worldSummary?: string
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

export type StoryAnchorField = 'story_goal' | 'core_conflict' | 'main_plot' | 'ending'

export interface StoryAnchorPromptInput {
  field: StoryAnchorField
  label: string
  novelBackground: string
  genre: string
  currentContent?: string
  relatedContext?: string
  protagonistReference?: string
  protagonistRule?: string
  requirements?: string
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

function getStoryAnchorGuidance(field: StoryAnchorField, label: string) {
  switch (field) {
    case 'story_goal':
      return {
        label,
        duty: '只写故事最后要抵达的目标、终局状态或核心命题。',
        requirements: [
          '回答“这本书最后要实现什么”，不要改写成过程描述。',
          '可以带出主题方向，但落点必须是明确结果，而不是抽象口号。',
        ],
        avoid: [
          '不要把中段剧情、阶段任务或具体场景塞进来。',
          '不要把阻碍、敌人或困难本身写成最终目标。',
          '不要复述主线推进或核心冲突。',
        ],
      }
    case 'core_conflict':
      return {
        label,
        duty: '只写阻碍目标实现的核心对立、不可回避的代价与持续张力。',
        requirements: [
          '回答“为什么这件事难以实现”，而不是“最后想实现什么”。',
          '写清对立双方、冲突来源或必须支付的代价。',
        ],
        avoid: [
          '不要写成结局目标、主题口号或人物愿望。',
          '不要用流水账代替冲突本身。',
          '不要换一种说法重复主线概述。',
        ],
      }
    case 'main_plot':
      return {
        label,
        duty: '只写围绕目标与冲突展开的关键事件链，强调因果推进、升级和转折。',
        requirements: [
          '回答“故事如何一步步推进到结局”，至少体现起点、升级、转折与逼近收束。',
          '主线必须显式承接故事目标和核心冲突，不能另起一条故事。',
        ],
        avoid: [
          '不要重新定义故事目标或核心冲突。',
          '不要只写抽象主题感受、人物评价或世界观说明。',
          '不要只列场景，不写事件之间的因果关系。',
        ],
      }
    case 'ending':
      return {
        label,
        duty: '只写故事最终如何收束、主要矛盾如何落地以及结局余波。',
        requirements: [
          '结局要回应既定目标、冲突和主线推进结果。',
          '说明最终状态，不要在结局字段里再铺一条新主线。',
        ],
        avoid: [
          '不要把尚未发生的中段情节写进结局字段。',
          '不要只写价值判断，不写结果落点。',
        ],
      }
  }
}

export const HUMAN_LANGUAGE_RULE_LINES = [
  '使用自然、可读的小说中文，先保证句子顺和意思准。',
  '先写清事实、动作、关系和后果，再让情绪与分量自然露出来。',
  '检查主语、谓语、宾语是否搭配准确，动作、状态和后果要符合对象类别。',
  '人或生物才能“死亡、呼吸、哭泣、思考”；电网、系统、组织、设施等非生物应改写为“瘫痪、崩溃、中断、停摆、瓦解”等准确说法。',
  '少用模板化引导词、抽象口号和假深刻表达，多写具体处境、判断依据和行为代价。',
  '普通概念、职业、情绪和判断不要随意加引号；只有称号、制度名、功法名、专有名词才保留引号。',
  '贴近当前题材常见的叙述气质、节奏和措辞密度，不模仿具体作者。',
  '只处理当前字段和当前任务，不擅自扩写到无关领域，不拼接没有直接关系的概念。',
  '如果输入没有明确涉及某个专业领域，不要擅自引入卡路里、感染概率、药理、金融指标、法律结论等外部概念。',
  '不要为了显得高级，硬把两个语义上没有直接关系的词并在一句里。',
  '一旦出现不自然搭配，优先改成读者最熟悉、最直白、最准确的常规说法。',
] as const

export function buildHumanLanguageRules(extraLines: string[] = []): string {
  return [...HUMAN_LANGUAGE_RULE_LINES, ...extraLines]
    .map((line) => `- ${line}`)
    .join('\n')
}

interface PromptGuardrailOptions {
  genre?: string
  background?: string
  storyCore?: string
  worldSummary?: string
  taskFocus: string
  extraContextLines?: string[]
  extraRealityLines?: string[]
  extraQualityLines?: string[]
}

function getGenreRealityBaseline(genre?: string): string {
  return buildRealityConstraintSummary(getBuiltinGenreRules(genre).writingConstraints)
}

export function buildContextAlignmentRules(params: {
  background?: string
  storyCore?: string
  worldSummary?: string
  taskFocus: string
  extraLines?: string[]
}): string {
  return [
    '只沿着当前背景、主题、世界规则和已知人物处境继续往下写。',
    '已有地点、势力、体系、资源和关系链优先复用，确有必要再新增。',
    '如果上下文不完整，选择最保守、最贴合当前题材和既有设定的延伸方案。',
    '每个新增事件或细节都要回答：为什么是现在、谁在推动、代价落在谁身上、之后改变了什么。',
    params.background ? '背景设定仍是本轮生成的第一锚点。' : '',
    params.storyCore ? '故事目标、核心冲突和主线推进是不能越界的硬边界。' : '',
    params.worldSummary ? '若给定世界摘要里没有支持某条规则、能力、机构或技术，就不要自行补造。' : '',
    params.taskFocus ? `本轮任务焦点：${params.taskFocus}` : '',
    ...(params.extraLines || []),
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

export function buildGenreRealityRules(params: {
  genre?: string
  worldSummary?: string
  extraLines?: string[]
}): string {
  return [
    '现实向题材默认要遵守常识、常规科学和常规物理，除非给定设定已经明确推翻了它们。',
    '幻想向题材可以有超常元素，但必须落在既定体系、等级、代价、触发条件和社会规则里。',
    getGenreRealityBaseline(params.genre),
    params.worldSummary ? '如果题材默认与已给定世界摘要冲突，优先服从已给定的世界摘要，但不能与现有事实相矛盾。' : '',
    ...(params.extraLines || []),
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

export function buildOutputQualityRules(extraLines: string[] = []): string {
  return [
    '先写具体事实、动作、条件和后果，再写情绪、意义或评价。',
    '不要写口号腔、平台文案腔、百科腔、空洞概括或假深刻结论。',
    '人物行为必须匹配身份、信息量、伤势、体力、资源、环境和利害压力。',
    '拿不准时，选择最直白、最符合常识的说法，不要硬造新奇感。',
    '如果设定里有超常能力，同时要交代触发条件、限制或代价。',
    ...extraLines,
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

function buildPromptGuardrailSections(options: PromptGuardrailOptions): string[] {
  return [
    section('上下文护栏', buildContextAlignmentRules({
      background: options.background,
      storyCore: options.storyCore,
      worldSummary: options.worldSummary,
      taskFocus: options.taskFocus,
      extraLines: options.extraContextLines,
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: options.genre,
      worldSummary: options.worldSummary,
      extraLines: options.extraRealityLines,
    })),
    section('输出质量底线', buildOutputQualityRules(options.extraQualityLines || [])),
  ]
}

export function buildStoryAnchorPrompt(params: StoryAnchorPromptInput): string {
  const guidance = getStoryAnchorGuidance(params.field, params.label)
  const protagonistReference = params.protagonistReference?.trim() || '主角'
  const protagonistRule = params.protagonistRule?.trim() || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。'

  return renderPrompt([
    `你在补《${params.label}》这一项，请只完成这一项。`,
    section('本项职责', guidance.duty),
    sectionLines('输入信息', [
      `题材：${params.genre}`,
      `小说背景：${params.novelBackground || '（暂无补充背景）'}`,
      `主角称呼：${protagonistReference}`,
      `主角命名规则：${protagonistRule}`,
    ]),
    section('已确定的关联设定', params.relatedContext || '暂无'),
    section('当前字段内容', params.currentContent || '暂无，请根据背景与已确定设定补全'),
    section('额外要求', params.requirements || ''),
    section('本次处理原则', [
      ...guidance.requirements,
      '只允许在当前背景、题材和已确定设定上深化，禁止改写成另一套故事。',
      '先补人物动机、因果关系和结果落点，再考虑气质和文气。',
      `本轮只处理《${params.label}》，不要越界代写其他字段。`,
      '如果上下文出现旧名字、占位名或彼此冲突的人名，统一按主角命名规则处理。',
      '与其他字段中的人物关系、事件因果和核心矛盾保持前后一致，不得漂移。',
      '如果原内容可用，保留它的核心方向，只补缺口和逻辑。',
      '禁止事项：',
      ...guidance.avoid.map((item) => `- ${item}`),
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '输出前自行检查搭配是否准确，不要保留物体被写成人或生物的表达。',
      '贴近当前题材常见的策划口径，但不要模仿具体作者。',
    ])),
    '输出要求：',
    '- 直接输出可落进表单的纯文本',
    '- 不要使用 Markdown、标题、列表或字段标签',
  ])
}
export const GLOBAL_WRITING_RULES = `你现在写的是可直接入稿的中文小说正文。

核心规则：
1. 先把事件、动作、条件和后果写清，再进情绪和意义。
2. 情绪要落在动作、反应、对话、停顿和细节上，不要用抽象评语代替。
3. 对话要像这个人在当下压力里真会说的话。
4. 句子保持自然，避免刻意对称、假深刻和过度修辞。
5. 无论什么时候，都要服从当前章节任务、人物状态、世界规则和连续性。
6. 主语、谓语、宾语必须搭配成立，不要给物体、系统或建筑安上只有人才有的生命状态。
7. 贴近当前题材常见的叙事质感，但不模仿具体作者。
8. 除非当前世界规则已经明确允许，不要自行发明新能力、技术跃迁、奇迹恒复、免费资源或瞬间全员达成一致。

高风险坏习惯：
- “突然”“不由得”“这一刻”“顷刻之间”这类万能起手
- 深吸一口气、攒紧拳头、瞪大眼睛、僵在原地这类套路动作
- 用命运、希望、成长或口号去覆盖具体处境和代价
- 给普通概念乱加引号
- 用破折号偷懒解释或做假揭示
- 为了显得深刻而硬造伪文艺句
- 写出“系统死亡”“城市哭泣”“门感到愤怒”这类不成立搭配
- 把重伤、断缺、秩序崩塌或等级差距写成零代价解决

输出：
- 只输出最终正文
- 只用纯文本分段`.trim()

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary: string
}): string {
  return renderPrompt([
    '你在补一份小说立项用的背景设定。只把开局底盘垫稳：世界处境、时代气味、人物起点和首轮冲突，不要把中后期剧情一次写完。',
    sectionLines('现有信息', [
      '用户背景：' + params.userBackground,
      '题材：' + params.genre,
      params.worldTemplateSummary ? '世界观参考：' + params.worldTemplateSummary : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.userBackground,
      worldSummary: params.worldTemplateSummary,
      taskFocus: '1. 写一段 300 到 500 字的扩展背景，只补当前可写的世界处境、日常规则、危险来源和人物起步位置。',
      extraQualityLines: ['标题和简介都要贴题材，避免万能热词和平台套路文案。'],
    }),
    section('任务', [
      '1. 写一段 300 到 500 字的扩展背景，只补当前可写的世界处境、日常规则、危险来源和人物起步位置。',
      '2. 给 3 个标题，分别偏人物、偏悬念、偏题材气质，名字要像正经小说，不要像宣传语。',
      '3. 写一段 150 到 220 字的简介，直接点明这本书开局最抓人的矛盾和阅读钩子。',
    ].join('\n')),
    section('写法要求', [
      '先沿用用户已有设想，再补缺口，不要另起一套世界观。',
      '背景只负责把开局写扎实，不提前剧透关键反转和结局。',
      '优先写具体处境、规则、限制、代价和冲突来源，少写宏大口号。',
      '标题和简介都要贴题材，避免万能热词和平台套路文案。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '背景、标题和简介都要像编辑会留下来的成稿，不要写成概念清单或广告文案。',
      '如果一句话可以更短、更直白，就不要故意写得玄。',
    ])),
    '只输出 JSON：{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}',
  ])
}

export function protagonistPrompt(params: ProtagonistPromptInput): string {
  return renderPrompt([
    '为这部小说确定主角档案。这个角色后面会直接进入故事弧、章节细纲和正文，所以信息必须能拿来写戏，不能只停在概念层。',
    sectionLines('小说信息', [
      '书名：' + params.novelTitle,
      '背景：' + params.novelSynopsis,
      '题材：' + params.genre,
      params.worldSummary ? '世界规则：' + params.worldSummary : '',
      params.storyCore ? '故事核心：' + params.storyCore : '',
      params.speciesSummary ? '种族生态：' + params.speciesSummary : '',
      params.factionSummary ? '势力结构：' + params.factionSummary : '',
      params.ecologySummary ? '角色生态：' + params.ecologySummary : '',
      params.mapSummary ? '地图蓝图：' + params.mapSummary : '',
      params.writingConstraints ? '语言约束：' + params.writingConstraints : '',
      '性别：' + params.gender,
      params.surnameHint ? '姓名方向：' + params.surnameHint : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      storyCore: params.storyCore,
      worldSummary: params.worldSummary,
      taskFocus: '这个人要能解释为什么能卷进主线、为什么会撑到后续关键选择。',
      extraQualityLines: ['优点、缺点、秘密、软肋和关系张力都要能互相咬合，别把角色写成完美设定包。'],
    }),
    section('命名要求', [
      '姓名要贴题材、时代和社会环境，优先顺口、可记、可读。',
      params.surnameHint ? '如果给了姓名方向，优先沿用，不要故意逆着来。' : '',
      '避免堆生僻字、堆设定词，名字一眼要能读出来。',
    ].filter(Boolean).join('\n')),
    section('人物要求', [
      '先写清主角眼下想要什么、缺什么、怕什么，再决定他会怎么做。',
      '背景经历必须落实到现在的判断、习惯、伤口、关系或行动方式里。',
      '这个人要能解释为什么能卷进主线、为什么会撑到后续关键选择。',
      '外貌只写辨识度和气质来源，不写空泛形容词堆砌。',
      '优点、缺点、秘密、软肋和关系张力都要能互相咬合，别把角色写成完美设定包。',
      '实体类型、种族、身份、势力归属和力量体系必须贴合现有规则，不默认只有普通人模板。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '档案要像编辑可直接交给作者继续写戏的人物卡，不要写悬浮鸡汤和伪深刻结论。',
      '贴近当前题材常见角色写法，但不要模仿具体作者。',
    ])),
    '只输出 JSON：{"surname":"","given_name":"","full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/境界/身份阶位","social_identity":"社会身份或阵营位置","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线/背景/主题的关联"],"appearance":"外貌3到4句，只写能认出来的细节","background":"180字以内，写关键经历以及它留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层最想得到的东西","deep_need":"真正缺失却不愿承认的需要","core_fear":"最怕失去或面对的东西","inner_conflict":"最核心的内在拉扯","hidden_secret":"不愿公开的秘密","moral_line":"轻易不会跨过的底线","self_deception":"一直拿来自我说服的谎话","trauma":"仍在影响现在的旧伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"在亲密或权力关系里的张力来源","resonance_point":"读者最容易共情的一点","character_arc":"后续可能的变化方向","first_impression":"第一次出场最抓人的地方"}',
  ])
}

export function batchCharacterPrompt(params: BatchCharacterPromptInput): string {
  return renderPrompt([
    '为小说《' + params.novelTitle + '》补出 ' + params.count + ' 个配角。每个人都要在后续剧情里承担明确作用，不能只是凑人头。',
    sectionLines('现有信息', [
      '小说背景：' + params.novelSynopsis,
      params.storyCore ? '故事核心：' + params.storyCore : '',
      '主角摘要：' + params.protagonistSummary,
      '已有人物：' + (params.existingNames || '无'),
      '题材：' + params.genre,
      params.worldSummary ? '世界规则：' + params.worldSummary : '',
      params.speciesSummary ? '种族生态：' + params.speciesSummary : '',
      params.factionSummary ? '势力结构：' + params.factionSummary : '',
      params.ecologySummary ? '角色生态：' + params.ecologySummary : '',
      params.mapSummary ? '地图蓝图：' + params.mapSummary : '',
      params.writingConstraints ? '语言约束：' + params.writingConstraints : '',
      '性别比例：' + params.genderRatio,
      params.specialRequirements ? '特殊要求：' + params.specialRequirements : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      storyCore: params.storyCore,
      worldSummary: params.worldSummary,
      taskFocus: '先把人物网补完整：主线推进位、对立位、辅助位、搅局位、情感或利益牵引位。',
      extraQualityLines: ['人物之间要有层次差异：有人强势、有人实用、有人隐忍、有人会制造额外麻烦，不要一批人一个腔调。'],
    }),
    section('生成要求', [
      '先把人物网补完整：主线推进位、对立位、辅助位、搅局位、情感或利益牵引位。',
      '每个人都要写清与主角、主线或某条支线的实际关系，不要只给一个空标签。',
      '人物之间要有层次差异：有人强势、有人实用、有人隐忍、有人会制造额外麻烦，不要一批人一个腔调。',
      '至少让一部分角色携带秘密、旧债、错位立场或利益冲突，这样后面才有戏。',
      '遵守现有世界规则、势力结构、地图和题材生态，不重名，不撞设定。',
      '贴近当前题材常见群像写法，但不要直接模仿具体作者。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '人物描述要像编辑会采纳的角色档案，不要写成悬浮文案。',
      '少用万能热词，多写这个人具体能做什么、会卡住谁、会被什么反噬。',
    ])),
    '只输出 JSON 数组：[{"full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"role_type":"major/minor/antagonist/supporting","occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"background":"80到120字，写关键经历和现状","personality_traits":["特点1","特点2"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"人物反差点","relationship_tension":"与主角或关键人物的张力","resonance_point":"读者共情点","character_arc":"后续变化方向","relation_to_protagonist":"与主角的关系与拉扯","first_impression":"第一次出场的印象","appearance":"外貌1到2句，只写辨识度","appear_chapter":1}]',
  ])
}

export function regenerateCharacterPrompt(params: RegenerateCharacterPromptInput): string {
  return renderPrompt([
    '根据最新上下文重写并深化同一个角色的档案。注意，这是返修，不是重新发明一个新人。',
    sectionLines('锁定条件', [
      '小说：' + params.novelTitle,
      '背景：' + params.novelSynopsis,
      '题材：' + params.genre,
      params.worldSummary ? '世界规则：' + params.worldSummary : '',
      params.storyCore ? '故事核心：' + params.storyCore : '',
      params.speciesSummary ? '种族生态：' + params.speciesSummary : '',
      params.factionSummary ? '势力结构：' + params.factionSummary : '',
      params.ecologySummary ? '角色生态：' + params.ecologySummary : '',
      params.writingConstraints ? '语言约束：' + params.writingConstraints : '',
      '主角命名规则：' + params.protagonistRule,
      '角色姓名必须保留：' + params.lockedName,
      '角色类型必须保留：' + params.lockedRoleType,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      storyCore: params.storyCore,
      worldSummary: params.worldSummary,
      taskFocus: '优先修正旧档案里不贴合主线、不贴合关系网、或和世界规则脱节的部分。',
      extraQualityLines: ['让优点、缺点、秘密、软肋和利益立场彼此咬合，避免空转的复杂。'],
    }),
    section('当前人物旧档案', params.currentProfile),
    section('相关人物', params.relatedCharacters || '暂无'),
    section('现有关系信息', params.relationSummary || '暂无'),
    section('返修要求', [
      '保留同一个人的身份、姓名和角色功能，不得改名换壳。',
      '优先修正旧档案里不贴合主线、不贴合关系网、或和世界规则脱节的部分。',
      '新档案要能解释这个人现在为什么会这么想、这么做、这么处理关系。',
      '如果一个设定很酷但和主线没有关系，宁可收住，也不要继续往上堆。',
      '让优点、缺点、秘密、软肋和利益立场彼此咬合，避免空转的复杂。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '所有字段都要写成清楚、可落地的人物信息，不要写成总结式空话。',
      '减少概念包装，优先写行为依据、关系拉扯和代价。',
    ])),
    '只输出 JSON：{"full_name":"' + params.lockedName + '","role_type":"' + params.lockedRoleType + '","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"appearance":"外貌3到4句，突出辨识度","background":"180字以内，写关键经历和留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"与关键人物关系里的张力","resonance_point":"读者最容易共情的一点","character_arc":"后续变化方向","first_impression":"第一次出场印象","appear_chapter":1}',
  ])
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  return renderPrompt([
    '为小说整理一张能直接服务剧情的人物关系网。重点不是关系名词，而是谁会拉扯谁、利用谁、亏欠谁、护着谁。',
    sectionLines('输入信息', [
      '小说背景：' + params.novelSynopsis,
      '人物列表：\n' + params.characterList,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      worldSummary: params.worldSummary,
      taskFocus: '优先保留会影响剧情推进的关系，别把无关社交都塞进去。',
      extraQualityLines: ['不是所有人都必须互相认识，关系疏密要合理。'],
    }),
    section('关系要求', [
      '关系要具体，能看出历史、利益、情感或权力位置，不要只写朋友、同事这种空标签。',
      '不是所有人都必须互相认识，关系疏密要合理。',
      '要区分双向和单向，尤其是利用、暗恋、仇视、提防这类不对称关系。',
      'description 直接写可见互动方式或真实拉扯，不写抽象判断。',
      '优先保留会影响剧情推进的关系，别把无关社交都塞进去。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '关系描述要像真实人物之间会发生的拉扯，不要写成概念句或价值判断。',
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
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.worldSummary,
      worldSummary: params.worldSummary,
      taskFocus: '地点之间要有基本地理逻辑和父子层级逻辑，不要像随机抽卡。',
      extraRealityLines: ['地图层级严格服从题材蓝图，不要把丧尸题材写成宗门结构，也不要把仙侠地图写成现代行政区模板。'],
      extraQualityLines: ['剧情关联要写具体事件或用途，不写“重要地点”这种空话。'],
    }),
    section('生成要求', [
      '命名要贴合题材和文化背景，不要串味。',
      '每个地点既要有氛围，也要有存在价值，最好能看出会承载什么事件。',
      '地点之间要有基本地理逻辑和父子层级逻辑，不要像随机抽卡。',
      '地图层级严格服从题材蓝图，不要把丧尸题材写成宗门结构，也不要把仙侠地图写成现代行政区模板。',
      '第一层数量是根节点总数，必须严格等于要求。',
      '从第二层开始，数量要求表示“每个父节点都要生成多少个直属子节点”，不是整张地图共享一个总数。',
      '如果要求是“2 个国家 / 每国 3 个区域 / 每区域 4 个地点”，就必须输出 2 -> 3 -> 4 的父子扶出结构。',
      '剧情关联要写具体事件或用途，不写“重要地点”这种空话。',
      'children 只能放直属下一层节点，不能跳层。',
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
    '把这部小说拆成一组连续推进的故事弧。你现在做的是长篇结构规划，不是写宣传提纲。',
    sectionLines('项目背景', [
      '书名：' + params.novelTitle,
      '题材：' + (params.genre || '未知题材'),
      params.background ? '故事背景：' + params.background : '',
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.background,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.ending].filter(Boolean).join('\n'),
      taskFocus: '每个故事弧都要回答：这一段推进了什么、加压了什么、把什么交给下一段。',
      extraQualityLines: ['先保证主线因果顺，再安排支线落位；不要为了平均分配章节硬拆结构。'],
    }),
    sectionLines('核心约束', [
      '故事核心目标：' + (params.storyGoal || '未提供'),
      '核心冲突：' + (params.coreConflict || '未提供'),
      '主线剧情：' + (params.mainPlot || '未提供'),
      '支线剧情：' + (params.subPlots || '暂无'),
      '结局方向：' + (params.ending || '未提供'),
      '节奏比例：' + (params.rhythmSummary || '未配置'),
      '预计总章节：' + params.totalChapters + '章',
    ]),
    section('规划要求', [
      '规划 3 到 5 个故事弧，章节范围必须连续、无重叠、无空档。',
      '每个故事弧都要回答：这一段推进了什么、加压了什么、把什么交给下一段。',
      'key_turns 只写会改变量势的具体事件或决定，不写“矛盾升级”“命运转折”这种空话。',
      'subplot_links 要明确哪条支线在这里进入、发酵、反咬或回收。',
      '先保证主线因果顺，再安排支线落位；不要为了平均分配章节硬拆结构。',
      '最后一个故事弧必须负责主线收束，并给主要支线留出回扣空间。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      'summary、arc_goal 和 key_turns 都写成普通编辑能直接接手的结构说明，不要写策划黑话。',
    ])),
    '只输出 JSON 数组：[{"arc_name":"","stage":"铺垫/升级/高潮/收束","chapter_start":1,"chapter_end":10,"arc_goal":"本弧必须完成的推进","key_turns":["具体转折1","具体转折2"],"subplot_links":["某条支线如何介入/推进/回收"],"pacing":"快/中/慢","summary":"40到80字，写清这一弧到底发生了什么"}]',
  ])
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  return renderPrompt([
    '为当前故事弧拆分章节大纲。每一章都要能回答三个问题：这一章完成什么、承接什么、把什么递给下一章。',
    sectionLines('项目信息', [
      '书名：' + params.novelTitle,
      '题材：' + (params.genre || '未知题材'),
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
    ]),
    sectionLines('主线约束', [
      '故事核心目标：' + (params.storyGoal || '未提供'),
      '核心冲突：' + (params.coreConflict || '未提供'),
      '主线剧情：' + (params.mainPlot || '未提供'),
    ]),
    sectionLines('当前故事弧', [
      '名称：' + params.arcName,
      '目标：' + (params.arcGoal || '未提供'),
      '概述：' + (params.arcSummary || '未提供'),
      '章节范围：第' + params.chapterStart + '章到第' + params.chapterEnd + '章',
    ]),
    sectionLines('连续性上下文', [
      params.previousSummary ? '前情摘要：\n' + params.previousSummary : '',
      params.continuitySummary ? '连续性记忆：\n' + params.continuitySummary : '',
      params.openLoops ? '未回收事项：\n' + params.openLoops : '',
      params.characterStates ? '关键人物状态：\n' + params.characterStates : '',
      params.worldRulesSummary ? '世界规则：\n' + params.worldRulesSummary : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.arcGoal].filter(Boolean).join('\n'),
      worldSummary: params.worldRulesSummary,
      taskFocus: '每章 目标 必须服务本弧目标，合起来能看出主线持续推进。',
      extraQualityLines: ['章节之间要有轻重起伏，不能每章都像同一个节奏模板。'],
    }),
    section('生成要求', [
      '每章 goal 必须服务本弧目标，合起来能看出主线持续推进。',
      'plot_points 按发生顺序写具体事件，不写“制造冲突”“推进剧情”这种空话。',
      'bridge_in 写清这章接住了什么，bridge_out 写清这章把什么递给下一章。',
      '章节之间要有轻重起伏，不能每章都像同一个节奏模板。',
      '优先安排真正需要上场的人物和地点，别把所有线索都塞进每一章。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '章节标题、目标和事件点都要写得清楚直接，避免抽象套话。',
    ])),
    '只输出 JSON 数组：[{"chapter_num":' + params.chapterStart + ',"title":"","goal":"本章要完成的推进","plot_points":["事件1","事件2","事件3"],"characters":["登场人物A","登场人物B"],"location":"主要场景","emotion_tone":"情绪基调","bridge_in":"这章承接了什么","bridge_out":"这章给下章留下什么"}]',
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
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.background,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.ending].filter(Boolean).join('\n'),
      worldSummary: [params.worldRulesSummary, params.timelineRules].filter(Boolean).join('\n'),
      taskFocus: '每个事件都要写清楚时间标签、事件名称、事件作用、主角是否在场、主角做了什么、直接结果、后续遗留问题。',
      extraRealityLines: ['事件描述要像人类策划记录，不要写空洞口号，不要给普通概念随意加引号。'],
    }),
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
    '先为这一章做场景计划，再进入正文写作。场景计划是写作施工单，不是悬浮策划文案。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      '目标字数：' + params.targetWords + ' 字左右',
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      extraContextLines: ['每个场景写清：这一段要完成什么、当前冲突是什么、谁在场、会用到什么关键物品、必须交代什么。'],
      extraRealityLines: ['优先处理章节任务和因果推进，不要为了花样强行加戏。'],
    }),
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
      '拆成 4 到 7 个场景或连续段落，每一段都要能直接落成正文。',
      '每个场景写清：这一段要完成什么、当前冲突是什么、谁在场、会用到什么关键物品、必须交代什么。',
      '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      '优先处理章节任务和因果推进，不要为了花样强行加戏。',
      'exit_hook 只写最自然的收尾钩子，不要故作玄虚。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '场景目标和冲突都写具体事实，不写“命运转折”“真正成长”这种空话。',
    ])),
    '只输出 JSON 数组：[{"scene_order":1,"scene_title":"场景名","purpose":"这一段必须完成什么","location":"地点或空间","time_anchor":"时间标签","present_characters":["人物A"],"key_items":["物品A"],"conflict":"这一段最直接的冲突","beat":"这一段发生的关键动作","must_cover":["必须交代1","必须交代2"],"exit_hook":"如何推到下一段"}]',
  ])
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '下面是这一章的任务卡。先吃透任务，再直接写正文。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      '目标字数：' + params.targetWords + ' 字左右',
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '先把事件链、动作链和后果链写顺，再让情绪自然浮出来。',
      extraContextLines: ['只写和本章任务有关的场景，不要为了凑字数平铺日常。'],
      extraRealityLines: ['遇到不准确搭配，优先改成读者最熟悉、最准确的常规说法。'],
    }),
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
      '先把事件链、动作链和后果链写顺，再让情绪自然浮出来。',
      '人物说话要像这个人当下会说的话，别让所有角色一个语气。',
      '只写和本章任务有关的场景，不要为了凑字数平铺日常。',
      '如果给了文风参考，只借叙述气质、视角和句子密度，不模仿具体作者。',
      '遇到不准确搭配，优先改成读者最熟悉、最准确的常规说法。',
      '只输出正文，不要解释。',
    ].join('\n')),
  ])
}

export function buildChapterDraftPrompt(params: ChapterRewritePromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '先根据场景计划写出一版完整初稿。重点是把事情写顺、把承接写准，先不要追求花哨修辞。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      '目标字数：' + params.targetWords + ' 字左右',
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '只按场景计划推进，不跳场景，不漏 必须交代项。',
      extraContextLines: ['只按场景计划推进，不跳场景，不漏 必须交代项。'],
      extraRealityLines: ['人物状态、物品去向、地点变换和事件顺序必须写准，避免后面大修。'],
    }),
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
      '只按场景计划推进，不跳场景，不漏 must_cover。',
      '先把行为、对话、信息交接和后果写清，再处理气氛。',
      '人物状态、物品去向、地点变换和事件顺序必须写准，避免后面大修。',
      '如果某段只有情绪没有动作或结果，补上能落地的外部承载。',
      '只输出初稿正文，不要解释。',
    ].join('\n')),
  ])
}

export function buildChapterReviewPrompt(params: ChapterReviewPromptInput): string {
  return renderPrompt([
    '你是本书的连续性审校编辑。只指出会真正影响后续章节的问题：连续性断裂、上下文漂移、常识或规则违反、因果薄弱、铺垫落空、以及明显的 AI 腔。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
    ]),
    ...buildPromptGuardrailSections({
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '只找出真正砸掉上下文、真实度、连续性或人话感的问题。',
      extraQualityLines: ['优先给出具体修法，不要给空泛评论。'],
    }),
    section('本章目标', params.chapterGoal),
    section('场景计划', params.scenePlan),
    section('小说核心', params.storyCore),
    section('当前故事弧', params.currentArc),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('关键物品与去向', params.itemSummary),
    section('连续性记忆', params.continuitySummary),
    section('未回收事项', params.openLoops),
    section('时间轴锚点', params.timelineSummary),
    section('长期记忆', params.longTermMemory),
    section('结构体检提醒', params.consistencyNotes),
    section('待审初稿', params.draftContent),
    section('输出规则', [
      '只保留真正值得修的问题。',
      'critical_fixes 最多 5 条，且必须是可直接执行的修改动作。',
      'continuity_risks 只写连续性、伏笔、状态跟踪、物品跟踪或时间顺序问题。',
      'context_drift_risks 只写脱离既定背景、主题、世界规则或人物动机的问题。',
      'realism_risks 只写常识、科学、物理、资源、伤病、秩序或能力规则问题。',
      'language_risks 只写 AI 腔、抽象化、搭配错误、空洞抒情或不自然表达。',
      'missing_payoffs 只写本章已经抛出但没有落地的铺垫。',
      'strengths 只写已经成立且应该保留的具体优点。',
      'severity 只能是 low / medium / high。',
      '出现 high 级问题时 rewrite_required 必须是 true，其余情况可以是 false。',
      'revision_brief 用 60 到 120 字中文写清修改方向。',
    ].join('\n')),
    '只输出 JSON：{"summary":"总体判断","critical_fixes":["必改 1"],"continuity_risks":["连续性风险 1"],"context_drift_risks":["漂移风险 1"],"realism_risks":["真实度风险 1"],"language_risks":["语言风险 1"],"missing_payoffs":["未落地伏笔 1"],"strengths":["优点 1"],"severity":"medium","rewrite_required":true,"revision_brief":"修订方向摘要"}',
  ])
}

export function buildChapterRewritePrompt(params: ChapterRewritePromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '把这一章重写成可直接入稿的版本。先修连续性、因果、人物状态、真实度、时间和物品准确性，最后再打磨语言。',
    sectionLines('章节信息', [
      '小说：' + params.novelTitle,
      '章节：第' + params.chapterNum + '章 ' + params.chapterTitle,
      '主角称呼：' + params.protagonistReference,
      '主角命名规则：' + params.protagonistRule,
      '目标字数：' + params.targetWords,
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '只在既有上下文内重写，同时修复连续性、真实度和语言风险。',
      extraContextLines: ['不要通过删掉剧情压力或改写章节目标来假装解决上下文问题。'],
      extraRealityLines: ['如果审校指出反应、伤势、代价、移动跳跃或能力使用不合理，必须在正文里明确修正。'],
    }),
    section('场景计划', params.scenePlan),
    section('当前稿件', params.draftContent),
    section('审校意见', params.reviewNotes),
    section('本章目标', params.chapterGoal),
    section('当前故事弧', params.currentArc),
    section('小说核心', params.storyCore),
    section('世界规则', params.worldRules),
    section('人物当前状态', params.characterStates),
    section('关键物品与去向', params.itemSummary),
    section('上章结尾', params.lastChapterEnding),
    section('近章摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    section('必须承接', params.continuityNotes),
    section('未回收事项', params.openLoops),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('长期记忆', params.longTermMemory),
    section('结构体检提醒', params.consistencyNotes),
    section('重写要求', [
      '已经成立的段落可以保留，但凡是影响成稿质量的都要修。',
      '如果场景计划里的 must_cover 漏了，补上。',
      '先修因果、指代清晰度、节奏、人物反应和真实度，最后再抛光语言。',
      '删掉空洞抒情、模板句和解释性旁白，把情绪放回动作、对话和细节里。',
      '在同一轮里一起修好上下文漂移、常识失效、规则越界、零代价奇迹和 AI 腔。',
      '只输出重写后的最终正文。',
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
    ...buildPromptGuardrailSections({
      background: params.summary,
      taskFocus: '只保留清楚、可验证的事实，不写情绪化判断和抽象口号。',
      extraQualityLines: ['每条尽量写成短句，具体、可复用。'],
    }),
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
    section('上下文护栏', buildContextAlignmentRules({
      taskFocus: '只总结具体事实、状态变化和下一章最自然的承接点。',
    })),
    section('输出质量底线', buildOutputQualityRules([
      '不要把不确定的解读升级成硬事实。',
    ])),
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
    '检查这段小说文字里的 AI 指纹，以及会让读者出戏的真实度或上下文问题。',
    section('待检查文本', text),
    section('真实度护栏', buildGenreRealityRules({
      extraLines: ['同时标出上下文漂移、不合理恢复、不合理移动、不可能的资源结果，以及缺乏规则支撑的能力使用。'],
    })),
    section('检查重点', [
      '1. 用破折号偷懒解释或做假揭示',
      '2. 用引号抬高普通概念',
      '3. 抽象口号压过具体场景材料',
      '4. 硬造伪文艺句或模板抒情',
      '5. 万能引子和套路肌体反应',
      '6. 主谓宾逻辑断裂或对象类别错配',
      '7. 伤病、断缺、秩序、距离或能力上限被零代价解决',
    ].join('\n')),
    section('输出规则', [
      'issues.location 最多引用原文 15 个字。',
      'suggestion 必须是可直接执行的修改方向。',
      'overall_feedback 用一句话概括最主要的问题。',
      '如果发现“电网死亡”这类对象类别错配，要明确建议改成“电网瘫痪”“电力中断”“系统崩溃”这类精确说法。',
    ].join('\n')),
    '只输出 JSON：{"score":0,"issues":[{"type":"问题类型","location":"原文位置","suggestion":"具体修改方向","severity":"high/medium/low"}],"repetitions":["重复 1","重复 2"],"quote_abuse_count":0,"overall_feedback":"一句结论","ai_like_rate":0}',
  ])
}

export function rewriteParagraphPrompt(params: RewriteParagraphPromptInput): string {
  return renderPrompt([
    GLOBAL_WRITING_RULES,
    '把下面这段文字改得更像人写的，但不要改动核心事件和信息。',
    section('原段落', params.originalParagraph),
    section('前文参考', params.contextBefore),
    section('额外要求', params.specificRequirements || '保持原意，让语言更自然、更贴人。'),
    ...buildPromptGuardrailSections({
      genre: params.genreContext,
      background: params.contextBefore,
      worldSummary: params.worldSummary,
      taskFocus: '先保住情节和信息，再处理语气、句式和细节。',
      extraQualityLines: ['逐句检查搭配是否成立，把不符合常规汉语的表达改成准确说法。'],
    }),
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
    '扩写并整理【' + params.contentType + '】。要求是在原有想法上补足细节，而不是另起一套。',
    sectionLines('现有信息', [
      '小说背景：' + params.novelContext,
      '题材：' + params.genreContext,
      '已有内容：' + (params.existingContent || '暂无'),
      params.requirements ? '额外要求：' + params.requirements : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genreContext,
      background: params.novelContext,
      taskFocus: '只处理当前内容类型，不跳出去发明无关设定、专业指标或跨领域比喻。',
      extraQualityLines: ['先补事实、条件、关系、限制、用途和代价，再谈气质或意义。'],
    }),
    section('扩写要求', [
      '保留原始意图，优先补足能直接写进后续流程的细节。',
      '先补事实、条件、关系、限制、用途和代价，再谈气质或意义。',
      '如果原内容已经成立，就顺着往下补，不要推翻重来。',
      '只处理当前内容类型，不跳出去发明无关设定、专业指标或跨领域比喻。',
      '语言紧一点，少写套话和百科说明。',
      '只输出纯文本，不要 Markdown，不要前言。',
    ].join('\n')),    section('语言要求', buildHumanLanguageRules([
      '贴近当前题材常见写法，但不要模仿具体作者。',
    ])),
  ])
}

export function subplotExpandPrompt(params: SubplotExpandPromptInput): string {
  return renderPrompt([
    '完善小说《' + params.novelTitle + '》里的一条支线。支线必须反过来影响主线、人物关系或主题推进，不能写成独立番外。',
    sectionLines('现有信息', [
      '题材：' + params.genreContext,
      '主线概述：' + params.mainPlot,
      '支线名称：' + (params.subplot.name || '未命名'),
      '涉及人物：' + params.subplot.characters,
      '核心冲突：' + params.subplot.conflict,
      '与主线关联：' + params.subplot.mainlineLink,
      '预计收束章节：第' + (params.subplot.endChapter || 'X') + '章',
      params.requirements ? '额外要求：' + params.requirements : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genreContext,
      storyCore: params.mainPlot,
      taskFocus: '写清支线的引爆点、推进节点、转折、与主线交织的位置、收束方式和留下的余波。',
      extraQualityLines: ['支线最好至少改变一层关系、一次判断或一项局势，不然就不值得保留。'],
    }),
    section('输出内容', [
      '写清支线的引爆点、推进节点、转折、与主线交织的位置、收束方式和留下的余波。',
      '每一部分都写具体事件，不要只写方向或主题口号。',
      '人物行为必须符合现有性格、立场和处境，不能为了让支线成立硬拧。',
      '支线最好至少改变一层关系、一次判断或一项局势，不然就不值得保留。',
      '直接输出纯文本支线设定，不要解释。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '支线描述优先写清具体矛盾和作用，不写抽象口号。',
      '贴近当前题材常见写法，但不要模仿具体作者。',
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
    section('上下文护栏', buildContextAlignmentRules({
      background: params.novelBackground,
      taskFocus: '从当前背景和题材出发给文本打分，不要拿它去和一个虚构的“更好版本”比较。',
    })),
    section('真实度护栏', buildGenreRealityRules({
      genre: params.genreContext,
      extraLines: ['把上下文贴合度、真实度贴合度和常识贴合度也纳入逻辑质量评价。'],
    })),
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
      '所有建议必须基于当前文本本身，不得发明额外设定、专业指标、概率判断或跨领域概念。',
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
