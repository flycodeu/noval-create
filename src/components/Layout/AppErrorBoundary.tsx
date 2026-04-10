import React from 'react'
import { Alert, Button, Space } from 'antd'

interface Props {
  resetKey?: string
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('App layout crashed.', error, errorInfo)
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          background: 'var(--color-bg-primary)',
        }}
      >
        <div style={{ width: 'min(640px, 100%)' }}>
          <Alert
            type="error"
            showIcon
            message="页面渲染失败"
            description={
              this.state.error.message ||
              '页面渲染时出现异常，已阻止整个应用白屏。可以尝试重试或重新加载。'
            }
          />
          <Space wrap style={{ marginTop: 16 }}>
            <Button type="primary" onClick={() => this.setState({ error: null })}>
              重试当前页面
            </Button>
            <Button onClick={() => window.location.reload()}>重新加载应用</Button>
          </Space>
        </div>
      </div>
    )
  }
}
