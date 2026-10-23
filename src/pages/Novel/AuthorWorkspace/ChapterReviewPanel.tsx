import React, { useEffect, useState } from 'react'
import { Alert, Button, Empty, Tag } from 'antd'
import type { ChapterReviewView } from '../../../shared/chapter-review-view'
import type { QualityIssueEvidence } from '../../../shared/quality-issue'
import { callAuthorTool } from './workflow-client'
import './author-assist.css'

export default function ChapterReviewPanel({ novelId, chapterId, version, dirty, onLocate, onRepair }: {
  novelId: number; chapterId: number; version: string; dirty: boolean
  onLocate: (evidence: QualityIssueEvidence) => void
  onRepair: (request: string, evidence?: QualityIssueEvidence) => void
}) {
  const [loaded, setLoaded] = useState<{ version: string; view: ChapterReviewView | null } | null>(null)
  const [error, setError] = useState('')
  const key = `${novelId}:${chapterId}:${version}`
  useEffect(() => {
    let stopped = false
    void callAuthorTool<{ view: ChapterReviewView | null }>('novelforge.chapters.review_view', { novelId, chapterId })
      .then(data => { if (!stopped) { setLoaded({ version: key, view: data.view }); setError('') } }).catch(cause => { if (!stopped) setError(String(cause)) })
    return () => { stopped = true }
  }, [novelId, chapterId, key])
  const view = loaded?.version === key ? loaded.view : null
  if (error) return <Alert type="error" message={error} />
  if (!view) return <Empty description="本章还没有独立审校报告" />
  const stale = view.stale || dirty
  const evidenceActions = (description: string, evidence?: QualityIssueEvidence, allowRepair = true) => <div className="author-heading-actions">
    {evidence && <Button size="small" disabled={stale} onClick={() => onLocate(evidence)}>定位原文</Button>}
    {allowRepair && <Button size="small" disabled={stale} onClick={() => onRepair(`依据审校报告 ${view.reportId}，定向处理：${description}。保留已确定事实和有效表达。`, evidence)}>按此意见修订</Button>}
  </div>
  return <div className="author-assist-stack">
    <div><h3>本章审校对照</h3><p>{view.summary}</p></div>
    {stale && <Alert type="warning" message="正文或作品资料已更新，旧报告保留供阅读；请保存并重新审校后定位或修订。" />}
    {view.contractVersionUnknown && <Alert type="info" message="旧报告没有合同快照，未逐项检查的要求保持待评估。" />}
    {view.requirements.map(item => <article className="author-assist-card" key={item.id}>
      <div><Tag color={item.check?.status === 'met' ? 'green' : item.check?.status === 'unmet' ? 'orange' : 'default'}>{!item.check ? '尚未逐项评估' : item.check.status === 'met' ? '已满足' : item.check.status === 'unmet' ? '需处理' : '待核实'}</Tag><strong>{item.title}</strong></div>
      <p>{item.requirement}</p>{item.check && <><p>{item.check.reason}</p>{item.check.evidence.map((evidence, index) => <blockquote key={index}>{evidence.quote}</blockquote>)}{evidenceActions(`${item.requirement}；${item.check.reason}`, item.check.evidence[0], item.check.status !== 'met')}</>}
    </article>)}
    {view.issues.map(issue => <article className="author-assist-card" key={issue.id}>
      <div><Tag color={issue.level === 'blocker' ? 'red' : issue.level === 'repair' ? 'orange' : 'blue'}>{issue.level === 'blocker' ? '阻塞问题' : issue.level === 'repair' ? '需要修订' : '表达建议'}</Tag><span>{({ fact: '事实与边界', format: '格式', narrative: '叙事', style: '文风' })[issue.category]}</span></div>
      <p>{issue.message}</p>{issue.evidence.map((evidence, index) => <blockquote key={index}>{evidence.quote}</blockquote>)}{evidenceActions(issue.message, issue.evidence[0])}
    </article>)}
    {view.deterministicBlockers.length > 0 && <Alert type="warning" message="结构检查待处理" description={view.deterministicBlockers.join('；')} />}
    {!view.issues.length && <p className="author-muted">报告没有列出有证据的质量问题；未评估条款仍需核对。</p>}
  </div>
}
