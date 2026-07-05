import { getBuiltinGenreRules, type RealismLevel } from './genre-system'

export type GuardrailSeverity = 'low' | 'medium' | 'high'

export interface TextGuardrailFinding {
  code: string
  severity: GuardrailSeverity
  message: string
  excerpt: string
}

interface PatternRule {
  code: string
  severity: GuardrailSeverity
  message: string
  pattern: RegExp
}

interface GenreHollowRule {
  message: string
  abstractTokens: string[]
  concreteTokens: string[]
  minAbstractHits: number
  maxConcreteHits: number
}

export type AntiAiPromptRuleBucket = 'expression' | 'sentence' | 'structure'

export interface AntiAiPromptRule {
  code: string
  bucket: AntiAiPromptRuleBucket
  avoid: string
  prefer?: string
}

const LANGUAGE_PATTERN_RULES: PatternRule[] = [
  // === 高严重度：必须修复 ===
  {
    code: 'object_category_mismatch',
    severity: 'high',
    message: '把物体、系统或地点写成了人才会有的生命状态，属于对象类别错配。',
    pattern: /(电网|系统|组织|城市|铁门|基地|设施|防线|通讯|建筑|围墙|铁丝网|大门|机器|车辆|道路).{0,4}(死亡|呼吸|哭泣|思考|愤怒|悲鸣|叹息|挣扎|绝望|恐惧)/u,
  },
  {
    code: 'id_pollution',
    severity: 'high',
    message: '内部 ID 或占位标识直接进入文本，会显著拉低人类语言质感。',
    pattern: /(角色|地点|物品|事件|章节|场景|线程|故事弧)#\d+/u,
  },
  {
    code: 'prompt_leak',
    severity: 'high',
    message: '提示词内容泄露到正文中。',
    pattern: /(场景计划|必须交代|目标字数|情绪基调|连续性记忆|上下文护栏|输出质量底线|真实度护栏|must_cover|exit_hook|bridge_in|bridge_out)/u,
  },
  {
    code: 'ai_process_leak',
    severity: 'high',
    message: 'AI 生成过程、思考备注或内部工作流文字进入正文。',
    pattern: /(AI(?:生成|思考|润色|输出|续写)中|作为AI|以下是(?:优化|改写|生成)|思考过程|我将|我会|本段需要|修订建议|改写说明|【(?:分析|计划|备注|提示)】)/u,
  },
  {
    code: 'format_noise',
    severity: 'high',
    message: '正文中混入了乱码、Markdown、HTML 或 JSON 外壳。',
    pattern: /(\uFFFD|```|<\/?[a-z][^>]*>|^\s*#{1,6}\s|^\s*[-*]\s*(?:建议|优化|问题|说明)|\{\s*"[^"]+"\s*:)/mu,
  },

  // === 中严重度：AI味核心检测 ===
  {
    code: 'ai_slogan',
    severity: 'medium',
    message: '口号化、假深刻的 AI 腔盖过了具体场景。',
    pattern: /(命运的齿轮|某种无法言说|真正的成长|古老而神秘|光与暗的永恒战争|不知为何|仿佛在诉说|似乎明白了什么|某种说不清|命运的安排|冥冥之中|那一刻他突然明白|这就是所谓的|命运弄人|一切都在朝着|生命的真谛|真正的力量|内心深处的某个角落|灵魂深处|这或许就是|也许这就是命运|历史的车轮|时代的浪潮|命运的捉弄|宿命般的|注定的相遇|仿佛冥冥之中|不可名状的)/u,
  },
  {
    code: 'ai_opener',
    severity: 'medium',
    message: '万能起手式，AI高频开头方式。',
    pattern: /(?:^|[\n。！？])(?:突然(?:之间)?，|这一刻，|此刻，|就在这时，|顷刻之间，|霎时间，|时间仿佛|一切(?:都|仿佛)(?:静|停|凝))/u,
  },
  {
    code: 'ai_action_cliche',
    severity: 'medium',
    message: 'AI高频动作套路，缺乏角色特异性。',
    pattern: /(深吸一口气|紧紧攥住|瞳孔骤然收缩|浑身一震|身体微微一僵|手不自觉地|下意识地握紧|猛地站了起来|瞪大了眼睛|僵在了原地|身躯微颤|牙关紧咬|双拳紧握|猛然抬头|身子一颤)/u,
  },
  {
    code: 'ai_emotional_cliche',
    severity: 'medium',
    message: 'AI高频情绪模板，用抽象词代替具体反应。',
    pattern: /(心中涌起一股|一股暖流涌上|眼眶不禁湿润|鼻子一酸|心中五味杂陈|百感交集|心如刀绞|万般无奈|心潮澎湃|热泪盈眶|泪水夺眶而出|心头涌起|一阵酸楚|胸口一阵发闷|内心翻涌)/u,
  },
  {
    code: 'ai_description_cliche',
    severity: 'medium',
    message: 'AI高频描写套路，缺乏新鲜感。',
    pattern: /(阳光洒在|月光洒在|夕阳的余晖|晨光熹微|星光点点|微风拂过|空气中弥漫着|寂静笼罩着|黑暗吞噬|阴影笼罩|光影交错|氤氲着|弥漫在空气中|笼罩在一片|淡淡的忧伤|浓浓的暖意)/u,
  },
  {
    code: 'ai_dialogue_filler',
    severity: 'medium',
    message: '对话中的AI式空话和假感悟。',
    pattern: /["「『](你知道吗|说实话|不得不说|不瞒你说|事实上|坦白说).{0,6}(我觉得|我认为|我想说的是|我一直觉得|一直以来)/u,
  },
  {
    code: 'zero_cost_resolution',
    severity: 'medium',
    message: '重大伤势、物资短缺、秩序问题或冲突被零成本解决了。',
    pattern: /(毫无代价|没有任何代价|轻易就解决了|立刻恢复|一下子就全部同意|瞬间痊愈|伤口奇迹般|不费吹灰之力|迎刃而解|所有人都同意了|问题.*迎刃而解)/u,
  },
  {
    code: 'relation_labelization',
    severity: 'medium',
    message: '关系被标签词直接替代了互动细节，容易只剩设定板而没有真实拉扯。',
    pattern: /(他们|两人|二人|他和她|她和他|双方).{0,8}(只是|不过是|本质上)?(盟友|宿敌|师徒|恋人|主仆|上下级|兄妹|姐弟|父子|母女)(关系)?/u,
  },
  {
    code: 'abstract_emotion_packaging',
    severity: 'medium',
    message: '抽象情绪名词在替代具体动作、表情或代价。',
    pattern: /(宿命感|压迫感|安全感|失落感|情绪价值|复杂情绪|某种情绪|情绪在心底蔓延|莫名的伤感|说不清的感觉|道不明的情愫|难以言喻的|无以言表)/u,
  },
  {
    code: 'world_rules_hollowing',
    severity: 'medium',
    message: '世界规则只剩抽象包装词，缺少真正能落到行动层的制度与代价。',
    pattern: /(世界规则|体系规则|制度|秩序|法则).{0,8}(完善|严密|森严|井然有序|自成体系)/u,
  },
  {
    code: 'ai_symmetry',
    severity: 'medium',
    message: '强制对称句式，AI常见的平衡修辞癖好。',
    pattern: /(?:一方面.{5,40}另一方面.{5,40}){1}|(?:既是.{3,20}也是.{3,20}更是)/u,
  },
  {
    code: 'not_but_definition_pattern',
    severity: 'medium',
    message: '“不是……是/而是……”式定义句过于工整，容易暴露生成腔。',
    pattern: /不是.{2,28}(?:，|,)?(?:而是|只是|是).{2,42}/u,
  },
  {
    code: 'double_metaphor_or_simile_stack',
    severity: 'medium',
    message: '连续比喻或双重比喻堆叠，修辞压过了叙事信息。',
    pattern: /(?:像|仿佛|似乎|好像|宛如).{1,18}(?:又像|又仿佛|又似乎|又好像|又宛如)|(?:像|仿佛|似乎|好像|宛如).{1,20}(?:像|仿佛|似乎|好像|宛如).{1,20}(?:像|仿佛|似乎|好像|宛如)/u,
  },
  {
    code: 'parallelism_overuse',
    severity: 'medium',
    message: '排比或平衡句过度整齐，像在套模板而不是跟随人物思路。',
    pattern: /(?:既.{2,18}又.{2,18}(?:还|更|也).{2,24})|(?:一边.{2,18}一边.{2,18})|(?:越.{1,10}越.{1,16})/u,
  },
  {
    code: 'ai_pseudo_philosophy',
    severity: 'medium',
    message: '伪哲学总结句，段落结尾硬升华。',
    pattern: /(或许，这就是|也许，这便是|这，便是|而这，正是|这一刻.{0,6}(?:他|她)(?:终于)?(?:明白|懂得|理解)|(?:他|她)第一次(?:真正)?(?:理解|明白|感受到))/u,
  },
  {
    code: 'low_value_body_detail',
    severity: 'medium',
    message: '手部、眼部或嗓音细节过于模板化，缺少真实行动价值。',
    pattern: /(?:手指|指节|指腹|指尖|掌心|睫毛|眼睫|瞳孔|喉咙|声音|嗓音).{0,8}(?:微微|轻轻|发紧|收缩|颤|一紧|很轻|很低|泛白|摩挲)/u,
  },
  {
    code: 'soft_voice_cliche',
    severity: 'medium',
    message: '“声音很轻/很低”类软化表达高频模板化，人物声音缺少辨识度。',
    pattern: /(?:声音|嗓音).{0,8}(?:很轻|很低|很淡|压得很低|轻得像|低得像)|(?:轻声|低声)说/u,
  },
  {
    code: 'eye_open_close_standalone_paragraph',
    severity: 'medium',
    message: '睁眼、闭眼、抬头等动作被单独成段，像模板节拍而不是有效叙事。',
    pattern: /(?:^|\n)\s*(?:他|她|我|他们|她们)?(?:睁开眼睛|睁眼|闭上眼睛|闭眼|抬起头|低下头|垂下眼|移开视线)\s*[。.!！]?\s*(?:\n|$)/u,
  },

  // === 低严重度：可改进 ===
  {
    code: 'template_emotion',
    severity: 'low',
    message: '模板化情绪表达正在拉平文本质感。',
    pattern: /(不禁|不由得|忍不住|微微一愣|心头一紧|嘴角微微上扬|目光深邃|心中涌起|不由自主地|微微皱眉|淡淡一笑|嘴角勾起一抹|眉头微蹙|轻轻叹了口气|默默地|静静地看着)/u,
  },
  {
    code: 'ai_transition_cliche',
    severity: 'low',
    message: 'AI式过渡句，缺乏自然衔接。',
    pattern: /(与此同时，|在另一边，|时间一分一秒地过去|不知过了多久|一切发生得太快|就这样，|于是，|然而，就在|但谁也没想到)/u,
  },
  {
    code: 'ai_ending_summary',
    severity: 'low',
    message: '段落结尾的总结升华句，像写读后感。',
    pattern: /(而这一切.{0,10}才刚刚开始|故事.{0,6}远没有结束|一切.{0,6}才刚刚开始|新的篇章.{0,6}即将|黎明前的黑暗|暴风雨前的宁静|这只是.*开始)/u,
  },
  {
    code: 'ai_repetitive_structure',
    severity: 'low',
    message: '连续使用相同句式结构。',
    pattern: /(?:他(?:的|看着|想着|知道).{5,30}。\n?){3,}/u,
  },
]

const GENRE_HOLLOW_RULES: Partial<Record<string, GenreHollowRule>> = {
  zombie: {
    message: '末世段落写了丧尸或灾变，却缺少食水、补给、感染、噪声、路线、收容或信任分配等生存链细节。',
    abstractTokens: ['末世', '丧尸', '尸潮', '灾变', '沦陷', '危机', '绝望'],
    concreteTokens: ['食物', '食水', '饮水', '净水', '药品', '药物', '补给', '物资', '感染', '伤口', '隔离', '体力', '噪声', '路线', '撤离', '据点', '值守', '守夜', '配给', '收容', '柴油', '汽油', '车辆', '发电', '信任', '纪律', '分配'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  xianxia: {
    message: '修仙段落只喊大道、飞升或机缘，却缺少境界、资源、宗门秩序、凡俗牵连和修行生态。',
    abstractTokens: ['大道', '飞升', '长生', '问道', '造化', '天道', '仙途', '道心', '仙缘', '机缘'],
    concreteTokens: ['炼气', '筑基', '金丹', '元婴', '化神', '渡劫', '宗门', '外门', '内门', '长老', '掌门', '坊市', '灵石', '丹药', '功法', '秘境', '洞府', '灵兽', '异兽', '邪修', '散修', '恶灵', '凡人', '家族', '灵脉', '护山', '试炼', '任务殿'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  'modern-mystery': {
    message: '\u73b0\u4ee3\u60ac\u7591\u6bb5\u843d\u53ea\u5199\u79d8\u5bc6\u3001\u538b\u6291\u6216\u5f02\u6837\uff0c\u5374\u7f3a\u5c11\u6848\u4ef6\u5165\u53e3\u3001\u8bc1\u636e\u8f7d\u4f53\u3001\u673a\u6784\u963b\u529b\u548c\u8c03\u67e5\u8def\u5f84\u3002',
    abstractTokens: ['\u79d8\u5bc6', '\u771f\u76f8', '\u9634\u5f71', '\u8ff7\u96fe', '\u5f02\u5e38', '\u8be1\u5f02', '\u6c89\u9ed8', '\u4e0d\u5bf9\u52b2'],
    concreteTokens: ['\u8bc1\u636e', '\u5377\u5b97', '\u6863\u6848', '\u76d1\u63a7', '\u53e3\u4f9b', '\u76ee\u51fb\u8005', '\u503c\u73ed\u8bb0\u5f55', '\u901a\u8054', '\u8d70\u8bbf', '\u8c03\u9605', '\u73b0\u573a', '\u65f6\u95f4\u7ebf', '\u62a5\u6848', '\u5c01\u5b58', '\u5206\u5c40', '\u533b\u9662', '\u5382\u533a', '\u6863\u6848\u9986', '\u8bb0\u8005'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  wuxia: {
    message: '武侠段落只有打斗或招式，却缺少江湖规矩、师承门第、名声、盘缠、官府和行路成本。',
    abstractTokens: ['刀光', '剑光', '掌风', '交手', '过招', '比武', '决战', '轻功', '剑招', '刀招'],
    concreteTokens: ['江湖', '师门', '门规', '门派', '帮会', '镖局', '客栈', '盘缠', '官府', '捕快', '名声', '拜帖', '驿站', '马匹', '伤药', '路引', '行路', '师承', '人情', '报官', '护镖'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  historical: {
    message: '历史/古言段落只写朝堂、宫闱或权谋气氛，却缺少礼法、官制、门第、诏令、税粮、军政后勤和时代尺度。',
    abstractTokens: ['朝堂', '宫闱', '权谋', '后宫', '恩宠', '圣心', '天下', '风云', '规矩'],
    concreteTokens: ['礼法', '官制', '品级', '诏令', '奏疏', '门第', '宗族', '户籍', '赋税', '税粮', '粮道', '军饷', '驿站', '车马', '脚程', '衙门', '内廷', '外朝', '族规', '家法'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  fantasy: {
    message: '玄幻段落只堆威压、天骄和机缘爽点，却缺少等级差、资源争夺、势力反应、功法限制和战斗代价。',
    abstractTokens: ['威压', '天骄', '逆天', '机缘', '至尊', '神威', '臣服', '震动', '横扫'],
    concreteTokens: ['境界', '等级', '血脉', '功法', '法器', '灵石', '丹药', '资源', '宗门', '家族', '秘境', '遗迹', '阵法', '伤势', '反噬', '消耗', '护法', '长老', '势力'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  'urban-ability': {
    message: '都市异能/系统爽文段落只写奖励、震惊和打脸，却缺少现代身份、执法、舆论、监控、成本和能力触发规则。',
    abstractTokens: ['系统', '奖励', '到账', '震惊', '反派', '后悔', '跪求', '打脸', '爽'],
    concreteTokens: ['合同', '公司', '银行', '转账', '税务', '警方', '执法', '监控', '舆论', '媒体', '医院', '学校', '小区', '身份', '证据', '规则', '副作用', '冷却', '触发', '代价'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  'western-fantasy': {
    message: '西幻段落只写骑士、圣光、预言和远征氛围，却缺少领地、教会、封臣、粮草、施法材料和信仰秩序。',
    abstractTokens: ['骑士', '圣光', '预言', '魔法', '龙', '黑暗', '远征', '荣耀', '王国'],
    concreteTokens: ['领地', '封臣', '庄园', '教会', '教区', '什一税', '粮草', '马匹', '铠甲', '佣兵', '城堡', '要塞', '仪式', '材料', '法术位', '牧师', '修道院', '种族', '盟约', '继承'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
}

const BUILTIN_ANTI_AI_PROMPT_RULES: AntiAiPromptRule[] = [
  {
    code: 'ai_slogan',
    bucket: 'expression',
    avoid: '不要写“命运的齿轮、某种无法言说、灵魂深处、这就是所谓的”这类口号化空词。',
    prefer: '把情绪和判断落到动作、代价、选择或现场细节里。',
  },
  {
    code: 'ai_opener',
    bucket: 'sentence',
    avoid: '不要用“突然、这一刻、就在这时、顷刻之间”做万能起手。',
    prefer: '直接从可见动作、异常声响、人物决策或场景阻力切入。',
  },
  {
    code: 'ai_action_cliche',
    bucket: 'sentence',
    avoid: '不要反复写“深吸一口气、瞳孔骤缩、浑身一震、双拳紧握”这类模板动作。',
    prefer: '改成角色独有的习惯动作、失误、停顿或身体代价。',
  },
  {
    code: 'ai_emotional_cliche',
    bucket: 'sentence',
    avoid: '不要写“心中涌起一股、百感交集、热泪盈眶、心头一紧”这类抽象情绪模板。',
    prefer: '改成眼神、呼吸、姿势、说话方式或下一步选择。',
  },
  {
    code: 'ai_description_cliche',
    bucket: 'expression',
    avoid: '不要堆“阳光洒在、月光洒在、空气中弥漫着、阴影笼罩、光影交错”这类空泛环境描写。',
    prefer: '只保留影响行动或气氛判断的具体物理细节。',
  },
  {
    code: 'ai_dialogue_filler',
    bucket: 'sentence',
    avoid: '不要让对白靠“你知道吗、说实话、事实上、坦白说”这类空话起势。',
    prefer: '让对白直接带试探、回避、压价、命令或信息交换。',
  },
  {
    code: 'format_noise',
    bucket: 'structure',
    avoid: '不要输出 Markdown、JSON 外壳、HTML 标签、列表建议、乱码或任何非正文格式噪音。',
    prefer: '只保留读者能直接阅读的故事正文。',
  },
  {
    code: 'abstract_emotion_packaging',
    bucket: 'expression',
    avoid: '不要用“复杂情绪、宿命感、安全感、压迫感、某种情绪”代替真实反应。',
    prefer: '把情绪拆成身体反应、场景感官和现实后果。',
  },
  {
    code: 'relation_labelization',
    bucket: 'structure',
    avoid: '不要只用“宿敌、盟友、恋人、师徒”这种标签直接说明关系。',
    prefer: '用称呼变化、利益冲突、站位和潜台词去证明关系。',
  },
  {
    code: 'world_rules_hollowing',
    bucket: 'structure',
    avoid: '不要只说“制度森严、法则完善、体系严密”而不落到执行方式和代价。',
    prefer: '写出规则如何约束行动、资源和惩罚。',
  },
  {
    code: 'ai_symmetry',
    bucket: 'sentence',
    avoid: '不要滥用“一方面…另一方面… / 既是…也是…更是…”这种刻意对称句式。',
    prefer: '让句子跟随人物思路自然偏斜，不强做排比平衡。',
  },
  {
    code: 'dash_abuse',
    bucket: 'sentence',
    avoid: '不要高频使用破折号插解释、补设定、制造假停顿。',
    prefer: '用动作、对白和正常句群承接补充信息。',
  },
  {
    code: 'parenthetical_explanation_abuse',
    bucket: 'sentence',
    avoid: '不要在正文中使用括号补设定、写备注或留下生成过程说明。',
    prefer: '把必要信息自然埋进场景证据和人物判断。',
  },
  {
    code: 'not_but_definition_pattern',
    bucket: 'sentence',
    avoid: '不要反复使用“不是……而是/是……”式定义句。',
    prefer: '让角色通过行动、误判和后果呈现变化。',
  },
  {
    code: 'double_metaphor_or_simile_stack',
    bucket: 'expression',
    avoid: '不要写“像……又像……”“仿佛……又仿佛……”这类双重比喻。',
    prefer: '每个场景只保留必要、准确、有信息量的一处修辞。',
  },
  {
    code: 'low_value_body_detail',
    bucket: 'sentence',
    avoid: '不要堆手指、指节、指腹、瞳孔、睫毛、喉咙、声音很轻等低价值细节。',
    prefer: '把细节改成行动阻力、关系压力或现实后果。',
  },
  {
    code: 'eye_open_close_standalone_paragraph',
    bucket: 'sentence',
    avoid: '不要把“他睁眼/闭眼/抬头/低头”单独成段当节拍。',
    prefer: '让动作和判断、对白或后果放在同一个有效叙事单元里。',
  },
  {
    code: 'ai_pseudo_philosophy',
    bucket: 'structure',
    avoid: '不要用“或许，这就是 / 也许，这便是 / 这一刻他终于明白”做硬升华。',
    prefer: '让事件结果和人物余波自己收尾，不替读者总结哲理。',
  },
  {
    code: 'ai_transition_cliche',
    bucket: 'sentence',
    avoid: '不要依赖“与此同时、在另一边、不知过了多久、就这样”这类万能转场。',
    prefer: '用时间节点、空间变化、人物视线或动作承接完成转场。',
  },
  {
    code: 'ai_ending_summary',
    bucket: 'structure',
    avoid: '不要用“而这一切才刚刚开始、故事远没有结束、新的篇章即将开始”这类总结式段尾。',
    prefer: '用未完成动作、风险余波或下一步选择收尾。',
  },
  // 人类节律组：词句套路之外，均匀节奏和过度洁净本身就是最强的机器签名。
  {
    code: 'uniform_sentence_rhythm',
    bucket: 'sentence',
    avoid: '不要整章用长度相近的短句连排，节奏像节拍器一样均匀。',
    prefer: '长短句交错：偶尔用一个四五十字的长句一口气写完一串动作或一段心绪，紧跟一两个极短句；允许句子随人物思路走偏。',
  },
  {
    code: 'clean_paragraph_beat',
    bucket: 'structure',
    avoid: '不要让每个段落都收在干净利落的动作点或短句点题上，段段如此即是模板。',
    prefer: '允许段落停在未完成处：话说一半、动作被打断、注意力被岔开；段落长短参差，别追求段段等重。',
  },
  {
    code: 'dialogue_too_efficient',
    bucket: 'sentence',
    avoid: '不要让对白句句高效、句句只推进信息，问一句答一句像笔录。',
    prefer: '对白允许答非所问、重复对方的词、迟疑改口、被动作或环境打断；关键信息可以藏在错位的应答里。',
  },
  {
    code: 'no_verbal_impurity',
    bucket: 'expression',
    avoid: '不要把叙述打磨得毫无冗余，完全无赘字的洁净文本反而暴露机器痕迹。',
    prefer: '按人物口吻保留少量顿挫和偏口语的小词（倒是、竟、偏偏、横竖之类），一章三五处即可，不堆砌。',
  },
]

const GENRE_ANTI_AI_PROMPT_RULES: Partial<Record<string, AntiAiPromptRule[]>> = {
  zombie: [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '末世段不要只写绝望气氛和尸潮压迫，不补食水、药品、感染、路线、噪声和守夜细节。',
      prefer: '把生存链、补给链和信任分配写到决策层。',
    },
  ],
  xianxia: [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '修仙段不要只喊大道、飞升、机缘，不补境界、资源、宗门秩序和凡俗牵连。',
      prefer: '把境界差、灵石消耗、门规和修行生态落到情节里。',
    },
  ],
  'modern-mystery': [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '悬疑段不要只写压抑和诡异，不补证据载体、调查路径、机构阻力和时间线。',
      prefer: '让线索入口、验证动作和排除过程进入现场。',
    },
  ],
  wuxia: [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '武侠段不要只写招式和气势，不补江湖规矩、师承门第、名声与行路成本。',
      prefer: '把门规、人情、盘缠、官府和伤药写进冲突后果。',
    },
  ],
  historical: [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '历史/古言段不要只写朝堂风云、宫闱权谋和圣心恩宠，不补礼法、官制、门第、诏令、税粮和脚程。',
      prefer: '把制度、身份秩序、时代物件和后勤成本写成角色必须面对的限制。',
    },
  ],
  fantasy: [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '玄幻段不要只写威压、天骄、机缘和臣服，不补等级差、资源消耗、势力反应和战斗代价。',
      prefer: '把境界、功法、资源、反噬和势力秩序写进爽点兑现过程。',
    },
  ],
  'urban-ability': [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '都市异能/系统爽文不要只写奖励到账、全场震惊和反派跪求，不补现代社会规则、监控、舆论、执法和能力代价。',
      prefer: '让爽点落在可验证的身份、资源、证据、风险和反击路径上。',
    },
  ],
  'western-fantasy': [
    {
      code: 'genre_hollowing',
      bucket: 'structure',
      avoid: '西幻段不要只写骑士、圣光、预言、魔法和龙，不补领地治理、教会秩序、粮草、封臣和施法材料。',
      prefer: '把信仰、封建义务、资源后勤和施法限制写成行动约束。',
    },
  ],
}

function findExcerpt(text: string, pattern: RegExp): string {
  const match = text.match(pattern)
  return match?.[0]?.trim() || ''
}

function adjustSeverity(base: GuardrailSeverity, realismLevel: RealismLevel): GuardrailSeverity {
  if (realismLevel === 'strict-realism' && base === 'medium') return 'high'
  if (realismLevel === 'stylized-fantasy' && base === 'medium') return 'low'
  return base
}

function dedupeFindings(findings: TextGuardrailFinding[]): TextGuardrailFinding[] {
  const seen = new Set<string>()
  const result: TextGuardrailFinding[] = []

  for (const finding of findings) {
    const key = `${finding.code}:${finding.excerpt}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(finding)
  }

  return result
}

function collectTokenHits(text: string, tokens: string[]): string[] {
  return [...new Set(tokens.filter((token) => text.includes(token)))]
}

function collectGenreHollowingFinding(text: string, genre?: string): TextGuardrailFinding | null {
  if (text.length < 20) return null

  const genreKey = getBuiltinGenreRules(genre).genreProfile.key
  const rule = GENRE_HOLLOW_RULES[genreKey]
  if (!rule) return null

  const abstractHits = collectTokenHits(text, rule.abstractTokens)
  const concreteHits = collectTokenHits(text, rule.concreteTokens)

  if (abstractHits.length < rule.minAbstractHits) return null
  if (concreteHits.length > rule.maxConcreteHits) return null

  return {
    code: 'genre_hollowing',
    severity: abstractHits.length >= rule.minAbstractHits + 1 && concreteHits.length === 0 ? 'high' : 'medium',
    message: rule.message,
    excerpt: abstractHits.slice(0, 3).join('、'),
  }
}

function collectHighFrequencyRepetitions(text: string): TextGuardrailFinding | null {
  if (text.length < 500) return null

  // 检测高频描写词组（在短距离内出现3次以上）
  const phrases = new Map<string, number>()
  const segments = text.split(/[。！？\n]/).filter(Boolean)

  for (const seg of segments) {
    // 提取2-4字词组
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i <= seg.length - len; i++) {
        const phrase = seg.slice(i, i + len)
        if (/^[\u4e00-\u9fff]{2,4}$/.test(phrase)) {
          phrases.set(phrase, (phrases.get(phrase) || 0) + 1)
        }
      }
    }
  }

  const repeated = [...phrases.entries()]
    .filter(([phrase, count]) => count >= 4 && !/^[的了是在不]/.test(phrase) && !/[的了着过]$/.test(phrase))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  if (repeated.length === 0) return null

  // 按千字密度分级：同一词组每千字出现 9 次以上视为必须修复
  const perThousand = (count: number) => (count * 1000) / Math.max(text.length, 1)
  const maxDensity = Math.max(...repeated.map(([, count]) => perThousand(count)))

  return {
    code: 'high_frequency_repetition',
    severity: maxDensity >= 9 ? 'high' : maxDensity >= 5 ? 'medium' : 'low',
    message: '某些描写词组在本章中高频重复出现，建议替换为同义表达或删减。',
    excerpt: repeated.map(([phrase, count]) => `"${phrase}"×${count}`).join('、'),
  }
}

const SIMILE_MARKER_PATTERN = /像|仿佛|宛如|好似|好像|如同|恍若|犹如/gu

function collectParagraphSimileStacking(text: string): TextGuardrailFinding | null {
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter((item) => item.length >= 30)
  if (paragraphs.length === 0) return null

  const stackedParagraphs: Array<{ excerpt: string; count: number }> = []
  let denseParagraphCount = 0
  for (const paragraph of paragraphs) {
    const count = (paragraph.match(SIMILE_MARKER_PATTERN) || []).length
    if (count >= 3) {
      stackedParagraphs.push({ excerpt: paragraph.slice(0, 24), count })
    } else if (count === 2 && paragraph.length <= 120) {
      denseParagraphCount += 1
    }
  }

  if (stackedParagraphs.length === 0 && denseParagraphCount < 2) return null

  const worst = stackedParagraphs.sort((left, right) => right.count - left.count)[0]
  return {
    code: 'paragraph_simile_stacking',
    severity: stackedParagraphs.some((item) => item.count >= 4) || stackedParagraphs.length >= 2 ? 'high' : 'medium',
    message: '同一段落里比喻连用过密，修辞在替代具体叙事信息。',
    excerpt: worst
      ? `"${worst.excerpt}…"段内比喻×${worst.count}`
      : `${denseParagraphCount} 个短段各含 2 处比喻`,
  }
}

const ENDING_LONELY_IMAGERY_PATTERN = /影子(?:被)?(?:拉得|拉长|拖得)(?:很长|细长|老长)?|(?:月光|夕阳|晨光|路灯)(?:落|洒|照|映)在|背影.{0,10}(?:消失|拉长|渐远|模糊)|(?:前方的)?路还(?:很长|长)|(?:他|她)知道.{0,14}(?:才刚刚开始|路还|还没有结束)|(?:细长|漫长)而孤独|孤独地(?:走|站|立)|夜色(?:里|中)(?:只剩|独自)/u

function collectEndingLonelyImagery(text: string): TextGuardrailFinding | null {
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  if (paragraphs.length < 2) return null

  const tail = paragraphs.slice(-2).join('\n')
  const match = tail.match(ENDING_LONELY_IMAGERY_PATTERN)
  if (!match) return null

  return {
    code: 'ending_lonely_imagery',
    severity: 'medium',
    message: '章尾用"影子拉长/月光落在/路还很长"这类意象化孤独收尾，是高频生成模板。',
    excerpt: match[0].slice(0, 30),
  }
}

function collectDensityGuardrailFindings(text: string): TextGuardrailFinding[] {
  const findings: TextGuardrailFinding[] = []
  const sentences = text.split(/[。！？!?；;\n]/).map((item) => item.trim()).filter((item) => item.length >= 4)
  const sentenceCount = Math.max(sentences.length, 1)
  const dashCount = (text.match(/——|--|—/gu) || []).length
  const parentheticalCount = (text.match(/[（(][^）)]{2,80}[）)]/gu) || []).length
  const bodyDetailCount = (text.match(/手指|指节|指腹|指尖|掌心|睫毛|眼睫|瞳孔|喉咙|声音很轻|声音很低|嗓音很轻|嗓音很低/gu) || []).length
  const isolatedTemplateParagraphs = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter((item) => /^(?:他|她|我|他们|她们)?(?:睁开眼睛|睁眼|闭上眼睛|闭眼|抬起头|低下头|垂下眼|移开视线)[。.!！]?$/.test(item))

  if (dashCount >= 4 || dashCount / sentenceCount >= 0.18) {
    findings.push({
      code: 'dash_abuse',
      severity: dashCount >= 8 ? 'high' : 'medium',
      message: '破折号密度偏高，容易形成解释腔、插话腔和假停顿。',
      excerpt: `破折号×${dashCount}`,
    })
  }

  if (parentheticalCount >= 3 || parentheticalCount / sentenceCount >= 0.14) {
    findings.push({
      code: 'parenthetical_explanation_abuse',
      severity: parentheticalCount >= 6 ? 'high' : 'medium',
      message: '括号说明过多，正文像在补设定或写生成备注。',
      excerpt: `括号说明×${parentheticalCount}`,
    })
  }

  if (bodyDetailCount >= 5 || bodyDetailCount / sentenceCount >= 0.22) {
    // 按篇幅归一化：绝对次数高但密度正常的长章节不升 high（剧情功能词如“掌心”会天然高频）
    const bodyDetailDensityPerThousand = (bodyDetailCount * 1000) / Math.max(text.length, 1)
    findings.push({
      code: 'low_value_body_detail',
      severity: bodyDetailCount >= 9 && bodyDetailDensityPerThousand >= 9 ? 'high' : 'medium',
      message: '手、眼、声音等低价值细节密度偏高，需要改成行动、阻力或后果。',
      excerpt: `手眼声音细节×${bodyDetailCount}`,
    })
  }

  if (isolatedTemplateParagraphs.length >= 2) {
    findings.push({
      code: 'eye_open_close_standalone_paragraph',
      severity: isolatedTemplateParagraphs.length >= 4 ? 'high' : 'medium',
      message: '睁眼闭眼或抬头低头类孤立短段过多，节拍像自动生成。',
      excerpt: isolatedTemplateParagraphs.slice(0, 3).join('、'),
    })
  }

  return findings
}

export function getBuiltinAntiAiPromptRules(genre?: string): AntiAiPromptRule[] {
  const genreKey = getBuiltinGenreRules(genre).genreProfile.key
  const genreRules = GENRE_ANTI_AI_PROMPT_RULES[genreKey] || []
  const deduped = new Map<string, AntiAiPromptRule>()
  ;[...BUILTIN_ANTI_AI_PROMPT_RULES, ...genreRules].forEach((rule) => {
    if (!deduped.has(rule.code)) {
      deduped.set(rule.code, rule)
    }
  })
  return [...deduped.values()]
}

// 爽文系题材：读者以节拍兑现为核心预期，文风必须与写实系拉开
const PACING_ESCALATION_GENRE_KEYS = new Set(['fantasy', 'xianxia', 'urban-ability', 'western-fantasy', 'wuxia'])

/**
 * 题材节拍硬约束：按题材分化叙事节奏与微动作细节预算，防止所有题材写成同一支笔。
 * 注入 Writer/Rewriter 硬约束区。
 */
export function buildGenrePacingGuidance(genre?: string): string {
  const genreKey = getBuiltinGenreRules(genre).genreProfile.key
  const shared = [
    '微动作细节预算：手/手指/掌心/眼/瞳孔/喉咙/声音很轻这类身体细节，每千字不超过 6 处；同一细节（如握拳、松手、抬头）一章内最多出现 2 次，重复时改写成动作阻力、关系压力或后果。',
    '每个场景必须有信息增量：新事实、新阻力、关系变化或状态变化至少一项；一段只有气氛和微表情就删掉或合并。',
  ]
  if (PACING_ESCALATION_GENRE_KEYS.has(genreKey)) {
    return [
      '本书属于强节拍类型（升级流/爽文谱系），节奏优先于氛围：',
      '- 事件密度：每章至少 2 个可见事件节点（冲突交锋、进展兑现、危机升级或信息揭露），不许整章只写一次内心波动。',
      '- 爽点兑现节拍：每章至少一次读者可感的进展或反击兑现（实力、资源、信息、地位、关系任一），兑现要有在场者的即时反应，不许只写主角自我确认。',
      '- 兑现必有代价或新钩子：每次进展同场景写出付出的代价或引来的新压力，结尾钩子必须指向下一个具体冲突。',
      '- 叙事速度：白描和心理段单段不超过 120 字就要回到动作或对白；对峙场面用短兵相接的交锋句推进，不用长段静态观察。',
      ...shared.map((line) => '- ' + line),
    ].join('\n')
  }
  return [
    '本书属于写实叙事类型，允许克制白描，但每章仍要有可感推进：',
    '- 每章至少 1 处冲突交锋或不可逆的状态变化，不许整章停在情绪和环境里。',
    '- 静态描写必须携带信息：环境、器物、身体细节要能反映人物处境或时代质感，纯氛围段落合并或删除。',
    ...shared.map((line) => '- ' + line),
  ].join('\n')
}

export function collectQualityGuardrailFindings(text: string, genre?: string): TextGuardrailFinding[] {
  const content = text.trim()
  if (!content) return []

  const realismLevel = getBuiltinGenreRules(genre).writingConstraints.realismLevel
  const patternFindings = LANGUAGE_PATTERN_RULES
    .filter((rule) => rule.pattern.test(content))
    .map((rule) => ({
      code: rule.code,
      severity: adjustSeverity(rule.severity, realismLevel),
      message: rule.message,
      excerpt: findExcerpt(content, rule.pattern),
    }))

  const genreFinding = collectGenreHollowingFinding(content, genre)
  const repetitionFinding = collectHighFrequencyRepetitions(content)
  const densityFindings = collectDensityGuardrailFindings(content)
  const simileStackingFinding = collectParagraphSimileStacking(content)
  const endingImageryFinding = collectEndingLonelyImagery(content)
  const allFindings = [
    ...patternFindings,
    ...(genreFinding ? [genreFinding] : []),
    ...(repetitionFinding ? [repetitionFinding] : []),
    ...densityFindings,
    ...(simileStackingFinding ? [simileStackingFinding] : []),
    ...(endingImageryFinding ? [endingImageryFinding] : []),
  ]

  return dedupeFindings(allFindings).slice(0, 8)
}

export function shouldForceRepair(findings: TextGuardrailFinding[]): boolean {
  const highCount = findings.filter((finding) => finding.severity === 'high').length
  const mediumCount = findings.filter((finding) => finding.severity === 'medium').length
  return highCount > 0 || mediumCount >= 2
}

// 风格密度类命中：应持续施加修复压力并进入审校意见，但不单独构成流水线硬阻断
const STYLE_DENSITY_FINDING_CODES = new Set([
  'low_value_body_detail',
  'dash_abuse',
  'high_frequency_repetition',
  'parenthetical_explanation_abuse',
  'paragraph_simile_stacking',
  'eye_open_close_standalone_paragraph',
])

/**
 * 修复轮次跑完后是否仍需硬阻断流水线：
 * 只有非风格密度类的高危命中（提示词泄漏、格式噪音、ID 污染等），
 * 或风格密度类高危命中堆积到 3 条以上，才值得停线转人工。
 */
export function hasBlockingGuardrailFindings(findings: TextGuardrailFinding[]): boolean {
  const highFindings = findings.filter((finding) => finding.severity === 'high')
  if (highFindings.some((finding) => !STYLE_DENSITY_FINDING_CODES.has(finding.code))) return true
  return highFindings.length >= 3
}

export function formatQualityGuardrailSummary(findings: TextGuardrailFinding[]): string[] {
  return findings.map((finding) => {
    const prefix = finding.severity === 'high' ? '[高]' : finding.severity === 'medium' ? '[中]' : '[低]'
    return `${prefix} ${finding.message}${finding.excerpt ? ` 例子：${finding.excerpt}` : ''}`
  })
}
