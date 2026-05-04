import React, { useEffect, useState } from 'react'
import { Tooltip } from 'antd'
import {
  BorderOutlined,
  CloseOutlined,
  MinusOutlined,
  ShrinkOutlined,
} from '@ant-design/icons'

interface WindowControlsProps {
  className?: string
  buttonClassName?: string
  dangerButtonClassName?: string
}

export default function WindowControls({
  className,
  buttonClassName,
  dangerButtonClassName,
}: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let active = true

    void window.electron.windowControls.isMaximized()
      .then((value) => {
        if (active) {
          setIsMaximized(value)
        }
      })
      .catch(() => {})

    const unsubscribe = window.electron.windowControls.onMaximizedStateChange((value) => {
      setIsMaximized(value)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <div className={className}>
      <Tooltip title="最小化">
        <button
          type="button"
          className={buttonClassName}
          onClick={() => void window.electron.windowControls.minimize()}
          aria-label="最小化窗口"
        >
          <MinusOutlined />
        </button>
      </Tooltip>
      <Tooltip title={isMaximized ? '还原窗口' : '最大化'}>
        <button
          type="button"
          className={buttonClassName}
          onClick={() => void window.electron.windowControls.toggleMaximize()}
          aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
        >
          {isMaximized ? <ShrinkOutlined /> : <BorderOutlined />}
        </button>
      </Tooltip>
      <Tooltip title="关闭">
        <button
          type="button"
          className={[buttonClassName, dangerButtonClassName].filter(Boolean).join(' ')}
          onClick={() => void window.electron.windowControls.close()}
          aria-label="关闭窗口"
        >
          <CloseOutlined />
        </button>
      </Tooltip>
    </div>
  )
}
