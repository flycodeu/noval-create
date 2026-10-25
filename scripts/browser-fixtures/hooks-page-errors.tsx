import React, { act, Suspense } from 'react'
import type { Root } from 'react-dom/client'
import AppErrorBoundary from '../../src/components/Layout/AppErrorBoundary'
import WorkspaceErrorBoundary from '../../src/pages/Novel/components/WorkspaceErrorBoundary'
import PageErrorNotice from '../../src/components/Layout/PageErrorNotice'
import { check, click, button } from './hooks-lifecycles'

export async function runPageErrorTests(root: Root) {
  const rawMessage = 'Failed to fetch dynamically imported module: http://127.0.0.1:18176/src/pages/NovelList/index.tsx'
  for (const Boundary of [AppErrorBoundary, WorkspaceErrorBoundary]) {
    let broken = true
    function Page() { if (broken) throw new Error('internal-secret /private/component.tsx'); return <p>页面已恢复</p> }
    await act(async () => root.render(<Boundary key="runtime" resetKey="first"><Page /></Boundary>))
    check(document.body.textContent?.includes('页面暂时无法显示'), 'runtime errors have a friendly message')
    check(!document.body.textContent?.includes('internal-secret') && !document.body.textContent?.includes('/private/'), 'render errors never expose internal details')
    broken = false
    await click(button('重试当前页面'))
    check(document.body.textContent?.includes('页面已恢复'), 'retry recovers a transient render failure')
    const LazyPage = React.lazy(() => Promise.reject(new TypeError(rawMessage)))
    await act(async () => root.render(<Boundary key="module" resetKey="first"><Suspense fallback="加载中"><LazyPage /></Suspense></Boundary>))
    const message = document.body.textContent || ''
    check(message.includes('页面暂时无法加载') && !message.includes('http:') && !message.includes('index.tsx') && !message.includes('Failed to fetch'), 'lazy failures hide module URLs and engine messages')
    check(!button('重试当前页面') && !!button('重新加载页面'), 'rejected lazy imports offer a real page reload instead of resetting the cached failure')
    await act(async () => root.render(<Boundary key="module" resetKey="second"><p>另一个页面</p></Boundary>))
    check(document.body.textContent?.includes('另一个页面'), 'route changes still reset the error boundary')
    await act(async () => root.render(null))
  }
  let reloaded = 0
  for (const message of [rawMessage, 'error loading dynamically imported module', 'Importing a module script failed', 'Loading chunk 8 failed.', 'Unable to preload CSS for /assets/private.css']) {
    await act(async () => root.render(<PageErrorNotice error={new Error(message)} onRetry={() => { throw new Error('cached import must not retry') }} onReload={() => { reloaded++ }} />))
    await click(button('重新加载页面'))
  }
  check(reloaded === 5, 'all supported browsers and CSS chunk failures invoke the reload action')
  await act(async () => root.render(null))
}
