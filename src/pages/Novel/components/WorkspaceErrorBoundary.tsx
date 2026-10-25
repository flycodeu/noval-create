import React from 'react'
import PageErrorNotice from '../../../components/Layout/PageErrorNotice'

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
          <PageErrorNotice error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </div>
      </div>
    )
  }
}
