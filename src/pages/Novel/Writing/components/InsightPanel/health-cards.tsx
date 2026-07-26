import { Progress, Tag } from 'antd'
import type { Chapter, QualityDashboardData, StoryMemorySnapshot } from '../../../../../types'
import type { AiCheckPayload, ReviewNotes } from '../../parsers'
import { StringList } from './InsightCard'
import {
  formatSignedDriftDelta,
  languageDriftStatusColor,
  languageDriftStatusLabel,
  paceMarkerLabel,
  storyAlertColor,
  storyAlertLabel,
  worldStateAlertColor,
  worldStateEntityLabel,
} from './insight-utils'

export function CharacterStateMemoryCard({ storyMemory }: { storyMemory: StoryMemorySnapshot | null }) {
  if (!storyMemory) {
    return <div className="novel-copy-block">先运行章节流水线或刷新记忆，再核对人物与世界实体的当前状态、近期跳变和冲突告警。</div>
  }

  const characterStateItems = storyMemory.characterCurrentStates
    .slice(0, 8)
    .map((item) => {
      const reason = item.changeReason && item.changeReason !== '延续前章状态，无新增显式变化'
        ? ` · ${item.changeReason}`
        : ''
      return `${item.characterName}：${item.summaryText}${reason}`
    })
  const worldStateItems = storyMemory.worldCurrentStates
    .slice(0, 6)
    .map((item) => `${worldStateEntityLabel(item.entityType)} ${item.entityName}：${item.summaryText}`)
  const conflictEntityItems = storyMemory.worldConflictEntities
    .slice(0, 4)
    .map((item) => `${worldStateEntityLabel(item.entityType)} ${item.entityName}：${item.reasons.join('；')}`)
  const alertItems = [
    ...storyMemory.characterStateAlerts
    .slice(0, 4)
      .map((item) => `人物 ${item.characterName}：${item.reasons.join('；')}`),
    ...storyMemory.worldStateAlerts
      .slice(0, 4)
      .map((item) => `${worldStateEntityLabel(item.entityType)} ${item.entityName}：${item.reasons.join('；')}`),
  ]
  const trendItems = [
    ...storyMemory.characterStateTrendSummary.slice(0, 3),
    ...storyMemory.worldStateTrendSummary.slice(0, 3),
  ]

  if (characterStateItems.length === 0 && worldStateItems.length === 0 && alertItems.length === 0 && conflictEntityItems.length === 0) {
    return <div className="novel-copy-block">状态版本会在章节连续性刷新后写入，这里随后会开始累积“当前状态”“趋势摘要”和“跳变告警”。</div>
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <StringList items={characterStateItems} empty="当前还没有可用的人物状态快照。" />
      <StringList items={worldStateItems} empty="当前还没有可用的世界状态快照。" />
      {alertItems.length > 0 ? (
        <div className="novel-note-list">
          {alertItems.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">状态漂移：{item}</div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">最近没有命中的状态跳变或冲突告警。</div>
      )}
      <StringList items={conflictEntityItems} empty="没有发现需要优先回查的冲突实体。" />
      <StringList items={trendItems} empty="跨章节状态趋势会在这里汇总。" />
    </div>
  )
}

export function WorldStateHealthCard({ dashboard }: { dashboard: QualityDashboardData | null }) {
  if (!dashboard) {
    return <div className="novel-copy-block">先加载质量数据，再看跨章节的状态稳定性趋势与近期冲突。</div>
  }

  const alerts = dashboard.recentWorldStateAlerts.slice(0, 4)
  const trackedByType = dashboard.worldStateSummary.trackedByType
  const overviewItems = [
    `人物 ${trackedByType.character}`,
    `势力 ${trackedByType.faction}`,
    `物品 ${trackedByType.item}`,
    `关系 ${trackedByType.relation}`,
    `地点 ${trackedByType.location}`,
    `冲突实体 ${dashboard.worldStateSummary.conflictEntityCount}`,
  ]
  const conflictEntities = dashboard.worldConflictEntities.slice(0, 4)
  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">跟踪实体 {dashboard.worldStateSummary.trackedEntityCount}</div>
        <div className="novel-insight-list__item">漂移告警 {dashboard.worldStateSummary.driftAlertCount}</div>
        <div className="novel-insight-list__item">冲突告警 {dashboard.worldStateSummary.conflictAlertCount}</div>
        <div className="novel-insight-list__item">预警快照 {dashboard.worldStateSummary.warningCount}</div>
      </div>
      <StringList items={overviewItems} empty="状态总账还没形成可读概览。" />
      {conflictEntities.length > 0 ? (
        <div className="novel-note-list">
          {conflictEntities.map((entity, index) => (
            <div key={`${entity.entityType}-${entity.entityId}-${index}`} className="novel-note-list__item">
              <Tag color={worldStateAlertColor(entity.severity)}>
                {entity.conflictCount > 0 ? '冲突实体' : '跳变实体'}
              </Tag>
              {worldStateEntityLabel(entity.entityType)} {entity.entityName}：{entity.reasons.join('；')}
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">世界状态暂时稳定，没有需要优先回查的冲突实体。</div>
      )}
      {alerts.length > 0 ? (
        <div className="novel-note-list">
          {alerts.map((alert, index) => (
            <div key={`${alert.summary}-${index}`} className="novel-note-list__item">
              <Tag color={worldStateAlertColor(alert.severity)}>{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
              {alert.summary}
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">最近窗口内没有新的状态稳定性告警。</div>
      )}
    </div>
  )
}

export function LanguageDriftHealthCard({
  dashboard,
  currentChapter,
}: {
  dashboard: QualityDashboardData | null
  currentChapter: Chapter | null
}) {
  if (!dashboard || dashboard.totalChaptersScored === 0) {
    return <div className="novel-copy-block">先对多章运行 AI 体检，系统才会积累跨章节语言退化趋势。</div>
  }

  const alerts = dashboard.recentLanguageDriftAlerts.slice(0, 3)
  const topRiskMetrics = dashboard.novelLanguageDriftSummary.topRiskMetrics.slice(0, 3)
  const currentVolume = currentChapter?.volumeId
    ? dashboard.volumeLanguageDrift.find((entry) => entry.volumeId === currentChapter.volumeId) || null
    : null

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      {alerts.length > 0 ? (
        <div className="novel-issue-list">
          {alerts.map((alert) => (
            <div key={alert.metric} className="novel-issue-item">
              <div className="novel-issue-item__head">
                <Tag color={languageDriftStatusColor(alert.status)}>{languageDriftStatusLabel(alert.status)}</Tag>
                <strong>{alert.label}</strong>
              </div>
              <div className="novel-issue-item__desc">窗口均值 {alert.previousValue} → {alert.latestValue}</div>
              <div className="novel-issue-item__suggestion">变化 {formatSignedDriftDelta(alert.delta)}，建议优先检查这类表达是否在连续章节里反复累积。</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">
          最近 {dashboard.novelLanguageDriftSummary.recentWindowSize || dashboard.totalChaptersScored} 章保持稳定，没有明显恶化项。
        </div>
      )}

      {currentVolume ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            当前卷：{currentVolume.volumeName}（第{currentVolume.chapterStart}-{currentVolume.chapterEnd}章，共 {currentVolume.chapterCount} 章）
          </div>
          <div className="novel-note-list__item">
            {currentVolume.topWorseningMetrics.length > 0
              ? `卷内近期恶化：${currentVolume.topWorseningMetrics.map((item) => `${item.label} ${formatSignedDriftDelta(item.delta)}`).join('、')}`
              : '卷内近期保持稳定。'}
          </div>
        </div>
      ) : null}

      {topRiskMetrics.length > 0 ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            全书当前最高优先问题：{topRiskMetrics.map((item) => `${item.label} ${item.value}`).join('、')}
          </div>
          <div className="novel-note-list__item">
            趋势状态：恶化 {dashboard.novelLanguageDriftSummary.statusBreakdown.worsening} 项，改善 {dashboard.novelLanguageDriftSummary.statusBreakdown.improving} 项，稳定 {dashboard.novelLanguageDriftSummary.statusBreakdown.stable} 项。
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function HumanizationHealthCard({
  dashboard,
  reviewNotes,
}: {
  dashboard: QualityDashboardData | null
  reviewNotes: ReviewNotes | null
}) {
  const currentSignals = reviewNotes?.humanization_signals?.slice(0, 4) || []
  const promotedIssues = dashboard?.feedbackRecurrence.humanization.promotedIssues.slice(0, 3) || []
  const recentAlerts = dashboard?.feedbackRecurrence.humanization.recentAlerts.slice(0, 3) || []

  if (currentSignals.length === 0 && promotedIssues.length === 0 && recentAlerts.length === 0) {
    return <div className="novel-copy-block">语言风险一旦开始跨章复现，系统会直接提示下一章该避免什么。</div>
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      {currentSignals.length > 0 ? (
        <div className="novel-note-list">
          {currentSignals.map((item) => (
            <div key={`${item.issueType}-${item.detail}`} className="novel-note-list__item">
              当前章 {item.title}：{item.detail}
            </div>
          ))}
        </div>
      ) : null}

      {promotedIssues.length > 0 ? (
        <div className="novel-copy-block">
          下一章硬约束：{promotedIssues.map((item) => `${item.title} -> ${item.avoid}`).join('；')}
        </div>
      ) : null}

      {recentAlerts.length > 0 ? (
        <div className="novel-note-list">
          {recentAlerts.map((alert) => (
            <div key={`${alert.issueType}-${alert.lastChapterNum}`} className="novel-note-list__item">
              {alert.pauseSuggested ? '批次预警' : '复现预警'}：{alert.detail}
            </div>
          ))}
        </div>
      ) : null}

      {dashboard ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            近章人味问题覆盖 {dashboard.feedbackRecurrence.humanization.hitChapterCount} 章，已升级硬约束 {dashboard.feedbackRecurrence.humanization.promotedIssueCount} 项，高风险 {dashboard.feedbackRecurrence.humanization.highRiskIssueCount} 项。
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function DialogueFingerprintHealthCard({
  dashboard,
  reviewNotes,
}: {
  dashboard: QualityDashboardData | null
  reviewNotes: ReviewNotes | null
}) {
  const currentSimilarities = reviewNotes?.cross_character_similarity?.slice(0, 3) || []
  const currentDrifts = reviewNotes?.dialogue_drift_alerts?.slice(0, 3) || []
  const globalPairs = dashboard?.crossCharacterDialogueSimilarity.filter((pair) => pair.similarity >= 75).slice(0, 3) || []
  const globalDrifts = dashboard?.dialogueDriftTrend.filter((entry) => entry.recentDriftRate >= 45).slice(0, 3) || []

  if (
    !reviewNotes?.dialogue_fingerprint_summary
    && currentSimilarities.length === 0
    && currentDrifts.length === 0
    && (!dashboard || dashboard.dialogueFingerprintStats.eligibleCharacterCount === 0)
  ) {
    return <div className="novel-copy-block">等章节里出现稳定对白样本后，就会提示“谁说话太像”以及“谁正在偏离自己的声音”。</div>
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      {reviewNotes?.dialogue_fingerprint_summary ? (
        <div className="novel-copy-block">{reviewNotes.dialogue_fingerprint_summary}</div>
      ) : null}

      {reviewNotes?.dialogue_voice_lock_summary ? (
        <div className="novel-copy-block">{reviewNotes.dialogue_voice_lock_summary}</div>
      ) : null}

      {currentSimilarities.length > 0
      || currentDrifts.length > 0
      || (reviewNotes?.dialogue_homogenization_risks?.length || 0) > 0
      || (reviewNotes?.dialogue_filler_risks?.length || 0) > 0
      || (reviewNotes?.dialogue_info_density_risks?.length || 0) > 0
      || (reviewNotes?.required_voice_lock_character_ids?.length || 0) > 0 ? (
        <div className="novel-note-list">
          {(reviewNotes?.dialogue_homogenization_risks || []).slice(0, 3).map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">{item}</div>
          ))}
          {currentSimilarities.map((item) => (
            <div key={`${item.characterAId}-${item.characterBId}`} className="novel-note-list__item">
              当前章高相似：{item.characterAName} / {item.characterBName}（{item.similarity}）· {item.reason}
            </div>
          ))}
          {currentDrifts.map((item) => (
            <div key={`${item.characterId}-${item.driftRate}`} className="novel-note-list__item">
              当前章漂移：{item.characterName}（{item.driftRate}）· {item.reason}
            </div>
          ))}
          {(reviewNotes?.dialogue_filler_risks || []).slice(0, 2).map((item, index) => (
            <div key={`filler-${index}`} className="novel-note-list__item">
              对白空转：{item}
            </div>
          ))}
          {(reviewNotes?.dialogue_info_density_risks || []).slice(0, 2).map((item, index) => (
            <div key={`density-${index}`} className="novel-note-list__item">
              信息推进：{item}
            </div>
          ))}
          {(reviewNotes?.required_voice_lock_character_ids || []).length > 0 ? (
            <div className="novel-note-list__item">
              需锁定角色声线：{(reviewNotes?.required_voice_lock_character_ids || []).join('、')}
            </div>
          ) : null}
        </div>
      ) : null}

      {dashboard ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            已建立 {dashboard.dialogueFingerprintStats.eligibleCharacterCount} 个角色语音指纹，累计识别对白 {dashboard.dialogueFingerprintStats.totalTurnCount} 段，其中归属成功 {dashboard.dialogueFingerprintStats.attributedTurnCount} 段。
          </div>
          <div className="novel-note-list__item">
            全书平均跨角色相似度 {dashboard.dialogueFingerprintStats.averageCrossCharacterSimilarity}，高相似组合 {dashboard.dialogueFingerprintStats.highSimilarityPairCount} 对，近期漂移角色 {dashboard.dialogueFingerprintStats.driftingCharacterCount} 个。
          </div>
        </div>
      ) : null}

      {globalPairs.length > 0 ? (
        <div className="novel-issue-list">
          {globalPairs.map((pair) => (
            <div key={`${pair.characterAId}-${pair.characterBId}`} className="novel-issue-item">
              <div className="novel-issue-item__head">
                <Tag color="warning">高相似</Tag>
                <strong>{pair.characterAName} / {pair.characterBName}</strong>
              </div>
              <div className="novel-issue-item__desc">相似度 {pair.similarity}</div>
              <div className="novel-issue-item__suggestion">{pair.reasons.join('、') || '句长、停顿和惯用短语接近。'}</div>
            </div>
          ))}
        </div>
      ) : globalDrifts.length > 0 ? null : (
        <div className="novel-copy-block">全书对白同质化目前没有达到高阈值。</div>
      )}

      {globalDrifts.length > 0 ? (
        <div className="novel-note-list">
          {globalDrifts.map((entry) => (
            <div key={entry.characterId} className="novel-note-list__item">
              近期漂移：{entry.characterName}（{entry.recentDriftRate}）· {entry.reasons.join('、') || '说话节奏正在偏移。'}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function StoryDynamicsHealthCard({
  dashboard,
  currentChapter,
  reviewNotes,
}: {
  dashboard: QualityDashboardData | null
  currentChapter: Chapter | null
  reviewNotes: ReviewNotes | null
}) {
  const currentSignals = [
    reviewNotes?.cost_resolution_state === 'evaporated'
      ? '当前章代价疑似蒸发，建议把伤势、资源损耗或关系后果继续写下去。'
      : '',
    reviewNotes?.reversal_marker && reviewNotes?.reversal_support_state === 'forced'
      ? '当前章反转支撑不足，建议补齐触发原因和前文铺垫。'
      : '',
    reviewNotes?.protagonist_setback === 'none' && (reviewNotes?.reward_state === 'partial' || reviewNotes?.reward_state === 'major') && !reviewNotes?.cost_present
      ? '当前章主角偏顺推，建议补出失败、失误或阶段代价。'
      : '',
    typeof reviewNotes?.protagonist_pressure === 'number' && reviewNotes.protagonist_pressure >= 70 && reviewNotes?.reward_state === 'none'
      ? '当前章压力很高但没有回报，建议安排一次缓冲、收获或反击兑现。'
      : '',
  ].filter((item): item is string => Boolean(item))

  if (currentSignals.length === 0 && (!dashboard || dashboard.protagonistSetbackSummary.chapterCount === 0)) {
    return <div className="novel-copy-block">运行新版章节审校后，就会累计主角受挫、代价持续和反转节奏告警。</div>
  }

  const alerts = dashboard?.storyPacingAlerts.slice(0, 3) || []
  const currentVolume = currentChapter?.volumeId
    ? dashboard?.volumeStoryDynamics.find((entry) => entry.volumeId === currentChapter.volumeId) || null
    : null

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      {currentSignals.length > 0 ? (
        <div className="novel-note-list">
          {currentSignals.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">{item}</div>
          ))}
          {reviewNotes?.pace_marker ? <div className="novel-note-list__item">当前章主节奏：{paceMarkerLabel(reviewNotes.pace_marker)}</div> : null}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className="novel-issue-list">
          {alerts.map((alert, index) => (
            <div key={`${alert.code}-${index}`} className="novel-issue-item">
              <div className="novel-issue-item__head">
                <Tag color={storyAlertColor(alert.severity)}>{storyAlertLabel(alert.severity)}</Tag>
                <strong>{alert.title}</strong>
              </div>
              <div className="novel-issue-item__desc">{alert.detail}</div>
              <div className="novel-issue-item__suggestion">涉及章节：{alert.chapterNums.join('、')}</div>
            </div>
          ))}
        </div>
      ) : dashboard ? (
        <div className="novel-copy-block">
          最近 {Math.min(20, dashboard.protagonistSetbackSummary.chapterCount)} 章保持稳定，没有明显的主角与节奏结构告警。
        </div>
      ) : null}

      {dashboard ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            全书受挫率 {dashboard.protagonistSetbackSummary.protagonistSetbackRate}% ，重大受挫 {dashboard.protagonistSetbackSummary.majorSetbackRate}% ，平均压力 {dashboard.protagonistSetbackSummary.averagePressure}。
          </div>
          <div className="novel-note-list__item">
            最长顺推 {dashboard.protagonistSetbackSummary.longestSmoothRun} 章，最长持续压抑 {dashboard.protagonistSetbackSummary.longestPressureRun} 章。
          </div>
          <div className="novel-note-list__item">
            代价蒸发 {dashboard.costPersistenceSummary.evaporatedCostCount} 次，未解代价 {dashboard.costPersistenceSummary.unresolvedCostCount} 条。
          </div>
        </div>
      ) : null}

      {currentVolume ? (
        <div className="novel-note-list">
          <div className="novel-note-list__item">
            当前卷：{currentVolume.volumeName} · 受挫率 {currentVolume.protagonistSetbackRate}% · 平均压力 {currentVolume.averagePressure}
          </div>
          <div className="novel-note-list__item">
            卷内高潮：{currentVolume.climaxChapterNums.length > 0 ? currentVolume.climaxChapterNums.join('、') : '未记录'}；反转：{currentVolume.reversalChapterNums.length > 0 ? currentVolume.reversalChapterNums.join('、') : '未记录'}；代价蒸发 {currentVolume.evaporatedCostCount} 次。
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AiCheckResult({ result }: { result: AiCheckPayload }) {
  const scoreTone = result.score >= 80 ? 'good' : result.score >= 60 ? 'warn' : 'danger'
  return (
    <div className={`novel-ai-score novel-ai-score--${scoreTone}`}>
      <div className="novel-ai-score__summary">
        <Progress
          type="circle"
          percent={result.score}
          size={86}
          strokeColor="var(--writing-ai-score-color)"
          trailColor="var(--writing-ai-score-trail)"
          format={(percent) => <span className="writing-layout-ai-score-value">{percent}</span>}
        />
        <div className="novel-ai-score__feedback">{result.overall_feedback}</div>
      </div>
      <div className="novel-insight-list">
        {result.issues.map((issue, index) => <div key={`${issue.type}-${index}`} className="novel-ai-issue"><div className="novel-ai-issue__type">{issue.type}</div><div className="novel-ai-issue__location">{issue.location}</div><div className="novel-ai-issue__suggestion">{issue.suggestion}</div></div>)}
      </div>
    </div>
  )
}
