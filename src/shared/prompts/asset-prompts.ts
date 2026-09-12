import { getBuiltinGenreRules } from '../genre-system'
import type {
  BatchCharacterPromptInput,
  CharacterRelationsPromptInput,
  FactionSystemExpandInput,
  GenericExpandPromptInput,
  MapGenerationPromptInput,
  PowerSystemExpandInput,
  ProtagonistPromptInput,
  RegenerateCharacterPromptInput,
  SubplotExpandPromptInput,
} from './prompt-types'
import {
  buildHumanLanguageRules,
  buildPromptGuardrailSections,
  buildVariationHint,
  renderPrompt,
  section,
  sectionLines,
} from './prompt-common'

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary: string
}): string {
  const genreKey = getBuiltinGenreRules(params.genre).genreProfile.key
  const isModernMystery = genreKey === 'modern-mystery'

  const taskLines = [
    '1. 写一段 300 到 500 字的扩展背景，只补当前可写的世界处境、日常规则、危险来源和人物起步位置。',
    '2. 给 3 个标题，分别偏人物、偏悬念、偏题材气质，名字要像正经小说，不要像宣传语。',
    '3. 写一段 150 到 220 字的简介，直接点明这本书开局最抓人的矛盾和阅读钩子。',
    ...(isModernMystery ? ['4. 如果题材是现代悬疑，背景里必须交代异常事件入口、调查第一道阻力和现实场域纹理。'] : []),
  ]

  const writingLines = [
    '先沿用用户已有设想，再补缺口，不要另起一套世界观。',
    '背景只负责把开局写扎实，不提前剧透关键反转和结局。',
    '优先写具体处境、规则、限制、代价和冲突来源，少写宏大口号。',
    '标题和简介都要贴题材，避免万能热词和平台套路文案。',
    ...(isModernMystery ? [
      '现代悬疑要优先使用旧案、档案、监控、通联、医院记录、报社旧闻和厂区空间这类现实线索载体。',
      '不要只写“有秘密”或“气氛压抑”，要写出谁在封口、谁在拦人、谁的权限或利害让事情难以继续。',
      '标题尽量从证据载体、地点纹理、时间锚点和职业现场取词，不要堆“迷雾”、“深渊”、“命运”等万能词。',
      '如果用户已明确给了人名地名，延用并保持现实质感；如果没给，就继续使用泛称。',
    ] : []),
  ]

  const languageLines = [
    '背景、标题和简介都要像编辑会留下来的成稿，不要写成概念清单或广告文案。',
    '如果一句话可以更短、更直白，就不要故意写得玄。',
    ...(isModernMystery ? ['现代悬疑的句子要克制、准确、像真实世界里的记录和叙述，而不是刻意拿腔调气氛。'] : []),
  ]

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
      extraQualityLines: [
        '标题和简介都要贴题材，避免万能热词和平台套路文案。',
        ...(isModernMystery ? ['如果是现代悬疑，标题和简介都要优先从证据、地点、时间或机构阻力取词。'] : []),
      ],
    }),
    section('任务', taskLines.join('\n')),
    section('写法要求', writingLines.join('\n')),
    section('语言要求', buildHumanLanguageRules(languageLines)),
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
      '允许主角在早期和中期出现恐惧、犹豫、误判、嫉妒、失望或心软，别做成天降满配人设。',
      '成长至少落到能力、关系、认知、责任、资源或道德选择中的两项，不要只写成变强。',
      '背景经历必须落实到现在的判断、习惯、伤口、关系或行动方式里。',
      '这个人要能解释为什么能卷进主线、为什么会撑到后续关键选择。',
      '外貌只写辨识度和气质来源，不写空泛形容词堆砌。',
      '优点、缺点、秘密、软肋和关系张力都要能互相咬合，别把角色写成完美设定包。',
      '实体类型、种族、身份、势力归属和力量体系必须贴合现有规则，不默认只有普通人模板。',
      '心理维度之间必须互相咬合形成因果链：core_fear 必须直接解释 self_deception 为什么成立，trauma 必须影响 inner_conflict 的具体内容，surface_desire 和 deep_need 之间必须存在具体矛盾而非抽象对立。不允许每个字段独立编一套说辞。',
      'dramatic_engine（主角戏剧引擎）是这个人物最关键的一栏：用一句话点出贯穿全书、能持续制造戏的核心装置——错位、反讽、隐藏身份、双重立场、致命秘密或某种别人不知道的知识/视角落差。它必须能解释主角在几乎每一场戏里的独特选择和张力来源，让读者始终比某些角色多知道一层。避免写成普通的“性格”或“目标”，要写成“引擎”：一旦启动就能反复产出戏剧火花。举例形态（不要照抄）：现代灵魂困在古代身份里、卧底身在敌营、背负着足以颠覆自身阵营的秘密、明面弱势暗中掌握关键筹码。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '档案要像编辑可直接交给作者继续写戏的人物卡，不要写悬浮鸡汤和伪深刻结论。',
      '贴近当前题材常见角色写法，但不要模仿具体作者。',
    ])),
    '只输出 JSON：{"surname":"","given_name":"","full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/境界/身份阶位","social_identity":"社会身份或阵营位置","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线/背景/主题的关联"],"appearance":"外貌3到4句，只写能认出来的细节","background":"180字以内，写关键经历以及它留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层最想得到的东西","deep_need":"真正缺失却不愿承认的需要","core_fear":"最怕失去或面对的东西","inner_conflict":"最核心的内在拉扯","hidden_secret":"不愿公开的秘密","moral_line":"轻易不会跨过的底线","self_deception":"一直拿来自我说服的谎话","trauma":"仍在影响现在的旧伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"在亲密或权力关系里的张力来源","resonance_point":"读者最容易共情的一点","dramatic_engine":"贯穿全书、能反复制造戏的核心装置（错位/反讽/隐藏身份/双重立场/致命秘密/知识落差），要能解释主角几乎每场戏的独特选择","character_arc":"后续可能的变化方向","first_impression":"第一次出场最抓人的地方"}',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
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
      '每个角色的心理维度必须形成因果链：core_fear 解释 self_deception，trauma 影响 inner_conflict，surface_desire 和 deep_need 之间有具体矛盾。不允许每个字段独立编一套说辞。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '人物描述要像编辑会采纳的角色档案，不要写成悬浮文案。',
      '少用万能热词，多写这个人具体能做什么、会卡住谁、会被什么反噬。',
    ])),
    '只输出 JSON 数组：[{"full_name":"","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"role_type":"major/minor/antagonist/supporting","occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"background":"80到120字，写关键经历和现状","personality_traits":["特点1","特点2"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"人物反差点","relationship_tension":"与主角或关键人物的张力","resonance_point":"读者共情点","character_arc":"后续变化方向","relation_to_protagonist":"与主角的关系与拉扯","first_impression":"第一次出场的印象","appearance":"外貌1到2句，只写辨识度","appear_chapter":1}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
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
    '只输出 JSON：{"full_name":"' + params.lockedName + '","role_type":"' + params.lockedRoleType + '","entity_type":"human/undead/beast/immortal/nonhuman","species":"角色种族","gender":"","age":0,"occupation":"","rank_level":"当前等级/阶位","social_identity":"社会身份","faction_names":["势力1"],"power_system_names":["体系1"],"context_hooks":["与主线或主题的关联"],"appearance":"外貌3到4句，突出辨识度","background":"180字以内，写关键经历和留下的影响","personality_traits":["特点1","特点2","特点3"],"flaws":["缺点1","缺点2"],"habits":["习惯1"],"goals":"当前追求","surface_desire":"表层欲望","deep_need":"深层需要","core_fear":"核心恐惧","inner_conflict":"内在矛盾","hidden_secret":"隐藏秘密","moral_line":"道德底线","self_deception":"自我欺骗","trauma":"旧伤或创伤","contradiction":"最能体现复杂度的反差点","relationship_tension":"与关键人物关系里的张力","resonance_point":"读者最容易共情的一点","dramatic_engine":"贯穿全书、能反复制造戏的核心装置，解释主角每场戏的独特选择","character_arc":"后续变化方向","first_impression":"第一次出场印象","appear_chapter":1}',
  ])
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  return renderPrompt([
    '基于现有小说背景和角色清单，生成能直接作用于章节写作的人物关系网。关系不能只停在“朋友”“家人”这种空标签，必须能写进对白、动作和情绪变化里。',
    sectionLines('现有信息', [
      '故事背景：' + params.novelSynopsis,
      '角色清单：\n' + params.characterList,
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      background: params.novelSynopsis,
      worldSummary: params.worldSummary,
      taskFocus: '人物关系要能解释他们为什么这样说话、这样试探、这样互相靠近或互相伤害。',
      extraQualityLines: ['重点检查不同关系是否真的有不同温度、边界、称呼和冲突方式。'],
    }),
    section('生成要求', [
      '优先补足主角相关、当前剧情高频互动、以及会影响主线推进的关键关系。',
      '每条关系都要给出当前状态，而不是只写一个静态身份标签。',
      '关系必须体现亲密度、张力度、互动方式和潜台词规则，确保后续章节对白不再一个基调。',
      'description 写关系形成原因、当前状态和主要拉扯，不写空泛概括。',
      'interaction_style 写双方平时如何说话、试探、回避、照顾、顶撞或施压。',
      'subtext_rule 写这段关系里不能直说但会持续影响对白的暗线。',
      'intimacy_level 和 tension_level 使用 1 到 5 的整数，1 最弱，5 最强。',
      '如果关系是单向错位，例如一方把对方当盟友、另一方只把他当工具，也要在说明里写出来。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '关系描述要像编剧室会直接拿去写戏的工作备注，不要写成百科定义。',
      '少用“感情深厚”“关系复杂”这类空词，优先写称呼、边界、顾忌、依赖、旧账和压迫感。',
    ])),
    'type 仅可使用：stranger / acquaintance / friend / family / colleague / mentor_student / ally / subordinate / rival / lover / enemy',
    '只输出 JSON 数组：[{"char_a":"","char_b":"","type":"","label":"朋友/师徒/互相利用等中文简称","description":"20到60字，写关系形成与当前状态","bilateral":true,"intimacy_level":3,"tension_level":2,"interaction_style":"平时如何说话和互动","subtext_rule":"这段关系里不能直说的暗线"}]',
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
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'map') : '',
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

export function buildPowerSystemExpandPrompt(input: PowerSystemExpandInput): string {
  return renderPrompt([
    sectionLines('任务', [
      '你是一位精通力量体系设计的世界观架构师。',
      `为小说《${input.novelTitle}》（${input.genre}）深度扩展力量体系。`,
    ]),
    sectionLines('世界观背景', [input.worldSummary]),
    sectionLines('已有力量体系', [input.existingPowerSystems || '暂无']),
    sectionLines('扩展要求', [
      '为每个力量体系补充以下维度：',
      '1. 境界细分：每个大境界拆出 2-4 个小阶段，写清每阶段的标志性能力变化。',
      '2. 修炼资源：写清每个阶段需要什么资源、资源从哪来、谁控制资源。',
      '3. 瓶颈与代价：每次突破的风险、失败后果、不可逆的代价。',
      '4. 战力锚点：给出 2-3 个具体场景说明该境界能做什么、不能做什么。',
      '5. 体系交互：不同力量体系之间的克制、协同或冲突关系。',
    ]),
    sectionLines('硬约束', [
      '不要写成百科词条，要写成能直接用于剧情的设定。',
      '每个境界的描述必须包含"能做什么"和"做不到什么"两面。',
      '资源和代价必须具体到可以写进剧情的程度。',
    ]),
    input.attemptNumber ? buildVariationHint(input.attemptNumber, 'generic') : '',
    sectionLines('输出格式', [
      '输出 JSON 数组，每个元素代表一个力量体系：',
      '[{"name":"体系名","levels":[{"rank":"境界名","subStages":["小阶段1","小阶段2"],"abilities":"能力描述","limitations":"限制描述","resources":"所需资源","breakthroughRisk":"突破风险"}],"interactions":"与其他体系的关系"}]',
    ]),
  ])
}

export function buildFactionSystemExpandPrompt(input: FactionSystemExpandInput): string {
  return renderPrompt([
    sectionLines('任务', [
      '你是一位精通势力组织设计的世界观架构师。',
      `为小说《${input.novelTitle}》（${input.genre}）深度扩展势力组织体系。`,
    ]),
    sectionLines('世界观背景', [input.worldSummary]),
    sectionLines('已有势力', [input.existingFactions || '暂无']),
    sectionLines('扩展要求', [
      '为每个势力补充以下维度：',
      '1. 内部层级：写清从底层到顶层的权力结构，每层有多少人、掌握什么权限。',
      '2. 核心资源：这个势力靠什么立足——领地、技术、人脉、信仰还是暴力。',
      '3. 内部矛盾：派系分歧、继承危机、理念冲突，写出至少一个可以推动剧情的内部裂痕。',
      '4. 外部关系网：与其他势力的同盟、敌对、利用关系，写清利益交换的具体内容。',
      '5. 关键人物槽位：预留 2-3 个关键角色位置（掌权者、叛逆者、中间人），写清其职能但不命名。',
    ]),
    sectionLines('硬约束', [
      '势力之间必须存在至少一组不可调和的利益冲突。',
      '每个势力的"核心资源"必须是其他势力想要但得不到的东西。',
      '内部矛盾必须具体到可以写成剧情线的程度，不要写"内部存在分歧"这种空话。',
    ]),
    input.attemptNumber ? buildVariationHint(input.attemptNumber, 'generic') : '',
    sectionLines('输出格式', [
      '输出 JSON 数组，每个元素代表一个势力：',
      '[{"name":"势力名","hierarchy":[{"level":"层级名","count":"人数规模","authority":"权限范围"}],"coreResource":"核心资源描述","internalConflict":"内部矛盾描述","externalRelations":[{"target":"对方势力","relation":"关系类型","exchange":"利益交换内容"}],"keySlots":[{"role":"角色定位","function":"职能描述"}]}]',
    ]),
  ])
}
