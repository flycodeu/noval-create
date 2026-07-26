import { Empty, Progress, Tag } from 'antd'
import type { QualityDashboardData } from '../../../../types'
import { WorkspacePanel } from '../../components/WorkspaceShell'
import {
  getStoryArcSeverityColor,
  getStoryArcSeverityLabel,
  getStoryPacingSeverityColor,
  getStoryPacingSeverityLabel,
} from '../../shared/revision-quality'
import MiniTrendRow from './MiniTrendRow'
import {
  CHAPTER_FUNCTION_ORDER,
  arcProgressRateColor,
  buildChapterGateHeatmapModel,
  chapterFunctionAlertColor,
  chapterFunctionColor,
  chapterFunctionLabel,
  chapterGateAlertColor,
  chapterGateAlertLabel,
  chapterGateBandColor,
  chapterGateBandLabel,
  chapterGateHeatmapColor,
  chapterGateLevelColor,
  chapterGateLevelLabel,
  getVisibleGateAlerts,
  pressureColor,
  summarizeChapterGateTrend,
  type VolumeFilteredDashboard,
} from '../quality-dashboard-presentation'

interface StructureSectionProps {
  data: QualityDashboardData
  filtered: VolumeFilteredDashboard
  selectedVolumeLabel?: string
  hasChapterGateData: boolean
  hasChapterFunctionData: boolean
  hasArcProgressData: boolean
  onSelectChapter: (chapterNum: number) => void
}

/** 结构与推进 Tab：章节验收门、主角节奏、章节功能与故事弧。 */
export default function StructureSection({
  data,
  filtered,
  selectedVolumeLabel,
  hasChapterGateData,
  hasChapterFunctionData,
  hasArcProgressData,
  onSelectChapter,
}: StructureSectionProps) {
  return (
    <>
      {hasChapterGateData ? (
        <WorkspacePanel title="章节验收门">
          <ChapterGatePanel
            summary={data.chapterGateSummary}
            trend={filtered.chapterGateTrend}
            heatmap={filtered.chapterGateHeatmap}
            alerts={filtered.chapterGateAlerts}
            selectedVolumeLabel={selectedVolumeLabel}
            onSelectChapter={onSelectChapter}
          />
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="主角受挫与节奏">
        <StoryDynamicsPanel
          trend={data.storyDynamicsTrend}
          alerts={data.storyPacingAlerts}
          protagonistSummary={data.protagonistSetbackSummary}
          costSummary={data.costPersistenceSummary}
          reversalSummary={data.reversalDistributionSummary}
          volumeEntries={filtered.storyVolumes}
        />
      </WorkspacePanel>

      {hasChapterFunctionData ? (
        <WorkspacePanel title="章节功能与节奏分布">
          <ChapterFunctionPanel
            summary={data.chapterFunctionSummary}
            runs={filtered.chapterFunctionRuns}
            alerts={filtered.chapterFunctionAlerts}
            volumeEntries={filtered.chapterFunctionVolumes}
          />
        </WorkspacePanel>
      ) : null}

      {hasArcProgressData ? (
        <WorkspacePanel title="故事弧推进">
          <StoryArcProgressPanel
            summary={data.storyArcProgressSummary}
            trend={data.storyArcProgressTrend}
            arcs={data.storyArcProgressArcs}
            alerts={data.storyArcProgressAlerts}
            volumeEntries={filtered.arcVolumes}
          />
        </WorkspacePanel>
      ) : null}
    </>
  )
}

function ChapterGatePanel({
  summary,
  trend,
  heatmap,
  alerts,
  selectedVolumeLabel,
  onSelectChapter,
}: {
  summary: QualityDashboardData['chapterGateSummary']
  trend: QualityDashboardData['chapterGateTrend']
  heatmap: QualityDashboardData['chapterGateHeatmap']
  alerts: QualityDashboardData['chapterGateDriftAlerts']
  selectedVolumeLabel?: string
  onSelectChapter: (chapterNum: number) => void
}) {
  if (summary.coveredChapterCount === 0 || trend.length === 0) {
    return <Empty description="先跑一轮章节验收门，历史快照会从这里累计" />
  }

  const { averageVisibleScore, bandCounts, levelCounts } = summarizeChapterGateTrend(trend)
  const visibleAlerts = getVisibleGateAlerts(alerts)
  const { dimensions, chapterNums, valueMap: heatmapValueMap } = buildChapterGateHeatmapModel(heatmap, trend)
  const recentTrend = trend.slice(-8).reverse()

  return (
    <div className="quality-dashboard-page__stack">
      {selectedVolumeLabel ? (
        <div className="quality-dashboard-page__filter-callout">
          当前按卷筛选：{selectedVolumeLabel}。章节验收门趋势、热力图和漂移告警已同步收窄到该卷。
        </div>
      ) : null}

      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均门分</div>
          <div className="quality-dashboard-page__big-number" style={{ color: chapterGateHeatmapColor(averageVisibleScore) }}>{averageVisibleScore}</div>
          <div className="quality-dashboard-page__body-copy--soft">当前视图下最近快照的总分均值</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">稳定 / 关注</div>
          <div className="quality-dashboard-page__big-number">{bandCounts.stable} / {bandCounts.attention}</div>
          <div className="quality-dashboard-page__body-copy--soft">80+ 稳定，60-79 需要关注</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">风险 / 失稳</div>
          <div className="quality-dashboard-page__big-number">{bandCounts.risky} / {bandCounts.unstable}</div>
          <div className="quality-dashboard-page__body-copy--soft">40-59 风险，40 以下失稳</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最近恶化</div>
          <div className="quality-dashboard-page__big-number" style={{ color: visibleAlerts.length > 0 ? '#f5222d' : '#52c41a' }}>{visibleAlerts.filter((alert) => alert.status === 'worsening').length}</div>
          <div className="quality-dashboard-page__body-copy--soft">门级恶化或总分明显回落的章节数</div>
        </div>
      </div>

      <div className="quality-dashboard-page__dual-grid">
        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__section-title">章节门趋势</div>
          <MiniTrendRow label="总分" points={trend.map((entry) => ({ chapterNum: entry.chapterNum, value: entry.totalScore }))} />
          <MiniTrendRow
            label="门级压力"
            points={trend.map((entry) => ({
              chapterNum: entry.chapterNum,
              value: entry.gateLevel === 'rewrite' ? 100 : entry.gateLevel === 'blocker' ? 72 : entry.gateLevel === 'warning' ? 38 : 10,
            }))}
          />
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
            <Tag color={chapterGateLevelColor('pass')} className="quality-dashboard-page__tag-reset">{`通过 ${levelCounts.pass}`}</Tag>
            <Tag color={chapterGateLevelColor('warning')} className="quality-dashboard-page__tag-reset">{`预警 ${levelCounts.warning}`}</Tag>
            <Tag color={chapterGateLevelColor('blocker')} className="quality-dashboard-page__tag-reset">{`阻塞 ${levelCounts.blocker}`}</Tag>
            <Tag color={chapterGateLevelColor('rewrite')} className="quality-dashboard-page__tag-reset">{`重写 ${levelCounts.rewrite}`}</Tag>
          </div>
        </div>

        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__section-title">最近漂移告警</div>
          {visibleAlerts.length > 0 ? visibleAlerts.map((alert) => (
            <button
              key={`${alert.chapterId}-${alert.createdAt}`}
              type="button"
              onClick={() => onSelectChapter(alert.chapterNum)}
              className="quality-dashboard-page__risk-button"
            >
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
                <Tag color={chapterGateAlertColor(alert.status)} className="quality-dashboard-page__tag-reset">{chapterGateAlertLabel(alert.status)}</Tag>
                <Tag color={chapterGateLevelColor(alert.currentGateLevel)} className="quality-dashboard-page__tag-reset">{chapterGateLevelLabel(alert.currentGateLevel)}</Tag>
                <strong>{alert.title}</strong>
              </div>
              <div className="quality-dashboard-page__body-copy">{alert.detail}</div>
            </button>
          )) : <div className="quality-dashboard-page__body-copy">当前视图内最近没有明显的门级恶化或回升。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__panel-card">
        <div className="quality-dashboard-page__section-title">维度热力图</div>
        <div className="quality-dashboard-page__heatmap-scroll">
          <div className="quality-dashboard-page__heatmap-grid" style={{ minWidth: Math.max(640, chapterNums.length * 64) }}>
            <div className="quality-dashboard-page__heatmap-row quality-dashboard-page__heatmap-header" style={{ gridTemplateColumns: `120px repeat(${chapterNums.length}, minmax(44px, 1fr))` }}>
              <div>维度 / 章节</div>
              {chapterNums.map((chapterNum) => <div key={`head-${chapterNum}`} className="quality-dashboard-page__heatmap-head-cell">{chapterNum}</div>)}
            </div>
            {dimensions.map((dimension) => (
              <div key={dimension} className="quality-dashboard-page__heatmap-row" style={{ gridTemplateColumns: `120px repeat(${chapterNums.length}, minmax(44px, 1fr))` }}>
                <div className="quality-dashboard-page__heatmap-dimension">{dimension}</div>
                {chapterNums.map((chapterNum) => {
                  const entry = heatmapValueMap.get(`${chapterNum}:${dimension}`)
                  const score = entry?.score || 0
                  return (
                    <button
                      key={`${chapterNum}-${dimension}`}
                      type="button"
                      onClick={() => onSelectChapter(chapterNum)}
                      className="quality-dashboard-page__heatmap-button"
                      style={{ background: chapterGateHeatmapColor(score) }}
                    >
                      {score}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="quality-dashboard-page__chapter-snapshot">
        <div className="quality-dashboard-page__section-title">最近章节快照</div>
        {recentTrend.map((entry) => (
          <button
            key={`${entry.chapterId}-${entry.createdAt}`}
            type="button"
            onClick={() => onSelectChapter(entry.chapterNum)}
            className="quality-dashboard-page__chapter-snapshot-item"
          >
            <strong>{`第${entry.chapterNum}章`}</strong>
            <Tag color={chapterGateLevelColor(entry.gateLevel)} className="quality-dashboard-page__tag-reset">{chapterGateLevelLabel(entry.gateLevel)}</Tag>
            <Tag color={chapterGateBandColor(entry.scoreBand)} className="quality-dashboard-page__tag-reset">{chapterGateBandLabel(entry.scoreBand)}</Tag>
            <span style={{ fontWeight: 700, color: chapterGateHeatmapColor(entry.totalScore) }}>{entry.totalScore}</span>
            <span className="quality-dashboard-page__body-copy--soft-strong">{new Date(entry.createdAt).toLocaleString()}</span>
          </button>
        ))}
      </div>
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
    return <Empty description="先积累主角受挫与高潮样本，再看节奏跟踪" />
  }

  const latestPressure = trend[trend.length - 1]?.pressure ?? 0

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">主角受挫率</div>
          <div className="quality-dashboard-page__medium-number">{protagonistSummary.protagonistSetbackRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">重大受挫 {protagonistSummary.majorSetbackRate}%</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均主角压力</div>
          <div className="quality-dashboard-page__medium-number" style={{ color: pressureColor(protagonistSummary.averagePressure) }}>{protagonistSummary.averagePressure}</div>
          <div className="quality-dashboard-page__body-copy--soft">最新压力 {latestPressure}</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">顺推 / 压抑跨度</div>
          <div className="quality-dashboard-page__medium-number">{protagonistSummary.longestSmoothRun} / {protagonistSummary.longestPressureRun}</div>
          <div className="quality-dashboard-page__body-copy--soft">最长连续章节数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">代价持续</div>
          <div className="quality-dashboard-page__medium-number">{costSummary.averageCostDuration}</div>
          <div className="quality-dashboard-page__body-copy--soft">蒸发 {costSummary.evaporatedCostCount} 次 · 未解 {costSummary.unresolvedCostCount} 条</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">节奏告警</div>
          {alerts.length > 0 ? alerts.slice(0, 4).map((alert, index) => (
            <div key={`${alert.code}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={getStoryPacingSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">{getStoryPacingSeverityLabel(alert.severity)}</Tag>
                <span className="quality-dashboard-page__row-label">{alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近窗口内没有明显结构告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">反转 / 高潮 / 喘息</div>
          <div className="quality-dashboard-page__body-copy--strong">反转：{reversalSummary.reversalChapterNums.length > 0 ? reversalSummary.reversalChapterNums.join('、') : '未记录'}</div>
          <div className="quality-dashboard-page__body-copy--strong">高潮：{reversalSummary.climaxChapterNums.length > 0 ? reversalSummary.climaxChapterNums.join('、') : '未记录'}</div>
          <div className="quality-dashboard-page__body-copy--strong">喘息：{reversalSummary.breatherChapterNums.length > 0 ? reversalSummary.breatherChapterNums.join('、') : '未记录'}</div>
          <div className="quality-dashboard-page__body-copy--tiny-strong">强行反转 {reversalSummary.forcedReversalCount} 次，弱反转 {reversalSummary.weakReversalCount} 次，高潮间距 {reversalSummary.climaxSpacing.length > 0 ? reversalSummary.climaxSpacing.join('、') : '未记录'}。</div>
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">未解代价</div>
          {costSummary.activeCosts.length > 0 ? costSummary.activeCosts.map((entry) => (
            <div key={`${entry.startChapterNum}-${entry.summary}`} className="quality-dashboard-page__body-copy--strong">
              第{entry.startChapterNum}章起持续 {entry.duration} 章：{entry.summary}
            </div>
          )) : <div className="quality-dashboard-page__body-copy">代价链目前都已收口或转入稳定阶段。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
        <div className="quality-dashboard-page__section-title">主角压力曲线</div>
        <MiniTrendRow label="主角压力" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.pressure }))} />
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级结构摘要</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <div>
                    <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                    <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <Tag color={volume.alerts.length > 0 ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">{volume.alerts.length > 0 ? `${volume.alerts.length} 项告警` : '近期稳定'}</Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--strong">受挫率 {volume.protagonistSetbackRate}% · 重大受挫 {volume.majorSetbackRate}% · 平均压力 {volume.averagePressure}</div>
                <div className="quality-dashboard-page__body-copy--strong">代价持续 {volume.averageCostDuration} 章 · 蒸发 {volume.evaporatedCostCount} 次</div>
                <div className="quality-dashboard-page__body-copy--strong">高潮 {volume.climaxChapterNums.length > 0 ? volume.climaxChapterNums.join('、') : '未记录'} · 反转 {volume.reversalChapterNums.length > 0 ? volume.reversalChapterNums.join('、') : '未记录'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ChapterFunctionPanel({
  summary,
  runs,
  alerts,
  volumeEntries,
}: {
  summary: QualityDashboardData['chapterFunctionSummary']
  runs: QualityDashboardData['repeatedFunctionRuns']
  alerts: QualityDashboardData['chapterFunctionAlerts']
  volumeEntries: QualityDashboardData['volumeChapterFunctions']
}) {
  if (summary.trackedChapterCount === 0 && alerts.length === 0) {
    return <Empty description="先完成章节功能分析，节奏分布会在这里展开" />
  }

  return (
    <div className="quality-dashboard-page__stack">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已标注章节</div>
          <div className="quality-dashboard-page__medium-number">{summary.trackedChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">具备主功能或功能标签的章节数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">功能覆盖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.chapterPurposeCoverage}%</div>
          <div className="quality-dashboard-page__body-copy--soft">已被明确标注叙事职责的章节占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">节奏平衡分</div>
          <div className="quality-dashboard-page__medium-number">{summary.rhythmBalanceScore}</div>
          <div className="quality-dashboard-page__body-copy--soft">
            主功能偏向 {summary.dominantTag ? `${chapterFunctionLabel(summary.dominantTag)} ${summary.dominantTagShare}%` : '待分析'}
          </div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最长重复链</div>
          <div className="quality-dashboard-page__medium-number">{summary.longestRepeatedFunctionRun}</div>
          <div className="quality-dashboard-page__body-copy--soft">连续重复主功能区段 {summary.repeatedFunctionRunCount} 处</div>
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
        <div className="quality-dashboard-page__section-title">功能覆盖分布</div>
        <div className="quality-dashboard-page__chapter-function-grid">
          {CHAPTER_FUNCTION_ORDER.map((tag) => {
            const count = summary.tagCounts[tag] || 0
            const share = summary.trackedChapterCount > 0 ? Math.round((count / summary.trackedChapterCount) * 100) : 0
            return (
              <div key={tag} className="quality-dashboard-page__function-card" style={{ border: `1px solid ${chapterFunctionColor(tag)}` }}>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{chapterFunctionLabel(tag)}</span>
                  <span className="quality-dashboard-page__row-label" style={{ color: chapterFunctionColor(tag) }}>{share}%</span>
                </div>
                <Progress percent={share} showInfo={false} strokeColor={chapterFunctionColor(tag)} size="small" />
                <div className="quality-dashboard-page__body-copy--tiny">覆盖 {count} 章</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-260">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">重复功能区段</div>
          {runs.length > 0 ? runs.slice(0, 8).map((run, index) => (
            <div key={`${run.startChapterNum}-${run.primaryTag}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={run.length >= 5 ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">{chapterFunctionLabel(run.primaryTag)}</Tag>
                <span className="quality-dashboard-page__row-label">第{run.startChapterNum}-{run.endChapterNum}章</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">连续 {run.length} 章都以 {chapterFunctionLabel(run.primaryTag)} 为主功能。</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">章节主功能没有出现连续空转。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期功能告警</div>
          {alerts.length > 0 ? alerts.slice(0, 8).map((alert, index) => (
            <div key={`${alert.code}-${index}-${alert.chapterNums.join('-')}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={chapterFunctionAlertColor(alert.severity)} className="quality-dashboard-page__tag-reset">
                  {getStoryPacingSeverityLabel(alert.severity)}
                </Tag>
                <span className="quality-dashboard-page__row-label">{alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">近期没有新的章节功能偏移。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级功能摘要</div>
          <div className="quality-dashboard-page__metric-grid-240">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div className="quality-dashboard-page__body-copy--strong">
                  覆盖 {volume.trackedChapterCount} 章 · 平衡分 {volume.rhythmBalanceScore}
                </div>
                <div className="quality-dashboard-page__body-copy--strong">
                  主功能偏向 {volume.dominantTag ? `${chapterFunctionLabel(volume.dominantTag)} ${volume.dominantTagShare}%` : '待分析'}
                </div>
                <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--tight">
                  {volume.repeatedRuns.slice(0, 2).map((run) => (
                    <Tag key={`${volume.volumeId}-${run.startChapterNum}-${run.primaryTag}`} color={run.length >= 5 ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                      {chapterFunctionLabel(run.primaryTag)} {run.length}连
                    </Tag>
                  ))}
                  {volume.alerts.filter((alert) => alert.code === 'volume_function_skew').slice(0, 1).map((alert, index) => (
                    <Tag key={`${volume.volumeId}-skew-${index}`} color={chapterFunctionAlertColor(alert.severity)} className="quality-dashboard-page__tag-reset">
                      偏科
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StoryArcProgressPanel({
  summary,
  trend,
  arcs,
  alerts,
  volumeEntries,
}: {
  summary: QualityDashboardData['storyArcProgressSummary']
  trend: QualityDashboardData['storyArcProgressTrend']
  arcs: QualityDashboardData['storyArcProgressArcs']
  alerts: QualityDashboardData['storyArcProgressAlerts']
  volumeEntries: QualityDashboardData['storyArcProgressVolumes']
}) {
  if (summary.trackedArcCount === 0 && alerts.length === 0) {
    return <Empty description="先积累故事弧推进样本，再看覆盖情况" />
  }

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跟踪故事弧</div>
          <div className="quality-dashboard-page__medium-number">{summary.trackedArcCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">已进入推进分析层的主线与支线</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">推进章 / 空转章</div>
          <div className="quality-dashboard-page__medium-number">{summary.progressChapterCount} / {summary.stalledChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">覆盖章节 {summary.coveredChapterCount}</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">停滞故事弧</div>
          <div className="quality-dashboard-page__medium-number">{summary.stalledArcCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">连续空转过长或阶段未兑现</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">严重告警</div>
          <div className="quality-dashboard-page__medium-number">{summary.criticalAlertCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">优先回查阶段收束和长段空转</div>
        </div>
      </div>

      {trend.length > 0 ? (
        <div className="quality-dashboard-page__detail-stack">
          <div className="quality-dashboard-page__section-title">推进 / 空转曲线</div>
          <MiniTrendRow label="推进章数" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.progressCount }))} />
          <MiniTrendRow label="空转章数" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.stalledCount }))} />
        </div>
      ) : null}

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期推进告警</div>
          {alerts.length > 0 ? alerts.slice(0, 6).map((alert, index) => (
            <div key={`${alert.code}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                <Tag color={getStoryArcSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">
                  {getStoryArcSeverityLabel(alert.severity)}
                </Tag>
                <span className="quality-dashboard-page__row-label">{alert.arcName} · {alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的推进告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">故事弧摘要</div>
          {arcs.length > 0 ? arcs.slice(0, 6).map((arc) => (
            <div key={arc.arcId} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <div className="quality-dashboard-page__row-label">{arc.arcName}</div>
                <span className="quality-dashboard-page__row-label" style={{ color: arcProgressRateColor(arc.progressRate) }}>{arc.progressRate}%</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{arc.statusSummary}</div>
              <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--tight">
                <Tag color={arc.stallRate >= 70 ? 'error' : arc.stallRate >= 50 ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">空转 {arc.stallRate}%</Tag>
                <Tag color={arc.missedPhaseCount > 0 ? 'error' : arc.hitPhaseCount > 0 ? 'processing' : 'default'} className="quality-dashboard-page__tag-reset">
                  阶段 {arc.hitPhaseCount}/{arc.phaseTargets.length}
                </Tag>
              </div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">尚未形成可分析的故事弧。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级推进摘要</div>
          <div className="quality-dashboard-page__metric-grid-240">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                {volume.arcEntries.length > 0 ? volume.arcEntries.slice(0, 4).map((arcEntry) => (
                  <div key={`${volume.volumeId}-${arcEntry.arcId}`} className="quality-dashboard-page__body-copy--strong">
                    {arcEntry.arcName}：推进 {arcEntry.progressRate}% · 空转 {arcEntry.stallRate}% · 阶段 {arcEntry.hitPhaseLabels.length}/{arcEntry.hitPhaseLabels.length + arcEntry.missedPhaseLabels.length}
                  </div>
                )) : <div className="quality-dashboard-page__body-copy">本卷还没有足够的故事弧覆盖数据。</div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

