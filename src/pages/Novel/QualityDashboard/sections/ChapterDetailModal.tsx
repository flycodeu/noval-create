import { Modal, Progress, Tag } from 'antd'
import type { LanguageDriftMetrics, QualityDashboardData } from '../../../../types'
import {
  LANGUAGE_DRIFT_LABELS,
  chapterFunctionColor,
  chapterFunctionLabel,
  chapterGateBandColor,
  chapterGateBandLabel,
  chapterGateHeatmapColor,
  chapterGateLevelColor,
  chapterGateLevelLabel,
  chapterGateScoreBand,
  costResolutionStateLabel,
  getTopLanguageDriftMetrics,
  languageDriftRiskColor,
  paceMarkerLabel,
  pressureColor,
  recallFallbackReasonLabel,
  recallSnapshotSourceColor,
  recallSnapshotSourceLabel,
  reversalSupportStateLabel,
  rewardStateLabel,
  scoreColor,
  worldStateEntityLabel,
  worldStateSeverityColor,
  type QualityChapterEntry,
} from '../quality-dashboard-presentation'

/** 章节评分详情弹窗：聚合章节门、AI 味、审校复现、召回与状态等分区详情。 */
export default function ChapterDetailModal({
  chapter,
  onClose,
}: {
  chapter: QualityChapterEntry | null
  onClose: () => void
}) {
  return (
      <Modal
        title={chapter ? `第${chapter.chapterNum}章 · ${chapter.title}` : '章节评分'}
        open={!!chapter}
        onCancel={onClose}
        footer={null}
        width={600}
      >
        {chapter ? (
          <div className="quality-dashboard-page__chapter-modal">
            <div className="quality-dashboard-page__chapter-scores">
              <div className="quality-dashboard-page__chapter-score">
                <Progress
                  type="dashboard"
                  percent={chapter.overallScore * 10}
                  strokeColor={scoreColor(chapter.overallScore)}
                  format={() => <span className="quality-dashboard-page__chapter-score-value">{chapter.overallScore}</span>}
                />
                <div className="quality-dashboard-page__chapter-score-label">总分</div>
              </div>
              <div className="quality-dashboard-page__chapter-score">
                <Progress
                  type="dashboard"
                  percent={100 - chapter.aiLikeRate}
                  strokeColor={chapter.aiLikeRate > 50 ? '#f5222d' : chapter.aiLikeRate > 30 ? '#faad14' : '#52c41a'}
                  format={() => <span className="quality-dashboard-page__chapter-score-value">{chapter.aiLikeRate}%</span>}
                />
                <div className="quality-dashboard-page__chapter-score-label">AI 味率</div>
              </div>
            </div>
            {chapter.dimensions.map((dim) => (
              <div key={dim.name} className="quality-dashboard-page__dimension">
                <div className="quality-dashboard-page__dimension-head">
                  <span className="quality-dashboard-page__dimension-name">{dim.name}</span>
                  <Tag color={scoreColor(dim.score)} className="quality-dashboard-page__tag-reset">{dim.score}</Tag>
                </div>
                <Progress
                  percent={dim.score * 10}
                  showInfo={false}
                  strokeColor={scoreColor(dim.score)}
                  size="small"
                />
                {dim.feedback ? <div className="quality-dashboard-page__dimension-feedback">{dim.feedback}</div> : null}
                {dim.suggestion ? <div className="quality-dashboard-page__dimension-hint">{dim.suggestion}</div> : null}
              </div>
            ))}
            <ChapterGateDetails chapterGate={chapter.chapterGate} />
            <LanguageDriftDetails metrics={chapter.languageDriftMetrics} />
            <AntiAiRuleHitDetails hits={chapter.antiAiRuleHits} />
            <FeedbackRecurrenceDetails hits={chapter.feedbackRecurrenceHits} />
            <StyleComplianceDetails styleCompliance={chapter.styleCompliance} />
            <DialogueReviewDetails review={chapter.dialogueReview} />
            <StoryDynamicsDetails dynamics={chapter.storyDynamics} />
            <ChapterFunctionDetails chapterFunction={chapter.chapterFunction} />
            <StoryArcProgressDetails progress={chapter.storyArcProgress} />
            <RecallDiagnosticsDetails
              diagnostics={chapter.recallDiagnostics}
              snapshot={chapter.recallSnapshot}
              recallSnapshotSource={chapter.recallSnapshotSource}
            />
            <WorldStateAlertDetails alerts={chapter.worldStateAlerts} />
          </div>
        ) : null}
      </Modal>
  )
}

function ChapterGateDetails({ chapterGate }: { chapterGate?: QualityDashboardData['chapterDetails'][number]['chapterGate'] }) {
  if (!chapterGate?.latest) {
    return <div className="quality-dashboard-page__detail-empty">本章还没有章节验收门历史</div>
  }

  const latest = chapterGate.latest
  const drift = chapterGate.drift
  const dimensions = [
    { label: '连续性', value: latest.scoreBreakdown.continuityScore },
    { label: '结构连贯', value: latest.scoreBreakdown.coherenceScore },
    { label: '对白辨识', value: latest.scoreBreakdown.dialogueVoiceScore },
    { label: '钩子强度', value: latest.scoreBreakdown.hookStrengthScore },
    { label: '主角与节奏', value: latest.scoreBreakdown.storyDynamicsScore },
    { label: '语言自然度', value: latest.scoreBreakdown.languageNaturalnessScore },
  ]

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
        <strong>章节验收门</strong>
        <Tag color={chapterGateLevelColor(latest.gateLevel)} className="quality-dashboard-page__tag-reset">{chapterGateLevelLabel(latest.gateLevel)}</Tag>
        <Tag color={chapterGateBandColor(chapterGateScoreBand(latest.scoreBreakdown.totalScore))} className="quality-dashboard-page__tag-reset">
          {chapterGateBandLabel(chapterGateScoreBand(latest.scoreBreakdown.totalScore))}
        </Tag>
        <span className="quality-dashboard-page__text-strong" style={{ color: chapterGateHeatmapColor(latest.scoreBreakdown.totalScore) }}>{`总分 ${latest.scoreBreakdown.totalScore}`}</span>
      </div>
      <div className="quality-dashboard-page__body-copy--strong">{latest.summary}</div>
      {drift ? (
        <div className="quality-dashboard-page__body-copy--strong" style={{ color: drift.status === 'worsening' ? '#ff7875' : drift.status === 'improving' ? '#95de64' : 'rgba(255,255,255,0.72)' }}>
          {drift.summary}
        </div>
      ) : null}
      {dimensions.map((dimension) => (
        <div key={dimension.label} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
            <span>{dimension.label}</span>
            <span className="quality-dashboard-page__value-accent" style={{ color: chapterGateHeatmapColor(dimension.value) }}>{dimension.value}</span>
          </div>
          <Progress percent={dimension.value} showInfo={false} strokeColor={chapterGateHeatmapColor(dimension.value)} size="small" />
        </div>
      ))}
      {chapterGate.history.length > 1 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-6">
          <div className="quality-dashboard-page__row-label">最近门变更</div>
          {chapterGate.history.slice(0, 3).map((entry) => (
            <div key={`${entry.id}-${entry.createdAt}`} className="quality-dashboard-page__body-copy">
              {new Date(entry.createdAt).toLocaleString()} · {chapterGateLevelLabel(entry.gateLevel)} · 总分 {entry.scoreBreakdown.totalScore}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LanguageDriftDetails({ metrics }: { metrics?: LanguageDriftMetrics }) {
  if (!metrics) {
    return <div className="quality-dashboard-page__detail-empty">本章还没有 AI 味分解数据</div>
  }

  const ranked = getTopLanguageDriftMetrics(metrics, LANGUAGE_DRIFT_LABELS.length)

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">AI 味分解</div>
      {ranked.map((item) => (
        <div key={item.key} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
            <span>{item.label}</span>
            <span className="quality-dashboard-page__value-accent" style={{ color: languageDriftRiskColor(item.value) }}>{item.value}</span>
          </div>
          <Progress percent={item.value} showInfo={false} strokeColor={languageDriftRiskColor(item.value)} size="small" />
        </div>
      ))}
    </div>
  )
}

function AntiAiRuleHitDetails({ hits }: { hits?: QualityDashboardData['chapterDetails'][number]['antiAiRuleHits'] }) {
  if (!hits || hits.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章暂无 AI 味检测记录</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">本章 AI 味命中</div>
      {hits.map((hit) => (
        <div key={`${hit.ruleCode}-${hit.excerpt}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
            <Tag color={hit.severity === 'high' ? 'error' : hit.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
              {hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}
            </Tag>
            <span className="quality-dashboard-page__row-label">{hit.ruleTitle}</span>
            <Tag color={hit.source === 'language_drift' ? 'blue' : 'purple'} className="quality-dashboard-page__tag-reset">
              {hit.source === 'language_drift' ? '漂移' : '护栏'}
            </Tag>
            {hit.promotedToHardConstraint ? <Tag color="gold" className="quality-dashboard-page__tag-reset">已升级硬约束</Tag> : null}
          </div>
          {hit.excerpt ? <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">{hit.excerpt}</div> : null}
        </div>
      ))}
    </div>
  )
}

function FeedbackRecurrenceDetails({ hits }: { hits?: QualityDashboardData['chapterDetails'][number]['feedbackRecurrenceHits'] }) {
  if (!hits || hits.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章没有通用复现问题</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">本章审校复现信号</div>
      {hits.map((hit) => (
        <div key={`${hit.issueType}-${hit.source}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
            <Tag color={hit.severity === 'high' ? 'error' : hit.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
              {hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}
            </Tag>
            <span className="quality-dashboard-page__row-label">{hit.title}</span>
            <Tag color={hit.source === 'chapter_gate' ? 'purple' : hit.source === 'contract_validation' ? 'blue' : hit.source === 'anti_ai' ? 'gold' : 'default'} className="quality-dashboard-page__tag-reset">
              {hit.source === 'chapter_gate' ? '章节门' : hit.source === 'contract_validation' ? '合同校验' : hit.source === 'anti_ai' ? 'AI 味' : '审校'}
            </Tag>
            {hit.promotedToHardConstraint ? <Tag color="gold" className="quality-dashboard-page__tag-reset">已升级硬约束</Tag> : null}
            {hit.pauseSuggested ? <Tag color="error" className="quality-dashboard-page__tag-reset">建议暂停</Tag> : null}
          </div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">{hit.detail}</div>
        </div>
      ))}
    </div>
  )
}

function StyleComplianceDetails({ styleCompliance }: { styleCompliance?: QualityDashboardData['chapterDetails'][number]['styleCompliance'] }) {
  if (!styleCompliance) {
    return <div className="quality-dashboard-page__detail-empty">本章未启用风格硬约束校验</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
        <div className="quality-dashboard-page__detail-title">风格硬约束</div>
        <Tag color={styleCompliance.status === 'rewrite' ? 'error' : styleCompliance.status === 'warning' ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">
          {styleCompliance.status === 'rewrite' ? '重写' : styleCompliance.status === 'warning' ? '预警' : '通过'}
        </Tag>
        <span className="quality-dashboard-page__row-label">{`得分 ${styleCompliance.score}`}</span>
      </div>
      <div className="quality-dashboard-page__body-copy--strong">{styleCompliance.summary}</div>
      <div className="quality-dashboard-page__body-copy--strong">
        指标：
        {` 句长 ${styleCompliance.actualMetrics.avgSentenceLength}/${styleCompliance.referenceMetrics.avgSentenceLength}`}
        {` · 段长 ${styleCompliance.actualMetrics.avgParagraphLength}/${styleCompliance.referenceMetrics.avgParagraphLength}`}
        {` · 对话占比 ${styleCompliance.actualMetrics.dialogueLineRate}%/${styleCompliance.referenceMetrics.dialogueLineRate}%`}
        {` · 抽象词 ${styleCompliance.actualMetrics.abstractTokenDensity}%/${styleCompliance.referenceMetrics.abstractTokenDensity}%`}
      </div>
      {styleCompliance.deviations.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">偏移：{styleCompliance.deviations.join('；')}</div>
      ) : null}
      {styleCompliance.matchedForbiddenPatterns.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">禁用表达：{styleCompliance.matchedForbiddenPatterns.join('、')}</div>
      ) : null}
      {styleCompliance.rewriteHints.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">修正：{styleCompliance.rewriteHints.join('；')}</div>
      ) : null}
    </div>
  )
}

function DialogueReviewDetails({ review }: { review?: QualityDashboardData['chapterDetails'][number]['dialogueReview'] }) {
  if (!review) {
    return <div className="quality-dashboard-page__detail-empty">本章对白样本不足，暂时无法评估辨识度</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">角色对白辨识度</div>
      {review.fingerprintSummary ? <div className="quality-dashboard-page__body-copy--strong">{review.fingerprintSummary}</div> : null}
      {review.voiceLockSummary ? <div className="quality-dashboard-page__body-copy--strong">声线锁定：{review.voiceLockSummary}</div> : null}
      {review.risks.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">风险：{review.risks.join('；')}</div>
      ) : (
        <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">当前章没有明确的对白同质化风险。</div>
      )}
      {review.fillerRisks.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">空转：{review.fillerRisks.join('；')}</div>
      ) : null}
      {review.infoDensityRisks.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">信息密度：{review.infoDensityRisks.join('；')}</div>
      ) : null}
      {review.requiredVoiceLockCharacterIds.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">需锁角色 ID：{review.requiredVoiceLockCharacterIds.join('、')}</div>
      ) : null}
      {review.similarities.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">
          高相似：{review.similarities.map((item) => `${item.characterAName}/${item.characterBName} ${item.similarity}`).join('、')}
        </div>
      ) : null}
      {review.drifts.length > 0 ? (
        <div className="quality-dashboard-page__body-copy--strong">
          漂移：{review.drifts.map((item) => `${item.characterName} ${item.driftRate}`).join('、')}
        </div>
      ) : null}
    </div>
  )
}

function StoryDynamicsDetails({ dynamics }: { dynamics?: QualityDashboardData['chapterDetails'][number]['storyDynamics'] }) {
  if (!dynamics) return null

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">主角与节奏</div>
      <div className="quality-dashboard-page__body-copy--strong">主角受挫：{dynamics.protagonistSetback}{dynamics.setbackSummary ? ` · ${dynamics.setbackSummary}` : ''}</div>
      <div className="quality-dashboard-page__body-copy--strong">主角压力：<span className="quality-dashboard-page__value-accent" style={{ color: pressureColor(dynamics.protagonistPressure) }}>{dynamics.protagonistPressure}</span></div>
      <div className="quality-dashboard-page__body-copy--strong">代价：{dynamics.costPresent ? `${costResolutionStateLabel(dynamics.costResolutionState)}${dynamics.costSummary ? ` · ${dynamics.costSummary}` : ''}` : '无明确代价'}</div>
      <div className="quality-dashboard-page__body-copy--strong">反转：{dynamics.reversalMarker ? `${reversalSupportStateLabel(dynamics.reversalSupportState)}${dynamics.reversalSummary ? ` · ${dynamics.reversalSummary}` : ''}` : '无'}</div>
      <div className="quality-dashboard-page__body-copy--strong">节奏标签：{paceMarkerLabel(dynamics.paceMarker)} · 阶段回报：{rewardStateLabel(dynamics.rewardState)}</div>
    </div>
  )
}

function ChapterFunctionDetails({ chapterFunction }: { chapterFunction?: QualityDashboardData['chapterDetails'][number]['chapterFunction'] }) {
  if (!chapterFunction) {
    return <div className="quality-dashboard-page__detail-empty">本章还没有章节功能标注</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">章节功能</div>
      <div className="quality-dashboard-page__body-copy--strong">
        主功能：{chapterFunction.primaryTag ? chapterFunctionLabel(chapterFunction.primaryTag) : '未标注'}
      </div>
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--tight">
        {chapterFunction.tags.length > 0 ? chapterFunction.tags.map((tag) => (
          <Tag key={tag} color={chapterFunctionColor(tag)} className="quality-dashboard-page__tag-reset">
            {chapterFunctionLabel(tag)}
          </Tag>
        )) : <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">待标注</span>}
      </div>
      <div className="quality-dashboard-page__body-copy--strong">
        重复链：{chapterFunction.repeatedFunctionRunLength > 0
          ? `连续 ${chapterFunction.repeatedFunctionRunLength} 章`
          : '当前不在重复主功能链中'}
      </div>
      {chapterFunction.repeatedFunctionRange ? (
        <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">
          区段：第{chapterFunction.repeatedFunctionRange.startChapterNum}-{chapterFunction.repeatedFunctionRange.endChapterNum}章
        </div>
      ) : null}
      {chapterFunction.keyChapterRisk ? (
        <div className="quality-dashboard-page__body-copy--strong" style={{ color: '#faad14' }}>
          {chapterFunction.keyChapterRisk === 'missing_primary'
            ? '关键章节缺少主功能标签，建议补出本章真正承担的叙事职责。'
            : '当前章节属于关键节奏节点，但主功能偏弱，建议补出推进、回收、反转或爆发。'}
        </div>
      ) : null}
    </div>
  )
}

function StoryArcProgressDetails({ progress }: { progress?: QualityDashboardData['chapterDetails'][number]['storyArcProgress'] }) {
  if (!progress || progress.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章还没有故事弧推进数据</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">故事弧推进</div>
      {progress.map((entry) => (
        <div key={`${entry.arcId}-${entry.chapterId}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
            <span className="quality-dashboard-page__row-label">{entry.arcName}</span>
            <Tag color={entry.progressHit ? 'success' : 'default'} className="quality-dashboard-page__tag-reset">{entry.progressHit ? '推进章' : '空转章'}</Tag>
            {entry.checkpointPhaseLabels.map((label) => <Tag key={`${entry.arcId}-${label}`} color={entry.progressHit ? 'processing' : 'warning'} className="quality-dashboard-page__tag-reset">{label}</Tag>)}
          </div>
          <div className="quality-dashboard-page__body-copy--strong">推进度：{entry.progressPercent}%{entry.arcProgressText ? ` · ${entry.arcProgressText}` : ''}</div>
          {entry.reviewRisks.length > 0 ? <div className="quality-dashboard-page__body-copy--strong">审校风险：{entry.reviewRisks.join('；')}</div> : null}
          {entry.alertDetails.length > 0 ? <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">告警：{entry.alertDetails.join('；')}</div> : null}
        </div>
      ))}
    </div>
  )
}

function RecallDiagnosticsDetails({
  diagnostics,
  snapshot,
  recallSnapshotSource,
}: {
  diagnostics?: QualityDashboardData['chapterDetails'][number]['recallDiagnostics']
  snapshot?: QualityDashboardData['chapterDetails'][number]['recallSnapshot']
  recallSnapshotSource?: QualityDashboardData['chapterDetails'][number]['recallSnapshotSource']
}) {
  if (!diagnostics && !snapshot) {
    return <div className="quality-dashboard-page__detail-empty">本章还没有召回可靠性数据</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap quality-dashboard-page__row--center">
        <div className="quality-dashboard-page__detail-title">召回可靠性</div>
        {recallSnapshotSource ? (
          <Tag color={recallSnapshotSourceColor(recallSnapshotSource)} className="quality-dashboard-page__tag-reset">
            {recallSnapshotSourceLabel(recallSnapshotSource)}
          </Tag>
        ) : null}
      </div>
      {snapshot ? (
        <div className="quality-dashboard-page__body-copy--strong">
          运行结果：{snapshot.retrievalUsed ? '实际使用召回' : '未实际使用召回'}
          {snapshot.degraded ? ` · 已降级${snapshot.fallbackReason ? `：${recallFallbackReasonLabel(snapshot.fallbackReason)}` : ''}` : ' · 未降级'}
          {' '}· 总命中：{snapshot.hitCount}
        </div>
      ) : null}
      {diagnostics ? (
        <div className="quality-dashboard-page__body-copy--strong">召回依赖率：{diagnostics.recallDependencyRate}% · 过期召回率：{diagnostics.staleRecallRate}%</div>
      ) : null}
      {diagnostics ? (
        <div className="quality-dashboard-page__body-copy--strong">可用片段：{diagnostics.selectedHitCount} · 过期片段：{diagnostics.staleRecallCount} · 兜底命中：{diagnostics.fallbackHitCount}</div>
      ) : null}
      {diagnostics && diagnostics.summaryLines.length > 0 ? (
        <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--normal">{diagnostics.summaryLines.join(' ')}</div>
      ) : null}
    </div>
  )
}

function WorldStateAlertDetails({ alerts }: { alerts?: QualityDashboardData['chapterDetails'][number]['worldStateAlerts'] }) {
  if (!alerts || alerts.length === 0) {
    return <div className="quality-dashboard-page__detail-empty">本章没有状态稳定性告警</div>
  }

  return (
    <div className="quality-dashboard-page__detail-stack">
      <div className="quality-dashboard-page__detail-title">状态稳定性</div>
      {alerts.map((alert, index) => (
        <div key={`${alert.summary}-${index}`} className="quality-dashboard-page__detail-block">
          <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
            <Tag color={worldStateSeverityColor(alert.severity)} className="quality-dashboard-page__tag-reset">{alert.alertType === 'conflict' ? '冲突' : '跳变'}</Tag>
            <span className="quality-dashboard-page__row-label">{worldStateEntityLabel(alert.entityType)} · {alert.entityName}</span>
          </div>
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{alert.summary}</div>
        </div>
      ))}
    </div>
  )
}
