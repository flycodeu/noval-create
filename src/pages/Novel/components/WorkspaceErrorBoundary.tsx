import React from 'react'
import { Alert, Button, Space } from 'antd'

interface Props {
  resetKey: string
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export default class WorkspaceErrorBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Novel workspace crashed.', error, errorInfo)
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="novel-route-shell novel-route-shell--loading novel-route-shell--error">
        <div className="novel-route-shell__error-card">
          <Alert
            type="error"
            showIcon
            message="当前工作区渲染失败"
            description={this.state.error.message || '页面渲染时出现异常，已阻止整个工作台白屏。'}
          />
          <Space wrap className="novel-route-shell__error-actions">
            <Button type="primary" onClick={() => this.setState({ error: null })}>
              重试当前页面
            </Button>
            <Button onClick={() => window.location.reload()}>
              重新加载应用
            </Button>
          </Space>
        </div>
      </div>
    )
  }
}
