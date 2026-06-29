import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Collapse, Space, Tag, message, type CollapseProps } from 'antd'
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
import type { NovelConsistencyReport, NovelContextStatus, QualityDashboardData } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useAuthorWorkModeStore } from '../../../stores/author-work-mode.store'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import {
  getCharacterBatchPreset,
  getItemGenerationProfile,
  getStoryThreadGenerationPreset,
  getTimelineGenerationPreset,
  scaleMapLayerCounts,
} from '../../../shared/creation-tools'
import { parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { buildStorySettingsPayload, parseStorySettingsSnapshot } from '../../../shared/story-settings'
import {
  getFactionNameOptions,
  getSpeciesNameOptions,
  parseWorldRulesJson,
  stringifyWorldRules,
} from '../../../shared/genre-system'
import { parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import { formatWritingContractTags } from '../../../shared/writing-contract'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import {
  buildAuthorWorkflowSummary,
  getAuthorWorkModeLabel,
  resolveAuthorWorkflowHref,
  resolveSuggestedAuthorWorkMode,
  type AuthorWorkMode,
} from '../author-workflow'
import {
  EMPTY_WORKFLOW_STATS,
  GUIDED_WORKFLOW_PHASES,
  getAssetBloatSignal,
  getNextChapterReadiness,
  getWorkflowBlockers,
  isBasicsReady,
  isEndgameDesignReady,
  isProjectBriefReady,
  isStoryCoreReady,
  isStoryPlotReady,
  isThemeVoiceReady,
  loadWorkflowStats,
  type WorkflowRunnableStepKey,
  type WorkflowStats,
} from '../workflow'
import './index.css'

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

function getFreshnessTags(labels: string[], visibleCount = 2) {
  if (labels.length <= visibleCount) return labels
  return [...labels.slice(0, visibleCount), `+${labels.length - visibleCount}`]
}

export default function GuidePage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [qualitySummary, setQualitySummary] = useState<Pick<QualityDashboardData, 'productionReadiness' | 'batchHealth' | 'continuityHealth'> | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const authorMode = useAuthorWorkModeStore((state) => state.mode)
  const authorModeSource = useAuthorWorkModeStore((state) => state.source)
  const setManualAuthorMode = useAuthorWorkModeStore((state) => state.setManualMode)
  const syncSuggestedAuthorMode = useAuthorWorkModeStore((state) => state.syncSuggestedMode)
  const resetAuthorModeToAuto = useAuthorWorkModeStore((state) => state.resetToAuto)

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
  const assetScaleInput = useMemo(() => ({
    launchMode: currentNovel?.launchMode,
    targetWords: currentNovel?.targetWords,
    settingsJson: currentNovel?.settingsJson,
    mapDepth: worldRules.mapBlueprint.levels.length,
    factionCount: worldRules.factionSystem.length,
    speciesCount: worldRules.speciesSystem.length,
    powerSystemCount: worldRules.powerSystems.length,
  }), [
    currentNovel?.launchMode,
    currentNovel?.settingsJson,
    currentNovel?.targetWords,
    worldRules.factionSystem.length,
    worldRules.mapBlueprint.levels.length,
    worldRules.powerSystems.length,
    worldRules.speciesSystem.length,
  ])
  const characterPreset = useMemo(
    () => getCharacterBatchPreset(currentNovel?.genreName, speciesOptions, assetScaleInput),
    [assetScaleInput, currentNovel?.genreName, speciesOptions],
  )
  const itemProfile = useMemo(
    () => getItemGenerationProfile(currentNovel?.genreName, assetScaleInput),
    [assetScaleInput, currentNovel?.genreName],
  )
  const timelineGenerationPreset = useMemo(
    () => getTimelineGenerationPreset(currentNovel?.genreName, assetScaleInput),
    [assetScaleInput, currentNovel?.genreName],
  )
  const threadGenerationPreset = useMemo(
    () => getStoryThreadGenerationPreset(currentNovel?.genreName, assetScaleInput),
    [assetScaleInput, currentNovel?.genreName],
  )
  const assetBloat = useMemo(() => getAssetBloatSignal(stats), [stats])

  const refreshWorkflowContext = useCallback(async () => {
    const [nextNovel, nextStats] = await Promise.all([
      window.electron.novel.get(novelId),
      loadWorkflowStats(novelId),
    ])

    if (nextNovel) {
      setCurrentNovel(nextNovel)
    }

    setStats(nextStats)

    return {
      novel: nextNovel,
      stats: nextStats,
    }
  }, [novelId, setCurrentNovel])

  const refreshDiagnostics = useCallback(async () => {
    const [report, nextContextStatus, nextQualitySummary] = await Promise.all([
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getContextStatus(novelId),
      window.electron.quality.getDashboard(novelId).then((result) => ({
        productionReadiness: result.productionReadiness,
        batchHealth: result.batchHealth,
        continuityHealth: result.continuityHealth,
      })).catch((error) => {
        console.warn('Failed to load guide quality summary', error)
        return null
      }),
    ])
    setConsistencyReport(report)
    setContextStatus(nextContextStatus)
    setQualitySummary(nextQualitySummary)
  }, [novelId])

  useEffect(() => {
    void Promise.all([refreshWorkflowContext(), refreshDiagnostics()])
  }, [refreshDiagnostics, refreshWorkflowContext])

  const syncWorldRulesCore = useCallback(async () => {
    const normalized = parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName)
    await window.electron.novel.update(novelId, {
      worldRulesJson: stringifyWorldRules(normalized),
    })

    const updated = await window.electron.novel.get(novelId)
    if (updated) setCurrentNovel(updated)
  }, [currentNovel?.genreName, currentNovel?.worldRulesJson, novelId, setCurrentNovel])

  const generateMapCore = useCallback(async () => {
    const layerCounts = scaleMapLayerCounts(
      [...worldRules.mapBlueprint.levels].sort((left, right) => left.depth - right.depth),
      currentNovel?.genreName,
      assetScaleInput,
    )
      .sort((left, right) => left.depth - right.depth)
      .map((level) => level.suggestedCount)

    await window.electron.map.batchGenerate(novelId, {
      layerCounts,
      parentBatchSize: 1,
    })
  }, [assetScaleInput, currentNovel?.genreName, novelId, worldRules.mapBlueprint.levels])

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
      specialRequirements: '人物必须继承题材、背景、势力、地图、现有物品装备和后续事件关系，避免只补数量。',
      batchSize: characterPreset.batchSize,
    })
  }, [characterPreset, factionOptions, novelId, stats.hasProtagonist])

  const generateItemsCore = useCallback(async () => {
    await window.electron.item.generate(novelId, {
      count: itemProfile.defaultBatch,
      templateOnly: false,
      refreshTemplates: true,
      batchSize: itemProfile.batchSize || 4,
      focus: 'Prioritize practical item circulation and concrete plot hooks before adding new instances.',
    })
  }, [itemProfile.batchSize, itemProfile.defaultBatch, novelId])

  const generateThreadsCore = useCallback(async () => {
    const result = await window.electron.thread.generate(novelId, {
      count: threadGenerationPreset.count,
      batchSize: threadGenerationPreset.batchSize,
      focus: threadGenerationPreset.focus,
    })

    if (result.createdCount <= 0) {
      throw new Error(result.warnings[0] || getUserFacingMessage('guide.threadGenerationEmpty'))
    }

    if (result.warnings.length > 0) {
      message.warning(getUserFacingMessage('guide.threadGeneratedWithWarnings', {
        createdCount: result.createdCount,
        warningCount: result.warnings.length,
      }))
    }
  }, [novelId, threadGenerationPreset])

  const generateStoryDesignCore = useCallback(async () => {
    const subplotCount = Math.max(8, Math.min(40, Math.round(threadGenerationPreset.count * 0.35)))
    const result = await window.electron.ai.generateCoreSettings({
      novelId,
      subplotCount,
      requirements: `故事设计必须建立在已经存在的世界规则、地图、人物、物品和线程基础上，不要再把背景底盘写成剧情本身。减少口号化和同模板输出。本轮按${threadGenerationPreset.scaleLabel}建议规划约 ${subplotCount} 条支线/副线。`,
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
  }, [currentNovel?.settingsJson, novelId, setCurrentNovel, threadGenerationPreset.count, threadGenerationPreset.scaleLabel])

  const generateOutlineCore = useCallback(async () => {
    await window.electron.outline.generateArcs(novelId)
  }, [novelId])

  const generateTimelineCore = useCallback(async () => {
    await window.electron.timeline.generate(novelId, {
      count: timelineGenerationPreset.count,
      batchSize: timelineGenerationPreset.batchSize,
      focus: timelineGenerationPreset.focus,
    })
  }, [novelId, timelineGenerationPreset])

  const runStep = useCallback(async (
    key: string,
    action: () => Promise<void>,
    successText: string,
  ) => {
    setRunningKey(key)

    try {
      await action()
      await Promise.all([refreshWorkflowContext(), refreshDiagnostics()])
      message.success(successText)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'guide.runFailed'))
    } finally {
      setRunningKey(null)
    }
  }, [refreshDiagnostics, refreshWorkflowContext])

  const ensureStepReady = useCallback(async (step: WorkflowRunnableStepKey) => {
    const workflowContext = await refreshWorkflowContext()
    const blockers = getWorkflowBlockers(step, workflowContext.novel, workflowContext.stats)

    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return false
    }

    return true
  }, [refreshWorkflowContext])

  const runGuardedStep = useCallback(async (
    step: WorkflowRunnableStepKey,
    action: () => Promise<void>,
    successText: string,
  ) => {
    const ready = await ensureStepReady(step)
    if (!ready) return
    await runStep(step, action, successText)
  }, [ensureStepReady, runStep])

  const syncWorldRules = useCallback(() => void runGuardedStep('world-rules', syncWorldRulesCore, getUserFacingMessage('guide.worldRulesSynced')), [runGuardedStep, syncWorldRulesCore])
  const generateMap = useCallback(() => void runGuardedStep('map', generateMapCore, getUserFacingMessage('guide.mapGenerated')), [generateMapCore, runGuardedStep])
  const generateCharacters = useCallback(() => void runGuardedStep('characters', generateCharactersCore, getUserFacingMessage('guide.charactersGenerated')), [generateCharactersCore, runGuardedStep])
  const generateItems = useCallback(() => void runGuardedStep('items', generateItemsCore, getUserFacingMessage('guide.itemsGenerated')), [generateItemsCore, runGuardedStep])
  const generateThreads = useCallback(() => void runGuardedStep('threads', generateThreadsCore, getUserFacingMessage('guide.threadsGenerated')), [generateThreadsCore, runGuardedStep])
  const generateOutline = useCallback(() => void runGuardedStep('outline', generateOutlineCore, getUserFacingMessage('guide.outlineGenerated')), [generateOutlineCore, runGuardedStep])
  const generateStoryDesign = useCallback(() => void runGuardedStep('story-design', generateStoryDesignCore, getUserFacingMessage('guide.storyDesignGenerated')), [generateStoryDesignCore, runGuardedStep])
  const generateTimeline = useCallback(() => void runGuardedStep('timeline', generateTimelineCore, getUserFacingMessage('guide.timelineGenerated')), [generateTimelineCore, runGuardedStep])

  const runPipeline = async () => {
    setRunningKey('pipeline')

    try {
      if (!(await ensureStepReady('world-rules'))) return
      await syncWorldRulesCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('map'))) return
      await generateMapCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('items'))) return
      await generateItemsCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('characters'))) return
      await generateCharactersCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('threads'))) return
      await generateThreadsCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('story-design'))) return
      await generateStoryDesignCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('outline'))) return
      await generateOutlineCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('timeline'))) return
      await generateTimelineCore()
      await Promise.all([refreshWorkflowContext(), refreshDiagnostics()])
      message.success(getUserFacingMessage('guide.pipelineSucceeded'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'guide.pipelineFailed'))
    } finally {
      setRunningKey(null)
    }
  }

  const recommendedCharacterCount = characterPreset.majorCount
    + characterPreset.antagonistCount
    + characterPreset.supportingCount
    + characterPreset.minorCount
  const staleChapterCount = contextStatus?.staleChapterCount || 0
  const staleCheckpointCount = contextStatus?.staleCheckpointCount || 0
  const staleAssetCount = contextStatus?.staleAssetCount || 0
  const staleAssetLabels = contextStatus?.staleAssetLabels || []
  const staleAssetTagList = getFreshnessTags(staleAssetLabels)
  const writingContractLabel = formatWritingContractTags(themeVoice.writingContractTags) || '待设定'
  const protagonistRelationCount = consistencyReport?.metrics.protagonistRelationCount || 0
  const styledRelationCount = consistencyReport?.metrics.styledRelationCount || 0
  const subtextRelationCount = consistencyReport?.metrics.subtextRelationCount || 0
  const ratedRelationCount = consistencyReport?.metrics.ratedRelationCount || 0
  const freshnessCards = contextStatus
    ? [
        {
          title: '章节同步',
          value: staleChapterCount > 0
            ? `${staleChapterCount} 章待同步`
            : contextStatus.totalChapterCount > 0
              ? `已同步到第 ${contextStatus.totalChapterCount} 章`
              : '尚未生成章节',
          desc: staleChapterCount > 0
            ? '最近的设定或结构变更已经影响现有章节承接。'
            : '当前正文与最新设定保持一致，可以继续推进。',
            hint: staleChapterCount > 0
              ? '这些章节需要回查。'
              : '继续批量生成前，不需要额外回补章节上下文。',
          tone: staleChapterCount > 0 ? 'stale' : 'ok',
          tags: [] as string[],
        },
        {
          title: '记忆检查点',
          value: staleCheckpointCount > 0 ? `${staleCheckpointCount} 份待刷新` : '检查点已同步',
          desc: staleCheckpointCount > 0
            ? '长期记忆检查点还是旧版本，后续大纲和正文会继续引用旧长程记忆。'
            : '长期记忆检查点已跟上当前设定，不会继续放大长程失忆。',
            hint: staleCheckpointCount > 0
              ? '这些检查点需要刷新。'
              : '可以直接继续推进后续编排和生成。',
          tone: staleCheckpointCount > 0 ? 'warn' : 'ok',
          tags: [] as string[],
        },
        {
          title: '资产校准',
          value: staleAssetCount > 0 ? `${staleAssetCount} 类待校准` : '资产状态最新',
          desc: staleAssetCount > 0
            ? '部分世界资产仍挂着旧设定，会持续污染后续时间轴、故事弧和正文。'
            : '关键世界资产没有发现明显的设定滞后。',
            hint: staleAssetCount > 0
              ? '这些资产需要处理。'
              : '当前资产可以继续支撑后续生成。',
          tone: staleAssetCount > 0 ? 'warn' : 'ok',
          tags: staleAssetCount > 0 ? staleAssetTagList : [],
        },
      ]
    : []
  const basicsReadyCount = [
    currentNovel?.title,
    currentNovel?.synopsis,
    currentNovel?.userBackground,
    currentNovel?.expandedBackground,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0).length

  const nextChapterReadiness = useMemo(() => getNextChapterReadiness(stats), [stats])

  const steps = useMemo<StepConfig[]>(() => [
    {
      key: 'basics',
      title: '项目总览',
      desc: '先固定书名、简介、背景和目标字数，让后续 AI 生成始终有同一组项目输入。',
      status: isBasicsReady(currentNovel) ? '已填写' : '待补全',
      count: `${basicsReadyCount}/4`,
      support: isBasicsReady(currentNovel)
        ? '项目入口信息已经稳定，后续 Brief、设定和文风可以沿同一方向推进。'
        : '如果项目总览为空，后续每个模块都会反复猜题材、目标和故事边界。',
      ready: isBasicsReady(currentNovel),
      icon: <EditOutlined />,
      action: (
        <Button type="primary" ghost icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/overview`)}>
          打开总览
        </Button>
      ),
    },
    {
      key: 'project-brief',
      title: '项目 Brief',
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
      key: 'story-core',
      title: '故事底盘',
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
      title: '主题文风',
      desc: '维护主题、情感核心、叙事视角、时态、风格规则和对白规则。',
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
      key: 'world-foundation',
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
      key: 'map-structure',
      title: '地图落点',
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
      key: 'items-equipment',
      title: '资源道具',
      desc: '先生成符合题材的模板，再把具体物品挂到人物、地点和事件上，避免后期凭空补道具。',
      status: stats.itemCount > 0 ? '已生成' : '待生成',
      count: `${stats.itemCount} 条物品记录`,
      support: stats.itemCount > 0
        ? `当前题材的模板重心是“${itemProfile.title}”，会优先补齐常见流通链和剧情挂点。`
        : '先把物品模板和装备池铺出来，后面角色生成才能直接继承资源、装备和争夺目标。',
      ready: stats.itemCount > 0,
      icon: <ShoppingOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'items'} icon={<ShoppingOutlined />} onClick={generateItems}>
            AI 生成·首批物品
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/items`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'character-roster',
      title: '角色网络',
      desc: '建立在已有物品与装备基础上，按主角、主要人物、反派、功能角色和次要人物的配额先搭人物网，再逐个细修。',
      status: stats.characterCount > 0 ? '已生成' : '待生成',
      count: `${stats.characterCount} 位角色`,
      support: stats.characterCount > 0
        ? `当前题材建议优先补足这些功能位：${characterPreset.helperRoles.join('、')}。`
        : '先把物品资产准备好，再生成人物，职业、资源和冲突才能直接挂到现有装备与道具。',
      ready: stats.characterCount > 0,
      icon: <TeamOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'characters'} icon={<TeamOutlined />} onClick={generateCharacters}>
            AI 生成·批量角色
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/characters`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'resistance-system',
      title: '阻力系统',
      desc: '把反派、环境压力、制度压力和关系阻力登记成持续动作线，让剧情推进不靠临时制造冲突。',
      status: stats.resistanceTrackCount > 0 ? '已建立' : '待补齐',
      count: `${stats.resistanceTrackCount} 条阻力线`,
      support: stats.resistanceTrackCount > 0
        ? '阻力线已经能支撑主线、卷级闭环和章节冲突。'
        : '没有阻力系统，故事线程和大纲容易只列事件，缺少推动人物选择的压力。',
      ready: stats.resistanceTrackCount > 0,
      icon: <ThunderboltOutlined />,
      action: (
        <Button type="primary" ghost icon={<ThunderboltOutlined />} onClick={() => navigate(`/novels/${novelId}/resistance`)}>
          打开页面
        </Button>
      ),
    },
    {
      key: 'story-threads',
      title: '故事线程',
      desc: '把主线、支线、悬念、关系线和回收点钉成可追踪线程，后续大纲、时间轴和正文都围着这层推进。',
      status: stats.threadCount > 0 ? '已生成' : '待生成',
      count: `${stats.threadCount} 条线程`,
      support: stats.threadCount > 0
        ? '线程层已经能给大纲、时间轴和章节回收提供统一锚点。'
        : '没有线程层，后面的结构页和正文很容易断线，伏笔、关系线和回收点会越写越散。',
      ready: stats.threadCount > 0,
      icon: <BarsOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'threads'} icon={<BarsOutlined />} onClick={generateThreads}>
            AI 生成·首批线程
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/threads`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'story-plot',
      title: '主线骨架',
      desc: '等世界、地图、人物、物品和线程都到位后，再统一设计主线、支线和结局。',
      status: isStoryPlotReady(currentNovel) ? '已生成' : '待生成',
      count: `${storySettings.storyDesignReadyCount}/4`,
      support: isStoryPlotReady(currentNovel)
        ? '故事设计已经成型，接下来锁定终局，再压进卷级闭环和大纲。'
        : '这一步把主线目标、核心冲突、推进链和结局方向压成统一骨架，避免大纲从空白起步。',
      ready: isStoryPlotReady(currentNovel),
      icon: <BarsOutlined />,
      action: (
        <Space wrap>
          <Button loading={runningKey === 'story-design'} icon={<BarsOutlined />} onClick={generateStoryDesign}>
            AI 生成·首版设计
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/story-design`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'endgame-design',
      title: '终局承诺',
      desc: '提前锁定最终冲突、主题答案、兑现承诺和最后一幕，避免后期只会扩写不会收束。',
      status: isEndgameDesignReady(currentNovel) ? '已填写' : '待补全',
      count: `${storySettings.endgameReadyCount}/8`,
      support: isEndgameDesignReady(currentNovel)
        ? '终局收束已经有了明确落点，接下来卷级闭环和大纲可以围绕同一终点收束。'
        : '主线骨架已经成形，趁现在锁死终局，长篇越往后越不容易出现目标漂移、回收无力和结尾失焦。',
      ready: isEndgameDesignReady(currentNovel),
      icon: <BarsOutlined />,
      action: (
        <Button type="primary" ghost icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/endgame`)}>
          打开页面
        </Button>
      ),
    },
    {
      key: 'volume-planning',
      title: '卷级闭环',
      desc: '把第一卷目标、阶段代价、卷末爆点和承接钉住，给后续章纲和正文一个清晰落点。',
      status: stats.volumeCount > 0 ? '已建立' : '待补齐',
      count: `${stats.volumeCount} 卷`,
      support: stats.volumeCount > 0
        ? '卷级闭环已经能约束大纲和章节合同。'
        : '缺少卷级闭环时，正文通常能写开头，但后续目标、代价和爆点会失焦。',
      ready: stats.volumeCount > 0,
      icon: <BarsOutlined />,
      action: (
        <Button type="primary" ghost icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/volume-design`)}>
          打开页面
        </Button>
      ),
    },
    {
      key: 'outline-structure',
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
            AI 生成·首批故事弧
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/outline`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'timeline-causality',
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
            AI 生成·首批事件
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/timeline`)}>
            进入页面
          </Button>
        </Space>
      ),
    },
    {
      key: 'write-start',
      title: '首章生产',
      desc: '在人物、阻力、卷级、大纲、线程和时间轴都具备后，再进入章节合同和正文写作。',
      status: nextChapterReadiness.ready ? '可开写' : '待补前置',
      count: nextChapterReadiness.label,
      support: nextChapterReadiness.reason,
      ready: nextChapterReadiness.ready,
      icon: <EditOutlined />,
      action: (
        <Space wrap>
          <Button type="primary" ghost icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/contracts`)}>
            章节合同
          </Button>
          <Button type="link" onClick={() => navigate(`/novels/${novelId}/writing/editor`)}>
            正文写作
          </Button>
        </Space>
      ),
    },
    {
      key: 'revision',
      title: '修订中心',
      desc: '把一致性问题、待同步章节和人工修订任务集中到一个入口，避免问题散落在各页。',
      status: stats.revisionTaskCount > 0 ? '待处理' : '已稳定',
      count: stats.revisionTaskCount > 0 ? `${stats.revisionTaskCount} 条待处理` : '已收口',
      support: stats.revisionTaskCount > 0
        ? '先在这里清掉待同步章节、上下文影响和人工确认项，再继续正文会更稳。'
        : '当前链路没有待修订阻塞，可以回到正文推进或继续补强关键资产。',
      ready: stats.revisionTaskCount <= 0,
      icon: <EditOutlined />,
      action: (
        <Button type="primary" ghost icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/revision`)}>
          打开修订中心
        </Button>
      ),
    },
  ], [basicsReadyCount, characterPreset.helperRoles, currentNovel, factionOptions.length, generateCharacters, generateItems, generateMap, generateOutline, generateStoryDesign, generateThreads, generateTimeline, itemProfile.title, navigate, nextChapterReadiness, novelId, projectBrief.readyCount, runningKey, speciesOptions.length, stats, storySettings.endgameReadyCount, storySettings.premiseReadyCount, storySettings.storyDesignReadyCount, syncWorldRules, themeVoice.readyCount])

  const structureReadyCount = steps.filter((step) => step.ready).length
  const nextStep = steps.find((step) => !step.ready) || null
  const pendingSteps = steps.filter((step) => !step.ready)
  const queuedSteps = pendingSteps.slice(1, 4)
  const suggestedAuthorMode = useMemo(
    () => resolveSuggestedAuthorWorkMode(currentNovel, stats, qualitySummary),
    [currentNovel, qualitySummary, stats],
  )
  const selectedAuthorMode: AuthorWorkMode = authorMode || suggestedAuthorMode.mode
  const authorWorkflow = useMemo(
    () => buildAuthorWorkflowSummary(currentNovel, stats, qualitySummary, selectedAuthorMode),
    [currentNovel, qualitySummary, selectedAuthorMode, stats],
  )

  useEffect(() => {
    syncSuggestedAuthorMode(suggestedAuthorMode.mode)
  }, [suggestedAuthorMode.mode, syncSuggestedAuthorMode])

  const workflowPhases = useMemo(() => ([
    ...GUIDED_WORKFLOW_PHASES,
    {
      key: 'revision-quality',
      title: '修订质检',
      summary: '清理阻塞、上下文同步和质量问题，再继续扩写或批量推进。',
      stepKeys: ['revision'],
    },
  ] as const), [])

  const currentPhaseKey = useMemo(() => (
    workflowPhases.find((phase) => phase.stepKeys.some((stepKey) => !steps.find((step) => step.key === stepKey)?.ready))?.key
      || workflowPhases[workflowPhases.length - 1].key
  ), [steps, workflowPhases])

  const phaseCollapseItems = useMemo<NonNullable<CollapseProps['items']>>(() => workflowPhases.map((phase) => {
    const phaseSteps = phase.stepKeys
      .map((stepKey) => steps.find((step) => step.key === stepKey) || null)
      .filter((step): step is StepConfig => Boolean(step))
    const readyCount = phaseSteps.filter((step) => step.ready).length
    const isCurrentPhase = phase.key === currentPhaseKey

    return {
      key: phase.key,
      label: (
        <div className="novel-guide-page__phase-head">
          <div className="novel-guide-page__phase-copy">
            <strong>{phase.title}</strong>
            <span className="novel-guide-page__phase-summary">{phase.summary}</span>
          </div>
          <div className="novel-guide-page__phase-tags">
            <Tag color={readyCount >= phaseSteps.length ? 'success' : isCurrentPhase ? 'processing' : 'default'}>
              {readyCount >= phaseSteps.length ? '已完成' : isCurrentPhase ? '当前阶段' : '后续阶段'}
            </Tag>
            <Tag color="blue">{`${readyCount}/${phaseSteps.length}`}</Tag>
          </div>
        </div>
      ),
      children: (
        <div className="novel-stage-grid">
          {phaseSteps.map((step) => (
            <div key={step.key} className={`novel-stage-card ${step.ready ? 'novel-stage-card--ready' : ''}`}>
              <div className="novel-stage-card__header">
                <div>
                  <div className="novel-stage-card__title">
                    {step.icon}
                    {step.title}
                  </div>
                  <div className="novel-guide-page__step-desc">
                    {step.desc}
                  </div>
                </div>
                <div className="novel-stage-card__meta">
                  <Tag color={step.ready ? 'success' : 'default'}>{step.status}</Tag>
                  <Tag color="blue">{step.count}</Tag>
                </div>
              </div>
              <div className="novel-guide-page__step-support">
                {step.support}
              </div>
              <div className="novel-stage-card__actions">{step.action}</div>
            </div>
          ))}
        </div>
      ),
    }
  }), [currentPhaseKey, steps, workflowPhases])

  return (
    <WorkspacePage
      className="novel-guide novel-guide--single"
      layout="wide"
      eyebrow="创作工作流"
      title="创作向导"
      description="按项目底盘、世界地点、人物阵营、剧情伏笔、卷章大纲、正文生产和回写质检推进。"
      actions={(
        <Space wrap>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => navigate(resolveAuthorWorkflowHref(novelId, authorWorkflow.primaryTask.entryPage))}
          >
            {authorWorkflow.primaryTask.actionLabel}
          </Button>
          <Button
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
            { label: '开书路径', value: currentNovel?.launchMode === 'fast_launch' ? '极速开书' : '专业长篇' },
            { label: '流程完成度', value: `${structureReadyCount}/${steps.length} 步就绪` },
            {
              label: '时间制度',
              value: TIME_MODE_LABELS[worldRules.timelineConfig.calendarType] || worldRules.timelineConfig.calendarType,
            },
            { label: '待同步章节', value: staleChapterCount > 0 ? `${staleChapterCount} 章` : '全部最新' },
            { label: '记忆检查点', value: staleCheckpointCount > 0 ? `${staleCheckpointCount} 份待刷新` : '已同步' },
            { label: '资产新鲜度', value: staleAssetCount > 0 ? `${staleAssetCount} 类待校准` : '资产稳定' },
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
            label="写作类型"
            value={writingContractLabel}
            tone="cool"
            hint="先钉整本书的阅读预期，再让节奏和对白跟着走"
          />
          <WorkspaceMetric
            label="故事线程"
            value={stats.threadCount}
            tone="cool"
            hint="后续结构页、时间轴和正文都应回查这些线程"
          />
          <WorkspaceMetric
            label="下一章状态"
            value={nextChapterReadiness.label}
            tone={nextChapterReadiness.ready ? 'cool' : 'warm'}
          />
          <WorkspaceMetric
            label="修订任务"
            value={stats.revisionTaskCount}
            hint={stats.revisionTaskCount > 0 ? '建议开写前先处理未闭环问题' : '当前链路没有待修订阻塞'}
          />
        </>
      )}
      aside={(
        <>
          {contextStatus && (
            <WorkspacePanel
              title="上下文同步"
            >
              <div className="novel-freshness-meta">
                <span>{`当前上下文版本 v${contextStatus.contextVersion}`}</span>
                <span>{contextStatus.totalChapterCount > 0 ? `已纳入 ${contextStatus.totalChapterCount} 章正文` : '尚未生成正文章节'}</span>
              </div>
              <div className="novel-freshness-grid">
                {freshnessCards.map((card) => (
                  <section key={card.title} className={`novel-freshness-card novel-freshness-card--${card.tone}`}>
                    <div className="novel-freshness-card__title">{card.title}</div>
                    <strong className="novel-freshness-card__value">{card.value}</strong>
                    <div className="novel-freshness-card__desc">{card.desc}</div>
                    {card.tags.length > 0 ? (
                      <div className="novel-freshness-card__tags">
                        {card.tags.map((tag) => (
                          <span key={`${card.title}-${tag}`} className="novel-freshness-card__tag">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="novel-freshness-card__hint">{card.hint}</div>
                  </section>
                ))}
              </div>
            </WorkspacePanel>
          )}

          {consistencyReport && (
            <WorkspacePanel title="结构体检">
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
                <div className="novel-note-list__item">{`写作类型标签：${consistencyReport.metrics.writingContractTagCount} 个`}</div>
                <div className="novel-note-list__item">{`主角关键关系：${protagonistRelationCount} 条，已写互动方式 ${styledRelationCount} 条`}</div>
                <div className="novel-note-list__item">{`已写潜台词：${subtextRelationCount} 条，已写强弱等级：${ratedRelationCount} 条`}</div>
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
        />
      )}

      {contextStatus && contextStatus.staleCheckpointCount > 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message={`有 ${contextStatus.staleCheckpointCount} 份长期记忆检查点待刷新`}
        />
      )}

      {contextStatus && contextStatus.staleAssetCount > 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message={`这些世界资产可能还挂着旧设定：${contextStatus.staleAssetLabels.join('、')}`}
        />
      )}

      {assetBloat.risk !== 'none' && (
        <Alert
          className="novel-guide__alert"
          type={assetBloat.risk === 'high' ? 'warning' : 'info'}
          showIcon
          message={assetBloat.risk === 'high' ? '首章前资产已经开始膨胀' : '当前资产增长过快'}
          action={(
            <Button size="small" onClick={() => navigate(`/novels/${novelId}/${stats.outlineCount > 0 ? 'writing' : 'outline'}`)}>
              {stats.outlineCount > 0 ? '直接开写' : '先整理成大纲'}
            </Button>
          )}
        />
      )}

      {consistencyReport && consistencyReport.highCount > 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message="当前存在高优先级结构冲突"
        />
      )}

      {consistencyReport && consistencyReport.metrics.writingContractTagCount <= 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message="整本书还没有设定写作类型"
        />
      )}

      {consistencyReport && protagonistRelationCount <= 0 && (
        <Alert
          className="novel-guide__alert"
          type="warning"
          showIcon
          message="主角还没有关键人物关系"
        />
      )}

      {(!isProjectBriefReady(currentNovel) || !isThemeVoiceReady(currentNovel)) && (
        <Alert
          className="novel-guide__alert"
          type="info"
          showIcon
          message="项目定位和文风还没有定好"
        />
      )}

      <WorkspacePanel
        title="作者工作模式"
        extra={<div className="novel-pill">{authorModeSource === 'manual' ? '手动选择' : '系统推荐'}</div>}
      >
        <div className="novel-guide-page__section-stack">
          <div className="novel-guide-page__mode-reason">{authorWorkflow.modeReason}</div>
          <div className="novel-guide-page__mode-row">
            {(['quick_start', 'asset_building', 'daily_push', 'revision_closure'] as AuthorWorkMode[]).map((mode) => (
              <Button
                key={mode}
                type={selectedAuthorMode === mode ? 'primary' : 'default'}
                ghost={selectedAuthorMode !== mode}
                onClick={() => setManualAuthorMode(mode)}
              >
                {getAuthorWorkModeLabel(mode)}
              </Button>
            ))}
            {authorModeSource === 'manual' ? (
              <Button onClick={() => resetAuthorModeToAuto(suggestedAuthorMode.mode)}>
                恢复系统推荐
              </Button>
            ) : null}
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        title="今天最该做什么"
        extra={<div className="novel-pill">{`${authorWorkflow.primaryTask.estimatedMinutes} 分钟`}</div>}
      >
        <div className="novel-guide-page__section-stack">
          <div className="guided-step__action-card">
            <div className="guided-step__action-head">
              <div className="guided-step__action-copy">
                <strong>{authorWorkflow.primaryTask.title}</strong>
                <span>{authorWorkflow.primaryTask.reason}</span>
              </div>
              <Button type="primary" onClick={() => navigate(resolveAuthorWorkflowHref(novelId, authorWorkflow.primaryTask.entryPage))}>
                {authorWorkflow.primaryTask.actionLabel}
              </Button>
            </div>
          </div>

          {authorWorkflow.alternateTasks.length > 0 ? (
            <div className="guided-step__action-grid">
              {authorWorkflow.alternateTasks.map((task) => (
                <div key={task.id} className="guided-step__action-card">
                  <div className="guided-step__action-copy">
                    <strong>{task.title}</strong>
                    <span>{task.reason}</span>
                  </div>
                  <Button onClick={() => navigate(resolveAuthorWorkflowHref(novelId, task.entryPage))}>
                    {task.actionLabel}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {authorWorkflow.blockers.length > 0 ? (
            <div className="novel-issue-list">
              {authorWorkflow.blockers.map((blocker) => (
                <div key={blocker.id} className="novel-issue-item">
                  <div className="novel-issue-item__head">
                    <Tag color={getSeverityColor(blocker.severity)}>{getSeverityLabel(blocker.severity)}</Tag>
                    <strong>{blocker.title}</strong>
                  </div>
                  <div className="novel-issue-item__desc">{blocker.reason}</div>
                  <Button size="small" onClick={() => navigate(resolveAuthorWorkflowHref(novelId, blocker.entryPage))}>
                    {blocker.actionLabel}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {authorWorkflow.impactNotices.length > 0 ? (
            <div className="novel-note-list">
              {authorWorkflow.impactNotices.map((notice) => (
                <div key={notice.id} className="novel-note-list__item">{`${notice.title}：${notice.reason}`}</div>
              ))}
            </div>
          ) : null}
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        title="完整创作链路"
        extra={<div className="novel-pill">{nextChapterReadiness.label}</div>}
      >
        <div className="novel-guide__flow-head">
          <div className="novel-guide__flow-lead">
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
        </div>
        <Collapse defaultActiveKey={[currentPhaseKey]} items={phaseCollapseItems} />
      </WorkspacePanel>

      {consistencyReport && (
        <WorkspacePanel
          title="全书级一致性校验器"
          extra={<div className="novel-pill">{`共发现 ${consistencyReport.issueCount} 个问题`}</div>}
        >
          <div className="novel-issue-mini-grid">
            <div className="novel-note-list__item">
              章节：{consistencyReport.metrics.chapterCount} 章，其中缺摘要 {consistencyReport.metrics.chaptersMissingSummary} 章，缺连续性记忆 {consistencyReport.metrics.chaptersMissingContinuity} 章。
            </div>
            <div className="novel-note-list__item">
              写作类型：{consistencyReport.metrics.writingContractTagCount} 个标签；主角关键关系 {protagonistRelationCount} 条。
            </div>
            <div className="novel-note-list__item">
              关系对白：已写互动方式 {styledRelationCount} 条，已写潜台词 {subtextRelationCount} 条，已写强弱等级 {ratedRelationCount} 条。
            </div>
            <div className="novel-note-list__item">
              时间轴：{consistencyReport.metrics.timelineCount} 个事件，已与章节/地点联动 {consistencyReport.metrics.linkedTimelineCount} 个。
            </div>
            <div className="novel-note-list__item">
              物品：{consistencyReport.metrics.itemCount} 条记录，双向联动完整 {consistencyReport.metrics.bidirectionalLinkCount} 条。
            </div>
          </div>

          <div className="novel-issue-list">
            {consistencyReport.issues.slice(0, 8).map((issue) => (
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
