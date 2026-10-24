import React, { useEffect, useState } from 'react'
import { Alert, Button, Empty, Spin, Tag } from 'antd'
import type { ChapterReviewView } from '../../../shared/chapter-review-view'
import type { QualityIssueEvidence } from '../../../shared/quality-issue'
import { callAuthorTool } from './workflow-client'
import './author-assist.css'

const ISSUE_GROUPS = { fact: '事实与边界', narrative: '叙事', style: '文风', format: '格式' } as const
const CONCLUSIONS: Record<string, { label: string; color: string }> = {
  passed: { label: '审校通过', color: 'green' },
  needs_revision: { label: '需要修订', color: 'orange' },
  blocked: { label: '未通过', color: 'red' },
}

export default function ChapterReviewPanel({ novelId, chapterId, version, dirty, onLocate, onRepair }: {
  novelId: number; chapterId: number; version: string; dirty: boolean
  onLocate: (evidence: QualityIssueEvidence) => void
  onRepair: (request: string, evidence?: QualityIssueEvidence) => void
}) {
  const [loaded, setLoaded] = useState<{ version: string; view: ChapterReviewView | null; error?: string } | null>(null)
  const key = `${novelId}:${chapterId}:${version}`
  useEffect(() => {
    let stopped = false
    void callAuthorTool<{ view: ChapterReviewView | null }>('novelforge.chapters.review_view', { novelId, chapterId })
      .then(data => { if (!stopped) setLoaded({ version: key, view: data.view }) }).catch(cause => { if (!stopped) setLoaded({ version: key, view: null, error: String(cause) }) })
    return () => { stopped = true }
  }, [novelId, chapterId, key])
  const current = loaded?.version === key ? loaded : null
  if (!current) return <Spin size="small" aria-label="读取审校报告" />
  if (current.error) return <Alert type="error" message={current.error} />
  const view = current.view
  if (!view) return <Empty description="本章还没有独立审校报告" />
  const stale = view.stale || dirty
  const conclusion = CONCLUSIONS[view.status] || { label: '待核对', color: 'default' }
  const evidenceActions = (description: string, evidence?: QualityIssueEvidence, allowRepair = true) => <div className="author-heading-actions">
    {evidence && <Button size="small" disabled={stale} onClick={() => onLocate(evidence)}>定位原文</Button>}
    {allowRepair && <Button size="small" disabled={stale} onClick={() => onRepair(`依据审校报告 ${view.reportId}，定向处理：${description}。保留已确定事实和有效表达。`, evidence)}>按此意见修订</Button>}
  </div>
  return <div className="author-assist-stack">
    <header className="chapter-review__header">
      <div className="author-heading-actions"><h3>本章审校对照</h3><Tag color={stale ? 'default' : conclusion.color}>{stale ? `上次结论：${conclusion.label}` : conclusion.label}</Tag>{dirty && <Tag>草稿未保存</Tag>}</div>
      <div className="chapter-review__versions"><span title={view.reviewedContentHash}>审校正文 {view.reviewedContentHash?.slice(0, 8) || '版本未记录'}</span><span title={view.currentContentHash}>当前保存 {view.currentContentHash?.slice(0, 8) || '版本未记录'}</span></div>
      <p>{view.summary}</p>
    </header>
    {stale && <Alert type="warning" message="正文或作品资料已更新，旧报告保留供阅读；请保存并重新审校后定位或修订。" />}
    {view.contractVersionUnknown && <Alert type="info" message="旧报告没有合同快照，未逐项检查的要求保持待评估。" />}
    {view.requirements.length > 0 && <section className="author-assist-stack" aria-label="逐项要求"><h4>逐项要求 · {view.requirements.length}</h4>{view.requirements.map(item => <article className="author-assist-card" key={item.id}>
      <div><Tag color={item.check?.status === 'met' ? 'green' : item.check?.status === 'unmet' ? 'orange' : 'default'}>{!item.check ? '尚未逐项评估' : item.check.status === 'met' ? '已满足' : item.check.status === 'unmet' ? '需处理' : '待核实'}</Tag><strong>{item.title}</strong></div>
      <p>{item.requirement}</p>{item.check && <><p>{item.check.reason}</p>{item.check.evidence.map((evidence, index) => <blockquote key={index}>{evidence.quote}</blockquote>)}{evidenceActions(`${item.requirement}；${item.check.reason}`, item.check.evidence[0], item.check.status !== 'met')}</>}
    </article>)}</section>}
    {Object.entries(ISSUE_GROUPS).map(([category, label]) => {
      const issues = view.issues.filter(issue => issue.category === category)
      return issues.length > 0 && <section className="author-assist-stack" aria-label={label} key={category}><h4>{label} · {issues.length}</h4>{issues.map(issue => <article className="author-assist-card" key={issue.id}>
      <div><Tag color={issue.level === 'blocker' ? 'red' : issue.level === 'repair' ? 'orange' : 'blue'}>{issue.level === 'blocker' ? '阻塞问题' : issue.level === 'repair' ? '需要修订' : '表达建议'}</Tag></div>
      <p>{issue.message}</p>{issue.evidence.map((evidence, index) => <blockquote key={index}>{evidence.quote}</blockquote>)}{evidenceActions(issue.message, issue.evidence[0])}
    </article>)}</section>
    })}
    {view.deterministicBlockers.length > 0 && <Alert type="warning" message="结构检查待处理" description={view.deterministicBlockers.join('；')} />}
    {!view.issues.length && <p className="author-muted">报告没有列出有证据的质量问题；未评估条款仍需核对。</p>}
  </div>
}
