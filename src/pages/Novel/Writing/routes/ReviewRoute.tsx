import React from 'react'
import { Button, Tag } from 'antd'
import AIScorePanel from '../../../../components/AIScorePanel'
import ReviewNotesPanel from '../../../../components/novel/writing/ReviewNotesPanel'
import type { ChapterPublishCheck } from '../../../../types'
import {
  AiCheckResult,
  DialogueFingerprintHealthCard,
  HumanizationHealthCard,
  InsightCard,
  LanguageDriftHealthCard,
  StoryDynamicsHealthCard,
  StringList,
  WorldStateHealthCard,
} from '../components/InsightPanel'
import type { ReviewInspectorActions, ReviewInspectorViewModel } from '../writing-inspector-view-model'

interface Props {
  model: ReviewInspectorViewModel
  actions: ReviewInspectorActions
  title?: string
}

const issueColor = (severity: 'high' | 'medium' | 'low') => severity === 'high' ? 'error' : severity === 'medium' ? 'warning' : 'default'
const issueLabel = (severity: 'high' | 'medium' | 'low') => severity === 'high' ? '高优先' : severity === 'medium' ? '中优先' : '低优先'
const healthLabel = (score: number) => score >= 80 ? '结构稳定' : score >= 60 ? '可继续推进' : '需要处理问题'
const publishStatusLabel = (status: ChapterPublishCheck['checklist'][number]['status']) => status === 'rewrite' ? '退回重写' : status === 'blocker' ? '阻塞' : status === 'warning' ? '预警' : '通过'
const publishStatusColor = (status: ChapterPublishCheck['checklist'][number]['status']) => status === 'rewrite' ? 'red' : status === 'blocker' ? 'error' : status === 'warning' ? 'warning' : 'success'
const scoreColor = (score: number) => score >= 80 ? 'success' : score >= 60 ? 'processing' : score >= 40 ? 'warning' : 'error'
const driftLabel = (status?: 'worsening' | 'improving' | 'stable') => status === 'worsening' ? '恶化' : status === 'improving' ? '改善' : '稳定'
const driftColor = (status?: 'worsening' | 'improving' | 'stable') => status === 'worsening' ? 'error' : status === 'improving' ? 'success' : 'default'
const gateColor = (check: ChapterPublishCheck) => check.gateLevel === 'pass' ? 'success' : check.gateLevel === 'warning' ? 'warning' : 'error'

function ReviewSpotlight({ model }: { model: ReviewInspectorViewModel }) {
  return (
    <div className="novel-writing-shell__insight-spotlight">
      <InsightCard title="全书健康度" eyebrow="结构体检" tone="hero">
        {model.consistencyReport ? (
          <div className="novel-health-board">
            <div className="novel-health-score">
              <strong>{model.consistencyReport.readinessScore}</strong>
              <span>{healthLabel(model.consistencyReport.readinessScore)}</span>
            </div>
            <div className="novel-health-breakdown">
              <div><strong>{model.consistencyReport.highCount}</strong><span>高危</span></div>
              <div><strong>{model.consistencyReport.mediumCount}</strong><span>中危</span></div>
              <div><strong>{model.consistencyReport.lowCount}</strong><span>低危</span></div>
            </div>
          </div>
        ) : <div className="novel-copy-block">正在分析全书结构健康度。</div>}
      </InsightCard>
      <InsightCard title="本章风险" eyebrow="优先修复">
        {model.chapterIssues.length > 0 ? (
          <div className="novel-issue-list">
            {model.chapterIssues.slice(0, 8).map((issue) => (
              <div key={issue.id} className="novel-issue-item">
                <div className="novel-issue-item__head"><Tag color={issueColor(issue.severity)}>{issueLabel(issue.severity)}</Tag><strong>{issue.title}</strong></div>
                <div className="novel-issue-item__desc">{issue.description}</div>
                <div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div>
              </div>
            ))}
          </div>
        ) : <div className="novel-copy-block">当前章节没有被结构体检命中的明显风险。</div>}
      </InsightCard>
    </div>
  )
}

function PublishCheckCard({ model, actions }: Pick<Props, 'model' | 'actions'>) {
  const check = model.publishCheck
  if (!check) return <InsightCard title="发布前检查" eyebrow="完成门槛" tone="soft"><div className="novel-copy-block">先运行发布前检查，再决定是否可定稿。</div></InsightCard>
  return (
    <InsightCard title="发布前检查" eyebrow="完成门槛" tone="soft">
      <div className="novel-gate-report">
        <div className="novel-gate-report__summary">
          <div className="novel-gate-report__summary-copy">
            <div className="novel-gate-report__headline">
              <Tag color={gateColor(check)}>{check.gateLevel === 'rewrite' ? '退回重写' : check.gateLevel === 'blocker' ? '阻塞' : check.gateLevel === 'warning' ? '预警' : '通过'}</Tag>
              <strong>{check.summary}</strong>
              <Tag color={scoreColor(check.scoreBreakdown.totalScore)}>{`总分 ${check.scoreBreakdown.totalScore}`}</Tag>
              {check.drift ? <Tag color={driftColor(check.drift.status)}>{`${driftLabel(check.drift.status)} ${check.drift.scoreDelta > 0 ? `+${check.drift.scoreDelta}` : check.drift.scoreDelta}`}</Tag> : null}
            </div>
            <div className="novel-gate-report__counts">
              <span>{`重写 ${check.rewriteCount}`}</span><span>{`阻塞 ${check.blockerCount}`}</span><span>{`预警 ${check.warningCount}`}</span>
              {check.generatedTaskCount > 0 ? <span>{`任务 ${check.generatedTaskCount}`}</span> : null}
            </div>
          </div>
          <div className="novel-gate-report__actions">
            {check.rewriteTarget ? <Button size="small" type="primary" danger={check.gateLevel === 'rewrite'} onClick={() => {
              const rewriteItem = check.checklist.find((item) => item.status === 'rewrite')
              if (rewriteItem) actions.onOpenGateIssue(rewriteItem)
            }}>打开重写目标</Button> : null}
            <Button size="small" onClick={actions.onToggleGateReport}>{model.gateReportExpanded ? '收起报告' : '展开报告'}</Button>
            <Button size="small" onClick={actions.onOpenQualityDashboard}>去质量看板</Button>
          </div>
        </div>
        {check.drift || model.publishCheckHistoryItems.length > 0 ? <PublishCheckHistory model={model} /> : null}
        <div className="novel-gate-report__score-grid">
          {model.publishCheckScores.map((item) => <div key={item.label} className="novel-gate-report__score-card"><span>{item.label}</span><strong>{item.value}</strong></div>)}
        </div>
        <div className="novel-copy-block">合同对账：{check.contractAudit.summary}</div>
        {check.contractValidation?.summary ? <div className="novel-copy-block">正文兑现：{check.contractValidation.summary}</div> : null}
        {model.gateReportExpanded ? <PublishCheckSections model={model} actions={actions} /> : null}
      </div>
    </InsightCard>
  )
}

function PublishCheckHistory({ model }: { model: ReviewInspectorViewModel }) {
  const check = model.publishCheck
  if (!check) return null
  return (
    <div className="novel-gate-report__meta-grid">
      {check.drift ? <div className="novel-gate-report__meta-card">
        <div className="novel-gate-report__meta-head"><strong>较上次验收</strong><span>{check.drift.previousScore != null ? `上次 ${check.drift.previousScore}` : '首次记录'}</span></div>
        <div className="novel-gate-report__meta-copy">{check.drift.summary}</div>
        {model.publishCheckDriftHighlights.length > 0 ? <div className="novel-gate-report__meta-tags">{model.publishCheckDriftHighlights.map((item) => <Tag key={item}>{item}</Tag>)}</div> : null}
      </div> : null}
      {model.publishCheckHistoryItems.length > 0 ? <div className="novel-gate-report__meta-card">
        <div className="novel-gate-report__meta-head"><strong>最近门记录</strong><span>{`${check.history.length} 次快照`}</span></div>
        <div className="novel-gate-report__history-list">{model.publishCheckHistoryItems.map((item) => <div key={item.id}>{item.text}</div>)}</div>
      </div> : null}
    </div>
  )
}

function PublishCheckSections({ model, actions }: Pick<Props, 'model' | 'actions'>) {
  return (
    <div className="novel-gate-report__sections">
      {model.publishCheckSections.map((section) => <section key={section.key} className="novel-gate-report__section">
        <div className="novel-gate-report__section-head"><strong>{section.title}</strong><span>{section.items.length} 项</span></div>
        <div className="novel-gate-report__item-list">
          {section.items.map((item) => <div key={item.key} className="novel-gate-report__item">
            <div className="novel-gate-report__item-head">
              <div className="novel-gate-report__item-title">
                <Tag color={publishStatusColor(item.status)}>{publishStatusLabel(item.status)}</Tag><strong>{item.label}</strong>
                {item.segmentTitle ? <span>{item.segmentTitle}</span> : null}{typeof item.taskId === 'number' ? <Tag color="blue">{`任务 #${item.taskId}`}</Tag> : null}
              </div>
              {item.status !== 'pass' ? <Button size="small" onClick={() => actions.onOpenGateIssue(item)}>去处理</Button> : null}
            </div>
            <div className="novel-gate-report__item-detail">{item.detail}</div>
            {item.fixHint ? <div className="novel-gate-report__item-hint">{`建议：${item.fixHint}`}</div> : null}
          </div>)}
        </div>
      </section>)}
    </div>
  )
}

function ReviewDiagnostics({ model, actions }: Pick<Props, 'model' | 'actions'>) {
  return (
    <>
      <InsightCard title="合同对账" eyebrow="章节 / 场景合同" tone="soft">
        {model.contractAudit ? <StringList items={model.contractAudit.items.map((item) => `${item.status === 'pass' ? '通过' : item.status === 'warning' ? '中优先' : '阻塞'} · ${item.label}：${item.detail}`)} empty="先生成或刷新合同对账，再看当前缺口。" /> : <div className="novel-copy-block">先生成或刷新合同对账，再看当前缺口。</div>}
      </InsightCard>
      <InsightCard title="章后状态回写" eyebrow="正典确认 / 统一写回" tone="soft">
        {model.chapter ? <div className="writing-layout-stack writing-layout-stack--sm"><div className="novel-copy-block">写完本章后，在这里进入独立回写中心，先确认事实抽取和状态候选，再统一写回线程、伏笔、谜题、关系、物品与时间轴。</div><div><Button onClick={actions.onOpenWriteback}>打开章后状态回写中心</Button></div></div> : <div className="novel-copy-block">先选择章节，再进入章后状态回写中心。</div>}
      </InsightCard>
      <InsightCard title="最近恶化项" eyebrow="跨章节语言退化" tone="soft"><LanguageDriftHealthCard dashboard={model.qualityDashboard} currentChapter={model.chapter} /></InsightCard>
      <InsightCard title="人味硬约束" eyebrow="模板 / 解释 / 立场" tone="soft"><HumanizationHealthCard dashboard={model.qualityDashboard} reviewNotes={model.reviewNotes} /></InsightCard>
      <InsightCard title="角色对白辨识度" eyebrow="语音指纹" tone="soft"><DialogueFingerprintHealthCard dashboard={model.qualityDashboard} reviewNotes={model.reviewNotes} /></InsightCard>
      <InsightCard title="主角与节奏风险" eyebrow="跨章节结构告警" tone="soft"><StoryDynamicsHealthCard dashboard={model.qualityDashboard} currentChapter={model.chapter} reviewNotes={model.reviewNotes} /></InsightCard>
      <InsightCard title="世界状态概览" eyebrow="总账 / 冲突实体" tone="soft"><WorldStateHealthCard dashboard={model.qualityDashboard} /></InsightCard>
      <InsightCard title="AI 检测与复检" eyebrow="局部诊断" tone="soft">
        <AIScorePanel getContent={actions.getEditorContent} contentType="chapter" genreContext={model.aiScore.genreContext} novelBackground={model.aiScore.novelBackground} modelConfigId={model.aiScore.modelConfigId} novelId={model.aiScore.novelId} disabled={model.aiScore.disabled} onRegenerate={actions.onRegenerate} drawCount={1} />
        {model.aiResult ? <div className="writing-layout-note-space-top"><AiCheckResult result={model.aiResult} /></div> : <div className="novel-copy-block writing-layout-note-space-top">点击上方 AI 体检后，这里也会展示语义与表达层面的复检结果。</div>}
      </InsightCard>
      <InsightCard title="建议优先处理" eyebrow="下一步" tone="soft"><StringList items={model.focusAreas} empty="最近没有新的高优先项，继续推进正文即可。" /></InsightCard>
    </>
  )
}

export default function ReviewRoute({ model, actions, title = '审校视图' }: Props) {
  return (
    <section className="writing-route-view writing-route-view--review" data-route="review">
      <header className="writing-route-view__header"><strong>{title}</strong></header>
      <div className="writing-route-view__body">
        <ReviewSpotlight model={model} />
        <div className="novel-writing-shell__insight-stack">
          <InsightCard title="审校意见分层" eyebrow="必须处理 / 建议处理 / 仅参考" tone="soft"><ReviewNotesPanel notes={model.reviewNotes as Record<string, unknown> | null} /></InsightCard>
          <PublishCheckCard model={model} actions={actions} />
          <ReviewDiagnostics model={model} actions={actions} />
        </div>
      </div>
    </section>
  )
}
