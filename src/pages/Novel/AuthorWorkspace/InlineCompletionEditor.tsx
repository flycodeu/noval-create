import React, { useEffect, useState, type RefObject } from 'react'
import { Button, Select, Space, Switch } from 'antd'
import type { Chapter, ModelConfig } from '../../../types'
import { useInlineCompletion } from './useInlineCompletion'
import './inline-completion.css'

export default function InlineCompletionEditor({ novelId, chapter, value, disabled, assistDisabled, editorRef, onChange, onSelection }: {
  novelId: number; chapter: Chapter; value: string; disabled: boolean; assistDisabled: boolean; editorRef: RefObject<HTMLTextAreaElement>
  onChange: (value: string) => void; onSelection: (field: HTMLTextAreaElement) => void
}) {
  const completion = useInlineCompletion({ novelId, chapterId: chapter.id, value, disabled: disabled || assistDisabled, editorRef, onChange })
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelError, setModelError] = useState('')
  const [layout, setLayout] = useState({ width: 0, height: 0, top: 0, left: 0 })
  useEffect(() => {
    if (!completion.enabled) return
    let alive = true
    void window.electron.model.list().then(rows => { if (alive) { setModels(rows); setModelError('') } }).catch(() => { if (alive) setModelError('模型列表读取失败，仍可使用本作配置。') })
    return () => { alive = false }
  }, [completion.enabled])
  useEffect(() => {
    const field = editorRef.current
    if (!field) return
    const observer = new ResizeObserver(() => setLayout({ width: field.clientWidth, height: field.clientHeight, top: field.scrollTop, left: field.scrollLeft }))
    observer.observe(field)
    return () => observer.disconnect()
  }, [editorRef])
  const ghost = completion.suggestion
  return <div className="inline-completion">
    <Space wrap className="inline-completion__controls"><label><Switch size="small" checked={completion.enabled} disabled={disabled || assistDisabled} onChange={completion.toggle} aria-label="开启行内补全" /> 行内补全</label>
      {completion.enabled && <><Select aria-label="补全长度" value={completion.mode} disabled={assistDisabled} onChange={completion.changeMode} options={[{ value: 'sentence', label: '一句 · 最多60字' }, { value: 'paragraph', label: '一段 · 最多220字' }]} /><Select aria-label="补全模型" value={completion.modelId} allowClear placeholder="使用本作模型" onChange={completion.changeModel} disabled={assistDisabled} options={models.map(model => ({ value: model.id, label: model.name }))} style={{ minWidth: 150 }} /><Button size="small" disabled={disabled || assistDisabled} loading={completion.pending} onMouseDown={event => event.preventDefault()} onClick={completion.manual}>手动补全</Button>{completion.canUndo && <Button size="small" onMouseDown={event => event.preventDefault()} onClick={completion.undoAccept}>撤销补全</Button>}</>}
    </Space>
    <div className="inline-completion__frame">
      {ghost && <div aria-hidden="true" className="inline-completion__viewport" style={{ width: layout.width, height: layout.height }}><div className="author-manuscript__editor inline-completion__mirror" style={{ width: layout.width, transform: `translate(${-layout.left}px, ${-layout.top}px)` }}>{value.slice(0, ghost.cursor)}<span className="inline-completion__ghost">{ghost.text}</span>{value.slice(ghost.cursor)}</div></div>}
      <textarea ref={editorRef} className={`author-manuscript__editor${ghost ? ' inline-completion__editor--ghost' : ''}`} aria-label={`第 ${chapter.chapterNum} 章正文`} value={value} disabled={disabled}
        onChange={event => completion.input(event.currentTarget)} onSelect={event => { onSelection(event.currentTarget); completion.select(event.currentTarget) }}
        onBlur={completion.cancel} onPointerDown={completion.cancel} onKeyDown={completion.keyDown}
        onCompositionStart={completion.compositionStart} onCompositionEnd={completion.compositionEnd}
        onScroll={event => { const field = event.currentTarget; setLayout({ width: field.clientWidth, height: field.clientHeight, top: field.scrollTop, left: field.scrollLeft }) }}
        placeholder="正文从这里开始。也可以在下方说明这一章的要求，让 AI 生成并审校。" spellCheck={false} />
    </div>
    {completion.enabled && <div className="inline-completion__status" role="status" aria-live="polite">{ghost ? <>
      <Space wrap><span>Tab 采用 · Esc 取消</span><Button size="small" onMouseDown={event => event.preventDefault()} onClick={completion.accept}>采用建议</Button><Button size="small" onMouseDown={event => event.preventDefault()} onClick={completion.cancel}>取消建议</Button></Space>
      <details className="inline-completion__preview" onMouseDown={event => event.preventDefault()}><summary>查看完整建议</summary><p>{ghost.text}</p></details>
    </> : completion.pending ? '正在补全，Esc 可停止' : completion.feedback || modelError || '停笔后提供建议，采用只改草稿，可撤销。'}</div>}
  </div>
}
