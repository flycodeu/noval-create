import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Steps, Tag, message } from 'antd'
import type { ModelConfig } from '../../types'
import { inspirationBasis, type InspirationKind, type InspirationRun } from '../../shared/inspiration'
import { callAuthorTool } from '../Novel/AuthorWorkspace/workflow-client'
import { createInspirationDraft, readInspirationDraft, saveInspirationDraft, INSPIRATION_DRAFT_KEY, type InspirationDraft, type InspirationInitial } from './inspiration-draft'
import './inspiration.css'

function buildCreationInput(draft: InspirationDraft, packageBasis: string, directionValid: boolean) {
  return {
    title: draft.title.trim(),
    synopsis: draft.synopsis.trim(),
    background: [draft.seed.trim(), draft.direction.trim() ? `作者确认的故事方向：\n${draft.direction.trim()}` : ''].filter(Boolean).join('\n\n'),
    constraints: draft.constraints.trim(),
    ...(draft.modelConfigId ? { modelConfigId: draft.modelConfigId } : {}),
    ...(draft.genreId ? { genreId: draft.genreId } : {}),
    ...(draft.targetWords ? { targetWords: draft.targetWords } : {}),
    idempotencyKey: `inspiration:${draft.draftId}:create`,
    inspiration: {
      draftId: draft.draftId,
      seed: draft.seed,
      ...(draft.selectedDirection && directionValid ? { directionTaskId: draft.selectedDirection.taskId, directionId: draft.selectedDirection.item.id } : {}),
      ...(draft.selectedPackage?.basis === packageBasis ? { packagingTaskId: draft.selectedPackage.taskId, packagingId: draft.selectedPackage.item.id } : {}),
    },
  }
}

interface SeedStepProps {
  draft: InspirationDraft
  busy: boolean
  frozen: boolean
  patch: (values: Partial<InspirationDraft>) => void
  onToFinal: (skip?: boolean) => void
}

function InspirationSeedStep({ draft, busy, frozen, patch, onToFinal }: SeedStepProps) {
  return (
    <>
      <label htmlFor="inspiration-seed">故事起点</label>
      <Input.TextArea
        id="inspiration-seed"
        value={draft.seed}
        maxLength={6000}
        autoSize={{ minRows: 5, maxRows: 12 }}
        disabled={busy || frozen}
        onChange={event => patch({ seed: event.target.value })}
        placeholder="主角身处什么环境，遇到了什么问题？"
      />
      <label htmlFor="inspiration-constraints">已经确定的要求与限制</label>
      <Input.TextArea
        id="inspiration-constraints"
        value={draft.constraints}
        maxLength={3000}
        autoSize={{ minRows: 3, maxRows: 6 }}
        disabled={busy || frozen}
        onChange={event => patch({ constraints: event.target.value })}
      />
      <Space wrap>
        <Button type="primary" disabled={!draft.seed.trim() || busy || frozen} onClick={() => patch({ step: 1 })}>
          讨论方向
        </Button>
        <Button disabled={busy || frozen} onClick={() => onToFinal(true)}>
          跳过候选，直接填写创建
        </Button>
      </Space>
    </>
  )
}

interface DirectionStepProps {
  draft: InspirationDraft
  busy: boolean
  frozen: boolean
  basis: string
  directionValid: boolean
  oldDirections: boolean | null | undefined
  patch: (values: Partial<InspirationDraft>) => void
  onToFinal: () => void
  onGenerate: (kind: InspirationKind) => void
}

function InspirationDirectionStep({
  draft,
  busy,
  frozen,
  basis,
  directionValid,
  oldDirections,
  patch,
  onToFinal,
  onGenerate,
}: DirectionStepProps) {
  return (
    <>
      {oldDirections && <Alert type="warning" message="故事起点或限制已变更，请重新生成候选或确认沿用当前方向。" />}
      <div className="inspiration-wizard__candidates">
        {draft.directions?.result?.directions?.map(item => (
          <article key={`${draft.directions!.taskId}:${item.id}`}>
            <div>
              <h3>{item.title}</h3>
              {draft.selectedDirection && draft.selectedDirection.taskId === draft.directions?.taskId && draft.selectedDirection.item.id === item.id && directionValid && (
                <Tag color="green">已选择</Tag>
              )}
            </div>
            <p>{item.premise}</p>
            <p><strong>矛盾与代价：</strong>{item.conflict}</p>
            <Button
              disabled={busy || frozen || Boolean(oldDirections)}
              onClick={() => patch({
                direction: `${item.premise}\n核心冲突：${item.conflict}`,
                directionBasis: basis,
                selectedDirection: { taskId: draft.directions!.taskId, item },
                selectedPackage: undefined,
              })}
            >
              选择此方向
            </Button>
          </article>
        ))}
      </div>
      <label htmlFor="inspiration-direction">当前方向（可手写或修改）</label>
      <Input.TextArea
        id="inspiration-direction"
        maxLength={2400}
        value={draft.direction}
        autoSize={{ minRows: 3, maxRows: 8 }}
        disabled={busy || frozen}
        onChange={event => patch({ direction: event.target.value, directionBasis: basis, selectedDirection: undefined, selectedPackage: undefined })}
      />
      <Space wrap>
        <Button type="primary" disabled={busy || frozen || !directionValid || !draft.direction.trim()} onClick={onToFinal}>
          使用当前方向，下一步
        </Button>
        {!directionValid && Boolean(draft.direction.trim()) && (
          <Button disabled={busy || frozen} onClick={() => patch({ directionBasis: basis, selectedDirection: undefined, selectedPackage: undefined })}>
            确认沿用当前方向
          </Button>
        )}
        <Button disabled={busy || frozen || !draft.seed.trim()} onClick={() => void onGenerate('directions')}>
          {draft.directions ? '换一批方向' : '生成方向候选'}
        </Button>
      </Space>
    </>
  )
}

interface PackageStepProps {
  draft: InspirationDraft
  busy: boolean
  frozen: boolean
  creating: boolean
  packageBasis: string
  directionValid: boolean
  oldPackaging: boolean | null | undefined
  patch: (values: Partial<InspirationDraft>) => void
  onGenerate: (kind: InspirationKind) => void
  onCreate: () => void
  onCheckCreation: () => void
}

function InspirationPackageStep({
  draft,
  busy,
  frozen,
  creating,
  packageBasis,
  directionValid,
  oldPackaging,
  patch,
  onGenerate,
  onCreate,
  onCheckCreation,
}: PackageStepProps) {
  return (
    <>
      {!directionValid && <Alert type="warning" message="故事起点已变化，请返回方向页确认后再创建。" />}
      <details>
        <summary>核对本次故事起点与方向</summary>
        <p>{draft.seed}</p>
        <p>{draft.direction || '未指定方向，创建后再逐步讨论。'}</p>
        <p>{draft.constraints}</p>
      </details>
      {oldPackaging && <Alert type="warning" message="方向已变化，旧书名简介仅供阅读；可重新生成，或保留手动填写的内容。" />}
      <div className="inspiration-wizard__candidates">
        {draft.packaging?.result?.packages?.map(item => (
          <article key={`${draft.packaging!.taskId}:${item.id}`}>
            <h3>{item.title}</h3>
            <p>{item.synopsis}</p>
            <Button
              disabled={busy || frozen || Boolean(oldPackaging)}
              onClick={() => patch({
                title: item.title,
                synopsis: item.synopsis,
                selectedPackage: { taskId: draft.packaging!.taskId, item, basis: packageBasis },
              })}
            >
              采用这组书名与简介
            </Button>
          </article>
        ))}
      </div>
      <label htmlFor="inspiration-title">书名</label>
      <Input
        id="inspiration-title"
        value={draft.title}
        maxLength={100}
        disabled={busy || frozen}
        onChange={event => patch({ title: event.target.value })}
        placeholder="可使用暂定名"
      />
      <label htmlFor="inspiration-synopsis">简介（可选）</label>
      <Input.TextArea
        id="inspiration-synopsis"
        value={draft.synopsis}
        maxLength={2000}
        autoSize={{ minRows: 3, maxRows: 8 }}
        disabled={busy || frozen}
        onChange={event => patch({ synopsis: event.target.value })}
      />
      <Space wrap>
        <Button disabled={busy || frozen || !directionValid || !draft.direction.trim()} onClick={() => void onGenerate('packaging')}>
          {draft.packaging ? '换一批书名与简介' : '生成书名与简介候选'}
        </Button>
        <Button
          type="primary"
          loading={creating}
          disabled={busy || !draft.title.trim() || (!directionValid && !frozen)}
          onClick={onCreate}
        >
          {frozen ? '重试确认创建' : '确认创建并进入创作台'}
        </Button>
        {frozen && <Button disabled={creating} onClick={onCheckCreation}>检查创建结果</Button>}
      </Space>
    </>
  )
}

export default function InspirationWizard({ initial, resume, onClose, onCreated }: { initial: InspirationInitial; resume: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [draft, setDraft] = useState(() => resume ? readInspirationDraft() || createInspirationDraft(initial) : createInspirationDraft(initial))
  const [models, setModels] = useState<ModelConfig[]>([])
  const [starting, setStarting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [messageApi, messageContext] = message.useMessage()
  const mounted = useRef(true), task = useRef(draft.taskId), startEpoch = useRef(0), submitting = useRef(false)
  const busy = starting || Boolean(draft.taskId), frozen = Boolean(draft.creationRequest)
  const basis = inspirationBasis(draft.seed, draft.constraints)
  const directionValid = draft.directionBasis === basis
  const packageBasis = inspirationBasis(draft.seed, draft.constraints, draft.direction)
  const patch = (values: Partial<InspirationDraft>) => setDraft(current => ({ ...current, ...values }))

  useEffect(() => { saveInspirationDraft(draft) }, [draft])
  useEffect(() => {
    mounted.current = true
    void window.electron.model.list().then(rows => { if (mounted.current) setModels(rows) }).catch(() => { if (mounted.current) setError('模型列表读取失败；可以手动构思和创建作品。') })
    return () => {
      mounted.current = false; startEpoch.current += 1
      if (task.current) void callAuthorTool('novelforge.inspiration.cancel', { draftId: draft.draftId, taskId: task.current }).catch(() => {})
    }
  }, [draft.draftId])

  useEffect(() => {
    if (!draft.taskId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    const taskId = draft.taskId
    const poll = async () => {
      try {
        const { run } = await callAuthorTool<{ run: InspirationRun }>('novelforge.inspiration.get', { draftId: draft.draftId, taskId })
        if (!alive) return
        failures = 0
        if (['pending', 'running', 'cancel_requested'].includes(run.status)) { timer = setTimeout(() => void poll(), 700); return }
        task.current = undefined
        setDraft(current => current.taskId !== taskId ? current : { ...current, taskId: undefined, ...(run.status === 'success' ? run.kind === 'directions' ? { directions: run } : { packaging: run } : {}) })
        if (run.status !== 'success') setError(run.error || '候选已停止，可保留填写内容后重新生成。')
      } catch (cause) {
        if (!alive) return
        setError(String(cause))
        if (++failures < 3) timer = setTimeout(() => void poll(), 2500)
        else {
          task.current = undefined
          void callAuthorTool('novelforge.inspiration.cancel', { draftId: draft.draftId, taskId }).catch(() => {})
          setDraft(current => current.taskId === taskId ? { ...current, taskId: undefined } : current)
        }
      }
    }
    void poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [draft.draftId, draft.taskId])

  const generate = async (kind: InspirationKind) => {
    if (busy || frozen) return
    const epoch = ++startEpoch.current
    setStarting(true); setError('')
    try {
      const { run } = await callAuthorTool<{ run: InspirationRun }>('novelforge.inspiration.generate', {
        draftId: draft.draftId,
        requestId: crypto.randomUUID(),
        kind,
        seed: draft.seed,
        constraints: draft.constraints,
        direction: kind === 'packaging' ? draft.direction : '',
        request: draft.request,
        ...(draft.modelConfigId ? { modelConfigId: draft.modelConfigId } : {}),
      })
      if (!mounted.current || startEpoch.current !== epoch) {
        void callAuthorTool('novelforge.inspiration.cancel', { draftId: draft.draftId, taskId: run.taskId }).catch(() => {})
        return
      }
      task.current = run.taskId; patch({ taskId: run.taskId })
    } catch (cause) {
      if (mounted.current && startEpoch.current === epoch) setError(cause instanceof Error ? cause.message : '候选请求失败')
    } finally {
      if (mounted.current) setStarting(false)
    }
  }

  const stop = async () => {
    startEpoch.current += 1; setStarting(false)
    if (task.current) await callAuthorTool('novelforge.inspiration.cancel', { draftId: draft.draftId, taskId: task.current }).catch(cause => setError(String(cause)))
  }

  const close = () => { if (!creating) { void stop(); onClose() } }

  const create = async () => {
    if (submitting.current || busy || !draft.title.trim() || (!directionValid && !frozen)) return
    submitting.current = true; setCreating(true); setError('')
    const input = draft.creationRequest || buildCreationInput(draft, packageBasis, directionValid)
    const next = { ...draft, creationRequest: input }; setDraft(next); saveInspirationDraft(next)
    try {
      const response = await window.electron.agentTools.call({ toolId: 'novelforge.projects.create', input })
      if (!response.ok) {
        if (mounted.current) { patch({ creationRequest: undefined }); setError(response.error.message) }
        return
      }
      const result = response.data as { project: { id: number } }
      sessionStorage.removeItem(INSPIRATION_DRAFT_KEY)
      if (mounted.current) onCreated(result.project.id)
    } catch (cause) {
      if (mounted.current) setError(`${String(cause)}（已保留当前内容，可直接重试）`)
    } finally {
      submitting.current = false; if (mounted.current) setCreating(false)
    }
  }

  const checkCreation = async () => {
    setCreating(true)
    try {
      const { project } = await callAuthorTool<{ project: { id: number } | null }>('novelforge.projects.creation_status', { idempotencyKey: `inspiration:${draft.draftId}:create` })
      if (project) { sessionStorage.removeItem(INSPIRATION_DRAFT_KEY); onCreated(project.id) }
      else messageApi.info('尚未查到创建结果，可直接点击重试。')
    } catch (cause) {
      setError(String(cause))
    } finally {
      setCreating(false)
    }
  }

  const toFinal = (skip = false) => {
    if (skip) patch({ step: 2, direction: '', directionBasis: basis, selectedDirection: undefined, selectedPackage: undefined })
    else if (directionValid && draft.direction.trim()) patch({ step: 2 })
  }

  const oldDirections = draft.directions && inspirationBasis(draft.directions.input.seed, draft.directions.input.constraints) !== basis
  const oldPackaging = draft.packaging && inspirationBasis(draft.packaging.input.seed, draft.packaging.input.constraints, draft.packaging.input.direction) !== packageBasis

  return (
    <Modal title="先讨论故事方向" open onCancel={close} footer={null} width={880} closable={!creating} maskClosable={false} keyboard={!creating}>
      {messageContext}
      <div className="inspiration-wizard">
        <Steps size="small" current={draft.step} items={[{ title: '故事起点' }, { title: '方向候选' }, { title: '书名与确认' }]} />
        {error && <Alert type="error" message={error} />}
        {frozen && <Alert type="info" message="已保留本次确认内容，可检查创建结果或直接重试。" />}
        {draft.step === 0 && <InspirationSeedStep draft={draft} busy={busy} frozen={frozen} patch={patch} onToFinal={toFinal} />}
        {draft.step === 1 && (
          <InspirationDirectionStep
            draft={draft}
            busy={busy}
            frozen={frozen}
            basis={basis}
            directionValid={directionValid}
            oldDirections={oldDirections}
            patch={patch}
            onToFinal={() => toFinal()}
            onGenerate={generate}
          />
        )}
        {draft.step === 2 && (
          <InspirationPackageStep
            draft={draft}
            busy={busy}
            frozen={frozen}
            creating={creating}
            packageBasis={packageBasis}
            directionValid={directionValid}
            oldPackaging={oldPackaging}
            patch={patch}
            onGenerate={generate}
            onCreate={() => void create()}
            onCheckCreation={() => void checkCreation()}
          />
        )}
        {!frozen && (
          <>
            <label htmlFor="inspiration-preference">本轮补充偏好（可选）</label>
            <Input id="inspiration-preference" value={draft.request} maxLength={1500} disabled={busy} onChange={event => patch({ request: event.target.value })} />
            <Select aria-label="构思模型" allowClear value={draft.modelConfigId} disabled={busy} placeholder="使用默认模型，手写时可暂不配置" onChange={value => patch({ modelConfigId: value })} options={models.map(model => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))} />
          </>
        )}
        <div className="inspiration-wizard__footer">
          <Space>
            {draft.step > 0 && <Button disabled={busy || creating || frozen} onClick={() => patch({ step: draft.step - 1 })}>上一步</Button>}
            <Button disabled={creating} onClick={close}>关闭并保留构思</Button>
          </Space>
          {busy && <Button onClick={() => void stop()}>停止本轮生成</Button>}
        </div>
      </div>
    </Modal>
  )
}
