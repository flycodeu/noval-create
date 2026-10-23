import { ATLAS_ATTRIBUTE_LABELS } from './atlas-presentation'
import { WRITING_CONTRACT_PRESETS } from '../../../shared/writing-contract'
import { CREATIVE_STAGE_LABELS } from '../../../shared/creative-workflow'

export function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parseDocument(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return value }
}

/** Preserve extension fields while allowing a canonical builder to clear known fields. */
export function mergeCanonicalDocument(original: unknown, previous: unknown, next: unknown): unknown {
  if (Array.isArray(next)) {
    const originals = Array.isArray(original) ? original : []
    const previousItems = Array.isArray(previous) ? previous : []
    const corresponding = (items: unknown[], item: unknown, index: number) => {
      const id = recordOf(item).id
      return id !== undefined ? items.find(value => recordOf(value).id === id) : items[index]
    }
    return next.map((item, index) => mergeCanonicalDocument(corresponding(originals, item, index), corresponding(previousItems, item, index), item))
  }
  if (!next || typeof next !== 'object') return next
  const result = { ...recordOf(original) }
  const before = recordOf(previous)
  const after = recordOf(next)
  for (const key of Object.keys(before)) if (!(key in after)) delete result[key]
  for (const [key, value] of Object.entries(after)) result[key] = mergeCanonicalDocument(result[key], before[key], value)
  return result
}

export const CONTENT_LABELS: Record<string, string> = {
  paragraphs: '修订段落', index: '段落序号', text: '段落内容',
  stage: '资料类别', atChapter: '复核章位', snapshot: '本次评审的正式资料', failureStage: '未通过的环节', contractValidation: '结构校验', initialIssues: '首次结构问题', finalIssues: '修订后仍存在的结构问题', initialModelReviewSkipped: '初次模型审校未执行',
  volumeId: '所属卷', partId: '所属单元', targetWords: '目标字数', humanLanguageRepairs: '表达修改建议', languageRisks: '语言风险', rejectRequired: '需要退回', rewriteRequired: '需要修订', severity: '严重程度', topFixes: '优先修改建议',
  dynastyName: '朝代或政权', storyStartLabel: '开篇时间', currentTimeLabel: '当前故事时间', currentTimeChapterNum: '时间对应章序', currentTimeEvidence: '时间依据', relativeDay: '距开篇天数', sequenceInDay: '同日先后顺序', timePrecision: '时间精度',
  title: '标题', name: '名称', fullName: '姓名', summary: '摘要', description: '说明', content: '正文', output: '候选内容',
  userBackground: '故事背景', expandedBackground: '补充设定', synopsis: '简介', background: '背景',
  projectBrief: '作品定位', premise: '故事起点', storyDesign: '故事方向', endgameDesign: '结局与兑现', writingRules: '写作约束', themeVoice: '叙事与文风', worldRules: '世界规则',
  positioning: '定位', coreHook: '核心吸引力', protagonistStart: '主角起点', constraints: '不可改动的边界', languageGuardrails: '语言边界',
  storyGoal: '故事目标', coreConflict: '核心冲突', mainPlot: '主线', subPlotsText: '支线说明', subPlotsList: '支线设计', ending: '结局', endingType: '结局类型',
  rhythmSetup: '铺垫比重', rhythmConflict: '冲突比重', rhythmEnding: '收束比重', endingMode: '结局走向', finalConflict: '最终冲突', themeAnswer: '主题回答', mustDeliverPromises: '必须兑现的承诺', payoffChecklist: '回收清单', deliberateUnknowns: '保留的未知', finalImage: '结尾画面', lastScene: '最后一场',
  antiAiFlavor: '语言去模板要求', commonSenseRules: '常识边界', bannedTerms: '禁用词', platformMode: '发布形式', targetAudience: '读者群', targetReader: '目标读者', readerPromise: '阅读承诺', sellingPoints: '特点', compTitles: '参考作品', tabooRules: '禁忌与边界', deliveryRhythm: '连载节奏',
  theme: '主题', themeChapterTest: '章节主题检验', motifs: '反复意象', emotionalCore: '情感核心', pov: '叙事视角', tense: '时态', protagonistCount: '主角结构', viewpointMode: '视角切换', parallelTimelines: '时间线', openingStyle: '开篇方式', flashbackPolicy: '倒叙边界', narratorDistance: '叙述距离', voiceKeywords: '文风关键词', styleRules: '文风规则', dialogueRules: '对话规则', descriptionRules: '描写规则', forbiddenPhrases: '禁用措辞', targetWorkSampleGuide: '参考样章要求', humanStyleSampleLock: '作者文风要求', writingContractTags: '写作要求',
  genreProfile: '世界基调', key: '类别', subgenre: '细分类别', worldviewTone: '世界氛围', socialFrame: '社会结构', narrativeFocus: '叙事重点', languageAvoidances: '用语禁区', powerSystems: '能力与限制', speciesSystem: '种属', factionSystem: '组织规则', characterEcology: '人物生态', mapBlueprint: '地域层级', worldDynamics: '环境与生计', timelineConfig: '历法', writingConstraints: '世界与叙事约束',
  appliesTo: '适用对象', levels: '阶段/层级', advancementRule: '变化规则', limitations: '限制', cost: '代价', taboo: '禁忌', entityType: '对象类型', traits: '特征', commonIdentities: '常见身份', relationToHumans: '与人的关系', storyUse: '剧情用途', factionType: '组织类型', structure: '组织结构', resources: '资源', externalRelations: '对外关系', recruitFrom: '成员来源', notableSites: '据点', overview: '概览', slots: '人物位置', label: '说明', narrativeFunction: '叙事作用', contextLink: '关联依据', preferredFactions: '关联组织', powerBias: '能力倾向', depth: '深度', nodeTypes: '地点种类', relationHint: '层级关系', suggestedCount: '规划数量', examples: '例子',
  climateCycles: '气候变化', economyLoops: '资源流转', region: '地域', pattern: '规律', seasonalShift: '季节变化', hazardTrigger: '危险触发', travelImpact: '通行影响', resourceImpact: '资源影响', coreResource: '核心资源', circulationPath: '流转路径', controller: '控制方', scarcityTrigger: '稀缺原因', volatilityTrigger: '波动原因', calendarType: '历法类型', eraName: '纪年', epochLabel: '纪元', baseYearLabel: '基准年', displayPattern: '日期格式', relativeZeroLabel: '时间起点', recommendedEventTypes: '事件类型', precisionOptions: '时间精度',
  antiQuoteEmphasis: '避免金句式强调', antiConceptSlogans: '避免概念口号', antiSymmetricLines: '避免整齐对仗', narrationStyle: '叙述风格', dialogueStyle: '对话风格', extraRules: '补充规则', realismLevel: '现实程度', sciencePolicy: '科学边界', physicsPolicy: '物理边界', commonSenseFocus: '常识重点', contextAlignmentFocus: '上下文一致性',
  chapterGoal: '本章目标', chapterNum: '章序', chapterNumber: '章序', chapterTitle: '章名', outline: '章节安排', chapters: '章节', volumes: '卷', parts: '单元', scenes: '场景', chapterContract: '章节约束', sceneGoal: '场景目标', timeLocation: '时间地点', obstacle: '阻碍', resultState: '结束状态', revealPayload: '本场揭示', forbiddenActions: '禁止发生', acceptanceNotes: '验收要求', openingStyleHint: '开场', endingStyle: '结束方式', expositionMode: '信息呈现', emotionFocus: '情感重点', hookType: '悬念类型', requiredArcProgress: '人物变化要求', requiredResistanceActions: '阻力要求', requiredAssetRefs: '必须出现的设定', conflictType: '冲突类型', emotionShift: '情感变化', linkageMode: '承接方式', segmentTitle: '场景名', segmentOrder: '场景序号',
  attributes: '特点与设定', entities: '资料', relations: '关系', changes: '修改', fromId: '起点/人物', toId: '终点/关联人物', parentId: '所属地域', effectiveFromChapter: '生效章位', source: '依据', note: '依据说明', evidenceQuote: '正文证据', kind: '类别', status: '状态', reason: '原因', evidence: '依据', suggestion: '建议', issues: '问题', hardBlockers: '阻塞问题', deterministicBlockers: '合同与事实边界阻断', warnings: '提示', requirements: '要求', checks: '核对结果', message: '说明', score: '评分', review: '模型评审证据', modelReview: '模型评审', rewrittenReview: '修订后评审', facts: '信息点与秘密', factReveals: '本章实际揭示', factId: '信息点', characterIds: '知情人物', plannedRevealChapterNum: '计划揭示章序', knownFromStartCharacterIds: '开书前已知人物',
  servedThreadIds: '推进的故事线', requiredCharacterArcIds: '推进的人物变化', requiredRelationshipArcIds: '推进的关系变化', requiredResistanceTrackIds: '必须回应的阻力', requiredEndgameCommitmentIds: '必须兑现的承诺', requiredForeshadowIds: '必须处理的伏笔', allowedFactIds: '允许使用的信息', revealedFactIds: '本章揭示的信息', readerKnownChapterId: '读者获知章节', protagonistKnownChapterId: '主角获知章节', knownChapterId: '获知章节', knownFromStart: '开书前已知', characterKnowledge: '人物知情情况', plannedRevealVolume: '计划揭示卷序', forbiddenBeforeVolume: '最早可揭示卷序', characters: '涉及人物', conflict: '矛盾', mainlineLink: '与主线的关系', endChapter: '收束章序',
}

export const INTERNAL_FIELDS = new Set(['key', 'schemaVersion', 'requestFingerprint', 'contextSummaryHash', 'createdAt', 'updatedAt', 'taskId', 'schemaHint', 'novelId', 'chapterId', 'segmentId', 'nativeId', 'id', 'clientId', 'artifactId', 'contentHash', 'outputFormat', 'draftContentHash', 'effectiveContentHash', 'code'])
export function fieldLabel(key: string, value?: unknown) {
  const camel = documentFieldKey(key)
  if (camel === 'stage' && ['accepted', 'rewritten', 'rejected'].includes(String(value))) return '审校结果'
  return CONTENT_LABELS[key] || CONTENT_LABELS[camel] || ATLAS_ATTRIBUTE_LABELS[key] || ATLAS_ATTRIBUTE_LABELS[camel] || key
}
export function documentFieldKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/Json$/, '')
}

export function documentHasContent(value: unknown): boolean {
  const parsed = parseDocument(value)
  if (parsed !== value) return documentHasContent(parsed)
  if (value == null || typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value)) return value.some(documentHasContent)
  if (typeof value === 'object') return Object.entries(value).some(([key, item]) => !INTERNAL_FIELDS.has(documentFieldKey(key)) && documentHasContent(item))
  return true
}

export const DOCUMENT_OPTIONS: Record<string, Record<string, string>> = {
  pov: { third_limited: '第三人称限知', third_omniscient: '第三人称全知', first_person: '第一人称', multi_pov: '多视角' },
  tense: { past: '过去时', present: '现在时', mixed: '混合时态' },
  protagonistCount: { single: '单主角', dual: '双主角', ensemble: '群像' },
  viewpointMode: { fixed: '固定视角', rotating: '轮换视角', free_switch: '自由切换' },
  parallelTimelines: { none: '单线推进', light: '轻度多线', heavy: '重度多线' },
  flashbackPolicy: { forbidden: '禁止插叙与倒叙', limited: '有限使用', allowed: '允许使用' },
  endingType: { HE: '圆满结局', BE: '悲剧结局', open: '开放结局', multi: '多种结局', HE_BE: '悲喜交织' },
  endingMode: { victory: '胜利收束', hard_won: '艰难获胜', costly_victory: '付出代价的胜利', tragic: '悲剧收束', ironic: '反讽收束', open: '开放收束', multi_line: '多线收束' },
  platformMode: { general: '通用', web_serial: '网络连载', publishing: '出版', fanqie: '番茄小说', feilu: '飞卢小说' },
  openingStyle: { hook: '悬念直入', daily: '日常切入', incident: '事件起手', flashback: '倒叙开场' },
  endingStyle: { hook: '留下悬念', reversal: '反转收尾', aftershock: '余波未平', stillness: '画面定格', arrival: '第三人入场' },
  expositionMode: { embedded_action: '动作带出', dialogue_reveal: '对白带出', experience_filter: '角色经历带出', minimal: '只给必要说明', brief_direct: '简短直述' },
  calendarType: { gregorian: '公历', regnal: '年号纪年', 'relative-disaster': '灾变纪年', 'custom-era': '自定义纪元', 'future-date': '未来纪年' },
  realismLevel: { 'strict-realism': '严格写实', 'rule-realism': '遵循世界规则', 'stylized-fantasy': '风格化幻想' },
  status: { ready: '已就绪', confirmed: '已确定', planned: '计划中', planning: '规划中', draft: '草稿', active: '进行中', locked: '已定稿', written: '已写定', passed: '通过', pass: '通过', warn: '需留意', fail: '未通过', blocked: '未通过', pending: '待处理', accepted: '已接受', rejected: '已拒绝', applied: '已应用', introduced: '已引入', partial_reveal: '部分揭示', pending_payoff: '待回收', explained: '已解释', needs_revision: '需要修订' },
}
const DOCUMENT_VALUE_LABELS: Record<string, Record<string, string>> = {
  ...DOCUMENT_OPTIONS,
  stage: { ...CREATIVE_STAGE_LABELS, accepted: '已通过', rewritten: '已定向修订', rejected: '未通过' },
  failureStage: { contract: '结构校验', review: '模型审校请求', rewrite: '模型修订请求', recheck: '修订后复检' },
  severity: { low: '低', medium: '中', high: '高' },
  kind: { character: '人物', location: '地点', faction: '组织', item: '物品', event: '事件', relationship: '人物关系', route: '通路', presence: '所在地', membership: '成员关系', ownership: '持有关系', participation: '事件参与', puzzle: '疑问', clue: '线索', truth: '真相', red_herring: '误导线索' },
  writingContractTags: Object.fromEntries(WRITING_CONTRACT_PRESETS.map(item => [item.value, item.label])),
}
export function documentEnumLabel(key: string, value: unknown): unknown {
  return DOCUMENT_VALUE_LABELS[documentFieldKey(key)]?.[String(value)] ?? value
}

export function changedFields(before: unknown, after: unknown, prefix = '', fieldKey = ''): Array<{ path: string; fieldKey: string; before: unknown; after: unknown }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !INTERNAL_FIELDS.has(key)).flatMap(key => changedFields(recordOf(before)[key], recordOf(after)[key], prefix ? `${prefix} / ${fieldLabel(key)}` : fieldLabel(key), key))
  }
  return [{ path: prefix || '内容', fieldKey, before, after }]
}
