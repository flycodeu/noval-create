import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space } from 'antd'
import type { Chapter } from '../../../types'
import type { AuthorAssistRun } from '../../../shared/author-assist'
import type { SelectionRange, SelectionRevisionCandidate } from '../../../shared/selection-revision'
import { callAuthorTool } from './workflow-client'
import { useAuthorAssist } from './useAuthorAssist'
import './author-assist.css'

function resolveSelectionRequest(requestEdit: { key: string; value: string } | null, requestKey: string, initialRequest: string): string {
  if (requestEdit?.key === requestKey) return requestEdit.value
  return initialRequest || '收紧表达，保留事件、人物立场和叙事视角。'
}

function resolveRevisionReplacement(replacementEdit: { sourceId: string; value: string } | null, sourceId: string, candidate: SelectionRevisionCandidate | null): string {
  if (replacementEdit?.sourceId === sourceId) return replacementEdit.value
  return candidate?.replacement || ''
}

function formatErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

interface SelectionInputSectionProps {
  original: string
  request: string
  dirty: boolean
  active: boolean
  busy: boolean
  onChangeRequest: (value: string) => void
  onGenerate: () => void
}

function SelectionInputSection({
  original,
  request,
  dirty,
  active,
  busy,
  onChangeRequest,
  onGenerate,
}: SelectionInputSectionProps) {
  return (
    <>
      <label>
        本次原文
        <Input.TextArea value={original} rows={4} readOnly />
      </label>
      <label>
        修订要求
        <Input.TextArea
          aria-label="选区修订要求"
          value={request}
          maxLength={2000}
          rows={3}
          onChange={event => onChangeRequest(event.target.value)}
        />
      </label>
      <Button type="primary" disabled={dirty || active} loading={busy} onClick={onGenerate}>
        生成选区候选
      </Button>
    </>
  )
}

interface SelectionCandidateSectionProps {
  candidateOriginal: string
  replacement: string
  dirty: boolean
  active: boolean
  busy: boolean
  onChangeReplacement: (value: string) => void
  onApply: () => void
}

function SelectionCandidateSection({
  candidateOriginal,
  replacement,
  dirty,
  active,
  busy,
  onChangeReplacement,
  onApply,
}: SelectionCandidateSectionProps) {
  return (
    <>
      <div className="author-diff-columns">
        <label>
          候选依据的原文
          <Input.TextArea value={candidateOriginal} rows={9} readOnly />
        </label>
        <label>
          修订候选
          <Input.TextArea
            aria-label="选区修订候选"
            value={replacement}
            maxLength={12000}
            rows={9}
            onChange={event => onChangeReplacement(event.target.value)}
          />
        </label>
      </div>
      <Button
        type="primary"
        disabled={dirty || active || !replacement.trim()}
        loading={busy}
        onClick={onApply}
      >
        采用此选区修订
      </Button>
    </>
  )
}

export default function SelectionRevision({ novelId, chapterId, selection, open, dirty, initialRequest, onClose, onApplied, onApplying }: {
  novelId: number; chapterId: number; selection: SelectionRange | null; open: boolean; dirty: boolean; initialRequest: string
  onClose: () => void; onApplied: (chapter: Chapter) => void; onApplying: (busy: boolean) => void
}) {
  const assist = useAuthorAssist<SelectionRevisionCandidate>(novelId, 'selection_revision', chapterId)
  const [requestEdit, setRequestEdit] = useState<{ key: string; value: string } | null>(null)
  const [replacementEdit, setReplacementEdit] = useState<{ sourceId: string; value: string } | null>(null)
  const [edited, setEdited] = useState<{ sourceId: string; artifactId: string; candidate: SelectionRevisionCandidate } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const requestKey = JSON.stringify([selection?.start, selection?.end, selection?.original, initialRequest])
  const request = resolveSelectionRequest(requestEdit, requestKey, initialRequest)
  const sourceId = assist.run?.artifactId || ''
  const localEdit = edited?.sourceId === sourceId ? edited : null
  const candidate = localEdit?.candidate || assist.result
  const replacement = resolveRevisionReplacement(replacementEdit, sourceId, candidate)

  const generate = async () => {
    if (!selection) return
    setBusy(true); setError('')
    try {
      const { snapshot } = await callAuthorTool<{ snapshot: { sourceContentHash: string; contextVersion: number } }>('novelforge.chapters.selection_preview', { ...selection })
      const { run } = await callAuthorTool<{ run: AuthorAssistRun }>('novelforge.chapters.rewrite_selection', { ...selection, ...snapshot, request, idempotencyKey: `selection:${crypto.randomUUID()}` })
      if (alive.current) assist.track(run)
    } catch (cause) {
      if (alive.current) setError(formatErrorMessage(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const apply = async () => {
    if (!candidate || !assist.run?.artifactId || dirty) return
    setBusy(true); setError(''); onApplying(true)
    try {
      let artifactId = localEdit?.artifactId || assist.run.artifactId
      if (replacement !== candidate.replacement) {
        const next = await callAuthorTool<{ artifactId: string; candidate: SelectionRevisionCandidate }>('novelforge.chapters.edit_selection', { novelId, artifactId, replacement, idempotencyKey: `edit:${crypto.randomUUID()}` })
        artifactId = next.artifactId
        if (alive.current) setEdited({ ...next, sourceId })
      }
      const result = await callAuthorTool<{ chapter: Chapter }>('novelforge.chapters.apply_selection', { novelId, chapterId, artifactId,
        expectedContentHash: candidate.sourceContentHash, expectedContextVersion: candidate.contextVersion, idempotencyKey: `apply:${artifactId}` })
      if (alive.current) { onApplied(result.chapter); onClose() }
    } catch (cause) {
      if (alive.current) setError(formatErrorMessage(cause))
    } finally {
      onApplying(false); if (alive.current) setBusy(false)
    }
  }

  const errorMessage = error || assist.error || assist.run?.error

  return (
    <Modal title="选区修订" width={1000} open={open} onCancel={busy ? undefined : onClose} footer={null}>
      <div className="author-assist-stack">
        {selection && (
          <SelectionInputSection
            original={selection.original}
            request={request}
            dirty={dirty}
            active={assist.active}
            busy={busy}
            onChangeRequest={value => setRequestEdit({ key: requestKey, value })}
            onGenerate={() => void generate()}
          />
        )}
        <Select
          disabled={busy || assist.active}
          aria-label="选区修订记录"
          placeholder="查看本章修订记录"
          value={assist.run?.taskId}
          options={assist.runs.map(run => ({ value: run.taskId, label: `任务 ${run.taskId} · ${run.createdAt || ''}` }))}
          onChange={id => assist.track(assist.runs.find(run => run.taskId === id)!)}
        />
        {assist.active && (
          <Space>
            <span>修订候选生成中</span>
            <Button onClick={() => void assist.cancel()}>停止</Button>
          </Space>
        )}
        {errorMessage && <Alert type="error" message={errorMessage} />}
        {dirty && <Alert type="warning" message="编辑器有未保存修改，请先保留当前草稿；旧候选不能覆盖新版正文。" />}
        {candidate && (
          <SelectionCandidateSection
            candidateOriginal={candidate.original}
            replacement={replacement}
            dirty={dirty}
            active={assist.active}
            busy={busy}
            onChangeReplacement={value => setReplacementEdit({ sourceId, value })}
            onApply={() => void apply()}
          />
        )}
      </div>
    </Modal>
  )
}
