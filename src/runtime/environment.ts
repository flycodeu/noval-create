const WEB_BRIDGE_MARKER = '__novalCreateWebBridgeInstalled'

type RuntimeWindow = Window & {
  electron?: Window['electron']
  [WEB_BRIDGE_MARKER]?: boolean
}

export function isElectronRuntime() {
  if (typeof window === 'undefined') return false

  const runtimeWindow = window as RuntimeWindow
  return runtimeWindow[WEB_BRIDGE_MARKER] !== true
    && typeof runtimeWindow.electron?.on === 'function'
    && typeof runtimeWindow.electron?.novel?.list === 'function'
    && typeof runtimeWindow.electron?.windowControls?.minimize === 'function'
}

export function markRuntimeEnvironment() {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.runtime = isElectronRuntime() ? 'electron' : 'web'
}
