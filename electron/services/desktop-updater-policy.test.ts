import { describe, expect, it } from 'vitest'
import { canUseDesktopUpdater } from './desktop-updater-policy'

describe('desktop update support', () => {
  it('checks for updates only in an installed Windows package', () => {
    expect(canUseDesktopUpdater(true, 'win32')).toBe(true)
    expect(canUseDesktopUpdater(false, 'win32')).toBe(false)
    expect(canUseDesktopUpdater(true, 'darwin')).toBe(false)
    expect(canUseDesktopUpdater(true, 'linux')).toBe(false)
    expect(canUseDesktopUpdater(true, 'win32', 'D:\\NovelForge-Portable.exe')).toBe(false)
  })
})
