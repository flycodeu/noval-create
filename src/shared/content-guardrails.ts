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
    code: 'ai_pseudo_philosophy',
    severity: 'medium',
    message: '伪哲学总结句，段落结尾硬升华。',
    pattern: /(或许，这就是|也许，这便是|这，便是|而这，正是|这一刻.{0,6}(?:他|她)(?:终于)?(?:明白|懂得|理解)|(?:他|她)第一次(?:真正)?(?:理解|明白|感受到))/u,
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

  return {
    code: 'high_frequency_repetition',
    severity: repeated.some(([, count]) => count >= 6) ? 'medium' : 'low',
    message: '某些描写词组在本章中高频重复出现，建议替换为同义表达或删减。',
    excerpt: repeated.map(([phrase, count]) => `"${phrase}"×${count}`).join('、'),
  }
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
  const allFindings = [
    ...patternFindings,
    ...(genreFinding ? [genreFinding] : []),
    ...(repetitionFinding ? [repetitionFinding] : []),
  ]

  return dedupeFindings(allFindings).slice(0, 8)
}

export function shouldForceRepair(findings: TextGuardrailFinding[]): boolean {
  const highCount = findings.filter((finding) => finding.severity === 'high').length
  const mediumCount = findings.filter((finding) => finding.severity === 'medium').length
  return highCount > 0 || mediumCount >= 2
}

export function formatQualityGuardrailSummary(findings: TextGuardrailFinding[]): string[] {
  return findings.map((finding) => {
    const prefix = finding.severity === 'high' ? '[高]' : finding.severity === 'medium' ? '[中]' : '[低]'
    return `${prefix} ${finding.message}${finding.excerpt ? ` 例子：${finding.excerpt}` : ''}`
  })
}
