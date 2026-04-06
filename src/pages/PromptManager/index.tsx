import React, { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Spin, Tag, message } from 'antd'
import { CopyOutlined, EditOutlined } from '@ant-design/icons'
import {
  PROMPT_CATALOG as BASE_PROMPT_CATALOG,
  PROMPT_CATEGORIES,
  buildChapterDraftPrompt,
  buildChapterReviewPrompt,
  buildChapterRewritePrompt,
  buildScenePlanPrompt,
  buildTimelineEventsPrompt,
  regenerateCharacterPrompt,
  type PromptCatalogEntry,
} from '../../shared/prompt-library'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'

function normalizePromptText(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
}

function looksLikePromptSource(text: string): boolean {
  return /renderPrompt\s*\(|sectionLines?\s*\(|PROMPT_CATALOG|=>\s*renderPrompt/.test(text)
}

function sanitizePromptText(text: string, fallback?: string): string {
  const normalized = normalizePromptText(text || '')
  if (!normalized) return normalizePromptText(fallback || '')

  if (fallback && looksLikePromptSource(normalized)) {
    const fallbackText = normalizePromptText(fallback)
    if (!looksLikePromptSource(fallbackText)) return fallbackText
  }

  return normalized
}

function placeholder(key: string): string {
  return `{${key}}`
}

const EXTRA_RUNTIME_PROMPTS: PromptCatalogEntry[] = [
  {
    key: 'regenerateCharacter',
    name: '人物重生',
    description: '在保留角色名和角色定位的前提下，重做人物档案，修复人设空洞和 AI 味。',
    category: '人物系统',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'novelSynopsis', label: '小说背景' },
      { key: 'genre', label: '题材' },
      { key: 'worldSummary', label: '世界规则摘要' },
      { key: 'storyCore', label: '故事核心' },
      { key: 'lockedName', label: '锁定姓名' },
      { key: 'lockedRoleType', label: '锁定角色类型' },
      { key: 'currentProfile', label: '当前档案' },
      { key: 'relatedCharacters', label: '关联人物' },
      { key: 'relationSummary', label: '关系摘要' },
    ],
    template: regenerateCharacterPrompt({
      novelTitle: placeholder('novelTitle'),
      novelSynopsis: placeholder('novelSynopsis'),
      genre: placeholder('genre'),
      worldSummary: placeholder('worldSummary'),
      storyCore: placeholder('storyCore'),
      protagonistRule: placeholder('protagonistRule'),
      lockedName: placeholder('lockedName'),
      lockedRoleType: placeholder('lockedRoleType'),
      currentProfile: placeholder('currentProfile'),
      relatedCharacters: placeholder('relatedCharacters'),
      relationSummary: placeholder('relationSummary'),
      speciesSummary: placeholder('speciesSummary'),
      factionSummary: placeholder('factionSummary'),
      ecologySummary: placeholder('ecologySummary'),
      writingConstraints: placeholder('writingConstraints'),
    }),
  },
  {
    key: 'timelineEvents',
    name: '时间轴事件生成',
    description: '批量生成时间轴事件，明确先后顺序、参与人物、物品和未回收线程。',
    category: '大纲规划',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'genre', label: '题材' },
      { key: 'background', label: '背景补充' },
      { key: 'storyGoal', label: '故事目标' },
      { key: 'coreConflict', label: '核心冲突' },
      { key: 'mainPlot', label: '主线剧情' },
      { key: 'subPlots', label: '支线剧情' },
      { key: 'ending', label: '结局方向' },
      { key: 'worldRulesSummary', label: '世界规则摘要' },
      { key: 'timelineRules', label: '时间制度' },
      { key: 'arcSummary', label: '故事弧' },
      { key: 'characterSummary', label: '人物摘要' },
      { key: 'locationSummary', label: '地点摘要' },
      { key: 'itemSummary', label: '物品摘要' },
      { key: 'existingEvents', label: '已有事件' },
      { key: 'count', label: '数量' },
    ],
    template: buildTimelineEventsPrompt({
      novelTitle: placeholder('novelTitle'),
      genre: placeholder('genre'),
      background: placeholder('background'),
      storyGoal: placeholder('storyGoal'),
      coreConflict: placeholder('coreConflict'),
      mainPlot: placeholder('mainPlot'),
      subPlots: placeholder('subPlots'),
      ending: placeholder('ending'),
      worldRulesSummary: placeholder('worldRulesSummary'),
      timelineRules: placeholder('timelineRules'),
      arcSummary: placeholder('arcSummary'),
      characterSummary: placeholder('characterSummary'),
      locationSummary: placeholder('locationSummary'),
      itemSummary: placeholder('itemSummary'),
      existingEvents: placeholder('existingEvents'),
      count: Number.NaN,
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('count')),
  },
  {
    key: 'scenePlan',
    name: '章节拆场景',
    description: '先拆出场景链和必须覆盖项，再进入正文初稿生成。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'plotPoints', label: '章节大纲' },
      { key: 'emotionTone', label: '情绪基调' },
      { key: 'targetWords', label: '目标字数' },
    ],
    template: buildScenePlanPrompt({
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
      itemSummary: placeholder('itemSummary'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
  {
    key: 'chapterDraft',
    name: '章节初稿',
    description: '按场景计划生成第一版初稿，重点先把信息、动作、承接写清。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'scenePlan', label: '场景计划' },
      { key: 'targetWords', label: '目标字数' },
    ],
    template: buildChapterDraftPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      scenePlan: placeholder('scenePlan'),
      draftContent: '',
      reviewNotes: '',
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
  {
    key: 'chapterReview',
    name: '章节审校',
    description: '自动审校上下文、因果、语言和 AI 味，输出真正可执行的修订建议。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'scenePlan', label: '场景计划' },
      { key: 'draftContent', label: '章节初稿' },
    ],
    template: buildChapterReviewPrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      timelineSummary: placeholder('timelineSummary'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      scenePlan: placeholder('scenePlan'),
      draftContent: placeholder('draftContent'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')),
  },
  {
    key: 'chapterRewrite',
    name: '章节定稿',
    description: '根据审校意见重写成可入库版本，重点修正上下文断裂、常识错配和 AI 味。',
    category: '正文编写',
    params: [
      { key: 'novelTitle', label: '小说标题' },
      { key: 'chapterNum', label: '章节编号' },
      { key: 'chapterTitle', label: '章节标题' },
      { key: 'chapterGoal', label: '本章目标' },
      { key: 'scenePlan', label: '场景计划' },
      { key: 'draftContent', label: '章节初稿' },
      { key: 'reviewNotes', label: '审校意见' },
    ],
    template: buildChapterRewritePrompt({
      novelTitle: placeholder('novelTitle'),
      chapterNum: Number.NaN,
      chapterTitle: placeholder('chapterTitle'),
      chapterGoal: placeholder('chapterGoal'),
      emotionTone: placeholder('emotionTone'),
      targetWords: Number.NaN,
      storyCore: placeholder('storyCore'),
      currentArc: placeholder('currentArc'),
      worldRules: placeholder('worldRules'),
      characterStates: placeholder('characterStates'),
      itemSummary: placeholder('itemSummary'),
      previousSummaries: placeholder('previousSummaries'),
      lastChapterEnding: placeholder('lastChapterEnding'),
      continuitySummary: placeholder('continuitySummary'),
      openLoops: placeholder('openLoops'),
      continuityNotes: placeholder('continuityNotes'),
      timelineSummary: placeholder('timelineSummary'),
      timelineOpenThreads: placeholder('timelineOpenThreads'),
      longTermMemory: placeholder('longTermMemory'),
      consistencyNotes: placeholder('consistencyNotes'),
      scenePlan: placeholder('scenePlan'),
      draftContent: placeholder('draftContent'),
      reviewNotes: placeholder('reviewNotes'),
      protagonistReference: placeholder('protagonistReference'),
      protagonistRule: placeholder('protagonistRule'),
    }).replace('NaN', placeholder('chapterNum')).replace('NaN', placeholder('targetWords')),
  },
]

const PROMPT_CATALOG = [...BASE_PROMPT_CATALOG, ...EXTRA_RUNTIME_PROMPTS]

type PromptLane = '全部' | '初始化' | '世界与资源' | '剧情规划' | '正文生产' | '质量评审'

interface PromptFlowMeta {
  lane: Exclude<PromptLane, '全部'>
  stage: string
  goal: string
  risk: string
}

const PROMPT_LANES: PromptLane[] = ['全部', '初始化', '世界与资源', '剧情规划', '正文生产', '质量评审']

const PROMPT_FLOW_META: Record<string, PromptFlowMeta> = {
  expandBackground: { lane: '初始化', stage: '开篇立项', goal: '把背景、标题和简介定成可继续推进的起稿状态。', risk: '最容易出现世界观漂移和空泛开局。' },
  protagonist: { lane: '世界与资源', stage: '角色底盘', goal: '让主角档案能直接进入后续场景与冲突。', risk: '容易生成功能人、标签化人格和空心弱点。' },
  batchCharacter: { lane: '世界与资源', stage: '角色扩充', goal: '批量补足有剧情用途的角色。', risk: '容易批量同质化、关系松散、功能重复。' },
  regenerateCharacter: { lane: '世界与资源', stage: '角色修复', goal: '在不换角色槽位的前提下修掉人设空洞和 AI 味。', risk: '容易改得更华丽，却没有更好用。' },
  characterRelations: { lane: '世界与资源', stage: '关系张力', goal: '整理能真正影响场景的关系网。', risk: '容易写成标签罗列，而不是关系压力。' },
  mapGeneration: { lane: '世界与资源', stage: '地点骨架', goal: '生成可承载行动路线和剧情压力的地点结构。', risk: '容易只产出好看的地名，缺乏剧情功能。' },
  storyArcs: { lane: '剧情规划', stage: '故事弧', goal: '把主线和支线拆成连续可生产的故事弧。', risk: '容易只有宏观概念，没有章节级推进。' },
  chapterOutline: { lane: '剧情规划', stage: '章节细纲', goal: '把故事弧拆成可写的逐章推进。', risk: '容易只有结构名词，缺乏读者感受和因果链。' },
  timelineEvents: { lane: '剧情规划', stage: '时序管理', goal: '给全书补齐时间锚点和事件因果。', risk: '容易沦为资料表，不服务章节承接。' },
  scenePlan: { lane: '正文生产', stage: '场景计划', goal: '把章节拆成 AI 可施工的场景链。', risk: '容易写成策划摘要，而不是正文施工单。' },
  chapterDraft: { lane: '正文生产', stage: '初稿生成', goal: '先写出一版可审校的完整初稿。', risk: '容易把修辞放前面，导致事件链和代价链不清。' },
  chapterWriting: { lane: '正文生产', stage: '成稿直写', goal: '直接输出可读性较高的章节正文。', risk: '容易出现提示词味、说明腔和模板化衔接。' },
  chapterSummary: { lane: '正文生产', stage: '章节沉淀', goal: '把本章事实压缩成后续可调用的摘要。', risk: '容易夹带赏析口吻或抽象总结。' },
  continuityState: { lane: '正文生产', stage: '连续性提炼', goal: '提炼后文必须记住的硬事实。', risk: '容易把猜测和情绪误记成事实。' },
  chapterReview: { lane: '质量评审', stage: '自动审校', goal: '找出真正影响成稿质量和阅读体验的问题。', risk: '容易给空话建议，不给可执行修法。' },
  chapterRewrite: { lane: '正文生产', stage: '定稿重写', goal: '把初稿按审校意见压成可入稿版本。', risk: '容易只修句子，不修承接、代价和读者张力。' },
  aiCheck: { lane: '质量评审', stage: 'AI 体检', goal: '检测 AI 痕迹、搭配错误和出戏点。', risk: '容易只抓表面模板句，漏掉更深层的不自然。' },
  rewriteParagraph: { lane: '质量评审', stage: '段落修复', goal: '保留事件信息，修掉人机味和生硬表达。', risk: '容易改出另一个意思或削弱上下文承接。' },
  contentScoring: { lane: '质量评审', stage: '编辑评分', goal: '从编辑和普通读者双视角给出改稿优先级。', risk: '如果维度太粗，会掩盖连贯性和追读欲问题。' },
  genericExpand: { lane: '剧情规划', stage: '资产扩写', goal: '把已有想法扩成可继续使用的创作资产。', risk: '容易越写越散，脱离当前项目边界。' },
  subplotExpand: { lane: '剧情规划', stage: '支线修整', goal: '让支线真正回推主线、关系或主题。', risk: '容易写成独立番外，无法反哺主线。' },
}

const SERVICE_GUARDRAIL_KEYS = new Set([
  'expandBackground',
  'protagonist',
  'batchCharacter',
  'regenerateCharacter',
  'mapGeneration',
  'storyArcs',
  'chapterOutline',
  'timelineEvents',
  'scenePlan',
  'chapterDraft',
  'chapterWriting',
  'chapterReview',
  'chapterRewrite',
  'aiCheck',
  'genericExpand',
  'contentScoring',
])

function getPromptLayers(key: string, template: string): string[] {
  const layers = ['基础模板']
  const hasSharedChineseBase = template.includes('【上下文护栏】')
    || template.includes('【真实度护栏】')
    || template.includes('【输出质量底线】')
    || template.includes('你现在写的是可直接入稿的中文小说正文')

  if (hasSharedChineseBase) {
    layers.push('公共中文底板')
  }

  if (SERVICE_GUARDRAIL_KEYS.has(key)) {
    layers.push('服务层追加护栏')
  }

  return layers
}

function getPromptFlowMeta(prompt: PromptCatalogEntry): PromptFlowMeta {
  const byKey = PROMPT_FLOW_META[prompt.key]
  if (byKey) return byKey

  if (prompt.category === '创作初始化') {
    return { lane: '初始化', stage: '基础链路', goal: '为后续提示词提供稳定起点。', risk: '输入范围不稳时容易整体漂移。' }
  }
  if (prompt.category === '人物系统' || prompt.category === '世界构建') {
    return { lane: '世界与资源', stage: '设定资产', goal: '补齐后续写作要反复调用的设定资源。', risk: '容易只产出资料，缺乏剧情用途。' }
  }
  if (prompt.category === '大纲规划') {
    return { lane: '剧情规划', stage: '结构规划', goal: '把长篇推进拆成可执行链路。', risk: '容易概括化，缺乏章节可执行性。' }
  }
  if (prompt.category === '正文编写') {
    return { lane: '正文生产', stage: '正文链路', goal: '直接服务章节生产和定稿。', risk: '最容易暴露 AI 腔和承接错误。' }
  }
  return { lane: '质量评审', stage: '补充链路', goal: '补足运行时校验与修复。', risk: '容易只给结论，不给修法。' }
}

export default function PromptManager() {
  const [activeCategory, setActiveCategory] = useState('全部')
  const [activeLane, setActiveLane] = useState<PromptLane>('全部')
  const [searchText, setSearchText] = useState('')
  const [selectedPromptKey, setSelectedPromptKey] = useState<string>('')
  const [editingTemplate, setEditingTemplate] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customOverrides, setCustomOverrides] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await window.electron.prompt.list()
        if (!alive) return
        setCustomOverrides(Object.fromEntries(rows.map((row) => [row.key, normalizePromptText(row.content)])))
      } catch (error) {
        if (alive) {
          message.error(getErrorMessage(error, 'prompt.loadFailed'))
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const promptRows = useMemo(() => {
    return PROMPT_CATALOG.map((prompt) => {
      const meta = getPromptFlowMeta(prompt)
      const hasOverride = Boolean(customOverrides[prompt.key])
      const currentTemplate = sanitizePromptText(customOverrides[prompt.key] || prompt.template, prompt.template)
      const layers = getPromptLayers(prompt.key, currentTemplate)
      return {
        prompt,
        meta,
        hasOverride,
        currentTemplate,
        layers,
      }
    })
  }, [customOverrides])

  const filteredPrompts = useMemo(() => {
    return promptRows.filter(({ prompt, meta }) => {
      if (activeCategory !== '全部' && prompt.category !== activeCategory) return false
      if (activeLane !== '全部' && meta.lane !== activeLane) return false
      if (!searchText) return true
      return prompt.name.includes(searchText) || prompt.description.includes(searchText) || prompt.key.includes(searchText) || meta.stage.includes(searchText)
    })
  }, [activeCategory, activeLane, promptRows, searchText])

  useEffect(() => {
    if (filteredPrompts.length === 0) {
      setSelectedPromptKey('')
      return
    }

    if (!filteredPrompts.some(({ prompt }) => prompt.key === selectedPromptKey)) {
      setSelectedPromptKey(filteredPrompts[0].prompt.key)
    }
  }, [filteredPrompts, selectedPromptKey])

  const selectedPromptRow = useMemo(
    () => filteredPrompts.find(({ prompt }) => prompt.key === selectedPromptKey) || filteredPrompts[0] || null,
    [filteredPrompts, selectedPromptKey],
  )

  const overrideCount = useMemo(() => Object.keys(customOverrides).length, [customOverrides])
  const qualityPromptCount = useMemo(() => promptRows.filter(({ meta }) => meta.lane === '质量评审').length, [promptRows])
  const chineseBaseCount = useMemo(
    () => promptRows.filter(({ layers }) => layers.includes('公共中文底板')).length,
    [promptRows],
  )

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(sanitizePromptText(text)).then(() => message.success(getUserFacingMessage('common.copied')))
  }

  const handleEditSave = async () => {
    if (!selectedPromptRow) return
    const normalized = normalizePromptText(editingTemplate)
    await window.electron.prompt.save(selectedPromptRow.prompt.key, normalized)
    setCustomOverrides((prev) => ({ ...prev, [selectedPromptRow.prompt.key]: normalized }))
    setEditModalOpen(false)
    message.success(getUserFacingMessage('prompt.runtimeSaved'))
  }

  const handleResetOverride = async (key: string) => {
    await window.electron.prompt.delete(key)
    setCustomOverrides((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    message.success(getUserFacingMessage('prompt.resetDefault'))
  }

  if (loading) {
    return (
      <div style={{ padding: 24, height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin />
      </div>
    )
  }

  return (
    <WorkspacePage
      className="prompt-manager-page"
      layout="wide"
      eyebrow="运行时控制台"
      title="提示词控制台"
      description="这里维护的是直接作用到生成链路的运行时提示词。左侧按生产阶段筛选，右侧检查当前模板、中文底板接入情况和服务层追加护栏。"
      heroVariant="compact"
      actions={(
        <Input.Search
          placeholder="搜索提示词、阶段或 key"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          style={{ width: 320, maxWidth: '100%' }}
          allowClear
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="总提示词" value={promptRows.length} tone="warm" hint="基础模板 + 运行时链路" />
          <WorkspaceMetric label="运行时覆盖" value={overrideCount} hint={overrideCount > 0 ? '这些模板已被本地覆盖并实时生效' : '当前全部使用默认模板'} />
          <WorkspaceMetric label="中文底板接入" value={chineseBaseCount} tone="cool" hint="已接入自然中文、真实度和输出质量公共护栏的模板数" />
          <WorkspaceMetric label="质量评审链路" value={qualityPromptCount} tone="cool" hint="负责 AI 痕迹、读者感受和修订反馈" />
        </>
      )}
    >
      <div className="prompt-manager-shell">
        <WorkspacePanel
          className="prompt-manager-catalog"
          title="链路目录"
          description="先按生产阶段筛，再进具体模板。目录中的覆盖标记表示这条 prompt 已被本地改写。"
          extra={(
            <div className="prompt-manager-filter-group">
              {PROMPT_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`prompt-manager-filter ${activeCategory === category ? 'prompt-manager-filter--active' : ''}`}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          )}
        >
          <div className="prompt-manager-lanes">
            {PROMPT_LANES.map((lane) => (
              <button
                key={lane}
                type="button"
                className={`prompt-manager-lane ${activeLane === lane ? 'prompt-manager-lane--active' : ''}`}
                onClick={() => setActiveLane(lane)}
              >
                {lane}
              </button>
            ))}
          </div>

          <div className="prompt-manager-card-grid">
            {filteredPrompts.map(({ prompt, meta, hasOverride, currentTemplate }) => (
              <button
                key={prompt.key}
                type="button"
                className={`prompt-manager-card ${selectedPromptRow?.prompt.key === prompt.key ? 'prompt-manager-card--active' : ''}`}
                onClick={() => setSelectedPromptKey(prompt.key)}
              >
                <div className="prompt-manager-card__head">
                  <div className="prompt-manager-card__title-block">
                    <strong>{prompt.name}</strong>
                    <span>{prompt.description}</span>
                  </div>
                  {hasOverride ? <Tag color="blue">覆盖中</Tag> : <Tag>默认</Tag>}
                </div>

                <div className="prompt-manager-card__meta">
                  <Tag color="gold">{meta.lane}</Tag>
                  <Tag color="processing">{meta.stage}</Tag>
                  <Tag>{prompt.category}</Tag>
                  <Tag>{`${prompt.params.length} 个参数`}</Tag>
                </div>

                <div className="prompt-manager-card__goal">{meta.goal}</div>
                <div className="prompt-manager-card__risk">{`风险点：${meta.risk}`}</div>
                <div className="prompt-manager-card__preview">{currentTemplate}</div>
              </button>
            ))}
          </div>
        </WorkspacePanel>

        <div className="prompt-manager-inspector">
          <WorkspacePanel
            className="prompt-manager-inspector-panel"
            title={selectedPromptRow ? selectedPromptRow.prompt.name : '未选择提示词'}
            description={selectedPromptRow ? selectedPromptRow.meta.goal : '从左侧选择一条提示词后，这里会显示它的运行时模板、风险和参数。'}
            extra={selectedPromptRow ? (
              <div className="prompt-manager-inspector-actions">
                <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(selectedPromptRow.currentTemplate)}>复制</Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditingTemplate(selectedPromptRow.currentTemplate)
                    setEditModalOpen(true)
                  }}
                >
                  编辑
                </Button>
                {selectedPromptRow.hasOverride ? (
                  <Button size="small" onClick={() => void handleResetOverride(selectedPromptRow.prompt.key)}>恢复默认</Button>
                ) : null}
              </div>
            ) : null}
          >
            {selectedPromptRow ? (
              <div className="prompt-manager-inspector-body">
                <div className="prompt-manager-inspector-meta">
                  <div className="prompt-manager-inspector-meta__item">
                    <span>生产阶段</span>
                    <strong>{selectedPromptRow.meta.lane} · {selectedPromptRow.meta.stage}</strong>
                  </div>
                  <div className="prompt-manager-inspector-meta__item">
                    <span>运行状态</span>
                    <strong>{selectedPromptRow.hasOverride ? '本地覆盖生效中' : '默认模板生效中'}</strong>
                  </div>
                </div>

                <div className="prompt-manager-callout">
                  <strong>运行时说明</strong>
                  <span>这里展示的是当前运行中的模板。真正生效的链路通常由三层组成：基础模板、公共中文底板，以及 Electron 服务层追加的生产护栏。</span>
                </div>

                <div className="prompt-manager-inspector-section">
                  <div className="prompt-manager-inspector-section__title">风险点</div>
                  <div className="prompt-manager-inspector-section__copy">{selectedPromptRow.meta.risk}</div>
                </div>

                <div className="prompt-manager-inspector-section">
                  <div className="prompt-manager-inspector-section__title">组成层</div>
                  <div className="prompt-manager-param-list">
                    {selectedPromptRow.layers.map((layer) => (
                      <Tag key={layer} style={{ fontSize: 11 }}>
                        {layer}
                      </Tag>
                    ))}
                  </div>
                </div>

                <div className="prompt-manager-inspector-section">
                  <div className="prompt-manager-inspector-section__title">输入参数</div>
                  <div className="prompt-manager-param-list">
                    {selectedPromptRow.prompt.params.map((param) => (
                      <Tag key={param.key} style={{ fontSize: 11 }}>
                        {param.key} · {param.label}
                      </Tag>
                    ))}
                  </div>
                </div>

                <div className="prompt-manager-inspector-section">
                  <div className="prompt-manager-inspector-section__title">当前模板</div>
                  <div className="prompt-manager-template-preview">{selectedPromptRow.currentTemplate}</div>
                </div>
              </div>
            ) : (
              <div className="novel-empty">当前筛选下没有可显示的提示词。</div>
            )}
          </WorkspacePanel>
        </div>
      </div>

      <Modal
        title={`编辑运行时提示词：${selectedPromptRow?.prompt.name || ''}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={() => void handleEditSave()}
        okText="保存并生效"
        width={880}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          保存后会直接影响后端运行时 prompt。使用 `{`参数名`}` 可以引用上下文字段。
        </div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedPromptRow?.prompt.params.map((param) => (
            <Tag
              key={param.key}
              style={{ fontSize: 11, cursor: 'pointer', color: 'var(--color-blue-light)' }}
              onClick={() => setEditingTemplate((prev) => `${prev}{${param.key}}`)}
            >
              + {`{${param.key}}`}
            </Tag>
          ))}
        </div>
        <Input.TextArea
          value={editingTemplate}
          onChange={(e) => setEditingTemplate(e.target.value)}
          rows={20}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </WorkspacePage>
  )
}
