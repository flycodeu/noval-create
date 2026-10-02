import { ATLAS_ATTRIBUTE_LABELS } from './atlas-presentation'

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
  attributes: '特点与设定', entities: '资料', relations: '关系', changes: '修改', fromId: '起点/人物', toId: '终点/关联人物', parentId: '所属地域', effectiveFromChapter: '生效章位', source: '依据', note: '依据说明', evidenceQuote: '正文证据', kind: '类别', status: '状态', reason: '原因', evidence: '依据', suggestion: '建议', issues: '问题', hardBlockers: '阻塞问题', deterministicBlockers: '合同与事实边界阻断', warnings: '提示', requirements: '要求', checks: '核对结果', message: '说明', score: '评分', review: '模型评审证据', modelReview: '模型评审', rewrittenReview: '修订后评审', facts: '信息点与秘密', factReveals: '本章实际揭示', factId: '信息点编号', characterIds: '知情人物', plannedRevealChapterNum: '计划揭示章序', knownFromStartCharacterIds: '开书前已知人物',
}

export const INTERNAL_FIELDS = new Set(['key', 'schemaVersion', 'requestFingerprint', 'contextSummaryHash', 'createdAt', 'updatedAt', 'taskId', 'schemaHint', 'novelId', 'chapterId', 'id', 'clientId', 'artifactId', 'contentHash', 'outputFormat', 'draftContentHash', 'effectiveContentHash', 'code'])
export function fieldLabel(key: string) {
  const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return CONTENT_LABELS[key] || CONTENT_LABELS[camel] || ATLAS_ATTRIBUTE_LABELS[key] || ATLAS_ATTRIBUTE_LABELS[camel] || key
}
export const VALUE_LABELS: Record<string, string> = { third_limited: '第三人称限知', third_omniscient: '第三人称全知', first_person: '第一人称', multi_pov: '多视角', past: '过去时', present: '现在时', mixed: '混合', single: '单主角', dual: '双主角', ensemble: '群像', fixed: '固定', rotating: '轮换', free_switch: '自由切换', none: '无', light: '轻度', heavy: '多线', forbidden: '禁止', limited: '有限使用', allowed: '允许', confirmed: '已确定', planned: '计划', relationship: '人物关系', route: '通路', presence: '所在地', membership: '成员关系', ownership: '持有关系', participation: '事件参与', passed: '通过', blocked: '未通过', pending: '待处理', accepted: '已接受', rejected: '已拒绝', applied: '已应用' }

export function changedFields(before: unknown, after: unknown, prefix = ''): Array<{ path: string; before: unknown; after: unknown }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !INTERNAL_FIELDS.has(key)).flatMap(key => changedFields(recordOf(before)[key], recordOf(after)[key], prefix ? `${prefix} / ${fieldLabel(key)}` : fieldLabel(key)))
  }
  return [{ path: prefix || '内容', before, after }]
}
