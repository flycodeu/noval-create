import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, isTrustedRendererUrl } from './renderer-navigation'

describe('renderer navigation boundary', () => {
  it('opens web links without dispatching local files or system protocols', () => {
    expect(isAllowedExternalUrl('https://example.com/help')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:3000')).toBe(true)
    for (const value of ['file:///C:/Windows/system32/cmd.exe', 'ms-settings:privacy', 'javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com', 'invalid']) {
      expect(isAllowedExternalUrl(value)).toBe(false)
    }
  })
  it('keeps packaged navigation on the exact application file', () => {
    const entry = 'file:///D:/NovelForge/renderer/index.html'
    expect(isTrustedRendererUrl(`${entry}#/novel/1`, entry)).toBe(true)
    expect(isTrustedRendererUrl('file:///D:/NovelForge/renderer/other.html', entry)).toBe(false)
    expect(isTrustedRendererUrl('https://example.com', entry)).toBe(false)
  })
  it('allows development routes only on the configured origin', () => {
    const entry = 'http://localhost:5173'
    expect(isTrustedRendererUrl(`${entry}/novel/1`, entry)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174', entry)).toBe(false)
    expect(isTrustedRendererUrl('http://localhost:5173.evil.example', entry)).toBe(false)
  })
})
