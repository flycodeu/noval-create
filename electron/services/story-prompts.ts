import { GLOBAL_WRITING_RULES } from './prompts'

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

export function buildStoryArcPlanningPrompt(params: StoryArcPromptInput): string {
  return `你是中文长篇小说策划编辑，请为小说《${params.novelTitle}》规划完整故事弧。
【题材】${params.genre || '未知题材'}

【故事背景】${params.background || '（暂无补充背景）'}

【主角指代】${params.protagonistReference}
【主角命名规则】${params.protagonistRule}

【核心设定】
- 故事核心目标：${params.storyGoal || '（未填写）'}
- 核心冲突：${params.coreConflict || '（未填写）'}
- 主线剧情：${params.mainPlot || '（未填写）'}
- 支线剧情：${params.subPlots || '（暂无支线）'}
- 结局方向：${params.ending || '（未填写）'}
- 节奏比例：${params.rhythmSummary || '（未配置）'}

【章节规模】预计总章节数：${params.totalChapters}章

规划要求：
1. 请规划 3-5 个故事弧，每个故事弧都必须服务主线目标，而不是只写局部事件。
2. 每个故事弧都要体现主线推进、冲突升级或收束，不能脱离核心冲突。
3. 支线必须说明在哪个故事弧介入、推进、回收，不能成为独立故事。
4. 最后一个故事弧必须显式收束主线和主要支线。
5. 章节分配要连续、无重叠、无空档。
6. 若涉及主角，必须严格遵守主角命名规则；如果输入里出现旧名字、占位名或互相冲突的人名，统一按该规则处理。
7. 不得脱离已有背景、题材、核心设定另起一版故事。

输出 JSON 数组，且只输出 JSON：[{
  "arc_name": "",
  "stage": "铺垫/升级/高潮/收束",
  "chapter_start": 1,
  "chapter_end": 10,
  "arc_goal": "本弧必须完成的核心推进",
  "key_turns": ["关键转折1", "关键转折2"],
  "subplot_links": ["支线A如何介入/推进/回收"],
  "pacing": "快/中/慢",
  "summary": "本弧概述"
}]`
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  return `你是中文长篇小说分章策划编辑，请为小说《${params.novelTitle}》生成章节大纲。
【题材】${params.genre || '未知题材'}

【主角指代】${params.protagonistReference}
【主角命名规则】${params.protagonistRule}

【小说主线约束】
- 故事核心目标：${params.storyGoal || '（未填写）'}
- 核心冲突：${params.coreConflict || '（未填写）'}
- 主线剧情：${params.mainPlot || '（未填写）'}

【当前故事弧】
- 名称：${params.arcName}
- 目标：${params.arcGoal || '（未填写）'}
- 概述：${params.arcSummary || '（未填写）'}
- 覆盖章节：第${params.chapterStart}章到第${params.chapterEnd}章

【前情与连续性】
- 前情摘要：${params.previousSummary || '（本弧为开篇）'}
- 连续性摘要：${params.continuitySummary || '（暂无历史连续性记录）'}
- 未回收事项：${params.openLoops || '（暂无）'}

【人物与世界】
- 关键人物状态：${params.characterStates || '（暂无）'}
- 世界规则摘要：${params.worldRulesSummary || '（暂无）'}

生成要求：
1. 每章 goal 必须明确对应当前故事弧推进。
2. 每章都要说明如何承接上一章、如何引出下一章。
3. 情节点必须具体，不允许写“推进剧情”“制造冲突”这类空话。
4. 至少让一部分伏笔得到回应，或继续压实其悬念。
5. 合并所有章节后，应能清楚看出主线持续推进，而不是离散片段。
6. 若涉及主角，必须严格遵守主角命名规则；如果输入里出现旧名字、占位名或互相冲突的人名，统一按该规则处理。

输出 JSON 数组，且只输出 JSON：[{
  "chapter_num": ${params.chapterStart},
  "title": "",
  "goal": "本章叙事目标",
  "plot_points": ["情节点1", "情节点2", "情节点3"],
  "characters": ["登场人物A", "登场人物B"],
  "location": "主要场景",
  "emotion_tone": "情绪基调",
  "bridge_in": "如何承接上一章/上一弧",
  "bridge_out": "如何引出下一章"
}]`
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  return `${GLOBAL_WRITING_RULES}

---

【小说】《${params.novelTitle}》第${params.chapterNum}章 ${params.chapterTitle}

【主角指代】${params.protagonistReference}
【主角命名规则】${params.protagonistRule}

【小说核心约束】${params.storyCore || '（未提供）'}

【当前故事弧】${params.currentArc || '（当前章节未绑定故事弧）'}

【当前章节任务】
- 本章目标：${params.chapterGoal || '（未填写）'}
- 情节点：
${params.plotPoints || '（未填写）'}
- 情绪基调：${params.emotionTone || '平稳'}
- 目标字数：${params.targetWords}字左右

【连续性上下文】
- 最近章节摘要：
${params.previousSummaries || '（首章）'}

- 上章结尾：${params.lastChapterEnding || '（首章）'}

- 最近状态记忆：
${params.continuitySummary || '（暂无）'}

- 当前未回收事项：
${params.openLoops || '（暂无）'}

- 本章必须承接：${params.continuityNotes || '（暂无）'}

【人物动态状态】${params.characterStates || '（暂无）'}

【世界规则与限制】${params.worldRules || '（暂无）'}

【文风参考】${params.styleTemplate || '自然、克制、连贯'}

写作要求：
1. 本章必须服务当前故事弧，并推动主线，不允许写成与主线脱节的插曲。
2. 要回应“本章必须承接”和“当前未回收事项”中的至少一部分。
3. 人物行为要符合既有状态变化，不能突然转性、突然遗忘已经发生的事。
4. 若涉及主角，必须严格遵守主角命名规则；如果上文出现旧名字、占位名或互相冲突的人名，统一按该规则处理。
5. 如果本章制造新的悬念，必须与主线或支线任务相关。
6. 直接输出小说正文，不要解释，不要输出 Markdown。`
}

export function buildContinuityStatePrompt(params: ContinuityPromptInput): string {
  return `你是中文长篇小说的连续性编辑，请从章节内容里提炼后续创作需要的结构化记忆。
【小说】《${params.novelTitle}》
【章节】第${params.chapterNum}章 ${params.chapterTitle}

【所属故事弧】${params.arcName || '（未绑定故事弧）'}

【本章目标】${params.chapterGoal || '（未填写）'}

【本章摘要】${params.summary || '（暂无摘要）'}

【本章正文】${params.chapterContent}

提炼要求：
1. plot_progress 只写真正推进主线或支线的事实。
2. character_state_changes 只写后续创作必须记住的人物变化。
3. world_state_changes 只写世界规则、势力、地点或局势变化。
4. open_loops 只保留尚未回收、后续必须回应的伏笔、悬念或承诺。
5. continuity_notes 写下下一章或后续章节不能忘记的承接事项。
6. 每项控制在简洁短句，避免空泛总结。

输出 JSON，且只输出 JSON：{
  "plot_progress": ["推进1", "推进2"],
  "character_state_changes": ["人物变化1", "人物变化2"],
  "world_state_changes": ["世界变化1"],
  "open_loops": ["未回收事项1", "未回收事项2"],
  "continuity_notes": ["下章必须承接1", "下章必须承接2"],
  "arc_progress": "本章对当前故事弧的推进情况"
}`
}
