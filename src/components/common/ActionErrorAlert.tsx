import { Alert, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

export interface ActionErrorAlertProps {
  /** 失败动作标题，例如「章节流水线启动失败」。 */
  title: string
  /** 失败详情；为空时组件不渲染。 */
  message?: string | null
  /** 提供后展示「重试」按钮。 */
  onRetry?: () => void
  retrying?: boolean
  /** 提供后 Alert 可关闭。 */
  onDismiss?: () => void
  className?: string
}

/**
 * 主链路动作失败的统一持久提示：AntD error Alert + 重试按钮 + 可关闭。
 * 用于替代一闪而过的 message.error，失败原因常驻区域内直到重试或关闭。
 */
export default function ActionErrorAlert({
  title,
  message,
  onRetry,
  retrying = false,
  onDismiss,
  className,
}: ActionErrorAlertProps) {
  if (!message) return null

  return (
    <Alert
      type="error"
      showIcon
      className={className}
      message={title}
      description={message}
      closable={Boolean(onDismiss)}
      onClose={onDismiss}
      action={onRetry ? (
        <Button
          size="small"
          danger
          icon={<ReloadOutlined />}
          loading={retrying}
          onClick={onRetry}
        >
          重试
        </Button>
      ) : undefined}
    />
  )
}
