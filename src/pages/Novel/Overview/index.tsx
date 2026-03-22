import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Progress, Space, message } from 'antd'
import {
  BarsOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import { parseStorySettingsSnapshot } from '../../../shared/story-settings'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'

interface Props {
  novelId: number
}

interface OverviewFormValues {
  title: string
  synopsis: string
  userBackground: string
  expandedBackground: string
  targetWords: number
}

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<OverviewFormValues>()
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState({
    mapCount: 0,
    characterCount: 0,
    itemCount: 0,
    outlineCount: 0,
    timelineCount: 0,
    chapterCount: 0,
    completedChapterCount: 0,
    totalWords: 0,
    hasProtagonist: false,
  })

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

  const storySettings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )

  const targetWords = currentNovel?.targetWords || 0
  const wordProgress = targetWords > 0 ? Math.min(100, Math.round((stats.totalWords / targetWords) * 100)) : 0
  const chapterProgress = stats.chapterCount > 0
    ? Math.round((stats.completedChapterCount / stats.chapterCount) * 100)
    : 0

  const readinessItems = [
    {
      title: '基础设定',
      ready: storySettings.premiseReadyCount >= 4,
      summary: 'premise、主角起点、底层约束和写作边界。',
      detail: storySettings.premiseReadyCount >= 4 ? '基础设定已经具备可执行边界。' : '这里还缺定位或约束，后面的剧情容易继续发散。',
      icon: <SettingOutlined />,
      action: () => navigate(`/novels/${novelId}/core-settings`),
    },
    {
      title: '故事设计',
      ready: storySettings.storyDesignReadyCount >= 4,
      summary: '主线目标、冲突、推进链和结局。',
      detail: storySettings.storyDesignReadyCount >= 4 ? '故事骨架已经基本成型。' : '不要急着平铺章节，先把故事骨架压实。',
      icon: <BarsOutlined />,
      action: () => navigate(`/novels/${novelId}/story-design`),
    },
    {
      title: '世界规则',
      ready: Boolean(currentNovel?.worldRulesJson),
      summary: '时间、势力、种族、等级和语言边界。',
      detail: `${worldRules.powerSystems.length} 套体系 / ${worldRules.factionSystem.length} 个势力 / ${worldRules.speciesSystem.length} 类实体`,
      icon: <GlobalOutlined />,
      action: () => navigate(`/novels/${novelId}/world-rules`),
    },
    {
      title: '地图结构',
      ready: stats.mapCount > 0,
      summary: '地点层级、区域边界和行动半径。',
      detail: stats.mapCount > 0 ? `已建立 ${stats.mapCount} 个地图节点。` : '地图还是空的，行动逻辑和资源争夺会失焦。',
      icon: <EnvironmentOutlined />,
      action: () => navigate(`/novels/${novelId}/map`),
    },
    {
      title: '人物网络',
      ready: stats.characterCount > 0,
      summary: '主角、对位角色和关键关系。',
      detail: stats.characterCount > 0 ? `当前已有 ${stats.characterCount} 位角色。` : '先让主角和关键对手立起来，再做长线推进。',
      icon: <TeamOutlined />,
      action: () => navigate(`/novels/${novelId}/characters`),
    },
    {
      title: '时间轴',
      ready: stats.timelineCount > 0,
      summary: '谁做了什么、付出什么、留下什么后果。',
      detail: stats.timelineCount > 0 ? `已记录 ${stats.timelineCount} 个关键事件。` : '缺时间轴时，因果链最容易断。',
      icon: <ClockCircleOutlined />,
      action: () => navigate(`/novels/${novelId}/timeline`),
    },
  ]

  const nextFocus = readinessItems.find((item) => !item.ready)?.title || '正文写作'

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)

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
      message.success('基础信息已保存，后续生成会直接继承这些内容。')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '基础信息保存失败。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspacePage
      className="novel-overview-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="基础总览"
      title="基础总览"
      description="总览页只做两件事：把书的底盘写稳，以及判断下一步该补哪块。不要在这里直接展开剧情。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存基础信息
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate(`/novels/${novelId}/core-settings`)}>
            去基础设定
          </Button>
          <Button icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/story-design`)}>
            去故事设计
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '当前状态', value: nextFocus },
            { label: '章节', value: `${stats.completedChapterCount}/${stats.chapterCount || 0}` },
            { label: '目标字数', value: `${(currentNovel?.targetWords || 0).toLocaleString()} 字` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric
            label="累计字数"
            value={`${stats.totalWords.toLocaleString()} 字`}
            tone="warm"
            hint={targetWords > 0 ? `目标 ${targetWords.toLocaleString()} 字` : '还没有设置目标字数'}
          />
          <WorkspaceMetric
            label="章节进度"
            value={`${stats.completedChapterCount}/${stats.chapterCount || 0}`}
            hint={`完成率 ${chapterProgress}%`}
          />
          <WorkspaceMetric
            label="结构资产"
            value={stats.characterCount + stats.itemCount + stats.timelineCount + stats.mapCount}
            tone="cool"
            hint="人物、物品、事件与地图节点总和"
          />
        </>
      )}
    >
      {!currentNovel?.synopsis || !currentNovel?.expandedBackground ? (
        <Alert
          type="warning"
          showIcon
          message="简介或扩展背景还没有写稳。后面的 AI 生成会直接继承这里的底盘。"
        />
      ) : null}

      <WorkspacePanel title="推进温度计" description="先看当前进度，再看缺口。">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>字数进度</strong>
              <span>{wordProgress}%</span>
            </div>
            <Progress percent={wordProgress} showInfo={false} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>章节进度</strong>
              <span>{chapterProgress}%</span>
            </div>
            <Progress percent={chapterProgress} showInfo={false} />
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="基础信息编辑" description="这里决定后续所有 AI 任务的底盘和口径。">
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid guided-step__field-grid--basics">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="title" label="书名" rules={[{ required: true, message: '请填写书名' }]}>
                <Input placeholder="先给这本书一个能代表气质的标题" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetWords" label="目标字数" rules={[{ required: true, message: '请填写目标字数' }]}>
                <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="synopsis" label="一句话简介" rules={[{ required: true, message: '请填写简介' }]}>
                <Input.TextArea rows={4} placeholder="写清主角处境、目标和最硬的冲突，不要只写氛围词。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                <Input.TextArea rows={7} placeholder="写你最初想到的题材、处境、气氛和人物困局。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                <Input.TextArea rows={7} placeholder="把环境压力、组织秩序、资源条件和制度代价写实。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel title="当前快照" description="先确认这本书有没有真正稳定的主轴，而不是好看的说法。">
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="guided-step__fact-card">
            <span>基础设定</span>
            <strong>{storySettings.premiseReadyCount}/5</strong>
            <small>{storySettings.premise.constraints || '还没有写清底层约束。'}</small>
          </div>
          <div className="guided-step__fact-card">
            <span>故事设计</span>
            <strong>{storySettings.storyDesignReadyCount}/4</strong>
            <small>{storySettings.mainPlot || '还没有把主线推进链写稳。'}</small>
          </div>
          <div className="guided-step__fact-card">
            <span>世界规则</span>
            <strong>{currentNovel?.worldRulesJson ? '已存在' : '未建立'}</strong>
            <small>{worldRules.mapBlueprint.overview || '还没有明确地点层级和行动边界。'}</small>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="结构资产就绪度" description="点击任意模块继续补齐，优先补真正影响后续准确度的部分。">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {readinessItems.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={item.action}
              style={{
                textAlign: 'left',
                border: '1px solid rgba(15,23,42,0.08)',
                borderRadius: 16,
                padding: 16,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong>{item.title}</strong>
                <span>{item.icon}</span>
              </div>
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>{item.summary}</div>
              <div style={{ fontSize: 12, color: item.ready ? '#0f766e' : '#b45309', marginBottom: 8 }}>
                {item.ready ? '已就绪' : '待补齐'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{item.detail}</div>
            </button>
          ))}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
