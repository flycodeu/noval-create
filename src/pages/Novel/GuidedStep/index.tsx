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
import { useNovelStore } from '../../../stores/novel.store'
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
  isStoryCoreReady,
  isStoryPlotReady,
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
    eyebrow: '第 1 步 / 8',
    title: '先把作品底盘说清楚',
    description: '这里只保留书名、简介和背景，不把别的功能堆进来。',
  },
  'story-core': {
    eyebrow: '第 2 步 / 8',
    title: '基础设定先钉住',
    description: '先写 premise、主角起点和底层约束，不提前写剧情。',
  },
  'world-foundation': {
    eyebrow: '第 3 步 / 8',
    title: '统一世界规则口径',
    description: '先把时间、势力、语言边界和题材规则定稳。',
  },
  'map-structure': {
    eyebrow: '第 4 步 / 8',
    title: '先搭地点骨架',
    description: '先让人物和事件有真实落点，再去细化情节。',
  },
  'character-roster': {
    eyebrow: '第 5 步 / 8',
    title: '补齐关键角色',
    description: '主角和关键对位角色先落地，别让剧情靠空气推进。',
  },
  'items-equipment': {
    eyebrow: '第 6 步 / 8',
    title: '补关键物品与资源',
    description: '道具、资源和装备必须服务冲突，不是事后装饰。',
  },
  'story-plot': {
    eyebrow: '第 7 步 / 8',
    title: '现在再做故事设计',
    description: '资产到位之后，再统一设计主线、支线、节奏和结局。',
  },
  'write-start': {
    eyebrow: '第 8 步 / 8',
    title: '转入结构与写作',
    description: '有了骨架和资产后，再进入结构页、时间轴和正文页。',
  },
}

export default function GuidedWorkspaceStep({ novelId, stepKey }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<BasicsFormValues>()
  const [stats, setStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [savingBasics, setSavingBasics] = useState(false)
  const [creatingChapter, setCreatingChapter] = useState(false)

  const settings = useMemo(
    () => parseStorySettings(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
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
      message.success('基础信息已保存。')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '基础信息保存失败。')
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
      message.success('首章已创建，正在进入正文页。')
      navigate(`/novels/${novelId}/writing`)
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '创建首章失败。')
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
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} loading={savingBasics} onClick={() => void handleSaveBasics()}>
              保存这一页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/core-settings`)}>
              去基础设定
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${progress.completedCount}/${progress.totalCount}`} tone="warm" hint="书名、简介、原始背景、扩展背景" />
            <WorkspaceMetric label="当前字数" value={`${stats.totalWords.toLocaleString()} 字`} hint="这里只先定总目标，后面再拆卷部章。" />
          </>
        )}
      >
        <WorkspacePanel title="这一步只做四件事" description="先把底盘写稳，后面的 AI 才有统一上下文。">
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

  if (stepKey === 'story-core') {
    return (
      <WorkspacePage
        className="guided-step guided-step--story-core"
        layout="wide"
        heroVariant="compact"
        eyebrow={stepMeta.eyebrow}
        title={stepMeta.title}
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<SettingOutlined />} onClick={() => navigate(`/novels/${novelId}/core-settings`)}>
              打开基础设定
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/world-rules`)}>
              去世界规则
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="完成度" value={`${progress.completedCount}/${progress.totalCount}`} tone="warm" hint="定位、核心信息、主角起点、约束" />
            <WorkspaceMetric label="背景基础" value={isBasicsReady(currentNovel) ? '已就绪' : '待补齐'} hint="建议先写稳简介和背景，再整理 premise。" />
          </>
        )}
      >
        {!isBasicsReady(currentNovel) ? (
          <Alert type="warning" showIcon message="基础信息还没补齐。先把书名、简介和背景写稳，再整理基础设定。" />
        ) : null}

        <WorkspacePanel title="基础设定检查">
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <span>作品定位</span>
              <strong>{settings.premise.positioning ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.positioning || '写背景和叙事方向，不写事件链。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>核心信息</span>
              <strong>{settings.premise.coreHook ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.coreHook || '写为什么值得设计故事。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>主角起点</span>
              <strong>{settings.premise.protagonistStart ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.protagonistStart || '写身份、处境、资源和限制。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>底层约束</span>
              <strong>{settings.premise.constraints ? '已填写' : '未填写'}</strong>
              <small>{settings.premise.constraints || '写不能违背的规则、代价和常识边界。'}</small>
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
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<GlobalOutlined />} onClick={() => navigate(`/novels/${novelId}/world-rules`)}>
              打开世界规则
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/map`)}>
              去地图结构
            </Button>
          </Space>
        )}
        contextSummary={contextSummary}
        metrics={(
          <>
            <WorkspaceMetric label="规则状态" value={isWorldFoundationReady(currentNovel) ? '已就绪' : '待补齐'} tone="warm" hint="时间、势力、种族、等级和语言边界" />
            <WorkspaceMetric label="前置依赖" value={isStoryCoreReady(currentNovel) ? '基础设定已齐' : '先补基础设定'} hint="先有 premise，再统一世界口径。" />
          </>
        )}
      >
        <WorkspacePanel title="这一页要解决的问题">
          <div className="guided-step__checklist">
            <div className="guided-step__checkitem guided-step__checkitem--done">
              <div className="guided-step__checkhead"><strong>统一世界口径</strong></div>
              <p>把时间制度、势力结构、地图蓝图和语言边界统一成一个口径。</p>
            </div>
            <div className="guided-step__checkitem">
              <div className="guided-step__checkhead"><strong>服务后续资产</strong></div>
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
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<EnvironmentOutlined />} onClick={() => navigate(`/novels/${novelId}/map`)}>
              打开地图页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/characters`)}>
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
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<TeamOutlined />} onClick={() => navigate(`/novels/${novelId}/characters`)}>
              打开角色页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/items`)}>
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
          <Alert type="warning" showIcon message="建议先把地图骨架搭起来，再补人物网络。" />
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
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<AppstoreOutlined />} onClick={() => navigate(`/novels/${novelId}/items`)}>
              打开物品页
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/story-design`)}>
              去故事设计
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
          <Alert type="warning" showIcon message="建议先把主角和关键角色补齐，再设计物品与装备。" />
        ) : null}
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
        description={stepMeta.description}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/story-design`)}>
              打开故事设计
            </Button>
            <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/structure`)}>
              去结构页
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
        <WorkspacePanel title="故事设计检查">
          <div className="guided-step__fact-grid">
            <div className="guided-step__fact-card">
              <span>故事目标</span>
              <strong>{settings.storyGoal ? '已填写' : '未填写'}</strong>
              <small>{settings.storyGoal || '写最终要达到什么状态。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>核心冲突</span>
              <strong>{settings.coreConflict ? '已填写' : '未填写'}</strong>
              <small>{settings.coreConflict || '写目标为什么难实现。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>主推进链</span>
              <strong>{settings.mainPlot ? '已填写' : '未填写'}</strong>
              <small>{settings.mainPlot || '写主线如何一步步推进。'}</small>
            </div>
            <div className="guided-step__fact-card">
              <span>结局落点</span>
              <strong>{settings.ending ? '已填写' : '未填写'}</strong>
              <small>{settings.ending || '写故事最终如何收束。'}</small>
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
      description={stepMeta.description}
      actions={(
        <Space wrap>
          {stats.chapterCount > 0 ? (
            <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/writing`)}>
              进入正文页
            </Button>
          ) : (
            <Button type="primary" icon={<EditOutlined />} loading={creatingChapter} onClick={() => void handleCreateFirstChapter()}>
              创建首章
            </Button>
          )}
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/structure`)}>
            打开结构页
          </Button>
          <Button onClick={() => navigate(`/novels/${novelId}/timeline`)}>
            打开时间轴
          </Button>
        </Space>
      )}
      contextSummary={contextSummary}
      metrics={(
        <>
          <WorkspaceMetric label="大纲" value={stats.outlineCount} tone="warm" hint="先把故事弧和结构分层压稳。" />
          <WorkspaceMetric label="时间轴" value={stats.timelineCount} hint="记清谁在何时何地做了什么。" />
          <WorkspaceMetric label="章节" value={stats.chapterCount} hint={stats.chapterCount > 0 ? '已经可以继续写正文。' : '还没有首章。'} />
        </>
      )}
    >
      {!isStoryPlotReady(currentNovel) ? (
        <Alert type="warning" showIcon message="故事设计还没完成。建议先补齐目标、冲突、推进链和结局，再进入结构与写作。" />
      ) : null}

      <WorkspacePanel title="开写前检查">
        <div className="guided-step__fact-grid">
          <div className="guided-step__fact-card">
            <span>基础设定</span>
            <strong>{isStoryCoreReady(currentNovel) ? '已完成' : '待补齐'}</strong>
            <small>先有 premise，正文才不会一路跑偏。</small>
          </div>
          <div className="guided-step__fact-card">
            <span>故事设计</span>
            <strong>{isStoryPlotReady(currentNovel) ? '已完成' : '待补齐'}</strong>
            <small>先有目标和冲突，结构页才有可拆内容。</small>
          </div>
          <div className="guided-step__fact-card">
            <span>结构资产</span>
            <strong>{stats.outlineCount + stats.timelineCount}</strong>
            <small>大纲和时间轴越完整，正文越稳。</small>
          </div>
          <div className="guided-step__fact-card">
            <span>正文状态</span>
            <strong>{stats.chapterCount > 0 ? '可继续写' : '尚未开章'}</strong>
            <small>如果还没有章节，可以先创建首章。</small>
          </div>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
