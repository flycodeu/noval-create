export type StoryGenreFamily =
  | 'zombie'
  | 'wuxia'
  | 'xianxia'
  | 'fantasy'
  | 'scifi'
  | 'modern'
  | 'mystery'
  | 'romance'
  | 'classical'
  | 'generic'

export interface CharacterBatchPreset {
  majorCount: number
  minorCount: number
  antagonistCount: number
  supportingCount: number
  genderRatio: string
  helperRoles: string[]
  preferredSpecies: string[]
}

export interface ItemTemplateDefinition {
  key: string
  name: string
  category: string
  summary: string
  holders: string
  circulation: string
  storyValue: string
  examples: string[]
}

export interface ItemGenerationProfile {
  genreFamily: StoryGenreFamily
  title: string
  overview: string
  defaultBatch: number
  beginnerTips: string[]
  templates: ItemTemplateDefinition[]
}

const GENRE_RULES: Array<{ family: StoryGenreFamily; pattern: RegExp }> = [
  { family: 'zombie', pattern: /\u4e27\u5c38|\u672b\u65e5|\u75c5\u6bd2|\u5c38\u6f6e|\u707e\u53d8/u },
  { family: 'wuxia', pattern: /\u6b66\u4fa0|\u6c5f\u6e56|\u4fa0\u5ba2|\u6b66\u6797|\u9556\u5c40|\u5e2e\u4f1a/u },
  { family: 'xianxia', pattern: /\u4ed9\u4fa0|\u4fee\u771f|\u4fee\u4ed9|\u5b97\u95e8|\u4ed9\u754c/u },
  { family: 'fantasy', pattern: /\u7384\u5e7b|\u6597\u7834|\u6597\u6c14|\u5f02\u754c|\u9b54\u5e7b\u5347\u7ea7/u },
  { family: 'scifi', pattern: /\u79d1\u5e7b|\u672a\u6765|\u8d5b\u535a|\u673a\u7532|\u661f\u9645|\u5916\u661f/u },
  { family: 'romance', pattern: /\u8a00\u60c5|\u604b\u7231|\u751c\u5ba0|\u60c5\u611f/u },
  { family: 'classical', pattern: /\u6587\u8a00|\u53e4\u4ee3|\u671d\u5802|\u5bab\u5ef7|\u5386\u53f2/u },
  { family: 'mystery', pattern: /\u60ac\u7591|\u63a8\u7406|\u5211\u4fa6|\u4fa6\u67e5|\u8c03\u67e5|\u793e\u4f1a\u6d3e|\u672c\u683c|\u7f6a\u6848|\u65e7\u6848/u },
  { family: 'modern', pattern: /\u73b0\u4ee3|\u90fd\u5e02|\u73b0\u5b9e|\u804c\u573a|\u6821\u56ed/u },
]
const ITEM_PROFILES: Record<StoryGenreFamily, ItemGenerationProfile> = {
  zombie: {
    genreFamily: 'zombie',
    title: '生存物资体系',
    overview: '先把基地运转、生存消耗、战斗压制和感染风险拆开，再生成具体物品。',
    defaultBatch: 14,
    beginnerTips: [
      '先生成模板，再补实例，后面写作时更容易记住谁手里有什么。',
      '主要人物的物品尽量带剧情代价，避免万能装备。',
    ],
    templates: [
      {
        key: 'firearms',
        name: '枪械与远程火力',
        category: '武器',
        summary: '用于压制尸群、守点和短时突围。',
        holders: '武装小队、基地守备、前军警人员',
        circulation: '受弹药和维护限制，通常不会全民持有。',
        storyValue: '决定资源分配、阵营武力差和关键救援场景。',
        examples: ['手枪', '霰弹枪', '步枪', '信号枪'],
      },
      {
        key: 'medical',
        name: '医疗与镇定药品',
        category: '药品',
        summary: '处理伤口、发热、感染怀疑和精神崩溃。',
        holders: '医护幸存者、实验团队、基地后勤',
        circulation: '越到中后期越稀缺，常与权力交换绑定。',
        storyValue: '能拉出救人还是放弃的道德冲突。',
        examples: ['抗生素', '镇定剂', '止痛针', '试剂盒'],
      },
      {
        key: 'survival',
        name: '食水与基础生存包',
        category: '物资',
        summary: '食物、水源、照明和净化工具。',
        holders: '所有幸存者群体',
        circulation: '最常见也最容易引发争抢。',
        storyValue: '负责推动迁移、补给线、内部背叛。',
        examples: ['净水片', '压缩饼干', '头灯', '储水桶'],
      },
      {
        key: 'transport',
        name: '交通与撤离工具',
        category: '载具',
        summary: '用于撤离、运送伤员和抢占据点。',
        holders: '外勤小队、基地高层、逃亡主角团',
        circulation: '受燃料、道路和噪音影响。',
        storyValue: '决定行动半径和撤离窗口。',
        examples: ['越野车', '改装卡车', '发电摩托', '折叠担架'],
      },
    ],
  },
  wuxia: {
    genreFamily: 'wuxia',
    title: '江湖器物体系',
    overview: '把功法、兵器、令牌、药材和门派资源拆开，能更好地服务门派关系和江湖规矩。',
    defaultBatch: 12,
    beginnerTips: [
      '功法和武器最好对应人物路数，不要全员神兵。',
      '令牌、名册、密信这类文书也能成为关键物品。',
    ],
    templates: [
      {
        key: 'martial-arts',
        name: '功法与招式传承',
        category: '功法',
        summary: '门派核心技艺、旁门秘术、禁术。',
        holders: '掌门、真传弟子、叛门者',
        circulation: '依门规和师承秘密流转。',
        storyValue: '决定人物成长上限和门派冲突。',
        examples: ['心法', '刀谱', '轻功诀', '禁术残页'],
      },
      {
        key: 'weapons',
        name: '兵器与暗器',
        category: '武器',
        summary: '正面交锋和阴招并存的江湖兵器。',
        holders: '侠客、杀手、护卫、门派长老',
        circulation: '可买卖，也可祖传或夺取。',
        storyValue: '适合挂钩门派身份和人物名场面。',
        examples: ['长刀', '软剑', '袖箭', '飞针'],
      },
      {
        key: 'herbs',
        name: '药材与疗伤之物',
        category: '药物',
        summary: '解毒、疗伤、续命和增益药。',
        holders: '医馆、门派药阁、黑市贩子',
        circulation: '稀有药材常与人情债绑定。',
        storyValue: '适合推动交易、救命和争夺。',
        examples: ['金疮药', '解毒丸', '珍稀药草', '秘制毒粉'],
      },
      {
        key: 'credentials',
        name: '令牌与江湖凭证',
        category: '凭证',
        summary: '身份、任务、通行和悬赏证明。',
        holders: '门派执事、朝廷密探、镖局',
        circulation: '正规和黑市渠道并存。',
        storyValue: '能把人物快速带入更大的势力网络。',
        examples: ['门派令牌', '通关文书', '追杀令', '盟约印记'],
      },
    ],
  },
  xianxia: {
    genreFamily: 'xianxia',
    title: '修行资源体系',
    overview: '按修炼、法器、丹药、灵兽契约和宗门资源拆开，方便后续境界推进。',
    defaultBatch: 14,
    beginnerTips: [
      '资源越高级，越需要绑定代价或宗门规则。',
      '物品最好体现境界差和地域差，不要全都通用。',
    ],
    templates: [
      {
        key: 'artifacts',
        name: '法器与本命器',
        category: '法器',
        summary: '修士随身兵器、护身器、探查器。',
        holders: '修士、长老、遗迹守卫',
        circulation: '宗门赐予、秘境所得、夺宝而来。',
        storyValue: '直接承载战斗风格和人物身份。',
        examples: ['飞剑', '护心镜', '镇魂铃', '阵盘'],
      },
      {
        key: 'elixir',
        name: '丹药与灵液',
        category: '丹药',
        summary: '突破、疗伤、压制反噬和保命。',
        holders: '丹师、宗门库房、拍卖行',
        circulation: '高阶丹药通常需要身份或贡献兑换。',
        storyValue: '适合推动突破、交易和背刺。',
        examples: ['筑基丹', '回灵丹', '护脉灵液', '燃血丹'],
      },
      {
        key: 'materials',
        name: '阵法与炼器材料',
        category: '材料',
        summary: '用于布阵、炼器、修补法器。',
        holders: '炼器师、阵师、矿脉势力',
        circulation: '与秘境、矿场和宗门边境绑定。',
        storyValue: '适合挂钩门派争夺与遗迹探索。',
        examples: ['灵石', '玄铁', '阵旗', '妖丹'],
      },
      {
        key: 'mounts',
        name: '飞行与契约载具',
        category: '载具',
        summary: '飞舟、灵兽坐骑和跨域航行器。',
        holders: '宗门执事、强者、商路势力',
        circulation: '受财力与地位限制。',
        storyValue: '决定势力版图和远行节奏。',
        examples: ['飞舟', '灵鹤鞍具', '跨界舟', '传送令'],
      },
    ],
  },
  fantasy: {
    genreFamily: 'fantasy',
    title: '玄幻资源体系',
    overview: '强化等阶、遗迹资源、职业装备和阵营象征物并存，适合升级与势力争霸。',
    defaultBatch: 12,
    beginnerTips: [
      '装备名称要和世界文化一致，不要中西乱混。',
      '关键装备最好挂钩阵营或古老事件来源。',
    ],
    templates: [
      {
        key: 'battle-gear',
        name: '战斗装备与护具',
        category: '装备',
        summary: '直接影响正面对抗和探索生存。',
        holders: '冒险者、军团、家族继承人',
        circulation: '可打造、继承、战利品获得。',
        storyValue: '能直观体现人物阶层和成长。',
        examples: ['战甲', '长枪', '护符', '臂甲'],
      },
      {
        key: 'relics',
        name: '遗迹秘宝',
        category: '秘宝',
        summary: '古文明残留、传承钥匙、世界碎片。',
        holders: '遗迹探索者、守护者、反派势力',
        circulation: '常与古战场、禁区相连。',
        storyValue: '用于拉出大型阴谋和旧时代真相。',
        examples: ['古卷', '秘钥', '血脉印记', '残缺核心'],
      },
      {
        key: 'craft',
        name: '锻造材料与能量媒介',
        category: '材料',
        summary: '打造武器、强化装备和维持法阵。',
        holders: '锻造师、公会、矿脉势力',
        circulation: '受地理与势力控制影响。',
        storyValue: '推动地盘争夺和产业线。',
        examples: ['晶石', '兽核', '矿锭', '符纹片'],
      },
    ],
  },
  scifi: {
    genreFamily: 'scifi',
    title: '未来科技体系',
    overview: '把舰船、芯片、机甲、药剂和证据数据拆开，既能写世界观，也能写行动链。',
    defaultBatch: 14,
    beginnerTips: [
      '科技名词要服务剧情，不要堆设定词。',
      '关键设备最好附带权限、能耗、追踪风险。',
    ],
    templates: [
      {
        key: 'ships',
        name: '飞船与跨域交通',
        category: '载具',
        summary: '用于跨站点、跨星域和撤离。',
        holders: '舰队、公司、走私者、主角团',
        circulation: '受权限、能源和维护限制。',
        storyValue: '决定移动半径和势力投送能力。',
        examples: ['穿梭艇', '巡逻舰', '货运飞船', '逃生舱'],
      },
      {
        key: 'cyber',
        name: '芯片与数据密钥',
        category: '科技',
        summary: '身份、权限、黑客入侵和记忆存取。',
        holders: '黑客、公司安保、研究员',
        circulation: '常通过非法交易和任务交换流转。',
        storyValue: '适合推动反转和身份谜题。',
        examples: ['身份芯片', '权限钥匙', '记忆模组', '数据锚点'],
      },
      {
        key: 'combat-tech',
        name: '战斗科技与药剂',
        category: '装备',
        summary: '机甲模块、能量武器、强化药剂。',
        holders: '军方、佣兵、实验体',
        circulation: '高危装备通常受严格监管。',
        storyValue: '用来体现技术差和伦理代价。',
        examples: ['能量步枪', '外骨骼', '抑制剂', '纳米修复剂'],
      },
      {
        key: 'alien',
        name: '外星遗留科技',
        category: '遗物',
        summary: '超出人类现有理解的设备或材料。',
        holders: '研究所、秘密组织、古遗迹探索者',
        circulation: '极罕见，且会招来多方追逐。',
        storyValue: '负责拉高世界谜团和势力碰撞。',
        examples: ['曲率核心碎片', '未知合金', '异星信标', '遗物舱'],
      },
    ],
  },
  modern: {
    genreFamily: 'modern',
    title: '现实生活物件体系',
    overview: '职业工具、日用品、关键证据和关系信物都能成为剧情抓手。',
    defaultBatch: 10,
    beginnerTips: [
      '现代题材的物品不一定昂贵，关键是能推动关系和事件。',
      '证据、合同、聊天记录这类信息物件不要忽略。',
    ],
    templates: [
      {
        key: 'tools',
        name: '职业工具',
        category: '工具',
        summary: '与人物职业和生活环境紧密绑定。',
        holders: '主角同事、家庭成员、行业角色',
        circulation: '常见但能体现阶层和专业差异。',
        storyValue: '帮助人物落地，不至于悬浮。',
        examples: ['工作证', '相机', '录音笔', '车钥匙'],
      },
      {
        key: 'evidence',
        name: '证据与信息载体',
        category: '证据',
        summary: '记录、合同、偷拍视频和聊天记录。',
        holders: '调查者、对手、知情人',
        circulation: '通常通过窃取、保管、交换流转。',
        storyValue: '很适合推动误会、翻案和反转。',
        examples: ['U盘', '合同', '监控截图', '诊断书'],
      },
      {
        key: 'daily',
        name: '生活用品与空间物件',
        category: '生活',
        summary: '能直接表现人物习惯、情绪和关系温度。',
        holders: '所有日常角色',
        circulation: '最容易被读者理解。',
        storyValue: '适合做伏笔和细节回收。',
        examples: ['旧手机', '咖啡杯', '雨伞', '门禁卡'],
      },
    ],
  },
  mystery: {
    genreFamily: 'mystery',
    title: '\u8c03\u67e5\u8bc1\u636e\u7269\u4ef6\u4f53\u7cfb',
    overview: '\u73b0\u4ee3\u60ac\u7591\u91cd\u70b9\u4e0d\u662f\u552f\u7f8e\u9053\u5177\uff0c\u800c\u662f\u8bc1\u636e\u3001\u8bb0\u5f55\u3001\u901a\u8054\u548c\u573a\u6240\u7269\u4ef6\u600e\u4e48\u63a8\u52a8\u8c03\u67e5\u3002',
    defaultBatch: 12,
    beginnerTips: [
      '\u4f18\u5148\u751f\u6210\u80fd\u6784\u6210\u7ebf\u7d22\u94fe\u7684\u7269\u4ef6\uff0c\u4e0d\u8981\u53ea\u5806\u6c1b\u56f4\u611f\u3002',
      '\u540c\u4e00\u6837\u7269\u4ef6\u6700\u597d\u540c\u65f6\u53ef\u4ee5\u5145\u5f53\u8bc1\u636e\u3001\u8bef\u5bfc\u6216\u5173\u7cfb\u5f15\u4fe1\u3002',
    ],
    templates: [
      {
        key: 'records',
        name: '\u6863\u6848\u4e0e\u8bb0\u5f55',
        category: '\u8bb0\u5f55',
        summary: '\u5377\u5b97\u3001\u767b\u8bb0\u7c3f\u3001\u503c\u73ed\u8bb0\u5f55\u548c\u901a\u8054\u6e05\u5355\u3002',
        holders: '\u6863\u6848\u5ba4\u3001\u5185\u52e4\u4eba\u5458\u3001\u65e7\u5355\u4f4d\u77e5\u60c5\u4eba',
        circulation: '\u5e38\u901a\u8fc7\u8c03\u9605\u3001\u590d\u5370\u3001\u79c1\u4e0b\u4f20\u9012\u6216\u5220\u6539\u6d41\u8f6c\u3002',
        storyValue: '\u9002\u5408\u7528\u6765\u505a\u65f6\u95f4\u7ebf\u6821\u5bf9\u3001\u7f3a\u53f7\u8bc1\u660e\u548c\u65e7\u6848\u56de\u6536\u3002',
        examples: ['\u5c01\u5b58\u5377\u5b97', '\u503c\u73ed\u8bb0\u5f55', 'U\u76d8', '\u901a\u8054\u6e05\u5355'],
      },
      {
        key: 'scene-evidence',
        name: '\u73b0\u573a\u9057\u7559\u7269',
        category: '\u8bc1\u636e',
        summary: '\u5e26\u6709\u65f6\u95f4\u3001\u5730\u70b9\u6216\u4eba\u9645\u6307\u5411\u7684\u5fae\u5c0f\u7269\u4ef6\u3002',
        holders: '\u8c03\u67e5\u8005\u3001\u77e5\u60c5\u4eba\u3001\u5bf9\u624b\u6216\u73b0\u573a\u6e05\u7406\u8005',
        circulation: '\u5f88\u5bb9\u6613\u88ab\u5ffd\u7565\u3001\u8f6c\u79fb\u6216\u88ab\u5f53\u6210\u65e5\u5e38\u6751\u6599\u3002',
        storyValue: '\u80fd\u628a\u73b0\u573a\u7a7a\u95f4\u548c\u4eba\u7269\u884c\u52a8\u94fe\u771f\u6b63\u8fde\u8d77\u6765\u3002',
        examples: ['\u65e7\u5de5\u724c', '\u6c61\u635f\u7968\u6839', '\u95e8\u7981\u5361', '\u6444\u50cf\u5934\u5b58\u50a8\u5361'],
      },
      {
        key: 'private-items',
        name: '\u79c1\u4eba\u751f\u6d3b\u7269\u4ef6',
        category: '\u751f\u6d3b',
        summary: '\u804a\u5929\u8bb0\u5f55\u3001\u7167\u7247\u3001\u8bca\u65ad\u4e66\u548c\u7a7a\u95f4\u6446\u4ef6\u3002',
        holders: '\u53d7\u5bb3\u4eba\u5bb6\u5c5e\u3001\u5173\u952e\u8bc1\u4eba\u3001\u5931\u8054\u8005\u65e7\u53cb',
        circulation: '\u901a\u5e38\u88ab\u9690\u85cf\uff0c\u4f46\u4e00\u65e6\u88ab\u627e\u5230\u5c31\u5e26\u6709\u5f88\u5f3a\u7684\u4eba\u7269\u6307\u5411\u3002',
        storyValue: '\u9002\u5408\u505a\u60c5\u611f\u94a9\u5b50\u3001\u8bef\u5bfc\u7ebf\u7d22\u548c\u65e7\u4e8b\u56de\u58f0\u3002',
        examples: ['\u65e7\u624b\u673a', '\u51b2\u5370\u7167\u7247', '\u75c5\u5386\u590d\u5370\u4ef6', '\u624b\u5199\u4fbf\u7b7e'],
      },
    ],
  },
  romance: {
    genreFamily: 'romance',
    title: '情感线索物件体系',
    overview: '信物、礼物、误会证据和生活物件一起构成情感线的记忆点。',
    defaultBatch: 10,
    beginnerTips: [
      '感情物件要和关系阶段对应，别一上来就堆大礼物。',
      '误会和和解往往靠同一个物件回收效果最好。',
    ],
    templates: [
      {
        key: 'tokens',
        name: '情感信物',
        category: '信物',
        summary: '人物关系推进、错过与回收的核心载体。',
        holders: '主角、恋爱线对象、家人朋友',
        circulation: '多由赠送、遗失、归还产生剧情。',
        storyValue: '能直连情感高潮和反转。',
        examples: ['戒指', '围巾', '旧照片', '手写便签'],
      },
      {
        key: 'misunderstanding',
        name: '误会与真相证据',
        category: '证据',
        summary: '推动分离、猜疑、误解和澄清。',
        holders: '情敌、同事、当事人',
        circulation: '常通过误传、隐藏、迟到的发现出现。',
        storyValue: '负责把情绪变化落到具体事件。',
        examples: ['聊天截图', '病历单', '录音', '未发送短信'],
      },
      {
        key: 'daily-bond',
        name: '共同生活物件',
        category: '生活',
        summary: '一起使用、保留痕迹、能触发回忆的日常物品。',
        holders: '恋爱线双方、室友、家人',
        circulation: '随关系发展逐渐赋予意义。',
        storyValue: '适合写氛围、亲密和失去感。',
        examples: ['钥匙扣', '马克杯', '车票', '书签'],
      },
    ],
  },
  classical: {
    genreFamily: 'classical',
    title: '古代制度物件体系',
    overview: '先把礼制、官场、家族与行旅物件分开，再生成更具体的实例。',
    defaultBatch: 12,
    beginnerTips: [
      '古代题材的物品要带礼法、身份和使用场景。',
      '文书、印信、车马、贡品都能直接推动剧情。',
    ],
    templates: [
      {
        key: 'documents',
        name: '文书与印信',
        category: '文书',
        summary: '权力、通行、审讯和证明身份的关键物件。',
        holders: '官员、家主、幕僚、使者',
        circulation: '强依赖等级和官方渠道。',
        storyValue: '最适合牵引朝堂、家族和身份危机。',
        examples: ['官印', '手令', '族谱', '密折'],
      },
      {
        key: 'vehicles',
        name: '行旅与仪仗物件',
        category: '行旅',
        summary: '人物出行、身份象征和礼法秩序。',
        holders: '官员、世家、公主、商队',
        circulation: '由身份与财力决定配置。',
        storyValue: '可以很直观地表现阶层差异。',
        examples: ['马车', '仪仗牌', '随身匣', '驿站文牒'],
      },
      {
        key: 'heritage',
        name: '家族信物与典籍',
        category: '信物',
        summary: '血缘、继承、秘密和旧案线索。',
        holders: '宗族长辈、失势旁支、守旧仆从',
        circulation: '常被藏匿、争夺、误认。',
        storyValue: '适合推动身世与旧案。',
        examples: ['玉佩', '祖传手札', '药方', '嫁妆册'],
      },
    ],
  },
  generic: {
    genreFamily: 'generic',
    title: '剧情道具体系',
    overview: '按武器、资源、凭证、证据和身份象征拆开，适合作为通用底板。',
    defaultBatch: 10,
    beginnerTips: [
      '每类先生成一两个关键物件，不要一开始就铺太满。',
      '优先让物品和人物关系、事件后果发生连接。',
    ],
    templates: [
      {
        key: 'gear',
        name: '装备与工具',
        category: '装备',
        summary: '人物完成行动时最常用的器物。',
        holders: '行动角色、组织执行者',
        circulation: '根据职业和资源层级分配。',
        storyValue: '负责推动行动链和场景细节。',
        examples: ['短刀', '工具包', '防护装备', '钥匙'],
      },
      {
        key: 'resource',
        name: '资源与补给',
        category: '资源',
        summary: '稀缺、可交易、可引发冲突的物资。',
        holders: '组织、商人、掌权者',
        circulation: '围绕掌控与交换展开。',
        storyValue: '适合推动争夺和联盟。',
        examples: ['灵石', '燃料', '粮票', '药材'],
      },
      {
        key: 'proof',
        name: '凭证与线索',
        category: '线索',
        summary: '决定身份、任务和真相的载体。',
        holders: '知情者、调查者、反派',
        circulation: '多通过隐藏、抢夺、泄露出现。',
        storyValue: '最适合推进悬念和回收。',
        examples: ['密信', '凭证', '录音', '残页'],
      },
    ],
  },
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function resolveGenreFamily(genreName?: string | null): StoryGenreFamily {
  const name = (genreName || '').trim()
  if (!name) return 'generic'

  for (const rule of GENRE_RULES) {
    if (rule.pattern.test(name)) return rule.family
  }

  return 'generic'
}

export function getCharacterBatchPreset(genreName?: string | null, speciesOptions: string[] = []): CharacterBatchPreset {
  const family = resolveGenreFamily(genreName)
  const firstSpecies = speciesOptions.slice(0, 3)

  switch (family) {
    case 'zombie':
      return {
        majorCount: 4,
        minorCount: 6,
        antagonistCount: 2,
        supportingCount: 3,
        genderRatio: '男女均衡，允许少量老人和未成年幸存者',
        helperRoles: ['队医', '外勤侦察', '基地后勤', '感染风险角色'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['幸存者', '感染者'],
      }
    case 'wuxia':
      return {
        majorCount: 4,
        minorCount: 5,
        antagonistCount: 2,
        supportingCount: 4,
        genderRatio: '性别均衡，保留师徒、同门、宿敌结构',
        helperRoles: ['师父', '同门对手', '黑市线人', '朝廷接口角色'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['人族'],
      }
    case 'xianxia':
    case 'fantasy':
      return {
        majorCount: 5,
        minorCount: 6,
        antagonistCount: 2,
        supportingCount: 4,
        genderRatio: '不限制，注意不同势力与种族分布',
        helperRoles: ['宗门执事', '天赋型同辈', '护道人', '遗迹线角色'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['人族', '灵兽', '异族'],
      }
    case 'scifi':
      return {
        majorCount: 4,
        minorCount: 6,
        antagonistCount: 3,
        supportingCount: 4,
        genderRatio: '性别均衡，职业身份优先于年龄标签',
        helperRoles: ['技术员', '公司代表', '调查员', '实验体'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['人类', '机器人', '外星种族'],
      }
    case 'mystery':
      return {
        majorCount: 4,
        minorCount: 5,
        antagonistCount: 2,
        supportingCount: 4,
        genderRatio: '\u6027\u522b\u548c\u5e74\u9f84\u81ea\u7136\u5206\u5e03\uff0c\u4f18\u5148\u4fdd\u8bc1\u804c\u4e1a\u4e0e\u5229\u5bb3\u7acb\u573a\u7684\u5dee\u5f02\u3002',
        helperRoles: ['\u8c03\u67e5\u534f\u529b\u8005', '\u5b88\u95e8\u4eba', '\u5173\u952e\u8bc1\u4eba', '\u5229\u5bb3\u76f8\u5173\u4eba'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['\u4eba\u7c7b'],
      }
    case 'romance':
      return {
        majorCount: 4,
        minorCount: 4,
        antagonistCount: 1,
        supportingCount: 4,
        genderRatio: '按感情线需求分配，不追求机械平均',
        helperRoles: ['闺蜜/朋友', '同事', '家人', '情感竞争者'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['人类'],
      }
    case 'classical':
      return {
        majorCount: 4,
        minorCount: 5,
        antagonistCount: 2,
        supportingCount: 4,
        genderRatio: '按家族、朝堂、后宅结构分配',
        helperRoles: ['家主', '幕僚', '侍从', '旧案知情人'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['人类'],
      }
    case 'modern':
    case 'generic':
    default:
      return {
        majorCount: 4,
        minorCount: 5,
        antagonistCount: 1,
        supportingCount: 4,
        genderRatio: '性别和年龄自然分布，优先考虑职业关系',
        helperRoles: ['同事', '家人', '关键证人', '情绪支点角色'],
        preferredSpecies: firstSpecies.length > 0 ? firstSpecies : ['人类'],
      }
  }
}

export function getItemGenerationProfile(genreName?: string | null): ItemGenerationProfile {
  return clone(ITEM_PROFILES[resolveGenreFamily(genreName)])
}

export function buildItemTemplateSummary(profile: ItemGenerationProfile): string {
  return profile.templates
    .map((template) => {
      const details = [
        `类别：${template.category}`,
        `定位：${template.summary}`,
        `常见持有者：${template.holders}`,
        `流通方式：${template.circulation}`,
        `剧情作用：${template.storyValue}`,
        `示例：${template.examples.join('、')}`,
      ]
      return `- ${template.name}\n  ${details.join('\n  ')}`
    })
    .join('\n')
}
