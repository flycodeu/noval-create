import React, { useEffect, useMemo, useState } from 'react'
import { Button, Progress, Space, Tag } from 'antd'
import {
  BarsOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
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
  WorkspaceTip,
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

function getStatusLabel(status?: string) {
  switch (status) {
    case 'writing':
      return '写作中'
    case 'completed':
      return '已完稿'
    case 'archived':
      return '已归档'
    default:
      return '草稿中'
  }
}

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel } = useNovelStore()
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

  const storySettings = useMemo(() => safeParse<Record<string, string>>(currentNovel?.settingsJson), [currentNovel?.settingsJson])
  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )

  const targetWords = currentNovel?.targetWords || 0
  const wordProgress = targetWords > 0 ? Math.min(100, Math.round((stats.totalWords / targetWords) * 100)) : 0
  const chapterProgress = stats.totalChapters > 0 ? Math.round((stats.completedChapters / stats.totalChapters) * 100) : 0

  const readinessItems = [
    {
      title: '核心设定',
      summary: '主题、核心冲突、主线和结局是否已经成形。',
      ready: Boolean(currentNovel?.settingsJson),
      detail: [storySettings.story_goal, storySettings.core_conflict].filter(Boolean).length > 0
        ? `${[storySettings.story_goal, storySettings.core_conflict].filter(Boolean).length}/2 个关键锚点已填写`
        : '建议先明确故事目标与核心冲突',
      action: () => navigate(`/novels/${novelId}/core-settings`),
      icon: <SettingOutlined />,
    },
    {
      title: '世界规则',
      summary: '等级、种族、势力、时间制和语言约束。',
      ready: Boolean(currentNovel?.worldRulesJson),
      detail: `${worldRules.powerSystems.length} 套体系 / ${worldRules.speciesSystem.length} 个种族 / ${worldRules.factionSystem.length} 个势力`,
      action: () => navigate(`/novels/${novelId}/world-rules`),
      icon: <GlobalOutlined />,
    },
    {
      title: '地图结构',
      summary: '国家、势力、宗门、基地与具体场景。',
      ready: stats.mapNodeCount > 0,
      detail: stats.mapNodeCount > 0 ? `已生成 ${stats.mapNodeCount} 个地图节点` : '尚未生成地图骨架',
      action: () => navigate(`/novels/${novelId}/map`),
      icon: <EnvironmentOutlined />,
    },
    {
      title: '人物与关系',
      summary: '主角、关键配角、阵营和互动张力。',
      ready: stats.characterCount > 0,
      detail: stats.characterCount > 0 ? `已整理 ${stats.characterCount} 位角色` : '尚未建立角色网络',
      action: () => navigate(`/novels/${novelId}/characters`),
      icon: <TeamOutlined />,
    },
    {
      title: '事件时间轴',
      summary: '明确时间、地点、在场人物、结果与后续回收。',
      ready: stats.timelineCount > 0,
      detail: stats.timelineCount > 0 ? `已记录 ${stats.timelineCount} 个关键事件` : '尚未生成事件链',
      action: () => navigate(`/novels/${novelId}/timeline`),
      icon: <ClockCircleOutlined />,
    },
    {
      title: '故事大纲',
      summary: '故事弧、章节推进和节奏安排。',
      ready: stats.outlineCount > 0,
      detail: stats.outlineCount > 0 ? `已规划 ${stats.outlineCount} 条故事弧` : '尚未拆分故事弧',
      action: () => navigate(`/novels/${novelId}/outline`),
      icon: <BarsOutlined />,
    },
  ]

  const nextFocus = readinessItems.find((item) => !item.ready)?.title || '进入正文写作，继续把结构落到章节'
  const synopsis = currentNovel?.synopsis?.trim() || '还没有写简介，建议先用 1-2 段说清故事气质与核心矛盾。'
  const background = currentNovel?.expandedBackground?.trim() || '还没有扩展背景，世界观细节会影响人物、地图、物品和时间轴生成。'

  return (
    <WorkspacePage
      eyebrow="Editorial Dashboard"
      title={currentNovel?.title || '创作概览'}
      description="把小说当前的设定完整度、结构资产和写作进度放在同一块面板里看。你可以先找缺口，再决定下一步是补设定、补结构，还是直接推进正文。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/writing`)}>
            进入正文写作
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate(`/novels/${novelId}/core-settings`)}>
            调整核心设定
          </Button>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="累计字数" value={`${stats.totalWords.toLocaleString()} 字`} tone="warm" hint={`目标 ${targetWords > 0 ? `${targetWords.toLocaleString()} 字` : '未设置'}`} />
          <WorkspaceMetric label="章节完成度" value={`${stats.completedChapters}/${stats.totalChapters || 0}`} hint={`完成率 ${chapterProgress}%`} />
          <WorkspaceMetric label="结构资产" value={`${stats.characterCount + stats.itemCount + stats.timelineCount + stats.mapNodeCount}`} tone="cool" hint="人物、物品、事件与地图节点总和" />
          <WorkspaceMetric label="当前焦点" value={nextFocus} hint="概览会优先提示你最短板的部分" />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置题材' },
            { label: '状态', value: getStatusLabel(currentNovel?.status) },
            { label: '世界层级', value: `${worldRules.mapBlueprint.levels.length} 层地图蓝图 / ${worldRules.timelineConfig.calendarType}` },
            { label: '语言约束', value: `${worldRules.writingConstraints.forbiddenPhrases.length} 条禁用词 / ${worldRules.genreProfile.languageAvoidances.length} 条题材禁忌` },
          ]}
        />
      )}
      aside={(
        <>
          <WorkspaceTip title="当前最值得先补什么">
            <div>如果「核心设定」或「世界规则」还没成形，优先补这两步。后面的角色、物品、地图和时间轴都会依赖它们。</div>
            <div>如果结构资产已经齐了，就可以切去正文页，把章节和时间轴、人物状态一起联动使用。</div>
          </WorkspaceTip>

          <WorkspacePanel title="创作温度计" description="看两条最关键的完成度">
            <div className="novel-grid">
              <div>
                <div className="novel-kicker">字数推进</div>
                <Progress percent={wordProgress} strokeColor={{ '0%': '#8f6330', '100%': '#3e6988' }} trailColor="rgba(122, 93, 52, 0.1)" />
              </div>
              <div>
                <div className="novel-kicker">章节完稿</div>
                <Progress percent={chapterProgress} strokeColor={{ '0%': '#8f6330', '100%': '#3e6988' }} trailColor="rgba(122, 93, 52, 0.1)" />
              </div>
            </div>
          </WorkspacePanel>

          <WorkspacePanel title="世界结构摘要" description="这部分会直接影响后续生成结果">
            <div className="novel-note-list">
              <div className="novel-note-list__item">力量体系：{worldRules.powerSystems.length} 套</div>
              <div className="novel-note-list__item">种族与存在类型：{worldRules.speciesSystem.length} 个</div>
              <div className="novel-note-list__item">势力结构：{worldRules.factionSystem.length} 个</div>
              <div className="novel-note-list__item">推荐事件类型：{worldRules.timelineConfig.recommendedEventTypes.slice(0, 4).join('、') || '尚未设定'}</div>
            </div>
          </WorkspacePanel>
        </>
      )}
    >
      <WorkspacePanel
        title="创作进度"
        description="总字数和章节进度只是外层指标，真正决定后续写作顺不顺的是设定与结构资产是否跟上。"
        extra={<Tag color="blue">{getStatusLabel(currentNovel?.status)}</Tag>}
      >
        <div className="novel-grid novel-grid--2">
          <div className="novel-note-list__item">
            <div className="novel-kicker">字数进度</div>
            <div style={{ marginTop: 10, color: 'var(--workspace-ink)', fontSize: 26, fontWeight: 700 }}>
              {(stats.totalWords / 10000).toFixed(1)} 万 / {targetWords > 0 ? `${(targetWords / 10000).toFixed(0)} 万` : '未设目标'}
            </div>
            <div style={{ marginTop: 10 }}>
              <Progress percent={wordProgress} strokeColor={{ '0%': '#8f6330', '100%': '#3e6988' }} trailColor="rgba(122, 93, 52, 0.1)" />
            </div>
          </div>
          <div className="novel-note-list__item">
            <div className="novel-kicker">章节推进</div>
            <div style={{ marginTop: 10, color: 'var(--workspace-ink)', fontSize: 26, fontWeight: 700 }}>
              {stats.completedChapters} / {stats.totalChapters || 0} 章
            </div>
            <div style={{ marginTop: 10 }}>
              <Progress percent={chapterProgress} strokeColor={{ '0%': '#8f6330', '100%': '#3e6988' }} trailColor="rgba(122, 93, 52, 0.1)" />
            </div>
          </div>
        </div>
      </WorkspacePanel>

      <div className="novel-grid novel-grid--2">
        <WorkspacePanel title="故事核心快照" description="先看故事是否已经有稳定的主轴。">
          <div className="novel-note-list">
            <div className="novel-note-list__item">
              <div className="novel-kicker">简介</div>
              <div>{synopsis}</div>
            </div>
            <div className="novel-note-list__item">
              <div className="novel-kicker">故事目标</div>
              <div>{storySettings.story_goal || '还没有明确故事最终要抵达什么状态。'}</div>
            </div>
            <div className="novel-note-list__item">
              <div className="novel-kicker">核心冲突</div>
              <div>{storySettings.core_conflict || '还没有明确阻碍目标实现的核心对立。'}</div>
            </div>
          </div>
        </WorkspacePanel>

        <WorkspacePanel title="世界与背景快照" description="背景不是装饰，它会决定所有模块的合理性。">
          <div className="novel-note-list">
            <div className="novel-note-list__item">
              <div className="novel-kicker">扩展背景</div>
              <div>{background}</div>
            </div>
            <div className="novel-note-list__item">
              <div className="novel-kicker">地图蓝图</div>
              <div>{worldRules.mapBlueprint.overview || '还没有明确地图层级与地域结构。'}</div>
            </div>
          </div>
        </WorkspacePanel>
      </div>

      <WorkspacePanel title="结构资产就绪度" description="点击任何模块都可以继续补齐，不需要按死板顺序操作。">
        <div className="novel-grid novel-grid--3">
          {readinessItems.map((item) => (
            <button
              key={item.title}
              type="button"
              className={`novel-list-card ${item.ready ? 'novel-list-card--active' : ''}`}
              onClick={item.action}
              style={{ cursor: 'pointer', textAlign: 'left' }}
            >
              <div className="novel-kicker">{item.ready ? '已就绪' : '待完善'}</div>
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
