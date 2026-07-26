import { Empty, Tag } from 'antd'
import type { LanguageDriftMetrics, QualityDashboardData } from '../../../../types'
import { WorkspacePanel } from '../../components/WorkspaceShell'
import MiniTrendRow from './MiniTrendRow'
import {
  LANGUAGE_DRIFT_LABELS,
  characterRoleTypeLabel,
  dialogueSimilarityColor,
  dialogueTrendColor,
  dialogueTrendLabel,
  formatSignedValue,
  getTopLanguageDriftMetrics,
  languageDriftRiskColor,
  languageDriftStatusColor,
  languageDriftStatusLabel,
  type VolumeFilteredDashboard,
} from '../quality-dashboard-presentation'

interface LanguageSectionProps {
  data: QualityDashboardData
  filtered: VolumeFilteredDashboard
  hasScoreData: boolean
}

/** 语言与对白 Tab：AI 味分解与角色对白辨识度。 */
export default function LanguageSection({ data, filtered, hasScoreData }: LanguageSectionProps) {
  return (
    <>
      {hasScoreData ? (
        <WorkspacePanel title="AI 味分解">
          <LanguageDriftPanel
            averages={data.averageLanguageDrift}
            trends={data.languageDriftTrends}
            recentAlerts={data.recentLanguageDriftAlerts}
            volumeEntries={filtered.languageVolumes}
            novelSummary={data.novelLanguageDriftSummary}
            expressionDedupSummary={data.expressionDedupSummary}
            antiAiRecurrence={filtered.antiAiRecurrence}
            feedbackRecurrence={filtered.feedbackRecurrence}
          />
        </WorkspacePanel>
      ) : null}

      {data.dialogueFingerprintStats.eligibleCharacterCount > 0 ? (
        <WorkspacePanel title="角色对白辨识度">
          <DialogueFingerprintPanel
            stats={data.dialogueFingerprintStats}
            signatures={data.characterDialogueSignatures}
            similarities={data.crossCharacterDialogueSimilarity}
            driftEntries={data.dialogueDriftTrend}
            volumeEntries={data.volumeDialogueSimilarity}
            alerts={data.recentDialogueAlerts}
            voiceLockCandidates={data.requiredDialogueVoiceLocks}
          />
        </WorkspacePanel>
      ) : (
        <WorkspacePanel title="角色对白辨识度">
          <Empty description="当前还没有足够的对白指纹数据。" />
        </WorkspacePanel>
      )}
    </>
  )
}

function LanguageDriftPanel({
  averages,
  trends,
  recentAlerts,
  volumeEntries,
  novelSummary,
  expressionDedupSummary,
  antiAiRecurrence,
  feedbackRecurrence,
}: {
  averages: LanguageDriftMetrics
  trends: QualityDashboardData['languageDriftTrends']
  recentAlerts: QualityDashboardData['recentLanguageDriftAlerts']
  volumeEntries: QualityDashboardData['volumeLanguageDrift']
  novelSummary: QualityDashboardData['novelLanguageDriftSummary']
  expressionDedupSummary: QualityDashboardData['expressionDedupSummary']
  antiAiRecurrence: QualityDashboardData['antiAiRecurrence']
  feedbackRecurrence: QualityDashboardData['feedbackRecurrence']
}) {
  const hasAnyData = LANGUAGE_DRIFT_LABELS.some(({ key }) => trends[key].length > 0)
  if (!hasAnyData) {
    return <Empty description="先生成 AI 味分解，才能判断问题来源" />
  }
  const cards = LANGUAGE_DRIFT_LABELS.map(({ key, label }) => ({ key, label, value: averages[key] }))
  const topRiskMetrics = novelSummary.topRiskMetrics.slice(0, 3)

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-160">
        {cards.map((card) => (
          <div key={card.key} className="quality-dashboard-page__stat-card">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
            <div className="quality-dashboard-page__medium-number" style={{ color: languageDriftRiskColor(card.value) }}>{card.value}</div>
            <div className="quality-dashboard-page__body-copy--soft">平均风险值，越低越好</div>
          </div>
        ))}
      </div>

      <div className="quality-dashboard-page__grid-220">
        <div className="quality-dashboard-page__panel-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">全书级摘要</div>
          <div className="quality-dashboard-page__row-label">
            已纳入 {novelSummary.chapterCount} 章
            {novelSummary.recentWindowSize > 0 ? ` · 最近窗口 ${novelSummary.recentWindowSize} 章` : ''}
          </div>
          <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
            <Tag color="error" className="quality-dashboard-page__tag-reset">恶化 {novelSummary.statusBreakdown.worsening}</Tag>
            <Tag color="success" className="quality-dashboard-page__tag-reset">改善 {novelSummary.statusBreakdown.improving}</Tag>
            <Tag className="quality-dashboard-page__tag-reset">稳定 {novelSummary.statusBreakdown.stable}</Tag>
          </div>
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">当前最高优先问题</div>
          {topRiskMetrics.length > 0 ? topRiskMetrics.map((item) => (
            <div key={item.metric} className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
              <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{item.label}</span>
              <span className="quality-dashboard-page__value-accent" style={{ color: languageDriftRiskColor(item.value) }}>{item.value}</span>
            </div>
          )) : (
            <div className="quality-dashboard-page__body-copy">等待分解结果</div>
          )}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最近恶化项</div>
          {recentAlerts.length > 0 ? recentAlerts.slice(0, 3).map((alert) => (
            <div key={alert.metric} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                  <Tag color={languageDriftStatusColor(alert.status)} className="quality-dashboard-page__tag-reset">
                    {languageDriftStatusLabel(alert.status)}
                  </Tag>
                  <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{alert.label}</span>
                </div>
                <span className="quality-dashboard-page__row-label" style={{ color: '#f5222d' }}>{formatSignedValue(alert.delta)}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny">
                窗口均值 {alert.previousValue} → {alert.latestValue}
              </div>
            </div>
          )) : (
            <div className="quality-dashboard-page__body-copy">最近窗口内没有明显恶化项。</div>
          )}
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-160">
        {[
          { label: '命中章节', value: antiAiRecurrence.hitChapterCount, note: '至少命中过一次 AI 味规则的章节' },
          { label: '复现规则', value: antiAiRecurrence.recurringRuleCount, note: '跨章重复出现的问题类型' },
          { label: '已升级硬约束', value: antiAiRecurrence.promotedRuleCount, note: '连续 2 章命中后自动升级' },
          { label: '5章高风险', value: antiAiRecurrence.highRiskRuleCount, note: '5 章窗口内至少 3 次复现' },
        ].map((card) => (
          <div key={card.label} className="quality-dashboard-page__stat-card">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
            <div className="quality-dashboard-page__medium-number">{card.value}</div>
            <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跨章高频问题</div>
          {antiAiRecurrence.topRepeatedRules.length > 0 ? antiAiRecurrence.topRepeatedRules.slice(0, 4).map((item) => (
            <div key={item.ruleCode} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <span className="quality-dashboard-page__row-label">{item.ruleTitle}</span>
                <Tag color={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                  {`第 ${item.lastChapterNum} 章`}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">
                {`命中 ${item.hitCount} 次 / 覆盖 ${item.chapterCount} 章`}
                {item.promotedCount > 0 ? ` · 已升级 ${item.promotedCount} 次` : ''}
              </div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">当前还没有跨章复现的 AI 味规则。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已升级为下一章硬约束</div>
          {antiAiRecurrence.promotedRules.length > 0 ? antiAiRecurrence.promotedRules.slice(0, 4).map((item) => (
            <div key={item.ruleCode} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                <span className="quality-dashboard-page__row-label">{item.ruleTitle}</span>
                <Tag color="gold" className="quality-dashboard-page__tag-reset">已前置</Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">
                {`触发章节：${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}
              </div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的连续两章复现问题。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期告警</div>
          {antiAiRecurrence.recentAlerts.length > 0 ? antiAiRecurrence.recentAlerts.slice(0, 4).map((alert) => (
            <div key={`${alert.ruleCode}-${alert.lastChapterNum}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <span className="quality-dashboard-page__row-label">{alert.ruleTitle}</span>
                <Tag color={alert.severity === 'critical' ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                  {alert.severity === 'critical' ? '需回查' : '已升级'}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">近期没有新的 AI 味复现。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
        {LANGUAGE_DRIFT_LABELS.map(({ key, label }) => (
          <MiniTrendRow key={key} label={label} points={trends[key]} />
        ))}
      </div>

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级语言退化</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => {
              const topMetrics = getTopLanguageDriftMetrics(volume.averageMetrics, 2)
              return (
                <div key={volume.volumeId} className="quality-dashboard-page__panel-card">
                  <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--start">
                    <div>
                      <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                      <div className="quality-dashboard-page__body-copy--tiny">
                        第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章
                      </div>
                    </div>
                    <Tag color={volume.topWorseningMetrics.length > 0 ? 'warning' : 'success'} className="quality-dashboard-page__tag-reset">
                      {volume.topWorseningMetrics.length > 0 ? `${volume.topWorseningMetrics.length} 项恶化` : '近期稳定'}
                    </Tag>
                  </div>

                  <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-6">
                    {topMetrics.map((item) => (
                      <div key={item.key} className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
                        <span className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{item.label}</span>
                        <span className="quality-dashboard-page__value-accent" style={{ color: languageDriftRiskColor(item.value) }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="quality-dashboard-page__body-copy--tiny">
                    {volume.topWorseningMetrics.length > 0
                      ? `近期恶化：${volume.topWorseningMetrics.map((item) => `${item.label} ${formatSignedValue(item.delta)}`).join('、')}`
                      : '最近窗口内没有明显恶化项。'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {antiAiRecurrence.volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级 AI 味复现</div>
          <div className="quality-dashboard-page__grid-220">
            {antiAiRecurrence.volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章`}</div>
                <div className="quality-dashboard-page__body-copy--strong">{`命中章节 ${volume.hitChapterCount} · 复现规则 ${volume.recurringRuleCount}`}</div>
                <div className="quality-dashboard-page__body-copy--strong">{`已升级 ${volume.promotedRuleCount} · 高风险 ${volume.highRiskRuleCount}`}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
        <div className="quality-dashboard-page__section-title">跨章表达去重</div>

        <div className="quality-dashboard-page__metric-grid-160">
          {[
            {
              label: '当前模式',
              value: expressionDedupSummary.currentMode === 'longform' ? '长篇' : '短篇',
              note: expressionDedupSummary.currentMode === 'longform' ? '启用近章 / 当前卷 / 全书采样三级窗口' : '重点盯最近窗口内的直接复用',
            },
            { label: '高风险章节', value: expressionDedupSummary.highRiskChapterCount, note: '跨章表达或结构复用已进入高风险的章节数' },
            { label: '近章窗口', value: expressionDedupSummary.recentWindowSize || '-', note: '直接进入禁复用判断的最近章节数' },
            {
              label: '卷/全书窗口',
              value: `${expressionDedupSummary.volumeWindowSize || 0}/${expressionDedupSummary.globalSampleWindowSize || 0}`,
              note: '卷内轮换提醒 / 全书级稀疏采样窗口',
            },
          ].map((card) => (
            <div key={card.label} className="quality-dashboard-page__stat-card">
              <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
              <div className="quality-dashboard-page__medium-number">{card.value}</div>
              <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="quality-dashboard-page__metric-grid-240">
          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">高频复用表达</div>
            {expressionDedupSummary.topRepeatedPhrases.length > 0 ? expressionDedupSummary.topRepeatedPhrases.slice(0, 4).map((item) => (
              <div key={item.phrase} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{item.phrase}</span>
                  <Tag className="quality-dashboard-page__tag-reset">{`${item.chapterNums.length} 章`}</Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{`命中 ${item.count} 次 · 覆盖 ${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}</div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">当前还没有稳定复现的高频表达。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">结构同质化</div>
            <div className="quality-dashboard-page__body-copy--tiny-strong">{expressionDedupSummary.summary}</div>
            <div className="quality-dashboard-page__body-copy--strong">
              {expressionDedupSummary.repeatedOpeningPatterns.length > 0 ? `章首：${expressionDedupSummary.repeatedOpeningPatterns.join('、')}` : '章首暂无明显同质化'}
            </div>
            <div className="quality-dashboard-page__body-copy--strong">
              {expressionDedupSummary.repeatedClosingPatterns.length > 0 ? `章尾：${expressionDedupSummary.repeatedClosingPatterns.join('、')}` : '章尾暂无明显同质化'}
            </div>
            <div className="quality-dashboard-page__body-copy--strong">
              {expressionDedupSummary.repeatedClimaxPatterns.length > 0 ? `高潮：${expressionDedupSummary.repeatedClimaxPatterns.join('、')}` : '高潮结构暂无明显复用'}
            </div>
            {expressionDedupSummary.currentMode === 'longform' ? (
              <div className="quality-dashboard-page__body-copy--tiny">
                {expressionDedupSummary.volumeRepeatedPatterns.length > 0 ? `当前卷：${expressionDedupSummary.volumeRepeatedPatterns.join('、')}` : '当前卷暂无稳定同质化模式。'}
                {expressionDedupSummary.globalRepeatedPatterns.length > 0 ? ` 全书：${expressionDedupSummary.globalRepeatedPatterns.join('、')}` : ''}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
        <div className="quality-dashboard-page__section-title">审校反哺与复现闭环</div>

        <div className="quality-dashboard-page__metric-grid-160">
          {[
            { label: '命中章节', value: feedbackRecurrence.hitChapterCount, note: '至少出现一次通用复现问题的章节' },
            { label: '复现问题', value: feedbackRecurrence.recurringIssueCount, note: '跨章重复出现的问题类型' },
            { label: '已升级硬约束', value: feedbackRecurrence.promotedIssueCount, note: '连续 2 章或窗口高风险后自动前置' },
            { label: '建议暂停', value: feedbackRecurrence.pauseSuggestedIssueCount, note: '结构/连续性类高风险复现，建议暂停批量' },
          ].map((card) => (
            <div key={card.label} className="quality-dashboard-page__stat-card">
              <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
              <div className="quality-dashboard-page__medium-number">{card.value}</div>
              <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="quality-dashboard-page__metric-grid-160">
          {[
            { label: '人味命中章节', value: feedbackRecurrence.humanization.hitChapterCount, note: '模板衔接、解释腔、锚点不足、立场发虚等' },
            { label: '人味复现问题', value: feedbackRecurrence.humanization.recurringIssueCount, note: '跨章重复出现的人味问题类型' },
            { label: '人味已前置', value: feedbackRecurrence.humanization.promotedIssueCount, note: '下一章会作为硬约束注入的去 AI 味问题' },
            { label: '人味高风险', value: feedbackRecurrence.humanization.highRiskIssueCount, note: '5 章窗口内高频复现的人味问题' },
          ].map((card) => (
            <div key={card.label} className="quality-dashboard-page__stat-card">
              <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">{card.label}</div>
              <div className="quality-dashboard-page__medium-number">{card.value}</div>
              <div className="quality-dashboard-page__body-copy--soft">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="quality-dashboard-page__metric-grid-240">
          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">跨章高频问题</div>
            {feedbackRecurrence.topRepeatedIssues.length > 0 ? feedbackRecurrence.topRepeatedIssues.slice(0, 4).map((item) => (
              <div key={item.issueType} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                    {`第 ${item.lastChapterNum} 章`}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">
                  {`命中 ${item.hitCount} 次 / 覆盖 ${item.chapterCount} 章`}
                  {item.promotedCount > 0 ? ` · 已升级 ${item.promotedCount} 次` : ''}
                </div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">当前还没有跨章复现的通用审校问题。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已升级为下一章硬约束</div>
            {feedbackRecurrence.promotedIssues.length > 0 ? feedbackRecurrence.promotedIssues.slice(0, 4).map((item) => (
              <div key={item.issueType} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.pauseSuggested ? 'error' : 'gold'} className="quality-dashboard-page__tag-reset">
                    {item.pauseSuggested ? '高风险前置' : '已前置'}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">
                  {`触发章节：${item.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}`}
                </div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">最近没有新的审校复现硬约束。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期告警</div>
            {feedbackRecurrence.recentAlerts.length > 0 ? feedbackRecurrence.recentAlerts.slice(0, 4).map((alert) => (
              <div key={`${alert.issueType}-${alert.lastChapterNum}`} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{alert.title}</span>
                  <Tag color={alert.pauseSuggested ? 'error' : alert.severity === 'critical' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                    {alert.pauseSuggested ? '建议暂停' : alert.severity === 'critical' ? '需回查' : '已升级'}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">近期没有新的审校复现。</div>}
          </div>

          <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">人味前置约束</div>
            {feedbackRecurrence.humanization.promotedIssues.length > 0 ? feedbackRecurrence.humanization.promotedIssues.slice(0, 4).map((item) => (
              <div key={`humanization-${item.issueType}`} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.pauseSuggested ? 'error' : 'gold'} className="quality-dashboard-page__tag-reset">
                    {item.pauseSuggested ? '高风险前置' : '已前置'}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{item.avoid}</div>
              </div>
            )) : feedbackRecurrence.humanization.topRepeatedIssues.length > 0 ? feedbackRecurrence.humanization.topRepeatedIssues.slice(0, 4).map((item) => (
              <div key={`humanization-trend-${item.issueType}`} className="quality-dashboard-page__detail-block">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                  <span className="quality-dashboard-page__row-label">{item.title}</span>
                  <Tag color={item.severity === 'high' ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                    {`第 ${item.lastChapterNum} 章`}
                  </Tag>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">{item.detail}</div>
              </div>
            )) : <div className="quality-dashboard-page__body-copy">风格硬约束目前稳定。</div>}
          </div>
        </div>

        {feedbackRecurrence.volumeEntries.length > 0 ? (
          <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
            <div className="quality-dashboard-page__section-title">卷级审校复现</div>
            <div className="quality-dashboard-page__grid-220">
              {feedbackRecurrence.volumeEntries.map((volume) => (
                <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                  <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                  <div className="quality-dashboard-page__body-copy--tiny">{`第${volume.chapterStart}-${volume.chapterEnd}章 · ${volume.chapterCount} 章`}</div>
                  <div className="quality-dashboard-page__body-copy--strong">{`命中章节 ${volume.hitChapterCount} · 复现问题 ${volume.recurringIssueCount}`}</div>
                  <div className="quality-dashboard-page__body-copy--strong">{`已升级 ${volume.promotedIssueCount} · 高风险 ${volume.highRiskIssueCount}`}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
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
  voiceLockCandidates,
}: {
  stats: QualityDashboardData['dialogueFingerprintStats']
  signatures: QualityDashboardData['characterDialogueSignatures']
  similarities: QualityDashboardData['crossCharacterDialogueSimilarity']
  driftEntries: QualityDashboardData['dialogueDriftTrend']
  volumeEntries: QualityDashboardData['volumeDialogueSimilarity']
  alerts: QualityDashboardData['recentDialogueAlerts']
  voiceLockCandidates: QualityDashboardData['requiredDialogueVoiceLocks']
}) {
  if (stats.eligibleCharacterCount === 0) {
    return <Empty description="对白样本还不够，继续累积章节后再比对" />
  }

  return (
    <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-16">
      <div className="quality-dashboard-page__metric-grid-170">
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">已建角色指纹</div>
          <div className="quality-dashboard-page__medium-number">{stats.eligibleCharacterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">累计识别对白 {stats.totalTurnCount} 段</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">平均跨角色相似度</div>
          <div className="quality-dashboard-page__medium-number" style={{ color: dialogueSimilarityColor(stats.averageCrossCharacterSimilarity) }}>{stats.averageCrossCharacterSimilarity}</div>
          <div className="quality-dashboard-page__body-copy--soft">越低越能拉开角色声音</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">高相似组合</div>
          <div className="quality-dashboard-page__medium-number">{stats.highSimilarityPairCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">阈值 75 以上</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">漂移角色</div>
          <div className="quality-dashboard-page__medium-number">{stats.driftingCharacterCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">近期漂移率 45 以上</div>
        </div>
        <div className="quality-dashboard-page__stat-card">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">需声线锁定角色</div>
          <div className="quality-dashboard-page__medium-number">{stats.voiceLockCandidateCount}</div>
          <div className="quality-dashboard-page__body-copy--soft">连续漂移或同声化预警</div>
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">近期告警</div>
          {alerts.length > 0 ? alerts.map((alert, index) => (
            <div key={`${alert.kind}-${index}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                <Tag color={alert.severity === 'warning' ? 'warning' : 'default'} className="quality-dashboard-page__tag-reset">
                  {alert.kind === 'similarity' ? '同质化' : '漂移'}
                </Tag>
                <span className="quality-dashboard-page__row-label">{alert.title}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{alert.detail}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">最近没有新的对白指纹告警。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">最高相似角色组合</div>
          {similarities.length > 0 ? similarities.slice(0, 4).map((pair) => (
            <div key={`${pair.characterAId}-${pair.characterBId}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__body-copy--strong">
                <span>{pair.characterAName} / {pair.characterBName}</span>
                <span className="quality-dashboard-page__text-strong" style={{ color: dialogueSimilarityColor(pair.similarity) }}>{pair.similarity}</span>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny">{pair.reasons.join('、') || '句长、停顿和惯用短语接近。'}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">当前样本还不足以计算跨角色相似度。</div>}
        </div>

        <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
          <div className="quality-dashboard-page__body-copy quality-dashboard-page__body-copy--muted">需要声线锁定的角色</div>
          {voiceLockCandidates.length > 0 ? voiceLockCandidates.slice(0, 5).map((candidate) => (
            <div key={`${candidate.characterId}-${candidate.severity}`} className="quality-dashboard-page__detail-block">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <strong className="quality-dashboard-page__row-label">{candidate.characterName}</strong>
                <Tag color={candidate.severity === 'critical' ? 'error' : 'warning'} className="quality-dashboard-page__tag-reset">
                  {candidate.severity === 'critical' ? '强制' : '建议'}
                </Tag>
              </div>
              <div className="quality-dashboard-page__body-copy--tiny-strong">{candidate.reason}</div>
            </div>
          )) : <div className="quality-dashboard-page__body-copy">当前角色声音区分度足够，不需要新增声线锁定。</div>}
        </div>
      </div>

      <div className="quality-dashboard-page__metric-grid-240">
        {signatures.slice(0, 6).map((signature) => (
          <div key={signature.characterId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
            <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
              <div>
                <div className="quality-dashboard-page__section-title">{signature.characterName}</div>
                <div className="quality-dashboard-page__body-copy--tiny">
                  {signature.sampleCount} 段对白 · {signature.totalDialogueChars} 字
                </div>
              </div>
              <Tag className="quality-dashboard-page__tag-reset">{characterRoleTypeLabel(signature.roleType)}</Tag>
            </div>
            <div className="quality-dashboard-page__body-copy--strong">{signature.voiceProfile}</div>
            {signature.distinctiveHabits.length > 0 ? (
              <div className="quality-dashboard-page__body-copy--tiny-strong">特点：{signature.distinctiveHabits.join('、')}</div>
            ) : null}
            <div className="quality-dashboard-page__body-copy--tiny-strong">
              句长 {signature.avgSentenceLength} · 追问 {signature.questionRate}% · 停顿 {signature.ellipsisRate}% · 重复短语 {signature.catchphraseCandidates.slice(0, 2).map((item) => item.token).join('、') || '未捕捉'}
            </div>
          </div>
        ))}
      </div>

      {driftEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-10">
          <div className="quality-dashboard-page__section-title">角色语音漂移趋势</div>
          {driftEntries.slice(0, 5).map((entry) => (
            <div key={entry.characterId} className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-6">
              <div className="quality-dashboard-page__row quality-dashboard-page__row--between quality-dashboard-page__row--center">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--center">
                  <strong>{entry.characterName}</strong>
                  <Tag color={dialogueTrendColor(entry.status)} className="quality-dashboard-page__tag-reset">{dialogueTrendLabel(entry.status)}</Tag>
                </div>
                <span className="quality-dashboard-page__row-label" style={{ color: dialogueSimilarityColor(entry.recentDriftRate) }}>{entry.recentDriftRate}</span>
              </div>
              <MiniTrendRow label="漂移率" points={entry.trend.map((point) => ({ chapterNum: point.chapterNum, value: point.value }))} />
              {entry.reasons.length > 0 ? <div className="quality-dashboard-page__body-copy--tiny">{entry.reasons.join('、')}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {volumeEntries.length > 0 ? (
        <div className="quality-dashboard-page__grid quality-dashboard-page__grid--gap-12">
          <div className="quality-dashboard-page__section-title">卷级对白同质化</div>
          <div className="quality-dashboard-page__grid-220">
            {volumeEntries.map((volume) => (
              <div key={volume.volumeId} className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
                <div className="quality-dashboard-page__row quality-dashboard-page__row--between">
                  <div>
                    <div className="quality-dashboard-page__section-title">{volume.volumeName}</div>
                    <div className="quality-dashboard-page__body-copy--tiny">第{volume.chapterStart}-{volume.chapterEnd}章 · {volume.chapterCount} 章</div>
                  </div>
                  <span className="quality-dashboard-page__row-label" style={{ color: dialogueSimilarityColor(volume.averageSimilarity) }}>{volume.averageSimilarity}</span>
                </div>
                <div className="quality-dashboard-page__body-copy--tiny-strong">
                  {volume.topPairs.length > 0
                    ? `最像：${volume.topPairs.map((pair) => `${pair.characterAName}/${pair.characterBName} ${pair.similarity}`).join('、')}`
                    : '该卷样本还不够，暂时无法做稳定对比。'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
