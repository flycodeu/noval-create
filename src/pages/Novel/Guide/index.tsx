import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Space, Tag, message } from 'antd'
import {
  BarsOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  EditOutlined,
  GlobalOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { NovelConsistencyReport, NovelContextStatus } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useWorkspaceStore } from '../../../stores/workspace.store'
import { getCharacterBatchPreset, getItemGenerationProfile } from '../../../shared/creation-tools'
import { parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { buildStorySettingsPayload, parseStorySettingsSnapshot } from '../../../shared/story-settings'
import {
  getFactionNameOptions,
  getSpeciesNameOptions,
  parseWorldRulesJson,
  stringifyWorldRules,
} from '../../../shared/genre-system'
import { parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import {
  EMPTY_WORKFLOW_STATS,
  isProjectBriefReady,
  isStoryCoreReady,
  isStoryPlotReady,
  isThemeVoiceReady,
  loadWorkflowStats,
  type WorkflowStats,
} from '../workflow'

interface Props {
  novelId: number
}

interface StepConfig {
  key: string
  title: string
  desc: string
  status: string
  count: string
  support: string
  ready: boolean
  icon: React.ReactNode
  action: React.ReactNode
}

const TIME_MODE_LABELS: Record<string, string> = {
  gregorian: '公历时间',
  regnal: '年号纪年',
  'relative-disaster': '灾变相对时间',
  'custom-era': '虚构纪元',
  'future-date': '未来日期',
}

function getSeverityColor(severity: 'high' | 'medium' | 'low') {
  switch (severity) {
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    default:
      return 'default'
  }
}

function getSeverityLabel(severity: 'high' | 'medium' | 'low') {
  switch (severity) {
    case 'high':
      return '高优先'
    case 'medium':
      return '中优先'
    default:
      return '低优先'
  }
}

function getHealthTone(score: number) {
  if (score >= 80) return '结构稳定'
  if (score >= 60) return '可继续推进'
  return '先修关键冲突'
}

export default function GuidePage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { mode } = useWorkspaceStore()
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)

  const projectBrief = useMemo(
    () => parseProjectBriefSnapshot(currentNovel?.projectBriefJson),
    [currentNovel?.projectBriefJson],
  )
  const themeVoice = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )
  const storySettings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
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

  const refreshStats = useCallback(async () => {
    setStats(await loadWorkflowStats(novelId))
  }, [novelId])

  const refreshDiagnostics = useCallback(async () => {
    const [report, nextContextStatus] = await Promise.all([
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getContextStatus(novelId),
    ])
    setConsistencyReport(report)
    setContextStatus(nextContextStatus)
  }, [novelId])

  useEffect(() => {
    void Promise.all([refreshStats(), refreshDiagnostics()])
  }, [refreshDiagnostics, refreshStats])

  const syncWorldRulesCore = useCallback(async () => {
    const normalized = parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName)
    await window.electron.novel.update(novelId, {
      worldRulesJson: stringifyWorldRules(normalized),
    })

    const updated = await window.electron.novel.get(novelId)
    if (updated) setCurrentNovel(updated)
  }, [currentNovel?.genreName, currentNovel?.worldRulesJson, novelId, setCurrentNovel])

  const generateMapCore = useCallback(async () => {
    const layerCounts = [...worldRules.mapBlueprint.levels]
      .sort((left, right) => left.depth - right.depth)
      .map((level) => level.suggestedCount)

    await window.electron.map.batchGenerate(novelId, {
      layerCounts,
      parentBatchSize: 1,
    })
  }, [novelId, worldRules.mapBlueprint.levels])

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
      specialRequirements: '人物必须继承题材、背景、势力、地图和后续事件关系，避免只补数量。',
      batchSize: 6,
    })
  }, [characterPreset, factionOptions, novelId, stats.hasProtagonist])

  const generateItemsCore = useCallback(async () => {
    await window.electron.item.generate(novelId, {
      count: itemProfile.defaultBatch,
      templateOnly: false,
      refreshTemplates: true,
      batchSize: 4,
      focus: '先补足符合题材的流通物品和剧情挂点，再生成可落地实例。',
    })
  }, [itemProfile.defaultBatch, novelId])

  const generateStoryDesignCore = useCallback(async () => {
    const result = await window.electron.ai.generateCoreSettings({
      novelId,
      subplotCount: 8,
      requirements: '故事设计必须建立在已经存在的世界规则、地图、人物、物品和线程基础上，不要再把背景底盘写成剧情本身。减少口号化和同模板输出。',
    })

    const payload = buildStorySettingsPayload({
      storyDesign: {
        storyGoal: result.story_goal,
        coreConflict: result.core_conflict,
        mainPlot: result.main_plot,
        subPlotsList: result.sub_plots_list,
        rhythmSetup: result.rhythm_setup,
        rhythmConflict: result.rhythm_conflict,
        rhythmEnding: result.rhythm_ending,
        endingType: result.ending_type,
        ending: result.ending,
      },
    }, currentNovel?.settingsJson)

    await window.electron.novel.update(novelId, {
      settingsJson: JSON.stringify(payload),
    })

    const updated = await window.electron.novel.get(novelId)
    if (updated) setCurrentNovel(updated)
  }, [currentNovel?.settingsJson, novelId, setCurrentNovel])

  const generateOutlineCore = useCallback(async () => {
    await window.electron.outline.generateArcs(novelId)
  }, [novelId])

  const generateTimelineCore = useCallback(async () => {
    await window.electron.timeline.generate(novelId, {
      count: 12,
      batchSize: 4,
      focus: '优先串联主角、关键地点、关键物品和主要冲突的先后顺序与回收关系。',
    })
  }, [novelId])

  const runStep = useCallback(async (
    key: string,
    action: () => Promise<void>,
    successText: string,
  ) => {
    setRunningKey(key)

    try {
      await action()
      await Promise.all([refreshStats(), refreshDiagnostics()])
      message.success(successText)
    } catch (error) {
      console.error(error)
      message.error('执行失败，请稍后重试或先检查前置内容是否完整。')
    } finally {
      setRunningKey(null)
    }
  }, [refreshDiagnostics, refreshStats])

  const syncWorldRules = () => runStep('world-rules', syncWorldRulesCore, '世界规则已按当前题材同步。')
  const generateMap = () => runStep('map', generateMapCore, '地图首批骨架已生成，可继续在地图页补下一批。')
  const generateCharacters = () => runStep('characters', generateCharactersCore, '人物网络首版已生成。')
  const generateItems = () => runStep('items', generateItemsCore, '物品模板与实例首批已生成，可继续在物品页补下一批。')
  const generateOutline = () => runStep('outline', generateOutlineCore, '故事弧首批已生成，可继续在大纲页细化章节。')
  const generateStoryDesign = () => runStep('story-design', generateStoryDesignCore, '故事设计首版已生成，可继续在故事设计页细修。')
  const generateTimeline = () => runStep('timeline', generateTimelineCore, '时间轴首批事件已生成，可继续追加下一批。')

  const runPipeline = async () => {
    setRunningKey('pipeline')

    try {
      await syncWorldRulesCore()
      await refreshStats()
      await generateMapCore()
      await refreshStats()
      await generateCharactersCore()
      await refreshStats()
      await generateItemsCore()
      await refreshStats()
      await generateStoryDesignCore()
      await refreshStats()
      await generateOutlineCore()
      await refreshStats()
      await generateTimelineCore()
      await Promise.all([refreshStats(), refreshDiagnostics()])
      message.success('首批基础资产与故事设计已铺好，后续请在结构、时间轴和正文页继续分批细化。')
    } catch (error) {
      console.error(error)
      message.error('AI 铺设中断，请先检查基础设定、世界资产和故事设计前置是否完整。')
    } finally {
      setRunningKey(null)
    }
  }

  const recommendedCharacterCount = characterPreset.majorCount
    + characterPreset.antagonistCount
    + characterPreset.supportingCount
    + characterPreset.minorCount
  const staleChapterCount = contextStatus?.staleChapterCount || 0

  const steps: StepConfig[] = [
    {
      key: 'project-brief',
      title: '项目立项',
      desc: '先统一平台模式、目标读者、读者承诺、卖点和禁区，后续所有内容都以这个 Brief 为产品基线。',
      status: isProjectBriefReady(currentNovel) ? '已填写' : '待补全',
      count: `${projectBrief.readyCount}/6`,
      support: isProjectBriefReady(currentNovel)
        ? '产品定位已经稳定，后续主题、角色和线程会更贴近目标读者。'
        : '如果项目立项含糊，后面的主题、人物和正文很容易写成“什么都沾一点”。',
      ready: isProjectBriefReady(currentNovel),
      icon: <EditOutlined />,
      action: (
        <Button type="primary" ghost icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/project-brief`)}>
          去填写
        </Button>
      ),
    },
    {
      key: 'core-settings',
      title: '核心设定',
      desc: '先写清 premise、主角起点、底层约束和语言边界，后面所有模块都会引用这里的上下文。',
      status: isStoryCoreReady(currentNovel) ? '已填写' : '待补全',
      count: `${storySettings.premiseReadyCount}/5`,
      support: isStoryCoreReady(currentNovel)
        ? '故事底盘已经有了统一口径，后续地图、人物和时间轴不会再凭空生长。'
        : '如果这里还是空的，后续自动生成就会失去边界，人物、地图和物品都会发散。',
      ready: isStoryCoreReady(currentNovel),
      icon: <EditOutlined />,
      action: (
        <Button type="primary" ghost icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/core-settings`)}>
          去填写
        </Button>
      ),
    },
    {
      key: 'theme-voice',
      title: '主题与文风',
      desc: '把主题、情感核心、叙事视角、时态、风格规则和对白规则固定下来，降低 AI 味和口吻漂移。',
      status: isThemeVoiceReady(currentNovel) ? '已填写' : '待补全',
      count: `${themeVoice.readyCount}/6`,
      support: isThemeVoiceReady(currentNovel)
        ? '语言边界已经收紧，后续正文和修订都会有统一口吻。'
        : '如果主题与文风没有被钉住，长篇生成最容易出现人机味、总结腔和视角越权。',
      ready: isThemeVoiceReady(currentNovel),
      icon: <ThunderboltOutlined />,
      action: (
        <Button type="primary" ghost icon={<ThunderboltOutlined />} onClick={() => navigate(`/novels/${novelId}/theme-voice`)}>
          去填写
        </Button>
      ),
    },
    {
      key: 'world-rules',
      title: '世界规则',
      desc: '同步题材对应的种族、等级、势力、地图层级、时间制度和语言约束。',
      status: currentNovel?.worldRulesJson ? '已同步' : '待生成',
      count: `${speciesOptions.length} 种族 / ${factionOptions.length} 势力`,
      support: currentNovel?.worldRulesJson
        ? '人物生态、地图层级和时间口径已经有统一依据。'
        : '这一页决定后续设定的底层口径，尤其是等级体系、种族关系和时间表达方式。',
      ready: Boolean(currentNovel?.worldRulesJson),
      icon: <GlobalOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'world-rules'} icon={<ThunderboltOutlined />} onClick={syncWorldRules}>
            同步规则
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/world-rules`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'map',
      title: '地图与势力落点',
      desc: '按题材自动搭出区域、国家、门派、基地或关键场景，让人物和事件有真实发生位置。',
      status: stats.mapCount > 0 ? '已生成' : '待生成',
      count: `${stats.mapCount} 个地图节点`,
      support: stats.mapCount > 0
        ? '地点骨架已经搭好，后续人物、物品和事件都能落到具体区域。'
        : '地图不是装饰，它决定资源争夺、活动半径、势力边界和事件爆发地点。',
      ready: stats.mapCount > 0,
      icon: <CompassOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'map'} icon={<CompassOutlined />} onClick={generateMap}>
            AI 生成首批
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/map`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'characters',
      title: '人物批量生成',
      desc: '按主角、主要人物、反派、功能角色和次要人物的配额先搭人物网，再逐个细修。',
      status: stats.characterCount > 0 ? '已生成' : '待生成',
      count: `${stats.characterCount} 位角色`,
      support: stats.characterCount > 0
        ? `当前题材建议优先补足这些功能位：${characterPreset.helperRoles.join('、')}。`
        : '先把人物网络搭起来，时间轴、物品和大纲页面才有足够的挂点可以联动。',
      ready: stats.characterCount > 0,
      icon: <TeamOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'characters'} icon={<TeamOutlined />} onClick={generateCharacters}>
            AI 批量生成
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/characters`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'items',
      title: '物品与装备',
      desc: '先生成符合题材的模板，再把具体物品挂到人物、地点和事件上，避免后期凭空补道具。',
      status: stats.itemCount > 0 ? '已生成' : '待生成',
      count: `${stats.itemCount} 条物品记录`,
      support: stats.itemCount > 0
        ? `当前题材的模板重心是“${itemProfile.title}”，会优先补齐常见流通链和剧情挂点。`
        : '模板负责结构，实例负责落地。缺了这一层，很多剧情只会停留在口头设定。',
      ready: stats.itemCount > 0,
      icon: <ShoppingOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'items'} icon={<ShoppingOutlined />} onClick={generateItems}>
            AI 生成首批
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/items`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'threads',
      title: '故事线程',
      desc: '把主线、支线、悬念、关系线和回收线都建成可追踪线程，减少长篇推进中的遗忘和断裂。',
      status: stats.threadCount > 0 ? '已建立' : '待建立',
      count: `${stats.threadCount} 条线程`,
      support: stats.threadCount > 0
        ? '线程已经能给结构、时间轴和正文提供统一的回查挂点。'
        : '没有线程层，后面的结构和正文只会各自推进，伏笔、关系线和回收点会越来越散。',
      ready: stats.threadCount > 0,
      icon: <BarsOutlined />,
      action: (
        <Button type="primary" ghost icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/threads`)}>
          去整理
        </Button>
      ),
    },
    {
      key: 'story-design',
      title: '故事设计',
      desc: '等世界、地图、人物、物品和线程都到位后，再统一设计主线、支线和结局。',
      status: isStoryPlotReady(currentNovel) ? '已生成' : '待生成',
      count: `${storySettings.storyDesignReadyCount}/4`,
      support: isStoryPlotReady(currentNovel)
        ? '故事设计已经成型，接下来可以直接转去结构和时间线。'
        : '这一步把主线目标、核心冲突、推进链和结局方向压成统一骨架，避免大纲从空白起步。',
      ready: isStoryPlotReady(currentNovel),
      icon: <BarsOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'story-design'} icon={<BarsOutlined />} onClick={generateStoryDesign}>
            AI 生成首版
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/story-design`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'outline',
      title: '故事大纲',
      desc: '把主线拆成连续推进的故事弧，为章节节奏和正文推进准备稳定骨架。',
      status: stats.outlineCount > 0 ? '已生成' : '待生成',
      count: `${stats.outlineCount} 条故事弧`,
      support: stats.outlineCount > 0
        ? '大纲已经可以承接章节推进，接下来重点是细化并落到具体场景。'
        : '先拆出故事弧，再去写正文，能明显降低中途跑偏和节奏失控的风险。',
      ready: stats.outlineCount > 0,
      icon: <BarsOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'outline'} icon={<BarsOutlined />} onClick={generateOutline}>
            AI 生成首批
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/outline`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'timeline',
      title: '事件时间轴',
      desc: '把关键事件按先后顺序串起来，记清谁在场、拿着什么、结果如何，还有哪些线没回收。',
      status: stats.timelineCount > 0 ? '已生成' : '待生成',
      count: `${stats.timelineCount} 个事件`,
      support: stats.timelineCount > 0
        ? '时间轴已经能用来核对事件顺序、人物状态和伏笔回收情况。'
        : '时间轴越早补齐，后面越不容易写到一半忘了人物位置、物品去向和事件后果。',
      ready: stats.timelineCount > 0,
      icon: <ClockCircleOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'timeline'} icon={<ClockCircleOutlined />} onClick={generateTimeline}>
            AI 生成首批
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/timeline`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'revision',
      title: '修订中心',
      desc: '把一致性问题、待同步章节和人工修订任务集中到一个入口，避免问题散落在各页。',
      status: stats.revisionTaskCount > 0 ? '待处理' : '已稳定',
      count: stats.revisionTaskCount > 0 ? `${stats.revisionTaskCount} 条待处理` : '当前无未处理任务',
      support: stats.revisionTaskCount > 0
        ? '这里会汇总系统体检结果、上下文变更影响和人工修订项，适合作为开写前的最后一道检查。'
        : '当前没有未处理修订任务，可以继续写作或继续细修结构资产。',
      ready: stats.revisionTaskCount <= 0,
      icon: <EditOutlined />,
      action: (
        <Button type="primary" ghost icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/revision`)}>
          打开修订中心
        </Button>
      ),
    },
  ]

  const structureReadyCount = steps.filter((step) => step.ready).length
  const nextStep = steps.find((step) => !step.ready) || null
  const pendingSteps = steps.filter((step) => !step.ready)
  const queuedSteps = pendingSteps.slice(1, 4)
  const nextStepNarrative = nextStep
    ? nextStep.support
    : '主要设计资产已经齐备，可以转去正文写作，也可以继续细修人物、地图、时间轴和大纲。'
  const flowDigest = nextStep
    ? queuedSteps.length > 0
      ? '这一环补稳后，顺着继续推进 ' + queuedSteps.map((step) => step.title).join('、') + '。'
      : '这一环完成后，就已经具备直接转入正文写作的条件。'
    : '关键工作流已经就绪，已经具备直接开写的条件。'

  return (
    <WorkspacePage
      className={`novel-guide novel-guide--${mode}`}
      layout="wide"
      eyebrow={mode === 'guided' ? '分步创作' : '创作工作流'}
      title="创作向导"
      description={
        mode === 'guided'
          ? '把小说从“底盘”一路推进到“可以开写”。这里不是功能堆叠，而是一套按顺序推进的工作流。'
          : '把产品立项、主题文风、世界资产、结构资产和修订前置统一管理，并在每一步都维持上下文继承和结构校验。'
      }
      actions={(
        <Space wrap>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={Boolean(runningKey)}
            onClick={runPipeline}
          >
            AI 铺设首批骨架
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/${stats.revisionTaskCount > 0 ? 'revision' : 'writing'}`)}>
            {stats.revisionTaskCount > 0 ? '打开修订中心' : '进入正文写作'}
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '工作模式', value: mode === 'guided' ? '小白模式' : '专业模式' },
            { label: '结构完成度', value: `${structureReadyCount}/${steps.length} 步就绪` },
            {
              label: '时间制度',
              value: TIME_MODE_LABELS[worldRules.timelineConfig.calendarType] || worldRules.timelineConfig.calendarType,
            },
            { label: '待同步章节', value: staleChapterCount > 0 ? `${staleChapterCount} 章` : '全部最新' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric
            label="推荐人物配额"
            value={recommendedCharacterCount}
            tone="warm"
            hint="主角之外的主要人物、反派、功能角色和次要人物总和"
          />
          <WorkspaceMetric
            label="主题与文风"
            value={`${themeVoice.readyCount}/6`}
            hint="先把视角、时态、风格规则和对白边界压稳"
          />
          <WorkspaceMetric
            label="故事线程"
            value={stats.threadCount}
            tone="cool"
            hint="后续结构页、时间轴和正文都应回查这些线程"
          />
          <WorkspaceMetric
            label="修订压力"
            value={stats.revisionTaskCount}
            hint={stats.revisionTaskCount > 0 ? '建议开写前先处理未闭环问题' : '当前没有未处理修订任务'}
          />
        </>
      )}
      aside={(
        <>
          {contextStatus && (
            <WorkspacePanel
              title="上下文同步"
              description="当核心设定、世界规则、人物、地图、物品、线程、时间轴或大纲发生变化时，受影响章节会被标记为待同步。"
            >
              <div className="novel-note-list">
                <div className="novel-note-list__item">{`当前上下文版本：v${contextStatus.contextVersion}`}</div>
                <div className="novel-note-list__item">{`章节总数：${contextStatus.totalChapterCount}`}</div>
                <div className="novel-note-list__item">{`待同步章节：${contextStatus.staleChapterCount}`}</div>
                <div className="novel-note-list__item">
                  {contextStatus.staleChapterCount > 0
                    ? '建议先去修订中心或正文页回查受影响章节，再继续批量生成后续内容。'
                    : '当前章节上下文与最新设定保持一致，可以继续推进。'}
                </div>
              </div>
            </WorkspacePanel>
          )}

          <WorkspacePanel title="设计底盘快照" description="这些模块越早钉住，后面的正文就越不容易出现 AI 味和断线问题。">
            <div className="novel-note-list">
              <div className="novel-note-list__item">{`项目立项：${projectBrief.readyCount}/6`}</div>
              <div className="novel-note-list__item">{`基础设定：${storySettings.premiseReadyCount}/5`}</div>
              <div className="novel-note-list__item">{`主题与文风：${themeVoice.readyCount}/6`}</div>
              <div className="novel-note-list__item">{`故事设计：${storySettings.storyDesignReadyCount}/4`}</div>
            </div>
          </WorkspacePanel>

          {consistencyReport && (
            <WorkspacePanel title="结构体检" description="全书级一致性校验器会自动检查人物、事件、时间轴、地图、物品和章节之间的冲突。">
              <div className="novel-health-board">
                <div className="novel-health-score">
                  <strong>{consistencyReport.readinessScore}</strong>
                  <span>{getHealthTone(consistencyReport.readinessScore)}</span>
                </div>
                <div className="novel-health-breakdown">
                  <div>
                    <strong>{consistencyReport.highCount}</strong>
                    <span>高优先</span>
                  </div>
                  <div>
                    <strong>{consistencyReport.mediumCount}</strong>
                    <span>中优先</span>
                  </div>
                  <div>
                    <strong>{consistencyReport.lowCount}</strong>
                    <span>低优先</span>
                  </div>
                </div>
              </div>

              <div className="novel-note-list">
                {consistencyReport.focusAreas.map((focus) => (
                  <div key={focus} className="novel-note-list__item">{focus}</div>
                ))}
              </div>
            </WorkspacePanel>
          )}
        </>
      )}
    >
      {contextStatus && contextStatus.staleChapterCount > 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message={`有 ${contextStatus.staleChapterCount} 章需要重新同步上下文`}
          description="最近的设定或结构变更已经影响到现有章节。继续批量生成前，建议先回到修订中心或正文页处理这些章节，避免后续文本承接旧设定。"
        />
      )}

      {consistencyReport && consistencyReport.highCount > 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message="当前存在高优先级结构冲突"
          description="建议优先修复高优先问题，再继续批量生成或长文写作，否则冲突会在后续章节中被不断放大。"
        />
      )}

      {(!isProjectBriefReady(currentNovel) || !isThemeVoiceReady(currentNovel)) && (
        <Alert
          className="novel-guide__alert"
          type="info"
          showIcon
          message="产品立项与文风底盘还没有钉稳"
          description="如果这两层没有先收紧，后面的 AI 生成很容易出现人机味、空泛卖点和口吻漂移。"
        />
      )}

      <WorkspacePanel
        title="推荐推进顺序"
        description="把主流程先压成一条清晰链路，只保留当前最值得推进的动作。"
        extra={<div className="novel-pill">{nextStep ? `下一步：${nextStep.title}` : '可进入正文'}</div>}
      >
        <div className="novel-guide__flow-head">
          <div className="novel-guide__flow-lead">
            <div className="novel-kicker">{nextStep ? '当前建议' : '流程状态'}</div>
            <strong>{nextStep ? nextStep.title : '关键骨架已铺好'}</strong>
            <div className="novel-guide__flow-queue">
              <span className="novel-guide__flow-chip">{'已就绪 ' + structureReadyCount + '/' + steps.length}</span>
              {queuedSteps.length > 0
                ? queuedSteps.map((step) => (
                  <span key={step.key} className="novel-guide__flow-chip novel-guide__flow-chip--muted">
                    {step.title}
                  </span>
                ))
                : (
                  <span className="novel-guide__flow-chip novel-guide__flow-chip--muted">可转入正文写作</span>
                )}
            </div>
          </div>
          <div className="novel-guide__flow-note">
            <div>{nextStepNarrative}</div>
            <div className="novel-guide__flow-subnote">{flowDigest}</div>
          </div>
        </div>
        <div className="novel-stage-grid">
          {steps.map((step, index) => (
            <div key={step.key} className={`novel-stage-card ${step.ready ? 'novel-stage-card--ready' : ''}`}>
              <div className="novel-stage-card__header">
                <div>
                  <div className="novel-kicker">{`步骤 ${String(index + 1).padStart(2, '0')}`}</div>
                  <div className="novel-stage-card__title">
                    {step.icon}
                    {step.title}
                  </div>
                </div>
                <div className="novel-stage-card__meta">
                  <Tag color={step.ready ? 'success' : 'default'}>{step.status}</Tag>
                  <Tag color="blue">{step.count}</Tag>
                </div>
              </div>
              <div className="novel-stage-card__desc">{step.desc}</div>
              {nextStep?.key === step.key ? (
                <div className="novel-stage-card__focus">{step.support}</div>
              ) : null}
              <div className="novel-stage-card__actions">{step.action}</div>
            </div>
          ))}
        </div>
      </WorkspacePanel>

      {consistencyReport && (
        <WorkspacePanel
          title="全书级一致性校验器"
          description={consistencyReport.overview}
          extra={<div className="novel-pill">{`共发现 ${consistencyReport.issueCount} 个问题`}</div>}
        >
          <div className="novel-issue-mini-grid">
            <div className="novel-note-list__item">
              章节：{consistencyReport.metrics.chapterCount} 章，其中缺摘要 {consistencyReport.metrics.chaptersMissingSummary} 章，缺连续性记忆 {consistencyReport.metrics.chaptersMissingContinuity} 章。
            </div>
            <div className="novel-note-list__item">
              时间轴：{consistencyReport.metrics.timelineCount} 个事件，已与章节/地点联动 {consistencyReport.metrics.linkedTimelineCount} 个。
            </div>
            <div className="novel-note-list__item">
              物品：{consistencyReport.metrics.itemCount} 条记录，双向联动完整 {consistencyReport.metrics.bidirectionalLinkCount} 条。
            </div>
          </div>

          <div className="novel-issue-list">
            {consistencyReport.issues.slice(0, mode === 'guided' ? 4 : 8).map((issue) => (
              <div key={issue.id} className="novel-issue-item">
                <div className="novel-issue-item__head">
                  <Tag color={getSeverityColor(issue.severity)}>{getSeverityLabel(issue.severity)}</Tag>
                  <strong>{issue.title}</strong>
                </div>
                <div className="novel-issue-item__desc">{issue.description}</div>
                <div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      )}
    </WorkspacePage>
  )
}
