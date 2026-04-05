import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, Modal, Progress, Spin, Table, Tag, Tooltip } from 'antd'
import VirtualList from 'rc-virtual-list'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'

interface Props { novelId: number }

interface QualityDimensionScore {
  name: string
  score: number
  feedback: string
  suggestion: string
}

interface QualityChapterEntry {
  chapterId: number
  chapterNum: number
  title: string
  overallScore: number
  aiLikeRate: number
  weakDimensions: string[]
  dimensions: QualityDimensionScore[]
}

interface QualityHeatmapPoint {
  chapterNum: number
  dimension: string
  score: number
}

interface QualityDashboardData {
  heatmapData: QualityHeatmapPoint[]
  overallScoreTrend: Array<{ chapterNum: number; score: number }>
  aiLikeRateTrend: Array<{ chapterNum: number; rate: number }>
  weakDimensionFrequency: Array<{ dimension: string; count: number }>
  chapterDetails: QualityChapterEntry[]
  totalChaptersScored: number
  averageOverallScore: number
  averageAiLikeRate: number
}

const DIMENSION_NAMES = [
  '文笔质量', '逻辑连贯', '节奏控制', '情感深度',
  '人物塑造', '世界一致', '创新性', '追读欲',
]

function scoreColor(score: number): string {
  if (score >= 8) return '#52c41a'
  if (score >= 6) return '#faad14'
  if (score >= 4) return '#fa8c16'
  return '#f5222d'
}

function heatmapCellColor(score: number): string {
  if (score >= 9) return '#135200'
  if (score >= 8) return '#237804'
  if (score >= 7) return '#389e0d'
  if (score >= 6) return '#52c41a'
  if (score >= 5) return '#fadb14'
  if (score >= 4) return '#faad14'
  if (score >= 3) return '#fa8c16'
  return '#f5222d'
}

export default function QualityDashboard({ novelId }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<QualityDashboardData | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<QualityChapterEntry | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electron.quality.getDashboard(novelId)
      setData(result)
    } catch (error) {
      console.error('Failed to load quality dashboard', error)
    } finally {
      setLoading(false)
    }
  }, [novelId])

  useEffect(() => { void loadData() }, [loadData])

  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', padding: 80 }} />

  if (!data || data.totalChaptersScored === 0) {
    return (
      <WorkspacePage title="质量监控" description="查看各章节的AI评分与质量趋势。">
        <WorkspacePanel title="暂无数据">
          <Empty description="还没有章节评分数据。先对章节运行AI评分后再来查看。" />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      title="质量监控"
      description="查看各章节的AI评分与质量趋势。"
      metrics={[
        <WorkspaceMetric key="scored" label="已评分章节" value={data.totalChaptersScored} />,
        <WorkspaceMetric key="avg" label="平均总分" value={data.averageOverallScore} suffix="/ 10" />,
        <WorkspaceMetric key="ailike" label="平均AI味率" value={data.averageAiLikeRate} suffix="%" />,
      ]}
    >
      <WorkspacePanel title="质量热力图" description="X=章节，Y=评分维度，颜色越绿越好。">
        <HeatmapChart data={data.heatmapData} chapterNums={data.overallScoreTrend.map((d) => d.chapterNum)} />
      </WorkspacePanel>

      <WorkspacePanel title="评分趋势" description="总分与AI味率逐章变化。">
        <TrendChart
          overallTrend={data.overallScoreTrend}
          aiLikeTrend={data.aiLikeRateTrend}
        />
      </WorkspacePanel>

      <WorkspacePanel title="薄弱维度分析" description="各维度被标记为薄弱项的频次。">
        <WeakDimensionChart data={data.weakDimensionFrequency} />
      </WorkspacePanel>

      <WorkspacePanel title="章节详情" description="点击查看某章完整评分。">
        <div style={{ height: 480 }}>
          <VirtualList data={data.chapterDetails} height={480} itemHeight={56} itemKey="chapterId">
            {(entry: QualityChapterEntry) => (
              <div
                key={entry.chapterId}
                className="quality-chapter-row"
                onClick={() => setSelectedChapter(entry)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                }}
              >
                <span style={{ width: 60, fontWeight: 500 }}>第{entry.chapterNum}章</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                <Progress
                  type="circle"
                  percent={entry.overallScore * 10}
                  size={36}
                  strokeColor={scoreColor(entry.overallScore)}
                  format={() => entry.overallScore.toFixed(1)}
                />
                <Tag color={entry.aiLikeRate > 50 ? 'red' : entry.aiLikeRate > 30 ? 'orange' : 'green'}>
                  AI味 {entry.aiLikeRate}%
                </Tag>
                {entry.weakDimensions.length > 0 ? (
                  <Tooltip title={entry.weakDimensions.join('、')}>
                    <Tag color="warning">{entry.weakDimensions.length} 项薄弱</Tag>
                  </Tooltip>
                ) : null}
              </div>
            )}
          </VirtualList>
        </div>
      </WorkspacePanel>

      <Modal
        title={selectedChapter ? `第${selectedChapter.chapterNum}章 · ${selectedChapter.title}` : '章节评分'}
        open={!!selectedChapter}
        onCancel={() => setSelectedChapter(null)}
        footer={null}
        width={600}
      >
        {selectedChapter ? (
          <div style={{ display: 'grid', gap: 16, padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="dashboard"
                  percent={selectedChapter.overallScore * 10}
                  strokeColor={scoreColor(selectedChapter.overallScore)}
                  format={() => <span style={{ fontSize: 20 }}>{selectedChapter.overallScore}</span>}
                />
                <div style={{ marginTop: 4 }}>总分</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="dashboard"
                  percent={100 - selectedChapter.aiLikeRate}
                  strokeColor={selectedChapter.aiLikeRate > 50 ? '#f5222d' : selectedChapter.aiLikeRate > 30 ? '#faad14' : '#52c41a'}
                  format={() => <span style={{ fontSize: 20 }}>{selectedChapter.aiLikeRate}%</span>}
                />
                <div style={{ marginTop: 4 }}>AI味率</div>
              </div>
            </div>
            {selectedChapter.dimensions.map((dim) => (
              <div key={dim.name} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>{dim.name}</span>
                  <Tag color={scoreColor(dim.score)} style={{ marginRight: 0 }}>{dim.score}</Tag>
                </div>
                <Progress
                  percent={dim.score * 10}
                  showInfo={false}
                  strokeColor={scoreColor(dim.score)}
                  size="small"
                />
                {dim.feedback ? <div style={{ fontSize: 12, opacity: 0.7 }}>{dim.feedback}</div> : null}
                {dim.suggestion ? <div style={{ fontSize: 12, opacity: 0.55 }}>{dim.suggestion}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </WorkspacePage>
  )
}

function HeatmapChart({ data, chapterNums }: { data: QualityHeatmapPoint[]; chapterNums: number[] }) {
  const byDim = useMemo(() => {
    const map = new Map<string, Map<number, number>>()
    for (const p of data) {
      if (!map.has(p.dimension)) map.set(p.dimension, new Map())
      map.get(p.dimension)!.set(p.chapterNum, p.score)
    }
    return map
  }, [data])

  const dimensions = useMemo(() => {
    const seen = new Set<string>()
    for (const p of data) seen.add(p.dimension)
    return DIMENSION_NAMES.filter((d) => seen.has(d))
  }, [data])

  const displayNums = chapterNums.length > 50 ? chapterNums.filter((_, i) => i % Math.ceil(chapterNums.length / 50) === 0) : chapterNums

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `100px repeat(${displayNums.length}, 28px)`, gap: 2, fontSize: 11 }}>
        <div />
        {displayNums.map((num) => (
          <div key={num} style={{ textAlign: 'center', opacity: 0.6 }}>{num}</div>
        ))}
        {dimensions.map((dim) => (
          <React.Fragment key={dim}>
            <div style={{ lineHeight: '24px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dim}</div>
            {displayNums.map((num) => {
              const score = byDim.get(dim)?.get(num)
              return (
                <Tooltip key={num} title={score != null ? `${dim}: ${score}` : '无数据'}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 3,
                      background: score != null ? heatmapCellColor(score) : 'rgba(255,255,255,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: '#fff',
                    }}
                  >
                    {score != null ? score : ''}
                  </div>
                </Tooltip>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function TrendChart({ overallTrend, aiLikeTrend }: {
  overallTrend: Array<{ chapterNum: number; score: number }>
  aiLikeTrend: Array<{ chapterNum: number; rate: number }>
}) {
  if (overallTrend.length === 0) return <Empty description="暂无趋势数据" />

  const maxScore = 10
  const maxRate = 100
  const chartHeight = 200
  const chartWidth = Math.max(400, overallTrend.length * 16)

  const toScorePath = (points: Array<{ chapterNum: number; value: number }>, maxVal: number) => {
    if (points.length === 0) return ''
    const stepX = chartWidth / Math.max(points.length - 1, 1)
    return points.map((p, i) => {
      const x = i * stepX
      const y = chartHeight - (p.value / maxVal) * chartHeight
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    }).join(' ')
  }

  const overallPath = toScorePath(overallTrend.map((d) => ({ chapterNum: d.chapterNum, value: d.score })), maxScore)
  const aiLikePath = toScorePath(aiLikeTrend.map((d) => ({ chapterNum: d.chapterNum, value: d.rate })), maxRate)

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12 }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 3, background: '#52c41a', marginRight: 4 }} />总分 (0-10)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 3, background: '#f5222d', marginRight: 4 }} />AI味率 (0-100%)</span>
      </div>
      <svg width={chartWidth} height={chartHeight + 20} style={{ minWidth: 400 }}>
        <path d={overallPath} fill="none" stroke="#52c41a" strokeWidth={2} />
        <path d={aiLikePath} fill="none" stroke="#f5222d" strokeWidth={1.5} strokeDasharray="4,3" />
        <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="rgba(255,255,255,0.1)" />
      </svg>
    </div>
  )
}

function WeakDimensionChart({ data }: { data: Array<{ dimension: string; count: number }> }) {
  const filtered = data.filter((d) => d.count > 0)
  if (filtered.length === 0) return <Empty description="暂无薄弱维度" />

  const maxCount = Math.max(...filtered.map((d) => d.count), 1)

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {filtered.map((item) => (
        <div key={item.dimension} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 80, fontSize: 13, textAlign: 'right' }}>{item.dimension}</span>
          <div style={{ flex: 1, height: 20, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${(item.count / maxCount) * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #fa8c16, #f5222d)',
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
          <span style={{ width: 40, fontSize: 12, opacity: 0.7 }}>{item.count} 次</span>
        </div>
      ))}
    </div>
  )
}
