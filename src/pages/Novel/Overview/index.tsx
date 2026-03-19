import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Progress, Space, message } from 'antd'
import {
  BarsOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
}

interface OverviewStats {
  totalChapters: number
  completedChapters: number
  totalWords: number
  characterCount: number
  itemCount: number
  outlineCount: number
  timelineCount: number
  mapNodeCount: number
}

interface OverviewFormValues {
  title: string
  synopsis: string
  userBackground: string
  expandedBackground: string
  targetWords: number
}

function safeParse<T>(raw?: string): Partial<T> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as T
  } catch {
    return {}
  }
}

function countMapNodes(nodes: Array<{ children?: unknown[] }>): number {
  return nodes.reduce((total, node) => {
    const children = Array.isArray(node.children) ? node.children : []
    return total + 1 + countMapNodes(children as Array<{ children?: unknown[] }>)
  }, 0)
}

const TIME_MODE_LABELS: Record<string, string> = {
  gregorian: '公历时间',
  regnal: '年号纪年',
  'relative-disaster': '灾变相对时间',
  'custom-era': '虚构纪元',
  'future-date': '未来日期',
}

function getStatusLabel(status?: string) {
  switch (status) {
    case 'writing':
      return '写作中'
    case 'completed':
      return '已完结'
    case 'archived':
      return '已归档'
    default:
      return '草稿中'
  }
}

function getFieldStateLabel(value?: string) {
  return value?.trim() ? '已落地' : '待补充'
}

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<OverviewFormValues>()
  const [stats, setStats] = useState<OverviewStats>({
    totalChapters: 0,
    completedChapters: 0,
    totalWords: 0,
    characterCount: 0,
    itemCount: 0,
    outlineCount: 0,
    timelineCount: 0,
    mapNodeCount: 0,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true

    void Promise.all([
      window.electron.novel.stats(novelId),
      window.electron.item.list(novelId),
      window.electron.outline.getArcs(novelId),
      window.electron.timeline.list(novelId),
      window.electron.map.getTree(novelId),
    ]).then(([baseStats, items, arcs, events, mapTree]) => {
      if (!mounted) return

      setStats({
        totalChapters: baseStats.totalChapters,
        completedChapters: baseStats.completedChapters,
        totalWords: baseStats.totalWords,
        characterCount: baseStats.characterCount,
        itemCount: items.length,
        outlineCount: arcs.length,
        timelineCount: events.length,
        mapNodeCount: countMapNodes(mapTree),
      })
    })

    return () => {
      mounted = false
    }
  }, [novelId])

  useEffect(() => {
    form.setFieldsValue({
      title: currentNovel?.title || '',
      synopsis: currentNovel?.synopsis || '',
      userBackground: currentNovel?.userBackground || '',
      expandedBackground: currentNovel?.expandedBackground || '',
      targetWords: currentNovel?.targetWords || 200000,
    })
  }, [currentNovel, form])

  const storySettings = useMemo(
    () => safeParse<Record<string, string>>(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const writingConstraintSummary = useMemo(() => {
    const constraints = worldRules?.writingConstraints
    if (!constraints) return []

    return [
      constraints.antiQuoteEmphasis ? '避免引号强调' : '',
      constraints.antiConceptSlogans ? '避免概念口号' : '',
      constraints.antiSymmetricLines ? '避免对称排比' : '',
      ...(Array.isArray(constraints.extraRules) ? constraints.extraRules : []),
      ...(Array.isArray(constraints.forbiddenPhrases)
        ? constraints.forbiddenPhrases.map((item) => `禁用：${item}`)
        : []),
    ].filter(Boolean)
  }, [worldRules])

  const targetWords = currentNovel?.targetWords || 0
  const wordProgress = targetWords > 0 ? Math.min(100, Math.round((stats.totalWords / targetWords) * 100)) : 0
  const chapterProgress = stats.totalChapters > 0 ? Math.round((stats.completedChapters / stats.totalChapters) * 100) : 0

  const synopsis = currentNovel?.synopsis?.trim() || '还没有简介，建议先用 1 到 2 段写清故事目标、主角处境和真正的硬冲突。'
  const userBackground = currentNovel?.userBackground?.trim() || '还没有原始背景。这里应该写你最初的题材、处境、气氛和人物困局。'
  const expandedBackground = currentNovel?.expandedBackground?.trim() || '还没有扩展背景。后续世界规则、人物、时间轴和正文都会因此失去稳定依据。'

  const readinessItems = [
    {
      title: '核心设定',
      summary: '先写清故事目标、核心冲突、主线推进和结局方向。',
      ready: Boolean(currentNovel?.settingsJson),
      detail: storySettings.core_conflict
        ? '主线冲突已经落到文字，可继续压实人物决策和代价。'
        : '这里还缺真正的主冲突，后续批量生成容易空泛。',
      action: () => navigate(`/novels/${novelId}/core-settings`),
      icon: <SettingOutlined />,
    },
    {
      title: '世界规则',
      summary: '把时间、势力、种族、等级和语言约束统一口径。',
      ready: Boolean(currentNovel?.worldRulesJson),
      detail: `${worldRules.powerSystems.length} 套体系 / ${worldRules.factionSystem.length} 个势力 / ${worldRules.speciesSystem.length} 类实体`,
      action: () => navigate(`/novels/${novelId}/world-rules`),
      icon: <GlobalOutlined />,
    },
    {
      title: '地图结构',
      summary: '让人物和冲突真正落到区域、据点和行动半径里。',
      ready: stats.mapNodeCount > 0,
      detail: stats.mapNodeCount > 0 ? `已建立 ${stats.mapNodeCount} 个地图节点` : '地图还是空的，资源争夺和行动逻辑会失焦。',
      action: () => navigate(`/novels/${novelId}/map`),
      icon: <EnvironmentOutlined />,
    },
    {
      title: '人物网络',
      summary: '人物不是标签，要有立场、底线、误判和承压决策。',
      ready: stats.characterCount > 0,
      detail: stats.characterCount > 0 ? `已有 ${stats.characterCount} 位角色` : '先把主角和关键对手立起来，别让事件空跑。',
      action: () => navigate(`/novels/${novelId}/characters`),
      icon: <TeamOutlined />,
    },
    {
      title: '事件时间轴',
      summary: '把谁做了什么、付出什么代价、留下什么后果写实。',
      ready: stats.timelineCount > 0,
      detail: stats.timelineCount > 0 ? `已记录 ${stats.timelineCount} 个关键事件` : '缺时间轴时，因果链最容易断。',
      action: () => navigate(`/novels/${novelId}/timeline`),
      icon: <ClockCircleOutlined />,
    },
    {
      title: '故事大纲',
      summary: '让主线推进有阶段、有转折、有被迫选择。',
      ready: stats.outlineCount > 0,
      detail: stats.outlineCount > 0 ? `已拆出 ${stats.outlineCount} 条故事弧` : '大纲仍是空白，正文很难稳住节奏。',
      action: () => navigate(`/novels/${novelId}/outline`),
      icon: <BarsOutlined />,
    },
  ]

  const nextFocus = readinessItems.find((item) => !item.ready)?.title || '正文写作'

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      await window.electron.novel.update(novelId, {
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        userBackground: values.userBackground.trim(),
        expandedBackground: values.expandedBackground.trim(),
        targetWords: values.targetWords,
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) {
        setCurrentNovel(updated)
      }

      message.success('基础信息已保存，后续生成会直接继承最新内容。')
    } catch (error) {
      if (error instanceof Error && error.message) {
        console.error(error)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspacePage
      className="novel-overview-page"
      eyebrow="小说总控台"
      layout="wide"
      title={currentNovel?.title || '创作概览'}
      description="先把基础资料、主冲突和结构缺口放在同一个视图里看清，再决定下一步补什么。这里保存的每个字段，都会直接成为后续 AI 生成的上游上下文。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存基础信息
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate(`/novels/${novelId}/core-settings`)}>
            进入核心设定
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/writing`)}>
            进入正文写作
          </Button>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="累计字数" value={`${stats.totalWords.toLocaleString()} 字`} tone="warm" hint={`目标 ${targetWords > 0 ? `${targetWords.toLocaleString()} 字` : '未设置'}`} />
          <WorkspaceMetric label="章节完成度" value={`${stats.completedChapters}/${stats.totalChapters || 0}`} hint={`完成率 ${chapterProgress}%`} />
          <WorkspaceMetric label="结构资产" value={stats.characterCount + stats.itemCount + stats.timelineCount + stats.mapNodeCount} tone="cool" hint="人物、物品、事件与地图节点总和" />
          <WorkspaceMetric label="当前焦点" value={nextFocus} hint="先补最容易影响后续生成准确度的模块" />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '状态', value: getStatusLabel(currentNovel?.status) },
            {
              label: '时间制度',
              value: TIME_MODE_LABELS[worldRules.timelineConfig.calendarType] || '未设置',
            },
            {
              label: '基础资料',
              value: `${getFieldStateLabel(currentNovel?.synopsis)}简介 / ${getFieldStateLabel(currentNovel?.userBackground)}原始背景 / ${getFieldStateLabel(currentNovel?.expandedBackground)}扩展背景`,
            },
          ]}
        />
      )}
      aside={(
        <WorkspacePanel title="推进温度计" description="先看进度，再看缺口。">
          <div className="novel-grid">
            <div className="novel-overview-progress-card">
              <div className="novel-kicker">字数推进</div>
              <div className="novel-overview-progress-card__value">{wordProgress}%</div>
              <Progress percent={wordProgress} strokeColor={{ '0%': '#8f6330', '100%': '#3e6988' }} trailColor="rgba(122, 93, 52, 0.1)" />
            </div>
            <div className="novel-overview-progress-card">
              <div className="novel-kicker">章节推进</div>
              <div className="novel-overview-progress-card__value">{chapterProgress}%</div>
              <Progress percent={chapterProgress} strokeColor={{ '0%': '#8f6330', '100%': '#3e6988' }} trailColor="rgba(122, 93, 52, 0.1)" />
            </div>
          </div>
        </WorkspacePanel>
      )}
    >
      {!currentNovel?.synopsis || !currentNovel?.userBackground ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 18 }}
          message="基础资料还不够稳"
          description="至少先补简介和原始背景，再去批量生成核心设定、人物和世界规则，否则后续文本会更像模板拼装。"
        />
      ) : null}

      <div className="novel-grid novel-grid--2 novel-overview-grid novel-overview-grid--primary">
        <WorkspacePanel
          title="基础资料编辑台"
          description="保存后，核心设定、世界规则、人物、时间轴和正文写作都会读取这里的最新信息。"
          className="novel-overview-studio"
        >
          <div className="novel-overview-studio__layout">
            <Form form={form} layout="vertical" className="novel-overview-studio__form">
              <div className="novel-overview-studio__title-row">
                <Form.Item
                  label="小说标题"
                  name="title"
                  rules={[{ required: true, message: '请先填写标题' }]}
                >
                  <Input size="large" maxLength={80} placeholder="先给这本书一个能代表气质的标题" />
                </Form.Item>

                <Form.Item
                  label="目标字数"
                  name="targetWords"
                  rules={[{ required: true, message: '请填写目标字数' }]}
                >
                  <InputNumber size="large" min={10000} max={5000000} step={10000} style={{ width: '100%' }} />
                </Form.Item>
              </div>

              <Form.Item
                label="一句话简介"
                name="synopsis"
                rules={[{ required: true, message: '请填写简介' }]}
              >
                <Input.TextArea rows={5} maxLength={300} placeholder="写清主角处境、目标和最硬的阻力，不要只写氛围词。" />
              </Form.Item>

              <Form.Item
                label="原始背景"
                name="userBackground"
                rules={[{ required: true, message: '请填写原始背景' }]}
              >
                <Input.TextArea rows={7} maxLength={1600} placeholder="这里写你脑海里的原始设想：时代、题材、关键处境、危险来源、人物困局。" />
              </Form.Item>

              <Form.Item
                label="扩展背景"
                name="expandedBackground"
              >
                <Input.TextArea rows={9} maxLength={4000} placeholder="把环境压力、组织秩序、资源条件、敌我关系、制度代价写实。这里越清楚，后面越不容易生成空话。" />
              </Form.Item>
            </Form>
          </div>
        </WorkspacePanel>

        <WorkspacePanel title="故事核心快照" description="先看这本书有没有真正稳定的主轴，而不是好看的说法。">
          <div className="novel-grid">
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">一句话简介</div>
              <div>{synopsis}</div>
            </div>
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">故事目标</div>
              <div>{storySettings.story_goal || '还没有明确故事最终要抵达什么状态。'}</div>
            </div>
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">核心冲突</div>
              <div>{storySettings.core_conflict || '还没有写清“为什么这件事做不到，以及必须为此牺牲什么”。'}</div>
            </div>
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">主线推进</div>
              <div>{storySettings.main_plot || '还没有把主线拆成连续推进的事件链。'}</div>
            </div>
          </div>
        </WorkspacePanel>
      </div>

      <div className="novel-grid novel-grid--2 novel-overview-grid">
        <WorkspacePanel title="背景压力快照" description="背景不是装饰，它决定人物为什么必须这样做。">
          <div className="novel-grid">
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">原始背景</div>
              <div>{userBackground}</div>
            </div>
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">扩展背景</div>
              <div>{expandedBackground}</div>
            </div>
          </div>
        </WorkspacePanel>

        <WorkspacePanel title="世界规则快照" description="看这本书的硬边界是否已经能承受后续生成。">
          <div className="novel-grid">
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">地图蓝图</div>
              <div>{worldRules.mapBlueprint.overview || '还没有明确区域层级、行动半径与落点结构。'}</div>
            </div>
            <div className="novel-overview-signal-card">
              <div className="novel-kicker">语言约束</div>
              <div>{writingConstraintSummary.slice(0, 3).join('；') || '还没有额外语言硬约束。'}</div>
            </div>
          </div>
        </WorkspacePanel>
      </div>

      <WorkspacePanel title="结构资产就绪度" description="点击任意模块继续补齐，不需要按死板顺序操作，但要优先补真正影响后续生成准确度的模块。">
        <div className="novel-grid novel-grid--3">
          {readinessItems.map((item) => (
            <button
              key={item.title}
              type="button"
              className={`novel-list-card ${item.ready ? 'novel-list-card--active' : ''}`}
              onClick={item.action}
              style={{ cursor: 'pointer', textAlign: 'left' }}
            >
              <div className="novel-kicker">{item.ready ? '已就绪' : '待补齐'}</div>
              <div className="novel-list-card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {item.icon}
                {item.title}
              </div>
              <div className="novel-list-card__desc">{item.summary}</div>
              <div className="novel-list-card__desc" style={{ marginTop: 8, color: 'var(--workspace-accent)' }}>
                {item.detail}
              </div>
            </button>
          ))}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
