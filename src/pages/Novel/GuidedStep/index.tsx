import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Space,
  Tag,
  message,
} from 'antd'
import {
  ArrowRightOutlined,
  BarsOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  SaveOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { useNovelStore } from '../../../stores/novel.store'
import { useWorkspaceStore } from '../../../stores/workspace.store'
import {
  getCharacterBatchPreset,
  getItemGenerationProfile,
} from '../../../shared/creation-tools'
import {
  getFactionNameOptions,
  getSpeciesNameOptions,
  parseWorldRulesJson,
  stringifyWorldRules,
} from '../../../shared/genre-system'
import {
  buildStoryAnchorPrompt,
  type StoryAnchorField,
} from '../../../shared/prompt-library'
import {
  EMPTY_WORKFLOW_STATS,
  countMapNodes,
  getGuidedStepProgressMap,
  isBasicsReady,
  isCharacterRosterReady,
  isItemsEquipmentReady,
  isMapStructureReady,
  isStoryCoreReady,
  isStoryPlotReady,
  isWorldFoundationReady,
  parseStorySettings,
  type GuidedWorkflowStepKey,
  type WorkflowStats,
} from '../workflow'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
  stepKey: GuidedWorkflowStepKey
}

interface BasicsFormValues {
  title: string
  synopsis: string
  userBackground: string
  expandedBackground: string
  targetWords: number
}

interface StorySettingsFormValues {
  story_goal: string
  core_conflict: string
  main_plot: string
  ending: string
}

type ActionKey =
  | 'save-basics'
  | 'save-story-settings'
  | 'sync-world-rules'
  | 'generate-map'
  | 'generate-characters'
  | 'generate-items'
  | 'generate-outline'
  | 'generate-timeline'
  | 'create-chapter'

interface StoryFieldMeta {
  key: StoryAnchorField
  label: string
  question: string
  placeholder: string
  step: 'story-core' | 'story-plot'
}

const STEP_META: Record<GuidedWorkflowStepKey, { eyebrow: string; title: string; description: string }> = {
  basics: {
    eyebrow: '第 1 步 / 8',
    title: '先把开局底盘说清楚',
    description: '这一页只保留书名、简介和背景，不把别的功能挤进来。',
  },
  'story-core': {
    eyebrow: '第 2 步 / 8',
    title: '先定目标和冲突',
    description: '只回答故事想走到哪里，以及为什么这么难。',
  },
  'story-plot': {
    eyebrow: '第 3 步 / 8',
    title: '再补主线和结局',
    description: '目标和冲突稳定后，再把推进链和收束方式写清。',
  },
  'world-foundation': {
    eyebrow: '第 4 步 / 8',
    title: '统一世界规则',
    description: '这一页只做世界基线，不展开地图细节。',
  },
  'map-structure': {
    eyebrow: '第 5 步 / 8',
    title: '只生成地点骨架',
    description: '先给故事放上能承接事件的地点层级。',
  },
  'character-roster': {
    eyebrow: '第 6 步 / 8',
    title: '先补主角和关键角色',
    description: '只补会推动主线的人，不一次塞满人物库。',
  },
  'items-equipment': {
    eyebrow: '第 7 步 / 8',
    title: '只补关键物品和装备',
    description: '先生成真正会进入剧情链条的物件。',
  },
  'write-start': {
    eyebrow: '第 8 步 / 8',
    title: '准备进入正文写作',
    description: '先把大纲、时间轴和首章入口补齐，再进入正文页。',
  },
}

const STORY_FIELDS: StoryFieldMeta[] = [
  {
    key: 'story_goal',
    label: '故事目标',
    question: '最后到底要抵达什么结果？',
    placeholder: '写最后要完成什么，不写中途手段。',
    step: 'story-core',
  },
  {
    key: 'core_conflict',
    label: '核心冲突',
    question: '这件事为什么很难做到？',
    placeholder: '写阻碍、代价和对立面，不要写成口号。',
    step: 'story-core',
  },
  {
    key: 'main_plot',
    label: '主线推进',
    question: '故事会靠哪条因果链一路推进？',
    placeholder: '写起点、升级、转折和逼近收束的推进链。',
    step: 'story-plot',
  },
  {
    key: 'ending',
    label: '结局落点',
    question: '主要矛盾最后怎样落地？',
    placeholder: '写最终状态与余波，不再另开一条新主线。',
    step: 'story-plot',
  },
]

const PRO_PAGE_BY_STEP: Record<GuidedWorkflowStepKey, string> = {
  basics: 'overview',
  'story-core': 'core-settings',
  'story-plot': 'core-settings',
  'world-foundation': 'world-rules',
  'map-structure': 'map',
  'character-roster': 'characters',
  'items-equipment': 'items',
  'write-start': 'writing',
}

function safeParseSettings(raw?: string): Record<string, unknown> {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function statusTag(done: boolean, doneText = '已完成', pendingText = '待完成') {
  return <Tag color={done ? 'success' : 'default'}>{done ? doneText : pendingText}</Tag>
}

function buildStoryFieldRelatedContext(values: StorySettingsFormValues, field: StoryAnchorField): string {
  const lines = [
    field !== 'story_goal' && values.story_goal ? `故事目标：${values.story_goal}` : '',
    field !== 'core_conflict' && values.core_conflict ? `核心冲突：${values.core_conflict}` : '',
    field !== 'main_plot' && values.main_plot ? `主线推进：${values.main_plot}` : '',
    field !== 'ending' && values.ending ? `结局落点：${values.ending}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function ChecklistGrid({
  items,
}: {
  items: Array<{ title: string; detail: string; done: boolean }>
}) {
  return (
    <div className="guided-step__checklist">
      {items.map((item) => (
        <div key={item.title} className={`guided-step__checkitem ${item.done ? 'guided-step__checkitem--done' : ''}`}>
          <div className="guided-step__checkhead">
            <strong>{item.title}</strong>
            {statusTag(item.done)}
          </div>
          <p>{item.detail}</p>
        </div>
      ))}
    </div>
  )
}

function FactGrid({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode; hint?: React.ReactNode; done?: boolean }>
}) {
  return (
    <div className="guided-step__fact-grid">
      {items.map((item) => (
        <div key={item.label} className={`guided-step__fact-card ${item.done ? 'guided-step__fact-card--done' : ''}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.hint ? <small>{item.hint}</small> : null}
        </div>
      ))}
    </div>
  )
}

function ActionCard({
  title,
  detail,
  status,
  done = false,
  meta,
  actions,
}: {
  title: string
  detail: string
  status: string
  done?: boolean
  meta?: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className={`guided-step__action-card ${done ? 'guided-step__action-card--done' : ''}`}>
      <div className="guided-step__action-head">
        <div className="guided-step__action-copy">
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        {statusTag(done, '已就绪', status)}
      </div>
      {meta ? <div className="guided-step__action-meta">{meta}</div> : null}
      <div className="guided-step__action-foot">{actions}</div>
    </div>
  )
}

export default function GuidedWorkspaceStep({ novelId, stepKey }: Props) {  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { setMode } = useWorkspaceStore()
  const [basicsForm] = Form.useForm<BasicsFormValues>()
  const [storyForm] = Form.useForm<StorySettingsFormValues>()
  const liveBasics = Form.useWatch([], basicsForm) as Partial<BasicsFormValues> | undefined
  const liveStory = Form.useWatch([], storyForm) as Partial<StorySettingsFormValues> | undefined
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [runningAction, setRunningAction] = useState<ActionKey | null>(null)

  const stepMeta = STEP_META[stepKey]
  const settingsSnapshot = useMemo(() => parseStorySettings(currentNovel?.settingsJson), [currentNovel?.settingsJson])
  const settingsObject = useMemo(() => safeParseSettings(currentNovel?.settingsJson), [currentNovel?.settingsJson])
  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const speciesOptions = useMemo(() => getSpeciesNameOptions(worldRules), [worldRules])
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const characterPreset = useMemo(
    () => getCharacterBatchPreset(currentNovel?.genreName, speciesOptions),
    [currentNovel?.genreName, speciesOptions],
  )
  const itemProfile = useMemo(
    () => getItemGenerationProfile(currentNovel?.genreName),
    [currentNovel?.genreName],
  )
  const progressMap = useMemo(
    () => getGuidedStepProgressMap(currentNovel, stats),
    [currentNovel, stats],
  )
  const stepProgress = progressMap[stepKey]
  const basicsReady = isBasicsReady(currentNovel)
  const storyCoreReady = isStoryCoreReady(currentNovel)
  const storyPlotReady = isStoryPlotReady(currentNovel)
  const worldFoundationReady = isWorldFoundationReady(currentNovel)
  const mapReady = isMapStructureReady(stats)
  const characterReady = isCharacterRosterReady(stats)
  const itemsReady = isItemsEquipmentReady(stats)
  const protagonistReference = '主角'
  const protagonistRule = '若涉及主角，统一沿用“主角”或现有唯一称呼，不要擅自改名。'

  const refreshNovel = useCallback(async () => {
    const novel = await window.electron.novel.get(novelId)
    if (novel) setCurrentNovel(novel)
    return novel
  }, [novelId, setCurrentNovel])

  const refreshStats = useCallback(async () => {
    const [baseStats, characters, items, arcs, events, mapTree] = await Promise.all([
      window.electron.novel.stats(novelId),
      window.electron.character.list(novelId),
      window.electron.item.list(novelId),
      window.electron.outline.getArcs(novelId),
      window.electron.timeline.list(novelId),
      window.electron.map.getTree(novelId),
    ])

    setStats({
      mapCount: countMapNodes(mapTree),
      characterCount: characters.length,
      itemCount: items.length,
      outlineCount: arcs.length,
      timelineCount: events.length,
      chapterCount: baseStats.totalChapters,
      completedChapterCount: baseStats.completedChapters,
      totalWords: baseStats.totalWords,
      hasProtagonist: characters.some((item) => item.roleType === 'protagonist'),
    })
  }, [novelId])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNovel(), refreshStats()])
  }, [refreshNovel, refreshStats])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  useEffect(() => {
    basicsForm.setFieldsValue({
      title: currentNovel?.title || '',
      synopsis: currentNovel?.synopsis || '',
      userBackground: currentNovel?.userBackground || '',
      expandedBackground: currentNovel?.expandedBackground || '',
      targetWords: currentNovel?.targetWords || 200000,
    })
  }, [basicsForm, currentNovel])

  useEffect(() => {
    storyForm.setFieldsValue({
      story_goal: settingsSnapshot.storyGoal,
      core_conflict: settingsSnapshot.coreConflict,
      main_plot: settingsSnapshot.mainPlot,
      ending: settingsSnapshot.ending,
    })
  }, [settingsSnapshot, storyForm])

  const runAction = useCallback(async (
    key: ActionKey,
    action: () => Promise<void>,
    successText: string,
  ) => {
    setRunningAction(key)
    try {
      await action()
      await refreshAll()
      message.success(successText)
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '执行失败，请稍后重试。')
    } finally {
      setRunningAction(null)
    }
  }, [refreshAll])

  const openProPage = useCallback((pageKey = PRO_PAGE_BY_STEP[stepKey]) => {
    setMode('pro')
    navigate(`/novels/${novelId}/${pageKey}`)
  }, [navigate, novelId, setMode, stepKey])

  const handleSaveBasics = useCallback(async () => {
    const values = await basicsForm.validateFields()
    setRunningAction('save-basics')

    try {
      await window.electron.novel.update(novelId, {
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        userBackground: values.userBackground.trim(),
        expandedBackground: values.expandedBackground.trim(),
        targetWords: values.targetWords || currentNovel?.targetWords || 200000,
      })
      await refreshAll()
      message.success('基础信息已保存。')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '基础信息保存失败。')
    } finally {
      setRunningAction(null)
    }
  }, [basicsForm, currentNovel?.targetWords, novelId, refreshAll])

  const handleSaveStorySettings = useCallback(async () => {
    const values = storyForm.getFieldsValue()
    setRunningAction('save-story-settings')

    try {
      const nextSettings = {
        ...settingsObject,
        story_goal: readText(values.story_goal),
        core_conflict: readText(values.core_conflict),
        main_plot: readText(values.main_plot),
        ending: readText(values.ending),
      }

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(nextSettings),
      })
      await refreshAll()
      message.success('故事设定已保存。')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '故事设定保存失败。')
    } finally {
      setRunningAction(null)
    }
  }, [novelId, refreshAll, settingsObject, storyForm])

  const syncWorldRulesCore = useCallback(async () => {
    const normalized = parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName)
    await window.electron.novel.update(novelId, {
      worldRulesJson: stringifyWorldRules(normalized),
    })
  }, [currentNovel?.genreName, currentNovel?.worldRulesJson, novelId])

  const generateMapCore = useCallback(async () => {
    const normalizedRules = parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName)
    const layerCounts = [...normalizedRules.mapBlueprint.levels]
      .sort((left, right) => left.depth - right.depth)
      .map((level) => level.suggestedCount)

    await window.electron.map.batchGenerate(novelId, {
      layerCounts,
      parentBatchSize: 1,
    })
  }, [currentNovel?.genreName, currentNovel?.worldRulesJson, novelId])

  const generateCharactersCore = useCallback(async () => {
    if (!stats.hasProtagonist) {
      await window.electron.character.generateProtagonist(novelId, {})
    }

    await window.electron.character.batchGenerate(novelId, {
      majorCount: characterPreset.majorCount,
      minorCount: characterPreset.minorCount,
      antagonistCount: characterPreset.antagonistCount,
      supportingCount: characterPreset.supportingCount,
      genderRatio: characterPreset.genderRatio,
      preferredSpecies: characterPreset.preferredSpecies,
      factionBias: factionOptions.slice(0, 3),
      helperRoles: characterPreset.helperRoles,
      specialRequirements: '人物必须承接题材、主线、地图和势力关系，不要只补数量。',
      batchSize: 6,
    })
  }, [characterPreset, factionOptions, novelId, stats.hasProtagonist])

  const generateItemsCore = useCallback(async () => {
    await window.electron.item.generate(novelId, {
      count: itemProfile.defaultBatch,
      templateOnly: false,
      refreshTemplates: true,
      batchSize: 4,
      focus: '先补真正会进入冲突、交易、转折和回收链的关键物品。',
    })
  }, [itemProfile.defaultBatch, novelId])

  const generateOutlineCore = useCallback(async () => {
    await window.electron.outline.generateArcs(novelId)
  }, [novelId])

  const generateTimelineCore = useCallback(async () => {
    await window.electron.timeline.generate(novelId, {
      count: 12,
      batchSize: 4,
      focus: '按主角、关键地点、关键物品和主冲突的先后关系生成事件，不要发散。',
    })
  }, [novelId])

  const createFirstChapterCore = useCallback(async () => {
    const nextNum = stats.chapterCount > 0 ? stats.chapterCount + 1 : 1
    await window.electron.chapter.create(novelId, {
      chapterNum: nextNum,
      title: `第${nextNum}章`,
      status: 'outline',
    })
  }, [novelId, stats.chapterCount])

  const handleCreateFirstChapter = useCallback(async () => {
    setRunningAction('create-chapter')

    try {
      await createFirstChapterCore()
      await refreshAll()
      message.success('首章已创建，正在进入正文页。')
      openProPage('writing')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '创建章节失败。')
    } finally {
      setRunningAction(null)
    }
  }, [createFirstChapterCore, openProPage, refreshAll])

  const storyDraft: StorySettingsFormValues = {
    story_goal: readText(liveStory?.story_goal ?? settingsSnapshot.storyGoal),
    core_conflict: readText(liveStory?.core_conflict ?? settingsSnapshot.coreConflict),
    main_plot: readText(liveStory?.main_plot ?? settingsSnapshot.mainPlot),
    ending: readText(liveStory?.ending ?? settingsSnapshot.ending),
  }
  const basicsDraft = {
    title: readText(liveBasics?.title ?? currentNovel?.title),
    synopsis: readText(liveBasics?.synopsis ?? currentNovel?.synopsis),
    userBackground: readText(liveBasics?.userBackground ?? currentNovel?.userBackground),
    expandedBackground: readText(liveBasics?.expandedBackground ?? currentNovel?.expandedBackground),
  }
  const storyRelatedContext = (field: StoryAnchorField) => buildStoryFieldRelatedContext(storyDraft, field)
  const commonContext = (
    <WorkspaceContextSummary
      items={[
        { label: '题材', value: currentNovel?.genreName || '未设定' },
        { label: '当前进度', value: `${stepProgress.completedCount}/${stepProgress.totalCount}` },
        { label: '目标字数', value: `${currentNovel?.targetWords || 0} 字` },
      ]}
    />
  )
  if (stepKey === 'basics') {
    return (
      <WorkspacePage
        className="guided-step guided-step--basics"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={runningAction === 'save-basics'}
              onClick={() => void handleSaveBasics()}
            >
              保存这一页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('overview')}>
              打开详细编辑
            </Button>
          </Space>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${stepProgress.completedCount}/${stepProgress.totalCount}`} tone="warm" hint="书名、简介、原始背景、扩展背景" />
            <WorkspaceMetric label="目标字数" value={currentNovel?.targetWords || 200000} hint="这里只保留一个目标值，详细拆分放到后面。" />
          </>
        )}
        contextSummary={commonContext}
      >
        <WorkspacePanel title="本步只填四项半" description="先把底盘写稳，后面所有 AI 才有统一上下文。">
          <Form form={basicsForm} layout="vertical">
            <div className="guided-step__field-grid guided-step__field-grid--basics">
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="title" label="书名" rules={[{ required: true, message: '请填写书名' }]}>
                  <Input placeholder="例如：霜港回声" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="targetWords" label="目标字数">
                  <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="synopsis" label="一句话简介" rules={[{ required: true, message: '请填写简介' }]}>
                  <Input.TextArea rows={3} placeholder="先写主角处境、目标和硬冲突。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                  <Input.TextArea rows={6} placeholder="把你脑海里最初的故事处境、氛围和困局写下来。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                  <Input.TextArea rows={6} placeholder="把世界底色、人物起点和第一轮冲突补完整。" />
                </Form.Item>
              </div>
            </div>
          </Form>
        </WorkspacePanel>

        <WorkspacePanel title="通过标准">
          <ChecklistGrid
            items={[
              { title: '书名和简介', detail: '让读者一眼看懂题材、人物处境和核心钩子。', done: Boolean(basicsDraft.title) && Boolean(basicsDraft.synopsis) },
              { title: '原始背景', detail: '保留你最初的故事直觉，不要先写成百科。', done: Boolean(basicsDraft.userBackground) },
              { title: '扩展背景', detail: '把后续世界、角色和主线要继承的底盘补齐。', done: Boolean(basicsDraft.expandedBackground) },
            ]}
          />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'story-core' || stepKey === 'story-plot') {
    const fields = STORY_FIELDS.filter((field) => field.step === stepKey)
    const inheritFacts = stepKey === 'story-core'
      ? [
          { label: '基础信息', value: basicsReady ? '已就绪' : '待补齐', hint: basicsReady ? '可以直接压故事核心。' : '建议先回上一步补完整。', done: basicsReady },
          { label: '当前完成度', value: `${stepProgress.completedCount}/${stepProgress.totalCount}`, hint: '这一页只看两个字段。', done: stepProgress.isComplete },
        ]
      : [
          { label: '故事目标', value: storyDraft.story_goal || '未填写', hint: '主线必须承接这里。', done: Boolean(storyDraft.story_goal) },
          { label: '核心冲突', value: storyDraft.core_conflict || '未填写', hint: '结局必须回应这里。', done: Boolean(storyDraft.core_conflict) },
        ]

    return (
      <WorkspacePage
        className={`guided-step guided-step--${stepKey}`}
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={runningAction === 'save-story-settings'}
              onClick={() => void handleSaveStorySettings()}
            >
              保存这一页
            </Button>
            <Button icon={<SettingOutlined />} onClick={() => openProPage('core-settings')}>
              打开详细编辑
            </Button>
          </Space>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${stepProgress.completedCount}/${stepProgress.totalCount}`} tone="warm" hint={stepKey === 'story-core' ? '目标、冲突' : '主线、结局'} />
            <WorkspaceMetric label="前置状态" value={stepKey === 'story-core' ? (basicsReady ? '已就绪' : '待补齐') : (storyCoreReady ? '已就绪' : '待补齐')} hint={stepKey === 'story-core' ? '建议先完成基础信息。' : '建议先完成目标和冲突。'} />
          </>
        )}
        contextSummary={commonContext}
      >
        {stepKey === 'story-core' && !basicsReady ? (
          <Alert type="warning" showIcon message="基础信息还没补齐时，AI 很容易跑偏。建议先回上一步。" />
        ) : null}
        {stepKey === 'story-plot' && !storyCoreReady ? (
          <Alert type="warning" showIcon message="请先把故事目标和核心冲突定稳，再补主线和结局。" />
        ) : null}

        <WorkspacePanel title={stepKey === 'story-core' ? '这一页只回答两个问题' : '这一页只补推进链和结局'}>
          <Form form={storyForm} layout="vertical">
            <div className="guided-step__field-grid">
              {fields.map((field) => (
                <div key={field.key} className="guided-step__field-card">
                  <div className="guided-step__field-head">
                    <div>
                      <div className="guided-step__field-title">{field.label}</div>
                      <div className="guided-step__field-question">{field.question}</div>
                    </div>
                    <AIGenerateButton
                      label="AI 补全"
                      size="small"
                      type="text"
                      disabled={Boolean(runningAction) || (stepKey === 'story-core' ? !basicsReady : !storyCoreReady)}
                      modelConfigId={currentNovel?.modelConfigId}
                      buildMessages={() => [{
                        role: 'user',
                        content: buildStoryAnchorPrompt({
                          field: field.key,
                          label: field.label,
                          novelBackground: currentNovel?.expandedBackground || currentNovel?.synopsis || currentNovel?.userBackground || '',
                          genre: currentNovel?.genreName || '未设定题材',
                          currentContent: readText(storyForm.getFieldValue(field.key)),
                          relatedContext: storyRelatedContext(field.key),
                          protagonistReference,
                          protagonistRule,
                        }),
                      }]}
                      onResult={(value) => storyForm.setFieldValue(field.key, value)}
                    />
                  </div>
                  <Form.Item name={field.key} style={{ marginBottom: 0 }}>
                    <Input.TextArea rows={stepKey === 'story-core' ? 5 : 6} placeholder={field.placeholder} />
                  </Form.Item>
                </div>
              ))}
            </div>
          </Form>
        </WorkspacePanel>

        <WorkspacePanel title="本步检查">
          <FactGrid items={inheritFacts} />
          <div className="guided-step__panel-gap" />
          <ChecklistGrid
            items={fields.map((field) => ({
              title: field.label,
              detail: field.question,
              done: Boolean(readText(storyForm.getFieldValue(field.key))),
            }))}
          />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }
  if (stepKey === 'world-foundation') {
    return (
      <WorkspacePage
        className="guided-step guided-step--world-foundation"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<GlobalOutlined />}
              loading={runningAction === 'sync-world-rules'}
              onClick={() => void runAction('sync-world-rules', syncWorldRulesCore, '世界规则已同步。')}
            >
              同步世界规则
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('world-rules')}>
              打开详细编辑
            </Button>
          </Space>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="规则状态" value={worldFoundationReady ? '已就绪' : '待同步'} tone="warm" hint="先统一题材口径，再往下生成。" />
            <WorkspaceMetric label="时间制度" value={worldRules.timelineConfig.calendarType || '未设定'} hint="时间表达会影响时间轴写法。" />
          </>
        )}
        contextSummary={commonContext}
      >
        {!storyPlotReady ? (
          <Alert type="info" showIcon message="主线和结局还没定稳时，这里先落一版基础规则就够了。" />
        ) : null}

        <WorkspacePanel title="本步只做一件事" description="把题材、种族、势力、力量体系、地图蓝图和写作约束统一到同一口径。">
          <div className="guided-step__action-grid">
            <ActionCard
              title="同步世界基线"
              detail="一键生成当前题材的默认规则，后面的人物、地图和时间轴都会继承这里。"
              status="可执行"
              done={worldFoundationReady}
              meta={<FactGrid items={[
                { label: '种族', value: worldRules.speciesSystem.length, hint: '当前可用角色物种。', done: worldRules.speciesSystem.length > 0 },
                { label: '势力', value: worldRules.factionSystem.length, hint: '当前可用组织结构。', done: worldRules.factionSystem.length > 0 },
                { label: '力量体系', value: worldRules.powerSystems.length, hint: '决定成长与限制。', done: worldRules.powerSystems.length > 0 },
                { label: '地图层级', value: worldRules.mapBlueprint.levels.length, hint: '地点结构会继承这里。', done: worldRules.mapBlueprint.levels.length > 0 },
              ]} />}
              actions={(
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<GlobalOutlined />}
                    loading={runningAction === 'sync-world-rules'}
                    onClick={() => void runAction('sync-world-rules', syncWorldRulesCore, '世界规则已同步。')}
                  >
                    同步规则
                  </Button>
                  <Button onClick={() => openProPage('world-rules')}>查看详细项</Button>
                </Space>
              )}
            />
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'map-structure') {
    const blueprintFacts = [...worldRules.mapBlueprint.levels]
      .sort((left, right) => left.depth - right.depth)
      .map((level) => ({
        label: `${level.depth} 级`,
        value: level.label,
        hint: `建议每个父节点生成 ${level.suggestedCount} 个直属子节点。`,
        done: true,
      }))

    return (
      <WorkspacePage
        className="guided-step guided-step--map-structure"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<EnvironmentOutlined />}
              loading={runningAction === 'generate-map'}
              disabled={!worldFoundationReady}
              onClick={() => void runAction('generate-map', generateMapCore, '地图骨架已生成。')}
            >
              生成地点骨架
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('map')}>
              打开详细编辑
            </Button>
          </Space>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="节点数" value={stats.mapCount} tone="warm" hint={stats.mapCount > 0 ? '已经有地点可承接剧情。' : '还没有任何地点节点。'} />
            <WorkspaceMetric label="蓝图层级" value={worldRules.mapBlueprint.levels.length} hint="这里只做骨架，不铺满细节。" />
          </>
        )}
        contextSummary={commonContext}
      >
        {!worldFoundationReady ? (
          <Alert type="warning" showIcon message="请先同步世界规则，再生成地图骨架。" />
        ) : null}

        <WorkspacePanel title="先生成一版能用的地点层级" description="这一页不要求你看完整棵树，只要先把结构搭起来。">
          <div className="guided-step__action-grid">
            <ActionCard
              title="生成地点骨架"
              detail="按题材蓝图生成国家、区域、据点或关键场景，让后续角色和事件有落点。"
              status={worldFoundationReady ? '可执行' : '先完成上一步'}
              done={mapReady}
              meta={<FactGrid items={blueprintFacts} />}
              actions={(
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<EnvironmentOutlined />}
                    loading={runningAction === 'generate-map'}
                    disabled={!worldFoundationReady}
                    onClick={() => void runAction('generate-map', generateMapCore, '地图骨架已生成。')}
                  >
                    生成骨架
                  </Button>
                  <Button onClick={() => openProPage('map')}>打开地图页</Button>
                </Space>
              )}
            />
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'character-roster') {
    const totalPreset = characterPreset.majorCount
      + characterPreset.minorCount
      + characterPreset.antagonistCount
      + characterPreset.supportingCount

    return (
      <WorkspacePage
        className="guided-step guided-step--character-roster"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<TeamOutlined />}
              loading={runningAction === 'generate-characters'}
              disabled={!worldFoundationReady || !mapReady}
              onClick={() => void runAction('generate-characters', generateCharactersCore, '角色首版已生成。')}
            >
              生成关键角色
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('characters')}>
              打开详细编辑
            </Button>
          </Space>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="主角" value={stats.hasProtagonist ? '已建立' : '未建立'} tone="warm" hint="没有主角时会先补主角。" />
            <WorkspaceMetric label="角色数" value={stats.characterCount} hint="先够用，再扩充细枝末节。" />
          </>
        )}
        contextSummary={commonContext}
      >
        {(!worldFoundationReady || !mapReady) ? (
          <Alert type="warning" showIcon message="请先补好世界规则和地图骨架，再生成角色系统。" />
        ) : null}

        <WorkspacePanel title="先补第一批能推动主线的人物">
          <div className="guided-step__action-grid">
            <ActionCard
              title="生成角色首版"
              detail="先生成主角、关键对手和支撑主线的功能位，后续细修放到角色页。"
              status={worldFoundationReady && mapReady ? '可执行' : '先完成前置'}
              done={characterReady}
              meta={<FactGrid items={[
                { label: '建议总量', value: totalPreset, hint: '按题材预设的第一批规模。', done: true },
                { label: '主要角色', value: characterPreset.majorCount, hint: '负责主线推进。', done: true },
                { label: '对手角色', value: characterPreset.antagonistCount, hint: '负责制造压力。', done: true },
                { label: '支撑功能位', value: characterPreset.helperRoles.join('、'), hint: '优先补这些角色功能。', done: true },
              ]} />}
              actions={(
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<TeamOutlined />}
                    loading={runningAction === 'generate-characters'}
                    disabled={!worldFoundationReady || !mapReady}
                    onClick={() => void runAction('generate-characters', generateCharactersCore, '角色首版已生成。')}
                  >
                    生成首版角色
                  </Button>
                  <Button onClick={() => openProPage('characters')}>打开角色页</Button>
                </Space>
              )}
            />
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'items-equipment') {
    return (
      <WorkspacePage
        className="guided-step guided-step--items-equipment"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<ShoppingOutlined />}
              loading={runningAction === 'generate-items'}
              disabled={!characterReady || !mapReady}
              onClick={() => void runAction('generate-items', generateItemsCore, '关键物品已生成。')}
            >
              生成关键物品
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('items')}>
              打开详细编辑
            </Button>
          </Space>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="物品数" value={stats.itemCount} tone="warm" hint={stats.itemCount > 0 ? '已经有剧情挂点。' : '还没有首批物品。'} />
            <WorkspaceMetric label="首批建议" value={itemProfile.defaultBatch} hint={itemProfile.title} />
          </>
        )}
        contextSummary={commonContext}
      >
        {(!characterReady || !mapReady) ? (
          <Alert type="warning" showIcon message="请先补角色和地图，再生成关键物品与装备。" />
        ) : null}

        <WorkspacePanel title="先补会被真正用到的物件">
          <div className="guided-step__action-grid">
            <ActionCard
              title="生成首批物品"
              detail="先补交易物、任务物、装备和转折道具，不生成和剧情无关的堆料。"
              status={characterReady && mapReady ? '可执行' : '先完成前置'}
              done={itemsReady}
              meta={<FactGrid items={[
                { label: '模板方向', value: itemProfile.title, hint: '会优先沿这个方向生成。', done: true },
                { label: '首批数量', value: itemProfile.defaultBatch, hint: '只补够第一轮剧情挂点。', done: true },
                { label: '可挂载到', value: '人物 / 地点 / 事件', hint: '生成时会尝试绑定上下文。', done: true },
              ]} />}
              actions={(
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<ShoppingOutlined />}
                    loading={runningAction === 'generate-items'}
                    disabled={!characterReady || !mapReady}
                    onClick={() => void runAction('generate-items', generateItemsCore, '关键物品已生成。')}
                  >
                    生成首批物品
                  </Button>
                  <Button onClick={() => openProPage('items')}>打开物品页</Button>
                </Space>
              )}
            />
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }
  const outlineReady = stats.outlineCount > 0
  const timelineReady = stats.timelineCount > 0
  const chapterReady = stats.chapterCount > 0 || stats.totalWords > 0
  const storyReadyBoard = [
    { label: '基础信息', value: basicsReady ? '已就绪' : '待补齐', hint: '书名、简介和背景。', done: basicsReady },
    { label: '故事锚点', value: storyCoreReady && storyPlotReady ? '已就绪' : '待补齐', hint: '目标、冲突、主线、结局。', done: storyCoreReady && storyPlotReady },
    { label: '世界与地图', value: worldFoundationReady && mapReady ? '已就绪' : '待补齐', hint: '规则和地点骨架。', done: worldFoundationReady && mapReady },
    { label: '角色与物品', value: characterReady && itemsReady ? '已就绪' : '待补齐', hint: '首批关键角色和物品。', done: characterReady && itemsReady },
    { label: '写作骨架', value: outlineReady && timelineReady ? '已就绪' : '待补齐', hint: '故事弧和时间轴。', done: outlineReady && timelineReady },
  ]

  return (
    <WorkspacePage
      className="guided-step guided-step--write-start"
      layout="wide"
      heroVariant="compact"
      eyebrow={stepMeta.eyebrow}
      title={stepMeta.title}
      description={stepMeta.description}
      actions={(
        <Space wrap>
          <Button type="primary" icon={<EditOutlined />} onClick={() => openProPage('writing')}>
            进入正文页
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('outline')}>
            打开大纲页
          </Button>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="故事弧" value={stats.outlineCount} tone="warm" hint={outlineReady ? '已可承接章节推进。' : '建议先生成首版。'} />
          <WorkspaceMetric label="时间轴" value={stats.timelineCount} hint={timelineReady ? '事件顺序已落地。' : '建议在写作前补齐。'} />
          <WorkspaceMetric label="章节" value={stats.chapterCount} hint={chapterReady ? '可以直接进入正文。' : '还没创建首章。'} />
        </>
      )}
      contextSummary={commonContext}
    >
      {!itemsReady ? (
        <Alert type="warning" showIcon message="建议先把角色和关键物品补齐，再开始生成写作骨架。" />
      ) : null}

      <WorkspacePanel title="按顺序把写作入口补齐" description="这里只保留三个动作，减少一次看到的内容。">
        <div className="guided-step__action-grid">
          <ActionCard
            title="1. 生成故事弧"
            detail="先把主线拆成连续推进的阶段，避免正文直接失控。"
            status={itemsReady ? '可执行' : '先完成前置'}
            done={outlineReady}
            actions={(
              <Space wrap>
                <Button
                  type="primary"
                  icon={<BarsOutlined />}
                  loading={runningAction === 'generate-outline'}
                  disabled={!itemsReady || !characterReady || !storyPlotReady}
                  onClick={() => void runAction('generate-outline', generateOutlineCore, '故事弧已生成。')}
                >
                  {outlineReady ? '重新生成' : '生成故事弧'}
                </Button>
                <Button onClick={() => openProPage('outline')}>打开大纲页</Button>
              </Space>
            )}
          />

          <ActionCard
            title="2. 生成时间轴"
            detail="把关键事件的先后关系串起来，避免人物、地点和物品断线。"
            status={outlineReady ? '可执行' : '先生成故事弧'}
            done={timelineReady}
            actions={(
              <Space wrap>
                <Button
                  type="primary"
                  icon={<ClockCircleOutlined />}
                  loading={runningAction === 'generate-timeline'}
                  disabled={!outlineReady || !itemsReady || !characterReady || !mapReady}
                  onClick={() => void runAction('generate-timeline', generateTimelineCore, '时间轴已生成。')}
                >
                  {timelineReady ? '重新生成' : '生成时间轴'}
                </Button>
                <Button onClick={() => openProPage('timeline')}>打开时间轴页</Button>
              </Space>
            )}
          />

          <ActionCard
            title="3. 创建第一章"
            detail="骨架稳定后，直接建立首章入口并进入正文页。"
            status={outlineReady && timelineReady ? '可执行' : '先补齐骨架'}
            done={chapterReady}
            actions={(
              <Space wrap>
                {stats.chapterCount <= 0 ? (
                  <Button
                    type="primary"
                    icon={<EditOutlined />}
                    loading={runningAction === 'create-chapter'}
                    disabled={!outlineReady || !timelineReady}
                    onClick={() => void handleCreateFirstChapter()}
                  >
                    创建第一章
                  </Button>
                ) : null}
                <Button onClick={() => openProPage('writing')}>
                  {chapterReady ? '进入正文页' : '查看正文页'}
                </Button>
              </Space>
            )}
          />
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="写作前检查">
        <FactGrid items={storyReadyBoard} />
        <div className="guided-step__panel-gap" />
        <ChecklistGrid
          items={[
            { title: '故事弧', detail: '至少先有一版主线分段，知道每段推进什么。', done: outlineReady },
            { title: '时间轴', detail: '至少先有一版关键事件顺序，知道先后与回收关系。', done: timelineReady },
            { title: '正文入口', detail: '至少有一个章节入口，写作页面才能真正开始累计内容。', done: chapterReady },
          ]}
        />
      </WorkspacePanel>
    </WorkspacePage>
  )
}