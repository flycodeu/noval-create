import React from 'react'
import { Alert, Button, Space } from 'antd'

export default function PageErrorNotice({ error, onRetry, onReload = () => window.location.reload() }: {
  error: Error
  onRetry: () => void
  onReload?: () => void
}) {
  // React.lazy retains rejected imports; resetting the boundary cannot refetch those modules.
  const resourceFailed = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk[\s\S]*failed|ChunkLoadError|Unable to preload CSS|Failed to load module script/i.test(error.message || '')
  return <>
    <Alert type="error" showIcon message={resourceFailed ? '页面暂时无法加载' : '页面暂时无法显示'}
      description={resourceFailed ? '页面资源加载中断，请重新加载页面后再试。' : '请重试当前页面；如果仍未恢复，可以重新加载页面。'} />
    <Space wrap style={{ marginTop: 16 }}>
      {!resourceFailed && <Button type="primary" onClick={onRetry}>重试当前页面</Button>}
      <Button type={resourceFailed ? 'primary' : 'default'} onClick={onReload}>重新加载页面</Button>
    </Space>
  </>
}
