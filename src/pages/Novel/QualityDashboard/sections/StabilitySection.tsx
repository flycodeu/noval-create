import { Button, Empty, Tag } from 'antd'
import type { QualityDashboardData } from '../../../../types'
import { WorkspacePanel } from '../../components/WorkspaceShell'
import TruncatedList from '../../../../components/common/TruncatedList'
import MiniTrendRow from './MiniTrendRow'
import {
  recallSnapshotSourceColor,
  recallSnapshotSourceLabel,
  worldStateEntityLabel,
  worldStateSeverityColor,
  type VolumeFilteredDashboard,
} from '../quality-dashboard-presentation'

interface StabilitySectionProps {
  data: QualityDashboardData
  filtered: VolumeFilteredDashboard
  hasRecallData: boolean
  hasStateData: boolean
  onLocateChapter: (chapterNum?: number) => void
}

/** 召回与状态 Tab：召回可靠性与世界状态稳定性。 */
export default function StabilitySection({ data, filtered, hasRecallData, hasStateData, onLocateChapter }: StabilitySectionProps) {
  return (
    <>
      {hasRecallData ? (
        <WorkspacePanel title="召回可靠性">
          <RecallReliabilityPanel
            summary={data.recallSummary}
            alerts={filtered.recallAlerts}
            volumeEntries={filtered.recallVolumes}
            onLocateChapter={onLocateChapter}
          />
        </WorkspacePanel>
      ) : null}

      {hasStateData ? (
        <WorkspacePanel title="状态稳定性">
          <WorldStateStabilityPanel
            trend={data.worldStateTrend}
            alerts={filtered.worldAlerts}
            conflictEntities={data.worldConflictEntities}
            summary={data.worldStateSummary}
            volumeEntries={filtered.worldVolumes}
            onLocateChapter={onLocateChapter}
          />
        </WorkspacePanel>
      ) : null}
    </>
  )
}

function RecallReliabilityPanel({
  summary,
  alerts,
  volumeEntries,
  onLocateChapter,
}: {
  summary: QualityDashboardData['recallSummary']
  alerts: QualityDashboardData['recentRecallAlerts']
  volumeEntries: QualityDashboardData['volumeRecallDiagnostics']
  onLocateChapter: (chapterNum?: number) => void
}) {
  if (summary.analyzedChapterCount === 0 && alerts.length === 0) {
    return <Empty description="先产出召回样本，可靠性数据会在这里汇总" />
  }

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">分析章节</div>
          <div className="quality-dashboard-page__medium-number">{summary.analyzedChapterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">已纳入召回可靠性诊断的章节数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回依赖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.recallDependencyRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">实际保留下来的背景补充片段占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回可用率</div>
          <div className="quality-dashboard-page__medium-number">{summary.recallAvailabilityRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">最终 prompt 实际使用召回补充的章节占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均命中数</div>
          <div className="quality-dashboard-page__medium-number">{summary.averageHitCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">每章平均召回到的历史片段数</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">过期召回</div>
          <div className="quality-dashboard-page__medium-number">{summary.staleRecallCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">被识别为疑似过期的历史片段</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">过期召回率</div>
          <div className="quality-dashboard-page__medium-number">{summary.staleRecallRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">本地回查命中里疑似过期片段的平均占比</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">上章先验覆盖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.previousChapterFeedCoverageRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">上一章先验采样覆盖上一章正文的平均比例</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回桶覆盖率</div>
          <div className="quality-dashboard-page__medium-number">{summary.bucketCoverageRate}%</div>
          <div className="quality-dashboard-page__body-copy--soft">角色 / 规则 / 线程三个桶的平均命中覆盖</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">上章先验字数</div>
          <div className="quality-dashboard-page__medium-number">{summary.previousChapterFeedChars}</div>
          <div className="quality-dashboard-page__body-copy--soft">每章平均喂入的上一章先验文本长度</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">连续降级章节</div>
          <div className="quality-dashboard-page__medium-number">{summary.consecutiveFallbackChapters}</div>
          <div className="quality-dashboard-page__body-copy--soft">{summary.latestFallbackReason ? `最近原因：${summary.latestFallbackReason}` : '召回链路目前稳定。'}</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期召回降级章节</div>
          {alerts.length > 0 ? (
            <TruncatedList
              items={alerts}
              limit={8}
              renderItem={(alert) => (
                <div key={alert.chapterId} className="quality-dashboard-page__detail-block">
                  <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
                    <Tag color={alert.degraded ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">{alert.degraded ? '召回降级' : '过期召回'}</Tag>
                    {alert.recallSnapshotSource ? (
                      <Tag color={recallSnapshotSourceColor(alert.recallSnapshotSource)} className="quality-dashboard-page__tag-reset">
                        {recallSnapshotSourceLabel(alert.recallSnapshotSource)}
                      </Tag>
                    ) : null}
                    <span className="quality-dashboard-page__row-label">第{alert.chapterNum}章 · {alert.title}</span>
                    <Button size="small" onClick={() => onLocateChapter(alert.chapterNum)}>定位</Button>
                  </div>
                  <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
                </div>
              )}
            />
          ) : <div className="quality-dashboard-page__body-copy">最近没有新的召回降级章节。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">召回摘要</div>
          <div className="quality-dashboard-page__pipeline-tags">
            <Tag color="blue">{`保留 ${summary.selectedHitCount}`}</Tag>
            <Tag color={summary.fallbackHitCount > 0 ? 'warning' : 'success'}>{`兜底 ${summary.fallbackHitCount}`}</Tag>
            <Tag color="cyan">{`可用 ${summary.recallAvailabilityRate}%`}</Tag>
            <Tag color="geekblue">{`桶覆盖 ${summary.bucketCoverageRate}%`}</Tag>
            <Tag>{`上章 ${summary.previousChapterFeedCoverageRate}%`}</Tag>
          </div>
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级召回诊断</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div className="quality-dashboard-page__body-copy--strong">可用率 {volume.recallAvailabilityRate}% · 平均命中 {volume.averageHitCount} · 召回桶 {volume.bucketCoverageRate}%</div>
                <div className="quality-dashboard-page__body-copy--strong">依赖率 {volume.recallDependencyRate}% · 过期 {volume.staleRecallCount} · 过期率 {volume.staleRecallRate}%</div>
                <div className="quality-dashboard-page__body-copy--strong">降级 {volume.degradedChapterCount} 章{volume.latestFallbackReason ? ` · 最近原因 ${volume.latestFallbackReason}` : ''}</div>
                <div className="quality-dashboard-page__body-copy--strong">上章先验覆盖 {volume.previousChapterFeedCoverageRate}% · 平均 {volume.previousChapterFeedChars} 字</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function WorldStateStabilityPanel({
  trend,
  alerts,
  conflictEntities,
  summary,
  volumeEntries,
  onLocateChapter,
}: {
  trend: QualityDashboardData['worldStateTrend']
  alerts: QualityDashboardData['recentWorldStateAlerts']
  conflictEntities: QualityDashboardData['worldConflictEntities']
  summary: QualityDashboardData['worldStateSummary']
  volumeEntries: QualityDashboardData['volumeWorldStateStability']
  onLocateChapter: (chapterNum?: number) => void
}) {
  if (summary.trackedEntityCount === 0 && alerts.length === 0) {
    return <Empty description="先积累状态回写样本，再看稳定性数据" />
  }

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-180">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跟踪实体</div>
          <div className="quality-dashboard-page__medium-number">{summary.trackedEntityCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">统一总账已接管的人物与世界实体</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">状态跳变</div>
          <div className="quality-dashboard-page__medium-number">{summary.driftAlertCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">缺少事件承接的跨章节变化</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">状态冲突</div>
          <div className="quality-dashboard-page__medium-number">{summary.conflictAlertCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">不可用物品、敌对关系等矛盾状态</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">预警快照</div>
          <div className="quality-dashboard-page__medium-number">{summary.warningCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">账本中缺少原因或阻塞状态的记录数</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">世界状态概览</div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">人物 {summary.trackedByType.character} · 势力 {summary.trackedByType.faction} · 物品 {summary.trackedByType.item}</div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">关系 {summary.trackedByType.relation} · 地点 {summary.trackedByType.location}</div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">冲突实体 {summary.conflictEntityCount} · 严重告警 {summary.criticalCount}</div>
          {summary.recentConflictEntities.length > 0 ? (
            <div className="quality-dashboard-page__body-copy--tiny">近期命中：{summary.recentConflictEntities.join('、')}</div>
          ) : (
            <div className="quality-dashboard-page__body-copy--tiny">最近没有新的冲突实体。</div>
          )}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期阻塞实体</div>
          {alerts.length > 0 ? alerts.slice(0, 5).map((alert, index) => (
            <div key={`${alert.summary}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={worldStateSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
                <span className="quality-dashboard-page__row-label">{worldStateEntityLabel(alert.entityType)} · {alert.entityName}</span>
                <Button size="small" onClick={() => onLocateChapter(alert.chapterNum)}>定位</Button>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.summary}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近窗口内没有新的状态告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跨章节趋势</div>
          <MiniTrendRow label="状态跳变" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.driftCount }))} />
          <MiniTrendRow label="状态冲突" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.conflictCount }))} />
          <MiniTrendRow label="预警快照" points={trend.map((point) => ({ chapterNum: point.chapterNum, value: point.warningCount }))} />
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">冲突实体列表</div>
          {conflictEntities.length > 0 ? conflictEntities.slice(0, 5).map((entity, index) => (
            <div key={`${entity.entityType}-${entity.entityId}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={worldStateSeverityColor(entity.severity)} className="quality-dashboard-page__tag-reset">
                  {entity.conflictCount > 0 ? '冲突实体' : '跳变实体'}
                </Tag>
                <span className="quality-dashboard-page__row-label">{worldStateEntityLabel(entity.entityType)} · {entity.entityName}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{entity.reasons.join('；') || entity.summaryText}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">世界状态目前没有需要优先回查的冲突实体。</div>}
        </div>
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级状态摘要</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                <div className="quality-dashboard-page__body-copy--strong">跳变 {volume.driftAlertCount} · 冲突 {volume.conflictAlertCount} · 预警 {volume.warningCount}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
