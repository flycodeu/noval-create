import { useEffect, useRef, useState } from 'react'
import { Button, Spin } from 'antd'
import { useTaskStreamContent } from '../../../../stores/task.selectors'

/** 超过该长度只渲染尾部内容，避免超长流式文本拖垮渲染。 */
const TAIL_RENDER_LIMIT = 60 * 1024
/** 距底部超过该像素视为用户主动上滚，暂停自动跟随。 */
const AUTO_SCROLL_THRESHOLD = 40

interface StreamingOutputProps {
  streamTaskId?: number | null
  title?: string
}

/**
 * 章节生成流式输出区：
 * - 通过 useTaskStreamContent 细粒度订阅，只随本任务的流内容重渲染
 * - 自动滚动到底；用户上滚超过 40px 暂停跟随并出现「回到底部」按钮
 * - 容器限高 40vh；超长文本只渲染尾部 60KB 并提示已省略字数
 * - 可折叠为单行状态条
 */
export default function StreamingOutput({ streamTaskId, title = 'AI 正在生产本章' }: StreamingOutputProps) {
  const content = useTaskStreamContent(streamTaskId)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [followBottom, setFollowBottom] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  const omittedChars = content.length > TAIL_RENDER_LIMIT ? content.length - TAIL_RENDER_LIMIT : 0
  const visibleContent = omittedChars > 0 ? content.slice(-TAIL_RENDER_LIMIT) : content

  useEffect(() => {
    if (collapsed || !followBottom) return
    const element = bodyRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [visibleContent, collapsed, followBottom])

  const handleScroll = () => {
    const element = bodyRef.current
    if (!element) return
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    setFollowBottom(distanceToBottom <= AUTO_SCROLL_THRESHOLD)
  }

  const handleBackToBottom = () => {
    setFollowBottom(true)
    const element = bodyRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  if (collapsed) {
    return (
      <div className="chapter-console-page__stream">
        <div
          className="chapter-console-page__stream-head"
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <span>{title}</span>
          <Spin size="small" />
          <span>{`已生成 ${content.length} 字符`}</span>
          <Button size="small" type="link" onClick={() => setCollapsed(false)}>
            展开输出
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="chapter-console-page__stream" style={{ position: 'relative' }}>
      <div
        className="chapter-console-page__stream-head"
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
      >
        <span>{title}</span>
        <Spin size="small" />
        <Button size="small" type="link" onClick={() => setCollapsed(true)}>
          折叠为状态条
        </Button>
      </div>
      {omittedChars > 0 ? (
        <div className="chapter-console-page__stream-head" style={{ fontWeight: 400 }}>
          {`已省略前文 ${omittedChars} 字，仅显示最新内容。`}
        </div>
      ) : null}
      <div
        ref={bodyRef}
        className="chapter-console-page__stream-body"
        style={{ maxHeight: '40vh', overflowY: 'auto' }}
        onScroll={handleScroll}
      >
        {visibleContent}
        <span className="streaming-cursor" />
      </div>
      {!followBottom ? (
        <Button
          size="small"
          shape="round"
          onClick={handleBackToBottom}
          style={{ position: 'absolute', right: 16, bottom: 12, zIndex: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          回到底部
        </Button>
      ) : null}
    </div>
  )
}
