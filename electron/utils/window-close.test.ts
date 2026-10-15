import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { confirmWindowClose, installWindowCloseGuard } from './window-close'

function fixture() {
  const window = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { send: vi.fn() }),
    close: vi.fn(), minimize: vi.fn(),
  })
  const typed = window as unknown as BrowserWindow
  const save = vi.fn()
  installWindowCloseGuard(typed, () => false, save)
  const close = () => { const event = { preventDefault: vi.fn() }; window.emit('close', event); return event }
  window.close.mockImplementation(close)
  return { window, typed, close, save }
}
describe('window close confirmation', () => {
  it('intercepts native close and minimizes without closing', () => {
    const f = fixture()
    expect(f.close().preventDefault).toHaveBeenCalledOnce()
    expect(f.window.webContents.send).toHaveBeenCalledWith('window:close-requested', false)
    confirmWindowClose(f.typed, 'minimize')
    expect(f.window.minimize).toHaveBeenCalledOnce()
    expect(f.window.close).not.toHaveBeenCalled()
  })
  it('allows one confirmed close and retains the unsaved-content veto', () => {
    const f = fixture()
    confirmWindowClose(f.typed, 'exit')
    expect(f.save).toHaveBeenCalledOnce()
    const veto = { preventDefault: vi.fn() }
    f.window.webContents.emit('will-prevent-unload', veto)
    expect(veto.preventDefault).not.toHaveBeenCalled()
    expect(f.window.webContents.send).toHaveBeenCalledWith('window:close-requested', true)
    expect(f.close().preventDefault).toHaveBeenCalledOnce()
  })
  it('rejects unknown actions without touching the window', () => {
    const f = fixture()
    expect(() => confirmWindowClose(f.typed, 'discard')).toThrow('无效')
    expect(f.window.close).not.toHaveBeenCalled()
  })
})
