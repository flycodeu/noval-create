import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import { CheckCircleOutlined, FileProtectOutlined, LockOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import type { RecommendationWorkspaceSnapshot, RecordRecommendationEvaluationInput } from '../../../shared/recommendation-governance'
import type { AgentToolCallRequest, AgentToolCallResult } from '../../../shared/tool-contracts'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import './recommendation-governance.css'

interface Props { novelId: number }
interface EvaluationFormValues {
  source: RecordRecommendationEvaluationInput['source']
  outcome: RecordRecommendationEvaluationInput['outcome']
  confirmedBy: string
  failureReason?: string
  evidenceNote?: string
}

function unwrap<T>(result: AgentToolCallResult): T {
  if (result.ok) return result.data as T
  const error = new Error(result.error.message) as Error & { code?: string }
  error.code = result.error.code
  throw error
}

function createKey(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `ui-${prefix}-${suffix}`
}

function gateStatusLabel(status: RecommendationWorkspaceSnapshot['state']['status']): string {
  if (status === 'passed') return '已通过'
  if (status === 'recommendation_locked') return '失败锁定'
  if (status === 'attempts_exhausted') return '次数耗尽'
  return '可评估'
}

export default function RecommendationGovernancePanel({ novelId }: Props) {
  const [form] = Form.useForm<EvaluationFormValues>()
  const [snapshot, setSnapshot] = useState<RecommendationWorkspaceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<'preflight' | 'lock' | 'record' | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordIdempotencyKey, setRecordIdempotencyKey] = useState('')
  const loadRequestRef = useRef(0)
  const actionInFlightRef = useRef(false)

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoading(true)
    try {
      const nextSnapshot = unwrap<RecommendationWorkspaceSnapshot>(await window.electron.agentTools.call({
        toolId: 'novelforge.recommendation.get_workspace',
        input: { novelId },
      }))
      if (loadRequestRef.current === requestId) setSnapshot(nextSnapshot)
    } catch (error) {
      if (loadRequestRef.current !== requestId) return
      console.error(error)
      message.error(error instanceof Error ? error.message : '推荐治理状态读取失败。')
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false)
    }
  }, [novelId])

  useEffect(() => {
    void load()
    return () => { loadRequestRef.current += 1 }
  }, [load])

  const matchingCandidate = useMemo(() => {
    if (!snapshot?.latestCandidate || !snapshot.latestPreflight) return null
    return snapshot.latestCandidate.preflightRunId === snapshot.latestPreflight.runId ? snapshot.latestCandidate : null
  }, [snapshot])
  const recordCandidate = matchingCandidate || snapshot?.latestCandidate || null

  const runPreflight = async () => {
    if (actionInFlightRef.current) return
    actionInFlightRef.current = true
    setRunning('preflight')
    try {
      unwrap(await window.electron.agentTools.call({
        toolId: 'novelforge.recommendation.run_preflight',
        input: { novelId },
      }))
      await load()
      message.success(getUserFacingMessage('recommendation.preflightCompleted'))
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '推荐预检失败。')
    } finally {
      actionInFlightRef.current = false
      setRunning(null)
    }
  }

  const lockCandidate = async () => {
    const preflight = snapshot?.latestPreflight
    if (!preflight || preflight.status !== 'ready' || actionInFlightRef.current) return
    actionInFlightRef.current = true
    const request: AgentToolCallRequest = {
      toolId: 'novelforge.recommendation.lock_candidate',
      input: {
        novelId,
        preflightRunId: preflight.runId,
        expectedContextVersion: preflight.contextVersion,
        expectedContentHash: preflight.contentHash,
      },
    }
    setRunning('lock')
    try {
      const approval = await window.electron.agentTools.approve({ request })
      if (!approval.approved || !approval.approvalId) {
        if (approval.reason && approval.reason !== '用户取消。') message.info(approval.reason)
        return
      }
      unwrap(await window.electron.agentTools.call({ ...request, approvalId: approval.approvalId }))
      await load()
      message.success(getUserFacingMessage('recommendation.candidateLocked'))
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '候选稿锁定失败。')
    } finally {
      actionInFlightRef.current = false
      setRunning(null)
    }
  }

  const recordEvaluation = async () => {
    const candidate = recordCandidate
    if (!candidate || actionInFlightRef.current) return
    actionInFlightRef.current = true
    try {
      const values = await form.validateFields().catch(() => null)
      if (!values) return
      const idempotencyKey = recordIdempotencyKey || createKey('recommendation-result')
      if (!recordIdempotencyKey) setRecordIdempotencyKey(idempotencyKey)
      const request: AgentToolCallRequest = {
        toolId: 'novelforge.recommendation.record_result',
        input: {
          novelId,
          candidateId: candidate.id,
          source: values.source,
          outcome: values.outcome,
          confirmedBy: values.confirmedBy.trim(),
          idempotencyKey,
          ...(values.outcome === 'failed' ? { failureReason: values.failureReason?.trim() } : {}),
          evidenceCompleteness: values.evidenceNote?.trim() ? 'complete' : 'partial',
          evidence: values.evidenceNote?.trim() ? { note: values.evidenceNote.trim() } : {},
        },
      }
      setRunning('record')
      const approval = await window.electron.agentTools.approve({ request })
      if (!approval.approved || !approval.approvalId) {
        if (approval.reason && approval.reason !== '用户取消。') message.info(approval.reason)
        return
      }
      unwrap(await window.electron.agentTools.call({ ...request, approvalId: approval.approvalId }))
      setRecordOpen(false)
      setRecordIdempotencyKey('')
      form.resetFields()
      await load()
      message.success(getUserFacingMessage('recommendation.externalResultRecorded'))
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '外部评估结果记录失败。')
    } finally {
      actionInFlightRef.current = false
      setRunning(null)
    }
  }

  if (loading && !snapshot) return <div className="recommendation-governance recommendation-governance--loading"><Spin tip="读取推荐治理状态…" /></div>
  if (!snapshot) return null
  const { state, latestPreflight } = snapshot
  const statusColor = state.status === 'passed' ? 'success' : state.status === 'eligible' ? 'processing' : 'error'

  return (
    <section className="recommendation-governance">
      <div className="recommendation-governance__masthead">
        <div className="recommendation-governance__title">
          <SafetyCertificateOutlined />
          <div>
            <span>RECOMMENDATION CONTROL</span>
            <strong>推荐评估机会治理</strong>
            <p>内部预检无限运行且永不计次；只有确认真实发生的作者评估或平台自动评估才进入三次额度。</p>
          </div>
        </div>
        <Space wrap>
          <Tag color={statusColor}>{gateStatusLabel(state.status)}</Tag>
          <Tag>{state.workState === 'completed' ? '完结作品 · 首败锁定' : '连载作品 · 三败锁定'}</Tag>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      <div className="recommendation-governance__body">
        <div className="recommendation-governance__attempt-card">
          <div className="recommendation-governance__attempt-head">
            <div><span>真实外部评估</span><strong>{state.totalEvaluationCount} / {state.policy.maximumExternalEvaluations}</strong></div>
            <small>失败 {state.failedEvaluationCount} / 锁定阈值 {state.failureLockThreshold}</small>
          </div>
          <div className="recommendation-governance__attempt-track">
            {Array.from({ length: state.policy.maximumExternalEvaluations }, (_, index) => {
              const attempt = state.attempts[index]
              return (
                <div key={index} className={`recommendation-governance__attempt-slot${attempt ? ` is-${attempt.outcome}` : ''}`}>
                  <span>{attempt ? (attempt.outcome === 'passed' ? '✓' : '×') : index + 1}</span>
                  <div><strong>{attempt ? (attempt.outcome === 'passed' ? '通过' : '未通过') : '未使用'}</strong><small>{attempt ? (attempt.source === 'author_requested' ? '作者主动' : '平台自动') : '不计内部预检'}</small></div>
                </div>
              )
            })}
          </div>
          {state.lockReason ? <Alert type={state.status === 'passed' ? 'success' : 'error'} showIcon message={state.lockReason} /> : null}
          <p className="recommendation-governance__policy-note">规则来源：项目负责人提供的业务规则；尚未绑定官方平台政策链接，系统按保守硬门执行。</p>
        </div>

        <div className="recommendation-governance__preflight-card">
          <div className="recommendation-governance__card-head">
            <div><span>INTERNAL PREFLIGHT</span><strong>内部预检 · 明确不计次</strong></div>
            <Button type="primary" loading={running === 'preflight'} disabled={running !== null && running !== 'preflight'} onClick={() => void runPreflight()}>运行预检</Button>
          </div>
          {latestPreflight ? (
            <>
              <div className="recommendation-governance__scores">
                <div><span>综合分</span><strong>{latestPreflight.score}</strong><small>阈值 82</small></div>
                <div><span>置信下界</span><strong>{latestPreflight.confidenceLowerBound}</strong><small>阈值 78</small></div>
                <div><span>评分覆盖</span><strong>{latestPreflight.coverageRate}%</strong><small>要求 100%</small></div>
              </div>
              <div className="recommendation-governance__preflight-meta">
                <Tag color={latestPreflight.status === 'ready' ? 'success' : 'error'}>{latestPreflight.status === 'ready' ? '预检通过' : '预检阻塞'}</Tag>
                <span>Run #{latestPreflight.runId} · Context v{latestPreflight.contextVersion}</span>
                <code title={latestPreflight.contentHash}>{latestPreflight.contentHash}</code>
              </div>
              {latestPreflight.blockers.length > 0 ? (
                <div className="recommendation-governance__issues">{latestPreflight.blockers.slice(0, 6).map((blocker) => <div key={blocker}>× {blocker}</div>)}</div>
              ) : <div className="recommendation-governance__ready-line"><CheckCircleOutlined />所有硬门已通过，可以锁定候选版本。</div>}
            </>
          ) : <div className="recommendation-governance__empty">还没有内部预检记录。先运行预检，不会消耗平台机会。</div>}
        </div>

        <div className="recommendation-governance__candidate-card">
          <div className="recommendation-governance__card-head">
            <div><span>LOCKED CANDIDATE</span><strong>候选版本与真实结果</strong></div>
            {recordCandidate ? (
              <Tag color={matchingCandidate ? 'cyan' : 'gold'}>
                {matchingCandidate ? `当前候选 #${recordCandidate.id}` : `历史候选 #${recordCandidate.id}`}
              </Tag>
            ) : <Tag>未锁定</Tag>}
          </div>
          {recordCandidate ? (
            <div className="recommendation-governance__candidate-manifest">
              <FileProtectOutlined />
              <div><strong>已锁定 Run #{recordCandidate.preflightRunId}</strong><span>Context v{recordCandidate.contextVersion}</span><code>{recordCandidate.contentHash}</code></div>
            </div>
          ) : <p className="recommendation-governance__empty">预检通过后，人工确认精确哈希并锁定候选。锁定不会增加评估次数。</p>}
          <Space wrap>
            <Button icon={<LockOutlined />} loading={running === 'lock'} disabled={running !== null || !latestPreflight || latestPreflight.status !== 'ready' || !state.canRecordExternalEvaluation || Boolean(matchingCandidate)} onClick={() => void lockCandidate()}>
              锁定当前候选
            </Button>
            <Button type="primary" disabled={running !== null || !recordCandidate || !state.canRecordExternalEvaluation} onClick={() => {
              form.resetFields()
              form.setFieldsValue({ source: 'author_requested', confirmedBy: '', evidenceNote: '' })
              setRecordIdempotencyKey((current) => current || createKey('recommendation-result'))
              setRecordOpen(true)
            }}>
              记录已发生的真实结果
            </Button>
          </Space>
          <small className="recommendation-governance__no-auto">不会自动提交平台，也不会在失败后自动开始下一次评估。</small>
        </div>
      </div>

      <Modal title="追加记录真实外部评估" open={recordOpen} onCancel={() => { if (running !== 'record') setRecordOpen(false) }} onOk={() => void recordEvaluation()} okText="原生确认后记录" confirmLoading={running === 'record'} cancelButtonProps={{ disabled: running === 'record' }} maskClosable={running !== 'record'}>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="这会消耗一次真实评估额度" description="仅在作者主动评估或平台自动评估已经真实发生、结果已经人工核对后记录。内部模型审校、重试和预检不能填在这里。" />
        <Form form={form} layout="vertical">
          <Form.Item name="source" label="评估来源" rules={[{ required: true }]}><Select options={[{ value: 'author_requested', label: '作者主动发起' }, { value: 'platform_auto', label: '平台自动评估' }]} /></Form.Item>
          <Form.Item name="outcome" label="实际结果" rules={[{ required: true }]}><Select options={[{ value: 'passed', label: '通过' }, { value: 'failed', label: '未通过' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.outcome !== next.outcome}>
            {({ getFieldValue }) => getFieldValue('outcome') === 'failed' ? (
          <Form.Item name="failureReason" label="失败原因" rules={[{ required: true, whitespace: true, message: '失败结果必须记录原因。' }]}><Input.TextArea rows={3} maxLength={4000} showCount /></Form.Item>
            ) : null}
          </Form.Item>
          <Form.Item name="confirmedBy" label="结果确认人 / 系统标识" rules={[{ required: true, whitespace: true, message: '请记录谁确认了这个真实结果。' }]}><Input maxLength={200} placeholder="例如：责编张三 / platform-webhook-20260711" /></Form.Item>
          <Form.Item name="evidenceNote" label="证据备注（可选）"><Input.TextArea rows={3} placeholder="记录通知时间、截图编号或平台回执摘要；不要粘贴密钥。" /></Form.Item>
        </Form>
      </Modal>
    </section>
  )
}
