import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, Modal, Progress, Spin, Tag, Tooltip } from 'antd'
import VirtualList from 'rc-virtual-list'
import type { LanguageDriftMetrics, QualityDashboardData } from '../../../types'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'

interface Props { novelId: number }

type QualityChapterEntry = QualityDashboardData['chapterDetails'][number]
type QualityHeatmapPoint = QualityDashboardData['heatmapData'][number]

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

function languageDriftRiskColor(value: number): string {
  if (value >= 70) return '#f5222d'
  if (value >= 50) return '#fa8c16'
  if (value >= 30) return '#faad14'
  return '#52c41a'
}

function languageDriftStatusLabel(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return '恶化中'
  if (status === 'improving') return '改善中'
  return '稳定'
}

function languageDriftStatusColor(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

function dialogueSimilarityColor(value: number): string {
  if (value >= 85) return '#f5222d'
  if (value >= 75) return '#fa8c16'
  if (value >= 60) return '#faad14'
  return '#52c41a'
}

function dialogueTrendLabel(status: QualityDashboardData['dialogueDriftTrend'][number]['status']): string {
  if (status === 'worsening') return '漂移加剧'
  if (status === 'improving') return '回稳中'
  return '稳定'
}

function dialogueTrendColor(status: QualityDashboardData['dialogueDriftTrend'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

function formatSignedValue(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function storyAlertColor(severity: QualityDashboardData['storyPacingAlerts'][number]['severity']): string {
  return severity === 'blocker' ? 'error' : 'warning'
}

function pressureColor(value: number): string {
  if (value >= 80) return '#f5222d'
  if (value >= 60) return '#fa8c16'
  if (value >= 40) return '#faad14'
  return '#52c41a'
}

function paceMarkerLabel(marker?: QualityDashboardData['storyDynamicsTrend'][number]['paceMarker']): string {
  if (marker === 'setup') return '铺垫'
  if (marker === 'conflict') return '冲突'
  if (marker === 'reversal') return '反转'
  if (marker === 'climax') return '高潮'
  if (marker === 'payoff') return '回收'
  if (marker === 'breather') return '喘息'
  return '未标注'
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

  const hasScoreData = Boolean(data && data.totalChaptersScored > 0)
  const hasStoryDynamicsData = Boolean(data && data.protagonistSetbackSummary.chapterCount > 0)
  const hasDialogueData = Boolean(data && data.dialogueFingerprintStats.eligibleCharacterCount > 0)

  if (!data || (!hasScoreData && !hasStoryDynamicsData && !hasDialogueData)) {
    return (
      <WorkspacePage title="质量监控" description="查看各章节的AI评分与质量趋势。">
        <WorkspacePanel title="暂无数据">
          <Empty description="还没有可用的 AI 评分、对白指纹或结构节奏跟踪数据。先运行章节审校或 AI 评分后再来查看。" />
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
        <WorkspaceMetric key="tracked" label="节奏追踪章节" value={data.protagonistSetbackSummary.chapterCount} />,
        <WorkspaceMetric key="avg" label="平均总分 / 压力" value={hasScoreData ? `${data.averageOverallScore} / 10` : `${data.protagonistSetbackSummary.averagePressure}`} />,
      ]}
    >
      {hasScoreData ? (
        <>
          <WorkspacePanel title="质量热力图" description="X=章节，Y=评分维度，颜色越绿越好。">
            <HeatmapChart data={data.heatmapData} chapterNums={data.overallScoreTrend.map((d) => d.chapterNum)} />
          </WorkspacePanel>

          <WorkspacePanel title="评分趋势" description="总分与AI味率逐章变化。">
            <TrendChart
              overallTrend={data.overallScoreTrend}
              aiLikeTrend={data.aiLikeRateTrend}
            />
          </WorkspacePanel>

          <WorkspacePanel title="AI味分解" description="拆开看语言退化由哪些问题构成。">
            <LanguageDriftPanel
              averages={data.averageLanguageDrift}
              trends={data.languageDriftTrends}
              recentAlerts={data.recentLanguageDriftAlerts}
              volumeEntries={data.volumeLanguageDrift}
              novelSummary={data.novelLanguageDriftSummary}
            />
          </WorkspacePanel>

        </>
      ) : null}

      {data.dialogueFingerprintStats.eligibleCharacterCount > 0 ? (
        <WorkspacePanel title="角色对白辨识度" description="查看角色之间是否越说越像，以及谁正在偏离自己的语音指纹。">
          <DialogueFingerprintPanel
            stats={data.dialogueFingerprintStats}
            signatures={data.characterDialogueSignatures}
            similarities={data.crossCharacterDialogueSimilarity}
            driftEntries={data.dialogueDriftTrend}
            volumeEntries={data.volumeDialogueSimilarity}
            alerts={data.recentDialogueAlerts}
          />
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="主角受挫与节奏" description="跨章节查看主角受挫、代价持续、反转与高潮分布。">
        <StoryDynamicsPanel
          trend={data.storyDynamicsTrend}
          alerts={data.storyPacingAlerts}
          protagonistSummary={data.protagonistSetbackSummary}
          costSummary={data.costPersistenceSummary}
          reversalSummary={data.reversalDistributionSummary}
          volumeEntries={data.volumeStoryDynamics}
        />
      </WorkspacePanel>

      {hasScoreData ? (
        <>
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
        </>
      ) : null}

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
            <LanguageDriftDetails metrics={selectedChapter.languageDriftMetrics} />
            <DialogueReviewDetails review={selectedChapter.dialogueReview} />
            <StoryDynamicsDetails dynamics={selectedChapter.storyDynamics} />
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

const LANGUAGE_DRIFT_LABELS: Array<{ key: keyof LanguageDriftMetrics; label: string }> = [
  { key: 'abstractTokenDensity', label: '抽象词密度' },
  { key: 'sentencePatternRepeatRate', label: '句式重复率' },
  { key: 'endingSummaryRate', label: '段尾升华率' },
  { key: 'ornamentOverloadRate', label: '华丽词堆砌率' },
  { key: 'nonHumanCollocationRate', label: '非人类搭配率' },
]

function getTopLanguageDriftMetrics(metrics: LanguageDriftMetrics, limit = 3) {
  return [...LANGUAGE_DRIFT_LABELS]
    .map(({ key, label }) => ({ key, label, value: metrics[key] }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit)
}

function LanguageDriftPanel({
  averages,
  trends,
  recentAlerts,
  volumeEntries,
  novelSummary,
}: {
  averages: LanguageDriftMetrics
  trends: QualityDashboardData['languageDriftTrends']
  recentAlerts: QualityDashboardData['recentLanguageDriftAlerts']
  volumeEntries: QualityDashboardData['volumeLanguageDrift']
  novelSummary: QualityDashboardData['novelLanguageDriftSummary']
}) {
  const hasAnyData = LANGUAGE_DRIFT_LABELS.some(({ key }) => trends[key].length > 0)
  if (!hasAnyData) {
    return <Empty description="暂无 AI 味分解数据" />
  }
  const cards = LANGUAGE_DRIFT_LABELS.map(({ key, label }) => ({ key, label, value: averages[key] }))
  const topRiskMetrics = novelSummary.topRiskMetrics.slice(0, 3)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {cards.map((card) => (
          <div
            key={card.key}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: languageDriftRiskColor(card.value) }}>{card.value}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>平均风险值，越低越好</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>全书级摘要</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            已纳入 {novelSummary.chapterCount} 章
            {novelSummary.recentWindowSize > 0 ? ` · 最近窗口 ${novelSummary.recentWindowSize} 章` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag color="error">恶化 {novelSummary.statusBreakdown.worsening}</Tag>
            <Tag color="success">改善 {novelSummary.statusBreakdown.improving}</Tag>
            <Tag>稳定 {novelSummary.statusBreakdown.stable}</Tag>
          </div>
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>当前最高风险</div>
          {topRiskMetrics.length > 0 ? topRiskMetrics.map((item) => (
            <div key={item.metric} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
              <span style={{ opacity: 0.85 }}>{item.label}</span>
              <span style={{ fontWeight: 600, color: languageDriftRiskColor(item.value) }}>{item.value}</span>
            </div>
          )) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>暂无分解数据</div>
          )}
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>最近恶化项</div>
          {recentAlerts.length > 0 ? recentAlerts.slice(0, 3).map((alert) => (
            <div key={alert.metric} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Tag color={languageDriftStatusColor(alert.status)} style={{ marginRight: 0 }}>
                    {languageDriftStatusLabel(alert.status)}
                  </Tag>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>{alert.label}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f5222d' }}>{formatSignedValue(alert.delta)}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                窗口均值 {alert.previousValue} → {alert.latestValue}
              </div>
            </div>
          )) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内暂无明显恶化项。</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {LANGUAGE_DRIFT_LABELS.map(({ key, label }) => (
          <MiniTrendRow key={key} label={label} points={trends[key]} />
        ))}
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级语言退化</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => {
              const topMetrics = getTopLanguageDriftMetrics(volume.averageMetrics, 2)
              return (
                <div
                  key={volume.volumeId}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>
                        第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章
                      </div>
                    </div>
                    <Tag color={volume.topWorseningMetrics.length > 0 ? 'warning' : 'success'} style={{ marginRight: 0 }}>
                      {volume.topWorseningMetrics.length > 0 ? `${volume.topWorseningMetrics.length} 项恶化` : '近期稳定'}
                    </Tag>
                  </div>

                  <div style={{ display: 'grid', gap: 6 }}>
                    {topMetrics.map((item) => (
                      <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                        <span style={{ opacity: 0.85 }}>{item.label}</span>
                        <span style={{ fontWeight: 600, color: languageDriftRiskColor(item.value) }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {volume.topWorseningMetrics.length > 0
                      ? `近期恶化：${volume.topWorseningMetrics.map((item) => `${item.label} ${formatSignedValue(item.delta)}`).join('、')}`
                      : '最近窗口内暂无明显恶化项。'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MiniTrendRow({
  label,
  points,
}: {
  label: string
  points: Array<{ chapterNum: number; value: number }>
}) {
  if (points.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
        <span>{label}</span>
        <span>暂无分解数据</span>
      </div>
    )
  }

  const width = Math.max(200, points.length * 12)
  const height = 36
  const stepX = width / Math.max(points.length - 1, 1)
  const path = points.map((point, index) => {
    const x = index * stepX
    const y = height - (Math.max(0, Math.min(100, point.value)) / 100) * height
    return `${index === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
  const latest = points[points.length - 1]?.value ?? 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 56px', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{label}</span>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={height + 4} style={{ minWidth: 200 }}>
          <path d={path} fill="none" stroke={languageDriftRiskColor(latest)} strokeWidth={2} />
        </svg>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: languageDriftRiskColor(latest) }}>{latest}</span>
    </div>
  )
}

function DialogueFingerprintPanel({
  stats,
  signatures,
  similarities,
  driftEntries,
  volumeEntries,
  alerts,
}: {
  stats: QualityDashboardData['dialogueFingerprintStats']
  signatures: QualityDashboardData['characterDialogueSignatures']
  similarities: QualityDashboardData['crossCharacterDialogueSimilarity']
  driftEntries: QualityDashboardData['dialogueDriftTrend']
  volumeEntries: QualityDashboardData['volumeDialogueSimilarity']
  alerts: QualityDashboardData['recentDialogueAlerts']
}) {
  if (stats.eligibleCharacterCount === 0) {
    return <Empty description="暂无足够的角色对白样本" />
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>已建角色指纹</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.eligibleCharacterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>累计识别对白 {stats.totalTurnCount} 段</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>平均跨角色相似度</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: dialogueSimilarityColor(stats.averageCrossCharacterSimilarity) }}>{stats.averageCrossCharacterSimilarity}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>越低越能拉开角色声音</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>高相似组合</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.highSimilarityPairCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>阈值 75 以上</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>漂移角色</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.driftingCharacterCount}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>近期漂移率 45 以上</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>近期告警</div>
          {alerts.length > 0 ? alerts.map((alert, index) => (
            <div key={`${alert.kind}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={alert.severity === 'warning' ? 'warning' : 'default'} style={{ marginRight: 0 }}>
                  {alert.kind === 'similarity' ? '同质化' : '漂移'}
                </Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近没有新的对白指纹告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>最高相似角色组合</div>
          {similarities.length > 0 ? similarities.slice(0, 4).map((pair) => (
            <div key={`${pair.characterAId}-${pair.characterBId}`} style={{ display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                <span>{pair.characterAName} / {pair.characterBName}</span>
                <span style={{ color: dialogueSimilarityColor(pair.similarity), fontWeight: 700 }}>{pair.similarity}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{pair.reasons.join('、') || '句长、停顿和惯用短语接近。'}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>暂无跨角色相似度数据。</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {signatures.slice(0, 6).map((signature) => (
          <div
            key={signature.characterId}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{signature.characterName}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  {signature.sampleCount} 段对白 · {signature.totalDialogueChars} 字
                </div>
              </div>
              <Tag style={{ marginRight: 0 }}>{signature.roleType}</Tag>
            </div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{signature.voiceProfile}</div>
            {signature.distinctiveHabits.length > 0 ? (
              <div style={{ fontSize: 11, opacity: 0.65 }}>特点：{signature.distinctiveHabits.join('、')}</div>
            ) : null}
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              句长 {signature.avgSentenceLength} · 追问 {signature.questionRate}% · 停顿 {signature.ellipsisRate}% · 重复短语 {signature.catchphraseCandidates.slice(0, 2).map((item) => item.token).join('、') || '暂无'}
            </div>
          </div>
        ))}
      </div>

      {driftEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>角色语音漂移趋势</div>
          {driftEntries.slice(0, 5).map((entry) => (
            <div key={entry.characterId} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{entry.characterName}</strong>
                  <Tag color={dialogueTrendColor(entry.status)} style={{ marginRight: 0 }}>{dialogueTrendLabel(entry.status)}</Tag>
                </div>
                <span style={{ color: dialogueSimilarityColor(entry.recentDriftRate), fontWeight: 700 }}>{entry.recentDriftRate}</span>
              </div>
              <MiniTrendRow label="漂移率" points={entry.trend.map((point) => ({ chapterNum: point.chapterNum, value: point.value }))} />
              {entry.reasons.length > 0 ? <div style={{ fontSize: 11, opacity: 0.6 }}>{entry.reasons.join('、')}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级对白同质化</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <span style={{ color: dialogueSimilarityColor(volume.averageSimilarity), fontWeight: 700 }}>{volume.averageSimilarity}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>
                  {volume.topPairs.length > 0
                    ? `最像：${volume.topPairs.map((pair) => `${pair.characterAName}/${pair.characterBName} ${pair.similarity}`).join('、')}`
                    : '该卷暂无足够的对比样本。'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsPanel({
  trend,
  alerts,
  protagonistSummary,
  costSummary,
  reversalSummary,
  volumeEntries,
}: {
  trend: QualityDashboardData['storyDynamicsTrend']
  alerts: QualityDashboardData['storyPacingAlerts']
  protagonistSummary: QualityDashboardData['protagonistSetbackSummary']
  costSummary: QualityDashboardData['costPersistenceSummary']
  reversalSummary: QualityDashboardData['reversalDistributionSummary']
  volumeEntries: QualityDashboardData['volumeStoryDynamics']
}) {
  if (protagonistSummary.chapterCount === 0) {
    return <Empty description="暂无主角受挫与节奏跟踪数据" />
  }

  const latestPressure = trend[trend.length - 1]?.pressure ?? 0

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>主角受挫率</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{protagonistSummary.protagonistSetbackRate}%</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>重大受挫 {protagonistSummary.majorSetbackRate}%</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>平均主角压力</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: pressureColor(protagonistSummary.averagePressure) }}>{protagonistSummary.averagePressure}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>最新压力 {latestPressure}</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>顺推 / 压抑跨度</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{protagonistSummary.longestSmoothRun} / {protagonistSummary.longestPressureRun}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>最长连续章节数</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>代价持续</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{costSummary.averageCostDuration}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>蒸发 {costSummary.evaporatedCostCount} 次 · 未解 {costSummary.unresolvedCostCount} 条</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>节奏告警</div>
          {alerts.length > 0 ? alerts.slice(0, 4).map((alert, index) => (
            <div key={`${alert.code}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={storyAlertColor(alert.severity)} style={{ marginRight: 0 }}>{alert.severity === 'blocker' ? '高风险' : '提醒'}</Tag>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{alert.detail}</div>
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>最近窗口内暂无明显结构告警。</div>}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>反转 / 高潮 / 喘息</div>
          <div style={{ fontSize: 12 }}>反转：{reversalSummary.reversalChapterNums.length > 0 ? reversalSummary.reversalChapterNums.join('、') : '暂无'}</div>
          <div style={{ fontSize: 12 }}>高潮：{reversalSummary.climaxChapterNums.length > 0 ? reversalSummary.climaxChapterNums.join('、') : '暂无'}</div>
          <div style={{ fontSize: 12 }}>喘息：{reversalSummary.breatherChapterNums.length > 0 ? reversalSummary.breatherChapterNums.join('、') : '暂无'}</div>
          <div style={{ fontSize: 11, opacity: 0.65 }}>强行反转 {reversalSummary.forcedReversalCount} 次，弱反转 {reversalSummary.weakReversalCount} 次，高潮间距 {reversalSummary.climaxSpacing.length > 0 ? reversalSummary.climaxSpacing.join('、') : '暂无'}。</div>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>未解代价</div>
          {costSummary.activeCosts.length > 0 ? costSummary.activeCosts.map((entry) => (
            <div key={`${entry.startChapterNum}-${entry.summary}`} style={{ fontSize: 12 }}>
              第{entry.startChapterNum}章起持续 {entry.duration} 章：{entry.summary}
            </div>
          )) : <div style={{ fontSize: 12, opacity: 0.6 }}>当前没有持续中的代价链。</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>主角压力曲线</div>
        <MiniTrendRow label="主角压力" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.pressure }))} />
      </div>

      {volumeEntries.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600 }}>卷级结构摘要</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{volume.volumeName}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <Tag color={volume.alerts.length > 0 ? 'warning' : 'success'} style={{ marginRight: 0 }}>{volume.alerts.length > 0 ? `${volume.alerts.length} 项告警` : '近期稳定'}</Tag>
                </div>
                <div style={{ fontSize: 12 }}>受挫率 {volume.protagonistSetbackRate}% · 重大受挫 {volume.majorSetbackRate}% · 平均压力 {volume.averagePressure}</div>
                <div style={{ fontSize: 12 }}>代价持续 {volume.averageCostDuration} 章 · 蒸发 {volume.evaporatedCostCount} 次</div>
                <div style={{ fontSize: 12 }}>高潮 {volume.climaxChapterNums.length > 0 ? volume.climaxChapterNums.join('、') : '暂无'} · 反转 {volume.reversalChapterNums.length > 0 ? volume.reversalChapterNums.join('、') : '暂无'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LanguageDriftDetails({ metrics }: { metrics?: LanguageDriftMetrics }) {
  if (!metrics) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>暂无 AI 味分解数据</div>
  }

  const ranked = getTopLanguageDriftMetrics(metrics, LANGUAGE_DRIFT_LABELS.length)

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>AI味分解</div>
      {ranked.map((item) => (
        <div key={item.key} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{item.label}</span>
            <span style={{ color: languageDriftRiskColor(item.value), fontWeight: 600 }}>{item.value}</span>
          </div>
          <Progress percent={item.value} showInfo={false} strokeColor={languageDriftRiskColor(item.value)} size="small" />
        </div>
      ))}
    </div>
  )
}

function DialogueReviewDetails({ review }: { review?: QualityDashboardData['chapterDetails'][number]['dialogueReview'] }) {
  if (!review) {
    return <div style={{ fontSize: 12, opacity: 0.55 }}>暂无角色对白辨识度数据</div>
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>角色对白辨识度</div>
      {review.fingerprintSummary ? <div style={{ fontSize: 12 }}>{review.fingerprintSummary}</div> : null}
      {review.risks.length > 0 ? (
        <div style={{ fontSize: 12 }}>风险：{review.risks.join('；')}</div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7 }}>当前章暂无明确的对白同质化风险。</div>
      )}
      {review.similarities.length > 0 ? (
        <div style={{ fontSize: 12 }}>
          高相似：{review.similarities.map((item) => `${item.characterAName}/${item.characterBName} ${item.similarity}`).join('、')}
        </div>
      ) : null}
      {review.drifts.length > 0 ? (
        <div style={{ fontSize: 12 }}>
          漂移：{review.drifts.map((item) => `${item.characterName} ${item.driftRate}`).join('、')}
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsDetails({ dynamics }: { dynamics?: QualityDashboardData['chapterDetails'][number]['storyDynamics'] }) {
  if (!dynamics) return null

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>主角与节奏</div>
      <div style={{ fontSize: 12 }}>主角受挫：{dynamics.protagonistSetback}{dynamics.setbackSummary ? ` · ${dynamics.setbackSummary}` : ''}</div>
      <div style={{ fontSize: 12 }}>主角压力：<span style={{ color: pressureColor(dynamics.protagonistPressure), fontWeight: 600 }}>{dynamics.protagonistPressure}</span></div>
      <div style={{ fontSize: 12 }}>代价：{dynamics.costPresent ? `${dynamics.costResolutionState || 'new'}${dynamics.costSummary ? ` · ${dynamics.costSummary}` : ''}` : '无明确代价'}</div>
      <div style={{ fontSize: 12 }}>反转：{dynamics.reversalMarker ? `${dynamics.reversalSupportState || 'weak'}${dynamics.reversalSummary ? ` · ${dynamics.reversalSummary}` : ''}` : '无'}</div>
      <div style={{ fontSize: 12 }}>节奏标签：{paceMarkerLabel(dynamics.paceMarker)} · 阶段回报：{dynamics.rewardState}</div>
    </div>
  )
}
