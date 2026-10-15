import type { BrowserWindow } from 'electron'

const approved = new WeakSet<BrowserWindow>()

export function installWindowCloseGuard(window: BrowserWindow, isShutdownComplete: () => boolean, save: () => void): void {
  window.on('close', (event) => {
    if (isShutdownComplete() || approved.delete(window)) {
      save()
      return
    }
    event.preventDefault()
    window.webContents.send('window:close-requested', false)
  })
  // Do not prevent this event: Electron then keeps the window open and retains
  // the editor's unsaved draft. No app.quit() may bypass that editor guard.
  window.webContents.on('will-prevent-unload', () => {
    approved.delete(window)
    window.webContents.send('window:close-requested', true)
  })
}

export function confirmWindowClose(window: BrowserWindow, choice: unknown): void {
  if (choice === 'minimize') window.minimize()
  else if (choice === 'exit') {
    approved.add(window)
    window.close()
  } else throw new Error('无效的窗口操作')
}
