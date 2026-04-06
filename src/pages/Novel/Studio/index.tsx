import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Progress, Space, Tag, message } from 'antd'
import {
  BarsOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FireOutlined,
  GlobalOutlined,
  RobotOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { NovelConsistencyReport, NovelContextStatus, RevisionCenterSnapshot, RevisionTask } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
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
  getWorkflowBlockers,
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

interface ReadinessCard {
  key: string
  title: string
  value: string
  summary: string
  ready: boolean
  route: string
}

interface StudioActionCard {
  key: WorkflowRunnableStepKey
  title: string
  eyebrow: string
  count: string
  summary: string
  ready: boolean
  icon: React.ReactNode
  run: () => Promise<void>
  route: string
}

function getIssueTagColor(severity: 'high' | 'medium' | 'low') {
  if (severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  return 'default'
}

function getIssueLabel(severity: 'high' | 'medium' | 'low') {
  if (severity === 'high') return '高优先'
  if (severity === 'medium') return '中优先'
  return '低优先'
}

function getStudioTone(score: number) {
  if (score >= 80) return '稳态'
  if (score >= 60) return '可推进'
  return '先修关键问题'
}

export default function StudioPage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [revisionSnapshot, setRevisionSnapshot] = useState<RevisionCenterSnapshot | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [taskActionKey, setTaskActionKey] = useState<string | null>(null)

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

  const refreshWorkflowContext = useCallback(async () => {
    const [nextNovel, nextStats] = await Promise.all([
      window.electron.novel.get(novelId),
      loadWorkflowStats(novelId),
    ])

    if (nextNovel) setCurrentNovel(nextNovel)
    setStats(nextStats)

    return {
      novel: nextNovel,
      stats: nextStats,
    }
  }, [novelId, setCurrentNovel])

  const refreshDiagnostics = useCallback(async () => {
    const [report, nextContextStatus, snapshot] = await Promise.all([
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getContextStatus(novelId),
      window.electron.revision.getSnapshot(novelId),
    ])

    setConsistencyReport(report)
    setContextStatus(nextContextStatus)
    setRevisionSnapshot(snapshot)
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
      await window.electron.character.generateProtagonist(novelId, { forceDifferentFromExisting: true })
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
      specialRequirements: '人物必须补剧情功能位，且与现有名字、冲突功能、关系站位明显区分。',
      batchSize: 6,
      diversityConstraints: [
        '姓名来源不要集中在同一套字面风格',
        '功能位不能重复',
        '核心恐惧、利益立场和关系张力不能批量同质化',
      ],
    })
  }, [characterPreset, factionOptions, novelId, stats.hasProtagonist])

  const generateItemsCore = useCallback(async () => {
    await window.electron.item.generate(novelId, {
      count: itemProfile.defaultBatch,
      templateOnly: false,
      refreshTemplates: true,
      batchSize: 4,
      focus: '优先生成能绑定人物、地点、事件和资源流转的具体物品，避免纯装饰道具。',
    })
  }, [itemProfile.defaultBatch, novelId])

  const generateThreadsCore = useCallback(async () => {
    const result = await window.electron.thread.generate(novelId, {
      count: 8,
      batchSize: 4,
      focus: '优先补主线压力、关系拉扯、悬念回收和结局回响，避免功能重复。',
    })

    if (result.createdCount <= 0) {
      throw new Error(result.warnings[0] || getUserFacingMessage('studio.threadGenerationEmpty'))
    }
  }, [novelId])

  const generateStoryDesignCore = useCallback(async () => {
    const result = await window.electron.ai.generateCoreSettings({
      novelId,
      subplotCount: 8,
      requirements: '故事设计必须建立在已有世界规则、地图、人物、物品和线程之上，减少重复模板与空泛口号。',
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
      focus: '优先围绕主角、关键地点、关键物品和主要冲突生成可回查的事件链。',
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
      await Promise.all([refreshWorkflowContext(), refreshDiagnostics()])
      message.success(successText)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'studio.runFailed'))
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

  const runPipeline = useCallback(async () => {
    setRunningKey('pipeline')

    try {
      if (!(await ensureStepReady('world-rules'))) return
      await syncWorldRulesCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('map'))) return
      await generateMapCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('characters'))) return
      await generateCharactersCore()
      await refreshWorkflowContext()
      if (!(await ensureStepReady('items'))) return
      await generateItemsCore()
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
      message.success(getUserFacingMessage('studio.pipelineSucceeded'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'studio.pipelineFailed'))
    } finally {
      setRunningKey(null)
    }
  }, [
    ensureStepReady,
    generateCharactersCore,
    generateItemsCore,
    generateMapCore,
    generateOutlineCore,
    generateStoryDesignCore,
    generateThreadsCore,
    generateTimelineCore,
    refreshDiagnostics,
    refreshWorkflowContext,
    syncWorldRulesCore,
  ])

  const systemIssueTasks = useMemo(() => (
    (revisionSnapshot?.tasks || [])
      .filter((task) => task.taskSource === 'system' && task.status !== 'resolved' && task.status !== 'ignored')
      .slice(0, 6)
  ), [revisionSnapshot])

  const openRelatedTaskPage = useCallback((task: RevisionTask) => {
    navigate(`/novels/${novelId}/${task.relatedPage || 'revision'}`)
  }, [navigate, novelId])

  const handleTaskStatus = useCallback(async (task: RevisionTask, status: RevisionTask['status']) => {
    setTaskActionKey(`status:${task.id}:${status}`)
    try {
      await window.electron.revision.update(task.id, { status })
      await refreshDiagnostics()
      message.success(getUserFacingMessage(
        status === 'ignored'
          ? 'revision.statusIgnored'
          : status === 'open'
            ? 'revision.statusReopened'
            : 'revision.statusUpdated',
      ))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'revision.statusUpdateFailed'))
    } finally {
      setTaskActionKey(null)
    }
  }, [refreshDiagnostics])

  const handleAutoFixTask = useCallback(async (task: RevisionTask) => {
    setTaskActionKey(`autofix:${task.id}`)
    try {
      const result = await window.electron.revision.autoFix(task.id)
      await refreshDiagnostics()
      if (result.status === 'unsupported') {
        message.warning(result.message)
        if (result.relatedPage) {
          navigate(`/novels/${novelId}/${result.relatedPage}`)
        }
        return
      }
      if (result.status === 'failed') {
        message.error(result.message)
        return
      }
      message.success(result.message)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'revision.autofixFailed'))
    } finally {
      setTaskActionKey(null)
    }
  }, [navigate, novelId, refreshDiagnostics])

  const readinessCards = useMemo<ReadinessCard[]>(() => ([
    {
      key: 'brief',
      title: '项目立项',
      value: `${projectBrief.readyCount}/6`,
      summary: projectBrief.readerPromise || '先钉读者承诺、赛道和禁区。',
      ready: isProjectBriefReady(currentNovel),
      route: 'project-brief',
    },
    {
      key: 'premise',
      title: '基础设定',
      value: `${storySettings.premiseReadyCount}/5`,
      summary: storySettings.premise.constraints || '主角起点和底层约束还没收紧。',
      ready: isStoryCoreReady(currentNovel),
      route: 'core-settings',
    },
    {
      key: 'voice',
      title: '主题与文风',
      value: `${themeVoice.readyCount}/6`,
      summary: themeVoice.styleRules || '先把主题、时态、视角和禁写规则写成硬边界。',
      ready: isThemeVoiceReady(currentNovel),
      route: 'theme-voice',
    },
    {
      key: 'design',
      title: '故事设计',
      value: `${storySettings.storyDesignReadyCount}/4`,
      summary: storySettings.storyDesign.mainPlot || '目标、冲突、推进链和结局还未闭合。',
      ready: isStoryPlotReady(currentNovel),
      route: 'story-design',
    },
  ]), [currentNovel, projectBrief, storySettings, themeVoice])

  const actionCards = useMemo<StudioActionCard[]>(() => ([
    {
      key: 'world-rules',
      title: '同步世界规则',
      eyebrow: '故事底盘',
      count: `${speciesOptions.length} 种族 / ${factionOptions.length} 势力`,
      summary: '统一题材规则、势力结构、地图蓝图和时间制度，后面的角色与事件都从这里取口径。',
      ready: Boolean(currentNovel?.worldRulesJson),
      icon: <GlobalOutlined />,
      run: syncWorldRulesCore,
      route: 'world-rules',
    },
    {
      key: 'map',
      title: '铺地图骨架',
      eyebrow: '资产图谱',
      count: `${stats.mapCount} 个地点节点`,
      summary: '先给角色和事件真实落点，减少“空气里推进剧情”。',
      ready: stats.mapCount > 0,
      icon: <EnvironmentOutlined />,
      run: generateMapCore,
      route: 'map',
    },
    {
      key: 'characters',
      title: '生成人物网络',
      eyebrow: '人物系统',
      count: `${stats.characterCount} 人 / 主角${stats.hasProtagonist ? '已建' : '未建'}`,
      summary: '优先补功能位、对立位和关系张力，严格避开已拒绝方案和撞名结果。',
      ready: stats.characterCount > 0 && stats.hasProtagonist,
      icon: <TeamOutlined />,
      run: generateCharactersCore,
      route: 'characters',
    },
    {
      key: 'items',
      title: '补物品资产',
      eyebrow: '资产图谱',
      count: `${stats.itemCount} 个物品`,
      summary: '道具必须可追踪、可绑定、可回收，不能只是装饰性的“神奇物件”。',
      ready: stats.itemCount > 0,
      icon: <ShoppingOutlined />,
      run: generateItemsCore,
      route: 'items',
    },
    {
      key: 'threads',
      title: '挂故事线程',
      eyebrow: '结构推进',
      count: `${stats.threadCount} 条线程`,
      summary: '把主线、支线、悬念和关系推进写成可回查对象，不让后续正文失忆。',
      ready: stats.threadCount > 0,
      icon: <BarsOutlined />,
      run: generateThreadsCore,
      route: 'threads',
    },
    {
      key: 'story-design',
      title: '收主线设计',
      eyebrow: '结构推进',
      count: `${storySettings.storyDesignReadyCount}/4`,
      summary: '在世界、人物、物品、线程齐备后再统一主线设计，避免空想式剧情。',
      ready: isStoryPlotReady(currentNovel),
      icon: <CompassOutlined />,
      run: generateStoryDesignCore,
      route: 'story-design',
    },
    {
      key: 'outline',
      title: '拆故事弧',
      eyebrow: '长篇推进',
      count: `${stats.outlineCount} 条故事弧`,
      summary: '把长篇推进拆成稳定的结构骨架，为卷章规划和正文铺路。',
      ready: stats.outlineCount > 0,
      icon: <EditOutlined />,
      run: generateOutlineCore,
      route: 'outline',
    },
    {
      key: 'timeline',
      title: '补时间轴',
      eyebrow: '长篇推进',
      count: `${stats.timelineCount} 个事件`,
      summary: '让谁在何时何地做了什么可以回查，压低长篇中段跑偏概率。',
      ready: stats.timelineCount > 0,
      icon: <ClockCircleOutlined />,
      run: generateTimelineCore,
      route: 'timeline',
    },
  ]), [
    currentNovel,
    factionOptions.length,
    generateCharactersCore,
    generateItemsCore,
    generateMapCore,
    generateOutlineCore,
    generateStoryDesignCore,
    generateThreadsCore,
    generateTimelineCore,
    speciesOptions.length,
    stats,
    storySettings.storyDesignReadyCount,
    syncWorldRulesCore,
  ])

  const nextAction = actionCards.find((card) => !card.ready) || null
  const readyReadinessCount = readinessCards.filter((card) => card.ready).length
  const nextReadinessCard = readinessCards.find((card) => !card.ready) || null
  const readinessPercent = Math.round((actionCards.filter((card) => card.ready).length / Math.max(actionCards.length, 1)) * 100)
  const storyBibleScore = Math.round((
    projectBrief.readyCount
    + themeVoice.readyCount
    + storySettings.premiseReadyCount
    + storySettings.storyDesignReadyCount
  ) / 21 * 100)

  return (
    <WorkspacePage
      className="studio-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="小说总控台"
      title="底盘、资产与质量统一编排"
      description="统一查看底盘完成度、资产生成状态和质量风险。"
      actions={(
        <Space wrap>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={runningKey === 'pipeline'}
            onClick={() => void runPipeline()}
          >
            运行首版骨架编排
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => navigate(`/novels/${novelId}/${nextAction?.route || 'writing'}`)}>
            {nextAction ? `处理下一步：${nextAction.title}` : '进入正文写作'}
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '当前焦点', value: nextAction?.title || '转入写作与修订' },
            { label: '主角状态', value: stats.hasProtagonist ? '已建立' : '待建立' },
            { label: '待同步章节', value: contextStatus?.staleChapterCount ? `${contextStatus.staleChapterCount} 章` : '无' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="故事底盘" value={`${storyBibleScore}%`} tone="warm" hint="项目立项、基础设定、主题文风、故事设计的综合完成度" />
          <WorkspaceMetric label="资产图谱" value={stats.mapCount + stats.characterCount + stats.itemCount + stats.threadCount + stats.timelineCount} tone="cool" hint="地点、人物、物品、线程、时间轴总数" />
          <WorkspaceMetric label="结构体检" value={consistencyReport ? `${consistencyReport.readinessScore} 分` : '加载中'} hint={consistencyReport ? getStudioTone(consistencyReport.readinessScore) : '正在分析全书健康度'} />
          <WorkspaceMetric label="编排进度" value={`${readinessPercent}%`} hint={`${actionCards.filter((card) => card.ready).length}/${actionCards.length} 个关键环节已就绪`} />
        </>
      )}
      aside={(
        <>
          <WorkspacePanel title="质量控制台" description="当前最值得优先处理的问题。">
            <div className="studio-health-card">
              <div className="studio-health-card__score">
                <strong>{consistencyReport?.readinessScore ?? '--'}</strong>
                <span>{consistencyReport ? getStudioTone(consistencyReport.readinessScore) : '分析中'}</span>
              </div>
              <div className="studio-health-card__stats">
                <div><strong>{consistencyReport?.highCount ?? 0}</strong><span>高优先</span></div>
                <div><strong>{consistencyReport?.mediumCount ?? 0}</strong><span>中优先</span></div>
                <div><strong>{consistencyReport?.lowCount ?? 0}</strong><span>低优先</span></div>
              </div>
            </div>

            <div className="studio-note-list">
              {contextStatus?.staleChapterCount
                ? <div className="studio-note-list__item">{`有 ${contextStatus.staleChapterCount} 章正文仍挂着旧上下文，建议在继续量产前先修订。`}</div>
                : <div className="studio-note-list__item">正文与最新设定基本保持同步，可以继续推进。</div>}
              {(consistencyReport?.focusAreas || []).slice(0, 3).map((focus) => (
                <div key={focus} className="studio-note-list__item">{focus}</div>
              ))}
            </div>
          </WorkspacePanel>

          <WorkspacePanel title="工作台跳转" description="统一入口负责编排，细修仍在专业页完成。">
            <div className="studio-link-stack">
              {[
                ['project-brief', '项目立项'],
                ['world-rules', '世界规则'],
                ['characters', '角色系统'],
                ['threads', '故事线程'],
                ['timeline', '时间轴'],
                ['writing', '正文写作'],
              ].map(([route, label]) => (
                <button
                  key={route}
                  type="button"
                  className="studio-link-button"
                  onClick={() => navigate(`/novels/${novelId}/${route}`)}
                >
                  <span>{label}</span>
                  <CheckCircleOutlined />
                </button>
              ))}
            </div>
          </WorkspacePanel>
        </>
      )}
    >
      {contextStatus?.staleChapterCount ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message={`有 ${contextStatus.staleChapterCount} 章正文仍未同步到最新设定`}
          description="如果继续批量生成，旧上下文会继续放大问题。建议先去修订中心或正文页处理这些章节。"
        />
      ) : null}

      {consistencyReport && consistencyReport.highCount > 0 ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message="结构体检发现高优先风险"
          description="这不一定阻止你继续创作，但会显著提高后续时间轴、正文和人物设定的冲突概率。"
        />
      ) : null}

      <WorkspacePanel
        title="故事底盘"
        description="先确认立项、设定、文风和主线设计是否收口。"
        extra={<div className="studio-panel-pill">{`完成 ${readyReadinessCount}/${readinessCards.length}`}</div>}
      >
        <div className="studio-bible-board">
          <section className="studio-bible-overview">
            <div className="studio-bible-overview__eyebrow">底盘完成度</div>
            <strong className="studio-bible-overview__score">{storyBibleScore}%</strong>
            <Progress percent={storyBibleScore} showInfo={false} strokeColor="#bc6c25" trailColor="rgba(24, 40, 58, 0.12)" />
            <p className="studio-bible-overview__copy">项目立项、基础设定、主题文风和故事设计的综合完成度。</p>
            <div className="studio-bible-overview__focus">
              <span>当前短板</span>
              <strong>{nextReadinessCard?.title || '底盘已齐'}</strong>
              <small>{nextReadinessCard?.summary || '可以转入资产生成或质量修订。'}</small>
            </div>
          </section>

          <div className="studio-readiness-grid studio-readiness-grid--dense">
            {readinessCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={`studio-readiness-card ${card.ready ? 'studio-readiness-card--ready' : ''}`}
                onClick={() => navigate(`/novels/${novelId}/${card.route}`)}
              >
                <div className="studio-readiness-card__head">
                  <span>{card.title}</span>
                  <Tag color={card.ready ? 'success' : 'default'}>{card.ready ? '已就绪' : '待补齐'}</Tag>
                </div>
                <strong>{card.value}</strong>
                <p className="studio-readiness-card__summary">{card.summary}</p>
                <div className="studio-readiness-card__foot">{card.ready ? '继续细化' : '立即补齐'}</div>
              </button>
            ))}
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        title="编排动作"
        description="先跑最缺的那一步，也可以直接逐项修。每个动作都带着真实前置依赖，不会盲目乱跑。"
        extra={nextAction ? <div className="studio-panel-pill studio-panel-pill--warm">{`推荐下一步：${nextAction.title}`}</div> : null}
      >
        <div className="studio-action-grid">
          {actionCards.map((card) => (
            <section key={card.key} className={`studio-action-card ${card.ready ? 'studio-action-card--ready' : ''}`}>
              <div className="studio-action-card__top">
                <div className="studio-action-card__eyebrow">{card.eyebrow}</div>
                <div className="studio-action-card__icon">{card.icon}</div>
              </div>
              <div className="studio-action-card__title-row">
                <h3>{card.title}</h3>
                <Tag color={card.ready ? 'success' : 'processing'}>{card.count}</Tag>
              </div>
              <p>{card.summary}</p>
              <div className="studio-action-card__footer">
                <Button
                  type={nextAction?.key === card.key ? 'primary' : 'default'}
                  loading={runningKey === card.key}
                  onClick={() => void runGuardedStep(card.key, card.run, `${card.title}完成。`)}
                >
                  {card.ready ? '重新生成' : '立即执行'}
                </Button>
                <Button type="link" onClick={() => navigate(`/novels/${novelId}/${card.route}`)}>
                  打开页内精修
                </Button>
              </div>
            </section>
          ))}
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="质量预警" description="把重复、逻辑断裂和上下文污染提前暴露，不要等到正文里才发现。">
        <div className="studio-quality-strip">
          <div className="studio-quality-strip__progress">
            <div className="studio-quality-strip__head">
              <strong>当前健康度</strong>
              <span>{consistencyReport ? `${consistencyReport.readinessScore}%` : '--'}</span>
            </div>
            <Progress percent={consistencyReport?.readinessScore || 0} showInfo={false} strokeColor="#bc6c25" trailColor="rgba(24, 40, 58, 0.12)" />
          </div>
          <div className="studio-quality-strip__badges">
            <Tag color={stats.hasProtagonist ? 'success' : 'warning'} icon={<TeamOutlined />}>
              {stats.hasProtagonist ? '主角已建立' : '主角缺失'}
            </Tag>
            <Tag color={stats.threadCount > 0 ? 'success' : 'warning'} icon={<BarsOutlined />}>
              {stats.threadCount > 0 ? '线程可追踪' : '线程缺失'}
            </Tag>
            <Tag color={stats.timelineCount > 0 ? 'success' : 'warning'} icon={<ClockCircleOutlined />}>
              {stats.timelineCount > 0 ? '时间轴已挂点' : '时间轴未建立'}
            </Tag>
            <Tag color={contextStatus?.staleChapterCount ? 'error' : 'success'} icon={<FireOutlined />}>
              {contextStatus?.staleChapterCount ? `上下文过期 ${contextStatus.staleChapterCount} 章` : '正文上下文稳定'}
            </Tag>
          </div>
        </div>

        <div className="studio-issue-list">
          {systemIssueTasks.map((task) => (
            <div key={task.id} className="studio-issue-card">
              <div className="studio-issue-card__head">
                <Tag color={getIssueTagColor(task.severity)}>{getIssueLabel(task.severity)}</Tag>
                <strong>{task.title}</strong>
              </div>
              <div className="studio-issue-card__desc">{task.description || '当前没有额外说明。'}</div>
              <div className="studio-issue-card__fix">{task.fixBrief || '建议前往对应页面处理。'}</div>
              <Space wrap style={{ marginTop: 12 }}>
                {task.autoFixable ? (
                  <Button
                    size="small"
                    type="primary"
                    loading={taskActionKey === `autofix:${task.id}`}
                    onClick={() => void handleAutoFixTask(task)}
                  >
                    AI 修复
                  </Button>
                ) : null}
                <Button size="small" onClick={() => openRelatedTaskPage(task)}>
                  打开页面
                </Button>
                <Button
                  size="small"
                  loading={taskActionKey === `status:${task.id}:ignored`}
                  onClick={() => void handleTaskStatus(task, 'ignored')}
                >
                  忽略
                </Button>
              </Space>
            </div>
          ))}
          {systemIssueTasks.length === 0 ? (
            <div className="studio-empty-state">当前没有未解决的系统问题，可以继续推进结构和正文。</div>
          ) : null}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
