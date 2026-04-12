import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Space, message } from 'antd'
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BarsOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import { useNovelStore } from '../../../stores/novel.store'
import { useWorkspaceStore } from '../../../stores/workspace.store'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import {
  EMPTY_WORKFLOW_STATS,
  getGuidedStepProgressMap,
  isBasicsReady,
  isCharacterRosterReady,
  isItemsEquipmentReady,
  isMapStructureReady,
  isProjectBriefReady,
  isStoryCoreReady,
  isStoryPlotReady,
  isStoryThreadsReady,
  isWorldFoundationReady,
  loadWorkflowStats,
  parseStorySettings,
  type GuidedWorkflowStepKey,
  type WorkflowStats,
} from '../workflow'

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

const STEP_META: Record<GuidedWorkflowStepKey, { eyebrow: string; title: string; description: string }> = {
  basics: {
    eyebrow: '第 1 步 / 12',
    title: '先把作品底盘说清楚',
    description: '维护书名、简介和背景。',
  },
  'project-brief': {
    eyebrow: '第 2 步 / 12',
    title: '先统一这本书的产品定义',
    description: '先写清服务谁、承诺什么、靠什么被点开，以及哪些东西绝对不能写偏。',
  },
  'story-core': {
    eyebrow: '第 3 步 / 12',
    title: '基础设定先钉住',
    description: '先写基础设定、主角起点和底层约束，不提前写剧情。',
  },
  'theme-voice': {
    eyebrow: '第 4 步 / 12',
    title: '把主题与文风钉成硬规则',
    description: '先固定主题、情感核心、视角、时态和语言禁区，减少口吻漂移与 AI 腔。',
  },
  'world-foundation': {
    eyebrow: '第 5 步 / 12',
    title: '统一世界规则口径',
    description: '先把时间、势力、语言边界和题材规则定稳。',
  },
  'map-structure': {
    eyebrow: '第 6 步 / 12',
    title: '先搭地点骨架',
    description: '先让人物和事件有真实落点，再去细化情节。',
  },
  'character-roster': {
    eyebrow: '第 7 步 / 12',
    title: '补齐关键角色',
    description: '主角和关键对位角色先落地，别让剧情靠空气推进。',
  },
  'items-equipment': {
    eyebrow: '第 8 步 / 12',
    title: '补关键物品与资源',
    description: '道具、资源和装备必须服务冲突，不是事后装饰。',
  },
  'story-threads': {
    eyebrow: '第 9 步 / 12',
    title: '把长线推进整理成线程',
    description: '主线、支线、悬念和关系线都要挂成可追踪线程，后面的结构和正文才不会失忆。',
  },
  'story-plot': {
    eyebrow: '第 10 步 / 12',
    title: '现在再做故事设计',
    description: '资产到位之后，再统一设计主线、支线、节奏和结局。',
  },
  'volume-planning': {
    eyebrow: '第 11 步 / 12',
    title: '拆卷规划，分配节奏',
    description: '百万字长篇必须先拆卷，每卷有独立高潮和阶段目标，才不会写到中段失控。',
  },
  'write-start': {
    eyebrow: '第 12 步 / 12',
    title: '转入结构与写作',
    description: '有了骨架和资产后，再进入结构页、时间轴和正文页。',
  },
}

export default function GuidedWorkspaceStep({ novelId, stepKey }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { setMode } = useWorkspaceStore()
  const [form] = Form.useForm<BasicsFormValues>()
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [savingBasics, setSavingBasics] = useState(false)
  const [creatingChapter, setCreatingChapter] = useState(false)

  const settings = useMemo(
    () => parseStorySettings(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const projectBrief = useMemo(
    () => parseProjectBriefSnapshot(currentNovel?.projectBriefJson),
    [currentNovel?.projectBriefJson],
  )
  const themeVoice = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )
  const stepMeta = STEP_META[stepKey]
  const progress = useMemo(
    () => getGuidedStepProgressMap(currentNovel, stats)[stepKey],
    [currentNovel, stats, stepKey],
  )

  useEffect(() => {
    form.setFieldsValue({
      title: currentNovel?.title || '',
      synopsis: currentNovel?.synopsis || '',
      userBackground: currentNovel?.userBackground || '',
      expandedBackground: currentNovel?.expandedBackground || '',
      targetWords: currentNovel?.targetWords || 200000,
    })
  }, [currentNovel, form])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (active) setStats(workflowStats)
    })
    return () => {
      active = false
    }
  }, [novelId])

  const contextSummary = (
    <WorkspaceContextSummary
      items={[
        { label: '题材', value: currentNovel?.genreName || '未设置' },
        { label: '目标字数', value: `${(currentNovel?.targetWords || 0).toLocaleString()} 字` },
        { label: '当前进度', value: `${progress.completedCount}/${progress.totalCount}` },
        { label: '章节', value: `${stats.completedChapterCount}/${stats.chapterCount || 0}` },
      ]}
    />
  )

  const openProPage = (page: string) => {
    setMode('pro')
    navigate(`/novels/${novelId}/${page}`)
  }

  const handleSaveBasics = async () => {
    const values = await form.validateFields()
    setSavingBasics(true)

    try {
      await window.electron.novel.update(novelId, {
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        userBackground: values.userBackground.trim(),
        expandedBackground: values.expandedBackground.trim(),
        targetWords: values.targetWords,
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      message.success(getUserFacingMessage('guidedStep.basicsSaved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'guidedStep.basicsSaveFailed'))
    } finally {
      setSavingBasics(false)
    }
  }

  const handleCreateFirstChapter = async () => {
    setCreatingChapter(true)
    try {
      const nextNum = stats.chapterCount > 0 ? stats.chapterCount + 1 : 1
      await window.electron.chapter.create(novelId, {
        chapterNum: nextNum,
        title: `第${nextNum}章`,
        status: 'outline',
      })
      const updatedStats = await loadWorkflowStats(novelId)
      setStats(updatedStats)
      message.success(getUserFacingMessage('guidedStep.firstChapterCreated'))
      openProPage('writing')
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'guidedStep.firstChapterCreateFailed'))
    } finally {
      setCreatingChapter(false)
    }
  }

  if (stepKey === 'basics') {
    return (
      <WorkspacePage
        className="guided-step guided-step--basics"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} loading={savingBasics} onClick={() => void handleSaveBasics()}>
              保存这一页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/project-brief`)}>
              去项目立项
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${progress.completedCount}/${progress.totalCount}`} tone="warm" hint="书名、简介、原始背景、扩展背景" />
            <WorkspaceMetric label="当前字数" value={`${stats.totalWords.toLocaleString()} 字`} hint="显示当前累计字数。" />
          </>
        )}
      >
        <WorkspacePanel>
          <Form form={form} layout="vertical">
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
                  <Input.TextArea rows={4} placeholder="写清主角处境、目标和最硬的冲突。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                  <Input.TextArea rows={6} placeholder="把你最初想到的故事处境、氛围和困局写下来。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                  <Input.TextArea rows={6} placeholder="补充环境压力、资源条件、制度成本和社会结构。" />
                </Form.Item>
              </div>
            </div>
          </Form>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'project-brief') {
    return (
      <WorkspacePage
        className="guided-step guided-step--project-brief"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<AppstoreOutlined />} onClick={() => openProPage('project-brief')}>
              打开项目立项
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/story-core`)}>
              去基础设定
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${projectBrief.readyCount}/${progress.totalCount}`} tone="warm" hint="平台模式、赛道、读者、承诺、卖点、参考系" />
            <WorkspaceMetric label="基础底盘" value={isBasicsReady(currentNovel) ? '已完成' : '待补齐'} hint="显示基础信息状态。" />
          </>
        )}
      >
        {!isBasicsReady(currentNovel) ? (
          <Alert type="warning" showIcon message="基础信息未完成" />
        ) : null}

        <WorkspacePanel>
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <strong>{projectBrief.platformMode ? '已填写' : '未填写'}</strong>
              <small>{projectBrief.platformMode || '先确定这本书是通用、网文长篇还是出版形态。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{projectBrief.targetAudience ? '已填写' : '未填写'}</strong>
              <small>{projectBrief.targetAudience || '写清主要服务的赛道和阅读偏好。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{projectBrief.readerPromise ? '已填写' : '未填写'}</strong>
              <small>{projectBrief.readerPromise || '告诉系统读者点开后会稳定得到什么体验。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{projectBrief.sellingPoints || projectBrief.compTitles ? '已填写' : '未填写'}</strong>
              <small>{projectBrief.sellingPoints || projectBrief.compTitles || '卖点必须可执行，参考系必须可对齐。'}</small>
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'story-core') {
    return (
      <WorkspacePage
        className="guided-step guided-step--story-core"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<SettingOutlined />} onClick={() => openProPage('core-settings')}>
              打开基础设定
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/theme-voice`)}>
              去主题与文风
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${progress.completedCount}/${progress.totalCount}`} tone="warm" hint="定位、核心信息、主角起点、约束" />
            <WorkspaceMetric label="背景基础" value={isBasicsReady(currentNovel) ? '已就绪' : '待补齐'} hint="显示背景信息状态。" />
          </>
        )}
      >
        {!isBasicsReady(currentNovel) ? (
          <Alert type="warning" showIcon message="基础信息未完成" />
        ) : null}

        <WorkspacePanel>
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <strong>{settings.premise.positioning ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.positioning || '写背景和叙事方向，不写事件链。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{settings.premise.coreHook ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.coreHook || '写为什么值得设计故事。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{settings.premise.protagonistStart ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.protagonistStart || '写身份、处境、资源和限制。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{settings.premise.constraints ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.constraints || '写不能违背的规则、代价和常识边界。'}</small>
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'theme-voice') {
    return (
      <WorkspacePage
        className="guided-step guided-step--theme-voice"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<EditOutlined />} onClick={() => openProPage('theme-voice')}>
              打开主题与文风
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/world-foundation`)}>
              去世界规则
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${themeVoice.readyCount}/${progress.totalCount}`} tone="warm" hint="主题、情感核心、视角、时态、风格规则、对白规则" />
            <WorkspaceMetric label="立项状态" value={isProjectBriefReady(currentNovel) ? '已完成' : '待补齐'} hint="显示项目立项状态。" />
          </>
        )}
      >
        {!isProjectBriefReady(currentNovel) ? (
          <Alert type="info" showIcon message="项目立项未完成" />
        ) : null}

        <WorkspacePanel>
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <strong>{themeVoice.theme ? '已填写' : '未填写'}</strong>
              <small>{themeVoice.theme || '写这本书真正要持续回答的命题。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{themeVoice.emotionalCore ? '已填写' : '未填写'}</strong>
              <small>{themeVoice.emotionalCore || '写读者最稳定会收到的情感回报。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{themeVoice.pov && themeVoice.tense ? '已填写' : '未填写'}</strong>
              <small>{[themeVoice.pov, themeVoice.tense].filter(Boolean).join(' / ') || '先固定叙事视角和时态，长篇口吻才不会漂移。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{themeVoice.styleRules && themeVoice.dialogueRules ? '已填写' : '未填写'}</strong>
              <small>{themeVoice.styleRules || themeVoice.dialogueRules || '把风格与对白约束写成可执行规则，而不是形容词。'}</small>
            </div>
          </div>
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
        actions={(
          <Space wrap>
            <Button type="primary" icon={<GlobalOutlined />} onClick={() => openProPage('world-rules')}>
              打开世界规则
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/map-structure`)}>
              去地图结构
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="规则状态" value={isWorldFoundationReady(currentNovel) ? '已就绪' : '待补齐'} tone="warm" hint="时间、势力、种族、等级和语言边界" />
            <WorkspaceMetric label="准备状态" value={isStoryCoreReady(currentNovel) ? '基础设定已齐' : '基础设定未完成'} hint="显示基础设定状态。" />
          </>
        )}
      >
        <WorkspacePanel>
          <div className="guided-step__checklist">
            <div className="guided-step__checkitem guided-step__checkitem--done">
              <p>把时间制度、势力结构、地图蓝图和语言边界统一成一个口径。</p>
            </div>
            <div className="guided-step__checkitem">
              <p>后面的角色、地图、时间轴和正文都会复用这里的规则。</p>
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'map-structure') {
    return (
      <WorkspacePage
        className="guided-step guided-step--map-structure"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<EnvironmentOutlined />} onClick={() => openProPage('map')}>
              打开地图页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/character-roster`)}>
              去角色系统
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="节点数" value={stats.mapCount} tone="warm" hint={stats.mapCount > 0 ? '地点骨架已经存在。' : '还没有任何地图节点。'} />
            <WorkspaceMetric label="规则前置" value={isWorldFoundationReady(currentNovel) ? '已完成' : '待完成'} hint="先统一世界规则，再建地图。" />
          </>
        )}
      >
        {!isWorldFoundationReady(currentNovel) ? (
          <Alert type="warning" showIcon message="请先完成世界规则，再进入地图结构。" />
        ) : null}
      </WorkspacePage>
    )
  }

  if (stepKey === 'character-roster') {
    return (
      <WorkspacePage
        className="guided-step guided-step--character-roster"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<TeamOutlined />} onClick={() => openProPage('characters')}>
              打开角色页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/items-equipment`)}>
              去物品装备
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="主角" value={stats.hasProtagonist ? '已建立' : '未建立'} tone="warm" hint="没有主角时，后续长线会失焦。" />
            <WorkspaceMetric label="角色数" value={stats.characterCount} hint="先够用，再扩充枝末细节。" />
          </>
        )}
      >
          {!isMapStructureReady(stats) ? (
            <Alert type="warning" showIcon message="地图结构未完成" />
          ) : null}
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
        actions={(
          <Space wrap>
            <Button type="primary" icon={<AppstoreOutlined />} onClick={() => openProPage('items')}>
              打开物品页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/story-threads`)}>
              去故事线程
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="物品数" value={stats.itemCount} tone="warm" hint={stats.itemCount > 0 ? '已有可挂到人物和事件的物品。' : '还没有关键物品。'} />
            <WorkspaceMetric label="人物前置" value={isCharacterRosterReady(stats) ? '已完成' : '待完成'} hint="人物和地图越完整，物品越不容易空转。" />
          </>
        )}
      >
          {!isCharacterRosterReady(stats) ? (
            <Alert type="warning" showIcon message="角色系统未完成" />
          ) : null}
      </WorkspacePage>
    )
  }

  if (stepKey === 'story-threads') {
    return (
      <WorkspacePage
        className="guided-step guided-step--story-threads"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<BarsOutlined />} onClick={() => openProPage('threads')}>
              打开故事线程
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/story-plot`)}>
              去故事设计
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="线程数" value={stats.threadCount} tone="warm" hint={stats.threadCount > 0 ? '已经有可追踪的长线。' : '还没有任何线程，后续最容易丢伏笔和关系线。'} />
            <WorkspaceMetric label="前置资产" value={isItemsEquipmentReady(stats) ? '已完成' : '待完成'} hint="人物、物品和地点越完整，线程越不会写成空话。" />
          </>
        )}
      >
          {!isItemsEquipmentReady(stats) ? (
            <Alert type="warning" showIcon message="物品资产未完成" />
          ) : null}

        <WorkspacePanel>
          <div className="guided-step__checklist">
            <div className="guided-step__checkitem guided-step__checkitem--done">
              <p>主线、支线、悬念、关系线都要写清开始点、当前状态、回收条件和目标章位。</p>
            </div>
            <div className="guided-step__checkitem">
              <p>结构页、时间轴和正文都应该回查这些线程，而不是每一页各写各的推进链。</p>
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'story-plot') {
    return (
      <WorkspacePage
        className="guided-step guided-step--story-plot"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<BarsOutlined />} onClick={() => openProPage('story-design')}>
              打开故事设计
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/volume-planning`)}>
              去卷册规划
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${progress.completedCount}/${progress.totalCount}`} tone="warm" hint="目标、冲突、推进链、结局" />
            <WorkspaceMetric label="资产准备" value={isItemsEquipmentReady(stats) ? '基本齐备' : '仍待补齐'} hint="世界、地图、人物、物品越完整，故事设计越稳。" />
          </>
        )}
      >
        <WorkspacePanel>
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <strong>{settings.storyGoal ? '已填写' : '未填写'}</strong>
              <small>{settings.storyGoal || '写最终要达到什么状态。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{settings.coreConflict ? '已填写' : '未填写'}</strong>
              <small>{settings.coreConflict || '写目标为什么难实现。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{settings.mainPlot ? '已填写' : '未填写'}</strong>
              <small>{settings.mainPlot || '写主线如何一步步推进。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{settings.ending ? '已填写' : '未填写'}</strong>
              <small>{settings.ending || '写故事最终如何收束。'}</small>
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  if (stepKey === 'volume-planning') {
    return (
      <WorkspacePage
        className="guided-step guided-step--volume-planning"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<BarsOutlined />} onClick={() => openProPage('structure')}>
              打开结构页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/write-start`)}>
              去开始写作
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${progress.completedCount}/${progress.totalCount}`} tone="warm" hint="至少拆出一卷" />
            <WorkspaceMetric label="已有卷数" value={stats.volumeCount} hint="百万字建议 3-8 卷，每卷 15-40 万字。" />
            <WorkspaceMetric label="目标字数" value={`${(currentNovel?.targetWords || 0).toLocaleString()} 字`} hint="总字数预算，拆卷时按比例分配。" />
          </>
        )}
      >
          {!isStoryPlotReady(currentNovel) ? (
            <Alert type="warning" showIcon message="故事设计未完成" style={{ marginBottom: 16 }} />
          ) : null}

        <WorkspacePanel>
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <strong>{stats.volumeCount > 0 ? `${stats.volumeCount} 卷` : '未规划'}</strong>
                <small>当前尚未创建卷。</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{stats.outlineCount > 0 ? `${stats.outlineCount} 条` : '未创建'}</strong>
              <small>每卷应分配 1-3 条主要弧线。</small>
            </div>
            <div className="guided-step__fact-card">
              <strong>{stats.threadCount > 0 ? `${stats.threadCount} 条` : '未创建'}</strong>
              <small>确保每条线程都有卷级归属，不要悬空。</small>
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      className="guided-step guided-step--write-start"
      layout="wide"
      heroVariant="compact"
      eyebrow={stepMeta.eyebrow}
      title={stepMeta.title}
      actions={(
        <Space wrap>
          {stats.chapterCount > 0 ? (
            <Button type="primary" icon={<EditOutlined />} onClick={() => openProPage('writing')}>
              进入正文页
            </Button>
          ) : (
            <Button type="primary" icon={<EditOutlined />} loading={creatingChapter} onClick={() => void handleCreateFirstChapter()}>
              创建首章
            </Button>
          )}
          <Button icon={<ArrowRightOutlined />} onClick={() => openProPage('structure')}>
            打开结构页
          </Button>
          <Button onClick={() => openProPage('timeline')}>
            打开时间轴
          </Button>
        </Space>
      )}
      contextSummary={contextSummary}
      metrics={(
        <>
          <WorkspaceMetric label="大纲" value={stats.outlineCount} tone="warm" hint="先把故事弧和结构分层压稳。" />
          <WorkspaceMetric label="时间轴" value={stats.timelineCount} hint="记清谁在何时何地做了什么。" />
            <WorkspaceMetric label="线程" value={stats.threadCount} hint={isStoryThreadsReady(stats) ? '主线、支线和回收线已经有统一挂点。' : '当前还没有故事线程。'} />
          <WorkspaceMetric label="章节" value={stats.chapterCount} hint={stats.chapterCount > 0 ? '已经可以继续写正文。' : '还没有首章。'} />
        </>
      )}
    >
        {!isStoryPlotReady(currentNovel) ? (
          <Alert type="warning" showIcon message="故事设计未完成" />
        ) : null}

      <WorkspacePanel>
        <div className="guided-step__fact-grid">
          <div className="guided-step__fact-card">
            <strong>{isStoryCoreReady(currentNovel) ? '已完成' : '待补齐'}</strong>
            <small>先有基础设定，正文才不会一路跑偏。</small>
          </div>
          <div className="guided-step__fact-card">
            <strong>{themeVoice.readyCount > 0 ? `${themeVoice.readyCount}/6` : '待补齐'}</strong>
            <small>正文越长，越依赖稳定的视角、时态和语言边界。</small>
          </div>
          <div className="guided-step__fact-card">
            <strong>{isStoryPlotReady(currentNovel) ? '已完成' : '待补齐'}</strong>
            <small>先有目标和冲突，结构页才有可拆内容。</small>
          </div>
          <div className="guided-step__fact-card">
            <strong>{stats.outlineCount + stats.timelineCount + stats.threadCount}</strong>
            <small>大纲、时间轴和线程越完整，正文越稳。</small>
          </div>
          <div className="guided-step__fact-card">
            <strong>{stats.chapterCount > 0 ? '可继续写' : '尚未开章'}</strong>
            <small>如果还没有章节，可以先创建首章。</small>
          </div>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
