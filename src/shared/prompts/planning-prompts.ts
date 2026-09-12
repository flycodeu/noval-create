import type {
  ChapterOutlinePromptInput,
  ScenePlanPromptInput,
  StoryAnchorField,
  StoryAnchorPromptInput,
  StoryArcPromptInput,
  TimelineEventPromptInput,
  VolumePlanningPromptInput,
} from './prompt-types'
import {
  buildAvoidanceSection,
  buildGenreCoreExecutionGuidance,
  buildGoldenThreeChapterGuidance,
  buildGoldenThreeOutlineGuidance,
  buildHumanLanguageRules,
  buildPromptGuardrailSections,
  buildRuntimeAssertionSection,
  buildStepMemoryContinuityGuidance,
  buildTitleAndStructureGuidance,
  buildVariationHint,
  renderPrompt,
  section,
  sectionLines,
  sectionUnlessCovered,
} from './prompt-common'

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
      params.targetWords ? '全书规模参考：' + params.targetWords + '字。请在每个弧的 target_words 字段中给出阶段预算，允许根据实际剧情进展重新分配，不要求各弧预算机械相加。' : '',
    ]),
    params.rhythmTemplateSection
      ? section('可选节奏骨架参考（不强制）', params.rhythmTemplateSection + '\n以上模板只是常见节奏骨架，可为某些弧借用其张力结构，也可以完全不用；不要为了套模板牺牲主线因果。')
      : '',
    section('规划要求', [
      '规划 3 到 5 个故事弧，章节范围必须连续、无重叠、无空档。',
      '每个故事弧都要回答：这一段推进了什么、加压了什么、把什么交给下一段。',
      '每个故事弧都要让主角在能力、关系、认知、责任、资源或道德选择上至少有一项发生可追踪变化。',
      'growth_ledger 要写 2 到 4 条本弧累计形成的成长账本，明确主角到底学会了什么、失去了什么盲点、换来了什么位置变化。',
      'cost_ledger 要写 2 到 4 条本弧累计付出的代价账本，优先记录伤病、资源、人情、名声、机会、秩序或道德代价。',
      'key_turns 只写会改变量势的具体事件或决定，不写“矛盾升级”“命运转折”这种空话。',
      'subplot_links 要明确哪条支线在这里进入、发酵、反咬或回收。',
      '先保证主线因果顺，再安排支线落位；不要为了平均分配章节硬拆结构。',
      '每个弧要显式安排 1 到 2 处“质感/关系/喘息”节拍（在 pacing 标“慢”或在 key_turns 里点明），用来落地人物关系、日常质感和伏笔发酵；整弧不能全是高强度推进，张弛结合才耐读。',
      '最后一个故事弧必须负责主线收束，并给主要支线留出回扣空间。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      'summary、arc_goal、growth_ledger、cost_ledger 和 key_turns 都写成普通编辑能直接接手的结构说明，不要写策划黑话。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前故事的具体内容：',
    '[{"arc_name":"","stage":"铺垫/升级/高潮/收束","chapter_start":1,"chapter_end":10,"arc_goal":"","target_words":50000,"growth_ledger":[],"cost_ledger":[],"key_turns":[],"subplot_links":[],"pacing":"快/中/慢","summary":""}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
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
      params.arcGrowthLedger ? '成长账本：' + params.arcGrowthLedger : '',
      params.arcCostLedger ? '代价账本：' + params.arcCostLedger : '',
      params.arcTargetWords ? '本弧字数预算：' + params.arcTargetWords + '字，章节数量和单章篇幅要匹配这个预算。' : '',
      '章节范围：第' + params.chapterStart + '章到第' + params.chapterEnd + '章',
    ]),
    params.creativeStageSummary ? section('当前创作阶段（本批硬边界）', [
      params.creativeStageSummary,
      '本批章节只展开当前阶段真正需要的资产；未登记的新资产先以占位或待规划状态处理，不要提前扩写成全书设定。',
    ].join('\n')) : '',
    section('节奏模板约束（本弧已选定，必须执行）', params.rhythmSection),
    sectionLines('连续性上下文', [
      params.previousSummary ? '前情摘要：\n' + params.previousSummary : '',
      params.continuitySummary ? '连续性记忆：\n' + params.continuitySummary : '',
      params.openLoops ? '未回收事项：\n' + params.openLoops : '',
      params.characterStates ? '关键人物状态：\n' + params.characterStates : '',
      params.worldRulesSummary ? '世界规则：\n' + params.worldRulesSummary : '',
    ]),
    params.previousChapterOutlines ? section('已有章节大纲（差异化参考）', params.previousChapterOutlines) : '',
    buildGoldenThreeOutlineGuidance(params.chapterStart, params.chapterEnd),
    buildTitleAndStructureGuidance('chapterOutline'),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot, params.arcGoal].filter(Boolean).join('\n'),
      worldSummary: params.worldRulesSummary,
      taskFocus: '每章 目标 必须服务本弧目标，合起来能看出主线持续推进。',
      extraQualityLines: ['章节之间要有轻重起伏，不能每章都像同一个节奏模板。'],
    }),
    section('禁止编年体（硬约束）', [
      '禁止把章节大纲写成史实/大事记时间线。历史或既定事件只是底料，本弧的原创设计（arc_goal / 概述 / 成长账本 / 代价账本里点名的独有目标、组织、地点、人物、筹码）才是章节的骨架。',
      '每一章的 goal 和 plot_points 必须显式承载至少一项本弧原创设计元素的推进，而不是只复述“某年发生了某场战役/某个历史事件”。',
      '如果一个大事件（如一场大战役、一次大朝会）戏剧含量高，必须跨 2 到 4 章拆解，中间穿插朝堂博弈、人物关系、支线发酵或后方治理的场景，不能一章从头到尾把它办完。',
      '不允许出现“一章 = 一个历史节点”的一一对应排列；相邻章节要有推进节奏差（设置、交锋、反转、兑现、喘息），而不是等重的事件平铺。',
      '检验方法：如果把本弧的原创设计元素全部抹掉，章节大纲还能照原样成立（纯靠史实顺序即可复原），说明本章没有设计，必须重写。',
    ].join('\n')),
    section('生成要求', [
      '每章 goal 必须服务本弧目标，合起来能看出主线持续推进。',
      'title 必须准确对应本章核心事件或选择压力，不能为了“高级感”脱离具体内容。',
      'plot_points 按发生顺序写具体事件，不写“制造冲突”“推进剧情”这种空话。',
      'bridge_in 写清这章接住了什么，bridge_out 写清这章把什么递给下一章。',
      'growth_ledger 要写 1 到 3 条本章真正新增或兑现的成长账本，落在能力、关系、认知、责任、资源或道德选择的变化上。',
      'cost_ledger 要写 1 到 3 条本章真正付出的代价账本，落在伤病、资源、人情、时间、名声、机会或秩序压力上。',
      '至少安排部分章节让主角遭遇暂时解决不了的问题或明确代价，不要章章顺利推进。',
      '章节之间要有轻重起伏，不能每章都像同一个节奏模板。',
      '新生成的章节开头方式、情绪基调、登场人物组合不得与已有章节大纲连续重复超过两章。',
      '优先安排真正需要上场的人物和地点，别把所有线索都塞进每一章。',
    ].join('\n')),
    params.designGateDirective ? section('上一轮设计校验反馈（必须修正）', params.designGateDirective) : '',
    section('语言要求', buildHumanLanguageRules([
      '章节标题、目标、成长账本和代价账本都要写得清楚直接，避免抽象套话。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前故事的具体内容：',
    '[{"chapter_num":' + params.chapterStart + ',"title":"","goal":"","growth_ledger":[],"cost_ledger":[],"plot_points":[],"characters":[],"location":"","emotion_tone":"","bridge_in":"","bridge_out":""}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
  ])
}

export function buildVolumePlanningPrompt(params: VolumePlanningPromptInput): string {
  const estimatedVolumes = Math.max(1, Math.ceil(params.targetTotalWords / 300000))
  return renderPrompt([
    `为这部${params.targetTotalWords >= 1000000 ? '百万字级' : '长篇'}小说规划卷结构。`,
    `总目标字数约 ${params.targetTotalWords} 字，预估 ${estimatedVolumes} 卷左右（可根据剧情需要调整）。`,
    '每卷必须有独立的阶段性目标和高潮，同时服务于全书主线推进。',
    sectionLines('小说信息', [
      '书名：' + params.novelTitle,
      '简介：' + params.novelSynopsis,
      '题材：' + params.genre,
    ]),
    sectionLines('故事主线', [
      '故事目标：' + (params.storyGoal || '未提供'),
      '核心冲突：' + (params.coreConflict || '未提供'),
      '主线剧情：' + (params.mainPlot || '未提供'),
      '结局方向：' + (params.ending || '未提供'),
    ]),
    params.existingArcs ? section('已有故事弧', params.existingArcs) : '',
    params.protagonistSummary ? section('主角概况', params.protagonistSummary) : '',
    params.worldRulesSummary ? section('世界规则', params.worldRulesSummary) : '',
    params.threadsSummary ? section('故事线索', params.threadsSummary) : '',
    buildTitleAndStructureGuidance('volume'),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: [params.storyGoal, params.coreConflict, params.mainPlot].filter(Boolean).join('\n'),
      worldSummary: params.worldRulesSummary,
      taskFocus: '卷规划必须体现主角成长阶梯和主线推进节奏，每卷有明确的阶段性高潮。',
    }),
    section('规划要求', [
      '每卷的 theme 不能是空泛的"成长""蜕变"，必须写清这一卷主角面对的具体困境和要解决的具体问题。',
      '每卷的 key_arcs 必须指向具体的故事弧名称或事件，不能只写泛化推进标签。',
      '相邻两卷之间必须有明确的承接关系：上一卷的遗留问题如何影响下一卷。',
      '字数分配要考虑节奏：开篇卷可以短一些（15-25万字），中段卷可以长一些（25-35万字），收束卷根据需要调整。',
      '每卷必须标注主角在该卷的成长阶段和实力/地位变化。',
      '每卷除了阶段高潮，还要显式规划质感/关系/喘息段落（可写进 subplot_status 或 key_arcs），让读者在高强度推进之间有呼吸，人物在非战斗场合显出性格。',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '卷标题和主题描述要具体，不要写成万能隐喻标题或只表达气氛的空泛卷名。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前故事的具体内容：',
    '[{"volume_number":1,"title":"","theme":"","target_words":' + Math.round(params.targetTotalWords / estimatedVolumes) + ',"chapter_estimate":{"start":1,"end":100},"protagonist_stage":"","key_arcs":[],"major_events":[],"subplot_status":{},"volume_climax":"","bridge_to_next":""}]',
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
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
      '篇幅参考：约 ' + params.targetWords + ' 字（非硬性字数；仅用于规划场景密度，根据本章场景和收束位置自然决定长度）。',
      params.emotionTone ? '情绪基调：' + params.emotionTone : '',
    ]),
    ...buildPromptGuardrailSections({
      genre: params.genre,
      storyCore: params.storyCore,
      worldSummary: params.worldRules,
      taskFocus: '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      extraContextLines: ['每个场景写清：这一段要完成什么、当前冲突是什么、谁在场、会用到什么关键物品、必须交代什么。'],
      extraRealityLines: ['优先处理章节任务和因果推进，不要为了花样强行加戏。'],
    }),
    sectionUnlessCovered('本章目标', params.chapterGoal, params.hardConstraintContext, ['章节目标']),
    section('硬约束', params.hardConstraintContext),
    section('设计对齐矫正（本章被弧级设计校验标记，必须执行）', params.designGateDirective),
    section('本章节奏节拍（弧级节奏模板换算）', params.rhythmSection),
    section('角色 Voice Lock', params.dialogueVoiceLocks),
    section('场景写作材料', params.sceneWritingBrief),
    section('本章细纲', params.plotPoints),
    section('当前故事弧', params.currentArc),
    section('小说核心约束', params.storyCore),
    sectionUnlessCovered('写作类型', params.writingContractSummary, params.hardConstraintContext, ['写作合同/章节合同']),
    section('章节级主题验证', params.themeChapterTest),
    sectionUnlessCovered('关键人物关系', params.relationSummary, params.hardConstraintContext),
    section('世界规则', params.worldRules),
    sectionUnlessCovered('人物当前状态', params.characterStates, params.hardConstraintContext),
    sectionUnlessCovered('当前世界状态', params.worldStates, params.hardConstraintContext),
    section('地图地点上下文', params.mapSummary),
    sectionUnlessCovered('关键物品与去向', params.itemSummary, params.hardConstraintContext, ['关键物品去向']),
    section('上一章关键先验', params.previousChapterContext),
    section('上章结尾', params.lastChapterEnding),
    section('章节衔接桥', params.chapterBridgePlan),
    section('步骤接力记忆', params.stepMemorySummary),
    buildRuntimeAssertionSection(params.runtimeAssertions),
    buildGoldenThreeChapterGuidance(params.chapterNum, 'scenePlan'),
    buildStepMemoryContinuityGuidance('scenePlan'),
    buildGenreCoreExecutionGuidance({
      genre: params.genre,
      novelTitle: params.novelTitle,
      storyCore: params.storyCore,
      stage: 'scenePlan',
    }),
    buildTitleAndStructureGuidance('scenePlan'),
    section('最近章节摘要', params.previousSummaries),
    section('连续性记忆', params.continuitySummary),
    sectionUnlessCovered('必须承接', params.continuityNotes, params.hardConstraintContext),
    sectionUnlessCovered('未回收事项', params.openLoops, params.hardConstraintContext, ['必须回收事项']),
    section('本章应回收伏笔', params.dueForeshadows),
    section('时间轴锚点', params.timelineSummary),
    section('时间轴待回收', params.timelineOpenThreads),
    section('活跃支线与伏笔', params.activeThreads),
    section('POV 约束', params.povGuidance),
    section('POV 轮转建议', params.povRotationGuidance),
    section('感官雷达', params.sensoryGuidance),
    section('叙事比例', params.narrativeRatioGuidance),
    section('节奏曲线', params.storyPacingGuidance),
    section('钩子连续性', params.hookContinuityGuidance),
    section('长文压缩记忆', params.longTermMemory),
    section('向量召回记忆', params.recalledMemory),
    section('跨章表达去重', params.expressionDedupGuidance),
    section('摘要健康', params.summaryHealthGuidance),
    section('角色声音进化', params.voiceEvolutionGuidance),
    section('当前结构体检提醒', params.consistencyNotes),
    section('计划要求', [
      '拆成 4 到 7 个场景或连续段落，每一段都要能直接落成正文。',
      '每个场景写清：这一段要完成什么、当前冲突是什么、谁在场、会用到什么关键物品、必须交代什么。',
      '至少安排一两个场景通过试错、碰壁或代价来体现人物成长，不要只靠总结句宣布成长。',
      '场景顺序必须连贯，前一段的结果要自然推动后一段。',
      '优先处理章节任务和因果推进，不要为了花样强行加戏。',
      'exit_hook 只写最自然的收尾钩子，不要故作玄虚。',
      '',
      '设计维度（必填字段，把场景从“陈述事件”升级成“设计的戏”）：',
      '- hidden_agendas（必填）：在场每一方此刻真正想要什么（可能和嘴上说的不一样），逐方写。一场戏若只有一方有诉求、其余人只是接话，就是单向量陈述，必须补出对方的算盘。每个场景都必须输出非空数组；空数组视为未完成设计，会被打回。',
      '- irony_gap（必填）：读者已经知道、但场上某个角色还不知道的事（戏剧反讽）。优先设计一处，让读者比角色多知道一点；确实没有信息差时必须显式写“无”，留空视为未完成设计。',
      '- audience：这场戏其实是演给谁看的——在场的第三方、场外的势力、还是角色在给自己一个交代。对白和动作要考虑“被谁听见/看见”。',
      '- 章节级主题验证（如果已提供）：先把命题拆成可观察的主题问题、角色选择、即时代价和后果；至少一个场景必须填写 theme_question / theme_choice / theme_cost / theme_consequence，不能只写“体现主题”或“人物成长”。',
      '',
      '可执行性检查（每个场景必须同时满足）：',
      '1. 开场钩子：场景开头 50 字内必须有一个动作、悬念或感官冲击，不能以描写天气/环境/心理活动开头。',
      '2. 具体冲突：conflict 字段必须写出「谁 vs 谁/什么」以及冲突的具体表现，不能写"矛盾升级""关系紧张"这种抽象词。',
      '3. 退出悬念：exit_hook 必须包含一个未解决的问题或即将发生的动作，让读者必须翻页。',
      '4. 因果链：每个场景的 purpose 必须承接上一个场景的 exit_hook 或结果。',
      '5. 博弈感：多人同场时，hidden_agendas 里至少有两方诉求不完全一致，让对白承载潜台词而不是互相通报信息。',
      '',
      '负面示例（以下写法会被打回重写）：',
      '× purpose: "推进剧情发展" → ✓ "林远发现仓库存粮被偷，追踪脚印到三号楼"',
      '× conflict: "矛盾进一步激化" → ✓ "林远要求搜查三号楼，赵队长以安全为由拒绝放行"',
      '× exit_hook: "事情变得更加复杂" → ✓ "林远在三号楼门缝里闻到血腥味"',
      '× beat: "众人讨论后达成一致" → ✓ "投票 4:3 通过搜查，赵队长摔门离开"',
      '× hidden_agendas: "大家各有心思" → ✓ "林远想借搜查立威；赵队长在护着侄子；书记员只想不担责"',
      '× hidden_agendas: [] / irony_gap: ""（留空）→ 空数组、空串视为未完成设计，必须写出各方算盘；确无信息差时 irony_gap 显式写"无"',
    ].join('\n')),
    section('语言要求', buildHumanLanguageRules([
      '场景目标和冲突都写具体事实，不写“命运转折”“真正成长”这种空话。',
    ])),
    '只输出 JSON 数组。示例值只表示字段结构，实际输出必须写入当前章节的具体内容：',
    '[{"scene_order":1,"scene_title":"","purpose":"","location":"","time_anchor":"","present_characters":[],"key_items":[],"conflict":"","hidden_agendas":[],"irony_gap":"","audience":"","beat":"","must_cover":[],"climax_variant":"","exit_hook":"","theme_question":"","theme_choice":"","theme_cost":"","theme_consequence":""}]',
    buildAvoidanceSection(params.rejectedDigests || []),
    params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'outline') : '',
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
  rhythmSummary?: string
  background?: string
  protagonistReference?: string
  protagonistRule?: string
}): string {
  return buildStoryArcPlanningPrompt({
    ...params,
    rhythmSummary: params.rhythmSummary || '',
    background: params.background || '',
    protagonistReference: params.protagonistReference || '主角',
    protagonistRule: params.protagonistRule || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}

export function chapterOutlinePrompt(params: {
  novelTitle: string
  genre?: string
  storyGoal?: string
  coreConflict?: string
  mainPlot?: string
  arcName: string
  arcGoal: string
  arcSummary?: string
  arcGrowthLedger?: string
  arcCostLedger?: string
  chapterStart: number
  chapterEnd: number
  previousSummary: string
  characterStates: string
  continuitySummary?: string
  openLoops?: string
  worldRulesSummary: string
  protagonistReference?: string
  protagonistRule?: string
}): string {
  return buildChapterOutlinePlanningPrompt({
    novelTitle: params.novelTitle,
    genre: params.genre || '',
    storyGoal: params.storyGoal || '',
    coreConflict: params.coreConflict || '',
    mainPlot: params.mainPlot || '',
    arcName: params.arcName,
    arcGoal: params.arcGoal,
    arcSummary: params.arcSummary || '',
    arcGrowthLedger: params.arcGrowthLedger || '',
    arcCostLedger: params.arcCostLedger || '',
    chapterStart: params.chapterStart,
    chapterEnd: params.chapterEnd,
    previousSummary: params.previousSummary,
    characterStates: params.characterStates,
    continuitySummary: params.continuitySummary || '',
    openLoops: params.openLoops || '',
    worldRulesSummary: params.worldRulesSummary,
    protagonistReference: params.protagonistReference || '主角',
    protagonistRule: params.protagonistRule || '若涉及主角，沿用现有设定中的唯一称呼，不要擅自改名。',
  })
}
