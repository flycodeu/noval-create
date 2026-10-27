import React, { useMemo, useState } from 'react'
import { prepareJsonView } from './json-view'
import './json-viewer.css'

function JsonNode({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth === 0)
  const [limit, setLimit] = useState(40)
  const compound = value !== null && typeof value === 'object'
  const entries = compound ? Object.entries(value) : []
  if (!compound) return <div className="json-viewer__row"><span className="json-viewer__key">{name}</span><span className={`json-viewer__value json-viewer__value--${value === null ? 'null' : typeof value}`}>{value === null ? 'null' : String(value)}</span></div>
  return <details className="json-viewer__branch" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span className="json-viewer__key">{name}</span><span className="json-viewer__count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
    {open ? <div className="json-viewer__children">
      {depth >= 12 ? <span className="json-viewer__count">层级较深，请切换格式化源码查看</span> : entries.slice(0, limit).map(([key, item]) => <JsonNode key={key} name={key} value={item} depth={depth + 1} />)}
      {depth < 12 && entries.length > limit ? <button type="button" className="json-viewer__more" onClick={() => setLimit(limit + 40)}>再显示 {Math.min(40, entries.length - limit)} 项</button> : null}
    </div> : null}
  </details>
}

/** JSON uses a bounded, lazily expanded tree; ordinary prose keeps its paragraphs. */
export default function JsonViewer({ raw, label = '数据' }: { raw?: string | null; label?: string }) {
  const view = useMemo(() => prepareJsonView(raw), [raw])
  const [source, setSource] = useState(false)
  if (!view.structured) return <div className="json-viewer__text">{view.text || '暂无内容'}</div>
  return <section className="json-viewer" aria-label={label}>
    <div className="json-viewer__toolbar"><span>JSON</span><button type="button" onClick={() => setSource(!source)}>{source ? '结构视图' : '格式化源码'}</button></div>
    {source ? <pre className="json-viewer__source">{view.text}</pre> : <JsonNode key={raw} name={label} value={view.value} />}
  </section>
}
