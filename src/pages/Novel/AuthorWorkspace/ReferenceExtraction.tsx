import { formatUserFacingMessage } from '../../../shared/user-facing-messages'
import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Select, Space, message } from 'antd'
import type { AuthorAssistRun } from '../../../shared/author-assist'
import type { CreativeResearchDraft } from '../../../shared/creative-research'
import { CREATIVE_RESEARCH_CATEGORIES } from '../../../shared/creative-research'
import type { ReferenceExtractionResult } from '../../../shared/reference-extraction'
import { callAuthorTool } from './workflow-client'
import { useAuthorAssist } from './useAuthorAssist'
import './author-assist.css'

interface Budget { estimatedTokens: number; outputReserve: number; fits: boolean }

export default function ReferenceExtraction({ novelId, open, onClose, onSaved }: { novelId: number; open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [range, setRange] = useState<[number, number] | null>(null)
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [request, setRequest] = useState('分析冲突如何成立、谁承担代价，以及如何转化为本作的原创机制。')
  const [budget, setBudget] = useState<{ signature: string; value: Budget } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ artifactId: string; selected: string[]; edits: Record<string, CreativeResearchDraft> }>({ artifactId: '', selected: [], edits: {} })
  const assist = useAuthorAssist<ReferenceExtractionResult>(novelId, 'reference_extraction')
  const submission = useRef<{ signature: string; input: Record<string, unknown> } | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const artifactId = assist.run?.artifactId || ''
  const local = editing.artifactId === artifactId ? editing : { artifactId, selected: [], edits: {} }
  const { selected, edits } = local
  const setSelected = (next: React.SetStateAction<string[]>) => setEditing(current => {
    const state = current.artifactId === artifactId ? current : { artifactId, selected: [], edits: {} }
    return { ...state, selected: typeof next === 'function' ? next(state.selected) : next }
  })
  const input = { novelId, text: range ? text.slice(...range) : text, sourceTitle, sourceLabel, request }
  const signature = JSON.stringify(input)
  const prepare = async (start: boolean) => {
    setBusy(true); setError('')
    try {
      const data = { ...input, idempotencyKey: `extract:${crypto.randomUUID()}` }
      if (start) {
        const result = await callAuthorTool<{ run: AuthorAssistRun }>('novelforge.research.extract', data)
        if (alive.current) assist.track(result.run)
      } else {
        const result = await callAuthorTool<{ budget: Budget }>('novelforge.research.extract_preview', data)
        if (alive.current) setBudget({ signature, value: result.budget })
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  const upload = async (file: File) => {
    try {
      if (file.size > 2 * 1024 * 1024 || !/\.(txt|md|markdown)$/i.test(file.name)) throw new Error(formatUserFacingMessage('author.upload.unsupported'))
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (alive.current) { setText(value); setRange(null); setSourceTitle(file.name); setError('') }
    } catch { if (alive.current) setError('请选择不超过 2 MiB、UTF-8 编码的 TXT 或 Markdown 文件。') }
  }
  const adopt = async () => {
    if (!assist.run?.artifactId || !assist.result) return
    setBusy(true); setError('')
    try {
      const novel = await window.electron.novel.get(novelId)
      if (!novel) throw new Error(formatUserFacingMessage('author.project.notFound'))
      const entries = selected.map(candidateId => ({ candidateId, draft: edits[candidateId] || assist.result!.candidates.find(card => card.id === candidateId)!.draft }))
      const key = JSON.stringify({ artifactId: assist.run.artifactId, entries, expectedContextVersion: novel.contextVersion })
      if (submission.current?.signature !== key) submission.current = { signature: key, input: { novelId, artifactId: assist.run.artifactId, entries, expectedContextVersion: novel.contextVersion, idempotencyKey: `adopt:${crypto.randomUUID()}` } }
      await callAuthorTool('novelforge.research.adopt', submission.current.input)
      if (alive.current) { await onSaved(); setSelected([]); message.success(formatUserFacingMessage('author.research.adopted')) }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  const change = (id: string, draft: CreativeResearchDraft) => setEditing({ ...local, edits: { ...edits, [id]: draft } })
  return <Modal title="从文本提炼创作资料" open={open} onCancel={onClose} width={1000} footer={null}>
    <div className="author-assist-stack">
      <p className="author-muted">选择原文，提炼机制与含义，再决定怎样用于本作。保存前可以修改每张卡。</p>
      <div className="creative-research__form-row"><label>来源标题<Input aria-label="提炼来源标题" value={sourceTitle} maxLength={160} onChange={event => setSourceTitle(event.target.value)} /></label><label>章段说明<Input value={sourceLabel} maxLength={160} onChange={event => setSourceLabel(event.target.value)} /></label></div>
      <label>导入文本<input type="file" accept=".txt,.md,.markdown" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /></label>
      <label>原文（可选中其中一段）<Input.TextArea aria-label="提炼原文" rows={7} value={text} onChange={event => { setText(event.target.value); setRange(null) }} onSelect={event => { const field = event.target as HTMLTextAreaElement; setRange(field.selectionEnd > field.selectionStart ? [field.selectionStart, field.selectionEnd] : null) }} /></label>
      <small>{range ? `已选中 ${range[1] - range[0]} 字符` : `使用全部 ${text.length} 字符`} · 单次上限 20,000 字符</small>
      <label>提炼要求<Input.TextArea aria-label="提炼要求" rows={2} value={request} maxLength={2000} onChange={event => setRequest(event.target.value)} /></label>
      <Space wrap><Button loading={busy} disabled={assist.active} onClick={() => void prepare(false)}>检查预算</Button><Button type="primary" loading={busy} disabled={assist.active || budget?.signature !== signature || !budget?.value.fits} onClick={() => void prepare(true)}>开始提炼</Button></Space>
      {budget?.signature === signature && <Alert type={budget.value.fits ? 'info' : 'warning'} message={`预计输入 ${budget.value.estimatedTokens} tokens，输出预留 ${budget.value.outputReserve} tokens${budget.value.fits ? '' : '；请缩小原文范围'}`} />}
      <Select disabled={busy || assist.active} aria-label="提炼任务记录" placeholder="查看历史提炼任务" value={assist.run?.taskId} options={assist.runs.map(run => ({ value: run.taskId, label: `任务 ${run.taskId} · ${run.createdAt || ''}` }))} onChange={id => assist.track(assist.runs.find(run => run.taskId === id)!)} />
      {assist.run && <div className="author-heading-actions"><span>任务 {assist.run.taskId} · {assist.active ? '提炼中' : assist.run.status === 'success' ? '已完成' : assist.run.status === 'cancelled' ? '已停止' : '未完成'}</span>{assist.active && <Button onClick={() => void assist.cancel()}>停止</Button>}</div>}
      {(error || assist.error || assist.run?.error) && <Alert type="error" showIcon message={error || assist.error || assist.run?.error} />}
      {assist.result && <><details className="author-disclosure"><summary>查看本轮所选原文</summary><pre className="author-assist-source">{assist.result.source.text}</pre></details><p>{assist.result.source.title} · {assist.result.source.label} · 引文来自本轮保存的原文</p>{assist.result.candidates.map(card => {
        const draft = edits[card.id] || card.draft
        return <article className="author-assist-card" key={card.id}>
          <Checkbox disabled={Boolean(card.error)} checked={selected.includes(card.id)} onChange={event => setSelected(items => event.target.checked ? [...items, card.id] : items.filter(id => id !== card.id))}>保存这张卡</Checkbox>
          <blockquote>{card.quote}</blockquote>{card.error && <Alert type="warning" message={card.error} />}
          <Input aria-label={`${card.id}标题`} value={draft.title} maxLength={120} onChange={event => change(card.id, { ...draft, title: event.target.value })} />
          <Select aria-label={`${card.id}分类`} value={draft.category} options={CREATIVE_RESEARCH_CATEGORIES.map(item => ({ ...item }))} onChange={category => change(card.id, { ...draft, category })} />
          {(['content', 'interpretation', 'novelConnection'] as const).map((field, i) => <label key={field}>{['机制与代价', '深层含义', '本作转化方向'][i]}<Input.TextArea rows={3} maxLength={field === 'content' ? 4000 : 1200} value={draft[field]} onChange={event => change(card.id, { ...draft, [field]: event.target.value })} /></label>)}
        </article>
      })}<Button type="primary" disabled={!selected.length || assist.active} loading={busy} onClick={() => void adopt()}>保存所选 {selected.length} 张卡</Button></>}
    </div>
  </Modal>
}
