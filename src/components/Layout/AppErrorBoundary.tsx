import React from 'react'
import PageErrorNotice from './PageErrorNotice'

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
          <PageErrorNotice error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </div>
      </div>
    )
  }
}
