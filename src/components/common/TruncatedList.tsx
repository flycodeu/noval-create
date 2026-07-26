import React, { useMemo, useState } from 'react'
import { Button } from 'antd'
import { computeVisibleItems } from './truncated-list'

export interface TruncatedListProps<T> {
  items: T[]
  limit: number
  renderItem: (item: T, index: number) => React.ReactNode
  expandLabel?: string
}

/**
 * Generic fold/expand list: collapsed it renders the first `limit` items plus a
 * "还有 N 条" link button; expanded it renders everything with a collapse link.
 * Replaces silent `.slice(0, n)` truncation so no item is unreachable.
 */
export default function TruncatedList<T>({ items, limit, renderItem, expandLabel }: TruncatedListProps<T>) {
  const [expanded, setExpanded] = useState(false)
  const { visible, hiddenCount, canToggle } = useMemo(
    () => computeVisibleItems(items, limit, expanded),
    [items, limit, expanded],
  )

  return (
    <>
      {visible.map((item, index) => renderItem(item, index))}
      {canToggle ? (
        <Button type="link" size="small" onClick={() => setExpanded((current) => !current)}>
          {expanded
            ? '收起'
            : expandLabel || `还有 ${hiddenCount} 条，展开`}
        </Button>
      ) : null}
    </>
  )
}
