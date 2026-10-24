import React, { useEffect, useRef, useState } from 'react'

export function AtlasWorkbench({ className, resizable, children }: { className: string; resizable: boolean; children: [React.ReactNode, React.ReactNode] }) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  const [maximum, setMaximum] = useState(720)
  const drag = useRef<number | null>(null)
  useEffect(() => {
    const element = host.current
    if (!element || !resizable) return
    const observer = new ResizeObserver(() => {
      const max = Math.max(260, Math.min(720, element.clientWidth - 370))
      setMaximum(max)
      setWidth(previous => Math.min(previous, max))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [resizable])
  const limit = () => Math.max(260, Math.min(720, (host.current?.clientWidth || 1000) - 370))
  const resize = (value: number) => { const max = limit(); setMaximum(max); setWidth(Math.max(260, Math.min(max, value))) }
  return <div ref={host} className={`${className}${resizable ? ' atlas-workbench--resizable' : ''}`} style={{ '--atlas-inspector-width': `${width}px` } as React.CSSProperties}>
    {children[0]}
    {resizable && <div className="atlas-panel-resizer" role="separator" aria-label="调整资料面板宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
      onPointerMove={event => { if (drag.current === event.pointerId && host.current) resize(host.current.getBoundingClientRect().right - event.clientX) }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resize(event.key === 'Home' ? 260 : event.key === 'End' ? limit() : width + (event.key === 'ArrowLeft' ? 24 : -24)) } }} />}
    {children[1]}
  </div>
}
